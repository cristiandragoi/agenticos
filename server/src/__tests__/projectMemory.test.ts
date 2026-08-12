/**
 * Project-scoped memory + continuation (memory continuity milestone).
 * - P5: storeProjectMemory writes into the project namespace
 * - P6/P10: retrieveProjectMemory isolates by project (no cross-project leak)
 * - P7: resolveContinuation answers from real records, asks when insufficient
 * - P12: memory.* activity events are recorded with safe metadata
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  storeProjectMemory, retrieveProjectMemory, resolveContinuation, formatContinuation,
  isContinuationRequest, listMemoryActivity,
} from '../domains/jarvis/projectMemory.js';
import { memoryStore } from '../services/memory/store.js';
import { projectsStore } from '../services/projectsStore.js';

const PROJ_A = 'proj-test-a';
const PROJ_B = 'proj-test-b';

// Track created ids so we can remove them after each test (tests run against
// the real dev DB — keep it clean).
const created: string[] = [];

afterEach(() => {
  for (const id of created.splice(0)) {
    try { memoryStore.remove(id); } catch { /* ignore */ }
  }
  try { projectsStore.deleteProject(PROJ_A); } catch { /* ignore */ }
  try { projectsStore.deleteProject(PROJ_B); } catch { /* ignore */ }
});

describe('P5 — project-memory write', () => {
  it('stores a memory in the project namespace with provenance', () => {
    const m = storeProjectMemory(PROJ_A, {
      type: 'decision',
      title: 'Paused Jarvis humanoid work',
      content: 'We paused the Jarvis humanoid work and focused on runtime functionality.',
      tags: ['milestone'],
      source: { sourceType: 'conversation', conversationId: 'conv-test' },
    });
    created.push(m.id);
    expect(m.scope).toBe(`project:${PROJ_A}`);
    expect(m.type).toBe('decision');
    expect(m.source.conversationId).toBe('conv-test');
    expect(memoryStore.get(m.id)).not.toBeNull();
  });
});

describe('P10 — cross-project isolation', () => {
  beforeEach(() => {
    const a = storeProjectMemory(PROJ_A, { type: 'semantic', title: 'Atlas codename', content: 'The project codename is Atlas.' });
    const b = storeProjectMemory(PROJ_B, { type: 'semantic', title: 'Other project secret', content: 'The OTHER project uses codename Zephyr.' });
    created.push(a.id, b.id);
  });

  it('retrieves ONLY the active project memories', () => {
    const { hits, usedScope, globalUsed } = retrieveProjectMemory(PROJ_A, 'codename', { limit: 5 });
    expect(usedScope).toBe(`project:${PROJ_A}`);
    expect(globalUsed).toBe(false);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const h of hits) {
      expect(h.memory.scope).toBe(`project:${PROJ_A}`);
      expect(h.memory.title).not.toContain('Zephyr');
      expect(h.memory.title).not.toContain('OTHER project');
    }
  });

  it('does not leak project B into project A recall', () => {
    const { hits } = retrieveProjectMemory(PROJ_A, 'Zephyr', { limit: 5 });
    expect(hits.length).toBe(0);
  });
});

describe('P7 — continuation resolution', () => {
  it('asks for a project when none is active', () => {
    const r = resolveContinuation(null);
    expect(r.insufficient).toMatch(/No active project/i);
    expect(formatContinuation(r)).toMatch(/No active project/i);
  });

  it('resolves the project + latest project memory', () => {
    projectsStore.createProject({ id: PROJ_A, name: 'Test Project A', description: 'continuation test' });
    const m = storeProjectMemory(PROJ_A, {
      type: 'decision',
      title: 'Next priority is memory continuity',
      content: 'The next priority after delegation is project memory continuity.',
      tags: ['milestone'],
    });
    created.push(m.id);
    const r = resolveContinuation(PROJ_A);
    expect(r.insufficient).toBeNull();
    expect(r.project?.id).toBe(PROJ_A);
    expect(r.lastMemory?.id).toBe(m.id);
    const text = formatContinuation(r);
    expect(text).toContain('Test Project A');
    expect(text).toContain('memory continuity');
  });
});

describe('P7 — continuation detection', () => {
  it('recognizes continuation requests', () => {
    for (const s of ['Continue where we left off.', 'What were we working on?', 'What should we do next?', 'What did CodeX do last?', 'What was our last task?']) {
      expect(isContinuationRequest(s)).toBe(true);
    }
  });
  it('does not match ordinary prompts', () => {
    for (const s of ['Reply with exactly: OK', 'What project are we working on?', 'Create a plan for the project']) {
      expect(isContinuationRequest(s)).toBe(false);
    }
  });
});

describe('P12 — memory activity events', () => {
  it('records write + lookup activity with safe metadata', () => {
    const before = listMemoryActivity(100).length;
    storeProjectMemory(PROJ_A, { type: 'semantic', title: 'Activity test', content: 'activity content' });
    retrieveProjectMemory(PROJ_A, 'activity');
    const events = listMemoryActivity(100);
    expect(events.length).toBeGreaterThan(before);
    const kinds = events.slice(0, 5).map((e) => e.kind);
    expect(kinds.some((k) => k.startsWith('memory.'))).toBe(true);
    for (const e of events.slice(0, 5)) {
      expect(e.ts).toBeGreaterThan(0);
      // safe metadata only — no hidden reasoning fields
      expect(Object.keys(e).every((k) => ['kind', 'ts', 'operationId', 'projectId', 'category', 'resultCount', 'durationMs', 'memoryIds', 'error'].includes(k))).toBe(true);
    }
  });
});

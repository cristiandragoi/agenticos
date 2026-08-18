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
  isContinuationRequest, listMemoryActivity, isDeterministicProjectQuestion, formatProjectStateAnswer,
} from '../domains/jarvis/projectMemory.js';
import { memoryStore } from '../services/memory/store.js';
import { projectsStore } from '../services/projectsStore.js';
import { distillFromExecution } from '../services/memory/distill.js';
import type { ExecutionRecord } from '../services/executionState.js';

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

// ── P1 — automatic distillation is project-scoped when the task carries an
//    authoritative projectId (never inferred from text) ──────────────────────
function codexRec(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    operationId: 'op-distill-test',
    worker: 'codex',
    status: 'COMPLETED',
    currentAction: null,
    requestedProvider: null,
    requestedModel: null,
    resolvedProvider: null,
    resolvedModel: null,
    fallbackUsed: false,
    fallbackReason: null,
    startedAt: Date.now(),
    endedAt: Date.now(),
    lastActivityAt: Date.now(),
    queuePosition: null,
    activeCount: null,
    limit: null,
    result: 'inspection done',
    cancel: null,
    discoveredCount: null,
    qualifiedCount: null,
    rejectedCount: null,
    targetCount: null,
    note: null,
    workspace: null,
    ...over,
  };
}

describe('P1 — automatic distillation project scope', () => {
  it('distills into the project namespace when the task has a projectId', () => {
    projectsStore.createProject({ id: PROJ_A, name: 'Distill Project' });
    const ids = distillFromExecution(codexRec(), { taskId: 'task-distill-1', conversationId: 'conv-distill', projectId: PROJ_A });
    created.push(...ids);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const id of ids) {
      const m = memoryStore.get(id)!;
      expect(m.scope).toBe(`project:${PROJ_A}`);
      expect(m.source.worker).toBe('codex');
      expect(m.source.taskId).toBe('task-distill-1');
      expect(m.source.conversationId).toBe('conv-distill');
      expect(m.source.sourceType).toBe('task');
    }
  });

  it('keeps global scope when the task has NO projectId', () => {
    const ids = distillFromExecution(codexRec(), { taskId: 'task-noproj', conversationId: 'conv-noproj' });
    created.push(...ids);
    for (const id of ids) {
      const m = memoryStore.get(id)!;
      expect(m.scope).toBe('codex');
    }
  });

  it('auto-distilled project record is invisible to another project', () => {
    projectsStore.createProject({ id: PROJ_B, name: 'Other Distill Project' });
    const ids = distillFromExecution(codexRec(), { taskId: 'task-isolate', projectId: PROJ_A });
    created.push(...ids);
    const { hits } = retrieveProjectMemory(PROJ_B, 'inspection', { limit: 10 });
    for (const h of hits) expect(h.memory.scope).toBe(`project:${PROJ_B}`);
    expect(hits.some((h) => ids.includes(h.memory.id))).toBe(false);
  });
});

// ── P5 — duplicate/spam control: createMemory consolidates same-scope
//    similar titles via supersede (reused, not a new subsystem) ─────────────
describe('P5 — duplicate prevention', () => {
  it('supersedes a similar same-scope memory instead of duplicating', () => {
    const first = storeProjectMemory(PROJ_A, { type: 'decision', title: 'We decided to pause humanoid work', content: 'paused' });
    const second = storeProjectMemory(PROJ_A, { type: 'decision', title: 'We decided to pause humanoid work for now', content: 'paused for now' });
    created.push(first.id, second.id);
    expect(memoryStore.get(second.id)?.status).toBe('active');
    expect(memoryStore.get(first.id)?.status).toBe('superseded');
    expect(second.supersedesMemoryId).toBe(first.id);
  });
});

// ── P2 — deterministic active-project answers ───────────────────────────────
describe('P2 — deterministic project answers', () => {
  it('matches ONLY the plain project-state question forms', () => {
    for (const s of ['What project are we working on?', 'Which project is active?', "What's the current project?", 'What is the active project?']) {
      expect(isDeterministicProjectQuestion(s)).toBe(true);
    }
    for (const s of ['What did we decide about the project?', 'Create a plan for the project', 'What project should we start next?', 'My project codename is Atlas.']) {
      expect(isDeterministicProjectQuestion(s)).toBe(false);
    }
  });

  it('answers the active project from the store (no model)', () => {
    projectsStore.createProject({ id: PROJ_A, name: 'Test Project A', description: 'x' });
    projectsStore.setActiveProjectId(PROJ_A);
    const { reply, projectId } = formatProjectStateAnswer(PROJ_A);
    expect(reply).toContain('Test Project A');
    expect(projectId).toBe(PROJ_A);
    projectsStore.setActiveProjectId(null);
  });

  it('answers truthfully when no project is active', () => {
    const { reply, projectId } = formatProjectStateAnswer(null);
    expect(reply).toMatch(/No project is currently selected/i);
    expect(projectId).toBeNull();
  });
});

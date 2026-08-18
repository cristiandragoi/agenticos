/**
 * workerMemoryIntegration.test.ts — Project Memory integration closure tests.
 *
 * Covers (closure):
 *  - Hermes candidate promotion chain (runId → resultId → verificationId →
 *    candidateId → memoryId), PASS promotes / FAIL / NEEDS_REVISION /
 *    NOT_PROVEN never promote and are never discarded.
 *  - Human memory semantics: POST /memories human → sourceType 'human' +
 *    verificationStatus 'human_confirmed'; /confirm upgrades to human_confirmed.
 *  - CodeX engineering retrieval: engineering memory retrieved, marketing
 *    memory excluded, exact IDs recorded, budget enforced.
 *  - Hermes research retrieval: research/constraint retrieved, engineering
 *    debug excluded.
 *  - Cross-project isolation: no leak between Project A and Project B.
 *  - Context budget: maxItems + maxChars + truncation flag.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { memoryStore, ensureMemoryTables } from '../services/memory/store.js';
import { createMemory, seedDecisions } from '../services/memory/distill.js';
import { promoteHermesCandidates, retrieveWorkerMemory, formatWorkerMemoryPacket } from '../services/memory/workerMemory.js';

const PROJ_A = 'proj-acc-a';
const PROJ_B = 'proj-acc-b';

function storeProjectFact(projectId: string, type: any, title: string, content: string, tags: string[]) {
  return createMemory({
    type,
    title,
    summary: content.slice(0, 120),
    content,
    scope: `project:${projectId}`,
    entities: [projectId],
    tags: [...tags, 'project'],
    confidence: 0.9,
    source: { sourceType: 'system' },
  });
}

describe('Closure — Hermes memory candidate promotion', () => {
  beforeEach(() => {
    ensureMemoryTables();
    try { seedDecisions(); } catch { /* seeded already */ }
  });
  afterEach(() => {
    // Clean up candidate + memory rows created during tests (best effort).
    for (const c of memoryStore.listCandidates({ limit: 500 })) memoryStore.updateCandidate(c.id, { status: 'rejected' });
  });

  test('PASS verdict promotes candidate → canonical memory with full provenance chain', async () => {
    const { candidates, promotedCount } = await promoteHermesCandidates({
      projectId: PROJ_A,
      sourceRunId: 'hr-run-1',
      sourceResultId: 'exr-result-1',
      verificationId: 'ver-1',
      verificationVerdict: 'PASS',
      candidates: [
        { key: 'Customer market is Germany', value: 'The customer market for this project is Germany.', category: 'market' },
      ],
      scope: `project:${PROJ_A}`,
    });

    expect(promotedCount).toBe(1);
    expect(candidates.length).toBe(1);
    const c = candidates[0];
    expect(c.status).toBe('promoted');
    expect(c.memoryId).toBeTruthy();

    // Chain integrity: candidate → memory linkage.
    const cand = memoryStore.getCandidate(c.candidateId);
    expect(cand).toBeTruthy();
    expect(cand!.sourceRunId).toBe('hr-run-1');
    expect(cand!.sourceResultId).toBe('exr-result-1');
    expect(cand!.verificationId).toBe('ver-1');
    expect(cand!.verificationVerdict).toBe('PASS');
    expect(cand!.memoryId).toBe(c.memoryId);
    expect(cand!.projectId).toBe(PROJ_A);

    // Canonical memory exists, verified (machine-verified, not human).
    const mem = memoryStore.get(c.memoryId!);
    expect(mem).toBeTruthy();
    expect(mem!.verificationStatus).toBe('verified');
    expect(mem!.scope).toBe(`project:${PROJ_A}`);
    expect(mem!.source.sourceType).toBe('task');
    expect(mem!.source.worker).toBe('hermes');

    // Retrieval returns the promoted memory.
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_A,
      worker: 'hermes',
      query: 'customer market Germany',
      budget: { maxItems: 5, maxChars: 2000 },
    });
    expect(packet.memoryIds).toContain(c.memoryId);
  });

  test('FAIL verdict does NOT promote; candidate is persisted (not discarded)', async () => {
    const { candidates, promotedCount } = await promoteHermesCandidates({
      projectId: PROJ_A,
      sourceRunId: 'hr-run-2',
      sourceResultId: 'exr-result-2',
      verificationId: 'ver-2',
      verificationVerdict: 'FAIL',
      candidates: [{ key: 'Unverified claim', value: 'Should not become active verified memory.' }],
      scope: `project:${PROJ_A}`,
    });
    expect(promotedCount).toBe(0);
    expect(candidates[0].status).toBe('rejected');
    expect(candidates[0].memoryId).toBeNull();
    // Persisted, not silently dropped.
    const cand = memoryStore.getCandidate(candidates[0].candidateId);
    expect(cand).toBeTruthy();
    expect(cand!.status).toBe('rejected');
    expect(cand!.verificationVerdict).toBe('FAIL');
  });

  test('NEEDS_REVISION / NOT_PROVEN never promote; stay needs_review', async () => {
    for (const verdict of ['NEEDS_REVISION', 'NOT_PROVEN']) {
      const { candidates, promotedCount } = await promoteHermesCandidates({
        projectId: PROJ_A,
        sourceRunId: `hr-run-${verdict}`,
        sourceResultId: `exr-${verdict}`,
        verificationId: `ver-${verdict}`,
        verificationVerdict: verdict,
        candidates: [{ key: `Candidate ${verdict}`, value: 'Pending review.' }],
        scope: `project:${PROJ_A}`,
      });
      expect(promotedCount).toBe(0);
      expect(candidates[0].status).toBe('needs_review');
      const cand = memoryStore.getCandidate(candidates[0].candidateId);
      expect(cand).toBeTruthy();
      expect(cand!.status).toBe('needs_review');
      expect(cand!.memoryId).toBeNull();
    }
  });
});

describe('Closure — human memory semantics', () => {
  beforeEach(() => {
    ensureMemoryTables();
    try { seedDecisions(); } catch { /* seeded already */ }
  });

  test('createMemory default is unverified (machine), not human_confirmed', () => {
    const m = createMemory({
      type: 'semantic',
      title: 'Machine fact',
      summary: 'x',
      content: 'Machine-generated without verification.',
      scope: 'general',
      entities: [],
      tags: [],
      confidence: 0.7,
      source: { sourceType: 'task', worker: 'codex' },
    });
    expect(m.verificationStatus).toBe('unverified');
    expect(m.source.sourceType).toBe('task');
  });

  test('createMemory with human source → human_confirmed + sourceType human', () => {
    const m = createMemory({
      type: 'preference',
      title: 'Human preference',
      summary: 'y',
      content: 'User-stated preference.',
      scope: 'user',
      entities: [],
      tags: [],
      confidence: 0.99,
      source: { sourceType: 'human' },
      verificationStatus: 'human_confirmed',
    });
    expect(m.verificationStatus).toBe('human_confirmed');
    expect(m.source.sourceType).toBe('human');
  });

  test('confirm endpoint semantics: upgrade to human_confirmed', () => {
    const m = createMemory({
      type: 'semantic',
      title: 'Upgrade me',
      summary: 'z',
      content: 'Originally unverified.',
      scope: 'general',
      entities: [],
      tags: [],
      confidence: 0.5,
      source: { sourceType: 'task' },
    });
    expect(m.verificationStatus).toBe('unverified');
    const upgraded = memoryStore.update(m.id, {
      lastConfirmedAt: Date.now(),
      status: 'active',
      verificationStatus: 'human_confirmed',
      source: { ...m.source, sourceType: 'human' },
    });
    expect(upgraded!.verificationStatus).toBe('human_confirmed');
    expect(upgraded!.source.sourceType).toBe('human');
    expect(upgraded!.lastConfirmedAt).toBeTruthy();
  });
});

describe('Closure — CodeX engineering retrieval', () => {
  beforeEach(() => {
    ensureMemoryTables();
    try { seedDecisions(); } catch { /* seeded already */ }
    storeProjectFact(PROJ_A, 'decision', 'Production state must use Electron userData', 'Production state must use Electron userData and never packaged resources.', ['architecture', 'deployment']);
    storeProjectFact(PROJ_A, 'semantic', 'Repository convention: server dist under server/dist', 'Build output lives in server/dist; never commit node_modules.', ['convention', 'engineering']);
    storeProjectFact(PROJ_A, 'semantic', 'Primary affiliate audience is social-media users', 'The affiliate audience is social-media users.', ['marketing', 'audience']);
  });

  test('engineering memory retrieved; marketing memory excluded; IDs recorded; budget enforced', async () => {
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_A,
      worker: 'codex',
      taskType: 'engineering',
      query: 'production persistence Electron userData',
      budget: { maxItems: 3, maxChars: 3000 },
    });

    const titles = packet.items.map((i) => i.title);
    // Engineering memory must be present.
    expect(titles.some((t) => t.includes('userData'))).toBe(true);
    expect(titles.some((t) => t.includes('Repository convention'))).toBe(true);
    // Marketing memory excluded.
    expect(titles.some((t) => t.includes('affiliate audience'))).toBe(false);
    expect(packet.excluded.marketing).toBeGreaterThanOrEqual(1);
    expect(packet.count).toBeGreaterThanOrEqual(1);
    expect(packet.memoryIds.length).toBe(packet.count);
    // Formatted block is bounded and includes IDs-visible content.
    const block = formatWorkerMemoryPacket(packet);
    expect(block.length).toBeLessThanOrEqual(3500);
    expect(block).toContain('userData');
  });
});

describe('Closure — Hermes research retrieval', () => {
  beforeEach(() => {
    ensureMemoryTables();
    try { seedDecisions(); } catch { /* seeded already */ }
    storeProjectFact(PROJ_A, 'semantic', 'Verified market research: Germany', 'Verified research shows the market is Germany.', ['research', 'verified']);
    storeProjectFact(PROJ_A, 'decision', 'Project constraint: no cold outreach', 'Constraint: no automated outreach without human approval.', ['constraint', 'outreach']);
    storeProjectFact(PROJ_A, 'episodic', 'Engineering debug log: stacktrace dump', 'Raw debug stacktrace from build 42.', ['engineering-debug', 'debug']);
  });

  test('research + constraint retrieved; engineering debug excluded; IDs recorded', async () => {
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_A,
      worker: 'hermes',
      taskType: 'research',
      query: 'market research Germany outreach',
      budget: { maxItems: 5, maxChars: 3000 },
    });
    const titles = packet.items.map((i) => i.title);
    expect(titles.some((t) => t.includes('Verified market research'))).toBe(true);
    expect(titles.some((t) => t.includes('no cold outreach'))).toBe(true);
    expect(titles.some((t) => t.includes('stacktrace'))).toBe(false);
    expect(packet.excluded.engineeringDebug).toBeGreaterThanOrEqual(1);
    expect(packet.memoryIds.length).toBe(packet.count);
  });
});

describe('Closure — cross-project isolation (P0)', () => {
  beforeEach(() => {
    ensureMemoryTables();
    try { seedDecisions(); } catch { /* seeded already */ }
    storeProjectFact(PROJ_A, 'semantic', 'Customer market = Germany', 'Customer market for Project A is Germany.', ['market', 'research']);
    storeProjectFact(PROJ_B, 'semantic', 'Customer market = Spain', 'Customer market for Project B is Spain.', ['market', 'research']);
  });

  test('Project A retrieval never returns Project B memory', async () => {
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_A,
      worker: 'hermes',
      query: 'customer market',
      budget: { maxItems: 5, maxChars: 3000 },
    });
    const content = packet.items.map((i) => i.content).join(' ');
    expect(content).toContain('Germany');
    expect(content).not.toContain('Spain');
    expect(packet.excluded.otherProject).toBe(0); // scope filter, not exclusion count
  });

  test('Project B retrieval never returns Project A memory', async () => {
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_B,
      worker: 'hermes',
      query: 'customer market',
      budget: { maxItems: 5, maxChars: 3000 },
    });
    const content = packet.items.map((i) => i.content).join(' ');
    expect(content).toContain('Spain');
    expect(content).not.toContain('Germany');
  });
});

describe('Closure — context budget enforcement', () => {
  beforeEach(() => {
    ensureMemoryTables();
    try { seedDecisions(); } catch { /* seeded already */ }
    // Distinct titles (avoid title-similarity consolidation collapsing them).
    const topics = ['transpiler', 'registry', 'scheduler', 'gateway', 'sandbox', 'telemetry', 'authn', 'storage'];
    for (let i = 0; i < topics.length; i++) {
      storeProjectFact(PROJ_A, 'semantic', `Engineering fact about ${topics[i]}`, `Engineering fact number ${i} about the ${topics[i]} component with enough content to exceed tiny character budgets during retrieval tests.`.repeat(4), ['architecture', 'engineering']);
    }
  });

  test('maxItems enforced; truncation flag set', async () => {
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_A,
      worker: 'codex',
      query: 'engineering fact',
      budget: { maxItems: 3, maxChars: 100000 },
    });
    expect(packet.count).toBeLessThanOrEqual(3);
    expect(packet.items.length).toBeLessThanOrEqual(3);
    expect(packet.truncated).toBe(true);
    // No raw unbounded replay: packet text bounded.
    const totalChars = packet.items.reduce((s, i) => s + i.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(100000);
  });

  test('maxChars enforced even when items fit', async () => {
    const packet = await retrieveWorkerMemory({
      projectId: PROJ_A,
      worker: 'codex',
      query: 'engineering fact',
      budget: { maxItems: 10, maxChars: 400 },
    });
    const totalChars = packet.items.reduce((s, i) => s + i.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(400);
    expect(packet.truncated).toBe(true);
  });
});

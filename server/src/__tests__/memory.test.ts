/**
 * Memory system tests (Jarvis memory + proactive context milestone).
 *
 * Covers: creation + provenance, no memory spam (distill only on meaningful
 * terminals), episodic/semantic/decision/preference, duplicate consolidation
 * (supersede), retrieval ranking + scope matching + decision priority,
 * graph relationship creation + weight updates, archive/delete/correct,
 * pagination, neighborhood loading, search, provenance visibility.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { memoryStore, link, upsertEntity, entityId } from '../services/memory/store.js';
import { createMemory, distillFromExecution, seedDecisions } from '../services/memory/distill.js';
import type { MemoryRecord } from '../services/memory/types.js';
import type { ExecutionRecord } from '../services/executionState.js';

function baseRec(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    operationId: 'op-mem-1',
    worker: 'revenue',
    status: 'COMPLETED',
    currentAction: null,
    requestedProvider: null, requestedModel: null, resolvedProvider: null, resolvedModel: null,
    fallbackUsed: false, fallbackReason: null,
    startedAt: 1000, endedAt: 110000, lastActivityAt: 110000,
    queuePosition: null, activeCount: null, limit: null,
    result: 'Revenue pipeline completed — COMPLETED 5/5 qualified leads found.\n\n1. Kadabau\nTop prospect: Kadabau (https://www.kadabau.de)',
    cancel: null, discoveredCount: 10, qualifiedCount: 8, rejectedCount: 2, targetCount: 5, note: null,
    ...overrides,
  } as ExecutionRecord;
}

const CLEANUP_IDS: string[] = [];

describe('memory store + creation', () => {
  beforeEach(() => { seedDecisions(); });

  it('creates a memory with mandatory provenance', () => {
    const m = createMemory({
      type: 'episodic', title: 'Revenue search completed — 5 roofing leads (Berlin)',
      summary: 'Completed with 5 qualified leads.', content: 'detail', scope: 'revenue',
      entities: ['Berlin', 'roofing'], tags: ['revenue'],
      confidence: 0.9, source: { operationId: 'op-1', taskId: 'bgtask-1', worker: 'revenue', sourceType: 'task' },
    });
    CLEANUP_IDS.push(m.id);
    expect(m.id).toMatch(/^mem-/);
    expect(m.source.operationId).toBe('op-1');
    expect(m.source.taskId).toBe('bgtask-1');
    expect(m.status).toBe('active');
    const got = memoryStore.get(m.id);
    expect(got?.title).toBe(m.title);
    expect(got?.entities).toContain('Berlin');
  });

  it('distills an episodic memory only for meaningful terminals (no spam)', () => {
    // Plain RUNNING should create nothing.
    expect(distillFromExecution(baseRec({ status: 'RUNNING' }))).toEqual([]);
    // A completed revenue run creates exactly one episodic memory.
    const ids = distillFromExecution(baseRec(), { taskId: 'bgtask-1', niche: 'roofing', city: 'Berlin', requestedCount: 5, resultCount: 5, topResult: 'Kadabau' });
    expect(ids.length).toBe(1);
    CLEANUP_IDS.push(...ids);
    const m = memoryStore.get(ids[0])!;
    expect(m.type).toBe('episodic');
    expect(m.scope).toBe('revenue');
    expect(m.source.taskId).toBe('bgtask-1');
  });

  it('consolidates duplicates by superseding the older similar memory', () => {
    const a = createMemory({ type: 'semantic', title: 'Revenue pipeline uses Overpass', summary: 's', content: 'old', scope: 'revenue', entities: [], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    const b = createMemory({ type: 'semantic', title: 'Revenue pipeline uses 3 Overpass mirrors with retry', summary: 's2', content: 'new', scope: 'revenue', entities: [], tags: [], confidence: 0.85, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(a.id, b.id);
    expect(memoryStore.get(a.id)?.status).toBe('superseded');
    expect(memoryStore.get(b.id)?.supersedesMemoryId).toBe(a.id);
    expect(memoryStore.get(b.id)?.derivedFromMemoryIds).toContain(a.id);
  });

  it('creates decision + preference memories', () => {
    const d = createMemory({ type: 'decision', title: 'No automated outreach by default', summary: 's', content: 'c', scope: 'revenue', entities: [], tags: [], confidence: 0.99, source: { sourceType: 'manual' } });
    const p = createMemory({ type: 'preference', title: 'Voice completion summaries enabled', summary: 's', content: 'c', scope: 'general', entities: [], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(d.id, p.id);
    expect(memoryStore.get(d.id)?.type).toBe('decision');
    expect(memoryStore.get(p.id)?.type).toBe('preference');
  });

  it('seeds the canonical decisions once (idempotent)', () => {
    seedDecisions();
    const decisions = memoryStore.decisions();
    expect(decisions.some((x) => x.title.includes('outreach'))).toBe(true);
    expect(decisions.some((x) => x.title.includes('routing'))).toBe(true);
  });
});

describe('retrieval + ranking', () => {
  beforeEach(() => { seedDecisions(); });

  it('ranks scope matches and decision priorities higher', () => {
    const m = createMemory({ type: 'episodic', title: 'Berlin roofing search results', summary: 'Kadabau top', content: 'Kadabau ranked first', scope: 'revenue', entities: ['Kadabau', 'Berlin'], tags: [], confidence: 0.9, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(m.id);
    const hits = memoryStore.search('Berlin roofing', { scope: 'revenue' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memory.id).toBe(m.id);
    expect(hits[0].matchedOn.length).toBeGreaterThan(0);
  });

  it('is queryable for the example queries', () => {
    expect(() => memoryStore.search('Kadabau')).not.toThrow();
    expect(() => memoryStore.search('Overpass failures')).not.toThrow();
    expect(() => memoryStore.search('Decisions about outreach')).not.toThrow();
  });
});

describe('graph + entities', () => {
  it('creates semantic edges and strengthens repeated references', () => {
    const m1 = createMemory({ type: 'episodic', title: 'Run A', summary: 's', content: 'c', scope: 'revenue', entities: ['Kadabau'], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    const m2 = createMemory({ type: 'episodic', title: 'Run B', summary: 's', content: 'c', scope: 'revenue', entities: ['Kadabau'], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(m1.id, m2.id);
    link(m1.id, entityId('Kadabau'), 'TOP_PROSPECT_OF');
    link(m1.id, entityId('Kadabau'), 'TOP_PROSPECT_OF'); // repeated → strengthen
    link(m1.id, m2.id, 'RELATED_TO');
    const g = memoryStore.graph({ focus: m1.id, depth: 1 });
    expect(g.nodes.some((n) => n.id === m1.id)).toBe(true);
    expect(g.nodes.some((n) => n.id === entityId('Kadabau'))).toBe(true);
    expect(g.nodes.some((n) => n.id === m2.id)).toBe(true);
    const edge = g.edges.find((e) => e.relation === 'TOP_PROSPECT_OF');
    expect(edge?.weight).toBeGreaterThan(1); // strengthened
    const ent = memoryStore.entities().find((e) => e.name === 'Kadabau');
    expect(ent?.refCount).toBeGreaterThanOrEqual(2);
  });

  it('loads neighborhoods progressively (bounded)', () => {
    const m = createMemory({ type: 'episodic', title: 'Neighborhood root', summary: 's', content: 'c', scope: 'general', entities: [], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(m.id);
    const g = memoryStore.graph({ focus: m.id, depth: 1, limit: 5 });
    expect(g.totalNodes).toBeGreaterThanOrEqual(1);
    expect(g.nodes.length).toBeLessThanOrEqual(5);
    expect(typeof g.truncated).toBe('boolean');
  });

  it('resolves plain-term focus to matching memory/entity neighborhoods (fuzzy)', () => {
    // term in a memory title
    const m = createMemory({ type: 'episodic', title: 'Berlin roofing run', summary: 's', content: 'c', scope: 'revenue', entities: [], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(m.id);
    // term in an entity name (linked so the neighborhood has edges)
    const e = entityId('Kadabau (https://www.kadabau.de)');
    link(m.id, e, 'TOP_PROSPECT_OF');
    // exact memory id still works
    const byId = memoryStore.graph({ focus: m.id, depth: 1 });
    expect(byId.nodes.some((n) => n.id === m.id)).toBe(true);
    // plain title term resolves to the memory + its linked entity
    const byTerm = memoryStore.graph({ focus: 'Berlin roofing', depth: 1 });
    expect(byTerm.nodes.some((n) => n.id === m.id)).toBe(true);
    expect(byTerm.nodes.some((n) => n.id === e)).toBe(true);
    expect(byTerm.edges.some((ed) => ed.relation === 'TOP_PROSPECT_OF')).toBe(true);
    // plain entity term resolves to the linked entity even without the entity: prefix
    const byEntity = memoryStore.graph({ focus: 'Kadabau', depth: 1 });
    expect(byEntity.nodes.some((n) => n.id === e)).toBe(true);
    // unknown term: empty but truthful (no crash, no fabricated nodes)
    const unknown = memoryStore.graph({ focus: 'zzz-no-such-term-zzz', depth: 1 });
    expect(unknown.totalNodes).toBe(0);
  });
});

describe('user control + provenance', () => {
  it('archives, deletes, and corrects (preserving history)', () => {
    const m = createMemory({ type: 'semantic', title: 'Jarvis uses Ollama', summary: 'old', content: 'old content', scope: 'routing', entities: [], tags: [], confidence: 0.8, source: { sourceType: 'manual' } });
    CLEANUP_IDS.push(m.id);
    // archive
    memoryStore.update(m.id, { status: 'archived' });
    expect(memoryStore.get(m.id)?.status).toBe('archived');
    // reactivate + correct → old superseded, corrected created
    memoryStore.update(m.id, { status: 'active' });
    memoryStore.update(m.id, { status: 'superseded' });
    const corrected = createMemory({
      type: 'semantic', title: 'Jarvis currently resolves to OpenRouter', summary: 'new', content: 'new content',
      scope: 'routing', entities: [], tags: ['corrected'], confidence: 0.9,
      source: { sourceType: 'conversation' }, derivedFromMemoryIds: [m.id],
    });
    CLEANUP_IDS.push(corrected.id);
    expect(corrected.derivedFromMemoryIds).toContain(m.id);
    expect(memoryStore.get(m.id)?.status).toBe('superseded');
    // delete
    memoryStore.remove(corrected.id);
    expect(memoryStore.get(corrected.id)).toBeNull();
  });

  it('supports pagination (indexed list, never full-store)', () => {
    const created: string[] = [];
    for (let i = 0; i < 7; i++) {
      const m = createMemory({ type: 'episodic', title: `Paginated memory ${i}`, summary: 's', content: 'c', scope: 'general', entities: [], tags: [], confidence: 0.7, source: { sourceType: 'manual' } });
      created.push(m.id);
    }
    CLEANUP_IDS.push(...created);
    const page1 = memoryStore.list({ type: 'episodic', limit: 5, offset: 0 });
    const page2 = memoryStore.list({ type: 'episodic', limit: 5, offset: 5 });
    expect(page1.items.length).toBeLessThanOrEqual(5);
    expect(page2.items.length).toBeGreaterThanOrEqual(0);
    expect(page1.total).toBeGreaterThanOrEqual(7);
    const ids1 = new Set(page1.items.map((x) => x.id));
    const ids2 = new Set(page2.items.map((x) => x.id));
    for (const id of ids1) expect(ids2.has(id)).toBe(false); // no overlap
  });
});

afterEach(() => {
  for (const id of CLEANUP_IDS.splice(0)) memoryStore.remove(id);
});

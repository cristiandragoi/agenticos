/**
 * Memory distillation (Jarvis memory + proactive context milestone).
 *
 * After a MEANINGFUL task completes, ask "is anything worth remembering?"
 * and create episodic/semantic/decision memories with mandatory provenance.
 * Consolidation: near-duplicates SUPERSEDE older memories instead of piling
 * up (no memory spam). No memory is created for every chat message.
 */
import { memoryStore, link, upsertEntity, entityId, titleSimilar } from './store.js';
import type { MemoryRecord, MemorySource, MemoryType } from './types.js';
import type { ExecutionRecord } from '../executionState.js';

export function newMemoryId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a memory with consolidation: similar active memory → superseded. */
export function createMemory(
  input: Pick<MemoryRecord, 'type' | 'title' | 'summary' | 'content' | 'scope' | 'entities' | 'tags' | 'confidence'> & { source: MemorySource; derivedFromMemoryIds?: string[]; verificationStatus?: MemoryRecord['verificationStatus'] },
): MemoryRecord {
  const now = Date.now();
  const m: MemoryRecord = {
    id: newMemoryId(),
    type: input.type,
    title: input.title,
    summary: input.summary,
    content: input.content,
    scope: input.scope,
    entities: input.entities || [],
    tags: input.tags || [],
    source: input.source,
    confidence: input.confidence ?? 0.6,
    createdAt: now,
    updatedAt: now,
    lastConfirmedAt: null,
    lastUsedAt: null,
    useCount: 0,
    status: 'active',
    supersedesMemoryId: null,
    derivedFromMemoryIds: input.derivedFromMemoryIds || [],
    pinned: false,
    // Closure: machine-created memories are NEVER automatically
    // 'human_confirmed'. Explicit human paths (POST /memories from the
    // human UI, /confirm) set 'human_confirmed'; verified worker facts set
    // 'verified'; everything else stays 'unverified'.
    verificationStatus: input.verificationStatus ?? 'unverified',
  };

  // Consolidation: find an active memory of the same type+scope with a
  // similar title → supersede it (keep history, never silently erase).
  const similar = memoryStore.list({ type: m.type, scope: m.scope, status: 'active', limit: 50 }).items
    .filter((x) => x.id !== m.id && titleSimilar(x.title, m.title) >= 0.6);
  if (similar.length) {
    const old = similar[0];
    memoryStore.update(old.id, { status: 'superseded' });
    m.supersedesMemoryId = old.id;
    m.derivedFromMemoryIds = [...m.derivedFromMemoryIds, old.id];
    link(m.id, old.id, 'SUPERSEDES');
  }
  memoryStore.create(m);
  for (const e of m.entities) upsertEntity(e, now);
  return m;
}

/** Distill a completed/terminal task into memories. Returns created ids. */
export function distillFromExecution(rec: ExecutionRecord, ctx: {
  taskId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  niche?: string | null;
  city?: string | null;
  requestedCount?: number | null;
  resultCount?: number | null;
  topResult?: string | null;
  detail?: string | null;
  /** GateRunner v1 (P19): verification truth — never distill unverified
   *  output as a successful milestone. */
  verificationState?: string | null;
  gateResults?: Array<{ gateId: string; status: string; passed: boolean }> | null;
} = {}): string[] {
  const created: string[] = [];
  const source: MemorySource = {
    operationId: rec.operationId,
    taskId: ctx.taskId ?? null,
    conversationId: ctx.conversationId ?? null,
    worker: rec.worker,
    sourceType: 'task',
  };
  // P1 — authoritative project association: when the task record carries a
  // real projectId, the distilled memory lands in that project's namespace
  // (scope 'project:<id>'). Without a project the previous global/general
  // behavior is kept. The project is NEVER inferred from prompt text — only
  // from the task's own association.
  const scopeFor = (fallback: string) => (ctx.projectId ? `project:${ctx.projectId}` : fallback);

  if (rec.status === 'COMPLETED' && rec.worker === 'revenue') {
    const count = ctx.resultCount ?? rec.qualifiedCount ?? null;
    const city = ctx.city ?? null;
    const niche = ctx.niche ?? null;
    const top = ctx.topResult ?? null;
    const entities = [city ? `Berlin` : null, niche ? niche : null, top ? top : null].filter(Boolean) as string[];
    const m = createMemory({
      type: 'episodic',
      title: `Revenue search completed — ${count ?? '?'} qualified ${niche ?? ''} leads${city ? ` (${city})` : ''}`.trim(),
      summary: `A revenue search for ${niche ?? 'business'}${city ? ` in ${city}` : ''} completed with ${count ?? 0} qualified lead(s).`,
      content: `Completed under operation ${rec.operationId}${ctx.taskId ? ` (task ${ctx.taskId})` : ''}${ctx.projectId ? ` for project ${ctx.projectId}` : ''}. Requested ${ctx.requestedCount ?? '?'}, returned ${count ?? 0} qualified lead(s).${top ? ` Top prospect: ${top}.` : ''} No outreach was performed (dry-run by default).`,
      scope: scopeFor('revenue'),
      entities,
      tags: ['revenue', 'search', niche ?? 'business', city ?? 'city', ctx.projectId ? 'project' : null].filter(Boolean) as string[],
      confidence: 0.9,
      source,
    });
    created.push(m.id);
    link(m.id, entityId(top || 'unknown-prospect'), 'TOP_PROSPECT_OF');
    // Link the no-outreach decision (decision memory consulted by later runs).
    const decision = memoryStore.list({ type: 'decision', scope: ctx.projectId ? `project:${ctx.projectId}` : 'revenue', status: 'active', limit: 10 }).items
      .find((d) => d.title.toLowerCase().includes('outreach'));
    if (decision) link(m.id, decision.id, 'DECIDED_IN');
    if (top) { upsertEntity(top, Date.now(), 'company'); link(m.id, entityId(top), 'MENTIONS_ENTITY'); }
  } else if (rec.status === 'COMPLETED' && rec.worker === 'codex') {
    // P19 — verification truth: a completed goal whose required gates FAILED
    // is a blocker, not a successful milestone.
    if (ctx.verificationState === 'failed') {
      const gates = (ctx.gateResults || []).filter((g) => g.status === 'failed').map((g) => g.gateId).join(', ');
      const m = createMemory({
        type: 'episodic',
        title: `CodeX work blocked by verification — ${gates || 'gates failed'}`,
        summary: `CodeX produced work but verification failed${ctx.projectId ? ` for project ${ctx.projectId}` : ''}.`,
        content: `CodeX goal ${rec.operationId} completed execution but required gate(s) ${gates || 'unknown'} failed. Task ${ctx.taskId ?? rec.operationId} was NOT completed.${ctx.detail ? `\nReason: ${ctx.detail.slice(0, 160)}` : ''}`,
        scope: scopeFor('codex'),
        entities: ctx.projectId ? [ctx.projectId] : [],
        tags: ['codex', 'blocker', 'verification', ctx.projectId ? 'project' : null].filter(Boolean) as string[],
        confidence: 0.95,
        source,
      });
      created.push(m.id);
      return created;
    }
    const verified = ctx.verificationState === 'passed' || ctx.verificationState === 'skipped' || !ctx.verificationState;
    if (!verified) return created; // pending/unknown — do not distill as success
    const gateNote = (ctx.gateResults || []).filter((g) => g.status === 'passed').map((g) => g.gateId).join(', ');
    const m = createMemory({
      type: 'episodic',
      title: 'CodeX inspection completed',
      summary: `CodeX inspection finished under ${rec.operationId}${ctx.projectId ? ` for project ${ctx.projectId}` : ''}.`,
      content: ctx.resultCount != null
        ? `CodeX found ${ctx.resultCount} issue(s) during the inspection. No files were changed.${ctx.projectId ? ` Project: ${ctx.projectId}` : ''}${gateNote ? ` Verification: passed (${gateNote}).` : ''}`
        : `CodeX completed a read-only inspection.${ctx.projectId ? ` Project: ${ctx.projectId}` : ''}${gateNote ? ` Verification: passed (${gateNote}).` : ''}`,
      scope: scopeFor('codex'),
      entities: ctx.projectId ? [ctx.projectId] : [],
      tags: ['codex', 'inspection', ctx.projectId ? 'project' : null].filter(Boolean) as string[],
      confidence: 0.85,
      source,
    });
    created.push(m.id);
  } else if (rec.status === 'FAILED') {
    const m = createMemory({
      type: 'episodic',
      title: `Task failed — ${rec.worker}`,
      summary: `A ${rec.worker} task failed${ctx.detail ? `: ${ctx.detail.slice(0, 120)}` : ''}.`,
      content: `Task ${ctx.taskId ?? rec.operationId} failed under worker ${rec.worker}.${ctx.detail ? `\nReason: ${ctx.detail}` : ''}${ctx.projectId ? `\nProject: ${ctx.projectId}` : ''}`,
      scope: ctx.projectId ? scopeFor('general') : rec.worker === 'revenue' ? 'revenue' : 'general',
      entities: ctx.projectId ? [ctx.projectId] : [],
      tags: ['failure', rec.worker, ctx.projectId ? 'project' : null].filter(Boolean) as string[],
      confidence: 0.95,
      source,
    });
    created.push(m.id);
  } else if (rec.status === 'CANCELLED') {
    const m = createMemory({
      type: 'episodic',
      title: `Task cancelled — ${rec.worker}`,
      summary: `A ${rec.worker} task was cancelled by the user.`,
      content: `Task ${ctx.taskId ?? rec.operationId} was cancelled.${ctx.projectId ? `\nProject: ${ctx.projectId}` : ''}`,
      scope: scopeFor('general'),
      entities: ctx.projectId ? [ctx.projectId] : [],
      tags: ['cancelled', rec.worker, ctx.projectId ? 'project' : null].filter(Boolean) as string[],
      confidence: 0.9,
      source,
    });
    created.push(m.id);
  }
  return created;
}

/** Seed the canonical AgenticOS decisions (idempotent — only if absent). */
export function seedDecisions(): void {
  const existing = memoryStore.list({ type: 'decision', limit: 100 });
  if (existing.total > 0) return;
  const now = Date.now();
  const seeds: Array<Pick<MemoryRecord, 'type' | 'title' | 'summary' | 'content' | 'scope' | 'entities' | 'tags' | 'confidence'>> = [
    {
      type: 'decision',
      title: 'No automated outreach by default',
      summary: 'Revenue runs never contact anyone without explicit human approval.',
      content: 'The revenue pipeline is dry-run by default: nothing is contacted, published, or deployed unless a human explicitly approves an outreach step.',
      scope: 'revenue',
      entities: ['revenue'],
      tags: ['outreach', 'approval', 'safety'],
      confidence: 0.99,
    },
    {
      type: 'decision',
      title: 'Safe read-only actions may auto-approve',
      summary: 'Read-only actions in the SAFE class proceed without prompting.',
      content: 'Actions classified as SAFE (read-only, no side effects) auto-approve; DESTRUCTIVE actions always prompt for approval.',
      scope: 'general',
      entities: ['safety'],
      tags: ['approval', 'safety'],
      confidence: 0.95,
    },
    {
      type: 'decision',
      title: 'Jarvis is the main conversational interface',
      summary: 'Jarvis remains the primary chat surface; workers execute behind it.',
      content: 'Jarvis is the main conversational interface; CodeX/Hermes/revenue workers execute tasks and return results into the Jarvis conversation.',
      scope: 'general',
      entities: ['jarvis'],
      tags: ['interface', 'architecture'],
      confidence: 0.98,
    },
    {
      type: 'decision',
      title: 'Do not redesign routing unless there is a regression',
      summary: 'Routing architecture stays as-is unless a concrete regression appears.',
      content: 'Jarvis routing, canonical execution state, provider/model routing, and worker architecture are stable; changes only on verified regressions.',
      scope: 'routing',
      entities: ['routing'],
      tags: ['architecture', 'routing'],
      confidence: 0.97,
    },
  ];
  for (const s of seeds) {
    memoryStore.create({
      id: newMemoryId(), ...s,
      source: { sourceType: 'system' },
      createdAt: now, updatedAt: now, lastConfirmedAt: null, lastUsedAt: null,
      useCount: 0, status: 'active', supersedesMemoryId: null, derivedFromMemoryIds: [], pinned: false,
    });
  }
}

export { MemoryType };

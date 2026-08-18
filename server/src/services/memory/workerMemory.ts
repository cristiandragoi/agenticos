/**
 * workerMemory.ts — canonical worker↔memory integration (closure).
 *
 * Provides:
 *  1. promoteHermesCandidates — promote verified Hermes memory candidates into
 *     canonical memoryStore with the FULL provenance chain
 *     runId → resultId → verificationId → candidateId → memoryId.
 *     Candidates are persisted BEFORE verification and never silently
 *     discarded: FAIL / NEEDS_REVISION / NOT_PROVEN candidates remain
 *     pending/needs_review with their verification link.
 *  2. retrieveWorkerMemory — bounded, worker-relevant Project Memory retrieval
 *     for CodeX (engineering) and Hermes (research/planning) with strict
 *     context budget and recorded memory IDs.
 *
 * Rules enforced here (closure):
 *   - Project isolation is a HARD filter: only scope 'project:<id>' memories
 *     are candidates unless explicitly allowed.
 *   - Verification gate: only PASS verdicts promote.
 *   - Budget: max items + max chars enforced; truncation flag reported.
 *   - Relevance: engineering vs research/planning type/tag allowlists.
 *   - No raw execution history, no unrelated scopes.
 */

import { memoryStore } from './store.js';
import { createMemory, newMemoryId } from './distill.js';
import type { MemoryCandidate, MemoryRecord, MemoryType } from './types.js';

const logger = {
  info: (...args: any[]) => { try { console.log('[WorkerMemory]', ...args); } catch { /* noop */ } },
  warn: (...args: any[]) => { try { console.warn('[WorkerMemory]', ...args); } catch { /* noop */ } },
};

// ── Candidate IDs ──────────────────────────────────────────────────────────
export function newCandidateId(): string {
  return `cand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface HermesCandidateInput {
  key: string;
  value: string;
  category?: string;
}

export interface PromoteHermesCandidatesInput {
  projectId: string | null;
  sourceRunId: string | null;
  sourceResultId: string | null;
  verificationId: string | null;
  verificationVerdict: string | null;
  candidates: HermesCandidateInput[];
  /** Optional scope override (default: project:<projectId> or 'general'). */
  scope?: string;
}

export interface PromotionOutcome {
  candidateId: string;
  key: string;
  status: MemoryCandidate['status'];
  memoryId: string | null;
  reason?: string;
}

/**
 * Persist Hermes memory candidates with their verification link, then promote
 * ONLY candidates whose verification verdict is PASS. FAIL / NEEDS_REVISION /
 * NOT_PROVEN candidates stay in the candidate store (pending or needs_review)
 * — they are never silently discarded and never promoted as verified facts.
 */
export async function promoteHermesCandidates(
  input: PromoteHermesCandidatesInput,
): Promise<{ candidates: PromotionOutcome[]; promotedCount: number }> {
  const outcomes: PromotionOutcome[] = [];
  let promotedCount = 0;
  const list = Array.isArray(input.candidates) ? input.candidates : [];
  for (const c of list) {
    if (!c || typeof c.key !== 'string' || typeof c.value !== 'string') continue;
    const id = newCandidateId();
    const now = Date.now();
    const verdict = input.verificationVerdict || 'NOT_PROVEN';
    const canPromote = verdict === 'PASS';
    const status: MemoryCandidate['status'] = canPromote ? 'promoted' : (verdict === 'FAIL' ? 'rejected' : 'needs_review');

    // 1. Persist the candidate ALWAYS (never discard).
    memoryStore.createCandidate({
      id,
      projectId: input.projectId ?? null,
      sourceWorker: 'hermes',
      sourceRunId: input.sourceRunId ?? null,
      sourceResultId: input.sourceResultId ?? null,
      verificationId: input.verificationId ?? null,
      verificationVerdict: verdict,
      key: c.key,
      category: c.category || 'general',
      value: c.value,
      status,
      memoryId: null,
      createdAt: now,
      updatedAt: now,
      promotedAt: null,
    });

    if (!canPromote) {
      outcomes.push({
        candidateId: id,
        key: c.key,
        status,
        memoryId: null,
        reason: `verification ${verdict} — candidate kept, not promoted`,
      });
      continue;
    }

    // 2. Promote PASS → canonical memory with provenance.
    const scope = input.scope || (input.projectId ? `project:${input.projectId}` : 'general');
    const memory = createMemory({
      type: 'semantic',
      title: c.key.slice(0, 120),
      summary: c.value.slice(0, 300),
      content: c.value,
      scope,
      entities: input.projectId ? [input.projectId] : [],
      tags: ['hermes', 'candidate', 'promoted', c.category || 'general', input.projectId ? 'project' : null].filter(Boolean) as string[],
      confidence: 0.9,
      source: {
        sourceType: 'task',
        worker: 'hermes',
        taskId: null,
        conversationId: null,
        operationId: input.sourceRunId ?? undefined,
        artifactPath: null,
      },
    });
    // Mark the canonical record as machine-verified (not human_confirmed).
    memoryStore.update(memory.id, { verificationStatus: 'verified' });

    // 3. Link candidate → memory.
    memoryStore.updateCandidate(id, {
      status: 'promoted',
      memoryId: memory.id,
      promotedAt: now,
    });

    promotedCount++;
    outcomes.push({ candidateId: id, key: c.key, status: 'promoted', memoryId: memory.id });
  }

  logger.info(`promoteHermesCandidates verdict=${input.verificationVerdict} total=${list.length} promoted=${promotedCount}`);
  return { candidates: outcomes, promotedCount };
}

// ── Worker memory retrieval (CodeX engineering / Hermes research) ──────────

export interface WorkerMemoryBudget {
  maxItems: number;
  maxChars: number;
}

export interface RetrieveWorkerMemoryInput {
  projectId: string | null;
  worker: 'codex' | 'hermes';
  taskType?: string;
  query: string;
  budget?: Partial<WorkerMemoryBudget>;
  /** Include global (non-project) memories when project has no hits. */
  includeGlobalFallback?: boolean;
}

export interface WorkerMemoryPacket {
  items: Array<{ id: string; type: MemoryType; title: string; content: string; tags: string[] }>;
  memoryIds: string[];
  count: number;
  truncated: boolean;
  budget: WorkerMemoryBudget;
  usedScope: string | null;
  excluded: { engineeringDebug: number; marketing: number; recruiting: number; otherProject: number };
}

// Engineering-relevant memory (CodeX): architecture decisions, technical
// constraints, repository conventions, deployment rules, verified bugs/fixes.
// NOTE (runtime proof): 'project' is intentionally NOT a positive tag — every
// project-scoped memory carries it, so it conveys no domain relevance and
// would let marketing/general memories leak into engineering context.
const ENGINEERING_TYPES: MemoryType[] = ['decision', 'semantic', 'episodic'];
const ENGINEERING_TAG_POSITIVE = [
  'architecture', 'constraint', 'convention', 'deployment', 'bug', 'fix', 'verification',
  'engineering', 'technical', 'codex', 'runtime', 'repository', 'build', 'test',
];
const ENGINEERING_TAG_NEGATIVE = ['marketing', 'recruiting', 'affiliate', 'audience', 'sales', 'outreach', 'research', 'hermes'];

// Research/planning-relevant memory (Hermes): verified research, prior
// decisions, project constraints, risks, entities, success metrics, assumptions.
const HERMES_TYPES: MemoryType[] = ['decision', 'semantic', 'preference'];
const HERMES_TAG_POSITIVE = [
  'research', 'decision', 'constraint', 'risk', 'metric', 'assumption', 'planning',
  'strategy', 'market', 'entity', 'verified', 'outreach',
];
const HERMES_TAG_NEGATIVE = ['engineering-debug', 'debug', 'codex', 'build-log', 'stacktrace'];

function tagList(m: MemoryRecord): string[] {
  return Array.isArray(m.tags) ? m.tags : [];
}

function tokenScore(query: string, m: MemoryRecord): number {
  const tokens = (query || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
  const full = `${m.title} ${m.summary} ${m.content} ${tagList(m).join(' ')}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (full.includes(t)) hits++;
  return hits;
}

/**
 * Retrieve bounded, worker-relevant Project Memory.
 *
 * HARD isolation: only memories scoped to the active project are eligible
 * (global fallback only when includeGlobalFallback and the project has no
 * hits). Worker allowlists filter types/tags; negative tags (marketing,
 * recruiting, engineering-debug) are excluded. Exact memory IDs are returned
 * so callers can record CODEX_MEMORY_RETRIEVED / HERMES_MEMORY_RETRIEVED.
 */
export async function retrieveWorkerMemory(
  input: RetrieveWorkerMemoryInput,
): Promise<WorkerMemoryPacket> {
  const budget: WorkerMemoryBudget = {
    maxItems: input.budget?.maxItems ?? 6,
    maxChars: input.budget?.maxChars ?? 1400,
  };
  const empty: WorkerMemoryPacket = {
    items: [], memoryIds: [], count: 0, truncated: false, budget,
    usedScope: input.projectId ? `project:${input.projectId}` : null,
    excluded: { engineeringDebug: 0, marketing: 0, recruiting: 0, otherProject: 0 },
  };
  if (!input.projectId) return empty;

  const scope = `project:${input.projectId}`;
  const isCodex = input.worker === 'codex';
  const allowedTypes = isCodex ? ENGINEERING_TYPES : HERMES_TYPES;
  const posTags = isCodex ? ENGINEERING_TAG_POSITIVE : HERMES_TAG_POSITIVE;
  const negTags = isCodex ? ENGINEERING_TAG_NEGATIVE : HERMES_TAG_NEGATIVE;

  // Pull active project-scoped memories (bounded base query; budget applies below).
  const base = memoryStore.list({ scope, status: 'active', limit: 200 }).items;

  const scored: Array<{ m: MemoryRecord; score: number }> = [];
  const excluded = { engineeringDebug: 0, marketing: 0, recruiting: 0, otherProject: 0 };

  for (const m of base) {
    if (m.scope !== scope) { excluded.otherProject++; continue; }
    const tags = tagList(m);
    // Negative exclusions by worker domain — evaluated BEFORE type filtering so
    // exclusion counters are truthful. The match checks the FULL text (title +
    // summary + content + tags), NOT tags alone: a worker-LLM candidate may be
    // misclassified (e.g. a marketing fact labeled category 'constraint'), so
    // tag-only detection would leak it into engineering/research context.
    // (Runtime proof: Hermes labeled 'primary_affiliate_audience' a 'constraint';
    // tags said constraint, text said affiliate/audience.)
    const fullText = `${m.title} ${m.summary || ''} ${m.content || ''} ${tags.join(' ')}`;
    if (isCodex && /marketing|recruiting|affiliate|audience|sales|outreach|\bresearch\b/i.test(fullText)) {
      if (/marketing|affiliate|audience|sales/i.test(fullText)) excluded.marketing++;
      if (/recruiting/i.test(fullText)) excluded.recruiting++;
      continue;
    }
    if (!isCodex && /engineering-debug|\bdebug\b|build-log|stacktrace/i.test(fullText)) {
      excluded.engineeringDebug++;
      continue;
    }
    if (!allowedTypes.includes(m.type)) continue;
    // Positive relevance: tag match OR query token overlap.
    const tagHit = tags.some((t) => posTags.some((p) => t.includes(p)));
    const tok = tokenScore(input.query, m);
    if (!tagHit && tok === 0) continue;
    scored.push({ m, score: tagHit ? 2 + tok : tok });
  }

  scored.sort((a, b) => b.score - a.score);

  const items: WorkerMemoryPacket['items'] = [];
  let totalChars = 0;
  let truncated = false;

  for (const { m } of scored) {
    const text = (m.content || m.summary || m.title).trim();
    if (!text) continue;
    if (items.length >= budget.maxItems) { truncated = true; continue; }
    if (totalChars + text.length > budget.maxChars) { truncated = true; continue; }
    items.push({ id: m.id, type: m.type, title: m.title, content: text, tags: tagList(m) });
    totalChars += text.length;
  }

  // Truncation truth: if MORE relevant items exist beyond what the budget
  // admitted (either the item cap or the char cap stopped us), the packet is
  // truncated. A packet that fit entirely is NOT truncated.
  const admittedIds = new Set(items.map((i) => i.id));
  const anyDropped = scored.some(({ m }) => !admittedIds.has(m.id));
  if (anyDropped) truncated = true;

  // Global fallback ONLY when explicitly allowed and no project hits found.
  if (items.length === 0 && input.includeGlobalFallback) {
    const globals = memoryStore.list({ status: 'active', limit: 50 }).items
      .filter((m) => !m.scope.startsWith('project:') && allowedTypes.includes(m.type));
    for (const m of globals) {
      const tags = tagList(m);
      if (isCodex && tags.some((t) => /marketing|recruiting|affiliate/.test(t))) continue;
      if (!isCodex && tags.some((t) => /engineering-debug|debug|build-log/.test(t))) continue;
      const text = (m.content || m.summary || m.title).trim();
      if (!text) continue;
      if (items.length >= budget.maxItems) { truncated = true; break; }
      if (totalChars + text.length > budget.maxChars) { truncated = true; break; }
      items.push({ id: m.id, type: m.type, title: m.title, content: text, tags });
      totalChars += text.length;
    }
  }

  return {
    items,
    memoryIds: items.map((i) => i.id),
    count: items.length,
    truncated,
    budget,
    usedScope: scope,
    excluded,
  };
}

/** Format a bounded prompt-injection block from a retrieval packet. */
export function formatWorkerMemoryPacket(packet: WorkerMemoryPacket): string {
  if (!packet || packet.items.length === 0) return '';
  const lines = packet.items.map(
    (i) => `- [${i.type}] ${i.title}: ${i.content}`,
  );
  return `\n\nRelevant Project Memory (${packet.count} item(s), ${packet.truncated ? 'truncated to budget' : 'within budget'}):\n${lines.join('\n')}`;
}

/** Record the exact retrieved memory IDs for an execution (event/log). */
export function recordWorkerMemoryRetrieval(opts: {
  worker: string;
  projectId: string | null;
  taskId?: string | null;
  runId?: string | null;
  goalId?: string | null;
  packet: WorkerMemoryPacket;
}): void {
  const { packet } = opts;
  const eventName = opts.worker === 'codex' ? 'CODEX_MEMORY_RETRIEVED' : 'HERMES_MEMORY_RETRIEVED';
  logger.info(JSON.stringify({
    event: eventName,
    projectId: opts.projectId,
    taskId: opts.taskId ?? null,
    runId: opts.runId ?? null,
    goalId: opts.goalId ?? null,
    memoryIds: packet.memoryIds,
    count: packet.count,
    truncated: packet.truncated,
  }));
}

export { logger };

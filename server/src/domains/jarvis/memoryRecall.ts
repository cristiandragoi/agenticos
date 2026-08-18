/**
 * Jarvis memory recall + decision statements (memory milestone).
 *
 * RECALL: "What happened in our last Berlin roofing search?" → answered from
 * stored provenance (no new run required). DECISION: "Never send outreach
 * automatically unless I explicitly approve it." → stored as a decision
 * memory + a "Remembered:" transparency reply. Current runtime truth always
 * overrides stored memory (the user's active configuration wins).
 */
import { memoryStore } from '../../services/memory/store.js';
import { createMemory } from '../../services/memory/distill.js';
import type { MemoryRecord } from '../../services/memory/types.js';

const RECALL_RE = /\b(what happened|what did we (do|decide|find|learn)|do you remember|do we remember|what do you remember|what did (i|you|we) (say|decide|do) about|whats? our (last|most recent)|our last .{0,60} (search|run|inspection|task|decision))\b/i;

const PRIOR_CONVERSATION_RE = /^(what did (i|you) (just |recently )?(say|ask|tell)|what was (my|your) (last|previous) (message|question|prompt)|what did i ask you)/i;

const DECISION_STATEMENT_RE = /\b(never .{0,80}(unless|without|automatically)|always (ask|require|confirm|get approval)|do not .{0,80} by default|as a rule|we? decided (that|to))\b/i;

export function isMemoryRecall(prompt: string): boolean {
  if (PRIOR_CONVERSATION_RE.test(prompt.trim())) return false;
  return RECALL_RE.test(prompt);
}

export function isDecisionStatement(prompt: string): boolean {
  return DECISION_STATEMENT_RE.test(prompt);
}

function relTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function provenanceLine(m: Pick<MemoryRecord, 'title' | 'createdAt' | 'source'>): string {
  const src = m.source || {};
  const parts: string[] = [];
  if (src.taskId) parts.push(`task ${src.taskId}`);
  if (src.operationId) parts.push(`operation ${src.operationId}`);
  if (src.worker) parts.push(`worker ${src.worker}`);
  return parts.length ? `(source: ${parts.join(', ')}, ${relTime(m.createdAt)})` : `(${relTime(m.createdAt)})`;
}

/** Answer a recall question from stored memory + provenance. */
export async function handleMemoryRecall(prompt: string, projectId?: string | null): Promise<string> {
  const terms = prompt
    .replace(/[^a-z0-9 ]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !['what', 'happened', 'remember', 'remembered', 'about', 'from', 'with', 'your', 'have', 'last', 'search', 'run', 'inspection', 'task', 'decision', 'find', 'doing', 'were', 'the', 'did', 'our', 'you'].includes(t.toLowerCase()))
    .slice(0, 4);
  const q = terms.join(' ');

  // Project-scoped recall first when an active project exists (P6/P10) —
  // cross-project contamination is avoided by the hard scope filter.
  if (projectId) {
    const { retrieveProjectMemory } = await import('./projectMemory.js');
    const scoped = retrieveProjectMemory(projectId, q, { limit: 3 });
    if (scoped.hits.length) {
      const lines = ['I remember (from this project):'];
      for (const hit of scoped.hits.slice(0, 3)) {
        lines.push(`• ${hit.memory.title} — ${hit.memory.summary} ${provenanceLine(hit.memory)}`);
      }
      return lines.join('\n');
    }
  }

  const episodic = q ? memoryStore.search(q, { type: 'episodic', status: 'active', limit: 3 }) : [];
  const decisions = q ? memoryStore.search(q, { type: 'decision', status: 'active', limit: 2 }) : [];
  const recent = !episodic.length ? memoryStore.timeline({ limit: 5 }).filter((m) => m.type === 'episodic') : [];

  const lines: string[] = [];
  if (episodic.length) {
    lines.push('I remember:');
    for (const hit of episodic.slice(0, 3)) {
      lines.push(`• ${hit.memory.title} — ${hit.memory.summary} ${provenanceLine(hit.memory)}`);
    }
  } else if (recent.length) {
    lines.push('From what I remember:');
    for (const m of recent.slice(0, 3)) {
      lines.push(`• ${m.title} — ${m.summary} ${provenanceLine(m)}`);
    }
  } else {
    lines.push('I do not have a memory matching that yet.');
  }
  if (decisions.length) {
    lines.push('\nRelevant decisions:');
    for (const d of decisions.slice(0, 2)) {
      lines.push(`• ${d.memory.title} (${d.memory.status === 'active' ? 'active' : d.memory.status}) ${provenanceLine(d.memory)}`);
    }
  }
  return lines.join('\n');
}

/** Store a user-stated decision + reply with the transparency indicator. */
export async function handleDecisionStatement(prompt: string, projectId?: string | null): Promise<string> {
  const p = prompt.trim();
  const isOutreach = /outreach|contact|email|cold|prospect/i.test(p);
  const title = p.replace(/\.$/, '');
  // Project-scoped decisions (P5): when an active project exists the decision
  // is stored in that project's namespace, not the general bucket.
  const scope = projectId ? `project:${projectId}` : isOutreach ? 'revenue' : 'general';
  const tags = ['decision', projectId ? 'project' : isOutreach ? 'outreach' : 'general'];
  const m = createMemory({
    type: 'decision',
    title: title.slice(0, 120),
    summary: title.slice(0, 200),
    content: `User decision: ${p}\nRecorded from conversation${projectId ? ` for project ${projectId}` : ''}; this decision is consulted before future ${isOutreach ? 'revenue/outreach' : ''} actions.`,
    scope,
    entities: isOutreach ? ['outreach'] : projectId ? [projectId] : [],
    tags,
    confidence: 0.95,
    source: { sourceType: 'conversation' },
  });
  return `Remembered: ${title}.\n(decision memory, scope ${m.scope}, confidence ${m.confidence.toFixed(2)})`;
}

/**
 * STORE-memory semantics (user-acceptance stabilization):
 *
 * "Please remember that X." / "Remember that X." / "From now on remember X."
 * are STORE requests — the fact becomes a persistent PREFERENCE memory.
 * This is deliberately distinct from RECALL ("What do you remember about
 * X?"), which queries stored memory, and from same-conversation history
 * (which the direct-chat LLM receives automatically).
 *
 * The acknowledgment is truthful: it says the fact was saved to memory and
 * is available in future conversations — no blurred "between conversations"
 * claims when only history was stored.
 */
const STORE_PREFIX_RE = /^(please\s+|from now on\s+|can you\s+|try to\s+|hey jarvis[\s,]*|jarvis[\s,]*)*/i;
const STORE_VERB_RE = /^\s*(remember|store|save|note|keep in mind|note down)\s*(that\s+)?/i;

const PREFERENCE_DIRECTIVE_RE = /\b(when my instruction is|jarvis should behave|resolve words such as|my main agentic os goal is|my main goal for agentic os|do not delegate simple conversation|always infer from|never ask me to rephrase unless|my working preference is|as my working preference)\b/i;

export function isMemoryStore(prompt: string): boolean {
  const p = prompt.trim();
  if (!p || p.length < 10) return false;
  // RECALL forms are never STORE.
  if (/\b(do you remember|do we remember|what do you remember|what did i|what happened|whats? our|did you remember|what is my main goal|what are my preferences)\b/i.test(p)) return false;
  // Direct questions are not store
  if (/^(do|did|can|could|will|would|are|is|have|has|what|why|who|where|when|how)\b/i.test(p) && /\?$/.test(p)) return false;
  return /\b(remember|store|save|note down|keep in mind)\b/i.test(p) || PREFERENCE_DIRECTIVE_RE.test(p);
}

export function handleMemoryStore(prompt: string, projectId?: string | null): { reply: string; memoryId: string } {
  const p = prompt.trim().replace(/[.!?]+$/, '');
  let fact = p.replace(STORE_PREFIX_RE, '').replace(STORE_VERB_RE, '').trim();
  if (!fact || fact.length < 2) fact = p;
  // Drop a trailing conversational tail ("...for this conversation", "...ok?")
  fact = fact.replace(/\s+(for|in)\s+(this|the|our)\s+(conversation|chat|session)\b.*$/i, '').trim();
  const title = fact.slice(0, 120);
  // Project-scoped store (P5): when an active project exists the remembered
  // fact lands in the project namespace, not the user bucket.
  const scope = projectId ? `project:${projectId}` : 'user';
  const isDecision = /^(never|always|do not|as a rule|we decided)\b/i.test(fact);
  const type = isDecision ? 'decision' : 'preference';
  const tags = [type, 'working_rule', projectId ? 'project' : 'user'];
  const m = createMemory({
    type,
    title,
    summary: fact.slice(0, 200),
    content: fact,
    scope,
    entities: projectId ? [projectId] : ['agenticos'],
    tags,
    confidence: 0.95,
    source: { sourceType: 'conversation' },
  });
  return {
    reply: `I've saved that to memory: ${fact}. (${type} memory, scope ${scope} — active across conversations)`,
    memoryId: m.id,
  };
}

/** Relevant active preferences/decisions for the direct-chat prompt
 *  (relevance-gated persistent-memory injection).
 *  Combines durable user preferences/goals and prompt-specific semantic hits. */
export function retrieveRelevantPreferences(prompt: string, limit = 5): { type: string; title: string; content: string }[] {
  try {
    const listRes = memoryStore.list({ status: 'active', limit: 100 });
    const allActive = listRes.items.filter(
      (m) =>
        (m.type === 'preference' || m.type === 'decision' || m.type === 'semantic') &&
        m.status === 'active'
    );

    const promptTokens = (prompt || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/gi, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !['what', 'is', 'are', 'the', 'my', 'your', 'please', 'remember', 'about', 'from', 'with', 'and', 'how', 'have', 'asked', 'tell'].includes(t));

    const scored = allActive.map((m) => {
      let score = 0;
      // Baseline priority: user and general preferences/decisions are durable foundations
      if (m.scope === 'user' || m.scope === 'general') {
        score += 1.0;
        if (m.type === 'preference') score += 0.5;
        if (m.type === 'decision') score += 0.4;
      }

      const fullText = `${m.title} ${m.summary} ${m.content} ${(m.tags || []).join(' ')}`.toLowerCase();
      let matchCount = 0;
      for (const tok of promptTokens) {
        if (fullText.includes(tok)) matchCount++;
      }
      score += matchCount * 2.0;
      if (m.pinned) score += 1.5;

      return { m, score };
    });

    // Also query FTS for any prompt-specific hits across all memory records
    if (promptTokens.length > 0) {
      const q = promptTokens.slice(0, 5).join(' ');
      const searchHits = memoryStore.search(q, { status: 'active', limit: 5 });
      for (const hit of searchHits) {
        const existing = scored.find((s) => s.m.id === hit.memory.id);
        if (existing) {
          existing.score += hit.score;
        } else {
          scored.push({ m: hit.memory, score: hit.score });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const selected: { type: string; title: string; content: string }[] = [];
    let totalChars = 0;

    for (const item of scored) {
      if (item.score < 0.5) continue;
      const m = item.m;
      const cleanContent = (m.content || m.summary || m.title).trim();
      if (totalChars + cleanContent.length > 1800) continue;
      selected.push({
        type: m.type,
        title: m.title,
        content: cleanContent
      });
      totalChars += cleanContent.length;
      if (selected.length >= limit) break;
    }

    return selected;
  } catch {
    return [];
  }
}

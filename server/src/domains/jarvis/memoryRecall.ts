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

const DECISION_STATEMENT_RE = /\b(never .{0,80}(unless|without|automatically)|always (ask|require|confirm|get approval)|do not .{0,80} by default|as a rule|we? decided (that|to))\b/i;

export function isMemoryRecall(prompt: string): boolean {
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
export async function handleMemoryRecall(prompt: string): Promise<string> {
  const terms = prompt
    .replace(/[^a-z0-9 ]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !['what', 'happened', 'remember', 'remembered', 'about', 'from', 'with', 'your', 'have', 'last', 'search', 'run', 'inspection', 'task', 'decision', 'find', 'doing', 'were', 'the', 'did', 'our', 'you'].includes(t.toLowerCase()))
    .slice(0, 4);
  const q = terms.join(' ');

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
export async function handleDecisionStatement(prompt: string): Promise<string> {
  const p = prompt.trim();
  const isOutreach = /outreach|contact|email|cold|prospect/i.test(p);
  const title = p.replace(/\.$/, '');
  const m = createMemory({
    type: 'decision',
    title: title.slice(0, 120),
    summary: title.slice(0, 200),
    content: `User decision: ${p}\nRecorded from conversation; this decision is consulted before future ${isOutreach ? 'revenue/outreach' : ''} actions.`,
    scope: isOutreach ? 'revenue' : 'general',
    entities: isOutreach ? ['outreach'] : [],
    tags: ['decision', isOutreach ? 'outreach' : 'general'],
    confidence: 0.95,
    source: { sourceType: 'conversation' },
  });
  return `Remembered: ${title}.\n(decision memory, scope ${m.scope}, confidence ${m.confidence.toFixed(2)})`;
}

/**
 * conversationalTurn.ts — Phase 3: typed conversational turn model & resolver.
 *
 * Jarvis's robotic behavior came from routing on raw text BEFORE resolving what
 * the user actually refers to. This module inverts that: it resolves a typed
 * ConversationalTurn from persisted state first, so the orchestrator can decide
 * direct-answer vs delegation from *structured* context (the Phase 2 provenance
 * graph + conversation focus), never from a regex guess over prose.
 *
 * ── Architectural rule ─────────────────────────────────────────────────────
 *  1. CONVERSATION UNDERSTANDING  (what does the user mean?)
 *  2. CONTEXT RESOLUTION          (which result/finding/task?)
 *  3. ACTION DECISION             (answer / delegate / approve / nothing)
 *  4. EXECUTION                   (only after intent + context are resolved)
 *
 * The Phase 2 result/provenance graph remains the single source of truth for
 * worker-result references. This module adds conversation-level resolution on
 * top of it — it never replaces it, and never re-introduces text parsing as
 * the primary mechanism.
 */
import { conversationService } from '../conversations/service.js';
import { goalStore } from '../../services/goalStore.js';
import {
  classifyReferenceIntent,
  resolveResultReference,
  listConversationResults,
  extractFindingIndex,
} from '../../services/projectExecution/resultProvenance.js';
import type { ResolvedResultReference, ResultVerdictEntry } from '../../services/projectExecution/resultProvenance.js';
import type { WorkerFinding } from '../../services/projectExecution/findings.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type TurnActionType =
  | 'direct_answer'        // known information → answer from typed state
  | 'read_only_inspect'    // new read-only repository inspection → CodeX
  | 'verify_finding'       // new read-only verification of a finding → CodeX
  | 'plan'                 // planning / decomposition → Hermes
  | 'research'             // research → Hermes
  | 'write'                // repository mutation → CodeX (+ approval)
  | 'destructive'          // destructive mutation → approval
  | 'external'             // external / production mutation → approval
  | 'worker_status'        // "what is CodeX doing" → status answer
  | 'worker_result'        // "what did CodeX do" → typed result summary
  | 'continue'             // "continue / do it / fix it" → continue active context
  | 'clarify'              // ambiguous reference → one clarification question
  | 'conversation';        // plain conversation, no typed state

export type MutationIntent = 'none' | 'read_only' | 'write' | 'destructive' | 'external';

export type WorkerKind = 'codex' | 'hermes' | 'magnitude' | 'agent_teams';

export interface TurnReference {
  worker?: WorkerKind;
  goalId?: string;
  runId?: string;
  resultId?: string;
  findingId?: string;
  /** The referent is deictic ("it"/"that"/"that one") and resolved from focus. */
  deictic?: boolean;
}

/** The persisted conversational focus (reconstructable after restart). */
export interface ConversationFocus {
  worker?: WorkerKind;
  resultId?: string;
  resultType?: string;
  goalId?: string;
  findingId?: string;
  findingTitle?: string;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
}

export interface ConversationalTurn {
  conversationId: string;
  userMessage: string;
  intent: string;
  actionType: TurnActionType;
  references: TurnReference;
  resolvedContext: {
    result?: ResolvedResultReference | null;
    focus: ConversationFocus | null;
    activeGoal?: { id: string; status: string; worker: string } | null;
    recentGoal?: { id: string; status: string; worker: string; summary?: string } | null;
    finding?: WorkerFinding | null;
    verdict?: ResultVerdictEntry | null;
  };
  requiresWorker: boolean;
  worker?: WorkerKind;
  mutationIntent: MutationIntent;
  requiresApproval: boolean;
  confidence: number;
  resolutionSource: 'graph' | 'legacy' | 'focus' | 'none';
  resolutionEvidence: Record<string, unknown>;
  /** Set when the turn is ambiguous and Jarvis should ask one question. */
  clarification?: string;
  /** Pre-formatted truthful direct answer (e.g. "hasn't been verified yet"). */
  directMessage?: string;
}

// ── Regex classification helpers (semantic hints only) ────────────────────

const MUTATION_VERBS = /\b(fix|change|modify|update|patch|refactor|implement|add|create|edit|write|rename|move|repair|correct|build)\b/;
const NEGATED_MUTATION = /\b(do not|don't|without|no|never)\s+(modify|change|edit|write|patch|update|fix|implement|add|create|rename|move|delete|remove|build)\b/;
const DESTRUCTIVE_VERBS = /\b(delete|remove|drop|destroy|purge|wipe|revert|rollback)\b/;
const EXTERNAL_VERBS = /\b(deploy|publish|release|ship|push to (production|prod)|go live|launch)\b/;
const READ_ONLY_VERBS = /\b(inspect|analy[sz]e|verify|check|review|read|examine|look (at|into)|investigate|find|trace|search|audit)\b/;

const WORKER_STATUS_RE = /\b(what is|what's|is)\s+(codex|hermes|magnitude|he|she|it)\s+(doing|working on|up to|running|finished|done|complete|completed)\b/i;
const WORKER_RESULT_RE = /\bwhat did\s+(codex|hermes|he|she|magnitude)\s+(do|find|say|report|discover|conclude)\b|\bwhat (did|has)\s+(codex|hermes|magnitude)\s+(find|found|report|reported|say|said|do|done)\b/i;
const CONTINUATION_RE = /^(continue|go on|keep going|proceed|do it|do that|fix it|try again|check it again|check again|run it again|redo it)[\s.?!]*$/i;
const DEICTIC_ONLY_RE = /^(it|that|this|that one|this one|the last one|the first one|the second one)[\s.?!]*$/i;
/** "was that one verified / is it real / did he confirm it" — a status question, not a command. */
const VERIFIED_STATUS_RE = /\b(was|is|were|did|has)\b[^.!?]*\b(verified|real|true|serious|checked|confirmed|legit|legitimate|actually (the|a) problem)\b/i;
/** "which is the most dangerous/serious/critical" → highest-priority finding. */
const SUPERLATIVE_RE = /\b(most|biggest|worst|gravest|highest|top|greatest)\s+(dangerous|serious|critical|important|severe|risky|impactful|urgent)\b/i;
/** "why did CodeX disagree / what's the discrepancy" → cross-result explanation. */
const DISAGREEMENT_RE = /\b(why|what|how)\b[^.!?]{0,60}\b(disagree|disagreed|disagreement|contradict|contradiction|differ|conflict|inconsisten\w*|discrepan\w*)\b/i;
/** "check it again / re-check / check again" → re-run verification. */
const REVERIFY_RE = /\b(check\s+(it|that|this|again)|re-?check|recheck)\b/i;

function priorityRank(p?: string): number {
  if (!p) return 99;
  const m = p.match(/P([0-3])/i);
  return m ? parseInt(m[1], 10) : 99;
}

const WORKER_NAME = { codex: 'CodeX', hermes: 'Hermes', magnitude: 'Magnitude', agent_teams: 'Agent Teams' } as const;

/** Classify the mutation intent of a prompt — the ACTION, not the worker. */
export function classifyMutationIntent(prompt: string): MutationIntent {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const negated = NEGATED_MUTATION.test(p);
  if (EXTERNAL_VERBS.test(p) && !negated) return 'external';
  if (DESTRUCTIVE_VERBS.test(p) && !negated) return 'destructive';
  if (MUTATION_VERBS.test(p) && !negated) return 'write';
  if (READ_ONLY_VERBS.test(p)) return 'read_only';
  return 'none';
}

/** Detect a worker-status question ("what is CodeX doing"). */
export function detectWorkerStatusQuestion(prompt: string): WorkerKind | null {
  const m = prompt.match(WORKER_STATUS_RE);
  if (!m) return null;
  const w = (m[2] || '').toLowerCase(); // group 2 = worker name
  if (w === 'codex') return 'codex';
  if (w === 'hermes') return 'hermes';
  if (w === 'magnitude') return 'magnitude';
  return null; // "he/she/it" → resolved from focus by the caller
}

/** Detect a completed-worker-result question ("what did CodeX do/find/say"). */
export function detectWorkerResultQuestion(prompt: string): WorkerKind | null {
  const m = prompt.match(WORKER_RESULT_RE);
  if (!m) return null;
  const w = (m[1] || m[4] || '').toLowerCase(); // group 1 (alt1) or group 4 (alt2) = worker
  if (w === 'codex') return 'codex';
  if (w === 'hermes') return 'hermes';
  if (w === 'magnitude') return 'magnitude';
  return null;
}

export function detectContinuation(prompt: string): boolean {
  return CONTINUATION_RE.test(prompt.trim());
}

export function isDeicticOnly(prompt: string): boolean {
  return DEICTIC_ONLY_RE.test(prompt.trim());
}

// ── Focus reconstruction (persisted) ──────────────────────────────────────

/**
 * Reconstruct the conversational focus (the entity the user is most likely
 * referring to) from persisted state — the last resolved reference evidence,
 * the last user message, and the persisted result graph. Never process memory.
 */
export async function resolveConversationFocus(conversationId: string): Promise<ConversationFocus | null> {
  try {
    const msgs = await conversationService.getMessages(conversationId);
    const arr = Array.isArray(msgs) ? msgs : [];
    let lastUser: string | undefined;
    let lastAssistant: string | undefined;
    let focusWithFinding: ConversationFocus | null = null;
    let focusWithResult: ConversationFocus | null = null;

    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      const content = typeof m?.content === 'string' ? m.content : '';
      if (m?.role === 'user' && !lastUser && content.trim()) lastUser = content.trim();
      if (m?.role === 'agent' && !lastAssistant && content.trim()) lastAssistant = content.trim();
      const meta = (m?.metadata || {}) as any;
      const ev = meta?.resolutionEvidence;
      if (ev) {
        // Prefer a finding-bearing reference: a resolvedResultId-only entry
        // (e.g. a verification system_status) must not mask the last explicit
        // finding the user was talking about.
        if (!focusWithFinding && typeof ev.findingId === 'string' && ev.findingId) {
          focusWithFinding = {
            resultId: typeof ev.resolvedResultId === 'string' ? ev.resolvedResultId : undefined,
            resultType: typeof ev.resultType === 'string' ? ev.resultType : undefined,
            findingId: ev.findingId,
          };
        }
        if (!focusWithResult && typeof ev.resolvedResultId === 'string' && ev.resolvedResultId) {
          focusWithResult = {
            resultId: ev.resolvedResultId,
            resultType: typeof ev.resultType === 'string' ? ev.resultType : undefined,
            findingId: undefined,
          };
        }
      }
      // Stop once we have both the latest user+assistant turns AND a
      // finding-bearing reference; otherwise keep scanning for one.
      if (lastUser && lastAssistant && focusWithFinding) break;
    }

    let focus = focusWithFinding || focusWithResult;

    if (!focus) {
      // Fall back to the most recent persisted result (typed graph).
      const entries = listConversationResults(conversationId);
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        focus = { resultId: last.result.id, resultType: last.resultType, goalId: last.goalId };
      }
    }

    if (!focus) return null;
    focus.lastUserMessage = lastUser;
    focus.lastAssistantMessage = lastAssistant;

    // Enrich with the finding title when a finding id is known.
    if (focus.findingId && focus.resultId) {
      const entry = listConversationResults(conversationId).find((e) => e.result.id === focus!.resultId);
      const findings = ((entry?.result.structuredOutput || {}) as any)?.findings;
      if (Array.isArray(findings)) {
        const f = findings.find((x: WorkerFinding) => x.id === focus!.findingId);
        if (f) focus.findingTitle = f.title;
      }
    }
    return focus;
  } catch {
    return null;
  }
}

// ── Worker status / result lookups ────────────────────────────────────────

function summarizeGoal(goal: any): { id: string; status: string; worker: string; summary?: string } | null {
  if (!goal) return null;
  const summary = (goal.runSummary as any)?.finalAnswer || (goal.runSummary as any)?.summary || '';
  return {
    id: goal.id,
    status: goal.status,
    worker: 'codex',
    summary: summary ? String(summary) : undefined,
  };
}

function findActiveGoal(goals: any[]): any | null {
  return goals.find((g: any) => ['running', 'queued', 'planning', 'waiting_for_approval', 'executing', 'validating', 'checkpointed'].includes(String(g.status))) || null;
}

function findRecentGoal(goals: any[]): any | null {
  return goals.find((g: any) => ['completed', 'failed', 'stopped', 'interrupted'].includes(String(g.status))) || null;
}

// ── Natural response formatting ───────────────────────────────────────────

function findingToNatural(f: WorkerFinding): string {
  const parts = [`**${f.title}**`];
  if (f.description) parts.push(f.description);
  if (f.priority) parts.push(`Priority ${f.priority}.`);
  if (f.confidence !== undefined) parts.push(`Confidence ${Math.round(f.confidence * 100)}%.`);
  if (f.evidence && f.evidence.length > 0) {
    parts.push(`Evidence: ${f.evidence.map((e) => e.file + (e.lineStart ? `:${e.lineStart}` : '')).join(', ')}.`);
  }
  return parts.join(' ');
}

function verdictToNatural(findingId: string, verdict: any): string {
  const v = verdict?.verdict ? String(verdict.verdict).replace(/_/g, ' ').toLowerCase() : 'not verified';
  const explanation = verdict?.explanation ? ` ${verdict.explanation}` : '';
  return `Finding ${findingId.replace(/^finding-/, '')} was ${v}.${explanation}`;
}

/** Explain an analysis-vs-verification discrepancy in natural prose. */
function formatDisagreement(findingId: string, finding: WorkerFinding | undefined, verdict: ResultVerdictEntry): string {
  const title = finding?.title ? ` (${finding.title})` : '';
  const v = verdict?.verdict ? String(verdict.verdict).replace(/_/g, ' ').toLowerCase() : 'not verified';
  const explanation = verdict?.explanation ? ` ${verdict.explanation}` : '';
  return `CodeX initially flagged ${findingId}${title} in its analysis, but its independent verification came back ${v}.${explanation} That's why the two results disagree.`;
}

/** Produce a natural, conversational user-facing answer for a resolved turn. */
export function formatNaturalResponse(turn: ConversationalTurn): string {
  if (turn.directMessage) return turn.directMessage;
  switch (turn.actionType) {
    case 'direct_answer': {
      if (turn.resolvedContext.verdict) {
        return verdictToNatural(turn.references.findingId || 'that finding', turn.resolvedContext.verdict);
      }
      if (turn.resolvedContext.finding) {
        return findingToNatural(turn.resolvedContext.finding);
      }
      return turn.resolvedContext.result?.result?.summary || 'I found that in the earlier results.';
    }
    case 'worker_status': {
      const a = turn.resolvedContext.activeGoal;
      if (a) {
        if (a.status === 'waiting_for_approval') return `${WORKER_NAME[turn.worker || 'codex']} has a change ready and waiting for your approval.`;
        return `${WORKER_NAME[turn.worker || 'codex']} is still working on that — it hasn't finished yet. I'll report back when it does.`;
      }
      return `${WORKER_NAME[turn.worker || 'codex']} isn't running anything right now.`;
    }
    case 'worker_result': {
      const r = turn.resolvedContext.recentGoal;
      if (r?.summary) return `${WORKER_NAME[turn.worker || 'codex']} finished and reported: ${r.summary.slice(0, 400)}`;
      if (r) return `${WORKER_NAME[turn.worker || 'codex']} ${r.status} the last task it was given.`;
      return `${WORKER_NAME[turn.worker || 'codex']} hasn't produced a result in this conversation yet.`;
    }
    case 'clarify':
      return turn.clarification || "I'm not sure what you're referring to — could you point me at it?";
    case 'continue':
      return `Picking up where we left off on ${turn.references.findingId || turn.resolvedContext.focus?.resultType || 'the previous work'}.`;
    case 'plan':
      return turn.references.findingId
        ? `I'd inspect the code read-only first to lay out a concrete fix for ${turn.references.findingId}. Want me to run that inspection?`
        : `I'd inspect the code read-only first to lay out a concrete fix. Want me to run that inspection?`;
    default:
      return turn.clarification || "Got it.";
  }
}

// ── Main resolver ─────────────────────────────────────────────────────────

/**
 * Resolve a typed conversational turn: interpret the message, resolve its
 * references from persisted state, and classify the required action — before
 * any worker is decided.
 */
export async function resolveConversationalTurn(
  conversationId: string,
  prompt: string,
): Promise<ConversationalTurn> {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const mutationIntent = classifyMutationIntent(prompt);
  const focus = await resolveConversationFocus(conversationId);
  const goals = (() => { try { return goalStore.listByConversation(conversationId, 6) || []; } catch { return []; } })();

  const activeGoal = findActiveGoal(goals);
  const recentGoal = findRecentGoal(goals);

  const base = {
    conversationId,
    userMessage: prompt,
    references: {} as TurnReference,
    resolvedContext: {
      result: null as ResolvedResultReference | null,
      focus,
      activeGoal: activeGoal ? summarizeGoal(activeGoal) : null,
      recentGoal: recentGoal ? summarizeGoal(recentGoal) : null,
      finding: null as WorkerFinding | null,
      verdict: null as ResultVerdictEntry | null,
    },
    requiresWorker: false,
    worker: undefined as WorkerKind | undefined,
    mutationIntent,
    requiresApproval: false,
    confidence: 0.5,
    resolutionSource: 'none' as ConversationalTurn['resolutionSource'],
    resolutionEvidence: {} as Record<string, unknown>,
  };

  // 1. Mutation requests are never answered from state — they delegate.
  if (mutationIntent === 'write' || mutationIntent === 'destructive' || mutationIntent === 'external') {
    // "how would you fix it" / "just tell me how" is planning, not mutation.
    const howTo = /\b(how would you|how should we|tell me how|explain how|what would you do)\b/i.test(p);
    if (howTo) {
      return { ...base, intent: 'explain fix approach', actionType: 'plan', requiresWorker: false, mutationIntent: 'none', confidence: 0.85, resolutionSource: 'focus', references: { findingId: focus?.findingId ?? (extractFindingIndex(p) ? `finding-${extractFindingIndex(p)}` : undefined) } };
    }
    const actionType: TurnActionType = mutationIntent === 'external' ? 'external' : mutationIntent === 'destructive' ? 'destructive' : 'write';
    return {
      ...base,
      intent: `${mutationIntent} request`,
      actionType,
      requiresWorker: true,
      worker: 'codex',
      requiresApproval: true,
      confidence: 0.9,
      resolutionSource: 'focus',
      references: { findingId: focus?.findingId, resultId: focus?.resultId },
    };
  }

  // 2. Worker status questions.
  const statusWorker = detectWorkerStatusQuestion(prompt);
  if (statusWorker || (isDeicticOnly(prompt) === false && /what (is|are|was).*(doing|up to|running)/i.test(p))) {
    // The active goal is a CodeX goal (goalStore). Only attribute it when the
    // question is about CodeX (or an unspecified worker); a specific
    // other-worker question ("what is Hermes doing?") must not borrow CodeX's
    // task as if it were Hermes's.
    const workerForStatus = statusWorker || focus?.worker;
    const activeGoalForStatus = (workerForStatus === 'codex' || !workerForStatus) ? base.resolvedContext.activeGoal : null;
    return {
      ...base,
      intent: 'worker status',
      actionType: 'worker_status',
      worker: workerForStatus,
      confidence: 0.9,
      resolutionSource: 'focus',
      resolvedContext: { ...base.resolvedContext, activeGoal: activeGoalForStatus },
      resolutionEvidence: { activeGoal: activeGoalForStatus?.id ?? null },
    };
  }

  // 3. Completed-worker-result questions.
  const resultWorker = detectWorkerResultQuestion(prompt);
  // "what did he/she find" → the focused worker's most recent result (deictic).
  const deicticResultWorker = !resultWorker && /\bwhat did\s+(he|she|it|they)\s+(do|find|say|report|discover|conclude)\b/i.test(p);
  if (resultWorker || deicticResultWorker) {
    return {
      ...base,
      intent: 'worker result',
      actionType: 'worker_result',
      worker: resultWorker || (focus?.worker ?? 'codex'),
      confidence: 0.88,
      resolutionSource: 'focus',
      resolutionEvidence: { recentGoal: base.resolvedContext.recentGoal?.id ?? null },
    };
  }

  // 3b. Verification-status question ("was that one verified?" / "is it real?").
  if (VERIFIED_STATUS_RE.test(p)) {
    const hint = focus?.findingId ? parseInt(focus.findingId.replace(/\D/g, ''), 10) || null : extractFindingIndex(p);
    if (hint !== null) {
      const ref = resolveResultReference({ conversationId, worker: 'codex', userPrompt: 'what was the verdict on that finding', findingIndexHint: hint });
      if (ref.result) {
        if (ref.verdict) {
          return {
            ...base,
            intent: 'verification status',
            actionType: 'direct_answer',
            confidence: 0.9,
            resolutionSource: 'graph',
            references: { worker: 'codex', resultId: ref.result.id, goalId: ref.goalId, findingId: ref.findingId },
            resolvedContext: { ...base.resolvedContext, result: ref, finding: ref.finding, verdict: ref.verdict },
            resolutionEvidence: { ...ref, findingId: ref.findingId },
          };
        }
        return {
          ...base,
          intent: 'verification status (not verified)',
          actionType: 'direct_answer',
          confidence: 0.7,
          resolutionSource: 'graph',
          references: { findingId: ref.findingId, resultId: ref.result.id },
          resolvedContext: { ...base.resolvedContext, result: ref, finding: ref.finding, verdict: null },
          directMessage: `${ref.findingId ? `Finding ${ref.findingId.replace('finding-', '')} ` : 'That one '}hasn't been verified yet — I only have the initial analysis.`,
        };
      }
    }
  }

  // 3c-bis. Cross-result disagreement ("why did CodeX disagree?").
  if (DISAGREEMENT_RE.test(p)) {
    const entries = listConversationResults(conversationId, 'codex');
    const verification = entries.filter((e) => e.resultType === 'verification').slice(-1)[0];
    if (verification) {
      // Target the analysis the verification actually verified (typed graph),
      // never merely the most recent analysis result.
      const verificationOf = (((verification.result.structuredOutput || {}) as any).verificationOfResultId) as string | undefined;
      const analysis = (verificationOf && entries.find((e) => e.result.id === verificationOf))
        || entries.filter((e) => e.resultType === 'analysis').slice(-1)[0];
      if (analysis) {
        const findings: WorkerFinding[] = (((analysis.result.structuredOutput || {}) as any).findings) || [];
        const verdicts: ResultVerdictEntry[] = (((verification.result.structuredOutput || {}) as any).verdicts) || [];
        const disagreements = verdicts.filter((v) => v.verdict === 'NOT_VERIFIED' || v.verdict === 'PARTIALLY_VERIFIED');
        if (disagreements.length > 0) {
          const target = (focus?.findingId ? disagreements.find((v) => v.findingId === focus.findingId) : undefined) || disagreements[0];
          const finding = findings.find((f) => f.id === target.findingId);
          const message = formatDisagreement(target.findingId || 'the finding', finding, target);
          return {
            ...base,
            intent: 'cross-result disagreement',
            actionType: 'direct_answer',
            directMessage: message,
            confidence: 0.85,
            resolutionSource: 'graph',
            references: { worker: 'codex', resultId: verification.result.id, findingId: target.findingId },
            resolvedContext: { ...base.resolvedContext, result: null, finding, verdict: target },
            resolutionEvidence: { resolvedResultId: verification.result.id, resultType: 'verification', findingId: target.findingId, verdict: target.verdict },
          };
        }
      }
    }
  }

  // 3c. Superlative finding question ("which is the most dangerous?").
  if (SUPERLATIVE_RE.test(p) && /\b(which|what)\b/i.test(p)) {
    const entries = listConversationResults(conversationId, 'codex');
    const analysis = entries.filter((e) => e.resultType === 'analysis').slice(-1)[0];
    if (analysis) {
      const findings: WorkerFinding[] = (((analysis.result.structuredOutput || {}) as any).findings) || [];
      const ranked = [...findings].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.id || '').localeCompare(b.id || ''));
      const top = ranked[0];
      if (top) {
        return {
          ...base,
          intent: 'superlative finding',
          actionType: 'direct_answer',
          confidence: 0.9,
          resolutionSource: 'graph',
          references: { worker: 'codex', resultId: analysis.result.id, findingId: top.id },
          resolvedContext: { ...base.resolvedContext, result: null, finding: top },
          resolutionEvidence: { resolvedResultId: analysis.result.id, resultType: 'analysis', findingId: top.id, priority: top.priority },
        };
      }
    }
  }

  // 4. Continuation / "do it" / "fix it".
  if (detectContinuation(prompt)) {
    // "check it again" / "re-check" → re-run verification (delegate read-only),
    // distinct from a bare "continue" which just acknowledges the context.
    if (REVERIFY_RE.test(p) && (focus?.findingId || focus?.resultId)) {
      return {
        ...base,
        intent: 're-verify',
        actionType: 'verify_finding',
        requiresWorker: true,
        worker: 'codex',
        mutationIntent: 'read_only',
        requiresApproval: false,
        confidence: 0.85,
        resolutionSource: 'graph',
        references: { findingId: focus?.findingId, resultId: focus?.resultId, goalId: focus?.goalId },
        resolutionEvidence: { resolvedResultId: focus?.resultId ?? null, resultType: 'analysis', findingId: focus?.findingId ?? undefined },
      };
    }
    // "do it"/"fix it" with a write verb → mutation (requires approval);
    // plain "continue" → continue the active/recent context.
    const isMutationContinue = /\b(do it|do that|fix it|redo it)\b/i.test(p);
    if (isMutationContinue && (focus?.findingId || activeGoal)) {
      return {
        ...base,
        intent: 'continue (mutation)',
        actionType: 'write',
        requiresWorker: true,
        worker: 'codex',
        mutationIntent: 'write',
        requiresApproval: true,
        confidence: 0.8,
        resolutionSource: 'focus',
        references: { findingId: focus?.findingId, resultId: focus?.resultId, goalId: focus?.goalId },
      };
    }
    if (activeGoal || recentGoal || focus) {
      return {
        ...base,
        intent: 'continue',
        actionType: 'continue',
        confidence: 0.85,
        resolutionSource: 'focus',
        references: { findingId: focus?.findingId, resultId: focus?.resultId, goalId: activeGoal?.id ?? recentGoal?.id },
      };
    }
    return { ...base, intent: 'continue (no context)', actionType: 'clarify', clarification: "I don't have anything in progress right now — what would you like me to do?", confidence: 0.4 };
  }

  // 5. Finding / verdict references (Phase 2 graph) + deictic hint.
  const referenceIntent = classifyReferenceIntent(prompt, focus?.findingId ? parseInt(focus.findingId.replace(/\D/g, ''), 10) || null : null);
  if (referenceIntent.kind !== 'none') {
    const hint = focus?.findingId ? parseInt(focus.findingId.replace(/\D/g, ''), 10) || null : null;
    const ref = resolveResultReference({ conversationId, worker: 'codex', userPrompt: prompt, findingIndexHint: hint });

    if (ref.clarification) {
      return { ...base, intent: 'ambiguous reference', actionType: 'clarify', clarification: ref.clarification, confidence: ref.confidence, resolutionEvidence: ref as any };
    }
    if (!ref.result) {
      return { ...base, intent: 'no result', actionType: 'clarify', clarification: "I don't have a prior result matching that yet — would you like me to run an analysis first?", confidence: 0.3 };
    }

    // A deictic-singular verify ("check that one again") narrows to the focused
    // finding; a general verify ("verify the five problems") stays whole.
    const deicticSingular = /\b(that|this|it)\s+(one|finding|problem|issue|claim|item)\b/i.test(p);
    const findingId = ref.findingId ?? (deicticSingular && hint !== null ? `finding-${hint}` : undefined);

    base.resolvedContext.result = ref;
    base.resolvedContext.finding = ref.finding ?? null;
    base.resolvedContext.verdict = ref.verdict ?? null;
    base.references = { worker: 'codex', resultId: ref.result.id, goalId: ref.goalId, findingId };

    // "check that one again" / "verify" → new verification (delegate);
    // "explain" / "was it verified" → answer from typed state.
    const verifyVerb = /\b(verify|re-?verify|check (it|that|again)|recheck|re-check|validate|confirm)\b/i.test(p);
    const explainVerb = /\b(explain|describe|what was|what is|was (it|that) (verified|real|true|serious)|did (he|codex) (verify|confirm))\b/i.test(p);

    if (verifyVerb && !explainVerb) {
      return {
        ...base,
        intent: 'verify finding',
        actionType: 'verify_finding',
        requiresWorker: true,
        worker: 'codex',
        mutationIntent: 'read_only',
        requiresApproval: false,
        confidence: ref.confidence,
        resolutionSource: 'graph',
        resolutionEvidence: { ...ref, findingId, resolvedResultId: ref.result.id },
      };
    }
    return {
      ...base,
      intent: 'explain / answer from typed result',
      actionType: 'direct_answer',
      confidence: ref.confidence,
      resolutionSource: 'graph',
      resolutionEvidence: { ...ref, findingId, resolvedResultId: ref.result.id },
    };
  }

  // 6. Deictic-only ("that one", "it") with a focus → answer the focused finding.
  if (isDeicticOnly(prompt) && focus?.findingId) {
    const hint = parseInt(focus.findingId.replace(/\D/g, ''), 10) || null;
    const ref = resolveResultReference({ conversationId, worker: 'codex', userPrompt: 'explain that finding', findingIndexHint: hint });
    if (ref.result && ref.finding) {
      return {
        ...base,
        intent: 'deictic finding',
        actionType: 'direct_answer',
        confidence: 0.85,
        resolutionSource: 'focus',
        references: { worker: 'codex', resultId: ref.result.id, findingId: ref.findingId },
        resolvedContext: { ...base.resolvedContext, result: ref, finding: ref.finding },
        resolutionEvidence: { ...ref, findingId: ref.findingId },
      };
    }
  }

  // 7. Plain conversation — no typed state, no worker.
  return { ...base, intent: 'conversation', actionType: 'conversation', confidence: 0.6, resolutionSource: 'none' };
}

export { WORKER_NAME };

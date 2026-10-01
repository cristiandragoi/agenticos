/**
 * resultProvenance.ts
 *
 * Result relationships & provenance graph (Phase 2).
 *
 * Phase 1 made `execution_results.structured_output.findings[]` the typed
 * machine contract for what a worker found. Phase 2 adds *how results relate*:
 * which result verified which, what semantic type each result is, and which
 * finding each verification verdict addresses.
 *
 * ── Design contract ───────────────────────────────────────────────────────
 * - Typed persisted relationships are AUTHORITATIVE. Prompt keywords are
 *   semantic hints only.
 * - Relationships live additively inside `execution_results.structured_output`
 *   (already a JSON blob). NO DB migration: the graph is reconstructed from
 *   `execution_runs.conversation_id` → `execution_results`, which is indexed.
 * - The resolver is graph-first for new rows (resolutionSource = 'graph') and
 *   falls back to legacy for historical rows (resolutionSource = 'legacy').
 * - Nothing here reads conversation_messages content as a source of truth; the
 *   transcript is a mirror only.
 */

import { executionRunService, type ExecutionResultRecord } from './executionRunService.js';
import type { WorkerFinding, FindingVerdict } from './findings.js';
import { unifiedOperationalContext } from '../../domains/controlPlane/UnifiedOperationalContext.js';

// ── Types ────────────────────────────────────────────────────────────────

export type ResultType =
  | 'analysis'
  | 'verification'
  | 'change'
  | 'research'
  | 'plan'
  | 'execution'
  | 'other';

/** Per-finding verdict emitted by a verification result (finding-id keyed). */
export interface ResultVerdictEntry {
  /** Stable finding id from the analysis result, e.g. "finding-2". */
  findingId: string;
  verdict: FindingVerdict;
  evidence: string[];
  explanation?: string;
  priority?: string;
}

/**
 * Provenance fields persisted into `execution_results.structured_output`
 * (additive — historical rows simply lack them).
 */
export interface ResultProvenance {
  resultType?: ResultType;
  /** Result directly consumed when producing this result. */
  sourceResultId?: string;
  /** Analysis result this verification verifies. */
  verificationOfResultId?: string;
  /** Semantic parent result, when appropriate. */
  parentResultId?: string;
  /** Previous result replaced/revised by this result. */
  supersedesResultId?: string;
  /** Revision/version number, when genuinely useful. */
  resultVersion?: number;
  /** Finding-id keyed verdicts (verification results only). */
  verdicts?: ResultVerdictEntry[];
}

/** A conversation result with its resolved semantic type and relationships. */
export interface ConversationResultEntry {
  result: ExecutionResultRecord;
  runId: string;
  goalId: string;
  resultType: ResultType;
  verificationOfResultId?: string;
  sourceResultId?: string;
  createdAt: string;
}

export interface ResolveResultReferenceInput {
  conversationId: string;
  worker?: 'codex' | 'hermes';
  userPrompt: string;
  currentResultId?: string;
  expectedResultType?: ResultType;
  /** Deictic finding-index hint (from prior resolution evidence) when the
   *  prompt references "that/this problem" with no explicit ordinal. */
  findingIndexHint?: number | null;
}

export interface ResolvedResultReference {
  result: ExecutionResultRecord | null;
  resultType: ResultType | null;
  /** Ordered execution_result ids traversed, e.g. ['exr-A'] or ['exr-A','exr-B']. */
  relationshipPath: string[];
  resolutionSource: 'graph' | 'legacy' | 'none';
  confidence: number;
  reason: string;
  /** Run/agent instance ids of the resolved result (for handoff navigation). */
  goalId?: string;
  runId?: string;
  /** Set when the prompt references a specific finding (finding id). */
  findingId?: string;
  finding?: WorkerFinding | null;
  /** Set when a verification verdict for the referenced finding was resolved. */
  verdict?: ResultVerdictEntry | null;
  /** Non-null when the reference is genuinely ambiguous — caller must clarify. */
  clarification?: string;
}

// ── Reference-intent classification ─────────────────────────────────────

type ReferenceIntent =
  | { kind: 'verify_target'; findingIndex: number | null }
  | { kind: 'explain_finding'; findingIndex: number }
  | { kind: 'explain_verification' }
  | { kind: 'verdict_lookup'; findingIndex: number | null }
  | { kind: 'none' };

/** Extract a 1-based finding index from a prompt ("second problem" → 2). */
export function extractFindingIndex(prompt: string): number | null {
  const p = prompt.toLowerCase().replace(/['’]/g, "'");

  const ordinals: Array<[RegExp, number]> = [
    [/\b(?:first|1st)\s+(?:finding|problem|issue|claim|point|item|one)\b/, 1],
    [/\b(?:second|2nd)\s+(?:finding|problem|issue|claim|point|item|one)\b/, 2],
    [/\b(?:third|3rd)\s+(?:finding|problem|issue|claim|point|item|one)\b/, 3],
    [/\b(?:fourth|4th)\s+(?:finding|problem|issue|claim|point|item|one)\b/, 4],
    [/\b(?:fifth|5th)\s+(?:finding|problem|issue|claim|point|item|one)\b/, 5],
  ];
  for (const [re, n] of ordinals) if (re.test(p)) return n;

  const word = p.match(/\b(?:finding|problem|issue|claim|point|item)\s+(?:#|no\.?\s*)?(\d+)\b/);
  if (word) return parseInt(word[1], 10);

  const generic = p.match(/\b(?:finding|problem|issue|claim|point|item)\s+#?(\d+)\b/);
  if (generic) return parseInt(generic[1], 10);

  return null;
}

const VERIFY_VERB_RE = /\b(?:verify|re-?verify|recheck|re-check|validate|confirm|check)\b/;
const VERDICT_RE = /\bverdict\b/;
const EXPLAIN_RE = /\b(?:explain|describe|what was|what is|what were|tell me about|summarize|walk me through)\b/;
const VERIFICATION_NOUN_RE = /\bverification\b/;

/**
 * True when the prompt is a deictic reference to a single prior finding
 * ("that problem", "this issue", "it") with no explicit ordinal.
 */
function isDeicticFindingReference(prompt: string): boolean {
  return /\b(that|this|it|those|these)\b/.test(prompt) &&
    /\b(problem|finding|issue|claim|point|item|verdict|one)\b/.test(prompt);
}

export function classifyReferenceIntent(prompt: string, findingIndexHint?: number | null): ReferenceIntent {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const explicitIndex = extractFindingIndex(p);
  const verifyVerb = VERIFY_VERB_RE.test(p);
  const verdictWord = VERDICT_RE.test(p);
  const explainVerb = EXPLAIN_RE.test(p);
  const verificationNoun = VERIFICATION_NOUN_RE.test(p);

  // A deictic "that/this/it problem" with no explicit ordinal inherits the
  // last-resolved finding index (a typed context hint from the orchestrator —
  // never a regex over conversation text).
  const findingIndex =
    explicitIndex ?? (isDeicticFindingReference(p) ? (findingIndexHint ?? null) : null);

  if (verdictWord && !verifyVerb) {
    return { kind: 'verdict_lookup', findingIndex };
  }
  if (verifyVerb) {
    // Verify requests target the analysis as a whole; only an EXPLICIT ordinal
    // narrows to a single finding (a deictic hint never narrows a verify).
    return { kind: 'verify_target', findingIndex: explicitIndex };
  }
  if (verificationNoun && !findingIndex) {
    return { kind: 'explain_verification' };
  }
  if (findingIndex) {
    return { kind: 'explain_finding', findingIndex };
  }
  // "explain what codex found" without an index → explain the (analysis) findings.
  if (explainVerb && /\b(?:found|reported|identified|said)\b/.test(p)) {
    return { kind: 'explain_finding', findingIndex: 0 };
  }
  return { kind: 'none' };
}

// ── Persisted-state access ───────────────────────────────────────────────

function readProvenance(result: ExecutionResultRecord): ResultProvenance {
  const s = (result.structuredOutput || {}) as any;
  return {
    resultType: (s.resultType as ResultType) || undefined,
    sourceResultId: s.sourceResultId,
    verificationOfResultId: s.verificationOfResultId,
    parentResultId: s.parentResultId,
    supersedesResultId: s.supersedesResultId,
    resultVersion: s.resultVersion,
    verdicts: Array.isArray(s.verdicts) ? s.verdicts : undefined,
  };
}

export function getResultType(result: ExecutionResultRecord | null): ResultType {
  if (!result) return 'other';
  return readProvenance(result).resultType || 'other';
}

/**
 * Gather the persisted worker results of a conversation, ascending, each with
 * its semantic type. This is the persisted provenance graph source — never
 * conversation text, never in-memory state.
 */
export function listConversationResults(
  conversationId: string,
  worker?: 'codex' | 'hermes',
): ConversationResultEntry[] {
  let runs = conversationId ? executionRunService.listRunsForConversation(conversationId) : [];

  // Cross-channel shared operational state (§1, §2, §4)
  if (runs.length === 0) {
    try {
      const activeRef = unifiedOperationalContext.getActiveReferent();
      if (activeRef.activeTaskId) {
        runs = executionRunService.listRunsForTask(activeRef.activeTaskId);
      }
    } catch {}
  }

  const entries: ConversationResultEntry[] = [];
  for (const run of runs) {
    if (worker && run.workerType !== worker) continue;
    const result = executionRunService.getResultForRun(run.id);
    if (!result) continue;
    const prov = readProvenance(result);
    entries.push({
      result,
      runId: run.id,
      goalId: run.agentInstanceId || run.goalId || '',
      resultType: prov.resultType || 'other',
      verificationOfResultId: prov.verificationOfResultId,
      sourceResultId: prov.sourceResultId,
      createdAt: result.createdAt,
    });
  }
  return entries;
}

// ── Verdict parsing (finding-id keyed) ───────────────────────────────────

const VERDICT_BLOCK_RE = /Finding\s+ID:\s*(finding-\d+)[\s\S]*?Decision:\s*(VERIFIED|PARTIALLY\s+VERIFIED|NOT\s+VERIFIED)/i;
const EVIDENCE_RE = /(?:Concrete\s+Evidence|Evidence)\s*:\s*([^\n]+)/i;
const ASSESSMENT_RE = /(?:Technical\s+Assessment|Assessment)\s*:\s*([^\n]+)/i;
const PRIORITY_IN_BLOCK_RE = /(?:Priority|Production\s+Impact\s*&\s*Priority)\s*:\s*P([0-3])/i;

/**
 * Parse per-finding verdicts from a verification final-answer, keyed by the
 * finding id the model echoed (NOT by title). This is the machine-level
 * linkage between a verification result and the analysis findings it verifies.
 */
export function parseVerdictsFromText(text: string): ResultVerdictEntry[] {
  if (!text || typeof text !== 'string') return [];
  const verdicts: ResultVerdictEntry[] = [];
  const seen = new Set<string>();

  const blocks = text.split(/(?=Finding\s+ID:\s*finding-\d+)/i);
  for (const block of blocks) {
    const m = block.match(VERDICT_BLOCK_RE);
    if (!m) continue;
    const findingId = m[1].toLowerCase();
    if (seen.has(findingId)) continue;
    seen.add(findingId);

    const rawVerdict = m[2].toUpperCase().replace(/\s+/g, '_') as FindingVerdict;
    const verdict: FindingVerdict =
      rawVerdict === 'VERIFIED' || rawVerdict === 'PARTIALLY_VERIFIED' || rawVerdict === 'NOT_VERIFIED'
        ? rawVerdict
        : 'NOT_VERIFIED';

    const evidence: string[] = [];
    const em = block.match(EVIDENCE_RE);
    if (em && em[1].trim()) evidence.push(em[1].trim());

    const entry: ResultVerdictEntry = { findingId, verdict, evidence };
    const am = block.match(ASSESSMENT_RE);
    if (am && am[1].trim()) entry.explanation = am[1].trim();
    const pm = block.match(PRIORITY_IN_BLOCK_RE);
    if (pm) entry.priority = `P${pm[1]}`;
    verdicts.push(entry);
  }

  return verdicts;
}

/** Build the provenance fields to persist for a completed result. */
export function buildProvenanceFields(prov: ResultProvenance): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (prov.resultType) out.resultType = prov.resultType;
  if (prov.sourceResultId) out.sourceResultId = prov.sourceResultId;
  if (prov.verificationOfResultId) out.verificationOfResultId = prov.verificationOfResultId;
  if (prov.parentResultId) out.parentResultId = prov.parentResultId;
  if (prov.supersedesResultId) out.supersedesResultId = prov.supersedesResultId;
  if (prov.resultVersion !== undefined) out.resultVersion = prov.resultVersion;
  if (prov.verdicts && prov.verdicts.length > 0) out.verdicts = prov.verdicts;
  return out;
}

// ── Resolver ─────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE = 0.95;
const LEGACY_CONFIDENCE = 0.4;

function none(clarification?: string): ResolvedResultReference {
  return {
    result: null,
    resultType: null,
    relationshipPath: [],
    resolutionSource: 'none',
    confidence: 0,
    reason: 'no matching persisted worker result',
    clarification,
  };
}

function graphResolved(
  entry: ConversationResultEntry,
  extra: Partial<ResolvedResultReference> = {},
): ResolvedResultReference {
  return {
    result: entry.result,
    resultType: entry.resultType,
    relationshipPath: [entry.result.id],
    resolutionSource: 'graph',
    confidence: HIGH_CONFIDENCE,
    reason: `resolved ${entry.resultType} result ${entry.result.id} from persisted provenance`,
    goalId: entry.goalId,
    runId: entry.runId,
    ...extra,
  };
}

function latest<T extends { createdAt: string }>(arr: T[]): T {
  return arr[arr.length - 1];
}

/** Find the analysis result that a verification result references, if any. */
function analysisReferencedByVerification(
  verification: ConversationResultEntry,
  all: ConversationResultEntry[],
): ConversationResultEntry | null {
  if (!verification.verificationOfResultId) return null;
  return all.find((e) => e.result.id === verification.verificationOfResultId && e.resultType === 'analysis') || null;
}

/**
 * Resolve which persisted worker result a follow-up reference refers to.
 *
 * Invariant: typed persisted relationships are authoritative; prompt keywords
 * are semantic hints only. Returns a clarification (confidence < safe
 * threshold) rather than inventing intent when the reference is ambiguous.
 */
export function resolveResultReference(input: ResolveResultReferenceInput): ResolvedResultReference {
  const { conversationId, worker = 'codex', userPrompt } = input;

  const entries = listConversationResults(conversationId, worker);
  if (entries.length === 0) {
    try {
      const activeRef = unifiedOperationalContext.getActiveReferent();
      if (activeRef.activeTaskId) {
        const task = unifiedOperationalContext.getTask(activeRef.activeTaskId);
        if (task) {
          return none(`Active task \`${task.taskId}\` (${task.worker}: "${task.objective}") has status ${task.status}. No prior grounded worker analysis result artifact exists yet.`);
        }
      }
    } catch {}
    return none('No prior worker results exist in this operational context.');
  }

  const intent = classifyReferenceIntent(userPrompt, input.findingIndexHint);
  const analyses = entries.filter((e) => e.resultType === 'analysis');
  const verifications = entries.filter((e) => e.resultType === 'verification');
  const legacy = entries.filter((e) => e.resultType === 'other');

  const findingOf = (entry: ConversationResultEntry, index: number): WorkerFinding | null => {
    const findings = ((entry.result.structuredOutput || {}) as any).findings;
    if (!Array.isArray(findings) || findings.length === 0) return null;
    const i = index > 0 ? index - 1 : 0;
    return (findings[i] as WorkerFinding) || null;
  };

  switch (intent.kind) {
    case 'verify_target': {
      // Verify requests target an ANALYSIS result (never a verification of a
      // verification). Deictic "just/latest reported" is ambiguous only when
      // the most recent result is itself a verification.
      if (analyses.length > 0) {
        const target = latest(analyses);
        // Ambiguous only when an explicit "just/latest" refers to the newest
        // result being a verification rather than the analysis.
        const deictic = /\b(?:just|latest|last|newest)\b/.test(userPrompt.toLowerCase());
        if (deictic && verifications.length > 0 && latest(entries).resultType === 'verification') {
          return {
            ...graphResolved(target, { confidence: 0.3 }),
            resolutionSource: 'none',
            clarification:
              'Your request is ambiguous: the most recent worker result is a verification, but "verify" targets an analysis. Did you mean to re-verify the analysis findings, or review the verification itself?',
          };
        }
        return graphResolved(target, {
          reason: `verify request resolved to analysis result ${target.result.id}`,
        });
      }
      if (legacy.length > 0) {
        const target = latest(legacy);
        return {
          result: target.result,
          resultType: 'other',
          relationshipPath: [target.result.id],
          resolutionSource: 'legacy',
          confidence: LEGACY_CONFIDENCE,
          reason: 'no typed analysis result; resolved most recent legacy worker result',
          goalId: target.goalId,
          runId: target.runId,
        };
      }
      // Only a verification exists and user asks to verify → do not verify a
      // verification; resolve the analysis it references when possible.
      if (verifications.length > 0) {
        const target = analysisReferencedByVerification(latest(verifications), entries);
        if (target) {
          return graphResolved(target, {
            reason: `verify request traced verification back to analysis ${target.result.id}`,
          });
        }
        return none('No analysis result is available to verify (only a verification result exists).');
      }
      return none('No analysis result is available to verify.');
    }

    case 'explain_finding': {
      const index = intent.findingIndex || 1;
      const target = latest(analyses) || latest(legacy);
      if (!target) return none('No analysis result exists to explain.');
      const finding = findingOf(target, index);
      const isLegacy = target.resultType === 'other';
      return {
        result: target.result,
        resultType: target.resultType,
        relationshipPath: [target.result.id],
        resolutionSource: isLegacy ? 'legacy' : 'graph',
        confidence: isLegacy ? LEGACY_CONFIDENCE : HIGH_CONFIDENCE,
        reason: `explain request resolved to ${target.resultType} result ${target.result.id}, finding #${index}`,
        goalId: target.goalId,
        runId: target.runId,
        findingId: finding?.id || (index > 0 ? `finding-${index}` : undefined),
        finding,
      };
    }

    case 'explain_verification': {
      if (verifications.length > 0) {
        return graphResolved(latest(verifications), {
          reason: `explain-verification resolved to verification result ${latest(verifications).result.id}`,
        });
      }
      return none('No verification result exists in this conversation.');
    }

    case 'verdict_lookup': {
      const index = intent.findingIndex || 1;
      const target = latest(analyses) || latest(legacy);
      if (!target) return none('No analysis result exists to look up a verdict for.');
      const finding = findingOf(target, index);
      const findingId = finding?.id || (index > 0 ? `finding-${index}` : undefined);

      // Traverse analysis → verification via verificationOfResultId.
      const verification = verifications.find((v) => v.verificationOfResultId === target.result.id)
        || (verifications.length === 1 ? verifications[0] : undefined);

      if (!verification) {
        return {
          result: target.result,
          resultType: target.resultType,
          relationshipPath: [target.result.id],
          resolutionSource: target.resultType === 'other' ? 'legacy' : 'graph',
          confidence: HIGH_CONFIDENCE,
          reason: 'verdict requested but no verification result links to this analysis',
          goalId: target.goalId,
          runId: target.runId,
          findingId,
          finding,
          verdict: null,
        };
      }

      const verdicts = readProvenance(verification.result).verdicts || [];
      const verdict = verdicts.find((v) => v.findingId === findingId) || null;

      return {
        result: verification.result,
        resultType: 'verification',
        relationshipPath: [target.result.id, verification.result.id],
        resolutionSource: 'graph',
        confidence: verdict ? HIGH_CONFIDENCE : 0.7,
        reason: verdict
          ? `verdict lookup traversed analysis ${target.result.id} → verification ${verification.result.id} → ${findingId}`
          : `verdict lookup traversed to verification ${verification.result.id}, but no ${findingId} verdict was recorded`,
        goalId: verification.goalId,
        runId: verification.runId,
        findingId,
        finding,
        verdict,
      };
    }

    case 'none':
    default:
      return none();
  }
}

/**
 * Resolve a specific finding's verdict across the analysis → verification
 * relationship. Convenience wrapper over resolveResultReference for callers
 * that already know they want a verdict.
 */
export function resolveFindingVerdict(
  conversationId: string,
  findingIndex: number,
  worker: 'codex' | 'hermes' = 'codex',
): ResolvedResultReference {
  return resolveResultReference({
    conversationId,
    worker,
    userPrompt: `what was the verdict on the ${findingIndex}${ordinalSuffix(findingIndex)} finding`,
  });
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'st';
  if (n % 10 === 2 && n % 100 !== 12) return 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return 'rd';
  return 'th';
}

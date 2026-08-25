/**
 * Worker Context Handoff & Previous Worker Result Resolution.
 *
 * Resolves prior grounded worker findings (from conversation_messages and goalStore)
 * and formats enriched verification/follow-up payloads when Jarvis delegates tasks to CodeX or Hermes.
 *
 * Invariant: Jarvis never delegates a blind verification task that causes CodeX to
 * search for a missing markdown report file. Prior grounded findings are passed explicitly
 * as hypotheses to verify directly against source code.
 */
import { conversationService } from '../conversations/service.js';
import { goalStore } from '../../services/goalStore.js';
import { logger } from '../../utils/logger.js';
import { executionRunService } from '../../services/projectExecution/executionRunService.js';
import type { ExecutionResultRecord } from '../../services/projectExecution/executionRunService.js';
import type { WorkerFinding, FindingsSource } from '../../services/projectExecution/findings.js';
import { resolveResultReference } from '../../services/projectExecution/resultProvenance.js';
import type { ResolvedResultReference } from '../../services/projectExecution/resultProvenance.js';

export interface GroundedFinding {
  index: number;
  title: string;
  claim: string;
  raw: string;
}

export interface GroundedWorkerContext {
  worker: 'codex' | 'hermes';
  goalId?: string;
  messageId?: string;
  conversationId: string;
  category?: string;
  rawText: string;
  findings: GroundedFinding[];
  /** Authoritative typed findings resolved from execution_results.structured_output. */
  typedFindings?: WorkerFinding[];
  /** Where this handoff obtained findings: 'structured' | 'legacy_text_fallback'. */
  findingsSource?: FindingsSource;
  /** Canonical execution result / run ids (structured resolution). */
  executionResultId?: string;
  runId?: string;
  createdAt?: string | number;
}

const VERIFY_FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(?:verify|verification|check|prove|test|inspect|validate|re-check|recheck|re-examine|reexamine|expand on|look again at|evaluate)\b[\s\S]{0,80}\b(?:findings?|problems?|issues?|claims?|report|analysis|what (?:codex|hermes|they) (?:found|reported|said|identified)|prior|previous|last|earlier)\b/i,
  /\b(?:verify|check|inspect|prove|validate)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+(?:st|nd|rd|th)?)\s+(?:finding|problem|issue|claim|item|point)\b/i,
  /\b(?:verify|check|inspect|prove|validate)\s+(?:the\s+)?(?:five|5|top\s*\d+|\d+)\s+(?:production\s+)?(?:problems?|findings?|issues?)\b/i,
  /\bverify\s+(?:what\s+)?(?:codex|hermes)\s+(?:found|reported|identified|said)\b/i,
  /\bwhat\s+(?:evidence|proof)\s+(?:is\s+there|do\s+we\s+have)\s+for\s+(?:the|those|that)\s+(?:findings?|problems?|issues?)\b/i,
  /\bverify\s+(?:the\s+)?(?:findings?|production problems?)\b/i,
  // Deictic single-finding verification ("verify that one", "check this one").
  /\b(?:verify|check|re-?check|recheck|validate)\s+(?:that|this)\s+(?:one|finding|problem|issue|claim|item)\b/i,
];

/**
 * Detect whether the user is asking to verify, challenge, or follow up on previous worker findings.
 */
export function isWorkerVerificationOrFollowUp(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return VERIFY_FOLLOWUP_PATTERNS.some((re) => re.test(p));
}

/**
 * Check if the prompt targets a specific finding index (1-based, e.g. "second finding" -> 2).
 * Returns null if all findings or general verification is requested.
 */
export function extractRequestedFindingIndex(prompt: string): number | null {
  const p = prompt.toLowerCase().replace(/['’]/g, "'");

  if (/\b(?:first|1st)\s+(?:finding|problem|issue|claim|point|item)\b/.test(p) || /\b(?:finding|problem|issue|claim|point|item)\s+(?:1|#1|one)\b/.test(p)) {
    return 1;
  }
  if (/\b(?:second|2nd)\s+(?:finding|problem|issue|claim|point|item)\b/.test(p) || /\b(?:finding|problem|issue|claim|point|item)\s+(?:2|#2|two)\b/.test(p)) {
    return 2;
  }
  if (/\b(?:third|3rd)\s+(?:finding|problem|issue|claim|point|item)\b/.test(p) || /\b(?:finding|problem|issue|claim|point|item)\s+(?:3|#3|three)\b/.test(p)) {
    return 3;
  }
  if (/\b(?:fourth|4th)\s+(?:finding|problem|issue|claim|point|item)\b/.test(p) || /\b(?:finding|problem|issue|claim|point|item)\s+(?:4|#4|four)\b/.test(p)) {
    return 4;
  }
  if (/\b(?:fifth|5th)\s+(?:finding|problem|issue|claim|point|item)\b/.test(p) || /\b(?:finding|problem|issue|claim|point|item)\s+(?:5|#5|five)\b/.test(p)) {
    return 5;
  }

  const genericMatch = p.match(/\b(?:finding|problem|issue|claim|point|item)\s+#?(\d+)\b/);
  if (genericMatch) {
    const num = parseInt(genericMatch[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

/**
 * Parse structured findings/claims from raw worker result text.
 */
/**
 * Parse structured findings/claims from raw worker result text.
 *
 * Recognizes numbered finding headers in multiple decorative styles and strips
 * the decoration cleanly from the parsed titles:
 *
 *   === FINDING 1 ===            (decoration only, no title)
 *   === FINDING 1: Title ===     (decoration wrapping a title)
 *   === FINDING 1 === Title      (decoration then trailing title)
 *   **FINDING 1** / **FINDING 1** Title
 *   ## Finding 1: Title
 *   Finding 1: Title             (bare keyword)
 *   Problem 1: Title / Issue 1: Title / Claim 1: Title
 *   1. Title / 1) Title          (bare number)
 *
 * Falls back to bullet points or a single whole-text finding ONLY when no
 * structured finding header is present.
 */
export function parseFindingsFromText(text: string): GroundedFinding[] {
  if (!text || typeof text !== 'string') return [];

  const findings: GroundedFinding[] = [];
  const lines = text.split('\n');

  let currentFinding: { index: number; title: string; lines: string[] } | null = null;

  const keywordHeaderRegex = /^(?:Finding|Problem|Issue|Claim|Defect|Vulnerability|Bug)\b\s*#?\s*(\d+)\b\s*[:.)\-–—]*\s*[=*#]*\s*(.*)$/i;
  const numberedHeaderRegex = /^(\d+)\s*[.)]\s*(.+)$/;

  const stripDecoration = (s: string): string => {
    let out = s.trim();
    out = out.replace(/^[=*#]+[ \t]*/, '');
    out = out.replace(/[ \t]*[=*#]+$/, '');
    return out.trim();
  };

  const cleanTitle = (t: string): string =>
    t.trim().replace(/^[=*#\s]+/, '').replace(/[=*#\s]+$/, '').trim();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const decorated = /^[=*#]/.test(line);
    const stripped = stripDecoration(line);
    const kw = stripped.match(keywordHeaderRegex);
    const num = kw ? null : stripped.match(numberedHeaderRegex);

    if (kw || num) {
      if (currentFinding) {
        const raw = currentFinding.lines.join('\n').trim();
        findings.push({
          index: currentFinding.index,
          title: currentFinding.title,
          claim: raw,
          raw,
        });
      }
      let index: number;
      let title: string;
      if (kw) {
        index = parseInt(kw[1], 10);
        title = cleanTitle(kw[2] || '');
      } else {
        index = parseInt(num![1], 10);
        title = cleanTitle(num![2] || '');
      }
      currentFinding = { index, title, lines: [line] };
    } else if (decorated) {
      // A decorated line that is NOT a finding header (e.g. "=== Additional
      // observations ===") ends the findings section — stop so trailing bullets
      // are never absorbed into (or mistaken for) a finding.
      break;
    } else if (currentFinding) {
      currentFinding.lines.push(line);
    }
  }

  if (currentFinding) {
    const raw = currentFinding.lines.join('\n').trim();
    findings.push({
      index: currentFinding.index,
      title: currentFinding.title,
      claim: raw,
      raw,
    });
  }

  // Fallback: only when NO structured finding header was found.
  if (findings.length === 0 && text.trim().length > 20) {
    const bulletLines = lines.filter((l) => /^\s*[*\-•]\s+/.test(l));
    if (bulletLines.length >= 2) {
      bulletLines.forEach((bl, idx) => {
        const clean = bl.replace(/^\s*[*\-•]\s+/, '').trim();
        findings.push({
          index: idx + 1,
          title: clean.slice(0, 50),
          claim: clean,
          raw: bl.trim(),
        });
      });
    } else {
      findings.push({
        index: 1,
        title: 'Repository Inspection Finding',
        claim: text.trim(),
        raw: text.trim(),
      });
    }
  }

  return findings;
}

/**
 * Format a typed finding into a compact human-readable block (used both as the
 * `raw` mirror for legacy consumers and inside the delegated verification prompt).
 */
function formatTypedFinding(tf: WorkerFinding): string {
  const lines: string[] = [];
  lines.push(`Finding ID: ${tf.id}`);
  lines.push(`Title: ${tf.title}`);
  if (tf.priority) lines.push(`Priority: ${tf.priority}`);
  if (tf.confidence !== undefined) lines.push(`Confidence: ${tf.confidence}`);
  if (tf.description) lines.push(`Description: ${tf.description}`);
  if (tf.impact) lines.push(`Impact: ${tf.impact}`);
  if (Array.isArray(tf.evidence) && tf.evidence.length > 0) {
    const evidence = tf.evidence.map((e) => {
      const loc = e.lineStart !== undefined
        ? `:${e.lineStart}${e.lineEnd !== undefined && e.lineEnd !== e.lineStart ? `-${e.lineEnd}` : ''}`
        : '';
      return `${e.file}${loc}`;
    }).join(', ');
    lines.push(`Evidence: ${evidence}`);
  }
  return lines.join('\n');
}

/** Convert typed findings into the legacy GroundedFinding[] shape (backward-compatible mirror). */
function typedFindingsToGrounded(typed: WorkerFinding[]): GroundedFinding[] {
  return typed.map((tf, i) => ({
    index: i + 1,
    title: tf.title,
    claim: tf.description || tf.title,
    raw: formatTypedFinding(tf),
  }));
}

/**
 * Build a `GroundedWorkerContext` from a graph-resolved reference. The typed
 * findings come from the persisted `execution_results.structured_output` (never
 * from conversation text), so the verification handoff is graph-first.
 */
export function buildWorkerContextFromReference(
  ref: ResolvedResultReference,
  conversationId: string,
  worker: 'codex' | 'hermes' = 'codex',
): GroundedWorkerContext | null {
  if (!ref.result) return null;
  const s = (ref.result.structuredOutput || {}) as any;
  const typedFindings: WorkerFinding[] = Array.isArray(s.findings) ? s.findings : [];
  return {
    worker,
    goalId: ref.goalId,
    conversationId,
    rawText: ref.result.summary || '',
    findings: typedFindingsToGrounded(typedFindings),
    typedFindings,
    findingsSource: 'structured',
    executionResultId: ref.result.id,
    runId: ref.runId,
  };
}

/**
 * Resolve the verification target for a follow-up/verify prompt from the
 * persisted result graph. Returns both the graph reference (for resolution
 * evidence + clarification) and a ready-to-use handoff context.
 *
 * This is graph-first: it targets the ANALYSIS result, never the most recent
 * verification result, and returns a clarification when the reference is
 * genuinely ambiguous.
 */
export function resolveVerificationContext(
  conversationId: string,
  prompt: string,
  findingIndexHint?: number | null,
): { context: GroundedWorkerContext | null; reference: ResolvedResultReference } {
  const reference = resolveResultReference({
    conversationId,
    worker: 'codex',
    userPrompt: prompt,
    expectedResultType: 'analysis',
    findingIndexHint,
  });
  if (!reference.result || reference.clarification) {
    return { context: null, reference };
  }
  return { context: buildWorkerContextFromReference(reference, conversationId), reference };
}

/**
 * Resolve typed findings from the authoritative execution result for a CodeX
 * goal (execution_results.structured_output.findings). Returns null when no
 * structured findings exist — i.e. historical rows that only carry
 * natural-language finalAnswer.
 */
function resolveStructuredFindings(
  goalId?: string,
  executionResultId?: string,
): { typedFindings: WorkerFinding[]; executionResultId: string; runId: string } | null {
  try {
    let result: ExecutionResultRecord | null = null;
    let runId = '';

    if (goalId) {
      const run = executionRunService.getRunByAgentInstanceId(goalId);
      if (run) {
        runId = run.id;
        result = executionRunService.getResultForRun(run.id);
      }
    }
    if (!result && executionResultId) {
      result = executionRunService.getResult(executionResultId);
      runId = result?.runId ?? '';
    }

    if (!result?.structuredOutput) return null;
    const findings = (result.structuredOutput as any).findings;
    if (!Array.isArray(findings) || findings.length === 0) return null;

    return {
      typedFindings: findings as WorkerFinding[],
      executionResultId: result.id,
      runId,
    };
  } catch (err: any) {
    logger.debug(`[workerContextHandoff] Structured findings lookup failed (best-effort): ${err?.message}`);
    return null;
  }
}


/**
 * Resolve previous grounded worker result for a conversation.
 *
 * Resolution order:
 *  1. Same conversation messages (conversation_messages where role = 'agent' and routed_agent = 'codex' or groundedEvidence = true)
 *  2. Latest relevant completed goal in same conversation from goalStore
 *  3. Matching routed worker (codex / hermes)
 *  4. Most recent completed result
 */
export async function resolvePreviousWorkerResult(
  conversationId: string,
  requestedWorker: 'codex' | 'hermes' = 'codex'
): Promise<GroundedWorkerContext | null> {
  if (!conversationId) return null;

  try {
    const msgs = await conversationService.getMessages(conversationId);
    if (Array.isArray(msgs) && msgs.length > 0) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || typeof m.content !== 'string') continue;

        const role = m.role;
        const routedAgent = m.routedAgent || (m.metadata as any)?.worker || (m.metadata as any)?.routedAgent;
        const meta = (m.metadata || {}) as any;

        const isGroundedWorkerResult =
          role === 'agent' &&
          (routedAgent === requestedWorker || meta.worker === requestedWorker) &&
          (meta.groundedEvidence === true ||
            meta.workerResult === true ||
            meta.intent?.category === 'repository_analysis' ||
            meta.intent?.category === 'repository_verification' ||
            m.goalId);

        if (isGroundedWorkerResult && m.content.trim().length > 30) {
          // Exclude short acknowledgment or transitional messages
          if (
            m.content.includes("I'll inspect the repository") ||
            m.content.includes("I'm inspecting") ||
            m.content.includes('Understood. I will not repeat')
          ) {
            continue;
          }

          const goalId = m.goalId || meta.goalId;
          const executionResultId = meta.executionResultId;

          // 1. AUTHORITATIVE: resolve typed findings from the canonical
          //    execution result (structured_output.findings). Conversation
          //    content is NOT parsed in this path.
          const structured = resolveStructuredFindings(goalId, executionResultId);
          if (structured) {
            logger.debug(`[workerContextHandoff] Resolved findings from structured_output (goal ${goalId || 'unknown'}, result ${structured.executionResultId})`);
            return {
              worker: requestedWorker,
              goalId,
              messageId: m.id,
              conversationId,
              category: meta.intent?.category || 'repository_analysis',
              rawText: m.content,
              findings: typedFindingsToGrounded(structured.typedFindings),
              typedFindings: structured.typedFindings,
              findingsSource: 'structured',
              executionResultId: structured.executionResultId,
              runId: structured.runId || undefined,
              createdAt: m.createdAt,
            };
          }

          // 2. LEGACY FALLBACK: historical rows without typed findings.
          const findings = parseFindingsFromText(m.content);
          return {
            worker: requestedWorker,
            goalId,
            messageId: m.id,
            conversationId,
            category: meta.intent?.category || 'repository_analysis',
            rawText: m.content,
            findings,
            findingsSource: 'legacy_text_fallback',
            createdAt: m.createdAt,
          };
        }
      }
    }
  } catch (err: any) {
    logger.warn('[workerContextHandoff] Message resolution failed (best-effort):', err.message);
  }

  // Fallback: check goalStore for completed goals in this conversation
  try {
    const goals = goalStore.listByConversation(conversationId, 5) || [];
    const completedGoal = goals.find((g: any) => g.status === 'completed');
    if (completedGoal) {
      const summary = completedGoal.runSummary as any;
      const text = String(summary?.finalAnswer || summary?.message || '');

      // Prefer structured findings from the canonical result if present.
      const structured = resolveStructuredFindings(completedGoal.id);
      if (structured) {
        return {
          worker: requestedWorker,
          goalId: completedGoal.id,
          conversationId,
          category: 'repository_analysis',
          rawText: text,
          findings: typedFindingsToGrounded(structured.typedFindings),
          typedFindings: structured.typedFindings,
          findingsSource: 'structured',
          executionResultId: structured.executionResultId,
          runId: structured.runId || undefined,
          createdAt: completedGoal.createdAt,
        };
      }

      if (text.trim().length > 30) {
        const findings = parseFindingsFromText(text);
        return {
          worker: requestedWorker,
          goalId: completedGoal.id,
          conversationId,
          category: 'repository_analysis',
          rawText: text,
          findings,
          findingsSource: 'legacy_text_fallback',
          createdAt: completedGoal.createdAt,
        };
      }
    }
  } catch (err: any) {
    logger.warn('[workerContextHandoff] Goal store resolution failed (best-effort):', err.message);
  }

  return null;
}

/**
 * Construct the explicit delegated verification payload for CodeX.
 *
 * Ensures CodeX receives concrete findings to verify directly against source files
 * and never searches for a missing markdown report document.
 */
export function buildDelegatedVerificationPrompt(
  prompt: string,
  context: GroundedWorkerContext,
  findingIndex?: number | null
): string {
  const typed = context.typedFindings && context.typedFindings.length > 0 ? context.typedFindings : null;

  let findingScopeHeader: string;
  let findingsText: string;

  if (typed) {
    // AUTHORITATIVE: findings sourced from execution_results.structured_output.
    let selected = typed;
    findingScopeHeader = `PREVIOUS GROUNDED CODEX FINDINGS TO VERIFY (Source: structured_output, Originating Goal: ${context.goalId || 'previous_analysis'}):`;
    if (findingIndex !== null && findingIndex !== undefined && findingIndex > 0) {
      const idx = findingIndex - 1;
      if (idx >= 0 && idx < typed.length) {
        selected = [typed[idx]];
        findingScopeHeader = `PREVIOUS GROUNDED CODEX FINDING TO VERIFY (Finding #${findingIndex} of ${typed.length}, Source: structured_output, Originating Goal: ${context.goalId || 'previous_analysis'}):`;
      }
    }
    findingsText = selected.map((tf) => formatTypedFinding(tf)).join('\n\n');
  } else {
    // LEGACY FALLBACK: GroundedFinding[] (regex-parsed conversation text).
    let targetFindings = context.findings;
    findingScopeHeader = `PREVIOUS GROUNDED CODEX FINDINGS TO VERIFY (Originating Goal: ${context.goalId || 'previous_analysis'}):`;
    if (findingIndex !== null && findingIndex !== undefined && findingIndex > 0) {
      const selected = context.findings.find((f) => f.index === findingIndex);
      if (selected) {
        targetFindings = [selected];
        findingScopeHeader = `PREVIOUS GROUNDED CODEX FINDING TO VERIFY (Finding #${findingIndex} of ${context.findings.length}, Originating Goal: ${context.goalId || 'previous_analysis'}):`;
      }
    }
    findingsText = targetFindings.length > 0
      ? targetFindings.map((f) => f.raw || `${f.index}. ${f.title}: ${f.claim}`).join('\n\n')
      : context.rawText;
  }

  return [
    'READ-ONLY CODEX TASK.',
    'Inspect, analyze, read, and report only.',
    'Do not write, patch, delete, run side-effect commands, deploy, or change configuration.',
    '',
    findingScopeHeader,
    findingsText,
    '',
    'VERIFICATION INSTRUCTIONS (MANDATORY):',
    '1. Source code files in the repository are the ground truth evidence targets.',
    '2. CRITICAL: Do NOT search for a markdown document, report file, or text summary of the previous analysis (e.g. do not search for "CodeX report" or "production problem report" files). The findings above are hypotheses to test directly against source code using readFile and searchFiles.',
    '3. For each finding listed above, independently inspect the relevant repository source files to verify whether the claimed defect/issue actually exists.',
    '4. For each finding, determine one of the following decisions:',
    '   - VERIFIED: Concrete code evidence in the repository confirms the problem exists as described.',
    '   - PARTIALLY VERIFIED: Code evidence confirms aspects of the issue, but with qualifications, partial scope, or lower severity.',
    '   - NOT VERIFIED: Source code files do not support the claim, or the issue is absent/resolved.',
    '5. In your final report, provide for each finding:',
    '   - Finding ID: the EXACT finding id listed above (e.g. "finding-2")',
    '   - Decision: VERIFIED | PARTIALLY VERIFIED | NOT VERIFIED',
    '   - Files Inspected: exact relative paths inspected',
    '   - Concrete Evidence: code snippets, line numbers, or specific symbols found',
    '   - Technical Assessment: whether the evidence supports the claim and why',
    '   - Production Impact & Priority: operational assessment',
    '',
    'IMPORTANT — for each finding, begin its section with a line of the form `Finding ID: finding-N` so the verdict can be matched back to the exact finding (never rely on matching by title text).',
    '',
    'Original User Request:',
    prompt,
  ].join('\n');
}

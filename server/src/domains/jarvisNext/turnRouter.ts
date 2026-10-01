/**
 * turnRouter.ts — the single runtime hierarchy for a JARVIS turn.
 *
 *   USER TURN → context/focus → entity resolution → classification →
 *      { FAST READ | ACTION | UNKNOWN | CHAT | DEEP }
 *
 * It owns no intelligence and no storage of its own: reads come from the
 * authoritative providers (projectStateContext), actions call the existing
 * capability services, and anything needing reasoning is handed to Supervisor V2
 * through groundedTurnBridge. Conversation focus reuses the existing
 * jarvis_dialogue_state store for the active entity.
 */

import { logger } from '../../utils/logger.js';
import { getBuildIdentity } from '../../services/buildIdentity.js';
import {
  buildProjectStateContext,
  classifyReadIntent,
  isProjectStateRequest,
} from '../jarvis/projectStateContext.js';
import type { PresentedBlocker } from '../../services/projectExecution/projectController.js';
import type { TurnExecutionResult } from '../jarvis/execution/types.js';
import { stripWakeWord } from './wakeWord.js';
import { detectControlIntent, isLikelyControlAttempt } from './controlIntentDetector.js';
import { bump } from './jarvisHealth.js';

/**
 * ── STATE-CHANGING TARGET RESOLUTION (P0 cross-project guard) ──────────────
 *
 * A live turn ("start the project shop by." — STT for Shopify) silently operated
 * the STALE active project (Free Cash) because the operate branch treated an
 * entity INHERITED from conversation focus exactly like an explicit mention.
 *
 * Precedence, enforced here and nowhere else:
 *   1. explicit current-turn entity (exact or near-miss) wins, always
 *   2. an entity inherited from focus is only valid when the turn actually
 *      refers back to it ("continue", "start it", "same project")
 *   3. anything else — a mention we could not match — ABORTS: never execute a
 *      state change against a project the user did not ask for
 */
const CONTINUATION_RE =
  /\b(?:continue|proceed|next|resume|again|now|go\s+on|carry\s+on|it|that|this|those|them|same|the\s+project)\b/i;

const NON_ENTITY_WORDS = new Set([
  'codex', 'hermes', 'revenue', 'operator', 'agentic', 'agenticos', 'jarvis',
]);

const ACTION_STOPWORDS = new Set([
  'start', 'started', 'run', 'running', 'launch', 'activate', 'resume', 'operate', 'work', 'working',
  'continue', 'proceed', 'get', 'moving', 'go', 'on', 'carry', 'the', 'a', 'an', 'project', 'projects',
  'it', 'its', 'that', 'this', 'those', 'them', 'same', 'one', 'please', 'jarvis', 'now', 'again',
  'with', 'okay', 'ok', 'and', 'to', 'for', 'of', 'my', 'me', 'let', 'us', 'do', 'does', 'can',
  'you', 'would', 'could', 'stop', 'halt', 'kill', 'cancel', 'pause', 'shut', 'down', 'on', 'up',
]);

/** Words in the utterance that are not action/continuation scaffolding. */
export function residualMention(lower: string): string {
  return lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !ACTION_STOPWORDS.has(w) && !NON_ENTITY_WORDS.has(w))
    .join(' ');
}

export interface StateChangingTarget {
  projectId?: string;
  ask?: string;
  reason: 'explicit' | 'continuation' | 'unmatched_mention' | 'no_project_context';
}

export function resolveStateChangingTarget(params: {
  explicitProjectId?: string;
  entityId?: string;
  entityType?: string;
  projectScopeSource?: string;
  lower: string;
  activeProjectId?: string;
  activeProjectName?: string;
}): StateChangingTarget {
  const { explicitProjectId, entityId, entityType, projectScopeSource, lower, activeProjectId, activeProjectName } = params;
  const explicit = projectScopeSource === 'explicit' ? (explicitProjectId || entityId) : undefined;

  // 1. EXPLICIT current-turn entity always wins over stale context.
  if (explicit && (entityType === 'project' || projectScopeSource === 'explicit')) {
    if (explicit !== activeProjectId) {
      logger.info('[TurnRouter] STATE_CHANGE_ENTITY explicit overrides stale context', {
        resolvedProjectId: explicit, staleActiveProjectId: activeProjectId || null,
      });
    }
    return { projectId: explicit, reason: 'explicit' };
  }

  const residual = residualMention(lower);

  // 2. Continuation: the turn refers back to the conversation entity.
  if (!residual && CONTINUATION_RE.test(lower) && activeProjectId) {
    return { projectId: activeProjectId, reason: 'continuation' };
  }

  // 3. An unmatched mention must never silently become another project.
  if (residual) {
    bump('cross_project_execution_blocked');
    logger.warn('[TurnRouter] STATE_CHANGE_ABORTED unmatched entity mention — no execution', {
      residualMention: residual, staleActiveProjectId: activeProjectId || null, utterance: lower,
    });
    return {
      reason: 'unmatched_mention',
      ask: `I couldn't match "${residual}" to a project I know, so I haven't started anything. Which project do you mean — ${activeProjectName ? `${activeProjectName}, ` : ''}Shopify, Free Cash or TikTok Shop?`,
    };
  }

  // 4. No entity at all and nothing to continue.
  bump('cross_project_execution_blocked');
  logger.warn('[TurnRouter] STATE_CHANGE_ABORTED no project context', { utterance: lower });
  return {
    reason: 'no_project_context',
    ask: 'Which project should I start?',
  };
}

export type TurnRoute =
  | 'chat_trivial'
  | 'immediate_memory'
  | 'fast_read'
  | 'navigate'
  | 'browser'
  | 'action'
  | 'unknown_entity'
  | 'deep_supervisor'
  | 'refusal'
  | 'project_operate'
  | 'blocker_detail_read'
  | 'system_self_diagnose'
  | 'engineering.antigravity'
  | 'read_foreground_screen'
  | 'engineering_delegation';

export interface TurnResult {
  handled: boolean;
  text: string;
  route: TurnRoute;
  evidence: boolean;
  executed: boolean;
  verified: boolean;
  entityId?: string;
  entityType?: string;
  entityName?: string;
  uiRoute?: string;
  fallbackReason?: string;
  timings: Record<string, number>;
  goalId?: string;
  requestedGoals?: string[];
  executedGoals?: string[];
  satisfiedGoals?: string[];
  failedGoals?: string[];
}

export interface OfferedChoice {
  id: string;
  label: string;
  intent: string;
  args: Record<string, unknown>;
}

export interface TurnFocus {
  activeEntityId?: string;
  activeEntityType?: string;
  activeEntityName?: string;
  /** Last resolved PROJECT, tracked separately from the general entity focus so
   *  a project-scoped read is never widened just because the most recent entity
   *  happened to be an opportunity or capability. */
  activeProjectId?: string;
  activeProjectName?: string;
  lastUserTurn?: string;
  lastAssistantTurn?: string;
  lastOperationalIntent?: string;
  pendingChoices?: OfferedChoice[];
  /**
   * The question Jarvis last asked and is still waiting on. Cleared when
   * resolved, cancelled, superseded by a clearly new goal, or expired.
   */
  pendingClarification?: {
    kind: string;
    targetName?: string;
    targetType?: string;
    intendedAction?: string;
    attempt: number;
    askedAt: number;
    options?: string[];
  };
  userTurns?: string[];
  lastRequestedAction?: string;
  lastNavigationTarget?: {
    entityId: string;
    entityType: string;
    entityName: string;
    route?: string;
    verified: boolean;
  };

  // Structured blocker context (§1)
  lastPresentedBlockers?: PresentedBlocker[];
  activeBlockerId?: string;
  activeBlockerTitle?: string;
  activeBlockerReason?: string;
  activeBlockerMetadata?: Record<string, unknown>;
  activeBlockerDependencies?: string[];
  activeBlockerObjective?: string;
  activeBlockerWorker?: string;

  // ── CONTINUATION STATE (F1) ──────────────────────────────────────────
  // ONE authoritative record of what just happened, so a short follow-up
  // ("Why not?", "Check its status.", "Now TikTok Shop.") resolves against the
  // previous turn instead of being classified as an unrelated new command.
  lastResolvedEntityId?: string;
  lastResolvedEntityName?: string;
  lastResolvedEntityType?: string;
  lastResolvedAction?: string;
  lastExecutionResult?: {
    success: boolean;
    verified: boolean;
    route?: string;
    entityId?: string;
    entityName?: string;
    at: number;
  };
  /** Why the last action failed — executor detail, never invented. */
  lastFailureReason?: string;
  lastFailureAt?: number;
  lastVerificationState?: 'verified' | 'unverified' | 'failed' | 'unknown';
  /** What KIND of question the pending clarification is (F5). */
  clarificationType?: 'yes_no' | 'choice' | 'open_ended';
  /** Options offered by the pending clarification (mirror of its `options`). */
  offeredOptions?: string[];
  /** Active operational goal surviving obstacles until completed (§5). */
  activeOperationalGoal?: {
    originalGoal: string;
    currentStep: string;
    browserState?: any;
    blocker: string | null;
    recoveryAction: string | null;
    nextStep: string | null;
    startedAt: number;
    updatedAt: number;
  } | null;
}

const focusByConversation = new Map<string, TurnFocus>();

export function getFocus(conversationId: string): TurnFocus {
  let f = focusByConversation.get(conversationId);
  if (!f) { f = {}; focusByConversation.set(conversationId, f); }
  return f;
}

/**
 * THE single writer of continuation state (F1). Both the router and the tests
 * go through this, so production and tested behaviour cannot drift apart.
 * On FAILURE the referent is retained (F2) — that is what makes "Why not?"
 * answerable on the next turn.
 */
export function applyTurnResultToFocus(focus: TurnFocus, uResult: TurnExecutionResult | undefined): void {
  if (!uResult) return;

  if (uResult.lastResolvedEntityName || uResult.entityName) {
    focus.lastResolvedEntityName = uResult.lastResolvedEntityName || uResult.entityName;
    focus.lastResolvedEntityId = uResult.lastResolvedEntityId ?? uResult.entityId ?? focus.lastResolvedEntityId;
    focus.lastResolvedEntityType = uResult.lastResolvedEntityType ?? focus.lastResolvedEntityType;

    focus.activeEntityName = focus.lastResolvedEntityName;
    focus.activeEntityId = focus.lastResolvedEntityId;
    focus.activeEntityType = focus.lastResolvedEntityType;
    if (focus.lastResolvedEntityType === 'project' || focus.lastResolvedEntityId?.startsWith('proj-') || !focus.lastResolvedEntityType) {
      focus.activeProjectId = focus.lastResolvedEntityId;
      focus.activeProjectName = focus.lastResolvedEntityName;
    }
  }
  if (uResult.lastResolvedAction) focus.lastResolvedAction = uResult.lastResolvedAction;

  const pb = (uResult as any).presentedBlockers || (uResult.execution as any)?.data?.presentedBlockers || (uResult as any).data?.presentedBlockers;
  if (pb && Array.isArray(pb) && pb.length > 0) {
    focus.lastPresentedBlockers = pb;
    focus.activeBlockerId = pb[0].taskId;
    focus.activeBlockerTitle = pb[0].title;
    focus.activeBlockerReason = pb[0].reason;
    focus.activeBlockerMetadata = pb[0].metadata;
    focus.activeBlockerDependencies = pb[0].dependencyIds;
    focus.activeBlockerObjective = pb[0].objective;
    focus.activeBlockerWorker = pb[0].worker;
  }

  if (uResult.lastExecutionResult) {
    focus.lastExecutionResult = uResult.lastExecutionResult;
    focus.lastVerificationState =
      uResult.lastVerificationState ??
      (uResult.lastExecutionResult.verified ? 'verified' : uResult.lastExecutionResult.success ? 'unverified' : 'failed');
    if (uResult.lastExecutionResult.success) {
      // A verified success clears the failure record; a failure keeps it.
      focus.lastFailureReason = undefined;
      focus.lastFailureAt = undefined;
    }
  }
  if (uResult.lastFailureReason) {
    focus.lastFailureReason = uResult.lastFailureReason;
    focus.lastFailureAt = uResult.lastFailureAt ?? Date.now();
    focus.lastVerificationState = uResult.lastVerificationState ?? 'failed';
  }

  if (uResult.pendingClarification) {
    focus.pendingClarification = uResult.pendingClarification;
    focus.clarificationType =
      uResult.pendingClarification.clarificationType ??
      ((uResult.pendingClarification.options?.length || 0) > 1 ? 'choice' : 'yes_no');
    focus.offeredOptions = uResult.pendingClarification.options;
    // Keep the legacy offered-choice list in sync from the ONE source.
    focus.pendingChoices = (uResult.pendingClarification.options || []).map((label, i) => ({
      id: String(i + 1),
      label,
      intent: uResult.pendingClarification?.intendedAction || 'clarify',
      args: {},
    }));
  } else if (uResult.clearPendingClarification) {
    focus.pendingClarification = undefined;
    focus.clarificationType = undefined;
    focus.offeredOptions = undefined;
    focus.pendingChoices = undefined;
  }
}

// ───────────────────────────────────────────────────────────
// JARVIS TRACE MARKER PROTOCOL — Do Not Remove

export const TRACE_MARKERS = [
  '01_turnRouterEntered',      // handleUserTurn invoked
  '02_rawInput',              // after stripWakeWord
  '03_sttConfidenceReceived', // Deepgram confidence value (if STT active)
  '04_goalParseResult',       // semanticGoalParser output
  '05_goalConfidenceValue',   // plan.confidence
  '06_uECInvoked',            // universalExecutionController.handleUserTurn called
  '07_actionPlanGenerated',   // ActionPlan from parsing stage
  '08_executorSelected',      // internal_agenticos identified
  '09_internalExecutorEntered','10_projectResolutionAttempt',       // buildProjectStateContext or projectStore.getProject()
  '11_entityIdResolved',      // result.entityId (null = failure)
  '12_projectRecordLoaded',   // EvidencePack.project record data
  '13_directAnswerGenerated', // Project insight/context text
  '14_executorExitStatus',    // internalAgenticOSExecutor success/fail reason
  '15_finalSpokenResponse',   // What JARVIS actually says
] as const;

export type TraceMarker = (typeof TRACE_MARKERS)[number];

// Helper to emit structured trace lines only for live requests
const emitTrace = (marker: TraceMarker, data: Record<string, unknown>): void => {
  if (!data.rawTurn || !TRACE_MARKERS.includes(marker as TraceMarker)) return; // Avoid logs on unit tests
  
  const base = `[JTRACE-${marker.toString().padStart(3, '0')}]`;
  console.log(`${base} ENTRY:`, data); // Minimal structured log
};

// JTRACE MARKER HELPER - DO NOT MODIFY EXISTING LOGIC
const addTrace = (marker: string, data: Record<string, any>): void => {
  const traceLine = `[JTRACE-${marker}] ${JSON.stringify(data)}`;
  console.log(traceLine);
}

export function setOfferedChoices(conversationId: string, choices: OfferedChoice[]): void {
  getFocus(conversationId).pendingChoices = choices;
}

/* ── classification helpers ─────────────────────────────────────────────── */

const GREETING_RE = /^\s*(?:hey\s+|hi\s+|hello\s+)?(?:jarvis|javis|jarves|jarviss)[.!?]*$/i;
const PRONOUN_RE = /\b(it|its|it's|that|this|them|they)\b/i;
const NAVIGATION_RE = /^\s*(?:(?:hey|ok(?:ay)?|hi|hello)\s+)?(?:jarvis|javis|jarves)?[,\s:]*(?:no[,\s]+|instead[,\s]+|actually[,\s]+|wait[,\s]+|can you\s+|could you\s+|please\s+|i would like to\s+|i want to\s+|i'd like to\s+|let me\s+|can i\s+)*(open|show|go\s+back\s+to|back\s+to|return\s+to|go\s+to|select|switch\s+to|display|focus(?: on)?|see|view|bring\s+up)\b/i;
const NEVER_SELFHEAL_RE = /\b(open|show|view|see|select|focus|go to|tell me about|list|inspect|what is|what's|where is|where's)\b/i;
const ACTION_RE = /\b(start|stop|pause|resume|launch|activate|run|set|change|update|move|rename|assign|delete|prioriti[sz]e|teleport|kill|rebuild|restart|clear|reset|operate|work|continue|proceed|do|resolve|fix|address)\b/i;

export const PROJECT_OPERATE_RE =
  /\b(?:start\s+(?:operating|working)(?:\s+(?:inside|on|in))?|operate(?:\s+(?:inside|on|in))?|work(?:\s+(?:inside|on|in))?|continue(?:\s+working)?(?:\s+(?:inside|on|in))?|get\s+.+\s+moving|proceed(?:\s+with)?|do\s+the\s+work)\b/i;

export const PROJECT_STOP_RE =
  /\b(?:stop|pause|halt|cancel)\s+(?:the\s+project|project\s+execution|all\s+work|(?:working|operating)(?:\s+(?:on|in|inside)(?:\s+it)?)?)\b/i;

export const RESOLVE_BLOCKER_RE =
  /\b(?:resolve|fix|address|clear|solve)\s+(?:the\s+)?(?:first\s+)?(?:blocker|dependency|it|that|this|issue|problem)\b/i;

export const BLOCKER_DETAIL_RE =
  /\b(?:which\s+(?:one|task|api|credential|service)|for\s+which(?:\s+one)?|which\s+api(?:\s+key)?s?|what\s+(?:credentials?|api(?:\s+keys?)?|is\s+(?:that|the)\s+blocker|task\s+is\s+blocked|exactly\s+is\s+missing)|why\s+(?:is\s+(?:it|that|the\s+task|the\s+blocker|that\s+blocker)\b|does\s+it\s+need\s+(?:them|credentials|api\s*keys?)|are\s+they\s+needed|can'?t\s+it\s+proceed)|who\s+needs\s+(?:them|the\s+credentials|the\s+api\s*keys?)|where\s+do\s+i\s+get\s+them|what\s+credentials\s+are\s+missing)\b/i;

export const NATURAL_BLOCKER_REF_RE =
  /\b(?:that\s+one|the\s+blocker|that\s+blocker|the\s+api\s+issue|that\s+credentials?\s+problem|the\s+blocked\s+task)\b/i;
const ARITHMETIC_RE = /^\s*(?:(?:and\s+)?(?:what(?:'s| is)|how much(?:'s| is)|calculate|compute)\s+)?(-?\d+(?:\.\d+)?|[a-z]+)\s*([+\-*/x×]|plus|minus|times|multiplied by|divided by)\s*(-?\d+(?:\.\d+)?|[a-z]+)\s*\??\s*$/i;
const REPEAT_RE = /\b(repeat|say again|what did i (?:just )?say)\b/i;
const CHOICE_RE = /\b(?:the\s+)?(first|second|third|1st|2nd|3rd|one|two|three)\b/i;
const UNKNOWN_ENTITY_RE = /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)\s+([Oo]perator|[Pp]roject|[Aa]gent|[Ee]ngine)\b/;
/** Leading words that are grammar, not part of an entity name. */
const NAME_STOPWORD = /^(which|what|where|who|when|the|this|that|is|are|does|do|start|stop|pause|resume|find|open|set|show|locate|tell|give|run|launch|activate|a|an|rename|change|update|modify|delete|remove)$/i;

const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNumOrWord(w: string): number | null {
  const lower = (w || '').toLowerCase().trim();
  if (WORD_NUMS[lower] !== undefined) return WORD_NUMS[lower];
  const n = parseFloat(lower);
  return isNaN(n) ? null : n;
}

/** Extract a genuinely named entity, or null when the match was only grammar. */
function extractNamedEntity(prompt: string): { name: string; kind: string } | null {
  const m = prompt.match(UNKNOWN_ENTITY_RE);
  if (!m) return null;
  const words = m[1].split(/\s+/).filter(Boolean);
  while (words.length && NAME_STOPWORD.test(words[0])) words.shift();
  if (!words.length) return null;
  return { name: words.join(' '), kind: m[2].toLowerCase() };
}
/** Repository/code-level questions that project state cannot answer. */
const CODE_INSPECTION_RE = /\b(in the code|in code|source code|codebase|which file|what file|where .*implemented|implementation live|repository)\b/i;

function evalArithmetic(text: string): string | null {
  const m = text.match(ARITHMETIC_RE);
  if (!m) return null;
  const a = parseNumOrWord(m[1]); const b = parseNumOrWord(m[3]);
  if (a === null || b === null) return null;
  const op = m[2].toLowerCase();
  const v = (op === '+' || op === 'plus')
    ? a + b
    : (op === '-' || op === 'minus')
    ? a - b
    : (op === '*' || op === 'x' || op === '×' || op === 'times')
    ? a * b
    : b === 0 ? NaN : a / b;
  if (!Number.isFinite(v)) return null;
  return `${Number.isInteger(v) ? v : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function choiceIndex(text: string): number | null {
  const m = text.match(CHOICE_RE);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w === 'first' || w === '1st' || w === 'one') return 0;
  if (w === 'second' || w === '2nd' || w === 'two') return 1;
  if (w === 'third' || w === '3rd' || w === 'three') return 2;
  return null;
}

function isDeclarativeStatement(text: string): boolean {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (t.endsWith('?')) return false;
  if (/^(what|who|where|when|why|how|which|is|are|do|does|can|could|would|will|did|have|has|should)\b/i.test(lower)) return false;
  if (/^(start|stop|pause|resume|launch|activate|run|open|set|change|update|move|rename|assign|delete|prioriti[sz]e|find|locate|search|list|show|check|audit|create|make|execute|delegate|repeat|tell|go|switch|focus|teleport|see|view|bring|continue|proceed|work|operate|do)\b/i.test(lower)) return false;
  if (/\b(what projects|what is blocked|what is running|what is it doing|what missions|why can'?t)\b/i.test(lower)) return false;
  if (/\b(open|set|start|run|launch|prioriti[sz]e|go to|switch to|show|focus|see|view|bring up|work|operate|continue|proceed)\b/i.test(lower) && /\b(free cash|freecash|shopify|tiktok|hermes|revenue operator)\b/i.test(lower)) return false;
  if (/\b(i would like to|i'd like to|i want to|can i|could you|let me|please)\b/i.test(lower)) return false;
  if (/\b(need|want|see|look|open|show|board|bot|telegram|screenshot|screen|comet|perplexity|camera|save|memory|desktop|window|front)\b/i.test(lower)) return false;
  return /^(the|a|an|my|our|this|that|these|those|we|i|you|he|she|it|they)\b/i.test(lower);
}

function parseHistoricalQuery(text: string, userTurns: string[]): string | null {
  const lower = text.toLowerCase().trim();
  const m = lower.match(/what (?:did|was) i (?:ask(?:ing)?(?: about)?|say)(?: you)? before (?:i )?(.+?)[.?]?$/i);
  if (!m) return null;
  const target = m[1].trim().toLowerCase();
  let targetIdx = -1;

  if (target.includes('model') || target.includes('ai model')) {
    let foundIdx = -1;
    for (let i = userTurns.length - 1; i >= 0; i--) {
      const turnLower = userTurns[i].toLowerCase();
      if (turnLower.includes('model') || turnLower.includes('provider')) {
        foundIdx = i;
      } else if (foundIdx !== -1) {
        break;
      }
    }
    targetIdx = foundIdx;
  } else if (target.includes('start') && target.includes('revenue')) {
    for (let i = userTurns.length - 1; i >= 0; i--) {
      const turnLower = userTurns[i].toLowerCase();
      if (turnLower.includes('start') && turnLower.includes('revenue')) {
        targetIdx = i;
        break;
      }
    }
  } else {
    for (let i = userTurns.length - 1; i >= 0; i--) {
      const turnLower = userTurns[i].toLowerCase();
      if (turnLower.includes(target) || target.includes(turnLower)) {
        targetIdx = i;
        break;
      }
    }
  }

  if (targetIdx > 0) {
    const priorTurn = userTurns[targetIdx - 1];
    if (target.includes('revenue')) {
      return `Before starting Revenue Operator, you asked: ${priorTurn}`;
    }
    if (target.includes('model')) {
      return `Before asking about the model, you asked: ${priorTurn}`;
    }
    return `Before that, you asked: ${priorTurn}`;
  }
  return null;
}

/* ── action execution ───────────────────────────────────────────────────── */

interface ActionOutcome {
  executed: boolean;
  verified: boolean;
  text: string;
}

export type DynamicCapabilityHandler = (args: {
  entityId: string;
  entityName: string;
  entityType: string;
  prompt: string;
  lower: string;
  conversationId: string;
}) => Promise<ActionOutcome>;

const dynamicCapabilities = new Map<string, DynamicCapabilityHandler>();

export function registerDynamicCapability(key: string, handler: DynamicCapabilityHandler): void {
  dynamicCapabilities.set(key.toLowerCase(), handler);
  logger.info('[JRT] SELFHEAL_CAPABILITY_RELOADED', { capability: key });
  console.log(`[JRT] SELFHEAL_CAPABILITY_RELOADED capability=${key}`);
}

export function getDynamicCapabilities(): Map<string, DynamicCapabilityHandler> {
  return dynamicCapabilities;
}

/** Parse "set X to priority 4" / "prioritise X as 4". */
function parsePriorityMutation(text: string): number | null {
  const m = text.match(/\bpriority\s+(?:to\s+)?(\d{1,3})\b/i) || text.match(/\bto\s+priority\s+(\d{1,3})\b/i);
  return m ? parseInt(m[1], 10) : null;
}

async function executeSetPriority(projectId: string, projectName: string, priority: number): Promise<ActionOutcome> {
  const { projectsStore } = await import('../../services/projectsStore.js');
  try {
    projectsStore.setPriority(projectId, priority);
    // Read back from the store — a claim of success requires verified state.
    const after: any = projectsStore.getProject(projectId);
    const ok = after && Number(after.priority) === priority;
    return {
      executed: true,
      verified: !!ok,
      text: ok
        ? `Priority updated — ${projectName} is now priority ${after.priority}, and I re-read it from the store to confirm.`
        : `I attempted the change but verification failed: ${projectName} still reads priority ${after?.priority ?? 'unknown'}.`,
    };
  } catch (err: any) {
    return { executed: false, verified: false, text: `I could not update ${projectName}: ${err?.message || err}.` };
  }
}

async function executeStartRevenueOperator(): Promise<ActionOutcome> {
  try {
    const { revenueSupervisor } = await import('../../services/revenueOperator/revenueSupervisor.js');
    if (typeof revenueSupervisor?.setControlState !== 'function') {
      return {
        executed: false, verified: false,
        text: 'I can see Revenue Operator, but no executable start capability is currently connected.',
      };
    }
    const res: any = revenueSupervisor.setControlState('START');
    const status: any = await revenueSupervisor.getStatus?.();
    const state = status?.controlState ?? res?.state;
    const ok = res?.success === true && state === 'ACTIVE';
    return {
      executed: true,
      verified: !!ok,
      text: ok
        ? `Revenue Operator started. I read its supervisor state back and it is now ${state}.`
        : `I issued the start command but verification failed: the supervisor state reads ${state ?? 'unknown'}.`,
    };
  } catch (err: any) {
    return { executed: false, verified: false, text: `Starting Revenue Operator failed: ${err?.message || err}.` };
  }
}

export async function resolveUiRoute(entityId: string, entityType: string): Promise<string | undefined> {
  if (entityId === 'revenue_operator' || entityId === 'revenue-operator' || entityType === 'revenue_operator') {
    return '/revenue-operator';
  }
  if (entityType === 'capability' || entityType === 'operator') {
    const { getCapability } = await import('../jarvis/capabilityRegistry.js');
    const cap = getCapability(entityId as any);
    if (cap?.route) return cap.route;
    if (entityId === 'revenue_operator') return '/revenue-operator';
  }
  if (entityType === 'project') {
    return `/projects?project=${encodeURIComponent(entityId)}`;
  }
  return undefined;
}

export async function executeNavigate(opts: {
  entityId: string;
  entityName: string;
  entityType: string;
  focus: TurnFocus;
  verb?: string;
  navigationVerifier?: (req: {
    navigationId: string;
    route: string;
    entityId: string;
    entityType: string;
    entityName: string;
  }) => Promise<{ verified: boolean; actualRoute?: string; visibleEntityId?: string; activeProjectId?: string; error?: string }>;
}): Promise<{ executed: boolean; verified: boolean; text: string; uiRoute?: string; navigationId: string; actualRoute?: string; activeProjectId?: string; error?: string }> {
  const { entityId, entityName, entityType, focus, navigationVerifier } = opts;
  const uiRoute = await resolveUiRoute(entityId, entityType);
  const navigationId = `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  focus.activeEntityId = entityId;
  focus.activeEntityType = entityType;
  focus.activeEntityName = entityName;

  if (entityType === 'project') {
    focus.activeProjectId = entityId;
    focus.activeProjectName = entityName;
    try {
      const { projectsStore } = await import('../../services/projectsStore.js');
      if (typeof (projectsStore as any).setActiveProjectId === 'function') {
        (projectsStore as any).setActiveProjectId(entityId);
      }
    } catch {
      // ignore
    }
  }

  let verified = false;
  let error: string | undefined;
  let actualRoute: string | undefined;
  let activeProjectId: string | undefined;

  if (uiRoute) {
    if (typeof navigationVerifier === 'function') {
      try {
        const res = await navigationVerifier({
          navigationId,
          route: uiRoute,
          entityId,
          entityType,
          entityName,
        });
        verified = res.verified;
        error = res.error;
        actualRoute = res.actualRoute;
        activeProjectId = res.activeProjectId;
      } catch (err: any) {
        verified = false;
        error = err?.message || String(err);
      }
    } else {
      try {
        const { jarvisNextAgent } = await import('./jarvisNextAgent.js');
        const res = await jarvisNextAgent.requestNavigation({
          navigationId,
          route: uiRoute,
          entityId,
          entityType,
          entityName,
          timeoutMs: 1500,
        });
        verified = res.verified;
        error = res.error;
        actualRoute = (res as { actualRoute?: string }).actualRoute;
        activeProjectId = (res as { activeProjectId?: string }).activeProjectId;
      } catch (err: any) {
        verified = false;
        error = err?.message || String(err);
      }
    }
  } else {
    // TRUTH GATE (A): resolveUiRoute() returned nothing, so no navigation was
    // dispatched and nothing can be verified. Marking this verified=true made
    // every unresolvable target render as "${entityName} is open.".
    verified = false;
    error = 'no_ui_route';
  }

  focus.lastRequestedAction = 'NAVIGATE';
  focus.lastNavigationTarget = {
    entityId,
    entityType,
    entityName,
    route: uiRoute,
    verified,
  };

  let text: string;
  if (verified) {
    text = `${entityName} is open.`;
  } else if (error === 'no_ui_route') {
    text = `I resolved ${entityName}, but there is no AgenticOS view I can open for it.`;
  } else {
    text = `${entityName} is now the active context, but the interface did not navigate successfully.`;
  }

  logger.info('[JRT] NAVIGATE_TRANSACTION_SUMMARY', {
    navigationId,
    entityId,
    entityType,
    uiRoute,
    verified,
    spokenText: text,
    error,
  });

  const result = {
    executed: Boolean(uiRoute),
    verified,
    text,
    uiRoute,
    navigationId,
    actualRoute,
    activeProjectId,
    error,
  };
  logger.info('[JRT] NAVIGATION_TRANSACTION_RESULT', {
    navigationId, uiRoute, verified, actualRoute, activeProjectId, error,
  });
  return result;
}

export function isExpectedActionForEntity(
  verb: string,
  entityType: string,
  entityId?: string,
): { expected: boolean; reason?: string } {
  const v = (verb || '').toLowerCase().trim();

  // DEFECT 1 ROOT CAUSE FIX:
  // User verbs (open, read, inspect, navigate, show, capture, see, find, locate, observe)
  // are valid user goals. They must NOT disqualify an internal execution defect from repair.
  const VALID_USER_GOAL_VERBS = new Set([
    'open',
    'read',
    'inspect',
    'navigate',
    'show',
    'capture',
    'see',
    'find',
    'locate',
    'observe',
    'view',
    'display',
    'focus',
  ]);
  if (VALID_USER_GOAL_VERBS.has(v)) {
    return { expected: true };
  }

  // 2. Project entities
  if (entityType === 'project') {
    const PROJECT_EXPECTED_VERBS = new Set([
      'rename',
      'update',
      'change',
      'set',
      'prioritize',
      'prioritise',
      'priority',
      'archive',
      'delete',
      'assign',
      'move',
      'start',
      'operate',
      'work',
      'continue',
      'stop',
      'pause',
      'run',
      'proceed',
      'do',
      'get',
    ]);
    if (PROJECT_EXPECTED_VERBS.has(v)) {
      return { expected: true };
    }
    return {
      expected: false,
      reason: `Project does not support "${v}". Expected project operations are priority, rename, update, archive, assign, move, operate, work, start, stop, continue.`,
    };
  }

  // 3. Capability / Operator entities (e.g. revenue_operator, hermes, codex)
  if (entityType === 'capability' || entityType === 'operator') {
    const OPERATOR_EXPECTED_VERBS = new Set([
      'start',
      'stop',
      'pause',
      'resume',
      'run',
      'launch',
      'activate',
      'restart',
      'rebuild',
      'reload',
    ]);
    if (OPERATOR_EXPECTED_VERBS.has(v)) {
      return { expected: true };
    }
    return {
      expected: false,
      reason: `Operator does not support "${v}". Expected operator operations are start, stop, pause, resume, run, launch, restart.`,
    };
  }

  // 4. Background task entities
  if (entityType === 'task' || entityType === 'background_task') {
    const TASK_EXPECTED_VERBS = new Set(['cancel', 'stop', 'retry', 'resume', 'pause']);
    if (TASK_EXPECTED_VERBS.has(v)) {
      return { expected: true };
    }
    return {
      expected: false,
      reason: `Task does not support "${v}". Expected task operations are cancel, stop, retry, resume, pause.`,
    };
  }

  // 5. Opportunity / Mission entities
  if (entityType === 'mission') {
    const MISSION_EXPECTED_VERBS = new Set(['start', 'run', 'stop', 'pause', 'resume', 'cancel']);
    if (MISSION_EXPECTED_VERBS.has(v)) {
      return { expected: true };
    }
    return { expected: false, reason: `Mission does not support "${v}".` };
  }

  return { expected: false, reason: `Unsupported operation "${v}" on entity type "${entityType}".` };
}

/* ── the router ─────────────────────────────────────────────────────────── */

/**
 * First clause of a grounded perception answer, used as the human-readable
 * description of an observed object. Deliberately structural (sentence split),
 * with no object-noun vocabulary: the executor's own words are the evidence.
 */
function firstClause(text: string): string {
  const clean = (text || '').trim();
  if (!clean) return '';
  const m = clean.match(/^[\s\S]*?[.!?\n]/);
  return (m ? m[0] : clean).trim().slice(0, 200);
}

export async function routeTurn(opts: {
  prompt: string;
  conversationId: string;
  turnId?: number;
  rawStt?: string;
  confidence?: number;
  isBargeIn?: boolean;
  isStale?: () => boolean;
  navigationVerifier?: (req: {
    navigationId: string;
    route: string;
    entityId: string;
    entityType: string;
    entityName: string;
  }) => Promise<{ verified: boolean; actualRoute?: string; visibleEntityId?: string; error?: string }>;
  onActionProgress?: (update: any) => void;
}): Promise<TurnResult> {
  const { prompt, conversationId, isStale } = opts;
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const focus = getFocus(conversationId);

  // ── P0 turn-ownership: register this conversation's active turn ────────────
  // EVERY turn updates it (not only perception turns), so work started by an
  // older turn is marked superseded and then refused at its own OS boundary.
  try {
    const { noteConversationTurn } = await import('../jarvis/perception/perceptionOperation.js');
    const superseded = noteConversationTurn(conversationId, opts.turnId ?? 0);
    if (superseded.length) {
      logger.info('[JRT] SUPERSEDED_OPERATIONS_CANCELLED', {
        turnId: opts.turnId, cancelled: superseded.map((o) => o.operationId),
      });
    }
  } catch {}

  // Clean deterministic wake word stripping (§Defect 2)
  const { wakeWordDetected, wakePrefixRemoved, commandText, isBareGreeting } = stripWakeWord(prompt);
  let effectivePrompt = (commandText || prompt).trim();
  // Normalize Free Cash STT variants
  effectivePrompt = effectivePrompt.replace(/\b(?:free\s+cache|freecache|free-cache)\b/gi, 'Free Cash');

  // Conversational mid-sentence self-correction (e.g. "X, scratch that, Y", "X, no wait, Y", "X, actually no, Y")
  // Do NOT match ordinary adverbial uses of "actually" like "what work is actually running?" or "did it actually finish?"
  const selfCorrectionMatch = effectivePrompt.match(
    /(?:^|[,;]\s*|\s+--\s+|\s+-\s+)(?:scratch\s+that|no\s+wait|correction|i\s+mean|actually\s+no|no[,\s]+actually|actually[,\s]+wait)\s*[,:]?\s+(.+)$/i
  );
  if (selfCorrectionMatch && selfCorrectionMatch[1].trim().length > 3) {
    effectivePrompt = selfCorrectionMatch[1].trim();
  }

  const entityBefore = focus.activeEntityName || focus.activeEntityId || 'none';

  const finish = (r: Partial<TurnResult> & { text: string; route: TurnRoute }): TurnResult => {
    timings.totalToTextMs = Date.now() - t0;
    let finalSpokenText = r.text;
    // Section 6 invariant: NEVER ALLOW A TURN TO PRODUCE SILENCE (except quiet recovery)
    if (r.handled !== false && (!finalSpokenText || !finalSpokenText.trim())) {
      if ((r as any).goalId === 'quiet_recovery' || (r as any).goalId === 'stop' || (r as any).goalId === 'suspended_ignored' || (r as any).goalId === 'wake_reactivated' || (r as any).silent === true) {
        finalSpokenText = '';
      } else if (r.route === 'blocker_detail_read') {
        finalSpokenText = "I found the blocker, but its task record doesn't specify which API credentials are missing.";
      } else if (r.route === 'action' || r.route === 'project_operate') {
        finalSpokenText = 'I received the request, but could not complete the operation.';
      } else if (r.route === 'navigate') {
        // PHASE E: never claim a navigation that was not verified.
        finalSpokenText = r.verified ? 'Opened the requested view.' : 'I could not open that view.';
      } else if (r.route === 'browser') {
        finalSpokenText = r.verified
          ? `${r.entityName || 'The page'} is open.`
          : `I could not open ${r.entityName || 'that page'} in the browser.`;
      } else {
        const entity = r.entityName || (r as any).entityId || focus.activeEntityName || focus.activeEntityId;
        if (entity && entity.toLowerCase() === 'jarvis') {
          finalSpokenText = "I'm on it. I can help configure and add capabilities to Jarvis.";
        } else if (entity && entity !== 'none' && !/free\s*cash/i.test(entity)) {
          finalSpokenText = `I don't have further details on ${entity} right now.`;
        } else {
          finalSpokenText = "I'm not sure how to help with that. Could you rephrase?";
        }
      }
    }

    const result: TurnResult = {
      handled: true, evidence: false, executed: false, verified: false,
      ...r, text: finalSpokenText, timings,
    } as TurnResult;

    const entityAfter = result.entityName || result.entityId || focus.activeEntityName || focus.activeEntityId || 'none';
    const executionTool =
      result.route === 'browser' ? 'browserOperator'
      : result.route === 'navigate' ? 'executeNavigate'
      : result.route === 'project_operate' ? 'projectController.operateProject'
      : result.route === 'blocker_detail_read' ? 'projectController.queryBlockerDetail'
      : result.route === 'fast_read' ? 'projectStateContext'
      : (result.route as string) === 'engineering.antigravity' ? 'delegate_antigravity_task'
      : 'supervisor';

    // Required authoritative REAL TURN ROUTING TRACE
    const traceBlock = [
      `TURN_ID=${opts.turnId ?? 'live'}`,
      `RAW_STT=${opts.rawStt || prompt}`,
      `COMMAND_TEXT=${effectivePrompt}`,
      `WAKE_STRIPPED=${wakePrefixRemoved}`,
      `PRIMARY_INTENT=${result.route}`,
      `EXPLICIT_ENTITY_TEXT=${result.entityName || 'none'}`,
      `EXPLICIT_ENTITY_TYPE=${result.entityType || 'none'}`,
      `RESOLVED_ENTITY_ID=${result.entityId || 'none'}`,
      `RESOLVED_ENTITY_NAME=${result.entityName || 'none'}`,
      `CONTEXT_ENTITY_BEFORE=${entityBefore}`,
      `CONTEXT_ENTITY_AFTER=${entityAfter}`,
      `ROUTE=${result.route}`,
      `EXECUTION_TOOL=${executionTool}`,
      `VERIFIED=${result.verified}`,
      `FINAL_RESPONSE=${result.text}`,
    ].join('\n');

    console.log(`[JRT] REAL_TURN_ROUTING_TRACE:\n${traceBlock}`);
    logger.info('[JRT] REAL_TURN_ROUTING_TRACE', { trace: traceBlock });

    logger.info('[JRT] TURN_ROUTE', {
      conversationId, prompt: effectivePrompt, route: result.route,
      entityId: result.entityId ?? null, entityType: result.entityType ?? null,
      evidence: result.evidence ? 'YES' : 'NO',
      executed: result.executed, verified: result.verified,
      fallbackReason: result.fallbackReason ?? null,
      timings, spokenText: result.text,
    });
    // Remember turns for immediate-memory questions.
    focus.lastAssistantTurn = result.text;
    return result;
  };

  // Out-of-band STOP / CANCEL command detection via dedicated controlIntentDetector
  const lowerPrompt = (effectivePrompt || prompt || '').toLowerCase();
  const isProjectScopedStop = PROJECT_STOP_RE.test(lowerPrompt);
  const controlResult = detectControlIntent(prompt, { isBargeIn: opts.isBargeIn, sttConfidence: opts.confidence });
  const effControlResult = detectControlIntent(effectivePrompt, { isBargeIn: opts.isBargeIn, sttConfidence: opts.confidence });
  const isStopCommand = !isProjectScopedStop && (
    (controlResult.isControl && controlResult.intent === 'STOP') ||
    (effControlResult.isControl && effControlResult.intent === 'STOP')
  );

  if (isStopCommand) {
    // ── D-5: Stop cancels active work and invalidates its perception context ──
    // Applied to BOTH stop flavours (speech stop and work cancel): a cancelled
    // operation must not afterwards launch an application, speak, alter
    // TurnFocus, replace the active perception target, emit runtime status, or
    // write a stale result. The operation registry marks in-flight work
    // CANCELLED, so its completion path is refused by mayPerformSideEffect().
    try {
      const { clearPerception } = await import('../jarvis/perception/perceptionFocus.js');
      const { cancelConversationOperations } = await import('../jarvis/perception/perceptionOperation.js');
      const cleared = clearPerception(conversationId, 'stop_command');
      const cancelled = cancelConversationOperations(conversationId, 'stop_command');
      logger.info('[JRT] STOP_INVALIDATES_PERCEPTION', {
        turnId: opts.turnId, clearedFocus: cleared, cancelledOperations: cancelled.length,
      });
    } catch (stopErr) {
      logger.warn('[JRT] STOP perception invalidation failed:', stopErr);
    }

    const isSpeechStop = opts.isBargeIn || /\b(?:stop\s+(?:speaking|talking|speech)|be\s+quiet|shut\s+up|silence|quiet)\b/i.test(lowerPrompt);
    const isWorkCancel = /\b(?:cancel\s+(?:work|tasks?|operation|execution|all)|stop\s+(?:work|working|tasks?|operation|execution)|halt\s+work|kill\s+tasks?)\b/i.test(lowerPrompt);

    logger.info('[JRT] High-priority STOP/CANCEL detected in turnRouter via controlIntentDetector.', { isSpeechStop, isWorkCancel });

    if (isSpeechStop && !isWorkCancel) {
      focus.pendingClarification = undefined;
      focus.clarificationType = undefined;
      focus.offeredOptions = undefined;
      return finish({
        handled: true,
        evidence: true,
        executed: true,
        verified: true,
        route: 'chat_trivial',
        goalId: 'stop' as any,
        text: '',
        silent: true,
      } as any);
    }

    let activeProcessesCancelled = 0;
    try {
      const { terminalExecutor } = await import('../jarvis/execution/executors/terminalExecutor.js');
      if (terminalExecutor.hasActiveProcesses()) {
        activeProcessesCancelled = terminalExecutor.getActiveProcessCount();
        terminalExecutor.cancelActiveProcesses();
      }
    } catch {}

    let activeBgTasksCancelled: string[] = [];
    try {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
      const activeTasks = backgroundTaskManager.listTasks({ activeOnly: true });
      for (const t of activeTasks) {
        const res = backgroundTaskManager.cancelTask(t.taskId, 'Cancelled by user voice command.');
        if (res.ok && res.task?.status === 'cancelled') {
          activeBgTasksCancelled.push(t.title || t.taskId);
        }
      }
    } catch {}

    focus.pendingClarification = undefined;
    focus.clarificationType = undefined;
    focus.offeredOptions = undefined;

    const hadActiveWork = activeProcessesCancelled > 0 || activeBgTasksCancelled.length > 0;
    let spokenResult = '';
    if (hadActiveWork) {
      const details: string[] = [];
      if (activeBgTasksCancelled.length > 0) {
        details.push(`cancelled ${activeBgTasksCancelled.length} active task${activeBgTasksCancelled.length === 1 ? '' : 's'} (${activeBgTasksCancelled.slice(0, 2).join(', ')})`);
      }
      if (activeProcessesCancelled > 0) {
        details.push(`stopped ${activeProcessesCancelled} running process${activeProcessesCancelled === 1 ? '' : 'es'}`);
      }
      spokenResult = `Work stopped: I ${details.join(' and ')}.`;
    } else if (isWorkCancel) {
      spokenResult = 'There is no active work running to cancel.';
    } else {
      // Default generic "stop" when no work was active: silent
      return finish({
        handled: true,
        evidence: true,
        executed: true,
        verified: true,
        route: 'chat_trivial',
        goalId: 'stop' as any,
        text: '',
        silent: true,
      } as any);
    }

    return finish({
      handled: true,
      evidence: true,
      executed: hadActiveWork,
      verified: true,
      route: 'chat_trivial',
      goalId: 'cancel' as any,
      text: spokenResult,
      silent: false,
    } as any);
  }

  // ── Early deterministic arithmetic evaluation ───────────────────────────
  // Evaluates arithmetic questions (e.g. "how much is 2 plus 2?") immediately,
  // before project state or controller routing can hijack the turn.
  const earlyArith = evalArithmetic(effectivePrompt) ?? evalArithmetic(prompt);
  if (earlyArith !== null) {
    logger.info('[JRT] Early arithmetic query handled directly', { effectivePrompt, text: earlyArith });
    return finish({ route: 'chat_trivial', text: earlyArith, evidence: true });
  }
  
  // [JTRACE-02] raw input
  addTrace('02', { effectivePrompt, isBare: Boolean(isBareGreeting) });
  const lower = effectivePrompt.toLowerCase();
  const isAntiGravityDelegation = /\b(?:antigravity|anti-gravity|anti\s+gravity)\b/i.test(lower);

  if (wakePrefixRemoved) {
    logger.info('[JRT] WAKE_PREFIX_REMOVED=true', { rawPrompt: prompt, commandText });
    console.log(`[JRT] WAKE_PREFIX_REMOVED=true COMMAND_TEXT="${commandText}"`);
  }

  const buildIdentity = getBuildIdentity();
  const buildId = buildIdentity.buildId || 'dev';
  logger.info('[JRT] TURN_ROUTER_ENTERED', {
    buildId,
    pid: process.pid,
    conversationId,
    prompt,
    effectivePrompt,
  });
  console.log(`[JRT] TURN_ROUTER_ENTERED buildId=${buildId} pid=${process.pid} conversationId=${conversationId} prompt="${prompt}" effectivePrompt="${effectivePrompt}"`);


  const priorUserTurn = focus.lastUserTurn;
  focus.lastUserTurn = effectivePrompt;
  if (!focus.userTurns) focus.userTurns = [];
  focus.userTurns.push(effectivePrompt);

  // ── Deterministic Engineering Delegation: AntiGravity (HIGHEST PRECEDENCE) ──
  // Mandatory routing precedence: Must be checked before language_preference,
  // browser intents, desktop/open-app intents, conversation/general chat, Hermes, and LLM fallback.
  const { parseExplicitEngineeringDelegation, executeEngineeringDelegation } = await import('../controlPlane/ExplicitEngineeringDelegation.js');
  const explicitEngineering = parseExplicitEngineeringDelegation(prompt) || parseExplicitEngineeringDelegation(effectivePrompt);
  if (explicitEngineering) {
    const tTool = Date.now();
    const delRes = await executeEngineeringDelegation(explicitEngineering, {
      conversationId,
      turnId: opts.turnId ? Number(opts.turnId) : undefined,
      workspace: 'D:\\AgenticOS',
      speakFn: async (textToSpeak) => {
        try {
          const { jarvisNextAgent } = await import('./jarvisNextAgent.js');
          await jarvisNextAgent.speak(textToSpeak, opts.turnId ? Number(opts.turnId) : undefined);
        } catch {}
      },
      broadcastFn: (data) => {
        try {
          opts.onActionProgress?.(data);
        } catch {}
      },
    });
    timings.toolMs = Date.now() - tTool;
    return finish({
      route: 'engineering_delegation',
      text: delRes.text,
      evidence: delRes.success,
      executed: delRes.success,
      verified: delRes.success,
      goalId: delRes.goalId,
    });
  }

  // ── AUTHORITATIVE EARLY PERCEPTION LAYER (P0 D-1/D-2/D-3/D-7) ──────────────
  //
  // ONE decision, fixed order: stop → active perception continuation → explicit
  // camera intent → explicit screen intent. A claimed turn is TERMINAL: no
  // downstream router (control plane lifecycle, project state, introspection,
  // supervisor) may reclassify it. Perception continuations are resolved against
  // perceptionFocus, never against a task lookup, so a follow-up can never be
  // answered with "No matching task exists."
  const {
    decidePerceptionTurn,
    SCREEN_UNREADABLE_TEXT,
    CAMERA_UNAVAILABLE_TEXT,
  } = await import('../jarvis/perception/perceptionIntent.js');
  const {
    getActivePerception,
    recordPerception,
    recordPerceptionOutcome,
    clearPerception,
  } = await import('../jarvis/perception/perceptionFocus.js');
  const {
    beginOperation,
    markRunning,
    completeOperation,
    cancelConversationOperations,
    guardResultPublication,
  } = await import('../jarvis/perception/perceptionOperation.js');

  const perceptionDecision = decidePerceptionTurn({
    prompt: effectivePrompt,
    conversationId,
    turnId: opts.turnId ?? 0,
    // Active perception state is the ONLY source of continuation referents.
    focus: getActivePerception(conversationId),
  });
  logger.info('[JRT] PERCEPTION_DECISION', {
    turnId: opts.turnId,
    claimed: perceptionDecision.claimed,
    kind: perceptionDecision.kind,
    capability: perceptionDecision.capability || null,
    reason: perceptionDecision.reason,
    confidence: perceptionDecision.confidence,
    runtimeIntentExplicit: perceptionDecision.runtimeIntentExplicit,
  });

  // Any turn that carries perception vocabulary is protected from the
  // runtime-diagnostics branches below (see the introspection gate).
  const perceptionWordedTurn =
    perceptionDecision.camera?.isCameraPerception === true ||
    perceptionDecision.foreground?.isReadForegroundScreen === true ||
    perceptionDecision.continuation?.isContinuation === true;

  if (perceptionDecision.kind === 'stop') {
    // D-5: a cancelled operation must not speak, launch, or mutate context.
    const hadFocus = clearPerception(conversationId, 'stop_command');
    const cancelled = cancelConversationOperations(conversationId, 'stop_command');
    logger.info('[JRT] PERCEPTION_STOP', {
      turnId: opts.turnId, clearedFocus: hadFocus, cancelledOperations: cancelled.length,
    });
    // Silence is the correct outcome: the user asked for no work and no speech.
    return finish({ route: 'chat_trivial', text: '', evidence: true, executed: false, verified: false });
  }

  if (perceptionDecision.claimed && perceptionDecision.capability) {
    const capability = perceptionDecision.capability;
    const isContinuation = perceptionDecision.kind === 'continuation';
    const operation = beginOperation({
      conversationId,
      turnId: opts.turnId ?? 0,
      capability,
      originTurnId: perceptionDecision.originTurnId ?? opts.turnId ?? 0,
    });
    markRunning(operation);
    const tTool = Date.now();

    // ── Camera ────────────────────────────────────────────────────────────
    if (capability === 'camera_perception') {
      let cameraText = '';
      let cameraReason = '';
      try {
        const { universalPerceptionService } = await import('../controlPlane/UniversalPerceptionService.js');
        const res: any = await universalPerceptionService.observeCamera({ userPrompt: prompt });
        cameraText = String(res?.visionAnswer || res?.summary || '').trim();
        if (!cameraText) cameraReason = 'empty_camera_result';
      } catch (err: any) {
        cameraReason = 'camera_error';
        logger.warn('[JRT] CAMERA_PERCEPTION failed:', err?.message || err);
      }
      timings.toolMs = Date.now() - tTool;

      // Re-validate ownership before publishing: async perception work happened
      // between dispatch and completion, so a superseded or cancelled turn must
      // not speak, must not mutate perception focus and must not emit a result.
      const publishGate = guardResultPublication({
        conversationId,
        turnId: opts.turnId ?? 0,
        capability,
        operationId: operation.operationId,
      });

      if (cameraText && publishGate.ok) {
        recordPerception({
          conversationId,
          turnId: opts.turnId ?? 0,
          capability: 'camera_perception',
          target: {
            type: 'visible_object',
            description: cameraText,
            parentTarget: isContinuation ? { type: 'camera_frame', description: 'current camera frame' } : undefined,
          },
          entities: [{ type: 'observed_object', description: firstClause(cameraText) }],
          summary: cameraText,
          continuation: isContinuation,
        });
        completeOperation(operation, 'SUCCESS');
        return finish({
          route: 'camera_perception' as any,
          text: cameraText,
          evidence: true,
          executed: true,
          verified: true,
        });
      }

      // Terminal failure — never a runtime dump, never "I'm not sure how to help".
      if (!publishGate.ok) {
        logger.warn('[JRT] PERCEPTION_PUBLISH_REJECTED', {
          turnId: opts.turnId, capability, operationId: operation.operationId,
          reason: publishGate.reason,
        });
        completeOperation(operation, 'FAILED', publishGate.reason);
        return finish({
          route: capability as any, text: '', evidence: false, executed: false, verified: false,
          silent: true,
        } as any);
      }
      recordPerceptionOutcome(conversationId, opts.turnId ?? 0, 'unreadable', cameraReason);
      completeOperation(operation, 'FAILED', cameraReason);
      return finish({
        route: 'camera_perception' as any,
        text: CAMERA_UNAVAILABLE_TEXT,
        evidence: false,
        executed: true,
        verified: false,
        fallbackReason: cameraReason,
      } as any);
    }

    // ── Foreground screen ─────────────────────────────────────────────────
    const { readForegroundScreen } = await import('../../services/perception/foregroundScreenReader.js');
    const reading = await readForegroundScreen();
    timings.toolMs = Date.now() - tTool;
    logger.info('[JRT] READ_FOREGROUND_SCREEN', {
      turnId: opts.turnId, continuation: isContinuation,
      intentReason: perceptionDecision.reason,
      hwnd: reading.hwnd, process: reading.process, windowTitle: reading.windowTitle,
      method: reading.method, success: reading.success, reason: reading.reason || null,
      quality: reading.quality, contentChars: reading.content.length,
    });

    // Re-validate ownership before publishing the screen result.
    const screenPublishGate = guardResultPublication({
      conversationId,
      turnId: opts.turnId ?? 0,
      capability,
      operationId: operation.operationId,
    });
    if (!screenPublishGate.ok) {
      logger.warn('[JRT] PERCEPTION_PUBLISH_REJECTED', {
        turnId: opts.turnId, capability, operationId: operation.operationId,
        reason: screenPublishGate.reason,
      });
      completeOperation(operation, 'FAILED', screenPublishGate.reason);
      return finish({
        route: capability as any, text: '', evidence: false, executed: false, verified: false,
        silent: true,
      } as any);
    }

    if (reading.success) {
      recordPerception({
        conversationId,
        turnId: opts.turnId ?? 0,
        capability: 'read_foreground_screen',
        target: {
          type: reading.content ? 'visible_text' : 'foreground_window',
          description: reading.windowTitle || reading.process,
          hwnd: reading.hwnd,
          process: reading.process,
          windowTitle: reading.windowTitle,
          parentTarget: { type: 'foreground_window', description: reading.windowTitle || reading.process },
        },
        evidence: {
          screenshotId: reading.screenshotSha256,
          capturedAt: Date.now(),
        },
        summary: reading.content.slice(0, 2000),
        continuation: isContinuation,
      });
      completeOperation(operation, 'SUCCESS');
      return finish({
        route: 'read_foreground_screen',
        text: reading.spokenText,
        evidence: true,
        executed: true,
        verified: true,
        goalId: 'read_foreground_screen' as any,
      } as any);
    }

    recordPerceptionOutcome(conversationId, opts.turnId ?? 0, 'unreadable', reading.reason);
    completeOperation(operation, 'FAILED', reading.reason);
    return finish({
      route: 'read_foreground_screen',
      text: reading.spokenText || SCREEN_UNREADABLE_TEXT,
      evidence: false,
      executed: true,
      verified: false,
      goalId: 'read_foreground_screen_unreadable' as any,
      fallbackReason: reading.reason,
    } as any);
  }

  // ── Authoritative Control Plane Lifecycle (Single Production GoalRun Lifecycle) ──
  try {
    const { controlPlaneTurnHandler } = await import('../controlPlane/ControlPlaneTurnHandler.js');
    const cpResult = await controlPlaneTurnHandler.handleTurn({
      prompt,
      effectivePrompt,
      conversationId,
      turnId: opts.turnId ? Number(opts.turnId) : undefined,
      sttConfidence: (opts as any).confidence ?? (opts as any).sttConfidence,
      onActionProgress: opts.onActionProgress,
      navigationVerifier: opts.navigationVerifier,
      focus,
    });
    if (cpResult && cpResult.handled) {
      if (focus) {
        if (cpResult.text) focus.lastAssistantTurn = cpResult.text;
        if (cpResult.entityName) focus.lastResolvedEntityName = cpResult.entityName;
        focus.lastExecutionResult = {
          success: !cpResult.fallbackReason,
          verified: !!cpResult.verified,
          route: cpResult.route || 'action',
          at: Date.now(),
        };
      }
      return finish(cpResult);
    }
  } catch (cpErr: any) {
    logger.warn('[JRT] ControlPlaneTurnHandler error:', cpErr);
  }

  // ── 0c. Navigation correction turn ─────────────────────────────────────
  // A navigation correction turn occurs when a user explicitly says the navigation failed
  // ("it's not open", "it didn't open", "try again") immediately after a failed navigation attempt.
  // Deictic commands like "open it" must NEVER be intercepted here — they belong to UniversalExecutionController & ReferentResolver.
  const isPendingNavigationCorrection =
    (focus.lastRequestedAction === 'NAVIGATE' || focus.lastNavigationTarget !== undefined) &&
    focus.lastVerificationState === 'failed';

  const NAVIGATION_CORRECTION_RE =
    /^(?:no[,\s]+)?(?:it'?s not open|it isn'?t open|that'?s not open|it didn'?t open|not open|still not open|i said open (?:it|this)|open it again|do it again|try (?:it )?again|try opening it(?: again)?)\b/i;

  const isExplicitCorrection =
    NAVIGATION_CORRECTION_RE.test(lower) ||
    (isPendingNavigationCorrection && /^(?:no|nope|wrong|try again|do it again)[.!]?$/i.test(lower));

  if (isExplicitCorrection) {
    const targetEntityId = focus.lastNavigationTarget?.entityId || focus.activeEntityId;
    const targetEntityType = focus.lastNavigationTarget?.entityType || focus.activeEntityType || 'project';
    const targetEntityName = focus.lastNavigationTarget?.entityName || focus.activeEntityName || 'it';
    if (targetEntityId) {
      logger.info('[JRT] RETRYING_NAVIGATION_FROM_CORRECTION', { targetEntityId, targetEntityType, targetEntityName });
      const nav = await executeNavigate({
        entityId: targetEntityId,
        entityName: targetEntityName,
        entityType: targetEntityType,
        focus,
        verb: 'open',
        navigationVerifier: opts.navigationVerifier,
      });
      return finish({
        route: 'navigate',
        text: nav.text,
        evidence: true,
        executed: nav.executed,
        verified: nav.verified,
        entityId: targetEntityId,
        entityType: targetEntityType,
        entityName: targetEntityName,
        uiRoute: nav.uiRoute,
      });
    }
  }

  // ── 0. System & model introspection ────────────────────────────────────────
  // D-1: runtime diagnostics run ONLY when this turn explicitly refers to
  // AgenticOS / the system / a service / a model. A turn that carries perception
  // vocabulary ("what do you see", "show me", "read it", "what am I holding")
  // must never be answered with runtime state, so it is refused here even when
  // some introspection classifier matches it.
  try {
    const runtimeGated = !perceptionWordedTurn || perceptionDecision.runtimeIntentExplicit;
    if (runtimeGated) {
      const { detectSystemIntrospection, handleSystemIntrospection } = await import('../jarvis/systemIntrospection.js');
      const intro = detectSystemIntrospection(effectivePrompt);
      if (intro.isIntrospection && intro.subject) {
        const activeName = focus.activeProjectName || focus.activeEntityName;
        const introRes = await handleSystemIntrospection(intro.subject, conversationId, {
          activeEntity: activeName ? {
            id: focus.activeProjectId || focus.activeEntityId || '',
            name: activeName,
            displayName: activeName,
            type: focus.activeEntityType || 'project',
            domain: 'projects',
          } : undefined,
        } as any);
        logger.info('[JRT] Early system introspection handled successfully', { subject: intro.subject, text: introRes.text });
        return finish({
          route: 'system_introspection' as any,
          text: introRes.text,
          evidence: true,
          executed: true,
          verified: true,
        });
      }
    } else {
      logger.info('[JRT] RUNTIME_DIAGNOSTICS_REFUSED', {
        turnId: opts.turnId,
        reason: perceptionDecision.runtimeIntentReason,
        perceptionWorded: true,
      });
    }
  } catch (introErr) {
    logger.warn('[JRT] Early system introspection failed:', introErr);
  }

  // ── 0b. Historical queries ("What was I asking about before the model question?") ──
  const histEarly = parseHistoricalQuery(effectivePrompt, focus.userTurns.slice(0, -1));
  if (histEarly !== null) {
    logger.info('[JRT] Early historical query handled successfully', { text: histEarly });
    return finish({ route: 'immediate_memory', text: histEarly, evidence: true });
  }

  // ── Early "Got it what?" / orphan acknowledgement suppression ───────────
  if (/\b(?:got it what|what do you mean got it|what did you get)\b/i.test(lower)) {
    return finish({
      route: 'chat_trivial',
      text: "Nothing — I was standing by, no action was taken.",
      evidence: true,
      executed: true,
      verified: true,
    });
  }

  // ── Early File Attachment Summarization & Analysis ─────────────────────
  const hasAttachment = prompt.includes('User Attachments:') || prompt.includes('[Attached file:');
  if (hasAttachment) {
    const tAttach = Date.now();
    try {
      const { llmChat } = await import('../../services/llmGateway.js');
      const chatRes = await llmChat({
        prompt,
        systemPrompt: 'You are Jarvis, an advanced AI executive assistant. The user has provided file attachments in their prompt. Analyze and answer the user\'s request accurately and concisely based on the attached file content.',
        timeoutMs: 30000,
      });
      timings.llmMs = Date.now() - tAttach;
      if (chatRes && chatRes.reply && chatRes.reply.trim()) {
        return finish({
          route: 'fast_read',
          text: chatRes.reply.trim(),
          evidence: true,
          executed: true,
          verified: true,
        });
      }
    } catch (err: any) {
      timings.llmMs = Date.now() - tAttach;
      logger.warn('[JRT] Attachment summarization via llmChat failed:', err);
    }

    // Deterministic fallback if gateway fails or is offline
    const docMatch = prompt.match(/File Content:\s*([\s\S]+?)(?:\[Attached file:|$)/i);
    const content = docMatch ? docMatch[1].trim() : '';
    if (content) {
      return finish({
        route: 'fast_read',
        text: `Here is a summary of the attached document: ${content}`,
        evidence: true,
        executed: true,
        verified: true,
      });
    }
  }



  const isExplicitHermesDelegationEarly =
    /\b(?:ask|tell|have|delegate\s+to)\s+(?:hermes|codex)\b/i.test(lower) ||
    (/\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(lower) && !/\b(?:local\s+worker|a\s+worker)\b/i.test(lower));
  const isLocalWorkerEarly = /\b(?:worker|local\s+worker)\b/i.test(lower) && !/\b(?:ask|tell|have)\s+hermes\b/i.test(lower);
  const isRepoLocateEarly = /\b(?:find|locate|search|where\s+is|open|show)\b.*\brepository\b/i.test(lower);
  if (!isAntiGravityDelegation && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocateEarly && !isLocalWorkerEarly) || isExplicitHermesDelegationEarly) && !isLocalWorkerEarly)) {
    const tTool = Date.now();
    try {
      const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
      const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');
      let workspacePath: string | undefined;
      try { workspacePath = getWorkspaceRoot(); } catch { /* optional */ }
      const res: any = await executeSupervisorTool(
        'delegate_hermes_task',
        {
          objective: prompt,
          context: 'Requested over the JARVIS conversation channel.',
          approvalRequired: false,
          envelope: {
            constraints: { readOnly: !/\b(?:modify|write|edit|update|create|delete)\b/i.test(lower) },
            objective: prompt,
          },
        },
        { conversationId, workspacePath },
      );
      timings.toolMs = Date.now() - tTool;
      const taskId = res?.taskId || res?.task?.taskId;
      const ok = !!taskId && res?.error == null;
      return finish({
        route: 'action',
        text: ok
          ? `I delegated that task to Hermes. Task ${taskId} is queued against the repository.`
          : `I attempted to delegate to Hermes, but the delegation did not succeed: ${res?.error || 'no task id returned'}.`,
        evidence: true, executed: ok, verified: false, // Phase 1: a queued task id is not a verified result
        fallbackReason: ok ? undefined : 'hermes_delegation_failed',
      });
    } catch (err: any) {
      timings.toolMs = Date.now() - tTool;
      return finish({
        route: 'action',
        text: `I couldn't reach the Hermes delegation capability: ${err?.message || err}.`,
        evidence: false, executed: false, verified: false,
        fallbackReason: `hermes_delegation_error: ${err?.message || err}`,
      });
    }
  }

  const isRecentTaskInquiryEarly =
    /\b(?:what happened with|how did|status of|did.*finish|did.*complete)\b.*\b(?:task|that)\b/i.test(lower) ||
    /\bwhat happened with (?:that|the) task\b/i.test(lower) ||
    /\bhow did (?:that|the) task go\b/i.test(lower);
  if (isRecentTaskInquiryEarly) {
    try {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
      const allTasks = backgroundTaskManager.listTasks();
      const matching = allTasks
        .filter((t: any) => t.conversationId === conversationId || t.worker === 'hermes' || t.worker === 'codex')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const recentTask = matching[0];
      if (recentTask) {
        let reply = `Task ${recentTask.taskId} ("${recentTask.title}") has status ${recentTask.status}.`;
        if (recentTask.resultText) {
          reply += ` Result: ${recentTask.resultText}`;
        }
        return finish({
          route: 'action',
          text: reply,
          evidence: true,
          executed: true,
          verified: recentTask.status === 'completed',
          entityId: recentTask.taskId,
          entityType: 'task',
          entityName: recentTask.title,
        });
      }
    } catch (err: any) {
      logger.warn('[JRT] Task status lookup failed:', err);
    }
  }


  // ── Universal Execution Controller (Single Front Door) ───────────────
  // Snapshot the focus before the controller touches anything (F8 trace).
  const focusBefore = {
    ...focus,
    pendingClarification: focus.pendingClarification ? { ...focus.pendingClarification } : undefined,
    lastExecutionResult: focus.lastExecutionResult ? { ...focus.lastExecutionResult } : undefined,
  };
  try {
    const { universalExecutionController } = await import('../jarvis/execution/universalExecutionController.js');
    const uResult = await universalExecutionController.handleUserTurn({
      prompt: effectivePrompt,
      conversationId,
      turnId: opts.turnId ? String(opts.turnId) : undefined,
      workspacePath: process.cwd(),
      activeProjectId: focus.activeProjectId,
      activeProjectName: focus.activeProjectName,
      sttConfidence: (opts as any).confidence ?? (opts as any).sttConfidence,
      rawStt: opts.rawStt || prompt,
      isBargeIn: opts.isBargeIn,
      navigationVerifier: opts.navigationVerifier,
      onProgress: opts.onActionProgress,
      // Conversation context: a read-only snapshot of the EXISTING focus, so the
      // controller can recover partial understanding and continue prior goals
      // instead of re-asking generically. No duplicated state.
      context: {
        activeEntityId: focus.activeEntityId,
        activeEntityName: focus.activeEntityName,
        activeEntityType: focus.activeEntityType,
        activeProjectId: focus.activeProjectId,
        activeProjectName: focus.activeProjectName,
        lastRequestedAction: focus.lastRequestedAction,
        lastUserTurn: focus.lastUserTurn,
        lastAssistantTurn: focus.lastAssistantTurn,
        pendingClarification: focus.pendingClarification,
        // Continuation state (F1): the controller resolves meta-turns
        // ("Why not?", "Try again.") and pronouns against this.
        lastResolvedEntityId: focus.lastResolvedEntityId,
        lastResolvedEntityName: focus.lastResolvedEntityName,
        lastResolvedEntityType: focus.lastResolvedEntityType,
        lastResolvedAction: focus.lastResolvedAction,
        lastExecutionResult: focus.lastExecutionResult,
        lastFailureReason: focus.lastFailureReason,
        lastFailureAt: focus.lastFailureAt,
        lastVerificationState: focus.lastVerificationState,
        clarificationType: focus.clarificationType,
        offeredOptions: focus.offeredOptions,
        activeBlockerId: focus.activeBlockerId,
        lastPresentedBlockers: focus.lastPresentedBlockers,
      },
    });

    // ── ONE AUTHORITATIVE CONTINUATION STATE (F1) ─────────────────────
    // Delegated to the single shared writer so tests exercise production state.
    applyTurnResultToFocus(focus, uResult);

    // ── STATE TRANSITIONS (F8) — diagnosis only, never spoken ──────────
    console.log(
      `[JRT] CONVERSATION_STATE:\n${[
        `FOCUS_BEFORE=${focusBefore.activeEntityName || focusBefore.activeEntityId || focusBefore.lastResolvedEntityName || 'none'}`,
        `PENDING_BEFORE=${focusBefore.pendingClarification ? `${focusBefore.pendingClarification.kind}(${focusBefore.clarificationType || 'untyped'}) target=${focusBefore.pendingClarification.targetName || 'none'} attempt=${focusBefore.pendingClarification.attempt}` : 'none'}`,
        `LAST_ENTITY=${focusBefore.lastResolvedEntityName || 'none'}`,
        `LAST_ACTION=${focusBefore.lastResolvedAction || 'none'}`,
        `LAST_EXECUTION=${focusBefore.lastExecutionResult ? `success=${focusBefore.lastExecutionResult.success} verified=${focusBefore.lastExecutionResult.verified} route=${focusBefore.lastExecutionResult.route || 'none'}` : 'none'}`,
        `LAST_FAILURE=${focusBefore.lastFailureReason || 'none'}`,
        `RESOLVED_ENTITY=${uResult?.entityName || uResult?.lastResolvedEntityName || 'none'}`,
        `RESOLVED_ACTION=${uResult?.lastResolvedAction || 'none'}`,
        `FOCUS_AFTER=${focus.activeEntityName || focus.activeEntityId || focus.lastResolvedEntityName || 'none'}`,
        `PENDING_AFTER=${focus.pendingClarification ? `${focus.pendingClarification.kind}(${focus.clarificationType || 'untyped'}) target=${focus.pendingClarification.targetName || 'none'} attempt=${focus.pendingClarification.attempt}` : 'none'}`,
      ].join('\n')}`,
    );

    if (uResult && uResult.handled) {
      const isGenericClarify = /couldn't make that out/i.test(uResult.spokenText);
      const isHighConfidence = ((opts as any).confidence ?? (opts as any).sttConfidence ?? 1.0) >= 0.7;
      // NEVER let browser-route results fall through to entity resolution.
      // Browser targets (YouTube, Google, etc.) are not internal projects and
      // would be misclassified by buildProjectStateContext / executeNavigate.
      const isBrowserRoute = uResult.route === 'browser' || uResult.plan?.primaryExecutor === 'browser';
      if (!isBrowserRoute && isGenericClarify && uResult.plan?.confidence === 0 && (!uResult.plan?.steps || uResult.plan.steps.length === 0)) {
        logger.info('[JRT] General conversational query fell through execution controller to LLM reasoning:', prompt);
      } else {
        return finish({
          route: uResult.route as any,
          text: uResult.spokenText,
          evidence: true,
          executed: uResult.route === 'fast_read' ? false : uResult.execution.success,
          verified: uResult.verification.verified,
          entityId: uResult.entityId === 'revenue-operator' ? 'revenue_operator' : uResult.entityId,
          entityName: uResult.entityName,
          entityType: uResult.entityType,
          uiRoute: uResult.uiRoute,
          requestedGoals: uResult.requestedGoals,
          executedGoals: uResult.executedGoals,
          satisfiedGoals: uResult.satisfiedGoals,
          failedGoals: uResult.failedGoals,
          plan: uResult.plan,
          goalDescription: uResult.goalDescription,
          durationMs: uResult.timings?.totalMs,
          execution: uResult.execution,
          verification: uResult.verification,
          // Carry the specific failure reason so the response layer can render it
          // instead of a generic message.
          fallbackReason: uResult.verification.verified
            ? undefined
            : (uResult.execution?.error || uResult.verification?.error || 'unverified_internal_action'),
          repairProposal: (uResult as any).repairProposal,
          stage: (uResult as any).stage,
        } as any);
      }
    }
  } catch (uErr: any) {
    logger.warn('[JRT] UniversalExecutionController error, falling back to traditional route:', {
      error: uErr?.message || String(uErr),
      stack: uErr?.stack,
    });
    console.error('[JRT] UniversalExecutionController error:', uErr);
  }

  // ── 1. Immediate memory & conversational turn history ─────────────────
  if (REPEAT_RE.test(lower)) {
    return finish({
      route: 'immediate_memory',
      text: priorUserTurn ? `You said: ${priorUserTurn}` : "You haven't said anything to me yet in this session.",
      evidence: !!priorUserTurn,
    });
  }

  const hist = parseHistoricalQuery(prompt, focus.userTurns.slice(0, -1));
  if (hist !== null) {
    return finish({ route: 'immediate_memory', text: hist, evidence: true });
  }

  // ── 2. Trivial deterministic chat ──────────────────────────────────────
  const arith = evalArithmetic(prompt);
  if (arith !== null) {
    return finish({ route: 'chat_trivial', text: arith, evidence: true });
  }

  // ── 2b. Declarative statement / seed memory ───────────────────────────
  // Seed the utterance into context memory but DO NOT speak a generic
  // "Got it." acknowledgement. Spoken "Got it." with no actionable follow-up
  // confuses users (triggers "Got it what?" follow-up questions) and produces
  // orphan speech during internal events.
  if (/\b(?:got it what|what do you mean got it|what did you get)\b/i.test(lower)) {
    return finish({
      route: 'chat_trivial',
      text: "Nothing — I was standing by, no action was taken.",
      evidence: true,
      executed: true,
      verified: true,
    });
  }

  if (isDeclarativeStatement(prompt)) {
    return finish({ route: 'chat_trivial', text: 'Understood.', evidence: true });
  }

  // ── 2c. Authoritative system & model introspection ────────────────────
  try {
    const { detectSystemIntrospection, handleSystemIntrospection } = await import('../jarvis/systemIntrospection.js');
    const intro = detectSystemIntrospection(prompt);
    if (intro.isIntrospection && intro.subject) {
      const introRes = await handleSystemIntrospection(intro.subject, conversationId, {
        activeEntity: focus.activeEntityName ? { id: focus.activeEntityId || '', name: focus.activeEntityName, type: focus.activeEntityType || 'project' } : undefined,
      } as any);
      return finish({
        route: 'chat_trivial',
        text: introRes.text,
        evidence: true,
        executed: true,
        verified: true,
      });
    }
  } catch (introErr) {
    logger.warn('[JRT] System introspection failed:', introErr);
  }

  // ── 3. Offered-choice continuation ─────────────────────────────────────
  if (focus.pendingChoices?.length) {
    const idx = choiceIndex(lower);
    let chosen: OfferedChoice | undefined = idx !== null ? focus.pendingChoices[idx] : undefined;
    if (!chosen) {
      // Free-text answers ("The channel.", "start working on it", "yes") must
      // resolve an offered choice too — not only "1"/"2".
      const t = lower.trim();
      const bareAnswer = t.replace(/^the\s+/, '').replace(/[.!?]+$/, '');
      chosen = focus.pendingChoices.find((c: any) => {
        const label = String(c.label || c.title || c.text || '').toLowerCase().replace(/^the\s+/, '').replace(/[.!?]+$/, '');
        if (!label) return false;
        return t.includes(label) || (label.length > 3 && bareAnswer.length > 2 && label.includes(bareAnswer));
      });
      const affirmative = /^(?:yes|yeah|yep|ok(?:ay)?|sure|please do|go ahead|do it|correct|affirmative)[.!]?$/.test(t);
      if (!chosen && affirmative && focus.pendingChoices.length === 1) chosen = focus.pendingChoices[0];
    }
    if (chosen) {
      focus.pendingChoices = undefined;
      logger.info('[JRT] CHOICE_SELECTED', { conversationId, index: idx, choice: chosen.id, via: idx === null ? 'free_text' : 'index' });
      const outcome = await dispatchChoice(chosen);
      return finish({
        route: 'action', text: outcome.text,
        executed: outcome.executed, verified: outcome.verified, evidence: true,
      });
    }
  }

  // ── 4. Context + entity resolution ─────────────────────────────────────
  const tCtx = Date.now();
  const usesPronoun = PRONOUN_RE.test(lower);
  // An explicitly named entity must be resolved on its own merits. Inheriting
  // the conversation focus here would silently answer about the PREVIOUS entity
  // when the user names one that does not exist.
  const explicitEntity = extractNamedEntity(effectivePrompt);
  const earlyReadIntent = classifyReadIntent(effectivePrompt);
  const isProjectOperateTurn = PROJECT_OPERATE_RE.test(lower) || PROJECT_STOP_RE.test(lower) || RESOLVE_BLOCKER_RE.test(lower);
  const projectScoped = earlyReadIntent === 'project_blocked' || earlyReadIntent === 'project_running'
    || earlyReadIntent === 'project_contents' || earlyReadIntent === 'project_priority'
    || earlyReadIntent === 'operator_status' || earlyReadIntent === 'worker_status'
    || earlyReadIntent === 'project_next_actions'
    || earlyReadIntent === 'project_prerequisites'
    || isProjectOperateTurn;
  // "…projects…" (plural) or "across all…" is a corpus-level question about ALL projects; never
  // narrow it to the focused one. STT often drops the leading "What", so this
  // must not depend on the question word.
  const corpusLevel = /\bprojects\b/i.test(lower) || /\b(?:across all|globally|in every project|all projects|fleet)\b/i.test(lower);
  const isRelevantProjectFollowUp =
    !corpusLevel &&
    !explicitEntity &&
    (usesPronoun || projectScoped || isProjectOperateTurn || isProjectStateRequest(effectivePrompt));
  let inheritFocus: { entityId?: string; entityType?: string; entityName?: string } | undefined;
  if (isRelevantProjectFollowUp) {
    // A project-scoped read inherits the last PROJECT, not whatever entity was
    // mentioned most recently.
    inheritFocus = projectScoped && focus.activeProjectId
      ? { entityId: focus.activeProjectId, entityType: 'project', entityName: focus.activeProjectName }
      : { entityId: focus.activeEntityId, entityType: focus.activeEntityType, entityName: focus.activeEntityName };
  }
  timings.contextMs = Date.now() - tCtx;

  const tEnt = Date.now();
  const evidencePack = await buildProjectStateContext(effectivePrompt, inheritFocus);
  timings.entityMs = Date.now() - tEnt;
  timings.providerMs = timings.entityMs;

  // Remember what this turn resolved to, so follow-ups can inherit it.
  if (evidencePack.entityId && evidencePack.entityType && evidencePack.entityType !== 'project_list') {
    focus.activeEntityId = evidencePack.entityId;
    focus.activeEntityType = evidencePack.entityType;
    focus.activeEntityName = evidencePack.entityName;
    if (evidencePack.entityType === 'project') {
      focus.activeProjectId = evidencePack.entityId;
      focus.activeProjectName = evidencePack.entityName;
    }
  }

  // Structured blocker context retention (§1)
  if (evidencePack.presentedBlockers && evidencePack.presentedBlockers.length > 0) {
    focus.lastPresentedBlockers = evidencePack.presentedBlockers;
    focus.activeBlockerId = evidencePack.presentedBlockers[0].taskId;
    focus.activeBlockerTitle = evidencePack.presentedBlockers[0].title;
    focus.activeBlockerReason = evidencePack.presentedBlockers[0].reason;
    focus.activeBlockerMetadata = evidencePack.presentedBlockers[0].metadata;
    focus.activeBlockerDependencies = evidencePack.presentedBlockers[0].dependencyIds;
    focus.activeBlockerObjective = evidencePack.presentedBlockers[0].objective;
    focus.activeBlockerWorker = evidencePack.presentedBlockers[0].worker;
  }

  // ── 4b. Structured Blocker Detail Follow-ups (§2) ────────────────────────
  const isBlockerFollowUp =
    BLOCKER_DETAIL_RE.test(lower) ||
    (NATURAL_BLOCKER_REF_RE.test(lower) && !ACTION_RE.test(lower) && !NAVIGATION_RE.test(lower));

  if (isBlockerFollowUp && (focus.activeBlockerId || focus.lastPresentedBlockers?.length || focus.activeProjectId)) {
    const { queryBlockerDetail } = await import('../../services/projectExecution/projectController.js');
    const blockerOutcome = await queryBlockerDetail({
      conversationId,
      prompt,
      activeBlocker: focus.activeBlockerId
        ? {
            taskId: focus.activeBlockerId,
            title: focus.activeBlockerTitle || 'External Account Credential Setup',
            reason: focus.activeBlockerReason || 'Missing external credentials',
            worker: focus.activeBlockerWorker,
            metadata: focus.activeBlockerMetadata,
            dependencyIds: focus.activeBlockerDependencies,
            objective: focus.activeBlockerObjective,
          }
        : null,
      lastPresentedBlockers: focus.lastPresentedBlockers,
      projectId: focus.activeProjectId,
    });

    if (blockerOutcome.activeBlocker) {
      focus.activeBlockerId = blockerOutcome.activeBlocker.taskId;
      focus.activeBlockerTitle = blockerOutcome.activeBlocker.title;
      focus.activeBlockerReason = blockerOutcome.activeBlocker.reason;
      focus.activeBlockerMetadata = blockerOutcome.activeBlocker.metadata;
      focus.activeBlockerDependencies = blockerOutcome.activeBlocker.dependencyIds;
      focus.activeBlockerObjective = blockerOutcome.activeBlocker.objective;
      focus.activeBlockerWorker = blockerOutcome.activeBlocker.worker;
    }

    return finish({
      route: 'blocker_detail_read',
      text: blockerOutcome.spokenText,
      evidence: true,
      executed: false,
      verified: true,
      entityId: focus.activeProjectId,
      entityType: 'project',
      entityName: focus.activeProjectName || 'the active project',
    });
  }

  const readIntent = classifyReadIntent(prompt);
  const operational = isProjectStateRequest(prompt) || usesPronoun;
  const isNavigation =
    NAVIGATION_RE.test(lower) ||
    (/\b(?:open|show|display|see|view|go to|switch to|focus on|bring up)\b/i.test(lower) &&
     /\b(?:project|operator|workspace)\b/i.test(lower));
  const isPrerequisiteQuestion =
    /\b(?:what (?:do you|do we|is|are|does it) need|what (?:is|are) (?:the )?(?:prerequisites?|requirements?)|what does it require|what is needed|what is required)\b/i.test(lower);
  const isRunningWorkInquiry =
    /\b(?:what|which|how many|is there|are there|tell me what|show me what)\b/i.test(lower) &&
    /\b(?:work|tasks?|jobs?)\b/i.test(lower) &&
    /\b(?:running|active|happening)\b/i.test(lower);
  const isExplanationOrQuery =
    /^\s*(?:explain|describe|what is|what are|what's|how does|who is|role of|check the runtime status|confirm the probe|verify probe)\b/i.test(lower) ||
    /\b(?:role of jarvis|what jarvis does|what can you do|about jarvis)\b/i.test(lower);
  const isAction =
    !isNavigation &&
    !isPrerequisiteQuestion &&
    !isRunningWorkInquiry &&
    !isExplanationOrQuery &&
    !(corpusLevel && earlyReadIntent) &&
    ACTION_RE.test(lower);

  if (isStale?.()) {
    return finish({ route: 'refusal', text: '', handled: false, fallbackReason: 'stale_turn' });
  }

  // ── 5. Unknown entity — refuse BEFORE any free-form generation ──────────
  // Fires when the user named an entity and either nothing resolved, or what
  // resolved is clearly a different thing (i.e. leftover conversation focus).
  if (explicitEntity) {
    const namedCore = explicitEntity.name.toLowerCase();
    const resolvedName = (evidencePack.entityName || '').toLowerCase();
    const tokens = namedCore.split(/\s+/).filter((t) => t.length >= 4);
    const matched = tokens.length > 0 && tokens.some((t) => resolvedName.includes(t));
    if (!evidencePack.hasEvidence || !matched) {
      return finish({
        route: 'unknown_entity',
        text: `I can't find ${/^[aeiou]/i.test(explicitEntity.kind) ? 'an' : 'a'} ${explicitEntity.kind} called ${explicitEntity.name}.`,
        evidence: false,
        fallbackReason: `unresolved_entity: ${namedCore}`,
      });
    }
  }



  // ── 5b. Repository / code questions & explicit Hermes delegation ────────────
  const isExplicitHermesDelegation =
    /\b(?:ask|tell|have|delegate\s+to)\s+(?:hermes|codex)\b/i.test(lower) ||
    (/\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(lower) && !/\b(?:local\s+worker|a\s+worker)\b/i.test(lower));
  const isLocalWorker = /\b(?:worker|local\s+worker)\b/i.test(lower) && !/\b(?:ask|tell|have)\s+hermes\b/i.test(lower);
  const isRepoLocate = /\b(?:find|locate|search|where\s+is|open|show)\b.*\brepository\b/i.test(lower);
  if (!isAntiGravityDelegation && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocate && !isLocalWorker) || isExplicitHermesDelegation) && !isLocalWorker)) {
    const tTool = Date.now();
    try {
      const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
      const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');
      let workspacePath: string | undefined;
      try { workspacePath = getWorkspaceRoot(); } catch { /* optional */ }
      const res: any = await executeSupervisorTool(
        'delegate_hermes_task',
        {
          objective: prompt,
          context: 'Requested over the JARVIS conversation channel.',
          approvalRequired: false,
          envelope: {
            constraints: { readOnly: !/\b(?:modify|write|edit|update|create|delete)\b/i.test(lower) },
            objective: prompt,
          },
        },
        { conversationId, workspacePath },
      );
      timings.toolMs = Date.now() - tTool;
      const taskId = res?.taskId || res?.task?.taskId;
      const ok = !!taskId && res?.error == null;
      return finish({
        route: 'action',
        text: ok
          ? `I delegated that task to Hermes. Task ${taskId} is queued against the repository.`
          : `I attempted to delegate to Hermes, but the delegation did not succeed: ${res?.error || 'no task id returned'}.`,
        evidence: true, executed: ok, verified: false, // Phase 1: a queued task id is not a verified result
        fallbackReason: ok ? undefined : 'hermes_delegation_failed',
      });
    } catch (err: any) {
      timings.toolMs = Date.now() - tTool;
      return finish({
        route: 'action',
        text: `I couldn't reach the Hermes delegation capability: ${err?.message || err}.`,
        evidence: false, executed: false, verified: false,
        fallbackReason: `hermes_delegation_error: ${err?.message || err}`,
      });
    }
  }

  // ── 5c. Recent task status inquiry ("What happened with that task?", "Did that task finish?") ──
  const isRecentTaskInquiry =
    /\b(?:what happened with|how did|status of|did.*finish|did.*complete)\b.*\b(?:task|that)\b/i.test(lower) ||
    /\bwhat happened with (?:that|the) task\b/i.test(lower) ||
    /\bhow did (?:that|the) task go\b/i.test(lower);
  if (isRecentTaskInquiry) {
    try {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
      const allTasks = backgroundTaskManager.listTasks();
      const matching = allTasks
        .filter((t: any) => t.conversationId === conversationId || t.worker === 'hermes' || t.worker === 'codex')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const recentTask = matching[0];
      if (recentTask) {
        let reply = `Task ${recentTask.taskId} ("${recentTask.title}") has status ${recentTask.status}.`;
        if (recentTask.resultText) {
          reply += ` Result: ${recentTask.resultText}`;
        }
        return finish({
          route: 'action',
          text: reply,
          evidence: true,
          executed: true,
          verified: recentTask.status === 'completed',
          entityId: recentTask.taskId,
          entityType: 'task',
          entityName: recentTask.title,
        });
      }
    } catch (err: any) {
      logger.warn('[JRT] Task status lookup failed:', err);
    }
  }

  // ── 6. NAVIGATE / FOCUS ────────────────────────────────────────────────
  if (isNavigation && evidencePack.hasEvidence && evidencePack.entityType !== 'project_list') {
    const entityId = evidencePack.entityId || '';
    const entityName = evidencePack.entityName || entityId || 'it';
    const entityType = evidencePack.entityType || 'project';
    const nav = await executeNavigate({
      entityId,
      entityName,
      entityType,
      focus,
      verb: 'open',
      navigationVerifier: opts.navigationVerifier,
    });
    const wantsStatus = /\b(?:status|tell me|what|how|state|doing|progress|details|tasks?|goals?)\b/i.test(lower);
    const spokenText = (wantsStatus && evidencePack.directAnswer)
      ? `${nav.text} ${evidencePack.directAnswer}`
      : nav.text;
    return finish({
      route: 'navigate',
      text: spokenText,
      evidence: true,
      executed: nav.executed,
      verified: nav.verified,
      entityId,
      entityType,
      entityName,
      uiRoute: nav.uiRoute,
    });
  }

  // ── 7. ACTION ──────────────────────────────────────────────────────────
  if (isAction && evidencePack.hasEvidence) {
    const entityId = evidencePack.entityId;
    const entityName = evidencePack.entityName || entityId || 'it';
    const priority = parsePriorityMutation(prompt);

    if (priority !== null && evidencePack.entityType === 'project' && entityId) {
      const outcome = await executeSetPriority(entityId, entityName, priority);
      return finish({
        route: 'action', text: outcome.text, evidence: true,
        executed: outcome.executed, verified: outcome.verified,
        entityId, entityType: 'project', entityName,
      });
    }

    // ── 7a. First-Class Project Operations ────────────────────────────
    if (RESOLVE_BLOCKER_RE.test(lower) && (evidencePack.entityType === 'project' || focus.activeProjectId || focus.activeBlockerId)) {
      const targetProjectId = evidencePack.entityType === 'project' ? entityId : focus.activeProjectId;
      if (!targetProjectId) {
        return finish({
          route: 'action',
          text: 'There is no active project selected to resolve blockers for.',
          evidence: false,
          executed: false,
          verified: false,
        });
      }
      const { resolveFirstBlocker } = await import('../../services/projectExecution/projectController.js');
      const outcome = await resolveFirstBlocker({
        projectId: targetProjectId,
        targetBlockerId: focus.activeBlockerId,
        conversationId,
      });
      return finish({
        route: 'action',
        text: outcome.spokenText,
        evidence: true,
        executed: outcome.actionTaken,
        verified: true,
        entityId: targetProjectId,
        entityType: 'project',
        entityName: outcome.projectName,
      });
    }

    if (PROJECT_STOP_RE.test(lower)) {
      const stopTarget = resolveStateChangingTarget({
        explicitProjectId: evidencePack.entityId,
        entityId,
        entityType: evidencePack.entityType,
        projectScopeSource: evidencePack.projectScopeSource,
        lower,
        activeProjectId: focus.activeProjectId,
        activeProjectName: focus.activeProjectName,
      });
      if (!stopTarget.projectId) {
        // ABORT — a state change must never run against an unrequested project.
        return finish({
          route: 'project_operate',
          text: stopTarget.ask as string,
          evidence: false,
          executed: false,
          verified: false,
        });
      }
      const targetProjectId = stopTarget.projectId;
      const { stopProject } = await import('../../services/projectExecution/projectController.js');
      const outcome = await stopProject({ projectId: targetProjectId, conversationId });
      return finish({
        route: 'project_operate',
        text: outcome.spokenText,
        evidence: true,
        executed: outcome.executed,
        verified: outcome.verified,
        entityId: targetProjectId,
        entityType: 'project',
        entityName: outcome.projectName,
      });
    }

    const isRunningWorkInquiry =
      /\b(?:what|which|how many|is there|are there|tell me what|show me what)\b/i.test(lower) &&
      /\b(?:work|tasks?|jobs?)\b/i.test(lower) &&
      /\b(?:running|active|happening)\b/i.test(lower);

    const isOperatePrompt =
      !corpusLevel &&
      evidencePack.entityType !== 'project_list' &&
      !isPrerequisiteQuestion &&
      !isRunningWorkInquiry &&
      (PROJECT_OPERATE_RE.test(lower) ||
      (/\b(start|run|launch|activate|resume|operate|work|continue|proceed|get moving)\b/i.test(lower) &&
       !/\b(open|show|display|view|see)\b/i.test(lower)));

    if (isOperatePrompt) {
      const operateTarget = resolveStateChangingTarget({
        explicitProjectId: evidencePack.entityId,
        entityId,
        entityType: evidencePack.entityType,
        projectScopeSource: evidencePack.projectScopeSource,
        lower,
        activeProjectId: focus.activeProjectId,
        activeProjectName: focus.activeProjectName,
      });
      if (!operateTarget.projectId) {
        // ABORT — the live defect: "start the project shop by." must never
        // operate the stale active project. Ask instead of executing.
        return finish({
          route: 'project_operate',
          text: operateTarget.ask as string,
          evidence: false,
          executed: false,
          verified: false,
        });
      }
      const targetProjectId = operateTarget.projectId;
      const { operateProject } = await import('../../services/projectExecution/projectController.js');
      const continueOnly = /\b(?:continue|proceed|next)\b/i.test(lower);
      // The user's ACTUAL command (wake word stripped) travels with the
      // operation as the durable original goal. When FreeCash is held at the
      // authentication prerequisite, THIS text is what gets stored and resumed —
      // never a generic default, and never a re-ask.
      const originalGoal = (effectivePrompt || prompt || '').trim() || undefined;
      const outcome = await operateProject({
        projectId: targetProjectId,
        conversationId,
        continueOnly,
        originalGoal,
      });

      if (outcome.presentedBlockers && outcome.presentedBlockers.length > 0) {
        focus.lastPresentedBlockers = outcome.presentedBlockers;
        focus.activeBlockerId = outcome.presentedBlockers[0].taskId;
        focus.activeBlockerTitle = outcome.presentedBlockers[0].title;
        focus.activeBlockerReason = outcome.presentedBlockers[0].reason;
        focus.activeBlockerMetadata = outcome.presentedBlockers[0].metadata;
        focus.activeBlockerDependencies = outcome.presentedBlockers[0].dependencyIds;
        focus.activeBlockerObjective = outcome.presentedBlockers[0].objective;
        focus.activeBlockerWorker = outcome.presentedBlockers[0].worker;
      }

      let replyText = outcome.spokenText;
      const userAskedForHumanBlockers = /\b(?:kyc|help|credentials?|notify|tell me|let me know)\b/i.test(lower);
      if (userAskedForHumanBlockers && outcome.presentedBlockers && outcome.presentedBlockers.length > 0) {
        const humanBlocker = outcome.presentedBlockers.find(b =>
          /\b(?:credential|api\s*key|kyc|oauth|captcha|login|token|secret)\b/i.test(b.reason || b.title)
        );
        if (humanBlocker) {
          replyText += ` If human action is required, ${humanBlocker.reason || humanBlocker.title} is currently needed.`;
        }
      }

      return finish({
        route: 'project_operate',
        text: replyText,
        evidence: outcome.evidence,
        executed: outcome.executed,
        verified: outcome.verified,
        entityId: targetProjectId,
        entityType: 'project',
        entityName: outcome.projectName,
      });
    }

    if (/\b(start|run|launch|activate|resume)\b/i.test(lower) && entityId === 'revenue_operator') {
      const outcome = await executeStartRevenueOperator();
      return finish({
        route: 'action', text: outcome.text, evidence: true,
        executed: outcome.executed, verified: outcome.verified,
        entityId, entityType: 'capability', entityName,
      });
    }

    const verb = (lower.match(ACTION_RE)?.[0] || 'perform that').toLowerCase();

    // Check dynamically registered capabilities first (e.g. dynamic repairs)
    const dynamicKey = `${verb}:${evidencePack.entityType}`;
    const dynamicHandler = dynamicCapabilities.get(dynamicKey) || dynamicCapabilities.get(verb);
    if (dynamicHandler) {
      const outcome = await dynamicHandler({
        entityId: entityId || '',
        entityName,
        entityType: evidencePack.entityType || 'unknown',
        prompt,
        lower,
        conversationId,
      });
      return finish({
        route: 'action',
        text: outcome.text,
        evidence: true,
        executed: outcome.executed,
        verified: outcome.verified,
        entityId,
        entityType: evidencePack.entityType,
        entityName,
      });
    }

    // STRICT SELF-HEAL GATING:
    // Only trigger Self-Heal when:
    // 1. entity exists (evidencePack.hasEvidence)
    // 2. intent is an actual executable action
    // 3. that action is expected/supported for this entity type
    // 4. capability is unexpectedly missing
    // 5. operation is not navigation, read, or unsupported invention
    const expectedCheck = isExpectedActionForEntity(verb, evidencePack.entityType || 'project', entityId);
    if (!expectedCheck.expected) {
      logger.info('[JRT] ACTION_REJECTED_UNSUPPORTED', { verb, entityType: evidencePack.entityType, reason: expectedCheck.reason });
      return finish({
        route: 'action',
        text: `I can't ${verb} ${entityName}. That is not a supported operation.`,
        evidence: true,
        executed: false,
        verified: false,
        entityId,
        entityType: evidencePack.entityType,
        entityName,
        fallbackReason: 'unsupported_operation',
      });
    }

    // Invariant 5: SELF_HEAL_ALLOWED = STT_CONFIDENT && GOAL_CONFIDENT && EXECUTOR_CONFIDENT && EXPECTED_CAPABILITY && ACTUAL_CAPABILITY_FAILURE
    const isVoiceTurn = Boolean(opts.rawStt);
    const sttConf = (opts as any).confidence ?? 1.0;
    if (isVoiceTurn && sttConf < 0.80) {
      logger.warn('[JRT] SELFHEAL_REJECTED_UNCERTAIN_SPEECH', { verb, entityName, sttConf });
      return finish({
        route: 'action',
        text: `You want me to ${verb} ${entityName} — is that right?`,
        evidence: false,
        executed: false,
        verified: false,
        entityId,
        entityType: evidencePack.entityType,
        entityName,
        fallbackReason: 'uncertain_speech_selfheal_prevented',
      });
    }

    // Genuine expected capability missing: raise Self-Heal
    logger.info('[JRT] SELFHEAL_DETECTED', {
      component: `jarvis.capability.${verb}.${entityId || ''}`,
      verb,
      entityId,
      entityName,
    });
    console.log(`[JRT] SELFHEAL_DETECTED component=jarvis.capability.${verb}.${entityId || ''}`);

    const heal = await raiseSelfHealIncident({
      component: `jarvis.capability.${verb}.${entityId || ''}`,
      symptom: `User asked JARVIS to "${verb}" ${entityName} (${entityId || ''}) over the voice channel, but no executable ${verb} capability is wired to that entity.`,
      conversationId,
      originalAction: {
        prompt,
        conversationId,
        entityId: entityId || '',
        entityType: evidencePack.entityType || 'project',
        entityName,
        verb,
      },
    });
    return finish({
      route: 'action',
      text:
        `I can see ${entityName}, but no executable ${verb} capability is currently connected.` +
        (heal.raised ? ` I've raised a self-heal incident (${heal.incidentId}) to get that capability built.` : ''),
      evidence: true, executed: false, verified: false,
      entityId, entityType: evidencePack.entityType, entityName,
      fallbackReason: heal.raised ? `no_executable_capability; self_heal=${heal.incidentId}` : 'no_executable_capability',
    });
  }

  // ── 7. FAST READ ───────────────────────────────────────────────────────
  if (evidencePack.directAnswer) {
    let text = evidencePack.directAnswer;

    // Offer concrete, executable next steps and remember them as structured
    // choices, so "do the first one" resolves without asking again.
    if (evidencePack.readIntent === 'entity_lookup' && evidencePack.entityId === 'revenue_operator') {
      const choices: OfferedChoice[] = [
        { id: 'start_ro', label: 'start Revenue Operator', intent: 'start_revenue_operator', args: {} },
        { id: 'ro_missions', label: 'list its missions', intent: 'list_revenue_missions', args: {} },
      ];
      focus.pendingChoices = choices;
      text += ` I can ${choices[0].label}, or ${choices[1].label}.`;
      logger.info('[JRT] CHOICES_OFFERED', { conversationId, choices: choices.map((c) => c.id) });
    }

    return finish({
      route: 'fast_read', text, evidence: true,
      entityId: evidencePack.entityId, entityType: evidencePack.entityType,
      entityName: evidencePack.entityName,
    });
  }

  // ── 7b. Navigation safety guard: navigation must NEVER fall into deep supervisor ──
  if (
    (/\b(open|show|display|see|view|bring up|switch to|focus on|go to)\b/i.test(lower) || isNavigation) &&
    evidencePack.hasEvidence &&
    evidencePack.entityType !== 'project_list'
  ) {
    const entityId = evidencePack.entityId || '';
    const entityName = evidencePack.entityName || entityId || 'it';
    const entityType = evidencePack.entityType || 'project';
    const nav = await executeNavigate({
      entityId,
      entityName,
      entityType,
      focus,
      verb: 'open',
      navigationVerifier: opts.navigationVerifier,
    });
    return finish({
      route: 'navigate',
      text: nav.text,
      evidence: true,
      executed: nav.executed,
      verified: nav.verified,
      entityId,
      entityType,
      entityName,
      uiRoute: nav.uiRoute,
    });
  }

  // ── 8. DEEP — hand to Supervisor V2 ────────────────────────────────────
  const tDeep = Date.now();
  const { runGroundedVoiceTurn, GROUNDING_REFUSAL } = await import('./groundedTurnBridge.js');
  const deep = await runGroundedVoiceTurn({ prompt, conversationId, isStale });
  timings.supervisorMs = Date.now() - tDeep;

  if (deep.handled) {
    return finish({
      route: 'deep_supervisor', text: deep.text, evidence: deep.evidence,
      entityId: evidencePack.entityId, entityType: evidencePack.entityType,
    });
  }

  // Section 3: Universal Capability Discovery & Recovery
  const isActionGoal = /\b(locate|find|open|launch|start|run|show|focus|bring|foreground|screenshot|telegram|hermes|notepad|youtube|google|browser|chatgpt|comet|perplexity|calculator|excel)\b/i.test(prompt);

  if (operational || readIntent || isActionGoal) {
    try {
      const {
        capabilityDiscovery,
        controlPlaneExecutor,
        universalVerifier,
        autonomousRecoveryEngine,
        goalLifecycleManager,
        repairKnowledgeStore,
        acknowledgementService,
      } = await import('../controlPlane/index.js');

      const cleanTarget = prompt
        .replace(/^(?:can you\s+|could you\s+|please\s+|i want to\s+|would you\s+)?(?:open|launch|start|run|locate|find|show|search\s+for)\s+/i, '')
        .replace(/\s+(?:app|application|program|tool)$/i, '')
        .trim();

      if (cleanTarget) {
        logger.info(`[JRT:ControlPlane] Triggering capability discovery for "${cleanTarget}"`);
        const goalRun = goalLifecycleManager.startGoal({
          conversationId,
          turnId: opts.turnId ? String(opts.turnId) : undefined,
          userInput: prompt,
          normalizedGoal: effectivePrompt,
          target: cleanTarget,
        });

        goalLifecycleManager.transitionState(goalRun.goalId, 'DISCOVERING', {
          actor: 'ControlPlane',
          summary: `Discovering capabilities across execution surfaces for "${cleanTarget}".`,
        });

        const candidates = await capabilityDiscovery.discover(cleanTarget, 'open');

        if (candidates.length > 0) {
          const best = candidates[0];
          logger.info(`[JRT:ControlPlane] Discovered strategy: ${best.surface} (${best.name}) score=${best.score}`);

          goalLifecycleManager.transitionState(goalRun.goalId, 'EXECUTING', {
            actor: 'ControlPlane',
            summary: `Executing strategy on surface "${best.surface}": ${best.name}`,
            detail: best,
          });

          // Execute
          const execRes = await controlPlaneExecutor.execute(best);

          goalLifecycleManager.transitionState(goalRun.goalId, 'VERIFYING', {
            actor: 'UniversalVerifier',
            summary: `Verifying execution of ${best.name} on ${best.surface}.`,
          });

          // Verify
          const verRes = await universalVerifier.verify({
            surface: best.surface,
            target: best.target,
            parameters: best.parameters,
          });

          if (execRes.executed && verRes.verified) {
            // Learn resolution
            const learned = {
              target: cleanTarget,
              goalType: 'open',
              successfulStrategy: `discovered:${best.surface}`,
              surface: best.surface,
              executablePath: best.executablePath,
              url: best.url,
              parameters: best.parameters,
              verificationMethod: verRes.method,
              confidence: best.score,
              learnedAt: new Date().toISOString(),
            };
            repairKnowledgeStore.recordResolution(learned);
            goalLifecycleManager.recordLearnedResolution(goalRun.goalId, learned);
            goalLifecycleManager.recordVerification(goalRun.goalId, verRes);

            const completionText = acknowledgementService.generateCompletionMessage(best.name || cleanTarget, best.surface);
            goalLifecycleManager.transitionState(goalRun.goalId, 'COMPLETED', {
              actor: 'UniversalVerifier',
              summary: completionText,
              detail: verRes,
            });

            return finish({
              route: best.surface === 'browser' ? 'browser' : 'action',
              text: completionText,
              evidence: true,
              executed: true,
              verified: true,
              entityName: best.name,
            });
          } else {
            // Enter Autonomous Recovery
            const recoveryOutcome = await autonomousRecoveryEngine.handleFailure({
              goalId: goalRun.goalId,
              failedAttempt: {
                attemptNumber: 1,
                strategy: `discovered:${best.surface}`,
                surface: best.surface,
                target: best.target,
                parameters: best.parameters,
                startedAt: new Date().toISOString(),
                executed: execRes.executed,
                verified: false,
                evidence: verRes.evidence || [],
              },
              target: cleanTarget,
              goalType: 'open',
              executeStrategy: async (s) => controlPlaneExecutor.execute(s),
            });

            if (recoveryOutcome.success) {
              return finish({
                route: 'action',
                text: recoveryOutcome.finalResponseText,
                evidence: true,
                executed: true,
                verified: true,
              });
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn(`[JRT:ControlPlane] Discovery / execution warning: ${err?.message}`);
    }

    const isDesktopCmd = /\b(locate|find|open|focus|bring|foreground|screenshot|telegram|hermes|notepad|youtube|google|browser)\b/i.test(prompt);
    return finish({
      route: isDesktopCmd ? 'action' : 'refusal',
      text: isDesktopCmd
        ? `I could not locate or execute the requested desktop target for "${prompt.replace(/[.?]+$/, '')}".`
        : GROUNDING_REFUSAL,
      evidence: false,
      fallbackReason: deep.fallbackReason || 'no_evidence',
    });
  }

  return finish({ route: 'deep_supervisor', text: '', handled: false, fallbackReason: deep.fallbackReason });
}

/**
 * Raise an incident with the EXISTING Self-Heal Engineering Supervisor for a
 * capability that is expected to exist but is missing or broken. Kicks off the
 * closed-loop repair and logs required audit events.
 */
async function raiseSelfHealIncident(opts: {
  component: string;
  symptom: string;
  conversationId: string;
  goalId?: string;
  originalAction?: {
    prompt: string;
    conversationId: string;
    entityId: string;
    entityType: string;
    entityName: string;
    verb: string;
  };
}): Promise<{ raised: boolean; incidentId?: string }> {
  try {
    const { failureDetector } = await import('../selfHeal/FailureDetector.js');
    const { selfHealSupervisor } = await import('../selfHeal/SelfHealSupervisor.js');
    const { goalLifecycleManager } = await import('../controlPlane/GoalLifecycle.js');

    const activeGoal = opts.goalId
      ? goalLifecycleManager.getGoalRun(opts.goalId)
      : goalLifecycleManager.getActiveGoalForConversation(opts.conversationId);
    const goalId = activeGoal?.goalId;

    const incidentId: string = await failureDetector.createManualIncident(
      opts.component,
      opts.symptom,
      'backend',
      'medium',
      { source: 'jarvis-next-voice', conversationId: opts.conversationId, goalId },
    );
    logger.info('[JRT] SELFHEAL_INCIDENT_CREATED', { incidentId, component: opts.component, goalId });
    console.log(`[JRT] SELFHEAL_INCIDENT_CREATED incidentId=${incidentId} goalId=${goalId || 'none'}`);

    if (goalId) {
      goalLifecycleManager.linkIncident(goalId, incidentId);
    }

    if (opts.originalAction) {
      selfHealSupervisor.executeClosedLoopRepair({
        incidentId,
        goalId,
        conversationId: opts.conversationId,
        originalUserInput: opts.originalAction.prompt,
        capabilityId: opts.component,
        target: opts.originalAction.entityName || opts.originalAction.entityId,
        userAction: {
          verb: opts.originalAction.verb,
          target: opts.originalAction.entityName || opts.originalAction.entityId,
          originalPrompt: opts.originalAction.prompt,
          entityId: opts.originalAction.entityId,
          entityType: opts.originalAction.entityType,
          entityName: opts.originalAction.entityName,
          conversationId: opts.conversationId,
        },
        failureClassification: {
          domain: 'implementation',
          repairability: 'engineering',
          reason: opts.symptom,
        },
        originalAction: opts.originalAction,
      }).catch((err: any) => {
        logger.warn('[JRT] SELF_HEAL_CLOSED_LOOP_ERROR', { incidentId, error: err?.message || String(err) });
      });
    } else {
      selfHealSupervisor.diagnoseIncident(incidentId).catch((err: any) => {
        logger.warn('[JRT] SELF_HEAL_DIAGNOSE_ERROR', { incidentId, error: err?.message || String(err) });
      });
    }
    return { raised: true, incidentId };
  } catch (err: any) {
    logger.warn('[JRT] SELF_HEAL_RAISE_FAILED', { error: err?.message || String(err) });
    return { raised: false };
  }
}

async function dispatchChoice(choice: OfferedChoice): Promise<ActionOutcome> {
  switch (choice.intent) {
    case 'start_revenue_operator':
      return await executeStartRevenueOperator();
    case 'set_priority': {
      const { projectId, projectName, priority } = choice.args as any;
      return await executeSetPriority(projectId, projectName, Number(priority));
    }
    case 'open_project': {
      const { projectId, projectName } = choice.args as any;
      const nav = await executeNavigate({ entityId: projectId, entityName: projectName, entityType: 'project', focus: {} });
      return { executed: nav.executed, verified: nav.verified, text: nav.text };
    }
    case 'list_revenue_missions': {
      const pack = await buildProjectStateContext('What missions does the Revenue Operator have?');
      return pack.directAnswer
        ? { executed: true, verified: true, text: pack.directAnswer }
        : { executed: false, verified: false, text: 'I could not read the Revenue Operator missions.' };
    }
    default:
      return { executed: false, verified: false, text: `No executable capability is connected for "${choice.label}".` };
  }
}

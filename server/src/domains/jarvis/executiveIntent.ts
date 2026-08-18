/**
 * JARVIS Executive Intent classifier.
 *
 * Determines whether a prompt refers to an internal AgenticOS capability
 * (Hermes, CodeX, Research, Agent Teams, Boards, Memory, Automations,
 * Revenue Pipeline) and which of the executive intent classes applies.
 *
 * Precedence (explicit user language overrides low-confidence classification):
 *   1. task-control command            (delegated to taskControl.ts upstream)
 *   2. revenue pipeline request        (business website audit/rebuild/proposal)
 *   3. explicit worker delegation
 *   4. worker status / feedback query
 *   5. navigation request
 *   6. board / memory / automation query
 *   7. direct response / explanation
 *   8. LLM classification only where still ambiguous
 *
 * This classifier only fires when the prompt names an internal capability or
 * clearly describes a pipeline request. It must never route a plain
 * conversation message to execution.
 */
import { CAPABILITY_REGISTRY, getCapability, resolveCapability, type Capability, type CapabilityId } from './capabilityRegistry.js';
import { isLiveSystemInvestigationRequest } from './intentRouter.js';

export type ExecutiveIntentType =
  | 'direct_explanation'
  | 'worker_status'
  | 'worker_feedback'
  | 'worker_delegation'
  | 'navigation'
  | 'board_query'
  | 'memory_query'
  | 'automation_request'
  | 'revenue_pipeline';

export interface ExecutiveIntent {
  intent: ExecutiveIntentType;
  capability: Capability;
  confidence: number;
  reason: string;
  /** True when the user constrained delegation to read-only. */
  readOnly?: boolean;
  /** Worker kind for delegation (from the capability registry). */
  workerKind?: string;
}

const EXPLAIN_VERBS = /\b(explain|what does|what is|describe|tell me about|how does|what are|who is|what's|do you know about|what\s+\w+\s+does|what\s+\w+\s+do)\b/;
const STATUS_VERBS = /\b(status|how is|how are|doing|working on|using|what model|what provider|active|busy|health|healthy|alive|up to)\b/;
const FEEDBACK_VERBS = /\b(feedback|assessment|evaluate|review|audit|assess|how (good|well)|report on)\b/;
const NAV_VERBS = /\b(open|go to|take me to|navigate to|launch|show me the page|switch to)\b/;
const DELEGATE_VERBS =
  /\b(ask|have|tell|get|make|delegate|instruct|send|request|ask the|tell the|use the|create|add|queue|file|raise|log)\b/;
const TASK_WORDS = /\b(inspect|analy[sz]e|review|fix|change|modify|update|implement|create|build|trace|read|investigate|report|find|look at|examine|check)\b/;
const READ_ONLY_CONSTRAINTS = /\b(do not modify|do not change|do not write|without modifying|without changing|read-only|readonly|no file changes|no changes|do not edit|do not touch)\b/;

/**
 * Revenue Pipeline V1 request detection (two parts):
 *   - PIPELINE_PHRASE_RE — explicit pipeline phrases
 *   - PIPELINE_ACTION_RE — action verb + business/prospect context + website/city
 * Status/explanation queries about the pipeline itself (e.g. "how is the
 * revenue pipeline doing") must NOT create tasks — they fall through to
 * worker_status / direct_explanation.
 */
export const PIPELINE_PHRASE_RE =
  /(revenue pipeline|business pipeline|website audit|rebuild (concept|proposal)|prospect pipeline)/i;

export const PIPELINE_ACTION_RE =
  /(audit|find|discover|research|rank|score)[^.!?\n]{0,100}(businesses?|companies?|firms?|shops?|prospects?|leads|candidates)[^.!?\n]{0,100}(websites?|in [A-Za-zäöüß][A-Za-zäöüß -]{1,40})|(businesses?|companies?|firms?|shops?|prospects?)[^.!?\n]{0,60}(weak websites?|website audit|rebuild)/i;

/**
 * Bare revenue action: an audit/discover/find/rank verb plus a business or
 * trade target, WITHOUT the city/website tail. These prompts carry enough
 * revenue-pipeline structure to route to the Revenue Pipeline (which then
 * asks for the genuinely missing field) — they must never fall into the
 * generic short-prompt clarification (CodeX / Hermes / direct chat).
 */
export const PIPELINE_BARE_ACTION_RE =
  /(audit|find|discover|research|rank|score)[^.!?\n]{0,80}(businesses?|companies?|firms?|shops?|prospects?|leads?|roofers?|plumbers?|electricians?|painters?|hairdressers?|barbers?|contractors?)/i;

/** True when the prompt is a revenue-pipeline REQUEST (action or phrase). */
export function isRevenueActionRequest(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(ask|tell|have|get|make|delegate|instruct)\s+(hermes|codex|research|teams?|automation)\b/.test(p)) return false;
  if (STATUS_VERBS.test(p) || EXPLAIN_VERBS.test(p)) return false;
  return PIPELINE_PHRASE_RE.test(p) || PIPELINE_ACTION_RE.test(p) || PIPELINE_BARE_ACTION_RE.test(p);
}

/** True when the prompt names an internal capability at all. */
export function mentionsInternalCapability(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return CAPABILITY_REGISTRY.some((c) => c.aliases.some((alias) => p.includes(alias)));
}

export function classifyExecutiveIntent(prompt: string): ExecutiveIntent | null {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();

  const cap = resolveCapability(p);

  // Revenue Pipeline V1 — runs when the prompt describes a business website
  // audit/rebuild/proposal request and NO real worker capability won (an
  // explicit "Ask Hermes to audit…" still delegates to Hermes).
  const explicitWorkerDelegationMention = /\b(ask|tell|have|get|make|delegate|instruct)\s+(hermes|codex|research|teams?|automation)\b/.test(p);
  const realWorkerCap = (cap && cap.taskWorkerKind !== null && cap.id !== 'revenue_pipeline') || explicitWorkerDelegationMention;
  const pipelinePhrase = PIPELINE_PHRASE_RE.test(p);
  const pipelineAction = PIPELINE_ACTION_RE.test(p) || PIPELINE_BARE_ACTION_RE.test(p);
  if (
    (pipelinePhrase && !realWorkerCap && !STATUS_VERBS.test(p) && !EXPLAIN_VERBS.test(p)) ||
    (pipelineAction && !realWorkerCap)
  ) {
    const pipelineCap = getCapability('revenue_pipeline')!;
    return {
      intent: 'revenue_pipeline',
      capability: pipelineCap,
      confidence: cap?.id === 'revenue_pipeline' ? 0.97 : 0.9,
      reason: 'Local business website audit / rebuild / proposal request',
      workerKind: 'revenue',
    };
  }

  if (!cap) return null;

  // JARVIS is the orchestrator itself — "you"/"assistant" mentions are direct
  // conversation, never an executive worker query. Let direct chat handle them.
  if (cap.id === 'jarvis') return null;

  // Magnitude delegations are handled directly by the intentRouter
  if (cap.id === 'magnitude') return null;

  // Global non-delegation or capability-specific prohibition:
  // "answer directly", "do not delegate", or prohibition targeting this specific capability
  const isCapProhibited =
    /\b(do not delegate|don't delegate|answer directly|no agent)\b/.test(p) ||
    cap.aliases.some(alias => new RegExp(`\\b(?:do not|don't|no|without|never)\\s+(?:create|register|set up|add|schedule|use|ask|have)?\\s*(?:an?\\s+)?${alias}\\b`).test(p));
  if (isCapProhibited) {
    return null;
  }

  // Navigation first among worker-mention intents: "Open CodeX."
  if (NAV_VERBS.test(p)) {
    // But "open the board" should be a board_query/navigation to /boards,
    // and "ask ... to open ..." is delegation, not navigation.
    const delegationAhead = DELEGATE_VERBS.test(p) && TASK_WORDS.test(p) && !/^(open|go|take|navigate|launch|switch)/.test(p.trim());
    if (!delegationAhead) {
      return {
        intent: 'navigation',
        capability: cap,
        confidence: 0.97,
        reason: `Explicit navigation request to ${cap.displayName}`,
      };
    }
  }

  // A full live-system/health inspection ("perform a read-only AgenticOS
  // health inspection; check Hermes/Ollama/OpenRouter...") must fall through
  // to the INVESTIGATE pipeline — a single-worker status reply cannot cover
  // gateway/frontend/stream/task state. Runs BEFORE the broad delegation
  // branch (a mere worker mention is an OBJECT, not delegation), but AFTER an
  // EXPLICIT worker-target cue ("Ask Hermes to inspect X") which still wins.
  // Explicit worker-target cue: "ask/tell/have Hermes do X" OR an explicit
  // task-creation instruction naming the worker ("create a task for Hermes
  // to inspect X"). Both must win over the live-system investigation
  // fall-through — the user asked for WORK, not a status inspection.
  const explicitWorkerTargetCue = /\b(ask|tell|have|get|make|delegate|instruct)\s+(hermes|codex)\b/.test(p) ||
    /\b(create|add|queue|file|raise|log)\s+(a|an|the|one|new)?\s*(task|job|issue|ticket|goal)\s+(for|to|with)\s+(hermes|codex)\b/.test(p);
  if (isLiveSystemInvestigationRequest(prompt) && !explicitWorkerTargetCue) {
    return null;
  }

  // Delegation: explicit ask/tell + task verb → create a background task.
  // Checked BEFORE capability-specific (board/memory/automation) queries so
  // "Ask Hermes to inspect the Boards integration" delegates to Hermes.
  const isDelegation =
    (DELEGATE_VERBS.test(p) && TASK_WORDS.test(p)) ||
    /\b(ask|tell|have|get|make|delegate)\s+(hermes|codex)\b/.test(p) ||
    (cap.taskWorkerKind !== null && TASK_WORDS.test(p) && /^(ask|tell|have|get|make|delegate|instruct)/.test(p.trim()));

  // "create a daily automation" / "add a board" / "set up a memory" are
  // requests to CREATE the capability itself — NOT worker delegation. The
  // task-creation verbs (create/add/queue/...) must still delegate when a
  // real worker is named ("create a task for Hermes to inspect X"), so only
  // self-capability creation requests are excluded here.
  const capSelfCreation = /^(create|add|queue|make|set up|file|raise|log)\s+(a|an|the|new\s+)?([a-z]+\s+){0,2}(automation|automations|board|boards|memory|memor[yie]s|goal|goals)\b/.test(p.trim());
  if (capSelfCreation && cap && ['automations', 'boards', 'memory', 'goals'].includes(cap.id)) {
    // fall through to capability-specific handling (automation_request, ...)
  } else if (isDelegation && cap.taskWorkerKind) {
    const readOnly = READ_ONLY_CONSTRAINTS.test(p);
    return {
      intent: 'worker_delegation',
      capability: cap,
      confidence: 0.96,
      reason: `Explicit delegation to ${cap.displayName} (${readOnly ? 'read-only' : 'standard'})`,
      readOnly,
      workerKind: cap.taskWorkerKind,
    };
  }

  // Board / memory / automation queries (capability-specific).
  if (cap.id === 'boards') {
    return {
      intent: 'board_query',
      capability: cap,
      confidence: 0.9,
      reason: 'Boards capability mentioned in a query/action context',
    };
  }
  if (cap.id === 'memory') {
    // A bare "remember" in an ordinary statement ("Please remember that…",
    // "I remember when…") is conversational context — the direct-chat LLM
    // receives it via conversation history. Only genuine memory QUERIES
    // ("Do you remember…", "What did I say…", "my preferences") route to the
    // memory capability; everything else falls through to the normal router.
    const isGenuineMemoryQuery =
      /\b(what did i say|my preferences|do you remember|do we remember|what do you remember|what happened|what did we (do|decide|find|learn)|whats? our (last|most recent))\b/i.test(p) ||
      /^(what|how|do|does|when|where|why)\b.*\b(remember|memory|memor(y|ies))\b/i.test(p);
    if (!isGenuineMemoryQuery) return null;
    return {
      intent: 'memory_query',
      capability: cap,
      confidence: 0.9,
      reason: 'Memory capability mentioned',
    };
  }
  if (cap.id === 'automations') {
    if (/\b(?:do not|don't|no|without|never)\s+(?:create|register|set up|add|schedule)?\s*(?:an?\s+)?automation\b/i.test(p)) {
      return null;
    }
    return {
      intent: 'automation_request',
      capability: cap,
      confidence: 0.9,
      reason: 'Automations capability mentioned',
    };
  }

  // Feedback: "Give me feedback regarding CodeX" — structured assessment.
  if (FEEDBACK_VERBS.test(p)) {
    return {
      intent: 'worker_feedback',
      capability: cap,
      confidence: 0.94,
      reason: `Worker feedback request for ${cap.displayName}`,
    };
  }

  // A full live-system/health inspection ("perform a read-only AgenticOS
  // health inspection; check Hermes/Ollama/OpenRouter...") must fall through
  // to the INVESTIGATE pipeline — a single-worker status reply cannot cover
  // gateway/frontend/stream/task state. Delegation/navigation/feedback above
  // still win; "How is Hermes doing?" (informational) stays worker_status.
  if (isLiveSystemInvestigationRequest(prompt)) {
    return null;
  }

  // Status: "How is Hermes doing?" / "What model is CodeX using?"
  if (STATUS_VERBS.test(p)) {
    return {
      intent: 'worker_status',
      capability: cap,
      confidence: 0.9,
      reason: `Worker status query for ${cap.displayName}`,
    };
  }

  // Explanation: "Explain what CodeX does" — answer from registry, no task.
  if (EXPLAIN_VERBS.test(p)) {
    return {
      intent: 'direct_explanation',
      capability: cap,
      confidence: 0.85,
      reason: `Explanation request for ${cap.displayName}`,
    };
  }

  // Bare mention with no actionable verb — status is the safest executive read.
  if (STATUS_VERBS.test(p) || /\b(how|what|is|are|doing|working)\b/.test(p)) {
    return {
      intent: 'worker_status',
      capability: cap,
      confidence: 0.7,
      reason: `Worker mentioned without an execution verb — reporting status`,
    };
  }

  return null;
}

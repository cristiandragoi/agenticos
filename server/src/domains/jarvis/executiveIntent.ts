import { isConversationalFeedback } from './intentRouter.js';
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
  | 'capability_start'
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

const EXPLAIN_VERBS = /\b(explain|what does|what is|describe|tell me about|how does|what are|who is|what's|do you know about|what\s+\w+\s+does|what\s+\w+\s+do|what\s+can\s+\w+\s+do|what\s+can\s+you\s+do|what\s+capabilities)\b/;
// "Check <capability>" is an operator status request, not an LLM chat
// prompt. Keep it in the deterministic executive lane so a short spoken
// command such as "check Revenue Operator" cannot fall into Supervisor V2.
const STATUS_VERBS = /\b(check|status|how is|how are|doing|working on|using|what model|what provider|active|busy|health|healthy|alive|up to|did|what did|what has|done|finish|finished|completed|result)\b/;
const FEEDBACK_VERBS = /\b(feedback|assessment|evaluate|review|audit|assess|how (good|well)|report on)\b/;
const NAV_VERBS = /\b(open|go to|take me to|navigate to|show me the page|show me|switch to|show)\b/;
const START_VERBS = /\b(start|run|execute|trigger|begin|invoke|launch)\b/;
const DELEGATE_VERBS =
  /\b(ask|have|tell|get|make|delegate|instruct|send|request|ask the|tell the|use the|create|add|queue|file|raise|log|hand off|handoff)\b/;
const TASK_WORDS = /\b(inspect|analy[sz]e|review|fix|change|modify|update|implement|create|build|trace|read|investigate|report|find|look at|examine|check|write)\b/;

export function isReadOnlyConstraint(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/['’]/g, "'");
  const cleaned = p
    .replace(/\b(?:do not|don't|dont|without|no|never)\s+(?:modify|change|edit|touch|write|patch|update|refactor|delete|remove|create|add|implement)\s+(?:any\s+|the\s+|a\s+|our\s+)?(?:other\s+)?(?:code|codebase|files?|implementation|anything|nothing)?\b/gi, '')
    .replace(/\b(?:without\s+(?:modifying|changing|editing|touching|writing|patching|updating|deleting|removing|creating|adding|implementing)\s+(?:any\s+|the\s+|a\s+|our\s+)?(?:code|codebase|files?|implementation|anything)?)\b/gi, '')
    .replace(/\b(?:no\s+(?:code\s+changes?|file\s+changes?|changes?))\b/gi, '')
    .replace(/\b(?:analysis\s+only|read\s*-?\s*only|inspection\s+only)\b/gi, '');

  const hasWriteTarget = /\b(?:create|write|generate|add|touch|patch|fix|update|implement|modify|build)\b/i.test(cleaned);
  const matchesConstraint = (
    /\b(?:do not|don't|dont|no|without|never)\s+(?:modify|write|edit|change|touch|patch|update)\s+(?:any\s+|the\s+|a\s+|our\s+)?(?:code|codebase|files?|implementation|anything)?\b/i.test(p) ||
    /\b(?:without\s+(?:modifying|writing|editing|changing|touching)\s+(?:anything|any\s+(?:code|codebase|files?|implementation))?)\b/i.test(p) ||
    /\b(?:no\s+(?:code\s+changes?|file\s+changes?|changes?))\b/i.test(p) ||
    /\b(?:analysis\s+only|read\s*-?\s*only|inspection\s+only)\b/i.test(p)
  );
  return matchesConstraint && !hasWriteTarget;
}

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
  if (/\b(ask|tell|have|get|make|delegate|instruct|hand off|handoff)\s+(hermes|codex|research|teams?|automation|antigravity)\b/.test(p)) return false;
  if (STATUS_VERBS.test(p) || EXPLAIN_VERBS.test(p)) return false;
  return PIPELINE_PHRASE_RE.test(p) || PIPELINE_ACTION_RE.test(p) || PIPELINE_BARE_ACTION_RE.test(p);
}

/** True when the prompt names an internal capability at all. */
export function mentionsInternalCapability(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return CAPABILITY_REGISTRY.some((c) => c.aliases.some((alias) => p.includes(alias)));
}

export function classifyExecutiveIntent(prompt: string): ExecutiveIntent | null {
  const p = prompt.toLowerCase().replace(/['’]/g, "'");
  if (isConversationalFeedback(prompt)) return null;

  const isExplicitQueue = /\b(queue this for codex|queue it for codex|queue that change request|queue this project for codex)\b/i.test(p);
  const isExplicitGive = /\b(give this to codex|give this project to codex|give it to codex|give this project)\b/i.test(p);
  const isExplicitStart = /\b(start this project now|start the project now|start this task now|start executing now)\b/i.test(p);
  const isExplicitPrepare = /\b(prepare this for codex but don't start|prepare this for codex but do not start|prepare but don't start|prepare only)\b/i.test(p);

  if (isExplicitQueue || isExplicitGive || isExplicitStart || isExplicitPrepare) {
    const codexCap = getCapability('codex')!;
    const executionMode = isExplicitQueue ? 'queued'
      : isExplicitGive ? 'immediate'
      : isExplicitStart ? 'start_now'
      : 'specification_only';
    
    return {
      intent: 'worker_delegation',
      capability: codexCap,
      confidence: 0.99,
      reason: `Explicit CodeX delegation request with mode: ${executionMode}`,
      workerKind: 'codex',
      executionMode,
    } as any;
  }

  const cap = resolveCapability(p);

  // Revenue Pipeline V1 — runs when the prompt describes a business website
  // audit/rebuild/proposal request and NO real worker capability won (an
  // explicit "Ask Hermes to audit…" still delegates to Hermes).
  const explicitWorkerDelegationMention = /\b(ask|tell|have|get|make|delegate|instruct|hand off|handoff)\s+(hermes|codex|research|teams?|automation|antigravity)\b/.test(p);
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
    if (cap.id === 'boards') {
      return {
        intent: 'board_query',
        capability: cap,
        confidence: 0.9,
        reason: 'Boards capability mentioned in a query/action context',
      };
    }
    // But "ask ... to open ..." is delegation, not navigation.
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

  // Capability execution: "Start Revenue Operator."
  if (START_VERBS.test(p)) {
    const delegationAhead = DELEGATE_VERBS.test(p) && TASK_WORDS.test(p) && !/^(start|run|execute|trigger|begin|invoke|launch)/.test(p.trim());
    if (!delegationAhead) {
      return {
        intent: 'capability_start',
        capability: cap,
        confidence: 0.98,
        reason: `Explicit capability execution request for ${cap.displayName}`,
      };
    }
  }

  // Spoken command form: "check Revenue Operator" means report the
  // operator's current state. It is intentionally narrower than a general
  // "check <system>" investigation, so health checks for Hermes/gateways
  // still reach the investigation pipeline.
  if (cap.id === 'revenue_operator' && /^(?:(?:hey\s+)?jarvis[,\s]+)?(?:please\s+)?(?:check\b|what is (?:the )?revenue operator doing\b|tell me about (?:the )?revenue operator|what projects.*(?:inside|in)\b|projects.*(?:inside|in) (?:the )?revenue operator\b)/i.test(p.trim())) {
    return {
      intent: 'worker_status',
      capability: cap,
      confidence: 0.97,
      reason: 'Explicit Revenue Operator status request',
    };
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
  const explicitWorkerTargetCue = /\b(ask|tell|have|get|make|delegate|instruct|hand off|handoff)\s+(?:to\s+)?(hermes|codex|antigravity)\b/.test(p) ||
    /\b(create|add|queue|file|raise|log)\s+(a|an|the|one|new)?\s*(task|job|issue|ticket|goal)\s+(for|to|with)\s+(hermes|codex|antigravity)\b/.test(p);
  if (isLiveSystemInvestigationRequest(prompt) && !explicitWorkerTargetCue) {
    return null;
  }

  // Delegation: explicit ask/tell + task verb → create a background task.
  // Checked BEFORE capability-specific (board/memory/automation) queries so
  // "Ask Hermes to inspect the Boards integration" delegates to Hermes.
  const isDelegation =
    (DELEGATE_VERBS.test(p) && TASK_WORDS.test(p)) ||
    /\b(ask|tell|have|get|make|delegate|hand off|handoff)\s+(?:to\s+)?(hermes|codex|antigravity)\b/.test(p) ||
    (cap.taskWorkerKind !== null && TASK_WORDS.test(p) && /^(ask|tell|have|get|make|delegate|instruct|hand off|handoff)/.test(p.trim()));

  // "create a daily automation" / "add a board" / "set up a memory" are
  // requests to CREATE the capability itself — NOT worker delegation. The
  // task-creation verbs (create/add/queue/...) must still delegate when a
  // real worker is named ("create a task for Hermes to inspect X"), so only
  // self-capability creation requests are excluded here.
  const capSelfCreation = /^(create|add|queue|make|set up|file|raise|log)\s+(a|an|the|new\s+)?([a-z]+\s+){0,2}(automation|automations|board|boards|memory|memor[yie]s|goal|goals)\b/.test(p.trim());
  if (capSelfCreation && cap && ['automations', 'boards', 'memory', 'goals'].includes(cap.id)) {
    // fall through to capability-specific handling (automation_request, ...)
  } else if (isDelegation && cap.taskWorkerKind) {
    const readOnly = isReadOnlyConstraint(p);
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
    // Directing work TO a worker ("give ... to codex", "send ... to hermes") is delegation/handoff, not feedback on the worker.
    if (/\b(?:give|send|assign|hand\s*off|handoff|delegate)\b.*\bto\s+(?:hermes|codex|antigravity)\b/i.test(p)) {
      return null;
    }
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

  // Questions regarding task findings, grounded results, claims, or evidence
  // must be handled conversationally using the task context and grounded evidence.
  const isFindingsOrEvidenceQuery =
    /\b(find|found|findings?|report(ed)?|discover(ed)?|problems?|blockers?|issues?|why did (?:codex|hermes|it) (?:say|list|claim|name)|where did (?:codex|hermes|it) find|what did (?:codex|hermes|it) (?:find|report|see|conclude|say))\b/i.test(p);
  if (isFindingsOrEvidenceQuery) {
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

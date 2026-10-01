/**
 * turnLifecycle/types.ts — the ONE authoritative turn lifecycle (Phase 1).
 *
 * Every real request (LiveKit voice, typed chat, Telegram, scheduler/routines,
 * certification, self-heal retries) is normalized into a TurnRequest and owned
 * by TurnLifecycleController from understanding through response/TTS:
 *
 *   UNDERSTAND -> POLICY -> EXECUTE -> VERIFY -> OUTCOME -> RESPONSE -> TTS
 *
 * Executors return ExecutionReceipts only. Only the independent verifier may
 * produce a VerificationResult, and only the controller assigns the Outcome.
 */

export type TurnSource =
  | 'voice_livekit'
  | 'voice_text_injection'   // /api/jarvis-next/agent/turn and LiveKit `user_text` data messages
  | 'typed_chat'
  | 'telegram'
  | 'scheduler'
  | 'routine'
  | 'certification'
  | 'self_heal_retry'
  | 'api';

export type TurnStage =
  | 'RECEIVED'
  | 'UNDERSTAND'
  | 'POLICY'
  | 'EXECUTE'
  | 'VERIFY'
  | 'OUTCOME'
  | 'RESPONSE'
  | 'TTS'
  | 'DONE';

export type TurnOutcome = 'VERIFIED' | 'EXECUTED_UNVERIFIED' | 'FAILED' | 'BLOCKED';

/** Normalized request. Built ONLY by ingress.normalizeRequest(). */
export interface TurnRequest {
  requestId: string;
  /** Transport-level turn id (voice turn counter, typed operationId, Telegram message id). */
  externalTurnId?: string;
  source: TurnSource;
  conversationId: string;
  text: string;
  sttConfidence?: number;
  audioRef?: string;
  buildId: string;
  receivedAt: string;
  /** Explicit context the caller attaches (e.g. self-heal retry of a goal). Nothing else is inherited. */
  attached?: {
    retryOfRequestId?: string;
    goalId?: string;
    incidentId?: string;
    /**
     * Recovery identity (self-heal retries). Turns carrying a chain id — and every turn whose
     * source is `self_heal_retry` — run as RECOVERY WORK: they may record a failure on their
     * chain but can never open an incident, start a repair run or hand off to a worker.
     */
    recoveryChainId?: string;
    /** The original user operation this retry is trying to fix. */
    rootOperationId?: string;
    retryAttempt?: number;
  };
}

export type ActionType = 'launch_app' | 'type_text' | 'open_url' | 'other';

/** Output of UNDERSTAND. Created BEFORE anything executes. */
export interface TurnGoal {
  kind: 'answer' | 'action' | 'control';
  summary: string;
  action?: {
    type: ActionType;
    app?: string;
    text?: string;
    url?: string;
  };
  /** Whether this request explicitly continues the previous request in this conversation. */
  continuesPrevious: boolean;
  understoodBy: 'llm_planner' | 'fallback' | 'structured_submission';
  plannerError?: string;
}

export type PostconditionKind =
  | 'window_of_app_newly_present_or_foregrounded'
  | 'text_present_in_new_or_target_window'
  | 'browser_tab_at_host_after_navigation'
  | 'answer_delivered'
  | 'legacy_unverifiable'
  | 'none_control';

/** Defined BEFORE execution, handed unchanged to the verifier. */
export interface Postcondition {
  kind: PostconditionKind;
  description: string;
  expected: Record<string, unknown>;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  capability?: string;
}

/**
 * Execution receipt. Executors describe WHAT THEY DID. They have no field
 * for verification and the controller never reads one from them.
 */
export interface ExecutionReceipt {
  executor: string;
  attempted: boolean;
  /** The executor's own claim that its call returned without error. NOT verification. */
  completedWithoutError: boolean;
  startedAt: string;
  finishedAt: string;
  error?: string;
  details: Record<string, unknown>;
  /** Text produced by a legacy handler (answer or report). Never trusted as proof. */
  handlerText?: string;
  /** Legacy handler said it performed a side effect. */
  handlerClaimedSideEffect?: boolean;
}

export interface VerificationEvidence {
  probe: string;
  observedAt: string;
  observation: unknown;
}

export interface VerificationResult {
  verifier: 'TurnLifecycleVerifier';
  /** true = postcondition observed in fresh state after the action started. */
  satisfied: boolean;
  /** false = the verifier cannot observe this postcondition at all. */
  observable: boolean;
  reason: string;
  evidence: VerificationEvidence[];
  checkedAt: string;
}

/** Pre-execution observation used to reject pre-existing state as proof. */
export interface PreExecutionSnapshot {
  takenAt: string;
  windows?: ObservedWindow[];
  foregroundHwnd?: number;
  browserTabs?: ObservedTab[];
  appWindowTexts?: Array<{ hwnd: number; text: string }>;
}

export interface ObservedWindow {
  hwnd: number;
  pid: number;
  process: string;
  title: string;
}

export interface ObservedTab {
  id: string;
  url: string;
  title: string;
}

export interface TurnRecord {
  request: TurnRequest;
  contextKey: string;
  stage: TurnStage;
  goal?: TurnGoal;
  postcondition?: Postcondition;
  policy?: PolicyDecision;
  snapshot?: PreExecutionSnapshot;
  receipt?: ExecutionReceipt;
  verification?: VerificationResult;
  outcome?: TurnOutcome;
  outcomeReason?: string;
  responseText?: string;
  spoken?: boolean;
  handler?: string;
  supersededBy?: string;
  completedAt?: string;
  error?: string;
}

/** What a transport supplies so the controller can deliver the response. */
export interface TurnSink {
  /** TTS. Only invoked by the controller, after the outcome is fixed. */
  speak?: (text: string, record: TurnRecord) => Promise<void>;
  progress?: (event: Record<string, unknown>) => void;
  /** Typed transports: navigation verifier passed through to legacy handlers. */
  navigationVerifier?: (req: {
    navigationId: string;
    route: string;
    entityId: string;
    entityType: string;
    entityName: string;
  }) => Promise<{ verified: boolean; actualRoute?: string; visibleEntityId?: string; error?: string }>;
}

/**
 * types.ts — Core interfaces and types for the Browser Revenue Operator (Phase 1).
 */

export type BrowserWorkerStatus =
  | 'INITIALIZING'
  | 'SPAWNING'
  | 'IDLE'
  | 'CLAIMING_TASK'
  | 'PREPARING_BROWSER'
  | 'NAVIGATING'
  | 'EVALUATING_POLICY'
  | 'EXECUTING_ACTION'
  | 'VERIFYING_OUTCOME'
  | 'RECORDING_LEDGER'
  | 'COOLDOWN'
  | 'PAUSED_FOR_GATE'
  | 'RETRYING'
  | 'FAILED'
  | 'STALLED'
  | 'RECOVERING'
  | 'PAUSED'
  | 'STOPPING'
  | 'TERMINATED';

export type TaskTerminalStatus =
  | 'COMPLETED'
  | 'GATED'
  | 'DENIED'
  | 'FAILED'
  | 'RETRY_SCHEDULED'
  | 'CANCELLED';

export type TaskFailureCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'POLICY_DENIED'
  | 'HUMAN_GATE'
  | 'SESSION_INVALID'
  | 'PROVIDER_CHANGED'
  | 'TIMEOUT';


export interface StateAwareHeartbeatPayload {
  state: BrowserWorkerStatus;
  currentUrl?: string;
  currentTaskId?: string;
  memMb?: number;
  lastAction?: string;
  latencyMs?: number;
  timestamp: string;
}

export interface ProfileLockInfo {
  pid: number;
  workerId: string;
  providerAccountId: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface CircuitBreakerState {
  tripped: boolean;
  reason?: string;
  trippedAt?: string;
  cooldownUntil?: string;
  failureCount: number;
}

// ── IPC Protocol between Supervisor (Parent) and Worker (Child Process) ───────

export type SupervisorToWorkerMessage =
  | { type: 'INIT'; workerId: string; providerAccountId: string; profilePath: string; headless?: boolean }
  | { type: 'SHUTDOWN'; reason: string }
  | { type: 'GLOBAL_KILL'; reason: string }
  | { type: 'EXECUTE_TEST_SUICIDE' }; // For test isolation verification

export type WorkerToSupervisorMessage =
  | { type: 'READY'; workerId: string; pid: number }
  | { type: 'HEARTBEAT'; workerId: string; payload: StateAwareHeartbeatPayload }
  | { type: 'STATUS_CHANGE'; workerId: string; previous: BrowserWorkerStatus; current: BrowserWorkerStatus }
  | { type: 'SHUTDOWN_ACK'; workerId: string }
  | { type: 'ERROR'; workerId: string; error: string };

// ── Phase 2 Policy Decision Engine Interfaces ──────────────────────────────────

export type PolicyDecision = 'ALLOW' | 'GATE' | 'DENY';

export type ActionRiskCategory =
  | 'PAYMENT'
  | 'PURCHASE'
  | 'PAYOUT'
  | 'ACCOUNT_SECURITY'
  | 'CREDENTIAL'
  | 'KYC'
  | 'CAPTCHA'
  | 'LEGAL_ACCEPTANCE'
  | 'EXTERNAL_REDIRECT'
  | 'ROUTINE';

export type RoutineActionType =
  | 'NAVIGATE'
  | 'READ_DOM'
  | 'SCROLL'
  | 'CLICK'
  | 'FORM_FILL'
  | 'WAIT'
  | 'VERIFY_STATE';

export interface PolicyDecisionResult {
  decision: PolicyDecision;
  reasonCode: string;
  reason: string;
  workerId: string;
  providerAccountId: string;
  providerId: string;
  actionType: string;
  targetDomain: string;
  timestamp: string;
  actionCategory?: ActionRiskCategory;
  metadata?: Record<string, unknown>;
}

export interface ProposedBrowserAction {
  workerId: string;
  providerAccountId: string;
  providerId: string;
  actionType: string;
  targetUrl: string;
  elementRole?: string;
  elementName?: string;
  elementText?: string;
  formDestination?: string;
  inputName?: string;
  inputType?: string;
  inputValue?: string;
  monetaryAmount?: number;
  currency?: string;
  navigationDestination?: string;
  currentState?: {
    url?: string;
    title?: string;
    isCaptchaPresent?: boolean;
    isKycModalPresent?: boolean;
    stateName?: string;
    knownStates?: string[];
  };
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface DomainPolicyRule {
  domain: string;
  allowSubdomains?: boolean;
}

export interface ActionPolicyRule {
  allowed: boolean;
  maxPerHour?: number;
  maxPerDay?: number;
  maxPerMinute?: number;
  restrictions?: Record<string, unknown>;
}

export interface ProviderAccountPolicy {
  providerId: string;
  providerAccountId: string;
  enabled: boolean;
  spendingLimit: number; // default 0
  allowedDomains: (string | DomainPolicyRule)[];
  allowedActionTypes: (RoutineActionType | string)[];
  actionRules?: Record<string, ActionPolicyRule>;
  hourlyActionLimit: number; // default 120
  dailyActionLimit: number;  // default 1000
  minuteActionLimit?: number;
  unexpectedStateBehavior?: 'GATE' | 'DENY';
  allowedRedirectDomains?: (string | DomainPolicyRule)[];
  knownStates?: string[];
  knownLoginUrls?: string[];
  tracingMode?: boolean;
}


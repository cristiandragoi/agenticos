/**
 * Canonical Background Task contract (Milestone: Persistent Background Task Manager).
 *
 * One contract, one manager, one event vocabulary. Worker adapters (Hermes,
 * CodeX, Research, Agent Teams, Automation) translate worker-specific state
 * into this contract — the manager never contains provider-specific logic.
 */

export type TaskStatus =
  | 'queued'
  | 'dispatched'
  | 'worker_accepted'
  | 'planning'
  | 'running'
  | 'executing'
  | 'worker_done'
  | 'validating_worker_output'
  | 'testing'
  | 'building'
  | 'deploying'
  | 'retrying_original_goal'
  | 'argus_verifying'
  | 'verifying'
  | 'waiting_approval'
  | 'waiting_for_auth'
  | 'paused'
  | 'review'
  | 'recovering'
  | 'reassigning_worker'
  | 'blocked_external'
  | 'failed_exhausted'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

/** Terminal states are immutable — late worker events can never revive them. WORKER_DONE is explicitly NOT terminal. */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'failed_exhausted',
]);

export type WorkerKind = 'hermes' | 'codex' | 'research' | 'team' | 'automation' | 'revenue' | 'magnitude' | 'antigravity' | 'self-heal';

export type TaskEventKind =
  | 'task.created'
  | 'task.queued'
  | 'task.started'
  | 'task.stage_changed'
  | 'task.progress'
  | 'task.agent_selected'
  | 'task.run_linked'
  | 'task.board_linked'
  | 'task.file_changed'
  | 'task.build_started'
  | 'task.build_completed'
  | 'task.test_started'
  | 'task.test_completed'
  | 'task.approval_requested'
  | 'task.approval_resolved'
  | 'task.paused'
  | 'task.resumed'
  | 'task.stop_requested'
  | 'task.cancelled'
  | 'task.review_started'
  | 'task.worker_done'
  | 'task.validation_started'
  | 'task.validation_rejected'
  | 'task.claim_rejected'
  | 'task.reopened'
  | 'task.recovery_started'
  | 'task.plan_continuation'
  | 'task.worker_accepted'
  | 'task.command'
  | 'task.file_read'
  | 'task.testing'
  | 'task.test_passed'
  | 'task.building'
  | 'task.retrying_original_goal'
  | 'task.goal_retried'
  | 'task.argus_verifying'
  | 'task.argus_verified'
  | 'task.verified'
  | 'task.completed'
  | 'task.blocked'
  | 'task.failed'
  | 'task.gate_started'
  | 'task.gate_passed'
  | 'task.gate_failed'
  | 'task.verification_started'
  | 'task.verification_completed'
  | 'task.handoff_initiated'
  | 'task.handoff_delivered'
  | 'run.recovery.started'
  | 'run.recovery.classified'
  | 'run.recovery.retry'
  | 'run.recovery.escalated'
  | 'run.recovery.rework_started'
  | 'run.recovery.exhausted'
  | 'run.recovery.blocked_by_policy'
  | 'run.recovery.completed';

export interface BackgroundTaskRecord {
  taskId: string;
  title: string;
  objective: string;
  originalRequest: string;
  route: string;
  selectedAgent: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  projectId: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  conversationId: string | null;
  conversationSessionId: string | null;
  /** worker kind + worker-specific run/goal id, e.g. hermes:hapi-xyz / codex:goal-abc */
  worker: WorkerKind;
  linkedRunId: string | null;
  linkedBoardCardId: string | null;
  parentTaskId: string | null;
  childTaskIds: string[];
  currentStage: string;
  progressMessage: string;
  filesChanged: string[];
  buildState: 'idle' | 'running' | 'passed' | 'failed';
  testState: 'idle' | 'running' | 'passed' | 'failed';
  verificationState: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  approvalState: 'none' | 'pending' | 'allowed' | 'denied';
  blocker: string | null;
  lastError: string | null;
  cancellationRequested: boolean;
  /** Whether the worker genuinely supports pause/resume (checkpointing). */
  resumable: boolean;
  /** Final result text once verified. */
  resultText: string | null;
  /** Incremented on retry — guards against stale worker callbacks. */
  attempt: number;
  metadata: Record<string, unknown>;
  /**
   * Canonical workspace root captured at task creation (§1, §9). Every
   * worker resolves files against THIS value — never process.cwd(), never
   * a later repository selection.
   */
  workspaceRoot: string;
}

export interface BackgroundTaskEvent {
  id: string;
  taskId: string;
  ts: string;
  kind: TaskEventKind;
  summary: string;
  detail: Record<string, unknown>;
  /** Monotonic per-task sequence for SSE catch-up. */
  sequence: number;
}

export interface TaskApprovalRequest {
  taskId: string;
  action: string;
  reason: string;
  command?: string;
  files?: string[];
  choices?: string[];
  canonicalAction?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  isReadOnly?: boolean;
}

export const TASK_LIMITS = {
  /** Conservative defaults — overridable via env BG_TASK_MAX_* (not exposed in UI yet). */
  maxActiveGlobal: Number(process.env.BG_TASK_MAX_ACTIVE ?? 3),
  maxActiveHermes: Number(process.env.BG_TASK_MAX_HERMES ?? 1),
  maxActiveCodex: Number(process.env.BG_TASK_MAX_CODEX ?? 1),
  maxActiveTeam: Number(process.env.BG_TASK_MAX_TEAM ?? 1),
  maxQueued: Number(process.env.BG_TASK_MAX_QUEUED ?? 10),
};

export function isExecutingStatus(s: TaskStatus): boolean {
  return s === 'planning' || s === 'running' || s === 'verifying';
}

export function isActiveStatus(s: TaskStatus): boolean {
  return s === 'queued' || s === 'planning' || s === 'running' || s === 'verifying' || s === 'waiting_approval' || s === 'waiting_for_auth' || s === 'review';
}

export function taskShortId(taskId: string): string {
  const m = taskId.match(/-(\w+)$/);
  return m ? `T-${m[1].slice(0, 6).toUpperCase()}` : taskId;
}

/* ─────────────────────────────────────────────────────────────
 * Delegation Contract (§14 of Jarvis repair — Phase 1 minimum)
 *
 * Structured context carried in BackgroundTaskRecord.metadata.delegationEnvelope
 * when Jarvis delegates to Hermes/CodeX. Preserves authoritative context that
 * would otherwise be lost when flattening to a bare prompt string. Phase 1
 * stores it in typed metadata; Phase 2 promotes it to first-class fields.
 * ───────────────────────────────────────────────────────────── */

/** Canonical entity reference a delegation operates on. */
export interface DelegationTarget {
  id: string;
  /** 'revenue_opportunity' | 'capability' | 'project' | 'task' | 'agent' */
  type: string;
  /** 'revenue_operator' | 'capabilities' | 'projects' | 'tasks' | 'agents' */
  domain: string;
  displayName: string;
}

export interface DelegationEnvelope {
  /** The pending action that triggered this delegation (idempotency key). */
  pendingActionId?: string;
  /** Canonical target entity the delegation operates on. */
  target?: DelegationTarget;
  /** Exact resolved objective — NOT the truncated title. */
  objective: string;
  /** What "done" means for this delegation. */
  acceptanceCriteria?: string[];
  constraints?: {
    /** e.g. "5m", "30m" */
    maxRuntime?: string;
    readOnly?: boolean;
    /** Specific files or directories. */
    fileScope?: string[];
    allowedTools?: string[];
  };
  /** Relevant instruction from the user or conversation context. */
  relevantInstruction?: string;
  /** Previous related tasks/results for continuity. */
  relatedTaskIds?: string[];
  relatedResultIds?: string[];
  /** Parent goal from dialogue state. */
  parentGoal?: string;
  /** Worker requested at delegation time. */
  worker?: 'hermes' | 'codex' | 'research' | 'magnitude' | 'antigravity';
}

/** Structured result from a worker back to Jarvis — Phase 1 extraction from
 *  existing task result fields; Phase 2 canonical return type. */
export interface ResultEnvelope {
  taskId: string;
  status: 'completed' | 'failed' | 'blocked' | 'cancelled';
  /** Human-readable result summary. */
  summary: string;
  artifactReferences?: Array<{ path: string; type: 'file' | 'link' | 'data' }>;
  verificationState?: string;
  error?: string;
  blocker?: string;
  filesChanged?: string[];
}

/** Helper: read the delegation envelope from task metadata, if present. */
export function getDelegationEnvelope(task: { metadata?: Record<string, unknown> }): DelegationEnvelope | null {
  const env = (task.metadata || {})['delegationEnvelope'];
  if (env && typeof env === 'object' && typeof (env as DelegationEnvelope).objective === 'string') {
    return env as DelegationEnvelope;
  }
  return null;
}

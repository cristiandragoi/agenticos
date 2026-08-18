/**
 * Canonical Background Task contract (Milestone: Persistent Background Task Manager).
 *
 * One contract, one manager, one event vocabulary. Worker adapters (Hermes,
 * CodeX, Research, Agent Teams, Automation) translate worker-specific state
 * into this contract — the manager never contains provider-specific logic.
 */

export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'verifying'
  | 'waiting_approval'
  | 'paused'
  | 'review'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

/** Terminal states are immutable — late worker events can never revive them. */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export type WorkerKind = 'hermes' | 'codex' | 'research' | 'team' | 'automation' | 'revenue' | 'magnitude';

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
  | 'task.verified'
  | 'task.completed'
  | 'task.blocked'
  | 'task.failed'
  | 'task.gate_started'
  | 'task.gate_passed'
  | 'task.gate_failed'
  | 'task.verification_started'
  | 'task.verification_completed'
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
}

export const TASK_LIMITS = {
  /** Conservative defaults — overridable via env BG_TASK_MAX_* (not exposed in UI yet). */
  maxActiveGlobal: Number(process.env.BG_TASK_MAX_ACTIVE ?? 3),
  maxActiveHermes: Number(process.env.BG_TASK_MAX_HERMES ?? 1),
  maxActiveCodex: Number(process.env.BG_TASK_MAX_CODEX ?? 1),
  maxActiveTeam: Number(process.env.BG_TASK_MAX_TEAM ?? 1),
  maxQueued: Number(process.env.BG_TASK_MAX_QUEUED ?? 10),
};

export function isActiveStatus(s: TaskStatus): boolean {
  return s === 'queued' || s === 'planning' || s === 'running' || s === 'verifying' || s === 'waiting_approval' || s === 'review';
}

export function taskShortId(taskId: string): string {
  const m = taskId.match(/-(\w+)$/);
  return m ? `T-${m[1].slice(0, 6).toUpperCase()}` : taskId;
}

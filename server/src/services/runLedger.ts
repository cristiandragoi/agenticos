/**
 * RunLedger v1 — one normalized truth surface over the EXISTING authoritative
 * stores (background_tasks + background_task_events + goalStore + runStore +
 * executionState). No new table: this is a read-view + normalizer.
 *
 * Every meaningful execution is inspectable as a RunLedgerEntry with
 * parent/child chains, model truth, artifacts, gates and verification state.
 */
import { backgroundTaskRepo, ensureBackgroundTaskTables } from './backgroundTasks/store.js';
import { TERMINAL_STATUSES } from './backgroundTasks/types.js';
import type { BackgroundTaskRecord, TaskEventKind } from './backgroundTasks/types.js';
import type { GateResult } from './gates/types.js';
import { routingLedger } from './routingLedger.js';
import { hermesApiService, resolveHermesModelTruth } from './hermesApiService.js';

export type RunLedgerStatus =
  | 'queued' | 'planning' | 'running' | 'waiting' | 'verifying'
  | 'completed' | 'failed' | 'cancelled' | 'blocked';

export interface RunLedgerEntry {
  runId: string;
  taskId?: string;
  parentRunId?: string;
  parentTaskId?: string;
  operationId?: string;
  conversationId?: string;
  projectId?: string;
  agentId: string;
  workerType: string;
  assignedProvider?: string;
  assignedModel?: string;
  effectiveProvider?: string;
  effectiveModel?: string;
  /** Policy execution truth (Stage 2): the privacy/runtime policy that was
   *  in force for this run, whether cloud escalation was permitted by it,
   *  and whether an escalation/fallback actually occurred. Never includes
   *  prompt content. */
  policy?: {
    privacy: string;
    runtime: string;
    cloudEscalation: string;
    escalationAllowed: boolean;
    localOnly: boolean;
  };
  escalationOccurred?: boolean;
  taskText?: string;
  status: RunLedgerStatus;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  artifactIds?: string[];
  gateResults?: GateResult[];
  verificationState?: 'not_required' | 'pending' | 'passed' | 'failed';
  failureReason?: string;
}

export type RunLedgerEventKind =
  | 'run.created' | 'run.started' | 'run.planning' | 'run.executing' | 'run.waiting'
  | 'run.artifact.created' | 'run.gate.started' | 'run.gate.passed' | 'run.gate.failed'
  | 'run.verification.started' | 'run.verification.passed' | 'run.verification.failed'
  | 'run.completed' | 'run.failed' | 'run.cancelled'
  | 'run.recovery.started' | 'run.recovery.classified' | 'run.recovery.retry'
  | 'run.recovery.escalated' | 'run.recovery.rework_started' | 'run.recovery.exhausted'
  | 'run.recovery.blocked_by_policy' | 'run.recovery.completed';

/** P4 — map authoritative existing task event kinds into the stable run
 *  vocabulary. Preserves original IDs; never manufactures events. */
export function normalizeEventKind(kind: TaskEventKind | string): RunLedgerEventKind | string {
  switch (kind) {
    case 'task.created': case 'task.queued': return 'run.created';
    case 'task.started': case 'task.agent_selected': return 'run.started';
    case 'task.stage_changed': return 'run.planning';
    case 'task.progress': case 'task.file_changed': case 'task.run_linked': return 'run.executing';
    case 'task.build_started': case 'task.build_passed': case 'task.build_failed':
    case 'task.test_started': case 'task.test_passed': case 'task.test_failed': return 'run.executing';
    case 'task.gate_started': return 'run.gate.started';
    case 'task.gate_passed': return 'run.gate.passed';
    case 'task.gate_failed': return 'run.gate.failed';
    case 'task.verification_started': return 'run.verification.started';
    case 'task.verified': return 'run.verification.passed';
    case 'task.completed': return 'run.completed';
    case 'task.failed': return 'run.failed';
    case 'task.cancelled': return 'run.cancelled';
    // Recovery events pass through with the same stable vocabulary.
    case 'run.recovery.started': return 'run.recovery.started';
    case 'run.recovery.classified': return 'run.recovery.classified';
    case 'run.recovery.retry': return 'run.recovery.retry';
    case 'run.recovery.escalated': return 'run.recovery.escalated';
    case 'run.recovery.rework_started': return 'run.recovery.rework_started';
    case 'run.recovery.exhausted': return 'run.recovery.exhausted';
    case 'run.recovery.blocked_by_policy': return 'run.recovery.blocked_by_policy';
    case 'run.recovery.completed': return 'run.recovery.completed';
    default: return kind;
  }
}

const meta = (t: BackgroundTaskRecord) => (t.metadata || {}) as Record<string, any>;

function toLedgerStatus(t: BackgroundTaskRecord): RunLedgerStatus {
  switch (t.status) {
    case 'queued': return 'queued';
    case 'planning': return 'planning';
    case 'verifying': return 'verifying';
    case 'waiting_approval': return 'waiting';
    case 'blocked': return 'blocked';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'running';
  }
}

function entryFromTask(t: BackgroundTaskRecord): RunLedgerEntry {
  const m = meta(t);
  const gateResults: GateResult[] | undefined = Array.isArray(m.gateResults) ? m.gateResults : undefined;
  // Model truth (smallest fix): task metadata carries it for Jarvis-routed
  // delegations. REST-created tasks have it recorded elsewhere by the
  // authoritative subsystems — read it back, never invent it:
  //   - CodeX goals: routingLedger (requested/resolved provider+model per goal)
  //   - Hermes runs: the hermes run record itself (provider + model)
  let assignedProvider = m.assignedProvider || m.agentProvider || undefined;
  let assignedModel = m.assignedModel || m.agentModel || undefined;
  let effectiveProvider = m.effectiveProvider || m.resolvedProvider || undefined;
  let effectiveModel = m.effectiveModel || m.resolvedModel || undefined;
  // Policy execution truth (Stage 2): persisted by the adapter at dispatch.
  const rawPolicy = m.policy;
  const policy = rawPolicy && typeof rawPolicy === 'object' ? {
    privacy: String((rawPolicy as any).privacy || 'internal'),
    runtime: String((rawPolicy as any).runtime || 'auto'),
    cloudEscalation: String((rawPolicy as any).cloudEscalation || 'allowed'),
    escalationAllowed: Boolean((rawPolicy as any).escalationAllowed),
    localOnly: Boolean((rawPolicy as any).localOnly),
  } : undefined;
  let escalationOccurred: boolean | undefined;
  if (!effectiveProvider && t.linkedRunId) {
    try {
      if (t.worker === 'codex') {
        const rec = routingLedger.get(t.linkedRunId);
        if (rec) {
          assignedProvider = assignedProvider || rec.requestedProvider || undefined;
          assignedModel = assignedModel || rec.requestedModel || undefined;
          effectiveProvider = effectiveProvider || rec.resolvedProvider || undefined;
          effectiveModel = effectiveModel || rec.resolvedModel || undefined;
          escalationOccurred = rec.fallbackUsed;
        }
      } else if (t.worker === 'hermes') {
        const rec = hermesApiService.getRun?.(t.linkedRunId);
        if (rec) {
          assignedProvider = assignedProvider || rec.provider || undefined;
          assignedModel = assignedModel || rec.model || undefined;
          effectiveProvider = effectiveProvider || rec.provider || undefined;
          effectiveModel = effectiveModel || rec.model || undefined;
        }
        // The hermes run record stores the PROFILE alias (model:
        // <profile>, provider: '') — the ACTUAL provider/model come from the
        // profile config. Resolve whenever concrete values are still missing
        // (also covers post-restart queries when the in-memory run record is
        // gone and no snapshot exists yet).
        if (!effectiveProvider || !effectiveModel) {
          const truth = resolveHermesModelTruth();
          assignedProvider = assignedProvider || truth.provider || undefined;
          assignedModel = assignedModel || truth.model || undefined;
          effectiveProvider = truth.provider || effectiveProvider || undefined;
          effectiveModel = truth.model || effectiveModel || undefined;
        }
      }
    } catch { /* truth unavailable — leave metadata values as-is */ }
  }
  return {
    runId: t.linkedRunId || t.taskId,
    taskId: t.taskId,
    parentTaskId: t.parentTaskId || undefined,
    parentRunId: undefined, // resolved lazily via getParent
    operationId: m.operationId || undefined,
    conversationId: t.conversationId || undefined,
    projectId: t.projectId || undefined,
    agentId: t.selectedAgent || t.worker,
    workerType: t.worker,
    assignedProvider,
    assignedModel,
    effectiveProvider,
    effectiveModel,
    policy,
    escalationOccurred,
    taskText: t.objective || t.originalRequest || undefined,
    status: toLedgerStatus(t),
    startedAt: t.startedAt || undefined,
    updatedAt: t.updatedAt || undefined,
    completedAt: t.completedAt || undefined,
    artifactIds: Array.isArray(t.filesChanged) ? t.filesChanged : [],
    gateResults,
    verificationState: (t.verificationState === 'skipped' ? 'not_required' : t.verificationState) as RunLedgerEntry['verificationState'],
    failureReason: t.lastError || t.blocker || undefined,
  };
}

function allTasks(): BackgroundTaskRecord[] {
  ensureBackgroundTaskTables();
  return backgroundTaskRepo.listTasks({ limit: 500 });
}

export const runLedger = {
  /** One normalized record for a run id (the linked run) or a task id. */
  getRun(runId: string): RunLedgerEntry | null {
    const tasks = allTasks();
    const byRun = tasks.find((t) => (t.linkedRunId || t.taskId) === runId);
    const byTask = tasks.find((t) => t.taskId === runId);
    const t = byRun || byTask;
    if (!t) return null;
    const entry = entryFromTask(t);
    const parent = t.parentTaskId ? tasks.find((x) => x.taskId === t.parentTaskId) : null;
    if (parent) entry.parentRunId = parent.linkedRunId || parent.taskId;
    return entry;
  },

  getTaskRun(taskId: string): RunLedgerEntry | null {
    const t = allTasks().find((x) => x.taskId === taskId);
    return t ? entryFromTask(t) : null;
  },

  getChildren(runOrTaskId: string): RunLedgerEntry[] {
    const tasks = allTasks();
    const self = tasks.find((t) => (t.linkedRunId || t.taskId) === runOrTaskId || t.taskId === runOrTaskId);
    if (!self) return [];
    const kids = tasks.filter((t) => t.parentTaskId === self.taskId);
    return kids.map((t) => entryFromTask(t));
  },

  getParent(runOrTaskId: string): RunLedgerEntry | null {
    const tasks = allTasks();
    const self = tasks.find((t) => (t.linkedRunId || t.taskId) === runOrTaskId || t.taskId === runOrTaskId);
    if (!self || !self.parentTaskId) return null;
    const parent = tasks.find((t) => t.taskId === self.parentTaskId);
    if (!parent) return null;
    const entry = entryFromTask(parent);
    entry.parentRunId = undefined;
    return entry;
  },

  getActiveRuns(projectId?: string | null): RunLedgerEntry[] {
    return allTasks()
      .filter((t) => !TERMINAL_STATUSES.has(t.status) && (!projectId || t.projectId === projectId))
      .map((t) => entryFromTask(t));
  },

  getRecentRuns(projectId?: string | null, limit = 20): RunLedgerEntry[] {
    return allTasks()
      .filter((t) => !projectId || t.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, limit)
      .map((t) => entryFromTask(t));
  },

  getLastCompletedRun(projectId?: string | null): RunLedgerEntry | null {
    const t = allTasks()
      .filter((x) => x.status === 'completed' && (!projectId || x.projectId === projectId))
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime())[0];
    return t ? entryFromTask(t) : null;
  },

  getLastFailedRun(projectId?: string | null): RunLedgerEntry | null {
    const t = allTasks()
      .filter((x) => x.status === 'failed' && (!projectId || x.projectId === projectId))
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0];
    return t ? entryFromTask(t) : null;
  },

  getLastCancelledRun(projectId?: string | null): RunLedgerEntry | null {
    const t = allTasks()
      .filter((x) => x.status === 'cancelled' && (!projectId || x.projectId === projectId))
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0];
    return t ? entryFromTask(t) : null;
  },

  /** Evidence: task events normalized into the run vocabulary. */
  getRunEvidence(runId: string): Array<{ kind: string; ts: string; summary: string; detail: Record<string, unknown>; sequence: number }> {
    const tasks = allTasks();
    const t = tasks.find((x) => (x.linkedRunId || x.taskId) === runId || x.taskId === runId);
    if (!t) return [];
    return backgroundTaskRepo.getEvents(t.taskId).map((e) => ({
      kind: normalizeEventKind(e.kind),
      ts: e.ts,
      summary: e.summary,
      detail: e.detail,
      sequence: e.sequence,
    }));
  },
};

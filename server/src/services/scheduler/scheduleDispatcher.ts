/**
 * scheduler/scheduleDispatcher.ts — canonical bridge from a schedule
 * occurrence to REAL worker execution.
 *
 * The scheduler only triggers this dispatcher. The dispatcher composes the
 * canonical infrastructure:
 *
 *   Schedule fire
 *     → routine/schedule definition (what)
 *     → canonical Background Task (backgroundTasks — lifecycle/approval/cancel)
 *     → canonical Project Goal + Task (projectExecution)
 *     → canonical worker adapter (hermesAdapter / codexAdapter / magnitudeAdapter)
 *     → ExecutionRun + Result (projectExecution)
 *     → independent Verification (verificationService)
 *     → Project Memory candidate promotion (Hermes only)
 *     → schedule_executions provenance row + events
 *
 * It NEVER routes through the legacy runEngine/executeSkill path, and it does
 * not use the external hermesApiService (which lacks verification/memory).
 */
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { backgroundTaskManager } from '../backgroundTasks/manager.js';
import type { WorkerKind } from '../backgroundTasks/types.js';
import { routineRepo, type RoutineRecord, type ScheduleExecutionRecord } from '../routines/store.js';
import { projectsStore } from '../projectsStore.js';
import { getWorkspaceRoot } from '../workspaceStore.js';

export interface ScheduleFireRecord {
  id: string;
  taskId: string;
  executionType: string;
  routineId: string | null;
  worker: string | null;
  projectId: string | null;
  taskTemplate: any;
  cronExpression: string | null;
  timezone: string;
  misfirePolicy: string;
  enabled: boolean;
  createdAt?: string | null;
  lastTriggeredAt?: string | null;
}

export interface DispatchResult {
  ok: boolean;
  outcome: 'completed' | 'execution_failed' | 'dispatch_failed' | 'cancelled';
  error?: string;
  provenance: {
    scheduleId: string;
    executionId: string;
    routineId: string | null;
    projectId: string | null;
    backgroundTaskId: string | null;
    projectTaskId: string | null;
    runId: string | null;
    resultId: string | null;
    verificationId: string | null;
    triggeredAt: string;
    triggerType: 'schedule' | 'manual' | 'recovery';
  };
}

function resolveWorker(worker: string | null | undefined): WorkerKind | null {
  if (worker === 'hermes' || worker === 'codex' || worker === 'magnitude') return worker;
  return null;
}

/**
 * Dispatch a single schedule occurrence through the canonical worker path.
 */
export async function dispatchScheduledExecution(
  schedule: ScheduleFireRecord,
  triggerType: 'schedule' | 'manual' | 'recovery' = 'schedule',
  routine?: RoutineRecord | null,
): Promise<DispatchResult> {
  const executionId = `sched-exec-${randomUUID()}`;
  const triggeredAt = new Date().toISOString();

  const provenance: DispatchResult['provenance'] = {
    scheduleId: schedule.id,
    executionId,
    routineId: routine?.routineId ?? schedule.routineId ?? null,
    projectId: null,
    backgroundTaskId: null,
    projectTaskId: null,
    runId: null,
    resultId: null,
    verificationId: null,
    triggeredAt,
    triggerType,
  };

  const persist = (outcome: ScheduleExecutionRecord['outcome'], error: string | null, extra: Partial<ScheduleExecutionRecord> = {}) => {
    routineRepo.recordExecution({
      id: executionId, scheduleId: schedule.id, routineId: provenance.routineId,
      projectId: provenance.projectId, backgroundTaskId: provenance.backgroundTaskId,
      projectTaskId: provenance.projectTaskId, runId: provenance.runId,
      resultId: provenance.resultId, verificationId: provenance.verificationId,
      triggeredAt, triggerType, outcome, error,
      ...extra,
    });
  };

  const fail = (outcome: DispatchResult['outcome'], error: string): DispatchResult => {
    persist(outcome, error);
    logger.error(`[schedule-dispatch] ${outcome}`, JSON.stringify({ executionId, scheduleId: schedule.id, error }));
    return { ok: false, outcome, error, provenance };
  };

  // ── Resolve what to run ───────────────────────────────────────────────────
  const worker = routine ? (routine.worker as WorkerKind) : resolveWorker(schedule.worker);
  if (!worker || (worker !== 'hermes' && worker !== 'codex' && worker !== 'magnitude')) {
    return fail('dispatch_failed', `Schedule ${schedule.id} has no canonical worker (worker=${schedule.worker}, routine=${provenance.routineId}).`);
  }

  let projectId = routine?.projectId ?? schedule.projectId ?? null;
  if (!projectId || !projectsStore.getProject(projectId)) {
    const active = projectsStore.getActiveProjectId();
    if (active && projectsStore.getProject(active)) projectId = active;
  }
  if (!projectId) {
    return fail('dispatch_failed', `Scheduled ${worker} execution requires a valid projectId. Schedule ${schedule.id} has none.`);
  }
  provenance.projectId = projectId;

  const template = routine?.taskTemplate ?? (schedule.taskTemplate || {});
  const objective = template.objective || routine?.objective || `Scheduled ${worker} execution for schedule ${schedule.id}`;

  logger.info('[schedule-dispatch] SCHEDULE_TRIGGERED', JSON.stringify({ executionId, scheduleId: schedule.id, routineId: provenance.routineId, worker, projectId, triggerType }));

  // ── 1. Canonical Background Task (lifecycle/approval/cancel/provenance) ──
  const title = routine?.name ? `Routine: ${routine.name}` : `Scheduled ${worker} task`;
  const created = backgroundTaskManager.createTask({
    title,
    objective,
    originalRequest: objective,
    route: 'schedule',
    selectedAgent: worker,
    worker,
    projectId,
    resumable: worker === 'codex',
    workspaceRoot: getWorkspaceRoot(),
    metadata: {
      scheduleId: schedule.id,
      executionId,
      routineId: provenance.routineId,
      triggerType,
      scheduledExecution: true,
      executionType: schedule.executionType,
      taskTemplate: template,
      ...(routine ? {
        memoryPolicy: routine.memoryPolicy,
        approvalPolicy: routine.approvalPolicy,
        verificationPolicy: routine.verificationPolicy,
        retryPolicy: routine.retryPolicy,
        timeoutSeconds: routine.timeoutSeconds,
      } : {}),
    },
  });
  if (!created.task) return fail('dispatch_failed', `Background task creation failed: ${created.error}`);
  provenance.backgroundTaskId = created.task.taskId;
  persist('dispatched', null);
  logger.info('[schedule-dispatch] SCHEDULE_TASK_CREATED', JSON.stringify({ executionId, backgroundTaskId: created.task.taskId }));

  // ── 2. Drive the canonical worker chain ───────────────────────────────────
  try {
    const { projectTaskService } = await import('../projectExecution/projectTaskService.js');
    const { executionRunService } = await import('../projectExecution/executionRunService.js');

    const goal = projectTaskService.createGoal({
      projectId,
      title: title,
      objective,
      createdBy: 'schedule',
      metadata: { scheduleId: schedule.id, executionId, routineId: provenance.routineId },
    });

    const task = projectTaskService.createTask({
      projectId,
      goalId: goal.id,
      title: title,
      description: objective,
      taskType: worker === 'codex' ? 'engineering' : worker === 'magnitude' ? 'browser' : 'research',
      assignedCapability: worker,
      acceptanceCriteria: worker === 'magnitude'
        ? 'Page must be loaded and title/content extracted.'
        : `Execute the scheduled ${worker} objective and return a structured result.`,
      metadata: { scheduleId: schedule.id, executionId, routineId: provenance.routineId, triggerType },
    });
    provenance.projectTaskId = task.id;
    persist('dispatched', null);

    let runId: string | null = null;
    let resultId: string | null = null;

    if (worker === 'hermes') {
      const { executeHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
      const { run } = await executeHermesTask(task, { prompt: objective, requestId: executionId, projectId, goalId: goal.id });
      runId = run.id;
    } else if (worker === 'magnitude') {
      const { executeMagnitudeTask } = await import('../../domains/workerAdapters/magnitudeAdapter.js');
      const { run } = await executeMagnitudeTask(task, {
        goal: objective,
        requestId: executionId,
        scheduleExecutionId: executionId,
      });
      runId = run.id;
    } else {
      // codex: create goal + canonical run, start the loop, then reconcile.
      const { executeCodexTask, reconcileCodexRun } = await import('../../domains/workerAdapters/codexAdapter.js');
      const { resumeCodexGoalLoop } = await import('../../loops/codexLoop.js');
      const { goalStore } = await import('../../services/goalStore.js');
      const { run, goalId } = await executeCodexTask(task, { workspacePath: getWorkspaceRoot(), requestId: executionId });
      runId = run.id;
      // Actually start the loop (executeCodexTask only queues the goal).
      resumeCodexGoalLoop(goalId).catch((e) => logger.warn(`[schedule-dispatch] codex loop start error: ${e?.message}`));
      // Poll the goal to terminal, then reconcile the canonical run + result.
      const codexDeadline = Date.now() + (routine?.timeoutSeconds ? routine.timeoutSeconds * 1000 : 300000);
      let terminalGoal: any = null;
      while (Date.now() < codexDeadline) {
        const g = goalStore.get(goalId);
        if (g && (g.status === 'completed' || g.status === 'failed' || g.status === 'stopped')) { terminalGoal = g; break; }
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (terminalGoal) {
        await reconcileCodexRun(runId, goalId);
      }
      // Link the goal id for cancellation.
      backgroundTaskManager.registerWorkerHandlers(created.task.taskId, {
        stop: async () => {
          try { goalStore.update(goalId, { status: 'stopped' } as any); } catch (e: any) { /* non-fatal */ }
        },
      });
    }

    provenance.runId = runId;
    // Truthfully mark the background task running now that the worker is
    // executing (cancellation targets this live state, not a queued stub).
    backgroundTaskManager.transition(created.task.taskId, 'running', {
      currentStage: 'executing',
      linkedRunId: runId,
      metadata: { ...(created.task.metadata || {}), projectTaskId: task.id, executionRunId: runId },
    });
    // Register cancellation: cancelling the background task cancels the run.
    backgroundTaskManager.registerWorkerHandlers(created.task.taskId, {
      stop: async () => {
        try {
          if (worker === 'hermes') {
            const { cancelHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
            await cancelHermesTask(runId!, 'Scheduled execution cancelled');
          } else if (worker === 'magnitude') {
            const { magnitudeService } = await import('../../domains/magnitude/service.js');
            await magnitudeService.cancelRun(runId!);
          } else {
            // codex cancellation handled by the goal loop stop machinery via linked run
            const { goalStore } = await import('../../services/goalStore.js');
            const g = goalStore.get((created.task as any).linkedRunId ?? '');
            if (g) goalStore.update(g.id, { status: 'stopped' } as any);
          }
        } catch (e: any) { logger.warn(`[schedule-dispatch] cancel error: ${e?.message}`); }
      },
    });
    persist('dispatched', null);

    // ── 3. Poll the canonical execution run to terminal ─────────────────────
    const timeoutMs = (routine?.timeoutSeconds ? routine.timeoutSeconds * 1000 : 300000);
    const deadline = Date.now() + timeoutMs;
    let terminalRun: any = null;
    while (Date.now() < deadline) {
      const r = executionRunService.getRun(runId);
      if (r && (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled')) { terminalRun = r; break; }
      await new Promise((res) => setTimeout(res, 1500));
    }

    if (!terminalRun) {
      // Mark the background task failed truthfully; do not leave it running.
      backgroundTaskManager.transition(created.task.taskId, 'failed', {
        lastError: `Scheduled ${worker} execution timed out after ${Math.round(timeoutMs / 1000)}s.`,
        blocker: `Scheduled ${worker} execution timed out.`,
      });
      return fail('execution_failed', `Scheduled ${worker} execution timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }

    const finalResult = terminalRun.finalResultId ? executionRunService.getResult(terminalRun.finalResultId) : null;
    provenance.resultId = finalResult?.id ?? null;
    if (finalResult?.id) provenance.resultId = finalResult.id;

    // ── 4. Independent Verification (hermes/codex; magnitude is read-only) ──
    let verdict: string | null = null;
    if (worker !== 'magnitude' && terminalRun.status === 'completed' && finalResult) {
      const policy = routine?.verificationPolicy ?? 'required';
      if (policy !== 'none') {
        try {
          const { verificationService } = await import('../projectExecution/verificationService.js');
          const vr = await verificationService.verify({
            taskId: task.id,
            targetRunId: runId,
            projectId,
            goalId: goal.id,
            objective,
            acceptanceCriteria: task.acceptanceCriteria,
            workerResult: finalResult,
            workerRun: terminalRun,
          });
          provenance.verificationId = vr.id;
          verdict = vr.verdict;
        } catch (e: any) {
          logger.warn(`[schedule-dispatch] verification error (non-fatal): ${e?.message}`);
        }
      }
    }

    // ── 5. Hermes memory candidate promotion ────────────────────────────────
    if (worker === 'hermes' && terminalRun.status === 'completed' && finalResult && (routine?.memoryPolicy?.allowCandidatePromotion ?? true)) {
      try {
        const struct = (finalResult as any).structuredOutput as any;
        const candidates = Array.isArray(struct?.memoryCandidates) ? struct.memoryCandidates : [];
        if (candidates.length > 0) {
          const { promoteHermesCandidates } = await import('../memory/workerMemory.js');
          await promoteHermesCandidates({
            projectId,
            sourceRunId: runId,
            sourceResultId: finalResult.id,
            verificationId: provenance.verificationId,
            verificationVerdict: verdict ?? 'NOT_PROVEN',
            candidates,
            scope: `project:${projectId}`,
          });
        }
      } catch (e: any) {
        logger.warn(`[schedule-dispatch] memory promotion error (non-fatal): ${e?.message}`);
      }
    }

    // ── 6. Mirror the canonical outcome onto the background task ────────────
    const finalStatus = terminalRun.status === 'completed' ? 'completed' : terminalRun.status === 'cancelled' ? 'cancelled' : 'failed';
    backgroundTaskManager.transition(created.task.taskId, finalStatus, {
      linkedRunId: runId,
      resultText: finalResult?.summary ?? terminalRun.failureReason ?? `Scheduled ${worker} execution ${finalStatus}.`,
      verificationState: verdict === 'PASS' ? 'passed' : verdict ? 'failed' : terminalRun.status === 'completed' ? 'passed' : 'failed',
      metadata: {
        ...(created.task.metadata || {}),
        projectTaskId: task.id,
        executionRunId: runId,
        resultId: finalResult?.id ?? null,
        verificationId: provenance.verificationId,
        verdict,
      },
    });

    const outcome = finalStatus === 'completed' ? 'completed' : finalStatus === 'cancelled' ? 'cancelled' : 'execution_failed';
    const error = finalStatus === 'completed' ? null : (terminalRun.failureReason || `Worker ended ${finalStatus}`);
    persist(outcome as ScheduleExecutionRecord['outcome'], error, {
      backgroundTaskId: created.task.taskId, projectTaskId: task.id, runId,
      resultId: finalResult?.id ?? null, verificationId: provenance.verificationId,
    });
    logger.info(`[schedule-dispatch] ${finalStatus === 'completed' ? 'SCHEDULE_EXECUTION_COMPLETED' : 'SCHEDULE_EXECUTION_FAILED'}`, JSON.stringify({
      executionId, backgroundTaskId: created.task.taskId, projectTaskId: task.id, runId,
      resultId: finalResult?.id ?? null, verificationId: provenance.verificationId, verdict,
    }));

    return { ok: finalStatus === 'completed', outcome, error: error ?? undefined, provenance };
  } catch (err: any) {
    // Dispatch threw — persist failure truthfully, never swallow.
    backgroundTaskManager.transition(created.task.taskId, 'failed', { lastError: `Dispatch threw: ${err?.message}` });
    return fail('dispatch_failed', `Scheduled dispatch threw: ${err?.message}`);
  }
}

const SERVER_BOOT_TIME = Date.now();
/**
 * Jarvis Conversational Execution Supervisor (Jarvis Conversational Supervisor Milestone).
 *
 * Implements real-time conversational supervision over background tasks, Hermes runs,
 * and CodeX goals:
 *   1. Immediate acknowledgement of user requests.
 *   2. 10-state stall/heartbeat modeling with strict separation of approval vs stall.
 *   3. Real-time translation of runtime events into conversational progress messages.
 *   4. Truthful intermediate discoveries extraction and reporting.
 *   5. Final result delivery into the conversation.
 */
import { EventEmitter } from 'node:events';
import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import type { WorkerKind } from '../../services/backgroundTasks/types.js';
import { progressTranslator, type TranslationInput } from '../../services/jarvis/progressTranslator.js';
import * as executionState from '../../services/executionState.js';

export type SupervisorState =
  | 'QUEUED'
  | 'STARTING'
  | 'RUNNING_ACTIVE'
  | 'RUNNING_QUIET'
  | 'WAITING_FOR_APPROVAL'
  | 'POSSIBLE_STALL'
  | 'STALLED'
  | 'RECOVERING'
  | 'FAILED'
  | 'COMPLETED';

export interface ActiveSupervisedTask {
  taskId: string;
  operationId: string;
  conversationId: string;
  worker: WorkerKind;
  state: SupervisorState;
  startedAt: number;
  lastActivityAt: number;
  lastProgressMessageAt: number;
  quietNoticeEmitted: boolean;
  stallNoticeEmitted: boolean;
  concurrency?: { active: number; limit: number; position: number };
}

const STALL_THRESHOLD_MS = 45_000;
const QUIET_THRESHOLD_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const SEMANTIC_COOLDOWN_MS = 20_000; // Deduplicate identical progress updates within 20s

export class JarvisExecutionSupervisor extends EventEmitter {
  private activeTasks = new Map<string, ActiveSupervisedTask>(); // keyed by taskId
  private opToTaskId = new Map<string, string>(); // operationId -> taskId
  private lastSemanticEventTime = new Map<string, number>(); // `${taskId}:${eventKind}` -> timestamp
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startHeartbeat();
    this.attachEventListeners();
    this.reconcileSupervisedTasksAfterRestart();
  }

  /**
   * Start supervisor monitoring for a newly created or delegated task.
   */
  superviseTask(opts: {
    taskId: string;
    operationId: string;
    conversationId: string;
    worker: WorkerKind;
    initialState?: SupervisorState;
    concurrency?: { active: number; limit: number; position: number };
  }): void {
    const now = Date.now();
    const task: ActiveSupervisedTask = {
      taskId: opts.taskId,
      operationId: opts.operationId,
      conversationId: opts.conversationId,
      worker: opts.worker,
      state: opts.initialState || 'STARTING',
      startedAt: now,
      lastActivityAt: now,
      lastProgressMessageAt: now,
      quietNoticeEmitted: false,
      stallNoticeEmitted: false,
      concurrency: opts.concurrency,
    };

    this.activeTasks.set(opts.taskId, task);
    this.opToTaskId.set(opts.operationId, opts.taskId);

    logger.info(`[JarvisSupervisor] Supervised task registered: ${opts.taskId} (worker=${opts.worker}, op=${opts.operationId})`);
  }

  /**
   * Record real activity from a worker/task event and advance state.
   * Applies semantic deduplication to prevent chat spam from repeated micro-events.
   */
  recordActivity(taskId: string, eventKind: TranslationInput['eventKind'], metadata: Partial<TranslationInput> = {}): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) return false;

    const now = Date.now();
    task.lastActivityAt = now;
    task.stallNoticeEmitted = false;

    // Semantic deduplication / cooldown check for repeated actions
    const isDeduplicatableKind =
      eventKind === 'inspecting_files' ||
      eventKind === 'applying_changes' ||
      eventKind === 'running_tests' ||
      eventKind === 'planning' ||
      eventKind === 'tool_started';

    const dedupKey = `${taskId}:${eventKind}`;
    if (isDeduplicatableKind) {
      const lastTime = this.lastSemanticEventTime.get(dedupKey);
      if (lastTime && now - lastTime < SEMANTIC_COOLDOWN_MS) {
        // Suppress repetitive chat spam within cooldown, update runtime timestamp only
        return false;
      }
    }
    this.lastSemanticEventTime.set(dedupKey, now);

    // State progression
    if (eventKind === 'task_queued') {
      task.state = 'QUEUED';
    } else if (eventKind === 'approval_required') {
      task.state = 'WAITING_FOR_APPROVAL';
    } else if (eventKind === 'recovering') {
      task.state = 'RECOVERING';
    } else if (eventKind === 'failed') {
      task.state = 'FAILED';
    } else if (eventKind === 'completed') {
      task.state = 'COMPLETED';
    } else if (task.state === 'WAITING_FOR_APPROVAL') {
      // Stay in WAITING_FOR_APPROVAL until approval resolution/tool restart
      if (eventKind === 'tool_started' || eventKind === 'delegation_dispatched' || eventKind === 'task_started') {
        task.state = 'RUNNING_ACTIVE';
      }
    } else {
      task.state = 'RUNNING_ACTIVE';
    }

    // Translate to human-readable statement
    const text = progressTranslator.translate({
      worker: task.worker,
      eventKind,
      ...metadata,
    });

    const isSpoken = progressTranslator.isSpokenMilestone(eventKind);

    task.lastProgressMessageAt = now;

    // Update shared execution record
    executionState.update(task.operationId, {
      lastActivityAt: task.lastActivityAt,
      status: task.state === 'WAITING_FOR_APPROVAL' ? 'WAITING_FOR_APPROVAL' : task.state === 'QUEUED' ? 'QUEUED' : task.state === 'COMPLETED' ? 'COMPLETED' : task.state === 'FAILED' ? 'FAILED' : 'RUNNING',
      currentAction: task.state === 'WAITING_FOR_APPROVAL'
        ? (metadata.summary ? `Waiting for approval: ${metadata.summary}` : 'Waiting for your approval before continuing.')
        : text.slice(0, 120),
    });

    // Post to active conversation
    void this.postSupervisorMessage(task, text, eventKind, isSpoken, metadata.detail);

    // If terminal, remove from active monitoring after short delay
    if (task.state === 'COMPLETED' || task.state === 'FAILED') {
      setTimeout(() => {
        this.activeTasks.delete(taskId);
        this.opToTaskId.delete(task.operationId);
      }, 5000);
    }
    return true;
  }

  /**
   * Reconcile active background tasks on backend startup / restart.
   * Restores tracking without re-emitting duplicate initial acknowledgements.
   * Invariant: Never emit "Hermes is still working" unless an actual upstream run was verified alive.
   * Invariant: Genuinely queued tasks remain QUEUED with 0 capacity and emit NO recovery working message.
   */
  reconcileSupervisedTasksAfterRestart(): void {
    try {
      const active = backgroundTaskRepo.listTasks({ activeOnly: true });
      for (const t of active) {
        if (!this.activeTasks.has(t.taskId)) {
          const initialState: SupervisorState =
            t.status === 'waiting_approval' || t.approvalState === 'pending'
              ? 'WAITING_FOR_APPROVAL'
              : t.status === 'queued'
              ? 'QUEUED'
              : 'RUNNING_ACTIVE';

          this.superviseTask({
            taskId: t.taskId,
            operationId: (t.metadata as any)?.operationId || t.taskId,
            conversationId: t.conversationId || '',
            worker: t.worker,
            initialState,
          });

          // Invariant: Queued or waiting tasks must NEVER emit "working" messages on restart.
          // For running tasks, verify upstream liveness before posting recovery message.
          if (t.conversationId && initialState === 'RUNNING_ACTIVE') {
            void (async () => {
              try {
                let isAlive = false;
                if (t.worker === 'hermes') {
                  const runId = t.linkedRunId;
                  if (runId) {
                    const { hermesApiService } = await import('../../services/hermesApiService.js');
                    const probe = await hermesApiService.probeRunLiveness(runId);
                    if (probe.status === 'completed') {
                      this.recordActivity(t.taskId, 'completed', {
                        resultSummary: probe.output || t.resultText || undefined,
                      });
                      return;
                    }
                    if (probe.status === 'failed' || probe.status === 'cancelled') {
                      this.recordActivity(t.taskId, 'failed', {
                        failureReason: `Upstream Hermes run ${probe.status}`,
                      });
                      return;
                    }
                    isAlive = Boolean(probe.isAlive);
                  }
                } else if (t.worker === 'codex') {
                  isAlive = Boolean(t.resumable);
                }

                if (isAlive) {
                  const conv = await conversationService.getConversation(t.conversationId!).catch(() => null);
                  if (conv) {
                    const workerName = t.worker === 'hermes' ? 'Hermes' : t.worker === 'codex' ? 'CodeX' : 'The worker';
                    const recoveryMsg = `I'm back. ${workerName} is still working on the task and the execution state was recovered successfully.`;
                    const taskObj = this.activeTasks.get(t.taskId);
                    if (taskObj && taskObj.state === 'RUNNING_ACTIVE') {
                      void this.postSupervisorMessage(taskObj, recoveryMsg, 'recovering', true);
                    }
                  }
                } else if (t.worker === 'hermes') {
                  // Upstream Hermes run interrupted: transition to blocked with resumable: true, recoveryAction: 'retry'
                  backgroundTaskManager.transition(t.taskId, 'blocked', {
                    resumable: true,
                    blocker: 'Worker state was interrupted by backend restart. Resume or retry the task to continue.',
                    lastError: 'Worker state was interrupted by backend restart.',
                    metadata: { ...(t.metadata || {}), recoveryAction: 'retry' },
                  });
                  void backgroundTaskManager.pumpQueuedForWorker('hermes');
                  this.activeTasks.delete(t.taskId);
                  this.opToTaskId.delete((t.metadata as any)?.operationId || t.taskId);
                }
              } catch (err: any) {
                logger.warn(`[JarvisSupervisor] Error verifying liveness for ${t.taskId} on restart: ${err?.message}`);
              }
            })();
          }
        }
      }
    } catch (err: any) {
      logger.warn(`[JarvisSupervisor] Restart reconciliation failed (non-blocking): ${err?.message}`);
    }
  }

  /**
   * Post a supervisor progress message into the persisted conversation.
   */
  async postSupervisorMessage(
    task: ActiveSupervisedTask,
    content: string,
    eventKind: string,
    isSpoken: boolean,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      if (task.conversationId) {
        const conv = await conversationService.getConversation(task.conversationId).catch(() => null);
        if (conv) {
          await conversationService.appendMessage({
            conversationId: task.conversationId,
            role: 'system',
            messageType: (metadata.phase ? 'hermes_progress' : 'system_status') as any,
            content,
            routedAgent: 'jarvis',
            metadata: {
              operationId: task.operationId,
              taskId: task.taskId,
              worker: task.worker,
              supervisorEvent: eventKind,
              isSpokenMilestone: isSpoken,
              supervisorState: task.state,
              ...metadata,
            },
          }).catch(() => {});
        }
      }

      this.emit('progress', {
        taskId: task.taskId,
        operationId: task.operationId,
        conversationId: task.conversationId,
        worker: task.worker,
        content,
        eventKind,
        state: task.state,
        isSpoken,
      });
    } catch {
      // Best-effort supervisor telemetry
    }
  }

  /**
   * Heartbeat monitor running periodically to check for quiet tasks vs stalls.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      void this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Heartbeat check cycle.
   * Explicit rules:
   *   1. QUEUED tasks consume no slot, require no heartbeat, and must NEVER produce stall warnings.
   *   2. WAITING_FOR_APPROVAL is NEVER classified as stalled.
   *   3. Only active RUNNING tasks participate in worker liveness monitoring.
   */
  async checkHeartbeats(): Promise<void> {
    const now = Date.now();

    for (const [taskId, task] of this.activeTasks.entries()) {
      if (task.state === 'COMPLETED' || task.state === 'FAILED') continue;

      const bgTask = backgroundTaskRepo.getTask(taskId);
      if (!bgTask) continue;

      // 1. QUEUED rule: Queued tasks consume no slot, require no heartbeat, and must never stall.
      if (task.state === 'QUEUED' || bgTask.status === 'queued') {
        task.stallNoticeEmitted = false;
        continue;
      }

      // 2. Approval rule: Never stall while waiting for human decision
      if (bgTask.status === 'waiting_approval' || bgTask.approvalState === 'pending' || task.state === 'WAITING_FOR_APPROVAL') {
        task.state = 'WAITING_FOR_APPROVAL';
        task.stallNoticeEmitted = false;
        continue;
      }

      if (bgTask.status === 'completed') {
        this.recordActivity(taskId, 'completed', {
          resultSummary: bgTask.resultText || undefined,
        });
        continue;
      }

      if (bgTask.status === 'failed' || bgTask.status === 'cancelled') {
        this.recordActivity(taskId, 'failed', {
          failureReason: bgTask.lastError || bgTask.blocker || 'Task failed',
        });
        continue;
      }

      const idleMs = now - task.lastActivityAt;

      // 3. Stall Detection & Upstream Liveness Probing (>= 45s without activity)
      if (idleMs >= STALL_THRESHOLD_MS && (task.state as string) !== 'WAITING_FOR_APPROVAL' && (task.state as string) !== 'QUEUED') {
        // Probe CodeX goal liveness
        const goalId = (bgTask.linkedRunId?.startsWith('goal-') ? bgTask.linkedRunId : null) || (bgTask.metadata as any)?.codexGoalId;
        if (goalId) {
          try {
            const { goalStore } = await import('../../services/goalStore.js');
            const g = goalStore.get(goalId);
            if (g && (g.status === 'executing' || g.status === 'planning' || g.status === 'queued' || g.status === 'waiting_for_approval')) {
              task.lastActivityAt = Date.now();
              task.state = 'RUNNING_ACTIVE';
              task.stallNoticeEmitted = false;
              continue;
            }
          } catch {}
        }

        // Probe in-repo execution run liveness
        const inRepoRunId = (bgTask.linkedRunId?.startsWith('er-') ? bgTask.linkedRunId : null) || (bgTask.metadata as any)?.hermesPlanRunId;
        if (inRepoRunId) {
          try {
            const { executionRunService } = await import('../../services/projectExecution/executionRunService.js');
            const r = executionRunService.getRun(inRepoRunId);
            const st = String(r?.status || '');
            if (r && (st === 'planning' || st === 'executing' || st === 'running' || st === 'in_progress' || st === 'queued')) {
              task.lastActivityAt = Date.now();
              task.state = 'RUNNING_ACTIVE';
              task.stallNoticeEmitted = false;
              continue;
            }
          } catch {}
        }

        // Probe upstream Hermes worker liveness before classifying as stall
        if (task.worker === 'hermes') {
          const runIdToProbe = bgTask.linkedRunId || (task as any).linkedRunId;
          if (runIdToProbe && !runIdToProbe.startsWith('er-') && !runIdToProbe.startsWith('goal-')) {
            try {
              const { hermesApiService } = await import('../../services/hermesApiService.js');
              const probe = await hermesApiService.probeRunLiveness(runIdToProbe);
              if (probe.status === 'completed') {
                this.recordActivity(taskId, 'completed', {
                  resultSummary: probe.output || bgTask.resultText || undefined,
                });
                continue;
              }
              if (probe.status === 'failed' || probe.status === 'cancelled') {
                this.recordActivity(taskId, 'failed', {
                  failureReason: `Upstream Hermes run ${probe.status}`,
                });
                continue;
              }
              if (probe.isAlive) {
                // The worker is actively running upstream (e.g. LLM inference / tool execution).
                // Refresh activity timestamp and avoid false stall alert.
                task.lastActivityAt = Date.now();
                task.state = 'RUNNING_ACTIVE';
                task.stallNoticeEmitted = false;
                executionState.update(task.operationId, {
                  lastActivityAt: task.lastActivityAt,
                  status: 'RUNNING',
                  currentAction: probe.lastEvent ? `Hermes: ${probe.lastEvent}` : 'Hermes is generating response…',
                });
                continue;
              }
            } catch { /* probe error */ }
          }
        }

        // 3b. Confirmed Dead / Hard Stall (>= 90s idle or confirmed dead upstream)
        if (idleMs >= 90_000 && (task.state as string) !== 'WAITING_FOR_APPROVAL' && (task.state as string) !== 'QUEUED') {
          task.state = 'FAILED';
          const idleSeconds = Math.round(idleMs / 1000);
          logger.warn(`[JarvisSupervisor] Confirmed stall for ${taskId} (${idleSeconds}s idle) — reconciling and releasing slot`);
          backgroundTaskManager.transition(taskId, 'failed', {
            blocker: `Worker confirmed stalled after ${idleSeconds}s without activity.`,
            lastError: `Worker stall (${idleSeconds}s idle)`,
          });
          void backgroundTaskManager.pumpQueuedForWorker(task.worker);
          const stallFailMsg = `The previous ${task.worker} run was confirmed stalled and its slot was released. Any queued tasks will now dispatch.`;
          void this.postSupervisorMessage(task, stallFailMsg, 'failed', true, { idleSeconds });
          this.activeTasks.delete(taskId);
          this.opToTaskId.delete(task.operationId);
          continue;
        }

        if (!task.stallNoticeEmitted) {
          task.state = 'POSSIBLE_STALL';
          task.stallNoticeEmitted = true;
          const idleSeconds = Math.round(idleMs / 1000);
          const stallText = progressTranslator.translate({
            worker: task.worker,
            eventKind: 'possible_stall',
            idleSeconds,
          });
          logger.warn(`[JarvisSupervisor] Possible stall detected for ${taskId} (${idleSeconds}s idle)`);
          void this.postSupervisorMessage(task, stallText, 'possible_stall', true, { idleSeconds });
        }
        continue;
      }

      // 4. Quiet Running State (10s to 44s idle)
      if (idleMs >= QUIET_THRESHOLD_MS && idleMs < STALL_THRESHOLD_MS) {
        if (task.state === 'RUNNING_ACTIVE') {
          task.state = 'RUNNING_QUIET';
        }
      }
    }
  }

  /**
   * Surface an intermediate finding from a worker (Hermes / CodeX).
   */
  surfaceIntermediateFinding(taskId: string, findingText: string, metadata: Record<string, unknown> = {}): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;
    this.recordActivity(taskId, 'intermediate_finding', {
      summary: findingText,
      detail: metadata,
    });
  }

  /**
   * Connect supervisor to runtime event emitters across BackgroundTasks and Jarvis.
   */
  private attachEventListeners(): void {
    backgroundTaskManager.on('event', (e: { taskId: string; event: string; message?: string; detail?: any }) => {
      const task = this.activeTasks.get(e.taskId);
      if (!task) return;

      if (e.event === 'task.file_changed') {
        const files = Array.isArray(e.detail?.files) ? e.detail.files : [];
        this.recordActivity(e.taskId, 'applying_changes', { files });
      } else if (e.event === 'task.verification_started') {
        this.recordActivity(e.taskId, 'verification_started');
      } else if (e.event === 'task.verification_completed') {
        if (e.detail?.allRequiredPassed !== false) {
          this.recordActivity(e.taskId, 'verification_passed');
        } else {
          this.recordActivity(e.taskId, 'verification_failed', { failureReason: e.detail?.reason });
        }
      } else if (e.event === 'task.approval_requested') {
        this.recordActivity(e.taskId, 'approval_required', { summary: e.message });
      } else if (e.event === 'task.blocked') {
        this.recordActivity(e.taskId, 'failed', { failureReason: e.message });
      }
    });

    try {
      import('../hermes/progressEvents.js').then(({ hermesProgressBus }) => {
        hermesProgressBus.on('progress', (ev) => {
          const task = ev.taskId ? this.activeTasks.get(ev.taskId) : null;
          if (task) {
            void this.postSupervisorMessage(task, ev.message, ev.type, false, {
              phase: ev.phase,
              worker: ev.worker || 'hermes',
              taskId: ev.taskId,
              missionId: ev.missionId,
              eventType: ev.type,
              evidenceSummary: ev.evidenceSummary,
            });
          }
        });
      }).catch(() => {});
    } catch {}
  }

  /**
   * Get active state for a task.
   */
  getSupervisedTask(taskId: string): ActiveSupervisedTask | undefined {
    return this.activeTasks.get(taskId);
  }

  /**
   * Clean up resources on shutdown.
   */
  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.activeTasks.clear();
    this.opToTaskId.clear();
    this.lastSemanticEventTime.clear();
    this.removeAllListeners();
  }
}

export const jarvisExecutionSupervisor = new JarvisExecutionSupervisor();


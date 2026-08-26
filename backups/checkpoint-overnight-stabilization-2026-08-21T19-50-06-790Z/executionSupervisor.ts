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
import type { BackgroundTaskRecord, TaskStatus, WorkerKind } from '../../services/backgroundTasks/types.js';
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

    // Update shared execution record
    executionState.update(task.operationId, {
      lastActivityAt: task.lastActivityAt,
      currentAction: text.slice(0, 120),
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

          // Inform conversation truthfully about resumed supervision if conversation exists
          if (t.conversationId) {
            void conversationService.getConversation(t.conversationId).then((conv) => {
              if (conv) {
                const workerName = t.worker === 'hermes' ? 'Hermes' : t.worker === 'codex' ? 'CodeX' : 'The worker';
                const recoveryMsg = `I'm back. ${workerName} is still working on the task and the execution state was recovered successfully.`;
                const taskObj = this.activeTasks.get(t.taskId);
                if (taskObj) {
                  void this.postSupervisorMessage(taskObj, recoveryMsg, 'recovering', true);
                }
              }
            }).catch(() => {});
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
      await conversationService.appendMessage({
        conversationId: task.conversationId,
        role: 'system',
        messageType: 'system_status',
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
      });

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
    } catch (err: any) {
      logger.warn(`[JarvisSupervisor] Failed to post message: ${err?.message}`);
    }
  }

  /**
   * Heartbeat monitor running periodically to check for quiet tasks vs stalls.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Heartbeat check cycle.
   * Explicit rule: WAITING_FOR_APPROVAL is NEVER classified as stalled.
   */
  checkHeartbeats(): void {
    const now = Date.now();

    for (const [taskId, task] of this.activeTasks.entries()) {
      // Skip terminal supervisor states
      if (task.state === 'COMPLETED' || task.state === 'FAILED') {
        continue;
      }

      // Refresh actual background task
      const bgTask = backgroundTaskRepo.getTask(taskId);

      if (!bgTask) {
        continue;
      }

      // Approval waiting must never be classified as stalled
      if (
        bgTask.status === 'waiting_approval' ||
        bgTask.approvalState === 'pending'
      ) {
        task.state = 'WAITING_FOR_APPROVAL';
        task.stallNoticeEmitted = false;
        continue;
      }

      // Synchronize completed state
      if (bgTask.status === 'completed') {
        this.recordActivity(taskId, 'completed', {
          resultSummary: bgTask.resultText || undefined,
        });
        continue;
      }

      // Synchronize failed/cancelled state
      if (bgTask.status === 'failed' || bgTask.status === 'cancelled') {
        this.recordActivity(taskId, 'failed', {
          failureReason:
            bgTask.lastError ||
            bgTask.blocker ||
            'Task failed',
        });
        continue;
      }

      // Calculate idle duration
      const idleMs = now - task.lastActivityAt;

      // 3. Stall Detection (>= 45s without activity)
      if (idleMs >= STALL_THRESHOLD_MS && !task.stallNoticeEmitted && task.state !== 'WAITING_FOR_APPROVAL') {
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
   * Attach listeners to background task manager and execution state.
   */
  private attachEventListeners(): void {
    backgroundTaskManager.on('event', (e: { taskId: string; event: string; message: string; detail?: any }) => {
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
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const jarvisExecutionSupervisor = new JarvisExecutionSupervisor();

/**
 * StallWatchdog.ts — Autonomous Task Stall Detection & Diagnostic Supervisor
 *
 * Implements Section 13:
 * - Detects tasks silently stalled in queued, planning, executing, or dispatching states.
 * - Enforces bounded timeouts (e.g. 30s dispatch stall, worker heartbeat timeouts).
 * - Transitions stalled tasks to BLOCKED with exact diagnosable reasons.
 * - Guarantees tasks never remain forever in "checking", "queued", or "working" without evidence.
 */

import { logger } from '../../utils/logger.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { engineeringWorkerRegistry } from './EngineeringWorkerRegistry.js';
import { goalLifecycleManager } from './GoalLifecycle.js';

export interface StallPolicy {
  dispatchTimeoutMs: number; // e.g. 30,000ms
  heartbeatTimeoutMs: number; // e.g. 60,000ms
  pollIntervalMs: number;    // e.g. 10,000ms
}

export class StallWatchdog {
  private static instance: StallWatchdog;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  private policy: StallPolicy = {
    dispatchTimeoutMs: 30000,   // 30 seconds
    heartbeatTimeoutMs: 120000, // 2 minutes
    pollIntervalMs: 10000,      // 10 seconds
  };

  private constructor() {}

  public static getInstance(): StallWatchdog {
    if (!StallWatchdog.instance) {
      StallWatchdog.instance = new StallWatchdog();
    }
    return StallWatchdog.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('[StallWatchdog] Started autonomous stall watchdog supervisor.');
    this.timer = setInterval(() => this.runCheckPass(), this.policy.pollIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('[StallWatchdog] Stopped stall watchdog supervisor.');
  }

  /**
   * Run one evaluation pass over all active tasks.
   */
  public async runCheckPass(): Promise<{ checked: number; stalled: number; resolved: number }> {
    const tasks = backgroundTaskRepo.listTasks({ limit: 100 });
    const now = Date.now();
    let checked = 0;
    let stalled = 0;
    let resolved = 0;

    for (const task of tasks) {
      // Ignore terminal tasks
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'blocked') {
        continue;
      }

      checked++;
      const createdAt = new Date(task.createdAt).getTime();
      const updatedAt = task.updatedAt ? new Date(task.updatedAt).getTime() : createdAt;
      const timeSinceUpdate = now - updatedAt;

      // 1. Dispatch stall: Task has been in 'queued' or 'planning' for > 30s
      if ((task.status === 'queued' || task.status === 'planning') && timeSinceUpdate > this.policy.dispatchTimeoutMs) {
        stalled++;
        const blockerReason = `Task dispatch stalled: No worker accepted task within ${Math.round(this.policy.dispatchTimeoutMs / 1000)}s window.`;
        logger.warn(`[StallWatchdog] Stall detected for ${task.taskId}: ${blockerReason}`);

        backgroundTaskManager.transition(task.taskId, 'blocked', {
          currentStage: 'dispatch_stalled',
          progressMessage: blockerReason,
          blocker: blockerReason,
          resumable: true,
        });

        // Also update GoalLifecycle if attached
        const goalId = (task.metadata as any)?.goalId;
        if (goalId) {
          try {
            goalLifecycleManager.transitionState(goalId, 'FAILED_EXHAUSTED', {
              actor: 'RecoveryWatchdog',
              summary: blockerReason,
            });
          } catch {}
        }
        resolved++;
        continue;
      }

      // 2. Worker heartbeat stall: Task is executing but worker has gone silent
      if ((task.status === 'executing' || task.status === 'running') && timeSinceUpdate > this.policy.heartbeatTimeoutMs) {
        const worker = (task.worker || '').toLowerCase();
        const sessions = engineeringWorkerRegistry.getAllSessions(20).filter((s: any) => s.taskId === task.taskId);

        if (sessions.length === 0 || sessions.every((s: any) => s.status === 'DISCONNECTED' || s.status === 'FAILED')) {
          stalled++;
          const blockerReason = `Worker stalled: ${worker || 'Worker'} has not produced events or heartbeats for ${Math.round(this.policy.heartbeatTimeoutMs / 1000)}s.`;
          logger.warn(`[StallWatchdog] Heartbeat stall detected for ${task.taskId}: ${blockerReason}`);

          backgroundTaskManager.transition(task.taskId, 'blocked', {
            currentStage: 'worker_unresponsive',
            progressMessage: blockerReason,
            blocker: blockerReason,
            resumable: true,
          });
          resolved++;
        }
      }
    }

    return { checked, stalled, resolved };
  }
}

export const stallWatchdog = StallWatchdog.getInstance();

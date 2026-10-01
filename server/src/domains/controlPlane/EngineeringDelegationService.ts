/**
 * EngineeringDelegationService.ts — Authoritative Single Control Layer
 *
 * Direct Convergence Layer:
 *   User voice/text → Jarvis → EngineeringDelegationService → AntiGravity / Codex / Hermes
 *   Manual fallback:
 *   Engineering Workspace Composer → EngineeringDelegationService → AntiGravity / Codex / Hermes
 *
 * Guarantees:
 * 1. Single authoritative service for all engineering worker delegation (Jarvis and UI).
 * 2. Strict task continuation on the SAME task ID (never creates orphan duplicate tasks).
 * 3. Verified worker acceptance and real-time execution event correlation.
 * 4. Resumption and cancellation controls wired directly to the underlying worker orchestrator.
 */

import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { engineeringWorkerRegistry } from './EngineeringWorkerRegistry.js';
import {
  continueAntigravityTask,
  resumeStalledAntigravityTask,
  clearAntigravityDispatchGuard,
  releaseAntigravityWorkerSlot,
} from '../../services/backgroundTasks/antigravityAdapter.js';
import { logger } from '../../utils/logger.js';

import { DelegationEnvelope } from '../../services/backgroundTasks/types.js';

export interface DelegateEngineeringTaskInput {
  objective: string;
  context?: string;
  worker?: 'antigravity' | 'codex' | 'hermes' | string;
  workspacePath?: string;
  conversationId?: string;
  goalId?: string;
  envelope?: Partial<DelegationEnvelope>;
  delegatedBy?: string;
}

export interface DelegateEngineeringTaskOutput {
  success: boolean;
  taskId: string;
  goalId?: string;
  worker: string;
  status: string;
  accepted: boolean;
  runId?: string;
  hasWorkerAccepted: boolean;
  objective: string;
  context?: string;
  message: string;
  conversationId?: string;
  workspace: string;
}

export interface ContinueEngineeringTaskInput {
  taskId: string;
  instruction?: string;
  context?: string;
  workspacePath?: string;
}

export interface ContinueEngineeringTaskOutput {
  success: boolean;
  taskId: string;
  worker: string;
  status: string;
  message: string;
  continued: boolean;
  conversationId?: string;
}

export class EngineeringDelegationService {
  /**
   * Authoritative delegate method used by both Jarvis voice/text and the manual UI composer.
   */
  public async delegateTask(input: DelegateEngineeringTaskInput): Promise<DelegateEngineeringTaskOutput> {
    const { objective, context, conversationId, workspacePath, envelope, goalId, delegatedBy } = input;
    if (!objective || typeof objective !== 'string' || !objective.trim()) {
      throw new Error('delegateTask requires a non-empty "objective" parameter.');
    }

    const requestedWorker = (input.worker || 'antigravity').toLowerCase();
    const effectiveWorkspace = workspacePath || (await getWorkspaceRoot()) || 'D:\\AgenticOS';
    const fullObjective = context ? `${objective.trim()}\n\nRelevant Context:\n${context.trim()}` : objective.trim();
    const title = objective.length > 64 ? `${objective.slice(0, 61)}…` : objective;

    const delegationEnvelope: DelegationEnvelope = {
      pendingActionId: envelope?.pendingActionId,
      target: envelope?.target,
      objective: envelope?.objective || objective,
      acceptanceCriteria: envelope?.acceptanceCriteria,
      constraints: envelope?.constraints,
      relevantInstruction: envelope?.relevantInstruction || context,
      relatedTaskIds: envelope?.relatedTaskIds,
      relatedResultIds: envelope?.relatedResultIds,
      parentGoal: envelope?.parentGoal || goalId,
      worker: requestedWorker as any,
    };

    const selectedAgentName = requestedWorker === 'antigravity'
      ? 'AntiGravity'
      : (requestedWorker === 'codex' ? 'CodeX' : 'Hermes');

    const { task, error } = backgroundTaskManager.createTask({
      title,
      objective: fullObjective,
      originalRequest: objective,
      route: 'engineering',
      selectedAgent: selectedAgentName,
      worker: requestedWorker as any,
      conversationId: conversationId || null,
      resumable: true,
      workspaceRoot: effectiveWorkspace,
      metadata: {
        goalId: goalId || envelope?.parentGoal || null,
        delegatedBy: delegatedBy || 'EngineeringDelegationService',
        context: context || null,
        delegationEnvelope,
      },
    });

    if (!task || error) {
      throw new Error(error || 'Failed to create background engineering task.');
    }

    // Authoritative dispatch
    const { dispatchTask } = await import('../../services/backgroundTasks/adapters.js');
    try {
      await dispatchTask(task, effectiveWorkspace);
    } catch (err: any) {
      logger.error(`[EngineeringDelegationService] dispatch error for ${task.taskId}: ${err?.message}`);
    }

    // Verify worker acceptance
    const updatedTask = backgroundTaskRepo.getTask(task.taskId);
    const workerEvents = engineeringWorkerRegistry.getWorkerEvents(requestedWorker).filter(e => e.taskId === task.taskId);
    const convId = updatedTask?.linkedRunId;
    const hasWorkerAccepted = workerEvents.some(e => e.eventType === 'WORKER_ACCEPTED');
    const isAccepted = Boolean(updatedTask && (updatedTask.status === 'executing' || updatedTask.status === 'worker_accepted' || updatedTask.status === 'completed'));
    const verifiedDelegation = Boolean(task?.taskId && convId && hasWorkerAccepted && isAccepted);

    if (verifiedDelegation) {
      const firstEvent = workerEvents[0]?.eventType || 'WORKER_ACCEPTED';
      return {
        success: true,
        taskId: task.taskId,
        goalId: goalId || (task.metadata as any)?.goalId,
        worker: requestedWorker,
        status: 'running',
        accepted: true,
        runId: convId || undefined,
        conversationId: convId || undefined,
        hasWorkerAccepted: true,
        objective,
        context,
        workspace: effectiveWorkspace,
        message: `${selectedAgentName} accepted task ${task.taskId} (session ${convId}) and started execution in ${effectiveWorkspace}. Initial event: ${firstEvent}.`,
      };
    }

    return {
      success: true,
      taskId: task.taskId,
      goalId: goalId || (task.metadata as any)?.goalId,
      worker: requestedWorker,
      status: updatedTask?.status === 'blocked' ? 'blocked' : 'pending',
      accepted: isAccepted,
      runId: convId || undefined,
      conversationId: convId || undefined,
      hasWorkerAccepted,
      objective,
      context,
      workspace: effectiveWorkspace,
      message: `${selectedAgentName} task ${task.taskId} dispatched: ${updatedTask?.blocker || (hasWorkerAccepted ? 'Session active' : 'Waiting for worker acceptance')}.`,
    };
  }

  /**
   * Continues the selected existing task. NEVER creates a new task ID.
   */
  public async continueTask(input: ContinueEngineeringTaskInput): Promise<ContinueEngineeringTaskOutput> {
    const { taskId, instruction } = input;
    if (!taskId) {
      throw new Error('continueTask requires a valid "taskId".');
    }

    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in durable task store.`);
    }

    const worker = (task.worker || 'antigravity').toLowerCase();
    const cleanInstruction = instruction?.trim() || 'Continue current task';

    logger.info(`[EngineeringDelegationService] Continuing existing task ${taskId} (worker=${worker}) without creating a new task.`);

    if (worker === 'antigravity') {
      const result = await continueAntigravityTask(taskId, cleanInstruction);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to continue AntiGravity task.');
      }
      return {
        success: true,
        taskId: task.taskId,
        worker,
        status: 'executing',
        continued: true,
        conversationId: result.conversationId,
        message: `Task ${task.taskId} resumed and continued in AntiGravity session ${result.conversationId}.`,
      };
    }

    // For other workers (CodeX / Hermes)
    const updatedObjective = `${task.objective || task.originalRequest}\n\n[Continuation Instruction]:\n${cleanInstruction}`;
    backgroundTaskRepo.updateTask(task.taskId, {
      objective: updatedObjective,
      status: 'executing',
      currentStage: 'executing',
      progressMessage: `Continuing task ${task.taskId}: ${cleanInstruction}`,
      blocker: null,
      metadata: {
        ...(task.metadata || {}),
        continuedAt: new Date().toISOString(),
        continuationInstruction: cleanInstruction,
      },
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task.taskId,
      goalId: (task.metadata as any)?.goalId,
      workerId: worker,
      eventType: 'WORKER_ACCEPTED',
      metadata: { action: 'CONTINUE_TASK', instruction: cleanInstruction, message: `Continuing task ${task.taskId}: ${cleanInstruction}` },
    });

    const { dispatchTask, clearDispatchGuard } = await import('../../services/backgroundTasks/adapters.js');
    clearDispatchGuard(task.taskId);
    await dispatchTask(backgroundTaskRepo.getTask(task.taskId)!, task.workspaceRoot || 'D:\\AgenticOS');

    return {
      success: true,
      taskId: task.taskId,
      worker,
      status: 'executing',
      continued: true,
      message: `Task ${task.taskId} continued with worker ${worker}.`,
    };
  }

  /**
   * Resumes a paused, stalled, or disconnected task on the exact same task ID.
   */
  public async resumeTask(taskId: string): Promise<{ success: boolean; taskId: string; message: string }> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    const worker = (task.worker || 'antigravity').toLowerCase();
    if (worker === 'antigravity') {
      const res = await resumeStalledAntigravityTask(taskId);
      if (!res.ok) {
        throw new Error(res.error || 'Failed to resume AntiGravity task.');
      }
      return {
        success: true,
        taskId,
        message: `AntiGravity task ${taskId} resumed in session ${res.conversationId}.`,
      };
    }

    const res = await backgroundTaskManager.resumeTask(taskId);
    if (!res.ok) {
      throw new Error(res.error || 'Failed to resume task.');
    }
    return {
      success: true,
      taskId,
      message: `Task ${taskId} resumed.`,
    };
  }

  /**
   * Cancels the active task cleanly.
   */
  public async cancelTask(taskId: string, reason?: string): Promise<{ success: boolean; taskId: string; message: string }> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    const worker = (task.worker || 'antigravity').toLowerCase();
    if (worker === 'antigravity') {
      releaseAntigravityWorkerSlot(taskId);
      clearAntigravityDispatchGuard(taskId);
      engineeringWorkerRegistry.recordWorkerEvent({
        taskId,
        workerId: 'antigravity',
        eventType: 'COMMAND_FAILED',
        metadata: { message: `Task ${taskId} cancelled by user: ${reason || 'User cancelled'}` },
      });
      engineeringWorkerRegistry.updateWorkerStatus('antigravity', 'ONLINE');
    }

    const res = backgroundTaskManager.cancelTask(taskId, reason || 'Cancelled from Engineering Workspace');
    if (!res.ok) {
      throw new Error(res.error || 'Failed to cancel task.');
    }

    return {
      success: true,
      taskId,
      message: `Task ${taskId} cancelled successfully.`,
    };
  }
}

export const engineeringDelegationService = new EngineeringDelegationService();

/**
 * actions.ts — Action Contract & Delegation Execution for Jarvis V2.
 *
 * Implements strict lifecycle states:
 * proposed -> awaiting_confirmation -> approved -> queued -> executing -> completed / failed / blocked / cancelled.
 *
 * Rules:
 * 1. Confirmations bind strictly to pendingAction.id.
 * 2. Unconfirmed actions never execute.
 * 3. Execution delegates through the durable backgroundTaskManager.
 * 4. Verifies worker health before creating tasks — never fabricates tasks on unhealthy workers.
 */

import { randomUUID } from 'node:crypto';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { dispatchTask } from '../../services/backgroundTasks/adapters.js';
import type { WorkerKind } from '../../services/backgroundTasks/types.js';
import type { JarvisV2Action, JarvisV2State, ActionStatus } from './state.js';
import { getCapability, checkHermesHealth, checkCodexHealth } from './capabilities.js';
import { logger } from '../../utils/logger.js';

export interface CreateActionOptions {
  type: string; // e.g. 'hermes.delegate', 'codex.delegate'
  objective: string;
  executor: string;
  target?: { id: string; name: string; type: string; domain: string };
  constraints?: string[];
  requiresConfirmation?: boolean;
}

/**
 * Creates a pending action requiring confirmation.
 */
export function createPendingAction(
  state: JarvisV2State,
  options: CreateActionOptions
): JarvisV2Action {
  const cap = getCapability(options.type);
  const requiresConfirmation = options.requiresConfirmation ?? (cap ? cap.requiresApproval : true);

  const target = options.target || state.activeEntity || {
    id: 'unknown',
    name: 'General',
    type: 'general',
    domain: 'general'
  };

  const action: JarvisV2Action = {
    id: `v2act-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 6)}`,
    conversationId: state.conversationId,
    type: options.type,
    target,
    objective: options.objective,
    executor: options.executor,
    constraints: options.constraints || (state.constraints.length > 0 ? [...state.constraints] : undefined),
    status: 'awaiting_confirmation',
    requiresConfirmation,
    createdAt: new Date().toISOString()
  };

  state.pendingAction = action;
  return action;
}

export interface ExecuteActionResult {
  ok: boolean;
  action: JarvisV2Action;
  taskId?: string;
  error?: string;
}

/**
 * Executes an approved action by delegating to backgroundTaskManager.
 * Enforces worker health gating.
 */
export async function executeApprovedAction(
  state: JarvisV2State,
  actionId?: string
): Promise<ExecuteActionResult> {
  const action = state.pendingAction;
  if (!action) {
    return {
      ok: false,
      action: null as any,
      error: 'No pending action found to execute.'
    };
  }

  if (actionId && action.id !== actionId) {
    return {
      ok: false,
      action,
      error: `Action ID mismatch: requested ${actionId}, active is ${action.id}.`
    };
  }

  if (action.status !== 'awaiting_confirmation' && action.status !== 'proposed') {
    return {
      ok: false,
      action,
      error: `Action ${action.id} is not in a confirmable state (current: ${action.status}).`
    };
  }

  const worker = (action.executor || 'hermes') as WorkerKind;

  // Live worker health check before creating task
  if (worker === 'hermes') {
    const health = await checkHermesHealth();
    if (!health.healthy) {
      action.status = 'failed';
      return {
        ok: false,
        action,
        error: `Hermes is currently unavailable (${health.detail || 'health probe failed'}). Cannot execute delegation.`
      };
    }
  } else if (worker === 'codex') {
    const health = await checkCodexHealth();
    if (!health.healthy) {
      action.status = 'failed';
      return {
        ok: false,
        action,
        error: `CodeX is currently unavailable (${health.detail || 'health probe failed'}). Cannot execute delegation.`
      };
    }
  }

  // Mark approved & queued
  action.status = 'queued';

  try {
    const workerTitle = action.executor === 'hermes' ? 'Hermes' : action.executor === 'codex' ? 'CodeX' : action.executor;
    const title = `${workerTitle}: ${action.target.name}`;

    // Objective includes explicit constraints
    let fullObjective = action.objective;
    if (action.constraints && action.constraints.length > 0) {
      fullObjective += `\n\nOperational Constraints:\n` + action.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n');
    }

    const { task, error } = backgroundTaskManager.createTask({
      title,
      objective: fullObjective,
      originalRequest: action.objective,
      route: worker,
      selectedAgent: worker,
      worker,
      priority: 'high',
      projectId: state.activeProject?.id || (action.target.id.startsWith('proj-') ? action.target.id : null),
      conversationId: state.conversationId,
      metadata: {
        v2ActionId: action.id,
        entityId: action.target.id,
        entityName: action.target.name,
        constraints: action.constraints,
      }
    });

    if (error || !task) {
      action.status = 'failed';
      return {
        ok: false,
        action,
        error: error || 'Failed to create background task record.'
      };
    }

    // Update state with task reference
    action.status = 'executing';
    action.delegatedTaskId = task.taskId;

    state.currentTask = {
      taskId: task.taskId,
      title: task.title,
      worker: task.worker,
      status: task.status
    };

    // Dispatch asynchronously (do not let worker execution block this turn)
    dispatchTask(task).catch(dispatchErr => {
      logger.error(`[JarvisV2] Background task dispatch failed for ${task.taskId}:`, dispatchErr);
    });

    return {
      ok: true,
      action,
      taskId: task.taskId
    };
  } catch (err: any) {
    action.status = 'failed';
    return {
      ok: false,
      action,
      error: err?.message || 'Execution failed'
    };
  }
}

/**
 * Cancels a pending action.
 */
export function cancelPendingAction(state: JarvisV2State): JarvisV2Action | null {
  const action = state.pendingAction;
  if (!action) return null;

  action.status = 'cancelled';
  state.pendingAction = null;
  return action;
}

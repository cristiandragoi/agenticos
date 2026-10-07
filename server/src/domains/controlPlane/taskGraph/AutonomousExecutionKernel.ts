/**
 * taskGraph/AutonomousExecutionKernel.ts — Central Bridge for Autonomous Goal Execution
 *
 * Implements Section K, J, L:
 * - Jarvis remains the executive owner: owns user goal, task ID, permissions, context, final result.
 * - Wraps GoalLifecycleManager, AutonomousPlanner, and TaskGraphExecutor into a single coherent engine.
 * - Emits meaningful milestone progress to the user so Jarvis does not appear silent/dead.
 * - Keeps handler success separate from independently verified outcomes.
 */

import { logger } from '../../../utils/logger.js';
import { goalLifecycleManager } from '../GoalLifecycle.js';
import type { GoalRun } from '../types.js';
import type { GoalIntent } from '../StructuredIntent.js';
import { autonomousPlanner } from './AutonomousPlanner.js';
import { taskGraphExecutor } from './TaskGraphExecutor.js';
import type { TaskGraph, TaskProgressEvent } from './types.js';
import type { ArtifactRef } from '../artifacts/types.js';
import { existingAdapterCandidate, recoverGoalStep } from './GoalRecovery.js';

export interface AutonomousKernelExecutionOptions {
  conversationId: string;
  turnId?: number | string;
  signal?: AbortSignal;
  onUserMilestone?: (milestoneText: string) => void;
  onProgress?: (event: TaskProgressEvent) => void;
}

export interface AutonomousKernelResult {
  readonly success: boolean;
  readonly goalRun: GoalRun;
  readonly taskGraph: TaskGraph;
  readonly finalArtifact?: ArtifactRef;
  readonly outputText: string;
  readonly error?: string;
}

export class AutonomousExecutionKernel {
  private static instance: AutonomousExecutionKernel;

  private constructor() {}

  public static getInstance(): AutonomousExecutionKernel {
    if (!AutonomousExecutionKernel.instance) {
      AutonomousExecutionKernel.instance = new AutonomousExecutionKernel();
    }
    return AutonomousExecutionKernel.instance;
  }

  /**
   * Main entry point to execute an autonomous goal.
   */
  public async executeGoal(
    goalIntent: GoalIntent,
    options: AutonomousKernelExecutionOptions
  ): Promise<AutonomousKernelResult> {
    const rawGoal = goalIntent.userGoal;
    logger.info(`[AutonomousExecutionKernel] Beginning execution of autonomous goal: "${rawGoal}"`);

    // 1. Initialize durable GoalRun in GoalLifecycleManager (reusing existing infrastructure)
    const goalRun = goalLifecycleManager.startGoal({
      conversationId: options.conversationId,
      turnId: options.turnId !== undefined ? String(options.turnId) : undefined,
      userInput: rawGoal,
      normalizedGoal: rawGoal,
    });
    let lastMilestoneAt = Date.now();
    const heartbeat = setInterval(() => {
      if (options.signal?.aborted || Date.now() - lastMilestoneAt < 20_000 ||
          ['COMPLETED','SUCCEEDED','CANCELLED','FAILED_EXHAUSTED','BLOCKED_EXTERNAL'].includes(goalRun.status)) return;
      lastMilestoneAt = Date.now();
      // A liveness update is not evidence of successful work. Speech cannot
      // block execution, and cancelled/completed goals never send this update.
      try { void Promise.resolve(options.onUserMilestone?.('Your task is still active. I do not have a verified final result yet.')).catch(() => {}); } catch {}
    }, 20_000);
    heartbeat.unref();

    try {
      // 2. Transition to PLANNING
      goalLifecycleManager.transitionState(goalRun.goalId, 'PLANNING', {
        actor: 'Jarvis',
        summary: `Decomposing autonomous goal: "${rawGoal}"`,
      });

      // 3. Decompose goal into TaskGraph
      const taskGraph = autonomousPlanner.planGoal(goalIntent, goalRun.goalId, options.conversationId);

      goalLifecycleManager.setPlan(goalRun.goalId, {
        goalId: goalRun.goalId,
        summary: `TaskGraph (${taskGraph.nodes.size} nodes)`,
        selectedSurface: 'autonomous_task_graph',
        confidence: goalIntent.confidence || 0.95,
        steps: Array.from(taskGraph.nodes.values()).map((n, idx) => ({
          stepIndex: idx + 1,
          description: `${n.operation} (${n.capability})`,
          capability: n.capability,
          target: n.id,
          status: 'pending',
        })),
      });

      // 4. Transition to EXECUTING
      goalLifecycleManager.transitionState(goalRun.goalId, 'EXECUTING', {
        actor: 'Jarvis',
        summary: `Executing task graph with ${taskGraph.nodes.size} nodes`,
      });

      // 5. Execute TaskGraph
      const executionOptions = {
        signal: options.signal,
        conversationId: options.conversationId,
        onProgress: (ev: TaskProgressEvent) => {
          try { options.onProgress?.(ev); } catch { /* An observer cannot cancel a goal. */ }
          if (ev.phase === 'MILESTONE' && ev.userFacingMessage) {
            lastMilestoneAt = Date.now();
            try { options.onUserMilestone?.(ev.userFacingMessage); } catch { /* Speech is non-authoritative. */ }
          }
        },
      };
      let execResult = await taskGraphExecutor.executeGraph(taskGraph, executionOptions);
      const failed = [...taskGraph.nodes.values()].find(n => n.status === 'FAILED');
      // Only an explicitly unsupported operation proves a missing workflow. A failed
      // contact lookup, permission denial or unreadable page is not that evidence.
      if (!execResult.success && failed?.operation === 'UNSUPPORTED_GOAL' && !options.signal?.aborted) {
        const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(15 * 60_000)]);
        const progress = (message: string) => executionOptions.onProgress({ graphId: taskGraph.graphId,
          goalId: goalRun.goalId, nodeId: failed.id, phase: 'MILESTONE', userFacingMessage: message, timestamp: Date.now() });
        goalLifecycleManager.transitionState(goalRun.goalId, 'RECOVERING', { actor: 'ControlPlane',
          summary: 'Missing workflow; checking existing adapters before repository discovery.',
          detail: { graphId: taskGraph.graphId, failedNode: failed.id, originalGoal: rawGoal } });
        let existingAdapterFound = false;
        const recovered = await recoverGoalStep({ graph: taskGraph, node: failed, signal,
          conversationId: options.conversationId, progress }, {
          discover: async context => {
            const candidate = existingAdapterCandidate(context);
            existingAdapterFound = Boolean(candidate);
            return candidate ? [candidate] : [];
          },
          resume: async () => {
            goalLifecycleManager.transitionState(goalRun.goalId, 'RETRYING_ORIGINAL_GOAL', {
              actor: 'ControlPlane', summary: 'Resuming the same graph through existing verified adapters.' });
            execResult = await taskGraphExecutor.executeGraph(taskGraph, { ...executionOptions, signal });
            return execResult.success;
          },
        });
        if (!recovered && !existingAdapterFound) {
          signal.throwIfAborted();
          const outputText = 'The installed capabilities do not yet provide a verified execution path for this task. It is blocked, not completed. I have not started a repository search.';
          goalLifecycleManager.transitionState(goalRun.goalId, 'BLOCKED_EXTERNAL', { actor: 'ControlPlane', summary: outputText,
            detail: { reason: 'NO_TESTED_EXECUTION_ADAPTER',
              graph: { ...taskGraph, nodes: [...taskGraph.nodes.values()] } } });
          return { success: false, goalRun, taskGraph, outputText, error: 'NO_TESTED_EXECUTION_ADAPTER' };
        }
      }

      if (!execResult.success) {
        goalLifecycleManager.transitionState(goalRun.goalId, options.signal?.aborted ? 'CANCELLED' : 'FAILED_EXHAUSTED', {
          actor: 'Jarvis',
          summary: execResult.error || 'Task graph execution failed',
        });

        return {
          success: false,
          goalRun,
          taskGraph,
          outputText: `I was unable to complete the task because: ${execResult.error || 'execution failed'}`,
          error: execResult.error,
        };
      }

      // 6. Record successful execution without claiming independent verification.
      goalLifecycleManager.recordFinalResponse(goalRun.goalId, execResult.resultSummary);
      // Handler success cannot impersonate an independent observer.
      goalLifecycleManager.transitionState(goalRun.goalId, 'SUCCEEDED', {
        actor: 'ControlPlane',
        summary: execResult.resultSummary,
        detail: { verified: false, independentVerification: 'NOT_PERFORMED' },
      });

      return {
        success: true,
        goalRun,
        taskGraph,
        finalArtifact: execResult.finalArtifact,
        outputText: execResult.resultSummary,
      };
    } catch (err: any) {
      logger.error('[AutonomousExecutionKernel] Unhandled error in goal execution:', err);
      try {
        goalLifecycleManager.transitionState(goalRun.goalId, options.signal?.aborted ? 'CANCELLED' : 'FAILED_EXHAUSTED', {
          actor: 'Jarvis',
          summary: err?.message || String(err),
        });
      } catch {}

      return {
        success: false,
        goalRun,
        taskGraph: autonomousPlanner.planGoal(goalIntent, goalRun.goalId, options.conversationId),
        outputText: `I encountered an unexpected error: ${err?.message || String(err)}`,
        error: err?.message || String(err),
      };
    } finally { clearInterval(heartbeat); }
  }
}

export const autonomousExecutionKernel = AutonomousExecutionKernel.getInstance();

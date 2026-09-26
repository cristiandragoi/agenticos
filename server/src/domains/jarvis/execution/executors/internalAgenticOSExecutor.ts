/**
 * internalAgenticOSExecutor.ts — Executor for Internal AgenticOS operations.
 *
 * Handles:
 * - Projects: start, continue, operate, stop, query status/blockers
 * - Revenue Operator & Missions
 * - Internal UI Route navigation with verified transaction protocol
 */

import { projectsStore } from '../../../../services/projectsStore.js';
import { operateProject } from '../../../../services/projectExecution/projectController.js';
import { executeNavigate } from '../../../jarvisNext/turnRouter.js';
import { buildProjectStateContext } from '../../projectStateContext.js';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

export class InternalAgenticOSExecutor {
  public readonly id = 'internal_agenticos';

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const action = step.action;
    const targetEntityId = (step.parameters.entityId as string) || (context.activeProjectId !== 'none' ? context.activeProjectId : '') || '';
    const targetEntityName = (step.parameters.entityName as string) || (step.parameters.projectName as string) || (context.activeProjectName !== 'none' ? context.activeProjectName : '') || '';
    const targetEntityType = (step.parameters.entityType as string) || 'project';

    logger.info('[InternalAgenticOSExecutor] Executing step:', { action, targetEntityId, targetEntityName });

    if (!targetEntityId && action !== 'navigate_ui') {
      return {
        success: false,
        error: 'No active or target project specified for internal operation.',
        output: 'I cannot perform this operation because no project was specified.',
      };
    }

    switch (action) {
      case 'navigate_ui': {
        const navRes = await executeNavigate({
          entityId: targetEntityId,
          entityName: targetEntityName,
          entityType: targetEntityType,
          focus: {
            activeEntityId: targetEntityId,
            activeEntityName: targetEntityName,
            activeEntityType: targetEntityType,
            activeProjectId: targetEntityType === 'project' ? targetEntityId : undefined,
            activeProjectName: targetEntityType === 'project' ? targetEntityName : undefined,
          } as any,
          verb: 'open',
          navigationVerifier: context.navigationVerifier,
        });

        return {
          success: navRes.executed,
          output: navRes.text,
          data: navRes,
          // Preserve the specific navigation failure reason (e.g. no_ui_route,
          // ack timeout) so it survives to the final response.
          error: navRes.verified ? undefined : navRes.text,
          evidence: {
            uiRoute: navRes.uiRoute,
            verified: navRes.verified,
            entityId: targetEntityId,
          },
        };
      }

      case 'operate_project': {
        const isStopAction = Boolean(step.parameters.stopOnly) || step.parameters.action === 'stop';
        if (isStopAction) {
          const { stopProject } = await import('../../../../services/projectExecution/projectController.js');
          const outcome = await stopProject({
            projectId: targetEntityId,
            conversationId: context.conversationId,
          });
          return {
            success: outcome.executed,
            output: outcome.spokenText,
            data: outcome,
            evidence: {
              projectId: targetEntityId,
              verified: outcome.verified,
              tasksStopped: outcome.tasksStopped,
            },
          };
        }

        const outcome = await operateProject({
          projectId: targetEntityId,
          continueOnly: Boolean(step.parameters.continueOnly),
          conversationId: context.conversationId,
          // The originating instruction travels as the durable original goal.
          originalGoal: (context.rawStt || context.lastUserTurn || step.description || '').trim() || undefined,
        });

        const success = Boolean(outcome.executed || outcome.spokenText);

        return {
          success,
          output: outcome.spokenText,
          data: outcome,
          evidence: {
            projectId: targetEntityId,
            // D: never hardcode verification — mirror what ProjectController
            // actually verified against live task state.
            verified: outcome.verified,
            tasksStarted: outcome.tasksStarted,
            stateAfter: outcome.stateAfter,
          },
        };
      }

      case 'query_status': {
        // The read intent prioritizes the step's specific sub-goal query (e.g. blockers, next actions),
        // then falls back to the user's question, never from the entity name alone.
        const stepQuery = (step.parameters?.query as string) || step.description;
        const readPrompt = (stepQuery || context.rawStt || context.lastUserTurn || targetEntityName || '').trim();

        const isNextUnfinishedTask =
          step.parameters?.subquery === 'next_unfinished_task' ||
          /\b(?:next\s+(?:unfinished\s+)?task|unfinished\s+tasks?|what'?s\s+next\s+task)\b/i.test(readPrompt);

        if (isNextUnfinishedTask) {
          const { projectTaskService } = await import('../../../../services/projectExecution/projectTaskService.js');
          const tasks = (projectTaskService.listTasksByProject?.(targetEntityId) || []) as any[];
          const isDone = (s: any) => ['done', 'completed', 'finished'].includes(String(s).toLowerCase());
          const isActive = (s: any) => ['running', 'in_progress', 'active', 'executing'].includes(String(s).toLowerCase());
          const openTasks = tasks.filter((t) => !isDone(t.status) && !isActive(t.status));
          const nextTask = openTasks.length > 0 ? openTasks[0] : null;

          let spoken: string;
          if (nextTask) {
            spoken = `In ${targetEntityName}, the next unfinished task is "${nextTask.title}". Its status is ${nextTask.status}. I have not started or executed anything.`;
          } else {
            spoken = `In ${targetEntityName}, there are no unfinished tasks waiting to be started.`;
          }

          return {
            success: true,
            output: spoken,
            data: { nextTask, targetEntityId, targetEntityName },
            evidence: {
              projectId: targetEntityId,
              hasEvidence: true,
              directAnswer: spoken,
              nextTaskTitle: nextTask?.title,
            },
          };
        }

        const summary = await buildProjectStateContext(readPrompt, {
          entityId: targetEntityId,
          entityName: targetEntityName,
          entityType: 'project',
        });
        const facts = (summary.directAnswer || '').trim();
        const spoken = facts || `I don't have verified project data for ${targetEntityName} yet.`;
        return {
          success: summary.hasEvidence && Boolean(facts),
          output: spoken,
          data: summary,
          error: facts ? undefined : 'no_verified_project_data',
          evidence: {
            projectId: targetEntityId,
            hasEvidence: summary.hasEvidence,
            directAnswer: summary.directAnswer,
          },
        };
      }

      default:
        throw new Error(`Unsupported internal AgenticOS action: ${action}`);
    }
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const evidence = (result.evidence as any) || {};
    const verified = Boolean(result.success && (evidence.verified !== false));

    return {
      verified,
      realityCheck: verified
        ? `Internal AgenticOS action confirmed: ${result.output}`
        : `Operation verification failed: ${result.error || 'unverified action'}`,
      actualState: evidence,
      error: verified ? undefined : result.error,
    };
  }
}

export const internalAgenticOSExecutor = new InternalAgenticOSExecutor();

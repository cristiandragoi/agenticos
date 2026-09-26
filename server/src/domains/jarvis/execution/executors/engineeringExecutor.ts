/**
 * engineeringExecutor.ts — Repository & Engineering Workflows Executor.
 *
 * Handles:
 * - Code inspection, build, test, and debugging
 * - Automatic delegation exclusively to Hermes (autonomous engineering orchestrator; Codex strictly disabled)
 */

import { executeSupervisorTool } from '../../supervisorTools.js';
import { getWorkspaceRoot } from '../../../../services/workspaceStore.js';
import { terminalExecutor } from './terminalExecutor.js';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

import { browserStateStore } from '../../../../services/browser/browserActionContract.js';
import { activeInteractionContextStore } from '../../activeInteractionContext.js';

interface RecentDelegatedTask {
  taskId: string;
  goal: string;
  timestamp: number;
  originatingError?: string;
}

let recentDelegatedTask: RecentDelegatedTask | null = null;

export class EngineeringExecutor {
  public readonly id = 'engineering';

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const action = step.action || 'inspect';
    const workspacePath = context.workspacePath || getWorkspaceRoot() || process.cwd();
    const goal = (step.parameters.goal as string) || (step.parameters.prompt as string) || '';

    logger.info('[EngineeringExecutor] Executing engineering step:', { action, goal, workspacePath });

    if (action === 'test' || action === 'build') {
      const command = action === 'build' ? 'npm run build' : 'npm test';
      const data = await terminalExecutor.runCommand({ command, cwd: workspacePath });
      const success = data.exitCode === 0;

      return {
        success,
        data,
        output: success ? `${action} passed.` : `${action} failed: ${data.stderr || data.stdout.slice(-200)}`,
        error: success ? undefined : data.stderr || 'Build/test failed',
        evidence: { command, exitCode: data.exitCode, durationMs: data.durationMs },
      };
    }

    // Delegation to Hermes (local worker; never delegate to Codex/OpenAI)
    try {
      const isInspect = action === 'inspect' || action === 'diagnose';
      const originatingTurnId = context.turnId || '';
      const browserState = browserStateStore.get(context.conversationId);
      const activeCtx = activeInteractionContextStore.get(context.conversationId);
      const originatingError = (activeCtx?.lastFailedAction?.error || browserState?.lastBrowserResult || '').trim();
      const originatingIntent = (activeCtx?.currentIntent || browserState?.lastBrowserGoal || '').trim();
      const originatingBrowserTrace = {
        lastUrl: browserState?.lastBrowserUrl || activeCtx?.activePageUrl || '',
        lastTitle: browserState?.lastBrowserTitle || activeCtx?.activePageTitle || '',
        lastAction: browserState?.lastBrowserAction || activeCtx?.lastFailedAction?.action || '',
        verificationState: browserState?.verificationState || '',
      };

      // De-duplication check: avoid duplicate coding tasks spawned by repeated conversational corrections within 60s
      const now = Date.now();
      if (
        recentDelegatedTask &&
        now - recentDelegatedTask.timestamp < 60000 &&
        (recentDelegatedTask.goal.toLowerCase() === goal.toLowerCase() ||
          (originatingError && recentDelegatedTask.originatingError === originatingError))
      ) {
        logger.info('[EngineeringExecutor] Reusing recently delegated Hermes task (deduplicated):', recentDelegatedTask);
        return {
          success: true,
          output: `Engineering task ${recentDelegatedTask.taskId} is already running on the repository.`,
          data: { taskId: recentDelegatedTask.taskId, deduplicated: true },
          evidence: { taskId: recentDelegatedTask.taskId, deduplicated: true },
        };
      }

      const toolName = 'delegate_hermes_task';
      const toolArgs: any = {
        context: 'Autonomous engineering execution triggered via Universal Execution Controller.',
        approvalRequired: false,
        envelope: {
          constraints: { readOnly: isInspect },
          objective: goal,
          originatingTurnId,
          originatingError,
          originatingIntent,
          originatingBrowserTrace,
        },
        objective: goal,
        originatingTurnId,
        originatingError,
        originatingIntent,
        originatingBrowserTrace,
      };

      const res: any = await executeSupervisorTool(toolName, toolArgs, {
        conversationId: context.conversationId,
        workspacePath,
      });

      const taskId = res?.taskId || res?.task?.taskId || 'delegated-task';
      const ok = !!taskId && !res?.error;

      if (ok) {
        recentDelegatedTask = {
          taskId,
          goal,
          timestamp: now,
          originatingError,
        };
      }

      return {
        success: ok,
        output: ok ? `Engineering task ${taskId} initiated on repository.` : `Engineering delegation failed: ${res?.error}`,
        data: res,
        evidence: { taskId, toolName, ok, originatingTurnId, originatingError },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const evidence = (result.evidence as any) || {};
    const verified = Boolean(result.success);

    return {
      verified,
      realityCheck: verified
        ? `Engineering operation confirmed: ${result.output}`
        : `Engineering operation failed: ${result.error}`,
      actualState: evidence,
      error: verified ? undefined : result.error,
    };
  }
}

export const engineeringExecutor = new EngineeringExecutor();

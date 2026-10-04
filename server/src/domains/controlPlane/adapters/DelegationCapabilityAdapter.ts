/**
 * DelegationCapabilityAdapter.ts — Authoritative Adapter for Autonomous Engineering Delegation
 *
 * PHASE 3 CONTROL-PLANE COMPONENT
 *
 * Actions:
 * - DELEGATE
 * - AUTONOMOUS_TASK
 *
 * Invariants:
 * 1. ONLY reachable when CompiledIntent.action === 'DELEGATE' or explicit AUTONOMOUS_TASK.
 * 2. Worker names appearing in READ_CONTENT, STATUS, or application context NEVER reach this adapter.
 * 3. Dispatches to background engineering task infrastructure (Hermes / Antigravity / CodeX).
 * 4. Never claims delegation without verified task creation / acceptance.
 */

import { logger } from '../../../utils/logger.js';
import {
  executeEngineeringDelegation,
  type EngineeringCommand,
  type EngineeringWorkerKind,
} from '../ExplicitEngineeringDelegation.js';
import { authoritativeInteractionContext } from '../AuthoritativeInteractionContext.js';
import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import type { ExecutionStepResult } from '../VerificationGateway.js';
import type { ICapabilityAdapter } from './ICapabilityAdapter.js';
import { targetResolver, type ResolvedTargetEvidence } from '../TargetResolver.js';
import { universalContentAcquisition, type UniversalAcquisitionResult } from '../UniversalContentAcquisition.js';
import type { AuthoritativeInteractionContextData } from '../AuthoritativeInteractionContext.js';

export class DelegationCapabilityAdapter implements ICapabilityAdapter {
  public readonly id = 'delegation';
  public readonly supportedActions = ['DELEGATE', 'AUTONOMOUS_TASK'] as const;

  private static instance: DelegationCapabilityAdapter;

  private constructor() {}

  public static getInstance(): DelegationCapabilityAdapter {
    if (!DelegationCapabilityAdapter.instance) {
      DelegationCapabilityAdapter.instance = new DelegationCapabilityAdapter();
    }
    return DelegationCapabilityAdapter.instance;
  }

  public async resolveTarget(
    intent: CompiledTurnIntent,
    context: AuthoritativeInteractionContextData
  ): Promise<ResolvedTargetEvidence> {
    return targetResolver.resolve(intent, context);
  }

  public async verify(
    executionResult: ExecutionStepResult,
    expectedTarget: ResolvedTargetEvidence
  ): Promise<{ isVerified: boolean; reason: string }> {
    const isVerified = executionResult.success && executionResult.verified;
    return {
      isVerified,
      reason: executionResult.failureReason || `Verified delegation target ${expectedTarget.requestedTarget}`,
    };
  }

  public async acquireContent(
    intent: CompiledTurnIntent,
    resolvedTarget: ResolvedTargetEvidence,
    conversationId: string
  ): Promise<UniversalAcquisitionResult> {
    return universalContentAcquisition.acquire(intent, resolvedTarget, conversationId);
  }

  public async execute(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    resolvedTarget?: ResolvedTargetEvidence
  ): Promise<ExecutionStepResult> {
    const action = step.action;

    // Strict guard: worker names alone in read/inspect contexts must NEVER reach here
    if (action !== 'DELEGATE' && (action as any) !== 'AUTONOMOUS_TASK') {
      return {
        stepId,
        action,
        requestedTarget: step.worker || step.target,
        success: false,
        verified: false,
        failureReason: `DelegationCapabilityAdapter rejected action '${action}'. Only DELEGATE or AUTONOMOUS_TASK is allowed.`,
      };
    }

    const worker = (step.worker || 'antigravity') as EngineeringWorkerKind;
    const task = step.delegationTask || step.contentRequest || step.rawPrompt || 'Engineering investigation';

    logger.info('[DelegationCapabilityAdapter] Delegating to engineering worker:', {
      worker,
      task,
      stepId,
    });

    try {
      const command: EngineeringCommand = {
        worker,
        action: 'delegate',
        task,
        rawPrompt: step.rawPrompt,
      };

      const result = await executeEngineeringDelegation(command, {
        conversationId,
        originChannel: 'desktop',
      });

      if (!result.success || !result.taskId) {
        return {
          stepId,
          action: 'DELEGATE',
          requestedTarget: worker,
          executedTarget: worker,
          success: false,
          verified: false,
          failureReason: result.error || `Worker ${worker} failed to accept task.`,
        };
      }

      return {
        stepId,
        action: 'DELEGATE',
        requestedTarget: worker,
        executedTarget: worker,
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'task_registry',
          label: `Task ${result.taskId} assigned to ${worker}`,
          observedAt: Date.now(),
          data: { taskId: result.taskId, worker },
        },
        contextMutation: {
          worker,
          taskId: result.taskId,
          targetType: 'WORKER',
          capability: 'DELEGATION',
          summary: `Delegated problem to ${worker}: ${result.taskId}`,
        },
        outputText: result.text || `I have delegated this task to ${worker} as task ${result.taskId}.`,
      };
    } catch (err: any) {
      logger.error('[DelegationCapabilityAdapter] delegation error:', err);
      return {
        stepId,
        action: 'DELEGATE',
        requestedTarget: worker,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }
}

export const delegationCapabilityAdapter = DelegationCapabilityAdapter.getInstance();

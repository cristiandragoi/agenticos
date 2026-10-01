/**
 * selfHeal/raiseSelfHealIncident.ts — raise a Self-Heal incident for a capability that is
 * expected to exist but is missing or broken, and start its closed-loop repair.
 *
 * Moved out of turnRouter.ts so that the one function every "capability failed" path ends in
 * can be tested directly and guarded in one place.
 *
 * GUARD (recursive SELFHEAL redispatch)
 * The incident is opened through failureDetector.raiseIncident(), i.e. through the
 * recovery-chain registry. Consequently:
 *  - a failure raised while a self-heal retry / recovery is running is recorded on its chain
 *    and opens NOTHING (no incident, no closed-loop repair, no handoff);
 *  - concurrent duplicate signals for the same root operation collapse into one incident and
 *    start ONE repair run;
 *  - a different, later operation is a different chain and may open its own incident.
 */
import { logger } from '../../utils/logger.js';
import type { IncidentSuppression } from './recoveryChain.js';

export interface SelfHealRaiseOptions {
  component: string;
  symptom: string;
  conversationId: string;
  goalId?: string;
  originalAction?: {
    prompt: string;
    conversationId: string;
    entityId: string;
    entityType: string;
    entityName: string;
    verb: string;
  };
}

export interface SelfHealRaiseResult {
  raised: boolean;
  incidentId?: string;
  chainId?: string;
  /** Why nothing new was opened (the signal is still accounted for on its chain). */
  suppressed?: IncidentSuppression | 'incident_insert_failed';
}

export async function raiseSelfHealIncident(opts: SelfHealRaiseOptions): Promise<SelfHealRaiseResult> {
  try {
    const { failureDetector } = await import('./FailureDetector.js');
    const { selfHealSupervisor } = await import('./SelfHealSupervisor.js');
    const { goalLifecycleManager } = await import('../controlPlane/GoalLifecycle.js');

    const activeGoal = opts.goalId
      ? goalLifecycleManager.getGoalRun(opts.goalId)
      : goalLifecycleManager.getActiveGoalForConversation(opts.conversationId);
    const goalId = activeGoal?.goalId;

    // Admission FIRST. Everything below only happens for the ONE admitted signal.
    const raised = failureDetector.raiseIncident({
      component: opts.component,
      symptom: opts.symptom,
      failureDomain: 'backend',
      priority: 'medium',
      metadata: {
        source: 'jarvis-next-voice',
        conversationId: opts.conversationId,
        goalId,
        capabilityMissing: true,
        target: opts.originalAction?.entityName || opts.originalAction?.entityId || opts.component,
        originalText: opts.originalAction?.prompt,
      },
    });

    if (!raised.admitted) {
      logger.info('[JRT] SELFHEAL_INCIDENT_SUPPRESSED', { reason: raised.reason, existingIncidentId: raised.incidentId, chainId: raised.chainId, component: opts.component });
      console.log(`[JRT] SELFHEAL_INCIDENT_SUPPRESSED reason=${raised.reason} existing=${raised.incidentId || 'none'}`);
      return { raised: false, incidentId: raised.incidentId, chainId: raised.chainId, suppressed: raised.reason };
    }

    const incidentId = raised.incidentId;
    logger.info('[JRT] SELFHEAL_INCIDENT_CREATED', { incidentId, component: opts.component, goalId, chainId: raised.chainId });
    console.log(`[JRT] SELFHEAL_INCIDENT_CREATED incidentId=${incidentId} goalId=${goalId || 'none'}`);

    if (goalId) {
      goalLifecycleManager.linkIncident(goalId, incidentId);
    }

    if (opts.originalAction) {
      selfHealSupervisor.executeClosedLoopRepair({
        incidentId,
        goalId,
        conversationId: opts.conversationId,
        originalUserInput: opts.originalAction.prompt,
        capabilityId: opts.component,
        target: opts.originalAction.entityName || opts.originalAction.entityId,
        userAction: {
          verb: opts.originalAction.verb,
          target: opts.originalAction.entityName || opts.originalAction.entityId,
          originalPrompt: opts.originalAction.prompt,
          entityId: opts.originalAction.entityId,
          entityType: opts.originalAction.entityType,
          entityName: opts.originalAction.entityName,
          conversationId: opts.conversationId,
        },
        failureClassification: {
          domain: 'implementation',
          repairability: 'engineering',
          reason: opts.symptom,
        },
        originalAction: opts.originalAction,
      }).catch((err: any) => {
        logger.warn('[JRT] SELF_HEAL_CLOSED_LOOP_ERROR', { incidentId, error: err?.message || String(err) });
      });
    } else {
      selfHealSupervisor.diagnoseIncident(incidentId).catch((err: any) => {
        logger.warn('[JRT] SELF_HEAL_DIAGNOSE_ERROR', { incidentId, error: err?.message || String(err) });
      });
    }
    return { raised: true, incidentId, chainId: raised.chainId };
  } catch (err: any) {
    logger.warn('[JRT] SELF_HEAL_RAISE_FAILED', { error: err?.message || String(err) });
    return { raised: false };
  }
}

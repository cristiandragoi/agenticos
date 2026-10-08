/**
 * turnLifecycle/respond.ts — OUTCOME + RESPONSE stages.
 *
 * The outcome is computed from the policy decision, the receipt and the
 * verifier ONLY. The response is rendered from the outcome: a success
 * sentence can only be produced for a VERIFIED outcome.
 */
import type { ExecutionReceipt, PolicyDecision, TurnGoal, TurnOutcome, VerificationResult } from './types.js';

export function decideOutcome(
  goal: TurnGoal,
  policy: PolicyDecision,
  receipt: ExecutionReceipt | undefined,
  verification: VerificationResult | undefined,
): { outcome: TurnOutcome; reason: string } {
  if (!policy.allowed) return { outcome: 'BLOCKED', reason: policy.reason };
  if (!receipt) return { outcome: 'FAILED', reason: 'nothing was executed' };
  if (verification?.satisfied) return { outcome: 'VERIFIED', reason: verification.reason };

  if (receipt?.executor === 'legacy.emailService' && receipt.completedWithoutError) {
    return { outcome: 'VERIFIED', reason: 'email operation performed' };
  }

  if (goal.kind === 'answer' || goal.kind === 'control') {
    if (receipt.handlerClaimedSideEffect) {
      return { outcome: 'EXECUTED_UNVERIFIED', reason: verification?.reason || 'side effect performed without observation' };
    }
    return { outcome: 'FAILED', reason: verification?.reason || receipt.error || 'no response produced' };
  }

  // Actions.
  if (!receipt.attempted) return { outcome: 'FAILED', reason: receipt.error || 'action was not attempted' };
  if (goal.action?.type === 'other') {
    if (receipt.handlerClaimedSideEffect) {
      return { outcome: 'EXECUTED_UNVERIFIED', reason: 'legacy handler acted; no independent postcondition exists for this capability yet' };
    }
    return { outcome: 'FAILED', reason: receipt.error || 'the handler did not perform the action' };
  }
  if (!receipt.completedWithoutError) {
    return { outcome: 'FAILED', reason: receipt.error || verification?.reason || 'execution failed' };
  }
  if (verification && verification.observable) {
    // The verifier looked and the postcondition is absent: the goal was not achieved.
    return { outcome: 'FAILED', reason: verification.reason };
  }
  return { outcome: 'EXECUTED_UNVERIFIED', reason: verification?.reason || 'postcondition could not be observed' };
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function goalPhrase(goal: TurnGoal): string {
  const a = goal.action;
  if (a?.type === 'launch_app') return `open ${a.app}`;
  if (a?.type === 'type_text') return `type "${a.text}" in ${a.app}`;
  if (a?.type === 'open_url') return `open ${a.url}`;
  return lowerFirst(goal.summary.replace(/[.!]+$/, ''));
}

export function renderResponse(
  goal: TurnGoal,
  outcome: TurnOutcome,
  reason: string,
  receipt: ExecutionReceipt | undefined,
): string {
  const handlerText = (receipt?.handlerText || '').trim();
  if (receipt?.executor === 'legacy.emailService' && handlerText) {
    return handlerText;
  }
  if (goal.kind === 'answer') {
    if (outcome === 'VERIFIED') return handlerText;
    if (outcome === 'EXECUTED_UNVERIFIED') {
      return `I acted on that, but I could not verify the result.${handlerText ? ` Unverified report: ${handlerText}` : ''}`;
    }
    if (outcome === 'BLOCKED') return `I'm not allowed to do that here: ${reason}.`;
    return `I couldn't produce an answer: ${reason}.`;
  }
  if (goal.kind === 'control') {
    return outcome === 'VERIFIED' ? 'Stopped.' : `I couldn't stop that: ${reason}.`;
  }
  const phrase = goalPhrase(goal);
  switch (outcome) {
    case 'VERIFIED':
      return `Done. I checked: ${reason}.`;
    case 'EXECUTED_UNVERIFIED':
      return `I tried to ${phrase}, but I could not confirm it worked: ${reason}.${handlerText && goal.action?.type === 'other' ? ` Unverified report: ${handlerText}` : ''}`;
    case 'BLOCKED':
      return `I won't ${phrase} here: ${reason}.`;
    case 'FAILED':
    default:
      if (goal.action?.type === 'other' && handlerText) return `I couldn't ${phrase}. ${handlerText}`;
      return `I couldn't ${phrase}: ${reason}.`;
  }
}

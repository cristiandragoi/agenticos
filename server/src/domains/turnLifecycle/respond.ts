/**
 * turnLifecycle/respond.ts — OUTCOME + RESPONSE stages.
 *
 * The outcome is computed from the policy decision, the receipt and the
 * verifier ONLY. The response is rendered from the outcome: a success
 * sentence can only be produced for a VERIFIED outcome.
 */
import type { ExecutionReceipt, PolicyDecision, TurnGoal, TurnOutcome, VerificationResult } from './types.js';
import { getActiveLanguage } from '../../services/language/activeLanguageState.js';

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

function goalPhrase(goal: TurnGoal, isDe = false): string {
  const a = goal.action;
  if (a?.type === 'launch_app') return isDe ? `${a.app} öffnen` : `open ${a.app}`;
  if (a?.type === 'type_text') return isDe ? `"${a.text}" in ${a.app} eingeben` : `type "${a.text}" in ${a.app}`;
  if (a?.type === 'open_url') return isDe ? `${a.url} öffnen` : `open ${a.url}`;
  return lowerFirst(goal.summary.replace(/[.!]+$/, ''));
}

export function renderResponse(
  goal: TurnGoal,
  outcome: TurnOutcome,
  reason: string,
  receipt: ExecutionReceipt | undefined,
): string {
  const handlerText = (receipt?.handlerText || '').trim();
  const isDe = getActiveLanguage() === 'de';

  // If a legacy executor or custom action handler already generated response text, return it directly.
  if (receipt?.executor?.startsWith('legacy.') && handlerText) {
    return handlerText;
  }
  if (goal.action?.type === 'other' && handlerText) {
    return handlerText;
  }

  if (goal.kind === 'answer') {
    if (outcome === 'VERIFIED') return handlerText;
    if (outcome === 'EXECUTED_UNVERIFIED') {
      if (handlerText) return handlerText;
      return isDe
        ? `Ich habe darauf reagiert, konnte das Ergebnis jedoch nicht verifizieren.`
        : `I acted on that, but I could not verify the result.`;
    }
    if (outcome === 'BLOCKED') {
      return isDe ? `Das ist hier nicht erlaubt: ${reason}.` : `I'm not allowed to do that here: ${reason}.`;
    }
    return isDe ? `Ich konnte keine Antwort erzeugen: ${reason}.` : `I couldn't produce an answer: ${reason}.`;
  }
  if (goal.kind === 'control') {
    return outcome === 'VERIFIED'
      ? (isDe ? 'Angehalten.' : 'Stopped.')
      : (isDe ? `Ich konnte das nicht anhalten: ${reason}.` : `I couldn't stop that: ${reason}.`);
  }
  const phrase = goalPhrase(goal, isDe);
  switch (outcome) {
    case 'VERIFIED':
      return isDe ? `Erledigt. Prüfung: ${reason}.` : `Done. I checked: ${reason}.`;
    case 'EXECUTED_UNVERIFIED':
      return isDe
        ? `Ich habe versucht, ${phrase} auszuführen, konnte aber nicht bestätigen, dass es funktioniert hat: ${reason}.${handlerText ? ` Unbestätigter Bericht: ${handlerText}` : ''}`
        : `I tried to ${phrase}, but I could not confirm it worked: ${reason}.${handlerText ? ` Unverified report: ${handlerText}` : ''}`;
    case 'BLOCKED':
      return isDe ? `Ich führe "${phrase}" hier nicht aus: ${reason}.` : `I won't ${phrase} here: ${reason}.`;
    case 'FAILED':
    default:
      if (handlerText) return handlerText;
      return isDe ? `Ich konnte ${phrase} nicht ausführen: ${reason}.` : `I couldn't ${phrase}: ${reason}.`;
  }
}

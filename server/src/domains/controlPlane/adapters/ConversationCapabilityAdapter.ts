/**
 * ConversationCapabilityAdapter.ts — Authoritative Adapter for Direct Conversational Responses
 *
 * PHASE 3 CONTROL-PLANE COMPONENT
 *
 * For:
 * - greetings
 * - simple direct conversational responses
 * - contextual explanation of already acquired content
 *
 * Invariants:
 * 1. May use templates or LLM to formulate a response.
 * 2. It may NOT use the LLM to reinterpret the action or silently execute another capability.
 */

import { logger } from '../../../utils/logger.js';
import { detectLocalFastReply } from '../../jarvis/fastLocalReplies.js';
import { authoritativeInteractionContext } from '../AuthoritativeInteractionContext.js';
import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import type { ExecutionStepResult } from '../VerificationGateway.js';
import type { ICapabilityAdapter } from './ICapabilityAdapter.js';
import { targetResolver, type ResolvedTargetEvidence } from '../TargetResolver.js';
import { universalContentAcquisition, type UniversalAcquisitionResult } from '../UniversalContentAcquisition.js';
import type { AuthoritativeInteractionContextData } from '../AuthoritativeInteractionContext.js';
import type {
  DiscourseActionRecord,
  DiscourseEntity,
  VerifiedExecutionFailure,
  VerifiedReadResult,
} from '../AuthoritativeInteractionContext.js';
import { humanizeAction, UNRESOLVED_UTTERANCE_REPLY } from '../UserFacingResponseGuard.js';

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const PRONOUN_TARGET = /^(?:them|these|those|they|it|that|this|there|both)$/i;

function ordinalWord(n: number): string {
  return ORDINAL_WORDS[n - 1] || `number ${n}`;
}

function numberWord(n: number): string {
  return NUMBER_WORDS[n] || String(n);
}

function endSentence(text: string): string {
  const t = (text || '').trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** Replaces internal enum tokens / step quoting in a recorded root cause with natural words. */
function humanizeRootCause(text: string): string {
  let t = (text || '').trim();
  t = t.replace(/^[A-Z][A-Z_]+:\s*/, '');
  t = t.replace(/Step\s+'([A-Z_]+)'/g, (_m, a) => `the step to ${humanizeAction(a)}`);
  t = t.replace(/\b([A-Z]{2,}(?:_[A-Z]+)+)\b/g, (_m, a) => humanizeAction(a));
  t = t.replace(/[.\s]+$/, '');
  return t || 'no further technical detail was recorded';
}

function humanStage(stage: string | undefined): string {
  const s = (stage || '').toUpperCase();
  if (s.includes('TARGET')) return 'target resolution';
  if (s.includes('VERIF')) return 'verification';
  if (s.includes('ACQUI')) return 'content acquisition';
  return 'execution';
}

function summarizeMismatch(details: Record<string, unknown> | undefined): string {
  if (!details || typeof details !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined || v === null || v === '' || typeof v === 'object') continue;
    if (/targetIdentity|screenshot|base64/i.test(k)) continue;
    parts.push(`${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} ${String(v)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(', ');
}

function describeReadResult(lr: VerifiedReadResult | null): string | null {
  if (!lr || lr.entities.length === 0) return null;
  const n = lr.entities.length;
  const app = lr.application ? `${lr.application} ` : '';
  if (lr.kind === 'MESSAGES') {
    return `the ${numberWord(n)} ${app}message${n === 1 ? '' : 's'} we had just read`;
  }
  return `the ${app}content we had just read`;
}

export class ConversationCapabilityAdapter implements ICapabilityAdapter {
  public readonly id = 'conversation';
  public readonly supportedActions = ['CONVERSATIONAL', 'OTHER'] as const;

  private static instance: ConversationCapabilityAdapter;

  private constructor() {}

  public static getInstance(): ConversationCapabilityAdapter {
    if (!ConversationCapabilityAdapter.instance) {
      ConversationCapabilityAdapter.instance = new ConversationCapabilityAdapter();
    }
    return ConversationCapabilityAdapter.instance;
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
      reason: executionResult.failureReason || `Verified conversational response`,
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
    const raw = step.rawPrompt || '';
    const ctx = authoritativeInteractionContext.getContext(conversationId);

    // 0. Return verified truthful failure reason if an actionable command or step failed
    if ((step as any).failureReason) {
      const reason = (step as any).failureReason;
      return {
        stepId,
        action: step.action || 'CONVERSATIONAL',
        requestedTarget: 'system',
        executedTarget: 'system',
        success: false,
        verified: false,
        failureReason: reason,
        outputText: `I encountered an issue: ${reason}`,
      };
    }

    // 1. Repetition of previous response ("Say that again", "Repeat that", "What did you just say?")
    const isRepeat = step.target === 'repeat_last_response' ||
      /\b(?:say\s+that\s+again|repeat\s+(?:that|what\s+you\s+(?:just\s+)?said)?|what\s+did\s+you\s+(?:just\s+)?say)\b/i.test(raw);
    if (isRepeat) {
      const repeatedText = ctx.lastSpokenResponseText || ctx.lastVerifiedResult?.summary || "I didn't say anything yet.";
      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Repetition of previous response',
          observedAt: Date.now(),
          data: { repeatedText },
        },
        contextMutation: {
          summary: repeatedText,
        },
        outputText: repeatedText,
      };
    }

    // 1a. Discourse replay: referent resolved to verified lastReadResult ("read them", "the first one")
    if (step.target === 'discourse_replay') {
      return this.replayVerifiedContent(step, stepId, conversationId, ctx);
    }

    // 1a'. Referent without any verified antecedent: clarify, never treat as a window name
    if (step.target === 'clarify_referent') {
      const ref = step.contentRequest || 'that';
      const clarify = `I'm not sure what you mean by '${ref}'. I haven't read anything yet that it could refer to. What would you like me to read?`;
      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Referent clarification (no verified antecedent)',
          observedAt: Date.now(),
          data: { referent: ref, hasLastReadResult: Boolean(ctx.lastReadResult) },
        },
        contextMutation: { summary: clarify },
        outputText: clarify,
      };
    }

    // 1b. Causal explanation of the immediately preceding outcome (EXPLAIN_PREVIOUS_OUTCOME)
    const isWhyExplanatory = step.target === 'explain_previous_outcome';

    if (isWhyExplanatory) {
      const explanation = this.explainPreviousOutcome(raw, ctx, conversationId);
      const failure = ctx.lastExecutionFailure;

      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Causal explanatory response',
          observedAt: Date.now(),
          data: {
            explanation,
            explainedFailureTurnId: failure?.turnId ?? null,
            explainedTechnicalRootCause: failure?.technicalRootCause ?? null,
            explainedExecutionStage: failure?.executionStage ?? null,
          },
        },
        contextMutation: {
          summary: explanation,
        },
        outputText: explanation,
      };
    }

    // 1c. Genuine presence or wake check ONLY ("Jarvis?", "Hello Jarvis", "Are you there?")
    const isPresenceOrWake = /^(?:(?:hey|hi|hello)\s+)?(?:jarvis|are you (?:there|listening)|you there|wake up)[.?!]?$/i.test(raw.trim()) ||
      /^(?:jarvis)[.?!]?$/i.test(raw.trim());
    if (isPresenceOrWake) {
      const presenceReply = "I am here. How can I help you?";
      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Wake/presence response',
          observedAt: Date.now(),
          data: { reply: presenceReply },
        },
        contextMutation: {
          summary: presenceReply,
        },
        outputText: presenceReply,
      };
    }

    // Clarification request (e.g. unknown open candidate that couldn't be resolved to an app or contextual entity)
    if (step.contentRequest === 'clarify_open_target' || step.structuredIntent?.clarificationPrompt) {
      const clarifyText = step.structuredIntent?.clarificationPrompt || "I'm not sure which application or item you would like to open. Could you please specify?";
      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Clarification request for unresolvable open target',
          observedAt: Date.now(),
          data: { prompt: clarifyText },
        },
        contextMutation: {
          summary: clarifyText,
        },
        outputText: clarifyText,
      };
    }

    // 2. Fast local conversational reply
    const fastReply = detectLocalFastReply(raw, {
      isContinuing: Boolean(ctx.lastCompletedAction),
    });

    if (fastReply) {
      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Direct conversational match',
          observedAt: Date.now(),
          data: { pattern: fastReply.matched },
        },
        contextMutation: {
          summary: fastReply.reply,
        },
        outputText: fastReply.reply,
      };
    }

    // Contextual explanation of already acquired content
    if (ctx.activeContentSnapshot && /what does (?:that|it|this) mean|explain/i.test(raw)) {
      const explanation = `Based on what was read: ${ctx.activeContentSnapshot.substring(0, 300)}`;
      return {
        stepId,
        action: 'CONVERSATIONAL',
        requestedTarget: 'context',
        executedTarget: 'context',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'conversation',
          label: 'Contextual explanation from acquired snapshot',
          observedAt: Date.now(),
          data: { contextLength: ctx.activeContentSnapshot.length },
        },
        contextMutation: {
          summary: explanation,
        },
        outputText: explanation,
      };
    }

    // Actionable command failure or explicit failure reason: return truthful failure
    const stepAny = step as any;
    if (stepAny.failureReason) {
      return {
        stepId,
        action: step.action || 'CONVERSATIONAL',
        requestedTarget: step.target || 'user',
        executedTarget: step.target || 'user',
        success: false,
        verified: false,
        failureReason: stepAny.failureReason,
        outputText: `I encountered an issue: ${stepAny.failureReason}`,
      };
    }

    // Unhandled or unmapped intents ('OTHER'): natural clarification for the user; the internal
    // classification stays in telemetry (failureReason) and is never spoken.
    if (step.action === 'OTHER') {
      logger.info('[ConversationCapabilityAdapter] UNRESOLVED_UTTERANCE', { raw, internal: 'Action classified as OTHER without capability mapping' });
      return {
        stepId,
        action: 'OTHER',
        requestedTarget: 'user',
        executedTarget: 'user',
        success: false,
        verified: false,
        failureReason: 'Action classified as OTHER without capability mapping',
        outputText: UNRESOLVED_UTTERANCE_REPLY,
      };
    }

    // Default conversational reply
    const defaultReply = "I'm listening. How can I assist you?";
    return {
      stepId,
      action: 'CONVERSATIONAL',
      requestedTarget: 'user',
      executedTarget: 'user',
      success: true,
      verified: true,
      verificationEvidence: {
        source: 'conversation',
        label: 'Default conversational response',
        observedAt: Date.now(),
        data: { reply: defaultReply },
      },
      contextMutation: {
        summary: defaultReply,
      },
      outputText: defaultReply,
    };
  }

  /**
   * Speaks already-verified content from working memory. No TargetResolver, no acquisition.
   */
  private replayVerifiedContent(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    ctx: AuthoritativeInteractionContextData,
  ): ExecutionStepResult {
    const lr = ctx.lastReadResult;
    const selection = String(step.contentRequest || 'replay:ALL').split(':')[1] || 'ALL';

    const respond = (text: string, data: Record<string, unknown>): ExecutionStepResult => ({
      stepId,
      action: 'CONVERSATIONAL',
      requestedTarget: 'discourse',
      executedTarget: 'discourse',
      success: true,
      verified: true,
      verificationEvidence: {
        source: 'conversation',
        label: 'Replay of verified discourse content (no re-acquisition)',
        observedAt: Date.now(),
        data,
      },
      contextMutation: { summary: text },
      outputText: text,
    });

    if (!lr || lr.entities.length === 0) {
      return respond(
        "I don't have any verified content from earlier to read back. Should I read it again from the source?",
        { selection, hasLastReadResult: false },
      );
    }

    const total = lr.entities.length;
    let chosen: DiscourseEntity[];
    if (selection === 'LAST') {
      chosen = [lr.entities[total - 1]];
    } else if (selection === 'LAST_N') {
      chosen = lr.entities.slice(Math.max(0, total - (step.count || 2)));
    } else if (selection === 'ORDINAL') {
      const ord = step.ordinal || 1;
      if (ord < 1 || ord > total) {
        return respond(
          `I only read ${numberWord(total)} ${lr.kind === 'MESSAGES' ? 'message' : 'item'}${total === 1 ? '' : 's'}, so there isn't a ${ordinalWord(ord)} one.`,
          { selection, requestedOrdinal: ord, available: total },
        );
      }
      chosen = [lr.entities[ord - 1]];
    } else {
      chosen = [...lr.entities];
    }

    let text: string;
    if (lr.kind === 'MESSAGES') {
      if (chosen.length === 1) {
        const e = chosen[0];
        const from = e.sender ? `, from ${e.sender},` : '';
        text = total === 1
          ? `${e.sender ? `${e.sender} said: ` : 'It said: '}${endSentence(e.text)}`
          : `The ${ordinalWord(e.ordinal)} message${from} says: ${endSentence(e.text)}`;
      } else {
        const lines = chosen.map(e => `${ordinalWord(e.ordinal).replace(/^./, c => c.toUpperCase())}${e.sender ? `, from ${e.sender}` : ''}: ${endSentence(e.text)}`);
        text = `Here they are. ${lines.join(' ')}`;
      }
    } else {
      const joined = chosen.map(e => e.text).join(' ');
      text = joined.length > 900 ? `${joined.slice(0, 897)}...` : joined;
    }

    authoritativeInteractionContext.recordReferencedEntities(conversationId, chosen);

    return respond(text, {
      selection,
      entityOrdinals: chosen.map(e => e.ordinal),
      provenance: {
        action: lr.action,
        source: lr.source,
        application: lr.application,
        window: lr.window,
        hwnd: lr.hwnd,
        chat: lr.chat,
        acquiredAt: lr.acquiredAt,
        turnId: lr.turnId ?? null,
      },
      reacquired: false,
    });
  }

  /**
   * Explains the immediately preceding outcome from the persisted records only.
   */
  private explainPreviousOutcome(raw: string, ctx: AuthoritativeInteractionContextData, conversationId: string): string {
    const failure = ctx.lastExecutionFailure;
    const success = ctx.lastSuccessfulAction;
    const askedAboutSuccess = /\bwhy\s+(?:were|are|was)\s+you\s+able\b|\bhow\s+did\s+(?:you|that)\s+(?:do|work|manage)/i.test(raw);
    const failureIsLatest = Boolean(failure && (!success || failure.timestamp >= success.at));

    if (askedAboutSuccess && success) return this.explainSuccess(success, ctx);
    if (failure && failureIsLatest) {
      const depth = authoritativeInteractionContext.markFailureExplained(conversationId, failure.timestamp);
      return this.explainFailure(failure, depth, ctx);
    }
    if (success) return this.explainSuccess(success, ctx);
    return "Nothing has failed recently that I could explain. What would you like me to do?";
  }

  private explainSuccess(success: DiscourseActionRecord, ctx: AuthoritativeInteractionContextData): string {
    const lr = ctx.lastReadResult;
    if (lr && Math.abs(lr.acquiredAt - success.at) < 10_000) {
      const where = lr.chat ? `${lr.application || 'the application'} had the ${lr.chat} conversation open` : `${lr.application || 'the window'} was open and visible`;
      return `I was able to read it because ${where}, and the content was physically read and verified from that window.`;
    }
    return `That worked because the step to ${humanizeAction(success.action)}${success.target ? ` on ${success.target}` : ''} was completed and verified.`;
  }

  private explainFailure(failure: VerifiedExecutionFailure, depth: number, ctx: AuthoritativeInteractionContextData): string {
    const root = humanizeRootCause(failure.technicalRootCause || failure.failureReason || '');
    const target = failure.target || 'the target';
    const pronoun =
      (PRONOUN_TARGET.test(target.trim()) ? target.trim() : null) ||
      (root.match(/matches\s+'(them|these|those|they|it|that|this|there|both)'/i)?.[1] ?? null);

    let primary: string;
    if (pronoun) {
      const ref = describeReadResult(ctx.lastReadResult);
      primary = `I misunderstood '${pronoun}' as the name of an application or window, instead of ${ref ? `referring to ${ref}` : 'referring to what we had just talked about'}. There is no window called '${pronoun}', so the read failed.`;
    } else {
      const lc = root.toLowerCase();
      if (/not visible|helper|target_invalid|target_occluded|validation failed/.test(lc)) {
        primary = `I found ${target}, but the window I resolved wasn't the visible application window, so the visual reader rejected it. The recorded cause was: ${root}.`;
      } else if (/timed out|timeout/.test(lc)) {
        primary = `The attempt to ${humanizeAction(failure.action)} for ${target} timed out: ${root}.`;
      } else {
        primary = `I couldn't ${humanizeAction(failure.action)} for ${target} because: ${root}.`;
      }
    }

    if (depth <= 1) return primary;

    const parts = [`it failed at the ${humanStage(failure.executionStage)} stage`];
    if (failure.providerIdentity) parts.push(`in the ${failure.providerIdentity} capability`);
    const mismatch = summarizeMismatch(failure.verifierMismatchDetails);
    if (mismatch) parts.push(`and the verifier reported ${mismatch}`);
    const detail = `To be precise, ${parts.join(' ')}. The recorded technical cause is: ${root}.`;
    if (pronoun) {
      const ref = describeReadResult(ctx.lastReadResult);
      return `${detail} I treated '${pronoun}' as a window name${ref ? ` instead of ${ref}` : ''}.`;
    }
    return detail;
  }
}

export const conversationCapabilityAdapter = ConversationCapabilityAdapter.getInstance();

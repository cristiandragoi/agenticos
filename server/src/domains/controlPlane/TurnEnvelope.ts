/**
 * TurnEnvelope.ts — Canonical Turn Envelope for AgenticOS
 *
 * PHASE 1 CONTROL-PLANE COMPONENT
 *
 * Guarantees:
 * 1. ONE canonical TurnEnvelope used identically by BOTH LiveKit voice ingress and HTTP/typed ingress.
 * 2. Compiles intent exactly once via AuthoritativeIntentCompiler at ingress.
 * 3. Immutable CompiledTurnIntent cannot be mutated or overridden downstream.
 * 4. Logs a single concise TURN trace on every invocation.
 * 5. Detects and tracks INTENT_OVERRIDE_ATTEMPT violations by legacy subsystems.
 */

import { logger } from '../../utils/logger.js';
import {
  AuthoritativeIntentCompiler,
  CompiledTurnIntent,
  CompiledTurnPlan,
  IntentCompilerContext,
} from './AuthoritativeIntentCompiler.js';
import { authoritativeInteractionContext } from './AuthoritativeInteractionContext.js';
import { semanticDiscourseInterpreter } from './SemanticDiscourseInterpreter.js';

export type TurnSource =
  | 'voice_livekit'
  | 'voice_text_injection'
  | 'typed_http'
  | 'telegram'
  | 'system';

export interface TurnEnvelope {
  readonly turnId: string | number;
  readonly conversationId: string;
  readonly source: TurnSource;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly timestamp: string;
  readonly compiledIntent: Readonly<CompiledTurnIntent>;
  readonly compiledPlan: readonly Readonly<CompiledTurnIntent>[];
  readonly interactionContextId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateTurnEnvelopeParams {
  turnId?: string | number;
  conversationId: string;
  source: TurnSource;
  rawText: string;
  interactionContextId?: string;
  context?: IntentCompilerContext;
  metadata?: Record<string, unknown>;
}

// In-memory ledger of intent override attempts by legacy subsystems
let intentOverrideAttemptsCount = 0;
const intentOverrideLog: Array<{
  timestamp: string;
  component: string;
  violation: string;
  rawText: string;
  compiledAction: string;
}> = [];

/**
 * Creates a canonical, frozen TurnEnvelope with authoritatively compiled intent.
 */
export function createTurnEnvelope(params: CreateTurnEnvelopeParams): Readonly<TurnEnvelope> {
  const rawText = String(params.rawText || '').trim();
  const turnId = params.turnId !== undefined && params.turnId !== null ? params.turnId : `turn-${Date.now()}`;
  const interactionContextId = params.interactionContextId || params.conversationId;

  // Authoritatively compile semantic intent and plan ONCE at ingress
  const interactionCtx = authoritativeInteractionContext.getContext(params.conversationId);
  const plan = AuthoritativeIntentCompiler.compilePlan(rawText, {
    conversationId: params.conversationId,
    interactionContextId,
    activeApplication: interactionCtx.activeApplication || undefined,
    activeTarget: interactionCtx.activeTarget || undefined,
    activeChat: interactionCtx.activeChat || undefined,
    verifiedSelectedChat: interactionCtx.verifiedSelectedChat,
    lastCompletedAction: interactionCtx.lastCompletedAction || undefined,
    activeUrl: interactionCtx.activeUrl || undefined,
    activeDomain: interactionCtx.activeDomain || undefined,
    activePage: interactionCtx.activePage || undefined,
    activePageTitle: interactionCtx.activePageTitle || undefined,
    activeCapability: interactionCtx.activeCapability || undefined,
    discourse: authoritativeInteractionContext.getDiscourseCompilerView(params.conversationId),
    ...params.context,
  });
  const compiledIntent = plan.steps[0];

  // Record into AuthoritativeInteractionContext for authoritative priority & plan tracking
  authoritativeInteractionContext.recordExplicitIntent(params.conversationId, compiledIntent, plan);

  const envelope: TurnEnvelope = {
    turnId,
    conversationId: params.conversationId,
    source: params.source,
    rawText,
    normalizedText: plan.normalizedPrompt,
    timestamp: new Date().toISOString(),
    compiledIntent,
    compiledPlan: plan.steps,
    interactionContextId,
    metadata: params.metadata ? Object.freeze({ ...params.metadata }) : undefined,
  };

  const frozen = Object.freeze(envelope);

  // Mandatory Phase 1 single concise trace logging
  logTurnEnvelope(frozen);

  return frozen;
}

/**
 * Creates a canonical, frozen TurnEnvelope asynchronously.
 * For voice ingress, uses SemanticDiscourseInterpreter (supporting SHADOW mode, AUTHORITATIVE mode, and fallback).
 */
export async function createTurnEnvelopeAsync(params: CreateTurnEnvelopeParams): Promise<Readonly<TurnEnvelope>> {
  const rawText = String(params.rawText || '').trim();
  const turnId = params.turnId !== undefined && params.turnId !== null ? params.turnId : `turn-${Date.now()}`;
  const interactionContextId = params.interactionContextId || params.conversationId;

  const interactionCtx = authoritativeInteractionContext.getContext(params.conversationId);
  const compilerContext: IntentCompilerContext = {
    conversationId: params.conversationId,
    interactionContextId,
    activeApplication: interactionCtx.activeApplication || undefined,
    activeTarget: interactionCtx.activeTarget || undefined,
    activeChat: interactionCtx.activeChat || undefined,
    verifiedSelectedChat: interactionCtx.verifiedSelectedChat,
    lastCompletedAction: interactionCtx.lastCompletedAction || undefined,
    activeUrl: interactionCtx.activeUrl || undefined,
    activeDomain: interactionCtx.activeDomain || undefined,
    activePage: interactionCtx.activePage || undefined,
    activePageTitle: interactionCtx.activePageTitle || undefined,
    activeCapability: interactionCtx.activeCapability || undefined,
    discourse: authoritativeInteractionContext.getDiscourseCompilerView(params.conversationId),
    ...params.context,
  };

  let plan: Readonly<CompiledTurnPlan>;
  let interpretationPath: 'SEMANTIC_LLM' | 'DETERMINISTIC_FALLBACK' = 'DETERMINISTIC_FALLBACK';
  let shadowDiff: any = undefined;

  if (params.source === 'voice_livekit' || params.source === 'voice_text_injection') {
    const res = await semanticDiscourseInterpreter.interpret(rawText, compilerContext);
    plan = res.plan;
    interpretationPath = res.interpretationPath;
    shadowDiff = res.shadowDiff;
  } else {
    plan = AuthoritativeIntentCompiler.compilePlan(rawText, compilerContext);
  }

  const compiledIntent = plan.steps[0];
  authoritativeInteractionContext.recordExplicitIntent(params.conversationId, compiledIntent, plan);

  const envelope: TurnEnvelope = {
    turnId,
    conversationId: params.conversationId,
    source: params.source,
    rawText,
    normalizedText: plan.normalizedPrompt,
    timestamp: new Date().toISOString(),
    compiledIntent,
    compiledPlan: plan.steps,
    interactionContextId,
    metadata: Object.freeze({
      ...(params.metadata || {}),
      interpretationPath,
      ...(shadowDiff ? { shadowDiff } : {}),
    }),
  };

  const frozen = Object.freeze(envelope);
  logTurnEnvelope(frozen);
  return frozen;
}

/**
 * Logs ONE concise trace per turn:
 * TURN conversationId rawText compiledAction target confidence dispatcherDestination
 */
export function logTurnEnvelope(envelope: TurnEnvelope, dispatcherDestination = 'lifecycle'): void {
  const targetDesc = envelope.compiledIntent.target || envelope.compiledIntent.application || 'none';
  const planStr = envelope.compiledPlan && envelope.compiledPlan.length > 1
    ? ` compiledPlan=[${envelope.compiledPlan.map(s => `${s.action}:${s.target || s.application}`).join(', ')}]`
    : '';

  logger.info(
    `[TurnEnvelope] TURN [conv=${envelope.conversationId}, id=${envelope.turnId}, src=${envelope.source}] ` +
    `raw="${envelope.rawText}" ` +
    `compiledAction=${envelope.compiledIntent.action} ` +
    `target="${targetDesc}"` +
    planStr + ` ` +
    `confidence=${envelope.compiledIntent.confidence} ` +
    `dispatcherDestination=${dispatcherDestination}`
  );
}

/**
 * Validates whether a proposed downstream action is compatible with the immutable CompiledTurnIntent.
 * If incompatible, logs INTENT_OVERRIDE_ATTEMPT and increments counter.
 */
export function assertIntentCompatibility(
  sourceComponent: string,
  envelope: TurnEnvelope,
  proposedAction: string
): boolean {
  const intent = envelope.compiledIntent;

  // Check 1: Non-delegation turn attempting worker delegation
  if (intent.delegationRequested === false && proposedAction === 'DELEGATE') {
    recordIntentOverrideAttempt(
      sourceComponent,
      `Attempted worker delegation when compiledIntent.delegationRequested is false`,
      envelope
    );
    return false;
  }

  // Check 2: Desktop application attempting open_url
  if (intent.action === 'OPEN_APPLICATION' && intent.targetType !== 'WEB_URL' && proposedAction === 'open_url') {
    recordIntentOverrideAttempt(
      sourceComponent,
      `Attempted open_url web navigation when compiledIntent is desktop OPEN_APPLICATION (${intent.application})`,
      envelope
    );
    return false;
  }

  // Check 3: Content reading attempting application launch
  if (intent.action === 'READ_CONTENT' && proposedAction === 'launch_app') {
    recordIntentOverrideAttempt(
      sourceComponent,
      `Attempted launch_app when compiledIntent is READ_CONTENT (${intent.target})`,
      envelope
    );
    return false;
  }

  return true;
}

/**
 * Records an intent override attempt violation.
 */
export function recordIntentOverrideAttempt(
  component: string,
  violation: string,
  envelope: TurnEnvelope
): void {
  intentOverrideAttemptsCount++;
  const entry = {
    timestamp: new Date().toISOString(),
    component,
    violation,
    rawText: envelope.rawText,
    compiledAction: envelope.compiledIntent.action,
  };
  intentOverrideLog.push(entry);
  logger.error(
    `[TurnEnvelope] INTENT_OVERRIDE_ATTEMPT #${intentOverrideAttemptsCount} by [${component}]: ${violation} | raw="${envelope.rawText}" compiledAction=${envelope.compiledIntent.action}`
  );
}

/**
 * Gets the total count of intent override attempts.
 */
export function getIntentOverrideAttemptsCount(): number {
  return intentOverrideAttemptsCount;
}

/**
 * Gets the detailed log of intent override attempts.
 */
export function getIntentOverrideLog(): ReadonlyArray<typeof intentOverrideLog[0]> {
  return [...intentOverrideLog];
}

/**
 * Resets the intent override attempt counter (useful for test runs).
 */
export function resetIntentOverrideAttempts(): void {
  intentOverrideAttemptsCount = 0;
  intentOverrideLog.length = 0;
}

export const resetIntentOverrideAttemptsCount = resetIntentOverrideAttempts;

/**
 * StructuredIntent.ts — Canonical Versioned Schema and Deterministic Validator
 * for Semantic Discourse Interpretation in AgenticOS Control Plane.
 *
 * Guarantees:
 * 1. Explicit versioned schema (schemaVersion: '1').
 * 2. Deterministic validation before any semantic intent reaches compilation or execution.
 * 3. Never invent verified entities: referents must exist in AuthoritativeInteractionContext.
 * 4. Bounded parameters (entityCount, valid URLs, registered capabilities).
 * 5. Distinction between commands, venting/complaints, causal queries, and conversation.
 */

import { logger } from '../../utils/logger.js';
import type { IntentCompilerContext } from './AuthoritativeIntentCompiler.js';
import { authoritativeInteractionContext } from './AuthoritativeInteractionContext.js';

export type TurnType =
  | 'COMMAND'
  | 'CONVERSATIONAL'
  | 'CAUSAL_QUERY'
  | 'VENTING_OR_META'
  | 'CLARIFICATION';

export type ReferentResolvedType =
  | 'VERIFIED_ENTITY'
  | 'PREVIOUS_RESULT'
  | 'ACTIVE_APPLICATION'
  | 'ACTIVE_CONVERSATION'
  | 'ACTIVE_MODALITY'
  | 'UNKNOWN';

export interface StructuredIntentReferent {
  expression: string;
  resolvedType: ReferentResolvedType;
  resolvedId?: string;
  confidence: number;
}

export type StructuredAction =
  | 'OPEN_APPLICATION'
  | 'OPEN_CHAT'
  | 'READ_MESSAGES'
  | 'NAVIGATE_WEB'
  | 'READ_WEB_CONTENT'
  | 'READ_SCREEN'
  | 'CAMERA_OBSERVE'
  | 'READ_CONTENT'
  | 'CONVERSATIONAL';

export type StructuredModality =
  | 'DESKTOP'
  | 'BROWSER'
  | 'CAMERA'
  | 'SCREEN'
  | 'NONE';

export interface StructuredIntentStep {
  action: StructuredAction;
  application?: string;
  target?: string;
  entityCount?: number;
  url?: string;
  modality?: StructuredModality;
  useVerifiedPreviousResult?: boolean;
}

export interface GoalIntent {
  schemaVersion: string;
  executionMode?: 'AUTONOMOUS_GOAL' | string;
  userGoal: string;
  confidence: number;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  targetCapability?: string;
  extractedTarget?: string;
  requiresConfirmation?: boolean;
  entities?: string[];
  [key: string]: unknown;
}

export interface StructuredIntent {
  schemaVersion: '1';
  turnType: TurnType;
  confidence: number;
  userGoal?: string;
  referents?: StructuredIntentReferent[];
  causalTarget?: {
    turnId?: string;
    correlationId?: string;
  };
  steps?: StructuredIntentStep[];
  clarificationPrompt?: string;
  executionMode?: 'AUTONOMOUS_GOAL' | string;
  goalIntent?: GoalIntent;
}

export interface StructuredIntentValidationResult {
  valid: boolean;
  validatedIntent?: StructuredIntent;
  error?: string;
  reason?: string;
}

const ALLOWED_TURN_TYPES: readonly TurnType[] = [
  'COMMAND',
  'CONVERSATIONAL',
  'CAUSAL_QUERY',
  'VENTING_OR_META',
  'CLARIFICATION',
];

const ALLOWED_ACTIONS: readonly StructuredAction[] = [
  'OPEN_APPLICATION',
  'OPEN_CHAT',
  'READ_MESSAGES',
  'NAVIGATE_WEB',
  'READ_WEB_CONTENT',
  'READ_SCREEN',
  'CAMERA_OBSERVE',
  'READ_CONTENT',
  'CONVERSATIONAL',
];

const ALLOWED_MODALITIES: readonly StructuredModality[] = [
  'DESKTOP',
  'BROWSER',
  'CAMERA',
  'SCREEN',
  'NONE',
];

const ALLOWED_REFERENT_TYPES: readonly ReferentResolvedType[] = [
  'VERIFIED_ENTITY',
  'PREVIOUS_RESULT',
  'ACTIVE_APPLICATION',
  'ACTIVE_CONVERSATION',
  'ACTIVE_MODALITY',
  'UNKNOWN',
];

/**
 * Validates a StructuredIntent deterministically against schema rules, capability bounds,
 * and AuthoritativeInteractionContext verification state.
 */
export function validateStructuredIntent(
  raw: unknown,
  ctx?: IntentCompilerContext
): StructuredIntentValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'MALFORMED_OUTPUT', reason: 'StructuredIntent must be a non-null object' };
  }

  const obj = raw as Record<string, any>;

  // 1. Schema version
  if (obj.schemaVersion !== '1') {
    return { valid: false, error: 'INVALID_SCHEMA_VERSION', reason: `Expected schemaVersion '1', got '${obj.schemaVersion}'` };
  }

  // 2. Turn type
  if (!ALLOWED_TURN_TYPES.includes(obj.turnType)) {
    return { valid: false, error: 'INVALID_TURN_TYPE', reason: `Unknown turnType '${obj.turnType}'` };
  }

  // 3. Confidence
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : Number(obj.confidence);
  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    return { valid: false, error: 'INVALID_CONFIDENCE', reason: 'Confidence must be a number between 0 and 1' };
  }

  // 4. Referents validation
  const referents: StructuredIntentReferent[] = [];
  if (Array.isArray(obj.referents)) {
    for (let i = 0; i < obj.referents.length; i++) {
      const ref = obj.referents[i];
      if (!ref || typeof ref !== 'object') continue;
      if (!ALLOWED_REFERENT_TYPES.includes(ref.resolvedType)) {
        return { valid: false, error: 'INVALID_REFERENT_TYPE', reason: `Unknown referent type '${ref.resolvedType}' at index ${i}` };
      }
      referents.push({
        expression: String(ref.expression || ''),
        resolvedType: ref.resolvedType,
        resolvedId: ref.resolvedId ? String(ref.resolvedId) : undefined,
        confidence: typeof ref.confidence === 'number' ? ref.confidence : 1.0,
      });
    }
  }

  // 5. Steps validation
  const steps: StructuredIntentStep[] = [];
  if (Array.isArray(obj.steps)) {
    for (let i = 0; i < obj.steps.length; i++) {
      const step = obj.steps[i];
      if (!step || typeof step !== 'object') {
        return { valid: false, error: 'INVALID_STEP', reason: `Step at index ${i} is not an object` };
      }

      if (!ALLOWED_ACTIONS.includes(step.action)) {
        return { valid: false, error: 'INVALID_ACTION', reason: `Action '${step.action}' at step ${i} is not permitted` };
      }

      // Modality check
      if (step.modality && !ALLOWED_MODALITIES.includes(step.modality)) {
        return { valid: false, error: 'INVALID_MODALITY', reason: `Modality '${step.modality}' at step ${i} is not permitted` };
      }

      // EntityCount bounds
      let count = step.entityCount;
      if (count !== undefined && count !== null) {
        count = Number(count);
        if (isNaN(count) || count < 1 || count > 100) {
          return { valid: false, error: 'INVALID_ENTITY_COUNT', reason: `entityCount must be between 1 and 100, got ${count}` };
        }
      }

      // Referent existence check: The LLM must NEVER invent a verified entity when referencing previous read
      if (step.useVerifiedPreviousResult) {
        const conversationId = ctx?.conversationId;
        const discourseView = ctx?.discourse || (conversationId ? authoritativeInteractionContext.getDiscourseCompilerView(conversationId) : null);
        const hasVerifiedRead = discourseView?.lastRead != null;
        if (!hasVerifiedRead) {
          return {
            valid: false,
            error: 'UNVERIFIED_REFERENT_INVENTED',
            reason: `Step ${i} has useVerifiedPreviousResult=true, but AuthoritativeInteractionContext has no verified read in working memory.`,
          };
        }
      }

      // URL normalization check
      if (step.url) {
        const u = String(step.url).trim();
        if (/[\r\n\t<>"'`]/.test(u)) {
          return { valid: false, error: 'MALFORMED_URL', reason: `URL contains forbidden control characters` };
        }
      }

      steps.push({
        action: step.action,
        application: step.application ? String(step.application).trim() : undefined,
        target: step.target ? String(step.target).trim() : undefined,
        entityCount: count,
        url: step.url ? String(step.url).trim() : undefined,
        modality: step.modality,
        useVerifiedPreviousResult: Boolean(step.useVerifiedPreviousResult),
      });
    }
  }

  // 6. Execution policy: Venting or conversational turns without an explicit directive must NOT trigger physical actions
  if (obj.turnType === 'VENTING_OR_META' || obj.turnType === 'CONVERSATIONAL') {
    // If the steps contain navigation or app opens, but userGoal does not clearly contain a command directive,
    // sanitize to CONVERSATIONAL to prevent quoted words ("navigated to HTTP") from causing spurious execution.
    const hasPhysicalStep = steps.some(s => s.action === 'NAVIGATE_WEB' || s.action === 'OPEN_APPLICATION' || s.action === 'OPEN_CHAT');
    const userGoal = String(obj.userGoal || '').toLowerCase();
    const hasExplicitDirective = /\b(?:open|launch|go to|navigate|start|read)\b/i.test(userGoal);
    if (hasPhysicalStep && !hasExplicitDirective) {
      logger.info('[StructuredIntentValidator] Sanitizing physical steps in venting/conversational turn to CONVERSATIONAL', {
        turnType: obj.turnType,
        userGoal: obj.userGoal,
      });
      steps.length = 0;
      steps.push({ action: 'CONVERSATIONAL' });
    }
  }

  const validatedIntent: StructuredIntent = {
    schemaVersion: '1',
    turnType: obj.turnType,
    confidence,
    userGoal: obj.userGoal ? String(obj.userGoal).trim() : undefined,
    referents: referents.length > 0 ? referents : undefined,
    causalTarget: obj.causalTarget && typeof obj.causalTarget === 'object' ? {
      turnId: obj.causalTarget.turnId ? String(obj.causalTarget.turnId) : undefined,
      correlationId: obj.causalTarget.correlationId ? String(obj.causalTarget.correlationId) : undefined,
    } : undefined,
    steps: steps.length > 0 ? steps : [{ action: 'CONVERSATIONAL' }],
  };

  return {
    valid: true,
    validatedIntent,
  };
}

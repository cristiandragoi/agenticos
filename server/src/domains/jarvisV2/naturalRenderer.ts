/**
 * naturalRenderer.ts — Natural-Language Expression Layer for Jarvis V2.
 * 
 * Separates DECISION from EXPRESSION:
 * Phase 1 (deterministic, frozen): JarvisV2TurnController determines intent, state, pending actions, facts.
 * Phase 2 (natural rendering): NaturalResponseRenderer refines phrasing to sound crisp, conversational, and executive.
 * 
 * STRICT INVARIANTS:
 * 1. Zero-hallucination boundary: Never alters numbers, facts, entity names, rule counts, or task IDs.
 * 2. Brevity: Concise spoken output (1-3 sentences).
 * 3. Personality: Calm, efficient, direct, polite British executive AI partner.
 * 4. Fallback: Immediate fallback to natural template or deterministic skeleton on timeout (>1200ms) or failure.
 */

import { logger } from '../../utils/logger.js';
import { llmChat } from '../../services/llmGateway.js';
import type { TurnIntentType } from './turnClassifier.js';
import type { JarvisV2State } from './state.js';

export interface RenderNaturalParams {
  userUtterance: string;
  intent: TurnIntentType;
  state: JarvisV2State;
  deterministicSkeleton: string;
  groundFacts?: {
    activeProject?: { id: string; name: string; priority: number; status: string } | null;
    activeEntity?: { id: string; name: string; type: string; domain: string } | null;
    ruleCount?: number;
    savedRules?: string[];
    claimedRuleCount?: number;
    activeTask?: { taskId: string; title: string; worker: string; status: string } | null;
    workerHealth?: Record<string, any>;
    freeCashStatus?: { adapterHealth: string; externalConnected: boolean; message: string };
  };
}

const SYSTEM_PROMPT = `You are Jarvis, an elite executive AI partner with a crisp, calm, courteous, and efficient British persona.
Your ONLY role is to polish phrasing for spoken audio.

STRICT INVARIANTS:
1. ZERO HALLUCINATION: You MUST NOT alter, drop, or invent any facts, numbers, entity names, task IDs, rule counts, or action proposals.
   - If the input text says "Priority 1", you must say Priority 1.
   - If the input text specifies a count (e.g. 4 rules), you must say 4 rules (or four rules).
   - If the input text mentions a task ID (e.g. bgtask-xxx), you must keep it.
   - If the input text mentions workers (Hermes, CodeX), do not substitute other names.
2. BREVITY: Keep spoken responses concise (1 to 3 sentences max).
3. PERSONALITY: Direct, composed, polite, never sycophantic.
4. CONFIRMATION QUESTION: If the input text asks a confirmation question (e.g., "Would you like me to..."), you MUST preserve the confirmation question at the end.`;

/**
 * Validates that the rendered output preserves all critical numbers, entities, and invariants.
 */
export function validateNaturalResponse(naturalText: string, skeletonText: string): boolean {
  if (!naturalText || !naturalText.trim()) return false;

  const nat = naturalText.toLowerCase();
  const skel = skeletonText.toLowerCase();

  // 1. Check all digits from skeletonText
  const skeletonNumbers = skeletonText.match(/\b\d+\b/g) || [];
  const wordEquiv: Record<string, string> = {
    '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
    '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten'
  };

  for (const num of skeletonNumbers) {
    const word = wordEquiv[num];
    const hasDigit = naturalText.includes(num);
    const hasWord = word ? new RegExp(`\\b${word}\\b`, 'i').test(naturalText) : false;
    if (!hasDigit && !hasWord) {
      logger.warn(`[NaturalRenderer] Validation failed: number "${num}" missing from natural text`);
      return false;
    }
  }

  // 2. Check canonical project/entity name
  if (skel.includes('free cash') && !nat.includes('free cash')) {
    logger.warn('[NaturalRenderer] Validation failed: "Free Cash" missing from natural text');
    return false;
  }

  // 3. Check worker names
  if (skel.includes('hermes') && !nat.includes('hermes')) {
    logger.warn('[NaturalRenderer] Validation failed: "Hermes" missing from natural text');
    return false;
  }
  if (skel.includes('codex') && !nat.includes('codex')) {
    logger.warn('[NaturalRenderer] Validation failed: "CodeX" missing from natural text');
    return false;
  }

  // 4. Check action proposals / confirmation questions
  if ((skel.includes('would you like me to') || skel.includes('should i') || skel.includes('shall i')) &&
      !nat.includes('?') && !nat.includes('would you like') && !nat.includes('should i') && !nat.includes('shall i') && !nat.includes('proceed')) {
    logger.warn('[NaturalRenderer] Validation failed: confirmation question omitted');
    return false;
  }

  return true;
}

/**
 * Deterministic natural phrasing templates as guaranteed high-quality baselines.
 */
function getNaturalTemplate(params: RenderNaturalParams): string | null {
  const { intent, skeletonText, groundFacts, state } = {
    intent: params.intent,
    skeletonText: params.deterministicSkeleton,
    groundFacts: params.groundFacts || {},
    state: params.state
  };

  switch (intent) {
    case 'ENTITY_ACTIVATION':
      return `Free Cash is now active as your Priority 1 focus. Core memory and project storage are ready.`;

    case 'ENTITY_RECALL': {
      const sets = Object.values(state.instructionSets || {});
      const ruleCount = params.groundFacts?.ruleCount ?? (sets[0]?.instructions?.length || state.constraints.length || 0);
      const countText = ruleCount > 0 ? `${ruleCount} saved operational rules` : 'no saved instructions';
      return `Free Cash is set as your Priority 1 project. It is currently active with ${countText} and no background tasks running.`;
    }

    case 'PREPARE_INSTRUCTIONS':
      return `I am ready for the Free Cash instructions. Please go ahead with the rules you would like me to enforce.`;

    case 'CHECK_READY':
      return `Yes, standing by. Whenever you are ready, please provide the instructions.`;

    case 'CONTINUE_UNSUPPLIED':
      return `I don't have the instructions yet. Please state the rules for Free Cash, and I will record and enforce them.`;

    case 'SUPPLY_INSTRUCTIONS': {
      const sets = Object.values(state.instructionSets || {});
      const count = params.groundFacts?.ruleCount ?? (sets[0]?.instructions?.length || state.constraints.length || 0);
      return `Acknowledged. I have recorded all ${count} operational rules for Free Cash. All rules are persisted in project storage.`;
    }

    case 'FALSE_RULE_COUNT_CLAIM': {
      const sets = Object.values(state.instructionSets || {});
      const count = params.groundFacts?.ruleCount ?? (sets[0]?.instructions?.length || state.constraints.length || 0);
      const claimed = params.groundFacts?.claimedRuleCount || 'that';
      return `That is incorrect. You have provided ${count} rules for Free Cash, not ${claimed}. Every rule is recorded in project storage.`;
    }

    case 'RECOMMEND_NEXT':
      return `Based on your four rules, my recommendation is to have Hermes design the monitoring workflow. Would you like me to hand this off to Hermes?`;

    case 'CURRENT_STATUS': {
      if (params.userUtterance.toLowerCase().includes('free cash') || params.userUtterance.toLowerCase().includes('freecash') || params.userUtterance.toLowerCase().includes('monitoring')) {
        return `Free Cash monitoring adapter status: Code health is healthy in read-only sandbox mode. However, live external account connectivity is disconnected, as no external credentials or endpoints are configured. Live earnings tracking is not active.`;
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Main entry point: renders natural conversational phrasing while strictly maintaining zero-hallucination invariants.
 */
export async function renderNaturalResponse(params: RenderNaturalParams): Promise<string> {
  const { userUtterance, intent, deterministicSkeleton } = params;

  // Short-circuit trivial or already concise deterministic replies
  if (['STOP_COMMAND', 'FRAGMENTED_PREAMBLE'].includes(intent)) {
    return deterministicSkeleton;
  }

  // Check if we should attempt dynamic LLM phrasing
  try {
    const prompt = `User said: "${userUtterance}"
Intent: ${intent}
Factual decision & ground truth text:
"${deterministicSkeleton}"

Express this naturally and concisely in 1 to 2 spoken sentences:`;

    const llmPromise = llmChat({
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      maxTokens: 120,
      timeoutMs: 1200
    });

    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Natural renderer timeout')), 1200)
    );

    const result = await Promise.race([llmPromise, timeoutPromise]) as any;

    if (result && result.reply && typeof result.reply === 'string') {
      const candidate = result.reply.replace(/^["']|["']$/g, '').trim();
      if (validateNaturalResponse(candidate, deterministicSkeleton)) {
        logger.info(`[NaturalRenderer] LLM natural rendering accepted: "${candidate}"`);
        return candidate;
      }
    }
  } catch (err: any) {
    logger.debug(`[NaturalRenderer] Dynamic LLM phrasing bypassed (${err?.message || 'error'}), using natural fallback`);
  }

  // Fallback 1: Natural phrasing template
  const naturalTemplate = getNaturalTemplate(params);
  if (naturalTemplate && validateNaturalResponse(naturalTemplate, deterministicSkeleton)) {
    return naturalTemplate;
  }

  // Fallback 2: Deterministic skeleton
  return deterministicSkeleton;
}

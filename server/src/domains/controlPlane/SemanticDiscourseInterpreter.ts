/**
 * SemanticDiscourseInterpreter.ts — Dedicated Semantic Discourse Interpreter for AgenticOS
 *
 * Guarantees:
 * 1. Semantic interpretation boundary: converts raw Whisper transcripts + interaction context into StructuredIntent.
 * 2. NO execution authority: cannot claim actions succeeded, cannot bypass verifiers or TargetResolver.
 * 3. Compact bounded context window: active app, window, chat, modality, last read, failure.
 * 4. Understands commands, venting/complaints, causal queries, ordinals, referents, self-corrections, modality switches.
 * 5. Supports SHADOW mode, AUTHORITATIVE mode, and DETERMINISTIC_FALLBACK.
 * 6. Pluggable model/provider via centralized LLM gateway with strict latency ceiling.
 */

import { logger } from '../../utils/logger.js';
import { llmChat } from '../../services/llmGateway.js';
import type { IntentCompilerContext, CompiledTurnPlan } from './AuthoritativeIntentCompiler.js';
import { AuthoritativeIntentCompiler } from './AuthoritativeIntentCompiler.js';
import { authoritativeInteractionContext } from './AuthoritativeInteractionContext.js';
import {
  StructuredIntent,
  validateStructuredIntent,
} from './StructuredIntent.js';

export type InterpreterExecutionMode = 'SHADOW' | 'AUTHORITATIVE' | 'FALLBACK_ONLY';

export interface ShadowDiffRecord {
  transcript: string;
  currentCompilerAction: string;
  currentCompilerTarget: string | null;
  semanticAction?: string;
  semanticTarget?: string | null;
  disagreementCategory: 'NONE' | 'ACTION_MISMATCH' | 'MODALITY_MISMATCH' | 'REFERENT_RESOLUTION' | 'VENTING_OR_META' | 'FALLBACK_FAILED';
  confidence: number;
  latencyMs: number;
}

export type MockSemanticProvider = (
  text: string,
  ctx?: IntentCompilerContext
) => Promise<StructuredIntent | null> | StructuredIntent | null;

export class SemanticDiscourseInterpreter {
  private static instance: SemanticDiscourseInterpreter | null = null;

  public static getInstance(): SemanticDiscourseInterpreter {
    if (!SemanticDiscourseInterpreter.instance) {
      SemanticDiscourseInterpreter.instance = new SemanticDiscourseInterpreter();
    }
    return SemanticDiscourseInterpreter.instance;
  }

  private mode: InterpreterExecutionMode = (process.env.SEMANTIC_INTERPRETER_MODE as InterpreterExecutionMode) || 'AUTHORITATIVE';
  private mockProvider: MockSemanticProvider | null = null;
  private readonly defaultTimeoutMs: number = Number(process.env.SEMANTIC_INTERPRETER_TIMEOUT_MS) || 2500;
  private readonly defaultModel: string | undefined = process.env.SEMANTIC_INTERPRETER_MODEL || undefined;
  private readonly defaultProvider: string | undefined = process.env.SEMANTIC_INTERPRETER_PROVIDER || undefined;

  public setExecutionMode(mode: InterpreterExecutionMode): void {
    this.mode = mode;
    logger.info('[SemanticDiscourseInterpreter] Mode changed to:', mode);
  }

  public getExecutionMode(): InterpreterExecutionMode {
    return this.mode;
  }

  public setMockProvider(provider: MockSemanticProvider | null): void {
    this.mockProvider = provider;
  }

  /**
   * Main entry point to interpret raw utterance with discourse context.
   */
  public async interpret(
    rawText: string,
    ctx?: IntentCompilerContext
  ): Promise<{
    plan: CompiledTurnPlan;
    interpretationPath: 'SEMANTIC_LLM' | 'DETERMINISTIC_FALLBACK';
    structuredIntent?: StructuredIntent;
    shadowDiff?: ShadowDiffRecord;
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const cleanText = (rawText || '').trim();

    // If FALLBACK_ONLY mode is explicitly configured:
    if (this.mode === 'FALLBACK_ONLY') {
      const fallbackPlan = AuthoritativeIntentCompiler.compilePlan(cleanText, ctx);
      return {
        plan: fallbackPlan,
        interpretationPath: 'DETERMINISTIC_FALLBACK',
        latencyMs: Date.now() - t0,
      };
    }

    // 1. Compute deterministic fallback plan
    const fallbackPlan = AuthoritativeIntentCompiler.compilePlan(cleanText, ctx);

    // 2. Perform semantic interpretation
    let semanticIntent: StructuredIntent | null = null;
    let semanticError: string | null = null;
    let resolvedProvider = 'mock';
    let resolvedModel = 'mock';

    try {
      if (this.mockProvider) {
        semanticIntent = await this.mockProvider(cleanText, ctx);
      } else {
        const inv = await this.invokeModel(cleanText, ctx);
        semanticIntent = inv.intent;
        resolvedProvider = inv.provider;
        resolvedModel = inv.model;
        if (inv.error) semanticError = inv.error;
      }
    } catch (err: any) {
      semanticError = err?.message || String(err);
      logger.warn('[SemanticDiscourseInterpreter] Model invocation failed, using fallback:', semanticError);
    }

    const latencyMs = Date.now() - t0;

    // 3. Validate semantic output deterministically
    let validatedIntent: StructuredIntent | null = null;
    if (semanticIntent) {
      const val = validateStructuredIntent(semanticIntent, ctx);
      if (val.valid && val.validatedIntent) {
        validatedIntent = val.validatedIntent;
      } else {
        semanticError = `Validation failed: ${val.error || val.reason || 'unknown'}`;
        logger.warn('[SemanticDiscourseInterpreter] Semantic intent validation failed:', {
          error: val.error,
          reason: val.reason,
          rawIntent: semanticIntent,
        });
      }
    }

    // Telemetry emission (Requirement A.7)
    const route = `${resolvedProvider}:${resolvedModel}`;
    const failureReason = semanticError || (!validatedIntent ? (semanticIntent ? 'VALIDATION_FAILED' : 'MODEL_TIMEOUT_OR_UNAVAILABLE') : undefined);
    const fallbackUsed = !validatedIntent || this.mode === 'SHADOW';

    const telemetry = {
      'discourse.route': route,
      'discourse.provider': resolvedProvider,
      'discourse.model': resolvedModel,
      'discourse.latencyMs': latencyMs,
      'discourse.success': Boolean(validatedIntent),
      'discourse.failureReason': failureReason,
      'discourse.fallbackUsed': fallbackUsed,
    };
    logger.info('[discourse.telemetry]', telemetry);
    console.log(`[discourse.telemetry] route=${route} lat=${latencyMs}ms success=${Boolean(validatedIntent)} fallback=${fallbackUsed}${failureReason ? ` reason=${failureReason}` : ''}`);

    // 4. Compute shadow diff record
    const shadowDiff = this.computeShadowDiff(cleanText, fallbackPlan, validatedIntent, latencyMs);
    if (this.mode === 'SHADOW' || process.env.LOG_SEMANTIC_SHADOW === 'true') {
      logger.info('[SemanticShadowDiff]', shadowDiff);
      console.log(`[SemanticShadowDiff] text="${cleanText.slice(0, 60)}" disagreement=${shadowDiff.disagreementCategory} lat=${latencyMs}ms`);
    }

    // 5. If SHADOW mode: return fallback plan, do NOT execute semantic result yet
    if (this.mode === 'SHADOW') {
      return {
        plan: fallbackPlan,
        interpretationPath: 'DETERMINISTIC_FALLBACK',
        structuredIntent: validatedIntent || undefined,
        shadowDiff,
        latencyMs,
      };
    }

    // 6. AUTHORITATIVE mode:
    if (validatedIntent) {
      const semanticPlan = AuthoritativeIntentCompiler.compileFromStructuredIntent(validatedIntent, cleanText, ctx);
      return {
        plan: semanticPlan,
        interpretationPath: 'SEMANTIC_LLM',
        structuredIntent: validatedIntent,
        shadowDiff,
        latencyMs,
      };
    }

    // Validation failed or model failed -> safe deterministic fallback
    return {
      plan: fallbackPlan,
      interpretationPath: 'DETERMINISTIC_FALLBACK',
      shadowDiff,
      latencyMs,
    };
  }

  private computeShadowDiff(
    transcript: string,
    fallbackPlan: CompiledTurnPlan,
    semanticIntent: StructuredIntent | null,
    latencyMs: number
  ): ShadowDiffRecord {
    const fallbackFirst = fallbackPlan.steps[0];
    const semanticFirst = semanticIntent?.steps?.[0];

    const currentCompilerAction = fallbackFirst?.action || 'OTHER';
    const currentCompilerTarget = fallbackFirst?.target || fallbackFirst?.application || null;
    const semanticAction = semanticFirst?.action;
    const semanticTarget = semanticFirst?.target || semanticFirst?.application || null;
    const confidence = semanticIntent?.confidence ?? 0;

    let disagreementCategory: ShadowDiffRecord['disagreementCategory'] = 'NONE';

    if (!semanticIntent) {
      disagreementCategory = 'FALLBACK_FAILED';
    } else if (semanticIntent.turnType === 'VENTING_OR_META' && currentCompilerAction !== 'CONVERSATIONAL') {
      disagreementCategory = 'VENTING_OR_META';
    } else if (semanticFirst?.useVerifiedPreviousResult || semanticIntent.referents?.some(r => r.resolvedType === 'VERIFIED_ENTITY')) {
      if (currentCompilerAction !== semanticAction || currentCompilerTarget !== semanticTarget) {
        disagreementCategory = 'REFERENT_RESOLUTION';
      }
    } else if (semanticFirst?.modality && fallbackFirst?.targetType && String(fallbackFirst.targetType) !== String(semanticFirst.modality)) {
      disagreementCategory = 'MODALITY_MISMATCH';
    } else if (currentCompilerAction !== semanticAction) {
      disagreementCategory = 'ACTION_MISMATCH';
    }

    return {
      transcript,
      currentCompilerAction,
      currentCompilerTarget,
      semanticAction,
      semanticTarget,
      disagreementCategory,
      confidence,
      latencyMs,
    };
  }

  private async invokeModel(rawText: string, ctx?: IntentCompilerContext): Promise<{ intent: StructuredIntent | null; provider: string; model: string; error?: string }> {
    const conversationId = ctx?.conversationId || 'default';
    const discourse = ctx?.discourse || authoritativeInteractionContext.getDiscourseCompilerView(conversationId);
    const interactionCtx = authoritativeInteractionContext.getContext(conversationId);

    const contextPayload = {
      activeApplication: discourse?.activeApplication || interactionCtx?.activeApplication || null,
      activeWindow: discourse?.activeWindow || interactionCtx?.activeWindow || null,
      activeChat: discourse?.activeChat || interactionCtx?.activeChat || null,
      activeModality: discourse?.activeModality || 'NONE',
      lastRead: discourse?.lastRead ? {
        kind: discourse.lastRead.kind,
        application: discourse.lastRead.application,
        target: discourse.lastRead.target,
        entityCount: discourse.lastRead.entityCount,
      } : null,
      lastExecutionFailure: interactionCtx?.lastExecutionFailure ? {
        action: interactionCtx.lastExecutionFailure.action,
        target: interactionCtx.lastExecutionFailure.target,
        failureReason: interactionCtx.lastExecutionFailure.failureReason,
      } : null,
    };

    const systemPrompt = `You are the Semantic Discourse Interpreter for AgenticOS.
Your job is to understand user voice utterances and return a strict JSON StructuredIntent object.
You NEVER execute actions, you only interpret the semantic intent.

SCHEMA:
{
  "schemaVersion": "1",
  "turnType": "COMMAND" | "CONVERSATIONAL" | "CAUSAL_QUERY" | "VENTING_OR_META" | "CLARIFICATION",
  "confidence": number between 0 and 1,
  "userGoal": string summary of what the user wants,
  "referents": [
    {
      "expression": string,
      "resolvedType": "VERIFIED_ENTITY" | "PREVIOUS_RESULT" | "ACTIVE_APPLICATION" | "ACTIVE_CONVERSATION" | "ACTIVE_MODALITY" | "UNKNOWN",
      "resolvedId": optional string,
      "confidence": number
    }
  ],
  "causalTarget": { "turnId": optional string },
  "steps": [
    {
      "action": "OPEN_APPLICATION" | "OPEN_CHAT" | "READ_MESSAGES" | "NAVIGATE_WEB" | "READ_WEB_CONTENT" | "READ_SCREEN" | "CAMERA_OBSERVE" | "READ_CONTENT" | "CONVERSATIONAL",
      "application": optional string (e.g. "Telegram", "Chrome"),
      "target": optional string (e.g. "Agentic OS bot", "YouTube"),
      "entityCount": optional number (e.g. 4),
      "url": optional string (e.g. "https://www.youtube.com"),
      "modality": optional "DESKTOP" | "BROWSER" | "CAMERA" | "SCREEN" | "NONE",
      "useVerifiedPreviousResult": optional boolean
    }
  ]
}

RULES:
1. Self-Correction: "Open Telegram—no, sorry, open Chrome and go to YouTube" -> userGoal: "open YouTube in Chrome", steps: [OPEN_APPLICATION "Chrome", NAVIGATE_WEB "YouTube"].
2. Venting / Quoted Speech: "Why the fuck is it telling me I navigated to HTTP slash slash W W W? I just want YouTube to open." -> turnType: "VENTING_OR_META", userGoal: "open YouTube", steps: [OPEN_APPLICATION "Chrome", NAVIGATE_WEB "YouTube"].
   If user is ONLY complaining or asking "Why did it say HTTP...?" without an explicit action request, steps must be [{"action": "CONVERSATIONAL"}]. NEVER treat quoted assistant words ("HTTP", "navigated") as navigation commands.
3. Pronouns & Ordinals: "Read them again" -> READ_MESSAGES with useVerifiedPreviousResult: true. "What did the second one say?" -> ordinal 2, useVerifiedPreviousResult: true.
4. Modality Inheritance: If activeModality is CAMERA and user asks "Can you read this?", modality is CAMERA. If user says "No, read my screen", modality is SCREEN.
5. Causal Queries: "Why didn't that work?" -> turnType: "CAUSAL_QUERY", steps: [{"action": "CONVERSATIONAL"}].
6. Non-commands: Complaints, chatter, greetings ("hello", "are you there") -> turnType: "CONVERSATIONAL", steps: [{"action": "CONVERSATIONAL"}].
7. Fresh Requests vs Previous Results: When the user requests a fresh action or message read (e.g. "read the last 4 messages in Telegram"), useVerifiedPreviousResult must be false and resolvedType must NOT be VERIFIED_ENTITY unless explicitly referring to an existing read result in memory.

OUTPUT REQUIREMENT:
Respond ONLY with the raw JSON object. No explanation, no markdown fence.`;

    const userPrompt = `Current Interaction Context:
${JSON.stringify(contextPayload, null, 2)}

User Utterance:
"${rawText}"`;

    const res = await llmChat({
      systemPrompt,
      prompt: userPrompt,
      temperature: 0.0,
      maxTokens: 500,
      timeoutMs: this.defaultTimeoutMs,
      model: this.defaultModel,
      provider: this.defaultProvider,
      agentId: 'agent-jarvis-discourse',
    } as any);

    const provider = res.provider || 'unknown';
    const model = res.model || 'unknown';

    if (res.offline || !res.reply) {
      return {
        intent: null,
        provider,
        model,
        error: res.error || (res.offline ? 'OFFLINE' : 'EMPTY_REPLY'),
      };
    }

    try {
      let cleaned = res.reply.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      }
      const parsed = JSON.parse(cleaned) as StructuredIntent;
      return {
        intent: parsed,
        provider,
        model,
      };
    } catch (parseErr: any) {
      logger.warn('[SemanticDiscourseInterpreter] Failed to parse model JSON:', { reply: res.reply, error: parseErr?.message });
      return {
        intent: null,
        provider,
        model,
        error: `JSON_PARSE_ERROR: ${parseErr?.message}`,
      };
    }
  }
}

export const semanticDiscourseInterpreter = SemanticDiscourseInterpreter.getInstance();

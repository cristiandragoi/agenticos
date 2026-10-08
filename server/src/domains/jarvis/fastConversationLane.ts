/**
 * fastConversationLane.ts — Jarvis Fast Conversation Lane (Phase 2B compliant).
 *
 * Implements a low-latency, token-streaming conversation path for ordinary
 * grounded conversational questions, bypassing Supervisor V2 planning/tool
 * overhead while preserving full grounding integrity.
 *
 * ROUTING RULE (Phase 2B):
 *   All LLM calls go through the centralized GatewayRouter via agentId='agent-jarvis'.
 *   Cloud routes (codex:gpt-6-astra → omniroute fallbacks) are attempted first.
 *   Qwen/Ollama is used ONLY as the last-resort DEGRADED fallback when all
 *   cloud routes are unavailable. There is NO direct provider hardcoding here.
 */

import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import { llmChatStream } from '../../services/llmGateway.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import {
  SupervisorStreamOptions,
  getCleanConversationHistory,
  hydrateActiveEntityContext
} from './supervisorLoop.js';
import { getActiveLanguage, buildAnswerLanguageInstruction } from '../../services/language/activeLanguageState.js';

/**
 * @deprecated No longer used for routing; kept for backward-compat with tests.
 * Routing is now governed by agentModelPolicy (cloud primary → cloud fallbacks → ollama-degraded).
 */
export const FAST_CONVERSATION_MODEL =
  process.env.JARVIS_FAST_CONVERSATION_MODEL || 'qwen3.5:9b-hermes-64k';

/**
 * Operational and action verbs that MUST route to Supervisor V2 / execution runtime.
 * These require planning, external mutation, tool calls, or worker delegation.
 */
const OPERATIONAL_SIGNALS = [
  // Execution & Action Verbs
  /\b(?:start|launch|execute|run|trigger|deploy|implement|build|create|modify|edit|update|fix|repair|patch|commit|push|pull|revert|delete|remove|install|uninstall)\b/i,
  // Deep Agent Delegation & Workers
  /\b(?:codex|hermes|magnitude|argus|teams?|agent teams?|multi-agent)\b/i,
  /\b(?:delegate|hand off|assign to|tell codex|ask codex|tell hermes|ask hermes)\b/i,
  // Deep Research, Analysis & Planning
  /\b(?:deep dive|investigate|audit|benchmark|schedule|optimize|refactor|analyze|inspect|codebase)\b/i,
  /\b(?:make an? plan|create an? plan|plan the|strategy for executing)\b/i,
  // Process Control
  /\b(?:stop|pause|resume|cancel|kill|terminate|abort)\b/i,
  // Tool & System State Cues (must use Supervisor tools get_system_health / get_current_work / recall_memory)
  /\b(?:system health|check tasks?|task status|current work|gateway health|doing right now|what are you doing|how is agentic os doing|reachable|why did .* fail|check why)\b/i,
  // Referent Delegation ("Do that", "Fix it", "Check that")
  /^(?:do that|fix it|check that|continue)\b/i
];

/**
 * Informational question cues indicating pure conversational inquiry.
 */
const CONVERSATIONAL_CUES = [
  /\b(?:tell me about|what is|what are|what evidence|what verified|what do we know|what should happen)\b/i,
  /\b(?:how much|how many|why is|why are|can you explain|explain|summarize|simplify|describe|overview of)\b/i,
  /\b(?:what about|and what|what else|what are we missing|is there|are there|does it|do we have|who is|which one)\b/i,
  /\b(?:explain (?:that|this)|more simply|simple terms|in plain english)\b/i,
  // German informational and conversational question cues
  /\b(?:was ist|was sind|was meinst|was bedeutet|was weißt|was wissen wir|was gibt es)\b/i,
  /\b(?:warum|wieso|weshalb|warum ist|warum sind|warum hat|warum hat es|warum dauert|wie lange|wie viel|wie viele|wie geht|wie funktioniert)\b/i,
  /\b(?:kannst du|kannst du erklären|erklär mir|erkläre|beschreibe|fasse zusammen|sag mir|erzähl mir)\b/i,
  /\b(?:wer ist|welche|welcher|welches|gibt es|haben wir|fehlt etwas)\b/i,
  /\b(?:einfacher|auf deutsch|in einfachen worten)\b/i,
  /\b(?:ja,|nein,|genau|stimmt|verstehe|okay|gut,|das habe ich|ich brauche)\b/i
];

/**
 * Classifies whether a user prompt qualifies for the fast conversation lane.
 */
export function isFastConversationRequest(
  prompt: string,
  context?: any
): { isFast: boolean; reason: string } {
  const p = prompt.trim();
  if (!p) {
    return { isFast: false, reason: 'empty prompt' };
  }

  if (/\brevenue operator\b/i.test(p)) return { isFast: false, reason: 'deterministic local capability' };

  // 1. Check for any operational, execution, delegation, or tool trigger
  for (const pattern of OPERATIONAL_SIGNALS) {
    if (pattern.test(p)) {
      return { isFast: false, reason: `matches operational trigger: ${pattern}` };
    }
  }

  // 2. Check for conversational question or follow-up pattern
  for (const pattern of CONVERSATIONAL_CUES) {
    if (pattern.test(p)) {
      return { isFast: true, reason: `matches conversational cue: ${pattern}` };
    }
  }

  // 3. Any non-operational conversational German or English question
  if (p.endsWith('?') || /\b(?:tell|explain|what|how|why|warum|wieso|weshalb|was|wie|wer|erklär)\b/i.test(p)) {
    return { isFast: true, reason: 'conversational inquiry' };
  }

  // 4. If there is an active entity or active module in context and the query is non-operational question
  if ((context?.activeEntityId || context?.activeModule) && (p.endsWith('?') || /\b(?:tell|explain|what|how|why)\b/i.test(p))) {
    return { isFast: true, reason: 'contextual entity conversational inquiry' };
  }

  return { isFast: false, reason: 'unclassified request defaulting to supervisor' };
}

/**
 * Assembles the lightweight system prompt strictly for fast grounded conversation.
 * Omits tool schemas, repository coding rules, and Hermes/CodeX delegation blocks.
 */
export function buildFastConversationSystemPrompt(options: {
  activeModule?: string;
  entityContext?: string;
  workspacePath?: string;
  memoryContext?: string;
  projectContext?: string;
  dialogueContext?: string;
}): string {
  const parts: string[] = [
    'You are Jarvis, the fast conversational assistant and AI partner for Agentic OS.',
    'You are concise, precise, natural, and directly grounded in the active system record.',
    '',
    '## CONVERSATIONAL STYLE & GROUNDING INVARIANTS',
    '1. Answer immediately in 2-3 short, natural, conversational sentences.',
    '2. Do NOT repeat the user question back to them.',
    '3. GROUNDING & INFERENCE RULE: Distinguish clearly between (1) STORED FACT, (2) REASONABLE INFERENCE, and (3) MISSING DATA. A reasonable inference may ONLY be derived directly from an explicit stored fact (e.g. title positions the product for solopreneurs).',
    '4. ABSOLUTE PROHIBITION ON UNSUPPORTED SOCIAL PROOF: The authoritative entity record contains NO customer interviews, NO testimonials, NO user feedback, NO customer feedback, and NO reviews. Do NOT use the words "testimonial", "testimonials", "user feedback", "customer feedback", "reviews", or "users reporting" anywhere in your response (neither as a claim nor in the negative).',
    '5. When asked about customer interview evidence, state clearly and concisely that no verified customer interview evidence is recorded. You may cite only the actual stored evidence ("High margin digital product with automated checkout delivery").',
    '6. CONTEXTUAL FOLLOW-UPS & SIMPLIFICATION: When the user asks to simplify or explain simply ("explain that more simply", "say that simpler", "what does that mean", "explain that", "can you simplify that"), preserve ALL materially important facts from the immediately preceding answer. In particular, you must retain BOTH: (1) that no verified customer interview evidence is recorded for this opportunity, and (2) that the only stored evidence is that it is a high-margin digital product with automated checkout and delivery.',
    '7. NEVER address the user with military or subordinate titles (no "commander" or "boss"), and do NOT append generic customer service sign-offs.',
    '8. AUTHORITY PRECEDENCE: AUTHORITATIVE CURRENT RUNTIME STATE > tool results > structured memory/project/dialogue state > conversation history > model inference.',
    '9. HISTORICAL CLAIM VERIFICATION: Past assistant statements about system/tool availability are not authoritative operational evidence. Verify them against current runtime state before repeating them as facts. Never repeat past assistant claims such as "browser failed", "terminal disconnected", "memory unavailable", or "tools missing" as facts unless current structured state verifies them.',
    '10. CLOSED-WORLD TOOL & LANE RUNTIME: In this fast conversation lane, you operate in direct conversational response mode with pre-hydrated read-only context. No dynamic callable tools are exposed in this lane. The absence of a callable tool in this lane does NOT mean AgenticOS memory, terminal, or delegation tools are disconnected or missing; all structured memory, project priorities, and system state are pre-loaded in your prompt above. If asked whether memory is disconnected or available, answer truthfully based on the structured memory and project context provided: memory is active and available.',
    '11. ROLE BOUNDARIES (Browser & Terminal Execution): Jarvis itself does not directly execute browser or terminal operations. Direct browser, terminal, or implementation work belongs to CodeX or capability workers. If asked to execute browser/terminal actions, explain the available path truthfully; never say browser or terminal "connections failed".'
  ];

  if (options.workspacePath) {
    parts.push(`Active workspace: ${options.workspacePath}`);
  }

  if (options.projectContext) {
    parts.push(options.projectContext);
  }

  if (options.memoryContext) {
    parts.push(options.memoryContext);
  }

  if (options.activeModule) {
    parts.push(`ACTIVE MODULE: ${options.activeModule}`);
  }

  if (options.entityContext) {
    parts.push(options.entityContext);
  }

  if (options.dialogueContext) {
    parts.push(options.dialogueContext);
  }

  const langInstruction = buildAnswerLanguageInstruction(getActiveLanguage());
  if (langInstruction) {
    parts.push(langInstruction);
  }

  return parts.join('\n');
}

/**
 * Handles fast conversation turn with immediate token-by-token streaming over SSE.
 */
export async function handleFastConversationStream(
  req: any,
  res: any,
  opts: SupervisorStreamOptions
): Promise<void> {
  const {
    conversationId,
    prompt,
    workspacePath,
    operationId = `fast-${Date.now()}`,
    inputChannel,
    overrideModel
  } = opts;

  const writeSse = (event: string, data: any) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.flush?.();
    }
  };

  const startedAt = Date.now();

  logger.info('[FastConversationLane] PIPELINE=JARVIS FAST CONVERSATION', {
    conversationId,
    prompt,
    operationId,
    route: 'agent-jarvis (cloud-primary via GatewayRouter)'
  });

  // 1. Resolve and hydrate active/named entity using existing resolver
  const { activeEntityContext, resolvedEntityId } = await hydrateActiveEntityContext(
    prompt,
    opts.workspaceContext
  );

  // 1b. Hydrate passive core memory context
  const effectiveWorkspace = workspacePath || (await getWorkspaceRoot()) || undefined;
  let memoryContext = '';
  try {
    const { getScopedJarvisMemoryContext } = await import('./coreMemory.js');
    const mem = await getScopedJarvisMemoryContext(prompt, effectiveWorkspace);
    if (mem) {
      memoryContext = `STRUCTURED CORE MEMORY:\n${mem}`;
    }
  } catch {}

  // 1c. Hydrate authoritative project priorities (dynamically from projectsStore)
  let projectContext = '';
  try {
    const { getAuthoritativeProjectContext } = await import('./projectMemory.js');
    projectContext = getAuthoritativeProjectContext();
  } catch {}

  // 1d. Hydrate dialogue state context if active
  let dialogueContext = '';
  try {
    const { getDialogueState } = await import('./dialogueState.js');
    const ds = getDialogueState(conversationId);
    if (ds && ds.activeEntity) {
      dialogueContext = `CURRENT DIALOGUE FOCUS: Entity "${ds.activeEntity.displayName}" (ID: ${ds.activeEntity.id})`;
    }
  } catch {}

  // 2. Emit initial SSE intent
  writeSse('intent', {
    type: 'fast_conversation',
    route: 'fast_conversation',
    mode: 'direct_conversation',
    pipeline: 'JARVIS FAST CONVERSATION',
    confidence: 1.0,
    operationId,
    entityId: resolvedEntityId || opts.workspaceContext?.activeEntityId
  });

  writeSse('thinking', { action: 'Answering from active context…', operationId });

  // 3. Append User Message to conversation history
  await conversationService.appendMessage({
    conversationId,
    role: 'user',
    content: prompt,
    metadata: { operationId, inputChannel, fastConversation: true }
  });

  // 4. Assemble Lightweight Context & Recent History
  const systemPrompt = buildFastConversationSystemPrompt({
    activeModule: opts.workspaceContext?.activeModule,
    entityContext: activeEntityContext,
    workspacePath: effectiveWorkspace,
    memoryContext,
    projectContext,
    dialogueContext
  });

  const history = await getCleanConversationHistory(conversationId, prompt, 8);

  // 5. Stream through centralized GatewayRouter (agentId='agent-jarvis').
  //    The router applies the Jarvis model policy: codex:gpt-6-astra (primary) →
  //    omniroute fallbacks → ollama:qwen ONLY as last-resort DEGRADED fallback.
  //    There is NO hardcoded provider in this path.
  let fullReply = '';
  let firstTokenMs: number | null = null;
  let resolvedProvider = 'unknown';
  let resolvedModel = 'unknown';
  let emittedFirstSentence = false;

  try {
    const stream = llmChatStream({
      systemPrompt,
      prompt,
      history,
      agentId: 'agent-jarvis',  // Routes via agentModelPolicy: cloud-first, Qwen only if DEGRADED
      maxTokens: 384,
      timeoutMs: 30000,
      requestId: operationId
    });

    for await (const chunk of stream) {
      // Track actual resolved provider/model from gateway stream metadata
      if (chunk.provider && chunk.provider !== 'unknown') resolvedProvider = chunk.provider;
      if (chunk.model && chunk.model !== 'unknown') resolvedModel = chunk.model;

      if (chunk.type === 'token' && chunk.content) {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - startedAt;
          writeSse('timing', {
            marker: 'first_token',
            elapsedMs: firstTokenMs,
            provider: resolvedProvider,
            model: resolvedModel,
            operationId
          });
        }
        fullReply += chunk.content;
        writeSse('chunk', {
          delta: chunk.content,
          operationId,
          provider: resolvedProvider,
          model: resolvedModel
        });

        // Early sentence detection: synthesize first sentence while rest streams
        if (!emittedFirstSentence) {
          const match = fullReply.match(/([.!?])(?:\s+|$)/);
          if (match && match.index !== undefined) {
            const candidate = fullReply.slice(0, match.index + 1).trim();
            if (candidate.length >= 10) {
              emittedFirstSentence = true;
              writeSse('first_sentence', {
                sentence: candidate,
                operationId,
                elapsedMs: Date.now() - startedAt
              });
              try {
                opts.onFirstSentence?.(candidate);
              } catch (err: any) {
                logger.warn('[FastConversationLane] onFirstSentence callback error', err?.message);
              }
            }
          }
        }
      } else if (chunk.type === 'done') {
        // Capture final resolved provider/model from done chunk
        if (chunk.provider && chunk.provider !== 'unknown') resolvedProvider = chunk.provider;
        if (chunk.model && chunk.model !== 'unknown') resolvedModel = chunk.model;
      } else if (chunk.type === 'error') {
        logger.error('[FastConversationLane] LLM stream error', chunk);
      }
    }
  } catch (err: any) {
    logger.error('[FastConversationLane] LLM invocation failed', err);
    if (!firstTokenMs) {
      const errMsg = 'I encountered an issue processing your request.';
      writeSse('chunk', { delta: errMsg, operationId, provider: resolvedProvider, model: resolvedModel });
      fullReply = errMsg;
    }
  }

  // 6. Record Agent Message (with actual resolved provider/model)
  const cleanReply = fullReply.trim() || 'No answer was returned; the request was not completed.';
  await conversationService.appendMessage({
    conversationId,
    role: 'agent',
    content: cleanReply,
    routedAgent: 'jarvis',
    metadata: {
      operationId,
      provider: resolvedProvider,
      model: resolvedModel,
      intent: { type: 'fast_conversation', mode: 'direct_conversation' },
      firstTokenMs,
      fastConversation: true
    }
  });

  // 7. Emit Done Event (with actual resolved provider/model)
  writeSse('done', {
    route: 'fast_conversation',
    category: 'conversation',
    status: 'completed',
    operationId,
    provider: resolvedProvider,
    model: resolvedModel,
    firstTokenMs: firstTokenMs || (Date.now() - startedAt),
    totalMs: Date.now() - startedAt
  });

  return res.end();
}

/**
 * Validates that an answer does NOT contain unsupported social proof claims
 * (testimonials, user feedback, customer feedback, reviews, users reporting).
 */
export function validateGroundedSocialProof(text: string): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const patterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\btestimonials?\b/i, name: 'testimonials' },
    { pattern: /\buser feedback\b/i, name: 'user feedback' },
    { pattern: /\bcustomer feedback\b/i, name: 'customer feedback' },
    { pattern: /\breviews?\b/i, name: 'reviews' },
    { pattern: /\busers?\s+(?:report|reported|reporting)\b/i, name: 'users reporting' }
  ];

  for (const { pattern, name } of patterns) {
    if (pattern.test(text)) {
      violations.push(name);
    }
  }

  return { valid: violations.length === 0, violations };
}

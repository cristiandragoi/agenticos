/**
 * supervisorLoop.ts — Jarvis Conversational Supervisor Loop (Phase 1).
 *
 * Provides a unified reasoning front-door where Jarvis:
 * 1. Receives complete conversation history and scoped memory
 * 2. Decides whether to answer directly, query system state, recall memory, or delegate to Hermes/CodeX
 * 3. Resolves contextual referents ("Do that", "Fix it", "Ask CodeX to check that") into explicit tool parameters
 * 4. Synthesizes natural conversational responses from structured tool outputs
 * 5. Strictly enforces grounding invariants (never claims mutations unless tool evidence exists)
 */

import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import { llmChatStream, llmChat } from '../../services/llmGateway.js';
import { SUPERVISOR_TOOL_SCHEMAS, executeSupervisorTool } from './supervisorTools.js';
import { assembleConversationContext, contextToSystemPrompt } from './conversationContext.js';
import { getScopedJarvisMemoryContext } from './coreMemory.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import * as executionState from '../../services/executionState.js';

export function isSupervisorV2Enabled(req?: any): boolean {
  if (process.env.JARVIS_SUPERVISOR_V2 === 'true') return true;
  if (req?.body?.supervisorV2 === true || req?.body?.supervisorV2 === 'true') return true;
  if (req?.headers?.['x-jarvis-supervisor-v2'] === 'true') return true;
  return false;
}

export interface SupervisorStreamOptions {
  conversationId: string;
  prompt: string;
  workspacePath?: string;
  approvalPolicy?: 'manual' | 'auto';
  operationId?: string;
  inputChannel?: string;
  overrideProvider?: string | null;
  overrideModel?: string | null;
  fallbackModel?: string;
  selectedProvider?: string;
  selectedModel?: string;
  fallbackProvider?: string;
}

interface ParsedToolCall {
  name: string;
  parameters: Record<string, any>;
  raw: string;
}

/**
 * Extract tool calls from model output if present.
 * Supports <tool_call>{"name": "...", "parameters": {...}}</tool_call>,
 * unclosed <tool_call> blocks, markdown code fences, or embedded JSON tool objects.
 */
export function extractToolCall(text: string): ParsedToolCall | null {
  if (!text) return null;

  // 1. Check <tool_call>... (with or without closing </tool_call>)
  const tagRegex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|<tool_call>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;
    const jsonMatch = inner.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0].trim());
        const name = parsed.name || parsed.tool;
        const parameters = parsed.parameters || parsed.arguments || parsed.params || {};
        if (name && typeof name === 'string') {
          return { name, parameters, raw: match[0] };
        }
      } catch {}
    }
  }

  // 2. Check markdown code fence with tool call
  const fenceMatch = text.match(/```(?:json|tool_call)?\s*(\{[\s\S]*?"(?:tool|name)"[\s\S]*?\})\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      const name = parsed.name || parsed.tool;
      const parameters = parsed.parameters || parsed.arguments || parsed.params || {};
      if (name && typeof name === 'string') {
        return { name, parameters, raw: fenceMatch[0] };
      }
    } catch {}
  }

  // 3. Raw JSON containing "name" or "tool" with parameters
  const objMatch = text.match(/\{\s*"(?:name|tool)"\s*:\s*"[^"]+"\s*,\s*"(?:parameters|arguments|params)"\s*:\s*\{[\s\S]*?\}\s*\}/i);
  if (objMatch && objMatch[0]) {
    try {
      const parsed = JSON.parse(objMatch[0].trim());
      const name = parsed.name || parsed.tool;
      const parameters = parsed.parameters || parsed.arguments || parsed.params || {};
      if (name && typeof name === 'string') {
        return { name, parameters, raw: objMatch[0] };
      }
    } catch {}
  }

  // 4. Raw JSON starting with {"name": "..."} or {"tool": "..."}
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}') && (trimmed.includes('"name"') || trimmed.includes('"tool"'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const name = parsed.name || parsed.tool;
      const parameters = parsed.parameters || parsed.arguments || parsed.params || {};
      if (name && typeof name === 'string') {
        return { name, parameters, raw: trimmed };
      }
    } catch {}
  }

  return null;
}

/**
 * Build rich system prompt for the Jarvis Supervisor.
 */
export async function buildSupervisorSystemPrompt(
  conversationId: string,
  userPrompt: string,
  workspacePath?: string,
  options: { approvalPolicy?: 'manual' | 'auto'; inputChannel?: string } = {}
): Promise<string> {
  const effectiveWorkspace = workspacePath || (await getWorkspaceRoot()) || undefined;

  // 1. Memory Context (if scoped/relevant)
  let memoryContext = '';
  try {
    const mem = await getScopedJarvisMemoryContext(userPrompt, effectiveWorkspace);
    if (mem) {
      memoryContext = `\n\nSTRUCTURED CORE MEMORY:\n${mem}`;
    }
  } catch {}

  const workspaceContext = effectiveWorkspace ? `Active workspace: ${effectiveWorkspace}` : '';

  return [
    'You are Jarvis, the conversational supervisor and AI partner in Agentic OS.',
    '',
    '## CORE ARCHITECTURE & ROLES',
    '- You are the conversational identity and primary reasoning intelligence of Agentic OS.',
    '- You DO NOT edit code or run destructive terminal commands directly. You delegate implementation and debugging to CodeX.',
    '- You delegate deep planning, research, architectural analysis, and multi-agent coordination to Hermes.',
    '- You delegate verification and auditing to Argus.',
    '',
    '## CONVERSATIONAL STYLE & GROUNDING INVARIANTS',
    '1. Answer immediately in short, natural, conversational sentences. Do NOT repeat the user question back to them.',
    '2. NEVER address the user with military or subordinate titles (such as "commander" or "boss"), and NEVER start responses with monitoring jargon or status boilerplate.',
    '3. Do NOT append generic customer service sign-offs (e.g. "Is there anything else I can help you with today?") to your answers.',
    '4. For greetings ("you there?", "hey", "good morning"), answer with natural warmth and brevity (e.g. "Hey! I\'m here and ready.").',
    '5. For math, factual, or simple queries (e.g. "what is 2 plus 2", "tell me a joke"), answer directly and concisely.',
    '6. SYSTEM HEALTH: When asked about system status, summarize the outcome naturally in plain English without printing raw JSON.',
    '7. GROUNDING INVARIANT: NEVER claim you modified a file, fixed a bug, ran tests, or deployed changes unless an actual tool execution confirms it.',
    '8. REFERENT RESOLUTION: When the user says "Do that", "Fix it", "Check that", "Continue", or "Ask CodeX to check that", resolve the pronoun from the previous conversation turns into an EXPLICIT, DETAILED objective before delegating.',
    '9. MODEL IDENTITY: When asked what model, provider, or architecture you are using, state clearly and concisely: "I\'m using the local Ollama qwen2.5:7b model."',
    '',
    '## AVAILABLE SUPERVISOR TOOLS',
    'You can call tools when needed by outputting a tool call block formatted exactly as:',
    '<tool_call>',
    '{"name": "tool_name", "parameters": { ... }}',
    '</tool_call>',
    '',
    'Available tools:',
    '- get_system_health({ component?: "gateways"|"tasks"|"all" }): Check health of gateways and active tasks',
    '- delegate_hermes_task({ objective: string, context?: string }): Queue deep planning or research to Hermes',
    '- delegate_codex_goal({ goal: string, context?: string, targetFiles?: string[], approvalRequired?: boolean }): Queue code inspection, debugging, or fixes to CodeX',
    '- recall_memory({ query: string }): Search persistent memory',
    '- get_current_work({ scope?: "active"|"recent"|"all" }): Query active and recent background work',
    '',
    'If the user is asking a conversational question or greeting that requires no tools, reply directly with your text message without any <tool_call> tag.',
    workspaceContext,
    memoryContext,
    options.inputChannel === 'voice' ? '\nInput channel: microphone transcription.' : ''
  ].filter(Boolean).join('\n');
}

/**
 * Retrieve recent clean conversation history.
 */
export async function getCleanConversationHistory(
  conversationId: string,
  currentPrompt: string,
  maxTurns = 12
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const msgs = await conversationService.getMessages(conversationId);
    const arr = Array.isArray(msgs) ? msgs : [];
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (let i = arr.length - 1; i >= 0 && history.length < maxTurns; i--) {
      const m = arr[i];
      if (!m || m.role === 'system' || m.messageType === 'system_status' || m.messageType === 'diagnostics') continue;
      const content = typeof m.content === 'string' ? m.content.trim() : '';
      if (!content) continue;
      if (content.includes('offline mode. No external model is reachable')) continue;
      if (m.role === 'user' && content === currentPrompt && i === arr.length - 1) continue; // skip current turn

      history.unshift({
        role: m.role === 'agent' ? 'assistant' : 'user',
        content
      });
    }
    return history;
  } catch (err) {
    logger.warn('[SupervisorLoop] Error loading history', err);
    return [];
  }
}

/**
 * Executes the supervisor turn and streams SSE events to the response.
 */
export async function handleSupervisorV2Stream(
  req: any,
  res: any,
  opts: SupervisorStreamOptions
): Promise<void> {
  const {
    conversationId,
    prompt,
    workspacePath,
    approvalPolicy = 'manual',
    operationId = `sup-${Date.now()}`,
    inputChannel,
    overrideProvider,
    overrideModel,
    selectedProvider = 'OpenRouter',
    selectedModel = 'auto',
    fallbackProvider = 'ollama',
    fallbackModel = 'llama3.2:3b'
  } = opts;

  const writeSse = (event: string, data: any) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.flush?.();
    }
  };

  const startedAt = Date.now();
  logger.info('[JarvisPipeline] PIPELINE=JARVIS SUPERVISOR V2', { conversationId, prompt, operationId });
  logger.info('[SupervisorV2] Beginning supervisor turn', { conversationId, prompt, operationId });

  // 0. Deterministic Language Switch Intercept
  const { detectLanguageSwitchRequest, setConversationLanguage, buildLanguageSwitchConfirmation } = await import('./conversationLanguage.js');
  const langReq = detectLanguageSwitchRequest(prompt);
  if (langReq.isLanguageSwitch && langReq.targetLanguage) {
    const mutationResult = setConversationLanguage(conversationId, langReq.targetLanguage);
    const reply = mutationResult.success
      ? buildLanguageSwitchConfirmation(mutationResult.activeLanguage)
      : `Failed to switch language to ${langReq.targetLanguage}. Current language is ${mutationResult.activeLanguage}.`;

    writeSse('intent', {
      type: 'language_preference',
      route: 'language_preference',
      mode: 'conversational_supervisor',
      confidence: 1.0,
      reason: langReq.reason,
      language: mutationResult.activeLanguage,
      operationId,
    });

    await conversationService.appendMessage({
      conversationId,
      role: 'user',
      content: prompt,
      metadata: { operationId, inputChannel, supervisorV2: true },
    });

    const parts = reply.match(/.{1,140}(?:\s|$)/g) || [reply];
    for (const p of parts) {
      if (p) writeSse('chunk', { delta: p, operationId, provider: 'agentic-os', model: 'language-manager' });
    }

    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: reply,
      routedAgent: 'jarvis',
      metadata: {
        operationId,
        provider: 'agentic-os',
        model: 'language-manager',
        language: mutationResult.activeLanguage,
        actionVerified: mutationResult.success,
        supervisorV2: true,
      },
    });

    writeSse('done', {
      route: 'language_preference',
      category: 'conversation',
      status: 'completed',
      operationId,
      provider: 'agentic-os',
      model: 'language-manager',
      language: mutationResult.activeLanguage,
      actionVerified: mutationResult.success,
      totalMs: Date.now() - startedAt,
    });

    return res.end();
  }

  const { getConversationLanguage } = await import('./conversationLanguage.js');
  const convLang = getConversationLanguage(conversationId) as 'en' | 'de' | 'ro';

  // 1. Deterministic Canonical Task Status Intercept
  const { isTaskStatusQuery, formatCanonicalSnapshotAnswer } = await import('./taskStatusFormatter.js');
  if (isTaskStatusQuery(prompt)) {
    const { getCanonicalTaskSnapshot } = await import('../../services/backgroundTasks/canonicalSnapshot.js');
    const snap = getCanonicalTaskSnapshot();

    const reply = formatCanonicalSnapshotAnswer(snap, convLang || 'en');

    writeSse('intent', {
      type: 'task_status',
      route: 'task_status',
      mode: 'conversational_supervisor',
      confidence: 1.0,
      reason: 'Deterministic Canonical Task Status Answer',
      operationId
    });

    await conversationService.appendMessage({
      conversationId,
      role: 'user',
      content: prompt,
      metadata: { operationId, inputChannel, supervisorV2: true }
    });

    const parts = reply.match(/.{1,140}(?:\s|$)/g) || [reply];
    for (const p of parts) {
      if (p) writeSse('chunk', { delta: p, operationId, provider: 'agentic-os', model: 'canonical-snapshot' });
    }

    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: reply,
      routedAgent: 'jarvis',
      metadata: {
        operationId,
        provider: 'agentic-os',
        model: 'canonical-snapshot',
        intent: { type: 'task_status', mode: 'direct_conversation' },
        snapshot: snap,
        supervisorV2: true
      }
    });

    writeSse('done', {
      route: 'task_status_answer',
      category: 'context',
      status: 'completed',
      operationId,
      provider: 'agentic-os',
      model: 'canonical-snapshot',
      totalMs: Date.now() - startedAt
    });

    return res.end();
  }

  // 2. Initial SSE Intent
  writeSse('intent', {
    type: 'supervisor_turn',
    route: 'supervisor_v2',
    mode: 'conversational_supervisor',
    pipeline: 'JARVIS SUPERVISOR V2',
    confidence: 1.0,
    operationId
  });

  writeSse('thinking', { action: 'Evaluating request…', operationId });

  // 3. Append User Message
  await conversationService.appendMessage({
    conversationId,
    role: 'user',
    content: prompt,
    metadata: { operationId, inputChannel, supervisorV2: true }
  });

  // 4. Assemble Context & History
  const [systemPrompt, history] = await Promise.all([
    buildSupervisorSystemPrompt(conversationId, prompt, workspacePath, { approvalPolicy, inputChannel }),
    getCleanConversationHistory(conversationId, prompt)
  ]);

  // 5. First LLM Pass (Decision & Tool Call or Direct Answer)
  let initialReply = '';
  let activeEffProvider = selectedProvider;
  let activeEffModel = selectedModel;

  try {
    const firstPass = await llmChat({
      systemPrompt,
      prompt,
      history,
      agentId: 'agent-jarvis',
      provider: overrideProvider || undefined,
      model: overrideModel || undefined,
      timeoutMs: 120000,
      requestId: operationId
    });
    initialReply = firstPass.reply || '';
    if (firstPass.provider && firstPass.provider !== 'offline') {
      activeEffProvider = firstPass.provider;
    }
    if (firstPass.model) {
      activeEffModel = firstPass.model;
    }
  } catch (err: any) {
    logger.error('[SupervisorV2] LLM invocation failed', err);
    const errMsg = 'I encountered an issue connecting to my reasoning model. Please check the model gateway status.';
    writeSse('error', { error: String(err?.message || err), provider: activeEffProvider, model: activeEffModel, operationId });
    writeSse('chunk', { delta: errMsg, operationId, provider: activeEffProvider, model: activeEffModel });
    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: errMsg,
      routedAgent: 'jarvis',
      metadata: { operationId, error: String(err) }
    });
    writeSse('done', { route: 'supervisor_v2', status: 'error', operationId, provider: activeEffProvider, model: activeEffModel });
    return res.end();
  }

  // 6. Tool Call Detection
  const toolCall = extractToolCall(initialReply);

  if (!toolCall) {
    // Direct conversational response (No tool required)
    // Clean any accidental XML artifacts
    let rawClean = initialReply
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .replace(/<tool_call>[\s\S]*/gi, '')
      .replace(/<invoke>[\s\S]*?<\/invoke>/gi, '')
      .trim();

    if (!rawClean) {
      rawClean = initialReply.trim() || "I am ready and listening. How can I help you today?";
    }

    // Apply grounding guardrail sanitization (action promises / repetition / false completions)
    const { sanitizeDirectResponse } = await import('./groundingGuardrail.js');
    const cleanReply = sanitizeDirectResponse(rawClean, {
      prompt,
      hasGroundedEvidence: false,
      hasExecutionEvidence: false,
    });

    // Stream text in chunks
    const parts = cleanReply.match(/.{1,140}(?:\s|$)/g) || [cleanReply];
    for (const p of parts) {
      if (p) writeSse('chunk', { delta: p, operationId, provider: activeEffProvider, model: activeEffModel });
    }

    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: cleanReply,
      routedAgent: 'jarvis',
      metadata: {
        operationId,
        provider: activeEffProvider,
        model: activeEffModel,
        intent: { type: 'conversation', mode: 'direct_conversation' },
        supervisorV2: true
      }
    });

    writeSse('done', {
      route: 'direct',
      category: 'conversation',
      status: 'completed',
      language: convLang,
      operationId,
      provider: activeEffProvider,
      model: activeEffModel,
      totalMs: Date.now() - startedAt
    });

    return res.end();
  }


  // 6. Tool Execution
  logger.info('[SupervisorV2] Executing supervisor tool call', { tool: toolCall.name, params: toolCall.parameters });
  writeSse('status', {
    state: 'executing',
    currentAction: `Executing ${toolCall.name}…`,
    operationId
  });

  let toolResult: any;
  let toolError: string | null = null;
  try {
    toolResult = await executeSupervisorTool(toolCall.name, toolCall.parameters, {
      conversationId,
      workspacePath
    });
  } catch (err: any) {
    toolError = err?.message || String(err);
    logger.warn('[SupervisorV2] Tool execution error', { tool: toolCall.name, error: toolError });
    toolResult = { error: toolError, success: false };
  }

  // Emit intention if a task was created
  if (toolCall.name === 'delegate_codex_goal') {
    writeSse('intent', {
      type: 'worker_delegation',
      route: 'codex',
      worker: 'codex',
      taskId: toolResult?.taskId,
      status: toolResult?.status,
      operationId
    });
  } else if (toolCall.name === 'delegate_hermes_task') {
    writeSse('intent', {
      type: 'worker_delegation',
      route: 'hermes',
      worker: 'hermes',
      taskId: toolResult?.taskId,
      status: toolResult?.status,
      operationId
    });
  }

  // 7. Second LLM Pass (Natural Conversational Synthesis)
  const synthesisPrompt = [
    `User Request: "${prompt}"`,
    '',
    `Tool Executed: ${toolCall.name}`,
    `Tool Input: ${JSON.stringify(toolCall.parameters)}`,
    `Tool Structured Result:`,
    JSON.stringify(toolResult, null, 2),
    '',
    'INSTRUCTION:',
    '- Provide a natural, concise, conversational response to the user explaining the result.',
    '- If this was a health/system query, explain the status conversationally (e.g. "Everything is running smoothly" or "Hermes is currently unreachable"). Do NOT dump raw JSON or telemetry lists unless requested.',
    '- If a task was delegated to CodeX or Hermes, confirm that the task was queued/started. Do NOT claim the task has completed.',
    '- If the tool reported an error, explain the situation truthfully without fabricating success.',
    '- Do NOT output any XML tags or <tool_call> blocks in this response.'
  ].join('\n');

  let finalReply = '';
  try {
    const secondPass = await llmChat({
      systemPrompt,
      prompt: synthesisPrompt,
      history,
      agentId: 'agent-jarvis',
      provider: overrideProvider || undefined,
      model: overrideModel || undefined,
      timeoutMs: 120000,
      requestId: operationId
    });
    finalReply = secondPass.reply || '';
    if (secondPass.provider && secondPass.provider !== 'offline') {
      activeEffProvider = secondPass.provider;
    }
    if (secondPass.model) {
      activeEffModel = secondPass.model;
    }
  } catch (err) {
    // Fallback synthesis if second LLM pass fails
    finalReply = toolResult?.message || `I executed ${toolCall.name}, but encountered an issue formulating the final summary.`;
  }

  let rawFinal = finalReply
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*/gi, '')
    .replace(/<invoke>[\s\S]*?<\/invoke>/gi, '')
    .trim();

  if (!rawFinal) {
    rawFinal = toolResult?.message || (toolResult ? JSON.stringify(toolResult) : `Execution of ${toolCall.name} completed.`);
  }

  const { sanitizeDirectResponse } = await import('./groundingGuardrail.js');
  const cleanFinalReply = sanitizeDirectResponse(rawFinal, {
    prompt,
    hasGroundedEvidence: Boolean(toolResult && !toolResult.error),
    hasExecutionEvidence: Boolean(toolResult && !toolResult.error),
    groundedResult: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
  });


  // Stream synthesis chunks
  const parts = cleanFinalReply.match(/.{1,140}(?:\s|$)/g) || [cleanFinalReply];
  for (const p of parts) {
    if (p) writeSse('chunk', { delta: p, operationId, provider: activeEffProvider, model: activeEffModel });
  }

  await conversationService.appendMessage({
    conversationId,
    role: 'agent',
    content: cleanFinalReply,
    routedAgent: 'jarvis',
    metadata: {
      operationId,
      provider: activeEffProvider,
      model: activeEffModel,
      toolCall: {
        name: toolCall.name,
        parameters: toolCall.parameters,
        result: toolResult
      },
      supervisorV2: true
    }
  });

  writeSse('done', {
    route: toolCall.name.startsWith('delegate') ? 'worker_delegation' : 'supervisor_v2',
    category: toolCall.name,
    status: toolResult?.status || 'completed',
    language: convLang,
    taskId: toolResult?.taskId,
    operationId,
    provider: activeEffProvider,
    model: activeEffModel,
    totalMs: Date.now() - startedAt
  });

  return res.end();
}

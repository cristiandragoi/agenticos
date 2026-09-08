import path from 'node:path';
import { logger } from '../../utils/logger.js';
import { toolRegistry } from './toolRegistry.js';
import { runStore } from '../runStore.js';
import { ExecutionOptions } from '../../types.js';
import { AgentProviderAssignmentService } from './assignments.js';

/**
 * Agent Loop — the core function-calling agent loop.
 *
 * Uses a multi-provider failover chain (same as executeWithFailover
 * but extended for function-calling).
 */

/* ─── Message Types ─── */

type Role = 'system' | 'user' | 'assistant' | 'tool';

interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

/* ─── Provider Config ─── */

interface ProviderConfig {
  name: string;
  url: string;
  model: string;
  key: string | undefined;
}

function getProviders(systemPrompt?: string, agentName?: string): ProviderConfig[] {
  const isHeavy = systemPrompt?.toLowerCase().includes('code') || 
                  systemPrompt?.toLowerCase().includes('fugu') || 
                  systemPrompt?.toLowerCase().includes('fusion') ||
                  systemPrompt?.toLowerCase().includes('reasoning') ||
                  systemPrompt?.toLowerCase().includes('pipeline');

  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.OMNIROUTE_API_KEY;
  const openRouterBase = process.env.OPENROUTER_BASE_URL || process.env.OMNIROUTE_BASE_URL || 'https://openrouter.ai/api/v1';
  const openRouterModel = process.env.OPENROUTER_MODEL || process.env.OMNIROUTE_MODEL || 'poolside/laguna-s-2.1:free';
  const openRouterProvider = openRouterKey ? [{
    name: 'OpenRouter',
    url: openRouterBase + '/chat/completions',
    model: openRouterModel,
    key: openRouterKey,
  }] : [];

  let realProviders = [
    ...openRouterProvider,
    { name: 'Fugu Ultra', url: 'https://api.sakana.ai/v1/chat/completions', model: 'fugu-ultra-20260615', key: process.env.FUGU_API_KEY },
    { name: 'Fusion', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/fusion-large', key: process.env.FUSION_API_KEY },
    { name: 'Qwable 27B Coder', url: 'http://localhost:8642/v1/chat/completions', model: 'qwable-27b-coder', key: process.env.QWABLE_API_KEY || 'qwable' },
    // ── Local Ollama Coding Models ──────────────────────────────────────────
    { name: 'Qwen2.5-Coder 14B', url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions', model: 'qwen2.5-coder:14b', key: 'ollama' },
    { name: 'DeepSeek Coder V2 16B', url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions', model: 'deepseek-coder-v2:16b', key: 'ollama' },
    // ── Local Ollama General Models ─────────────────────────────────────────
    { name: 'Qwen 3.8', url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions', model: 'qwen3.8:latest', key: process.env.OLLAMA_API_KEY || 'ollama' },
    { name: 'Qwythos 9B', url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions', model: 'qwythos:9b', key: process.env.QWYTHOS_API_KEY || 'qwythos' },
    { name: 'Ollama (Local)', url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions', model: process.env.OLLAMA_MODEL || 'qwen3.5:27b-hermes-64k', key: process.env.OLLAMA_API_KEY || 'ollama' },
    // ── Remote Providers ────────────────────────────────────────────────────
    { name: 'OpenRouter Fallback', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', key: process.env.OPENROUTER_API_KEY },
    { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', key: process.env.DEEPSEEK_API_KEY },
    { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', key: process.env.GROQ_API_KEY },
  ].filter(p => !!p.key);


  if (!isHeavy) {
    // For light tasks, prefer Groq after OpenRouter — but OpenRouter always stays first
    realProviders = realProviders.sort((a, b) => {
      if (a.name === 'OpenRouter') return -1;
      if (b.name === 'OpenRouter') return 1;
      if (a.name === 'Groq') return -1;
      if (b.name === 'Groq') return 1;
      return 0;
    });
  }

  const isHermesStudio = systemPrompt?.includes('CONTEXT: hermes-studio');
  if (isHermesStudio && !isHeavy) {
    // Fast config questions: use OpenRouter and Groq.
    realProviders = realProviders.filter(p => p.name === 'OpenRouter' || p.name === 'Groq' || p.name === 'OpenRouter Fallback');
  }

  // Sort based on explicit agent selection (prioritize them, but keep fallbacks)
  if (agentName) {
    const nameLower = agentName.toLowerCase();
    const prioritize = (keyword: string) => {
      const matches = realProviders.filter(p => p.name.toLowerCase().includes(keyword));
      const others = realProviders.filter(p => !p.name.toLowerCase().includes(keyword));
      realProviders = [...matches, ...others];
    };
    
    if (nameLower.includes('qwythos')) {
      prioritize('qwythos');
    } else if (nameLower.includes('qwable')) {
      prioritize('qwable');
    } else if (nameLower.includes('fugu')) {
      prioritize('fugu');
    } else if (nameLower.includes('fusion')) {
      prioritize('fusion');
    } else if (nameLower.includes('codex') || nameLower.includes('code')) {
      // CodeX and coding-oriented agents: prefer local Qwen2.5-Coder, then DeepSeek Coder, then OmniRoute
      // Local coding models have zero cost and full privacy — they run entirely on-device
      prioritize('qwen2.5-coder');
    } else if (nameLower.includes('hermes')) {
      // Hermes local operation prefers Qwen 3.8 (Ollama)
      prioritize('qwen 3.8');
    }
  }

  // If no real API keys are configured, return a simulated provider so runs
  // always progress through their lifecycle (queued → running → completed)
  // instead of failing with "No configured AI providers found."
  if (realProviders.length === 0) {
    logger.warn('[AgentLoop] No API keys found — using simulated provider for run lifecycle');
    return [{
      name: 'Simulated',
      url: 'http://localhost:9999/simulated',
      model: 'simulated-response',
      key: 'simulated',
    }];
  }

  return realProviders;
}

/* ─── Context & Tool Budgeting Helpers ─── */

/**
 * Bounds raw tool output to prevent prompt overflow while preserving
 * structured errors, leading lines, and truncation provenance.
 */
export function truncateToolOutput(result: string, maxChars: number = 2500): string {
  if (!result || result.length <= maxChars) return result;

  // Preserve concise error payloads untouched if within reasonable bound
  try {
    const parsed = JSON.parse(result);
    if (parsed.error && typeof parsed.error === 'string' && result.length < maxChars * 1.5) {
      return result;
    }
  } catch {
    // not JSON
  }

  const keepHead = Math.floor(maxChars * 0.75);
  const keepTail = Math.floor(maxChars * 0.20);
  const head = result.slice(0, keepHead);
  const tail = result.slice(-keepTail);

  return `${head}\n\n... [Result truncated: ${result.length} characters total. Showing first ${keepHead} and last ${keepTail} chars] ...\n\n${tail}`;
}

/**
 * Compacts conversation history for multi-turn agents to stay within context
 * budgets while strictly preserving tool-call to tool-result pairing invariants.
 */
export function compactMessageHistory(
  messages: ChatMessage[],
  maxTotalChars: number = 9000
): ChatMessage[] {
  if (messages.length <= 3) return messages;

  const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length, 0);
  if (totalChars <= maxTotalChars) return messages;

  // Identify index of the most recent assistant message with tool_calls
  let lastAssistantToolIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].tool_calls && messages[i].tool_calls!.length > 0) {
      lastAssistantToolIdx = i;
      break;
    }
  }

  return messages.map((m, idx) => {
    // Retain system instructions (0) and initial user prompt (1) intact
    if (idx <= 1) return m;

    // Retain newest active turn's tool messages intact
    if (lastAssistantToolIdx !== -1 && idx >= lastAssistantToolIdx) return m;

    // Compact older tool message payloads to concise summaries
    if (m.role === 'tool' && m.content && m.content.length > 250) {
      const firstLine = m.content.split('\n')[0].slice(0, 120);
      return {
        ...m,
        content: `${firstLine} ... [Prior tool output compacted (${m.content.length} chars)]`
      };
    }

    return m;
  });
}

/* ─── LLM Call ─── */

async function callLLM(
  messages: ChatMessage[],
  toolsAvailable: boolean,
  providerIndex: number = 0,
  systemPrompt?: string,
  agentName?: string,
  executionOptions?: ExecutionOptions
): Promise<{ message: ChatMessage; provider: string; model: string }> {
  let providers: ProviderConfig[] = [];
  const resolvedAgentId = agentName === 'codex' ? 'agent-codex' : agentName;

  // Explicit per-request provider/model override (e.g. Hermes Studio model
  // picker) wins over stored assignments and the default provider chain.
  // The pinned single-entry list inherently honours disableFallback — there
  // are no failover candidates to fall back to.
  if (executionOptions?.providerOverride) {
    const requested = executionOptions.providerOverride.toLowerCase();
    if (requested === 'ollama') {
      providers = [{
        name: 'Ollama',
        url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions',
        model: executionOptions.modelOverride || process.env.OLLAMA_MODEL || 'qwen3.5:27b-hermes-64k',
        key: process.env.OLLAMA_API_KEY || 'ollama',
      }];
    } else {
      const allProviders = getProviders(undefined, agentName);
      const matched = allProviders.find((p) => p.name.toLowerCase() === requested) ||
                      allProviders.find((p) => p.name.toLowerCase().includes(requested));
      if (matched) {
        providers = [{ ...matched, model: executionOptions.modelOverride || matched.model }];
      }
    }
  }

  if (providers.length === 0 && resolvedAgentId) {
    const assignment =
      await AgentProviderAssignmentService.getAssignment(resolvedAgentId);

    if (
      assignment &&
      assignment.enabled &&
      assignment.routingMode !== 'automatic'
    ) {
      const availableProviders = getProviders(systemPrompt, agentName);

      const canonicalProviderId =
        assignment.providerId === 'prov-ollama'
          ? 'ollama'
          : assignment.providerId.replace(/^prov-/, '').toLowerCase();

      const matchedProvider = availableProviders.find((provider) => {
        const providerName = provider.name.toLowerCase();
        const providerUrl = provider.url.toLowerCase();

        if (canonicalProviderId === 'ollama') {
          return providerUrl.includes('11434');
        }

        return providerName.includes(canonicalProviderId);
      });

      if (matchedProvider) {
        providers = [
          {
            ...matchedProvider,
            model: assignment.modelId || matchedProvider.model,
          },
        ];
      }
    }
  }

  if (providers.length === 0) {
    providers = getProviders(systemPrompt, agentName);
  }

  if (providers.length === 0) throw new Error('No configured AI providers found. Check your API keys.');

  let lastError = '';

  // Try all providers starting from providerIndex, then wrap around
  for (let i = 0; i < providers.length; i++) {
    const idx = (providerIndex + i) % providers.length;
    const p = providers[idx];

    // Skip providers that don't support function calling for tool calls
    // Groq supports function calling. Gemini OpenAI-compat endpoint may not.
    // We try all and fall through on 400 errors.

    const sanitizedMessages = messages.map(m => ({ ...m, content: m.content ?? '' }));

    const body: Record<string, unknown> = {
      model: p.model,
      messages: sanitizedMessages,
      max_tokens: 4096,
      temperature: 0.7,
    };

    // Simulated provider — return a canned response without making an HTTP call
    if (p.name === 'Simulated') {
      logger.info('[AgentLoop] Using simulated response');
      const simContent = `I've processed your request. Since no external API keys are configured, I'm running in simulation mode.\n\nYour input: "${messages.find(m => m.role === 'user')?.content || ''}"\n\nTo get real AI responses, add API keys (OPENROUTER_API_KEY, DEEPSEEK_API_KEY, or GROQ_API_KEY) to server/.env and restart the server.`;
      return {
        message: { role: 'assistant' as const, content: simContent },
        provider: 'Simulated',
        model: 'local-fallback',
      };
    }

    if (toolsAvailable) {
      body.tools = toolRegistry.getToolSchemas() as unknown as unknown[];
      // Force tool use on first iteration to avoid generic chat responses
      body.tool_choice = messages.length <= 2 ? 'required' : 'auto';
    } else {
      delete body.tools;
      delete body.tool_choice;
    }

    const isHermesStudio = systemPrompt?.includes('CONTEXT: hermes-studio');
    const timeoutMs = isHermesStudio ? 4000 : (p.url.includes('11434') ? 120000 : 60000); // 120s for local LLMs with CPU offload

    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${p.key}`,
          ...(p.name === 'OpenRouter' ? { 'HTTP-Referer': 'http://localhost:4000' } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.warn(`[AgentLoop] ${p.name} failed (${res.status}): ${errText.slice(0, 200)}`);
        
        if (executionOptions?.modelOverride === 'qwen3.5:cloud' && (res.status === 402 || res.status === 403 || res.status === 429)) {
          throw new Error(`Provider Error (${res.status}): Ollama Cloud account limit reached or unauthorized.`);
        }

        lastError = `${p.name} failed (HTTP ${res.status}: Invalid request or rate limit)`;
        continue; // Try next provider
      }

      // OmniRoute always returns SSE (text/event-stream) even when stream is not requested.
      // Detect content-type and handle accordingly.
      const contentType = res.headers.get('content-type') || '';
      let data: any;

      if (contentType.includes('text/event-stream')) {
        // Parse SSE stream and assemble deltas into a complete response
        const sseText = await res.text();
        const lines = sseText.split('\n');
        let content = '';
        let finishReason: string | null = null;
        let toolCalls: any[] = [];
        let actualModel = p.model;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) content += delta.content;
            if (chunk.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
            if (chunk.model) actualModel = chunk.model;
            // Accumulate tool call deltas
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
                }
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch { /* skip malformed chunk */ }
        }

        // Build synthetic response in standard OpenAI format
        const toolCallsFiltered = toolCalls.filter(tc => tc && tc.id && tc.function.name);
        data = {
          choices: [{
            message: {
              role: 'assistant',
              content: content || null,
              ...(toolCallsFiltered.length > 0 ? { tool_calls: toolCallsFiltered } : {}),
            },
            finish_reason: finishReason || 'stop',
          }],
          model: actualModel,
        };
        logger.info(`[AgentLoop] Parsed SSE stream from ${p.name} — model=${actualModel}, content=${content.length} chars, tools=${toolCallsFiltered.length}`);
      } else {
        data = await res.json();
      }

      const choice = data.choices?.[0];
      if (!choice) {
        lastError = `${p.name} failed: No choices in response`;
        continue;
      }

      const msg: ChatMessage = {
        role: 'assistant',
        content: choice.message?.content ?? '',
      };

      // Check for tool calls
      if (choice.message?.tool_calls) {
        msg.tool_calls = choice.message.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      if (p.name === 'OmniRoute') {
        const routedModel = data.model || p.model;
        logger.info(`[AgentLoop] Gateway: OmniRoute | launcher=chat | profile=auto | port=20128 | routed_to=${routedModel}`);
      } else {
        logger.info(`[AgentLoop] Using ${p.name} (${p.model}) — ${msg.tool_calls ? msg.tool_calls.length + ' tool calls' : 'final response'}`);
      }
      return { message: msg, provider: p.name, model: data.model || p.model };
    } catch (err: any) {
      logger.warn(`[AgentLoop] ${p.name} error: ${err.message}`);
      if (err.name === 'TimeoutError' || err.message.includes('timeout') || err.message.includes('aborted')) {
        lastError = `${p.name} failed due to Timeout`;
      } else if (err.message.includes('fetch') || err.message.includes('network')) {
        lastError = `${p.name} failed due to Network Error (${err.message})`;
      } else {
        lastError = `${p.name} failed: ${err.message}`;
      }
    }
  }

  // If we had a specific agent requested and all failed (or just timed out)
  if (agentName && lastError.includes('Timeout')) {
    throw new Error(`All providers failed. Last error: ${agentName} is timing out. Try selecting a different orchestrator (e.g. Jarvis or Local Qwen 3.5) in the dropdown.`);
  }

  throw new Error(`All providers failed. Last error: ${lastError}`);
}

/* ─── Result ─── */

export interface ToolEvent {
  toolName: string;
  toolCallId: string;
  iteration: number;
  success: boolean;
  arguments: Record<string, unknown>;
  output?: string;
}

export interface AgentLoopOptions {
  workspaceRoot?: string;
  onToolEvent?: (event: ToolEvent) => void;
  finalizeAfterTestCommand?: boolean;
}

export interface AgentRunResult {
  text: string;
  provider: string;
  model: string;
  toolCalls: number;
  iterations: number;
  completionStatus?: 'completed' | 'max_iterations' | 'failed';
  failureReason?: string;
  toolEvents?: ToolEvent[];
}

export function normalizeAgentFinalText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(?<=^|\s)__(.+?)__(?=\s|[.,:;!?]|$)/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .trim();
}

function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (/key|token|secret|auth|password/i.test(key)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = val;
    }
  }
  return redacted;
}

/* ─── MAIN LOOP ─── */

export async function runAgentLoop(
  systemPrompt: string,
  userMessage: string,
  maxIterations: number = 25,
  agentName?: string,
  runId?: string,
  executionOptions?: ExecutionOptions,
  _unused?: unknown,
  loopOptions?: AgentLoopOptions
): Promise<AgentRunResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let toolCalls = 0;
  let iterations = 0;
  let providerIndex = 0;
  let seenNudges = 0;
  const toolEvents: ToolEvent[] = [];
  let forceFinalizeNext = false;

  while (iterations < maxIterations) {
    iterations++;

    if (runId) {
      const currentRun = runStore.get(runId);
      if (currentRun && currentRun.events) {
        const nudges = currentRun.events
          .map(e => { try { return JSON.parse(e); } catch { return null; } })
          .filter(e => e && e.type === 'supervisor_nudge');
        
        if (nudges.length > seenNudges) {
          const newNudges = nudges.slice(seenNudges);
          seenNudges = nudges.length;
          
          const nudgeText = newNudges.map(n => `- ${n.payload}`).join('\n');
          messages.push({
            role: 'user',
            content: `Supervisor suggestions:\n${nudgeText}`
          });
          logger.info(`[AgentLoop] Injected ${newNudges.length} supervisor nudge(s) into context.`);
        }
      }
    }

    // Determine if tools are available (after first call, only if we just had tool calls)
    const hasTools = forceFinalizeNext ? false : toolRegistry.list().length > 0;
    const activeMessages = compactMessageHistory(messages);

    let response: { message: ChatMessage; provider: string; model: string };
    try {
      response = await callLLM(activeMessages, hasTools, providerIndex, systemPrompt, agentName, executionOptions);
      providerIndex = 0; // Reset for subsequent calls (first successful provider)
    } catch (err: any) {
      logger.error(`[AgentLoop] Fatal error at iteration ${iterations}:`, err.message);

      // Bubble up specific provider errors so they are visible in the chat UI
      if (executionOptions?.modelOverride === 'qwen3.5:cloud' && err.message.includes('Provider Error')) {
        throw err;
      }

      // Catch malformed tool use errors from the provider
      if (err.message.includes('tool_use_failed')) {
        return {
          text: "I couldn't use a tool for that request. I'll answer in text instead.",
          provider: 'error-fallback',
          model: 'N/A',
          toolCalls,
          iterations,
          completionStatus: 'failed',
          failureReason: err.message,
          toolEvents,
        };
      }

      // Catch all providers failed for Hermes Studio to avoid throwing
      const isHermesStudio = systemPrompt?.includes('CONTEXT: hermes-studio');
      if (isHermesStudio && err.message.includes('All providers failed')) {
        return {
          text: "I couldn't reach any providers in time for that request. Please try again or select a different provider.",
          provider: 'timeout-fallback',
          model: 'N/A',
          toolCalls,
          iterations,
          completionStatus: 'failed',
          failureReason: err.message,
          toolEvents,
        };
      }

      // If we have a partial conversation, try to return what we have
      if (messages.length > 2) {
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistant?.content) {
          return {
            text: lastAssistant.content,
            provider: 'partial',
            model: 'N/A',
            toolCalls,
            iterations,
            completionStatus: 'failed',
            failureReason: err.message,
            toolEvents,
          };
        }
      }
      throw err;
    }

    // Add assistant response to messages
    messages.push(response.message);

    // Check for tool calls
    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      for (const tc of response.message.tool_calls) {
        toolCalls++;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        // Workspace grounding
        if (loopOptions?.workspaceRoot) {
          const ws = loopOptions.workspaceRoot;
          if (tc.function.name === 'terminal') {
            if (!args.workdir) args.workdir = ws;
          } else if (tc.function.name === 'read_file' || tc.function.name === 'write_file' || tc.function.name === 'patch_file') {
            if (typeof args.path === 'string' && !path.isAbsolute(args.path)) {
              args.path = path.resolve(ws, args.path);
            }
          } else if (tc.function.name === 'search_files') {
            if (!args.path) args.path = ws;
          }
        }

        // Finalize after test command
        if (loopOptions?.finalizeAfterTestCommand) {
          if (
            tc.function.name === 'terminal' &&
            typeof args.command === 'string' &&
            /\b(?:test|vitest|jest|pytest|npm\s+test)\b/i.test(args.command)
          ) {
            forceFinalizeNext = true;
          }
        }

        logger.info(`[AgentLoop] Executing ${tc.function.name}(${JSON.stringify(args).slice(0, 100)})`);

        let isSuccess = true;
        let result: string;
        try {
          result = await toolRegistry.execute(tc.function.name, args);
        } catch (err: any) {
          isSuccess = false;
          result = JSON.stringify({ error: err.message });
        }

        const toolEvent: ToolEvent = {
          toolName: tc.function.name,
          toolCallId: tc.id,
          iteration: iterations,
          success: isSuccess,
          arguments: redactToolArgs(args),
          output: result,
        };
        toolEvents.push(toolEvent);

        if (loopOptions?.onToolEvent) {
          try {
            loopOptions.onToolEvent(toolEvent);
          } catch (callbackErr) {
            logger.warn('[AgentLoop] onToolEvent threw error:', callbackErr);
          }
        }

        // Bound tool result to prevent context explosion
        result = truncateToolOutput(result);

        messages.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result,
          name: tc.function.name,
        });
      }

      // Check if we should also include a text response alongside tool calls
      if (response.message.content) {
        // The LLM sometimes returns text + tool_calls. Keep it.
      }

      continue; // Go back to LLM with tool results
    }

    // No tool calls — this is the final response
    if (response.message.content) {
      const operationalRequest = /\b(?:git\s+(?:branch|status|diff|log)|package\.json|terminal|read(?:\s+the)?\s+(?:file|repository)|inspect(?:\s+the)?\s+repository|search\s+files|run\s+(?:the\s+)?tests?|read-only)\b/i.test(`${systemPrompt}\n${userMessage}`);
      if (operationalRequest && toolCalls === 0) {
        if (iterations < maxIterations) {
          messages.push({
            role: 'user',
            content: 'This is an operational task. Use the provided function tools now; Markdown or imagined shell commands do not count as execution.',
          });
          continue;
        }
        return {
          text: normalizeAgentFinalText(response.message.content),
          provider: response.provider,
          model: response.model,
          toolCalls,
          iterations,
          completionStatus: 'failed',
          failureReason: 'NO_REAL_TOOL_CALLS',
          toolEvents,
        };
      }
      const text = normalizeAgentFinalText(response.message.content);

      return {
        text,
        provider: response.provider,
        model: response.model,
        toolCalls,
        iterations,
        completionStatus: 'completed',
        toolEvents,
      };
    }

    // Empty response with no tool calls — edge case
    if (iterations >= maxIterations) break;
  }

  return {
    text: 'I reached the maximum number of iterations without a final answer. Please try a simpler request or rephrase.',
    provider: 'system',
    model: 'N/A',
    toolCalls,
    iterations,
    completionStatus: 'max_iterations',
    failureReason: 'MAX_AGENT_ITERATIONS_REACHED',
    toolEvents,
  };
}

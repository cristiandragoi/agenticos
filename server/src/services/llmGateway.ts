import { logger } from '../utils/logger.js';
/**
 * llmGateway.ts — Legacy LLM gateway shim wrapping the new Multi-Provider Gateway Router.
 */
import { loadGatewayConfig } from './gateway/config.js';
import { GatewayRouter } from './gateway/router.js';
import { ChatRequest, ChatResponse } from './gateway/types.js';

export interface LlmChatOptions {
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  ollamaTimeoutMs?: number;
  agentId?: string;
  jobId?: string;
  provider?: string;
  ollamaModel?: string;
  /** Explicit model override (routed via ChatRequest.modelId). */
  model?: string;
  /** Planning escalation: stronger sibling model for EMPTY_CONTENT retries. */
  escalationModel?: string;
  requestId?: string;
  disableFallback?: boolean;
  signal?: AbortSignal;
  onDiagnostic?: (event: LlmChatStreamChunk) => void;
  /** Prior conversation turns (excluding the current prompt). */
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export interface LlmChatResult {
  reply: string;
  provider: string; // Updated to be any string
  offline: boolean;
  model?: string;
  error?: string;
}

export interface LlmProbeResult {
  status: 'ok' | 'unreachable';
  provider: string;
  reachable: boolean;
  error?: string;
}

export interface OllamaProbeResult {
  reachable: boolean;
  models: string[];
  error?: string;
}

export interface LlmChatStreamChunk {
  type: string;
  content?: string;
  provider: string;
  model?: string;
  [key: string]: any; // Allow gateway events to pass through cleanly
}

export const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
export const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'auto';

export const OLLAMA_FALLBACK_MODEL = 'auto';
export const OLLAMA_DEFAULT_CODING_MODEL = 'auto';
export const OLLAMA_HEAVY_CODING_MODEL = 'deepseek-coder-v2:16b';

// Instantiate the global GatewayRouter instance for this legacy shim
let globalRouter: GatewayRouter | null = null;
function getGlobalRouter() {
  if (!globalRouter) {
    globalRouter = GatewayRouter.getInstance(loadGatewayConfig());
    globalRouter.onEvent((event) => {
      if (event.type === 'gateway.completed' || event.type === 'gateway.failed') {
        // logger.info(`[GatewayTrace] ${event.type}`, event);
      }
    });
  }
  return globalRouter;
}

function toGatewayRequest(opts: LlmChatOptions): ChatRequest {
  let taskProfile: ChatRequest['taskProfile'] = undefined;
  
  if (opts.provider === 'ollama' && opts.ollamaModel === 'deepseek-coder-v2:16b') {
    taskProfile = 'heavy_refactor';
  } else if (opts.provider === 'ollama' && opts.ollamaModel === 'auto') {
    taskProfile = 'tiny_summary';
  }
  
  return {
    systemPrompt: opts.systemPrompt,
    prompt: opts.prompt,
    history: opts.history,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    requestId: opts.requestId,
    taskProfile,
    agentId: opts.agentId,
    modelId: opts.model,
    escalationModel: opts.escalationModel
  };
}

export async function llmChat(opts: LlmChatOptions): Promise<LlmChatResult> {
  const req = toGatewayRequest(opts);
  let providerOverride: string | undefined = opts.provider;
  
  // Legacy mappings
  if (providerOverride === 'omniRoute') {
    providerOverride = 'omniroot';
  }

  try {
    const routingOpts: any = {};
    if (providerOverride) routingOpts.provider = providerOverride;
    if (opts.agentId) routingOpts.agentId = opts.agentId;
    
    const res = await getGlobalRouter().chat(req, Object.keys(routingOpts).length ? routingOpts : undefined);
    return {
      reply: res.reply,
      provider: res.provider,
      offline: false,
      model: res.model
    };
  } catch (err: any) {
    let message = err.message;
    try {
      const parsed = JSON.parse(err.message);
      message = parsed.message;
      if (parsed.attemptErrors && parsed.attemptErrors.length > 0) {
        message += ` | Errors: ${parsed.attemptErrors.map((e: any) => `${e.provider} [${e.category}]: ${e.message}`).join('; ')}`;
      }
    } catch {}
    
    return {
      reply: 'I am running in offline mode. No external model is reachable. Please start OmniRoute (`omniroute` in a terminal) or check your API keys in server/.env.',
      provider: 'offline',
      offline: true,
      error: message
    };
  }
}

export async function* llmChatStream(opts: LlmChatOptions): AsyncGenerator<LlmChatStreamChunk> {
  const req = toGatewayRequest(opts);
  let providerOverride: string | undefined = opts.provider;
  
  if (providerOverride === 'omniRoute') {
    providerOverride = 'omniroot';
  }

  try {
    const routingOpts: any = {};
    if (providerOverride) routingOpts.provider = providerOverride;
    if (opts.agentId) routingOpts.agentId = opts.agentId;
    
    // Final chunk contract: public consumers must receive exactly one final
    // `done` chunk, and it must be the LAST yielded chunk. The router yields
    // the provider's `done` chunk before its trailing `gateway.completed`
    // diagnostic, so buffer the done chunk here, keep forwarding every
    // diagnostic event unchanged, and release the done chunk only after the
    // router stream ends.
    let bufferedDone: LlmChatStreamChunk | null = null;

    for await (const chunk of getGlobalRouter().stream(req, Object.keys(routingOpts).length ? routingOpts : undefined)) {
      if (chunk.type === 'done') {
        bufferedDone = {
          type: 'done',
          content: chunk.content,
          provider: chunk.provider,
          model: chunk.model
        };
        continue;
      }

      if (chunk.type !== 'token' && chunk.type !== 'error') {
        // Gateway diagnostic event (selected/fallback/failed/completed/
        // rate_limited): forward to opts.onDiagnostic exactly once, then
        // yield the event unchanged. Never treated as a token.
        if (opts.onDiagnostic && typeof chunk.type === 'string' && chunk.type.startsWith('gateway.')) {
          try {
            opts.onDiagnostic(chunk as LlmChatStreamChunk);
          } catch (diagErr) {
            logger.warn('Error in llmChatStream onDiagnostic callback', diagErr);
          }
        }
        // Yield gateway events exactly as they are
        yield chunk as any;
        continue;
      }
      
      yield {
        type: chunk.type,
        content: chunk.content,
        provider: chunk.provider,
        model: chunk.model
      };
    }

    // Router stream ended normally: release the buffered done chunk last.
    // If the router terminated without a done chunk (mid-stream abort path),
    // synthesize a single final done so consumers always see exactly one.
    yield bufferedDone ?? { type: 'done', provider: 'offline' };
  } catch (err: any) {
    let message = err.message;
    try {
      const parsed = JSON.parse(err.message);
      message = parsed.message;
      if (parsed.attemptErrors && parsed.attemptErrors.length > 0) {
        message += ` | Errors: ${parsed.attemptErrors.map((e: any) => `${e.provider} [${e.category}]: ${e.message}`).join('; ')}`;
      }
    } catch {}
    
    yield {
      type: 'token',
      content: '\n[Stream Error: ' + message + ']',
      provider: 'offline',
    };
    yield {
      type: 'done',
      provider: 'offline',
    };
  }
}

export async function ollamaChat(opts: LlmChatOptions): Promise<LlmChatResult> {
  return llmChat({ ...opts, provider: 'ollama' });
}

export async function llmProbe(): Promise<LlmProbeResult> {
  const result = await getGlobalRouter().healthcheck('omniroot');
  return {
    status: result.reachable ? 'ok' : 'unreachable',
    provider: 'omniRoute',
    reachable: result.reachable,
    error: result.error
  };
}

export async function ollamaProbe(): Promise<OllamaProbeResult> {
  const result = await getGlobalRouter().healthcheck('ollama');
  return {
    reachable: result.reachable,
    models: [OLLAMA_FALLBACK_MODEL],
    error: result.error
  };
}

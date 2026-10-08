import { ModelGateway, ChatRequest, ChatResponse, ChatStreamChunk, ProviderDefinition } from '../types.js';
import { ProviderCredentialService } from '../credentials.js';

function parseOpenAiSsePayload(payload: string): { delta: string; model?: string } {
  if (!payload || payload === '[DONE]') return { delta: '' };
  try {
    const chunk = JSON.parse(payload);
    const delta = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || '';
    const model = chunk.model;
    return { delta, model };
  } catch {
    return { delta: '' };
  }
}

function parseOpenAiSseDelta(payload: string): string {
  return parseOpenAiSsePayload(payload).delta;
}

/**
 * Structured error for provider HTTP 429 responses. Retains the status code
 * and the Retry-After header value so the router can emit a rate-limit
 * diagnostic and continue fallback routing.
 */
export class ProviderRateLimitError extends Error {
  public readonly status = 429;
  public readonly retryAfter?: string;

  constructor(message: string, retryAfter?: string) {
    super(message);
    this.name = 'ProviderRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

/**
 * Per-attempt request signal: combine the caller's abort signal (client
 * cancel / stream stop) with a hard timeout.
 * Every provider request has a hard timeout so no request can wait forever.
 */
export function buildRequestSignal(req: ChatRequest): AbortSignal {
  const timeoutMs = req.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (req.signal) {
    return AbortSignal.any([req.signal, timeoutSignal]);
  }

  return timeoutSignal;
}

export class OpenAICompatibleGateway implements ModelGateway {
  name: string;
  definition: ProviderDefinition;

  constructor(def: ProviderDefinition) {
    this.name = def.name;
    this.definition = def;
  }

  public async healthcheck(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const dbKey = await ProviderCredentialService.getCredential(this.name);
      const apiKey = dbKey || this.definition.apiKey;
      const res = await fetch(`${this.definition.baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      });
      return { reachable: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err: any) {
      return { reachable: false, error: err.message };
    }
  }

  public async chat(req: ChatRequest): Promise<ChatResponse> {
    const primaryModel = req.routing?.modelId ?? req.modelId ?? this.definition.model;
    const fallbackModel = (req as any).fallbackModel || (primaryModel.includes('qwen') ? 'deepseek/deepseek-v4-flash' : undefined);
    const candidateModels = [primaryModel, ...(fallbackModel && fallbackModel !== primaryModel ? [fallbackModel] : [])];

    const messages = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
    if (req.history) for (const h of req.history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: 'user', content: req.prompt });

    const dbKey = await ProviderCredentialService.getCredential(this.name);
    const apiKey = dbKey || this.definition.apiKey;

    let lastError: Error | null = null;
    for (const rawModel of candidateModels) {
      const isDeepSeekDirect = this.definition.baseUrl.includes('deepseek.com');
      let model = rawModel;
      if (isDeepSeekDirect) {
        if (rawModel.includes('deepseek-v4-flash') || rawModel.includes('v4-flash') || rawModel === 'auto') {
          model = 'deepseek-chat';
        } else if (rawModel.startsWith('deepseek/')) {
          model = rawModel.replace('deepseek/', '');
        }
      }
      const isQwenMax = model.toLowerCase().includes('qwen3.8-max');
      const maxTokens = isQwenMax ? Math.min(req.maxTokens || 120, 120) : (req.maxTokens || 2048);

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const bodyPayload: any = {
            model: model,
            messages,
            max_tokens: maxTokens,
            temperature: 0
          };

          const res = await fetch(`${this.definition.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(bodyPayload),
            signal: buildRequestSignal(req)
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            if (res.status === 429) {
              throw new ProviderRateLimitError(`HTTP 429: ${body}`, res.headers.get('retry-after') ?? undefined);
            }
            throw new Error(`HTTP ${res.status}: ${body}`);
          }

          const data: any = await res.json();
          const reply = data.choices?.[0]?.message?.content || '';

          if (!reply || reply.trim().length === 0) {
            throw new Error(`Empty response from model ${model}`);
          }

          const promptTokens = data.usage?.prompt_tokens || 0;
          const completionTokens = data.usage?.completion_tokens || 0;
          const resolvedModel = data.model || model;

          return { 
            reply, 
            provider: this.name, 
            model: model, 
            offline: false,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            resolvedProvider: this.name,
            resolvedModel,
            requestedModel: model,
            requestedRoute: `${this.name}:${model}`
          };
        } catch (err: any) {
          if (req.signal?.aborted) throw err;
          const isTimeout =
            err?.name === 'TimeoutError' ||
            err?.cause?.name === 'TimeoutError' ||
            /timeout|aborted/i.test(err?.message || '') ||
            /timeout|aborted/i.test(err?.cause?.message || '');

          if (isTimeout) {
            lastError = new Error(`Provider timeout: request to ${this.name}/${model} exceeded ${req.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS}ms`);
            break;
          }
          lastError = err;
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 800));
            continue;
          }
        }
      }
    }

    throw lastError || new Error('All candidate models failed');
  }

  public async *stream(req: ChatRequest): AsyncGenerator<ChatStreamChunk> {
    const model = req.routing?.modelId ?? req.modelId ?? this.definition.model;
    const messages = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
    if (req.history) for (const h of req.history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: 'user', content: req.prompt });

    const dbKey = await ProviderCredentialService.getCredential(this.name);
    const apiKey = dbKey || this.definition.apiKey;
    let res: Response;
    const streamPayload: any = { 
      model: model, 
      messages, 
      max_tokens: req.maxTokens || 1024, 
      stream: true,
    };

    try {
      res = await fetch(`${this.definition.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(streamPayload),
        signal: buildRequestSignal(req)
      });
    } catch (fetchErr: any) {
      if (req.signal?.aborted) throw fetchErr;
      const isTimeout =
        fetchErr?.name === 'TimeoutError' ||
        fetchErr?.cause?.name === 'TimeoutError' ||
        /timeout|aborted/i.test(fetchErr?.message || '') ||
        /timeout|aborted/i.test(fetchErr?.cause?.message || '');

      if (isTimeout) {
        throw new Error(`Provider timeout: stream to ${this.name}/${model} exceeded ${req.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS}ms`);
      }
      throw fetchErr;
    }

    if (!res.ok) {
      if (res.status === 429) {
        throw new ProviderRateLimitError(`HTTP 429`, res.headers.get('retry-after') ?? undefined);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.body) throw new Error(`No response body`);

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    let rawBody = '';
    let sawSseData = false;

    const streamStart = Date.now();
    let ttftMs: number | undefined;
    let streamResolvedModel = model;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!sawSseData) rawBody += text;
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        sawSseData = true;
        const parsed = parseOpenAiSsePayload(trimmed.slice(5).trim());
        if (parsed.model) streamResolvedModel = parsed.model;
        if (parsed.delta) {
          if (ttftMs === undefined) {
            ttftMs = Date.now() - streamStart;
          }
          yield { 
            type: 'token', 
            content: parsed.delta, 
            provider: this.name, 
            model: model,
            resolvedModel: streamResolvedModel,
            resolvedProvider: this.name
          };
        }
      }
    }

    const tail = decoder.decode();
    if (!sawSseData) rawBody += tail;
    buffer += tail;
    for (const line of buffer.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      sawSseData = true;
      const parsed = parseOpenAiSsePayload(trimmed.slice(5).trim());
      if (parsed.model) streamResolvedModel = parsed.model;
      if (parsed.delta) {
        if (ttftMs === undefined) {
          ttftMs = Date.now() - streamStart;
        }
        yield { 
          type: 'token', 
          content: parsed.delta, 
          provider: this.name, 
          model: model,
          resolvedModel: streamResolvedModel,
          resolvedProvider: this.name
        };
      }
    }

    // Non-streaming OpenAI-style JSON body (no SSE `data:` lines seen): emit
    // the final message content as a single token. Reads only `content`, so
    // `reasoning_content` never reaches user-visible output.
    if (!sawSseData) {
      try {
        const parsed = JSON.parse(rawBody);
        const content = parsed?.choices?.[0]?.message?.content;
        if (parsed?.model) streamResolvedModel = parsed.model;
        if (typeof content === 'string' && content.length > 0) {
          if (ttftMs === undefined) {
            ttftMs = Date.now() - streamStart;
          }
          yield { 
            type: 'token', 
            content, 
            provider: this.name, 
            model: model,
            resolvedModel: streamResolvedModel,
            resolvedProvider: this.name
          };
        }
      } catch {
        // Not JSON either; downstream empty-stream handling applies.
      }
    }

    yield { 
      type: 'done', 
      provider: this.name, 
      model: model,
      resolvedModel: streamResolvedModel,
      resolvedProvider: this.name,
      durationMs: Date.now() - streamStart,
      latencyMs: ttftMs
    };
  }

  // Capabilities
  supportsTools() { return this.definition.capabilities?.includes('supportsTools') ?? false; }
  supportsVision() { return this.definition.capabilities?.includes('supportsVision') ?? false; }
  supportsReasoning() { return this.definition.capabilities?.includes('supportsReasoning') ?? false; }
  supportsStreaming() { return true; } // OpenAI stream=true is standard
  maxContext() { return this.definition.maxContext || 128000; }
}

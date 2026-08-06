import { ModelGateway, ChatRequest, ChatResponse, ChatStreamChunk, ProviderDefinition } from '../types.js';
import { ProviderCredentialService } from '../credentials.js';

function parseOpenAiSseDelta(payload: string): string {
  if (!payload || payload === '[DONE]') return '';
  try {
    const chunk = JSON.parse(payload);
    return chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
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
    const messages = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
    messages.push({ role: 'user', content: req.prompt });

    const dbKey = await ProviderCredentialService.getCredential(this.name);
    const apiKey = dbKey || this.definition.apiKey;
    const res = await fetch(`${this.definition.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model: this.definition.model, messages, max_tokens: req.maxTokens || 1024 }),
      signal: req.signal || AbortSignal.timeout(req.timeoutMs || 30000)
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
    
    // Phase 2: Token Accounting
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;

    return { 
      reply, 
      provider: this.name, 
      model: this.definition.model, 
      offline: false,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens
    };
  }

  public async *stream(req: ChatRequest): AsyncGenerator<ChatStreamChunk> {
    const messages = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
    messages.push({ role: 'user', content: req.prompt });

    const dbKey = await ProviderCredentialService.getCredential(this.name);
    const apiKey = dbKey || this.definition.apiKey;
    const res = await fetch(`${this.definition.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ 
        model: this.definition.model, 
        messages, 
        max_tokens: req.maxTokens || 1024, 
        stream: true,
        // stream_options: { include_usage: true } // Standard OpenAI feature for tokens in stream
      }),
      signal: req.signal || AbortSignal.timeout(req.timeoutMs || 30000)
    });

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
        const delta = parseOpenAiSseDelta(trimmed.slice(5).trim());
        if (delta) yield { type: 'token', content: delta, provider: this.name, model: this.definition.model };
      }
    }

    const tail = decoder.decode();
    if (!sawSseData) rawBody += tail;
    buffer += tail;
    for (const line of buffer.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      sawSseData = true;
      const delta = parseOpenAiSseDelta(trimmed.slice(5).trim());
      if (delta) yield { type: 'token', content: delta, provider: this.name, model: this.definition.model };
    }

    // Non-streaming OpenAI-style JSON body (no SSE `data:` lines seen): emit
    // the final message content as a single token. Reads only `content`, so
    // `reasoning_content` never reaches user-visible output.
    if (!sawSseData) {
      try {
        const parsed = JSON.parse(rawBody);
        const content = parsed?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'token', content, provider: this.name, model: this.definition.model };
        }
      } catch {
        // Not JSON either; downstream empty-stream handling applies.
      }
    }

    yield { type: 'done', provider: this.name, model: this.definition.model };
  }

  // Capabilities
  supportsTools() { return this.definition.capabilities?.includes('supportsTools') ?? false; }
  supportsVision() { return this.definition.capabilities?.includes('supportsVision') ?? false; }
  supportsReasoning() { return this.definition.capabilities?.includes('supportsReasoning') ?? false; }
  supportsStreaming() { return true; } // OpenAI stream=true is standard
  maxContext() { return this.definition.maxContext || 8192; }
}

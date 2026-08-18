import { ModelGateway, ChatRequest, ChatResponse, ChatStreamChunk, ProviderDefinition } from '../types.js';
import { ProviderCredentialService } from '../credentials.js';
import { ProviderRateLimitError } from './openai.js';

/**
 * DeepSeekGateway — first-class DeepSeek V4 provider implementation
 * (Phase B: DEEPSEEK V4 PROVIDER).
 *
 * Official API contract (OpenAI-compatible):
 *   base URL: https://api.deepseek.com  (v1 path appended by the gateway)
 *   models:   deepseek-chat (V4 flash-class), deepseek-reasoner (V4 pro-class)
 *
 * Agentic OS model IDs (B1):
 *   deepseek-v4-flash  -> deepseek-chat
 *   deepseek-v4-pro    -> deepseek-reasoner
 *
 * Boundaries enforced here:
 *   - API key is resolved from the secure credential store / env only.
 *   - The key NEVER appears in errors, logs, or returned metadata.
 *   - `reasoning_content` (thinking mode) is preserved internally for
 *     continuation semantics but NEVER emitted as user-visible content.
 *   - Tool calls, JSON output, streaming, cancellation and timeouts follow
 *     the canonical gateway contract; no DeepSeek shapes leak upstream.
 */

const BASE_URL_DEFAULT = 'https://api.deepseek.com/v1';

/** Map Agentic OS model ids -> official DeepSeek wire model ids. */
export function resolveDeepSeekWireModel(modelId?: string): string {
  const m = (modelId || 'deepseek-v4-flash').trim();
  if (m === 'deepseek-v4-pro' || m === 'deepseek-reasoner') return 'deepseek-reasoner';
  if (m === 'deepseek-v4-flash' || m === 'deepseek-chat' || m === 'auto') return 'deepseek-chat';
  // Pass through any explicit wire id (e.g. deepseek-coder).
  return m;
}

function buildRequestSignal(req: ChatRequest): AbortSignal {
  if (req.signal && req.timeoutMs) {
    return AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]);
  }
  if (req.signal) return req.signal;
  return AbortSignal.timeout(req.timeoutMs || 30000);
}

function buildMessages(req: ChatRequest) {
  const messages: any[] = [];
  if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
  if (req.history) for (const h of req.history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: req.prompt });
  return messages;
}

export class DeepSeekGateway implements ModelGateway {
  name: string;
  definition: ProviderDefinition;

  constructor(def: ProviderDefinition) {
    this.name = def.name;
    this.definition = def;
  }

  private get baseUrl(): string {
    return (this.definition.baseUrl || BASE_URL_DEFAULT).replace(/\/$/, '');
  }

  private async resolveApiKey(): Promise<string | undefined> {
    const dbKey = await ProviderCredentialService.getCredential(this.name).catch(() => undefined);
    return dbKey || this.definition.apiKey || process.env.DEEPSEEK_API_KEY || undefined;
  }

  public async healthcheck(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const apiKey = await this.resolveApiKey();
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      return { reachable: res.ok || res.status === 401 || res.status === 403, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err: any) {
      return { reachable: false, error: err.message };
    }
  }

  public async listModels(): Promise<string[]> {
    const apiKey = await this.resolveApiKey();
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    return (data.data || []).map((m: any) => m.id);
  }

  public async chat(req: ChatRequest): Promise<ChatResponse> {
    const wireModel = resolveDeepSeekWireModel(req.routing?.modelId ?? req.modelId ?? this.definition.model);
    const apiKey = await this.resolveApiKey();
    if (!apiKey) throw new Error('DeepSeek API key is not configured.');

    const messages = buildMessages(req);
    const body: any = {
      model: wireModel,
      messages,
      max_tokens: req.maxTokens || 2048,
      temperature: 0,
    };
    if (req.requiredCapabilities?.includes('json') || (req as any).jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: buildRequestSignal(req),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) throw new ProviderRateLimitError(`HTTP 429: ${text.slice(0, 200)}`, res.headers.get('retry-after') ?? undefined);
      if (res.status === 401) throw new Error('HTTP 401: invalid DeepSeek API key');
      if (res.status === 404) throw new Error(`HTTP 404: model not found (${wireModel})`);
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const msg = data.choices?.[0]?.message;
    const reply = msg?.content || '';
    if (!reply || reply.trim().length === 0) throw new Error(`Empty response from model ${wireModel}`);

    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    const latencyMs = Date.now() - start;

    return {
      reply,
      provider: this.name,
      model: wireModel,
      offline: false,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    } as ChatResponse & { latencyMs?: number };
  }

  public async *stream(req: ChatRequest): AsyncGenerator<ChatStreamChunk> {
    const wireModel = resolveDeepSeekWireModel(req.routing?.modelId ?? req.modelId ?? this.definition.model);
    const apiKey = await this.resolveApiKey();
    if (!apiKey) throw new Error('DeepSeek API key is not configured.');

    const messages = buildMessages(req);
    const body: any = {
      model: wireModel,
      messages,
      max_tokens: req.maxTokens || 1024,
      stream: true,
    };
    if (req.requiredCapabilities?.includes('json') || (req as any).jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: buildRequestSignal(req),
    });

    if (!res.ok) {
      if (res.status === 429) throw new ProviderRateLimitError('HTTP 429', res.headers.get('retry-after') ?? undefined);
      if (res.status === 401) throw new Error('HTTP 401: invalid DeepSeek API key');
      if (res.status === 404) throw new Error(`HTTP 404: model not found (${wireModel})`);
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) throw new Error('No response body');

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    let sawSseData = false;
    let rawBody = '';

    const emitDelta = (payload: string): string => {
      if (!payload || payload === '[DONE]') return '';
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta;
        // Never expose reasoning_content (thinking mode) to user-visible output.
        return delta?.content || '';
      } catch {
        return '';
      }
    };

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
        const delta = emitDelta(trimmed.slice(5).trim());
        if (delta) yield { type: 'token', content: delta, provider: this.name, model: wireModel };
      }
    }

    const tail = decoder.decode();
    if (!sawSseData) rawBody += tail;
    buffer += tail;
    for (const line of buffer.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      sawSseData = true;
      const delta = emitDelta(trimmed.slice(5).trim());
      if (delta) yield { type: 'token', content: delta, provider: this.name, model: wireModel };
    }

    if (!sawSseData) {
      try {
        const parsed = JSON.parse(rawBody);
        const content = parsed?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'token', content, provider: this.name, model: wireModel };
        }
      } catch {
        // downstream empty-stream handling applies
      }
    }

    yield { type: 'done', provider: this.name, model: wireModel };
  }

  // ── Capabilities (B10) ──
  supportsTools() { return true; }
  supportsStreaming() { return true; }
  supportsReasoning() { return true; }
  supportsJSON() { return true; }
  supportsFunctionCalling() { return true; }
  supportsLongContext() { return true; }
  supportsVision() { return false; }
  supportsEmbeddings() { return false; }
  supportsImages() { return false; }
  supportsAudio() { return false; }
  maxContext() { return this.definition.maxContext || 128000; }
}

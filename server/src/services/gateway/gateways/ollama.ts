import { ModelGateway, ChatRequest, ChatResponse, ChatStreamChunk, ProviderDefinition } from '../types.js';

export class OllamaGateway implements ModelGateway {
  name: string;
  definition: ProviderDefinition;

  constructor(def: ProviderDefinition) {
    this.name = def.name;
    this.definition = def;
  }

  public async healthcheck(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.definition.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });
      return { reachable: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err: any) {
      return { reachable: false, error: err.message };
    }
  }

  /**
   * Resolve the configured model against the models actually installed on this
   * Ollama host. Queries /api/tags and accepts either an exact name match or a
   * tagged variant (e.g. configured `llama3.2:3b` matches installed
   * `llama3.2:3b:latest`). Returns the full installed model name to use for
   * /api/generate and for emitted chunks. Throws a precise error naming the
   * configured model when nothing matches.
   */
  private async resolveModel(model: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.definition.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });
    } catch (err: any) {
      const msg = err.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('aborted')) throw new Error(`timeout: ${err.message}`);
      if (msg.includes('econnrefused') || msg.includes('fetch')) throw new Error(`ollama-unreachable: ${err.message}`);
      throw new Error(`fetch failure: ${err.message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${body}`);
    }

    let data: any;
    try {
      data = await res.json();
    } catch (err: any) {
      throw new Error(`malformed-response: ${err.message}`);
    }

    const available: string[] = Array.isArray(data?.models)
      ? data.models
          .map((m: any) => (typeof m?.name === 'string' ? m.name : ''))
          .filter((name: string) => name.length > 0)
      : [];

    // Exact match first, then a tagged variant of the configured base model.
    const baseModel = model.split(':')[0];
    const match = available.find(name => name === model)
      ?? available.find(name => name === `${baseModel}:latest`)
      ?? available.find(name => name.startsWith(`${baseModel}:`));

    if (!match) {
      throw new Error(`Ollama model missing: configured '${model}'`);
    }

    return match;
  }

  public async chat(req: ChatRequest): Promise<ChatResponse> {
    const ollamaPrompt = req.systemPrompt
      ? `${req.systemPrompt}\n\nUser: ${req.prompt}\nAssistant:`
      : req.prompt;

    const model = req.routing?.modelId ?? req.modelId ?? this.definition.model;
    const timeout = req.timeoutMs ?? 120000;
    
    console.log(JSON.stringify({
      diagnostic: 'OllamaGateway.chat entry',
      resolvedModel: model,
      outboundUrl: `${this.definition.baseUrl}/api/generate`
    }));
    
    let res: Response;
    try {
      res = await fetch(`${this.definition.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: ollamaPrompt, stream: false }),
        signal: req.signal ?? AbortSignal.timeout(timeout)
      });
    } catch (err: any) {
      const msg = err.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('aborted')) throw new Error(`timeout: ${err.message}`);
      if (msg.includes('econnrefused') || msg.includes('fetch')) throw new Error(`ollama-unreachable: ${err.message}`);
      throw new Error(`fetch failure: ${err.message}`);
    }

    console.log(JSON.stringify({
      diagnostic: 'OllamaGateway.chat response',
      status: res.status,
      ok: res.ok
    }));

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const bodyLower = body.toLowerCase();
      if (res.status === 404 || bodyLower.includes('not found')) throw new Error(`model-not-found: ${body}`);
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    let data: any;
    try {
      data = await res.json();
    } catch (err: any) {
      throw new Error(`malformed-response: ${err.message}`);
    }

    console.log(JSON.stringify({
      diagnostic: 'OllamaGateway.chat parsed',
      shape: Object.keys(data || {})
    }));

    const promptTokens = data.prompt_eval_count || 0;
    const completionTokens = data.eval_count || 0;

    const normalized = { 
      reply: data.response || '', 
      provider: this.name, 
      model, 
      offline: false,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens
    };

    console.log(JSON.stringify({
      diagnostic: 'OllamaGateway.chat returning',
      normalized: {
        provider: normalized.provider,
        model: normalized.model,
        promptTokens: normalized.promptTokens,
        completionTokens: normalized.completionTokens
      }
    }));

    return normalized;
  }

  public async *stream(req: ChatRequest): AsyncGenerator<ChatStreamChunk> {
    const ollamaPrompt = req.systemPrompt
      ? `${req.systemPrompt}\n\nUser: ${req.prompt}\nAssistant:`
      : req.prompt;

    const configuredModel = req.routing?.modelId ?? req.modelId ?? this.definition.model;
    const timeout = (req.timeoutMs ?? 120000) * 2;

    // Resolve the configured model against the installed Ollama model list
    // before calling /api/generate. The resolved full name is used for the
    // request body, emitted token chunks, and the final done chunk.
    const model = await this.resolveModel(configuredModel);

    // Headers timeout: bound the request-to-headers phase with
    // OLLAMA_HEADERS_TIMEOUT_MS. The timer is cleared as soon as response
    // headers arrive so it never aborts the body stream.
    const headersTimeoutMs = parseInt(process.env.OLLAMA_HEADERS_TIMEOUT_MS ?? '', 10);
    const headersController = new AbortController();
    let headersTimer: ReturnType<typeof setTimeout> | undefined;
    if (Number.isFinite(headersTimeoutMs) && headersTimeoutMs > 0) {
      headersTimer = setTimeout(() => headersController.abort(), headersTimeoutMs);
    }
    const onRequestAbort = () => headersController.abort();
    req.signal?.addEventListener('abort', onRequestAbort, { once: true });

    let res: Response;
    try {
      res = await fetch(`${this.definition.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: ollamaPrompt, stream: true }),
        signal: headersController.signal
      });
    } catch (err: any) {
      const msg = err.message.toLowerCase();
      if (headersController.signal.aborted) {
        throw new Error(`${model} Ollama headers timed out after ${headersTimeoutMs} ms.`);
      }
      if (msg.includes('timeout') || msg.includes('aborted')) throw new Error(`timeout: ${err.message}`);
      if (msg.includes('econnrefused') || msg.includes('fetch')) throw new Error(`ollama-unreachable: ${err.message}`);
      throw new Error(`fetch failure: ${err.message}`);
    } finally {
      if (headersTimer) clearTimeout(headersTimer);
      req.signal?.removeEventListener('abort', onRequestAbort);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const bodyLower = body.toLowerCase();
      if (res.status === 404 || bodyLower.includes('not found')) throw new Error(`model-not-found: ${body}`);
      throw new Error(`Ollama HTTP ${res.status}: ${body}`);
    }
    
    if (!res.body) throw new Error(`No response body`);

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';

    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (err: any) {
        throw new Error(`stream parse failure: ${err.message}`);
      }
      
      const { value, done } = readResult;
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        let chunk: any;
        try { 
          chunk = JSON.parse(trimmed); 
        } catch (err: any) { 
          throw new Error(`malformed-stream-chunk: ${err.message} (chunk: ${trimmed})`);
        }
        
        if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
        if (typeof chunk.response === 'string' && chunk.response) {
          yield { type: 'token', content: chunk.response, provider: this.name, model };
        }
      }
    }

    buffer += decoder.decode();
    const finalLine = buffer.trim();
    if (finalLine) {
      try {
        const chunk: any = JSON.parse(finalLine);
        if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
        if (typeof chunk.response === 'string' && chunk.response) {
           yield { type: 'token', content: chunk.response, provider: this.name, model };
        }
      } catch (err: any) {
        if (!err.message.includes('Ollama stream error')) {
          throw new Error(`malformed-stream-chunk (final): ${err.message} (chunk: ${finalLine})`);
        }
        throw err;
      }
    }
    
    yield { type: 'done', provider: this.name, model };
  }

  // Capabilities
  supportsTools() { return this.definition.capabilities?.includes('supportsTools') ?? false; }
  supportsVision() { return this.definition.capabilities?.includes('supportsVision') ?? false; }
  supportsReasoning() { return this.definition.capabilities?.includes('supportsReasoning') ?? false; }
  supportsStreaming() { return true; }
  maxContext() { return this.definition.maxContext || 8192; }
}

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

    if (match) return match;

    // FALLBACK MODEL HARDENING (provider resilience): a request that names a
    // model NOT installed on this Ollama host (e.g. an assigned model such as
    // qwen3.5:4b that was never pulled, or a cloud-only catalog model) must
    // not fail the whole fallback chain. Retry resolution against the
    // provider's verified definition model (llama3.2:3b by default) so the
    // local fallback always lands on an actually-installed model. The
    // resolved model is reported truthfully in every emitted chunk.
    const defModel = this.definition.model;
    if (defModel && defModel !== model) {
      const defBase = defModel.split(':')[0];
      const defMatch = available.find(name => name === defModel)
        ?? available.find(name => name === `${defBase}:latest`)
        ?? available.find(name => name.startsWith(`${defBase}:`));
      if (defMatch) return defMatch;
    }

    throw new Error(`Ollama model missing: configured '${model}' (local fallback '${defModel}' also unavailable)`);
  }

  public async chat(req: ChatRequest): Promise<ChatResponse> {
    const historyText = (req.history || [])
      .map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`)
      .join('\n\n');
    const ollamaPrompt = req.systemPrompt
      ? `${req.systemPrompt}${historyText ? `\n\n${historyText}` : ''}\n\nUser: ${req.prompt}\nAssistant:`
      : `${historyText ? `${historyText}\n\n` : ''}${req.prompt}`;

    const baseModel = req.routing?.modelId ?? req.modelId ?? this.definition.model;
    const timeout = req.timeoutMs ?? 120000;
    // P1 — the request layer expresses the output budget. A planning request
    // (large maxTokens) gets a proportional generation cap; a retry gets a
    // strictly larger budget so a thinking-constrained generation can finish.
    const baseBudget = req.maxTokens ?? 512;
    const retryBudget = Math.max(baseBudget * 3, 2048);
    // P4 — planning escalation: the request may name a stronger sibling model
    // on the same provider (e.g. qwen3.5:cloud) used ONLY when the local
    // model exhausts its budget without producing content.
    const escalationModel = req.escalationModel;

    console.log(JSON.stringify({
      diagnostic: 'OllamaGateway.chat entry',
      resolvedModel: baseModel,
      outboundUrl: `${this.definition.baseUrl}/api/chat`,
      promptLength: ollamaPrompt.length,
      baseBudget,
      retryBudget,
      escalationModel: escalationModel || null
    }));

    const attempts: { model: string; budget: number }[] = [
      { model: baseModel, budget: baseBudget },
      { model: baseModel, budget: retryBudget },
    ];
    const hasEscalation = Boolean(escalationModel && escalationModel !== baseModel);
    if (escalationModel && escalationModel !== baseModel) {
      attempts.push({ model: escalationModel, budget: retryBudget });
    }

    let emptyDiagnostic = '';
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const { model, budget } = attempts[attempt];
      const attemptStart = Date.now();
      // When an escalation model is configured, the base local attempts are
      // short probes: the local model either returns fast (empty or content)
      // or hangs — a 20s cap bounds the hang so the escalation model (the
      // real generator) is reached promptly. The escalation attempt itself
      // gets the full timeout.
      const attemptTimeoutMs = hasEscalation && model !== escalationModel ? Math.min(timeout, 20000) : timeout;
      let res: Response;
      let fetchError: string | null = null;
      try {
        res = await fetch(`${this.definition.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // num_predict must be sent: without a cap the model generates an
          // unbounded reasoning block and blows the timeout.
          // think:false (top-level, NOT options) disables the reasoning block
          // so the reply arrives in message.content instead of thinking-only.
          body: JSON.stringify({ model, messages: [{ role: 'user', content: ollamaPrompt }], stream: false, think: false, options: { num_predict: budget } }),
          // Compose the caller's cancellation signal WITH the timeout — when a
          // signal is present the timeout must still fire.
          signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(attemptTimeoutMs)]) : AbortSignal.timeout(attemptTimeoutMs)
        });
      } catch (err: any) {
        const msg = err.message.toLowerCase();
        // A timeout is ALSO an incomplete-generation condition: continue to
        // the next attempt (larger budget / escalation) instead of failing
        // the whole request on a hung local model.
        if (msg.includes('timeout') || msg.includes('aborted')) {
          fetchError = `timeout: ${err.message}`;
        } else if (msg.includes('econnrefused') || msg.includes('fetch')) {
          fetchError = `ollama-unreachable: ${err.message}`;
        } else {
          fetchError = `fetch failure: ${err.message}`;
        }
      }

      if (fetchError) {
        emptyDiagnostic = `attempt=${attempt + 1} model=${model} ${fetchError}`;
        console.log(JSON.stringify({
          diagnostic: 'OllamaGateway.chat attempt-failed',
          attempt: attempt + 1,
          model,
          budget,
          error: fetchError,
          durationMs: Date.now() - attemptStart
        }));
        continue;
      }

      if (!res!.ok) {
        const body = await res!.text().catch(() => '');
        const bodyLower = body.toLowerCase();
        if (res!.status === 404 || bodyLower.includes('not found')) throw new Error(`model-not-found: ${body}`);
        // A 500/EOF is a transient server-side failure (the local model crashed
        // mid-generation). Record it and continue to the next attempt (larger
        // budget / escalation) — bounded by the attempts array; the final
        // exhausted throw covers the all-failed case.
        emptyDiagnostic = `attempt=${attempt + 1} model=${model} http=${res!.status} ${body.slice(0, 120)}`;
        console.log(JSON.stringify({
          diagnostic: 'OllamaGateway.chat attempt-failed',
          attempt: attempt + 1,
          model,
          budget,
          error: `HTTP ${res!.status}: ${body.slice(0, 160)}`,
          durationMs: Date.now() - attemptStart,
        }));
        continue;
      }

      let data: any;
      try {
        data = await res!.json();
      } catch (err: any) {
        throw new Error(`malformed-response: ${err.message}`);
      }

      const content: string = data.message?.content || '';
      const thinking: string = data.message?.thinking || '';
      const promptTokens = data.prompt_eval_count || 0;
      const completionTokens = data.eval_count || 0;

      // P2 — EMPTY CONTENT is a distinct retryable condition: HTTP 200 alone
      // is NOT success. The model consumed its budget on reasoning (or
      // stopped) without producing an answer.
      if (!content.trim()) {
        emptyDiagnostic = `attempt=${attempt + 1} model=${model} budget=${budget} eval=${completionTokens} thinkingLen=${thinking.length}`;
        console.log(JSON.stringify({
          diagnostic: 'OllamaGateway.chat empty-content',
          attempt: attempt + 1,
          model,
          budget,
          evalCount: completionTokens,
          thinkingLen: thinking.length,
          durationMs: Date.now() - attemptStart
        }));
        continue;
      }

      // Success — report the ACTUAL model that produced the reply (P5 truth).
      const normalized = {
        reply: content,
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
          attempt: attempt + 1,
          promptTokens: normalized.promptTokens,
          completionTokens: normalized.completionTokens,
          replyLength: normalized.reply.length,
          replyPreview: normalized.reply.slice(0, 160)
        }
      }));
      return normalized;
    }

    // P2 final — distinct retryable marker, never silently "success".
    console.log(JSON.stringify({
      diagnostic: 'OllamaGateway.chat exhausted',
      reason: emptyDiagnostic || 'all attempts produced no content'
    }));
    throw new Error(`EMPTY_CONTENT_AFTER_REASONING: ${emptyDiagnostic || 'all attempts produced no content'}`);
  }

  public async *stream(req: ChatRequest): AsyncGenerator<ChatStreamChunk> {
    const historyText = (req.history || [])
      .map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`)
      .join('\n\n');
    const ollamaPrompt = req.systemPrompt
      ? `${req.systemPrompt}${historyText ? `\n\n${historyText}` : ''}\n\nUser: ${req.prompt}\nAssistant:`
      : `${historyText ? `${historyText}\n\n` : ''}${req.prompt}`;

    const configuredModel = req.routing?.modelId ?? req.modelId ?? this.definition.model;
    const timeout = (req.timeoutMs ?? 120000) * 2;

    // Resolve the configured model against the installed Ollama model list
    // before calling /api/chat. The resolved full name is used for the
    // request body, emitted token chunks, and the final done chunk.
    const model = await this.resolveModel(configuredModel);

    // Headers timeout: bound the request-to-headers phase so a hung local
    // model cannot stall the whole turn. OLLAMA_HEADERS_TIMEOUT_MS overrides;
    // default is the per-attempt budget (req.timeoutMs) — a stale default of
    // `parseInt('') = NaN` previously disabled the timer entirely and the
    // fallback turn waited for the caller's outer backstop before erroring.
    // Headers arrive quickly on a healthy local daemon even while the model
    // loads, so this only cuts genuine hangs — the body stream is separately
    // bounded by the caller's idle/total timers.
    const envHeadersTimeout = parseInt(process.env.OLLAMA_HEADERS_TIMEOUT_MS ?? '', 10);
    const headersTimeoutMs = (Number.isFinite(envHeadersTimeout) && envHeadersTimeout > 0)
      ? envHeadersTimeout
      : (req.timeoutMs ?? 30000);
    const headersController = new AbortController();
    let headersTimer: ReturnType<typeof setTimeout> | undefined;
    if (headersTimeoutMs > 0) {
      headersTimer = setTimeout(() => headersController.abort(), headersTimeoutMs);
    }
    const onRequestAbort = () => headersController.abort();
    req.signal?.addEventListener('abort', onRequestAbort, { once: true });

    let res: Response;
    try {
      res = await fetch(`${this.definition.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: ollamaPrompt }], stream: true, think: false, options: { num_predict: req.maxTokens ?? 512 } }),
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
        if (typeof chunk.message?.content === 'string' && chunk.message.content) {
          yield { type: 'token', content: chunk.message.content, provider: this.name, model };
        }
      }
    }

    buffer += decoder.decode();
    const finalLine = buffer.trim();
    if (finalLine) {
      try {
        const chunk: any = JSON.parse(finalLine);
        if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
        if (typeof chunk.message?.content === 'string' && chunk.message.content) {
           yield { type: 'token', content: chunk.message.content, provider: this.name, model };
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

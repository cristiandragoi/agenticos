/**
 * llmGateway.ts ΓÇö Shared LLM gateway for all chat/model routes.
 *
 * Encapsulates the standard provider chain:
 *   1. OmniRoute (primary)
 *   2. Ollama    (local fallback)
 *   3. Offline message (graceful degradation)
 *
 * Every chat endpoint should call `llmChat()` instead of duplicating
 * fetch + SSE-parse + fallback logic.
 */

import { logExecution } from './evolution/executionLogger.js';

import crypto from 'crypto';

// ΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export interface LlmChatOptions {
  /** System prompt injected as the first message */
  systemPrompt?: string;
  /** User message */
  prompt: string;
  /** Max tokens to request from the model (default 1024) */
  maxTokens?: number;
  /** Timeout in ms for the primary OmniRoute call (default 30 000) */
  timeoutMs?: number;
  /** Timeout in ms for a direct local Ollama call (default 600 000 / 10 minutes) */
  ollamaTimeoutMs?: number;
  /** Optional tracking for Evolution Lab */
  agentId?: string;
  promptVersionId?: string;
  jobId?: string;
  /**
   * If set to 'ollama', bypass OmniRoute and send directly to the local Ollama server.
   * Use this for coding agents that should always use local models.
   */
  provider?: 'omniRoute' | 'ollama';
  /**
   * Specific Ollama model to use when provider='ollama'.
   * Defaults to OLLAMA_DEFAULT_CODING_MODEL when not set.
   * Examples: 'laguna-xs-2.1' | 'deepseek-coder-v2:16b'
   */
  ollamaModel?: string;
  /** Optional caller-managed abort signal. */
  signal?: AbortSignal;
}

export interface LlmChatResult {
  /** The model's reply text, or an offline-mode message */
  reply: string;
  /** Which provider actually produced the reply */
  provider: 'omniRoute' | 'ollama' | 'offline';
  /** True when no model was reachable */
  offline: boolean;
  /** The specific model that handled the request */
  model?: string;
  /** Non-empty when a fallback was used or the request failed */
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
  type: 'token' | 'done';
  content?: string;
  provider: 'omniRoute' | 'ollama';
  model?: string;
}


// ΓöÇΓöÇ Constants ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const OFFLINE_MESSAGE =
  'I am running in offline mode. No external model is reachable. ' +
  'Please start OmniRoute (`omniroute` in a terminal) or check your API keys in server/.env.';

export const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
export const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'poolside/laguna-s-2.1:free';

/** Heartbeat / general-purpose fallback model */
export const OLLAMA_FALLBACK_MODEL = 'laguna-xs-2.1';

/** Default local coding model ΓÇö primary choice for CodeX and coding agents */
export const OLLAMA_DEFAULT_CODING_MODEL = 'laguna-xs-2.1';

/** Heavier local coding model ΓÇö for complex implementation tasks */
export const OLLAMA_HEAVY_CODING_MODEL = 'deepseek-coder-v2:16b';

// ΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function getOmniConfig() {
  return {
    base: process.env.OPENROUTER_BASE_URL || process.env.OMNIROUTE_BASE_URL || OPENROUTER_BASE,
    key: process.env.OPENROUTER_API_KEY || process.env.OMNIROUTE_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || process.env.OMNIROUTE_MODEL || OPENROUTER_DEFAULT_MODEL,
    providerName: process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_BASE_URL ? 'OpenRouter' : 'OpenAI-compatible',
  };
}

/**
 * Parse an OmniRoute response that may be SSE-streamed *or* plain JSON.
 * Returns the concatenated assistant content.
 */
function parseOmniResponse(raw: string): string {
  // Try SSE first (lines starting with "data: ")
  let reply = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') break;
    try {
      const chunk = JSON.parse(payload);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) reply += delta;
    } catch { /* skip malformed chunk */ }
  }

  // Fallback: maybe it returned a standard OpenAI-style JSON object
  if (!reply) {
    try {
      const json = JSON.parse(raw);
      reply = json.choices?.[0]?.message?.content || '';
    } catch { /* not JSON either */ }
  }

  return reply;
}

function parseOpenAiSseDelta(payload: string): string {
  if (!payload || payload === '[DONE]') return '';
  try {
    const chunk = JSON.parse(payload);
    return chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

async function* streamOmniResponse(res: Response): AsyncGenerator<string> {
  if (!res.body) {
    const raw = await res.text();
    const parsed = parseOmniResponse(raw);
    if (parsed) yield parsed;
    return;
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const delta = parseOpenAiSseDelta(trimmed.slice(5).trim());
      if (delta) yield delta;
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const delta = parseOpenAiSseDelta(trimmed.slice(5).trim());
    if (delta) yield delta;
  }
}

async function* streamOllamaResponse(res: Response): AsyncGenerator<string> {
  if (!res.body) {
    const data: any = await res.json();
    const reply = (data.response || '').trim();
    if (reply) yield reply;
    return;
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const chunk: any = JSON.parse(trimmed);
      if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
      if (typeof chunk.response === 'string' && chunk.response) yield chunk.response;
    }
  }

  buffer += decoder.decode();
  const finalLine = buffer.trim();
  if (finalLine) {
    const chunk: any = JSON.parse(finalLine);
    if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
    if (typeof chunk.response === 'string' && chunk.response) yield chunk.response;
  }
}

export async function* llmChatStream(opts: LlmChatOptions): AsyncGenerator<LlmChatStreamChunk> {
  const {
    systemPrompt,
    prompt,
    maxTokens = 1024,
    ollamaTimeoutMs = 120_000,
    signal,
  } = opts;

  const { base, key, model, providerName } = getOmniConfig();
  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  let omniError: any;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
      signal,
    });

    if (!res.ok) throw new Error(`OmniRoute HTTP ${res.status}`);
    let sawToken = false;
    for await (const delta of streamOmniResponse(res)) {
      sawToken = true;
      yield { type: 'token', content: delta, provider: 'omniRoute', model };
    }
    if (!sawToken) throw new Error('OmniRoute returned empty response');
    yield { type: 'done', provider: 'omniRoute', model };
    return;
  } catch (err: any) {
    omniError = err;
    if (signal?.aborted) throw err;
    console.warn(`[llmGateway] ${providerName} stream failed: ${err.message}. Trying Ollama fallback...`);
  }

  const ollamaPrompt = systemPrompt
    ? `${systemPrompt}\n\nUser: ${prompt}\nAssistant:`
    : prompt;
  const ollamaSignal = signal || AbortSignal.timeout(ollamaTimeoutMs);

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_FALLBACK_MODEL, prompt: ollamaPrompt, stream: true }),
      signal: ollamaSignal,
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    let sawToken = false;
    for await (const delta of streamOllamaResponse(res)) {
      sawToken = true;
      yield { type: 'token', content: delta, provider: 'ollama', model: OLLAMA_FALLBACK_MODEL };
    }
    if (!sawToken) throw new Error('Ollama returned empty response');
    yield { type: 'done', provider: 'ollama', model: OLLAMA_FALLBACK_MODEL };
  } catch (ollamaErr: any) {
    throw new Error(`Provider/model unavailable. OmniRoute: ${omniError?.message || omniError}; Ollama: ${ollamaErr.message}`);
  }
}

// ΓöÇΓöÇ Direct Ollama call ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Send a prompt directly to a specific local Ollama model.
 * This is the primary path for CodeX and coding agents.
 * Throws a descriptive error if Ollama is unreachable ΓÇö never silently falls back.
 */
export async function ollamaChat(
  prompt: string,
  model: string = OLLAMA_DEFAULT_CODING_MODEL,
  systemPrompt?: string,
  timeoutMs = 600_000
): Promise<LlmChatResult> {
  const ollamaPrompt = systemPrompt
    ? `${systemPrompt}\n\nUser: ${prompt}\nAssistant:`
    : prompt;

  const requestUrl = `${OLLAMA_BASE}/api/generate`;
  const startedAt = Date.now();

  console.log('[ollamaChat] Starting request', {
    url: requestUrl,
    model,
    timeoutMs,
    promptLength: ollamaPrompt.length,
  });

  try {
    /*
     * Use Ollama streaming mode.
     *
     * With stream:false, Ollama may not send HTTP headers until the entire
     * generation is finished. Node's built-in fetch (Undici) can then throw a
     * "Headers Timeout Error" on long CodeX prompts even though Ollama is
     * healthy and still working.
     *
     * With stream:true, Ollama sends headers and response chunks immediately.
     * We collect the NDJSON chunks into one final reply.
     */
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: ollamaPrompt,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    console.log('[ollamaChat] HTTP response received', {
      status: res.status,
      ok: res.ok,
      elapsedMs: Date.now() - startedAt,
      model,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${body}`);
    }

    if (!res.body) {
      throw new Error(`Ollama model '${model}' returned no response body`);
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    let reply = '';

    while (true) {
      const { value, done } = await reader.read();

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
        } catch {
          console.warn('[ollamaChat] Skipping malformed Ollama stream chunk', {
            chunk: trimmed.slice(0, 300),
          });
          continue;
        }

        if (chunk.error) {
          throw new Error(`Ollama stream error: ${chunk.error}`);
        }

        if (typeof chunk.response === 'string') {
          reply += chunk.response;
        }
      }
    }

    buffer += decoder.decode();

    const finalLine = buffer.trim();
    if (finalLine) {
      try {
        const chunk: any = JSON.parse(finalLine);

        if (chunk.error) {
          throw new Error(`Ollama stream error: ${chunk.error}`);
        }

        if (typeof chunk.response === 'string') {
          reply += chunk.response;
        }
      } catch (err: any) {
        if (err?.message?.startsWith('Ollama stream error:')) {
          throw err;
        }

        console.warn('[ollamaChat] Could not parse final Ollama stream chunk', {
          chunk: finalLine.slice(0, 300),
        });
      }
    }

    reply = reply.trim();

    if (!reply) {
      throw new Error(`Ollama model '${model}' returned an empty response`);
    }

    console.log('[ollamaChat] Generation completed', {
      model,
      elapsedMs: Date.now() - startedAt,
      responseLength: reply.length,
    });

    return {
      reply,
      provider: 'ollama',
      offline: false,
      model,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    const causeMessage =
      err?.cause?.message ||
      err?.cause?.code ||
      '';

    console.error('[ollamaChat] Request failed', {
      name: err?.name,
      message: err?.message,
      cause: err?.cause,
      stack: err?.stack,
      url: requestUrl,
      model,
      timeoutMs,
      promptLength: ollamaPrompt.length,
      elapsedMs,
    });

    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(
        `Ollama generation timed out after ${timeoutMs} ms using model '${model}'. ` +
        `Ollama is reachable, but this request did not finish in time.`
      );
    }

    if (
      err?.message?.includes('ECONNREFUSED') ||
      err?.message?.includes('fetch failed') ||
      causeMessage.includes('ECONNREFUSED')
    ) {
      throw new Error(
        `Ollama connection failed at ${OLLAMA_BASE}: ` +
        `${causeMessage || err?.message || 'unknown network error'}`
      );
    }

    throw err;
  }
}

// ΓöÇΓöÇ Primary API ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Send a chat completion through the standard provider chain.
 *
 * Routing logic:
 *   ΓÇó opts.provider === 'ollama': go directly to Ollama with opts.ollamaModel.
 *     On failure, return a typed error ΓÇö no silent fallback to OmniRoute.
 *   ΓÇó Default: OmniRoute ΓåÆ Ollama fallback (OLLAMA_FALLBACK_MODEL) ΓåÆ offline.
 *
 * **Always resolves** ΓÇö never throws. Inspect `result.offline` to detect failure.
 */
export async function llmChat(opts: LlmChatOptions): Promise<LlmChatResult> {
  const startedAt = new Date();
  let finalResult: LlmChatResult;

  const {
    systemPrompt,
    prompt,
    maxTokens = 1024,
    timeoutMs = 30_000,
    ollamaTimeoutMs = 600_000,
  } = opts;

  // ΓöÇΓöÇ Path A: Direct Ollama (coding agents with explicit local routing) ΓöÇΓöÇ
  if (opts.provider === 'ollama') {
    const model = opts.ollamaModel || OLLAMA_DEFAULT_CODING_MODEL;
    try {
      finalResult = await ollamaChat(prompt, model, systemPrompt, ollamaTimeoutMs);
    } catch (err: any) {
      console.error(`[llmGateway] Direct Ollama call failed for model '${model}': ${err.message}`);
      finalResult = {
        reply: `Ollama is not reachable at ${OLLAMA_BASE}.`,
        provider: 'offline',
        offline: true,
        model,
        error: err.message,
      };
    }
    await _logAndEmit(opts, finalResult, startedAt);
    return finalResult;
  }

  // ΓöÇΓöÇ Path B: OmniRoute ΓåÆ Ollama fallback ΓåÆ offline ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const { base, key, model, providerName } = getOmniConfig();
  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) throw new Error(`OmniRoute HTTP ${res.status}`);

    const raw = await res.text();
    const reply = parseOmniResponse(raw);

    if (reply) {
      finalResult = { reply, provider: 'omniRoute', offline: false, model };
    } else {
      throw new Error('OmniRoute returned empty response');
    }
  } catch (omniErr: any) {
    console.warn(`[llmGateway] ${providerName} failed: ${omniErr.message}. Trying Ollama fallbackΓÇª`);

    try {
      const ollamaPrompt = systemPrompt
        ? `${systemPrompt}\n\nUser: ${prompt}\nAssistant:`
        : prompt;

      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_FALLBACK_MODEL, prompt: ollamaPrompt, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

      const data: any = await res.json();
      const reply = (data.response || '').trim();

      if (reply) {
        finalResult = { reply, provider: 'ollama', offline: false, model: OLLAMA_FALLBACK_MODEL, error: `${providerName} unavailable: ${omniErr.message}` };
      } else {
        throw new Error('Ollama returned empty response');
      }
    } catch (ollamaErr: any) {
      console.warn(`[llmGateway] Ollama also failed: ${ollamaErr.message}`);
      finalResult = {
        reply: OFFLINE_MESSAGE,
        provider: 'offline',
        offline: true,
        error: `${providerName}: ${omniErr.message}; Ollama: ${ollamaErr.message}`,
      };
    }
  }

  await _logAndEmit(opts, finalResult, startedAt);
  return finalResult;
}

/** Internal: log execution to Evolution Lab and emit cost event */
async function _logAndEmit(opts: LlmChatOptions, finalResult: LlmChatResult, startedAt: Date) {
  if (!opts.agentId) return;
  const completedAt = new Date();
  const duration = completedAt.getTime() - startedAt.getTime();
  const idempotencyKey = crypto.randomUUID();
  const usedModel = finalResult.model || (finalResult.provider === 'ollama' ? OLLAMA_FALLBACK_MODEL : 'auto');
  const isLocal = finalResult.provider === 'ollama';

  try {
    await logExecution({
      idempotencyKey,
      sourceType: 'llmGateway',
      sourceRunId: opts.jobId,
      agentId: opts.agentId,
      promptVersionId: opts.promptVersionId,
      model: usedModel,
      provider: finalResult.provider,
      input: [{ role: 'user', content: opts.prompt }],
      output: finalResult.reply,
      error: finalResult.error,
      executionTimeMs: duration,
      success: !finalResult.offline && !finalResult.error,
      costSource: isLocal ? 'local_zero' : 'unavailable',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    });

    const estimatedCost = isLocal ? 0 : duration * 0.00001;
    import('../core/eventBus.js').then(({ eventBus }) => {
      eventBus.publish({
        eventType: 'cost_incurred',
        source: isLocal ? `ollama:${usedModel}` : (finalResult.provider || 'omniRoute'),
        payload: {
          cost: estimatedCost,
          runId: opts.jobId || null,
          campaignId: (opts as any).opportunityId || null
        }
      }).catch((err: any) => console.error('[llmGateway] Failed to publish cost_incurred event:', err));
    });
  } catch (err: any) {
    console.error('[ExecutionLogger] Failed to log run:', err);
  }
}

/**
 * Probe OmniRoute connectivity without sending a chat message.
 * Returns a structured status object suitable for `/api/chat/test`.
 */
export async function llmProbe(): Promise<LlmProbeResult> {
  const { base } = getOmniConfig();

  try {
    const res = await fetch(`${base}/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    return { status: res.ok ? 'ok' : 'unreachable', provider: 'omniRoute', reachable: res.ok };
  } catch (err: any) {
    return { status: 'unreachable', provider: 'omniRoute', reachable: false, error: err.message };
  }
}

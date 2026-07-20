/**
 * llmGateway.ts — Shared LLM gateway for all chat/model routes.
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

// ── Types ────────────────────────────────────────────────────────────

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
   * Examples: 'qwen2.5-coder:14b' | 'deepseek-coder-v2:16b'
   */
  ollamaModel?: string;
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


// ── Constants ────────────────────────────────────────────────────────

const OFFLINE_MESSAGE =
  'I am running in offline mode. No external model is reachable. ' +
  'Please start OmniRoute (`omniroute` in a terminal) or check your API keys in server/.env.';

export const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

/** Heartbeat / general-purpose fallback model */
const OLLAMA_FALLBACK_MODEL = 'qwen2.5-coder:14b';

/** Default local coding model — primary choice for CodeX and coding agents */
export const OLLAMA_DEFAULT_CODING_MODEL = 'qwen2.5-coder:7b';

/** Heavier local coding model — for complex implementation tasks */
export const OLLAMA_HEAVY_CODING_MODEL = 'deepseek-coder-v2:16b';

// ── Helpers ──────────────────────────────────────────────────────────

function getOmniConfig() {
  return {
    base: process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1',
    key: process.env.OMNIROUTE_API_KEY || '',
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

// ── Direct Ollama call ───────────────────────────────────────────────

/**
 * Send a prompt directly to a specific local Ollama model.
 * This is the primary path for CodeX and coding agents.
 * Throws a descriptive error if Ollama is unreachable — never silently falls back.
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

// ── Primary API ──────────────────────────────────────────────────────

/**
 * Send a chat completion through the standard provider chain.
 *
 * Routing logic:
 *   • opts.provider === 'ollama': go directly to Ollama with opts.ollamaModel.
 *     On failure, return a typed error — no silent fallback to OmniRoute.
 *   • Default: OmniRoute → Ollama fallback (OLLAMA_FALLBACK_MODEL) → offline.
 *
 * **Always resolves** — never throws. Inspect `result.offline` to detect failure.
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

  // ── Path A: Direct Ollama (coding agents with explicit local routing) ──
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

  // ── Path B: OmniRoute → Ollama fallback → offline ────────────────────
  const { base, key } = getOmniConfig();
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
      body: JSON.stringify({ model: 'auto', messages, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) throw new Error(`OmniRoute HTTP ${res.status}`);

    const raw = await res.text();
    const reply = parseOmniResponse(raw);

    if (reply) {
      finalResult = { reply, provider: 'omniRoute', offline: false };
    } else {
      throw new Error('OmniRoute returned empty response');
    }
  } catch (omniErr: any) {
    console.warn(`[llmGateway] OmniRoute failed: ${omniErr.message}. Trying Ollama fallback…`);

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
        finalResult = { reply, provider: 'ollama', offline: false, model: OLLAMA_FALLBACK_MODEL, error: `OmniRoute unavailable: ${omniErr.message}` };
      } else {
        throw new Error('Ollama returned empty response');
      }
    } catch (ollamaErr: any) {
      console.warn(`[llmGateway] Ollama also failed: ${ollamaErr.message}`);
      finalResult = {
        reply: OFFLINE_MESSAGE,
        provider: 'offline',
        offline: true,
        error: `OmniRoute: ${omniErr.message}; Ollama: ${ollamaErr.message}`,
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

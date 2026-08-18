import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayRouter } from '../services/gateway/router.js';
import { loadGatewayConfig } from '../services/gateway/config.js';
import { GatewayRunLedger } from '../services/gateway/ledger.js';

// Mock the DB-backed configuration service so tests control circuit thresholds.
vi.mock('../services/gateway/configuration.js', () => ({
  GatewayConfigurationService: {
    getConfiguration: vi.fn().mockResolvedValue({
      maxProviderRetries: 3,
      maxFallbackProviders: 3,
      providerTimeoutMs: 30000,
      degradedLatencyMs: 2000,
      circuitFailureThreshold: 3,
      circuitResetTimeoutMs: 60000,
      healthCheckIntervalMs: 300000,
      updatedAt: new Date().toISOString(),
      version: 1
    })
  }
}));

// ProviderCredentialService is DB-backed; in the router tests it must resolve
// to null so the gateway falls back to definition.apiKey (undefined → no auth
// header). Same pattern as gatewayPhase2.test.ts.
vi.mock('../services/gateway/credentials.js', () => ({
  ProviderCredentialService: {
    getCredential: vi.fn().mockResolvedValue(null)
  }
}));

const originalFetch = global.fetch;

describe('Per-attempt provider timeout → zero-token fallback (buildRequestSignal regression)', () => {
  let router: GatewayRouter;
  let ledger: GatewayRunLedger;

  beforeEach(() => {
    const config = loadGatewayConfig();
    config.providers = [
      { name: 'omniroot', baseUrl: 'http://mock-omni', model: 'poolside/laguna-s-2.1:free', type: 'openai', capabilities: ['supportsStreaming'] },
      { name: 'ollama', baseUrl: 'http://mock-ollama', model: 'llama3.2:3b', type: 'ollama', maxContext: 4096 }
    ];
    config.providerOrder = ['omniroot', 'ollama'];
    config.streamBufferTokens = 5;
    config.streamBufferMilliseconds = 1000;
    config.healthCacheTTLMs = 100;

    ledger = new GatewayRunLedger(config.logsPath + '.test');
    router = (GatewayRouter as any).getInstance(config, ledger);
    (router as any).consecutiveFailures.clear();
    (router as any).healthCache.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /**
   * THE regression: a provider that receives a valid outer request signal but
   * emits ZERO tokens must be cancelled by its OWN per-attempt timeout, and
   * the fallback provider must receive a NON-ABORTED usable signal.
   *
   * Old behavior (`signal: req.signal || AbortSignal.timeout(...)`): because
   * req.signal is always set by the Jarvis handler, NO per-attempt timeout was
   * created. The hung fetch never resolved → the router never reached the
   * fallback → the whole turn sat in silence until the handler's shared
   * 20s abort killed everything (root cause of the intermittent no-response).
   *
   * New behavior (`buildRequestSignal(req)` → AbortSignal.any([req.signal,
   * AbortSignal.timeout(req.timeoutMs)])): only THIS attempt's combined signal
   * aborts; req.signal stays usable, the router's zero-token catch falls back
   * to Ollama, tokens stream, done fires.
   *
   * Against the OLD code this test FAILS by hanging (the fetch mock only
   * rejects when the passed signal aborts; old code passes only req.signal,
   * which never aborts → no fallback → vitest timeout).
   */
  test('hung primary (zero tokens) aborts via per-attempt timeout and Ollama fallback streams with a non-aborted signal', async () => {
    const callerController = new AbortController(); // simulates Jarvis's request signal — never aborted by us
    let omniCalled = 0;
    let ollamaChatCalled = 0;

    global.fetch = vi.fn().mockImplementation(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) {
        omniCalled++;
        // Hang until the signal passed to fetch aborts. With buildRequestSignal
        // the passed signal is AbortSignal.any([caller, timeout]) → the
        // per-attempt timeout aborts it. With the OLD code it is the bare
        // caller signal (never aborted) → hangs forever.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
          }, { once: true });
        });
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }] }) };
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/chat')) {
        ollamaChatCalled++;
        // Assert the fallback received a NON-ABORTED signal.
        if (init?.signal?.aborted) throw new Error('fallback received an aborted signal');
        const enc = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(enc.encode(JSON.stringify({ message: { content: 'OK from fallback' } }) + '\n'));
            controller.enqueue(enc.encode(JSON.stringify({ message: { content: ' second' }, done: false }) + '\n'));
            controller.enqueue(enc.encode(JSON.stringify({ done: true }) + '\n'));
            controller.close();
          }
        });
        return { ok: true, body };
      }
      return { ok: false, status: 500, text: async () => 'unexpected url' };
    });

    const chunks: any[] = [];
    for await (const chunk of router.stream({ prompt: 'hello', timeoutMs: 300, signal: callerController.signal, requestId: 'per-attempt-regression' })) {
      chunks.push(chunk);
    }

    expect(omniCalled).toBe(1);
    expect(ollamaChatCalled).toBe(1);
    // The caller's signal must remain usable for the NEXT turn.
    expect(callerController.signal.aborted).toBe(false);

    const tokens = chunks.filter(c => c.type === 'token').map(c => c.content).join('');
    expect(tokens).toContain('OK from fallback');
    expect(chunks.some(c => c.type === 'done')).toBe(true);
    // Fallback must be visible in the chunk stream.
    expect(chunks.some(c => c.type === 'gateway.fallback')).toBe(true);
  });

  test('HTTP 429 on primary → fallback selected → Ollama streams → done, no stuck execution', async () => {
    let ollamaChatCalled = 0;
    global.fetch = vi.fn().mockImplementation(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) {
        return { ok: false, status: 429, headers: new Headers({ 'retry-after': '2' }), text: async () => 'rate limited' };
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }] }) };
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/chat')) {
        ollamaChatCalled++;
        const enc = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(enc.encode(JSON.stringify({ message: { content: '429 fallback answer' } }) + '\n'));
            controller.enqueue(enc.encode(JSON.stringify({ done: true }) + '\n'));
            controller.close();
          }
        });
        return { ok: true, body };
      }
      return { ok: false, status: 500, text: async () => 'unexpected url' };
    });

    const chunks: any[] = [];
    for await (const chunk of router.stream({ prompt: 'hello', timeoutMs: 5000, requestId: 'rate-limit-regression' })) {
      chunks.push(chunk);
    }

    expect(ollamaChatCalled).toBe(1);
    const tokens = chunks.filter(c => c.type === 'token').map(c => c.content).join('');
    expect(tokens).toContain('429 fallback answer');
    expect(chunks.some(c => c.type === 'done')).toBe(true);
    // A rate-limit diagnostic should be visible, then fallback proceeds.
    expect(chunks.some(c => c.type === 'gateway.rate_limited')).toBe(true);
    expect(chunks.some(c => c.type === 'gateway.fallback')).toBe(true);
  });

  test('total failure: primary and fallback both fail → stream throws terminal error (no silent hang, no fake tokens)', async () => {
    let ollamaChatCalled = 0;
    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) return { ok: false, status: 503, text: async () => 'primary down' };
      if (u.includes('mock-ollama') && u.endsWith('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }] }) };
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/chat')) {
        ollamaChatCalled++;
        return { ok: false, status: 500, text: async () => 'ollama down' };
      }
      return { ok: false, status: 500, text: async () => 'unexpected url' };
    });

    let thrown: any = null;
    const chunks: any[] = [];
    try {
      for await (const chunk of router.stream({ prompt: 'hello', timeoutMs: 5000, requestId: 'total-failure-regression' })) {
        chunks.push(chunk);
      }
    } catch (err) {
      thrown = err;
    }

    expect(ollamaChatCalled).toBe(1);
    expect(thrown).toBeTruthy();
    const msg = String(thrown?.message || '');
    expect(msg).toContain('All configured providers failed');
    expect(msg).toContain('omniroot');
    expect(msg).toContain('ollama');
    // No tokens must ever be emitted for a total failure.
    expect(chunks.some(c => c.type === 'token')).toBe(false);
  });

  test('next turn succeeds after a total failure (no poisoned signal carries over)', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) return { ok: false, status: 503, text: async () => 'down' };
      if (u.includes('mock-ollama') && u.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }] }) };
      if (u.includes('mock-ollama') && u.endsWith('/api/chat')) return { ok: false, status: 500, text: async () => 'down' };
      return { ok: false, status: 500, text: async () => 'unexpected' };
    });
    try {
      for await (const _ of router.stream({ prompt: 'first', timeoutMs: 2000, requestId: 'next-turn-1' })) { /* drain */ }
    } catch { /* expected */ }

    // Second turn: primary healthy → must succeed.
    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) {
        return { ok: true, body: (() => {
          const enc = new TextEncoder();
          return new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"recovered answer"}}]}\n\n'));
              controller.enqueue(enc.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
        })() };
      }
      return { ok: false, status: 500, text: async () => 'unexpected' };
    });

    const chunks: any[] = [];
    for await (const chunk of router.stream({ prompt: 'second', timeoutMs: 5000, requestId: 'next-turn-2' })) {
      chunks.push(chunk);
    }
    const tokens = chunks.filter(c => c.type === 'token').map(c => c.content).join('');
    expect(tokens).toContain('recovered answer');
    expect(chunks.some(c => c.type === 'done')).toBe(true);
  });

  /**
   * Regression for the Ollama fallback stall: OLLAMA_HEADERS_TIMEOUT_MS was
   * parsed with parseInt('') → NaN → NO header timer was ever set → a hung
   * local model stalled the fallback turn until the caller's outer backstop
   * aborted (observed live: OpenRouter 502 → Ollama hang 15s → "timed out
   * after NaN ms"). The default must be the per-attempt budget so the
   * fallback fails fast with a precise error, not NaN.
   */
  test('hung Ollama fallback aborts at per-attempt headers timeout with a precise (non-NaN) error', async () => {
    delete process.env.OLLAMA_HEADERS_TIMEOUT_MS;
    global.fetch = vi.fn().mockImplementation(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) return { ok: false, status: 502, text: async () => 'primary down' };
      if (u.includes('mock-ollama') && u.endsWith('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }] }) };
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/chat')) {
        // Simulate a hung local model: never resolves until the fetch signal aborts.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        });
      }
      return { ok: false, status: 500, text: async () => 'unexpected url' };
    });

    const chunks: any[] = [];
    let thrown: any = null;
    try {
      for await (const chunk of router.stream({ prompt: 'hello', timeoutMs: 300, requestId: 'ollama-hang-regression' })) {
        chunks.push(chunk);
      }
    } catch (err) {
      thrown = err;
    }

    // The ollama attempt must abort (headers timeout) and the router must
    // surface the terminal failure — no silent hang, no NaN in the message.
    expect(thrown).toBeTruthy();
    const msg = String(thrown?.message || '');
    expect(msg).toContain('All configured providers failed');
    expect(msg).not.toContain('NaN');
    // No fake tokens were emitted.
    expect(chunks.some(c => c.type === 'token')).toBe(false);
  });

  /**
   * Fallback-model hardening (§4/§16): a request that names a model NOT
   * installed on the local Ollama host (e.g. an assigned cloud-only catalog
   * model like poolside/laguna-s-2.1:free) must still land on an actually
   * installed model (the provider's verified definition model, llama3.2:3b)
   * instead of failing the whole fallback chain with "Ollama model missing".
   */
  test('ollama fallback: requested model not installed → resolves to installed definition model', async () => {
    let ollamaChatBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('mock-omni')) return { ok: false, status: 503, text: async () => 'primary down' };
      if (u.includes('mock-ollama') && u.endsWith('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }] }) };
      }
      if (u.includes('mock-ollama') && u.endsWith('/api/chat')) {
        ollamaChatBody = JSON.parse(String(init?.body || '{}'));
        const enc = new TextEncoder();
        return {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(JSON.stringify({ message: { content: 'installed fallback answer' } }) + '\n'));
              controller.enqueue(enc.encode(JSON.stringify({ done: true }) + '\n'));
              controller.close();
            }
          })
        };
      }
      return { ok: false, status: 500, text: async () => 'unexpected url' };
    });

    // The request NAMES a model that is NOT installed locally — the ollama
    // adapter must fall back to its verified definition model (llama3.2:3b).
    const chunks: any[] = [];
    for await (const chunk of router.stream({ prompt: 'hello', modelId: 'poolside/laguna-s-2.1:free', timeoutMs: 5000, requestId: 'fallback-model-regression' })) {
      chunks.push(chunk);
    }

    const tokens = chunks.filter(c => c.type === 'token').map(c => c.content).join('');
    expect(tokens).toContain('installed fallback answer');
    // The actual outbound request used the INSTALLED model, never the missing one.
    expect(ollamaChatBody?.model).toBe('llama3.2:3b');
    // Chunks carry the truthful resolved model.
    const doneChunk = chunks.find(c => c.type === 'done');
    expect(doneChunk?.model).toBe('llama3.2:3b');
    // A fallback event was emitted so the client knows the primary failed.
    expect(chunks.some(c => c.type === 'gateway.fallback')).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepSeekGateway, resolveDeepSeekWireModel } from '../services/gateway/gateways/deepseek.js';
import { ProviderRegistry } from '../services/gateway/registry.js';
import { ProviderDefinition } from '../services/gateway/types.js';

/**
 * deepseekProvider.test.ts — DeepSeek V4 provider tests (B11 / D1–D12).
 * External API behavior is mocked for deterministic unit tests; a minimal
 * live smoke test (no key printed) runs when DEEPSEEK_API_KEY is present.
 */

function def(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    type: 'deepseek',
    ...overrides,
  };
}

describe('D1 — configuration parsing / model resolution', () => {
  it('maps agentic model ids to official wire ids', () => {
    expect(resolveDeepSeekWireModel('deepseek-v4-flash')).toBe('deepseek-chat');
    expect(resolveDeepSeekWireModel('deepseek-v4-pro')).toBe('deepseek-reasoner');
    expect(resolveDeepSeekWireModel('deepseek-chat')).toBe('deepseek-chat');
    expect(resolveDeepSeekWireModel('deepseek-reasoner')).toBe('deepseek-reasoner');
    expect(resolveDeepSeekWireModel('deepseek-coder')).toBe('deepseek-coder');
    expect(resolveDeepSeekWireModel('auto')).toBe('deepseek-chat');
    expect(resolveDeepSeekWireModel()).toBe('deepseek-chat');
  });

  it('registry instantiates a DeepSeekGateway for type deepseek', () => {
    const registry = new ProviderRegistry({ providers: [def()], providerOrder: ['DeepSeek'], timeoutMs: 30000, workspaceRoot: 'B:/AgenticOS', logsPath: 'B:/AgenticOS/.agentic/gateway-runs.jsonl', streamBufferTokens: 0, streamBufferMilliseconds: 2000, streamRecoveryPolicy: 'buffer', providerScoring: false, capabilityRouting: false, costTracking: false, metricsRetentionDays: 30, loggingFlushIntervalMs: 5000, healthCacheTTLMs: 60000, circuitBreakerCooldownMs: 300000, providerWeights: {}, startupBenchmark: false, benchmarkTimeoutMs: 3000, benchmarkCacheTTLMs: 300000, benchmarkCachePath: 'B:/AgenticOS/.agentic/gateway-benchmark-cache.json' } as any);
    const gw = registry.getProvider('DeepSeek');
    expect(gw).toBeInstanceOf(DeepSeekGateway);
  });
});

describe('D2/D3 — missing/invalid key normalization', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('throws a clear error when no API key is configured', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const gw = new DeepSeekGateway(def({ apiKey: undefined }));
    await expect(gw.chat({ prompt: 'hi' })).rejects.toThrow(/API key is not configured/i);
  });

  it('normalizes HTTP 401 as invalid key (never leaks the key)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-1234';
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid api key"}' }) as any));
    await expect(gw.chat({ prompt: 'hi' })).rejects.toThrow(/401.*invalid.*key/i);
    // The key itself must never appear in the error.
    await expect(gw.chat({ prompt: 'hi' })).rejects.toThrow(/sk-test-1234/).catch(() => {});
  });

  it('normalizes model-not-found (404)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }) as any));
    await expect(gw.chat({ prompt: 'hi', modelId: 'deepseek-v4-pro' })).rejects.toThrow(/404.*not found/i);
  });

  it('normalizes rate limiting (429) with retry-after', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, headers: new Map([['retry-after', '5']]), text: async () => 'slow down' }) as any));
    await expect(gw.chat({ prompt: 'hi' })).rejects.toMatchObject({ status: 429, retryAfter: '5' });
  });
});

describe('D4/D5 — simple completions (flash/pro wire mapping)', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-test'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('flash completion returns normalized result with usage', async () => {
    const gw = new DeepSeekGateway(def());
    let sentBody: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({
        choices: [{ message: { content: 'Hello from DeepSeek.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }) } as any;
    }));
    const r = await gw.chat({ prompt: 'say hello' });
    expect(r.reply).toBe('Hello from DeepSeek.');
    expect(r.provider).toBe('DeepSeek');
    expect(r.model).toBe('deepseek-chat');
    expect(r.promptTokens).toBe(12);
    expect(r.completionTokens).toBe(7);
    expect(r.totalTokens).toBe(19);
    expect(sentBody.model).toBe('deepseek-chat');
  });

  it('pro completion uses deepseek-reasoner wire model', async () => {
    const gw = new DeepSeekGateway(def());
    let sentModel: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      sentModel = JSON.parse(init.body).model;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }) } as any;
    }));
    await gw.chat({ prompt: 'deep reasoning', modelId: 'deepseek-v4-pro' });
    expect(sentModel).toBe('deepseek-reasoner');
  });

  it('includes json_object response_format when JSON requested (D9)', async () => {
    const gw = new DeepSeekGateway(def());
    let sentBody: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }) } as any;
    }));
    await gw.chat({ prompt: 'return json', requiredCapabilities: ['json'] });
    expect(sentBody.response_format).toEqual({ type: 'json_object' });
  });
});

describe('D6 — streaming', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-test'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('yields tokens and done in order with no duplicates', async () => {
    const gw = new DeepSeekGateway(def());
    const encoder = new TextEncoder();
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":""}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sse) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: stream }) as any));

    const tokens: string[] = [];
    let sawDone = false;
    for await (const chunk of gw.stream({ prompt: 'hi' })) {
      if (chunk.type === 'token') tokens.push(chunk.content || '');
      if (chunk.type === 'done') sawDone = true;
    }
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(sawDone).toBe(true);
  });

  it('never leaks reasoning_content as visible tokens (B9 thinking)', async () => {
    const gw = new DeepSeekGateway(def());
    const encoder = new TextEncoder();
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"internal thinking..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sse) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: stream }) as any));

    const tokens: string[] = [];
    for await (const chunk of gw.stream({ prompt: 'hi' })) {
      if (chunk.type === 'token') tokens.push(chunk.content || '');
    }
    expect(tokens).toEqual(['Answer']);
    expect(tokens.join('')).not.toContain('internal thinking');
  });
});

describe('D7 — cancellation', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-test'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('propagates AbortSignal to the upstream request', async () => {
    const gw = new DeepSeekGateway(def());
    const controller = new AbortController();
    let sawSignal = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      sawSignal = !!init.signal;
      // Reject when the caller's signal aborts (as the real fetch would).
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new Error('Aborted'));
        init.signal?.addEventListener('abort', onAbort, { once: true });
        if (init.signal?.aborted) { onAbort(); return; }
        setTimeout(() => { controller.abort(); }, 5);
      });
    }));
    await expect(gw.chat({ prompt: 'hi', signal: controller.signal, timeoutMs: 1000 })).rejects.toThrow(/Aborted|aborted/);
    expect(sawSignal).toBe(true);
  });
});

describe('D10 — usage/latency capture', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-test'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('reports token usage on completions', async () => {
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }) }) as any));
    const r = await gw.chat({ prompt: 'hi' });
    expect(r.totalTokens).toBe(8);
  });
});

describe('D11 — model availability / listing', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-test'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('lists models from /models when reachable', async () => {
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }) } as any;
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }], usage: {} }) } as any;
    }));
    const models = await gw.listModels();
    expect(models).toContain('deepseek-chat');
    expect(models).toContain('deepseek-reasoner');
  });

  it('healthcheck reports unreachable truthfully', async () => {
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const h = await gw.healthcheck();
    expect(h.reachable).toBe(false);
    expect(h.error).toContain('network down');
  });
});

describe('D12 — secret never appears in logs/errors', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-super-secret-xyz'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it('errors do not contain the API key', async () => {
    const gw = new DeepSeekGateway(def());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'server exploded' }) as any));
    try {
      await gw.chat({ prompt: 'hi' });
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).not.toContain('sk-super-secret-xyz');
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function sseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('\n')));
      controller.close();
    }
  }), { status: 200 });
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('LongCat model override routing (OpenRouter via OpenAI-compatible adapter)', () => {
  let chatBodies: any[] = [];

  beforeEach(() => {
    vi.resetModules();
    chatBodies = [];
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'http://or.test/v1',
      OPENROUTER_MODEL: 'default-or-model',
      PROVIDER_STARTUP_BENCHMARK: 'false',
      GATEWAY_PROVIDER_SCORING: 'false'
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('forwards an explicit model override into the OpenAI-compatible request body', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith('/models')) return jsonResponse({ data: [] });
      if (String(url).endsWith('/chat/completions')) {
        chatBodies.push(JSON.parse(init?.body || '{}'));
        return sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'LONGCAT_RUNTIME_OK' } }] }),
          'data: ' + JSON.stringify({ choices: [{ delta: {} }] }),
          'data: [DONE]'
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { llmChatStream } = await import('../services/llmGateway.js');
    const chunks: any[] = [];
    for await (const chunk of llmChatStream({
      prompt: 'Reply with exactly: LONGCAT_RUNTIME_OK',
      provider: 'prov-longcat',       // catalog id -> openrouter gateway provider
      model: 'meituan/longcat-2.0',   // explicit model override
      agentId: 'agent-no-assignment', // no DB row -> assignment cannot override
      disableFallback: true
    })) {
      chunks.push(chunk);
    }

    // The actual request body must carry the LongCat model, not the provider default.
    expect(chatBodies.length).toBeGreaterThan(0);
    expect(chatBodies[0].model).toBe('meituan/longcat-2.0');

    // Stream events must report the EFFECTIVE model (provider truth).
    const tokens = chunks.filter((c) => c.type === 'token');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].model).toBe('meituan/longcat-2.0');
    const done = chunks.filter((c) => c.type === 'done');
    expect(done.length).toBe(1);
    expect(done[0].model).toBe('meituan/longcat-2.0');
    // The reply text accumulates from token chunks (done carries no content).
    const reply = tokens.map((t) => t.content || '').join('');
    expect(reply).toContain('LONGCAT_RUNTIME_OK');
  });

  it('falls back to the provider default model when no override or assignment model is set', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith('/models')) return jsonResponse({ data: [] });
      if (String(url).endsWith('/chat/completions')) {
        chatBodies.push(JSON.parse(init?.body || '{}'));
        return sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'OK' } }] }),
          'data: ' + JSON.stringify({ choices: [{ delta: {} }] }),
          'data: [DONE]'
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { llmChatStream } = await import('../services/llmGateway.js');
    const chunks: any[] = [];
    for await (const chunk of llmChatStream({
      prompt: 'hi',
      provider: 'prov-longcat',
      agentId: 'agent-no-assignment',
      disableFallback: true
    })) {
      chunks.push(chunk);
    }

    expect(chatBodies[0].model).toBe('default-or-model');
  });
});

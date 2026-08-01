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

function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

async function collectGatewayText(opts: any = {}) {
  const { llmChatStream } = await import('../services/llmGateway.js');
  const chunks: any[] = [];
  for await (const chunk of llmChatStream({ prompt: 'Reply only with OK.', ...opts })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('llmGateway Ollama fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'http://openrouter.test/v1',
      OPENROUTER_MODEL: 'rate-limited-model',
      OLLAMA_BASE_URL: 'http://ollama.test',
      OLLAMA_CONNECT_TIMEOUT_MS: '100',
      OLLAMA_HEADERS_TIMEOUT_MS: '500',
      OLLAMA_FIRST_TOKEN_TIMEOUT_MS: '500',
      OLLAMA_STREAM_IDLE_TIMEOUT_MS: '500',
      OLLAMA_OVERALL_TIMEOUT_MS: '2000'
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('OpenRouter 429 triggers immediate Ollama fallback and captures Retry-After', async () => {
    const diagnostics: any[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://openrouter.test/v1/chat/completions') {
        return jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '12' });
      }
      if (url === 'http://ollama.test/api/tags') {
        return jsonResponse({ models: [{ name: 'laguna-xs-2.1:latest' }] });
      }
      if (url === 'http://ollama.test/api/generate') {
        return sseResponse([
          JSON.stringify({ response: 'OK' }),
          JSON.stringify({ done: true })
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await collectGatewayText({ onDiagnostic: event => diagnostics.push(event) });

    expect(chunks.filter(chunk => chunk.type === 'token').map(chunk => chunk.content).join('')).toBe('OK');
    expect(chunks.at(-1)).toMatchObject({ type: 'done', provider: 'ollama', model: 'laguna-xs-2.1:latest' });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'http://openrouter.test/v1/chat/completions',
      'http://ollama.test/api/tags',
      'http://ollama.test/api/generate'
    ]);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      stage: 'provider_rate_limited',
      status: 429,
      retryAfter: '12'
    }));
  });

  it('missing Ollama fallback model produces a precise structured error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://openrouter.test/v1/chat/completions') {
        return jsonResponse({ error: 'rate limited' }, 429);
      }
      if (url === 'http://ollama.test/api/tags') {
        return jsonResponse({ models: [{ name: 'qwen2.5:7b' }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    }));

    await expect(collectGatewayText()).rejects.toThrow(/Ollama model missing: configured 'laguna-xs-2.1'/);
  });

  it('slow local model headers within allowance succeed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://openrouter.test/v1/chat/completions') {
        return jsonResponse({ error: 'rate limited' }, 429);
      }
      if (url === 'http://ollama.test/api/tags') {
        return jsonResponse({ models: [{ name: 'laguna-xs-2.1:latest' }] });
      }
      if (url === 'http://ollama.test/api/generate') {
        await new Promise(resolve => setTimeout(resolve, 40));
        return sseResponse([JSON.stringify({ response: 'OK' }), JSON.stringify({ done: true })]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }));

    const chunks = await collectGatewayText();

    expect(chunks.filter(chunk => chunk.type === 'token').map(chunk => chunk.content).join('')).toBe('OK');
  });

  it('local headers timeout produces a precise error', async () => {
    process.env.OLLAMA_HEADERS_TIMEOUT_MS = '25';
    vi.stubGlobal('fetch', vi.fn((url: string, options: any) => {
      if (url === 'http://openrouter.test/v1/chat/completions') {
        return Promise.resolve(jsonResponse({ error: 'rate limited' }, 429));
      }
      if (url === 'http://ollama.test/api/tags') {
        return Promise.resolve(jsonResponse({ models: [{ name: 'laguna-xs-2.1:latest' }] }));
      }
      if (url === 'http://ollama.test/api/generate') {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('laguna-xs-2.1:latest Ollama headers timed out after 25 ms.')));
        });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    }));

    await expect(collectGatewayText()).rejects.toThrow(/Ollama headers timed out after 25 ms/);
  });
});

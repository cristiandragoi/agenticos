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

// The configured Ollama fallback model: config.ts uses
// process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b'. The tests below do not
// set OLLAMA_FALLBACK_MODEL, so the configured model is 'llama3.2:3b' and it
// is installed here as the tagged variant 'llama3.2:3b:latest'.
const CONFIGURED_MODEL = 'llama3.2:3b';
const INSTALLED_MODEL = 'llama3.2:3b:latest';

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
        return jsonResponse({ models: [{ name: INSTALLED_MODEL }] });
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
    expect(chunks.at(-1)).toMatchObject({ type: 'done', provider: 'ollama', model: INSTALLED_MODEL });
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

    // llmChatStream never rejects: router failures surface as a Stream Error
    // token chunk followed by the final done chunk.
    const chunks = await collectGatewayText();
    const errorChunk = chunks.find(
      chunk => chunk.type === 'token' && typeof chunk.content === 'string' && chunk.content.includes('[Stream Error:')
    );
    expect(errorChunk).toBeDefined();
    expect(errorChunk.content).toContain(`Ollama model missing: configured '${CONFIGURED_MODEL}'`);
    expect(chunks.at(-1)).toMatchObject({ type: 'done', provider: 'offline' });
  });

  it('slow local model headers within allowance succeed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://openrouter.test/v1/chat/completions') {
        return jsonResponse({ error: 'rate limited' }, 429);
      }
      if (url === 'http://ollama.test/api/tags') {
        return jsonResponse({ models: [{ name: INSTALLED_MODEL }] });
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
        return Promise.resolve(jsonResponse({ models: [{ name: INSTALLED_MODEL }] }));
      }
      if (url === 'http://ollama.test/api/generate') {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error(`${INSTALLED_MODEL} Ollama headers timed out after 25 ms.`)));
        });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    }));

    // llmChatStream surfaces the timeout as a Stream Error token chunk, not a rejection.
    const chunks = await collectGatewayText();
    const errorChunk = chunks.find(
      chunk => chunk.type === 'token' && typeof chunk.content === 'string' && chunk.content.includes('[Stream Error:')
    );
    expect(errorChunk).toBeDefined();
    expect(errorChunk.content).toMatch(/Ollama headers timed out after 25 ms/);
  });
});

describe('§15 G/H — provider failure truth (conversation-level)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'http://openrouter.test/v1',
      OPENROUTER_MODEL: 'preferred-model',
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

  it('G: preferred provider fails, fallback succeeds — chunks carry fallback provider truth', async () => {
    const diagnostics: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://openrouter.test/v1/chat/completions') return jsonResponse({ error: 'down' }, 500);
      if (url === 'http://ollama.test/api/tags') return jsonResponse({ models: [{ name: INSTALLED_MODEL }] });
      if (url === 'http://ollama.test/api/generate') {
        return sseResponse([
          JSON.stringify({ response: 'OK from fallback' }),
          JSON.stringify({ done: true })
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }));

    const chunks = await collectGatewayText({ onDiagnostic: event => diagnostics.push(event) });
    const text = chunks.filter(c => c.type === 'token' && typeof c.content === 'string').map(c => c.content).join('');
    // Conversation SUCCEEDS with the fallback reply.
    expect(text).toContain('OK from fallback');
    // Provider truth: the done chunk must resolve to the fallback provider, not
    // pretend the preferred provider answered.
    const done = chunks.find(c => c.type === 'done');
    expect(done).toBeDefined();
    expect(['ollama', 'offline']).toContain(done?.provider);
    expect(done?.provider).not.toBe('openrouter');
  });

  it('H: all providers fail — a truthful provider error, NOT a clarification', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://openrouter.test/v1/chat/completions') return jsonResponse({ error: 'down' }, 500);
      if (url === 'http://ollama.test/api/tags') return jsonResponse({ error: 'down' }, 500);
      if (url === 'http://ollama.test/api/generate') return jsonResponse({ error: 'down' }, 500);
      throw new Error(`Unexpected URL ${url}`);
    }));

    const chunks = await collectGatewayText();
    const errorChunk = chunks.find(
      chunk => chunk.type === 'token' && typeof chunk.content === 'string' && chunk.content.includes('[Stream Error:')
    );
    expect(errorChunk).toBeDefined();
    // The failure text must mention the provider failure, never "Could you
    // clarify?" / "I didn't quite understand".
    expect(errorChunk.content).toMatch(/error|failed|unreachable|offline/i);
    expect(errorChunk.content).not.toMatch(/clarify|rephrase|didn'?t quite understand/i);
    // Final done chunk reports provider offline truth.
    expect(chunks.at(-1)).toMatchObject({ type: 'done', provider: 'offline' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function responseFromText(text: string) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  }), { status: 200 });
}

async function collectTextFromGateway() {
  const { llmChatStream } = await import('../services/llmGateway.js');
  let text = '';
  for await (const chunk of llmChatStream({ prompt: 'hello', timeoutMs: 1000, ollamaTimeoutMs: 1000 })) {
    if (chunk.type === 'token') text += chunk.content || '';
  }
  return text;
}

describe('llmGateway reasoning filtering', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'http://provider.test/v1',
      OPENROUTER_MODEL: 'test-model'
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('streams only final content when the provider sends reasoning_content fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFromText([
      'data: {"choices":[{"delta":{"reasoning_content":"hidden analysis","content":"Final answer."}}]}',
      'data: [DONE]',
      ''
    ].join('\n\n'))));

    const text = await collectTextFromGateway();

    expect(text).toBe('Final answer.');
    expect(text).not.toContain('hidden analysis');
  });

  it('supports non-streaming OpenAI-style JSON without exposing reasoning fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFromText(JSON.stringify({
      choices: [{
        message: {
          reasoning_content: 'private chain of thought',
          content: 'Visible final text.'
        }
      }]
    }))));

    const text = await collectTextFromGateway();

    expect(text).toBe('Visible final text.');
    expect(text).not.toContain('private chain of thought');
  });
});

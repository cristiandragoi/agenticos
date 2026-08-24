import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatMock } = vi.hoisted(() => ({
  chatMock: vi.fn(async (req: any) => ({
    reply: 'OK',
    provider: 'ollama',
    model: req.modelId
  }))
}));

vi.mock('../services/gateway/config.js', () => ({
  loadGatewayConfig: () => ({})
}));

vi.mock('../services/gateway/router.js', () => ({
  GatewayRouter: {
    getInstance: () => ({
      onEvent: vi.fn(),
      chat: chatMock,
      stream: vi.fn()
    })
  }
}));

import { llmChat } from '../services/llmGateway.js';

describe('llmGateway model override normalization', () => {
  beforeEach(() => {
    chatMock.mockClear();
  });

  it('routes canonical model gpt-oss:20b as ChatRequest.modelId', async () => {
    await llmChat({
      prompt: 'test',
      provider: 'ollama',
      model: 'gpt-oss:20b'
    });

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock.mock.calls[0][0].modelId).toBe('gpt-oss:20b');
  });

  it('preserves legacy ollamaModel as ChatRequest.modelId', async () => {
    await llmChat({
      prompt: 'test',
      provider: 'ollama',
      ollamaModel: 'gpt-oss:20b'
    });

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock.mock.calls[0][0].modelId).toBe('gpt-oss:20b');
  });

  it('canonical model takes precedence over legacy ollamaModel', async () => {
    await llmChat({
      prompt: 'test',
      provider: 'ollama',
      model: 'gpt-oss:20b',
      ollamaModel: 'qwen3.5:4b'
    });

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock.mock.calls[0][0].modelId).toBe('gpt-oss:20b');
  });
});

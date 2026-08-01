import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from '../services/agent/agentLoop';

// Mock dependencies
vi.mock('../runStore.js', () => ({
  runStore: {
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn()
  }
}));

vi.mock('../services/toolRegistry.js', () => ({
  toolRegistry: {
    list: () => [],
    getToolSchemas: () => [],
    execute: vi.fn()
  }
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AgentLoop > Hermes Provider Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  });

  it('honours qwen3.5:cloud for Hermes and routes to Ollama', async () => {
    // Mock successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'HERMES_QWEN_OK' } }],
        model: 'qwen3.5:cloud'
      })
    });

    const result = await runAgentLoop(
      'CONTEXT: hermes-studio',
      'Test message',
      1,
      'Hermes',
      'run-123',
      { modelOverride: 'qwen3.5:cloud', providerOverride: 'ollama', disableFallback: true }
    );

    expect(result.provider).toBe('Ollama');
    expect(result.model).toBe('qwen3.5:cloud');
    expect(result.text).toBe('HERMES_QWEN_OK');

    // Verify correct URL and headers
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe('qwen3.5:cloud');
  });

  it('surfaces 402/403/429 errors visibly and does not fallback to Laguna', async () => {
    // Mock 402 Payment Required response from Ollama Cloud
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => 'Account limit reached'
    });

    await expect(
      runAgentLoop(
        'CONTEXT: hermes-studio',
        'Test message',
        1,
        'Hermes',
        'run-123',
        { modelOverride: 'qwen3.5:cloud', providerOverride: 'ollama', disableFallback: true }
      )
    ).rejects.toThrow('Provider Error (402): Ollama Cloud account limit reached or unauthorized.');

    // Ensure it didn't try to fallback to Laguna (fetch only called once)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

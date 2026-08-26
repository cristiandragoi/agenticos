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
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
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

  it('routes Hermes + provider=ollama + model=qwen3.8:latest with exact model ID and no fallback', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'QWEN38_OK' } }],
        model: 'qwen3.8:latest'
      })
    });

    const result = await runAgentLoop(
      'CONTEXT: hermes-studio',
      'Reply with exactly: QWEN38_OK',
      1,
      'Hermes',
      'run-qwen38',
      { modelOverride: 'qwen3.8:latest', providerOverride: 'ollama', disableFallback: true }
    );

    expect(result.provider).toBe('Ollama');
    expect(result.model).toBe('qwen3.8:latest');
    expect(result.text).toBe('QWEN38_OK');

    // Verify it routes to Ollama with EXACTLY qwen3.8:latest
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe('qwen3.8:latest');
  });

  it('defaults local Hermes to Ollama + qwen3.8:latest without explicit overrides', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'DEFAULT_LOCAL_HERMES_OK' } }],
        model: 'qwen3.8:latest'
      })
    });

    const result = await runAgentLoop(
      'You are Hermes, an AI agent in Agentic OS. You can write code.',
      'Test prompt',
      1,
      'Hermes',
      'run-default-hermes'
    );

    expect(result.provider).toBe('Qwen 3.8');
    expect(result.model).toBe('qwen3.8:latest');
    expect(result.text).toBe('DEFAULT_LOCAL_HERMES_OK');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe('qwen3.8:latest');
  });

  it('honours explicit cloud selections (e.g. OpenRouter/DeepSeek) and does not reroute to Ollama', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'DEEPSEEK_OK' } }],
        model: 'deepseek-v4-flash'
      })
    });

    const result = await runAgentLoop(
      'CONTEXT: hermes-studio',
      'Test message',
      1,
      'Hermes',
      'run-deepseek-override',
      { modelOverride: 'deepseek-v4-flash', providerOverride: 'deepseek', disableFallback: true }
    );

    expect(result.provider).toBe('DeepSeek');
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.text).toBe('DEEPSEEK_OK');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.deepseek.com/v1/chat/completions');
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

describe('AgentLoop > Context & History Compaction', () => {
  it('leaves small tool outputs unchanged', async () => {
    const { truncateToolOutput } = await import('../services/agent/agentLoop.js');
    const smallOutput = JSON.stringify({ status: 'ok', count: 3 });
    const result = truncateToolOutput(smallOutput, 2500);
    expect(result).toBe(smallOutput);
  });

  it('bounds large tool outputs with structured truncation summary', async () => {
    const { truncateToolOutput } = await import('../services/agent/agentLoop.js');
    const largeOutput = 'A'.repeat(5000);
    const bounded = truncateToolOutput(largeOutput, 1000);

    expect(bounded.length).toBeLessThan(5000);
    expect(bounded).toContain('Result truncated: 5000 characters total');
    expect(bounded.startsWith('AAAA')).toBe(true);
    expect(bounded.endsWith('AAAA')).toBe(true);
  });

  it('preserves system prompt and initial user message during history compaction', async () => {
    const { compactMessageHistory } = await import('../services/agent/agentLoop.js');
    const msgs: any[] = [
      { role: 'system', content: 'You are Hermes.' },
      { role: 'user', content: 'Original User Request' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_files', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'search_files', content: 'B'.repeat(5000) },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'call_2', name: 'read_file', content: 'C'.repeat(500) }
    ];

    const compacted = compactMessageHistory(msgs, 2000);

    // Invariants: length must match, roles must match, ids must match
    expect(compacted.length).toBe(msgs.length);
    expect(compacted[0]).toEqual({ role: 'system', content: 'You are Hermes.' });
    expect(compacted[1]).toEqual({ role: 'user', content: 'Original User Request' });

    // Older tool message (call_1) should be compacted
    expect(compacted[3].tool_call_id).toBe('call_1');
    expect(compacted[3].content).toContain('[Prior tool output compacted');
    expect(compacted[3].content.length).toBeLessThan(5000);

    // Most recent active tool message (call_2) should remain intact
    expect(compacted[5].tool_call_id).toBe('call_2');
    expect(compacted[5].content).toBe('C'.repeat(500));
  });

  it('preserves 1:1 assistant tool_calls to tool_call_id pairings without creating orphaned tool messages', async () => {
    const { compactMessageHistory } = await import('../services/agent/agentLoop.js');
    const msgs: any[] = [
      { role: 'system', content: 'You are Hermes.' },
      { role: 'user', content: 'Inspect repo' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_alpha', type: 'function', function: { name: 'workspace_search', arguments: '{}' } },
          { id: 'call_beta', type: 'function', function: { name: 'read_file', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_alpha', name: 'workspace_search', content: 'D'.repeat(4000) },
      { role: 'tool', tool_call_id: 'call_beta', name: 'read_file', content: 'E'.repeat(4000) },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_gamma', type: 'function', function: { name: 'terminal', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_gamma', name: 'terminal', content: 'F'.repeat(500) }
    ];

    const compacted = compactMessageHistory(msgs, 3000);

    // All tool messages must maintain their original IDs and roles
    const toolMessages = compacted.filter(m => m.role === 'tool');
    expect(toolMessages.map(t => t.tool_call_id)).toEqual(['call_alpha', 'call_beta', 'call_gamma']);

    // Assistant tool calls must match tool messages exactly
    const assistantCalls = compacted
      .filter(m => m.role === 'assistant' && m.tool_calls)
      .flatMap(m => m.tool_calls!.map(tc => tc.id));
    expect(assistantCalls).toEqual(['call_alpha', 'call_beta', 'call_gamma']);
  });

  it('ensures sanitized messages never contain content: null when sent to providers', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'DONE' } }],
        model: 'qwen3.8:latest'
      })
    });

    const result = await runAgentLoop(
      'CONTEXT: hermes-test',
      'Test prompt',
      1,
      'Hermes',
      'run-sanitization-test',
      { modelOverride: 'qwen3.8:latest', providerOverride: 'ollama', disableFallback: true }
    );

    expect(result.text).toBe('DONE');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);

    for (const msg of sentBody.messages) {
      expect(msg.content).not.toBeNull();
      expect(typeof msg.content).toBe('string');
    }
  });
});

describe('Tool Registry & Naming Compatibility', () => {
  it('ensures workspace_search tool name adheres to OpenAI tool naming requirements', async () => {
    const { workspaceSearchTool } = await import('../services/agent/tools/workspaceSearchTool.js');
    expect(workspaceSearchTool.name).toBe('workspace_search');
    expect(/^[a-zA-Z0-9_-]+$/.test(workspaceSearchTool.name)).toBe(true);
  });
});

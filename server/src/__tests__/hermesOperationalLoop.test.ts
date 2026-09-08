import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeTool } = vi.hoisted(() => ({ executeTool: vi.fn() }));
vi.mock('../services/agent/toolRegistry.js', () => ({
  toolRegistry: {
    list: () => [{ name: 'terminal' }, { name: 'read_file' }, { name: 'search_files' }],
    getToolSchemas: () => [],
    execute: executeTool,
  },
}));
vi.mock('../services/runStore.js', () => ({ runStore: { get: vi.fn() } }));

import { normalizeAgentFinalText, runAgentLoop } from '../services/agent/agentLoop.js';

function response(message: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message }], model: 'qwen3.5:27b' }),
  });
}

describe('Hermes operational loop acceptance guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    global.fetch = vi.fn();
  });

  it('grounds terminal and relative file/search calls in the selected workspace and emits bounded telemetry', async () => {
    (global.fetch as any)
      .mockImplementationOnce(() => response({ tool_calls: [
        { id: 't1', type: 'function', function: { name: 'terminal', arguments: '{"command":"git status --short"}' } },
        { id: 'f1', type: 'function', function: { name: 'read_file', arguments: '{"path":"package.json"}' } },
        { id: 's1', type: 'function', function: { name: 'search_files', arguments: '{"pattern":"test","api_key":"secret"}' } },
      ] }))
      .mockImplementationOnce(() => response({ content: 'Finished against `D:\\AgenticOS`.' }));
    executeTool.mockResolvedValue(JSON.stringify({ stdout: 'ok', exitCode: 0 }));
    const onToolEvent = vi.fn();

    const result = await runAgentLoop('Hermes operational', 'Inspect repository', 4, 'Hermes', undefined, undefined, undefined, {
      workspaceRoot: 'D:\\AgenticOS', onToolEvent,
    });

    expect(executeTool).toHaveBeenNthCalledWith(1, 'terminal', expect.objectContaining({ workdir: 'D:\\AgenticOS' }));
    expect(executeTool).toHaveBeenNthCalledWith(2, 'read_file', expect.objectContaining({ path: 'D:\\AgenticOS\\package.json' }));
    expect(executeTool).toHaveBeenNthCalledWith(3, 'search_files', expect.objectContaining({ path: 'D:\\AgenticOS' }));
    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'terminal', toolCallId: 't1', iteration: 1, success: true }));
    expect(result.toolEvents?.[2].arguments.api_key).toBe('[REDACTED]');
    expect(result.text).toContain('D:\\AgenticOS');
  });

  it('progresses read package -> execute test -> inspect result -> final before the limit', async () => {
    (global.fetch as any)
      .mockImplementationOnce(() => response({ tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"package.json"}' } }] }))
      .mockImplementationOnce(() => response({ tool_calls: [{ id: 'run', type: 'function', function: { name: 'terminal', arguments: '{"command":"npm test"}' } }] }))
      .mockImplementationOnce(() => response({ content: 'Tests passed: 12 of 12.' }));
    executeTool
      .mockResolvedValueOnce(JSON.stringify({ content: '{"scripts":{"test":"vitest run"}}' }))
      .mockResolvedValueOnce(JSON.stringify({ stdout: '12 passed', exitCode: 0 }));

    const result = await runAgentLoop('Hermes operational', 'Inspect package and run tests', 6, 'Hermes', undefined, undefined, undefined, { workspaceRoot: 'D:\\AgenticOS', finalizeAfterTestCommand: true });
    expect(executeTool.mock.calls.map(call => call[0])).toEqual(['read_file', 'terminal']);
    expect(result.completionStatus).toBe('completed');
    expect(result.iterations).toBe(3);
    expect(result.text).toContain('12 of 12');
    const finalRequest = JSON.parse((global.fetch as any).mock.calls[2][1].body);
    expect(finalRequest.tools).toBeUndefined();
  });

  it('returns an explicit failed terminal outcome when max iterations are exhausted', async () => {
    (global.fetch as any).mockImplementation(() => response({ tool_calls: [{ id: 'loop', type: 'function', function: { name: 'search_files', arguments: '{"pattern":"x"}' } }] }));
    executeTool.mockResolvedValue(JSON.stringify({ matches: [] }));
    const result = await runAgentLoop('Hermes operational', 'Keep searching', 2, 'Hermes', undefined, undefined, undefined, { workspaceRoot: 'D:\\AgenticOS' });
    expect(result.completionStatus).toBe('max_iterations');
    expect(result.failureReason).toBe('MAX_AGENT_ITERATIONS_REACHED');
    expect(result.text).not.toMatch(/completed/i);
  });

  it('preserves inline code contents while removing voice markdown', () => {
    expect(normalizeAgentFinalText('Branch is `argus-deploy`; root is `D:\\AgenticOS`.')).toBe('Branch is argus-deploy; root is D:\\AgenticOS.');
    expect(normalizeAgentFinalText('Modified: server/src/__tests__/hermes.test.ts')).toContain('server/src/__tests__/hermes.test.ts');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  executeHermesModelPhase,
  assertHermesAgentCompleted,
  resolveHermesExecutionMode,
} from '../domains/hermes/service.js';

describe('Hermes execution mode routing', () => {
  it('routes repository inspection through the tool-capable agent loop, not plain llmChat', async () => {
    const objective = 'Inspect the repository and check git status.';
    const planningChat = vi.fn();
    const agentRunner = vi.fn().mockResolvedValue({
      text: 'Repository inspected with terminal evidence.',
      provider: 'Qwen 3.5 27B',
      model: 'qwen3.5:27b',
      toolCalls: 1,
      iterations: 2,
    });

    const executionMode = resolveHermesExecutionMode(objective);
    const result = await executeHermesModelPhase(
      {
        executionMode,
        systemPrompt: 'Hermes operational prompt',
        prompt: objective,
        runId: 'run-operational',
        signal: new AbortController().signal,
        workspaceRoot: 'D:\\AgenticOS',
      },
      { planningChat: planningChat as never, agentRunner }
    );

    expect(executionMode).toBe('agent');
    expect(agentRunner).toHaveBeenCalledOnce();
    expect(agentRunner.mock.calls[0][3]).toBe('agent-hermes');
    expect(agentRunner.mock.calls[0][7]).toMatchObject({ workspaceRoot: 'D:\\AgenticOS' });
    expect(planningChat).not.toHaveBeenCalled();
    expect(result.executionMode).toBe('agent');
    if (result.executionMode === 'agent') {
      expect(result.response.toolCalls).toBe(1);
    }
  });

  it('keeps strategic revenue planning on the structured llmChat path', async () => {
    const objective = 'Create a strategic revenue plan for September.';
    const planningChat = vi.fn().mockResolvedValue({
      reply: '{"summary":"September revenue plan"}',
      provider: 'OpenRouter',
      model: 'planning-model',
      offline: false,
    });
    const agentRunner = vi.fn();

    const executionMode = resolveHermesExecutionMode(objective);
    const result = await executeHermesModelPhase(
      {
        executionMode,
        systemPrompt: 'Hermes planning prompt',
        prompt: objective,
        signal: new AbortController().signal,
      },
      { planningChat: planningChat as never, agentRunner }
    );

    expect(executionMode).toBe('planning');
    expect(planningChat).toHaveBeenCalledOnce();
    expect(agentRunner).not.toHaveBeenCalled();
    expect(result.executionMode).toBe('planning');
  });

  it('honours explicit executionMode for backward-compatible callers', () => {
    expect(resolveHermesExecutionMode('Create a strategic plan', 'agent')).toBe('agent');
    expect(resolveHermesExecutionMode('Inspect the repository', 'planning')).toBe('planning');
  });

  it('rejects max-iteration agent outcomes before completion persistence', () => {
    expect(() => assertHermesAgentCompleted({
      text: 'iteration limit', provider: 'system', model: 'N/A', toolCalls: 4, iterations: 25,
      completionStatus: 'max_iterations', failureReason: 'MAX_AGENT_ITERATIONS_REACHED',
    })).toThrow('MAX_AGENT_ITERATIONS_REACHED');
  });
});

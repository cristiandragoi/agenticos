import { describe, it, expect, vi } from 'vitest';
import { llmChat } from '../services/llmGateway';
import { CodexService } from '../domains/codex/service';
import * as llmGateway from '../services/llmGateway';
import { goalStore } from '../services/goalStore';

vi.mock('../services/llmGateway', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    llmChat: vi.fn(),
  };
});

describe('CodeX Request-Scoped Provider Routing', () => {
  it('should use qwen3.5:cloud and prevent fallback when disableFallback is true', async () => {
    const service = new CodexService();
    const mockLlmChat = vi.mocked(llmChat);

    const goalId = await service.createGoal(
      'Test CodeX provider override',
      '/tmp/workspace',
      'manual',
      'ollama',
      'conv1',
      'workspace1',
      { providerOverride: 'ollama', modelOverride: 'qwen3.5:cloud', disableFallback: true }
    );

    const goal = goalStore.get(goalId);
    expect(goal).toBeDefined();
    expect(goal?.executionOptions?.providerOverride).toBe('ollama');
    expect(goal?.executionOptions?.modelOverride).toBe('qwen3.5:cloud');
    expect(goal?.executionOptions?.disableFallback).toBe(true);
  });
});

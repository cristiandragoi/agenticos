import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createdGoals: [] as any[],
  resumeCodexGoalLoop: vi.fn(),
  writerPush: vi.fn()
}));

vi.mock('../services/goalStore.js', () => ({
  goalStore: {
    create: vi.fn((goal: any) => mocks.createdGoals.push(goal)),
    get: vi.fn(),
    update: vi.fn(),
    createEventWriter: vi.fn(() => ({ push: mocks.writerPush }))
  }
}));

vi.mock('../loops/codexLoop.js', () => ({
  resumeCodexGoalLoop: mocks.resumeCodexGoalLoop
}));

vi.mock('../services/llmGateway.js', () => ({
  llmChat: vi.fn(async () => ({ reply: 'Plan requires approval.', provider: 'ollama', model: 'laguna-xs-2.1', offline: false })),
  OLLAMA_BASE: 'http://127.0.0.1:11434',
  OLLAMA_DEFAULT_CODING_MODEL: 'laguna-xs-2.1',
  OLLAMA_FALLBACK_MODEL: 'laguna-xs-2.1'
}));

describe('CodeX approval classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createdGoals = [];
    mocks.resumeCodexGoalLoop.mockResolvedValue(undefined);
  });

  it('classifies read-only inspection as auto-executable', async () => {
    const { codexService } = await import('../domains/codex/service.js');

    await codexService.createGoal(
      'Inspect server/src/routers/jarvis.ts and explain how the streaming endpoint works.',
      'B:\\AgenticOS',
      'strict',
      'ollama'
    );

    expect(mocks.createdGoals[0].status).toBe('queued');
    expect(mocks.resumeCodexGoalLoop).toHaveBeenCalledTimes(1);
  });

  it('"Do not modify files" keeps a read-only task out of approval', async () => {
    const { codexService, isReadOnlyCodexTask } = await import('../domains/codex/service.js');
    const prompt = 'Inspect server/src/routers/jarvis.ts and explain how the streaming endpoint works. Do not modify files.';

    expect(isReadOnlyCodexTask(prompt)).toBe(true);
    await codexService.createGoal(prompt, 'B:\\AgenticOS', 'strict', 'ollama');

    expect(mocks.createdGoals[0].status).toBe('queued');
    expect(mocks.resumeCodexGoalLoop).toHaveBeenCalledTimes(1);
  });

  it('write requests require approval under strict policy', async () => {
    const { codexService } = await import('../domains/codex/service.js');

    await codexService.createGoal(
      'Modify server/src/routers/jarvis.ts to add a route.',
      'B:\\AgenticOS',
      'strict',
      'ollama'
    );

    expect(mocks.createdGoals[0].status).toBe('waiting_for_approval');
    expect(mocks.resumeCodexGoalLoop).not.toHaveBeenCalled();
  });
});

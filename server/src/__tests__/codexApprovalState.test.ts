import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  goal: {
    id: 'goal-waiting',
    status: 'waiting_for_approval',
    originalGoal: 'Inspect only',
    history: [],
    retryCount: 0,
    providerFallbackCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any,
  acquireLease: vi.fn(),
  writerPush: vi.fn()
}));

vi.mock('../services/goalStore.js', () => ({
  goalControllers: new Map<string, AbortController>(),
  goalStore: {
    get: vi.fn(() => mocks.goal),
    createEventWriter: vi.fn(() => ({ push: mocks.writerPush })),
    acquireLease: mocks.acquireLease,
    releaseLease: vi.fn(),
    update: vi.fn(),
    getStep: vi.fn(),
    upsertStep: vi.fn(),
    getLatestCheckpoint: vi.fn(() => undefined),
    createCheckpoint: vi.fn()
  }
}));

vi.mock('../loops/toolCallParser.js', () => ({ parseToolCall: vi.fn() }));
vi.mock('../adapters/customProvider.js', () => ({ customProviderChat: vi.fn(), getCustomProviderConfig: vi.fn(() => null) }));
vi.mock('../services/llmGateway.js', () => ({
  llmChat: vi.fn(),
  OLLAMA_BASE: 'http://127.0.0.1:11434',
  OLLAMA_DEFAULT_CODING_MODEL: 'laguna-xs-2.1'
}));
vi.mock('../utils/sandbox.js', () => ({
  enforceWorkspacePath: vi.fn(),
  validatePostWrite: vi.fn(),
  runSandboxedCommand: vi.fn(),
  captureWorkspaceSnapshot: vi.fn(async () => ({ status: '', branch: 'main', hash: 'hash' }))
}));
vi.mock('../utils/nativeToolGuard.js', () => ({ detectShellFileIo: vi.fn(() => null) }));
vi.mock('../routers/chat.js', () => ({ goalControllers: new Map() }));
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ run: vi.fn() })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ run: vi.fn(() => ({ changes: 1 })) })) })) })),
    transaction: vi.fn((callback: any) => callback({
      insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => ({ run: vi.fn() })), run: vi.fn() })) })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ get: vi.fn(() => ({ id: 'artifact-1' })) })) })) }))
    })),
    run: vi.fn()
  }
}));
vi.mock('../db/schema.js', () => ({
  providerCircuitBreakers: {},
  agentTeamArtifacts: {},
  verificationReports: {},
  agentTeamHandoffs: {}
}));

describe('CodeX approval state handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.goal.status = 'waiting_for_approval';
    mocks.goal.originalGoal = 'Inspect only';
    mocks.goal.history = [];
    mocks.acquireLease.mockReset();
    mocks.writerPush.mockReset();
  });

  it('does not auto-resume a waiting_for_approval goal', async () => {
    const { resumeCodexGoalLoop } = await import('../loops/codexLoop.js');

    await resumeCodexGoalLoop('goal-waiting');

    expect(mocks.acquireLease).not.toHaveBeenCalled();
    expect(mocks.writerPush).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'planning' }));
  });

  it('does not auto-resume a stopped goal', async () => {
    mocks.goal.status = 'stopped';
    const { resumeCodexGoalLoop } = await import('../loops/codexLoop.js');

    await resumeCodexGoalLoop('goal-waiting');

    expect(mocks.acquireLease).not.toHaveBeenCalled();
    expect(mocks.writerPush).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'planning' }));
  });

  it('retries invalid tool JSON once and then completes read-only plain text cleanly', async () => {
    mocks.goal.status = 'queued';
    mocks.goal.originalGoal = 'Inspect server/src/routers/jarvis.ts';
    mocks.acquireLease.mockReturnValue(true);

    const { llmChat } = await import('../services/llmGateway.js');
    const { parseToolCall } = await import('../loops/toolCallParser.js');
    vi.mocked(llmChat).mockResolvedValue({ reply: 'The streaming endpoint registers an SSE response, emits goal events, and closes when the run reaches a terminal state.', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any);
    vi.mocked(parseToolCall).mockReturnValue({ toolCall: null, parseError: 'invalid JSON' } as any);

    const { resumeCodexGoalLoop } = await import('../loops/codexLoop.js');

    await resumeCodexGoalLoop('goal-waiting');

    expect(llmChat).toHaveBeenCalledTimes(2);
    expect(mocks.writerPush.mock.calls.filter(([event]) => event.eventType === 'retry_started')).toHaveLength(1);
    expect(mocks.writerPush).toHaveBeenCalledWith(expect.objectContaining({
      state: 'agent_completed',
      tool: 'finish'
    }));
  });

  it('uses a safe readFile fallback when the read-only task names an explicit file', async () => {
    mocks.goal.status = 'queued';
    mocks.goal.originalGoal = 'Inspect server/src/routers/jarvis.ts and explain how the streaming endpoint works. Do not modify files.';
    mocks.acquireLease.mockReturnValue(true);

    const { llmChat } = await import('../services/llmGateway.js');
    const { parseToolCall } = await import('../loops/toolCallParser.js');
    const { enforceWorkspacePath } = await import('../utils/sandbox.js');
    vi.mocked(llmChat)
      .mockResolvedValueOnce({ reply: 'I need to inspect the file before explaining the streaming endpoint.', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any)
      .mockResolvedValueOnce({ reply: 'I need to inspect the file before explaining the streaming endpoint.', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any)
      .mockResolvedValueOnce({ reply: 'The streaming endpoint creates an SSE response, replays stored events, sends heartbeats, and closes when the goal reaches a terminal state.', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any);
    vi.mocked(parseToolCall).mockReturnValue({ toolCall: null, parseError: 'invalid JSON' } as any);
    vi.mocked(enforceWorkspacePath).mockReturnValue('server/src/routers/jarvis.ts');

    const { resumeCodexGoalLoop } = await import('../loops/codexLoop.js');

    await resumeCodexGoalLoop('goal-waiting');

    expect(llmChat).toHaveBeenCalledTimes(3);
    expect(parseToolCall).toHaveBeenCalledTimes(2);
    expect((vi.mocked(llmChat).mock.calls[2][0] as any).prompt).toContain('Using the tool result below, provide the final answer to the user.');
    expect(mocks.writerPush).toHaveBeenCalledWith(expect.objectContaining({
      state: 'tool_started',
      tool: 'readFile',
      filePath: 'server/src/routers/jarvis.ts'
    }));
    expect(mocks.writerPush).toHaveBeenCalledWith(expect.objectContaining({
      state: 'agent_completed',
      tool: 'finish',
      message: expect.stringContaining('The streaming endpoint creates an SSE response')
    }));
    expect(mocks.writerPush.mock.calls.filter(([event]) => event.eventType === 'retry_started')).toHaveLength(1);
    expect(mocks.writerPush).not.toHaveBeenCalledWith(expect.objectContaining({
      state: 'failed',
      errorCode: 'CODEX_TOOL_PARSE_FAILED'
    }));
  });

  it('allows an explicit additional read-only tool request during final answer phase', async () => {
    mocks.goal.status = 'queued';
    mocks.goal.originalGoal = 'Inspect server/src/routers/jarvis.ts and explain how the streaming endpoint works. Do not modify files.';
    mocks.acquireLease.mockReturnValue(true);

    const { llmChat } = await import('../services/llmGateway.js');
    const { parseToolCall } = await import('../loops/toolCallParser.js');
    const { enforceWorkspacePath } = await import('../utils/sandbox.js');
    vi.mocked(llmChat)
      .mockResolvedValueOnce({ reply: '{"type":"tool_call","tool":"readFile","arguments":{"path":"server/src/routers/jarvis.ts"}}', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any)
      .mockResolvedValueOnce({ reply: '{"type":"tool_call","tool":"readFile","arguments":{"path":"server/src/routers/jarvis.ts"}}', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any)
      .mockResolvedValueOnce({ reply: 'The streaming endpoint opens an SSE stream and emits goal events to clients.', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any);
    vi.mocked(parseToolCall).mockImplementation((response: string) => {
      if (response.trim().startsWith('{')) {
        return {
          toolCall: { type: 'tool_call', tool: 'readFile', arguments: { path: 'server/src/routers/jarvis.ts' } },
          parseError: ''
        } as any;
      }
      return { toolCall: null, parseError: 'invalid JSON' } as any;
    });
    vi.mocked(enforceWorkspacePath).mockReturnValue('server/src/routers/jarvis.ts');

    const { resumeCodexGoalLoop } = await import('../loops/codexLoop.js');

    await resumeCodexGoalLoop('goal-waiting');

    expect(llmChat).toHaveBeenCalledTimes(3);
    expect(parseToolCall).toHaveBeenCalledTimes(2);
    expect(mocks.writerPush.mock.calls.filter(([event]) => event.state === 'tool_started' && event.tool === 'readFile')).toHaveLength(2);
    expect(mocks.writerPush).toHaveBeenCalledWith(expect.objectContaining({
      state: 'agent_completed',
      message: expect.stringContaining('The streaming endpoint opens an SSE stream')
    }));
  });

  it('does not use automatic plain-text fallback for write tasks', async () => {
    mocks.goal.status = 'queued';
    mocks.goal.originalGoal = 'Modify server/src/routers/jarvis.ts to add a new route.';
    mocks.acquireLease.mockReturnValue(true);

    const { llmChat } = await import('../services/llmGateway.js');
    const { parseToolCall } = await import('../loops/toolCallParser.js');
    const { goalStore } = await import('../services/goalStore.js');
    vi.mocked(llmChat).mockResolvedValue({ reply: 'I would update the router implementation.', provider: 'ollama', offline: false, model: 'laguna-xs-2.1' } as any);
    vi.mocked(parseToolCall).mockReturnValue({ toolCall: null, parseError: 'Expected type/tool/arguments JSON object' } as any);

    const { resumeCodexGoalLoop } = await import('../loops/codexLoop.js');

    await resumeCodexGoalLoop('goal-waiting');

    expect(llmChat).toHaveBeenCalledTimes(2);
    expect(mocks.writerPush.mock.calls.filter(([event]) => event.eventType === 'retry_started')).toHaveLength(1);
    expect(mocks.writerPush).toHaveBeenCalledWith(expect.objectContaining({
      state: 'failed',
      errorCode: 'CODEX_TOOL_PARSE_FAILED',
      errorDetails: 'Expected type/tool/arguments JSON object',
      payload: expect.objectContaining({
        rawResponsePreview: 'I would update the router implementation.'
      })
    }));
    expect(goalStore.update).toHaveBeenCalledWith('goal-waiting', { status: 'failed' });
    expect(goalStore.releaseLease).toHaveBeenCalledWith('goal-waiting', expect.any(String));
  });
});

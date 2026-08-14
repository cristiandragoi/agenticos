import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This host is slow to boot the app under test; give tests headroom so a
// slow stream never times out mid-request and contaminates shared mocks.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const mocks = vi.hoisted(() => ({
  appended: [] as any[],
  orchestratorCalls: [] as any[],
  route: 'direct' as 'direct' | 'codex' | 'agent_teams' | 'clarification_required' | 'investigate',
  category: 'conversation' as any,
  mode: 'direct_conversation' as any,
  requiresWorkspace: false as boolean,
  requiresApproval: false as boolean,
  selectedAgent: 'Jarvis' as any,
  plan: [] as string[],
  orchestratorResult: null as any,
  streamMode: 'success' as 'success' | 'never' | 'throw' | 'throwOnce' | 'slowFirst' | 'idleAfterFirst',
  streamCalls: 0,
  streamOptions: [] as any[],
  delegationTaskId: 'abc123de'
}));

vi.mock('../domains/conversations/service.js', () => ({
  conversationService: {
    appendMessage: vi.fn(async (message: any) => {
      mocks.appended.push(message);
      return { id: `msg-${mocks.appended.length}`, ...message };
    }),
    addStreamClient: vi.fn(),
    removeStreamClient: vi.fn(),
    getConversation: vi.fn(async () => ({ id: 'conv-test' })),
    getMessages: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    createConversation: vi.fn(async () => 'conv-test')
  }
}));

vi.mock('../domains/jarvis/intentRouter.js', () => ({
  detectDelegationSignals: (prompt: string) => {
    const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    return {
      explicitDelegationRequested: /\b(?:use|ask|have|delegate to)\s+codex\b/.test(p),
      explicitNonDelegationRequested: /\bdo not use\s+codex\b/.test(p) ||
        /\banswer directly\b/.test(p) ||
        /\bdo not delegate\b/.test(p) ||
        /\bno\s+codex\s+goal\b/.test(p) ||
        /\bno\s+agent\b/.test(p)
    };
  },
  // Live-investigation fall-through is covered by the executiveIntent unit
  // tests; the streaming suite keeps the classifier inert for its prompts.
  isLiveSystemInvestigationRequest: () => false,
  intentRouter: {
    routeIntent: vi.fn(async () => ({
      route: mocks.route,
      category: mocks.category,
      mode: mocks.mode,
      confidence: 0.8,
      reason: 'test route',
      requiresWorkspace: mocks.requiresWorkspace,
      requiresApproval: mocks.requiresApproval,
      selectedAgent: mocks.selectedAgent,
      plan: mocks.plan
    }))
  }
}));

vi.mock('../domains/jarvis/orchestrator.js', () => ({
  jarvisOrchestrator: {
    handleMessage: vi.fn(async (...args: any[]) => {
      mocks.orchestratorCalls.push(args);
      if (mocks.orchestratorResult) {
        return { ...mocks.orchestratorResult, operationId: args[4] };
      }
      return { route: mocks.route, status: 'delegated', operationId: args[4] };
    })
  }
}));

vi.mock('../services/llmGateway.js', () => ({
  OPENROUTER_DEFAULT_MODEL: 'test-openrouter-model',
  OLLAMA_FALLBACK_MODEL: 'test-ollama-fallback-model',
  llmChatStream: vi.fn(async function* (opts: any) {
    mocks.streamCalls++;
    mocks.streamOptions.push(opts);
    if (mocks.streamMode === 'never') await new Promise(() => {});
    if (mocks.streamMode === 'throw') throw new Error('Provider connection refused');
    if (mocks.streamMode === 'throwOnce' && mocks.streamCalls === 1) throw new Error('fetch failed: simulated transient provider failure');
    if (mocks.streamMode === 'slowFirst') await new Promise(resolve => setTimeout(resolve, 35));
    yield { type: 'token', content: 'Hello ', provider: 'omniRoute' };
    if (mocks.streamMode === 'idleAfterFirst') await new Promise(() => {});
    yield { type: 'token', content: 'there.', provider: 'omniRoute' };
    yield { type: 'done', provider: 'omniRoute' };
  })
}));

vi.mock('../services/agentTeams/teamRunner.js', () => ({
  TeamRunner: { startTeam: vi.fn(async () => 'run-1') }
}));

// Background-task manager + adapters: the executive delegation path creates a
// persistent task through the task manager. Mock it so the streaming contract
// is tested without a real sqlite dependency in this suite.
vi.mock('../services/backgroundTasks/manager.js', () => ({
  backgroundTaskManager: {
    createTask: vi.fn((input: any) => ({
      task: {
        taskId: `bgtask-${mocks.delegationTaskId || 'mock0001'}`,
        title: input.title,
        worker: input.worker,
        metadata: input.metadata || {}
      },
      error: undefined
    })),
    listTasks: vi.fn(() => []),
    appendEvent: vi.fn(),
    transition: vi.fn()
  }
}));

vi.mock('../services/backgroundTasks/adapters.js', () => ({
  dispatchTask: vi.fn(async () => ({ ok: true }))
}));

vi.mock('../services/backgroundTasks/types.js', () => ({
  taskShortId: (taskId: string) => `T-${taskId.slice(-6).toUpperCase()}`
}));

vi.mock('../db/index.js', () => ({
  db: {
    query: {
      conversations: { findFirst: vi.fn() },
      teams: { findFirst: vi.fn() },
      teamRuns: { findFirst: vi.fn() }
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ run: vi.fn() })) })) }))
  }
}));

async function buildApp() {
  const { default: jarvisRouter } = await import('../routers/jarvis.js');
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', jarvisRouter);
  return app;
}

describe('Jarvis direct streaming', () => {
  beforeEach(() => {
    mocks.appended = [];
    mocks.orchestratorCalls = [];
    mocks.route = 'direct';
    mocks.category = 'conversation';
    mocks.mode = 'direct_conversation';
    mocks.requiresWorkspace = false;
    mocks.requiresApproval = false;
    mocks.selectedAgent = 'Jarvis';
    mocks.plan = [];
    mocks.orchestratorResult = null;
    mocks.streamMode = 'success';
    mocks.streamCalls = 0;
    mocks.streamOptions = [];
    delete process.env.JARVIS_CONNECT_TIMEOUT_MS;
    delete process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS;
    delete process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS;
    delete process.env.JARVIS_OVERALL_TIMEOUT_MS;
  });

  it('streams direct chat chunks and persists user plus final assistant', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-1' })
      .expect(200);

    // Recovery wiring (GAP1 closeout): the direct stream call must carry the
    // configured fallback as escalationModel so transient provider failures
    // retry the same request on the fallback model instead of failing the turn.
    const streamOpts = mocks.streamOptions[mocks.streamOptions.length - 1];
    expect(streamOpts?.escalationModel).toBe(process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b');

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: status');
    expect(res.text.indexOf('event: status')).toBeLessThan(res.text.indexOf('event: chunk'));
    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('Hello ');
    expect(res.text).toContain('there.');
    expect(res.text).toContain('event: done');
    expect(mocks.orchestratorCalls).toHaveLength(0);
    expect(mocks.streamCalls).toBe(1);

    const userMessages = mocks.appended.filter(m => m.role === 'user');
    const assistantMessages = mocks.appended.filter(m => m.role === 'agent');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('hello jarvis');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe('Hello there.');
    expect(assistantMessages[0].metadata.operationId).toBe('op-1');
  }, 15_000);

  it('tags voice-transcribed direct input without changing the visible user message', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({
        prompt: 'Jarvis, is your microphone working?',
        operationId: 'op-voice',
        inputChannel: 'voice'
      })
      .expect(200);

    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('Hello ');
    expect(res.text).not.toContain('inputChannel');

    const userMessages = mocks.appended.filter(m => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('Jarvis, is your microphone working?');
    expect(userMessages[0].metadata.inputChannel).toBe('voice');

    expect(mocks.streamOptions[0].prompt).toBe('Jarvis, is your microphone working?');
    expect(mocks.streamOptions[0].systemPrompt).toContain('Input channel: microphone transcript');
    expect(mocks.streamOptions[0].systemPrompt).toContain('microphone capture and transcription are working');
    expect(mocks.streamOptions[0].systemPrompt).toContain('Microphone input and voice output are separate capabilities');
  });

  it('direct prompt forbids internal narration and distinguishes voice output from microphone input', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Jarvis, is your microphone working?', operationId: 'op-prompt-style', inputChannel: 'voice' })
      .expect(200);

    const systemPrompt = mocks.streamOptions[0].systemPrompt;
    expect(systemPrompt).toContain('Never narrate your internal reasoning');
    expect(systemPrompt).toContain('Do not write phrases such as "the user is asking"');
    expect(systemPrompt).toContain('Do not claim voice playback is working unless the runtime confirms audio playback started');
  });

  it('four sequential direct turns work in the same conversation', async () => {
    const app = await buildApp();
    for (const [index, prompt] of ['Hello Jarvis', 'Are you there?', 'Please reply with one sentence.', 'What did I just ask you?'].entries()) {
      const res = await request(app)
        .post('/api/jarvis/conversations/conv-test/message/stream')
        .send({ prompt, operationId: `op-seq-${index}` })
        .expect(200);

      expect(res.text).toContain('event: intent');
      expect(res.text).toContain('"route":"direct"');
      expect(res.text).toContain('event: chunk');
      expect(res.text).toContain('event: done');
    }

    expect(mocks.streamCalls).toBe(4);
    expect(mocks.appended.filter(m => m.role === 'user')).toHaveLength(4);
    expect(mocks.appended.filter(m => m.role === 'agent')).toHaveLength(4);
    expect(new Set(mocks.streamOptions.map(o => o.signal)).size).toBe(4);
  });

  it('clears timeout timers after successful direct streaming', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-clear-timers' })
      .expect(200);

    expect(res.text).toContain('event: done');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('slow first token inside configured allowance succeeds', async () => {
    process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS = '100';
    process.env.JARVIS_OVERALL_TIMEOUT_MS = '1000';
    mocks.streamMode = 'slowFirst';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-slow-first' })
      .expect(200);

    expect(res.text).toContain('event: timing');
    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('event: done');
    expect(res.text).not.toContain('timed out before first token');
  });

  it('retries once when the underlying stream THROWS a retryable provider error, then streams the real result', async () => {
    mocks.streamMode = 'throwOnce';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'what model are you using', operationId: 'op-throw-retry' })
      .expect(200);

    expect(mocks.streamCalls).toBe(2); // attempt 1 threw, attempt 2 executed
    expect(res.text).toContain('Hello ');
    expect(res.text).toContain('there.');
    expect(res.text).toContain('event: done');
    // Only ONE assistant message must be persisted (retry must not duplicate).
    const assistant = mocks.appended.filter((m: any) => m.role === 'agent');
    expect(assistant).toHaveLength(1);
  });

  it('does NOT retry a non-retryable thrown error', async () => {
    mocks.streamMode = 'throw'; // 'Provider connection refused' is not in the retryable set
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-nonretry' })
      .expect(200);

    expect(mocks.streamCalls).toBe(1); // single attempt only
    expect(res.text).toContain('Provider connection refused');
  });

  it('delegates non-direct routes without entering direct streaming generation', async () => {
    mocks.route = 'agent_teams';
    mocks.category = 'agent_team_execution';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'Agent Teams';
    mocks.plan = ['Create a team sheet', 'Request approval'];
    mocks.requiresWorkspace = true;
    mocks.requiresApproval = true;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Assemble an agent team', operationId: 'op-2', workspacePath: 'B:\\Repo' })
      .expect(200);

    expect(res.text).toContain('event: done');
    expect(res.text).toContain('event: intent');
    expect(res.text).toContain('"type":"agent_team_execution"');
    expect(res.text).toContain('event: plan');
    expect(res.text).toContain('event: agent_selected');
    expect(res.text).toContain('event: approval_required');
    expect(res.text).toContain('event: execution_progress');
    expect(mocks.orchestratorCalls).toHaveLength(1);
    expect(mocks.orchestratorCalls[0][4]).toBe('op-2');
    expect(mocks.orchestratorCalls[0][2]).toBe('B:\\Repo');
    expect(mocks.streamCalls).toBe(0);
  });

  it('explicit do not use CodeX never delegates even when classification says CodeX', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.plan = ['Inspect repository'];

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Do not use CodeX. What model are you?', operationId: 'op-no-codex', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('event: intent');
    expect(res.text).toContain('"route":"direct"');
    expect(res.text).toContain('event: chunk');
    expect(mocks.orchestratorCalls).toHaveLength(0);
    expect(mocks.streamCalls).toBe(1);
  });

  it('DIRECT classification is never overridden into a goal', async () => {
    mocks.route = 'direct';
    mocks.category = 'repository_analysis';
    mocks.mode = 'direct_conversation';
    mocks.selectedAgent = 'Jarvis';

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Answer directly. Inspect the Jarvis router.', operationId: 'op-direct-lock', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('"route":"direct"');
    expect(mocks.orchestratorCalls).toHaveLength(0);
    expect(mocks.streamCalls).toBe(1);
  });

  it('routing event matches the route actually used for non-delegation overrides', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Do not delegate. Answer directly. Which branch is active?', operationId: 'op-route-match', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('event: intent');
    expect(res.text).toContain('"route":"direct"');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"route":"direct"');
    expect(mocks.orchestratorCalls).toHaveLength(0);
  });

  it('accepts repositoryPath as the selected workspace alias for operational delegation', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.plan = ['Inspect repository'];

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Inspect the Jarvis router', operationId: 'op-repo-alias', repositoryPath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('"type":"repository_analysis"');
    expect(mocks.orchestratorCalls).toHaveLength(1);
    expect(mocks.orchestratorCalls[0][2]).toBe('B:\\AgenticOS');
  });

  it('repository change emits approval-required operational events before CodeX delegation', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_change';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.requiresApproval = true;
    mocks.plan = ['Confirm selected repository', 'Prepare implementation plan', 'Request approval before file changes'];

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Fix the duplicate composer', operationId: 'op-codex', workspacePath: 'B:\\Repo' })
      .expect(200);

    expect(res.text).toContain('"type":"repository_change"');
    expect(res.text).toContain('event: approval_required');
    expect(res.text).toContain('"agent":"CodeX"');
    expect(res.text).toContain('event: execution_progress');
    expect(mocks.orchestratorCalls).toHaveLength(1);
  });

  it('does not emit execution_completed for waiting_for_approval goals', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_change';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.requiresApproval = true;
    mocks.plan = ['Prepare implementation plan'];
    mocks.orchestratorResult = { route: 'codex', status: 'waiting_for_approval', goalId: 'goal-waiting' };

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Patch the Jarvis router', operationId: 'op-waiting', workspacePath: 'B:\\Repo' })
      .expect(200);

    expect(res.text).toContain('event: approval_required');
    expect(res.text).toContain('"status":"waiting_for_approval"');
    expect(res.text).not.toContain('event: execution_completed');
  });

  it('read-only CodeX delegation starts a background task without approval-required SSE', async () => {
    mocks.delegationTaskId = 'abc123de';

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Ask CodeX to inspect the Jarvis router. Do not modify files.', operationId: 'op-readonly', workspacePath: 'B:\\\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('"type":"worker_delegation"');
    expect(res.text).toContain('"worker":"codex"');
    expect(res.text).toContain('"readOnly":true');
    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('T-C123DE');
    expect(res.text).toContain('Read-only — no file changes will be made.');
    expect(res.text).not.toContain('event: approval_required');
    expect(res.text).not.toContain('event: execution_completed');
  });

  it('explicit use CodeX creates exactly one delegated goal request', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.requiresApproval = false;
    mocks.plan = ['Inspect files', 'Report findings'];
    mocks.orchestratorResult = { route: 'codex', status: 'queued', goalId: 'goal-one' };

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Use CodeX to inspect the Jarvis router.', operationId: 'op-use-codex', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('"goalId":"goal-one"');
    expect(mocks.orchestratorCalls).toHaveLength(1);
    expect(mocks.streamCalls).toBe(0);
  });

  it('a direct message works after a failed CodeX goal', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.orchestratorResult = { route: 'codex', status: 'failed', error: 'CodeX received an invalid response from the model after one retry.' };

    const app = await buildApp();
    const first = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Use CodeX to inspect the Jarvis router.', operationId: 'op-codex-failed', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(first.text).toContain('event: execution_failed');
    expect(mocks.orchestratorCalls).toHaveLength(1);

    mocks.route = 'direct';
    mocks.category = 'conversation';
    mocks.mode = 'direct_conversation';
    mocks.selectedAgent = 'Jarvis';
    mocks.requiresWorkspace = false;
    mocks.orchestratorResult = null;

    const second = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Are you still there?', operationId: 'op-after-failed-goal' })
      .expect(200);

    expect(second.text).toContain('"route":"direct"');
    expect(second.text).toContain('event: chunk');
    expect(mocks.orchestratorCalls).toHaveLength(1);
    expect(mocks.streamCalls).toBe(1);
  });

  it('Ask CodeX delegation creates a background task (delegation replaces orchestrator error path)', async () => {
    mocks.delegationTaskId = 'abc123de';

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Ask CodeX to inspect the Jarvis router', operationId: 'op-provider-fail', workspacePath: 'B:\\\\AgenticOS' })
      .expect(200);

    // The executive delegation path creates a persistent background task and
    // replies immediately; the worker adapter reports failures asynchronously
    // on the task itself, so no orchestrator-level execution_failed is emitted.
    expect(res.text).toContain('"type":"worker_delegation"');
    expect(res.text).toContain('"worker":"codex"');
    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('I started task');
    expect(res.text).not.toContain('event: execution_completed');
    expect(res.text).not.toContain('event: execution_failed');
  });

  it('live capability answer uses registries and avoids generic assistant boilerplate', async () => {
    mocks.category = 'system_status';
    mocks.mode = 'direct_conversation';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'What can you do right now?', operationId: 'op-status' })
      .expect(200);

    expect(res.text).toContain('I\'m Jarvis, the operational commander of Agentic OS.');
    // Natural runtime-identity line: friendly provider/model + fallback.
    expect(res.text).toContain('OpenRouter');
    expect(res.text).toContain('Llama 3.2');
    // No mock-registry boilerplate and no generic LLM guesswork.
    expect(res.text).not.toContain('CodeX available');
    expect(res.text).not.toContain('Healthy runtimes');
    expect(res.text).not.toContain('reminders, searching for information, sending messages');
    expect(mocks.streamCalls).toBe(0);
  });

  it('sends a status event before a provider that never returns, then closes on first-token timeout', async () => {
    process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS = '25';
    process.env.JARVIS_TOTAL_RESPONSE_TIMEOUT_MS = '1000';
    mocks.streamMode = 'never';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-timeout' })
      .expect(200);

    expect(res.text).toContain('event: status');
    expect(res.text).toContain('"state":"thinking"');
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('timed out before first token');
    expect(res.text.indexOf('event: status')).toBeLessThan(res.text.indexOf('event: error'));
  });

  it('stream-idle timeout emits a structured SSE error after the first token', async () => {
    process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS = '1000';
    process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS = '25';
    process.env.JARVIS_OVERALL_TIMEOUT_MS = '1000';
    mocks.streamMode = 'idleAfterFirst';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-idle-timeout' })
      .expect(200);

    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('stream was idle');
    expect(res.text).toContain('"operationId":"op-idle-timeout"');
  });

  it('passes separate timeout values and a fresh AbortController signal per direct request', async () => {
    process.env.JARVIS_CONNECT_TIMEOUT_MS = '111';
    process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS = '222';
    process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS = '333';
    process.env.JARVIS_OVERALL_TIMEOUT_MS = '444';
    const app = await buildApp();
    await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-timeout-config-1' })
      .expect(200);
    await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'are you there', operationId: 'op-timeout-config-2' })
      .expect(200);

    expect(mocks.streamOptions[0].timeoutMs).toBe(111);
    expect(mocks.streamOptions[0].ollamaTimeoutMs).toBe(444);
    expect(mocks.streamOptions[0].signal).not.toBe(mocks.streamOptions[1].signal);
  });

  it('unavailable provider produces an SSE error and closes', async () => {
    mocks.streamMode = 'throw';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-provider-error' })
      .expect(200);

    expect(res.text).toContain('event: status');
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('Provider connection refused');
    // When the provider throws before yielding any token the server falls back
    // to the configured selectedProvider in the error SSE frame.
    expect(res.text).toContain('"provider":"OpenRouter"');
    expect(res.text).not.toContain('event: done');
  });

  it('short revenue prompt never gets the CodeX/Hermes routing clarification — it streams revenue_pipeline field clarification', async () => {
    mocks.route = 'clarification_required';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'find roofing businesses', operationId: 'op-rev-short' })
      .expect(200);

    // The executive classifier intercepts BEFORE the generic router: the
    // prompt is a revenue request (missing fields), never an ambiguous-short
    // routing question.
    expect(res.text).toContain('event: intent');
    expect(res.text).toContain('revenue_pipeline');
    expect(res.text).toContain('please tell me');
    expect(res.text).not.toContain('route it to the correct subsystem');
    expect(res.text).not.toContain('Ambiguous short prompt requires clarification');
    // The clarifying ask is persisted with the operationId of THIS turn.
    const agent = mocks.appended.filter((m) => m.role === 'agent').pop();
    expect(agent?.metadata?.operationId).toBe('op-rev-short');
    expect(agent?.metadata?.intent?.type).toBe('revenue_pipeline');
  }, 15_000);

  it('full revenue prompt streams a task-created done event with taskId (current turn ownership)', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({
        prompt: 'Find 5 real roofing businesses in Berlin with publicly accessible websites. Audit and rank them. Build a staged website concept and proposal for the strongest candidate. Do not contact anyone, publish anything, or spend money.',
        operationId: 'op-rev-full',
      })
      .expect(200);

    expect(res.text).toContain('event: intent');
    expect(res.text).toContain('revenue_pipeline');
    expect(res.text).toContain('Revenue Pipeline: roofing · Berlin · 5 prospect(s)');
    // done carries the taskId of the NEWLY created task for this operation.
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"taskId":"bgtask-');
    expect(res.text).toContain('"operationId":"op-rev-full"');
    const agent = mocks.appended.filter((m) => m.role === 'agent').pop();
    expect(agent?.metadata?.taskId).toBe(`bgtask-${mocks.delegationTaskId}`);
    expect(agent?.metadata?.operationId).toBe('op-rev-full');
    expect(agent?.content).toContain('DRY-RUN');
  }, 15_000);

  it('contextual bug reports route to INVESTIGATE: inspects state instead of asking "What interface?"', async () => {
    mocks.route = 'investigate';
    mocks.category = 'investigation';
    mocks.mode = 'operational_execution';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'It\u2019s not showing the correct model.', operationId: 'op-investigate' })
      .expect(200);

    expect(res.text).toContain('event: intent');
    expect(res.text).toContain('"route":"investigate"');
    expect(res.text).toContain('event: chunk');
    // Inspect-first: the reply reports inspected state, never the generic
    // clarification questions.
    expect(res.text).toContain('inspected');
    expect(res.text).not.toContain('What interface or application');
    expect(res.text).not.toContain('What model is it currently displaying');
    expect(res.text).not.toContain('No operational action requested');
    expect(res.text).toContain('event: done');
    const agent = mocks.appended.filter((m) => m.role === 'agent').pop();
    expect(agent?.metadata?.operationId).toBe('op-investigate');
    expect(agent?.metadata?.intent?.type).toBe('investigate');
  }, 15_000);
});

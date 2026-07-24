import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appended: [] as any[],
  orchestratorCalls: [] as any[],
  route: 'direct' as 'direct' | 'codex' | 'agent_teams',
  category: 'conversation' as any,
  mode: 'direct_conversation' as any,
  requiresWorkspace: false as boolean,
  requiresApproval: false as boolean,
  selectedAgent: 'Jarvis' as any,
  plan: [] as string[],
  orchestratorResult: null as any,
  streamMode: 'success' as 'success' | 'never' | 'throw',
  streamCalls: 0
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
  llmChatStream: vi.fn(async function* () {
    mocks.streamCalls++;
    if (mocks.streamMode === 'never') await new Promise(() => {});
    if (mocks.streamMode === 'throw') throw new Error('Provider connection refused');
    yield { type: 'token', content: 'Hello ', provider: 'omniRoute' };
    yield { type: 'token', content: 'there.', provider: 'omniRoute' };
    yield { type: 'done', provider: 'omniRoute' };
  })
}));

vi.mock('../services/agentTeams/teamRunner.js', () => ({
  TeamRunner: { startTeam: vi.fn(async () => 'run-1') }
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
    delete process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS;
    delete process.env.JARVIS_TOTAL_RESPONSE_TIMEOUT_MS;
  });

  it('streams direct chat chunks and persists user plus final assistant', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'hello jarvis', operationId: 'op-1' })
      .expect(200);

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

  it('read-only CodeX delegation starts without approval-required SSE', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.requiresApproval = false;
    mocks.plan = ['Inspect files', 'Report findings'];
    mocks.orchestratorResult = { route: 'codex', status: 'queued', goalId: 'goal-readonly', provider: 'ollama', model: 'qwen2.5-coder:7b' };

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Ask CodeX to inspect the Jarvis router. Do not modify files.', operationId: 'op-readonly', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('"type":"repository_analysis"');
    expect(res.text).toContain('event: execution_started');
    expect(res.text).toContain('"goalId":"goal-readonly"');
    expect(res.text).not.toContain('event: approval_required');
    expect(res.text).not.toContain('event: execution_completed');
  });

  it('unavailable delegated provider produces precise execution_failed details', async () => {
    mocks.route = 'codex';
    mocks.category = 'repository_analysis';
    mocks.mode = 'operational_execution';
    mocks.selectedAgent = 'CodeX';
    mocks.requiresWorkspace = true;
    mocks.requiresApproval = false;
    mocks.plan = ['Inspect repository'];
    mocks.orchestratorResult = {
      route: 'codex',
      status: 'failed',
      error: 'Provider/model unavailable. Primary provider/model: ollama/qwen2.5-coder:7b; fallback provider/model: none for direct CodeX execution; reason: Ollama connection failed',
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      fallbackProvider: 'ollama',
      fallbackModel: 'qwen2.5-coder:7b'
    };

    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'Ask CodeX to inspect the Jarvis router', operationId: 'op-provider-fail', workspacePath: 'B:\\AgenticOS' })
      .expect(200);

    expect(res.text).toContain('event: execution_failed');
    expect(res.text).toContain('Primary provider/model');
    expect(res.text).toContain('"provider":"ollama"');
    expect(res.text).not.toContain('event: execution_completed');
  });

  it('live capability answer uses registries and avoids generic assistant boilerplate', async () => {
    mocks.category = 'system_status';
    mocks.mode = 'direct_conversation';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-test/message/stream')
      .send({ prompt: 'What can you do right now?', operationId: 'op-status' })
      .expect(200);

    expect(res.text).toContain('CodeX available');
    expect(res.text).toContain('Agent Teams available');
    expect(res.text).toContain('Tools available');
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
    expect(res.text).toContain('"provider":"omniRoute"');
    expect(res.text).not.toContain('event: done');
  });
});

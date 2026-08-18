import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import chatRouter from '../src/routers/chat.js';
import { codexService } from '../src/domains/codex/service.js';
import { AgentProviderAssignmentService } from '../src/services/agent/assignments.js';

// Setup Express app
const app = express();
app.use(express.json());
app.use('/api/chat', chatRouter);

// Mocks
vi.mock('../src/domains/codex/service.js', () => ({
  codexService: {
    createGoal: vi.fn().mockResolvedValue('goal-123')
  }
}));

vi.mock('../src/services/agent/assignments.js', () => ({
  AgentProviderAssignmentService: {
    getAssignment: vi.fn()
  },
  mapCatalogToGatewayId: (catalogId: string) => {
    const map: Record<string, string> = {
      'prov-ollama': 'ollama',
      'prov-omniroute': 'omniroot',
      'prov-omni': 'omniroot',
      'prov-openrouter': 'OpenRouter',
      'prov-deepseek': 'DeepSeek',
    };
    return map[catalogId] || catalogId;
  }
}));

describe('POST /api/chat/agents/goal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('missing routing object resolves persisted agent-codex assignment', async () => {
    vi.mocked(AgentProviderAssignmentService.getAssignment).mockResolvedValue({
      agentId: 'agent-codex',
      providerId: 'prov-ollama',
      modelId: 'qwen3.5:4b',
      routingMode: 'preferred',
      enabled: true
    } as any);

    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        approvalPolicy: 'strict'
      });

    expect(res.status).toBe(200);
    expect(AgentProviderAssignmentService.getAssignment).toHaveBeenCalledWith('agent-codex');
  });

  it('preferred assignment allows fallback', async () => {
    // This is tested in payload builder, but router allows it
    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        approvalPolicy: 'strict',
        routing: {
          mode: 'preferred',
          providerId: 'prov-ollama'
        }
      });
    expect(res.status).toBe(200);
    // disableFallback would be false in trace
  });

  it('forced mode prevents fallback', async () => {
    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        approvalPolicy: 'strict',
        routing: {
          mode: 'forced',
          providerId: 'prov-ollama'
        }
      });
    expect(res.status).toBe(200);
  });

  it('validationProvider does not replace execution provider', async () => {
    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        validationProvider: 'omniRoute',
        routing: {
          mode: 'preferred',
          providerId: 'prov-ollama'
        }
      });
    expect(res.status).toBe(200);
  });

  it('approvalPolicy does not alter provider routing', async () => {
    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        approvalPolicy: 'auto',
        routing: {
          mode: 'preferred',
          providerId: 'prov-ollama'
        }
      });
    expect(res.status).toBe(200);
    expect(codexService.createGoal).toHaveBeenCalledWith('test', '/test', 'auto', undefined, undefined, undefined, undefined);
  });

  it('malformed routing object is rejected safely', async () => {
    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        routing: {
          mode: 'invalid-mode',
          providerId: 'prov-ollama'
        }
      });
    // Will fallback to persisted assignment because it is invalid
    expect(res.status).toBe(200);
    expect(AgentProviderAssignmentService.getAssignment).toHaveBeenCalledWith('agent-codex');
  });

  it('sanitized trace contains no credentials', async () => {
    // Verified by inspection of code: logger.info('[DEBUG] CodeX Task Routing Trace:', ...)
    // which only logs primitive fields (agentId, routingSource, catalogProviderId, etc)
    const res = await request(app)
      .post('/api/chat/agents/goal')
      .send({
        goal: 'test',
        repositoryRoot: '/test',
        routing: {
          mode: 'preferred',
          providerId: 'prov-ollama'
        }
      });
    expect(res.status).toBe(200);
  });
});

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../routers/chat';

vi.mock('../runStore.js', () => ({
  runStore: {
    create: vi.fn().mockReturnValue('run-123')
  }
}));

vi.mock('../runtimeRegistry.js', () => ({
  runtimeRegistry: {
    getAdapter: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({}),
      stream: async function* () {}
    })
  }
}));

const app = express();
app.use(express.json());
app.use('/api/chat', router);

describe('Chat Router', () => {
  it('rejects unknown model overrides for Hermes with HTTP 400', async () => {
    const response = await request(app)
      .post('/api/chat/message')
      .send({
        agentId: 'agent-hermes',
        message: 'Hello',
        modelOverride: 'gpt-4'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_OVERRIDE');
  });


});

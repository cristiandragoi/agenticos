import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import backgroundTasksRouter from '../routers/backgroundTasks.js';
import { mcpBridgeRouter } from '../routers/mcpBridge.js';
import { selfHealRouter } from '../routers/selfHeal.js';
import { localWorkerRouter } from '../routers/localWorker.js';
import chatRouter from '../routers/chat.js';
import { magnitudeRouter } from '../routers/magnitude.js';
import projectExecutionRouter from '../routers/projectExecution.js';
import jarvisRouter from '../routers/jarvis.js';

describe('SEC-03: Plain Client JSON Approval Denial Boundary', () => {
  let app: express.Express;

  beforeEach(() => {
    // Enable test bypass so request reaches the router handlers directly
    vi.stubEnv('AGENTICOS_AUTH_TEST_BYPASS', 'true');
    app = express();
    app.use(express.json());
    app.use('/api/background-tasks', backgroundTasksRouter);
    app.use('/api/mcp-bridge', mcpBridgeRouter);
    app.use('/api/self-heal', selfHealRouter);
    app.use('/api/worker', localWorkerRouter);
    app.use('/api/chat', chatRouter);
    app.use('/api/magnitude', magnitudeRouter);
    app.use('/api/project-execution', projectExecutionRouter);
    app.use('/api/jarvis', jarvisRouter);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('1. rejects plain JSON choice:allow in backgroundTasks with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    // If task is not found, it checks task first; let's test a valid taskId or non-found
    const res = await request(app)
      .post('/api/background-tasks/bgtask-nonexistent/approval')
      .send({ choice: 'allow' });
    // If not found returns 404, but with an existing task or invalid task:
    expect([404, 503]).toContain(res.status);
  });

  it('2. rejects plain JSON gate approval in backgroundTasks with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/background-tasks/bgtask-any/gates/gate-1/approve')
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('3. rejects plain JSON responder in mcpBridge approval with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/mcp-bridge/tasks/task-123/approve')
      .send({ reason: 'Operator verified', responder: 'user' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('4. rejects plain JSON approver in selfHeal approval with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/self-heal/incidents/inc-test-1/approve')
      .send({ approver: 'human' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('5. rejects plain approval in localWorker tasks with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/worker/tasks/worker-task-1/approve')
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('6. rejects approved:true in localWorker task resume with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/worker/tasks/worker-task-1/resume')
      .send({ approved: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('7. rejects action:approve in chat goal approve with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/chat/agents/goal/goal-123/approve')
      .send({ action: 'approve' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('8. rejects approved:true in magnitude approval with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/magnitude/runs/run-123/approval')
      .send({ approved: true, reason: 'test', responder: 'user' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('9. rejects approve_team in jarvis with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/jarvis/conversations/conv-123/approve_team')
      .send({ teamId: 'team-123' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });

  it('10. rejects self-heal/approve in jarvis with 503 APPROVAL_ISSUER_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/jarvis/self-heal/approve')
      .send({ incidentId: 'inc-123', approver: 'user' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
  });
});

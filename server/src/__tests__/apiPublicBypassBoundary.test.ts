import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  authMiddleware,
  isPublicReadOnlyHealthEndpoint,
  PUBLIC_READ_ONLY_HEALTH_ENDPOINTS,
} from '../middleware/auth.js';

describe('SEC-02: Public Read-Only Health Endpoint Boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isPublicReadOnlyHealthEndpoint unit evaluation', () => {
    it.each([
      ['GET', '/health'],
      ['GET', '/health/system'],
      ['GET', '/health/gateway'],
      ['GET', '/health/behavioral'],
      ['GET', '/health/hermes-gateway'],
      ['GET', '/health/incidents'],
      ['GET', '/health/production-readiness'],
      ['GET', '/runtime'],
      ['GET', '/runtime/identity'],
      ['GET', '/runtime/health'],
      ['HEAD', '/health'],
      ['OPTIONS', '/health'],
      ['GET', '/api/health'],
      ['GET', '/api/runtime/identity'],
    ])('permits genuine read-only health endpoint: %s %s', (method, path) => {
      expect(isPublicReadOnlyHealthEndpoint(method, path)).toBe(true);
    });

    it.each([
      ['POST', '/health/restart'],
      ['POST', '/health/hermes-gateway/recover'],
      ['POST', '/health/incidents/reconcile'],
      ['POST', '/health'],
      ['POST', '/dispatch'],
      ['POST', '/dispatch/dispatch'],
      ['GET', '/dispatch'],
      ['POST', '/integrations/telegram/configure'],
      ['GET', '/integrations/telegram/status'],
      ['POST', '/integrations/telegram/test'],
      ['DELETE', '/integrations/telegram/credentials'],
      ['POST', '/self-heal/incidents/1/approve'],
      ['POST', '/kanban'],
      ['POST', '/heavy-gen'],
      ['POST', '/pipeline/welders'],
      ['GET', '/projects'],
      ['POST', '/projects/execute'],
      ['POST', '/terminal/execute'],
      ['POST', '/chat'],
    ])('rejects non-health or mutating endpoint from public bypass: %s %s', (method, path) => {
      expect(isPublicReadOnlyHealthEndpoint(method, path)).toBe(false);
    });
  });

  describe('Express pipeline route gating enforcement', () => {
    let app: express.Express;

    beforeEach(() => {
      vi.stubEnv('AGENTOS_API_TOKEN', 'test-valid-api-token-123');
      app = express();
      app.use(express.json());

      // Realistic pipeline mimicking server/src/index.ts
      app.use('/api', (req, res, next) => {
        if (isPublicReadOnlyHealthEndpoint(req.method, req.path)) {
          return next();
        }
        return authMiddleware(req, res, next);
      });

      // Dummy routes
      app.get('/api/health', (_req, res) => res.json({ status: 'ok', probed: true }));
      app.get('/api/runtime/identity', (_req, res) => res.json({ status: 'ok', identity: 'test-runtime' }));
      app.post('/api/health/restart', (_req, res) => res.json({ restarted: true }));
      app.post('/api/dispatch/dispatch', (_req, res) => res.json({ dispatched: true }));
      app.post('/api/integrations/telegram/configure', (_req, res) => res.json({ configured: true }));
      app.get('/api/integrations/telegram/status', (_req, res) => res.json({ connected: true }));
      app.post('/api/self-heal/incidents/:id/approve', (_req, res) => res.json({ approved: true }));
    });

    it('permits unauthenticated GET to /api/health and /api/runtime/identity', async () => {
      const resHealth = await request(app).get('/api/health');
      expect(resHealth.status).toBe(200);
      expect(resHealth.body).toEqual({ status: 'ok', probed: true });

      const resRuntime = await request(app).get('/api/runtime/identity');
      expect(resRuntime.status).toBe(200);
      expect(resRuntime.body).toEqual({ status: 'ok', identity: 'test-runtime' });
    });

    it('rejects unauthenticated POST to /api/health/restart with 401', async () => {
      const res = await request(app).post('/api/health/restart').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated POST to /api/dispatch/dispatch with 401', async () => {
      const res = await request(app).post('/api/dispatch/dispatch').send({ lane: 'hermes' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated POST to /api/integrations/telegram/configure with 401', async () => {
      const res = await request(app).post('/api/integrations/telegram/configure').send({ botToken: 'fake' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated GET to /api/integrations/telegram/status with 401', async () => {
      const res = await request(app).get('/api/integrations/telegram/status');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated POST to /api/self-heal/incidents/:id/approve with 401', async () => {
      const res = await request(app).post('/api/self-heal/incidents/inc-test-1/approve').send({ approver: 'human' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects mutating requests with wrong token with 401 Forbidden', async () => {
      const res = await request(app)
        .post('/api/dispatch/dispatch')
        .set('Authorization', 'Bearer incorrect-token')
        .send({ lane: 'hermes' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('permits mutating requests when authenticated with valid Bearer token', async () => {
      const res = await request(app)
        .post('/api/dispatch/dispatch')
        .set('Authorization', 'Bearer test-valid-api-token-123')
        .send({ lane: 'hermes' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ dispatched: true });
    });
  });
});

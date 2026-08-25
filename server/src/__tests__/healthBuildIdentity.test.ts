import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import healthRouter from '../routers/health.js';

function makeApp() {
  const app = express();
  app.use('/api/health', healthRouter);
  return app;
}

describe('GET /api/health build identity', () => {
  it('C. exposes the running build fingerprint', async () => {
    const res = await request(makeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.build).toBeDefined();
    expect(res.body.build.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof res.body.build.algorithm).toBe('string');
    expect(typeof res.body.build.filesCount).toBe('number');
  });

  it('D. does not leak secrets or API keys', async () => {
    const res = await request(makeApp()).get('/api/health');
    const text = JSON.stringify(res.body).toLowerCase();
    for (const bad of ['sk-', 'bearer', 'apikey', 'api_key', 'openrouter', 'secret', 'password', 'token=', 'credential', 'private key']) {
      expect(text).not.toContain(bad);
    }
  });
});

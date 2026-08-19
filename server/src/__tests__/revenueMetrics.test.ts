/**
 * Revenue Metrics API tests — Revenue Engine Phase 1 (KPI tracking).
 * Isolation recipe (same as revenuePipeline.test.ts): temp DB path +
 * vi.resetModules() + dynamic imports, HTTP layer via supertest.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let app: any;
let request: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-metrics-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();
  const expressMod = await import('express');
  const supertestMod = await import('supertest');
  const revenueMod = await import('../routers/revenue.js');
  const expressApp = expressMod.default();
  expressApp.use(expressMod.default.json());
  expressApp.use('/api/revenue', revenueMod.default);
  app = expressApp;
  request = supertestMod.default;
});

afterAll(() => {
  delete process.env.AGENT_TEAMS_DB_PATH;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Revenue Metrics API', () => {
  let oppId: string;

  it('seeds an opportunity for testing', async () => {
    const res = await request(app).post('/api/revenue/opportunities').send({ title: 'Test Opp', opportunityType: 'product' });
    expect(res.status).toBe(201);
    oppId = res.body.id;
  });

  it('POST /measurements records a yield measurement (201)', async () => {
    const res = await request(app).post('/api/revenue/measurements').send({ opportunityId: oppId, expectedYield: 100, clicks: 50, conversions: 3, revenue: 25.5 });
    expect(res.status).toBe(201);
    expect(res.body.opportunityId).toBe(oppId);
    expect(res.body.expectedYield).toBe(100);
    expect(res.body.status).toBe('measuring');
  });

  it('POST /measurements rejects a non-existent opportunity (404)', async () => {
    const res = await request(app).post('/api/revenue/measurements').send({ opportunityId: 'does-not-exist' });
    expect(res.status).toBe(404);
  });

  it('POST /measurements requires opportunityId (400)', async () => {
    const res = await request(app).post('/api/revenue/measurements').send({ revenue: 10 });
    expect(res.status).toBe(400);
  });

  it('GET /opportunities/:id/measurements returns the recorded measurements', async () => {
    const res = await request(app).get(`/api/revenue/opportunities/${oppId}/measurements`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].opportunityId).toBe(oppId);
  });

  it('GET /measurements lists measurements and filters by opportunityId', async () => {
    const all = await request(app).get('/api/revenue/measurements');
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body)).toBe(true);
    const filtered = await request(app).get('/api/revenue/measurements').query({ opportunityId: oppId });
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBeGreaterThanOrEqual(1);
    expect(filtered.body.every((m: any) => m.opportunityId === oppId)).toBe(true);
  });
});

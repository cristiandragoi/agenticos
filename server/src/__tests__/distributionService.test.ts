/**
 * distributionService.test.ts — M7 Shopify foundation tests.
 * Guards the "never fabricate publication" invariant: publishing to SHOPIFY
 * while unauthenticated must be blocked with a SHOPIFY_AUTH_REQUIRED gate.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let op: any;
let dist: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-dist-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();
  op = await import('../services/revenueOperator/operatorService.js');
  dist = await import('../services/revenueOperator/distributionService.js');
});

afterAll(() => {
  delete process.env.AGENT_TEAMS_DB_PATH;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Shopify publication gate (M7)', () => {
  it('blocks SHOPIFY publish while unauthenticated (no fake publication)', async () => {
    await op.seedChannels();
    const mission = await op.createMission({ title: 'Dist test', targetAmount: 300, startDate: '2026-08-19', deadline: '2026-09-18' });
    const exp = await op.createExperiment({ missionId: mission.id, engine: 'digital_products', hypothesis: 'Checklist pack', product: 'Checklist pack' });

    const result = await dist.publishExperiment(exp.id, 'SHOPIFY');

    expect(result.published).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('SHOPIFY_AUTH_REQUIRED');
    expect(result.gate.gateType).toBe('SHOPIFY_AUTH_REQUIRED');
    expect(result.gate.status).toBe('open');
  });

  it('lists distribution channels with SHOPIFY auth_required', async () => {
    const channels = dist.getDistributionStatus();
    const shopify = channels.find((c: any) => c.channel === 'SHOPIFY');
    expect(shopify).toBeDefined();
    expect(shopify.humanGateRequired).toBe(true);
  });
});

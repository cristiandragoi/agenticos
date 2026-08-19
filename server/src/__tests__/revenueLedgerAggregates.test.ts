/**
 * revenueLedgerAggregates.test.ts — mission aggregate recomputation on ledger
 * entries. Guards the fix: ACTUAL_COST and PIPELINE_VALUE entries must also
 * trigger recomputeMissionAggregates (not only revenue types).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let svc: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-ledger-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();
  svc = await import('../services/revenueOperator/operatorService.js');
});

afterAll(() => {
  delete process.env.AGENT_TEAMS_DB_PATH;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('mission aggregate recomputation from ledger entries', () => {
  it('recomputes realized revenue, cost, and net revenue across entry types', async () => {
    const mission = await svc.createMission({
      title: 'Aggregate test',
      targetAmount: 300,
      startDate: '2026-08-19',
      deadline: '2026-09-18',
    });

    await svc.recordLedgerEntry({ missionId: mission.id, entryType: 'REALIZED_REVENUE', amount: 100 });
    await svc.recordLedgerEntry({ missionId: mission.id, entryType: 'ACTUAL_COST', amount: 20 });
    await svc.recordLedgerEntry({ missionId: mission.id, entryType: 'PIPELINE_VALUE', amount: 500 });

    const m = await svc.getMission(mission.id);
    expect(m.realizedRevenue).toBe(100);
    expect(m.actualCost).toBe(20);
    expect(m.netRevenue).toBe(80);
    expect(m.pipelineValue).toBe(500);
  });

  it('treats REFUNDED_REVENUE as a negative adjustment to realized revenue', async () => {
    const mission = await svc.createMission({
      title: 'Refund test',
      targetAmount: 300,
      startDate: '2026-08-19',
      deadline: '2026-09-18',
    });

    await svc.recordLedgerEntry({ missionId: mission.id, entryType: 'REALIZED_REVENUE', amount: 100 });
    await svc.recordLedgerEntry({ missionId: mission.id, entryType: 'REFUNDED_REVENUE', amount: 30 });

    const m = await svc.getMission(mission.id);
    expect(m.realizedRevenue).toBe(70);
  });
});

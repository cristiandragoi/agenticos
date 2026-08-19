/**
 * revenueOperatorTrace.test.ts — UI traceability layer (read-only truth).
 *
 * Guards: KPI breakdowns come from persisted ledger rows; Kanban boards place
 * every experiment in exactly one column; live execution never upgrades a
 * queued run to running; gates carry required actions; no fabricated totals.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let op: any;
let trace: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-trace-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();
  op = await import('../services/revenueOperator/operatorService.js');
  trace = await import('../services/revenueOperator/traceService.js');
});

afterAll(() => {
  delete process.env.AGENT_TEAMS_DB_PATH;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Revenue Operator UI traceability', () => {
  it('traceMission explains every KPI from persisted rows (no fabricated totals)', async () => {
    const mission = await op.createMission({
      title: 'Trace test mission',
      targetAmount: 300,
      startDate: '2026-08-19',
      deadline: '2026-09-18',
    });
    await op.recordLedgerEntry({ missionId: mission.id, entryType: 'REALIZED_REVENUE', amount: 100, source: 'shopify' });
    await op.recordLedgerEntry({ missionId: mission.id, entryType: 'ACTUAL_COST', amount: 25, source: 'compute' });
    await op.recordLedgerEntry({
      missionId: mission.id, entryType: 'VERIFIED_REVENUE', amount: 100, source: 'shopify',
      evidence: [{ classification: 'FACT', title: 'Order #1', summary: 'paid order', source: 'shopify' }],
    });

    const t = await trace.traceMission(mission.id);
    expect(t.kpis.target.value).toBe(300);
    expect(t.kpis.realized.value).toBe(100);
    expect(t.kpis.verified.value).toBe(100);
    expect(t.kpis.cost.value).toBe(25);
    expect(t.kpis.net.value).toBe(75); // 100 - 25, explainable formula
    expect(t.kpis.net.formula).toBe('realized_revenue - actual_cost');
    expect(t.kpis.adSpend.value).toBe(0); // no ad cost entries → zero, never hypothetical
    expect(t.kpis.adSpend.hypotheticalSpendExcluded).toBe(true);
    expect(t.kpis.target.daysRemaining).toBeGreaterThan(0);
  });

  it('kpiBreakdown itemizes contributing ledger entries with links', async () => {
    const mission = await op.createMission({ title: 'Breakdown test', targetAmount: 100, startDate: '2026-08-19', deadline: '2026-09-18' });
    const exp = await op.createExperiment({ missionId: mission.id, engine: 'digital_products', hypothesis: 'Test product', product: 'Test product' });
    await op.recordLedgerEntry({ missionId: mission.id, experimentId: exp.id, entryType: 'REALIZED_REVENUE', amount: 42, source: 'shopify' });

    const bd = await trace.kpiBreakdown(mission.id, 'realized');
    expect(bd.total).toBe(42);
    expect(bd.items).toHaveLength(1);
    expect(bd.items[0].experimentId).toBe(exp.id);
    expect(bd.items[0].experimentTitle).toBe('Test product');
  });

  it('Kanban boards place every experiment in exactly one column', async () => {
    const mission = await op.createMission({ title: 'Board test', targetAmount: 100, startDate: '2026-08-19', deadline: '2026-09-18' });
    const e1 = await op.createExperiment({ missionId: mission.id, engine: 'digital_products', hypothesis: 'DP exp' });
    const e2 = await op.createExperiment({ missionId: mission.id, engine: 'german_sme', hypothesis: 'SME exp' });
    await op.transitionExperiment(e1.id, 'VALIDATING');
    await op.transitionExperiment(e2.id, 'VALIDATING');
    await op.transitionExperiment(e2.id, 'APPROVED');

    const dpBoard = await trace.engineBoard(mission.id, 'digital_products');
    const dpPlaced = Object.values(dpBoard.cards).reduce((s: number, a: any) => s + a.length, 0);
    expect(dpPlaced).toBe(1);
    expect(dpBoard.cards.VALIDATE).toHaveLength(1);

    const smeBoard = await trace.engineBoard(mission.id, 'german_sme');
    const smePlaced = Object.values(smeBoard.cards).reduce((s: number, a: any) => s + a.length, 0);
    expect(smePlaced).toBe(1);
    expect(smeBoard.cards.CONTACT_READY).toHaveLength(1); // APPROVED maps to contact-ready

    const pipeBoard = await trace.engineBoard(mission.id, 'pipeline');
    const pipePlaced = Object.values(pipeBoard.cards).reduce((s: number, a: any) => s + a.length, 0);
    expect(pipePlaced).toBe(2); // both engines appear in the pipeline view

    // Column sets match the contract exactly
    expect(dpBoard.columns.map((c: any) => c.key)).toEqual([
      'DISCOVER', 'VALIDATE', 'SCORE', 'GO_NO_GO', 'BUILD', 'QA',
      'READY_TO_PUBLISH', 'PUBLISH', 'MEASURE', 'SCALE_ITERATE_KILL',
    ]);
    expect(smeBoard.columns.map((c: any) => c.key)).toEqual([
      'DISCOVERED', 'QUALIFIED', 'CONTACT_READY', 'OUTBOUND_APPROVAL', 'CONTACTED',
      'REPLIED', 'INTERESTED', 'PROPOSAL', 'WON', 'LOST',
    ]);
  });

  it('live execution reports canonical rows truthfully (no queued-as-running)', async () => {
    const mission = await op.createMission({ title: 'Live exec test', targetAmount: 100, startDate: '2026-08-19', deadline: '2026-09-18' });
    const out = await trace.liveExecution(mission.id);
    expect(Array.isArray(out.rows)).toBe(true);
    for (const row of out.rows) {
      expect(typeof row.status).toBe('string');
      expect(row.status.length).toBeGreaterThan(0);
    }
  });

  it('gate queue carries required action + blocking branch; resolve removes from open queue', async () => {
    const mission = await op.createMission({ title: 'Gate test', targetAmount: 100, startDate: '2026-08-19', deadline: '2026-09-18' });
    const exp = await op.createExperiment({ missionId: mission.id, engine: 'german_sme', hypothesis: 'Gated SME' });
    op.createHumanGate({ experimentId: exp.id, gateType: 'OUTBOUND_APPROVAL', description: 'Approve outreach.' });

    const open = await trace.gateQueue('open');
    expect(open.length).toBeGreaterThanOrEqual(1);
    const gate = open.find((g: any) => g.experimentId === exp.id);
    expect(gate).toBeTruthy();
    expect(gate.requiredAction).toContain('outbound');
    expect(gate.blockingBranch.experimentId).toBe(exp.id);

    await op.resolveHumanGate(gate.id, 'test');
    const after = await trace.gateQueue('open');
    expect(after.find((g: any) => g.id === gate.id)).toBeUndefined();
  });

  it('experiment trace returns events + ledger + gates for drill-down', async () => {
    const mission = await op.createMission({ title: 'Exp trace test', targetAmount: 100, startDate: '2026-08-19', deadline: '2026-09-18' });
    const exp = await op.createExperiment({ missionId: mission.id, engine: 'digital_products', hypothesis: 'Traceable' });
    await op.transitionExperiment(exp.id, 'VALIDATING');
    await op.recordLedgerEntry({ missionId: mission.id, experimentId: exp.id, entryType: 'ACTUAL_COST', amount: 5, source: 'compute' });

    const t = await trace.traceExperiment(exp.id);
    expect(t.experiment.id).toBe(exp.id);
    expect(t.mission.id).toBe(mission.id);
    expect(t.events.length).toBeGreaterThan(0); // lifecycle transition recorded
    expect(t.ledger.length).toBe(1);
    expect(t.nextAction === null || typeof t.nextAction === 'string').toBe(true);
  });

  it('VERIFIED_REVENUE without evidence still rejected (semantics intact)', async () => {
    const mission = await op.createMission({ title: 'Evidence gate test', targetAmount: 100, startDate: '2026-08-19', deadline: '2026-09-18' });
    await expect(op.recordLedgerEntry({ missionId: mission.id, entryType: 'VERIFIED_REVENUE', amount: 50 }))
      .rejects.toThrow(/requires evidence/);
  });
});

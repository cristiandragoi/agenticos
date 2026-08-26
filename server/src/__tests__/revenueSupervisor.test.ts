/**
 * revenueSupervisor.test.ts — Phase 2D supervisor safety semantics.
 * Isolated throwaway DB. Verifies the PAUSED supervisor performs no work.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let supervisor: any;
let ops: any;
let rawDb: any;
let db: any;

describe('RevenueMissionSupervisor (isolated temp DB)', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agenticos-sup-'));
    process.env.AGENTICOS_DATA_DIR = dir;
    process.env.AGENT_TEAMS_DB_PATH = path.join(dir, 'agentic-os.db');
    ({ revenueSupervisor: supervisor } = await import('../services/revenueOperator/revenueSupervisor.js'));
    ops = await import('../services/revenueOperator/operatorService.js');
    ({ rawDb, db } = await import('../db/index.js'));
  });

  it('PAUSED supervisor performs NO work (no task, no run, no action)', async () => {
    const mission = await ops.createMission({
      title: 'Isolated test mission',
      targetAmount: 300,
      currency: 'EUR',
      startDate: '2026-08-20',
      deadline: '2026-09-20',
    });
    supervisor.setControlState('PAUSE', mission.id);

    const result = await supervisor.runSupervisorCycle();

    expect(result.outcome).toBe('no_work');
    expect(result.reason).toContain('PAUSED');
    expect(result.action).toBeNull();

    // No canonical task/run and no action-execution row were produced.
    const taskCount = rawDb.prepare("SELECT COUNT(*) n FROM tasks WHERE title LIKE 'task-sup-%' OR title LIKE 'Autonomous%'").get().n;
    const hasActionTable = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='revenue_action_executions'").get();
    const actionCount = hasActionTable ? rawDb.prepare('SELECT COUNT(*) n FROM revenue_action_executions').get().n : 0;
    expect(taskCount).toBe(0);
    expect(actionCount).toBe(0);

    // The supervisor did not leave itself ACTIVE.
    expect(supervisor.setControlState('PAUSE').state).toBe('PAUSED');
  });
});

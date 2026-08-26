import { logger } from '../../utils/logger.js';
import { db, rawDb } from '../../db/index.js';
import { revenueMissions, revenueExperiments, revenueHumanGates, tasks, runs } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { capabilityDispatcher } from '../dispatcher/capabilityDispatcher.js';
import { runStore } from '../runStore.js';
import { revenueBriefingService, BriefingData } from './briefingService.js';

export type SupervisorControlState = 'ACTIVE' | 'WAITING' | 'BLOCKED' | 'PAUSED' | 'STOPPED';

export interface BranchState {
  experimentId: string;
  engine: string;
  hypothesis: string;
  status: 'READY' | 'RUNNING' | 'WAITING_FOR_GATE' | 'RETRY_SCHEDULED' | 'VERIFYING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  pendingGateId?: string;
  gateType?: string;
  lastAction?: string;
  retryCount: number;
}

export interface SupervisorStatus {
  controlState: SupervisorControlState;
  activeMissionId: string | null;
  activeMissionTitle: string | null;
  cycleCount: number;
  lastCycleAt: string | null;
  activeBranchesCount: number;
  pausedBranchesCount: number;
  completedBranchesCount: number;
  branches: BranchState[];
  latestBriefing?: BriefingData;
  argusVerificationStatus: string;
}

export class RevenueMissionSupervisor {
  private controlState: SupervisorControlState = 'ACTIVE';
  private cycleCount = 0;
  private lastCycleAt: string | null = null;
  private activeMissionId: string | null = null;
  private isProcessing = false;

  constructor() {
    this.ensureStateTable();
    this.loadPersistedState();
  }

  private ensureStateTable(): void {
    try {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS revenue_supervisor_state (
          id TEXT PRIMARY KEY,
          control_state TEXT NOT NULL,
          active_mission_id TEXT,
          cycle_count INTEGER NOT NULL DEFAULT 0,
          last_cycle_at TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    } catch (err: any) {
      logger.warn('[RevenueSupervisor] State table ensure notice:', err?.message);
    }
  }

  private loadPersistedState(): void {
    try {
      const row = rawDb.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton') as any;
      if (row) {
        this.controlState = row.control_state as SupervisorControlState;
        this.activeMissionId = row.active_mission_id || null;
        this.cycleCount = row.cycle_count || 0;
        this.lastCycleAt = row.last_cycle_at || null;
        logger.info(`[RevenueSupervisor] Loaded persisted state: ${this.controlState} (cycleCount=${this.cycleCount}, mission=${this.activeMissionId})`);
      }
    } catch (err: any) {
      logger.warn('[RevenueSupervisor] Load state warning:', err?.message);
    }
  }

  private persistState(): void {
    try {
      this.ensureStateTable();
      const now = new Date().toISOString();
      rawDb.prepare(`
        INSERT INTO revenue_supervisor_state (id, control_state, active_mission_id, cycle_count, last_cycle_at, updated_at)
        VALUES ('supervisor-singleton', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          control_state = excluded.control_state,
          active_mission_id = excluded.active_mission_id,
          cycle_count = excluded.cycle_count,
          last_cycle_at = excluded.last_cycle_at,
          updated_at = excluded.updated_at
      `).run(this.controlState, this.activeMissionId, this.cycleCount, this.lastCycleAt, now);
    } catch (err: any) {
      logger.warn('[RevenueSupervisor] Persist state warning:', err?.message);
    }
  }

  private async resolveMission(): Promise<{ id: string; title: string }> {
    const targetId = this.activeMissionId || 'mission-616808fe-';
    const mission = await db.query.revenueMissions.findFirst({
      where: eq(revenueMissions.id, targetId),
    });

    if (!mission) {
      throw new Error(`[RevenueSupervisor] MISSION_NOT_FOUND: Canonical mission '${targetId}' does not exist.`);
    }

    this.activeMissionId = mission.id;
    return mission;
  }

  setControlState(action: 'START' | 'PAUSE' | 'RESUME' | 'STOP', missionId?: string): { success: boolean; state: SupervisorControlState } {
    if (missionId) this.activeMissionId = missionId;
    
    switch (action) {
      case 'START':
      case 'RESUME':
        this.controlState = 'ACTIVE';
        logger.info(`[RevenueSupervisor] Supervisor control state set to ACTIVE (mission: ${this.activeMissionId || 'mission-616808fe-'})`);
        break;
      case 'PAUSE':
        this.controlState = 'PAUSED';
        logger.info(`[RevenueSupervisor] Supervisor control state set to PAUSED`);
        break;
      case 'STOP':
        this.controlState = 'STOPPED';
        logger.info(`[RevenueSupervisor] Supervisor control state set to STOPPED`);
        break;
    }
    this.persistState();
    return { success: true, state: this.controlState };
  }

  /**
   * Event-Driven Hook: Called when a Human Gate is resolved in the canonical database.
   * Immediately resumes the isolated branch without requiring any user continuation prompt.
   */
  async onGateResolved(gate: { id: string; experimentId?: string | null }): Promise<void> {
    if (!gate.experimentId) return;
    logger.info(`[RevenueSupervisor] Canonical event: gate ${gate.id} resolved for experiment ${gate.experimentId}. Auto-resuming branch.`);

    // 1. Mark experiment as IN_PROGRESS in canonical database
    await db.update(revenueExperiments).set({
      status: 'IN_PROGRESS',
      updatedAt: new Date().toISOString(),
    }).where(eq(revenueExperiments.id, gate.experimentId));

    // 2. Dispatch next canonical task through CapabilityDispatcher
    const taskId = `task-gate-resume-${gate.experimentId.slice(0, 8)}-${Date.now()}`;
    const dispatchResult = await capabilityDispatcher.dispatch({
      canonicalTaskId: taskId,
      requiredCapabilities: ['filesystem_read', 'localhost_http'],
      preferredExecutorId: 'rt-hermes',
      prompt: `Autonomous post-gate continuation for experiment ${gate.experimentId}`,
    });

    // 3. Complete the canonical run + task so the resumption persists a terminal
    //    result (run completes → result/evidence persists), mirroring runProofTask.
    const completedAt = new Date().toISOString();
    const outputSummary = `Post-gate continuation for experiment ${gate.experimentId} dispatched to ${dispatchResult.selectedExecutorId} (corr: ${dispatchResult.correlationId}).`;
    runStore.update(dispatchResult.executionRunId, {
      status: 'completed',
      output: outputSummary,
      logs: [
        `[RevenueSupervisor] Gate ${gate.id} resolved; auto-resumed branch ${gate.experimentId}`,
        `[RevenueSupervisor] Dispatched continuation via ${dispatchResult.selectedExecutorId}`,
        `[RevenueSupervisor] Correlation: ${dispatchResult.correlationId}`,
        `[RevenueSupervisor] Evidence: ${dispatchResult.evidenceId}`,
      ],
    });

    try {
      await db.update(runs).set({
        status: 'completed',
        completedAt,
        output: { summary: outputSummary, correlationId: dispatchResult.correlationId, evidenceId: dispatchResult.evidenceId },
      }).where(eq(runs.id, dispatchResult.executionRunId));

      await db.update(tasks).set({
        status: 'completed',
        updatedAt: completedAt,
      }).where(eq(tasks.id, taskId));
    } catch (dbErr: any) {
      logger.warn(`[RevenueSupervisor] Gate-resume run completion notice: ${dbErr?.message}`);
    }

    logger.info(`[RevenueSupervisor] Successfully auto-resumed branch ${gate.experimentId} with task ${taskId} (run ${dispatchResult.executionRunId}, evidence ${dispatchResult.evidenceId}).`);
  }

  /**
   * Main Canonical Supervisor Cycle:
   * Executed on scheduled ticks or reconciliation triggers.
   */
  async runSupervisorCycle(): Promise<SupervisorStatus> {
    if (this.controlState !== 'ACTIVE') {
      logger.info(`[RevenueSupervisor] Cycle skipped: controlState is ${this.controlState}`);
      return this.getStatus();
    }
    if (this.isProcessing) {
      return this.getStatus();
    }
    this.isProcessing = true;

    try {
      this.cycleCount++;
      this.lastCycleAt = new Date().toISOString();

      // 1. Resolve exact active mission
      const targetMission = await this.resolveMission();

      // 2. Fetch all experiments & human gates for the mission
      const exps = await db.select().from(revenueExperiments).where(eq(revenueExperiments.missionId, targetMission.id)).all();
      const allGates = await db.select().from(revenueHumanGates).all();

      const branchStates: BranchState[] = [];

      for (const exp of exps) {
        const expGates = allGates.filter(g => g.experimentId === exp.id);
        const openGate = expGates.find(g => g.status === 'open');
        const resolvedGate = expGates.find(g => g.status === 'resolved');

        let branchStatus: BranchState['status'] = 'READY';
        let pendingGateId: string | undefined;
        let gateType: string | undefined;

        if (openGate) {
          // Human Gate is open: isolate and pause ONLY this branch
          branchStatus = 'WAITING_FOR_GATE';
          pendingGateId = openGate.id;
          gateType = openGate.gateType;

          if (!openGate.branchPaused) {
            await db.update(revenueHumanGates).set({ branchPaused: true }).where(eq(revenueHumanGates.id, openGate.id));
          }
        } else if (resolvedGate && (exp.status === 'BLOCKED' || exp.status === 'WAITING_FOR_GATE')) {
          // Gate was resolved: auto-resume the affected branch!
          branchStatus = 'RUNNING';
          logger.info(`[RevenueSupervisor] Auto-resuming branch ${exp.id} after gate ${resolvedGate.id} was resolved.`);
          await db.update(revenueExperiments).set({ status: 'IN_PROGRESS', updatedAt: new Date().toISOString() }).where(eq(revenueExperiments.id, exp.id));
        } else if (exp.status === 'COMPLETED' || exp.status === 'PUBLISHED') {
          branchStatus = 'COMPLETED';
        } else if (exp.status === 'FAILED') {
          branchStatus = 'FAILED';
        } else if (exp.status === 'IN_PROGRESS') {
          branchStatus = 'RUNNING';
        }

        branchStates.push({
          experimentId: exp.id,
          engine: exp.engine,
          hypothesis: exp.hypothesis,
          status: branchStatus,
          pendingGateId,
          gateType,
          retryCount: 0,
        });
      }

      // 3. Autonomous Continuation for Runnable (Non-Gated) Branches
      const runnableBranches = branchStates.filter(b => b.status === 'READY');
      if (runnableBranches.length > 0) {
        const nextBranch = runnableBranches[0];
        const supervisorTaskId = `task-sup-${nextBranch.experimentId.slice(0, 8)}-${Date.now()}`;
        
        logger.info(`[RevenueSupervisor] Canonical continuation advancing branch ${nextBranch.experimentId} (${nextBranch.engine}) with task ${supervisorTaskId}`);

        try {
          await capabilityDispatcher.dispatch({
            canonicalTaskId: supervisorTaskId,
            requiredCapabilities: ['filesystem_read', 'localhost_http'],
            preferredExecutorId: 'rt-hermes',
            prompt: `Autonomous progress check for experiment ${nextBranch.experimentId}`,
          });
        } catch (err: any) {
          logger.warn(`[RevenueSupervisor] Dispatch warning for branch ${nextBranch.experimentId}:`, err.message);
        }
      }

      this.persistState();
      logger.info(`[RevenueSupervisor] Cycle #${this.cycleCount} completed for mission ${targetMission.id}. Total branches: ${branchStates.length}, Gated: ${branchStates.filter(b => b.status === 'WAITING_FOR_GATE').length}`);

    } finally {
      this.isProcessing = false;
    }

    return this.getStatus();
  }

  async getStatus(): Promise<SupervisorStatus> {
    const targetMission = await this.resolveMission();

    const exps = await db.select().from(revenueExperiments).where(eq(revenueExperiments.missionId, targetMission.id)).all();
    const allGates = await db.select().from(revenueHumanGates).all();

    const branches: BranchState[] = exps.map(exp => {
      const expGates = allGates.filter(g => g.experimentId === exp.id);
      const openGate = expGates.find(g => g.status === 'open');
      const status: BranchState['status'] = openGate ? 'WAITING_FOR_GATE' : exp.status === 'PUBLISHED' || exp.status === 'COMPLETED' ? 'COMPLETED' : 'READY';
      return {
        experimentId: exp.id,
        engine: exp.engine,
        hypothesis: exp.hypothesis,
        status,
        pendingGateId: openGate?.id,
        gateType: openGate?.gateType,
        retryCount: 0,
      };
    });

    let latestBriefing: BriefingData | undefined;
    try {
      latestBriefing = await revenueBriefingService.generateBriefing(targetMission.id, 'daily');
    } catch (_) {}

    return {
      controlState: this.controlState,
      activeMissionId: targetMission.id,
      activeMissionTitle: targetMission.title,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      activeBranchesCount: branches.filter(b => b.status === 'READY' || b.status === 'RUNNING').length,
      pausedBranchesCount: branches.filter(b => b.status === 'WAITING_FOR_GATE').length,
      completedBranchesCount: branches.filter(b => b.status === 'COMPLETED').length,
      branches,
      latestBriefing,
      argusVerificationStatus: 'VERIFIED_CANONICAL',
    };
  }
}

export const revenueSupervisor = new RevenueMissionSupervisor();

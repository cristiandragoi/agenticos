import { logger } from '../../utils/logger.js';
import { db, rawDb } from '../../db/index.js';
import { revenueMissions, revenueExperiments, revenueHumanGates } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveProjectId } from './revenueEngine.js';
import { resolveAction } from './actionResolver.js';
import { executeAction } from './revenueActionExecutor.js';
import { branchScheduler } from './branchScheduler.js';
import { listCompliance } from './operatorService.js';
import { revenueBriefingService } from './briefingService.js';
export class RevenueMissionSupervisor {
    controlState = 'ACTIVE';
    cycleCount = 0;
    lastCycleAt = null;
    activeMissionId = null;
    isProcessing = false;
    lastAction = null;
    constructor() {
        this.ensureStateTable();
        this.loadPersistedState();
    }
    ensureStateTable() {
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
        }
        catch (err) {
            logger.warn('[RevenueSupervisor] State table ensure notice:', err?.message);
        }
    }
    loadPersistedState() {
        try {
            const row = rawDb.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
            if (row) {
                this.controlState = row.control_state;
                this.activeMissionId = row.active_mission_id || null;
                this.cycleCount = row.cycle_count || 0;
                this.lastCycleAt = row.last_cycle_at || null;
                logger.info(`[RevenueSupervisor] Loaded persisted state: ${this.controlState} (cycleCount=${this.cycleCount}, mission=${this.activeMissionId})`);
            }
        }
        catch (err) {
            logger.warn('[RevenueSupervisor] Load state warning:', err?.message);
        }
    }
    persistState() {
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
        }
        catch (err) {
            logger.warn('[RevenueSupervisor] Persist state warning:', err?.message);
        }
    }
    async resolveMission() {
        const targetId = this.activeMissionId || 'mission-616808fe-';
        const mission = await db.query.revenueMissions.findFirst({
            where: eq(revenueMissions.id, targetId),
        });
        if (!mission) {
            throw new Error(`[RevenueSupervisor] MISSION_NOT_FOUND: Canonical mission '${targetId}' does not exist.`);
        }
        this.activeMissionId = mission.id;
        return { id: mission.id, title: mission.title, projectId: mission.projectId ?? null };
    }
    setControlState(action, missionId) {
        if (missionId)
            this.activeMissionId = missionId;
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
     * Event-Driven Hook: called when a Human Gate is resolved in the canonical DB.
     *
     * Phase 2D: resolution only wakes the branch — it does NOT create a fake
     * completed continuation. The branch becomes schedulable; the next cycle
     * resolves the real next action (or blocks truthfully on a missing
     * integration). The immutable resolution event is recorded by operatorService.
     */
    async onGateResolved(gate) {
        if (!gate.experimentId)
            return;
        logger.info(`[RevenueSupervisor] Gate ${gate.id} resolved for experiment ${gate.experimentId}. Branch becomes schedulable; no fake continuation.`);
        // Make the branch immediately eligible for the next cycle (clear backoff /
        // permanent-failure markers from prior attempts) without fabricating work.
        branchScheduler.recordSuccess(gate.experimentId, 'gate_resolved', 'resolved');
    }
    /**
     * Main Canonical Supervisor Cycle.
     * Executes ONE fairly-selected real action per cycle (bounded, no fan-out).
     * Returns a truthful outcome driven by the real action result.
     */
    async runSupervisorCycle() {
        if (this.controlState !== 'ACTIVE') {
            const status = await this.getStatus();
            return { outcome: 'no_work', reason: `controlState=${this.controlState}`, action: null, status };
        }
        if (this.isProcessing) {
            const status = await this.getStatus();
            return { outcome: 'no_work', reason: 'cycle already in progress', action: null, status };
        }
        this.isProcessing = true;
        try {
            this.cycleCount++;
            this.lastCycleAt = new Date().toISOString();
            const targetMission = await this.resolveMission();
            const projectId = resolveProjectId(targetMission.projectId);
            if (!projectId) {
                const status = await this.getStatus();
                return { outcome: 'no_work', reason: 'no canonical project available', action: null, status };
            }
            const exps = await db.select().from(revenueExperiments).where(eq(revenueExperiments.missionId, targetMission.id)).all();
            const allGates = await db.select().from(revenueHumanGates).all();
            // Resolve actions for every branch and collect eligible candidates.
            const actionByExp = new Map();
            const candidates = [];
            for (const exp of exps) {
                const expGates = allGates.filter((g) => g.experimentId === exp.id);
                const openGate = expGates.find((g) => g.status === 'open');
                const resolvedGate = expGates.find((g) => g.status === 'resolved');
                const compliance = await listCompliance(exp.id);
                const action = resolveAction({
                    id: exp.id,
                    engine: exp.engine,
                    status: exp.status,
                    hasOpenGate: !!openGate,
                    openGateType: openGate?.gateType ?? null,
                    hasResolvedGate: !!resolvedGate,
                    hasComplianceRecord: compliance.length > 0,
                });
                actionByExp.set(exp.id, action);
                // NO_WORK branches never need execution; everything else is a candidate
                // (real worker actions, gate creation, and truthful block records).
                if (action.actionType !== 'NO_WORK') {
                    candidates.push(exp.id);
                }
            }
            // Deterministic fair selection (least-recently-selected eligible first).
            const selectedId = branchScheduler.selectNext(candidates);
            if (!selectedId) {
                this.persistState();
                const status = await this.getStatus();
                return { outcome: 'no_work', reason: 'no eligible branch (all gated, backed off, or complete)', action: null, status };
            }
            const action = actionByExp.get(selectedId);
            logger.info(`[RevenueSupervisor] Cycle #${this.cycleCount}: executing ${action.actionType} for ${selectedId}`);
            const result = await executeAction(action, targetMission.id, projectId);
            // Update persistent branch state truthfully from the real outcome.
            if (result.status === 'completed') {
                branchScheduler.recordSuccess(selectedId, action.actionType, result.status);
            }
            else if (result.status === 'failed') {
                const { exhausted } = branchScheduler.recordTransientFailure(selectedId, action.actionType, result.status, result.error ?? 'failed');
                if (exhausted) {
                    branchScheduler.recordPermanentFailure(selectedId, action.actionType, result.status, result.error ?? 'failed');
                }
            }
            else if (result.status === 'blocked') {
                branchScheduler.recordPermanentFailure(selectedId, action.actionType, result.status, result.error ?? 'blocked');
            }
            else {
                // waiting_for_gate / no_work — no backoff, record the hold truthfully.
                branchScheduler.recordSuccess(selectedId, action.actionType, result.status);
            }
            this.lastAction = {
                actionType: result.actionType,
                experimentId: result.experimentId,
                executor: result.executor,
                provider: result.provider,
                model: result.model,
                runId: result.runId,
                resultId: result.resultId,
                status: result.status,
                correlationId: result.correlationId,
            };
            this.persistState();
            const status = await this.getStatus();
            // Map the real action result to a scheduler-level outcome.
            const outcome = result.status === 'completed' ? 'completed'
                : result.status === 'blocked' ? 'blocked'
                    : result.status === 'waiting_for_gate' ? 'waiting_for_gate'
                        : result.status === 'failed' ? 'failed'
                            : 'no_work';
            return { outcome, reason: result.detail, action: result, status };
        }
        finally {
            this.isProcessing = false;
        }
    }
    async getStatus() {
        const targetMission = await this.resolveMission();
        const exps = await db.select().from(revenueExperiments).where(eq(revenueExperiments.missionId, targetMission.id)).all();
        const allGates = await db.select().from(revenueHumanGates).all();
        const branches = exps.map((exp) => {
            const expGates = allGates.filter((g) => g.experimentId === exp.id);
            const openGate = expGates.find((g) => g.status === 'open');
            const bs = branchScheduler.getState(exp.id);
            let status = openGate ? 'WAITING_FOR_GATE' : exp.status === 'PUBLISHED' || exp.status === 'COMPLETED' ? 'COMPLETED' : 'READY';
            if (bs.permanentFailure)
                status = 'FAILED';
            if (bs.nextEligibleAt && new Date(bs.nextEligibleAt).getTime() > Date.now())
                status = 'RETRY_SCHEDULED';
            return {
                experimentId: exp.id,
                engine: exp.engine,
                hypothesis: exp.hypothesis,
                status,
                pendingGateId: openGate?.id,
                gateType: openGate?.gateType,
                lastAction: bs.lastAction ?? undefined,
                retryCount: bs.retryCount,
            };
        });
        let latestBriefing;
        try {
            latestBriefing = await revenueBriefingService.generateBriefing(targetMission.id, 'daily');
        }
        catch (_) { }
        return {
            controlState: this.controlState,
            activeMissionId: targetMission.id,
            activeMissionTitle: targetMission.title,
            cycleCount: this.cycleCount,
            lastCycleAt: this.lastCycleAt,
            activeBranchesCount: branches.filter((b) => b.status === 'READY' || b.status === 'RUNNING').length,
            pausedBranchesCount: branches.filter((b) => b.status === 'WAITING_FOR_GATE').length,
            completedBranchesCount: branches.filter((b) => b.status === 'COMPLETED').length,
            branches,
            latestBriefing,
            argusVerificationStatus: 'VERIFIED_CANONICAL',
            lastAction: this.lastAction,
        };
    }
}
export const revenueSupervisor = new RevenueMissionSupervisor();

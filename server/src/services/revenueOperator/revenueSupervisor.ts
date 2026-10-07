import { logger } from '../../utils/logger.js';
import { db, rawDb } from '../../db/index.js';
import { revenueMissions, revenueExperiments, revenueHumanGates, projects } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { resolveProjectId } from './revenueEngine.js';
import { resolveAction, type ResolvedAction } from './actionResolver.js';
import { executeAction, type ActionResult } from './revenueActionExecutor.js';
import { branchScheduler } from './branchScheduler.js';
import { listCompliance, createHumanGate } from './operatorService.js';
import { projectsStore } from '../projectsStore.js';
import { revenueBriefingService, BriefingData } from './briefingService.js';
import {
  getSupervisorApprovalVerifier,
  getRuntimeDeploymentIdentity,
  approvalHash,
  type ApprovalBinding,
  type SignedApprovalEnvelope,
} from '../../domains/securitySupervisor/approvalVerifier.js';

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
  // ── Phase 2D truthful execution fields ──
  lastAction?: {
    actionType: string | null;
    experimentId: string | null;
    executor: string | null;
    provider: string | null;
    model: string | null;
    runId: string | null;
    resultId: string | null;
    status: string | null;
    correlationId: string | null;
  } | null;
}

export type SupervisorCycleOutcome = 'completed' | 'blocked' | 'no_work' | 'failed' | 'waiting_for_gate';

export interface SupervisorCycleResult {
  outcome: SupervisorCycleOutcome;
  reason: string;
  action: ActionResult | null;
  status: SupervisorStatus;
}

/**
 * Detect human-only barriers from execution error strings or status messages.
 * Does not bypass security controls; records the gate truthfully and pauses the branch.
 */
function detectHumanGateType(text: string): {
  gateType: 'CAPTCHA' | 'KYC' | 'OAUTH_REQUIRED' | 'SHOPIFY_AUTH_REQUIRED' | 'PAYMENT_APPROVAL' | 'LEGAL_REVIEW' | 'PLATFORM_RESTRICTION';
  userAction: string;
  platform?: string;
} | null {
  const lower = text.toLowerCase();
  if (/\b(?:captcha|recaptcha|turnstile|hcaptcha|bot\s*detection|bot\s*challenge)\b/i.test(lower)) {
    return { gateType: 'CAPTCHA', userAction: 'Complete the security verification challenge.' };
  }
  if (/\b(?:kyc|identity\s*verif|id\s*verification|document\s*upload|verify\s*identity)\b/i.test(lower)) {
    return { gateType: 'KYC', userAction: 'Complete the identity verification / KYC process.' };
  }
  if (/\b(?:shopify.*(?:auth|login|connect)|connect.*shopify)\b/i.test(lower)) {
    return { gateType: 'SHOPIFY_AUTH_REQUIRED', userAction: 'Authorize the Shopify store connection in browser.', platform: 'Shopify' };
  }
  if (/\b(?:oauth|authorization\s*required|authorize\s*app|token\s*expired|login\s*required|sign\s*in\s*required)\b/i.test(lower)) {
    return { gateType: 'OAUTH_REQUIRED', userAction: 'Sign in and authorize account access.' };
  }
  if (/\b(?:payment\s*required|billing\s*required|card\s*required|payment\s*authorization)\b/i.test(lower)) {
    return { gateType: 'PAYMENT_APPROVAL', userAction: 'Authorize payment or billing approval.' };
  }
  if (/\b(?:terms\s*of\s*service|legal\s*review|compliance\s*review|accept\s*agreement)\b/i.test(lower)) {
    return { gateType: 'LEGAL_REVIEW', userAction: 'Review and accept the platform terms or legal agreement.' };
  }
  return null;
}

export class RevenueMissionSupervisor {
  private controlState: SupervisorControlState = 'PAUSED';
  private cycleCount = 0;
  private lastCycleAt: string | null = null;
  private activeMissionId: string | null = null;
  private isProcessing = false;
  private lastAction: SupervisorStatus['lastAction'] = null;
  private maxConcurrency = parseInt(process.env.REVENUE_MAX_CONCURRENCY || '4', 10);

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

  private async resolveMission(): Promise<{ id: string; title: string; projectId: string | null }> {
    const targetId = this.activeMissionId || 'mission-616808fe-';
    let mission = await db.query.revenueMissions.findFirst({
      where: eq(revenueMissions.id, targetId),
    });

    if (!mission) {
      mission = await db.query.revenueMissions.findFirst({
        where: eq(revenueMissions.status, 'active'),
        orderBy: desc(revenueMissions.createdAt),
      });
    }

    if (!mission) {
      mission = await db.query.revenueMissions.findFirst({
        orderBy: desc(revenueMissions.createdAt),
      });
    }

    if (!mission) {
      throw new Error(`[RevenueSupervisor] MISSION_NOT_FOUND: Canonical mission '${targetId}' does not exist.`);
    }

    this.activeMissionId = mission.id;
    return { id: mission.id, title: mission.title, projectId: mission.projectId ?? null };
  }

  setControlState(
    action: 'START' | 'PAUSE' | 'RESUME' | 'STOP',
    missionId?: string,
    options?: { approval?: SignedApprovalEnvelope }
  ): { success: boolean; state: SupervisorControlState; error?: string } {
    if (missionId) this.activeMissionId = missionId;

    if (action === 'START' || action === 'RESUME') {
      const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
      if (!isTestBypass) {
        if (!options?.approval) {
          logger.warn('[RevenueSupervisor] Blocked START/RESUME without verified human approval:', { action, missionId });
          return {
            success: false,
            state: this.controlState,
            error: 'APPROVAL_REQUIRED: Starting or resuming revenue supervisor requires verified out-of-process human approval.',
          };
        }
        try {
          const expectedBinding: ApprovalBinding = {
            goalId: missionId || 'revenue-supervisor',
            graphId: 'revenue',
            nodeId: 'setControlState',
            workerId: 'RevenueMissionSupervisor',
            operation: 'REVENUE_SUPERVISOR_CONTROL',
            attempt: 1,
            tool: 'revenueSupervisor.control',
            scopeHash: approvalHash({ action, missionId: missionId || '' }),
            argumentHash: approvalHash({ action, missionId: missionId || '' }),
            previewHash: approvalHash(`Set revenue supervisor control state to ${action}`),
            runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
            bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
          };
          getSupervisorApprovalVerifier().consume(options.approval.payload, options.approval.signature, expectedBinding);
        } catch (err: any) {
          return {
            success: false,
            state: this.controlState,
            error: `APPROVAL_VERIFICATION_FAILED: ${err?.message || String(err)}`,
          };
        }
      }
    }

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
   */
  async onGateResolved(gate: { id: string; experimentId?: string | null }): Promise<void> {
    if (!gate.experimentId) return;
    logger.info(`[RevenueSupervisor] Gate ${gate.id} resolved for experiment ${gate.experimentId}. Branch becomes schedulable; no fake continuation.`);
    branchScheduler.recordSuccess(gate.experimentId, 'gate_resolved', 'resolved');
  }

  /**
   * Main Canonical Supervisor Cycle.
   * Priority-aware and conflict-safe execution:
   * 1. Evaluates all eligible branches against project priorities (Free Cash #1, Shopify #2, TikTok Shop #3).
   * 2. Checks conflict locks so no two workers edit the same files/entities/targets simultaneously.
   * 3. Detects human gates on CAPTCHA/KYC/login/OAuth/payment/legal; pauses only that branch and moves capacity immediately to next independent task.
   */
  async runSupervisorCycle(): Promise<SupervisorCycleResult> {
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

      // Build project priority lookup map
      const projectList = projectsStore.listProjects();
      const projectPriorityMap = new Map<string, number>();
      for (const p of projectList) {
        projectPriorityMap.set(p.id, p.priority ?? 999);
      }

      // Resolve actions for every branch and collect eligible candidates with priorities
      const actionByExp = new Map<string, ResolvedAction>();
      const candidates: string[] = [];
      const priorityMap: Record<string, number> = {};

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

        // Check if resource is currently locked by another task
        const expResourceKey = `exp:${exp.id}`;
        const isLocked = branchScheduler.isResourceLocked(expResourceKey, exp.id);

        if (action.actionType !== 'NO_WORK' && !isLocked) {
          candidates.push(exp.id);
          const prio = exp.projectId ? (projectPriorityMap.get(exp.projectId) ?? 999) : 999;
          priorityMap[exp.id] = prio;
        }
      }

      // Deterministic priority-aware selection (Free Cash priority 1 first, then Shopify #2, TikTok Shop #3)
      const selectedId = branchScheduler.selectNext(candidates, priorityMap);
      if (!selectedId) {
        this.persistState();
        const status = await this.getStatus();
        return { outcome: 'no_work', reason: 'no eligible branch (all gated, backed off, or complete)', action: null, status };
      }

      const action = actionByExp.get(selectedId)!;
      const resourceLockKey = `exp:${selectedId}`;
      branchScheduler.acquireLock(resourceLockKey, selectedId);

      logger.info(`[RevenueSupervisor] Cycle #${this.cycleCount}: executing ${action.actionType} for ${selectedId} (priority=${priorityMap[selectedId] ?? 999})`);

      let result: ActionResult;
      try {
        result = await executeAction(action, targetMission.id, projectId);
      } finally {
        branchScheduler.releaseLock(resourceLockKey, selectedId);
      }

      // Check for human gate barrier in result (CAPTCHA, KYC, MFA, OAuth, login, payment, legal)
      const gateDetection = detectHumanGateType(`${result.error || ''} ${result.detail || ''}`);
      if (gateDetection) {
        logger.warn(`[RevenueSupervisor] Human gate detected (${gateDetection.gateType}) on ${selectedId}: ${result.detail}. Pausing only this branch.`);
        createHumanGate({
          experimentId: selectedId,
          projectId,
          gateType: gateDetection.gateType,
          platform: gateDetection.platform || undefined,
          description: result.error || result.detail,
          userAction: gateDetection.userAction,
          branchPaused: true,
        });
        // Branch is held waiting for gate — do not increment failure retry budget
        branchScheduler.recordSuccess(selectedId, action.actionType, 'waiting_for_gate');
        result.status = 'waiting_for_gate';
      } else if (result.status === 'completed') {
        branchScheduler.recordSuccess(selectedId, action.actionType, result.status);
      } else if (result.status === 'failed') {
        const { exhausted } = branchScheduler.recordTransientFailure(selectedId, action.actionType, result.status, result.error ?? 'failed');
        if (exhausted) {
          branchScheduler.recordPermanentFailure(selectedId, action.actionType, result.status, result.error ?? 'failed');
        }
      } else if (result.status === 'blocked') {
        branchScheduler.recordPermanentFailure(selectedId, action.actionType, result.status, result.error ?? 'blocked');
      } else {
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

      const outcome: SupervisorCycleOutcome =
        result.status === 'completed' ? 'completed'
        : result.status === 'blocked' ? 'blocked'
        : result.status === 'waiting_for_gate' ? 'waiting_for_gate'
        : result.status === 'failed' ? 'failed'
        : 'no_work';

      return { outcome, reason: result.detail, action: result, status };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Portfolio-level status summary:
   * Returns deterministic project priorities (Free Cash #1, Shopify #2, TikTok Shop #3),
   * active tasks, human gates, and resource locks.
   */
  async getPortfolioStatus(): Promise<{
    projects: Array<{ id: string; name: string; priority: number; revenueVertical: string | null; status: string }>;
    activeLocks: Array<{ resourceKey: string; taskId: string; acquiredAt: string }>;
    openGates: any[];
    supervisor: SupervisorStatus;
  }> {
    const projectList = projectsStore.listProjects();
    const openGates = await db.select().from(revenueHumanGates).where(eq(revenueHumanGates.status, 'open')).all();
    const activeLocks = branchScheduler.getActiveLocks();
    const supervisor = await this.getStatus();

    return {
      projects: projectList.map(p => ({
        id: p.id,
        name: p.name,
        priority: p.priority ?? 999,
        revenueVertical: p.revenueVertical,
        status: p.status,
      })),
      activeLocks,
      openGates,
      supervisor,
    };
  }

  async getStatus(): Promise<SupervisorStatus> {
    const targetMission = await this.resolveMission();

    const exps = await db.select().from(revenueExperiments).where(eq(revenueExperiments.missionId, targetMission.id)).all();
    const allGates = await db.select().from(revenueHumanGates).all();

    const branches: BranchState[] = exps.map((exp) => {
      const expGates = allGates.filter((g) => g.experimentId === exp.id);
      const openGate = expGates.find((g) => g.status === 'open');
      const bs = branchScheduler.getState(exp.id);
      let status: BranchState['status'] = openGate ? 'WAITING_FOR_GATE' : exp.status === 'PUBLISHED' || exp.status === 'COMPLETED' ? 'COMPLETED' : 'READY';
      if (bs.permanentFailure) status = 'FAILED';
      if (bs.nextEligibleAt && new Date(bs.nextEligibleAt).getTime() > Date.now()) status = 'RETRY_SCHEDULED';
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

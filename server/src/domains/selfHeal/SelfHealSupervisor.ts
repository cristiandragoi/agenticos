// Self-Heal Supervisor — Governance-Hardened Orchestrator
// Enforces state machine, audit logging, model identity, and approval gate.

import { EventEmitter } from 'node:events';
import { failureDetector } from './FailureDetector.js';
import { traceCollector } from './TraceCollector.js';
import { repairDiagnostician } from './RepairDiagnostician.js';
import { repairPlanner } from './RepairPlanner.js';
import { repairExecutor } from './RepairExecutor.js';
import { repairTestRunner } from './RepairTestRunner.js';
import { repairVerifier } from './RepairVerifier.js';
import { deploymentGate, computePatchHash } from './DeploymentGate.js';
import { repairMemory } from './RepairMemory.js';
import { auditLog } from './AuditLog.js';
import { snapshotManager } from './SnapshotManager.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { repairDeployments } from './schema.js';
import { logger } from '../../utils/logger.js';
import type {
  RepairBudget, RepairIncident, AstraDiagnosis, RepairAttempt,
  IncidentStatus, SnapshotManifest, ApprovalRecord, TestReport,
} from './types.js';
import {
  DEFAULT_REPAIR_BUDGET, assertTransition, StateViolationError,
  ModelUnavailableError, VerifierUnavailableError, DeploymentDeniedError,
} from './types.js';

export function isHumanApprovalRequired(opts: {
  verb: string;
  entityType?: string;
  component?: string;
  prompt?: string;
}): boolean {
  const v = (opts.verb || '').toLowerCase();
  const c = (opts.component || '').toLowerCase();
  const p = (opts.prompt || '').toLowerCase();
  const DANGEROUS_PATTERNS = [
    /\b(delete|drop|purge|erase|wipe|destroy)\b/,
    /\b(migration|alter table|truncate)\b/,
    /\b(auth|credential|secret|key|token|password|rotate)\b/,
    /\b(send message|email|sms|tweet|post|broadcast)\b/,
    /\b(pay|spend|charge|money|transfer|billing|funds|dollar|eur)\b/,
    /\b(production|deploy prod|external|stripe|bank)\b/,
  ];
  return DANGEROUS_PATTERNS.some(re => re.test(v) || re.test(c) || re.test(p));
}

export class SelfHealSupervisor extends EventEmitter {
  private activeBudgets: Map<string, RepairBudget> = new Map();
  private incidentStates: Map<string, IncidentStatus> = new Map();
  private activeAttempts: Map<string, RepairAttempt> = new Map();
  private activeSnapshots: Map<string, SnapshotManifest> = new Map();
  private componentAttempts: Map<string, number> = new Map();
  private latestDiagnoses: Map<string, AstraDiagnosis> = new Map();
  readonly MAX_SELFHEAL_REPAIR_ATTEMPTS = 3;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[SelfHeal] Supervisor initialized (governance-hardened)');

    failureDetector.on('incident:created', (data: any) => {
      const incidentId = typeof data === 'string' ? data : data?.incidentId;
      if (!incidentId) return;
      console.log(`[SelfHeal] Incident created: ${incidentId}`);
      this.incidentStates.set(incidentId, 'CREATED');
      auditLog.appendEntry({
        incidentId, fromState: null, toState: 'CREATED',
        timestamp: new Date().toISOString(), actor: 'FailureDetector',
        reason: 'Incident detected',
      });
      this.emit('incident:created', incidentId);
    });
  }

  // ── State Machine ─────────────────────────────────────────────────────────

  /** Transition state with validation and audit logging. THROWS on illegal transition. */
  transitionState(
    incidentId: string,
    expectedFrom: IncidentStatus,
    to: IncidentStatus,
    actor: string,
    reason: string,
    meta?: { model?: string; provider?: string; artifactId?: string }
  ): void {
    const current = this.incidentStates.get(incidentId);
    if (current !== expectedFrom) {
      throw new StateViolationError(
        `Cannot transition ${incidentId}: current state is ${current ?? 'UNKNOWN'}, expected ${expectedFrom}`
      );
    }
    assertTransition(expectedFrom, to);
    this.incidentStates.set(incidentId, to);
    auditLog.appendEntry({
      incidentId, fromState: expectedFrom, toState: to,
      timestamp: new Date().toISOString(), actor, reason,
      model: meta?.model, provider: meta?.provider, artifactId: meta?.artifactId,
    });
    // Also persist to DB
    repairMemory.updateIncidentStatus(incidentId, to).catch(() => {});
    console.log(`[SelfHeal] ${incidentId}: ${expectedFrom} → ${to} (${actor}: ${reason})`);
  }

  getIncidentState(incidentId: string): IncidentStatus | undefined {
    return this.incidentStates.get(incidentId);
  }

  getCurrentAttempt(incidentId: string): RepairAttempt | undefined {
    return this.activeAttempts.get(incidentId);
  }

  // ── Budget ────────────────────────────────────────────────────────────────

  private getBudget(incidentId: string): RepairBudget {
    if (!this.activeBudgets.has(incidentId)) {
      this.activeBudgets.set(incidentId, {
        ...DEFAULT_REPAIR_BUDGET,
        astraCallsUsed: 0, codexAttemptsUsed: 0, argusVerificationsUsed: 0,
        startedAt: new Date().toISOString(),
      });
    }
    return this.activeBudgets.get(incidentId)!;
  }

  private checkBudget(budget: RepairBudget, op: 'astra' | 'codex' | 'argus'): boolean {
    switch (op) {
      case 'astra': return budget.astraCallsUsed < budget.maxAstraCalls;
      case 'codex': return budget.codexAttemptsUsed < budget.maxCodexAttempts;
      case 'argus': return budget.argusVerificationsUsed < budget.maxArgusVerifications;
    }
  }

  private isTimeBudgetExceeded(budget: RepairBudget): boolean {
    return Date.now() - new Date(budget.startedAt).getTime() > budget.maxTotalDurationMs;
  }

  // ── Pipeline: Diagnose ────────────────────────────────────────────────────

  async diagnoseIncident(incidentId: string): Promise<AstraDiagnosis | null> {
    const budget = this.getBudget(incidentId);

    if (!this.checkBudget(budget, 'astra') || this.isTimeBudgetExceeded(budget)) {
      this.transitionState(incidentId, 'CREATED', 'BLOCKED_MODEL_UNAVAILABLE',
        'supervisor', 'Budget exceeded');
      return null;
    }

    // Ensure state is CREATED
    if (!this.incidentStates.has(incidentId)) {
      this.incidentStates.set(incidentId, 'CREATED');
    }

    // CREATED → COLLECTING_EVIDENCE
    this.transitionState(incidentId, 'CREATED', 'COLLECTING_EVIDENCE',
      'supervisor', 'Starting evidence collection');

    const incident = await repairMemory.getIncident(incidentId);
    if (!incident) {
      console.error(`[SelfHeal] Incident ${incidentId} not found`);
      return null;
    }

    // Collect evidence (separated into facts and hypotheses)
    const evidencePackage = await traceCollector.collectEvidence({
      incidentId, component: incident.component,
      symptom: incident.symptom, failureDomain: incident.failureDomain,
      metadata: incident.metadata as Record<string, unknown> | undefined,
    });

    // COLLECTING_EVIDENCE → DIAGNOSING
    this.transitionState(incidentId, 'COLLECTING_EVIDENCE', 'DIAGNOSING',
      'supervisor', 'Evidence collected, calling diagnostician',
      { provider: 'hermes', model: 'hermes-3-llama-3.1-8b' });

    budget.astraCallsUsed++;

    try {
      const diagnosis = await repairDiagnostician.diagnose(incident, evidencePackage, budget);
      // DIAGNOSING → DIAGNOSIS_COMPLETE
      this.transitionState(incidentId, 'DIAGNOSING', 'DIAGNOSIS_COMPLETE',
        'RepairDiagnostician', 'Diagnosis confirmed',
        { model: diagnosis.modelIdentity.actualModel, provider: diagnosis.modelIdentity.actualProvider });
      this.latestDiagnoses.set(incidentId, diagnosis);
      this.emit('incident:diagnosed', incidentId, diagnosis);
      return diagnosis;
    } catch (err: any) {
      if (err instanceof ModelUnavailableError) {
        // DIAGNOSING → BLOCKED_MODEL_UNAVAILABLE
        this.transitionState(incidentId, 'DIAGNOSING', 'BLOCKED_MODEL_UNAVAILABLE',
          'RepairDiagnostician', err.message);
      } else {
        console.error(`[SelfHeal] Diagnosis failed for ${incidentId}:`, err?.message);
        // Cannot transition to a generic 'failed' — stay in DIAGNOSING
        auditLog.appendEntry({
          incidentId, fromState: 'DIAGNOSING', toState: 'DIAGNOSING',
          timestamp: new Date().toISOString(), actor: 'RepairDiagnostician',
          reason: `Error: ${err?.message}`,
        });
      }
      return null;
    }
  }

  // ── Pipeline: Full Repair ─────────────────────────────────────────────────

  async repairIncident(incidentId: string): Promise<{
    diagnosis: AstraDiagnosis | null;
    attempt: RepairAttempt | null;
    approved: boolean;
    snapshot: SnapshotManifest | null;
  }> {
    // Phase 1: Diagnose (reuse if already completed)
    let diagnosis = this.latestDiagnoses.get(incidentId) ?? null;
    if (!diagnosis) {
      diagnosis = await this.diagnoseIncident(incidentId);
    }
    if (!diagnosis || (!diagnosis.selectedRootCause && !diagnosis.rootCause)) {
      return { diagnosis, attempt: null, approved: false, snapshot: null };
    }
    return this.executeRepairPipeline(incidentId, diagnosis);
  }

  async executeRepairPipeline(incidentId: string, diagnosis: AstraDiagnosis): Promise<{
    diagnosis: AstraDiagnosis | null;
    attempt: RepairAttempt | null;
    approved: boolean;
    snapshot: SnapshotManifest | null;
  }> {
    const budget = this.getBudget(incidentId);

    // Phase 2: Snapshot
    this.transitionState(incidentId, 'DIAGNOSIS_COMPLETE', 'SNAPSHOTTING',
      'supervisor', 'Creating dirty-state snapshot');

    let snapshot: SnapshotManifest;
    try {
      snapshot = await snapshotManager.createSnapshot(incidentId, diagnosis.affectedFiles);
      if (!snapshot.verified) {
        this.transitionState(incidentId, 'SNAPSHOTTING', 'BLOCKED_SNAPSHOT_INVALID',
          'SnapshotManager', 'Snapshot hash verification failed');
        return { diagnosis, attempt: null, approved: false, snapshot };
      }
      this.activeSnapshots.set(incidentId, snapshot);
    } catch (err: any) {
      this.transitionState(incidentId, 'SNAPSHOTTING', 'BLOCKED_SNAPSHOT_INVALID',
        'SnapshotManager', `Snapshot creation failed: ${err?.message}`);
      return { diagnosis, attempt: null, approved: false, snapshot: null };
    }

    // Phase 3: Plan
    if (!this.checkBudget(budget, 'codex')) {
      return { diagnosis, attempt: null, approved: false, snapshot };
    }

    this.transitionState(incidentId, 'SNAPSHOTTING', 'PLANNING',
      'supervisor', 'Snapshot verified, planning repair');

    let plan;
    try {
      plan = await repairPlanner.createRepairPlan(diagnosis);
    } catch (err: any) {
      console.error(`[SelfHeal] Planning failed:`, err?.message);
      return { diagnosis, attempt: null, approved: false, snapshot };
    }

    // Phase 4: Execute
    this.transitionState(incidentId, 'PLANNING', 'REPAIRING',
      'supervisor', 'Executing repair in isolated worktree');
    budget.codexAttemptsUsed++;

    let execution;
    try {
      execution = await repairExecutor.executeRepair(plan);
    } catch (err: any) {
      console.error(`[SelfHeal] Execution failed:`, err?.message);
      return { diagnosis, attempt: null, approved: false, snapshot };
    }

    // Phase 5: Test (with baseline comparison)
    this.transitionState(incidentId, 'REPAIRING', 'TESTING',
      'supervisor', 'Running tests with baseline comparison');

    const testReport = await repairTestRunner.runTests(
      plan.worktreePath, 'D:\\AgenticOS', diagnosis.testsRequired
    );

    if (testReport.overallVerdict === 'FAIL') {
      this.transitionState(incidentId, 'TESTING', 'BLOCKED_TEST_FAILURE',
        'RepairTestRunner', `New test failures introduced: ${testReport.baseline.newErrors.length}`);
      return { diagnosis, attempt: null, approved: false, snapshot };
    }

    // Phase 6: Verify
    if (!this.checkBudget(budget, 'argus')) {
      return { diagnosis, attempt: null, approved: false, snapshot };
    }

    this.transitionState(incidentId, 'TESTING', 'VERIFYING',
      'supervisor', 'Running Argus verification');
    budget.argusVerificationsUsed++;

    let verification;
    try {
      const incident = await repairMemory.getIncident(incidentId);
      verification = await repairVerifier.verify(incident!, diagnosis, execution.diff, testReport);
    } catch (err: any) {
      if (err instanceof VerifierUnavailableError) {
        this.transitionState(incidentId, 'VERIFYING', 'BLOCKED_VERIFIER_UNAVAILABLE',
          'RepairVerifier', err.message);
      }
      return { diagnosis, attempt: null, approved: false, snapshot };
    }

    // Build attempt record
    const attempt: RepairAttempt = {
      attemptId: execution.attemptId,
      incidentId,
      diagnosisId: diagnosis.diagnosisId,
      worktreePath: plan.worktreePath,
      diffSummary: execution.diff.slice(0, 500),
      fullDiff: execution.diff,
      filesChanged: execution.filesChanged,
      testReport,
      argusVerdict: verification.verdict,
      argusEvidence: verification.evidence,
      argusModelIdentity: verification.modelIdentity,
      status: 'verified',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    this.activeAttempts.set(incidentId, attempt);

    // Phase 7: Await Approval (ALWAYS in Phase 1)
    this.transitionState(incidentId, 'VERIFYING', 'AWAITING_APPROVAL',
      'DeploymentGate', 'Human approval required');

    this.emit('incident:awaiting_approval', incidentId, attempt);

    return { diagnosis, attempt, approved: false, snapshot };
  }

  // ── Approval (ONLY via API) ───────────────────────────────────────────────

  /** Called ONLY by the REST API endpoint. NEVER by the supervisor itself. */
  approveRepair(incidentId: string, approver: string): ApprovalRecord {
    const attempt = this.activeAttempts.get(incidentId);
    if (!attempt) throw new Error(`No active repair attempt for ${incidentId}`);

    const patchHash = computePatchHash(attempt.fullDiff);
    const record: ApprovalRecord = {
      incidentId,
      repairAttemptId: attempt.attemptId,
      approvedAt: new Date().toISOString(),
      approvalSource: 'human_api',
      patchHash,
      approver,
    };

    deploymentGate.recordApproval(record);
    this.transitionState(incidentId, 'AWAITING_APPROVAL', 'APPROVED',
      'human_api', `Approved by ${approver}`);

    return record;
  }

  /** Reject repair and transition to BLOCKED_APPROVAL_REQUIRED */
  rejectRepair(incidentId: string, reason = 'Rejected by human'): void {
    const currentState = this.getIncidentState(incidentId);
    if (currentState === 'AWAITING_APPROVAL') {
      this.transitionState(incidentId, 'AWAITING_APPROVAL', 'BLOCKED_APPROVAL_REQUIRED',
        'human_api', reason);
    }
  }

  /** Retrieve snapshot manifest for incident */
  getSnapshot(incidentId: string): SnapshotManifest | undefined {
    return this.activeSnapshots.get(incidentId);
  }

  /** Retrieve latest diagnosis for incident */
  getDiagnosis(incidentId: string): AstraDiagnosis | undefined {
    return this.latestDiagnoses.get(incidentId);
  }

  /** Check if any target files in main repo changed incompatibly after snapshot */
  checkConflict(incidentId: string): { conflict: boolean; conflictingFiles: string[] } {
    const attempt = this.activeAttempts.get(incidentId);
    const snapshot = this.activeSnapshots.get(incidentId);
    if (!attempt) return { conflict: false, conflictingFiles: [] };

    const conflictingFiles: string[] = [];
    for (const file of attempt.filesChanged) {
      const livePath = path.join('D:\\AgenticOS', file);
      if (!fs.existsSync(livePath)) continue;

      if (snapshot && snapshot.createdAt) {
        try {
          const liveStat = fs.statSync(livePath);
          const snapshotTime = new Date(snapshot.createdAt).getTime();
          if (liveStat.mtimeMs > snapshotTime + 1000) {
            conflictingFiles.push(file);
          }
        } catch {}
      }
    }

    return {
      conflict: conflictingFiles.length > 0,
      conflictingFiles,
    };
  }

  /** Deploy verified repair patch to production */
  async deployRepair(incidentId: string, approver = 'supervisor_autonomous'): Promise<{ success: boolean; error?: string }> {
    // Phase 1 release boundary: the running process may not write into the source repo and
    // rebuild it as "production". The installed runtime changes only via scripts/deploy-installed.cjs.
    // A governed repair-deploy path is Self-Heal Phase 2 work.
    if (process.env.AGENTICOS_SELFHEAL_REPO_DEPLOY !== '1') {
      logger.warn(`[SelfHeal] deployRepair(${incidentId}) refused: in-process repo deploy disabled (Phase 1 release boundary)`);
      return { success: false, error: 'In-process repair deployment is disabled; deploy only via scripts/deploy-installed.cjs (Self-Heal Phase 2 pending).' };
    }
    const attempt = this.activeAttempts.get(incidentId);
    if (!attempt) return { success: false, error: `No active repair attempt for ${incidentId}` };

    const currentState = this.getIncidentState(incidentId);
    if (currentState === 'AWAITING_APPROVAL') {
      this.approveRepair(incidentId, approver);
    }

    this.transitionState(incidentId, 'APPROVED', 'DEPLOYING', 'supervisor', 'Deploying verified repair patch');

    try {
      // 1. Copy changed files from isolated worktree to main repository
      for (const file of attempt.filesChanged) {
        const src = path.join(attempt.worktreePath, file);
        const dst = path.join('D:\\AgenticOS', file);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
      }

      // 2. Build production server
      logger.info(`[SelfHeal] Rebuilding production server after patch deployment...`);
      execSync('npm run build', { cwd: 'D:\\AgenticOS\\server', stdio: 'pipe' });

      // 3. Record in DB
      try {
        db.insert(repairDeployments).values({
          id: randomUUID(),
          incidentId,
          attemptId: attempt.attemptId,
          buildId: 'production',
          previousBuildId: 'base',
          deployedAt: new Date().toISOString(),
          status: 'deployed',
        }).run();
      } catch (dbErr: any) {
        logger.warn('[SelfHeal] Failed to record deployment in DB:', dbErr?.message);
      }

      attempt.status = 'deployed';
      this.transitionState(incidentId, 'DEPLOYING', 'MONITORING', 'supervisor', 'Repair deployed, monitoring');
      logger.info(`[SelfHeal] Repair deployed successfully for ${incidentId}`);
      return { success: true };
    } catch (e: any) {
      logger.error(`[SelfHeal] Deployment failed for ${incidentId}:`, e);
      return { success: false, error: e?.message };
    }
  }

  /** Close an incident after successful verification */
  async closeIncident(incidentId: string, reason = 'Verified resolution'): Promise<void> {
    const currentState = this.getIncidentState(incidentId);
    if (currentState === 'MONITORING') {
      this.transitionState(incidentId, 'MONITORING', 'COMPLETED', 'supervisor', reason);
      logger.info(`[SelfHeal] Incident ${incidentId} closed: ${reason}`);
    } else if (currentState === 'DEPLOYING') {
      this.transitionState(incidentId, 'DEPLOYING', 'MONITORING', 'supervisor', 'Advancing to monitoring');
      this.transitionState(incidentId, 'MONITORING', 'COMPLETED', 'supervisor', reason);
      logger.info(`[SelfHeal] Incident ${incidentId} closed: ${reason}`);
    } else if (currentState === 'APPROVED') {
      this.transitionState(incidentId, 'APPROVED', 'DEPLOYING', 'supervisor', 'Deploying repair');
      this.transitionState(incidentId, 'DEPLOYING', 'MONITORING', 'supervisor', 'Advancing to monitoring');
      this.transitionState(incidentId, 'MONITORING', 'COMPLETED', 'supervisor', reason);
      logger.info(`[SelfHeal] Incident ${incidentId} closed: ${reason}`);
    }
  }

  // ── Closed-Loop Repair ───────────────────────────────────────────────────

  /**
   * Complete Closed-Loop Autonomous Self-Heal:
   * expected capability fails/missing
   * → failure detector (SELFHEAL_DETECTED, SELFHEAL_INCIDENT_CREATED)
   * → Self-Heal Engineering Supervisor (SELFHEAL_ENGINEERING_STARTED)
   * → diagnose root cause
   * → choose engineering worker
   * → implement minimal repair (SELFHEAL_PATCH_APPLIED)
   * → build (SELFHEAL_BUILD_PASS)
   * → run targeted tests (SELFHEAL_TEST_PASS)
   * → reload/register capability (SELFHEAL_CAPABILITY_RELOADED)
   * → retry ORIGINAL USER ACTION (SELFHEAL_ORIGINAL_ACTION_RETRIED)
   * → read state back
   * → verify (SELFHEAL_RESULT_VERIFIED)
   * → report success/failure
   */
  /**
   * Execute closed-loop repair for an incident:
   * → persist durable RepairContext (goalId, prompt, target, classification)
   * → evaluate eligibility based on defect domain + evidence, NOT user verbs
   * → collect diagnostic evidence (Hermes / Engineering worker)
   * → apply patch
   * → run targeted tests (SELFHEAL_TEST_PASS)
   * → reload/register capability (SELFHEAL_CAPABILITY_RELOADED)
   * → retry ORIGINAL USER ACTION (SELFHEAL_ORIGINAL_ACTION_RETRIED)
   * → independent verification by Argus (SELFHEAL_RESULT_VERIFIED)
   * → update GoalRun and Incident to COMPLETED
   */
  async executeClosedLoopRepair(opts: import('./types.js').RepairContext | {
    incidentId: string;
    goalId?: string;
    conversationId?: string;
    turnId?: string;
    attemptId?: string;
    originalUserInput?: string;
    normalizedGoal?: string;
    capabilityId?: string;
    target?: string;
    failureEvidence?: any[];
    failureEvidenceIds?: string[];
    failureClassification?: import('./types.js').SystemFailureClassification;
    userAction?: import('./types.js').UserGoalAction;
    originalAction?: {
      prompt: string;
      conversationId: string;
      entityId: string;
      entityType: string;
      entityName: string;
      verb: string;
    };
    approver?: string;
    requiresPhysicalUserVerification?: boolean;
    resumeFromDiagnosing?: boolean;
  }): Promise<{ success: boolean; outcome?: any; verification?: any; error?: string }> {
    const incidentId = opts.incidentId;
    const goalId = ('goalId' in opts && opts.goalId) ? opts.goalId : undefined;
    const conversationId = opts.conversationId || ('originalAction' in opts ? opts.originalAction?.conversationId : '') || '';
    const prompt = ('originalUserInput' in opts && opts.originalUserInput)
      ? opts.originalUserInput
      : (('originalAction' in opts && opts.originalAction?.prompt) ? opts.originalAction.prompt : '');

    const userAction: import('./types.js').UserGoalAction = ('userAction' in opts && opts.userAction)
      ? opts.userAction
      : {
          verb: ('originalAction' in opts ? opts.originalAction?.verb : '') || 'open',
          target: ('target' in opts && opts.target) ? opts.target : (('originalAction' in opts && opts.originalAction?.entityName) ? opts.originalAction.entityName : ''),
          prompt,
          entityId: ('originalAction' in opts ? opts.originalAction?.entityId : undefined),
          entityType: ('originalAction' in opts ? opts.originalAction?.entityType : undefined),
          entityName: ('originalAction' in opts ? opts.originalAction?.entityName : undefined),
          conversationId,
        };

    const verb = (userAction.verb || 'open').toLowerCase().trim();
    const entityId = userAction.entityId || (('originalAction' in opts && opts.originalAction?.entityId) ? opts.originalAction.entityId : '') || userAction.target || 'target';
    const entityType = userAction.entityType || (('originalAction' in opts && opts.originalAction?.entityType) ? opts.originalAction.entityType : '') || 'capability';
    const entityName = userAction.entityName || (('originalAction' in opts && opts.originalAction?.entityName) ? opts.originalAction.entityName : '') || userAction.target || verb;
    const target = ('target' in opts && opts.target) ? opts.target : entityName;
    const turnId = 'turnId' in opts ? opts.turnId : undefined;
    const attemptId = 'attemptId' in opts ? opts.attemptId : undefined;
    const normalizedGoal = ('normalizedGoal' in opts && opts.normalizedGoal) ? opts.normalizedGoal : prompt;
    const capabilityId = ('capabilityId' in opts && opts.capabilityId) ? opts.capabilityId : `jarvis.capability.${verb}.${entityId}`;

    const failureClassification: import('./types.js').SystemFailureClassification = ('failureClassification' in opts && opts.failureClassification)
      ? opts.failureClassification
      : {
          domain: 'implementation',
          repairability: 'engineering',
          reason: `Internal execution defect in ${verb} on ${entityName}`,
        };
    const failureEvidenceIds = ('failureEvidenceIds' in opts && opts.failureEvidenceIds) ? opts.failureEvidenceIds : [];

    const isResumingDiagnosing = Boolean(opts.resumeFromDiagnosing || this.incidentStates.get(incidentId) === 'DIAGNOSING');

    // Recovery-chain guard: one closed-loop repair run per chain, and never from recovery work
    // (a self-heal retry must not start a repair of itself).
    {
      const { admitRepairRun } = await import('./recoveryChain.js');
      const gate = admitRepairRun({ incidentId }, { resume: isResumingDiagnosing });
      if (!gate.admit) {
        logger.warn('[JRT] SELFHEAL_REPAIR_RUN_REFUSED', { incidentId, reason: gate.reason, chainId: gate.chainId });
        console.log(`[JRT] SELFHEAL_REPAIR_RUN_REFUSED incidentId=${incidentId} reason=${gate.reason}`);
        return { success: false, error: `Closed-loop repair refused by the recovery guard (${gate.reason}); the incident is not repaired or retried automatically.` };
      }
    }

    try {
      if (!isResumingDiagnosing) {
        // 1. Initial State
        if (!this.incidentStates.has(incidentId)) {
          this.incidentStates.set(incidentId, 'CREATED');
        }

        // Ensure incident record exists durably in SQLite repair_incidents table with explicit goal_id & metadata
        try {
          const { repairIncidents } = await import('./schema.js');
          const { db } = await import('../../db/index.js');

          const { findChain } = await import('./recoveryChain.js');
          const metadataObj: Record<string, unknown> = {
            source: 'jarvis-next-voice',
            goalId: goalId || null,
            conversationId,
            turnId: turnId || null,
            attemptId: attemptId || null,
            originalUserInput: prompt,
            // The text a retry may re-run: recoveryController.approveRepair reads `originalGoal`.
            originalGoal: prompt,
            recoveryChainId: findChain({ incidentId })?.chainId ?? null,
            normalizedGoal,
            capabilityId,
            target,
            verb,
            entityId,
            entityType,
            entityName,
            failureClassification,
            failureEvidenceIds,
          };

          db.insert(repairIncidents).values({
            id: incidentId,
            goalId: goalId || null,
            component: capabilityId,
            failureDomain: failureClassification.domain || 'implementation',
            symptom: `User asked to "${prompt}" (action: ${verb} on ${entityName}), but internal defect encountered in ${failureClassification.domain}.`,
            detectedAt: new Date().toISOString(),
            status: 'CREATED',
            triggeredBy: 'automatic',
            priority: 'medium',
            metadata: metadataObj,
          }).onConflictDoUpdate({
            target: repairIncidents.id,
            set: {
              goalId: goalId || null,
              metadata: metadataObj,
            },
          }).run();
        } catch (dbErr: any) {
          logger.warn('[SelfHeal:Supervisor] Failed to upsert repair incident', { incidentId, error: dbErr?.message });
        }

        // 2. CREATED → COLLECTING_EVIDENCE
        this.transitionState(incidentId, 'CREATED', 'COLLECTING_EVIDENCE', 'supervisor', 'Starting evidence collection');

        // DEFECT 1 ROOT CAUSE FIX:
        // Separate UserGoalAction from SystemFailureClassification.
        // User verbs (open, read, inspect, navigate, show, capture, see, find, locate)
        // are valid user goals whose execution can expose internal defects in routing,
        // discovery, execution, permissions, perception, or verification.
        // SelfHeal eligibility is based on FAILURE DOMAIN + EVIDENCE, NOT on whether
        // the user verb is a mutation verb.
        if (failureClassification.repairability === 'external_blocker') {
          const reason = failureClassification.reason || 'True external blocker verified (physical disconnection / permanent third-party unavailability)';
          this.transitionState(incidentId, 'COLLECTING_EVIDENCE', 'BLOCKED_MODEL_UNAVAILABLE', 'supervisor', reason);
          logger.warn('[SelfHeal:Supervisor] Incident blocked by verified external blocker', { incidentId, reason });
          return { success: false, error: reason };
        }

        // 3. COLLECTING_EVIDENCE → DIAGNOSING
        this.transitionState(incidentId, 'COLLECTING_EVIDENCE', 'DIAGNOSING', 'supervisor', 'Evidence collected, calling diagnostician', { provider: 'hermes', model: 'hermes-3-llama-3.1-8b' });
      } else {
        this.incidentStates.set(incidentId, 'DIAGNOSING');
        logger.info('[SelfHeal:Supervisor] Resuming existing incident in DIAGNOSING state', { incidentId, goalId });
        console.log(`[SelfHeal] Resuming existing incident ${incidentId} in DIAGNOSING state (goalId=${goalId})`);
      }

      // Synchronize GoalRun status if goalId is present
      if (goalId) {
        try {
          const { goalLifecycleManager } = await import('../controlPlane/GoalLifecycle.js');
          goalLifecycleManager.transitionState(goalId, 'DIAGNOSING', {
            actor: 'Hermes',
            summary: `Self-heal incident ${incidentId} collecting diagnostic evidence with Hermes.`,
          });
        } catch {}
      }

      // Section 13 & 17: RecoveryWatchdog check & independent fallback routing
      const { recoveryWatchdog } = await import('../controlPlane/RecoveryWatchdog.js');
      if (recoveryWatchdog.isComponentBroken('diagnosis') || recoveryWatchdog.isComponentBroken('repair_execution')) {
        const brokenComp = recoveryWatchdog.isComponentBroken('diagnosis') ? 'diagnosis' : 'repair_execution';
        console.log(`[JRT] RECOVERY_WATCHDOG_INTERVENTION incidentId=${incidentId} failedComponent=${brokenComp} fallbackRoute=independent_direct_executor`);
      }

      // Check Hermes health before diagnosis/engineering
      const { hermesWatchdog } = await import('../../services/hermesWatchdog.js');
      const hermesHealth = await hermesWatchdog.checkHealth();
      if (!hermesHealth.reachable) {
        logger.warn('[SelfHeal] Hermes offline detected during repair incident. Recovering Hermes automatically...', { incidentId });
        console.log(`[JRT] DEPENDENCY_FAILURE component=Hermes recoverable=true incidentId=${incidentId}`);
        const recovery = await hermesWatchdog.recoverHermes(`Self-Heal repair for incident ${incidentId}`);
        if (recovery.success) {
          logger.info('[SelfHeal] Hermes recovered successfully; resuming repair mission', { incidentId });
          console.log(`[JRT] HERMES_RECOVERED incidentId=${incidentId}`);
        } else {
          logger.error('[SelfHeal] Hermes recovery failed for incident', { incidentId, error: recovery.error });
        }
      }

      // 4. Engineering Started
      logger.info('[JRT] SELFHEAL_ENGINEERING_STARTED', { incidentId, worker: 'hermes' });
      console.log(`[JRT] SELFHEAL_ENGINEERING_STARTED incidentId=${incidentId} worker=hermes`);

      // ── Phase 1 truthfulness gate ─────────────────────────────────────────
      // Everything that used to follow here was fabricated: a templated
      // "diagnosis", log-only SELFHEAL_PATCH_APPLIED / BUILD_PASS / TEST_PASS
      // lines, an auto-recorded "human_api" approval, an in-memory hard-coded
      // capability handler presented as the repair, a "retry" that called that
      // handler instead of the original request, and an unconditional
      // COMPLETED. None of it changed code, built, deployed, restarted or
      // observed anything, so it has been removed. Real code repair, build,
      // deployment to the installed runtime, restart and a lifecycle retry are
      // Self-Heal Phase 2. The incident stays honestly in DIAGNOSING.
      logger.warn('[JRT] SELFHEAL_REPAIR_NOT_IMPLEMENTED', { incidentId, goalId, verb, target });
      console.log(`[JRT] SELFHEAL_REPAIR_NOT_IMPLEMENTED incidentId=${incidentId} (no patch/build/deploy/retry performed)`);
      return {
        success: false,
        error: 'Closed-loop code repair is not implemented yet (Self-Heal Phase 2). No patch, build, deployment, restart or retry was performed; the incident remains in DIAGNOSING.',
      };
    } catch (err: any) {
      logger.error(`[SelfHeal] executeClosedLoopRepair failed: ${err?.message}`, err);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Phase 1: the ONLY sanctioned way for Self-Heal to retry a user's request.
   * The original text is re-submitted to TurnLifecycleController as a new
   * request (source self_heal_retry); the incident may be closed only when that
   * request ends VERIFIED.
   *
   * Recovery-chain guard: a retry is admitted through the registry (bounded attempts, backoff,
   * one in flight, and only the root operation's own recorded request text) and runs as RECOVERY
   * WORK, so if it fails the way the original did it records that on its chain and goes terminal
   * (FAILED/BLOCKED) instead of opening a new incident, repair run or worker handoff.
   */
  async retryOriginalRequestViaLifecycle(opts: {
    conversationId: string;
    text: string;
    incidentId: string;
    goalId?: string;
    retryOfRequestId?: string;
    /** Chain this retry belongs to; defaults to the chain of `incidentId` / `taskId`. */
    chainId?: string;
    /** Background task driving the retry (used to find its chain). */
    taskId?: string;
  }): Promise<{ requestId: string | null; outcome: string; reason: string; responseText?: string; chainId?: string; chainState?: string }> {
    const chains = await import('./recoveryChain.js');
    const admission = chains.admitRetry({
      chainId: opts.chainId,
      incidentId: opts.incidentId,
      taskId: opts.taskId,
      text: opts.text,
      conversationId: opts.conversationId,
      goalId: opts.goalId,
      retryOfRequestId: opts.retryOfRequestId,
    });
    if (!admission.admit) {
      logger.warn('[SelfHeal] retry refused by the recovery guard', { incidentId: opts.incidentId, chainId: admission.chainId, reason: admission.reason, state: admission.state });
      console.log(`[JRT] SELFHEAL_RETRY_REFUSED incidentId=${opts.incidentId} chain=${admission.chainId} reason=${admission.reason} state=${admission.state}`);
      return {
        requestId: null,
        outcome: admission.state === 'BLOCKED' ? 'BLOCKED' : 'FAILED',
        reason: `recovery_retry_refused:${admission.reason}`,
        chainId: admission.chainId,
        chainState: admission.state,
      };
    }

    let result: { requestId: string | null; outcome: string; reason: string; responseText?: string };
    let failureText: string | undefined;
    try {
      const { turnLifecycle } = await import('../turnLifecycle/index.js');
      const submitted = await turnLifecycle.submit({
        source: 'self_heal_retry',
        conversationId: opts.conversationId,
        text: opts.text,
        attached: {
          incidentId: opts.incidentId,
          goalId: opts.goalId,
          retryOfRequestId: opts.retryOfRequestId,
          recoveryChainId: admission.chainId,
          rootOperationId: admission.rootOperationId,
          retryAttempt: admission.attempt,
        },
      });
      if (submitted.duplicate) {
        result = { requestId: submitted.duplicateOf, outcome: 'FAILED', reason: `duplicate: ${submitted.reason}` };
      } else {
        const r = submitted.record;
        failureText = r.receipt?.error;
        result = { requestId: r.request.requestId, outcome: r.outcome || 'FAILED', reason: r.outcomeReason || '', responseText: r.responseText || undefined };
      }
    } catch (err: any) {
      chains.recordRetryResult({ chainId: admission.chainId, outcome: 'FAILED', reason: err?.message || String(err) });
      throw err;
    }

    const fin = chains.recordRetryResult({ chainId: admission.chainId, outcome: result.outcome, reason: result.reason, failureText });
    logger.info('[SelfHeal] retry result recorded on its recovery chain', { chainId: admission.chainId, attempt: admission.attempt, outcome: result.outcome, chainState: fin.state, terminalReason: fin.terminalReason });
    return { ...result, chainId: admission.chainId, chainState: fin.state };
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getBudgetStatus(incidentId: string): RepairBudget | null {
    return this.activeBudgets.get(incidentId) ?? null;
  }

  getStatus(): { initialized: boolean; activeIncidents: number; budgets: Record<string, RepairBudget> } {
    return {
      initialized: this.initialized,
      activeIncidents: this.activeBudgets.size,
      budgets: Object.fromEntries(this.activeBudgets),
    };
  }
}

export const selfHealSupervisor = new SelfHealSupervisor();

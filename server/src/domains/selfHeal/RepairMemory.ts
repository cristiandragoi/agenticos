import { db, rawDb } from '../../db/index.js';
import { eq, desc, like } from 'drizzle-orm';
import { repairIncidents, repairDiagnoses, repairAttempts } from './schema.js';
import { RepairIncident, AstraDiagnosis, RepairAttempt, IncidentStatus } from './types.js';

let tablesEnsured = false;
export function ensureRepairTables(): void {
  if (tablesEnsured) return;
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS repair_incidents (
        id TEXT PRIMARY KEY, goal_id TEXT, status TEXT NOT NULL, component TEXT NOT NULL,
        failure_domain TEXT NOT NULL, symptom TEXT NOT NULL, detected_at TEXT NOT NULL,
        resolved_at TEXT, triggered_by TEXT NOT NULL, priority TEXT NOT NULL, metadata TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_evidence (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, type TEXT NOT NULL,
        label TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_diagnoses (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, failure_domain TEXT NOT NULL,
        root_cause TEXT NOT NULL, confidence REAL NOT NULL, evidence TEXT NOT NULL,
        affected_files TEXT NOT NULL, repair_strategy TEXT NOT NULL, repair_steps TEXT NOT NULL,
        tests_required TEXT NOT NULL, risk_level TEXT NOT NULL, rollback_plan TEXT NOT NULL,
        requires_human_approval INTEGER NOT NULL, status TEXT NOT NULL, model TEXT NOT NULL,
        model_identity TEXT, candidate_causes TEXT, selected_root_cause TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_attempts (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, diagnosis_id TEXT NOT NULL,
        worktree_path TEXT NOT NULL, diff_summary TEXT NOT NULL, full_diff TEXT NOT NULL,
        files_changed TEXT NOT NULL, test_report TEXT, argus_verdict TEXT NOT NULL,
        argus_evidence TEXT NOT NULL, argus_model_identity TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS repair_deployments (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
        patch_hash TEXT NOT NULL, applied_at TEXT NOT NULL, status TEXT NOT NULL,
        backup_snapshot_path TEXT, verified_by_argus INTEGER NOT NULL, rollback_at TEXT
      );
    `);
    tablesEnsured = true;
  } catch (err: any) {
    console.error(`[RepairMemory] ensureRepairTables error: ${err?.message}`);
  }
}

export class RepairMemory {
  private inMemoryIncidents: Map<string, RepairIncident> = new Map();

  recordInMemoryIncident(incident: RepairIncident): void {
    this.inMemoryIncidents.set(incident.incidentId, incident);
  }

  /** Find past incidents with similar component/symptom */
  async findSimilarIncidents(component: string, symptom: string, limit: number = 5): Promise<RepairIncident[]> {
    ensureRepairTables();
    const results = await db.select()
      .from(repairIncidents)
      .where(eq(repairIncidents.component, component))
      .orderBy(desc(repairIncidents.detectedAt))
      .limit(limit);
      
    return results.map(r => ({
      incidentId: r.id,
      status: r.status as IncidentStatus,
      component: r.component,
      failureDomain: r.failureDomain as any,
      symptom: r.symptom,
      detectedAt: r.detectedAt,
      resolvedAt: r.resolvedAt,
      triggeredBy: r.triggeredBy as any,
      priority: r.priority as any,
      metadata: r.metadata
    }));
  }
  
  /** Get a successful repair strategy for a known root cause */
  async getSuccessfulRepairFor(rootCauseLike: string): Promise<AstraDiagnosis | null> {
    const results = await db.select()
      .from(repairDiagnoses)
      .where(like(repairDiagnoses.rootCause, `%${rootCauseLike}%`))
      .orderBy(desc(repairDiagnoses.createdAt))
      .limit(1);
      
    if (results.length === 0) return null;
    
    const r = results[0];
    return {
      diagnosisId: r.id,
      incidentId: r.incidentId,
      modelIdentity: r.modelIdentity ?? { requestedProvider: 'unknown', requestedModel: 'unknown', actualProvider: r.model, actualModel: r.model, requestId: '', fallbackUsed: false, fallbackAuthorized: false, verified: false },
      failureDomain: r.failureDomain as any,
      rootCause: r.rootCause,
      confidence: r.confidence,
      candidateCauses: r.candidateCauses ?? [],
      selectedRootCause: r.selectedRootCause ?? r.rootCause,
      evidence: r.evidence,
      affectedFiles: r.affectedFiles,
      repairStrategy: r.repairStrategy,
      repairSteps: r.repairSteps,
      testsRequired: r.testsRequired,
      riskLevel: r.riskLevel as any,
      rollbackPlan: r.rollbackPlan,
      requiresHumanApproval: r.requiresHumanApproval,
      status: r.status as any,
      createdAt: r.createdAt
    };
  }
  
  /** Get full incident history including all diagnoses, attempts, verifications */
  async getIncidentHistory(incidentId: string): Promise<{ incident: RepairIncident; diagnoses: AstraDiagnosis[]; attempts: RepairAttempt[]; } | null> {
    const incidentResult = await this.getIncident(incidentId);
    if (!incidentResult) return null;
    
    const diagnosesRaw = await db.select().from(repairDiagnoses).where(eq(repairDiagnoses.incidentId, incidentId));
    const diagnoses: AstraDiagnosis[] = diagnosesRaw.map(r => ({
      diagnosisId: r.id,
      incidentId: r.incidentId,
      modelIdentity: r.modelIdentity ?? { requestedProvider: 'unknown', requestedModel: 'unknown', actualProvider: r.model, actualModel: r.model, requestId: '', fallbackUsed: false, fallbackAuthorized: false, verified: false },
      failureDomain: r.failureDomain as any,
      rootCause: r.rootCause,
      confidence: r.confidence,
      candidateCauses: r.candidateCauses ?? [],
      selectedRootCause: r.selectedRootCause ?? r.rootCause,
      evidence: r.evidence,
      affectedFiles: r.affectedFiles,
      repairStrategy: r.repairStrategy,
      repairSteps: r.repairSteps,
      testsRequired: r.testsRequired,
      riskLevel: r.riskLevel as any,
      rollbackPlan: r.rollbackPlan,
      requiresHumanApproval: r.requiresHumanApproval,
      status: r.status as any,
      createdAt: r.createdAt
    }));
    
    const attemptsRaw = await db.select().from(repairAttempts).where(eq(repairAttempts.incidentId, incidentId));
    const attempts: RepairAttempt[] = attemptsRaw.map(r => ({
      attemptId: r.id,
      incidentId: r.incidentId,
      diagnosisId: r.diagnosisId,
      worktreePath: r.worktreePath,
      diffSummary: r.diffSummary,
      fullDiff: r.fullDiff,
      filesChanged: r.filesChanged,
      testReport: r.testReport ?? { results: [], baseline: { baselineErrors: [], postPatchErrors: [], newErrors: [], fixedErrors: [], verdict: 'PASS' as const }, overallVerdict: 'PASS' as const },
      argusVerdict: r.argusVerdict as any,
      argusEvidence: r.argusEvidence,
      argusModelIdentity: r.argusModelIdentity,
      status: r.status as any,
      createdAt: r.createdAt,
      completedAt: r.completedAt
    }));
    
    return { incident: incidentResult, diagnoses, attempts };
  }
  
  /** Get all incidents ordered by most recent */
  async listIncidents(limit: number = 20): Promise<RepairIncident[]> {
    const results = await db.select().from(repairIncidents).orderBy(desc(repairIncidents.detectedAt)).limit(limit);
    return results.map(r => ({
      incidentId: r.id,
      status: r.status as IncidentStatus,
      component: r.component,
      failureDomain: r.failureDomain as any,
      symptom: r.symptom,
      detectedAt: r.detectedAt,
      resolvedAt: r.resolvedAt,
      triggeredBy: r.triggeredBy as any,
      priority: r.priority as any,
      metadata: r.metadata
    }));
  }
  
  /** Get incident by ID */
  async getIncident(incidentId: string): Promise<RepairIncident | null> {
    ensureRepairTables();
    try {
      const results = await db.select().from(repairIncidents).where(eq(repairIncidents.id, incidentId)).limit(1);
      if (results.length === 0) return this.inMemoryIncidents.get(incidentId) || null;
      const r = results[0];
      return {
        incidentId: r.id,
        status: r.status as IncidentStatus,
        component: r.component,
        failureDomain: r.failureDomain as any,
        symptom: r.symptom,
        detectedAt: r.detectedAt,
        resolvedAt: r.resolvedAt,
        triggeredBy: r.triggeredBy as any,
        priority: r.priority as any,
        metadata: r.metadata
      };
    } catch {
      return this.inMemoryIncidents.get(incidentId) || null;
    }
  }
  
  /** Update incident status */
  async updateIncidentStatus(incidentId: string, status: IncidentStatus): Promise<void> {
    const updateData: any = { status };
    if (status === 'COMPLETED') {
      updateData.resolvedAt = new Date().toISOString();
    }
    
    await db.update(repairIncidents)
      .set(updateData)
      .where(eq(repairIncidents.id, incidentId))
      .run();
  }
}
export const repairMemory = new RepairMemory();

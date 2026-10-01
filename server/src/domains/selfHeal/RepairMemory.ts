import { db } from '../../db/index.js';
import { eq, desc, like } from 'drizzle-orm';
import { repairIncidents, repairDiagnoses, repairAttempts } from './schema.js';
import { RepairIncident, AstraDiagnosis, RepairAttempt, IncidentStatus } from './types.js';

export class RepairMemory {
  /** Find past incidents with similar component/symptom */
  async findSimilarIncidents(component: string, symptom: string, limit: number = 5): Promise<RepairIncident[]> {
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
    const results = await db.select().from(repairIncidents).where(eq(repairIncidents.id, incidentId)).limit(1);
    if (results.length === 0) return null;
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

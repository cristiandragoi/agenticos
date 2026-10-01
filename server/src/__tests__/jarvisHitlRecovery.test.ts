import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
import { rawDb } from '../db/index.js';
import { recoveryController } from '../domains/jarvis/execution/recoveryController.js';
import { selfHealSupervisor } from '../domains/selfHeal/SelfHealSupervisor.js';
import { repairMemory } from '../domains/selfHeal/RepairMemory.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';

describe('Jarvis Human-in-the-Loop Self-Heal Recovery Lifecycle', () => {
  const incA = 'INC-TEST-001-A';
  const incB = 'INC-TEST-002-B';

  beforeAll(() => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS repair_incidents (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, component TEXT NOT NULL,
        failure_domain TEXT NOT NULL, symptom TEXT NOT NULL, detected_at TEXT NOT NULL,
        resolved_at TEXT, triggered_by TEXT NOT NULL, priority TEXT NOT NULL, metadata TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_evidence (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
        content TEXT NOT NULL, source TEXT NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_deployments (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, patch_hash TEXT NOT NULL,
        deployed_at TEXT NOT NULL, deployed_by TEXT NOT NULL, rollback_plan TEXT NOT NULL
      );
    `);
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Reset supervisors / memory states for testing
    (selfHealSupervisor as any).incidentStates.set(incA, 'AWAITING_APPROVAL');
    (selfHealSupervisor as any).incidentStates.set(incB, 'AWAITING_APPROVAL');

    (selfHealSupervisor as any).activeAttempts.set(incA, {
      attemptId: 'att-001-a',
      incidentId: incA,
      fullDiff: 'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-broken\n+fixed\n',
      filesChanged: ['test.ts'],
      diffSummary: 'Fix broken host check',
      patchHash: 'hash-001',
      testReport: { overallVerdict: 'PASS' },
    });

    (selfHealSupervisor as any).activeAttempts.set(incB, {
      attemptId: 'att-002-b',
      incidentId: incB,
      fullDiff: 'diff --git a/other.ts b/other.ts\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n+new\n',
      filesChanged: ['other.ts'],
      diffSummary: 'Fix other bug',
      patchHash: 'hash-002',
      testReport: { overallVerdict: 'PASS' },
    });
  });

  it('Phase 4 & 13: Approval is strictly bound to specific incident ID (multi-incident isolation)', async () => {
    // Spy deployRepair & handleUserTurn
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    vi.spyOn(universalExecutionController, 'handleUserTurn').mockResolvedValue({
      handled: true,
      execution: { success: true },
      verification: { verified: true },
      spokenText: "I've opened YouTube.",
      entityName: 'YouTube',
    } as any);

    const progressStages: string[] = [];
    const res = await recoveryController.approveRepair({
      incidentId: incA,
      conversationId: 'conv-123',
      approver: 'test_user',
      verifyFn: () => true,
      onProgress: (p) => progressStages.push(p.stage),
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('recovered');
    expect(res.incidentId).toBe(incA);

    // Verify incident A transitioned out of AWAITING_APPROVAL
    const stateA = selfHealSupervisor.getIncidentState(incA);
    expect(stateA).toBe('COMPLETED');

    // CRITICAL: Incident B remains in AWAITING_APPROVAL (isolation preserved)
    const stateB = selfHealSupervisor.getIncidentState(incB);
    expect(stateB).toBe('AWAITING_APPROVAL');

    expect(progressStages).toContain('APPROVED');
    expect(progressStages).toContain('APPLYING');
    expect(progressStages).toContain('VERIFIED');
    expect(progressStages).toContain('RETRYING_ORIGINAL_GOAL');
    expect(progressStages).toContain('RECOVERED');
  });

  it('Phase 11: Rejection flow leaves production unchanged and transitions to BLOCKED_APPROVAL_REQUIRED', async () => {
    const deploySpy = vi.spyOn(selfHealSupervisor, 'deployRepair');
    const uecSpy = vi.spyOn(universalExecutionController, 'handleUserTurn');

    const progressStages: string[] = [];
    const res = await recoveryController.rejectRepair({
      incidentId: incB,
      conversationId: 'conv-123',
      reason: 'Rejected by user',
      onProgress: (p) => progressStages.push(p.stage),
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('rejected');
    expect(res.message).toBe('I left the system unchanged. The proposed repair was rejected.');

    // deployRepair must NEVER be called on rejection
    expect(deploySpy).not.toHaveBeenCalled();
    // original goal retry must NOT be triggered on rejection
    expect(uecSpy).not.toHaveBeenCalled();

    // Incident state becomes BLOCKED_APPROVAL_REQUIRED
    const stateB = selfHealSupervisor.getIncidentState(incB);
    expect(stateB).toBe('BLOCKED_APPROVAL_REQUIRED');

    // Incident A was untouched
    expect(selfHealSupervisor.getIncidentState(incA)).toBe('AWAITING_APPROVAL');
    expect(progressStages).toContain('REJECTED');
  });

  it('Phase 5: Conflict detection stops application safely without overwriting code', async () => {
    vi.spyOn(selfHealSupervisor, 'checkConflict').mockReturnValue({
      conflict: true,
      conflictingFiles: ['test.ts'],
    });
    const deploySpy = vi.spyOn(selfHealSupervisor, 'deployRepair');

    const progressStages: string[] = [];
    const res = await recoveryController.approveRepair({
      incidentId: incA,
      conversationId: 'conv-123',
      verifyFn: () => true,
      onProgress: (p) => progressStages.push(p.stage),
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('conflict');
    expect(res.message).toBe('The code changed after the repair was prepared, so I did not apply it automatically.');
    expect(deploySpy).not.toHaveBeenCalled();
    expect(progressStages).toContain('CONFLICT');
  });

  it('Phase 6: Verification after apply must succeed before marking as recovered', async () => {
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    const uecSpy = vi.spyOn(universalExecutionController, 'handleUserTurn');

    const progressStages: string[] = [];
    const res = await recoveryController.approveRepair({
      incidentId: incA,
      conversationId: 'conv-123',
      verifyFn: () => false, // Post-apply verification fails
      onProgress: (p) => progressStages.push(p.stage),
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('verification_failed');
    expect(res.message).toBe(
      'The repair was applied in the recovery environment, but verification failed, so I did not treat the issue as resolved.',
    );
    // Original goal retry must not be called if post-apply verification failed
    expect(uecSpy).not.toHaveBeenCalled();
    expect(progressStages).toContain('VERIFICATION_FAILED');
  });

  it('Phase 7 & 8: Original user goal is retried canonically and verified before declaring RECOVERED', async () => {
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    vi.spyOn(repairMemory, 'getIncident').mockResolvedValue({
      incidentId: incA,
      metadata: { originalGoal: 'Open YouTube' },
    } as any);

    let retriedPrompt = '';
    vi.spyOn(universalExecutionController, 'handleUserTurn').mockImplementation(async (opts: any) => {
      retriedPrompt = opts.prompt;
      return {
        handled: true,
        execution: { success: true },
        verification: { verified: true },
        spokenText: "I've opened YouTube.",
        entityName: 'YouTube',
      } as any;
    });

    const res = await recoveryController.approveRepair({
      incidentId: incA,
      conversationId: 'conv-123',
      verifyFn: () => true,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('recovered');
    expect(retriedPrompt).toBe('Open YouTube');
    expect(res.message).toContain('The repair was applied successfully and verified. I retried your request, and YouTube is open now.');
  });

  it('Phase 8: Retry failure transitions truthfully to RECOVERY_FAILED without infinite recursion', async () => {
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    vi.spyOn(repairMemory, 'getIncident').mockResolvedValue({
      incidentId: incA,
      metadata: { originalGoal: 'Open YouTube' },
    } as any);

    let retryCount = 0;
    vi.spyOn(universalExecutionController, 'handleUserTurn').mockImplementation(async () => {
      retryCount++;
      return {
        handled: true,
        execution: { success: false, error: 'Target still unreachable' },
        verification: { verified: false, realityCheck: 'Browser target unreachable' },
        spokenText: "I couldn't complete that command.",
      } as any;
    });

    const progressStages: string[] = [];
    const res = await recoveryController.approveRepair({
      incidentId: incA,
      conversationId: 'conv-123',
      verifyFn: () => true,
      onProgress: (p) => progressStages.push(p.stage),
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('recovery_failed');
    expect(res.message).toBe('The repair was applied and verified, but retrying the request did not succeed.');
    // Exactly 1 bounded retry attempt occurred
    expect(retryCount).toBe(1);
    expect(progressStages).toContain('RECOVERY_FAILED');
  });

  it('Phase 12: Approval persistence safety prevents silent approval after restart or lost state', async () => {
    // Incident in unknown or null state
    const unknownInc = 'INC-LOST-UNKNOWN';

    const resApprove = await recoveryController.approveRepair({
      incidentId: unknownInc,
      verifyFn: () => true,
    });

    expect(resApprove.success).toBe(false);
    expect(resApprove.status).toBe('error');
    expect(resApprove.message).toBe('Repair approval state could not be restored. No changes were applied.');

    const resReject = await recoveryController.rejectRepair({
      incidentId: unknownInc,
    });
    expect(resReject.success).toBe(false);
    expect(resReject.status).toBe('error');
    expect(resReject.message).toBe('Repair approval state could not be restored. No changes were applied.');
  });
});

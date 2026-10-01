import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
import { rawDb } from '../db/index.js';
import { recoveryController } from '../domains/jarvis/execution/recoveryController.js';
import { selfHealSupervisor } from '../domains/selfHeal/SelfHealSupervisor.js';
import { repairMemory } from '../domains/selfHeal/RepairMemory.js';
// Note: universalExecutionController is no longer called by recoveryController directly.
// Phase 1 mandates all retries go through selfHealSupervisor.retryOriginalRequestViaLifecycle.

describe('Jarvis Human-in-the-Loop Self-Heal Recovery Lifecycle', () => {
  const incA = 'INC-TEST-001-A';
  const incB = 'INC-TEST-002-B';

  beforeAll(() => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS repair_incidents (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, component TEXT NOT NULL,
        failure_domain TEXT NOT NULL, symptom TEXT NOT NULL, detected_at TEXT NOT NULL,
        resolved_at TEXT, triggered_by TEXT NOT NULL, priority TEXT NOT NULL, metadata TEXT NOT NULL,
        goal_id TEXT
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
    // Phase 1: retry goes through selfHealSupervisor.retryOriginalRequestViaLifecycle, not UEC directly.
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    vi.spyOn(repairMemory, 'getIncident').mockResolvedValue({
      incidentId: incA,
      metadata: { originalGoal: 'Fix broken host check' },
    } as any);
    vi.spyOn(selfHealSupervisor, 'retryOriginalRequestViaLifecycle').mockResolvedValue({
      requestId: 'req-test-001',
      outcome: 'VERIFIED',
      reason: 'Original goal succeeded on retry',
      responseText: "I've opened YouTube.",
    });

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
    // Phase 1 emits REPAIR_BUILD_OK (not VERIFIED) before the retry.
    expect(progressStages).toContain('REPAIR_BUILD_OK');
    expect(progressStages).toContain('RETRYING_ORIGINAL_GOAL');
    expect(progressStages).toContain('RECOVERED');
  });

  it('Phase 11: Rejection flow leaves production unchanged and transitions to BLOCKED_APPROVAL_REQUIRED', async () => {
    const deploySpy = vi.spyOn(selfHealSupervisor, 'deployRepair');
    // Phase 1: retry goes through the lifecycle, not UEC directly.
    const retrySpy = vi.spyOn(selfHealSupervisor, 'retryOriginalRequestViaLifecycle');

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
    expect(retrySpy).not.toHaveBeenCalled();

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
    // Phase 1: retry goes through the lifecycle, not UEC directly.
    const retrySpy = vi.spyOn(selfHealSupervisor, 'retryOriginalRequestViaLifecycle');

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
    expect(retrySpy).not.toHaveBeenCalled();
    expect(progressStages).toContain('VERIFICATION_FAILED');
  });

  it('Phase 7 & 8: Original user goal is retried canonically and verified before declaring RECOVERED', async () => {
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    vi.spyOn(repairMemory, 'getIncident').mockResolvedValue({
      incidentId: incA,
      metadata: { originalGoal: 'Open YouTube' },
    } as any);

    // Phase 1: mock at the lifecycle boundary, not UEC directly.
    vi.spyOn(selfHealSupervisor, 'retryOriginalRequestViaLifecycle').mockImplementation(async (opts: any) => {
      expect(opts.text).toBe('Open YouTube');
      return {
        requestId: 'req-retry-001',
        outcome: 'VERIFIED',
        reason: 'YouTube is open',
        responseText: "I've opened YouTube.",
      };
    });

    const res = await recoveryController.approveRepair({
      incidentId: incA,
      conversationId: 'conv-123',
      verifyFn: () => true,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('recovered');
    // Phase 1 message format: 'The repair was applied and I retried your request; the result was independently verified. <responseText>'
    expect(res.message).toContain('The repair was applied and I retried your request');
    expect(res.message).toContain('independently verified');
  });

  it('Phase 8: Retry failure transitions truthfully to RECOVERY_FAILED without infinite recursion', async () => {
    vi.spyOn(selfHealSupervisor, 'deployRepair').mockResolvedValue({ success: true, filesDeployed: ['test.ts'] } as any);
    vi.spyOn(repairMemory, 'getIncident').mockResolvedValue({
      incidentId: incA,
      metadata: { originalGoal: 'Open YouTube' },
    } as any);

    let retryCount = 0;
    // Phase 1: mock at the lifecycle boundary. retryOriginalRequestViaLifecycle is called once.
    vi.spyOn(selfHealSupervisor, 'retryOriginalRequestViaLifecycle').mockImplementation(async () => {
      retryCount++;
      return {
        requestId: 'req-retry-fail-001',
        outcome: 'FAILED',
        reason: 'Target still unreachable',
        responseText: "I couldn't complete that command.",
      };
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

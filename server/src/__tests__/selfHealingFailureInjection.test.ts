import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { selfHealSupervisor } from '../domains/selfHeal/SelfHealSupervisor.js';
import { raiseSelfHealIncident } from '../domains/selfHeal/raiseSelfHealIncident.js';
import { repairMemory } from '../domains/selfHeal/RepairMemory.js';
import { auditLog } from '../domains/selfHeal/AuditLog.js';
import { cortexDb } from '../services/cortex/cortexDb.js';
import { hindsightService } from '../services/cortex/hindsightService.js';
import { snapshotManager } from '../domains/selfHeal/SnapshotManager.js';
import { repairPlanner } from '../domains/selfHeal/RepairPlanner.js';
import { repairExecutor } from '../domains/selfHeal/RepairExecutor.js';
import { repairTestRunner } from '../domains/selfHeal/RepairTestRunner.js';
import { repairVerifier } from '../domains/selfHeal/RepairVerifier.js';

describe('Second Acceptance Case: Self-Healing Failure Injection & Autonomous Recovery', () => {
  const testIncidentId = 'inc-injection-test-continuation-001';
  const testWorktree = `D:\\AgenticOS-Recovery\\${testIncidentId}`;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (fs.existsSync(testWorktree)) {
      try {
        fs.rmSync(testWorktree, { recursive: true, force: true });
      } catch {}
    }
  });

  it('autonomously detects, captures, diagnoses with Cortex, repairs in isolation, verifies, and records to Hindsight', async () => {
    // 1. Controlled Failure Injection:
    // Simulate a broken task-continuation transition where spoken recipient address caused context drop
    const injectedFailure = {
      component: 'task_continuation',
      symptom: 'Spoken recipient address lost during multi-turn continuation; context dropped',
      conversationId: 'test-injection-conv-continuation-1',
      originalAction: {
        prompt: 'CD International Project at Gmail.com',
        conversationId: 'test-injection-conv-continuation-1',
        entityId: 'email',
        entityType: 'service',
        entityName: 'Gmail',
        verb: 'compose',
      },
    };

    // Verify Cortex has engineering traps seeded and accessible
    const cortexTraps = cortexDb.getAntiPatterns();
    expect(cortexTraps.length).toBeGreaterThanOrEqual(1);
    const continuationTrap = cortexTraps.find(t => t.tags.includes('continuation') || t.tags.includes('email'));
    expect(continuationTrap).toBeDefined();

    // 2. Mock external execution in isolated worktree to prevent modifying repository or launching external CLI during vitest
    const mockDiff = `diff --git a/server/src/services/email/EmailService.ts b/server/src/services/email/EmailService.ts
--- a/server/src/services/email/EmailService.ts
+++ b/server/src/services/email/EmailService.ts
@@ -100,6 +100,8 @@
+  // Normalize spoken email address before matching
+  raw = normalizeSpokenEmailAddress(raw);
`;

    vi.spyOn(snapshotManager, 'createSnapshot').mockResolvedValue({
      incidentId: testIncidentId,
      headCommit: 'e4819da',
      worktreePath: testWorktree,
      dirtyFiles: ['server/src/services/email/EmailService.ts'],
      untrackedFiles: [],
      files: [],
      verified: true,
      createdAt: new Date().toISOString(),
    });

    vi.spyOn(repairPlanner, 'createRepairPlan').mockImplementation(async (diagnosis) => {
      fs.mkdirSync(testWorktree, { recursive: true });
      return {
        incidentId: diagnosis.incidentId,
        diagnosisId: diagnosis.diagnosisId,
        worktreePath: testWorktree,
        codexPrompt: 'Apply spoken email normalization fix and preserve active email task',
        affectedFiles: diagnosis.affectedFiles,
        testsToRun: ['npm run build'],
        sandboxMode: 'workspace-write',
        timeoutMs: 30000,
      };
    });

    vi.spyOn(repairExecutor, 'executeRepair').mockResolvedValue({
      attemptId: 'att-injection-repair-01',
      success: true,
      diff: mockDiff,
      filesChanged: ['server/src/services/email/EmailService.ts'],
    });

    vi.spyOn(repairTestRunner, 'runTests').mockResolvedValue({
      overallVerdict: 'PASS',
      baseline: {
        baselineErrors: [],
        postPatchErrors: [],
        newErrors: [],
        resolvedErrors: [],
      },
      results: [{
        command: 'npx tsc --noEmit',
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 2500,
      }],
      summary: 'TypeScript compilation and build passed with 0 errors.',
      durationMs: 3000,
    });

    vi.spyOn(repairVerifier, 'verify').mockResolvedValue({
      verdict: 'approve',
      evidence: 'Argus verified: Spoken recipient normalization prevents task context loss and satisfies test contract.',
      modelIdentity: {
        requestedProvider: 'argus',
        requestedModel: 'argus',
        actualProvider: 'argus',
        actualModel: 'argus-deterministic',
        requestId: 'req-verif-01',
        fallbackUsed: false,
        fallbackAuthorized: false,
        verified: true,
      },
    });

    const recordLessonSpy = vi.spyOn(hindsightService, 'recordLesson');
    const addPatternSpy = vi.spyOn(cortexDb, 'addPattern');

    // 3. Trigger Closed-Loop Autonomous Recovery
    const result = await selfHealSupervisor.executeClosedLoopRepair({
      incidentId: testIncidentId,
      conversationId: injectedFailure.conversationId,
      originalUserInput: injectedFailure.originalAction.prompt,
      capabilityId: injectedFailure.component,
      target: 'Gmail',
      failureClassification: {
        domain: 'implementation',
        repairability: 'engineering',
        reason: injectedFailure.symptom,
      },
      originalAction: injectedFailure.originalAction,
    });

    // 4. Verify End-to-End Recovery Pipeline
    expect(result.success).toBe(true);
    expect(result.verification?.verdict).toBe('approve');

    // 5. Verify State Machine Transitions
    // Pipeline must transition: CREATED -> COLLECTING_EVIDENCE -> DIAGNOSING -> DIAGNOSIS_COMPLETE -> SNAPSHOTTING -> PLANNING -> REPAIRING -> TESTING -> VERIFYING -> AWAITING_APPROVAL
    const finalState = selfHealSupervisor.getIncidentState(testIncidentId);
    expect(finalState).toBe('AWAITING_APPROVAL');

    const auditEntries = auditLog.getEntries(testIncidentId);
    expect(auditEntries.length).toBeGreaterThanOrEqual(8);
    const toStates = auditEntries.map(e => e.toState);
    expect(auditEntries[0].fromState).toBe('CREATED');
    expect(toStates).toContain('COLLECTING_EVIDENCE');
    expect(toStates).toContain('DIAGNOSING');
    expect(toStates).toContain('DIAGNOSIS_COMPLETE');
    expect(toStates).toContain('SNAPSHOTTING');
    expect(toStates).toContain('PLANNING');
    expect(toStates).toContain('REPAIRING');
    expect(toStates).toContain('TESTING');
    expect(toStates).toContain('VERIFYING');
    expect(toStates).toContain('AWAITING_APPROVAL');

    // 6. Verify Hindsight & Cortex Shared Memory Persistence
    expect(recordLessonSpy).toHaveBeenCalled();
    const recordedLesson = recordLessonSpy.mock.calls[0][0];
    expect(recordedLesson.signature).toContain('compose on Gmail');
    expect(recordedLesson.rootCause).toContain('Task continuation broken');
    expect(recordedLesson.verified).toBe(true);

    expect(addPatternSpy).toHaveBeenCalled();
    const addedPattern = addPatternSpy.mock.calls[0][0];
    expect(addedPattern.tags).toContain('compose');
    expect(addedPattern.tags).toContain('self_heal');

    // Verify Hindsight MEMORY.md on disk was populated
    const lessonsContent = hindsightService.readLessons();
    expect(lessonsContent).toContain('compose on Gmail');
    expect(lessonsContent).toContain('Confirmed Root Cause');
    expect(lessonsContent).toContain('Repair & Regression Evidence');
  });
});

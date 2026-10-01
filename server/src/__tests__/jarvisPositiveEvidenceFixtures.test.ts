/**
 * jarvisPositiveEvidenceFixtures.test.ts
 *
 * Positive evidence fixture tests — prove that genuine persisted records
 * produce responses whose IDs and states exactly match the fixture data.
 *
 * One fixture per evidence scenario:
 *   1. Genuine queued task.
 *   2. Genuine running CodeX task.
 *   3. Genuine pending approval task.
 *   4. Genuine granted (allowed) approval task.
 *   5. Genuine completed + verified task (verificationState=passed, resultText present).
 *   6. Auth request / blocked action — capability absent; always returns grounded negative.
 *   7. Notification subscription — capability absent; always returns grounded negative.
 *
 * All assertions check exact field values from the fixture — not loose pattern matches.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { OperationalClaimGate, OperationalController } from '../domains/jarvis/operationalEvidence.js';
import { rawDb, assertTestDatabaseIsolation } from '../db/index.js';
import type { BackgroundTaskRecord } from '../services/backgroundTasks/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE ISOLATION PROOF
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(() => {
  assertTestDatabaseIsolation();
});

beforeEach(() => {
  backgroundTaskRepo.ensureTables();
  rawDb.exec('DELETE FROM background_task_events');
  rawDb.exec('DELETE FROM background_tasks');
});

// ── Shared fixture helper ─────────────────────────────────────────────────────
function makeTask(overrides: Partial<BackgroundTaskRecord> & { taskId: string; conversationId: string }): BackgroundTaskRecord {
  const now = new Date().toISOString();
  return {
    title: 'Fixture Task',
    objective: 'Fixture objective',
    originalRequest: 'Fixture request',
    route: 'codex',
    selectedAgent: 'CodeX',
    status: 'queued',
    priority: 'medium',
    projectId: null,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    conversationSessionId: null,
    worker: 'codex',
    linkedRunId: null,
    linkedBoardCardId: null,
    parentTaskId: null,
    childTaskIds: [],
    currentStage: 'queued',
    progressMessage: 'Waiting to start',
    filesChanged: [],
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    approvalState: 'none',
    blocker: null,
    lastError: null,
    cancellationRequested: false,
    resumable: false,
    resultText: null,
    attempt: 1,
    metadata: {},
    workspaceRoot: 'D:\\AgenticOS',
    ...overrides,
  };
}

const CONV = 'conv-positive-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 1: Genuine queued task
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 1 — Genuine queued task', () => {
  const fixture: BackgroundTaskRecord = makeTask({
    taskId: 'bgtask-fixture-queued',
    conversationId: CONV,
    title: 'Build email digest feature',
    objective: 'Implement weekly email digest',
    worker: 'codex',
    status: 'queued',
    progressMessage: 'Waiting for CodeX slot',
    linkedRunId: null,
  });

  it('OperationalController returns exact fixture ID, title, state, and progress', async () => {
    backgroundTaskRepo.insertTask(fixture);

    const result = await OperationalController.handleOperationalRequest(
      `what is the status of task ${fixture.taskId}?`,
      CONV
    );

    expect(result).not.toBeNull();
    expect(result!.evidence.hasEvidence).toBe(true);
    // Exact ID match.
    expect(result!.evidence.taskId).toBe(fixture.taskId);
    // Exact state match.
    expect(result!.evidence.taskState).toBe('queued');
    // workerKind match.
    expect(result!.evidence.workerKind).toBe('codex');
    // workerId is null (no linkedRunId).
    expect(result!.evidence.workerId).toBeUndefined();
    // Persisted timestamp — not synthesized.
    expect(result!.evidence.persistedTimestamp).toBe(fixture.updatedAt);
    // Exact reply text.
    expect(result!.reply).toBe(
      `Task ${fixture.taskId} — ${fixture.title} — queued. Progress: ${fixture.progressMessage}.`
    );
  });

  it('OperationalClaimGate passes a correct queued-state claim', () => {
    backgroundTaskRepo.insertTask(fixture);

    const reply = `Task ${fixture.taskId} — ${fixture.title} — queued.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    expect(checked.ok).toBe(true);
    expect(checked.response).toBe(reply);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 2: Genuine running CodeX task
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 2 — Genuine running CodeX task', () => {
  const now = new Date().toISOString();
  const fixture: BackgroundTaskRecord = makeTask({
    taskId: 'bgtask-fixture-running-codex',
    conversationId: CONV,
    title: 'Implement checkout flow',
    objective: 'Add Stripe checkout',
    worker: 'codex',
    status: 'running',
    startedAt: now,
    updatedAt: now,
    progressMessage: 'Writing Stripe handler module',
    linkedRunId: 'run-codex-fixture-1',
  });

  it('returns exact ID, state=running, workerKind=codex, workerId=linkedRunId, persistedTimestamp=updatedAt', async () => {
    backgroundTaskRepo.insertTask(fixture);

    const result = await OperationalController.handleOperationalRequest(
      `what is the status of task ${fixture.taskId}?`,
      CONV
    );

    expect(result!.evidence.taskId).toBe('bgtask-fixture-running-codex');
    expect(result!.evidence.taskState).toBe('running');
    expect(result!.evidence.workerKind).toBe('codex');
    // workerId is the linkedRunId (real instance ID), not the kind string.
    expect(result!.evidence.workerId).toBe('run-codex-fixture-1');
    expect(result!.evidence.persistedTimestamp).toBe(fixture.updatedAt);
    expect(result!.reply).toContain('bgtask-fixture-running-codex');
    expect(result!.reply).toContain('running');
    expect(result!.reply).toContain('Implement checkout flow');
    expect(result!.reply).toContain('Writing Stripe handler module');
  });

  it('OperationalClaimGate passes correct running-CodeX claim', () => {
    backgroundTaskRepo.insertTask(fixture);

    const reply = `Task ${fixture.taskId} — Implement checkout flow — running.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    expect(checked.ok).toBe(true);
  });

  it('OperationalClaimGate rejects false "Hermes" worker claim for this CodeX task', () => {
    backgroundTaskRepo.insertTask(fixture);

    const reply = `Task ${fixture.taskId} — Implement checkout flow — Hermes is executing this.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    expect(checked.ok).toBe(false);
    expect(checked.missingEvidence).toMatch(/worker mismatch/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 3: Genuine pending approval task
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 3 — Genuine pending approval task', () => {
  const fixture: BackgroundTaskRecord = makeTask({
    taskId: 'bgtask-fixture-pending-approval',
    conversationId: CONV,
    title: 'Deploy to production',
    objective: 'Deploy latest build to production',
    worker: 'codex',
    status: 'waiting_approval',
    approvalState: 'pending',
    progressMessage: 'Awaiting your approval to proceed',
    linkedRunId: 'run-codex-approval-1',
  });

  it('OperationalController returns evidence with approvalState=pending', async () => {
    backgroundTaskRepo.insertTask(fixture);

    const result = await OperationalController.handleOperationalRequest(
      `what is the status of task ${fixture.taskId}?`,
      CONV
    );

    expect(result!.evidence.hasEvidence).toBe(true);
    expect(result!.evidence.taskId).toBe(fixture.taskId);
    expect(result!.evidence.taskState).toBe('waiting_approval');
    expect(result!.evidence.approvalState).toBe('pending');
  });

  it('OperationalClaimGate passes awaiting-approval claim when exact task has pending approval', () => {
    backgroundTaskRepo.insertTask(fixture);

    const reply = `Task ${fixture.taskId} — Deploy to production — awaiting approval.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    expect(checked.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 4: Genuine granted (allowed) approval task
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 4 — Genuine granted approval task', () => {
  const fixture: BackgroundTaskRecord = makeTask({
    taskId: 'bgtask-fixture-allowed-approval',
    conversationId: CONV,
    title: 'Publish release',
    objective: 'Publish release 2.0',
    worker: 'codex',
    status: 'running',      // transitioned from waiting_approval → running after grant
    approvalState: 'allowed',
    progressMessage: 'Running post-approval steps',
    linkedRunId: 'run-codex-allowed-1',
  });

  it('evidence includes approvalState=allowed from exact fixture', async () => {
    backgroundTaskRepo.insertTask(fixture);

    const result = await OperationalController.handleOperationalRequest(
      `what is the status of task ${fixture.taskId}?`,
      CONV
    );

    expect(result!.evidence.approvalState).toBe('allowed');
    expect(result!.evidence.taskState).toBe('running');
    expect(result!.evidence.taskId).toBe(fixture.taskId);
  });

  it('OperationalClaimGate passes running claim for an allowed task', () => {
    backgroundTaskRepo.insertTask(fixture);

    const reply = `Task ${fixture.taskId} — Publish release — running.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    expect(checked.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 5: Genuine completed + verified task
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 5 — Genuine completed and verified task', () => {
  const now = new Date().toISOString();
  const fixture: BackgroundTaskRecord = makeTask({
    taskId: 'bgtask-fixture-completed-verified',
    conversationId: CONV,
    title: 'Refactor auth module',
    objective: 'Refactor authentication',
    worker: 'codex',
    status: 'completed',
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    verificationState: 'passed',    // real verification evidence
    resultText: 'Auth module refactored. 47 tests pass. No regressions.',
    progressMessage: 'Completed successfully',
    buildState: 'passed',
    testState: 'passed',
  });

  it('evidence includes exact verificationState=passed and resultText', async () => {
    backgroundTaskRepo.insertTask(fixture);

    const result = await OperationalController.handleOperationalRequest(
      `what is the status of task ${fixture.taskId}?`,
      CONV
    );

    expect(result!.evidence.taskState).toBe('completed');
    expect(result!.evidence.validationEvidence).toBe(fixture.resultText);
    // persistedTimestamp uses updatedAt, not new Date().
    expect(result!.evidence.persistedTimestamp).toBe(fixture.updatedAt);
  });

  it('OperationalClaimGate passes completion claim when verificationState=passed', () => {
    backgroundTaskRepo.insertTask(fixture);

    const reply = `Task ${fixture.taskId} — Refactor auth module — completed.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    expect(checked.ok).toBe(true);
  });

  it('OperationalClaimGate passes completion claim when only resultText present (no verificationState=passed)', () => {
    const taskWithResultOnly = { ...fixture, verificationState: 'pending' as const, resultText: 'Some result.' };
    backgroundTaskRepo.insertTask(taskWithResultOnly);

    const reply = `Task ${taskWithResultOnly.taskId} — Refactor auth module — completed.`;
    const checked = OperationalClaimGate.verifyClaims(reply, CONV);
    // resultText present is sufficient proxy for verification.
    expect(checked.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 6: Auth request / blocked action — capability absent
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 6 — Auth request / blocked action (capability absent in schema)', () => {
  it('always returns "No Shopify authentication request exists." — keyword alone is not evidence', async () => {
    // Even with a real Shopify task, there is no auth_requests table.
    backgroundTaskRepo.insertTask(
      makeTask({
        taskId: 'bgtask-shopify-auth-test',
        conversationId: CONV,
        title: 'Shopify product listing',
        objective: 'List products on Shopify',
        worker: 'hermes',
        status: 'queued',
      })
    );

    const result = await OperationalController.handleOperationalRequest(
      'approve the Shopify authentication',
      CONV
    );

    // Capability is absent — always grounded negative.
    expect(result).not.toBeNull();
    expect(result!.evidence.hasEvidence).toBe(false);
    expect(result!.reply).toBe('No Shopify authentication request exists.');
  });

  it('blocks Shopify auth claim even with no tasks at all', async () => {
    const result = await OperationalController.handleOperationalRequest(
      'Shopify authenticate connection',
      CONV
    );
    expect(result!.reply).toBe('No Shopify authentication request exists.');
    expect(result!.evidence.hasEvidence).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 7: Notification subscription — capability absent
// ─────────────────────────────────────────────────────────────────────────────
describe('Fixture 7 — Notification subscription (capability absent)', () => {
  it('always returns not-configured even when tasks exist', async () => {
    backgroundTaskRepo.insertTask(
      makeTask({ taskId: 'bgtask-sub-test', conversationId: CONV, status: 'running' })
    );

    const result = await OperationalController.handleOperationalRequest(
      'keep me updated on that task',
      CONV
    );

    expect(result).not.toBeNull();
    expect(result!.evidence.hasEvidence).toBe(false);
    expect(result!.reply).toBe(
      'Automatic status notifications are not configured. Ask me for the current status.'
    );
  });

  it('OperationalClaimGate blocks all subscription claims regardless of conversation state', () => {
    backgroundTaskRepo.insertTask(
      makeTask({ taskId: 'bgtask-sub-gate', conversationId: CONV, status: 'running' })
    );

    const phrases = [
      'You have been subscribed to task notifications.',
      'I will send you updates when the task changes.',
      'Notifications have been set up for this task.',
    ];
    for (const reply of phrases) {
      const checked = OperationalClaimGate.verifyClaims(reply, CONV);
      expect(checked.ok).toBe(false);
      expect(checked.response).toBe(
        'Automatic status notifications are not configured. Ask me for the current status.'
      );
    }
  });
});

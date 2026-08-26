/**
 * Maintenance repair loop — Phase 4C (+ Phase 4 hardening).
 *
 * Orchestrates a bounded auto-repair cycle:
 *
 *   reproduce failure → Hermes plan (with real evidence) → CodeX repair
 *     → ownership check → diff safety → supervisor test gates → verifier
 *       → PASS? → ready_for_approval
 *             └─ FAIL → retry (max 3) → give up → failed
 *
 * Adapters are INJECTED so the loop is unit-testable without a live LLM/CodeX.
 * The live wiring (realAdapters) supplies real Hermes/CodeX/gates adapters.
 *
 * Phase 4 hardening (Defects 1–4):
 *   - the failure is REPRODUCED first and the evidence is handed to Hermes;
 *   - changedFiles is typed evidence (ChangedFile[]) from a before/after repo
 *     snapshot — never prose;
 *   - every changed file must be OWNED or the operation is BLOCKED
 *     (unexpected_changed_file);
 *   - ready_for_approval is guarded by explicit assertions (no silent success).
 *
 * Safety invariants enforced here:
 *  - never more than MAX_REPAIR_ATTEMPTS
 *  - never stage/commit a file the changeSet does not OWN
 *  - never auto-commit — the loop's terminal success state is 'ready_for_approval'
 *  - every attempt records provenance (plan result id, repair result id, files)
 */

import {
  MaintenanceChangeSet,
  ChangedFile,
  canRetry,
  transition,
  unownedFiles,
  changedFilePaths,
  normalizePath,
  MAX_REPAIR_ATTEMPTS,
} from './changeSet.js';
import { saveChangeSet, loadChangeSet, loadPendingChangeSet } from './maintenanceStore.js';
import { formatReproductionEvidence, hasReproducedFailure, type TestGateOutcome, type DiffSafetyResult } from './testGates.js';

/* ── Adapter contracts ─────────────────────────────────────────────────── */

export interface PlanAdapterResult {
  /** Persisted result id of the Hermes plan (provenance link). */
  resultId: string;
  /** The typed/plan text handed to the repair step. */
  plan: string;
  /** Optional repo-relative files the plan proposes to change (becomes owned). */
  files?: string[];
}

export interface RepairAdapterResult {
  /** Persisted result id of the CodeX repair (provenance link). */
  resultId: string;
  /** Typed changed-file evidence produced by the repair (authoritative). */
  filesChanged: ChangedFile[];
}

export type PlanAdapter = (
  evidence: string,
  ctx: { changeSetId: string; attempt: number }
) => Promise<PlanAdapterResult>;

export type RepairAdapter = (
  plan: string,
  ctx: { changeSetId: string; attempt: number }
) => Promise<RepairAdapterResult>;

export type TestAdapter = () => Promise<TestGateOutcome[]>;

export type VerifyAdapter = () => Promise<{ passed: boolean; reason: string }>;

export type DiffSafetyAdapter = () => Promise<DiffSafetyResult>;

/* ── Outcome ───────────────────────────────────────────────────────────── */

export type RepairOutcomeStatus = 'ready_for_approval' | 'failed' | 'blocked';

export interface RepairAttemptRecord {
  attempt: number;
  planResultId?: string;
  repairResultId?: string;
  filesChanged: ChangedFile[];
  testResults: TestGateOutcome[];
  verification?: { passed: boolean; reason: string };
  failureReason?: string;
  decision: 'retry' | 'ready_for_approval' | 'give_up' | 'blocked';
}

export interface RepairOutcome {
  changeSet: MaintenanceChangeSet;
  status: RepairOutcomeStatus;
  attempts: number;
  reason?: string;
  attemptsLog: RepairAttemptRecord[];
}

export interface MaintenanceRepairOptions {
  changeSetId: string;
  repoPath?: string;
  evidence: string;
  plan: PlanAdapter;
  repair: RepairAdapter;
  /** Reproduce the failure BEFORE planning (runs the allowlisted test gates). */
  reproduce?: TestAdapter;
  test: TestAdapter;
  verify?: VerifyAdapter;
  /** Paths that must NOT change (checked against the typed changed-file set). */
  forbiddenFiles?: string[];
  /** Optional diff-safety check run after the repair (ownership + forbidden). */
  diffSafety?: DiffSafetyAdapter;
}

/** Persist the changeSet and return it. */
function persist(cs: MaintenanceChangeSet): MaintenanceChangeSet {
  saveChangeSet(cs);
  return cs;
}

function classifyTestGateFailure(results: TestGateOutcome[]): 'test_failure' | 'infra_failure' | 'pre_existing_failure' | null {
  for (const r of results) {
    if (!r.passed) {
      if (r.classification === 'infra_failure') return 'infra_failure';
      if (r.classification === 'pre_existing_failure') return 'pre_existing_failure';
      return 'test_failure';
    }
  }
  return null;
}

/**
 * ready_for_approval HARD GATE — return a failure reason, or null when the
 * changeSet is genuinely safe to surface for human approval. Every assertion
 * must pass; a silent success is not possible.
 */
function assertReadyForApproval(
  cs: MaintenanceChangeSet,
  filesChanged: ChangedFile[],
  testResults: TestGateOutcome[],
  verification: { passed: boolean; reason: string } | undefined,
  reproductionRan: boolean
): string | null {
  // When a reproduction gate ran, the failure must have been reproduced (or an
  // explicit maintenance condition proven). When no reproduction gate exists
  // (deterministic fixtures), this assertion is skipped.
  if (reproductionRan && (!cs.reproducedFailure || cs.reproducedFailure.length === 0)) return 'no reproduced failure evidence';
  if (!cs.planResultId) return 'no Hermes diagnosis result';
  if (!cs.repairResultId) return 'no CodeX repair result';
  if (!filesChanged || filesChanged.length === 0) return 'no changed-file evidence';
  const unowned = unownedFiles(cs, changedFilePaths(filesChanged));
  if (unowned.length > 0) return `unexpected_changed_file: ${unowned.join(', ')}`;
  if (!testResults || testResults.length === 0) return 'no supervisor-owned test-gate results';
  const failedGate = testResults.find((t) => !t.passed);
  if (failedGate) return `supervisor test gate failed: ${failedGate.gateId} (${failedGate.classification})`;
  if (verification && !verification.passed) return `verifier failed: ${verification.reason}`;
  if (cs.attempts > MAX_REPAIR_ATTEMPTS) return `attempts (${cs.attempts}) exceed MAX_REPAIR_ATTEMPTS`;
  return null;
}

/**
 * Run the bounded repair loop. Returns a repair outcome whose terminal success
 * state is 'ready_for_approval' (never 'committed'). The caller (orchestrator)
 * is responsible for surfacing the approval checkpoint to Jarvis.
 */
export async function runMaintenanceRepair(opts: MaintenanceRepairOptions): Promise<RepairOutcome> {
  let cs = loadChangeSet(opts.changeSetId);
  if (!cs) {
    throw new Error(`MaintenanceChangeSet '${opts.changeSetId}' not found. Create it before running the repair loop.`);
  }
  if (cs.status === 'ready_for_approval' || cs.status === 'approved') {
    throw new Error(`MaintenanceChangeSet '${cs.id}' is already in terminal state '${cs.status}'.`);
  }

  const attemptsLog: RepairAttemptRecord[] = [];
  const maxAttempts = MAX_REPAIR_ATTEMPTS;
  const reproductionRan = Boolean(opts.reproduce);

  // STEP 0 — reproduce the failure FIRST (before any planning/repair). When no
  // failure is reproduced, there is nothing to repair: block truthfully.
  let evidence = opts.evidence;
  let reproducedFailure: TestGateOutcome[] = [];
  if (opts.reproduce) {
    try {
      reproducedFailure = await opts.reproduce();
    } catch (e: any) {
      reproducedFailure = [{ gateId: 'maint-reproduce', command: '', passed: false, classification: 'infra_failure', evidence: `reproduction gate threw: ${e?.message}`, exitCode: null }];
    }
    cs = persist({
      ...cs,
      reproducedFailure: reproducedFailure.map((r) => ({ gateId: r.gateId, passed: r.passed, classification: r.classification, evidence: r.evidence })),
    });
    if (!hasReproducedFailure(reproducedFailure)) {
      const reason = `no_reproducible_failure: ${formatReproductionEvidence(reproducedFailure)}`;
      cs = persist(transition(cs, 'blocked', reason));
      return { changeSet: cs, status: 'blocked', attempts: 0, reason, attemptsLog };
    }
    evidence = formatReproductionEvidence(reproducedFailure);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    cs = persist(transition({ ...cs, attempts: attempt }, 'planning', `attempt ${attempt}/${maxAttempts}`));

    const record: RepairAttemptRecord = { attempt, filesChanged: [], testResults: [], decision: 'retry' };

    // 1. Hermes plan (diagnosis → typed plan), fed the REPRODUCED evidence.
    let plan: PlanAdapterResult;
    try {
      plan = await opts.plan(evidence, { changeSetId: cs.id, attempt });
      record.planResultId = plan.resultId;
      // The plan may propose files to change. Union them into the changeSet's
      // owned set BEFORE the repair runs, so the ownership check can prove the
      // repair only touched files the plan (or the caller) explicitly declared.
      const planFiles = Array.isArray(plan.files) && plan.files.length > 0
        ? [...new Set([...cs.files, ...plan.files.map((f) => f.replace(/\\/g, '/'))])]
        : cs.files;
      cs = persist({ ...cs, files: planFiles, planResultId: plan.resultId });
    } catch (e: any) {
      record.failureReason = `plan step failed: ${e?.message}`;
      record.decision = canRetry(cs) ? 'retry' : 'give_up';
      attemptsLog.push(record);
      if (!canRetry(cs)) break;
      continue;
    }

    // 2. CodeX repair (returns typed ChangedFile[] evidence).
    cs = persist(transition(cs, 'repairing', `attempt ${attempt}: CodeX repair`));
    let repair: RepairAdapterResult;
    try {
      repair = await opts.repair(plan.plan, { changeSetId: cs.id, attempt });
      record.repairResultId = repair.resultId;
      record.filesChanged = repair.filesChanged;
      cs = persist({ ...cs, repairResultId: repair.resultId, filesChanged: repair.filesChanged });
    } catch (e: any) {
      record.failureReason = `repair step failed: ${e?.message}`;
      record.decision = canRetry(cs) ? 'retry' : 'give_up';
      attemptsLog.push(record);
      if (!canRetry(cs)) break;
      continue;
    }

    // 3. Ownership check — never proceed if the repair touched unowned files.
    //    Uses the TYPED changed-file evidence (snapshot diff), not prose.
    const unowned = unownedFiles(cs, changedFilePaths(repair.filesChanged));
    if (unowned.length > 0) {
      record.failureReason = `ownership violation — unexpected_changed_file: ${unowned.join(', ')}`;
      record.decision = 'blocked';
      attemptsLog.push(record);
      cs = persist(transition(cs, 'blocked', record.failureReason));
      return { changeSet: cs, status: 'blocked', attempts: attempt, reason: record.failureReason, attemptsLog };
    }

    // 3b. Forbidden-files check (typed changedFiles — handles untracked paths).
    if (opts.forbiddenFiles && opts.forbiddenFiles.length > 0) {
      const changedPaths = changedFilePaths(repair.filesChanged);
      const normForbidden = opts.forbiddenFiles.map(normalizePath);
      const touched = changedPaths.filter((f) =>
        normForbidden.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : p + '/'))
      );
      if (touched.length > 0) {
        record.failureReason = `forbidden files changed: ${touched.join(', ')}`;
        record.decision = 'blocked';
        attemptsLog.push(record);
        cs = persist(transition(cs, 'blocked', record.failureReason));
        return { changeSet: cs, status: 'blocked', attempts: attempt, reason: record.failureReason, attemptsLog };
      }
    }

    // 4. Diff safety (optional) — forbidden files / expected files.
    if (opts.diffSafety) {
      const diff = await opts.diffSafety();
      if (!diff.passed) {
        record.failureReason = `diff safety failed: ${diff.reason}`;
        record.decision = 'blocked';
        attemptsLog.push(record);
        cs = persist(transition(cs, 'blocked', record.failureReason));
        return { changeSet: cs, status: 'blocked', attempts: attempt, reason: record.failureReason, attemptsLog };
      }
    }

    // 5. Supervisor-owned test gates (run independently of CodeX).
    cs = persist(transition(cs, 'testing', `attempt ${attempt}: test gates`));
    let testResults: TestGateOutcome[];
    try {
      testResults = await opts.test();
    } catch (e: any) {
      testResults = [{ gateId: 'maint-test', command: '', passed: false, classification: 'infra_failure', evidence: `test gate threw: ${e?.message}`, exitCode: null }];
    }
    record.testResults = testResults;
    cs = persist({
      ...cs,
      testResults: testResults.map((t) => ({ gateId: t.gateId, passed: t.passed, classification: t.classification, evidence: t.evidence })),
    });

    const failureClass = classifyTestGateFailure(testResults);

    // 6. Verifier.
    cs = persist(transition(cs, 'verifying', `attempt ${attempt}: verifier`));
    let verification: { passed: boolean; reason: string } | undefined;
    if (opts.verify) {
      verification = await opts.verify();
      record.verification = verification;
      cs = persist({ ...cs, verification });
    }

    const testsPassed = failureClass === null;
    const verificationPassed = !verification || verification.passed;

    if (testsPassed && verificationPassed) {
      // 7. HARD GATE before ready_for_approval.
      const gateFailure = assertReadyForApproval(cs, repair.filesChanged, testResults, verification, reproductionRan);
      if (gateFailure) {
        record.failureReason = `ready_for_approval gate failed: ${gateFailure}`;
        record.decision = 'blocked';
        attemptsLog.push(record);
        cs = persist(transition(cs, 'blocked', record.failureReason));
        return { changeSet: cs, status: 'blocked', attempts: attempt, reason: record.failureReason, attemptsLog };
      }
      record.decision = 'ready_for_approval';
      attemptsLog.push(record);
      cs = persist(transition(cs, 'ready_for_approval', 'repair passed tests and verification; awaiting approval to commit.'));
      return { changeSet: cs, status: 'ready_for_approval', attempts: attempt, reason: cs.reason, attemptsLog };
    }

    // Failure — decide retry vs give-up.
    const retryable = failureClass === 'test_failure' || failureClass === null;
    if (retryable && canRetry(cs)) {
      record.failureReason = `attempt ${attempt} failed (${failureClass}); retrying.`;
      record.decision = 'retry';
      attemptsLog.push(record);
      continue;
    }

    // Non-retryable (infra/pre-existing) or retries exhausted.
    record.failureReason = !retryable
      ? `attempt ${attempt} failed with non-retryable classification '${failureClass}'.`
      : `attempt ${attempt} failed; maximum ${maxAttempts} repair attempts reached.`;
    record.decision = 'give_up';
    attemptsLog.push(record);
    cs = persist(transition(cs, 'failed', record.failureReason));
    return { changeSet: cs, status: 'failed', attempts: attempt, reason: record.failureReason, attemptsLog };
  }

  // Exhausted loop without terminal success.
  cs = persist(transition(cs, 'failed', `maximum ${maxAttempts} repair attempts reached without success.`));
  return { changeSet: cs, status: 'failed', attempts: maxAttempts, reason: cs.reason, attemptsLog };
}

/**
 * Reconstruct the pending maintenance state after restart. Returns the most
 * recent actionable changeSet (or null). Jarvis uses this for "where were we?".
 */
export function getPendingMaintenanceState(): MaintenanceChangeSet | null {
  return loadPendingChangeSet();
}

export { loadPendingChangeSet, loadChangeSet, saveChangeSet } from './maintenanceStore.js';
export { MAX_REPAIR_ATTEMPTS, canRetry, transition, createChangeSet } from './changeSet.js';
export type { MaintenanceChangeSet, ChangeSetStatus, ChangedFile } from './changeSet.js';

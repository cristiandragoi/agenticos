/**
 * Maintenance Supervisor facade — Phase 4 (4C/4E/4G/4H glue) + Phase 4.1
 * + Phase 4 hardening.
 *
 * The single entry point Jarvis uses to run self-maintenance. It wires the
 * Phase 4 primitives together:
 *
 *   gitState (4A) + changeSet (4B) + repairLoop (4C) + testGates (4D)
 *   + maintenanceStore (4G) → a typed approval checkpoint for Jarvis (4E).
 *
 * Phase 4.1: the Hermes-plan / CodeX-repair / test-gates / verifier adapters
 * default to the REAL production adapters (realAdapters.ts) when the caller
 * does not inject deterministic fixtures. The loop contract is identical either
 * way, so it stays unit- and fixture-testable while running real work in
 * production.
 *
 * Phase 4 hardening: the loop now REPRODUCES the failure first (Defect 4),
 * computes typed `ChangedFile[]` evidence from a before/after repo snapshot
 * (Defects 2/3), and enforces ownership + forbidden-file boundaries before it
 * can reach ready_for_approval (Defect 1).
 */

import {
  runMaintenanceRepair,
  type MaintenanceRepairOptions,
  type RepairOutcome,
  type PlanAdapter,
  type RepairAdapter,
  type TestAdapter,
  type VerifyAdapter,
} from './repairLoop.js';
import { createChangeSet, transition, type MaintenanceChangeSet, type ChangeSetStatus, type MaintenanceTestGate } from './changeSet.js';
import { saveChangeSet, loadChangeSet, loadPendingChangeSet, listChangeSets } from './maintenanceStore.js';
import { runTypecheckGate, runFocusedTestsGate, type TestGateOutcome } from './testGates.js';
import { getGitState, stageFile, commitStaged, type StageAuthorization } from './gitState.js';
import {
  makeHermesPlanAdapter,
  makeHermesRepairAdapter,
  makeCodexRepairAdapter,
  makeTestGatesAdapter,
  makeVerifierAdapter,
} from './realAdapters.js';

export interface MaintenanceRequest {
  changeSetId: string;
  /** Human/typed description of the failure being repaired. */
  evidence: string;
  /** Finding this repair addresses (provenance link). */
  originatingFindingId?: string;
  originatingResultId?: string;
  /** Files the repair is allowed to touch (ownership boundary). */
  files: string[];
  /** Optional paths that must NOT change. */
  forbiddenFiles?: string[];
  repoPath?: string;
  conversationId?: string;
  projectId?: string;
  /** Typed, allowlisted gate definitions (reproduction + verification). */
  testGates?: MaintenanceTestGate[];
  /** Legacy: focused vitest suite paths (used when testGates omitted). */
  suites?: string[];
  /** Injected adapters (fixtures). When omitted, the REAL adapters are used. */
  plan?: PlanAdapter;
  repair?: RepairAdapter;
  reproduce?: TestAdapter;
  test?: TestAdapter;
  verify?: VerifyAdapter;
}

export interface ApprovalCheckpoint {
  changeSet: MaintenanceChangeSet;
  finding?: string;
  filesOwned: string[];
  filesChanged: string[];
  testCommands: string[];
  testResults: TestGateOutcome[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  proposedCommit: string;
  status: 'ready_for_approval' | 'failed' | 'blocked';
  reason?: string;
  unrelatedPreserved: boolean;
}

/**
 * Build the REAL production adapters (reproduce → Hermes plan → CodeX repair →
 * test gates → verifier). Exported so the Jarvis bridge can also construct them.
 */
export function buildRealAdapters(opts: {
  repoPath?: string;
  conversationId?: string;
  projectId?: string;
  suites?: string[];
  testGates?: MaintenanceTestGate[];
}): { plan: PlanAdapter; repair: RepairAdapter; reproduce: TestAdapter; test: TestAdapter; verify: VerifyAdapter } {
  return {
    plan: makeHermesPlanAdapter({ projectId: opts.projectId, conversationId: opts.conversationId }),
    repair: makeHermesRepairAdapter({ repoPath: opts.repoPath, conversationId: opts.conversationId }),
    reproduce: makeTestGatesAdapter({ repoPath: opts.repoPath, testGates: opts.testGates, suites: opts.suites }),
    test: makeTestGatesAdapter({ repoPath: opts.repoPath, testGates: opts.testGates, suites: opts.suites }),
    verify: makeVerifierAdapter({ repoPath: opts.repoPath }),
  };
}

/**
 * Create a changeSet and run the bounded repair loop. Returns the loop outcome;
 * on success the changeSet is persisted in 'ready_for_approval' (NEVER committed).
 * When plan/repair/test/verify are omitted, the REAL production adapters run.
 */
export async function diagnoseAndRepair(req: MaintenanceRequest): Promise<RepairOutcome> {
  const cs = createChangeSet({
    id: req.changeSetId,
    originatingFindingId: req.originatingFindingId,
    originatingResultId: req.originatingResultId,
    files: req.files,
    testCommands: [],
    testGates: req.testGates,
  });
  saveChangeSet(cs);

  const repoPath = req.repoPath;

  const real = req.plan && req.repair && req.test
    ? null
    : buildRealAdapters({ repoPath, conversationId: req.conversationId, projectId: req.projectId, suites: req.suites, testGates: req.testGates });

  const opts: MaintenanceRepairOptions = {
    changeSetId: req.changeSetId,
    repoPath,
    evidence: req.evidence,
    plan: req.plan ?? real!.plan,
    repair: req.repair ?? real!.repair,
    reproduce: req.reproduce ?? real!.reproduce,
    test: req.test ?? real!.test,
    verify: req.verify ?? real!.verify,
    forbiddenFiles: req.forbiddenFiles ?? [],
  };

  return runMaintenanceRepair(opts);
}

/** Reconstruct the pending maintenance state (for "where were we?" after restart). */
export function getMaintenanceStatus(changeSetId?: string): MaintenanceChangeSet | null {
  return changeSetId ? loadChangeSet(changeSetId) : loadPendingChangeSet();
}

export function listMaintenanceChangeSets(limit = 50): MaintenanceChangeSet[] {
  return listChangeSets(limit);
}

/**
 * Build the typed approval checkpoint Jarvis relays to the user. The transition
 * to 'approved' (and the separately policy-gated commit) is NOT performed here.
 */
export function buildApprovalCheckpoint(
  changeSetId: string,
  testResults: TestGateOutcome[],
  attempts: number
): ApprovalCheckpoint {
  const cs = loadChangeSet(changeSetId);
  if (!cs) throw new Error(`MaintenanceChangeSet '${changeSetId}' not found.`);
  const risk: ApprovalCheckpoint['risk'] =
    cs.files.some((f) => /(release|server\/data|electron|dist)/.test(f)) ? 'HIGH'
    : cs.files.length > 3 ? 'MEDIUM'
    : 'LOW';
  return {
    changeSet: cs,
    finding: cs.originatingFindingId,
    filesOwned: cs.files,
    filesChanged: (cs.filesChanged ?? []).map((f) => f.path),
    testCommands: cs.testCommands,
    testResults,
    risk,
    proposedCommit: `fix: address ${cs.originatingFindingId || 'maintenance issue'} (${attempts} attempt${attempts === 1 ? '' : 's'})`,
    status: cs.status === 'ready_for_approval' ? 'ready_for_approval' : cs.status === 'failed' ? 'failed' : 'blocked',
    reason: cs.reason,
    unrelatedPreserved: true,
  };
}

/* ── Approval / commit state machine (Phase 4.1) ───────────────────────── */

export interface MaintenanceAuthorization {
  /** Explicit caller authorization — must be true for approval/commit. */
  authorized: boolean;
  reason?: string;
}

/**
 * Transition a changeSet from 'ready_for_approval' to 'approved'. This is the
 * ONLY entry into the commit path and requires explicit authorization — a
 * conversational "okay"/"continue"/"fix it" must never reach here.
 */
export function approveChangeSet(changeSetId: string, auth: MaintenanceAuthorization): MaintenanceChangeSet {
  if (!auth.authorized) {
    throw new Error(`Approval blocked: no explicit authorization for changeSet '${changeSetId}'.`);
  }
  const cs = loadChangeSet(changeSetId);
  if (!cs) throw new Error(`MaintenanceChangeSet '${changeSetId}' not found.`);
  if (cs.status !== 'ready_for_approval') {
    throw new Error(
      `MaintenanceChangeSet '${cs.id}' must be 'ready_for_approval' to approve (currently '${cs.status}').`
    );
  }
  const approved = transition(cs, 'approved', auth.reason ?? 'explicitly approved');
  saveChangeSet(approved);
  return approved;
}

/** Transition a changeSet to 'rejected' (pure state transition, no files touched). */
export function rejectChangeSet(changeSetId: string, reason?: string): MaintenanceChangeSet {
  const cs = loadChangeSet(changeSetId);
  if (!cs) throw new Error(`MaintenanceChangeSet '${changeSetId}' not found.`);
  const rejected = transition(cs, 'rejected', reason ?? 'rejected by user');
  saveChangeSet(rejected);
  return rejected;
}

export interface CommitResult {
  changeSet: MaintenanceChangeSet;
  sha?: string;
  committedFiles: string[];
  status: 'completed' | 'blocked' | 'failed';
  reason?: string;
}

/**
 * Commit an APPROVED changeSet. Enforces every safety precondition before any
 * git write:
 *   1. status must be 'approved' (never commit directly from ready_for_approval)
 *   2. every committed path must be owned by the changeSet
 *   3. the commit uses an explicit pathspec so unrelated staged work is preserved
 * The commit is the terminal operation of the state machine (approved → committing
 * → completed). Nothing auto-approves: `approveChangeSet` must run first.
 */
export async function commitChangeSet(
  changeSetId: string,
  repoPath: string | undefined,
  message: string | undefined,
  auth: MaintenanceAuthorization
): Promise<CommitResult> {
  if (!auth.authorized) {
    return { changeSet: loadChangeSet(changeSetId) ?? ({} as MaintenanceChangeSet), committedFiles: [], status: 'blocked', reason: `commit blocked: no explicit authorization for changeSet '${changeSetId}'.` };
  }
  const cs = loadChangeSet(changeSetId);
  if (!cs) throw new Error(`MaintenanceChangeSet '${changeSetId}' not found.`);
  if (cs.status !== 'approved') {
    return { changeSet: cs, committedFiles: [], status: 'blocked', reason: `commit blocked: changeSet '${cs.id}' is '${cs.status}', not 'approved'.` };
  }

  const stageAuth: StageAuthorization = { authorized: true, ownedPaths: cs.files, reason: auth.reason };

  try {
    // Stage owned files only (ownership proof enforced per path).
    for (const f of cs.files) {
      await stageFile(repoPath, f, stageAuth);
    }
    const committing = transition(cs, 'committing', 'staged owned files; committing');
    saveChangeSet(committing);

    const { sha, committedFiles } = await commitStaged(
      repoPath,
      message || `fix: address ${cs.originatingFindingId || 'maintenance issue'}`,
      cs.files,
      stageAuth
    );

    const done = transition(loadChangeSet(changeSetId)!, 'completed', `committed ${sha}`);
    saveChangeSet(done);
    return { changeSet: done, sha, committedFiles, status: 'completed' };
  } catch (e: any) {
    const failed = transition(loadChangeSet(changeSetId)!, 'failed', `commit failed: ${e?.message}`);
    saveChangeSet(failed);
    return { changeSet: failed, committedFiles: [], status: 'failed', reason: e?.message };
  }
}

export { runTypecheckGate, runFocusedTestsGate };
export type { TestGateOutcome };
export { transition };
export type { ChangeSetStatus };

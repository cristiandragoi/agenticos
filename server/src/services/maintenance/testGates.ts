/**
 * Maintenance test gates — Phase 4D.
 *
 * Thin, typed gate runners for the maintenance loop. Command execution REUSES the
 * existing GateRunner (services/gates) rather than duplicating a command runner;
 * diff-safety checks REUSE the maintenance git capability (gitState.ts).
 *
 * A gate result carries an explicit classification so the repair loop can tell:
 *   - test_failure      → the repair genuinely broke a test (retry the repair)
 *   - infra_failure     → environment/tooling broke (do NOT retry the repair)
 *   - pre_existing_failure → a known baseline failure (do NOT retry the repair)
 */

import { buildGateFromConfig } from '../gates/registry.js';
import type { GateContext, GateResult } from '../gates/types.js';
import { getGitState, type GitRepoState } from './gitState.js';
import type { MaintenanceChangeSet, MaintenanceTestGate } from './changeSet.js';
import { assertAllOwned, assertForbiddenUntouched, unownedFiles } from './changeSet.js';

export type FailureClassification = 'test_failure' | 'infra_failure' | 'pre_existing_failure';

export interface TestGateOutcome {
  gateId: string;
  command: string;
  passed: boolean;
  classification: 'passed' | FailureClassification;
  evidence: string;
  exitCode: number | null;
}

const INFRA_MARKERS = [
  /ENOENT/i,
  /cannot find module/i,
  /command not found/i,
  /npm ERR!/i,
  /EPERM/i,
  /EACCES/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /network/i,
  /certificate/i,
  /spawn .* failed/i,
];

export function classifyFailure(stderrTail: string, stdoutTail: string): FailureClassification {
  const combined = `${stderrTail}\n${stdoutTail}`;
  for (const re of INFRA_MARKERS) {
    if (re.test(combined)) return 'infra_failure';
  }
  return 'test_failure';
}

function toOutcome(r: GateResult, classificationOverride?: FailureClassification): TestGateOutcome {
  const classification: TestGateOutcome['classification'] = r.passed
    ? 'passed'
    : classificationOverride ?? classifyFailure(r.reason || '', (r.evidence || []).join('\n'));
  return {
    gateId: r.gateId,
    command: r.command || '',
    passed: r.passed,
    classification,
    evidence: r.reason || '',
    exitCode: r.exitCode ?? null,
  };
}

async function runCommandGate(
  repoPath: string,
  id: string,
  command: string,
  allowedCommands: string[]
): Promise<TestGateOutcome> {
  const gate = buildGateFromConfig({ type: 'command', id, command });
  const ctx: GateContext = {
    runId: `maint-${id}-${Date.now()}`,
    workspacePath: repoPath,
    allowedCommands,
  };
  const result = await gate.run(ctx);
  return toOutcome(result);
}

/** Gate: TypeScript typecheck. */
export async function runTypecheckGate(repoPath: string): Promise<TestGateOutcome> {
  return runCommandGate(repoPath, 'maint-typecheck', 'npx tsc --noEmit -p server/tsconfig.json', [
    'npx tsc --noEmit -p server/tsconfig.json',
  ]);
}

/** Gate: focused vitest suites. */
export async function runFocusedTestsGate(repoPath: string, suites: string[]): Promise<TestGateOutcome> {
  const command = `npx vitest run --config vitest.server.config.ts ${suites.join(' ')}`;
  return runCommandGate(repoPath, 'maint-focused-tests', command, ['npx vitest run --config vitest.server.config.ts']);
}

/** Gate: server build. */
export async function runBuildGate(repoPath: string): Promise<TestGateOutcome> {
  // Server build runs `tsc && node ../scripts/build-identity.cjs`; run from server/.
  return runCommandGate(repoPath, 'maint-build', 'npm run build', ['npm run build']);
}

/* ── Diff safety checks ────────────────────────────────────────────────── */

export interface DiffSafetyResult {
  passed: boolean;
  unownedFiles: string[];
  missingExpectedFiles: string[];
  forbiddenFilesTouched: string[];
  reason: string;
}

/**
 * Compare the git state before/after a repair and verify:
 *   1. every changed file is OWNED by the changeSet (no pre-existing leakage)
 *   2. every expected file actually changed (repair did what it claimed)
 *   3. no forbidden file changed (release/, server/data, etc.)
 */
export async function runDiffSafetyCheck(
  repoPath: string,
  changeSet: MaintenanceChangeSet,
  beforeState: GitRepoState,
  forbiddenFiles: string[] = []
): Promise<DiffSafetyResult> {
  const afterState = await getGitState(repoPath);
  const changedAfter = [
    ...afterState.modified.map((e) => e.path),
    ...afterState.staged.map((e) => e.path),
    ...afterState.deleted.map((e) => e.path),
    ...afterState.untracked.map((e) => e.path),
  ];
  const beforePaths = new Set([
    ...beforeState.modified.map((e) => e.path),
    ...beforeState.staged.map((e) => e.path),
    ...beforeState.deleted.map((e) => e.path),
    ...beforeState.untracked.map((e) => e.path),
  ]);

  // Files that changed relative to BEFORE state (the repair's delta).
  const repairDelta = changedAfter.filter((p) => !beforePaths.has(p));

  const unowned = unownedFiles(changeSet, repairDelta);
  const expectedPaths = changeSet.expectedChanges.map((e) => e.path.replace(/\\/g, '/'));
  const missingExpected = expectedPaths.filter((p) => !changedAfter.includes(p));

  let forbiddenTouched: string[] = [];
  try {
    assertForbiddenUntouched(forbiddenFiles, repairDelta);
  } catch (e: any) {
    const msg: string = String(e?.message || '');
    const m = msg.match(/Forbidden files changed: (.*)/);
    forbiddenTouched = (m?.[1] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  }

  const passed = unowned.length === 0 && missingExpected.length === 0 && forbiddenTouched.length === 0;
  const reasonParts: string[] = [];
  if (unowned.length) reasonParts.push(`unowned files: ${unowned.join(', ')}`);
  if (missingExpected.length) reasonParts.push(`expected-but-missing: ${missingExpected.join(', ')}`);
  if (forbiddenTouched.length) reasonParts.push(`forbidden touched: ${forbiddenTouched.join(', ')}`);

  return {
    passed,
    unownedFiles: unowned,
    missingExpectedFiles: missingExpected,
    forbiddenFilesTouched: forbiddenTouched,
    reason: passed ? 'diff safety: ok' : reasonParts.join('; '),
  };
}

/** Snapshot the current repo git state (used to compute a repair's delta). */
export async function snapshotRepoState(repoPath: string): Promise<GitRepoState> {
  return getGitState(repoPath);
}

/* ── Typed, allowlisted test gates (Phase 4 hardening, Defect 4) ───────── */

const VITEST_ALLOWED = 'npx vitest run --config vitest.server.config.ts';
const TYPECHECK_ALLOWED = 'npx tsc --noEmit -p server/tsconfig.json';

/** Reject target strings that could smuggle shell/argument injection. */
function validateVitestTarget(target: string): string {
  const t = (target || '').trim();
  if (!t) throw new Error('Maintenance vitest gate requires a non-empty target.');
  if (/[;&|`$><\n\r]/.test(t)) throw new Error(`Invalid vitest target (unsafe characters): ${t}`);
  if (!t.includes('/') || !/\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(t)) {
    throw new Error(`Invalid vitest target (must be a repo-relative test path): ${t}`);
  }
  return t;
}

/** Map a typed gate to its single allowlisted command. */
export function gateToCommand(gate: MaintenanceTestGate): string {
  if (gate.type === 'typecheck') return TYPECHECK_ALLOWED;
  if (gate.type === 'vitest') return `${VITEST_ALLOWED} ${validateVitestTarget(gate.target)}`;
  throw new Error(`Unknown maintenance test gate type: ${(gate as any)?.type}`);
}

/** Run a set of typed, allowlisted maintenance gates. */
export async function runTypedTestGates(repoPath: string, gates: MaintenanceTestGate[]): Promise<TestGateOutcome[]> {
  const out: TestGateOutcome[] = [];
  for (const gate of gates) {
    if (gate.type === 'typecheck') {
      out.push(await runTypecheckGate(repoPath));
    } else if (gate.type === 'vitest') {
      const command = gateToCommand(gate);
      out.push(await runCommandGate(repoPath, `maint-vitest-${validateVitestTarget(gate.target)}`, command, [VITEST_ALLOWED]));
    }
  }
  return out;
}

/** Build a concise human-readable evidence block from gate outcomes. */
export function formatReproductionEvidence(outcomes: TestGateOutcome[]): string {
  if (!outcomes || outcomes.length === 0) return '(no test gates provided)';
  return outcomes
    .map((o) => {
      const status = o.passed ? 'PASSED' : `FAILED (exit ${o.exitCode ?? '?'})`;
      return `Gate ${o.gateId} [${o.command}]: ${status}\n${o.evidence || ''}`;
    })
    .join('\n---\n');
}

/** True when at least one outcome represents a reproduced (test-level) failure. */
export function hasReproducedFailure(outcomes: TestGateOutcome[]): boolean {
  return outcomes.some((o) => !o.passed && o.classification === 'test_failure');
}

// Re-export the ownership assertions for convenience (repair loop uses them).
export { assertAllOwned, assertForbiddenUntouched, unownedFiles };

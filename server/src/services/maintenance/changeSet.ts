/**
 * Maintenance ChangeSet — Phase 4B (+ Phase 4.1 hardening).
 *
 * A ChangeSet is the supervisor's record of which files/hunks belong to a given
 * repair. It exists so the supervisor can PROVE ownership of a change and never
 * accidentally stage pre-existing / unrelated dirty work.
 *
 * Ownership is explicit: a changeSet lists `files[]` (repo-relative paths) it
 * owns. Any write (stage) must be authorized against those paths. If ownership
 * cannot be proven, the supervisor refuses to stage and reports for review.
 *
 * Phase 4 hardening adds:
 *   - typed `ChangedFile` evidence (path + changeType) so `filesChanged` is no
 *     longer a bare string list parsed from prose;
 *   - typed `MaintenanceTestGate` definitions (allowlisted commands only) so the
 *     supervisor can reproduce the failure and independently re-run the gates.
 */

export type ChangeSetStatus =
  | 'investigating'
  | 'planning'
  | 'repairing'
  | 'testing'
  | 'verifying'
  | 'ready_for_approval'
  | 'approved'
  | 'committing'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'rejected';

/** States that mean "still in the active repair loop" (not yet at a gate). */
export const ACTIVE_REPAIR_STATES: ChangeSetStatus[] = [
  'investigating',
  'planning',
  'repairing',
  'testing',
  'verifying',
];

export interface ExpectedChange {
  /** Repository-relative path expected to change. */
  path: string;
  /** Optional reason / expectation for this change. */
  note?: string;
}

/** Typed file-change evidence (never reconstructed from prose). */
export type FileChangeType = 'modified' | 'created' | 'deleted' | 'renamed';

export interface ChangedFile {
  /** Repository-relative path (forward slashes). */
  path: string;
  changeType: FileChangeType;
}

/**
 * A typed, allowlisted maintenance test gate. Only the two known kinds are
 * permitted — no arbitrary shell commands may be supplied by a model.
 */
export type MaintenanceTestGate =
  | { type: 'typecheck' }
  | { type: 'vitest'; target: string };

/** JSON-serializable snapshot of a test-gate outcome (persisted on the changeSet). */
export interface PersistedTestResult {
  gateId: string;
  passed: boolean;
  classification: string;
  evidence: string;
}

export interface PersistedVerification {
  passed: boolean;
  reason: string;
}

export interface MaintenanceChangeSet {
  id: string;
  /** Finding the repair addresses (links into the provenance graph). */
  originatingFindingId?: string;
  /** Analysis/verification result this repair consumes. */
  originatingResultId?: string;
  /** Optional background-task id. */
  taskId?: string;
  /** Files this repair OWNS (repo-relative). Anything outside this is forbidden. */
  files: string[];
  /** Expected outcome changes (can overlap `files`). */
  expectedChanges: ExpectedChange[];
  /** Test commands that gate this repair (legacy string form; prefer testGates). */
  testCommands: string[];
  /** Typed, allowlisted gate definitions (reproduction + verification). */
  testGates?: MaintenanceTestGate[];
  status: ChangeSetStatus;
  /** Bounded repair attempts used so far. */
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Reason for the current status (failure reason / approval note). */
  reason?: string;
  /** Persisted provenance of the LAST repair attempt (Phase 4.1). */
  planResultId?: string;
  repairResultId?: string;
  /** Typed changed-file evidence produced by the repair (authoritative). */
  filesChanged?: ChangedFile[];
  testResults?: PersistedTestResult[];
  verification?: PersistedVerification;
  /** Captured failure-reproduction evidence (command / exit code / output). */
  reproducedFailure?: PersistedTestResult[];
}

export const MAX_REPAIR_ATTEMPTS = 3;

export function createChangeSet(input: {
  id: string;
  originatingFindingId?: string;
  originatingResultId?: string;
  taskId?: string;
  files: string[];
  expectedChanges?: ExpectedChange[];
  testCommands?: string[];
  testGates?: MaintenanceTestGate[];
}): MaintenanceChangeSet {
  const now = new Date().toISOString();
  return {
    id: input.id,
    originatingFindingId: input.originatingFindingId,
    originatingResultId: input.originatingResultId,
    taskId: input.taskId,
    files: [...input.files].map((f) => f.replace(/\\/g, '/')),
    expectedChanges: input.expectedChanges ?? [],
    testCommands: input.testCommands ?? [],
    testGates: input.testGates,
    status: 'investigating',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** True if `candidate` is owned by the changeSet (exact or under a directory). */
export function isOwnedBy(changeset: MaintenanceChangeSet, candidate: string): boolean {
  const c = normalizePath(candidate);
  return changeset.files.some((f) => {
    const nf = normalizePath(f);
    return c === nf || c.startsWith(nf.endsWith('/') ? nf : nf + '/');
  });
}

/**
 * Verify that `actualFiles` (the files a repair actually touched) are all owned
 * by the changeSet. Returns the set of UNOWNED files (empty = all owned).
 */
export function unownedFiles(changeset: MaintenanceChangeSet, actualFiles: string[]): string[] {
  return actualFiles.filter((f) => !isOwnedBy(changeset, f)).map(normalizePath);
}

/** Map typed changed-file evidence back to a plain path list.
 *
 *  Accepts the typed `ChangedFile[]` contract AND the legacy `string[]` shape
 *  (same dual-form tolerance as `parseChangedFiles` in maintenanceStore), so a
 *  repair adapter that reports bare paths can never crash the ownership check
 *  with "Cannot read properties of undefined (reading 'replace')". Entries
 *  without a usable path are dropped instead of poisoning the path list.
 */
export function changedFilePaths(files: ChangedFile[] | Array<ChangedFile | string> | undefined): string[] {
  return (files ?? [])
    .map((f) => (typeof f === 'string' ? f : f?.path))
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map(normalizePath);
}

/**
 * Safety assertion used before staging/commit: if any actual file is not owned,
 * the supervisor must NOT stage it. Throws with the offending paths.
 */
export function assertAllOwned(changeset: MaintenanceChangeSet, actualFiles: string[]): void {
  const unowned = unownedFiles(changeset, actualFiles);
  if (unowned.length > 0) {
    throw new Error(
      `ChangeSet ownership violation: files not owned by changeSet '${changeset.id}': ${unowned.join(', ')}`
    );
  }
}

/**
 * Safety assertion used before commit: no FORBIDDEN file may have changed.
 * `forbidden` is a list of repo-relative paths/globs that must stay untouched.
 */
export function assertForbiddenUntouched(forbidden: string[], actualFiles: string[]): void {
  const norm = forbidden.map(normalizePath);
  const touched = actualFiles.map(normalizePath).filter((f) =>
    norm.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : p + '/'))
  );
  if (touched.length > 0) {
    throw new Error(`Forbidden files changed: ${touched.join(', ')}`);
  }
}

export function canRetry(changeset: MaintenanceChangeSet): boolean {
  return changeset.attempts < MAX_REPAIR_ATTEMPTS;
}

export function transition(
  changeset: MaintenanceChangeSet,
  status: ChangeSetStatus,
  reason?: string
): MaintenanceChangeSet {
  return {
    ...changeset,
    status,
    reason,
    updatedAt: new Date().toISOString(),
  };
}

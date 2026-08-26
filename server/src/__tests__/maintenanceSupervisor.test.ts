/**
 * Phase 4 — Maintenance Supervisor focused tests.
 *
 * Covers: read-only git inspection, unrelated-file preservation, ownership
 * enforcement, ChangeSet ownership, bounded auto-repair (max 3), approval
 * boundary (no auto-commit), restart reconstruction, and "where were we?".
 *
 * DB isolation follows the established project pattern: set
 * AGENT_TEAMS_DB_PATH to a temp file and vi.resetModules() before importing
 * the maintenance modules (which read db/index.js at import).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

/* ── git fixture ──────────────────────────────────────────────────────── */

let gitRepos: string[] = [];
function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-git-'));
  gitRepos.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'committed.txt'), 'initial\n');
  execFileSync('git', ['add', 'committed.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

/* ── DB-isolated maintenance modules ──────────────────────────────────── */

let tmpDir: string;
let mods: any;

async function freshMaintenanceModules() {
  vi.resetModules();
  const gitState = await import('../services/maintenance/gitState.js');
  const changeSet = await import('../services/maintenance/changeSet.js');
  const store = await import('../services/maintenance/maintenanceStore.js');
  const repairLoop = await import('../services/maintenance/repairLoop.js');
  return { gitState, changeSet, store, repairLoop };
}

const okTest = async () => [
  { gateId: 't', command: 'vitest', passed: true, classification: 'passed', evidence: 'ok', exitCode: 0 },
];
const failTest = async () => [
  { gateId: 't', command: 'vitest', passed: false, classification: 'test_failure', evidence: 'assertion failed', exitCode: 1 },
];

describe('Phase 4A — git state capability', () => {
  it('1. read-only git inspection works without mutation', async () => {
    const { gitState } = await freshMaintenanceModules();
    const dir = createTempGitRepo();
    fs.writeFileSync(path.join(dir, 'committed.txt'), 'changed\n');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n');

    const before = await gitState.getGitState(dir);
    expect(before.branch).toBeTruthy();
    expect(before.head).toBeTruthy();
    expect(before.modified.map((e) => e.path)).toContain('committed.txt');
    expect(before.untracked.map((e) => e.path)).toContain('new.txt');
    expect(before.staged).toHaveLength(0);

    // Inspect again — state must be unchanged (read-only, no index mutation).
    const after = await gitState.getGitState(dir);
    expect(after.head).toBe(before.head);
    expect(after.staged).toHaveLength(0);
    expect(after.modified.map((e) => e.path)).toContain('committed.txt');
  });

  it('2. dirty unrelated working-tree files are preserved by inspection', async () => {
    const { gitState } = await freshMaintenanceModules();
    const dir = createTempGitRepo();
    const unrelated = path.join(dir, 'unrelated-dirty.txt');
    fs.writeFileSync(unrelated, 'keep me\n');

    const state = await gitState.getGitState(dir);
    expect(state.untracked.map((e) => e.path)).toContain('unrelated-dirty.txt');

    // Inspection must not stage or remove anything.
    expect(fs.existsSync(unrelated)).toBe(true);
    const state2 = await gitState.getGitState(dir);
    expect(state2.staged).toHaveLength(0);
  });

  it('3. supervisor cannot stage an unrelated file', async () => {
    const { gitState, changeSet } = await freshMaintenanceModules();
    const dir = createTempGitRepo();
    fs.writeFileSync(path.join(dir, 'owned.ts'), 'x\n');
    fs.writeFileSync(path.join(dir, 'unrelated.ts'), 'x\n');

    const cs = changeSet.createChangeSet({ id: 'cs', files: ['owned.ts'] });
    // Attempt to stage an unrelated file against a changeSet that owns only owned.ts.
    await expect(
      gitState.stageFile(dir, 'unrelated.ts', { authorized: true, ownedPaths: cs.files, reason: 'test' })
    ).rejects.toThrow(/not owned/);

    // The unrelated file must remain unstaged.
    const state = await gitState.getGitState(dir);
    expect(state.staged.map((e) => e.path)).not.toContain('unrelated.ts');
  });
});

describe('Phase 4B — ChangeSet ownership', () => {
  it('4. owned ChangeSet files can be identified', async () => {
    const { changeSet } = await freshMaintenanceModules();
    const cs = changeSet.createChangeSet({ id: 'cs', files: ['src/fix.ts', 'src/other/'] });
    expect(changeSet.isOwnedBy(cs, 'src/fix.ts')).toBe(true);
    expect(changeSet.isOwnedBy(cs, 'src/other/nested.ts')).toBe(true);
    expect(changeSet.isOwnedBy(cs, 'src/unowned.ts')).toBe(false);
    expect(changeSet.unownedFiles(cs, ['src/fix.ts', 'src/other/a.ts', 'src/unowned.ts'])).toEqual(['src/unowned.ts']);
  });

  it('12. unexpected changed file blocks commit preparation', async () => {
    const { changeSet } = await freshMaintenanceModules();
    const cs = changeSet.createChangeSet({ id: 'cs', files: ['src/fix.ts'] });
    expect(() => changeSet.assertAllOwned(cs, ['src/fix.ts'])).not.toThrow();
    expect(() => changeSet.assertAllOwned(cs, ['src/fix.ts', 'unexpected.ts'])).toThrow(/not owned/);
    // Forbidden files must also block.
    expect(() => changeSet.assertForbiddenUntouched(['release/'], ['release/win-unpacked/x.js'])).toThrow(/Forbidden/);
  });
});

describe('Phase 4C/E/F — bounded repair loop', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-db-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    mods = await freshMaintenanceModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    for (const d of gitRepos) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
    gitRepos = [];
  });

  function seedChangeSet() {
    const cs = mods.changeSet.createChangeSet({
      id: 'cs-1',
      originatingFindingId: 'finding-2',
      originatingResultId: 'exr-analysis-1',
      files: ['src/fix.ts'],
      testCommands: ['npx vitest run fix'],
    });
    mods.store.saveChangeSet(cs);
    return cs;
  }

  it('5. Hermes repair plan links to originating finding/result', async () => {
    seedChangeSet();
    const seen: any[] = [];
    const outcome = await mods.repairLoop.runMaintenanceRepair({
      changeSetId: 'cs-1',
      evidence: 'test failure',
      plan: async (evidence, ctx) => {
        seen.push(ctx);
        return { resultId: `plan-${ctx.attempt}`, plan: 'apply fix' };
      },
      repair: async () => ({ resultId: 'repair-1', filesChanged: ['src/fix.ts'] }),
      test: okTest,
    });
    expect(outcome.status).toBe('ready_for_approval');
    // The changeSet carries the originating links; the plan ran under its id.
    const cs = mods.store.loadChangeSet('cs-1');
    expect(cs.originatingFindingId).toBe('finding-2');
    expect(cs.originatingResultId).toBe('exr-analysis-1');
    expect(seen[0].changeSetId).toBe('cs-1');
    expect(outcome.attemptsLog[0].planResultId).toBe('plan-1');
  });

  it('6. CodeX repair result links to the repair attempt', async () => {
    seedChangeSet();
    const outcome = await mods.repairLoop.runMaintenanceRepair({
      changeSetId: 'cs-1',
      evidence: 'failure',
      plan: async () => ({ resultId: 'plan-1', plan: 'fix' }),
      repair: async (_plan, ctx) => ({ resultId: `repair-attempt-${ctx.attempt}`, filesChanged: ['src/fix.ts'] }),
      test: okTest,
    });
    expect(outcome.attemptsLog[0].repairResultId).toBe('repair-attempt-1');
    expect(outcome.attemptsLog[0].filesChanged).toContain('src/fix.ts');
  });

  it('7. test failure causes bounded retry', async () => {
    seedChangeSet();
    let calls = 0;
    const outcome = await mods.repairLoop.runMaintenanceRepair({
      changeSetId: 'cs-1',
      evidence: 'failure',
      plan: async () => ({ resultId: 'plan', plan: 'fix' }),
      repair: async () => ({ resultId: 'repair', filesChanged: ['src/fix.ts'] }),
      test: async () => {
        calls++;
        return calls >= 2 ? await okTest() : await failTest();
      },
    });
    // First attempt fails, second succeeds.
    expect(outcome.status).toBe('ready_for_approval');
    expect(outcome.attempts).toBe(2);
    expect(outcome.attemptsLog[0].decision).toBe('retry');
  });

  it('8. retry stops after maximum 3 attempts', async () => {
    seedChangeSet();
    const outcome = await mods.repairLoop.runMaintenanceRepair({
      changeSetId: 'cs-1',
      evidence: 'failure',
      plan: async () => ({ resultId: 'plan', plan: 'fix' }),
      repair: async () => ({ resultId: 'repair', filesChanged: ['src/fix.ts'] }),
      test: failTest, // always fails
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.attempts).toBe(3);
    expect(outcome.attemptsLog).toHaveLength(3);
    expect(mods.changeSet.MAX_REPAIR_ATTEMPTS).toBe(3);
  });

  it('9. successful repair reaches READY_FOR_APPROVAL', async () => {
    seedChangeSet();
    const outcome = await mods.repairLoop.runMaintenanceRepair({
      changeSetId: 'cs-1',
      evidence: 'failure',
      plan: async () => ({ resultId: 'plan', plan: 'fix' }),
      repair: async () => ({ resultId: 'repair', filesChanged: ['src/fix.ts'] }),
      test: okTest,
      verify: async () => ({ passed: true, reason: 'verifier ok' }),
    });
    expect(outcome.status).toBe('ready_for_approval');
    expect(outcome.attempts).toBe(1);
    const cs = mods.store.loadChangeSet('cs-1');
    expect(cs.status).toBe('ready_for_approval');
  });

  it('10. no commit occurs before explicit approval', async () => {
    seedChangeSet();
    const outcome = await mods.repairLoop.runMaintenanceRepair({
      changeSetId: 'cs-1',
      evidence: 'failure',
      plan: async () => ({ resultId: 'plan', plan: 'fix' }),
      repair: async () => ({ resultId: 'repair', filesChanged: ['src/fix.ts'] }),
      test: okTest,
    });
    expect(outcome.status).toBe('ready_for_approval');
    // The loop never emits a 'committed'/'approved' status — commit is a separate
    // policy-gated step that must be triggered by explicit approval.
    expect(outcome.status).not.toBe('approved');
    const cs = mods.store.loadChangeSet('cs-1');
    expect(['ready_for_approval']).toContain(cs.status);
    expect(cs.status).not.toBe('approved');
  });

  it('11. approval rejection leaves repository unchanged (state transition only)', async () => {
    seedChangeSet();
    const cs = mods.store.loadChangeSet('cs-1');
    // Rejection is a pure state transition — no files touched, no commit.
    const rejected = mods.changeSet.transition(cs, 'rejected', 'user declined');
    mods.store.saveChangeSet(rejected);
    const reloaded = mods.store.loadChangeSet('cs-1');
    expect(reloaded.status).toBe('rejected');
    expect(reloaded.reason).toBe('user declined');
  });

  it('13. restart can reconstruct pending maintenance state', async () => {
    seedChangeSet();
    const cs = mods.changeSet.transition(mods.store.loadChangeSet('cs-1'), 'ready_for_approval', 'passed');
    mods.store.saveChangeSet(cs);

    // Simulate restart: reset modules and re-import (fresh db connection).
    vi.resetModules();
    const store = await import('../services/maintenance/maintenanceStore.js');
    const reloaded = store.loadChangeSet('cs-1');
    expect(reloaded).toBeTruthy();
    expect(reloaded.id).toBe('cs-1');
    expect(reloaded.status).toBe('ready_for_approval');
    expect(reloaded.files).toEqual(['src/fix.ts']);
    expect(reloaded.originatingFindingId).toBe('finding-2');
  });

  it('14. "where were we?" reports the correct state', async () => {
    seedChangeSet();
    mods.store.saveChangeSet(mods.changeSet.transition(mods.store.loadChangeSet('cs-1'), 'ready_for_approval', 'passed tests'));

    vi.resetModules();
    const repairLoop = await import('../services/maintenance/repairLoop.js');
    const pending = repairLoop.getPendingMaintenanceState();
    expect(pending).toBeTruthy();
    expect(pending!.status).toBe('ready_for_approval');
    expect(pending!.originatingFindingId).toBe('finding-2');
  });
});

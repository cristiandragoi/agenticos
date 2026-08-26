/**
 * Phase 4.1 — Maintenance Supervisor integration tests.
 *
 * Covers the NEW Phase 4.1 surface on top of the Phase 4 core:
 *   - intent detection (pure)
 *   - approval/commit/reject state machine (approve → commit → completed)
 *   - git commit safety (owned-paths only, unrelated dirty work preserved)
 *   - real-adapter wiring shape (diagnoseAndRepair persists Hermes/CodeX
 *     provenance handles + test/verify evidence on the changeSet)
 *
 * DB isolation follows the established project pattern (AGENT_TEAMS_DB_PATH +
 * vi.resetModules()); git fixtures use a throwaway temp repo.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-int-'));
  gitRepos.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'committed.txt'), 'initial\n');
  execFileSync('git', ['add', 'committed.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

/* ── DB-isolated modules ──────────────────────────────────────────────── */

let tmpDir: string;
async function freshModules(): Promise<any> {
  vi.resetModules();
  const changeSet = await import('../services/maintenance/changeSet.js');
  const store = await import('../services/maintenance/maintenanceStore.js');
  const supervisor = await import('../services/maintenance/maintenanceSupervisor.js');
  const intent = await import('../services/maintenance/maintenanceIntent.js');
  return { changeSet, store, supervisor, intent };
}

const okTest = async () => [{ gateId: 't', command: 'vitest', passed: true, classification: 'passed', evidence: 'ok', exitCode: 0 }];

describe('Phase 4.1 — intent detection (pure)', () => {
  it('classifies the seven required conversation triggers', async () => {
    const intent = await import('../services/maintenance/maintenanceIntent.js');
    expect(intent.detectMaintenanceIntent('Jarvis, check why the tests are failing.')).toBe('start');
    expect(intent.detectMaintenanceIntent('Can you fix it?')).toBe('continue');
    expect(intent.detectMaintenanceIntent('Did the fix work?')).toBe('status');
    expect(intent.detectMaintenanceIntent('What is CodeX doing?')).toBe('status');
    expect(intent.detectMaintenanceIntent('What did Hermes recommend?')).toBe('status');
    expect(intent.detectMaintenanceIntent('Where were we?')).toBe('status');
    expect(intent.detectMaintenanceIntent('Commit it.')).toBe('commit');
  });

  it('does NOT treat "okay"/"continue"/"go ahead"/"fix it" as commit authorization', async () => {
    const intent = await import('../services/maintenance/maintenanceIntent.js');
    // These are continuation/status intents, never 'commit'.
    expect(intent.detectMaintenanceIntent('continue')).toBe('continue');
    expect(intent.detectMaintenanceIntent('go ahead')).toBe('continue');
    expect(intent.detectMaintenanceIntent('fix it')).toBe('continue');
    expect(intent.detectMaintenanceIntent('okay')).toBeNull();
  });

  it('returns null for non-maintenance prompts', async () => {
    const intent = await import('../services/maintenance/maintenanceIntent.js');
    expect(intent.detectMaintenanceIntent('What is the weather?')).toBeNull();
    expect(intent.detectMaintenanceIntent('Explain the second finding')).toBeNull();
  });
});

describe('Phase 4.1 — approval/commit/reject state machine', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-int-db-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    for (const d of gitRepos) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
    gitRepos = [];
    delete process.env.AGENT_TEAMS_DB_PATH;
  });

  it('diagnoseAndRepair persists plan/repair/test/verify provenance on the changeSet', async () => {
    const { supervisor, store } = await freshModules();
    const outcome = await supervisor.diagnoseAndRepair({
      changeSetId: 'cs-prov',
      evidence: 'tests are failing',
      files: [],
      plan: async () => ({ resultId: 'plan-1', plan: 'edit src/calc.js', files: ['src/calc.js'] }),
      repair: async () => ({ resultId: 'repair-1', filesChanged: ['src/calc.js'] }),
      test: okTest,
      verify: async () => ({ passed: true, reason: 'verifier ok' }),
    });

    expect(outcome.status).toBe('ready_for_approval');
    const cs = store.loadChangeSet('cs-prov')!;
    expect(cs.status).toBe('ready_for_approval');
    expect(cs.planResultId).toBe('plan-1');
    expect(cs.repairResultId).toBe('repair-1');
    expect(cs.filesChanged).toEqual(['src/calc.js']);
    expect(cs.files).toContain('src/calc.js'); // plan-union made it owned
    expect(cs.testResults?.[0]?.passed).toBe(true);
    expect(cs.verification?.passed).toBe(true);
  });

  it('approveChangeSet requires ready_for_approval + explicit authorization', async () => {
    const { changeSet, store, supervisor } = await freshModules();
    store.saveChangeSet(changeSet.createChangeSet({ id: 'cs-a', files: ['src/fix.ts'] }));
    // Not authorized → throws.
    expect(() => supervisor.approveChangeSet('cs-a', { authorized: false })).toThrow(/no explicit authorization/);
    // Not in ready_for_approval → throws.
    expect(() => supervisor.approveChangeSet('cs-a', { authorized: true })).toThrow(/ready_for_approval/);
  });

  it('commitChangeSet refuses to commit unless approved', async () => {
    const { changeSet, store, supervisor } = await freshModules();
    const cs = changeSet.transition(changeSet.createChangeSet({ id: 'cs-b', files: ['src/fix.ts'] }), 'ready_for_approval', 'passed');
    store.saveChangeSet(cs);
    const result = await supervisor.commitChangeSet('cs-b', undefined, 'msg', { authorized: true });
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/not 'approved'/);
  });

  it('approve → commit completes with ONLY owned files committed (unrelated preserved)', async () => {
    const dir = createTempGitRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'fix.ts'), 'fixed\n');
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'keep me dirty\n');

    const { changeSet, store, supervisor } = await freshModules();
    const created = changeSet.createChangeSet({ id: 'cs-c', files: ['src/fix.ts'] });
    store.saveChangeSet(changeSet.transition(created, 'ready_for_approval', 'passed tests'));

    supervisor.approveChangeSet('cs-c', { authorized: true, reason: 'explicit approval' });
    expect(store.loadChangeSet('cs-c')!.status).toBe('approved');

    const result = await supervisor.commitChangeSet('cs-c', dir, 'fix: repair', { authorized: true, reason: 'explicit approval' });
    expect(result.status).toBe('completed');
    expect(result.sha).toBeTruthy();
    expect(result.committedFiles).toEqual(['src/fix.ts']);

    // The commit contains ONLY src/fix.ts.
    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    expect(committed.trim().split(/\r?\n/).filter(Boolean)).toEqual(['src/fix.ts']);

    // The unrelated file is still dirty/untracked (preserved).
    const status = execFileSync('git', ['status', '--porcelain=v1'], { cwd: dir, encoding: 'utf8' });
    expect(status).toContain('?? unrelated.txt');
    expect(status).not.toContain('src/fix.ts');

    expect(store.loadChangeSet('cs-c')!.status).toBe('completed');
  });

  it('rejectChangeSet is a pure state transition (no files touched)', async () => {
    const { changeSet, store, supervisor } = await freshModules();
    store.saveChangeSet(changeSet.transition(changeSet.createChangeSet({ id: 'cs-d', files: ['src/fix.ts'] }), 'ready_for_approval', 'passed'));
    supervisor.rejectChangeSet('cs-d', 'declined');
    expect(store.loadChangeSet('cs-d')!.status).toBe('rejected');
  });

  it('commitStaged refuses an empty files list', async () => {
    const dir = createTempGitRepo();
    const gitStateMod = await import('../services/maintenance/gitState.js');
    await expect(
      gitStateMod.commitStaged(dir, 'msg', [], { authorized: true })
    ).rejects.toThrow(/no files provided/);
  });
});

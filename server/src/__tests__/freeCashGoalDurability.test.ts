/**
 * freeCashGoalDurability.test.ts — the DURABLE operational goal + resume rules.
 *
 * The live defects this locks down:
 *   3. "Start working on FreeCash" blocked on authentication was LOST — the
 *      intent lived in memory, so after a restart Jarvis asked again what to do.
 *   4. The September-11 credential blocker was either blindly trusted forever or
 *      blindly cleared; it must be revalidated against CURRENT evidence.
 *   5. A cleared blocker could resume the same goal repeatedly (duplicate work).
 *
 * These use the REAL executor module (no browser is launched: the resume paths
 * exercised here never reach a live probe) against an isolated SQLite DB.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let prereq: any;
let registry: any;
let controller: any;
let execMod: any;
let mgr: any;
let repo: any;
let projectsStore: any;

const PROJECT_ID = 'proj-free-cash';
const MISSING_PROJECT_ID = 'proj-not-a-real-project';

async function freshModules(opts: { withProjects?: boolean } = {}) {
  vi.resetModules();
  prereq = await import('../services/prerequisites/prerequisiteService.js');
  registry = await import('../services/prerequisites/activeGoalRegistry.js');
  controller = await import('../services/projectExecution/projectController.js');
  execMod = await import('../services/freeCash/freeCashExecutor.js');
  mgr = (await import('../services/backgroundTasks/manager.js')).backgroundTaskManager;
  repo = (await import('../services/backgroundTasks/store.js')).backgroundTaskRepo;
  projectsStore = (await import('../services/projectsStore.js')).projectsStore;
  if (opts.withProjects !== false) projectsStore.ensureRevenueProjects();
}

/** A backend restart: same data dir / same SQLite file, brand-new module graph. */
async function simulateRestart() {
  await freshModules();
}

function giveLiveSession(ageMs = 0) {
  prereq.writeSessionEvidence({
    service: 'freecash',
    authenticated: true,
    verifiedAt: new Date(Date.now() - ageMs).toISOString(),
    evidencePath: path.join(tmpDir, 'data', 'freecash', 'evidence', 'session.json'),
  });
}

describe('durable operational goal', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-goal-'));
    process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data');
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    delete process.env.AGENTICOS_DATA_DIR;
    delete process.env.AGENT_TEAMS_DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── 5. Durable goal across restart ──────────────────────────────────────
  it('the original goal survives a backend restart and is never re-asked', async () => {
    await controller.operateProject({
      projectId: PROJECT_ID,
      conversationId: 'conv-42',
      originalGoal: 'Start working on FreeCash',
    });

    const before = registry.getOpenGoalForService('freecash');
    expect(before?.status).toBe('blocked_waiting_for_auth');
    expect(before?.originalGoal).toBe('Start working on FreeCash');
    expect(before?.conversationId).toBe('conv-42');

    await simulateRestart();

    const after = registry.getOpenGoalForService('freecash');
    expect(after).toBeTruthy();
    expect(after!.id).toBe(before!.id);
    expect(after!.status).toBe('blocked_waiting_for_auth');
    expect(after!.originalGoal).toBe('Start working on FreeCash');
    expect(after!.blocker).toMatch(/FreeCash/i);
  });

  it('startup reconciliation leaves the goal blocked while no session is verified', async () => {
    await controller.operateProject({ projectId: PROJECT_ID, originalGoal: 'Start working on FreeCash' });
    await simulateRestart();

    await execMod.reconcileGoalsOnStartup();

    const goals = registry.listGoals({ status: ['resume_pending'] });
    expect(goals).toEqual([]);
    const stillBlocked = registry.getOpenGoalForService('freecash');
    expect(stillBlocked?.status).toBe('blocked_waiting_for_auth');
    expect(stillBlocked?.originalGoal).toBe('Start working on FreeCash');
  });

  // ── 6. Auth clears the blocker → resume exactly once ────────────────────
  it('verified evidence arms resume_pending and the goal resumes exactly once', async () => {
    await controller.operateProject({ projectId: PROJECT_ID, originalGoal: 'Start working on FreeCash' });
    const goal = registry.getOpenGoalForService('freecash')!;

    giveLiveSession();

    const armed = registry.markResumePending('freecash');
    expect(armed?.status).toBe('resume_pending');
    expect(armed?.id).toBe(goal.id);

    const resumedGoalIds: string[] = [];
    const firstCount = await execMod.resumePendingGoals(async (g: any) => {
      resumedGoalIds.push(g.id);
      return 'resumed';
    });
    expect(firstCount).toBe(1);
    expect(resumedGoalIds).toEqual([goal.id]);

    // Resumed ONCE: the goal is no longer pending and a second pump is a no-op.
    const secondCount = await execMod.resumePendingGoals(async (g: any) => {
      resumedGoalIds.push(g.id);
      return 'resumed';
    });
    expect(secondCount).toBe(0);
    expect(resumedGoalIds).toEqual([goal.id]);
    expect(registry.listResumePending()).toEqual([]);
    expect(registry.getOpenGoalForService('freecash')?.status).toBe('active');
  });

  it('a resume without live evidence does nothing at all', async () => {
    await controller.operateProject({ projectId: PROJECT_ID, originalGoal: 'Start working on FreeCash' });
    registry.markResumePending('freecash');
    const calls: string[] = [];
    const count = await execMod.resumePendingGoals(async (g: any) => { calls.push(g.id); return 'x'; });
    expect(count).toBe(0);
    expect(calls).toEqual([]);
  });

  // ── 7. Duplicate prevention ─────────────────────────────────────────────
  it('startup reconciliation runs once per process and cannot double-resume', async () => {
    // A goal pointing at a project that does not exist: the resume path is
    // exercised end-to-end (real operateProject) without dispatching any worker.
    registry.markBlockedWaitingForAuth({
      originalGoal: 'Start working on FreeCash',
      projectId: MISSING_PROJECT_ID,
      service: 'freecash',
      conversationId: 'conv-dup',
      blocker: 'FreeCash needs a signed-in session.',
      nextStep: 'Sign in.',
    });
    giveLiveSession();

    await execMod.reconcileGoalsOnStartup();
    await execMod.reconcileGoalsOnStartup(); // second boot hook must be a no-op

    expect(registry.listResumePending()).toEqual([]);
    // No worker task was created for the phantom project.
    expect(repo.listTasks({ projectId: MISSING_PROJECT_ID }).length).toBe(0);

    // The resume pump is also re-entrancy safe.
    const twice = await Promise.all([
      execMod.resumePendingGoals(async () => 'a'),
      execMod.resumePendingGoals(async () => 'b'),
    ]);
    expect(twice.reduce((a: number, b: number) => a + b, 0)).toBe(0);
  });

  it('never creates a second FreeCash execution task for the same project', async () => {
    // An external execution task is already live (held at the prerequisite).
    const created = mgr.createTask({
      title: 'FreeCash: external execution (verified session)',
      objective: 'verify session then read-only inventory',
      originalRequest: 'Operate FreeCash (external execution)',
      route: 'freecash_execution',
      selectedAgent: 'FreeCash Executor',
      worker: 'revenue',
      priority: 'high',
      projectId: PROJECT_ID,
      metadata: { service: 'freecash', workMode: 'external_execution' },
    });
    mgr.transition(created.task.taskId, 'waiting_for_auth', { blocker: 'no session' });

    const res = await controller.startFreeCashExternalExecution({ projectId: PROJECT_ID });
    expect(res?.alreadyRunning).toBe(true);
    expect(res?.taskId).toBe(created.task.taskId);
    const extTasks = repo.listTasks({ projectId: PROJECT_ID }).filter((t: any) => t.route === 'freecash_execution');
    expect(extTasks.length).toBe(1);

    // The synthetic-active-input path is guarded too.
    const res2 = await controller.startFreeCashExternalExecution({
      projectId: PROJECT_ID,
      existing: [{ ...created.task, route: 'freecash_execution', status: 'queued' }],
    });
    expect(res2?.alreadyRunning).toBe(true);
    expect(repo.listTasks({ projectId: PROJECT_ID }).filter((t: any) => t.route === 'freecash_execution').length).toBe(1);
  });

  // ── 8. Old September-11 blocker revalidation ────────────────────────────
  it('revalidates the September-11 credential blocker against CURRENT evidence', async () => {
    const created = mgr.createTask({
      title: 'External Account Credential Setup',
      objective: 'Configure FreeCash account credentials and connectivity',
      originalRequest: 'Set up the missing FreeCash credentials',
      route: 'project_operate',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      priority: 'high',
      projectId: PROJECT_ID,
      metadata: { provider: 'FreeCash' },
    });
    mgr.transition(created.task.taskId, 'blocked', {
      blocker: 'Missing FreeCash account credentials.',
      resumable: true,
    });

    // (a) No live evidence → the blocker must NOT be blindly cleared.
    const without = await prereq.revalidateCredentialBlockers(PROJECT_ID, 'freecash');
    expect(without.stillBlocked).toBe(true);
    expect(without.resolvedTaskIds).toEqual([]);
    expect(repo.getTask(created.task.taskId)!.status).toBe('blocked');

    // (b) Stale evidence (older than the freshness window) is not evidence.
    giveLiveSession(25 * 60 * 60 * 1000);
    const state = prereq.checkPrerequisites('freecash');
    expect(state.satisfied).toBe(false);
    expect(state.sessionValid).toBe(false);
    expect(state.blocker).toMatch(/stale/i);
    const stale = await prereq.revalidateCredentialBlockers(PROJECT_ID, 'freecash');
    expect(stale.resolvedTaskIds).toEqual([]);
    expect(repo.getTask(created.task.taskId)!.status).toBe('blocked');

    // (c) Fresh live evidence → revalidated and resolved (not blindly trusted:
    //     it took a real, current verification to clear it).
    giveLiveSession();
    const withEvidence = await prereq.revalidateCredentialBlockers(PROJECT_ID, 'freecash');
    expect(withEvidence.stillBlocked).toBe(false);
    expect(withEvidence.resolvedTaskIds).toContain(created.task.taskId);
    expect(repo.getTask(created.task.taskId)!.status).toBe('completed');
  });
});

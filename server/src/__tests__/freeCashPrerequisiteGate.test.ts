/**
 * freeCashPrerequisiteGate.test.ts — the FreeCash execution gate.
 *
 * The live defects this locks down:
 *   1. `operateProject` created AND dispatched a "Revenue Operator: Free Cash
 *      Mission" with no authenticated FreeCash session, and the adapter marked
 *      it RUNNING immediately — so Jarvis said "it is running now" while no
 *      external action had happened and none COULD happen.
 *   2. The expression layer narrated internal planning as if it were live
 *      FreeCash work.
 *
 * The REAL FreeCash executor launches a headless Chromium, and the REAL bounded
 * revenue mission drives the Hermes strategy loop. Neither may run inside a unit
 * test, so both are mocked: what is under test here is the LIFECYCLE (gating,
 * status transitions, and what may be CLAIMED), not the browser internals.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

vi.mock('../services/freeCash/freeCashExecutor.js', () => ({
  FREECASH_SERVICE: 'freecash',
  FREECASH_ACCOUNT_ID: 'freecash-main',
  checkAuthenticatedSession: vi.fn(),
  inspectAvailableWork: vi.fn(),
  startInteractiveLogin: vi.fn(async () => ({ started: true, message: 'mocked login window' })),
  openFreeCash: vi.fn(async () => ({ opened: true, message: 'mocked' })),
  resumePendingGoals: vi.fn(async () => 0),
  reconcileGoalsOnStartup: vi.fn(async () => undefined),
  markResumePending: vi.fn(() => null),
  clearSessionEvidence: vi.fn(),
  writeSessionEvidence: vi.fn(),
  readSessionEvidence: vi.fn(() => null),
  sessionEvidencePath: vi.fn(() => ''),
  freeCashProfilePath: vi.fn(() => ''),
}));

vi.mock('../services/revenueOperator/revenueMissionRunner.js', () => ({
  runBoundedE2EMission: vi.fn(async () => ({
    status: 'success',
    missionId: 'mission-test',
    strategyRunId: 'strategy-test',
    nextAction: 'none',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    steps: [],
  })),
}));

let tmpDir: string;
let prereq: any;
let registry: any;
let controller: any;
let adapterMod: any;
let mgr: any;
let repo: any;
let renderer: any;
let execMod: any;
let projectsStore: any;

const PROJECT_ID = 'proj-free-cash';

async function freshModules() {
  // db/index.ts resolves its path at import — reset the module graph per test.
  vi.resetModules();
  prereq = await import('../services/prerequisites/prerequisiteService.js');
  registry = await import('../services/prerequisites/activeGoalRegistry.js');
  controller = await import('../services/projectExecution/projectController.js');
  adapterMod = await import('../services/backgroundTasks/adapters.js');
  const mgrMod = await import('../services/backgroundTasks/manager.js');
  mgr = mgrMod.backgroundTaskManager;
  repo = (await import('../services/backgroundTasks/store.js')).backgroundTaskRepo;
  renderer = await import('../domains/jarvisNext/resultRenderer.js');
  execMod = await import('../services/freeCash/freeCashExecutor.js');
  projectsStore = (await import('../services/projectsStore.js')).projectsStore;
  projectsStore.ensureRevenueProjects();

  // vi.resetModules() rebuilds the module graph but NOT the mock registry: call
  // history and implementations on the mocked probes survive between tests in
  // this file. Clear them so every test starts from "the live probe was never
  // called", and leave the probes without an implementation — an unintended call
  // then fails loudly instead of silently passing an assertion.
  vi.clearAllMocks();
  vi.mocked(execMod.checkAuthenticatedSession).mockReset();
  vi.mocked(execMod.inspectAvailableWork).mockReset();
}

function projectTasks() {
  return repo.listTasks({ projectId: PROJECT_ID, limit: 100 });
}

function giveLiveSession() {
  prereq.writeSessionEvidence({
    service: 'freecash',
    authenticated: true,
    verifiedAt: new Date().toISOString(),
    evidencePath: path.join(tmpDir, 'data', 'freecash', 'evidence', 'session.json'),
    detail: 'test fixture: live session verified',
  });
}

describe('FreeCash prerequisite gate — projectController', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-gate-'));
    process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data');
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    delete process.env.AGENTICOS_DATA_DIR;
    delete process.env.AGENT_TEAMS_DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── 1. Start FreeCash without valid auth ────────────────────────────────
  it('holds FreeCash at waiting_for_auth: nothing started, nothing claimed', async () => {
    const outcome = await controller.operateProject({
      projectId: PROJECT_ID,
      conversationId: 'conv-1',
      originalGoal: 'Start working on FreeCash',
    });

    // The work is HELD, not executed.
    expect(outcome.workMode).toBe('waiting_for_auth');
    expect(outcome.waitingForAuth).toBe(true);
    expect(outcome.executed).toBe(false);
    expect(outcome.verified).toBe(false);

    // No execution claim of any kind.
    expect(outcome.tasksStarted).toEqual([]);
    expect(outcome.runningCount).toBe(0);
    expect(outcome.stateAfter.running).toBe(0);

    // No external execution / mission task exists at all.
    const tasks = projectTasks();
    expect(tasks.some((t) => t.route === 'freecash_execution')).toBe(false);
    expect(tasks.some((t) => t.route === 'revenue_operator')).toBe(false);

    // The held record is registered but NOT running.
    const held = tasks.filter((t) => t.status === 'waiting_for_auth');
    expect(held.length).toBe(1);
    expect(held[0].startedAt).toBeNull();
    expect(outcome.tasksRegistered).toEqual([held[0].taskId]);

    // The blocker is named and the clearing action is stated.
    expect(outcome.authBlocker).toMatch(/FreeCash/i);
    expect(outcome.authNextStep).toBeTruthy();

    // Speech may not claim a start: no "Started:" claim and no assignment.
    expect(outcome.spokenText).not.toMatch(/Started:/);
    expect(outcome.spokenText).not.toMatch(/assigned .* to the Revenue Operator/i);
    expect(outcome.spokenText).not.toMatch(/running now/i);
    expect(outcome.spokenText).toMatch(/not started|haven't started|has not started|Nothing has started/i);
    expect(outcome.spokenText).toMatch(/sign in|authenticated/i);

    // The real executor was NEVER invoked — no external call happened.
    expect(execMod.checkAuthenticatedSession).not.toHaveBeenCalled();

    // The durable goal exists and carries the user's ORIGINAL words.
    const goal = registry.getOpenGoalForService('freecash');
    expect(goal).toBeTruthy();
    expect(goal.status).toBe('blocked_waiting_for_auth');
    expect(goal.originalGoal).toBe('Start working on FreeCash');
    expect(goal.nextStep).toBeTruthy();
    expect(outcome.goalId).toBe(goal.id);
  });

  it('a second operate while held does not create a duplicate held record', async () => {
    await controller.operateProject({ projectId: PROJECT_ID, originalGoal: 'Start working on FreeCash' });
    const second = await controller.operateProject({ projectId: PROJECT_ID, originalGoal: 'Start working on FreeCash' });
    expect(second.waitingForAuth).toBe(true);
    expect(projectTasks().filter((t) => t.status === 'waiting_for_auth').length).toBe(1);
    // Idempotent per service: the same durable goal row is reused.
    expect(registry.listGoals({ status: ['blocked_waiting_for_auth'] }).length).toBe(1);
  });

  // ── 2. Start FreeCash with valid live session evidence ──────────────────
  it('dispatches real external execution only against a verified session', async () => {
    giveLiveSession();
    vi.mocked(execMod.checkAuthenticatedSession).mockResolvedValue({
      state: 'authenticated',
      observed: ['cookie_count=4', 'session_cookie_present=true'],
      evidencePath: path.join(tmpDir, 'data', 'freecash', 'evidence', 'session-auth.json'),
      inspectedAt: new Date().toISOString(),
    });
    vi.mocked(execMod.inspectAvailableWork).mockResolvedValue({
      state: 'authenticated',
      observed: ['cookie_count=4', 'balance_element_visible=true'],
      evidencePath: path.join(tmpDir, 'data', 'freecash', 'evidence', 'inspect-work.json'),
      inspectedAt: new Date().toISOString(),
      items: ['Offer A', 'Offer B'],
    });

    const outcome = await controller.operateProject({
      projectId: PROJECT_ID,
      originalGoal: 'Start working on FreeCash',
    });

    expect(outcome.workMode).toBe('external_execution');
    expect(outcome.waitingForAuth).toBe(false);

    // The live probe is mandatory before anything runs.
    expect(execMod.checkAuthenticatedSession).toHaveBeenCalled();
    const ext = projectTasks().find((t) => t.route === 'freecash_execution');
    expect(ext).toBeTruthy();
    // Because the probe returned 'authenticated', the task legitimately reached
    // running (startedAt is only set by the running transition) and was verified.
    expect(ext!.startedAt).toBeTruthy();
    expect(ext!.verificationState).toBe('passed');
    expect((ext!.metadata as any).evidencePath).toContain('inspect-work.json');

    // Internal planning ran too — and is labelled as internal.
    const ro = projectTasks().find((t) => t.route === 'revenue_operator');
    expect(ro).toBeTruthy();
    expect((ro!.metadata as any).workMode).toBe('internal_planning');
  });

  it('refuses to run the executor task when the live probe says unauthenticated', async () => {
    // Evidence file exists (so the gate opens), but the LIVE probe disagrees —
    // the probe is the authority and must stop the run.
    giveLiveSession();
    vi.mocked(execMod.checkAuthenticatedSession).mockResolvedValue({
      state: 'unauthenticated',
      observed: ['signin_form_visible=true'],
      evidencePath: null,
      inspectedAt: new Date().toISOString(),
    });

    const created = mgr.createTask({
      title: 'FreeCash: external execution (verified session)',
      objective: 'verify session then read-only inventory',
      originalRequest: 'Operate FreeCash (external execution)',
      route: 'freecash_execution',
      selectedAgent: 'FreeCash Executor',
      worker: 'revenue',
      priority: 'high',
      projectId: PROJECT_ID,
      metadata: { service: 'freecash', workMode: 'external_execution', goalId: null },
    });

    const res = await adapterMod.dispatchFreeCashExecutionTask(created.task);
    expect(res.ok).toBe(false);

    const after = repo.getTask(created.task.taskId)!;
    expect(after.status).toBe('waiting_for_auth');
    // NEVER marked running before real execution: startedAt stays null.
    expect(after.startedAt).toBeNull();
    expect(execMod.inspectAvailableWork).not.toHaveBeenCalled();
    expect(after.blocker).toMatch(/not signed in|unauthenticated/i);
  });
});

describe('FreeCash prerequisite gate — worker adapter labels', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-adapter-'));
    process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data');
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    delete process.env.AGENTICOS_DATA_DIR;
    delete process.env.AGENT_TEAMS_DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function createRoMission() {
    return mgr.createTask({
      title: 'Revenue Operator: Free Cash Mission',
      objective: 'Run bounded DEV revenue mission for Free Cash monetization workflow',
      originalRequest: 'Operate Free Cash',
      route: 'revenue_operator',
      selectedAgent: 'Revenue Operator',
      worker: 'revenue',
      priority: 'high',
      projectId: PROJECT_ID,
      metadata: {
        capabilityId: 'revenue_operator',
        vertical: 'free_cash',
        target: 'Free Cash',
        workMode: 'internal_planning',
        originalGoal: 'Start working on FreeCash',
      },
    });
  }

  // ── 3. Internal Revenue Operator planning mission ───────────────────────
  it('never marks a FreeCash mission running without a verified session', async () => {
    const created = createRoMission();
    const res = await adapterMod.dispatchRevenueOperatorTask(created.task);
    expect(res.ok).toBe(false);
    const after = repo.getTask(created.task.taskId)!;
    expect(after.status).toBe('waiting_for_auth');
    expect(after.startedAt).toBeNull();
    expect(after.blocker).toMatch(/FreeCash/i);
  });

  it('labels internal planning as internal and never as external FreeCash work', async () => {
    giveLiveSession();
    const created = createRoMission();
    const res = await adapterMod.dispatchRevenueOperatorTask(created.task);
    expect(res.ok).toBe(true);

    const after = repo.getTask(created.task.taskId)!;
    expect((after.metadata as any).workMode).toBe('internal_planning');
    // It was prepared/started as internal planning — never via the external path.
    expect(after.route).toBe('revenue_operator');
    expect(execMod.checkAuthenticatedSession).not.toHaveBeenCalled();

    const events = repo.getEvents(created.task.taskId);
    expect(events.some((e: any) => /internal planning/i.test(e.summary))).toBe(true);
    const resultText = after.resultText || '';
    if (resultText) expect(resultText).toMatch(/INTERNAL planning/i);
  });
});

describe('renderer truthfulness', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-render-'));
    process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data');
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    delete process.env.AGENTICOS_DATA_DIR;
    delete process.env.AGENT_TEAMS_DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── 4. Renderer truthfulness ────────────────────────────────────────────
  it('waiting_for_auth is never rendered as running or started', async () => {
    const text = await renderer.renderOperationalResult({
      kind: 'project_operate',
      entityName: 'Free Cash',
      workMode: 'waiting_for_auth',
      authBlocker: 'FreeCash requires an authenticated browser account session before work can start.',
      authNextStep: 'Sign in to FreeCash in the managed browser window; the original goal resumes automatically.',
      originalGoal: 'Start working on FreeCash',
      waitingForAuthTasks: 1,
      runningTasks: 0,
      queuedTasks: 0,
      blockedTasks: 0,
      success: false,
      verified: false,
    });
    expect(text).not.toMatch(/Started:/);
    expect(text).not.toMatch(/assigned .* to the Revenue Operator/i);
    expect(text).not.toMatch(/running now/i);
    expect(text).toMatch(/haven't started anything|has not started|not started/i);
    expect(text).toMatch(/1 item is registered/i);
    expect(text).toMatch(/Sign in to FreeCash/i);
  });

  it('internal_planning is not rendered as external execution', async () => {
    const text = await renderer.renderOperationalResult({
      kind: 'project_operate',
      entityName: 'Free Cash',
      workMode: 'internal_planning',
      worker: 'revenue',
      taskTitle: 'Revenue Operator: Free Cash Mission',
      runningTasks: 1,
      queuedTasks: 0,
      blockedTasks: 0,
      success: true,
      verified: true,
    });
    expect(text).toMatch(/internal planning/i);
    expect(text).toMatch(/not external execution/i);
    expect(text).not.toMatch(/real execution against the account/i);
  });

  it('external_execution names the verified session and the evidence artifact', async () => {
    const text = await renderer.renderOperationalResult({
      kind: 'project_operate',
      entityName: 'Free Cash',
      workMode: 'external_execution',
      worker: 'revenue',
      taskTitle: 'FreeCash: external execution (verified session)',
      runningTasks: 1,
      queuedTasks: 0,
      blockedTasks: 0,
      externalEvidencePath: 'C:/data/freecash/evidence/inspect-work-ab12cd34.json',
      success: true,
      verified: true,
    });
    expect(text).toMatch(/live session is verified/i);
    expect(text).toMatch(/inspect-work-ab12cd34\.json/);
    expect(text).toMatch(/(?:One|1) task is running now/i);
    expect(text).not.toMatch(/internal planning/i);
  });

  it('queued is never rendered as started', async () => {
    const skeleton = renderer.buildSkeleton({
      kind: 'project_operate',
      entityName: 'Free Cash',
      queuedTasks: 2,
      runningTasks: 0,
      blockedTasks: 0,
      success: true,
      verified: true,
    });
    expect(skeleton).toMatch(/queued and have not started yet/i);
    expect(skeleton).not.toMatch(/running now/i);
  });
});

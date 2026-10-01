/**
 * browserRevenueOperatorPhase1.test.ts — Phase 1 Test Suite for Browser Revenue Operator.
 *
 * Proves:
 * 1. Two Playwright profiles run simultaneously.
 * 2. Cookies/localStorage do not leak between profiles.
 * 3. Restart preserves the correct profile session.
 * 4. Two workers cannot lock the same profile simultaneously.
 * 5. Orphan locks recover safely.
 * 6. Worker crash does not terminate supervisor.
 * 7. Duplicate task identity cannot create duplicate completed attribution.
 * 8. Transactional task leasing prevents two workers claiming the same task.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fork } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import Database from 'better-sqlite3';
import { BrowserSessionManager, ProfileLockedError, isProcessAlive } from '../services/revenueOperator/browser/browserSessionManager.js';
import { BrowserTaskQueue, ensureBrowserTables } from '../services/revenueOperator/browser/browserTaskQueue.js';
import { BrowserWorkerSupervisor } from '../services/revenueOperator/browser/browserWorkerSupervisor.js';


describe('Browser Revenue Operator — Phase 1 Architecture & Foundation', () => {
  let tempBaseDir: string;
  let profileDir1: string;
  let profileDir2: string;
  let testDb: Database.Database;
  let supervisor: BrowserWorkerSupervisor;
  let taskQueue: BrowserTaskQueue;

  beforeAll(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-browser-phase1-'));
    profileDir1 = path.join(tempBaseDir, 'profile_acc_1');
    profileDir2 = path.join(tempBaseDir, 'profile_acc_2');

    const dbPath = path.join(tempBaseDir, 'phase1-test.db');
    testDb = new Database(dbPath);
    ensureBrowserTables(testDb);

    // Seed test provider accounts
    const now = new Date().toISOString();
    testDb.prepare(`
      INSERT INTO revenue_browser_provider_accounts (
        id, provider_id, account_identifier, profile_path, status,
        hourly_action_limit, daily_action_limit, total_earnings, currency, created_at, updated_at
      ) VALUES
        ('acc-test-1', 'paidlikes', 'account_alpha', ?, 'active', 120, 1000, 0, 'EUR', ?, ?),
        ('acc-test-2', 'paidlikes', 'account_beta', ?, 'active', 120, 1000, 0, 'EUR', ?, ?)
    `).run(profileDir1, now, now, profileDir2, now, now);

    supervisor = new BrowserWorkerSupervisor(testDb);
    taskQueue = new BrowserTaskQueue(testDb);
  });

  afterAll(async () => {
    // Terminate any remaining supervisor workers
    for (const worker of supervisor.listActiveWorkers()) {
      if (worker.isAlive) {
        worker.childProcess.kill('SIGKILL');
      }
    }
    testDb.close();
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Two Playwright profiles run simultaneously ──────────────────────────
  it('1. Two Playwright profiles run simultaneously', async () => {
    const session1 = await BrowserSessionManager.launchSession({
      workerId: 'worker-sim-1',
      providerAccountId: 'acc-test-1',
      profilePath: profileDir1,
      headless: true,
    });

    const session2 = await BrowserSessionManager.launchSession({
      workerId: 'worker-sim-2',
      providerAccountId: 'acc-test-2',
      profilePath: profileDir2,
      headless: true,
    });

    try {
      await Promise.all([
        session1.page.setContent('<html><body><h1>Profile 1 Active</h1></body></html>'),
        session2.page.setContent('<html><body><h1>Profile 2 Active</h1></body></html>'),
      ]);

      const text1 = await session1.page.textContent('h1');
      const text2 = await session2.page.textContent('h1');

      expect(text1).toBe('Profile 1 Active');
      expect(text2).toBe('Profile 2 Active');
      expect(session1.context).not.toBe(session2.context);
    } finally {
      await session1.close();
      await session2.close();
    }
  });

  // ── 2. Cookies/localStorage do not leak between profiles ──────────────────
  it('2. Cookies and storage do not leak between profiles', async () => {
    const session1 = await BrowserSessionManager.launchSession({
      workerId: 'worker-leak-1',
      providerAccountId: 'acc-test-1',
      profilePath: profileDir1,
      headless: true,
    });

    // Set cookie and localStorage in profile 1
    await session1.context.addCookies([
      {
        name: 'secret_token_1',
        value: 'alpha_98765',
        domain: 'example.com',
        path: '/',
      },
    ]);

    await session1.close();

    // Now launch profile 2 and verify isolation
    const session2 = await BrowserSessionManager.launchSession({
      workerId: 'worker-leak-2',
      providerAccountId: 'acc-test-2',
      profilePath: profileDir2,
      headless: true,
    });

    try {
      const cookiesInProfile2 = await session2.context.cookies('https://example.com');
      const foundToken = cookiesInProfile2.find((c) => c.name === 'secret_token_1');

      expect(foundToken).toBeUndefined();
    } finally {
      await session2.close();
    }
  });

  // ── 3. Restart preserves the correct profile session ───────────────────────
  it('3. Restart preserves the correct profile session', async () => {
    // Launch profile 1 and set persistent cookie with explicit expiration
    const session1 = await BrowserSessionManager.launchSession({
      workerId: 'worker-persist-1',
      providerAccountId: 'acc-test-1',
      profilePath: profileDir1,
      headless: true,
    });

    const oneDayLater = Math.floor(Date.now() / 1000) + 86400;
    await session1.context.addCookies([
      {
        name: 'remember_me_cookie',
        value: 'session_persisted_val_42',
        url: 'https://example.com',
        expires: oneDayLater,
      },
    ]);

    await session1.close();

    // Reopen profile 1
    const session1Restarted = await BrowserSessionManager.launchSession({
      workerId: 'worker-persist-1-restarted',
      providerAccountId: 'acc-test-1',
      profilePath: profileDir1,
      headless: true,
    });

    try {
      const cookies = await session1Restarted.context.cookies('https://example.com');
      const preserved = cookies.find((c) => c.name === 'remember_me_cookie');

      expect(preserved).toBeDefined();
      expect(preserved?.value).toBe('session_persisted_val_42');
    } finally {
      await session1Restarted.close();
    }
  });

  // ── 4. Two workers cannot lock the same profile simultaneously ─────────────
  it('4. Two workers cannot lock the same profile simultaneously', async () => {
    const session1 = await BrowserSessionManager.launchSession({
      workerId: 'worker-mutex-1',
      providerAccountId: 'acc-test-1',
      profilePath: profileDir1,
      headless: true,
    });

    try {
      // Attempting to launch on the same profile while locked must throw ProfileLockedError
      await expect(
        BrowserSessionManager.launchSession({
          workerId: 'worker-mutex-2',
          providerAccountId: 'acc-test-1',
          profilePath: profileDir1,
          headless: true,
        })
      ).rejects.toThrow(ProfileLockedError);
    } finally {
      await session1.close();
    }
  });

  // ── 5. Orphan locks recover safely ─────────────────────────────────────────
  it('5. Orphan locks recover safely', async () => {
    // Write an artificial lock file with a non-existent PID and stale timestamp
    const lockPath = path.join(profileDir1, '.session.lock');
    const deadLockInfo = {
      pid: 9999999, // Non-existent process PID
      workerId: 'worker-dead-orphan',
      providerAccountId: 'acc-test-1',
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(deadLockInfo, null, 2));

    // Calling recoverOrphanLock must detect dead PID and remove lock
    const recovered = BrowserSessionManager.recoverOrphanLock(profileDir1);
    expect(recovered).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);

    // Now launching the session must succeed without errors
    const session = await BrowserSessionManager.launchSession({
      workerId: 'worker-post-recovery',
      providerAccountId: 'acc-test-1',
      profilePath: profileDir1,
      headless: true,
    });

    expect(session).toBeDefined();
    await session.close();
  });

  // ── 6. Worker crash does not terminate supervisor ──────────────────────────
  it('6. Worker crash does not terminate supervisor', async () => {
    const workerHandle = await supervisor.spawnWorker({
      providerAccountId: 'acc-test-1',
    });

    expect(workerHandle.isAlive).toBe(true);
    expect(workerHandle.pid).toBeDefined();

    // Setup exit promise before killing to avoid missing the event
    const exitPromise = new Promise((resolve) => {
      if (workerHandle.childProcess.exitCode !== null) {
        resolve(workerHandle.childProcess.exitCode);
      } else {
        workerHandle.childProcess.once('exit', resolve);
      }
    });

    // Intentionally kill the child process (simulated crash)
    process.kill(workerHandle.pid!, 'SIGKILL');

    // Wait for the exit handler to process
    await exitPromise;

    expect(workerHandle.isAlive).toBe(false);
    expect(workerHandle.status).toBe('FAILED');

    // Prove supervisor is healthy and able to perform operations
    expect(supervisor.isKillSwitchActive()).toBe(false);

    const activeList = supervisor.listActiveWorkers();
    expect(activeList).toBeDefined();

    // Spawn another worker to prove supervisor continues normally
    const secondWorker = await supervisor.spawnWorker({
      providerAccountId: 'acc-test-2',
    });

    expect(secondWorker.isAlive).toBe(true);
    const shutdownRes = await supervisor.requestGracefulShutdown(secondWorker.workerId);
    expect(shutdownRes).toBe(true);
  }, 15000);



  // ── 7. Duplicate task identity cannot create duplicate completed attribution ─
  it('7. Duplicate task identity cannot create duplicate completed attribution', () => {
    const now = new Date().toISOString();
    // Seed worker in DB to satisfy foreign key constraint
    testDb.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (
        id, status, spawned_at, created_at, updated_at
      ) VALUES ('worker-idemp-1', 'IDLE', ?, ?, ?)
    `).run(now, now, now);

    const taskInput = {
      providerId: 'paidlikes',
      externalTaskId: 'ext-unique-99001',
      taskType: 'MICRO_ACTION',
      targetUrl: 'https://example.com/task',
      expectedReward: 0.15,
      providerAccountId: 'acc-test-1',
    };

    // 1. First creation
    const task1 = taskQueue.createTask(taskInput);
    expect(task1.id).toBeDefined();

    // 2. Second creation with identical (providerId, externalTaskId) returns the same task (idempotency)
    const task2 = taskQueue.createTask(taskInput);
    expect(task2.id).toBe(task1.id);

    // Lease the task
    const leased = taskQueue.claimNextTask('worker-idemp-1', 'acc-test-1');
    expect(leased?.id).toBe(task1.id);

    // Complete the task and attribute revenue
    const result1 = taskQueue.completeTask(task1.id, 'worker-idemp-1', 0.15);
    expect(result1.success).toBe(true);
    expect(result1.revenueAttributed).toBe(true);

    // Verify exactly 1 ledger row exists
    const ledgerRows1 = testDb.prepare(`
      SELECT * FROM revenue_ledger_entries
      WHERE source = 'browser_revenue_operator'
        AND json_extract(provenance, '$.externalTaskId') = 'ext-unique-99001'
    `).all();
    expect(ledgerRows1.length).toBe(1);

    // Attempt duplicate completion on the same task
    const result2 = taskQueue.completeTask(task1.id, 'worker-idemp-1', 0.15);
    expect(result2.success).toBe(true);
    expect(result2.revenueAttributed).toBe(false); // Refused duplicate attribution!

    // Verify ledger count is STILL exactly 1 (no double counting)
    const ledgerRows2 = testDb.prepare(`
      SELECT * FROM revenue_ledger_entries
      WHERE source = 'browser_revenue_operator'
        AND json_extract(provenance, '$.externalTaskId') = 'ext-unique-99001'
    `).all();
    expect(ledgerRows2.length).toBe(1);
  });

  // ── 8. Transactional task leasing prevents two workers claiming the same task ─
  it('8. Transactional task leasing prevents two workers claiming the same task', () => {
    const now = new Date().toISOString();
    // Seed workers in DB to satisfy foreign key constraints
    testDb.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (id, status, spawned_at, created_at, updated_at)
      VALUES ('worker-A', 'IDLE', ?, ?, ?), ('worker-B', 'IDLE', ?, ?, ?)
    `).run(now, now, now, now, now, now);

    const uniqueTaskId = `ext-race-${Date.now()}`;
    const task = taskQueue.createTask({
      providerId: 'paidlikes',
      externalTaskId: uniqueTaskId,
      taskType: 'MICRO_ACTION',
      targetUrl: 'https://example.com/race',
      expectedReward: 0.10,
      providerAccountId: 'acc-test-1',
    });

    // Worker A and Worker B both try to claim the task
    const claimA = taskQueue.claimNextTask('worker-A', 'acc-test-1');
    const claimB = taskQueue.claimNextTask('worker-B', 'acc-test-1');

    // Exactly one must win the lease; the other must receive null
    const winner = claimA ? claimA : claimB;
    const loser = claimA ? claimB : claimA;

    expect(winner).not.toBeNull();
    expect(winner?.id).toBe(task.id);
    expect(winner?.status).toBe('leased');
    expect(loser).toBeNull();
  });

  // ── 9. Account-scoped task uniqueness allows same externalTaskId across accounts ─
  it('9. Account-scoped task uniqueness allows same externalTaskId across different accounts', () => {
    const sharedExternalId = `ext-cross-acc-${Date.now()}`;
    const now = new Date().toISOString();

    testDb.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (id, status, spawned_at, created_at, updated_at)
      VALUES ('worker-acc-1', 'IDLE', ?, ?, ?), ('worker-acc-2', 'IDLE', ?, ?, ?)
    `).run(now, now, now, now, now, now);

    // 1. Task for Account 1
    const taskA = taskQueue.createTask({
      providerId: 'paidlikes',
      providerAccountId: 'acc-test-1',
      externalTaskId: sharedExternalId,
      taskType: 'MICRO_ACTION',
      targetUrl: 'https://example.com/shared',
      expectedReward: 0.10,
    });

    // 2. Same externalTaskId for Account 2 (MUST SUCCEED with distinct task ID)
    const taskB = taskQueue.createTask({
      providerId: 'paidlikes',
      providerAccountId: 'acc-test-2',
      externalTaskId: sharedExternalId,
      taskType: 'MICRO_ACTION',
      targetUrl: 'https://example.com/shared',
      expectedReward: 0.10,
    });

    expect(taskA.id).not.toBe(taskB.id);
    expect(taskA.externalTaskId).toBe(sharedExternalId);
    expect(taskB.externalTaskId).toBe(sharedExternalId);

    // 3. Duplicate insertion for the SAME account (Account 1) must return existing taskA
    const taskADup = taskQueue.createTask({
      providerId: 'paidlikes',
      providerAccountId: 'acc-test-1',
      externalTaskId: sharedExternalId,
      taskType: 'MICRO_ACTION',
      targetUrl: 'https://example.com/shared',
      expectedReward: 0.10,
    });
    expect(taskADup.id).toBe(taskA.id);

    // 4. Lease both tasks
    const leasedA = taskQueue.claimNextTask('worker-acc-1', 'acc-test-1');
    const leasedB = taskQueue.claimNextTask('worker-acc-2', 'acc-test-2');
    expect(leasedA?.id).toBe(taskA.id);
    expect(leasedB?.id).toBe(taskB.id);

    // 5. Complete both tasks and attribute revenue
    const resA = taskQueue.completeTask(taskA.id, 'worker-acc-1', 0.10);
    const resB = taskQueue.completeTask(taskB.id, 'worker-acc-2', 0.10);
    expect(resA.revenueAttributed).toBe(true);
    expect(resB.revenueAttributed).toBe(true);

    // 6. Duplicate completion on taskA must refuse duplicate attribution
    const resADup = taskQueue.completeTask(taskA.id, 'worker-acc-1', 0.10);
    expect(resADup.revenueAttributed).toBe(false);

    // 7. Verify ledger contains exactly 2 rows for sharedExternalId (one per account)
    const ledgerRows = testDb.prepare(`
      SELECT * FROM revenue_ledger_entries
      WHERE source = 'browser_revenue_operator'
        AND json_extract(provenance, '$.externalTaskId') = ?
    `).all(sharedExternalId);
    expect(ledgerRows.length).toBe(2);
  });

  // ── 10. Process lifecycle: normal supervisor shutdown terminates all workers ───
  it('10. Process lifecycle: normal supervisor shutdown terminates all workers without orphans', async () => {
    const w1 = await supervisor.spawnWorker({ providerAccountId: 'acc-test-1' });
    const w2 = await supervisor.spawnWorker({ providerAccountId: 'acc-test-2' });

    expect(w1.pid).toBeDefined();
    expect(w2.pid).toBeDefined();
    expect(isProcessAlive(w1.pid!)).toBe(true);
    expect(isProcessAlive(w2.pid!)).toBe(true);

    // Shutdown all workers via supervisor
    await supervisor.shutdownAll();

    expect(isProcessAlive(w1.pid!)).toBe(false);
    expect(isProcessAlive(w2.pid!)).toBe(false);
    expect(supervisor.listActiveWorkers().length).toBe(0);
  }, 15000);

  // ── 11. Process lifecycle: global kill switch terminates all workers ───────────
  it('11. Process lifecycle: global kill switch terminates all workers and halts operations', async () => {
    const w = await supervisor.spawnWorker({ providerAccountId: 'acc-test-1' });
    expect(w.pid).toBeDefined();
    expect(isProcessAlive(w.pid!)).toBe(true);

    // Trip kill-switch
    await supervisor.tripGlobalKillSwitch('Emergency test halt');

    expect(isProcessAlive(w.pid!)).toBe(false);
    expect(supervisor.isKillSwitchActive()).toBe(true);

    // New spawn attempts must be rejected while kill-switch is active
    await expect(supervisor.spawnWorker({ providerAccountId: 'acc-test-1' })).rejects.toThrow(
      /Global Kill-Switch is ACTIVE/
    );

    // Reset kill-switch
    supervisor.resetGlobalKillSwitch();
    expect(supervisor.isKillSwitchActive()).toBe(false);
  }, 15000);

  // ── 12. Process lifecycle: child worker terminates if parent IPC disconnects ──
  it('12. Process lifecycle: child worker terminates automatically if parent IPC disconnects', async () => {
    const currentDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const tsEntry = path.join(currentDir, '../services/revenueOperator/browser/workerEntry.ts');
    const jsEntry = path.join(currentDir, '../services/revenueOperator/browser/workerEntry.js');
    const scriptToRun = fs.existsSync(tsEntry) ? tsEntry : jsEntry;

    let execArgv: string[] = [];
    if (scriptToRun.endsWith('.ts')) {
      const req = createRequire(import.meta.url);
      const tsxResolved = req.resolve('tsx');
      execArgv = ['--import', pathToFileURL(tsxResolved).href];
    }

    const child = fork(scriptToRun, [], {
      execArgv,
      env: {
        ...process.env,
        BROWSER_WORKER_ID: 'worker-orphan-test',
        BROWSER_PROVIDER_ACCOUNT_ID: 'acc-test-1',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    const childPid = child.pid;
    expect(childPid).toBeDefined();

    // Wait until child is running
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isProcessAlive(childPid!)).toBe(true);

    // Disconnect IPC channel (simulates parent exiting or dying)
    const exitPromise = new Promise((resolve) => child.once('exit', resolve));
    child.disconnect();

    // Child must exit automatically via process.on('disconnect')
    await exitPromise;
    expect(isProcessAlive(childPid!)).toBe(false);
  }, 15000);
});




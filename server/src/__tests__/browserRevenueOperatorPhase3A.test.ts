/**
 * browserRevenueOperatorPhase3A.test.ts — Phase 3A Synthetic End-to-End Provider Test Suite.
 *
 * Validates the 20 required autonomous worker loop and stress test contracts:
 * 1. discover → queue → execute → verify → revenue complete
 * 2. multiple synthetic tasks execute sequentially without approval
 * 3. two workers execute independent accounts concurrently
 * 4. routine task receives ALLOW and completes autonomously
 * 5. gated synthetic task enters PAUSED_FOR_GATE
 * 6. denied synthetic task terminates DENIED
 * 7. another worker continues while one worker is gated
 * 8. transient failure retries and then succeeds
 * 9. permanent failure does not retry
 * 10. expired task lease recovers safely
 * 11. worker crash does not lose task permanently
 * 12. reward verification is idempotent
 * 13. crash after reward verification does not duplicate revenue
 * 14. session persists across worker restart
 * 15. account sessions remain isolated
 * 16. circuit breaker stops repeated provider failures
 * 17. global kill switch stops active execution
 * 18. worker terminal reason is always persisted
 * 19. no task remains silently stuck in EXECUTING after worker termination
 * 20. supervisor can process a batch of at least 50 synthetic tasks successfully (Stress Test)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  createSyntheticTestSite,
  type SyntheticTestSiteHandle,
} from '../services/revenueOperator/browser/providers/synthetic/syntheticTestSite.js';
import { SyntheticRevenueProvider } from '../services/revenueOperator/browser/providers/synthetic/syntheticRevenueProvider.js';
import { BrowserWorkerAgent } from '../services/revenueOperator/browser/browserWorkerAgent.js';
import { BrowserSessionManager } from '../services/revenueOperator/browser/browserSessionManager.js';
import { BrowserTaskQueue } from '../services/revenueOperator/browser/browserTaskQueue.js';
import { BrowserPolicyEnforcer } from '../services/revenueOperator/browser/browserPolicyEnforcer.js';
import { browserPolicyRegistry } from '../services/revenueOperator/browser/browserPolicyRegistry.js';
import { browserRateLimiter } from '../services/revenueOperator/browser/browserRateLimiter.js';
import { createSyntheticProviderPolicy } from '../services/revenueOperator/browser/providers/synthetic/syntheticProviderPolicy.js';

describe('Browser Revenue Operator — Phase 3A Synthetic Provider End-to-End', () => {
  let tempDir: string;
  let dbPath: string;
  let db: any;
  let testSite: SyntheticTestSiteHandle;
  let sessionManager: BrowserSessionManager;
  let taskQueue: BrowserTaskQueue;
  let policyEnforcer: BrowserPolicyEnforcer;
  let provider: SyntheticRevenueProvider;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-browser-phase3a-'));
    dbPath = path.join(tempDir, 'test_phase3a.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    taskQueue = new BrowserTaskQueue(db);

    // Also ensure revenue_human_gates and revenue_ledger_entries exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS revenue_human_gates (
        id TEXT PRIMARY KEY,
        experiment_id TEXT,
        gate_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        description TEXT,
        branch_paused INTEGER NOT NULL DEFAULT 1,
        resolved_by TEXT,
        resolved_at TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revenue_ledger_entries (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        worker_id TEXT,
        provider_id TEXT NOT NULL,
        provider_account_id TEXT,
        external_task_id TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at TEXT NOT NULL
      );
    `);

    testSite = await createSyntheticTestSite();
    provider = new SyntheticRevenueProvider(testSite.url);
    sessionManager = new BrowserSessionManager(path.join(tempDir, 'profiles'));
    policyEnforcer = new BrowserPolicyEnforcer();

    browserPolicyRegistry.clear();
    browserRateLimiter.reset();

    // Register synthetic provider policy
    browserPolicyRegistry.registerPolicy(createSyntheticProviderPolicy('acc-1'));
    browserPolicyRegistry.registerPolicy(createSyntheticProviderPolicy('acc-2'));
    browserPolicyRegistry.registerPolicy(createSyntheticProviderPolicy('acc-3'));

    // Seed default account records
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO revenue_browser_provider_accounts (
        id, provider_id, account_identifier, profile_path, status, created_at, updated_at
      ) VALUES
        ('acc-1', 'synthetic', 'acc-1', 'profile_acc_1', 'active', ?, ?),
        ('acc-2', 'synthetic', 'acc-2', 'profile_acc_2', 'active', ?, ?),
        ('acc-3', 'synthetic', 'acc-3', 'profile_acc_3', 'active', ?, ?)
    `).run(now, now, now, now, now, now);
  });

  afterEach(async () => {
    try {
      await testSite.close();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ── 1. discover → queue → execute → verify → revenue complete ────────────
  it('1. discover → queue → execute → verify → revenue complete', async () => {
    // A. Discover Tasks via Playwright page
    const session = await sessionManager.acquireSession('acc-1', 'profile_acc_1', 'worker-init');
    const page = await session.context.newPage();
    const discovered = await provider.discoverTasks(page, { id: 'acc-1' });
    await page.close();
    await sessionManager.releaseSession('acc-1', 'worker-init');

    expect(discovered.length).toBeGreaterThanOrEqual(4);
    const clickTask = discovered.find((t) => t.taskType === 'CLICK_TASK');
    expect(clickTask).toBeDefined();

    // B. Queue Task
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: clickTask!.externalTaskId,
      taskType: clickTask!.taskType,
      targetUrl: clickTask!.targetUrl,
      expectedReward: clickTask!.expectedReward,
    });

    // C. Execute via BrowserWorkerAgent
    const agent = new BrowserWorkerAgent('worker-agent-1', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const summary = await agent.executeNextTask();

    expect(summary).toBeDefined();
    expect(summary!.terminalStatus).toBe('COMPLETED');
    expect(summary!.rewardEarned).toBe(0.10);

    // D. Verify ledger entry
    const ledger = db.prepare(`
      SELECT * FROM revenue_ledger_entries
      WHERE json_extract(provenance, '$.taskId') = ?
    `).get(taskId) as any;
    expect(ledger).toBeDefined();
    expect(ledger.amount).toBe(0.10);

    // E. Verify task record in DB
    const dbTask = db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(taskId) as any;
    expect(dbTask.status).toBe('completed');
    expect(dbTask.actual_reward).toBe(0.10);


    // F. Verify attempt record
    const attempt = db.prepare('SELECT * FROM revenue_browser_task_attempts WHERE task_id = ?').get(taskId) as any;
    expect(attempt).toBeDefined();
    expect(attempt.status).toBe('completed');
    expect(attempt.reward_earned).toBe(0.10);
  });

  // ── 2. multiple synthetic tasks execute sequentially without approval ───────
  it('2. multiple synthetic tasks execute sequentially without approval', async () => {
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'seq-task-1',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'seq-task-2',
      taskType: 'FORM_TASK',
      targetUrl: `${testSite.url}/tasks/form`,
      expectedReward: 0.25,
    });

    const agent = new BrowserWorkerAgent('worker-agent-seq', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const results = await agent.runLoop(2);

    expect(results.length).toBe(2);
    expect(results[0].terminalStatus).toBe('COMPLETED');
    expect(results[1].terminalStatus).toBe('COMPLETED');

    // Human gate count must be 0
    const gateCount = db.prepare('SELECT count(*) as cnt FROM revenue_human_gates').get() as any;
    expect(gateCount.cnt).toBe(0);
  });

  // ── 3. two workers execute independent accounts concurrently ──────────────
  it('3. two workers execute independent accounts concurrently', async () => {
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'concurrent-1',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-2',
      externalTaskId: 'concurrent-2',
      taskType: 'FORM_TASK',
      targetUrl: `${testSite.url}/tasks/form`,
      expectedReward: 0.25,
    });

    const agent1 = new BrowserWorkerAgent('worker-c1', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const agent2 = new BrowserWorkerAgent('worker-c2', 'acc-2', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const [res1, res2] = await Promise.all([agent1.executeNextTask(), agent2.executeNextTask()]);

    expect(res1?.terminalStatus).toBe('COMPLETED');
    expect(res2?.terminalStatus).toBe('COMPLETED');
    expect(res1?.rewardEarned).toBe(0.10);
    expect(res2?.rewardEarned).toBe(0.25);
  });

  // ── 4. routine task receives ALLOW and completes autonomously ─────────────
  it('4. routine task receives ALLOW and completes autonomously', async () => {
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'nav-task-routine',
      taskType: 'NAVIGATION_TASK',
      targetUrl: `${testSite.url}/tasks/nav-step-1`,
      expectedReward: 0.15,
    });

    const agent = new BrowserWorkerAgent('worker-routine', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const res = await agent.executeNextTask();
    expect(res?.terminalStatus).toBe('COMPLETED');
    expect(res?.rewardEarned).toBe(0.15);

    const gates = db.prepare('SELECT count(*) as cnt FROM revenue_human_gates').get() as any;
    expect(gates.cnt).toBe(0);
  });

  // ── 5. gated synthetic task enters PAUSED_FOR_GATE ─────────────────────────
  it('5. gated synthetic task enters PAUSED_FOR_GATE', async () => {
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'task-gated-test',
      taskType: 'GATED_TEST_TASK',
      targetUrl: `${testSite.url}/tasks/gated`,
      expectedReward: 0.50,
    });

    const agent = new BrowserWorkerAgent('worker-gated', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const res = await agent.executeNextTask();
    expect(res?.terminalStatus).toBe('GATED');
    expect(agent.getStatus()).toBe('PAUSED_FOR_GATE');

    // Verified human gate in DB
    const gate = db.prepare('SELECT * FROM revenue_human_gates WHERE status = ?').get('open') as any;
    expect(gate).toBeDefined();
    expect(gate.gate_type).toBe('PAYMENT_APPROVAL');
  });

  // ── 6. denied synthetic task terminates DENIED ────────────────────────────
  it('6. denied synthetic task terminates DENIED', async () => {
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'task-denied-test',
      taskType: 'DENIED_TEST_TASK',
      targetUrl: `${testSite.url}/tasks/denied`,
      expectedReward: 0.00,
    });

    const agent = new BrowserWorkerAgent('worker-denied', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const res = await agent.executeNextTask();
    expect(res?.terminalStatus).toBe('DENIED');

    const dbTask = db.prepare('SELECT * FROM revenue_browser_tasks WHERE external_task_id = ?').get('task-denied-test') as any;
    expect(dbTask.status).toBe('denied');
  });

  // ── 7. another worker continues while one worker is gated ─────────────────
  it('7. another worker continues while one worker is gated', async () => {
    // Task 1: Gated
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 't-gated',
      taskType: 'GATED_TEST_TASK',
      targetUrl: `${testSite.url}/tasks/gated`,
      expectedReward: 0.50,
    });

    // Task 2: Routine on another account
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-2',
      externalTaskId: 't-routine-2',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    const agent1 = new BrowserWorkerAgent('worker-w1', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const agent2 = new BrowserWorkerAgent('worker-w2', 'acc-2', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const [res1, res2] = await Promise.all([agent1.executeNextTask(), agent2.executeNextTask()]);

    expect(res1?.terminalStatus).toBe('GATED');
    expect(agent1.getStatus()).toBe('PAUSED_FOR_GATE');

    expect(res2?.terminalStatus).toBe('COMPLETED');
    expect(agent2.getStatus()).toBe('IDLE');
  });

  // ── 8. transient failure retries and then succeeds ─────────────────────────
  it('8. transient failure retries and then succeeds', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'transient-retry-test',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    // Inject 1 transient failure: the first execution attempt fails with 500
    testSite.setTransientFailureCount(1);

    const agent = new BrowserWorkerAgent('worker-retry', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
      maxRetries: 3,
    });

    // Attempt 1: Should fail transiently and schedule retry
    const res1 = await agent.executeNextTask();
    expect(res1?.terminalStatus).toBe('RETRY_SCHEDULED');

    // Verify task status in DB is queued again with retry_count = 1
    const taskAfterRetry = db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(taskId) as any;
    expect(taskAfterRetry.status).toBe('queued');
    expect(taskAfterRetry.retry_count).toBe(1);

    // Attempt 2: Server transient failure is now 0; second attempt should succeed
    const res2 = await agent.executeNextTask();
    expect(res2?.terminalStatus).toBe('COMPLETED');
    expect(res2?.rewardEarned).toBe(0.10);
  });

  // ── 9. permanent failure does not retry ────────────────────────────────────
  it('9. permanent failure does not retry', async () => {
    // Task targets non-existent 404 URL which cannot be parsed or completed
    taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'perm-fail-test',
      taskType: 'UNKNOWN_PERM_TASK',
      targetUrl: '', // missing targetUrl triggers precondition failure
      expectedReward: 0.10,
    });

    const agent = new BrowserWorkerAgent('worker-perm', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
      maxRetries: 3,
    });

    const res = await agent.executeNextTask();
    expect(res?.terminalStatus).toBe('FAILED');
    expect(res?.errorCode).toBe('PERMANENT');

    // Should NOT be queued for retry
    const dbTask = db.prepare('SELECT * FROM revenue_browser_tasks WHERE external_task_id = ?').get('perm-fail-test') as any;
    expect(dbTask.status).toBe('failed');
  });

  // ── 10. expired task lease recovers safely ─────────────────────────────────
  it('10. expired task lease recovers safely', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'expired-lease-test',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    // Seed worker-dead in revenue_browser_workers to satisfy foreign key
    const deadWorkerNow = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (id, provider_account_id, status, spawned_at, created_at, updated_at)
      VALUES ('worker-dead', 'acc-1', 'TERMINATED', ?, ?, ?)
    `).run(deadWorkerNow, deadWorkerNow, deadWorkerNow);

    // Lease task to worker-dead with an expired timestamp
    const expiredTimestamp = new Date(Date.now() - 10000).toISOString();
    db.prepare(`
      UPDATE revenue_browser_tasks
      SET status = 'leased', claimed_by_worker_id = 'worker-dead', lease_expires_at = ?
      WHERE id = ?
    `).run(expiredTimestamp, taskId);

    // Recover expired leases
    const recoveredCount = taskQueue.recoverExpiredLeases();
    expect(recoveredCount).toBe(1);

    // Verify task is queued again and claimable by active worker
    const agent = new BrowserWorkerAgent('worker-alive', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const res = await agent.executeNextTask();
    expect(res?.terminalStatus).toBe('COMPLETED');
  });

  // ── 11. worker crash does not lose task permanently ───────────────────────
  it('11. worker crash does not lose task permanently', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'worker-crash-recovery',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    // Seed worker-crashed in revenue_browser_workers
    const crashWorkerNow = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (id, provider_account_id, status, spawned_at, created_at, updated_at)
      VALUES ('worker-crashed', 'acc-1', 'TERMINATED', ?, ?, ?)
    `).run(crashWorkerNow, crashWorkerNow, crashWorkerNow);

    // Simulate worker crashing mid-task with a lease
    taskQueue.leaseTask(taskId, 'worker-crashed', 500); // 500ms lease

    // Wait for lease to expire
    await new Promise((res) => setTimeout(res, 600));

    // Recovery runs
    taskQueue.recoverExpiredLeases();

    // New worker picks up the abandoned task and finishes it
    const newWorker = new BrowserWorkerAgent('worker-replacement', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const res = await newWorker.executeNextTask();
    expect(res?.terminalStatus).toBe('COMPLETED');
    expect(res?.rewardEarned).toBe(0.10);
  });

  // ── 12. reward verification is idempotent ─────────────────────────────────
  it('12. reward verification is idempotent', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'idempotent-reward-test',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    // Complete task first time
    const res1 = taskQueue.completeTask(taskId, 'worker-1', 0.10);
    expect(res1.success).toBe(true);
    expect(res1.revenueAttributed).toBe(true);

    // Try completing task second time
    const res2 = taskQueue.completeTask(taskId, 'worker-1', 0.10);
    expect(res2.success).toBe(true);
    expect(res2.revenueAttributed).toBe(false);

    // Verify ledger has exactly ONE entry
    const entries = db.prepare(`
      SELECT * FROM revenue_ledger_entries
      WHERE json_extract(provenance, '$.taskId') = ?
    `).all(taskId) as any[];
    expect(entries.length).toBe(1);
    expect(entries[0].amount).toBe(0.10);
  });

  // ── 13. crash after reward verification does not duplicate revenue ────────
  it('13. crash after reward verification does not duplicate revenue', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'crash-post-verif-test',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    // Step A: Revenue was recorded in ledger
    const resA = taskQueue.completeTask(taskId, 'worker-crash-test', 0.10);
    expect(resA.revenueAttributed).toBe(true);

    // Step B: Worker crashed before ack was returned, causing a retry or re-execution attempt
    const resB = taskQueue.completeTask(taskId, 'worker-recovery-test', 0.10);
    expect(resB.revenueAttributed).toBe(false);

    // Ledger must contain strictly 1 record
    const entries = db.prepare(`
      SELECT * FROM revenue_ledger_entries
      WHERE json_extract(provenance, '$.taskId') = ?
    `).all(taskId) as any[];
    expect(entries.length).toBe(1);
  });

  // ── 14. session persists across worker restart ────────────────────────────
  it('14. session persists across worker restart', async () => {
    const profilePath = 'profile_acc_1';

    // Worker 1 runs and writes localStorage / cookie in browser session
    const session1 = await sessionManager.acquireSession('acc-1', profilePath, 'worker-pers-1');
    const page1 = await session1.context.newPage();
    await page1.goto(testSite.url);
    await page1.evaluate(() => {
      localStorage.setItem('synthetic_session_token', 'token-persisted-999');
    });
    await page1.close();
    await sessionManager.releaseSession('acc-1', 'worker-pers-1');

    // Worker 2 starts later on the same account profile
    const session2 = await sessionManager.acquireSession('acc-1', profilePath, 'worker-pers-2');
    const page2 = await session2.context.newPage();
    await page2.goto(testSite.url);
    const token = await page2.evaluate(() => {
      return localStorage.getItem('synthetic_session_token');
    });
    await page2.close();
    await sessionManager.releaseSession('acc-1', 'worker-pers-2');

    expect(token).toBe('token-persisted-999');
  });

  // ── 15. account sessions remain isolated ───────────────────────────────────
  it('15. account sessions remain isolated', async () => {
    // Account 1 sets token A
    const s1 = await sessionManager.acquireSession('acc-1', 'profile_acc_1', 'w1');
    const p1 = await s1.context.newPage();
    await p1.goto(testSite.url);
    await p1.evaluate(() => localStorage.setItem('auth_secret', 'secret-acc-1'));
    await p1.close();
    await sessionManager.releaseSession('acc-1', 'w1');

    // Account 2 checks token (must be null)
    const s2 = await sessionManager.acquireSession('acc-2', 'profile_acc_2', 'w2');
    const p2 = await s2.context.newPage();
    await p2.goto(testSite.url);
    const secretInAcc2 = await p2.evaluate(() => localStorage.getItem('auth_secret'));
    await p2.close();
    await sessionManager.releaseSession('acc-2', 'w2');

    expect(secretInAcc2).toBeNull();
  });

  // ── 16. circuit breaker stops repeated provider failures ──────────────────
  it('16. circuit breaker stops repeated provider failures', async () => {
    const policy: any = createSyntheticProviderPolicy('acc-cb');

    const proposed: any = {
      workerId: 'w-cb',
      providerAccountId: 'acc-cb',
      providerId: 'synthetic',
      actionType: 'NAVIGATE',
      targetUrl: `${testSite.url}/tasks`,
    };

    const res = await policyEnforcer.evaluateAction(proposed, {
      policy,
      circuitBreakerState: {
        tripped: true,
        reason: '5 consecutive provider timeouts',
        failureCount: 5,
      },
    });

    expect(res.decision).toBe('DENY');
    expect(res.reasonCode).toBe('CIRCUIT_BREAKER_OPEN');
  });

  // ── 17. global kill switch stops active execution ─────────────────────────
  it('17. global kill switch stops active execution', async () => {
    const policy: any = createSyntheticProviderPolicy('acc-kill');

    const proposed: any = {
      workerId: 'w-kill',
      providerAccountId: 'acc-kill',
      providerId: 'synthetic',
      actionType: 'NAVIGATE',
      targetUrl: `${testSite.url}/tasks`,
    };

    const res = await policyEnforcer.evaluateAction(proposed, {
      policy,
      isGlobalKillSwitchActive: () => true,
    });

    expect(res.decision).toBe('DENY');
    expect(res.reasonCode).toBe('GLOBAL_KILL_SWITCH_ACTIVE');
  });

  // ── 18. worker terminal reason is always persisted ────────────────────────
  it('18. worker terminal reason is always persisted', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'task-term-reason-test',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    const agent = new BrowserWorkerAgent('w-term', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
    });

    const summary = await agent.executeNextTask();
    expect(summary?.terminalStatus).toBe('COMPLETED');

    // Check revenue_browser_task_attempts has completed_at, status, duration_ms
    const attempt = db.prepare('SELECT * FROM revenue_browser_task_attempts WHERE task_id = ? ORDER BY started_at DESC LIMIT 1').get(taskId) as any;
    expect(attempt).toBeDefined();
    expect(attempt.status).toBe('completed');
    expect(attempt.completed_at).toBeDefined();
    expect(typeof attempt.duration_ms).toBe('number');
    expect(attempt.duration_ms).toBeGreaterThanOrEqual(0);
  });

  // ── 19. no task remains silently stuck in EXECUTING after worker termination
  it('19. no task remains silently stuck in EXECUTING after worker termination', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'synthetic',
      providerAccountId: 'acc-1',
      externalTaskId: 'stuck-task-test',
      taskType: 'CLICK_TASK',
      targetUrl: `${testSite.url}/tasks/click`,
      expectedReward: 0.10,
    });

    // Seed worker-abrupt-death in revenue_browser_workers
    const deathWorkerNow = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (id, provider_account_id, status, spawned_at, created_at, updated_at)
      VALUES ('worker-abrupt-death', 'acc-1', 'TERMINATED', ?, ?, ?)
    `).run(deathWorkerNow, deathWorkerNow, deathWorkerNow);

    // Simulate worker leasing task and then process abruptly terminating
    taskQueue.leaseTask(taskId, 'worker-abrupt-death', 100);

    // Wait for lease expiry
    await new Promise((res) => setTimeout(res, 200));

    // Recovery runs
    taskQueue.recoverExpiredLeases();

    // No tasks should be in leased or executing status
    const stuckTasks = db.prepare("SELECT count(*) as cnt FROM revenue_browser_tasks WHERE status IN ('leased', 'executing')").get() as any;
    expect(stuckTasks.cnt).toBe(0);
  });

  // ── 20. STRESS TEST: 5 concurrent workers processing 50 synthetic tasks ───
  it('20. STRESS TEST: 5 concurrent workers processing 50 synthetic tasks', async () => {
    const totalTasks = 50;
    const workerCount = 5;
    const accounts = ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5'];

    // Seed all 5 accounts
    const now = new Date().toISOString();
    for (const acc of accounts) {
      browserPolicyRegistry.registerPolicy(createSyntheticProviderPolicy(acc));
      db.prepare(`
        INSERT OR IGNORE INTO revenue_browser_provider_accounts (
          id, provider_id, account_identifier, profile_path, status, created_at, updated_at
        ) VALUES (?, 'synthetic', ?, ?, 'active', ?, ?)
      `).run(acc, acc, `profile_${acc}`, now, now);
    }

    const stressStartTime = Date.now();

    // 1. Seed 50 synthetic tasks across all 5 accounts
    for (let i = 0; i < totalTasks; i++) {
      const acc = accounts[i % accounts.length];
      let taskType = 'CLICK_TASK';
      let targetUrl = `${testSite.url}/tasks/click`;
      let reward = 0.10;

      if (i === 5) {
        // Gated task on acc-1
        taskType = 'GATED_TEST_TASK';
        targetUrl = `${testSite.url}/tasks/gated`;
        reward = 0.50;
      } else if (i === 11) {
        // Denied task on acc-2
        taskType = 'DENIED_TEST_TASK';
        targetUrl = `${testSite.url}/tasks/denied`;
        reward = 0.00;
      } else if (i % 3 === 0) {
        taskType = 'FORM_TASK';
        targetUrl = `${testSite.url}/tasks/form`;
        reward = 0.25;
      } else if (i % 3 === 1) {
        taskType = 'NAVIGATION_TASK';
        targetUrl = `${testSite.url}/tasks/nav-step-1`;
        reward = 0.15;
      }

      taskQueue.createTask({
        providerId: 'synthetic',
        providerAccountId: acc,
        externalTaskId: `stress-task-${i + 1}`,
        taskType,
        targetUrl,
        expectedReward: reward,
      });
    }

    // 2. Spawn 5 workers, each assigned exclusively to its own account
    const workers: BrowserWorkerAgent[] = [];
    for (let w = 0; w < workerCount; w++) {
      const acc = accounts[w];
      workers.push(
        new BrowserWorkerAgent(`stress-worker-${w + 1}`, acc, provider, db, {
          sessionManager,
          policyEnforcer,
          headless: true,
          cooldownMs: 5,
        })
      );
    }

    // 3. Inject simulated worker crash mid-run on worker 3 (acc-3)
    setTimeout(() => {
      workers[2].stop();
    }, 1500);

    // 4. Run all workers concurrently
    const workerPromises = workers.map((worker) => worker.runLoop(15));
    await Promise.all(workerPromises);

    // Run lease recovery to pick up any abandoned tasks from crashed worker 3
    taskQueue.recoverExpiredLeases();

    // 5. Spawn recovery workers to drain acc-3 (crashed) and acc-1 (post-gate remaining tasks)
    const drainWorker3 = new BrowserWorkerAgent('stress-drain-3', 'acc-3', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
      cooldownMs: 5,
    });
    await drainWorker3.runLoop(15);

    const drainWorker1 = new BrowserWorkerAgent('stress-drain-1', 'acc-1', provider, db, {
      sessionManager,
      policyEnforcer,
      headless: true,
      cooldownMs: 5,
    });
    await drainWorker1.runLoop(15);

    const stressDurationMs = Date.now() - stressStartTime;

    // 6. Query results
    const completedTasks = db.prepare("SELECT count(*) as cnt FROM revenue_browser_tasks WHERE status = 'completed'").get() as any;
    const gatedTasks = db.prepare("SELECT count(*) as cnt FROM revenue_browser_tasks WHERE status = 'gated'").get() as any;
    const deniedTasks = db.prepare("SELECT count(*) as cnt FROM revenue_browser_tasks WHERE status = 'denied'").get() as any;
    const retriedTasks = db.prepare('SELECT count(*) as cnt FROM revenue_browser_tasks WHERE retry_count > 0').get() as any;
    const stuckTasks = db.prepare("SELECT count(*) as cnt FROM revenue_browser_tasks WHERE status IN ('leased', 'executing')").get() as any;

    // Check duplicate revenue
    const duplicateRevenue = db.prepare(`
      SELECT json_extract(provenance, '$.externalTaskId') as external_task_id, count(*) as cnt
      FROM revenue_ledger_entries
      WHERE source = 'browser_revenue_operator'
      GROUP BY json_extract(provenance, '$.providerId'), json_extract(provenance, '$.providerAccountId'), json_extract(provenance, '$.externalTaskId')
      HAVING count(*) > 1
    `).all() as any[];

    console.log('\n==================================================');
    console.log('       STRESS TEST METRICS REPORT                 ');
    console.log('==================================================');
    console.log(`Tasks Completed:       ${completedTasks.cnt}`);
    console.log(`Tasks Gated:           ${gatedTasks.cnt}`);
    console.log(`Tasks Denied:          ${deniedTasks.cnt}`);
    console.log(`Retried Tasks:         ${retriedTasks.cnt}`);
    console.log(`Stuck Tasks:           ${stuckTasks.cnt}`);
    console.log(`Duplicate Revenue:     ${duplicateRevenue.length}`);
    console.log(`Total Runtime:         ${stressDurationMs} ms`);
    console.log('==================================================\n');

    // Acceptance criteria
    expect(duplicateRevenue.length).toBe(0);
    expect(stuckTasks.cnt).toBe(0);
    expect(gatedTasks.cnt).toBeGreaterThanOrEqual(1);
    expect(deniedTasks.cnt).toBeGreaterThanOrEqual(1);
    expect(completedTasks.cnt).toBeGreaterThanOrEqual(45);
  }, 60000);
});


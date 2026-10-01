/**
 * browserRevenueOperatorPhase2.test.ts — Phase 2 Policy Engine Test Suite.
 *
 * Validates the 20 required policy enforcement contracts:
 * 1. allowed domain + allowed action => ALLOW
 * 2. unknown domain => DENY
 * 3. deceptive hostname such as paidlikes.de.attacker.com => DENY
 * 4. allowed subdomain => ALLOW when configured
 * 5. unknown action type => DENY
 * 6. payment at spendingLimit 0 => DENY
 * 7. payout request => GATE
 * 8. password/security change => GATE
 * 9. CAPTCHA => GATE
 * 10. KYC => GATE
 * 11. legal/TOS acceptance => GATE
 * 12. routine permitted click => ALLOW without gate
 * 13. hourly rate limit exceeded => DENY/COOLDOWN
 * 14. daily limit exceeded => DENY/COOLDOWN
 * 15. same account across two workers shares rate counters correctly
 * 16. different accounts maintain independent counters
 * 17. circuit breaker OPEN => DENY
 * 18. global kill switch => DENY
 * 19. unexpected browser state => policy-defined GATE/DENY
 * 20. gated worker does not block another worker
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  BrowserPolicyEnforcer,
  extractHostname,
  isDomainAllowed,
} from '../services/revenueOperator/browser/browserPolicyEnforcer.js';
import { classifyBrowserAction } from '../services/revenueOperator/browser/browserActionClassifier.js';
import { browserRateLimiter } from '../services/revenueOperator/browser/browserRateLimiter.js';
import {
  browserPolicyRegistry,
  createDefaultPolicy,
} from '../services/revenueOperator/browser/browserPolicyRegistry.js';
import type { ProposedBrowserAction, ProviderAccountPolicy } from '../services/revenueOperator/browser/types.js';

describe('Browser Revenue Operator — Phase 2 Policy Engine', () => {
  let tempDir: string;
  let dbPath: string;
  let db: any;
  let enforcer: BrowserPolicyEnforcer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-browser-phase2-'));
    dbPath = path.join(tempDir, 'test_browser_phase2.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create required tables for human gates, accounts, workers, and traces
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

      CREATE TABLE IF NOT EXISTS revenue_browser_provider_accounts (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        account_identifier TEXT NOT NULL,
        profile_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        circuit_breaker_state TEXT,
        hourly_action_limit INTEGER NOT NULL DEFAULT 120,
        daily_action_limit INTEGER NOT NULL DEFAULT 1000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revenue_browser_workers (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT,
        status TEXT NOT NULL DEFAULT 'IDLE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revenue_browser_traces (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        worker_id TEXT NOT NULL,
        provider_account_id TEXT,
        action_type TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        policy_decision TEXT,
        screenshot_path TEXT,
        execution_duration_ms INTEGER,
        error TEXT,
        created_at TEXT NOT NULL
      );
    `);

    enforcer = new BrowserPolicyEnforcer();
    browserRateLimiter.reset();
    browserPolicyRegistry.clear();
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ── 1. allowed domain + allowed action => ALLOW ───────────────────────────
  it('1. allowed domain + allowed action => ALLOW', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['NAVIGATE', 'CLICK', 'READ_DOM'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://paidlikes.de/dashboard',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('ALLOW');
    expect(result.reasonCode).toBe('POLICY_AUTHORIZED');
    expect(result.targetDomain).toBe('paidlikes.de');
  });

  // ── 2. unknown domain => DENY ─────────────────────────────────────────────
  it('2. unknown domain => DENY', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['NAVIGATE', 'CLICK'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://malicious-site.com/steal',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('DENY');
    expect(result.reasonCode).toBe('UNKNOWN_DOMAIN');
    expect(result.reason).toContain('not in policy allowedDomains');
  });

  // ── 3. deceptive hostname such as paidlikes.de.attacker.com => DENY ───────
  it('3. deceptive hostname such as paidlikes.de.attacker.com => DENY', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['NAVIGATE', 'CLICK'],
    });

    // Substring contains paidlikes.de, but parsed hostname is paidlikes.de.attacker.com
    const deceptiveUrl = 'https://paidlikes.de.attacker.com/login';
    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: deceptiveUrl,
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('DENY');
    expect(result.reasonCode).toBe('UNKNOWN_DOMAIN');
    expect(result.targetDomain).toBe('paidlikes.de.attacker.com');

    // Verify helper unit check directly
    expect(isDomainAllowed('paidlikes.de.attacker.com', 'paidlikes.de')).toBe(false);
    expect(isDomainAllowed('notpaidlikes.de', 'paidlikes.de')).toBe(false);
  });

  // ── 4. allowed subdomain => ALLOW when configured ─────────────────────────
  it('4. allowed subdomain => ALLOW when configured', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: [{ domain: 'paidlikes.de', allowSubdomains: true }],
      allowedActionTypes: ['NAVIGATE', 'CLICK'],
    });

    const subAction: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://api.paidlikes.de/v1/tasks',
    };

    const result = await enforcer.evaluateAction(subAction, { policy, db });
    expect(result.decision).toBe('ALLOW');
    expect(result.targetDomain).toBe('api.paidlikes.de');

    // Deceptive subdomain on another domain still fails
    const deceptiveAction: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://api.paidlikes.de.phishing.org/v1/tasks',
    };
    const decResult = await enforcer.evaluateAction(deceptiveAction, { policy, db });
    expect(decResult.decision).toBe('DENY');
  });

  // ── 5. unknown action type => DENY ────────────────────────────────────────
  it('5. unknown action type => DENY', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['NAVIGATE', 'CLICK'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'EXECUTE_RAW_SCRIPT',
      targetUrl: 'https://paidlikes.de/page',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('DENY');
    expect(result.reasonCode).toBe('UNAUTHORIZED_ACTION_TYPE');
  });

  // ── 6. payment at spendingLimit 0 => DENY ──────────────────────────────────
  it('6. payment at spendingLimit 0 => DENY', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      spendingLimit: 0, // Hard default
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/checkout',
      elementText: 'Pay Now and Subscribe',
      monetaryAmount: 9.99,
      currency: 'EUR',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('DENY');
    expect(result.reasonCode).toContain('SPENDING_LIMIT');
  });

  // ── 7. payout request => GATE ─────────────────────────────────────────────
  it('7. payout request => GATE', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/account/payout',
      elementText: 'Guthaben auszahlen (Request Payout)',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('GATE');
    expect(result.reasonCode).toBe('PAYOUT_APPROVAL_REQUIRED');
    expect(result.actionCategory).toBe('PAYOUT');

    // Confirm dispatched human gate in DB
    const gate = db.prepare('SELECT * FROM revenue_human_gates WHERE status = ?').get('open') as any;
    expect(gate).toBeDefined();
    expect(gate.gate_type).toBe('PAYMENT_APPROVAL');
    expect(gate.description).toContain('payout');
  });

  // ── 8. password/security change => GATE ───────────────────────────────────
  it('8. password/security change => GATE', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['FORM_FILL', 'CLICK'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'FORM_FILL',
      targetUrl: 'https://paidlikes.de/settings',
      elementName: 'change_password_submit',
      elementText: 'Passwort ändern',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('GATE');
    expect(result.reasonCode).toBe('ACCOUNT_SECURITY_APPROVAL_REQUIRED');
    expect(result.actionCategory).toBe('ACCOUNT_SECURITY');
  });

  // ── 9. CAPTCHA => GATE ────────────────────────────────────────────────────
  it('9. CAPTCHA => GATE', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK', 'VERIFY_STATE'],
    });

    // Case A: Flagged in currentState
    const actionA: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
      currentState: { isCaptchaPresent: true },
    };
    const resultA = await enforcer.evaluateAction(actionA, { policy, db });
    expect(resultA.decision).toBe('GATE');
    expect(resultA.reasonCode).toBe('CAPTCHA_SOLVE_GATED');
    expect(resultA.actionCategory).toBe('CAPTCHA');

    // Case B: Flagged by element text
    const actionB: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
      elementText: 'hCaptcha verification checkbox',
    };
    const resultB = await enforcer.evaluateAction(actionB, { policy, db });
    expect(resultB.decision).toBe('GATE');
    expect(resultB.reasonCode).toBe('CAPTCHA_SOLVE_GATED');
  });

  // ── 10. KYC => GATE ───────────────────────────────────────────────────────
  it('10. KYC => GATE', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK', 'FORM_FILL'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/verify',
      elementText: 'Upload Passport for Identity Verification (KYC)',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('GATE');
    expect(result.reasonCode).toBe('KYC_VERIFICATION_GATED');
    expect(result.actionCategory).toBe('KYC');

    const gate = db.prepare('SELECT * FROM revenue_human_gates WHERE gate_type = ?').get('KYC') as any;
    expect(gate).toBeDefined();
  });

  // ── 11. legal/TOS acceptance => GATE ──────────────────────────────────────
  it('11. legal/TOS acceptance => GATE', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/legal',
      elementText: 'Ich akzeptiere die geänderten AGB und Nutzungsbedingungen',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('GATE');
    expect(result.reasonCode).toBe('LEGAL_ACCEPTANCE_GATED');
    expect(result.actionCategory).toBe('LEGAL_ACCEPTANCE');
  });

  // ── 12. routine permitted click => ALLOW without gate ─────────────────────
  it('12. routine permitted click => ALLOW without gate', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK', 'NAVIGATE', 'READ_DOM'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/tasks/view/42',
      elementText: 'View Task Instructions',
      elementRole: 'button',
    };

    const result = await enforcer.evaluateAction(action, { policy, db });
    expect(result.decision).toBe('ALLOW');
    expect(result.reasonCode).toBe('POLICY_AUTHORIZED');

    // No gates should be created in DB
    const gateCount = db.prepare('SELECT count(*) as cnt FROM revenue_human_gates').get() as any;
    expect(gateCount.cnt).toBe(0);

    // State-changing action CLICK was audited
    const trace = db.prepare('SELECT * FROM revenue_browser_traces WHERE action_type = ?').get('CLICK') as any;
    expect(trace).toBeDefined();
    expect(trace.status).toBe('executed');
  });

  // ── 13. hourly rate limit exceeded => DENY/COOLDOWN ───────────────────────
  it('13. hourly rate limit exceeded => DENY/COOLDOWN', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-hourly-test', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      hourlyActionLimit: 3,
    });

    const baseAction: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-hourly-test',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
      elementText: 'Routine Click',
    };

    // Actions 1, 2, 3 should succeed
    for (let i = 0; i < 3; i++) {
      const res = await enforcer.evaluateAction(baseAction, { policy, db });
      expect(res.decision).toBe('ALLOW');
    }

    // Action 4 should be denied due to hourly rate limit
    const res4 = await enforcer.evaluateAction(baseAction, { policy, db });
    expect(res4.decision).toBe('DENY');
    expect(res4.reasonCode).toBe('RATE_LIMIT_HOURLY_EXCEEDED');
    expect(res4.reason).toContain('Hourly action limit reached');
  });

  // ── 14. daily limit exceeded => DENY/COOLDOWN ─────────────────────────────
  it('14. daily limit exceeded => DENY/COOLDOWN', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-daily-test', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      hourlyActionLimit: 100,
      dailyActionLimit: 2,
    });

    const baseAction: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-daily-test',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
      elementText: 'Routine Click',
    };

    const res1 = await enforcer.evaluateAction(baseAction, { policy, db });
    expect(res1.decision).toBe('ALLOW');

    const res2 = await enforcer.evaluateAction(baseAction, { policy, db });
    expect(res2.decision).toBe('ALLOW');

    const res3 = await enforcer.evaluateAction(baseAction, { policy, db });
    expect(res3.decision).toBe('DENY');
    expect(res3.reasonCode).toBe('RATE_LIMIT_DAILY_EXCEEDED');
    expect(res3.reason).toContain('Daily action limit reached');
  });

  // ── 15. same account across two workers shares rate counters correctly ───
  it('15. same account across two workers shares rate counters correctly', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-shared-pool', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      hourlyActionLimit: 4,
    });

    const actionWorker1: ProposedBrowserAction = {
      workerId: 'worker-alpha',
      providerAccountId: 'acc-shared-pool',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task1',
      elementText: 'Click A',
    };

    const actionWorker2: ProposedBrowserAction = {
      workerId: 'worker-beta',
      providerAccountId: 'acc-shared-pool',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task2',
      elementText: 'Click B',
    };

    // Worker 1 executes 2 actions
    expect((await enforcer.evaluateAction(actionWorker1, { policy, db })).decision).toBe('ALLOW');
    expect((await enforcer.evaluateAction(actionWorker1, { policy, db })).decision).toBe('ALLOW');

    // Worker 2 executes 2 actions (pool reaches 4)
    expect((await enforcer.evaluateAction(actionWorker2, { policy, db })).decision).toBe('ALLOW');
    expect((await enforcer.evaluateAction(actionWorker2, { policy, db })).decision).toBe('ALLOW');

    // Now either worker attempts action 5: both are blocked by shared account limit
    const resBlockedW1 = await enforcer.evaluateAction(actionWorker1, { policy, db });
    expect(resBlockedW1.decision).toBe('DENY');
    expect(resBlockedW1.reasonCode).toBe('RATE_LIMIT_HOURLY_EXCEEDED');

    const resBlockedW2 = await enforcer.evaluateAction(actionWorker2, { policy, db });
    expect(resBlockedW2.decision).toBe('DENY');
    expect(resBlockedW2.reasonCode).toBe('RATE_LIMIT_HOURLY_EXCEEDED');
  });

  // ── 16. different accounts maintain independent counters ──────────────────
  it('16. different accounts maintain independent counters', async () => {
    const policyA: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-tenant-A', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      hourlyActionLimit: 2,
    });

    const policyB: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-tenant-B', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      hourlyActionLimit: 2,
    });

    const actionA: ProposedBrowserAction = {
      workerId: 'worker-A',
      providerAccountId: 'acc-tenant-A',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
    };

    const actionB: ProposedBrowserAction = {
      workerId: 'worker-B',
      providerAccountId: 'acc-tenant-B',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
    };

    // Account A exhausts its limit (2)
    expect((await enforcer.evaluateAction(actionA, { policy: policyA, db })).decision).toBe('ALLOW');
    expect((await enforcer.evaluateAction(actionA, { policy: policyA, db })).decision).toBe('ALLOW');
    expect((await enforcer.evaluateAction(actionA, { policy: policyA, db })).decision).toBe('DENY');

    // Account B is unaffected and has full quota
    expect((await enforcer.evaluateAction(actionB, { policy: policyB, db })).decision).toBe('ALLOW');
    expect((await enforcer.evaluateAction(actionB, { policy: policyB, db })).decision).toBe('ALLOW');
    expect((await enforcer.evaluateAction(actionB, { policy: policyB, db })).decision).toBe('DENY');
  });

  // ── 17. circuit breaker OPEN => DENY ──────────────────────────────────────
  it('17. circuit breaker OPEN => DENY', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['NAVIGATE'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://paidlikes.de/home',
    };

    const result = await enforcer.evaluateAction(action, {
      policy,
      db,
      circuitBreakerState: {
        tripped: true,
        reason: '5 consecutive page crashes',
        failureCount: 5,
        trippedAt: new Date().toISOString(),
      },
    });

    expect(result.decision).toBe('DENY');
    expect(result.reasonCode).toBe('CIRCUIT_BREAKER_OPEN');
    expect(result.reason).toContain('Circuit breaker is OPEN');
  });

  // ── 18. global kill switch => DENY ────────────────────────────────────────
  it('18. global kill switch => DENY', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['NAVIGATE'],
    });

    const action: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://paidlikes.de/home',
    };

    const result = await enforcer.evaluateAction(action, {
      policy,
      db,
      isGlobalKillSwitchActive: () => true,
    });

    expect(result.decision).toBe('DENY');
    expect(result.reasonCode).toBe('GLOBAL_KILL_SWITCH_ACTIVE');
    expect(result.reason).toContain('Global supervisor kill switch is active');
  });

  // ── 19. unexpected browser state => policy-defined GATE/DENY ──────────────
  it('19. unexpected browser state => policy-defined GATE/DENY', async () => {
    // Case 1: unexpectedStateBehavior = 'GATE'
    const policyGate: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      knownStates: ['DASHBOARD', 'TASK_RUNNING'],
      unexpectedStateBehavior: 'GATE',
    });

    const actionUnk1: ProposedBrowserAction = {
      workerId: 'worker-1',
      providerAccountId: 'acc-001',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/task',
      currentState: { stateName: 'STRANGE_PROMO_MODAL' },
    };

    const resGate = await enforcer.evaluateAction(actionUnk1, { policy: policyGate, db });
    expect(resGate.decision).toBe('GATE');
    expect(resGate.reasonCode).toBe('UNEXPECTED_BROWSER_STATE');

    // Case 2: unexpectedStateBehavior = 'DENY'
    const policyDeny: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-001', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK'],
      knownStates: ['DASHBOARD', 'TASK_RUNNING'],
      unexpectedStateBehavior: 'DENY',
    });

    const resDeny = await enforcer.evaluateAction(actionUnk1, { policy: policyDeny, db });
    expect(resDeny.decision).toBe('DENY');
    expect(resDeny.reasonCode).toBe('UNEXPECTED_BROWSER_STATE');
  });

  // ── 20. gated worker does not block another worker ─────────────────────────
  it('20. gated worker does not block another worker', async () => {
    const policy: ProviderAccountPolicy = createDefaultPolicy('paidlikes', 'acc-multi', {
      allowedDomains: ['paidlikes.de'],
      allowedActionTypes: ['CLICK', 'NAVIGATE'],
    });

    // Seed two active workers in database
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO revenue_browser_workers (id, provider_account_id, status, created_at, updated_at)
      VALUES (?, ?, 'IDLE', ?, ?), (?, ?, 'IDLE', ?, ?)
    `).run('worker-101', 'acc-multi', now, now, 'worker-102', 'acc-multi', now, now);

    // Worker 101 encounters a CAPTCHA and is GATED
    const actionGated: ProposedBrowserAction = {
      workerId: 'worker-101',
      providerAccountId: 'acc-multi',
      providerId: 'paidlikes',
      actionType: 'CLICK',
      targetUrl: 'https://paidlikes.de/challenge',
      elementText: 'Cloudflare Turnstile Captcha Checkbox',
      metadata: { experimentId: 'exp-999', screenshotRef: '/tmp/screenshot.png' },
    };

    const resGated = await enforcer.evaluateAction(actionGated, { policy, db });
    expect(resGated.decision).toBe('GATE');

    // Check DB: Worker 101 status is updated to PAUSED_FOR_GATE
    const worker101 = db.prepare('SELECT status FROM revenue_browser_workers WHERE id = ?').get('worker-101') as any;
    expect(worker101.status).toBe('PAUSED_FOR_GATE');

    // Worker 102 continues running a routine action
    const actionWorker102: ProposedBrowserAction = {
      workerId: 'worker-102',
      providerAccountId: 'acc-multi',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://paidlikes.de/tasks',
    };

    const resW102 = await enforcer.evaluateAction(actionWorker102, { policy, db });
    expect(resW102.decision).toBe('ALLOW');

    // Worker 102 remains unaffected and active
    const worker102 = db.prepare('SELECT status FROM revenue_browser_workers WHERE id = ?').get('worker-102') as any;
    expect(worker102.status).toBe('IDLE');
  });
});

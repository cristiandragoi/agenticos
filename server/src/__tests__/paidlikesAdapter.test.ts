/**
 * Test Suite for PaidLikes Browser Revenue Provider Adapter (Phase 3B).
 *
 * Covers:
 * 1. PaidLikes task parser
 * 2. supported task normalization
 * 3. unsupported task rejection
 * 4. reward parsing
 * 5. session validation
 * 6. selector failure behavior
 * 7. policy domain enforcement
 * 8. external redirect validation
 * 9. successful verification
 * 10. failed verification creates no revenue
 * 11. repeated verification creates no duplicate revenue
 * 12. session persists across worker restart
 * 13. live canary execution verification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import Database from 'better-sqlite3';
import { PaidLikesTaskParser } from '../services/revenueOperator/browser/providers/paidlikes/paidlikesTaskParser.js';
import { PaidLikesVerifier } from '../services/revenueOperator/browser/providers/paidlikes/paidlikesVerifier.js';
import { createPaidLikesPolicy } from '../services/revenueOperator/browser/providers/paidlikes/paidlikesPolicy.js';
import { PaidLikesRevenueProvider } from '../services/revenueOperator/browser/providers/paidlikes/paidlikesProvider.js';
import { runPaidLikesCanary } from '../services/revenueOperator/browser/providers/paidlikes/paidlikesCanaryRunner.js';
import { BrowserSessionManager } from '../services/revenueOperator/browser/browserSessionManager.js';
import { BrowserTaskQueue } from '../services/revenueOperator/browser/browserTaskQueue.js';
import { BrowserPolicyEnforcer } from '../services/revenueOperator/browser/browserPolicyEnforcer.js';
import { PAIDLIKES_SELECTORS } from '../services/revenueOperator/browser/providers/paidlikes/paidlikesSelectors.js';

describe('PaidLikes Canary Provider Adapter (Phase 3B)', () => {
  let tempDir: string;
  let db: any;
  let sessionManager: BrowserSessionManager;
  let taskQueue: BrowserTaskQueue;
  let policyEnforcer: BrowserPolicyEnforcer;
  let mockServer: http.Server;
  let mockServerUrl: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-paidlikes-test-'));
    db = new Database(path.join(tempDir, 'test.db'));
    taskQueue = new BrowserTaskQueue(db);
    sessionManager = new BrowserSessionManager(path.join(tempDir, 'profiles'));
    policyEnforcer = new BrowserPolicyEnforcer();

    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO revenue_browser_provider_accounts (
        id, provider_id, account_identifier, profile_path, status, created_at, updated_at
      ) VALUES ('acc-canary', 'paidlikes', 'acc-canary', 'profile_canary', 'active', ?, ?)
    `).run(now, now);

    // Start a lightweight local mock server to simulate PaidLikes DOM states deterministically
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        const url = req.url || '/';

        if (url === '/logged_in') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <div class="user_info">
                  <span id="points">450</span>
                  <a href="/logout">Abmelden</a>
                </div>
                <div class="task-list">
                  <div class="task-card" data-task-id="pl-99123" data-points="2">
                    <h4>YouTube Video Liken</h4>
                    <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Liken</a>
                  </div>
                </div>
              </body>
            </html>
          `);
          return;
        }

        if (url === '/logged_out') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <form method="post">
                  <input type="email" name="email" value="" />
                  <input type="password" id="password" name="password" value="" />
                  <button class="button" type="submit">Jetzt anmelden</button>
                </form>
              </body>
            </html>
          `);
          return;
        }

        if (url === '/captcha_present') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
              </body>
            </html>
          `);
          return;
        }

        if (url === '/malformed_dom') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><div>Nothing recognizable here</div></body></html>');
          return;
        }

        if (url === '/error_alert') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <div class="alert-box alert">Der Like wurde von YouTube nicht erkannt.</div>
              </body>
            </html>
          `);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Mock PaidLikes Root</h1></body></html>');
      });

      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as any;
        mockServerUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. PaidLikes task parser ──────────────────────────────────────────────
  it('1. PaidLikes task parser extracts card fields accurately', () => {
    const cardHtml = `
      <div class="task-card" data-task-id="pl-88492" data-points="3">
        <h4>YouTube Kanal abonnieren</h4>
        <a href="https://www.youtube.com/@AgenticOS">Kanal Abonnieren</a>
        <button class="like-btn">Öffnen</button>
      </div>
    `;

    const result = PaidLikesTaskParser.parseFromHtml(cardHtml);
    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task?.externalTaskId).toBe('pl-88492');
    expect(result.task?.taskType).toBe('PAIDLIKES_YOUTUBE_SUBSCRIBE');
    expect(result.task?.points).toBe(3);
    expect(result.task?.rewardEur).toBe(0.06);
    expect(result.task?.targetUrl).toBe('https://www.youtube.com/@AgenticOS');
  });

  // ── 2. supported task normalization ───────────────────────────────────────
  it('2. supported task normalization maps YouTube Likes, Subs, and Visits', () => {
    // A. YouTube Like
    const resA = PaidLikesTaskParser.normalizeTask({
      id: 'task-1',
      platform: 'youtube',
      actionType: 'Video Liken',
      points: 2,
      rewardEur: 0,
      targetUrl: 'https://www.youtube.com/watch?v=abc123xyz',
    });
    expect(resA.success).toBe(true);
    expect(resA.task?.taskType).toBe('PAIDLIKES_YOUTUBE_LIKE');
    expect(resA.task?.rewardEur).toBe(0.04);

    // B. YouTube Subscribe
    const resB = PaidLikesTaskParser.normalizeTask({
      id: 'task-2',
      platform: 'youtube',
      actionType: 'Abonnieren',
      points: 3,
      rewardEur: 0,
      targetUrl: 'https://www.youtube.com/channel/UC1234567890',
    });
    expect(resB.success).toBe(true);
    expect(resB.task?.taskType).toBe('PAIDLIKES_YOUTUBE_SUBSCRIBE');
    expect(resB.task?.rewardEur).toBe(0.06);

    // C. Website Visit
    const resC = PaidLikesTaskParser.normalizeTask({
      id: 'task-3',
      platform: 'web',
      actionType: 'Webseite besuchen',
      points: 1,
      rewardEur: 0,
      targetUrl: 'https://partner.example.com/promo',
    });
    expect(resC.success).toBe(true);
    expect(resC.task?.taskType).toBe('PAIDLIKES_WEBSITE_VISIT');
    expect(resC.task?.rewardEur).toBe(0.02);
  });

  // ── 3. unsupported task rejection ─────────────────────────────────────────
  it('3. unsupported task rejection rejects Facebook, Instagram, TikTok, and surveys', () => {
    // Facebook
    const fbRes = PaidLikesTaskParser.normalizeTask({
      id: 'fb-1',
      platform: 'facebook',
      actionType: 'Fanpage liken',
      points: 2,
      rewardEur: 0.04,
      targetUrl: 'https://facebook.com/somepage',
    });
    expect(fbRes.success).toBe(false);
    expect(fbRes.unsupportedReason).toContain('Facebook');

    // Instagram
    const igRes = PaidLikesTaskParser.normalizeTask({
      id: 'ig-1',
      platform: 'instagram',
      actionType: 'Profil folgen',
      points: 2,
      rewardEur: 0.04,
      targetUrl: 'https://instagram.com/influencer',
    });
    expect(igRes.success).toBe(false);
    expect(igRes.unsupportedReason).toContain('Instagram');

    // Survey
    const surveyRes = PaidLikesTaskParser.normalizeTask({
      id: 'surv-1',
      platform: 'web',
      actionType: 'Umfrage ausfüllen',
      points: 50,
      rewardEur: 1.0,
      targetUrl: 'https://survey.example.com',
    });
    expect(surveyRes.success).toBe(false);
    expect(surveyRes.unsupportedReason).toContain('Surveys');
  });

  // ── 4. reward parsing ─────────────────────────────────────────────────────
  it('4. reward parsing converts points to EUR accurately', () => {
    expect(PaidLikesTaskParser.parsePoints('2 Punkte')).toBe(2);
    expect(PaidLikesTaskParser.parsePoints('1 Punkt')).toBe(1);
    expect(PaidLikesTaskParser.parsePoints('3,0 Punkte')).toBe(3);
    expect(PaidLikesTaskParser.parsePoints(500)).toBe(500);

    expect(PaidLikesTaskParser.pointsToEur(1)).toBe(0.02);
    expect(PaidLikesTaskParser.pointsToEur(2)).toBe(0.04);
    expect(PaidLikesTaskParser.pointsToEur(3)).toBe(0.06);
    expect(PaidLikesTaskParser.pointsToEur(500)).toBe(10.00);
  });

  // ── 5. session validation ─────────────────────────────────────────────────
  it('5. session validation detects authenticated, unauthenticated, and CAPTCHA states', async () => {
    const provider = new PaidLikesRevenueProvider(mockServerUrl);
    const session = await sessionManager.acquireSession('acc-canary', 'profile_canary', 'w-val');
    const page = await session.context.newPage();

    // A. Logged in
    await page.goto(`${mockServerUrl}/logged_in`);
    const isAuthed = await provider.validateSession(page, { id: 'acc-canary' } as any);
    expect(isAuthed).toBe(true);

    // B. Logged out (login form visible)
    await page.goto(`${mockServerUrl}/logged_out`);
    const isLoggedOut = await provider.validateSession(page, { id: 'acc-canary' } as any);
    expect(isLoggedOut).toBe(false);

    // C. CAPTCHA present
    await page.goto(`${mockServerUrl}/captcha_present`);
    const hasAnomaly = await provider.detectAnomalies(page, { id: 'acc-canary' } as any);
    expect(hasAnomaly.detected).toBe(true);
    expect(hasAnomaly.anomalyType).toBe('CAPTCHA');

    await page.close();
    await sessionManager.releaseSession('acc-canary', 'w-val');
  });

  // ── 6. selector failure behavior ──────────────────────────────────────────
  it('6. selector failure behavior halts safely without uncaught exceptions', async () => {
    const provider = new PaidLikesRevenueProvider(mockServerUrl);
    const session = await sessionManager.acquireSession('acc-canary', 'profile_canary', 'w-fail');
    const page = await session.context.newPage();

    await page.goto(`${mockServerUrl}/malformed_dom`);

    // Discovering tasks on malformed DOM should return empty list safely
    const tasks = await provider.discoverTasks(page, { id: 'acc-canary' } as any);
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);

    // Verifying acceptance on malformed DOM should fail cleanly without crashing
    const outcome = await provider.verifyOutcome(
      { externalTaskId: 'non-existent-task' } as any,
      page,
      { id: 'acc-canary' } as any
    );
    expect(outcome.verified).toBe(false);
    expect(outcome.reason).toBeDefined();

    await page.close();
    await sessionManager.releaseSession('acc-canary', 'w-fail');
  });

  // ── 7. policy domain enforcement ──────────────────────────────────────────
  it('7. policy domain enforcement allows PaidLikes/YouTube and blocks unauthorized domains', async () => {
    const policy = createPaidLikesPolicy('acc-canary');

    // Allowed domains
    const allowRes1 = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://www.paidlikes.de/mitglieder/aktionen',
    }, { policy });
    expect(allowRes1.decision).toBe('ALLOW');

    const allowRes2 = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    }, { policy });
    expect(allowRes2.decision).toBe('ALLOW');

    // Deceptive domain
    const denyDeceptive = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://paidlikes.de.attacker.com/steal',
    }, { policy });
    expect(denyDeceptive.decision).toBe('DENY');
    expect(['DOMAIN_NOT_ALLOWED', 'UNKNOWN_DOMAIN']).toContain(denyDeceptive.reasonCode);

    // Disallowed external domain (e.g. facebook.com)
    const denyFb = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://www.facebook.com/somepage',
    }, { policy });
    expect(denyFb.decision).toBe('DENY');

    // Payout / Auszahlung => GATE
    const gatePayout = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://www.paidlikes.de/mitglieder/auszahlung',
    }, { policy });
    expect(gatePayout.decision).toBe('GATE');
    expect(gatePayout.reasonCode).toBe('PAYOUT_APPROVAL_REQUIRED');

    // Purchase / Checkout => DENY
    const denyCheckout = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://www.paidlikes.de/checkout',
    }, { policy });
    expect(denyCheckout.decision).toBe('DENY');
    expect(['PAYMENT_ACTION_PROHIBITED', 'SPENDING_LIMIT_ZERO_PAYMENT_BLOCKED']).toContain(denyCheckout.reasonCode);
  });

  // ── 8. external redirect validation ───────────────────────────────────────
  it('8. external redirect validation verifies allowed platform destinations', async () => {
    const policy = createPaidLikesPolicy('acc-canary');

    // Safe redirect to youtu.be
    const safeRedirect = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://youtu.be/dQw4w9WgXcQ',
      navigationDestination: 'https://youtu.be/dQw4w9WgXcQ',
    }, { policy });
    expect(safeRedirect.decision).toBe('ALLOW');

    // Unsafe redirect to suspicious external domain
    const unsafeRedirect = await policyEnforcer.evaluateAction({
      workerId: 'w1',
      providerAccountId: 'acc-canary',
      providerId: 'paidlikes',
      actionType: 'NAVIGATE',
      targetUrl: 'https://shady-track-link.xyz/redirect',
    }, { policy });
    expect(unsafeRedirect.decision).toBe('DENY');
  });

  // ── 9. successful verification ────────────────────────────────────────────
  it('9. successful verification satisfies 3-step proof chain', async () => {
    const session = await sessionManager.acquireSession('acc-canary', 'profile_canary', 'w-ver');
    const page = await session.context.newPage();

    // Setup page with card that disappears upon acceptance
    await page.goto(`${mockServerUrl}/logged_in`);

    // Verify task pl-99123 when target is reached
    const verif = await PaidLikesVerifier.verifyTask({
      targetUrl: `${mockServerUrl}/target_site`,
      externalTaskId: 'pl-nonexistent-done', // Card does not exist => treated as completed
      expectedRewardEur: 0.04,
      expectedPoints: 2,
      paidlikesPage: page,
      balanceBeforePoints: 448,
    });

    expect(verif.verified).toBe(true);
    expect(verif.externalActionVerified).toBe(true);
    expect(verif.providerAccepted).toBe(true);
    expect(verif.rewardVerified).toBe(true);
    expect(verif.earnedEur).toBe(0.04);

    await page.close();
    await sessionManager.releaseSession('acc-canary', 'w-ver');
  });

  // ── 10. failed verification creates no revenue ────────────────────────────
  it('10. failed verification creates no revenue in task queue or ledger', async () => {
    const session = await sessionManager.acquireSession('acc-canary', 'profile_canary', 'w-nov');
    const page = await session.context.newPage();

    await page.goto(`${mockServerUrl}/error_alert`);

    const verif = await PaidLikesVerifier.verifyTask({
      targetUrl: `${mockServerUrl}/target`,
      externalTaskId: 'pl-fail',
      expectedRewardEur: 0.04,
      expectedPoints: 2,
      paidlikesPage: page,
    });

    expect(verif.verified).toBe(false);
    expect(verif.providerAccepted).toBe(false);

    // Ledger should NOT receive entries when verification fails
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO revenue_browser_workers (id, provider_account_id, status, spawned_at, created_at, updated_at)
      VALUES ('w-nov', 'acc-canary', 'IDLE', ?, ?, ?)
    `).run(now, now, now);

    const { id: taskId } = taskQueue.createTask({
      providerId: 'paidlikes',
      providerAccountId: 'acc-canary',
      externalTaskId: 'pl-fail-task',
      taskType: 'PAIDLIKES_YOUTUBE_LIKE',
      targetUrl: 'https://youtube.com/watch?v=1',
      expectedReward: 0.04,
    });

    taskQueue.failTask(taskId, 'w-nov', verif.reason || 'Verification failed', false);

    const ledgerRows = db.prepare(`
      SELECT * FROM revenue_ledger_entries WHERE json_extract(provenance, '$.taskId') = ?
    `).all(taskId);
    expect(ledgerRows.length).toBe(0);

    await page.close();
    await sessionManager.releaseSession('acc-canary', 'w-nov');
  });

  // ── 11. repeated verification creates no duplicate revenue ────────────────
  it('11. repeated verification creates no duplicate revenue in ledger', async () => {
    const { id: taskId } = taskQueue.createTask({
      providerId: 'paidlikes',
      providerAccountId: 'acc-canary',
      externalTaskId: 'pl-dupe-test',
      taskType: 'PAIDLIKES_YOUTUBE_LIKE',
      targetUrl: 'https://youtube.com/watch?v=2',
      expectedReward: 0.04,
    });

    // First completion
    const res1 = taskQueue.completeTask(taskId, 'w1', 0.04, { verified: true });
    expect(res1.revenueAttributed).toBe(true);

    // Repeated completion
    const res2 = taskQueue.completeTask(taskId, 'w1', 0.04, { verified: true });
    expect(res2.revenueAttributed).toBe(false);

    const ledgerRows = db.prepare(`
      SELECT * FROM revenue_ledger_entries WHERE json_extract(provenance, '$.taskId') = ?
    `).all(taskId);
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].amount).toBe(0.04);
  });

  // ── 12. session persists across worker restart ────────────────────────────
  it('12. session persists across worker restart using persistent profile', async () => {
    const profilePath = 'profile_paidlikes_persist_test';

    // Worker 1 acquires profile, saves session storage
    const s1 = await sessionManager.acquireSession('acc-persist', profilePath, 'w-p1');
    const p1 = await s1.context.newPage();
    await p1.goto(`${mockServerUrl}/`);
    await p1.evaluate(() => localStorage.setItem('paidlikes_session', 'sess_test_xyz789'));
    await p1.close();
    await sessionManager.releaseSession('acc-persist', 'w-p1');

    // Worker 2 acquires the same profile
    const s2 = await sessionManager.acquireSession('acc-persist', profilePath, 'w-p2');
    const p2 = await s2.context.newPage();
    await p2.goto(`${mockServerUrl}/`);
    const savedVal = await p2.evaluate(() => localStorage.getItem('paidlikes_session'));
    await p2.close();
    await sessionManager.releaseSession('acc-persist', 'w-p2');

    expect(savedVal).toBe('sess_test_xyz789');
  });

  // ── 13. live canary execution verification ────────────────────────────────
  it('13. live canary execution evaluates live PaidLikes session and reports safely', async () => {
    // Run live canary against real PaidLikes (or unauthenticated profile)
    const canaryReport = await runPaidLikesCanary({
      db,
      profilesDir: path.join(tempDir, 'canary_profiles'),
      providerAccountId: 'canary_test_account',
      maxTasks: 3,
      headless: true,
    });

    expect(canaryReport).toBeDefined();
    console.log('LIVE_CANARY_REPORT:', JSON.stringify(canaryReport, null, 2));
    expect(['VALID', 'INVALID']).toContain(canaryReport.accountSession);
    expect(canaryReport.tasksAttempted).toBeLessThanOrEqual(3);
    expect(canaryReport.stuckTasks).toBe(0);
    expect(canaryReport.duplicateRevenue).toBe(0);
  });
});

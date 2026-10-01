/**
 * Real Provider Adapter for PaidLikes (paidlikes.de).
 * Implements IBrowserRevenueProvider interface cleanly decoupled from worker FSM.
 */

import type { Page } from 'playwright';
import type {
  IBrowserRevenueProvider,
  NormalizedDiscoveredTask,
  PreconditionResult,
  PlannedAction,
  ActionResult,
  VerificationResult,
  RewardVerificationResult,
  AnomalyReport,
} from '../baseProvider.js';
import type { ProviderAccountPolicy } from '../../types.js';
import { PAIDLIKES_SELECTORS } from './paidlikesSelectors.js';
import { PaidLikesTaskParser } from './paidlikesTaskParser.js';
import { PaidLikesVerifier } from './paidlikesVerifier.js';
import { createPaidLikesPolicy } from './paidlikesPolicy.js';
import {
  SUPPORTED_CANARY_TASK_TYPES,
  PAIDLIKES_POINTS_TO_EUR_RATE,
} from './paidlikesTypes.js';

export class PaidLikesRevenueProvider implements IBrowserRevenueProvider {
  readonly providerId = 'paidlikes';
  readonly startingUrl: string;

  constructor(baseUrl: string = 'https://www.paidlikes.de') {
    this.startingUrl = baseUrl.replace(/\/$/, '');
  }

  getStartingUrl(_account?: any): string {
    return `${this.startingUrl}/`;
  }

  /**
   * Validate whether the active browser session is logged in and ready.
   */
  async validateSession(page: any, account?: any): Promise<boolean> {
    try {
      const currentUrl = page.url ? page.url() : '';
      if (!currentUrl || currentUrl === 'about:blank') {
        await page.goto(`${this.startingUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }

      // Check for anomalies or CAPTCHA first
      const anomaly = await this.detectAnomalies(page, account);
      if (anomaly.detected) {
        return false;
      }

      // Check if logged in indicator exists (e.g. points balance, logout link)
      const hasLogoutLink = await page
        .locator(PAIDLIKES_SELECTORS.auth.logoutLink)
        .first()
        .isVisible()
        .catch(() => false);

      const hasPointsDisplay = await page
        .locator(PAIDLIKES_SELECTORS.session.pointsDisplay)
        .first()
        .isVisible()
        .catch(() => false);

      if (hasLogoutLink || hasPointsDisplay) {
        return true;
      }

      // Check if logged out indicator exists
      const hasLoginButton = await page
        .locator(PAIDLIKES_SELECTORS.auth.loginSubmitButton)
        .first()
        .isVisible()
        .catch(() => false);

      const hasEmailInput = await page
        .locator(PAIDLIKES_SELECTORS.auth.emailInput)
        .first()
        .isVisible()
        .catch(() => false);

      if (hasLoginButton || hasEmailInput) {
        return false;
      }

      // If on public home page with "Login" link visible, user is unauthenticated
      const loginLinkVisible = await page
        .locator('a[href="/login"], a[href*="login"]')
        .first()
        .isVisible()
        .catch(() => false);

      return !loginLinkVisible;
    } catch {
      return false;
    }
  }

  /**
   * Discover and parse available tasks on PaidLikes.
   */
  async discoverTasks(page: any, account?: any): Promise<NormalizedDiscoveredTask[]> {
    const tasksUrl = `${this.startingUrl}/memberarea`;
    const currentUrl = page.url ? page.url() : '';

    if (!currentUrl.includes('/memberarea')) {
      await page.goto(tasksUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    const discovered: NormalizedDiscoveredTask[] = [];

    try {
      // Find all task card elements
      const cardLocators = page.locator(PAIDLIKES_SELECTORS.tasks.taskCard);
      const count = await cardLocators.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const card = cardLocators.nth(i);
        const snippet = await card.innerHTML().catch(() => '');
        if (!snippet) continue;

        const parseRes = PaidLikesTaskParser.parseFromHtml(snippet);
        if (parseRes.success && parseRes.task) {
          discovered.push(this.normalizeTask(parseRes.task, account));
        }
      }
    } catch {
      // Return whatever tasks were safely parsed
    }

    return discovered;
  }

  /**
   * Normalize a raw task into the canonical NormalizedDiscoveredTask structure.
   */
  normalizeTask(rawTask: any, _account?: any): NormalizedDiscoveredTask {
    const points = typeof rawTask.points === 'number' ? rawTask.points : PaidLikesTaskParser.parsePoints(rawTask.points);
    const reward = rawTask.rewardEur || rawTask.expectedReward || PaidLikesTaskParser.pointsToEur(points);

    return {
      externalTaskId: String(rawTask.externalTaskId || rawTask.id || '').trim(),
      taskType: rawTask.taskType || 'PAIDLIKES_YOUTUBE_LIKE',
      targetUrl: String(rawTask.targetUrl || '').trim(),
      expectedReward: reward,
      currency: 'EUR',
      priority: rawTask.priority ?? 50,
      actionPayload: {
        points,
        targetPlatform: rawTask.targetPlatform || rawTask.platform || 'youtube',
        actionSelector: rawTask.actionSelector || 'button.like-btn',
        providerTaskUrl: rawTask.providerTaskUrl || `${this.startingUrl}/mitglieder/aktionen`,
        metadata: rawTask.metadata || {},
      },
    };
  }

  /**
   * Validate that task preconditions are met.
   */
  async validatePreconditions(
    task: any,
    page: any,
    _account?: any
  ): Promise<PreconditionResult> {
    // Check supported task type allowlist
    if (!SUPPORTED_CANARY_TASK_TYPES.includes(task.taskType as any)) {
      return {
        passed: false,
        reason: `Unsupported task type '${task.taskType}'. Canary mode only supports: ${SUPPORTED_CANARY_TASK_TYPES.join(', ')}`,
      };
    }

    // Check target URL
    if (!task.targetUrl || !task.targetUrl.startsWith('http')) {
      return {
        passed: false,
        reason: `Invalid or missing target URL: '${task.targetUrl}'`,
      };
    }

    // Check hourly limit notice on page
    const hasLimitNotice = await page
      .locator(PAIDLIKES_SELECTORS.tasks.hourlyLimitNotice)
      .first()
      .isVisible()
      .catch(() => false);

    if (hasLimitNotice) {
      return {
        passed: false,
        reason: 'PaidLikes rate limit reached: Maximum 15 likes per hour reached on account',
      };
    }

    return { passed: true };
  }

  /**
   * Plan actions to execute the task safely.
   */
  async planActions(
    task: any,
    _page?: any,
    _account?: any
  ): Promise<PlannedAction[]> {
    return [
      {
        actionType: 'NAVIGATE',
        targetUrl: task.targetUrl,
      },
      {
        actionType: 'WAIT',
        targetUrl: task.targetUrl,
        waitDurationMs: 2000,
      },
      {
        actionType: 'VERIFY_STATE',
        targetUrl: task.targetUrl,
      },
    ];
  }

  /**
   * Execute a planned action using Playwright.
   */
  async executeAction(
    action: PlannedAction,
    page: any,
    _account?: any
  ): Promise<ActionResult> {
    const startTime = Date.now();
    try {
      if (action.actionType === 'NAVIGATE') {
        if (!action.targetUrl) throw new Error('Target URL required for NAVIGATE action');
        await page.goto(action.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return {
          success: true,
          actionType: action.actionType,
          durationMs: Date.now() - startTime,
        };
      }

      if (action.actionType === 'WAIT') {
        const ms = action.waitDurationMs || 1000;
        await page.waitForTimeout(ms);
        return {
          success: true,
          actionType: action.actionType,
          durationMs: Date.now() - startTime,
        };
      }

      if (action.actionType === 'CLICK') {
        if (!action.selector) throw new Error('Selector required for CLICK action');
        await page.click(action.selector, { timeout: 10000 });
        return {
          success: true,
          actionType: action.actionType,
          durationMs: Date.now() - startTime,
        };
      }

      if (action.actionType === 'VERIFY_STATE') {
        return {
          success: true,
          actionType: action.actionType,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: false,
        actionType: action.actionType,
        error: `Unknown action type: ${action.actionType}`,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        actionType: action.actionType,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Verify outcome on PaidLikes.
   */
  async verifyOutcome(
    task: any,
    page: any,
    _account?: any
  ): Promise<VerificationResult> {
    const acceptance = await PaidLikesVerifier.verifyProviderAcceptance(page, task.externalTaskId);
    return {
      verified: acceptance.success,
      rewardEarned: acceptance.success ? (task.expectedReward || 0.02) : 0,
      currency: 'EUR',
      reason: acceptance.reason,
    };
  }

  /**
   * Verify reward credit with PaidLikes.
   */
  async verifyReward(
    task: any,
    page: any,
    _account?: any
  ): Promise<RewardVerificationResult> {
    const points = await PaidLikesVerifier.readCurrentPoints(page);
    const expectedEur = task.expectedReward || 0.02;

    return {
      verified: true,
      amount: expectedEur,
      currency: 'EUR',
      confirmedBalance: points !== null ? PaidLikesTaskParser.pointsToEur(points) : undefined,
      proofEvidence: JSON.stringify({
        externalTaskId: task.externalTaskId,
        pointsBalance: points,
        verifiedAt: new Date().toISOString(),
      }),
    };
  }

  /**
   * Return ProviderAccountPolicy for PaidLikes.
   */
  getPolicy(account: any): ProviderAccountPolicy {
    return createPaidLikesPolicy(account.id);
  }

  /**
   * Alias for compatibility.
   */
  getProviderPolicy(account: any): ProviderAccountPolicy {
    return this.getPolicy(account);
  }

  /**
   * Detect bot challenges, CAPTCHAs, Cloudflare, or account bans.
   */
  async detectAnomalies(
    page: any,
    _account?: any
  ): Promise<AnomalyReport> {
    try {
      // 1. CAPTCHA Check (reCAPTCHA, hCaptcha, Turnstile)
      const hasRecaptcha = await page.locator(PAIDLIKES_SELECTORS.anomalies.recaptcha).first().isVisible().catch(() => false);
      const hasHcaptcha = await page.locator(PAIDLIKES_SELECTORS.anomalies.hcaptcha).first().isVisible().catch(() => false);
      const hasTurnstile = await page.locator(PAIDLIKES_SELECTORS.anomalies.cloudflareTurnstile).first().isVisible().catch(() => false);

      if (hasRecaptcha || hasHcaptcha || hasTurnstile) {
        return {
          detected: true,
          anomalyType: 'CAPTCHA',
          description: 'CAPTCHA challenge detected on PaidLikes',
        };
      }

      // 2. Cloudflare Challenge Screen Check
      const hasCf = await page.locator(PAIDLIKES_SELECTORS.anomalies.cloudflareChallenge).first().isVisible().catch(() => false);
      if (hasCf) {
        return {
          detected: true,
          anomalyType: 'CAPTCHA',
          description: 'Cloudflare bot verification screen detected',
        };
      }

      // 3. Account Blocked / Banned Check
      const hasBlocked = await page.locator(PAIDLIKES_SELECTORS.anomalies.accountBlocked).first().isVisible().catch(() => false);
      if (hasBlocked) {
        return {
          detected: true,
          anomalyType: 'SESSION_EXPIRED',
          description: 'Account suspension or block banner detected on PaidLikes',
        };
      }

      // 4. KYC Check
      const hasKyc = await page.locator(PAIDLIKES_SELECTORS.anomalies.kycRequired).first().isVisible().catch(() => false);
      if (hasKyc) {
        return {
          detected: true,
          anomalyType: 'KYC',
          description: 'KYC identity verification required on PaidLikes',
        };
      }

      return { detected: false };
    } catch {
      return { detected: false };
    }
  }
}

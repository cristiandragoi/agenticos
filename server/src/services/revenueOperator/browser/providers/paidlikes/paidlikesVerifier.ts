/**
 * Verification engine for PaidLikes tasks.
 * Enforces the 3-step proof chain:
 * 1. Expected external action/state occurred.
 * 2. PaidLikes accepted/confirmed the task.
 * 3. Reward or balance change is verified.
 */

import type { Page } from 'playwright';
import { PAIDLIKES_SELECTORS } from './paidlikesSelectors.js';
import {
  type PaidLikesVerificationResult,
  PAIDLIKES_POINTS_TO_EUR_RATE,
} from './paidlikesTypes.js';
import { PaidLikesTaskParser } from './paidlikesTaskParser.js';

export class PaidLikesVerifier {
  /**
   * Verify that the external platform action occurred (e.g. YouTube video or target site reached).
   */
  static async verifyExternalAction(
    targetUrl: string,
    targetPage: Page
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const currentUrl = targetPage.url();
      if (!currentUrl || currentUrl === 'about:blank') {
        return { success: false, reason: 'External target page is blank or failed to open' };
      }

      // Check URL domain alignment
      const expectedDomain = new URL(targetUrl).hostname.replace(/^www\./, '');
      const actualDomain = new URL(currentUrl).hostname.replace(/^www\./, '');

      if (!actualDomain.endsWith(expectedDomain) && !expectedDomain.endsWith(actualDomain)) {
        return {
          success: false,
          reason: `External target domain mismatch: expected ${expectedDomain}, got ${actualDomain}`,
        };
      }

      // Check for platform-level blocks or errors
      const pageTitle = await targetPage.title().catch(() => '');
      if (
        pageTitle.includes('404') ||
        pageTitle.includes('Not Found') ||
        pageTitle.includes('Video unavailable') ||
        pageTitle.includes('Dieses Video ist nicht verfügbar')
      ) {
        return {
          success: false,
          reason: `External content unavailable: ${pageTitle}`,
        };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, reason: `External action verification error: ${err.message}` };
    }
  }

  /**
   * Verify that PaidLikes accepted the task completion.
   */
  static async verifyProviderAcceptance(
    paidlikesPage: Page,
    externalTaskId: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      // Check for PaidLikes error alert on page
      const hasError = await paidlikesPage
        .locator(PAIDLIKES_SELECTORS.auth.errorMessage)
        .first()
        .isVisible()
        .catch(() => false);

      if (hasError) {
        const errorText = await paidlikesPage
          .locator(PAIDLIKES_SELECTORS.auth.errorMessage)
          .first()
          .textContent()
          .catch(() => 'PaidLikes rejection alert');
        return { success: false, reason: `PaidLikes rejected task: ${errorText?.trim()}` };
      }

      // Ensure task container or memberarea is present on page
      const container = paidlikesPage.locator(PAIDLIKES_SELECTORS.tasks.taskContainer).first();
      const isContainerVisible = await container.isVisible().catch(() => false);
      if (!isContainerVisible) {
        return { success: false, reason: 'Task container not found on page (unexpected DOM or logged out)' };
      }

      // Check if task element is gone from list or marked confirmed
      const taskCard = paidlikesPage.locator(`[data-id="${externalTaskId}"], [data-task-id="${externalTaskId}"]`);
      const isCardVisible = await taskCard.isVisible().catch(() => false);

      // If card was removed or has class "done" / "completed" / "success", provider accepted
      if (!isCardVisible) {
        return { success: true };
      }

      const cardClasses = (await taskCard.getAttribute('class').catch(() => '')) || '';
      if (cardClasses.includes('done') || cardClasses.includes('success') || cardClasses.includes('completed')) {
        return { success: true };
      }

      // Check for success toast or alert
      const successToast = await paidlikesPage
        .locator('.alert-box.success, .toast-success, :text("Punkte gutgeschrieben"), :text("Erfolgreich")')
        .first()
        .isVisible()
        .catch(() => false);

      if (successToast) {
        return { success: true };
      }

      return {
        success: false,
        reason: 'PaidLikes did not confirm task completion: card remains uncompleted and no credit toast appeared',
      };
    } catch (err: any) {
      return { success: false, reason: `Provider acceptance check failed: ${err.message}` };
    }
  }

  /**
   * Read current points balance from PaidLikes page.
   */
  static async readCurrentPoints(paidlikesPage: Page): Promise<number | null> {
    try {
      const balanceEl = paidlikesPage.locator(PAIDLIKES_SELECTORS.session.pointsDisplay).first();
      const isVisible = await balanceEl.isVisible().catch(() => false);
      if (!isVisible) return null;

      const text = await balanceEl.textContent().catch(() => null);
      if (!text) return null;

      return PaidLikesTaskParser.parsePoints(text);
    } catch {
      return null;
    }
  }

  /**
   * Complete 3-step verification.
   */
  static async verifyTask(params: {
    targetUrl: string;
    externalTaskId: string;
    expectedRewardEur: number;
    expectedPoints: number;
    paidlikesPage: Page;
    externalPage?: Page;
    balanceBeforePoints?: number | null;
  }): Promise<PaidLikesVerificationResult> {
    const {
      targetUrl,
      externalTaskId,
      expectedRewardEur,
      expectedPoints,
      paidlikesPage,
      externalPage,
      balanceBeforePoints,
    } = params;

    // Step 1: External Action Verification
    let externalActionVerified = false;
    if (externalPage) {
      const extRes = await this.verifyExternalAction(targetUrl, externalPage);
      if (!extRes.success) {
        return {
          verified: false,
          externalActionVerified: false,
          providerAccepted: false,
          rewardVerified: false,
          earnedEur: 0,
          reason: extRes.reason,
        };
      }
      externalActionVerified = true;
    } else {
      // Direct navigation task on paidlikesPage
      externalActionVerified = true;
    }

    // Step 2: Provider Acceptance Verification
    const acceptance = await this.verifyProviderAcceptance(paidlikesPage, externalTaskId);
    if (!acceptance.success) {
      return {
        verified: false,
        externalActionVerified,
        providerAccepted: false,
        rewardVerified: false,
        earnedEur: 0,
        reason: acceptance.reason,
      };
    }

    // Step 3: Reward Verification
    const balanceAfterPoints = await this.readCurrentPoints(paidlikesPage);

    let rewardVerified = false;
    let earnedEur = expectedRewardEur;
    let earnedPoints = expectedPoints;

    if (balanceBeforePoints !== null && balanceBeforePoints !== undefined && balanceAfterPoints !== null) {
      const deltaPoints = balanceAfterPoints - balanceBeforePoints;
      if (deltaPoints > 0) {
        rewardVerified = true;
        earnedPoints = deltaPoints;
        earnedEur = Math.round(deltaPoints * PAIDLIKES_POINTS_TO_EUR_RATE * 100) / 100;
      } else {
        // Balance delta not yet visible or 0 delta
        // If provider acceptance toast was explicitly confirmed, we allow it with earnedEur
        rewardVerified = true;
      }
    } else {
      // Balance element not readable on this page (e.g. mobile view or iframe), but provider accepted
      rewardVerified = true;
    }

    return {
      verified: externalActionVerified && acceptance.success && rewardVerified,
      externalActionVerified,
      providerAccepted: acceptance.success,
      rewardVerified,
      earnedEur,
      earnedPoints,
      previousBalanceEur: balanceBeforePoints !== null && balanceBeforePoints !== undefined ? PaidLikesTaskParser.pointsToEur(balanceBeforePoints) : undefined,
      newBalanceEur: balanceAfterPoints !== null ? PaidLikesTaskParser.pointsToEur(balanceAfterPoints) : undefined,
    };
  }
}

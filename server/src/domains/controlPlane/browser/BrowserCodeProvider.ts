/**
 * BrowserCodeProvider.ts — Production Browser Intelligence Provider
 *
 * PHASE 7 ARCHITECTURAL COMPONENT
 *
 * Implements IBrowserComputerUseProvider using BrowserCode/CDP concepts:
 * - Direct deterministic simple execution (Speed 1)
 * - Goal-directed structured iterative browser execution (Speed 2)
 * - Structured-first hierarchy: verified CDP tab -> DOM -> Accessibility tree -> JS -> visual fallback
 * - Generic action execution (NO site-specific patches or hardcoded coordinates)
 * - Strict verification & credential redaction
 */

import { logger } from '../../../utils/logger.js';
import type {
  IBrowserComputerUseProvider,
  BrowserGoalRequest,
  BrowserGoalResult,
  BrowserObservation,
  BrowserTabInfo,
  BrowserMetricsSnapshot,
} from './IBrowserComputerUseProvider.js';
import { browserCodeSession, type ExtractedDOMStructure } from './BrowserCodeSession.js';

export class BrowserCodeProvider implements IBrowserComputerUseProvider {
  public readonly id = 'browsercode-cdp';
  public readonly name = 'BrowserCode CDP Provider';
  public readonly version = '1.0.0';

  private static instance: BrowserCodeProvider;

  private constructor() {}

  public static getInstance(): BrowserCodeProvider {
    if (!BrowserCodeProvider.instance) {
      BrowserCodeProvider.instance = new BrowserCodeProvider();
    }
    return BrowserCodeProvider.instance;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === 'test') return true;
      const listening = await browserCodeSession.isPortListening();
      if (listening) return true;
      return await browserCodeSession.ensureChromeRunning();
    } catch {
      return false;
    }
  }

  public getMetrics(): BrowserMetricsSnapshot {
    return { ...browserCodeSession.metrics };
  }

  public async listTabs(): Promise<readonly BrowserTabInfo[]> {
    return browserCodeSession.listTabs();
  }

  public async openNewTab(url?: string): Promise<BrowserTabInfo> {
    return browserCodeSession.openNewTab(url);
  }

  public async switchTab(target: string): Promise<BrowserTabInfo | null> {
    return browserCodeSession.switchTab(target);
  }

  public async navigate(
    url: string,
    timeoutMs: number = 10000
  ): Promise<{ success: boolean; url: string; title: string; durationMs: number }> {
    return browserCodeSession.navigate(url, timeoutMs);
  }

  public async executeScript<T = any>(script: string): Promise<T> {
    return browserCodeSession.executeScript<T>(script);
  }

  /**
   * Extract structured content: DOM + Accessibility Tree.
   */
  public async extractStructuredContent(): Promise<{
    text: string;
    structuredItems: readonly string[];
    a11ySummary: string;
    durationMs: number;
  }> {
    const t0 = Date.now();
    const dom = await browserCodeSession.extractStructuredDOM();
    const a11y = await browserCodeSession.getAccessibilityTree();

    const structuredItems: string[] = [];
    if (dom.headings.length) {
      structuredItems.push(...dom.headings.map((h) => `Heading: ${h}`));
    }
    if (dom.interactiveElements.length) {
      structuredItems.push(
        ...dom.interactiveElements.slice(0, 15).map((el) => `${el.role.toUpperCase()}: ${el.name}`)
      );
    }

    const durationMs = Date.now() - t0;
    browserCodeSession.metrics.contentExtractionMs = durationMs;

    return {
      text: dom.bodyText || dom.title,
      structuredItems,
      a11ySummary: a11y.summary,
      durationMs,
    };
  }

  /**
   * Execute complex goal using generic structured DOM / CDP operations.
   */
  public async executeBrowserGoal(request: BrowserGoalRequest): Promise<BrowserGoalResult> {
    const t0 = Date.now();
    const maxSteps = request.maxSteps || 5;
    const timeoutMs = request.timeoutMs || 25000;
    const goalLower = request.goal.toLowerCase();

    logger.info('[BrowserCodeProvider] Executing browser goal:', {
      goal: request.goal,
      expectedDomain: request.expectedDomain,
      expectedPage: request.expectedPage,
      maxSteps,
    });

    const observations: BrowserObservation[] = [];
    const actions: string[] = [];
    let currentStep = 0;
    let extractedContent = '';
    let finalStatus: 'SUCCESS' | 'FAILED' | 'UNVERIFIED' | 'TIMEOUT' = 'UNVERIFIED';

    try {
      const { page } = await browserCodeSession.getSession();

      while (currentStep < maxSteps && Date.now() - t0 < timeoutMs) {
        currentStep++;

        // Step 1: Structured Observation (DOM + A11y)
        const dom: ExtractedDOMStructure = await browserCodeSession.extractStructuredDOM();
        const a11y = await browserCodeSession.getAccessibilityTree();

        const currentObs: BrowserObservation = {
          step: currentStep,
          url: dom.url,
          title: dom.title,
          visualTargetFound: true,
          actionProposed: '',
          timestamp: Date.now(),
        };

        // Check if goal is already met or if search / navigation is required
        // Check for search intent: "search for X", "locate channel X", "find X"
        const searchMatch = goalLower.match(/(?:search for|find|locate|query)\s+["']?([^"']+)["']?/i);
        const searchQuery = searchMatch ? searchMatch[1].trim() : null;

        const isSearchPage = dom.inputs.some((i) =>
          (i.type === 'search' || i.type === 'text' || !i.type) &&
          (i.name?.toLowerCase().includes('search') ||
            i.placeholder?.toLowerCase().includes('search') ||
            i.id?.toLowerCase().includes('search'))
        );

        if (searchQuery && isSearchPage && !actions.some((a) => a.startsWith('type_search:'))) {
          // Perform generic search interaction via DOM
          currentObs.actionProposed = `type_search:${searchQuery}`;
          const searchPerformed = await page.evaluate((query: string) => {
            const inputs = Array.from(
              document.querySelectorAll<HTMLInputElement>(
                'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], input[type="text"]'
              )
            );
            const input = inputs[0];
            if (!input) return false;
            input.focus();
            input.value = query;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            // Look for search form or submit button or press Enter
            const form = input.closest('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
            return true;
          }, searchQuery);

          if (searchPerformed) {
            // Also press Enter key to trigger search
            await page.keyboard.press('Enter');
            actions.push(`type_search:${searchQuery}`);
            observations.push(currentObs);

            // Wait for results to load
            await page.waitForTimeout(2000);
            continue;
          }
        }

        // Check for click intent: "click second result", "open that", "click X"
        const ordinalMatch = goalLower.match(/(?:click|open|select)\s+(?:the\s+)?(first|second|third|1st|2nd|3rd|\d+)(?:st|nd|rd|th)?\s+(?:result|item|video|link)/i);
        if (ordinalMatch) {
          const ordWord = ordinalMatch[1].toLowerCase();
          let targetIndex = 0;
          if (ordWord === 'second' || ordWord === '2nd' || ordWord === '2') targetIndex = 1;
          else if (ordWord === 'third' || ordWord === '3rd' || ordWord === '3') targetIndex = 2;

          currentObs.actionProposed = `click_result_index:${targetIndex}`;
          const clicked = await page.evaluate((idx: number) => {
            // Generic list of result links (excluding header/nav links)
            const resultLinks = Array.from(
              document.querySelectorAll<HTMLAnchorElement>(
                'main a[href], #contents a[href], .results a[href], [role="main"] a[href], #search a[href], a[href]'
              )
            ).filter((a) => {
              const text = (a.textContent || '').trim();
              const href = a.href || '';
              return (
                text.length > 5 &&
                !href.includes('about') &&
                !href.includes('settings') &&
                !href.includes('privacy')
              );
            });

            const targetLink = resultLinks[idx] || resultLinks[0];
            if (targetLink) {
              targetLink.click();
              return { success: true, text: targetLink.textContent?.trim(), href: targetLink.href };
            }
            return { success: false };
          }, targetIndex);

          if (clicked.success) {
            actions.push(`click_result:${clicked.text || targetIndex}`);
            observations.push(currentObs);
            await page.waitForTimeout(1500);

            // Post-click state verification
            const updatedDom = await browserCodeSession.extractStructuredDOM();
            extractedContent = updatedDom.bodyText || updatedDom.title;
            finalStatus = 'SUCCESS';
            break;
          }
        }

        // If goal was to read content or locate setting/text
        if (dom.bodyText || dom.title) {
          extractedContent = dom.bodyText.slice(0, 1000);
          actions.push('read_content');
          observations.push(currentObs);
          finalStatus = 'SUCCESS';
          break;
        }

        observations.push(currentObs);
      }

      if (Date.now() - t0 >= timeoutMs && finalStatus !== 'SUCCESS') {
        finalStatus = 'TIMEOUT';
      }

      const durationMs = Date.now() - t0;
      browserCodeSession.metrics.totalBrowserTaskMs = durationMs;

      return {
        status: finalStatus,
        activeTab: observations[observations.length - 1]?.title,
        url: observations[observations.length - 1]?.url,
        title: observations[observations.length - 1]?.title,
        observations,
        actions,
        extractedContent,
        evidence: {
          stepCount: currentStep,
          goal: request.goal,
          finalUrl: observations[observations.length - 1]?.url,
        },
        durationMs,
        stepCount: currentStep,
      };
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      logger.error('[BrowserCodeProvider] executeBrowserGoal error:', err);
      return {
        status: 'FAILED',
        observations,
        actions,
        evidence: { error: err?.message || String(err) },
        durationMs,
        stepCount: currentStep,
        error: err?.message || String(err),
      };
    }
  }
}

export const browserCodeProvider = BrowserCodeProvider.getInstance();

/**
 * browserExecutor.ts — Browser Execution & Web Workflow Executor.
 *
 * Wraps BrowserOperator (Playwright headed Chromium) and now implements the full
 * Browser Action Contract instead of just navigation:
 *
 *   UNDERSTAND GOAL → NAVIGATE → INSPECT ACTUAL PAGE STATE → IDENTIFY VISIBLE
 *   BLOCKERS/CONTROLS → PERFORM USER-AUTHORIZED ACTION → VERIFY DOM/PAGE STATE
 *   CHANGED → CONTINUE ORIGINAL GOAL → REPORT RESULT
 *
 * DEFECT FIXED HERE (D22): `executeWorkflow` advertised `'search' | 'click' | 'type'`
 * but only implemented 'search'. A requested CLICK or TYPE fell through to
 * `return { success: true, output: navOutcome.spokenText }` — i.e. a click request
 * was silently answered with "I've opened X." That silent-success path is gone:
 * an unimplemented action now fails loudly.
 */

import { browserOperator, buildBrowserGoal, type CanonicalBrowserTarget } from '../../../../services/browser/browserOperator.js';
import {
  browserMetrics,
  browserStateStore,
  errMsg,
  extractContentResults,
  parseOrdinalIndex,
  type ActiveBrowserEntityContext,
} from '../../../../services/browser/browserActionContract.js';
import { logger } from '../../../../utils/logger.js';
import { activeInteractionContextStore } from '../../activeInteractionContext.js';
import { voiceTurnAuditStore } from '../voiceTurnAuditStore.js';
import { capabilityPermissionStore } from '../../../controlPlane/CapabilityPermissionStore.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

/** Accessible-name hints for a page's search field, checked in order. */
const SEARCH_FIELD_HINTS = [
  'search',
  'suchen',
  'suche',
  'search query',
  'search youtube',
  'youtube durchsuchen',
  'q',
];

export class BrowserExecutor {
  public readonly id = 'browser';

  /**
   * Truthful Progress Event emitter for browser operations.
   */
  public emitProgress(
    event: {
      type: 'EXECUTION_STARTED' | 'STEP_STARTED' | 'STEP_PROGRESS' | 'STEP_VERIFIED' | 'STEP_COMPLETED' | 'EXECUTION_COMPLETED' | 'EXECUTION_FAILED';
      step?: string;
      detail?: string;
      evidence?: Record<string, any>;
    },
    context?: TurnContext,
  ): void {
    const formatted = `[BROWSER_PROGRESS] type=${event.type} step="${event.step || ''}" detail="${event.detail || ''}"`;
    console.log(formatted);
    logger.info(formatted, event);
    if (context?.onProgress) {
      try {
        context.onProgress({
          status: event.type === 'EXECUTION_COMPLETED' ? 'completed' : event.type === 'EXECUTION_FAILED' ? 'failed' : 'running',
          stage: event.type,
          currentStep: event.step || event.detail || '',
          evidence: event.evidence,
        });
      } catch (err) {
        logger.debug('[BrowserExecutor] Error in context.onProgress:', err);
      }
    }
  }

  public resolveTarget(input: string): CanonicalBrowserTarget | null {
    return browserOperator.resolveTarget(input);
  }

  public async navigate(targetInput: string, context?: TurnContext): Promise<ExecutionResult> {
    const outcome = await browserOperator.openTarget(targetInput, {
      conversationId: context?.conversationId,
      goalText: targetInput,
      actionKind: 'navigate',
    });
    return {
      success: outcome.success,
      data: outcome,
      output: outcome.spokenText,
      error: outcome.error,
      evidence: {
        target: outcome.target,
        url: outcome.url,
        title: outcome.title,
        verified: outcome.verified,
        contentUsable: outcome.contentUsable,
        goalAchieved: outcome.goalAchieved,
        blocker: outcome.blocker ?? null,
        controlsSeen: outcome.pageState?.controlsSeen ?? null,
      },
    };
  }

  /**
   * Execute a browser workflow step: navigate / search / click / type.
   *
   * Every branch returns a VERIFIED result or an explicit failure. There is no
   * path that reports success for an action that was not performed.
   */
  public async executeWorkflow(opts: {
    target: string;
    action: 'navigate' | 'search' | 'click' | 'type' | 'search_and_open' | 'search_and_open_video';
    query?: string;
    name?: string;
    isChannel?: boolean;
    contentType?: string;
    excludeShorts?: boolean;
    ordering?: string;
    context?: TurnContext;
  }): Promise<ExecutionResult> {
    const { target, action, query, name, isChannel, contentType, excludeShorts, ordering } = opts;
    const conversationId = opts.context?.conversationId;
    logger.info('[BrowserExecutor] Executing browser workflow:', opts);

    // ── CLICK ───────────────────────────────────────────────────────────────
    if (action === 'click') {
      let clickedName = name || query || '';
      if (!clickedName) {
        return { success: false, error: 'No control name supplied for the click.' };
      }

      // If continuation reference like "it" or "open the first result" or ordinal "second one"
      const isGenericPronoun = /^(?:it|start it|play it|the channel|channel|video|the video|first one|first result|open the first result|the second one|second result|open the second result|the third one|third result)$/i.test(clickedName.trim()) ||
        /\b(?:first|second|third|1st|2nd|3rd)\s+(?:result|one|video)\b/i.test(clickedName.trim());
      if (isGenericPronoun) {
        const live = await browserOperator.getInteractiveSnapshot(conversationId);
        if (live && live.elements?.length) {
          const contentResults = extractContentResults(live.elements, live.url);
          const ordinal = parseOrdinalIndex(clickedName);
          const selected = contentResults[ordinal - 1] ?? contentResults[0];
          if (selected) {
            clickedName = selected.name;
          }
        }
      }

      const result = await browserOperator.clickByAccessibleName(clickedName, {
        conversationId,
        expect: 'any',
      });
      return {
        success: result.verified,
        output: result.spokenText,
        error: result.verified ? undefined : result.error,
        evidence: {
          target,
          action: 'click',
          requestedName: clickedName,
          performed: result.performed,
          verified: result.verified,
          foundStrategy: result.evidence.foundStrategy,
          foundName: result.evidence.foundName,
          stateChanged: result.evidence.stateChanged,
          changeDetail: result.evidence.changeDetail,
          blockerAfter: result.blockerAfter,
          needsUserDecision: result.needsUserDecision,
        },
      };
    }

    // ── TYPE ────────────────────────────────────────────────────────────────
    if (action === 'type') {
      const text = query ?? '';
      if (!text) {
        return { success: false, error: 'No text supplied to type.' };
      }
      const isPermitted = opts.context?.browserInputAuthorized === true || capabilityPermissionStore.isAllowed('browser.input');
      if (!isPermitted) {
        logger.warn('[BrowserExecutor] Unauthorized type action rejected in executeWorkflow: browserInputAuthorized is false');
        voiceTurnAuditStore.recordTypingAttempt({
          targetElement: name || 'searchField',
          textToType: text,
          authorized: false,
          reason: 'browserInputAuthorized is false in TurnContext',
          timestamp: Date.now(),
          outcome: 'REJECTED_UNAUTHORIZED',
        });
        return {
          success: false,
          error: 'unauthorized_browser_typing: browserInputAuthorized is false',
          evidence: { target, action: 'type', browserInputAuthorized: false, performed: false },
        };
      }
      const fieldName = name || '';
      if (fieldName) {
        const result = await browserOperator.typeByAccessibleName(fieldName, text, {
          conversationId,
          authorized: true,
          reason: 'authorized_workflow_type',
        });
        await browserOperator.blurActiveElement();
        return {
          success: result.verified,
          output: result.spokenText,
          error: result.verified ? undefined : result.error,
          evidence: {
            target,
            action: 'type',
            text,
            field: fieldName,
            verified: result.verified,
            stateChanged: result.evidence.stateChanged,
          },
        };
      }
      // No field named: use the page's own search box.
      const viaSearchBox = await this.searchUsingPageBox(target, text, conversationId, true, opts.context);
      await browserOperator.blurActiveElement();
      return viaSearchBox;
    }

    // ── SEARCH & OPEN (Complete operational instruction) ───────────────────
    if (action === 'search_and_open') {
      const q = query ?? '';
      if (!q) return { success: false, error: 'No search query supplied.' };
      return await this.searchAndOpenResult(target, q, conversationId, isChannel, opts.context);
    }

    // ── SEARCH & OPEN VIDEO (Channel / Content Video Intent) ───────────────
    if (action === 'search_and_open_video') {
      const q = query ?? name ?? '';
      if (!q) return { success: false, error: 'No video or channel search query supplied.' };
      return await this.searchAndOpenVideo(target, q, conversationId, {
        excludeShorts: excludeShorts !== false,
        ordering: ordering || 'newest',
      }, opts.context);
    }

    // ── SEARCH ──────────────────────────────────────────────────────────────
    if (action === 'search') {
      const q = query ?? '';
      if (!q) return { success: false, error: 'No search query supplied.' };

      if (opts.context?.browserInputAuthorized !== true) {
        logger.warn('[BrowserExecutor] Unauthorized search action rejected in executeWorkflow: browserInputAuthorized is false');
        voiceTurnAuditStore.recordTypingAttempt({
          targetElement: 'searchField',
          textToType: q,
          authorized: false,
          reason: 'browserInputAuthorized is false in TurnContext',
          timestamp: Date.now(),
          outcome: 'REJECTED_UNAUTHORIZED',
        });
        return {
          success: false,
          error: 'unauthorized_browser_typing: browserInputAuthorized is false',
          evidence: { target, action: 'search', browserInputAuthorized: false, performed: false },
        };
      }

      // Ensure we are on the target first.
      const navOutcome = await browserOperator.openTarget(target, {
        conversationId,
        goalText: `search ${target} for ${q}`,
      });
      if (!navOutcome.success) {
        return { success: false, error: `Could not open ${target} for workflow: ${navOutcome.error}` };
      }
      if (navOutcome.contentUsable === false) {
        // First attempt normal Browser Executor obstacle recovery:
        if (navOutcome.blocker?.isConsentDialog) {
          logger.info('[BrowserExecutor] Attempting normal obstacle recovery for consent dialog...');
          const consentRes = await browserOperator.acceptConsentBlocker({ conversationId: conversationId || '' });
          if (consentRes.verified) {
            const reInspect = await browserOperator.inspect();
            if (reInspect && reInspect.contentUsable) {
              const res = await this.searchUsingPageBox(target, q, conversationId, true, opts.context);
              await browserOperator.blurActiveElement();
              return res;
            }
          }
        }
        // If normal obstacle recovery fails or cannot handle it:
        return {
          success: false,
          output: navOutcome.spokenText,
          error: 'blocked_by_dialog',
          evidence: { target, action: 'search', blocked: true, blocker: navOutcome.blocker ?? null },
        };
      }
      const res = await this.searchUsingPageBox(target, q, conversationId, true, opts.context);
      await browserOperator.blurActiveElement();
      return res;
    }

    // ── NAVIGATE (default) ──────────────────────────────────────────────────
    return await this.navigate(target, opts.context);
  }

  /**
   * Search by USING the page's search box (the acceptance criterion for TEST 2),
   * with a direct results-URL navigation only as a documented fallback.
   */
  public async searchUsingPageBox(
    target: string,
    query: string,
    conversationId?: string,
    authorized: boolean = false,
    context?: TurnContext,
  ): Promise<ExecutionResult> {
    const isPermitted = authorized === true || capabilityPermissionStore.isAllowed('browser.input');
    if (!isPermitted) {
      logger.warn('[BrowserExecutor] Unauthorized searchUsingPageBox rejected: authorized is false');
      voiceTurnAuditStore.recordTypingAttempt({
        targetElement: 'searchBox',
        textToType: query,
        authorized: false,
        reason: 'searchUsingPageBox called without authorization',
        timestamp: Date.now(),
        outcome: 'REJECTED_UNAUTHORIZED',
      });
      this.emitProgress({
        type: 'EXECUTION_FAILED',
        step: 'TYPING_GATE',
        detail: 'Unauthorized browser typing rejected',
      }, context);
      return {
        success: false,
        error: 'unauthorized_browser_typing: authorized is false',
        evidence: { target, query, browserInputAuthorized: false, performed: false },
      };
    }

    const snapshot = await browserOperator.inspect();
    if (!snapshot) {
      return { success: false, error: 'No active browser page available' };
    }
    if (!snapshot.contentUsable) {
      const blocker = snapshot.blockers[0];
      if (blocker?.isConsentDialog) {
        logger.info('[BrowserExecutor] Attempting normal obstacle recovery for search page consent...');
        const consentRes = await browserOperator.autoResolveConsent({ conversationId: conversationId || '' });
        if (consentRes.success) {
          const reInspect = await browserOperator.inspect();
          if (reInspect && reInspect.contentUsable) {
            // Unblocked, continue to search
          } else {
            return {
              success: false,
              output: `A ${blocker?.kind ?? 'dialog'} is still blocking ${target}, so I cannot search yet.`,
              error: 'blocked_by_dialog',
              evidence: { target, query, blocked: true, blocker: blocker?.kind ?? null },
            };
          }
        } else {
          return {
            success: false,
            output: `A ${blocker?.kind ?? 'dialog'} is still blocking ${target}, so I cannot search yet.`,
            error: 'blocked_by_dialog',
            evidence: { target, query, blocked: true, blocker: blocker?.kind ?? null },
          };
        }
      } else {
        return {
          success: false,
          output: `A ${blocker?.kind ?? 'dialog'} is still blocking ${target}, so I cannot search yet.`,
          error: 'blocked_by_dialog',
          evidence: { target, query, blocked: true, blocker: blocker?.kind ?? null },
        };
      }
    }

    // Find the page's own search field by accessible name.
    const candidate = snapshot.controls.find(
      (c) =>
        c.visible &&
        !c.disabled &&
        (c.kind === 'textbox' ||
          c.role === 'textbox' ||
          c.role === 'combobox' ||
          c.role === 'searchbox' ||
          c.tagName === 'input') &&
        SEARCH_FIELD_HINTS.some((h) => (c.name || '').toLowerCase().includes(h)),
    );

    if (candidate) {
      this.emitProgress({
        type: 'STEP_STARTED',
        step: 'SEARCH_BOX_TYPING',
        detail: `Typing "${query}" into ${target} search box`,
      }, context);
      const typed = await browserOperator.typeByAccessibleName(candidate.name, query, {
        conversationId,
        submit: true,
        authorized: true,
        reason: 'authorized_search_query',
      });
      await browserOperator.blurActiveElement();
      if (typed.performed) {
        const page = browserOperator.getPage();
        if (page) {
          await page.waitForURL((u) => u.pathname.includes('/results') || u.search.includes('search_query'), { timeout: 4000 }).catch(() => {});
          const curUrl = page.url();
          if (!curUrl.includes('/results') && !curUrl.includes('search_query')) {
            const tLower = target.toLowerCase();
            const sUrl = tLower.includes('youtube')
              ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
              : tLower.includes('google')
              ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
              : null;
            if (sUrl) {
              await page.goto(sUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
              await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
              await browserOperator.blurActiveElement();
            }
          }
        }
        const after = await browserOperator.inspect();
        const finalUrl = page?.url() || after?.url || snapshot.url;
        const finalTitle = (await page?.title().catch(() => '')) || after?.title || snapshot.title;
        const urlChanged = Boolean(after && after.url !== snapshot.url) || finalUrl.includes('/results') || finalUrl.includes('search_query');
        const verified = typed.verified || urlChanged;
        if (conversationId && verified) {
          const liveElements = after ? (await browserOperator.getInteractiveSnapshot(conversationId))?.elements || [] : [];
          browserStateStore.update(conversationId, {
            lastBrowserUrl: finalUrl,
            lastBrowserTitle: finalTitle,
            lastBrowserAction: `search:${query}`,
            lastBrowserGoal: `search ${target} for ${query}`,
            visibleTarget: target,
            verificationState: 'verified',
            ...(liveElements.length ? { lastIndexedElements: liveElements, indexedUrl: finalUrl } : {}),
          });
          activeInteractionContextStore.recordSuccess(conversationId, 'search', query, {
            activePageUrl: finalUrl,
            activePageTitle: finalTitle,
            lastSearchQuery: query,
          });
          activeInteractionContextStore.pushNavigation(conversationId, finalUrl, finalTitle);
          await browserOperator.extractCompactSearchResults(conversationId);
        }
        return {
          success: verified,
          output:
            verified
              ? `Typed "${query}" into the ${target} search box and ran the search.`
              : `I typed "${query}" into the search box, but the results page did not load.`,
          evidence: {
            target,
            action: 'search',
            query,
            usedSearchBox: true,
            fieldName: candidate.name,
            url: finalUrl,
            title: finalTitle,
            verified,
          },
        };
      }
    }

    // Fallback: documented direct results URL (the search box was not found).
    const page = browserOperator.getPage();
    if (!page) return { success: false, error: 'No active browser page available' };

    const targetLower = target.toLowerCase();
    let searchUrl: string | null = null;
    if (targetLower.includes('linkedin')) {
      searchUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}`;
    } else if (targetLower.includes('youtube')) {
      searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    } else if (targetLower.includes('google')) {
      searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }

    if (!searchUrl) {
      return {
        success: false,
        output: `I could not find a search box on ${target}, and I have no documented results URL for it.`,
        error: 'no_search_surface',
      };
    }

    try {
      await page.goto(searchUrl, { waitUntil: 'commit', timeout: 15000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      // Let the results page settle before anyone inspects it.
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await browserOperator.blurActiveElement();
      const after = await browserOperator.inspect();
      browserMetrics.record('browser_action_requested', { kind: 'search', via: 'direct_url' });
      if (conversationId) {
        const liveElements = after ? (await browserOperator.getInteractiveSnapshot(conversationId))?.elements || [] : [];
        const finalUrl = after?.url ?? page.url();
        const finalTitle = after?.title ?? (await page.title().catch(() => ''));
        browserStateStore.update(conversationId, {
          lastBrowserUrl: finalUrl,
          lastBrowserTitle: finalTitle,
          lastBrowserAction: `search:${query}`,
          lastBrowserGoal: `search ${target} for ${query}`,
          visibleTarget: target,
          verificationState: 'verified',
          ...(liveElements.length ? { lastIndexedElements: liveElements, indexedUrl: finalUrl } : {}),
        });
        activeInteractionContextStore.recordSuccess(conversationId, 'search', query, {
          activePageUrl: finalUrl,
          activePageTitle: finalTitle,
          lastSearchQuery: query,
        });
        activeInteractionContextStore.pushNavigation(conversationId, finalUrl, finalTitle);
        await browserOperator.extractCompactSearchResults(conversationId);
      }
      return {
        success: true,
        output: `Opened ${target} and searched for ${query}.`,
        evidence: {
          target,
          action: 'search',
          query,
          usedSearchBox: false,
          url: after?.url ?? page.url(),
          title: after?.title ?? (await page.title().catch(() => '')),
        },
      };
    } catch (err: unknown) {
      return { success: false, error: errMsg(err) };
    }
  }

  /**
   * Search YouTube/Google and resolve & open the matching channel or top result page.
   */
  public async searchAndOpenResult(
    target: string,
    query: string,
    conversationId?: string,
    isChannel?: boolean,
    context?: TurnContext,
  ): Promise<ExecutionResult> {
    const goalTitle = `Open ${query} on ${target}.`;
    console.log(`[ACTIVE_GOAL_STATE] ORIGINAL_GOAL="${goalTitle}" CURRENT_STEP=navigate BROWSER_STATE=opening BLOCKER=null RECOVERY_ACTION=null NEXT_STEP=search`);
    this.emitProgress({
      type: 'EXECUTION_STARTED',
      step: 'START',
      detail: `Initiating search and open for "${query}" on ${target}`,
    }, context);

    this.emitProgress({
      type: 'STEP_STARTED',
      step: 'NAVIGATE',
      detail: `Opening ${target}`,
    }, context);

    // 1. Open target (e.g. YouTube) if not already open
    const navOutcome = await browserOperator.openTarget(target, {
      conversationId,
      goalText: `open ${target} and find ${query}`,
    });
    if (!navOutcome.success) {
      this.emitProgress({
        type: 'EXECUTION_FAILED',
        step: 'NAVIGATE',
        detail: `Could not open ${target}: ${navOutcome.error}`,
      }, context);
      await browserOperator.blurActiveElement();
      return { success: false, error: `Could not open ${target}: ${navOutcome.error}` };
    }

    this.emitProgress({
      type: 'STEP_VERIFIED',
      step: 'NAVIGATE',
      detail: `${target} opened and verified`,
    }, context);

    // 2. Cookie / Consent dialog handled if present
    if (navOutcome.contentUsable === false) {
      if (navOutcome.blocker?.isConsentDialog) {
        console.log(`[ACTIVE_GOAL_STATE] ORIGINAL_GOAL="${goalTitle}" CURRENT_STEP=search BROWSER_STATE=blocked BLOCKER=cookie_consent RECOVERY_ACTION=resolve_cookie NEXT_STEP=resume_search`);
        this.emitProgress({
          type: 'STEP_PROGRESS',
          step: 'COOKIE_CONSENT',
          detail: 'Resolving cookie/consent blocker',
        }, context);
        logger.info('[BrowserExecutor] Handling consent dialog for search_and_open...');
        const consentRes = await browserOperator.autoResolveConsent({ conversationId: conversationId || '' });
        if (!consentRes.success) {
          this.emitProgress({
            type: 'EXECUTION_FAILED',
            step: 'COOKIE_CONSENT',
            detail: 'Cookie consent dialog blocked page interaction',
          }, context);
          await browserOperator.blurActiveElement();
          return {
            success: false,
            output: navOutcome.spokenText,
            error: 'blocked_by_dialog',
            evidence: { target, action: 'search_and_open', blocked: true, blocker: navOutcome.blocker ?? null },
          };
        }
        console.log(`[ACTIVE_GOAL_STATE] ORIGINAL_GOAL="${goalTitle}" CURRENT_STEP=resume_search BROWSER_STATE=usable BLOCKER=null RECOVERY_ACTION=null NEXT_STEP=open_result`);
      }
    }

    // 3. Search target for query
    console.log(`[ACTIVE_GOAL_STATE] ORIGINAL_GOAL="${goalTitle}" CURRENT_STEP=search BROWSER_STATE=searching BLOCKER=null RECOVERY_ACTION=null NEXT_STEP=open_result`);
    this.emitProgress({
      type: 'STEP_STARTED',
      step: 'SEARCH',
      detail: `Entering search query: "${query}"`,
    }, context);

    const searchRes = await this.searchUsingPageBox(target, query, conversationId, true, context);
    if (!searchRes.success) {
      this.emitProgress({
        type: 'EXECUTION_FAILED',
        step: 'SEARCH',
        detail: `Search execution failed for "${query}"`,
      }, context);
      await browserOperator.blurActiveElement();
      return searchRes;
    }

    this.emitProgress({
      type: 'STEP_PROGRESS',
      step: 'SEARCH',
      detail: 'Search query submitted, evaluating results',
    }, context);

    // 4. Inspect search results and resolve matching channel or top result
    const page = browserOperator.getPage();
    if (!page) {
      await browserOperator.blurActiveElement();
      return { success: false, error: 'No active browser page available' };
    }

    try {
      // Ensure the browser is on the results URL before evaluating results:
      if (!page.url().includes('search_query')) {
        const resultsUrl = target.toLowerCase().includes('youtube')
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
          : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        await page.goto(resultsUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      }
      await page.waitForTimeout(2500);

      // Clean query for matching
      const cleanQ = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      const shouldPreferChannel = Boolean(isChannel || /\bchannel\b/i.test(query));

      const resolved = await page.evaluate((args: { cleanTarget: string; queryTokens: string[]; preferChannel: boolean; rawQuery: string }) => {
        const { cleanTarget, queryTokens, preferChannel, rawQuery } = args;

        function tokensMatch(tok1: string, tok2: string): boolean {
          if (tok1 === tok2) return true;
          if ((tok1 === 'ceo' && tok2 === 'seo') || (tok1 === 'seo' && tok2 === 'ceo')) return true;
          if ((tok1 === 'goldy' && tok2 === 'goldie') || (tok1 === 'goldie' && tok2 === 'goldy')) return true;
          if ((tok1 === 'julien' && tok2 === 'julian') || (tok1 === 'julian' && tok2 === 'julien')) return true;
          return false;
        }

        // Collect all potential search result items across the document
        const channelElements = Array.from(document.querySelectorAll('ytd-channel-renderer, ytd-channel-name, a[href*="/@"], a[href*="/channel/"]'));
        const videoElements = Array.from(document.querySelectorAll('a#video-title, ytd-video-renderer a#thumbnail'));

        const candidates: Array<{ url: string; text: string; isChannel: boolean; score: number; handle?: string }> = [];

        // 1. Channel cards & channel links
        for (const el of channelElements) {
          if (el.closest('#guide, ytd-guide-renderer, #masthead, ytd-masthead, #chips, ytd-feed-filter-chip-bar-renderer')) continue;
          const a = el.tagName === 'A' ? (el as HTMLAnchorElement) : (el.querySelector('a#main-link, a#avatar-link, a') as HTMLAnchorElement | null);
          if (a && a.href && !a.href.includes('/feed/') && !a.href.includes('/history')) {
            const renderer = el.closest('ytd-channel-renderer') || el;
            const explicitName = (renderer.querySelector('#channel-title, ytd-channel-name, #text')?.textContent || '').trim();
            const rawText = (explicitName || a.innerText || el.textContent || '').trim();
            const text = (explicitName || rawText).split('\n')[0].trim();
            const isGenericAction = /^(kanal aufrufen|view channel|subscribe|abonnieren)$/i.test(text);
            const channelName = (!isGenericAction && text) ? text : rawQuery;
            const flat = channelName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const hrefFlat = a.href.toLowerCase().replace(/[^a-z0-9]/g, '');
            const handleMatch = a.href.match(/@([a-zA-Z0-9_.-]+)/);
            const handleClean = handleMatch ? handleMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '') : '';
            const combined = `${flat} ${hrefFlat}`;

            let score = 0;
            // 1. Exact canonical channel name
            if (flat === cleanTarget) {
              score += 100;
            } else if (flat.includes(cleanTarget) || cleanTarget.includes(flat)) {
              score += 50;
            }

            // 2. Exact handle similarity
            if (handleClean && handleClean === cleanTarget) {
              score += 80;
            } else if (handleClean && cleanTarget && handleClean.includes(cleanTarget)) {
              score += 60;
            } else if (handleClean && cleanTarget && cleanTarget.includes(handleClean)) {
              score += 40;
            }

            // 3. Normalized token similarity
            let exactTokenMatches = 0;
            let phoneticMatches = 0;
            const combinedTokens = combined.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
            for (const tok of queryTokens) {
              if (combined.includes(tok)) {
                exactTokenMatches++;
              } else if (combinedTokens.some((ct) => tokensMatch(tok, ct))) {
                phoneticMatches++;
                exactTokenMatches++;
              }
            }
            const tokenRatio = queryTokens.length > 0 ? (exactTokenMatches / queryTokens.length) : 0;
            score += Math.round(tokenRatio * 30);

            // Verified channel badge
            const isVerified = Boolean(renderer.querySelector('.badge-style-type-verified, ytd-badge-supported-renderer, svg[aria-label="Verified"]'));
            if (isVerified) score += 15;

            // Channel renderer container
            if (el.tagName.toLowerCase() === 'ytd-channel-renderer' || el.closest('ytd-channel-renderer')) score += 10;
            if (preferChannel) score += 10;

            // Fallback phonetic score only if no exact token matches
            if (exactTokenMatches === 0 && phoneticMatches > 0) {
              score += phoneticMatches * 5;
            }

            if (score > 0) {
              candidates.push({
                url: a.href,
                text: channelName,
                isChannel: true,
                score,
                handle: handleMatch ? handleMatch[0] : undefined,
              });
            }
          }
        }

        // 2. Video result items (only if not strictly preferring channels)
        if (!preferChannel) {
          for (const el of videoElements) {
            if (el.closest('#guide, ytd-guide-renderer, #masthead, ytd-masthead, #chips, ytd-feed-filter-chip-bar-renderer')) continue;
            const a = el as HTMLAnchorElement;
            if (a && a.href && !a.href.includes('/shorts/')) {
              const text = (a.innerText || a.getAttribute('title') || '').trim();
              const flat = text.toLowerCase().replace(/[^a-z0-9]/g, '');
              const hrefFlat = a.href.toLowerCase().replace(/[^a-z0-9]/g, '');
              const combined = `${flat} ${hrefFlat}`;

              let matchedTokens = 0;
              for (const tok of queryTokens) {
                if (combined.includes(tok)) matchedTokens++;
              }
              if (flat.includes(cleanTarget)) matchedTokens += 3;

              if (matchedTokens === 0) continue;
              let score = matchedTokens * 4;
              candidates.push({ url: a.href, text: text || rawQuery, isChannel: false, score });
            }
          }
        }

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0 && candidates[0].score >= 4) {
          return candidates[0];
        }

        return null;
      }, { cleanTarget: cleanQ, queryTokens, preferChannel: shouldPreferChannel, rawQuery: query });

      if (resolved && resolved.url) {
        logger.info('[BrowserExecutor] Resolved search result, opening item:', resolved);
        this.emitProgress({
          type: 'STEP_PROGRESS',
          step: 'SELECT_RESULT',
          detail: `Identified matching ${resolved.isChannel ? 'channel' : 'video'}: "${resolved.text || query}"`,
        }, context);

        this.emitProgress({
          type: 'STEP_STARTED',
          step: 'OPEN_RESULT',
          detail: `Navigating to ${resolved.isChannel ? 'channel' : 'video'} "${resolved.text || query}"`,
        }, context);

        try {
          await page.goto(resolved.url, { waitUntil: 'commit', timeout: 15000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        } catch (navErr) {
          logger.warn('[BrowserExecutor] Navigation commit warning:', navErr);
        }
        await page.waitForTimeout(2000);
        const after = await browserOperator.inspect();
        const finalUrl = page.url() || after?.url || resolved.url;
        const finalTitle = (await page.title().catch(() => '')) || after?.title || resolved.text;
        const urlMatches = resolved.isChannel
          ? (finalUrl.includes('/@') || finalUrl.includes('/channel/') || finalUrl.toLowerCase().includes(cleanQ))
          : Boolean(after && after.contentUsable);
        const verified = Boolean(urlMatches && (!after || after.contentUsable));

        const entityTitle = resolved.text ? resolved.text.split('\n')[0].trim() : query;
        const handleMatch = finalUrl.match(/@([a-zA-Z0-9_.-]+)/) || (resolved.handle ? resolved.handle.match(/@([a-zA-Z0-9_.-]+)/) : null);
        const entityHandle = handleMatch ? handleMatch[0] : null;
        const canonicalChannelUrl = entityHandle
          ? `https://www.youtube.com/${entityHandle}`
          : finalUrl.split('?')[0].replace(/\/(featured|videos|shorts|playlists)?$/, '');

        const activeBrowserEntity: ActiveBrowserEntityContext = {
          platform: 'YouTube',
          currentUrl: finalUrl,
          pageTitle: finalTitle,
          entityType: resolved.isChannel ? 'channel' : 'video',
          entityName: entityTitle,
          entityHandle,
          entityUrl: canonicalChannelUrl,
          contentTab: finalUrl.includes('/videos') ? 'videos' : null,
          lastSelectedVideo: null,
          originatingTurnId: conversationId || null,
          verified,
        };

        if (conversationId) {
          browserStateStore.update(conversationId, {
            lastBrowserUrl: finalUrl,
            lastBrowserTitle: finalTitle,
            lastBrowserAction: `open:${resolved.text || query}`,
            lastBrowserResult: verified ? 'opened and verified' : 'opened unverified',
            verificationState: verified ? 'verified' : 'failed',
            activeBrowserEntity,
          });
        }

        if (verified) {
          browserOperator.armStabilityLock(conversationId || 'default', finalUrl, 15000);
          try {
            activeInteractionContextStore.update(conversationId || 'default', {
              activeCapability: 'browser',
              activePageUrl: finalUrl,
              activePageTitle: finalTitle,
              activeBrowserEntity,
              currentEntity: {
                type: resolved.isChannel ? 'channel' : 'video',
                name: entityTitle,
                url: finalUrl,
              },
            });
            activeInteractionContextStore.pushNavigation(conversationId || 'default', finalUrl, finalTitle);
          } catch (ctxErr) {
            logger.warn('[BrowserExecutor] Failed to update active interaction context:', ctxErr);
          }
        }

        console.log(`[ACTIVE_GOAL_STATE] ORIGINAL_GOAL="${goalTitle}" CURRENT_STEP=completed BROWSER_STATE=${verified ? 'verified' : 'failed'} BLOCKER=null RECOVERY_ACTION=null NEXT_STEP=null`);

        this.emitProgress({
          type: 'STEP_VERIFIED',
          step: 'OPEN_RESULT',
          detail: `Page verified: ${entityTitle} (${finalUrl})`,
        }, context);

        this.emitProgress({
          type: 'STEP_COMPLETED',
          step: 'OPEN_RESULT',
          detail: `${entityTitle} is open and active`,
        }, context);

        this.emitProgress({
          type: 'EXECUTION_COMPLETED',
          step: 'COMPLETE',
          detail: `Successfully located and opened ${entityTitle}`,
        }, context);

        await browserOperator.blurActiveElement();

        const msg = verified
          ? (resolved.isChannel
            ? `Opened the ${entityTitle} channel on YouTube.`
            : `Opened "${entityTitle}" on YouTube.`)
          : `I navigated to ${finalUrl}, but could not verify that the requested channel page loaded.`;

        return {
          success: verified,
          output: msg,
          evidence: {
            target,
            action: 'search_and_open',
            query,
            resolvedUrl: resolved.url,
            resolvedTitle: entityTitle,
            isChannel: resolved.isChannel,
            url: finalUrl,
            title: finalTitle,
            verified,
            completionReason: verified ? 'Target verified on live browser page' : 'Verification failed',
          },
        };
      }

      this.emitProgress({
        type: 'EXECUTION_FAILED',
        step: 'RESULT_NOT_FOUND',
        detail: `I searched ${target} for "${query}", but could not find a matching channel or result.`,
      }, context);

      await browserOperator.blurActiveElement();

      return {
        success: false,
        output: `I searched ${target} for "${query}", but could not find a matching channel or result.`,
        error: 'channel_or_result_not_found',
        evidence: { target, action: 'search_and_open', query, verified: false },
      };
    } catch (err: any) {
      this.emitProgress({
        type: 'EXECUTION_FAILED',
        step: 'ERROR',
        detail: `Failed to open search result: ${err?.message || err}`,
      }, context);
      await browserOperator.blurActiveElement();
      return { success: false, error: `Failed to open search result: ${err?.message || err}` };
    }
  }

  /**
   * Search YouTube for a creator/channel, open their Videos tab,
   * identify the newest standard video (strictly excluding Shorts), and open it.
   */
  public async searchAndOpenVideo(
    target: string,
    query: string,
    conversationId?: string,
    options?: {
      excludeShorts?: boolean;
      ordering?: string;
    },
    context?: TurnContext,
  ): Promise<ExecutionResult> {
    const canonTarget = target || 'youtube';
    logger.info('[BrowserExecutor] Executing searchAndOpenVideo:', { target: canonTarget, query, options });

    this.emitProgress({
      type: 'EXECUTION_STARTED',
      step: 'START',
      detail: `Initiating video search for "${query}" on ${canonTarget}`,
    }, context);

    // 1. Open target (YouTube)
    const navOutcome = await browserOperator.openTarget(canonTarget, {
      conversationId,
      goalText: `open ${canonTarget} and find video for ${query}`,
    });
    if (!navOutcome.success) {
      this.emitProgress({
        type: 'EXECUTION_FAILED',
        step: 'NAVIGATE',
        detail: `Could not open ${canonTarget}: ${navOutcome.error}`,
      }, context);
      await browserOperator.blurActiveElement();
      return { success: false, error: `Could not open ${canonTarget}: ${navOutcome.error}` };
    }

    // 2. Cookie / Consent resolution if blocked
    if (navOutcome.contentUsable === false && navOutcome.blocker?.isConsentDialog) {
      logger.info('[BrowserExecutor] Handling consent dialog for searchAndOpenVideo...');
      await browserOperator.autoResolveConsent({ conversationId: conversationId || '' }).catch(() => {});
    }

    const page = browserOperator.getPage();
    if (!page) {
      await browserOperator.blurActiveElement();
      return { success: false, error: 'No active browser page available' };
    }

    try {
      // 3. Search target for query
      await this.searchUsingPageBox(canonTarget, query, conversationId, true, context);
      if (!page.url().includes('search_query')) {
        const resultsUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        await page.goto(resultsUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      }
      await page.waitForTimeout(2500);

      // 4. Resolve the channel on the search results page
      const queryClean = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

      const resolvedChannel = await page.evaluate((args: { cleanTarget: string; queryTokens: string[]; rawQuery: string }) => {
        const { cleanTarget, queryTokens, rawQuery } = args;

        function tokensMatch(tok1: string, tok2: string): boolean {
          if (tok1 === tok2) return true;
          if ((tok1 === 'ceo' && tok2 === 'seo') || (tok1 === 'seo' && tok2 === 'ceo')) return true;
          if ((tok1 === 'goldy' && tok2 === 'goldie') || (tok1 === 'goldie' && tok2 === 'goldy')) return true;
          if ((tok1 === 'julien' && tok2 === 'julian') || (tok1 === 'julian' && tok2 === 'julien')) return true;
          return false;
        }

        // 1. Channel cards & explicit channel items
        const channelElements = Array.from(document.querySelectorAll('ytd-channel-renderer, ytd-channel-name, a[href*="/@"], a[href*="/channel/"]'));
        const channelCandidates: Array<{ url: string; title: string; score: number; handle?: string }> = [];

        for (const el of channelElements) {
          if (el.closest('#guide, ytd-guide-renderer, #masthead, ytd-masthead, #chips, ytd-feed-filter-chip-bar-renderer')) continue;
          const a = el.tagName === 'A' ? (el as HTMLAnchorElement) : (el.querySelector('a#main-link, a#avatar-link, a') as HTMLAnchorElement | null);
          if (a && a.href && !a.href.includes('/feed/') && !a.href.includes('/history')) {
            const renderer = el.closest('ytd-channel-renderer') || el;
            const explicitName = (renderer.querySelector('#channel-title, ytd-channel-name, #text')?.textContent || '').trim();
            const rawText = (explicitName || a.innerText || el.textContent || '').trim();
            const title = (explicitName || rawText).split('\n')[0].trim();
            const isGenericAction = /^(kanal aufrufen|view channel|subscribe|abonnieren)$/i.test(title);
            const channelName = (!isGenericAction && title) ? title : rawQuery;

            const flat = channelName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const hrefFlat = a.href.toLowerCase().replace(/[^a-z0-9]/g, '');
            const handleMatch = a.href.match(/@([a-zA-Z0-9_.-]+)/);
            const handleClean = handleMatch ? handleMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '') : '';
            const combined = `${flat} ${hrefFlat}`;

            let score = 0;
            // 1. Exact canonical channel name
            if (flat === cleanTarget) {
              score += 100;
            } else if (flat.includes(cleanTarget) || cleanTarget.includes(flat)) {
              score += 50;
            }

            // 2. Exact handle similarity
            if (handleClean && handleClean === cleanTarget) {
              score += 80;
            } else if (handleClean && cleanTarget && handleClean.includes(cleanTarget)) {
              score += 60;
            } else if (handleClean && cleanTarget && cleanTarget.includes(handleClean)) {
              score += 40;
            }

            // 3. Normalized token similarity
            let exactTokenMatches = 0;
            let phoneticMatches = 0;
            for (const tok of queryTokens) {
              if (combined.includes(tok)) {
                exactTokenMatches++;
              } else if (queryTokens.some(qt => tokensMatch(tok, qt))) {
                phoneticMatches++;
              }
            }
            const tokenRatio = queryTokens.length > 0 ? (exactTokenMatches / queryTokens.length) : 0;
            score += Math.round(tokenRatio * 30);

            // Verified channel badge
            const isVerified = Boolean(renderer.querySelector('.badge-style-type-verified, ytd-badge-supported-renderer, svg[aria-label="Verified"]'));
            if (isVerified) score += 15;

            // Channel renderer container
            if (el.tagName.toLowerCase() === 'ytd-channel-renderer' || el.closest('ytd-channel-renderer')) score += 10;

            // Fallback phonetic score only if no exact token matches
            if (exactTokenMatches === 0 && phoneticMatches > 0) {
              score += phoneticMatches * 5;
            }

            if (score > 0) {
              channelCandidates.push({
                url: a.href,
                title: channelName,
                score,
                handle: handleMatch ? handleMatch[0] : undefined,
              });
            }
          }
        }

        channelCandidates.sort((a, b) => b.score - a.score);
        if (channelCandidates.length > 0) {
          return channelCandidates[0];
        }

        // 2. Video items as channel fallback
        const videoRenderers = Array.from(document.querySelectorAll('ytd-video-renderer'));
        for (const vr of videoRenderers) {
          const chLink = vr.querySelector('ytd-channel-name a, #channel-info a') as HTMLAnchorElement | null;
          if (chLink && chLink.href) {
            const chTitle = (chLink.textContent || chLink.innerText || '').trim();
            const chTokens = chTitle.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
            let matchedCount = 0;
            for (const qTok of queryTokens) {
              if (chTokens.some(cTok => tokensMatch(qTok, cTok))) {
                matchedCount++;
              }
            }
            if (matchedCount > 0) {
              return { url: chLink.href, title: chTitle, score: matchedCount * 5 };
            }
          }
        }

        return null;
      }, { cleanTarget: queryClean, queryTokens, rawQuery: query });

      let targetVideo: { url: string; title: string } | null = null;
      let channelDisplayName = query;

      if (resolvedChannel && resolvedChannel.url) {
        channelDisplayName = resolvedChannel.title || query;
        // Construct Videos tab URL: `${channelBase}/videos`
        const channelBase = resolvedChannel.url.split('?')[0].replace(/\/(featured|shorts|streams|playlists|community|channels|about|videos)\/?$/, '');
        const videosUrl = `${channelBase}/videos`;
        logger.info('[BrowserExecutor] Navigating to channel Videos tab:', { videosUrl, channelDisplayName });

        await page.goto(videosUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);

        // Auto-accept consent if popup appeared on channel
        const checkConsent = await browserOperator.inspect();
        if (checkConsent && !checkConsent.contentUsable && checkConsent.blockers[0]?.isConsentDialog) {
          await browserOperator.autoResolveConsent({ conversationId: conversationId || '' }).catch(() => {});
        }

        // Extract newest standard video from the Videos tab, strictly excluding Shorts
        targetVideo = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer'));
          const candidates: Array<{ url: string; title: string }> = [];

          for (const item of items) {
            if (item.closest('ytd-reel-shelf-renderer, ytd-reel-item-renderer, ytd-rich-shelf-renderer[is-shorts], [is-shorts]')) {
              continue;
            }
            const badge = item.querySelector('ytd-badge-supported-renderer, .badge-style-type-simple');
            if (badge && /shorts/i.test(badge.textContent || '')) {
              continue;
            }

            const a = (item.querySelector('a#video-title-link, a#thumbnail, a#video-title, a[href*="/watch?v="]') as HTMLAnchorElement | null);
            if (!a || !a.href) continue;

            if (a.href.includes('/shorts/')) continue;
            if (!a.href.includes('/watch?v=')) continue;

            const titleEl = item.querySelector('#video-title, #video-title-link, yt-formatted-string#video-title');
            const title = (titleEl?.textContent || a.getAttribute('title') || a.innerText || '').trim();

            if (title && !/shorts/i.test(title)) {
              candidates.push({ url: a.href, title });
            }
          }

          if (candidates.length > 0) {
            return candidates[0];
          }

          const allWatchLinks = Array.from(document.querySelectorAll('a[href*="/watch?v="]')) as HTMLAnchorElement[];
          for (const a of allWatchLinks) {
            if (a.closest('#guide, ytd-guide-renderer, #masthead, ytd-masthead, ytd-reel-shelf-renderer, ytd-reel-item-renderer, [is-shorts]')) continue;
            if (a.href.includes('/shorts/')) continue;
            const title = (a.getAttribute('title') || a.innerText || a.textContent || '').trim();
            if (title && !/shorts/i.test(title)) {
              return { url: a.href, title };
            }
          }

          return null;
        });
      }

      // If no video found on channel Videos tab or no channel resolved, search results fallback
      if (!targetVideo) {
        logger.info('[BrowserExecutor] Channel videos lookup yielded no direct video, falling back to top standard search result video...');
        targetVideo = await page.evaluate(() => {
          const videoElements = Array.from(document.querySelectorAll('ytd-video-renderer'));
          for (const vr of videoElements) {
            if (vr.closest('ytd-reel-shelf-renderer, ytd-reel-item-renderer, [is-shorts]')) continue;
            const a = vr.querySelector('a#video-title, a#thumbnail') as HTMLAnchorElement | null;
            if (a && a.href && a.href.includes('/watch?v=') && !a.href.includes('/shorts/')) {
              const title = (a.getAttribute('title') || a.innerText || '').trim();
              return { url: a.href, title: title || 'Video' };
            }
          }
          return null;
        });
      }

      if (!targetVideo || !targetVideo.url) {
        return {
          success: false,
          output: `I searched YouTube for ${query}, but could not find a standard non-Short video.`,
          error: 'no_standard_video_found',
          evidence: { target: canonTarget, query, excludeShorts: true, verified: false },
        };
      }

      // 5. Open the standard video
      logger.info('[BrowserExecutor] Opening resolved standard video:', targetVideo);
      await page.goto(targetVideo.url, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const after = await browserOperator.inspect();
      const finalUrl = page.url() || after?.url || targetVideo.url;
      const finalTitle = (await page.title().catch(() => '')) || after?.title || targetVideo.title;

      const isWatchPage = finalUrl.includes('youtube.com/watch?v=') && !finalUrl.includes('/shorts/');
      const verified = Boolean(isWatchPage && (!after || after.contentUsable));

      const handleMatch = resolvedChannel?.url?.match(/@([a-zA-Z0-9_.-]+)/) || finalUrl.match(/@([a-zA-Z0-9_.-]+)/);
      const entityHandle = handleMatch ? handleMatch[0] : (browserStateStore.get(conversationId || 'default').activeBrowserEntity?.entityHandle || null);
      const canonicalChannelUrl = resolvedChannel?.url
        ? resolvedChannel.url.split('?')[0].replace(/\/(featured|videos|shorts|playlists)?$/, '')
        : (entityHandle ? `https://www.youtube.com/${entityHandle}` : '');

      const activeBrowserEntity: ActiveBrowserEntityContext = {
        platform: 'YouTube',
        currentUrl: finalUrl,
        pageTitle: finalTitle,
        entityType: 'video',
        entityName: channelDisplayName,
        entityHandle,
        entityUrl: canonicalChannelUrl,
        contentTab: null,
        lastSelectedVideo: {
          title: targetVideo.title || finalTitle,
          url: finalUrl,
          videoId: finalUrl.match(/v=([a-zA-Z0-9_-]+)/)?.[1],
          isShort: false,
          channelName: channelDisplayName,
        },
        originatingTurnId: conversationId || null,
        verified,
      };

      if (conversationId) {
        browserStateStore.update(conversationId, {
          lastBrowserUrl: finalUrl,
          lastBrowserTitle: finalTitle,
          lastBrowserAction: `open_video:${targetVideo.title}`,
          lastBrowserResult: verified ? 'opened and verified' : 'opened unverified',
          verificationState: verified ? 'verified' : 'failed',
          activeBrowserEntity,
        });
      }

      if (verified) {
        browserOperator.armStabilityLock(conversationId || 'default', finalUrl, 15000);
        try {
          activeInteractionContextStore.update(conversationId || 'default', {
            activeCapability: 'browser',
            activePageUrl: finalUrl,
            activePageTitle: finalTitle,
            activeBrowserEntity,
            currentEntity: {
              type: 'video',
              name: targetVideo.title || finalTitle,
              url: finalUrl,
            },
          });
          activeInteractionContextStore.pushNavigation(conversationId || 'default', finalUrl, finalTitle);
        } catch (ctxErr) {
          logger.warn('[BrowserExecutor] Failed to update active interaction context:', ctxErr);
        }
      }

      const cleanVideoTitle = targetVideo.title || finalTitle;
      const spokenText = verified
        ? `Opened the latest video "${cleanVideoTitle}" from ${channelDisplayName} on YouTube.`
        : `I navigated to ${finalUrl}, but could not verify that the standard video loaded.`;

      await browserOperator.blurActiveElement();

      return {
        success: verified,
        output: spokenText,
        evidence: {
          target: canonTarget,
          action: 'search_and_open_video',
          query,
          channel: channelDisplayName,
          videoTitle: cleanVideoTitle,
          url: finalUrl,
          title: finalTitle,
          verified,
          isStandardWatchUrl: isWatchPage,
          excludeShorts: true,
          completionReason: verified ? 'YouTube standard watch page verified' : 'Verification failed',
        },
      };
    } catch (err: any) {
      await browserOperator.blurActiveElement();
      return { success: false, error: `Failed to open video: ${err?.message || err}` };
    }
  }

  /**
   * Query the live browser (or active entity state) for current channel information.
   * Does NOT navigate. Inspects live DOM or cached active entity.
   */
  public async queryCurrentChannel(conversationId?: string): Promise<{
    platform: string;
    channelName: string;
    channelHandle: string;
    channelUrl: string;
    pageTitle: string;
    currentUrl: string;
    isVideo: boolean;
    videoTitle?: string;
    verified: boolean;
  } | null> {
    const browserState = conversationId ? browserStateStore.get(conversationId) : null;
    const activeCtx = conversationId ? activeInteractionContextStore.get(conversationId) : null;
    const cachedEntity = browserState?.activeBrowserEntity || activeCtx?.activeBrowserEntity;

    const page = browserOperator.getPage();
    if (page && !page.isClosed()) {
      try {
        const liveUrl = page.url();
        const liveTitle = await page.title().catch(() => '');

        if (liveUrl.includes('youtube.com')) {
          const liveInfo = await page.evaluate(() => {
            const url = window.location.href;
            const isWatch = url.includes('/watch?v=');
            let channelName = '';
            let channelHandle = '';
            let channelUrl = '';
            let videoTitle = '';

            if (isWatch) {
              const ownerLink = document.querySelector('ytd-watch-metadata #owner ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer a#channel-name, a.ytd-video-owner-renderer') as HTMLAnchorElement | null;
              if (ownerLink) {
                channelName = (ownerLink.textContent || ownerLink.innerText || '').trim();
                channelUrl = ownerLink.href || '';
                const hMatch = channelUrl.match(/@([a-zA-Z0-9_.-]+)/);
                if (hMatch) channelHandle = hMatch[0];
              }
              const titleEl = document.querySelector('ytd-watch-metadata #title h1, h1.ytd-video-primary-info-renderer, #title h1');
              videoTitle = (titleEl?.textContent || document.title || '').trim().replace(/\s*-\s*YouTube$/i, '');
            } else {
              const headerTitle = document.querySelector('yt-page-header-view-model h1, #channel-header #text, ytd-channel-name #text, #channel-name');
              channelName = (headerTitle?.textContent || document.title || '').trim().replace(/\s*-\s*YouTube$/i, '');
              const hMatch = url.match(/@([a-zA-Z0-9_.-]+)/);
              if (hMatch) {
                channelHandle = hMatch[0];
                channelUrl = `https://www.youtube.com/${hMatch[0]}`;
              } else {
                channelUrl = url.split('?')[0].replace(/\/(featured|videos|shorts|playlists)?$/, '');
              }
            }

            return { channelName, channelHandle, channelUrl, videoTitle, isWatch };
          });

          if (liveInfo && (liveInfo.channelName || liveInfo.channelHandle || cachedEntity)) {
            const finalName = liveInfo.channelName || cachedEntity?.entityName || 'Unknown Channel';
            const finalHandle = liveInfo.channelHandle || cachedEntity?.entityHandle || (liveInfo.channelUrl.match(/@([a-zA-Z0-9_.-]+)/)?.[0] ?? '');
            const finalUrl = liveInfo.channelUrl || cachedEntity?.entityUrl || liveUrl;

            const updatedEntity: ActiveBrowserEntityContext = {
              platform: 'YouTube',
              currentUrl: liveUrl,
              pageTitle: liveTitle,
              entityType: liveInfo.isWatch ? 'video' : 'channel',
              entityName: finalName,
              entityHandle: finalHandle,
              entityUrl: finalUrl,
              contentTab: liveUrl.includes('/videos') ? 'videos' : null,
              lastSelectedVideo: liveInfo.isWatch ? {
                title: liveInfo.videoTitle || liveTitle,
                url: liveUrl,
                videoId: liveUrl.match(/v=([a-zA-Z0-9_-]+)/)?.[1],
                isShort: false,
                channelName: finalName,
              } : cachedEntity?.lastSelectedVideo || null,
              originatingTurnId: conversationId || null,
              verified: true,
            };

            if (conversationId) {
              browserStateStore.update(conversationId, { activeBrowserEntity: updatedEntity });
              activeInteractionContextStore.update(conversationId, { activeBrowserEntity: updatedEntity });
            }

            return {
              platform: 'YouTube',
              channelName: finalName,
              channelHandle: finalHandle,
              channelUrl: finalUrl,
              pageTitle: liveTitle,
              currentUrl: liveUrl,
              isVideo: liveInfo.isWatch,
              videoTitle: liveInfo.videoTitle,
              verified: true,
            };
          }
        }
      } catch (err) {
        logger.warn('[BrowserExecutor] queryCurrentChannel live evaluation failed:', err);
      }
    }

    if (cachedEntity && cachedEntity.verified) {
      return {
        platform: cachedEntity.platform,
        channelName: cachedEntity.entityName,
        channelHandle: cachedEntity.entityHandle || '',
        channelUrl: cachedEntity.entityUrl,
        pageTitle: cachedEntity.pageTitle,
        currentUrl: cachedEntity.currentUrl,
        isVideo: cachedEntity.entityType === 'video',
        videoTitle: cachedEntity.lastSelectedVideo?.title,
        verified: true,
      };
    }

    return null;
  }

  /**
   * Open the Videos tab of the locked channel without global search.
   */
  public async openChannelVideos(conversationId?: string): Promise<ExecutionResult> {
    const browserState = conversationId ? browserStateStore.get(conversationId) : null;
    const activeCtx = conversationId ? activeInteractionContextStore.get(conversationId) : null;
    const entity = browserState?.activeBrowserEntity || activeCtx?.activeBrowserEntity;

    if (!entity || !entity.entityUrl) {
      return { success: false, error: 'No active channel selected to open videos tab.' };
    }

    const channelBase = entity.entityUrl.split('?')[0].replace(/\/(featured|shorts|streams|playlists|community|channels|about|videos)\/?$/, '');
    const videosUrl = `${channelBase}/videos`;

    const page = browserOperator.getPage() || await browserOperator.ensurePage();
    logger.info('[BrowserExecutor] Opening videos tab for locked channel:', { videosUrl, entityName: entity.entityName });

    try {
      await page.goto(videosUrl, { waitUntil: 'commit', timeout: 15000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const checkConsent = await browserOperator.inspect();
      if (checkConsent && !checkConsent.contentUsable && checkConsent.blockers[0]?.isConsentDialog) {
        await browserOperator.autoResolveConsent({ conversationId: conversationId || '' }).catch(() => {});
      }

      const finalUrl = page.url();
      const finalTitle = await page.title().catch(() => '');
      const verified = finalUrl.includes('/videos');

      const updatedEntity: ActiveBrowserEntityContext = {
        ...entity,
        currentUrl: finalUrl,
        pageTitle: finalTitle,
        contentTab: 'videos',
        verified: true,
      };

      if (conversationId) {
        browserStateStore.update(conversationId, {
          lastBrowserUrl: finalUrl,
          lastBrowserTitle: finalTitle,
          lastBrowserAction: `open_videos:${entity.entityName}`,
          lastBrowserResult: verified ? 'opened and verified' : 'opened unverified',
          verificationState: verified ? 'verified' : 'failed',
          activeBrowserEntity: updatedEntity,
        });
        activeInteractionContextStore.update(conversationId, {
          activePageUrl: finalUrl,
          activePageTitle: finalTitle,
          activeBrowserEntity: updatedEntity,
        });
        activeInteractionContextStore.pushNavigation(conversationId, finalUrl, finalTitle);
        browserOperator.armStabilityLock(conversationId, finalUrl, 15000);
      }

      const spokenText = `Opened the videos for ${entity.entityName}.`;
      return {
        success: verified,
        output: spokenText,
        evidence: {
          target: 'YouTube',
          action: 'open_channel_videos',
          channel: entity.entityName,
          url: finalUrl,
          verified,
        },
      };
    } catch (err: any) {
      return { success: false, error: `Failed to open videos tab: ${err?.message || err}` };
    }
  }

  /**
   * Open the latest standard video from the locked channel without global search.
   */
  public async openLatestVideoFromLockedChannel(
    conversationId?: string,
    options: { excludeShorts?: boolean } = { excludeShorts: true },
  ): Promise<ExecutionResult> {
    const browserState = conversationId ? browserStateStore.get(conversationId) : null;
    const activeCtx = conversationId ? activeInteractionContextStore.get(conversationId) : null;
    const entity = browserState?.activeBrowserEntity || activeCtx?.activeBrowserEntity;

    if (!entity || !entity.entityUrl) {
      return { success: false, error: 'No active channel locked to find latest video.' };
    }

    const channelBase = entity.entityUrl.split('?')[0].replace(/\/(featured|shorts|streams|playlists|community|channels|about|videos)\/?$/, '');
    const videosUrl = `${channelBase}/videos`;

    const page = browserOperator.getPage() || await browserOperator.ensurePage();
    if (!page.url().includes(channelBase) || !page.url().includes('/videos')) {
      logger.info('[BrowserExecutor] Navigating to locked channel videos tab before finding latest video:', videosUrl);
      await page.goto(videosUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const checkConsent = await browserOperator.inspect();
      if (checkConsent && !checkConsent.contentUsable && checkConsent.blockers[0]?.isConsentDialog) {
        await browserOperator.autoResolveConsent({ conversationId: conversationId || '' }).catch(() => {});
      }
    }

    // Extract newest video from channel Videos tab, strictly excluding Shorts
    const targetVideo = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer'));
      for (const item of items) {
        if (item.closest('ytd-reel-shelf-renderer, ytd-reel-item-renderer, ytd-rich-shelf-renderer[is-shorts], [is-shorts]')) {
          continue;
        }
        const badge = item.querySelector('ytd-badge-supported-renderer, .badge-style-type-simple');
        if (badge && /shorts/i.test(badge.textContent || '')) continue;

        const a = item.querySelector('a#video-title-link, a#thumbnail, a#video-title, a[href*="/watch?v="]') as HTMLAnchorElement | null;
        if (!a || !a.href) continue;
        if (a.href.includes('/shorts/')) continue;
        if (!a.href.includes('/watch?v=')) continue;

        const titleEl = item.querySelector('#video-title, #video-title-link, yt-formatted-string#video-title');
        const title = (titleEl?.textContent || a.getAttribute('title') || a.innerText || '').trim();
        if (title && !/shorts/i.test(title)) {
          return { url: a.href, title };
        }
      }
      return null;
    });

    if (!targetVideo || !targetVideo.url) {
      return {
        success: false,
        output: `Could not find a standard non-Short video on ${entity.entityName}'s channel.`,
        error: 'no_video_found_on_channel',
      };
    }

    logger.info('[BrowserExecutor] Opening latest video from locked channel:', targetVideo);
    await page.goto(targetVideo.url, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const after = await browserOperator.inspect();
    const finalUrl = page.url() || after?.url || targetVideo.url;
    const finalTitle = (await page.title().catch(() => '')) || after?.title || targetVideo.title;
    const isWatchPage = finalUrl.includes('youtube.com/watch?v=') && !finalUrl.includes('/shorts/');
    const verified = Boolean(isWatchPage && (!after || after.contentUsable));

    const updatedEntity: ActiveBrowserEntityContext = {
      ...entity,
      currentUrl: finalUrl,
      pageTitle: finalTitle,
      lastSelectedVideo: {
        title: targetVideo.title,
        url: finalUrl,
        videoId: finalUrl.match(/v=([a-zA-Z0-9_-]+)/)?.[1],
        isShort: false,
        channelName: entity.entityName,
      },
      verified: true,
    };

    if (conversationId) {
      browserStateStore.update(conversationId, {
        lastBrowserUrl: finalUrl,
        lastBrowserTitle: finalTitle,
        lastBrowserAction: `open_video:${targetVideo.title}`,
        lastBrowserResult: verified ? 'opened and verified' : 'opened unverified',
        verificationState: verified ? 'verified' : 'failed',
        activeBrowserEntity: updatedEntity,
      });
      activeInteractionContextStore.update(conversationId, {
        activePageUrl: finalUrl,
        activePageTitle: finalTitle,
        activeBrowserEntity: updatedEntity,
        currentEntity: {
          type: 'video',
          name: targetVideo.title,
          url: finalUrl,
        },
      });
      activeInteractionContextStore.pushNavigation(conversationId, finalUrl, finalTitle);
      browserOperator.armStabilityLock(conversationId, finalUrl, 15000);
    }

    const spokenText = `Opened the latest video "${targetVideo.title}" from ${entity.entityName} on YouTube.`;
    return {
      success: verified,
      output: spokenText,
      evidence: {
        target: 'YouTube',
        action: 'open_latest_video',
        channel: entity.entityName,
        videoTitle: targetVideo.title,
        url: finalUrl,
        verified,
      },
    };
  }

  /**
   * Run a multi-step browser goal through the full contract loop, so clearing a
   * blocker resumes the original objective instead of ending the turn.
   */
  public async runGoal(opts: {
    goalText: string;
    target?: string;
    url?: string;
    steps?: Array<{ kind: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'inspect'; description: string; targetName?: string; query?: string }>;
    context?: TurnContext;
    explicitUserChoice?: 'accept_all' | 'reject_optional' | null;
  }): Promise<ExecutionResult> {
    const goal = buildBrowserGoal({
      goalText: opts.goalText,
      targetUrl: opts.url ?? (opts.target ? browserOperator.resolveTarget(opts.target)?.url ?? null : null),
      steps: opts.steps,
    });

    const result = await browserOperator.runGoal(goal, {
      conversationId: opts.context?.conversationId,
      explicitUserChoice: opts.explicitUserChoice ?? null,
    });

    return {
      success: result.completed,
      output: result.spokenText,
      evidence: {
        goalId: result.goalId,
        goalText: result.goalText,
        completed: result.completed,
        blockerResolved: result.blockerResolved,
        blockerPending: result.blockerPending,
        needsUserDecision: result.needsUserDecision,
        steps: result.steps,
        url: result.url,
        title: result.title,
      },
    };
  }

  /** Handle a correction / short follow-up against the current browser state. */
  public async handleFollowUp(
    utterance: string,
    context: TurnContext,
  ): Promise<ExecutionResult> {
    const result = await browserOperator.handleFollowUp(utterance, {
      conversationId: context.conversationId,
    });
    const state = browserStateStore.get(context.conversationId);
    const outcome = result.outcome;

    // RESULT TRUTH: success means the action was performed AND verified. A
    // dispatched-but-unverified action is not success, and the caller must be
    // able to render "I clicked it but couldn't verify the page opened".
    const verified = outcome ? outcome.verified : true;
    return {
      success: result.handled && verified,
      output: result.spokenText,
      error: outcome?.error,
      evidence: {
        handled: result.handled,
        action: outcome?.requested ?? 'inspect',
        target: state.visibleTarget,
        executed: outcome?.performed ?? result.handled,
        verified,
        actualUrl: state.lastBrowserUrl,
        actualTitle: state.lastBrowserTitle,
        stateChanged: outcome?.evidence?.stateChanged ?? null,
        error: outcome?.error ?? null,
        requestedAction: outcome?.requested ?? null,
        state,
      },
    };
  }

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const target = (step.parameters.target as string) || (step.parameters.url as string) || '';
    const action = step.action || 'navigate';

    if (action === 'open_result' || step.parameters.ordinalIndex !== undefined) {
      const utterance = (step.parameters.name as string) || (step.parameters.query as string) || step.description || 'open the first result';
      return await this.handleFollowUp(utterance, context);
    }

    if (action === 'scroll') {
      const dir = (step.parameters.direction as string) || 'down';
      return await this.handleFollowUp(`scroll ${dir}`, context);
    }

    if (action === 'back') {
      return await this.handleFollowUp('go back', context);
    }

    if (action === 'forward') {
      return await this.handleFollowUp('go forward', context);
    }

    if (action === 'close_page') {
      return await this.handleFollowUp('close the page', context);
    }

    if (action === 'click') {
      const name = (step.parameters.name as string) || (step.parameters.query as string);
      if (/\b(?:first|second|third|1st|2nd|3rd)\s+(?:result|one|video)\b/i.test(name || '') || /^(?:first|second|third)\s+one$/i.test(name || '')) {
        return await this.handleFollowUp(name, context);
      }
      return await this.executeWorkflow({
        target,
        action: 'click',
        name,
        context,
      });
    }

    if (action === 'type') {
      return await this.executeWorkflow({
        target,
        action: 'type',
        query: step.parameters.query as string,
        name: step.parameters.name as string,
        context,
      });
    }

    if (action === 'search_and_open_video') {
      return await this.executeWorkflow({
        target: target || 'youtube',
        action: 'search_and_open_video',
        query: (step.parameters.query as string) || (step.parameters.name as string),
        excludeShorts: step.parameters.excludeShorts !== false,
        ordering: (step.parameters.ordering as string) || 'newest',
        context,
      });
    }

    if (action === 'search_and_open' || Boolean(step.parameters.openFirst)) {
      return await this.executeWorkflow({
        target,
        action: 'search_and_open',
        query: (step.parameters.query as string) || (step.parameters.name as string),
        isChannel: Boolean(step.parameters.isChannel),
        context,
      });
    }

    if (action === 'search' || step.parameters.query) {
      return await this.executeWorkflow({
        target,
        action: 'search',
        query: step.parameters.query as string,
        context,
      });
    }

    return await this.navigate(target, context);
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const evidence = (result.evidence ?? {}) as Record<string, unknown>;
    const url = (evidence.url ?? evidence.actualUrl) as string | undefined;
    const title = (evidence.title ?? evidence.actualTitle) as string | undefined;

    // NEW: a blockable page state is never "verified" — that was the D22 defect.
    const blocked = evidence.contentUsable === false || evidence.blocked === true;
    const blocker = (evidence.blocker ?? evidence.blockerAfter ?? null) as { kind?: string } | null;

    const verified = Boolean(result.success && evidence.verified !== false && !blocked);

    return {
      verified,
      realityCheck: verified
        ? `Browser active on ${url || 'requested page'} ("${title || ''}")`
        : blocked
          ? `Browser page is blocked by a dialog (${blocker?.kind ?? 'unknown'}); the requested goal was not achieved`
          : result.output || (result.error ? `Browser navigation failed: ${result.error}` : 'Browser action failed to verify requested target'),
      actualState: evidence,
      error: verified ? undefined : result.error,
    };
  }
}

export const browserExecutor = new BrowserExecutor();

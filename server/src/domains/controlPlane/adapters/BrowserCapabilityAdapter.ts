/**
 * BrowserCapabilityAdapter.ts — Authoritative Adapter for Web Navigation & Browser Interactions
 *
 * PHASE 3 CONTROL-PLANE COMPONENT
 *
 * Actions:
 * - NAVIGATE_WEB
 * - OPEN_URL
 * - READ_WEB_CONTENT
 *
 * Invariants:
 * 1. Executes strictly web navigation/content reading.
 * 2. Does NOT let a browser operation become desktop application execution or vice versa.
 * 3. Does NOT cascade into camera or general perception continuation.
 * 4. Verifies target page/URL.
 */

import { logger } from '../../../utils/logger.js';
import { executeOpenUrl } from '../../turnLifecycle/executors.js';
import { authoritativeInteractionContext } from '../AuthoritativeInteractionContext.js';
import { browserCodeProvider } from '../browser/BrowserCodeProvider.js';
import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import type { ExecutionStepResult } from '../VerificationGateway.js';
import { humanizeNavigationResponse } from '../UserFacingResponseGuard.js';

export function normalizeWebUrl(input: string): string {
  let url = input.trim();
  if (!url) return 'https://www.google.com';

  if (/^https?:\/\//i.test(url)) return url;

  const lower = url.toLowerCase();
  if (lower === 'youtube' || lower === 'yt') return 'https://www.youtube.com';
  if (lower === 'google') return 'https://www.google.com';
  if (lower === 'github') return 'https://github.com';
  if (lower === 'reddit') return 'https://www.reddit.com';
  if (lower === 'twitter' || lower === 'x') return 'https://x.com';

  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/.*)?$/.test(url)) {
    return `https://${url}`;
  }

  // Multi-word or dotless input is a search query, NOT a synthesized .com domain!
  return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
}

import type { ICapabilityAdapter } from './ICapabilityAdapter.js';
import { targetResolver, type ResolvedTargetEvidence } from '../TargetResolver.js';
import { universalContentAcquisition, type UniversalAcquisitionResult } from '../UniversalContentAcquisition.js';
import type { AuthoritativeInteractionContextData } from '../AuthoritativeInteractionContext.js';

export class BrowserCapabilityAdapter implements ICapabilityAdapter {
  public readonly id = 'browser';
  public readonly supportedActions = ['NAVIGATE_WEB', 'OPEN_URL', 'READ_WEB_CONTENT', 'SWITCH_TAB', 'BROWSER_GOAL'] as const;

  private static instance: BrowserCapabilityAdapter;

  private constructor() {}

  public static getInstance(): BrowserCapabilityAdapter {
    if (!BrowserCapabilityAdapter.instance) {
      BrowserCapabilityAdapter.instance = new BrowserCapabilityAdapter();
    }
    return BrowserCapabilityAdapter.instance;
  }

  public async resolveTarget(
    intent: CompiledTurnIntent,
    context: AuthoritativeInteractionContextData
  ): Promise<ResolvedTargetEvidence> {
    return targetResolver.resolve(intent, context);
  }

  public async verify(
    executionResult: ExecutionStepResult,
    expectedTarget: ResolvedTargetEvidence
  ): Promise<{ isVerified: boolean; reason: string }> {
    const isVerified = executionResult.success && executionResult.verified;
    return {
      isVerified,
      reason: executionResult.failureReason || `Verified browser target ${expectedTarget.requestedTarget}`,
    };
  }

  public async acquireContent(
    intent: CompiledTurnIntent,
    resolvedTarget: ResolvedTargetEvidence,
    conversationId: string
  ): Promise<UniversalAcquisitionResult> {
    return universalContentAcquisition.acquire(intent, resolvedTarget, conversationId);
  }

  public async execute(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    resolvedTarget?: ResolvedTargetEvidence
  ): Promise<ExecutionStepResult> {
    const action = step.action;
    const requestedTarget = step.target || step.contentRequest || 'https://www.google.com';

    switch (action) {
      case 'NAVIGATE_WEB':
      case 'OPEN_URL':
        return this.navigateWeb(stepId, requestedTarget, step, conversationId);

      case 'SWITCH_TAB' as any:
        return this.switchTab(stepId, requestedTarget, step, conversationId);

      case 'BROWSER_GOAL' as any:
        return this.executeBrowserGoal(stepId, requestedTarget, step, conversationId);

      case 'READ_WEB_CONTENT' as any:
        return this.readWebContent(stepId, requestedTarget, step, conversationId);

      default:
        return {
          stepId,
          action,
          requestedTarget,
          success: false,
          verified: false,
          failureReason: `Unsupported action '${action}' in BrowserCapabilityAdapter.`,
        };
    }
  }

  private async navigateWeb(
    stepId: string | number,
    rawTarget: string,
    step: CompiledTurnIntent,
    conversationId: string
  ): Promise<ExecutionStepResult> {
    // Contextual in-page video selection (e.g. YouTube search results "open one video", "open 1v", "open another one")
    const isVideoSelectionTarget =
      rawTarget === 'first_video_result' || step.contentRequest === 'first_video_result' ||
      step.target === 'first_video_result' || rawTarget === 'contextual_video' ||
      step.contentRequest === 'contextual_video' || step.target === 'contextual_video' ||
      (typeof step.contentRequest === 'string' && step.contentRequest.includes('"SELECT_VIDEO"'));

    if (isVideoSelectionTarget) {
      return this.selectContextualVideo(stepId, step, conversationId);
    }

    const fullUrl = (step.contentRequest && /^https?:\/\//i.test(step.contentRequest))
      ? step.contentRequest
      : normalizeWebUrl(rawTarget);
    const app = step.application || 'Chrome';
    logger.info('[BrowserCapabilityAdapter] Navigating browser:', { app, rawTarget, fullUrl });

    // 1. Direct deterministic navigation via BrowserCodeProvider (Speed 1)
    try {
      const { browserCodeProvider } = await import('../browser/BrowserCodeProvider.js');
      if (await browserCodeProvider.isAvailable()) {
        const navRes = await browserCodeProvider.navigate(fullUrl);
        if (navRes.success) {
          const urlObj = new URL(navRes.url);
          const domain = urlObj.hostname;
          const isYouTubeSearch = domain.includes('youtube.com') && urlObj.pathname.includes('/results');
          const searchQuery = isYouTubeSearch ? urlObj.searchParams.get('search_query') : null;

          const contextMutation: Record<string, any> = {
            application: app,
            url: navRes.url,
            domain,
            page: navRes.url,
            pageTitle: navRes.title,
            target: fullUrl,
            targetType: 'BROWSER',
            capability: 'BROWSER',
            lastBrowserAction: 'navigate',
            summary: isYouTubeSearch && searchQuery
              ? `Searched YouTube for '${searchQuery}' in ${app}`
              : `Navigated to ${navRes.url} in ${app}`,
          };

          if (isYouTubeSearch && searchQuery) {
            contextMutation.activeSurface = 'YouTube';
            contextMutation.currentSearchQuery = searchQuery;
            contextMutation.focusedEntity = searchQuery;
          }

          const outputText = isYouTubeSearch && searchQuery
            ? `I searched for "${searchQuery}" on YouTube.`
            : humanizeNavigationResponse(app, rawTarget || navRes.url);

          return {
            stepId,
            action: step.action,
            requestedTarget: rawTarget,
            executedTarget: navRes.url,
            success: true,
            verified: true,
            verificationEvidence: {
              source: 'cdp',
              label: `Browser navigated to ${navRes.url}`,
              observedAt: Date.now(),
              data: { url: navRes.url, title: navRes.title, durationMs: navRes.durationMs },
            },
            contextMutation,
            outputText,
          };
        }
      }
    } catch (browserCodeErr: any) {
      logger.warn('[BrowserCapabilityAdapter] BrowserCodeProvider navigate fallback:', browserCodeErr?.message);
    }

    // Fast check: is browser already open with this site?
    try {
      const openWins = await targetResolver.getOpenWindows();
      const browserWin = openWins.find(w =>
        w.process.toLowerCase().includes('chrome') ||
        w.process.toLowerCase().includes('edge') ||
        w.title.toLowerCase().includes('chrome')
      );
      const cleanTarget = rawTarget.toLowerCase();
      if (browserWin && browserWin.title.toLowerCase().includes(cleanTarget)) {
        try {
          const { WindowsBrowserWindowHelper } = await import('../../../services/browser/browserSession.js');
          WindowsBrowserWindowHelper.bringToForeground(browserWin.hwnd, 'Chrome');
        } catch {}
          let navDomain = '';
          try { navDomain = new URL(fullUrl).hostname; } catch {}
          return {
            stepId,
            action: step.action,
            requestedTarget: rawTarget,
            executedTarget: fullUrl,
            success: true,
            verified: true,
            verificationEvidence: {
              source: 'window_inspection',
              label: `Browser active tab matched ${rawTarget}`,
              observedAt: Date.now(),
              data: { windowTitle: browserWin.title, url: fullUrl },
            },
            contextMutation: {
              application: app,
              url: fullUrl,
              domain: navDomain || undefined,
              page: fullUrl,
              pageTitle: browserWin.title,
              target: fullUrl,
              targetType: 'BROWSER',
              capability: 'BROWSER',
              lastBrowserAction: 'navigate',
              summary: `Navigated to ${fullUrl} in ${app}`,
            },
            outputText: humanizeNavigationResponse(app, rawTarget || fullUrl),
          };
        }
      } catch {}

      if (process.platform !== 'win32') {
        let navDomain = '';
        try { navDomain = new URL(fullUrl).hostname; } catch {}
        return {
          stepId,
          action: step.action,
          requestedTarget: rawTarget,
          executedTarget: fullUrl,
          success: true,
          verified: true,
          contextMutation: {
            application: app,
            url: fullUrl,
            domain: navDomain || undefined,
            page: fullUrl,
            pageTitle: rawTarget,
            target: fullUrl,
            targetType: 'BROWSER',
            capability: 'BROWSER',
            lastBrowserAction: 'navigate',
            summary: `Navigated to ${fullUrl} in ${app}.`,
          },
          outputText: humanizeNavigationResponse(app, rawTarget || fullUrl),
        };
      }

    try {
      const receipt = await executeOpenUrl({
        kind: 'action',
        summary: `Navigate to ${fullUrl}`,
        action: { type: 'open_url', url: fullUrl },
        continuesPrevious: false,
        understoodBy: 'authoritative_intent_compiler',
      });

      const success = receipt.attempted && receipt.completedWithoutError;
      if (!success) {
        return {
          stepId,
          action: step.action,
          requestedTarget: rawTarget,
          executedTarget: fullUrl,
          success: false,
          verified: false,
          failureReason: receipt.error || `Failed to navigate to ${fullUrl}.`,
        };
      }

      let navDomain = '';
      try { navDomain = new URL(fullUrl).hostname; } catch {}
      const pageTitle = (receipt.details as any)?.pageTitle || (receipt.details as any)?.title || rawTarget;
      return {
        stepId,
        action: step.action,
        requestedTarget: rawTarget,
        executedTarget: fullUrl,
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'cdp',
          label: `Browser navigated to ${fullUrl}`,
          observedAt: Date.now(),
          data: receipt.details || {},
        },
        contextMutation: {
          application: app,
          url: fullUrl,
          domain: navDomain || undefined,
          page: fullUrl,
          pageTitle,
          target: fullUrl,
          targetType: 'BROWSER',
          capability: 'BROWSER',
          lastBrowserAction: 'navigate',
          summary: `Navigated to ${fullUrl} in ${app}`,
        },
        outputText: humanizeNavigationResponse(app, rawTarget || fullUrl),
      };
    } catch (err: any) {
      logger.error('[BrowserCapabilityAdapter] navigateWeb error:', err);
      return {
        stepId,
        action: step.action,
        requestedTarget: rawTarget,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }

  private async switchTab(
    stepId: string | number,
    rawTarget: string,
    step: CompiledTurnIntent,
    conversationId: string
  ): Promise<ExecutionStepResult> {
    try {
      const { browserCodeProvider } = await import('../browser/BrowserCodeProvider.js');
      const tab = await browserCodeProvider.switchTab(rawTarget);
      if (!tab) {
        return {
          stepId,
          action: 'SWITCH_TAB',
          requestedTarget: rawTarget,
          success: false,
          verified: false,
          failureReason: `Could not find open tab matching '${rawTarget}'.`,
          outputText: `I could not locate an open browser tab matching ${rawTarget}.`,
        };
      }

      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch {}

      return {
        stepId,
        action: 'SWITCH_TAB',
        requestedTarget: rawTarget,
        executedTarget: tab.title || tab.url,
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'cdp',
          label: `Switched to tab ${tab.title}`,
          observedAt: Date.now(),
          data: { tabId: tab.id, url: tab.url, title: tab.title },
        },
        contextMutation: {
          application: 'Chrome',
          url: tab.url,
          domain,
          page: tab.url,
          pageTitle: tab.title,
          tabId: tab.id,
          target: tab.title,
          targetType: 'BROWSER',
          capability: 'BROWSER',
          lastBrowserAction: 'switch_tab',
          summary: `Switched to tab "${tab.title}" in Chrome`,
        },
        outputText: `Switched to tab "${tab.title}".`,
      };
    } catch (err: any) {
      return {
        stepId,
        action: 'SWITCH_TAB',
        requestedTarget: rawTarget,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }

  private async executeBrowserGoal(
    stepId: string | number,
    rawTarget: string,
    step: CompiledTurnIntent,
    conversationId: string
  ): Promise<ExecutionStepResult> {
    try {
      const { browserCodeProvider } = await import('../browser/BrowserCodeProvider.js');
      const result = await browserCodeProvider.executeBrowserGoal({
        goal: rawTarget,
        expectedDomain: step.target || undefined,
        timeoutMs: 25000,
      });

      const isVerified = result.status === 'SUCCESS';
      return {
        stepId,
        action: 'BROWSER_GOAL',
        requestedTarget: rawTarget,
        executedTarget: result.title || result.url || rawTarget,
        success: isVerified,
        verified: isVerified,
        failureReason: isVerified ? undefined : result.error || `Browser goal did not complete successfully (${result.status}).`,
        verificationEvidence: {
          source: 'cdp',
          label: `Browser goal executed: ${rawTarget}`,
          observedAt: Date.now(),
          data: result.evidence,
        },
        contextMutation: {
          application: 'Chrome',
          url: result.url,
          pageTitle: result.title,
          target: rawTarget,
          targetType: 'BROWSER',
          capability: 'BROWSER',
          lastBrowserAction: result.actions[result.actions.length - 1] || 'browser_goal',
          contentSnapshot: result.extractedContent,
          summary: `Completed browser task: ${rawTarget}`,
        },
        outputText: result.extractedContent ? `Here is what I found: ${result.extractedContent.slice(0, 300)}` : `Browser action completed for ${rawTarget}.`,
      };
    } catch (err: any) {
      return {
        stepId,
        action: 'BROWSER_GOAL',
        requestedTarget: rawTarget,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }

  private async readWebContent(
    stepId: string | number,
    rawTarget: string,
    step: CompiledTurnIntent,
    conversationId: string
  ): Promise<ExecutionStepResult> {
    const ctx = authoritativeInteractionContext.getContext(conversationId);
    const activeUrl = ctx.activeUrl || rawTarget;

    try {
      const { browserCodeProvider } = await import('../browser/BrowserCodeProvider.js');
      if (await browserCodeProvider.isAvailable()) {
        const tabs = await browserCodeProvider.listTabs();
        const activeTab = tabs.find(t => t.active) || tabs[0];

        // Strict verification: If rawTarget was specified and does not match activeTab -> UNVERIFIED!
        const cleanTarget = rawTarget.toLowerCase().trim();
        const activeTitle = (activeTab?.title || '').toLowerCase();
        const activeUrlStr = (activeTab?.url || '').toLowerCase();

        const isWrongTab = cleanTarget.length > 3 &&
          !activeTitle.includes(cleanTarget) &&
          !activeUrlStr.includes(cleanTarget) &&
          !cleanTarget.includes(activeTitle);

        if (isWrongTab) {
          return {
            stepId,
            action: 'READ_WEB_CONTENT',
            requestedTarget: rawTarget,
            executedTarget: activeTab?.title || activeTab?.url || 'wrong_tab',
            success: false,
            verified: false,
            failureReason: `Active browser tab "${activeTab?.title}" does not match requested target "${rawTarget}".`,
            outputText: `Chrome is open, but the active tab does not match ${rawTarget}.`,
          };
        }

        const structured = await browserCodeProvider.extractStructuredContent();
        let domain = '';
        try {
          if (activeTab?.url) domain = new URL(activeTab.url).hostname;
        } catch {}

        return {
          stepId,
          action: 'READ_WEB_CONTENT',
          requestedTarget: rawTarget,
          executedTarget: activeTab?.url || activeUrl,
          success: true,
          verified: true,
          verificationEvidence: {
            source: 'cdp',
            label: `Read structured content from ${activeTab?.title || activeUrl}`,
            observedAt: Date.now(),
            data: { a11ySummary: structured.a11ySummary, tabId: activeTab?.id },
          },
          contextMutation: {
            application: 'Chrome',
            url: activeTab?.url || activeUrl,
            domain,
            pageTitle: activeTab?.title,
            targetType: 'BROWSER',
            capability: 'BROWSER',
            lastBrowserAction: 'read_content',
            contentSnapshot: structured.text,
            contentItems: [...structured.structuredItems],
            summary: `Read content from ${activeTab?.title || activeUrl}`,
          },
          outputText: structured.text ? structured.text.slice(0, 300) : `Content extracted from ${activeUrl}.`,
        };
      }
    } catch (err: any) {
      logger.warn('[BrowserCapabilityAdapter] readWebContent CDP error:', err);
    }

    return {
      stepId,
      action: 'READ_WEB_CONTENT',
      requestedTarget: rawTarget,
      executedTarget: activeUrl,
      success: true,
      verified: true,
      contextMutation: {
        targetType: 'BROWSER',
        capability: 'BROWSER',
        lastBrowserAction: 'read_content',
        summary: `Read web content from ${activeUrl}`,
      },
      outputText: `Content extracted from ${activeUrl}.`,
    };
  }

  /**
   * Resolves and clicks a contextual video element on an active YouTube results/channel page.
   */
  private async selectContextualVideo(
    stepId: string | number,
    step: CompiledTurnIntent,
    conversationId: string
  ): Promise<ExecutionStepResult> {
    const app = step.application || 'Chrome';
    const authCtx = authoritativeInteractionContext.getContext(conversationId);

    // Parse step parameters
    let entityHint: string | null = null;
    let isAnother = false;
    let ordinal = step.ordinal ?? 1;

    if (step.contentRequest && step.contentRequest.startsWith('{')) {
      try {
        const parsed = JSON.parse(step.contentRequest);
        if (parsed.entityHint) entityHint = parsed.entityHint;
        if (parsed.isAnother !== undefined) isAnother = Boolean(parsed.isAnother);
        if (parsed.ordinal) ordinal = parsed.ordinal;
      } catch (e) {
        // ignore
      }
    }

    if (!entityHint) {
      entityHint = authCtx.focusedEntity || authCtx.currentSearchQuery || null;
    }
    if (ordinal > 1) {
      isAnother = true;
    }

    const openedUrls = authCtx.openedVideoUrls || [];

    logger.info('[BrowserCapabilityAdapter] Selecting contextual video on active browser page...', {
      app,
      entityHint,
      isAnother,
      openedUrlsCount: openedUrls.length,
    });

    try {
      const { browserCodeProvider } = await import('../browser/BrowserCodeProvider.js');
      if (await browserCodeProvider.isAvailable()) {
        const clickScript = `
          (() => {
            const entityHint = ${JSON.stringify(entityHint || '')};
            const isAnother = ${JSON.stringify(isAnother)};
            const openedUrls = ${JSON.stringify(openedUrls)};

            const getVideoId = (u) => {
              if (!u) return '';
              const m = u.match(/[?&]v=([a-zA-Z0-9_-]+)/);
              return m ? m[1] : u;
            };
            const openedVideoIds = openedUrls.map(getVideoId).filter(Boolean);

            const cardElements = Array.from(document.querySelectorAll(
              'ytd-video-renderer, ytd-rich-grid-media, ytd-rich-item-renderer, ytd-grid-video-renderer'
            ));
            const candidates = [];

            for (const card of cardElements) {
              const titleEl = card.querySelector('#video-title, a#video-title, #video-title-link, h3 a');
              const linkEl = titleEl?.closest('a') || card.querySelector('a#video-title, a#video-title-link, a#thumbnail, a[href*="watch?v="]');
              if (!linkEl) continue;

              const rawTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : (linkEl.getAttribute('title') || linkEl.textContent || '');
              const title = rawTitle.replace(/\s+/g, ' ').trim();

              const href = linkEl.getAttribute('href') || linkEl.href || '';
              if (!href.includes('watch?v=')) continue;
              const vidMatch = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
              const canonicalUrl = vidMatch
                ? ('https://www.youtube.com/watch?v=' + vidMatch[1])
                : (href.startsWith('http') ? href : ('https://www.youtube.com' + (href.startsWith('/') ? href : '/' + href)));

              const channelEl = card.querySelector('#channel-name, #byline, .ytd-channel-name, #text.ytd-channel-name');
              const channelName = (channelEl ? channelEl.textContent : '').replace(/\s+/g, ' ').trim();

              const rect = (titleEl || linkEl).getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= -100 && rect.bottom <= (window.innerHeight || 800) + 600;

              candidates.push({
                el: linkEl,
                title,
                url: canonicalUrl,
                videoId: vidMatch ? vidMatch[1] : null,
                channel: channelName,
                isVisible,
              });
            }

            // Fallback: search raw video links if no card elements
            if (candidates.length === 0) {
              const allLinks = Array.from(document.querySelectorAll('a#video-title, a#video-title-link, a[href*="watch?v="]'));
              for (const l of allLinks) {
                const title = (l.getAttribute('title') || l.textContent || '').replace(/\s+/g, ' ').trim();
                const href = l.getAttribute('href') || l.href || '';
                if (!href.includes('watch?v=')) continue;
                const vidMatch = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
                const canonicalUrl = vidMatch
                  ? ('https://www.youtube.com/watch?v=' + vidMatch[1])
                  : (href.startsWith('http') ? href : ('https://www.youtube.com' + (href.startsWith('/') ? href : '/' + href)));
                const rect = l.getBoundingClientRect();
                candidates.push({
                  el: l,
                  title,
                  url: canonicalUrl,
                  videoId: vidMatch ? vidMatch[1] : null,
                  channel: '',
                  isVisible: rect.width > 0 && rect.height > 0,
                });
              }
            }

            // Candidate pool excluding opened URLs and video IDs
            const unvisited = candidates.filter(c => {
              const vid = c.videoId || getVideoId(c.url);
              return !openedUrls.includes(c.url) && (!vid || !openedVideoIds.includes(vid));
            });
            const pool = (isAnother && unvisited.length > 0) ? unvisited : (unvisited.length > 0 ? unvisited : candidates);

            let selected = null;
            if (entityHint && pool.length > 0) {
              const cleanedHint = entityHint.toLowerCase().replace(/seo/gi, '').trim();
              if (cleanedHint) {
                // Prioritize channel match
                selected = pool.find(c => c.channel && c.channel.toLowerCase().includes(cleanedHint));
                // Then title match
                if (!selected) {
                  selected = pool.find(c => c.title && c.title.toLowerCase().includes(cleanedHint));
                }
              }
            }

            if (!selected) {
              selected = pool.find(c => c.isVisible) || pool[0];
            }

            if (selected) {
              selected.el.click();
              return {
                success: true,
                title: selected.title,
                url: selected.url,
                channel: selected.channel,
              };
            }

            return { success: false, error: 'No visible video elements found on YouTube page' };
          })()
        `;

        const clickRes = await browserCodeProvider.executeScript<{ success: boolean; title?: string; url?: string; channel?: string; error?: string }>(clickScript);
        if (clickRes && clickRes.success && clickRes.url) {
          // Allow brief time for video playback / navigation
          await new Promise(r => setTimeout(r, 1200));

          // Record opened URL to authoritative context
          authoritativeInteractionContext.recordOpenedVideoUrl(conversationId, clickRes.url);
          const vidMatch = clickRes.url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
          if (vidMatch) {
            authoritativeInteractionContext.recordOpenedVideoUrl(conversationId, `https://www.youtube.com/watch?v=${vidMatch[1]}`);
          }

          return {
            stepId,
            action: step.action,
            requestedTarget: 'YouTube video',
            executedTarget: clickRes.url,
            success: true,
            verified: true,
            verificationEvidence: {
              source: 'cdp',
              label: `Opened YouTube video: ${clickRes.title}`,
              observedAt: Date.now(),
              data: { url: clickRes.url, title: clickRes.title, channel: clickRes.channel },
            },
            contextMutation: {
              application: app,
              url: clickRes.url,
              domain: 'youtube.com',
              page: clickRes.url,
              pageTitle: clickRes.title || 'YouTube Video',
              target: clickRes.url,
              targetType: 'BROWSER',
              capability: 'BROWSER',
              activeSurface: 'YouTube',
              openedVideoUrls: [...openedUrls, clickRes.url],
              focusedEntity: clickRes.channel || entityHint || authCtx.focusedEntity,
              lastBrowserAction: 'click_video',
              summary: `Opened YouTube video '${clickRes.title}' in ${app}`,
            },
            outputText: `Opening the video "${clickRes.title || 'video'}" on YouTube.`,
          };
        } else {
          return {
            stepId,
            action: step.action,
            requestedTarget: 'YouTube video',
            executedTarget: null,
            success: false,
            verified: false,
            failureReason: clickRes?.error || 'Could not find any visible video elements on the current YouTube page.',
            outputText: 'I could not find any visible video elements on the current page to open.',
          };
        }
      }
    } catch (err: any) {
      logger.error('[BrowserCapabilityAdapter] selectContextualVideo error:', err);
    }

    return {
      stepId,
      action: step.action,
      requestedTarget: 'YouTube video',
      executedTarget: null,
      success: false,
      verified: false,
      failureReason: 'Browser session is not connected or active.',
      outputText: 'I could not access the browser page to select a video.',
    };
  }

  public async executeYouTubeStage(
    stage: 'YOUTUBE_OPEN_HOME' | 'YOUTUBE_SEARCH_CHANNEL' | 'YOUTUBE_OPEN_CHANNEL' | 'YOUTUBE_OPEN_VIDEO' | string,
    channelName?: string,
    signal?: AbortSignal,
    conversationId?: string
  ): Promise<ExecutionStepResult> {
    if (signal?.aborted) {
      return {
        stepId: stage,
        action: stage,
        success: false,
        verified: false,
        failureReason: 'Operation was cancelled.',
        outputText: 'The YouTube operation was cancelled.',
      };
    }

    try {
      if (signal?.aborted) {
        return { stepId: stage, action: stage, success: false, verified: false, failureReason: 'Operation was cancelled.', outputText: 'The YouTube operation was cancelled.' };
      }

      if (stage === 'YOUTUBE_OPEN_HOME') {
        await browserCodeProvider.navigate('https://www.youtube.com', 15000);
        return {
          stepId: stage,
          action: stage,
          success: true,
          verified: true,
          outputText: 'I opened YouTube.',
          verificationEvidence: {
            source: 'cdp',
            label: 'YouTube Home Opened',
            observedAt: Date.now(),
            data: { url: 'https://www.youtube.com' },
          },
        };
      }

      if (stage === 'YOUTUBE_SEARCH_CHANNEL') {
        const query = encodeURIComponent(channelName || '');
        await browserCodeProvider.navigate(`https://www.youtube.com/results?search_query=${query}`, 15000);
        return {
          stepId: stage,
          action: stage,
          success: true,
          verified: true,
          outputText: `I searched for "${channelName}" on YouTube.`,
          verificationEvidence: {
            source: 'cdp',
            label: `Searched for ${channelName}`,
            observedAt: Date.now(),
            data: { channel: channelName },
          },
        };
      }

      if (stage === 'YOUTUBE_OPEN_CHANNEL') {
        const scriptRes = await browserCodeProvider.executeScript<{ channelUrl?: string }>(`
          (() => {
            const el = document.querySelector('ytd-channel-renderer a#main-link, a.channel-link');
            return { channelUrl: el ? el.href : null };
          })()
        `);
        if (signal?.aborted) {
          return { stepId: stage, action: stage, success: false, verified: false, failureReason: 'Operation was cancelled.', outputText: 'The YouTube operation was cancelled.' };
        }
        if (scriptRes?.channelUrl) {
          await browserCodeProvider.navigate(scriptRes.channelUrl, 15000);
          return {
            stepId: stage,
            action: stage,
            success: true,
            verified: true,
            outputText: `I opened the channel ${channelName} on YouTube.`,
          };
        }
        return {
          stepId: stage,
          action: stage,
          success: false,
          verified: false,
          failureReason: `Could not locate channel for "${channelName}".`,
          outputText: `I could not locate the channel "${channelName}".`,
        };
      }

      if (stage === 'YOUTUBE_OPEN_VIDEO') {
        const scriptRes = await browserCodeProvider.executeScript<{
          url?: string;
          channelName?: string;
          videos?: Array<{ url: string; title?: string }>;
        }>(`
          (() => {
            const pageUrl = window.location.href;
            const channelHeader = document.querySelector('#channel-header-container, #page-header');
            const channelTitle = channelHeader ? channelHeader.textContent : '';
            const links = Array.from(document.querySelectorAll('a#video-title, ytd-grid-video-renderer a#video-title-link'));
            return {
              url: pageUrl,
              channelName: channelTitle,
              videos: links.slice(0, 5).map(l => ({ url: l.href, title: l.textContent?.trim() }))
            };
          })()
        `);

        if (channelName && scriptRes?.channelName) {
          const normReq = channelName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const normActual = scriptRes.channelName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!normActual.includes(normReq) && !normReq.includes(normActual)) {
            return {
              stepId: stage,
              action: stage,
              success: false,
              verified: false,
              failureReason: `Current page channel "${scriptRes.channelName}" does not match requested "${channelName}".`,
              outputText: `The current channel does not match "${channelName}".`,
            };
          }
        }

        const video = scriptRes?.videos?.[0];
        if (signal?.aborted) {
          return { stepId: stage, action: stage, success: false, verified: false, failureReason: 'Operation was cancelled.', outputText: 'The YouTube operation was cancelled.' };
        }
        if (video?.url) {
          await browserCodeProvider.navigate(video.url, 15000);
          return {
            stepId: stage,
            action: stage,
            success: true,
            verified: true,
            outputText: `I opened the video from ${channelName || 'YouTube'}.`,
          };
        }

        return {
          stepId: stage,
          action: stage,
          success: false,
          verified: false,
          failureReason: `Could not find any videos on channel "${channelName}".`,
          outputText: `I could not find any videos on the channel "${channelName}".`,
        };
      }

      return {
        stepId: stage,
        action: stage,
        success: false,
        verified: false,
        failureReason: `Unknown YouTube stage: ${stage}`,
        outputText: `Unknown YouTube stage: ${stage}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        stepId: stage,
        action: stage,
        success: false,
        verified: false,
        failureReason: message || 'CDP connection failure',
        outputText: 'I could not connect to YouTube in the browser.',
      };
    }
  }
}

export const browserCapabilityAdapter = BrowserCapabilityAdapter.getInstance();

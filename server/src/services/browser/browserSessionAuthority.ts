/**
 * browserSessionAuthority.ts — Canonical Browser Session Authority & Observed Reality Contract.
 *
 * Requirements:
 * 1. ONE Authoritative resolver for: browser instance, CDP connection, session ID,
 *    active visible window, active visible tab/page, active URL, and active page title.
 * 2. Execution and verification operate against the SAME canonical browser identity.
 * 3. Immutable execution identity attached to each browser action:
 *    browserSessionId, browserContextId, targetId, windowId, windowHandle, preActionUrl, command, expectedPostCondition.
 * 4. Explicit state machine:
 *    RECEIVED -> PLANNING -> EXECUTING -> VERIFYING -> RECOVERING -> VERIFIED_SUCCESS | FAILED
 * 5. Success language can ONLY be emitted from VERIFIED_SUCCESS.
 * 6. Verification failure routes to self-heal with incident fingerprinting and deduplication.
 * 7. Truthful failure speech: "I couldn't open YouTube. The browser is still on Google."
 */

import { Page, Browser, BrowserContext } from 'playwright';
import { logger } from '../../utils/logger.js';
import {
  WindowsBrowserWindowHelper,
  browserSessionManager,
  type CanonicalBrowserSession,
  type BrowserMode,
} from './browserSession.js';

export type BrowserActionState =
  | 'RECEIVED'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'RECOVERING'
  | 'VERIFIED_SUCCESS'
  | 'FAILED';

export interface BrowserPostCondition {
  type: 'navigation' | 'search' | 'media_state' | 'dom_match' | 'history_back';
  expectedHost?: string;
  expectedHosts?: string[];
  expectedUrlPattern?: string;
  expectedTitlePattern?: string;
  expectedDomSelector?: string;
  expectedMediaPaused?: boolean;
  forbiddenHosts?: string[];
}

export interface BrowserExecutionIdentity {
  executionId: string;
  browserPid: number | null;
  hwnd: number | null;
  browserSessionId: string;
  browserContextId: string;
  targetId: string;
  windowId: number | null;
  windowHandle: number | null;
  preActionUrl: string;
  preActionTitle: string;
  command: string;
  expectedPostCondition: BrowserPostCondition;
  createdAt: number;
}

export interface ObservedRealityVerification {
  status: 'VERIFIED_SUCCESS' | 'FAILED';
  verified: boolean;
  identity: BrowserExecutionIdentity;
  observedState: {
    targetId: string;
    url: string;
    title: string;
    host: string;
    isVisible: boolean;
    isForegroundWindow: boolean;
    visibilityState?: string;
    hasFocus?: boolean;
    mediaPaused?: boolean;
    interactive: boolean;
    domMatch?: boolean;
  };
  expectedState: BrowserPostCondition;
  failureReason?: string;
  truthfulSpokenText: string;
  error?: string;
}

export interface ResolvedTargetTab {
  page: Page;
  targetId: string;
  browserPid: number | null;
  hwnd: number | null;
  browserContextId: string;
  windowHandle: number | null;
  windowId: number | null;
  currentUrl: string;
  currentTitle: string;
  currentHost: string;
}

export class CanonicalBrowserSessionAuthority {
  private static instance: CanonicalBrowserSessionAuthority;
  private readonly CDP_PORT = 9223;

  public static getInstance(): CanonicalBrowserSessionAuthority {
    if (!CanonicalBrowserSessionAuthority.instance) {
      CanonicalBrowserSessionAuthority.instance = new CanonicalBrowserSessionAuthority();
    }
    return CanonicalBrowserSessionAuthority.instance;
  }

  /**
   * Resolve the canonical active visible tab and ensure both Chrome tab and OS window are brought to front.
   */
  public async resolveCanonicalVisibleTab(
    browser: Browser,
    context: BrowserContext,
    preferredTargetId?: string,
  ): Promise<ResolvedTargetTab> {
    const pages = context.pages().filter((p) => !p.isClosed());
    if (pages.length === 0) {
      const newPage = await context.newPage();
      pages.push(newPage);
    }

    // Try finding the page by preferredTargetId or the currently focused page
    let selectedPage = pages[0];
    let selectedTargetId = 'p0';

    try {
      const cdpPages = await this.queryCdpPageTargets();
      if (preferredTargetId) {
        const matchCdp = cdpPages.find((p) => p.id === preferredTargetId);
        if (matchCdp) {
          const matchPw = pages.find((p) => p.url() === matchCdp.url || (matchCdp.url === 'about:blank' && p.url().startsWith('about:')));
          if (matchPw) {
            selectedPage = matchPw;
            selectedTargetId = matchCdp.id;
          }
        }
      }

      if (!preferredTargetId || selectedTargetId === 'p0') {
        if (cdpPages.length > 0) {
          selectedTargetId = cdpPages[0].id;
          const matchPw = pages.find((p) => p.url() === cdpPages[0].url);
          if (matchPw) selectedPage = matchPw;
        }
      }
    } catch (cdpErr: any) {
      logger.debug('[BrowserSessionAuthority] CDP query fallback:', cdpErr?.message);
    }

    // CRITICAL: Ensure the tab is activated over CDP and brought to the front inside Chrome!
    if (selectedTargetId && selectedTargetId !== 'p0') {
      await fetch(`http://127.0.0.1:${this.CDP_PORT}/json/activate/${selectedTargetId}`).catch(() => {});
    }
    await selectedPage.bringToFront().catch(() => {});

    const currentUrl = selectedPage.url();
    const currentTitle = await selectedPage.title().catch(() => '');
    let currentHost = '';
    try {
      currentHost = new URL(currentUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {}

    // Ensure OS window is in foreground
    let cdpPid: number | null = null;
    try {
      const { execFileSync } = await import('child_process');
      const out = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${this.CDP_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
      ], { encoding: 'utf8' }).trim();
      if (out) cdpPid = parseInt(out, 10);
    } catch {}

    const win = WindowsBrowserWindowHelper.inspectWindow(cdpPid ? { processId: cdpPid } : undefined, currentHost || 'Chrome');
    if (win.windowHandle) {
      WindowsBrowserWindowHelper.bringToForeground(win.windowHandle, currentHost || 'Chrome', cdpPid);
    }

    // Update canonical session manager
    const currentSession = browserSessionManager.getSession();
    const sessionId = currentSession?.sessionId || `sess-visible-${Date.now()}`;
    const browserContextId = `ctx-${Date.now()}`;

    browserSessionManager.setSession(
      {
        sessionId,
        browserType: 'system_chrome',
        visibility: 'visible',
        windowHandle: win.windowHandle,
        activePageId: selectedTargetId,
        currentUrl,
        currentTitle,
        isForeground: win.isForeground || win.isVisible,
        isMinimized: win.isMinimized,
        lastAction: 'resolve_canonical_tab',
        verificationState: 'verified',
        createdAt: currentSession?.createdAt || Date.now(),
        lastActiveAt: Date.now(),
      },
      selectedPage,
      browser,
      context,
    );

    return {
      page: selectedPage,
      targetId: selectedTargetId,
      browserPid: cdpPid,
      hwnd: win.windowHandle,
      browserContextId,
      windowHandle: win.windowHandle,
      windowId: null,
      currentUrl,
      currentTitle,
      currentHost,
    };
  }

  /** Query CDP HTTP endpoint /json for live page targets */
  public async queryCdpPageTargets(): Promise<Array<{ id: string; url: string; title: string; type: string }>> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.CDP_PORT}/json`);
      if (!res.ok) return [];
      const targets = (await res.json()) as any[];
      return targets
        .filter((t) => t.type === 'page')
        .map((t) => ({ id: t.id, url: t.url, title: t.title, type: t.type }));
    } catch {
      return [];
    }
  }

  /**
   * Create an immutable execution identity for an upcoming browser action.
   */
  public createExecutionIdentity(params: {
    command: string;
    resolvedTab: ResolvedTargetTab;
    expectedPostCondition: BrowserPostCondition;
  }): BrowserExecutionIdentity {
    const { command, resolvedTab, expectedPostCondition } = params;
    const session = browserSessionManager.getSession();

    return {
      executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      browserPid: resolvedTab.browserPid,
      hwnd: resolvedTab.hwnd || resolvedTab.windowHandle,
      browserSessionId: session?.sessionId || `sess-visible-${Date.now()}`,
      browserContextId: resolvedTab.browserContextId,
      targetId: resolvedTab.targetId,
      windowId: resolvedTab.windowId,
      windowHandle: resolvedTab.windowHandle,
      preActionUrl: resolvedTab.currentUrl,
      preActionTitle: resolvedTab.currentTitle,
      command,
      expectedPostCondition,
      createdAt: Date.now(),
    };
  }

  /**
   * INDEPENDENT OBSERVED REALITY VERIFICATION
   *
   * Verifies the requested post-condition against the SAME live browser session/tab/window.
   * Command execution success is NOT task success.
   */
  public async verifyObservedReality(
    identity: BrowserExecutionIdentity,
    page: Page,
  ): Promise<ObservedRealityVerification> {
    const postCond = identity.expectedPostCondition;

    // 1. Confirm target page is live and not closed
    if (page.isClosed()) {
      return {
        status: 'FAILED',
        verified: false,
        identity,
        observedState: {
          targetId: identity.targetId,
          url: '',
          title: '',
          host: '',
          isVisible: false,
          isForegroundWindow: false,
          visibilityState: 'hidden',
          hasFocus: false,
          interactive: false,
        },
        expectedState: postCond,
        failureReason: 'target_page_closed',
        truthfulSpokenText: `The browser tab was closed unexpectedly.`,
        error: 'Target page is closed',
      };
    }

    // 2. Wait for stabilization
    await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);

    // 3. Inspect live page state
    const observedUrl = page.url();
    const observedTitle = await page.title().catch(() => '');
    let observedHost = '';
    try {
      observedHost = new URL(observedUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {}

    // Check desktop window visibility
    const inspectTarget = identity.hwnd ? identity.hwnd : (identity.browserPid ? { processId: identity.browserPid } : undefined);
    const win = WindowsBrowserWindowHelper.inspectWindow(inspectTarget, postCond.expectedHost || 'Chrome');
    const isVisible = win.isVisible;
    const isForeground = win.isForeground;
    const isMinimized = win.isMinimized;

    // Check DOM visibility state & focus
    let domVisState = 'hidden';
    let domHasFocus = false;
    try {
      const evalRes = await page.evaluate(() => ({
        visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'visible',
        hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true,
      }));
      if (typeof evalRes === 'object' && evalRes !== null) {
        domVisState = evalRes.visibilityState || 'visible';
        domHasFocus = Boolean(evalRes.hasFocus);
      }
    } catch {}

    // Check media state if post-condition specifies
    let mediaPaused: boolean | undefined = undefined;
    if (postCond.type === 'media_state' || postCond.expectedMediaPaused !== undefined) {
      try {
        const evalMedia = await page.evaluate(() => {
          const video = document.querySelector('video') as HTMLVideoElement | null;
          return video ? video.paused : true;
        });
        mediaPaused = typeof evalMedia === 'boolean' ? evalMedia : true;
      } catch {
        mediaPaused = true;
      }
    }

    // Check DOM selector if specified
    let domMatch = true;
    if (postCond.expectedDomSelector) {
      try {
        const elCount = await page.locator(postCond.expectedDomSelector).count();
        domMatch = elCount > 0;
      } catch {
        domMatch = false;
      }
    }

    // 4. Verify post-condition constraints
    let passed = true;
    let failureReason = '';

    // Check forbidden hosts (e.g. search engine results when expecting direct site)
    const forbidden = postCond.forbiddenHosts || ['google.com/search', 'bing.com/search', 'chrome-error://'];
    for (const f of forbidden) {
      if (observedUrl.toLowerCase().includes(f.toLowerCase())) {
        passed = false;
        failureReason = `browser_redirected_to_forbidden:${f}`;
        break;
      }
    }

    // Check target visibility and window state
    if (passed && isMinimized) {
      if (win.windowHandle) {
        WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
      }
      const recheck = WindowsBrowserWindowHelper.inspectWindow(win.windowHandle, 'Chrome');
      if (recheck.isMinimized) {
        passed = false;
        failureReason = 'window_minimized';
      }
    }

    if (passed && (!isVisible || !win.windowHandle)) {
      passed = false;
      failureReason = 'window_not_visible';
    }

    if (passed && domVisState === 'hidden') {
      passed = false;
      failureReason = 'target_not_visible';
    }

    if (passed && (!isForeground || !domHasFocus)) {
      passed = false;
      failureReason = 'window_not_foreground';
    }

    // Check active CDP target matches execution identity
    if (passed && identity.targetId && identity.targetId !== 'p0') {
      try {
        const cdpTargets = await this.queryCdpPageTargets();
        if (cdpTargets.length > 0) {
          const activeTarget = cdpTargets[0];
          if (activeTarget && activeTarget.id !== identity.targetId && cdpTargets.some((t) => t.id === identity.targetId)) {
            passed = false;
            failureReason = `background_target_mismatch:active=${activeTarget.id}_expected=${identity.targetId}`;
          }
        }
      } catch {}
    }

    if (passed && postCond.type === 'navigation') {
      const allowedHosts = postCond.expectedHosts && postCond.expectedHosts.length > 0
        ? postCond.expectedHosts.map((h) => h.toLowerCase().replace(/^www\./, ''))
        : postCond.expectedHost
          ? [postCond.expectedHost.toLowerCase().replace(/^www\./, '')]
          : [];

      if (allowedHosts.length > 0) {
        const matchesAnyHost = allowedHosts.some((h) => observedHost === h || observedHost.endsWith(`.${h}`));
        if (!matchesAnyHost) {
          passed = false;
          failureReason = `host_mismatch:expected=[${allowedHosts.join(',')}]_observed=${observedHost}`;
        }
      }
    }

    if (passed && postCond.type === 'search') {
      const allowedHosts = postCond.expectedHosts || (postCond.expectedHost ? [postCond.expectedHost] : ['youtube.com', 'google.com']);
      const matchesHost = allowedHosts.some((h) => observedHost.includes(h.toLowerCase().replace(/^www\./, '')));
      const hasSearchIndicator =
        observedUrl.includes('search') ||
        observedUrl.includes('results') ||
        observedUrl.includes('query=') ||
        domMatch;

      if (!matchesHost || !hasSearchIndicator) {
        passed = false;
        failureReason = `search_not_observed:host=${observedHost},hasIndicator=${hasSearchIndicator}`;
      }
    }

    if (passed && postCond.type === 'media_state' && postCond.expectedMediaPaused !== undefined) {
      if (mediaPaused !== postCond.expectedMediaPaused) {
        passed = false;
        failureReason = `media_state_mismatch:expectedPaused=${postCond.expectedMediaPaused}_observed=${mediaPaused}`;
      }
    }

    if (passed && postCond.type === 'history_back') {
      if (observedUrl === identity.preActionUrl && identity.preActionUrl !== '') {
        passed = false;
        failureReason = 'history_did_not_change';
      }
    }

    // 5. Generate Truthful Response Speech
    let truthfulSpokenText = '';
    const rawName = identity.command.replace(/^(?:jarvis,?\s*)?(?:open|go to|navigate to|visit)\s+/i, '').trim();
    const targetName = rawName.length > 0 && !rawName.includes('.')
      ? rawName
      : (postCond.expectedHost?.toLowerCase().includes('youtube')
          ? 'YouTube'
          : postCond.expectedHost?.toLowerCase().includes('google')
            ? 'Google'
            : (postCond.expectedHost || 'the requested site'));

    if (passed) {
      if (postCond.type === 'media_state') {
        truthfulSpokenText = postCond.expectedMediaPaused ? 'Paused.' : 'Playing.';
      } else if (postCond.type === 'history_back') {
        truthfulSpokenText = 'Went back.';
      } else if (postCond.type === 'search') {
        truthfulSpokenText = `Searched for ${postCond.expectedUrlPattern || 'your query'}.`;
      } else {
        truthfulSpokenText = `I've opened ${targetName}.`;
      }
    } else {
      // Truthful failure language — NEVER fake success
      if (failureReason === 'window_not_visible' || failureReason === 'window_minimized' || failureReason === 'target_not_visible') {
        truthfulSpokenText = `${targetName} loaded in the background browser, but I couldn't bring the window into view.`;
      } else {
        const prettyObserved = observedHost.includes('google')
          ? 'Google'
          : observedHost.includes('youtube')
            ? 'YouTube'
            : (observedHost || 'the previous page');

        if (postCond.type === 'navigation') {
          truthfulSpokenText = `I couldn't open ${targetName}. The browser is still on ${prettyObserved}.`;
        } else if (postCond.type === 'media_state') {
          truthfulSpokenText = `I couldn't ${postCond.expectedMediaPaused ? 'pause' : 'resume'} the media.`;
        } else if (postCond.type === 'history_back') {
          truthfulSpokenText = `I couldn't go back. The browser is still on ${prettyObserved}.`;
        } else {
          truthfulSpokenText = `The browser action did not succeed. The browser is currently on ${prettyObserved}.`;
        }
      }
    }

    const verification: ObservedRealityVerification = {
      status: passed ? 'VERIFIED_SUCCESS' : 'FAILED',
      verified: passed,
      identity,
      observedState: {
        targetId: identity.targetId,
        url: observedUrl,
        title: observedTitle,
        host: observedHost,
        isVisible,
        isForegroundWindow: isForeground,
        visibilityState: domVisState,
        hasFocus: domHasFocus,
        mediaPaused,
        interactive: true,
        domMatch,
      },
      expectedState: postCond,
      failureReason: passed ? undefined : failureReason,
      truthfulSpokenText,
      error: passed ? undefined : failureReason,
    };

    if (!passed) {
      logger.warn('[BrowserSessionAuthority] Post-condition verification FAILED:', {
        command: identity.command,
        failureReason,
        expected: postCond,
        observed: verification.observedState,
      });
    } else {
      logger.info('[BrowserSessionAuthority] Post-condition verification SUCCEEDED:', {
        command: identity.command,
        observedUrl,
        observedHost,
      });
    }

    return verification;
  }
}

export const browserSessionAuthority = CanonicalBrowserSessionAuthority.getInstance();

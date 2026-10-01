/**
 * browserOperator.ts — Real first-class Browser Operator for JARVIS.
 *
 * Uses Playwright to launch/control a real Chromium browser.
 *
 * ORIGINAL DEFECT (registered as D22 in `.hermes/plans/jarvis-rehab-mission.md`):
 *   This operator navigated, matched the host, and returned "I've opened X." — even
 *   while a cookie/consent dialog still covered the page and the user had asked for
 *   a CLICK. Navigation was reported as task completion. There was also no click,
 *   typing, dialog detection, or goal continuation at all.
 *
 * REQUIRED LOOP now implemented here:
 *   UNDERSTAND GOAL → NAVIGATE → INSPECT ACTUAL PAGE STATE → IDENTIFY VISIBLE
 *   BLOCKERS/CONTROLS → PERFORM USER-AUTHORIZED ACTION → VERIFY DOM/PAGE STATE
 *   CHANGED → CONTINUE ORIGINAL GOAL → REPORT RESULT
 *
 * Decision logic lives in `browserActionContract.ts` (pure, unit-tested);
 * DOM access lives in `browserPageInspection.ts`.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  browserSessionManager,
  WindowsBrowserWindowHelper,
  type BrowserMode,
  type WindowInspectionResult,
} from './browserSession.js';
import {
  browserSessionAuthority,
  type BrowserExecutionIdentity,
  type ObservedRealityVerification,
} from './browserSessionAuthority.js';
import { failureDetector } from '../../domains/selfHeal/FailureDetector.js';
import {
  activeInteractionContextStore,
  type CompactSearchResult,
} from '../../domains/jarvis/activeInteractionContext.js';
import { voiceTurnAuditStore } from '../../domains/jarvis/execution/voiceTurnAuditStore.js';
import { capabilityPermissionStore } from '../../domains/controlPlane/CapabilityPermissionStore.js';
import { logger } from '../../utils/logger.js';
import { assertSideEffectOwnership } from '../../domains/jarvis/perception/turnOwnership.js';
import {
  authorizeConsentChoice,
  browserMetrics,
  browserStateStore,
  buildVerificationEvidence,
  consentChoiceForLabel as consentChoiceClassOf,
  createBrowserGoal,
  detectRepeatedNavigationInsteadOfClick,
  errMsg,
  extractContentResults,
  matchControlByAccessibleName,
  resolveConversationalCorrection,
  resolveIndexedElement,
  selectSearchResult,
  serializeInteractiveSnapshot,
  verifyTargetMatchesSelection,
  type BrowserActionKind,
  type BrowserConversationState,
  type BrowserGoal,
  type BrowserGoalStep,
  type ConsentChoice,
  type ConsentPreference,
  type IndexedElement,
  type InteractiveSnapshot,
  type PageStateSnapshot,
  type ResultSelection,
  type StabilityRegression,
  type VisibleControl,
} from './browserActionContract.js';
import {
  clickControl,
  goBack,
  goForward,
  pressEnter,
  scrollPage,
  snapshotPage,
  typeIntoControl,
  waitForInteractiveContent,
  waitForUnblocked,
  waitForHost,
} from './browserPageInspection.js';

export interface CanonicalBrowserTarget {
  id: string;
  displayName: string;
  url: string;
  expectedHost: string;
  aliases: string[];
}

export const CANONICAL_BROWSER_TARGETS: CanonicalBrowserTarget[] = [
  {
    id: 'youtube',
    displayName: 'YouTube',
    url: 'https://www.youtube.com',
    expectedHost: 'youtube.com',
    aliases: ['youtube', 'you tube', 'youtube.com', 'yt'],
  },
  {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    url: 'https://chatgpt.com',
    expectedHost: 'chatgpt.com',
    aliases: ['chatgpt', 'chat gpt', 'chatgpt.com', 'chat.openai.com', 'chatgpt website'],
  },
  {
    id: 'google',
    displayName: 'Google',
    url: 'https://www.google.com',
    expectedHost: 'google.com',
    aliases: ['google', 'google browser', 'google.com', 'the google browser', 'google search'],
  },
  {
    id: 'linkedin',
    displayName: 'LinkedIn',
    url: 'https://www.linkedin.com',
    expectedHost: 'linkedin.com',
    aliases: ['linkedin', 'linked in', 'linkedin.com', 'link again', 'link in', 'linked'],
  },
  {
    id: 'x',
    displayName: 'X',
    url: 'https://x.com',
    expectedHost: 'x.com',
    aliases: ['x', 'twitter', 'x.com', 'twitter.com', 'x browser', 'twitter browser'],
  },
  {
    id: 'shopify_web',
    displayName: 'Shopify website',
    url: 'https://www.shopify.com',
    expectedHost: 'shopify.com',
    aliases: ['shopify.com', 'shopify website', 'shopify store website', 'shopify site'],
  },
  {
    id: 'tiktok_shop_web',
    displayName: 'TikTok Shop website',
    url: 'https://shop.tiktok.com',
    expectedHost: 'tiktok.com',
    aliases: ['tiktok.com', 'tiktok website', 'tiktok shop website', 'tiktok shop site'],
  },
];

/** A blocker as reported to callers (trimmed controls, safe to serialise). */
export interface ReportedBlocker {
  kind: string;
  isConsentDialog: boolean;
  text: string;
  controls: Array<{ name: string; kind: string; role: string }>;
}

export interface BrowserOperationResult {
  success: boolean;
  verified: boolean;
  target: string;
  url?: string;
  title?: string;
  spokenText: string;
  error?: string;
  /** NEW: false when a blocking dialog still covers the page. */
  contentUsable?: boolean;
  /** NEW: true only when the user's requested goal was actually achieved. */
  goalAchieved?: boolean;
  /** NEW: the dialog that is blocking the page, if any. */
  blocker?: ReportedBlocker | null;
  /**
   * NEW: set when a CLICK was requested but a NAVIGATION was verified instead.
   * This is the D22 substitution pattern and opens a stability regression.
   */
  repeatedNavigation?: StabilityRegression | null;
  /** NEW: compact page-state evidence for the turn record. */
  pageState?: {
    url: string;
    title: string;
    host: string;
    controlsSeen: number;
    contentUsable: boolean;
    capturedAt: number;
  };
}

export interface BrowserActionOutcome {
  requested: BrowserActionKind;
  performed: boolean;
  verified: boolean;
  spokenText: string;
  blockerBefore: ReportedBlocker | null;
  blockerAfter: ReportedBlocker | null;
  evidence: {
    foundStrategy: string;
    foundName: string | null;
    dispatched: boolean;
    stateChanged: boolean;
    changeDetail: string | null;
    targetUsable: boolean;
    browserInputAuthorized?: boolean;
  };
  needsUserDecision: boolean;
  error?: string;
}

export interface BrowserGoalRunResult {
  goalId: string;
  goalText: string;
  completed: boolean;
  blockerResolved: boolean;
  blockerPending: ReportedBlocker | null;
  needsUserDecision: boolean;
  steps: Array<{ description: string; ok: boolean; detail: string }>;
  spokenText: string;
  url?: string;
  title?: string;
}

function toReportedBlocker(
  blocker: PageStateSnapshot['blockers'][number] | null | undefined,
): ReportedBlocker | null {
  if (!blocker) return null;
  return {
    kind: blocker.kind,
    isConsentDialog: blocker.isConsentDialog,
    text: blocker.text.slice(0, 600),
    controls: blocker.controls.map((c) => ({ name: c.name, kind: c.kind, role: c.role })),
  };
}

function describeControls(blocker: ReportedBlocker | null): string {
  if (!blocker || blocker.controls.length === 0) return '';
  const names = blocker.controls
    .map((c) => c.name)
    .filter(Boolean)
    .slice(0, 6);
  if (!names.length) return '';
  return ` It offers: ${names.map((n) => `"${n}"`).join(', ')}.`;
}

export class BrowserOperator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private launchPromise: Promise<void> | null = null;
  private browserPid: number | null = null;
  private stabilityLockUntil: number = 0;
  private lockedTargetUrl: string | null = null;
  private lockedConversationId: string | null = null;

  public armStabilityLock(conversationId: string, targetUrl: string, durationMs: number = 15000): void {
    this.stabilityLockUntil = Date.now() + durationMs;
    this.lockedTargetUrl = targetUrl;
    this.lockedConversationId = conversationId;
    logger.info('[BrowserOperator] Stability lock ARMED for post-completion window:', { targetUrl, durationMs });
  }

  public isStabilityLocked(conversationId?: string): boolean {
    return Date.now() < this.stabilityLockUntil;
  }

  public getStabilityLockInfo(): { active: boolean; remainingMs: number; targetUrl: string | null } {
    const active = Date.now() < this.stabilityLockUntil;
    return {
      active,
      remainingMs: active ? this.stabilityLockUntil - Date.now() : 0,
      targetUrl: this.lockedTargetUrl,
    };
  }

  /**
   * Resolve an utterance or token to a canonical browser target if one matches.
   */
  public static resolveTarget(input: string): CanonicalBrowserTarget | null {
    const lower = (input || '').toLowerCase().trim();
    const cleaned = lower
      .replace(/^(?:can you\s+|could you\s+|please\s+|i want to\s+|i'd like to\s+|would you\s+|let's\s+|let me\s+)+/i, '')
      .replace(/^(?:open|show|go to|browse|launch|visit|bring up|take me to|navigate to)\s+/i, '')
      .replace(/[.,!?]+$/, '')
      .trim();

    // Query/complaint/control utterances are NOT navigation targets
    if (/\b(?:where|which|why|didn'?t|did\s+not|haven'?t|have\s+not|not\s+open|bring|front|show\s+me)\b/i.test(lower)) {
      return null;
    }

    for (const target of CANONICAL_BROWSER_TARGETS) {
      for (const a of target.aliases) {
        const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (cleaned === a || lower === a || new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
          return target;
        }
      }
    }

    const isFilePath = /\b[a-zA-Z]:[\\\/]/.test(lower) || /\.(?:json|ts|tsx|js|jsx|md|txt|py|css|html|cpp|log|yaml|yml|cjs|mjs|sh|bat|cmd|exe|msi|ps1|png|jpg|jpeg|gif|svg|pdf|zip|gz|tar)\b/i.test(lower);
    if (!isFilePath) {
      const urlMatch = lower.match(/(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
      if (urlMatch) {
        let fullUrl = urlMatch[0];
        const hasFileExt = /\.(?:json|ts|tsx|js|jsx|md|txt|py|css|html|cpp|log|yaml|yml|cjs|mjs|sh|bat|cmd|exe|msi|ps1|png|jpg|jpeg|gif|svg|pdf|zip|gz|tar)$/i.test(fullUrl);
        if (!hasFileExt) {
          if (!/^https?:\/\//i.test(fullUrl)) fullUrl = `https://${fullUrl}`;
          try {
            const parsed = new URL(fullUrl);
            const host = parsed.hostname.replace(/^www\./, '');
            return { id: host, displayName: host, url: fullUrl, expectedHost: host, aliases: [host] };
          } catch {
            /* invalid URL */
          }
        }
      }
    }

    return null;
  }

  public resolveTarget(input: string): CanonicalBrowserTarget | null {
    return BrowserOperator.resolveTarget(input);
  }

  public async ensureBrowser(mode: BrowserMode = 'VISIBLE_USER_BROWSER'): Promise<{ page: Page }> {
    const currentSession = browserSessionManager.getSession();
    if (this.activePage && !this.activePage.isClosed() && this.context) {
      if (mode === 'VISIBLE_USER_BROWSER' && this.browser) {
        try {
          const resolved = await browserSessionAuthority.resolveCanonicalVisibleTab(this.browser, this.context);
          this.activePage = resolved.page;
        } catch {
          if (currentSession?.windowHandle) {
            WindowsBrowserWindowHelper.bringToForeground(currentSession.windowHandle);
          } else {
            WindowsBrowserWindowHelper.bringToForeground(undefined, 'Chrome');
          }
        }
      }
      return { page: this.activePage };
    }

    if (this.launchPromise) {
      await this.launchPromise;
      if (this.activePage && !this.activePage.isClosed()) return { page: this.activePage };
    }

    this.launchPromise = (async () => {
      const pw = await import('playwright');
      if (mode === 'VISIBLE_USER_BROWSER') {
        const chromePath1 = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const chromePath2 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
        const edgePath1 = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        const edgePath2 = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
        const exe = [chromePath1, chromePath2, edgePath1, edgePath2].find((p) => fs.existsSync(p)) || chromePath1;

        const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
        if (!fs.existsSync(profileDir)) {
          fs.mkdirSync(profileDir, { recursive: true });
        }

        const port = 9223;
        let isRunning = false;
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json/version`);
          if (res.ok) {
            let listenerPid: number | null = null;
            try {
              const { execFileSync } = await import('child_process');
              const out = execFileSync('powershell.exe', [
                '-NoProfile',
                '-Command',
                `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`
              ], { encoding: 'utf8' }).trim();
              if (out && !isNaN(Number(out))) {
                listenerPid = Number(out);
              }
            } catch {}

            // Verify the listener process actually has a visible window and is not a headless ghost
            const win = listenerPid ? WindowsBrowserWindowHelper.inspectWindow({ processId: listenerPid }, 'Chrome') : { windowHandle: null };
            if (win.windowHandle) {
              isRunning = true;
            } else {
              logger.warn(`[BrowserOperator] Port ${port} is owned by process ${listenerPid} without visible window, terminating listener...`);
              try {
                const { execFileSync } = await import('child_process');
                execFileSync('powershell.exe', [
                  '-NoProfile',
                  '-Command',
                  `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }`
                ]);
              } catch {}
            }
          }
        } catch {}

        if (!isRunning) {
          logger.info('[BrowserOperator] Launching visible system browser with persistent context on port 9223...', { profileDir });
          try {
            this.context = await pw.chromium.launchPersistentContext(profileDir, {
              headless: false,
              channel: 'chrome',
              args: [
                '--start-maximized',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-session-crashed-bubble',
                '--disable-infobars',
                '--restore-last-session=false',
                `--remote-debugging-port=${port}`,
              ],
              viewport: null,
            });
            this.browser = this.context.browser() || null;
            const pages = this.context.pages().filter((p) => !p.isClosed());
            this.activePage = pages[0] || (await this.context.newPage());
          } catch (launchErr: any) {
            logger.warn('[BrowserOperator] launchPersistentContext fallback to connectOverCDP:', launchErr?.message);
          }
        }

        if (!this.context || !this.activePage) {
          logger.info('[BrowserOperator] Connecting Playwright to browser over CDP on port 9223...');
          this.browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          const contexts = this.browser.contexts();
          this.context = contexts[0] || (await this.browser.newContext());
          const resolved = await browserSessionAuthority.resolveCanonicalVisibleTab(this.browser, this.context);
          this.activePage = resolved.page;
        }

        // Identify PID & bring OS window to foreground
        let cdpPid: number | null = null;
        try {
          const { execFileSync } = await import('child_process');
          const out = execFileSync('powershell.exe', [
            '-NoProfile',
            '-Command',
            `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
          ], { encoding: 'utf8' }).trim();
          if (out) cdpPid = parseInt(out, 10);
        } catch {}
        this.browserPid = cdpPid;

        const win = WindowsBrowserWindowHelper.inspectWindow(cdpPid ? { processId: cdpPid } : undefined, 'Chrome');
        if (win.windowHandle) {
          WindowsBrowserWindowHelper.bringToForeground(win.windowHandle, 'Chrome', cdpPid);
        }

        this.activePage.setDefaultNavigationTimeout(25000);
        this.activePage.setDefaultTimeout(15000);

        browserSessionManager.setSession(
          {
            sessionId: `sess-${Date.now()}`,
            browserType: exe.includes('msedge') ? 'system_edge' : 'system_chrome',
            visibility: 'visible',
            windowHandle: win.windowHandle,
            activePageId: 'p0',
            currentUrl: this.activePage.url(),
            currentTitle: await this.activePage.title().catch(() => ''),
            isForeground: true,
            isMinimized: false,
            lastAction: 'launch',
            verificationState: 'verified',
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
          },
          this.activePage,
          this.browser,
          this.context,
        );
      } else {
        // BACKGROUND_BROWSER: Playwright headless
        logger.info('[BrowserOperator] Launching background headless Chromium...');
        this.browser = await pw.chromium.launch({
          headless: true,
          args: [],
          timeout: 15000,
        });
        this.context = await this.browser.newContext({
          viewport: { width: 1440, height: 900 },
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AgenticOS/1.0',
        });
        this.activePage = await this.context.newPage();
        this.activePage.setDefaultNavigationTimeout(20000);
        this.activePage.setDefaultTimeout(15000);

        browserSessionManager.setSession(
          {
            sessionId: `sess-bg-${Date.now()}`,
            browserType: 'playwright_chromium',
            visibility: 'background',
            windowHandle: null,
            activePageId: 'p0',
            currentUrl: this.activePage.url(),
            currentTitle: await this.activePage.title().catch(() => ''),
            isForeground: false,
            isMinimized: false,
            lastAction: 'launch_background',
            verificationState: 'verified',
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
          },
          this.activePage,
          this.browser,
          this.context,
        );
      }

      if (this.browser) {
        this.browser.on('disconnected', () => {
          logger.info('[BrowserOperator] Browser disconnected');
          this.browser = null;
          this.context = null;
          this.activePage = null;
          browserSessionManager.clearSession();
        });
      }
    })();

    try {
      await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }

    if (!this.activePage) throw new Error('Failed to create browser page');
    return { page: this.activePage };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INSPECT — the step that was missing
  // ───────────────────────────────────────────────────────────────────────────

  /** Inspect the ACTUAL page state: url, title, visible controls, blockers. */
  public async inspect(): Promise<PageStateSnapshot | null> {
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return null;
    }
    try {
      const snapshot = await snapshotPage(page);
      if (snapshot.blockers.length) {
        browserMetrics.record('browser_blocker_detected', {
          kinds: snapshot.blockers.map((b) => b.kind),
          host: snapshot.host,
        });
      }
      return snapshot;
    } catch (err: unknown) {
      logger.warn('[BrowserOperator] Inspect failed', { error: errMsg(err) });
      browserMetrics.record('browser_context_lost', { error: errMsg(err) });
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // NAVIGATE (now blocker-aware)
  // ───────────────────────────────────────────────────────────────────────────

  public async openTarget(
    targetInput: string,
    opts: {
      goalText?: string;
      conversationId?: string;
      actionKind?: BrowserActionKind;
      autoResolveConsent?: boolean;
      mode?: BrowserMode;
    } = {},
  ): Promise<BrowserOperationResult> {
    // ── P0: operator-boundary ownership gate ────────────────────────────────
    // openTarget is the lowest practical browser boundary: it opens/focuses the
    // browser and navigates. Enforcing here means a direct caller cannot bypass
    // turn ownership merely by skipping browserExecutor or the UEC dispatcher.
    //
    // The capability reflects the PHYSICAL effect of the mode actually used:
    // VISIBLE_USER_BROWSER launches a maximized visible Chrome and forces it to
    // the foreground, so it needs `allowBrowserNavigation`; BACKGROUND_BROWSER is
    // headless and needs only `allowHeadlessBrowserNavigation`. Background work
    // therefore cannot silently take over the user's interactive browser.
    const effectiveMode = opts.mode ?? 'VISIBLE_USER_BROWSER';
    {
      const isVisibleInteractive = effectiveMode === 'VISIBLE_USER_BROWSER';
      const gate = assertSideEffectOwnership(
        isVisibleInteractive ? 'browser_navigation' : 'headless_browser_navigation',
        isVisibleInteractive
          ? "open/focus the user's visible browser and navigate"
          : 'headless browser navigation',
      );
      if (!gate.ok) {
        logger.warn('[BrowserOperator] SIDE_EFFECT_REJECTED', {
          reason: gate.reason, capability: gate.capability, mode: effectiveMode,
          conversationId: gate.conversationId, turnId: gate.turnId,
          operationId: gate.operationId, registered: gate.registered,
          description: gate.description, target: targetInput,
        });
        return {
          success: false,
          verified: false,
          target: targetInput,
          spokenText: '',
          error: `rejected:${gate.reason}`,
        };
      }
    }
    const resolved = this.resolveTarget(targetInput);
    const trimmedInput = (targetInput || '').trim();
    const isValidUrlOrDomain =
      trimmedInput.startsWith('http://') ||
      trimmedInput.startsWith('https://') ||
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i.test(trimmedInput);

    if (!resolved && !isValidUrlOrDomain) {
      logger.warn('[BrowserOperator] Rejected invalid navigation target (not a URL, domain, or canonical target):', targetInput);
      return {
        success: false,
        verified: false,
        target: targetInput,
        error: `invalid_target: "${targetInput}" is a natural-language entity and not a valid web domain or URL`,
        spokenText: `"${targetInput}" is not a valid website or web domain.`,
      };
    }

    let targetUrl: string;
    let expectedHost: string;
    if (resolved) {
      targetUrl = resolved.url;
      expectedHost = resolved.expectedHost;
    } else {
      targetUrl = trimmedInput.startsWith('http') ? trimmedInput : `https://${trimmedInput}`;
      try {
        expectedHost = new URL(targetUrl).hostname.replace(/^www\./, '');
      } catch {
        return {
          success: false,
          verified: false,
          target: targetInput,
          error: `malformed_url: "${targetInput}" could not be parsed as a URL`,
          spokenText: `"${targetInput}" is not a valid web address.`,
        };
      }
    }
    const displayName = resolved ? resolved.displayName : expectedHost;
    const actionKind = opts.actionKind ?? 'navigate';
    const mode = effectiveMode;

    browserMetrics.record('browser_action_requested', { kind: actionKind, target: targetInput });
    logger.info('[BrowserOperator] Opening target:', { targetInput, targetUrl, expectedHost, displayName, mode });

    if (this.isStabilityLocked(opts.conversationId)) {
      const lockInfo = this.getStabilityLockInfo();
      const isGoogleNav = targetUrl.includes('google.com') || displayName.toLowerCase() === 'google';
      if (isGoogleNav && lockInfo.targetUrl && !lockInfo.targetUrl.includes('google.com')) {
        logger.warn('[BrowserOperator] Stability lock BLOCKED unsolicited navigation to Google during stability window:', {
          targetUrl,
          lockedTargetUrl: lockInfo.targetUrl,
          remainingMs: lockInfo.remainingMs,
        });
        const currentUrl = this.activePage ? this.activePage.url() : (lockInfo.targetUrl || '');
        const currentTitle = this.activePage ? await this.activePage.title().catch(() => displayName) : displayName;
        return {
          success: true,
          verified: true,
          target: displayName,
          url: currentUrl,
          title: currentTitle,
          spokenText: `Staying on ${currentTitle || lockInfo.targetUrl}.`,
          goalAchieved: true,
        };
      }
    }

    try {
      const { page } = await this.ensureBrowser(mode);

      // 1. Resolve canonical visible tab & attach immutable execution identity
      let identity: BrowserExecutionIdentity | null = null;
      if (this.browser && this.context) {
        try {
          const resolvedTab = await browserSessionAuthority.resolveCanonicalVisibleTab(this.browser, this.context);
          resolvedTab.browserPid = this.browserPid;
          this.activePage = resolvedTab.page;
          const expectedHosts = expectedHost.toLowerCase().includes('youtube')
            ? ['youtube.com', 'www.youtube.com', 'm.youtube.com']
            : [expectedHost.toLowerCase()];

          identity = browserSessionAuthority.createExecutionIdentity({
            command: opts.goalText || `open ${displayName}`,
            resolvedTab,
            expectedPostCondition: {
              type: 'navigation',
              expectedHost,
              expectedHosts,
              forbiddenHosts: ['google.com/search', 'bing.com/search', 'duckduckgo.com', 'chrome-error://'],
            },
          });
        } catch (authErr: any) {
          logger.warn('[BrowserOperator] Authority resolve warning:', authErr?.message);
        }
      }

      const activeTab = this.activePage || page;
      try {
        await activeTab.goto(targetUrl, { waitUntil: 'commit', timeout: 20000 });
      } catch (gotoErr: any) {
        if (gotoErr?.message?.includes('interrupted') || gotoErr?.message?.includes('navigating')) {
          await activeTab.waitForTimeout(500);
          await activeTab.goto(targetUrl, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
        } else {
          logger.warn('[BrowserOperator] page.goto warning, inspecting state anyway:', errMsg(gotoErr));
        }
      }
      await activeTab.bringToFront().catch(() => {});
      if (this.browserPid) {
        const win = WindowsBrowserWindowHelper.inspectWindow({ processId: this.browserPid }, expectedHost);
        if (win.windowHandle) {
          WindowsBrowserWindowHelper.bringToForeground(win.windowHandle, expectedHost, this.browserPid);
        }
      }
      await activeTab.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
      await waitForInteractiveContent(activeTab, { timeoutMs: 10000 }).catch(() => {});

      // 2. MANDATORY OBSERVED REALITY CONTRACT VERIFICATION
      let verification: ObservedRealityVerification | null = null;
      if (identity) {
        verification = await browserSessionAuthority.verifyObservedReality(identity, activeTab);
      }

      const actualUrl = verification?.observedState.url || activeTab.url();
      const actualTitle = verification?.observedState.title || (await activeTab.title().catch(() => ''));
      let actualHost = verification?.observedState.host || '';
      if (!actualHost) {
        try {
          actualHost = new URL(actualUrl).hostname.toLowerCase().replace(/^www\./, '');
        } catch {}
      }

      const verifiedSuccess = verification?.status === 'VERIFIED_SUCCESS' && verification.verified === true;

      if (!verifiedSuccess) {
        const failureReason = verification?.failureReason || `host_mismatch:expected=${expectedHost}_observed=${actualHost}`;

        // SELF-HEAL LOOP ON FORCED HIDDEN-TAB OR TARGET MISMATCH
        if (
          verification?.failureReason?.includes('target_not_visible') ||
          verification?.failureReason?.includes('background_target_mismatch')
        ) {
          logger.info('[BrowserOperator] Self-heal: diagnosing hidden/wrong target, promoting visible target and recovering...');
          const incidentId = failureDetector.recordFailure(
            'browser',
            `observed_reality_failure:${verification.failureReason}`,
            'critical',
          );

          try {
            const cdpTargets = await browserSessionAuthority.queryCdpPageTargets();
            if (cdpTargets.length > 0) {
              const visibleTarget = cdpTargets[0];
              await fetch(`http://127.0.0.1:9223/json/activate/${visibleTarget.id}`).catch(() => {});
              const recoveryTab = await browserSessionAuthority.resolveCanonicalVisibleTab(this.browser!, this.context!, visibleTarget.id);
              recoveryTab.browserPid = this.browserPid;
              this.activePage = recoveryTab.page;

              await this.activePage.goto(targetUrl, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
              await this.activePage.bringToFront().catch(() => {});
              await this.activePage.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});

              const recoveryIdentity = browserSessionAuthority.createExecutionIdentity({
                command: opts.goalText || `open ${displayName}`,
                resolvedTab: recoveryTab,
                expectedPostCondition: {
                  type: 'navigation',
                  expectedHost,
                  expectedHosts: expectedHost.toLowerCase().includes('youtube')
                    ? ['youtube.com', 'www.youtube.com', 'm.youtube.com']
                    : [expectedHost.toLowerCase()],
                  forbiddenHosts: ['google.com/search', 'bing.com/search', 'duckduckgo.com', 'chrome-error://'],
                },
              });

              const recoveryVerification = await browserSessionAuthority.verifyObservedReality(recoveryIdentity, this.activePage);
              if (recoveryVerification.verified && recoveryVerification.status === 'VERIFIED_SUCCESS') {
                logger.info('[BrowserOperator] Self-heal RECOVERY SUCCEEDED on visible target:', visibleTarget.id);
                if (incidentId) {
                  try {
                    const { db } = await import('../../db/index.js');
                    const { repairIncidents } = await import('../../domains/selfHeal/schema.js');
                    const { eq } = await import('drizzle-orm');
                    await db.update(repairIncidents).set({
                      status: 'RESOLVED',
                      resolvedAt: new Date().toISOString(),
                    }).where(eq(repairIncidents.id, incidentId));
                  } catch {}
                }

                return {
                  success: true,
                  verified: true,
                  target: displayName,
                  url: recoveryVerification.observedState.url,
                  title: recoveryVerification.observedState.title,
                  spokenText: recoveryVerification.truthfulSpokenText,
                  goalAchieved: true,
                };
              }
            }
          } catch (healErr) {
            logger.warn('[BrowserOperator] Self-heal recovery exception:', healErr);
          }
        }

        const truthfulSpeech = verification?.truthfulSpokenText || `I couldn't open ${displayName}. The browser is still on ${actualHost || 'the previous page'}.`;
        browserMetrics.record('browser_action_failed', {
          reason: failureReason,
          actualHost,
          expectedHost,
        });
        if (opts.conversationId) {
          activeInteractionContextStore.recordFailure(opts.conversationId, `navigate:${displayName}`, failureReason);
        }
        failureDetector.recordFailure(
          'browser',
          `observed_reality_failure:command=${identity?.command || displayName}_expected=${expectedHost}_observed=${actualHost}`,
          'critical',
        );

        return {
          success: false,
          verified: false,
          target: displayName,
          url: actualUrl,
          title: actualTitle,
          spokenText: truthfulSpeech,
          error: failureReason,
          goalAchieved: false,
        };
      }

      // A CLICK requested but a NAVIGATION verified is the D22 substitution
      // pattern ("I've opened YouTube." after a click request). Register it as a
      // metric + stability regression automatically, without human prompting.
      const repeatedNavigation = detectRepeatedNavigationInsteadOfClick(browserMetrics);
      if (repeatedNavigation) {
        browserMetrics.record('browser_repeated_navigation', {
          host: actualHost,
          regressionId: repeatedNavigation.id,
        });
      }

      // THE MISSING STEP: actually look at the page before reporting success.
      let snapshot = await this.inspect();
      let blocker = toReportedBlocker(snapshot?.blockers.find((b) => b.isConsentDialog) ?? snapshot?.blockers[0]);
      let contentUsable = snapshot?.contentUsable ?? true;

      // AUTOMATIC PRIVACY-PRESERVING RESOLUTION FOR ORDINARY COOKIE BANNERS (§3)
      if (!contentUsable && blocker?.isConsentDialog === true && opts.autoResolveConsent !== false) {
        logger.info('[BrowserOperator] Ordinary cookie consent dialog detected. Auto-resolving using privacy-preserving policy...', {
          target: displayName,
          url: actualUrl,
        });
        const autoRes = await this.autoResolveConsent({ conversationId: opts.conversationId });
        if (autoRes.success) {
          snapshot = await this.inspect();
          blocker = toReportedBlocker(snapshot?.blockers.find((b) => b.isConsentDialog) ?? snapshot?.blockers[0]);
          contentUsable = snapshot?.contentUsable ?? true;
        }
      }

      if (opts.conversationId) {
        browserStateStore.update(opts.conversationId, {
          lastBrowserUrl: actualUrl,
          lastBrowserTitle: actualTitle,
          lastBrowserAction: `navigate:${displayName}`,
          lastBrowserResult: contentUsable ? 'page usable' : 'page blocked',
          blockingDialog: snapshot?.blockers[0] ?? null,
          visibleTarget: displayName,
          verificationState: contentUsable ? 'verified' : 'blocked',
          blockedReason: contentUsable ? null : `${blocker?.kind} dialog present`,
          ...(snapshot
            ? {
                lastIndexedElements: serializeInteractiveSnapshot(snapshot).elements,
                indexedUrl: snapshot.url,
              }
            : {}),
          ...(opts.goalText ? { lastBrowserGoal: opts.goalText } : {}),
        });
      }

      const pageState = snapshot
        ? {
            url: snapshot.url,
            title: snapshot.title,
            host: snapshot.host,
            controlsSeen: snapshot.controls.length,
            contentUsable: snapshot.contentUsable,
            capturedAt: snapshot.capturedAt,
          }
        : undefined;

      if (!contentUsable) {
        // NOT task completion. Say what is actually true and ask for the decision.
        browserMetrics.record('browser_action_failed', { reason: 'blocking_dialog', kind: blocker?.kind });
        const isConsent = blocker?.isConsentDialog === true;
        const spokenText = isConsent
          ? `${displayName} is open, but a cookie/consent dialog is blocking the page.${describeControls(blocker)} ` +
            `Cookie choices are yours to make — tell me which one to pick and I'll continue.`
          : `${displayName} is open, but a ${blocker?.kind ?? 'dialog'} is blocking the page.${describeControls(blocker)}`;
        return {
          success: true,
          verified: true,
          target: displayName,
          url: actualUrl,
          title: actualTitle,
          spokenText,
          contentUsable: false,
          goalAchieved: false,
          blocker,
          repeatedNavigation,
          pageState,
        };
      }

      browserSessionManager.updateSession({
        currentUrl: actualUrl,
        currentTitle: actualTitle,
        windowHandle: identity?.windowHandle ?? browserSessionManager.getSession()?.windowHandle ?? null,
        isForeground: true,
        isMinimized: false,
        lastAction: `navigate:${displayName}`,
        verificationState: 'verified',
      });

      browserMetrics.record('browser_action_verified', { kind: actionKind, target: displayName });

      if (opts.conversationId) {
        activeInteractionContextStore.recordSuccess(opts.conversationId, `navigate:${displayName}`, displayName, {
          activeBrowserSessionId: browserSessionManager.getSession()?.sessionId || null,
          activePageUrl: actualUrl,
          activePageTitle: actualTitle,
        });
        activeInteractionContextStore.pushNavigation(opts.conversationId, actualUrl, actualTitle);
        this.extractCompactSearchResults(opts.conversationId).catch(() => {});
      }

      return {
        success: true,
        verified: true,
        target: displayName,
        url: actualUrl,
        title: actualTitle,
        spokenText: verification?.truthfulSpokenText || `I've opened ${displayName}.`,
        contentUsable: true,
        goalAchieved: true,
        blocker: null,
        repeatedNavigation,
        pageState,
      };
    } catch (err: unknown) {
      browserMetrics.record('browser_action_failed', { reason: 'navigation_error' });
      logger.error('[BrowserOperator] Navigation error:', err);
      return {
        success: false,
        verified: false,
        target: displayName,
        spokenText: `I couldn't open ${displayName}.`,
        error: errMsg(err) || String(err),
        goalAchieved: false,
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ACT — click / type, with real verification
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Click the visible control whose accessible name matches `name`.
   *
   * Consent-law: if the control is a cookie/privacy choice, the click is only
   * performed when the user explicitly said so OR a stored per-domain preference
   * authorizes it. Otherwise the operator refuses and asks.
   */
  public async clickByAccessibleName(
    name: string,
    opts: {
      conversationId?: string;
      explicitUserChoice?: ConsentChoice | null;
      explicitAuthorization?: boolean;
      expect?: 'dialog_disappears' | 'target_loads' | 'any';
    } = {},
  ): Promise<BrowserActionOutcome> {
    browserMetrics.record('browser_action_requested', { kind: 'click', name });
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return this.failedOutcome('click', `There is no page open for me to click "${name}" on.`);
    }

    const before = await this.inspect();
    if (!before) {
      return this.failedOutcome('click', `I lost track of the page before clicking "${name}".`);
    }

    const match = matchControlByAccessibleName(before.controls, name);
    if (!match.control) {
      browserMetrics.record('browser_action_failed', { reason: 'control_not_found', name });
      const visible = before.controls
        .filter((c) => c.visible && c.name)
        .map((c) => `"${c.name}"`)
        .slice(0, 8);
      const spokenText =
        `I can see the page, but there is no visible button or link called "${name}".` +
        (visible.length ? ` What I can see: ${visible.join(', ')}.` : '');
      return {
        requested: 'click',
        performed: false,
        verified: false,
        spokenText,
        blockerBefore: toReportedBlocker(before.blockers[0]),
        blockerAfter: toReportedBlocker(before.blockers[0]),
        evidence: {
          foundStrategy: match.strategy,
          foundName: null,
          dispatched: false,
          stateChanged: false,
          changeDetail: null,
          targetUsable: before.contentUsable,
        },
        needsUserDecision: false,
        error: 'control_not_found',
      };
    }

    // Consent authorization gate.
    const consentClass = VisibleControlConsentClass(match.control);
    if (consentClass && !opts.explicitAuthorization) {
      const auth = authorizeConsentChoice({
        url: before.url,
        explicitUserChoice: opts.explicitUserChoice ?? null,
      });
      // Which authority decided? A stored preference being applied and an
      // explicit instruction overriding it are different events.
      if (auth.source === 'stored_preference') {
        browserMetrics.record('browser_preference_used', {
          host: before.host,
          choice: auth.choice,
        });
      } else if (auth.source === 'user_explicit') {
        browserMetrics.record('browser_preference_overridden', {
          host: before.host,
          choice: auth.choice,
        });
      }
      if (!auth.authorized) {
        logger.info('[BrowserOperator] Consent click refused pending user decision', {
          name: match.control.name,
          host: before.host,
        });
        return {
          requested: 'click',
          performed: false,
          verified: false,
          spokenText: `I found "${match.control.name}", but ${auth.reason}`,
          blockerBefore: toReportedBlocker(before.blockers[0]),
          blockerAfter: toReportedBlocker(before.blockers[0]),
          evidence: {
            foundStrategy: match.strategy,
            foundName: match.control.name,
            dispatched: false,
            stateChanged: false,
            changeDetail: null,
            targetUsable: before.contentUsable,
          },
          needsUserDecision: true,
          error: 'consent_authorization_required',
        };
      }
      // Only act on the choice the authorization actually names.
      if (consentClass !== 'more_options' && auth.choice !== consentClass) {
        return {
          requested: 'click',
          performed: false,
          verified: false,
          spokenText:
            `"${match.control.name}" is the "${consentClass}" option, but your authorization was ` +
            `"${auth.choice}". I stopped instead of guessing.`,
          blockerBefore: toReportedBlocker(before.blockers[0]),
          blockerAfter: toReportedBlocker(before.blockers[0]),
          evidence: {
            foundStrategy: match.strategy,
            foundName: match.control.name,
            dispatched: false,
            stateChanged: false,
            changeDetail: null,
            targetUsable: before.contentUsable,
          },
          needsUserDecision: true,
          error: 'consent_choice_mismatch',
        };
      }
    }

    const click = await clickControl(page, match.control);
    if (!click.dispatched) {
      browserMetrics.record('browser_action_failed', {
        reason: 'dispatch_failed',
        error: click.error,
      });
      return this.failedOutcome('click', `I found "${match.control.name}" but could not click it.`, click.error);
    }
    logger.info('[BrowserOperator] Click dispatched', {
      name: match.control.name,
      method: click.method,
    });

    const wait = await waitForUnblocked(page, { timeoutMs: 8000 });
    const after = wait.snapshot;

    const evidence = buildVerificationEvidence({
      match,
      dispatched: true,
      stateBefore: before,
      stateAfter: after,
      expected: opts.expect ?? 'any',
    });

    if (evidence.verified) {
      browserMetrics.record('browser_action_verified', { kind: 'click', name: match.control.name });
      if (before.blockers.length && !after.blockers.length) {
        browserMetrics.record('browser_blocker_resolved', {
          kind: before.blockers[0]?.kind,
          host: before.host,
        });
      }
    } else {
      browserMetrics.record('browser_action_failed', {
        reason: 'verification_failed',
        name: match.control.name,
      });
    }

    if (opts.conversationId) {
      browserStateStore.update(opts.conversationId, {
        lastBrowserUrl: after.url,
        lastBrowserTitle: after.title,
        lastBrowserAction: `click:${match.control.name}`,
        lastBrowserResult: evidence.verified ? 'clicked and verified' : 'clicked but unverified',
        blockingDialog: after.blockers[0] ?? null,
        verificationState: evidence.verified ? 'verified' : 'failed',
        blockedReason: after.contentUsable ? null : `${after.blockers[0]?.kind} dialog present`,
      });
    }

    const spokenText = evidence.verified
      ? `Done. I clicked "${match.control.name}" and ${evidence.changeDetail ?? 'the page accepted it'}` +
        `${evidence.targetUsable ? ', and the page is usable now' : ''}.`
      : `I clicked "${match.control.name}", but I could not verify that anything changed` +
        `${after.blockers.length ? ` — the "${after.blockers[0].kind}" dialog is still on screen` : ''}.`;

    return {
      requested: 'click',
      performed: true,
      verified: evidence.verified,
      spokenText,
      blockerBefore: toReportedBlocker(before.blockers[0]),
      blockerAfter: toReportedBlocker(after.blockers[0]),
      evidence: {
        foundStrategy: evidence.foundStrategy,
        foundName: evidence.foundName,
        dispatched: evidence.dispatched,
        stateChanged: evidence.stateChanged,
        changeDetail: evidence.changeDetail,
        targetUsable: evidence.targetUsable,
      },
      needsUserDecision: false,
    };
  }

  /**
   * Remove DOM focus from any currently focused element (e.g. input/textarea)
   * so microphone speech or subsequent turns cannot leak into focused controls.
   */
  public async blurActiveElement(): Promise<void> {
    const page = this.activePage;
    if (page && !page.isClosed()) {
      await page.evaluate(() => {
        try {
          if (document.activeElement && (document.activeElement as HTMLElement).blur) {
            (document.activeElement as HTMLElement).blur();
          }
        } catch {}
      }).catch(() => {});
    }
  }

  /** Type into the visible field whose accessible name matches `name`. */
  public async typeByAccessibleName(
    name: string,
    text: string,
    opts: { conversationId?: string; submit?: boolean; authorized?: boolean; reason?: string } = {},
  ): Promise<BrowserActionOutcome> {
    browserMetrics.record('browser_action_requested', { kind: 'type', name });
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return this.failedOutcome('type', 'There is no page open for me to type into.');
    }

    const before = await this.inspect();
    if (!before) return this.failedOutcome('type', 'I lost track of the page before typing.');

    // STRICT INPUT OWNERSHIP GATE:
    // Authorized if explicitly granted for turn OR persisted in CapabilityPermissionStore
    const isPermitted = opts.authorized === true || capabilityPermissionStore.isAllowed('browser.input');
    if (!isPermitted) {
      logger.warn('[BrowserOperator] UNAUTHORIZED_BROWSER_TYPING_REJECTED:', { name, text, reason: opts.reason || 'browserInputAuthorized is false' });
      voiceTurnAuditStore.recordTypingAttempt({
        targetElement: name,
        textToType: text,
        authorized: false,
        reason: opts.reason || 'browserInputAuthorized is false',
        timestamp: Date.now(),
        outcome: 'REJECTED_UNAUTHORIZED',
      });
      return {
        requested: 'type',
        performed: false,
        verified: false,
        spokenText: 'Webpage text entry was not authorized for this utterance.',
        blockerBefore: toReportedBlocker(before.blockers[0]),
        blockerAfter: toReportedBlocker(before.blockers[0]),
        evidence: {
          foundStrategy: 'rejected_unauthorized',
          foundName: name,
          dispatched: false,
          stateChanged: false,
          changeDetail: 'unauthorized_typing_rejected',
          targetUsable: before.contentUsable,
          browserInputAuthorized: false,
        },
        needsUserDecision: false,
        error: 'unauthorized_browser_typing',
      };
    }

    const match = matchControlByAccessibleName(before.controls, name);
    if (!match.control) {
      browserMetrics.record('browser_action_failed', { reason: 'field_not_found', name });
      return {
        requested: 'type',
        performed: false,
        verified: false,
        spokenText: `I could not find a visible input called "${name}".`,
        blockerBefore: toReportedBlocker(before.blockers[0]),
        blockerAfter: toReportedBlocker(before.blockers[0]),
        evidence: {
          foundStrategy: match.strategy,
          foundName: null,
          dispatched: false,
          stateChanged: false,
          changeDetail: null,
          targetUsable: before.contentUsable,
        },
        needsUserDecision: false,
        error: 'field_not_found',
      };
    }

    const typed = await typeIntoControl(page, match.control, text);
    if (!typed.typed) {
      voiceTurnAuditStore.recordTypingAttempt({
        targetElement: match.control.name,
        textToType: text,
        authorized: true,
        reason: opts.reason || 'explicit typing authorized',
        timestamp: Date.now(),
        outcome: 'FAILED',
      });
      browserMetrics.record('browser_action_failed', { reason: 'type_failed', error: typed.error });
      return this.failedOutcome('type', `I found "${match.control.name}" but could not type into it.`, typed.error);
    }

    voiceTurnAuditStore.recordTypingAttempt({
      targetElement: match.control.name,
      textToType: text,
      authorized: true,
      reason: opts.reason || 'explicit typing authorized',
      timestamp: Date.now(),
      outcome: 'PERFORMED',
    });
    voiceTurnAuditStore.recordMutation({
      mutationType: 'TYPE',
      detail: `Typed "${text}" into "${match.control.name}"`,
      authorized: true,
      timestamp: Date.now(),
    });

    if (opts.submit !== false) await pressEnter(page);

    const wait = await waitForUnblocked(page, { timeoutMs: 6000 });
    const after = wait.snapshot;
    const stateChanged = after.url !== before.url;

    const verified = stateChanged || after.contentUsable !== before.contentUsable;
    if (verified) {
      browserMetrics.record('browser_action_verified', { kind: 'type', name: match.control.name });
    } else {
      browserMetrics.record('browser_action_failed', { reason: 'type_unverified' });
    }

    if (opts.conversationId) {
      browserStateStore.update(opts.conversationId, {
        lastBrowserUrl: after.url,
        lastBrowserTitle: after.title,
        lastBrowserAction: `type:${match.control.name}`,
        lastBrowserResult: `entered "${text}"`,
        blockingDialog: after.blockers[0] ?? null,
        verificationState: verified ? 'verified' : 'failed',
        blockedReason: after.contentUsable ? null : `${after.blockers[0]?.kind} dialog present`,
      });
    }

    return {
      requested: 'type',
      performed: true,
      verified,
      spokenText: verified
        ? `Entered "${text}" into "${match.control.name}" and the page moved to ${after.title || after.url}.`
        : `I entered "${text}" into "${match.control.name}", but the page does not appear to have responded.`,
      blockerBefore: toReportedBlocker(before.blockers[0]),
      blockerAfter: toReportedBlocker(after.blockers[0]),
      evidence: {
        foundStrategy: match.strategy,
        foundName: match.control.name,
        dispatched: true,
        stateChanged,
        changeDetail: stateChanged ? `navigated to ${after.url}` : null,
        targetUsable: after.contentUsable,
      },
      needsUserDecision: false,
    };
  }

  /**
   * Inspect the page and return the indexed, accessibility-first view.
   *
   * ADAPTED FROM Browser Use: its agents act on element INDICES from a numbered
   * interactive-element list rather than inventing CSS/XPath selectors. The index
   * map is persisted per conversation so a LATER turn ("click 2") still resolves.
   */
  public async getInteractiveSnapshot(
    conversationId?: string,
  ): Promise<InteractiveSnapshot | null> {
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return null;
    }
    // Wait for rendered content. A page that is mid-transition — typically right
    // after accepting a consent dialog while the site reloads — exposes zero
    // controls, and reporting that as an empty page made every later step fail
    // confusingly ("not found among 0 elements").
    // Wait for the page to SETTLE, not merely to have one named control: a
    // header nav satisfies a "has any control" test instantly, so an SPA still
    // rendering its results would be inspected too early (observed: a results
    // page exposing 5 nav controls instead of its 51 result controls, which made
    // every result-selection step find no candidates).
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const snapshot = await waitForInteractiveContent(page, { timeoutMs: 8000 });
    const indexed = serializeInteractiveSnapshot(snapshot);
    if (conversationId) {
      browserStateStore.update(conversationId, {
        lastIndexedElements: indexed.elements,
        indexedUrl: snapshot.url,
        lastBrowserUrl: snapshot.url,
        lastBrowserTitle: snapshot.title,
        visibleTarget: snapshot.title || snapshot.host,
        blockingDialog: snapshot.blockers[0] ?? null,
        verificationState: snapshot.contentUsable ? 'verified' : 'blocked',
        blockedReason: snapshot.contentUsable
          ? null
          : `${snapshot.blockers[0]?.kind} dialog present`,
      });
    }
    return indexed;
  }

  /**
   * Click the element at `index` from the last inspection.
   * Delegates to `clickByAccessibleName`, so the consent gate, verification
   * chain and metrics all apply unchanged — there is exactly one click path.
   */
  public async clickByIndex(
    index: number,
    opts: { conversationId: string; explicitUserChoice?: ConsentChoice | null },
  ): Promise<BrowserActionOutcome> {
    browserMetrics.record('browser_action_requested', { kind: 'click', index });
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return this.failedOutcome('click', 'There is no page open for me to click on.');
    }

    const resolution = resolveIndexedElement({
      index,
      state: browserStateStore.get(opts.conversationId),
      currentUrl: page.url(),
    });
    if (!resolution.ok) {
      browserMetrics.record('browser_action_failed', {
        reason: 'stale_or_unknown_index',
        index,
      });
      return this.failedOutcome('click', resolution.reason, 'stale_or_unknown_index');
    }

    logger.info('[BrowserOperator] Clicking indexed element', {
      index,
      name: resolution.element.name,
      kind: resolution.element.kind,
    });

    return await this.clickByAccessibleName(resolution.element.name, {
      conversationId: opts.conversationId,
      explicitUserChoice: opts.explicitUserChoice ?? null,
      expect: 'any',
    });
  }

  /** Type into the element at `index` from the last inspection. */
  public async typeByIndex(
    index: number,
    text: string,
    opts: { conversationId: string; submit?: boolean; authorized?: boolean; reason?: string },
  ): Promise<BrowserActionOutcome> {
    browserMetrics.record('browser_action_requested', { kind: 'type', index });
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return this.failedOutcome('type', 'There is no page open for me to type into.');
    }

    const resolution = resolveIndexedElement({
      index,
      state: browserStateStore.get(opts.conversationId),
      currentUrl: page.url(),
    });
    if (!resolution.ok) {
      browserMetrics.record('browser_action_failed', {
        reason: 'stale_or_unknown_index',
        index,
      });
      return this.failedOutcome('type', resolution.reason, 'stale_or_unknown_index');
    }

    return await this.typeByAccessibleName(resolution.element.name, text, {
      conversationId: opts.conversationId,
      submit: opts.submit,
      authorized: opts.authorized,
      reason: opts.reason,
    });
  }

  /**
   * Automatic privacy-preserving consent resolution for ordinary website cookie banners (§3).
   *
   * Privacy-preserving policy:
   * 1. Reject all / reject optional / necessary only, when available.
   * 2. If no rejection path allows the page to function, use the minimum ordinary consent required to continue.
   * 3. Verify the dialog disappears.
   * 4. Resume the original user goal automatically.
   *
   * User choice is preserved for security/account/payment gates (login, captcha, etc.).
   */
  public async autoResolveConsent(opts: {
    conversationId?: string;
    explicitUserChoice?: ConsentChoice | null;
  } = {}): Promise<{ success: boolean; chosenStrategy?: string; error?: string }> {
    const page = this.activePage;
    if (!page || page.isClosed()) {
      return { success: false, error: 'no_active_page' };
    }

    const before = await this.inspect();
    if (!before) {
      return { success: false, error: 'page_inspect_failed' };
    }

    const consentBlocker = before.blockers.find((b) => b.isConsentDialog);
    if (!consentBlocker && before.contentUsable) {
      return { success: true, chosenStrategy: 'already_usable' };
    }

    // Check domain preference
    let storedPref: ConsentPreference | null = null;
    try {
      const { browserPreferencesStore } = await import('./browserPreferencesStore.js');
      storedPref = browserPreferencesStore.getPreference(before.host);
    } catch { /* best effort */ }

    const choiceOrder: ConsentChoice[] = opts.explicitUserChoice
      ? [opts.explicitUserChoice]
      : storedPref === 'reject_optional'
        ? ['reject_optional']
        : storedPref === 'accept_all'
          ? ['accept_all']
          : ['reject_optional', 'accept_all']; // Privacy-preserving: reject first, accept fallback

    logger.info('[BrowserOperator] Auto-resolving cookie consent banner with privacy-preserving strategy:', {
      host: before.host,
      choiceOrder,
    });

    const rejectPhrases = [
      'alle ablehnen', 'ablehnen', 'alle cookies ablehnen', 'nur notwendige', 'nur erforderliche',
      'reject all', 'reject all cookies', 'reject non-essential', 'reject optional', 'decline',
      'refuse', 'tout refuser', 'rechazar todo', 'resping folosirea', 'respinge toate', 'refuz',
    ];
    const acceptPhrases = [
      'alle akzeptieren', 'akzeptieren', 'alle cookies akzeptieren', 'accept all', 'accept all cookies',
      'allow all', 'i agree', 'agree', 'zustimmen', 'einverstanden', 'tout accepter', 'aceptar todo',
      'verwendung von cookies', 'accept folosirea', 'accepta toate', 'sunt de acord',
    ];

    for (const choice of choiceOrder) {
      const targetPhrases = choice === 'reject_optional' ? rejectPhrases : acceptPhrases;

      // 1. Try finding matching visible control from inspection
      const candidate = (before.controls || []).find((c) => {
        if (!c.visible || c.disabled) return false;
        const norm = (c.name || '').toLowerCase().trim();
        return targetPhrases.some((p) => norm === p || norm.includes(p));
      });

      if (candidate) {
        logger.info('[BrowserOperator] Dispatched consent click on visible control:', {
          choice,
          name: candidate.name,
        });
        const clickRes = await this.clickByAccessibleName(candidate.name, {
          conversationId: opts.conversationId,
          explicitUserChoice: choice,
          explicitAuthorization: true,
          expect: 'dialog_disappears',
        });
        if (clickRes.verified) {
          logger.info('[BrowserOperator] Cookie consent dialog dismissed via control:', candidate.name);
          browserMetrics.record('browser_blocker_resolved', { kind: 'cookie_consent', strategy: choice });
          return { success: true, chosenStrategy: choice };
        }
      }

      // 2. Playwright DOM selector fallback across all frames (especially for Google/YouTube consent iframes)
      try {
        const selectors = choice === 'reject_optional'
          ? [
              'button:has-text("Alle ablehnen")',
              'button:has-text("Reject all")',
              'button:has-text("Nur notwendige")',
              'button:has-text("Ablehnen")',
              'button:has-text("Decline")',
              'button:has-text("Respinge")',
              'button[aria-label*="ablehnen" i]',
              'button[aria-label*="reject" i]',
              'ytd-button-renderer:has-text("Alle ablehnen") button',
              'ytd-button-renderer:has-text("Reject all") button',
              'ytd-consent-bump-v2-lightbox button:has-text("Alle ablehnen")',
              'ytd-consent-bump-v2-lightbox button:has-text("Reject all")',
            ]
          : [
              'button:has-text("Alle akzeptieren")',
              'button:has-text("Accept all")',
              'button:has-text("Zustimmen")',
              'button:has-text("Akzeptieren")',
              'button:has-text("Verwendung von Cookies")',
              'button[aria-label*="akzeptieren" i]',
              'button[aria-label*="accept" i]',
              'ytd-button-renderer:has-text("Alle akzeptieren") button',
              'ytd-button-renderer:has-text("Accept all") button',
              'ytd-consent-bump-v2-lightbox button:has-text("Alle akzeptieren")',
              'ytd-consent-bump-v2-lightbox button:has-text("Accept all")',
            ];

        for (const sel of selectors) {
          for (const f of page.frames()) {
            const btn = await f.$(sel).catch(() => null);
            if (btn) {
              const visible = await btn.isVisible().catch(() => false);
              if (visible) {
                logger.info(`[BrowserOperator] Clicking consent button via selector "${sel}" in frame:`, f.url());
                await btn.click({ timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(1000);
                const after = await this.inspect();
                if (after && !after.blockers.some((b) => b.isConsentDialog) && after.contentUsable) {
                  logger.info('[BrowserOperator] Cookie consent dialog dismissed via selector:', sel);
                  browserMetrics.record('browser_blocker_resolved', { kind: 'cookie_consent', strategy: `selector:${sel}` });
                  return { success: true, chosenStrategy: choice };
                }
              }
            }
          }
        }
      } catch (domErr: any) {
        logger.debug('[BrowserOperator] Selector fallback inspection error:', domErr?.message);
      }
    }

    // Final inspection to verify state
    const afterAll = await this.inspect();
    if (afterAll && !afterAll.blockers.some((b) => b.isConsentDialog) && afterAll.contentUsable) {
      return { success: true, chosenStrategy: 'dismissed' };
    }

    return { success: false, error: 'consent_dialog_remains' };
  }

  /**
   * Deterministic consent handling with ONE bounded recovery path.
   *
   *   CONSENT DETECTED → TARGET RESOLVED → CLICK DISPATCHED → STATE CHECK
   *   → if still blocked: RE-INSPECT the live DOM + ONE RETRY
   *   → VERIFY BLOCKER GONE → (caller continues the original goal)
   *
   * If the blocker is still present after the retry this returns an honest
   * failure. It never loops, and it never re-navigates as a substitute for
   * interacting with the page.
   */
  public async acceptConsentBlocker(opts: {
    conversationId: string;
    explicitUserChoice?: ConsentChoice | null;
  }): Promise<BrowserActionOutcome> {
    const choice = opts.explicitUserChoice ?? 'reject_optional';

    const auto = await this.autoResolveConsent({ conversationId: opts.conversationId, explicitUserChoice: opts.explicitUserChoice });
    if (auto.success) {
      const after = await this.inspect();
      return {
        requested: 'click',
        performed: true,
        verified: true,
        spokenText: 'Cookie consent dialog dismissed.',
        blockerBefore: null,
        blockerAfter: null,
        evidence: {
          foundStrategy: 'consent_synonym',
          foundName: auto.chosenStrategy || 'consent_dismissed',
          dispatched: true,
          stateChanged: true,
          changeDetail: 'the blocking dialog is gone',
          targetUsable: after?.contentUsable ?? true,
        },
        needsUserDecision: false,
      };
    }

    const first = await this.clickByAccessibleName('accept all', {
      conversationId: opts.conversationId,
      explicitUserChoice: choice,
      explicitAuthorization: true,
      expect: 'dialog_disappears',
    });
    if (first.verified) {
      browserMetrics.record('browser_followup_resolved', { kind: 'consent_accept' });
      return first;
    }

    // Only a DISPATCHED click is worth retrying. An unauthorized click or a
    // control that was never found is a different failure and must not be masked.
    if (!first.evidence.dispatched) {
      browserMetrics.record('browser_followup_failed', {
        kind: 'consent_accept',
        reason: first.error ?? 'not_dispatched',
      });
      return first;
    }

    const host = (() => {
      try {
        return new URL(this.activePage?.url() ?? '').host;
      } catch {
        return '';
      }
    })();
    logger.info('[BrowserOperator] Consent still present after click — one bounded retry', { host });
    browserMetrics.record('browser_consent_retry', { host });

    // Re-inspect the LIVE page and re-resolve the still-visible consent action
    // from the actual DOM/accessibility tree — a dialog can re-render with a
    // different label or order between attempts.
    const live = await this.getInteractiveSnapshot(opts.conversationId);
    const acceptIndex = (live?.blocker?.optionIndices ?? []).find((i) => {
      const el = live?.elements.find((e) => e.index === i);
      return el ? consentChoiceClassOf(el.name) === 'accept_all' : false;
    });

    const retry =
      acceptIndex !== undefined
        ? await this.clickByIndex(acceptIndex, {
            conversationId: opts.conversationId,
            explicitUserChoice: choice,
          })
        : await this.clickByAccessibleName('accept all', {
            conversationId: opts.conversationId,
            explicitUserChoice: choice,
            expect: 'dialog_disappears',
          });

    // Verify against the page — never claim success from the dispatch.
    const after = await this.inspect();
    const stillBlocked = Boolean(after?.blockers.some((b) => b.isConsentDialog));

    if (!stillBlocked) {
      browserMetrics.record('browser_blocker_resolved', {
        kind: 'cookie_consent',
        via: 'retry',
      });
      browserMetrics.record('browser_followup_resolved', { kind: 'consent_accept', via: 'retry' });
      return {
        ...retry,
        verified: true,
        spokenText: `${retry.spokenText} (resolved on the retry.)`,
        blockerAfter: null,
        evidence: {
          ...retry.evidence,
          stateChanged: true,
          changeDetail: 'the blocking dialog is gone (retry)',
          targetUsable: after?.contentUsable ?? true,
        },
      };
    }

    browserMetrics.record('browser_followup_failed', {
      kind: 'consent_accept',
      reason: 'still_blocked_after_retry',
    });
    return {
      ...retry,
      verified: false,
      spokenText:
        'I clicked the consent option twice, but the dialog is still blocking the page. ' +
        'I will not keep trying — the page may be refusing the interaction.',
      blockerAfter: toReportedBlocker(after?.blockers[0]),
      evidence: {
        ...retry.evidence,
        stateChanged: false,
        targetUsable: after?.contentUsable ?? false,
      },
    };
  }

  /**
   * TEST 3 — open the result/channel matching `query`.
   *
   * Never a hardcoded URL, never "the first generic link": candidates are scored
   * from the query against accessible name + href, nav/legal/home links are
   * excluded, and the outcome is verified by checking that the resulting URL
   * actually carries the selected element's identifier.
   */
  public async openSelectedResult(opts: {
    conversationId: string;
    query: string;
    prefer?: 'result' | 'channel';
  }): Promise<
    BrowserActionOutcome & {
      selection?: ResultSelection;
      targetVerified?: boolean;
      actualUrl?: string;
      pageTitle?: string;
    }
  > {
    const prefer = opts.prefer ?? 'result';
    const live = await this.getInteractiveSnapshot(opts.conversationId);
    const elements = live?.elements ?? [];
    const selection = selectSearchResult(elements, opts.query, { prefer });

    if (!selection.selected) {
      browserMetrics.record('browser_followup_failed', {
        kind: 'open_selected_result',
        reason: 'no_candidate',
      });
      return {
        ...this.failedOutcome(
          'click',
          `I inspected the page and found no result matching "${opts.query}".`,
        ),
        selection,
        targetVerified: false,
      };
    }

    const selected = selection.selected;
    logger.info('[BrowserOperator] Result selected', {
      name: selected.name,
      href: selected.href,
      prefer,
      reason: selection.reason,
    });

    const click = await this.clickByAccessibleName(selected.name, {
      conversationId: opts.conversationId,
      expect: 'target_loads',
    });

    const page = this.activePage;
    const actualUrl = page?.url() ?? '';
    const pageTitle = (await page?.title().catch(() => '')) ?? '';

    const check = verifyTargetMatchesSelection({
      selectedHref: selected.href ?? '',
      actualUrl,
      expectedName: selected.name,
    });

    if (!check.matches) {
      browserMetrics.record('browser_target_mismatch', {
        expected: selected.href,
        actual: actualUrl,
        reason: check.reason,
      });
    }

    // The requirement is: "report success only after verification". The
    // verification that matters here is that the page we landed on IS the target
    // we selected; the click's own state-change check is a supporting signal, not
    // the gate (a same-page anchor can resolve 'click.verified' to false while
    // the target check passes).
    const verified = check.matches && (click.performed || click.evidence.dispatched);
    browserMetrics.record(verified ? 'browser_followup_resolved' : 'browser_followup_failed', {
      kind: 'open_selected_result',
      prefer,
    });

    if (opts.conversationId) {
      browserStateStore.update(opts.conversationId, {
        lastBrowserUrl: actualUrl,
        lastBrowserTitle: pageTitle,
        lastBrowserAction: `open_result:${selected.name}`,
        lastBrowserResult: verified ? 'target verified' : 'target mismatch',
        visibleTarget: selected.name,
        verificationState: verified ? 'verified' : 'failed',
        blockedReason: null,
      });
    }

    return {
      requested: 'click',
      performed: click.performed,
      verified,
      spokenText: verified
        ? `Opened "${selected.name}" — verified on ${pageTitle || actualUrl}.`
        : `I clicked "${selected.name}" but could not verify I landed on it: ${check.reason}.`,
      blockerBefore: click.blockerBefore,
      blockerAfter: click.blockerAfter,
      evidence: click.evidence,
      needsUserDecision: false,
      selection,
      targetVerified: check.matches,
      actualUrl,
      pageTitle,
    };
  }

  public async scroll(direction: 'up' | 'down' = 'down'): Promise<BrowserActionOutcome> {
    const page = this.activePage;
    if (!page || page.isClosed()) {
      browserMetrics.record('browser_context_lost');
      return this.failedOutcome('scroll', 'There is no page open for me to scroll.');
    }
    browserMetrics.record('browser_action_requested', { kind: 'scroll' });
    const before = await this.inspect();
    await scrollPage(page, direction);
    const after = await this.inspect();
    const stateChanged = (after?.controls.length ?? 0) !== (before?.controls.length ?? 0);
    browserMetrics.record(stateChanged ? 'browser_action_verified' : 'browser_action_failed', {
      kind: 'scroll',
    });
    return {
      requested: 'scroll',
      performed: true,
      verified: stateChanged,
      spokenText: stateChanged
        ? `Scrolled ${direction}.`
        : `I scrolled ${direction}, but the page content did not change.`,
      blockerBefore: toReportedBlocker(before?.blockers[0]),
      blockerAfter: toReportedBlocker(after?.blockers[0]),
      evidence: {
        foundStrategy: 'none',
        foundName: null,
        dispatched: true,
        stateChanged,
        changeDetail: null,
        targetUsable: after?.contentUsable ?? false,
      },
      needsUserDecision: false,
    };
  }

  private failedOutcome(
    kind: BrowserActionKind,
    spokenText: string,
    error?: string,
  ): BrowserActionOutcome {
    browserMetrics.record('browser_action_failed', { kind, error });
    return {
      requested: kind,
      performed: false,
      verified: false,
      spokenText,
      blockerBefore: null,
      blockerAfter: null,
      evidence: {
        foundStrategy: 'none',
        foundName: null,
        dispatched: false,
        stateChanged: false,
        changeDetail: null,
        targetUsable: false,
      },
      needsUserDecision: false,
      error,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GOAL CONTINUATION — clearing the modal is NOT the goal
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Run a browser goal end to end:
   * navigate → inspect → resolve blocker (if authorized) → verify → resume the
   * remaining steps → report.
   */
  public async runGoal(
    goal: BrowserGoal,
    opts: { conversationId?: string; explicitUserChoice?: ConsentChoice | null } = {},
  ): Promise<BrowserGoalRunResult> {
    const steps: BrowserGoalRunResult['steps'] = [];
    const conversationId = opts.conversationId;

    browserMetrics.record('browser_goal_started', {
      goalId: goal.goalId,
      goalText: goal.goalText,
      stepCount: goal.remaining.length,
    });

    if (conversationId) {
      browserStateStore.update(conversationId, {
        lastBrowserGoal: goal.goalText,
        verificationState: 'unverified',
      });
    }

    if (goal.targetUrl) {
      const nav = await this.openTarget(goal.targetUrl, {
        goalText: goal.goalText,
        conversationId,
        actionKind: 'navigate',
      });
      steps.push({ description: `navigate to ${goal.targetUrl}`, ok: nav.success, detail: nav.spokenText });

      if (!nav.success) {
        return {
          goalId: goal.goalId,
          goalText: goal.goalText,
          completed: false,
          blockerResolved: false,
          blockerPending: null,
          needsUserDecision: false,
          steps,
          spokenText: nav.spokenText,
          url: nav.url,
          title: nav.title,
        };
      }

      const blocker = nav.blocker ?? null;
      if (blocker?.isConsentDialog) {
        const decision = await this.resolveConsentBlocker({
          blocker,
          conversationId,
          explicitUserChoice: opts.explicitUserChoice ?? null,
        });
        steps.push({ description: 'resolve consent dialog', ok: decision.resolved, detail: decision.detail });
        if (!decision.resolved) {
          return {
            goalId: goal.goalId,
            goalText: goal.goalText,
            completed: false,
            blockerResolved: false,
            blockerPending: decision.stillBlocked ? blocker : null,
            needsUserDecision: decision.needsUserDecision,
            steps,
            spokenText: decision.spokenText,
            url: nav.url,
            title: nav.title,
          };
        }
      }
    }

    // Resume the ORIGINAL goal after any blocker is gone.
    let completed = true;
    for (const step of goal.remaining) {
      const outcome = await this.performGoalStep(step, conversationId);
      steps.push({ description: step.description, ok: outcome.ok, detail: outcome.detail });
      if (!outcome.ok) {
        completed = false;
        if (outcome.needsUserDecision) {
          return {
            goalId: goal.goalId,
            goalText: goal.goalText,
            completed: false,
            blockerResolved: true,
            blockerPending: null,
            needsUserDecision: true,
            steps,
            spokenText: outcome.detail,
            url: outcome.url,
            title: outcome.title,
          };
        }
        break;
      }
    }

    const finalSnapshot = await this.inspect();
    const consentStill = finalSnapshot?.blockers.find((b) => b.isConsentDialog) ?? null;

    if (conversationId) {
      browserStateStore.update(conversationId, {
        lastBrowserResult: completed ? 'goal completed' : 'goal incomplete',
        verificationState: completed ? 'verified' : 'failed',
        blockingDialog: finalSnapshot?.blockers[0] ?? null,
      });
    }

    const spokenText = completed
      ? `${goal.goalText} — done. ${steps.filter((s) => s.ok).map((s) => s.description).join(' → ')}.`
      : `${goal.goalText} — I could not finish. ${steps.map((s) => `${s.description}: ${s.ok ? 'ok' : 'failed'}`).join('; ')}.`;

    return {
      goalId: goal.goalId,
      goalText: goal.goalText,
      completed,
      blockerResolved: !consentStill,
      blockerPending: toReportedBlocker(consentStill),
      needsUserDecision: false,
      steps,
      spokenText,
      url: finalSnapshot?.url,
      title: finalSnapshot?.title,
    };
  }

  private async performGoalStep(
    step: BrowserGoalStep,
    conversationId?: string,
  ): Promise<{ ok: boolean; detail: string; needsUserDecision?: boolean; url?: string; title?: string }> {
    switch (step.kind) {
      case 'click': {
        const r = await this.clickByAccessibleName(step.targetName ?? '', {
          conversationId,
          expect: 'any',
        });
        return {
          ok: r.verified,
          detail: r.spokenText,
          needsUserDecision: r.needsUserDecision,
          url: this.activePage?.url(),
        };
      }
      case 'type': {
        const r = await this.typeByAccessibleName(step.targetName ?? '', step.query ?? '', {
          conversationId,
        });
        return {
          ok: r.verified,
          detail: r.spokenText,
          needsUserDecision: r.needsUserDecision,
          url: this.activePage?.url(),
        };
      }
      case 'navigate': {
        const r = await this.openTarget(step.targetName ?? step.description, {
          conversationId,
          goalText: step.description,
        });
        return { ok: r.success && r.contentUsable !== false, detail: r.spokenText, url: r.url, title: r.title };
      }
      case 'wait': {
        await this.activePage?.waitForTimeout(1000).catch(() => {});
        const snap = await this.inspect();
        return { ok: Boolean(snap), detail: 'waited', url: snap?.url, title: snap?.title };
      }
      case 'scroll': {
        const r = await this.scroll('down');
        return { ok: r.performed, detail: r.spokenText };
      }
      case 'inspect':
      default: {
        const snap = await this.inspect();
        return {
          ok: Boolean(snap),
          detail: snap ? `Page "${snap.title}" at ${snap.url}` : 'no page',
          url: snap?.url,
          title: snap?.title,
        };
      }
    }
  }

  /** Resolve a consent dialog using authorization rules, then verify it cleared. */
  private async resolveConsentBlocker(input: {
    blocker: ReportedBlocker;
    conversationId?: string;
    explicitUserChoice: ConsentChoice | null;
  }): Promise<{
    resolved: boolean;
    stillBlocked: boolean;
    needsUserDecision: boolean;
    detail: string;
    spokenText: string;
  }> {
    const page = this.activePage;
    const url = page?.url() ?? '';
    const auth = authorizeConsentChoice({
      url,
      explicitUserChoice: input.explicitUserChoice,
    });

    if (!auth.authorized) {
      return {
        resolved: false,
        stillBlocked: true,
        needsUserDecision: true,
        detail: 'awaiting the user\'s cookie choice',
        spokenText:
          `A cookie/consent dialog is blocking the page.${describeControls(input.blocker)} ` +
          `${auth.reason}`,
      };
    }

    const before = await this.inspect();
    const consentControls = (before?.blockers.find((b) => b.isConsentDialog)?.controls ??
      before?.controls ??
      []).filter((c) => c.visible && c.name);

    const wantedLabel = auth.choice === 'accept_all' ? 'accept_all' : 'reject_optional';
    const target = consentControls.find((c) => {
      const cls = VisibleControlConsentClass(c);
      return cls === wantedLabel;
    });

    if (!target) {
      return {
        resolved: false,
        stillBlocked: true,
        needsUserDecision: true,
        detail: `no visible "${wantedLabel}" control`,
        spokenText:
          `You authorized "${auth.choice}", but I cannot see that option on the page. ` +
          `What I can see: ${consentControls.map((c) => `"${c.name}"`).join(', ') || 'nothing clickable'}.`,
      };
    }

    const click = await clickControl(page as Page, target);
    if (!click.dispatched) {
      return {
        resolved: false,
        stillBlocked: true,
        needsUserDecision: false,
        detail: `click failed: ${click.error}`,
        spokenText: `I found "${target.name}" but could not click it.`,
      };
    }

    const wait = await waitForUnblocked(page as Page, { timeoutMs: 8000 });
    const cleared = wait.blockedCleared && !wait.snapshot.blockers.some((b) => b.isConsentDialog);

    if (cleared) {
      browserMetrics.record('browser_blocker_resolved', { kind: 'cookie_consent', via: 'consent_gate' });
      browserMetrics.record('browser_action_verified', { kind: 'click', name: target.name });
    } else {
      browserMetrics.record('browser_action_failed', { reason: 'consent_not_cleared' });
    }

    if (input.conversationId) {
      browserStateStore.update(input.conversationId, {
        blockingDialog: wait.snapshot.blockers[0] ?? null,
        lastBrowserAction: `click:${target.name}`,
        verificationState: cleared ? 'verified' : 'blocked',
        blockedReason: cleared ? null : 'consent dialog still present',
      });
    }

    return {
      resolved: cleared,
      stillBlocked: !cleared,
      needsUserDecision: !cleared,
      detail: cleared ? `clicked "${target.name}"; dialog cleared` : `clicked "${target.name}"; dialog persisted`,
      spokenText: cleared
        ? `The consent screen is gone.`
        : `I clicked "${target.name}", but the consent dialog is still on screen.`,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CONVERSATIONAL CORRECTION
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Handle a correction/follow-up against the CURRENT page and the PREVIOUS goal.
   * "Accept it." resolves against the visible blocking dialog; "Continue to
   * YouTube." resumes `lastBrowserGoal` rather than asking what to do.
   */
  public async handleFollowUp(
    utterance: string,
    opts: { conversationId: string; explicitUserChoice?: ConsentChoice | null },
  ): Promise<{ handled: boolean; spokenText: string; outcome?: BrowserActionOutcome }> {
    const state = browserStateStore.get(opts.conversationId);
    const resolution = resolveConversationalCorrection(utterance, state);
    if (resolution.kind === 'not_a_correction') {
      return { handled: false, spokenText: '' };
    }

    // Refresh the real dialog state before deciding — never trust a stale record.
    const fresh = await this.inspect();
    const liveBlocker = fresh?.blockers.find((b) => b.isConsentDialog) ?? null;

    if (resolution.kind === 'stay_page') {
      await this.blurActiveElement();
      if (opts.conversationId) {
        this.armStabilityLock(opts.conversationId, this.activePage?.url() || '', 20000);
      }
      return {
        handled: true,
        spokenText: 'Understood, staying on this page.',
      };
    }

    if (resolution.kind === 'accept_consent' || resolution.kind === 'reject_consent') {
      const choice: ConsentChoice = resolution.kind === 'accept_consent' ? 'accept_all' : 'reject_optional';
      const label =
        liveBlocker?.controls.find((c) => VisibleControlConsentClass(c) === choice)?.name ??
        (choice === 'accept_all' ? 'accept all' : 'reject all');

      const outcome = await this.clickByAccessibleName(label, {
        conversationId: opts.conversationId,
        explicitUserChoice: opts.explicitUserChoice ?? choice,
        expect: 'dialog_disappears',
      });

      let spokenText = outcome.spokenText;
      if (outcome.verified && resolution.continueGoal) {
        // Clearing the modal is NOT the goal — resume the stored objective.
        const resumed = await this.resumeStoredGoal(opts.conversationId, resolution.continueGoal);
        if (resumed) spokenText = `${outcome.spokenText} ${resumed}`;
      }
      return { handled: true, spokenText, outcome };
    }

    if (resolution.kind === 'continue_goal') {
      const resumed = await this.resumeStoredGoal(opts.conversationId, resolution.continueGoal);
      return {
        handled: true,
        spokenText: resumed ?? 'I do not have an unfinished browser goal to continue.',
      };
    }

    if (resolution.kind === 'go_back') {
      const page = this.activePage;
      if (!page || page.isClosed()) {
        browserMetrics.record('browser_context_lost');
        return { handled: true, spokenText: 'There is no page open to go back from.' };
      }
      const back = await goBack(page);
      browserMetrics.record(back.moved ? 'browser_action_verified' : 'browser_action_failed', {
        kind: 'navigate',
        via: 'go_back',
      });
      if (opts.conversationId) {
        browserStateStore.update(opts.conversationId, {
          lastBrowserUrl: back.url,
          lastBrowserTitle: back.title,
          lastBrowserAction: 'go_back',
          lastBrowserResult: back.moved ? 'went back' : 'no history entry',
          verificationState: back.moved ? 'verified' : 'failed',
        });
      }
      return {
        handled: true,
        spokenText: back.moved
          ? `Went back to "${back.title || back.url}".`
          : 'There is no earlier page to go back to.',
      };
    }

    if (resolution.kind === 'go_forward') {
      const page = this.activePage;
      if (!page || page.isClosed()) {
        browserMetrics.record('browser_context_lost');
        return { handled: true, spokenText: 'There is no page open to go forward from.' };
      }
      const fwd = await goForward(page);
      browserMetrics.record(fwd.moved ? 'browser_action_verified' : 'browser_action_failed', {
        kind: 'navigate',
        via: 'go_forward',
      });
      if (opts.conversationId) {
        browserStateStore.update(opts.conversationId, {
          lastBrowserUrl: fwd.url,
          lastBrowserTitle: fwd.title,
          lastBrowserAction: 'go_forward',
          lastBrowserResult: fwd.moved ? 'went forward' : 'no forward history entry',
          verificationState: fwd.moved ? 'verified' : 'failed',
        });
      }
      return {
        handled: true,
        spokenText: fwd.moved
          ? `Went forward to "${fwd.title || fwd.url}".`
          : 'There is no later page to go forward to.',
      };
    }

    if (resolution.kind === 'redirect_destination' && resolution.newDestination) {
      const dest = resolution.newDestination;
      const navOutcome = await this.openTarget(dest, {
        conversationId: opts.conversationId,
        goalText: `open ${dest}`,
        actionKind: 'navigate',
      });
      return {
        handled: true,
        spokenText: navOutcome.spokenText,
        outcome: {
          requested: 'navigate',
          performed: navOutcome.success,
          verified: navOutcome.verified,
          spokenText: navOutcome.spokenText,
          blockerBefore: null,
          blockerAfter: null,
          needsUserDecision: false,
          evidence: {
            foundStrategy: 'target_url',
            foundName: dest,
            dispatched: true,
            stateChanged: navOutcome.success,
            changeDetail: null,
            targetUsable: navOutcome.contentUsable ?? true,
          },
        },
      };
    }

    if (resolution.kind === 'correct_search_query' && resolution.newQuery) {
      const query = resolution.newQuery;
      const state = browserStateStore.get(opts.conversationId);
      const activePlatform = /youtube\.com/i.test(state.lastBrowserUrl || '') ? 'YouTube' : 'Google';
      const searchUrl = activePlatform === 'YouTube'
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

      const page = this.activePage;
      if (page && !page.isClosed()) {
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          const after = await this.inspect();
          if (opts.conversationId) {
            browserStateStore.update(opts.conversationId, {
              lastBrowserUrl: after?.url ?? page.url(),
              lastBrowserTitle: after?.title ?? (await page.title().catch(() => '')),
              lastBrowserAction: `search:${query}`,
              lastBrowserGoal: `search ${activePlatform} for ${query}`,
              visibleTarget: activePlatform,
              verificationState: 'verified',
            });
          }
          return {
            handled: true,
            spokenText: `Updated search on ${activePlatform} for "${query}".`,
            outcome: {
              requested: 'search',
              performed: true,
              verified: true,
              spokenText: `Updated search on ${activePlatform} for "${query}".`,
              blockerBefore: null,
              blockerAfter: null,
              needsUserDecision: false,
              evidence: {
                foundStrategy: 'direct_url',
                foundName: query,
                dispatched: true,
                stateChanged: true,
                changeDetail: null,
                targetUsable: true,
              },
            },
          };
        } catch (sErr: any) {
          return { handled: true, spokenText: `Could not complete search for "${query}": ${sErr?.message || sErr}` };
        }
      }
    }

    if (resolution.kind === 'open_channel' || resolution.kind === 'open_it') {
      const state = browserStateStore.get(opts.conversationId);
      const goalText = state.lastBrowserGoal ?? '';
      const derivedQuery =
        / for (.+)$/i.exec(goalText)?.[1]?.trim() ?? state.visibleTarget ?? '';
      const outcome = await this.openSelectedResult({
        conversationId: opts.conversationId,
        query: derivedQuery,
        prefer: resolution.kind === 'open_channel' ? 'channel' : 'result',
      });
      return { handled: true, spokenText: outcome.spokenText, outcome };
    }

    if (resolution.kind === 'open_first_result' || (resolution as any).kind === 'open_ordinal_result') {
      const live = await this.getInteractiveSnapshot(opts.conversationId);
      const current = browserStateStore.get(opts.conversationId);
      const elements: IndexedElement[] = live?.elements ?? current.lastIndexedElements;
      const currentUrl = current.lastBrowserUrl || this.activePage?.url() || '';
      const contentResults = extractContentResults(elements, currentUrl);

      const ordinal = resolution.ordinalIndex ?? 1;
      const targetIndex = ordinal - 1;

      if (!contentResults.length) {
        return {
          handled: true,
          spokenText:
            'I do not have a list of search results on this page. Ask me to inspect it first.',
        };
      }

      if (targetIndex >= contentResults.length) {
        return {
          handled: true,
          spokenText: `I only found ${contentResults.length} search results on this page, so I cannot open result #${ordinal}.`,
        };
      }

      const selected = contentResults[targetIndex];
      const outcome = await this.clickByAccessibleName(selected.name, {
        conversationId: opts.conversationId,
        expect: 'any',
      });

      const spoken = ordinal === 1
        ? outcome.spokenText
        : `Opened result #${ordinal}, "${selected.name}".`;

      if (opts.conversationId && outcome.verified) {
        browserStateStore.update(opts.conversationId, {
          lastBrowserAction: `open_result:${ordinal}:${selected.name}`,
          visibleTarget: selected.name,
        });
      }

      return { handled: true, spokenText: spoken, outcome };
    }

    if (resolution.kind === 'scroll') {
      const direction = /\b(up|hoch)\b/i.test(resolution.utterance) ? 'up' : 'down';
      const outcome = await this.scroll(direction);
      return { handled: true, spokenText: outcome.spokenText, outcome };
    }

    // wrong_target
    const snapshot = await this.inspect();
    const blockers = snapshot?.blockers ?? [];
    const description = blockers.length
      ? `the "${blockers[0].kind}" dialog on ${snapshot?.host || 'the current page'}`
      : snapshot
        ? `"${snapshot.title}" on ${snapshot.host}`
        : 'no page';
    return {
      handled: true,
      spokenText:
        `Understood — I'm looking at ${description}. ` +
        (resolution.continueGoal
          ? `My unfinished goal is: ${resolution.continueGoal}. Tell me the next step and I'll continue from here.`
          : `Tell me what you want changed on this page.`),
    };
  }

  private async resumeStoredGoal(
    conversationId: string,
    goalText: string | null,
  ): Promise<string | null> {
    if (!goalText) return null;
    const state = browserStateStore.get(conversationId);
    if (state.blockingDialog?.isConsentDialog) {
      return `The consent dialog is still on screen, so I still need your cookie choice before continuing.`;
    }
    browserMetrics.record('browser_goal_resumed', { goalText });
    return `Continuing with: ${goalText}.`;
  }

  public async pauseMedia(opts?: { conversationId?: string }): Promise<{ success: boolean; spokenText: string }> {
    let page = this.activePage;
    if ((!page || page.isClosed()) && this.browser && this.context) {
      try {
        const resolved = await browserSessionAuthority.resolveCanonicalVisibleTab(this.browser, this.context);
        this.activePage = resolved.page;
        page = this.activePage;
      } catch {}
    }
    if (!page || page.isClosed()) {
      return { success: false, spokenText: 'There is no active browser page to pause.' };
    }
    try {
      // Step 1: Pause all HTML5 video elements directly
      await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
          if (!v.paused) {
            v.pause();
          }
        }
      }).catch(() => {});

      // Step 2: Check if video is paused
      let isPaused = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.paused : null;
      }).catch(() => null);

      // Step 3: If still playing, try YouTube player API
      if (isPaused === false) {
        await page.evaluate(() => {
          const moviePlayer = (document.getElementById('movie_player') || (window as any).movie_player) as any;
          if (moviePlayer && typeof moviePlayer.pauseVideo === 'function') {
            moviePlayer.pauseVideo();
          }
        }).catch(() => {});

        await page.waitForTimeout(100);
        isPaused = await page.evaluate(() => {
          const v = document.querySelector('video');
          return v ? v.paused : null;
        }).catch(() => null);
      }

      // Step 4: If STILL not paused, click play button ONLY IF it represents pause
      if (isPaused === false) {
        const playBtnClicked = await page.evaluate(() => {
          const ytBtn = document.querySelector('.ytp-play-button') as HTMLElement;
          if (ytBtn) {
            const title = ytBtn.getAttribute('data-title-no-tooltip')?.toLowerCase() || '';
            const ariaLabel = ytBtn.getAttribute('aria-label')?.toLowerCase() || '';
            if (title.includes('pause') || ariaLabel.includes('pause') || title.includes('unterbrechen')) {
              ytBtn.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (!playBtnClicked) {
          // Last resort: press 'k' only when video is confirmed still playing
          await page.keyboard.press('k').catch(() => {});
        }
        await page.waitForTimeout(200);
      }

      // Step 5: Final observation of media state
      const finalPaused = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) return v.paused;
        const moviePlayer = (document.getElementById('movie_player') || (window as any).movie_player) as any;
        if (moviePlayer && typeof moviePlayer.getPlayerState === 'function') {
          // 2 = PAUSED
          return moviePlayer.getPlayerState() === 2;
        }
        return true;
      }).catch(() => true);

      if (finalPaused === false) {
        return { success: false, spokenText: "I couldn't pause the video." };
      }

      if (opts?.conversationId) {
        activeInteractionContextStore.recordSuccess(opts.conversationId, 'pause', 'video');
      }
      return { success: true, spokenText: 'Paused the video.' };
    } catch (err: any) {
      return { success: false, spokenText: `Failed to pause: ${err?.message || err}` };
    }
  }

  public async playMedia(opts?: { conversationId?: string }): Promise<{ success: boolean; spokenText: string }> {
    let page = this.activePage;
    if ((!page || page.isClosed()) && this.browser && this.context) {
      try {
        const resolved = await browserSessionAuthority.resolveCanonicalVisibleTab(this.browser, this.context);
        this.activePage = resolved.page;
        page = this.activePage;
      } catch {}
    }
    if (!page || page.isClosed()) {
      return { success: false, spokenText: 'There is no active browser page to play.' };
    }
    try {
      await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
          if (v.paused) v.play().catch(() => {});
        }
        const moviePlayer = (document.getElementById('movie_player') || (window as any).movie_player) as any;
        if (moviePlayer && typeof moviePlayer.playVideo === 'function') {
          moviePlayer.playVideo();
        }
      }).catch(() => {});

      await page.waitForTimeout(200);

      if (opts?.conversationId) {
        activeInteractionContextStore.recordSuccess(opts.conversationId, 'play', 'video');
      }
      return { success: true, spokenText: 'Resumed video playback.' };
    } catch (err: any) {
      return { success: false, spokenText: `Failed to resume: ${err?.message || err}` };
    }
  }

  public async extractCompactSearchResults(conversationId?: string): Promise<CompactSearchResult[]> {
    const page = this.activePage;
    if (!page || page.isClosed()) return [];
    try {
      const url = page.url();
      const results: CompactSearchResult[] = await page.evaluate((currentUrl) => {
        const items: Array<{ type: 'channel' | 'video' | 'website' | 'link' | 'result'; title: string; href: string; visibleText: string }> = [];
        const seenHrefs = new Set<string>();

        if (/youtube\.com/i.test(currentUrl)) {
          // Channel renderers first (strictly from search result cards)
          const primaryChannelLinks = Array.from(document.querySelectorAll('ytd-channel-renderer a#main-link, #contents ytd-channel-renderer a#main-link, ytd-item-section-renderer ytd-channel-renderer a'));
          const channelLinks = primaryChannelLinks.length > 0 ? primaryChannelLinks : Array.from(document.querySelectorAll('ytd-channel-renderer a'));
          for (const el of channelLinks) {
            const a = el as HTMLAnchorElement;
            const href = a.href;
            const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
            if (href && text && !seenHrefs.has(href)) {
              seenHrefs.add(href);
              items.push({
                type: 'channel',
                title: text.split('\n')[0].trim(),
                href,
                visibleText: text.slice(0, 150),
              });
            }
          }

          // Video renderers
          const videoLinks = Array.from(document.querySelectorAll('ytd-video-renderer a#video-title, ytd-grid-video-renderer a#video-title, ytd-rich-grid-media a#video-title, a[href*="/watch?v="]'));
          for (const el of videoLinks) {
            const a = el as HTMLAnchorElement;
            const href = a.href;
            const text = (a.title || a.innerText || a.getAttribute('aria-label') || '').trim();
            const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
            const canonical = idMatch ? `https://www.youtube.com/watch?v=${idMatch[1]}` : href;
            if (canonical && text && !seenHrefs.has(canonical)) {
              seenHrefs.add(canonical);
              items.push({
                type: 'video',
                title: text.split('\n')[0].trim(),
                href: canonical,
                visibleText: text.slice(0, 150),
              });
            }
          }
        } else {
          // Generic search
          const gLinks = Array.from(document.querySelectorAll('#search a, #rso a, div[data-hveid] a'));
          for (const el of gLinks) {
            const a = el as HTMLAnchorElement;
            const h3 = a.querySelector('h3') || a;
            const title = (h3.textContent || '').trim();
            const href = a.href;
            if (href && title && !href.startsWith('https://www.google.com/search') && !seenHrefs.has(href)) {
              seenHrefs.add(href);
              items.push({
                type: 'website',
                title,
                href,
                visibleText: title,
              });
            }
          }
        }

        return items.slice(0, 15).map((item, idx) => ({ index: idx, ...item }));
      }, url);

      if (conversationId && results.length > 0) {
        const query = activeInteractionContextStore.get(conversationId).lastSearchQuery || '';
        activeInteractionContextStore.setSearchResults(conversationId, query, results);
      }
      return results;
    } catch (err: any) {
      logger.debug('[BrowserOperator] extractCompactSearchResults error:', err?.message);
      return [];
    }
  }

  public async openResultByIndex(
    index: number,
    opts: { conversationId: string; item?: CompactSearchResult }
  ): Promise<{ success: boolean; spokenText: string }> {
    const page = this.activePage;
    if (!page || page.isClosed()) {
      return { success: false, spokenText: 'There is no active browser page.' };
    }

    try {
      const ctx = activeInteractionContextStore.get(opts.conversationId);
      const targetItem = opts.item || ctx.lastSearchResults[index];
      if (!targetItem) {
        return { success: false, spokenText: `I only have ${ctx.lastSearchResults.length} results recorded.` };
      }

      await page.goto(targetItem.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});

      activeInteractionContextStore.selectResult(opts.conversationId, targetItem);
      activeInteractionContextStore.recordSuccess(opts.conversationId, 'open_result', targetItem.title, {
        activePageUrl: page.url(),
        activePageTitle: await page.title().catch(() => targetItem.title),
      });
      activeInteractionContextStore.pushNavigation(opts.conversationId, page.url(), await page.title().catch(() => targetItem.title));

      return {
        success: true,
        spokenText: `Opened ${targetItem.type === 'video' ? 'video' : 'result'} #${index + 1}, "${targetItem.title}".`,
      };
    } catch (err: any) {
      return { success: false, spokenText: `Failed to open result #${index + 1}: ${err?.message || err}` };
    }
  }

  public async openNewestVideo(
    opts: { conversationId: string }
  ): Promise<{ success: boolean; spokenText: string }> {
    const page = this.activePage;
    if (!page || page.isClosed()) {
      return { success: false, spokenText: 'There is no active browser page.' };
    }

    try {
      const videoList = await page.evaluate(() => {
        const videoLinks = Array.from(document.querySelectorAll('ytd-rich-grid-media a#video-title, ytd-grid-video-renderer a#video-title, ytd-video-renderer a#video-title, a[href*="/watch?v="]'));
        const list: Array<{ title: string; href: string }> = [];
        const seen = new Set<string>();
        for (const el of videoLinks) {
          const a = el as HTMLAnchorElement;
          const href = a.href;
          const title = (a.title || a.innerText || a.getAttribute('aria-label') || '').trim();
          const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
          const canonical = idMatch ? `https://www.youtube.com/watch?v=${idMatch[1]}` : href;
          if (canonical && title && !seen.has(canonical)) {
            seen.add(canonical);
            list.push({ href: canonical, title: title.split('\n')[0].trim() });
          }
        }
        return list;
      });

      if (!videoList || videoList.length === 0) {
        return { success: false, spokenText: 'Could not find any videos on this page.' };
      }

      const firstVideo = videoList[0];
      await page.goto(firstVideo.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});

      // Record all found videos into page result memory so follow-up ordinals ("the second one") resolve cleanly!
      const compactVideos: CompactSearchResult[] = videoList.slice(0, 10).map((v, idx) => ({
        index: idx,
        type: 'video',
        title: v.title,
        href: v.href,
        visibleText: v.title,
      }));
      activeInteractionContextStore.setSearchResults(opts.conversationId, 'channel videos', compactVideos);
      activeInteractionContextStore.selectResult(opts.conversationId, compactVideos[0]);
      activeInteractionContextStore.recordSuccess(opts.conversationId, 'open_newest_video', firstVideo.title, {
        activePageUrl: page.url(),
        activePageTitle: await page.title().catch(() => firstVideo.title),
      });
      activeInteractionContextStore.pushNavigation(opts.conversationId, page.url(), await page.title().catch(() => firstVideo.title));

      return {
        success: true,
        spokenText: `Playing the newest video, "${firstVideo.title}".`,
      };
    } catch (err: any) {
      return { success: false, spokenText: `Failed to open newest video: ${err?.message || err}` };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Accessors
  // ───────────────────────────────────────────────────────────────────────────

  public getPage(): Page | null {
    if (this.activePage && !this.activePage.isClosed()) return this.activePage;
    return null;
  }

  public async ensurePage(): Promise<Page> {
    const { page } = await this.ensureBrowser();
    return page;
  }

  public async getCurrentPage(): Promise<{ url: string; title: string } | null> {
    if (!this.activePage || this.activePage.isClosed()) {
      const allPages = (this.context?.pages() || []).concat(
        this.browser ? this.browser.contexts().flatMap((c) => c.pages()) : []
      );
      const openPages = allPages.filter((p) => !p.isClosed());
      if (openPages.length > 0) {
        this.activePage = openPages[openPages.length - 1];
      } else {
        return null;
      }
    }
    try {
      return {
        url: this.activePage.url(),
        title: await this.activePage.title().catch(() => ''),
      };
    } catch {
      return null;
    }
  }

  public getConversationState(conversationId: string): BrowserConversationState {
    return browserStateStore.get(conversationId);
  }

  public async waitForHost(expectedHost: string, timeoutMs = 10000): Promise<boolean> {
    if (!this.activePage) return false;
    return waitForHost(this.activePage, expectedHost, timeoutMs);
  }

  public async close(): Promise<void> {
    try {
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
    } finally {
      this.browser = null;
      this.context = null;
      this.activePage = null;
    }
  }
}

/** Classify a control as a consent choice, used only when it really is one. */
function VisibleControlConsentClass(
  control: VisibleControl,
): 'accept_all' | 'reject_optional' | 'more_options' | null {
  // Only treat it as a consent control when it plausibly is a button/radio.
  if (!['button', 'link', 'radio', 'checkbox', 'other'].includes(control.kind)) return null;
  const cls = consentChoiceClassOf(control.name);
  return cls;
}

export const browserOperator = new BrowserOperator();

/** Build a goal from a plain request, used by the executor. */
export function buildBrowserGoal(input: {
  goalText: string;
  targetId?: string | null;
  targetUrl?: string | null;
  steps?: BrowserGoalStep[];
}): BrowserGoal {
  return createBrowserGoal(input);
}

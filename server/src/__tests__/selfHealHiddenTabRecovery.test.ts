import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { browserOperator } from '../services/browser/browserOperator.js';
import { runWithBackgroundOwnership } from '../domains/jarvis/perception/turnOwnership.js';
import { BACKGROUND_REPAIR_POLICY } from '../domains/jarvis/perception/perceptionOperation.js';
import { browserSessionAuthority } from '../services/browser/browserSessionAuthority.js';
import { failureDetector } from '../domains/selfHeal/FailureDetector.js';

describe('Self-Heal Loop on Hidden-Tab Target Mismatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifier rejects background target, incident created, self-heal promotes visible target, reruns, resolves incident, speaks success', async () => {
    // 1. Mock failureDetector to track incident creation
    let createdIncidentId: string | null = null;
    const originalRecordFailure = failureDetector.recordFailure.bind(failureDetector);
    vi.spyOn(failureDetector, 'recordFailure').mockImplementation((comp, symptom, sev) => {
      createdIncidentId = `INCIDENT-${Date.now()}`;
      return createdIncidentId;
    });

    // 2. Mock ensureBrowser and browserSessionAuthority
    const fakePage = {
      isClosed: () => false,
      url: () => 'https://www.youtube.com/',
      title: async () => 'YouTube',
      goto: async () => {},
      bringToFront: async () => {},
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => ({ visibilityState: 'visible', hasFocus: true }),
      locator: () => ({ count: async () => 1 }),
      setDefaultNavigationTimeout: () => {},
      setDefaultTimeout: () => {},
    } as any;

    const fakeBrowser = {
      contexts: () => [fakeContext],
    } as any;

    const fakeContext = {
      pages: () => [fakePage],
      newPage: async () => fakePage,
    } as any;

    (browserOperator as any).browser = fakeBrowser;
    (browserOperator as any).context = fakeContext;
    (browserOperator as any).activePage = fakePage;
    (browserOperator as any).browserPid = 12345;

    vi.spyOn(browserOperator, 'ensureBrowser').mockResolvedValue({
      browser: fakeBrowser,
      context: fakeContext,
      page: fakePage,
    });

    // Mock queryCdpPageTargets to return 2 tabs: visible target 't-visible' and background target 't-background'
    vi.spyOn(browserSessionAuthority, 'queryCdpPageTargets').mockResolvedValue([
      { id: 't-visible', url: 'https://www.youtube.com/', title: 'YouTube', type: 'page' },
      { id: 't-background', url: 'https://www.google.com/', title: 'Google', type: 'page' },
    ]);

    let attemptCount = 0;
    vi.spyOn(browserSessionAuthority, 'verifyObservedReality').mockImplementation(async (identity, page) => {
      attemptCount++;
      if (attemptCount === 1) {
        // First attempt: simulate background target mismatch
        return {
          status: 'FAILED',
          verified: false,
          identity,
          observedState: {
            targetId: 't-background',
            url: 'https://www.google.com/',
            title: 'Google',
            host: 'google.com',
            isVisible: true,
            isForegroundWindow: true,
            visibilityState: 'hidden',
            hasFocus: false,
            interactive: true,
          },
          expectedState: identity.expectedPostCondition,
          failureReason: 'background_target_mismatch:active=t-visible_expected=t-background',
          truthfulSpokenText: "I couldn't open YouTube. The browser is still on Google.",
          error: 'background_target_mismatch',
        };
      } else {
        // Second attempt (after self-heal promotes visible target): verified success
        return {
          status: 'VERIFIED_SUCCESS',
          verified: true,
          identity,
          observedState: {
            targetId: 't-visible',
            url: 'https://www.youtube.com/',
            title: 'YouTube',
            host: 'youtube.com',
            isVisible: true,
            isForegroundWindow: true,
            visibilityState: 'visible',
            hasFocus: true,
            interactive: true,
          },
          expectedState: identity.expectedPostCondition,
          truthfulSpokenText: "I've opened YouTube.",
        };
      }
    });

    const result = await runWithBackgroundOwnership(
      {
        origin: 'self_heal',
        capability: 'self_heal_browser_rerun',
        policy: BACKGROUND_REPAIR_POLICY,
        source: 'selfHealHiddenTabRecovery.test',
      },
      () =>
        // A repair loop must re-run HEADLESS: the interactive mode would launch a
        // maximized visible Chrome and take over the user's browser/foreground.
        browserOperator.openTarget('https://www.youtube.com', {
          goalText: 'open YouTube',
          mode: 'BACKGROUND_BROWSER',
        }),
    );

    // Assertions:
    // 1. Initial attempt failed and triggered self-heal
    expect(attemptCount).toBe(2);
    // 2. Incident was recorded
    expect(createdIncidentId).not.toBeNull();
    // 3. Self-heal promoted visible target and succeeded
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.spokenText).toBe("I've opened YouTube.");
    expect(result.url).toBe('https://www.youtube.com/');
  });
});

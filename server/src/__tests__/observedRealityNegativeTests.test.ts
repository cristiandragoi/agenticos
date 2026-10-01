import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CanonicalBrowserSessionAuthority,
  browserSessionAuthority,
  type BrowserExecutionIdentity,
  type BrowserPostCondition,
} from '../services/browser/browserSessionAuthority.js';

describe('Observed Reality Contract — Negative Tests (Forced Failures)', () => {
  let authority: CanonicalBrowserSessionAuthority;

  beforeEach(() => {
    authority = CanonicalBrowserSessionAuthority.getInstance();
  });

  // A. Navigation executor returns success but browser remains Google
  it('Negative Test A: rejects success when executor claims success but observed URL is still Google', async () => {
    const fakePage = {
      isClosed: () => false,
      url: () => 'https://www.google.com/',
      title: async () => 'Google',
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => false,
      locator: () => ({ count: async () => 0 }),
    } as any;

    const identity: BrowserExecutionIdentity = {
      executionId: 'exec-test-A',
      browserSessionId: 'sess-1',
      browserContextId: 'ctx-1',
      targetId: 'p0',
      windowId: null,
      windowHandle: null,
      preActionUrl: 'https://www.google.com/',
      preActionTitle: 'Google',
      command: 'open YouTube',
      expectedPostCondition: {
        type: 'navigation',
        expectedHost: 'youtube.com',
        expectedHosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
        forbiddenHosts: ['google.com/search', 'google.com'],
      },
      createdAt: Date.now(),
    };

    const verification = await authority.verifyObservedReality(identity, fakePage);

    expect(verification.status).toBe('FAILED');
    expect(verification.verified).toBe(false);
    expect(verification.truthfulSpokenText).toBe("I couldn't open YouTube. The browser is still on Google.");
    expect(verification.truthfulSpokenText).not.toContain("I've opened YouTube");
  });

  // B. Browser action operates on hidden/background tab while visible tab remains Google
  it('Negative Test B: rejects success when action executes on wrong background target', async () => {
    const fakeBackgroundPage = {
      isClosed: () => false,
      url: () => 'https://www.google.com/',
      title: async () => 'Google Search',
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => false,
      locator: () => ({ count: async () => 0 }),
    } as any;

    const identity: BrowserExecutionIdentity = {
      executionId: 'exec-test-B',
      browserSessionId: 'sess-1',
      browserContextId: 'ctx-1',
      targetId: 'p-background',
      windowId: null,
      windowHandle: null,
      preActionUrl: 'https://www.google.com/',
      preActionTitle: 'Google',
      command: 'open YouTube',
      expectedPostCondition: {
        type: 'navigation',
        expectedHost: 'youtube.com',
        expectedHosts: ['youtube.com', 'www.youtube.com'],
      },
      createdAt: Date.now(),
    };

    const verification = await authority.verifyObservedReality(identity, fakeBackgroundPage);

    expect(verification.status).toBe('FAILED');
    expect(verification.verified).toBe(false);
    expect(verification.truthfulSpokenText).not.toBe("I've opened YouTube.");
  });

  // C. Page reference is stale or closed
  it('Negative Test C: detects dead/closed page and reports truthful failure', async () => {
    const deadPage = {
      isClosed: () => true,
      url: () => '',
      title: async () => '',
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
    } as any;

    const identity: BrowserExecutionIdentity = {
      executionId: 'exec-test-C',
      browserSessionId: 'sess-1',
      browserContextId: 'ctx-1',
      targetId: 'p-dead',
      windowId: null,
      windowHandle: null,
      preActionUrl: 'https://www.google.com/',
      preActionTitle: 'Google',
      command: 'open YouTube',
      expectedPostCondition: {
        type: 'navigation',
        expectedHost: 'youtube.com',
      },
      createdAt: Date.now(),
    };

    const verification = await authority.verifyObservedReality(identity, deadPage);

    expect(verification.status).toBe('FAILED');
    expect(verification.failureReason).toBe('target_page_closed');
    expect(verification.truthfulSpokenText).toContain('closed unexpectedly');
    expect(verification.truthfulSpokenText).not.toContain("I've opened YouTube");
  });

  // D. Browser action converts navigation into Google search results page
  it('Negative Test D: detects search engine result redirect instead of target destination', async () => {
    const searchResultPage = {
      isClosed: () => false,
      url: () => 'https://www.google.com/search?q=youtube',
      title: async () => 'youtube - Google Search',
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => false,
      locator: () => ({ count: async () => 0 }),
    } as any;

    const identity: BrowserExecutionIdentity = {
      executionId: 'exec-test-D',
      browserSessionId: 'sess-1',
      browserContextId: 'ctx-1',
      targetId: 'p0',
      windowId: null,
      windowHandle: null,
      preActionUrl: 'https://www.google.com/',
      preActionTitle: 'Google',
      command: 'open YouTube',
      expectedPostCondition: {
        type: 'navigation',
        expectedHost: 'youtube.com',
        expectedHosts: ['youtube.com', 'www.youtube.com'],
        forbiddenHosts: ['google.com/search', 'bing.com/search'],
      },
      createdAt: Date.now(),
    };

    const verification = await authority.verifyObservedReality(identity, searchResultPage);

    expect(verification.status).toBe('FAILED');
    expect(verification.failureReason).toContain('browser_redirected_to_forbidden');
    expect(verification.truthfulSpokenText).toContain("I couldn't open YouTube");
  });

  // E. Navigation redirects unexpectedly to error page
  it('Negative Test E: detects chrome-error or crash page', async () => {
    const errorPage = {
      isClosed: () => false,
      url: () => 'chrome-error://chromewebdata/',
      title: async () => 'Site cannot be reached',
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => false,
      locator: () => ({ count: async () => 0 }),
    } as any;

    const identity: BrowserExecutionIdentity = {
      executionId: 'exec-test-E',
      browserSessionId: 'sess-1',
      browserContextId: 'ctx-1',
      targetId: 'p0',
      windowId: null,
      windowHandle: null,
      preActionUrl: 'https://www.google.com/',
      preActionTitle: 'Google',
      command: 'open YouTube',
      expectedPostCondition: {
        type: 'navigation',
        expectedHost: 'youtube.com',
        expectedHosts: ['youtube.com', 'www.youtube.com'],
        forbiddenHosts: ['chrome-error://'],
      },
      createdAt: Date.now(),
    };

    const verification = await authority.verifyObservedReality(identity, errorPage);

    expect(verification.status).toBe('FAILED');
    expect(verification.verified).toBe(false);
    expect(verification.truthfulSpokenText).not.toContain("I've opened YouTube");
  });

  // F. Media pause verification fails when video does not pause
  it('Negative Test F: media pause fails when video element remains playing', async () => {
    const playingMediaPage = {
      isClosed: () => false,
      url: () => 'https://www.youtube.com/watch?v=123',
      title: async () => 'Video Title - YouTube',
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => false, // media paused == false
      locator: () => ({ count: async () => 1 }),
    } as any;

    const identity: BrowserExecutionIdentity = {
      executionId: 'exec-test-F',
      browserSessionId: 'sess-1',
      browserContextId: 'ctx-1',
      targetId: 'p0',
      windowId: null,
      windowHandle: null,
      preActionUrl: 'https://www.youtube.com/watch?v=123',
      preActionTitle: 'Video Title',
      command: 'pause it',
      expectedPostCondition: {
        type: 'media_state',
        expectedMediaPaused: true,
      },
      createdAt: Date.now(),
    };

    const verification = await authority.verifyObservedReality(identity, playingMediaPage);

    expect(verification.status).toBe('FAILED');
    expect(verification.verified).toBe(false);
    expect(verification.failureReason).toContain('media_state_mismatch');
    expect(verification.truthfulSpokenText).toContain("I couldn't pause the media");
  });
});

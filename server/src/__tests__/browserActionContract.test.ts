/**
 * browserActionContract.test.ts — Regression suite for defect D22.
 *
 * D22: Jarvis could NAVIGATE but could not INTERACT. A cookie/consent dialog on
 * YouTube left the page unusable, yet the operator answered "I've opened YouTube."
 * after a user asked for a CLICK. Navigation was reported as task completion.
 *
 * These tests pin the decision rules that were missing. They run without a
 * browser; the real-DOM half lives in browserInteractionContract.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertNoNavigationAsCompletion,
  authorizeConsentChoice,
  browserMetrics,
  browserStateStore,
  buildVerificationEvidence,
  classifyBlockingDialog,
  consentChoiceForLabel,
  ConsentPreferenceRegistry,
  createBrowserGoal,
  decideGoalContinuation,
  detectRepeatedNavigationInsteadOfClick,
  emptyBrowserState,
  matchControlByAccessibleName,
  registrableDomainOf,
  resolveConversationalCorrection,
  resolveIndexedElement,
  serializeInteractiveSnapshot,
  BrowserMetricsLedger,
  type VisibleControl,
  type PageStateSnapshot,
} from '../services/browser/browserActionContract.js';

function control(partial: Partial<VisibleControl> & { name: string }): VisibleControl {
  return {
    role: 'button',
    tagName: 'button',
    kind: 'button',
    visible: true,
    disabled: false,
    ...partial,
  };
}

/** The three buttons the user actually saw on the YouTube consent screen. */
const YOUTUBE_CONSENT_CONTROLS: VisibleControl[] = [
  control({ name: 'Alle ablehnen' }),
  control({ name: 'Alle akzeptieren' }),
  control({ name: 'Weitere Optionen' }),
];

function snapshot(partial: Partial<PageStateSnapshot> = {}): PageStateSnapshot {
  return {
    url: 'https://www.youtube.com/',
    title: 'YouTube',
    host: 'youtube.com',
    readyState: 'complete',
    controls: YOUTUBE_CONSENT_CONTROLS,
    blockers: [],
    loginScreen: false,
    consentDialog: null,
    contentUsable: true,
    capturedAt: Date.now(),
    ...partial,
  };
}

describe('D22 — consent wording maps to the right canonical choice', () => {
  it('distinguishes "Alle ablehnen" from "Alle akzeptieren"', () => {
    expect(consentChoiceForLabel('Alle ablehnen')).toBe('reject_optional');
    expect(consentChoiceForLabel('Alle akzeptieren')).toBe('accept_all');
    expect(consentChoiceForLabel('Weitere Optionen')).toBe('more_options');
  });

  it('tolerates case, accents and trailing punctuation', () => {
    expect(consentChoiceForLabel('  ALLE  AKZEPTIEREN. ')).toBe('accept_all');
    expect(consentChoiceForLabel('Accept all')).toBe('accept_all');
    expect(consentChoiceForLabel('Reject all')).toBe('reject_optional');
    expect(consentChoiceForLabel('Tout accepter')).toBe('accept_all');
  });

  it('does not invent a choice for unrelated text', () => {
    expect(consentChoiceForLabel('Subscribe')).toBeNull();
    expect(consentChoiceForLabel('')).toBeNull();
    expect(consentChoiceForLabel('Share')).toBeNull();
  });
});

describe('D22 — finding the button the user named', () => {
  it('finds "Alle akzeptieren" and not "Alle ablehnen"', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'Alle akzeptieren');
    expect(match.control?.name).toBe('Alle akzeptieren');
    expect(match.strategy).toBe('exact_name');
  });

  it('resolves the English instruction against the German UI via consent synonyms', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'accept all');
    expect(match.control?.name).toBe('Alle akzeptieren');
  });

  it('resolves "reject all" to the German reject button', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'reject all');
    expect(match.control?.name).toBe('Alle ablehnen');
  });

  it('ignores invisible and disabled controls', () => {
    const controls = [
      control({ name: 'Alle akzeptieren', visible: false }),
      control({ name: 'Alle akzeptieren', disabled: true }),
    ];
    const match = matchControlByAccessibleName(controls, 'Alle akzeptieren');
    expect(match.control).toBeNull();
  });

  it('reports no match instead of guessing a near-miss', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'Delete account');
    expect(match.control).toBeNull();
    expect(match.strategy).toBe('none');
  });
});

describe('D22 — consent choices are the user\'s decision', () => {
  let registry: ConsentPreferenceRegistry;

  beforeEach(() => {
    registry = new ConsentPreferenceRegistry();
  });

  it('refuses to choose when nothing authorizes it', () => {
    const auth = authorizeConsentChoice({
      url: 'https://www.youtube.com/',
      registry,
    });
    expect(auth.authorized).toBe(false);
    expect(auth.choice).toBeNull();
    expect(auth.source).toBe('none');
    expect(auth.reason).toMatch(/yours to make/i);
  });

  it('acts when the user explicitly says which option to pick', () => {
    const auth = authorizeConsentChoice({
      url: 'https://www.youtube.com/',
      explicitUserChoice: 'accept_all',
      registry,
    });
    expect(auth.authorized).toBe(true);
    expect(auth.choice).toBe('accept_all');
    expect(auth.source).toBe('user_explicit');
  });

  it('acts from a stored per-domain preference', () => {
    registry.set('youtube.com', 'accept_all');
    const auth = authorizeConsentChoice({ url: 'https://www.youtube.com/', registry });
    expect(auth.authorized).toBe(true);
    expect(auth.choice).toBe('accept_all');
    expect(auth.source).toBe('stored_preference');
  });

  it('a stored "ask" preference still forces a question', () => {
    registry.set('youtube.com', 'ask');
    const auth = authorizeConsentChoice({ url: 'https://www.youtube.com/', registry });
    expect(auth.authorized).toBe(false);
  });

  it('honours google.com as a parent preference for youtube.com', () => {
    registry.set('google.com', 'reject_optional', { aliases: ['youtube.com'] });
    const auth = authorizeConsentChoice({ url: 'https://www.youtube.com/watch?v=1', registry });
    expect(auth.authorized).toBe(true);
    expect(auth.choice).toBe('reject_optional');
  });

  it('does not leak a preference to an unrelated domain', () => {
    registry.set('youtube.com', 'accept_all');
    const auth = authorizeConsentChoice({ url: 'https://example.com/', registry });
    expect(auth.authorized).toBe(false);
  });

  it('reduces URLs to a registrable domain', () => {
    expect(registrableDomainOf('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
    expect(registrableDomainOf('youtube.com')).toBe('youtube.com');
  });
});

describe('D22 — the blocking dialog is detected, not ignored', () => {
  it('classifies the YouTube consent screen as a consent dialog', () => {
    const blocker = classifyBlockingDialog({
      text: 'Bevor du zu YouTube gehst, kannst du deine Cookie-Einstellungen ändern.',
      controls: YOUTUBE_CONSENT_CONTROLS,
      containerIsDialog: true,
    });
    expect(blocker?.kind).toBe('cookie_consent');
    expect(blocker?.isConsentDialog).toBe(true);
  });

  it('classifies an English consent wall', () => {
    const blocker = classifyBlockingDialog({
      text: 'Before you continue to YouTube, we use cookies.',
      controls: [control({ name: 'Accept all' }), control({ name: 'Reject all' })],
      containerIsDialog: true,
    });
    expect(blocker?.kind).toBe('cookie_consent');
  });

  it('does not treat an ordinary dialog as a consent dialog', () => {
    const blocker = classifyBlockingDialog({
      text: 'Delete this video?',
      controls: [control({ name: 'Cancel' }), control({ name: 'Delete' })],
      containerIsDialog: true,
    });
    expect(blocker?.kind).toBe('modal');
    expect(blocker?.isConsentDialog).toBe(false);
  });

  it('detects a captcha as a hard blocker', () => {
    const blocker = classifyBlockingDialog({
      text: 'Please verify you are human. reCAPTCHA',
      controls: [control({ name: 'Verify' })],
      containerIsDialog: true,
    });
    expect(blocker?.kind).toBe('captcha');
  });
});

describe('D22 — clearing the modal is not the goal', () => {
  it('resumes the original objective once the consent dialog is gone', () => {
    const goal = createBrowserGoal({
      goalText: 'Open YouTube and search for Seeadler TV',
      steps: [{ kind: 'type', description: 'search for Seeadler TV', query: 'Seeadler TV' }],
    });
    const decision = decideGoalContinuation(goal, { blockers: [], contentUsable: true });
    expect(decision.next).toBe('resume_step');
    expect(decision.step?.query).toBe('Seeadler TV');
  });

  it('keeps asking to handle the blocker while it is still present', () => {
    const goal = createBrowserGoal({
      goalText: 'Open YouTube and search for Seeadler TV',
      steps: [{ kind: 'type', description: 'search', query: 'Seeadler TV' }],
    });
    const blocker = classifyBlockingDialog({
      text: 'cookies',
      controls: YOUTUBE_CONSENT_CONTROLS,
      containerIsDialog: true,
    })!;
    const decision = decideGoalContinuation(goal, { blockers: [blocker], contentUsable: false });
    expect(decision.next).toBe('handle_blocker');
  });

  it('does not auto-continue past a captcha', () => {
    const goal = createBrowserGoal({ goalText: 'search', steps: [] });
    const captcha = {
      kind: 'captcha' as const,
      text: 'verify you are human',
      controls: [],
      isConsentDialog: false,
    };
    const decision = decideGoalContinuation(goal, { blockers: [captcha], contentUsable: false });
    expect(decision.next).toBe('ask_user');
  });

  it('reports completion only when no steps remain', () => {
    const goal = createBrowserGoal({ goalText: 'open YouTube', steps: [] });
    expect(decideGoalContinuation(goal, { blockers: [], contentUsable: true }).next).toBe('complete');
  });
});

describe('D22 — verification requires evidence, not assertion', () => {
  const consentBlocker = classifyBlockingDialog({
    text: 'cookies',
    controls: YOUTUBE_CONSENT_CONTROLS,
    containerIsDialog: true,
  })!;

  it('verifies a click only when the dialog actually disappeared', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'Alle akzeptieren');
    const evidence = buildVerificationEvidence({
      match,
      dispatched: true,
      stateBefore: { blockers: [consentBlocker], contentUsable: false },
      stateAfter: { blockers: [], contentUsable: true },
      expected: 'dialog_disappears',
    });
    expect(evidence.found).toBe(true);
    expect(evidence.dispatched).toBe(true);
    expect(evidence.stateChanged).toBe(true);
    expect(evidence.changeDetail).toBe('the blocking dialog is gone');
    expect(evidence.verified).toBe(true);
  });

  it('does NOT verify when the dialog persisted', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'Alle akzeptieren');
    const evidence = buildVerificationEvidence({
      match,
      dispatched: true,
      stateBefore: { blockers: [consentBlocker], contentUsable: false },
      stateAfter: { blockers: [consentBlocker], contentUsable: false },
      expected: 'dialog_disappears',
    });
    expect(evidence.dispatched).toBe(true);
    expect(evidence.stateChanged).toBe(false);
    expect(evidence.verified).toBe(false);
  });

  it('does not verify a click that was never dispatched', () => {
    const match = matchControlByAccessibleName(YOUTUBE_CONSENT_CONTROLS, 'Alle akzeptieren');
    const evidence = buildVerificationEvidence({
      match,
      dispatched: false,
      stateBefore: { blockers: [consentBlocker], contentUsable: false },
      stateAfter: { blockers: [], contentUsable: true },
      expected: 'dialog_disappears',
    });
    expect(evidence.dispatched).toBe(false);
    expect(evidence.verified).toBe(false);
  });
});

describe('D22 — "I\'ve opened YouTube." is banned when a click was requested', () => {
  it('rejects the exact regression from the defect report', () => {
    const check = assertNoNavigationAsCompletion({
      requestedAction: 'click',
      blockerPresent: true,
      message: "I've opened YouTube.",
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/not for the page to be opened|blocking dialog/i);
  });

  it('rejects navigation wording for a click even with no blocker', () => {
    const check = assertNoNavigationAsCompletion({
      requestedAction: 'click',
      blockerPresent: false,
      message: "I've opened YouTube.",
    });
    expect(check.ok).toBe(false);
  });

  it('rejects navigation wording while a blocker is still on screen', () => {
    const check = assertNoNavigationAsCompletion({
      requestedAction: 'navigate',
      blockerPresent: true,
      message: "I've opened YouTube.",
    });
    expect(check.ok).toBe(false);
  });

  it('allows plain navigation wording when the page is genuinely usable', () => {
    const check = assertNoNavigationAsCompletion({
      requestedAction: 'navigate',
      blockerPresent: false,
      message: "I've opened YouTube.",
    });
    expect(check.ok).toBe(true);
  });

  it('allows a verified click report', () => {
    const check = assertNoNavigationAsCompletion({
      requestedAction: 'click',
      blockerPresent: false,
      message: 'Done. The consent screen is gone and YouTube is ready.',
    });
    expect(check.ok).toBe(true);
  });
});

describe('D22 — conversational correction operates on current browser state', () => {
  it('resolves "Accept it." against the visible consent dialog and keeps the goal', () => {
    const state = {
      ...emptyBrowserState(),
      lastBrowserGoal: 'Open YouTube and search for Seeadler TV',
      blockingDialog: classifyBlockingDialog({
        text: 'cookies',
        controls: YOUTUBE_CONSENT_CONTROLS,
        containerIsDialog: true,
      }),
    };
    const resolution = resolveConversationalCorrection('Accept it.', state);
    expect(resolution.kind).toBe('accept_consent');
    expect(resolution.continueGoal).toBe('Open YouTube and search for Seeadler TV');
    expect(resolution.reason).toMatch(/consent dialog that is currently on screen/i);
  });

  it('resolves "Click accept all." as a consent action', () => {
    const state = {
      ...emptyBrowserState(),
      blockingDialog: classifyBlockingDialog({
        text: 'cookies',
        controls: YOUTUBE_CONSENT_CONTROLS,
        containerIsDialog: true,
      }),
    };
    expect(resolveConversationalCorrection('Click accept all.', state).kind).toBe('accept_consent');
  });

  it('treats "No, that\'s the Google screen. Accept it and continue." as a correction, not a new command', () => {
    const state = {
      ...emptyBrowserState(),
      lastBrowserGoal: 'Open YouTube and search for Seeadler TV',
      blockingDialog: classifyBlockingDialog({
        text: 'cookies',
        controls: YOUTUBE_CONSENT_CONTROLS,
        containerIsDialog: true,
      }),
    };
    const resolution = resolveConversationalCorrection(
      "No, that's the Google screen. Accept it and continue.",
      state,
    );
    // "accept" dominates over the negative framing: the user is authorizing the choice.
    expect(resolution.kind).toBe('accept_consent');
    expect(resolution.continueGoal).toBe('Open YouTube and search for Seeadler TV');
  });

  it('resolves "Continue to YouTube." as goal continuation, not a fresh navigation', () => {
    const state = {
      ...emptyBrowserState(),
      lastBrowserGoal: 'Open YouTube and search for Seeadler TV',
    };
    const resolution = resolveConversationalCorrection('Continue to YouTube.', state);
    expect(resolution.kind).toBe('continue_goal');
    expect(resolution.continueGoal).toBe('Open YouTube and search for Seeadler TV');
  });

  it('resolves "That\'s not what I wanted." as a wrong-target correction', () => {
    const state = { ...emptyBrowserState(), lastBrowserGoal: 'Open YouTube' };
    const resolution = resolveConversationalCorrection("That's not what I wanted.", state);
    expect(resolution.kind).toBe('wrong_target');
    expect(resolution.continueGoal).toBe('Open YouTube');
  });

  it('does not hijack an unrelated utterance as a correction', () => {
    const resolution = resolveConversationalCorrection('What is the weather in Berlin?', emptyBrowserState());
    expect(resolution.kind).toBe('not_a_correction');
  });
});

describe('D22 — browser state survives across turns', () => {
  it('stores and returns the full state record', () => {
    const id = `conv-${Date.now()}`;
    browserStateStore.update(id, {
      lastBrowserGoal: 'search for Seeadler TV',
      lastBrowserUrl: 'https://www.youtube.com/',
      lastBrowserTitle: 'YouTube',
      lastBrowserAction: 'navigate:YouTube',
      lastBrowserResult: 'page blocked',
      pendingBrowserAction: { kind: 'click', requested: 'Alle akzeptieren', createdAt: Date.now() },
      visibleTarget: 'YouTube',
      verificationState: 'blocked',
      blockedReason: 'cookie_consent dialog present',
    });
    const state = browserStateStore.get(id);
    expect(state.lastBrowserGoal).toBe('search for Seeadler TV');
    expect(state.pendingBrowserAction?.requested).toBe('Alle akzeptieren');
    expect(state.verificationState).toBe('blocked');
    browserStateStore.clear(id);
  });

  it('keeps conversations isolated', () => {
    const a = `conv-a-${Date.now()}`;
    const b = `conv-b-${Date.now()}`;
    browserStateStore.update(a, { lastBrowserGoal: 'goal A' });
    expect(browserStateStore.get(b).lastBrowserGoal).toBeNull();
    browserStateStore.clear(a);
    browserStateStore.clear(b);
  });
});

describe('D22 — metrics the stability regression watches', () => {
  beforeEach(() => browserMetrics.reset());

  it('counts requested / verified / failed / blocker events', () => {
    browserMetrics.record('browser_action_requested', { kind: 'click' });
    browserMetrics.record('browser_blocker_detected', { kind: 'cookie_consent' });
    browserMetrics.record('browser_blocker_resolved');
    browserMetrics.record('browser_action_verified');
    browserMetrics.record('browser_action_failed');
    browserMetrics.record('browser_context_lost');

    const snap = browserMetrics.snapshot();
    expect(snap.browser_action_requested).toBe(1);
    expect(snap.browser_action_verified).toBe(1);
    expect(snap.browser_action_failed).toBe(1);
    expect(snap.browser_blocker_detected).toBe(1);
    expect(snap.browser_blocker_resolved).toBe(1);
    expect(snap.browser_context_lost).toBe(1);
  });

  it('exposes every metric name the defect registry requires', () => {
    const snap = browserMetrics.snapshot();
    for (const key of [
      'browser_action_requested',
      'browser_action_verified',
      'browser_action_failed',
      'browser_blocker_detected',
      'browser_blocker_resolved',
      'browser_context_lost',
    ]) {
      expect(snap).toHaveProperty(key);
    }
  });
});

describe('D22 — navigation alone never satisfies a page goal', () => {
  it('a snapshot with a consent blocker is not usable', () => {
    const consentBlocker = classifyBlockingDialog({
      text: 'cookies',
      controls: YOUTUBE_CONSENT_CONTROLS,
      containerIsDialog: true,
    })!;
    const s = snapshot({ blockers: [consentBlocker], contentUsable: false });
    expect(s.contentUsable).toBe(false);
    expect(s.blockers[0].isConsentDialog).toBe(true);
  });
});

describe('D22 — repeated navigation when a click was requested opens a regression', () => {
  beforeEach(() => browserMetrics.reset());

  it('detects navigation substituted for a requested click', () => {
    const ledger = new BrowserMetricsLedger();
    ledger.record('browser_action_requested', { kind: 'click', name: 'Alle akzeptieren' });
    ledger.record('browser_action_verified', { kind: 'navigate', target: 'YouTube' });

    const regression = detectRepeatedNavigationInsteadOfClick(ledger);
    expect(regression).not.toBeNull();
    expect(regression?.kind).toBe('navigation_substituted_for_click');
    expect(regression?.detail).toMatch(/navigation is not task completion/i);
  });

  it('does NOT fire when the click was actually verified', () => {
    const ledger = new BrowserMetricsLedger();
    ledger.record('browser_action_requested', { kind: 'click', name: 'Alle akzeptieren' });
    ledger.record('browser_action_verified', { kind: 'click', name: 'Alle akzeptieren' });
    ledger.record('browser_action_verified', { kind: 'navigate', target: 'YouTube' });

    expect(detectRepeatedNavigationInsteadOfClick(ledger)).toBeNull();
  });

  it('does NOT fire for a plain navigation request', () => {
    const ledger = new BrowserMetricsLedger();
    ledger.record('browser_action_requested', { kind: 'navigate', target: 'YouTube' });
    ledger.record('browser_action_verified', { kind: 'navigate', target: 'YouTube' });

    expect(detectRepeatedNavigationInsteadOfClick(ledger)).toBeNull();
  });

  it('ignores events outside the window', () => {
    const ledger = new BrowserMetricsLedger();
    ledger.record('browser_action_requested', { kind: 'click' });
    ledger.record('browser_action_verified', { kind: 'navigate' });

    // Events recorded ~now are older than the window when the clock is read
    // 5s later with a 1s window, so they must not count.
    expect(
      detectRepeatedNavigationInsteadOfClick(ledger, {
        windowMs: 1000,
        now: Date.now() + 5000,
      }),
    ).toBeNull();
  });

  it('exposes the offending events as evidence', () => {
    const ledger = new BrowserMetricsLedger();
    ledger.record('browser_action_requested', { kind: 'click', name: 'Alle akzeptieren' });
    ledger.record('browser_action_verified', { kind: 'navigate', target: 'YouTube' });

    const regression = detectRepeatedNavigationInsteadOfClick(ledger);
    expect(regression?.evidence.length).toBe(2);
    expect(regression?.evidence[0].name).toBe('browser_action_requested');
    expect(regression?.evidence[1].name).toBe('browser_action_verified');
  });
});

describe('Browser Use adaptation — indexed accessibility snapshot', () => {
  function blockedSnapshot(): PageStateSnapshot {
    // Real controls always carry a DOM marker; these fixtures mirror that.
    const dialogControls = [
      control({ name: 'Alle ablehnen', marker: 'h1' }),
      control({ name: 'Alle akzeptieren', marker: 'h2' }),
      control({ name: 'Weitere Optionen', marker: 'h3' }),
    ];
    const blocker = classifyBlockingDialog({
      text: 'Wir verwenden Cookies.',
      controls: dialogControls,
      containerIsDialog: true,
    })!;
    return snapshot({
      controls: [...dialogControls, control({ name: 'Subscribe', marker: 'h4' })],
      blockers: [blocker],
      contentUsable: false,
    });
  }

  it('numbers the interactive elements and lists dialog options first', () => {
    const indexed = serializeInteractiveSnapshot(blockedSnapshot());

    expect(indexed.elements.length).toBe(4);
    expect(indexed.elements.map((e) => e.index)).toEqual([1, 2, 3, 4]);
    // The dialog is what the user can actually act on, so it leads.
    expect(indexed.elements[0].name).toBe('Alle ablehnen');
    expect(indexed.elements[1].name).toBe('Alle akzeptieren');
    expect(indexed.elements[2].name).toBe('Weitere Optionen');
  });

  it('renders a compact machine-readable page state', () => {
    const indexed = serializeInteractiveSnapshot(blockedSnapshot());

    expect(indexed.text).toContain('CONTENT_USABLE: no');
    expect(indexed.text).toContain('BLOCKING_DIALOG: cookie_consent');
    expect(indexed.text).toContain('(cookie/privacy consent — the USER decides)');
    expect(indexed.text).toContain('DIALOG_OPTIONS: 1, 2, 3');
    expect(indexed.text).toContain('[2] button "Alle akzeptieren"');
    expect(indexed.text).toContain('[4] button "Subscribe"');
  });

  it('marks which elements belong to the blocking dialog', () => {
    const indexed = serializeInteractiveSnapshot(blockedSnapshot());
    expect(indexed.blocker?.isConsentDialog).toBe(true);
    expect(indexed.blocker?.optionIndices).toEqual([1, 2, 3]);
    // The non-dialog control must not be flagged.
    expect(indexed.blocker?.optionIndices).not.toContain(4);
  });

  it('keeps DOM identity on every index so actions need no coordinates', () => {
    const indexed = serializeInteractiveSnapshot(blockedSnapshot());
    for (const el of indexed.elements) {
      expect(el.marker).toBeTruthy();
    }
  });

  it('reports a usable page with no blocker', () => {
    const indexed = serializeInteractiveSnapshot(
      snapshot({ controls: [control({ name: 'Subscribe' })], blockers: [], contentUsable: true }),
    );
    expect(indexed.blocker).toBeNull();
    expect(indexed.text).toContain('CONTENT_USABLE: yes');
    expect(indexed.text).toContain('[1] button "Subscribe"');
  });
});

describe('Browser Use adaptation — index resolution refuses stale maps', () => {
  const elements = [
    { index: 1, role: 'button', name: 'Alle ablehnen', kind: 'button' as const, marker: 'h1' },
    { index: 2, role: 'button', name: 'Alle akzeptieren', kind: 'button' as const, marker: 'h2' },
  ];

  it('resolves a valid index', () => {
    const res = resolveIndexedElement({
      index: 2,
      state: { lastIndexedElements: elements, indexedUrl: 'https://www.youtube.com/' },
      currentUrl: 'https://www.youtube.com/',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.element.name).toBe('Alle akzeptieren');
  });

  it('refuses an index from a different page', () => {
    const res = resolveIndexedElement({
      index: 2,
      state: { lastIndexedElements: elements, indexedUrl: 'https://www.youtube.com/' },
      currentUrl: 'https://example.com/',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/stale list/i);
  });

  it('refuses an index that does not exist and says what does', () => {
    const res = resolveIndexedElement({
      index: 99,
      state: { lastIndexedElements: elements, indexedUrl: 'https://www.youtube.com/' },
      currentUrl: 'https://www.youtube.com/',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Available: 1, 2/);
  });

  it('refuses when no inspection has happened yet', () => {
    const res = resolveIndexedElement({
      index: 1,
      state: { lastIndexedElements: [], indexedUrl: null },
      currentUrl: 'https://www.youtube.com/',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/inspect the page first/i);
  });
});

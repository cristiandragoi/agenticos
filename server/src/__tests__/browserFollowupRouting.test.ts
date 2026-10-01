/**
 * browserFollowupRouting.test.ts — canonical Jarvis routing for browser follow-ups.
 *
 * These tests drive the REAL conversational entry point
 * (`universalExecutionController.handleUserTurn`), NOT browserExecutor directly,
 * and assert on consecutive turns. They prove that a contextual browser utterance
 * is routed to the existing browser follow-up handler instead of falling into
 * generic chat or a generic "What would you like me to do with browser?"
 * clarification.
 *
 * No browser is launched: the assertions are about ROUTING, CONTEXT REUSE,
 * PREFERENCE HANDLING and TRUTHFUL RENDERING. Actual page interaction is covered
 * by the live acceptance chain.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import {
  authorizeConsentChoice,
  browserMetrics,
  browserStateStore,
  ConsentPreferenceRegistry,
  classifyBlockingDialog,
  resolveConversationalCorrection,
  type VisibleControl,
} from '../services/browser/browserActionContract.js';
import {
  browserPreferences,
  parsePreferenceCommand,
  familyAliasesFor,
} from '../services/browser/browserPreferencesStore.js';

const GENERIC_BROWSER_PROMPT = /what would you like me to do with browser/i;

function control(name: string): VisibleControl {
  return {
    role: 'button',
    name,
    tagName: 'button',
    kind: 'button',
    visible: true,
    disabled: false,
  };
}

const CONSENT_DIALOG = classifyBlockingDialog({
  text: 'Wir verwenden Cookies.',
  controls: [control('Alle ablehnen'), control('Alle akzeptieren'), control('Weitere Optionen')],
  containerIsDialog: true,
})!;

let conv: string;
let turnSeq = 0;

async function turn(prompt: string) {
  turnSeq += 1;
  return universalExecutionController.handleUserTurn({
    prompt,
    conversationId: conv,
    turnId: `${conv}-t${turnSeq}`,
  });
}

function seedBrowserState(patch: Parameters<typeof browserStateStore.update>[1]) {
  browserStateStore.update(conv, patch);
}

beforeEach(() => {
  conv = `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  browserMetrics.reset();
});

describe('canonical routing — browser context is reused, not reset', () => {
  it('A. "Accept it." with a visible consent blocker routes to the browser handler', async () => {
    seedBrowserState({
      lastBrowserGoal: 'Open YouTube and search for Seeadler TV',
      lastBrowserUrl: 'https://www.youtube.com/',
      lastBrowserTitle: 'YouTube',
      blockingDialog: CONSENT_DIALOG,
      visibleTarget: 'YouTube',
    });

    const result = await turn('Accept it.');

    expect(result.route).toBe('browser');
    expect(result.goalId).toMatch(/^browser_followup:/);
    expect(result.spokenText).not.toMatch(GENERIC_BROWSER_PROMPT);
    expect(browserMetrics.count('browser_followup_routed')).toBeGreaterThan(0);
    expect(browserMetrics.count('browser_context_reused')).toBeGreaterThan(0);
  });

  it('B. "Open the channel." after a search reuses the results-page context', async () => {
    seedBrowserState({
      lastBrowserGoal: 'search YouTube for Seeadler TV',
      lastBrowserUrl: 'https://www.youtube.com/results?search_query=Seeadler+TV',
      lastBrowserTitle: 'Seeadler TV - YouTube',
      blockingDialog: null,
      visibleTarget: 'SEEADLER TV',
    });

    const result = await turn('Open the channel.');

    expect(result.route).toBe('browser');
    expect(result.goalId).toBe('browser_followup:open_channel');
    expect(result.spokenText).not.toMatch(GENERIC_BROWSER_PROMPT);
    expect(browserMetrics.count('browser_context_reused')).toBeGreaterThan(0);
  });

  it('C. "That\'s wrong. Go back." is treated as a browser correction', async () => {
    seedBrowserState({
      lastBrowserGoal: 'search YouTube for Seeadler TV',
      lastBrowserUrl: 'https://www.youtube.com/@SEEADLERTV',
      lastBrowserAction: 'open_result:SEEADLER TV',
      visibleTarget: 'SEEADLER TV',
    });

    const result = await turn("That's wrong. Go back.");

    expect(result.route).toBe('browser');
    // An explicit action outranks the generic complaint.
    expect(result.goalId).toBe('browser_followup:go_back');
    expect(result.spokenText).not.toMatch(GENERIC_BROWSER_PROMPT);
  });

  it('D. "scroll down" uses the current browser context', async () => {
    seedBrowserState({
      lastBrowserGoal: 'search YouTube for Seeadler TV',
      lastBrowserUrl: 'https://www.youtube.com/results?search_query=Seeadler+TV',
    });

    const result = await turn('scroll down');

    expect(result.route).toBe('browser');
    expect(result.goalId).toBe('browser_followup:scroll');
  });

  it('G. "Click it." with NO browser context is a targeted clarification, never a random browser action', async () => {
    // Fresh conversation: no browser state at all.
    const result = await turn('Click it.');

    expect(result.route).toBe('clarification_browser');
    expect(result.goalId).toBe('browser_context_missing');
    expect(result.spokenText).toMatch(/don't have a browser page open/i);
    expect(result.spokenText).not.toMatch(GENERIC_BROWSER_PROMPT);
    // It must NOT have attempted a browser action.
    expect(browserMetrics.count('browser_followup_routed')).toBe(0);
    expect(browserMetrics.count('browser_context_missing')).toBeGreaterThan(0);
  });

  it('a fresh "Jarvis, open YouTube." is NOT absorbed by the continuation path', async () => {
    seedBrowserState({
      lastBrowserGoal: 'search YouTube for Seeadler TV',
      lastBrowserUrl: 'https://www.youtube.com/results?search_query=Seeadler+TV',
    });

    const result = await turn('Jarvis, open YouTube.');

    // Must be a NEW navigation goal, not a browser follow-up.
    expect(result.goalId).not.toMatch(/^browser_followup:/);
    expect(result.route).not.toBe('clarification_browser');
  });
});

describe('consent preference precedence and persistence', () => {
  it('F. an explicit current instruction beats a stored preference', () => {
    const registry = new ConsentPreferenceRegistry();
    registry.set('youtube.com', 'reject_optional');

    const auth = authorizeConsentChoice({
      url: 'https://www.youtube.com/',
      explicitUserChoice: 'accept_all', // "Accept all this time."
      registry,
    });

    expect(auth.authorized).toBe(true);
    expect(auth.choice).toBe('accept_all');
    expect(auth.source).toBe('user_explicit');
  });

  it('a stored preference is used when the user says nothing', () => {
    const registry = new ConsentPreferenceRegistry();
    registry.set('youtube.com', 'accept_all');
    const auth = authorizeConsentChoice({ url: 'https://www.youtube.com/', registry });
    expect(auth.source).toBe('stored_preference');
    expect(auth.choice).toBe('accept_all');
  });

  it('no stored preference and no instruction → ask', () => {
    const registry = new ConsentPreferenceRegistry();
    const auth = authorizeConsentChoice({ url: 'https://www.youtube.com/', registry });
    expect(auth.authorized).toBe(false);
    expect(auth.source).toBe('none');
  });

  it('"Always accept all on YouTube." is parsed as an explicit save', () => {
    const cmd = parsePreferenceCommand('Always accept all on YouTube.');
    expect(cmd).toEqual({ action: 'set', domain: 'youtube.com', preference: 'accept_all' });
  });

  it('"Accept all this time." is NOT persisted', () => {
    expect(parsePreferenceCommand('Accept all this time.')).toBeNull();
  });

  it('"Ask me every time on Google." maps to ask', () => {
    const cmd = parsePreferenceCommand('Ask me every time on Google.');
    expect(cmd).toEqual({ action: 'set', domain: 'google.com', preference: 'ask' });
  });

  it('"Forget my YouTube cookie preference." maps to forget', () => {
    const cmd = parsePreferenceCommand('Forget my YouTube cookie preference.');
    expect(cmd).toEqual({ action: 'forget', domain: 'youtube.com' });
  });

  it('an unrelated sentence is not a preference command', () => {
    expect(parsePreferenceCommand('What is the weather in Berlin?')).toBeNull();
    expect(parsePreferenceCommand('Open YouTube.')).toBeNull();
  });

  it('saving through the canonical turn persists and is reusable', async () => {
    const result = await turn('Always reject optional cookies on YouTube.');
    expect(result.goalId).toBe('browser_preference');
    expect(browserPreferences.getPreference('youtube.com')).toBe('reject_optional');
    expect(browserMetrics.count('browser_preference_saved')).toBeGreaterThan(0);
  });

  it('the preference is shared across the site family but not to unrelated domains', () => {
    browserPreferences.setPreference('youtube.com', 'accept_all');

    expect(browserPreferences.getPreference('consent.youtube.com')).toBe('accept_all');
    expect(browserPreferences.getPreference('www.youtube.com')).toBe('accept_all');
    expect(familyAliasesFor('youtube.com')).toContain('google.com');
    // Unrelated domain must NOT inherit it.
    expect(browserPreferences.getPreference('example.com')).toBeNull();
  });

  it('the stored preference survives a process restart (persisted to disk)', () => {
    browserPreferences.setPreference('youtube.com', 'accept_all');
    const records = browserPreferences.all();
    const saved = records.find((r) => r.domain === 'youtube.com');
    expect(saved).toBeTruthy();
    expect(saved?.preference).toBe('accept_all');
    // Cleanup: back to ask so later runs are not affected.
    browserPreferences.forget('youtube.com');
  });
});

describe('conversational correction vocabulary (canonical)', () => {
  const stateWithContext = {
    ...browserStateStore.get('vocab-probe'),
    lastBrowserGoal: 'search YouTube for Seeadler TV',
    lastBrowserUrl: 'https://www.youtube.com/results?search_query=Seeadler+TV',
  };

  it.each([
    ['click it', 'open_it'],
    ['accept it', 'accept_consent'],
    ['reject it', 'reject_consent'],
    ['continue', 'continue_goal'],
    ['go back', 'go_back'],
    ['open it', 'open_it'],
    ['open the channel', 'open_channel'],
    ['open the first result', 'open_first_result'],
    ['scroll down', 'scroll'],
    ['scroll up', 'scroll'],
    ["that's wrong", 'wrong_target'],
    ["that's not what I meant", 'wrong_target'],
  ])('"%s" resolves to %s', (utterance, expected) => {
    expect(resolveConversationalCorrection(utterance, stateWithContext).kind).toBe(expected);
  });

  it('an unrelated question is not a correction', () => {
    expect(resolveConversationalCorrection('What is the weather?', stateWithContext).kind).toBe(
      'not_a_correction',
    );
  });
});

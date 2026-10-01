/**
 * jarvisCorrectionAndAccount.test.ts — D22 (correction intent) and D24 (credential
 * questions). Both are conversational defects that unit tests must lock down, because
 * both were observed live: a denial produced a generic re-ask, and a credential
 * question produced project statistics.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { applyTurnResultToFocus, getFocus } from '../domains/jarvisNext/turnRouter.js';

const GENERIC = [/i didn'?t catch/i, /couldn'?t make that out/i, /could you say it again/i];
const isGeneric = (t: string) => GENERIC.some((r) => r.test(t || ''));

async function conversation(id: string, seed: (f: any) => void = () => {}) {
  const focus: any = getFocus(id);
  seed(focus);
  return {
    focus,
    async turn(prompt: string, confidence = 1.0) {
      const res = await universalExecutionController.handleUserTurn({
        prompt, conversationId: id, sttConfidence: confidence, rawStt: prompt,
        activeProjectId: focus.activeProjectId, activeProjectName: focus.activeProjectName,
        context: { ...focus },
      });
      applyTurnResultToFocus(focus, res);
      return res;
    },
  };
}

/** A clarification question is ALSO a wrong answer to a correction. */
const CLARIFY_PATTERNS = [/what would you like me to do/i, /do you want me to open the project/i, /which one/i, /i heard /i];
const isClarification = (t: string) => CLARIFY_PATTERNS.some((r) => r.test(t || ''));
const isWrongAnswer = (t: string) => isGeneric(t) || isClarification(t);

describe('D22 — correction / denial intent', () => {
  const unverifiedNav = (f: any) => {
    f.activeProjectName = 'Free Cash';
    f.activeEntityName = 'Free Cash';
    f.lastResolvedEntityName = 'Free Cash';
    f.lastResolvedAction = 'open';
    f.lastExecutionResult = { success: false, verified: false, route: 'navigate', entityName: 'Free Cash', at: Date.now() };
    f.lastFailureReason = 'the interface did not navigate successfully';
    f.lastVerificationState = 'failed';
    f.lastAssistantTurn = "I've opened Free Cash.";
  };
  const verifiedNav = (f: any) => {
    unverifiedNav(f);
    f.lastExecutionResult = { success: true, verified: true, route: 'navigate', entityName: 'Free Cash', at: Date.now() };
    f.lastFailureReason = undefined;
    f.lastVerificationState = 'verified';
  };

  it('"No, you didn\'t." after a FAILED navigation is not answered with a generic re-ask', async () => {
    const c = await conversation('conv-d22-a', unverifiedNav);
    const r = await c.turn("No, you didn't.");
    expect(isWrongAnswer(r.spokenText)).toBe(false);
    expect(`${r.spokenText} ${r.plan?.goalDescription || ''}`).toMatch(/free cash/i);
  });

  it('"You know you did not." (the live failure) resolves as a correction, not a clarification', async () => {
    const c = await conversation('conv-d22-b', unverifiedNav);
    const r = await c.turn('You know you did not.');
    expect(isWrongAnswer(r.spokenText)).toBe(false);
    expect(r.goalId).not.toBe('unrecognized');
  });

  it('other denial forms are recognised', async () => {
    const forms = ["That's wrong.", "It didn't open.", "That's not working.", 'You know that is wrong.'];
    for (const [i, form] of forms.entries()) {
      const c = await conversation(`conv-d22-form-${i}`, unverifiedNav);
      const r = await c.turn(form);
      expect(isWrongAnswer(r.spokenText), `form: ${form} → ${r.spokenText}`).toBe(false);
    }
  }, 40000);

  it('a correction against a VERIFIED result does not argue and offers a retry', async () => {
    const c = await conversation('conv-d22-c', verifiedNav);
    const r = await c.turn("No, you didn't.");
    expect(isWrongAnswer(r.spokenText)).toBe(false);
    expect(r.spokenText).toMatch(/retry|confirmed/i);
  });

  it('a correction with no recorded result never claims success', async () => {
    const c = await conversation('conv-d22-d', (f) => { f.lastResolvedEntityName = 'Free Cash'; });
    const r = await c.turn('That is wrong.');
    expect(isWrongAnswer(r.spokenText)).toBe(false);
    expect(r.spokenText).not.toMatch(/\bI(?:'ve| have) opened\b/i);
  });
});

describe('D24 — credential / account questions', () => {
  const seeded = (f: any) => {
    f.activeProjectId = 'proj-free-cash';
    f.activeProjectName = 'Free Cash';
    f.activeEntityName = 'Free Cash';
    f.lastResolvedEntityName = 'Free Cash';
  };

  it('a credential question is answered about credentials, never with project statistics', async () => {
    const c = await conversation('conv-d24-a', seeded);
    const r = await c.turn('What credentials do you need from me?');
    expect(r.spokenText).not.toMatch(/priority\s*\d|goals|background tasks|project tasks/i);
    expect(r.spokenText).toMatch(/credential|account|api key|login/i);
  });

  it('the live failure utterance is handled', async () => {
    const c = await conversation('conv-d24-b', seeded);
    const r = await c.turn('Okay, what kind of credentials you need from me to log in into the project?');
    expect(r.spokenText).not.toMatch(/priority\s*\d|goals/i);
    expect(r.spokenText).toMatch(/credential|account|login/i);
  });

  it('it states plainly that the exact requirement is unknown rather than inventing one', async () => {
    const c = await conversation('conv-d24-c', seeded);
    const r = await c.turn('Do you need my email or password?');
    expect(r.spokenText).toMatch(/don'?t know the exact credentials|no evidence yet/i);
    expect(isGeneric(r.spokenText)).toBe(false);
  });

  it('account-state questions route to account intent, not project status', async () => {
    for (const [i, q] of ['Why can\'t you log in?', 'Which accounts need my attention?', 'Do you need an API key?'].entries()) {
      const c = await conversation(`conv-d24-q-${i}`, seeded);
      const r = await c.turn(q);
      expect(r.spokenText, `q: ${q}`).not.toMatch(/priority\s*\d|goals/i);
    }
  });
});

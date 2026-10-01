/* eslint-disable @typescript-eslint/no-explicit-any -- tests deliberately poke at
   the structural continuation state (focus fields) which is wider than the
   production result type. */
/**
 * conversationalState.test.ts — Phase 1 (F1–F8) acceptance chains A–I.
 *
 * Every chain runs as CONSECUTIVE TURNS UNDER ONE CONVERSATION ID and persists
 * through `applyTurnResultToFocus` — the same single writer the router uses —
 * so the tested state transitions are the production ones.
 */
import { describe, it, expect } from 'vitest';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { applyTurnResultToFocus, getFocus } from '../domains/jarvisNext/turnRouter.js';

const GENERIC_PATTERNS = [
  /i didn'?t catch/i,
  /could you say it again/i,
  /couldn'?t make that out/i,
  /what would you like me to do/i,
];
const isGeneric = (t: string) => GENERIC_PATTERNS.some((r) => r.test(t || ''));

/** What a turn resolved/said, for assertions that don't care which field carried it. */
const outcome = (r: any) => `${r?.plan?.goalDescription || ''} | ${r?.spokenText || ''} | ${r?.entityName || r?.lastResolvedEntityName || ''}`;

/** Consecutive turns under ONE conversation id, using the production state writer. */
async function conversation(id: string, seed: (focus: any) => void = () => {}) {
  const focus: any = getFocus(id);
  seed(focus);
  return {
    focus,
    async turn(prompt: string, confidence = 1.0) {
      const res = await universalExecutionController.handleUserTurn({
        prompt,
        conversationId: id,
        sttConfidence: confidence,
        rawStt: prompt,
        activeProjectId: focus.activeProjectId,
        activeProjectName: focus.activeProjectName,
        context: { ...focus },
      });
      applyTurnResultToFocus(focus, res); // exactly what the router does
      return res;
    },
  };
}

const failedOperate = (name: string, reason: string) => (f: any) => {
  f.activeProjectName = name;
  f.activeEntityName = name;
  f.activeEntityType = 'project';
  f.lastResolvedEntityName = name;
  f.lastResolvedEntityId = 'proj-test';
  f.lastResolvedAction = 'operate';
  f.lastExecutionResult = { success: false, verified: false, route: 'project_operate', entityName: name, at: Date.now() };
  f.lastFailureReason = reason;
  f.lastFailureAt = Date.now();
  f.lastVerificationState = 'failed';
};

describe('Phase 1 — conversational state (F1–F8)', () => {
  // ── A: a failure is explained, not reset ───────────────────────────────
  it('A: "Why not?" explains the recorded failure instead of resetting to an action question', async () => {
    const c = await conversation('conv-test-A', failedOperate('Shopify', 'there is no runnable task in the project right now'));
    const r = await c.turn('Why not?');
    expect(r.spokenText).toMatch(/no runnable task/i);
    expect(r.spokenText).toMatch(/shopify/i);
    expect(isGeneric(r.spokenText)).toBe(false);
  });

  it('A2: with no recorded reason, say so — never invent one', async () => {
    const c = await conversation('conv-test-A2', (f) => {
      f.lastResolvedEntityName = 'Shopify';
      f.lastResolvedAction = 'operate';
    });
    const r = await c.turn('Why not?');
    expect(r.spokenText).toMatch(/don'?t have a verified reason/i);
    expect(isGeneric(r.spokenText)).toBe(false);
  });

  // ── F2: failure context survives into the next turn ────────────────────
  it('F2: after the failure turn the referent and the reason are still there', async () => {
    const c = await conversation('conv-test-F2', failedOperate('Shopify', 'no runnable task'));
    const why = await c.turn('Why not?');
    expect(why.lastFailureReason).toMatch(/no runnable task/i);
    expect(why.clearPendingClarification).not.toBe(true); // nothing cleared on failure
    expect(c.focus.lastResolvedEntityName).toBe('Shopify');
    expect(c.focus.lastFailureReason).toMatch(/no runnable task/i);
    expect(c.focus.lastVerificationState).toBe('failed');
  });

  it('F2b: the writer clears the failure only on a verified success', () => {
    const f: any = { lastFailureReason: 'old reason', lastFailureAt: 1 };
    applyTurnResultToFocus(f, {
      lastExecutionResult: { success: true, verified: true, route: 'navigate', at: Date.now() },
      clearPendingClarification: true,
    } as any);
    expect(f.lastFailureReason).toBeUndefined();
    expect(f.lastVerificationState).toBe('verified');
  });

  // ── B / F7: choice + read continuations ───────────────────────────────
  it('B: "Check the status." resolves the offered choice against Shopify', async () => {
    const c = await conversation('conv-test-B', (f) => {
      f.activeProjectName = 'Shopify';
      f.lastResolvedEntityName = 'Shopify';
      f.lastResolvedAction = 'open';
      f.pendingClarification = {
        kind: 'target_action', targetName: 'Shopify', targetType: 'project', intendedAction: 'open',
        attempt: 1, askedAt: Date.now(), options: ['open it', 'check its status', 'start working on it'],
        clarificationType: 'choice',
      };
      f.clarificationType = 'choice';
      f.offeredOptions = ['open it', 'check its status', 'start working on it'];
    });
    const r = await c.turn('Check the status.');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/shopify/i);
  });

  // ── C / F4: pronoun and ellipsis keep the entity ──────────────────────
  it('C: "Check its status." means Free Cash — no repeated entity resolution', async () => {
    const c = await conversation('conv-test-C', (f) => {
      f.activeProjectName = 'Free Cash';
      f.lastResolvedEntityName = 'Free Cash';
      f.lastResolvedEntityId = 'proj-free-cash';
      f.lastResolvedAction = 'open';
      f.lastExecutionResult = { success: true, verified: true, route: 'navigate', entityName: 'Free Cash', at: Date.now() };
      f.lastVerificationState = 'verified';
    });
    const r = await c.turn('Check its status.');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/free cash/i);
    expect(r.spokenText).not.toMatch(/which project/i);
  });

  // ── D / F3: "What does it need?" continues the same project ───────────
  it('D: "What does it need?" reads the same Free Cash context', async () => {
    const c = await conversation('conv-test-D', (f) => {
      f.activeProjectName = 'Free Cash';
      f.lastResolvedEntityName = 'Free Cash';
      f.lastResolvedAction = 'operate';
      f.lastExecutionResult = { success: true, verified: true, route: 'project_operate', entityName: 'Free Cash', at: Date.now() };
      f.lastVerificationState = 'verified';
    });
    const r = await c.turn('What does it need?');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/free cash/i);
  });

  // ── E: the action carries forward while the entity changes ────────────
  it('E: "Now TikTok Shop." carries the previous action (open)', async () => {
    const c = await conversation('conv-test-E', (f) => {
      f.lastResolvedEntityName = 'Shopify';
      f.lastResolvedAction = 'open';
      f.lastExecutionResult = { success: true, verified: true, route: 'navigate', entityName: 'Shopify', at: Date.now() };
    });
    const r = await c.turn('Now TikTok Shop.');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/tik\s?tok/i);
  });

  // ── F / G: yes/no vs multi-choice ─────────────────────────────────────
  it('F: "Yes." executes a YES/NO clarification', async () => {
    const c = await conversation('conv-test-F', (f) => {
      f.activeProjectName = 'Free Cash';
      f.lastResolvedEntityName = 'Free Cash';
      f.pendingClarification = {
        kind: 'confirm_open', targetName: 'Free Cash', targetType: 'project', intendedAction: 'open',
        attempt: 1, askedAt: Date.now(), options: ['yes'], clarificationType: 'yes_no',
      };
      f.clarificationType = 'yes_no';
      f.offeredOptions = ['yes'];
    });
    const r = await c.turn('Yes.');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/free cash/i);
  });

  it('G: "Yes." against a MULTI-CHOICE question asks which one instead of guessing', async () => {
    const c = await conversation('conv-test-G', (f) => {
      f.activeProjectName = 'Free Cash';
      f.lastResolvedEntityName = 'Free Cash';
      f.pendingClarification = {
        kind: 'anchor_action', targetName: 'Free Cash', targetType: 'project', intendedAction: 'open',
        attempt: 1, askedAt: Date.now(), options: ['the project', 'the website'], clarificationType: 'choice',
      };
      f.clarificationType = 'choice';
      f.offeredOptions = ['the project', 'the website'];
    });
    const r = await c.turn('Yes.');
    expect(r.spokenText).toBe('Which one — the project or the website?');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(c.focus.clarificationType).toBe('choice'); // still waiting on the choice
  });

  // ── I / F3: retry after a failure ─────────────────────────────────────
  it('I: "Try again." re-dispatches the failed action against the same entity', async () => {
    const c = await conversation('conv-test-I', failedOperate('Shopify', 'no runnable task'));
    const r = await c.turn('Try again.');
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/shopify/i);
  });

  // ── F6: low confidence keeps action + entity ──────────────────────────
  it('F6: low-confidence speech keeps the action and the entity', async () => {
    const c = await conversation('conv-test-F6', (f) => {
      f.activeProjectName = 'Free Cash';
      f.lastResolvedEntityName = 'Free Cash';
    });
    const r = await c.turn('and jump is start the free cash project.', 0.39);
    expect(isGeneric(r.spokenText)).toBe(false);
    expect(outcome(r)).toMatch(/free cash/i);
  });

  // ── F1: one authoritative state, derived not duplicated ───────────────
  it('F1: the writer derives clarificationType and the legacy choice list from the ONE source', () => {
    const f: any = {};
    applyTurnResultToFocus(f, {
      pendingClarification: { kind: 'anchor_action', targetName: 'X', attempt: 1, askedAt: 1, options: ['the project', 'the website'] },
    } as any);
    expect(f.clarificationType).toBe('choice');
    expect(f.offeredOptions).toEqual(['the project', 'the website']);
    expect(f.pendingChoices.map((c: any) => c.label)).toEqual(['the project', 'the website']);
  });

  it('F1b: resolving clears every mirrored field together', () => {
    const f: any = { pendingClarification: { kind: 'x', attempt: 1, askedAt: 1, options: ['a'] }, clarificationType: 'yes_no', offeredOptions: ['a'], pendingChoices: [{ id: '1', label: 'a', intent: 'x', args: {} }] };
    applyTurnResultToFocus(f, { clearPendingClarification: true } as any);
    expect(f.pendingClarification).toBeUndefined();
    expect(f.clarificationType).toBeUndefined();
    expect(f.offeredOptions).toBeUndefined();
    expect(f.pendingChoices).toBeUndefined();
  });
});

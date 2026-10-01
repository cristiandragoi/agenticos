/**
 * jarvisAccountBindingAndMetrics.test.ts — two locked-down lessons:
 *
 *  1. ENTITY BINDING: an account/credential answer may quote ONLY the resolved
 *     entity's own recorded blocker. The live failure was a Shopify-context
 *     question quoting "Missing external FreeCash API keys / credentials".
 *     The store here is deliberately adversarial: it returns a Free Cash blocker
 *     for every filter, so the test can only pass if the handler checks the
 *     project binding itself.
 *
 *  2. HEALTH COUNTERS: the counters Hermes 1 watches must move on the behaviours
 *     they describe (generic re-asks, correction resolution, orphan ACKs,
 *     withheld success claims) — a counter that never moves is a blind spot.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { applyTurnResultToFocus, getFocus } from '../domains/jarvisNext/turnRouter.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { healthSnapshot, resetHealthCounters } from '../domains/jarvisNext/jarvisHealth.js';
import {
  beginNavigation, completeNavigation, _resetTransactions,
} from '../services/navigation/navigationTransactions.js';

const FREECASH_BLOCKER = 'Missing external FreeCash API keys / credentials';

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

describe('D24b — account answers stay bound to the resolved entity', () => {
  const adversarialStore = () => vi.spyOn(backgroundTaskManager, 'listTasks').mockImplementation(
    () => ([{
      taskId: 'bgtask-freecash-1', title: 'Free Cash login', status: 'blocked',
      projectId: 'proj-free-cash', blocker: FREECASH_BLOCKER,
    }] as any),
  );

  beforeEach(() => { resetHealthCounters(); });
  afterEach(() => { vi.restoreAllMocks(); _resetTransactions(); });

  it('a Shopify-scoped credential question never quotes Free Cash\'s blocker', async () => {
    adversarialStore();
    const c = await conversation('conv-bind-shopify', (f) => {
      f.activeProjectId = 'proj-shopify';
      f.activeProjectName = 'Shopify';
      f.lastResolvedEntityId = 'proj-shopify';
      f.lastResolvedEntityName = 'Shopify';
    });
    const r = await c.turn('What credentials do you need from me?');
    expect(r.spokenText).not.toMatch(/freecash|free cash/i);
    expect(r.spokenText).toMatch(/own records|account or access record|won't borrow/i);
    expect(healthSnapshot().counters.credential_intent).toBe(1);
  }, 30000);

  it('a Free Cash-scoped question DOES quote Free Cash\'s own recorded blocker', async () => {
    adversarialStore();
    const c = await conversation('conv-bind-freecash', (f) => {
      f.activeProjectId = 'proj-free-cash';
      f.activeProjectName = 'Free Cash';
      f.lastResolvedEntityId = 'proj-free-cash';
      f.lastResolvedEntityName = 'Free Cash';
    });
    const r = await c.turn('What credentials do you need from me?');
    expect(r.spokenText).toMatch(/free cash/i);
    expect(r.spokenText).toMatch(/credentials/i);
    expect(r.spokenText).not.toMatch(/api key is required\.$/i);
  }, 30000);

  it('with no account binding it says so instead of borrowing', async () => {
    adversarialStore();
    const c = await conversation('conv-bind-none', (f) => {
      f.activeProjectId = undefined;
      f.activeProjectName = undefined;
      f.lastResolvedEntityId = undefined;
      f.lastResolvedEntityName = undefined;
    });
    const r = await c.turn('Do you need my email or password?');
    expect(r.spokenText).not.toMatch(/freecash/i);
    expect(healthSnapshot().counters.blocker_borrow_blocked).toBeGreaterThan(0);
  }, 30000);
});

describe('Jarvis health counters — the numbers Hermes 1 opens regressions from', () => {
  beforeEach(() => { resetHealthCounters(); });
  afterEach(() => { vi.restoreAllMocks(); _resetTransactions(); });

  it('counts turns and generic re-asks, and exposes rates', async () => {
    const c = await conversation('conv-metrics-reask');
    await c.turn('blorp fizz whizz');
    const snap = healthSnapshot();
    expect(snap.counters.turns).toBe(1);
    expect(snap.rates.generic_reask_rate).toBeGreaterThan(0);
    expect(snap.rates.generic_reask_rate).toBeLessThanOrEqual(1);
  }, 30000);

  it('counts correction resolution separately from corrections with no result', async () => {
    const c = await conversation('conv-metrics-correction', (f) => {
      f.lastResolvedEntityName = 'Free Cash';
      f.lastResolvedAction = 'open';
      f.lastExecutionResult = { success: false, verified: false, route: 'navigate', entityName: 'Free Cash', at: Date.now() };
      f.lastVerificationState = 'failed';
    });
    await c.turn("No, you didn't.");
    expect(healthSnapshot().counters.correction_resolved).toBe(1);
    expect(healthSnapshot().counters.correction_no_result ?? 0).toBe(0);
  }, 30000);

  it('counts orphan ACKs and verified navigations from the shared registry', () => {
    const { navId, result } = beginNavigation(
      { targetRoute: '/projects?project=proj-free-cash', entityId: 'proj-free-cash', entityType: 'project', source: 'typed' },
      500,
    );
    const ok = completeNavigation({
      navId, success: true, actualRoute: '/projects?project=proj-free-cash', activeProjectId: 'proj-free-cash',
    });
    expect(ok.verified).toBe(true);
    void result;
    const orphan = completeNavigation({ navId: 'nav-does-not-exist', success: true });
    expect(orphan.accepted).toBe(false);
    expect(orphan.reason).toBe('unknown_or_stale_navId');
    const snap = healthSnapshot();
    expect(snap.counters.navigation_verified).toBe(1);
    expect(snap.counters.navigation_ack_orphan).toBe(1);
    expect(snap.rates.navigation_verified_rate).toBe(1);
  });

  it('classifies guard activity as a note, not a regression', () => {
    // The claim gate firing is correct behaviour and must not look like a defect.
    const { navId } = beginNavigation(
      { targetRoute: '/projects?project=proj-free-cash', entityId: 'proj-free-cash', entityType: 'project', source: 'typed' },
      400,
    );
    completeNavigation({ navId, success: true, actualRoute: '/other', activeProjectId: 'proj-free-cash' });
    const snap = healthSnapshot();
    expect(snap.counters.unverified_success_blocked).toBe(1);
    expect(snap.notes.join(' ')).toMatch(/success claims withheld/i);
    expect(snap.regressions.join(' ')).not.toMatch(/success claims withheld/i);
  });

  it('a wrong mounted project is counted as a failed navigation, not a success', () => {
    const { navId } = beginNavigation(
      { targetRoute: '/projects?project=proj-shopify', entityId: 'proj-shopify', entityType: 'project', source: 'voice' },
      500,
    );
    const out = completeNavigation({
      navId, success: true, actualRoute: '/projects?project=proj-shopify', activeProjectId: 'proj-wrong-project',
    });
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('project_mismatch');
    expect(healthSnapshot().counters.navigation_failed).toBe(1);
  });
});

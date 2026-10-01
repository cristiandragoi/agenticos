/**
 * Phase 1 contract tests for the turn lifecycle's pure stages.
 *
 * These prove the RULES (outcome mapping, change-proof, no pre-existing state as
 * proof, no success wording without VERIFIED). They are NOT evidence that the
 * installed desktop app works — that is the physical acceptance run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const probeState = vi.hoisted(() => ({
  windows: { foreground: 0, windows: [] as any[] },
  texts: new Map<number, string[]>(),
  tabs: { reachable: true, tabs: [] as any[] } as any,
}));

vi.mock('../probes.js', () => ({
  observeWindows: vi.fn(async () => probeState.windows),
  observeWindowText: vi.fn(async (hwnd: number) => ({ found: true, title: '', texts: probeState.texts.get(hwnd) || [] })),
  observeBrowserTabs: vi.fn(async () => probeState.tabs),
  hostOf: (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } },
}));
vi.mock('../../../services/llmGateway.js', () => ({ llmChat: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { rawDb } from '../../../db/index.js';

import { decideOutcome, renderResponse } from '../respond.js';
import { validateGoal, definePostcondition, fallbackGoal } from '../understand.js';
import { verify } from '../verifier.js';
import { claim, recordOutcome, ensureTurnLifecycleTables } from '../store.js';
import type { ExecutionReceipt, TurnGoal, PreExecutionSnapshot, TurnRequest } from '../types.js';

const allowed = { allowed: true, reason: 'ok' };
const receipt = (over: Partial<ExecutionReceipt> = {}): ExecutionReceipt => ({
  executor: 'test', attempted: true, completedWithoutError: true,
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), details: {}, ...over,
});
const launchGoal: TurnGoal = { kind: 'action', summary: 'open notepad', action: { type: 'launch_app', app: 'notepad' }, continuesPrevious: false, understoodBy: 'llm_planner' };
const notepadPlan = { plan: { identity: { requested: 'notepad', displayName: 'Notepad', processNames: ['notepad'] } } };

beforeEach(() => {
  probeState.windows = { foreground: 0, windows: [] };
  probeState.texts = new Map();
  probeState.tabs = { reachable: true, tabs: [] };
});

describe('decideOutcome — exactly one of four outcomes, success only when observed', () => {
  it('BLOCKED when policy denies', () => {
    expect(decideOutcome(launchGoal, { allowed: false, reason: 'no permission' }, undefined, undefined).outcome).toBe('BLOCKED');
  });
  it('a clean executor receipt alone is never VERIFIED', () => {
    const r = decideOutcome(launchGoal, allowed, receipt(), { verifier: 'TurnLifecycleVerifier', satisfied: false, observable: false, reason: 'probe down', evidence: [], checkedAt: '' });
    expect(r.outcome).toBe('EXECUTED_UNVERIFIED');
  });
  it('observable but absent postcondition is FAILED even if the executor says success', () => {
    const r = decideOutcome(launchGoal, allowed, receipt(), { verifier: 'TurnLifecycleVerifier', satisfied: false, observable: true, reason: 'no window', evidence: [], checkedAt: '' });
    expect(r.outcome).toBe('FAILED');
  });
  it('executor error is FAILED', () => {
    expect(decideOutcome(launchGoal, allowed, receipt({ completedWithoutError: false, error: 'not found' }), undefined).outcome).toBe('FAILED');
  });
  it('legacy "other" action with claimed side effect is at most EXECUTED_UNVERIFIED', () => {
    const g: TurnGoal = { ...launchGoal, action: { type: 'other' } };
    expect(decideOutcome(g, allowed, receipt({ handlerClaimedSideEffect: true }), undefined).outcome).toBe('EXECUTED_UNVERIFIED');
  });
  it('success wording only for VERIFIED', () => {
    const unv = renderResponse(launchGoal, 'EXECUTED_UNVERIFIED', 'probe down', receipt());
    const fail = renderResponse(launchGoal, 'FAILED', 'no window', receipt());
    expect(unv).not.toMatch(/^Done/);
    expect(fail).not.toMatch(/^Done/);
    expect(renderResponse(launchGoal, 'VERIFIED', 'new window', receipt())).toMatch(/^Done/);
  });
});

describe('understand — structure only, no phrase rules', () => {
  it('rejects invalid planner output', () => {
    expect(validateGoal({ kind: 'nonsense' })).toBeNull();
  });
  it('downgrades actions missing parameters to "other" (never executed natively)', () => {
    expect(validateGoal({ kind: 'action', action: { type: 'type_text', app: 'notepad' } })!.action!.type).toBe('other');
  });
  it('planner failure never attaches previous context', () => {
    const g = fallbackGoal({ receivedAt: new Date().toISOString() } as any, { receivedAt: new Date().toISOString(), text: 'x' } as any, 'down');
    expect(g.continuesPrevious).toBe(false);
    expect(g.kind).toBe('answer');
  });
  it('postcondition is defined from the goal before execution', () => {
    expect(definePostcondition(launchGoal).kind).toBe('window_of_app_newly_present_or_foregrounded');
  });
});

describe('verifier — pre-existing state is never proof', () => {
  const existing = { hwnd: 11, pid: 1, process: 'notepad', title: 'old.txt - Notepad' };
  const snap: PreExecutionSnapshot = { takenAt: '', windows: [existing], foregroundHwnd: 99, appWindowTexts: [{ hwnd: 11, text: 'AGENTIC-OLD' }] };

  it('already-open app with no change → not satisfied', async () => {
    probeState.windows = { foreground: 99, windows: [existing] };
    const v = await verify(definePostcondition(launchGoal), snap, receipt({ details: notepadPlan }));
    expect(v.satisfied).toBe(false);
    expect(v.observable).toBe(true);
  }, 20000);

  it('a new matching window → satisfied with evidence', async () => {
    probeState.windows = { foreground: 12, windows: [existing, { hwnd: 12, pid: 2, process: 'notepad', title: 'Untitled - Notepad' }] };
    const v = await verify(definePostcondition(launchGoal), snap, receipt({ details: notepadPlan }));
    expect(v.satisfied).toBe(true);
    expect(v.evidence.length).toBeGreaterThan(0);
  });

  it('text that was already present before is not proof', async () => {
    const g: TurnGoal = { ...launchGoal, action: { type: 'type_text', app: 'notepad', text: 'AGENTIC-OLD' } };
    probeState.windows = { foreground: 11, windows: [existing] };
    probeState.texts.set(11, ['AGENTIC-OLD']);
    const v = await verify(definePostcondition(g), snap, receipt({ details: notepadPlan }));
    expect(v.satisfied).toBe(false);
  });

  it('exact new nonce text → satisfied', async () => {
    const g: TurnGoal = { ...launchGoal, action: { type: 'type_text', app: 'notepad', text: 'AGENTIC-NEW123' } };
    probeState.windows = { foreground: 11, windows: [existing] };
    probeState.texts.set(11, ['AGENTIC-OLD AGENTIC-NEW123']);
    const v = await verify(definePostcondition(g), snap, receipt({ details: notepadPlan }));
    expect(v.satisfied).toBe(true);
  });

  it('unreachable URL (browser error page) → not satisfied', async () => {
    const g: TurnGoal = { ...launchGoal, action: { type: 'open_url', url: 'https://agentic-nonce.invalid' } };
    probeState.tabs = { reachable: true, tabs: [{ id: 't1', url: 'chrome-error://chromewebdata/', title: 'agentic-nonce.invalid' }] };
    const v = await verify(definePostcondition(g), { takenAt: '', browserTabs: [] }, receipt());
    expect(v.satisfied).toBe(false);
  }, 20000);
});

describe('claim deduplication contract (Scenarios A-D)', () => {
  beforeEach(() => {
    ensureTurnLifecycleTables();
    rawDb.exec('DELETE FROM turn_lifecycle_events; DELETE FROM turn_lifecycle;');
  });

  const baseReq = (over: Partial<TurnRequest> = {}): TurnRequest => ({
    requestId: 'req-1',
    conversationId: 'conv-test',
    source: 'voice_livekit',
    text: 'Open Notepad.',
    receivedAt: '2026-10-01T12:00:00.000Z',
    buildId: 'test-build',
    ...over,
  });

  it('A: First "Open Notepad" still pending, second identical within 3 sec → duplicate rejected', () => {
    const t0 = new Date('2026-10-01T12:00:00.000Z');
    const first = claim(baseReq({ requestId: 'req-a1', externalTurnId: 'turn-a1', receivedAt: t0.toISOString() }), 'ctx-1');
    expect(first.claimed).toBe(true);

    const t1 = new Date(t0.getTime() + 3000).toISOString();
    const second = claim(baseReq({ requestId: 'req-a2', externalTurnId: 'turn-a2', receivedAt: t1 }), 'ctx-1');
    expect(second.claimed).toBe(false);
    if (!second.claimed) {
      expect(second.duplicateOf).toBe('req-a1');
      expect(second.reason).toBe('identical_utterance_within_window');
    }
  });

  it('B: First "Open Notepad" VERIFIED/SUCCESS terminal, second identical within 3 sec with new externalTurnId → accepted', () => {
    const t0 = new Date('2026-10-01T12:00:00.000Z');
    const first = claim(baseReq({ requestId: 'req-b1', externalTurnId: 'turn-b1', receivedAt: t0.toISOString() }), 'ctx-1');
    expect(first.claimed).toBe(true);

    recordOutcome('req-b1', 'VERIFIED', 'Window observed and verified');

    const t1 = new Date(t0.getTime() + 3000).toISOString();
    const second = claim(baseReq({ requestId: 'req-b2', externalTurnId: 'turn-b2', receivedAt: t1 }), 'ctx-1');
    expect(second.claimed).toBe(true);
  });

  it('C: Same externalTurnId retransmitted after completion → still rejected by transport-turn dedupe', () => {
    const t0 = new Date('2026-10-01T12:00:00.000Z');
    const first = claim(baseReq({ requestId: 'req-c1', externalTurnId: 'turn-c1', receivedAt: t0.toISOString() }), 'ctx-1');
    expect(first.claimed).toBe(true);

    recordOutcome('req-c1', 'VERIFIED', 'Execution completed');

    const t1 = new Date(t0.getTime() + 3000).toISOString();
    const retransmit = claim(baseReq({ requestId: 'req-c2', externalTurnId: 'turn-c1', receivedAt: t1 }), 'ctx-1');
    expect(retransmit.claimed).toBe(false);
    if (!retransmit.claimed) {
      expect(retransmit.duplicateOf).toBe('req-c1');
      expect(retransmit.reason).toBe('same_transport_turn');
    }
  });

  it('D: Different text within 5 sec → accepted', () => {
    const t0 = new Date('2026-10-01T12:00:00.000Z');
    const first = claim(baseReq({ requestId: 'req-d1', text: 'Open Notepad.', receivedAt: t0.toISOString() }), 'ctx-1');
    expect(first.claimed).toBe(true);

    const t1 = new Date(t0.getTime() + 2000).toISOString();
    const second = claim(baseReq({ requestId: 'req-d2', text: 'Open Calculator.', receivedAt: t1 }), 'ctx-1');
    expect(second.claimed).toBe(true);
  });
});


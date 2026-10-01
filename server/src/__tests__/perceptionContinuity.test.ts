/**
 * perceptionContinuity.test.ts — P0 perception orchestration regression suite.
 *
 * Exercises the REAL orchestration under repair:
 *   - `decidePerceptionTurn` / `resolvePerceptionContinuation` / `hasExplicitRuntimeIntent`
 *   - `perceptionFocus` (the single perception state)
 *   - `perceptionOperation` (turn ownership + terminal-state guarantee)
 *   - `turnRouter.routeTurn` (the authoritative early perception layer)
 *
 * Only external OS/GUI/model side effects are mocked: the foreground-screen
 * reader, the camera observer and the introspection handler. No desktop
 * application is opened, and no test manipulates a real window.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const reading = {
  success: true,
  windowTitle: 'Q3 Report - Notepad',
  process: 'notepad',
  hwnd: 4242,
  method: 'uia' as const,
  content: 'The Q3 report has three sections covering revenue, churn and forecasts.',
  spokenText:
    'I can see a notepad window — "Q3 Report - Notepad". The visible content contains: ' +
    'The Q3 report has three sections covering revenue, churn and forecasts.',
  controlCount: 3,
  chromeFilteredCount: 2,
  quality: 'good' as const,
  qualityScore: 0.7,
  visionAttempted: false,
  launchedApplication: false as const,
  performedTaskLookup: false as const,
  emittedRuntimeDiagnostics: false as const,
};

const readForegroundScreenMock = vi.fn(async () => ({ ...reading }));
vi.mock('../services/perception/foregroundScreenReader.js', () => ({
  readForegroundScreen: (...args: unknown[]) => readForegroundScreenMock(...args),
}));

const observeCameraMock = vi.fn(async () => ({
  visionAnswer: "You're holding a smartphone in your hand; its screen shows some text.",
}));
vi.mock('../domains/controlPlane/UniversalPerceptionService.js', () => ({
  universalPerceptionService: {
    observeCamera: (...args: unknown[]) => observeCameraMock(...args),
    analyzeImageWithVisionLLM: vi.fn(async () => null),
  },
}));

const detectSystemIntrospectionMock = vi.fn((text: string) => {
  const t = (text || '').toLowerCase();
  if (/\b(?:agenticos|runtime|backend|hermes|system)\b/.test(t) && /\b(?:status|health|state)\b/.test(t)) {
    return { isIntrospection: true, subject: 'runtime' };
  }
  return { isIntrospection: false, subject: null };
});
const handleSystemIntrospectionMock = vi.fn(async () => ({
  text: 'AgenticOS runtime status: backend healthy, database open, 3 workers online.',
}));
vi.mock('../domains/jarvis/systemIntrospection.js', () => ({
  detectSystemIntrospection: (...a: unknown[]) => detectSystemIntrospectionMock(...(a as [string])),
  handleSystemIntrospection: (...a: unknown[]) => handleSystemIntrospectionMock(...(a as [])),
}));

vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn(async () => ({ reply: 'llm' })) }));

import { routeTurn } from '../domains/jarvisNext/turnRouter.js';
import {
  decidePerceptionTurn,
  hasExplicitRuntimeIntent,
  isStopCommand,
  resolvePerceptionContinuation,
  detectCameraPerceptionIntent,
} from '../domains/jarvis/perception/perceptionIntent.js';
import {
  clearPerception,
  clearAllPerception,
  getActivePerception,
  peekPerception,
  recordPerception,
} from '../domains/jarvis/perception/perceptionFocus.js';
import {
  authorizePreliminaryAck,
  beginOperation,
  cancelConversationOperations,
  completeOperation,
  getLatestOperation,
  mayPerformSideEffect,
  resetOperationRegistry,
} from '../domains/jarvis/perception/perceptionOperation.js';

function turn(prompt: string, conversationId: string, turnId: number) {
  return routeTurn({ prompt, conversationId, turnId, rawStt: prompt });
}

beforeEach(() => {
  clearAllPerception();
  resetOperationRegistry();
  readForegroundScreenMock.mockClear();
  observeCameraMock.mockClear();
  detectSystemIntrospectionMock.mockClear();
  handleSystemIntrospectionMock.mockClear();
});

/* ══════════════════ Sequence A — screen continuity ════════════════════════ */

describe('Sequence A — screen continuity', () => {
  const CID = 'seq-a';

  it('keeps the same perception capability and target across three turns', async () => {
    const r1 = await turn('Read what is currently on my screen.', CID, 1);
    expect(r1.route).toBe('read_foreground_screen');
    expect(r1.text).toContain('Q3 report');

    const r2 = await turn('What does it say?', CID, 2);
    expect(r2.route).toBe('read_foreground_screen');
    expect(r2.text).toContain('Q3 report');

    const r3 = await turn('Read it again.', CID, 3);
    expect(r3.route).toBe('read_foreground_screen');
    expect(r3.text).toContain('Q3 report');

    // Same target every turn: one perception goal, refreshed — not three goals.
    const focus = peekPerception(CID)!;
    expect(focus.capability).toBe('read_foreground_screen');
    expect(focus.originTurnId).toBe(1);
    expect(focus.lastUpdatedTurnId).toBe(3);
    expect(focus.target.type).toBe('visible_text');
    expect(readForegroundScreenMock).toHaveBeenCalledTimes(3);
  });

  it('never answers a screen follow-up with runtime diagnostics, a task lookup, or a generic fallback', async () => {
    const replies = [
      await turn('Read what is currently on my screen.', CID, 1),
      await turn('What does it say?', CID, 2),
      await turn('Read it again.', CID, 3),
    ];
    for (const r of replies) {
      expect(r.text).not.toMatch(/diagnostic|runtime status|heartbeat|incident/i);
      expect(r.text).not.toMatch(/no matching task/i);
      expect(r.text).not.toMatch(/not sure how to help/i);
      expect(r.route).not.toBe('system_introspection');
    }
  });
});

/* ══════════════════ Sequence B — camera continuity ════════════════════════ */

describe('Sequence B — camera continuity', () => {
  const CID = 'seq-b';

  it('grounds the follow-up referent in the observed object', async () => {
    const r1 = await turn('Can you see me?', CID, 1);
    expect(r1.route).toBe('camera_perception');
    expect(r1.text).toContain('smartphone');

    const r2 = await turn('What am I holding?', CID, 2);
    expect(r2.route).toBe('camera_perception');

    const r3 = await turn('Can you read the text?', CID, 3);
    expect(r3.route).toBe('camera_perception');
    expect(r3.text).toContain('smartphone');

    const r4 = await turn('What does it say?', CID, 4);
    expect(r4.route).toBe('camera_perception');

    const focus = peekPerception(CID)!;
    expect(focus.capability).toBe('camera_perception');
    expect(focus.originTurnId).toBe(1);
    expect(focus.lastUpdatedTurnId).toBe(4);
    expect(focus.target.description).toContain('smartphone');
    expect(focus.entities?.length).toBeGreaterThan(0);
    expect(observeCameraMock).toHaveBeenCalledTimes(4);
  });

  it('a screen follow-up after a camera turn stays with the active camera goal', () => {
    recordPerception({
      conversationId: CID,
      turnId: 1,
      capability: 'camera_perception',
      target: { type: 'visible_object', description: 'smartphone in hand' },
    });
    const decision = decidePerceptionTurn({
      prompt: 'Can you read the text?',
      conversationId: CID,
      turnId: 2,
      focus: getActivePerception(CID),
    });
    expect(decision.claimed).toBe(true);
    expect(decision.kind).toBe('continuation');
    expect(decision.capability).toBe('camera_perception');
    expect(decision.target?.description).toContain('smartphone');
  });
});

/* ══════════════════ Sequence C — explicit runtime status ══════════════════ */

describe('Sequence C — explicit runtime status', () => {
  it('routes an explicit runtime question to runtime handling, never to perception', async () => {
    const r = await turn('Show me AgenticOS runtime status.', 'seq-c', 1);
    // An explicit runtime question reaches runtime handling. Which runtime
    // handler answers (early introspection vs the runtime investigation path) is
    // not what this guarantee is about: what matters is that perception does not
    // claim the turn and the user is not given a perception failure.
    expect(['system_introspection', 'investigate']).toContain(String(r.route));
    expect(r.route).not.toBe('read_foreground_screen');
    expect(r.route).not.toBe('camera_perception');
    expect(r.text).not.toMatch(/couldn't reliably read|couldn't get a reliable camera/i);
    expect(hasExplicitRuntimeIntent('Show me AgenticOS runtime status.').explicit).toBe(true);
  });

  it.each([
    'Is Hermes online?',
    'Check the backend health.',
    'What model is Jarvis using?',
    'Are you healthy?',
  ])('%j is explicit runtime intent', (phrase) => {
    expect(hasExplicitRuntimeIntent(phrase).explicit).toBe(true);
  });
});

/* ══════ Sequence D — perception wording must not trigger runtime status ═══ */

describe('Sequence D — perception wording never becomes runtime diagnostics', () => {
  it('"What do you see?" continues the active camera goal', async () => {
    const CID = 'seq-d';
    recordPerception({
      conversationId: CID,
      turnId: 1,
      capability: 'camera_perception',
      target: { type: 'visible_object', description: 'smartphone in hand' },
    });
    const r = await turn('What do you see?', CID, 2);
    expect(r.route).toBe('camera_perception');
    expect(r.route).not.toBe('system_introspection');
    expect(r.text).not.toMatch(/runtime status|diagnostic/i);
  });

  it('"Show me what is on my screen." routes to foreground perception', async () => {
    const r = await turn('Show me what is on my screen.', 'seq-d2', 1);
    expect(r.route).toBe('read_foreground_screen');
    expect(r.text).toContain('Q3 report');
  });

  it.each([
    'What do you see?',
    'Show me what is on the screen.',
    "No, that's wrong.",
    'Read it again.',
    'What am I holding?',
    'Can you read the text?',
  ])('%j is NOT explicit runtime intent', (phrase) => {
    expect(hasExplicitRuntimeIntent(phrase).explicit).toBe(false);
  });
});

/* ══════════════════ Sequence E — stop cancels and invalidates ════════════ */

describe('Sequence E — stop', () => {
  it('cancels the operation, clears perception, and discards the late completion', async () => {
    const CID = 'seq-e';
    const op = beginOperation({ conversationId: CID, turnId: 5, capability: 'read_foreground_screen' });
    recordPerception({
      conversationId: CID,
      turnId: 5,
      capability: 'read_foreground_screen',
      target: { type: 'foreground_window', description: 'Q3 Report - Notepad' },
    });
    expect(getActivePerception(CID)).toBeDefined();

    const stop = await turn('Stop.', CID, 6);
    expect(isStopCommand('Stop.')).toBe(true);
    expect(stop.text).toBe('');
    expect(getActivePerception(CID)).toBeUndefined();
    expect(op.status).toBe('CANCELLED');

    // A late completion from the old operation cannot act, speak or write state.
    const launched = vi.fn();
    const gate = mayPerformSideEffect(op, { currentTurnId: 6 });
    if (gate.ok) launched();
    expect(gate.ok).toBe(false);
    expect(launched).not.toHaveBeenCalled();

    const before = peekPerception(CID);
    completeOperation(op, 'SUCCESS');
    expect(op.status).toBe('CANCELLED'); // terminal-state guarantee: no overwrite
    expect(peekPerception(CID)).toEqual(before);
  });

  it.each(['Cancel', 'Never mind', 'Move on'])('%j is a stop command', (phrase) => {
    expect(isStopCommand(phrase)).toBe(true);
  });

  it('cancelling never leaves an operation non-terminal', () => {
    const op = beginOperation({ conversationId: 'seq-e2', turnId: 1, capability: 'camera_perception' });
    const cancelled = cancelConversationOperations('seq-e2', 'stop_command');
    expect(cancelled.map((c) => c.operationId)).toContain(op.operationId);
    expect(op.status).toBe('CANCELLED');
  });
});

/* ════════ Sequence F — a superseded turn cannot perform a side effect ════ */

describe('Sequence F — supersession before execution', () => {
  it('Turn 10 cannot launch after Turn 11 supersedes it', () => {
    const CID = 'seq-f';
    const turn10 = beginOperation({ conversationId: CID, turnId: 10, capability: 'launch_application' });
    // Turn 11 arrives before Turn 10's executor acts.
    beginOperation({ conversationId: CID, turnId: 11, capability: 'read_foreground_screen' });

    const launch = vi.fn();
    const gate = mayPerformSideEffect(turn10, { currentTurnId: 11 });
    if (gate.ok) launch('chrome');
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('superseded_by_newer_turn');
    expect(launch).not.toHaveBeenCalled();
    expect(turn10.status).toBe('CANCELLED');
  });

  it('the owning turn is still allowed', () => {
    const CID = 'seq-f2';
    const op = beginOperation({ conversationId: CID, turnId: 11, capability: 'launch_application' });
    expect(mayPerformSideEffect(op, { currentTurnId: 11 }).ok).toBe(true);
  });
});

/* ══════════════════ Sequence G — acknowledgement ownership ═══════════════ */

describe('Sequence G — acknowledgement ownership', () => {
  it('no acknowledgement when routing produced no operation', () => {
    const d = authorizePreliminaryAck({ conversationId: 'seq-g-none', turnId: 1 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('no_accepted_operation');
  });

  it('an accepted perception operation authorises the ack for its own turn only', () => {
    const CID = 'seq-g-ok';
    const op = beginOperation({ conversationId: CID, turnId: 7, capability: 'read_foreground_screen' });
    const d = authorizePreliminaryAck({ conversationId: CID, turnId: 7 });
    expect(d.allowed).toBe(true);
    expect(d.operationId).toBe(op.operationId);
    // A different turn cannot borrow the operation's ack.
    expect(authorizePreliminaryAck({ conversationId: CID, turnId: 8 }).allowed).toBe(false);
  });

  it('an operation cancelled before the ack fires produces no ack', () => {
    const CID = 'seq-g-cancel';
    const op = beginOperation({ conversationId: CID, turnId: 3, capability: 'camera_perception' });
    cancelConversationOperations(CID, 'stop_command');
    expect(authorizePreliminaryAck({ conversationId: CID, turnId: 3 }).allowed).toBe(false);
    expect(op.status).toBe('CANCELLED');
    expect(getLatestOperation(CID)?.status).toBe('CANCELLED');
  });
});

/* ══════════════════ Terminal-state + failure wording ════════════════════ */

describe('terminal-state guarantee and failure wording', () => {
  it('a failed screen read still terminates with a perception-specific message', async () => {
    readForegroundScreenMock.mockResolvedValueOnce({
      ...reading,
      success: false,
      content: '',
      reason: 'unreliable_content',
      spokenText: "I can identify the foreground window, but I couldn't reliably read its contents.",
    } as typeof reading);
    const r = await turn('Read what is on my screen.', 'seq-fail', 1);
    expect(r.route).toBe('read_foreground_screen');
    expect(r.text).toMatch(/couldn't reliably read its contents/i);
    expect(r.text).not.toMatch(/not sure how to help|runtime status|no matching task/i);
    expect(getLatestOperation('seq-fail')?.status).toBe('FAILED');
  });

  it('a camera failure terminates with the camera message and never a runtime dump', async () => {
    observeCameraMock.mockResolvedValueOnce({} as never);
    const r = await turn('Can you see me?', 'seq-cam-fail', 1);
    expect(r.route).toBe('camera_perception');
    expect(r.text).toMatch(/couldn't get a reliable camera frame/i);
    expect(r.text).not.toMatch(/runtime status|diagnostic|no matching task/i);
    expect(getLatestOperation('seq-cam-fail')?.status).toBe('FAILED');
  });

  it('every dispatched operation ends terminal', async () => {
    await turn('Read what is on my screen.', 'seq-term-1', 1);
    await turn('Can you see me?', 'seq-term-2', 1);
    readForegroundScreenMock.mockResolvedValueOnce({ ...reading, success: false, spokenText: 'nope' } as typeof reading);
    await turn('Read the screen.', 'seq-term-3', 1);
    for (const cid of ['seq-term-1', 'seq-term-2', 'seq-term-3']) {
      const op = getLatestOperation(cid)!;
      expect(['SUCCESS', 'FAILED', 'CANCELLED']).toContain(op.status);
    }
  });
});

/* ══════════════════ focus/continuation unit contracts ═══════════════════ */

describe('perception focus contracts', () => {
  it('an expired focus cannot resolve a referent', () => {
    recordPerception({
      conversationId: 'ttl',
      turnId: 1,
      capability: 'camera_perception',
      target: { type: 'camera_frame' },
      now: 1_000,
      ttlMs: 5_000,
    });
    expect(getActivePerception('ttl', 2_000)).toBeDefined();
    expect(getActivePerception('ttl', 10_000)).toBeUndefined();
    expect(peekPerception('ttl')).toBeUndefined();
  });

  it('a cleared focus refuses a continuation (stop invalidates the referent)', () => {
    recordPerception({
      conversationId: 'clr',
      turnId: 1,
      capability: 'read_foreground_screen',
      target: { type: 'foreground_window' },
    });
    clearPerception('clr', 'stop_command');
    expect(resolvePerceptionContinuation('Read it again.', getActivePerception('clr')).isContinuation).toBe(false);
  });

  it('camera vocabulary does not claim an explicit screen read', () => {
    expect(detectCameraPerceptionIntent('Read what is on my screen.').isCameraPerception).toBe(false);
    expect(detectCameraPerceptionIntent('Can you see me?').isCameraPerception).toBe(true);
    expect(detectCameraPerceptionIntent('What am I holding?').isCameraPerception).toBe(true);
  });

  it('a bare "read" with no perception context is not a continuation', () => {
    expect(resolvePerceptionContinuation('Read.', undefined).isContinuation).toBe(false);
  });
});

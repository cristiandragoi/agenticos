/**
 * turnOwnershipEnforcement.test.ts — P0 production enforcement of turn ownership.
 *
 * These tests enter the REAL executor paths (`desktopExecutor.openApplication`,
 * `terminalExecutor.runCommand`) and the REAL router, with the side effect mocked
 * only at the FINAL OS boundary (`node:child_process`). Nothing is launched, no
 * window is touched: the spawn/exec boundary is counted and asserted to receive
 * zero calls for stale work and exactly one call for the owning turn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ── the final OS boundary: counted, never executed ─────────────────────── */

const spawnCalls: string[] = [];
const execCalls: string[] = [];

interface FakeEmitter {
  on(ev: string, cb: (...args: unknown[]) => void): FakeEmitter;
  once(ev: string, cb: (...args: unknown[]) => void): FakeEmitter;
  emit(ev: string, ...args: unknown[]): boolean;
  removeListener: () => FakeEmitter;
}

interface FakeChild {
  pid: number;
  stdout: FakeEmitter;
  stderr: FakeEmitter;
  stdin: FakeEmitter;
  on: FakeEmitter['on'];
  once: FakeEmitter['once'];
  emit: FakeEmitter['emit'];
  unref: () => void;
  kill: () => void;
}

function fakeEmitter(): FakeEmitter {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const emitter: FakeEmitter = {
    on(ev, cb) {
      (handlers[ev] = handlers[ev] || []).push(cb);
      return emitter;
    },
    once(ev, cb) {
      return emitter.on(ev, cb);
    },
    emit(ev, ...args) {
      for (const cb of handlers[ev] || []) cb(...args);
      return true;
    },
    removeListener: () => emitter,
  };
  return emitter;
}

function fakeChild(): FakeChild {
  const emitter = fakeEmitter();
  const child: FakeChild = {
    pid: 4242,
    stdout: emitter,
    stderr: emitter,
    stdin: emitter,
    on: emitter.on,
    once: emitter.once,
    emit: emitter.emit,
    unref: () => {},
    kill: () => {},
  };
  // Resolve like a fast, successful process so callers that await exit proceed.
  setImmediate(() => {
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
  });
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, ...rest: unknown[]) => {
    spawnCalls.push([String(cmd), ...(rest as string[][])].flat().map(String).join(' '));
    return fakeChild();
  }),
  exec: vi.fn((cmd: string, _o: unknown, cb?: unknown) => {
    execCalls.push(String(cmd));
    const callback = (typeof _o === 'function' ? _o : cb) as ((e: null, out: string, err: string) => void) | undefined;
    callback?.(null, '', '');
    return fakeChild();
  }),
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => '{"Path":null}'),
  spawnSync: vi.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));
vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string) => {
    spawnCalls.push(String(cmd));
    return fakeChild();
  }),
  exec: vi.fn((cmd: string, _o: unknown, cb?: unknown) => {
    execCalls.push(String(cmd));
    const callback = (typeof _o === 'function' ? _o : cb) as ((e: null, out: string, err: string) => void) | undefined;
    callback?.(null, '', '');
    return fakeChild();
  }),
  execFileSync: vi.fn(() => '{"Path":null}'),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/* ── perception boundary mocked (no PowerShell / no camera) ─────────────── */

let duringRead: (() => void) | undefined;
let readingSucceeds = true;
vi.mock('../services/perception/foregroundScreenReader.js', () => ({
  readForegroundScreen: vi.fn(async () => {
    // Lets a test supersede this turn WHILE the read is in flight.
    duringRead?.();
    return readingSucceeds
      ? {
          success: true, windowTitle: 'Q3 Report - Notepad', process: 'notepad', hwnd: 4242,
          method: 'uia', content: 'The Q3 report has three sections.', spokenText: 'I can see a notepad window. The visible content contains: The Q3 report has three sections.',
          controlCount: 3, chromeFilteredCount: 2, quality: 'good', qualityScore: 0.7,
          visionAttempted: false, launchedApplication: false, performedTaskLookup: false, emittedRuntimeDiagnostics: false,
        }
      : {
          success: false, windowTitle: 'Notepad', process: 'notepad', hwnd: 4242, method: 'none',
          content: '', spokenText: "I can identify the foreground window, but I couldn't reliably read its contents.",
          controlCount: 0, chromeFilteredCount: 0, quality: 'empty', qualityScore: 0, visionAttempted: false,
          reason: 'unreliable_content',
          launchedApplication: false, performedTaskLookup: false, emittedRuntimeDiagnostics: false,
        };
  }),
}));

let duringCamera: (() => void) | undefined;
vi.mock('../domains/controlPlane/UniversalPerceptionService.js', () => ({
  universalPerceptionService: {
    observeCamera: vi.fn(async () => {
      // Lets a test supersede this turn WHILE the camera read is in flight.
      duringCamera?.();
      return { visionAnswer: 'A smartphone is in your hand.' };
    }),
    analyzeImageWithVisionLLM: vi.fn(async () => null),
  },
}));
vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn(async () => ({ reply: 'llm' })) }));

/* ── production modules under test ──────────────────────────────────────── */

import { desktopExecutor } from '../domains/jarvis/execution/executors/desktopExecutor.js';
import { terminalExecutor } from '../domains/jarvis/execution/executors/terminalExecutor.js';
import { runWithTurnOwnership } from '../domains/jarvis/perception/turnOwnership.js';
import {
  beginOperation,
  cancelConversationOperations,
  getOperation,
  guardResultPublication,
  noteConversationTurn,
  resetOperationRegistry,
} from '../domains/jarvis/perception/perceptionOperation.js';
import {
  clearAllPerception,
  peekPerception,
  recordPerception,
} from '../domains/jarvis/perception/perceptionFocus.js';
import { routeTurn } from '../domains/jarvisNext/turnRouter.js';

function clearBoundaryCalls(): void {
  spawnCalls.length = 0;
  execCalls.length = 0;
}

beforeEach(() => {
  clearBoundaryCalls();
  clearAllPerception();
  resetOperationRegistry();
  duringRead = undefined;
  duringCamera = undefined;
  readingSucceeds = true;
});

/* ════════ Stale / superseded turns cannot physically launch anything ══════ */

describe('superseded turn reaches the REAL executor and is rejected', () => {
  it('Turn 10 cannot launch after Turn 11 superseded it (zero spawn calls)', async () => {
    const CID = 'own-supersede';
    const turn10 = beginOperation({ conversationId: CID, turnId: 10, capability: 'desktop_launch' });

    // Turn 11 arrives through the REAL router, which registers the active turn.
    const r11 = await routeTurn({
      prompt: 'Read what is currently on my screen.',
      conversationId: CID, turnId: 11, rawStt: 'Read what is currently on my screen.',
    });
    expect(r11.route).toBe('read_foreground_screen');
    expect(getOperation(turn10.operationId)?.status).toBe('CANCELLED');

    clearBoundaryCalls();

    // Turn 10's executor finally runs — the real production method.
    const res = await runWithTurnOwnership(
      { conversationId: CID, turnId: 10, operationId: turn10.operationId, capability: 'desktop_launch' },
      () => desktopExecutor.openApplication('Notepad'),
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/rejected/);
    expect(spawnCalls).toHaveLength(0);
    expect(execCalls).toHaveLength(0);
    expect(getOperation(turn10.operationId)?.status).toBe('CANCELLED');
  });

  it('a superseded turn cannot reach the terminal/PowerShell boundary either', async () => {
    const CID = 'own-terminal';
    beginOperation({ conversationId: CID, turnId: 3, capability: 'terminal' });
    noteConversationTurn(CID, 4);
    clearBoundaryCalls();

    const res = await runWithTurnOwnership(
      { conversationId: CID, turnId: 3, capability: 'terminal' },
      () => terminalExecutor.runCommand({ command: 'Start-Process notepad.exe', cwd: 'D:/AgenticOS' }),
    );

    expect(res.stderr).toMatch(/rejected/);
    expect(res.exitCode).toBeNull();
    expect(spawnCalls).toHaveLength(0);
  });
});

/* ════════ The owning turn is NOT disabled (no global lockdown) ══════════ */

describe('the currently owning turn still acts', () => {
  it('an explicitly requested launch from the owning turn reaches the boundary exactly once', async () => {
    const CID = 'own-current';
    const op = beginOperation({ conversationId: CID, turnId: 5, capability: 'desktop_launch' });
    noteConversationTurn(CID, 5);
    clearBoundaryCalls();

    const res = await runWithTurnOwnership(
      { conversationId: CID, turnId: 5, operationId: op.operationId, capability: 'desktop_launch' },
      () => desktopExecutor.openApplication('Notepad'),
    );

    expect(String(res.error ?? '')).not.toMatch(/rejected/);
    const launchCalls = spawnCalls.filter((c) => /notepad/i.test(c));
    expect(launchCalls.length).toBe(1);
  });

  it('an owning-turn terminal command reaches the boundary exactly once', async () => {
    const CID = 'own-current-term';
    beginOperation({ conversationId: CID, turnId: 9, capability: 'terminal' });
    noteConversationTurn(CID, 9);
    clearBoundaryCalls();

    const res = await runWithTurnOwnership(
      { conversationId: CID, turnId: 9, capability: 'terminal' },
      () => terminalExecutor.runCommand({ command: 'echo hello', cwd: 'D:/AgenticOS' }),
    );

    expect(res.stderr).not.toMatch(/rejected/);
    expect(spawnCalls.length).toBe(1);
  });
});

/* ════════════════════════════ Stop semantics ════════════════════════════ */

describe('Stop cancels in-flight work before any GUI side effect', () => {
  it('a late executor continuation after Stop is rejected at the boundary', async () => {
    const CID = 'own-stop-router';
    const op = beginOperation({ conversationId: CID, turnId: 5, capability: 'desktop_launch' });
    recordPerception({
      conversationId: CID, turnId: 5, capability: 'read_foreground_screen',
      target: { type: 'foreground_window', description: 'Q3 Report - Notepad' },
    });

    // Real router stop path.
    const stop = await routeTurn({ prompt: 'Stop.', conversationId: CID, turnId: 6, rawStt: 'Stop.' });
    // The router's exact stop wording is existing behaviour (it reports what it
    // stopped); what matters here is that no stale PERCEPTION result is published.
    expect(stop.text).not.toMatch(/I can see|couldn't|not sure how to help|runtime status/i);
    expect(getOperation(op.operationId)?.status).toBe('CANCELLED');
    expect(peekPerception(CID)).toBeUndefined();

    clearBoundaryCalls();
    const res = await runWithTurnOwnership(
      { conversationId: CID, turnId: 5, operationId: op.operationId, capability: 'desktop_launch' },
      () => desktopExecutor.openApplication('Calculator'),
    );

    expect(String(res.error)).toMatch(/rejected/);
    expect(spawnCalls).toHaveLength(0);
    expect(execCalls).toHaveLength(0);
  });

  it('cancelConversationOperations stops a late launch without the router', async () => {
    const CID = 'own-stop-direct';
    beginOperation({ conversationId: CID, turnId: 7, capability: 'desktop_launch' });
    cancelConversationOperations(CID, 'stop_command');
    clearBoundaryCalls();

    const res = await runWithTurnOwnership(
      { conversationId: CID, turnId: 7, capability: 'desktop_launch' },
      () => desktopExecutor.openApplication('Calculator'),
    );

    expect(String(res.error)).toMatch(/rejected/);
    expect(spawnCalls).toHaveLength(0);
  });
});

/* ═══════════════════ Late async result must not be published ════════════ */

describe('late result publication is refused', () => {
  it('a read that completes after supersession neither speaks nor mutates focus', async () => {
    const CID = 'own-late-router';
    // While the screen read is in flight, a newer turn takes over.
    duringRead = () => noteConversationTurn(CID, 99);

    const r = await routeTurn({
      prompt: 'Read what is currently on my screen.',
      conversationId: CID, turnId: 5, rawStt: 'Read what is currently on my screen.',
    });

    // Nothing is spoken and no perception context was written.
    expect(r.text).toBe('');
    expect(peekPerception(CID)).toBeUndefined();
  });

  it('a camera read that completes after supersession neither speaks nor mutates focus', async () => {
    const CID = 'own-late-camera';
    duringCamera = () => noteConversationTurn(CID, 99);

    const r = await routeTurn({
      prompt: 'Can you see me?', conversationId: CID, turnId: 5, rawStt: 'Can you see me?',
    });

    expect(r.text).toBe('');
    expect(peekPerception(CID)).toBeUndefined();
  });

  it('guardResultPublication refuses a stale completion and leaves focus untouched', () => {
    const CID = 'own-late-module';
    const op = beginOperation({ conversationId: CID, turnId: 10, capability: 'read_foreground_screen' });
    recordPerception({
      conversationId: CID, turnId: 10, capability: 'read_foreground_screen',
      target: { type: 'foreground_window', description: 'original' },
    });
    noteConversationTurn(CID, 11);

    const spoken: string[] = [];
    const gate = guardResultPublication({
      conversationId: CID, turnId: 10, capability: 'read_foreground_screen', operationId: op.operationId,
    });
    if (gate.ok) {
      spoken.push('late result');
      recordPerception({
        conversationId: CID, turnId: 10, capability: 'read_foreground_screen',
        target: { type: 'visible_text', description: 'replaced-by-stale-turn' },
      });
    }

    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/publication_/);
    expect(spoken).toHaveLength(0);
    expect(peekPerception(CID)?.target.description).toBe('original');
    expect(getOperation(op.operationId)?.status).toBe('CANCELLED');
  });

  it('a failed screen read still terminates through the gate for the owning turn', async () => {
    readingSucceeds = false;
    const CID = 'own-fail';
    const r = await routeTurn({
      prompt: 'Read what is on my screen.', conversationId: CID, turnId: 1, rawStt: 'Read what is on my screen.',
    });
    expect(r.route).toBe('read_foreground_screen');
    expect(r.text).toMatch(/couldn't reliably read its contents/i);
    expect(r.text).not.toMatch(/no matching task|runtime status/i);
  });
});

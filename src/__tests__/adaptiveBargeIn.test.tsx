import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';
import { classifyInterruption } from '../lib/adaptiveBargeIn';

/**
 * adaptiveBargeIn.test.tsx — Phase 15 (Failure E): ChatGPT-style adaptive
 * barge-in.
 *
 * Contract: SPEAKING → DUCKED_LISTENING (gain ramp, turn preserved) →
 * classify (ack → resume same response / hard_control → full kill / takeover
 * → kill + new turn / noise → resume). No second LLM request for an ack.
 */

let rmsLevel = 0;
let autoFireOnPlay = true;
let autoFireOnEnd = true;
let lastAudio: any = null;
let transcribeText = '';
let rafQueue: Array<(t: number) => void> = [];
let rafIdCounter = 0;
let recorderChunkSize = 600;

function flushRaf(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const current = rafQueue; rafQueue = [];
    current.forEach((cb) => cb(performance.now()));
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state = 'inactive'; ondataavailable: any = null; onstop: any = null; stream: unknown;
  constructor(stream: unknown) { this.stream = stream; MockMediaRecorder.instances.push(this); }
  start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob([new Uint8Array(recorderChunkSize).fill(1)], { type: 'audio/webm' }) }); }
  stop() { if (this.state !== 'recording') return; this.state = 'inactive'; this.onstop?.(); }
}

class MockAudio {
  src = ''; paused = true; volume = 1;
  onplay: any = null; onended: any = null; onerror: any = null; duration = 1;
  pause = vi.fn(function (this: MockAudio) { this.paused = true; });
  removeAttribute = vi.fn((a: string) => { if (a === 'src') this.src = ''; });
  load = vi.fn();
  play = vi.fn(function (this: MockAudio) {
    const self = this; self.paused = false;
    if (autoFireOnPlay && self.src) Promise.resolve().then(() => self.onplay?.());
    if (autoFireOnEnd && self.src) Promise.resolve().then(() => Promise.resolve().then(() => self.onended?.()));
    return Promise.resolve();
  });
  constructor() { lastAudio = this; }
}

const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) return { ok: true, json: async () => ({ text: transcribeText }) };
  if (url.includes('/voice/tts')) return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
  return { ok: true, json: async () => ({}) };
});
const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = []; rafIdCounter = 0; rmsLevel = 0; recorderChunkSize = 600;
  autoFireOnPlay = true; autoFireOnEnd = true; lastAudio = null;
  transcribeText = 'hello jarvis';
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { rafQueue.push(cb); return ++rafIdCounter; };
  // cancelAnimationFrame is a getter-only global in this environment — direct
  // assignment silently fails, so use stubGlobal (same as the passing suite).
  vi.stubGlobal('cancelAnimationFrame', () => {});
  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = fetchMock;
  fetchMock.mockClear(); trackStopMock.mockClear(); getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: trackStopMock }], getAudioTracks: () => [{ enabled: true }] });
  Object.defineProperty(navigator, 'mediaDevices', { writable: true, configurable: true, value: { getUserMedia: getUserMediaMock } });
  (globalThis as any).AudioContext = class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, getByteTimeDomainData(d: Uint8Array) { const v = Math.min(255, Math.max(0, Math.round(128 + rmsLevel * 128))); d.fill(v); }, connect: vi.fn() }; }
    createMediaElementSource() { return { connect: vi.fn() }; }
    destination = {};
    close() { return Promise.resolve(); }
  };
  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
  (globalThis as any).SpeechSynthesisUtterance = class { text: string; onstart: any = null; onend: any = null; onerror: any = null; constructor(t: string) { this.text = t; } };
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const FAST_VAD = { agentId: 'agent-jarvis', speechThreshold: 0.02, minSpeechMs: 0, endSpeechSilenceMs: 5, maxSegmentMs: 4000, bargeInGraceMs: 0 };

async function speakOneTurn(result: { current: ReturnType<typeof useVoiceIO> }) {
  rmsLevel = 0.1; await act(async () => { flushRaf(1); });
  rmsLevel = 0; await act(async () => { flushRaf(1); });
  await act(async () => { vi.advanceTimersByTime(20); });
  await act(async () => { flushRaf(1); });
}

/** Drive a ducked interruption to its classification transcript. */
async function duckAndClassify(result: { current: ReturnType<typeof useVoiceIO> }, text: string) {
  transcribeText = text;
  rmsLevel = 0.3;
  await act(async () => { vi.advanceTimersByTime(15); flushRaf(1); });
  expect(result.current.voiceState).toBe('ducked');
  rmsLevel = 0;
  await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
  await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
  await act(async () => { vi.advanceTimersByTime(20); }); // onstop → transcribe
  await act(async () => {
    await Promise.resolve(); await Promise.resolve();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

describe('classifyInterruption (pure classifier)', () => {
  it('acknowledgements classify as acknowledgement', () => {
    for (const ack of ['yes', 'okay', 'right', 'sure', 'mhm', 'ok', 'no', 'yeah']) {
      expect(classifyInterruption(ack, 300)).toBe('acknowledgement');
    }
  });
  it('hard control wins over everything', () => {
    expect(classifyInterruption('stop', 300)).toBe('hard_control');
    expect(classifyInterruption('Jarvis stop', 500)).toBe('hard_control');
    expect(classifyInterruption('cancel that', 400)).toBe('hard_control');
  });
  it('sustained real content is a takeover', () => {
    expect(classifyInterruption('Actually, tell me only what Hermes does', 2500)).toBe('takeover');
    expect(classifyInterruption('What is the current task', 2000)).toBe('takeover');
  });
  it('noise (empty) is noise', () => {
    expect(classifyInterruption('', 100)).toBe('noise');
    expect(classifyInterruption('   ', 100)).toBe('noise');
  });
  it('short ambiguous fragment below 700ms is noise (do not destroy the answer)', () => {
    expect(classifyInterruption('act', 400)).toBe('noise');
  });
});

describe('adaptive barge-in runtime (duck → classify → resume/kill/takeover)', () => {
  it('A: acknowledgement during speech ducks then RESUMES the SAME response — no second LLM request', async () => {
    const onAutoSubmit = vi.fn();
    const onBargeIn = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onBargeIn }));
    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);

    // Jarvis speaks a long answer.
    autoFireOnEnd = false;
    let speakP: Promise<void> = Promise.resolve();
    await act(async () => { speakP = result.current.speak('A long answer that keeps going').catch(() => {}); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.voiceState).toBe('speaking');
    const submitsBefore = onAutoSubmit.mock.calls.length;

    // User says "okay" — duck then classify as acknowledgement.
    await duckAndClassify(result, 'okay');

    expect(onAutoSubmit.mock.calls.length).toBe(submitsBefore); // NO new LLM request
    expect(onBargeIn).not.toHaveBeenCalled(); // no full kill
    expect(result.current.voiceState).not.toBe('ducked'); // restored
    expect(result.current.voiceState).toBe('listening'); // mic re-armed for next turn

    await act(async () => { lastAudio?.onended?.(); await speakP.catch(() => {}); });
  });

  it('B: hard stop ("Jarvis stop") during speech kills — queue cleared, no resume, no LLM', async () => {
    const onAutoSubmit = vi.fn();
    const onBargeIn = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onBargeIn, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);

    autoFireOnEnd = false;
    let speakP: Promise<void> = Promise.resolve();
    await act(async () => { speakP = result.current.speak('long answer text that will be stopped').catch(() => {}); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.voiceState).toBe('speaking');
    const submitsBefore = onAutoSubmit.mock.calls.length;

    // Hard control barge-in.
    await duckAndClassify(result, 'Jarvis stop');

    expect(onControlCommand).toHaveBeenCalled();
    expect(onBargeIn).toHaveBeenCalled(); // full kill fired
    expect(onAutoSubmit.mock.calls.length).toBe(submitsBefore); // no LLM
    expect(result.current.voiceState).toBe('listening'); // returns to listening

    await act(async () => { lastAudio?.onended?.(); await speakP.catch(() => {}); });
  });

  it('C: takeover — a substantive new request kills the old turn and submits once', async () => {
    const onAutoSubmit = vi.fn();
    const onBargeIn = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onBargeIn }));
    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);

    autoFireOnEnd = false;
    let speakP: Promise<void> = Promise.resolve();
    await act(async () => { speakP = result.current.speak('old answer about something').catch(() => {}); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.voiceState).toBe('speaking');
    const submitsBefore = onAutoSubmit.mock.calls.length;

    // Takeover: the user sustains a real new request while Jarvis speaks.
    // Sustained speech beyond the takeover threshold escalates immediately
    // (VAD branch: duckedRef → BARGE_TAKEOVER_MS → performBargeIn), then the
    // STT transcript lands as a new turn.
    transcribeText = 'Actually tell me what Hermes does';
    rmsLevel = 0.3;
    // The duck tick resets the accumulator, so sustained time is measured
    // from the SECOND tick onward: 4 × 700ms = 2800ms > BARGE_TAKEOVER_MS.
    await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); });
    expect(result.current.voiceState).toBe('ducked');
    await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // acc start
    await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // 700ms
    await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // 1400ms
    await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // 2100ms → escalate

    // Escalation fired: old turn killed, playback halted, onBargeIn fired.
    expect(onBargeIn).toHaveBeenCalled();

    // Now the user stops talking — the recorded takeover transcript resolves
    // and is submitted exactly once as the new turn.
    rmsLevel = 0;
    await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
    await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
    await act(async () => { vi.advanceTimersByTime(20); });
    await act(async () => {
      await Promise.resolve(); await Promise.resolve();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(onAutoSubmit.mock.calls.length).toBe(submitsBefore + 1); // new turn submitted exactly once
    expect(onAutoSubmit).toHaveBeenLastCalledWith(expect.stringContaining('Hermes'));

    await act(async () => { lastAudio?.onended?.(); await speakP.catch(() => {}); });
  });
});

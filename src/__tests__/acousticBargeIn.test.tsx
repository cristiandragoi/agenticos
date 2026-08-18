import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * acousticBargeIn.test.tsx — Phase 3: acoustic interruption is independent of
 * STT and semantic intent.
 *
 * The key regression this guards: during progressive-TTS inter-chunk gaps the
 * user's speech opens a turn (turnActiveRef=true) before the next chunk plays;
 * the acoustic barge-in must STILL halt audio immediately rather than waiting
 * for the turn's STT final (the ~5s bug).
 */

let rmsLevel = 0;
let autoFireOnPlay = true;
let autoFireOnEnd = true;
let lastAudio: any = null;
let transcribeText = '';

class MockAudio {
  src: string = '';
  paused = true;
  onplay: any = null;
  onended: any = null;
  onerror: any = null;
  duration = 1;
  pause = vi.fn(function (this: MockAudio) { this.paused = true; });
  play = vi.fn(function (this: MockAudio) {
    const self = this;
    self.paused = false;
    if (autoFireOnPlay && self.src) Promise.resolve().then(() => self.onplay?.());
    if (autoFireOnEnd && self.src) Promise.resolve().then(() => self.onended?.());
    return Promise.resolve();
  });
  removeAttribute = vi.fn();
  load = vi.fn();
}

class MockAnalyser {
  frequencyBinCount = 128;
  getByteTimeDomainData = vi.fn((arr: Uint8Array) => {
    // Synthesize RMS ≈ rmsLevel: fill with a sine-ish amplitude.
    for (let i = 0; i < arr.length; i++) {
      const v = 128 + Math.round(128 * rmsLevel * Math.sin(i / 4));
      arr[i] = v & 0xff;
    }
  });
}

class MockAudioContext {
  state = 'running';
  createMediaStreamSource = () => ({ connect: () => {} });
  createMediaElementSource = () => ({ connect: () => {} });
  createAnalyser = () => new MockAnalyser();
  destination = {};
  close = () => Promise.resolve();
}

class MockMediaRecorder {
  state = 'inactive';
  ondataavailable: any = null;
  onstop: any = null;
  mimeType = 'audio/webm';
  stream: any;
  constructor(stream: any) { this.stream = stream; }
  start = vi.fn(function (this: MockMediaRecorder) { this.state = 'recording'; });
  stop = vi.fn(function (this: MockMediaRecorder) {
    this.state = 'inactive';
    // Emit a small payload so transcription runs.
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x'.repeat(600)]) });
    if (this.onstop) setTimeout(() => this.onstop(), 0);
  });
}

const rafQueue: FrameRequestCallback[] = [];
function flushRaf(n: number) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (cb) cb(performance.now());
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  rmsLevel = 0;
  autoFireOnPlay = true;
  autoFireOnEnd = true;
  lastAudio = null;
  transcribeText = '';
  rafQueue.length = 0;
  const audioCtx = new MockAudioContext();
  vi.stubGlobal('AudioContext', class { constructor() { return audioCtx; } } as any);
  vi.stubGlobal('Audio', class { constructor() { lastAudio = new MockAudio(); return lastAudio; } } as any);
  vi.stubGlobal('MediaRecorder', MockMediaRecorder as any);
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { rafQueue.push(cb); return rafQueue.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => {}));
  // Node's global fetch is a non-configurable getter in some environments —
  // assign directly (same pattern as the passing voiceReliabilityClosure suite).
  (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
    const u = String(url);
    if (u.includes('/voice/transcribe')) {
      return { ok: true, json: async () => ({ text: transcribeText || 'never empty default' }) };
    }
    if (u.includes('/voice/tts')) {
      return { ok: true, json: async () => ({ audioData: 'dGVzdA==' }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  const stream = { getAudioTracks: () => [{ enabled: true }], getTracks: () => [{ enabled: true, stop: vi.fn() }] };
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; onstart: any = null; onend: any = null; onerror: any = null; constructor(t: string) { this.text = t; } });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const FAST_VAD = { agentId: 'agent-jarvis', speechThreshold: 0.02, minSpeechMs: 0, endSpeechSilenceMs: 5, maxSegmentMs: 4000, bargeInGraceMs: 0 };

/** Drive a full user turn → transcription → submit (assistant "speaks"). */
async function driveTurn(result: any, text: string) {
  transcribeText = text;
  rmsLevel = 0.3;
  await act(async () => { vi.advanceTimersByTime(20); flushRaf(2); }); // speech start
  rmsLevel = 0;
  await act(async () => { vi.advanceTimersByTime(20); flushRaf(2); }); // silence → stop
  await act(async () => { vi.advanceTimersByTime(20); });           // onstop → transcribe
}

describe('acoustic barge-in is independent of STT', () => {
  it('P1/P2: sustained speech during playback DUCKS immediately — no kill until classified', async () => {
    const onAutoSubmit = vi.fn();
    const onBargeIn = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onBargeIn }));
    await act(async () => { await result.current.startConversation(); });

    // Begin playback of an assistant chunk (simulates Jarvis speaking).
    autoFireOnEnd = false; // keep speaking state open; we control end.
    let speakP: Promise<void> = Promise.resolve();
    await act(async () => { speakP = result.current.speak('Hermes is the engineering inspection agent').catch(() => {}); });
    await act(async () => { await Promise.resolve(); }); // onplay fires
    expect(result.current.voiceState).toBe('speaking');

    // User begins speaking mid-playback — Phase 15 adaptive contract: duck
    // immediately (target speech→duck <100ms), do NOT destroy the turn yet.
    const pauseCallsBefore = lastAudio.pause.mock.calls.length;
    rmsLevel = 0.3;
    await act(async () => { vi.advanceTimersByTime(15); flushRaf(2); });

    expect(result.current.voiceState).toBe('ducked');
    expect(onBargeIn).not.toHaveBeenCalled(); // not killed before classification
    // Playback continues (ducked) — no NEW pause from the interruption.
    expect(lastAudio.pause.mock.calls.length).toBe(pauseCallsBefore);

    // Settle the pending speak promise cleanly.
    await act(async () => { lastAudio?.onended?.(); await speakP; });
  });

  it('P12: transient noise below sustained threshold does NOT barge in', async () => {
    const onBargeIn = vi.fn();
    // Sustain window (500ms) far exceeds the 10ms of "speech" we inject, so a
    // single transient spike can never satisfy the sustained-speech requirement.
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onBargeIn, minSpeechMs: 500 }));
    await act(async () => { await result.current.startConversation(); });

    autoFireOnEnd = false;
    let speakP: Promise<void> = Promise.resolve();
    await act(async () => { speakP = result.current.speak('some answer text').catch(() => {}); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.voiceState).toBe('speaking');

    // A single transient spike (below sustain) must not interrupt.
    rmsLevel = 0.3;
    await act(async () => { vi.advanceTimersByTime(5); flushRaf(1); });
    rmsLevel = 0;
    await act(async () => { vi.advanceTimersByTime(5); flushRaf(1); });

    expect(onBargeIn).not.toHaveBeenCalled();
    // playback state must remain 'speaking' (audio not halted by the transient)
    expect(result.current.voiceState).toBe('speaking');
    await act(async () => { lastAudio?.onended?.(); await speakP; });
  });

  it('P13: hard control during an ALREADY-ACTIVE turn kills after classification (inter-chunk gap)', async () => {
    const onBargeIn = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onBargeIn, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    // User's "stop" opens a turn first (turnActiveRef=true), then a chunk plays.
    transcribeText = 'Jarvis stop';
    rmsLevel = 0.3;
    await act(async () => { vi.advanceTimersByTime(20); flushRaf(2); }); // turnActiveRef = true

    autoFireOnEnd = false;
    let speakP: Promise<void> = Promise.resolve();
    await act(async () => { speakP = result.current.speak('and now a second chunk plays').catch(() => {}); });
    await act(async () => { await Promise.resolve(); }); // onplay fires → speaking=true

    // Sustained speech while speaking ducks even though turnActiveRef is
    // already true (this is the exact regression that caused the 5s delay).
    rmsLevel = 0.3;
    await act(async () => { vi.advanceTimersByTime(15); flushRaf(2); });
    expect(result.current.voiceState).toBe('ducked');

    // End the interruption: silence → recorder stop → STT ("Jarvis stop") →
    // control classification → FULL kill (queue clear + abort + halt).
    rmsLevel = 0;
    // Tick 1 sets silenceSince; tick 2 (≥5ms later) commits the speech end.
    await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
    await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
    await act(async () => { vi.advanceTimersByTime(20); }); // onstop → transcribe
    // Flush the async STT chain: fetch → json → handleConversationTranscript →
    // submitConversationTurn → performBargeIn (multiple microtask hops).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBargeIn).toHaveBeenCalled();
    expect(onControlCommand).toHaveBeenCalled();
    expect(lastAudio.pause).toHaveBeenCalled();
    await act(async () => { lastAudio?.onended?.(); await speakP; });
  });
});

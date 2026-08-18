/**
 * JarvisConversation.test.tsx — real-time conversation mode V1 engine tests.
 *
 * Exercises the REAL useVoiceIO hook (no hook mock) with a scriptable
 * voice-activity harness:
 *  - requestAnimationFrame is a manual queue the test flushes frame-by-frame
 *  - fake timers control Date.now() for measured-silence durations
 *  - the analyser mock reports a test-controlled RMS amplitude
 *  - MediaRecorder mock emits a configurable payload size
 *
 * Contract under test (cycle spec):
 *  - conversation mode auto-submits after valid end-of-speech
 *  - manual mode never auto-submits
 *  - empty/noise-only recording does not submit
 *  - transcript submits exactly once
 *  - state order: listening → transcribing → thinking → speaking → listening
 *  - TTS begins only after real playback start
 *  - playback end restarts listening
 *  - user speech during playback stops Jarvis audio and starts a new turn
 *  - disabling conversation mode stops microphone capture and timers
 *  - errors recover without duplicate submissions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO, type VoiceState } from '../hooks/useVoiceIO';

/* ─── Manual rAF queue ─── */
let rafQueue: Array<(t: number) => void> = [];
let rafIdCounter = 0;

function flushRaf(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const current = rafQueue;
    rafQueue = [];
    current.forEach((cb) => cb(performance.now()));
  }
}

/* ─── Scriptable mic amplitude ─── */
let rmsLevel = 0; // 0..1 — test-controlled microphone RMS

/* ─── Configurable recorder payload ─── */
let recorderChunkSize = 600; // >= 400 = meaningful speech payload

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: unknown;

  constructor(stream: unknown) {
    this.stream = stream;
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
    const chunk = new Blob([new Uint8Array(recorderChunkSize).fill(1)], { type: 'audio/webm' });
    this.ondataavailable?.({ data: chunk });
  }

  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.onstop?.();
  }
}

/* ─── Audio element mock with controllable playback confirmation ─── */
let autoFireOnPlay = true;
let autoFireOnEnd = true;
let lastAudio: MockAudio | null = null;
/** Every src present at the moment play() was invoked — the core regression
 *  guard: the Empty-src bug was play() being called with src === ''. */
let playSrcs: string[] = [];

class MockAudio {
  src = '';
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  // HTMLMediaElement contract surface used by the playback cleanup path
  // (detach handlers → drop src → load) — the engine clears the source
  // between sessions without ever firing a phantom media error.
  removeAttribute = vi.fn((attr: string) => { if (attr === 'src') this.src = ''; });
  load = vi.fn();
  play = vi.fn(() => {
    const self = this;
    playSrcs.push(self.src || '');
    if (autoFireOnPlay && self.src) {
      Promise.resolve().then(() => self.onplay?.());
    }
    if (autoFireOnEnd && self.src) {
      // Emulate real completion so speak() (which resolves on onended) settles.
      Promise.resolve().then(() => {
        Promise.resolve().then(() => self.onended?.());
      });
    }
    return Promise.resolve();
  });
  constructor() {
    lastAudio = this;
  }
}

/* ─── Fetch routing ─── */
let transcribeText = 'hello jarvis';
let transcribeImpl: (() => Promise<unknown>) | null = null;
const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) {
    if (transcribeImpl) return transcribeImpl();
    return { ok: true, json: async () => ({ text: transcribeText }) };
  }
  if (url.includes('/voice/tts')) {
    return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
  }
  return { ok: true, json: async () => ({}) };
});

/* ─── Helpers ─── */
const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();

function setupNavigator() {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
}

function hasSubsequence(haystack: VoiceState[], needle: VoiceState[]): boolean {
  let i = 0;
  for (const h of haystack) {
    if (h === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

/** Drive one full conversation turn: speech frames → measured silence →
 *  recorder stop → transcription. Must be called inside act(). */
async function speakOneTurn(result: { current: ReturnType<typeof useVoiceIO> }) {
  rmsLevel = 0.1; // speech
  await act(async () => { flushRaf(1); });
  rmsLevel = 0; // silence
  await act(async () => { flushRaf(1); }); // mark silenceSince
  await act(async () => { vi.advanceTimersByTime(20); }); // exceed 5ms silence
  await act(async () => { flushRaf(1); }); // detect end-of-speech → stop → transcribe
}

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  rafIdCounter = 0;
  rmsLevel = 0;
  recorderChunkSize = 600;
  autoFireOnPlay = true;
  autoFireOnEnd = true;
  lastAudio = null;
  playSrcs = [];
  transcribeText = 'hello jarvis';
  transcribeImpl = null;

  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafQueue.push(cb);
    return ++rafIdCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', () => { /* queue entries self-check refs */ });

  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = fetchMock;
  fetchMock.mockClear();
  trackStopMock.mockClear();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: trackStopMock }] });
  setupNavigator();

  (globalThis as any).AudioContext = class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() {
      return {
        fftSize: 0,
        frequencyBinCount: 128,
        getByteTimeDomainData(d: Uint8Array) {
          // Constant signal with exact RMS = rmsLevel.
          const v = Math.min(255, Math.max(0, Math.round(128 + rmsLevel * 128)));
          d.fill(v);
        },
        connect: vi.fn(),
      };
    }
    close() { return Promise.resolve(); }
  };

  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FAST_VAD = {
  agentId: 'agent-jarvis',
  endSpeechSilenceMs: 5,
  minSpeechMs: 0,
  bargeInGraceMs: 0,
  maxSegmentMs: 60000,
};

describe('Jarvis conversation mode — turn engine', () => {
  it('auto-submits exactly once after valid end-of-speech (no manual Send)', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });
    expect(result.current.voiceState).toBe('listening');
    expect(getUserMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ echoCancellation: true, noiseSuppression: true }),
      }),
    );

    await speakOneTurn(result);

    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).toHaveBeenCalledWith('hello jarvis');
    expect(result.current.voiceState).toBe('thinking'); // handed to the agent
  });

  it('manual mode NEVER auto-submits — transcript only, explicit Send required', async () => {
    const onAutoSubmit = vi.fn();
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useVoiceIO({ agentId: 'agent-jarvis', silenceTimeout: 1500, onAutoSubmit, onTranscript }),
    );

    await act(async () => { await result.current.startListening(); });
    expect(result.current.voiceState).toBe('listening');

    // Manual silence detector: sustained quiet → recorder stops.
    rmsLevel = 0;
    await act(async () => { flushRaf(1); });
    await act(async () => { vi.advanceTimersByTime(1600); });
    await act(async () => { flushRaf(1); });

    expect(onTranscript).toHaveBeenCalledWith('hello jarvis');
    expect(onAutoSubmit).not.toHaveBeenCalled(); // never auto-submits
    expect(result.current.voiceState).toBe('idle'); // waits for the user
  });

  it('empty / noise-only recording does NOT submit', async () => {
    recorderChunkSize = 200; // below the meaningful-payload floor
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);

    expect(onAutoSubmit).not.toHaveBeenCalled();
    const transcribeCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/voice/transcribe'));
    expect(transcribeCalls).toHaveLength(0); // never even transcribed
    expect(result.current.voiceState).toBe('listening'); // quietly re-armed
  });

  it('identical transcript submits exactly once (dedupe)', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });

    await speakOneTurn(result); // turn 1 → submits 'hello jarvis'
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);

    // Agent turn completes elsewhere; re-arm listening for the next turn.
    await act(async () => { result.current.startListening(); });
    await speakOneTurn(result); // turn 2 → identical transcript

    expect(onAutoSubmit).toHaveBeenCalledTimes(1); // NOT resubmitted
    expect(result.current.voiceState).toBe('listening');
  });

  it('state order: listening → transcribing → thinking → speaking → listening', async () => {
    const states: VoiceState[] = [];
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() =>
      useVoiceIO({ ...FAST_VAD, onAutoSubmit, onStateChange: (s) => states.push(s) }),
    );

    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);

    // The drawer's turn executor speaks the reply. Control onended manually so
    // we can observe the intermediate 'speaking' state before completion.
    autoFireOnEnd = false;
    let speakPromise: Promise<void> = Promise.resolve();
    await act(async () => { speakPromise = result.current.speak('REALTIME_OK'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay microtask
    expect(result.current.voiceState).toBe('speaking'); // only after real onplay

    // Real playback ends → conversation listening resumes automatically.
    await act(async () => { lastAudio?.onended?.(); await speakPromise; });
    expect(result.current.voiceState).toBe('listening');

    expect(
      hasSubsequence(states, ['listening', 'transcribing', 'thinking', 'speaking', 'listening']),
    ).toBe(true);
  });

  it('TTS begins only after real playback start (never on synthesis alone)', async () => {
    autoFireOnPlay = false; // play() resolves but playback not confirmed yet
    autoFireOnEnd = false; // we drive onplay/onended manually
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });

    await act(async () => { result.current.speak('REALTIME_OK'); });
    await act(async () => { await Promise.resolve(); });

    // play() resolved, but no real playback confirmation → NOT speaking.
    expect(result.current.voiceState).not.toBe('speaking');

    // Real playback start confirmation flips the state.
    await act(async () => { lastAudio?.onplay?.(); });
    expect(result.current.voiceState).toBe('speaking');
  });

  it('user speech during playback DUCKS Jarvis audio and starts a classification turn (adaptive barge-in)', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);
    autoFireOnEnd = false; // keep Jarvis speaking until the user barges in
    let speakPromise: Promise<void> = Promise.resolve();
    await act(async () => { speakPromise = result.current.speak('A long answer...'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.voiceState).toBe('speaking');
    const speakingAudio = lastAudio!;
    const pauseCallsBefore = speakingAudio.pause.mock.calls.length;

    // The user starts talking over Jarvis — Phase 15 contract: DUCK first
    // (audio keeps playing softly, turn NOT destroyed), recording opens for
    // classification (ack → resume / takeover → kill + new turn).
    rmsLevel = 0.1;
    await act(async () => { vi.advanceTimersByTime(10); });
    await act(async () => { flushRaf(1); });

    // Duck state entered; playback NOT hard-stopped; classification turn open.
    expect(result.current.voiceState).toBe('ducked');
    expect(speakingAudio.pause.mock.calls.length).toBe(pauseCallsBefore); // no new pause
    expect(MockMediaRecorder.instances.length).toBeGreaterThanOrEqual(2);
    const latest = MockMediaRecorder.instances[MockMediaRecorder.instances.length - 1];
    expect(latest.state).toBe('recording');
    // Settle the still-playing chunk so the pending speak promise resolves
    // (ducking preserves playback; the promise resolves on real onended).
    await act(async () => { lastAudio?.onended?.(); });
    await act(async () => { await speakPromise.catch(() => {}); });
  });

  it('ending conversation mode stops microphone capture, recorder, and timers', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });
    expect(result.current.conversationActive).toBe(true);

    await act(async () => { result.current.endConversation(); });

    expect(result.current.voiceState).toBe('idle');
    expect(result.current.conversationActive).toBe(false);
    expect(trackStopMock).toHaveBeenCalled(); // mic tracks released

    // No further turn capture after teardown, even with loud audio.
    const instancesBefore = MockMediaRecorder.instances.length;
    rmsLevel = 0.2;
    await act(async () => { flushRaf(3); });
    await act(async () => { vi.advanceTimersByTime(50); });
    await act(async () => { flushRaf(3); });
    expect(MockMediaRecorder.instances.length).toBe(instancesBefore);
    expect(onAutoSubmit).not.toHaveBeenCalled();
  });

  it('transcription error recovers to listening without duplicate submission', async () => {
    transcribeImpl = async () => { throw new Error('backend exploded'); };
    const onAutoSubmit = vi.fn();
    const states: VoiceState[] = [];
    const { result } = renderHook(() =>
      useVoiceIO({ ...FAST_VAD, onAutoSubmit, onStateChange: (s) => states.push(s) }),
    );

    await act(async () => { await result.current.startConversation(); });
    await speakOneTurn(result);

    expect(result.current.voiceState).toBe('error');
    expect(onAutoSubmit).not.toHaveBeenCalled();

    // Error recovery returns to listening — no retry storm, no duplicates.
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(result.current.voiceState).toBe('listening');

    // A real turn afterwards submits exactly once.
    transcribeImpl = null;
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
  });

  it('voice output disabled: speak skips TTS and conversation re-arms', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));

    await act(async () => { await result.current.startConversation(); });
    await act(async () => { result.current.setVoiceEnabled(false); });

    await act(async () => { await result.current.speak('Should not synthesise'); });

    const ttsCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/voice/tts'));
    expect(ttsCalls).toHaveLength(0); // synthesis never requested
    expect(result.current.voiceState).not.toBe('speaking');
  });
});

/* ─── §4–§6 playback state machine (stabilization freeze) ─── */
describe('playback state machine — Empty-src regression (stabilization)', () => {
  it('§5: play() is NEVER called with an empty src (autoplay unlock regression)', async () => {
    // Root cause of the phantom VOICE PLAYBACK ERROR: the autoplay-unlock
    // calls play() on an element with no src, firing MEDIA_ELEMENT_ERROR
    // "Empty src attribute". After the fix, every play() call — unlock or
    // real playback — must carry a valid non-empty src.
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit: vi.fn() }));

    await act(async () => { await result.current.startConversation(); });
    await act(async () => { await result.current.speak('hello jarvis').catch(() => {}); });

    expect(playSrcs.length).toBeGreaterThan(0);
    for (const src of playSrcs) {
      expect(src).not.toBe(''); // the regression guard — no empty-src play()
    }
    expect(result.current.playbackError).toBeNull();
  });

  it('§5: a playback media error surfaces the EXACT reason in the FAILED state', async () => {
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit: vi.fn() }));
    await act(async () => { await result.current.startConversation(); });
    autoFireOnEnd = false; // drive the media error manually
    let speakPromise: Promise<void> = Promise.resolve();
    await act(async () => { speakPromise = result.current.speak('hello jarvis'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.voiceState).toBe('speaking');

    // The media element reports the classic error — the banner must carry
    // the exact message, and the voice state must be FAILED (error).
    await act(async () => {
      const audio = lastAudio;
      expect(audio).not.toBeNull();
      Object.defineProperty(audio, 'error', { value: { message: 'Empty src attribute' }, configurable: true });
      audio!.onerror?.();
      await speakPromise.catch(() => {});
    });
    expect(result.current.playbackError).toBe('Empty src attribute');
    expect(result.current.voiceState).toBe('error');
  });

  it('§6: a later successful playback clears the previous FAILED banner', async () => {
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit: vi.fn() }));
    await act(async () => { await result.current.startConversation(); });
    autoFireOnEnd = false;
    let firstPromise: Promise<void> = Promise.resolve();
    await act(async () => { firstPromise = result.current.speak('first attempt'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay

    // Fail the first playback.
    await act(async () => {
      const audio = lastAudio;
      Object.defineProperty(audio, 'error', { value: { message: 'Empty src attribute' }, configurable: true });
      audio?.onerror?.();
      await firstPromise.catch(() => {});
    });
    expect(result.current.playbackError).toBe('Empty src attribute');

    // A healthy playback afterwards must CLEAR the old banner (§6).
    autoFireOnEnd = false;
    let secondPromise: Promise<void> = Promise.resolve();
    await act(async () => { secondPromise = result.current.speak('second attempt'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.playbackError).toBeNull();
    expect(result.current.voiceState).toBe('speaking');
    await act(async () => { lastAudio?.onended?.(); await secondPromise.catch(() => {}); });
  });

  it('§6: stale-session contract — recovery clears errors, no empty-src plays, live handler owns element', async () => {
    // NOTE: playAudio REUSES audioElementRef.current across sessions (it does
    // NOT recreate the element), so the contract here is behavioral, not
    // structural: after a failed attempt then a healthy recovery, the banner
    // clears, the live session owns the element's handlers, and no play()
    // call was ever made against an empty src.
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit: vi.fn() }));
    await act(async () => { await result.current.startConversation(); });

    // Session 1: a playback media error sets the FAILED banner.
    autoFireOnEnd = false;
    let firstPromise: Promise<void> = Promise.resolve();
    await act(async () => { firstPromise = result.current.speak('first'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    const audio = lastAudio;
    expect(audio).not.toBeNull();
    await act(async () => {
      Object.defineProperty(audio, 'error', { value: { message: 'Empty src attribute' }, configurable: true });
      audio!.onerror?.();
      await firstPromise.catch(() => {});
    });
    expect(result.current.playbackError).toBe('Empty src attribute');
    expect(result.current.voiceState).toBe('error');

    // Session 2: a healthy playback recovers. The banner MUST clear (§6) and
    // the live session's handler now owns the element — the failed attempt
    // cannot resurface once playback has recovered.
    autoFireOnEnd = false;
    let secondPromise: Promise<void> = Promise.resolve();
    await act(async () => { secondPromise = result.current.speak('second'); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.playbackError).toBeNull();
    expect(result.current.voiceState).toBe('speaking');
    await act(async () => { lastAudio?.onended?.(); await secondPromise.catch(() => {}); });

    // Behavioral contract across both sessions:
    //  - every play() attempt carried a real, non-empty src (no Empty-src)
    //  - the element is owned by a live handler, not orphaned/stale
    expect(playSrcs.length).toBeGreaterThan(0);
    for (const src of playSrcs) expect(src).not.toBe('');
    expect(audio!.onerror).not.toBeNull();
    expect(audio!.onplay).not.toBeNull();
  });
});

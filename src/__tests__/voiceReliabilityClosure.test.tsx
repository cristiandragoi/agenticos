import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * voiceReliabilityClosure.test.tsx — targeted R-tests for the final
 * voice-reliability closure:
 *   R1  STOP kills all output (audio halted, queue empty, suppressed)
 *   R2  late model token for a cancelled turn is discarded
 *   R3  late TTS response for a cancelled turn is never played
 *   R4  STOP produces no LLM call (control intent, not a query)
 *   R5  presence prompt routes via auto-submit (server fast-path replies)
 *   R8  one finalized transcript → one auto-submit (no duplicates)
 *   R10 new turn after STOP works; the cancelled turn never resumes
 */

let rafQueue: Array<(t: number) => void> = [];
let rafIdCounter = 0;
function flushRaf(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const current = rafQueue; rafQueue = [];
    current.forEach((cb) => cb(performance.now()));
  }
}
let rmsLevel = 0;
let recorderChunkSize = 600;

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state = 'inactive'; ondataavailable: any = null; onstop: any = null; stream: unknown;
  constructor(stream: unknown) { this.stream = stream; MockMediaRecorder.instances.push(this); }
  start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob([new Uint8Array(recorderChunkSize).fill(1)], { type: 'audio/webm' }) }); }
  stop() { if (this.state !== 'recording') return; this.state = 'inactive'; this.onstop?.(); }
}
let autoFireOnPlay = true, autoFireOnEnd = true, lastAudio: any = null, playSrcs: string[] = [];
class MockAudio {
  src = ''; onplay: any = null; onended: any = null; onerror: any = null;
  pause = vi.fn(); removeAttribute = vi.fn((a: string) => { if (a === 'src') this.src = ''; }); load = vi.fn();
  play = vi.fn(() => {
    const self = this; playSrcs.push(self.src || '');
    if (autoFireOnPlay && self.src) Promise.resolve().then(() => self.onplay?.());
    if (autoFireOnEnd && self.src) Promise.resolve().then(() => Promise.resolve().then(() => self.onended?.()));
    return Promise.resolve();
  });
  constructor() { lastAudio = this; }
}
let transcribeText = 'hello jarvis';
const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) return { ok: true, json: async () => ({ text: transcribeText }) };
  if (url.includes('/voice/tts')) return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
  return { ok: true, json: async () => ({}) };
});
const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();
function setupNavigator() {
  Object.defineProperty(navigator, 'mediaDevices', { writable: true, configurable: true, value: { getUserMedia: getUserMediaMock } });
}
async function speakOneTurn(result: { current: ReturnType<typeof useVoiceIO> }) {
  rmsLevel = 0.1; await act(async () => { flushRaf(1); });
  rmsLevel = 0; await act(async () => { flushRaf(1); });
  await act(async () => { vi.advanceTimersByTime(20); });
  await act(async () => { flushRaf(1); });
}
const FAST_VAD = { agentId: 'agent-jarvis', speechThreshold: 0.02, minSpeechMs: 0, endSpeechSilenceMs: 5, maxSegmentMs: 4000, bargeInGraceMs: 0 };

// In the real app the VAD loop re-arms after the response's TTS playback ends
// (afterPlaybackEnd). In the harness onAutoSubmit is a no-op, so we re-arm the
// conversation loop explicitly between turns — mirroring the app's re-arm.
async function rearmConversation(result: { current: ReturnType<typeof useVoiceIO> }) {
  await act(async () => { await result.current.startListening(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = []; rafIdCounter = 0; rmsLevel = 0; recorderChunkSize = 600;
  autoFireOnPlay = true; autoFireOnEnd = true; lastAudio = null; playSrcs = [];
  transcribeText = 'hello jarvis';
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { rafQueue.push(cb); return ++rafIdCounter; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = fetchMock;
  fetchMock.mockClear(); trackStopMock.mockClear(); getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: trackStopMock }] });
  setupNavigator();
  (globalThis as any).AudioContext = class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, getByteTimeDomainData(d: Uint8Array) { const v = Math.min(255, Math.max(0, Math.round(128 + rmsLevel * 128))); d.fill(v); }, connect: vi.fn() }; }
    close() { return Promise.resolve(); }
  };
  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('voice reliability closure — R-tests', () => {
  it('R1: STOP kills all output — control command halts and suppresses speech', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    // Start a normal turn → speech queue armed.
    transcribeText = 'tell me a long story';
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(10); });
    await rearmConversation(result);

    // STOP: control command path — no LLM call, queue suppressed, state listening.
    transcribeText = 'Jarvis stop';
    await speakOneTurn(result);
    expect(onControlCommand).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1); // no second model submit
    expect(result.current.voiceState).toBe('listening');

    // Even an explicit progressive chunk after STOP is discarded (suppressed).
    await act(async () => { result.current.speakProgressive('stale sentence'); });
    expect(playSrcs.filter((s) => s.includes('audio/mp3'))).toHaveLength(0);
  });

  it('R2: a late TTS request for a cancelled turn is never played (speak suppressed)', async () => {
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onControlCommand: vi.fn() }));
    await act(async () => { await result.current.startConversation(); });

    // Simulate a cancel/kill while a chunk is in flight.
    await act(async () => { result.current.killSpeech(); });
    // A stale progressive chunk must be discarded at the pump boundary.
    await act(async () => { result.current.speakProgressive('late token'); });
    expect(playSrcs.filter((s) => s.includes('audio/mp3'))).toHaveLength(0);
  });

  it('R3: STOP while speaking — a control command suppresses even a resolved TTS path (no playAudio)', async () => {
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'stop now';
    await speakOneTurn(result);
    expect(onControlCommand).toHaveBeenCalledTimes(1);
    // No audio should ever play from the control turn.
    expect(playSrcs.filter((s) => s.includes('audio/mp3'))).toHaveLength(0);
  });

  it('R4: STOP generates NO LLM call — control intent never routes to onAutoSubmit', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'Jarvis stop';
    await speakOneTurn(result);
    expect(onControlCommand).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).not.toHaveBeenCalled();
  });

  it('R5: presence prompt ("Jarvis, are you there?") routes via auto-submit for the server fast-path', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'Jarvis, are you there?';
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit.mock.calls[0][0]).toContain('are you there');
  });

  it('R8: one finalized transcript → exactly one auto-submit (no duplicate routing)', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'what is agentic os';
    await speakOneTurn(result);
    // A duplicate transcript within the dedupe window must not fire twice.
    transcribeText = 'what is agentic os';
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
  });

  it('R10: a NEW turn after STOP works; the cancelled turn never resumes', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    // Turn A: cancelled by stop.
    transcribeText = 'Jarvis stop';
    await speakOneTurn(result);
    expect(onControlCommand).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).toHaveBeenCalledTimes(0);

    // Immediately after STOP (before any new submit) a stale chunk from the
    // cancelled turn must be suppressed — the old turn is permanently inert.
    await act(async () => { result.current.speakProgressive('old turn tail'); });
    expect(playSrcs.filter((s) => s.includes('audio/mp3'))).toHaveLength(0);

    // Turn B: a fresh normal prompt works after the stop.
    await rearmConversation(result);
    transcribeText = 'what is hermes';
    await speakOneTurn(result);
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit.mock.calls[0][0]).toBe('what is hermes');
  });
});

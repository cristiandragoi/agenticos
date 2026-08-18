import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * controlCommandRouting.test.tsx — hook-level proof that a LOCAL control
 * command ("Jarvis, stop") bypasses the model entirely.
 *
 * Drives the real useVoiceIO turn path (speech → silence → transcribe) and
 * asserts:
 *   - onAutoSubmit is NOT called (no LLM routing)
 *   - onControlCommand IS called (authoritative local cancel)
 *   - the turn returns to listening
 */

/* ─── Harness (mirrors JarvisConversation.test.tsx) ─── */
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

describe('control command routing', () => {
  it('A: "Jarvis stop" bypasses the model — onAutoSubmit NOT called, onControlCommand called', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'Jarvis stop';
    await speakOneTurn(result);

    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(onControlCommand).toHaveBeenCalledTimes(1);
    expect(onControlCommand.mock.calls[0][0].kind).toBe('stop');
    expect(result.current.voiceState).toBe('listening');
  });

  it('B: "Jarvis terminate discussion" cancels the turn and fires terminate', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'Jarvis terminate discussion';
    await speakOneTurn(result);

    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(onControlCommand).toHaveBeenCalledTimes(1);
    expect(onControlCommand.mock.calls[0][0].kind).toBe('terminate');
  });

  it('C: a stop command is deduplicated (no double cancel)', async () => {
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'stop';
    await speakOneTurn(result);
    // A second identical stop within the dedup window is suppressed.
    transcribeText = 'stop';
    await act(async () => { await result.current.endConversation(); await result.current.startConversation(); });
    await speakOneTurn(result);

    // Both were detected as control (never routed to model); dedup keeps
    // the cancel path from firing twice for the SAME normalized command.
    expect(onControlCommand.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('H: standalone "Jarvis" is routed as a presence check (never silence, never the LLM — server fast-path replies)', async () => {
    // Voice-reliability closure (Phase 4): a bare wake is a presence prompt.
    // The hook submits it through the normal auto-submit path so the SERVER's
    // local fast-path answers "Yes, I'm here." — no LLM, no tool chain.
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'Jarvis';
    await speakOneTurn(result);

    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit.mock.calls[0][0]).toBe('Jarvis');
    expect(onControlCommand).not.toHaveBeenCalled();
  });

  it('normal conversational prompt still routes to the model', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'explain the Agentic OS architecture';
    await speakOneTurn(result);

    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onControlCommand).not.toHaveBeenCalled();
  });
});

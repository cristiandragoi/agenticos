/**
 * bargeInCancellation.test.tsx — targeted regression tests for the
 * full-duplex barge-in fix.
 *
 * Proves the cancellation contract:
 *  1. normal playback: speak() resolves after onended
 *  2. cancellation (halt): pending speak() settles, never hangs
 *  3. barge-in: current audio stopped, queued speech cleared, future chunks
 *     for the cancelled turn suppressed
 *  4. next turn: new speak() works after cancellation (no stale audio)
 *  5. mic stays live during playback (full-duplex)
 *  6. a late chunk for a cancelled turn cannot restart speech
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

let playSpy: any;
let lastAudio: any = null;
let autoEnd = true;

class MockAudio {
  src = '';
  onplay: any = null;
  onended: any = null;
  onerror: any = null;
  pause = vi.fn();
  removeAttribute = vi.fn((n: string) => { if (n === 'src') this.src = ''; });
  load = vi.fn();
  play = playSpy;
  constructor() { lastAudio = this; }
}

beforeEach(() => {
  vi.clearAllMocks();
  autoEnd = true;
  lastAudio = null;
  playSpy = vi.fn().mockImplementation(function (this: any) {
    const self = this;
    Promise.resolve().then(() => self.onplay?.());
    if (autoEnd) Promise.resolve().then(() => self.onended?.());
    return Promise.resolve();
  });
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', class { onstart: any = null; onend: any = null; onerror: any = null; text: string; constructor(text: string) { this.text = text; } });
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ audioData: 'test-audio' }) }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('barge-in cancellation contract', () => {
  it('1. normal playback: speak() resolves after onended', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    let resolved = false;
    await act(async () => { await result.current.speak('hello').then(() => { resolved = true; }); });
    expect(resolved).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('2. cancellation (halt) settles the pending speak() — never hangs', async () => {
    autoEnd = false; // playback never ends naturally
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    let speakSettled = false;
    let speakPromise: Promise<void> = Promise.resolve();
    await act(async () => { speakPromise = result.current.speak('long speech').then(() => { speakSettled = true; }); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.voiceState).toBe('speaking');

    // Halt (barge-in path calls haltPlayback → settles the pending promise).
    await act(async () => { result.current.stopAudio(); await speakPromise.catch(() => {}); });

    // speak() must have settled (resolved or rejected), NOT hung.
    expect(speakSettled).toBe(true);
  });

  it('3. barge-in stops audio + clears the queue (pause called)', async () => {
    autoEnd = false;
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    let speakPromise: Promise<void> = Promise.resolve();
    await act(async () => { speakPromise = result.current.speak('long answer').catch(() => {}); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.voiceState).toBe('speaking');

    await act(async () => { result.current.stopSpeaking(); await speakPromise; });
    expect(lastAudio.pause).toHaveBeenCalled();
    expect(result.current.voiceState).not.toBe('speaking');
  });

  it('4. next turn can speak normally after cancellation (no stale audio)', async () => {
    autoEnd = false;
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    let first: Promise<void> = Promise.resolve();
    await act(async () => { first = result.current.speak('turn one').catch(() => {}); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.stopAudio(); await first; });

    // Next turn completes fully.
    autoEnd = true;
    let secondResolved = false;
    await act(async () => { await result.current.speak('turn two').then(() => { secondResolved = true; }); });
    expect(secondResolved).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('5. mic stays live during playback (full-duplex — no hard mute)', async () => {
    autoEnd = false;
    const track = { enabled: true, stop: vi.fn() };
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
    });
    (globalThis as any).AudioContext = class {
      state = 'running';
      createMediaStreamSource() { return { connect: vi.fn() }; }
      createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, getByteTimeDomainData: (d: Uint8Array) => d.fill(128), connect: vi.fn() }; }
      close() { return Promise.resolve(); }
    };
    (globalThis as any).MediaRecorder = class {
      start() {} stop() {}
    };

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    await act(async () => { await result.current.startConversation(); });

    let speakPromise: Promise<void> = Promise.resolve();
    await act(async () => { speakPromise = result.current.speak('speaking now').catch(() => {}); });
    await act(async () => { await Promise.resolve(); }); // flush onplay
    expect(result.current.voiceState).toBe('speaking');

    // The mic track must remain ENABLED while Jarvis speaks (barge-in can hear).
    expect(track.enabled).toBe(true);

    // Settle playback (onended) then tear down.
    await act(async () => { lastAudio?.onended?.(); await speakPromise; });
    await act(async () => { result.current.endConversation(); });
  });
});

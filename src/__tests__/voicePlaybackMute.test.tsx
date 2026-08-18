import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * Full-duplex barge-in regression tests (JARVIS reliability closure).
 *
 * The ORIGINAL "mic mute during TTS" design had a fatal flaw: while Jarvis was
 * speaking the conversation mic track was disabled (`track.enabled = false`),
 * and a disabled MediaStreamTrack outputs SILENCE. The barge-in VAD reads that
 * same track's analyser, so `isSpeech` was always false during playback —
 * barge-in could NEVER fire, and Jarvis talked over the user.
 *
 * The fix is full-duplex: the mic stays LIVE while Jarvis speaks (echo
 * cancellation / noise suppression on the stream handle self-echo), so the VAD
 * can hear a real user voice and interrupt. These tests assert the corrected
 * contract:
 *   - mic stays ENABLED during playback (so barge-in can hear the user)
 *   - playback end / error / halt all leave the mic live
 */
describe('useVoiceIO full-duplex mic during TTS playback (barge-in)', () => {
  let track: any;
  let playSpy: any;
  let lastAudio: any;
  // Controllable VAD input: 'speech' → high-RMS samples, 'silence' → 128.
  let audioMode: 'speech' | 'silence' = 'silence';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    audioMode = 'silence';

    class MockTrack {
      enabled = true;
      kind = 'audio';
      stop = vi.fn();
    }
    track = new MockTrack();
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    };

    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });

    class MockAnalyser {
      fftSize = 512;
      frequencyBinCount = 256;
      getByteTimeDomainData = vi.fn((data: Uint8Array) => {
        if (audioMode === 'speech') data.fill(220); // rms ≈ 0.72 > threshold
        else data.fill(128); // silence
      });
    }
    class MockAudioContext {
      state = 'running';
      destination = {};
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
      createAnalyser = vi.fn(() => new MockAnalyser());
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    class MockMediaRecorder {
      static instances: MockMediaRecorder[] = [];
      state = 'inactive';
      stream: any;
      ondataavailable: any = null;
      onstop: any = null;
      constructor(stream: any) { this.stream = stream; MockMediaRecorder.instances.push(this); }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(400)], { type: 'audio/webm' }) });
        if (this.onstop) this.onstop();
      }
    }
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);

    playSpy = vi.fn().mockImplementation(function (this: any) {
      if (this.onplay) this.onplay();
      return Promise.resolve();
    });
    class MockAudio {
      src = '';
      onplay: any = null;
      onended: any = null;
      onerror: any = null;
      play = playSpy;
      pause = vi.fn();
      load = vi.fn();
      removeAttribute = vi.fn();
      duration = 2;
      error: any = null;
    }
    vi.stubGlobal('Audio', MockAudio);

    class MockSpeechSynthesisUtterance { onend: any = null; onerror: any = null; text = ''; }
    vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);
    (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
  });

  function setupHook() {
    return renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
  }

  async function startConversation(result: any) {
    let ok = false;
    await act(async () => { ok = await result.current.startConversation(); });
    expect(ok).toBe(true);
  }

  /** Drive speak() through synthesis → playAudio → onplay. Returns the audio
   *  element (NOT the speak promise — speak() only resolves on onended). */
  async function speakAndReachPlayback(result: any, text = 'Hello there'): Promise<any> {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audioData: 'AAAA' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    act(() => { void result.current.speak(text); });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    lastAudio = (playSpy.mock.instances as any[])[0];
    return lastAudio;
  }

  it('A: mic stays LIVE while Jarvis is speaking (full-duplex — barge-in can hear the user)', async () => {
    const { result } = setupHook();
    await startConversation(result);
    expect(track.enabled).toBe(true); // mic live before speech
    await speakAndReachPlayback(result);
    // Full-duplex: the mic must NOT be muted during playback, otherwise the
    // VAD reads silence and barge-in can never fire.
    expect(track.enabled).toBe(true);
  });

  it('B: playback end leaves the mic live (no stale mute from a prior design)', async () => {
    const { result } = setupHook();
    await startConversation(result);
    await speakAndReachPlayback(result);
    expect(track.enabled).toBe(true); // live during speech
    await act(async () => {
      if (lastAudio?.onended) lastAudio.onended();
    });
    expect(track.enabled).toBe(true); // still live for the next user turn
  });

  it('C: playback error leaves the mic live (recovery never strands it muted)', async () => {
    const { result } = setupHook();
    await startConversation(result);
    await speakAndReachPlayback(result);
    expect(track.enabled).toBe(true);
    await act(async () => {
      if (lastAudio?.onerror) lastAudio.onerror();
    });
    expect(track.enabled).toBe(true);
  });

  it('D: haltPlayback (barge-in/stop) keeps the mic live', async () => {
    const { result } = setupHook();
    await startConversation(result);
    await speakAndReachPlayback(result);
    expect(track.enabled).toBe(true);
    await act(async () => {
      result.current.stopSpeaking();
    });
    expect(track.enabled).toBe(true);
  });
});

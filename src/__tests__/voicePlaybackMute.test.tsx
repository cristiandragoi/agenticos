import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * ROOT-CAUSE FIX regression tests (multi-turn voice):
 *
 * The reported failure — Turn 1 works, Turns 2/3 silently fail with the UI
 * stuck in Listening — was traced to Jarvis's OWN TTS output being picked up
 * by the conversation mic. The VAD treated the speaker echo as user speech:
 * echo recordings were either transcribed and auto-submitted as fake user
 * turns ("Jarvis hears itself" loop) or rejected by Deepgram as noSpeech and
 * silently dropped while the user's real turn was missed.
 *
 * The fix: mute the conversation mic while Jarvis is speaking (TTS playback)
 * and re-enable it on playback end BEFORE the mic loop re-arms.
 *
 * These tests assert the mute/unmute lifecycle contract:
 *   - playAudio start (onplay)  → conversation mic track disabled
 *   - playback end (onended)    → conversation mic track re-enabled
 *   - playback error (onerror)  → conversation mic track re-enabled
 *   - haltPlayback (stop)       → conversation mic track re-enabled
 */
describe('useVoiceIO mic mute during TTS playback (multi-turn voice)', () => {
  let track: any;
  let playSpy: any;
  let lastAudio: any;
  // Controllable VAD input: 'speech' → high-RMS samples, 'silence' → 128.
  let audioMode: 'speech' | 'silence' = 'silence';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    audioMode = 'silence';

    // MediaStream track with an `enabled` flag we can observe.
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

    // AudioContext minimal stub for openConversationMic.
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

    // MediaRecorder stub — records, then on stop produces a small blob.
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

    // Audio element stub with controllable playback events.
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
    return renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
    }));
  }

  /** Start the conversation (opens the mic + arms VAD). */
  async function startConversation(result: any) {
    let ok = false;
    await act(async () => { ok = await result.current.startConversation(); });
    expect(ok).toBe(true);
  }

  /** Wait for N real jsdom rAF frames (pretendToBeVisual → ~16ms each).
   *  The VAD ticker runs on the same rAF loop, so settling frames lets the
   *  ticker observe the current audioMode and react to it. */
  function rafSettle(frames = 12) {
    return new Promise<void>((resolve) => {
      let n = 0;
      const step = () => {
        n += 1;
        if (n >= frames) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Drive ONE real VAD turn end-to-end: the ticker detects speech
   *  (startTurnRecording → MediaRecorder), then silence (recorder stop →
   *  blob → transcription → auto-submit). Uses fast VAD tuning so the
   *  lifecycle completes in a few frames. */
  async function driveVoiceTurn(result: any) {
    audioMode = 'speech';
    await act(async () => { await rafSettle(); });
    audioMode = 'silence';
    await act(async () => { await rafSettle(); });
  }

  /** Drive TTS playback: speak() → playAudio() → onplay fires. */
  async function speakAndReachPlayback(result: any, text = 'Hello there') {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audioData: 'AAAA' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    let p: Promise<void> | undefined;
    act(() => { p = result.current.speak(text); });
    await Promise.resolve();
    await Promise.resolve();
    const audio = (playSpy.mock.instances as any[])[0];
    lastAudio = audio;
    return p;
  }

  it('A: conversation mic is DISABLED while Jarvis is speaking (onplay)', async () => {
    const { result } = setupHook();
    await startConversation(result);
    expect(track.enabled).toBe(true); // mic live before speech
    await speakAndReachPlayback(result);
    // onplay fired → Jarvis speaking → mic muted.
    expect(track.enabled).toBe(false);
  });

  it('B: conversation mic is RE-ENABLED when playback ends (onended) — next user turn can be heard', async () => {
    const { result } = setupHook();
    await startConversation(result);
    const p = await speakAndReachPlayback(result);
    expect(track.enabled).toBe(false); // muted during speech
    await act(async () => {
      if (lastAudio?.onended) lastAudio.onended();
      await p;
    });
    expect(track.enabled).toBe(true); // unmuted before re-arm
  });

  it('C: conversation mic is RE-ENABLED on playback error (onerror)', async () => {
    const { result } = setupHook();
    await startConversation(result);
    await speakAndReachPlayback(result);
    expect(track.enabled).toBe(false);
    await act(async () => {
      if (lastAudio?.onerror) lastAudio.onerror();
    });
    expect(track.enabled).toBe(true);
  });

  it('D: haltPlayback (stop) never leaves the conversation mic muted', async () => {
    const { result } = setupHook();
    await startConversation(result);
    await speakAndReachPlayback(result);
    expect(track.enabled).toBe(false);
    await act(async () => {
      result.current.stopSpeaking();
    });
    expect(track.enabled).toBe(true);
  });

  it('E: two consecutive real VAD turns — identical repeated question is NOT suppressed (brief §9)', async () => {
    const submitted: string[] = [];
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      onAutoSubmit: (t) => submitted.push(t),
      // Fast VAD tuning: the lifecycle must complete in a few rAF frames.
      speechThreshold: 0.01,
      minSpeechMs: 1,
      endSpeechSilenceMs: 1,
    }));
    await startConversation(result);

    // Controllable advancing clock. The VAD ticker compares Date.now()
    // deltas, so the clock must advance per call; the dedupe window (4s)
    // needs a >4s jump between turns — real turns are separated by TTS
    // playback, which is exactly what we simulate (brief §9).
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => { clock += 16; return clock; });

    // Simulate TURN 1 via the REAL path: VAD speech → recorder → blob →
    // transcription → handleConversationTranscript → auto-submit.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/voice/transcribe')) {
        return { ok: true, json: async () => ({ text: 'What model are you using?' }) };
      }
      if (url.endsWith('/voice/tts')) {
        return { ok: true, json: async () => ({ audioData: 'AAAA' }) };
      }
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await driveVoiceTurn(result);
    expect(submitted).toEqual(['What model are you using?']);

    // Jarvis responds via TTS: mic muted during playback, re-enabled when
    // playback ends (which also re-arms listening for the next user turn).
    let p: Promise<void> | undefined;
    act(() => { p = result.current.speak('I run on OpenRouter.'); });
    // speak() resolves only after onplay confirms real playback start — at
    // which point the conversation mic is muted (root-cause fix).
    await act(async () => { await p; });
    const audio = (playSpy.mock.instances as any[])[0];
    lastAudio = audio;
    expect(track.enabled).toBe(false); // muted while Jarvis speaks
    await act(async () => {
      if (audio?.onended) audio.onended();
    });
    expect(track.enabled).toBe(true); // unmuted before next turn

    // The identical-text dedupe only applies within its 4s window; a real
    // follow-up turn happens after TTS playback, so the SAME question must
    // create a NEW conversational turn (brief §9).
    clock += 5000;

    // TURN 2 — same question, real VAD path again.
    await driveVoiceTurn(result);
    expect(submitted).toEqual([
      'What model are you using?',
      'What model are you using?',
    ]);
    vi.restoreAllMocks();
  });

  it('F: identical text inside the 4s dedupe window is still deduped (guard intact)', async () => {
    const submitted: string[] = [];
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      onAutoSubmit: (t) => submitted.push(t),
    }));
    await startConversation(result);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'Same short command' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await act(async () => { await result.current.processAudioBlob(blob); });
    // Within the dedupe window the second identical submit is rejected.
    await act(async () => { await result.current.processAudioBlob(blob); });
    expect(submitted).toEqual(['Same short command']);
  });
});

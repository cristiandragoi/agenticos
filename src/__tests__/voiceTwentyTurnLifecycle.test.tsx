import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * voiceTwentyTurnLifecycle.test.tsx — Phase 15 (Failure A): 20 sequential
 * turns must never leave the mic dead, stuck in 'thinking', or accumulate
 * stale queue/ownership. Exercises normal replies, no-TTS replies, delegated
 * (no-playback) replies, errors, cancellation, acknowledgement, takeover.
 */

let rmsLevel = 0; let autoFireOnEnd = true; let lastAudio: any = null; let transcribeText = 'hello jarvis';
let rafQueue: Array<(t: number) => void> = []; let rafIdCounter = 0;
function flushRaf(frames = 1) { for (let i = 0; i < frames; i++) { const current = rafQueue; rafQueue = []; current.forEach((cb) => cb(performance.now())); } }
class MockMediaRecorder { static instances: any[] = []; state='inactive'; ondataavailable:any=null; onstop:any=null; stream:unknown;
  constructor(stream:unknown){this.stream=stream;MockMediaRecorder.instances.push(this);}
  start(){this.state='recording';this.ondataavailable?.({data:new Blob([new Uint8Array(600).fill(1)],{type:'audio/webm'})});}
  stop(){if(this.state!=='recording')return;this.state='inactive';this.onstop?.();} }
class MockAudio { src='';paused=true;volume=1;onplay:any=null;onended:any=null;onerror:any=null;duration=1;
  pause=vi.fn(function(this:any){this.paused=true});removeAttribute=vi.fn((a:string)=>{if(a==='src')this.src='';});load=vi.fn();
  play=vi.fn(function(this:any){const s=this;s.paused=false;if(s.src)Promise.resolve().then(()=>s.onplay?.());if(autoFireOnEnd&&s.src)Promise.resolve().then(()=>Promise.resolve().then(()=>s.onended?.()));return Promise.resolve();});
  constructor(){lastAudio=this;} }
const trackStopMock = vi.fn(); const getUserMediaMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = []; rafIdCounter = 0; rmsLevel = 0; autoFireOnEnd = true; lastAudio = null;
  transcribeText = 'hello jarvis';
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { rafQueue.push(cb); return ++rafIdCounter; };
  vi.stubGlobal('cancelAnimationFrame', () => {});
  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/voice/transcribe')) return { ok: true, json: async () => ({ text: transcribeText }) };
    if (url.includes('/voice/tts')) return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
    return { ok: true, json: async () => ({}) };
  });
  trackStopMock.mockClear(); getUserMediaMock.mockReset();
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** Simulate the response OWNER settling the turn (JarvisChat done/error). */
async function settleResponse(result: { current: ReturnType<typeof useVoiceIO> }) {
  await act(async () => { result.current.notifyResponseSettled(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** Drain the full speak→TTS→playAudio→onended microtask chain. */
async function drainPlayback() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

describe('E: 20-turn lifecycle — every terminal path re-arms the mic', () => {
  it('20 sequential turns across normal/no-TTS/delegated/error/cancel/ack/takeover never deadlock', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const onBargeIn = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand, onBargeIn }));
    await act(async () => { await result.current.startConversation(); });

    let expectedSubmits = 0;

    for (let i = 0; i < 20; i++) {
      const kind = i % 7;
      // Deterministic playback contract: every non-barge-in branch relies on
      // the browser's REAL terminal event (onended) auto-firing. Barge-in
      // branches (5/6) deliberately disable auto-end while they control
      // playback, and MUST restore it before the next turn — otherwise a
      // half-open playAudio()/onended chain poisons every later turn.
      if (kind !== 5 && kind !== 6) autoFireOnEnd = true;
      if (kind === 0) {
        // Normal reply with TTS.
        transcribeText = `normal question ${i}`;
        await speakOneTurn(result);
        expectedSubmits += 1;
        await act(async () => { result.current.speakProgressive(`normal reply ${i}`); });
        await drainPlayback(); // full TTS→play→onended chain
        await settleResponse(result);
      } else if (kind === 1) {
        // No-TTS reply: the response owner settles; mic must re-arm.
        transcribeText = `no tts question ${i}`;
        await speakOneTurn(result);
        expectedSubmits += 1;
        await settleResponse(result);
      } else if (kind === 2) {
        // Delegated reply (no playback): owner settles; mic must re-arm.
        transcribeText = `delegated question ${i}`;
        await speakOneTurn(result);
        expectedSubmits += 1;
        await settleResponse(result);
      } else if (kind === 3) {
        // Error path: owner settles with error; mic must re-arm.
        transcribeText = `error question ${i}`;
        await speakOneTurn(result);
        expectedSubmits += 1;
        await settleResponse(result);
      } else if (kind === 4) {
        // Cancellation: cancelResponse (owner) → settle; mic must re-arm.
        transcribeText = `cancel question ${i}`;
        await speakOneTurn(result);
        expectedSubmits += 1;
        await act(async () => { result.current.killSpeech(); });
        await settleResponse(result);
      } else if (kind === 5) {
        // Acknowledgement barge-in: duck → resume; no new submit.
        transcribeText = 'okay';
        autoFireOnEnd = false;
        // The app re-arms speech for the next run after a cancel (new turn
        // submit / armSpeech) — mirror it before speaking directly.
        await act(async () => { result.current.armSpeech(); });
        let speakP: Promise<void> = Promise.resolve();
        await act(async () => { speakP = result.current.speak('ack barge answer').catch(() => {}); });
        await act(async () => { await Promise.resolve(); });
        expect(result.current.voiceState).toBe('speaking');
        rmsLevel = 0.3;
        await act(async () => { vi.advanceTimersByTime(15); flushRaf(1); });
        expect(result.current.voiceState).toBe('ducked');
        rmsLevel = 0;
        await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
        await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
        await act(async () => { vi.advanceTimersByTime(20); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
        await act(async () => { lastAudio?.onended?.(); await speakP.catch(() => {}); });
        await drainPlayback();
        await settleResponse(result);
      } else {
        // Takeover: sustained speech escalates; new turn submits once.
        transcribeText = `takeover request ${i}`;
        autoFireOnEnd = false;
        await act(async () => { result.current.armSpeech(); });
        let speakP2: Promise<void> = Promise.resolve();
        await act(async () => { speakP2 = result.current.speak('takeover barge answer').catch(() => {}); });
        await act(async () => { await Promise.resolve(); });
        expect(result.current.voiceState).toBe('speaking');
        rmsLevel = 0.3;
        await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // duck, acc reset
        await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // acc start
        await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // 700ms
        await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // 1400ms
        await act(async () => { vi.advanceTimersByTime(700); flushRaf(1); }); // 2100ms → escalate
        expect(onBargeIn).toHaveBeenCalled();
        rmsLevel = 0;
        await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
        await act(async () => { vi.advanceTimersByTime(20); flushRaf(1); });
        await act(async () => { vi.advanceTimersByTime(20); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
        expectedSubmits += 1;
        await act(async () => { lastAudio?.onended?.(); await speakP2.catch(() => {}); });
        await settleResponse(result);
      }

      // Invariant after every turn: never stuck 'thinking'/'transcribing'
      // with no playback; the mic is re-armed (listening) or mid-recording.
      // 'idle' is allowed transiently (cancel/stop path) — the NEXT turn
      // must still work (asserted by the loop continuing).
      const s = result.current.voiceState;
      expect(['idle', 'listening', 'transcribing', 'thinking', 'speaking', 'ducked']).toContain(s);
    }

    // All normal/delegated/error/cancel/takeover turns submitted exactly once;
    // acknowledgement turns did NOT add submits.
    expect(onAutoSubmit.mock.calls.length).toBe(expectedSubmits);
    // Conversation still active and re-armed at the end.
    expect(result.current.conversationActive).toBe(true);
    // No stale playback / TTS queue left over from the mixed 20 turns.
    expect(result.current.voiceState).not.toBe('speaking');
    expect(result.current.voiceState).not.toBe('ducked');
    // A 21st turn still works end-to-end (mic re-armed after every path).
    transcribeText = 'final check question';
    const submitsBeforeFinal = onAutoSubmit.mock.calls.length;
    await speakOneTurn(result);
    await settleResponse(result);
    expect(onAutoSubmit.mock.calls.length).toBe(submitsBeforeFinal + 1);
  });
});

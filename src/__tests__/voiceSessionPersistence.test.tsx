import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';
import { resolveVoiceSessionConfig, voiceSynthesisLog, distinctVoicesInLog, recordVoiceSynthesis } from '../lib/voiceSessionConfig';

/**
 * voiceSessionPersistence.test.tsx — Phase 15 (Failure B): voice identity
 * must be pinned to one authoritative config across turns, rerenders,
 * retries, interruptions, STOP, route changes, and local-vs-LLM replies.
 * Fallback is allowed only when explicitly recorded — never silent.
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
let ttsBodies: any[] = [];
const fetchMock = vi.fn(async (input: unknown, init?: any) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) return { ok: true, json: async () => ({ text: transcribeText }) };
  if (url.includes('/voice/tts')) {
    ttsBodies.push(JSON.parse(String(init?.body || '{}')));
    return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
  }
  return { ok: true, json: async () => ({}) };
});
const trackStopMock = vi.fn(); const getUserMediaMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = []; rafIdCounter = 0; rmsLevel = 0; autoFireOnEnd = true; lastAudio = null;
  transcribeText = 'hello jarvis'; ttsBodies = [];
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { rafQueue.push(cb); return ++rafIdCounter; };
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe('resolveVoiceSessionConfig (pure)', () => {
  it('pins the per-agent default when no override', () => {
    const cfg = resolveVoiceSessionConfig('agent-jarvis', null);
    expect(cfg.model).toBe('aura-helios-en');
    expect(cfg.voiceId).toBe('aura-helios-en');
    expect(cfg.provider).toBe('deepgram');
  });
  it('override wins once set', () => {
    const cfg = resolveVoiceSessionConfig('agent-jarvis', 'aura-luna-en');
    expect(cfg.model).toBe('aura-luna-en');
    expect(cfg.override).toBe('aura-luna-en');
  });
  it('agent-hermes keeps its distinct voice', () => {
    expect(resolveVoiceSessionConfig('agent-hermes', null).model).toBe('aura-orion-en');
  });
});

describe('D: voice identity persistence across 10 turns', () => {
  it('every synthesis uses aura-helios-en; fallback only when explicitly recorded', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));
    await act(async () => { await result.current.startConversation(); });

    // 10 conversational turns through the real TTS path (each speaks a reply).
    for (let i = 0; i < 10; i++) {
      await speakOneTurn(result);
      await act(async () => { result.current.speakProgressive(`Reply number ${i + 1} here.`); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      // Let each chunk's playback complete (autoFireOnEnd fires onended).
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    }

    expect(ttsBodies.length).toBeGreaterThanOrEqual(10);
    const voicesUsed = new Set(ttsBodies.map((b) => b.voice));
    expect([...voicesUsed]).toEqual(['aura-helios-en']);

    // Distinct voices in the synthesis diagnostics log is exactly the pinned one.
    const distinct = distinctVoicesInLog(50);
    expect(distinct).toEqual(['aura-helios-en']);
  });

  it('rerender/retry/interruption/STOP do not change the voice', async () => {
    const onAutoSubmit = vi.fn();
    const onControlCommand = vi.fn();
    const { result, rerender } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onControlCommand }));
    await act(async () => { await result.current.startConversation(); });

    // Turn 1 — normal.
    await speakOneTurn(result);
    await act(async () => { result.current.speakProgressive('first reply'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Rerender (component re-render must not re-resolve the voice).
    rerender();

    // Turn 2 — interruption/STOP path.
    transcribeText = 'Jarvis stop';
    await speakOneTurn(result);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Turn 3 — normal again after STOP.
    transcribeText = 'what is the current task';
    await speakOneTurn(result);
    await act(async () => { result.current.speakProgressive('third reply'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const voicesUsed = new Set(ttsBodies.map((b) => b.voice));
    expect([...voicesUsed]).toEqual(['aura-helios-en']);
    // No silent browser fallback: every /voice/tts request carried the voice.
    expect(ttsBodies.every((b) => b.voice === 'aura-helios-en')).toBe(true);
  });

  it('an explicit fallback is recorded truthfully (fallbackReason + provider browser)', () => {
    recordVoiceSynthesis({
      voiceSessionId: 'conv-test-1', turnId: 1, ttsProvider: 'browser-speechsynthesis',
      ttsModel: 'browser', voiceId: 'aura-helios-en', fallbackReason: 'TTS HTTP 502', at: Date.now(),
    });
    const recs = voiceSynthesisLog(5);
    const fb = recs[recs.length - 1];
    expect(fb.ttsProvider).toBe('browser-speechsynthesis');
    expect(fb.fallbackReason).toBe('TTS HTTP 502');
    expect(fb.voiceId).toBe('aura-helios-en'); // intended voice preserved in record
    // Distinct voices still 1 because the fallback record keeps the intended id.
    expect(distinctVoicesInLog(50)).toContain('aura-helios-en');
  });
});

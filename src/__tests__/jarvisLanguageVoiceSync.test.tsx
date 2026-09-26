import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';
import {
  resolveVoiceSessionConfig,
  isVoiceCompatibleWithLanguage,
  LANGUAGE_VOICE_DEFAULTS,
} from '../lib/voiceSessionConfig';

let rmsLevel = 0;
let autoFireOnEnd = true;
let lastAudio: any = null;
let transcribeText = 'hello jarvis';
let transcribeLanguage = 'en';
let rafQueue: Array<(t: number) => void> = [];
let rafIdCounter = 0;

function flushRaf(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const current = rafQueue;
    rafQueue = [];
    current.forEach((cb) => cb(performance.now()));
  }
}

class MockMediaRecorder {
  static instances: any[] = [];
  state = 'inactive';
  ondataavailable: any = null;
  onstop: any = null;
  stream: unknown;
  constructor(stream: unknown) {
    this.stream = stream;
    MockMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(600).fill(1)], { type: 'audio/webm' }) });
  }
  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.onstop?.();
  }
}

class MockAudio {
  src = '';
  paused = true;
  volume = 1;
  onplay: any = null;
  onended: any = null;
  onerror: any = null;
  duration = 1;
  pause = vi.fn(function (this: any) { this.paused = true; });
  removeAttribute = vi.fn((a: string) => { if (a === 'src') this.src = ''; });
  load = vi.fn();
  // HTMLMediaElement listener surface — see registerActiveAudio() (jarvisEngineAuthority).
  // Without it the throw escapes onplay and aborts the playback-start state machine.
  private listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  addEventListener = (type: string, cb: (...a: unknown[]) => void) => {
    const l = this.listeners.get(type) ?? [];
    l.push(cb);
    this.listeners.set(type, l);
  };
  removeEventListener = (type: string, cb: (...a: unknown[]) => void) => {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== cb));
  };
  currentTime = 0;
  play = vi.fn(function (this: any) {
    const s = this;
    s.paused = false;
    if (s.src) Promise.resolve().then(() => s.onplay?.());
    if (autoFireOnEnd && s.src) Promise.resolve().then(() => Promise.resolve().then(() => s.onended?.()));
    return Promise.resolve();
  });
  constructor() { lastAudio = this; }
}

let ttsBodies: any[] = [];
const fetchMock = vi.fn(async (input: unknown, init?: any) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) {
    return {
      ok: true,
      json: async () => ({ text: transcribeText, language: transcribeLanguage, probability: 0.95 }),
    };
  }
  if (url.includes('/voice/tts')) {
    const body = JSON.parse(String(init?.body || '{}'));
    ttsBodies.push(body);
    return {
      ok: true,
      json: async () => ({
        audioData: 'QkFTRTY0QVVESU8=',
        voice: body.voice,
        language: body.language,
      }),
    };
  }
  return { ok: true, json: async () => ({}) };
});

const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  rafIdCounter = 0;
  rmsLevel = 0;
  autoFireOnEnd = true;
  lastAudio = null;
  transcribeText = 'hello jarvis';
  transcribeLanguage = 'en';
  ttsBodies = [];
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => {
    rafQueue.push(cb);
    return ++rafIdCounter;
  };
  vi.stubGlobal('cancelAnimationFrame', () => {});
  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = fetchMock;
  fetchMock.mockClear();
  trackStopMock.mockClear();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({
    getTracks: () => [{ stop: trackStopMock }],
    getAudioTracks: () => [{ enabled: true }],
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
  (globalThis as any).AudioContext = class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() {
      return {
        fftSize: 0,
        frequencyBinCount: 128,
        getByteTimeDomainData(d: Uint8Array) {
          const v = Math.min(255, Math.max(0, Math.round(128 + rmsLevel * 128)));
          d.fill(v);
        },
        connect: vi.fn(),
      };
    }
    createMediaElementSource() { return { connect: vi.fn() }; }
    destination = {};
    close() { return Promise.resolve(); }
  };
  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
  (globalThis as any).SpeechSynthesisUtterance = class {
    text: string;
    onstart: any = null;
    onend: any = null;
    onerror: any = null;
    constructor(t: string) { this.text = t; }
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FAST_VAD = {
  agentId: 'agent-hermes',
  speechThreshold: 0.02,
  minSpeechMs: 0,
  endSpeechSilenceMs: 5,
  maxSegmentMs: 4000,
  bargeInGraceMs: 0,
};

/**
 * LEGACY BROWSER-VAD COVERAGE (non-Jarvis agent mode). This suite drives the
 * client-side speak() → `/api/voice/tts` language/voice path, which is the LEGACY
 * architecture: for `agent-jarvis` the client speak path is hard-suppressed
 * ("[LegacyVoice] Suppressed speak — deactivated for LiveKit replacement") and speech
 * comes from the server-side LiveKit voice agent, so these assertions would be
 * vacuous under 'agent-jarvis'. The suite therefore runs a non-Jarvis agent.
 *
 * The requirement under test is LANGUAGE → VOICE SYNCHRONISATION: a language change
 * must invalidate the cached voice config and move TTS to that language's voice (with
 * no stale voice carried over). Each agent pins its OWN English voice, so the English
 * expectation is derived from the agent under test and asserted literally below.
 * Jarvis's own voice identities are covered by the resolveVoiceSessionConfig block
 * further down (agent-jarvis, per language).
 */
const LEGACY_AGENT = 'agent-hermes';
const EN_VOICE = resolveVoiceSessionConfig(LEGACY_AGENT, null).model;

describe('Jarvis Language & Voice Synchronization — legacy browser-TTS mode (non-Jarvis agent)', () => {
  it('1. English -> German: updates language, invalidates cache, and uses de-DE-KillianNeural for TTS', async () => {
    const { result, rerender } = renderHook(
      ({ lang, voiceOverride }) =>
        useVoiceIO({
          ...FAST_VAD,
          language: lang,
          voiceOverride,
          conversationId: 'conv-test-de',
        }),
      { initialProps: { lang: 'en', voiceOverride: null as string | null } }
    );

    // Initial English speak
    await act(async () => {
      await result.current.speak('Hello from Jarvis in English.');
    });
    expect(ttsBodies.length).toBe(1);
    expect(ttsBodies[0].language).toBe('en');
    expect(EN_VOICE).toBe('en-GB-ThomasNeural'); // exact, not a wildcard
    expect(ttsBodies[0].voice).toBe(EN_VOICE);

    // Switch language to German
    rerender({ lang: 'de', voiceOverride: null });

    // Speak in German
    await act(async () => {
      await result.current.speak('Verstanden. Ich spreche ab jetzt Deutsch.');
    });

    expect(ttsBodies.length).toBe(2);
    expect(ttsBodies[1].language).toBe('de');
    expect(ttsBodies[1].voice).toBe('de-DE-KillianNeural');
    expect(ttsBodies[1].voice).not.toBe(EN_VOICE); // no stale English voice carried over
  });

  it('2. German -> English: returns to en and uses en-GB-RyanNeural', async () => {
    const { result, rerender } = renderHook(
      ({ lang }) =>
        useVoiceIO({
          ...FAST_VAD,
          language: lang,
          conversationId: 'conv-test-back-en',
        }),
      { initialProps: { lang: 'de' } }
    );

    await act(async () => {
      await result.current.speak('Guten Tag.');
    });
    expect(ttsBodies[0].language).toBe('de');
    expect(ttsBodies[0].voice).toBe('de-DE-KillianNeural');

    // Switch back to English
    rerender({ lang: 'en' });

    await act(async () => {
      await result.current.speak('I am back in English.');
    });
    expect(ttsBodies[1].language).toBe('en');
    expect(ttsBodies[1].voice).toBe(EN_VOICE);
  });

  it('3. English -> Romanian: updates language and uses ro-RO-EmilNeural for TTS', async () => {
    const { result, rerender } = renderHook(
      ({ lang }) =>
        useVoiceIO({
          ...FAST_VAD,
          language: lang,
          conversationId: 'conv-test-ro',
        }),
      { initialProps: { lang: 'en' } }
    );

    rerender({ lang: 'ro' });

    await act(async () => {
      await result.current.speak('Am înțeles. Vorbesc în limba română.');
    });

    expect(ttsBodies.length).toBe(1);
    expect(ttsBodies[0].language).toBe('ro');
    expect(ttsBodies[0].voice).toBe('ro-RO-EmilNeural');
  });

  it('4. An incompatible persisted English voice cannot override German or Romanian', async () => {
    // User had 'en-GB-ThomasNeural' or 'aura-helios-en' persisted in localStorage
    const { result } = renderHook(() =>
      useVoiceIO({
        ...FAST_VAD,
        language: 'de',
        voiceOverride: 'en-GB-ThomasNeural', // Incompatible English voice!
        conversationId: 'conv-override-de',
      })
    );

    await act(async () => {
      await result.current.speak('Wie kann ich Ihnen helfen?');
    });

    expect(ttsBodies.length).toBe(1);
    expect(ttsBodies[0].language).toBe('de');
    // Must discard the English override and use the German default
    expect(ttsBodies[0].voice).toBe('de-DE-KillianNeural');
    expect(ttsBodies[0].voice).not.toBe('en-GB-ThomasNeural');
  });

  it('5. Pure voice config resolver enforces voice compatibility per language', () => {
    // English
    const enCfg = resolveVoiceSessionConfig('agent-jarvis', 'en-GB-ThomasNeural', undefined, 'en');
    expect(enCfg.model).toBe('en-GB-ThomasNeural');
    expect(enCfg.language).toBe('en');

    // Incompatible English voice passed with German -> resolved to de-DE-KillianNeural
    const deWithEnVoice = resolveVoiceSessionConfig('agent-jarvis', 'en-GB-RyanNeural', undefined, 'de');
    expect(deWithEnVoice.model).toBe('de-DE-KillianNeural');
    expect(deWithEnVoice.language).toBe('de');
    expect(deWithEnVoice.locale).toBe('de-DE');

    // Incompatible German voice passed with Romanian -> resolved to ro-RO-EmilNeural
    const roWithDeVoice = resolveVoiceSessionConfig('agent-jarvis', 'de-DE-KillianNeural', undefined, 'ro');
    expect(roWithDeVoice.model).toBe('ro-RO-EmilNeural');
    expect(roWithDeVoice.language).toBe('ro');
    expect(roWithDeVoice.locale).toBe('ro-RO');

    // Incompatible Romanian voice passed with English -> resolved to en-GB-RyanNeural
    const enWithRoVoice = resolveVoiceSessionConfig('agent-jarvis', 'ro-RO-EmilNeural', undefined, 'en');
    expect(enWithRoVoice.model).toBe('en-GB-RyanNeural');
    expect(enWithRoVoice.language).toBe('en');
  });

  it('6. Helper isVoiceCompatibleWithLanguage correctly identifies valid and invalid pairs', () => {
    expect(isVoiceCompatibleWithLanguage('de-DE-KillianNeural', 'de')).toBe(true);
    expect(isVoiceCompatibleWithLanguage('de-DE-ConradNeural', 'de')).toBe(true);
    expect(isVoiceCompatibleWithLanguage('en-GB-RyanNeural', 'de')).toBe(false);
    expect(isVoiceCompatibleWithLanguage('ro-RO-EmilNeural', 'de')).toBe(false);

    expect(isVoiceCompatibleWithLanguage('ro-RO-EmilNeural', 'ro')).toBe(true);
    expect(isVoiceCompatibleWithLanguage('ro-RO-AlinaNeural', 'ro')).toBe(true);
    expect(isVoiceCompatibleWithLanguage('en-GB-RyanNeural', 'ro')).toBe(false);
    expect(isVoiceCompatibleWithLanguage('de-DE-KillianNeural', 'ro')).toBe(false);

    expect(isVoiceCompatibleWithLanguage('en-GB-RyanNeural', 'en')).toBe(true);
    expect(isVoiceCompatibleWithLanguage('aura-helios-en', 'en')).toBe(true);
    expect(isVoiceCompatibleWithLanguage('de-DE-KillianNeural', 'en')).toBe(false);
    expect(isVoiceCompatibleWithLanguage('ro-RO-EmilNeural', 'en')).toBe(false);
  });
});

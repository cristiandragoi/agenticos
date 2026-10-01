import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

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

let rmsLevel = 0;
let recorderChunkSize = 600;

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

class MockAudio {
  src = '';
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  removeAttribute = vi.fn((attr: string) => { if (attr === 'src') this.src = ''; });
  load = vi.fn();
  // HTMLMediaElement listener surface — see registerActiveAudio().
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
  volume = 1;
  play = vi.fn(() => Promise.resolve());
}

let transcribeText = 'hello';
const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) {
    return { ok: true, json: async () => ({ text: transcribeText }) };
  }
  if (url.includes('/voice/tts')) {
    return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
  }
  return { ok: true, json: async () => ({}) };
});

const getUserMediaMock = vi.fn();
function setupNavigator() {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
}

async function speakOneTurn(result: { current: ReturnType<typeof useVoiceIO> }) {
  rmsLevel = 0.1;
  await act(async () => { flushRaf(1); });
  rmsLevel = 0;
  await act(async () => { flushRaf(1); });
  await act(async () => { vi.advanceTimersByTime(20); });
  await act(async () => { flushRaf(1); });
}

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  rafIdCounter = 0;
  rmsLevel = 0;
  recorderChunkSize = 600;
  transcribeText = 'hello';

  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafQueue.push(cb);
    return ++rafIdCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = fetchMock;
  fetchMock.mockClear();

  getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  setupNavigator();

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
    close() { return Promise.resolve(); }
  };

  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FAST_VAD = {
  agentId: 'agent-assistant',
  endSpeechSilenceMs: 5,
  minSpeechMs: 0,
  bargeInGraceMs: 0,
  maxSegmentMs: 60000,
};

describe('JARVIS-RUNTIME-006: Voice Authority Gating & Conversational Coherence', () => {
  it('Requirement B: saying "Jarvis" alone plays brief ack and opens command window WITHOUT submitting to model', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));
    await act(async () => { await result.current.startConversation(); });

    transcribeText = 'Jarvis';
    await speakOneTurn(result);

    // Invariant: "Jarvis" alone is NEVER sent to the model as a prompt
    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(result.current.voiceState).toBe('listening');
  });

  it('Requirement D: active conversation mode permits natural follow-up speech past 8s without wake word, but inactive mode rejects background audio without wake word', async () => {
    const onAutoSubmit = vi.fn();
    const onTranscriptRejected = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit, onTranscriptRejected }));
    await act(async () => { await result.current.startConversation(); });

    // Advance timers past 8s (e.g. 15s pause between turns)
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    // In active conversation mode, natural follow-up speech is accepted without repeating "Jarvis"
    transcribeText = 'What is our revenue target?';
    await speakOneTurn(result);

    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit.mock.calls[0][0]).toBe('What is our revenue target?');

    // Now end conversation mode — speech without wake word must be rejected
    await act(async () => {
      result.current.endConversation();
    });

    onAutoSubmit.mockClear();
    transcribeText = 'Tomorrow on channel 4 news at six';
    await act(async () => {
      // Simulate conversation audio arriving when conversation session is ended
      await result.current.processAudioBlob(new Blob([new Uint8Array(600).fill(1)], { type: 'audio/webm' }), true);
    });

    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(onTranscriptRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'wake_required',
      })
    );
  });

  it('Requirement C: wake word with command in same utterance ("Jarvis, what model are you using?") is AUTHORITATIVE', async () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({ ...FAST_VAD, onAutoSubmit }));
    await act(async () => { await result.current.startConversation(); });

    // Advance past initial window so we test the wake word in the prompt
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    transcribeText = 'Jarvis, what model are you using?';
    await speakOneTurn(result);

    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit.mock.calls[0][0]).toMatch(/what model are you using/i);
  });
});

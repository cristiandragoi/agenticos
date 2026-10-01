import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJarvisVoiceV2 } from '../hooks/useJarvisVoiceV2';

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);
  state = 'inactive';
  ondataavailable: any = null;
  onstop: any = null;
  stream: any;
  mimeType = 'audio/webm';

  constructor(stream: any) {
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

let lastAudio: MockAudio | null = null;
let autoFireOnEnd = true;

class MockAudio {
  src = '';
  paused = true;
  onplay: any = null;
  onended: any = null;
  onerror: any = null;

  pause = vi.fn(function (this: any) {
    this.paused = true;
  });

  removeAttribute = vi.fn(function (this: any, attr: string) {
    if (attr === 'src') this.src = '';
  });

  load = vi.fn();

  play = vi.fn(function (this: any) {
    this.paused = false;
    if (this.src) {
      Promise.resolve().then(() => this.onplay?.());
      if (autoFireOnEnd) {
        Promise.resolve().then(() => Promise.resolve().then(() => this.onended?.()));
      }
    }
    return Promise.resolve();
  });

  constructor(src?: string) {
    if (src) this.src = src;
    lastAudio = this;
  }
}

const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();

describe('useJarvisVoiceV2 — Clean Single-Turn Voice Runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockMediaRecorder.instances = [];
    (globalThis as any).MediaRecorder = MockMediaRecorder;
    (globalThis as any).Audio = MockAudio;
    lastAudio = null;
    autoFireOnEnd = true;

    trackStopMock.mockClear();
    getUserMediaMock.mockReset();
    getUserMediaMock.mockResolvedValue({
      getTracks: () => [{ stop: trackStopMock }],
      getAudioTracks: () => [{ enabled: true, stop: trackStopMock }],
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
          getByteTimeDomainData(d: Uint8Array) { d.fill(128); },
          connect: vi.fn(),
        };
      }
      close() { return Promise.resolve(); }
    };

    (globalThis as any).fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/voice/transcribe')) {
        return { ok: true, json: async () => ({ text: 'What is your name?' }) };
      }
      if (url.includes('/voice/tts')) {
        return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
      }
      return { ok: true, json: async () => ({}) };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('enforces the exact single-turn invariant: 1 STT -> 1 Submit -> 1 TTS -> 1 Play -> IDLE', async () => {
    const onSubmit = vi.fn();
    const onCancelResponse = vi.fn();

    const { result } = renderHook(() =>
      useJarvisVoiceV2({
        agentId: 'agent-jarvis',
        conversationId: 'conv-v2-test',
        onSubmit,
        onCancelResponse,
      })
    );

    expect(result.current.voiceState).toBe('idle');

    // 1. User clicks Start
    await act(async () => {
      await result.current.startTurn();
    });

    expect(result.current.voiceState).toBe('listening');
    expect(MockMediaRecorder.instances.length).toBe(1);

    // 2. User stops speaking / recording stops
    await act(async () => {
      result.current.stopListening();
    });

    // Recording stop triggers cleanup of mic tracks immediately
    expect(trackStopMock).toHaveBeenCalled();

    // STT resolves → user turn is submitted
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.voiceState).toBe('thinking');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('What is your name?', 1);

    // 3. Model finishes and delivers final assistant response
    await act(async () => {
      await result.current.handleAssistantResponse('I am Jarvis, your AI companion.', 1);
    });

    // 4. TTS synthesized and audio played
    expect(lastAudio).not.toBeNull();
    expect(lastAudio?.play).toHaveBeenCalledTimes(1);

    // Drain playback completion
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 5. Invariant: returns to IDLE
    expect(result.current.voiceState).toBe('idle');

    // 6. 15-second quiet test: nothing else happens
    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });

    expect(result.current.voiceState).toBe('idle');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances.length).toBe(1); // No new mic reopened!
  });

  it('stopSpeaking() immediately pauses audio, aborts stream and resets to IDLE', async () => {
    autoFireOnEnd = false; // keep audio playing
    const onSubmit = vi.fn();
    const onCancelResponse = vi.fn();

    const { result } = renderHook(() =>
      useJarvisVoiceV2({
        agentId: 'agent-jarvis',
        onSubmit,
        onCancelResponse,
      })
    );

    await act(async () => {
      await result.current.startTurn();
    });
    await act(async () => {
      result.current.stopListening();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assistant response begins speaking
    let p: Promise<void> = Promise.resolve();
    await act(async () => {
      p = result.current.handleAssistantResponse('This is a very long response that the user will stop.');
    });

    expect(result.current.voiceState).toBe('speaking');
    expect(lastAudio?.paused).toBe(false);

    // Click STOP SPEAKING
    await act(async () => {
      result.current.stopSpeaking();
    });

    expect(lastAudio?.pause).toHaveBeenCalled();
    expect(onCancelResponse).toHaveBeenCalledTimes(1);
    expect(result.current.voiceState).toBe('idle');

    // Ensure late promise does not set state back to speaking
    await act(async () => {
      await p.catch(() => {});
    });
    expect(result.current.voiceState).toBe('idle');
  });
});

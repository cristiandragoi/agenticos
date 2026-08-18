import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * speak() contract: resolves after REAL playback completes (onended) or
 * rejects on playback failure. The mock must therefore emulate the full
 * playback lifecycle: play() → onplay → onended, not just onplay.
 */
describe('useVoiceIO speak logic', () => {
  let playSpy: any;
  let speechSynthesisSpeakSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Full playback lifecycle: onplay (async) then onended (async), so that
    // speak() resolves only after real completion.
    playSpy = vi.fn().mockImplementation(function (this: any) {
      const self = this;
      setTimeout(() => {
        if (self.onplay) self.onplay();
        if (self.onended) self.onended();
      }, 0);
      return Promise.resolve();
    });

    class MockAudio {
      src = '';
      onplay: any = null;
      onended: any = null;
      onerror: any = null;
      play = playSpy;
      pause = vi.fn();
      removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
      load = vi.fn();
    }
    vi.stubGlobal('Audio', MockAudio);

    class MockSpeechSynthesisUtterance {
      onstart: any = null;
      onend: any = null;
      onerror: any = null;
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);

    speechSynthesisSpeakSpy = vi.fn().mockImplementation(function (utterance: any) {
      setTimeout(() => {
        if (utterance.onstart) utterance.onstart();
        if (utterance.onend) utterance.onend();
      }, 0);
    });
    vi.stubGlobal('speechSynthesis', {
      cancel: vi.fn(),
      speak: speechSynthesisSpeakSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls HTMLAudioElement play exactly once on successful TTS fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ audioData: 'test-audio-data' }),
    }));

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Hello world');
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(speechSynthesisSpeakSpy).not.toHaveBeenCalled();
  });

  it('calls fallback speechSynthesis.speak exactly once on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Fallback text');
    });

    expect(playSpy).not.toHaveBeenCalled();
    expect(speechSynthesisSpeakSpy).toHaveBeenCalledTimes(1);
  });

  it('performs no playback after AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Never spoken');
    });

    expect(playSpy).not.toHaveBeenCalled();
    expect(speechSynthesisSpeakSpy).not.toHaveBeenCalled();
  });

  it('does NOT duplicate speech when playback fails (no fallback after successful synthesis)', async () => {
    const rejectingPlay = vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
    class RejectingAudio {
      src = '';
      onplay: any = null;
      onended: any = null;
      onerror: any = null;
      play = rejectingPlay;
      pause = vi.fn();
      removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
      load = vi.fn();
    }
    vi.stubGlobal('Audio', RejectingAudio);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ audioData: 'real-audio-data' }),
    }));

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Spoken once');
    });

    expect(rejectingPlay).toHaveBeenCalledTimes(1);
    expect(speechSynthesisSpeakSpy).not.toHaveBeenCalled();
    expect(result.current.playbackError).toBeTruthy();
    expect(result.current.voiceState).toBe('error');
  });
});

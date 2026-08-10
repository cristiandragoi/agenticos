import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

describe('useVoiceIO speak logic', () => {
  let playSpy: any;
  let speechSynthesisSpeakSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    playSpy = vi.fn().mockImplementation(function(this: any) {
      setTimeout(() => {
        if (this.onplay) this.onplay();
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
      onend: any = null;
      onerror: any = null;
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);

    speechSynthesisSpeakSpy = vi.fn().mockImplementation(function(utterance: any) {
      setTimeout(() => {
        if (utterance.onend) utterance.onend();
      }, 0);
    });
    (window as any).speechSynthesis = {
      cancel: vi.fn(),
      speak: speechSynthesisSpeakSpy,
    };
  });

  it('calls HTMLAudioElement play exactly once on successful TTS fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ audioData: 'test-audio-data' })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Hello world');
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(speechSynthesisSpeakSpy).not.toHaveBeenCalled();
  });

  it('calls fallback speechSynthesis.speak exactly once on fetch failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Fallback text');
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(playSpy).not.toHaveBeenCalled();
    expect(speechSynthesisSpeakSpy).toHaveBeenCalledTimes(1);
  });

  it('performs no playback after AbortError', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Never spoken');
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(playSpy).not.toHaveBeenCalled();
    expect(speechSynthesisSpeakSpy).not.toHaveBeenCalled();
  });

  it('does NOT duplicate speech when playback fails (no fallback after successful synthesis)', async () => {
    // Synthesis succeeds (audioData returned), but play() rejects (autoplay policy).
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

    // play() was attempted exactly once...
    expect(rejectingPlay).toHaveBeenCalledTimes(1);
    // ...and speechSynthesis was NEVER used as a fallback (no duplicate speech).
    expect(speechSynthesisSpeakSpy).not.toHaveBeenCalled();
    // One understandable playback error is surfaced; voice state is error.
    expect(result.current.playbackError).toBeTruthy();
    expect(result.current.voiceState).toBe('error');
  });
});

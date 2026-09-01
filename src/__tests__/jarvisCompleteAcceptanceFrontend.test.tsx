import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

describe('JARVIS COMPLETE STABILIZATION — FRONTEND VOICE ACCEPTANCE', () => {
  let playSpy: any;
  let pauseSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    playSpy = vi.fn().mockResolvedValue(undefined);
    pauseSpy = vi.fn();

    // Mock HTMLMediaElement
    window.HTMLMediaElement.prototype.play = playSpy;
    window.HTMLMediaElement.prototype.pause = pauseSpy;
    window.HTMLMediaElement.prototype.load = vi.fn();

    (window as any).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: vi.fn().mockReturnValue([{ name: 'Test Voice' }]),
    };
    (globalThis as any).SpeechSynthesisUtterance = class {
      text: string;
      onstart: any = null;
      onend: any = null;
      onerror: any = null;
      constructor(t: string) {
        this.text = t;
      }
    };
  });

  // Test C: Background message cannot reach TTS
  it('C. Background messages with non-CONVERSATION channel are rejected from TTS', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    await act(async () => {
      await result.current.speak('Background task completed successfully', 'BACKGROUND_TASK' as any);
    });

    expect(playSpy).not.toHaveBeenCalled();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  // Test C2: Progressive chunks with non-CONVERSATION channel are rejected
  it('C2. Progressive chunks with non-CONVERSATION channel are discarded', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    act(() => {
      result.current.speakProgressive('Background chunk', 'SYSTEM_STATUS' as any);
    });

    expect(playSpy).not.toHaveBeenCalled();
  });

  // Test E: Stop invalidates async TTS
  it('E. Invoking killSpeechNow halts in-flight TTS and prevents playback', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    let resolveFetch: any;
    const fetchPromise = new Promise((res) => {
      resolveFetch = res;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        fetchPromise.then(() => ({
          ok: true,
          json: async () => ({ audioData: 'bW9jaw==' }),
        }))
      )
    );

    let speakPromise: Promise<void>;
    act(() => {
      speakPromise = result.current.speak('Long response that gets cancelled', 'CONVERSATION');
    });

    // Kill speech while fetch is still in-flight
    act(() => {
      result.current.killSpeechNow();
    });

    // Resolve fetch
    await act(async () => {
      resolveFetch();
      await speakPromise!;
    });

    // Playback must NEVER have started
    expect(playSpy).not.toHaveBeenCalled();
  });

  // Test F: Global ESC triggers killSpeechNow
  it('F. Pressing Escape key triggers killSpeechNow and stops all speech immediately', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  // Test G: STOP button triggers killSpeechNow
  it('G. Calling killSpeechNow directly forces silence and state reset', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));

    act(() => {
      result.current.killSpeechNow();
    });

    expect(result.current.voiceState).toBe('idle');
  });
});

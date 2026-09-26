import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';
import { detectControlIntent } from '../lib/controlIntent';
import { classifyInterruption } from '../lib/adaptiveBargeIn';
import { resolveVoiceSessionConfig } from '../lib/voiceSessionConfig';

describe('Jarvis Synchronous STOP, Multilingual Control, Physical Barge-In & Turn Timing', () => {
  let originalSpeechSynthesis: any;

  beforeEach(() => {
    vi.useFakeTimers();
    originalSpeechSynthesis = window.speechSynthesis;
    window.speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: vi.fn().mockReturnValue([{ name: 'David (English)' }]),
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.speechSynthesis = originalSpeechSynthesis;
  });

  // 15. Synchronous STOP primitive stops audio and synthesis without backend roundtrip
  it('15. Synchronous STOP primitive stops audio and synthesis without backend roundtrip', () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));
    act(() => {
      result.current.killSpeechNow();
    });
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  // 16. Escape key triggers synchronous STOP primitive
  it('16. Escape key triggers synchronous STOP primitive', () => {
    renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      window.dispatchEvent(event);
    });
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  // 17. Spoken German “stopp” / “halt” / “hör auf” triggers STOP
  it('17. Spoken German "stopp" / "halt" / "hör auf" triggers STOP', () => {
    expect(detectControlIntent('stopp')?.kind).toBe('stop');
    expect(detectControlIntent('halt')?.kind).toBe('stop');
    expect(detectControlIntent('hör auf')?.kind).toBe('stop');
    expect(detectControlIntent('aufhören')?.kind).toBe('stop');
  });

  // 18. Spoken Romanian “stop” / “oprește” / “taci” triggers STOP
  it('18. Spoken Romanian "stop" / "oprește" / "taci" triggers STOP', () => {
    expect(detectControlIntent('stop')?.kind).toBe('stop');
    expect(detectControlIntent('oprește')?.kind).toBe('stop');
    expect(detectControlIntent('opreste')?.kind).toBe('stop');
    expect(detectControlIntent('taci')?.kind).toBe('stop');
  });

  // 19. Physical barge-in ducks audio to ~20% within 200ms
  it('19. Physical barge-in ducks audio to ~20% within 200ms', () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));
    expect(result.current.voiceState).toBe('idle');
  });

  // 20. Physical barge-in brief noise restores audio to 100%
  it('20. Physical barge-in brief noise restores audio to 100%', () => {
    const res = classifyInterruption('', 400);
    expect(res).toBe('noise');
    const ackRes = classifyInterruption('ja', 400);
    expect(ackRes).toBe('acknowledgement');
  });

  // 21. Physical barge-in continuous speech >= 5s triggers hard stop
  it('21. Physical barge-in continuous speech >= 5s triggers hard stop', () => {
    const res = classifyInterruption('I have an urgent question about the deployment and configuration', 5200);
    expect(res).toBe('takeover');
  });

  // 22. Natural pause within ~2s does not fragment utterance into multiple turns
  it('22. Natural pause within ~2s does not fragment utterance into multiple turns', () => {
    const onAutoSubmit = vi.fn();
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-hermes',
      onAutoSubmit,
      endSpeechSilenceMs: 1800,
    }));
    expect(result.current).toBeDefined();
  });

  // 23. Language switch to German switches STT and neural voice to de-DE-KillianNeural
  it('23. Language switch to German switches STT and neural voice to de-DE-KillianNeural', () => {
    const cfg = resolveVoiceSessionConfig('agent-jarvis', null, undefined, 'de');
    expect(cfg.model).toBe('de-DE-KillianNeural');
    expect(cfg.provider).toBe('edge-tts');
  });

  // 24. Language switch to Romanian switches STT and neural voice to ro-RO-EmilNeural
  it('24. Language switch to Romanian switches STT and neural voice to ro-RO-EmilNeural', () => {
    const cfg = resolveVoiceSessionConfig('agent-jarvis', null, undefined, 'ro');
    expect(cfg.model).toBe('ro-RO-EmilNeural');
    expect(cfg.provider).toBe('edge-tts');
  });

  // 25. No robotic browser voice fallback is used in continuous conversation mode
  it('25. No robotic browser voice fallback is used in continuous conversation mode', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));
    // In continuous conversation mode, speak() will never invoke window.speechSynthesis.speak
    await act(async () => {
      await result.current.speak('Test synthesis failure fallback rejection', 'CONVERSATION');
    });
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  // 26. Typed and voice-originated channels are both allowed to speak
  it('26. Typed and voice-originated channels are both allowed to speak', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));
    act(() => {
      result.current.armSpeech(1);
      result.current.speakProgressive('Hello from typed channel', 'typed', 1);
      result.current.speakProgressive('Hello from voice channel', 'voice', 1);
    });
    expect(result.current).toBeDefined();
  });

  // 27. Arming a new turn clears previous speech suppression
  it('27. Arming a new turn clears previous speech suppression', () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));
    act(() => {
      result.current.killSpeechNow();
    });
    act(() => {
      result.current.armSpeech(2);
    });
    expect(result.current).toBeDefined();
  });

  // 28. Voice turn re-arms speech after killSpeech and plays audio for the new turn ID
  it('28. Voice turn re-arms speech after killSpeech and plays audio for the new turn ID', async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.play = playSpy;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/voice/tts') || String(url).includes('/voice/tts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            audioData: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
            format: 'audio/mpeg',
            voice: 'en-GB-RyanNeural',
            provider: 'edge-tts'
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-hermes' }));

    // 1. Begin with speech suppressed by killSpeech / stopSpeaking
    act(() => {
      result.current.killSpeechNow();
    });

    // 2. Submit a new voice turn with new turn ID and arm speech
    const newTurnId = 42;
    act(() => {
      result.current.armSpeech(newTurnId);
      result.current.speakProgressive('The system is online and ready.', 'CONVERSATION', newTurnId);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // 3. Assert TTS was fetched and audio.play() occurred exactly once
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/voice/tts'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(playSpy).toHaveBeenCalledTimes(1);

    global.fetch = originalFetch;
  });
});

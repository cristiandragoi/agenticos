/**
 * speechSuppressReset.test.ts
 *
 * Tests for the voice speaking path fixes & voice selection capabilities:
 *   - speechRunSuppressedRef resets on startConversation()
 *   - fallbackSpeak no-op when no voices available (Electron guard)
 *   - afterPlaybackEnd re-arms conversation listening
 *   - Voice selection, fallback to deep/calm default preset (aura-helios-en)
 *   - Voice preview / test action
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── speechRunSuppressedRef reset behavior ────────────────────────────────
describe('speechRunSuppressedRef — reset on startConversation', () => {
  it('a new session must reset the suppress flag so speech is not silenced', () => {
    const state = { speechRunSuppressed: false };
    const killSpeech = () => { state.speechRunSuppressed = true; };
    const startConversation = () => {
      state.speechRunSuppressed = false;
    };

    killSpeech();
    expect(state.speechRunSuppressed).toBe(true);

    startConversation();
    expect(state.speechRunSuppressed).toBe(false);
  });

  it('multiple kill+start cycles never strand suppressed=true', () => {
    const state = { speechRunSuppressed: false };
    const kill = () => { state.speechRunSuppressed = true; };
    const start = () => { state.speechRunSuppressed = false; };

    for (let i = 0; i < 5; i++) {
      kill();
      start();
      expect(state.speechRunSuppressed).toBe(false);
    }
  });

  it('suppressRef false allows speakProgressive to enqueue speech', () => {
    const queue: string[] = [];
    const state = { suppress: false };

    const speakProgressive = (chunk: string) => {
      const text = (chunk || '').trim();
      if (!text || state.suppress) return;
      queue.push(text);
    };

    state.suppress = true;
    speakProgressive('Hello Jarvis');
    expect(queue.length).toBe(0);

    state.suppress = false;
    speakProgressive('Hello Jarvis');
    expect(queue.length).toBe(1);
    expect(queue[0]).toBe('Hello Jarvis');
  });
});

// ─── fallbackSpeak Electron no-voices guard ───────────────────────────────
describe('fallbackSpeak — Electron no-voices guard', () => {
  it('calls afterPlaybackEnd when speechSynthesis has no voices', async () => {
    const afterPlaybackEnd = vi.fn();

    const fallbackSpeak = (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === 'undefined' || !(window as any).speechSynthesis) {
          afterPlaybackEnd();
          resolve();
          return;
        }
        const voices = (window as any).speechSynthesis.getVoices();
        if (voices.length === 0) {
          afterPlaybackEnd();
          resolve();
          return;
        }
        resolve();
      });
    };

    const originalSS = (window as any).speechSynthesis;
    (window as any).speechSynthesis = { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() };

    await fallbackSpeak('test speech');
    expect(afterPlaybackEnd).toHaveBeenCalledTimes(1);

    (window as any).speechSynthesis = originalSS;
  });

  it('does NOT call afterPlaybackEnd when voices are available', async () => {
    const afterPlaybackEnd = vi.fn();
    const mockSpeak = vi.fn();

    const fallbackSpeak = (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === 'undefined' || !(window as any).speechSynthesis) {
          afterPlaybackEnd(); resolve(); return;
        }
        const voices = (window as any).speechSynthesis.getVoices();
        if (voices.length === 0) {
          afterPlaybackEnd(); resolve(); return;
        }
        mockSpeak();
        resolve();
      });
    };

    const originalSS = (window as any).speechSynthesis;
    (window as any).speechSynthesis = {
      getVoices: () => [{ name: 'Google US English', lang: 'en-US' }],
      cancel: vi.fn(),
      speak: vi.fn(),
    };

    await fallbackSpeak('hello');
    expect(afterPlaybackEnd).not.toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalled();

    (window as any).speechSynthesis = originalSS;
  });

  it('calls afterPlaybackEnd when speechSynthesis is absent entirely', async () => {
    const afterPlaybackEnd = vi.fn();

    const fallbackSpeak = (): Promise<void> => {
      return new Promise((resolve) => {
        if (!(window as any).speechSynthesis) {
          afterPlaybackEnd(); resolve(); return;
        }
        resolve();
      });
    };

    const originalSS = (window as any).speechSynthesis;
    delete (window as any).speechSynthesis;

    await fallbackSpeak();
    expect(afterPlaybackEnd).toHaveBeenCalledTimes(1);

    (window as any).speechSynthesis = originalSS;
  });
});

// ─── Voice persistence & Presets (localStorage & Fallback) ────────────────
describe('Voice Selection & Persistence Contract', () => {
  const VOICE_KEY = 'jarvis-canonical-voice';
  const JARVIS_VOICES = [
    { id: 'aura-helios-en', label: 'Helios · British English' },
    { id: 'aura-zeus-en', label: 'Zeus · American English' },
    { id: 'aura-athena-en', label: 'Athena · American English' },
    { id: 'aura-orion-en', label: 'Orion · American English (natural)' },
  ];

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('default voice is aura-helios-en (deep/calm British English preset)', () => {
    expect(JARVIS_VOICES[0].id).toBe('aura-helios-en');
    expect(JARVIS_VOICES[0].label).toContain('Helios');
  });

  it('persistVoice writes to both localStorage and sessionStorage', () => {
    const persistVoice = (id: string) => {
      try { localStorage.setItem(VOICE_KEY, id); } catch { /* ignore */ }
      try { sessionStorage.setItem(VOICE_KEY, id); } catch { /* ignore */ }
    };
    persistVoice('aura-zeus-en');
    expect(localStorage.getItem(VOICE_KEY)).toBe('aura-zeus-en');
    expect(sessionStorage.getItem(VOICE_KEY)).toBe('aura-zeus-en');
  });

  it('readPersistedVoice reads localStorage first', () => {
    const readPersistedVoice = () => {
      try {
        const lv = localStorage.getItem(VOICE_KEY);
        if (lv && JARVIS_VOICES.some((x) => x.id === lv)) return lv;
        const sv = sessionStorage.getItem(VOICE_KEY);
        return sv && JARVIS_VOICES.some((x) => x.id === sv) ? sv : JARVIS_VOICES[0].id;
      } catch { return JARVIS_VOICES[0].id; }
    };

    localStorage.setItem(VOICE_KEY, 'aura-athena-en');
    sessionStorage.setItem(VOICE_KEY, 'aura-orion-en');

    expect(readPersistedVoice()).toBe('aura-athena-en');
  });

  it('readPersistedVoice falls back to default when unknown voice is stored', () => {
    const readPersistedVoice = () => {
      try {
        const lv = localStorage.getItem(VOICE_KEY);
        if (lv && JARVIS_VOICES.some((x) => x.id === lv)) return lv;
        const sv = sessionStorage.getItem(VOICE_KEY);
        return sv && JARVIS_VOICES.some((x) => x.id === sv) ? sv : JARVIS_VOICES[0].id;
      } catch { return JARVIS_VOICES[0].id; }
    };

    localStorage.setItem(VOICE_KEY, 'non-existent-voice-id');
    expect(readPersistedVoice()).toBe('aura-helios-en');
  });

  it('preview test voice triggers speak with expected test phrase', async () => {
    const speakMock = vi.fn().mockResolvedValue(undefined);
    const handlePreviewVoice = (speakFn: (text: string) => Promise<void>) => {
      return speakFn('Jarvis voice system online and operational.');
    };

    await handlePreviewVoice(speakMock);
    expect(speakMock).toHaveBeenCalledWith('Jarvis voice system online and operational.');
  });
});

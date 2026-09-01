import { describe, it, expect } from 'vitest';
import {
  resolveVoiceForLanguage,
  resolveLocaleForLanguage,
  verifySpeechSynthesisAvailability,
  DEFAULT_NEURAL_VOICE,
  GERMAN_NEURAL_VOICE,
  ROMANIAN_NEURAL_VOICE,
  synthesizeLocally,
  isVoiceCompatible,
} from '../services/voice/localTts.js';
import { isSubstantiveLanguageDetection } from '../domains/jarvis/conversationLanguage.js';

describe('Jarvis Authoritative Voice Resolution & Separation', () => {
  it('A: Default English voice is verified British male neural voice', () => {
    expect(DEFAULT_NEURAL_VOICE).toBe('en-GB-RyanNeural');
    expect(resolveVoiceForLanguage('en')).toBe('en-GB-RyanNeural');
    expect(resolveLocaleForLanguage('en')).toBe('en-GB');
  });

  it('B: Deepgram aura-* voice identifiers are never passed to Edge TTS', () => {
    // When aura-helios-en is requested for Edge TTS, it resolves to default British neural voice
    const resolved = resolveVoiceForLanguage('en', 'aura-helios-en');
    expect(resolved).toBe('en-GB-RyanNeural');
    expect(resolved).not.toContain('aura');

    const resolvedDe = resolveVoiceForLanguage('de', 'aura-helios-en');
    expect(resolvedDe).toBe('de-DE-KillianNeural');
    expect(resolvedDe).not.toContain('aura');

    const resolvedRo = resolveVoiceForLanguage('ro', 'aura-helios-en');
    expect(resolvedRo).toBe('ro-RO-EmilNeural');
    expect(resolvedRo).not.toContain('aura');
  });

  it('C: German and Romanian resolve to natural male neural voices', () => {
    expect(GERMAN_NEURAL_VOICE).toBe('de-DE-KillianNeural');
    expect(resolveVoiceForLanguage('de')).toBe('de-DE-KillianNeural');
    expect(resolveLocaleForLanguage('de')).toBe('de-DE');

    expect(ROMANIAN_NEURAL_VOICE).toBe('ro-RO-EmilNeural');
    expect(resolveVoiceForLanguage('ro')).toBe('ro-RO-EmilNeural');
    expect(resolveLocaleForLanguage('ro')).toBe('ro-RO');
  });

  it('D: Incompatible voice overrides are rejected and discarded for that turn', () => {
    // An English voice requested for German text must NOT be used
    expect(resolveVoiceForLanguage('de', 'en-GB-RyanNeural')).toBe('de-DE-KillianNeural');
    expect(resolveVoiceForLanguage('de', 'en-GB-ThomasNeural')).toBe('de-DE-KillianNeural');
    expect(resolveVoiceForLanguage('de', 'en-US-ChristopherNeural')).toBe('de-DE-KillianNeural');

    // An English voice requested for Romanian text must NOT be used
    expect(resolveVoiceForLanguage('ro', 'en-GB-RyanNeural')).toBe('ro-RO-EmilNeural');
    expect(resolveVoiceForLanguage('ro', 'en-GB-ThomasNeural')).toBe('ro-RO-EmilNeural');

    // A German voice requested for English text must NOT be used
    expect(resolveVoiceForLanguage('en', 'de-DE-KillianNeural')).toBe('en-GB-RyanNeural');
    expect(resolveVoiceForLanguage('en', 'de-DE-ConradNeural')).toBe('en-GB-RyanNeural');

    // A Romanian voice requested for German or English text must NOT be used
    expect(resolveVoiceForLanguage('de', 'ro-RO-EmilNeural')).toBe('de-DE-KillianNeural');
    expect(resolveVoiceForLanguage('en', 'ro-RO-EmilNeural')).toBe('en-GB-RyanNeural');

    // Compatible overrides are preserved
    expect(resolveVoiceForLanguage('de', 'de-DE-ConradNeural')).toBe('de-DE-ConradNeural');
    expect(resolveVoiceForLanguage('ro', 'ro-RO-AlinaNeural')).toBe('ro-RO-AlinaNeural');
    expect(resolveVoiceForLanguage('en', 'en-GB-ThomasNeural')).toBe('en-GB-ThomasNeural');
  });

  it('E: Automatic STT language detection only accepts substantive, confident utterances', () => {
    // Short ambiguous words or names must NOT trigger a language switch
    expect(isSubstantiveLanguageDetection('Jarvis', 'de')).toBe(false);
    expect(isSubstantiveLanguageDetection('Alex', 'ro')).toBe(false);
    expect(isSubstantiveLanguageDetection('Ok', 'de')).toBe(false);
    expect(isSubstantiveLanguageDetection('Hi', 'ro')).toBe(false);
    expect(isSubstantiveLanguageDetection('Hello', 'de')).toBe(false);

    // Low confidence detections must NOT trigger a switch
    expect(isSubstantiveLanguageDetection('This is a longer test sentence', 'de', 0.35)).toBe(false);

    // Substantive German sentences MUST trigger a switch
    expect(isSubstantiveLanguageDetection('Wie ist der aktuelle Status von AgenticOS?', 'de', 0.95)).toBe(true);
    expect(isSubstantiveLanguageDetection('Guten Morgen Jarvis, bitte erstelle ein neues Projekt.', 'de', 0.90)).toBe(true);
    expect(isSubstantiveLanguageDetection('Sprich bitte ab jetzt auf Deutsch.', 'de')).toBe(true);

    // Substantive Romanian sentences MUST trigger a switch
    expect(isSubstantiveLanguageDetection('Care este starea actuală a AgenticOS?', 'ro', 0.95)).toBe(true);
    expect(isSubstantiveLanguageDetection('Bună dimineața Jarvis, configurează te rog noul proiect.', 'ro', 0.90)).toBe(true);
    expect(isSubstantiveLanguageDetection('Vorbește în limba română.', 'ro')).toBe(true);
  });

  it('F: Truthful TTS health status reports available for verified voices', async () => {
    const enProbe = await verifySpeechSynthesisAvailability('en-GB-RyanNeural');
    expect(enProbe.available).toBe(true);

    const deProbe = await verifySpeechSynthesisAvailability('de-DE-KillianNeural');
    expect(deProbe.available).toBe(true);

    const roProbe = await verifySpeechSynthesisAvailability('ro-RO-EmilNeural');
    expect(roProbe.available).toBe(true);
  });

  it('G: Real MP3 synthesis produces non-empty audio buffers for EN, DE, RO', async () => {
    const enBuffer = await synthesizeLocally('Hello, I am Jarvis.', 'en-GB-RyanNeural');
    expect(enBuffer).toBeInstanceOf(Buffer);
    expect(enBuffer.length).toBeGreaterThan(1000);

    const deBuffer = await synthesizeLocally('Guten Tag, ich bin Jarvis.', 'de-DE-KillianNeural');
    expect(deBuffer).toBeInstanceOf(Buffer);
    expect(deBuffer.length).toBeGreaterThan(1000);

    const roBuffer = await synthesizeLocally('Salut, sunt Jarvis.', 'ro-RO-EmilNeural');
    expect(roBuffer).toBeInstanceOf(Buffer);
    expect(roBuffer.length).toBeGreaterThan(1000);
  }, 30000);
});

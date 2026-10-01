import { describe, it, expect } from 'vitest';
import { isMeaningfulSpeech } from '../services/voice/localTranscribe.js';

describe('isMeaningfulSpeech validation gate', () => {
  it('rejects empty, null, undefined, or whitespace-only inputs', () => {
    expect(isMeaningfulSpeech('')).toBe(false);
    expect(isMeaningfulSpeech(null)).toBe(false);
    expect(isMeaningfulSpeech(undefined)).toBe(false);
    expect(isMeaningfulSpeech('   \n\t  ')).toBe(false);
  });

  it('rejects pure punctuation and non-alphanumeric noise', () => {
    expect(isMeaningfulSpeech('...')).toBe(false);
    expect(isMeaningfulSpeech('?! - ...')).toBe(false);
    expect(isMeaningfulSpeech('***')).toBe(false);
  });

  it('rejects audio tag tokens emitted on non-speech sound', () => {
    expect(isMeaningfulSpeech('[music]')).toBe(false);
    expect(isMeaningfulSpeech('(applause)')).toBe(false);
    expect(isMeaningfulSpeech('<silence>')).toBe(false);
    expect(isMeaningfulSpeech('[cough]')).toBe(false);
  });

  it('rejects known silence hallucination phrases', () => {
    expect(isMeaningfulSpeech('Thank you for watching.')).toBe(false);
    expect(isMeaningfulSpeech('thanks for watching')).toBe(false);
    expect(isMeaningfulSpeech('subtitles by')).toBe(false);
    expect(isMeaningfulSpeech('amara org')).toBe(false);
    expect(isMeaningfulSpeech('see you in the next video')).toBe(false);
  });

  it('rejects common noise and filler tokens', () => {
    expect(isMeaningfulSpeech('uh')).toBe(false);
    expect(isMeaningfulSpeech('um')).toBe(false);
    expect(isMeaningfulSpeech('hmm')).toBe(false);
    expect(isMeaningfulSpeech('mhm')).toBe(false);
    expect(isMeaningfulSpeech('huh')).toBe(false);
  });

  it('rejects single non-word characters from clicks/pops', () => {
    expect(isMeaningfulSpeech('s')).toBe(false);
    expect(isMeaningfulSpeech('t')).toBe(false);
    expect(isMeaningfulSpeech('x')).toBe(false);
  });

  describe('Deepgram confidence gating', () => {
    it('hard-rejects any transcription with Deepgram confidence < 0.3', () => {
      expect(
        isMeaningfulSpeech('Please open my latest project', {
          deepgramConfidence: 0.28,
        })
      ).toBe(false);
    });

    it('soft-rejects short phrases (<=3 words) with Deepgram confidence < 0.5', () => {
      expect(
        isMeaningfulSpeech('Open the file', {
          deepgramConfidence: 0.45,
          wordCount: 3,
        })
      ).toBe(false);

      expect(
        isMeaningfulSpeech('Hello Jarvis', {
          deepgramConfidence: 0.42,
        })
      ).toBe(false);
    });

    it('accepts short phrases when Deepgram confidence is high (>= 0.5)', () => {
      expect(
        isMeaningfulSpeech('Open the file', {
          deepgramConfidence: 0.88,
          wordCount: 3,
        })
      ).toBe(true);

      expect(
        isMeaningfulSpeech('Hello Jarvis', {
          deepgramConfidence: 0.95,
        })
      ).toBe(true);
    });

    it('accepts longer phrases (>3 words) with moderate confidence (>= 0.3)', () => {
      expect(
        isMeaningfulSpeech('Can you please check the build output', {
          deepgramConfidence: 0.42,
          wordCount: 7,
        })
      ).toBe(true);
    });
  });

  describe('Audio duration gating', () => {
    it('rejects audio segments shorter than 0.3 seconds', () => {
      expect(
        isMeaningfulSpeech('test', {
          audioDurationSec: 0.22,
          deepgramConfidence: 0.85,
        })
      ).toBe(false);
    });

    it('accepts audio segments >= 0.3 seconds with valid speech', () => {
      expect(
        isMeaningfulSpeech('Deploy the current build', {
          audioDurationSec: 1.45,
          deepgramConfidence: 0.92,
        })
      ).toBe(true);
    });
  });

  describe('Whisper noSpeechProb gating', () => {
    it('rejects when noSpeechProb > 0.45', () => {
      expect(
        isMeaningfulSpeech('Some random words', {
          noSpeechProb: 0.75,
        })
      ).toBe(false);
    });

    it('accepts when noSpeechProb <= 0.45 and speech is genuine', () => {
      expect(
        isMeaningfulSpeech('Explain the architecture', {
          noSpeechProb: 0.12,
        })
      ).toBe(true);
    });
  });

  it('accepts clear valid speech inputs', () => {
    expect(isMeaningfulSpeech('What is the current system status?')).toBe(true);
    expect(isMeaningfulSpeech('Run the test suite now')).toBe(true);
    expect(isMeaningfulSpeech('I need assistance with this function')).toBe(true);
  });
});

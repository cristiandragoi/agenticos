import { describe, it, expect, beforeEach } from 'vitest';
import { emailService } from '../services/email/EmailService.js';
import { setActiveLanguageState } from '../services/language/activeLanguageState.js';

describe('Gmail Recognition & Default Browser Opening', () => {
  beforeEach(() => {
    setActiveLanguageState('de');
  });

  const openPhrases = [
    'Jarvis, bitte eröffnen ein mein Gmail',
    'Öffne bitte mein Gmail',
    'Mach mal Gmail auf',
    'Öffne Gmail christiandragoi@gmail.com',
    'mach auf mein Gmail',
    'mach auf Gmail',
    'zeig mein Gmail',
    'zeig mir mal meine E-Mails',
    'open my mail',
    'eröffne mein Postfach',
    'christiandragoi@gmail.com bitte öffnen',
  ];

  for (const phrase of openPhrases) {
    it(`correctly recognizes open email for: "${phrase}"`, async () => {
      const convId = `test-gmail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const res = await emailService.handleTurn({
        prompt: phrase,
        conversationId: convId,
        lang: 'de',
      });

      expect(res).not.toBeNull();
      expect(res!.success).toBe(true);
      expect(res!.action).toBe('OPEN');
      expect(res!.outputText).toMatch(/(?:Gmail im Browser geöffnet|deine E-Mails im Browser geöffnet)/i);
      // Must use "du" / informal German and NEVER "Sie" or "Ihnen"
      expect(res!.outputText).not.toMatch(/\b(?:Sie|Ihnen|Ihr|Ihre)\b/);
      // Must NEVER claim no access
      expect(res!.outputText).not.toMatch(/keinen Zugriff/i);
    });
  }

  it('correctly handles compound open and draft request', async () => {
    const convId = `test-compound-${Date.now()}`;
    const res = await emailService.handleTurn({
      prompt: 'Öffne Gmail und erstelle einen Entwurf an test@example.com mit Betreff Hallo und Text Schönen Tag',
      conversationId: convId,
      lang: 'de',
    });

    expect(res).not.toBeNull();
    expect(res!.success).toBe(true);
    expect(res!.action).toBe('DRAFT');
    expect(res!.outputText).toContain('Gmail im Browser geöffnet');
    expect(res!.outputText).toContain('test@example.com');
    expect(res!.outputText).not.toMatch(/\b(?:Sie|Ihnen|Ihr|Ihre)\b/);
  });
});

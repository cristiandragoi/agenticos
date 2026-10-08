import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emailService } from '../services/email/EmailService.js';
import { setActiveLanguageState } from '../services/language/activeLanguageState.js';
import { getActiveDesktopTask, clearActiveDesktopTask } from '../domains/turnLifecycle/taskState.js';

describe('Gmail Continuation & Spoken Recipient Recovery', () => {
  beforeEach(() => {
    setActiveLanguageState('de');
    clearActiveDesktopTask();
  });

  it('normalizes spoken email addresses from speech-to-text correctly', () => {
    const cases = [
      { input: 'CD International Project at Gmail.com', expected: 'cdinternationalproject@gmail.com' },
      { input: 'an CD International Project at Gmail.com', expected: 'cdinternationalproject@gmail.com' },
      { input: 'john dot doe at gmail dot com', expected: 'john.doe@gmail.com' },
      { input: 'max at web punkt de', expected: 'max@web.de' },
      { input: 'info at company dot org', expected: 'info@company.org' },
      { input: 'test.user@gmail.com', expected: 'test.user@gmail.com' },
    ];

    for (const c of cases) {
      const res = emailService.normalizeSpokenEmailAddress(c.input);
      expect(res.email).toBe(c.expected);
      expect(res.isAmbiguous).toBe(false);
    }
  });

  it('detects ambiguous recipient names without domains and flags them for confirmation', () => {
    const res = emailService.normalizeSpokenEmailAddress('CD International Project');
    expect(res.email).toBeNull();
    expect(res.isAmbiguous).toBe(true);
    expect(res.candidate).toBe('CD International Project');
  });

  it('executes full real-world Gmail continuation flow without delegating to Hermes', async () => {
    const convId = `conv-gmail-continuation-${Date.now()}`;

    // ── TURN 1: User asks to open Gmail in Comet and compose a new email ──
    const turn1Res = await emailService.handleTurn({
      prompt: 'Jarvis, öffne meine Gmail in Comet Perplexity Browser und erstelle eine neue E-Mail.',
      conversationId: convId,
      lang: 'de',
    });

    expect(turn1Res).not.toBeNull();
    expect(turn1Res!.success).toBe(true);
    expect(turn1Res!.action).toBe('DRAFT');
    expect(turn1Res!.outputText).toContain('An wen soll die E-Mail gehen?');

    const draftAfterTurn1 = emailService.getActiveDraft(convId);
    expect(draftAfterTurn1).toBeDefined();
    expect(draftAfterTurn1!.status).toBe('AWAITING_RECIPIENT_ADDRESS');

    const desktopTask = getActiveDesktopTask(convId);
    expect(desktopTask).toBeDefined();
    expect(desktopTask!.type).toBe('COMPOSE_EMAIL');

    // ── TURN 2: User answers with spoken recipient: "CD International Project at Gmail.com" ──
    const turn2Res = await emailService.handleTurn({
      prompt: 'CD International Project at Gmail.com',
      conversationId: convId,
      lang: 'de',
    });

    expect(turn2Res).not.toBeNull();
    expect(turn2Res!.success).toBe(true);
    expect(turn2Res!.action).toBe('DRAFT');
    expect(turn2Res!.outputText).toContain('cdinternationalproject@gmail.com');
    expect(turn2Res!.outputText).toContain('Sag „Sende es“');
    // Must NEVER claim Hermes or project delegation
    expect(turn2Res!.outputText).not.toMatch(/hermes/i);
    expect(turn2Res!.outputText).not.toMatch(/delegated that task/i);

    const draftAfterTurn2 = emailService.getActiveDraft(convId);
    expect(draftAfterTurn2!.to).toBe('cdinternationalproject@gmail.com');
    expect(draftAfterTurn2!.status).toBe('AWAITING_SEND_COMMAND');

    // ── TURN 3: User says "Sende es" -> Displays review, must NOT send without explicit "ja" ──
    const turn3Res = await emailService.handleTurn({
      prompt: 'Sende es',
      conversationId: convId,
      lang: 'de',
    });

    expect(turn3Res).not.toBeNull();
    expect(turn3Res!.success).toBe(true);
    expect(turn3Res!.action).toBe('REVIEW');
    expect(turn3Res!.outputText).toContain('Möchtest du diese E-Mail jetzt senden?');

    const draftAfterTurn3 = emailService.getActiveDraft(convId);
    expect(draftAfterTurn3!.status).toBe('AWAITING_YES');
  });

  it('handles ambiguous recipient name by asking for confirmation without dropping context', async () => {
    const convId = `conv-ambig-${Date.now()}`;

    // Prepare draft awaiting recipient
    emailService.prepareDraft({
      rawPrompt: 'Schreib eine E-Mail',
      conversationId: convId,
      lang: 'de',
    });

    const res = await emailService.handleTurn({
      prompt: 'CD International Project',
      conversationId: convId,
      lang: 'de',
    });

    expect(res).not.toBeNull();
    expect(res!.success).toBe(true);
    expect(res!.outputText).toContain('Soll die E-Mail an „CD International Project“ gehen?');
    expect(res!.outputText).toContain('Bitte nenne mir die vollständige E-Mail-Adresse');

    const draft = emailService.getActiveDraft(convId);
    expect(draft!.status).toBe('AWAITING_RECIPIENT_ADDRESS');
  });

  it('allows user cancellation cleanly without leaving stranded active tasks', async () => {
    const convId = `conv-cancel-${Date.now()}`;

    emailService.prepareDraft({
      rawPrompt: 'Schreib eine E-Mail',
      conversationId: convId,
      lang: 'de',
    });

    const res = await emailService.handleTurn({
      prompt: 'Abbrechen',
      conversationId: convId,
      lang: 'de',
    });

    expect(res).not.toBeNull();
    expect(res!.success).toBe(true);
    expect(res!.outputText).toBe('E-Mail-Entwurf abgebrochen.');
    expect(emailService.getActiveDraft(convId)).toBeNull();
    expect(getActiveDesktopTask(convId)).toBeNull();
  });
});

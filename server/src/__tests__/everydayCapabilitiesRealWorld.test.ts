import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { detectLanguageSwitchRequest, setConversationLanguage, getConversationLanguage } from '../domains/jarvis/conversationLanguage.js';
import { voiceRuntimeState } from '../services/voice/VoiceRuntimeState.js';
import { synthesizeLocally } from '../services/voice/localTts.js';
import { documentReaderService } from '../services/perception/DocumentReaderService.js';
import { emailService } from '../services/email/EmailService.js';
import { conversationCapabilityAdapter } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import { appCapabilityAdapter } from '../domains/controlPlane/adapters/AppCapabilityAdapter.js';
import { perceptionCapabilityAdapter } from '../domains/controlPlane/adapters/PerceptionCapabilityAdapter.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';

describe('Real-World Everyday Capabilities: Document Reading, German Voice, Email', () => {
  const conversationId = `conv-realworld-${Date.now()}`;

  beforeEach(() => {
    authoritativeInteractionContext.resetContext();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Reading a document or passport
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Document & Passport Reading via Local Windows Media OCR', () => {
    it('accurately extracts text from a sample document image using Windows Media OCR', async () => {
      // Create a harmless sample document image or use existing uploaded sample
      const sampleImagePath = 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\8e12ac2f-00b9-4c0b-b652-f287a547c40a\\.user_uploaded\\media_1791371669765.png';
      
      const result = await documentReaderService.readFromFile(sampleImagePath);
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.extractedText).toContain('STEP 2A');
      expect(result.extractedText.length).toBeGreaterThan(5);
      expect(result.explanation).toContain('Here is the text extracted');
      expect(result.structuredLines).toBeDefined();
    });

    it('explains the specific problem truthfully when a document file does not exist', async () => {
      const result = await documentReaderService.readFromFile('nonexistent_passport_sample.png');
      expect(result.success).toBe(false);
      expect(result.specificIssue).toBe('FILE_NOT_FOUND');
      expect(result.explanation).toMatch(/was not found/i);
      expect(result.explanation).not.toMatch(/cannot interpret documents/i);
    });

    it('compiles document and passport reading utterances to DOCUMENT_CONTENT action', () => {
      const docIntent = AuthoritativeIntentCompiler.compile('Read this document');
      expect(docIntent.action).toBe('READ_CONTENT');
      expect(docIntent.targetType).toBe('DOCUMENT_CONTENT');
      expect(docIntent.target).toBe('document');

      const passportIntent = AuthoritativeIntentCompiler.compile('Read my passport');
      expect(passportIntent.action).toBe('READ_CONTENT');
      expect(passportIntent.targetType).toBe('DOCUMENT_CONTENT');
      expect(passportIntent.target).toBe('passport');

      const fileIntent = AuthoritativeIntentCompiler.compile('Read contract.pdf');
      expect(fileIntent.action).toBe('READ_CONTENT');
      expect(fileIntent.targetType).toBe('DOCUMENT_CONTENT');
      expect(fileIntent.target).toBe('contract.pdf');
    });

    it('when shown to camera but text is unreadable or closed, explains specific cause rather than generic refusal', async () => {
      // Mock camera frame with empty text
      vi.spyOn(documentReaderService, 'ocrImageFile').mockResolvedValueOnce({
        text: '',
        rawOutput: '',
      });

      const result = await documentReaderService.readFromCamera('Read this document');
      expect(result.success).toBe(false);
      expect(result.specificIssue).toBe('TEXT_BLURRY_OR_EMPTY');
      expect(result.explanation).toMatch(/no readable text was detected|blurry|out of focus|closed/i);
      expect(result.explanation).not.toMatch(/cannot interpret documents/i);
    });

    it('PerceptionCapabilityAdapter dispatches document reading and records verified perception', async () => {
      const step = AuthoritativeIntentCompiler.compile('Read this document');
      const stepResult = await perceptionCapabilityAdapter.readContent(step, 'doc-step-1', conversationId);

      // Even if webcam has no readable paper in front of it right now, it reports the truthful diagnostic
      expect(stepResult.action).toBe('READ_CONTENT');
      expect(stepResult.outputText).toMatch(/document|camera|blurry|focus/i);
      expect(stepResult.outputText).not.toMatch(/cannot interpret documents/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Speaking fluent German
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. German Language Switching & Natural Speech with Thorsten Voice', () => {
    it('detects "Sprich bitte ab jetzt Deutsch" and switches conversation language to German', () => {
      const req = detectLanguageSwitchRequest('Sprich bitte ab jetzt Deutsch');
      expect(req.isLanguageSwitch).toBe(true);
      expect(req.targetLanguage).toBe('de');

      const req2 = detectLanguageSwitchRequest('Bitte sprich ab jetzt Deutsch');
      expect(req2.isLanguageSwitch).toBe(true);
      expect(req2.targetLanguage).toBe('de');

      const req3 = detectLanguageSwitchRequest('Können wir ab jetzt Deutsch sprechen');
      expect(req3.isLanguageSwitch).toBe(true);
      expect(req3.targetLanguage).toBe('de');
    });

    it('compiles "Sprich bitte ab jetzt Deutsch" into conversational language switch intent', () => {
      const intent = AuthoritativeIntentCompiler.compile('Sprich bitte ab jetzt Deutsch');
      expect(intent.action).toBe('CONVERSATIONAL');
      expect(intent.target).toBe('language_switch');
      expect(intent.contentRequest).toBe('de');
    });

    it('executes language switch in ConversationCapabilityAdapter, producing German answer aloud', async () => {
      const step = AuthoritativeIntentCompiler.compile('Sprich bitte ab jetzt Deutsch');
      const res = await conversationCapabilityAdapter.execute(step, 'lang-step-1', conversationId);

      expect(res.success).toBe(true);
      expect(res.outputText).toBe('Verstanden. Ich spreche ab jetzt Deutsch mit dir.');
      expect(getConversationLanguage(conversationId)).toBe('de');
      expect(voiceRuntimeState.getLanguage()).toBe('de');
      expect(voiceRuntimeState.getActiveVoice()).toBe('aura-2-fabian-de');
    });

    it('synthesizes German speech ONLY with Deepgram aura-2-fabian-de (no Piper/Edge/English fallback)', async () => {
      voiceRuntimeState.setLanguage('de', 'de-DE', true);
      if (!process.env.DEEPGRAM_API_KEY) {
        await expect(synthesizeLocally('Hallo Christian, ich antworte jetzt auf Deutsch.'))
          .rejects.toThrow(/aura-2-fabian-de unavailable/);
        return;
      }
      const audioBuffer = await synthesizeLocally('Hallo Christian, ich antworte jetzt auf Deutsch.');

      expect(audioBuffer).toBeInstanceOf(Buffer);
      expect(audioBuffer.length).toBeGreaterThan(5000); // Valid MP3
      
      const provider = await voiceRuntimeState.getEffectiveProviderLive();
      expect(provider.provider).toBe('deepgram');
      expect(provider.voice).toBe('aura-2-fabian-de');
      expect(provider.fallbackReason).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Opening email and sending a message
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Email Workflows: Open, Draft, and Approval-Gated Send', () => {
    it('compiles "Open my email" to OPEN_APPLICATION Email', () => {
      const intent = AuthoritativeIntentCompiler.compile('Open my email');
      expect(intent.action).toBe('OPEN_APPLICATION');
      expect(intent.application).toBe('Email');
      expect(intent.target).toBe('email');
    });

    it('compiles "Write an email to Alice" to email_draft intent', () => {
      const intent = AuthoritativeIntentCompiler.compile('Write an email to Alice saying project is complete');
      expect(intent.action).toBe('CONVERSATIONAL');
      expect(intent.target).toBe('email_draft');
    });

    it('compiles "Send this email" to email_send intent', () => {
      const intent = AuthoritativeIntentCompiler.compile('Send this email');
      expect(intent.action).toBe('CONVERSATIONAL');
      expect(intent.target).toBe('email_send');
    });

    it('prepares an email draft and displays recipient, subject, body with review prompt', () => {
      const draftRes = emailService.prepareDraft({
        to: 'colleague@example.com',
        subject: 'Weekly Status',
        body: 'Here is the summary of this week.',
        conversationId,
      });

      expect(draftRes.success).toBe(true);
      expect(draftRes.action).toBe('DRAFT');
      expect(draftRes.needsApproval).toBe(true);
      expect(draftRes.outputText).toContain('colleague@example.com');
      expect(draftRes.outputText).toContain('Weekly Status');
      expect(draftRes.outputText).toContain('Please review');
    });

    it('refuses to send an email without explicit approval and prompts for confirmation', async () => {
      const sendRes = await emailService.sendEmail({
        conversationId,
        approved: false,
      });

      expect(sendRes.success).toBe(false);
      expect(sendRes.needsApproval).toBe(true);
      expect(sendRes.outputText).toMatch(/explicit approval/i);
    });

    it('sends or hands off email only upon explicit approval confirmation', async () => {
      emailService.prepareDraft({
        to: 'client@example.com',
        subject: 'Invoice #1042',
        body: 'Please find attached the invoice.',
        conversationId,
      });

      const sendRes = await emailService.sendEmail({
        conversationId,
        approved: true,
      });

      expect(sendRes.success).toBe(true);
      expect(sendRes.action).toBe('SEND');
      expect(sendRes.outputText).toMatch(/sent|authenticated mail app/i);
    });

    it('truthfully explains failures without blaming an unrelated target', async () => {
      // Record a prior failure for Telegram/AgenticOS
      authoritativeInteractionContext.recordExecutionFailure(conversationId, {
        turnId: 'old-turn',
        action: 'READ_MESSAGES',
        target: 'AgenticOS',
        failureReason: 'Telegram extraction failed',
        timestamp: Date.now(),
      } as any);

      // User asks why email or Hermes failed
      const queryStep = {
        ...AuthoritativeIntentCompiler.compile('Why could you not open my email?'),
        action: 'CONVERSATIONAL' as const,
        target: 'explain_previous_outcome',
        rawPrompt: 'Why could you not open my email?',
      };

      const result = await conversationCapabilityAdapter.execute(queryStep, 'why-step', conversationId);
      expect(result.outputText).toMatch(/different target/i);
      expect(result.outputText).not.toMatch(/Telegram extraction failed/);
    });
  });
});

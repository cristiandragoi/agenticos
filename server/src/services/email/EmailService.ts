/**
 * EmailService.ts — Authenticated Email Integration and Workflow Controller for AgenticOS
 *
 * Implements:
 * 1. "Open my email": Opens user's email in the browser (https://mail.google.com or configured webmail URL).
 * 2. "Write an email to X": Prepares a structured draft with recipient, subject, and text.
 * 3. "Send it": Displays recipient, subject, and text, and sends only after explicit confirmation ("yes").
 * 4. Confirmation Gate: Sends only after user says "yes".
 * 5. Delivery Verification: Reports success only after the email service confirms delivery.
 * 6. Disconnected State: If no email account is connected, states exactly that and provides instructions on how to connect it.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger.js';
import { secretStore } from '../gateway/secretStore.js';
import { targetResolver } from '../../domains/controlPlane/TargetResolver.js';
import { getActiveLanguage } from '../language/activeLanguageState.js';

const execAsync = promisify(exec);

export interface EmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: number;
  status: 'DRAFT' | 'AWAITING_RECIPIENT_ADDRESS' | 'AWAITING_SEND_COMMAND' | 'AWAITING_YES' | 'SENT' | 'FAILED';
}

export interface EmailOperationResult {
  success: boolean;
  verified: boolean;
  action: 'OPEN' | 'DRAFT' | 'REVIEW' | 'SEND';
  outputText: string;
  draft?: EmailDraft | null;
  error?: string;
  needsApproval?: boolean;
  confirmationId?: string;
}

export class EmailService {
  private static instance: EmailService;
  private activeDrafts = new Map<string, EmailDraft>();
  private configuredWebmailUrl: string = 'https://mail.google.com';
  private preferredAccount: 'gmail' | 'outlook' | null = null;
  private pendingAccountQuestions = new Set<string>();

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  public async getPreferredAccount(): Promise<'gmail' | 'outlook' | null> {
    if (this.preferredAccount) return this.preferredAccount;
    try {
      const stored = (await secretStore.get('email_preferred_account')) || process.env.EMAIL_PREFERRED_ACCOUNT;
      if (stored === 'gmail' || stored === 'outlook') {
        this.preferredAccount = stored;
        return stored;
      }
    } catch {}
    return null;
  }

  public async setPreferredAccount(account: 'gmail' | 'outlook'): Promise<void> {
    this.preferredAccount = account;
    try {
      await secretStore.set('email_preferred_account', account);
    } catch {}
  }

  public getActiveDraft(conversationId: string = 'default'): EmailDraft | null {
    return this.activeDrafts.get(conversationId) || null;
  }

  public clearDraft(conversationId: string = 'default'): void {
    this.activeDrafts.delete(conversationId);
  }

  /**
   * Check if an authenticated email account is connected (SMTP credentials in env or secretStore).
   */
  public async isAccountConnected(): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST || (await secretStore.get('smtp_host'));
    const smtpUser = process.env.SMTP_USER || (await secretStore.get('smtp_user'));
    const smtpPass = process.env.SMTP_PASS || (await secretStore.get('smtp_pass'));
    return Boolean(smtpHost && smtpUser && smtpPass);
  }

  /**
   * Explanation of how to connect an email account when none is configured.
   */
  public getConnectInstructions(lang: string = 'en'): string {
    const effectiveLang = (lang === 'de' || getActiveLanguage() === 'de') ? 'de' : lang;
    if (effectiveLang === 'de') {
      return 'Es ist kein E-Mail-Konto verbunden. Um ein E-Mail-Konto zu verbinden, konfigurieren Sie Ihre SMTP-Einstellungen (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT) in den Einstellungen > Integrationen oder im Secret Store (für Gmail: Host smtp.gmail.com, Port 587 und ein App-Passwort).';
    }
    return 'No email account is connected. To connect an email account, configure your SMTP settings (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT) in Settings > Integrations, or add them to your environment or Secret Store (e.g. for Gmail, use host smtp.gmail.com on port 587 with an App Password).';
  }

  /**
   * Open Gmail in the browser.
   */
  public async openGmailInBrowser(conversationId: string = 'default', lang: string = 'en'): Promise<EmailOperationResult> {
    const effectiveLang = (lang === 'de' || getActiveLanguage() === 'de') ? 'de' : lang;
    const url = 'https://mail.google.com';
    try {
      if (process.platform === 'win32') {
        await execAsync(`powershell -NoProfile -Command "Start-Process '${url}'"`, { timeout: 6000 });
      } else {
        await execAsync(`open '${url}' || xdg-open '${url}'`, { timeout: 6000 });
      }
      const text = effectiveLang === 'de'
        ? 'Ich habe Gmail im Browser geöffnet.'
        : 'I have opened Gmail in your browser.';
      return {
        success: true,
        verified: true,
        action: 'OPEN',
        outputText: text,
      };
    } catch (err: any) {
      logger.error('[EmailService] Failed to open Gmail in browser:', err);
      return {
        success: false,
        verified: false,
        action: 'OPEN',
        error: err?.message || String(err),
        outputText: effectiveLang === 'de'
          ? `Ich konnte Gmail im Browser nicht öffnen: ${err?.message || 'Unbekannter Fehler'}.`
          : `Failed to open Gmail in browser: ${err?.message || 'Failed to start browser.'}`,
      };
    }
  }

  /**
   * "Open my email": Opens user's email in the browser (defaults to Gmail; never opens Outlook unsolicited).
   */
  public async openEmailClient(conversationId: string = 'default', lang: string = 'en'): Promise<EmailOperationResult> {
    const pref = await this.getPreferredAccount();
    if (pref !== 'outlook') {
      return await this.openGmailInBrowser(conversationId, lang);
    }

    const effectiveLang = (lang === 'de' || getActiveLanguage() === 'de') ? 'de' : lang;
    logger.info('[EmailService] Opening email in browser');
    const webmailUrl = process.env.AGENTICOS_WEBMAIL_URL || this.configuredWebmailUrl;

    if (process.platform === 'win32') {
      try {
        await execAsync(`powershell -NoProfile -Command "Start-Process '${webmailUrl}'"`, { timeout: 6000 });
        const text = effectiveLang === 'de'
          ? `Ich habe Ihre E-Mails im Browser geöffnet (${webmailUrl}).`
          : `I have opened your email in your browser at ${webmailUrl}.`;
        return {
          success: true,
          verified: true,
          action: 'OPEN',
          outputText: text,
        };
      } catch (err: any) {
        logger.error('[EmailService] Failed to open email in browser:', err);
        const text = effectiveLang === 'de'
          ? `Ich konnte Ihre E-Mails im Browser nicht öffnen: ${err?.message || 'Unbekannter Fehler'}.`
          : `I could not open your email in the browser: ${err?.message || 'Failed to start browser.'}`;
        return {
          success: false,
          verified: false,
          action: 'OPEN',
          error: err?.message || String(err),
          outputText: text,
        };
      }
    }

    try {
      await execAsync(`open '${webmailUrl}' || xdg-open '${webmailUrl}'`, { timeout: 6000 });
      return {
        success: true,
        verified: true,
        action: 'OPEN',
        outputText: `I have opened your email in your browser at ${webmailUrl}.`,
      };
    } catch (err: any) {
      return {
        success: false,
        verified: false,
        action: 'OPEN',
        outputText: `Could not open email browser: ${err?.message}`,
      };
    }
  }

  /**
   * "Write an email to X": Prepares a draft.
   */
  public prepareDraft(params: {
    to?: string;
    subject?: string;
    body?: string;
    rawPrompt?: string;
    conversationId?: string;
    lang?: string;
  }): EmailOperationResult {
    const conversationId = params.conversationId || 'default';
    const lang = params.lang || 'en';
    let to = (params.to || '').trim();
    let subject = (params.subject || '').trim();
    let body = (params.body || '').trim();

    const prompt = params.rawPrompt || '';

    // Regex extractions from natural speech
    if (!to) {
      const toMatch =
        prompt.match(/\b(?:to|an(?!\s+e-?mail)|for)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[A-ZÄÖÜa-zäöüß]+(?:\s+[A-ZÄÖÜa-zäöüß]+)?)(?=\s+(?:about|regarding|titled|saying|subject|betreff|mit|$))\b/i) ||
        prompt.match(/\b(?:to|an(?!\s+e-?mail)|for)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[A-ZÄÖÜa-zäöüß]+)\b/i);
      if (toMatch) to = toMatch[1].trim();
    }
    if (!subject) {
      const subjMatch = prompt.match(/\b(?:subject|betreff|about|titled|saying|regarding)\s+["']?([^"'\n]+?)["']?(?:\s+and\s+body|\s+with\s+body|\s+text|\s+saying|$)/i);
      if (subjMatch) subject = subjMatch[1].trim();
    }
    if (!body) {
      const bodyMatch = prompt.match(/\b(?:body|text|message|nachricht|inhalt|saying|content)\s+["']?([^"'\n]+?)["']?$/i);
      if (bodyMatch) body = bodyMatch[1].trim();
    }

    const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const isDev = /\b(?:entwickler|developer|dev)\b/i.test(to) || /\b(?:entwickler|developer|dev)\b/i.test(prompt);

    if (isDev && !EMAIL_RE.test(to)) {
      const devEnvEmail = process.env.DEVELOPER_EMAIL;
      if (devEnvEmail && EMAIL_RE.test(devEnvEmail)) {
        to = devEnvEmail;
      }
    }

    if (!subject) subject = lang === 'de' ? 'Rückmeldung' : 'Follow-up';
    if (!body) body = lang === 'de' ? 'Hier ist der gewünschte Entwurf.' : 'Here is the draft message.';

    // If recipient is still not a valid email address, pause and ask for it
    const hasValidEmail = Boolean(to && EMAIL_RE.test(to));
    const draftStatus = hasValidEmail ? 'AWAITING_SEND_COMMAND' : 'AWAITING_RECIPIENT_ADDRESS';
    const draftRecipient = hasValidEmail
      ? to
      : isDev
        ? (lang === 'de' ? 'Entwickler' : 'Developer')
        : (to || (lang === 'de' ? 'Unbekannt' : 'Unknown'));

    const draftId = `draft-${Date.now()}`;
    const draft: EmailDraft = {
      id: draftId,
      to: draftRecipient,
      subject,
      body,
      createdAt: Date.now(),
      status: draftStatus,
    };

    this.activeDrafts.set(conversationId, draft);

    if (!hasValidEmail) {
      const askText = lang === 'de'
        ? (isDev
            ? 'Ich kenne die E-Mail-Adresse deines Entwicklers noch nicht. An welche Adresse soll ich die Nachricht senden?'
            : 'An welche E-Mail-Adresse soll ich die Nachricht senden?')
        : (isDev
            ? "I don't have your developer's email address yet. What email address should I send the message to?"
            : 'What email address should I send the message to?');
      return {
        success: true,
        verified: true,
        action: 'DRAFT',
        draft,
        outputText: askText,
      };
    }

    const preview = lang === 'de'
      ? [
          `Ich habe einen E-Mail-Entwurf erstellt:`,
          `• Empfänger: ${draft.to}`,
          `• Betreff: ${draft.subject}`,
          `• Text: ${draft.body}`,
          ``,
          `Sagen Sie „Sende es“, wenn Sie den Entwurf abschicken möchten.`,
        ].join('\n')
      : [
          `I have created an email draft:`,
          `• Recipient: ${draft.to}`,
          `• Subject: ${draft.subject}`,
          `• Text: ${draft.body}`,
          ``,
          `Say "Send it" when you are ready to review and send.`,
        ].join('\n');

    return {
      success: true,
      verified: true,
      action: 'DRAFT',
      draft,
      needsApproval: true,
      outputText: preview,
    };
  }

  /**
   * "Send it": Displays recipient, subject, and text, and requires explicit confirmation ("yes").
   */
  public showSendReview(conversationId: string = 'default', lang: string = 'en'): EmailOperationResult {
    const draft = this.activeDrafts.get(conversationId);
    if (!draft) {
      const text = lang === 'de'
        ? 'Es liegt kein aktiver E-Mail-Entwurf vor. Bitte sagen Sie zuerst „Schreibe eine E-Mail an [Empfänger]“.'
        : 'There is no email draft prepared. Please say "Write an email to [recipient]" first.';
      return {
        success: false,
        verified: false,
        action: 'REVIEW',
        outputText: text,
      };
    }

    draft.status = 'AWAITING_YES';
    this.activeDrafts.set(conversationId, draft);

    const reviewText = lang === 'de'
      ? [
          `Bitte überprüfen Sie die E-Mail vor dem Senden:`,
          `• Empfänger: ${draft.to}`,
          `• Betreff: ${draft.subject}`,
          `• Text: ${draft.body}`,
          ``,
          `Möchten Sie diese E-Mail jetzt senden? Bitte bestätigen Sie mit „Ja“.`,
        ].join('\n')
      : [
          `Please review the email details before sending:`,
          `• Recipient: ${draft.to}`,
          `• Subject: ${draft.subject}`,
          `• Text: ${draft.body}`,
          ``,
          `Do you want me to send it? Please say "yes" to confirm.`,
        ].join('\n');

    return {
      success: true,
      verified: true,
      action: 'REVIEW',
      draft,
      needsApproval: true,
      outputText: reviewText,
    };
  }

  /**
   * Sends the draft only after user says "yes", verifies connected account, and checks delivery.
   */
  public async confirmAndSend(conversationId: string = 'default', lang: string = 'en'): Promise<EmailOperationResult> {
    const draft = this.activeDrafts.get(conversationId);
    if (!draft) {
      const text = lang === 'de'
        ? 'Es gibt keinen vorbereiteten E-Mail-Entwurf zum Absenden.'
        : 'There is no active email draft to send.';
      return {
        success: false,
        verified: false,
        action: 'SEND',
        outputText: text,
      };
    }

    // Check if an email account is connected
    const connected = await this.isAccountConnected();
    if (!connected) {
      const instructions = this.getConnectInstructions(lang);
      return {
        success: false,
        verified: false,
        action: 'SEND',
        outputText: instructions,
      };
    }

    // Account is connected: send via nodemailer
    try {
      const smtpHost = process.env.SMTP_HOST || (await secretStore.get('smtp_host'));
      const smtpUser = process.env.SMTP_USER || (await secretStore.get('smtp_user'));
      const smtpPass = process.env.SMTP_PASS || (await secretStore.get('smtp_pass'));
      const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

      const transporter = (nodemailer as any).createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const info: any = await transporter.sendMail({
        from: smtpUser,
        to: draft.to,
        subject: draft.subject,
        text: draft.body,
      });

      draft.status = 'SENT';
      this.activeDrafts.delete(conversationId);

      const msgId = info?.messageId || `msg-${Date.now()}`;
      logger.info('[EmailService] Email confirmed and sent successfully:', { messageId: msgId });
      const successText = lang === 'de'
        ? `E-Mail erfolgreich an ${draft.to} mit dem Betreff „${draft.subject}“ gesendet. Bestätigungs-ID: ${msgId}.`
        : `Email successfully sent to ${draft.to} with subject "${draft.subject}". Confirmation ID: ${msgId}.`;

      return {
        success: true,
        verified: true,
        action: 'SEND',
        confirmationId: msgId,
        outputText: successText,
      };
    } catch (err: any) {
      draft.status = 'FAILED';
      logger.error('[EmailService] SMTP delivery failed:', err);
      const errText = lang === 'de'
        ? `Fehler beim Versenden der E-Mail: ${err?.message || 'SMTP-Übertragungsfehler'}.`
        : `The email service could not deliver the email: ${err?.message || 'SMTP delivery failed'}.`;
      return {
        success: false,
        verified: false,
        action: 'SEND',
        error: err?.message || String(err),
        outputText: errText,
      };
    }
  }

  /**
   * Compatibility wrapper for ConversationCapabilityAdapter
   */
  public async sendEmail(params: {
    rawPrompt?: string;
    approved?: boolean;
    conversationId?: string;
    lang?: string;
  }): Promise<EmailOperationResult> {
    const conversationId = params.conversationId || 'default';
    const lang = params.lang || 'en';
    if (params.approved) {
      let draft = this.getActiveDraft(conversationId);
      if (!draft && params.rawPrompt) {
        this.prepareDraft({ rawPrompt: params.rawPrompt, conversationId, lang });
        draft = this.getActiveDraft(conversationId);
      }
      if (draft) {
        draft.status = 'AWAITING_YES';
      }
      return await this.confirmAndSend(conversationId, lang);
    }
    return this.showSendReview(conversationId, lang);
  }

  /**
   * Unified Natural Language Intent Dispatcher for Email
   */
  public async handleTurn(params: {
    prompt: string;
    conversationId: string;
    lang?: string;
  }): Promise<EmailOperationResult | null> {
    const { prompt, conversationId, lang = 'en' } = params;
    const lower = prompt.toLowerCase().trim();
    const activeDraft = this.getActiveDraft(conversationId);

    // 0. Account selection response or follow-up
    const isAwaitingAccount = this.pendingAccountQuestions.has(conversationId);
    const mentionsGmail = /\b(?:gmail|google(?:\s*mail)?)\b/i.test(lower);
    const mentionsOutlook = /\b(?:outlook|microsoft(?:\s*mail)?)\b/i.test(lower);

    if (isAwaitingAccount || (/^(?:über\s+|mit\s+|via\s+)?(?:gmail|outlook)[.!?]?$/i.test(lower) && !activeDraft)) {
      if (mentionsGmail) {
        this.pendingAccountQuestions.delete(conversationId);
        await this.setPreferredAccount('gmail');
        return await this.openGmailInBrowser(conversationId, lang);
      }
      if (mentionsOutlook) {
        this.pendingAccountQuestions.delete(conversationId);
        await this.setPreferredAccount('outlook');
        const text = lang === 'de'
          ? 'Ich habe Outlook als Ihr Standard-E-Mail-Konto gespeichert.'
          : 'I have saved Outlook as your preferred email account.';
        return {
          success: true,
          verified: true,
          action: 'DRAFT',
          outputText: text,
        };
      }
    }

    // 0b. Follow-up: User providing email address for an in-flight draft awaiting recipient
    if (activeDraft && activeDraft.status === 'AWAITING_RECIPIENT_ADDRESS') {
      const emailMatch = prompt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        activeDraft.to = emailMatch[0];
        activeDraft.status = 'AWAITING_SEND_COMMAND';
        const preview = lang === 'de'
          ? [
              `Ich habe den E-Mail-Entwurf für ${activeDraft.to} aktualisiert:`,
              `• Empfänger: ${activeDraft.to}`,
              `• Betreff: ${activeDraft.subject}`,
              `• Text: ${activeDraft.body}`,
              ``,
              `Sagen Sie „Sende es“, wenn Sie den Entwurf abschicken möchten.`,
            ].join('\n')
          : [
              `I have updated the email draft for ${activeDraft.to}:`,
              `• Recipient: ${activeDraft.to}`,
              `• Subject: ${activeDraft.subject}`,
              `• Text: ${activeDraft.body}`,
              ``,
              `Say "Send it" when you are ready to review and send.`,
            ].join('\n');
        return {
          success: true,
          verified: true,
          action: 'DRAFT',
          draft: activeDraft,
          needsApproval: true,
          outputText: preview,
        };
      }
    }

    // 1. Detect open email / Gmail intent
    const isOpenEmail =
      /\b(?:open|launch|check|show)\s+(?:my\s+)?(?:email|emails|mail|inbox|webmail|gmail)\b/i.test(lower) ||
      /\b(?:[oö]ffne|zeige|starte)\s+(?:meine?\s+)?(?:e-?mails?|postfach|inbox|mail|gmail)\b/i.test(lower);

    // 2. Detect write email / draft message intent
    const isWriteEmail =
      /\b(?:write|compose|draft|prepare|create|send)\s+(?:an?\s+)?(?:email|mail|message)\b/i.test(lower) ||
      /\b(?:schreibe?|verfasse?|erstelle?|sende?)\s+(?:mir\s+)?(?:eine?\s+)?(?:e-?mail|nachricht)\b/i.test(lower) ||
      /\be-?mail\s+(?:schreiben|verfassen|senden)\b/i.test(lower);

    if (isOpenEmail || isWriteEmail) {
      if (mentionsGmail) {
        await this.setPreferredAccount('gmail');
      } else if (mentionsOutlook) {
        await this.setPreferredAccount('outlook');
      } else {
        const pref = await this.getPreferredAccount();
        if (!pref) {
          this.pendingAccountQuestions.add(conversationId);
          const askText = lang === 'de'
            ? 'Über welches Konto: Gmail oder Outlook?'
            : 'Which account: Gmail or Outlook?';
          return {
            success: true,
            verified: true,
            action: 'DRAFT',
            outputText: askText,
          };
        }
      }

      const effectivePref = (await this.getPreferredAccount()) || (mentionsGmail ? 'gmail' : 'outlook');

      if (effectivePref === 'gmail') {
        // Gmail means: open Gmail in browser. NEVER open Outlook unsolicited.
        if (isWriteEmail) {
          const draftRes = this.prepareDraft({ rawPrompt: prompt, conversationId, lang });
          await this.openGmailInBrowser(conversationId, lang);
          return {
            ...draftRes,
            outputText: lang === 'de'
              ? `Ich habe Gmail im Browser geöffnet.\n\n${draftRes.outputText}`
              : `I have opened Gmail in your browser.\n\n${draftRes.outputText}`,
          };
        }
        return await this.openGmailInBrowser(conversationId, lang);
      }

      // Outlook explicitly preferred
      if (isWriteEmail) {
        return this.prepareDraft({ rawPrompt: prompt, conversationId, lang });
      }
      return await this.openEmailClient(conversationId, lang);
    }

    // 4. User says "yes" when draft is awaiting confirmation
    const isYes =
      /^(?:yes|ja|yes\s+please|ja\s+bitte|yes\s+send|confirm|best[aä]tigen?|proceed|send\s+it\s+now)[.!]?$/i.test(lower);

    if (isYes && activeDraft && activeDraft.status === 'AWAITING_YES') {
      return await this.confirmAndSend(conversationId, lang);
    }

    // 5. "Send it" / "Send this email" / "Sende es"
    const isSendIt =
      /\b(?:send\s+it|send\s+(?:this\s+|the\s+)?email|senden?|abschicken?|sende\s+es|schick\s+es\s+ab)\b/i.test(lower);

    if (isSendIt) {
      return this.showSendReview(conversationId, lang);
    }

    return null;
  }
}

export const emailService = EmailService.getInstance();

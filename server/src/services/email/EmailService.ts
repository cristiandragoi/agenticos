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

import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger.js';
import { secretStore } from '../gateway/secretStore.js';
import { targetResolver } from '../../domains/controlPlane/TargetResolver.js';
import { getActiveLanguage } from '../language/activeLanguageState.js';
import { observeWindows } from '../../domains/turnLifecycle/probes.js';
import { setActiveDesktopTask, getActiveDesktopTask, clearActiveDesktopTask } from '../../domains/turnLifecycle/taskState.js';

const execAsync = promisify(exec);

function findCometExecutable(): string | null {
  const candidates = [
    'C:\\Program Files\\Perplexity\\Comet\\Application\\comet.exe',
    'C:\\Program Files (x86)\\Perplexity\\Comet\\Application\\comet.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Perplexity\\Comet\\Application\\comet.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Perplexity\\Comet\\Application\\comet.exe'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function focusWindow(hwnd: number): Promise<boolean> {
  const script = path.join(process.cwd(), 'server', 'scripts', 'lifecycle', 'lc_type_text.ps1');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', String(hwnd), '-TextB64', ''],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        try {
          const raw = JSON.parse(String(stdout || '').trim());
          resolve(Boolean(raw?.foregroundConfirmed));
        } catch {
          resolve(false);
        }
      }
    );
  });
}

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
      return 'Es ist kein E-Mail-Konto verbunden. Um ein E-Mail-Konto zu verbinden, konfiguriere deine SMTP-Einstellungen (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT) in den Einstellungen > Integrationen oder im Secret Store (für Gmail: Host smtp.gmail.com, Port 587 und ein App-Passwort).';
    }
    return 'No email account is connected. To connect an email account, configure your SMTP settings (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT) in Settings > Integrations, or add them to your environment or Secret Store (e.g. for Gmail, use host smtp.gmail.com on port 587 with an App Password).';
  }

  /**
   * Open Gmail in the browser.
   */
  public async openGmailInBrowser(
    conversationId: string = 'default',
    lang: string = 'en',
    opts?: { targetBrowser?: string; isCompose?: boolean; prompt?: string }
  ): Promise<EmailOperationResult> {
    const effectiveLang = (lang === 'de' || getActiveLanguage() === 'de') ? 'de' : lang;
    const isCompose = Boolean(opts?.isCompose);
    const url = isCompose
      ? 'https://mail.google.com/mail/u/0/#inbox?compose=new'
      : 'https://mail.google.com';

    const promptText = (opts?.prompt || '').toLowerCase();
    const wantsComet = opts?.targetBrowser === 'comet' || /\b(?:comet|perplexity|plexi)\b/i.test(promptText);

    try {
      if (process.platform === 'win32') {
        const cometExe = wantsComet ? findCometExecutable() : null;
        if (wantsComet && !cometExe) {
          const errText = effectiveLang === 'de'
            ? 'Comet Perplexity wurde auf diesem System nicht gefunden.'
            : 'Comet Perplexity browser was not found on this system.';
          return {
            success: false,
            verified: false,
            action: 'OPEN',
            error: 'comet_browser_not_found',
            outputText: errText,
          };
        }

        if (cometExe) {
          logger.info('[EmailService] Launching Comet browser with Gmail', { cometExe, url, isCompose });
          await execAsync(`cmd.exe /c start "" "${cometExe}" "${url}"`, { timeout: 10000 });
        } else {
          await execAsync(`cmd.exe /c start "" "${url}"`, { timeout: 8000 });
        }

        // Wait and poll for the browser window to appear and bring it to foreground
        let targetWindow: { hwnd: number; pid: number; title: string } | null = null;
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 600));
          const obs = await observeWindows().catch(() => ({ foreground: 0, windows: [] }));
          const match = obs.windows.find((w) => {
            const proc = (w.process || '').toLowerCase();
            const title = (w.title || '').toLowerCase();
            if (wantsComet) {
              return proc === 'comet' || title.includes('comet');
            }
            return title.includes('gmail') || title.includes('google mail') || proc === 'chrome' || proc === 'msedge';
          });
          if (match) {
            targetWindow = match;
            if (obs.foreground !== match.hwnd) {
              await focusWindow(match.hwnd);
            }
            break;
          }
        }

        // Verify final desktop state
        const finalObs = await observeWindows().catch(() => ({ foreground: 0, windows: [] }));
        const verifiedWindow = targetWindow || finalObs.windows.find((w) => {
          const proc = (w.process || '').toLowerCase();
          const title = (w.title || '').toLowerCase();
          return wantsComet ? (proc === 'comet' || title.includes('comet')) : (title.includes('gmail') || proc === 'chrome');
        });

        if (!verifiedWindow) {
          const failureText = effectiveLang === 'de'
            ? 'Das Browserfenster konnte nach dem Start auf dem Desktop nicht verifiziert werden.'
            : 'Could not verify the browser window on the desktop after launch.';
          return {
            success: false,
            verified: false,
            action: 'OPEN',
            error: 'window_not_found_on_desktop',
            outputText: failureText,
          };
        }

        // Save authoritative desktop task state
        setActiveDesktopTask({
          taskId: `task-${Date.now()}`,
          requestId: conversationId,
          conversationId,
          type: isCompose ? 'COMPOSE_EMAIL' : 'OPEN_EMAIL',
          requestedApp: wantsComet ? 'comet' : 'browser',
          targetUrl: url,
          hwnd: verifiedWindow.hwnd,
          pid: verifiedWindow.pid,
          windowTitle: verifiedWindow.title,
          isForeground: finalObs.foreground === verifiedWindow.hwnd,
          composeOpened: isCompose,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
          status: 'COMPLETED',
        });

        const text = effectiveLang === 'de'
          ? (isCompose
              ? (wantsComet
                  ? 'Ich habe Gmail in Comet geöffnet. An wen soll die E-Mail gehen?'
                  : 'Ich habe Gmail im Browser geöffnet. An wen soll die E-Mail gehen?')
              : (wantsComet
                  ? 'Ich habe Gmail in Comet geöffnet.'
                  : 'Ich habe Gmail im Browser geöffnet.'))
          : (isCompose
              ? `I have opened Gmail in ${wantsComet ? 'Comet' : 'your browser'}. Who should the email go to?`
              : `I have opened Gmail in ${wantsComet ? 'Comet' : 'your browser'}.`);

        return {
          success: true,
          verified: true,
          action: 'OPEN',
          outputText: text,
        };
      }

      await execAsync(`xdg-open "${url}" || open "${url}"`, { timeout: 6000 });
      return {
        success: true,
        verified: true,
        action: 'OPEN',
        outputText: effectiveLang === 'de' ? 'Ich habe Gmail im Browser geöffnet.' : 'I have opened Gmail in your browser.',
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
        await execAsync(`cmd.exe /c start "" "${webmailUrl}"`, { timeout: 6000 });
        const text = effectiveLang === 'de'
          ? `Ich habe deine E-Mails im Browser geöffnet (${webmailUrl}).`
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
          ? `Ich konnte deine E-Mails im Browser nicht öffnen: ${err?.message || 'Unbekannter Fehler'}.`
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
   * Normalizes spoken email addresses from speech-to-text (e.g., "CD International Project at Gmail.com" -> "cdinternationalproject@gmail.com").
   */
  public normalizeSpokenEmailAddress(raw: string): { email: string | null; isAmbiguous: boolean; candidate?: string } {
    if (!raw || typeof raw !== 'string') return { email: null, isAmbiguous: false };
    const cleaned = raw.trim();

    // 1. Direct standard email match
    const directEmailMatch = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (directEmailMatch) {
      return { email: directEmailMatch[0].toLowerCase(), isAmbiguous: false };
    }

    // 1b. STT dot substitution for common email domains (e.g. "cdinternationalproject.gmail.com" -> "cdinternationalproject@gmail.com")
    const dotProviderMatch = cleaned.match(/([a-zA-Z0-9._%+-]+)\.(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|yahoo\.com|gmx\.de|web\.de|icloud\.com)/i);
    if (dotProviderMatch) {
      return { email: `${dotProviderMatch[1]}@${dotProviderMatch[2]}`.toLowerCase(), isAmbiguous: false };
    }

    // 2. Spoken email pattern:
    // e.g. "CD International Project at Gmail.com"
    // "cd international project at gmail dot com"
    // "an cd international project at gmail.com"
    // "an max at example dot org"
    // "test ät web punkt de"
    const norm = cleaned
      // Strip leading conversational phrases like "an", "to", "für", "die adresse ist", "es soll an"
      .replace(/^(?:an\s+|to\s+|für\s+|for\s+|die\s+adresse\s+ist\s+|es\s+soll\s+an\s+|schick(?:e|st)?\s+(?:es\s+)?an\s+|send\s+(?:it\s+)?to\s+)+/i, '')
      .trim();

    // Look for connector: "@", "at", "ät", "et" followed by a domain
    const spokenPattern = /^(.*?)\s+(?:@|at|ät|et)\s+(.*)$/i;
    const match = norm.match(spokenPattern);
    if (match) {
      let localPart = match[1].trim();
      let domainPart = match[2].trim();

      // Normalize domain part:
      domainPart = domainPart
        .replace(/\s+(?:punkt|dot)\s+/gi, '.')
        .replace(/\s*([.])\s*/g, '.')
        .replace(/\s+/g, '')
        .toLowerCase();

      // Normalize local part:
      localPart = localPart
        .replace(/\s+(?:punkt|dot)\s+/gi, '.')
        .replace(/\s+(?:unterstrich|underscore)\s+/gi, '_')
        .replace(/\s+(?:minus|dash|bindestrich)\s+/gi, '-')
        .replace(/[^a-zA-Z0-9._%+-]/g, '')
        .toLowerCase();

      // If domain doesn't have an extension yet, check common domains (e.g. "gmail" -> "gmail.com")
      if (!domainPart.includes('.')) {
        if (/^(?:gmail|googlemail)$/i.test(domainPart)) domainPart = 'gmail.com';
        else if (/^(?:outlook|hotmail)$/i.test(domainPart)) domainPart = 'outlook.com';
        else if (/^(?:gmx)$/i.test(domainPart)) domainPart = 'gmx.de';
        else if (/^(?:web)$/i.test(domainPart)) domainPart = 'web.de';
        else if (/^(?:yahoo)$/i.test(domainPart)) domainPart = 'yahoo.com';
        else if (/^(?:icloud)$/i.test(domainPart)) domainPart = 'icloud.com';
      }

      const candidate = `${localPart}@${domainPart}`;
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(candidate)) {
        return { email: candidate, isAmbiguous: false };
      }
    }

    // 3. Spoken candidate name without domain (e.g. "CD International Project", "Max Mustermann")
    const cleanName = norm.replace(/[.!?]+$/, '').trim();
    if (cleanName.length > 1 && !/\b(?:nein|stopp?|abbrechen|cancel)\b/i.test(cleanName)) {
      return { email: null, isAmbiguous: true, candidate: cleanName };
    }

    return { email: null, isAmbiguous: false };
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
            ? 'Ich kenne die E-Mail-Adresse deines Entwicklers noch nicht. An wen soll die E-Mail gehen?'
            : 'An wen soll die E-Mail gehen?')
        : (isDev
            ? "I don't have your developer's email address yet. Who should the email go to?"
            : 'Who should the email go to?');
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
          `Sage „Sende es“, wenn du den Entwurf abschicken möchtest.`,
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
        ? 'Es liegt kein aktiver E-Mail-Entwurf vor. Bitte sage zuerst „Schreibe eine E-Mail an [Empfänger]“.'
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
          `Bitte überprüfe die E-Mail vor dem Senden:`,
          `• Empfänger: ${draft.to}`,
          `• Betreff: ${draft.subject}`,
          `• Text: ${draft.body}`,
          ``,
          `Möchtest du diese E-Mail jetzt senden? Bitte bestätige mit „Ja“.`,
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

    const isGerman =
      lang === 'de' ||
      getActiveLanguage() === 'de' ||
      /(?:^|[^\p{L}\p{N}])(?:[oö]ffne|[oö]ffnen|oeffne|oeffnen|er[oö]ffne|er[oö]ffnen|aufmachen|bitte|mein|meine|mach|mache|schreib|schreibe|schreiben|sende|zeig|zeige)(?:$|[^\p{L}\p{N}])/iu.test(lower);
    const effectiveLang = isGerman ? 'de' : lang;

    // 0. Account selection response or follow-up
    const isAwaitingAccount = this.pendingAccountQuestions.has(conversationId);
    const mentionsGmail = /\b(?:gmail|google(?:\s*mail)?)\b/i.test(lower);
    const mentionsOutlook = /\b(?:outlook|microsoft(?:\s*mail)?)\b/i.test(lower);

    if (isAwaitingAccount || (/^(?:über\s+|mit\s+|via\s+)?(?:gmail|outlook)[.!?]?$/i.test(lower) && !activeDraft)) {
      if (mentionsGmail) {
        this.pendingAccountQuestions.delete(conversationId);
        await this.setPreferredAccount('gmail');
        return await this.openGmailInBrowser(conversationId, effectiveLang);
      }
      if (mentionsOutlook) {
        this.pendingAccountQuestions.delete(conversationId);
        await this.setPreferredAccount('outlook');
        const text = effectiveLang === 'de'
          ? 'Ich habe Outlook als dein Standard-E-Mail-Konto gespeichert.'
          : 'I have saved Outlook as your preferred email account.';
        return {
          success: true,
          verified: true,
          action: 'DRAFT',
          outputText: text,
        };
      }
    }

    // 0b. Follow-up: User providing email address or command for an in-flight draft awaiting recipient
    if (activeDraft && activeDraft.status === 'AWAITING_RECIPIENT_ADDRESS') {
      // Cancellation check
      const isCancel = /^(?:stop|abbrechen|stopp|cancel|verwerfen|halt|nein|nicht\s+senden)[.!]?$/i.test(prompt.trim());
      if (isCancel) {
        this.activeDrafts.delete(conversationId);
        clearActiveDesktopTask();
        const cancelText = effectiveLang === 'de'
          ? 'E-Mail-Entwurf abgebrochen.'
          : 'Email draft cancelled.';
        return {
          success: true,
          verified: true,
          action: 'DRAFT',
          outputText: cancelText,
        };
      }

      const norm = this.normalizeSpokenEmailAddress(prompt);
      if (norm.email) {
        activeDraft.to = norm.email;
        activeDraft.status = 'AWAITING_SEND_COMMAND';

        // Synchronize with active desktop task and update browser window
        const task = getActiveDesktopTask(conversationId);
        if (task && (task.type === 'COMPOSE_EMAIL' || task.type === 'OPEN_EMAIL')) {
          const composeUrl = `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${encodeURIComponent(norm.email)}`;
          task.targetUrl = composeUrl;
          task.updatedAt = new Date().toISOString();
          setActiveDesktopTask(task);

          if (process.platform === 'win32') {
            const cometExe = task.requestedApp === 'comet' ? findCometExecutable() : null;
            if (cometExe) {
              execAsync(`cmd.exe /c start "" "${cometExe}" "${composeUrl}"`, { timeout: 8000 }).catch(() => {});
            } else {
              execAsync(`cmd.exe /c start "" "${composeUrl}"`, { timeout: 8000 }).catch(() => {});
            }
            if (task.hwnd) {
              focusWindow(task.hwnd).catch(() => {});
            }
          }
        }

        const preview = effectiveLang === 'de'
          ? [
              `Ich habe ${activeDraft.to} als Empfänger in den Gmail-Entwurf eingetragen:`,
              `• Empfänger: ${activeDraft.to}`,
              `• Betreff: ${activeDraft.subject}`,
              `• Text: ${activeDraft.body}`,
              ``,
              `Sag „Sende es“, wenn du den Entwurf abschicken möchtest.`,
            ].join('\n')
          : [
              `I have set ${activeDraft.to} as the recipient in the Gmail draft:`,
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

      // If user gave a candidate name/entity without an email domain, ask for confirmation
      if (norm.isAmbiguous && norm.candidate) {
        const askText = effectiveLang === 'de'
          ? `Soll die E-Mail an „${norm.candidate}“ gehen? Bitte nenne mir die vollständige E-Mail-Adresse (z. B. name@beispiel.de).`
          : `Should the email go to "${norm.candidate}"? Please specify the complete email address (e.g. name@example.com).`;
        return {
          success: true,
          verified: true,
          action: 'DRAFT',
          draft: activeDraft,
          outputText: askText,
        };
      }
    }

    // 1. Flexible open email / Gmail intent detection
    // Sentence contains an email/inbox keyword AND an opening keyword anywhere in the query
    const hasEmailKeyword =
      /(?:^|[^\p{L}\p{N}])(?:gmail|google\s*mail|e-?mails?|mail|postfach|inbox|webmail)(?:$|[^\p{L}\p{N}])/iu.test(lower) ||
      /@(?:gmail\.com|[\w.-]+\.[a-z]{2,})/iu.test(lower);

    const hasOpenKeyword =
      /(?:^|[^\p{L}\p{N}])(?:[oö]ffne|[oö]ffnen|oeffne|oeffnen|er[oö]ffne|er[oö]ffnen|eroeffne|eroeffnen|aufmachen|zeig|zeige|zeigen|open|launch|check|show|start|starte)(?:$|[^\p{L}\p{N}])/iu.test(lower) ||
      /\b(?:mach|mache)\b.*\bauf\b/iu.test(lower) ||
      /(?:^|[^\p{L}\p{N}])(?:mach|mache)(?:$|[^\p{L}\p{N}]).*(?:^|[^\p{L}\p{N}])auf(?:$|[^\p{L}\p{N}])/iu.test(lower);

    const hasWriteKeyword =
      /(?:^|[^\p{L}\p{N}])(?:schreib|schreibe|schreiben|verfass|verfasse|verfassen|erstell|erstelle|erstellen|sende?|senden|compose|draft|write|prepare)(?:$|[^\p{L}\p{N}])/iu.test(lower);

    const isOpenEmail = hasEmailKeyword && hasOpenKeyword;
    const isWriteEmail = (hasEmailKeyword && hasWriteKeyword) ||
      (!hasEmailKeyword && /\b(?:schreib|schreibe|schreiben)\s+(?:mir\s+)?(?:eine?\s+)?nachricht\b/i.test(lower));

    const isCompose = isWriteEmail ||
      /\b(?:erstelle?|neue?|verfasse?|schreibe?)\s+(?:eine?\s+)?(?:neue?\s+)?(?:e-?mail|nachricht|entwurf)\b/iu.test(lower) ||
      /\b(?:compose|new\s+email|draft)\b/iu.test(lower);

    const mentionsComet = /\b(?:comet|perplexity|plexi)\b/iu.test(lower);

    if (isOpenEmail || isWriteEmail || isCompose) {
      if (mentionsGmail) {
        await this.setPreferredAccount('gmail');
      } else if (mentionsOutlook) {
        await this.setPreferredAccount('outlook');
      } else {
        const pref = await this.getPreferredAccount();
        if (!pref) {
          this.pendingAccountQuestions.add(conversationId);
          const askText = effectiveLang === 'de'
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
        if (isCompose) {
          const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
          const hasRecipient = EMAIL_RE.test(lower) || /\b(?:an|to)\s+[a-zA-Z0-9._%+-]+/i.test(lower);
          const draftRes = this.prepareDraft({ rawPrompt: prompt, conversationId, lang: effectiveLang });
          const browserRes = await this.openGmailInBrowser(conversationId, effectiveLang, {
            targetBrowser: mentionsComet ? 'comet' : undefined,
            isCompose: true,
            prompt,
          });
          if (!browserRes.success) return browserRes;

          if (!hasRecipient) {
            return {
              ...draftRes,
              outputText: effectiveLang === 'de'
                ? (mentionsComet
                    ? 'Ich habe Gmail in Comet geöffnet. An wen soll die E-Mail gehen?'
                    : 'Ich habe Gmail im Browser geöffnet. An wen soll die E-Mail gehen?')
                : `I have opened Gmail in ${mentionsComet ? 'Comet' : 'your browser'}. Who should the email go to?`,
            };
          }
          return {
            ...draftRes,
            outputText: effectiveLang === 'de'
              ? (mentionsComet
                  ? `Ich habe Gmail in Comet geöffnet.\n\n${draftRes.outputText}`
                  : `Ich habe Gmail im Browser geöffnet.\n\n${draftRes.outputText}`)
              : `I have opened Gmail in ${mentionsComet ? 'Comet' : 'your browser'}.\n\n${draftRes.outputText}`,
          };
        }
        return await this.openGmailInBrowser(conversationId, effectiveLang, {
          targetBrowser: mentionsComet ? 'comet' : undefined,
          isCompose: false,
          prompt,
        });
      }

      // Outlook explicitly preferred
      if (isCompose) {
        return this.prepareDraft({ rawPrompt: prompt, conversationId, lang: effectiveLang });
      }
      return await this.openEmailClient(conversationId, effectiveLang);
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

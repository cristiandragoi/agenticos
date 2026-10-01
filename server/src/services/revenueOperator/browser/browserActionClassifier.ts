/**
 * browserActionClassifier.ts — Deterministic classification for proposed browser actions.
 *
 * Categorizes proposed browser actions into risk buckets based on:
 * - action type
 * - target URL / domain / navigation destination
 * - element role, text, and accessible name
 * - form destination and input metadata
 * - monetary amount
 * - page context and modal state
 *
 * Zero AI hallucination; 100% deterministic rules.
 */

import type { ProposedBrowserAction, ActionRiskCategory, ProviderAccountPolicy } from './types.js';

export interface ClassificationResult {
  category: ActionRiskCategory;
  reasonCode: string;
  reason: string;
  confidence: number;
}

const CAPTCHA_KEYWORDS = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'turnstile',
  'cf-turnstile',
  'geetest',
  'arkoselabs',
  'funcaptcha',
  'i am not a robot',
  'ich bin kein roboter',
  'security challenge',
  'bot check',
  'cloudflare challenge',
];

const KYC_KEYWORDS = [
  'kyc',
  'know your customer',
  'identity verification',
  'id verification',
  'identitätsprüfung',
  'identitaetspruefung',
  'verify identity',
  'upload id',
  'ausweis',
  'reisepass',
  'passport upload',
  'driver license',
  'führerschein',
  'id card',
  'selfie verification',
  'liveness check',
];

const SECURITY_KEYWORDS = [
  'change password',
  'new password',
  'current password',
  'kennwort ändern',
  'passwort ändern',
  'change email',
  'e-mail ändern',
  'email change',
  'two-factor',
  '2fa',
  'two factor',
  'authenticator',
  'security settings',
  'sicherheitseinstellungen',
  'delete account',
  'konto löschen',
  'close account',
  'recovery key',
  'backup codes',
];

const PAYOUT_KEYWORDS = [
  'payout',
  'auszahlung',
  'withdraw',
  'withdrawal',
  'cash out',
  'request payout',
  'auszahlen',
  'transfer balance',
  'guthaben auszahlen',
  'iban',
  'bankverbindung',
  'paypal account',
  'payout settings',
];

const PAYMENT_KEYWORDS = [
  'checkout',
  'place order',
  'pay now',
  'jetzt bezahlen',
  'jetzt kaufen',
  'buy now',
  'purchase',
  'order summary',
  'credit card',
  'kreditkarte',
  'billing address',
  'charge my card',
  'subscribe now',
  'upgrade plan',
];

const LEGAL_KEYWORDS = [
  'terms of service',
  'terms and conditions',
  'nutzungsbedingungen',
  'agb',
  'allgemeine geschäftsbedingungen',
  'privacy policy',
  'datenschutzerklärung',
  'i accept the terms',
  'ich akzeptiere die agb',
  'agree and continue',
  'legal agreement',
  'contract confirmation',
];

function textMatchesAny(text: string, keywords: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Deterministically classify a proposed browser action into an ActionRiskCategory.
 */
export function classifyBrowserAction(
  action: ProposedBrowserAction,
  policy?: ProviderAccountPolicy
): ClassificationResult {
  const combinedText = [
    action.elementName,
    action.elementText,
    action.elementRole,
    action.inputName,
    action.formDestination,
    action.navigationDestination,
    action.targetUrl,
  ]
    .filter(Boolean)
    .join(' ');

  // 1. CAPTCHA Challenge Detection (Top Priority)
  if (action.currentState?.isCaptchaPresent) {
    return {
      category: 'CAPTCHA',
      reasonCode: 'CAPTCHA_STATE_DETECTED',
      reason: 'Page state flags an active CAPTCHA or bot-challenge',
      confidence: 1.0,
    };
  }

  if (textMatchesAny(combinedText, CAPTCHA_KEYWORDS)) {
    return {
      category: 'CAPTCHA',
      reasonCode: 'CAPTCHA_ELEMENT_DETECTED',
      reason: 'Action targets a CAPTCHA challenge or verification container',
      confidence: 0.95,
    };
  }

  // 2. KYC / Identity Verification Detection
  if (action.currentState?.isKycModalPresent) {
    return {
      category: 'KYC',
      reasonCode: 'KYC_MODAL_DETECTED',
      reason: 'Active KYC identity verification modal or workflow detected',
      confidence: 1.0,
    };
  }

  if (textMatchesAny(combinedText, KYC_KEYWORDS)) {
    return {
      category: 'KYC',
      reasonCode: 'KYC_ELEMENT_DETECTED',
      reason: 'Action interacts with identity verification, passport, or KYC elements',
      confidence: 0.95,
    };
  }

  // 3. Account Security (Password / Email / 2FA / Deletion)
  if (textMatchesAny(combinedText, SECURITY_KEYWORDS)) {
    return {
      category: 'ACCOUNT_SECURITY',
      reasonCode: 'ACCOUNT_SECURITY_ACTION',
      reason: 'Action alters credentials, password, email address, or security settings',
      confidence: 0.95,
    };
  }

  // 4. Credential Submission (Password input outside known login flow)
  const isPasswordInput =
    action.inputType === 'password' ||
    action.inputName?.toLowerCase().includes('password') ||
    action.inputName?.toLowerCase() === 'pwd' ||
    action.inputName?.toLowerCase() === 'pass';

  if (isPasswordInput) {
    const currentUrl = action.targetUrl || action.currentState?.url || '';
    const isKnownLoginUrl = policy?.knownLoginUrls?.some((loginUrl) => currentUrl.includes(loginUrl));

    if (!isKnownLoginUrl) {
      return {
        category: 'CREDENTIAL',
        reasonCode: 'CREDENTIAL_OUTSIDE_LOGIN_FLOW',
        reason: 'Password or sensitive credential input submitted outside designated login flow',
        confidence: 0.95,
      };
    }
  }

  // 5. Payout / Withdrawal
  if (textMatchesAny(combinedText, PAYOUT_KEYWORDS)) {
    return {
      category: 'PAYOUT',
      reasonCode: 'PAYOUT_REQUEST_DETECTED',
      reason: 'Action triggers balance withdrawal, payout request, or disbursement settings',
      confidence: 0.95,
    };
  }

  // 6. Payment & Purchase
  if (action.monetaryAmount !== undefined && action.monetaryAmount > 0) {
    return {
      category: 'PAYMENT',
      reasonCode: 'MONETARY_TRANSACTION_DETECTED',
      reason: `Action involves financial spending: ${action.monetaryAmount} ${action.currency || 'EUR'}`,
      confidence: 1.0,
    };
  }

  if (textMatchesAny(combinedText, PAYMENT_KEYWORDS)) {
    return {
      category: 'PURCHASE',
      reasonCode: 'PURCHASE_FLOW_DETECTED',
      reason: 'Action initiates or completes purchase, subscription, or financial checkout',
      confidence: 0.9,
    };
  }

  // 7. Legal / TOS Acceptance
  if (textMatchesAny(combinedText, LEGAL_KEYWORDS)) {
    return {
      category: 'LEGAL_ACCEPTANCE',
      reasonCode: 'LEGAL_TOS_ACCEPTANCE',
      reason: 'Action constitutes acceptance of terms of service, AGB, or legal agreements',
      confidence: 0.9,
    };
  }

  // 8. External Redirect (if destination domain is external)
  if (action.navigationDestination) {
    try {
      const destUrl = new URL(action.navigationDestination);
      const targetUrl = new URL(action.targetUrl);
      if (destUrl.hostname.toLowerCase() !== targetUrl.hostname.toLowerCase()) {
        return {
          category: 'EXTERNAL_REDIRECT',
          reasonCode: 'EXTERNAL_REDIRECT_TARGET',
          reason: `Navigation targets external host: ${destUrl.hostname}`,
          confidence: 0.85,
        };
      }
    } catch {
      // ignore invalid URLs here; domain validation will catch them
    }
  }

  // 9. Routine Permitted Action
  return {
    category: 'ROUTINE',
    reasonCode: 'ROUTINE_ACTION',
    reason: 'Standard routine browser interaction',
    confidence: 0.8,
  };
}

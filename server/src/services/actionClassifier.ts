/**
 * actionClassifier.ts
 *
 * TASK 9 — Approval / Action Classification Foundation
 *
 * Classifies any Magnitude or worker action into a safety tier:
 *   READ_ONLY        — no side effects (inspect, read, navigate, search)
 *   WRITE_REVERSIBLE — local-only changes, can be undone (draft, prepare)
 *   CONSEQUENTIAL    — irreversible real-world effects (submit, send, purchase)
 *   PROHIBITED       — never permitted autonomously
 *
 * Consequential actions require backend approval before execution.
 * UI confirmation alone is NOT sufficient — the backend checks this flag.
 */

export type ActionClass =
  | 'READ_ONLY'
  | 'WRITE_REVERSIBLE'
  | 'CONSEQUENTIAL'
  | 'PROHIBITED';

export interface ClassificationResult {
  actionClass: ActionClass;
  requiresApproval: boolean;
  reason: string;
  /** If CONSEQUENTIAL and not yet approved, block execution. */
  blocked: boolean;
}

// ── Pattern tables ────────────────────────────────────────────────────────

const READ_ONLY_PATTERNS = [
  /\b(inspect|read|view|navigate|browse|open|visit|fetch|scrape|extract|search|check|look|observe|analyse|analyze)\b/i,
  /\b(get|list|find|query|retrieve|discover)\b/i,
  /\b(screenshot|snapshot|dump|crawl)\b/i,
];

const WRITE_REVERSIBLE_PATTERNS = [
  /\b(draft|prepare|create draft|write draft|compose draft|stage|assemble|generate|render|save locally)\b/i,
  /\b(create file|write file|append to file|update local)\b/i,
];

const CONSEQUENTIAL_PATTERNS = [
  /\b(submit|send|post|publish|upload|deploy|release|broadcast)\b/i,
  /\b(purchase|buy|order|checkout|pay|charge|bill|spend)\b/i,
  /\b(delete|remove|drop|destroy|wipe|truncate|purge)\b/i,
  /\b(register|sign up|create account|update account|change password)\b/i,
  /\b(message|email|dm|reply|comment|react|like|share)\b/i,
  /\b(advertise|run ad|launch campaign|set budget)\b/i,
  /\b(transfer|withdraw|deposit|wire|refund)\b/i,
];

const PROHIBITED_PATTERNS = [
  /\b(hack|exploit|bypass security|brute force|crack password)\b/i,
  /\b(phish|scam|defraud|impersonate)\b/i,
];

// ── Classifier ────────────────────────────────────────────────────────────

export function classifyAction(
  actionDescription: string,
  workerType: string = 'unknown',
  approved: boolean = false,
): ClassificationResult {
  const text = actionDescription.toLowerCase();

  // Prohibited first
  for (const pat of PROHIBITED_PATTERNS) {
    if (pat.test(text)) {
      return {
        actionClass: 'PROHIBITED',
        requiresApproval: false,
        reason: `Action matches prohibited pattern: ${pat.source}`,
        blocked: true,
      };
    }
  }

  // Consequential
  for (const pat of CONSEQUENTIAL_PATTERNS) {
    if (pat.test(text)) {
      return {
        actionClass: 'CONSEQUENTIAL',
        requiresApproval: true,
        reason: `Action matches consequential pattern: ${pat.source}. Requires explicit approval before execution.`,
        blocked: !approved,
      };
    }
  }

  // Write reversible
  for (const pat of WRITE_REVERSIBLE_PATTERNS) {
    if (pat.test(text)) {
      return {
        actionClass: 'WRITE_REVERSIBLE',
        requiresApproval: false,
        reason: 'Local write operation — reversible.',
        blocked: false,
      };
    }
  }

  // Read only (default for browser/inspection tasks)
  for (const pat of READ_ONLY_PATTERNS) {
    if (pat.test(text)) {
      return {
        actionClass: 'READ_ONLY',
        requiresApproval: false,
        reason: 'Read-only browser/data inspection.',
        blocked: false,
      };
    }
  }

  // Default: magnitude browser tasks without explicit verb → READ_ONLY
  if (workerType === 'magnitude') {
    return {
      actionClass: 'READ_ONLY',
      requiresApproval: false,
      reason: 'Magnitude browser task — defaulting to READ_ONLY.',
      blocked: false,
    };
  }

  // Unknown — require review
  return {
    actionClass: 'WRITE_REVERSIBLE',
    requiresApproval: false,
    reason: 'No explicit action pattern matched — defaulting to WRITE_REVERSIBLE.',
    blocked: false,
  };
}

/**
 * Backend execution gate.
 * Returns true if execution is permitted, false if blocked.
 */
export function isExecutionPermitted(
  actionDescription: string,
  workerType: string,
  approved: boolean = false,
): { permitted: boolean; classification: ClassificationResult } {
  const classification = classifyAction(actionDescription, workerType, approved);
  return {
    permitted: !classification.blocked,
    classification,
  };
}

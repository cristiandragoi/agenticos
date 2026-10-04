/**
 * UserFacingResponseGuard.ts — prevents internal architecture diagnostics from being spoken.
 *
 * Internal diagnostics (enum names, adapter ids, "classified as … without capability mapping",
 * stack fragments) stay in telemetry/logs. The user hears a natural sentence instead.
 */

import { logger } from '../../utils/logger.js';

const INTERNAL_DIAGNOSTIC_PATTERNS: readonly RegExp[] = [
  /classified\s+as/i,
  /capability\s+mapping/i,
  /without\s+capability/i,
  /\bcapability\s+adapter\b/i,
  /\bno\s+authoritative\s+adapter\b/i,
  /\b(?:READ_MESSAGES|READ_CONTENT|READ_WEB_CONTENT|READ_SCREEN|READ_WINDOW|OPEN_APPLICATION|OPEN_CHAT|CAMERA_OBSERVE|NAVIGATE_WEB|OPEN_URL|SWITCH_TAB|CONVERSATIONAL|TASK_STATUS|NAVIGATE_GUI|LOCATE_ELEMENT|ACTIVATE_CONTROL|EXPLAIN_PREVIOUS_OUTCOME)\b/,
  /\bOTHER\b/,
  /\bstepId\b|\bplan-turn|\bcorr-turn/i,
  /\[object Object\]/,
  /\b(?:TypeError|ReferenceError|SyntaxError)\b/,
  /\bat\s+\S+\s+\(\S+:\d+:\d+\)/,
  // Provider exceptions & browser automation artifacts
  /navigation_error/i,
  /page\.goto/i,
  /Target page, context or browser has been closed/i,
  /browser has been closed/i,
  /Target closed/i,
  /Session closed/i,
  /Execution context was destroyed/i,
  /net::ERR_/i,
  /Protocol error/i,
  /Timeout \d+ms exceeded/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /Call log:/i,
  /navigated to https?:/i,
];

const ACTION_PHRASES: Record<string, string> = {
  OPEN_APPLICATION: 'open the application',
  FOCUS_APPLICATION: 'focus the application',
  CLOSE_APPLICATION: 'close the application',
  OPEN_CHAT: 'open the conversation',
  READ_MESSAGES: 'read the messages',
  READ_CONTENT: 'read the content',
  READ_SCREEN: 'read the screen',
  READ_WINDOW: 'read the window',
  READ_WEB_CONTENT: 'read the web page',
  CAMERA_OBSERVE: 'look through the camera',
  NAVIGATE_WEB: 'open the web page',
  OPEN_URL: 'open the web page',
  SWITCH_TAB: 'switch browser tabs',
  DELEGATE: 'hand the task over',
  TASK_STATUS: 'check the task status',
  NAVIGATE_GUI: 'navigate the application',
  LOCATE_ELEMENT: 'find that element',
  ACTIVATE_CONTROL: 'activate that control',
};

export function humanizeAction(action: string | null | undefined): string {
  if (!action) return 'complete that';
  return ACTION_PHRASES[action] || 'complete that';
}

export function isInternalDiagnostic(text: string | null | undefined): boolean {
  if (!text) return false;
  return INTERNAL_DIAGNOSTIC_PATTERNS.some(re => re.test(text));
}

/**
 * Returns `text` if it is safe to speak, otherwise the natural `fallback`.
 * The suppressed diagnostic is logged for telemetry.
 */
export function toUserFacing(text: string | null | undefined, fallback: string, telemetry?: Record<string, unknown>): string {
  const t = (text || '').trim();
  if (!t) return fallback;
  if (isInternalDiagnostic(t)) {
    logger.warn('[UserFacingResponseGuard] INTERNAL_DIAGNOSTIC_SUPPRESSED', { suppressed: t, spoken: fallback, ...telemetry });
    return fallback;
  }
  return t;
}

export function humanizeWebSite(targetOrUrl: string | null | undefined): string {
  if (!targetOrUrl) return 'the web page';
  const clean = targetOrUrl.trim();
  if (/youtube/i.test(clean)) return 'YouTube';
  if (/google/i.test(clean)) return 'Google';
  if (/perplexity/i.test(clean)) return 'Perplexity';
  if (/github/i.test(clean)) return 'GitHub';
  if (/reddit/i.test(clean)) return 'Reddit';
  if (/twitter|x\.com/i.test(clean)) return 'X';

  try {
    if (/^https?:\/\//i.test(clean)) {
      const parsed = new URL(clean);
      const host = parsed.hostname.replace(/^www\./i, '');
      const parts = host.split('.');
      if (parts.length >= 2) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
      return host;
    }
  } catch {}

  // If already a human name like "YouTube" or "Comet Perplexity"
  return clean.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\.(?:com|org|net|io|ai|app)$/i, '');
}

export function humanizeNavigationResponse(app: string, targetOrUrl: string): string {
  const site = humanizeWebSite(targetOrUrl);
  return `I opened ${site} in ${app}.`;
}

export const UNRESOLVED_UTTERANCE_REPLY = "I didn't understand what you were referring to. Could you say it another way?";

/**
 * domains/codingRuntime/failureClassifier.ts — provider failure classification
 * (Phase 14).
 *
 * Fallback triggers ONLY for eligible failures. Coding/test failures are
 * NEVER classified as provider outages.
 */

import type { CodingFailureClass } from './types.js';

export function classifyCodingFailure(message: string, opts: { aborted?: boolean; statusCode?: number } = {}): CodingFailureClass {
  if (opts.aborted) return 'CANCELLED';
  const msg = (message || '').toLowerCase();

  if (opts.statusCode === 429 || /rate.?limit|too many requests|http 429/.test(msg)) return 'PROVIDER_TRANSIENT';
  if (opts.statusCode === 401 || opts.statusCode === 403 || /http 401|http 403|invalid.*(api.?key|auth)|unauthorized|forbidden|auth.*fail/i.test(msg)) return 'PROVIDER_AUTH';
  if (opts.statusCode === 404 || /http 404|model.*not.?found|unknown model|does not exist/.test(msg)) return 'MODEL_UNAVAILABLE';
  if (/time.?out|timed out|deadline exceeded|connection reset|econnreset|temporary 5\d\d|5\d\d.*temporary|unavailable/i.test(msg)) return 'PROVIDER_TRANSIENT';
  if (/budget|cost limit|quota.*exceeded/i.test(msg)) return 'TIME_BUDGET_EXCEEDED';
  if (/permission denied|denied by policy|safety|sandbox.*block|approval required/.test(msg)) return 'SAFETY_BLOCK';
  if (/compilation error|failed to compile|tsc.*(error|fail)|tests? fail|test failed|exit(?:ed)?\s+(?:with\s+)?code \d|vitest|jest.*fail/i.test(msg)) return 'TASK_FAILURE';

  return 'UNKNOWN';
}

/** Whether a failure class is eligible for provider retry/fallback. */
export function isFallbackEligible(failureClass: CodingFailureClass): boolean {
  switch (failureClass) {
    case 'PROVIDER_TRANSIENT':
    case 'MODEL_UNAVAILABLE':
      return true;
    case 'PROVIDER_AUTH':
      // Eligible ONLY if another independently configured provider is valid.
      return true;
    case 'TASK_FAILURE':
    case 'SAFETY_BLOCK':
    case 'CANCELLED':
    case 'TIME_BUDGET_EXCEEDED':
      return false;
    default:
      return false;
  }
}

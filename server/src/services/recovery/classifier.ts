/**
 * FailureClassifier V1 — explicit, structured failure classification for the
 * LocalHarness recovery layer (P2).
 *
 * Classification prefers structured error/status information over
 * natural-language matching: HTTP status codes, known error markers
 * (EMPTY_CONTENT_AFTER_REASONING, GATE_FAILURE, approval state,
 * cancellation) are mapped directly. The original error is preserved as
 * evidence on every classification.
 */
export type FailureClass =
  | 'RETRYABLE_EXECUTION'
  | 'MODEL_INADEQUATE'
  | 'GATE_FAILURE'
  | 'POLICY_BLOCKED'
  | 'APPROVAL_REQUIRED'
  | 'NON_RETRYABLE'
  | 'CANCELLED';

export interface FailureClassification {
  cls: FailureClass;
  reason: string;
  retryable: boolean;
  originalError?: string;
}

export interface ClassificationContext {
  /** HTTP status when the failure came from an HTTP response. */
  status?: number;
  /** Structured error code/marker when available. */
  code?: string;
  /** True when the task's approval state requires a human. */
  approvalPending?: boolean;
  /** True when cancellation was requested. */
  cancelled?: boolean;
  /** True when a required gate already failed (GateRunner evidence exists). */
  gateFailed?: boolean;
  /** True when the desired action was refused by privacy/runtime policy. */
  policyBlocked?: boolean;
}

const RETRYABLE_MARKERS = [
  'EMPTY_CONTENT_AFTER_REASONING', // keep model-inadequate separate; see below
];
const KNOWN_MODEL_INADEQUATE = ['MODEL_INADEQUATE', 'empty content after reasoning', 'unparseable', 'tool-call grammar'];
const KNOWN_RETRYABLE = [
  'timeout', 'timed out', 'transient', 'fetch failed', 'ECONNREFUSED', 'ECONNRESET',
  'socket hang up', 'ETIMEDOUT', 'Ollama EOF', 'eof', '429', 'too many requests',
  'temporarily unavailable', 'service unavailable', '503', '502', '500',
];

export function errorString(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/** Extract the raw message, preserving it as evidence. */
export function classifyFailure(err: unknown, ctx: ClassificationContext = {}): FailureClassification {
  const raw = errorString(err);
  const code = ctx.code || '';
  const msg = raw.toLowerCase();
  const status = ctx.status;

  const ev = (cls: FailureClass, reason: string, retryable: boolean): FailureClassification =>
    ({ cls, reason, retryable, originalError: raw });

  // 1. Cancellation dominates everything.
  if (ctx.cancelled || code === 'CANCELLED' || code === 'AbortError' || /aborted|abort/i.test(msg)) {
    return ev('CANCELLED', 'CANCELLED: operation was cancelled', false);
  }

  // 2. Human approval required — stop autonomous recovery.
  if (ctx.approvalPending || code === 'APPROVAL_REQUIRED' || /approval[_ ]?required|waiting.*approval/i.test(msg)) {
    return ev('APPROVAL_REQUIRED', 'APPROVAL_REQUIRED: explicit human approval needed', false);
  }

  // 3. Policy block — never recover around privacy.
  if (ctx.policyBlocked || code === 'POLICY_BLOCKED' || /policy[_ ]?blocked|blocked by (privacy )?policy|privacy policy/i.test(msg)) {
    return ev('POLICY_BLOCKED', 'POLICY_BLOCKED: privacy/runtime policy forbids the desired action', false);
  }

  // 4. Gate failure — execution finished but required verification failed.
  if (ctx.gateFailed || code === 'GATE_FAILURE' || /verification failed|gate[_ ]?fail|required gate/i.test(msg)) {
    return ev('GATE_FAILURE', 'GATE_FAILURE: required verification did not pass', false);
  }

  // 5. Model inadequate — the model cannot produce the required structure.
  if (code === 'EMPTY_CONTENT_AFTER_REASONING' || KNOWN_MODEL_INADEQUATE.some((m) => msg.includes(m))) {
    return ev('MODEL_INADEQUATE', `MODEL_INADEQUATE: model could not produce required output${status ? ` (HTTP ${status})` : ''}`, false);
  }

  // 6. Retryable execution failures (structured status first).
  if (status !== undefined && (status === 429 || (status >= 500 && status <= 599))) {
    return ev('RETRYABLE_EXECUTION', `RETRYABLE_EXECUTION: HTTP ${status}`, true);
  }
  if (KNOWN_RETRYABLE.some((m) => msg.includes(m))) {
    return ev('RETRYABLE_EXECUTION', `RETRYABLE_EXECUTION: ${raw}`, true);
  }

  // 7. Permanent auth/config — conservative default.
  if (status === 401 || status === 403 || /401|403|invalid api key|unauthorized|forbidden|not found/i.test(msg)) {
    return ev('NON_RETRYABLE', `NON_RETRYABLE: ${raw}`, false);
  }

  // 8. Unknown → conservative: not retryable (safe default).
  return ev('NON_RETRYABLE', `NON_RETRYABLE: ${raw}`, false);
}

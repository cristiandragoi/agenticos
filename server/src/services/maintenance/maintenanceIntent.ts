/**
 * Maintenance intent detection (pure, no I/O) — Phase 4.1.
 *
 * Classifies a user prompt as a self-maintenance conversation and identifies the
 * specific maintenance status question it asks. Kept free of DB/service imports
 * so it is unit-testable in isolation and reused by the Jarvis conversational
 * bridge without dragging in the persistence graph.
 */

export type MaintenanceIntent = 'start' | 'continue' | 'status' | 'commit' | 'reject';

const MAINTENANCE_START_RE =
  /\b(check|investigate|look (into|at)|diagnose|figure out|debug|find out|see|understand)\b[^.!?]{0,60}\b(test|tests|build|typecheck|compilation|suite|failures?|errors?)\b[^.!?]{0,30}\b(failing|fail|failed|broken|red|error|errors|breaking|wrong)\b/i;

const MAINTENANCE_START_RE_BARE =
  /\b(check|investigate|diagnose|debug)\b[^.!?]{0,40}\b(test|tests|build|suite)\b/i;

const MAINTENANCE_CONTINUE_RE =
  /\b(can you fix it|fix it|fix that|fix this|fix the|go ahead|proceed|continue|try to fix|repair it|do it)\b/i;

const MAINTENANCE_COMMIT_RE = /\b(commit it|commit the|commit this|commit my|commit that|do the commit|make the commit)\b/i;

const MAINTENANCE_REJECT_RE = /\b(don'?t commit|never mind|reject|abort|cancel|drop it|discard)\b/i;

const WHERE_RE = /\bwhere (were|are) we\b|\bwhat'?s the (status|state)\b|\bwhere did we (leave|stop)\b/i;

const FIX_WORKED_RE = /\b(did (the|that|it|your) (fix|repair|change) work|did it work|was it fixed|did that fix it|is it (fixed|green|passing)|are (the )?tests (passing|green))\b/i;

const HERMES_RECOMMEND_RE = /\bwhat did hermes (recommend|say|suggest|propose|find|conclude)\b/i;

const CODEX_CHANGE_RE = /\bwhat did codex (change|modify|do|fix|touch|edit)\b|\bwhat (files|changes) (did|were) (codex|it) (change|make|touch)\b/i;

const CODEX_DOING_RE = /\bwhat (is|are|'s) codex (doing|working on|up to|running)\b/i;

/** Classify a prompt as a self-maintenance conversation, or null. */
export function detectMaintenanceIntent(prompt: string): MaintenanceIntent | null {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!p) return null;
  if (MAINTENANCE_COMMIT_RE.test(p)) return 'commit';
  if (MAINTENANCE_REJECT_RE.test(p)) return 'reject';
  if (MAINTENANCE_START_RE.test(p) || MAINTENANCE_START_RE_BARE.test(p)) return 'start';
  if (MAINTENANCE_CONTINUE_RE.test(p)) return 'continue';
  if (WHERE_RE.test(p) || FIX_WORKED_RE.test(p) || HERMES_RECOMMEND_RE.test(p) || CODEX_CHANGE_RE.test(p) || CODEX_DOING_RE.test(p)) return 'status';
  return null;
}

/** "did the fix work?" / "was it fixed?" → answer from persisted gate evidence. */
export function isFixWorkedQuestion(prompt: string): boolean {
  return FIX_WORKED_RE.test(prompt);
}

/** "what did Hermes recommend?" → answer from the persisted Hermes plan result. */
export function isHermesRecommendQuestion(prompt: string): boolean {
  return HERMES_RECOMMEND_RE.test(prompt);
}

/** "what did CodeX change?" → answer from the persisted CodeX repair files. */
export function isCodexChangeQuestion(prompt: string): boolean {
  return CODEX_CHANGE_RE.test(prompt);
}

/** "what is CodeX doing?" → answer from the persisted changeSet state. */
export function isCodexDoingQuestion(prompt: string): boolean {
  return CODEX_DOING_RE.test(prompt);
}

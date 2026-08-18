/**
 * Safe-action approval policy (PRIORITY 9).
 *
 * When "auto-approve safe actions" is enabled, SAFE action classes never
 * request approval; DESTRUCTIVE/high-impact classes ALWAYS require approval.
 *
 * SAFE (read-only, no side effects):
 *   runtime/system investigation, provider health checks, log reads,
 *   read-only file inspection, safe repository analysis (read-only),
 *   non-destructive tests, diagnostic queries, safe worker inspection,
 *   model/provider routing queries, status/queue queries.
 *
 * DESTRUCTIVE (always require approval):
 *   file writes/patches/deletes, configuration changes, provider/model
 *   assignment changes, executing arbitrary commands, deployments,
 *   outreach/contact, publishing, spending/money movement, task
 *   cancellation/abort of running work, provider credential changes.
 *
 * The classifier is intent-shaped (semantic categories), not phrase-shaped:
 * it uses the intent result's category + route plus explicit write/danger
 * signals on the prompt.
 */
export type ActionSafety = 'safe' | 'destructive';

const DESTRUCTIVE_CATEGORIES = new Set([
  'repository_change',
  'file_operation',
  'approval_required',
  'codex_delegation', // execution may write
  'pipeline_operation', // only when it triggers side effects; callers refine
]);

const DESTRUCTIVE_ROUTES = new Set(['codex', 'agent_teams']);

const DESTRUCTIVE_SIGNAL_RE =
  /\b(delete|remove|overwrite|write|create|patch|modify|change|update|refactor|deploy|publish|send|email|call|contact|reach out|pay|buy|purchase|spend|cancel|abort|stop)\b/i;

export function classifyActionSafety(
  route: string,
  category: string,
  prompt?: string
): ActionSafety {
  if (DESTRUCTIVE_CATEGORIES.has(category)) return 'destructive';
  if (DESTRUCTIVE_ROUTES.has(route) && category !== 'repository_analysis') return 'destructive';
  // A safe category with a destructive signal in the prompt is still destructive.
  if (prompt && DESTRUCTIVE_SIGNAL_RE.test(prompt) && !/read-only|do not (change|modify|write)|without (changing|modifying)/i.test(prompt)) {
    return 'destructive';
  }
  return 'safe';
}

/** Human-readable policy for the UI/settings panel. */
export const SAFE_ACTION_CLASSES = [
  'runtime/system investigation',
  'provider health checks',
  'log reads',
  'read-only file inspection',
  'safe (read-only) repository analysis',
  'non-destructive tests',
  'diagnostic queries',
  'safe worker inspection',
  'model/provider routing queries',
];

export const DESTRUCTIVE_ACTION_CLASSES = [
  'file writes/patches/deletes',
  'configuration changes',
  'provider/model assignment changes',
  'executing arbitrary commands',
  'deployments',
  'outreach/contact',
  'publishing',
  'spending/money movement',
  'cancelling/aborting running work',
];

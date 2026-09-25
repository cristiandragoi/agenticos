/**
 * jarvisHealth.ts — Jarvis operational counters so Hermes 1 can detect
 * regressions from runtime data instead of waiting for the user to notice.
 *
 * Rules: in-memory, synchronous, never throws into a turn; counts only facts
 * the runtime observed (no inference), and exposes a snapshot for /api/jarvis/metrics.
 */

export type JarvisCounter =
  | 'turns'
  | 'generic_reask'
  | 'clarification_asked'
  | 'context_resolved'
  | 'contextual_continuation'
  | 'correction_resolved'
  | 'correction_no_result'
  | 'unverified_success_blocked'
  | 'navigation_requests'
  | 'navigation_verified'
  | 'navigation_failed'
  | 'navigation_ack_orphan'
  | 'navigation_ack_duplicate'
  | 'credential_intent'
  | 'blocker_borrow_blocked'
  | 'cross_project_execution_blocked'
  | 'state_changing_target_aborted'
  | 'suspended_entered'
  | 'suspended_wake_reactivated'
  | 'stop_command_executed'
  | 'system_self_diagnose'
  | 'system_introspection';

const counters: Record<string, number> = Object.create(null);

/** Per-turn dedupe so one turn cannot inflate a counter twice. */
const lastHitAt: Record<string, number> = Object.create(null);

export function bump(counter: JarvisCounter, amount = 1): void {
  try {
    counters[counter] = (counters[counter] || 0) + amount;
  } catch {
    /* counting must never break a turn */
  }
}

/** Count at most once per turn per counter (the controller can hit a path twice). */
export function bumpOnce(turnId: string | undefined, counter: JarvisCounter): void {
  if (!turnId) return bump(counter);
  const key = `${turnId}:${counter}`;
  if (lastHitAt[key]) return;
  lastHitAt[key] = 1;
  bump(counter);
}

export interface JarvisHealthSnapshot {
  counters: Record<string, number>;
  rates: Record<string, number>;
  regressions: string[];
  notes: string[];
  generatedAt: string;
}

/**
 * Regression rules are intentionally simple and conservative: they compare
 * ratios within a single process lifetime, so they flag a build that suddenly
 * behaves worse without needing a baseline file.
 */
export function healthSnapshot(): JarvisHealthSnapshot {
  const c = { ...counters };
  const turns = Math.max(c.turns || 0, 1);
  const rates: Record<string, number> = {
    generic_reask_rate: +(((c.generic_reask || 0) / turns).toFixed(3)),
    clarification_rate: +(((c.clarification_asked || 0) / turns).toFixed(3)),
    context_resolution_rate: +(((c.context_resolved || 0) / turns).toFixed(3)),
    correction_resolution_rate: +((((c.correction_resolved || 0)) / Math.max(((c.correction_resolved || 0) + (c.correction_no_result || 0)), 1)).toFixed(3)),
    navigation_verified_rate: +(((c.navigation_verified || 0) / Math.max(c.navigation_requests || 0, 1)).toFixed(3)),
    orphan_ack_rate: +(((c.navigation_ack_orphan || 0) / Math.max(c.navigation_requests || 0, 1)).toFixed(3)),
  };

  const regressions: string[] = [];
  const notes: string[] = [];
  if ((c.turns || 0) >= 5 && rates.generic_reask_rate > 0.25) {
    regressions.push(`generic_reask_rate ${rates.generic_reask_rate} > 0.25 (conversation-resolution regression)`);
  }
  if ((c.navigation_ack_orphan || 0) > 0 && rates.orphan_ack_rate > 0.1) {
    regressions.push(`orphan_ack_rate ${rates.orphan_ack_rate}: ACKs do not belong to a registered transaction`);
  }
  if ((c.correction_no_result || 0) >= 3) {
    regressions.push(`correction_no_result=${c.correction_no_result}: corrections cannot be resolved against a recorded result`);
  }
  if (c.cross_project_execution_blocked) {
    // P0: a state change was prevented from running against the wrong project.
    // This is always a regression signal, never merely informational.
    regressions.push(`cross_project_execution_blocked=${c.cross_project_execution_blocked}: a state change targeted a different project than the resolved entity`);
  }
  if (c.unverified_success_blocked) {
    // The claim gate firing is CORRECT behaviour, not a regression: it is the
    // count of turns where a success claim was withheld. Worth watching, not alarming.
    notes.push(`unverified_success_blocked=${c.unverified_success_blocked}: success claims withheld (guard active)`);
  }
  if (c.blocker_borrow_blocked) {
    // Same: refusing to borrow another project's blocker is the desired behaviour.
    // A high rate only means account questions arrive without a resolvable entity.
    notes.push(`blocker_borrow_blocked=${c.blocker_borrow_blocked} of ${c.credential_intent || 0} account questions had no bound entity (guard active)`);
  }

  return { counters: c, rates, regressions, notes, generatedAt: new Date().toISOString() };
}

export function resetHealthCounters(): void {
  for (const k of Object.keys(counters)) delete counters[k];
  for (const k of Object.keys(lastHitAt)) delete lastHitAt[k];
}

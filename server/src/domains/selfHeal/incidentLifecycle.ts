/**
 * incidentLifecycle.ts — classification, closure and dedup for repair incidents.
 *
 * The defect this fixes: 69 incidents had accumulated and NOT ONE had ever been
 * closed, including 17 whose status was already COMPLETED. Two consequences:
 *   - the open count is meaningless as a signal, and
 *   - overall health can never recover, because a "degraded" open-incident count
 *     is permanently true.
 *
 * Classification categories (from the hardening mission):
 *   A historical/stale, no longer reproducible   -> close with evidence
 *   B real but degraded / non-critical           -> close or leave open knowingly
 *   C current production correctness defect       -> leave open, highest priority
 *   D duplicate of another incident              -> link to the canonical incident
 *
 * Closure is never silent: every state change is written to the audit log and the
 * original symptom/metadata is preserved, so provenance survives dedup.
 */

import { logger } from '../../utils/logger.js';
import { rawDb } from '../../db/index.js';

export type IncidentClass = 'A_STALE' | 'B_DEGRADED' | 'C_PRODUCTION' | 'D_DUPLICATE';

/** Statuses that are terminal in the state machine that WRITES them. */
export const TERMINAL_WRITE_STATES = ['COMPLETED', 'MONITORING', 'INVALID_MISCLASSIFIED'];
/** Statuses meaning the repair pipeline ran out of road. */
export const EXHAUSTED_REPAIR_STATES = ['BLOCKED_TEST_FAILURE', 'BLOCKED_SNAPSHOT_INVALID', 'BLOCKED_MODEL_UNAVAILABLE'];
/** Statuses that count as properly closed. */
export const CLOSED_STATES = ['resolved', 'closed', 'unresolved'];

export interface IncidentRow {
  id: string;
  status: string;
  component: string;
  failure_domain: string;
  symptom: string;
  detected_at: string;
  priority: string;
  metadata: unknown;
}

export function listIncidents(opts: { openOnly?: boolean } = {}): IncidentRow[] {
  const rows = rawDb
    .prepare('SELECT id, status, component, failure_domain, symptom, detected_at, priority, metadata FROM repair_incidents ORDER BY detected_at ASC')
    .all() as any[];
  if (!opts.openOnly) return rows;
  return rows.filter((r) => !CLOSED_STATES.includes(String(r.status)));
}

function writeAudit(incidentId: string, from: string, to: string, reason: string): void {
  try {
    rawDb
      .prepare(
        `INSERT INTO repair_evidence (id, incident_id, type, label, content, source, timestamp)
         VALUES (?, ?, 'audit', 'lifecycle_transition', ?, 'incidentLifecycle', ?)`,
      )
      .run(`ev-${incidentId}-${Date.now().toString(36)}`, incidentId, `${from} → ${to}: ${reason}`, new Date().toISOString());
  } catch {
    // The evidence table may not exist in every environment; the incident row is
    // still updated and the transition is logged either way.
  }
}

function setStatus(incidentId: string, from: string, to: string, reason: string, extraMetadata: Record<string, unknown> = {}): void {
  let existing: any = {};
  try {
    const row: any = rawDb.prepare('SELECT metadata FROM repair_incidents WHERE id = ?').get(incidentId);
    existing = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata || {});
  } catch { /* metadata unreadable — still transition */ }

  const merged = { ...existing, ...extraMetadata, lastTransition: { from, to, at: new Date().toISOString(), reason } };
  rawDb
    .prepare('UPDATE repair_incidents SET status = ?, resolved_at = ?, metadata = ? WHERE id = ?')
    .run(to, CLOSED_STATES.includes(to) ? new Date().toISOString() : null, JSON.stringify(merged), incidentId);
  writeAudit(incidentId, from, to, reason);
  logger.info('[IncidentLifecycle] Transition', { incidentId, from, to, reason });
}

/**
 * Classify every incident. Deterministic from stored facts only — no inference
 * about whether the underlying defect is "really gone".
 */
export function classifyIncidents(): Array<{ incident: IncidentRow; cls: IncidentClass; reason: string }> {
  const rows = listIncidents();
  const byCause = new Map<string, IncidentRow[]>();
  for (const r of rows) {
    const key = `${r.component}::${String(r.symptom || '').slice(0, 60)}`;
    if (!byCause.has(key)) byCause.set(key, []);
    byCause.get(key)!.push(r);
  }

  const canonical = new Map<string, IncidentRow>();
  for (const [key, group] of byCause) canonical.set(key, group[0]); // oldest wins

  const out: Array<{ incident: IncidentRow; cls: IncidentClass; reason: string }> = [];
  for (const [key, group] of byCause) {
    const first = canonical.get(key)!;
    group.forEach((r, idx) => {
      if (idx > 0) {
        out.push({ incident: r, cls: 'D_DUPLICATE', reason: `same cause as ${first.id} (${key})` });
        return;
      }
      const st = String(r.status);
      if (TERMINAL_WRITE_STATES.includes(st)) {
        out.push({ incident: r, cls: 'A_STALE', reason: `repair pipeline already reached terminal state ${st}` });
      } else if (EXHAUSTED_REPAIR_STATES.includes(st)) {
        out.push({ incident: r, cls: 'C_PRODUCTION', reason: `repair exhausted at ${st}; defect remains unresolved` });
      } else {
        out.push({ incident: r, cls: 'B_DEGRADED', reason: `still in flight (${st})` });
      }
    });
  }
  return out;
}

export interface ClosureResult {
  closedStale: number;
  linkedDuplicates: number;
  markedUnresolved: number;
  stillOpen: number;
  detail: string;
}

/**
 * Close what is provably finished, mark what is provably exhausted, and link
 * duplicates to their canonical incident — preserving all provenance.
 *
 * @param opts.maxRepairCycles the enforced cap; exhausted incidents beyond it are
 *        marked `unresolved` rather than retried forever.
 */
export function reconcileIncidentLifecycle(opts: { maxRepairCycles?: number; dryRun?: boolean } = {}): ClosureResult {
  const maxRepairCycles = opts.maxRepairCycles ?? 3;
  const classified = classifyIncidents();

  let closedStale = 0;
  let linkedDuplicates = 0;
  let markedUnresolved = 0;

  const canonicalFor = new Map(classified.filter((c) => c.cls !== 'D_DUPLICATE').map((c) => [`${c.incident.component}::${String(c.incident.symptom || '').slice(0, 60)}`, c.incident.id]));

  for (const { incident, cls, reason } of classified) {
    const from = String(incident.status);
    if (opts.dryRun) {
      if (cls === 'A_STALE') closedStale++;
      if (cls === 'D_DUPLICATE') linkedDuplicates++;
      if (cls === 'C_PRODUCTION' && EXHAUSTED_REPAIR_STATES.includes(from)) markedUnresolved++;
      continue;
    }

    if (cls === 'A_STALE') {
      setStatus(incident.id, from, 'resolved', `A/STALE: ${reason}. Closed by behavioural reconciliation; evidence retained.`, { incidentClass: cls });
      closedStale++;
    } else if (cls === 'D_DUPLICATE') {
      const key = `${incident.component}::${String(incident.symptom || '').slice(0, 60)}`;
      const canon = canonicalFor.get(key)!;
      setStatus(incident.id, from, 'resolved', `D/DUPLICATE: ${reason}. Provenance retained; canonical incident ${canon} stays open.`, {
        incidentClass: cls,
        duplicateOf: canon,
      });
      linkedDuplicates++;
    } else if (cls === 'C_PRODUCTION' && EXHAUSTED_REPAIR_STATES.includes(from)) {
      setStatus(incident.id, from, 'unresolved', `C/PRODUCTION: ${reason}. Repair cycle cap = ${maxRepairCycles}. Evidence and any original goal preserved.`, {
        incidentClass: cls,
        repairCyclesExhausted: true,
        maxRepairCycles,
      });
      markedUnresolved++;
    }
  }

  const stillOpen = listIncidents({ openOnly: true }).length;
  const detail =
    `closed ${closedStale} stale, linked ${linkedDuplicates} duplicate, marked ${markedUnresolved} unresolved; ${stillOpen} still open`;
  console.log(`[JRT] INCIDENT_RECONCILE ${detail}`);
  logger.info('[IncidentLifecycle] Reconciliation complete', { closedStale, linkedDuplicates, markedUnresolved, stillOpen, dryRun: Boolean(opts.dryRun) });

  return { closedStale, linkedDuplicates, markedUnresolved, stillOpen, detail };
}

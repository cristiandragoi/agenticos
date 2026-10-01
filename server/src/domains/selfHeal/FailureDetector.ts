import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { db, rawDb } from '../../db/index.js';
import { repairIncidents } from './schema.js';
import { FailureDomain } from './types.js';
import { admitIncident, attachIncident, closeChain, type IncidentSuppression } from './recoveryChain.js';

export interface RaiseIncidentInput {
  component: string;
  symptom: string;
  failureDomain: FailureDomain;
  priority: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Identity hints read by the recovery-chain registry (all optional, all machine values):
   * failureClass, target, rootOperationId, reasonCode, error, capabilityMissing,
   * conversationId, goalId, originalText.
   */
  metadata?: Record<string, unknown>;
}

export type RaiseIncidentResult =
  | { admitted: true; incidentId: string; chainId: string; rootOperationId: string }
  | { admitted: false; reason: IncidentSuppression | 'incident_insert_failed'; incidentId?: string; chainId?: string };

let incidentTablesEnsured = false;

/**
 * The incident table is created by the drizzle migrations in production. Admission opens a chain
 * BEFORE the incident row is written, so a missing table must not leave a chain behind with no
 * incident: make the (idempotent, schema-identical) DDL available wherever incidents are raised.
 */
function ensureIncidentTables(): void {
  if (incidentTablesEnsured) return;
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS repair_incidents (
        id TEXT PRIMARY KEY, goal_id TEXT, status TEXT NOT NULL, component TEXT NOT NULL,
        failure_domain TEXT NOT NULL, symptom TEXT NOT NULL, detected_at TEXT NOT NULL,
        resolved_at TEXT, triggered_by TEXT NOT NULL, priority TEXT NOT NULL, metadata TEXT NOT NULL
      );
    `);
    incidentTablesEnsured = true;
  } catch (e: any) {
    console.error(`[SelfHeal:FailureDetector] Could not ensure repair_incidents: ${e?.message}`);
  }
}

export class FailureDetector extends EventEmitter {
  private failureCounts: Map<string, { count: number; firstSeen: string; lastSeen: string }> = new Map();
  private readonly THRESHOLD = 3;
  private readonly WINDOW_MS = 5 * 60 * 1000;  // 5 minutes
  private nextCounter = 1;

  constructor() {
    super();
    this.initCounter().catch(err => console.error('[SelfHeal:FailureDetector] Failed to init counter:', err));
  }

  private async initCounter() {
    try {
      const all = await db.select().from(repairIncidents);
      this.nextCounter = all.length + 1;
    } catch (e) {
      // Error fetching, counter stays 1
    }
  }

  /**
   * Generate a unique incident ID like 'SELFHEAL-001'.
   * The counter is seeded asynchronously and rows can be deleted, so an id is only used once
   * no incident row owns it: a collision used to make a NEW failure silently reuse an old id.
   */
  private generateIncidentId(): string {
    for (;;) {
      const id = `SELFHEAL-${this.nextCounter.toString().padStart(3, '0')}`;
      this.nextCounter++;
      let taken = false;
      try { taken = Boolean(rawDb.prepare('SELECT 1 FROM repair_incidents WHERE id = ?').get(id)); } catch { taken = false; }
      if (!taken) return id;
    }
  }

  /** Record a failure signal. Returns incident ID if threshold crossed. */
  recordFailure(component: string, symptom: string, severity: 'warning' | 'error' | 'critical'): string | null {
    const key = `${component}:${symptom}`;
    const now = new Date();
    
    let state = this.failureCounts.get(key);
    if (state) {
      const last = new Date(state.lastSeen);
      if (now.getTime() - last.getTime() > this.WINDOW_MS) {
        state = { count: 1, firstSeen: now.toISOString(), lastSeen: now.toISOString() };
      } else {
        state.count++;
        state.lastSeen = now.toISOString();
      }
    } else {
      state = { count: 1, firstSeen: now.toISOString(), lastSeen: now.toISOString() };
    }
    this.failureCounts.set(key, state);

    if (severity === 'critical' || state.count >= this.THRESHOLD) {
      // Reset counter to avoid continuous triggering
      this.failureCounts.delete(key);
      return this.createManualIncident(component, symptom, 'unknown', severity === 'critical' ? 'critical' : 'high');
    }
    return null;
  }

  /**
   * Open an incident ONLY if the recovery-chain registry admits it.
   *
   * Identity is (root operation, failure class, target). While a chain for that identity is
   * active every further signal collapses into it; a retry/recovery of an earlier failure can
   * never open an incident of its own; an independent operation can. See recoveryChain.ts.
   *
   * (The previous in-line dedupe called `require()` inside an ES module and swallowed the
   * resulting ReferenceError, so it never deduplicated anything. It is replaced, not repaired:
   * deduplication now lives in the registry, keyed by operation identity instead of text.)
   */
  raiseIncident(input: RaiseIncidentInput): RaiseIncidentResult {
    const { component, symptom, failureDomain, priority, metadata } = input;
    const m = (metadata || {}) as Record<string, any>;
    ensureIncidentTables();

    const admission = admitIncident({
      component,
      failureClass: m.failureClass,
      // A monitor with no operation behind it is identified by what it reports.
      target: typeof m.target === 'string' && m.target ? m.target : `${component}::${symptom}`,
      rootOperationId: m.rootOperationId,
      reasonCode: m.reasonCode,
      error: m.error,
      capabilityMissing: Boolean(m.capabilityMissing),
      conversationId: m.conversationId,
      goalId: m.goalId,
      originalText: m.originalText ?? m.originalGoal,
    });

    if (!admission.admit) {
      if (admission.reason === 'duplicate_active' && admission.incidentId) this.recordOccurrence(admission.incidentId, metadata);
      console.log(`[SelfHeal:FailureDetector] Incident NOT raised (${admission.reason})${admission.incidentId ? ` -> existing ${admission.incidentId}` : ''}`);
      return { admitted: false, reason: admission.reason, incidentId: admission.incidentId, chainId: admission.chainId };
    }

    const incidentId = this.generateIncidentId();
    const goalId = m.goalId || null;
    const incident = {
      id: incidentId,
      goalId,
      status: 'detected',
      component,
      failureDomain,
      symptom,
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
      triggeredBy: 'automatic',
      priority,
      metadata: {
        ...(metadata || {}),
        goalId,
        occurrenceCount: 1,
        fingerprint: `${component}::${symptom}`,
        recoveryChainId: admission.chainId,
        rootOperationId: admission.rootOperationId,
      },
    };

    try {
      db.insert(repairIncidents).values(incident).run();
    } catch (e: any) {
      console.error(`[SelfHeal:FailureDetector] Failed to save incident: ${e.message}`);
      closeChain(admission.chainId, 'FAILED', 'incident_insert_failed');
      return { admitted: false, reason: 'incident_insert_failed', chainId: admission.chainId };
    }
    attachIncident(admission.chainId, incidentId);
    console.log(`[SelfHeal:FailureDetector] Incident created: ${incidentId} (chain ${admission.chainId})`);
    this.emit('incident:created', { incidentId, ...incident });
    return { admitted: true, incidentId, chainId: admission.chainId, rootOperationId: admission.rootOperationId };
  }

  /**
   * Legacy string API. Returns the incident id, the id of the incident the signal collapsed into,
   * or '' when the signal was suppressed and there is no incident to point at. Callers that ACT on
   * the incident (diagnose, repair, hand off) must use raiseIncident() and stop when !admitted.
   */
  createManualIncident(
    component: string,
    symptom: string,
    failureDomain: FailureDomain,
    priority: 'low' | 'medium' | 'high' | 'critical',
    metadata?: Record<string, unknown>
  ): string {
    const r = this.raiseIncident({ component, symptom, failureDomain, priority, metadata });
    return r.incidentId ?? '';
  }

  /** A deduplicated signal is evidence that the failure is still happening. */
  private recordOccurrence(incidentId: string, metadata?: Record<string, unknown>): void {
    try {
      const row: any = rawDb.prepare('SELECT metadata FROM repair_incidents WHERE id = ?').get(incidentId);
      if (!row) return;
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      meta.occurrenceCount = (meta.occurrenceCount || 1) + 1;
      meta.lastSeen = new Date().toISOString();
      if (metadata) meta.latestEvidence = metadata;
      rawDb.prepare('UPDATE repair_incidents SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), incidentId);
      this.emit('incident:updated', { incidentId, occurrenceCount: meta.occurrenceCount });
    } catch { /* best effort: the signal is already collapsed */ }
  }
}

export const failureDetector = new FailureDetector();

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { repairIncidents } from './schema.js';
import { FailureDomain } from './types.js';

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

  /** Generate a unique incident ID like 'SELFHEAL-001' */
  private generateIncidentId(): string {
    const id = `SELFHEAL-${this.nextCounter.toString().padStart(3, '0')}`;
    this.nextCounter++;
    return id;
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
   * Create or deduplicate an incident with deterministic fingerprinting.
   * If an unresolved incident with the same component & symptom exists,
   * its occurrence count is incremented and evidence is updated without creating duplicates.
   */
  createManualIncident(
    component: string,
    symptom: string,
    failureDomain: FailureDomain,
    priority: 'low' | 'medium' | 'high' | 'critical',
    metadata?: Record<string, unknown>
  ): string {
    try {
      const { rawDb } = require('../../db/index.js');
      if (rawDb) {
        const existing = rawDb.prepare(
          "SELECT id, metadata FROM repair_incidents WHERE component = ? AND symptom = ? AND status NOT IN ('resolved', 'closed', 'unresolved')"
        ).get(component, symptom) as any;

        if (existing) {
          const meta = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : (existing.metadata || {});
          meta.occurrenceCount = (meta.occurrenceCount || 1) + 1;
          meta.lastSeen = new Date().toISOString();
          if (metadata) {
            meta.latestEvidence = metadata;
          }
          rawDb.prepare(
            'UPDATE repair_incidents SET detected_at = ?, metadata = ? WHERE id = ?'
          ).run(new Date().toISOString(), JSON.stringify(meta), existing.id);
          console.log(`[SelfHeal:FailureDetector] Incident deduplicated (count=${meta.occurrenceCount}): ${existing.id}`);
          this.emit('incident:updated', { incidentId: existing.id, occurrenceCount: meta.occurrenceCount });
          return existing.id;
        }
      }
    } catch (e: any) {
      // Fallback to insertion if DB query fails
    }

    const incidentId = this.generateIncidentId();
    const goalId = (metadata as any)?.goalId || null;
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
      }
    };

    try {
      db.insert(repairIncidents).values(incident).run();
      console.log(`[SelfHeal:FailureDetector] Incident created: ${incidentId}`);
      this.emit('incident:created', { incidentId, ...incident });
    } catch (e: any) {
      console.error(`[SelfHeal:FailureDetector] Failed to save incident: ${e.message}`);
    }

    return incidentId;
  }
}

export const failureDetector = new FailureDetector();

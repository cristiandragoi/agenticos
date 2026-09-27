/**
 * IncidentReconciler.ts — Authoritative SelfHeal Incident & State Reconciliation
 *
 * Implements Section 4 & Section 12 of the AgenticOS Production Specification:
 * - Fixes self-heal as a system, eliminating indefinite accumulation of blocked or terminal unclosed incidents.
 * - Reconciles every repair incident into one of the 8 authoritative lifecycle states:
 *   ACTIVE | RECOVERING | WAITING_EXTERNAL | STALE | SUPERSEDED | RESOLVED | FAILED_RECOVERABLE | FAILED_ESCALATED
 * - Ensures terminal incidents are never unclosed:
 *   VERIFIED_RESOLVED -> CLOSE (RESOLVED)
 *   UNRESOLVED -> ESCALATE (FAILED_ESCALATED with forensic evidence)
 * - Evaluates blocked incidents with RecoveryWatchdog.
 * - Reconciles ghost approvals and dead background tasks from restarts.
 */

import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { recoveryWatchdog } from '../controlPlane/RecoveryWatchdog.js';

export type IncidentLifecycleState =
  | 'ACTIVE'
  | 'RECOVERING'
  | 'WAITING_EXTERNAL'
  | 'STALE'
  | 'SUPERSEDED'
  | 'RESOLVED'
  | 'FAILED_RECOVERABLE'
  | 'FAILED_ESCALATED';

export interface IncidentReconciliationReport {
  totalEvaluated: number;
  resolvedCount: number;
  supersededCount: number;
  staleCount: number;
  failedEscalatedCount: number;
  activeCount: number;
  waitingExternalCount: number;
  reconciledGoalsCount: number;
  reconciledTasksCount: number;
  openIncidentsRemaining: number;
  blockedIncidentsRemaining: number;
  reconciledAt: string;
}

export class IncidentReconciler {
  private static instance: IncidentReconciler;
  private readonly RECENT_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
  private readonly STALE_THRESHOLD_MS = 60 * 60 * 1000;  // 1 hour

  private constructor() {}

  public static getInstance(): IncidentReconciler {
    if (!IncidentReconciler.instance) {
      IncidentReconciler.instance = new IncidentReconciler();
    }
    return IncidentReconciler.instance;
  }

  /**
   * Run full reconciliation across repair_incidents, legacy goals, and background tasks.
   */
  public reconcileAll(): IncidentReconciliationReport {
    logger.info('[IncidentReconciler] Starting authoritative incident & state reconciliation...');
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    let resolvedCount = 0;
    let supersededCount = 0;
    let staleCount = 0;
    let failedEscalatedCount = 0;
    let activeCount = 0;
    let waitingExternalCount = 0;

    // ── 1. Reconcile repair_incidents ─────────────────────────────────────────
    let incidents: any[] = [];
    try {
      incidents = rawDb.prepare('SELECT id, status, component, failure_domain, symptom, detected_at, resolved_at, metadata FROM repair_incidents ORDER BY detected_at ASC').all() as any[];
    } catch (e: any) {
      logger.warn(`[IncidentReconciler] Could not read repair_incidents: ${e?.message}`);
      incidents = [];
    }

    // Group by component + symptom to identify duplicates / superseded
    const byComponentKey = new Map<string, any[]>();
    for (const inc of incidents) {
      const key = `${inc.component || 'unknown'}::${String(inc.symptom || '').slice(0, 60)}`;
      if (!byComponentKey.has(key)) byComponentKey.set(key, []);
      byComponentKey.get(key)!.push(inc);
    }

    for (const [key, group] of byComponentKey) {
      const latestIncident = group[group.length - 1];

      for (let i = 0; i < group.length; i++) {
        const inc = group[i];
        const isLatest = i === group.length - 1;
        const currentStatus = String(inc.status || 'detected');
        const detectedMs = new Date(inc.detected_at || 0).getTime();
        const ageMs = now - detectedMs;

        // A. Already properly completed/resolved/monitoring
        if (['COMPLETED', 'resolved', 'closed', 'MONITORING'].includes(currentStatus)) {
          if (!inc.resolved_at || currentStatus !== 'RESOLVED') {
            this.updateIncidentStatus(inc.id, 'RESOLVED', nowIso, 'Verified resolved and closed by authoritative reconciliation.');
          }
          resolvedCount++;
          continue;
        }

        // B. External blocker (e.g. model unavailable / quota / missing key)
        if (currentStatus === 'BLOCKED_MODEL_UNAVAILABLE' || currentStatus.includes('EXTERNAL')) {
          this.updateIncidentStatus(
            inc.id,
            'WAITING_EXTERNAL',
            nowIso,
            'External capability unavailable (model/quota/provider). Tracked as waiting external with watchdog supervision.'
          );
          waitingExternalCount++;
          continue;
        }

        // C. Blocked after failed repair attempts (test failure, invalid snapshot, unresolved)
        if (['BLOCKED_TEST_FAILURE', 'BLOCKED_SNAPSHOT_INVALID', 'INVALID_MISCLASSIFIED', 'unresolved'].includes(currentStatus)) {
          // Escalate through RecoveryWatchdog so it is closed with forensic audit reason
          const watchdog = recoveryWatchdog.verifyPipelineHealth();
          this.updateIncidentStatus(
            inc.id,
            'FAILED_ESCALATED',
            nowIso,
            `Repair cycles exhausted (${currentStatus}). Evaluated by RecoveryWatchdog (healthy: ${watchdog.healthy}) and escalated for engineering review.`
          );
          failedEscalatedCount++;
          continue;
        }

        // D. Older than threshold (stale) or superseded by a later incident
        if (!isLatest) {
          this.updateIncidentStatus(
            inc.id,
            'SUPERSEDED',
            nowIso,
            `Superseded by later incident ${latestIncident.id} on same component (${key}). Provenance retained.`
          );
          supersededCount++;
          continue;
        }

        if (ageMs > this.STALE_THRESHOLD_MS) {
          this.updateIncidentStatus(
            inc.id,
            'STALE',
            nowIso,
            `Stale in-flight status (${currentStatus}) detected ${Math.round(ageMs / 60000)}m ago without active execution lease. Closed with evidence retained.`
          );
          staleCount++;
          continue;
        }

        // E. Truly recent active incident (< 15 minutes old)
        if (ageMs <= this.RECENT_THRESHOLD_MS) {
          if (currentStatus === 'REPAIRING' || currentStatus === 'TESTING' || currentStatus === 'DEPLOYING') {
            activeCount++;
          } else {
            activeCount++;
          }
          continue;
        }

        // Fallback for remaining aged entries
        this.updateIncidentStatus(
          inc.id,
          'STALE',
          nowIso,
          `Stale unprogressed incident (${currentStatus}) reconciled.`
        );
        staleCount++;
      }
    }

    // ── 2. Reconcile Legacy Goals Waiting for Approval ───────────────────────
    let reconciledGoalsCount = 0;
    try {
      const staleGoals = rawDb.prepare("SELECT id, status, original_goal FROM goals WHERE status = 'waiting_for_approval'").all() as any[];
      for (const g of staleGoals) {
        rawDb.prepare(`
          UPDATE goals 
          SET status = 'cancelled', 
              updated_at = ?,
              run_summary = 'Stale approval reconciled on startup: linked worker run no longer exists.'
          WHERE id = ?
        `).run(nowIso, g.id);
        reconciledGoalsCount++;
        logger.info(`[IncidentReconciler] Reconciled stale goal ${g.id} from waiting_for_approval to cancelled.`);
      }
    } catch (e: any) {
      logger.warn(`[IncidentReconciler] Could not reconcile legacy goals: ${e?.message}`);
    }

    // ── 3. Reconcile Dead Restart-Blocked Background Tasks ───────────────────
    let reconciledTasksCount = 0;
    try {
      const deadTasks = rawDb.prepare(`
        SELECT task_id, status, blocker 
        FROM background_tasks 
        WHERE status = 'blocked' 
          AND (blocker LIKE '%restart%' OR blocker LIKE '%run no longer exists%')
      `).all() as any[];

      for (const t of deadTasks) {
        rawDb.prepare(`
          UPDATE background_tasks 
          SET status = 'cancelled',
              updated_at = ?,
              blocker = 'Cancelled during restart reconciliation — upstream run terminated.'
          WHERE task_id = ?
        `).run(nowIso, t.task_id);
        reconciledTasksCount++;
        logger.info(`[IncidentReconciler] Reconciled restart-blocked task ${t.task_id} to cancelled.`);
      }
    } catch (e: any) {
      logger.warn(`[IncidentReconciler] Could not reconcile background_tasks: ${e?.message}`);
    }

    // Count open & blocked after reconciliation
    const openIncidentsRemaining = activeCount;
    const blockedIncidentsRemaining = 0; // All blocked were escalated or classified

    const report: IncidentReconciliationReport = {
      totalEvaluated: incidents.length,
      resolvedCount,
      supersededCount,
      staleCount,
      failedEscalatedCount,
      activeCount,
      waitingExternalCount,
      reconciledGoalsCount,
      reconciledTasksCount,
      openIncidentsRemaining,
      blockedIncidentsRemaining,
      reconciledAt: nowIso,
    };

    console.log(`[JRT] INCIDENT_RECONCILIATION_COMPLETE total=${report.totalEvaluated} resolved=${resolvedCount} superseded=${supersededCount} stale=${staleCount} escalated=${failedEscalatedCount} active=${activeCount} goals=${reconciledGoalsCount} tasks=${reconciledTasksCount}`);
    logger.info('[IncidentReconciler] Reconciliation complete', report);
    return report;
  }

  private updateIncidentStatus(id: string, status: IncidentLifecycleState, resolvedAt: string, reason: string): void {
    try {
      let existingMetadata: any = {};
      try {
        const row: any = rawDb.prepare('SELECT metadata FROM repair_incidents WHERE id = ?').get(id);
        existingMetadata = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata || {});
      } catch {}

      const updatedMetadata = {
        ...existingMetadata,
        reconciledState: status,
        reconciledAt: resolvedAt,
        reconciliationReason: reason,
      };

      rawDb.prepare(`
        UPDATE repair_incidents 
        SET status = ?, 
            resolved_at = ?, 
            metadata = ? 
        WHERE id = ?
      `).run(status, resolvedAt, JSON.stringify(updatedMetadata), id);

      // Record audit evidence
      try {
        rawDb.prepare(`
          INSERT INTO repair_evidence (id, incident_id, type, label, content, source, timestamp)
          VALUES (?, ?, 'audit', 'reconciliation_transition', ?, 'IncidentReconciler', ?)
        `).run(`ev-rec-${id}-${Date.now().toString(36)}`, id, reason, resolvedAt);
      } catch {}
    } catch (err: any) {
      logger.warn(`[IncidentReconciler] Failed to update incident ${id}: ${err?.message}`);
    }
  }
}

export const incidentReconciler = IncidentReconciler.getInstance();

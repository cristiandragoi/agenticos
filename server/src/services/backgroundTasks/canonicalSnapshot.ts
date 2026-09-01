/**
 * services/backgroundTasks/canonicalSnapshot.ts
 *
 * ONE Authoritative Canonical Task Snapshot for AgenticOS.
 *
 * Normalizes every real AgenticOS state:
 * active (running, planning, executing, verifying, review, in_progress),
 * queued (queued, pending, scheduled),
 * awaitingApproval (waiting_approval, waiting_for_approval, approval_required, needs_approval),
 * blocked (blocked, paused, held),
 * completed (completed, success, done, verified_complete),
 * failed (failed, error, errored, verification_failed),
 * cancelled (cancelled, canceled, stopped, aborted),
 * unknown (unrecognized states — never silently coerced to queued).
 *
 * Tracks source errors so source failures cannot produce confidently incorrect counts.
 */

import { backgroundTaskManager } from './manager.js';
import { goalStore } from '../goalStore.js';
import { getCurrent as getCurrentExecution } from '../executionState.js';

export type NormalizedTaskStatus =
  | 'active'
  | 'queued'
  | 'awaitingApproval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface CanonicalTaskSummary {
  id: string;
  worker: string;
  status: NormalizedTaskStatus;
  rawStatus: string;
  title: string;
  createdAt?: string;
  source: 'background_task' | 'goal' | 'stream_execution';
}

export interface CanonicalTaskSnapshot {
  activeCount: number;
  queuedCount: number;
  awaitingApprovalCount: number;
  blockedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  unknownCount: number;
  totalCount: number;
  sourceErrors: Record<string, string>;
  activeTasks: CanonicalTaskSummary[];
  recentTasks: CanonicalTaskSummary[];
  summaryText: string;
  timestamp: string;
}

export function normalizeTaskStatus(rawStatus: string = ''): NormalizedTaskStatus {
  const s = String(rawStatus || '').toLowerCase().trim();
  if (['running', 'executing', 'planning', 'verifying', 'review', 'in_progress'].includes(s)) {
    return 'active';
  }
  if (['queued', 'pending', 'scheduled'].includes(s)) {
    return 'queued';
  }
  if (['waiting_approval', 'waiting_for_approval', 'approval_required', 'needs_approval'].includes(s)) {
    return 'awaitingApproval';
  }
  if (['blocked', 'paused', 'held'].includes(s)) {
    return 'blocked';
  }
  if (['completed', 'success', 'done', 'verified_complete'].includes(s)) {
    return 'completed';
  }
  if (['failed', 'error', 'errored', 'verification_failed'].includes(s)) {
    return 'failed';
  }
  if (['cancelled', 'canceled', 'stopped', 'aborted'].includes(s)) {
    return 'cancelled';
  }
  return 'unknown';
}

export function getCanonicalTaskSnapshot(conversationId?: string): CanonicalTaskSnapshot {
  const allSummaries: CanonicalTaskSummary[] = [];
  const sourceErrors: Record<string, string> = {};

  // 1. From backgroundTaskManager
  try {
    const tasks = backgroundTaskManager.listTasks({ limit: 50 }) || [];
    for (const t of tasks) {
      const raw = String(t.status || 'unknown');
      const status = normalizeTaskStatus(raw);

      allSummaries.push({
        id: String(t.taskId || ''),
        worker: String(t.worker || t.selectedAgent || 'unknown'),
        status,
        rawStatus: raw,
        title: String(t.title || t.objective || '').slice(0, 90),
        createdAt: t.createdAt,
        source: 'background_task',
      });
    }
  } catch (err: any) {
    sourceErrors.backgroundTaskManager = String(err?.message || err);
  }

  // 2. From goalStore (if scoped to conversation or active)
  try {
    const goals = conversationId
      ? goalStore.listByConversation(conversationId, 50) || []
      : goalStore.list({ limit: 50 }) || [];

    for (const g of goals) {
      const raw = String(g.status || 'unknown');
      const status = normalizeTaskStatus(raw);

      if (!allSummaries.some((s) => s.id === g.id)) {
        allSummaries.push({
          id: g.id,
          worker: 'codex',
          status,
          rawStatus: raw,
          title: String(g.originalGoal || 'CodeX Task').slice(0, 90),
          createdAt: g.createdAt,
          source: 'goal',
        });
      }
    }
  } catch (err: any) {
    sourceErrors.goalStore = String(err?.message || err);
  }

  // 3. From current stream execution if active and not already included
  try {
    const curr = getCurrentExecution();
    if (
      curr &&
      curr.operationId &&
      !['COMPLETED', 'FAILED', 'CANCELLED'].includes(curr.status) &&
      !allSummaries.some((s) => s.id === curr.operationId)
    ) {
      allSummaries.push({
        id: curr.operationId,
        worker: curr.worker || 'jarvis',
        status: 'active',
        rawStatus: curr.status || 'running',
        title: curr.currentAction || 'Active operation',
        source: 'stream_execution',
      });
    }
  } catch (err: any) {
    sourceErrors.streamExecution = String(err?.message || err);
  }

  const activeTasks = allSummaries.filter((s) => s.status === 'active');
  const queuedTasks = allSummaries.filter((s) => s.status === 'queued');
  const awaitingApprovalTasks = allSummaries.filter((s) => s.status === 'awaitingApproval');
  const blockedTasks = allSummaries.filter((s) => s.status === 'blocked');
  const completedTasks = allSummaries.filter((s) => s.status === 'completed');
  const failedTasks = allSummaries.filter((s) => s.status === 'failed');
  const cancelledTasks = allSummaries.filter((s) => s.status === 'cancelled');
  const unknownTasks = allSummaries.filter((s) => s.status === 'unknown');

  const summaryParts: string[] = [];
  if (activeTasks.length > 0) {
    summaryParts.push(`${activeTasks.length} active (${activeTasks.map((t) => `${t.worker}: "${t.title.slice(0, 30)}"`).join(', ')})`);
  }
  if (queuedTasks.length > 0) {
    summaryParts.push(`${queuedTasks.length} queued`);
  }
  if (awaitingApprovalTasks.length > 0) {
    summaryParts.push(`${awaitingApprovalTasks.length} awaiting approval`);
  }
  if (blockedTasks.length > 0) {
    summaryParts.push(`${blockedTasks.length} blocked`);
  }
  if (failedTasks.length > 0) {
    summaryParts.push(`${failedTasks.length} failed`);
  }
  if (completedTasks.length > 0) {
    summaryParts.push(`${completedTasks.length} completed`);
  }

  const summaryText = summaryParts.length > 0 ? summaryParts.join(', ') : 'no active background tasks';

  return {
    activeCount: activeTasks.length,
    queuedCount: queuedTasks.length,
    awaitingApprovalCount: awaitingApprovalTasks.length,
    blockedCount: blockedTasks.length,
    completedCount: completedTasks.length,
    failedCount: failedTasks.length,
    cancelledCount: cancelledTasks.length,
    unknownCount: unknownTasks.length,
    totalCount: allSummaries.length,
    sourceErrors,
    activeTasks,
    recentTasks: allSummaries.slice(0, 10),
    summaryText,
    timestamp: new Date().toISOString(),
  };
}

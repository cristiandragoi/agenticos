/**
 * projectTaskService.ts
 *
 * CRUD for project_goals and project_tasks tables.
 * Entirely backed by rawDb (no drizzle schema for new tables).
 */

import { randomUUID } from 'crypto';
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import type { TaskStatus, WorkerType } from './schema.js';

// ── Type definitions ─────────────────────────────────────────────────────

export interface ProjectGoalRecord {
  id: string;
  projectId: string;
  goalId: string | null;
  title: string;
  objective: string | null;
  priority: string;
  status: string;
  successCriteria: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ProjectTaskRecord {
  id: string;
  projectId: string;
  goalId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  taskType: string;
  status: TaskStatus;
  assignedCapability: WorkerType | null;
  assignedRunId: string | null;
  priority: string;
  dependencyIds: string[];
  acceptanceCriteria: string | null;
  approvalRequired: boolean;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToGoal(row: any): ProjectGoalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    goalId: row.goal_id ?? null,
    title: row.title,
    objective: row.objective ?? null,
    priority: row.priority,
    status: row.status,
    successCriteria: row.success_criteria ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
    metadata: parseJson(row.metadata, null),
  };
}

function rowToTask(row: any): ProjectTaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    goalId: row.goal_id,
    parentTaskId: row.parent_task_id ?? null,
    title: row.title,
    description: row.description ?? null,
    taskType: row.task_type,
    status: row.status as TaskStatus,
    assignedCapability: (row.assigned_capability as WorkerType) ?? null,
    assignedRunId: row.assigned_run_id ?? null,
    priority: row.priority,
    dependencyIds: parseJson(row.dependency_ids, []),
    acceptanceCriteria: row.acceptance_criteria ?? null,
    approvalRequired: !!row.approval_required,
    retryCount: row.retry_count ?? 0,
    maxRetries: row.max_retries ?? 3,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    metadata: parseJson(row.metadata, null),
  };
}

// ── Goal operations ────────────────────────────────────────────────────────

export const projectTaskService = {

  // ── Goals ──────────────────────────────────────────────────────────────

  createGoal(data: {
    projectId: string;
    title: string;
    objective?: string;
    priority?: string;
    successCriteria?: string;
    createdBy?: string;
    goalId?: string; // existing CodeX goal reference
    metadata?: Record<string, unknown>;
  }): ProjectGoalRecord {
    const id = `pg-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO project_goals
        (id, project_id, goal_id, title, objective, priority, status, success_criteria, created_by, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?)
    `).run(
      id,
      data.projectId,
      data.goalId ?? null,
      data.title,
      data.objective ?? null,
      data.priority ?? 'medium',
      data.successCriteria ?? null,
      data.createdBy ?? null,
      now,
      now,
      data.metadata ? JSON.stringify(data.metadata) : null,
    );
    return this.getGoal(id)!;
  },

  getGoal(id: string): ProjectGoalRecord | null {
    const row = rawDb.prepare('SELECT * FROM project_goals WHERE id = ?').get(id);
    return row ? rowToGoal(row) : null;
  },

  listGoals(projectId: string): ProjectGoalRecord[] {
    const rows = rawDb.prepare(
      'SELECT * FROM project_goals WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId);
    return rows.map(rowToGoal);
  },

  updateGoal(id: string, patch: Partial<{
    status: string;
    completedAt: string;
    title: string;
    objective: string;
  }>): ProjectGoalRecord | null {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
    if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(patch.completedAt); }
    if (patch.title !== undefined) { sets.push('title = ?'); vals.push(patch.title); }
    if (patch.objective !== undefined) { sets.push('objective = ?'); vals.push(patch.objective); }
    vals.push(id);
    rawDb.prepare(`UPDATE project_goals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getGoal(id);
  },

  // ── Tasks ──────────────────────────────────────────────────────────────

  createTask(data: {
    projectId: string;
    goalId: string;
    title: string;
    description?: string;
    taskType?: string;
    assignedCapability?: WorkerType;
    parentTaskId?: string;
    priority?: string;
    dependencyIds?: string[];
    acceptanceCriteria?: string;
    approvalRequired?: boolean;
    metadata?: Record<string, unknown>;
  }): ProjectTaskRecord {
    const id = `pt-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO project_tasks
        (id, project_id, goal_id, parent_task_id, title, description, task_type, status,
         assigned_capability, priority, dependency_ids, acceptance_criteria, approval_required,
         retry_count, max_retries, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, 3, ?, ?, ?)
    `).run(
      id,
      data.projectId,
      data.goalId,
      data.parentTaskId ?? null,
      data.title,
      data.description ?? null,
      data.taskType ?? 'generic',
      data.assignedCapability ?? null,
      data.priority ?? 'medium',
      data.dependencyIds ? JSON.stringify(data.dependencyIds) : JSON.stringify([]),
      data.acceptanceCriteria ?? null,
      data.approvalRequired ? 1 : 0,
      now,
      now,
      data.metadata ? JSON.stringify(data.metadata) : null,
    );
    return this.getTask(id)!;
  },

  getTask(id: string): ProjectTaskRecord | null {
    const row = rawDb.prepare('SELECT * FROM project_tasks WHERE id = ?').get(id);
    return row ? rowToTask(row) : null;
  },

  listTasks(goalId: string): ProjectTaskRecord[] {
    const rows = rawDb.prepare(
      'SELECT * FROM project_tasks WHERE goal_id = ? ORDER BY created_at ASC'
    ).all(goalId);
    return rows.map(rowToTask);
  },

  listTasksByProject(projectId: string): ProjectTaskRecord[] {
    const rows = rawDb.prepare(
      'SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId);
    return rows.map(rowToTask);
  },

  updateTask(id: string, patch: Partial<{
    status: TaskStatus;
    assignedRunId: string;
    assignedCapability: WorkerType;
    startedAt: string;
    completedAt: string;
    retryCount: number;
  }>): ProjectTaskRecord | null {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
    if (patch.assignedRunId !== undefined) { sets.push('assigned_run_id = ?'); vals.push(patch.assignedRunId); }
    if (patch.assignedCapability !== undefined) { sets.push('assigned_capability = ?'); vals.push(patch.assignedCapability); }
    if (patch.startedAt !== undefined) { sets.push('started_at = ?'); vals.push(patch.startedAt); }
    if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(patch.completedAt); }
    if (patch.retryCount !== undefined) { sets.push('retry_count = ?'); vals.push(patch.retryCount); }
    vals.push(id);
    rawDb.prepare(`UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getTask(id);
  },

  /**
   * Build the complete task tree for a goal (with subtask nesting).
   */
  getTaskTree(goalId: string): (ProjectTaskRecord & { children: ProjectTaskRecord[] })[] {
    const tasks = this.listTasks(goalId);
    const map = new Map<string, ProjectTaskRecord & { children: ProjectTaskRecord[] }>();
    const roots: (ProjectTaskRecord & { children: ProjectTaskRecord[] })[] = [];

    for (const t of tasks) {
      map.set(t.id, { ...t, children: [] });
    }
    for (const t of tasks) {
      const node = map.get(t.id)!;
      if (t.parentTaskId && map.has(t.parentTaskId)) {
        map.get(t.parentTaskId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  },
};

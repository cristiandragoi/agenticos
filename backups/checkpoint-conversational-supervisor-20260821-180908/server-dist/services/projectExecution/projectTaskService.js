/**
 * projectTaskService.ts
 *
 * CRUD for project_goals and project_tasks tables.
 * Entirely backed by rawDb (no drizzle schema for new tables).
 */
import { randomUUID } from 'crypto';
import { rawDb } from '../../db/index.js';
// ── Helpers ──────────────────────────────────────────────────────────────
function parseJson(value, fallback) {
    if (!value)
        return fallback;
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function rowToGoal(row) {
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
function rowToTask(row) {
    return {
        id: row.id,
        projectId: row.project_id,
        goalId: row.goal_id,
        parentTaskId: row.parent_task_id ?? null,
        title: row.title,
        description: row.description ?? null,
        taskType: row.task_type,
        status: row.status,
        assignedCapability: row.assigned_capability ?? null,
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
    createGoal(data) {
        const id = `pg-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        rawDb.prepare(`
      INSERT INTO project_goals
        (id, project_id, goal_id, title, objective, priority, status, success_criteria, created_by, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?)
    `).run(id, data.projectId, data.goalId ?? null, data.title, data.objective ?? null, data.priority ?? 'medium', data.successCriteria ?? null, data.createdBy ?? null, now, now, data.metadata ? JSON.stringify(data.metadata) : null);
        return this.getGoal(id);
    },
    getGoal(id) {
        const row = rawDb.prepare('SELECT * FROM project_goals WHERE id = ?').get(id);
        return row ? rowToGoal(row) : null;
    },
    listGoals(projectId) {
        const rows = rawDb.prepare('SELECT * FROM project_goals WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
        return rows.map(rowToGoal);
    },
    updateGoal(id, patch) {
        const now = new Date().toISOString();
        const sets = ['updated_at = ?'];
        const vals = [now];
        if (patch.status !== undefined) {
            sets.push('status = ?');
            vals.push(patch.status);
        }
        if (patch.completedAt !== undefined) {
            sets.push('completed_at = ?');
            vals.push(patch.completedAt);
        }
        if (patch.title !== undefined) {
            sets.push('title = ?');
            vals.push(patch.title);
        }
        if (patch.objective !== undefined) {
            sets.push('objective = ?');
            vals.push(patch.objective);
        }
        vals.push(id);
        rawDb.prepare(`UPDATE project_goals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        return this.getGoal(id);
    },
    // ── Tasks ──────────────────────────────────────────────────────────────
    createTask(data) {
        const id = `pt-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        rawDb.prepare(`
      INSERT INTO project_tasks
        (id, project_id, goal_id, parent_task_id, title, description, task_type, status,
         assigned_capability, priority, dependency_ids, acceptance_criteria, approval_required,
         retry_count, max_retries, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, 3, ?, ?, ?)
    `).run(id, data.projectId, data.goalId, data.parentTaskId ?? null, data.title, data.description ?? null, data.taskType ?? 'generic', data.assignedCapability ?? null, data.priority ?? 'medium', data.dependencyIds ? JSON.stringify(data.dependencyIds) : JSON.stringify([]), data.acceptanceCriteria ?? null, data.approvalRequired ? 1 : 0, now, now, data.metadata ? JSON.stringify(data.metadata) : null);
        return this.getTask(id);
    },
    getTask(id) {
        const row = rawDb.prepare('SELECT * FROM project_tasks WHERE id = ?').get(id);
        return row ? rowToTask(row) : null;
    },
    listTasks(goalId) {
        const rows = rawDb.prepare('SELECT * FROM project_tasks WHERE goal_id = ? ORDER BY created_at ASC').all(goalId);
        return rows.map(rowToTask);
    },
    listTasksByProject(projectId) {
        const rows = rawDb.prepare('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
        return rows.map(rowToTask);
    },
    updateTask(id, patch) {
        const now = new Date().toISOString();
        const sets = ['updated_at = ?'];
        const vals = [now];
        if (patch.status !== undefined) {
            sets.push('status = ?');
            vals.push(patch.status);
        }
        if (patch.assignedRunId !== undefined) {
            sets.push('assigned_run_id = ?');
            vals.push(patch.assignedRunId);
        }
        if (patch.assignedCapability !== undefined) {
            sets.push('assigned_capability = ?');
            vals.push(patch.assignedCapability);
        }
        if (patch.startedAt !== undefined) {
            sets.push('started_at = ?');
            vals.push(patch.startedAt);
        }
        if (patch.completedAt !== undefined) {
            sets.push('completed_at = ?');
            vals.push(patch.completedAt);
        }
        if (patch.retryCount !== undefined) {
            sets.push('retry_count = ?');
            vals.push(patch.retryCount);
        }
        vals.push(id);
        rawDb.prepare(`UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        return this.getTask(id);
    },
    /**
     * Build the complete task tree for a goal (with subtask nesting).
     */
    getTaskTree(goalId) {
        const tasks = this.listTasks(goalId);
        const map = new Map();
        const roots = [];
        for (const t of tasks) {
            map.set(t.id, { ...t, children: [] });
        }
        for (const t of tasks) {
            const node = map.get(t.id);
            if (t.parentTaskId && map.has(t.parentTaskId)) {
                map.get(t.parentTaskId).children.push(node);
            }
            else {
                roots.push(node);
            }
        }
        return roots;
    },
};

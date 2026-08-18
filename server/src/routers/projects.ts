import { Router } from 'express';
import { projectsStore } from '../services/projectsStore.js';
import { policyStore } from '../services/policy/policyStore.js';
import { projectTaskService } from '../services/projectExecution/projectTaskService.js';
import { executionRunService } from '../services/projectExecution/executionRunService.js';
import { verificationService } from '../services/projectExecution/verificationService.js';
import { randomUUID } from 'crypto';

const router = Router();

// GET /api/projects
router.get('/', (_req, res) => {
  try {
    const list = projectsStore.listProjects();
    // Active-project truth: the raw stored id is only reported when it
    // resolves to a REAL project. A stale/ghost id must never be exposed as
    // the active project.
    const rawId = projectsStore.getActiveProjectId();
    const activeProjectId = rawId && projectsStore.getProject(rawId) ? rawId : null;
    res.json({ projects: list, activeProjectId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/active  (must come BEFORE /:id)
router.get('/active', (_req, res) => {
  try {
    const project = projectsStore.getActiveProject();
    const id = projectsStore.getActiveProjectId();
    res.json({ project, activeProjectId: id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/active
router.post('/active', (req, res) => {
  try {
    const { projectId } = req.body;
    projectsStore.setActiveProjectId(projectId ?? null);
    const project = projectId ? projectsStore.getProject(projectId) : null;
    res.json({ activeProjectId: projectId ?? null, project });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects
router.post('/', (req, res) => {
  try {
    const { name, description, status, tags, workspacePath, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = `proj-${randomUUID().slice(0, 8)}`;
    const project = projectsStore.createProject({ id, name, description, status, tags, workspacePath, color });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  try {
    const project = projectsStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  try {
    const { name, description, status, tags, workspacePath, color } = req.body;
    const project = projectsStore.updateProject(req.params.id, { name, description, status, tags, workspacePath, color });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  try {
    projectsStore.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/policy — effective privacy/runtime policy (default
// when unset; never throws).
router.get('/:id/policy', (req, res) => {
  try {
    const project = projectsStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ projectId: req.params.id, policy: policyStore.getPolicy(req.params.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id/policy — validate + persist. Invalid or contradictory
// policies are rejected with 400 (policyService.validatePolicy).
router.put('/:id/policy', (req, res) => {
  try {
    const project = projectsStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const policy = policyStore.setPolicy(req.params.id, req.body);
    res.json({ projectId: req.params.id, policy });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/knowledge
router.get('/:projectId/knowledge', (req, res) => {
  try {
    const items = projectsStore.listKnowledgeItems(req.params.projectId);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:projectId/knowledge
router.post('/:projectId/knowledge', (req, res) => {
  try {
    const { title, content, type, tags, linkedIds } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id = `ki-${randomUUID().slice(0, 8)}`;
    const item = projectsStore.createKnowledgeItem({
      id,
      projectId: req.params.projectId,
      title,
      content,
      type,
      tags,
      linkedIds,
    });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:projectId/knowledge/:id
router.put('/:projectId/knowledge/:id', (req, res) => {
  try {
    const { title, content, type, tags, linkedIds } = req.body;
    const item = projectsStore.updateKnowledgeItem(req.params.id, { title, content, type, tags, linkedIds });
    if (!item) return res.status(404).json({ error: 'Knowledge item not found' });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:projectId/knowledge/:id
router.delete('/:projectId/knowledge/:id', (req, res) => {
  try {
    projectsStore.deleteKnowledgeItem(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/agents — assigned agent ids
router.get('/:projectId/agents', (req, res) => {
  try {
    const ids = projectsStore.listAssignedAgents(req.params.projectId);
    res.json({ agents: ids });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:projectId/agents — assign an existing registry agent
router.post('/:projectId/agents', (req, res) => {
  try {
    const { agentId } = req.body || {};
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    const link = projectsStore.assignAgent(req.params.projectId, agentId);
    res.json({ ok: true, link });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:projectId/agents/:agentId — remove assignment
router.delete('/:projectId/agents/:agentId', (req, res) => {
  try {
    projectsStore.unassignAgent(req.params.projectId, req.params.agentId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/artifacts — project-scoped artifacts
router.get('/:projectId/artifacts', async (req, res) => {
  try {
    const { db } = await import('../services/db.js');
    const artifacts = await db.artifacts.list();
    const scoped = artifacts.filter((a: any) => a.projectId === req.params.projectId);
    res.json(scoped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:projectId/artifacts — create a project artifact record
router.post('/:projectId/artifacts', async (req, res) => {
  try {
    const { db } = await import('../services/db.js');
    const { id, type, title, preview, content, taskId, linkedAgentId, location, createdBy, verificationState } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const artifactId = id || `art-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const artifact: any = {
      id: artifactId, type: type || 'document', title, preview: preview || '',
      content, taskId, linkedAgentId, location, createdBy, verificationState: verificationState || 'pending',
      projectId: req.params.projectId, version: '1.0', status: 'active', createdAt: now, updatedAt: now,
    };
    await db.artifacts.upsert(artifact);
    res.json(artifact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/tree — Full execution tree (goals → tasks → runs → results → verifications)
router.get('/:id/tree', (req, res) => {
  try {
    const project = projectsStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const goals = projectTaskService.listGoals(req.params.id);
    const tree = goals.map(goal => {
      const tasks = projectTaskService.getTaskTree(goal.id);
      const enrichedTasks = tasks.map((task: any) => {
        const runs = executionRunService.listRunsForTask(task.id);
        const enrichedRuns = runs.map(run => {
          const result = run.finalResultId ? executionRunService.getResult(run.finalResultId) : null;
          const verification = verificationService.getVerificationForRun(run.id);
          return { ...run, result, verification };
        });
        const children = (task.children || []).map((child: any) => {
          const childRuns = executionRunService.listRunsForTask(child.id);
          return { ...child, runs: childRuns };
        });
        return { ...task, children, runs: enrichedRuns };
      });
      return { ...goal, tasks: enrichedTasks };
    });
    res.json({ project, goals: tree });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/goals — List project goals (shortcuts to project-execution API)
router.get('/:id/goals', (req, res) => {
  try {
    const goals = projectTaskService.listGoals(req.params.id);
    res.json(goals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/goals
router.post('/:id/goals', (req, res) => {
  try {
    const { title, objective, priority, successCriteria, createdBy, goalId, metadata } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const goal = projectTaskService.createGoal({
      projectId: req.params.id,
      title,
      objective,
      priority,
      successCriteria,
      createdBy,
      goalId,
      metadata,
    });
    res.json(goal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/goals/:goalId/tasks
router.post('/:id/goals/:goalId/tasks', (req, res) => {
  try {
    const { title, description, taskType, assignedCapability, parentTaskId, priority,
      dependencyIds, acceptanceCriteria, approvalRequired, metadata } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const task = projectTaskService.createTask({
      projectId: req.params.id,
      goalId: req.params.goalId,
      title,
      description,
      taskType,
      assignedCapability,
      parentTaskId,
      priority,
      dependencyIds,
      acceptanceCriteria,
      approvalRequired,
      metadata,
    });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

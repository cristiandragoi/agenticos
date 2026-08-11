import { Router } from 'express';
import { projectsStore } from '../services/projectsStore.js';
import { randomUUID } from 'crypto';

const router = Router();

// GET /api/projects
router.get('/', (_req, res) => {
  try {
    const list = projectsStore.listProjects();
    const activeProjectId = projectsStore.getActiveProjectId();
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

export default router;

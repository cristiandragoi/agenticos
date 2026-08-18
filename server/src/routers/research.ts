import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { db } from '../services/db.js';
import { runStore } from '../services/runStore.js';
import { randomUUID as uuidv4 } from 'crypto';
import { executeResearchBriefWorkflow } from '../workflows/researchBrief.js';
import type { ResearchBrief } from '../types.js';

const router = Router();

// GET /api/research/briefs
router.get('/briefs', (req, res) => {
  const briefs = db.researchBriefs.list();
  res.json(briefs);
});

// POST /api/research/brief
router.post('/brief', (req, res) => {
  const { title, requestType, target, goal, competitors, priority, outputFormat } = req.body;

  const briefId = `brief-${uuidv4()}`;
  const runId = `run-${uuidv4()}`;

  const newBrief: ResearchBrief = {
    id: briefId,
    title,
    requestType,
    target,
    goal,
    competitors: competitors || [],
    priority,
    outputFormat,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runId,
    artifactIds: []
  };

  db.researchBriefs.upsert(newBrief);

  // Create the Run
  runStore.create({
    id: runId,
    agentId: 'agent-hermes', // Hermes execution agent
    sessionId: 'sess-research',
    workspaceId: 'ws-default',
    mode: 'workflow',
    status: 'queued',
    input: `Execute research brief: ${title}`,
    logs: ['Received research brief request.'],
    events: [],
    linkedArtifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Asynchronously execute workflow
  executeResearchBriefWorkflow(briefId, runId).catch(logger.error);

  res.json({ success: true, brief: newBrief, runId });
});

// POST /api/research/brief/:id/approve
router.post('/brief/:id/approve', (req, res) => {
  const briefId = req.params.id;
  const brief = db.researchBriefs.get(briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  brief.status = 'approved';
  brief.updatedAt = new Date().toISOString();
  db.researchBriefs.upsert(brief);

  if (brief.runId) {
    runStore.update(brief.runId, { status: 'approved' });
    runStore.appendLog(brief.runId, 'Operator approved the research brief.');
  }

  res.json({ success: true, brief });
});

export const researchRouter = router;

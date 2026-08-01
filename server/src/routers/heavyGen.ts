import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { executeFuguProjectWorkflow } from '../workflows/fuguProjectBuilder.js';
import { executeFusionPlannerWorkflow } from '../workflows/fusionPlanner.js';

const router = Router();

// POST /api/heavy-gen/fugu
router.post('/fugu', async (req, res) => {
  const { projectName, brief } = req.body;
  
  if (!projectName || !brief) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'projectName and brief are required' } });
  }

  // Execute async workflow without blocking the response entirely,
  // but wait for initialization
  executeFuguProjectWorkflow(projectName, brief).catch(logger.error);

  res.status(202).json({ success: true, message: 'Fugu project build started.' });
});

// POST /api/heavy-gen/fusion
router.post('/fusion', async (req, res) => {
  const { projectName, brief } = req.body;
  
  if (!projectName || !brief) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'projectName and brief are required' } });
  }

  executeFusionPlannerWorkflow(projectName, brief).catch(logger.error);

  res.status(202).json({ success: true, message: 'Fusion planner started.' });
});

export default router;

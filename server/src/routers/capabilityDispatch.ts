import { Router } from 'express';
import { capabilityDispatcher } from '../services/dispatcher/capabilityDispatcher.js';
import { runtimeRegistry } from '../services/runtimeRegistry.js';
import { logger } from '../utils/logger.js';

export const capabilityDispatchRouter = Router();

// GET /api/dispatch/capability/runtimes — Lists registered adapters and their capabilities
capabilityDispatchRouter.get('/runtimes', (_req, res) => {
  res.json({
    runtimes: runtimeRegistry.listRuntimes(),
  });
});

// POST /api/dispatch/capability — Dispatch a task with capability constraints
capabilityDispatchRouter.post('/', async (req, res) => {
  try {
    const { taskId, requiredCapabilities, preferredExecutorId, excludedExecutorIds, prompt, correlationId } = req.body;

    if (!taskId || !Array.isArray(requiredCapabilities)) {
      res.status(400).json({ error: 'taskId and requiredCapabilities array are required.' });
      return;
    }

    const result = await capabilityDispatcher.dispatch({
      canonicalTaskId: taskId,
      requiredCapabilities,
      preferredExecutorId,
      excludedExecutorIds,
      prompt,
      correlationId,
    });

    res.json(result);
  } catch (err: any) {
    logger.error('[CapabilityDispatchRouter] Dispatch error:', err);
    res.status(500).json({ error: err.message, code: err.code || 'DISPATCH_ERROR' });
  }
});

// GET /api/dispatch/capability/proof — Runs canonical proof task
capabilityDispatchRouter.get('/proof', async (req, res) => {
  try {
    const port = req.socket.localPort || 4000;
    const proofResult = await capabilityDispatcher.runProofTask(port);
    res.json(proofResult);
  } catch (err: any) {
    logger.error('[CapabilityDispatchRouter] Proof error:', err);
    res.status(500).json({ error: err.message });
  }
});

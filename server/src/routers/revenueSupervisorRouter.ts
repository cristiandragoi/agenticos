import { Router } from 'express';
import { revenueSupervisor } from '../services/revenueOperator/revenueSupervisor.js';
import { revenueBriefingService } from '../services/revenueOperator/briefingService.js';
import { logger } from '../utils/logger.js';

export const revenueSupervisorRouter = Router();

// GET /api/revenue-supervisor/status — Returns live supervisor status, active mission, branches, and briefing
revenueSupervisorRouter.get('/status', async (_req, res) => {
  try {
    const status = await revenueSupervisor.getStatus();
    res.json(status);
  } catch (err: any) {
    logger.error('[RevenueSupervisorRouter] Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/revenue-supervisor/control — START | PAUSE | RESUME | STOP
revenueSupervisorRouter.post('/control', async (req, res) => {
  try {
    const { action, missionId, envelope, payload, signature } = req.body;
    if (!['START', 'PAUSE', 'RESUME', 'STOP'].includes(action)) {
      res.status(400).json({ error: "Invalid action. Must be one of: 'START', 'PAUSE', 'RESUME', 'STOP'" });
      return;
    }
    const approval = envelope || (payload && signature ? { payload, signature } : undefined);
    const result = revenueSupervisor.setControlState(action, missionId, { approval });
    if (!result.success && result.error?.startsWith('APPROVAL_REQUIRED')) {
      return res.status(403).json(result);
    }
    res.json(result);
  } catch (err: any) {
    logger.error('[RevenueSupervisorRouter] Control error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/revenue-supervisor/briefing/daily — Generate daily briefing
revenueSupervisorRouter.post('/briefing/daily', async (req, res) => {
  try {
    const { missionId } = req.body;
    const briefing = await revenueBriefingService.generateBriefing(missionId || 'mission-616808fe-', 'daily');
    res.json(briefing);
  } catch (err: any) {
    logger.error('[RevenueSupervisorRouter] Daily briefing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/revenue-supervisor/briefing/weekly — Generate weekly briefing
revenueSupervisorRouter.post('/briefing/weekly', async (req, res) => {
  try {
    const { missionId } = req.body;
    const briefing = await revenueBriefingService.generateBriefing(missionId || 'mission-616808fe-', 'weekly');
    res.json(briefing);
  } catch (err: any) {
    logger.error('[RevenueSupervisorRouter] Weekly briefing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/revenue-supervisor/trigger — Force run a supervisor cycle
revenueSupervisorRouter.post('/trigger', async (req, res) => {
  try {
    const { envelope, payload, signature } = req.body || {};
    const approval = envelope || (payload && signature ? { payload, signature } : undefined);
    const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
    if (!isTestBypass && !approval) {
      return res.status(403).json({
        error: 'APPROVAL_REQUIRED',
        message: 'Triggering revenue supervisor cycle requires verified human approval.',
      });
    }
    const status = await revenueSupervisor.runSupervisorCycle();
    res.json(status);
  } catch (err: any) {
    logger.error('[RevenueSupervisorRouter] Trigger error:', err);
    res.status(500).json({ error: err.message });
  }
});

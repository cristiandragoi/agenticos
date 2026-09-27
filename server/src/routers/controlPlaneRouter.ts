/**
 * controlPlaneRouter.ts — REST API for Universal Control Plane & Goal Runs
 *
 * Implements Section 6, 18, and 19:
 * Exposes repository authority status, goal run timelines, capability discovery,
 * and learned repair memory to the UI and clients.
 */

import { Router, Request, Response } from 'express';
import { repositoryAuthority } from '../domains/controlPlane/RepositoryAuthority.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { capabilityDiscovery } from '../domains/controlPlane/CapabilityDiscovery.js';
import { repairKnowledgeStore } from '../domains/controlPlane/RepairKnowledgeStore.js';
import { recoveryWatchdog } from '../domains/controlPlane/RecoveryWatchdog.js';

export const controlPlaneRouter = Router();

// GET /api/control-plane/repository — Repository Authority status & health
controlPlaneRouter.get('/repository', (_req: Request, res: Response) => {
  res.json(repositoryAuthority.getStatus());
});

// POST /api/control-plane/repository/reconcile — Re-trigger repository discovery & reconcile
controlPlaneRouter.post('/repository/reconcile', (_req: Request, res: Response) => {
  const status = repositoryAuthority.reconcileAndValidate();
  res.json(status);
});

// GET /api/control-plane/goals — List recent goal runs
controlPlaneRouter.get('/goals', (req: Request, res: Response) => {
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
  res.json(goalLifecycleManager.listGoalRuns(limit));
});

// GET /api/control-plane/goals/:id — Single goal run detail
controlPlaneRouter.get('/goals/:id', (req: Request, res: Response) => {
  const goal = goalLifecycleManager.getGoalRun(req.params.id);
  if (!goal) {
    res.status(404).json({ error: `Goal ${req.params.id} not found.` });
    return;
  }
  res.json(goal);
});

// GET /api/control-plane/goals/:id/timeline — Timeline events for UI observability
controlPlaneRouter.get('/goals/:id/timeline', (req: Request, res: Response) => {
  const goal = goalLifecycleManager.getGoalRun(req.params.id);
  if (!goal) {
    res.status(404).json({ error: `Goal ${req.params.id} not found.` });
    return;
  }
  res.json({ goalId: goal.goalId, status: goal.status, timeline: goal.timeline });
});

// GET /api/control-plane/knowledge — List learned resolutions
controlPlaneRouter.get('/knowledge', (_req: Request, res: Response) => {
  res.json(repairKnowledgeStore.listAll());
});

// GET /api/control-plane/health — Overall control plane & watchdog health
controlPlaneRouter.get('/health', (_req: Request, res: Response) => {
  const repo = repositoryAuthority.getStatus();
  const watchdog = recoveryWatchdog.verifyPipelineHealth();

  res.json({
    healthy: repo.health.healthy && watchdog.healthy,
    repository: repo,
    recoveryWatchdog: watchdog,
    timestamp: new Date().toISOString(),
  });
});

// POST /api/control-plane/discover — Test discovery for arbitrary target
controlPlaneRouter.post('/discover', async (req: Request, res: Response) => {
  try {
    const { target, actionType } = req.body || {};
    if (!target) {
      res.status(400).json({ error: 'target is required' });
      return;
    }
    const candidates = await capabilityDiscovery.discover(target, actionType || 'open');
    res.json({ target, candidates });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/production-readiness — Authoritative ProductionReadinessState across 16 domains
controlPlaneRouter.get('/production-readiness', async (_req: Request, res: Response) => {
  try {
    const { productionReadinessManager } = await import('../domains/controlPlane/ProductionReadinessManager.js');
    const state = await productionReadinessManager.evaluateReadiness();
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/control-plane/incidents/reconcile — Authoritative incident lifecycle reconciliation
controlPlaneRouter.post('/incidents/reconcile', async (_req: Request, res: Response) => {
  try {
    const { incidentReconciler } = await import('../domains/selfHeal/IncidentReconciler.js');
    const report = incidentReconciler.reconcileAll();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Camera endpoints (Section 13)
controlPlaneRouter.get('/camera/status', async (_req: Request, res: Response) => {
  try {
    const { cameraPerceptionService } = await import('../services/perception/CameraPerceptionService.js');
    const devices = await cameraPerceptionService.enumerateDevices();
    res.json({ ...cameraPerceptionService.getStatus(), devices });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

controlPlaneRouter.post('/camera/permission', async (req: Request, res: Response) => {
  try {
    const { cameraPerceptionService } = await import('../services/perception/CameraPerceptionService.js');
    const enabled = Boolean(req.body?.enabled !== false);
    cameraPerceptionService.setEnabled(enabled);
    res.json({ success: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Location endpoints (Section 14)
controlPlaneRouter.get('/location', async (_req: Request, res: Response) => {
  try {
    const { locationService } = await import('../services/perception/LocationService.js');
    const loc = await locationService.readLocation();
    res.json(loc);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

controlPlaneRouter.post('/location/permission', async (req: Request, res: Response) => {
  try {
    const { locationService } = await import('../services/perception/LocationService.js');
    const enabled = Boolean(req.body?.enabled !== false);
    locationService.setEnabled(enabled);
    res.json({ success: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

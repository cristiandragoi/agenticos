/**
 * controlPlaneRouter.ts — REST API for Universal Control Plane & Goal Runs
 *
 * Implements Section 6, 18, and 19:
 * Exposes repository authority status, goal run timelines, capability discovery,
 * and learned repair memory to the UI and clients.
 */

import { Router, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { repositoryAuthority } from '../domains/controlPlane/RepositoryAuthority.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { capabilityDiscovery } from '../domains/controlPlane/CapabilityDiscovery.js';
import { repairKnowledgeStore } from '../domains/controlPlane/RepairKnowledgeStore.js';
import { recoveryWatchdog } from '../domains/controlPlane/RecoveryWatchdog.js';
import { capabilityPermissionStore } from '../domains/controlPlane/CapabilityPermissionStore.js';
import { liveAcceptanceManager } from '../domains/controlPlane/LiveAcceptanceManager.js';

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

// Capability Permissions endpoints (Section 1 & 4)
controlPlaneRouter.get('/permissions', (_req: Request, res: Response) => {
  try {
    const permissions = capabilityPermissionStore.getAllPermissions();
    res.json({ success: true, permissions });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

controlPlaneRouter.post('/permissions', (req: Request, res: Response) => {
  try {
    const { capability, allowed } = req.body || {};
    if (!capability || typeof allowed !== 'boolean') {
      res.status(400).json({ error: 'capability (string) and allowed (boolean) are required' });
      return;
    }
    const state = allowed ? 'allowed' : 'denied';
    capabilityPermissionStore.setPermission(capability, state);
    res.json({ success: true, capability, state });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Verifiable Screenshot Artifact serving (Section 7)
controlPlaneRouter.get('/artifacts/screenshots/:fileName', (req: Request, res: Response) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const filePath = path.resolve(process.cwd(), 'data', 'artifacts', 'screenshots', fileName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Screenshot not found' });
      return;
    }
    res.sendFile(filePath);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Live Acceptance Mode endpoints (Section 23, 24, 25)
controlPlaneRouter.get('/live-acceptance', (_req: Request, res: Response) => {
  try {
    res.json(liveAcceptanceManager.getState());
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

controlPlaneRouter.post('/live-acceptance/select-test', (req: Request, res: Response) => {
  try {
    const { testId } = req.body || {};
    if (!testId) {
      res.status(400).json({ error: 'testId is required' });
      return;
    }
    const ok = liveAcceptanceManager.setActiveTest(testId);
    if (!ok) {
      res.status(404).json({ error: `Test ${testId} not found` });
      return;
    }
    res.json(liveAcceptanceManager.getState());
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

controlPlaneRouter.post('/live-acceptance/feedback', (req: Request, res: Response) => {
  try {
    const { testId, verdict, notes } = req.body || {};
    if (!verdict || (verdict !== 'CORRECT' && verdict !== 'WRONG')) {
      res.status(400).json({ error: 'verdict must be either "CORRECT" or "WRONG"' });
      return;
    }
    const result = liveAcceptanceManager.recordHumanFeedback({ testId, verdict, notes });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});


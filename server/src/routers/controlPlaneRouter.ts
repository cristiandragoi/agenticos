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
import { engineeringWorkerRegistry } from '../domains/controlPlane/EngineeringWorkerRegistry.js';
import { capabilityCertificationRegistry } from '../domains/controlPlane/CapabilityCertificationRegistry.js';
import { engineeringAcceptance } from '../domains/controlPlane/EngineeringAcceptance.js';
import { logger } from '../utils/logger.js';

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

// POST /api/control-plane/certification/start — Start autonomous capability certification
controlPlaneRouter.post('/certification/start', async (req: Request, res: Response) => {
  try {
    const { autonomousCapabilityCertificationRunner } = await import('../domains/controlPlane/AutonomousCapabilityCertificationRunner.js');
    const suiteId = autonomousCapabilityCertificationRunner.startCertification({ conversationId: req.body?.conversationId });
    res.json({ started: true, suiteId, message: 'Autonomous capability certification started' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/certification/status — Status of autonomous capability certification
controlPlaneRouter.get('/certification/status', async (_req: Request, res: Response) => {
  try {
    const { autonomousCapabilityCertificationRunner } = await import('../domains/controlPlane/AutonomousCapabilityCertificationRunner.js');
    const isRunning = autonomousCapabilityCertificationRunner.isCertificationRunning();
    const latestResult = autonomousCapabilityCertificationRunner.getLatestSuiteResult();
    const registry = autonomousCapabilityCertificationRunner.getCapabilityRegistry();
    res.json({ isRunning, latestResult, totalRegistered: registry.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/certification/matrix — Matrix artifact content
controlPlaneRouter.get('/certification/matrix', async (_req: Request, res: Response) => {
  try {
    const jsonPath = path.resolve(process.cwd(), 'data', 'capability-certification-matrix.json');
    const mdPath = path.resolve(process.cwd(), 'data', 'capability-certification-matrix.md');
    let jsonContent = null;
    let mdContent = null;
    if (fs.existsSync(jsonPath)) jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (fs.existsSync(mdPath)) mdContent = fs.readFileSync(mdPath, 'utf8');
    res.json({ json: jsonContent, markdown: mdContent });
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

// GET /api/control-plane/engineering-dashboard — Consolidated internal team & capability status (Section 21)
controlPlaneRouter.get('/engineering-dashboard', async (_req: Request, res: Response) => {
  try {
    const workers = engineeringWorkerRegistry.getAllWorkers();
    const certifications = capabilityCertificationRegistry.getAllCertifications();
    const repo = repositoryAuthority.getStatus();
    const watchdog = recoveryWatchdog.verifyPipelineHealth();

    // Query live Ollama telemetry (Section 18)
    let ollamaTelemetry: any = { status: 'offline' };
    try {
      const psRes = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(1500) });
      if (psRes.ok) {
        const psData = await psRes.json();
        const activeModels = Array.isArray(psData.models) ? psData.models : [];
        const primary = activeModels[0];
        if (primary) {
          const vramBytes = primary.size_vram || 0;
          const totalBytes = primary.size || 1;
          const gpuOffloadPct = Math.round((vramBytes / totalBytes) * 100);
          ollamaTelemetry = {
            status: 'online',
            activeModel: primary.name || primary.model,
            quantization: primary.details?.quantization_level || 'Q4_K_M',
            modelSizeBytes: primary.size,
            vramAllocationBytes: vramBytes,
            gpuOffloadPercentage: gpuOffloadPct,
            contextLength: 65536,
            loadedAt: primary.expires_at,
          };
        } else {
          ollamaTelemetry = { status: 'idle', activeModel: null };
        }
      }
    } catch {
      ollamaTelemetry = { status: 'unreachable' };
    }

    res.json({
      timestamp: new Date().toISOString(),
      workers,
      certifications,
      repository: repo,
      watchdog,
      ollamaTelemetry,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/engineering/console — Phase 5: Live Engineering Console State
controlPlaneRouter.get('/engineering/console', async (req: Request, res: Response) => {
  try {
    const workerId = typeof req.query.worker === 'string' ? req.query.worker : 'antigravity';
    const consoleState = engineeringWorkerRegistry.getLiveConsoleState(workerId);

    // Query live AntiGravity discovery status & queue status
    let antigravityHealth: any = {
      status: 'OFFLINE',
      desktopRunning: false,
      activeConversationId: undefined,
      isolationMode: 'serialized_queue_strict_correlation',
      note: 'Strict Queue Correlation: Task execution is strictly correlated and serialized to preserve context boundaries.',
    };

    try {
      const { discoverAntigravityDesktopSession, getAntigravityQueueStatus } = await import('../services/backgroundTasks/antigravityAdapter.js');
      const discovery = discoverAntigravityDesktopSession();
      const queue = getAntigravityQueueStatus();

      const workerStatus = discovery.ok && discovery.isDesktopRunning ? 'ONLINE' : 'OFFLINE';
      antigravityHealth = {
        status: workerStatus,
        desktopRunning: Boolean(discovery.isDesktopRunning),
        activeConversationId: discovery.activeConversationId,
        agentapiAvailable: Boolean(discovery.agentapiPath),
        isolationMode: 'serialized_queue_strict_correlation',
        note: 'Strict Queue Correlation: Task execution is strictly correlated and serialized to preserve context boundaries.',
        queueStatus: queue,
        error: discovery.error,
      };

      // Keep registry worker status in sync
      if (workerId === 'antigravity') {
        engineeringWorkerRegistry.updateWorkerStatus('antigravity', consoleState.activeSession?.status === 'BUSY' ? 'BUSY' : workerStatus);
      }
    } catch { /* best-effort telemetry */ }

    res.json({
      ...consoleState,
      antigravityHealth,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/control-plane/engineering/open-antigravity — Focus or launch AntiGravity Desktop (Requirement 7)
controlPlaneRouter.post('/engineering/open-antigravity', async (_req: Request, res: Response) => {
  try {
    const { openOrFocusAntigravity } = await import('../services/backgroundTasks/antigravityAdapter.js');
    const result = await openOrFocusAntigravity();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/control-plane/engineering/reconnect — Reconnect listeners to existing AntiGravity sessions (Requirement 4 & 8)
controlPlaneRouter.post('/engineering/reconnect', async (_req: Request, res: Response) => {
  try {
    const { reconnectAntigravitySessions } = await import('../services/backgroundTasks/antigravityAdapter.js');
    const result = await reconnectAntigravitySessions();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/control-plane/engineering/resume — Resume a stalled task in the active AntiGravity session
controlPlaneRouter.post('/engineering/resume', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.body || {};
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }
    const { engineeringDelegationService } = await import('../domains/controlPlane/EngineeringDelegationService.js');
    const result = await engineeringDelegationService.resumeTask(taskId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/control-plane/engineering/continue — Continue the selected existing task (never creates new task ID)
controlPlaneRouter.post('/engineering/continue', async (req: Request, res: Response) => {
  try {
    const { taskId, instruction, context, workspacePath } = req.body || {};
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }
    const { engineeringDelegationService } = await import('../domains/controlPlane/EngineeringDelegationService.js');
    const result = await engineeringDelegationService.continueTask({
      taskId,
      instruction,
      context,
      workspacePath,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/control-plane/engineering/cancel — Cancel the active engineering task cleanly
controlPlaneRouter.post('/engineering/cancel', async (req: Request, res: Response) => {
  try {
    const { taskId, reason } = req.body || {};
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }
    const { engineeringDelegationService } = await import('../domains/controlPlane/EngineeringDelegationService.js');
    const result = await engineeringDelegationService.cancelTask(taskId, reason);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/control-plane/engineering/sessions — All durable engineering sessions (Requirement 3 & 5)
controlPlaneRouter.get('/engineering/sessions', (_req: Request, res: Response) => {
  try {
    const sessions = engineeringWorkerRegistry.getAllSessions(100);
    res.json({ sessions, count: sessions.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/engineering/sessions/:taskId — Single task session & execution events
controlPlaneRouter.get('/engineering/sessions/:taskId', (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId;
    const session = engineeringWorkerRegistry.getSession(taskId);
    if (!session) {
      res.status(404).json({ error: `Session for task ${taskId} not found` });
      return;
    }
    const events = engineeringWorkerRegistry.getWorkerEvents(undefined, 200).filter(e => e.taskId === taskId);
    res.json({ session, events });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/engineering/workers — List all engineering workers & live telemetry
controlPlaneRouter.get('/engineering/workers', (_req: Request, res: Response) => {
  try {
    res.json({
      workers: engineeringWorkerRegistry.getAllWorkers(),
      preferredWorker: 'antigravity',
      fallbackWorker: 'codex',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/engineering/worker-events — Chronological execution event stream
controlPlaneRouter.get('/engineering/worker-events', (req: Request, res: Response) => {
  try {
    const workerId = typeof req.query.worker === 'string' ? req.query.worker : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const events = engineeringWorkerRegistry.getWorkerEvents(workerId, limit);
    res.json({ events, count: events.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/control-plane/engineering/delegate — Direct first-class engineering delegation (converged with Jarvis)
controlPlaneRouter.post('/engineering/delegate', async (req: Request, res: Response) => {
  try {
    const { objective, worker, context, workspacePath, goalId } = req.body || {};
    if (!objective || typeof objective !== 'string' || !objective.trim()) {
      res.status(400).json({ error: 'objective is required' });
      return;
    }

    const { engineeringDelegationService } = await import('../domains/controlPlane/EngineeringDelegationService.js');
    const result = await engineeringDelegationService.delegateTask({
      objective: objective.trim(),
      worker: worker || 'antigravity',
      context,
      workspacePath,
      goalId,
      delegatedBy: 'workspace-composer',
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/control-plane/engineering/acceptance-test — Run autonomous 11-stage self-repair test (Section 16)
controlPlaneRouter.post('/engineering/acceptance-test', async (_req: Request, res: Response) => {
  try {
    const result = await engineeringAcceptance.runAcceptanceTest();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/control-plane/capabilities/probe — Run active diagnostics across all 26 capabilities (Section 5)
controlPlaneRouter.post('/capabilities/probe', async (_req: Request, res: Response) => {
  try {
    const updated = await capabilityCertificationRegistry.probeAll();
    res.json({ success: true, certifications: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/control-plane/diagnostics/desktop-observe
controlPlaneRouter.get('/diagnostics/desktop-observe', async (_req: Request, res: Response) => {
  try {
    const { desktopPerceptionService } = await import('../services/perception/DesktopPerceptionService.js');
    const { resolveScriptPath } = await import('../utils/scriptResolver.js');
    const fs = (await import('node:fs')).default;
    const scriptPath = resolveScriptPath('list_desktop_windows.ps1');
    const scriptExists = fs.existsSync(scriptPath);
    const winList = await desktopPerceptionService.listVisibleWindows();
    res.json({
      cwd: process.cwd(),
      scriptPath,
      scriptExists,
      winListCount: winList.length,
      windows: winList.slice(0, 10),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message, stack: err?.stack });
  }
});


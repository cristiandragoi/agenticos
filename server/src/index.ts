/**
 * Agentic OS — Backend Entrypoint (v9)
 *
 * Route composition:
 *   GET  /api/health           → healthRouter
 *   *    /api/agents           → agentsRouter
 *   *    /api/providers        → providersRouter
 *   *    /api/runtimes         → runtimesRouter
 *   *    /api/runs             → runsRouter
 *   *    /api/chat             → chatRouter  (includes SSE /api/chat/stream/:runId)
 *   *    /api/memory           → memoryRouter
 *   *    /api/boards           → boardsRouter
 *   *    /api/tools            → toolsRouter
 *   *    /api/sync             → syncRouter
 *   *    /api/loops            → loopsRouter
 *   *    /api/video            → videoRouter
 *
 * Middleware stack:
 *   requestId → cors → json → auth → routes → notFound → errorHandler
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Lifecycle contract: an explicitly provided PORT (e.g. the Electron
// lifecycle manager pinning the managed backend's port) survives dotenv —
// .env keeps governing every other value (and PORT when not provided).
const explicitPort = process.env.PORT;
const envPaths = [
  path.resolve(__dirname, '..', '.env'),
  path.resolve(process.cwd(), 'server', '.env'),
  path.resolve(process.cwd(), '.env'),
  'B:/AgenticOS/server/.env'
];
for (const p of envPaths) {
  dotenv.config({ path: p, override: false });
}
if (explicitPort !== undefined) process.env.PORT = explicitPort;

import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import { attachRequestId } from './utils/requestId.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { legacyHeadersMiddleware } from './middleware/legacyHeaders.js';
import { runStore } from './services/runStore.js';
import { runtimeRegistry } from './services/runtimeRegistry.js';
import { HermesAdapter } from './adapters/hermesAdapter.js';
import { JarvisAdapter } from './adapters/jarvisAdapter.js';
import { VideoAdapter } from './adapters/videoAdapter.js';
import { mockRuns } from './data.js';
import { registerAllTools } from './services/agent/toolLoader.js';
import { startRunWorker } from './services/execution/runWorker.js';
import { initScheduler } from './services/scheduler/scheduler.js';

// Initialize the agent tool registry
registerAllTools();

// Start the background task execution worker
startRunWorker();

// Initialize the cron scheduler
initScheduler();

// Initialize Event Bus Listeners
import './services/revenue/attributionEngine.js';
import './services/execution/costTracker.js';

import { checkTeamRecovery } from './services/agentTeams/recovery.js';
checkTeamRecovery();

// Routers
import healthRouter from './routers/health.js';
import systemRouter from './routers/system.js';
import workspaceIndexRouter from './routers/workspaceIndex.js';
import agentsRouter from './routers/agents.js';
import providersRouter from './routers/providers.js';
import runtimesRouter from './routers/runtimes.js';
import teamsRouter from './routers/teams.js';
import runsRouter from './routers/runs.js';
import chatRouter from './routers/chat.js';
import memoryRouter from './routers/memory.js';
import boardsRouter from './routers/boards.js';
import toolsRouter from './routers/tools.js';
import syncRouter from './routers/sync.js';
import loopsRouter from './routers/loops.js';
import videoRouter from './routers/video.js';
import voiceRouter from './routers/voice.js';
import { hermesApiRouter } from './routers/hermesApi.js';
import { researchRouter } from './routers/research.js';
import { salesRouter } from './routers/sales.js';
import { artifactsRouter } from './routers/artifacts.js';
import { kanbanRouter } from './routers/kanbanRouter.js';
import { laneRouter } from './routers/laneRouter.js';
import schedulesRouter, { seedDefaultSchedules } from './routers/schedules.js';
import agenticRouter from './routers/agentic.js';
import heavyGenRouter from './routers/heavyGen.js';
import geminiRouter from './routers/gemini.js';
import weldersPipelineRouter from './routers/weldersPipeline.js';
import jarvisRouter from './routers/jarvis.js';
import settingsRouter from './routers/settings.js';
import { routingRouter } from './routers/routing.js';
import { executionRouter } from './routers/execution.js';
import diagnosticsRouter from './routers/diagnostics.js';
import runtimeDiagnosticsRouter from './routers/runtimeDiagnostics.js';
import projectExecutionRouter from './routers/projectExecution.js';
import { mcpBridgeRouter } from './routers/mcpBridge.js';
import { initProjectExecutionSchema } from './services/projectExecution/schema.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;

/* ── Bootstrap ──────────────────────────────────────── */

// Initialize all JSON stores and seed if empty
import { db } from './services/db.js';
db.init();

// Initialize canonical project execution schema (idempotent)
initProjectExecutionSchema();

// Seed run store with existing mock runs so GET /api/runs is populated on first load
runStore.seed(mockRuns);

import { HeavyGenAdapter } from './adapters/heavyGenAdapter.js';

// Register runtime adapters
runtimeRegistry.register(new HermesAdapter());
runtimeRegistry.register(new JarvisAdapter());
runtimeRegistry.register(new VideoAdapter());
runtimeRegistry.register(new HeavyGenAdapter());

import { videoJobStore, progressVideoJob } from './adapters/videoAdapter.js';
import { loopRuns } from './services/loopEngine.js';

// Startup Recovery Routine
logger.info(`\n[Recovery] Scanning for stuck jobs...`);
let recoveredCount = 0;
loopRuns.list().filter(lr => lr.status === 'running').forEach(lr => {
  lr.status = 'failed';
  lr.stopReason = 'Recovered from server crash';
  loopRuns.upsert(lr);
  recoveredCount++;
});
videoJobStore.list().filter(vj => vj.status === 'running').forEach(vj => {
  logger.info(`[Recovery] Resuming video job ${vj.id} from stage ${vj.stage}`);
  setTimeout(() => progressVideoJob(vj.id), 1000);
  recoveredCount++;
});
if (recoveredCount > 0) {
  logger.info(`[Recovery] Handled ${recoveredCount} jobs during boot.`);
} else {
  logger.info(`[Recovery] No stuck jobs found.`);
}

// Auto-fail any runs still 'running' or 'queued' older than 30 minutes (stale from server restarts)
const STALE_RUN_MS = 30 * 60 * 1000;
const failStaleRuns = () => {
  const allRuns = runStore.list();
  let failedCount = 0;
  for (const run of allRuns) {
    if (run.status === 'running' || run.status === 'queued') {
      const checkTime = new Date(run.updatedAt || run.createdAt).getTime();
      if (Date.now() - checkTime > STALE_RUN_MS) {
        runStore.update(run.id, { status: 'failed', errorMessage: 'Server restarted mid-execution' });
        failedCount++;
      }
    }
  }
  if (failedCount > 0) {
    logger.info(`[Recovery] Auto-failed ${failedCount} stale run(s) older than 30min.`);
  }
};
failStaleRuns();
// Re-check every 5 minutes for any new stale runs that appear during uptime
setInterval(failStaleRuns, 5 * 60 * 1000);

import { runNewsRadar } from './workflows/newsRadar.js';

// Run News Radar once on boot, then every 4 hours
setTimeout(() => {
  runNewsRadar().catch(err => logger.error('[News Radar Boot] Error:', err));
  setInterval(() => {
    runNewsRadar().catch(err => logger.error('[News Radar Cron] Error:', err));
  }, 4 * 60 * 60 * 1000);
}, 5000); // Wait 5s for boot

import { supervisorLoop } from './services/supervisor.js';
import { runSyntheticAttribution } from './services/syntheticAttribution.js';

// Start the supervisor loop
setTimeout(() => {
  supervisorLoop(60000).catch(err => logger.error('[Supervisor Boot] Error:', err));
}, 2000); // Wait 2s for boot

// Start synthetic telemetry loop
setTimeout(() => {
  setInterval(() => {
    runSyntheticAttribution().catch(err => logger.error('[Synthetic Attribution Cron] Error:', err));
  }, 60000); // Every 60 seconds
}, 5000); // Wait 5s for boot

/* ── Middleware ─────────────────────────────────────── */
app.use(attachRequestId);
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

import stripeRouter from './routers/stripe.js';
// Webhook needs raw body for signature verification
app.use('/api/stripe', stripeRouter);

app.use(express.json({ limit: '2mb' }));

// Phase 4: Strictly reject legacy configuration headers
app.use(legacyHeadersMiddleware);

// Auth is bypassed in dev, enforced in production
app.use('/api', (req, res, next) => {
  logger.info(`[BACKEND] INCOMING: ${req.method} ${req.url}`);
  if (req.path === '/health' || req.path.startsWith('/health/') || req.path.startsWith('/system/') || req.path.startsWith('/kanban') || req.path.startsWith('/dispatch') || req.path.startsWith('/heavy-gen') || req.path.startsWith('/pipeline')) return next(); // public for now
  return authMiddleware(req, res, next);
});

/* ── Routes ─────────────────────────────────────────── */
app.use('/api/health', healthRouter);
app.use('/api/system', systemRouter);
app.use('/api/workspace-index', workspaceIndexRouter);
app.use('/api/gemini', authMiddleware, geminiRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/runtimes', runtimesRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/runs', runsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/loops', loopsRouter);
app.use('/api/video', videoRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/hermes-api', hermesApiRouter);
app.use('/api/research', researchRouter);
app.use('/api/sales', salesRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/kanban', kanbanRouter);
app.use('/api/dispatch', laneRouter);
import tasksRouter from './routers/tasks.js';
app.use('/api/tasks', tasksRouter);
import backgroundTasksRouter from './routers/backgroundTasks.js';
app.use('/api/background-tasks', backgroundTasksRouter);
import { runLedgerRouter } from './routers/runLedger.js';
app.use('/api/run-ledger', runLedgerRouter);
app.use('/api/schedules', schedulesRouter);
import routinesRouter from './routers/routines.js';
app.use('/api/routines', routinesRouter);
app.use('/api/heavy-gen', heavyGenRouter);
import { connectorRouter } from './routers/connectorRouter.js';
app.use('/api/connectors', connectorRouter);
app.use('/api/pipeline/welders', weldersPipelineRouter);
import projectsRouter from './routers/projects.js';
app.use('/api/projects', projectsRouter);
app.use('/api/jarvis', jarvisRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/routing', routingRouter);
app.use('/api/execution', executionRouter);
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/diagnostics/runtime', runtimeDiagnosticsRouter);
app.use('/api/project-execution', projectExecutionRouter);
app.use('/api/mcp-bridge', mcpBridgeRouter);
import { magnitudeRouter } from './routers/magnitude.js';
app.use('/api/magnitude', magnitudeRouter);
import { evaluationRouter } from './routers/evaluation.js';
app.use('/api/evaluation', evaluationRouter);
import { codingRuntimeRouter } from './routers/codingRuntime.js';
app.use('/api/coding', codingRuntimeRouter);

app.use('/api/agentic', agenticRouter);

import workspaceRouter from './routers/workspace.js';
app.use('/api/workspace', workspaceRouter);

import revenueRouter from './routers/revenue.js';
app.use('/api/revenue', revenueRouter);
import revenuePipelineRouter from './routers/revenuePipeline.js';
app.use('/api/revenue-pipeline', revenuePipelineRouter);
import skillsRouter from './routers/skills.js';
app.use('/api/skills', skillsRouter);

import evolutionRouter from './routers/evolution.js';
app.use('/api/evolution', evolutionRouter);

import revenueIntelligenceRouter from './routers/revenueIntelligence.js';
app.use('/api/revenue', revenueIntelligenceRouter);

import { runEvaluationLoop } from './services/evolution/evaluationWorker.js';
// Start Evaluation Loop (background worker)
setTimeout(() => {
  runEvaluationLoop().catch(err => logger.error('[EvaluationEngine Boot] Error:', err));
}, 10000); // 10s boot delay

// Conversations / Activity log compatibility endpoint
const conversations: any[] = [];
app.post('/api/conversations', (req, res) => {
  const { title, message, source } = req.body;
  const entry = { id: `conv-${Date.now()}`, title, message, source, createdAt: new Date().toISOString() };
  conversations.push(entry);
  logger.info(`[Conversations Log] ${source?.toUpperCase()}: ${title} — ${message}`);
  res.json({ success: true, entry });
});
app.get('/api/conversations', (req, res) => {
  res.json(conversations);
});

import { seedDefaultSkills } from './services/agent/skillRegistry.js';

// Seed default schedules and skills on boot
seedDefaultSchedules();
seedDefaultSkills();

// Background Task Manager: restore interrupted tasks after backend restart.
import { backgroundTaskManager } from './services/backgroundTasks/manager.js';
backgroundTaskManager.restoreAfterRestart();

// CodeX goals: reconcile orphaned goals (backend restarted while their loop
// ran and the worker lease expired) so they never show "Waiting for local
// model response" forever. Boot-only — no loop can be active in a fresh process.
import { goalStore } from './services/goalStore.js';
const sweptGoals = goalStore.sweepExpiredLeases();
if (sweptGoals > 0) {
  logger.info(`[GoalMode] Marked ${sweptGoals} orphaned goal(s) failed after restart (expired worker lease).`);
}

// Legacy compatibility redirects (keep old paths working)
app.get('/api/memory-scopes', (_req, res) => res.redirect('/api/memory/scopes'));
app.get('/api/memory-entries', (_req, res) => res.redirect('/api/memory/entries'));

// Legacy compatibility redirects (previously /api/stream/:runId, /api/memory-*)
app.get('/api/stream/:runId', (req, res) => res.redirect(`/api/chat/stream/${req.params.runId}`));

/* ── Error handling ─────────────────────────────────── */
app.use(notFound);
app.use(errorHandler);

/* ── Listen ─────────────────────────────────────────── */

// Only listen if not running in a serverless environment like Vercel
if (!process.env.VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`\n  ┌─────────────────────────────────────────┐`);
    logger.info(`  │  Agentic OS Backend  v9.0              │`);
    logger.info(`  │  http://localhost:${PORT}${' '.repeat(20 - PORT.toString().length)}│`);
    logger.info(`  │  ENV: ${process.env.NODE_ENV || 'development'}${' '.repeat(30 - (process.env.NODE_ENV || 'development').length)}│`);
    logger.info(`  └─────────────────────────────────────────┘\n`);
    logger.info(`  Adapters: Hermes ✓  Jarvis ✓  VideoAgent ✓`);
    logger.info(`  Routes:   13 registered\n`);
  });

  /* Graceful shutdown (backend lifecycle milestone): when Electron owns this
     process it sends SIGTERM on app exit; close the HTTP server and exit
     cleanly instead of leaving an orphaned listener on the port. */
  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal} — shutting down gracefully…`);
    server.close(() => process.exit(0));
    // Hard exit if connections refuse to drain in time.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Export for Vercel Serverless
export default app;

/**
 * Revenue Pipeline API — read access to pipeline runs and prospects, plus a
 * manual run creator (used by the demo/acceptance without typing in Jarvis).
 *
 *   GET  /api/revenue-pipeline/runs               list runs
 *   GET  /api/revenue-pipeline/runs/:id           single run
 *   GET  /api/revenue-pipeline/runs/:id/prospects prospects of a run
 *   GET  /api/revenue-pipeline/runs/:id/artifacts artifact file tree + text
 *   GET  /api/revenue-pipeline/prospects          all prospects
 *   GET  /api/revenue-pipeline/prospects/:id      single prospect
 *   POST /api/revenue-pipeline/runs               create+dispatch (dry-run safe)
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { revenuePipelineRepo } from '../services/revenuePipeline/store.js';
import { parsePipelineRequest } from '../services/revenuePipeline/intake.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { dispatchTask } from '../services/backgroundTasks/adapters.js';
import { logger } from '../utils/logger.js';

const router = Router();

function safeRun(runId: string) {
  const run = revenuePipelineRepo.getRun(runId);
  if (!run) return null;
  return run;
}

router.get('/runs', (_req, res) => {
  try {
    res.json(revenuePipelineRepo.listRuns(100));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/runs', async (req, res) => {
  try {
    const { request, config, workspacePath, dispatch = true } = req.body || {};
    if (!request && !config) {
      return res.status(400).json({ error: 'request (free text) or config is required' });
    }
    const intake = request ? parsePipelineRequest(request) : null;
    if (intake && intake.missing.length > 0) {
      // Required values are NEVER invented — ask, do not create a task.
      return res.status(400).json({ error: 'Missing required pipeline fields', missing: intake.missing, notes: intake.notes });
    }
    const cfg = {
      niche: config?.niche ?? intake?.config.niche ?? 'local business',
      city: config?.city ?? intake?.config.city ?? '',
      serviceKeywords: config?.serviceKeywords ?? intake?.config.serviceKeywords ?? [],
      prospectCount: config?.prospectCount ?? intake?.config.prospectCount ?? 3,
      specificUrl: config?.specificUrl ?? intake?.config.specificUrl ?? null,
      maxResearchBudgetUsd: config?.maxResearchBudgetUsd ?? intake?.config.maxResearchBudgetUsd ?? null,
      dryRun: config?.dryRun ?? intake?.config.dryRun ?? true,
      fixturesOnly: config?.fixturesOnly ?? intake?.config.fixturesOnly ?? false,
      runBuild: config?.runBuild ?? true,
      useCodex: config?.useCodex ?? true,
      useLlm: config?.useLlm ?? false,
      rawRequest: request || '(manual config)',
      workspacePath: workspacePath || path.resolve(process.cwd(), '..', 'data', 'revenue-pipeline'),
    };

    const { task, error } = backgroundTaskManager.createTask({
      title: `Revenue pipeline — ${cfg.niche} · ${cfg.city || 'no region'} (${cfg.prospectCount} prospects)`,
      objective: request || `Revenue pipeline: ${cfg.niche} in ${cfg.city}`,
      originalRequest: request || '(manual config)',
      route: 'revenue_pipeline',
      selectedAgent: 'Revenue Pipeline',
      worker: 'revenue',
      resumable: false,
      metadata: { ...cfg, intakeNotes: intake?.notes || [], capabilityId: 'revenue_pipeline' },
    });
    if (!task) return res.status(409).json({ error });

    if (dispatch !== false) {
      dispatchTask(task, cfg.workspacePath).catch((err: any) => {
        logger.error(`[revenue-pipeline] dispatch error: ${err?.message}`);
      });
    }
    res.status(201).json({ task, config: cfg, intakeNotes: intake?.notes || [] });
  } catch (err: any) {
    logger.error(`[revenue-pipeline] create failed: ${err?.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs/:id', (req, res) => {
  const run = safeRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const task = backgroundTaskManager.getTask(run.taskId);
  res.json({ ...run, taskSummary: task ? {
    taskId: task.taskId,
    status: task.status,
    currentStage: task.currentStage,
    buildState: task.buildState,
    testState: task.testState,
    verificationState: task.verificationState,
    approvalState: task.approvalState,
    linkedBoardCardId: task.linkedBoardCardId,
    progressMessage: task.progressMessage,
  } : null });
});

router.get('/runs/:id/prospects', (req, res) => {
  const run = safeRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run.prospects);
});

const TEXT_EXT = new Set(['.md', '.json', '.html', '.css', '.tsx', '.ts', '.js', '.mjs', '.txt', '.log']);

function walk(dir: string, base: string, depth = 0): any[] {
  if (depth > 4) return [];
  const out: any[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      out.push({ type: 'dir', path: rel, children: walk(full, base, depth + 1) });
    } else {
      const stat = fs.statSync(full);
      const item: any = { type: 'file', path: rel, size: stat.size };
      if (stat.size <= 256 * 1024 && TEXT_EXT.has(path.extname(entry.name).toLowerCase())) {
        try { item.content = fs.readFileSync(full, 'utf8').slice(0, 20000); } catch { /* ignore */ }
      }
      out.push(item);
    }
  }
  return out;
}

router.get('/runs/:id/artifacts', (req, res) => {
  const run = safeRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const dir = path.join(run.config.workspacePath, run.runId);
  if (!fs.existsSync(dir)) return res.json({ dir, files: [] });
  try {
    res.json({ dir, files: walk(dir, dir) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/prospects', (_req, res) => {
  try {
    res.json(revenuePipelineRepo.listProspects(500));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/prospects/:id', (req, res) => {
  const prospect = revenuePipelineRepo.getProspect(req.params.id);
  if (!prospect) return res.status(404).json({ error: 'Prospect not found' });
  res.json(prospect);
});

export default router;

import { Router, type Request, type Response } from 'express';
import { codingRuntimeService } from '../domains/codingRuntime/service.js';
import { getCodingPolicy, DEFAULT_CODING_POLICIES, VERIFIED_CODEX_PROVIDERS, DEEPSEEK_SPIKE_POLICY } from '../domains/codingRuntime/providerPolicy.js';
import { logger } from '../utils/logger.js';

/**
 * codingRuntimeRouter — Agentic OS coding runtime surface (Phase 28).
 * Project → task → Build → run → progress → diff/tests/verifier →
 * Approve / Request changes / Discard.
 */
export const codingRuntimeRouter = Router();

/** POST /api/coding/runs — start a coding run. */
codingRuntimeRouter.post('/runs', async (req: Request, res: Response) => {
  const body = req.body || {};
  const { taskId, projectId, projectTaskId, workspace, instructions } = body;
  if (!taskId || !projectId || !projectTaskId || !workspace || !instructions) {
    res.status(400).json({ error: 'taskId, projectId, projectTaskId, workspace, instructions are required' });
    return;
  }
  try {
    // Phase 12 spike: explicit policy override (deepseek spike uses the
    // DEEPSEEK_SPIKE_POLICY — primary deepseek, no fallback).
    const policy = body.policy === 'deepseek-spike' ? DEEPSEEK_SPIKE_POLICY : getCodingPolicy(body.providerPolicyId);
    const run = await codingRuntimeService.startRun({
      taskId,
      projectId,
      projectTaskId,
      backgroundTaskId: body.backgroundTaskId,
      executionRunId: body.executionRunId,
      workspace,
      branch: body.branch,
      instructions,
      acceptanceCriteria: body.acceptanceCriteria,
      providerPolicy: policy,
      allowedCommands: body.allowedCommands,
      networkPolicy: body.networkPolicy || 'local',
      approvalPolicy: body.approvalPolicy || 'manual',
      timeoutMs: body.timeoutMs,
      conversationId: body.conversationId,
      spike: body.spike,
    });
    res.json({ runId: run.runId, status: run.status, policy: policy.policyId, provider: policy.primary });
  } catch (err: any) {
    logger.error('[CodingRuntime] start failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/coding/runs — list runs (optionally by project). */
codingRuntimeRouter.get('/runs', (_req: Request, res: Response) => {
  const projectId = typeof _req.query.projectId === 'string' ? _req.query.projectId : undefined;
  res.json(codingRuntimeService.listRuns(projectId));
});

/** GET /api/coding/runs/:id — run detail (no secrets ever). */
codingRuntimeRouter.get('/runs/:id', (req: Request, res: Response) => {
  const run = codingRuntimeService.getRun(req.params.id);
  if (!run) { res.status(404).json({ error: 'run not found' }); return; }
  res.json(run);
});

/** POST /api/coding/runs/:id/cancel — cancel. */
codingRuntimeRouter.post('/runs/:id/cancel', (req: Request, res: Response) => {
  const run = codingRuntimeService.cancelRun(req.params.id);
  if (!run) { res.status(404).json({ error: 'run not found' }); return; }
  res.json({ runId: run.runId, status: run.status });
});

/** POST /api/coding/runs/:id/review — approve / request changes / discard. */
codingRuntimeRouter.post('/runs/:id/review', async (req: Request, res: Response) => {
  const { action, feedback, removeWorktree } = req.body || {};
  const id = req.params.id;
  let run = null;
  if (action === 'approve') run = await codingRuntimeService.approveRun(id);
  else if (action === 'changes_requested') run = await codingRuntimeService.requestChanges(id, feedback || '');
  else if (action === 'discard') run = await codingRuntimeService.discardRun(id, { removeWorktree: removeWorktree !== false });
  else { res.status(400).json({ error: 'action must be approve | changes_requested | discard' }); return; }
  if (!run) { res.status(404).json({ error: 'run not found' }); return; }
  res.json({ runId: run.runId, status: run.status, reviewState: run.reviewState });
});

/** GET /api/coding/policies — provider policies (UI: Default/Economy/Quality). */
codingRuntimeRouter.get('/policies', (_req: Request, res: Response) => {
  res.json({ policies: DEFAULT_CODING_POLICIES, verifiedProviders: VERIFIED_CODEX_PROVIDERS });
});

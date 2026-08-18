import { Router } from 'express';
import { randomUUID } from 'crypto';
import { runStore } from '../services/runStore.js';
import { runtimeRegistry } from '../services/runtimeRegistry.js';
import { mockAgents, mockProviders } from '../data.js';
import { llmChat, llmProbe, OLLAMA_BASE } from '../services/llmGateway.js';
import { resumeCodexGoalLoop } from '../loops/codexLoop.js';
import { jarvisOrchestrator } from '../domains/jarvis/orchestrator.js';
import { conversationService } from '../domains/conversations/service.js';
import { logger } from '../utils/logger.js';
import { goalStore, goalControllers } from '../services/goalStore.js';
import { codexService } from '../domains/codex/service.js';
import { getWorkspaceRoot } from '../services/workspaceStore.js';
import type { GoalRecord, GoalEvent } from '../types.js';

import { db } from '../db/index.js';
import { goalSteps, goalCheckpoints, providerCircuitBreakers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AgentProviderAssignmentService, mapCatalogToGatewayId } from '../services/agent/assignments.js';

const router = Router();

// SSE client registry for streaming
const streamClients = new Map<string, any[]>();

/* ── POST /api/chat/message ────────────────────────── */
router.post('/message', (req, res) => {
  const { agentId, message } = req.body;
  if (!agentId || !message) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'agentId and message are required' } });
    return;
  }

  const runId = `run-${randomUUID().slice(0, 9)}`;
  const sessionId = req.body.sessionId || randomUUID();

  const agent = mockAgents.find(a => a.id === agentId);
  const adapter = agent ? runtimeRegistry.getAdapter(agent.runtimeId) : undefined;

  // Validate model override against agent's configured providers
  const { modelOverride } = req.body;
  if (modelOverride && agent) {
    const agentProviders = mockProviders.filter(p => agent.providerIds.includes(p.id));
    const validModel = agentProviders.some(p => (p.models ?? []).some(m => m.id === modelOverride));
    if (!validModel) {
      res.status(400).json({ error: { code: 'INVALID_OVERRIDE', message: `Model '${modelOverride}' is not available for agent '${agentId}'` } });
      return;
    }
  }

  if (message.includes('RESTART_BACKEND_NOW')) {
    res.json({ restarting: true });
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // Intercept approval for run-004
  if (agentId === 'agent-hermes' && message.toLowerCase().includes('approve')) {
    const pendingRun = runStore.get('run-004');
    if (pendingRun && pendingRun.status === 'waiting') {
      import('../transitions/approveRun.js').then(({ approveSchemaRun }) => {
        const updated = approveSchemaRun(pendingRun);
        runStore.update(pendingRun.id, updated);
      });
    }
  }

  if (adapter) {
    const invocation = { runId, agentId, sessionId, workspaceId: 'default', mode: 'chat' as const, prompt: message, uiContext: req.body.uiContext };
    adapter.invoke(invocation).catch((err) => logger.error('[Chat] Invocation error:', err));

    // Drive SSE stream asynchronously
    (async () => {
      // Small delay to let client initiate SSE
      await new Promise(r => setTimeout(r, 200)); 
      
      try {
        for await (const event of adapter.stream(invocation)) {
          // Fetch clients dynamically on every chunk so late connections aren't missed
          const clients = streamClients.get(runId) || [];
          clients.forEach(c => {
            try { c.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`); } catch (_) {}
          });
          if (event.type === 'run_status') break;
        }
      } catch (err) {
        logger.error('[Chat] Stream error:', err);
      } finally {
        setTimeout(() => {
          const cs = streamClients.get(runId) || [];
          cs.forEach(c => { try { c.end(); } catch (_) {} });
          streamClients.delete(runId);
        }, 500);
      }
    })();
  } else {
    // Fallback simulation
    const now = new Date().toISOString();
    runStore.create({ id: runId, agentId, sessionId, workspaceId: 'default', mode: 'chat', status: 'running', input: message, logs: [], events: [], linkedArtifacts: [], createdAt: now, updatedAt: now });

    setTimeout(() => {
      const clients = streamClients.get(runId) || [];
      const words = `Response to: "${message}"`.split(' ');
      let i = 0;
      const interval = setInterval(() => {
        if (i < words.length) {
          clients.forEach(c => { try { c.write(`event: chat_chunk\ndata: ${JSON.stringify({ chunk: words[i] + ' ' })}\n\n`); } catch (_) {} });
          i++;
        } else {
          clearInterval(interval);
          clients.forEach(c => { try { c.write(`event: run_status\ndata: ${JSON.stringify({ status: 'completed' })}\n\n`); } catch (_) {} });
          runStore.update(runId, { status: 'completed', output: `Response to: "${message}"` });
          setTimeout(() => { clients.forEach(c => { try { c.end(); } catch (_) {} }); streamClients.delete(runId); }, 200);
        }
      }, 60);
    }, 200);
  }

  res.json({ runId });
});

/* ── POST /api/chat/resolve ────────────────────────── */
router.post('/resolve', (req, res) => {
  const { message } = req.body;
  const lm = (message || '').toLowerCase();
  let agentId: string | null = null;
  let confidence = 0;

  if (
    lm.includes('build a landing page') ||
    lm.includes('make a game ui') ||
    lm.includes('generate a new dashboard') ||
    lm.includes('preview the app') ||
    lm.includes('qwable') ||
    lm.includes('coding page') ||
    (lm.includes('build') && (lm.includes('page') || lm.includes('ui') || lm.includes('dashboard') || lm.includes('preview')))
  ) {
    agentId = 'agent-qwable'; confidence = 0.95;
  } else if (
    lm.includes('jarvis voice') || 
    lm.includes('welders pipeline') || 
    lm.includes('fix voice') || 
    lm.includes('rebalance welders') ||
    lm.includes('qwythos') ||
    lm.includes('orchestrate')
  ) {
    agentId = 'agent-qwythos'; confidence = 0.95;
  } else if (lm.includes('video') || lm.includes('film') || lm.includes('animate')) {
    agentId = 'agent-video'; confidence = 0.9;
  } else if (lm.includes('deploy') || lm.includes('build') || lm.includes('run') || lm.includes('execute')) {
    agentId = 'agent-jarvis'; confidence = 0.85;
  } else if (lm.includes('research') || lm.includes('find') || lm.includes('analyze') || lm.includes('compare')) {
    agentId = 'agent-athena'; confidence = 0.8;
  } else if (lm.includes('monitor') || lm.includes('alert') || lm.includes('health') || lm.includes('status')) {
    agentId = 'agent-sentinel'; confidence = 0.8;
  } else {
    agentId = 'agent-hermes'; confidence = 0.7;
  }

  res.json({ agentId, confidence });
});

/* ── GET /api/stream/:runId ────────────────────────── */
router.get('/stream/:runId', (req, res) => {
  const { runId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  if (!streamClients.has(runId)) streamClients.set(runId, []);
  streamClients.get(runId)!.push(res);

  req.on('close', () => {
    const current = streamClients.get(runId) || [];
    streamClients.set(runId, current.filter(c => c !== res));
  });
});

/* ── POST /api/chat/quick ──────────────────────────────
   Dead-simple chat: message → OmniRoute (auto) → reply.
   No agent orchestration, no tools, no SSE streaming.      */
router.post('/quick', async (req, res) => {
  const { message, provider, model } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const result = await llmChat({ prompt: message, provider, ollamaModel: model });
  res.json({ reply: result.reply, ...(result.offline ? { offline: true, error: result.error } : {}) });
});

/* ── POST /api/chat/agents/run ─────────────────────────
   Gateway for explicit coding agent selection  */
router.post('/agents/run', async (req, res) => {
  const { agent, message, providerOverride, modelOverride } = req.body;
  if (!agent || !message) {
    res.status(400).json({ error: 'agent and message are required' });
    return;
  }

  let provider: any = providerOverride;
  let ollamaModel: string | undefined = modelOverride;

  if (agent === 'CodeX' && !providerOverride) {
    const codexAssignment = await AgentProviderAssignmentService.getAssignment('agent-codex');
    provider = codexAssignment?.providerId ? mapCatalogToGatewayId(codexAssignment.providerId) : 'DeepSeek';
  }

  const systemPrompt = `You are the ${agent} agent inside my Agentic OS. Answer with concrete code patches and plans. Be concise and authoritative. Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.`;
  const result = await llmChat({ systemPrompt, prompt: message, maxTokens: 2048, provider, ollamaModel });
  res.json({ reply: result.reply, ...(result.offline ? { offline: true, error: result.error } : {}) });
});

/* ── POST /api/chat/agents/goal (and aliases) ────────────
   Starts a new durable Goal Mode loop                 */
const handleCreateGoal = async (req: any, res: any) => {
  try {
    const { 
      goal,
      prompt: rawPrompt,
      message,
      validationProvider, 
      workspacePath, 
      repositoryRoot, 
      approvalPolicy, 
      conversationId, 
      workspaceId, 
      executionOptions, 
      routing, 
      agentId = 'agent-codex' 
    } = req.body;

    const prompt = goal || rawPrompt || message;

    // Ensure we use repositoryRoot or workspacePath interchangeably — and
    // fall back to the ONE canonical workspace root (§1) so a CodeX goal
    // created without an explicit repository still carries it (§2).
    const targetWorkspace = repositoryRoot || workspacePath || getWorkspaceRoot();

    let routingSource = routing?.mode ? 'explicit-override' : 'automatic-fallback';
    let traceAssignment: any = null;
    
    if (!routing || typeof routing !== 'object' || !['automatic', 'preferred', 'forced'].includes(routing.mode)) {
      routingSource = 'persisted-assignment';
      traceAssignment = await AgentProviderAssignmentService.getAssignment(agentId);
    } else {
      // Basic validation of explicitly supplied routing
      if (routing.mode !== 'automatic' && (!routing.providerId || typeof routing.providerId !== 'string')) {
        return res.status(400).json({ error: 'providerId is required for preferred/forced routing' });
      }
    }

    const disableFallback = routingSource === 'explicit-override' 
      ? (executionOptions?.disableFallback === true || routing?.mode === 'forced')
      : traceAssignment?.routingMode === 'forced';

    logger.info('[DEBUG] CodeX Task Routing Trace:', {
      agentId,
      routingSource,
      routingMode: traceAssignment?.routingMode || traceAssignment?.mode || 'automatic',
      catalogProviderId: traceAssignment?.providerId || 'none',
      gatewayProviderId: mapCatalogToGatewayId(traceAssignment?.providerId || ''),
      modelId: traceAssignment?.modelId || 'default',
      disableFallback: !!disableFallback
    });

    const effectiveApprovalPolicy = approvalPolicy || (req.body.requiresApproval === false ? 'auto' : undefined);
    const execProvider = executionOptions?.executionProviderId || req.body.providerOverride;
    const goalId = await codexService.createGoal(prompt, targetWorkspace, effectiveApprovalPolicy, execProvider, conversationId, workspaceId, executionOptions);
    res.json({ goalId, id: goalId });
  } catch (err: any) {
    logger.error('ERROR IN POST /agents/goal', err);
    res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
};
router.post('/agents/goal', handleCreateGoal);
router.post('/agents/goals', handleCreateGoal);
router.post('/goals', handleCreateGoal);

/* ── POST /api/chat/agents/goal/:id/revise ────────────── */
router.post('/agents/goal/:id/revise', async (req, res) => {
  const goalId = req.params.id;
  const { feedback } = req.body;
  const success = await codexService.reviseGoal(goalId, feedback);
  if (!success) return res.status(400).json({ error: 'Failed to revise goal' });
  res.json({ success: true });
});

/* ── GET /api/chat/agents/goal/stream/:id ───────────────
   Streams goal events, replays via DB catch-up, heartbeats */
const handleGoalStream = async (req: any, res: any) => {
  const goalId = req.params.id;
  const goal = goalStore.get(goalId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  let endedIntentionally = false;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const queryLastEventId = req.query.lastEventId;
  const requestedLastEventId = req.headers['last-event-id']
    || (typeof queryLastEventId === 'string' ? queryLastEventId : Array.isArray(queryLastEventId) && typeof queryLastEventId[0] === 'string' ? queryLastEventId[0] : '0');
  const lastEventId = parseInt(String(requestedLastEventId || '0'), 10);
  
  // 10. SSE Correctness: DB catch-up query (Authoritative Replay)
  const missedEvents = goalStore.getEventsAfter(goalId, lastEventId);
  let highestSequence = lastEventId;

  logger.info('[CodeX SSE] connection opened', {
    goalId,
    subscriberCount: goalStore.listenerCount('goal:updated') + 1,
    lastEventSequence: highestSequence,
    httpStatus: res.statusCode,
    goalExists: !!goalStore.get(goalId),
    endedIntentionally
  });

  for (const event of missedEvents) {
    if (event.sequence > highestSequence) {
      try { res.write(`id: ${event.sequence}\nevent: goal_event\ndata: ${JSON.stringify(event)}\n\n`); } catch (_) {}
      highestSequence = event.sequence;
    }
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()} sequence=${highestSequence}\n\n`);
    } catch (err: any) {
      logger.info('[CodeX SSE] heartbeat write failed', {
        goalId,
        closeReason: err?.message || String(err),
        subscriberCount: goalStore.listenerCount('goal:updated'),
        lastEventSequence: highestSequence,
        httpStatus: res.statusCode,
        goalExists: !!goalStore.get(goalId),
        endedIntentionally
      });
    }
  }, 15000);

  const listener = (updatedGoal: GoalRecord) => {
    if (updatedGoal.id === goalId) {
      // Live Catch-Up to guarantee no gap
      const newEvents = goalStore.getEventsAfter(goalId, highestSequence);
      for (const event of newEvents) {
        if (event.sequence > highestSequence) {
          try { res.write(`id: ${event.sequence}\nevent: goal_event\ndata: ${JSON.stringify(event)}\n\n`); } catch (_) {}
          highestSequence = event.sequence;
        }
      }
      
      if (['completed', 'failed', 'stopped', 'paused'].includes(updatedGoal.status)) {
        endedIntentionally = true;
        clearInterval(heartbeat);
        logger.info('[CodeX SSE] connection ending intentionally', {
          goalId,
          closeReason: `terminal:${updatedGoal.status}`,
          subscriberCount: goalStore.listenerCount('goal:updated'),
          lastEventSequence: highestSequence,
          httpStatus: res.statusCode,
          goalExists: !!goalStore.get(goalId),
          endedIntentionally
        });
        try { res.end(); } catch (_) {}
        goalStore.removeListener('goal:updated', listener);
      }
    }
  };

  goalStore.on('goal:updated', listener);

  req.on('close', () => {
    clearInterval(heartbeat);
    goalStore.removeListener('goal:updated', listener);
    logger.info('[CodeX SSE] connection closed', {
      goalId,
      closeReason: endedIntentionally ? 'intentional' : 'client_closed_or_network',
      subscriberCount: goalStore.listenerCount('goal:updated'),
      lastEventSequence: highestSequence,
      httpStatus: res.statusCode,
      goalExists: !!goalStore.get(goalId),
      endedIntentionally
    });
  });
};
router.get('/agents/goal/stream/:id', handleGoalStream);
router.get('/agents/goals/stream/:id', handleGoalStream);
router.get('/goals/stream/:id', handleGoalStream);

/* ── POST /api/chat/agents/goal/:id/pause ─────────────── */
router.post('/agents/goal/:id/pause', (req, res) => {
  const goalId = req.params.id;
  const goal = goalStore.get(goalId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  
  // 9. Pause sequencing
  // - persist pause_requested
  goalStore.update(goalId, { status: 'pause_requested' });
  
  // - abort model / tree kill
  const controller = goalControllers.get(goalId);
  if (controller) {
    controller.abort();
    goalControllers.delete(goalId);
  }
  
  // - persist step & mark paused & release lease is handled inside codexLoop when it breaks out due to controller.abort()
  
  res.json({ success: true, status: 'pause_requested' });
});

/* ── POST /api/chat/agents/goal/:id/resume ────────────── */
router.post('/agents/goal/:id/resume', async (req, res) => {
  const goalId = req.params.id;
  const goal = goalStore.get(goalId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  
  if (goal.status === 'pause_requested') {
    return res.status(409).json({ error: 'Goal is currently tearing down. Please wait until fully paused.' });
  }

  const checkpoint = goalStore.getLatestCheckpoint(goalId);
  const eligible = ['paused', 'failed', 'interrupted', 'stopped'].includes(goal.status);
  if (!eligible) {
    return res.status(409).json({ error: `Goal status '${goal.status}' cannot be resumed.` });
  }
  if (!goal.originalGoal?.trim()) {
    return res.status(400).json({ error: 'Cannot resume without an original task.' });
  }
  if (!checkpoint) {
    return res.status(409).json({ error: 'Cannot resume without a persisted checkpoint.' });
  }
  try {
    const codexAssignment = await AgentProviderAssignmentService.getAssignment('agent-codex');
    const targetProv = mapCatalogToGatewayId(codexAssignment?.providerId || '');
    if (targetProv === 'ollama') {
      const providerRes = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!providerRes.ok) {
        return res.status(503).json({ error: `Provider is not reachable: Ollama HTTP ${providerRes.status}` });
      }
    }
  } catch (err: any) {
    return res.status(503).json({ error: err?.message || 'Provider is not reachable.' });
  }

  {
    goalStore.update(goalId, { status: 'queued' });
    resumeCodexGoalLoop(goalId).catch((err) => logger.error('Error resuming goal loop:', err));
  }
  res.json({ success: true, status: 'resumed' });
});

/* ── POST /api/chat/studio-card ────────────────────────
   OmniRoute Gateway for Hermes Studio cards              */
router.post('/studio-card', async (req, res) => {
  const { cardId, prompt } = req.body;
  if (!cardId || !prompt) {
    res.status(400).json({ error: 'cardId and prompt are required' });
    return;
  }

  const systemPrompt = `You are handling a Hermes Studio run for card: ${cardId}. Answer with a concise, status-like result.`;
  const result = await llmChat({ systemPrompt, prompt });
  res.json({
    reply: result.reply,
    metadata: {
      modelUsed: result.provider === 'omniRoute' ? 'OmniRoute' : result.provider === 'ollama' ? 'Ollama' : 'None (offline)',
      fallbackApplied: result.provider !== 'omniRoute',
      fallbackReason: result.error || '',
    },
  });
});

/* ── POST /api/chat/hermes ─────────────────────────────
   OmniRoute Gateway for Hermes Chat with fallback        */
router.post('/hermes', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const systemPrompt = `You are Hermes, the command center agent for Agentic OS. Provide concise, direct answers to the user's commands.`;
  const result = await llmChat({ systemPrompt, prompt });
  res.json({
    reply: result.reply,
    metadata: {
      modelUsed: result.provider === 'omniRoute' ? 'OmniRoute' : result.provider === 'ollama' ? 'Ollama' : 'None (offline)',
      fallbackApplied: result.provider !== 'omniRoute',
      fallbackReason: result.error || '',
    },
  });
});

/* ── GET /api/chat/test ────────────────────────────────
   Quick connectivity check for OmniRoute                */
router.get('/test', async (_req, res) => {
  const probe = await llmProbe();
  res.json(probe);
});

/* ── GET /api/chat/agents/goals (and /api/chat/goals) ──── */
const handleListGoals = (req: any, res: any) => {
  const statusQuery = req.query.status as string | undefined;
  if (statusQuery === 'unfinished') {
    return res.json(goalStore.getUnfinishedGoals());
  }
  if (statusQuery) {
    const statuses = statusQuery.split(',').map((s: string) => s.trim()).filter(Boolean);
    return res.json(goalStore.getGoalsByStatus(statuses));
  }
  res.json(goalStore.getAllGoals());
};
router.get('/agents/goals', handleListGoals);
router.get('/goals', handleListGoals);

/* ── GET /api/chat/agents/goal/:id (and aliases) ────────── */
const handleGetGoal = (req: any, res: any) => {
  const goalId = req.params.id;
  const goal = goalStore.get(goalId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  res.json(goal);
};
router.get('/agents/goal/:id', handleGetGoal);
router.get('/agents/goals/:id', handleGetGoal);
router.get('/goals/:id', handleGetGoal);

/* ── GET /api/chat/agents/goal/:id/steps ───────────────── */
const handleGetGoalSteps = (req: any, res: any) => {
  const goalId = req.params.id;
  const steps = db.select().from(goalSteps).where(eq(goalSteps.goalId, goalId)).all();
  res.json(steps);
};
router.get('/agents/goal/:id/steps', handleGetGoalSteps);
router.get('/agents/goals/:id/steps', handleGetGoalSteps);
router.get('/goals/:id/steps', handleGetGoalSteps);

/* ── GET /api/chat/agents/goal/:id/checkpoints ─────────── */
const handleGetGoalCheckpoints = (req: any, res: any) => {
  const goalId = req.params.id;
  const checkpoints = db.select().from(goalCheckpoints).where(eq(goalCheckpoints.goalId, goalId)).all();
  res.json(checkpoints);
};
router.get('/agents/goal/:id/checkpoints', handleGetGoalCheckpoints);
router.get('/agents/goals/:id/checkpoints', handleGetGoalCheckpoints);
router.get('/goals/:id/checkpoints', handleGetGoalCheckpoints);

/* ── POST /api/chat/agents/goal/:id/approve ────────────── */
const handleApproveGoal = async (req: any, res: any) => {
  const goalId = req.params.id;
  const { action } = req.body; // 'approve' | 'reject' | legacy 'resume' | 'abort'

  if (action === 'approve' || action === 'resume') {
    const success = await codexService.approveAndResume(goalId);
    if (!success) return res.status(400).json({ error: 'Failed to resume goal' });
    res.json({ success: true, status: 'queued' });
  } else if (action === 'reject' || action === 'abort') {
    await codexService.abortGoal(goalId);
    res.json({ success: true, status: 'stopped' });
  } else {
    res.status(400).json({ error: 'Invalid action. Expected approve or reject.' });
  }
};
router.post('/agents/goal/:id/approve', handleApproveGoal);
router.post('/agents/goals/:id/approve', handleApproveGoal);
router.post('/goals/:id/approve', handleApproveGoal);


/* ── GET /api/chat/agents/circuit-breakers ─────────────── */
router.get('/agents/circuit-breakers', (req, res) => {
  const breakers = db.select().from(providerCircuitBreakers).all();
  res.json(breakers);
});

/* ── GET /api/chat/agents/goal/:id/diff ────────────────── */
router.get('/agents/goal/:id/diff', async (req, res) => {
  const goalId = req.params.id;
  const checkpoints = db.select().from(goalCheckpoints).where(eq(goalCheckpoints.goalId, goalId)).all();
  
  const diffs = [];
  for (let i = 0; i < checkpoints.length; i++) {
    const c = checkpoints[i];
    let diffText = '';
    
    // Attempt real git diff if hash is available
    if (c.workspaceHash && c.workspaceHash.length === 40) {
      try {
        const { execFile } = await import('child_process');
        const util = await import('util');
        const execFileAsync = util.promisify(execFile);
        
        const prevHash = i > 0 ? checkpoints[i-1].workspaceHash : `${c.workspaceHash}~1`;
        if (prevHash && prevHash.length >= 7) {
          const { stdout } = await execFileAsync('git', ['diff', prevHash, c.workspaceHash], { cwd: process.env.AGENTICOS_WORKSPACE || process.cwd() });
          diffText = stdout;
        }
      } catch (e) {
        diffText = '// Git diff unavailable or repository not initialized.\n// Fallback: Using changed files list only.';
      }
    } else {
      diffText = '// No valid git hash available for this checkpoint.';
    }

    diffs.push({
      checkpointId: c.id,
      sequenceId: c.sequenceId,
      hash: c.workspaceHash,
      files: c.changedFiles || [],
      diff: diffText
    });
  }
  
  res.json(diffs);
});

export { streamClients };
export default router;


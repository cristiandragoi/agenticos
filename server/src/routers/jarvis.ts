import { Router } from 'express';
import { conversationService } from '../domains/conversations/service.js';
import { jarvisOrchestrator } from '../domains/jarvis/orchestrator.js';
import { intentRouter } from '../domains/jarvis/intentRouter.js';
import { TeamRunner } from '../services/agentTeams/teamRunner.js';
import { db } from '../db/index.js';
import { conversations, teams, teamRuns } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { llmChatStream, OPENROUTER_DEFAULT_MODEL } from '../services/llmGateway.js';
import { mockAgents, mockProviders, mockRuntimes, mockTools } from '../data.js';

const router = Router();

function getDirectChatFirstTokenTimeoutMs() {
  return Number(process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS || 20_000);
}

function getDirectChatTotalTimeoutMs() {
  return Number(process.env.JARVIS_TOTAL_RESPONSE_TIMEOUT_MS || 120_000);
}

function logStreamStage(operationId: string | undefined, stage: string, details: Record<string, any> = {}) {
  console.log('[JarvisStream]', stage, {
    operationId,
    ...details
  });
}

/* ── GET /api/jarvis/conversations ────────────────────────── */
router.get('/conversations', async (req, res) => {
  try {
    const list = await conversationService.listConversations();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations ───────────────────────── */
router.post('/conversations', async (req, res) => {
  try {
    const { title, workspaceId } = req.body;
    const id = await conversationService.createConversation(title || 'New Conversation', workspaceId);
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/jarvis/conversations/:id/messages ───────────── */
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await conversationService.getMessages(req.params.id);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations/:id/message ───────────── */
/**
 * Normalize the UI approval-policy vocabulary ('auto' | 'strict') to the
 * backend vocabulary ('auto' | 'manual'). Anything unknown defaults to
 * 'manual' — actions that need approval must never be silently auto-approved.
 */
function normalizeApprovalPolicy(value: any): 'manual' | 'auto' {
  if (value === 'auto') return 'auto';
  return 'manual';
}

function writeSse(res: any, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

function buildLiveCapabilityAnswer(workspacePath: string | undefined) {
  const activeAgents = mockAgents.filter(agent => agent.status === 'active');
  const healthyRuntimes = mockRuntimes.filter(runtime => runtime.health?.status === 'healthy');
  const connectedProviders = mockProviders.filter(provider => provider.status === 'connected');
  const codex = activeAgents.find(agent => agent.id === 'agent-codex');
  const jarvis = activeAgents.find(agent => agent.id === 'agent-jarvis');
  const tools = mockTools
    .filter(tool => [
      'tool-file-system',
      'tool-code-runner',
      'tool-browser',
      'tool-search',
      'tool-trigger-build',
      'tool-deploy',
      'tool-read-config',
      'tool-write-config'
    ].includes(tool.id))
    .map(tool => tool.name)
    .slice(0, 8);

  return [
    'I am Jarvis, the operational orchestrator for Agentic OS.',
    '',
    `CodeX available: ${codex ? 'yes' : 'no'}`,
    `Agent Teams available: yes`,
    `Repository selected: ${workspacePath?.trim() || 'none'}`,
    `Healthy runtimes: ${healthyRuntimes.length}/${mockRuntimes.length}`,
    `Connected providers: ${connectedProviders.length}/${mockProviders.length}`,
    `Tools available: ${tools.join(', ') || 'none registered'}`,
    `Current provider/model for direct chat: omniRoute / auto with Ollama fallback`,
    `Voice status: experimental/unavailable for reliable typed chat`,
    '',
    jarvis
      ? `I can inspect and modify files through approved workspace tasks, delegate coding work to CodeX, coordinate Agent Teams, check runtime and pipeline status, search documentation when available, and execute approved Agentic OS operations.`
      : `Jarvis runtime metadata is unavailable, so I can only report registered system state.`
  ].join('\n');
}

function streamTextAsChunks(res: any, text: string, operationId: string | undefined, provider = 'agentic-os', model = 'registry') {
  const parts = text.match(/.{1,180}(?:\s|$)/g) || [text];
  for (const part of parts) {
    if (part) writeSse(res, 'chunk', { delta: part, provider, model, operationId });
  }
}

function resolveWorkspacePath(body: any) {
  const value = typeof body?.repositoryPath === 'string' && body.repositoryPath.trim()
    ? body.repositoryPath
    : body?.workspacePath;
  return typeof value === 'string' ? value.trim() : '';
}

function providerDiagnostics(result: any, defaults: Record<string, string>) {
  return {
    provider: result?.provider || defaults.selectedProvider,
    model: result?.model || defaults.selectedModel,
    fallbackProvider: result?.fallbackProvider || defaults.fallbackProvider,
    fallbackModel: result?.fallbackModel || defaults.fallbackModel
  };
}

function writeDelegatedOutcomeSse(res: any, result: any, intent: any, operationId: string | undefined, defaults: Record<string, string>) {
  const route = result?.route || intent.route;
  const status = result?.status || (result?.error ? 'failed' : 'unknown');
  const diagnostics = providerDiagnostics(result, defaults);
  const base = {
    route,
    category: intent.category,
    goalId: result?.goalId,
    teamId: result?.teamId,
    status,
    operationId,
    ...diagnostics
  };

  if (result?.error || status === 'failed') {
    writeSse(res, 'execution_failed', {
      ...base,
      error: result?.error || 'Execution failed.',
      dependency: intent.selectedAgent || route,
      reason: result?.error || 'Execution failed.'
    });
    return;
  }

  if (status === 'waiting_for_approval' || status === 'awaiting_approval') {
    writeSse(res, 'approval_required', {
      ...base,
      reason: status === 'waiting_for_approval'
        ? 'CodeX is waiting for approval before continuing.'
        : 'Agent Team is waiting for approval before execution.',
      proposedAction: intent.category,
      workspace: undefined
    });
    return;
  }

  if (status === 'paused') {
    writeSse(res, 'paused', {
      ...base,
      reason: 'Execution is paused.'
    });
    return;
  }

  if (status === 'completed') {
    writeSse(res, 'execution_completed', base);
    return;
  }

  if (status === 'queued' || status === 'planning' || status === 'running' || status === 'executing') {
    writeSse(res, status === 'queued' ? 'execution_started' : 'execution_progress', {
      ...base,
      state: status === 'queued' ? 'executing' : status
    });
    return;
  }

  writeSse(res, 'execution_progress', {
    ...base,
    state: status
  });
}

async function nextWithTimeout<T>(
  iterator: AsyncGenerator<T>,
  timeoutMs: number,
  abortController: AbortController,
  message: string
) {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

router.post('/conversations/:id/message', async (req, res) => {
  try {
    const { prompt, approvalPolicy, operationId } = req.body;
    const workspacePath = resolveWorkspacePath(req.body);
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Let the orchestrator handle everything (recording user message, routing, and acting).
    // workspacePath is passed through verbatim: routes that create real work validate
    // it and return an explicit error instead of falling back to a fake 'default'.
    const result = await jarvisOrchestrator.handleMessage(
      req.params.id,
      prompt,
      workspacePath,
      normalizeApprovalPolicy(approvalPolicy),
      typeof operationId === 'string' ? operationId : undefined
    );

    if (result?.error) {
      // The error is already recorded as a conversation message by the orchestrator;
      // surface it honestly at the HTTP level too.
      return res.status(400).json({ error: result.error, route: result.route });
    }
    res.json(result || { success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations/:id/approve_team ──────── */
router.post('/conversations/:id/message/stream', async (req, res) => {
  const { prompt, approvalPolicy, operationId } = req.body;
  const workspacePath = resolveWorkspacePath(req.body);
  const normalizedOperationId = typeof operationId === 'string' ? operationId : undefined;
  logStreamStage(normalizedOperationId, 'stream request accepted', {
    conversationId: req.params.id,
    hasPrompt: typeof prompt === 'string',
    bodyKeys: Object.keys(req.body || {})
  });

  if (!prompt || typeof prompt !== 'string') {
    logStreamStage(normalizedOperationId, 'prompt validation failed', { reason: 'prompt is required' });
    return res.status(400).json({ error: 'prompt is required' });
  }
  logStreamStage(normalizedOperationId, 'prompt validated', { promptLength: prompt.length });

  const conversation = await conversationService.getConversation(req.params.id);
  if (!conversation) {
    logStreamStage(normalizedOperationId, 'conversation validation failed', { conversationId: req.params.id });
    return res.status(404).json({ error: 'Conversation not found' });
  }
  logStreamStage(normalizedOperationId, 'conversation validated', { conversationId: req.params.id });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  logStreamStage(normalizedOperationId, 'response headers flushed');

  const selectedProvider = 'OpenRouter';
  const selectedModel = OPENROUTER_DEFAULT_MODEL;
  const fallbackProvider = 'ollama';
  const fallbackModel = 'qwen2.5-coder:14b';
  writeSse(res, 'status', {
    state: 'thinking',
    provider: selectedProvider,
    model: selectedModel,
    fallbackProvider,
    fallbackModel,
    operationId: normalizedOperationId
  });
  logStreamStage(normalizedOperationId, 'status event sent', {
    state: 'thinking',
    provider: selectedProvider,
    model: selectedModel,
    fallbackProvider,
    fallbackModel
  });

  const requestMetadata = normalizedOperationId ? { operationId: normalizedOperationId } : undefined;
  const abortController = new AbortController();
  let clientClosed = false;
  let completed = false;
  let totalTimer: NodeJS.Timeout | null = null;
  let sawFirstToken = false;

  req.on('close', () => {
    clientClosed = true;
    logStreamStage(normalizedOperationId, 'client disconnected', { completed });
    if (!completed) abortController.abort();
  });

  try {
    logStreamStage(normalizedOperationId, 'intent routing started');
    const intent = await intentRouter.routeIntent(prompt);
    logStreamStage(normalizedOperationId, 'intent routing completed', {
      route: intent.route,
      category: intent.category,
      mode: intent.mode,
      confidence: intent.confidence
    });

    writeSse(res, 'intent', {
      type: intent.category || intent.route,
      route: intent.route,
      mode: intent.mode || (intent.route === 'direct' ? 'direct_conversation' : 'operational_execution'),
      confidence: intent.confidence,
      reason: intent.reason,
      requiresWorkspace: Boolean(intent.requiresWorkspace),
      requiresApproval: Boolean(intent.requiresApproval),
      operationId: normalizedOperationId
    });

    if (intent.route !== 'direct') {
      if (intent.plan?.length) {
        writeSse(res, 'plan', { steps: intent.plan, operationId: normalizedOperationId });
      }
      if (intent.selectedAgent) {
        writeSse(res, 'agent_selected', {
          agent: intent.selectedAgent,
          reason: intent.reason,
          operationId: normalizedOperationId
        });
      }
      if (intent.requiresWorkspace) {
        writeSse(res, 'status', {
          state: 'planning',
          workspace: workspacePath || null,
          operationId: normalizedOperationId
        });
      }
      if (intent.requiresApproval) {
        writeSse(res, 'approval_required', {
          reason: 'This request may write files, start execution, or change system state.',
          proposedAction: prompt,
          workspace: workspacePath || null,
          operationId: normalizedOperationId
        });
      }
      writeSse(res, 'execution_progress', {
        route: intent.route,
        category: intent.category,
        agent: intent.selectedAgent || 'Jarvis',
        state: 'delegating',
        operationId: normalizedOperationId
      });
      logStreamStage(normalizedOperationId, 'delegating non-direct route', { route: intent.route, category: intent.category });
      const result = await jarvisOrchestrator.handleMessage(
        req.params.id,
        prompt,
        workspacePath,
        normalizeApprovalPolicy(approvalPolicy),
        normalizedOperationId
      );
      const delegatedDefaults = { selectedProvider, selectedModel, fallbackProvider, fallbackModel };
      if (result?.error) {
        const diagnostics = providerDiagnostics(result, delegatedDefaults);
        writeSse(res, 'error', {
          error: result.error,
          route: result.route,
          reason: result.error,
          operationId: normalizedOperationId,
          ...diagnostics
        });
      }
      writeDelegatedOutcomeSse(res, result, intent, normalizedOperationId, delegatedDefaults);
      writeSse(res, 'done', {
        route: result?.route || intent.route,
        category: intent.category,
        goalId: result?.goalId,
        teamId: result?.teamId,
        status: result?.status,
        operationId: normalizedOperationId,
        ...providerDiagnostics(result, delegatedDefaults)
      });
      completed = true;
      return res.end();
    }

    await conversationService.appendMessage({
      conversationId: req.params.id,
      role: 'user',
      content: prompt,
      metadata: requestMetadata
    });

    await conversationService.appendMessage({
      conversationId: req.params.id,
      role: 'system',
      messageType: 'routing_event',
      content: `Intent routed to DIRECT (Confidence: ${(intent.confidence * 100).toFixed(0)}%) - ${intent.reason}`,
      metadata: { intent, ...(requestMetadata || {}) }
    });

    if (intent.category === 'system_status') {
      const startedAt = Date.now();
      const reply = buildLiveCapabilityAnswer(workspacePath || undefined);
      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'registry', intent }
      });
      writeSse(res, 'done', {
        route: 'direct',
        category: intent.category,
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'registry',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      logStreamStage(normalizedOperationId, 'stream completed', {
        provider: 'agentic-os',
        model: 'registry',
        responseLength: reply.length
      });
      completed = true;
      return res.end();
    }

    const systemPrompt = [
      'You are Jarvis, the operational commander of Agentic OS.',
      'For normal conversation, answer directly and briefly.',
      'Do not claim reminders, messaging, calendar actions, or external services unless the prompt or Agentic OS registry explicitly provides them.',
      'If asked about system capabilities, describe Agentic OS capabilities: CodeX delegation, Agent Teams, workspace inspection/change through approval, runtime/tool/pipeline status, and research/search only when available.'
    ].join('\n');
    logStreamStage(normalizedOperationId, 'provider/model selected', {
      provider: selectedProvider,
      model: selectedModel,
      fallbackProvider,
      fallbackModel
    });
    const stream = llmChatStream({
      systemPrompt,
      prompt,
      timeoutMs: getDirectChatFirstTokenTimeoutMs(),
      ollamaTimeoutMs: getDirectChatTotalTimeoutMs(),
      signal: abortController.signal
    });
    logStreamStage(normalizedOperationId, 'provider call started', {
      provider: selectedProvider,
      model: selectedModel
    });

    const startedAt = Date.now();
    const firstTokenTimeoutMs = getDirectChatFirstTokenTimeoutMs();
    const totalTimeoutMs = getDirectChatTotalTimeoutMs();
    let firstTokenAt: number | null = null;
    let reply = '';
    let provider: string | undefined;
    let model: string | undefined;
    totalTimer = setTimeout(() => {
      logStreamStage(normalizedOperationId, 'total-response timeout', { timeoutMs: totalTimeoutMs, provider, model });
      abortController.abort();
    }, totalTimeoutMs);

    while (true) {
      const remainingTotal = Math.max(1, totalTimeoutMs - (Date.now() - startedAt));
      const timeoutMs = firstTokenAt === null
        ? Math.min(firstTokenTimeoutMs, remainingTotal)
        : remainingTotal;
      const result = await nextWithTimeout(
        stream,
        timeoutMs,
        abortController,
        firstTokenAt === null
          ? `Jarvis provider timed out before first token after ${firstTokenTimeoutMs} ms.`
          : `Jarvis response timed out after ${totalTimeoutMs} ms.`
      );

      if (result.done) break;
      const chunk = result.value;
      provider = chunk.provider;
      model = chunk.model;
      if (chunk.type === 'token' && chunk.content) {
        if (firstTokenAt === null) {
          firstTokenAt = Date.now();
          sawFirstToken = true;
          logStreamStage(normalizedOperationId, 'first token received', {
            elapsedMs: firstTokenAt - startedAt,
            provider,
            model
          });
          writeSse(res, 'timing', {
            marker: 'first_token',
            elapsedMs: firstTokenAt - startedAt,
            provider,
            model,
            operationId: normalizedOperationId
          });
        }
        reply += chunk.content;
        writeSse(res, 'chunk', { delta: chunk.content, provider, model, operationId: normalizedOperationId });
      }
    }

    const finalReply = reply.trim();
    if (!finalReply) throw new Error('Jarvis returned an empty response.');

    await conversationService.appendMessage({
      conversationId: req.params.id,
      role: 'agent',
      content: finalReply,
      routedAgent: 'jarvis',
      metadata: { ...(requestMetadata || {}), provider, model }
    });

    writeSse(res, 'done', {
      route: 'direct',
      operationId: normalizedOperationId,
      provider: provider || selectedProvider,
      model: model || selectedModel,
      firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null,
      totalMs: Date.now() - startedAt
    });
    logStreamStage(normalizedOperationId, 'stream completed', {
      provider: provider || selectedProvider,
      model: model || selectedModel,
      firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null,
      totalMs: Date.now() - startedAt,
      responseLength: finalReply.length
    });
    completed = true;
    return res.end();
  } catch (err: any) {
    if (totalTimer) clearTimeout(totalTimer);
    const cancelledByClient = abortController.signal.aborted && clientClosed;
    const timedOutBeforeFirstToken = abortController.signal.aborted && !cancelledByClient && !sawFirstToken;
    const message = cancelledByClient
      ? 'Jarvis response cancelled.'
      : err?.message || 'Jarvis response failed.';
    logStreamStage(normalizedOperationId, timedOutBeforeFirstToken ? 'first-token timeout' : 'provider error', {
      message,
      provider: selectedProvider,
      model: selectedModel,
      fallbackProvider,
      fallbackModel
    });
    if (!clientClosed) {
      writeSse(res, cancelledByClient ? 'cancelled' : 'error', {
        error: message,
        provider: selectedProvider,
        model: selectedModel,
        fallbackProvider,
        fallbackModel,
        reason: message,
        operationId: normalizedOperationId
      });
      completed = true;
      return res.end();
    }
  } finally {
    if (totalTimer) clearTimeout(totalTimer);
  }
});

router.post('/conversations/:id/approve_team', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { teamId } = req.body;
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });

    // 1. Validate conversation exists
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId)
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // 2. Validate team exists and is awaiting approval
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId)
    });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Idempotency: If already running or completed, return existing run
    if (team.status !== 'awaiting_approval' && team.status !== 'cancelled' && team.status !== 'declined') {
      const existingRun = await db.query.teamRuns.findFirst({
        where: eq(teamRuns.teamId, teamId)
      });
      if (existingRun) {
        return res.json({ runId: existingRun.id, teamId, status: existingRun.status });
      }
    }

    if (team.status === 'cancelled' || team.status === 'declined') {
      return res.status(400).json({ error: 'Cannot approve a cancelled team' });
    }

    // 3. Mark team as approved
    await db.update(teams)
      .set({ status: 'approved' })
      .where(eq(teams.id, teamId))
      .run();

    const runId = await TeamRunner.startTeam(teamId);

    // Update conversation activeRunId
    await db.update(conversations)
      .set({ activeRunId: runId })
      .where(eq(conversations.id, conversationId))
      .run();

    // Append execution message so UI switches to live card
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'team_execution',
      content: 'Agent Team execution started.',
      runId, // store the runId natively
      metadata: { runId, teamId, executionStatus: 'started', createdAt: new Date().toISOString() }
    });

    res.json({ runId, teamId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations/:id/cancel_team ──────── */
router.post('/conversations/:id/cancel_team', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { teamId } = req.body;
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });

    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId)
    });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (team.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Team is not awaiting approval' });
    }

    await db.update(teams)
      .set({ status: 'cancelled' })
      .where(eq(teams.id, teamId))
      .run();

    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'system_status',
      content: `Team execution cancelled.`
    });

    res.json({ success: true, teamId, status: 'cancelled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/jarvis/stream/:id ───────────────────────────── */
router.get('/stream/:id', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  conversationService.addStreamClient(req.params.id, res);

  req.on('close', () => {
    conversationService.removeStreamClient(req.params.id, res);
  });
});
/* ── GET /api/jarvis/diagnostics ─────────────────────────── */
router.get('/diagnostics', async (_req, res) => {
  // Return lightweight system diagnostics without exposing model reasoning
  res.json({
    summary: {
      connectedProviders: 1,
      totalProviders: 1,
      healthyRuntimes: 1,
      totalRuntimes: 1,
    },
    services: {
      hermes: { status: 'unavailable', reason: 'Not yet integrated' },
      memory: { status: 'unavailable', reason: 'Not yet integrated' },
      stt: { status: 'unavailable', reason: 'Not yet integrated' },
    }
  });
});

export default router;

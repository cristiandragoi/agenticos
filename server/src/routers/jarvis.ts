import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { conversationService } from '../domains/conversations/service.js';
import { jarvisOrchestrator } from '../domains/jarvis/orchestrator.js';
import { intentRouter, detectDelegationSignals, type IntentResult } from '../domains/jarvis/intentRouter.js';
import { TeamRunner } from '../services/agentTeams/teamRunner.js';
import { db } from '../db/index.js';
import { conversations, teams, teamRuns } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { llmChatStream } from '../services/llmGateway.js';
import { AgentProviderAssignmentService } from '../services/agent/assignments.js';
import { mockAgents, mockProviders, mockRuntimes, mockTools } from '../data.js';

const router = Router();

function getDirectChatFirstTokenTimeoutMs() {
  return Number(process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS || 20_000);
}

function getDirectChatTotalTimeoutMs() {
  return Number(process.env.JARVIS_TOTAL_RESPONSE_TIMEOUT_MS || 120_000);
}

function getDirectChatStreamIdleTimeoutMs() {
  return Number(process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS || 30_000);
}

function getDirectChatConnectTimeoutMs() {
  return Number(process.env.JARVIS_CONNECT_TIMEOUT_MS || 20_000);
}

function getDirectChatOverallTimeoutMs() {
  return Number(process.env.JARVIS_OVERALL_TIMEOUT_MS || 120_000);
}

/**
 * Metadata-only resolution for SSE status/trace labels. Must mirror the
 * gateway's effective selection without influencing it:
 * - fallback model: same expression the Ollama provider registration uses
 *   (gateway/config.ts), so the label always matches the real fallback.
 * - selected model: the runtime DB assignment model wins (the gateway
 *   injects assignment.modelId into the request), otherwise the live
 *   OPENROUTER_MODEL env default. Read at request time — never from
 *   module-load constants, which can freeze before dotenv loads.
 */
async function resolveDirectChatMetadata(): Promise<{ selectedModel: string; fallbackModel: string }> {
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';
  let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
    }
  } catch (err) {
    logger.warn('[JarvisStream] assignment lookup for metadata failed; using env model label', err);
  }
  return { selectedModel, fallbackModel };
}

function logStreamStage(operationId: string | undefined, stage: string, details: Record<string, any> = {}) {
  logger.info('[JarvisStream]', stage, {
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
  const inputChannel = typeof req.body.inputChannel === 'string' ? req.body.inputChannel : undefined;
  const workspacePath = resolveWorkspacePath(req.body);
  const normalizedOperationId = typeof operationId === 'string' ? operationId : undefined;
  logStreamStage(normalizedOperationId, 'stream request accepted', {
    conversationId: req.params.id,
    hasPrompt: typeof prompt === 'string',
    bodyKeys: Object.keys(req.body || {})
  });

  logger.info('[JarvisTrace] request-received', JSON.stringify({
    requestId: normalizedOperationId,
    conversationId: req.params.id,
    route: req.headers.referer,
    rawUserText: prompt
  }, null, 2));

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
  const { selectedModel, fallbackModel } = await resolveDirectChatMetadata();
  const fallbackProvider = 'ollama';
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
    // ── Task-control intercept (Milestone: explicit commands override routing) ──
    // A normal conversation message NEVER touches task state. Only these
    // explicit task-control intents do. Check BEFORE intent routing.
    const { classifyTaskControl, executeTaskControl } = await import('../services/backgroundTasks/taskControl.js');
    const taskIntent = classifyTaskControl(prompt);
    if (taskIntent) {
      logStreamStage(normalizedOperationId, 'task-control intercept', { type: taskIntent.type });
      writeSse(res, 'intent', { type: 'task_control', route: 'task_control', mode: 'task_control', confidence: 1, operationId: normalizedOperationId });
      const reply = await executeTaskControl(taskIntent);
      if (reply) {
        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'task-manager', taskControl: taskIntent.type }
        });
      }
      writeSse(res, 'done', { route: 'task_control', category: 'task_control', operationId: normalizedOperationId, provider: 'agentic-os', model: 'task-manager', firstTokenMs: 0, totalMs: 0 });
      completed = true;
      return res.end();
    }

    logStreamStage(normalizedOperationId, 'intent routing started');
    // ── Executive intent intercept (internal-worker awareness) ──
    // Runs after explicit task-control but before the generic intent router.
    // When the prompt names an internal capability (Hermes/CodeX/Research/
    // Teams/Boards/Memory/Automations), the executive classifier decides
    // between explanation, status, feedback, delegation, or navigation.
    const { classifyExecutiveIntent } = await import('../domains/jarvis/executiveIntent.js');
    const { buildWorkerFeedback, buildWorkerStatus, buildCapabilityExplanation } = await import('../domains/jarvis/workerInsights.js');
    const { investigateAgenticState } = await import('../domains/jarvis/investigation.js');
    const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
    const { dispatchTask } = await import('../services/backgroundTasks/adapters.js');
    const { taskShortId } = await import('../services/backgroundTasks/types.js');

    const executive = classifyExecutiveIntent(prompt);
    if (executive && executive.intent !== 'worker_delegation' && executive.intent !== 'revenue_pipeline') {
      const execRoute = executive.intent;
      logStreamStage(normalizedOperationId, 'executive intent intercept', {
        intent: execRoute,
        capability: executive.capability.id,
        confidence: executive.confidence
      });
      writeSse(res, 'intent', {
        type: execRoute,
        route: execRoute,
        mode: execRoute === 'direct_explanation' ? 'direct_conversation' : 'operational_execution',
        confidence: executive.confidence,
        reason: executive.reason,
        capability: executive.capability.id,
        operationId: normalizedOperationId
      });

      const startedAt = Date.now();
      let reply = '';
      if (execRoute === 'navigation') {
        writeSse(res, 'navigation', {
          target: executive.capability.route,
          capability: executive.capability.id,
          operationId: normalizedOperationId
        });
        reply = `Opening ${executive.capability.displayName}.`;
      } else if (execRoute === 'board_query') {
        reply = buildCapabilityExplanation(executive.capability) + '\n\nOpen the task board to see live cards.';
      } else if (execRoute === 'memory_query') {
        reply = buildCapabilityExplanation(executive.capability);
      } else if (execRoute === 'automation_request') {
        reply = buildCapabilityExplanation(executive.capability) + '\n\nSay "create an automation" and I will register it as a background task.';
      } else if (execRoute === 'worker_feedback') {
        reply = await buildWorkerFeedback(executive.capability);
      } else if (execRoute === 'worker_status') {
        const modelOnly = /what (model|provider)/.test(prompt.toLowerCase());
        reply = await buildWorkerStatus(executive.capability, modelOnly);
      } else {
        reply = buildCapabilityExplanation(executive.capability);
      }

      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          provider: 'agentic-os',
          model: 'registry',
          intent: { type: execRoute, capability: executive.capability.id, confidence: executive.confidence }
        }
      });
      writeSse(res, 'done', {
        route: execRoute,
        category: execRoute,
        capability: executive.capability.id,
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'registry',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      completed = true;
      return res.end();
    }

    // ── Executive delegation: create a persistent background task ──
    // JARVIS must respond with task ref, selected worker, status, read-only
    // flag, and the fact that the task continues while conversation remains
    // available — immediately, before the worker stream starts.
    if (executive?.intent === 'worker_delegation' && executive.workerKind) {
      const workerKind = executive.workerKind as 'hermes' | 'codex' | 'research' | 'team' | 'automation';
      const workerTitle =
        workerKind === 'hermes' ? 'Hermes'
        : workerKind === 'codex' ? 'CodeX'
        : workerKind === 'research' ? 'Research'
        : workerKind === 'team' ? 'Agent Teams'
        : workerKind === 'automation' ? 'Automations'
        : executive.capability.displayName;

      logStreamStage(normalizedOperationId, 'executive delegation', {
        worker: workerKind,
        readOnly: Boolean(executive.readOnly),
        capability: executive.capability.id
      });
      writeSse(res, 'intent', {
        type: 'worker_delegation',
        route: 'worker_delegation',
        mode: 'operational_execution',
        confidence: executive.confidence,
        reason: executive.reason,
        capability: executive.capability.id,
        worker: workerKind,
        readOnly: Boolean(executive.readOnly),
        operationId: normalizedOperationId
      });

      const title = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
      const { task, error } = backgroundTaskManager.createTask({
        title,
        objective: prompt,
        originalRequest: prompt,
        route: workerKind,
        selectedAgent: workerTitle,
        worker: workerKind,
        conversationId: req.params.id,
        resumable: workerKind === 'codex',
        metadata: {
          operationId: normalizedOperationId,
          readOnly: Boolean(executive.readOnly),
          capabilityId: executive.capability.id
        },
      });
      if (!task) {
        writeSse(res, 'error', {
          error: error || 'Could not create the background task.',
          route: 'worker_delegation',
          operationId: normalizedOperationId
        });
        writeSse(res, 'done', { route: 'worker_delegation', status: 'failed', operationId: normalizedOperationId });
        completed = true;
        return res.end();
      }

      dispatchTask(task).catch(() => { /* adapter records its own failure */ });

      const shortId = taskShortId(task.taskId);
      const readOnlyNote = executive.readOnly ? ' Read-only — no file changes will be made.' : '';
      const delegationStartedAt = Date.now();
      const reply =
        `I started task ${shortId} with ${workerTitle}. Status: queued.` +
        `${readOnlyNote} The task continues in the background — keep talking to me, and ask "show task ${shortId}" for progress.`;
      writeSse(res, 'chunk', { delta: reply, provider: 'agentic-os', model: 'task-manager', operationId: normalizedOperationId });
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          taskId: task.taskId,
          provider: 'agentic-os',
          model: 'task-manager',
          intent: { type: 'worker_delegation', capability: executive.capability.id, worker: workerKind, readOnly: Boolean(executive.readOnly) }
        }
      });
      writeSse(res, 'done', {
        route: 'worker_delegation',
        category: 'worker_delegation',
        taskId: task.taskId,
        status: 'queued',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'task-manager',
        firstTokenMs: 0,
        totalMs: Date.now() - delegationStartedAt
      });
      completed = true;
      return res.end();
    }

    // ── Revenue Pipeline: create a persistent background task ──
    // Intake is parsed deterministically; the pipeline defaults to dry-run
    // (safe). One task + one Board card, exactly like other delegations.
    if (executive?.intent === 'revenue_pipeline' && executive.workerKind === 'revenue') {
      const workerKind = 'revenue';
      const workerTitle = 'Revenue Pipeline';
      const { parsePipelineRequest } = await import('../services/revenuePipeline/intake.js');
      const intake = parsePipelineRequest(prompt);

      logStreamStage(normalizedOperationId, 'revenue pipeline intake', {
        niche: intake.config.niche,
        city: intake.config.city,
        prospectCount: intake.config.prospectCount,
        dryRun: intake.config.dryRun,
        specificUrl: intake.config.specificUrl || null,
        missing: intake.missing,
        confidence: intake.confidence,
      });
      writeSse(res, 'intent', {
        type: 'revenue_pipeline',
        route: 'revenue_pipeline',
        mode: 'operational_execution',
        confidence: executive.confidence,
        reason: executive.reason,
        capability: 'revenue_pipeline',
        worker: workerKind,
        dryRun: intake.config.dryRun,
        operationId: normalizedOperationId,
      });

      // Required values are NEVER invented. If any of niche / city /
      // prospectCount is genuinely absent, ask ONE clarification instead of
      // creating a task with defaults.
      if (intake.missing.length > 0) {
        const askMap: Record<string, string> = {
          niche: 'which industry/niche to target (e.g. roofing, plumbing)',
          city: 'which city or region to target',
          prospectCount: 'how many prospects to evaluate',
        };
        const questions = intake.missing.map((m: string) => askMap[m] || m);
        const reply =
          `I need a bit more detail before starting the Revenue Pipeline: please tell me ${questions.join(', and ')}. ` +
          `No task was created — I will not guess.`;
        writeSse(res, 'chunk', { delta: reply, provider: 'agentic-os', model: 'task-manager', operationId: normalizedOperationId });
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: {
            ...(requestMetadata || {}),
            provider: 'agentic-os',
            model: 'task-manager',
            intent: { type: 'revenue_pipeline', capability: 'revenue_pipeline', worker: workerKind, clarification: intake.missing }
          }
        });
        writeSse(res, 'done', {
          route: 'revenue_pipeline_clarification',
          category: 'revenue_pipeline',
          operationId: normalizedOperationId,
          provider: 'agentic-os',
          model: 'task-manager',
          firstTokenMs: 0,
          totalMs: 0,
        });
        completed = true;
        return res.end();
      }

      const title = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
      const { task, error } = backgroundTaskManager.createTask({
        title,
        objective: prompt,
        originalRequest: prompt,
        route: 'revenue_pipeline',
        selectedAgent: workerTitle,
        worker: workerKind,
        conversationId: req.params.id,
        resumable: false,
        metadata: {
          operationId: normalizedOperationId,
          capabilityId: 'revenue_pipeline',
          ...intake.config,
          intakeNotes: intake.notes,
        },
      });
      if (!task) {
        writeSse(res, 'error', {
          error: error || 'Could not create the revenue pipeline task.',
          route: 'revenue_pipeline',
          operationId: normalizedOperationId,
        });
        writeSse(res, 'done', { route: 'revenue_pipeline', status: 'failed', operationId: normalizedOperationId });
        completed = true;
        return res.end();
      }

      dispatchTask(task).catch(() => { /* adapter records its own failure */ });

      const shortId = taskShortId(task.taskId);
      const pipelineStartedAt = Date.now();
      const dryRunNote = intake.config.dryRun
        ? ' DRY-RUN — nothing will be contacted, published, or deployed.'
        : ' Live mode requested — V1 discovery requires a specific business URL.';
      const reply =
        `I started task ${shortId} — Revenue Pipeline: ${intake.config.niche} · ${intake.config.city || 'no region specified'} · ${intake.config.prospectCount} prospect(s).` +
        `${dryRunNote} Status: queued. Ask "show task ${shortId}" for progress.`;
      writeSse(res, 'chunk', { delta: reply, provider: 'agentic-os', model: 'task-manager', operationId: normalizedOperationId });
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          taskId: task.taskId,
          provider: 'agentic-os',
          model: 'task-manager',
          intent: { type: 'revenue_pipeline', capability: 'revenue_pipeline', worker: workerKind, dryRun: intake.config.dryRun }
        }
      });
      writeSse(res, 'done', {
        route: 'revenue_pipeline',
        category: 'revenue_pipeline',
        taskId: task.taskId,
        status: 'queued',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'task-manager',
        firstTokenMs: 0,
        totalMs: Date.now() - pipelineStartedAt
      });
      completed = true;
      return res.end();
    }

    const classified = await intentRouter.routeIntent(prompt);
    logStreamStage(normalizedOperationId, 'intent routing completed', {
      route: classified.route,
      category: classified.category,
      mode: classified.mode,
      confidence: classified.confidence
    });

    logger.info('[JarvisTrace] intent-result', JSON.stringify({
      requestId: normalizedOperationId,
      intent: classified.route,
      confidence: classified.confidence,
      executionMode: classified.mode || 'direct_conversation'
    }, null, 2));

    // Determine the final effective route after explicit user-intent overrides so the
    // routing event and the execution path always describe the route actually used.
    const delegationSignals = detectDelegationSignals(prompt);
    let intent: IntentResult = classified;
    if (classified.route !== 'direct' && delegationSignals.explicitNonDelegationRequested) {
      intent = {
        ...classified,
        route: 'direct',
        mode: 'direct_conversation',
        confidence: 0.99,
        reason: 'Explicit non-delegation instruction requires Jarvis direct handling',
        selectedAgent: 'Jarvis',
        requiresWorkspace: false,
        requiresApproval: false,
        plan: undefined
      };
      logStreamStage(normalizedOperationId, 'explicit non-delegation override applied', {
        classifierRoute: classified.route,
        effectiveRoute: intent.route
      });
    }

    const referer = req.headers.referer || '';
    let uiRoute = 'unknown';
    if (referer.includes('/jarvis')) uiRoute = '/jarvis';
    else if (referer.includes('/codex')) uiRoute = '/codex';
    else if (referer.includes('/hermes')) uiRoute = '/hermes';

    logger.info('[RequestOwnership]', JSON.stringify({
      route: uiRoute,
      selectedAgentId: 'agent-jarvis',
      requestAgentId: 'agent-jarvis',
      intent: intent.route,
      executionMode: intent.mode || 'direct_conversation',
      goalCreated: intent.route === 'codex'
    }));

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

    // ── INVESTIGATE (implicit bug reports / contextual problem statements) ──
    // Inspect-first, ask-later. Runs a read-only state inspection and streams
    // an evidence report; never the generic "What interface?" clarification.
    if (intent.route === 'investigate') {
      logStreamStage(normalizedOperationId, 'investigate route', { confidence: intent.confidence });
      const startedAt = Date.now();
      let reply: string;
      try {
        reply = await investigateAgenticState(req.params.id, prompt);
      } catch (err: any) {
        reply = `I attempted a read-only inspection but it failed: ${err?.message || err}. Nothing was changed.`;
      }
      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          provider: 'agentic-os',
          model: 'registry',
          intent: { type: 'investigate', category: 'investigation', confidence: intent.confidence }
        }
      });
      writeSse(res, 'done', {
        route: 'investigate',
        category: 'investigation',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'registry',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      completed = true;
      return res.end();
    }

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
      metadata: inputChannel ? { ...(requestMetadata || {}), inputChannel } : requestMetadata
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
      'If asked about system capabilities, describe Agentic OS capabilities: CodeX delegation, Agent Teams, workspace inspection/change through approval, runtime/tool/pipeline status, and research/search only when available.',
      'Never narrate your internal reasoning; answer the user directly instead of describing your own thought process.',
      'Do not write phrases such as "the user is asking" or otherwise refer to the user in the third person.',
      'Do not claim voice playback is working unless the runtime confirms audio playback started.',
      ...(inputChannel === 'voice' ? [
        'Input channel: microphone transcript.',
        'The fact that this text reached you means microphone capture and transcription are working.',
        'Microphone input and voice output are separate capabilities; do not infer voice playback status from input being transcribed.'
      ] : [])
    ].join('\n');
    logStreamStage(normalizedOperationId, 'provider/model selected', {
      provider: selectedProvider,
      model: selectedModel,
      fallbackProvider,
      fallbackModel
    });

    logger.info('[JarvisTrace] prompt-built', JSON.stringify({
      requestId: normalizedOperationId,
      provider: selectedProvider,
      model: selectedModel,
      systemPromptLength: systemPrompt.length,
      userPromptExact: prompt,
      messageCount: 2
    }, null, 2));
    const stream = llmChatStream({
      systemPrompt,
      prompt,
      agentId: 'agent-jarvis',
      // Gateway request budget: connection/first-response allowance for HTTP
      // gateways and the overall request allowance for Ollama. First-token,
      // stream-idle, and total-response enforcement stay local to this handler
      // via nextWithTimeout and totalTimer below.
      timeoutMs: getDirectChatConnectTimeoutMs(),
      ollamaTimeoutMs: getDirectChatOverallTimeoutMs(),
      signal: abortController.signal,
      requestId: normalizedOperationId
    });
    logStreamStage(normalizedOperationId, 'provider call started', {
      provider: selectedProvider,
      model: selectedModel
    });

    const startedAt = Date.now();
    const firstTokenTimeoutMs = getDirectChatFirstTokenTimeoutMs();
    const totalTimeoutMs = getDirectChatTotalTimeoutMs();
    const streamIdleTimeoutMs = getDirectChatStreamIdleTimeoutMs();
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
      // Per-wait deadline: before the first token it is the first-token allowance;
      // afterwards it is the stream-idle allowance. Both are capped by the remaining
      // total budget. The timer is created per wait inside nextWithTimeout and cleared
      // in its finally block, so every received chunk resets the idle window and no
      // timer survives the current wait (normal completion, provider error, or abort).
      let timeoutMs: number;
      let timeoutMessage: string;
      if (firstTokenAt === null) {
        timeoutMs = Math.min(firstTokenTimeoutMs, remainingTotal);
        timeoutMessage = `Jarvis provider timed out before first token after ${firstTokenTimeoutMs} ms.`;
      } else if (streamIdleTimeoutMs <= remainingTotal) {
        timeoutMs = streamIdleTimeoutMs;
        timeoutMessage = `Jarvis stream was idle for ${streamIdleTimeoutMs} ms and the provider request was aborted.`;
      } else {
        timeoutMs = remainingTotal;
        timeoutMessage = `Jarvis response timed out after ${totalTimeoutMs} ms.`;
      }
      const result = await nextWithTimeout(stream, timeoutMs, abortController, timeoutMessage);

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
      } else if (chunk.type !== 'done' && chunk.type !== 'error') {
        // Forward gateway events exactly as received
        writeSse(res, chunk.type, { ...chunk, operationId: normalizedOperationId, id: `assistant-${normalizedOperationId}` });
      }
    }

    const finalReply = reply.trim();
    if (!finalReply) throw new Error('Jarvis returned an empty response.');

    logger.info('[JarvisTrace] provider-response', JSON.stringify({
      requestId: normalizedOperationId,
      provider,
      model,
      status: 'completed',
      responsePreview: finalReply.slice(0, 150)
    }, null, 2));

    logger.info('[JarvisTrace] response-rendered', JSON.stringify({
      requestId: normalizedOperationId,
      messageId: `assistant-${normalizedOperationId}`,
      agentId: 'agent-jarvis',
      renderedText: process.env.NODE_ENV === 'development' ? finalReply : '<redacted in production>'
    }, null, 2));

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

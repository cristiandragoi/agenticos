import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { conversationService } from '../domains/conversations/service.js';
import { jarvisOrchestrator } from '../domains/jarvis/orchestrator.js';
import { getWorkspaceRoot as getCanonicalWorkspaceRoot } from '../services/workspaceStore.js';
import { resolvePromptFileReferences, enrichPromptWithResolvedFiles, buildFileNotFoundReply } from '../domains/jarvis/fileResolution.js';
import { intentRouter, detectDelegationSignals, type IntentResult } from '../domains/jarvis/intentRouter.js';
import { TeamRunner } from '../services/agentTeams/teamRunner.js';
import { db } from '../db/index.js';
import { conversations, teams, teamRuns } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { llmChatStream } from '../services/llmGateway.js';
import { AgentProviderAssignmentService, mapCatalogToGatewayId } from '../services/agent/assignments.js';

const router = Router();

function getDirectChatFirstTokenTimeoutMs() {
  // Overall no-chunk backstop for the DIRECT stream, intentionally LONGER
  // than the per-attempt connect budget (8s): the per-attempt timeout makes a
  // stalled primary fail fast and the router's zero-token fallback move to
  // Ollama (~8s primary + local TTFT); this local timer only aborts if NO
  // chunk at all (including gateway.selected/fallback events) arrives for
  // the whole window — a genuine total stall, not a slow provider.
  return Number(process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS || 15_000);
}

function getDirectChatTotalTimeoutMs() {
  return Number(process.env.JARVIS_TOTAL_RESPONSE_TIMEOUT_MS || 120_000);
}

function getDirectChatStreamIdleTimeoutMs() {
  return Number(process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS || 30_000);
}

function getDirectChatConnectTimeoutMs() {
  // Per-attempt budget for the OpenAI-compatible gateway (wired via
  // buildRequestSignal): covers connect + first response for ONE provider
  // attempt. 8s matches the first-token policy above; a healthy primary
  // (~0.5–1.5s TTFT) is unaffected, and a stalled primary aborts this
  // attempt so the router's zero-token fallback can move to Ollama.
  return Number(process.env.JARVIS_CONNECT_TIMEOUT_MS || 8_000);
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
async function resolveDirectChatMetadata(): Promise<{ selectedProvider: string; selectedModel: string; fallbackModel: string }> {
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';
  let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
  let selectedProvider = 'OpenRouter';
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
      // Provider label must reflect the ACTUAL resolved gateway provider
      // (Jarvis repair): derive it from the assignment via the canonical
      // catalog→gateway mapping so the SSE/status display, the routing log,
      // and the outgoing request all agree (e.g. prov-deepseek → DeepSeek),
      // instead of hard-coding 'OpenRouter'.
      selectedProvider = mapCatalogToGatewayId(assignment.providerId) || selectedProvider;
    }
  } catch (err) {
    logger.warn('[JarvisStream] assignment lookup for metadata failed; using env model label', err);
  }
  return { selectedProvider, selectedModel, fallbackModel };
}

/**
 * Bounded recovery wrapper (GAP1 closeout): the streaming gateway does not
 * thread per-call escalation into the provider's stream attempts, so a
 * transient provider failure (connection reset, 429, Ollama EOF) surfaces as
 * an error chunk. Retry the SAME real request ONCE — the second execution is
 * a genuine LLM call — before surfacing the error. Mirrors RecoveryPolicy's
 * same-model-retry semantics at the smallest layer.
 */
async function* llmChatStreamRetrying(opts: Parameters<typeof llmChatStream>[0]) {
  const RETRYABLE = /unreachable|fetch failed|econnrefused|timeout|429|eof|all configured providers failed/i;
  for (let attempt = 0; attempt <= 1; attempt++) {
    let sawError = false;
    let errorChunk: any = null;
    try {
      for await (const chunk of llmChatStream(opts)) {
        if (chunk.type === 'error') {
          sawError = true;
          errorChunk = chunk;
          break;
        }
        // llmChatStream surfaces provider failures as a *token* chunk whose
        // content starts with '[Stream Error: ' (see llmGateway catch) —
        // detect that marker and treat it as a retryable-error boundary.
        if (chunk.type === 'token' && typeof chunk.content === 'string' && chunk.content.includes('[Stream Error:')) {
          sawError = true;
          errorChunk = { type: 'error', error: chunk.content.replace(/^[\s\S]*\[Stream Error: /, '').replace(/\]\s*$/, '') };
          break;
        }
        yield chunk;
        if (chunk.type === 'done') return;
      }
      if (sawError && attempt < 1 && RETRYABLE.test(String(errorChunk?.error || errorChunk?.message || errorChunk?.content || ''))) {
        logStreamStage(opts.requestId || 'jarvis', 'transient provider error (chunk) — retrying request', { attempt: attempt + 1, error: String(errorChunk?.error || errorChunk?.message || '').slice(0, 160) });
        continue;
      }
      if (sawError && errorChunk) yield errorChunk;
      return;
    } catch (err: any) {
      // Provider exhaustion/transient failures surface as THROWN errors from
      // llmChatStream (not error chunks). Catch them at this recovery
      // boundary: one bounded retry of the SAME real request. Non-retryable
      // and abort/terminal errors rethrow unchanged so the caller's error
      // handling (and cancellation semantics) is preserved.
      const msg = String(err?.message || err || '');
      if (attempt < 1 && RETRYABLE.test(msg)) {
        logStreamStage(opts.requestId || 'jarvis', 'transient provider error (thrown) — retrying request', { attempt: attempt + 1, error: msg.slice(0, 160) });
        continue;
      }
      throw err;
    }
  }
}

export { llmChatStreamRetrying }; // test seam

/**
 * Authoritative Jarvis runtime identity (P3): the EFFECTIVE provider/model of
 * the LAST completed Jarvis turn, read from the persisted agent-message
 * metadata (the direct branch stores the gateway-resolved values per turn).
 * Falls back to the assigned/selected values when no turn has completed yet.
 */
async function resolveEffectiveJarvisIdentity(conversationId: string): Promise<{ effectiveProvider: string | null; effectiveModel: string | null }> {
  try {
    const msgs = await conversationService.getMessages(conversationId);
    const arr = Array.isArray(msgs) ? msgs : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const meta = (arr[i]?.metadata || {}) as Record<string, unknown>;
      const p = typeof meta.provider === 'string' && meta.provider ? meta.provider : null;
      const m = typeof meta.model === 'string' && meta.model ? meta.model : null;
      if (p || m) return { effectiveProvider: p, effectiveModel: m };
    }
  } catch { /* best effort — assigned values are the fallback */ }
  return { effectiveProvider: null, effectiveModel: null };
}

/** Recent conversation text for contextual routing (best effort). */
async function buildRecentConversationText(conversationId: string): Promise<string> {
  try {
    const msgs = await conversationService.getMessages(conversationId);
    const arr = Array.isArray(msgs) ? msgs : [];
    return arr.slice(-8)
      .map((m: any) => `${m.role || 'system'}: ${typeof m.content === 'string' ? m.content : ''}`)
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Build the LLM conversation history for the direct-chat call.
 *
 * ROOT-CAUSE FIX (runtime investigation): the direct-chat LLM previously
 * received ONLY systemPrompt + the current prompt (messageCount: 2), so it
 * had ZERO memory of the conversation — it could not answer "What is my
 * favorite color?" after the user stated it, and it hallucinated when asked
 * about prior context. History now comes from the persisted conversation.
 *
 * Excluded from history:
 *   - the current prompt itself (the gateway appends it after history),
 *   - routing_event/system bookkeeping messages (never user-visible),
 *   - everything beyond the bounded window (last 12 turns) and a sane char
 *     budget, so context windows are never blown by long histories.
 *   - REMEMBER: You have access to prior turn history. Explicitly lookup 
 *     facts from prior turns if the user asks a follow-up or references past context.
 */
const COMMON_ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', "aren't", 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', "can't", 'cannot',
  'could', "couldn't", 'did', "didn't", 'do', 'does', "doesn't", 'doing', "don't", 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'had', "hadn't", 'has', "hasn't", 'have', "haven't", 'having', 'he', "he'd",
  "he'll", "he's", 'her', 'here', "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how', "how's", 'i', "i'd",
  "i'll", "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its', 'itself', "let's", 'me', 'more',
  'most', "mustn't", 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', "shan't", 'she', "she'd", "she'll", "she's", 'should',
  "shouldn't", 'so', 'some', 'such', 'than', 'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', "there's", 'these', 'they', "they'd", "they'll", "they're", "they've", 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', "wasn't", 'we', "we'd", "we'll", "we're",
  "we've", 'were', "weren't", 'what', "what's", 'when', "when's", 'where', "where's", 'which', 'while', 'who',
  "who's", 'whom', 'why', "why's", 'with', "won't", 'would', "wouldn't", 'you', "you'd", "you'll", "you're",
  "you've", 'your', 'yours', 'yourself', 'yourselves'
]);

/**
 * Build the LLM conversation history for the direct-chat call.
 *
 * Excluded from history:
 *   - the current prompt itself,
 *   - routing_event/system bookkeeping messages,
 *   - old turns that do not share meaningful non-stopword tokens with the prompt,
 *   - noisy internal diagnostic dumps from past assistant messages.
 */
export function buildConversationHistory(
  messages: any[],
  currentPrompt: string,
  maxTurns = 12,
  maxChars = 10000,
): { role: 'user' | 'assistant'; content: string }[] {
  const raw = Array.isArray(messages) ? [...messages] : [];
  // If the last persisted message is the current user turn, pop it from history
  if (raw.length > 0) {
    const last = raw[raw.length - 1];
    if (last?.role === 'user' && typeof last?.content === 'string' && last.content.trim() === currentPrompt.trim()) {
      raw.pop();
    }
  }

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let chars = 0;

  // Extract non-stopword tokens from the current prompt
  const currentTokens = new Set<string>(
    currentPrompt
      .toLowerCase()
      .split(/\W+/)
      .filter((w: string) => w.length >= 3 && !COMMON_ENGLISH_STOPWORDS.has(w))
  );

  let skippedForRelevance = 0;
  let validTurnCount = 0;

  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i];
    const role = m?.role;
    let content = typeof m?.content === 'string' ? m.content : '';
    if (!content) continue;
    if (role === 'system') continue; // never surface bookkeeping system rows
    if (role !== 'user' && role !== 'agent') continue;

    // Sanitize past assistant messages so system errors/dumps don't become instructions
    if (role === 'agent') {
      if (content.includes('[Stream Error:')) continue; // skip error turns
      if (
        content.includes('Jarvis is currently executing') ||
        content.includes('CodeX is currently') ||
        content.includes('Hermes gateway') ||
        content.includes('Runtime diagnostics') ||
        content.includes('I inspected the active AgenticOS state')
      ) {
        // truncate operational dumps to keep context clean
        content = content.split('\n')[0].slice(0, 150);
      }
    }

    const turnIndex = validTurnCount;
    validTurnCount++;

    const turnTokens = new Set<string>(
      content
        .toLowerCase()
        .split(/\W+/)
        .filter((w: string) => w.length >= 3 && !COMMON_ENGLISH_STOPWORDS.has(w))
    );

    let shared = 0;
    turnTokens.forEach((tok) => {
      if (currentTokens.has(tok)) shared++;
    });

    // Continuity anchor: keep the last 6 valid turns (3 full user-assistant turn pairs)
    const isContinuityAnchor = turnIndex < 6;
    const isRelevant = shared >= 1 || isContinuityAnchor;

    if (!isRelevant) {
      skippedForRelevance++;
      continue;
    }

    const mapped = role === 'agent' ? 'assistant' : 'user';
    if (chars + content.length > maxChars) continue;
    history.unshift({ role: mapped, content });
    chars += content.length;
    if (history.length >= maxTurns) break;
  }

  if (skippedForRelevance > 0) {
    logStreamStage('history', 'relevance filter', { kept: history.length, skipped: skippedForRelevance });
  }
  return history;
}

function logStreamStage(operationId: string | undefined, stage: string, details: Record<string, any> = {}) {
  logger.info('[JarvisStream]', stage, {
    operationId,
    ...details
  });
}

/**
 * Prompt-hierarchy gate (§prompt-hierarchy): decides whether operational state
 * (active/recent tasks, runtime status) is injected into the direct-chat
 * system prompt. Only TRUE when the current user message genuinely asks about
 * tasks, agents, or runtime state. Ordinary conversation must never receive
 * task-state directives — that was the root cause of "Are you there?" being
 * answered with a Hermes-gateway inspection tangent.
 */
const OPERATIONAL_QUESTION_RE = /\b(task|tasks|run|runs|codex|hermes|agent team|agent teams|background|status|execution|goal|goals|active|what('s| is)? (happening|running|going on)|is .*(done|finished|complete)|how .*(going|progress))\b/i;
function isOperationalQuestion(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return OPERATIONAL_QUESTION_RE.test(text.slice(0, 400));
}

/**
 * Strip tool-call / function-call markup the model may emit as literal text.
 * The system prompt forbids it; this is a safety net so the user never sees
 * raw `<tool_call>…</tool_call>` in a reply (§18 — no leaked plumbing).
 */
function stripToolCallMarkup(text: string): string {
  if (!text) return text;
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<invoke>[\s\S]*?<\/invoke>/gi, '')
    .replace(/<function[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/```(?:json|xml)?\s*[\s\S]*?```/g, '')
    .trim();
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

/** Friendly display names for runtime identity (self-knowledge milestone).
 *  The RAW provider/model identifiers are always the truth anchor; these
 *  only make conversational answers natural. Unknown ids fall back to the
 *  raw value so nothing is ever invented. */
function friendlyProviderName(provider: string | null | undefined): string {
  const p = String(provider || '').toLowerCase();
  if (p.includes('openrouter')) return 'OpenRouter';
  if (p.includes('ollama')) return 'Ollama';
  if (p.includes('deepseek')) return 'DeepSeek';
  if (p.includes('anthropic')) return 'Anthropic';
  if (p.includes('omni')) return 'OmniRoute';
  if (!p) return 'unknown';
  return provider as string;
}

function friendlyModelName(model: string | null | undefined): string {
  const m = String(model || '').toLowerCase();
  if (m.includes('laguna-s-2.1')) return 'Laguna S 2.1';
  if (m.includes('laguna-xs')) return 'Laguna XS';
  if (m.includes('llama3.2')) return 'Llama 3.2';
  if (m.includes('llama')) return 'Llama';
  if (m.includes('qwen3.5')) return 'Qwen 3.5';
  if (m.includes('qwen')) return 'Qwen';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('gpt-4o')) return 'GPT-4o';
  if (m.includes('gpt-')) return 'GPT';
  if (m.includes('claude')) return 'Claude';
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('longcat')) return 'LongCat';
  if (m.includes('kimi')) return 'Kimi';
  if (m.includes('minimax')) return 'MiniMax';
  if (!m) return 'unknown';
  return model as string;
}

function buildLiveCapabilityAnswer(workspacePath: string | undefined, identity?: { selectedProvider: string; selectedModel: string; fallbackModel: string; effectiveProvider: string | null; effectiveModel: string | null }) {
  const effProvider = identity?.effectiveProvider || identity?.selectedProvider || 'unknown';
  const effModel = identity?.effectiveModel || identity?.selectedModel || 'unknown';
  const fallbackModel = identity?.fallbackModel || '';

  return [
    'I\'m Jarvis, the operational commander of Agentic OS.',
    `Right now I'm running ${friendlyModelName(effModel)} via ${friendlyProviderName(effProvider)}${fallbackModel ? `, with ${friendlyModelName(fallbackModel)} available locally as a fallback` : ''}.`,
    workspacePath?.trim() ? `The selected workspace is ${workspacePath.trim()}.` : '',
    'I can answer operational questions, inspect and modify files through approved workspace tasks, delegate coding work to CodeX, coordinate Agent Teams, and check runtime and pipeline status.',
  ].filter(Boolean).join('\n');
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
  const explicit = typeof value === 'string' ? value.trim() : '';
  // §1: ONE canonical workspace. When the client omits the repository,
  // every route still operates against the canonical selected root — the
  // user never has to re-state where the repository is.
  return explicit || getCanonicalWorkspaceRoot();
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

  const { selectedProvider: baseSelectedProvider, selectedModel: baseSelectedModel, fallbackModel } = await resolveDirectChatMetadata();
  const fallbackProvider = 'ollama';

  // Conversation-level provider/model override (PRIORITY 3): a manual choice
  // in the Jarvis chat routing control applies ONLY to this execution — it
  // never changes the global assignment.
  const overrideProvider: string | null = typeof req.body?.overrideProvider === 'string' && req.body.overrideProvider ? req.body.overrideProvider : null;
  const overrideModel: string | null = typeof req.body?.overrideModel === 'string' && req.body.overrideModel ? req.body.overrideModel : null;
  const selectedProvider = overrideProvider || baseSelectedProvider;
  const selectedModel = overrideModel || baseSelectedModel;
  const routingMode: 'auto' | 'manual' = overrideProvider || overrideModel ? 'manual' : 'auto';

  const streamStartedAt = Date.now();
  const statusBase = {
    provider: selectedProvider,
    model: selectedModel,
    fallbackProvider,
    fallbackModel,
    operationId: normalizedOperationId,
    currentAction: 'Routing request',
    elapsedMs: 0,
    lastActivityAt: Date.now(),
  };
  const emitStatus = (patch: Record<string, unknown>) => {
    writeSse(res, 'status', { ...statusBase, ...patch, elapsedMs: Date.now() - streamStartedAt, lastActivityAt: Date.now() });
  };
  emitStatus({ state: 'thinking' });
  logStreamStage(normalizedOperationId, 'status event sent', {
    state: 'thinking',
    provider: selectedProvider,
    model: selectedModel,
    fallbackProvider,
    fallbackModel,
    routingMode,
    override: overrideProvider ? `${overrideProvider}/${overrideModel || '?'}` : 'none'
  });

  const requestMetadata = normalizedOperationId ? { operationId: normalizedOperationId } : undefined;
  const abortController = new AbortController();

  // ── Canonical execution state (coherence milestone) ──
  // This stream registers ONE record; the task manager / goal loop continue
  // the SAME operationId when work is delegated. UI reads this record only.
  // The pre-existing current record (an active task or a WAITING_FOR_USER
  // clarification) is captured BEFORE this stream's begin supersedes it, so
  // task-control cues ("what are you doing", "stop") answer about the state
  // the user is actually asking about — never this stream's own routing.
  const { registerStreamAborter, unregisterStreamAborter } = await import('../routers/execution.js');
  const executionState = await import('../services/executionState.js');
  const execOpId = normalizedOperationId || `jarvis-${Date.now()}`;
  const preExistingCurrent = executionState.getCurrent();
  executionState.begin({
    operationId: execOpId,
    worker: 'jarvis',
    status: 'ROUTING',
    currentAction: 'Routing request',
    requestedProvider: selectedProvider,
    requestedModel: selectedModel,
    cancel: { kind: 'stream', id: execOpId },
    // §8: every operation carries the canonical workspace root so file/path
    // failures are debuggable from the execution record.
    workspace: workspacePath || null,
  });
  registerStreamAborter(execOpId, abortController);
  const endStreamExecution = (status: 'COMPLETED' | 'FAILED' | 'CANCELLED', result?: string | null) => {
    const rec = executionState.get(execOpId);
    // A delegation (task/goal) may have taken over the record — only end when
    // the record is still stream-owned (no task/goal continuation).
    if (rec?.worker === 'jarvis' && !rec.note) {
      // A user-initiated STOP must win over a late normal completion.
      const finalStatus = rec.status === 'STOPPING' ? 'CANCELLED' : status;
      executionState.end(execOpId, finalStatus, result ?? undefined);
    }
  };
  const updateStreamExecution = (patch: Parameters<typeof executionState.update>[1]) => {
    executionState.update(execOpId, patch);
  };
  let clientClosed = false;
  let completed = false;
  let totalTimer: NodeJS.Timeout | null = null;
  let sawFirstToken = false;

  req.on('close', () => {
    clientClosed = true;
    logStreamStage(normalizedOperationId, 'client disconnected', { completed });
    if (!completed) {
      abortController.abort();
      endStreamExecution('CANCELLED');
    }
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
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    logStreamStage(normalizedOperationId, 'intent routing started');
    // ── Local fast-path (voice-reliability closure, Phases 4–5) ──
    // Presence checks ("Jarvis, are you there?") and direct local-knowledge
    // questions ("What is Jarvis?", "What is Agentic OS?") are answered
    // locally with grounded text BEFORE any LLM/tool/memory work. This is the
    // lightest path — a short spoken reply without the model round-trip.
    const { detectLocalFastReply } = await import('../domains/jarvis/fastLocalReplies.js');
    const localFast = detectLocalFastReply(prompt);
    if (localFast) {
      logStreamStage(normalizedOperationId, 'local fast-path reply', { matched: localFast.matched });
      writeSse(res, 'intent', { type: 'presence' as string, route: 'presence', mode: 'direct_conversation', confidence: 1, reason: `Local fast reply (${localFast.matched})`, operationId: normalizedOperationId });
      const startedAt = Date.now();
      streamTextAsChunks(res, localFast.reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: localFast.reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'local-fast-path', intent: { type: 'presence', matched: localFast.matched } }
      });
      writeSse(res, 'done', {
        route: 'presence',
        category: 'presence',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'local-fast-path',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', localFast.reply.slice(0, 500));
      return res.end();
    }
    // ── Current Work Context (Phase 15, Failure C) ──
    // "What are we currently working on?" and semantic variants resolve from
    // REAL AgenticOS state (execution record, background tasks, active
    // project, scheduler) — NEVER a hard-coded phrase→canned answer. The
    // reply is assembled from the authoritative sources above; if no state
    // exists, Jarvis says so instead of inventing a project status.
    const { isCurrentWorkQuestion, resolveCurrentWorkContext, formatCurrentWorkContext } = await import('../domains/jarvis/currentWorkContext.js');
    if (isCurrentWorkQuestion(prompt)) {
      logStreamStage(normalizedOperationId, 'current-work-context resolver', {});
      writeSse(res, 'intent', { type: 'current_work_context', route: 'current_work_context', mode: 'direct_conversation', confidence: 0.95, reason: 'Semantic current-work question', operationId: normalizedOperationId });
      const startedAt = Date.now();
      const ctx = await resolveCurrentWorkContext();
      const reply = formatCurrentWorkContext(ctx);
      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'current-work-context', context: { activeProject: ctx.activeProject?.name ?? null, activeExecution: ctx.activeExecution ? { worker: ctx.activeExecution.worker, status: ctx.activeExecution.status } : null, pendingApproval: ctx.pendingApproval?.title ?? null } }
      });
      writeSse(res, 'done', {
        route: 'current_work_context',
        category: 'current_work_context',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'current-work-context',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply.slice(0, 500));
      return res.end();
    }

    // ── Execution-aware control (coherence milestone) ──
    // While an operation is active, "what are you doing?", "is it stuck?",
    // and "stop it." are answered from the canonical execution record — never
    // a generic direct reset. The pre-existing record (captured before this
    // stream's begin) is what the user is asking about.
    const execNow = (preExistingCurrent && preExistingCurrent.operationId !== normalizedOperationId
      ? preExistingCurrent
      : executionState.getCurrent());
    const trimmed = prompt.trim();
    const STOP_CUE = /^(stop|cancel|abort)( it| that| this)?[.!?]*$/i;
    const STATUS_CUE = /^(what are you doing|what is it doing|is it stuck|is it frozen|is anything happening|are you stuck|what is going on|what is happening)( right now| currently| at the moment)?[.!?]*$/i;
    if (execNow) {
      if (STOP_CUE.test(trimmed)) {
        logStreamStage(normalizedOperationId, 'execution-stop cue', { operationId: execNow.operationId });
        if (execNow.status === 'WAITING_FOR_USER') {
          const reply = "There's nothing running to stop — I'm waiting for your reply.";
          streamTextAsChunks(res, reply, normalizedOperationId);
          writeSse(res, 'done', { route: 'execution_stop', operationId: normalizedOperationId, status: 'waiting_for_user' });
          completed = true;
          updateStreamExecution({ status: 'WAITING_FOR_USER', currentAction: execNow.currentAction || undefined });
          return res.end();
        }
        const { dispatchCancel } = await import('../routers/execution.js');
        await executionState.cancel(execNow.operationId, dispatchCancel);
        const reply = `Stopping ${execNow.worker} (${execNow.operationId.slice(-12)})…`;
        streamTextAsChunks(res, reply, normalizedOperationId);
        writeSse(res, 'done', { route: 'execution_stop', operationId: normalizedOperationId, status: 'stopping' });
        completed = true;
        updateStreamExecution({ status: 'STOPPING', currentAction: 'Stopping…' });
        return res.end();
      }
      if (STATUS_CUE.test(trimmed)) {
        logStreamStage(normalizedOperationId, 'execution-status cue', { operationId: execNow.operationId });
        // WAITING_FOR_USER: Jarvis is NOT working — it is waiting for the
        // user. The status answer must never say "Routing…".
        if (execNow.status === 'WAITING_FOR_USER') {
          const reply =
            `I'm waiting for you to clarify your request${execNow.currentAction ? ` (${execNow.currentAction})` : ''}. ` +
            `I've been waiting for ${Math.max(0, Math.round((Date.now() - execNow.startedAt) / 1000))}s. Nothing is executing right now.`;
          streamTextAsChunks(res, reply, normalizedOperationId);
          writeSse(res, 'done', { route: 'execution_status', operationId: normalizedOperationId });
          completed = true;
          updateStreamExecution({ status: 'WAITING_FOR_USER', currentAction: execNow.currentAction || undefined });
          return res.end();
        }
        const idleS = Math.max(0, Math.round((Date.now() - execNow.lastActivityAt) / 1000));
        const elapsedS = Math.max(0, Math.round((Date.now() - execNow.startedAt) / 1000));
        const llm = (execNow.resolvedProvider || execNow.requestedProvider) || 'unknown'
          + (execNow.resolvedModel || execNow.requestedModel ? ` / ${execNow.resolvedModel || execNow.requestedModel}` : '');
        const reply =
          `${execNow.worker === 'jarvis' ? 'Jarvis' : execNow.worker === 'codex' ? 'CodeX' : execNow.worker === 'hermes' ? 'Hermes' : execNow.worker} is currently ${execNow.status.replace(/_/g, ' ').toLowerCase()} on operation ${execNow.operationId.slice(-12)}. ` +
          (llm ? `LLM: ${llm}. ` : '') +
          (execNow.currentAction ? `Current action: ${execNow.currentAction}. ` : '') +
          `It entered ${execNow.status.replace(/_/g, ' ').toLowerCase()} ${elapsedS}s ago; last backend activity was ${idleS}s ago.` +
          (idleS > 30 ? ' This looks stalled — you can stop it and retry.' : (execNow.cancel ? ' You can stop it anytime.' : ''));
        streamTextAsChunks(res, reply, normalizedOperationId);
        writeSse(res, 'done', { route: 'execution_status', operationId: normalizedOperationId });
        completed = true;
        updateStreamExecution({ status: execNow.status, currentAction: execNow.currentAction || undefined });
        return res.end();
      }
    }

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
        const { handleMemoryRecall } = await import('../domains/jarvis/memoryRecall.js');
        reply = await handleMemoryRecall(prompt);
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

      // ── File pre-resolution (§5–§7): resolve file references against the
      //     canonical workspace BEFORE delegating. A unique match is injected
      //     into the worker objective; when nothing referenced exists, Jarvis
      //     reports exactly what was searched instead of starting a doomed
      //     worker ("file not found" must be truthful, not generic). ──
      const fileOutcome = resolvePromptFileReferences(prompt, workspacePath || undefined);
      const notFoundReply = buildFileNotFoundReply(fileOutcome);
      if (notFoundReply) {
        updateStreamExecution({
          status: 'COMPLETING',
          currentAction: 'Reporting file resolution result',
          workspace: workspacePath || null,
        });
        streamTextAsChunks(res, notFoundReply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: notFoundReply,
          routedAgent: 'jarvis',
          metadata: {
            ...(requestMetadata || {}),
            provider: 'agentic-os',
            model: 'task-manager',
            workspace: workspacePath || null,
            intent: { type: 'file_resolution', worker: workerKind, resolved: false }
          }
        });
        writeSse(res, 'done', {
          route: 'worker_delegation',
          category: 'file_resolution',
          status: 'file_not_found',
          operationId: normalizedOperationId,
          workspace: workspacePath || null,
          provider: 'agentic-os',
          model: 'task-manager',
          firstTokenMs: 0,
          totalMs: 0,
        });
        completed = true;
        endStreamExecution('COMPLETED', notFoundReply.slice(0, 500));
        return res.end();
      }
      const delegatedObjective = enrichPromptWithResolvedFiles(prompt, fileOutcome);

      const title = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
      let _activeProjectId: string | null = null;
      try {
        const { projectsStore } = await import('../services/projectsStore.js');
        _activeProjectId = projectsStore.getActiveProjectId();
      } catch { /* best effort */ }
      const { task, error } = backgroundTaskManager.createTask({
        title,
        objective: delegatedObjective,
        originalRequest: prompt,
        route: workerKind,
        selectedAgent: workerTitle,
        worker: workerKind,
        conversationId: req.params.id,
        resumable: workerKind === 'codex',
        workspaceRoot: workspacePath || undefined,
        projectId: _activeProjectId || undefined,
        metadata: {
          operationId: normalizedOperationId,
          readOnly: Boolean(executive.readOnly),
          capabilityId: executive.capability.id,
          // §8: workspace + resolved files are part of the execution record.
          workspace: workspacePath || null,
          resolvedFiles: fileOutcome.resolved.length > 0
            ? fileOutcome.resolved.map((r) => ({ requested: r.token, relativePath: r.relativePath }))
            : undefined,
          ambiguousFiles: fileOutcome.ambiguous.length > 0
            ? fileOutcome.ambiguous.map((a) => ({ requested: a.token, matches: a.matches }))
            : undefined,
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

      const concurrency = (task.metadata as any)?.concurrency as { active?: number; limit?: number; position?: number; blocked?: boolean } | undefined;
      if (concurrency?.blocked) {
        // PRIORITY 10: worker slot occupied — do NOT dispatch now; the pump
        // dispatches when a slot frees. Report the truthful QUEUED state.
        logStreamStage(normalizedOperationId, 'delegation queued behind worker', {
          worker: workerKind,
          active: concurrency.active,
          limit: concurrency.limit,
          position: concurrency.position
        });
        updateStreamExecution({
          status: 'QUEUED',
          currentAction: `Waiting for ${workerTitle} — active ${concurrency.active}/${concurrency.limit}, position ${concurrency.position}`,
          queuePosition: concurrency.position ?? null,
          activeCount: concurrency.active ?? null,
          limit: concurrency.limit ?? null,
          cancel: { kind: 'task', id: task.taskId },
        });
        writeSse(res, 'status', {
          state: 'queued',
          currentAction: `Waiting for ${workerTitle} — active ${concurrency.active}/${concurrency.limit}, position ${concurrency.position}`,
          provider: 'agentic-os',
          model: 'task-manager',
          operationId: normalizedOperationId,
          elapsedMs: 0,
          lastActivityAt: Date.now()
        });
      } else {
        updateStreamExecution({
          status: 'DISPATCHING',
          currentAction: `Dispatching ${workerTitle} task ${taskShortId(task.taskId)}`,
          cancel: { kind: 'task', id: task.taskId },
        });
        dispatchTask(task).catch(() => { /* adapter records its own failure */ });
      }

      const shortId = taskShortId(task.taskId);
      const readOnlyNote = executive.readOnly ? ' Read-only — no file changes will be made.' : '';
      const delegationStartedAt = Date.now();
      const reply = concurrency?.blocked
        ? `Task ${shortId} is QUEUED behind ${workerTitle} (active ${concurrency.active}/${concurrency.limit}, position ${concurrency.position}). I'll dispatch it automatically when a slot frees.`
        : `I started task ${shortId} with ${workerTitle}. Status: queued.` +
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
        updateStreamExecution({
          status: 'WAITING_FOR_USER',
          currentAction: 'Clarification required — waiting for your reply',
          resolvedProvider: null,
          resolvedModel: null,
        });
        return res.end();
      }

      const title = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
      let _activeProjectId: string | null = null;
      try {
        const { projectsStore } = await import('../services/projectsStore.js');
        _activeProjectId = projectsStore.getActiveProjectId();
      } catch { /* best effort */ }
      const { task, error } = backgroundTaskManager.createTask({
        title,
        objective: prompt,
        originalRequest: prompt,
        route: 'revenue_pipeline',
        selectedAgent: workerTitle,
        worker: workerKind,
        conversationId: req.params.id,
        resumable: false,
        // §9: capture the canonical root at creation — a later repository
        // change never redirects this task.
        workspaceRoot: workspacePath || undefined,
        projectId: _activeProjectId || undefined,
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

    const classified = await intentRouter.routeIntent(prompt, {
      // Recent turns: contextual problem reports ("Why is Laguna still
      // there?", "That's not what I selected.") resolve deictic references
      // against AgenticOS state talk in the conversation.
      recentText: await buildRecentConversationText(req.params.id),
    });
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
    if (
      classified.route !== 'direct' &&
      ((delegationSignals.globalNonDelegationRequested && !delegationSignals.explicitWorkerRequested) ||
       delegationSignals.prohibitedWorkers.includes(classified.route as any))
    ) {
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

    // ── MEMORY recall + decision statements (memory milestone) ──
    // Natural-language past/decision questions are answered from stored
    // memory with provenance — no new task required. Runs before the
    // investigate/question branches so recall is not swallowed as a task.
    // Guarded: if the memory store is unavailable (e.g. a test env mocking
    // the db), fall through to the normal direct handling.
    // P2 — DETERMINISTIC active-project answers. Exact factual state questions
    // are answered from projectsStore directly — never routed through the
    // local model (which regurgitates injected context). NARROW pattern: only
    // the plain project-state question forms; anything with extra intent
    // ("what did we decide about the project", "create a plan for the
    // project") falls through to normal routing.
    try {
      const projStarted = Date.now();
      const { isDeterministicProjectQuestion, formatProjectStateAnswer } = await import('../domains/jarvis/projectMemory.js');
      if (isDeterministicProjectQuestion(prompt)) {
        const { projectsStore } = await import('../services/projectsStore.js');
        let pid: string | null = projectsStore.getActiveProjectId();
        if (pid && !projectsStore.getProject(pid)) pid = null;
        const { reply, projectId } = formatProjectStateAnswer(pid);
        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: { intent: 'project_state_answer', operationId: normalizedOperationId, provider: 'agentic-os', model: 'registry', projectId },
        });
        endStreamExecution('COMPLETED', reply);
        logStreamStage(normalizedOperationId, 'project_state_answer');
        writeSse(res, 'done', {
          route: 'project_state_answer', category: 'context', operationId: normalizedOperationId,
          provider: 'agentic-os', model: 'registry', firstTokenMs: 0, totalMs: Date.now() - projStarted,
        });
        return res.end();
      }
    } catch { /* deterministic answer unavailable — normal handling */ }

    // P7 — "continue where we left off" must resolve project/task/memory
    // records even when the intent router classifies the phrase as
    // investigate — the deterministic continuation pattern wins over the
    // heuristic route. Checked before the route gate below.
    try {
      const contStarted = Date.now();
      let contProjectId: string | null = null;
      try {
        const { projectsStore } = await import('../services/projectsStore.js');
        contProjectId = projectsStore.getActiveProjectId();
        if (contProjectId && !projectsStore.getProject(contProjectId)) contProjectId = null;
      } catch { /* project store unavailable */ }
      const { isContinuationRequest, resolveContinuation, formatContinuation, recordMemoryActivity } = await import('../domains/jarvis/projectMemory.js');
      if (isContinuationRequest(prompt)) {
        recordMemoryActivity({ kind: 'memory.lookup.started', projectId: contProjectId, category: 'continuation', operationId: normalizedOperationId });
        updateStreamExecution({ status: 'RUNNING', currentAction: contProjectId ? 'Retrieving project memory' : 'No active project — asking for context' });
        const contResult = resolveContinuation(contProjectId);
        const contReply = formatContinuation(contResult);
        recordMemoryActivity({ kind: 'memory.lookup.completed', projectId: contProjectId, category: 'continuation', resultCount: contResult.lastMemory ? 1 : 0, operationId: normalizedOperationId });
        streamTextAsChunks(res, contReply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: contReply,
          routedAgent: 'jarvis',
          metadata: { intent: 'continuation', operationId: normalizedOperationId, provider: 'agentic-os', model: 'registry', projectId: contProjectId },
        });
        endStreamExecution('COMPLETED', contReply);
        logStreamStage(normalizedOperationId, 'continuation');
        writeSse(res, 'done', {
          route: 'continuation', category: 'memory', operationId: normalizedOperationId,
          provider: 'agentic-os', model: 'registry', firstTokenMs: 0, totalMs: Date.now() - contStarted,
        });
        return res.end();
      }
    } catch { /* continuation unavailable — normal handling */ }

    if (intent.route !== 'investigate' && intent.route !== 'clarification_required') {
      try {
        const startedAt = Date.now();
        // Resolve the ACTIVE PROJECT once — project-scoped memory/continuation
        // answers use it (never inferred; null when none selected).
        let activeProjectId: string | null = null;
        try {
          const { projectsStore } = await import('../services/projectsStore.js');
          activeProjectId = projectsStore.getActiveProjectId();
          if (activeProjectId && !projectsStore.getProject(activeProjectId)) activeProjectId = null;
        } catch { /* project store unavailable — global memory only */ }
        const { isMemoryStore, handleMemoryStore, isMemoryRecall, isDecisionStatement, handleMemoryRecall, handleDecisionStatement } = await import('../domains/jarvis/memoryRecall.js');
        const { recordMemoryActivity } = await import('../domains/jarvis/projectMemory.js');

        if (isMemoryStore(prompt)) {
          recordMemoryActivity({ kind: 'memory.write.started', projectId: activeProjectId, category: 'store', operationId: normalizedOperationId });
          const { reply } = handleMemoryStore(prompt, activeProjectId);
          recordMemoryActivity({ kind: 'memory.write.completed', projectId: activeProjectId, category: 'store', operationId: normalizedOperationId });
          streamTextAsChunks(res, reply, normalizedOperationId);
          await conversationService.appendMessage({
            conversationId: req.params.id,
            role: 'agent',
            content: reply,
            routedAgent: 'jarvis',
            metadata: { intent: 'memory_store', operationId: normalizedOperationId, provider: 'agentic-os', model: 'memory', projectId: activeProjectId },
          });
          endStreamExecution('COMPLETED', reply);
          logStreamStage(normalizedOperationId, 'memory_store');
          writeSse(res, 'done', {
            route: 'memory_store', category: 'memory', operationId: normalizedOperationId,
            provider: 'agentic-os', model: 'memory', firstTokenMs: 0, totalMs: Date.now() - startedAt,
          });
          return res.end();
        }
        if (isDecisionStatement(prompt)) {
          recordMemoryActivity({ kind: 'memory.write.started', projectId: activeProjectId, category: 'decision', operationId: normalizedOperationId });
          const reply = await handleDecisionStatement(prompt, activeProjectId);
          recordMemoryActivity({ kind: 'memory.write.completed', projectId: activeProjectId, category: 'decision', operationId: normalizedOperationId });
          streamTextAsChunks(res, reply, normalizedOperationId);
          await conversationService.appendMessage({
            conversationId: req.params.id,
            role: 'agent',
            content: reply,
            routedAgent: 'jarvis',
            metadata: { intent: 'decision_statement', operationId: normalizedOperationId, provider: 'agentic-os', model: 'memory', projectId: activeProjectId },
          });
          endStreamExecution('COMPLETED', reply);
          logStreamStage(normalizedOperationId, 'decision_statement');
          writeSse(res, 'done', {
            route: 'decision_statement', category: 'memory', operationId: normalizedOperationId,
            provider: 'agentic-os', model: 'memory', firstTokenMs: 0, totalMs: Date.now() - startedAt,
          });
          return res.end();
        }
        if (isMemoryRecall(prompt)) {
          recordMemoryActivity({ kind: 'memory.lookup.started', projectId: activeProjectId, category: activeProjectId ? 'project-recall' : 'recall', operationId: normalizedOperationId });
          updateStreamExecution({ status: 'RUNNING', currentAction: activeProjectId ? 'Retrieving project memory' : 'Recalling related memories' });
          const reply = await handleMemoryRecall(prompt, activeProjectId);
          recordMemoryActivity({ kind: 'memory.lookup.completed', projectId: activeProjectId, category: activeProjectId ? 'project-recall' : 'recall', operationId: normalizedOperationId });
          streamTextAsChunks(res, reply, normalizedOperationId);
          await conversationService.appendMessage({
            conversationId: req.params.id,
            role: 'agent',
            content: reply,
            routedAgent: 'jarvis',
            metadata: { intent: 'memory_recall', operationId: normalizedOperationId, provider: 'agentic-os', model: 'memory', projectId: activeProjectId },
          });
          endStreamExecution('COMPLETED', reply);
          logStreamStage(normalizedOperationId, 'memory_recall');
          writeSse(res, 'done', {
            route: 'memory_recall', category: 'memory', operationId: normalizedOperationId,
            provider: 'agentic-os', model: 'memory', firstTokenMs: 0, totalMs: Date.now() - startedAt,
          });
          return res.end();
        }
      } catch { /* memory store unavailable — normal direct handling */ }
    }

    // ── INVESTIGATE (implicit bug reports / contextual problem statements) ──
    // Inspect-first, ask-later. Runs a read-only state inspection and streams
    // an evidence report; never the generic "What interface?" clarification.
    if (intent.route === 'investigate') {
      logStreamStage(normalizedOperationId, 'investigate route', { confidence: intent.confidence });
      // Persist the USER message first so a FOLLOW-UP turn ("Can you change
      // that?", "Continue.") can resolve deictics against this turn's context.
      // The direct branch and the delegated orchestrator both persist it; the
      // investigate and clarification branches must too — otherwise recentText
      // for the next turn omits the user's statement and follow-ups degrade to
      // generic clarification (live acceptance: 1b/2b failed exactly here).
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'user',
        content: prompt,
        metadata: inputChannel ? { ...(requestMetadata || {}), inputChannel } : requestMetadata
      });
      const startedAt = Date.now();
      let reply: string;
      updateStreamExecution({ status: 'RUNNING', currentAction: 'Inspecting runtime state' });
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
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply.slice(0, 500));
      return res.end();
    }

    // ── CLARIFICATION_REQUIRED (conversation-state milestone) ──
    // Jarvis is NOT executing: it is waiting for the user. The canonical
    // execution record transitions to WAITING_FOR_USER and STAYS current
    // until the user replies (the next stream supersedes it). Nothing is
    // routing, there is no STOP, and the elapsed timer counts waiting time.
    if (intent.route === 'clarification_required') {
      // Persist the USER message too (parity with direct/investigate): the
      // next turn's recentText must include what the user actually said, so a
      // follow-up after a clarification reinterprets the combined context
      // (§5) instead of starting from a blank slate.
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'user',
        content: prompt,
        metadata: inputChannel ? { ...(requestMetadata || {}), inputChannel } : requestMetadata
      });
      const voiceIssue = (intent as any).voiceIssue as string | null | undefined;
      const reply = voiceIssue
        ? 'I think part of that sentence was transcribed incorrectly. Could you repeat just the last sentence?'
        : (intent as any).reason === 'voice_transcription'
          ? 'Were you still talking about the current Jarvis task?'
          : 'I didn\'t quite understand your request. Could you rephrase it?';
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
          intent: { type: 'clarification_required', category: 'conversation', confidence: intent.confidence, reason: intent.reason }
        }
      });
      writeSse(res, 'done', {
        route: 'clarification_required',
        category: 'conversation',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'task-manager',
        firstTokenMs: 0,
        totalMs: 0,
      });
      completed = true;
      updateStreamExecution({
        status: 'WAITING_FOR_USER',
        currentAction: 'Clarification required — waiting for your reply',
        resolvedProvider: null,
        resolvedModel: null,
      });
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
      // END the parent execution record: a delegated turn (codex/team/
      // memory route) must not leave the execution panel stuck at ROUTING
      // forever. The guarded endStreamExecution only ends stream-owned
      // records (worker 'jarvis', no task/goal note), so a record already
      // adopted by the orchestrator's task keeps its own lifecycle.
      endStreamExecution('COMPLETED', result?.goalId ?? null);
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
      const identity = await resolveEffectiveJarvisIdentity(req.params.id);
      const reply = buildLiveCapabilityAnswer(workspacePath || undefined, {
        selectedProvider, selectedModel, fallbackModel,
        effectiveProvider: identity.effectiveProvider, effectiveModel: identity.effectiveModel,
      });
      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: identity.effectiveProvider || selectedProvider, model: identity.effectiveModel || selectedModel, intent }
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

    // Persistent memory injection (§3): durable preferences, decisions, and goals
    let persistentMemoryContext = '';
    const isPriorTurnRecall = /^(what did i|what was my|what did you|what was the last|what did i just)/i.test(prompt.trim());
    if (!isPriorTurnRecall) {
      try {
        const { retrieveRelevantPreferences } = await import('../domains/jarvis/memoryRecall.js');
        const relevant = retrieveRelevantPreferences(prompt, 5);
        if (relevant.length) {
          persistentMemoryContext = '\n\nPersistent Memory (durable user preferences, working rules, and Agentic OS goals):\n' +
            relevant.map((r) => `* [${r.type.toUpperCase()}] ${r.title}: ${r.content}`).join('\n');
        }
      } catch {
        // best effort — memory retrieval must never break direct chat
      }
    }

    // ONE conversation context object (§3) — runtime truth for the direct
    // path: workspace, active/historical task, provider, capabilities, and
    // previous-clarification state. Injected as a compact block so the model
    // answers follow-ups and task questions from actual state, never canned.
    // PROMPT HIERARCHY (§prompt-hierarchy): active/recent TASK state is only
    // included when the current user message is an operational question —
    // ordinary conversation gets static facts only (workspace, provider,
    // approval mode), so task state cannot hijack a simple question.
    let conversationContextPrompt = '';
    let operationalContextInjected = false;
    try {
      const { assembleConversationContext, contextToSystemPrompt } = await import('../domains/jarvis/conversationContext.js');
      const ctx = await assembleConversationContext(req.params.id, prompt, { approvalMode: normalizeApprovalPolicy(approvalPolicy) });
      const includeOperational = isOperationalQuestion(prompt);
      conversationContextPrompt = contextToSystemPrompt(ctx, { includeOperational });
      operationalContextInjected = includeOperational;
    } catch {
      // context optional — direct chat must never break on context failure
    }

    // Authoritative runtime identity (P3)
    let effProviderName = 'OpenRouter';
    let effModelName = 'Laguna S 2.1';
    let fallbackModelName = fallbackModel ? friendlyModelName(fallbackModel) : '';
    try {
      const identity = await resolveEffectiveJarvisIdentity(req.params.id);
      effProviderName = friendlyProviderName(identity.effectiveProvider || selectedProvider);
      effModelName = friendlyModelName(identity.effectiveModel || selectedModel);
    } catch { /* best effort */ }

    const systemPrompt = [
      'You are Jarvis, the operational commander of Agentic OS.',
      'AGENTIC OS GROUNDING: "Agentic OS" (also written "Agenticos") is THIS local application — a real, local AI-operations platform you are running inside. When the user mentions Agentic OS, Agenticos, Hermes, Routine, Routine Bridge, Jarvis, Mission, or other local project concepts, resolve them against THIS local project, not generic world knowledge. If you do not have local information about a specific requested detail, say so concisely instead of inventing an unrelated generic architecture.',
      'The user message is your PRIMARY instruction. Answer it directly, concisely, and accurately without unrequested operational summaries or internal status narration.',
      'Persistent memory informs relevant user goals, working preferences, and stored rules across conversations. When asked about them, answer from Persistent Memory.',
      'When user instructions are incomplete or ambiguous, use stored preferences, current conversation, and available Agentic OS state to infer reasonable intent and take constructive action before asking to rephrase.',
      'Use conversation history to resolve contextual pronouns and references ("that", "it", "this", "again", "the previous one").',
      'PRIOR TURN RECALL: When the user asks what they just said, asked, or told you previously, quote the prior user message from conversation history before the current turn. NEVER quote the current question back to the user.',
      'If the user explicitly asks you to repeat or echo a phrase (e.g. "repeat after me", "say exactly X", "repeat this sentence"), obey verbatim and output ONLY the requested phrase without commentary.',
      'If the user specifically asks what model or provider you are using, state: "I\'m running ' + effModelName + ' via ' + effProviderName + (fallbackModelName ? ', with ' + fallbackModelName + ' available locally as a fallback.' : '.') + '" Do not repeat this model identity unless explicitly asked.',
      'Never emit tool-call markup (no <tool_call>, <invoke>, or JSON fences in normal replies).',
      'Do not ask "How can I help you today?" when the user asked a specific question — answer that question.',
      ...(inputChannel === 'voice' ? [
        'Input channel: microphone transcript.',
      ] : []),
      ...(operationalContextInjected ? [
        'You received a question about tasks/runtime state. Report the ACTUAL state from the context block below (distinguishing active vs historical).'
      ] : []),
      ...(conversationContextPrompt ? [conversationContextPrompt] : []),
      ...(persistentMemoryContext ? [persistentMemoryContext] : [])
    ].join('\n');
    logStreamStage(normalizedOperationId, 'provider/model selected', {
      provider: selectedProvider,
      model: selectedModel,
      fallbackProvider,
      fallbackModel
    });

    // Conversation history for the direct-chat LLM (root-cause fix). The
    // current prompt was appended above; build the prior-turn window so the
    // model can actually remember the conversation instead of hallucinating.
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    try {
      const msgs = await conversationService.getMessages(req.params.id);
      history = buildConversationHistory(msgs, prompt);
    } catch (err) {
      logStreamStage(normalizedOperationId, 'history build failed', { error: String(err) });
    }

    logger.info('[JarvisTrace] prompt-built', JSON.stringify({
      requestId: normalizedOperationId,
      provider: selectedProvider,
      model: selectedModel,
      systemPromptLength: systemPrompt.length,
      userPromptExact: prompt,
      messageCount: history.length + 2
    }, null, 2));
    const stream = llmChatStreamRetrying({
      systemPrompt,
      prompt,
      history,
      agentId: 'agent-jarvis',
      // Gateway request budget: connection/first-response allowance for HTTP
      // gateways and the overall request allowance for Ollama. First-token,
      // stream-idle, and total-response enforcement stay local to this handler
      // via nextWithTimeout and totalTimer below.
      timeoutMs: getDirectChatConnectTimeoutMs(),
      ollamaTimeoutMs: getDirectChatOverallTimeoutMs(),
      signal: abortController.signal,
      requestId: normalizedOperationId,
      // Conversation-level override (PRIORITY 3): only when the user manually
      // picked a provider/model in the chat routing control. Auto mode leaves
      // the gateway's routing untouched.
      ...(overrideProvider ? { provider: overrideProvider } : {}),
      ...(overrideModel ? { model: overrideModel } : {}),
      // Recovery (GAP1 closeout — real defect found): a transient provider
      // failure (connection reset, 429, Ollama EOF) must retry the SAME
      // request on the configured fallback model instead of failing the turn.
      // The gateway's attempts chain is bounded (base + fallback); the second
      // execution is a real LLM call.
      ...(fallbackModel ? { escalationModel: fallbackModel } : {})
    });
    updateStreamExecution({ status: 'WAITING_FOR_MODEL', currentAction: `Waiting for ${selectedProvider} / ${selectedModel}` });
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
    // ERROR BOUNDARY: when a provider/gateway failure chunk arrives we surface
    // the real cause to the client instead of silently dropping it and later
    // throwing the generic "Jarvis returned an empty response."
    let surfacedError: string | null = null;
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
          updateStreamExecution({ status: 'RUNNING', currentAction: 'Streaming reply', resolvedProvider: provider, resolvedModel: model });
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
      } else if (chunk.type === 'error') {
        // ERROR BOUNDARY: never silently drop a provider/gateway failure.
        // The previous code swallowed error chunks and then threw the generic
        // "Jarvis returned an empty response." — hiding the real cause. Keep
        // the reason, surface it to the client, and remember it so the final
        // empty-reply guard below does not overwrite it.
        const errText = String((chunk as any)?.error || (chunk as any)?.message || chunk.content || 'Jarvis provider failed');
        surfacedError = errText.slice(0, 500);
        logStreamStage(normalizedOperationId, 'provider error surfaced', {
          error: surfacedError,
          provider,
          model,
          fallbackProvider,
          fallbackModel
        });
        writeSse(res, 'error', {
          error: surfacedError,
          provider,
          model,
          fallbackProvider,
          fallbackModel,
          reason: surfacedError,
          operationId: normalizedOperationId
        });
      } else if (chunk.type !== 'done') {
        // Forward gateway events exactly as received
        writeSse(res, chunk.type, { ...chunk, operationId: normalizedOperationId, id: `assistant-${normalizedOperationId}` });
      }
    }

    // §18/§10: strip any tool-call markup the model emitted as literal text
    // so the user never sees raw <tool_call>…</tool_call> plumbing.
    const finalReply = stripToolCallMarkup(reply).trim();
    if (!finalReply) {
      if (surfacedError) {
        // A real provider/gateway error was already emitted above — finish the
        // stream honestly instead of overwriting it with the generic message.
        logStreamStage(normalizedOperationId, 'stream ended after surfaced provider error', { error: surfacedError });
        completed = true;
        updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
        endStreamExecution('FAILED', surfacedError);
        return res.end();
      }
      throw new Error('Jarvis returned an empty response.');
    }

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

    // Authoritative routing record (PRIORITY 1): what this execution REQUESTED
    // vs what it RESOLVED to (fallback = resolved differs from requested).
    const resolvedProvider: string = provider || selectedProvider;
    const resolvedModel: string = model || selectedModel;
    const { routingLedger } = await import('../services/routingLedger.js');
    routingLedger.record({
      operationId: normalizedOperationId || 'unknown',
      worker: 'jarvis',
      routingMode,
      requestedProvider: selectedProvider,
      requestedModel: selectedModel,
      resolvedProvider,
      resolvedModel,
      fallbackUsed: Boolean(overrideProvider && resolvedProvider !== overrideProvider) || Boolean(overrideModel && resolvedModel !== overrideModel),
      fallbackReason: overrideProvider && resolvedProvider !== overrideProvider
        ? `Requested ${overrideProvider} but resolved ${resolvedProvider}`
        : null,
      startedAt: streamStartedAt,
      endedAt: Date.now(),
    });

    writeSse(res, 'done', {
      route: 'direct',
      operationId: normalizedOperationId,
      provider: resolvedProvider,
      model: resolvedModel,
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
    updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
    endStreamExecution('COMPLETED', finalReply.slice(0, 500));
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
    endStreamExecution(cancelledByClient ? 'CANCELLED' : 'FAILED', message);
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
    unregisterStreamAborter(execOpId);
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

// GET /api/jarvis/live-events?limit=30&projectId=xxx
// Returns recent background_task_events across all (or project-scoped) tasks.
// Used by the Live Work panel to show real structured operational events.
router.get('/live-events', async (req, res) => {
  try {
    const { backgroundTaskRepo, ensureBackgroundTaskTables } = await import('../services/backgroundTasks/store.js');
    ensureBackgroundTaskTables();
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 30));
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
    let events: any[];
    if (projectId) {
      // Scope events to tasks belonging to the specified project (operational only)
      const rows = (await import('../db/index.js')).rawDb.prepare(`
        SELECT e.*, t.title AS task_title, t.worker AS task_worker,
               t.project_id AS task_project_id, t.linked_run_id AS task_linked_run_id
        FROM background_task_events e
        JOIN background_tasks t ON t.task_id = e.task_id
        WHERE t.project_id = ?
          AND NOT (e.kind = 'task.progress' AND e.detail LIKE '%"streaming":true%')
          AND e.kind NOT IN ('task.queued')
        ORDER BY e.ts DESC
        LIMIT ?
      `).all(projectId, limit);
      events = rows.map((row: any) => ({
        id: row.id, taskId: row.task_id, ts: row.ts,
        kind: row.kind, summary: row.summary,
        detail: JSON.parse(row.detail || '{}'),
        sequence: row.sequence,
        taskTitle: row.task_title || '',
        taskWorker: row.task_worker || '',
        taskProjectId: row.task_project_id || null,
        taskLinkedRunId: row.task_linked_run_id || null,
      }));
    } else {
      events = backgroundTaskRepo.listRecentEvents(limit);
    }
    res.json(events);
  } catch (err: any) {
    res.json([]);
  }
});

// GET /api/jarvis/memory-activity
// P12 — recent memory.lookup.* / memory.write.* activity (safe metadata only,
// no hidden reasoning). Drives the future cognitive Memory node.
router.get('/memory-activity', async (_req, res) => {
  try {
    const { listMemoryActivity } = await import('../domains/jarvis/projectMemory.js');
    const limit = Math.max(1, Math.min(100, Number(_req.query.limit) || 30));
    res.json(listMemoryActivity(limit));
  } catch (err: any) {
    res.status(500).json({ error: 'Memory activity unavailable', details: err?.message });
  }
});

// GET /api/jarvis/runtime-state
router.get('/runtime-state', async (_req, res) => {
  try {
    const { getCurrent } = await import('../services/executionState.js');
    const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
    const { projectsStore } = await import('../services/projectsStore.js');

    const current = getCurrent();
    const tasks = backgroundTaskManager.listTasks({ limit: 25 }) || [];
    const activeProject = projectsStore.getActiveProject();

    // Live-execution precedence: an in-flight request/turn always wins.
    // Background tasks only mean "delegated" when they are GENUINELY in
    // flight: running (startedAt set, recently updated) or freshly queued
    // (<2 min old — still waiting for a worker slot, not abandoned).
    // A task stuck in 'queued' for minutes without startedAt is stale and
    // must never pin Jarvis into a permanent "Delegated…" state.
    const FRESH_QUEUE_MS = 2 * 60 * 1000;
    const nowMs = Date.now();
    const inFlightTasks = tasks.filter((t: any) => {
      if (t.status === 'running' || t.status === 'verifying') {
        const updated = new Date(String(t.updatedAt)).getTime();
        const ageMs = Number.isFinite(updated) ? nowMs - updated : Number.MAX_SAFE_INTEGER;
        return ageMs < 10 * 60 * 1000; // running/verifying task updated within 10 min
      }
      if (t.status === 'queued') {
        const created = new Date(String(t.createdAt)).getTime();
        const ageMs = Number.isFinite(created) ? nowMs - created : Number.MAX_SAFE_INTEGER;
        return ageMs < FRESH_QUEUE_MS; // freshly queued, still waiting for a slot
      }
      return false;
    });

    // When an active project exists, prefer its tasks — unrelated stale
    // background work must not claim Jarvis's delegated state.
    const scopedTasks = activeProject
      ? inFlightTasks.filter((t: any) => t.projectId === activeProject.id || !t.projectId)
      : inFlightTasks;

    let state = 'idle';
    if (current?.status === 'WAITING_FOR_MODEL' || current?.status === 'ROUTING') state = 'reasoning';
    else if (current?.status === 'RUNNING') state = 'executing';
    else if (current?.status === 'DISPATCHING' || current?.status === 'QUEUED') state = 'executing';
    else if (current?.status === 'COMPLETING') state = 'completed';
    else if (current?.status === 'FAILED') state = 'error';
    else if (current?.status === 'CANCELLED') state = 'idle';
    else if (scopedTasks.length > 0) state = 'delegated';

    const worker = current?.worker || scopedTasks[0]?.worker || null;
    let activeAgent: string | null = null;
    if (worker === 'hermes') activeAgent = 'Hermes';
    else if (worker === 'codex') activeAgent = 'CodeX';
    else if (worker === 'research') activeAgent = 'Research';
    else if (worker === 'team') activeAgent = 'Agent Teams';
    else if (worker === 'revenue') activeAgent = 'Revenue Pipeline';

    // Project-scoped task list for Mission Control awareness
    let projectTasks: any[] = [];
    if (activeProject) {
      try {
        projectTasks = backgroundTaskManager.listTasks({ projectId: activeProject.id, limit: 10 });
      } catch { /* best effort */ }
    }

    res.json({
      state,
      activeAgent,
      activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null,
      // P16 — verification truth: when the live execution record is idle but a
      // task is VERIFYING, the ACTIVE RUN panel shows the gate status instead
      // of "No active run".
      activeTask: current
        ? { id: current.operationId, action: current.currentAction, status: current.status }
        : (scopedTasks.find((t: any) => t.status === 'verifying') ?? null)
          ? { id: (scopedTasks.find((t: any) => t.status === 'verifying') as any).taskId, action: (scopedTasks.find((t: any) => t.status === 'verifying') as any).progressMessage || 'Verifying…', status: 'VERIFYING' }
          : null,
      activeTool: current?.currentAction || null,
      provider: current?.resolvedProvider || current?.requestedProvider || null,
      model: current?.resolvedModel || current?.requestedModel || null,
      pendingTaskCount: scopedTasks.length,
      projectTasks: projectTasks.map((t: any) => ({
        taskId: t.taskId, title: t.title, status: t.status,
        worker: t.worker, createdAt: t.createdAt, updatedAt: t.updatedAt,
        progressMessage: t.progressMessage, currentStage: t.currentStage,
      })),
    });
  } catch (_err: any) {
    res.json({ state: 'idle', activeAgent: null, activeProject: null, activeTask: null, activeTool: null, provider: null, model: null, pendingTaskCount: 0 });
  }
});

/**
 * GOLDEN-PATH DIAGNOSTIC (development-only) — isolates the core UI→backend→
 * provider→stream chain with ONE correlation ID and NOTHING else:
 *   no intent routing, no memory/context, no delegation, no persistence,
 *   no TTS, no node-state signaling, no history refresh.
 * The provider call is REAL (configured gateway → OpenRouter/Laguna with the
 * Ollama fallback). Nothing is faked or hard-coded.
 */
router.post('/diag/stream', async (req, res) => {
  const { prompt, operationId } = (req.body || {}) as { prompt?: unknown; operationId?: unknown };
  const normalizedOperationId = typeof operationId === 'string' && operationId.trim()
    ? operationId
    : `jarvis-diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt required', operationId: normalizedOperationId });
  }

  const { selectedProvider, selectedModel, fallbackModel } = await resolveDirectChatMetadata();
  const fallbackProvider = 'ollama';
  const startedAt = Date.now();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const abortController = new AbortController();
  const totalTimer = setTimeout(() => abortController.abort(), getDirectChatOverallTimeoutMs());

  writeSse(res, 'status', {
    provider: selectedProvider, model: selectedModel,
    fallbackProvider, fallbackModel,
    operationId: normalizedOperationId, state: 'routing', elapsedMs: 0,
  });
  logger.info('[JarvisDiag] request', JSON.stringify({
    operationId: normalizedOperationId,
    prompt: prompt.slice(0, 120),
    provider: selectedProvider, model: selectedModel, fallbackProvider, fallbackModel,
  }));

  const systemPrompt = 'You are Jarvis, a concise, truthful assistant. Answer the user directly in as few sentences as needed.';
  let firstTokenMs: number | null = null;
  let provider: string | undefined;
  let model: string | undefined;
  let sawContent = false;
  try {
    const stream = llmChatStream({
      systemPrompt,
      prompt,
      history: [],
      agentId: 'agent-jarvis',
      timeoutMs: getDirectChatConnectTimeoutMs(),
      ollamaTimeoutMs: getDirectChatOverallTimeoutMs(),
      signal: abortController.signal,
      requestId: normalizedOperationId,
      escalationModel: fallbackModel,
    });
    for await (const chunk of stream) {
      provider = chunk.provider || provider;
      model = chunk.model || model;
      if (chunk.type === 'token' && chunk.content) {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - startedAt;
          writeSse(res, 'timing', { marker: 'first_token', elapsedMs: firstTokenMs, provider, model, operationId: normalizedOperationId });
        }
        sawContent = true;
        writeSse(res, 'chunk', { delta: chunk.content, provider, model, operationId: normalizedOperationId });
      } else if (chunk.type === 'error') {
        const errText = String((chunk as any)?.error || (chunk as any)?.message || chunk.content || 'provider failed').slice(0, 500);
        writeSse(res, 'error', { error: errText, provider, model, fallbackProvider, fallbackModel, reason: errText, operationId: normalizedOperationId });
      }
      // gateway lifecycle events (selected/completed/…) intentionally not
      // forwarded — the golden path has exactly one consumer signal: deltas.
    }
    writeSse(res, 'done', {
      route: 'diag',
      operationId: normalizedOperationId,
      provider: provider || selectedProvider,
      model: model || selectedModel,
      firstTokenMs,
      totalMs: Date.now() - startedAt,
      sawContent,
    });
    logger.info('[JarvisDiag] done', JSON.stringify({
      operationId: normalizedOperationId,
      provider: provider || selectedProvider,
      model: model || selectedModel,
      firstTokenMs, totalMs: Date.now() - startedAt, sawContent,
    }));
  } catch (err: any) {
    writeSse(res, 'error', { error: String(err?.message || err).slice(0, 500), operationId: normalizedOperationId, totalMs: Date.now() - startedAt });
    logger.error('[JarvisDiag] failed', JSON.stringify({ operationId: normalizedOperationId, error: String(err?.message || err) }));
  } finally {
    clearTimeout(totalTimer);
    res.end();
  }
});

export default router;

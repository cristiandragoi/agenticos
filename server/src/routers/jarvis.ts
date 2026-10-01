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
import { detectControlIntent } from '../domains/jarvisNext/controlIntentDetector.js';
import { isMeaningfulSpeech } from '../services/voice/localTranscribe.js';
import { recoveryController } from '../domains/jarvis/execution/recoveryController.js';
import { selfHealBridge } from '../domains/jarvis/execution/selfHealBridge.js';
import { selfHealSupervisor } from '../domains/selfHeal/SelfHealSupervisor.js';

const router = Router();

function getDirectChatFirstTokenTimeoutMs() {
  // Overall no-token backstop for the DIRECT stream. Local models can need
  // more than a few seconds on full Jarvis prompts, so keep this above the
  // per-attempt connect budget and abort only a genuine no-token stall.
  return Number(process.env.JARVIS_FIRST_TOKEN_TIMEOUT_MS || 45_000);
}

function getDirectChatTotalTimeoutMs() {
  return Number(process.env.JARVIS_TOTAL_RESPONSE_TIMEOUT_MS || 120_000);
}

function getDirectChatStreamIdleTimeoutMs() {
  return Number(process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS || 30_000);
}

function getDirectChatConnectTimeoutMs() {
  // One provider must not consume the whole conversational turn. The local
  // Jarvis model is kept warm; twenty seconds allows a normal first token for local models while
  // preserving time for an honest fallback/error instead of a long silence.
  return Number(process.env.JARVIS_CONNECT_TIMEOUT_MS || 20_000);
}

function getDirectChatOverallTimeoutMs() {
  return Number(process.env.JARVIS_OVERALL_TIMEOUT_MS || 120_000);
}

function normalizeApprovalPolicy(value: any): 'manual' | 'auto' {
  if (value === 'auto') return 'auto';
  return 'manual';
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
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:9b-hermes-64k';
  const hasCloudKey = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim());
  let selectedModel = hasCloudKey ? (process.env.OPENROUTER_MODEL || 'auto') : fallbackModel;
  let selectedProvider = hasCloudKey ? 'OpenRouter' : 'ollama';
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      const resolved = mapCatalogToGatewayId(assignment.providerId);
      if (resolved === 'OpenRouter' && !hasCloudKey) {
        selectedProvider = 'ollama';
        selectedModel = fallbackModel;
      } else {
        selectedModel = assignment.modelId;
        selectedProvider = resolved || selectedProvider;
      }
    } else if (!hasCloudKey) {
      selectedProvider = 'ollama';
      selectedModel = fallbackModel;
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
      .filter((m: any) => {
        const content = typeof m?.content === 'string' ? m.content : '';
        if (m.messageType === 'system_status' || m.message_type === 'system_status') return false;
        if (content.includes('QUEUED behind') || content.includes('no worker activity for') || content.includes('confirmed stalled') || content.includes("I'm back.") || content.includes('AgenticOS runtime status') || content.includes('runtime status:')) return false;
        return true;
      })
      .map((m: any) => `${m.role || 'system'}: ${typeof m.content === 'string' ? m.content : ''}`)
      .join('\n');
  } catch {
    return '';
  }
}

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

export function buildConversationHistory(
  messages: any[],
  currentPrompt: string,
  maxTurns = 12,
  maxChars = 10000,
): { role: 'user' | 'assistant'; content: string }[] {
  const raw = Array.isArray(messages) ? [...messages] : [];
  if (raw.length > 0) {
    const last = raw[raw.length - 1];
    if (last?.role === 'user' && typeof last?.content === 'string' && last.content.trim() === currentPrompt.trim()) {
      raw.pop();
    }
  }

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let chars = 0;

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
    if (role === 'system' || m.messageType === 'system_status' || m.message_type === 'system_status') continue;
    if (role !== 'user' && role !== 'agent') continue;

    if (role === 'agent') {
      if (content.includes('[Stream Error:')) continue;
      if (
        content.includes('QUEUED behind') ||
        content.includes('is currently QUEUED') ||
        content.includes('no worker activity for') ||
        content.includes('confirmed stalled') ||
        content.includes("I'm back. ")
      ) {
        continue;
      }
      if (
        content.includes('Jarvis is currently executing') ||
        content.includes('CodeX is currently') ||
        content.includes('Hermes gateway') ||
        content.includes('Runtime diagnostics') ||
        content.includes('I inspected the active AgenticOS state')
      ) {
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
    // Lifecycle context conversations hold legacy-handler scratch history; they are not user conversations.
    res.json(list.filter((c: any) => c.primaryAgent !== 'jarvis-context'));
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
function writeSse(res: any, event: string, data: any) {
  if (res.writableEnded || res.finished || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

/**
 * D14 §5 — navigation ACK endpoint. The CLIENT reports proven state here; the
 * transaction decides. Duplicate/stale/mismatched ACKs never flip a decision.
 */
router.post('/navigation/ack', async (req, res) => {
  try {
    const { navId, success, actualRoute, activeProjectId, visibleEntityId, error } = req.body || {};
    if (!navId || typeof navId !== 'string') {
      return res.status(400).json({ accepted: false, error: 'navId is required.' });
    }
    const { completeNavigation } = await import('../services/navigation/navigationTransactions.js');
    const outcome = completeNavigation({
      navId,
      success: Boolean(success),
      actualRoute,
      activeProjectId,
      visibleEntityId,
      error,
    });
    logger.info('[JRT] NAV_ACK_HTTP', {
      navId,
      accepted: outcome.accepted,
      verified: outcome.verified,
      reason: outcome.reason ?? null,
      actualRoute: actualRoute ?? null,
      activeProjectId: activeProjectId ?? null,
    });
    res.json({
      accepted: outcome.accepted,
      verified: outcome.verified,
      reason: outcome.reason ?? null,
      result: outcome.result ?? null,
    });
  } catch (e: any) {
    res.status(500).json({ accepted: false, error: e?.message || 'ack_failed' });
  }
});

/**
 * Self-Heal Human-in-the-Loop Endpoints
 */
router.get('/self-heal/incident/:id/diff', async (req, res) => {
  try {
    const incidentId = req.params.id;
    if (!incidentId) {
      return res.status(400).json({ success: false, error: 'incidentId is required' });
    }
    const proposal = selfHealBridge.getProposal(incidentId);
    const attempt = selfHealSupervisor.getCurrentAttempt(incidentId);
    const fullDiff = proposal?.diff || proposal?.patch || attempt?.fullDiff || '';
    const filesAffected = proposal?.filesAffected || attempt?.filesChanged || [];

    if (!fullDiff && !proposal) {
      return res.status(404).json({
        success: false,
        error: `No proposal or diff found for incident ${incidentId}`,
      });
    }

    const testOk = attempt?.testReport?.overallVerdict === 'PASS' || attempt?.testReport?.overallVerdict === 'PASS_WITH_BASELINE_FAILURES' || false;
    res.json({
      success: true,
      incidentId,
      diff: fullDiff,
      filesAffected,
      proposal: proposal || {
        incidentId,
        problem: attempt?.diffSummary || 'Capability failure',
        diagnosis: attempt?.diffSummary || 'Isolated defect',
        proposedRepair: attempt?.diffSummary || 'Code patch',
        filesAffected,
        testResult: { passed: testOk },
        patch: fullDiff,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to get diff' });
  }
});

router.post('/self-heal/approve', async (req, res) => {
  try {
    const { incidentId, conversationId, turnId, approver } = req.body || {};
    if (!incidentId || typeof incidentId !== 'string') {
      return res.status(400).json({ success: false, error: 'incidentId is required.' });
    }

    logger.info(`[JarvisRouter] Approving repair for incident ${incidentId}`);
    const result = await recoveryController.approveRepair({
      incidentId,
      conversationId,
      turnId,
      approver: approver || 'user',
    });

    res.json(result);
  } catch (err: any) {
    logger.error('[JarvisRouter] Error approving repair:', err);
    res.status(500).json({
      success: false,
      status: 'error',
      message: err?.message || 'Failed to approve repair',
      incidentId: req.body?.incidentId,
    });
  }
});

router.post('/self-heal/reject', async (req, res) => {
  try {
    const { incidentId, conversationId, reason } = req.body || {};
    if (!incidentId || typeof incidentId !== 'string') {
      return res.status(400).json({ success: false, error: 'incidentId is required.' });
    }

    logger.info(`[JarvisRouter] Rejecting repair for incident ${incidentId}`);
    const result = await recoveryController.rejectRepair({
      incidentId,
      conversationId,
      reason: reason || 'Rejected by user',
    });

    res.json(result);
  } catch (err: any) {
    logger.error('[JarvisRouter] Error rejecting repair:', err);
    res.status(500).json({
      success: false,
      status: 'error',
      message: err?.message || 'Failed to reject repair',
      incidentId: req.body?.incidentId,
    });
  }
});

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
  if (m.includes('qwen2.5:7b-64k') || m.includes('qwen2.5-7b-64k')) return 'Qwen 2.5 7B (64k)';
  if (m.includes('qwen2.5:7b') || m.includes('qwen2.5-7b')) return 'Qwen 2.5 7B';
  if (m.includes('qwen2.5:14b') || m.includes('qwen2.5-14b')) return 'Qwen 2.5 14B';
  if (m.includes('qwen2.5:32b') || m.includes('qwen2.5-32b')) return 'Qwen 2.5 32B';
  if (m.includes('qwen2.5')) return 'Qwen 2.5';
  if (m.includes('qwen3.5')) return 'Qwen 3.5';
  if (m.includes('qwen')) return 'Qwen';
  if (m.includes('llama3.2:3b') || m.includes('llama3.2-3b')) return 'Llama 3.2 3B';
  if (m.includes('llama3.2:1b') || m.includes('llama3.2-1b')) return 'Llama 3.2 1B';
  if (m.includes('llama3.2')) return 'Llama 3.2';
  if (m.includes('llama')) return 'Llama';
  if (m.includes('deepseek-v4-flash')) return 'DeepSeek V4 Flash';
  if (m.includes('deepseek-coder-v2')) return 'DeepSeek Coder V2';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('laguna-s-2.1')) return 'Laguna S 2.1';
  if (m.includes('laguna-xs')) return 'Laguna XS';
  if (m.includes('gpt-4o')) return 'GPT-4o';
  if (m.includes('gpt-')) return 'GPT';
  if (m.includes('claude')) return 'Claude';
  if (m.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('longcat')) return 'LongCat';
  if (m.includes('kimi')) return 'Kimi';
  if (m.includes('minimax')) return 'MiniMax';
  if (!m || m === 'auto') return 'Auto';
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
  // Phase 1: lifecycle-owned. The previous direct jarvisOrchestrator call is retained
  // below as legacyMessageHandler (unmounted).
  try {
    const { prompt, operationId } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !isMeaningfulSpeech(prompt)) {
      return res.status(400).json({ error: 'No meaningful speech detected.', noSpeech: true });
    }
    // The lifecycle's delivery stage creates the conversation if it does not exist yet.
    const { turnLifecycle } = await import('../domains/turnLifecycle/index.js');
    const submitted = await turnLifecycle.submit({
      source: 'typed_chat', conversationId: req.params.id, text: prompt,
      externalTurnId: typeof operationId === 'string' ? operationId : undefined,
    });
    if (submitted.duplicate) return res.status(409).json({ duplicate: true, duplicateOf: submitted.duplicateOf, reason: submitted.reason });
    const r = submitted.record;
    return res.json({
      requestId: r.request.requestId, outcome: r.outcome, outcomeReason: r.outcomeReason,
      message: r.responseText, handler: r.handler ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const legacyMessageHandler = async (req: any, res: any) => {
  try {
    const { prompt, approvalPolicy, operationId, maintenanceFiles, testGates } = req.body;
    const workspacePath = resolveWorkspacePath(req.body);
    if (!prompt || typeof prompt !== 'string' || !isMeaningfulSpeech(prompt)) {
      return res.status(400).json({ error: 'No meaningful speech detected.', noSpeech: true });
    }

    // Optional typed maintenance context (Phase 4 hardening): explicit owned
    // files + allowlisted test gates for self-maintenance reproduction/ownership.
    const maintenanceContext = maintenanceFiles || testGates
      ? {
          files: Array.isArray(maintenanceFiles) ? maintenanceFiles : undefined,
          testGates: Array.isArray(testGates) ? testGates : undefined,
        }
      : undefined;

    // Let the orchestrator handle everything (recording user message, routing, and acting).
    // workspacePath is passed through verbatim: routes that create real work validate
    // it and return an explicit error instead of falling back to a fake 'default'.
    const result = await jarvisOrchestrator.handleMessage(
      req.params.id,
      prompt,
      workspacePath,
      normalizeApprovalPolicy(approvalPolicy),
      typeof operationId === 'string' ? operationId : undefined,
      undefined,
      maintenanceContext
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
};
void legacyMessageHandler;

router.get('/actions/latest', async (req, res) => {
  const { getLatestAction } = await import('../domains/jarvis/actionRuntime.js');
  res.json({ action: getLatestAction() });
});

router.get('/actions/history', async (req, res) => {
  const { getActionHistory } = await import('../domains/jarvis/actionRuntime.js');
  res.json({ actions: getActionHistory() });
});

router.post('/actions/:id/status', async (req, res) => {
  const { updateActionRecord } = await import('../domains/jarvis/actionRuntime.js');
  const updated = updateActionRecord(req.params.id, req.body || {});
  res.json({ success: !!updated, action: updated });
});

/* ── POST /api/jarvis/conversations/:id/approve_team ──────── */
/**
 * PRE-PHASE-1 typed stream pipeline (≈40 independent routing branches that
 * executed and responded on their own). RETAINED FOR REFERENCE ONLY — it is no
 * longer mounted. Typed chat now submits to TurnLifecycleController below.
 */
const legacyMessageStreamHandler = async (req: any, res: any) => {
  const { prompt: rawPrompt, approvalPolicy, operationId, workspaceContext } = req.body;
  const rawAttachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
  let prompt = typeof rawPrompt === 'string' ? rawPrompt : '';

  if (rawAttachments.length > 0) {
    const attachmentSummary = rawAttachments.map((a: any) => {
      let desc = `[Attached file: ${a.name || 'unnamed'} (${a.type || 'unknown type'}, ${a.size || 0} bytes)]`;
      if (a.textContent) {
        desc += `\nFile Content:\n${a.textContent.slice(0, 10000)}`;
      } else if (a.dataUrl && a.type?.startsWith('image/')) {
        desc += `\n[Image Data URL provided (${a.name})]`;
      }
      return desc;
    }).join('\n\n');

    prompt = prompt.trim()
      ? `${prompt.trim()}\n\nUser Attachments:\n${attachmentSummary}`
      : `Please inspect the attached files:\n\n${attachmentSummary}`;
  }

  const inputChannel = typeof req.body.inputChannel === 'string' ? req.body.inputChannel : undefined;
  const workspacePath = resolveWorkspacePath(req.body);
  const normalizedOperationId = typeof operationId === 'string' ? operationId : undefined;
  logStreamStage(normalizedOperationId, 'stream request accepted', {
    conversationId: req.params.id,
    hasPrompt: typeof prompt === 'string',
    attachmentsCount: rawAttachments.length,
    bodyKeys: Object.keys(req.body || {})
  });

  logger.info('[JarvisTrace] request-received', JSON.stringify({
    requestId: normalizedOperationId,
    conversationId: req.params.id,
    route: req.headers.referer,
    rawUserText: prompt,
    attachmentsCount: rawAttachments.length
  }, null, 2));

  if (!prompt || typeof prompt !== 'string' || (!rawAttachments.length && !isMeaningfulSpeech(prompt))) {
    logStreamStage(normalizedOperationId, 'prompt validation failed', { reason: 'no meaningful speech' });
    return res.status(400).json({ error: 'No meaningful speech detected.', noSpeech: true });
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

  let heartbeatTimer: NodeJS.Timeout | null = setInterval(() => {
    if (!completed && !res.writableEnded && !clientClosed) {
      writeSse(res, 'heartbeat', {
        timestamp: Date.now(),
        operationId: normalizedOperationId,
        state: 'active',
      });
    }
  }, 10_000);

  let unsubscribeHermesProgress: (() => void) | null = null;
  try {
    const { hermesProgressBus } = await import('../domains/hermes/progressEvents.js');
    unsubscribeHermesProgress = hermesProgressBus.onConversation(req.params.id, (progEvt) => {
      if (!completed && !res.writableEnded && !clientClosed) {
        writeSse(res, 'hermes_progress', {
          ...progEvt,
          operationId: normalizedOperationId,
        });
      }
    });
  } catch {}

  req.on('close', () => {
    clientClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (unsubscribeHermesProgress) {
      unsubscribeHermesProgress();
      unsubscribeHermesProgress = null;
    }
    logStreamStage(normalizedOperationId, 'client disconnected', { completed });
    if (!completed) {
      abortController.abort();
      endStreamExecution('CANCELLED');
    }
  });

  try {
    // ── Conversational Authority & Isolation Intercept ──
    const { classifyInputAuthority, canonicalObjectiveManager } = await import('../domains/jarvis/conversationalAuthority.js');
    const passedConfidence = typeof (req.body as any)?.confidence === 'number'
      ? (req.body as any).confidence
      : typeof (requestMetadata as any)?.confidence === 'number'
      ? (requestMetadata as any).confidence
      : undefined;
    const sourceHeader = (req.headers['x-input-source'] as string) || (req.body as any)?.sourceLabel || (requestMetadata as any)?.sourceLabel;
    const authority = classifyInputAuthority(prompt, {
      inputChannel: (req.body as any)?.inputChannel || (requestMetadata as any)?.inputChannel,
      confidence: passedConfidence,
      sourceHeader,
    });

    if (authority.rejectionDetected) {
      logStreamStage(normalizedOperationId, 'authority rejection disavowal', { reason: authority.reason });
      // Prune / discard previous user turn from context
      try {
        const msgs = await conversationService.getMessages(req.params.id);
        if (msgs && msgs.length > 0) {
          const lastUser = msgs.slice().reverse().find(m => m.role === 'user');
          if (lastUser && lastUser.content) {
            canonicalObjectiveManager.discardTurn(lastUser.content);
          }
        }
      } catch {}
      const reply = authority.clarificationPrompt || "Understood. I've discarded that from our operational context.";
      writeSse(res, 'intent', {
        type: 'authority_disavowal',
        route: 'authority_disavowal',
        mode: 'direct_conversation',
        confidence: 1.0,
        source: authority.source,
        reason: authority.reason,
        operationId: normalizedOperationId,
      });
      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'conversational-authority', source: authority.source },
      });
      writeSse(res, 'done', {
        route: 'authority_disavowal',
        category: 'authority_disavowal',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'conversational-authority',
        firstTokenMs: 0,
        totalMs: 0,
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    const ctrl = detectControlIntent(prompt, { isBargeIn: Boolean(req.body?.isBargeIn) });
    if (ctrl.isControl && ctrl.intent === 'STOP') {
      if (preExistingCurrent?.cancel?.kind === 'stream') {
        const { dispatchCancel } = await import('./execution.js');
        await dispatchCancel(preExistingCurrent.cancel);
      }
      completed = true;
      endStreamExecution('CANCELLED');
      writeSse(res, 'done', { route: 'voice_stop', status: 'cancelled', operationId: normalizedOperationId });
      return res.end();
    }

    // ── Explicit Engineering Delegation Intercept (AntiGravity - HIGHEST PRECEDENCE) ──
    // Must execute strictly BEFORE language preference, operational controller, browser, desktop, or normal routing.
    const { parseExplicitEngineeringDelegation, executeEngineeringDelegation } = await import('../domains/controlPlane/ExplicitEngineeringDelegation.js');
    const explicitEngineering = parseExplicitEngineeringDelegation(prompt);
    if (explicitEngineering) {
      logStreamStage(normalizedOperationId, 'explicit engineering delegation requested', { action: explicitEngineering.action, task: explicitEngineering.task });

      writeSse(res, 'intent', {
        type: 'engineering_delegation',
        route: 'engineering_delegation',
        mode: 'operational_execution',
        confidence: 1.0,
        worker: 'antigravity',
        action: explicitEngineering.action,
        operationId: normalizedOperationId,
      });

      let immediateAck = "Understood. I'm delegating that engineering task to AntiGravity now.";
      if (explicitEngineering.action === 'continue') {
        immediateAck = "Understood. I'm continuing the current AntiGravity task now.";
      } else if (explicitEngineering.action === 'resume') {
        immediateAck = `Understood. I'm resuming AntiGravity task ${explicitEngineering.taskId || ''} now.`;
      }
      streamTextAsChunks(res, immediateAck, normalizedOperationId);

      const delRes = await executeEngineeringDelegation(explicitEngineering, {
        conversationId: req.params.id,
        workspace: workspacePath || 'D:\\AgenticOS',
        speakFn: async (textToSpeak) => {
          try {
            const { jarvisNextAgent } = await import('../domains/jarvisNext/jarvisNextAgent.js');
            await jarvisNextAgent.speak(textToSpeak);
          } catch {}
        },
        broadcastFn: (data) => {
          writeSse(res, 'action_status', {
            ...data,
            operationId: normalizedOperationId,
          });
        },
      });

      if (delRes.text && delRes.text !== immediateAck) {
        streamTextAsChunks(res, '\n\n' + delRes.text, normalizedOperationId);
      }
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'user',
        content: prompt,
        metadata: { ...(requestMetadata || {}) },
      });
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: delRes.text,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          provider: 'agentic-os',
          model: 'antigravity-delegation',
          worker: 'antigravity',
          intent: { type: 'engineering_delegation', confidence: 1.0 },
          taskId: delRes.taskId,
          sessionId: delRes.sessionId,
          goalId: delRes.goalId,
        },
      });

      writeSse(res, 'done', {
        route: 'engineering_delegation',
        category: 'engineering',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'antigravity-delegation',
        taskId: delRes.taskId,
        sessionId: delRes.sessionId,
        goalId: delRes.goalId,
        verified: delRes.success,
        executed: delRes.success,
        firstTokenMs: 0,
        totalMs: Date.now() - streamStartedAt,
      });

      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', delRes.text);
      return res.end();
    }

    // ── Operational Controller Intercept (Evidence-First Grounding) ──
    const { OperationalController } = await import('../domains/jarvis/operationalEvidence.js');
    const opIntercept = await OperationalController.handleOperationalRequest(prompt, req.params.id);
    if (opIntercept) {
      logStreamStage(normalizedOperationId, 'operational-controller intercept', { hasEvidence: opIntercept.evidence.hasEvidence });
      writeSse(res, 'intent', { type: 'operational_control', route: 'operational_control', mode: 'direct_conversation', confidence: 1, operationId: normalizedOperationId });
      streamTextAsChunks(res, opIntercept.reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: opIntercept.reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'operational-controller' }
      });
      writeSse(res, 'done', { route: 'operational_control', category: 'operational_control', operationId: normalizedOperationId, provider: 'agentic-os', model: 'operational-controller', firstTokenMs: 0, totalMs: 0 });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', opIntercept.reply);
      return res.end();
    }

    const { resolvePreferredNameTurn } = await import('../domains/jarvis/coreMemory.js');
    const identityReply = resolvePreferredNameTurn(prompt);
    if (identityReply) {
      await conversationService.appendMessage({ conversationId: req.params.id, role: 'user', content: prompt });
      await conversationService.appendMessage({ conversationId: req.params.id, role: 'agent', content: identityReply, routedAgent: 'jarvis' });
      writeSse(res, 'intent', { route: 'user_profile', type: 'user_profile', operationId: normalizedOperationId });
      streamTextAsChunks(res, identityReply, normalizedOperationId);
      writeSse(res, 'done', { route: 'user_profile', provider: 'agentic-os', model: 'core-memory', operationId: normalizedOperationId });
      completed = true;
      endStreamExecution('COMPLETED', identityReply);
      return res.end();
    }

    // ── Language Switch Intercept & Verified State Mutation (HIGHEST PRIORITY) ──
    // Must run BEFORE supervisor_v2, task-control, task-reference, task-status, or intent routing.
    const { detectLanguageSwitchRequest, setConversationLanguage, buildLanguageSwitchConfirmation } = await import('../domains/jarvis/conversationLanguage.js');

    const langReq = detectLanguageSwitchRequest(prompt);
    if (langReq.isLanguageSwitch && langReq.targetLanguage) {
      logStreamStage(normalizedOperationId, 'language switch requested', { target: langReq.targetLanguage });
      const mutationResult = setConversationLanguage(req.params.id, langReq.targetLanguage, true);
      const { voiceRuntimeState } = await import('../services/voice/VoiceRuntimeState.js');
      voiceRuntimeState.setLanguage(mutationResult.activeLanguage, mutationResult.activeLanguage === 'de' ? 'de-DE' : undefined, true);
      const reply = mutationResult.success
        ? buildLanguageSwitchConfirmation(mutationResult.activeLanguage)
        : `Failed to switch language to ${langReq.targetLanguage}. Current language is ${mutationResult.activeLanguage}.`;

      writeSse(res, 'intent', {
        type: 'language_preference',
        route: 'language_preference',
        mode: 'direct_conversation',
        confidence: 1.0,
        reason: langReq.reason,
        language: mutationResult.activeLanguage,
        operationId: normalizedOperationId,
      });

      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          provider: 'agentic-os',
          model: 'language-manager',
          language: mutationResult.activeLanguage,
          actionVerified: mutationResult.success,
        },
      });

      writeSse(res, 'done', {
        route: 'language_preference',
        category: 'conversation',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'language-manager',
        language: mutationResult.activeLanguage,
        actionVerified: mutationResult.success,
        firstTokenMs: 0,
        totalMs: 0,
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    // ── Canonical Turn Router (ONE Shared Controller Path) ──
    try {
      const { routeTurn } = await import('../domains/jarvisNext/turnRouter.js');
      // ── D14: typed navigation transport ────────────────────────────────
      // The typed chat has NO LiveKit room, so navigation must be carried on the
      // response stream the client is already reading, and the ACK must come back
      // over HTTP. One transaction model, one canonical packet shape (§2/§3).
      const { beginNavigation, buildNavigationPacket } = await import('../services/navigation/navigationTransactions.js');
      const navigationVerifier = async (navReq: {
        navigationId: string; route: string; entityId: string; entityType: string; entityName: string;
      }) => {
        const base = {
          navId: navReq.navigationId,
          conversationId: req.params.id,
          targetRoute: navReq.route,
          entityId: navReq.entityId,
          entityName: navReq.entityName,
          entityType: navReq.entityType,
          source: 'typed' as const,
        };
        const { result } = beginNavigation(base, 2500);
        writeSse(res, 'navigation_request', buildNavigationPacket(base));
        return result;
      };

      const onActionProgress = (progress: any) => {
        if (!completed && !res.writableEnded && !clientClosed) {
          writeSse(res, 'action_status', {
            ...progress,
            operationId: normalizedOperationId,
          });
        }
      };

      const sharedTurn = await routeTurn({
        prompt,
        conversationId: req.params.id,
        navigationVerifier,
        onActionProgress,
      });

      if (sharedTurn.handled && sharedTurn.route !== 'deep_supervisor') {
        const startedAt = Date.now();
        let reply = sharedTurn.text;
        let actionStatusMeta: any = null;
        
        if (sharedTurn.route === 'navigate') {
          // RESPONSE TRUTH GATE (B): success text, a completed status and a
          // navigation event may only be emitted for a VERIFIED navigation.
          // Previously this path wrote "X is open." from the entity name alone,
          // defaulted the destination to /mission-control, and reported
          // status:'completed' even when nothing had navigated.
          const navVerified = sharedTurn.verified === true;
          const destination = sharedTurn.uiRoute;
          writeSse(res, 'intent', {
            type: 'navigation',
            route: 'navigation',
            mode: 'operational_execution',
            confidence: 1.0,
            reason: `Navigation to ${sharedTurn.entityName || sharedTurn.entityId}`,
            capability: sharedTurn.entityType,
            verified: navVerified,
            entityId: sharedTurn.entityId,
            entityType: sharedTurn.entityType,
            entityName: sharedTurn.entityName,
            operationId: normalizedOperationId,
          });
          if (navVerified && destination) {
            reply = `I've opened ${sharedTurn.entityName || 'the requested view'}.`;
            writeSse(res, 'navigation', {
              target: destination,
              capability: sharedTurn.entityType,
              entityId: sharedTurn.entityId,
              entityType: sharedTurn.entityType,
              displayName: sharedTurn.entityName,
              operationId: normalizedOperationId,
            });
            writeSse(res, 'action_status', {
              actionName: `Open ${sharedTurn.entityName || sharedTurn.entityId}`,
              targetCapability: sharedTurn.entityType,
              status: 'completed',
              destination,
              operationId: normalizedOperationId,
            });
          } else {
            // No verified navigation: keep the executor's own failure detail,
            // emit no navigation event, and invent no destination.
            reply = sharedTurn.text;
            writeSse(res, 'action_status', {
              actionName: `Open ${sharedTurn.entityName || sharedTurn.entityId || 'target'}`,
              targetCapability: sharedTurn.entityType,
              status: 'failed',
              error: sharedTurn.fallbackReason || 'navigation_not_verified',
              destination: destination ?? null,
              operationId: normalizedOperationId,
            });
          }
        } else if (sharedTurn.route === 'project_operate') {
          writeSse(res, 'intent', {
            type: 'project_operate',
            route: 'project_operate',
            mode: 'operational_execution',
            confidence: 1.0,
            reason: `Project operational execution for ${sharedTurn.entityName || sharedTurn.entityId}`,
            capability: 'project_orchestrator',
            entityId: sharedTurn.entityId,
            entityType: sharedTurn.entityType,
            entityName: sharedTurn.entityName,
            verified: sharedTurn.verified,
            executed: sharedTurn.executed,
            operationId: normalizedOperationId,
          });
          writeSse(res, 'action_status', {
            actionName: `Operate ${sharedTurn.entityName || sharedTurn.entityId}`,
            targetCapability: 'project_orchestrator',
            status: sharedTurn.executed && sharedTurn.verified ? 'completed' : 'failed',
            operationId: normalizedOperationId,
          });
        } else if (sharedTurn.route === 'blocker_detail_read') {
          writeSse(res, 'intent', {
            type: 'blocker_detail_read',
            route: 'blocker_detail_read',
            mode: 'operational_execution',
            confidence: 1.0,
            reason: `Blocker detail resolution for ${sharedTurn.entityName || sharedTurn.entityId}`,
            capability: 'project_orchestrator',
            operationId: normalizedOperationId,
          });
          writeSse(res, 'action_status', {
            actionName: `Inspect blocker detail`,
            targetCapability: 'project_orchestrator',
            status: sharedTurn.verified ? 'completed' : 'failed',
            operationId: normalizedOperationId,
          });
        } else {
          writeSse(res, 'intent', {
            type: sharedTurn.route,
            route: sharedTurn.route,
            mode: 'direct_conversation',
            confidence: 1.0,
            entityId: sharedTurn.entityId,
            entityType: sharedTurn.entityType,
            entityName: sharedTurn.entityName,
            verified: sharedTurn.verified,
            executed: sharedTurn.executed,
            operationId: normalizedOperationId,
          });

          const routeStr = sharedTurn.route as string;
          if (routeStr === 'browser' || routeStr === 'desktop' || routeStr === 'terminal' || (sharedTurn as any).plan) {
            const cap = routeStr === 'browser' ? 'browser' : routeStr === 'desktop' ? 'desktop' : routeStr;
            const isAwaitingApproval = Boolean((sharedTurn as any).repairProposal || (sharedTurn as any).stage === 'AWAITING_APPROVAL');
            const isVerified = sharedTurn.verified === true;
            const status = isAwaitingApproval ? 'waiting' : (isVerified ? 'completed' : 'failed');
            const planSteps = (sharedTurn as any).plan?.steps || [];
            const executedGoals: string[] = (sharedTurn as any).executedGoals || [];
            const stepList = planSteps.length > 0
              ? planSteps.map((s: any) => ({ step: s.description || s.action, ok: isVerified, detail: s.action }))
              : executedGoals.map((g: string) => ({ step: g, ok: isVerified, detail: '' }));

            if (!isVerified) {
              const unverifiedSuccessPattern = /\b(?:i(?:'ve| have)? (?:opened|created|sent|started|launched|completed|finished|deleted)|page is open|target is open|successfully (?:opened|created|sent|started|executed|completed))\b/i;
              if (unverifiedSuccessPattern.test(reply)) {
                reply = sharedTurn.fallbackReason || `I attempted the action, but could not verify that it completed successfully.`;
              }
            }

            actionStatusMeta = {
              actionName: sharedTurn.entityName || (sharedTurn as any).goalDescription || prompt,
              targetCapability: cap,
              status,
              request: prompt,
              understood: (sharedTurn as any).goalDescription || prompt,
              capability: cap,
              executor: cap,
              tool: cap === 'browser' ? 'browserOperator' : cap === 'desktop' ? 'desktopExecutor' : 'terminalExecutor',
              result: reply,
              verification: isVerified ? 'Verified operational result' : (sharedTurn.fallbackReason || 'Execution unverified: post-condition not confirmed'),
              steps: stepList,
              durationMs: Date.now() - startedAt,
              operationId: normalizedOperationId,
              stage: (sharedTurn as any).stage || (isAwaitingApproval ? 'AWAITING_APPROVAL' : undefined),
              repairProposal: (sharedTurn as any).repairProposal,
              goalId: (sharedTurn as any).goalId,
            };
            writeSse(res, 'action_status', actionStatusMeta);
          }
        }

        if ((sharedTurn as any).goalId) {
          writeSse(res, 'goal_run', {
            goalId: (sharedTurn as any).goalId,
            status: sharedTurn.verified ? 'completed' : 'failed',
            operationId: normalizedOperationId,
          });
        }

        if (!reply || !reply.trim()) {
          reply = "I found the blocker, but its task record doesn't specify which API credentials are missing.";
        }

        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'user',
          content: prompt,
          metadata: { ...(requestMetadata || {}) },
        });
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: {
            ...(requestMetadata || {}),
            provider: 'agentic-os',
            model: 'turn-router',
            intent: { type: sharedTurn.route, confidence: 1.0 },
            entityId: sharedTurn.entityId,
            entityType: sharedTurn.entityType,
            uiRoute: sharedTurn.uiRoute,
            goalId: (sharedTurn as any).goalId,
            ...(actionStatusMeta ? { actionStatus: actionStatusMeta } : {}),
          },
        });
        writeSse(res, 'done', {
          route: sharedTurn.route,
          category: sharedTurn.route,
          entityId: sharedTurn.entityId,
          entityType: sharedTurn.entityType,
          entityName: sharedTurn.entityName,
          verified: sharedTurn.verified,
          executed: sharedTurn.executed,
          goalId: (sharedTurn as any).goalId,
          requestedGoals: (sharedTurn as any).requestedGoals,
          executedGoals: (sharedTurn as any).executedGoals,
          satisfiedGoals: (sharedTurn as any).satisfiedGoals,
          failedGoals: (sharedTurn as any).failedGoals,
          operationId: normalizedOperationId,
          provider: 'agentic-os',
          model: 'turn-router',
          firstTokenMs: 0,
          totalMs: Date.now() - startedAt,
        });
        completed = true;
        updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
        endStreamExecution('COMPLETED', reply);
        return res.end();
      }
    } catch (turnErr) {
      logger.warn('[JarvisStream] routeTurn call error, falling back:', turnErr);
    }

    // ── Deterministic Action Runtime & Contextual Entity Resolution (TASK: JARVIS-ACTION-RUNTIME-001) ──
    const { parseJarvisAction, recordAction, getLatestAction } = await import('../domains/jarvis/actionRuntime.js');
    const actionResult = await parseJarvisAction(prompt, workspaceContext);
    if (actionResult.isAction) {
      const startedAt = Date.now();
      let reply = actionResult.explanation;
      let actionStatusMeta: any = null;
      let actionRecordMeta: any = null;

      if ('action' in actionResult) {
        const act = actionResult.action;
        if (act.type === 'OPEN_MODULE') {
          const destination = act.route;
          actionRecordMeta = {
            id: `action-${Date.now()}`,
            ownerAgent: 'jarvis',
            module: act.module,
            command: prompt,
            actionType: 'OPEN_MODULE',
            displayName: act.displayName,
            status: 'completed',
            startedAt: new Date(startedAt).toISOString(),
            completedAt: new Date().toISOString(),
            destination,
            evidence: [
              { type: 'navigation_request', detail: `User requested opening ${act.displayName}`, timestamp: new Date(startedAt).toISOString() },
              { type: 'route_dispatch', detail: `Dispatched navigation to ${destination}`, timestamp: new Date().toISOString() }
            ]
          };
          recordAction(actionRecordMeta);

          writeSse(res, 'intent', {
            type: 'navigation',
            route: 'navigation',
            mode: 'operational_execution',
            confidence: 0.99,
            reason: `Explicit navigation request to ${act.displayName}`,
            capability: act.module,
            operationId: normalizedOperationId
          });
          writeSse(res, 'navigation', {
            target: destination,
            capability: act.module,
            operationId: normalizedOperationId
          });
          actionStatusMeta = {
            actionName: `Open ${act.displayName}`,
            targetCapability: act.module,
            status: 'completed',
            destination,
            operationId: normalizedOperationId
          };
          writeSse(res, 'action_status', actionStatusMeta);
          writeSse(res, 'action_record', actionRecordMeta);
          reply = `Opening ${act.displayName}.`;
        } else if (act.type === 'OPEN_ENTITY') {
          const destination = act.destination;
          actionRecordMeta = {
            id: `action-${Date.now()}`,
            ownerAgent: 'jarvis',
            module: act.module,
            command: prompt,
            actionType: 'OPEN_ENTITY',
            entityType: act.entityType,
            entityId: act.entityId,
            displayName: act.displayName,
            status: 'completed',
            startedAt: new Date(startedAt).toISOString(),
            completedAt: new Date().toISOString(),
            destination,
            evidence: [
              { type: 'entity_resolution', detail: `Resolved "${act.displayName}" (${act.entityId}) in ${act.module}`, timestamp: new Date(startedAt).toISOString() },
              { type: 'route_dispatch', detail: `Dispatched navigation to ${destination}`, timestamp: new Date().toISOString() }
            ]
          };
          recordAction(actionRecordMeta);

          writeSse(res, 'intent', {
            type: 'navigation',
            route: 'navigation',
            mode: 'operational_execution',
            confidence: 0.98,
            reason: `Contextual navigation to ${act.displayName}`,
            capability: act.module,
            operationId: normalizedOperationId
          });
          writeSse(res, 'navigation', {
            target: destination,
            capability: act.module,
            entityId: act.entityId,
            entityType: act.entityType,
            displayName: act.displayName,
            actionId: actionRecordMeta.id,
            command: prompt,
            operationId: normalizedOperationId
          });
          actionStatusMeta = {
            actionName: `Open ${act.displayName}`,
            targetCapability: act.module || 'revenue-operator',
            status: 'completed',
            executionId: act.entityId,
            destination,
            operationId: normalizedOperationId
          };
          writeSse(res, 'action_status', actionStatusMeta);
          writeSse(res, 'action_record', actionRecordMeta);
          reply = `Opening ${act.displayName} in ${act.module || 'workspace'}.`;
        } else if (act.type === 'SHOW_ACTIVITY') {

          const prev = getLatestAction();

          if (prev) {
            writeSse(res, 'intent', {
              type: 'show_activity',
              route: 'show_activity',
              mode: 'operational_execution',
              confidence: 1.0,
              operationId: normalizedOperationId
            });
            actionStatusMeta = {
              actionName: 'Recent Activity',
              targetCapability: prev.module || 'jarvis',
              status: prev.status,
              destination: prev.destination,
              operationId: normalizedOperationId
            };
            writeSse(res, 'action_status', actionStatusMeta);
            writeSse(res, 'action_record', prev);
            if (prev.destination) {
              writeSse(res, 'navigation', {
                target: prev.destination,
                capability: prev.module || 'workspace',
                operationId: normalizedOperationId
              });
            }
            reply = `Here is what I did: Executed "${prev.command || prev.actionType}" with status "${prev.status}"${prev.destination ? ` for ${prev.destination}` : ''}.${prev.displayName ? ` (${prev.displayName})` : ''}`;
          } else {
            reply = 'No previous actions have been recorded in this session yet.';
          }
        } else if (act.type === 'GO_BACK') {
          writeSse(res, 'intent', {
            type: 'navigation',
            route: 'navigation',
            mode: 'operational_execution',
            confidence: 1.0,
            operationId: normalizedOperationId
          });
          writeSse(res, 'navigation', {
            target: 'GO_BACK',
            operationId: normalizedOperationId
          });
          reply = 'Navigating back.';
        }
      } else if ('failure' in actionResult) {
        const fail = actionResult.failure;
        actionRecordMeta = {
          id: `action-${Date.now()}`,
          ownerAgent: 'jarvis',
          module: workspaceContext?.activeModule || 'workspace',
          command: prompt,
          actionType: 'OPEN_ENTITY',
          status: 'failed',
          errorCode: fail.code,
          error: fail.message,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          evidence: fail.candidates
            ? fail.candidates.map(c => ({ type: 'candidate', detail: `${c.displayName} (${c.entityId})`, timestamp: new Date().toISOString() }))
            : [{ type: 'error', detail: fail.message, timestamp: new Date().toISOString() }]
        };
        recordAction(actionRecordMeta);

        writeSse(res, 'intent', {
          type: 'action_failure',
          route: 'action_failure',
          mode: 'direct_conversation',
          confidence: 1.0,
          operationId: normalizedOperationId
        });
        actionStatusMeta = {
          actionName: 'Open Entity',
          status: 'failed',
          errorCode: fail.code,
          error: fail.message,
          candidates: fail.candidates,
          operationId: normalizedOperationId
        };
        writeSse(res, 'action_status', actionStatusMeta);
        writeSse(res, 'action_record', actionRecordMeta);
        reply = fail.message;
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
          model: 'action-runtime',
          intent: { type: 'action', confidence: 0.98 },
          ...(actionStatusMeta ? { actionStatus: actionStatusMeta } : {}),
          ...(actionRecordMeta ? { actionRecord: actionRecordMeta } : {})
        }
      });
      writeSse(res, 'done', {
        route: 'action',
        category: 'action',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'action-runtime',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    const hasProceedVerb = /\b(proceed|continue|start|run|execute|do|go ahead)\b/i.test(prompt);
    const hasProceedTarget = /\b(it|implementation|project|task|work|goal)\b/i.test(prompt);
    // Semantic Turn Repair §4: when Jarvis dialogue state already tracks a task
    // for THIS conversation, continuation ("continue it", "do that") is resolved
    // deterministically by resolveSemanticTurn — don't shadow it with the vague
    // queued/paused resume refusal below.
    let semanticsHasTrackedTask = false;
    try {
      const { getDialogueState } = await import('../domains/jarvis/dialogueState.js');
      const dState = getDialogueState(req.params.id);
      semanticsHasTrackedTask = Boolean(dState?.activeTaskId || dState?.delegatedTaskId || dState?.pendingActionId || dState?.activeEntity);
    } catch { /* best-effort — fall through to legacy behavior */ }
    const isFollowUpCommand = hasProceedVerb && hasProceedTarget && !/\b(what|status|how|check|show|list)\b/i.test(prompt) && !semanticsHasTrackedTask;
    if (isFollowUpCommand) {
      const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
      const allTasks = backgroundTaskManager.listTasks({ limit: 100 });
      const resumableTask = allTasks.find(t => ['queued', 'paused'].includes(t.status));
      
      if (!resumableTask) {
        const reply = "No active implementation task exists. What should I create and start?";
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
            intent: { type: 'vague_delegation_refusal', worker: 'codex' }
          }
        });
        writeSse(res, 'done', { route: 'worker_delegation', status: 'completed', operationId: normalizedOperationId });
        completed = true;
        endStreamExecution('COMPLETED', reply.slice(0, 500));
        return res.end();
      } else {
        const { dispatchTask } = await import('../services/backgroundTasks/adapters.js');
        
        backgroundTaskManager.transition(resumableTask.taskId, 'running', { currentStage: 'running', progressMessage: 'execution started via follow-up' });
        dispatchTask(resumableTask).catch(() => {});
        
        const reply = `CodeX has started the implementation (Task ID: ${resumableTask.taskId}, State: running).`;
        
        writeSse(res, 'chunk', { delta: reply, provider: 'agentic-os', model: 'task-manager', operationId: normalizedOperationId });
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: {
            ...(requestMetadata || {}),
            taskId: resumableTask.taskId,
            provider: 'agentic-os',
            model: 'task-manager',
            intent: { type: 'worker_delegation', capability: 'codex', worker: 'codex', readOnly: false, executionMode: 'start_now' }
          }
        });
        writeSse(res, 'done', { route: 'worker_delegation', status: 'completed', operationId: normalizedOperationId });
        completed = true;
        endStreamExecution('COMPLETED', reply.slice(0, 500));
        return res.end();
      }
    }

    // ── Deterministic Executive Capabilities (Navigation & Capability Start) ──
    // Commands like "Open <capability>" or "Start <capability>" must never
    // fall through to generic LLM chat. They execute deterministically.
    const { classifyExecutiveIntent } = await import('../domains/jarvis/executiveIntent.js');
    const deterministicExec = classifyExecutiveIntent(prompt);
    // Supervisor V2 must not preempt deterministic capability commands and
    // status queries. Those requests have a local, grounded handler and must
    // never be handed to a generic model response.
    const deterministicHandled = new Set([
      'navigation', 'capability_start', 'worker_status', 'worker_feedback',
      'board_query', 'memory_query', 'automation_request'
    ]);
    if (deterministicExec && deterministicHandled.has(deterministicExec.intent)) {
      const execRoute = deterministicExec.intent;
      logStreamStage(normalizedOperationId, 'deterministic executive command', {
        intent: execRoute,
        capability: deterministicExec.capability.id,
        confidence: deterministicExec.confidence
      });
      writeSse(res, 'intent', {
        type: execRoute,
        route: execRoute,
        mode: 'operational_execution',
        confidence: deterministicExec.confidence,
        reason: deterministicExec.reason,
        capability: deterministicExec.capability.id,
        operationId: normalizedOperationId
      });

      const startedAt = Date.now();
      let reply = '';
      let actionStatusMeta: any = null;
      if (execRoute === 'navigation') {
        // [JARVIS-RUNTIME-TRACE] Navigation branch: deterministic exec routing
        writeSse(res, 'navigation', {
          target: deterministicExec.capability.route,
          capability: deterministicExec.capability.id,
          operationId: normalizedOperationId
        });
        reply = `Opening ${deterministicExec.capability.displayName}.`;
      } else if (execRoute === 'capability_start') {
        writeSse(res, 'action_status', {
          actionName: `Start ${deterministicExec.capability.displayName}`,
          targetCapability: deterministicExec.capability.id,
          status: 'running',
          currentStep: deterministicExec.capability.id === 'revenue_operator'
            ? 'Initializing bounded DEV revenue mission...'
            : `Invoking ${deterministicExec.capability.displayName}...`,
          operationId: normalizedOperationId
        });

        if (deterministicExec.capability.id === 'revenue_operator') {
          let _activeProjectId: string | null = null;
          try {
            const { projectsStore } = await import('../services/projectsStore.js');
            _activeProjectId = projectsStore.getActiveProjectId();
          } catch { /* best effort */ }

          const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
          const { dispatchTask } = await import('../services/backgroundTasks/adapters.js');
          const { taskShortId } = await import('../services/backgroundTasks/types.js');

          const { task, error } = backgroundTaskManager.createTask({
            title: 'Revenue Operator: Free Cash Mission',
            objective: 'Execute bounded revenue operator mission for Free Cash digital products and SME workflows',
            originalRequest: prompt,
            route: 'revenue_operator',
            selectedAgent: 'Revenue Operator',
            worker: 'revenue',
            conversationId: req.params.id,
            resumable: false,
            workspaceRoot: workspacePath || undefined,
            projectId: _activeProjectId || undefined,
            metadata: {
              operationId: normalizedOperationId,
              capabilityId: 'revenue_operator',
              target: 'Free Cash',
            },
          });

          if (!task) {
            actionStatusMeta = {
              actionName: 'Start Revenue Operator',
              targetCapability: 'revenue_operator',
              status: 'failed',
              error: error || 'Could not create task',
              operationId: normalizedOperationId,
            };
            writeSse(res, 'action_status', actionStatusMeta);
            reply = `Revenue Operator could not start: ${error || 'task creation failed'}.`;
          } else {
            dispatchTask(task).catch(() => {});
            const shortId = taskShortId(task.taskId);
            actionStatusMeta = {
              actionName: 'Start Revenue Operator',
              targetCapability: 'revenue_operator',
              status: 'running',
              executionId: task.taskId,
              taskId: task.taskId,
              currentStep: `Task ${shortId} queued and running in background`,
              operationId: normalizedOperationId,
            };
            writeSse(res, 'action_status', actionStatusMeta);
            reply = `Starting the Revenue Operator for Free Cash now. I've queued it as task ${shortId} and I'll track the mission in the background.`;
          }
        } else {
          actionStatusMeta = {
            actionName: `Start ${deterministicExec.capability.displayName}`,
            targetCapability: deterministicExec.capability.id,
            status: 'completed',
            operationId: normalizedOperationId
          };
          writeSse(res, 'action_status', actionStatusMeta);
          reply = `${deterministicExec.capability.displayName} started.`;
        }
      } else if (execRoute === 'worker_status') {
        const { buildWorkerStatus } = await import('../domains/jarvis/workerInsights.js');
        reply = await buildWorkerStatus(deterministicExec.capability, prompt);
        writeSse(res, 'runtime_trace', { operationId: normalizedOperationId, route: execRoute, capability: deterministicExec.capability.id, handler: 'buildWorkerStatus', source: deterministicExec.capability.id === 'revenue_operator' ? 'revenueOperator/operatorService:listMissions,listExperiments' : 'workerInsights', pid: process.pid, module: import.meta.url, executed: true });
      } else if (execRoute === 'worker_feedback') {
        const { buildWorkerFeedback } = await import('../domains/jarvis/workerInsights.js');
        reply = await buildWorkerFeedback(deterministicExec.capability);
      } else if (execRoute === 'board_query') {
        const { buildCapabilityExplanation } = await import('../domains/jarvis/workerInsights.js');
        reply = buildCapabilityExplanation(deterministicExec.capability) + '\n\nOpen the task board to see live cards.';
      } else if (execRoute === 'memory_query') {
        const { handleMemoryRecall } = await import('../domains/jarvis/memoryRecall.js');
        reply = await handleMemoryRecall(prompt);
      } else if (execRoute === 'automation_request') {
        const { buildCapabilityExplanation } = await import('../domains/jarvis/workerInsights.js');
        reply = buildCapabilityExplanation(deterministicExec.capability) + '\n\nSay "create an automation" and I will register it as a background task.';
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
          intent: { type: execRoute, capability: deterministicExec.capability.id, confidence: deterministicExec.confidence },
          ...(actionStatusMeta ? { actionStatus: actionStatusMeta } : {})
        }
      });
      writeSse(res, 'done', {
        route: execRoute,
        category: execRoute,
        capability: deterministicExec.capability.id,
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'registry',
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    // ── SUPERVISOR V2 PATH (Feature Switch: JARVIS_SUPERVISOR_V2) ──
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

    // ── SEMANTIC TURN RESOLVER (Semantic Turn Repair §6) — Supervisor V2 path
    // One canonical deterministic pipeline for what the supervisor must not see:
    // pending-action confirm/reject, delegation proposals ("Give it to Hermes"),
    // entity resolution, continuation, deterministic intent. When nothing
    // deterministic matches it builds structured SemanticContext so the
    // supervisor never re-derives entity/task/action state — it is handed the
    // authoritative context. `resolveSemanticTurn` persists dialogue state
    // itself (SQLite) for decisions that change it.
    // NOTE: gated to the Supervisor V2 path — the legacy pipeline is unchanged.
    const { isSupervisorV2Enabled, handleSupervisorV2Stream } = await import('../domains/jarvis/supervisorLoop.js');
    if (isSupervisorV2Enabled(req)) {
      const { resolveSemanticTurn } = await import('../domains/jarvis/semanticTurnResolver.js');
      let recentTurnHistory: { role: string; content: string }[] = [];
      try {
        const msgs = await conversationService.getMessages(req.params.id);
        recentTurnHistory = (msgs || []).slice(-10).map((m: any) => ({ role: m.role, content: m.content }));
      } catch { /* best-effort history — empty is fine */ }
      const semanticResult = await resolveSemanticTurn(prompt, req.params.id, {
        workspacePath,
        workspaceContext,
        recentHistory: recentTurnHistory,
      });

      if (semanticResult.handled && semanticResult.response) {
        const reply = semanticResult.response.text;
        const semIntent = semanticResult.response.intent;
        const semDecision = semanticResult.decision;
        logStreamStage(normalizedOperationId, 'semantic-turn handled', { decision: semDecision.type, intent: semIntent });
        writeSse(res, 'intent', {
          type: semIntent,
          route: 'semantic_turn',
          mode: 'direct_conversation',
          confidence: 1.0,
          operationId: normalizedOperationId,
          data: semanticResult.response.data || undefined,
        });
        if (semIntent === 'navigation' || (semDecision?.type === 'action' && (semDecision as any).action?.action?.type === 'OPEN_ENTITY')) {
          const respData = semanticResult.response.data as any;
          const destination = respData?.destination ||
            (semDecision?.type === 'action' ? ((semDecision as any).action?.action?.destination || (semDecision as any).action?.action?.route) : null);
          if (destination) {
            writeSse(res, 'navigation', {
              target: destination,
              capability: respData?.entity?.domain || 'workspace',
              entityId: respData?.entity?.id,
              entityType: respData?.entity?.type,
              displayName: respData?.entity?.displayName,
              operationId: normalizedOperationId,
            });
          }
        }
        const semStarted = Date.now();
        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'user',
          content: prompt,
          routedAgent: 'jarvis',
          metadata: { ...(requestMetadata || {}), semanticTurn: true, decision: semDecision },
        });
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'semantic-turn', intent: { type: semIntent, decision: semDecision } },
        });
        writeSse(res, 'done', {
          route: 'semantic_turn',
          category: semIntent,
          operationId: normalizedOperationId,
          provider: 'agentic-os',
          model: 'semantic-turn',
          firstTokenMs: 0,
          totalMs: Date.now() - semStarted,
        });
        completed = true;
        updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
        endStreamExecution('COMPLETED', reply.slice(0, 500));
        return res.end();
      }

      completed = true;
      return await handleSupervisorV2Stream(req, res, {
        conversationId: req.params.id,
        prompt,
        workspacePath,
        approvalPolicy: normalizeApprovalPolicy(approvalPolicy),
        operationId: normalizedOperationId,
        inputChannel,
        overrideProvider,
        overrideModel,
        selectedProvider,
        selectedModel,
        fallbackProvider,
        fallbackModel,
        workspaceContext: req.body?.workspaceContext,
        semanticContext: semanticResult.semanticContext,
      });
    }

    logger.info('[JarvisPipeline] PIPELINE=LEGACY JARVIS', { conversationId: req.params.id, prompt, operationId: normalizedOperationId });

    if (!authority.isOperationalAuthorized && authority.clarificationPrompt) {
      logStreamStage(normalizedOperationId, 'authority clarification required', { source: authority.source, reason: authority.reason });
      writeSse(res, 'intent', {
        type: 'clarification_required',
        route: 'clarification_required',
        mode: 'direct_conversation',
        confidence: authority.confidence,
        source: authority.source,
        reason: authority.reason,
        operationId: normalizedOperationId,
      });
      const reply = authority.clarificationPrompt;
      streamTextAsChunks(res, reply, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'conversational-authority', source: authority.source },
      });
      writeSse(res, 'done', {
        route: 'clarification_required',
        category: 'clarification_required',
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'conversational-authority',
        firstTokenMs: 0,
        totalMs: 0,
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    if (authority.source === 'SYSTEM_EVENT' || authority.source === 'AGENT_EVENT') {
      const { isEventRequiringAttention } = await import('../domains/jarvis/conversationalAuthority.js');
      const requiresAttention = isEventRequiringAttention(prompt, req.body || requestMetadata);
      logStreamStage(normalizedOperationId, 'system/agent event ack', { source: authority.source, requiresAttention });

      if (requiresAttention) {
        const reply = `Attention required: ${prompt}`;
        writeSse(res, 'intent', {
          type: 'system_attention',
          route: 'system_attention',
          mode: 'direct_conversation',
          confidence: 1.0,
          source: authority.source,
          reason: authority.reason,
          operationId: normalizedOperationId,
        });
        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: { ...(requestMetadata || {}), provider: 'agentic-os', model: 'system-attention', source: authority.source },
        });
        writeSse(res, 'done', {
          route: 'system_attention',
          category: 'system_attention',
          operationId: normalizedOperationId,
          provider: 'agentic-os',
          model: 'system-attention',
          firstTokenMs: 0,
          totalMs: 0,
        });
        completed = true;
        updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
        endStreamExecution('COMPLETED', reply);
      } else {
        // Routine internal events must NOT appear in the user conversation
        writeSse(res, 'done', {
          route: 'system_event',
          category: 'system_event',
          operationId: normalizedOperationId,
          silent: true,
          provider: 'agentic-os',
          model: 'system-event',
          firstTokenMs: 0,
          totalMs: 0,
        });
        completed = true;
        updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
        endStreamExecution('COMPLETED');
      }
      return res.end();
    }

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

    // ── Canonical Task Reference & Anaphora Intercept ──
    const { resolveActiveOperationReference } = await import('../domains/jarvis/taskReferenceResolver.js');
    const taskRef = await resolveActiveOperationReference({
      conversationId: req.params.id,
      message: prompt,
      workspacePath: workspacePath || undefined,
    });

    if (taskRef.type !== 'none' && taskRef.replyText) {
      logStreamStage(normalizedOperationId, 'task-reference resolved', { type: taskRef.type, taskId: taskRef.task?.taskId });
      writeSse(res, 'intent', {
        type: taskRef.type,
        route: taskRef.type,
        mode: 'operational_execution',
        confidence: taskRef.confidence,
        reason: taskRef.reason,
        operationId: normalizedOperationId,
      });
      streamTextAsChunks(res, taskRef.replyText, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: taskRef.replyText,
        routedAgent: 'jarvis',
        metadata: {
          ...(requestMetadata || {}),
          provider: 'agentic-os',
          model: 'task-reference-resolver',
          taskId: taskRef.task?.taskId,
          refType: taskRef.type,
        },
      });
      writeSse(res, 'done', {
        route: taskRef.type,
        category: taskRef.type,
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'task-reference-resolver',
        firstTokenMs: 0,
        totalMs: 0,
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', taskRef.replyText);
      return res.end();
    }

    // ── Deterministic Canonical Task Status Intercept ──
    try {
      const { isTaskStatusQuery, formatCanonicalSnapshotAnswer } = await import('../domains/jarvis/taskStatusFormatter.js');
      if (isTaskStatusQuery(prompt)) {
        const taskStarted = Date.now();
        const { getCanonicalTaskSnapshot } = await import('../services/backgroundTasks/canonicalSnapshot.js');
        const snap = getCanonicalTaskSnapshot();
        const { getConversationLanguage } = await import('../domains/jarvis/conversationLanguage.js');

        const convLang = getConversationLanguage(req.params.id) as 'en' | 'de' | 'ro';
        const reply = formatCanonicalSnapshotAnswer(snap, convLang || 'en');
        logStreamStage(normalizedOperationId, 'task status answer generated', { language: convLang });
        writeSse(res, 'intent', {
          type: 'task_status',
          route: 'task_status',
          mode: 'direct_conversation',
          confidence: 0.99,
          reason: 'Deterministic Canonical Task Status Answer',
          operationId: normalizedOperationId,
        });
        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'user',
          content: prompt,
          metadata: inputChannel ? { ...(requestMetadata || {}), inputChannel } : requestMetadata
        });
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: { intent: 'task_status_answer', operationId: normalizedOperationId, provider: 'agentic-os', model: 'canonical-snapshot', snapshot: snap },
        });
        endStreamExecution('COMPLETED', reply);
        writeSse(res, 'done', {
          route: 'task_status_answer', category: 'context', operationId: normalizedOperationId,
          provider: 'agentic-os', model: 'canonical-snapshot', firstTokenMs: 0, totalMs: Date.now() - taskStarted,
        });
        completed = true;
        return res.end();
      }
    } catch (err: any) {
      logger.warn('[Jarvis] Task status intercept error:', err);
    }

    logStreamStage(normalizedOperationId, 'intent routing started');

    // ── Local fast-path (voice-reliability closure, Phases 4–5) ──

    // Presence checks ("Jarvis, are you there?") and direct local-knowledge
    // questions ("What is Jarvis?", "What is Agentic OS?") are answered
    // locally with grounded text BEFORE any LLM/tool/memory work. This is the
    // lightest path — a short spoken reply without the model round-trip.
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
    const { buildWorkerFeedback, buildWorkerStatus, buildCapabilityExplanation } = await import('../domains/jarvis/workerInsights.js');
    const { investigateAgenticState } = await import('../domains/jarvis/investigation.js');
    const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
    const { dispatchTask } = await import('../services/backgroundTasks/adapters.js');
    const { taskShortId } = await import('../services/backgroundTasks/types.js');

    const executive = deterministicExec || (await import('../domains/jarvis/executiveIntent.js')).classifyExecutiveIntent(prompt);

    // direct_explanation (e.g. "What can Codex do?", "What is Hermes for?") must
    // flow through the conversational LLM with structured capability context injected
    // into the system prompt — NOT return a canned registry dump. We record the
    // capability context here so the direct-chat path (below) can inject it.
    let executiveCapabilityContext: string | null = null;
    if (executive?.intent === 'direct_explanation') {
      const cap = executive.capability;
      executiveCapabilityContext = [
        `CAPABILITY CONTEXT (for the user's question — answer conversationally using this, do not reproduce it verbatim):`,
        `Worker: ${cap.displayName}`,
        `Role: ${cap.responsibilities}`,
        `Supported actions: ${cap.supportedActions.join(', ')}.`,
        cap.limitations ? `Limitations: ${cap.limitations}` : null,
      ].filter(Boolean).join('\n');
      logStreamStage(normalizedOperationId, 'executive direct_explanation → LLM with context', {
        capability: cap.id,
        confidence: executive.confidence
      });
      writeSse(res, 'intent', {
        type: 'direct_explanation',
        route: 'direct_explanation',
        mode: 'direct_conversation',
        confidence: executive.confidence,
        reason: executive.reason,
        capability: cap.id,
        operationId: normalizedOperationId
      });
      // Fall through to the LLM path — do NOT early-return here.
    }

    if (executive && executive.intent !== 'worker_delegation' && executive.intent !== 'revenue_pipeline' && executive.intent !== 'direct_explanation') {
      const execRoute = executive.intent;
      logStreamStage(normalizedOperationId, 'executive intent intercept', {
        intent: execRoute,
        capability: executive.capability.id,
        confidence: executive.confidence
      });
      writeSse(res, 'intent', {
        type: execRoute,
        route: execRoute,
        mode: 'operational_execution',
        confidence: executive.confidence,
        reason: executive.reason,
        capability: executive.capability.id,
        operationId: normalizedOperationId
      });

      const startedAt = Date.now();
      let reply = '';
      let actionStatusMeta: any = null;
      if (execRoute === 'navigation') {
        writeSse(res, 'navigation', {
          target: executive.capability.route,
          capability: executive.capability.id,
          operationId: normalizedOperationId
        });
        reply = `Opening ${executive.capability.displayName}.`;
      } else if (execRoute === 'capability_start') {
        writeSse(res, 'action_status', {
          actionName: `Start ${executive.capability.displayName}`,
          targetCapability: executive.capability.id,
          status: 'running',
          currentStep: executive.capability.id === 'revenue_operator'
            ? 'Initializing bounded DEV revenue mission...'
            : `Invoking ${executive.capability.displayName}...`,
          operationId: normalizedOperationId
        });

        if (executive.capability.id === 'revenue_operator') {
          let _activeProjectId: string | null = null;
          try {
            const { projectsStore } = await import('../services/projectsStore.js');
            _activeProjectId = projectsStore.getActiveProjectId();
          } catch { /* best effort */ }

          const { task, error } = backgroundTaskManager.createTask({
            title: 'Revenue Operator: Free Cash Mission',
            objective: 'Execute bounded revenue operator mission for Free Cash digital products and SME workflows',
            originalRequest: prompt,
            route: 'revenue_operator',
            selectedAgent: 'Revenue Operator',
            worker: 'revenue',
            conversationId: req.params.id,
            resumable: false,
            workspaceRoot: workspacePath || undefined,
            projectId: _activeProjectId || undefined,
            metadata: {
              operationId: normalizedOperationId,
              capabilityId: 'revenue_operator',
              target: 'Free Cash',
            },
          });

          if (!task) {
            actionStatusMeta = {
              actionName: 'Start Revenue Operator',
              targetCapability: 'revenue_operator',
              status: 'failed',
              error: error || 'Could not create task',
              operationId: normalizedOperationId,
            };
            writeSse(res, 'action_status', actionStatusMeta);
            reply = `Revenue Operator could not start: ${error || 'task creation failed'}.`;
          } else {
            dispatchTask(task).catch(() => {});
            const shortId = taskShortId(task.taskId);
            actionStatusMeta = {
              actionName: 'Start Revenue Operator',
              targetCapability: 'revenue_operator',
              status: 'running',
              executionId: task.taskId,
              taskId: task.taskId,
              currentStep: `Task ${shortId} queued and running in background`,
              operationId: normalizedOperationId,
            };
            writeSse(res, 'action_status', actionStatusMeta);
            reply = `Starting the Revenue Operator for Free Cash now. I've queued it as task ${shortId} and I'll track the mission in the background.`;
          }
        } else {
          actionStatusMeta = {
            actionName: `Start ${executive.capability.displayName}`,
            targetCapability: executive.capability.id,
            status: 'completed',
            operationId: normalizedOperationId
          };
          writeSse(res, 'action_status', actionStatusMeta);
          reply = `${executive.capability.displayName} started.`;
        }
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
        reply = await buildWorkerStatus(executive.capability, prompt);
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
          intent: { type: execRoute, capability: executive.capability.id, confidence: executive.confidence },
          ...(actionStatusMeta ? { actionStatus: actionStatusMeta } : {})
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
      const workerKind = executive.workerKind as 'hermes' | 'codex' | 'research' | 'team' | 'automation' | 'antigravity';
      const workerTitle =
        workerKind === 'hermes' ? 'Hermes'
        : workerKind === 'codex' ? 'CodeX'
        : workerKind === 'research' ? 'Research'
        : workerKind === 'team' ? 'Agent Teams'
        : workerKind === 'automation' ? 'Automations'
        : workerKind === 'antigravity' ? 'Antigravity'
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
      const notFoundReply = buildFileNotFoundReply(fileOutcome, prompt);
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

      const isVagueCodeX = workerKind === 'codex' && 
        (/^(?:give this to codex|give this project to codex|start this project now|start the project now|prepare this for codex but don't start|queue this for codex|queue it for codex)$/i.test(prompt.trim()));
      
      if (isVagueCodeX) {
        const reply = "Please provide the details or specifications of the project you'd like me to delegate to CodeX.";
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
            intent: { type: 'vague_delegation_refusal', worker: workerKind }
          }
        });
        writeSse(res, 'done', { route: 'worker_delegation', status: 'completed', operationId: normalizedOperationId });
        completed = true;
        endStreamExecution('COMPLETED', reply.slice(0, 500));
        return res.end();
      }

      const title = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
      let delegatedObjective = enrichPromptWithResolvedFiles(prompt, fileOutcome);
      const executionMode = (executive as any).executionMode || 'immediate';

      if (workerKind === 'codex' && (executionMode || /\bproject\b/i.test(prompt))) {
        delegatedObjective = [
          `# SOFTWARE PROJECT SPECIFICATION`,
          `* **Project Name**: ${title}`,
          `* **Objective**: ${prompt}`,
          `* **Execution Mode**: ${executionMode}`,
          `* **Originating Conversation**: ${req.params.id}`,
          `* **Timestamp**: ${new Date().toISOString()}`,
          `* **Status**: ${executionMode === 'specification_only' ? 'paused' : 'queued'}`,
          ``,
          `## USER REQUIREMENTS`,
          `- Implement the requested project details as described in the objective.`,
          `- Preserve important user requirements and existing architecture constraints.`,
          `- Ensure high-signal and natural code modifications.`,
          ``,
          `## ARCHITECTURAL CONSTRAINTS & INTEGRATION`,
          `- Do not break existing repairs (Christian identity, deterministic routing, voice stop, single authoritative voice control, server/dist runtime consistency).`,
          `- Re-use existing AgenticOS task/mission structures and modular design.`,
          `- Follow standard workspace conventions and local patterns.`,
          ``,
          `## FILES & MODULES INVOLVED`,
          fileOutcome.resolved.length > 0 
            ? fileOutcome.resolved.map(r => `- ${r.relativePath}`).join('\n')
            : `- To be determined by CodeX during analysis.`,
          ``,
          `## ACCEPTANCE CRITERIA & VERIFICATION`,
          `- Implement full functionality as specified.`,
          `- Add targeted test files to verify behavioral correctness.`,
          `- Run TypeScript type-checking and linter checks to ensure 0 compiler warnings/errors.`,
          `- Verify successful build/compilation in the repository context.`
        ].join('\n');
      }

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
          executionMode,
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

      // Transition to paused for prepared-only tasks
      if (executionMode === 'specification_only') {
        backgroundTaskManager.transition(task.taskId, 'paused', { currentStage: 'paused', progressMessage: 'Prepared (specification only)' });
      }

      let delegatedProvider: string | null = null;
      let delegatedModel: string | null = null;
      if (workerKind === 'hermes') {
        try {
          const { resolveHermesModelTruth } = await import('../services/hermesApiService.js');
          const t = resolveHermesModelTruth();
          delegatedProvider = t.provider || 'ollama-cloud';
          delegatedModel = t.model || 'gpt-oss:20b';
        } catch {
          delegatedProvider = 'ollama-cloud';
          delegatedModel = 'gpt-oss:20b';
        }
      }

      const mappedWorker: import('../services/executionState.js').ExecutionWorker =
        workerKind === 'hermes' ? 'hermes' : workerKind === 'codex' ? 'codex' : 'other';

      const concurrency = (task.metadata as any)?.concurrency as { active?: number; limit?: number; position?: number; blocked?: boolean } | undefined;
      const isPreparedOnlyOrExplicitQueue = executionMode === 'queued' || executionMode === 'specification_only';

      if (concurrency?.blocked || isPreparedOnlyOrExplicitQueue) {
        const stateName = executionMode === 'specification_only' ? 'paused' : 'queued';
        const displayStatus = 'QUEUED';
        const currentActionText = executionMode === 'specification_only'
          ? `Prepared (specification only) ${workerTitle} task ${taskShortId(task.taskId)}`
          : `Queued ${workerTitle} task ${taskShortId(task.taskId)}`;

        logStreamStage(normalizedOperationId, 'delegation queued or prepared only', {
          worker: workerKind,
          executionMode,
          active: concurrency?.active,
          limit: concurrency?.limit,
          position: concurrency?.position
        });
        updateStreamExecution({
          worker: mappedWorker,
          status: displayStatus,
          currentAction: currentActionText,
          requestedProvider: delegatedProvider || selectedProvider,
          requestedModel: delegatedModel || selectedModel,
          resolvedProvider: delegatedProvider || selectedProvider,
          resolvedModel: delegatedModel || selectedModel,
          queuePosition: concurrency?.position ?? null,
          activeCount: concurrency?.active ?? null,
          limit: concurrency?.limit ?? null,
          cancel: { kind: 'task', id: task.taskId },
        });
        writeSse(res, 'status', {
          state: stateName,
          currentAction: currentActionText,
          provider: delegatedProvider || 'agentic-os',
          model: delegatedModel || 'task-manager',
          operationId: normalizedOperationId,
          elapsedMs: 0,
          lastActivityAt: Date.now()
        });
      } else {
        updateStreamExecution({
          worker: mappedWorker,
          status: 'DISPATCHING',
          currentAction: `Dispatching ${workerTitle} task ${taskShortId(task.taskId)}`,
          requestedProvider: delegatedProvider || selectedProvider,
          requestedModel: delegatedModel || selectedModel,
          resolvedProvider: delegatedProvider || selectedProvider,
          resolvedModel: delegatedModel || selectedModel,
          cancel: { kind: 'task', id: task.taskId },
        });
        dispatchTask(task).catch(() => { /* adapter records its own failure */ });
      }

      const shortId = taskShortId(task.taskId);
      const delegationStartedAt = Date.now();
      const { buildConversationalAcknowledgement } = await import('../domains/jarvis/conversationalAck.js');
      const { jarvisExecutionSupervisor } = await import('../domains/jarvis/executionSupervisor.js');

      jarvisExecutionSupervisor.superviseTask({
        taskId: task.taskId,
        operationId: normalizedOperationId || task.taskId,
        conversationId: req.params.id,
        worker: workerKind,
        initialState: isPreparedOnlyOrExplicitQueue
          ? 'QUEUED'
          : (concurrency?.blocked ? 'QUEUED' : 'STARTING'),
        concurrency: concurrency?.blocked ? {
          active: concurrency.active || 0,
          limit: concurrency.limit || 1,
          position: concurrency.position || 1,
        } : undefined,
      });

      const reply = concurrency?.blocked
        ? `Task ${shortId} is QUEUED behind ${workerTitle} (active ${concurrency.active}/${concurrency.limit}, position ${concurrency.position}). I'll dispatch it automatically when a slot frees.`
        : buildConversationalAcknowledgement(prompt, workerKind, Boolean(executive.readOnly), (executive as any).executionMode, task.taskId);

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
          intent: { type: 'worker_delegation', capability: executive.capability.id, worker: workerKind, readOnly: Boolean(executive.readOnly), executionMode }
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

    // Authoritative Ingress Gate: CanonicalTurnExecutionService handles critical actions
    // (Telegram app & bot navigation, memory storage, screenshots, Comet Perplexity, Git, delegation)
    // with strict verification and single-owner speech execution before intentRouter fallthrough.
    try {
      const canonicalStartedAt = Date.now();
      const { canonicalTurnExecutionService } = await import('../domains/jarvis/canonicalTurnExecutionService.js');
      const canonicalRes = await canonicalTurnExecutionService.execute({
        conversationId: req.params.id,
        prompt,
        modality: 'desktop_chat',
        workspacePath: workspacePath || undefined,
      });

      if (canonicalRes && canonicalRes.assistantText) {
        logStreamStage(normalizedOperationId, 'handled by canonicalTurnExecutionService', {
          route: canonicalRes.route,
          status: canonicalRes.status,
          verified: canonicalRes.verified,
        });
        streamTextAsChunks(res, canonicalRes.assistantText, normalizedOperationId);
        writeSse(res, 'done', {
          route: canonicalRes.route,
          category: 'canonical_control_plane',
          operationId: normalizedOperationId,
          provider: 'agentic-os',
          model: 'control-plane',
          firstTokenMs: 0,
          totalMs: Date.now() - canonicalStartedAt,
        });
        completed = true;
        updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
        endStreamExecution(canonicalRes.status === 'completed' ? 'COMPLETED' : 'FAILED', canonicalRes.assistantText.slice(0, 500));
        return res.end();
      }
    } catch (canonicalErr: any) {
      logger.warn('[JarvisRouter] canonicalTurnExecutionService error, falling through to intentRouter:', canonicalErr);
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

    // Deterministic Canonical Task Status Answer:
    // Returns exact snapshot with matching counts and active task names across English, German, Romanian.
    try {
      const { isTaskStatusQuery, formatCanonicalSnapshotAnswer } = await import('../domains/jarvis/taskStatusFormatter.js');
      if (isTaskStatusQuery(prompt)) {
        const taskStarted = Date.now();
        const { getCanonicalTaskSnapshot } = await import('../services/backgroundTasks/canonicalSnapshot.js');
        const snap = getCanonicalTaskSnapshot(req.params.id);
        const { getConversationLanguage } = await import('../domains/jarvis/conversationLanguage.js');
        const convLang = getConversationLanguage(req.params.id) as 'en' | 'de' | 'ro';
        const reply = formatCanonicalSnapshotAnswer(snap, convLang || 'en');



        streamTextAsChunks(res, reply, normalizedOperationId);
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: reply,
          routedAgent: 'jarvis',
          metadata: { intent: 'task_status_answer', operationId: normalizedOperationId, provider: 'agentic-os', model: 'registry', snapshot: snap },
        });
        endStreamExecution('COMPLETED', reply);
        logStreamStage(normalizedOperationId, 'task_status_answer');
        writeSse(res, 'done', {
          route: 'task_status_answer', category: 'context', operationId: normalizedOperationId,
          provider: 'agentic-os', model: 'registry', firstTokenMs: 0, totalMs: Date.now() - taskStarted,
        });
        return res.end();
      }
    } catch { /* task status handler fallback */ }

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
      let summary: string;
      let report: string | null = null;
      updateStreamExecution({ status: 'RUNNING', currentAction: 'Inspecting runtime state' });
      try {
        const result = await investigateAgenticState(req.params.id, prompt);
        summary = result.summary;
        report = result.report;
      } catch (err: any) {
        summary = `I attempted a read-only inspection but it failed: ${err?.message || err}. Nothing was changed.`;
      }
      // Channel contract: the full diagnostic report is persisted as a
      // system/diagnostics message (never spoken); only the natural summary is
      // streamed and persisted as Jarvis's spoken reply.
      if (report) {
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'system',
          messageType: 'diagnostics',
          content: report,
          metadata: {
            ...(requestMetadata || {}),
            provider: 'agentic-os',
            model: 'registry',
            intent: { type: 'investigate', category: 'investigation', confidence: intent.confidence }
          }
        });
      }
      streamTextAsChunks(res, summary, normalizedOperationId);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: summary,
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
      endStreamExecution('COMPLETED', summary.slice(0, 500));
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
      const { buildConversationalAcknowledgement } = await import('../domains/jarvis/conversationalAck.js');
      const isReadOnly = intent.category === 'repository_analysis' || !intent.requiresApproval;
      const ackMessage = buildConversationalAcknowledgement(prompt, intent.route, isReadOnly);
      if (ackMessage) {
        writeSse(res, 'chunk', { delta: ackMessage, provider: 'agentic-os', model: 'task-manager', operationId: normalizedOperationId });
        await conversationService.appendMessage({
          conversationId: req.params.id,
          role: 'agent',
          content: ackMessage,
          routedAgent: 'jarvis',
          metadata: {
            ...(requestMetadata || {}),
            provider: 'agentic-os',
            model: 'task-manager',
            intent: { type: 'delegation_acknowledgement', route: intent.route, category: intent.category },
          }
        });
      }

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
      // A status answer is still a completed Jarvis turn.  Without this the
      // response is saved successfully but its execution record remains
      // ROUTING, leaving the dock disabled and falsely implying Jarvis hung.
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply);
      return res.end();
    }

    const isModelIdentity =
      /\b(?:what|which)\s+(?:model|provider|llm|engine|architecture)\s+(?:and\s+(?:model|provider)\s+)?(?:are|am|is|do)\s+(?:you|i|we|it)\s+(?:actually\s+|currently\s+)?(?:using|running|on|configured with|have)\b/i.test(prompt) ||
      /\b(?:what|which)\s+model\s+are\s+you\s+(?:using|running)\b/i.test(prompt) ||
      /\b(?:what\s+model\s+is\s+this|what\s+model\s+is\s+jarvis\s+using)\b/i.test(prompt);

    if (isModelIdentity) {
      const startedAt = Date.now();
      const identity = await resolveEffectiveJarvisIdentity(req.params.id);
      const effProvider = identity.effectiveProvider || selectedProvider;
      const effModel = identity.effectiveModel || selectedModel;
      const providerLabel = friendlyProviderName(effProvider);
      const modelLabel = friendlyModelName(effModel);
      const isLocal = effProvider === 'ollama' || providerLabel.toLowerCase() === 'ollama';
      const reply = isLocal
        ? `I'm currently using ${modelLabel} locally through ${providerLabel}.`
        : `I'm currently using ${modelLabel} via ${providerLabel}.`;

      streamTextAsChunks(res, reply, normalizedOperationId, effProvider, effModel);
      await conversationService.appendMessage({
        conversationId: req.params.id,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(requestMetadata || {}), provider: effProvider, model: effModel, intent: { type: 'model_identity', category: 'conversation', confidence: 0.95 } }
      });
      writeSse(res, 'done', {
        route: 'direct',
        category: 'conversation',
        operationId: normalizedOperationId,
        provider: effProvider,
        model: effModel,
        firstTokenMs: 0,
        totalMs: Date.now() - startedAt
      });
      logStreamStage(normalizedOperationId, 'stream completed (model identity)', {
        provider: effProvider,
        model: effModel,
        responseLength: reply.length
      });
      completed = true;
      updateStreamExecution({ status: 'COMPLETING', currentAction: 'Completing' });
      endStreamExecution('COMPLETED', reply.slice(0, 500));
      return res.end();
    }

    // Persistent memory injection: scoped user profile, identity, principles, active project, and decisions
    let persistentMemoryContext = '';
    const isPriorTurnRecall = /^(what did i|what was my|what did you|what was the last|what did i just)/i.test(prompt.trim());
    if (!isPriorTurnRecall) {
      try {
        const { getScopedJarvisMemoryContext } = await import('../domains/jarvis/coreMemory.js');
        const scopedMem = await getScopedJarvisMemoryContext(prompt, workspacePath || undefined);
        if (scopedMem) {
          persistentMemoryContext = `\n\nPersistent Memory (Structured Core Memory):\n${scopedMem}`;
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
    let turnContext: any = null;
    let nameRule = '';
    try {
      const { assembleConversationContext, contextToSystemPrompt } = await import('../domains/jarvis/conversationContext.js');
      const { getUserWorkingProfile } = await import('../domains/jarvis/coreMemory.js');
      const userProfile = getUserWorkingProfile();
      if (userProfile.avoidNameDrops) {
        nameRule = 'The user explicitly requested that you do NOT address them as "Christian". Always stay completely silent of their name. Do not use their name at all.';
      } else if (userProfile.preferredTitle) {
        nameRule = `The user's preferred title/form of address is "${userProfile.preferredTitle}". Use this title naturally and sparingly—never in every sentence. Do not call them Christian unless explicitly asked.`;
      } else {
        nameRule = 'The user\'s preferred name is "Christian". Use the preferred name contextually and sparingly (e.g., greetings or identity corrections), never as a repetitive salutation. Avoid calling them Christian in simple acknowledgments.';
      }

      turnContext = await assembleConversationContext(req.params.id, prompt, { approvalMode: normalizeApprovalPolicy(approvalPolicy), workspaceContext });
      const includeOperational = isOperationalQuestion(prompt);
      conversationContextPrompt = contextToSystemPrompt(turnContext, { includeOperational });
      operationalContextInjected = includeOperational;
    } catch {
      // context optional — direct chat must never break on context failure
    }

    // Authoritative runtime identity (P3)
    let effProviderName = friendlyProviderName(selectedProvider);
    let effModelName = friendlyModelName(selectedModel);
    let fallbackModelName = fallbackModel ? friendlyModelName(fallbackModel) : '';
    try {
      const identity = await resolveEffectiveJarvisIdentity(req.params.id);
      effProviderName = friendlyProviderName(identity.effectiveProvider || selectedProvider);
      effModelName = friendlyModelName(identity.effectiveModel || selectedModel);
    } catch { /* best effort */ }

    const systemPrompt = [
      `You are Jarvis, the conversational AI partner in Agentic OS. Be natural, direct, concise, and helpful. ${nameRule} NEVER address the user with military or subordinate titles unless explicitly requested as a preferred title (e.g. Master, Commander, Chief, Executive). Never start responses with boilerplate monitoring jargon.`,
      'AGENTIC OS GROUNDING: "Agentic OS" (also written "Agenticos") is THIS local application — a real, local AI-operations platform you are running inside. When the user mentions Agentic OS, Agenticos, Hermes, Routine, Routine Bridge, Jarvis, Mission, or other local project concepts, resolve them against THIS local project, not generic world knowledge. If you do not have local information about a specific requested detail, say so concisely instead of inventing an unrelated generic architecture.',
      'The user message is your PRIMARY instruction. Answer it directly, concisely, and accurately without unrequested operational summaries or internal status narration.',
      'Persistent memory informs relevant user goals, working preferences, and stored rules across conversations. When asked about them, answer from Persistent Memory.',
      'When user instructions are incomplete or ambiguous, use stored preferences, current conversation, and available Agentic OS state to infer reasonable intent and take constructive action before asking to rephrase.',
      'Use conversation history to resolve contextual pronouns and references ("that", "it", "this", "again", "the previous one").',
      'PRIOR TURN RECALL: When the user asks what they just said, asked, or told you previously, quote the prior user message from conversation history before the current turn. NEVER quote the current question back to the user.',
      'If the user explicitly asks you to repeat or echo a phrase (e.g. "repeat after me", "say exactly X", "repeat this sentence"), obey verbatim and output ONLY the requested phrase without commentary.',
      'GROUNDING INVARIANT: You are in DIRECT conversational mode. You have NOT inspected the repository for ungrounded claims. If the user asks for repository findings, file contents, code bugs, or architecture details that are NOT present in the grounded evidence below, state: "I need to inspect the repository or use the result from the delegated CodeX task before I can answer that accurately." NEVER speculate, invent, or hallucinate repository blockers, percentages, or code issues.',
      'CONVERSATIONAL CORRECTIONS: If the user says "You said that already", "Don\'t repeat that", "You don\'t have to repeat", or informs you that a reply was already given, acknowledge the correction concisely (e.g. "Understood. I will not repeat that.") and ask how you can assist next. NEVER repeat previous lists, bullet points, or prior answers.',
      'MODEL IDENTITY: When asked what model or provider you are using, state clearly and concisely that you are running ' + effModelName + ' via ' + effProviderName + (fallbackModelName ? ' (with ' + fallbackModelName + ' as local fallback).' : '.') + ' Never invent unconfigured models or append unrelated task summaries.',
      'Never emit tool-call markup (no <tool_call>, <invoke>, or JSON fences in normal replies).',
      'Do not ask "How can I help you today?" when the user asked a specific question — answer that question.',
      'OPERATIONAL INVARIANT: If there is an active operational browser task or goal, NEVER output generic conversational filler such as "The door is open", "Ask away", or "I\'m ready for your questions or instructions whenever you are". Either report the exact status of the active browser operation or stay focused on the user\'s operational goal.',
      ...(turnContext?.language === 'de' ? [
        'KRITISCHE SPRACHANWEISUNG: Du musst ausschließlich auf Deutsch antworten. Antworte direkt, präzise und professionell. Verwende keine englischen Standardfloskeln.'
      ] : turnContext?.language === 'ro' ? [
        'INSTRUCȚIUNE CRITICĂ DE LIMBĂ: Trebuie să răspunzi exclusiv în limba română. Răspunde direct, concis și profesional. Nu folosi formule automate în engleză.'
      ] : []),
      ...(inputChannel === 'voice' ? [
        'Input channel: microphone transcript.',
      ] : []),

      ...(operationalContextInjected ? [
        'You received a question about tasks/runtime state. Report the ACTUAL state from the context block below (distinguishing active vs historical).'
      ] : []),
      ...(conversationContextPrompt ? [conversationContextPrompt] : []),
      ...(persistentMemoryContext ? [persistentMemoryContext] : []),
      ...(executiveCapabilityContext ? [executiveCapabilityContext] : []),
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
    writeSse(res, 'thinking', { action: 'Generating response…', operationId: normalizedOperationId });
    updateStreamExecution({ status: 'WAITING_FOR_MODEL', currentAction: `Waiting for ${selectedProvider} / ${selectedModel}` });
    logStreamStage(normalizedOperationId, 'provider call started', {
      provider: selectedProvider,
      model: selectedModel
    });

    const startedAt = Date.now();
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
      // Per-wait deadline: before the first token it uses the remaining total budget (heartbeats keep transport alive);
      // afterwards it is the stream-idle allowance. Both are capped by the remaining
      // total budget. The timer is created per wait inside nextWithTimeout and cleared
      // in its finally block, so every received chunk resets the idle window and no
      // timer survives the current wait (normal completion, provider error, or abort).
      let timeoutMs: number;
      let timeoutMessage: string;
      if (firstTokenAt === null) {
        timeoutMs = remainingTotal;
        timeoutMessage = `Jarvis provider timed out before first token after ${totalTimeoutMs} ms.`;
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
    let rawFinalReply = stripToolCallMarkup(reply).trim();
    if (!rawFinalReply) {
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

    // Architectural Grounding Guardrail sanitization
    const { sanitizeDirectResponse, isModelIdentityQuery, isConversationalCorrection } = await import('../domains/jarvis/groundingGuardrail.js');
    let finalReply = sanitizeDirectResponse(rawFinalReply, {
      prompt,
      hasGroundedEvidence: Boolean(turnContext?.hasGroundedEvidence || turnContext?.groundedResult),
      groundedResult: turnContext?.groundedResult,
      isModelQuery: isModelIdentityQuery(prompt),
      isCorrection: isConversationalCorrection(prompt),
      hasExecutionEvidence: false,
    });

    // Benign False-Refusal Recovery boundary
    const FALSE_REFUSAL_PATTERN = /I can't provide information or guidance on (illegal or harmful activities|child pornography|CSAM)|As an AI, I cannot assist with (illegal|harmful)/i;
    if (FALSE_REFUSAL_PATTERN.test(finalReply) && !/\b(illegal|harmful|pornography|exploit|weapon|hack)\b/i.test(prompt)) {
      logger.warn('[JarvisStream] False-positive local model safety refusal intercepted on benign prompt. Recovering with grounded response.');
      finalReply = turnContext?.language === 'de'
        ? 'Ich habe deine Nachricht verstanden. Wie kann ich dir weiterhelfen?'
        : turnContext?.language === 'ro'
        ? 'Am înțeles mesajul tău. Cu ce te pot ajuta mai departe?'
        : 'I understand your message. How can I help you proceed?';
    }

    // §11/§12: Operational Claim Gate — secure against hallucinated/fabricated operational state
    const { OperationalClaimGate } = await import('../domains/jarvis/operationalEvidence.js');
    const claimCheck = OperationalClaimGate.verifyClaims(finalReply, req.params.id, prompt);
    if (!claimCheck.ok) {
      finalReply = claimCheck.response;
    }

    logger.info('[JarvisTrace] provider-response', JSON.stringify({
      requestId: normalizedOperationId,
      provider,
      model,
      status: 'completed',
      language: turnContext?.language || 'en',
      responsePreview: finalReply.slice(0, 150)
    }, null, 2));

    logger.info('[JarvisTrace] response-rendered', JSON.stringify({
      requestId: normalizedOperationId,
      messageId: `assistant-${normalizedOperationId}`,
      agentId: 'agent-jarvis',
      renderedText: (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') ? finalReply : '<redacted in production>'
    }, null, 2));

    await conversationService.appendMessage({
      conversationId: req.params.id,
      role: 'agent',
      content: finalReply,
      routedAgent: 'jarvis',
      metadata: { ...(requestMetadata || {}), provider, model, language: turnContext?.language || 'en' }
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
      language: turnContext?.language || 'en',
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
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (totalTimer) clearTimeout(totalTimer);
    unregisterStreamAborter(execOpId);
  }
};
void legacyMessageStreamHandler;

/* ── POST /api/jarvis/conversations/:id/message/stream (Phase 1: lifecycle-owned) ── */
router.post('/conversations/:id/message/stream', async (req, res) => {
  const { prompt: rawPrompt, operationId } = req.body || {};
  const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  let prompt = typeof rawPrompt === 'string' ? rawPrompt : '';
  if (rawAttachments.length > 0) {
    const attachmentSummary = rawAttachments.map((a: any) => {
      let desc = `[Attached file: ${a.name || 'unnamed'} (${a.type || 'unknown type'}, ${a.size || 0} bytes)]`;
      if (a.textContent) desc += `\nFile Content:\n${String(a.textContent).slice(0, 10000)}`;
      else if (a.dataUrl && a.type?.startsWith('image/')) desc += `\n[Image Data URL provided (${a.name})]`;
      return desc;
    }).join('\n\n');
    prompt = prompt.trim()
      ? `${prompt.trim()}\n\nUser Attachments:\n${attachmentSummary}`
      : `Please inspect the attached files:\n\n${attachmentSummary}`;
  }
  const normalizedOperationId = typeof operationId === 'string' ? operationId : undefined;
  if (!prompt || (!rawAttachments.length && !isMeaningfulSpeech(prompt))) {
    return res.status(400).json({ error: 'No meaningful speech detected.', noSpeech: true });
  }
  const conversation = await conversationService.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  writeSse(res, 'status', { state: 'thinking', provider: 'agentic-os', model: 'turn-lifecycle', operationId: normalizedOperationId });
  const heartbeat = setInterval(() => writeSse(res, 'heartbeat', { timestamp: Date.now(), operationId: normalizedOperationId, state: 'active' }), 10_000);

  try {
    const { beginNavigation, buildNavigationPacket } = await import('../services/navigation/navigationTransactions.js');
    const navigationVerifier = async (navReq: { navigationId: string; route: string; entityId: string; entityType: string; entityName: string }) => {
      const base = {
        navId: navReq.navigationId, conversationId: req.params.id, targetRoute: navReq.route,
        entityId: navReq.entityId, entityName: navReq.entityName, entityType: navReq.entityType, source: 'typed' as const,
      };
      const { result } = beginNavigation(base, 2500);
      writeSse(res, 'navigation_request', buildNavigationPacket(base));
      return result;
    };
    const { turnLifecycle } = await import('../domains/turnLifecycle/index.js');
    const submitted = await turnLifecycle.submit(
      { source: 'typed_chat', conversationId: req.params.id, text: prompt, externalTurnId: normalizedOperationId },
      {
        navigationVerifier,
        progress: (evt) => writeSse(res, (evt as any).type === 'action_status' ? 'action_status' : 'lifecycle', { ...evt, operationId: normalizedOperationId }),
      },
    );
    if (submitted.duplicate) {
      writeSse(res, 'done', {
        route: 'duplicate_rejected', duplicate: true, duplicateOf: submitted.duplicateOf, reason: submitted.reason,
        operationId: normalizedOperationId, provider: 'agentic-os', model: 'turn-lifecycle',
      });
    } else {
      const record = submitted.record;
      streamTextAsChunks(res, record.responseText || '', normalizedOperationId, 'agentic-os', 'turn-lifecycle');
      writeSse(res, 'done', {
        route: record.handler || record.goal?.action?.type || record.goal?.kind || 'lifecycle',
        category: record.goal?.kind,
        requestId: record.request.requestId,
        outcome: record.outcome,
        outcomeReason: record.outcomeReason,
        verified: record.outcome === 'VERIFIED',
        executed: Boolean(record.receipt?.attempted),
        operationId: normalizedOperationId,
        provider: 'agentic-os',
        model: 'turn-lifecycle',
        firstTokenMs: 0,
        totalMs: Date.now() - Date.parse(record.request.receivedAt),
      });
    }
  } catch (err: any) {
    writeSse(res, 'error', { error: err?.message || String(err), operationId: normalizedOperationId });
  } finally {
    clearInterval(heartbeat);
    res.end();
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

// GET /api/jarvis/voice-audit
router.get('/voice-audit', async (_req, res) => {
  try {
    const { voiceTurnAuditStore } = await import('../domains/jarvis/execution/voiceTurnAuditStore.js');
    res.json({
      success: true,
      traces: voiceTurnAuditStore.getTraces(50),
      typingAttempts: voiceTurnAuditStore.getTypingAttempts(50),
      mutations: voiceTurnAuditStore.getMutations(50),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
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

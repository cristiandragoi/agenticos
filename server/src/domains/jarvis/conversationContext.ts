/**
 * ConversationContext — ONE explicit context object for every Jarvis turn.
 *
 * Root-cause fix for conversational incoherence: before this module, context
 * was assembled in three different places with different shapes (recentText
 * string for routing, buildConversationHistory for the LLM, recentContext in
 * investigation), and NONE of it carried workspace, active-task, capability,
 * provider, or previous-clarification state. The LLM therefore answered
 * follow-ups ("Can you change that?", "Continue.", "Fix it.") as isolated
 * generic questions.
 *
 * This assembles a compact, bounded context object server-side per turn and
 * exposes it in two forms:
 *  - `toSystemPrompt()`  → a compact factual block for the direct-chat LLM
 *  - `toRouterContext()` → structured hints for intent routing (deictic
 *    resolution, continuation, clarification policy)
 */
import { conversationService } from '../conversations/service.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { getCurrent as getCurrentExecution } from '../../services/executionState.js';
import { CAPABILITY_REGISTRY, capabilitySummaryList } from './capabilityRegistry.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';

export interface ConversationContext {
  conversationId: string;
  currentPrompt: string;
  /** Bounded recent user/Jarvis turns (newest first), used for reference resolution. */
  recentTurns: { role: 'user' | 'assistant'; content: string }[];
  /** The last user message before the current one, if any (the most likely referent). */
  previousUserMessage?: string;
  /** The last Jarvis reply, if any (used for "that"/"it" → previous reply). */
  previousAssistantMessage?: string;
  /** Whether the immediately previous Jarvis turn was a clarification request. */
  previousWasClarification: boolean;
  /** Selected repository/workspace root (canonical), or null. */
  workspaceRoot: string | null;
  /** Active background task / execution, if any. */
  activeTask: { id: string; worker: string; status: string; title: string } | null;
  /** Most recently completed/failed task, if any (history vs active distinction). */
  recentTask: { id: string; worker: string; status: string; title: string } | null;
  /** Provider/model availability (runtime truth). */
  providers: { provider: string; model: string; fallbackProvider: string; fallbackModel: string };
  /** Real registered AgenticOS capabilities (human-readable). */
  capabilities: string;
  /** Approval mode for this turn. */
  approvalMode: 'manual' | 'auto';
  /** Currently active project context (persisted selection). */
  activeProject: { id: string; name: string; description?: string | null } | null;
}

const CLARIFICATION_PATTERN =
  /(could you (rephrase|clarify|repeat|explain)|didn'?t quite understand|i think part of that sentence was transcribed incorrectly|were you still talking about)/i;

function summarizeTask(t: any) {
  if (!t) return null;
  return {
    id: String(t.taskId || t.id || t.operationId || ''),
    worker: String(t.worker || t.selectedAgent || ''),
    status: String(t.status || ''),
    title: String(t.title || t.objective || '').slice(0, 90),
  };
}

export async function assembleConversationContext(
  conversationId: string,
  currentPrompt: string,
  options: { approvalMode?: 'manual' | 'auto' } = {},
): Promise<ConversationContext> {
  const ctx: ConversationContext = {
    conversationId,
    currentPrompt,
    recentTurns: [],
    previousWasClarification: false,
    workspaceRoot: null,
    activeTask: null,
    recentTask: null,
    providers: { provider: 'openrouter', model: 'auto', fallbackProvider: 'ollama', fallbackModel: 'auto' },
    capabilities: '',
    approvalMode: options.approvalMode || 'manual',
    activeProject: null,
  };

  // 1. Recent turns (bounded window, newest first).
  try {
    const msgs = await conversationService.getMessages(conversationId);
    const arr = Array.isArray(msgs) ? msgs : [];
    const turns: { role: 'user' | 'assistant'; content: string }[] = [];
    for (let i = arr.length - 1; i >= 0 && turns.length < 10; i--) {
      const m = arr[i];
      const role = m?.role;
      const content = typeof m?.content === 'string' ? m.content : '';
      if (!content) continue;
      if (role === 'system') continue;
      if (role === 'user' && content === currentPrompt) continue; // current turn
      if (role !== 'user' && role !== 'agent') continue;
      turns.push({ role: role === 'agent' ? 'assistant' : 'user', content });
    }
    ctx.recentTurns = turns;
    for (const t of turns) {
      if (t.role === 'user') { ctx.previousUserMessage = t.content; break; }
    }
    for (const t of turns) {
      if (t.role === 'assistant') { ctx.previousAssistantMessage = t.content; break; }
    }
    // Previous-turn clarification detection (any of the last 4 turns).
    ctx.previousWasClarification = turns.slice(0, 4).some((t) => t.role === 'assistant' && CLARIFICATION_PATTERN.test(t.content));
  } catch { /* best effort */ }

  // 2. Canonical workspace.
  try {
    const ws = await getWorkspaceRoot();
    if (ws) ctx.workspaceRoot = ws;
  } catch { /* best effort */ }

  // 3. Active / recent task state.
  try {
    const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
    const summary = backgroundTaskManager.summary();
    const recent = backgroundTaskManager.listTasks({ limit: 4 }) || [];
    const active = recent.find((t: any) => ['running', 'queued', 'pending'].includes(String(t.status)));
    const completedOrFailed = recent.find((t: any) => ['completed', 'failed', 'cancelled'].includes(String(t.status)));
    ctx.activeTask = summarizeTask(active);
    ctx.recentTask = summarizeTask(completedOrFailed);
  } catch { /* best effort */ }
  try {
    const current = getCurrentExecution();
    if (current && current.operationId && current.status && current.status !== 'COMPLETED' && current.status !== 'FAILED' && current.status !== 'CANCELLED') {
      ctx.activeTask = ctx.activeTask || { id: current.operationId, worker: current.worker || 'jarvis', status: current.status, title: current.currentAction || 'active operation' };
    }
  } catch { /* best effort */ }

  // 4. Provider/model truth (same source the router uses — assignment + env).
  try {
    const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';
    let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
    }
    ctx.providers = {
      provider: 'openrouter',
      model: selectedModel,
      fallbackProvider: 'ollama',
      fallbackModel,
    };
  } catch { /* keep defaults */ }

  // 5. Capabilities (real registered list, not a static claim).
  ctx.capabilities = capabilitySummaryList();

  // 6. Active project context
  ctx.activeProject = null;
  try {
    const { projectsStore } = await import('../../services/projectsStore.js');
    ctx.activeProject = projectsStore.getActiveProject() as any;
  } catch { /* best effort */ }

  return ctx;
}

/**
 * Compact factual block for the direct-chat LLM system prompt. Kept SHORT —
 * the current user message and recent turns carry the conversational weight;
 * this adds only what the model cannot know from history.
 *
 * Prompt hierarchy (§prompt-hierarchy): operational state (active/recent task,
 * capabilities) is ONLY included when `includeOperational` is true — i.e. the
 * current user message actually asks about tasks/runtime. For ordinary
 * conversation the block is limited to static facts (workspace, provider,
 * approval mode) so task state never becomes the default subject and cannot
 * pull a simple question into a runtime-inspection tangent.
 */
export function contextToSystemPrompt(ctx: ConversationContext, opts: { includeOperational?: boolean } = {}): string {
  const lines: string[] = [];
  if (ctx.workspaceRoot) lines.push(`Selected workspace/repository: ${ctx.workspaceRoot}`);
  if (opts.includeOperational) {
    if (ctx.activeTask) {
      lines.push(`Active task: ${ctx.activeTask.worker} ${ctx.activeTask.status} — "${ctx.activeTask.title.slice(0, 70)}" (${ctx.activeTask.id.slice(0, 12)})`);
    }
    if (ctx.recentTask && !ctx.activeTask) {
      lines.push(`Most recent task (HISTORICAL, not active): ${ctx.recentTask.worker} ${ctx.recentTask.status} — "${ctx.recentTask.title.slice(0, 70)}" (${ctx.recentTask.id.slice(0, 12)})`);
    }
  }
  lines.push(`Provider/model: ${ctx.providers.provider}/${ctx.providers.model} (fallback ${ctx.providers.fallbackProvider}/${ctx.providers.fallbackModel})`);
  lines.push(`Approval mode: ${ctx.approvalMode}`);
  if (ctx.activeProject) {
    lines.push(`Active project: ${ctx.activeProject.name}${ctx.activeProject.description ? ` — ${ctx.activeProject.description.slice(0, 80)}` : ''}`);
  }
  if (ctx.previousWasClarification) {
    lines.push('Note: your previous reply asked the user to clarify. If this message supplies additional information, reinterpret the combined context instead of asking again.');
  }
  return lines.length ? `\n\nCURRENT AGENTICOS CONTEXT (compact, runtime truth):\n${lines.join('\n')}` : '';
}

/** Short structured hints for intent routing (deictic / continuation resolution). */
export function contextToRouterHint(ctx: ConversationContext): string {
  const parts: string[] = [];
  if (ctx.previousUserMessage) parts.push(`prev-user: ${ctx.previousUserMessage}`);
  if (ctx.previousAssistantMessage) parts.push(`prev-jarvis: ${ctx.previousAssistantMessage.slice(0, 200)}`);
  if (ctx.activeTask) parts.push(`active-task: ${ctx.activeTask.worker}/${ctx.activeTask.status}`);
  if (ctx.recentTask) parts.push(`recent-task: ${ctx.recentTask.worker}/${ctx.recentTask.status}`);
  if (ctx.workspaceRoot) parts.push(`workspace: ${ctx.workspaceRoot}`);
  if (ctx.previousWasClarification) parts.push('prev-clarification: yes');
  return parts.join('\n');
}

export { CAPABILITY_REGISTRY };

/**
 * domains/jarvis/conversationContext.ts
 *
 * ONE explicit context object for every Jarvis turn.
 */

import { conversationService } from '../conversations/service.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { CAPABILITY_REGISTRY, capabilitySummaryList } from './capabilityRegistry.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';
import { getConversationLanguage, LANGUAGE_CONFIGS, SupportedLanguage } from './conversationLanguage.js';
import { getCanonicalTaskSnapshot, CanonicalTaskSummary } from '../../services/backgroundTasks/canonicalSnapshot.js';

export interface WorkspaceContext {
  activeModule?: string;
  activeRoute?: string;
  selectedProject?: string;
  selectedMission?: string;
  selectedArtifact?: string;
  moduleStateSummary?: string;
  activeEntityId?: string | null;
  activeEntityType?: string | null;
  availableLocalEntities?: any[];
}

export interface ConversationContext {
  conversationId: string;
  currentPrompt: string;
  language: SupportedLanguage;
  recentTurns: { role: 'user' | 'assistant'; content: string }[];
  previousUserMessage?: string;
  previousAssistantMessage?: string;
  previousWasClarification: boolean;
  workspaceRoot: string | null;
  activeTask: { id: string; worker: string; status: string; title: string } | null;
  recentTask: { id: string; worker: string; status: string; title: string } | null;
  groundedResult?: string;
  hasGroundedEvidence?: boolean;
  providers: { provider: string; model: string; fallbackProvider: string; fallbackModel: string };
  capabilities: string;
  approvalMode: 'manual' | 'auto';
  activeProject: { id: string; name: string; description?: string | null } | null;
  injectedMemoryContext?: string;
  injectedMemoryIds: string[];
  workspaceContext?: WorkspaceContext;
}

const CLARIFICATION_PATTERN =
  /(could you (rephrase|clarify|repeat|explain)|didn'?t quite understand|i think part of that sentence was transcribed incorrectly|were you still talking about)/i;

export async function assembleConversationContext(
  conversationId: string,
  currentPrompt: string,
  options: { approvalMode?: 'manual' | 'auto'; language?: SupportedLanguage; workspaceContext?: WorkspaceContext } = {}
): Promise<ConversationContext> {
  const language = options.language || getConversationLanguage(conversationId);

  const ctx: ConversationContext = {
    conversationId,
    currentPrompt,
    language,
    recentTurns: [],
    previousWasClarification: false,
    workspaceRoot: null,
    activeTask: null,
    recentTask: null,
    groundedResult: undefined,
    hasGroundedEvidence: false,
    providers: { provider: 'openrouter', model: 'auto', fallbackProvider: 'ollama', fallbackModel: 'auto' },
    capabilities: '',
    approvalMode: options.approvalMode || 'manual',
    activeProject: null,
    injectedMemoryIds: [],
    workspaceContext: options.workspaceContext,
  };

  // 1. Recent turns (bounded window, newest first)
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
      const { canonicalObjectiveManager } = await import('./conversationalAuthority.js');
      if (canonicalObjectiveManager.isTurnDiscarded(content)) continue;
      if (role === 'user' && content === currentPrompt) continue;
      if (role !== 'user' && role !== 'agent') continue;
      turns.push({ role: role === 'agent' ? 'assistant' : 'user', content });

      const meta = (m.metadata || {}) as any;
      if (meta.groundedEvidence || meta.workerResult || meta.intent?.category === 'repository_analysis') {
        ctx.hasGroundedEvidence = true;
        if (!ctx.groundedResult && content) {
          ctx.groundedResult = content;
        }
      }
    }
    ctx.recentTurns = turns;
    for (const t of turns) {
      if (t.role === 'user') {
        ctx.previousUserMessage = t.content;
        break;
      }
    }
    for (const t of turns) {
      if (t.role === 'assistant') {
        ctx.previousAssistantMessage = t.content;
        break;
      }
    }
    ctx.previousWasClarification = turns
      .slice(0, 4)
      .some((t) => t.role === 'assistant' && CLARIFICATION_PATTERN.test(t.content));
  } catch { /* best effort */ }

  // 2. Canonical workspace
  try {
    const ws = await getWorkspaceRoot();
    if (ws) ctx.workspaceRoot = ws;
  } catch { /* best effort */ }

  // 3. Canonical task snapshot
  try {
    const taskSnap = getCanonicalTaskSnapshot(conversationId);
    if (taskSnap.activeTasks.length > 0) {
      const a = taskSnap.activeTasks[0];
      ctx.activeTask = { id: a.id, worker: a.worker, status: a.status, title: a.title };
    }
    const recent = taskSnap.recentTasks.find((t) => ['completed', 'failed', 'cancelled'].includes(t.status));
    if (recent) {
      ctx.recentTask = { id: recent.id, worker: recent.worker, status: recent.status, title: recent.title };
    }
  } catch { /* best effort */ }

  // 4. Provider/model truth
  try {
    const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:7b';
    let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
    let providerName = 'openrouter';
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
      if (assignment.providerId) {
        providerName = assignment.providerId;
      }
    }
    ctx.providers = {
      provider: providerName,
      model: selectedModel,
      fallbackProvider: 'ollama',
      fallbackModel,
    };
  } catch { /* keep defaults */ }

  // 5. Capabilities
  ctx.capabilities = capabilitySummaryList();

  // 6. Active project context
  try {
    const { projectsStore } = await import('../../services/projectsStore.js');
    ctx.activeProject = projectsStore.getActiveProject() as any;
  } catch { /* best effort */ }

  // 7. Authoritative Core Memory Context (human-confirmed pinned memories + scoped context)
  try {
    const { getScopedJarvisMemoryContextDetailed } = await import('./coreMemory.js');
    const memRes = await getScopedJarvisMemoryContextDetailed(currentPrompt, ctx.activeProject?.id);
    ctx.injectedMemoryContext = memRes.text;
    ctx.injectedMemoryIds = memRes.injectedMemoryIds;
  } catch {
    ctx.injectedMemoryIds = [];
  }

  return ctx;
}

/**
 * Compact factual block for the direct-chat LLM system prompt.
 */
export function contextToSystemPrompt(
  ctx: ConversationContext,
  opts: { includeOperational?: boolean; isStatusQuery?: boolean } = {}
): string {
  const lines: string[] = [];

  // Language Instruction
  const langConfig = LANGUAGE_CONFIGS[ctx.language] || LANGUAGE_CONFIGS.en;
  if (ctx.language !== 'en') {
    lines.push(langConfig.systemPromptInstruction);
  }

  if (ctx.workspaceRoot) lines.push(`Selected workspace/repository: ${ctx.workspaceRoot}`);

  // Authoritative Core Memory Injection
  if (ctx.injectedMemoryContext) {
    lines.push(ctx.injectedMemoryContext);
  }

  // Only include task details when specifically requested or when an active task is running
  if (opts.includeOperational || opts.isStatusQuery || ctx.activeTask) {
    if (ctx.activeTask) {
      lines.push(
        `Active background task: ${ctx.activeTask.worker} (${ctx.activeTask.status}) — "${ctx.activeTask.title.slice(0, 70)}" (${ctx.activeTask.id.slice(0, 12)}). If asked about status or progress, report that ${ctx.activeTask.worker} is currently running.`
      );
    }
    if (ctx.recentTask && !ctx.activeTask && opts.isStatusQuery) {
      lines.push(
        `Most recent completed task (HISTORICAL): ${ctx.recentTask.worker} ${ctx.recentTask.status} — "${ctx.recentTask.title.slice(0, 70)}"`
      );
    }
  }

  if (ctx.groundedResult) {
    lines.push(
      `Completed worker inspection findings (${ctx.recentTask?.worker || 'CodeX'}):\n"""\n${ctx.groundedResult.slice(0, 2500)}\n"""\nUse this grounded evidence to answer questions about the inspection findings.`
    );
  }

  const friendlyProv =
    (ctx.providers.provider || '').replace(/^prov-/, '').toLowerCase() === 'ollama'
      ? 'local Ollama'
      : (ctx.providers.provider || '').replace(/^prov-/, '');
  lines.push(`Provider/model: ${friendlyProv} ${ctx.providers.model}`);
  lines.push(`Approval mode: ${ctx.approvalMode}`);

  if (ctx.activeProject) {
    lines.push(`Active project: ${ctx.activeProject.name}`);
  }

  if (ctx.workspaceContext?.activeModule) {
    lines.push(`Active workspace module: ${ctx.workspaceContext.activeModule} (route: ${ctx.workspaceContext.activeRoute || 'unknown'})`);
    if (ctx.workspaceContext.selectedMission) lines.push(`Active mission: ${ctx.workspaceContext.selectedMission}`);
    if (ctx.workspaceContext.selectedProject) lines.push(`Active project in view: ${ctx.workspaceContext.selectedProject}`);
    if (ctx.workspaceContext.selectedArtifact) lines.push(`Active artifact: ${ctx.workspaceContext.selectedArtifact}`);
    if (ctx.workspaceContext.moduleStateSummary) lines.push(`Workspace module state: ${ctx.workspaceContext.moduleStateSummary}`);
  }

  if (ctx.previousWasClarification) {
    lines.push(
      'Note: your previous reply asked the user to clarify. If this message supplies additional information, reinterpret the combined context instead of asking again.'
    );
  }

  return lines.length ? `\n\nCURRENT CONTEXT:\n${lines.join('\n')}` : '';
}

/** Short structured hints for intent routing (deictic / continuation resolution). */
export function contextToRouterHint(ctx: ConversationContext): string {
  const parts: string[] = [];
  if (ctx.workspaceContext?.activeModule) parts.push(`active-module: ${ctx.workspaceContext.activeModule}`);
  if (ctx.previousUserMessage) parts.push(`prev-user: ${ctx.previousUserMessage}`);
  if (ctx.previousAssistantMessage) {
    // Strip diagnostics blocks from router hint so they don't corrupt next turn's intent
    const cleanPrev = ctx.previousAssistantMessage
      .replace(/Runtime diagnostics for.*$/s, '')
      .replace(/•.*$/gm, '')
      .trim();
    if (cleanPrev) parts.push(`prev-jarvis: ${cleanPrev.slice(0, 160)}`);
  }
  if (ctx.activeTask) parts.push(`active-task: ${ctx.activeTask.worker}/${ctx.activeTask.status}`);
  if (ctx.recentTask) parts.push(`recent-task: ${ctx.recentTask.worker}/${ctx.recentTask.status}`);
  if (ctx.groundedResult) parts.push('grounded-evidence: available');
  if (ctx.workspaceRoot) parts.push(`workspace: ${ctx.workspaceRoot}`);
  if (ctx.previousWasClarification) parts.push('prev-clarification: yes');
  return parts.join('\n');
}

export { CAPABILITY_REGISTRY };

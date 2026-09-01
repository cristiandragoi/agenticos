/**
 * supervisorTools.ts — Type-safe Supervisor Tool Layer for Jarvis (Phase 1).
 *
 * All supervisor tools return STRUCTURED DATA — never prewritten canned strings.
 * They execute against existing Agentic OS adapters (health probes, backgroundTaskManager,
 * memory stores, executionState) without duplicating execution infrastructure.
 */

import { AgentProviderAssignmentService, mapCatalogToGatewayId } from '../../services/agent/assignments.js';
import { hermesApiService } from '../../services/hermesApiService.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { getScopedJarvisMemoryContext } from './coreMemory.js';
import { memoryStore } from '../../services/memory/store.js';
import { getCurrent as getCurrentExecution } from '../../services/executionState.js';
import { goalStore } from '../../services/goalStore.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { logger } from '../../utils/logger.js';

const PROBE_TIMEOUT_MS = parseInt(process.env.GATEWAY_HEALTH_PROBE_TIMEOUT_MS || '2500', 10);

async function probeEndpoint(url: string): Promise<{ reachable: boolean; status: number; latencyMs: number }> {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { reachable: res.status >= 200 && res.status < 400, status: res.status, latencyMs: Date.now() - started };
  } catch (err) {
    return { reachable: false, status: 0, latencyMs: Date.now() - started };
  }
}

/* ────────────────────────────────────────────────────────────
 * Tool 1: get_system_health
 * ──────────────────────────────────────────────────────────── */

export interface SystemHealthInput {
  component?: string;
}

export interface SystemHealthOutput {
  componentRequested: string;
  gateways: {
    openRouter: { reachable: boolean; status: string; latencyMs: number };
    ollama: { reachable: boolean; status: string; latencyMs: number };
    hermes: { reachable: boolean; status: string; detail?: string; profile: string };
  };
  activeModel: {
    provider: string;
    model: string;
    fallbackModel: string;
  };
  tasks: {
    activeCount: number;
    queuedCount: number;
    recentTasks: Array<{ id: string; worker: string; status: string; title: string }>;
  };
}

export async function getSystemHealth(input: SystemHealthInput = {}): Promise<SystemHealthOutput> {
  const component = input.component?.trim().toLowerCase() || 'all';

  // 1. Probes
  const [openRouterProbe, ollamaProbe] = await Promise.all([
    probeEndpoint('https://openrouter.ai/api/v1/models'),
    probeEndpoint('http://127.0.0.1:11434/api/tags')
  ]);

  // 2. Hermes Status
  let hermesHealth: { reachable: boolean; status: string; detail?: string; profile: string } = {
    reachable: false,
    status: 'unreachable',
    profile: hermesApiService.getProfile()
  };
  try {
    const h = await hermesApiService.getStatus();
    hermesHealth = {
      reachable: Boolean(h?.reachable),
      status: h?.reachable ? 'online' : 'unreachable',
      detail: h?.detail,
      profile: hermesApiService.getProfile()
    };
  } catch {
    // best effort
  }

  // 3. Active Provider / Model Assignment
  let selectedProvider = 'OpenRouter';
  let selectedModel = process.env.OPENROUTER_MODEL || 'auto';
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    if (assignment?.enabled && assignment.modelId) {
      selectedModel = assignment.modelId;
      selectedProvider = mapCatalogToGatewayId(assignment.providerId) || selectedProvider;
    }
  } catch {
    // best effort
  }

  // 4. Background Tasks State
  let activeCount = 0;
  let queuedCount = 0;
  const recentTasks: Array<{ id: string; worker: string; status: string; title: string }> = [];
  try {
    const tasks = backgroundTaskManager.listTasks({ limit: 6 }) || [];
    for (const t of tasks) {
      if (['running', 'executing', 'planning'].includes(String(t.status))) activeCount++;
      if (['queued', 'pending'].includes(String(t.status))) queuedCount++;
      recentTasks.push({
        id: String(t.taskId || ''),
        worker: String(t.worker || t.selectedAgent || 'unknown'),
        status: String(t.status || 'unknown'),
        title: String(t.title || t.objective || '').slice(0, 80)
      });
    }
  } catch {
    // best effort
  }

  return {
    componentRequested: component,
    gateways: {
      openRouter: {
        reachable: openRouterProbe.reachable,
        status: openRouterProbe.reachable ? 'online' : 'unreachable',
        latencyMs: openRouterProbe.latencyMs
      },
      ollama: {
        reachable: ollamaProbe.reachable,
        status: ollamaProbe.reachable ? 'online' : 'unreachable',
        latencyMs: ollamaProbe.latencyMs
      },
      hermes: hermesHealth
    },
    activeModel: {
      provider: selectedProvider,
      model: selectedModel,
      fallbackModel
    },
    tasks: {
      activeCount,
      queuedCount,
      recentTasks
    }
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool 2: delegate_hermes_task
 * ──────────────────────────────────────────────────────────── */

export interface DelegateHermesInput {
  objective: string;
  context?: string;
  conversationId?: string;
  workspacePath?: string;
}

export interface DelegateHermesOutput {
  taskId: string;
  worker: 'hermes';
  status: 'queued' | 'running';
  objective: string;
  context?: string;
  message: string;
}

export async function delegateHermesTask(input: DelegateHermesInput): Promise<DelegateHermesOutput> {
  const { objective, context, conversationId, workspacePath } = input;
  if (!objective || typeof objective !== 'string') {
    throw new Error('delegate_hermes_task requires a non-empty "objective" parameter.');
  }

  const effectiveWorkspace = workspacePath || (await getWorkspaceRoot()) || undefined;
  const fullObjective = context ? `${objective.trim()}\n\nRelevant Context:\n${context.trim()}` : objective.trim();
  const title = objective.length > 64 ? `${objective.slice(0, 61)}…` : objective;

  let activeProjectId: string | null = null;
  try {
    const { projectsStore } = await import('../../services/projectsStore.js');
    activeProjectId = projectsStore.getActiveProjectId();
  } catch {}

  const { task, error } = backgroundTaskManager.createTask({
    title,
    objective: fullObjective,
    originalRequest: objective,
    route: 'hermes',
    selectedAgent: 'Hermes',
    worker: 'hermes',
    conversationId: conversationId || null,
    resumable: false,
    workspaceRoot: effectiveWorkspace,
    projectId: activeProjectId || undefined,
    metadata: {
      delegatedBy: 'jarvis-supervisor',
      context: context || null
    }
  });

  if (!task || error) {
    throw new Error(error || 'Failed to create Hermes background task.');
  }

  return {
    taskId: task.taskId,
    worker: 'hermes',
    status: 'queued',
    objective,
    context,
    message: `Hermes task ${task.taskId.slice(0, 8)} has been queued.`
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool 3: delegate_codex_goal
 * ──────────────────────────────────────────────────────────── */

export interface DelegateCodexInput {
  goal: string;
  context?: string;
  targetFiles?: string[];
  approvalRequired?: boolean;
  conversationId?: string;
  workspacePath?: string;
}

export interface DelegateCodexOutput {
  taskId: string;
  goalId?: string;
  worker: 'codex';
  status: 'queued' | 'waiting_for_approval';
  goal: string;
  context?: string;
  targetFiles?: string[];
  approvalRequired: boolean;
  message: string;
}

export async function delegateCodexGoal(input: DelegateCodexInput): Promise<DelegateCodexOutput> {
  const { goal, context, targetFiles, approvalRequired, conversationId, workspacePath } = input;
  if (!goal || typeof goal !== 'string') {
    throw new Error('delegate_codex_goal requires a non-empty "goal" parameter.');
  }

  const effectiveWorkspace = workspacePath || (await getWorkspaceRoot()) || undefined;
  const fullObjective = context ? `${goal.trim()}\n\nRelevant Context:\n${context.trim()}` : goal.trim();
  const title = goal.length > 64 ? `${goal.slice(0, 61)}…` : goal;

  let activeProjectId: string | null = null;
  try {
    const { projectsStore } = await import('../../services/projectsStore.js');
    activeProjectId = projectsStore.getActiveProjectId();
  } catch {}

  const isApprovalReq = Boolean(approvalRequired);

  const { task, error } = backgroundTaskManager.createTask({
    title,
    objective: fullObjective,
    originalRequest: goal,
    route: 'codex',
    selectedAgent: 'CodeX',
    worker: 'codex',
    conversationId: conversationId || null,
    resumable: true,
    workspaceRoot: effectiveWorkspace,
    projectId: activeProjectId || undefined,
    metadata: {
      delegatedBy: 'jarvis-supervisor',
      targetFiles: targetFiles || [],
      approvalRequired: isApprovalReq,
      context: context || null
    }
  });

  if (!task || error) {
    throw new Error(error || 'Failed to create CodeX background task.');
  }

  return {
    taskId: task.taskId,
    goalId: task.taskId,
    worker: 'codex',
    status: isApprovalReq ? 'waiting_for_approval' : 'queued',
    goal,
    context,
    targetFiles: targetFiles || [],
    approvalRequired: isApprovalReq,
    message: isApprovalReq
      ? `CodeX goal ${task.taskId.slice(0, 8)} is created and waiting for user approval.`
      : `CodeX goal ${task.taskId.slice(0, 8)} has been queued.`
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool 4: recall_memory
 * ──────────────────────────────────────────────────────────── */

export interface RecallMemoryInput {
  query: string;
  workspacePath?: string;
}

export interface RecallMemoryOutput {
  query: string;
  scopedMemory: string | null;
  searchResults: Array<{ id: string; content: string; type?: string }>;
  activeProject: { id: string; name: string; description?: string | null } | null;
}

export async function recallMemory(input: RecallMemoryInput): Promise<RecallMemoryOutput> {
  const { query, workspacePath } = input;
  if (!query || typeof query !== 'string') {
    throw new Error('recall_memory requires a non-empty "query" parameter.');
  }

  let scopedMemory: string | null = null;
  try {
    scopedMemory = await getScopedJarvisMemoryContext(query, workspacePath);
  } catch {}

  let searchResults: Array<{ id: string; content: string; type?: string }> = [];
  try {
    const raw = memoryStore.search(query, { limit: 5 }) || [];
    searchResults = raw.map((r: any) => ({
      id: r.id,
      content: r.content || r.summary || String(r),
      type: r.type
    }));
  } catch {}

  let activeProject: { id: string; name: string; description?: string | null } | null = null;
  try {
    const { projectsStore } = await import('../../services/projectsStore.js');
    const p = projectsStore.getActiveProject();
    if (p) {
      activeProject = { id: p.id, name: p.name, description: p.description };
    }
  } catch {}

  return {
    query,
    scopedMemory,
    searchResults,
    activeProject
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool 5: get_current_work
 * ──────────────────────────────────────────────────────────── */

export interface CurrentWorkInput {
  scope?: string;
  conversationId?: string;
}

export interface CurrentWorkOutput {
  scope: string;
  activeTask: { id: string; worker: string; status: string; title: string } | null;
  recentTasks: Array<{ id: string; worker: string; status: string; title: string }>;
  currentExecution: { status: string; currentAction?: string; worker?: string; operationId?: string } | null;
}

export async function getCurrentWork(input: CurrentWorkInput = {}): Promise<CurrentWorkOutput> {
  const scope = input.scope || 'all';
  let activeTask: { id: string; worker: string; status: string; title: string } | null = null;
  const recentTasks: Array<{ id: string; worker: string; status: string; title: string }> = [];

  try {
    const all = backgroundTaskManager.listTasks({ limit: 6 }) || [];
    for (const t of all) {
      const summary = {
        id: String(t.taskId || ''),
        worker: String(t.worker || t.selectedAgent || 'unknown'),
        status: String(t.status || 'unknown'),
        title: String(t.title || t.objective || '').slice(0, 80)
      };
      if (!activeTask && ['running', 'executing', 'planning', 'queued', 'pending'].includes(summary.status)) {
        activeTask = summary;
      } else {
        recentTasks.push(summary);
      }
    }
  } catch {}

  // Check conversation-scoped goals if conversationId provided
  if (input.conversationId) {
    try {
      const goals = goalStore.listByConversation(input.conversationId, 3) || [];
      const activeGoal = goals.find((g: any) => ['running', 'queued', 'planning', 'waiting_for_approval'].includes(String(g.status)));
      if (activeGoal && !activeTask) {
        activeTask = {
          id: activeGoal.id,
          worker: 'codex',
          status: String(activeGoal.status),
          title: (activeGoal.originalGoal || 'CodeX Goal').slice(0, 80)
        };
      }
    } catch {}
  }

  let currentExecution: { status: string; currentAction?: string; worker?: string; operationId?: string } | null = null;
  try {
    const cur = getCurrentExecution();
    if (cur && cur.status && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(cur.status)) {
      currentExecution = {
        status: cur.status,
        currentAction: cur.currentAction || undefined,
        worker: cur.worker || undefined,
        operationId: cur.operationId || undefined
      };
    }
  } catch {}

  return {
    scope,
    activeTask,
    recentTasks,
    currentExecution
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool Dispatcher & Schema Registry
 * ──────────────────────────────────────────────────────────── */

export const SUPERVISOR_TOOL_SCHEMAS = [
  {
    name: 'get_system_health',
    description: 'Check runtime connectivity of gateways (OpenRouter, Ollama, Hermes), active models, and background task statuses. Use when the user asks about system health, connectivity, gateway status, or why a component is unreachable.',
    parameters: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: 'Optional component name to check (e.g. "hermes", "ollama", "openrouter", "gateways", "all")'
        }
      }
    }
  },
  {
    name: 'delegate_hermes_task',
    description: 'Delegate high-level architectural planning, deep research, multi-agent coordination, or strategy to Hermes. Use when the user asks for roadmaps, planning, or research.',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'Fully resolved, descriptive objective for Hermes. ALWAYS resolve pronouns ("that", "it") from conversation history into the explicit target.'
        },
        context: {
          type: 'string',
          description: 'Contextual details or background information from previous turns.'
        }
      },
      required: ['objective']
    }
  },
  {
    name: 'delegate_codex_goal',
    description: 'Delegate implementation, repository inspection, file editing, bug fixes, or code creation to CodeX. Use whenever engineering tasks or repository changes are requested.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Fully resolved, descriptive engineering goal for CodeX. NEVER pass bare "Fix it" or "Do that" — explain the exact problem, target component, and expected behavior.'
        },
        context: {
          type: 'string',
          description: 'Context from the conversation, error descriptions, or user feedback.'
        },
        targetFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specific file paths to inspect or modify if known.'
        },
        approvalRequired: {
          type: 'boolean',
          description: 'Whether manual user approval is required before changing code.'
        }
      },
      required: ['goal']
    }
  },
  {
    name: 'recall_memory',
    description: 'Recall structured user preferences, persistent project decisions, or stored knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query or topic.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_current_work',
    description: 'Retrieve currently running background tasks, active operations, or recent task history. Use when user asks "What are you doing right now?" or asks about progress of ongoing work.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Scope filter ("active", "recent", "all")'
        }
      }
    }
  }
];

export async function executeSupervisorTool(
  toolName: string,
  parameters: Record<string, any> = {},
  context: { conversationId?: string; workspacePath?: string } = {}
): Promise<any> {
  logger.info(`[SupervisorTool] Executing tool: ${toolName}`, { parameters, context });

  switch (toolName) {
    case 'get_system_health':
      return await getSystemHealth(parameters);
    case 'delegate_hermes_task':
      return await delegateHermesTask({ objective: parameters.objective || '', context: parameters.context, ...context });
    case 'delegate_codex_goal':
      return await delegateCodexGoal({ goal: parameters.goal || '', context: parameters.context, targetFiles: parameters.targetFiles, approvalRequired: parameters.approvalRequired, ...context });
    case 'recall_memory':
      return await recallMemory({ query: parameters.query || '', ...context });
    case 'get_current_work':
      return await getCurrentWork({ scope: parameters.scope, ...context });
    default:
      throw new Error(`Unknown supervisor tool: "${toolName}". Available tools: get_system_health, delegate_hermes_task, delegate_codex_goal, recall_memory, get_current_work.`);
  }
}

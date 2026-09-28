/**
 * supervisorTools.ts — Type-safe Supervisor Tool Layer for Jarvis (Phase 1).
 *
 * All supervisor tools return STRUCTURED DATA — never prewritten canned strings.
 * They execute against existing Agentic OS adapters (health probes, backgroundTaskManager,
 * memory stores, executionState) without duplicating execution infrastructure.
 */

import { AgentProviderAssignmentService, mapCatalogToGatewayId } from '../../services/agent/assignments.js';
import { hermesApiService } from '../../services/hermesApiService.js';
import { hermesWatchdog } from '../../services/hermesWatchdog.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import type { DelegationEnvelope } from '../../services/backgroundTasks/types.js';
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
  /** Structured delegation envelope (§14) — preserves entity/acceptance/parent context. */
  envelope?: Partial<DelegationEnvelope>;
}

export interface DelegateHermesOutput {
  taskId: string;
  worker: 'hermes' | 'codex' | 'antigravity' | string;
  status: 'queued' | 'running' | 'blocked';
  objective: string;
  context?: string;
  message: string;
  error?: string;
}

export async function delegateHermesTask(input: DelegateHermesInput): Promise<DelegateHermesOutput> {
  const { objective, context, conversationId, workspacePath, envelope } = input;
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
    if (activeProjectId === 'proj-free-cash') {
      activeProjectId = null;
    }
    const objLower = (objective + ' ' + (context || '')).toLowerCase();
    if (objLower.includes('jarvis') || objLower.includes('agenticos') || objLower.includes('attachment') || objLower.includes('chat interface')) {
      activeProjectId = null;
    }
  } catch {}

  // Structured delegation envelope (§14) — carried in metadata so the worker
  // receives authoritative context, never a flattened prompt string.
  const delegationEnvelope: DelegationEnvelope = {
    pendingActionId: envelope?.pendingActionId,
    target: envelope?.target,
    objective: envelope?.objective || objective,
    acceptanceCriteria: envelope?.acceptanceCriteria,
    constraints: envelope?.constraints,
    relevantInstruction: envelope?.relevantInstruction || context,
    relatedTaskIds: envelope?.relatedTaskIds,
    relatedResultIds: envelope?.relatedResultIds,
    parentGoal: envelope?.parentGoal,
    worker: 'hermes',
  };

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
      context: context || null,
      delegationEnvelope,
    }
  });

  if (!task || error) {
    throw new Error(error || 'Failed to create Hermes background task.');
  }

  let status = await hermesApiService.getStatus();
  if (!status.reachable) {
    logger.warn('[Supervisor] HERMES_REQUIRED: Hermes offline detected automatically. Initiating automated recovery...');
    const recovery = await hermesWatchdog.recoverHermes('Supervisor engineering task delegation');
    if (recovery.success) {
      status = await hermesApiService.getStatus();
      logger.info('[Supervisor] Hermes gateway recovered and verified online', { status });
    } else {
      logger.error('[Supervisor] Automated Hermes recovery failed:', { error: recovery.error });
    }
  }

  if (!status.reachable) {
    const reason = `Hermes service is offline and automatic recovery failed (${hermesWatchdog.getState()}). Next action: ${status.nextAction || 'Check Hermes daemon'}`;
    backgroundTaskManager.transition(task.taskId, 'blocked', {
      currentStage: 'hermes_service_offline',
      progressMessage: reason,
      blocker: reason,
      resumable: true,
    });
    return {
      taskId: task.taskId,
      worker: 'hermes',
      status: 'blocked',
      objective,
      context,
      message: `Hermes task ${task.taskId.slice(0, 8)} could not be started: Hermes service is offline and automatic recovery failed.`,
      error: reason,
    };
  }

  // Dispatch task to worker adapter so it is consumed from the queue
  const { dispatchTask } = await import('../../services/backgroundTasks/adapters.js');
  dispatchTask(task, effectiveWorkspace).catch((err: any) => {
    logger.error(`[supervisorTools] dispatch error for ${task.taskId}: ${err?.message}`);
  });

  return {
    taskId: task.taskId,
    worker: 'hermes',
    status: 'queued',
    objective,
    context,
    message: `Hermes task ${task.taskId.slice(0, 8)} has been queued and dispatched.`
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool 3: delegate_antigravity_task (First-Class Preferred Engineering Worker)
 * ──────────────────────────────────────────────────────────── */

export interface DelegateAntigravityInput {
  objective: string;
  context?: string;
  targetFiles?: string[];
  conversationId?: string;
  workspacePath?: string;
  envelope?: Partial<DelegationEnvelope>;
}

export async function delegateAntigravityTask(input: DelegateAntigravityInput): Promise<DelegateHermesOutput> {
  const { objective, context, conversationId, workspacePath, envelope } = input;
  if (!objective || typeof objective !== 'string') {
    throw new Error('delegate_antigravity_task requires a non-empty "objective" parameter.');
  }

  const effectiveWorkspace = workspacePath || (await getWorkspaceRoot()) || 'D:\\AgenticOS';
  const fullObjective = context ? `${objective.trim()}\n\nRelevant Context:\n${context.trim()}` : objective.trim();
  const title = objective.length > 64 ? `${objective.slice(0, 61)}…` : objective;

  const delegationEnvelope: DelegationEnvelope = {
    pendingActionId: envelope?.pendingActionId,
    target: envelope?.target,
    objective: envelope?.objective || objective,
    acceptanceCriteria: envelope?.acceptanceCriteria,
    constraints: envelope?.constraints,
    relevantInstruction: envelope?.relevantInstruction || context,
    relatedTaskIds: envelope?.relatedTaskIds,
    relatedResultIds: envelope?.relatedResultIds,
    parentGoal: envelope?.parentGoal,
    worker: 'antigravity',
  };

  const { task, error } = backgroundTaskManager.createTask({
    title,
    objective: fullObjective,
    originalRequest: objective,
    route: 'engineering',
    selectedAgent: 'AntiGravity',
    worker: 'antigravity',
    conversationId: conversationId || null,
    resumable: true,
    workspaceRoot: effectiveWorkspace,
    metadata: {
      delegatedBy: 'jarvis-supervisor',
      context: context || null,
      delegationEnvelope,
    },
  });

  if (!task || error) {
    throw new Error(error || 'Failed to create AntiGravity background task.');
  }

  const { dispatchTask } = await import('../../services/backgroundTasks/adapters.js');
  try {
    await dispatchTask(task, effectiveWorkspace);
  } catch (err: any) {
    logger.error(`[supervisorTools] dispatch error for ${task.taskId}: ${err?.message}`);
  }

  const updatedTask = backgroundTaskRepo.getTask(task.taskId);
  const { engineeringWorkerRegistry } = await import('../controlPlane/EngineeringWorkerRegistry.js');
  const events = engineeringWorkerRegistry.getWorkerEvents('antigravity').filter(e => e.taskId === task.taskId);
  const convId = updatedTask?.linkedRunId;
  const isAccepted = updatedTask && (updatedTask.status === 'executing' || updatedTask.status === 'worker_accepted' || updatedTask.status === 'completed');

  if (isAccepted && convId && events.length > 0) {
    const firstEvent = events[0].eventType;
    return {
      taskId: task.taskId,
      worker: 'antigravity',
      status: 'executing',
      objective,
      context,
      message: `AntiGravity has accepted task ${task.taskId.slice(0, 8)} (session ${convId}) and started execution in ${effectiveWorkspace}. Initial event: ${firstEvent}.`,
    };
  }

  return {
    taskId: task.taskId,
    worker: 'antigravity',
    status: updatedTask?.status === 'blocked' ? 'blocked' : 'queued',
    objective,
    context,
    message: `AntiGravity task ${task.taskId.slice(0, 8)} is pending startup: ${updatedTask?.blocker || 'waiting for session verification'}.`,
  };
}

/* ────────────────────────────────────────────────────────────
 * Tool 4: delegate_codex_goal
 * ──────────────────────────────────────────────────────────── */

export interface DelegateCodexInput {
  goal: string;
  context?: string;
  targetFiles?: string[];
  approvalRequired?: boolean;
  conversationId?: string;
  workspacePath?: string;
  /** Structured delegation envelope (§14) — preserves entity/acceptance/parent context. */
  envelope?: Partial<DelegationEnvelope>;
}

export async function delegateCodexGoal(input: DelegateCodexInput): Promise<DelegateHermesOutput> {
  const objective = input.goal || (input as any).objective || '';
  if (!objective || typeof objective !== 'string') {
    throw new Error('delegate_codex_goal requires a non-empty "goal" parameter.');
  }

  const effectiveWorkspace = input.workspacePath || (await getWorkspaceRoot()) || 'D:\\AgenticOS';
  const fullObjective = input.context ? `${objective.trim()}\n\nRelevant Context:\n${input.context.trim()}` : objective.trim();
  const title = objective.length > 64 ? `${objective.slice(0, 61)}…` : objective;

  const delegationEnvelope: DelegationEnvelope = {
    pendingActionId: input.envelope?.pendingActionId,
    target: input.envelope?.target,
    objective: input.envelope?.objective || objective,
    acceptanceCriteria: input.envelope?.acceptanceCriteria,
    constraints: input.envelope?.constraints,
    relevantInstruction: input.envelope?.relevantInstruction || input.context,
    relatedTaskIds: input.envelope?.relatedTaskIds,
    relatedResultIds: input.envelope?.relatedResultIds,
    parentGoal: input.envelope?.parentGoal,
    worker: 'codex',
  };

  const { task, error } = backgroundTaskManager.createTask({
    title,
    objective: fullObjective,
    originalRequest: objective,
    route: 'engineering',
    selectedAgent: 'CodeX',
    worker: 'codex',
    conversationId: input.conversationId || null,
    resumable: true,
    workspaceRoot: effectiveWorkspace,
    metadata: {
      delegatedBy: 'jarvis-supervisor',
      context: input.context || null,
      delegationEnvelope,
    },
  });

  if (!task || error) {
    throw new Error(error || 'Failed to create CodeX background task.');
  }

  const { dispatchTask } = await import('../../services/backgroundTasks/adapters.js');
  dispatchTask(task, effectiveWorkspace).catch((err: any) => {
    logger.error(`[supervisorTools] dispatch error for ${task.taskId}: ${err?.message}`);
  });

  return {
    taskId: task.taskId,
    worker: 'codex',
    status: 'queued',
    objective,
    context: input.context,
    message: `CodeX task ${task.taskId.slice(0, 8)} has been queued and dispatched.`,
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
        },
        envelope: {
          type: 'object',
          description: 'Structured delegation envelope: { pendingActionId, target: {id,type,domain,displayName}, acceptanceCriteria: string[], constraints: {maxRuntime,readOnly,fileScope,allowedTools}, relevantInstruction, relatedTaskIds, relatedResultIds, parentGoal }. ALWAYS include when the objective targets a resolved entity.'
        }
      },
      required: ['objective']
    }
  },
  {
    name: 'delegate_antigravity_task',
    description: 'Delegate implementation, coding, repository inspection, file editing, or bug fixing to AntiGravity (the preferred engineering worker). Use when the user asks AntiGravity to work on code or diagnose/repair issues.',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'Fully resolved, descriptive objective for AntiGravity.'
        },
        context: {
          type: 'string',
          description: 'Contextual details or background information from previous turns.'
        },
        envelope: {
          type: 'object',
          description: 'Structured delegation envelope.'
        }
      },
      required: ['objective']
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
    case 'delegate_antigravity_task':
      return await delegateAntigravityTask({
        objective: parameters.objective || '',
        context: parameters.context,
        envelope: parameters.envelope,
        ...context,
      });
    case 'delegate_hermes_task':
      return await delegateHermesTask({ objective: parameters.objective || '', context: parameters.context, envelope: parameters.envelope, ...context });
    case 'delegate_codex_goal':
      return await delegateCodexGoal({
        goal: parameters.goal || parameters.objective || '',
        context: parameters.context,
        envelope: parameters.envelope,
        ...context,
      });
    case 'recall_memory':
      return await recallMemory({ query: parameters.query || '', ...context });
    case 'get_current_work':
      return await getCurrentWork({ scope: parameters.scope, ...context });
    default:
      throw new Error(`Unknown supervisor tool: "${toolName}". Available tools: get_system_health, delegate_hermes_task, recall_memory, get_current_work.`);
  }
}

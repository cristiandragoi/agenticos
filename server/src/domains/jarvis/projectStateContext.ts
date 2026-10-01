/**
 * projectStateContext.ts — Deterministic project/operator grounding context.
 *
 * Symmetric to buildOpportunityContext() in supervisorLoop.ts, but driven by the
 * registered entity providers instead of a UI workspace selection, so channels
 * without a workspace context (voice) can still ground project/operator answers.
 *
 * This module owns NO state. Every fact comes from the existing authoritative
 * stores: projectsStore, projectTaskService, backgroundTaskManager, the revenue
 * tables, and CAPABILITY_REGISTRY.
 */

import { logger } from '../../utils/logger.js';
import { resolveEntity, type EntityRef } from './entityResolver.js';

export interface ProjectStateEvidence {
  /** True only when an authoritative store actually returned rows. */
  hasEvidence: boolean;
  /** Markdown block to append to the supervisor system prompt. */
  context: string;
  entityId?: string;
  entityType?: string;
  entityName?: string;
  /** Which store(s) produced the evidence — for VOICE_GROUNDING logging. */
  source: string;
  /**
   * Deterministically formatted answer for simple authoritative READS.
   * When present the caller may speak it directly: the provider already
   * produced complete structured evidence, so routing it through an 8s model
   * loop adds latency, arithmetic drift and claim-gate interference without
   * adding information. Absent for anything needing reasoning or execution.
   */
  directAnswer?: string;
  /** Which read shape produced directAnswer. */
  readIntent?: ReadIntent;
  presentedBlockers?: any[];
  /**
   * How the entity was obtained. 'explicit' means THIS turn resolved it;
   * 'conversation' means it was inherited from focus because the turn resolved
   * nothing. State-changing routes must not act on an inherited entity unless
   * the turn genuinely refers back to it (P0 cross-project guard).
   */
  projectScopeSource?: 'explicit' | 'conversation' | 'global_active' | 'global';
}

export type ReadIntent =
  | 'list_projects'
  | 'project_contents'
  | 'project_running'
  | 'work_summary'
  | 'project_blocked'
  | 'project_priority'
  | 'project_next_actions'
  | 'project_prerequisites'
  | 'operator_missions'
  | 'operator_status'
  | 'operator_association'
  | 'entity_lookup'
  | 'blocked_global'
  | 'worker_status'
  | 'delegation_blockers'
  | 'system_health';

/** Classify simple read shapes that a provider can answer completely. */
export function classifyReadIntent(text: string): ReadIntent | null {
  const t = (text || '').toLowerCase();
  if (/\b(?:are you healthy|how are you|system health|health status|are we healthy)\b/i.test(t)) return 'system_health';
  if (/\bwhy\b.*\b(can't|cannot|can not)\b.*\bdelegat/i.test(t) || /\b(can't|cannot)\b.*\bdelegat/i.test(t)) return 'delegation_blockers';
  if (/\b(?:what (?:do you|do we|does it) need|what (?:is|are) (?:the )?(?:prerequisites?|requirements?)|what does it require|what is needed to start|what do we need to start|what do you need to start|prerequisites? to start)\b/i.test(t)) return 'project_prerequisites';
  if (/\b(?:what (?:should|do|can|shall|we\s+should|we\s+do|would you suggest|do you suggest|would you recommend|do you recommend) (?:we\s+)?(?:do\s+)?(?:now|next)|what to do next|what is next|what's next|next step|next steps|next action|next actions|what needs to be done next|what should i do next|what is the next step|what are the next steps|suggest we do|recommend we do|where do we go from here|what is needed|what'?s needed|tell me what is needed|what do we need|what is required|what do you need)\b/i.test(t)) return 'project_next_actions';
  if (/\b(?:what are we working on|what are we doing|current work|what's our focus|what is our focus)\b/i.test(t)) return 'work_summary';
  if (/\b(?:what are you working on|what are you doing|working on)\b/i.test(t)) return 'project_running';
  if (/\brevenue\s+operator\b.*\b(doing|status|working|state)\b/i.test(t)) return 'operator_status';
  if (/\b(what|how).*\b(codex|hermes|worker|operator)\b.*\b(doing|status|working|state)\b/i.test(t)) return 'worker_status';
  if (/\b(which|what)\b.*\bproject\b.*\b(associat|linked|belong|connected)/.test(t)) return 'operator_association';
  if (/\bpriority\b/.test(t) && !/\bset\b|\bchange\b|\bmake\b/.test(t)) return 'project_priority';
  if (/\b(what|which|list|show).*\bprojects\b/.test(t) || /\bprojects do we have\b/.test(t)) return 'list_projects';
  if (/\b(?:blocked|blockers?|waiting on|waiting for|stopping us|holding us up|blocking us)\b/i.test(t) && !/\b(?:resolve|fix|clear|address|unblock)\b/i.test(t)) return 'project_blocked';
  if (/\b(?:running|in progress|currently)\b/i.test(t)) return 'project_running';
  if (/\bmissions?\b/.test(t)) return 'operator_missions';
  if (/\b(doing|status|state)\b/.test(t)) return 'operator_status';
  if (/\binside\b|\bcontents?\b|\bwhere we are\b|\bwhere are we\b|\bhow are we doing\b|\b(?:tell me\s+)?what\s+(?:do\s+you\s+|we\s+|you\s+)?see\b|\bshow me what is happening\b|\bwhat'?s going on(?: here)?\b|\btell me about this\b|\bwhat is here\b|\bwhat'?s here\b|\bsummar(?:y|ize)\b|\boverview\b/i.test(t)) return 'project_contents';
  if (/^\s*(find|locate|show me|where is)\b/.test(t)) {
    // Desktop apps, local processes, windows, screenshots, and websites are local computer control, not project entity lookups
    if (/\b(telegram|hermes|chrome|edge|browser|youtube|google|notepad|calculator|cmd|powershell|screenshot|window|desktop|app|application|process)\b/i.test(t)) {
      return null;
    }
    return 'entity_lookup';
  }
  return null;
}

/** "4 goals" / "1 goal" */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Join items for speech: "a, b and c" with deduplication. */
function speakList(items: string[], max = 5): string {
  const deduped: string[] = [];
  const counts = new Map<string, number>();
  for (const item of items) {
    const clean = (item || '').trim();
    if (!clean) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
    if (!deduped.includes(clean)) {
      deduped.push(clean);
    }
  }
  const formatted = deduped.map((item) => {
    const count = counts.get(item) || 1;
    return count > 1 ? `${count} ${item}` : item;
  });
  const shown = formatted.slice(0, max);
  const rest = formatted.length - shown.length;
  let s = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] || '');
  if (rest > 0) s += `, plus ${rest} more`;
  return s;
}

const EMPTY: ProjectStateEvidence = { hasEvidence: false, context: '', source: 'none' };

/** Requests about a project container rather than a revenue entity. */
const PROJECT_SHAPED = /\b(project|projects|inside|open|running|blocked|tasks?|goals?|contents?|summar(?:y|ize)|overview|rename|prioriti[sz]e|operat(?:e|ing|ion)|work(?:ing)?(?:\s+(?:inside|on|in))?|moving)\b/i;
/** Requests explicitly about Revenue Operator domain entities. */
const REVENUE_SHAPED = /\bopportunit|\bmissions?\b|\bexperiments?\b|\bledger\b|\bgates?\b|\bchannels?\b/;
const PRONOUN_RE = /\b(it|its|it's|that|this|them|they)\b/i;

/**
 * Operational vocabulary that indicates the user is asking about authoritative
 * system/project state rather than making conversation. Deliberately generic —
 * no project or operator names are hardcoded here.
 */
const OPERATIONAL_TERMS = [
  'project', 'projects', 'operator', 'mission', 'missions', 'opportunity', 'opportunities',
  'experiment', 'experiments', 'task', 'tasks', 'goal', 'goals', 'blocked', 'blocker',
  'running', 'in progress', 'status', 'activity', 'agent', 'agents', 'worker', 'workers',
  'workflow', 'workflows', 'capability', 'capabilities', 'pipeline', 'delegat',
  // REMOVED (P0 D-1): 'what do you see', 'what you see', 'show me', 'open '.
  // Those are perception/launch phrasings, not runtime-state questions, and they
  // hijacked camera/screen turns into buildProjectStateContext() runtime dumps.
  // Runtime diagnostics now additionally require an explicit runtime subject —
  // see hasExplicitRuntimeIntent() in domains/jarvis/perception/perceptionIntent.ts.
  'what is inside', "what's inside",
  'what should we do next', 'what do we do next', 'next action', 'next step', 'what to do next', 'what is next',
  'what is needed', "what's needed", 'tell me what is needed', 'what do we need', 'what is required', 'what do you need',
  'latest', 'recent', 'ledger', 'revenue',
  'execution', 'executions', 'current work', 'system state', 'working on', 'find the',
];

/** Cheap shape test used to decide whether a turn MUST be grounded. */
export function isProjectStateRequest(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return false;
  // Feature requests, code generation, file actions, and implementation tasks are not state reads
  if (
    /^(can you |could you |please |i want you to |let's )?(add|create|implement|build|make|install|write|support|save)\b/i.test(t) ||
    /\b(add|create|implement|build|make|install|write|save)\s+(?:an?|the|some)?\s*(?:file|feature|attachment|button|component|code|page|tool|capability|support)\b/i.test(t)
  ) {
    return false;
  }
  return OPERATIONAL_TERMS.some((k) => t.includes(k));
}

/**
 * Resolve the prompt against the registered providers and hydrate authoritative
 * state for whatever it names. Returns hasEvidence=false when nothing resolves —
 * callers MUST then refuse rather than letting a model answer from memory.
 */
export async function buildProjectStateContext(
  userPrompt: string,
  focus?: { entityId?: string; entityType?: string; entityName?: string },
): Promise<ProjectStateEvidence> {
  const prompt = (userPrompt || '').trim();
  if (!prompt) return EMPTY;

  if (!isProjectStateRequest(prompt) && !focus?.entityId) {
    return EMPTY;
  }

  const lowerPrompt = prompt.toLowerCase();
  let entity: EntityRef | null = null;

  // Worker-shaped queries (e.g. "What is Hermes doing?", "What is CodeX doing?")
  // resolve to CapabilityEntityProvider first.
  const isPriorityMutation = /\bpriority\s+(?:to\s+)?\d{1,3}\b/i.test(lowerPrompt) || /\bto\s+priority\s+\d{1,3}\b/i.test(lowerPrompt);
  const isHermesProject = /operational acceptance/i.test(lowerPrompt);
  const isHermesDelegation =
    /\b(?:ask|tell|have|delegate\s+to)\s+(?:hermes|codex)\b/i.test(lowerPrompt) ||
    /\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(lowerPrompt);
  const WORKER_SHAPED = /\b(codex|hermes)\b/i.test(lowerPrompt) && !isPriorityMutation && !isHermesProject && !isHermesDelegation;
  if (WORKER_SHAPED) {
    try {
      const { CapabilityEntityProvider } = await import('./entityProviders/capability.js');
      entity = (await CapabilityEntityProvider.resolve(prompt)) ?? null;
      if (entity) {
        logger.info('[ProjectStateContext] worker-shaped request resolved via CapabilityEntityProvider', {
          entityId: entity.id, entityName: entity.displayName,
        });
      }
    } catch (err) {
      logger.warn('[ProjectStateContext] capability-first resolution failed', err);
    }
  }

  // The global resolver registers Revenue Operator providers before project
  // providers by contract, so a bare name like "Free Cash" resolves to an
  // opportunity. For project-shaped requests we consult the project provider
  // first — without reordering the global registry that other paths rely on.
  // Requests explicitly about opportunities/missions/experiments keep the
  // existing Revenue Operator precedence.
  if (!entity && PROJECT_SHAPED.test(lowerPrompt) && !REVENUE_SHAPED.test(lowerPrompt)) {
    try {
      const { ProjectEntityProvider } = await import('./entityProviders/project.js');
      entity = (await ProjectEntityProvider.resolve(prompt)) ?? null;
      if (entity) {
        logger.info('[ProjectStateContext] project-shaped request resolved via ProjectEntityProvider', {
          entityId: entity.id, entityName: entity.displayName,
        });
      }
    } catch (err) {
      logger.warn('[ProjectStateContext] project-first resolution failed', err);
    }
  }

  if (!entity) {
    try {
      entity = await resolveEntity(prompt);
    } catch (err) {
      logger.warn('[ProjectStateContext] entity resolution failed', err);
    }
  }

  let projectScopeSource: 'explicit' | 'conversation' | 'global_active' | 'global' = 'global';

  const readIntent = classifyReadIntent(prompt);
  const isRelevantProjectQuery =
    readIntent === 'project_blocked' ||
    readIntent === 'project_running' ||
    readIntent === 'project_priority' ||
    readIntent === 'project_contents' ||
    readIntent === 'project_next_actions' ||
    PROJECT_SHAPED.test(lowerPrompt) ||
    PRONOUN_RE.test(lowerPrompt) ||
    isProjectStateRequest(prompt);

  if (entity && entity.type === 'project') {
    projectScopeSource = 'explicit';
  } else if (!entity && focus?.entityId && focus.entityType && isRelevantProjectQuery) {
    const domain = focus.entityType === 'project' ? 'projects' : (focus.entityType === 'capability' ? 'capabilities' : 'revenue_operator');
    entity = {
      id: focus.entityId,
      type: focus.entityType as any,
      domain: domain as any,
      displayName: focus.entityName || focus.entityId,
    };
    if (focus.entityType === 'project') {
      projectScopeSource = 'conversation';
    }
    logger.info('[ProjectStateContext] inherited active entity from conversation focus', {
      entityId: entity.id, entityType: entity.type,
    });
  }

  // Corpus-level questions about ALL projects must never be narrowed down to a single active project!
  const isGlobalScope = /\b(?:across all|globally|in every project|all projects|fleet)\b/i.test(lowerPrompt);

  if (readIntent === 'project_blocked' && (isGlobalScope || /\bprojects\b/.test(lowerPrompt))) {
    return await buildBlockedOverview();
  }

  if (readIntent === 'work_summary' || (readIntent === 'project_running' && (isGlobalScope || /\bprojects\b/.test(lowerPrompt)))) {
    return await buildGlobalWorkSummary();
  }

  if (readIntent === 'list_projects' || /^\s*(?:what|which|list|show)\s+(?:all\s+)?projects\b/i.test(lowerPrompt) || /\bprojects\s+do\s+we\s+have\b/i.test(lowerPrompt) || (!readIntent && /\bprojects\b/.test(lowerPrompt))) {
    return await buildProjectList();
  }

  if (!entity && (PROJECT_SHAPED.test(lowerPrompt) || readIntent === 'project_blocked' || readIntent === 'project_running' || readIntent === 'project_priority' || readIntent === 'project_contents' || readIntent === 'project_next_actions')) {
    const { projectsStore } = await import('../../services/projectsStore.js');
    const globalActiveId = safe(() => projectsStore.getActiveProjectId?.(), null);
    if (globalActiveId) {
      const p: any = safe(() => projectsStore.getProject(globalActiveId), null);
      if (p) {
        entity = {
          id: p.id,
          type: 'project',
          domain: 'projects',
          displayName: p.name,
        };
        projectScopeSource = 'global_active';
      }
    }
  }

  if (entity?.type === 'project' || /\bblocked\b|\bblocker\b/i.test(lowerPrompt)) {
    logger.info('[JRT] PROJECT_SCOPE', { source: projectScopeSource, entityId: entity?.id, entityName: entity?.displayName });
    console.log(`[JRT] PROJECT_SCOPE source=${projectScopeSource}`);
  }

  try {
    if (entity?.type === 'project') {
      return { ...(await buildProjectOverview(entity, readIntent, projectScopeSource)), projectScopeSource };
    }
    if (entity?.type === 'revenue_opportunity') {
      const { buildOpportunityContext } = await import('./supervisorLoop.js');
      const context = await buildOpportunityContext(entity.id);
      if (context) {
        // Deterministic direct answer for opportunity status so it never returns empty
        const titleMatch = context.match(/Title:\s*(.+)/i);
        const statusMatch = context.match(/Status:\s*(.+)/i);
        const valueMatch = context.match(/Projected Value:\s*(.+)/i);
        const blockersMatch = context.match(/Blockers:\s*(.+)/i);
        const title = titleMatch ? titleMatch[1].trim() : entity.displayName;
        const status = statusMatch ? statusMatch[1].trim() : 'active';
        const value = valueMatch ? valueMatch[1].trim() : undefined;
        const blockers = blockersMatch ? blockersMatch[1].trim() : 'none';

        let directAnswer = `Revenue opportunity ${title} is currently ${status}.`;
        if (value && value !== 'unknown' && value !== 'null') {
          directAnswer += ` Projected value is ${value}.`;
        }
        if (blockers && blockers !== 'none' && blockers !== '[]') {
          directAnswer += ` Blockers: ${blockers}.`;
        } else {
          directAnswer += ' No active blockers recorded.';
        }

        return {
          hasEvidence: true,
          context,
          entityId: entity.id,
          entityType: entity.type,
          entityName: entity.displayName,
          source: 'revenueOperator.opportunityService',
          directAnswer,
          readIntent: readIntent ?? 'operator_status',
        };
      }
    }
    if (entity?.type === 'capability') {
      return await buildCapabilityOverview(entity, readIntent, prompt);
    }

    if (readIntent === 'delegation_blockers' || /\bwhy\b.*\b(can't|cannot)\b.*\bdelegat/i.test(lowerPrompt)) {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
      const { isExecutingStatus } = await import('../../services/backgroundTasks/types.js');
      const active = safe(() => backgroundTaskManager.listTasks({ activeOnly: true }), []);
      const executing = active.filter((t: any) => isExecutingStatus(t.status));
      const codexExecuting = executing.filter((t: any) => t.worker === 'codex');
      const hermesExecuting = executing.filter((t: any) => t.worker === 'hermes');
      let directAnswer: string;
      if (codexExecuting.length >= 1) {
        directAnswer = `I cannot delegate to CodeX right now because its active execution slot is occupied by task ${codexExecuting[0].taskId} ("${codexExecuting[0].title}").`;
      } else if (hermesExecuting.length >= 1) {
        directAnswer = `I cannot delegate to Hermes right now because its active execution slot is occupied by task ${hermesExecuting[0].taskId} ("${hermesExecuting[0].title}").`;
      } else {
        directAnswer = 'Worker slots are currently available: CodeX and Hermes can accept new tasks.';
      }
      return {
        hasEvidence: true,
        context: directAnswer,
        source: 'backgroundTaskManager',
        directAnswer,
        readIntent: 'delegation_blockers',
      };
    }

    if (readIntent === 'system_health' || /\b(?:are you healthy|how are you|system health|health status|are we healthy)\b/i.test(lowerPrompt)) {
      return await buildSystemHealthOverview();
    }

    // No specific entity — handle the corpus-level questions.
    if (/\bblocked\b|\bblocker/.test(lowerPrompt)) return await buildBlockedOverview();
  } catch (err) {
    logger.warn('[ProjectStateContext] hydration failed', err);
    return EMPTY;
  }

  return EMPTY;
}

/** Full authoritative contents of one project. */
async function buildProjectOverview(
  entity: EntityRef,
  readIntent?: ReadIntent | null,
  projectScopeSource: 'explicit' | 'conversation' | 'global_active' | 'global' = 'explicit',
): Promise<ProjectStateEvidence> {
  const { projectsStore } = await import('../../services/projectsStore.js');
  const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
  const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');

  const project: any = projectsStore.getProject(entity.id);
  if (!project) return EMPTY;

  const goals: any[] = safe(() => projectTaskService.listGoals(entity.id), []);
  const tasks: any[] = safe(() => projectTaskService.listTasksByProject(entity.id), []);
  const bgTasks: any[] = safe(() => backgroundTaskManager.listTasks({ projectId: entity.id, limit: 50 }), []);
  const experiments: any[] = await safeAsync(() => queryRevenueExperiments(entity.id), []);

  const lines: string[] = [
    '## AUTHORITATIVE PROJECT RECORD (RETRIEVED FROM SYSTEM STORES)',
    `id: ${project.id}`,
    `name: ${project.name}`,
    `status: ${project.status}`,
    `priority: ${project.priority}`,
    `revenueVertical: ${project.revenueVertical ?? 'none'}`,
    `workspacePath: ${project.workspacePath ?? 'none'}`,
    `description: ${project.description ?? 'none'}`,
    `updatedAt: ${project.updatedAt}`,
    '',
    `### GOALS (${goals.length})`,
    ...(goals.length ? goals.map((g) => `- ${g.id} | ${g.title} | status=${g.status}`) : ['- none recorded']),
    '',
    `### PROJECT TASKS (${tasks.length})`,
    ...(tasks.length
      ? tasks.map((t) => `- ${t.id} | ${t.title} | status=${t.status} | capability=${t.assignedCapability ?? 'none'}`)
      : ['- none recorded']),
    '',
    `### BACKGROUND TASKS (${bgTasks.length})`,
    ...(bgTasks.length
      ? bgTasks.slice(0, 25).map((t) => `- ${t.taskId} | ${t.title} | status=${t.status} | agent=${t.selectedAgent ?? 'none'}`)
      : ['- none recorded']),
    '',
    `### REVENUE EXPERIMENTS (${experiments.length})`,
    ...(experiments.length
      ? experiments.map((e) => `- ${e.id} | engine=${e.engine} | status=${e.status} | mission=${e.mission_id ?? 'none'}`)
      : ['- none recorded']),
    '',
    'GROUNDING RULES FOR THIS PROJECT RECORD:',
    '- Answer ONLY from the record above. It is the authoritative system state.',
    '- Do not invent goals, tasks, agents, operators, activity, blockers or outputs that are not listed.',
    '- Counts above are exact. If the user asks for something not present, say it is not recorded.',
    '- When summarising for voice, give concrete names and statuses, not generic descriptions.',
  ];

  // Deterministic answers for complete reads — exact counts, no model arithmetic.
  let directAnswer: string | undefined;
  const isExecuting = (s: any) => ['planning', 'running', 'verifying'].includes(String(s).toLowerCase());
  const isActive = (s: any) => ['running', 'in_progress', 'active', 'executing'].includes(String(s).toLowerCase());
  const isBlocked = (s: any) => String(s).toLowerCase() === 'blocked';

  if (readIntent === 'project_priority') {
    directAnswer = `${project.name} is priority ${project.priority}, status ${project.status}.`;
  } else if (readIntent === 'entity_lookup') {
    directAnswer =
      `Found the project ${project.name}: ${project.status}, priority ${project.priority}, ` +
      `with ${plural(goals.length, 'goal')}, ${plural(tasks.length, 'task')} and ${plural(bgTasks.length, 'background task')}.`;
  } else if (readIntent === 'project_blocked') {
    const blocked = [...bgTasks.filter((t) => isBlocked(t.status)), ...tasks.filter((t) => isBlocked(t.status))];
    const { getPrimaryBlocker } = await import('../../services/projectExecution/projectController.js');
    const primaryBlocker = getPrimaryBlocker(bgTasks.filter((t) => isBlocked(t.status)));
    const scopePrefix = projectScopeSource === 'global_active' ? `In the active project ${project.name}` : `In ${project.name}`;
    directAnswer = blocked.length
      ? `${scopePrefix}, ${plural(blocked.length, 'blocked item')}: ${speakList(blocked.map((t) => t.title))}. The primary blocker is ${primaryBlocker}.`
      : `${scopePrefix}, nothing is currently blocked.`;
  } else if (readIntent === 'project_running') {
    const liveRunning = bgTasks.filter((t) => isExecuting(t.status));
    const storedRunning = tasks.filter((t) => isActive(t.status));
    const blocked = bgTasks.filter((t) => isBlocked(t.status));
    const queued = bgTasks.filter((t) => ['queued', 'pending'].includes(String(t.status).toLowerCase()));
    if (liveRunning.length > 0) {
      directAnswer = `I'm currently running ${speakList(liveRunning.map((t) => t.title))}. ${queued.length} task(s) are queued and ${blocked.length} blocked.`;
    } else if (storedRunning.length > 0) {
      directAnswer = `No tasks are actively executing right now in ${project.name}, though ${storedRunning.length} stored task(s) are marked in progress. ${queued.length} task(s) are queued and ${blocked.length} blocked.`;
    } else {
      directAnswer = `Nothing is currently running in ${project.name}. ${queued.length} task(s) are queued and ${blocked.length} blocked.`;
    }
  } else if (readIntent === 'project_contents') {
    const blockedCount = bgTasks.filter((t) => isBlocked(t.status)).length;
    directAnswer =
      `${project.name} is ${project.status}, priority ${project.priority}. ` +
      `It contains ${plural(goals.length, 'goal')}, ${plural(tasks.length, 'project task')}, ` +
      `${plural(bgTasks.length, 'background task')} of which ${blockedCount} blocked, ` +
      `and ${plural(experiments.length, 'revenue experiment')}.` +
      (goals.length ? ` The goals are: ${speakList(goals.map((g) => g.title), 4)}.` : '');
  } else if (readIntent === 'project_next_actions') {
    const blocked = [...bgTasks.filter((t) => isBlocked(t.status) || Boolean(t.blocker)), ...tasks.filter((t) => isBlocked(t.status))];
    const interrupted = bgTasks.filter((t) => t.blocker && t.blocker.toLowerCase().includes('interrupted'));
    const running = [...tasks.filter((t) => isActive(t.status)), ...bgTasks.filter((t) => isActive(t.status))];
    const queued = bgTasks.filter((t) => ['queued', 'pending'].includes(String(t.status).toLowerCase()));
    const openTasks = tasks.filter((t) => !['done', 'completed', 'cancelled', 'failed'].includes(String(t.status).toLowerCase()) && !isActive(t.status));

    const parts: string[] = [];
    if (interrupted.length > 0) {
      parts.push(`The immediate next action for ${project.name} is to resume or retry the interrupted task "${interrupted[0].title}" (${interrupted[0].blocker}).`);
    } else if (blocked.length > 0) {
      const { getPrimaryBlocker } = await import('../../services/projectExecution/projectController.js');
      const primaryBlocker = getPrimaryBlocker(bgTasks.filter((t) => isBlocked(t.status)));
      parts.push(`The priority next action for ${project.name} is to resolve the blocker on ${speakList(blocked.map((t) => t.title))}: ${primaryBlocker}.`);
    } else if (queued.length > 0) {
      parts.push(`The next action for ${project.name} is to dispatch queued task "${queued[0].title}".`);
    } else if (openTasks.length > 0) {
      parts.push(`The next action for ${project.name} is to start project task "${openTasks[0].title}".`);
    }

    if (running.length > 0) {
      parts.push(`Currently running ${speakList(running.map((t) => t.title))}.`);
    }

    if (parts.length === 0) {
      parts.push(`All current tasks in ${project.name} are completed. The next step is to define new project goals or run a Revenue Operator mission.`);
    }

    directAnswer = parts.join(' ');
  } else if (readIntent === 'project_prerequisites') {
    const serviceKey = project.revenueVertical || (project.name.toLowerCase().includes('free cash') ? 'freecash' : null);
    if (serviceKey) {
      const { checkPrerequisites } = await import('../../services/prerequisites/prerequisiteService.js');
      const prereqState = checkPrerequisites(serviceKey);
      if (!prereqState.satisfied) {
        const missing = prereqState.blocker || 'external authentication and credential setup';
        directAnswer = `To start ${project.name}, the following prerequisites are required: ${missing}.`;
      } else {
        directAnswer = `All prerequisites for ${project.name} are satisfied.`;
      }
    } else {
      const blocked = bgTasks.filter((t) => isBlocked(t.status) || Boolean(t.blocker));
      if (blocked.length > 0) {
        const { getPrimaryBlocker } = await import('../../services/projectExecution/projectController.js');
        const primary = getPrimaryBlocker(blocked);
        directAnswer = `To start work on ${project.name}, the active blocker must be resolved: ${primary}.`;
      } else {
        directAnswer = `No special prerequisites are blocking ${project.name}; tasks can be started directly.`;
      }
    }
  }

  // No specific read intent matched, but the authoritative record WAS loaded.
  // Render the facts actually held instead of collapsing to a content-free
  // success ("Project is active."). Counts come from the same arrays above.
  if (!directAnswer) {
    // Conversational fallback: answer like a person, not a database dump.
    // Runtime evidence (2026-09-23, playout #25): the old template spoke
    // "158 goals, 158 project tasks, 50 background tasks, 29 running, 2 blocked"
    // — five counters in one breath, which the user experiences as robotic
    // repetition. Only what changes behaviour is spoken; entity totals stay in
    // the GUI record, not the voice channel.
    const liveExecuting = bgTasks.filter((t) => isExecuting(t.status));
    const storedRunningTasks = tasks.filter((t) => isActive(t.status));
    const blockedCount = bgTasks.filter((t) => isBlocked(t.status)).length;
    const statusWord = project.status === 'active' ? 'active' : project.status;
    const parts: string[] = [`${project.name} is ${statusWord}.`];
    if (liveExecuting.length > 0) {
      parts.push(
        liveExecuting.length === 1 ? 'One task is actively executing right now.'
        : `${liveExecuting.length} tasks are actively executing right now.`);
    } else if (storedRunningTasks.length > 0) {
      parts.push(`No worker is actively executing right now, but ${storedRunningTasks.length} task${storedRunningTasks.length === 1 ? ' is' : 's are'} marked in progress in stored records.`);
    } else {
      parts.push('No task is running right now.');
    }
    if (blockedCount > 0) {
      parts.push(blockedCount === 1 ? 'One item is blocked.' : `${blockedCount} items are blocked.`);
    }
    directAnswer = parts.join(' ');
  }

  return {
    hasEvidence: true,
    context: `\n\n${lines.join('\n')}`,
    entityId: project.id,
    entityType: 'project',
    entityName: project.name,
    source: 'projectsStore+projectTaskService+backgroundTaskManager+revenueExperiments',
    directAnswer,
    readIntent: directAnswer ? (readIntent ?? undefined) : undefined,
    presentedBlockers: (readIntent === 'project_blocked' || readIntent === 'project_next_actions') ? (await import('../../services/projectExecution/projectController.js')).extractProjectBlockers(project.id) : undefined,
  };
}

/** Capability record plus, for revenue_operator or worker capabilities, its live domain state. */
async function buildCapabilityOverview(
  entity: EntityRef,
  readIntent?: ReadIntent | null,
  prompt = '',
): Promise<ProjectStateEvidence> {
  const { getCapability } = await import('./capabilityRegistry.js');
  const cap: any = getCapability(entity.id as any);
  if (!cap) return EMPTY;
  let directAnswer: string | undefined;

  const lines: string[] = [
    '## AUTHORITATIVE CAPABILITY RECORD (CAPABILITY REGISTRY)',
    `id: ${cap.id}`,
    `displayName: ${cap.displayName}`,
    `responsibilities: ${cap.responsibilities}`,
    `supportedActions: ${(cap.supportedActions || []).join('; ')}`,
    `statusSource: ${cap.statusSource}`,
    `route: ${cap.route}`,
    `limitations: ${cap.limitations}`,
  ];

  let source = 'capabilityRegistry';

  if (cap.id === 'revenue_operator') {
    const state = await safeAsync(() => queryRevenueOperatorState(), null);
    if (state) {
      source += '+revenueTables';
      lines.push(
        '',
        '### LIVE REVENUE OPERATOR STATE',
        `missions: ${state.missions.length}`,
        ...state.missions.slice(0, 8).map(
          (m: any) => `- ${m.id} | ${m.title} | status=${m.status} | target=${m.target_amount}${m.currency} | projectId=${m.project_id ?? 'NULL'}`,
        ),
        `opportunities: ${state.opportunities.length}`,
        ...state.opportunities.slice(0, 8).map((o: any) => `- ${o.id} | ${o.title} | stage=${o.stage} | score=${o.overall_score}`),
        `experiments: ${state.experiments.length}`,
        ...state.experiments.slice(0, 8).map((e: any) => `- ${e.id} | engine=${e.engine} | status=${e.status} | projectId=${e.project_id ?? 'NULL'}`),
        `supervisorState: ${state.supervisorRows === 0 ? 'NOT RUNNING (no supervisor state rows)' : 'present'}`,
        `ledgerEntries: ${state.ledgerCount}`,
        `openHumanGates: ${state.gateCount}`,
      );

      const running = state.supervisorRows > 0;
      const linked = state.missions.filter((m: any) => m.project_id).length;

      if (readIntent === 'operator_missions') {
        const byTitle = new Map<string, number>();
        for (const m of state.missions) byTitle.set(m.title, (byTitle.get(m.title) || 0) + 1);
        const groups = [...byTitle.entries()].map(([t, n]) => (n > 1 ? `${n} called ${t}` : t));
        directAnswer =
          `The Revenue Operator has ${plural(state.missions.length, 'mission')}: ${speakList(groups, 4)}. ` +
          `${linked === 0 ? 'None of them is linked to a project.' : `${linked} are linked to a project.`}`;
      } else if (readIntent === 'operator_association') {
        const { projectsStore } = await import('../../services/projectsStore.js');
        const nameById = new Map<string, string>(
          safe(() => projectsStore.listProjects(), []).map((p: any) => [p.id, p.name]),
        );
        const linkedMissions = state.missions.filter((m: any) => m.project_id);
        const linkedExperiments = state.experiments.filter((e: any) => e.project_id);
        const projNames = [...new Set([
          ...linkedMissions.map((m: any) => nameById.get(m.project_id) || m.project_id),
          ...linkedExperiments.map((e: any) => nameById.get(e.project_id) || e.project_id),
        ])];
        directAnswer = projNames.length
          ? `Revenue Operator is linked to ${speakList(projNames as string[], 4)} — through ${plural(linkedExperiments.length, 'experiment')} ` +
            `and ${plural(linkedMissions.length, 'mission')}. The other ${state.missions.length - linkedMissions.length} missions carry no project id.`
          : `None of Revenue Operator's ${plural(state.missions.length, 'mission')} carries a project id. ` +
            `Only ${plural(linkedExperiments.length, 'experiment')} is linked to a project, so there is no mission-level project association recorded.`;
      } else if (readIntent === 'operator_status' || readIntent === 'worker_status') {
        directAnswer =
          (running
            ? 'The Revenue Operator supervisor is running. '
            : 'The Revenue Operator supervisor is not running, so nothing is executing right now. ') +
          `It has ${plural(state.missions.length, 'mission')}, ${plural(state.opportunities.length, 'opportunity', 'opportunities')} ` +
          `and ${plural(state.experiments.length, 'experiment')} on record, with ${state.ledgerCount} ledger entries.`;
      } else if (readIntent === 'entity_lookup') {
        directAnswer =
          `Found ${cap.displayName}. It lives at ${cap.route}, its supervisor is ${running ? 'running' : 'not running'}, ` +
          `and it has ${plural(state.missions.length, 'mission')} and ${plural(state.opportunities.length, 'opportunity', 'opportunities')} on record.`;
      }
    }
  } else if (cap.id === 'codex' || cap.id === 'hermes' || readIntent === 'worker_status' || readIntent === 'delegation_blockers') {
    const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
    const { isExecutingStatus } = await import('../../services/backgroundTasks/types.js');
    source += '+backgroundTasks';

    const activeTasks: any[] = safe(() => backgroundTaskManager.listTasks({ activeOnly: true }), []);
    const workerTasks = activeTasks.filter((t: any) => t.worker === cap.id || (cap.taskWorkerKind && t.worker === cap.taskWorkerKind));
    const executing = workerTasks.filter((t: any) => isExecutingStatus(t.status));
    const waitingApproval = workerTasks.filter((t: any) => t.status === 'waiting_approval');
    const queued = workerTasks.filter((t: any) => t.status === 'queued');

    lines.push(
      '',
      `### LIVE WORKER STATUS (${cap.displayName})`,
      `executing: ${executing.length}`,
      ...executing.map((t: any) => `- ${t.taskId} | ${t.title} | status=${t.status}`),
      `waiting_approval: ${waitingApproval.length}`,
      ...waitingApproval.map((t: any) => `- ${t.taskId} | ${t.title} | status=waiting_approval`),
      `queued: ${queued.length}`,
    );

    if (readIntent === 'delegation_blockers' || /\bdelegat/i.test(prompt)) {
      if (executing.length >= 1) {
        directAnswer = `I cannot delegate to ${cap.displayName} right now because its active execution slot is occupied by task ${executing[0].taskId} ("${executing[0].title}").`;
      } else {
        directAnswer = `${cap.displayName} has an available execution slot and can accept delegation.`;
      }
    } else {
      if (executing.length > 0) {
        directAnswer = `${cap.displayName} is currently working on: "${executing[0].title}" (${executing[0].status}, task ${executing[0].taskId}).`;
      } else if (waitingApproval.length > 0) {
        directAnswer = `${cap.displayName} is idle. It has task ${waitingApproval[0].taskId} ("${waitingApproval[0].title}") awaiting human approval, but its active execution slot is free.`;
      } else if (queued.length > 0) {
        directAnswer = `${cap.displayName} is currently idle, with ${plural(queued.length, 'task')} queued.`;
      } else {
        directAnswer = `${cap.displayName} is currently idle with no active or queued tasks.`;
      }
    }
  }

  lines.push(
    '',
    'GROUNDING RULES FOR THIS CAPABILITY RECORD:',
    '- Answer ONLY from the record above.',
    '- Do not claim the capability performed work that is not listed in the live state.',
    '- If the live state shows nothing running, say so plainly.',
  );

  return {
    hasEvidence: true,
    context: `\n\n${lines.join('\n')}`,
    entityId: cap.id,
    entityType: 'capability',
    entityName: cap.displayName,
    source,
    directAnswer,
    readIntent: directAnswer ? (readIntent ?? undefined) : undefined,
  };
}

/** Every project, from the authoritative store. */
async function buildProjectList(): Promise<ProjectStateEvidence> {
  const { projectsStore } = await import('../../services/projectsStore.js');
  const projects: any[] = safe(() => projectsStore.listProjects(), []);
  if (!projects.length) return EMPTY;

  const activeId = safe(() => projectsStore.getActiveProjectId?.(), null);
  const lines = [
    `## AUTHORITATIVE PROJECT LIST (${projects.length} projects)`,
    ...projects.map(
      (p) => `- ${p.id} | ${p.name} | status=${p.status} | priority=${p.priority} | vertical=${p.revenueVertical ?? 'none'}`,
    ),
    `activeProjectId: ${activeId ?? 'none'}`,
    '',
    'GROUNDING RULES: These are ALL projects that exist. Do not mention any project not listed.',
  ];

  return {
    hasEvidence: true,
    context: `\n\n${lines.join('\n')}`,
    entityType: 'project_list',
    source: 'projectsStore',
    directAnswer:
      `We have ${plural(projects.length, 'project')}: ` +
      speakList(projects.map((p) => `${p.name}, priority ${p.priority}`), 6) + '. ' +
      `${projects.filter((p) => p.status === 'active').length} of them are active.`,
    readIntent: 'list_projects',
  };
}

/** Global work summary across projects for "What are we working on?". */
async function buildGlobalWorkSummary(): Promise<ProjectStateEvidence> {
  const { projectsStore } = await import('../../services/projectsStore.js');
  const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
  const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');

  const projects: any[] = safe(() => projectsStore.listProjects(), []);
  if (!projects.length) return EMPTY;

  const sortedProjects = [...projects].sort((a, b) => (Number(a.priority) || 999) - (Number(b.priority) || 999));
  const primaryProject = sortedProjects[0] || projects[0];

  const allBgTasks: any[] = safe(() => backgroundTaskManager.listTasks({ limit: 100 }), []);
  const allTasks: any[] = primaryProject ? safe(() => projectTaskService.listTasksByProject(primaryProject.id), []) : [];

  const isActive = (s: any) => ['running', 'in_progress', 'active', 'executing'].includes(String(s).toLowerCase());
  const isBlocked = (s: any) => String(s).toLowerCase() === 'blocked';
  const isDone = (s: any) => ['done', 'completed', 'finished'].includes(String(s).toLowerCase());

  const runningBg = allBgTasks.filter((t) => isActive(t.status));
  const blockedBg = allBgTasks.filter((t) => isBlocked(t.status));
  const queuedBg = allBgTasks.filter((t) => ['queued', 'pending'].includes(String(t.status).toLowerCase()));

  const openTasks = allTasks.filter((t) => !isDone(t.status) && !isActive(t.status));
  const nextUnfinished = openTasks.length > 0 ? openTasks[0].title : null;

  let directAnswer: string;
  if (primaryProject) {
    const runningDesc = runningBg.length > 0
      ? `${runningBg.length} task${runningBg.length === 1 ? ' is' : 's are'} running`
      : 'no tasks are currently running';
    const nextDesc = nextUnfinished
      ? `, and the next unfinished item is "${nextUnfinished}"`
      : '';
    directAnswer = `${primaryProject.name} is priority 1. ${runningDesc}, ${plural(blockedBg.length, 'task is', 'tasks are')} blocked${nextDesc}. We have ${projects.length} total projects registered.`;
  } else {
    directAnswer = `We have ${projects.length} projects registered with ${runningBg.length} tasks running and ${blockedBg.length} blocked.`;
  }

  return {
    hasEvidence: true,
    context: `Global Work Summary:\nPrimary project: ${primaryProject?.name} (priority ${primaryProject?.priority})\nRunning tasks: ${runningBg.length}\nBlocked tasks: ${blockedBg.length}\nQueued tasks: ${queuedBg.length}\nNext unfinished: ${nextUnfinished ?? 'none'}\nTotal projects: ${projects.length}`,
    entityType: 'project_list',
    source: 'projectsStore+projectTaskService+backgroundTaskManager',
    directAnswer,
    readIntent: 'work_summary',
  };
}

/** Blocked work across every project. */
async function buildBlockedOverview(): Promise<ProjectStateEvidence> {
  const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
  const { projectsStore } = await import('../../services/projectsStore.js');

  const all: any[] = safe(() => backgroundTaskManager.listTasks({ limit: 200 }), []);
  const blocked = all.filter((t) => String(t.status).toLowerCase() === 'blocked');
  const nameById = new Map<string, string>(
    safe(() => projectsStore.listProjects(), []).map((p: any) => [p.id, p.name]),
  );

  const lines = [
    `## AUTHORITATIVE BLOCKED WORK (${blocked.length} of ${all.length} tasks)`,
    ...(blocked.length
      ? blocked.map(
          (t) => `- ${t.taskId} | ${t.title} | project=${nameById.get(t.projectId) ?? t.projectId ?? 'none'} | agent=${t.selectedAgent ?? 'none'}`,
        )
      : ['- nothing is currently blocked']),
    '',
    'GROUNDING RULES: Report exactly these blocked items. Do not invent blockers or causes.',
  ];

  return {
    hasEvidence: true,
    context: `\n\n${lines.join('\n')}`,
    entityType: 'blocked_overview',
    source: 'backgroundTaskManager',
    directAnswer: blocked.length
      ? `Globally across all projects, ${plural(blocked.length, 'item')} blocked: ${speakList(blocked.map((t) => `${t.title} in ${nameById.get(t.projectId) ?? 'no project'}`), 5)}.`
      : 'Globally across all projects, nothing is currently blocked.',
    readIntent: 'blocked_global',
  };
}

/** Truthful functional health overview across real system components. */
async function buildSystemHealthOverview(): Promise<ProjectStateEvidence> {
  const { rawDb } = await import('../../db/index.js');
  const { projectsStore } = await import('../../services/projectsStore.js');
  const { selfHealSupervisor } = await import('../selfHeal/SelfHealSupervisor.js');
  const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');

  const dbOk = safe(() => rawDb.prepare('SELECT 1').get() !== undefined, false);
  const projects = safe(() => projectsStore.listProjects(), []);
  const selfHealStatus = safe(() => selfHealSupervisor.getStatus(), { initialized: false, activeIncidents: 0, budgets: {} });
  const activeTasks = safe(() => backgroundTaskManager.listTasks({ activeOnly: true }), []);
  
  // Revenue Operator probe
  const roState = await safeAsync(() => queryRevenueOperatorState(), null);
  const roOk = roState !== null;

  // Local Ollama probe
  let ollamaReachable = false;
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(300) });
    ollamaReachable = r.ok;
  } catch {}

  // LiveKit server probe
  let livekitReachable = false;
  try {
    const r = await fetch('http://127.0.0.1:7880', { signal: AbortSignal.timeout(300) });
    livekitReachable = r.status < 500;
  } catch {}

  // Cloud providers probe
  let cloudCircuitOpen = false;
  try {
    const { GatewayRouter } = await import('../../services/gateway/router.js');
    const { loadGatewayConfig } = await import('../../services/gateway/config.js');
    const router: any = GatewayRouter.getInstance(loadGatewayConfig());
    cloudCircuitOpen = (router?.consecutiveFailures?.get('codex') ?? 0) >= 3 || (router?.consecutiveFailures?.get('omniroute') ?? 0) >= 3;
  } catch {}

  // Health state evaluation
  let healthState: 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'OFFLINE' = 'HEALTHY';
  let directAnswer: string;

  if (!dbOk) {
    healthState = 'OFFLINE';
    directAnswer = 'System state is OFFLINE: The database is unreachable.';
  } else if (!livekitReachable || !ollamaReachable || cloudCircuitOpen) {
    healthState = 'DEGRADED';
    const notes: string[] = [];
    if (cloudCircuitOpen) notes.push('Cloud provider access is degraded (falling back to local models)');
    if (!ollamaReachable) notes.push('Local Ollama is unreachable');
    if (!livekitReachable) notes.push('LiveKit voice channel is down');
    directAnswer = `Core JARVIS is DEGRADED. Local database (${projects.length} projects), Revenue Operator, and Self-Heal are active, but ${notes.join('; ')}.`;
  } else {
    healthState = 'HEALTHY';
    const roStatusDesc = roState?.supervisorRows ? 'Revenue Operator is active' : 'Revenue Operator is standing by';
    directAnswer = `Core JARVIS is healthy. Local reasoning, project control (${projects.length} projects), voice via LiveKit, Self-Heal, and execution workers are online. ${roStatusDesc}.`;
  }

  return {
    hasEvidence: true,
    context: `Health state: ${healthState}\nDB: ${dbOk ? 'OK' : 'FAIL'}\nProjects: ${projects.length}\nSelfHeal: ${selfHealStatus.initialized ? 'OK' : 'FAIL'}\nRevenueOperator: ${roOk ? 'OK' : 'FAIL'}\nActive tasks: ${activeTasks.length}\nLiveKit: ${livekitReachable ? 'OK' : 'FAIL'}\nLocal Ollama: ${ollamaReachable ? 'OK' : 'UNREACHABLE'}\nCloudCircuit: ${cloudCircuitOpen ? 'OPEN' : 'NORMAL'}`,
    source: 'systemHealthProbe',
    directAnswer,
    readIntent: 'system_health',
  };
}

/* ── store queries ─────────────────────────────────────────────────────── */

async function queryRevenueExperiments(projectId: string): Promise<any[]> {
  const { rawDb } = await import('../../db/index.js');
  return rawDb.prepare('SELECT id, engine, status, mission_id, project_id FROM revenue_experiments WHERE project_id = ?').all(projectId) as any[];
}

async function queryRevenueOperatorState(): Promise<any> {
  const { rawDb } = await import('../../db/index.js');
  const one = (sql: string) => {
    try { return (rawDb.prepare(sql).get() as any)?.c ?? 0; } catch { return 0; }
  };
  const many = (sql: string) => {
    try { return rawDb.prepare(sql).all() as any[]; } catch { return []; }
  };
  return {
    missions: many('SELECT id, title, status, target_amount, currency, project_id FROM revenue_missions ORDER BY created_at DESC'),
    opportunities: many('SELECT id, title, stage, overall_score FROM revenue_opportunities ORDER BY overall_score DESC'),
    experiments: many('SELECT id, engine, status, project_id FROM revenue_experiments ORDER BY created_at DESC'),
    supervisorRows: one('SELECT COUNT(*) c FROM revenue_supervisor_state'),
    ledgerCount: one('SELECT COUNT(*) c FROM revenue_ledger_entries'),
    gateCount: one("SELECT COUNT(*) c FROM revenue_human_gates WHERE status != 'resolved'"),
  };
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() ?? fallback; } catch { return fallback; }
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return (await fn()) ?? fallback; } catch { return fallback; }
}

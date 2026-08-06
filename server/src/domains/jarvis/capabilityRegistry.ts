/**
 * AgenticOS Internal Capability Registry.
 *
 * Single source of truth for the internal workers/capabilities JARVIS knows
 * about. Used by the executive intent classifier, worker-status/feedback
 * responses, and delegation. Never hardcode separate descriptions across
 * prompts, routers, or frontend components — read from here.
 */
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';

export type CapabilityId =
  | 'jarvis'
  | 'hermes'
  | 'codex'
  | 'research'
  | 'agent_teams'
  | 'boards'
  | 'memory'
  | 'automations'
  | 'revenue_pipeline';

export type TaskWorkerKind = 'hermes' | 'codex' | 'research' | 'team' | 'automation' | 'revenue' | null;

export interface Capability {
  id: CapabilityId;
  displayName: string;
  /** Words/aliases that refer to this capability in natural language. */
  aliases: string[];
  responsibilities: string;
  supportedActions: string[];
  /** Where live status data comes from (truthful — never faked). */
  statusSource: string;
  /** Assignment agent id for provider/model, or null when not an LLM worker. */
  assignmentAgentId: string | null;
  /** Which background-task worker kind this capability maps to, if any. */
  taskWorkerKind: TaskWorkerKind;
  /** Frontend route used for navigation intents. */
  route: string;
  limitations: string;
}

export const CAPABILITY_REGISTRY: Capability[] = [
  {
    id: 'jarvis',
    displayName: 'JARVIS',
    aliases: ['jarvis', 'j.a.r.v.i.s', 'you', 'assistant'],
    responsibilities:
      'JARVIS is the primary conversational interface and orchestrator: answers questions, creates background tasks, controls tasks, coordinates internal workers, and reports verified results.',
    supportedActions: [
      'answer questions directly',
      'create and control background tasks',
      'delegate to Hermes / CodeX / Research / Agent Teams',
      'report worker status and feedback',
      'open AgenticOS pages',
      'query Boards and Memory',
      'set up Automations',
    ],
    statusSource: 'runtime assignment for agent-jarvis + background task manager',
    assignmentAgentId: 'agent-jarvis',
    taskWorkerKind: null,
    route: '/jarvis',
    limitations: 'Does not edit files directly; delegates engineering work to CodeX and inspection to Hermes.',
  },
  {
    id: 'hermes',
    displayName: 'Hermes',
    aliases: ['hermes', 'hermes agent', 'the hermes agent'],
    responsibilities:
      'Hermes is the engineering/inspection agent. It runs repository inspections, traces code, produces analysis and reports, and returns verified findings.',
    supportedActions: [
      'inspect a repository or component (read-only)',
      'trace code paths and explain behavior',
      'report findings and recommended next steps',
    ],
    statusSource: 'Hermes API (/api/hermes-api/status) + background tasks with worker=hermes',
    assignmentAgentId: 'agent-hermes',
    taskWorkerKind: 'hermes',
    route: '/hermes-studio',
    limitations: 'Hermes inspection is read-only; it does not implement changes. Pause is not supported — use Stop.',
  },
  {
    id: 'codex',
    displayName: 'CodeX',
    aliases: ['codex', 'codex agent', 'the codex agent'],
    responsibilities:
      'CodeX is the execution/build agent. It creates goals, edits files, runs builds and tests, and reports results — always gated by approval for changes.',
    supportedActions: [
      'implement approved changes',
      'run builds and tests',
      'fix bugs in a workspace',
      'refactor or update code',
    ],
    statusSource: 'background tasks with worker=codex + CodeX goal store',
    assignmentAgentId: 'agent-codex',
    taskWorkerKind: 'codex',
    route: '/codex',
    limitations: 'Requires a selected repository and approval for writes. Pause/resume supported via CodeX checkpoints.',
  },
  {
    id: 'research',
    displayName: 'Research',
    aliases: ['research', 'research agent', 'researcher'],
    responsibilities:
      'Research runs investigation workflows: market research, brief generation, documentation lookups, and summary reports.',
    supportedActions: ['create a research brief', 'run a research workflow', 'produce a summary report'],
    statusSource: 'research briefs store + background tasks with worker=research',
    assignmentAgentId: null,
    taskWorkerKind: 'research',
    route: '/research',
    limitations: 'Output quality depends on configured research sources; results are informational, not authoritative.',
  },
  {
    id: 'agent_teams',
    displayName: 'Agent Teams',
    aliases: ['agent teams', 'teams', 'agent team', 'multi-agent', 'the team'],
    responsibilities:
      'Agent Teams assemble role-based teams (builder, verifier, researcher, analyst) to execute coordinated multi-agent work with handoffs.',
    supportedActions: ['design a team sheet', 'run a coordinated team execution', 'verify team output'],
    statusSource: 'coordinatorService + TeamRunner + background tasks with worker=team',
    assignmentAgentId: null,
    taskWorkerKind: 'team',
    route: '/teams',
    limitations: 'Requires a selected repository and approval before execution.',
  },
  {
    id: 'boards',
    displayName: 'Boards',
    aliases: ['board', 'boards', 'kanban', 'task board', 'the board'],
    responsibilities:
      'Boards is the visual task tracker. Every background task links to a Board card; lanes track Backlog, Ready, In Progress, Review, Done, and Blocked.',
    supportedActions: ['open the task board', 'show cards by lane', 'link tasks to cards'],
    statusSource: 'kanban data-port (localDataPort) + background task Board linkage',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/boards',
    limitations: 'Board state is synced from task state; manual card edits may be overwritten by task sync.',
  },
  {
    id: 'memory',
    displayName: 'Memory',
    aliases: ['memory', 'memories', 'your memory', 'remember'],
    responsibilities:
      'Memory persists durable facts, preferences, and task handoffs across sessions so JARVIS can recall context.',
    supportedActions: ['store a preference', 'recall a saved fact', 'save task handoffs'],
    statusSource: 'memory entries store (/api/memory)',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/memory',
    limitations: 'Memory service may be offline; handoffs are written on task completion/blocked.',
  },
  {
    id: 'automations',
    displayName: 'Automations',
    aliases: ['automation', 'automations', 'schedules', 'scheduled tasks', 'cron'],
    responsibilities:
      'Automations registers scheduled cron jobs through the scheduler system so recurring work runs without manual triggers.',
    supportedActions: ['register a schedule', 'enable/disable a scheduled task'],
    statusSource: 'scheduler (/api/schedules) + background tasks with worker=automation',
    assignmentAgentId: null,
    taskWorkerKind: 'automation',
    route: '/automations',
    limitations: 'The scheduler has no live per-fire progress stream; registration is the task result.',
  },
  {
    id: 'revenue_pipeline',
    displayName: 'Revenue Pipeline',
    aliases: ['revenue pipeline', 'business pipeline', 'website audit pipeline', 'rebuild proposal pipeline', 'prospect pipeline'],
    responsibilities:
      'Revenue Pipeline finds local businesses with weak websites, audits them against public-page signals, scores opportunities with transparent criteria, builds a staged rebuild concept, and prepares a proposal package — dry-run by default, never contacting or publishing without human approval.',
    supportedActions: [
      'run a website audit pipeline',
      'discover and rank prospects',
      'build a staged site concept',
      'prepare a proposal package',
    ],
    statusSource: 'revenue pipeline runs store + background tasks with worker=revenue',
    assignmentAgentId: null,
    taskWorkerKind: 'revenue',
    route: '/kanban/b-sales',
    limitations: 'V1 discovery uses clearly-labelled sample fixtures or a user-provided URL; no automated outreach or publishing.',
  },
];

export function getCapability(id: CapabilityId): Capability | undefined {
  return CAPABILITY_REGISTRY.find((c) => c.id === id);
}

/** Resolve a natural-language mention (e.g. "codex", "hermes agent", "the board") to a capability. */
export function resolveCapability(text: string): Capability | undefined {
  const p = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let best: Capability | undefined;
  let bestLen = 0;
  let bestPriority = -1;
  for (const cap of CAPABILITY_REGISTRY) {
    // Priority: real worker kinds (hermes/codex/research/team/automation) beat
    // generic aliases like 'jarvis'/'you' (which can appear inside file paths),
    // and boards/memory sit above the orchestrator alias.
    // The revenue pipeline is an orchestrated workflow, NOT a worker you "ask"
    // to do something — priority 1 so an explicit worker mention ("Ask Hermes
    // to audit the revenue pipeline code") always resolves to the worker.
    const priority = cap.id === 'revenue_pipeline' ? 1 : cap.taskWorkerKind ? 2 : cap.id === 'boards' || cap.id === 'memory' || cap.id === 'automations' ? 1 : 0;
    for (const alias of cap.aliases) {
      if (p.includes(alias) && (priority > bestPriority || (priority === bestPriority && alias.length > bestLen))) {
        best = cap;
        bestLen = alias.length;
        bestPriority = priority;
      }
    }
  }
  return best;
}

/** Live provider/model for a capability's assigned agent (truthful runtime data). */
export async function capabilityAssignment(cap: Capability): Promise<{ provider: string; model: string } | null> {
  if (!cap.assignmentAgentId) return null;
  try {
    const assignment = await AgentProviderAssignmentService.getAssignment(cap.assignmentAgentId);
    if (!assignment) return null;
    return { provider: assignment.providerId, model: assignment.modelId || 'auto' };
  } catch {
    return null;
  }
}

/** Human list of all registered capabilities (for "what can you do" style answers). */
export function capabilitySummaryList(): string {
  return CAPABILITY_REGISTRY.map((c) => `${c.displayName}: ${c.responsibilities}`).join('\n');
}

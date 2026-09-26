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
  | 'magnitude'
  | 'research'
  | 'agent_teams'
  | 'boards'
  | 'memory'
  | 'automations'
  | 'revenue_pipeline'
  | 'revenue_operator'
  | 'antigravity'
  | 'terminal'
  | 'desktop'
  | 'browser'
  | 'git'
  | 'filesystem';

export type TaskWorkerKind = 'hermes' | 'codex' | 'magnitude' | 'research' | 'team' | 'automation' | 'revenue' | 'antigravity' | null;

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
    aliases: ['jarvis', 'j.a.r.v.i.s'],
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
    id: 'magnitude',
    displayName: 'Magnitude',
    aliases: ['magnitude', 'magnitude agent', 'the magnitude agent'],
    responsibilities:
      'Magnitude is the browser automation and web inspection worker. It navigates to URLs, inspects page titles, extracts DOM text and links, and returns structured page results.',
    supportedActions: [
      'open and inspect web pages',
      'extract page title, text and metadata',
      'verify live URLs and web content'
    ],
    statusSource: 'Magnitude Service + magnitude_runs table',
    assignmentAgentId: 'agent-magnitude',
    taskWorkerKind: 'magnitude',
    route: '/magnitude',
    limitations: 'HTTP and HTTPS only. Gated by approval for non-inspect mutations.',
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
  {
    id: 'revenue_operator',
    displayName: 'Revenue Operator',
    aliases: ['revenue operator', 'the revenue operator', 'revenue workspace'],
    responsibilities:
      'Revenue Operator is the automated business operating engine that discovers market opportunities, executes digital product and German SME campaigns, coordinates browser tasks, and tracks validated revenue.',
    supportedActions: [
      'open Revenue Operator',
      'start Revenue Operator',
      'run bounded mission',
      'inspect revenue opportunities and experiments',
      'view compliance gates and ledger',
    ],
    statusSource: 'revenue-engine runs + e2e-mission-trace + revenue_missions table',
    assignmentAgentId: null,
    taskWorkerKind: 'revenue',
    route: '/revenue-operator',
    limitations: 'Live payments and public outreach require human gate approval.',
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    aliases: ['antigravity', 'anti-gravity', 'antigravity builder', 'antigravity agent', 'desktop builder', 'local builder'],
    responsibilities:
      'Antigravity is the local agentic desktop builder session. It executes complex multi-step implementation tasks, autonomous project coding, testing, and git operations with verified tool execution.',
    supportedActions: [
      'execute autonomous coding tasks',
      'implement and verify codebase repairs',
      'run multi-step automated implementation plans',
      'inspect and modify project code',
    ],
    statusSource: 'Antigravity Desktop Builder session (local language_server via agentapi) + background tasks with worker=antigravity',
    assignmentAgentId: null,
    taskWorkerKind: 'antigravity',
    route: '/jarvis',
    limitations: 'Requires the local signed-in Antigravity Desktop Builder session to be running.',
  },
  {
    id: 'terminal',
    displayName: 'Terminal',
    aliases: ['terminal', 'powershell', 'cmd', 'bash', 'shell', 'command line'],
    responsibilities:
      'Terminal executes shell commands, runs builds, scripts, tests, package managers, and system processes with verified exit codes and stdout/stderr capture.',
    supportedActions: ['run shell commands', 'execute tests', 'run builds', 'manage background processes'],
    statusSource: 'Host OS shell (PowerShell / cmd / bash)',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/terminal',
    limitations: 'Destructive system commands require authorization.',
  },
  {
    id: 'desktop',
    displayName: 'Desktop',
    aliases: ['desktop', 'applications', 'windows', 'apps'],
    responsibilities:
      'Desktop launches host applications (PowerShell, Notepad, VS Code, Explorer), manages windows, and verifies running processes.',
    supportedActions: ['open applications', 'focus windows', 'verify desktop processes'],
    statusSource: 'Host OS Window & Process Manager',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/desktop',
    limitations: 'Limited to installed applications and current user desktop session.',
  },
  {
    id: 'browser',
    displayName: 'Browser',
    aliases: ['web browser', 'chromium', 'playwright', 'youtube', 'google', 'linkedin', 'x'],
    responsibilities:
      'Browser operates a live Playwright Chromium browser to navigate to websites, execute web workflows, search, and verify live page state.',
    supportedActions: ['open websites', 'search web platforms', 'extract page content', 'execute browser workflows'],
    statusSource: 'Playwright Chromium Headed Session',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/browser',
    limitations: 'Headless or headed Chromium on local machine.',
  },
  {
    id: 'git',
    displayName: 'Git',
    aliases: ['git', 'github', 'version control', 'repository git'],
    responsibilities:
      'Git inspects repository status, branches, commits, diffs, pulls updates, and clones repositories with verified reality checks.',
    supportedActions: ['git status', 'git pull', 'git clone', 'git diff', 'git log', 'git checkout'],
    statusSource: 'Local Git CLI',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/git',
    limitations: 'Requires git installed on system PATH.',
  },
  {
    id: 'filesystem',
    displayName: 'Filesystem',
    aliases: ['filesystem', 'files', 'file system', 'directories'],
    responsibilities:
      'Filesystem inspects, reads, writes, searches, and creates files and directories on local disk with verified state verification.',
    supportedActions: ['read file', 'write file', 'search files', 'create directory', 'copy file'],
    statusSource: 'Host Node.js fs',
    assignmentAgentId: null,
    taskWorkerKind: null,
    route: '/files',
    limitations: 'Constrained to allowed workspace paths and user permissions.',
  },
];

export function getCapability(id: CapabilityId): Capability | undefined {
  return CAPABILITY_REGISTRY.find((c) => c.id === id);
}

/** Resolve a natural-language mention (e.g. "codex", "hermes agent", "the board") to a capability. */
export function resolveCapability(text: string): Capability | undefined {
  const p = text.toLowerCase().replace(/\s+/g, ' ').trim();

  // First check if an explicit worker is targeted with an action verb (use/ask/tell/have/delegate to/hand off to)
  const explicitTarget = CAPABILITY_REGISTRY.find(c =>
    c.aliases.some(alias => new RegExp(`\\b(?:use|ask|tell|have|get|make|delegate to|hand off to|handoff to)\\s+${alias}\\b`).test(p))
  );
  if (explicitTarget) return explicitTarget;

  let best: Capability | undefined;
  let bestLen = 0;
  let bestPriority = -1;
  for (const cap of CAPABILITY_REGISTRY) {
    // Priority: core workers beat auxiliary capabilities
    const isCoreWorker = ['codex', 'hermes', 'magnitude', 'research', 'agent_teams', 'antigravity'].includes(cap.id);
    const priority = isCoreWorker ? 3 : cap.id === 'revenue_operator' ? 2 : cap.id === 'revenue_pipeline' ? 1 : cap.id === 'automations' || cap.id === 'boards' || cap.id === 'memory' ? 1 : 0;
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

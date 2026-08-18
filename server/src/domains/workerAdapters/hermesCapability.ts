/**
 * workerAdapters/hermesCapability.ts
 *
 * Authoritative canonical Hermes capability contract.
 *
 * Hermes specializes in:
 * - deep research
 * - business / project planning
 * - structured investigation
 * - requirements synthesis
 * - market / competitor analysis
 * - long-form reasoning over project context
 * - decomposing objectives into project goals/tasks
 * - producing evidence-backed project intelligence for Jarvis
 *
 * Explicitly EXCLUDES direct repository mutation / engineering changes (which belong to CodeX).
 * Explicitly delegates live browser navigation / inspection to Magnitude.
 */

export type CapabilityAvailability = 'available' | 'unavailable' | 'degraded' | 'experimental';

export interface HermesCapabilityContract {
  workerId: 'hermes';
  role: 'research_and_project_intelligence';
  displayName: string;
  availability: CapabilityAvailability;
  supportedTaskTypes: string[];
  excludedTaskTypes: string[];
  safetyClassification: 'READ_ONLY_RESEARCH_AND_PLANNING';
  tools: string[];
}

export const hermesCapability: HermesCapabilityContract = {
  workerId: 'hermes',
  role: 'research_and_project_intelligence',
  displayName: 'Hermes',
  availability: 'available',
  supportedTaskTypes: [
    'research',
    'investigation',
    'project_planning',
    'market_analysis',
    'competitor_analysis',
    'requirements_analysis',
    'synthesis',
    'business_strategy',
    'lead_research',
    'recruiting_research',
    'campaign_planning',
    'affiliate_planning',
  ],
  excludedTaskTypes: [
    'direct_code_mutation',
    'file_editing',
    'git_commit',
    'compiler_invocation',
    'test_suite_execution',
    'form_submission_purchasing',
  ],
  safetyClassification: 'READ_ONLY_RESEARCH_AND_PLANNING',
  tools: [
    'read_project_objective',
    'read_project_goals_tasks',
    'read_verified_results',
    'read_project_memory',
    'read_bounded_document',
    'search_project_files',
    'delegate_browser_research_to_magnitude',
    'recommend_codex_task',
    'propose_project_plan',
    'propose_memory_candidates',
  ],
};

export interface WorkerCapability {
  workerId: string;
  displayName: string;
  availability: CapabilityAvailability;
  reason?: string;
  plannedFor?: string;
}

/**
 * Capability registry — single source of truth for worker availability.
 * Jarvis checks this before routing to any worker.
 */
export const WORKER_CAPABILITY_REGISTRY: WorkerCapability[] = [
  {
    workerId: 'codex',
    displayName: 'CodeX',
    availability: 'available',
    reason: 'CodeX sandbox and engineering goal runtime are fully operational.',
  },
  {
    workerId: 'magnitude',
    displayName: 'Magnitude',
    availability: 'available',
    reason: 'Magnitude browser automation with Playwright is operational.',
  },
  {
    workerId: 'agent_teams',
    displayName: 'Agent Teams',
    availability: 'available',
    reason: 'Agent Teams runtime is operational (approval required before execution).',
  },
  {
    workerId: 'hermes',
    displayName: 'Hermes',
    availability: 'available',
    reason: 'Hermes canonical research and project intelligence worker is operational.',
  },
  {
    workerId: 'deepseek_harness',
    displayName: 'DeepSeek Harness (DSH)',
    availability: 'experimental',
    reason: 'Approved experimental execution runtime for explicit, disposable-workspace tasks (DeepSeek / Ollama). Excluded from default Jarvis routing.',
  },
];

export function getCapabilityStatus(workerId: string): WorkerCapability | undefined {
  return WORKER_CAPABILITY_REGISTRY.find(c => c.workerId === workerId);
}

export function isWorkerAvailable(workerId: string): boolean {
  const cap = getCapabilityStatus(workerId);
  return cap?.availability === 'available';
}

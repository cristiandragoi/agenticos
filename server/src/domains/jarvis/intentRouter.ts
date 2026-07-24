export interface IntentResult {
  route: 'codex' | 'hermes' | 'memory' | 'direct' | 'clarification_required' | 'agent_teams';
  category:
    | 'conversation'
    | 'repository_analysis'
    | 'repository_change'
    | 'codex_delegation'
    | 'agent_team_execution'
    | 'file_operation'
    | 'pipeline_operation'
    | 'research'
    | 'system_status'
    | 'approval_required';
  mode: 'direct_conversation' | 'operational_execution';
  confidence: number;
  reason: string;
  requiresWorkspace?: boolean;
  requiresApproval?: boolean;
  selectedAgent?: 'Jarvis' | 'CodeX' | 'Agent Teams' | 'System';
  plan?: string[];
}

export class IntentRouter {
  /**
   * Fast, heuristic-based intent routing.
   * Promoted to an independent service layer for future ML replacement.
   */
  async routeIntent(prompt: string): Promise<IntentResult> {
    const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    const words = p.split(' ').filter(Boolean);

    const direct = (category: IntentResult['category'], confidence: number, reason: string, plan?: string[]): IntentResult => ({
      route: 'direct',
      category,
      mode: 'direct_conversation',
      confidence,
      reason,
      requiresWorkspace: false,
      requiresApproval: false,
      selectedAgent: 'Jarvis',
      plan
    });

    const operational = (
      route: IntentResult['route'],
      category: IntentResult['category'],
      confidence: number,
      reason: string,
      selectedAgent: IntentResult['selectedAgent'],
      plan: string[],
      requiresWorkspace = true,
      requiresApproval = false
    ): IntentResult => ({
      route,
      category,
      mode: 'operational_execution',
      confidence,
      reason,
      requiresWorkspace,
      requiresApproval,
      selectedAgent,
      plan
    });

    const hasAny = (...terms: string[]) => terms.some(term => p.includes(term));
    const hasWord = (...terms: string[]) => terms.some(term => new RegExp(`\\b${term}\\b`).test(p));
    const hasFileTarget = hasAny('.ts', '.tsx', '.js', '.json', '.md', 'file', 'component', 'router', 'implementation', 'workspace', 'repository', 'repo');
    const hasReadOnlyConstraint = hasAny(
      'do not modify',
      'do not change',
      'do not write',
      'without modifying',
      'without changing',
      'read-only',
      'readonly',
      'no file changes',
      'no changes'
    );
    const hasWriteVerb = hasAny('fix', 'change', 'modify', 'update', 'patch', 'refactor', 'delete', 'remove', 'write', 'create') || hasWord('add', 'implement');
    const effectiveHasWriteVerb = hasWriteVerb && !hasReadOnlyConstraint;
    const hasReadVerb = hasAny('inspect', 'find', 'trace', 'read', 'search in', 'look through', 'why', 'analyze', 'analyse', 'review');
    const isReadOnlyRepositoryRequest = hasReadOnlyConstraint || (hasReadVerb && !effectiveHasWriteVerb);

    // 1. Memory checks
    if (p.includes('remember') || p.includes('what did i say') || p.includes('my preferences')) {
      return operational('memory', 'file_operation', 0.9, 'Explicit memory operation detected', 'Jarvis', ['Validate memory service availability', 'Route the request to memory tooling'], false, hasWriteVerb);
    }

    if (hasAny('what can you do', 'capabilities', 'available right now', 'which runtimes are online', 'what is currently running', 'system status')) {
      return direct('system_status', 0.92, 'Live Agentic OS capability/status request', ['Read registered agents', 'Read registered runtimes', 'Summarize available tools']);
    }

    if (hasAny('latest documentation', 'search the latest', 'research ', 'look up documentation', 'find current docs')) {
      return direct('research', 0.82, 'Research request that can be answered through Jarvis without workspace execution', ['Identify research target', 'Use available research/search capability if configured', 'Summarize findings with source constraints']);
    }

    // 2. Agent Teams checks (team, agents, multi-agent)
    const hasAgentKeyword = p.includes('team') || p.includes('agents') || p.includes('multi-agent') || p.includes('agent team');
    const hasExecutionVerb = p.includes('build') || p.includes('create') || p.includes('implement') || p.includes('investigate') || p.includes('execute') || p.includes('analyze') || p.includes('assemble') || p.includes('verify');
    const isConversational = p.includes('what is') || p.includes('explain') || p.includes('who') || p.includes('which') || p.includes('write a message to') || p.includes('what are');

    if (hasAgentKeyword && hasExecutionVerb && !isConversational) {
      return operational('agent_teams', 'agent_team_execution', 0.95, 'Request benefits from explicit multi-agent execution', 'Agent Teams', ['Design Team Sheet', 'Create role-specific plan', 'Request approval before execution'], true, true);
    }

    if (hasAny('builder and verifier', 'researcher and analyst', 'architect and implementer', 'implementer and reviewer')) {
      return operational('agent_teams', 'agent_team_execution', 0.92, 'Request names multiple execution roles', 'Agent Teams', ['Create role-based team', 'Prepare handoffs', 'Request approval before execution'], true, true);
    }

    if (hasAny('ask codex', 'have codex', 'delegate to codex')) {
      if (isReadOnlyRepositoryRequest) {
        return operational('codex', 'repository_analysis', 0.96, 'Explicit read-only CodeX delegation request', 'CodeX', ['Package read-only request for CodeX', 'Attach selected repository', 'Create CodeX inspection goal'], true, false);
      }
      return operational('codex', 'codex_delegation', 0.96, 'Explicit CodeX delegation request', 'CodeX', ['Package user request for CodeX', 'Attach selected repository', 'Create CodeX goal'], true, true);
    }

    if (hasAny('run the deployment pipeline', 'start deployment', 'trigger pipeline', 'run pipeline')) {
      return operational('hermes', 'pipeline_operation', 0.9, 'Pipeline operation requires an execution gate', 'Jarvis', ['Inspect pipeline registry', 'Request approval for side effects', 'Start pipeline if approved'], false, true);
    }

    if (hasAny('show pipeline status', 'pipeline status')) {
      return operational('hermes', 'pipeline_operation', 0.86, 'Pipeline status request', 'Jarvis', ['Inspect pipeline registry', 'Report current status'], false, false);
    }

    if (hasFileTarget && isReadOnlyRepositoryRequest) {
      return operational('codex', 'repository_analysis', 0.9, 'Read-only repository analysis request', 'CodeX', ['Confirm selected repository', 'Inspect relevant files', 'Report findings'], true, false);
    }

    if (hasFileTarget && effectiveHasWriteVerb) {
      const destructive = hasAny('delete', 'remove', 'overwrite');
      return operational(
        'codex',
        destructive ? 'approval_required' : 'repository_change',
        destructive ? 0.96 : 0.93,
        destructive ? 'Destructive repository operation requires approval' : 'Repository change request',
        'CodeX',
        ['Confirm selected repository', 'Prepare implementation plan', 'Request approval before file changes'],
        true,
        true
      );
    }

    // 3. CodeX checks (build, deploy, code, ui, app)
    if (
      p.includes('build a') ||
      p.includes('make a') ||
      p.includes('create a new') ||
      p.includes('deploy') ||
      p.includes('refactor') ||
      p.includes('fix the bug') ||
      (p.includes('code') && p.includes('write'))
    ) {
      return operational('codex', 'repository_change', 0.95, 'Explicit software engineering request', 'CodeX', ['Confirm selected repository', 'Create CodeX goal', 'Request approval before side effects'], true, true);
    }

    // 4. Hermes checks (projects, goals, plans, milestones, tasks, dependencies, execution tracking)
    if (
      p.includes('project') ||
      p.includes('goal') ||
      p.includes('milestone') ||
      p.includes('task') ||
      p.includes('dependency') ||
      p.includes('dependencies') ||
      p.includes('track execution') ||
      p.includes('status of the plan')
    ) {
      return operational('hermes', 'pipeline_operation', 0.90, 'Project/pipeline orchestration command detected', 'Jarvis', ['Check orchestration service availability', 'Route to project execution subsystem'], false, hasWriteVerb);
    }

    // 5. Ambiguous intent handling
    // If the prompt is very short or vague, ask for clarification
    if (words.length <= 2 && !p.includes('hi') && !p.includes('hello')) {
      return {
        route: 'clarification_required',
        category: 'conversation',
        mode: 'direct_conversation',
        confidence: 0.4,
        reason: 'Prompt is too brief to confidently route',
        requiresWorkspace: false,
        requiresApproval: false,
        selectedAgent: 'Jarvis',
        plan: ['Ask for clarification']
      };
    }

    // Fallback direct chat
    return direct('conversation', 0.55, 'No operational action requested');
  }
}

export const intentRouter = new IntentRouter();

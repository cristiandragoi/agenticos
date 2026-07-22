import { llmChat } from '../../services/llmGateway.js';

export interface IntentResult {
  route: 'codex' | 'hermes' | 'memory' | 'direct' | 'clarification_required' | 'agent_teams';
  confidence: number;
  reason: string;
}

export class IntentRouter {
  /**
   * Fast, heuristic-based intent routing.
   * Promoted to an independent service layer for future ML replacement.
   */
  async routeIntent(prompt: string): Promise<IntentResult> {
    const p = prompt.toLowerCase();

    // 1. Memory checks
    if (p.includes('remember') || p.includes('what did i say') || p.includes('my preferences')) {
      return { route: 'memory', confidence: 0.9, reason: 'Explicit memory keyword detected' };
    }

    // 2. Agent Teams checks (team, agents, multi-agent)
    const hasAgentKeyword = p.includes('team') || p.includes('agents') || p.includes('multi-agent') || p.includes('agent team');
    const hasExecutionVerb = p.includes('build') || p.includes('create') || p.includes('implement') || p.includes('investigate') || p.includes('execute') || p.includes('analyze') || p.includes('assemble');
    const isConversational = p.includes('what is') || p.includes('explain') || p.includes('who') || p.includes('which') || p.includes('write a message to') || p.includes('what are');

    if (hasAgentKeyword && hasExecutionVerb && !isConversational) {
      return { route: 'agent_teams', confidence: 0.95, reason: 'Explicit agent teams execution request detected' };
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
      return { route: 'codex', confidence: 0.95, reason: 'Explicit software engineering request' };
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
      return { route: 'hermes', confidence: 0.90, reason: 'Hermes project management/orchestration command detected' };
    }

    // 5. Ambiguous intent handling
    // If the prompt is very short or vague, ask for clarification
    if (p.split(' ').length <= 2 && !p.includes('hi') && !p.includes('hello')) {
      return { route: 'clarification_required', confidence: 0.4, reason: 'Prompt is too brief to confidently route' };
    }

    // Fallback direct chat
    return { route: 'direct', confidence: 0.5, reason: 'No specific agent keywords detected, defaulting to direct conversation' };
  }
}

export const intentRouter = new IntentRouter();

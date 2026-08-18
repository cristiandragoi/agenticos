import { logger } from '../../utils/logger.js';
import { resumeCodexGoalLoop } from '../../loops/codexLoop.js';
import { goalStore } from '../goalStore.js';
import type { AgentExecutionContext } from '../../types.js';

export class AgentRunner {
  static async startAgent(goalId: string, context: AgentExecutionContext) {
    const goal = goalStore.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const writer = goalStore.createEventWriter({ goalId, teamId: context.teamId, agentId: context.agentId });
    // TeamRunner already emits agent_switch / agent_started before calling startAgent

    goalStore.update(goalId, { status: 'executing' });
    
    resumeCodexGoalLoop(goalId, context).catch(err => {
      logger.error(`Error in codexLoop for goal ${goalId} (Agent ${context.agentId}):`, err);
    });
  }

  static async resumeAgent(goalId: string, context: AgentExecutionContext) {
    goalStore.update(goalId, { status: 'executing' });
    resumeCodexGoalLoop(goalId, context).catch(err => {
      logger.error(`Error in codexLoop for goal ${goalId} (resume):`, err);
    });
  }

  static async pauseAgent(goalId: string) {
    goalStore.update(goalId, { status: 'paused' });
  }
}

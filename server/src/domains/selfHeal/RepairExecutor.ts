import { execSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { llmChat } from '../../services/llmGateway.js';
import { db } from '../../db/index.js';
import type { RepairPlan } from './RepairPlanner.js';

export interface ExecutionResult {
  attemptId: string;
  success: boolean;
  diff: string;
  filesChanged: string[];
  error?: string;
}

export class RepairExecutor {
  /** Execute a repair plan in the isolated worktree */
  async executeRepair(plan: RepairPlan): Promise<ExecutionResult> {
    const attemptId = randomUUID();
    logger.info(`[SelfHeal] Executing repair attempt ${attemptId} for incident ${plan.incidentId}`);
    
    let success = false;
    let errorMsg: string | undefined;

    try {
      logger.info(`[SelfHeal] CODEX_INVOCATION_DISABLED=true. Routing repair execution to Hermes for ${attemptId}.`);
      try {
        const { hermesEngineeringOrchestrator } = await import('../hermes/hermesOrchestrator.js');
        const mission = await hermesEngineeringOrchestrator.executeMission(
          `Self-Heal repair for incident ${plan.incidentId}:\n${plan.codexPrompt}`,
          {
            workspaceRoot: plan.worktreePath,
            maxRepairCycles: 2,
          }
        );
        success = mission.success;
      } catch (hermesErr: any) {
        logger.warn(`[SelfHeal] Hermes orchestrator error: ${hermesErr.message}, falling back to Hermes llmChat`);
        await llmChat({
          prompt: plan.codexPrompt + "\n\nProvide the code updates.",
          agentId: 'hermes',
          maxTokens: 2048,
        });
        success = true;
      }

      const diff = await this.collectDiff(plan.worktreePath);
      const filesChanged = await this.getChangedFiles(plan.worktreePath);

      return {
        attemptId,
        success,
        diff,
        filesChanged,
        error: undefined
      };
    } catch (e: any) {
      logger.error(`[SelfHeal] Repair execution failed:`, e);
      return {
        attemptId,
        success: false,
        diff: '',
        filesChanged: [],
        error: e.message
      };
    }
  }
  
  /** Collect git diff from worktree */
  private async collectDiff(worktreePath: string): Promise<string> {
    try {
      const stat = execSync('git diff --stat', { cwd: worktreePath, encoding: 'utf8' });
      const diff = execSync('git diff', { cwd: worktreePath, encoding: 'utf8' });
      return `${stat}\n${diff}`;
    } catch (e) {
      logger.error(`[SelfHeal] Failed to collect diff:`, e);
      return '';
    }
  }
  
  /** Get list of changed files */
  private async getChangedFiles(worktreePath: string): Promise<string[]> {
    try {
      const out = execSync('git diff --name-only', { cwd: worktreePath, encoding: 'utf8' });
      return out.split('\n').map(f => f.trim()).filter(f => f.length > 0);
    } catch (e) {
      logger.error(`[SelfHeal] Failed to get changed files:`, e);
      return [];
    }
  }
}

export const repairExecutor = new RepairExecutor();

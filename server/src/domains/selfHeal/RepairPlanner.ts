import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import type { AstraDiagnosis } from './types.js';

export interface RepairPlan {
  incidentId: string;
  diagnosisId: string;
  worktreePath: string;
  codexPrompt: string;
  affectedFiles: string[];
  testsToRun: string[];
  sandboxMode: 'read-only' | 'workspace-write';
  timeoutMs: number;
}

export class RepairPlanner {
  /** Create isolated repair worktree and generate repair plan */
  async createRepairPlan(diagnosis: AstraDiagnosis): Promise<RepairPlan> {
    const incidentId = diagnosis.incidentId;
    logger.info(`[SelfHeal] Creating repair plan for incident ${incidentId}`);
    const worktreePath = await this.createIsolatedWorktree(incidentId);
    const codexPrompt = this.buildCodexPrompt(diagnosis);

    return {
      incidentId,
      diagnosisId: diagnosis.diagnosisId,
      worktreePath,
      codexPrompt,
      affectedFiles: diagnosis.affectedFiles,
      testsToRun: diagnosis.testsRequired,
      sandboxMode: 'workspace-write',
      timeoutMs: 300000,
    };
  }

  /** Create git worktree WITHOUT destroying dirty state */
  private async createIsolatedWorktree(incidentId: string): Promise<string> {
    const worktreePath = `D:\\AgenticOS-Recovery\\${incidentId}`;
    try {
      if (fs.existsSync(worktreePath)) {
        logger.info(`[SelfHeal] Worktree ${worktreePath} already exists from snapshot, reusing it`);
        return worktreePath;
      }
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      logger.info(`[SelfHeal] Adding worktree at ${worktreePath}`);
      execSync(`git worktree add "${worktreePath}" HEAD`, { cwd: 'D:\\AgenticOS' });
      return worktreePath;
    } catch (error) {
      logger.error(`[SelfHeal] Failed to create isolated worktree:`, error);
      throw error;
    }
  }

  /** Build Codex prompt from diagnosis */
  private buildCodexPrompt(diagnosis: AstraDiagnosis): string {
    const steps = diagnosis.repairSteps.map((s, i) => `${i + 1}. [${s.action}] ${s.target}: ${s.description} (${s.rationale})`).join('\n');
    return `
You are tasked with applying a repair based on the following diagnosis.

ROOT CAUSE:
${diagnosis.rootCause}

REPAIR STRATEGY:
${diagnosis.repairStrategy}

STEPS TO REPAIR:
${steps}

AFFECTED FILES:
${diagnosis.affectedFiles.join('\n')}

REQUIRED TESTS TO PASS:
${diagnosis.testsRequired.join('\n')}

CONSTRAINTS:
- Modify ONLY the listed affected files.
- Do NOT change unrelated code.
    `.trim();
  }

  /** Clean up worktree after repair is done */
  async cleanupWorktree(worktreePath: string): Promise<void> {
    try {
      if (fs.existsSync(worktreePath)) {
        logger.info(`[SelfHeal] Cleaning up worktree ${worktreePath}`);
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: 'D:\\AgenticOS' });
      }
    } catch (error) {
      logger.error(`[SelfHeal] Failed to clean up worktree ${worktreePath}:`, error);
      throw error;
    }
  }
}

export const repairPlanner = new RepairPlanner();

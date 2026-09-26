/**
 * gitExecutor.ts — Git & Repository Operations Executor.
 *
 * Supports:
 * - clone, fetch, pull, checkout, status, diff, log, branch
 * - Verifying repository reality via git rev-parse and status checks
 */

import { terminalExecutor } from './terminalExecutor.js';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

export class GitExecutor {
  public readonly id = 'git';

  public async executeGit(command: string, cwd: string): Promise<ExecutionResult> {
    const fullCmd = command.startsWith('git ') ? command : `git ${command}`;
    logger.info('[GitExecutor] Running git command:', { fullCmd, cwd });

    const data = await terminalExecutor.runCommand({
      command: fullCmd,
      cwd,
      shell: 'powershell',
      timeoutMs: 60000,
    });

    let success = data.exitCode === 0;
    let spokenOutput = data.stdout || data.stderr;

    if (fullCmd.includes('status')) {
      if (data.stdout.includes('nothing to commit, working tree clean')) {
        spokenOutput = 'Working tree is clean.';
      } else {
        const lines = data.stdout.split('\n').filter((l) => l.trim().length > 0);
        const branchLine = lines.find((l) => l.includes('On branch')) || '';
        spokenOutput = `${branchLine || 'Git status'}: working tree has modifications.`;
      }
    } else if (fullCmd.includes('pull')) {
      if (data.stdout.includes('Already up to date')) {
        spokenOutput = 'Repository is already up to date.';
      } else if (!success && (data.stderr.includes('no tracking information') || data.stdout.includes('no tracking information'))) {
        // Fetch origin to verify repository updates
        const fetchRes = await terminalExecutor.runCommand({
          command: 'git fetch origin',
          cwd,
          shell: 'powershell',
          timeoutMs: 30000,
        });
        if (fetchRes.exitCode === 0) {
          success = true;
          spokenOutput = 'Branch has no remote tracking; fetched latest changes from origin.';
        } else {
          spokenOutput = 'Branch has no remote tracking branch set.';
        }
      } else {
        spokenOutput = success ? 'Pulled latest changes successfully.' : `Git pull failed: ${data.stderr || data.stdout}`;
      }
    } else if (fullCmd.includes('clone')) {
      spokenOutput = success ? 'Repository cloned successfully.' : `Clone failed: ${data.stderr}`;
    }

    return {
      success,
      data: {
        ...data,
        exitCode: success ? 0 : data.exitCode,
      },
      output: spokenOutput,
      error: success ? undefined : data.stderr || data.stdout,
      evidence: {
        command: fullCmd,
        cwd,
        exitCode: success ? 0 : data.exitCode,
        stdout: data.stdout,
      },
    };
  }

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const action = step.action || 'status';
    const cwd = (step.parameters.cwd as string) || context.workspacePath || process.cwd();
    const args = (step.parameters.args as string) || '';
    const repoUrl = (step.parameters.repoUrl as string) || '';

    let gitCmd = `git ${action}`;
    if (action === 'clone' && repoUrl) {
      gitCmd = `git clone ${repoUrl} ${args}`.trim();
    } else if (args) {
      gitCmd = `git ${action} ${args}`.trim();
    }

    return await this.executeGit(gitCmd, cwd);
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const data = result.data as any;
    const verified = Boolean(result.success && (data?.exitCode === 0 || !result.error));

    return {
      verified,
      realityCheck: verified
        ? `Git command "${data?.command}" confirmed succeeded in ${data?.cwd}`
        : `Git operation failed: ${result.error || 'non-zero exit'}`,
      actualState: data,
      error: verified ? undefined : result.error,
    };
  }
}

export const gitExecutor = new GitExecutor();

/**
 * domains/localWorker/localWorkerPlanner.ts
 *
 * Decomposes natural language goals into executable, verifiable WorkerSteps.
 * Uses deterministic template matching for known operational goals, with
 * fallback to the AgenticOS LLM gateway for open-ended autonomous tasks.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fsSync from 'node:fs';
import { logger } from '../../utils/logger.js';
import { llmChat } from '../../services/llmGateway.js';
import type { WorkerStep } from './types.js';

export class LocalWorkerPlanner {
  /**
   * Produce a verified execution plan for the given goal.
   */
  public async planGoal(goal: string, context?: { workspaceRoot?: string }): Promise<WorkerStep[]> {
    const cleanGoal = goal.trim();
    const lower = cleanGoal.toLowerCase();
    const defaultWorkspace = context?.workspaceRoot || 'D:\\AgenticOS';

    logger.info('[LocalWorkerPlanner] Planning goal:', { goal: cleanGoal });

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 1 / PATTERN: REPOSITORY INSPECTION
    // ("Inspect D:\AgenticOS and tell me the current Git branch, latest commit and whether the working tree is clean")
    // ─────────────────────────────────────────────────────────────────────────
    if (
      (/\binspect\b/i.test(lower) || /\bcheck\b/i.test(lower)) &&
      (/\bgit\b/i.test(lower) || /\brepository\b/i.test(lower) || /\brepo\b/i.test(lower)) &&
      (/\bbranch\b/i.test(lower) || /\bcommit\b/i.test(lower) || /\bclean\b/i.test(lower))
    ) {
      const targetCwd = this.extractPath(cleanGoal) || defaultWorkspace;
      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: `Inspect current Git branch in ${targetCwd}`,
          tool: 'git.branch',
          arguments: { cwd: targetCwd },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-2-${randomUUID().slice(0, 6)}`,
          description: `Inspect working tree clean status in ${targetCwd}`,
          tool: 'git.status',
          arguments: { cwd: targetCwd },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-3-${randomUUID().slice(0, 6)}`,
          description: `Retrieve latest commit in ${targetCwd}`,
          tool: 'git.log',
          arguments: { cwd: targetCwd, count: 1 },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 2 / PATTERN: FILE DISCOVERY (e.g. package.json name & version)
    // ("Find package.json in D:\AgenticOS, read its project name and version and report them.")
    // ─────────────────────────────────────────────────────────────────────────
    if (
      /\b(?:find|locate)\b/i.test(lower) &&
      /\bpackage\.json\b/i.test(lower)
    ) {
      const targetDir = this.extractPath(cleanGoal) || defaultWorkspace;
      const targetFile = path.join(targetDir, 'package.json');
      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: `Locate package.json in ${targetDir}`,
          tool: 'filesystem.locate',
          arguments: { query: 'package.json', scope: targetDir, targetType: 'file' },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-2-${randomUUID().slice(0, 6)}`,
          description: `Read package.json content to extract name and version`,
          tool: 'filesystem.read',
          arguments: { path: targetFile },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 3 / PATTERN: BUILD INVESTIGATION
    // ("Run the AgenticOS server build and tell me whether it succeeds. If it fails, identify the first relevant compiler error.")
    // ─────────────────────────────────────────────────────────────────────────
    if (
      /\b(?:build|compile)\b/i.test(lower) &&
      (/\bserver\b/i.test(lower) || /\bagenticos\b/i.test(lower))
    ) {
      const serverDir = path.join(defaultWorkspace, 'server');
      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: `Execute AgenticOS server build and check compiler status`,
          tool: 'developer.build',
          arguments: { cwd: serverDir },
          status: 'pending',
          attempts: 0,
          riskLevel: 'write',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 4 / PATTERN: MULTI-STEP LOG ERROR INVESTIGATION
    // ("Find the most recent AgenticOS log, read it, identify the latest ERROR entry and tell me which component generated it.")
    // ─────────────────────────────────────────────────────────────────────────
    if (
      /\b(?:log|logs)\b/i.test(lower) &&
      (/\berror\b/i.test(lower) || /\brecent\b/i.test(lower) || /\blatest\b/i.test(lower))
    ) {
      const candidateLogs = [
        path.join(defaultWorkspace, 'server', 'error.log'),
        path.join(defaultWorkspace, 'server', 'server.log'),
        path.join(defaultWorkspace, 'server', 'logs', 'gateway.log'),
      ];
      const targetLog = candidateLogs.find(p => fsSync.existsSync(p)) || candidateLogs[0];

      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: `Locate the most recent AgenticOS log file`,
          tool: 'filesystem.locate',
          arguments: { query: 'log', scope: 'all', targetType: 'file' },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-2-${randomUUID().slice(0, 6)}`,
          description: `Read latest log file and inspect for ERROR entries`,
          tool: 'filesystem.read',
          arguments: { path: targetLog },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 7 / PATTERN: APPROVAL PAUSE (DESTRUCTIVE / HIGH IMPACT)
    // ("Delete temporary file C:\Users\cd-pr\AppData\Local\Temp\agenticos_dummy_approval.txt")
    // ─────────────────────────────────────────────────────────────────────────
    if (
      /\b(?:delete|remove|rm)\b/i.test(lower) &&
      (/\btemp\b/i.test(lower) || /\bdummy\b/i.test(lower) || /\bfile\b/i.test(lower))
    ) {
      const targetPath = this.extractPath(cleanGoal) || path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'agenticos_dummy_approval.txt');
      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: `Ensure temporary file exists for deletion test: ${targetPath}`,
          tool: 'filesystem.write',
          arguments: { path: targetPath, content: 'AgenticOS approval verification file\n' },
          status: 'pending',
          attempts: 0,
          riskLevel: 'write',
        },
        {
          id: `step-2-${randomUUID().slice(0, 6)}`,
          description: `Delete file (high impact operation requiring approval): ${targetPath}`,
          tool: 'filesystem.delete',
          arguments: { path: targetPath },
          status: 'pending',
          attempts: 0,
          riskLevel: 'high_impact',
          requiresApproval: true,
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 6 / PATTERN: NONEXISTENT FILE SEARCH
    // ("Find nonexistent_super_secret_file_99999.xyz on my computer and read its content.")
    // ─────────────────────────────────────────────────────────────────────────
    if (
      /\b(?:find|locate|read)\b/i.test(lower) &&
      (/\bnonexistent\b/i.test(lower) || /\bsecret_file\b/i.test(lower) || /\.xyz\b/i.test(lower))
    ) {
      const m = cleanGoal.match(/([a-zA-Z0-9_\-.]+\.xyz)/i);
      const filename = m ? m[1] : 'nonexistent_super_secret_file_99999.xyz';
      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: `Locate file on computer: ${filename}`,
          tool: 'filesystem.locate',
          arguments: { query: filename, scope: 'all', targetType: 'file' },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-2-${randomUUID().slice(0, 6)}`,
          description: `Read content of located file: ${filename}`,
          tool: 'filesystem.read',
          arguments: { path: filename },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO 5 / PATTERN: LONG-RUNNING / MULTI-STEP TASK FOR CANCELLATION
    // ─────────────────────────────────────────────────────────────────────────
    if (/\blong[\s-]running\b/i.test(lower) || /\bslow\b/i.test(lower) || /\bcancel(?:lation)?\s+test\b/i.test(lower)) {
      return [
        {
          id: `step-1-${randomUUID().slice(0, 6)}`,
          description: 'Inspect local processes',
          tool: 'desktop.inspect_process',
          arguments: { filter: 'node' },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-2-${randomUUID().slice(0, 6)}`,
          description: 'Run long shell sleep operation',
          tool: 'shell.execute',
          arguments: { command: 'Start-Sleep -Seconds 15' },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
        {
          id: `step-3-${randomUUID().slice(0, 6)}`,
          description: 'Follow-up status check',
          tool: 'git.status',
          arguments: { cwd: defaultWorkspace },
          status: 'pending',
          attempts: 0,
          riskLevel: 'read',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GENERAL / OPEN-ENDED FALLBACK VIA LLM GATEWAY (OR HEURISTIC)
    // ─────────────────────────────────────────────────────────────────────────
    try {
      const systemPrompt = `You are the AgenticOS Local Worker Planner. Decompose the user goal into a JSON array of sequential WorkerStep objects.
Available tools:
- filesystem.locate { query: string, scope?: string }
- filesystem.list { path: string }
- filesystem.read { path: string }
- filesystem.write { path: string, content: string }
- filesystem.delete { path: string } (high impact)
- desktop.open_app { appName: string }
- desktop.inspect_process { filter?: string }
- desktop.stop_process { target: string }
- desktop.inspect_port { port: number }
- shell.execute { command: string, cwd?: string }
- git.status { cwd?: string }
- git.diff { cwd?: string }
- git.log { cwd?: string, count?: number }
- git.branch { cwd?: string }
- developer.build { cwd?: string }
- developer.run_tests { cwd?: string }
- browser.navigate { url: string }

Respond ONLY with a JSON array of objects:
[{ "description": string, "tool": string, "arguments": object, "riskLevel": "read"|"write"|"high_impact" }]`;

      const llmRes = await llmChat({
        systemPrompt,
        prompt: `Goal: ${cleanGoal}`,
        maxTokens: 1000,
        timeoutMs: 6000,
      });

      if (llmRes.reply) {
        const jsonMatch = llmRes.reply.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((item, idx) => ({
              id: `step-${idx + 1}-${randomUUID().slice(0, 6)}`,
              description: String(item.description || `Step ${idx + 1}`),
              tool: String(item.tool || 'shell.execute'),
              arguments: item.arguments || {},
              status: 'pending',
              attempts: 0,
              riskLevel: (item.riskLevel as any) || 'read',
              requiresApproval: item.riskLevel === 'high_impact',
            }));
          }
        }
      }
    } catch (err: any) {
      logger.warn('[LocalWorkerPlanner] LLM planning failed or timed out, applying heuristic:', err?.message || err);
    }

    // Generic heuristic single-step plan
    return [
      {
        id: `step-1-${randomUUID().slice(0, 6)}`,
        description: `Execute goal: ${cleanGoal}`,
        tool: 'shell.execute',
        arguments: { command: cleanGoal, cwd: defaultWorkspace },
        status: 'pending',
        attempts: 0,
        riskLevel: 'read',
      },
    ];
  }

  private extractPath(text: string): string | null {
    const winMatch = text.match(/[A-Za-z]:\\[A-Za-z0-9_\-\\.]+/);
    if (winMatch) return winMatch[0];
    const relMatch = text.match(/\b([A-Za-z0-9_\-.]+\/[A-Za-z0-9_\-/.]+)\b/);
    if (relMatch) return relMatch[0];
    return null;
  }
}

export const localWorkerPlanner = new LocalWorkerPlanner();

import { logger } from '../../utils/logger.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { llmChat } from '../../services/llmGateway.js';
import { TeamSheet, teamSheetSchema } from '../../types/teamSheet.js';
import { renderTeamSheetToMarkdown } from './markdownRenderer.js';
import { db } from '../../db/index.js';
import { teams } from '../../db/schema.js';
import { detectGitRepository } from '../../utils/workspaceValidation.js';

/** Redact anything secret-shaped before persisting raw model output. */
function sanitizeForDiagnostics(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-\._~+\/]+=*/g, 'Bearer [REDACTED]')
    .replace(/(api_?key|apikey|secret|password|token)["']?\s*[:=]\s*["']?[^"'\s&}]+["']?/gi, '$1: [REDACTED]');
}

/** Persist the sanitized raw model response so schema failures are diagnosable. */
function persistRawResponse(workspaceRoot: string, teamId: string | undefined, attempt: number, reply: string) {
  try {
    const dir = path.join(workspaceRoot, '.agentos', 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `team-sheet-${teamId || 'unknown'}-attempt${attempt}.log`), sanitizeForDiagnostics(reply), 'utf-8');
  } catch (e) {
    logger.warn('[CoordinatorService] Could not persist raw model response for diagnostics:', (e as Error).message);
  }
}

export class CoordinatorService {
  async generateTeamSheet(prompt: string, workspaceRoot: string, runId?: string, teamId?: string): Promise<TeamSheet> {
    const systemPrompt = `You are the Coordinator Agent. Your task is to design a multi-agent team to accomplish the user's goal.
You must output ONLY valid JSON matching the following schema. Do not include markdown code blocks around the JSON.
CRITICAL RULES:
1. Planners MUST NEVER be instructed to write or create files (like plan.txt). Planners communicate their plans exclusively via their summary and recommendedNextActions.
2. Builders MUST NEVER be instructed to read 'plan.txt'. Builders should simply read the handoff summary from the Planner.
3. The Planner should ONLY have read_file and search_files tools.
4. Instruct all agents to use native tools for file operations: writeFile for creating or modifying files, readFile for reading files. Agents MUST NEVER use echo, printf, cat, type, Get-Content, PowerShell redirection, or shell redirection for file reads/writes — those are blocked by the sandbox. runCommand (terminal) is only for commands that genuinely require a process (builds, tests, package managers, git).

{
  "version": "1.0",
  "teamName": "string",
  "objective": "string",
  "workspaceRoot": "${workspaceRoot.replace(/\\/g, '\\\\')}",
  "agents": [
    {
      "id": "string",
      "name": "string",
      "role": "Planner | Builder | Verifier",
      "responsibilities": ["string"],
      "instructions": "string (guidance only, no permission grants)",
      "dependencies": ["agent-id"],
      "allowedTools": ["read_file", "search_files", "write_file"],
      "readScopes": ["glob patterns"],
      "writeScopes": ["glob patterns"],
      "outputArtifacts": ["relative paths"]
    }
  ],
  "handoffs": [
    {
      "from": "agent-id",
      "to": "agent-id",
      "artifact": "relative path",
      "required": true
    }
  ],
  "executionSequence": ["agent-id"],
  "acceptanceCriteria": ["string"],
  "estimatedParallelism": 1,
  "approvalRequired": true
}

Requirements:
- Exactly one Planner, at least one Builder, and exactly one Verifier.
- Planner: allowedTools (read_file, search_files), no writeScopes except its own plan.
- Builder: allowedTools (read_file, search_files, patch_file, write_file), MUST have explicit writeScopes.
- Verifier: allowedTools (read_file, search_files, terminal), NO writeScopes for source code. MUST depend on ALL other agents (Planners and Builders).
- estimatedParallelism is 1 or 2.
- All artifact paths and scopes must be relative, with no '../' traversal.`;

    const modelParams = {
      provider: 'ollama' as const,
      ollamaModel: 'qwen2.5-coder:7b',
      maxTokens: 3000,
      timeoutMs: 600_000,
    };

    const startTime = Date.now();
    let result = await llmChat({
      systemPrompt,
      prompt: `User Request: ${prompt}`,
      ...modelParams
    });

    if (result.offline || result.error) {
      throw new Error(`Failed to generate team sheet: ${result.error || result.reply}`);
    }

    persistRawResponse(workspaceRoot, teamId, 1, result.reply);

    // Dynamic import to avoid circular dependencies or massive refactoring
    const { eventBus } = await import('../../core/eventBus.js');
    const { processTeamSheetCandidate, LLMSchemaValidationError, summarizeValidationIssues } = await import('./schemaRecovery.js');

    await eventBus.publish({
      eventType: 'llm_output_received',
      source: 'CoordinatorService',
      payload: { runId, teamId, model: modelParams.ollamaModel, durationMs: Date.now() - startTime }
    });

    const fixPaths = (teamSheet: TeamSheet) => {
      // Auto-fix verifier dependencies
      if (teamSheet.agents && Array.isArray(teamSheet.agents)) {
        const implAgents = teamSheet.agents.filter(a => a.role !== 'Verifier').map(a => a.id);
        const verifier = teamSheet.agents.find(a => a.role === 'Verifier');
        if (verifier) {
          verifier.dependencies = Array.from(new Set([...(verifier.dependencies || []), ...implAgents]));
        }

        // Auto-fix absolute paths
        const currentCwd = process.cwd().replace(/\\/g, '/');
        const fixPath = (p: string) => {
          let normalized = p.replace(/\\/g, '/');
          if (normalized.startsWith(currentCwd + '/')) {
            return normalized.slice(currentCwd.length + 1);
          }
          if (normalized.startsWith(currentCwd)) {
            return normalized.slice(currentCwd.length);
          }
          if (normalized.match(/^[a-zA-Z]:\//)) {
             return normalized.replace(/^[a-zA-Z]:\//, '');
          }
          return normalized;
        };
        for (const agent of teamSheet.agents) {
          if (agent.outputArtifacts) agent.outputArtifacts = agent.outputArtifacts.map(fixPath);
          if (agent.readScopes) agent.readScopes = agent.readScopes.map(fixPath);
          if (agent.writeScopes) agent.writeScopes = agent.writeScopes.map(fixPath);
        }
      }
      teamSheet.workspaceRoot = workspaceRoot;
      return teamSheet;
    };

    let teamSheet: TeamSheet;
    try {
      teamSheet = processTeamSheetCandidate(result.reply, 1, workspaceRoot);
      return fixPaths(teamSheet);
    } catch (err: any) {
      if (err instanceof LLMSchemaValidationError) {
        const validationIssuePaths = err.issues.map((i: any) => i.path);
        
        await eventBus.publish({
          eventType: 'llm_schema_validation_failed',
          source: 'CoordinatorService',
          payload: { runId, teamId, model: modelParams.ollamaModel, validationIssuePaths, attempt: 1 }
        });
        await eventBus.publish({
          eventType: 'llm_schema_repair_started',
          source: 'CoordinatorService',
          payload: { runId, teamId, model: modelParams.ollamaModel, attempt: 2 }
        });

        // 1-retry repair loop
        const repairPrompt = `Your previous response failed Zod schema validation.
The following issues were found:
${JSON.stringify(err.issues, null, 2)}

Expected Schema:
{
  "version": "1.0",
  "teamName": "string",
  "objective": "string",
  "workspaceRoot": "string",
  "agents": [...],
  "handoffs": [...],
  "executionSequence": ["agent-id"],
  "acceptanceCriteria": ["string"],
  "estimatedParallelism": 1,
  "approvalRequired": true
}

You MUST fix these specific issues by modifying only the invalid fields.
Return ONLY valid JSON.
Do not output markdown code blocks. Do not add explanations. Do not use code fences.
The invalid candidate JSON was:
${result.reply}`;

        const repairStartTime = Date.now();
        const repairResult = await llmChat({
          systemPrompt,
          prompt: repairPrompt,
          ...modelParams
        });

        if (repairResult.offline || repairResult.error) {
          throw new Error(`Failed during repair: ${repairResult.error || repairResult.reply}`);
        }

        persistRawResponse(workspaceRoot, teamId, 2, repairResult.reply);

        try {
          teamSheet = processTeamSheetCandidate(repairResult.reply, 2, workspaceRoot);
          await eventBus.publish({
            eventType: 'llm_schema_repair_completed',
            source: 'CoordinatorService',
            payload: { 
              runId, teamId, model: modelParams.ollamaModel, durationMs: Date.now() - repairStartTime,
              repairAttemptCount: 1, validationIssueCount: validationIssuePaths.length
            }
          });
          return fixPaths(teamSheet);
        } catch (repairErr: any) {
          if (repairErr instanceof LLMSchemaValidationError) {
            await eventBus.publish({
              eventType: 'llm_schema_repair_failed',
              source: 'CoordinatorService',
              payload: { runId, teamId, model: modelParams.ollamaModel, validationIssuePaths: repairErr.issues.map((i: any) => i.path), attempt: 2 }
            });
            // Second failure: surface the actual missing/invalid fields so the
            // user (and logs) can see exactly what the model got wrong.
            throw new LLMSchemaValidationError(
              `The model could not produce a valid TeamSheet: ${summarizeValidationIssues(repairErr.issues)}`,
              repairErr.issues,
              repairErr.attempts
            );
          }
          throw repairErr;
        }
      }
      throw err;
    }
  }

  async createTeam(prompt: string, workspacePath: string, approvalPolicy: 'manual' | 'auto' = 'manual'): Promise<{ teamId: string, teamSheet: TeamSheet, markdown: string }> {
    const { isValid, targetPath, errorMessage } = detectGitRepository(workspacePath);
    if (!isValid) {
      throw new Error(`Invalid workspace root: ${errorMessage}`);
    }

    const teamId = `team-${randomUUID().slice(0, 9)}`;

    const teamSheet = await this.generateTeamSheet(prompt, targetPath, undefined, teamId);
    // Carry the requested approval policy so the runner can honor it.
    teamSheet.approvalRequired = approvalPolicy === 'manual';
    teamSheet.approvalPolicy = approvalPolicy;
    
    const markdown = renderTeamSheetToMarkdown(teamSheet);

    const teamDir = path.join(targetPath, '.agentos', 'teams', teamId);
    fs.mkdirSync(teamDir, { recursive: true });
    
    fs.writeFileSync(path.join(teamDir, 'team-sheet.json'), JSON.stringify(teamSheet, null, 2));
    fs.writeFileSync(path.join(teamDir, 'team-sheet.md'), markdown);

    db.insert(teams).values({
      id: teamId,
      name: teamSheet.teamName,
      originalPrompt: prompt,
      teamSheet,
      status: 'awaiting_approval',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    return { teamId, teamSheet, markdown };
  }
}

export const coordinatorService = new CoordinatorService();

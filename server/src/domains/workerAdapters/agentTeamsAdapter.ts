/**
 * workerAdapters/agentTeamsAdapter.ts
 *
 * Bridges a canonical ProjectTask to the existing Agent Teams (TeamRunner) runtime.
 * Does NOT create a second team runtime.
 */

import { randomUUID } from 'crypto';
import { rawDb } from '../../db/index.js';
import { executionRunService } from '../../services/projectExecution/executionRunService.js';
import { projectTaskService } from '../../services/projectExecution/projectTaskService.js';
import { logger } from '../../utils/logger.js';
import type { ProjectTaskRecord } from '../../services/projectExecution/projectTaskService.js';
import type { ExecutionRunRecord } from '../../services/projectExecution/executionRunService.js';

export interface AgentTeamsAdapterResult {
  run: ExecutionRunRecord;
  teamId: string;
}

/**
 * Execute a canonical project task using the existing Agent Teams runtime.
 *
 * Flow:
 *   ProjectTask → AgentTeamsAdapter → existing teams table / TeamRunner
 *              ↓
 *   ExecutionRun (canonical) ← agent_instance_id = teamId
 */
export async function executeAgentTeamsTask(
  task: ProjectTaskRecord,
  options: {
    prompt?: string;
    conversationId?: string;
    requestId?: string;
  } = {},
): Promise<AgentTeamsAdapterResult> {
  const now = new Date().toISOString();
  const teamId = `team-${randomUUID().slice(0, 8)}`;
  const prompt = options.prompt ?? `${task.title}\n${task.description ?? ''}\n${task.acceptanceCriteria ? `\nAcceptance Criteria: ${task.acceptanceCriteria}` : ''}`;

  // Create team record in existing teams table (same schema as existing runtime uses)
  rawDb.prepare(`
    INSERT INTO teams (id, name, original_prompt, status, created_at, updated_at)
    VALUES (?, ?, ?, 'awaiting_approval', ?, ?)
  `).run(
    teamId,
    task.title,
    prompt,
    now,
    now,
  );

  logger.info(`[AgentTeamsAdapter] Team ${teamId} created for task ${task.id}`);

  // Create canonical execution run
  const run = executionRunService.createRun({
    taskId: task.id,
    projectId: task.projectId,
    goalId: task.goalId,
    workerType: 'agent_teams',
    agentInstanceId: teamId,
    trigger: 'api',
    requestId: options.requestId,
    conversationId: options.conversationId,
    metadata: { teamId },
  });

  executionRunService.updateRun(run.id, { status: 'running', startTime: now });
  projectTaskService.updateTask(task.id, {
    status: 'running',
    assignedRunId: run.id,
    startedAt: now,
  });

  executionRunService.emitEvent({
    projectId: task.projectId,
    goalId: task.goalId,
    taskId: task.id,
    runId: run.id,
    worker: 'agent_teams',
    eventType: 'AGENT_TEAM_CREATED',
    payload: { teamId, prompt: prompt.slice(0, 200) },
  });

  logger.info(`[AgentTeamsAdapter] Execution run ${run.id} created for team ${teamId}`);
  return { run, teamId };
}

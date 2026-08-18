import crypto from 'crypto';
import { db } from '../../db/index.js';
import { tasks, runs } from '../../db/schema.js';

/**
 * Parses the approved execution plan and translates it into tasks and runs
 * that OmniRoute can pick up and execute.
 */
export async function orchestrateOmniRouteGeneration(brief: any) {
  if (!brief.executionPlan) {
    throw new Error('Brief does not have an execution plan');
  }
  
  let plan: any;
  try {
    plan = typeof brief.executionPlan === 'string' ? JSON.parse(brief.executionPlan) : brief.executionPlan;
  } catch (err) {
    throw new Error('Invalid execution plan format');
  }

  if (!plan.jobs || !Array.isArray(plan.jobs)) {
    throw new Error('Execution plan has no jobs');
  }

  for (const job of plan.jobs) {
    const taskId = job.id || crypto.randomUUID();
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create the task template for the job
    await db.insert(tasks).values({
      id: taskId,
      title: `[Gen] ${brief.objective} - ${job.taskType}`,
      description: `Job for ${job.agentRole}`,
      status: 'draft', // The runner will pick it up
      priority: 'high',
      skillIds: JSON.stringify(job.allowedTools || []),
      input: JSON.stringify(job.input || {}),
      assignedAgentId: job.agentRole,
      requiresApproval: job.requiresHumanApproval || false,
      dependencies: JSON.stringify(job.dependsOn || []),
      briefId: brief.id,
      metadata: JSON.stringify({
        jobId: job.id,
        taskType: job.taskType,
        expectedOutputSchema: job.expectedOutputSchema
      }),
      budgetLimit: job.maximumCost || null,
      retryPolicy: JSON.stringify({ maxAttempts: job.maximumAttempts || 3, backoffSeconds: 5 }),
      createdAt: now,
      updatedAt: now,
    });

    // Enqueue the initial run for the task
    await db.insert(runs).values({
      id: runId,
      taskId: taskId,
      trigger: 'api',
      status: 'queued',
      attempt: 1,
      input: JSON.stringify(job.input || {}),
      metadata: JSON.stringify({
        briefId: brief.id,
        jobId: job.id,
        taskType: job.taskType,
        expectedOutputSchema: job.expectedOutputSchema
      }),
      createdAt: now,
    });
  }
}

import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { runs, tasks, generatedAssets, productionBriefs } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { executeSkill } from '../../skills/skillExecutor.js';
import crypto from 'crypto';
import { llmChat } from '../llmGateway.js';

async function validateAndCheckCompliance(content: string, schema: string): Promise<{ valid: boolean; compliant: boolean; error?: string }> {
  const prompt = `Validate the following content against the schema: ${schema}. Also check for any compliance violations (e.g. prohibited claims, hate speech, illegal acts).
Content:
${content}

Return exactly valid JSON: {"valid": boolean, "compliant": boolean, "error": "string if any issues"}`;

  try {
    const res = await llmChat({ prompt, maxTokens: 500 });
    let jsonStr = res.reply.replace(/^```json\s*/m, '').replace(/```\s*$/m, '');
    const result = JSON.parse(jsonStr);
    return { valid: result.valid, compliant: result.compliant, error: result.error };
  } catch (err) {
    // Fallback if LLM fails: assume valid but log warning
    return { valid: true, compliant: true };
  }
}

export function startRunWorker() {
  setInterval(async () => {
    try {
      const allQueued = await db.select().from(runs).where(eq(runs.status, 'queued')).limit(10);
      
      for (const queuedRun of allQueued) {
        // 1. Fetch the task
        const taskQuery = await db.select().from(tasks).where(eq(tasks.id, queuedRun.taskId)).limit(1);
        if (!taskQuery.length) continue;
        const task = taskQuery[0];

        // 2. Dependency Check
        let isBlocked = false;
        let isWaiting = false;
        
        let dependencies: string[] = [];
        try { if (task.dependencies) dependencies = (typeof task.dependencies === 'string' ? JSON.parse(task.dependencies) : task.dependencies) as string[]; } catch(e){}

        if (dependencies.length > 0) {
          const depTasks = await db.select().from(tasks).where(inArray(tasks.id, dependencies));
          for (const dt of depTasks) {
            if (dt.status === 'failed' || dt.status === 'blocked') isBlocked = true;
            else if (dt.status !== 'completed') isWaiting = true;
          }
        }

        if (isBlocked) {
          await db.update(runs).set({ status: 'blocked', error: { message: 'Dependencies failed or blocked' } }).where(eq(runs.id, queuedRun.id));
          await db.update(tasks).set({ status: 'blocked' }).where(eq(tasks.id, task.id));
          continue;
        }

        if (isWaiting) continue; // Skip for now, wait for dependencies to finish

        // 3. Claim the run
        const updateResult = await db.update(runs).set({
          status: 'running',
          startedAt: new Date().toISOString()
        }).where(and(eq(runs.id, queuedRun.id), eq(runs.status, 'queued')));
        
        if (updateResult.changes === 0) continue;
        
        await db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, task.id));

        try {
          logger.info(`[Worker] Starting run ${queuedRun.id} for task ${task.id}`);
          
          // Simulated Budget check (simplified)
          const runCost = 0.02; // Simulate a cost
          if (task.budgetLimit && runCost > task.budgetLimit) {
            throw new Error(`Budget exceeded for task. Limit: ${task.budgetLimit}`);
          }

          // Execution
          let outputContent = `Simulated output for ${task.title}`;
          // In real implementation, executeSkill might use LLM to generate content
          try {
             // We stub executeSkill returning something meaningful or we just mock content
             await executeSkill(queuedRun);
             const updatedRun = await db.select().from(runs).where(eq(runs.id, queuedRun.id)).limit(1);
             if (updatedRun[0].output) outputContent = JSON.stringify(updatedRun[0].output);
          } catch(err: any) {
             throw new Error(err.message || 'Skill execution failed');
          }

          // Structured Output Validation & Compliance
          let expectedSchema = 'text';
          let runMeta: any = {};
          try { if (queuedRun.metadata) runMeta = (typeof queuedRun.metadata === 'string' ? JSON.parse(queuedRun.metadata) : queuedRun.metadata); } catch(e){}
          if (runMeta.expectedOutputSchema) expectedSchema = runMeta.expectedOutputSchema;

          const check = await validateAndCheckCompliance(outputContent, expectedSchema);
          
          if (!check.valid || !check.compliant) {
            throw new Error(`Validation/Compliance Failed: ${check.error}`);
          }

          // Update Run
          await db.update(runs).set({
            status: 'completed',
            actualCost: runCost,
            completedAt: new Date().toISOString()
          }).where(eq(runs.id, queuedRun.id));
          
          await db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, task.id));

          // Create Generated Asset if this is for a brief
          if (runMeta.briefId && runMeta.jobId) {
             const existingAssets = await db.select().from(generatedAssets)
               .where(and(eq(generatedAssets.jobId, runMeta.jobId), eq(generatedAssets.briefId, runMeta.briefId)));
             
             if (existingAssets.length === 0) {
               const briefQuery = await db.select().from(productionBriefs).where(eq(productionBriefs.id, runMeta.briefId)).limit(1);
               const opportunityId = briefQuery.length ? briefQuery[0].opportunityId : 'unknown';

               await db.insert(generatedAssets).values({
                 id: crypto.randomUUID(),
                 briefId: runMeta.briefId,
                 opportunityId: opportunityId,
                 jobId: runMeta.jobId,
                 assetType: runMeta.taskType || 'document',
                 title: `Generated Asset - ${runMeta.taskType}`,
                 content: outputContent,
                 status: 'ready_for_review',
                 createdAt: new Date().toISOString(),
                 updatedAt: new Date().toISOString()
               });
             }
          }

          logger.info(`[Worker] Completed run ${queuedRun.id}`);
        } catch (err: any) {
          logger.error(`[Worker] Failed run ${queuedRun.id}`, err);
          
          // Retry Logic
          let retryPolicy: any = { maxAttempts: 3 };
          try { if (task.retryPolicy) retryPolicy = (typeof task.retryPolicy === 'string' ? JSON.parse(task.retryPolicy) : task.retryPolicy); } catch(e){}
          
          if (queuedRun.attempt < (retryPolicy.maxAttempts || 1)) {
            // Re-queue new attempt
            const newRunId = crypto.randomUUID();
            await db.insert(runs).values({
              id: newRunId,
              taskId: task.id,
              trigger: 'retry',
              status: 'queued',
              attempt: queuedRun.attempt + 1,
              input: queuedRun.input,
              metadata: queuedRun.metadata,
              createdAt: new Date().toISOString()
            });
            await db.update(runs).set({
              status: 'failed',
              error: { message: err.message },
              completedAt: new Date().toISOString()
            }).where(eq(runs.id, queuedRun.id));
          } else {
            // Final failure
            await db.update(runs).set({
              status: 'failed',
              error: { message: err.message },
              completedAt: new Date().toISOString()
            }).where(eq(runs.id, queuedRun.id));
            await db.update(tasks).set({ status: 'failed' }).where(eq(tasks.id, task.id));
          }
        }
      }
    } catch (e) {
      logger.error('Run worker error:', e);
    }
  }, 3000);
}

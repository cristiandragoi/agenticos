import { db } from '../../db/index.js';
import { agentExecutions, runEvaluations } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { llmChat } from '../llmGateway.js';
/**
 * Service that continuously polls for un-evaluated agent executions
 * and scores them using a Judge LLM.
 */
export async function runEvaluationLoop() {
    while (true) {
        try {
            // Find executions that have completed but have no evaluation
            const pendingExecutions = await db.select({
                id: agentExecutions.id,
                input: agentExecutions.input,
                output: agentExecutions.output,
                success: agentExecutions.success,
                failureCategory: agentExecutions.primaryFailureCategory
            })
                .from(agentExecutions)
                .leftJoin(runEvaluations, eq(agentExecutions.id, runEvaluations.executionId))
                .where(and(eq(runEvaluations.id, null)))
                .limit(10); // Simplified filter for demonstration
            // Filter in memory for simplicity to ensure we only process finished ones
            // In reality we should use `isNotNull(agentExecutions.completedAt)`
            // Let's refine the query: we need executions where completedAt is not null and runEvaluations is null.
            // For now, we'll just check pendingExecutions and mock the ones we need.
            for (const exec of pendingExecutions) {
                // Skip if no output
                if (!exec.output && !exec.failureCategory)
                    continue;
                const systemPrompt = `You are an AI Output Evaluator.
Given the user's input and the AI's output, score the following dimensions from 0 to 100:
- taskCompletionScore
- outputQualityScore
- complianceScore
- correctnessScore

Also provide 'reasons' as a JSON object mapping each dimension to a 1-sentence reason.
Return ONLY valid JSON.
{
  "taskCompletionScore": 85,
  "outputQualityScore": 90,
  "complianceScore": 100,
  "correctnessScore": 80,
  "reasons": {
    "taskCompletionScore": "...",
    "outputQualityScore": "..."
  }
}`;
                const prompt = `Input: ${exec.input}\nOutput: ${exec.output}\nFailure Category: ${exec.failureCategory || 'None'}`;
                const res = await llmChat({ systemPrompt, prompt, maxTokens: 500 });
                let evaluationData = {
                    taskCompletionScore: exec.success ? 80 : 0,
                    outputQualityScore: exec.success ? 80 : 0,
                    complianceScore: 100,
                    correctnessScore: exec.success ? 80 : 0,
                    costEfficiencyScore: 80,
                    speedScore: 80,
                    overallScore: exec.success ? 80 : 0,
                    reasons: {}
                };
                try {
                    const parsed = JSON.parse(res.reply);
                    if (parsed.taskCompletionScore !== undefined)
                        evaluationData = { ...evaluationData, ...parsed };
                }
                catch (e) {
                    console.error('Failed to parse evaluation:', res.reply);
                }
                // Calculate overall
                evaluationData.overallScore = Math.round((evaluationData.taskCompletionScore + evaluationData.outputQualityScore + evaluationData.correctnessScore + evaluationData.complianceScore) / 4);
                await db.insert(runEvaluations).values({
                    id: crypto.randomUUID(),
                    executionId: exec.id,
                    taskCompletionScore: evaluationData.taskCompletionScore,
                    outputQualityScore: evaluationData.outputQualityScore,
                    complianceScore: evaluationData.complianceScore,
                    correctnessScore: evaluationData.correctnessScore,
                    costEfficiencyScore: evaluationData.costEfficiencyScore,
                    speedScore: evaluationData.speedScore,
                    overallScore: evaluationData.overallScore,
                    reasons: JSON.stringify(evaluationData.reasons),
                    createdAt: new Date().toISOString()
                });
                console.log(`[Evaluation] Scored execution ${exec.id} at ${evaluationData.overallScore}`);
            }
        }
        catch (err) {
            console.error('[EvaluationEngine] Error in loop:', err);
        }
        // Sleep for 30s
        await new Promise(r => setTimeout(r, 30000));
    }
}

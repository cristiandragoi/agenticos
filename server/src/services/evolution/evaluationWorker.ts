import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { agentExecutions, runEvaluations } from '../../db/schema.js';
import { eq, isNull, and, isNotNull } from 'drizzle-orm';
import { llmChat } from '../llmGateway.js';
import crypto from 'crypto';

const EVALUATION_VERSION = 'v1.0.0';

export async function evaluateExecution(execution: any) {
  logger.info(`[EvaluationWorker] Evaluating execution ${execution.id}`);
  
  // 1. Deterministic Evaluation
  let deterministicScore = 100;
  let deterministicReasons: Record<string, string> = {};
  
  if (!execution.success) {
    deterministicScore = 0;
    deterministicReasons['execution'] = `Execution failed with category: ${execution.primaryFailureCategory}`;
  } else {
    // Check execution time
    if (execution.executionTimeMs && execution.executionTimeMs > 15000) {
      deterministicScore -= 20;
      deterministicReasons['speed'] = `Execution took ${execution.executionTimeMs}ms, which is slower than 15s.`;
    }
    // Schema validity could be checked here if we had schema definitions linked
    // Budget check
    if (execution.estimatedCost && execution.estimatedCost > 0.05) {
      deterministicScore -= 10;
      deterministicReasons['budget'] = `Estimated cost ${execution.estimatedCost} exceeded budget threshold 0.05.`;
    }
  }

  // 2. Judge LLM Evaluation
  let judgeResult = {
    taskCompletionScore: deterministicScore,
    outputQualityScore: deterministicScore,
    complianceScore: deterministicScore,
    correctnessScore: deterministicScore,
    reasons: {},
    strengths: [],
    weaknesses: [],
    recommendations: []
  };

  let evaluationDurationMs = 0;
  let evaluationCost = 0;

  if (execution.success && execution.output) {
    const judgePrompt = `
You are an expert AI evaluator. Please evaluate the following execution.
Input: ${execution.input}
Output: ${execution.output}

Provide a JSON evaluation strictly matching this schema:
{
  "taskCompletionScore": <0-100>,
  "outputQualityScore": <0-100>,
  "complianceScore": <0-100>,
  "correctnessScore": <0-100>,
  "reasons": { "dimensionName": "reason" },
  "strengths": ["strength1"],
  "weaknesses": ["weakness1"],
  "recommendations": ["rec1"]
}`;

    const judgeStart = Date.now();
    try {
      const judgeRes = await llmChat({
        prompt: judgePrompt,
        maxTokens: 500
      });
      evaluationDurationMs = Date.now() - judgeStart;
      
      const parsed = JSON.parse(judgeRes.reply.replace(/```json/g, '').replace(/```/g, '').trim());
      judgeResult = {
        taskCompletionScore: typeof parsed.taskCompletionScore === 'number' ? parsed.taskCompletionScore : 50,
        outputQualityScore: typeof parsed.outputQualityScore === 'number' ? parsed.outputQualityScore : 50,
        complianceScore: typeof parsed.complianceScore === 'number' ? parsed.complianceScore : 50,
        correctnessScore: typeof parsed.correctnessScore === 'number' ? parsed.correctnessScore : 50,
        reasons: parsed.reasons || {},
        strengths: parsed.strengths || [],
        weaknesses: parsed.weaknesses || [],
        recommendations: parsed.recommendations || []
      };
    } catch(err) {
      logger.warn(`[EvaluationWorker] Judge LLM failed for ${execution.id}`, err);
    }
  }

  const overallScore = Math.floor(
    (judgeResult.taskCompletionScore + 
     judgeResult.outputQualityScore + 
     judgeResult.complianceScore + 
     judgeResult.correctnessScore + 
     deterministicScore) / 5
  );

  await db.insert(runEvaluations).values({
    id: crypto.randomUUID(),
    executionId: execution.id,
    evaluationVersion: EVALUATION_VERSION,
    status: 'completed',
    deterministicScores: JSON.stringify({ overall: deterministicScore }),
    judgeScores: JSON.stringify(judgeResult),
    taskCompletionScore: judgeResult.taskCompletionScore,
    outputQualityScore: judgeResult.outputQualityScore,
    complianceScore: judgeResult.complianceScore,
    correctnessScore: judgeResult.correctnessScore,
    costEfficiencyScore: deterministicScore,
    speedScore: deterministicScore,
    overallScore,
    reasons: JSON.stringify({ ...deterministicReasons, ...judgeResult.reasons }),
    strengths: JSON.stringify(judgeResult.strengths),
    weaknesses: JSON.stringify(judgeResult.weaknesses),
    recommendations: JSON.stringify(judgeResult.recommendations),
    evaluatorProvider: 'omniRoute', // Fallback might be ollama, hardcoded for now
    evaluatorModel: 'auto',
    evaluationPromptVersion: '1',
    evaluationMethod: 'hybrid',
    evaluationCost: evaluationCost,
    evaluationDurationMs: evaluationDurationMs,
    createdAt: new Date().toISOString()
  });
}

export async function runEvaluationLoop() {
  logger.info('[EvaluationWorker] Started hybrid evaluation polling.');
  
  setInterval(async () => {
    try {
      // Find completed executions without a runEvaluation
      // Drizzle doesn't support left join IS NULL perfectly out of the box in simple queries without aliasing
      // so we fetch recent unevaluated. In production, use a left join.
      const executions = await db.select().from(agentExecutions)
        .where(isNotNull(agentExecutions.completedAt))
        .orderBy(agentExecutions.createdAt)
        .limit(20);
        
      const evaluatedIds = (await db.select({ executionId: runEvaluations.executionId }).from(runEvaluations)).map(r => r.executionId);

      for (const exec of executions) {
        if (!evaluatedIds.includes(exec.id)) {
          await evaluateExecution(exec);
        }
      }
    } catch(err) {
      logger.error('[EvaluationWorker] Error in loop:', err);
    }
  }, 10000);
}

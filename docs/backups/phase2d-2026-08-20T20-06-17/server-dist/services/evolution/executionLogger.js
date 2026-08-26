import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { agentExecutions } from '../../db/schema.js';
import crypto from 'crypto';
export function classifyError(error) {
    if (!error)
        return 'unknown';
    const errStr = error.toString().toLowerCase();
    if (errStr.includes('timeout') || errStr.includes('timed out'))
        return 'timeout';
    if (errStr.includes('rate limit') || errStr.includes('429'))
        return 'rate_limited';
    if (errStr.includes('validation') || errStr.includes('schema') || errStr.includes('json'))
        return 'schema_failure';
    if (errStr.includes('budget') || errStr.includes('cost limit'))
        return 'budget_exceeded';
    if (errStr.includes('compliance') || errStr.includes('policy'))
        return 'compliance_failure';
    if (errStr.includes('unauthorized') || errStr.includes('forbidden'))
        return 'unauthorized_tool';
    if (errStr.includes('fetch error') || errStr.includes('econnrefused') || errStr.includes('500') || errStr.includes('502') || errStr.includes('503') || errStr.includes('provider'))
        return 'provider_failure';
    if (errStr.includes('cancel') || errStr.includes('abort'))
        return 'cancelled';
    return 'unknown';
}
export async function logExecution(params) {
    const executionId = crypto.randomUUID();
    try {
        await db.insert(agentExecutions).values({
            id: executionId,
            sourceType: params.sourceType,
            sourceRunId: params.sourceRunId,
            sourceTaskId: params.sourceTaskId,
            idempotencyKey: params.idempotencyKey,
            agentId: params.agentId,
            promptVersionId: params.promptVersionId,
            model: params.model,
            provider: params.provider,
            input: JSON.stringify(params.input),
            output: params.output ? JSON.stringify(params.output) : null,
            error: params.error ? JSON.stringify(params.error) : null,
            toolCalls: params.toolCalls ? JSON.stringify(params.toolCalls) : null,
            executionTimeMs: params.executionTimeMs,
            inputTokens: params.inputTokens,
            outputTokens: params.outputTokens,
            cachedTokens: params.cachedTokens,
            totalTokens: params.totalTokens,
            estimatedCost: params.estimatedCost,
            actualCost: params.actualCost,
            costSource: params.costSource || 'unavailable',
            status: params.success ? 'completed' : 'failed',
            success: params.success,
            primaryFailureCategory: params.primaryFailureCategory || (!params.success ? classifyError(params.error) : null),
            secondaryFailureCategories: params.secondaryFailureCategories ? JSON.stringify(params.secondaryFailureCategories) : null,
            complianceResult: params.complianceResult,
            humanReviewScore: params.humanReviewScore,
            opportunityId: params.opportunityId,
            briefId: params.briefId,
            assetId: params.assetId,
            startedAt: params.startedAt,
            completedAt: params.completedAt,
            createdAt: new Date().toISOString()
        });
    }
    catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            logger.warn(`[ExecutionLogger] Idempotency key ${params.idempotencyKey} already logged. Skipping.`);
        }
        else {
            logger.error('[ExecutionLogger] Failed to log execution:', err);
        }
    }
    return executionId;
}

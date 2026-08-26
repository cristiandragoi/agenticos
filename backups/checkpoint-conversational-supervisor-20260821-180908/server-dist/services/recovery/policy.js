export const DEFAULT_RECOVERY_POLICY = {
    maxExecutionAttempts: 3,
    maxGateReworkAttempts: 2,
    maxSameModelRetries: 2,
    maxModelEscalations: 1,
    maxTotalDurationMs: 30 * 60 * 1000,
    allowLocalRetry: true,
    allowStrongerLocalModel: true,
    allowCloudEscalation: true,
    requirePolicyCheckBeforeCloud: true,
    stopOnCancellation: true,
    stopOnHumanApproval: true,
};
export function newBudgetUsage(nowMs = Date.now()) {
    return {
        executionAttempts: 1, // the first attempt already happened
        gateReworkAttempts: 0,
        sameModelRetries: 0,
        modelEscalations: 0,
        startedAtMs: nowMs,
    };
}
/** True when ANY budget limit is hit; returns the first reason.
 *  Note: sameModelRetries is a BRANCH sub-limit (gates the retry decision),
 *  not a global recovery budget — it must not block escalation. */
export function budgetExceeded(policy, used) {
    if (used.executionAttempts >= policy.maxExecutionAttempts) {
        return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max execution attempts (${policy.maxExecutionAttempts})` };
    }
    if (used.gateReworkAttempts >= policy.maxGateReworkAttempts) {
        return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max gate rework attempts (${policy.maxGateReworkAttempts})` };
    }
    if (used.modelEscalations >= policy.maxModelEscalations) {
        return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max model escalations (${policy.maxModelEscalations})` };
    }
    if (Date.now() - used.startedAtMs >= policy.maxTotalDurationMs) {
        return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max duration (${policy.maxTotalDurationMs}ms)` };
    }
    return { exceeded: false };
}

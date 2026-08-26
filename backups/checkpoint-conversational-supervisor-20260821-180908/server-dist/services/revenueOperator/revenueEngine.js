/**
 * revenueEngine.ts — Revenue Operator engine orchestration.
 *
 * EXTENDS the canonical Agentic OS execution surface. It does NOT create any
 * parallel scheduler/task/run/verifier infrastructure. The engine drives the
 * Revenue domain (missions/experiments/ledger) while dispatching actual work
 * through the canonical path:
 *
 *   project → goal (projectTaskService) → task (projectTaskService)
 *     → worker adapter (hermes/codex/magnitude)
 *     → execution run + result (executionRunService)
 *     → independent verification (verificationService)
 *
 * Canonical run/task/goal ids are linked back onto the revenue experiment via
 * linkExperimentRun() so provenance is traceable in one direction only.
 *
 * Phase 2D: dispatchCanonicalTask now performs capability-aware executor
 * selection (reusing the canonical capability vocabulary via executorSelection),
 * records the real provider/model returned by the worker, and never leaves an
 * orphaned `running` run — timeouts and worker failures are marked truthfully.
 */
import { randomUUID } from 'crypto';
import { projectsStore } from '../projectsStore.js';
import { projectTaskService } from '../projectExecution/projectTaskService.js';
import { executionRunService } from '../projectExecution/executionRunService.js';
import { verificationService } from '../projectExecution/verificationService.js';
import { routingLedger } from '../routingLedger.js';
import { selectExecutor } from './executorSelection.js';
import { logger } from '../../utils/logger.js';
/** Resolve a canonical project id, falling back to the active project. */
export function resolveProjectId(preferred) {
    if (preferred && projectsStore.getProject(preferred))
        return preferred;
    const active = projectsStore.getActiveProjectId();
    if (active && projectsStore.getProject(active))
        return active;
    const all = projectsStore.listProjects();
    return all.length > 0 ? all[0].id : null;
}
/**
 * Dispatch one canonical worker task with capability-aware executor selection
 * and await a terminal run, then run the canonical verifier (for hermes/codex;
 * magnitude is read-only). Mirrors the proven scheduleDispatcher flow, minus the
 * schedule/routine-specific wrapper.
 */
export async function dispatchCanonicalTask(input) {
    const requestId = input.requestId ?? `rev-${randomUUID().slice(0, 8)}`;
    const correlationId = input.correlationId ?? `corr-${randomUUID().slice(0, 8)}`;
    // ── 1. Capability-aware executor selection ─────────────────────────────
    let worker = input.worker;
    let rejectedCandidates = [];
    let autoRedispatched = false;
    if (input.requiredCapabilities && input.requiredCapabilities.length > 0) {
        const selection = selectExecutor(input.requiredCapabilities, {
            preferredExecutorId: input.preferredExecutorId ?? input.worker,
            excludedExecutorIds: input.excludedExecutorIds,
        });
        worker = selection.worker;
        rejectedCandidates = selection.rejectedCandidates;
        autoRedispatched = selection.autoRedispatched;
        // Record routing decisions (authoritative routing ledger).
        for (const rej of rejectedCandidates) {
            routingLedger.record({
                operationId: `${correlationId}-attempt-${rej.id}`,
                worker: rej.id === 'hermes' ? 'hermes' : rej.id === 'codex' ? 'codex' : 'other',
                routingMode: 'auto',
                requestedProvider: input.preferredExecutorId ?? input.worker,
                requestedModel: null,
                resolvedProvider: null,
                resolvedModel: null,
                fallbackUsed: true,
                fallbackReason: rej.reason,
                startedAt: Date.now(),
                endedAt: Date.now(),
            });
        }
    }
    routingLedger.record({
        operationId: correlationId,
        worker: worker === 'hermes' ? 'hermes' : worker === 'codex' ? 'codex' : 'other',
        routingMode: 'auto',
        requestedProvider: input.preferredExecutorId ?? input.worker,
        requestedModel: null,
        resolvedProvider: worker,
        resolvedModel: null,
        fallbackUsed: autoRedispatched,
        fallbackReason: autoRedispatched ? `Auto-redispatched after capability mismatch on [${rejectedCandidates.map((r) => r.id).join(', ')}]` : null,
        startedAt: Date.now(),
        endedAt: null,
    });
    const goal = projectTaskService.createGoal({
        projectId: input.projectId,
        title: input.title,
        objective: input.objective,
        createdBy: 'revenue-operator',
        metadata: {
            revenueOperator: true,
            requestId,
            correlationId,
            missionId: input.missionId ?? null,
            experimentId: input.experimentId ?? null,
            actionType: input.actionType ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
        },
    });
    const task = projectTaskService.createTask({
        projectId: input.projectId,
        goalId: goal.id,
        title: input.title,
        description: input.objective,
        taskType: input.taskType ?? (worker === 'codex' ? 'engineering' : worker === 'magnitude' ? 'browser' : 'research'),
        assignedCapability: worker,
        acceptanceCriteria: input.acceptanceCriteria ?? `Execute the revenue objective and return a structured result.`,
        metadata: {
            revenueOperator: true,
            requestId,
            correlationId,
            missionId: input.missionId ?? null,
            experimentId: input.experimentId ?? null,
            actionType: input.actionType ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
        },
    });
    let runId = null;
    try {
        if (worker === 'hermes') {
            const { executeHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
            const { run } = await executeHermesTask(task, { prompt: input.objective, requestId, projectId: input.projectId, goalId: goal.id });
            runId = run.id;
        }
        else if (worker === 'magnitude') {
            const { executeMagnitudeTask } = await import('../../domains/workerAdapters/magnitudeAdapter.js');
            const { run } = await executeMagnitudeTask(task, { goal: input.objective, requestId });
            runId = run.id;
        }
        else {
            // codex: queue the goal, start the loop, poll the goal to terminal, reconcile.
            const { executeCodexTask, reconcileCodexRun } = await import('../../domains/workerAdapters/codexAdapter.js');
            const { resumeCodexGoalLoop } = await import('../../loops/codexLoop.js');
            const { goalStore } = await import('../../services/goalStore.js');
            const { getWorkspaceRoot } = await import('../workspaceStore.js');
            const { run, goalId } = await executeCodexTask(task, { workspacePath: getWorkspaceRoot(), requestId });
            runId = run.id;
            resumeCodexGoalLoop(goalId).catch((e) => logger.warn(`[revenue-engine] codex loop start error: ${e?.message}`));
            const codexDeadline = Date.now() + (input.timeoutMs ?? 300000);
            let terminalGoal = null;
            while (Date.now() < codexDeadline) {
                const g = goalStore.get(goalId);
                if (g && (g.status === 'completed' || g.status === 'failed' || g.status === 'stopped')) {
                    terminalGoal = g;
                    break;
                }
                await new Promise((res) => setTimeout(res, 1500));
            }
            if (terminalGoal)
                await reconcileCodexRun(runId, goalId);
        }
    }
    catch (err) {
        logger.error('[revenue-engine] dispatch error', err?.message);
        if (runId) {
            executionRunService.updateRun(runId, { status: 'failed', failureReason: err?.message ?? 'dispatch failed', endTime: new Date().toISOString() });
            projectTaskService.updateTask(task.id, { status: 'failed' });
        }
        return {
            ok: false, goalId: goal.id, taskId: task.id, runId, resultId: null, verdict: null, summary: null,
            error: err?.message ?? 'dispatch failed', executor: worker, workerInstanceId: null,
            provider: null, model: null, correlationId, autoRedispatched, rejectedCandidates,
        };
    }
    if (!runId) {
        return {
            ok: false, goalId: goal.id, taskId: task.id, runId: null, resultId: null, verdict: null, summary: null,
            error: 'No run id produced by worker dispatch.', executor: worker, workerInstanceId: null,
            provider: null, model: null, correlationId, autoRedispatched, rejectedCandidates,
        };
    }
    // ── Poll the canonical run to terminal ────────────────────────────────────
    const timeoutMs = input.timeoutMs ?? 300000;
    const deadline = Date.now() + timeoutMs;
    let terminalRun = null;
    while (Date.now() < deadline) {
        const r = executionRunService.getRun(runId);
        if (r && (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled')) {
            terminalRun = r;
            break;
        }
        await new Promise((res) => setTimeout(res, 1500));
    }
    if (!terminalRun) {
        // No orphaned `running` runs: mark run + task failed truthfully on timeout.
        executionRunService.updateRun(runId, { status: 'failed', failureReason: `Timed out after ${Math.round(timeoutMs / 1000)}s.`, endTime: new Date().toISOString() });
        projectTaskService.updateTask(task.id, { status: 'failed' });
        return {
            ok: false, goalId: goal.id, taskId: task.id, runId, resultId: null, verdict: null, summary: null,
            error: `Timed out after ${Math.round(timeoutMs / 1000)}s.`, executor: worker, workerInstanceId: terminalRun?.agentInstanceId ?? null,
            provider: null, model: null, correlationId, autoRedispatched, rejectedCandidates,
        };
    }
    const finalResult = terminalRun.finalResultId ? executionRunService.getResult(terminalRun.finalResultId) : null;
    // ── Independent verification (hermes/codex only) ──────────────────────────
    let verdict = null;
    if (worker !== 'magnitude' && terminalRun.status === 'completed' && finalResult) {
        try {
            const vr = await verificationService.verify({
                taskId: task.id,
                targetRunId: runId,
                projectId: input.projectId,
                goalId: goal.id,
                objective: input.objective,
                acceptanceCriteria: task.acceptanceCriteria,
                workerResult: finalResult,
                workerRun: terminalRun,
            });
            verdict = vr.verdict;
        }
        catch (e) {
            logger.warn(`[revenue-engine] verification error (non-fatal): ${e?.message}`);
        }
    }
    const ok = terminalRun.status === 'completed';
    routingLedger.end(correlationId);
    return {
        ok,
        goalId: goal.id,
        taskId: task.id,
        runId,
        resultId: finalResult?.id ?? null,
        verdict,
        summary: finalResult?.summary ?? terminalRun.failureReason ?? null,
        structuredOutput: finalResult?.structuredOutput ?? null,
        error: ok ? null : (terminalRun.failureReason || `Worker ended ${terminalRun.status}`),
        executor: worker,
        workerInstanceId: terminalRun.agentInstanceId ?? null,
        provider: terminalRun.provider ?? null,
        model: terminalRun.model ?? null,
        correlationId,
        autoRedispatched,
        rejectedCandidates,
    };
}
/**
 * Pure GO/NO-GO decision from a normalized opportunity score.
 * Conservative threshold: a neutral profile (≈0.25 with the operator scoring
 * formula) is NO-GO; a genuine demand/margin signal is required to proceed.
 */
export function decideGoNoGo(overallScore, threshold = 0.35) {
    if (!Number.isFinite(overallScore))
        return { go: false, reason: 'Score is not finite.' };
    if (overallScore >= threshold)
        return { go: true, reason: `Score ${overallScore.toFixed(3)} >= threshold ${threshold}.` };
    return { go: false, reason: `Score ${overallScore.toFixed(3)} < threshold ${threshold}.` };
}

/**
 * revenueActionExecutor.ts — Phase 2D action executor.
 *
 * Maps a ResolvedAction to the existing Revenue Operator engine function and
 * persists a truthful execution record (idempotency + duplicate prevention +
 * UI truth). No new execution engine: DIGITAL_BUILD reuses buildProduct (real
 * CodeX), research actions reuse the Hermes engine functions, and validation /
 * decision / gate actions use canonical DB logic.
 */
import { randomUUID } from 'crypto';
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { discoverProducts, validateAndScore, decideGoNoGoForExperiment, buildProduct, } from './digitalProductEngine.js';
import { discoverCompanies, inspectCompany, qualifyCompany, findContact, createOffer, } from './germanSmeEngine.js';
import { getExperiment, transitionExperiment, createHumanGate, listHumanGates, } from './operatorService.js';
// ── Persistence ─────────────────────────────────────────────────────────────
function ensureActionTable() {
    rawDb.exec(`
    CREATE TABLE IF NOT EXISTS revenue_action_executions (
      idempotency_key TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      mission_id TEXT,
      experiment_id TEXT,
      correlation_id TEXT NOT NULL,
      executor TEXT,
      worker_instance_id TEXT,
      provider TEXT,
      model TEXT,
      run_id TEXT,
      result_id TEXT,
      evidence_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      next_status TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
function getActionExecution(idempotencyKey) {
    ensureActionTable();
    const row = rawDb.prepare('SELECT * FROM revenue_action_executions WHERE idempotency_key = ?').get(idempotencyKey);
    if (!row)
        return null;
    return {
        actionType: row.action_type,
        experimentId: row.experiment_id,
        missionId: row.mission_id,
        correlationId: row.correlation_id,
        status: row.status,
        executor: row.executor,
        workerInstanceId: row.worker_instance_id,
        provider: row.provider,
        model: row.model,
        runId: row.run_id,
        resultId: row.result_id,
        evidenceId: row.evidence_id,
        error: row.error,
        nextStatus: row.next_status,
        detail: row.detail,
    };
}
function recordActionExecution(rec) {
    ensureActionTable();
    const now = new Date().toISOString();
    rawDb.prepare(`
    INSERT INTO revenue_action_executions
      (idempotency_key, action_type, mission_id, experiment_id, correlation_id, executor,
       worker_instance_id, provider, model, run_id, result_id, evidence_id, status,
       error, next_status, detail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      action_type=excluded.action_type, mission_id=excluded.mission_id, experiment_id=excluded.experiment_id,
      correlation_id=excluded.correlation_id, executor=excluded.executor, worker_instance_id=excluded.worker_instance_id,
      provider=excluded.provider, model=excluded.model, run_id=excluded.run_id, result_id=excluded.result_id,
      evidence_id=excluded.evidence_id, status=excluded.status, error=excluded.error, next_status=excluded.next_status,
      detail=excluded.detail, updated_at=excluded.updated_at
  `).run(rec.idempotencyKey ?? `${rec.actionType}:${rec.experimentId ?? rec.missionId ?? 'mission'}`, rec.actionType, rec.missionId, rec.experimentId, rec.correlationId, rec.executor, rec.workerInstanceId, rec.provider, rec.model, rec.runId, rec.resultId, rec.evidenceId, rec.status, rec.error, rec.nextStatus, rec.detail, now, now);
}
// ── Helpers ─────────────────────────────────────────────────────────────────
function dispatchMeta(action, missionId, experimentId) {
    return {
        requiredCapabilities: action.requiredCapabilities,
        preferredExecutorId: action.preferredExecutorId,
        missionId,
        experimentId: experimentId ?? undefined,
        actionType: action.actionType,
    };
}
// Default score inputs: neutral (honest — no fabricated demand signals). A
// neutral profile is NO-GO by default; the supervisor never fabricates GO.
const NEUTRAL_SCORE = {
    demand: 0.5, purchaseIntent: 0.5, expectedMargin: 0.5, distributionProbability: 0.5,
    automationPotential: 0.5, competitiveAdvantage: 0.5, buildTime: 0.5,
    acquisitionDifficulty: 0.5, capitalRequirement: 0.5, risk: 0.5,
};
// ── Action dispatcher ───────────────────────────────────────────────────────
export async function executeAction(action, missionId, projectId) {
    const experimentId = action.experimentId;
    const correlationId = `corr-${randomUUID().slice(0, 8)}`;
    // Stage-aware idempotency key: an action that spans multiple lifecycle
    // stages (e.g. SME_QUALIFY: inspect then qualify) must not collide with
    // itself across stages. Include the experiment's current status.
    let stage = '';
    try {
        if (experimentId) {
            const exp = await getExperiment(experimentId);
            stage = exp?.status ? `:${exp.status}` : '';
        }
    }
    catch { /* key fallback: no stage suffix */ }
    const idempotencyKey = `${action.actionType}:${experimentId ?? missionId}${stage}`;
    // Idempotency / duplicate prevention: a terminal (completed|failed|blocked)
    // action execution for this exact key is never re-run.
    const prior = getActionExecution(idempotencyKey);
    if (prior && ['completed', 'blocked'].includes(prior.status)) {
        logger.info(`[ActionExecutor] Idempotent skip ${idempotencyKey} (${prior.status})`);
        return { ...prior, correlationId: prior.correlationId || correlationId, detail: `idempotent: ${prior.detail || prior.status}` };
    }
    let result;
    try {
        switch (action.actionType) {
            case 'DIGITAL_VALIDATE': {
                const score = await validateAndScore(experimentId, NEUTRAL_SCORE);
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId,
                    status: 'completed', executor: null, workerInstanceId: null, provider: null, model: null,
                    runId: null, resultId: null, evidenceId: null, error: null,
                    nextStatus: 'VALIDATING', detail: `Scored ${score.overallScore} (confidence ${score.confidence}).`,
                };
                break;
            }
            case 'DIGITAL_DECIDE': {
                const decision = await decideGoNoGoForExperiment(experimentId);
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId,
                    status: 'completed', executor: null, workerInstanceId: null, provider: null, model: null,
                    runId: null, resultId: null, evidenceId: null, error: null,
                    nextStatus: decision.to, detail: decision.reason,
                };
                break;
            }
            case 'DIGITAL_BUILD': {
                const exp = await getExperiment(experimentId);
                if (!exp)
                    throw new Error(`Experiment ${experimentId} not found.`);
                const build = await buildProduct(experimentId, { projectId, ...dispatchMeta(action, missionId, experimentId) });
                const run = build.dispatch?.runId ?? null;
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId: build.dispatch?.correlationId ?? correlationId,
                    status: build.dispatch?.ok ? 'completed' : 'failed',
                    executor: build.dispatch?.executor ?? 'codex',
                    workerInstanceId: build.dispatch?.workerInstanceId ?? null,
                    provider: build.dispatch?.provider ?? null,
                    model: build.dispatch?.model ?? null,
                    runId: run, resultId: build.dispatch?.resultId ?? null,
                    evidenceId: build.dispatch?.resultId ?? null,
                    error: build.dispatch?.error ?? null,
                    nextStatus: build.dispatch?.ok ? 'QA' : (exp.status ?? null),
                    detail: build.dispatch?.ok ? `Built artifact via CodeX run ${run}.` : `Build failed: ${build.dispatch?.error ?? 'unknown'}`,
                };
                break;
            }
            case 'DIGITAL_WAIT_FOR_PUBLISH_GATE': {
                const exp = await getExperiment(experimentId);
                if (!exp)
                    throw new Error(`Experiment ${experimentId} not found.`);
                // Transition QA → READY_TO_PUBLISH, then ensure a Shopify gate exists.
                if (exp.status === 'QA') {
                    await transitionExperiment(experimentId, 'READY_TO_PUBLISH');
                }
                const gates = listHumanGates();
                const openShopifyGate = gates.find((g) => g.experimentId === experimentId && g.gateType === 'SHOPIFY_AUTH_REQUIRED' && g.status === 'open');
                let gateId = openShopifyGate?.id ?? null;
                if (!gateId && exp.status !== 'PUBLISHING') {
                    const gate = createHumanGate({
                        experimentId, gateType: 'SHOPIFY_AUTH_REQUIRED',
                        description: 'Approve Shopify authentication & publication.',
                        branchPaused: true,
                    });
                    gateId = gate?.id ?? null;
                }
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId,
                    status: 'waiting_for_gate', executor: null, workerInstanceId: null, provider: null, model: null,
                    runId: null, resultId: null, evidenceId: gateId, error: null,
                    nextStatus: 'READY_TO_PUBLISH', detail: `Shopify Human Gate ${gateId ?? '(preserved)'} holds branch.`,
                };
                break;
            }
            case 'SME_QUALIFY': {
                const exp = await getExperiment(experimentId);
                if (!exp)
                    throw new Error(`Experiment ${experimentId} not found.`);
                if (exp.status === 'DISCOVERED') {
                    const inspected = await inspectCompany(experimentId, { projectId, ...dispatchMeta(action, missionId, experimentId) });
                    result = {
                        actionType: action.actionType, experimentId, missionId, correlationId: inspected.dispatch?.correlationId ?? correlationId,
                        status: inspected.dispatch?.ok ? 'completed' : 'failed',
                        executor: inspected.dispatch?.executor ?? 'hermes',
                        workerInstanceId: inspected.dispatch?.workerInstanceId ?? null,
                        provider: inspected.dispatch?.provider ?? null,
                        model: inspected.dispatch?.model ?? null,
                        runId: inspected.dispatch?.runId ?? null, resultId: inspected.dispatch?.resultId ?? null,
                        evidenceId: inspected.dispatch?.resultId ?? null,
                        error: inspected.dispatch?.error ?? null,
                        nextStatus: 'VALIDATING', detail: `Inspected company profile via Hermes run ${inspected.dispatch?.runId ?? 'n/a'}.`,
                    };
                }
                else {
                    const q = await qualifyCompany(experimentId, NEUTRAL_SCORE);
                    result = {
                        actionType: action.actionType, experimentId, missionId, correlationId,
                        status: 'completed', executor: null, workerInstanceId: null, provider: null, model: null,
                        runId: null, resultId: null, evidenceId: null, error: null,
                        nextStatus: q.to, detail: q.reason,
                    };
                }
                break;
            }
            case 'SME_FIND_CONTACT': {
                const found = await findContact(experimentId, { projectId, ...dispatchMeta(action, missionId, experimentId) });
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId: found.dispatch?.correlationId ?? correlationId,
                    status: found.dispatch?.ok ? 'completed' : 'failed',
                    executor: found.dispatch?.executor ?? 'hermes',
                    workerInstanceId: found.dispatch?.workerInstanceId ?? null,
                    provider: found.dispatch?.provider ?? null,
                    model: found.dispatch?.model ?? null,
                    runId: found.dispatch?.runId ?? null, resultId: found.dispatch?.resultId ?? null,
                    evidenceId: found.dispatch?.resultId ?? null,
                    error: found.dispatch?.error ?? null,
                    nextStatus: null, detail: `Found public business contact via Hermes run ${found.dispatch?.runId ?? 'n/a'}.`,
                };
                break;
            }
            case 'SME_CREATE_OFFER': {
                const offered = await createOffer(experimentId, { projectId, ...dispatchMeta(action, missionId, experimentId) });
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId: offered.dispatch?.correlationId ?? correlationId,
                    status: offered.dispatch?.ok ? 'completed' : 'failed',
                    executor: offered.dispatch?.executor ?? 'hermes',
                    workerInstanceId: offered.dispatch?.workerInstanceId ?? null,
                    provider: offered.dispatch?.provider ?? null,
                    model: offered.dispatch?.model ?? null,
                    runId: offered.dispatch?.runId ?? null, resultId: offered.dispatch?.resultId ?? null,
                    evidenceId: offered.dispatch?.resultId ?? null,
                    error: offered.dispatch?.error ?? null,
                    nextStatus: 'BUILDING', detail: `Offer drafted via Hermes run ${offered.dispatch?.runId ?? 'n/a'}.`,
                };
                break;
            }
            case 'SME_WAIT_FOR_OUTBOUND_GATE': {
                const exp = await getExperiment(experimentId);
                if (!exp)
                    throw new Error(`Experiment ${experimentId} not found.`);
                if (exp.status === 'BUILDING') {
                    await transitionExperiment(experimentId, 'QA');
                }
                const gates = listHumanGates();
                const openOutboundGate = gates.find((g) => g.experimentId === experimentId && g.gateType === 'OUTBOUND_APPROVAL' && g.status === 'open');
                let gateId = openOutboundGate?.id ?? null;
                if (!gateId) {
                    const gate = createHumanGate({
                        experimentId, gateType: 'OUTBOUND_APPROVAL',
                        description: 'Approve outbound outreach before any send.',
                        branchPaused: true,
                    });
                    gateId = gate?.id ?? null;
                }
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId,
                    status: 'waiting_for_gate', executor: null, workerInstanceId: null, provider: null, model: null,
                    runId: null, resultId: null, evidenceId: gateId, error: null,
                    nextStatus: 'QA', detail: `OUTBOUND_APPROVAL Human Gate ${gateId ?? '(preserved)'} holds branch.`,
                };
                break;
            }
            case 'BLOCKED_INTEGRATION_REQUIRED': {
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId,
                    status: 'blocked', executor: null, workerInstanceId: null, provider: null, model: null,
                    runId: null, resultId: null, evidenceId: null, error: action.blockedReason ?? 'integration required',
                    nextStatus: null, detail: action.reason,
                };
                break;
            }
            case 'DIGITAL_DISCOVER':
            case 'SME_DISCOVER': {
                const count = 1; // bounded — no large discovery batches
                const opts = { count, projectId, ...dispatchMeta(action, missionId, experimentId) };
                const discovered = action.actionType === 'DIGITAL_DISCOVER'
                    ? await discoverProducts(missionId, opts)
                    : await discoverCompanies(missionId, opts);
                const expIds = (discovered.experiments || []).map((e) => e.id);
                result = {
                    actionType: action.actionType, experimentId: expIds[0] ?? null, missionId, correlationId: discovered.dispatch?.correlationId ?? correlationId,
                    status: discovered.dispatch?.ok ? 'completed' : 'failed',
                    executor: discovered.dispatch?.executor ?? 'hermes',
                    workerInstanceId: discovered.dispatch?.workerInstanceId ?? null,
                    provider: discovered.dispatch?.provider ?? null,
                    model: discovered.dispatch?.model ?? null,
                    runId: discovered.dispatch?.runId ?? null, resultId: discovered.dispatch?.resultId ?? null,
                    evidenceId: discovered.dispatch?.resultId ?? null,
                    error: discovered.dispatch?.error ?? null,
                    nextStatus: 'DISCOVERED', detail: `Discovered ${expIds.length} experiment(s) via Hermes run ${discovered.dispatch?.runId ?? 'n/a'}.`,
                };
                break;
            }
            case 'NO_WORK':
            default: {
                result = {
                    actionType: action.actionType, experimentId, missionId, correlationId,
                    status: 'no_work', executor: null, workerInstanceId: null, provider: null, model: null,
                    runId: null, resultId: null, evidenceId: null, error: null,
                    nextStatus: null, detail: action.reason,
                };
                break;
            }
        }
    }
    catch (err) {
        result = {
            actionType: action.actionType, experimentId, missionId, correlationId,
            status: 'failed', executor: null, workerInstanceId: null, provider: null, model: null,
            runId: null, resultId: null, evidenceId: null, error: err?.message ?? 'action failed',
            nextStatus: null, detail: `Action ${action.actionType} failed: ${err?.message}`,
        };
    }
    result.idempotencyKey = idempotencyKey;
    recordActionExecution(result);
    return result;
}

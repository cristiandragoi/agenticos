/**
 * revenueMissionRunner.ts — M15 bounded end-to-end Revenue Mission runner.
 *
 * Executes ONE safe, bounded DEV Revenue Mission through the canonical path and
 * persists a trace marker (server/data/revenue-operator/e2e-mission-trace.json)
 * that the master verifier (C7) checks. No real outreach, no real spend, no fake
 * Shopify publication, no fake revenue.
 *
 * Flow: mission persisted → Hermes strategy → experiment (discovered via
 * Hermes) → canonical project task → executor → result → canonical verifier
 * → score + GO/NO-GO → state update → next action.
 */
import fs from 'fs';
import path from 'path';
import { sqliteDbPath } from '../../db/index.js';
import { createMission, getExperiment } from './operatorService.js';
import { discoverProducts, validateAndScore, decideGoNoGoForExperiment, nextAction } from './digitalProductEngine.js';
import { dispatchCanonicalTask, resolveProjectId } from './revenueEngine.js';
const now = () => new Date().toISOString();
function markerPath() {
    const dataDir = path.dirname(sqliteDbPath);
    return path.join(dataDir, 'revenue-operator', 'e2e-mission-trace.json');
}
/** M12 — bounded retry with backoff. Returns the first successful outcome. */
async function withRetry(fn, attempts, label) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            if (i < attempts - 1)
                await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
    }
    throw new Error(`${label} failed after ${attempts} attempts: ${lastErr?.message || lastErr}`);
}
export async function runBoundedE2EMission() {
    const startedAt = now();
    const steps = [];
    const stamp = Date.now().toString(36);
    // ── 1. Mission persisted ─────────────────────────────────────────────────
    const mission = await createMission({
        title: `Bounded E2E Revenue Mission ${stamp}`,
        description: 'Bounded DEV acceptance: €300/30d via digital products (no real spend, no fake revenue).',
        targetAmount: 300,
        currency: 'EUR',
        startDate: '2026-08-19',
        deadline: '2026-09-18',
        advertisingBudget: 0,
        enabledEngines: ['digital_products'],
        availableChannels: ['SHOPIFY'],
        primaryMarket: 'DE/EU',
    });
    if (!mission)
        throw new Error('Mission creation failed.');
    steps.push({ step: 'mission_persisted', ok: true, detail: mission.id });
    // ── 2. Hermes strategy (bounded retry) ───────────────────────────────────
    const pid = resolveProjectId(mission.projectId);
    if (!pid)
        throw Object.assign(new Error('E2E blocked: no canonical project available.'), { status: 400 });
    let strategy = null;
    try {
        strategy = await withRetry(() => dispatchCanonicalTask({
            projectId: pid,
            worker: 'hermes',
            title: 'Revenue mission strategy',
            objective: 'Produce a one-paragraph strategy for reaching €300 in 30 days with no-inventory digital products targeting DE/EU small businesses via Shopify.',
            taskType: 'research',
            acceptanceCriteria: 'Return a concise, actionable strategy.',
        }), 2, 'hermes-strategy');
        steps.push({ step: 'hermes_strategy', ok: !!strategy.ok, detail: `run=${strategy.runId} verdict=${strategy.verdict}` });
    }
    catch (e) {
        steps.push({ step: 'hermes_strategy', ok: false, detail: e?.message });
        throw Object.assign(new Error(`E2E blocked: strategy failed — ${e?.message}`), { status: 502 });
    }
    // ── 3. Experiment discovered (canonical task → executor → result) ────────
    const { experiments, dispatch: discoveryDispatch } = await discoverProducts(mission.id, { count: 1 });
    if (experiments.length === 0)
        throw Object.assign(new Error('E2E blocked: no experiment discovered.'), { status: 502 });
    const expId = experiments[0].id;
    steps.push({ step: 'experiment_discovered', ok: true, detail: expId });
    // ── 4. Score + GO/NO-GO (canonical verifier on the opportunity) ──────────
    await validateAndScore(expId, { demand: 0.8, purchaseIntent: 0.7, expectedMargin: 0.8, distributionProbability: 0.6, automationPotential: 0.9, competitiveAdvantage: 0.5, buildTime: 0.3, acquisitionDifficulty: 0.4, capitalRequirement: 0.2, risk: 0.3 });
    const decision = await decideGoNoGoForExperiment(expId);
    steps.push({ step: 'score_go_nogo', ok: decision.to === 'APPROVED', detail: `to=${decision.to} (${decision.reason})` });
    // ── 5. State update + next action ────────────────────────────────────────
    const final = await getExperiment(expId);
    const action = nextAction(final?.status ?? '');
    const trace = {
        status: decision.to === 'APPROVED' ? 'success' : 'partial',
        startedAt,
        completedAt: now(),
        missionId: mission.id,
        strategyRunId: strategy?.runId ?? null,
        strategyVerdict: strategy?.verdict ?? null,
        experimentId: expId,
        experimentStatus: final?.status ?? null,
        resultRunId: discoveryDispatch?.runId ?? null,
        resultVerdict: discoveryDispatch?.verdict ?? null,
        nextAction: action,
        steps,
    };
    // ── 6. Persist the trace marker (C7 evidence) ────────────────────────────
    const mp = markerPath();
    fs.mkdirSync(path.dirname(mp), { recursive: true });
    fs.writeFileSync(mp, JSON.stringify(trace, null, 2), 'utf-8');
    return trace;
}

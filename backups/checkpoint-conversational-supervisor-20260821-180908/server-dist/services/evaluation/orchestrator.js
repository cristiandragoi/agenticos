import { DEFAULT_EVAL_CASES } from './cases.js';
import { runEvalCase } from './runner.js';
import { persistEvalResult, listRecentEvals, countEvals } from './store.js';
import { buildComparison, formatComparison } from './comparison.js';
/**
 * Evaluate each provider against each case. Cells run sequentially per
 * provider to keep the model calls deterministic; a failed cell is recorded
 * with outcome ERROR and never aborts siblings.
 */
export async function runEvaluation(providers, cases = DEFAULT_EVAL_CASES, opts = {}) {
    const started = Date.now();
    const results = [];
    let persisted = 0;
    for (const provider of providers) {
        for (const caseDef of cases) {
            try {
                const result = await runEvalCase(caseDef, provider.gateway, { timeoutMs: opts.timeoutMs, signal: opts.signal });
                results.push(result);
                persistEvalResult(result);
                persisted++;
            }
            catch (err) {
                // Cell-level failure: record an ERROR result so the comparison shows it.
                const now = new Date().toISOString();
                const cell = {
                    caseId: caseDef.id,
                    provider: provider.name,
                    model: provider.gateway.definition.model,
                    outcome: 'ERROR',
                    output: '',
                    assertions: [],
                    latencyMs: 0,
                    firstTokenMs: 0,
                    toolCallCount: 0,
                    toolErrors: 0,
                    structuredOutputValid: false,
                    error: String(err?.message || err).slice(0, 500),
                    verifier: 'none',
                    startedAt: now,
                    completedAt: now,
                };
                results.push(cell);
                persistEvalResult(cell);
                persisted++;
            }
        }
    }
    const comparisons = buildComparison(results);
    return {
        results,
        persisted,
        recent: listRecentEvals(50),
        totalStored: countEvals(),
        comparisonText: formatComparison(comparisons),
        durationMs: Date.now() - started,
    };
}
/** Run a quick single-provider smoke over a subset of cases (CLI). */
export async function runQuickSmoke(provider, caseIds, opts = {}) {
    const cases = DEFAULT_EVAL_CASES.filter((c) => caseIds.includes(c.id));
    return runEvaluation([provider], cases.length ? cases : DEFAULT_EVAL_CASES.slice(0, 2), opts);
}

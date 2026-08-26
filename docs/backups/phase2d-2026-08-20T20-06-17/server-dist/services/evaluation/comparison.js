/** Rank an outcome for comparison (higher is better). */
function outcomeScore(outcome) {
    switch (outcome) {
        case 'PASS': return 4;
        case 'NEEDS_REVISION': return 3;
        case 'SKIPPED': return 2;
        case 'TIMEOUT': return 1;
        case 'CANCELLED': return 1;
        case 'ERROR': return 1;
        default: return 0;
    }
}
export function buildComparison(results) {
    const byCase = new Map();
    for (const r of results) {
        const list = byCase.get(r.caseId) || [];
        list.push(r);
        byCase.set(r.caseId, list);
    }
    const comparisons = [];
    for (const [caseId, runs] of byCase) {
        const entries = runs.map((r) => ({
            caseId: r.caseId,
            provider: r.provider,
            model: r.model,
            outcome: r.outcome,
            latencyMs: r.latencyMs,
            firstTokenMs: r.firstTokenMs,
            totalTokens: r.totalTokens,
        }));
        // Recommendation: best outcome; on ties, fastest first-token then total.
        const ranked = [...runs].sort((a, b) => {
            const scoreDiff = outcomeScore(b.outcome) - outcomeScore(a.outcome);
            if (scoreDiff !== 0)
                return scoreDiff;
            if (a.firstTokenMs !== b.firstTokenMs)
                return a.firstTokenMs - b.firstTokenMs;
            return a.latencyMs - b.latencyMs;
        });
        const best = ranked[0];
        const allFail = ranked.every((r) => r.outcome === 'ERROR' || r.outcome === 'TIMEOUT' || r.outcome === 'CANCELLED');
        const reason = allFail
            ? 'No provider passed this case.'
            : `${best.provider}/${best.model} (${best.outcome}, ${best.latencyMs}ms, first token ${best.firstTokenMs}ms)`;
        comparisons.push({
            caseId,
            entries,
            recommended: allFail ? undefined : `${best.provider}/${best.model}`,
            recommendationReason: reason,
        });
    }
    return comparisons;
}
export function formatComparison(comparisons) {
    const lines = [];
    for (const c of comparisons) {
        lines.push(`Case: ${c.caseId}`);
        for (const e of c.entries) {
            lines.push(`  ${e.provider}/${e.model}: ${e.outcome} | ${e.latencyMs}ms total | ${e.firstTokenMs}ms first | ${e.totalTokens ?? '?'} tokens`);
        }
        lines.push(`  Recommended: ${c.recommended ?? 'none'} (${c.recommendationReason})`);
    }
    return lines.join('\n');
}

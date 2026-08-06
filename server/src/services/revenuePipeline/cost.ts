/**
 * Cost control for the revenue pipeline (per-run budget).
 *
 * Tracks provider/model/request count/estimated cost/elapsed/failures/
 * fallbacks per LLM call. The gateway (llmGateway) does NOT return usage or
 * cost in V1 — so `costUsd` stays `null` with an explicit note unless the
 * caller supplies a real estimate. Budget enforcement uses cost when known
 * and request count as a documented proxy when unknown.
 */
import type { CostLedgerEntry } from './types.js';

export const DEFAULT_MAX_REQUESTS = 20;

export interface CostCheckResult {
  within: boolean;
  reason: string;
  exceededBy?: string;
}

export function createLedger(): CostLedgerEntry[] {
  return [];
}

export function recordLlmCall(
  ledger: CostLedgerEntry[],
  entry: Partial<CostLedgerEntry> & { provider: string; model: string }
): void {
  const existing = ledger.find((l) => l.provider === entry.provider && l.model === entry.model);
  if (existing) {
    existing.requestCount += entry.requestCount ?? 1;
    existing.elapsedMs += entry.elapsedMs ?? 0;
    existing.failures += entry.failures ?? 0;
    existing.fallbacks += entry.fallbacks ?? 0;
    if (entry.costUsd !== undefined) {
      existing.costUsd = entry.costUsd === null ? null : (existing.costUsd ?? 0) + entry.costUsd;
    }
    if (entry.note) existing.note = entry.note;
    return;
  }
  ledger.push({
    provider: entry.provider,
    model: entry.model,
    requestCount: entry.requestCount ?? 1,
    costUsd: entry.costUsd !== undefined ? entry.costUsd : null,
    elapsedMs: entry.elapsedMs ?? 0,
    failures: entry.failures ?? 0,
    fallbacks: entry.fallbacks ?? 0,
    note: entry.note,
  });
}

/**
 * Enforce the per-run budget. When cost is unknown (null), falls back to the
 * documented request-count proxy so the run still has a hard ceiling.
 */
export function checkBudget(
  ledger: CostLedgerEntry[],
  maxBudgetUsd: number | null,
  maxRequests = DEFAULT_MAX_REQUESTS
): CostCheckResult {
  const totalCost = ledger.reduce((sum, l) => sum + (l.costUsd ?? 0), 0);
  const totalRequests = ledger.reduce((sum, l) => sum + l.requestCount, 0);
  const anyCostUnknown = ledger.some((l) => l.costUsd === null && l.requestCount > 0);

  if (maxBudgetUsd !== null && totalCost > maxBudgetUsd) {
    return {
      within: false,
      reason: `Estimated cost ${totalCost.toFixed(2)} USD exceeds the per-run budget ${maxBudgetUsd.toFixed(2)} USD.`,
      exceededBy: (totalCost - maxBudgetUsd).toFixed(2),
    };
  }
  if (anyCostUnknown && totalRequests >= maxRequests) {
    return {
      within: false,
      reason: `Gateway usage is not cost-visible; request-count proxy ${totalRequests} reached the documented cap ${maxRequests} (cost unknown).`,
    };
  }
  return { within: true, reason: `Budget check passed — ${totalRequests} request(s), cost ${totalCost.toFixed(2)} USD.` };
}

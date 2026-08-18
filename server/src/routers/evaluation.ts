import { Router, type Request, type Response } from 'express';
import { loadGatewayConfig } from '../services/gateway/config.js';
import { ProviderRegistry } from '../services/gateway/registry.js';
import { DeepSeekGateway } from '../services/gateway/gateways/deepseek.js';
import { runEvaluation } from '../services/evaluation/orchestrator.js';
import { secretStore } from '../services/gateway/secretStore.js';
import { logger } from '../utils/logger.js';

/**
 * evaluationRouter — bounded model-evaluation admin surface (C10).
 *
 * POST /api/evaluation/run
 *   body: { caseIds?: string[], providers?: string[], timeoutMs?: number }
 * Runs the evaluation IN-PROCESS so OS-vault (keytar) credentials are
 * resolvable (the standalone CLI cannot read keytar — Electron ABI native
 * module). NEVER returns or logs the API key; results persist to
 * model_evaluations and the response carries the comparison text.
 */
export const evaluationRouter = Router();

evaluationRouter.post('/run', async (req: Request, res: Response) => {
  const { caseIds, providers: providerFilter, timeoutMs } = req.body || {};
  try {
    const config = loadGatewayConfig();
    const registry = new ProviderRegistry(config);
    const gateways: { name: string; gateway: any }[] = [];

    for (const gw of registry.getAvailableProviders()) {
      const name = gw.name.toLowerCase();
      if (providerFilter && !providerFilter.some((f: string) => name.includes(String(f).toLowerCase()))) continue;
      if (name.includes('deepseek') || name.includes('ollama')) {
        gateways.push({ name: gw.name, gateway: gw });
      }
    }

    // DeepSeek may be absent from env-config; add it from the secure vault
    // when a key exists (resolved in-process — keytar works here).
    const hasKey = await secretStore.get('deepseek').catch(() => undefined)
      || await secretStore.get('DEEPSEEK_API_KEY').catch(() => undefined);
    if (hasKey && !gateways.some((g) => g.name.toLowerCase() === 'deepseek')) {
      gateways.push({
        name: 'DeepSeek',
        gateway: new DeepSeekGateway({
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-v4-flash',
          type: 'deepseek',
          apiKey: hasKey,
        }),
      });
    }

    const selected = providerFilter ? gateways.filter((g) => providerFilter.some((f: string) => g.name.toLowerCase().includes(String(f).toLowerCase()))) : gateways;
    if (selected.length === 0) {
      return res.status(400).json({ error: 'No matching provider available (try deepseek or ollama).' });
    }

    // Bounded case set: ONLY the requested caseIds (never the full default
    // suite unless explicitly requested) — the runner executes exactly these.
    const { DEFAULT_EVAL_CASES } = await import('../services/evaluation/cases.js');
    const caseSet = Array.isArray(caseIds) && caseIds.length
      ? DEFAULT_EVAL_CASES.filter((c) => caseIds.includes(c.id))
      : [];

    const summary = await runEvaluation(
      selected.map((g) => ({ name: g.name, gateway: g.gateway })),
      caseSet.length ? caseSet : undefined, // undefined → default suite only when no caseIds given
      { timeoutMs: timeoutMs || 45000 },
    );

    // If caseIds were given but none matched the default suite, report zero.
    const results = Array.isArray(caseIds) && caseIds.length
      ? summary.results.filter((r) => caseIds.includes(r.caseId))
      : summary.results;

    return res.json({
      providers: selected.map((g) => `${g.name}(${g.gateway.definition.model})`),
      durationMs: summary.durationMs,
      persisted: results.length,
      results: results.map((r) => ({
        caseId: r.caseId,
        provider: r.provider,
        model: r.model,
        outcome: r.outcome,
        latencyMs: r.latencyMs,
        firstTokenMs: r.firstTokenMs,
        totalTokens: r.totalTokens,
        error: r.error || undefined,
      })),
      comparisonText: summary.comparisonText,
    });
  } catch (err: any) {
    logger.error('[Evaluation] run failed:', err.message);
    return res.status(500).json({ error: err.message || 'Evaluation failed' });
  }
});

/** GET /api/evaluation/recent — recent persisted eval records (no secrets). */
evaluationRouter.get('/recent', async (_req: Request, res: Response) => {
  try {
    const { listRecentEvals } = await import('../services/evaluation/store.js');
    return res.json(listRecentEvals(50));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

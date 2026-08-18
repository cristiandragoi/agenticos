#!/usr/bin/env node
/**
 * eval-models CLI (C10) — run the model evaluation harness.
 *
 * Usage:
 *   node server/dist/evalCli.js [--cases E1-hermes-explanation,E2-architecture-orchestrator]
 *                               [--timeout 30000]
 *                               [--providers DeepSeek,ollama]
 *
 * Provider gateways are loaded from the same gateway config as production
 * (requires DEEPSEEK_API_KEY / OPENROUTER_API_KEY etc. in env or secure store).
 * Never prints API keys.
 */
import { loadGatewayConfig } from './services/gateway/config.js';
import { ProviderRegistry } from './services/gateway/registry.js';
import { runEvaluation } from './services/evaluation/orchestrator.js';
import { DEFAULT_EVAL_CASES } from './services/evaluation/cases.js';

const args = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = args.findIndex((a) => a === name);
  return i >= 0 ? args[i + 1] : undefined;
}

const caseFilter = flagValue('--cases');
const timeoutMs = parseInt(flagValue('--timeout') || '30000', 10);
const providerFilter = flagValue('--providers');

const config = loadGatewayConfig();
const registry = new ProviderRegistry(config);

let providers = registry.getAvailableProviders();
if (providerFilter) {
  const names = providerFilter.split(',').map((s) => s.trim());
  providers = providers.filter((p) => names.some((n) => p.name.toLowerCase() === n.toLowerCase()));
}

if (providers.length === 0) {
  console.error('No providers available. Check gateway config (env keys).');
  process.exit(1);
}

const cases = caseFilter
  ? DEFAULT_EVAL_CASES.filter((c) => caseFilter.split(',').map((s) => s.trim()).includes(c.id))
  : DEFAULT_EVAL_CASES;

console.log(`Evaluating ${providers.length} provider(s) x ${cases.length} case(s), timeout ${timeoutMs}ms`);
for (const p of providers) {
  console.log(`  provider: ${p.name} (${p.definition.model})`);
}

const summary = await runEvaluation(
  providers.map((p) => ({ name: p.name, gateway: p })),
  cases,
  { timeoutMs },
);

console.log(`\n--- COMPARISON (${summary.durationMs}ms, ${summary.persisted} persisted, ${summary.totalStored} total stored) ---`);
console.log(summary.comparisonText);
process.exit(0);

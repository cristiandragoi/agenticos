// Live DeepSeek evaluation via the secure credential store (no env dup, key
// never printed). Also runs Ollama as the local baseline when reachable.
import { loadGatewayConfig } from '../server/dist/services/gateway/config.js';
import { ProviderRegistry } from '../server/dist/services/gateway/registry.js';
import { DeepSeekGateway } from '../server/dist/services/gateway/gateways/deepseek.js';
import { ProviderCredentialService } from '../server/dist/services/gateway/credentials.js';
import { runEvaluation } from '../server/dist/services/evaluation/orchestrator.js';

const config = loadGatewayConfig();
const registry = new ProviderRegistry(config);
const providers = [];

for (const gw of registry.getAvailableProviders()) {
  if (gw.name.toLowerCase().includes('deepseek') || gw.name.toLowerCase().includes('ollama')) {
    providers.push({ name: gw.name, gateway: gw });
  }
}

// If DeepSeek is not registered from env, add it from the SECURE credential
// store when a key exists (the live backend's stored key — never printed).
// Keys live under the catalog id 'prov-deepseek' (and sometimes 'DeepSeek').
import { secretStore } from '../server/dist/services/gateway/secretStore.js';
const storedKey = (await secretStore.get('prov-deepseek').catch(() => undefined))
  || (await secretStore.get('DeepSeek').catch(() => undefined));
if (!providers.some((p) => p.name.toLowerCase() === 'deepseek') && storedKey) {
  providers.push({
    name: 'DeepSeek',
    gateway: new DeepSeekGateway({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', type: 'deepseek', apiKey: storedKey }),
  });
}

console.log('EVAL_PROVIDERS', providers.map((p) => `${p.name}(${p.gateway.definition.model})`).join(', '));
if (providers.length === 0) { console.log('NO_PROVIDERS'); process.exit(0); }

const summary = await runEvaluation(providers, [
  { id: 'E1-hermes-explanation', category: 'direct_factual', prompt: 'In one or two sentences, what does Hermes do in Agentic OS?', assertions: [{ kind: 'contains', value: 'Hermes', description: 'names Hermes' }], maxTokens: 120 },
  { id: 'E2-architecture-orchestrator', category: 'architecture_reasoning', systemPrompt: 'Agentic OS has Jarvis as commander, Hermes for research, CodeX for engineering, Magnitude for browser inspection.', prompt: 'Which worker would you use to inspect a website and why?', assertions: [{ kind: 'contains', value: 'Magnitude', description: 'selects Magnitude' }], maxTokens: 150 },
  { id: 'E4-json-schema', category: 'structured_json', jsonSchema: '{ name: string, count: number, tags: string[] }', prompt: 'Return a JSON object with exactly fields name (string), count (number), tags (string[]). Output only JSON.', assertions: [{ kind: 'valid_json', value: 'true', description: 'valid JSON' }, { kind: 'exact_field', value: 'name', description: 'has name' }], maxTokens: 200 },
], { timeoutMs: 60000 });

console.log(`\n=== LIVE EVAL SUMMARY (${summary.durationMs}ms, ${summary.persisted} persisted) ===`);
console.log(summary.comparisonText);
for (const r of summary.results) {
  console.log(`CELL ${r.caseId} ${r.provider}/${r.model}: ${r.outcome} | ${r.latencyMs}ms | ${r.firstTokenMs}ms first | ${r.totalTokens ?? '?'} tokens | ${r.error || ''}`.slice(0, 220));
}

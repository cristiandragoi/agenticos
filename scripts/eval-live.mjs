// Run the evaluation harness CLI against the LIVE gateway config + secure
// credential store (AppData DB). The DeepSeek key is resolved by the
// credential service; it is never printed.
import { loadGatewayConfig } from '../server/dist/services/gateway/config.js';
import { ProviderRegistry } from '../server/dist/services/gateway/registry.js';
import { runEvaluation } from '../server/dist/services/evaluation/orchestrator.js';

const config = loadGatewayConfig();
const registry = new ProviderRegistry(config);
let providers = registry.getAvailableProviders();
providers = providers.filter((p) => p.name.toLowerCase().includes('deepseek') || p.name.toLowerCase().includes('ollama'));

console.log('EVAL_PROVIDERS', providers.map((p) => `${p.name}(${p.definition.model})`).join(', '));
if (providers.length === 0) {
  console.log('NO_PROVIDERS');
  process.exit(0);
}

// Run a small subset to keep the live smoke bounded: E1 factual, E2 arch, E4 json.
const summary = await runEvaluation(
  providers.map((p) => ({ name: p.name, gateway: p })),
  [
    { id: 'E1-hermes-explanation', category: 'direct_factual', prompt: 'In one or two sentences, what does Hermes do in Agentic OS?', assertions: [{ kind: 'contains', value: 'Hermes', description: 'names Hermes' }], maxTokens: 120 },
    { id: 'E2-architecture-orchestrator', category: 'architecture_reasoning', systemPrompt: 'Agentic OS has Jarvis as commander, Hermes for research, CodeX for engineering, Magnitude for browser inspection.', prompt: 'Which worker would you use to inspect a website and why?', assertions: [{ kind: 'contains', value: 'Magnitude', description: 'selects Magnitude' }], maxTokens: 150 },
    { id: 'E4-json-schema', category: 'structured_json', jsonSchema: '{ name: string, count: number, tags: string[] }', prompt: 'Return a JSON object with exactly fields name (string), count (number), tags (string[]). Output only JSON.', assertions: [{ kind: 'valid_json', value: 'true', description: 'valid JSON' }, { kind: 'exact_field', value: 'name', description: 'has name' }], maxTokens: 200 },
  ],
  { timeoutMs: 45000 },
);

console.log(`\n=== LIVE EVAL SUMMARY (${summary.durationMs}ms, ${summary.persisted} persisted) ===`);
console.log(summary.comparisonText);
for (const r of summary.results) {
  console.log(`CELL ${r.caseId} ${r.provider}/${r.model}: ${r.outcome} | ${r.latencyMs}ms | ${r.firstTokenMs}ms first | ${r.totalTokens ?? '?'} tokens | ${r.error || ''}`.slice(0, 220));
}

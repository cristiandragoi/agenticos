// Insert the prov-longcat record into the persisted providers store if absent.
import fs from 'node:fs';

const file = 'server/data/providers.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : (data.providers || []);

if (list.some((p) => p && p.id === 'prov-longcat')) {
  console.log('RESULT already-present');
  process.exit(0);
}

const record = {
  id: 'prov-longcat',
  name: 'LongCat',
  kind: 'llm',
  category: 'remote',
  adapter: 'openrouter-adapter',
  authScheme: 'key',
  status: 'connected',
  scopes: ['chat', 'completion'],
  description: 'Meituan LongCat 2.0 — sparse MoE (48B active / 1.6T total), coding, repo-level changes and agentic workflows. Reached via OpenRouter (provider-confirmed model id: meituan/longcat-2.0).',
  lastActivity: 'just now',
  defaultModel: 'meituan/longcat-2.0',
  models: [{ id: 'meituan/longcat-2.0', name: 'LongCat 2.0', contextLength: 1048756 }],
  usedByAgentDefaults: ['agent-jarvis'],
};

// Insert right after prov-deepseek for a stable order.
const idx = list.findIndex((p) => p && p.id === 'prov-deepseek');
if (idx >= 0) list.splice(idx + 1, 0, record);
else list.push(record);

const out = Array.isArray(data) ? list : { ...data, providers: list };
fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log('RESULT inserted-after-prov-deepseek index=' + idx);

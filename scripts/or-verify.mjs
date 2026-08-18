// OpenRouter availability verification for poolside/laguna-s-2.1:free.
// Reads the API key from the DEPLOYED .env WITHOUT printing it.
// 1) models endpoint — is laguna-s-2.1:free listed?
// 2) 1-token completion probe — does it actually serve a completion right now?
import fs from 'node:fs';
import path from 'node:path';

const DEPLOYED_ENV = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/.env';
const envText = fs.readFileSync(DEPLOYED_ENV, 'utf8');
const get = (k) => {
  const m = envText.split(/\r?\n/).find((l) => l.startsWith(k + '='));
  return m ? m.slice(k.length + 1) : undefined;
};
const KEY = get('OPENROUTER_API_KEY');
const BASE = get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
console.log('BASE_URL:', BASE);
console.log('KEY_PRESENT:', Boolean(KEY), 'KEY_LEN:', KEY ? KEY.length : 0);
if (!KEY) { console.log('NO KEY — cannot verify'); process.exit(1); }

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// 1) Models list
const t0 = Date.now();
const res = await fetch(`${BASE}/models`, { headers, signal: AbortSignal.timeout(30000) });
const body = await res.text();
console.log(`MODELS_HTTP=${res.status} time=${Date.now() - t0}ms bytes=${body.length}`);
if (res.ok) {
  try {
    const j = JSON.parse(body);
    const all = Array.isArray(j.data) ? j.data : [];
    console.log('TOTAL_MODELS:', all.length);
    const laguna = all.filter((m) => m.id.toLowerCase().includes('laguna'));
    const poolside = all.filter((m) => m.id.toLowerCase().startsWith('poolside/'));
    console.log('LAGUNA_MODELS:', JSON.stringify(laguna.map((m) => ({ id: m.id, context: m.context_length }))));
    console.log('POOLSIDE_MODELS:', JSON.stringify(poolside.map((m) => m.id)));
    const exact = all.find((m) => m.id === 'poolside/laguna-s-2.1:free');
    console.log('EXACT_LAGUNA_FREE_PRESENT:', Boolean(exact));
    if (exact) console.log('EXACT_LAGUNA_FREE_ENTRY:', JSON.stringify({ id: exact.id, context: exact.context_length, pricing: exact.pricing, top_provider: exact.top_provider }));
  } catch (e) { console.log('MODELS_PARSE_ERR:', String(e.message)); console.log('MODELS_RAW_HEAD:', body.slice(0, 300)); }
} else {
  console.log('MODELS_RAW_HEAD:', body.slice(0, 300));
}

// 2) Tiny completion probe (1 token) — proves serving right now
const t1 = Date.now();
const probe = await fetch(`${BASE}/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'poolside/laguna-s-2.1:free',
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    max_tokens: 1,
    temperature: 0,
  }),
  signal: AbortSignal.timeout(60000),
});
const pbody = await probe.text();
const ms = Date.now() - t1;
console.log(`PROBE_HTTP=${probe.status} time=${ms}ms bytes=${pbody.length}`);
if (probe.ok) {
  try {
    const j = JSON.parse(pbody);
    const choice = j.choices?.[0];
    console.log('PROBE_MODEL:', j.model);
    console.log('PROBE_FINISH:', choice?.finish_reason);
    console.log('PROBE_TEXT:', JSON.stringify(choice?.message?.content));
    console.log('PROBE_USAGE:', JSON.stringify(j.usage));
    console.log('PROBE_HEADERS_SAMPLE:', JSON.stringify({ provider: j.provider, id: j.id }));
  } catch (e) { console.log('PROBE_PARSE_ERR:', String(e.message)); console.log('PROBE_RAW_HEAD:', pbody.slice(0, 400)); }
} else {
  console.log('PROBE_RAW_HEAD:', pbody.slice(0, 600));
}

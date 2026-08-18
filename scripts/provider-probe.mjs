// Provider reachability probe (no secrets printed): checks the real
// OpenRouter API key + model availability, and local Ollama, exactly as the
// gateway would use them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', 'server', '.env');
const envText = fs.readFileSync(envPath, 'utf8');
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
};

const orKey = get('OPENROUTER_API_KEY');
const orBase = get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
const orModel = get('OPENROUTER_MODEL') || 'auto';
const ollamaBase = get('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';

const out = { orBase, orModel, orKeyPresent: !!orKey, orKeyLen: orKey ? orKey.length : 0 };

try {
  const r = await fetch(`${orBase}/models`, { headers: { Authorization: `Bearer ${orKey}` }, signal: AbortSignal.timeout(15000) });
  out.orModelsStatus = r.status;
  const body = await r.json();
  const ids = Array.isArray(body?.data) ? body.data.map((m) => m.id) : [];
  out.orModelCount = ids.length;
  out.orModelAvailable = ids.includes(orModel);
  // find closest poolside ids for diagnostics
  out.poolsideIds = ids.filter((id) => id.toLowerCase().includes('poolside')).slice(0, 5);
} catch (e) {
  out.orModelsError = String(e.message || e);
}

try {
  const r = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
  out.ollamaStatus = r.status;
  const b = await r.json();
  out.ollamaModels = (b?.models || []).map((m) => m.name).slice(0, 8);
} catch (e) {
  out.ollamaError = String(e.message || e);
}

console.log('PROBE ' + JSON.stringify(out));

// Diagnose keytar resolution WITHOUT printing the key — only booleans.
import { secretStore } from '../server/dist/services/gateway/secretStore.js';
const keys = ['deepseek', 'prov-deepseek', 'DeepSeek', 'DEEPSEEK_API_KEY'];
const results = {};
for (const k of keys) {
  try {
    const val = await secretStore.get(k);
    results[k] = Boolean(val && val.length > 0);
  } catch (e) {
    results[k] = `ERR: ${String(e.message || e).slice(0, 80)}`;
  }
}
console.log('KEY_RESOLUTION', JSON.stringify(results));
// Also check env fallback presence (boolean only).
console.log('ENV_HAS_DEEPSEEK', Boolean(process.env.DEEPSEEK_API_KEY));

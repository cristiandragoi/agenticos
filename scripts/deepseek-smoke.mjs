// Minimal live smoke test for the DeepSeek V4 provider.
// Uses DEEPSEEK_API_KEY from env/credential store. NEVER prints the key.
import { DeepSeekGateway } from '../server/dist/services/gateway/gateways/deepseek.js';

const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.log('SMOKE SKIPPED — no DEEPSEEK_API_KEY configured');
  process.exit(0);
}
const gw = new DeepSeekGateway({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', type: 'deepseek' });

// healthcheck
const h = await gw.healthcheck();
console.log('HEALTH', JSON.stringify({ reachable: h.reachable, error: h.error }));

// models listing
try {
  const models = await gw.listModels();
  console.log('MODELS', JSON.stringify(models));
} catch (e) {
  console.log('MODELS_ERR', String(e.message).slice(0, 120));
}

// minimal completion
try {
  const r = await gw.chat({ prompt: 'Reply with exactly: OK', maxTokens: 10, timeoutMs: 30000 });
  console.log('COMPLETION', JSON.stringify({ reply: r.reply.slice(0, 40), model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens: r.totalTokens }));
} catch (e) {
  console.log('COMPLETION_ERR', String(e.message).slice(0, 200));
}

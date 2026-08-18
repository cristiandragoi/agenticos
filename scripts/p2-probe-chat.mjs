// Compare non-streaming chat paths with the backend env loaded.
import { llmChat } from '../server/dist/services/llmGateway.js';

async function probe(label, opts) {
  const r = await llmChat({ prompt: 'Reply with exactly: OK', systemPrompt: 'You are a routing connectivity probe. Reply with exactly the word OK.', agentId: 'agent-jarvis', disableFallback: true, ...opts });
  let detail = r.error;
  try { detail = JSON.parse(r.error)?.message || detail; } catch {}
  console.log(label + ' ' + JSON.stringify({ provider: r.provider, model: r.model, offline: r.offline, reply: (r.reply || '').slice(0, 40), error: String(detail).slice(0, 200) }));
}

await probe('deepseek-baseline:', { provider: 'prov-deepseek', model: 'deepseek-v4-flash', timeoutMs: 20000, maxTokens: 64 });
await probe('longcat-maxTokens64:', { provider: 'prov-longcat', model: 'meituan/longcat-2.0', timeoutMs: 30000, maxTokens: 64 });
await probe('longcat-maxTokens8:', { provider: 'prov-longcat', model: 'meituan/longcat-2.0', timeoutMs: 30000, maxTokens: 8 });

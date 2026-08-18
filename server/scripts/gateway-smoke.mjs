// P8 — DIRECT local gateway smoke test through the SAME path CodeX uses:
// llmGateway.llmChat → GatewayRouter → OllamaGateway → /api/chat.
// Loads server/.env exactly like index.ts does (dotenv, override).
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
console.log('OLLAMA_BASE_URL loaded:', process.env.OLLAMA_BASE_URL ? 'yes' : 'NO');

const { llmChat } = await import('../dist/services/llmGateway.js');

for (const model of ['llama3.2:3b', 'qwen3.5:4b']) {
  try {
    const result = await llmChat({
      systemPrompt: 'You are a smoke-test agent. Reply with the single word OK.',
      prompt: 'Say OK.',
      agentId: 'agent-codex',
      provider: 'ollama',
      model,
      maxTokens: 8,
      timeoutMs: 60000,
    });
    const reply = (result.reply || '').trim().slice(0, 80);
    console.log(`SMOKE ${model}: offline=${result.offline} provider=${result.provider} model=${result.model} error=${result.error || 'none'} reply=${JSON.stringify(reply)}`);
  } catch (e) {
    console.log(`SMOKE ${model}: THREW ${e?.message?.slice(0, 160)}`);
  }
}

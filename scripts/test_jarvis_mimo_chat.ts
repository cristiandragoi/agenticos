import { llmChat } from '../server/src/services/llmGateway.js';

async function testJarvisChat() {
  console.log('Testing llmChat with agentId: agent-jarvis...');
  const t0 = Date.now();
  const res = await llmChat({
    prompt: 'Hello Jarvis, please introduce yourself in 10 words or fewer.',
    agentId: 'agent-jarvis',
    timeoutMs: 15000,
  });
  const durationMs = Date.now() - t0;
  console.log('Response in', durationMs, 'ms:');
  console.log(JSON.stringify(res, null, 2));
}

testJarvisChat().catch(console.error);

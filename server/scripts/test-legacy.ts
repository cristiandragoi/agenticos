import path from 'path';
import dotenv from 'dotenv';
import { llmChat, llmChatStream, llmProbe, ollamaProbe } from '../src/services/llmGateway.js';
import { GatewayShutdownManager } from '../src/services/gateway/shutdown.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function runLegacyTests() {
  console.log('=== PHASE 2: LEGACY COMPATIBILITY TESTS ===\n');

  console.log('1. Testing llmProbe()...');
  const probe = await llmProbe();
  console.log('llmProbe Result:', probe);

  console.log('\n2. Testing ollamaProbe()...');
  const oProbe = await ollamaProbe();
  console.log('ollamaProbe Result:', oProbe);

  console.log('\n3. Testing llmChat()...');
  try {
    const res = await llmChat({
      prompt: 'Hello! Reply with OK.',
      maxTokens: 5,
      timeoutMs: 15000,
      provider: 'omniRoute'
    });
    console.log('llmChat Result:', res);
  } catch (err: any) {
    console.log('llmChat failed:', err.message);
  }

  console.log('\n4. Testing llmChatStream()...');
  try {
    const stream = llmChatStream({
      prompt: 'Count to 3.',
      maxTokens: 20,
      provider: 'omniRoute'
    });
    let result = '';
    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        result += chunk.content;
      }
    }
    console.log('llmChatStream Result:', result.trim());
  } catch (err: any) {
    console.log('llmChatStream failed:', err.message);
  }

  console.log('\n=== LEGACY TESTS COMPLETE ===');
  await GatewayShutdownManager.getInstance().shutdown();
}

runLegacyTests().catch(err => {
  console.error(err);
  process.exit(1);
});

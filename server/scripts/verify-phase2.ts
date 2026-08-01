import path from 'path';
import dotenv from 'dotenv';
import { loadGatewayConfig } from '../src/services/gateway/config.js';
import { GatewayRouter } from '../src/services/gateway/router.js';
import { GatewayShutdownManager } from '../src/services/gateway/shutdown.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function runVerification() {
  console.log('=== PHASE 2: REAL PROVIDER VERIFICATION ===\n');
  const config = loadGatewayConfig();
  console.log('Configured Providers:', config.providers.map(p => p.name).join(', '));
  
  const router = GatewayRouter.getInstance(config);
  
  // Wait for background benchmarks just for testing purposes so ledger output is clean
  await new Promise(r => setTimeout(r, 500)); 

  console.log('\n--- 1. Real Provider Verification ---');
  for (const p of config.providers) {
    if (p.apiKey === undefined && p.type !== 'ollama') {
      console.log(`[${p.name}] SKIPPED: credentials unavailable`);
      continue;
    }
    
    try {
      const health = await router.healthcheck(p.name);
      if (!health.reachable) {
        console.log(`[${p.name}] TEST FAILED: Healthcheck unreachable -> ${health.error}`);
        continue;
      }
      
      const res = await router.chat({ prompt: 'Reply with the word OK only.', maxTokens: 5, timeoutMs: 10000 }, { provider: p.name });
      console.log(`[${p.name}] TESTED SUCCESSFULLY: Chat responded with: "${res.reply}". Tokens: ${res.promptTokens} prompt, ${res.completionTokens} completion`);
    } catch (err: any) {
      console.log(`[${p.name}] TEST FAILED: ${err.message}`);
    }
  }

  console.log('\n--- 2. Real Fallback Tests (Isolated Config) ---');
  const isolatedRegistry = (router as any).registry;
  const originalProviders = new Map(isolatedRegistry.providers);
  
  // Create simulated providers for testing overrides
  isolatedRegistry.providers.set('mock-omni', { 
    name: 'mock-omni', 
    definition: { name: 'mock-omni', model: 'omni', type: 'openai', baseUrl: '' },
    chat: async () => { throw new Error('HTTP 500'); },
    stream: async function*() { throw new Error('HTTP 500'); }
  });
  isolatedRegistry.providers.set('mock-nine', { 
    name: 'mock-nine', 
    definition: { name: 'mock-nine', model: 'nine', type: 'openai', baseUrl: '' },
    chat: async () => ({ reply: 'Nine Success', provider: 'mock-nine' }) 
  });
  
  (router as any).config.providerOrder = ['mock-omni', 'mock-nine'];

  let fallbackEvents = 0;
  const flistener = (ev: any) => { if (ev.type === 'gateway.fallback') fallbackEvents++; };
  router.onEvent(flistener);
  
  try {
    const res = await router.chat({ prompt: 'Fallback test' }); 
    console.log(`[Fallback Test] Reached provider: ${res.provider}, Fallback Events: ${fallbackEvents}`);
  } catch (err: any) {
    console.log(`[Fallback Test] Failed: ${err.message}`);
  }
  
  // Cleanup
  isolatedRegistry.providers = originalProviders;
  (router as any).config.providerOrder = config.providerOrder;
  (router as any).eventListeners = (router as any).eventListeners.filter((l:any) => l !== flistener);

  console.log('\n--- 3. Real Streaming Verification ---');
  try {
    let tokens = 0;
    let provider = '';
    const stream = router.stream({ prompt: 'Write a long poem.', maxTokens: 100 });
    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        tokens++;
        provider = chunk.provider;
      }
    }
    console.log(`[Stream Test] Successfully received ${tokens} tokens from ${provider}`);
  } catch (err: any) {
    console.log(`[Stream Test] Failed: ${err.message}`);
  }

  console.log('\n=== VERIFICATION COMPLETE ===');
  await GatewayShutdownManager.getInstance().shutdown();
}

runVerification().catch(err => {
  console.error(err);
  process.exit(1);
});

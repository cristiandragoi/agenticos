import { loadGatewayConfig } from '../services/gateway/config.js';
import { GatewayRouter } from '../services/gateway/router.js';
import { GatewayRunLedger } from '../services/gateway/ledger.js';
import { ProviderCredentialService } from '../services/gateway/credentials.js';
import { OpenAICompatibleGateway } from '../services/gateway/gateways/openai.js';
import { db } from '../db/index.js';

// Load env
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });

async function testDeepSeekDirect() {
  console.log('=== DEEPSEEK DIRECT TEST ===');
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  const apiKey = process.env.DEEPSEEK_API_KEY;
  
  if (!apiKey) {
    console.log('NO DEEPSEEK API KEY FOUND');
    return { ok: false, error: 'no key' };
  }
  
  const results = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Reply exactly: DEEPSEEK OK' }],
          max_tokens: 10,
          temperature: 0
        }),
        signal: AbortSignal.timeout(15000)
      });
      const ttfb = Date.now() - start;
      const body = await res.text();
      console.log(`Attempt ${i+1}: HTTP ${res.status}, TTFB ${ttfb}ms, body: ${body.slice(0,200)}`);
      results.push({ ok: res.ok, status: res.status, ttfb, body: body.slice(0,200) });
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`Attempt ${i+1}: FAILED after ${elapsed}ms:`, err.message, '| cause:', err.cause?.code || err.cause?.message || 'none');
      results.push({ ok: false, error: err.message, cause: err.cause?.code || err.cause?.message, elapsed });
    }
  }
  return { ok: results.some(r => r.ok), results };
}

async function testGatewayFallback() {
  console.log('\n=== GATEWAY FALLBACK TEST ===');
  const config = loadGatewayConfig();
  console.log('Configured providers:', config.providers.map(p => p.name).join(', '));
  console.log('Provider order:', config.providerOrder.join(', '));
  
  const ledger = new GatewayRunLedger(config.logsPath);
  const router = GatewayRouter.getInstance(config, ledger);
  
  const start = Date.now();
  try {
    const res = await router.chat({
      prompt: 'Reply exactly: GATEWAY OK',
      maxTokens: 10,
      timeoutMs: 15000,
      requestId: 'resilience-test-' + Date.now()
    }, { provider: 'DeepSeek' });
    console.log(`Gateway SUCCESS after ${Date.now()-start}ms via ${res.provider}/${res.model}: ${res.reply}`);
    return { ok: true, provider: res.provider, model: res.model, elapsed: Date.now()-start };
  } catch (err) {
    console.log(`Gateway FAILED after ${Date.now()-start}ms:`, err.message);
    return { ok: false, error: err.message, elapsed: Date.now()-start };
  }
}

async function testOpenRouterFallback() {
  console.log('\n=== OPENROUTER FALLBACK TEST ===');
  const config = loadGatewayConfig();
  const ledger = new GatewayRunLedger(config.logsPath);
  const router = GatewayRouter.getInstance(config, ledger);
  
  const start = Date.now();
  try {
    const res = await router.chat({
      prompt: 'Reply exactly: OPENROUTER OK',
      maxTokens: 10,
      timeoutMs: 15000,
      requestId: 'openrouter-test-' + Date.now()
    }, { provider: 'openrouter' });
    console.log(`OpenRouter SUCCESS after ${Date.now()-start}ms via ${res.provider}/${res.model}: ${res.reply}`);
    return { ok: true, provider: res.provider, model: res.model, elapsed: Date.now()-start };
  } catch (err) {
    console.log(`OpenRouter FAILED after ${Date.now()-start}ms:`, err.message);
    return { ok: false, error: err.message, elapsed: Date.now()-start };
  }
}

async function main() {
  const deepseek = await testDeepSeekDirect();
  const gateway = await testGatewayFallback();
  const openrouter = await testOpenRouterFallback();
  
  console.log('\n=== SUMMARY ===');
  console.log('DeepSeek direct:', deepseek.ok ? 'HEALTHY' : 'UNAVAILABLE');
  console.log('Gateway via DeepSeek:', gateway.ok ? 'PASS' : 'FAIL');
  console.log('OpenRouter fallback:', openrouter.ok ? 'PASS' : 'FAIL');
  
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

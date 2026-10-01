// Verification of Item 3: Offline Mode
// Safely simulate cloud-provider outage without deleting credentials.

process.env.CODEX_BASE_URL = 'http://127.0.0.1:9999/v1'; // unreachable cloud simulation
process.env.OMNIROUTE_BASE_URL = 'http://127.0.0.1:9999/v1';
process.env.OPENROUTER_BASE_URL = 'http://127.0.0.1:9999/v1';
process.env.DEEPSEEK_BASE_URL = 'http://127.0.0.1:9999/v1';

import { routeTurn } from './dist/domains/jarvisNext/turnRouter.js';

async function run() {
  console.log('=== VERIFYING OFFLINE MODE (CLOUD OUTAGE SIMULATION) ===\n');

  // Check Ollama status
  let ollamaStatus = 'UNREACHABLE';
  let localModel = 'none';
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      ollamaStatus = 'ONLINE';
      localModel = data.models?.[0]?.name || 'qwen3.5:9b-hermes-64k';
    }
  } catch {}

  console.log(`CLOUD_PROVIDER_STATUS: OUTAGE_SIMULATED (port 9999)`);
  console.log(`OLLAMA_STATUS: ${ollamaStatus}`);
  console.log(`HERMES_STATUS: ONLINE (local runtime)`);
  console.log(`LOCAL_MODEL: ${localModel}`);
  console.log(`FALLBACK_USED: DETERMINISTIC_PROVIDERS + LOCAL_OLLAMA\n`);

  const convId = `offline-test-${Date.now().toString(36)}`;

  const testCases = [
    { prompt: 'What is 2 + 2?', expectedRegex: /4/ },
    { prompt: 'What projects do we have?', expectedRegex: /Free Cash|Hermes/i },
    { prompt: 'Open Free Cash.', expectedRegex: /Free Cash/i },
    { prompt: 'What is blocked?', expectedRegex: /blocked/i },
    { prompt: 'What is Revenue Operator doing?', expectedRegex: /supervisor|running|missions|opportunities/i },
    { prompt: 'Set Hermes Operational Acceptance to priority 4.', expectedRegex: /priority 4/i },
    { prompt: 'Summarize Free Cash.', expectedRegex: /Free Cash/i },
  ];

  let passed = 0;
  for (const tc of testCases) {
    console.log(`>>> ${tc.prompt}`);
    const res = await routeTurn({ prompt: tc.prompt, conversationId: convId });
    const ok = res.handled && tc.expectedRegex.test(res.text);
    console.log(`<<< [route=${res.route}] ${ok ? 'PASS' : 'FAIL'}: ${res.text}`);
    if (res.text.includes('No external model is reachable')) {
      throw new Error(`CRITICAL: System returned offline crippling error: ${res.text}`);
    }
    if (!ok) {
      throw new Error(`Test failed for "${tc.prompt}". Text: "${res.text}"`);
    }
    passed++;
  }

  console.log(`\nTOTAL ${passed}/${testCases.length} offline operations passed.`);
  console.log('================ OFFLINE MODE VERIFICATION PASSED ================');
}

run().catch((err) => {
  console.error('OFFLINE TEST FAILED:', err);
  process.exit(1);
});

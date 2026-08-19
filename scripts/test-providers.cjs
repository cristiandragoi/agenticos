// Bounded provider health + execution tests via the existing backend test-routing API.
// Tests: DeepSeek (assignment), OpenRouter, Ollama. No secrets printed.
const { execSync } = require('child_process');

function probe(name, fn) {
  return new Promise(resolve => {
    const t0 = Date.now();
    fn().then(res => resolve({ name, ok: true, ms: Date.now() - t0, res }))
      .catch(e => resolve({ name, ok: false, ms: Date.now() - t0, err: e.message.split('\n')[0] }));
  });
}

(async () => {
  // 1. DeepSeek via the agent-codex assignment test endpoint (real llmChat path)
  const deepseek = await probe('DeepSeek(agent-codex test)', () =>
    fetch('http://127.0.0.1:4000/api/settings/agent-provider-assignments/agent-codex/test', { method: 'POST' }).then(r => r.json())
  );

  // 2. OpenRouter direct bounded chat through /api/chat/quick (omniRoute-ish path uses gateway)
  const openrouter = await probe('OpenRouter', () =>
    fetch('http://127.0.0.1:4000/api/chat/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'CodeX', message: 'Reply with exactly: OK', providerOverride: 'openrouter' })
    }).then(r => r.json())
  );

  // 3. Ollama direct
  const ollama = await probe('Ollama', () =>
    fetch('http://127.0.0.1:4000/api/chat/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'CodeX', message: 'Reply with exactly: OK', providerOverride: 'ollama' })
    }).then(r => r.json())
  );

  for (const r of [deepseek, openrouter, ollama]) {
    console.log('---', r.name, r.ok ? 'OK' : 'FAIL', r.ms + 'ms');
    console.log(JSON.stringify(r.res || r.err, null, 1).slice(0, 600));
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

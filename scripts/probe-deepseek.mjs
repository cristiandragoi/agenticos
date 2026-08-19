// DeepSeek live transport probe — no secrets printed.
// Tests: DNS/connect via /v1/models with no auth (401 = reachable+auth needed),
// then a tiny bounded chat POST using DEEPSEEK_API_KEY from the process env.
const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

function summarizeCause(e) {
  const c = e && e.cause;
  if (!c) return null;
  return {
    name: e.name,
    code: c.code || c.errno || null,
    syscall: c.syscall || null,
    hostname: c.hostname || null,
    message: c.message || null
  };
}

(async () => {
  // 1) Connectivity: unauthenticated GET /v1/models — expect 401 (reachable) or 200 (weird)
  try {
    const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(15000) });
    console.log('PROBE models GET status:', r.status);
  } catch (e) {
    console.log('PROBE models GET FAILED:', e.name, e.message, 'cause=', JSON.stringify(summarizeCause(e)));
  }

  // 2) DNS resolution check
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.deepseek.com/', { signal: AbortSignal.timeout(15000) });
    console.log('PROBE root GET status:', r.status, `(${Date.now() - t0}ms)`);
  } catch (e) {
    console.log('PROBE root GET FAILED:', e.name, e.message, 'cause=', JSON.stringify(summarizeCause(e)));
  }

  // 3) Authenticated tiny chat (only if key present in env)
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('PROBE chat: DEEPSEEK_API_KEY not set in this process env — skipping');
  } else {
    try {
      const t0 = Date.now();
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(30000)
      });
      const text = await r.text();
      console.log('PROBE chat POST status:', r.status, '(' + (Date.now() - t0) + 'ms) body:', text.slice(0, 200));
    } catch (e) {
      console.log('PROBE chat POST FAILED:', e.name, e.message, 'cause=', JSON.stringify(summarizeCause(e)));
    }
  }
})().catch(e => { console.log('PROBE FATAL', e); process.exit(1); });

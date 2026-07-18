async function test() {
  const endpoints = [
    { name: '/chat/test', url: 'http://localhost:4000/api/chat/test', method: 'GET' },
    { name: '/chat/quick', url: 'http://localhost:4000/api/chat/quick', method: 'POST', body: { message: 'Say hi in 5 words' } },
    { name: '/chat/agents/run', url: 'http://localhost:4000/api/chat/agents/run', method: 'POST', body: { agent: 'agent-codex', message: 'Say hi in 5 words' } },
    { name: '/chat/hermes', url: 'http://localhost:4000/api/chat/hermes', method: 'POST', body: { prompt: 'Say hi in 5 words' } },
    { name: '/jarvis/command', url: 'http://localhost:4000/api/jarvis/command', method: 'POST', body: { prompt: 'Say hi in 5 words' } },
  ];

  for (const ep of endpoints) {
    try {
      const opts = ep.method === 'POST'
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ep.body) }
        : {};
      const r = await fetch(ep.url, opts);
      const d = await r.json();
      console.log(`\n${ep.name} (HTTP ${r.status}):`);
      console.log(JSON.stringify(d, null, 2));
    } catch (e) {
      console.error(`${ep.name}: FETCH ERROR`, e.message);
    }
  }
}
test();

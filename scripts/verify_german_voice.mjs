// Verifies which German voice the live app actually uses.
const BASE = 'http://127.0.0.1:4600/api';
const H = { ...(process.env.AGENTOS_API_TOKEN ? { Authorization: `Bearer ${process.env.AGENTOS_API_TOKEN}` } : {}), 'Content-Type': 'application/json' };

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`, { headers: H });
      if (r.ok) { const j = await r.json(); console.log('health buildId:', j.buildId || j.build?.buildId || JSON.stringify(j).slice(0, 200)); return; }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('backend not healthy');
}

await waitHealth();
const st = await (await fetch(`${BASE}/voice/tts/status?language=de`, { headers: H })).json();
console.log('STATUS(de):', JSON.stringify(st));

for (const text of ['Guten Abend. Ich bin Jarvis, dein Assistent.', 'Das Wetter in Berlin ist heute sonnig.']) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/voice/tts`, { method: 'POST', headers: H, body: JSON.stringify({ text, language: 'de', voice: 'aura-2-julius-de' }) });
  const j = await r.json();
  console.log(`TTS(de) http=${r.status} provider=${j.provider} voice=${j.voice} format=${j.format} bytes=${j.audioData ? Math.round(j.audioData.length * 0.75) : 0} ms=${Date.now() - t0} err=${j.error || ''}`);
}
// Old Charlotte request must not be honoured
const r2 = await fetch(`${BASE}/voice/tts`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Hallo Welt.', language: 'de', voice: 'aura-2-charlotte-de' }) });
const j2 = await r2.json();
console.log(`TTS(de, charlotte requested) http=${r2.status} provider=${j2.provider} voice=${j2.voice}`);

const st2 = await (await fetch(`${BASE}/voice/tts/status?language=de`, { headers: H })).json();
console.log('lastSynthesis:', JSON.stringify(st2.lastSynthesis));

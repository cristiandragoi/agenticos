// Baseline latency measurement — server-side only, against the CURRENTLY
// RUNNING instance (old bundle, no fast path). Measures the full model path
// for the prompts the mission cares about: presence + direct explanation.
// Read-only API calls; no GUI drive, no audio.
const BASE = 'http://127.0.0.1:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(prompt) {
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
  const convs = await convRes.json();
  const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
  if (!convId) return { prompt, error: 'no conversation' };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, operationId: `baseline-${Date.now()}`, inputChannel: 'voice', approvalPolicy: 'auto' }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstChunkAt = null;
  let doneAt = null;
  let route = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const frame of buffer.split('\n\n')) {
      if (frame.startsWith('event: chunk')) { if (firstChunkAt === null) firstChunkAt = Date.now() - t0; }
      if (frame.startsWith('event: done')) {
        doneAt = Date.now() - t0;
        const m = frame.match(/data: ({.*})/);
        if (m) { try { route = JSON.parse(m[1]).route; } catch {} }
      }
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
    if (doneAt !== null) break;
  }
  return { prompt, firstChunkMs: firstChunkAt, doneMs: doneAt, route };
}

const results = [];
for (const p of [
  'Jarvis, are you there?',
  'What is Agentic OS?',
  'Jarvis, what does Hermes do?',
]) {
  try { results.push(await measure(p)); } catch (e) { results.push({ prompt: p, error: String(e).slice(0, 120) }); }
  await sleep(800);
}
console.log('BASELINE_LATENCY ' + JSON.stringify(results, null, 2));

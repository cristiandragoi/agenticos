// Final Magnitude live probes: Jarvis→Magnitude routing (M9) via the stream
// endpoint, plus save the screenshot evidence locally for the report.
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:4000';

async function probeIntent(prompt) {
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
  const convs = await convRes.json();
  const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
  if (!convId) return { prompt, error: 'no conversation' };
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, operationId: `mag-final-${Date.now()}`, inputChannel: 'typed', approvalPolicy: 'auto' }),
  });
  const text = await res.text();
  const frames = text.split('\n\n');
  const intent = frames.filter((f) => f.startsWith('event: intent')).map((f) => {
    const m = f.match(/data: ({.*})/);
    return m ? JSON.parse(m[1]) : null;
  })[0];
  const hasMagnitudeStatus = frames.some((f) => f.includes('browser worker') || f.includes('Magnitude'));
  return { prompt, intentRoute: intent?.route, intentType: intent?.type, hasMagnitudeStatus };
}

const m9 = await probeIntent('Jarvis, inspect example.com and tell me the page title.');
console.log('M9_LIVE', JSON.stringify(m9));

// Save screenshot evidence from the last proj-A run.
const runs = await (await fetch(`${BASE}/api/magnitude/runs?projectId=proj-A`)).json();
const runA = Array.isArray(runs) ? runs[0] : null;
if (runA?.id) {
  const shot = await fetch(`${BASE}/api/magnitude/runs/${runA.id}/screenshot`);
  const buf = Buffer.from(await shot.arrayBuffer());
  fs.mkdirSync('scripts/p3-shots/magnitude', { recursive: true });
  fs.writeFileSync('scripts/p3-shots/magnitude/proj-a-evidence.png', buf);
  console.log('SCREENSHOT_SAVED', buf.length, 'bytes');
}

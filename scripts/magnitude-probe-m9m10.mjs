// M9/M10 live probes against the deployed backend.
// M9: "Jarvis, inspect example.com and tell me the page title" → intent route.
// M10: verify scheduleDispatcher recognizes magnitude as a canonical worker.
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:4000';

// M9a: does the intent router classify a browser-inspect prompt as magnitude?
// (We can't call the internal router over HTTP directly; the observable path
// is POST message/stream and inspect the intent event.)
async function probeIntent(prompt) {
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
  const convs = await convRes.json();
  const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
  if (!convId) return { prompt, error: 'no conversation' };
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, operationId: `mag-m9-${Date.now()}`, inputChannel: 'typed', approvalPolicy: 'auto' }),
  });
  const text = await res.text();
  const intent = text.split('\n\n').filter((f) => f.startsWith('event: intent')).map((f) => {
    const m = f.match(/data: ({.*})/);
    return m ? JSON.parse(m[1]) : null;
  })[0];
  return { prompt, intentRoute: intent?.route, intentType: intent?.type, reason: intent?.reason };
}

// M9b: scheduleDispatcher source — magnitude is a canonical worker.
const dispatcherSrc = fs.readFileSync('server/src/services/scheduler/scheduleDispatcher.ts', 'utf8');
const m10Static = {
  recognizesMagnitudeWorker: /worker === 'magnitude'/.test(dispatcherSrc),
  dispatchesViaMagnitudeAdapter: /executeMagnitudeTask/.test(dispatcherSrc),
  usesCanonicalTaskPath: /projectTaskService|createTask/.test(dispatcherSrc),
};

const intentResult = await probeIntent('Jarvis, inspect example.com and tell me the page title.');
console.log('M9_INTENT', JSON.stringify(intentResult));
console.log('M10_STATIC', JSON.stringify(m10Static));

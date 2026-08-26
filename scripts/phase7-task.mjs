const BASE = process.env.BASE || 'http://127.0.0.1:4003';
const TOKEN = 'P7X9K2M4';
const TASK = process.env.TASK || 'bgtask-e0c8dff4c';
const M = ['JARVIS_PROMPT_BEGIN_' + TOKEN, 'JARVIS_PROMPT_QUARTER_' + TOKEN, 'JARVIS_PROMPT_HALF_' + TOKEN, 'JARVIS_PROMPT_THREE_QUARTER_' + TOKEN, 'JARVIS_PROMPT_END_' + TOKEN];

async function j(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

console.log('=== BACKGROUND TASK ' + TASK + ' ===');
const t = await j(`/api/background-tasks/${TASK}`);
const d = t.data || {};
console.log('status:', d.status, '| worker:', d.worker, '| currentStage:', d.currentStage);
console.log('title:', (d.title || '').slice(0, 120));
console.log('\n=== MARKER SURVIVAL in objective/originalRequest ===');
const obj = d.objective || '';
const orig = d.originalRequest || '';
const res = {};
for (const m of M) {
  res[m] = { objective: obj.includes(m), originalRequest: orig.includes(m) };
}
console.log(JSON.stringify(res, null, 2));
console.log('objective length:', obj.length, '| originalRequest length:', orig.length);
console.log('\nlinkedRunId:', d.linkedRunId, '| metadata:', JSON.stringify((d.metadata || {})).slice(0, 500));

// Poll for terminal state
const deadline = Date.now() + 200000;
let cur = d;
while (!['completed', 'failed', 'blocked', 'cancelled'].includes(cur.status) && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const r = await j(`/api/background-tasks/${TASK}`);
  cur = r.data || {};
  console.log(`[poll] ${new Date().toISOString().slice(11,19)} status=${cur.status} stage=${cur.currentStage || '-'}`);
}
console.log('\n=== FINAL TASK ===');
console.log(JSON.stringify({
  status: cur.status, worker: cur.worker, currentStage: cur.currentStage,
  linkedRunId: cur.linkedRunId, resultText: (cur.resultText || '').slice(0, 500),
  lastError: cur.lastError, blocker: cur.blocker,
  provider: cur.metadata?.assignedProvider || cur.metadata?.effectiveProvider,
  model: cur.metadata?.assignedModel || cur.metadata?.effectiveModel,
  workerInstanceId: cur.metadata?.workerInstanceId,
}, null, 2));

import { writeFileSync } from 'node:fs';
writeFileSync('B:/AgenticOS/docs/overnight-repair/phase7-task.json', JSON.stringify(cur, null, 2));
console.log('Saved -> docs/overnight-repair/phase7-task.json');

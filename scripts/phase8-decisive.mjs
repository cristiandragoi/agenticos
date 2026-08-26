// Phase 8 decisive live test — Jarvis stream → Hermes (in-repo) → CodeX (in-repo) → edit + test.
const BASE = process.env.BASE || 'http://127.0.0.1:4003';

async function j(method, path, body, timeoutMs = 20000) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

const prompt = [
  'Ask Hermes to plan a small engineering task and delegate its implementation to CodeX.',
  'The task: read server/src/__tests__/phase8CodexRouting.test.ts and server/src/services/backgroundTasks/taskControl.ts,',
  'search the repository for "classifyTaskControl",',
  'then add ONE harmless assertion to phase8CodexRouting.test.ts verifying that classifyTaskControl("hello world") returns null,',
  'and run the targeted vitest to prove it passes.',
  'Do not modify any other files.',
].join('\n');

console.log('=== PHASE 8 DECISIVE — live Jarvis stream → Hermes → in-repo CodeX ===');
const conv = await j('POST', '/api/jarvis/conversations', { title: 'Phase 8 decisive' });
const convId = conv.data.id;
console.log('conversationId:', convId);

const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, workspacePath: 'B:\\AgenticOS', approvalPolicy: 'auto', operationId: 'phase8-decisive' }),
});
console.log('stream status', res.status);

const events = [];
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let taskId = null;
let sawDone = false;
while (!sawDone) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
    let ev = 'message', dat = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) dat += line.slice(5).trim();
    }
    if (!dat) continue;
    let p = dat; try { p = JSON.parse(dat); } catch {}
    events.push({ ev, data: p });
    if (ev === 'intent') console.log('INTENT:', JSON.stringify(p).slice(0, 260));
    if (ev === 'done') { taskId = p.taskId; console.log('DONE:', JSON.stringify(p).slice(0, 260)); sawDone = true; }
  }
}

if (!taskId) { console.log('NO TASK ID — events:', events.map(e => e.ev).join(',')); process.exit(1); }

// Poll the background task.
const deadline = Date.now() + 360000;
let cur = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 6000));
  const t = await j('GET', `/api/background-tasks/${taskId}`);
  cur = t.data || {};
  const meta = cur.metadata || {};
  const codexGoal = meta.codexGoalId || meta.delegatedBy ? `codexGoal=${meta.codexGoalId} delegatedBy=${meta.delegatedBy}` : '(no codex delegation yet)';
  console.log(`[poll] ${new Date().toISOString().slice(11,19)} status=${cur.status} stage=${cur.currentStage || '-'} ${codexGoal}`);
  if (['completed', 'failed', 'blocked', 'cancelled'].includes(cur.status)) break;
}

console.log('\n=== FINAL TASK ===');
console.log(JSON.stringify({
  taskId, status: cur.status, worker: cur.worker,
  linkedRunId: cur.linkedRunId,
  metadata: {
    codexGoalId: cur.metadata?.codexGoalId,
    delegatedBy: cur.metadata?.delegatedBy,
    hermesPlanRunId: cur.metadata?.hermesPlanRunId,
    provider: cur.metadata?.assignedProvider || cur.metadata?.provider,
    model: cur.metadata?.assignedModel || cur.metadata?.model,
  },
  resultText: (cur.resultText || '').slice(0, 700),
  lastError: cur.lastError, blocker: cur.blocker,
  filesChanged: cur.filesChanged,
}, null, 2));

import { writeFileSync, readFileSync } from 'node:fs';
writeFileSync('B:/AgenticOS/docs/overnight-repair/phase8-decisive.json', JSON.stringify({ convId, taskId, events, task: cur }, null, 2));

// Verify the edit actually landed in the test file.
try {
  const f = readFileSync('B:/AgenticOS/server/src/__tests__/phase8CodexRouting.test.ts', 'utf8');
  console.log('\n=== TEST FILE NOW CONTAINS "hello world" assertion? ===', f.includes('hello world'));
} catch (e) { console.log('test file read error', e.message); }
console.log('\nSaved -> docs/overnight-repair/phase8-decisive.json');

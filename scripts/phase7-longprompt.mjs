// Phase 7 — long-prompt preservation through the live Jarvis stream endpoint.
// Proves: (1) the Phase-6 fix does NOT hijack normal engineering language into
// task-control; (2) all 5 markers survive to persisted conversation + Hermes +
// delegated CodeX goal.
const BASE = process.env.BASE || 'http://127.0.0.1:4003';
const TOKEN = 'P7X9K2M4';

const M = {
  begin: `JARVIS_PROMPT_BEGIN_${TOKEN}`,
  quarter: `JARVIS_PROMPT_QUARTER_${TOKEN}`,
  half: `JARVIS_PROMPT_HALF_${TOKEN}`,
  threeq: `JARVIS_PROMPT_THREE_QUARTER_${TOKEN}`,
  end: `JARVIS_PROMPT_END_${TOKEN}`,
};

const prompt = [
  `${M.begin} Please help me improve the task execution pipeline.`,
  `I have noticed that when a background task fails, the retry logic sometimes leaves the run in a stale state.`,
  `${M.quarter} The restart recovery path should reconcile any goal that completed while the backend was down.`,
  `We also need the parent task to reach a terminal state without manual intervention.`,
  `${M.half} Ask Hermes to plan a bounded read-only inspection, and delegate it to CodeX: examine the restart recovery implementation in server/src/services/backgroundTasks/adapters.ts and report how reconcileCodexTasksAfterRestart works.`,
  `${M.threeq} Also verify that a completed goal's parent task transitions correctly, and that retry does not duplicate runs.`,
  `Do not modify any files during this inspection, and do not run any tests.`,
  `${M.end} Report the delegated CodeX goal identifier and its findings truthfully.`,
].join('\n');

async function j(method, path, body, timeoutMs = 20000) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

console.log('=== PHASE 7 — long-prompt preservation ===');
console.log('token:', TOKEN, '| markers:', Object.values(M).join(' | '));

const conv = await j('POST', '/api/jarvis/conversations', { title: 'Phase 7 long-prompt' });
const convId = conv.data.id;
console.log('conversationId:', convId);

// Stream request — capture SSE events.
const t0 = Date.now();
const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, workspacePath: 'B:\\AgenticOS', approvalPolicy: 'auto', operationId: `p7-${TOKEN}` }),
});
console.log('stream status', res.status);

const events = [];
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const deadline = Date.now() + 240000;
let sawDone = false;
while (!sawDone && Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  // SSE frames split by blank line.
  let idx;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    let ev = 'message', dat = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) dat += line.slice(5).trim();
    }
    if (!dat) continue;
    let parsed = dat;
    try { parsed = JSON.parse(dat); } catch { /* keep raw */ }
    events.push({ ev, data: parsed });
    const s = JSON.stringify(parsed);
    if (ev === 'done' || /"status":"(completed|failed|blocked|cancelled)"/.test(s) || ev === 'error') sawDone = true;
  }
}
console.log('stream elapsed', ((Date.now() - t0) / 1000).toFixed(1) + 's', '| events:', events.length);

// 1. Intent classification (must NOT be task_control)
console.log('\n=== INTENT EVENTS ===');
for (const e of events.filter(e => e.ev === 'intent' || e.ev === 'route')) {
  console.log(JSON.stringify(e.data).slice(0, 500));
}

// 2. Persisted conversation/message marker check
const msgs = await j('GET', `/api/jarvis/conversations/${convId}/messages`);
const userMsg = (Array.isArray(msgs.data) ? msgs.data : []).find(m => m.role === 'user');
const userContent = userMsg?.content || '';
console.log('\n=== MARKER SURVIVAL (persisted user message) ===');
const markerResults = {};
for (const [k, marker] of Object.entries(M)) {
  markerResults[k] = userContent.includes(marker);
}
console.log(JSON.stringify(markerResults, null, 2));
console.log('user message length:', userContent.length, '| prompt length:', prompt.length);

// 3. Agent/system messages (Hermes result, codex delegation metadata)
console.log('\n=== AGENT/SYSTEM MESSAGES ===');
for (const m of (Array.isArray(msgs.data) ? msgs.data : [])) {
  if (m.role === 'user') continue;
  const meta = m.metadata || {};
  console.log(JSON.stringify({
    role: m.role, messageType: m.messageType,
    codexDelegation: meta.codexDelegation ? { goalId: meta.codexDelegation.goalId, status: meta.codexDelegation.status } : null,
    worker: meta.worker, goalId: meta.goalId, taskId: meta.taskId, runId: meta.runId, resultId: meta.resultId,
    verdict: meta.verdict,
    content: (m.content || '').slice(0, 800),
  }, null, 2));
}

import { writeFileSync } from 'node:fs';
writeFileSync('B:/AgenticOS/docs/overnight-repair/phase7-raw.json', JSON.stringify({ token: TOKEN, convId, prompt, events, messages: msgs.data }, null, 2));
console.log('\nSaved -> docs/overnight-repair/phase7-raw.json');

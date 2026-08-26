// acceptance-step1.cjs — STEP 1: run a real read-only CodeX repository analysis
// in a fresh live Jarvis conversation, wait for the grounded worker result to
// persist, and write conversation + goal ids to .acceptance-state.json.
const http = require('http');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4000';
const STATE = 'B:/AgenticOS/scripts/.acceptance-state.json';
const PROMPT = 'Jarvis, perform a read-only analysis of the live Agentic OS repository and identify the five biggest production problems you can verify from the source code. Use CodeX to inspect the repository. Do not modify, patch, delete, deploy, or change any files or configuration. For each finding, include the exact files inspected, concrete evidence, production impact, and confidence. Persist the completed CodeX result into this conversation.';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({ raw: d, http: res.statusCode }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function sse(method, path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const u = new URL(BASE + path);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve(buf));
    });
    r.on('error', () => resolve(''));
    r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const conv = await req('POST', '/api/jarvis/conversations', { title: 'DIAGNOSTIC acceptance: CodeX repo analysis -> verification' });
  const convId = conv.id || conv.conversationId;
  console.log('CONV_ID:', convId);
  fs.writeFileSync(STATE, JSON.stringify({ convId, step1: {} }, null, 2));

  const stream = await sse('POST', `/api/jarvis/conversations/${convId}/message/stream`, { prompt: PROMPT, workspacePath: 'B:/AgenticOS' });
  console.log('=== STEP1 stream (intent/done events) ===');
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === 'intent') console.log('  INTENT:', JSON.stringify({ route: ev.route, worker: ev.worker, intentType: ev.intentType }));
      else if (ev.type === 'done') console.log('  DONE:', JSON.stringify({ status: ev.status, goalId: ev.goalId, taskId: ev.taskId, category: ev.category }));
    } catch {}
  }

  // Poll for the grounded worker result.
  const deadline = Date.now() + 20 * 60 * 1000;
  let result = null;
  while (Date.now() < deadline) {
    await sleep(8000);
    const msgs = await req('GET', `/api/jarvis/conversations/${convId}/messages`);
    const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
    result = arr.find((m) => m.role === 'agent' && (m.metadata?.workerResult === true || m.metadata?.groundedEvidence === true));
    if (result) {
      const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
      st.step1 = {
        resultMessageId: result.id,
        goalId: result.goalId || result.metadata?.goalId || null,
        groundedEvidence: !!result.metadata?.groundedEvidence,
        workerResult: !!result.metadata?.workerResult,
        preview: String(result.content || '').slice(0, 500),
      };
      fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
      console.log('\n=== STEP1 GROUNDED RESULT PERSISTED ===');
      console.log('  messageId:', result.id);
      console.log('  goalId:', result.goalId || result.metadata?.goalId);
      console.log('  groundedEvidence:', result.metadata?.groundedEvidence, '| workerResult:', result.metadata?.workerResult);
      console.log('  content preview:\n' + String(result.content).slice(0, 1200));
      return;
    }
    const ack = arr.find((m) => /CodeX Goal initialized/.test(String(m.content || '')));
    if (ack) console.log('  (goal initialized:', (ack.metadata?.taskId || ack.goalId || ''), ')');
  }
  console.log('=== TIMEOUT: no grounded result after 20min ===');
  process.exitCode = 2;
})();

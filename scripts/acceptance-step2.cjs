// acceptance-step2.cjs — STEP 2: in the SAME conversation, ask to verify the five
// findings. Captures the verification goal id + result message id into state.
const http = require('http');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4000';
const STATE = 'B:/AgenticOS/scripts/.acceptance-state.json';
const PROMPT = 'Jarvis, now independently verify the five production problems CodeX just reported in this conversation. Use CodeX to inspect the actual source code again. Treat the previous five findings as hypotheses, not truth. For each finding classify it as VERIFIED, PARTIALLY VERIFIED, or NOT VERIFIED, and give me the exact files, concrete evidence, production impact, and priority P0/P1/P2/P3. Do not modify any files and do not search for a markdown report of the previous findings.';

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
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const convId = state.convId;
  const step1MsgId = state.step1?.resultMessageId;
  console.log('CONV_ID:', convId, '| step1 result messageId:', step1MsgId);

  const stream = await sse('POST', `/api/jarvis/conversations/${convId}/message/stream`, { prompt: PROMPT, workspacePath: 'B:/AgenticOS' });
  console.log('=== STEP2 stream (intent/done) ===');
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === 'intent') console.log('  INTENT:', JSON.stringify({ route: ev.route, worker: ev.worker, intentType: ev.intentType }));
      else if (ev.type === 'done') console.log('  DONE:', JSON.stringify({ status: ev.status, goalId: ev.goalId, taskId: ev.taskId, category: ev.category }));
    } catch {}
  }

  let verSys = null;
  let verResult = null;
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(8000);
    const msgs = await req('GET', `/api/jarvis/conversations/${convId}/messages`);
    const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
    verSys = arr.find((m) => m.metadata?.category === 'repository_verification');
    verResult = arr.find((m) => m.role === 'agent' && (m.metadata?.workerResult === true || m.metadata?.groundedEvidence === true) && m.id !== step1MsgId);
    if (verSys && verResult) break;
    if (verSys && !verResult) console.log('  (verification goal created, waiting for CodeX result...)');
  }

  console.log('\n=== STEP2 RESULT ===');
  if (verSys) {
    console.log('  verification system msg id:', verSys.id);
    console.log('  verification goalId:', verSys.goalId);
    console.log('  metadata:', JSON.stringify({ category: verSys.metadata?.category, referencedGoalId: verSys.metadata?.referencedGoalId, referencedMessageId: verSys.metadata?.referencedMessageId, findingsCount: verSys.metadata?.findingsCount, verificationTarget: verSys.metadata?.verificationTarget }));
  } else console.log('  NO repository_verification message found');

  if (verResult) {
    console.log('  verification result messageId:', verResult.id);
    console.log('  result preview:\n' + String(verResult.content).slice(0, 2000));
  } else console.log('  NO verification result message found');

  state.step2 = {
    verificationSystemMsgId: verSys?.id || null,
    verificationGoalId: verSys?.goalId || null,
    referencedGoalId: verSys?.metadata?.referencedGoalId || null,
    findingsCount: verSys?.metadata?.findingsCount ?? null,
    verificationResultMessageId: verResult?.id || null,
  };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log('\nSTATE WRITTEN:', JSON.stringify(state.step2, null, 2));

  if (!verSys || !verResult) process.exitCode = 2;
})();

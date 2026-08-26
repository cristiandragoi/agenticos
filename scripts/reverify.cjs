// reverify.cjs — re-run Step 2 (verification) against the EXISTING conversation
// that already has the Step-1 grounded result. Excludes the first verification's
// messages so we capture the NEW verification goal + result (findingsCount must
// now be 5).
const http = require('http');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4000';
const STATE = 'B:/AgenticOS/scripts/.acceptance-state.json';
const OUT = 'B:/AgenticOS/scripts/.reverify-state.json';
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
const msgsArr = (msgs) => (Array.isArray(msgs) ? msgs : (msgs.messages || []));

(async () => {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const convId = state.convId;
  console.log('CONV_ID:', convId);

  // Snapshot existing verification-related message ids so we only match NEW ones.
  const before = msgsArr(await req('GET', `/api/jarvis/conversations/${convId}/messages`));
  const existingVerSys = new Set(before.filter((m) => m.metadata?.category === 'repository_verification').map((m) => m.id));
  const existingWorkerResult = new Set(before.filter((m) => m.role === 'agent' && (m.metadata?.workerResult === true || m.metadata?.groundedEvidence === true)).map((m) => m.id));
  console.log('existing verification msgs:', [...existingVerSys].join(', ') || '(none)');
  console.log('existing worker-result msgs:', [...existingWorkerResult].join(', ') || '(none)');

  const stream = await sse('POST', `/api/jarvis/conversations/${convId}/message/stream`, { prompt: PROMPT, workspacePath: 'B:/AgenticOS' });
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === 'intent') console.log('  INTENT:', JSON.stringify({ route: ev.route, worker: ev.worker }));
      else if (ev.type === 'done') console.log('  DONE:', JSON.stringify({ status: ev.status, goalId: ev.goalId }));
    } catch {}
  }

  let newVerSys = null;
  let newVerResult = null;
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(8000);
    const now = msgsArr(await req('GET', `/api/jarvis/conversations/${convId}/messages`));
    const vss = now.filter((m) => m.metadata?.category === 'repository_verification' && !existingVerSys.has(m.id));
    newVerSys = vss.length ? vss[vss.length - 1] : null;
    const wrs = now.filter((m) => m.role === 'agent' && (m.metadata?.workerResult === true || m.metadata?.groundedEvidence === true) && !existingWorkerResult.has(m.id));
    newVerResult = wrs.length ? wrs[wrs.length - 1] : null;
    if (newVerSys && newVerResult) break;
    if (newVerSys) console.log('  (new verification goal seen, waiting for CodeX result...)');
  }

  console.log('\n=== NEW VERIFICATION ===');
  if (newVerSys) {
    console.log('  system msg id:', newVerSys.id);
    console.log('  goal id:', newVerSys.goalId);
    console.log('  metadata:', JSON.stringify({ category: newVerSys.metadata?.category, referencedGoalId: newVerSys.metadata?.referencedGoalId, findingsCount: newVerSys.metadata?.findingsCount, verificationTarget: newVerSys.metadata?.verificationTarget }));
  } else console.log('  NO new repository_verification message');
  if (newVerResult) {
    console.log('  result msg id:', newVerResult.id);
    console.log('  result preview:\n' + String(newVerResult.content).slice(0, 2500));
  } else console.log('  NO new verification result message');

  fs.writeFileSync(OUT, JSON.stringify({
    convId,
    verificationSystemMsgId: newVerSys?.id || null,
    verificationGoalId: newVerSys?.goalId || null,
    referencedGoalId: newVerSys?.metadata?.referencedGoalId || null,
    findingsCount: newVerSys?.metadata?.findingsCount ?? null,
    verificationResultMessageId: newVerResult?.id || null,
  }, null, 2));
  console.log('\nREVERIFY STATE WRITTEN');
  if (!newVerSys || !newVerResult) process.exitCode = 2;
})();

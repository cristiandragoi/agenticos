// final-accept-hermes.cjs — submit a Hermes→CodeX engineering task via the LIVE Jarvis UI (CDP),
// then track the resulting background task/goal through the API.
const http = require('http');
const fs = require('fs');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = process.argv[2] ||
  "Hermes, please plan this engineering task and delegate the implementation to CodeX: add a regression test to src/__tests__/voiceSessionPersistence.test.tsx asserting that resolveVoiceSessionConfig('agent-jarvis', null) returns locale 'en-AU'. CodeX must read src/lib/voiceSessionConfig.ts, add the test, run only that test file with npx vitest, and report the actual pass/fail result. Do not modify production source or unrelated tests.";

(async () => {
  const API = 'http://127.0.0.1:4000';

  // snapshot existing tasks before submission
  const before = await getJSON(`${API}/api/background-tasks?limit=50`);
  const beforeIds = new Set(before.map((t) => t.taskId));

  // CDP submit via live UI
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const page = targets.find((t) => t.type === 'page');
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } });
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  };

  // ensure on #/jarvis
  const route = await evalJs('location.hash');
  if (route !== '#/jarvis') {
    await evalJs(`(function(){ const el = document.querySelector('a[href="#/jarvis"], [data-testid="nav-jarvis"]'); if(el) el.click(); return !!el; })()`);
    await sleep(2000);
  }

  // type into composer + press Enter (real UI path)
  const submitResult = await evalJs(`(function(){
    const ta = document.querySelector('[data-testid="jarvis-composer"] textarea') || document.querySelector('textarea');
    if (!ta) return 'NO_TEXTAREA';
    const proto = ta.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(ta, ${JSON.stringify(PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return 'SUBMITTED:' + ta.value.length;
  })()`);
  console.log('SUBMIT:', submitResult);
  ws.close();

  // Poll for a new task
  let task = null;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const list = await getJSON(`${API}/api/background-tasks?limit=50`);
    const fresh = list.find((t) => !beforeIds.has(t.taskId) && t.route !== 'schedule');
    if (fresh) { task = fresh; break; }
  }
  if (!task) { console.log('NO_NEW_TASK'); process.exit(2); }
  console.log('TASK:', task.taskId, '| worker:', task.worker, '| selectedAgent:', task.selectedAgent, '| status:', task.status);

  // track to terminal
  let finalTask = task;
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    finalTask = await getJSON(`${API}/api/background-tasks/${task.taskId}`);
    const st = finalTask.status;
    if (['completed', 'failed', 'blocked', 'cancelled'].includes(st)) break;
    if (i % 6 === 0) console.log('  ...status:', st, '(progress:', finalTask.progressMessage, ')');
  }
  console.log('\nFINAL STATUS:', finalTask.status);
  console.log('route:', finalTask.route, '| worker:', finalTask.worker, '| selectedAgent:', finalTask.selectedAgent);
  console.log('linkedRunId:', finalTask.linkedRunId);
  console.log('verificationState:', finalTask.verificationState, '| testState:', finalTask.testState);
  console.log('filesChanged:', JSON.stringify(finalTask.filesChanged || []));
  console.log('metadata:', JSON.stringify(finalTask.metadata || {}).slice(0, 800));
  console.log('RESULT TEXT (first 1200):');
  console.log((finalTask.resultText || '(empty)').slice(0, 1200));

  fs.writeFileSync('B:/AgenticOS/docs/overnight-repair/final-hermes-task.json', JSON.stringify(finalTask, null, 2));
  console.log('\nWROTE: docs/overnight-repair/final-hermes-task.json');
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });

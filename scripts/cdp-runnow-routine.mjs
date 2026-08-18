// L5 — run-now via the UI (Play button), verify canonical occurrence + full IDs.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
async function evalJS(expr) {
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  ws.close();
  return r.result?.value;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const rid = 'routine-cf29a3ee-cfe4-4d7b-993d-c57117e70817';
const before = db.prepare('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id = ?').get(rid).c;
console.log('RUNS_BEFORE=' + before);

const clickPlay = `(() => {
  const cards = Array.from(document.querySelectorAll('div')).filter(d => d.textContent.includes('GUI Smoke Routine L2') && d.children.length < 30);
  for (const c of cards) {
    const b = Array.from(c.querySelectorAll('button')).find(x => (x.title||'') === 'Run now');
    if (b) { b.click(); return 'clicked run-now'; }
  }
  return 'PLAY-NOT-FOUND';
})()`;
console.log('run-now: ' + await evalJS(clickPlay));

// poll for the new occurrence
let se = null;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  se = db.prepare('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1').get(rid);
  if (se && ['completed', 'execution_failed', 'cancelled', 'dispatch_failed'].includes(se.outcome)) break;
}
console.log('SCHEDULE_EXECUTION_ID=' + se.id);
console.log('TRIGGER_TYPE=' + se.trigger_type);
console.log('OUTCOME=' + se.outcome);
console.log('BACKGROUND_TASK_ID=' + se.background_task_id);
console.log('PROJECT_TASK_ID=' + se.project_task_id);
console.log('RUN_ID=' + se.run_id);
console.log('RESULT_ID=' + se.result_id);
console.log('VERIFICATION_ID=' + (se.verification_id ?? 'null'));
const after = db.prepare('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id = ?').get(rid).c;
console.log('RUNS_AFTER=' + after);
console.log('EXACTLY_ONE_NEW=' + (after === before + 1));
const ver = se.run_id ? db.prepare('SELECT id, verdict FROM verifications WHERE target_run_id = ?').all(se.run_id) : [];
console.log('VERDICTS=' + JSON.stringify(ver.map(v => v.verdict)));

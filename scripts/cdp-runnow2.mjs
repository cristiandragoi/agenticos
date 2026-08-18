// L5 retry — precisely click the "GUI Smoke Routine L2" card's Run now button,
// then observe the panel error text + DB for the occurrence.
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

// Precisely click the Run-now button whose card contains the routine name.
const click = await evalJS(`(() => {
  const btn = Array.from(document.querySelectorAll('button[title="Run now"]')).find(b => (b.parentElement?.parentElement?.textContent || '').includes('GUI Smoke Routine L2'));
  if (!btn) return 'NOT-FOUND';
  btn.click();
  return 'clicked';
})()`);
console.log('CLICK=' + click);
await sleep(3000);
// read the panel error text (setError renders a div with color-error)
const err = await evalJS(`(() => { const els = Array.from(document.querySelectorAll('div')).filter(d => d.style && d.style.color === 'var(--color-error)' && d.textContent.trim()); return els.map(e => e.textContent.trim()).join(' || '); })()`);
console.log('PANEL_ERROR=' + (err || '(none)'));
const se = db.prepare('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1').get(rid);
console.log('LATEST_EXEC=' + JSON.stringify(se));

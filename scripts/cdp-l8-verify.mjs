// L8 verify — history still visible after restart (click History on GUI Smoke Routine L2).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
const click = await evalJS(`(() => { const b = Array.from(document.querySelectorAll('button[title="History"]')).find(x => (x.parentElement?.parentElement?.textContent||'').includes('GUI Smoke Routine L2')); if(!b) return 'NOT-FOUND'; b.click(); return 'clicked'; })()`);
console.log('HISTORY_CLICK=' + click);
await sleep(2000);
const text = await evalJS(`(()=>{const t=document.body.innerText; const i=t.indexOf('GUI Smoke Routine L2'); return t.slice(i, i+180);})()`);
console.log('HISTORY_AFTER_RESTART=' + text);

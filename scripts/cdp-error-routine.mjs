// L7 — error truth: the "Failure Truth Smoke Test I" magnitude routine has a known
// failure. Click its History and verify the failure/error is rendered truthfully.
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

const clickHistory = await evalJS(`(() => {
  const btn = Array.from(document.querySelectorAll('button[title="History"]')).find(b => (b.parentElement?.parentElement?.textContent || '').includes('Failure Truth Smoke Test I'));
  if (!btn) return 'NOT-FOUND';
  btn.click();
  return 'clicked';
})()`);
console.log('HISTORY_CLICK=' + clickHistory);
await sleep(2000);
const text = await evalJS(`(()=>{const t=document.body.innerText; const i=t.indexOf('Failure Truth Smoke Test I'); return t.slice(i, i+300);})()`);
console.log('FAILURE_HISTORY=' + text);

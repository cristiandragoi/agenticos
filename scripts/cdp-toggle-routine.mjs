// L3/L4 — toggle the GUI Smoke Routine L2 via its Power button, check backend state.
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
const API = 'http://127.0.0.1:4000/api';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Find the card for "GUI Smoke Routine L2" and click its Power (disable) button.
const findPower = `(() => {
  const cards = Array.from(document.querySelectorAll('div')).filter(d => d.textContent.includes('GUI Smoke Routine L2') && d.children.length < 30);
  // The Power button has title "Disable" or "Enable"
  let btn = null;
  for (const c of cards) {
    const b = Array.from(c.querySelectorAll('button')).find(x => (x.title||'') === 'Disable' || (x.title||'') === 'Enable');
    if (b) { btn = b; break; }
  }
  if (!btn) return 'POWER-NOT-FOUND';
  const title = btn.title;
  btn.click();
  return 'clicked ' + title;
})()`;
console.log('disable-click: ' + await evalJS(findPower));
await sleep(1500);
const afterDisable = await (await fetch(API + '/routines')).json();
const r1 = afterDisable.find(r => r.name === 'GUI Smoke Routine L2');
console.log('BACKEND_ENABLED_AFTER_DISABLE=' + r1?.enabled);

// re-enable
console.log('enable-click: ' + await evalJS(findPower));
await sleep(1500);
const afterEnable = await (await fetch(API + '/routines')).json();
const r2 = afterEnable.find(r => r.name === 'GUI Smoke Routine L2');
console.log('BACKEND_ENABLED_AFTER_ENABLE=' + r2?.enabled);

// scheduler registration count check (no duplicate)
const scheds = await (await fetch(API + '/schedules')).json();
console.log('SCHEDULES_COUNT=' + scheds.length);

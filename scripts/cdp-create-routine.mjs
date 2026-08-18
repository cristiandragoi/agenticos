// Drive the RoutinesPanel create form via CDP: set name + objective, submit.
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

// Native setter to trigger React onChange
const setVal = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'MISSING ' + ${JSON.stringify(sel)};
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'SET ' + ${JSON.stringify(val)};
})()`;

const name = 'GUI Smoke Routine L2';
const objective = 'Report that the packaged UI created this routine successfully.';
console.log(await evalJS(setVal('input[placeholder="Name"]', name)));
console.log(await evalJS(setVal('textarea[placeholder^="Objective"]', objective)));
console.log('after-set: ' + JSON.stringify(await evalJS(`JSON.stringify({name: document.querySelector('input[placeholder="Name"]').value, obj: document.querySelector('textarea[placeholder^="Objective"]').value})`)));
// click Create routine
console.log('click-create: ' + await evalJS(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Create routine')); if (!b) return 'MISSING'; b.click(); return 'clicked'; })()`));

// Phase 16 decisive test — drive the LIVE packaged Jarvis UI to submit a real engineering task.
// Usage: node scripts/p16-submit.mjs "<prompt>"
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompt = process.argv[2];
if (!prompt) { console.error('usage: node p16-submit.mjs "<prompt>"'); process.exit(1); }

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('NO_PAGE_TARGET'); process.exit(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  // 1. Locate the composer textarea and set its value (React controlled input).
  const setExpr = `(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => (t.placeholder||'').includes('Ask Jarvis') || t.className.includes('composerInput'));
    if (!ta) return { ok:false, err:'no textarea' };
    ta.focus();
    const proto = ta.constructor.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok:true, valueSet: ta.value.length, cls: ta.className.toString().slice(0,60) };
  })()`;
  const setRes = await send('Runtime.evaluate', { expression: setExpr, returnByValue: true });
  const setVal = setRes.result?.value;
  console.log('SET:', JSON.stringify(setVal));
  if (!setVal?.ok) { ws.close(); process.exit(3); }

  // 2. Click Send.
  const clickExpr = `(() => {
    const btn = [...document.querySelectorAll('button, [role=button]')].find(b => (b.innerText||'').trim() === 'Send');
    if (!btn) return { ok:false, err:'no send button' };
    btn.click();
    return { ok:true, clicked: (btn.innerText||'').trim() };
  })()`;
  const clickRes = await send('Runtime.evaluate', { expression: clickExpr, returnByValue: true });
  console.log('CLICK:', JSON.stringify(clickRes.result?.value));

  // 3. Brief settle, then capture state.
  await new Promise(r => setTimeout(r, 2500));
  const stateExpr = `(() => {
    const body = document.body.innerText;
    const processing = /thinking|planning|delegating|executing|reviewing|streaming/i.test(body);
    const hasUserMsg = body.includes(${JSON.stringify(prompt.slice(0, 60))});
    const last = body.slice(-500);
    return { hash: location.hash, processing, hasUserMsg, lastSnippet: last };
  })()`;
  const st = await send('Runtime.evaluate', { expression: stateExpr, returnByValue: true });
  console.log('STATE:', JSON.stringify(st.result?.value));
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });

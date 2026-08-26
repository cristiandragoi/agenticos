// Phase 9 + Phase 16 pre-check: inspect live packaged Jarvis renderer via CDP 9223.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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

  const expr = `(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    let webgl2 = null, webgl1 = null;
    try { const c = document.createElement('canvas'); webgl2 = !!(c.getContext('webgl2')); webgl1 = !!(c.getContext('webgl')); } catch(e){}
    // Look for the Jarvis orb/blob and its nodes
    const orbSelectors = ['[data-testid*="orb" i]','[data-testid*="blob" i]','[class*="orb" i]','[class*="blob" i]','[data-testid*="jarvis" i]','canvas'];
    const orbHits = {};
    for (const s of orbSelectors) { try { const els = qa(s); if (els.length) orbHits[s] = els.length; } catch(e){} }
    // seven nodes: look for node-like elements
    const nodeSelectors = ['[data-testid*="node" i]','[class*="node" i]','[data-testid*="project" i]','[data-testid*="capabilit" i]'];
    const nodeHits = {};
    for (const s of nodeSelectors) { try { const els = qa(s); if (els.length) nodeHits[s] = els.length; } catch(e){} }
    // nav
    const navLinks = qa('a[href], [data-testid*="nav" i]').map(a => ({ t: a.getAttribute('data-testid') || '', href: a.getAttribute('href') || '', txt: (a.innerText||'').trim().slice(0,20) })).slice(0, 20);
    // input
    const inputs = qa('textarea, input[type=text], [contenteditable=true], [data-testid*="input" i], [data-testid*="prompt" i]').map(e => ({ tag: e.tagName, testid: e.getAttribute('data-testid')||'', cls: (e.className||'').toString().slice(0,40), ph: e.getAttribute('placeholder')||'' })).slice(0,10);
    // buttons
    const buttons = qa('button, [role=button], [data-testid*="send" i], [data-testid*="submit" i]').map(b => ({ t: b.getAttribute('data-testid')||'', txt: (b.innerText||'').trim().slice(0,20) })).filter(b => b.t || b.txt).slice(0,20);
    return {
      title: document.title,
      hash: location.hash,
      url: location.href,
      webgl1, webgl2,
      orbHits, nodeHits,
      navLinks, inputs, buttons,
      bodyText: document.body.innerText.slice(0, 400),
      canvasCount: qa('canvas').length
    };
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });

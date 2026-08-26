// cdp-check-renderer.cjs — check renderer health + look for WebGL error overlay.
const http = require('http');
const WebSocket = require('B:/AgenticOS/server/node_modules/ws');

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9223/json/list', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.log('NO PAGE TARGET'); process.exit(1); }
  console.log('page url:', page.url, '| title:', page.title);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 1; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  const evalRes = await send('Runtime.evaluate', { expression: `({ title: document.title, hash: location.hash, bodySnippet: document.body.innerText.slice(0, 300) })`, returnByValue: true });
  const val = evalRes?.result?.result?.value;
  console.log('\n=== RENDERER STATE ===');
  console.log(JSON.stringify(val, null, 2));
  const text = JSON.stringify(val || '').toLowerCase();
  const webglError = /webgl|error|failed|crash|exception/i.test(text);
  console.log('\nWebGL/error indicator in text:', webglError ? 'POSSIBLE (check manually)' : 'none obvious');
  ws.close();
  process.exit(0);
})().catch(e => { console.error('cdp error:', e.message); process.exit(1); });

const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve('B:/AgenticOS/server/node_modules/ws'));

const DEBUG_PORT = '9223';

function fetchTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await fetchTargets();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No page target found on CDP ' + DEBUG_PORT);
  console.log('Page target:', page.id, page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  let id = 1;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise((resolve) => {
    const mid = id++;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  // Graceful close: window.close() triggers window-all-closed -> app.quit -> before-quit -> backend SIGTERM shutdown
  const r = await send('Runtime.evaluate', { expression: 'window.close(); "close_requested"', returnByValue: true });
  console.log('window.close() result:', JSON.stringify(r.result && r.result.result));
  ws.close();
  console.log('Close requested. Electron will run graceful before-quit shutdown.');
})().catch(e => { console.error('close error:', e.message); process.exit(1); });

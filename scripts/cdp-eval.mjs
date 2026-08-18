// CDP eval helper for the packaged AgenticOS renderer (port 9223).
// Usage: node scripts/cdp-eval.mjs "<js expression>"
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const expr = process.argv[2];
if (!expr) { console.error('usage: node cdp-eval.mjs <expr>'); process.exit(1); }

// Minimal CDP client over raw WebSocket (no ws dep needed via global WebSocket in node 22+)
async function main() {
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  if (!page) { console.error('no page target'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
  ws.close();
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });

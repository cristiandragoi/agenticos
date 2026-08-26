// cdp-close.cjs — graceful quit via CDP window.close()
const http = require('http');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const targets = await getJSON('http://127.0.0.1:9223/json/list');
    const page = targets.find((t) => t.type === 'page');
    if (!page) { console.log('NO_PAGE_TARGET'); process.exit(2); }
    console.log('PAGE:', page.url, '| id:', page.id);

    const WebSocket = require('ws');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const send = (method, params) =>
      new Promise((resolve) => {
        const mid = ++id;
        const onMsg = (m) => {
          const msg = JSON.parse(m);
          if (msg.id === mid) { ws.off('message', onMsg); resolve(msg.result); }
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

    await new Promise((r) => ws.on('open', r));
    await send('Runtime.enable');
    const r = await send('Runtime.evaluate', {
      expression: 'window.close(); "close-requested"',
      returnByValue: true,
    });
    console.log('EVAL:', JSON.stringify(r.result));
    ws.close();
    process.exit(0);
  } catch (e) {
    console.log('ERR:', e.message);
    process.exit(1);
  }
})();

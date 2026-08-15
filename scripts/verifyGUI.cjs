const WebSocket = require('ws');

async function test() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;
  const send = (method, params = {}) => new Promise(resolve => {
    const msgId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) {
        ws.off('message', handler);
        resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  const resEval = await send('Runtime.evaluate', {
    expression: `({ title: document.title, visibleText: document.body.innerText.slice(0, 180), hasRoot: !!document.getElementById('root') })`,
    returnByValue: true
  });

  console.log('GUI INTERACTION STATE:', resEval.result.value);
  ws.close();
}

test().catch(console.error);

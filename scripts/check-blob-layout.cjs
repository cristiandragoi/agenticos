const WebSocket = require('ws');

async function checkLayout() {
  const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
  const agenticPage = targets.find(t => t.title === 'AgenticOS' && t.type === 'page');
  const ws = new WebSocket(agenticPage.webSocketDebuggerUrl);
  await new Promise(res => ws.on('open', res));

  let id = 1;
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const curId = id++;
      const handler = (data) => {
        const msg = JSON.parse(data);
        if (msg.id === curId) {
          ws.off('message', handler);
          resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  const res = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.querySelector('[data-testid="jarvis-orb-canvas"]');
      const shell = document.querySelector('.jarvis-blob1-shell');
      const core = document.querySelector('[data-testid="jarvis-orb-core"]');
      const wrap = document.querySelector('[data-testid="jarvis-dashboard"]');
      const region = document.querySelector('[data-testid="jarvis-orb-region"]');
      return {
        canvas: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight, cw: canvas.width, ch: canvas.height } : null,
        shell: shell ? { w: shell.clientWidth, h: shell.clientHeight, overflow: getComputedStyle(shell).overflow, mask: getComputedStyle(shell).maskImage } : null,
        core: core ? { w: core.clientWidth, h: core.clientHeight, overflow: getComputedStyle(core).overflow } : null,
        wrap: wrap ? { w: wrap.clientWidth, h: wrap.clientHeight, maxWidth: getComputedStyle(wrap).maxWidth, overflow: getComputedStyle(wrap).overflow } : null,
        region: region ? { w: region.clientWidth, h: region.clientHeight } : null,
      };
    })()`,
    returnByValue: true,
  });
  console.log(JSON.stringify(res.result.value, null, 2));
  ws.close();
}

checkLayout().catch(console.error);

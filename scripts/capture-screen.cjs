const WebSocket = require('ws');
const fs = require('fs');

async function capture() {
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

  // Navigate to #/jarvis
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/#/jarvis' });
  await new Promise(r => setTimeout(r, 2000));
  await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("resize"))' });
  await new Promise(r => setTimeout(r, 1200));

  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(screenshot.data, 'base64');
  const outPath = 'C:/Users/cd-pr/.gemini/antigravity-ide/brain/25c71fff-084d-438c-ab3a-799371af14ca/.tempmediaStorage/jarvis_studio_fluid_live.png';
  fs.writeFileSync(outPath, buf);
  console.log('Screenshot saved to', outPath);
  ws.close();
}

capture().catch(console.error);

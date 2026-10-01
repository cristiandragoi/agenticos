const WebSocket = require('ws');
const fs = require('fs');

async function testVoiceReactivity() {
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

  // Dispatch an audio input level event to test real-time pulsation
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new CustomEvent('jarvis:input-level', { detail: { level: 0.85 } }));
      window.dispatchEvent(new CustomEvent('jarvis-orb:input-level', { detail: { level: 0.85 } }));
    })()`,
  });

  await new Promise(r => setTimeout(r, 600));

  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(screenshot.data, 'base64');
  const outPath = 'C:/Users/cd-pr/.gemini/antigravity-ide/brain/25c71fff-084d-438c-ab3a-799371af14ca/.tempmediaStorage/jarvis_speaking_pulsating_live.png';
  fs.writeFileSync(outPath, buf);
  console.log('Voice reactive screenshot saved to', outPath);
  ws.close();
}

testVoiceReactivity().catch(console.error);

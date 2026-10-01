const WebSocket = require('ws');

async function testJarvisResponse() {
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

  // Send a message through the composer input
  const start = Date.now();
  await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('textarea, input[placeholder*=\"Ask Jarvis\"]');
      if (!input) return 'no input found';
      input.value = 'Jarvis, please report your operational status and memory.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.querySelector('button[data-testid=\"composer-send\"], button:has(svg), button.send');
      const allButtons = Array.from(document.querySelectorAll('button'));
      const sendBtn = allButtons.find(b => b.textContent.includes('Send') || b.getAttribute('aria-label') === 'Send');
      if (sendBtn) {
        sendBtn.click();
        return 'clicked send button';
      }
      return 'send button not found';
    })()`,
  });

  console.log('Dispatched message. Waiting for response...');
  // Wait 2.5 seconds
  await new Promise(r => setTimeout(r, 2500));

  const res = await send('Runtime.evaluate', {
    expression: `(() => {
      const msgs = Array.from(document.querySelectorAll('[data-testid*=\"message\"], [class*=\"transcript\"], [class*=\"Message\"]'));
      return msgs.map(m => m.textContent?.trim()).filter(Boolean).slice(-4);
    })()`,
    returnByValue: true,
  });

  console.log('Time elapsed:', Date.now() - start, 'ms');
  console.log('Messages:', res.result.value);
  ws.close();
}

testJarvisResponse().catch(console.error);

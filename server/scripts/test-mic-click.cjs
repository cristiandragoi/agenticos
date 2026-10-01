const http = require('http');
const WebSocket = require('ws');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (msg) => {
        const data = JSON.parse(msg.toString());
        if (data.id && this.callbacks.has(data.id)) {
          const { resolve, reject } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      });
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result ? res.result.value : undefined;
  }
  close() { if (this.ws) this.ws.close(); }
}

async function main() {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const appTarget = targets.find(t => t.url.includes('5173'));
  const cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
  await cdp.connect();

  const clickRes = await cdp.evaluate(`(() => {
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    if (!micBtn) return { error: 'no mic button' };
    micBtn.click();
    return {
      clicked: true,
      micState: micBtn.getAttribute('data-mic-state')
    };
  })()`);

  console.log('Mic click result:', clickRes);
  await new Promise(r => setTimeout(r, 1500));

  const afterClick = await cdp.evaluate(`(() => {
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    const micStatus = document.querySelector('[data-testid="jarvis-mic-status"]')?.innerText;
    const micError = document.querySelector('[data-testid="jarvis-mic-error"]')?.innerText;
    return {
      micState: micBtn?.getAttribute('data-mic-state'),
      micStatus,
      micError
    };
  })()`);

  console.log('After click state:', afterClick);
  cdp.close();
}

main().catch(console.error);

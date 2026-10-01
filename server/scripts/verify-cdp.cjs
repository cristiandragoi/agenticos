const http = require('http');
const WebSocket = require('ws');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
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
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async captureScreenshot() {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(res.data, 'base64');
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  console.log('Found targets:', targets.map(t => ({ title: t.title, url: t.url })));
  const appTarget = targets.find(t => t.url.includes('5173') || t.title.includes('AgenticOS'));
  if (!appTarget) {
    console.error('No app target found!');
    process.exit(1);
  }
  console.log('Connecting to:', appTarget.webSocketDebuggerUrl);
  const cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
  await cdp.connect();

  const state = await cdp.evaluate(`(() => {
    return {
      hash: window.location.hash,
      pathname: window.location.pathname,
      title: document.title,
      hasPersistentDock: !!document.querySelector('[data-testid="persistent-jarvis-dock"]') || !!document.querySelector('.fixed.bottom-6.right-6'),
      bodyText: document.body.innerText.substring(0, 300)
    };
  })()`);

  console.log('Initial app state:', state);
  cdp.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

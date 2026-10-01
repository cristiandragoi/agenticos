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

  const domInfo = await cdp.evaluate(`(() => {
    const dock = document.querySelector('[data-testid="persistent-jarvis-dock"]');
    const composer = document.querySelector('[data-testid="jarvis-composer"]');
    const textarea = composer ? composer.querySelector('textarea') : null;
    const sendBtn = composer ? composer.querySelector('button[aria-label="Send Message"]') : null;
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map(el => ({
      tag: el.tagName,
      placeholder: el.placeholder,
      value: el.value,
      testId: el.getAttribute('data-testid'),
      className: el.className
    }));
    return {
      hasDock: !!dock,
      hasComposer: !!composer,
      hasTextarea: !!textarea,
      hasSendBtn: !!sendBtn,
      sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
      inputs
    };
  })()`);

  console.log('DOM Info:', JSON.stringify(domInfo, null, 2));
  cdp.close();
}

main().catch(console.error);

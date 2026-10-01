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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const appTarget = targets.find(t => t.url.includes('5173'));
  const cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
  await cdp.connect();

  console.log('Testing send message via React textarea setter...');
  const sendRes = await cdp.evaluate(`(() => {
    const composer = document.querySelector('[data-testid="jarvis-composer"]');
    if (!composer) return { error: 'no composer' };
    const textarea = composer.querySelector('textarea');
    if (!textarea) return { error: 'no textarea' };

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(textarea, "Open Revenue Operator");
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    const sendBtn = composer.querySelector('button[aria-label="Send Message"]');
    const canClick = sendBtn && !sendBtn.disabled;
    if (canClick) {
      sendBtn.click();
      return { clicked: true };
    } else {
      return { clicked: false, btnDisabled: sendBtn?.disabled };
    }
  })()`);

  console.log('Send res:', sendRes);
  await sleep(3500);

  const state = await cdp.evaluate(`(() => {
    const messages = Array.from(document.querySelectorAll('[class*="chat"] .text-sm, .flex-col .text-sm'))
      .map(el => el.innerText.trim())
      .filter(Boolean);
    return {
      hash: window.location.hash,
      messages: messages.slice(-5)
    };
  })()`);

  console.log('After send state:', state);
  cdp.close();
}

main().catch(console.error);

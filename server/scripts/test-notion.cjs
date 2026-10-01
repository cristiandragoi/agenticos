const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

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
  async captureScreenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
  }
  close() { if (this.ws) this.ws.close(); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const appTarget = targets.find(t => t.url.includes('5173'));
  const cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
  await cdp.connect();

  console.log('Testing "Open the Notion and Agentic workflow template"...');
  const sendRes = await cdp.evaluate(`(() => {
    const composer = document.querySelector('[data-testid="jarvis-composer"]');
    const textarea = composer ? composer.querySelector('textarea') : null;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(textarea, "Open the Notion and Agentic workflow template");
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    const sendBtn = composer.querySelector('button[aria-label="Send Message"]');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return { clicked: true };
    }
    return { clicked: false };
  })()`);

  console.log('Send res:', sendRes);
  await sleep(4000);

  const state = await cdp.evaluate(`(() => {
    const chatContainer = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    const chatText = chatContainer ? chatContainer.innerText : '';
    const modal = document.querySelector('.fixed.inset-0.z-50') || document.querySelector('[data-testid="opportunity-modal"]');
    const modalText = modal ? modal.innerText.substring(0, 300) : null;
    return {
      hash: window.location.hash,
      url: window.location.href,
      hasModal: !!modal,
      modalText,
      chatExcerpt: chatText.split('\\n').filter(Boolean).slice(-6)
    };
  })()`);

  console.log('After send state:', JSON.stringify(state, null, 2));

  await cdp.captureScreenshot('D:/AgenticOS/server/scripts/notion-modal-cdp.png');
  console.log('Screenshot saved to D:/AgenticOS/server/scripts/notion-modal-cdp.png');
  cdp.close();
}

main().catch(console.error);

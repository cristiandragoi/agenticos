const http = require('http');
const WebSocket = require('ws');
const { execSync } = require('child_process');

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

  console.log('1. Starting mic listening...');
  await cdp.evaluate(`(() => {
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    if (micBtn && micBtn.getAttribute('data-mic-state') === 'idle') {
      micBtn.click();
    }
  })()`);

  await sleep(1000);
  const state1 = await cdp.evaluate(`document.querySelector('[data-testid="jarvis-mic-button"]')?.getAttribute('data-mic-state')`);
  console.log('Mic state after start:', state1);

  console.log('2. Playing speech audio into system speakers...');
  // Play the mp3 using windows powershell
  try {
    execSync(`powershell -Command "Add-Type -AssemblyName presentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open([System.Uri]'file:///D:/AgenticOS/server/scripts/real_command.mp3'); $player.Play(); Start-Sleep -Seconds 4; $player.Stop()"`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('Playback error:', err.message);
  }

  console.log('3. Stopping mic listening...');
  await cdp.evaluate(`(() => {
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    if (micBtn && micBtn.getAttribute('data-mic-state') === 'listening') {
      micBtn.click();
    }
  })()`);

  console.log('4. Waiting for transcription...');
  await sleep(4000);

  const finalState = await cdp.evaluate(`(() => {
    const composer = document.querySelector('[data-testid="jarvis-composer"]');
    const textarea = composer ? composer.querySelector('textarea') : null;
    const micStatus = document.querySelector('[data-testid="jarvis-mic-status"]')?.innerText;
    const micError = document.querySelector('[data-testid="jarvis-mic-error"]')?.innerText;
    const micNotice = document.querySelector('[data-testid="jarvis-mic-notice"]')?.innerText;
    return {
      composerValue: textarea?.value,
      micStatus,
      micError,
      micNotice
    };
  })()`);

  console.log('Transcription result:', finalState);
  cdp.close();
}

main().catch(console.error);

const http = require('http');
const WebSocket = require('ws');
const fsys = require('fs');

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
    fsys.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
  }
  close() { if (this.ws) this.ws.close(); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const appTarget = targets.find(t => t.url.includes('5173'));
  const cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
  await cdp.connect();

  console.log('Clearing composer textarea and modal...');
  await cdp.evaluate(`(() => {
    // Clear textarea
    const composer = document.querySelector('[data-testid="jarvis-composer"]');
    const textarea = composer ? composer.querySelector('textarea') : null;
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      nativeSetter.call(textarea, "");
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Close modal if open
    const modal = document.querySelector('.fixed.inset-0.z-50') || document.querySelector('[data-testid="opportunity-modal"]');
    if (modal) {
      const btn = modal.querySelector('button');
      if (btn) btn.click();
    }
    // Ensure in revenue-operator
    window.location.hash = '#/revenue-operator';
  })()`);

  await sleep(1000);

  const audioBuffer = fsys.readFileSync('D:/AgenticOS/server/scripts/real_command.mp3');
  const base64Audio = audioBuffer.toString('base64');

  console.log('Hooking getUserMedia with real_command.mp3 audio...');
  await cdp.evaluate(`(() => {
    window._testOriginalGUM = window._testOriginalGUM || navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      console.log('[VoiceHook] getUserMedia called with constraints:', constraints);
      if (constraints && (constraints.audio || constraints === true)) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const byteCharacters = atob(${JSON.stringify(base64Audio)});
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const audioBuffer = await ctx.decodeAudioData(byteArray.buffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const dest = ctx.createMediaStreamDestination();
        source.connect(dest);
        source.start();
        console.log('[VoiceHook] MediaStream created, duration:', audioBuffer.duration, 'channels:', audioBuffer.numberOfChannels);
        return dest.stream;
      }
      return window._testOriginalGUM(constraints);
    };
  })()`);

  console.log('Clicking Jarvis mic button to start voice recording...');
  await cdp.evaluate(`(() => {
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    if (micBtn) micBtn.click();
  })()`);

  // Wait 5 seconds for the entire audio to play into the recorder
  console.log('Speaking command into voice stream...');
  await sleep(5000);

  console.log('Clicking Jarvis mic button to stop recording & trigger STT transcription...');
  await cdp.evaluate(`(() => {
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    if (micBtn && micBtn.getAttribute('data-mic-state') === 'listening') {
      micBtn.click();
    }
  })()`);

  console.log('Waiting for Whisper STT transcription to complete...');
  let transcript = '';
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const info = await cdp.evaluate(`(() => {
      const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
      const val = document.querySelector('[data-testid="jarvis-composer"] textarea')?.value || '';
      return {
        val,
        micState: micBtn?.getAttribute('data-mic-state'),
        status: document.querySelector('[data-testid="jarvis-mic-status"]')?.innerText,
        error: document.querySelector('[data-testid="jarvis-mic-error"]')?.innerText
      };
    })()`);
    console.log(`Poll ${i}: micState=${info.micState}, status=${info.status}, text="${info.val}"`);
    if (info.val && info.val.trim().length > 0) {
      transcript = info.val.trim();
      break;
    }
    if (info.micState === 'error') {
      console.error('Mic error:', info.error);
      break;
    }
  }

  console.log('\n--- VOICE CAPTURE RESULT ---');
  console.log('Whisper STT Transcribed Text:', transcript);

  // Send the transcribed voice command through the Jarvis runtime
  console.log('\nSending voice command to Jarvis runtime...');
  await cdp.evaluate(`(() => {
    const composer = document.querySelector('[data-testid="jarvis-composer"]');
    const sendBtn = composer ? composer.querySelector('button[aria-label="Send Message"]') : null;
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
  })()`);

  await sleep(4000);

  // Check UI state
  const runtimeState = await cdp.evaluate(`(() => {
    const modal = document.querySelector('.fixed.inset-0.z-50') || document.querySelector('[data-testid="opportunity-modal"]');
    const dock = document.querySelector('[data-testid="persistent-jarvis-dock"]');
    return {
      hash: window.location.hash,
      hasModal: !!modal,
      modalTitle: modal?.querySelector('h2, h3')?.innerText,
      modalTextSnippet: modal ? modal.innerText.substring(0, 200) : null,
      dockVisible: !!dock
    };
  })()`);

  console.log('\n--- POST-EXECUTION RUNTIME STATE ---');
  console.log(JSON.stringify(runtimeState, null, 2));

  // Check Inspector Activity tab
  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('Action Activity'));
    if (tabs[0]) tabs[0].click();
  })()`);
  await sleep(1000);

  const inspectorText = await cdp.evaluate(`document.querySelector('[data-testid="jarvis-action-inspector"]')?.innerText || ''`);
  console.log('\n--- JARVIS ACTION INSPECTOR ---');
  console.log(inspectorText.substring(0, 500));

  // Capture screenshot of the verified modal with persistent dock and inspector
  const screenshotPath = 'D:/AgenticOS/server/scripts/test-a-voice-verified.png';
  await cdp.captureScreenshot(screenshotPath);
  console.log('\nScreenshot saved to:', screenshotPath);

  // Restore original getUserMedia
  await cdp.evaluate(`(() => {
    if (window._testOriginalGUM) {
      navigator.mediaDevices.getUserMedia = window._testOriginalGUM;
      delete window._testOriginalGUM;
    }
  })()`);

  const pass = runtimeState.hasModal && 
               runtimeState.hash.includes('opportunity=opp-dfd16cad-') && 
               runtimeState.dockVisible &&
               transcript.toLowerCase().includes('notion');

  console.log('\nTEST A FINAL EVALUATION:', pass ? 'PASS' : 'FAIL');

  cdp.close();
}

main().catch(console.error);

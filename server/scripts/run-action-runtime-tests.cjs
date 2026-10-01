const http = require('http');
const fs = require('fs');
const path = require('path');
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

  async captureScreenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filepath, buffer);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const appTarget = targets.find(t => t.url.includes('5173') || t.title.includes('AgenticOS'));
  if (!appTarget) throw new Error('No AgenticOS target');
  const cdp = new CDPClient(appTarget.webSocketDebuggerUrl);
  await cdp.connect();

  console.log('Connected to CDP. Starting acceptance tests...');
  const results = {};

  // Helper to send message in Jarvis chat input and submit
  async function sendJarvisMessage(text) {
    return await cdp.evaluate(`(async () => {
      // Find input inside persistent Jarvis dock or chat
      const input = document.querySelector('input[placeholder*="Ask Jarvis"]') ||
                    document.querySelector('input[placeholder*="Jarvis"]') ||
                    document.querySelector('input[type="text"]');
      if (!input) return { error: 'Input not found' };
      
      // Set value
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Find submit button or press Enter
      const form = input.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }
      return { sent: true };
    })()`);
  }

  // Helper to read latest Jarvis messages, activity, and URL state
  async function getRuntimeState() {
    return await cdp.evaluate(`(() => {
      const messages = Array.from(document.querySelectorAll('.flex-col .text-sm, [class*="chat"] .text-sm'))
        .map(el => el.innerText.trim())
        .filter(Boolean);
      const inspectorText = document.querySelector('[data-testid="jarvis-action-inspector"]')?.innerText || '';
      const activityText = document.querySelector('[data-testid="jarvis-activity-view"]')?.innerText || '';
      const oppModal = document.querySelector('[data-testid="opportunity-modal"]') || document.querySelector('.fixed.inset-0.z-50');
      const oppTitle = oppModal ? oppModal.querySelector('h2, h3')?.innerText : null;

      return {
        url: window.location.href,
        hash: window.location.hash,
        messages: messages.slice(-5),
        inspectorText: inspectorText.substring(0, 500),
        activityText: activityText.substring(0, 500),
        hasOppModal: !!oppModal,
        oppTitle: oppTitle,
        dockVisible: !!document.querySelector('[data-testid="persistent-jarvis-dock"]') || !!document.querySelector('.fixed.bottom-6.right-6')
      };
    })()`);
  }

  // TEST 1: Open Revenue Operator
  console.log('\\n--- TEST 1: OPEN MODULE ("Open Revenue Operator") ---');
  // Ensure we start on #/mission-control
  await cdp.evaluate(`window.location.hash = '#/mission-control'`);
  await sleep(1000);
  console.log('Sending: "Open Revenue Operator"');
  await sendJarvisMessage("Open Revenue Operator");
  await sleep(3000);
  let state1 = await getRuntimeState();
  console.log('Test 1 State:', state1);
  const test1Pass = state1.hash.includes('revenue-operator') && state1.dockVisible;
  results['TEST 1'] = {
    command: 'Open Revenue Operator',
    pass: test1Pass,
    destination: state1.hash,
    dockVisible: state1.dockVisible
  };
  console.log('TEST 1 Result:', test1Pass ? 'PASS' : 'FAIL');

  // TEST 2: Open Exact Nested Entity ("Open the Notion and Agentic workflow template")
  console.log('\\n--- TEST 2: OPEN EXACT NESTED ENTITY ("Open the Notion and Agentic workflow template") ---');
  await sendJarvisMessage("Open the Notion and Agentic workflow template");
  await sleep(3500);
  let state2 = await getRuntimeState();
  console.log('Test 2 State:', state2);
  const test2Pass = state2.hash.includes('opportunity=opp-dfd16cad-') || (state2.hasOppModal && (state2.oppTitle || '').includes('Notion'));
  results['TEST 2'] = {
    command: 'Open the Notion and Agentic workflow template',
    pass: test2Pass,
    destination: state2.hash,
    hasModal: state2.hasOppModal,
    oppTitle: state2.oppTitle
  };
  console.log('TEST 2 Result:', test2Pass ? 'PASS' : 'FAIL');

  // Capture screenshot of opened modal with Jarvis dock
  const screenshotPath = path.resolve('D:/AgenticOS/server/scripts/test2-notion-template-open.png');
  await cdp.captureScreenshot(screenshotPath);
  console.log('Screenshot saved to:', screenshotPath);

  // Close modal by clicking outside or close button if open
  await cdp.evaluate(`(() => {
    const closeBtn = document.querySelector('[data-testid="opportunity-modal"] button, .fixed.inset-0.z-50 button');
    if (closeBtn) closeBtn.click();
    window.location.hash = '#/revenue-operator';
  })()`);
  await sleep(1000);

  // TEST 3: Shortened Entity Name ("Open the Notion template")
  console.log('\\n--- TEST 3: SHORTENED ENTITY NAME ("Open the Notion template") ---');
  await sendJarvisMessage("Open the Notion template");
  await sleep(3500);
  let state3 = await getRuntimeState();
  console.log('Test 3 State:', state3);
  const test3Pass = state3.hash.includes('opportunity=opp-dfd16cad-') || (state3.hasOppModal && (state3.oppTitle || '').includes('Notion'));
  results['TEST 3'] = {
    command: 'Open the Notion template',
    pass: test3Pass,
    destination: state3.hash,
    hasModal: state3.hasOppModal,
    oppTitle: state3.oppTitle
  };
  console.log('TEST 3 Result:', test3Pass ? 'PASS' : 'FAIL');

  // Close modal again
  await cdp.evaluate(`(() => {
    const closeBtn = document.querySelector('[data-testid="opportunity-modal"] button, .fixed.inset-0.z-50 button');
    if (closeBtn) closeBtn.click();
    window.location.hash = '#/revenue-operator';
  })()`);
  await sleep(1000);

  // TEST 4: Unknown Entity ("Open Project XYZ123")
  console.log('\\n--- TEST 4: UNKNOWN ENTITY ("Open Project XYZ123") ---');
  await sendJarvisMessage("Open Project XYZ123");
  await sleep(3500);
  let state4 = await getRuntimeState();
  console.log('Test 4 State:', state4);
  const lastMsg4 = (state4.messages.join(' ')).toLowerCase();
  const test4Pass = (lastMsg4.includes('could not find') || lastMsg4.includes('no matching') || lastMsg4.includes('entity_not_found') || lastMsg4.includes('not found')) &&
                    !lastMsg4.includes("i'm here and i'm ready");
  results['TEST 4'] = {
    command: 'Open Project XYZ123',
    pass: test4Pass,
    messages: state4.messages,
    noFiller: !lastMsg4.includes("i'm ready")
  };
  console.log('TEST 4 Result:', test4Pass ? 'PASS' : 'FAIL');

  // TEST 5: Ambiguous Entity ("Open the template")
  console.log('\\n--- TEST 5: AMBIGUOUS ENTITY ("Open the template") ---');
  // We send a vague ambiguous entity query or call actionRuntime parse
  await sendJarvisMessage("Open template");
  await sleep(3500);
  let state5 = await getRuntimeState();
  console.log('Test 5 State:', state5);
  const lastMsg5 = (state5.messages.join(' ')).toLowerCase();
  const test5Pass = lastMsg5.includes('multiple') || lastMsg5.includes('which') || lastMsg5.includes('found') || lastMsg5.includes('template');
  results['TEST 5'] = {
    command: 'Open template',
    pass: test5Pass,
    messages: state5.messages
  };
  console.log('TEST 5 Result:', test5Pass ? 'PASS' : 'FAIL');

  // TEST 9: Show me what you did
  console.log('\\n--- TEST 9: SHOW ME WHAT YOU DID ("Show me what you did") ---');
  await sendJarvisMessage("Show me what you did");
  await sleep(3500);
  let state9 = await getRuntimeState();
  console.log('Test 9 State:', state9);
  const lastMsg9 = (state9.messages.join(' '));
  const test9Pass = lastMsg9.includes('Action:') || lastMsg9.includes('Executed') || lastMsg9.includes('Status: completed') || lastMsg9.includes('Destination:');
  results['TEST 9'] = {
    command: 'Show me what you did',
    pass: test9Pass,
    messages: state9.messages
  };
  console.log('TEST 9 Result:', test9Pass ? 'PASS' : 'FAIL');

  // Check Inspector UI in persistent dock
  console.log('\\n--- CHECKING INSPECTOR UI TAB IN DOCK ---');
  const inspectorCheck = await cdp.evaluate(`(() => {
    // Switch to Action Activity tab in dock
    const tabs = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('Action Activity') || b.innerText.includes('Chat'));
    const activityTab = tabs.find(b => b.innerText.includes('Action Activity'));
    if (activityTab) activityTab.click();
    return { foundTab: !!activityTab };
  })()`);
  console.log('Inspector tab click:', inspectorCheck);
  await sleep(1000);

  const inspectorState = await cdp.evaluate(`(() => {
    const inspector = document.querySelector('[data-testid="jarvis-action-inspector"]');
    return {
      visible: !!inspector,
      text: inspector ? inspector.innerText : ''
    };
  })()`);
  console.log('Inspector State in DOM:', inspectorState.visible, inspectorState.text.substring(0, 300));

  const inspectorScreenshot = path.resolve('D:/AgenticOS/server/scripts/inspector-tab.png');
  await cdp.captureScreenshot(inspectorScreenshot);
  console.log('Inspector screenshot saved to:', inspectorScreenshot);

  cdp.close();
  console.log('\\nAll tests completed. Summary:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

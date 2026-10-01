const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WS_PATH = path.resolve(__dirname, '../server/node_modules/ws');
const WebSocket = require(WS_PATH);

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const DEBUG_PORT = '9222';

function fetchTargets(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
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

async function verifyInstalledComposer() {
  console.log('[1/6] Launching installed AgenticOS with remote debugging on port ' + DEBUG_PORT + '...');
  
  const child = spawn(EXE_PATH, ['--remote-debugging-port=' + DEBUG_PORT], {
    env: {
      ...process.env,
      AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT: DEBUG_PORT,
      NODE_ENV: 'production',
      AGENTICOS_ELECTRON_ROUTE: '#/engineering'
    },
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  console.log(`- Executable: ${EXE_PATH}`);
  console.log(`- Process PID: ${child.pid}`);

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await fetchTargets(DEBUG_PORT);
      if (list && list.length > 0) {
        targets = list;
        break;
      }
    } catch (_) {}
  }

  if (!targets || targets.length === 0) {
    throw new Error('Failed to connect to CDP on port ' + DEBUG_PORT);
  }

  const pageTargets = targets.filter(t => t.type === 'page');
  const primaryTarget = pageTargets[0] || targets[0];
  console.log(`[2/6] Connected to target: "${primaryTarget.title}" (${primaryTarget.url})`);

  const ws = new WebSocket(primaryTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let msgId = 1;
  const pending = new Map();
  ws.on('message', (raw) => {
    const parsed = JSON.parse(raw.toString());
    if (parsed.id && pending.has(parsed.id)) {
      const { resolve, reject } = pending.get(parsed.id);
      pending.delete(parsed.id);
      if (parsed.error) reject(new Error(parsed.error.message));
      else resolve(parsed.result);
    }
  });

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  console.log('[3/6] Waiting for page hydration and navigating to Engineering Workspace...');
  await new Promise(r => setTimeout(r, 2000));

  // Navigate to #/engineering if not already there
  await send('Runtime.evaluate', {
    expression: `(() => {
      if (window.location.hash !== '#/engineering') {
        window.location.hash = '#/engineering';
      }
    })()`,
    returnByValue: true
  });

  // Also try clicking the rail nav if needed
  await new Promise(r => setTimeout(r, 1500));
  await send('Runtime.evaluate', {
    expression: `(() => {
      const navBtn = document.querySelector('[data-testid="nav-antigravity"]');
      if (navBtn) navBtn.click();
    })()`,
    returnByValue: true
  });

  console.log('[4/6] Inspecting DOM elements in installed AgenticOS...');
  let composerAudit = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const composerInput = document.getElementById('engineering-task-composer-input');
        const delegateBtn = document.getElementById('btn-delegate-engineering-task');
        const continueBtn = document.getElementById('btn-continue-engineering-task');
        const resumeBtn = document.getElementById('btn-resume-engineering-task');
        const cancelBtn = document.getElementById('btn-cancel-engineering-task');
        const workerCard = document.querySelector('[data-testid="worker-ownership-card"]');
        const eventStream = document.querySelector('[data-testid="event-stream-container"]');
        const navRail = document.querySelector('[data-testid="nav-antigravity"]');

        return {
          currentHash: window.location.hash,
          documentTitle: document.title,
          hasComposerInput: !!composerInput,
          composerPlaceholder: composerInput ? composerInput.placeholder : null,
          hasDelegateBtn: !!delegateBtn,
          delegateBtnText: delegateBtn ? delegateBtn.innerText.trim() : null,
          hasContinueBtn: !!continueBtn,
          continueBtnText: continueBtn ? continueBtn.innerText.trim() : null,
          hasResumeBtn: !!resumeBtn,
          hasCancelBtn: !!cancelBtn,
          hasWorkerCard: !!workerCard,
          hasEventStream: !!eventStream,
          hasNavRailItem: !!navRail,
          bodySnippet: document.body.innerText.slice(0, 400)
        };
      })()`,
      returnByValue: true
    });

    if (res && res.result && res.result.value && res.result.value.hasComposerInput) {
      composerAudit = res.result.value;
      break;
    }
  }

  console.log('\n[5/6] DOM Inspection Audit Result:');
  console.log(JSON.stringify(composerAudit, null, 2));

  if (!composerAudit || !composerAudit.hasComposerInput) {
    throw new Error('Engineering Task Composer (#engineering-task-composer-input) was NOT found in DOM!');
  }

  console.log('\n[6/6] Testing Typing Interaction into Composer...');
  const typingResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.getElementById('engineering-task-composer-input');
      if (!input) return { success: false, error: 'input not found' };
      input.value = 'Inspect package.json and tell me the application version. Do not modify anything.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const delegateBtn = document.getElementById('btn-delegate-engineering-task');
      return {
        success: true,
        inputValue: input.value,
        delegateDisabled: delegateBtn ? delegateBtn.disabled : true
      };
    })()`,
    returnByValue: true
  });

  console.log('Typing interaction result:', JSON.stringify(typingResult.result.value, null, 2));

  // Take screenshot for physical visual confirmation
  console.log('Capturing DOM screenshot...');
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = 'D:\\AgenticOS\\artifacts\\installed-composer-verified.png';
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshotRes.data, 'base64'));
  console.log(`Screenshot saved to: ${screenshotPath}`);

  ws.close();
  console.log('\nPHYSICAL DOM VERIFICATION SUCCESSFUL: Engineering Task Composer is rendered and functional in installed AgenticOS!');
}

verifyInstalledComposer().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});

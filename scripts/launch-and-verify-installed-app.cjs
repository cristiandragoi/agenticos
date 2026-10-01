const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WS_PATH = path.resolve(__dirname, '../server/node_modules/ws');
const WebSocket = require(WS_PATH);

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const DEBUG_PORT = '9231';

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

async function main() {
  console.log('[1/5] Launching installed AgenticOS with remote debugging port ' + DEBUG_PORT + '...');
  
  const child = spawn(EXE_PATH, [], {
    env: {
      ...process.env,
      AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT: DEBUG_PORT,
      NODE_ENV: 'production'
    },
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  console.log(`- Executable: ${EXE_PATH}`);
  console.log(`- Spawned Process PID: ${child.pid}`);

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const list = await fetchTargets(DEBUG_PORT);
      if (list && list.length > 0) {
        targets = list;
        break;
      }
    } catch (_) {}
  }

  if (!targets || targets.length === 0) {
    throw new Error('Could not connect to CDP on port ' + DEBUG_PORT);
  }

  const pageTargets = targets.filter(t => t.type === 'page');
  const primaryTarget = pageTargets[0] || targets[0];
  console.log(`[2/5] Connected to window: "${primaryTarget.title}" (${primaryTarget.url})`);

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

  console.log('[3/5] Navigating to AntiGravity Engineering Workspace (#/engineering)...');
  await new Promise(r => setTimeout(r, 2000));

  // Click the nav-antigravity link in the LeftRail
  const navClickResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const link = document.querySelector('[data-testid="nav-antigravity"]');
      if (link) {
        link.click();
        return { clickedNavRail: true, href: link.getAttribute('href') };
      }
      window.location.hash = '#/engineering';
      return { clickedNavRail: false, hashSet: true };
    })()`,
    returnByValue: true
  });
  console.log('Nav action result:', navClickResult.result.value);

  // Wait for React to render EngineeringWorkspacePage
  console.log('[4/5] Inspecting DOM for Engineering Task Composer...');
  let audit = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const composerInput = document.getElementById('engineering-task-composer-input');
        const delegateBtn = document.getElementById('btn-delegate-engineering-task');
        const continueBtn = document.getElementById('btn-continue-engineering-task');
        const resumeBtn = document.getElementById('btn-resume-engineering-task');
        const cancelBtn = document.getElementById('btn-cancel-engineering-task');
        const workerCard = document.querySelector('[data-testid="worker-ownership-card"]');
        const workerSelectorButtons = Array.from(document.querySelectorAll('button')).filter(b => 
          b.innerText.includes('AntiGravity') || b.innerText.includes('CodeX') || b.innerText.includes('Hermes')
        ).map(b => b.innerText.trim());

        return {
          currentRoute: window.location.hash,
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
          workerSelectorButtons,
          renderedHeadings: Array.from(document.querySelectorAll('h1, h2')).map(h => h.innerText.trim())
        };
      })()`,
      returnByValue: true
    });

    if (evalRes && evalRes.result && evalRes.result.value && evalRes.result.value.hasComposerInput) {
      audit = evalRes.result.value;
      break;
    }
  }

  console.log('\nAudit evaluation output:');
  console.log(JSON.stringify(audit, null, 2));

  if (!audit || !audit.hasComposerInput) {
    throw new Error('Composer input not found in installed UI!');
  }

  console.log('\n[5/5] Testing typing into Composer inside the installed window...');
  const testInputText = 'Inspect package.json and tell me the application version. Do not modify anything.';
  const typeResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.getElementById('engineering-task-composer-input');
      if (!input) return { error: 'no input' };
      
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(input, ${JSON.stringify(testInputText)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const delegateBtn = document.getElementById('btn-delegate-engineering-task');
      return {
        valueSet: input.value,
        delegateDisabled: delegateBtn ? delegateBtn.disabled : true
      };
    })()`,
    returnByValue: true
  });
  console.log('Typing result:', typeResult.result.value);

  // Take screenshot
  console.log('Capturing verified screenshot of installed AgenticOS UI...');
  const ss = await send('Page.captureScreenshot', { format: 'png' });
  const ssPath = 'D:\\AgenticOS\\artifacts\\installed-antigravity-composer.png';
  fs.mkdirSync(path.dirname(ssPath), { recursive: true });
  fs.writeFileSync(ssPath, Buffer.from(ss.data, 'base64'));
  console.log(`Screenshot saved to: ${ssPath}`);

  // Disconnect CDP
  ws.close();
  console.log('\nVERIFICATION COMPLETE: Installed AgenticOS is running, has the Task Composer visibly rendered, and is ready for use.');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});

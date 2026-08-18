const WebSocket = require('ws');
const { execSync } = require('child_process');

async function getCDP() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) {
        ws.off('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result.value;
  };

  return { ws, send, evaluate };
}

async function auditProcesses() {
  const getPs = (cmd) => {
    try {
      return execSync(`powershell -Command "${cmd}"`, { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };

  const agenticProcs = getPs('Get-Process -Name "Agentic OS" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName | Format-Table -HideTableHeaders');
  const netstat = getPs('netstat -ano | findstr :4000');
  return { agenticProcs, netstat };
}

async function run() {
  console.log('=== STEP 1: AUDITING BEFORE CLOSE ===');
  const before = await auditProcesses();
  console.log('Agentic OS processes before close:\n', before.agenticProcs || 'None');
  console.log('Port 4000 before close:\n', before.netstat || 'None');

  console.log('\n=== STEP 2: TRIGGERING NORMAL WINDOW CLOSE VIA IPC ===');
  try {
    const cdp = await getCDP();
    await cdp.evaluate('window.ipcRenderer ? window.ipcRenderer.send("window-close") : window.close()');
    cdp.ws.close();
  } catch (e) {
    console.log('CDP close send error (expected if window closed immediately):', e.message);
  }

  console.log('\nWaiting 3 seconds...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n=== STEP 3: AUDITING AFTER NORMAL CLOSE ===');
  const after = await auditProcesses();
  console.log('Agentic OS processes after close:\n', after.agenticProcs || 'NONE (EXITED)');
  console.log('Port 4000 after close:\n', after.netstat || 'FREE (NO LISTENER)');

  console.log('\n=== STEP 4: ATTEMPTING SECOND LAUNCH ===');
  const launchOut = execSync('powershell -Command "Start-Process \\"C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe\\""', { encoding: 'utf8' });
  console.log('Launch command executed.');

  console.log('Waiting 4 seconds for window/process initialization...');
  await new Promise(r => setTimeout(r, 4000));

  const afterRelaunch = await auditProcesses();
  console.log('Agentic OS processes after relaunch:\n', afterRelaunch.agenticProcs || 'NONE (FAILED TO START)');
  console.log('Port 4000 after relaunch:\n', afterRelaunch.netstat || 'NONE');

  // Check if CDP is reachable
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
    const targets = await res.json();
    console.log('CDP targets on relaunch:', targets);
  } catch (e) {
    console.log('CDP connection on relaunch failed:', e.message);
  }
}

run().catch(console.error);

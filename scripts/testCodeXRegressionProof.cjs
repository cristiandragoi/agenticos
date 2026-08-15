const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function isBackendHealthy() {
  try {
    const res = await fetch('http://127.0.0.1:4000/api/health', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startPackagedApp() {
  console.log('Launching Packaged App...');
  execSync('powershell -Command "$env:AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT=\'9222\'; Start-Process \'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe\'"');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isBackendHealthy()) {
      console.log(`[PASS] Packaged backend healthy at T+${i+1}s`);
      return true;
    }
  }
  throw new Error('Packaged backend failed to start');
}

async function main() {
  console.log('=== PHASE 7: CODEX REGRESSION WRITE/READ PROOF ===\n');

  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  await startPackagedApp();

  const targetFile = 'B:\\AgenticOS\\scratch\\magnitude_codex_regression.txt';
  const expectedContent = 'CODEX STILL WORKS AFTER MAGNITUDE';

  // Ensure scratch dir exists and delete any previous regression file
  if (!fs.existsSync(path.dirname(targetFile))) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  }
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }

  console.log(`Target file to create: ${targetFile}`);

  // Create CodeX goal
  const prompt = `Create the file B:\\AgenticOS\\scratch\\magnitude_codex_regression.txt with exact content: CODEX STILL WORKS AFTER MAGNITUDE\nThen read the file back to verify its content.`;
  
  const createRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      workspacePath: 'B:\\AgenticOS',
      approvalPolicy: 'auto'
    })
  });

  const goalData = await createRes.json();
  const goalId = goalData.goalId || goalData.id;
  console.log(`Created CodeX Goal: ${goalId}`);

  // Poll until terminal state
  let terminalGoal = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goals/${goalId}`);
    const data = await res.json();
    console.log(`[T+${i+1}s] CodeX Goal Status: ${data.status} (Events: ${data.events?.length || 0})`);

    if (['completed', 'failed', 'stopped', 'blocked'].includes(data.status)) {
      terminalGoal = data;
      break;
    }
  }

  if (!terminalGoal) {
    throw new Error('CodeX goal did not reach terminal state within 60s');
  }

  console.log('\n--- TERMINAL GOAL INSPECTION ---');
  console.log('Status:', terminalGoal.status);
  console.log('Final Answer:', terminalGoal.finalAnswer?.slice(0, 300));
  console.log('Run Summary:', JSON.stringify(terminalGoal.runSummary, null, 2));

  // Verify file on disk
  if (!fs.existsSync(targetFile)) {
    throw new Error(`File ${targetFile} was NOT created on disk!`);
  }
  const diskContent = fs.readFileSync(targetFile, 'utf8').trim();
  console.log(`Physical file content on disk: "${diskContent}"`);

  if (diskContent !== expectedContent) {
    throw new Error(`File content mismatch! Expected "${expectedContent}", got "${diskContent}"`);
  }
  console.log('[PASS] File write and physical content verification: PASS');

  if (terminalGoal.status !== 'completed') {
    throw new Error(`CodeX goal terminal status was "${terminalGoal.status}", expected "completed"`);
  }
  console.log('[PASS] CodeX goal terminal status: completed');

  console.log('\n=== CODEX REGRESSION PROOF PASSED 100%! ===');
}

main().catch(err => {
  console.error('CodeX Regression Test Failed:', err);
  process.exit(1);
});

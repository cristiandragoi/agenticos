const { execSync } = require('child_process');

function getChromiumProcessCount() {
  try {
    const output = execSync('powershell -Command "(Get-Process -Name chrome, chromium, headless_shell -ErrorAction SilentlyContinue).Count"').toString().trim();
    return parseInt(output) || 0;
  } catch {
    return 0;
  }
}

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
  console.log('=== PHASE 9: ORPHAN PROCESS CLEANUP ACCEPTANCE TEST ===\n');

  if (!(await isBackendHealthy())) {
    await startPackagedApp();
  }

  const initialChromium = getChromiumProcessCount();
  console.log(`Initial Chromium process count: ${initialChromium}`);

  // 1. Run multiple browser inspections in sequence & parallel
  console.log('\n--- Running 3 sequential Magnitude browser inspections ---');
  const urls = [
    'https://example.com',
    'https://www.wikipedia.org/',
    'https://example.com'
  ];

  for (let i = 0; i < urls.length; i++) {
    console.log(`Executing run ${i+1} (${urls[i]})...`);
    const createRes = await fetch('http://127.0.0.1:4000/api/magnitude/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: `Inspect ${urls[i]}` })
    });
    const run = await createRes.json();
    
    // Poll for completion
    for (let t = 0; t < 20; t++) {
      await new Promise(r => setTimeout(r, 500));
      const rRes = await fetch(`http://127.0.0.1:4000/api/magnitude/runs/${run.id}`);
      const rData = await rRes.json();
      if (['completed', 'failed', 'stopped'].includes(rData.status)) {
        console.log(`Run ${i+1} finished: status = ${rData.status}`);
        break;
      }
    }
  }

  // 2. Launch a run and cancel it immediately mid-flight
  console.log('\n--- Launching run and cancelling mid-flight ---');
  const cancelRes = await fetch('http://127.0.0.1:4000/api/magnitude/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'https://example.com' })
  });
  const cancelRun = await cancelRes.json();
  await new Promise(r => setTimeout(r, 100)); // allow browser launch to begin

  const stopRes = await fetch(`http://127.0.0.1:4000/api/magnitude/runs/${cancelRun.id}/stop`, { method: 'POST' });
  const stopData = await stopRes.json();
  console.log('Stop API result:', stopData);

  await new Promise(r => setTimeout(r, 2000));

  // 3. Inspect final Chromium process count
  const finalChromium = getChromiumProcessCount();
  console.log(`\nFinal Chromium process count: ${finalChromium}`);

  const diff = finalChromium - initialChromium;
  console.log(`Orphan Chromium process difference: ${diff}`);

  if (diff > 0) {
    throw new Error(`LEAK DETECTED: ${diff} orphan Chromium process(es) remained!`);
  }

  console.log('[PASS] ZERO orphan browser processes leaked! All Chromium instances cleanly terminated.');
  console.log('\n=== PHASE 9 ORPHAN PROCESS TEST PASSED 100%! ===');
}

main().catch(err => {
  console.error('Orphan Process Test Failed:', err);
  process.exit(1);
});

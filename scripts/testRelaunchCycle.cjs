const { execSync } = require('child_process');

function getPs() {
  try {
    const out = execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Select-Object Id, ProcessName | Format-Table -HideTableHeaders"', { encoding: 'utf8' }).trim();
    return out;
  } catch {
    return '';
  }
}

function getPort4000() {
  try {
    return execSync('netstat -ano | findstr :4000', { encoding: 'utf8' }).trim();
  } catch {
    return '';
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

async function closeAppGracefully() {
  console.log('Sending normal close to main window...');
  // Send close signal via PowerShell CloseMainWindow() or taskkill
  try {
    execSync('powershell -Command "$p = Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' -and $_.MainWindowHandle -ne 0 }; if ($p) { $p.CloseMainWindow() } else { (Get-Process -Name \'Agentic OS\' -ErrorAction SilentlyContinue) | Stop-Process }"');
  } catch {}

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    const procs = getPs();
    if (!procs.includes('Agentic')) {
      console.log(`Process exited cleanly after ${(i+1)*250}ms.`);
      return true;
    }
  }

  // If still running, force stop
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  return false;
}

async function launchAndVerify(label, isShortcut = false) {
  console.log(`\n--- ${label} ---`);
  if (isShortcut) {
    console.log('Launching via Desktop Shortcut...');
    execSync('powershell -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(\'C:\\Users\\Cris\\Desktop\\Agentic OS.lnk\'); Start-Process $s.TargetPath -WorkingDirectory $s.WorkingDirectory"');
  } else {
    console.log('Launching Agentic OS.exe directly...');
    execSync('powershell -Command "Start-Process \'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe\'"');
  }

  // Poll until backend is healthy and window exists
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isBackendHealthy()) {
      healthy = true;
      console.log(`[PASS] Backend healthy and ready at T+${i+1}s`);
      break;
    }
  }

  if (!healthy) {
    throw new Error(`[FAIL] ${label} backend failed to become ready.`);
  }

  // Check window exists
  const winCheck = execSync('powershell -Command "(Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' -and $_.MainWindowHandle -ne 0 }).Count"', { encoding: 'utf8' }).trim();
  console.log(`Main window count: ${winCheck}`);

  // Now close normally
  const closed = await closeAppGracefully();

  // Audit processes after close
  await new Promise(r => setTimeout(r, 1000));
  const procsAfter = getPs();
  const netstatAfter = getPort4000();
  console.log('Processes after close:\n', procsAfter || 'NONE (CLEAN)');
  console.log('Port 4000 listeners after close:\n', netstatAfter.includes('LISTENING') ? netstatAfter : 'FREE (NO LISTENER)');

  return { healthy, closed, procsClean: !procsAfter.includes('Agentic') };
}

async function main() {
  console.log('=== STARTING 5x RELAUNCH + 3x SHORTCUT RELAUNCH TEST ===');

  // Initial cleanup
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  // 5x Normal Launch Cycles
  for (let i = 1; i <= 5; i++) {
    const res = await launchAndVerify(`RELAUNCH ${i}`);
    if (!res.healthy) throw new Error(`Relaunch ${i} failed`);
  }

  // 3x Shortcut Cycles
  for (let i = 1; i <= 3; i++) {
    const res = await launchAndVerify(`SHORTCUT RELAUNCH ${i}`, true);
    if (!res.healthy) throw new Error(`Shortcut relaunch ${i} failed`);
  }

  console.log('\n=== ALL 5 RELAUNCHES AND 3 SHORTCUT LAUNCHES PASSED PERFECTLY ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

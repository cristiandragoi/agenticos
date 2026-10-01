const { execSync } = require('child_process');

try {
  const psCmd = `
    $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|electron|powershell' }
    $results = @()
    foreach ($p in $procs) {
      $results += [PSCustomObject]@{
        ProcessId = $p.ProcessId
        ParentProcessId = $p.ParentProcessId
        Name = $p.Name
        CommandLine = $p.CommandLine
        ExecutablePath = $p.ExecutablePath
      }
    }
    $results | ConvertTo-Json -Depth 3
  `;
  const output = execSync(`powershell -NoProfile -Command "${psCmd.replace(/\n/g, ' ')}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const procs = JSON.parse(output);
  const byId = new Map(procs.map(p => [p.ProcessId, p]));

  function getAncestry(pid) {
    const chain = [];
    let curr = byId.get(pid);
    while (curr) {
      chain.push(`${curr.Name} (PID ${curr.ProcessId}): ${curr.CommandLine || curr.ExecutablePath}`);
      curr = byId.get(curr.ParentProcessId);
    }
    return chain;
  }

  // Look for our key servers:
  console.log('=== PROCESS ANCESTRY CHECK ===');
  for (const pid of [1244, 5908, 1240, 25824]) {
    if (byId.has(pid)) {
      console.log(`\nAncestry for PID ${pid}:`);
      console.log(getAncestry(pid).join('\n  <- '));
    }
  }
} catch (e) {
  console.error(e);
}


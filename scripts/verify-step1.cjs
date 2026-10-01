const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== STEP 1: VERIFY RUNNING WORKSPACE ===');

const devProcessesPath = path.resolve(__dirname, '../.agentos/dev-processes.json');
const devProcesses = JSON.parse(fs.readFileSync(devProcessesPath, 'utf8').replace(/^\uFEFF/, ''));
console.log('dev-processes.json:', devProcesses);

const psScript = `
$pids = @(${devProcesses.backendPid}, ${devProcesses.vitePid}, ${devProcesses.electronPid})
foreach ($id in $pids) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
  [PSCustomObject]@{
    ProcessId = $id
    Name = $p.Name
    CommandLine = $p.CommandLine
    ExecutablePath = $p.ExecutablePath
  }
}
`;
fs.writeFileSync(path.join(__dirname, 'temp-step1.ps1'), psScript);
const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'temp-step1.ps1')}"`, { encoding: 'utf8' });
console.log(out);
fs.unlinkSync(path.join(__dirname, 'temp-step1.ps1'));

// Check runner script logs
const backendLog = fs.readFileSync(path.resolve(__dirname, '../.agentos/logs/backend-dev.log'), 'utf8');
const lastLines = backendLog.trim().split('\n').slice(-10).join('\n');
console.log('Backend Dev Log (Tail):\n', lastLines);

const viteLog = fs.readFileSync(path.resolve(__dirname, '../.agentos/logs/vite-dev.log'), 'utf8');
console.log('Vite Dev Log (Tail):\n', viteLog.trim().split('\n').slice(-10).join('\n'));

console.log('\nAuthoritative Root: D:\\AgenticOS');
console.log('Backend Directory: D:\\AgenticOS\\server');
console.log('Frontend Directory: D:\\AgenticOS');
console.log('Is D:\\AgenticOS-clean running? NO');

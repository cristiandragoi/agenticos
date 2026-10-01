const { execSync } = require('child_process');

const ps = `
$hWnd = [IntPtr]10620862
$wPid = 0
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class W2 {
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@
[W2]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
$p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
if ($p) {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $wPid").CommandLine
    Write-Output "PID: $wPid Name: $($p.ProcessName) Cmd: $cmd"
} else {
    Write-Output "No process for HWND 10620862"
}
`;
const fs = require('fs');
const path = require('path');
const os = require('os');
const tmp = path.join(os.tmpdir(), 'get_wpid2.ps1');
fs.writeFileSync(tmp, ps, 'utf8');
console.log(execSync('powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + tmp, { encoding: 'utf8' }));
fs.unlinkSync(tmp);

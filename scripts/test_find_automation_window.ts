import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9223;

  // Kill existing 9223 process if any
  try {
    const oldPid = execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`).toString().trim();
    if (oldPid) {
      process.kill(parseInt(oldPid, 10));
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {}

  console.log('Spawning Chrome on port 9223 with profileDir:', profileDir);
  const proc = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
      'https://www.google.com',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { ready = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('Chrome ready on 9223:', ready);

  const listeningPidRaw = execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`).toString().trim();
  const listeningPid = parseInt(listeningPidRaw, 10);
  console.log('Listening PID on 9223:', listeningPid, 'Spawned PID:', proc.pid);

  // Let's find all process IDs related to this Chrome instance (parent, child, listening)
  const pidsRaw = execSync(`powershell -NoProfile -Command "
    \\$pids = @(${listeningPid}, ${proc.pid})
    Get-CimInstance Win32_Process | Where-Object { \\$_.ParentProcessId -in \\$pids -or \\$_.ProcessId -in \\$pids } | Select-Object -ExpandProperty ProcessId
  "`).toString().trim().split(/\\r?\\n/).map(s => parseInt(s.trim(), 10)).filter(Boolean);

  const allPids = Array.from(new Set([listeningPid, proc.pid, ...pidsRaw]));
  console.log('All Chrome instance PIDs:', allPids);

  // Now enumerate desktop windows for these PIDs!
  const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInstanceEnum {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinInstanceEnum]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinInstanceEnum]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinInstanceEnum]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinInstanceEnum]::SetThreadDesktop($desk) | Out-Null }

$targetPids = @(${allPids.join(',')})

[WinInstanceEnum]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinInstanceEnum]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    if ($wPid -in $targetPids) {
        $csb = New-Object System.Text.StringBuilder 256
        [WinInstanceEnum]::GetClassName($h, $csb, 256) | Out-Null
        $cn = $csb.ToString()
        $tsb = New-Object System.Text.StringBuilder 512
        [WinInstanceEnum]::GetWindowText($h, $tsb, 512) | Out-Null
        $t = $tsb.ToString()
        $vis = [WinInstanceEnum]::IsWindowVisible($h)
        $min = [WinInstanceEnum]::IsIconic($h)
        Write-Host "FOUND: Class: $cn HWND: $($h.ToInt64()) PID: $wPid Vis: $vis Min: $min Title: '$t'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
  const out = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`).toString();
  console.log('Matching windows:\n', out);
}

main().catch(console.error);

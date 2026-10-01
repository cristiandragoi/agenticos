import { spawn } from 'child_process';
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function testHwndDiscovery() {
  const port = 9223;
  const profileDir = 'C:\\Temp\\agenticos-visible-browser';
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  // 1. Check if running, if not spawn
  let isRunning = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) isRunning = true;
  } catch {}

  if (!isRunning) {
    console.log('Spawning Chrome...');
    const proc = spawn(
      chromeExe,
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

    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          console.log('Chrome is up!');
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // 2. Discover Chrome PID from port 9223
  let cdpPid = 0;
  for (let i = 0; i < 10; i++) {
    try {
      const out = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
      ], { encoding: 'utf8' }).trim();
      if (out) {
        cdpPid = parseInt(out, 10);
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log('Discovered Chrome CDP PID on port 9223:', cdpPid);

  // 3. Inspect Windows for this PID using EnumDesktopWindows
  const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInspector {
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
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinInspector]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinInspector]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinInspector]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinInspector]::SetThreadDesktop($desk) | Out-Null }

$targetPid = ${cdpPid}
$fgHwnd = [WinInspector]::GetForegroundWindow()
$matched = @()

[WinInspector]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinInspector]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    $clsSb = New-Object System.Text.StringBuilder 256
    [WinInspector]::GetClassName($hWnd, $clsSb, 256) | Out-Null
    $cls = $clsSb.ToString()
    $wPid = 0
    [WinInspector]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
    $vis = [WinInspector]::IsWindowVisible($hWnd)
    
    if ($wPid -eq $targetPid -and $cls -eq "Chrome_WidgetWin_1" -and $vis) {
        $isMin = [WinInspector]::IsIconic($hWnd)
        $isFg = ($hWnd -eq $fgHwnd)
        $matched += [PSCustomObject]@{
            Handle = $hWnd.ToInt64()
            Pid = $wPid
            Title = $t
            Class = $cls
            IsVisible = $vis
            IsMinimized = $isMin
            IsForeground = $isFg
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

$matched | ConvertTo-Json -Compress
`;

  const tmp = path.join('C:\\Temp', `test_enum_${Date.now()}.ps1`);
  fs.writeFileSync(tmp, psScript, 'utf8');
  try {
    const rawOut = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' }).trim();
    console.log('Matched Windows for Chrome PID:', rawOut);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

testHwndDiscovery().catch(console.error);

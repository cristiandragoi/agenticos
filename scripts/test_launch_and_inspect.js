import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function main() {
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
  const port = 9223;

  console.log('1. Spawning Chrome...');
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

  // Wait for CDP
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        console.log('CDP is ready!');
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  // Find Chrome windows
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

$matched = @()
$fgHwnd = [WinInspector]::GetForegroundWindow()

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
    
    $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
    $pName = if ($p) { $p.ProcessName.ToLower() } else { "" }
    
    if ($vis -and $t.Length -gt 0) {
        $matched += [PSCustomObject]@{
            Handle = $hWnd.ToInt64()
            Pid = $wPid
            ProcessName = $pName
            Title = $t
            Class = $cls
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

$matched | ConvertTo-Json
`;

  const tmp = path.join(process.env.TEMP || 'C:\\Temp', `test_inspect_${Date.now()}.ps1`);
  fs.writeFileSync(tmp, psScript, 'utf8');
  try {
    const rawOut = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' }).trim();
    console.log('Found Chrome Windows:\n', rawOut);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

main().catch(console.error);

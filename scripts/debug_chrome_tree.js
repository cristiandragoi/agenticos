import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

async function main() {
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\cd-pr\\AppData\\Local\\Temp\\agenticos-visible-browser';
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
      'https://www.youtube.com',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  await new Promise((r) => setTimeout(r, 3000));

  // Get listening PID on 9223
  let cdpPid = 0;
  try {
    const raw = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
    ], { encoding: 'utf8' }).trim();
    cdpPid = parseInt(raw, 10);
  } catch {}
  console.log('Chrome CDP PID on 9223:', cdpPid);

  // Check all child processes of cdpPid
  const psTree = `
Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${cdpPid} -or $_.ParentProcessId -eq ${cdpPid} } | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-Table -AutoSize
`;
  console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', psTree], { encoding: 'utf8' }));

  // Check windows of ALL processes associated with this tree
  const psEnum = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinDbg {
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
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinDbg]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinDbg]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinDbg]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinDbg]::SetThreadDesktop($desk) | Out-Null }

[WinDbg]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinDbg]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    $clsSb = New-Object System.Text.StringBuilder 256
    [WinDbg]::GetClassName($hWnd, $clsSb, 256) | Out-Null
    $cls = $clsSb.ToString()
    $wPid = 0
    [WinDbg]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
    $vis = [WinDbg]::IsWindowVisible($hWnd)
    
    $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
    $pName = if ($p) { $p.ProcessName.ToLower() } else { "" }
    
    if ($wPid -eq ${cdpPid} -or $pName -eq "chrome") {
        Write-Host ("MATCH: HWND={0} PID={1} ({2}) Class={3} Vis={4} Title='{5}'" -f $hWnd.ToInt64(), $wPid, $pName, $cls, $vis, $t)
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
  const tmp = path.join(process.env.TEMP || 'C:\\Temp', `dbg_${Date.now()}.ps1`);
  fs.writeFileSync(tmp, psEnum, 'utf8');
  try {
    console.log(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' }));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

main().catch(console.error);

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function testPreciseHwndResolution() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9223;

  console.log('Connecting to or launching Chrome on port 9223...');
  let isRunning = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) isRunning = true;
  } catch {}

  if (!isRunning) {
    const spawnedProc = spawn(
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
    spawnedProc.unref();

    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) { isRunning = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.google.com');

  const tmpPs1 = path.join(os.tmpdir(), 'get_pid.ps1');
  fs.writeFileSync(tmpPs1, `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`);
  const pidRaw = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1], { encoding: 'utf8' }).trim();
  const cdpPid = parseInt(pidRaw, 10);
  console.log('CDP listening PID on 9223:', cdpPid);

  const psFindHwnd = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
public class WinHwndFinder {
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
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public const int SW_RESTORE = 9;
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinHwndFinder]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinHwndFinder]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinHwndFinder]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinHwndFinder]::SetThreadDesktop($desk) | Out-Null }

$targetPid = ${cdpPid}

# Also gather child PIDs of targetPid
$allPids = @($targetPid)
$children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $targetPid }
if ($children) {
    $allPids += ($children | Select-Object -ExpandProperty ProcessId)
}

$global:bestHwnd = $null
$global:bestArea = 0

[WinHwndFinder]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinHwndFinder]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    if ($wPid -in $allPids) {
        $csb = New-Object System.Text.StringBuilder 256
        [WinHwndFinder]::GetClassName($h, $csb, 256) | Out-Null
        $cn = $csb.ToString()
        if ($cn -eq "Chrome_WidgetWin_1") {
            $r = New-Object RECT
            [WinHwndFinder]::GetWindowRect($h, [ref]$r) | Out-Null
            $w = $r.Right - $r.Left
            $ht = $r.Bottom - $r.Top
            $area = [int64]$w * [int64]$ht
            if ($area -gt $global:bestArea) {
                $sb = New-Object System.Text.StringBuilder 512
                [WinHwndFinder]::GetWindowText($h, $sb, 512) | Out-Null
                $global:bestHwnd = [PSCustomObject]@{
                    Hwnd = $h.ToInt64()
                    Pid = $wPid
                    ClassName = $cn
                    Title = $sb.ToString()
                    Width = $w
                    Height = $ht
                    IsVisible = [WinHwndFinder]::IsWindowVisible($h)
                    IsMinimized = [WinHwndFinder]::IsIconic($h)
                }
                $global:bestArea = $area
            }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($global:bestHwnd) {
    $global:bestHwnd | ConvertTo-Json -Compress
} else {
    "{}"
}
`;
  const tmpScript = path.join(os.tmpdir(), 'find_hwnd.ps1');
  fs.writeFileSync(tmpScript, psFindHwnd);
  const res = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpScript], { encoding: 'utf8' }).trim();
  console.log('Resolved Best HWND for CDP PID:', res);

  await browser.close();
}

testPreciseHwndResolution().catch(console.error);

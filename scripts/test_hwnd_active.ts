import { chromium } from 'playwright';
import { spawn, execSync } from 'child_process';
import path from 'path';

async function testHwndResolution() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9223;

  console.log('Spawning Chrome...');
  const proc = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { ready = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0]?.pages()[0] || (await browser.contexts()[0]?.newPage());
  await page.goto('https://www.google.com');

  const pidRaw = execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`).toString().trim();
  const cdpPid = parseInt(pidRaw, 10);
  console.log('CDP listening PID:', cdpPid);

  // Let's inspect all top-level windows using EnumWindows / EnumDesktopWindows
  const psHwndFinder = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinFinder {
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
$winsta = [WinFinder]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinFinder]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinFinder]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinFinder]::SetThreadDesktop($desk) | Out-Null }

$chromePids = Get-Process chrome | Select-Object -ExpandProperty Id

[WinFinder]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinFinder]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    if ($wPid -in $chromePids) {
        $csb = New-Object System.Text.StringBuilder 256
        [WinFinder]::GetClassName($h, $csb, 256) | Out-Null
        $cn = $csb.ToString()
        $tsb = New-Object System.Text.StringBuilder 512
        [WinFinder]::GetWindowText($h, $tsb, 512) | Out-Null
        $t = $tsb.ToString()
        $vis = [WinFinder]::IsWindowVisible($h)
        $min = [WinFinder]::IsIconic($h)
        Write-Host "HWND: $($h.ToInt64()) PID: $wPid Class: '$cn' Vis: $vis Min: $min Title: '$t'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
  const out = execSync(`powershell -NoProfile -Command "${psHwndFinder.replace(/"/g, '\\"')}"`).toString();
  console.log('Chrome windows while page is at Google:\n', out);

  // Keep alive 5 seconds
  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
}

testHwndResolution().catch(console.error);

import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function testTitleProbe() {
  const port = 9223;
  console.log('Connecting to Chrome on port 9223...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  const probeTitle = `AgenticOS_HW_PROBE_${Date.now()}`;
  console.log('Setting probe title on page:', probeTitle);
  await page.evaluate((t) => { document.title = t; }, probeTitle);
  await new Promise(r => setTimeout(r, 500));

  const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinProbe {
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
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinProbe]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinProbe]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinProbe]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinProbe]::SetThreadDesktop($desk) | Out-Null }

$probe = "${probeTitle}"
$global:foundHwnd = $null
$fg = [WinProbe]::GetForegroundWindow()

[WinProbe]::EnumDesktopWindows($desk, {
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 512
    [WinProbe]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t -match $probe) {
        $wPid = 0
        [WinProbe]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
        $global:foundHwnd = [PSCustomObject]@{
            Hwnd = $h.ToInt64()
            Pid = $wPid
            Title = $t
            IsVisible = [WinProbe]::IsWindowVisible($h)
            IsMinimized = [WinProbe]::IsIconic($h)
            IsForeground = ($h -eq $fg)
        }
        return $false
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($global:foundHwnd) {
    $global:foundHwnd | ConvertTo-Json -Compress
} else {
    "{}"
}
`;
  const tmpPs1 = path.join(os.tmpdir(), 'probe_win.ps1');
  fs.writeFileSync(tmpPs1, psScript, 'utf8');
  const res = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1], { encoding: 'utf8' }).trim();
  console.log('HWND probe result:', res);

  await page.evaluate(() => { document.title = 'Google'; });
  await browser.close();
}

testTitleProbe().catch(console.error);

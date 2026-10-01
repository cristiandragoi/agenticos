import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { WindowsBrowserWindowHelper } from '../server/dist/services/browser/browserSession.js';

async function investigate() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9223;

  console.log('Spawning Chrome on port 9223...');
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

  await new Promise(r => setTimeout(r, 3000));

  // 1. Who is listening on 9223?
  const netstat = execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess"`).toString().trim();
  console.log(`TCP Port ${port} listening OwningProcess PID:`, netstat);

  const cdpPid = parseInt(netstat, 10);

  // 2. Enumerate all windows for this PID and see what PowerShell sees
  const psDiag = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinDiag {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
$desk = [WinDiag]::OpenDesktop("Default", 0, $false, 0x10000000)
$targetPid = ${cdpPid || 0}
[WinDiag]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $wPid = 0
    [WinDiag]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
    if ($wPid -eq $targetPid) {
        $sb = New-Object System.Text.StringBuilder 512
        [WinDiag]::GetWindowText($hWnd, $sb, 512) | Out-Null
        $t = $sb.ToString()
        $vis = [WinDiag]::IsWindowVisible($hWnd)
        $min = [WinDiag]::IsIconic($hWnd)
        Write-Host "MATCH PID $wPid: HWND $($hWnd.ToInt64()) Vis: $vis Min: $min Title: '$t'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
  const diagOut = execSync(`powershell -Command "${psDiag.replace(/"/g, '\\"')}"`).toString();
  console.log('Diagnostic windows for CDP PID:\n', diagOut);

  // 3. Test WindowsBrowserWindowHelper.inspectWindow with cdpPid
  const inspCdpPid = WindowsBrowserWindowHelper.inspectWindow(cdpPid, 'Chrome');
  console.log('inspectWindow(cdpPid, "Chrome"):', inspCdpPid);

  const inspProcPid = WindowsBrowserWindowHelper.inspectWindow(proc.pid, 'Chrome');
  console.log('inspectWindow(proc.pid, "Chrome"):', inspProcPid);

  const inspUndef = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  console.log('inspectWindow(undefined, "Chrome"):', inspUndef);
}

investigate().catch(console.error);

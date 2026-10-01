import { browserOperator } from '../server/dist/services/browser/browserOperator.js';
import { WindowsBrowserWindowHelper } from '../server/dist/services/browser/browserSession.js';
import { execSync } from 'child_process';

async function testRealOperator() {
  console.log('Calling browserOperator.ensureBrowser()...');
  await browserOperator.ensureBrowser('VISIBLE_USER_BROWSER');
  console.log('ensureBrowser finished.');

  const netstat = execSync(`powershell -Command "Get-NetTCPConnection -LocalPort 9223 -State Listen | Select-Object -ExpandProperty OwningProcess"`).toString().trim();
  console.log('Port 9223 OwningProcess PID:', netstat);

  const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinTest {
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
$winsta = [WinTest]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinTest]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinTest]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinTest]::SetThreadDesktop($desk) | Out-Null }
$fg = [WinTest]::GetForegroundWindow()

[WinTest]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinTest]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0 -and [WinTest]::IsWindowVisible($hWnd)) {
        $wPid = 0
        [WinTest]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
        $proc = Get-Process -Id $wPid -ErrorAction SilentlyContinue
        $pName = if ($proc) { $proc.ProcessName } else { "unknown" }
        if ($pName -match "chrome|edge") {
            $isMin = [WinTest]::IsIconic($hWnd)
            $isFg = ($hWnd -eq $fg)
            Write-Host "HWND: $($hWnd.ToInt64()) PID: $wPid ($pName) Min: $isMin Fg: $isFg Title: '$t'"
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
  const psOut = execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`).toString();
  console.log('Windows for Chrome/Edge:\n', psOut);

  const cdpTargets = await fetch('http://127.0.0.1:9223/json').then(r => r.json()).catch(() => []);
  console.log('CDP targets:', cdpTargets);

  const insp = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  console.log('inspectWindow(undefined, "Chrome"):', insp);
}

testRealOperator().catch(console.error);

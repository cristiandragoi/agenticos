const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const psScript = `
$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinStationInspect4 {
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
Add-Type -TypeDefinition $csharp

$winsta = [WinStationInspect4]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinStationInspect4]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinStationInspect4]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinStationInspect4]::SetThreadDesktop($desk) | Out-Null }

$fgHwnd = [WinStationInspect4]::GetForegroundWindow()
Write-Output "FG HWND: $fgHwnd"

[WinStationInspect4]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinStationInspect4]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
        $wPid = 0
        [WinStationInspect4]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
        $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
        $pName = if ($p) { $p.ProcessName } else { "unknown" }
        $vis = [WinStationInspect4]::IsWindowVisible($hWnd)
        $min = [WinStationInspect4]::IsIconic($hWnd)
        $isFg = ($hWnd -eq $fgHwnd)
        Write-Output "HWND:$hWnd | PID:$wPid ($pName) | Vis:$vis | Min:$min | Fg:$isFg | Title:'$t'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;

const tmp = path.join(os.tmpdir(), 'debug_enum4.ps1');
fs.writeFileSync(tmp, psScript, 'utf8');
const out = execSync('powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + tmp, { encoding: 'utf8' });
console.log(out);
fs.unlinkSync(tmp);

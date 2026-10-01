const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const psScript = `
$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinStationInspect3 {
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
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $csharp

$winsta = [WinStationInspect3]::OpenWindowStation("WinSta0", $false, 0x10000000)
$err1 = [Marshal]::GetLastWin32Error()
Write-Output "winsta: $winsta (err: $err1)"

$desk = [WinStationInspect3]::OpenDesktop("Default", 0, $false, 0x10000000)
$err2 = [Marshal]::GetLastWin32Error()
Write-Output "desk: $desk (err: $err2)"

$fgHwnd = [WinStationInspect3]::GetForegroundWindow()
Write-Output "FG HWND: $fgHwnd"

Write-Output "--- Testing EnumWindows ---"
$count = 0
[WinStationInspect3]::EnumWindows({
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinStationInspect3]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
        $vis = [WinStationInspect3]::IsWindowVisible($hWnd)
        Write-Output "HWND:$hWnd Vis:$vis Title:'$t'"
        $script:count++
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
Write-Output "Total EnumWindows titled: $count"
`;

const tmp = path.join(os.tmpdir(), 'debug_enum2.ps1');
fs.writeFileSync(tmp, psScript, 'utf8');
const out = execSync('powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + tmp, { encoding: 'utf8' });
console.log(out);
fs.unlinkSync(tmp);

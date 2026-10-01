Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinHwndPid {
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
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
$winsta = [WinHwndPid]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinHwndPid]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinHwndPid]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinHwndPid]::SetThreadDesktop($desk) | Out-Null }

$targetPid = 41020

$found = 0
[WinHwndPid]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinHwndPid]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    if ($wPid -eq $targetPid) {
        $csb = New-Object System.Text.StringBuilder 256
        [WinHwndPid]::GetClassName($h, $csb, 256) | Out-Null
        $sb = New-Object System.Text.StringBuilder 512
        [WinHwndPid]::GetWindowText($h, $sb, 512) | Out-Null
        $vis = [WinHwndPid]::IsWindowVisible($h)
        Write-Host ("PID " + $targetPid + ": HWND " + $h.ToInt64() + " Class " + $csb.ToString() + " Vis " + $vis + " Title '" + $sb.ToString() + "'")
        $script:found++
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
Write-Host ("Total windows found for PID " + $targetPid + ": " + $found)

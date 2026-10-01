Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinClassDesktopEnum {
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

$winsta = [WinClassDesktopEnum]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinClassDesktopEnum]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinClassDesktopEnum]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinClassDesktopEnum]::SetThreadDesktop($desk) | Out-Null }

[WinClassDesktopEnum]::EnumDesktopWindows($desk, {
    param($h, $l)
    $csb = New-Object System.Text.StringBuilder 256
    [WinClassDesktopEnum]::GetClassName($h, $csb, 256) | Out-Null
    $cn = $csb.ToString()
    if ($cn -match "Chrome|Edge") {
        $tsb = New-Object System.Text.StringBuilder 512
        [WinClassDesktopEnum]::GetWindowText($h, $tsb, 512) | Out-Null
        $t = $tsb.ToString()
        $wPid = 0
        [WinClassDesktopEnum]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
        $vis = [WinClassDesktopEnum]::IsWindowVisible($h)
        $min = [WinClassDesktopEnum]::IsIconic($h)
        Write-Host "Class: $cn HWND: $($h.ToInt64()) PID: $wPid Vis: $vis Min: $min Title: '$t'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

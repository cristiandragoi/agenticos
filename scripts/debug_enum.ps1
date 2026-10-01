Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinHwndFinder2 {
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

$winsta = [WinHwndFinder2]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinHwndFinder2]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinHwndFinder2]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinHwndFinder2]::SetThreadDesktop($desk) | Out-Null }

$allProcs = Get-Process chrome -ErrorAction SilentlyContinue
Write-Host "All Chrome PIDs: $(($allProcs | Select-Object -ExpandProperty Id) -join ', ')"

[WinHwndFinder2]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinHwndFinder2]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    $csb = New-Object System.Text.StringBuilder 256
    [WinHwndFinder2]::GetClassName($h, $csb, 256) | Out-Null
    $cn = $csb.ToString()
    if ($cn -match "Chrome") {
        $sb = New-Object System.Text.StringBuilder 512
        [WinHwndFinder2]::GetWindowText($h, $sb, 512) | Out-Null
        $vis = [WinHwndFinder2]::IsWindowVisible($h)
        Write-Host "HWND $($h.ToInt64()) PID $wPid Class $cn Vis $vis Title '$($sb.ToString())'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinDiagAll {
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

$winsta = [WinDiagAll]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinDiagAll]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinDiagAll]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinDiagAll]::SetThreadDesktop($desk) | Out-Null }

$chromeProcs = Get-Process chrome -ErrorAction SilentlyContinue
Write-Host "Chrome Processes found: $($chromeProcs.Count)"
foreach ($p in $chromeProcs) {
    Write-Host "  PID: $($p.Id) MainWnd: $($p.MainWindowHandle) Title: '$($p.MainWindowTitle)'"
}

[WinDiagAll]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinDiagAll]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    $isChrome = $chromeProcs | Where-Object { $_.Id -eq $wPid }
    if ($isChrome) {
        $csb = New-Object System.Text.StringBuilder 256
        [WinDiagAll]::GetClassName($h, $csb, 256) | Out-Null
        $cn = $csb.ToString()
        $tsb = New-Object System.Text.StringBuilder 512
        [WinDiagAll]::GetWindowText($h, $tsb, 512) | Out-Null
        $t = $tsb.ToString()
        $vis = [WinDiagAll]::IsWindowVisible($h)
        $min = [WinDiagAll]::IsIconic($h)
        Write-Host "  HWND $($h.ToInt64()) Class '$cn' PID $wPid Vis $vis Min $min Title '$t'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

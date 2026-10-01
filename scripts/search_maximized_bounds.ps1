Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
public class WinBoundsSearch {
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
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinBoundsSearch]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinBoundsSearch]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinBoundsSearch]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinBoundsSearch]::SetThreadDesktop($desk) | Out-Null }

[WinBoundsSearch]::EnumDesktopWindows($desk, {
    param($h, $l)
    $r = New-Object RECT
    [WinBoundsSearch]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left
    $ht = $r.Bottom - $r.Top
    if ($w -ge 1900 -and $ht -ge 1000) {
        $wPid = 0
        [WinBoundsSearch]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
        $proc = Get-Process -Id $wPid -ErrorAction SilentlyContinue
        $pName = if ($proc) { $proc.ProcessName } else { "unknown" }
        $csb = New-Object System.Text.StringBuilder 256
        [WinBoundsSearch]::GetClassName($h, $csb, 256) | Out-Null
        $sb = New-Object System.Text.StringBuilder 512
        [WinBoundsSearch]::GetWindowText($h, $sb, 512) | Out-Null
        $vis = [WinBoundsSearch]::IsWindowVisible($h)
        $min = [WinBoundsSearch]::IsIconic($h)
        Write-Host "HWND $($h.ToInt64()) PID $wPid ($pName) Class '$($csb.ToString())' Vis $vis Min $min Bounds [$($r.Left), $($r.Top), $w, $ht] Title '$($sb.ToString())'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

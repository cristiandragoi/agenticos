$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinStationUtil {
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

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $csharp

$winsta = [WinStationUtil]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) {
    [WinStationUtil]::SetProcessWindowStation($winsta) | Out-Null
}

$desk = [WinStationUtil]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) {
    [WinStationUtil]::SetThreadDesktop($desk) | Out-Null
}

$found = $null
[WinStationUtil]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinStationUtil]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0 -and [WinStationUtil]::IsWindowVisible($hWnd)) {
        if ($t -match "Chrome" -or $t -match "YouTube") {
            $wPid = 0
            [WinStationUtil]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
            $isMin = [WinStationUtil]::IsIconic($hWnd)
            $global:found = [PSCustomObject]@{
                Handle = $hWnd.ToInt64()
                Pid = $wPid
                Title = $t
                IsMinimized = $isMin
            }
            return $false
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($global:found) {
    $hwnd = [IntPtr]$global:found.Handle
    if ($global:found.IsMinimized) {
        [WinStationUtil]::ShowWindow($hwnd, [WinStationUtil]::SW_RESTORE) | Out-Null
    } else {
        [WinStationUtil]::ShowWindow($hwnd, [WinStationUtil]::SW_SHOW) | Out-Null
    }
    [WinStationUtil]::keybd_event(0x12, 0, 0, 0)
    [WinStationUtil]::SetForegroundWindow($hwnd) | Out-Null
    [WinStationUtil]::keybd_event(0x12, 0, 2, 0)
    Write-Output ($global:found | ConvertTo-Json -Compress)
} else {
    Write-Output "{}"
}

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
    public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $csharp

$winsta = [WinStationUtil]::OpenWindowStation("WinSta0", $false, 0x10000000)
Write-Output "OpenWindowStation: $winsta"
if ($winsta -ne [IntPtr]::Zero) {
    [WinStationUtil]::SetProcessWindowStation($winsta) | Out-Null
}

$desk = [WinStationUtil]::OpenDesktop("Default", 0, $false, 0x10000000)
Write-Output "OpenDesktop: $desk"
if ($desk -ne [IntPtr]::Zero) {
    [WinStationUtil]::SetThreadDesktop($desk) | Out-Null
}

$list = New-Object System.Collections.Generic.List[object]
[WinStationUtil]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinStationUtil]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0 -and [WinStationUtil]::IsWindowVisible($hWnd)) {
        $pid = 0
        [WinStationUtil]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
        $list.Add([PSCustomObject]@{
            Handle = $hWnd.ToInt64()
            Pid = $pid
            Title = $t
            IsMinimized = [WinStationUtil]::IsIconic($hWnd)
        })
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

$list | ConvertTo-Json

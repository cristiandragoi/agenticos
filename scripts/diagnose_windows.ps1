Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInspector {
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
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$winsta = [WinInspector]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinInspector]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinInspector]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinInspector]::SetThreadDesktop($desk) | Out-Null }

[WinInspector]::EnumDesktopWindows($desk, {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinInspector]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    $clsSb = New-Object System.Text.StringBuilder 256
    [WinInspector]::GetClassName($hWnd, $clsSb, 256) | Out-Null
    $cls = $clsSb.ToString()
    $wPid = 0
    [WinInspector]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
    $vis = [WinInspector]::IsWindowVisible($hWnd)
    
    $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
    $pName = if ($p) { $p.ProcessName } else { "unknown" }
    
    if ($pName -match "chrome|msedge|electron|AgenticOS" -or $cls -match "Chrome") {
        Write-Host ("HWND: {0}, PID: {1} ({2}), Class: {3}, Vis: {4}, Title: '{5}'" -f $hWnd.ToInt64(), $wPid, $pName, $cls, $vis, $t)
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

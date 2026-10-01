Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinHwndAgentic {
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

$winsta = [WinHwndAgentic]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinHwndAgentic]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinHwndAgentic]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinHwndAgentic]::SetThreadDesktop($desk) | Out-Null }

$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "agenticos-visible-browser" }
$pids = $procs | Select-Object -ExpandProperty ProcessId
Write-Host "AgenticOS Chrome PIDs: $($pids -join ', ')"

[WinHwndAgentic]::EnumDesktopWindows($desk, {
    param($h, $l)
    $wPid = 0
    [WinHwndAgentic]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
    if ($wPid -in $pids) {
        $csb = New-Object System.Text.StringBuilder 256
        [WinHwndAgentic]::GetClassName($h, $csb, 256) | Out-Null
        $sb = New-Object System.Text.StringBuilder 512
        [WinHwndAgentic]::GetWindowText($h, $sb, 512) | Out-Null
        $vis = [WinHwndAgentic]::IsWindowVisible($h)
        $min = [WinHwndAgentic]::IsIconic($h)
        Write-Host "MATCH HWND $($h.ToInt64()) PID $wPid Class $($csb.ToString()) Vis $vis Min $min Title '$($sb.ToString())'"
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

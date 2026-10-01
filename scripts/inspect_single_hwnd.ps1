Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinHwndTest {
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
}
'@

param([int64]$HwndVal = 2693764)
$hwnd = [IntPtr]$HwndVal
$sb = New-Object System.Text.StringBuilder 512
[WinHwndTest]::GetWindowText($hwnd, $sb, 512) | Out-Null
$wPid = 0
[WinHwndTest]::GetWindowThreadProcessId($hwnd, [ref]$wPid) | Out-Null
$p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
$vis = [WinHwndTest]::IsWindowVisible($hwnd)
$min = [WinHwndTest]::IsIconic($hwnd)
$fg = [WinHwndTest]::GetForegroundWindow()
Write-Host "HWND: $($hwnd.ToInt64()) PID: $wPid ProcessName: $($p.ProcessName) Vis: $vis Min: $min Fg: $($hwnd -eq $fg) Title: '$($sb.ToString())'"

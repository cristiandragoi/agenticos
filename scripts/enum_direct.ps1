Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnumDirect {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$count = 0
[WinEnumDirect]::EnumWindows({
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 512
    [WinEnumDirect]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
        $wPid = 0
        [WinEnumDirect]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
        $vis = [WinEnumDirect]::IsWindowVisible($h)
        $min = [WinEnumDirect]::IsIconic($h)
        $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
        if ($p -and ($p.ProcessName -match "chrome|edge|AgenticOS|electron")) {
            Write-Host "HWND: $($h.ToInt64()) PID: $wPid ($($p.ProcessName)) Vis: $vis Min: $min Title: '$t'"
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

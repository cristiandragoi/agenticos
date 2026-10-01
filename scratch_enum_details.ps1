Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@

$fg = [WinEnum]::GetForegroundWindow()
Write-Host "Foreground HWND: $fg"

[WinEnum]::EnumWindows({
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 512
    [WinEnum]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
        $wPid = 0
        [WinEnum]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
        $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
        $pName = if ($p) { $p.ProcessName } else { "unknown" }
        if ($pName -match "chrome|edge|AgenticOS|electron|code") {
            $vis = [WinEnum]::IsWindowVisible($h)
            $min = [WinEnum]::IsIconic($h)
            $isFg = ($h -eq $fg)
            Write-Host "$h | PID:$wPid | $pName | Vis:$vis | Min:$min | Fg:$isFg | Title:'$t'"
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

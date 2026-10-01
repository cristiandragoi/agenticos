$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinUtil {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $csharp

$list = New-Object System.Collections.Generic.List[object]
[WinUtil]::EnumWindows({
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 512
    [WinUtil]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0 -and [WinUtil]::IsWindowVisible($hWnd)) {
        $pid = 0
        [WinUtil]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
        $list.Add([PSCustomObject]@{
            Handle = $hWnd.ToInt64()
            Pid = $pid
            Title = $t
            IsMinimized = [WinUtil]::IsIconic($hWnd)
        })
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

$list | ConvertTo-Json

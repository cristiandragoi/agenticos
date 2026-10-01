Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class WinHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

$list = [System.Collections.Generic.List[PSObject]]::new()

[WinHelper]::EnumWindows({
    param($hWnd, $lParam)
    if ([WinHelper]::IsWindowVisible($hWnd)) {
        $len = [WinHelper]::GetWindowTextLength($hWnd)
        if ($len -gt 0) {
            $sb = New-Object System.Text.StringBuilder ($len + 1)
            [WinHelper]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $pid = 0
            [WinHelper]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
            $isMin = [WinHelper]::IsIconic($hWnd)
            $list.Add([PSCustomObject]@{
                Handle = $hWnd
                ProcessId = $pid
                Title = $sb.ToString()
                Minimized = $isMin
            })
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

$list | Select-Object ProcessId, Handle, Minimized, Title | Format-Table -AutoSize

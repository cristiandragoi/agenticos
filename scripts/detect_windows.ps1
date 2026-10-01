Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinHwndDetective {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

$targetPid = 41020
Write-Host "Searching for windows of PID $targetPid via standard EnumWindows..."

$found = 0
[WinHwndDetective]::EnumWindows({
    param($hwnd, $lparam)
    $pidOut = 0
    [WinHwndDetective]::GetWindowThreadProcessId($hwnd, [ref]$pidOut) | Out-Null
    if ($pidOut -eq $targetPid) {
        $sbText = New-Object System.Text.StringBuilder 512
        [WinHwndDetective]::GetWindowText($hwnd, $sbText, 512) | Out-Null
        $sbClass = New-Object System.Text.StringBuilder 256
        [WinHwndDetective]::GetClassName($hwnd, $sbClass, 256) | Out-Null
        $vis = [WinHwndDetective]::IsWindowVisible($hwnd)
        Write-Host "Found window: HWND $($hwnd.ToInt64()) Class $($sbClass.ToString()) Vis $vis Title '$($sbText.ToString())'"
        $script:found++
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

Write-Host "Total found: $found"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class DesktopSwitcher {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public const uint GENERIC_ALL = 0x10000000;
    public const uint DESKTOP_ALL_ACCESS = 0x01FF;
}
"@

$hDesk = [DesktopSwitcher]::OpenDesktop("Default", 0, $false, [DesktopSwitcher]::GENERIC_ALL)
if ($hDesk -eq [IntPtr]::Zero) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "OpenDesktop failed with error $err"
} else {
    Write-Output "OpenDesktop succeeded: $hDesk"
    $ok = [DesktopSwitcher]::SetThreadDesktop($hDesk)
    if (!$ok) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Output "SetThreadDesktop failed with error $err"
    } else {
        Write-Output "SetThreadDesktop succeeded!"
        $fg = [DesktopSwitcher]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 256
        [DesktopSwitcher]::GetWindowText($fg, $sb, 256) | Out-Null
        Write-Output "Foreground window on Default desktop: HWND=$fg Title='$($sb.ToString())'"
    }
}

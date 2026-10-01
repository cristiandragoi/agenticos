Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class WinStationTest {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetThreadDesktop(int dwThreadId);

    [DllImport("kernel32.dll")]
    public static extern int GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
}
"@

$winsta = [WinStationTest]::GetProcessWindowStation()
$sb = New-Object System.Text.StringBuilder 256
$needed = 0
[WinStationTest]::GetUserObjectInformation($winsta, 2, $sb, 256, [ref]$needed)
Write-Output "Window Station: $($sb.ToString())"

$desk = [WinStationTest]::GetThreadDesktop([WinStationTest]::GetCurrentThreadId())
$sb2 = New-Object System.Text.StringBuilder 256
[WinStationTest]::GetUserObjectInformation($desk, 2, $sb2, 256, [ref]$needed)
Write-Output "Desktop: $($sb2.ToString())"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class WinStationTest2 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetThreadDesktop(int dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
}
"@

$procs = Get-Process -Name 'node','AgenticOS' -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    if ($p.Threads.Count -gt 0) {
        $t = $p.Threads[0]
        $desk = [WinStationTest2]::GetThreadDesktop($t.Id)
        $sb = New-Object System.Text.StringBuilder 256
        $needed = 0
        $res = [WinStationTest2]::GetUserObjectInformation($desk, 2, $sb, 256, [ref]$needed)
        Write-Output "PID $($p.Id) ($($p.ProcessName)): Desktop: '$($sb.ToString())' Success: $res"
    }
}

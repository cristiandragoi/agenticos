Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinThreadEnum {
    [DllImport("user32.dll")]
    public static extern bool EnumThreadWindows(uint dwThreadId, EnumThreadDelegate lpfn, IntPtr lParam);
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
    public delegate bool EnumThreadDelegate(IntPtr hWnd, IntPtr lParam);
}
'@

$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "agenticos-visible-browser" }
$pids = $procs | Select-Object -ExpandProperty ProcessId

foreach ($pidVal in $pids) {
    $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
    if ($proc) {
        foreach ($thread in $proc.Threads) {
            $tId = [uint32]$thread.Id
            [WinThreadEnum]::EnumThreadWindows($tId, {
                param($h, $l)
                $csb = New-Object System.Text.StringBuilder 256
                [WinThreadEnum]::GetClassName($h, $csb, 256) | Out-Null
                $sb = New-Object System.Text.StringBuilder 512
                [WinThreadEnum]::GetWindowText($h, $sb, 512) | Out-Null
                $vis = [WinThreadEnum]::IsWindowVisible($h)
                $min = [WinThreadEnum]::IsIconic($h)
                Write-Host "FOUND THREAD WINDOW: HWND $($h.ToInt64()) PID $pidVal Thread $tId Class '$($csb.ToString())' Vis $vis Min $min Title '$($sb.ToString())'"
                return $true
            }, [IntPtr]::Zero) | Out-Null
        }
    }
}

param (
    [string]$ScreenshotPath = ""
)

$ErrorActionPreference = "SilentlyContinue"

# 1. Get all windows with titles
$windows = Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle

# 2. Get foreground window using user32
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinAPIHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@

$hwnd = [WinAPIHelper]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][WinAPIHelper]::GetWindowText($hwnd, $sb, $sb.Capacity)
$fgTitle = $sb.ToString()
$fgPid = 0
[void][WinAPIHelper]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
$fgProc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue

# 3. Take screenshot if path provided
if ($ScreenshotPath) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bounds = $screen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $graphics.Dispose()
        $bitmap.Dispose()
    } catch {}
}

# 4. Relevant running processes
$procs = (Get-Process -Name 'AgenticOS','chrome','comet','WhatsApp','msedge' -ErrorAction SilentlyContinue).ProcessName | Select-Object -Unique

[PSCustomObject]@{
    ForegroundTitle = $fgTitle
    ForegroundProcess = if ($fgProc) { $fgProc.ProcessName } else { "" }
    ForegroundPid = $fgPid
    RunningProcesses = @($procs)
    Windows = @($windows)
} | ConvertTo-Json -Compress -Depth 2

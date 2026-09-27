param(
    [string]$Action = "inspect",
    [string]$TargetQuery = "",
    [long]$Hwnd = 0,
    [string]$OutScreenshotPath = ""
)

$source = @"
using System;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class DesktopPerceptionHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hDC);
    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);
    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static void Attach() {
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        } catch {}
    }

    public static bool CaptureHwnd(IntPtr hWnd, string outPath, out int outW, out int outH) {
        outW = 0;
        outH = 0;
        Attach();
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) return false;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return false;

        outW = width;
        outH = height;

        IntPtr hdcSrc = GetWindowDC(hWnd);
        if (hdcSrc == IntPtr.Zero) return false;
        IntPtr hdcDest = CreateCompatibleDC(hdcSrc);
        IntPtr hBitmap = CreateCompatibleBitmap(hdcSrc, width, height);
        IntPtr hOld = SelectObject(hdcDest, hBitmap);

        bool success = PrintWindow(hWnd, hdcDest, 2);
        if (!success) {
            success = BitBlt(hdcDest, 0, 0, width, height, hdcSrc, 0, 0, 0x00CC0020);
        }

        SelectObject(hdcDest, hOld);
        DeleteDC(hdcDest);
        ReleaseDC(hWnd, hdcSrc);

        if (success) {
            using (Bitmap bmp = Bitmap.FromHbitmap(hBitmap)) {
                bmp.Save(outPath, ImageFormat.Png);
            }
        }
        DeleteObject(hBitmap);
        return success;
    }

    public static List<IntPtr> FindChildWindows(IntPtr parent) {
        Attach();
        List<IntPtr> list = new List<IntPtr>();
        EnumChildWindows(parent, (hWnd, lParam) => {
            list.Add(hWnd);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
[DesktopPerceptionHelper]::Attach()

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Get-TargetWindow {
    param([long]$RequestedHwnd, [string]$Query)
    if ($RequestedHwnd -gt 0) {
        return [IntPtr]$RequestedHwnd
    }
    
    # Check current foreground
    $fg = [DesktopPerceptionHelper]::GetForegroundWindow()
    if ($fg -ne [IntPtr]::Zero -and -not $Query) {
        return $fg
    }
    
    # Enumerate top-level windows matching Query
    $qLower = if ($Query) { $Query.ToLower().Trim() } else { "" }
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent (Get-Location).Path }
    $listScript = Join-Path $scriptDir "list_desktop_windows.ps1"
    if (-not (Test-Path $listScript)) {
        $listScript = Join-Path (Get-Location).Path "server/scripts/list_desktop_windows.ps1"
    }
    if (Test-Path $listScript) {
        $json = & powershell -NoProfile -ExecutionPolicy Bypass -File $listScript
        if ($json) {
            $windows = $json | ConvertFrom-Json
            if ($Query) {
                $match = $windows | Where-Object { 
                    $_.title.ToLower().Contains($qLower) -or 
                    $_.process.ToLower().Contains($qLower) 
                } | Select-Object -First 1
                if ($match) { return [IntPtr]$match.hwnd }
            } else {
                # Pick first prominent non-explorer window
                $match = $windows | Where-Object { 
                    $_.process -ne "explorer" -and 
                    $_.title -notlike "*AgenticOS*" 
                } | Select-Object -First 1
                if ($match) { return [IntPtr]$match.hwnd }
            }
        }
    }
    
    return $fg
}

$targetHwnd = Get-TargetWindow -RequestedHwnd $Hwnd -Query $TargetQuery

if ($targetHwnd -eq [IntPtr]::Zero) {
    [PSCustomObject]@{
        success = $false
        error = "No window found for query '$TargetQuery'"
    } | ConvertTo-Json -Compress
    exit 0
}

# Get Window Details
$sbTitle = New-Object System.Text.StringBuilder 512
[DesktopPerceptionHelper]::GetWindowText($targetHwnd, $sbTitle, 512) | Out-Null
$windowTitle = $sbTitle.ToString()

$sbClass = New-Object System.Text.StringBuilder 256
[DesktopPerceptionHelper]::GetClassName($targetHwnd, $sbClass, 256) | Out-Null
$windowClass = $sbClass.ToString()

$pid = 0
[DesktopPerceptionHelper]::GetWindowThreadProcessId($targetHwnd, [ref]$pid) | Out-Null
$processName = ""
try { $processName = [System.Diagnostics.Process]::GetProcessById($pid).ProcessName } catch {}

# Capture Screenshot if requested
$screenshotInfo = $null
if ($OutScreenshotPath) {
    $outW = 0
    $outH = 0
    $capSuccess = [DesktopPerceptionHelper]::CaptureHwnd($targetHwnd, $OutScreenshotPath, [ref]$outW, [ref]$outH)
    if ($capSuccess -and (Test-Path $OutScreenshotPath)) {
        $item = Get-Item $OutScreenshotPath
        $sha = (Get-FileHash -Path $OutScreenshotPath -Algorithm SHA256).Hash.ToLower()
        $screenshotInfo = @{
            success = $true
            source = "window"
            hwnd = $targetHwnd.ToInt64()
            width = $outW
            height = $outH
            timestamp = (Get-Date -Format o)
            artifactPath = $item.FullName
            sha256 = $sha
            byteSize = $item.Length
        }
    }
}

# Perform UI Automation Tree Inspection
$extractedTexts = @()
$extractedControls = @()
$method = "uia"

# Check parent element
$rootEl = $null
try { $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd) } catch {}

# If Electron/Chromium, check Chrome_RenderWidgetHostHWND children
$childrenHwnds = [DesktopPerceptionHelper]::FindChildWindows($targetHwnd)
$renderWidget = $null
foreach ($cHwnd in $childrenHwnds) {
    $cClassSb = New-Object System.Text.StringBuilder 256
    [DesktopPerceptionHelper]::GetClassName($cHwnd, $cClassSb, 256) | Out-Null
    if ($cClassSb.ToString() -eq "Chrome_RenderWidgetHostHWND") {
        try {
            $r = [System.Windows.Automation.AutomationElement]::FromHandle($cHwnd)
            if ($r) { $renderWidget = $r; break }
        } catch {}
    }
}

$elementToInspect = if ($renderWidget) { $renderWidget } else { $rootEl }

if ($elementToInspect) {
    try {
        $descendants = $elementToInspect.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($d in $descendants) {
            $name = $d.Current.Name
            $ct = $d.Current.ControlType.ProgrammaticName
            $val = ""
            try {
                $valPattern = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($valPattern) { $val = $valPattern.Current.Value }
            } catch {}
            
            if ($name) {
                $extractedTexts += $name
                $extractedControls += @{ name = $name; type = $ct; value = $val }
            }
        }
    } catch {}
}

# Deduplicate extracted texts while preserving order
$uniqueTexts = @()
$seen = @{}
foreach ($t in $extractedTexts) {
    $clean = $t.Trim()
    if ($clean -and -not $seen.ContainsKey($clean)) {
        $seen[$clean] = $true
        $uniqueTexts += $clean
    }
}

$fullText = $uniqueTexts -join "`n"

$resultObj = [PSCustomObject]@{
    success = $true
    hwnd = $targetHwnd.ToInt64()
    windowTitle = $windowTitle
    windowClass = $windowClass
    process = $processName
    pid = $pid
    method = $method
    text = $fullText
    controlCount = $extractedControls.Count
    controls = ($extractedControls | Select-Object -First 50)
    screenshot = $screenshotInfo
    confidence = if ($fullText.Length -gt 20) { 0.95 } else { 0.75 }
}

$resultObj | ConvertTo-Json -Depth 5 -Compress

param(
    [string]$Action = "inspect",
    [string]$TargetQuery = "",
    [long]$Hwnd = 0,
    [string]$OutScreenshotPath = ""
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
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

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    public class WindowEntry {
        public long Hwnd;
        public uint Pid;
        public string Process;
        public string Title;
        public string ClassName;
        public int Width;
        public int Height;
    }

    public static void Attach() {
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        } catch {}
    }

    public static List<WindowEntry> GetDesktopWindows() {
        Attach();
        List<WindowEntry> list = new List<WindowEntry>();
        EnumProc enumCallback = (hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                StringBuilder sbClass = new StringBuilder(256);
                GetClassName(hWnd, sbClass, 256);
                string cName = sbClass.ToString();
                if (cName.Contains("ToolSaveBits") || cName.Contains("Tooltip") || cName.Contains("DropShadow")) {
                    return true;
                }

                RECT r;
                GetWindowRect(hWnd, out r);
                int w = r.Right - r.Left;
                int h = r.Bottom - r.Top;

                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                string title = sb.ToString();
                if (!string.IsNullOrEmpty(title) && (w >= 100 && h >= 100 || cName == "Progman")) {
                    uint pid = 0;
                    GetWindowThreadProcessId(hWnd, out pid);
                    string pName = "";
                    try { pName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
                    WindowEntry e = new WindowEntry();
                    e.Hwnd = hWnd.ToInt64();
                    e.Pid = pid;
                    e.Process = pName;
                    e.Title = title;
                    e.ClassName = cName;
                    e.Width = w;
                    e.Height = h;
                    list.Add(e);
                }
            }
            return true;
        };

        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk != IntPtr.Zero) {
            EnumDesktopWindows(hDesk, enumCallback, IntPtr.Zero);
        }
        if (list.Count == 0) {
            EnumWindows(enumCallback, IntPtr.Zero);
        }
        return list;
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
    
    $allWindows = [DesktopPerceptionHelper]::GetDesktopWindows()

    # Check current foreground
    $fg = [DesktopPerceptionHelper]::GetForegroundWindow()
    $fgTitle = ""
    $fgW = 0
    $fgH = 0
    if ($fg -ne [IntPtr]::Zero) {
        $sb = New-Object System.Text.StringBuilder 512
        [DesktopPerceptionHelper]::GetWindowText($fg, $sb, 512) | Out-Null
        $fgTitle = $sb.ToString()
        $rect = New-Object DesktopPerceptionHelper+RECT
        [DesktopPerceptionHelper]::GetWindowRect($fg, [ref]$rect) | Out-Null
        $fgW = $rect.Right - $rect.Left
        $fgH = $rect.Bottom - $rect.Top
    }

    $qClean = if ($Query) { 
        $Query.ToLower().Trim() -replace '^(?:read|inspect|what\s+is\s+inside|what''s\s+inside|inside|in|the)\s+', '' -replace '\s+(?:window|page|app|application)$', ''
    } else { "" }

    # If query is deictic, empty, or desktop/screen:
    if (-not $qClean -or $qClean -eq 'desktop' -or $qClean -eq 'screen' -or $qClean -eq 'fullscreen' -or $qClean -match '^(?:active|current|this|the)\b' -or $qClean -eq 'active_window') {
        # If desktop or screen was explicitly queried, pick Progman if available
        if ($qClean -eq 'desktop' -or $qClean -eq 'screen' -or $qClean -eq 'fullscreen') {
            $progman = $allWindows | Where-Object { $_.ClassName -eq "Progman" -or $_.Title -eq "Program Manager" } | Select-Object -First 1
            if ($progman) { return [IntPtr]$progman.Hwnd }
        }
        # If foreground is valid, not AgenticOS, and prominent
        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*" -and $fgW -ge 300 -and $fgH -ge 200) {
            return $fg
        }
        # Otherwise pick first prominent non-explorer non-AgenticOS window
        $match = $allWindows | Where-Object { 
            $_.Process -ne "explorer" -and 
            $_.Title -notlike "*AgenticOS*" -and
            $_.Title -notlike "*Program Manager*" -and
            $_.Width -ge 300 -and
            $_.Height -ge 200
        } | Select-Object -First 1
        if ($match) { return [IntPtr]$match.Hwnd }
        if ($fg -ne [IntPtr]::Zero) { return $fg }
    }

    if ($qClean -eq 'browser' -or $qClean -match '^(?:browser|web\s*browser)$') {
        # Check active foreground first if it's a browser
        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") {
            $fgProc = $allWindows | Where-Object { $_.Hwnd -eq $fg.ToInt64() } | Select-Object -First 1
            if ($fgProc -and $fgProc.Process -match 'comet|chrome|msedge|firefox|brave|opera') {
                return $fg
            }
        }
        # Find any prominent browser window (Comet, Chrome, Edge, etc.)
        $browserMatch = $allWindows | Where-Object { 
            $_.Process -match 'comet|chrome|msedge|firefox|brave|opera' -and 
            $_.Width -ge 300 -and 
            $_.Height -ge 200 
        } | Select-Object -First 1
        if ($browserMatch) { return [IntPtr]$browserMatch.Hwnd }
        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") { return $fg }
    }

    if ($qClean) {
        # Tokenize query
        $tokens = $qClean -split '[\s\-_/]+' | Where-Object { $_ -and $_ -notin @("app", "application", "browser", "window", "the", "a", "an") }
        
        # Word-number expansion
        $expandedTokens = @()
        foreach ($tok in $tokens) {
            $expandedTokens += $tok
            if ($tok -eq "1") { $expandedTokens += "one" }
            elseif ($tok -eq "one") { $expandedTokens += "1" }
            elseif ($tok -eq "2") { $expandedTokens += "two" }
            elseif ($tok -eq "two") { $expandedTokens += "2" }
        }

        $scored = @()
        foreach ($w in $allWindows) {
            $tLower = if ($w.Title) { $w.Title.ToLower() } else { "" }
            $pLower = if ($w.Process) { $w.Process.ToLower() } else { "" }
            $score = 0

            # Exact substring match
            if ($tLower.Contains($qClean) -or $pLower.Contains($qClean)) { $score += 100 }

            # Token matches
            foreach ($tok in $expandedTokens) {
                if ($tLower.Contains($tok)) { $score += 40 }
                if ($pLower.Contains($tok)) { $score += 50 }
            }

            # Penalize explorer or shell infrastructure unless explicitly asked
            if ($w.Process -eq "explorer" -and -not $qClean.Contains("explorer")) { $score -= 60 }
            if ($tLower -eq "program manager") { $score -= 100 }

            if ($score -gt 0) {
                $scored += [PSCustomObject]@{
                    Hwnd = $w.Hwnd
                    Score = $score
                    Title = $w.Title
                    Process = $w.Process
                }
            }
        }

        if ($scored.Count -gt 0) {
            $best = $scored | Sort-Object Score -Descending | Select-Object -First 1
            return [IntPtr]$best.Hwnd
        }
    }

    # Fallback to foreground
    return $fg
}

# ═════════════════════════════════════════════════════════════════════════════
# ACTION: read_foreground
#
# Reads the ACTUAL foreground window's visible content.
#
# Separation of concerns (each step is a distinct, independently verifiable fact):
#   1. Foreground identification  — GetForegroundWindow() ONLY. No window search,
#      no token scoring over window titles, no application launching, no task lookup.
#   2. Window geometry            — window rect vs CLIENT rect, expressed in screen
#      coordinates, so the non-client band (title bar / caption buttons / borders)
#      is a known rectangle rather than a guess.
#   3. UI tree extraction         — UIA descendants of the CONTENT root.
#   4. Content extraction         — non-client chrome is excluded by GEOMETRY
#      (any element whose bounding box lies outside the client area) and by control
#      type (TitleBar / MenuBar / ScrollBar / Thumb / Separator). The window title is
#      reported as identity metadata and is NEVER injected into the content text.
#   5. Screenshot                 — captured for the vision fallback; on its own it
#      is never presented as extracted content.
#
# reason codes distinguish "nothing to read" from "cannot read this window".
# ═════════════════════════════════════════════════════════════════════════════
if ($Action -eq 'read_foreground') {
    # Production ALWAYS reads the true foreground window. An explicit -Hwnd is
    # accepted only for non-destructive diagnostics against an already-open
    # window; the voice path never passes it.
    $fgHwnd = if ($Hwnd -gt 0) { [IntPtr]$Hwnd } else { [DesktopPerceptionHelper]::GetForegroundWindow() }
    $reason = ""

    if ($fgHwnd -eq [IntPtr]::Zero) { $reason = "no_foreground_window" }
    elseif (-not [DesktopPerceptionHelper]::IsWindowVisible($fgHwnd)) { $reason = "foreground_not_visible" }
    elseif ([DesktopPerceptionHelper]::IsIconic($fgHwnd)) { $reason = "foreground_minimised" }

    $title = ""
    $cls = ""
    $procName = ""
    $fgPid = [uint32]0

    if ($reason -eq "") {
        $sbT = New-Object System.Text.StringBuilder 512
        [DesktopPerceptionHelper]::GetWindowText($fgHwnd, $sbT, 512) | Out-Null
        $title = $sbT.ToString()

        $sbC = New-Object System.Text.StringBuilder 256
        [DesktopPerceptionHelper]::GetClassName($fgHwnd, $sbC, 256) | Out-Null
        $cls = $sbC.ToString()

        [DesktopPerceptionHelper]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid) | Out-Null
        try { $procName = [System.Diagnostics.Process]::GetProcessById([int]$fgPid).ProcessName } catch {}

        # Reading our own UI is never what the user means by "my screen". This
        # covers the AgenticOS/Electron shell, the Hermes desktop runtime the
        # agent itself runs inside, the AntiGravity IDE and the computer-use
        # overlay: none of them are the intended target.
        $selfProcesses = '^(?i:agenticos|electron|hermes-agent|hermes|antigravity|antigravity ide|cua-driver)$'
        if ($procName -match $selfProcesses -or $title -like '*AgenticOS*' -or $title -like '*Hermes One*') {
            $reason = "foreground_is_agenticos"
        }
    }

    if ($reason -ne "") {
        [PSCustomObject]@{
            success     = $false
            action      = "read_foreground"
            reason      = $reason
            hwnd        = if ($fgHwnd) { $fgHwnd.ToInt64() } else { 0 }
            windowTitle = $title
            process     = $procName
        } | ConvertTo-Json -Compress
        exit 0
    }

    # ── 2. Geometry: separate client area from non-client chrome ────────────
    $winRect = New-Object DesktopPerceptionHelper+RECT
    [DesktopPerceptionHelper]::GetWindowRect($fgHwnd, [ref]$winRect) | Out-Null
    $cliRect = New-Object DesktopPerceptionHelper+RECT
    [DesktopPerceptionHelper]::GetClientRect($fgHwnd, [ref]$cliRect) | Out-Null
    $origin = New-Object DesktopPerceptionHelper+POINT
    $origin.X = 0
    $origin.Y = 0
    [DesktopPerceptionHelper]::ClientToScreen($fgHwnd, [ref]$origin) | Out-Null

    $clientLeft   = $origin.X
    $clientTop    = $origin.Y
    $clientRight  = $origin.X + ($cliRect.Right - $cliRect.Left)
    $clientBottom = $origin.Y + ($cliRect.Bottom - $cliRect.Top)
    $nonClientTopPx = $clientTop - $winRect.Top

    # ── 3. Content root: prefer the Chromium/Electron render widget host ────
    $contentRoot = $null
    foreach ($cHwnd in [DesktopPerceptionHelper]::FindChildWindows($fgHwnd)) {
        $ccs = New-Object System.Text.StringBuilder 256
        [DesktopPerceptionHelper]::GetClassName($cHwnd, $ccs, 256) | Out-Null
        if ($ccs.ToString() -eq "Chrome_RenderWidgetHostHWND") {
            try {
                $r = [System.Windows.Automation.AutomationElement]::FromHandle($cHwnd)
                if ($r) { $contentRoot = $r; break }
            } catch {}
        }
    }
    if (-not $contentRoot) {
        try { $contentRoot = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd) } catch {}
    }

    # ── 4. Content-first, content-type-aware extraction ─────────────────────
    #
    # C1: .Name is the ACCESSIBILITY label. It is visible text only for
    #     content-bearing types; for Button/MenuItem/TabItem it is chrome.
    # C2: for Chromium/Electron ClientRect == WindowRect (NonClientTop = 0), so
    #     geometry cannot separate chrome. Type + pattern provenance must.
    # C4: chrome appears before content in tree order, so content types are
    #     collected into their own bucket and can never be crowded out.
    $contentTypes = @('ControlType.Document', 'ControlType.Edit', 'ControlType.Text')
    $secondaryContentTypes = @('ControlType.DataItem', 'ControlType.TreeItem', 'ControlType.ListItem')
    $chromeTypes = @(
        'ControlType.Button', 'ControlType.MenuItem', 'ControlType.TabItem',
        'ControlType.Hyperlink', 'ControlType.ToolBar', 'ControlType.MenuBar',
        'ControlType.TitleBar', 'ControlType.ScrollBar', 'ControlType.Thumb',
        'ControlType.Separator', 'ControlType.Group', 'ControlType.Pane'
    )
    # Caption controls, EN + DE, as a belt-and-braces filter.
    $skipNames = '^(?i:minimi[sz]e|maximi[sz]e|restore|close|system|minimieren|maximieren|wiederherstellen|schliessen|schließen)$'

    $enumCap = 4000
    $contentCap = 400
    $chromeCap = 120
    $descendantCount = 0
    $geometryFiltered = 0
    $textPatternHits = 0
    $valuePatternHits = 0
    $textPatternChars = 0
    $valuePatternChars = 0
    $contentCount = 0
    $chromeCount = 0
    $typeCounts = @{}
    $records = @()
    $seenRecords = @{}

    if ($contentRoot) {
        try {
            $descendants = $contentRoot.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition)

            foreach ($d in $descendants) {
                $descendantCount++
                if ($descendantCount -gt $enumCap) { break }

                $ct = $d.Current.ControlType.ProgrammaticName
                $short = $ct -replace '^ControlType\.', ''
                if (-not $typeCounts.ContainsKey($short)) { $typeCounts[$short] = 0 }
                $typeCounts[$short]++

                $isContent = $contentTypes -contains $ct
                $isSecondary = $secondaryContentTypes -contains $ct
                $isChrome = $chromeTypes -contains $ct
                if (-not ($isContent -or $isSecondary -or $isChrome)) { continue }

                $name = [string]$d.Current.Name
                if ($name -and $name -match $skipNames) { $geometryFiltered++; continue }

                # Geometry is a SECONDARY signal only (C2): it still catches
                # classic Win32 non-client chrome, and is expected to filter
                # nothing at all for Chromium/Electron.
                $b = $d.Current.BoundingRectangle
                if (-not $b.IsEmpty -and $b.Width -gt 1 -and $b.Height -gt 1) {
                    if ($b.Bottom -le $clientTop -or $b.Top -ge $clientBottom -or
                        $b.Right -le $clientLeft -or $b.Left -ge $clientRight) {
                        $geometryFiltered++
                        if (-not $isContent) { continue }
                    }
                }

                $bucket = 'chrome'
                $text = ""
                $pattern = "name"

                if ($isContent) {
                    $bucket = 'content'
                    if ($contentCount -ge $contentCap) { continue }

                    # Document / Text -> TextPattern carries the real visible text.
                    if ($ct -eq 'ControlType.Document' -or $ct -eq 'ControlType.Text') {
                        try {
                            $tp = $d.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
                            if ($tp) {
                                $t = $tp.DocumentRange.GetText(-1)
                                if ($t -and $t.Trim()) {
                                    $text = $t
                                    $pattern = "textpattern"
                                    $textPatternHits++
                                    $textPatternChars += $t.Trim().Length
                                }
                            }
                        } catch {}
                    }
                    # Edit (and Document without TextPattern) -> ValuePattern.
                    if (-not $text) {
                        try {
                            $vp = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                            if ($vp -and $vp.Current.Value -and $vp.Current.Value.Trim()) {
                                $text = $vp.Current.Value
                                $pattern = "valuepattern"
                                $valuePatternHits++
                                $valuePatternChars += $vp.Current.Value.Trim().Length
                            }
                        } catch {}
                    }
                    # Text elements, and any content element with no pattern.
                    if (-not $text -and $name) { $text = $name }
                }
                elseif ($isSecondary) {
                    $bucket = 'content'
                    if ($contentCount -ge $contentCap) { continue }
                    $text = $name
                    if (-not $text) {
                        try {
                            $vp = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                            if ($vp) { $text = $vp.Current.Value; $valuePatternHits++; $valuePatternChars += ([string]$text).Trim().Length }
                        } catch {}
                    }
                }
                else {
                    if ($chromeCount -ge $chromeCap) { continue }
                    $text = $name
                }

                if (-not $text) { continue }
                $clean = ($text -replace '[\r\n\t\x00-\x1F]', ' ').Trim()
                # U+FFFC/U+FFFD are object placeholders, not text.
                $clean = ($clean -replace '[\uFFFC\uFFFD]', '').Trim()
                if (-not $clean) { continue }

                $key = "$bucket|$clean"
                if ($seenRecords.ContainsKey($key)) { continue }
                $seenRecords[$key] = $true

                if ($bucket -eq 'content') { $contentCount++ } else { $chromeCount++ }
                $records += [PSCustomObject]@{
                    bucket  = $bucket
                    type    = $short
                    pattern = $pattern
                    chars   = $clean.Length
                    text    = $clean
                }
            }
        } catch {}
    }

    $contentItems = @($records | Where-Object { $_.bucket -eq 'content' })
    $chromeItems  = @($records | Where-Object { $_.bucket -eq 'chrome' })

    # C1 (continued): navigation labels must not reach the answer. Two shapes
    # occur in practice:
    #   (a) an element whose entire text IS a navigation label, and
    #   (b) one big Text node in which Chromium concatenates the menu bar with
    #       the real page content.
    # (a) is dropped outright. (b) is filtered by removing maximal runs of tokens
    # that match labels found in THIS window's chrome bucket — window-local
    # evidence only, never a per-application or per-language word list.
    $chromeLabelSet = @{}
    foreach ($c in $chromeItems) { $chromeLabelSet[$c.text.ToLowerInvariant()] = $true }

    $chromePhrases = @{}
    $maxPhraseTokens = 1
    foreach ($k in $chromeLabelSet.Keys) {
        if (-not $k) { continue }
        $toks = @($k -split '\s+' | Where-Object { $_ })
        if ($toks.Count -lt 1 -or $toks.Count -gt 4) { continue }
        $chromePhrases[($toks -join ' ')] = $true
        if ($toks.Count -gt $maxPhraseTokens) { $maxPhraseTokens = $toks.Count }
    }
    # ASCII-only literals: PowerShell 5.1 reads this file as ANSI, so non-ASCII
    # characters in source would be mis-decoded. En/em dashes by codepoint.
    $trimChars = [char[]]@('.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '"', "'", '-', ' ')
    $trimChars += [char]0x2013
    $trimChars += [char]0x2014

    $chromeLabelSuppressed = 0
    $keptContent = @()
    foreach ($c in $contentItems) {
        if ($chromeLabelSet.ContainsKey($c.text.ToLowerInvariant()) -and $c.chars -le 60) {
            $chromeLabelSuppressed++
            continue
        }

        $tokens = @($c.text -split '\s+' | Where-Object { $_ })
        if ($tokens.Count -gt 1) {
            $kept = @()
            $i = 0
            while ($i -lt $tokens.Count) {
                $matched = 0
                $upper = $maxPhraseTokens
                if ($upper -gt ($tokens.Count - $i)) { $upper = $tokens.Count - $i }
                for ($n = $upper; $n -ge 1; $n--) {
                    $cand = (($tokens[$i..($i + $n - 1)] -join ' ')).Trim($trimChars).ToLowerInvariant()
                    if ($cand -and $chromePhrases.ContainsKey($cand)) { $matched = $n; break }
                }
                if ($matched -gt 0) { $i += $matched; $chromeLabelSuppressed++ }
                else { $kept += $tokens[$i]; $i++ }
            }
            if ($kept.Count -eq 0) { $chromeLabelSuppressed++; continue }
            $c.text = ($kept -join ' ')
            $c.chars = $c.text.Length
        }
        $keptContent += $c
    }
    $contentItems = $keptContent

    $contentText = (($contentItems | ForEach-Object { $_.text }) -join " `n ") -replace '[\x00-\x09\x0B\x0C\x0E-\x1F]', ' '
    $chromeText  = (($chromeItems  | ForEach-Object { $_.text }) -join " `n ") -replace '[\x00-\x09\x0B\x0C\x0E-\x1F]', ' '

    # ── 5. Screenshot for the vision fallback (never claimed as text) ───────
    $shot = $null
    if ($OutScreenshotPath) {
        $oW = 0
        $oH = 0
        $capOk = [DesktopPerceptionHelper]::CaptureHwnd($fgHwnd, $OutScreenshotPath, [ref]$oW, [ref]$oH)
        if ($capOk -and (Test-Path $OutScreenshotPath) -and (Get-Item $OutScreenshotPath).Length -gt 1024) {
            $shot = @{
                success      = $true
                width        = $oW
                height       = $oH
                artifactPath = $OutScreenshotPath
                sha256       = (Get-FileHash -Path $OutScreenshotPath -Algorithm SHA256).Hash.ToLower()
                byteSize     = (Get-Item $OutScreenshotPath).Length
            }
        }
    }

    [PSCustomObject]@{
        success              = $true
        action               = "read_foreground"
        hwnd                 = $fgHwnd.ToInt64()
        windowTitle          = $title
        windowClass          = $cls
        process              = $procName
        pid                  = [int]$fgPid
        method               = if ($contentRoot) { "uia" } else { "none" }
        text                 = $contentText
        contentText          = $contentText
        chromeText           = $chromeText
        contentChars         = $contentText.Length
        chromeChars          = $chromeText.Length
        contentElementCount  = $contentItems.Count
        chromeElementCount   = $chromeItems.Count
        controlCount         = $contentItems.Count
        textPatternHits      = $textPatternHits
        valuePatternHits     = $valuePatternHits
        textPatternChars     = $textPatternChars
        valuePatternChars    = $valuePatternChars
        chromeLabelSuppressedCount = $chromeLabelSuppressed
        geometryFilteredCount = $geometryFiltered
        chromeFilteredCount  = $geometryFiltered
        totalDescendants     = $descendantCount
        controlTypesSeen     = $typeCounts
        contentElements      = ($contentItems | Select-Object -First 40)
        chromeElements       = ($chromeItems  | Select-Object -First 40)
        geometry             = @{
            windowRect     = @{ left = $winRect.Left; top = $winRect.Top; right = $winRect.Right; bottom = $winRect.Bottom }
            clientRect     = @{ left = $clientLeft; top = $clientTop; right = $clientRight; bottom = $clientBottom }
            nonClientTopPx = $nonClientTopPx
        }
        screenshot           = $shot
        confidence           = 0.9
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
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

$winProcId = [uint32]0
[DesktopPerceptionHelper]::GetWindowThreadProcessId($targetHwnd, [ref]$winProcId) | Out-Null
$processName = ""
try { $processName = [System.Diagnostics.Process]::GetProcessById([int]$winProcId).ProcessName } catch {}

# Capture Screenshot if requested
$screenshotInfo = $null
if ($OutScreenshotPath) {
    $outW = 0
    $outH = 0
    $capSuccess = [DesktopPerceptionHelper]::CaptureHwnd($targetHwnd, $OutScreenshotPath, [ref]$outW, [ref]$outH)
    if (-not $capSuccess -or -not (Test-Path $OutScreenshotPath) -or (Get-Item $OutScreenshotPath).Length -le 1024) {
        # Fallback to Progman or prominent window
        $fallbackWin = $allWindows | Where-Object { $_.ClassName -eq "Progman" -or ($_.Width -ge 400 -and $_.Height -ge 300) } | Select-Object -First 1
        if ($fallbackWin) {
            $capSuccess = [DesktopPerceptionHelper]::CaptureHwnd([IntPtr]$fallbackWin.Hwnd, $OutScreenshotPath, [ref]$outW, [ref]$outH)
            $targetHwnd = [IntPtr]$fallbackWin.Hwnd
        }
    }
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
            if ($extractedControls.Count -ge 200) { break }
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
    $clean = ($t.Trim() -replace '[\r\n\t\x00-\x1F]', ' ').Trim()
    if ($clean -and -not $seen.ContainsKey($clean)) {
        $seen[$clean] = $true
        $uniqueTexts += $clean
    }
}

$fullText = ($uniqueTexts -join " `n ") -replace '[\x00-\x09\x0B\x0C\x0E-\x1F]', ' '

$resultObj = [PSCustomObject]@{
    success = $true
    hwnd = $targetHwnd.ToInt64()
    windowTitle = $windowTitle
    windowClass = $windowClass
    process = $processName
    pid = [int]$winProcId
    method = $method
    text = $fullText
    controlCount = $extractedControls.Count
    controls = ($extractedControls | Select-Object -First 50)
    screenshot = $screenshotInfo
    confidence = if ($fullText.Length -gt 20) { 0.95 } else { 0.75 }
}

$resultObj | ConvertTo-Json -Depth 5 -Compress

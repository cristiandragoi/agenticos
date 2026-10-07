param(
    [string]$TargetChat = "Agentic OS bot",
    [string]$BotUsername = "Hermes_Cris_bot"
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue

# 1. Ensure Telegram is running
$tgProc = Get-Process -Name Telegram -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $tgProc) {
    $tgPath = "$env:APPDATA\Telegram Desktop\Telegram.exe"
    if (Test-Path $tgPath) {
        Start-Process -FilePath $tgPath
        for ($i = 0; $i -lt 10; $i++) {
            Start-Sleep -Milliseconds 100
            $tgProc = Get-Process -Name Telegram -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($tgProc -and $tgProc.MainWindowHandle -ne 0) { break }
        }
    }
}

if (-not $tgProc) {
    @{ success = $false; verifiedSelectedChat = $false; error = "Telegram process not found." } | ConvertTo-Json -Compress
    exit 0
}

# 2. Native Win32 Helper
$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Helper {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

[Win32Helper]::ShowWindow($tgProc.MainWindowHandle, 9) | Out-Null
[Win32Helper]::SetForegroundWindow($tgProc.MainWindowHandle) | Out-Null
[Win32Helper]::SwitchToThisWindow($tgProc.MainWindowHandle, $true) | Out-Null

function Get-TgTitle {
    $sb = New-Object System.Text.StringBuilder 512
    [Win32Helper]::GetWindowText($tgProc.MainWindowHandle, $sb, 512) | Out-Null
    return $sb.ToString()
}

$cleanBot = $BotUsername -replace '^@',''
$cleanTarget = $TargetChat -replace '\s+bot$',''

# In-process Chat Verification (0ms title check + fast in-process UIA fallback)
function Check-ChatSelected {
    $title = Get-TgTitle
    if ($title -match "Agentic\s*OS|Hermes|$cleanBot|$cleanTarget") {
        return $true
    }

    # In-process UIA inspection (no child powershell spawn)
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($tgProc.MainWindowHandle)
        if ($root) {
            $nameCond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty,
                $TargetChat
            )
            $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)
            if ($found) { return $true }

            # Also check for bot username
            $botCond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty,
                $cleanBot
            )
            $foundBot = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $botCond)
            if ($foundBot) { return $true }
        }
    } catch {}

    return $false
}

# 3. Check if chat is already selected
$isChatSelected = Check-ChatSelected
if ($isChatSelected) {
    @{
        success = $true
        verifiedSelectedChat = $true
        application = "Telegram"
        target = $TargetChat
        botUsername = $cleanBot
    } | ConvertTo-Json -Compress
    exit 0
}

# 4. Attempt: invoke tg protocol and poll window title
if ($cleanBot) {
    Start-Process "tg://resolve?domain=$cleanBot" -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 6; $i++) {
        Start-Sleep -Milliseconds 50
        if (Check-ChatSelected) {
            $isChatSelected = $true
            break
        }
    }
}

# 5. If not yet selected, use Quick Search in Telegram Desktop
if (-not $isChatSelected) {
    [Win32Helper]::SetForegroundWindow($tgProc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 50
    [System.Windows.Forms.SendKeys]::SendWait('^k')
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait($cleanBot)
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 150

    $isChatSelected = Check-ChatSelected
}

# 6. If still not selected, try search for "Agentic OS"
if (-not $isChatSelected) {
    [Win32Helper]::SetForegroundWindow($tgProc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 50
    [System.Windows.Forms.SendKeys]::SendWait('^k')
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait('Agentic OS')
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 150

    $isChatSelected = Check-ChatSelected
}

@{
    success = $true
    verifiedSelectedChat = $isChatSelected
    application = "Telegram"
    target = $TargetChat
    botUsername = $cleanBot
} | ConvertTo-Json -Compress

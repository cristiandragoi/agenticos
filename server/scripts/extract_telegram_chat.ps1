param(
    [long]$Hwnd = 0
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$targetHwnd = [IntPtr]$Hwnd
$root = $null
try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd)
} catch {
    # If top-level throws, find through Desktop element
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$Hwnd)
    $root = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}

if (-not $root) {
    [PSCustomObject]@{ success = $false; error = "Window root not found" } | ConvertTo-Json
    exit 0
}

$listCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::List)
$lists = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCond)

$msgList = $null
foreach ($l in $lists) {
    if ($l.Current.Name -eq 'Messages') { $msgList = $l; break }
}
if (-not $msgList -and $lists.Count -gt 0) { $msgList = $lists[0] }

if (-not $msgList) {
    [PSCustomObject]@{ success = $false; error = "Messages list control not found" } | ConvertTo-Json
    exit 0
}

$itemCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
$items = $msgList.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)

$parsed = @()
foreach ($it in $items) {
    $rect = $it.Current.BoundingRectangle
    $autoId = $it.Current.AutomationId
    $name = $it.Current.Name
    
    $sender = ''
    $text = ''
    $time = ''
    
    $dataCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::DataItem)
    $dataItems = $it.FindAll([System.Windows.Automation.TreeScope]::Children, $dataCond)
    foreach ($d in $dataItems) {
        $dn = $d.Current.Name
        $dv = $d.Current.Value
        if ($dn -eq 'Sender' -and $dv) { $sender = $dv }
        elseif ($dn -eq 'Message' -and $dv) { $text = $dv }
        elseif ($dn -eq 'Time' -and $dv) { $time = $dv }
    }
    
    if (-not $text -and $name) {
        $lines = $name.Split("`n").Trim() | Where-Object { $_ }
        if ($lines.Count -ge 2) {
            if ($lines[0] -eq 'Seen' -and $lines[1] -eq 'Me') {
                $sender = 'Me'
                $time = $lines[-1]
                $text = ($lines[2..($lines.Count - 2)]) -join ' '
            } else {
                $sender = $lines[0]
                $time = $lines[-1]
                $text = ($lines[1..($lines.Count - 2)]) -join ' '
            }
        }
    }
    
    # Strip reply quotes if present: "In reply to Cristian D.: \u200e\u2068...\u2069\nActual message"
    if ($text -match 'In reply to [^:]+:\s*[\u200e\u2068]?[^\u2069]*[\u2069]?\s*(.*)') {
        $text = $Matches[1].Trim()
    }
    
    # Defensive filter: ignore if text is identical to sender (sender header artifact)
    if ($text -and ($sender.Trim().ToLower() -ne $text.Trim().ToLower())) {
        $parsed += [PSCustomObject]@{
            autoId = $autoId
            top = [int]$rect.Top
            left = [int]$rect.Left
            width = [int]$rect.Width
            height = [int]$rect.Height
            sender = $sender
            text = $text
            time = $time
        }
    }
}

# Sort chronologically by vertical screen position (top to bottom)
$sorted = $parsed | Sort-Object -Property top

[PSCustomObject]@{
    success = $true
    count = $sorted.Count
    messages = $sorted
} | ConvertTo-Json -Depth 4

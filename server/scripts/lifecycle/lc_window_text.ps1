# Read-only probe: text content of a window via UI Automation (Document/Edit controls).
# Output: JSON { hwnd, found, title, texts: [ ... ] }
param([Parameter(Mandatory=$true)][long]$Hwnd)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$result = [ordered]@{ hwnd = $Hwnd; found = $false; title = ''; texts = @() }
try {
  $el = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
  if ($el) {
    $result.found = $true
    $result.title = $el.Current.Name
    $cond = New-Object System.Windows.Automation.OrCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    $nodes = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $texts = @()
    foreach ($n in $nodes) {
      $t = $null
      try {
        $tp = $n.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        if ($tp) { $t = $tp.DocumentRange.GetText(-1) }
      } catch {}
      if ($null -eq $t) {
        try {
          $vp = $n.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          if ($vp) { $t = $vp.Current.Value }
        } catch {}
      }
      if ($null -ne $t) { $texts += [string]$t }
    }
    $result.texts = @($texts)
  }
} catch { $result.error = $_.Exception.Message }
[pscustomobject]$result | ConvertTo-Json -Depth 4 -Compress

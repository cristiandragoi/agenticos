# Executor helper: start an application. Reports only what it did (receipt).
param([Parameter(Mandatory=$true)][string]$Target, [string]$Kind = 'path')
$ErrorActionPreference = 'Stop'
$r = [ordered]@{ started = $false; pid = $null; kind = $Kind; target = $Target }
try {
  if ($Kind -eq 'aumid') {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ("shell:AppsFolder\" + $Target) | Out-Null
    $r.started = $true
  } else {
    $p = Start-Process -FilePath $Target -PassThru
    $r.started = $true
    if ($p) { $r.pid = $p.Id }
  }
} catch { $r.error = $_.Exception.Message }
[pscustomobject]$r | ConvertTo-Json -Compress

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServerRoot = Join-Path $RepoRoot 'server'
$AgentDir = Join-Path $RepoRoot '.agentos'
$LogDir = Join-Path $AgentDir 'logs'
$ProcessFile = Join-Path $AgentDir 'dev-processes.json'
$BackendPort = 4600
$FrontendPort = 5173
$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"
$BackendHealthUrl = "$BackendUrl/api/health"
$BackendLog = Join-Path $LogDir 'backend-dev.log'
$ViteLog = Join-Path $LogDir 'vite-dev.log'
$ElectronLog = Join-Path $LogDir 'electron-dev.log'
$RendererBuildTimestamp = (Get-Date).ToString('o')
try {
  $GitShortHash = (git -C $RepoRoot rev-parse --short HEAD 2>$null).Trim()
} catch {
  $GitShortHash = 'nogit'
}
$RendererBuildId = "$GitShortHash-$($RendererBuildTimestamp -replace '[:.]','-')"
$ElectronRoute = '#/jarvis'
$ElectronRemoteDebuggingPort = 9223

function Write-Stage([string]$Message) {
  Write-Host "[AgenticOS] $Message"
}

function Ensure-AgentDirs {
  New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

function Get-ProcessInfo([int]$TargetPid) {
  try {
    Get-CimInstance Win32_Process -Filter "ProcessId = $TargetPid" -ErrorAction Stop
  } catch {
    $process = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    [pscustomobject]@{
      ProcessId = $TargetPid
      ParentProcessId = 0
      Name = $process.ProcessName
      CommandLine = ''
      ExecutablePath = $process.Path
    }
  }
}

function Get-PortOwner([int]$Port) {
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) {
    $line = @(netstat -ano | Select-String "[:.]$Port\s+.*LISTENING" | Select-Object -First 1)
    if ($line.Count -eq 0) { return $null }
    $parts = ($line[0].Line -split '\s+') | Where-Object { $_ }
    if ($parts.Count -lt 5) { return $null }
    return Get-ProcessInfo ([int]$parts[-1])
  }
  $pidValue = [int]$connections[0].OwningProcess
  if (-not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { return $null }
  Get-ProcessInfo $pidValue
}

function Test-AgenticProcess($Proc) {
  if (-not $Proc) { return $false }
  $repoPattern = [regex]::Escape($RepoRoot)
  $current = $Proc
  for ($i = 0; $i -lt 8 -and $current; $i++) {
    $cmd = [string]$current.CommandLine
    $path = [string]$current.ExecutablePath
    if ($path -and $path -match $repoPattern) {
      return $true
    }
    if ($cmd -and $cmd -match $repoPattern -and (
      $cmd -match 'server\\dist\\index\.js' -or
      $cmd -match 'npm(\.cmd)?\s+run\s+dev' -or
      $cmd -match 'vite' -or
      $cmd -match 'electron' -or
      $cmd -match 'dist-electron\\main\.js' -or
      $cmd -match 'AGENTICOS_EXTERNAL_SERVERS' -or
      $cmd -match 'AGENTICOS_REPO_ROOT' -or
      $cmd -match '\\.agentos\\(backend|vite|electron)-runner\.ps1'
    )) {
      return $true
    }
    if (-not $current.ParentProcessId -or $current.ParentProcessId -eq 0) { break }
    $current = Get-ProcessInfo ([int]$current.ParentProcessId)
  }
  return $false
}

function Test-LegacyAgenticBackendAncestry($Proc) {
  if (-not $Proc) { return $false }
  $cmd = [string]$Proc.CommandLine
  if ($Proc.Name -notmatch '^node(\.exe)?$' -or $cmd -notmatch '(^|\s)node\s+dist/index\.js(\s|$)') {
    return $false
  }

  $parent = Get-ProcessInfo ([int]$Proc.ParentProcessId)
  if (-not $parent) { return $false }
  $parentCmd = [string]$parent.CommandLine
  if ($parent.Name -notmatch '^cmd(\.exe)?$' -or $parentCmd -notmatch 'tsc\s*&&\s*node\s+dist/index\.js') {
    return $false
  }

  $grandparent = Get-ProcessInfo ([int]$parent.ParentProcessId)
  if (-not $grandparent) { return $false }
  $grandparentCmd = [string]$grandparent.CommandLine
  return $grandparentCmd -match 'npm-cli\.js\s+run\s+dev'
}

function Test-AgenticBackendHealth([int]$Port) {
  if ($Port -ne $BackendPort) { return $false }
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
    $conversations = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/jarvis/conversations" -UseBasicParsing -TimeoutSec 3
    return $health.StatusCode -eq 200 -and
      $conversations.StatusCode -eq 200 -and
      $health.Content -match '"status"\s*:\s*"healthy"' -and
      $health.Content -match '"environment"\s*:\s*"development"' -and
      $conversations.Content -match '"id"\s*:\s*"conv-'
  } catch {
    return $false
  }
}

function Assert-PortFreeOrAgentic([int]$Port) {
  $owner = Get-PortOwner $Port
  if (-not $owner) { return }
  if ((Test-AgenticProcess $owner) -or
      ((Test-LegacyAgenticBackendAncestry $owner) -and (Test-AgenticBackendHealth $Port)) -or
      ($Port -eq $BackendPort -and $owner.Name -match '^node(\.exe)?$' -and (Test-AgenticBackendHealth $Port))) { return }
  throw "Port $Port is in use by unrelated process PID $($owner.ProcessId): $($owner.CommandLine)"
}

function Get-ViteUrlFromLog([string]$LogFile) {
  if (-not (Test-Path $LogFile)) { return $null }
  $text = Get-Content $LogFile -Raw -ErrorAction SilentlyContinue
  if ($null -eq $text) { $text = '' }
  $escape = [string][char]27
  $text = [regex]::Replace($text, "$([regex]::Escape($escape))\[[0-9;]*[A-Za-z]", '')
  $text = [regex]::Replace($text, '\s+', '')
  $match = [regex]::Match($text, 'http://127\.0\.0\.1:(\d+)/?')
  if ($match.Success) { return $match.Value.TrimEnd('/') }
  $match = [regex]::Match($text, 'http://localhost:(\d+)/?')
  if ($match.Success) {
    return "http://127.0.0.1:$($match.Groups[1].Value)"
  }
  return $null
}

function Wait-ViteReady([string]$LogFile, [int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastUrl = $null
  while ((Get-Date) -lt $deadline) {
    $lastUrl = Get-ViteUrlFromLog $LogFile
    if ($lastUrl) {
      try {
        $response = Invoke-WebRequest -Uri $lastUrl -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
          return $lastUrl
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 750
  }
  $tail = ''
  if (Test-Path $LogFile) {
    $tail = (Get-Content $LogFile -Tail 80 -ErrorAction SilentlyContinue) -join "`n"
  }
  throw "Vite startup failed waiting for dev server URL. Last URL: $lastUrl`nRelevant log: $LogFile`n$tail"
}

function Wait-HttpReady([string]$Url, [string]$Stage, [string]$LogFile, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 750
  }

  $tail = ''
  if (Test-Path $LogFile) {
    $tail = (Get-Content $LogFile -Tail 60 -ErrorAction SilentlyContinue) -join "`n"
  }
  throw "$Stage failed waiting for $Url. Last error: $lastError`nRelevant log: $LogFile`n$tail"
}

function Start-LoggedPowerShell([string]$Name, [string]$WorkingDirectory, [string]$Command, [string]$LogFile) {
  if (Test-Path $LogFile) {
    Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType File -Force -Path $LogFile | Out-Null

  $logLiteral = $LogFile.Replace("'", "''")
  $runnerName = "$($Name.ToLowerInvariant())-runner.ps1"
  $runnerPath = Join-Path $AgentDir $runnerName
  $runnerContent = @"
& {
  `$ErrorActionPreference = 'Stop'
  Set-Location -LiteralPath '$($WorkingDirectory.Replace("'", "''"))'
  `$env:AGENTICOS_REPO_ROOT='$($RepoRoot.Replace("'", "''"))'
  try {
$Command
    if (`$null -ne `$LASTEXITCODE -and `$LASTEXITCODE -ne 0) {
      exit `$LASTEXITCODE
    }
  } catch {
    Write-Error `$_.Exception.Message
    exit 1
  }
} *>> '$logLiteral'
exit `$LASTEXITCODE
"@
  Set-Content -LiteralPath $runnerPath -Value $runnerContent -Encoding UTF8

  $proc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runnerPath) `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden `
    -PassThru

  if (-not $proc -or $proc.HasExited) {
    throw "$Name failed to start. Exit code: $($proc.ExitCode). Relevant log: $LogFile"
  }

  return $proc
}

function Write-ProcessRecord([int]$BackendPid, [int]$VitePid, [int]$ElectronPid, [int]$ActualFrontendPort, [string]$ActualFrontendUrl) {
  $record = [ordered]@{
    backendPid = $BackendPid
    vitePid = $VitePid
    electronPid = $ElectronPid
    backendPort = $BackendPort
    frontendPort = $ActualFrontendPort
    frontendUrl = $ActualFrontendUrl
    startupTime = (Get-Date).ToString('o')
  }
  $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ProcessFile -Encoding UTF8
}

function Stop-StartedProcesses {
  try {
    & (Join-Path $PSScriptRoot 'stop-dev.ps1')
  } catch {
    Write-Host "[AgenticOS] Cleanup warning: $($_.Exception.Message)"
  }
}

Ensure-AgentDirs

Write-Stage 'Cleaning previous development processes'
& (Join-Path $PSScriptRoot 'stop-dev.ps1')

Assert-PortFreeOrAgentic $BackendPort
try {
  Assert-PortFreeOrAgentic $FrontendPort
} catch {
  Write-Host "[AgenticOS] Port $FrontendPort is unavailable; Vite will choose the next available port."
}

Write-Stage 'Starting backend'
$backendCommand = @"
`$env:PORT='4600'
`$env:NODE_ENV='development'
`$env:AGENTICOS_REPO_ROOT='$($RepoRoot.Replace("'", "''"))'
npm.cmd run dev
"@
$backendProc = Start-LoggedPowerShell 'backend' $ServerRoot $backendCommand $BackendLog

try {
  Wait-HttpReady $BackendHealthUrl 'Backend startup' $BackendLog 90 | Out-Null
} catch {
  Write-Host "[AgenticOS] Backend failed. Exit code: $($backendProc.ExitCode). Relevant log: $BackendLog"
  Stop-StartedProcesses
  throw
}
Write-Stage "Backend ready on $BackendUrl"
$backendOwner = Get-PortOwner $BackendPort
$backendPidToTrack = $backendProc.Id
if ($backendOwner) { $backendPidToTrack = [int]$backendOwner.ProcessId }
Write-ProcessRecord $backendPidToTrack 0 0 $FrontendPort $FrontendUrl

Write-Stage 'Starting Vite'
$viteCommand = @"
`$env:VITE_WEB_ONLY='true'
`$env:BROWSER='none'
`$env:AGENTICOS_REPO_ROOT='$($RepoRoot.Replace("'", "''"))'
`$env:VITE_AGENTICOS_BUILD_ID='$RendererBuildId'
`$env:VITE_AGENTICOS_BUILD_TIMESTAMP='$RendererBuildTimestamp'
npm.cmd run dev -- --host 127.0.0.1 --port 5173
"@
$viteProc = Start-LoggedPowerShell 'Vite' $RepoRoot $viteCommand $ViteLog

try {
  $actualFrontendUrl = Wait-ViteReady $ViteLog 90
} catch {
  Write-Host "[AgenticOS] Vite failed. Exit code: $($viteProc.ExitCode). Relevant log: $ViteLog"
  Stop-StartedProcesses
  throw
}
$actualFrontendPort = [int]([regex]::Match($actualFrontendUrl, ':(\d+)$').Groups[1].Value)
Write-Stage "Frontend ready on $actualFrontendUrl"
$viteOwner = Get-PortOwner $actualFrontendPort
$vitePidToTrack = $viteProc.Id
if ($viteOwner) { $vitePidToTrack = [int]$viteOwner.ProcessId }
Write-ProcessRecord $backendPidToTrack $vitePidToTrack 0 $actualFrontendPort $actualFrontendUrl

Write-Stage 'Starting Electron'
$electronCommand = @"
`$env:AGENTICOS_EXTERNAL_SERVERS='true'
`$env:VITE_DEV_SERVER_URL='$actualFrontendUrl/'
`$env:AGENTICOS_REPO_ROOT='$($RepoRoot.Replace("'", "''"))'
`$env:AGENTICOS_ELECTRON_LOG='$($ElectronLog.Replace("'", "''"))'
`$env:AGENTICOS_ELECTRON_ROUTE='$ElectronRoute'
`$env:AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT='$ElectronRemoteDebuggingPort'
`$env:AGENTICOS_RENDERER_BUILD_ID='$RendererBuildId'
`$env:AGENTICOS_RENDERER_BUILD_TIMESTAMP='$RendererBuildTimestamp'
`$env:VITE_AGENTICOS_BUILD_ID='$RendererBuildId'
`$env:VITE_AGENTICOS_BUILD_TIMESTAMP='$RendererBuildTimestamp'
node_modules\.bin\electron.cmd .
"@
$electronProc = Start-LoggedPowerShell 'Electron' $RepoRoot $electronCommand $ElectronLog
Start-Sleep -Seconds 3
if ($electronProc.HasExited) {
  $tail = ''
  if (Test-Path $ElectronLog) {
    $tail = (Get-Content $ElectronLog -Tail 80 -ErrorAction SilentlyContinue) -join "`n"
  }
  Stop-StartedProcesses
  throw "Electron failed. Exit code: $($electronProc.ExitCode). Relevant log: $ElectronLog`n$tail"
}

Write-ProcessRecord $backendPidToTrack $vitePidToTrack $electronProc.Id $actualFrontendPort $actualFrontendUrl

$electronProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -match [regex]::Escape($RepoRoot) -and
    ($_.CommandLine -match 'electron' -or $_.CommandLine -match 'dist-electron\\main\.js' -or $_.CommandLine -match 'AGENTICOS_EXTERNAL_SERVERS')
  })
Write-Stage "AgenticOS Electron process count: $($electronProcesses.Count)"
Write-Stage "Electron renderer route: $ElectronRoute"
Write-Stage "Renderer build ID: $RendererBuildId"
Write-Stage "Renderer build timestamp: $RendererBuildTimestamp"
Write-Stage "Electron remote debugging: http://127.0.0.1:$ElectronRemoteDebuggingPort"

Write-Stage 'Development environment ready'
Write-Host "[AgenticOS] Logs:"
Write-Host "[AgenticOS]   Backend:  $BackendLog"
Write-Host "[AgenticOS]   Vite:     $ViteLog"
Write-Host "[AgenticOS]   Electron: $ElectronLog"

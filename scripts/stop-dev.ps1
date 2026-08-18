$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AgentDir = Join-Path $RepoRoot '.agentos'
$LogDir = Join-Path $AgentDir 'logs'
$ProcessFile = Join-Path $AgentDir 'dev-processes.json'
$BackendPort = 4600
$FrontendPort = 5173

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
  return ($grandparent.Name -notmatch '^node(\.exe)?$' -and $grandparentCmd -match 'npm-cli\.js\s+run\s+dev') -or
    ($grandparent.Name -match '^node(\.exe)?$' -and $grandparentCmd -match 'npm-cli\.js\s+run\s+dev')
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

function Get-ChildProcessIds([int]$ParentProcessId) {
  @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentProcessId" -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.ProcessId })
}

function Stop-ProcessTree([int]$TargetPid) {
  $proc = Get-ProcessInfo $TargetPid
  if (-not $proc) { return }

  foreach ($childPid in (Get-ChildProcessIds $TargetPid)) {
    Stop-ProcessTree $childPid
  }

  $live = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if ($live) {
    try {
      Stop-Process -Id $TargetPid -Force -ErrorAction Stop
    } catch {
      Write-Host "[AgenticOS] Process $TargetPid was already stopped"
    }
  }
}

function Stop-TrackedProcesses {
  if (-not (Test-Path $ProcessFile)) { return }

  try {
    $record = Get-Content $ProcessFile -Raw | ConvertFrom-Json
  } catch {
    Remove-Item -LiteralPath $ProcessFile -Force -ErrorAction SilentlyContinue
    return
  }

  $trustedPortPids = @{}
  if ($record.backendPid -and $record.backendPort) {
    $owner = Get-PortOwner ([int]$record.backendPort)
    if ($owner -and [int]$owner.ProcessId -eq [int]$record.backendPid) {
      $trustedPortPids[[int]$record.backendPid] = "backend port $($record.backendPort)"
    }
  }
  if ($record.vitePid -and $record.frontendPort) {
    $owner = Get-PortOwner ([int]$record.frontendPort)
    if ($owner -and [int]$owner.ProcessId -eq [int]$record.vitePid) {
      $trustedPortPids[[int]$record.vitePid] = "frontend port $($record.frontendPort)"
    }
  }

  foreach ($name in @('electronPid', 'vitePid', 'backendPid')) {
    $pidValue = $record.$name
    if ($pidValue) {
      $proc = Get-ProcessInfo ([int]$pidValue)
      if ($proc -and ((Test-AgenticProcess $proc) -or $trustedPortPids.ContainsKey([int]$pidValue))) {
        Write-Host "[AgenticOS] Stopping tracked $name $pidValue"
        Stop-ProcessTree ([int]$pidValue)
      }
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

function Stop-AgenticPortOwner([int]$Port, [bool]$Strict = $false) {
  $owner = Get-PortOwner $Port
  if (-not $owner) { return }

  if ((Test-AgenticProcess $owner) -or
      ((Test-LegacyAgenticBackendAncestry $owner) -and (Test-AgenticBackendHealth $Port)) -or
      ($Port -eq $BackendPort -and $owner.Name -match '^node(\.exe)?$' -and (Test-AgenticBackendHealth $Port))) {
    Write-Host "[AgenticOS] Releasing port $Port from PID $($owner.ProcessId)"
    Stop-ProcessTree ([int]$owner.ProcessId)
    return
  }

  $message = "Port $Port is in use by unrelated process PID $($owner.ProcessId): $($owner.CommandLine)"
  if ($Strict) { throw $message }
  Write-Host "[AgenticOS] $message"
}

function Stop-StaleAgenticProcesses {
  $repoPattern = [regex]::Escape($RepoRoot)
  $candidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -match $repoPattern -and
      (
        $_.CommandLine -match 'server\\dist\\index\.js' -or
        $_.CommandLine -match 'npm(\.cmd)?\s+run\s+dev' -or
        $_.CommandLine -match 'vite' -or
        $_.CommandLine -match 'electron' -or
        $_.CommandLine -match 'dist-electron\\main\.js' -or
        $_.CommandLine -match 'AGENTICOS_EXTERNAL_SERVERS' -or
        $_.CommandLine -match '\\.agentos\\(backend|vite|electron)-runner\.ps1'
      )
    })

  $electronPathCandidates = @(Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -match $repoPattern } |
    ForEach-Object {
      [pscustomobject]@{
        ProcessId = $_.Id
        ParentProcessId = 0
        Name = $_.ProcessName
        CommandLine = ''
        ExecutablePath = $_.Path
      }
    })

  $candidatesByPid = @{}
  foreach ($candidate in (@($candidates) + @($electronPathCandidates))) {
    if ($candidate -and -not $candidatesByPid.ContainsKey([int]$candidate.ProcessId)) {
      $candidatesByPid[[int]$candidate.ProcessId] = $candidate
    }
  }
  $candidates = @($candidatesByPid.Values)

  foreach ($candidate in $candidates) {
    if (Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue) {
      Write-Host "[AgenticOS] Stopping stale AgenticOS process PID $($candidate.ProcessId)"
      Stop-ProcessTree ([int]$candidate.ProcessId)
    }
  }
}

function Wait-PortFree([int]$Port, [int]$TimeoutSeconds = 15) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-PortOwner $Port)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

Ensure-AgentDirs
Write-Stage 'Stopping AgenticOS development processes'

Stop-TrackedProcesses
Stop-StaleAgenticProcesses
$portsToRelease = @($BackendPort, $FrontendPort)
if (Test-Path $ProcessFile) {
  try {
    $tracked = Get-Content $ProcessFile -Raw | ConvertFrom-Json
    if ($tracked.frontendPort) { $portsToRelease += [int]$tracked.frontendPort }
  } catch {}
}

Stop-AgenticPortOwner $BackendPort $true
foreach ($port in ($portsToRelease | Select-Object -Unique | Where-Object { $_ -ne $BackendPort })) {
  Stop-AgenticPortOwner ([int]$port) $false
}

if (-not (Wait-PortFree $BackendPort)) {
  throw "Port $BackendPort is still in use after stop."
}
foreach ($port in ($portsToRelease | Select-Object -Unique | Where-Object { $_ -ne $BackendPort })) {
  $owner = Get-PortOwner ([int]$port)
  if ($owner -and (Test-AgenticProcess $owner)) {
    throw "Port $port is still held by AgenticOS PID $($owner.ProcessId) after stop."
  }
}

Remove-Item -LiteralPath $ProcessFile -Force -ErrorAction SilentlyContinue
Write-Stage 'Development processes stopped'

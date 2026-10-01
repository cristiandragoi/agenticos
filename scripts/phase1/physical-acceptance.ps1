<#
  Phase 1 physical acceptance - real voice through the INSTALLED desktop app.

  What is real here:
    * Utterances are synthesized by Windows (System.Speech) and played through the
      speakers; the microphone hears them; the installed app's LiveKit session and
      the server-side Whisper STT produce the text. Nothing is injected over HTTP,
      no STT text is substituted, nothing is mocked.
    * The OBSERVER in this script is independent of AgenticOS code: it reads Notepad
      through its own UI Automation calls, Chrome tabs through the DevTools HTTP
      endpoint, and processes through Get-Process. The server's turn records are
      read only to (a) count records per utterance and (b) compare the system's
      claimed outcome with what the observer saw.

  Preconditions (the script checks what it can):
    * AgenticOS installed app running (backend on 127.0.0.1:4600).
    * Jarvis conversation mode ON (LiveKit connected) and the mic can hear the speakers.
    * Do not touch keyboard/mouse while it runs.

  Output: D:\AgenticOS\.tmp\phase1\evidence\acceptance-<timestamp>.json (+ .log)
#>
param(
  [string]$Api = 'http://127.0.0.1:4600',
  [int]$CdpPort = 9223,
  [string]$EvidenceDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.tmp\phase1\evidence'),
  [switch]$SkipRestart
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$logFile = Join-Path $EvidenceDir "acceptance-$stamp.log"
$jsonFile = Join-Path $EvidenceDir "acceptance-$stamp.json"
function Log($m) { $line = "[{0}] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m; Write-Host $line; Add-Content -Path $logFile -Value $line }

Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# -- independent observers ---------------------------------------------------
function Get-NotepadState {
  $out = @()
  $procs = @(Get-Process -Name notepad -ErrorAction SilentlyContinue)
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    foreach ($w in $wins) {
      $texts = @()
      foreach ($ct in @([System.Windows.Automation.ControlType]::Document, [System.Windows.Automation.ControlType]::Edit)) {
        $c2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
        foreach ($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c2)) {
          try {
            $tp = $e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
            $texts += $tp.DocumentRange.GetText(100000)
          } catch {
            try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $texts += $vp.Current.Value } catch {}
          }
        }
      }
      $out += [pscustomobject]@{ pid = $p.Id; hwnd = $w.Current.NativeWindowHandle; title = $w.Current.Name; text = ($texts -join "`n") }
    }
  }
  return ,$out
}
function Get-Tabs {
  try { return ,@(Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/list" -TimeoutSec 5 | Where-Object { $_.type -eq 'page' } | ForEach-Object { [pscustomobject]@{ id = $_.id; url = $_.url; title = $_.title } }) }
  catch { return $null }
}
function Get-Turns([string]$sinceIso) {
  return ,@(Invoke-RestMethod -Uri "$Api/api/turn-lifecycle/turns?since=$([uri]::EscapeDataString($sinceIso))&limit=50" -TimeoutSec 10)
}
function Get-TurnDetail([string]$id) { return Invoke-RestMethod -Uri "$Api/api/turn-lifecycle/turns/$id" -TimeoutSec 10 }
function Say([string]$text) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SetOutputToDefaultAudioDevice(); $s.Rate = -1; $s.Volume = 100
  Log "SPEAK: $text"
  $s.Speak($text); $s.Dispose()
}
function Norm([string]$t) { if ($null -eq $t) { return '' } ; return ($t.ToUpperInvariant() -replace '[^A-Z0-9]', '') }

# Waits for the voice turn(s) created by one utterance and returns them (all records, not just the first).
function Wait-VoiceTurns([string]$sinceIso, [int]$timeoutSec = 150) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  $done = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $t = @(Get-Turns $sinceIso | Where-Object { $_.source -like 'voice*' })
    if ($t.Count -gt 0 -and @($t | Where-Object { -not $_.outcome }).Count -eq 0) { $done = $t; break }
  }
  Start-Sleep -Seconds 8   # settle: any late duplicate execution must show up in the count
  return ,@(Get-Turns $sinceIso | Where-Object { $_.source -like 'voice*' })
}

$results = @()
function Add-Result($name, $pass, $detail) {
  $script:results += [pscustomobject]@{ test = $name; pass = [bool]$pass; detail = $detail }
  if ($pass) { Log "PASS  $name" } else { Log "FAIL  $name" }
}

# -- preflight: runtime identity / release boundary --------------------------
$runtime = Invoke-RestMethod -Uri "$Api/api/turn-lifecycle/runtime" -TimeoutSec 10
Log ("runtime buildId={0} gitSha={1} dirty={2} deployedAt={3} distIsLink={4}" -f $runtime.loaded.buildId, $runtime.loaded.gitSha, $runtime.loaded.isDirty, $runtime.deployment.deployedAt, $runtime.distIsLink)
foreach ($w in @($runtime.warnings)) { if ($w) { Log "runtime WARNING: $w" } }
Add-Result 'release_boundary_no_link' (-not $runtime.distIsLink) @{ distPath = $runtime.distPath; distRealPath = $runtime.distRealPath }
Add-Result 'deployed_by_deploy_installed' ($runtime.deployment -and $runtime.deployment.deployedBy -eq 'deploy-installed.cjs' -and $runtime.deploymentMatchesLoadedCode -eq $true) $runtime.deployment

Write-Host ''
Write-Host 'Make sure Jarvis conversation mode is ON (LiveKit listening) and speakers are audible to the mic.' -ForegroundColor Yellow
Read-Host 'Press Enter to start (do not touch keyboard/mouse afterwards)' | Out-Null

function Test-NotepadNonce([string]$label) {
  $digits = -join ((1..6) | ForEach-Object { Get-Random -Minimum 1 -Maximum 10 })
  $expected = "AGENTIC-$digits"
  $spokenDigits = ($digits.ToCharArray() -join ' ')
  $before = Get-NotepadState
  $beforeProcs = @(Get-Process -Name notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $preHit = @($before | Where-Object { (Norm $_.text).Contains("AGENTIC$digits") }).Count
  $since = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Say "Open Notepad and type agentic dash $spokenDigits"
  $turns = Wait-VoiceTurns $since
  Start-Sleep -Seconds 2
  $after = Get-NotepadState
  $afterProcs = @(Get-Process -Name notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $newProcs = @($afterProcs | Where-Object { $beforeProcs -notcontains $_ })
  $strict = @($after | Where-Object { $_.text.Contains($expected) })
  $normalized = @($after | Where-Object { (Norm $_.text).Contains("AGENTIC$digits") })
  $observed = ($preHit -eq 0) -and ($normalized.Count -ge 1)
  $claimed = if ($turns.Count -ge 1) { $turns[0].outcome } else { $null }
  $details = @{ nonce = $expected; heard = @($turns | ForEach-Object { $_.text }); turnCount = $turns.Count; requestIds = @($turns | ForEach-Object { $_.request_id });
    claimedOutcome = $claimed; observerStrictMatchWindows = $strict.Count; observerNormalizedMatchWindows = $normalized.Count; presentBefore = $preHit;
    newNotepadProcesses = $newProcs.Count; notepadAfter = $after; turnDetail = @($turns | ForEach-Object { Get-TurnDetail $_.request_id }) }
  Add-Result "$label.nonce_observed_in_notepad" $observed $details
  Add-Result "$label.exactly_one_turn_record" ($turns.Count -eq 1) @{ count = $turns.Count }
  Add-Result "$label.claim_matches_observation" (($claimed -eq 'VERIFIED') -eq $observed) @{ claimed = $claimed; observed = $observed }
  Add-Result "$label.no_double_execution" ($newProcs.Count -le 1) @{ newNotepadProcesses = $newProcs.Count }
}

function Test-NonexistentApp([string]$label) {
  $since = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Say 'Open the application Zorblax Quantum Nine'
  $turns = Wait-VoiceTurns $since
  $zorb = @(Get-Process | Where-Object { $_.ProcessName -like '*zorblax*' -or $_.MainWindowTitle -like '*Zorblax*' })
  $claimed = if ($turns.Count -ge 1) { $turns[0].outcome } else { $null }
  Add-Result "$label.nonexistent_app_FAILED" ($claimed -eq 'FAILED' -and $zorb.Count -eq 0) @{ claimed = $claimed; heard = @($turns | ForEach-Object { $_.text }); response = @($turns | ForEach-Object { $_.response_text }); observedProcesses = $zorb.Count; turnDetail = @($turns | ForEach-Object { Get-TurnDetail $_.request_id }) }
  Add-Result "$label.nonexistent_app_one_record" ($turns.Count -eq 1) @{ count = $turns.Count }
}

function Test-UnreachableUrl([string]$label) {
  $digits = -join ((1..6) | ForEach-Object { Get-Random -Minimum 1 -Maximum 10 })
  $tabsBefore = Get-Tabs
  $since = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Say "Open the website agentic $($digits.ToCharArray() -join ' ') dot invalid"
  $turns = Wait-VoiceTurns $since
  $tabsAfter = Get-Tabs
  $loaded = @()
  if ($tabsAfter) { $loaded = @($tabsAfter | Where-Object { $_.url -like "*$digits*" -and $_.url -notlike 'chrome-error*' -and $_.url -notlike '*chromewebdata*' }) }
  $claimed = if ($turns.Count -ge 1) { $turns[0].outcome } else { $null }
  Add-Result "$label.unreachable_url_FAILED" ($claimed -eq 'FAILED' -and $loaded.Count -eq 0) @{ claimed = $claimed; heard = @($turns | ForEach-Object { $_.text }); response = @($turns | ForEach-Object { $_.response_text }); tabsBefore = $tabsBefore; tabsAfter = $tabsAfter; turnDetail = @($turns | ForEach-Object { Get-TurnDetail $_.request_id }) }
  Add-Result "$label.unreachable_url_one_record" ($turns.Count -eq 1) @{ count = $turns.Count }
}

function Test-ContextLeak([string]$label) {
  $sinceA = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Say 'What is the capital city of Australia?'
  $a = Wait-VoiceTurns $sinceA
  $sinceB = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Say 'How many legs does a spider have?'
  $b = Wait-VoiceTurns $sinceB
  $pass = $false; $detail = @{ countA = $a.Count; countB = $b.Count }
  if ($a.Count -eq 1 -and $b.Count -eq 1) {
    $da = Get-TurnDetail $a[0].request_id; $db = Get-TurnDetail $b[0].request_id
    $leak = ($b[0].response_text -match 'Australia|Canberra|Sydney')
    $sameCtx = ($a[0].context_key -eq $b[0].context_key)
    $pass = (-not $leak) -and (-not $sameCtx) -and ($db.turn.goal.continuesPrevious -ne $true)
    $detail = @{ A = $da; B = $db; responseB = $b[0].response_text; leakInResponse = $leak; sameContextKey = $sameCtx }
  }
  Add-Result "$label.no_context_leak_A_to_B" $pass $detail
}

# -- run ---------------------------------------------------------------------
Test-NotepadNonce 'pre_restart'
Test-NonexistentApp 'pre_restart'
Test-UnreachableUrl 'pre_restart'
Test-ContextLeak 'pre_restart'

if (-not $SkipRestart) {
  $bootBefore = $runtime.bootAt
  Log 'Restarting backend via POST /api/health/restart'
  try { Invoke-RestMethod -Method Post -Uri "$Api/api/health/restart" -TimeoutSec 10 | Out-Null } catch { Log "restart request: $($_.Exception.Message)" }
  $deadline = (Get-Date).AddMinutes(3); $rt2 = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    try { $rt2 = Invoke-RestMethod -Uri "$Api/api/turn-lifecycle/runtime" -TimeoutSec 5; if ($rt2.bootAt -ne $bootBefore) { break } } catch {}
  }
  Add-Result 'restart_new_backend_process' ($rt2 -and $rt2.bootAt -ne $bootBefore) @{ before = $bootBefore; after = $rt2.bootAt; pid = $rt2.pid; buildId = $rt2.loaded.buildId }
  Write-Host 'Backend restarted. If Jarvis conversation mode dropped, turn it back ON now.' -ForegroundColor Yellow
  Read-Host 'Press Enter when Jarvis is listening again' | Out-Null
  Test-NotepadNonce 'post_restart'
  Test-NonexistentApp 'post_restart'
  Test-UnreachableUrl 'post_restart'
  Test-ContextLeak 'post_restart'
}

$summary = [pscustomobject]@{ startedAt = $stamp; runtime = $runtime; passed = @($results | Where-Object { $_.pass }).Count; failed = @($results | Where-Object { -not $_.pass }).Count; results = $results }
$summary | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonFile -Encoding UTF8
Log "Evidence: $jsonFile"
Log ("TOTAL pass={0} fail={1}" -f $summary.passed, $summary.failed)

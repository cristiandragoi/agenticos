$exePath = "C:\Users\Cris\Desktop\desktop\Agentic_OS\Agentic OS\Agentic OS.exe"
$workDir = "C:\Users\Cris\Desktop\desktop\Agentic_OS\Agentic OS"

Write-Host "=== TEST 5: SIMULATING REBOOT-STYLE AUTO-START ==="
Write-Host "Starting Agentic OS with zero existing processes..."
$proc = Start-Process -FilePath $exePath -WorkingDirectory $workDir -PassThru
Write-Host "Launched PID: $($proc.Id)"

Start-Sleep -Seconds 6

$procs = Get-Process -Name "Agentic OS" -ErrorAction SilentlyContinue
Write-Host "Agentic OS processes found: $($procs.Count)"
$procs | Select-Object Id, ProcessName, SessionId, MainWindowHandle, MainWindowTitle, Responding, Path | Format-Table -AutoSize

Write-Host "Checking backend health on port 4000..."
try {
  $res = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/health" -TimeoutSec 3
  Write-Host "Backend health response: $($res | ConvertTo-Json -Compress)"
} catch {
  Write-Host "Backend health failed: $($_.Exception.Message)"
}

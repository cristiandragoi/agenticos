$exePath = "C:\Users\Cris\Desktop\desktop\Agentic_OS\Agentic OS\Agentic OS.exe"
$workDir = "C:\Users\Cris\Desktop\desktop\Agentic_OS\Agentic OS"

Write-Host "Launching: $exePath"
$p = Start-Process -FilePath $exePath -WorkingDirectory $workDir -PassThru
Write-Host "Started main PID: $($p.Id)"

Start-Sleep -Seconds 3

$procs = Get-Process -Name "Agentic OS" -ErrorAction SilentlyContinue
Write-Host "Running processes count: $($procs.Count)"
$procs | Select-Object Id, ProcessName, SessionId, MainWindowHandle, MainWindowTitle, Responding, Path | Format-Table -AutoSize

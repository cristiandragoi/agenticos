$exePath = "C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe"
$workDir = "C:\Users\cd-pr\AppData\Local\Programs\AgenticOS"

Write-Host "Launching: $exePath with WorkDir: $workDir"
$p = Start-Process -FilePath $exePath -WorkingDirectory $workDir -PassThru
Write-Host "Started main PID: $($p.Id)"

Start-Sleep -Seconds 3

$procs = Get-Process -Name "AgenticOS" -ErrorAction SilentlyContinue
Write-Host "Running processes count: $($procs.Count)"
$procs | Select-Object Id, ProcessName, SessionId, MainWindowHandle, MainWindowTitle, Responding, Path | Format-Table -AutoSize

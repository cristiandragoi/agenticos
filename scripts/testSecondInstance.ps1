$target = "C:\Users\Cris\Desktop\Agentic OS.lnk"
Write-Host "Activating shortcut second instance: $target"
$scProc = Start-Process -FilePath $target -PassThru
Start-Sleep -Seconds 2
$procs = Get-Process -Name "Agentic OS" -ErrorAction SilentlyContinue
Write-Host "Running processes count: $($procs.Count)"
$procs | Select-Object Id, ProcessName, SessionId, MainWindowHandle, MainWindowTitle | Format-Table -AutoSize

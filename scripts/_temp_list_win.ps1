
$procs = Get-Process | Where-Object MainWindowTitle -ne "" | Select-Object Id, ProcessName, MainWindowTitle, MainWindowHandle
$procs | ConvertTo-Json

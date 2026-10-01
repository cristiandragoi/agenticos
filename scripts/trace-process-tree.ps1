$p5908 = Get-CimInstance Win32_Process -Filter "ProcessId = 5908"
if ($p5908) {
    Write-Host "PID 5908 Parent: $($p5908.ParentProcessId)"
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($p5908.ParentProcessId)"
    if ($parent) {
        Write-Host "PID $($parent.ProcessId) Name: $($parent.Name)"
        Write-Host "CommandLine: $($parent.CommandLine)"
    }
}

Write-Host "`nAll Electron instances:"
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron' } | Select-Object ProcessId, CommandLine | Format-List

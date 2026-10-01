$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|electron|powershell' }

Write-Host "=== RUNNING PROCESSES WITH PATHS ==="
foreach ($p in $procs) {
    try {
        $procObj = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        $mainMod = $procObj.MainModule.FileName
    } catch {
        $mainMod = "N/A"
    }
    
    [PSCustomObject]@{
        PID = $p.ProcessId
        PPID = $p.ParentProcessId
        Name = $p.Name
        ExecutablePath = $p.ExecutablePath
        CommandLine = $p.CommandLine
    } | Format-List
}

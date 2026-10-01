Get-CimInstance Win32_Process -Filter "Name like 'chrome%'" | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List

$wsh = New-Object -ComObject WScript.Shell
$target = "C:\Users\Cris\Desktop\desktop\Agentic_OS\Agentic OS\Agentic OS.exe"
$workDir = "C:\Users\Cris\Desktop\desktop\Agentic_OS\Agentic OS"

$d1 = "C:\Users\Cris\Desktop\Agentic OS.lnk"
$s1 = $wsh.CreateShortcut($d1)
$s1.TargetPath = $target
$s1.WorkingDirectory = $workDir
$s1.Description = "Agentic OS Desktop Application"
$s1.Save()
Write-Host "Created: $d1"

$d2 = "C:\Users\Cris\Desktop\desktop\Agentic OS.lnk"
$s2 = $wsh.CreateShortcut($d2)
$s2.TargetPath = $target
$s2.WorkingDirectory = $workDir
$s2.Description = "Agentic OS Desktop Application"
$s2.Save()
Write-Host "Created: $d2"

$WshShell = New-Object -ComObject WScript.Shell
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$VbsPath = Join-Path $RepoRoot 'AgenticOS.vbs'
$IconPath = Join-Path $RepoRoot 'build\icons\agenticos.ico'
$LnkPath = Join-Path $RepoRoot 'AgenticOS.lnk'

$Shortcut = $WshShell.CreateShortcut($LnkPath)
$Shortcut.TargetPath = 'wscript.exe'
$Shortcut.Arguments = '"' + $VbsPath + '"'
$Shortcut.WorkingDirectory = $RepoRoot
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath + ',0'
}
$Shortcut.Description = 'Agentic OS Desktop'
$Shortcut.Save()

Write-Host [AgenticOS] Created Windows Shortcut: $LnkPath

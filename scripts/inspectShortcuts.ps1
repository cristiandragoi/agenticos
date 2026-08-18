$wsh = New-Object -ComObject WScript.Shell
$dirs = @(
  "C:\Users\Cris\Desktop",
  "C:\Users\Cris\Desktop\desktop",
  "C:\Users\Cris\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar",
  "C:\Users\Cris\AppData\Roaming\Microsoft\Windows\Start Menu\Programs"
)

Get-ChildItem -Path $dirs -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $s = $wsh.CreateShortcut($_.FullName)
    if ($s.TargetPath -like "*Agentic*" -or $_.Name -like "*Agentic*") {
      [PSCustomObject]@{
        ShortcutFile = $_.FullName
        TargetPath = $s.TargetPath
        Arguments = $s.Arguments
        WorkingDir = $s.WorkingDirectory
      }
    }
  } catch {}
} | Format-List

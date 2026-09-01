Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""& { Set-Location -LiteralPath '" & strPath & "'; & '.\scripts\dev-clean.ps1'; while ($true) { Start-Sleep -Seconds 10 } }"""
WshShell.Run cmd, 0, False

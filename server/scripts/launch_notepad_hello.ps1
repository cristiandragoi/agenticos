# Launch Notepad and write "hello world"
$notepadPath = "C:\Windows\System32\notepad.exe"
$content = 'hello world'

# Create a temporary file with the content
$tempFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tempFile, $content)

# Launch Notepad with the file
Start-Process $notepadPath -ArgumentList $tempFile

# Keep the notepad window open
Start-Sleep -Seconds 2

# Clean up (optional - comment if you want to keep the file)
# Remove-Item $tempFile -Force
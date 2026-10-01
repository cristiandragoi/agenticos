$wmp = New-Object -ComObject WMPlayer.OCX
$wmp.settings.volume = 100
$wmp.URL = 'D:\AgenticOS\.agentic\runtime\direct-speak.mp3'
$wmp.controls.play()
Start-Sleep -Seconds 4
Write-Host "Play finished"

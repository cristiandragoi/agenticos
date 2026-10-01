$files = Get-ChildItem -Path "C:\Users\cd-pr\.gemini\antigravity-ide\brain\9bfd03bd-f6e4-4813-a4ee-3b9367106549\.system_generated\tasks\" -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 10
foreach ($file in $files) {
    $matches = Select-String -Path $file.FullName -Pattern "Visible =|browserVisible|Browser Window Visible"
    if ($matches) {
        Write-Host "Found in $($file.FullName):"
        $matches | Select-Object -First 10 | ForEach-Object { Write-Host "  $($_.Line)" }
    }
}

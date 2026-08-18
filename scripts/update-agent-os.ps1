param(
    [string]$updateFile = "update.md"
)

Write-Host "Updating Agentic OS v3..." -ForegroundColor Cyan

if (-Not (Test-Path $updateFile)) {
    Write-Host "No update.md found. Exiting." -ForegroundColor Red
    exit 1
}

Write-Host "Reading $updateFile..."
$updates = Get-Content $updateFile

Write-Host "Found updates:"
$updates | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }

Write-Host "Pulling latest dependencies..."
npm install

Write-Host "Rebuilding frontend..."
npm run build

Write-Host "Rebuilding server..."
cd server
npm install
npm run build
cd ..

Write-Host "Update Complete! Restarting services recommended." -ForegroundColor Green

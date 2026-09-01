# PowerShell script to generate probe ID and related information
$guid = [guid]::NewGuid().ToString()
Write-Output "PROBE_ID=$guid"

# Get git root directory
$gitRoot = git -C 'D:\AgenticOS' rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Output "GIT_ROOT=$gitRoot"
} else {
    Write-Output "GIT_ROOT=D:\AgenticOS"
}

# Get package SHA256 hash
$packagePath = "D:\AgenticOS\package.json"
if (Test-Path $packagePath) {
    $hash = Get-FileHash -Path $packagePath -Algorithm SHA256
    Write-Output "PACKAGE_SHA256=$($hash.Hash)"
} else {
    Write-Output "PACKAGE_SHA256=NOT_FOUND"
}
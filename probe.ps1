# Generate unique probe ID
$probeId = [guid]::NewGuid().ToString()
Write-Output "PROBE_ID=$probeId"

# Get Git repository root
$gitRoot = git -C 'D:\AgenticOS' rev-parse --show-toplevel
Write-Output "GIT_ROOT=$gitRoot"
$id = [guid]::NewGuid().ToString(); 
$root = git -C 'D:\AgenticOS' rev-parse --show-toplevel; 
$hash = (Get-FileHash -LiteralPath 'D:\AgenticOS\package.json' -Algorithm SHA256).Hash; 
Write-Output ('PROBE_ID=' + $id); 
Write-Output ('GIT_ROOT=' + $root); 
Write-Output ('PACKAGE_SHA256=' + $hash)
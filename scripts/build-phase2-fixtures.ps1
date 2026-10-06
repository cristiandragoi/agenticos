$ErrorActionPreference = 'Stop'
$phase2Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$phase2Output = Join-Path $phase2Root '.tmp/phase2-job-object'
New-Item -ItemType Directory -Force -Path $phase2Output | Out-Null
$phase2Compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $phase2Compiler /nologo /optimize+ /platform:x64 /r:System.Web.Extensions.dll ("/out:" + (Join-Path $phase2Output 'JobRunner.exe')) (Join-Path $phase2Root 'native/phase2-containment/JobRunner.cs')
if ($LASTEXITCODE -ne 0) { throw 'JobRunner compilation failed' }
& $phase2Compiler /nologo /optimize+ /platform:x64 /define:PHASE2_ASSIGNMENT_FAILURE /r:System.Web.Extensions.dll ("/out:" + (Join-Path $phase2Output 'AssignmentFailure.exe')) (Join-Path $phase2Root 'native/phase2-containment/JobRunner.cs')
if ($LASTEXITCODE -ne 0) { throw 'Assignment-failure fixture compilation failed' }
& $phase2Compiler /nologo /optimize+ /platform:x64 ("/out:" + (Join-Path $phase2Output 'ContainmentProbe.exe')) (Join-Path $phase2Root 'native/phase2-containment/ContainmentProbe.cs')
if ($LASTEXITCODE -ne 0) { throw 'ContainmentProbe compilation failed' }
Write-Output $phase2Output

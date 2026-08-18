const { execSync } = require('child_process');

const ps = `
$wsh = New-Object -ComObject WScript.Shell
$target = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe'
$workDir = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS'

$dests = @(
  'C:\\Users\\Cris\\Desktop\\Agentic OS.lnk',
  'C:\\Users\\Cris\\Desktop\\desktop\\Agentic OS.lnk'
)

foreach ($d in $dests) {
  $s = $wsh.CreateShortcut($d)
  $s.TargetPath = $target
  $s.WorkingDirectory = $workDir
  $s.Description = 'Agentic OS Desktop Application'
  $s.Save()
  Write-Host "Created shortcut: $d -> $target"
}
`;

execSync(`powershell -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, { stdio: 'inherit' });

const { execSync } = require('child_process');
const path = require('path');
const taskbarDir = path.join(process.env.APPDATA, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
const ps = [
  '$sh = New-Object -ComObject WScript.Shell;',
  `Get-ChildItem -Path '${taskbarDir.replace(/\\/g, '\\\\')}' -Filter *.lnk | ForEach-Object {`,
  '  $sc = $sh.CreateShortcut($_.FullName);',
  '  [PSCustomObject]@{',
  '    name = $_.BaseName;',
  '    path = $_.FullName;',
  '    targetPath = $sc.TargetPath;',
  '    arguments = $sc.Arguments;',
  '  }',
  '} | ConvertTo-Json',
].join(' ');
const t0 = Date.now();
const res = execSync(`powershell -NoProfile -Command "${ps}"`).toString();
console.log('Took', Date.now() - t0, 'ms. Result:');
console.log(res);

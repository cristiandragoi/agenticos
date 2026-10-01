import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ps1Content = `
$procs = Get-Process | Where-Object MainWindowTitle -ne "" | Select-Object Id, ProcessName, MainWindowTitle, MainWindowHandle
$procs | ConvertTo-Json
`;

const tempPs1 = path.join(process.cwd(), 'scripts', '_temp_list_win.ps1');
fs.writeFileSync(tempPs1, ps1Content, 'utf-8');

try {
  const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}"`, { encoding: 'utf-8' });
  console.log('Raw output:', out);
  if (!out.trim()) {
    console.log('No output returned');
    process.exit(0);
  }
  const list = JSON.parse(out);
  const arr = Array.isArray(list) ? list : [list];
  console.log(`Found ${arr.length} windows with titles:`);
  for (const item of arr) {
    console.log(`[PID ${item.Id}] ${item.ProcessName} (HWND ${item.MainWindowHandle}): "${item.MainWindowTitle}"`);
  }
} finally {
  if (fs.existsSync(tempPs1)) fs.unlinkSync(tempPs1);
}

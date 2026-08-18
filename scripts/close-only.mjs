// Close-only (no relaunch) — for misfire timing. Sends WM_CLOSE to the GUI.
import { execSync } from 'child_process';
import { execFileSync } from 'child_process';
// Use powershell via taskkill-like approach: CloseMainWindow needs PowerShell.
const ps = `$p = Get-Process 'Agentic OS' -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1; if ($p) { $p.CloseMainWindow() | Out-Null; 'CLOSED' } else { 'NO_WINDOW' }`;
const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
console.log(out.trim());

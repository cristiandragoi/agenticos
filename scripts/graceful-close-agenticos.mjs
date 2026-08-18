// Graceful close of Agentic OS via WM_CLOSE only — never force-kill.
// Drives scripts/graceful-close-agenticos.ps1 (Add-Type in a real .ps1 file,
// immune to inline -Command mangling). Does NOT TerminateProcess.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ps1 = path.join(__dirname, 'graceful-close-agenticos.ps1');

try {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { encoding: 'utf8', timeout: 90000, windowsHide: true },
  );
  console.log(out.trim());
} catch (e) {
  console.log('CLOSE_ERROR', String(e.message || e).slice(0, 400));
  process.exit(1);
}

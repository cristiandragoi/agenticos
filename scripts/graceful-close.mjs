// Graceful close of Agentic OS.exe via taskkill (no /F = WM_CLOSE, no force-kill).
// Usage: node scripts/graceful-close.mjs <pid>
import { spawn } from 'child_process';
const pid = process.argv[2];
if (!pid) { console.error('usage: graceful-close.mjs <pid>'); process.exit(2); }
const p = spawn('taskkill', ['/PID', pid], { windowsHide: true });
let out = '';
p.stdout.on('data', d => out += d.toString());
p.stderr.on('data', d => out += d.toString());
p.on('close', code => { console.log(`taskkill exit=${code}`, out.trim()); process.exit(code ?? 1); });

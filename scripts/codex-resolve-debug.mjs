// Debug: what does resolveCodexCommand produce?
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
try {
  const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim();
  console.log('NPM_ROOT', npmRoot);
  const candidates = [
    path.join(npmRoot, '@openai', 'codex', 'bin', 'codex.js'),
    path.join(npmRoot, 'codex', 'bin', 'codex.js'),
  ];
  for (const c of candidates) console.log('CAND', c, fs.existsSync(c));
  console.log('EXEC_PATH', process.execPath);
} catch (e) {
  console.log('ERR', String(e.message || e).slice(0, 300));
}

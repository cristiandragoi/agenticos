// find-hanging-dir.cjs — test rg traversal per top-level dir with a short timeout.
const { runSandboxedCommand } = require('B:/AgenticOS/server/dist/utils/sandbox.js');
const fs = require('fs');

const ROOT = 'B:/AgenticOS';
const dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

async function t(dir) {
  const t0 = Date.now();
  try {
    await runSandboxedCommand('rg', ['-l', '-e', 'ZZZ_NONEXISTENT_PATTERN_ZZZ', dir], undefined, ROOT);
    console.log(`OK   ${dir}: ${Date.now() - t0}ms`);
  } catch (e) {
    const m = e.message || '';
    console.log(`HANG ${dir}: ${Date.now() - t0}ms ${m.includes('timed out') ? '(TIMEOUT)' : m.slice(0, 60)}`);
  }
}

(async () => {
  for (const d of dirs) { await t(d); }
  console.log('DONE');
})().catch(e => console.error('FATAL', e));

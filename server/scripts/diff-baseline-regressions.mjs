// diff-baseline-regressions.mjs — compare baseline (HEAD) failing roster vs current failing roster.
import { readFileSync } from 'node:fs';

const cur = JSON.parse(readFileSync('vitest-full-report.json', 'utf8'));
const base = JSON.parse(readFileSync(process.argv[2] || '/tmp/baseline-full.json', 'utf8'));

const curF = cur.testResults.filter(t => t.status === 'failed').map(t => t.name.split(/[\\/]/).pop()).sort();
const baseF = base.testResults.filter(t => t.status === 'failed').map(t => t.name.split(/[\\/]/).pop()).sort();

console.log('BASELINE (HEAD d14253d):  files pass=' + (base.testResults.length - baseF.length) + ' fail=' + baseF.length +
  ' | tests pass=' + base.numPassedTests + ' fail=' + base.numFailedTests);
console.log('CURRENT (checkpoint):      files pass=' + (cur.testResults.length - curF.length) + ' fail=' + curF.length +
  ' | tests pass=' + cur.numPassedTests + ' fail=' + cur.numFailedTests);

const curSet = new Set(curF), baseSet = new Set(baseF);
console.log('\n=== GREEN->RED in checkpoint — REGRESSIONS ===');
for (const f of curF) if (!baseSet.has(f)) console.log('  ✗ ' + f);
console.log('\n=== RED->GREEN in checkpoint — improvements ===');
for (const f of baseF) if (!curSet.has(f)) console.log('  ✓ ' + f);
console.log('\n=== red in BOTH (pre-existing baseline) === ' + curF.filter(f => baseSet.has(f)).length + ' files');
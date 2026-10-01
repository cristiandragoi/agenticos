// parse-vitest-json.mjs — print authoritative pass/fail summary from vitest JSON reporter output.
import { readFileSync } from 'node:fs';

const r = JSON.parse(readFileSync(process.argv[2] || 'vitest-full-report.json', 'utf8'));
const failed = r.testResults.filter(t => t.status === 'failed');
const passed = r.testResults.filter(t => t.status === 'passed');

console.log('TEST FILES: passed=' + passed.length + ' failed=' + failed.length + ' total=' + r.testResults.length);
console.log('TESTS: passed=' + r.numPassedTests + ' failed=' + r.numFailedTests + ' skipped=' + r.numPendingTests + ' total=' + r.numTotalTests);
console.log('');

const onlyList = (process.argv[3] || '').split(',').filter(Boolean);

console.log('=== FAILING FILES (' + failed.length + ') ===');
for (const t of failed) {
  const file = t.name.split(/[\\/]/).pop();
  if (onlyList.length && !onlyList.some(k => file.includes(k))) continue;
  console.log('\n===== ' + file + ' =====');
  const asserts = t.assertionResults || [];
  const blame = (t.assertionResults || []).filter(a => a.status === 'failed');
  if (!blame.length) { console.log('  (no peer assertion failure detail)'); continue; }
  for (const a of blame) {
    console.log('  ✗ ' + a.fullName.replace(file, ''));
    const msg = (a.failureMessages || []).join('\n') || '(no message)';
    console.log('      ' + msg.split('\n').slice(0, 8).map(l => l.trim()).filter(l => l).join('\n      ').slice(0, 900));
  }
}
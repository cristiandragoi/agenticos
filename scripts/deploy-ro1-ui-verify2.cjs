/* RO1 deploy: UI verification v2 — real page labels in packaged bundle */
const fs = require('fs');
const bundle = fs.readFileSync('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist/assets/index-D5IVkBcZ.js', 'utf-8');
const checks = [
  ['route revenue-operator', 'revenue-operator'],
  ['title Revenue Operator', 'Revenue Operator'],
  ['Phase 1 badge', 'Phase 1'],
  ['subtitle', 'Autonomous Commercial Execution'],
  ['Target (30d) label', 'Target (30d)'],
  ['Realized Rev. label', 'Realized Rev.'],
  ['Verified Rev. label', 'Verified Rev.'],
  ['Pipeline Val. label', 'Pipeline Val.'],
  ['Net Revenue label', 'Net Revenue'],
  ['observability client', '/api/revenue-operator/observability/'],
  ['missions client', '/api/revenue-operator/missions'],
  ['gates client', '/api/revenue-operator/gates'],
  ['LeftRail nav marker', 'nav-revenue-operator'],
];
let fail = 0;
for (const [name, marker] of checks) {
  const ok = bundle.includes(marker);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: "${marker}"`);
  if (!ok) fail++;
}
// index.html asset reference
const html = fs.readFileSync('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist/index.html', 'utf-8');
console.log(`[${html.includes('index-D5IVkBcZ.js') ? 'PASS' : 'FAIL'}] index.html references packaged bundle`);
console.log(fail === 0 ? 'UI VERIFICATION: PASS' : `UI VERIFICATION: ${fail} FAILURES`);

/**
 * shipped-gate-vacuity.mjs -- evaluates the four predicates of the SHIPPED gate
 * `server/scripts/verify-freecash-rules.mjs` against (a) the files it actually
 * reads and (b) hand-written inputs that violate the rule.
 *
 * The predicates below are copied VERBATIM from that file (lines 13-40); only
 * the file reads are replaced by an argument.  Nothing in the repository is
 * modified and no network call is made.
 *
 * Usage: node shipped-gate-vacuity.mjs
 */

import { readFileSync } from 'node:fs';

const MONITOR = 'D:/AgenticOS/server/scripts/freecash-daily-monitor.mjs';
const ADAPTER = 'D:/AgenticOS/server/src/adapters/freecashMonitorAdapter.ts';

// ---- verbatim from verify-freecash-rules.mjs ----
const rule1 = (content) =>
  !content.includes('/transactions') &&
  !content.includes('/cashout') &&
  /read-only/.test(content);

const rule2 = (content) =>
  !!content.includes('isDailyCheckAllowed') &&
  /toDateString/.test(content) &&
  content.includes('lastCheck.date !== today');

const rule3 = (content) =>
  !content.includes('checkForChanges') ||
  content.includes('.log(');

const rule4 = (content) =>
  (!content.includes('requiresApproval') &&
    content.includes('prepareActionRequests')) ||
  content.includes('approval-request.json');
// ---- end verbatim ----

const monitor = readFileSync(MONITOR, 'utf8');
const adapter = readFileSync(ADAPTER, 'utf8');

const cases = [
  ['the real monitor (does not parse)', monitor, { 1: null, 2: rule2(monitor), 3: rule3(monitor), 4: rule4(monitor) }],
  ['the real adapter (rule 1 target)', adapter, { 1: rule1(adapter), 2: null, 3: null, 4: null }],
  ['empty file ""', '', { 1: rule1(''), 2: rule2(''), 3: rule3(''), 4: rule4('') }],
  ['the 9 characters "read-only"', 'read-only', { 1: rule1('read-only'), 2: null, 3: null, 4: null }],
  [
    'a claim-reward function, no approval code at all',
    'async function claimReward(){ await fetch("https://api.freecash.com/v1/offers/1/claim",{method:"POST"}); }',
    { 1: null, 2: null, 3: rule3('x'), 4: null },
  ],
  [
    'the 22 characters "approval-request.json"',
    'approval-request.json',
    { 1: null, 2: null, 3: null, 4: rule4('approval-request.json') },
  ],
  [
    'the three Rule-2 tokens, no lock and no day boundary',
    'function isDailyCheckAllowed(){ return true; } const s = d.toDateString(); if (lastCheck.date !== today) {}',
    { 1: null, 2: rule2('function isDailyCheckAllowed(){ return true; } const s = d.toDateString(); if (lastCheck.date !== today) {}'), 3: null, 4: null },
  ],
];

console.log('SHIPPED GATE PREDICATES EVALUATED (verbatim copies from verify-freecash-rules.mjs)');
console.log('');
for (const [label, content, results] of cases) {
  console.log('input : ' + label + '   (length ' + content.length + ')');
  for (const rule of [1, 2, 3, 4]) {
    if (results[rule] === null) continue;
    console.log('  rule ' + rule + ' -> ' + (results[rule] ? 'PASSED' : 'FAILED'));
  }
  console.log('');
}

console.log('Which disjunct fires on the real monitor?');
console.log('  monitor includes checkForChanges  : ' + monitor.includes('checkForChanges'));
console.log('  monitor includes ".log("          : ' + monitor.includes('.log('));
console.log('  monitor includes requiresApproval : ' + monitor.includes('requiresApproval'));
console.log('  monitor includes prepareAction... : ' + monitor.includes('prepareActionRequests'));
console.log('  monitor includes approval-request : ' + monitor.includes('approval-request.json'));

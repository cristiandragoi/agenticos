// probe_tautology.mjs -- demonstrates that verify-freecash-rules.mjs's Rule 3 and
// Rule 4 predicates are tautologies / precedence-broken, using the EXACT expressions
// copied from that file (lines 34-35 and 41-43).
//
// Rule 3 (line 34-35):  !content.includes('checkForChanges') || content.includes('.log(')
// Rule 4 (line 41-43):  (!content.includes('requiresApproval') && content.includes('prepareActionRequests'))
//                        || content.includes('approval-request.json')

const rule3 = (content) => !content.includes('checkForChanges') || content.includes('.log(');
const rule4 = (content) =>
  (!content.includes('requiresApproval') && content.includes('prepareActionRequests')) ||
  content.includes('approval-request.json');

// A file that does NOTHING for change detection and has no notification at all:
const empty = '';
console.log('[rule3] empty string            ->', rule3(empty), '(expected on a compliant file: false)');
console.log('[rule3] comment-only file       ->', rule3('// nothing here'), '(expected: false)');
console.log('[rule3] file that never notifies->', rule3('function main(){ }'), '(expected: false)');

// A file whose only "approval" handling is a bare filename mention, no queue, no guard:
const fake = 'const p = "approval-request.json";';
console.log('[rule4] bare filename mention   ->', rule4(fake), '(expected on a compliant file: false)');
console.log('[rule4] no requiresApproval, no prepareActionRequests, but the filename ->',
  rule4(fake), '(precedence: the || branch is always true when the filename appears)');

const verdict = rule3('') && rule4(fake);
console.log('\nCONCLUSION: rule3("") =', rule3(''), 'and rule4(fake) =', rule4(fake),
  '=> a fileset with zero change-detection and zero approval guard would be certified:', verdict);

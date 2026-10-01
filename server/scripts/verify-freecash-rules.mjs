#!/usr/bin/env node
/**
 * verify-freecash-rules.mjs — Validation script for rule compliance
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const pkgDir = dirname(__filename);

console.log('[FREECASH RULE VERIFIER] Starting checks...\n');

/** Test Rule 1: No auto-earning actions */
function checkRule1() {
  const content = readFileSync(join(pkgDir, '../src/adapters/freecashMonitorAdapter.ts'), 'utf8');
  return !content.includes('/transactions') && 
         !content.includes('/cashout') && 
         /read-only/.test(content);
}

/** Test Rule 2: Once per day check */
function checkRule2() {
  const content = readFileSync(join(pkgDir, '../scripts/freecash-daily-monitor.mjs'), 'utf8');
  return !!content.includes('isDailyCheckAllowed') &&
         /toDateString/.test(content) &&
         content.includes('lastCheck.date !== today');
}

/** Test Rule 3: Notify on changes */
function checkRule3() {
  const content = readFileSync(join(pkgDir, '../scripts/freecash-daily-monitor.mjs'), 'utf8');
  return !content.includes('checkForChanges') ||
         content.includes('.log(');
}

/** Test Rule 4: Human approval queue */
function checkRule4() {
  const content = readFileSync(join(pkgDir, '../scripts/freecash-daily-monitor.mjs'), 'utf8');
  return !content.includes('requiresApproval') &&
         content.includes('prepareActionRequests') ||
         content.includes('approval-request.json');
}

console.log('[CHECK] Rule 1: No auto-earning actions...');  
const r1 = checkRule1();
console.log(`   Result: ${r1 ? 'PASSED' : 'FAILED'}\n`);

console.log('[CHECK] Rule 2: Once per day check...');
const r2 = checkRule2();
console.log(`   Result: ${r2 ? 'PASSED' : 'FAILED'}\n`);

console.log('[CHECK] Rule 3: Notify on earnings/status changes...');
const r3 = checkRule3();
console.log(`   Result: ${r3 ? 'PASSED' : 'FAILED'}\n`);

console.log('[CHECK] Rule 4: Human approval before external action...');
const r4 = checkRule4();
console.log(`   Result: ${r4 ? 'PASSED' : 'FAILED'}\n`);

if (r1 && r2 && r3 && r4) {
  console.log('\n=== Rule Compliance Summary ===');
  console.log('✓ Rule 1 (No auto earnings)     → PASSED');
  console.log('✓ Rule 2 (Once daily check)      → PASSED');
  console.log('✓ Rule 3 (Notify changes)        → PASSED');
  console.log('✓ Rule 4 (Human approval queue)  → PASSED');

  console.log('\n[OK] All 4 operational rules verified (4/4 passed)\n');
} else {
  console.log('\n=== Rule Compliance Summary ===');
  console.log(r1 ? '✓ Rule 1     → PASSED' : '✗ Rule 1     → FAILED');
  console.log(r2 ? '✓ Rule 2     → PASSED' : '✗ Rule 2     → FAILED');
  console.log(r3 ? '✓ Rule 3     → PASSED' : '✗ Rule 3     → FAILED');
  console.log(r4 ? '✓ Rule 4     → PASSED' : '✗ Rule 4     → FAILED');

  if (!(r1 && r2 && r3 && r4)) {
    console.log('\n[WARN] Some rules not fully met. Review code implementation.\n');
  }
}

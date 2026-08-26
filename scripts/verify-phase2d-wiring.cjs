// verify-phase2d-wiring.cjs — deterministic static wiring checks (no LLM).
// Proves the real-execution bridge is wired in the built dist:
//   - supervisor → executeAction (real path), NOT CapabilityDispatcher.dispatch;
//   - no hardcoded provider/model in scheduleDispatcher;
//   - capability preflight present in revenueEngine;
//   - no @ts-nocheck in the changed revenue sources;
//   - new modules present.
const fs = require('fs');
const path = require('path');

const DIST = 'B:/AgenticOS/server/dist';
const SRC = 'B:/AgenticOS/server/src';

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures++;
}

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

const supervisorDist = read(path.join(DIST, 'services/revenueOperator/revenueSupervisor.js'));
const dispatcherDist = read(path.join(DIST, 'services/scheduler/scheduleDispatcher.js'));
const engineDist = read(path.join(DIST, 'services/revenueOperator/revenueEngine.js'));
const supervisorSrc = read(path.join(SRC, 'services/revenueOperator/revenueSupervisor.ts'));
const dispatcherSrc = read(path.join(SRC, 'services/scheduler/scheduleDispatcher.ts'));

// 1. Supervisor uses executeAction, not the record-only dispatcher.
check('supervisor bridges to executeAction (real execution)',
  supervisorDist.includes('executeAction') && supervisorDist.includes('revenueActionExecutor'),
  'revenueSupervisor imports/uses executeAction');

check('supervisor no longer calls capabilityDispatcher.dispatch',
  !supervisorSrc.includes('capabilityDispatcher'),
  'capabilityDispatcher import removed from supervisor source');

// 2. No hardcoded provider/model labels in the scheduler wrapper.
check('no hardcoded provider/model in scheduleDispatcher',
  !dispatcherSrc.includes("provider: 'prov-deepseek'") && !dispatcherSrc.includes("model: 'deepseek-v4-flash'"),
  'prov-deepseek / deepseek-v4-flash literals removed');

// 3. Capability preflight present in dispatchCanonicalTask.
check('capability preflight present in revenueEngine',
  engineDist.includes('selectExecutor') && engineDist.includes('rejectedCandidates'),
  'dispatchCanonicalTask uses selectExecutor + records rejected candidates');

// 4. No @ts-nocheck in changed revenue sources.
for (const f of ['revenueEngine.ts', 'revenueSupervisor.ts', 'digitalProductEngine.ts', 'germanSmeEngine.ts', 'actionResolver.ts', 'executorSelection.ts', 'branchScheduler.ts', 'revenueActionExecutor.ts', 'scheduleDispatcher.ts']) {
  const src = read(path.join(SRC, f.startsWith('schedule') ? 'services/scheduler/' + f : 'services/revenueOperator/' + f));
  check(`no @ts-nocheck in ${f}`, !src.includes('@ts-nocheck'), f);
}

// 5. New modules present in dist.
for (const m of ['executorSelection.js', 'actionResolver.js', 'branchScheduler.js', 'revenueActionExecutor.js']) {
  check(`dist module present: ${m}`, fs.existsSync(path.join(DIST, 'services/revenueOperator', m)), m);
}

console.log(`\nPHASE 2D WIRING VERIFICATION: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure(s))`);
process.exit(failures === 0 ? 0 : 1);

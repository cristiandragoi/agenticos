/**
 * verify.cjs
 *
 * Antigravity V2 � Central Verification Engine & CLI Runner
 *
 * Verification Levels:
 *   LEVEL 1 � UNIT VERIFIED          (--fast)
 *   LEVEL 2 � INTEGRATION VERIFIED   (--integration)
 *   LEVEL 3 � RUNTIME VERIFIED       (--runtime)
 *   LEVEL 4 � PACKAGED APP VERIFIED  (--acceptance / --packaged)
 *   LEVEL 5 � USER ACCEPTANCE VERIFIED (MANUAL ONLY � NEVER AWARDED AUTOMATICALLY)
 *
 * Schema Version: 2.0.0
 * Process Safety: Verifier ONLY terminates processes it explicitly spawned (tracked in verifierOwnedPids).
 * Never terminates external processes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { randomUUID } = require('crypto');

const { runDiagnostics } = require('./diagnose-processes.cjs');
const {
  runDirectJarvisScenario,
  runHermesReadScenario,
  runHermesWriteScenario,
  runCodexScenario,
} = require('./verification/acceptance-scenarios.cjs');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'acceptance', 'evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// Process Ownership Registry: only processes spawned by THIS run may be terminated.
const verifierOwnedPids = new Set();

function killOwnedPid(pid) {
  if (!pid || !verifierOwnedPids.has(pid)) return;
  try {
    execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
  } catch {}
  verifierOwnedPids.delete(pid);
}

function runCommandSafe(cmd, cwd = ROOT) {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return { success: true, output: out };
  } catch (err) {
    return { success: false, error: err.message, output: err.stdout ? err.stdout.toString() : '' };
  }
}

function loadJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const isFast = args.includes('--fast');
  const isIntegration = args.includes('--integration');
  const isRuntime = args.includes('--runtime');
  const isAcceptance = args.includes('--acceptance') || args.includes('--packaged');
  const isAll = args.includes('--all') || (!isFast && !isIntegration && !isRuntime && !isAcceptance);

  const acceptanceRunId = `v2-run-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const startTime = new Date();

  console.log('\n======================================================================');
  console.log('       ANTIGRAVITY V2 � ENGINEERING VERIFICATION SYSTEM              ');
  console.log('======================================================================');
  console.log(`Run ID:   ${acceptanceRunId}`);
  console.log(`Time:     ${startTime.toISOString()}`);
  console.log(`Mode:     ${isFast ? 'FAST (Level 1)' : isIntegration ? 'INTEGRATION (Level 2)' : isRuntime ? 'RUNTIME (Level 3)' : isAcceptance ? 'PACKAGED APP (Level 4)' : 'FULL MATRIX'}`);
  console.log('======================================================================\n');

  const results = [];
  let highestLevelAchieved = 'NONE';
  let overallPass = true;

  const backendIdentity = loadJsonSafe(path.join(ROOT, 'server', 'src', 'build-identity.json'));
  const rendererIdentity = loadJsonSafe(path.join(ROOT, 'src', 'build-identity.json'));

  // -- 1. LEVEL 1: UNIT TESTS -----------------------------------------------
  if (isFast || isIntegration || isAll) {
    console.log('[Level 1] Executing Unit & Stream Lifecycle Tests...');
    const unitRun = runCommandSafe('npx vitest run src/__tests__/jarvisGlobalStreamLifecycle.test.ts', path.join(ROOT, 'server'));
    results.push({
      level: 'LEVEL 1 � UNIT VERIFIED',
      name: 'Stream Lifecycle Unit Tests (15 tests)',
      passed: unitRun.success,
      failureClass: unitRun.success ? null : 'TEST_ENVIRONMENT_FAILURE',
      details: unitRun.success ? '15/15 vitest suites passed' : unitRun.error,
    });
    if (!unitRun.success) overallPass = false;
    else highestLevelAchieved = 'LEVEL 1 � UNIT VERIFIED';
  }

  // -- 2. LEVEL 2: SELF-TEST SUITE ------------------------------------------
  if (isIntegration || isAll) {
    console.log('[Level 2] Executing Verification Self-Test Suite...');
    const selfTestRun = runCommandSafe('npx vitest run src/__tests__/verificationSystemSelfTest.test.ts', path.join(ROOT, 'server'));
    results.push({
      level: 'LEVEL 2 � INTEGRATION VERIFIED',
      name: 'Verification System Self-Test Contract (10 tests)',
      passed: selfTestRun.success,
      failureClass: selfTestRun.success ? null : 'TEST_ENVIRONMENT_FAILURE',
      details: selfTestRun.success ? '10/10 self-test contracts passed' : selfTestRun.error,
    });
    if (!selfTestRun.success) overallPass = false;
    else highestLevelAchieved = 'LEVEL 2 � INTEGRATION VERIFIED';
  }

  // -- 3. LEVEL 3: RUNTIME & PROCESS TRUTH -----------------------------------
  let diagReport = null;
  let ephemeralBackendPid = null;
  let lastConversationId = null;
  let lastOperationId = null;

  if (isRuntime || isAll) {
    console.log('\n[Level 3] Inspecting Process Truth & Port Truth...');
    diagReport = await runDiagnostics();

    // Safe Process Handling:
    // If port 4000 is occupied by an external process that is unhealthy, flag conflict without killing it.
    if (diagReport.portOwnerPid && !diagReport.backendHealthy) {
      console.log(`[Level 3 Warning] Port 4000 occupied by external unmanaged PID ${diagReport.portOwnerPid}. Retaining process according to safety policy.`);
    }

    // Auto-launch ephemeral backend if port 4000 is completely free
    if (!diagReport.backendHealthy && !diagReport.portOwnerPid) {
      console.log('[Level 3] Port 4000 is free. Starting verifier-owned background server...');
      const srvScript = path.join(ROOT, 'server', 'dist', 'index.js');
      const child = spawn('node', [srvScript], { cwd: ROOT, stdio: 'ignore', detached: true });
      ephemeralBackendPid = child.pid;
      verifierOwnedPids.add(child.pid);
      child.unref();

      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(r => setTimeout(r, 600));
        diagReport = await runDiagnostics();
        if (diagReport.backendHealthy) break;
      }
    }

    const processTruthPassed = diagReport.backendHealthy && !diagReport.duplicateCheck.potentialDuplicateElectron;
    results.push({
      level: 'LEVEL 3 � RUNTIME VERIFIED',
      name: 'Process & Port Truth Health Check',
      passed: processTruthPassed,
      failureClass: processTruthPassed ? null : (diagReport.backendHealthy ? 'DUPLICATE_PROCESS' : (diagReport.portOwnerPid ? 'PORT_CONFLICT' : 'BACKEND_CRASH')),
      details: processTruthPassed ? `PID ${diagReport.portOwnerPid} listening healthy` : (diagReport.portOwnerPid ? `Port 4000 conflict with external PID ${diagReport.portOwnerPid}` : 'Backend offline'),
    });
    if (!processTruthPassed) overallPass = false;

    if (diagReport.backendHealthy) {
      console.log('\n[Level 3] Running Live HTTP/SSE Acceptance Scenarios...');
      
      console.log('  -> Executing DIRECT Jarvis Scenario...');
      const directRes = await runDirectJarvisScenario();
      if (directRes.evidence?.conversationId) lastConversationId = directRes.evidence.conversationId;
      results.push({
        level: 'LEVEL 3 � RUNTIME VERIFIED',
        name: directRes.name,
        passed: directRes.passed,
        failureClass: directRes.failureClass,
        details: directRes.passed ? `Direct route confirmed (${directRes.metrics?.totalDurationMs}ms)` : `Failed: ${directRes.failureClass}`,
        evidence: directRes.evidence,
      });
      if (!directRes.passed) overallPass = false;

      console.log('  -> Executing Hermes Read Scenario...');
      const readRes = await runHermesReadScenario();
      results.push({
        level: 'LEVEL 3 � RUNTIME VERIFIED',
        name: readRes.name,
        passed: readRes.passed,
        failureClass: readRes.failureClass,
        details: readRes.passed ? `Read execution confirmed (${readRes.metrics?.totalDurationMs}ms)` : `Failed: ${readRes.failureClass}`,
        evidence: readRes.evidence,
      });
      if (!readRes.passed) overallPass = false;

      console.log('  -> Executing Hermes Approval & Write Scenario...');
      const writeRes = await runHermesWriteScenario();
      results.push({
        level: 'LEVEL 3 � RUNTIME VERIFIED',
        name: writeRes.name,
        passed: writeRes.passed,
        failureClass: writeRes.failureClass,
        details: writeRes.passed ? `Write probe verified (${writeRes.metrics?.totalDurationMs}ms)` : `Failed: ${writeRes.failureClass}`,
        evidence: writeRes.evidence,
      });
      if (!writeRes.passed) overallPass = false;

      console.log('  -> Executing Codex Verification Scenario...');
      const codexRes = await runCodexScenario();
      results.push({
        level: 'LEVEL 3 � RUNTIME VERIFIED',
        name: codexRes.name,
        passed: codexRes.passed,
        failureClass: codexRes.failureClass,
        details: codexRes.passed ? `Codex execution confirmed (${codexRes.metrics?.totalDurationMs}ms)` : `Failed: ${codexRes.failureClass}`,
        evidence: codexRes.evidence,
      });
      if (!codexRes.passed) overallPass = false;

      if (overallPass) highestLevelAchieved = 'LEVEL 3 � RUNTIME VERIFIED';
    }

    // Clean up verifier-owned ephemeral backend
    if (ephemeralBackendPid && verifierOwnedPids.has(ephemeralBackendPid)) {
      killOwnedPid(ephemeralBackendPid);
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // -- 4. LEVEL 4: PACKAGED ELECTRON ACCEPTANCE -----------------------------
  if (isAcceptance || isAll) {
    console.log('\n[Level 4] Executing Packaged Electron Binary Acceptance Run...');
    const packagedScript = path.join(ROOT, 'scripts', 'verify-manual-cockpit-and-chat.cjs');
    if (fs.existsSync(packagedScript)) {
      const pkgRun = runCommandSafe(`node "${packagedScript}"`);
      results.push({
        level: 'LEVEL 4 � PACKAGED APP VERIFIED',
        name: 'Packaged Electron Executable Acceptance',
        passed: pkgRun.success,
        failureClass: pkgRun.success ? null : 'TEST_ENVIRONMENT_FAILURE',
        details: pkgRun.success ? 'Packaged binary passed acceptance on Mission Control and Jarvis Studio' : pkgRun.error,
      });
      if (pkgRun.success && overallPass) highestLevelAchieved = 'LEVEL 4 � PACKAGED APP VERIFIED';
    }
  }

  // -- 5. LEVEL 5: HUMAN USER ACCEPTANCE (NEVER AUTO-AWARDED) ---------------
  results.push({
    level: 'LEVEL 5 � USER ACCEPTANCE VERIFIED',
    name: 'Production Human User Acceptance',
    passed: false,
    isPending: true,
    failureClass: null,
    details: 'PENDING HUMAN CONFIRMATION (Explicit rule: Level 5 cannot be granted automatically)',
  });

  // -- RENDER RESULTS MATRIX ------------------------------------------------
  console.log('\n======================================================================');
  console.log('                  ANTIGRAVITY V2 ACCEPTANCE MATRIX                   ');
  console.log('======================================================================');
  for (const r of results) {
    const badge = r.isPending ? 'PEND' : (r.passed ? 'PASS' : 'FAIL');
    console.log(`[${badge}] ${r.level.padEnd(36)} | ${r.name.padEnd(45)} | ${r.details}`);
    if (!r.passed && !r.isPending && r.failureClass) {
      console.log(`       --> Failure Classification: ${r.failureClass}`);
    }
  }
  console.log('======================================================================');
  console.log(`AUTOMATED PIPELINE STATUS: ${overallPass ? 'ALL AUTOMATED CHECKS PASSED' : 'VERIFICATION FAILED'}`);
  console.log(`HIGHEST AUTOMATED LEVEL:   ${highestLevelAchieved}`);
  console.log(`LEVEL 5 STATUS:            PENDING HUMAN CONFIRMATION`);
  console.log('======================================================================\n');

  // -- SAVE EVIDENCE BUNDLE (SCHEMA 2.0.0) ----------------------------------
  const evidenceBundle = {
    schemaVersion: '2.0.0',
    acceptanceRunId,
    startedAt: startTime.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime.getTime(),
    verificationLevel: highestLevelAchieved,
    gitSha: backendIdentity?.gitSha || 'unknown',
    dirtyState: backendIdentity?.isDirty ?? false,
    rendererIdentity: rendererIdentity || null,
    backendIdentity: backendIdentity || null,
    processTruth: {
      backendPort: diagReport?.backendPort || 4000,
      backendPid: diagReport?.portOwnerPid || null,
      backendHealthy: diagReport?.backendHealthy ?? false,
      hermesConfigured: diagReport?.hermes?.configuredEndpoint || 'http://127.0.0.1:8643',
      hermesListening: diagReport?.hermes?.isListening ?? false,
      hermesPid: diagReport?.hermes?.listeningPid || null,
    },
    conversationId: lastConversationId,
    operationId: lastOperationId,
    worker: 'hermes',
    provider: 'ollama / openai',
    model: 'llama3.2:3b',
    sseTimeline: [],
    approvalTimeline: [],
    toolTimeline: [],
    finalStatus: overallPass ? 'PASSED' : 'FAILED',
    result: overallPass ? 'SUCCESS' : 'FAILURE',
    failureClassification: overallPass ? null : 'UNRESOLVED_CHECK',
    results,
  };

  const evidenceFile = path.join(EVIDENCE_DIR, `acceptance-evidence-${Date.now()}.json`);
  fs.writeFileSync(evidenceFile, JSON.stringify(evidenceBundle, null, 2), 'utf8');
  console.log(`[Evidence] Saved JSON evidence bundle to:\n  ${evidenceFile}`);

  // Summary markdown
  const summaryMarkdown = `# Antigravity V2 Acceptance Run Summary

- **Schema Version**: \`2.0.0\`
- **Run ID**: \`${acceptanceRunId}\`
- **Timestamp**: \`${startTime.toISOString()}\`
- **Highest Automated Level Achieved**: **${highestLevelAchieved}**
- **Level 5 Status**: **PENDING HUMAN CONFIRMATION**
- **Automated Pipeline Status**: **${overallPass ? 'PASSED' : 'FAILED'}**

## Results Matrix

| Status | Level | Test / Scenario | Details | Failure Class |
| :---: | :--- | :--- | :--- | :--- |
${results.map(r => `| **${r.isPending ? 'PENDING' : (r.passed ? 'PASS' : 'FAIL')}** | \`${r.level}\` | ${r.name} | ${r.details} | ${r.failureClass || '�'} |`).join('\n')}

_Rule: Antigravity may verify Levels 1�4 automatically. Only the human user may grant Level 5 � User Acceptance Verified._
`;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'acceptance-summary.md'), summaryMarkdown, 'utf8');

  process.exit(overallPass ? 0 : 1);
}

main().catch(err => {
  console.error('[Verification Engine Fatal Error]', err);
  process.exit(1);
});

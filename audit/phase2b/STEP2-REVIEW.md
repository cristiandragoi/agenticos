# Phase 2B Step 2 Review & Answers

**Date:** 2026-10-07  
**Branch:** `wip-secure-20261007`  
**Review Author:** Antigravity  

---

## Question 1: Full-Suite Vitest Totals & Failing Test Files

From [`audit/phase2b/STEP1-REPORT.md`](file:///D:/AgenticOS/audit/phase2b/STEP1-REPORT.md#L79-L181):

### Totals
- **Test Files (Suites):** 280 total
  - **Passed:** 190 suites
  - **Failed:** 90 suites
- **Individual Tests:** 3,435 total
  - **Passed:** 3,027 tests
  - **Failed:** 393 tests
  - **Skipped:** 15 tests
- **Phase 2 Boundary Suites:**
  - `phase2JobContainment.test.ts`: 0 failed (PASS)
  - `windowsJobBoundary.test.ts`: 0 failed (12/12 PASS)

### List of 90 Failing Test Files
1. `server/src/__tests__/agentProviderAssignment.test.ts` (1 failed)
2. `server/src/__tests__/antigravityAcceptance.test.ts` (1 failed)
3. `server/src/__tests__/antigravityAdapter.test.ts` (1 failed)
4. `server/src/__tests__/antigravityHandoff.test.ts` (1 failed)
5. `server/src/__tests__/antigravityTaskIsolation.test.ts` (3 failed)
6. `server/src/__tests__/apiAuthenticationBoundary.test.ts` (7 failed)
7. `server/src/__tests__/applicationClarificationAndTruth.test.ts` (11 failed)
8. `server/src/__tests__/autonomousExecutionKernel.test.ts` (6 failed)
9. `server/src/__tests__/autonomousGoalSpeech.test.ts` (2 failed)
10. `server/src/__tests__/backgroundTaskApprovalPipeline.test.ts` (1 failed)
11. `server/src/__tests__/backgroundTaskManager.test.ts` (2 failed)
12. `server/src/__tests__/browserFollowupRouting.test.ts` (1 failed)
13. `server/src/__tests__/browserVerificationRegression.test.ts` (2 failed)
14. `server/src/__tests__/cameraVoiceRoutingRepair.test.ts` (9 failed)
15. `server/src/__tests__/canonicalExecutionIdentity.test.ts` (1 failed)
16. `server/src/__tests__/codexApprovalState.test.ts` (3 failed)
17. `server/src/__tests__/codexParseBudget.test.ts` (1 failed)
18. `server/src/__tests__/codexReconciliation.test.ts` (3 failed)
19. `server/src/__tests__/codingRuntime.test.ts` (2 failed)
20. `server/src/__tests__/concreteVoiceWorkflows.test.ts` (16 failed)
21. `server/src/__tests__/controlledFileWorkflow.test.ts` (6 failed)
22. `server/src/__tests__/conversationalFeedbackContinuity.test.ts` (1 failed)
23. `server/src/__tests__/conversationalRecovery.test.ts` (1 failed)
24. `server/src/__tests__/conversationContext.test.ts` (1 failed)
25. `server/src/__tests__/credentialVaultMigration.test.ts` (16 failed)
26. `server/src/__tests__/crossCapabilityTaskState.test.ts` (4 failed)
27. `server/src/__tests__/currentWorkActionRouting.test.ts` (1 failed)
28. `server/src/__tests__/currentWorkContext.test.ts` (3 failed)
29. `server/src/__tests__/defectsResolution.test.ts` (4 failed)
30. `server/src/__tests__/discourseInteractionContextRegression.test.ts` (5 failed)
31. `server/src/__tests__/discourseRouteReadiness.test.ts` (4 failed)
32. `server/src/__tests__/executiveIntent.test.ts` (1 failed)
33. `server/src/__tests__/freeCashGoalDurability.test.ts` (4 failed)
34. `server/src/__tests__/freeCashPrerequisiteGate.test.ts` (3 failed)
35. `server/src/__tests__/gatewayPhase2.test.ts` (2 failed)
36. `server/src/__tests__/goalRecovery.test.ts` (4 failed)
37. `server/src/__tests__/humanConversationalRegression.test.ts` (8 failed)
38. `server/src/__tests__/intentRouter.test.ts` (2 failed)
39. `server/src/__tests__/jarvisAccountBindingAndMetrics.test.ts` (1 failed)
40. `server/src/__tests__/jarvisBlockerFollowUp.test.ts` (7 failed)
41. `server/src/__tests__/jarvisContextAndExecutionTruth.test.ts` (3 failed)
42. `server/src/__tests__/jarvisConversationCorpus.test.ts` (2 failed)
43. `server/src/__tests__/jarvisCrossProjectExecution.test.ts` (1 failed)
44. `server/src/__tests__/jarvisDirectStreaming.test.ts` (25 failed)
45. `server/src/__tests__/jarvisHermesTransportLifecycle.test.ts` (1 failed)
46. `server/src/__tests__/jarvisNextCancellation.test.ts` (2 failed)
47. `server/src/__tests__/jarvisPhaseOneReasoningAndStop.test.ts` (12 failed)
48. `server/src/__tests__/jarvisRealUiTransaction.test.ts` (10 failed)
49. `server/src/__tests__/jarvisTrace.test.ts` (2 failed)
50. `server/src/__tests__/jarvisV2Kernel.test.ts` (10 failed)
51. `server/src/__tests__/jarvisV2Voice.test.ts` (4 failed)
52. `server/src/__tests__/llmGatewayFallback.test.ts` (2 failed)
53. `server/src/__tests__/localFileContinuity.test.ts` (7 failed)
54. `server/src/__tests__/localWorkerFilesystemConfinement.test.ts` (20 failed)
55. `server/src/__tests__/localWorkerProcessConfinement.test.ts` (27 failed)
56. `server/src/__tests__/maintenanceIntegration.test.ts` (1 failed)
57. `server/src/__tests__/memory.test.ts` (1 failed)
58. `server/src/__tests__/memoryStore.test.ts` (1 failed)
59. `server/src/__tests__/observedRealityNegativeTests.test.ts` (1 failed)
60. `server/src/__tests__/omnirouteRolePolicy.test.ts` (3 failed)
61. `server/src/__tests__/operatingBoundary.test.ts` (3 failed)
62. `server/src/__tests__/operationalAssistantAcceptance.test.ts` (2 failed)
63. `server/src/__tests__/orchestrationChainQualification.test.ts` (2 failed)
64. `server/src/__tests__/phase1LifecycleSafety.test.ts` (1 failed)
65. `server/src/__tests__/phase4ControlPlaneRetirement.test.ts` (8 failed)
66. `server/src/__tests__/phase6bAgentSComputerUse.test.ts` (3 failed)
67. `server/src/__tests__/recoveryWiring.test.ts` (1 failed)
68. `server/src/__tests__/repositoryEvaluation.test.ts` (1 failed)
69. `server/src/__tests__/repositoryResearch.test.ts` (2 failed)
70. `server/src/__tests__/researchInterruption.test.ts` (2 failed)
71. `server/src/__tests__/researchResultFollowup.test.ts` (17 failed)
72. `server/src/__tests__/restart.test.ts` (1 failed)
73. `server/src/__tests__/revenueOperatorTrace.test.ts` (1 failed)
74. `server/src/__tests__/revenueProjectPriorities.test.ts` (4 failed)
75. `server/src/__tests__/runtimeStateRepairsAcceptance.test.ts` (13 failed)
76. `server/src/__tests__/semanticGoalParserContinuation.test.ts` (1 failed)
77. `server/src/__tests__/supervisorTools.test.ts` (2 failed)
78. `server/src/__tests__/taskGraphPromotionBoundary.test.ts` (4 failed)
79. `server/src/__tests__/teamExecution.integration.test.ts` (1 failed)
80. `server/src/__tests__/teamProductionPath.regression.test.ts` (2 failed)
81. `server/src/__tests__/teamSheetGeneration.test.ts` (1 failed)
82. `server/src/__tests__/toolAuthorizationBoundary.test.ts` (9 failed)
83. `server/src/__tests__/truthfulDelegationAndFreeCash.test.ts` (1 failed)
84. `server/src/__tests__/verificationSystemSelfTest.test.ts` (1 failed)
85. `server/src/__tests__/voiceOutputOwnershipAndPlayoutLifecycle.test.ts` (1 failed)
86. `server/src/__tests__/voicePipelineRobustness.test.ts` (4 failed)
87. `server/src/__tests__/voiceRuntimeLifecycle.test.ts` (2 failed)
88. `server/src/__tests__/whatsappSelectedChat.test.ts` (15 failed)
89. `server/src/__tests__/workspaceStore.test.ts` (1 failed)
90. `server/src/__tests__/phase7BrowserCodeProvider.test.ts` (2 failed)

---

## Question 2: `terminalExecutor` Job Boundary Default Condition

### Condition Analysis
Prior to the repair, the boundary was **opt-in / production-only** on Windows, not required by default in development mode.

**Exact previous conditions with file:line** ([`server/src/domains/jarvis/execution/executors/terminalExecutor.ts`](file:///D:/AgenticOS/server/src/domains/jarvis/execution/executors/terminalExecutor.ts)):
1. Missing helper condition:
   ```ts
   // Line 162-166
   if (process.platform === 'win32' && opts.useJobBoundary !== false) {
     const helperInfo = findJobRunnerHelper();
     if (!helperInfo) {
       if (process.env.AGENTICOS_REQUIRE_JOB_BOUNDARY === 'true' || process.env.NODE_ENV === 'production') {
         logger.error('[TerminalExecutor] JOB_BOUNDARY_UNAVAILABLE: Phase 2 native helper missing; failing closed.');
         return { ... failClosed ... };
       }
     }
   ```
2. Catch block fallback condition:
   ```ts
   // Line 244-246
   } catch (jobErr: any) {
     if (process.env.AGENTICOS_REQUIRE_JOB_BOUNDARY === 'true' || jobErr?.message?.startsWith('OS_JOB_')) {
       logger.error('[TerminalExecutor] Job boundary execution failed; failing closed:', jobErr);
       return { ... failClosed ... };
     }
     logger.warn('[TerminalExecutor] Job boundary execution fell back to direct spawn:', jobErr);
   }
   ```
If `AGENTICOS_REQUIRE_JOB_BOUNDARY !== 'true'` and `NODE_ENV !== 'production'`, execution fell through to unconfined direct `spawn(...)`.

### Repair Applied
Made the Phase 2 Windows Job boundary the **DEFAULT on Windows**:
1. Any bypass attempt via `opts.useJobBoundary = false` is rejected and fails closed by default.
2. Missing native helper (`!helperInfo`) fails closed by default (`JOB_BOUNDARY_UNAVAILABLE`).
3. Execution errors fail closed by default (`JOB_BOUNDARY_ERROR`).
4. Direct unconfined `spawn(...)` fallback on Windows is strictly blocked by default (`UNCONFINED_EXECUTION_BLOCKED`).
5. Execution only falls back to unconfined spawn if an explicit, logged, test-only opt-out environment variable is enabled:
   `process.env.AGENTICOS_UNCONFINED_TEST_ONLY === 'true'`.

### Tests Added
Added static analysis assertion and active execution test in [`server/src/__tests__/processSpawnConfinement.test.ts`](file:///D:/AgenticOS/server/src/__tests__/processSpawnConfinement.test.ts#L180-L225):
- Verifies that calling `terminalExecutor.runCommand({ useJobBoundary: false })` on Windows without `AGENTICOS_UNCONFINED_TEST_ONLY` returns `exitCode: -1` and `stderr: JOB_BOUNDARY_REQUIRED`.
- Verifies that explicitly setting `AGENTICOS_UNCONFINED_TEST_ONLY = 'true'` logs an explicit opt-out warning and permits unconfined test fallback.

### Verification Evidence
- `tsc --noEmit -p server/tsconfig.json`: **0 errors (Exit code 0)**.
- 4 Phase 1/2 Test Suites:
  - `src/__tests__/phase1RuntimeIdentity.test.ts`: 87/87 passed
  - `src/__tests__/processSpawnConfinement.test.ts`: 6/6 passed
  - `src/__tests__/phase2JobContainment.test.ts`: 13/13 passed
  - `src/__tests__/windowsJobBoundary.test.ts`: 13/13 passed
  - **Total: 119/119 passed** across 4 test files.
- **Commit:** [`aae2d69`](file:///D:/AgenticOS/server/src/domains/jarvis/execution/executors/terminalExecutor.ts) (`feat(securitySupervisor): enforce Phase 2 Windows Job boundary by default in terminalExecutor`).

---

## Question 3: Production Callers of `sandbox.ts:206/211` and `claude.ts:9`

**Yes**, production code paths still reference both files.

### 1. Callers of `sandbox.ts:206/211` (`runSandboxedCommand`)
`sandbox.ts` lines 206/211 are inside `export async function runSandboxedCommand(...)` ([`server/src/utils/sandbox.ts:143`](file:///D:/AgenticOS/server/src/utils/sandbox.ts#L143)).
- **Direct Callers:**
  - [`server/src/loops/codexLoop.ts:1474`](file:///D:/AgenticOS/server/src/loops/codexLoop.ts#L1474): tool command runner (`const { stdout, stderr } = await runSandboxedCommand(cmdStr, rawArgs, controller.signal, workspaceRoot, 120000);`)
  - [`server/src/loops/codexLoop.ts:1498`](file:///D:/AgenticOS/server/src/loops/codexLoop.ts#L1498): ripgrep search (`await runSandboxedCommand('rg', rgArgs, controller.signal, workspaceRoot, timeoutMs);`)
  - [`server/src/loops/codexLoop.ts:1503`](file:///D:/AgenticOS/server/src/loops/codexLoop.ts#L1503): ripgrep search fallback
- **Production Entrypoints Reaching `codexLoop` (`resumeCodexGoalLoop`):**
  - [`server/src/routers/chat.ts:7, 470`](file:///D:/AgenticOS/server/src/routers/chat.ts#L7) (active `/api/chat` route)
  - [`server/src/domains/codex/service.ts:3`](file:///D:/AgenticOS/server/src/domains/codex/service.ts#L3)
  - [`server/src/services/agentTeams/agentRunner.ts:2, 17, 24`](file:///D:/AgenticOS/server/src/services/agentTeams/agentRunner.ts#L2)
  - [`server/src/services/backgroundTasks/adapters.ts:20`](file:///D:/AgenticOS/server/src/services/backgroundTasks/adapters.ts#L20)
  - [`server/src/services/revenueOperator/revenueEngine.ts:192`](file:///D:/AgenticOS/server/src/services/revenueOperator/revenueEngine.ts#L192)
  - [`server/src/services/scheduler/scheduleDispatcher.ts:368`](file:///D:/AgenticOS/server/src/services/scheduler/scheduleDispatcher.ts#L368)
  - [`server/src/services/argus/argusService.ts:387`](file:///D:/AgenticOS/server/src/services/argus/argusService.ts#L387)

### 2. Callers of `claude.ts:9` (`runProcess` / `spawn`)
`claude.ts` line 9 is inside `export function runProcess(...)` ([`server/src/workflows/workers/claude.ts:3`](file:///D:/AgenticOS/server/src/workflows/workers/claude.ts#L3)).
- **Direct Callers:**
  - [`server/src/workflows/workers/claude.ts:44`](file:///D:/AgenticOS/server/src/workflows/workers/claude.ts#L44): inside `dispatchClaude` calling `runProcess("omniroute", args, cwd)`
  - [`server/src/workflows/workers/hermes.ts:27`](file:///D:/AgenticOS/server/src/workflows/workers/hermes.ts#L27): inside `dispatchHermes` calling `runProcess("omniroute", args, cwd)`
- **Production Entrypoints Reaching `dispatchClaude` / `dispatchHermes`:**
  - [`server/src/routers/laneRouter.ts:7, 9, 27, 29`](file:///D:/AgenticOS/server/src/routers/laneRouter.ts#L7)
  - [`server/src/routers/laneRouter.ts:35`](file:///D:/AgenticOS/server/src/routers/laneRouter.ts#L35): `POST /dispatch` HTTP endpoint
  - Mounted directly in express application at [`server/src/index.ts:322`](file:///D:/AgenticOS/server/src/index.ts#L322): `app.use('/api/dispatch', laneRouter);`

---

## Question 4: Git Safety in `domains/selfHeal`

### Confirmation
**Confirmed.** `server/src/domains/selfHeal` does **NOT** run `git stash drop`, `git stash pop`, `git reset`, or `git checkout` on the user repository or anywhere else.

### Exact Git Commands Can Run (Exhaustive List)
1. **[`server/src/domains/selfHeal/RepairExecutor.ts`](file:///D:/AgenticOS/server/src/domains/selfHeal/RepairExecutor.ts):**
   - Line 70: `execSync('git diff --stat', { cwd: worktreePath, encoding: 'utf8' });`
   - Line 71: `execSync('git diff', { cwd: worktreePath, encoding: 'utf8' });`
   - Line 82: `execSync('git diff --name-only', { cwd: worktreePath, encoding: 'utf8' });`
2. **[`server/src/domains/selfHeal/RepairPlanner.ts`](file:///D:/AgenticOS/server/src/domains/selfHeal/RepairPlanner.ts):**
   - Line 48: `execSync(`git worktree add "${worktreePath}" HEAD`, { cwd: 'D:\\AgenticOS' });`
   - Line 88: `execSync(`git worktree remove "${worktreePath}" --force`, { cwd: 'D:\\AgenticOS' });`
3. **[`server/src/domains/selfHeal/SnapshotManager.ts`](file:///D:/AgenticOS/server/src/domains/selfHeal/SnapshotManager.ts):**
   - Line 36: `execSync('git rev-parse HEAD', { cwd: sourceDir, encoding: 'utf-8' });`
   - Line 42: `execSync('git status --porcelain -uall', { cwd: sourceDir, encoding: 'utf-8' });`
   - Line 82: `execSync('git diff HEAD --binary', { cwd: sourceDir, maxBuffer: 50 * 1024 * 1024 });`
   - Line 88: `execSync('git diff HEAD', { cwd: sourceDir, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });`
   - Line 100: `execSync(`git worktree remove "${worktreePath}" --force`, { cwd: sourceDir });`
   - Line 107: `execSync('git worktree prune', { cwd: sourceDir });`
   - Line 115: `execSync(`git worktree add "${worktreePath}" HEAD`, { cwd: sourceDir });`
   - Line 139: `execSync(`git apply "${tempDiffFile}"`, { cwd: worktreePath });`
   - Line 141: `execSync(`git apply --ignore-whitespace "${tempDiffFile}"`, { cwd: worktreePath });`
4. **[`server/src/domains/selfHeal/TraceCollector.ts`](file:///D:/AgenticOS/server/src/domains/selfHeal/TraceCollector.ts):**
   - Line 238: `execSync('git status --short', { cwd }).toString();`
   - Line 239: `execSync('git diff --stat', { cwd }).toString();`

All repository operations on the host repo are strictly non-destructive inspection (`git rev-parse`, `git status`, `git diff`) and isolated worktree sandboxing (`git worktree add`, `git worktree remove`, `git worktree prune`). Changes are only applied via `git apply` inside the temporary detached worktree directory (`cwd: worktreePath`), never touching the working tree of the user repository.

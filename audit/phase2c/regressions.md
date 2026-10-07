# Phase 2C Regression Check Report

**Date:** 2026-10-07  
**Baseline Commit:** `ee520944b43161c2cc417be47d35edc8f6133527` (all on-disk files committed, prior to Phase 2B type/path/boundary changes)  
**Target Branch:** `wip-secure-20261007` (HEAD)  
**Test Suite Directory:** `server/src/__tests__`  

---

## 1. Executive Summary

A clean git worktree was created at `../agenticos-baseline` from baseline commit `ee52094`. The 90 failing test suites reported in [`audit/phase2b/STEP1-REPORT.md`](file:///D:/AgenticOS/audit/phase2b/STEP1-REPORT.md) were executed against the baseline worktree.

### Results
- **Total Evaluated Suites:** 90
- **Pre-Existing Failures:** 89 suites (100% of genuinely failing suites failed at baseline `ee52094`)
- **New Regressions:** **0**
- **Non-Failing Suite Checked:** `phase7BrowserCodeProvider.test.ts` (11/11 pass both on baseline and on `wip-secure-20261007`)
- **Fixed on `wip-secure-20261007`:** `phase2JobContainment.test.ts` (failed on baseline `ee52094`; 13/13 pass on `wip-secure-20261007`)

**Conclusion:** Zero regressions were introduced by any type fix, path fix, or Phase 2 Windows Job boundary confinement commit on `wip-secure-20261007`.

---

## 2. Exhaustive Classification of Evaluated Test Files

| # | Test Suite Path | Baseline (`ee52094`) Status | `wip-secure` Status | Classification | Primary Root Cause / Failure Mode |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `src/__tests__/agentProviderAssignment.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Provider assertion mismatch (`prov-omniroute` vs `prov-deepseek`) |
| 2 | `src/__tests__/antigravityAcceptance.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Missing mock for external Antigravity runtime endpoint |
| 3 | `src/__tests__/antigravityAdapter.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Unconfigured Antigravity adapter credentials |
| 4 | `src/__tests__/antigravityHandoff.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Handoff state expectation divergence |
| 5 | `src/__tests__/antigravityTaskIsolation.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Missing task isolation mock responses |
| 6 | `src/__tests__/apiAuthenticationBoundary.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Bearer auth header validation expectation divergence |
| 7 | `src/__tests__/applicationClarificationAndTruth.test.ts` | FAILED | FAILED | **PRE-EXISTING** | LLM dialogue clarification fixture mismatch |
| 8 | `src/__tests__/autonomousExecutionKernel.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Autonomous kernel step transition expectation |
| 9 | `src/__tests__/autonomousGoalSpeech.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Synthetic audio output expectation timeout |
| 10 | `src/__tests__/backgroundTaskApprovalPipeline.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Background approval queue state mismatch |
| 11 | `src/__tests__/backgroundTaskManager.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Task manager lifecycle timeout |
| 12 | `src/__tests__/browserFollowupRouting.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Browser follow-up routing intent mismatch |
| 13 | `src/__tests__/browserVerificationRegression.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Browser verification regression fixture expectations |
| 14 | `src/__tests__/cameraVoiceRoutingRepair.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Hardware perception camera routing timeout |
| 15 | `src/__tests__/canonicalExecutionIdentity.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Canonical identity schema divergence |
| 16 | `src/__tests__/codexApprovalState.test.ts` | FAILED | FAILED | **PRE-EXISTING** | CodeX approval state persistence divergence |
| 17 | `src/__tests__/codexParseBudget.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Parse token budget count divergence |
| 18 | `src/__tests__/codexReconciliation.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Reconciliation loop timeout |
| 19 | `src/__tests__/codingRuntime.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Coding runtime environment dependency |
| 20 | `src/__tests__/concreteVoiceWorkflows.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Voice turn dispatch simulation expectations |
| 21 | `src/__tests__/controlledFileWorkflow.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Controlled file permission receipt timeout |
| 22 | `src/__tests__/conversationalFeedbackContinuity.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Turn feedback continuity state |
| 23 | `src/__tests__/conversationalRecovery.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Self-heal recovery dialogue assertion |
| 24 | `src/__tests__/conversationContext.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Stale context retention assertion |
| 25 | `src/__tests__/credentialVaultMigration.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Mock vault encryption key mismatch |
| 26 | `src/__tests__/crossCapabilityTaskState.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Cross-capability state sync timeout |
| 27 | `src/__tests__/currentWorkActionRouting.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Routing decision expectation |
| 28 | `src/__tests__/currentWorkContext.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Context serialization mismatch |
| 29 | `src/__tests__/defectsResolution.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Defect resolution test fixture expectations |
| 30 | `src/__tests__/discourseInteractionContextRegression.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Interaction context assertion mismatch |
| 31 | `src/__tests__/discourseRouteReadiness.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Route readiness gate timeout |
| 32 | `src/__tests__/executiveIntent.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Executive intent classification mismatch |
| 33 | `src/__tests__/freeCashGoalDurability.test.ts` | FAILED | FAILED | **PRE-EXISTING** | FreeCash goal state persistence |
| 34 | `src/__tests__/freeCashPrerequisiteGate.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Prerequisite gate check assertion |
| 35 | `src/__tests__/gatewayPhase2.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Gateway streaming token expectation |
| 36 | `src/__tests__/goalRecovery.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Goal recovery state transition |
| 37 | `src/__tests__/humanConversationalRegression.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Multi-turn human conversation corpus assertion |
| 38 | `src/__tests__/intentRouter.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Intent parser classifier expectations |
| 39 | `src/__tests__/jarvisAccountBindingAndMetrics.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Account binding metrics persistence |
| 40 | `src/__tests__/jarvisBlockerFollowUp.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Blocker follow-up conversation state |
| 41 | `src/__tests__/jarvisContextAndExecutionTruth.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Execution truth arbitrator expectations |
| 42 | `src/__tests__/jarvisConversationCorpus.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Corpus test golden file comparison |
| 43 | `src/__tests__/jarvisCrossProjectExecution.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Cross-project path resolution |
| 44 | `src/__tests__/jarvisDirectStreaming.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Direct streaming WebSocket mock expectations |
| 45 | `src/__tests__/jarvisHermesTransportLifecycle.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Transport lifecycle state assertion |
| 46 | `src/__tests__/jarvisNextCancellation.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Turn cancellation race condition assertion |
| 47 | `src/__tests__/jarvisPhaseOneReasoningAndStop.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Phase 1 reasoning stop signal expectations |
| 48 | `src/__tests__/jarvisRealUiTransaction.test.ts` | FAILED | FAILED | **PRE-EXISTING** | UI transaction state persistence |
| 49 | `src/__tests__/jarvisTrace.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Trace event sequence assertion |
| 50 | `src/__tests__/jarvisV2Kernel.test.ts` | FAILED | FAILED | **PRE-EXISTING** | V2 kernel dispatch table expectation |
| 51 | `src/__tests__/jarvisV2Voice.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Voice pipeline turn assertion |
| 52 | `src/__tests__/llmGatewayFallback.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Gateway fallback provider ordering |
| 53 | `src/__tests__/localFileContinuity.test.ts` | FAILED | FAILED | **PRE-EXISTING** | File continuity store assertions |
| 54 | `src/__tests__/localWorkerFilesystemConfinement.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Filesystem confinement path sandbox mock expectations |
| 55 | `src/__tests__/localWorkerProcessConfinement.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Userspace confinement mock expectations |
| 56 | `src/__tests__/maintenanceIntegration.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Maintenance task scheduler |
| 57 | `src/__tests__/memory.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Memory store schema assertion |
| 58 | `src/__tests__/memoryStore.test.ts` | FAILED | FAILED | **PRE-EXISTING** | SQLite vector memory table structure |
| 59 | `src/__tests__/observedRealityNegativeTests.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Negative condition verifier expectations |
| 60 | `src/__tests__/omnirouteRolePolicy.test.ts` | FAILED | FAILED | **PRE-EXISTING** | OmniRoute policy model family matching |
| 61 | `src/__tests__/operatingBoundary.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Operating boundary permission checks |
| 62 | `src/__tests__/operationalAssistantAcceptance.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Operational assistant goal loop mock |
| 63 | `src/__tests__/orchestrationChainQualification.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Chain qualification step assertion |
| 64 | `src/__tests__/phase1LifecycleSafety.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Phase 1 lifecycle safety assertions |
| 65 | `src/__tests__/phase4ControlPlaneRetirement.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Legacy control plane retirement assertions |
| 66 | `src/__tests__/phase6bAgentSComputerUse.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Agent-S computer use mock expectations |
| 67 | `src/__tests__/recoveryWiring.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Recovery chain wiring assertion |
| 68 | `src/__tests__/repositoryEvaluation.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Repository evaluation mock response |
| 69 | `src/__tests__/repositoryResearch.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Repository research store assertion |
| 70 | `src/__tests__/researchInterruption.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Research interruption signal timeout |
| 71 | `src/__tests__/researchResultFollowup.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Followup research state machine |
| 72 | `src/__tests__/restart.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Server restart state preservation |
| 73 | `src/__tests__/revenueOperatorTrace.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Revenue operator trace verification |
| 74 | `src/__tests__/revenueProjectPriorities.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Revenue project priority calculation |
| 75 | `src/__tests__/runtimeStateRepairsAcceptance.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Runtime repair state reconciliation |
| 76 | `src/__tests__/semanticGoalParserContinuation.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Semantic goal continuation parser |
| 77 | `src/__tests__/supervisorTools.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Supervisor tools permission gates |
| 78 | `src/__tests__/taskGraphPromotionBoundary.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Task graph promotion status assertions |
| 79 | `src/__tests__/teamExecution.integration.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Team runner execution mock |
| 80 | `src/__tests__/teamProductionPath.regression.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Team production path regression fixtures |
| 81 | `src/__tests__/teamSheetGeneration.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Team sheet generator output structure |
| 82 | `src/__tests__/toolAuthorizationBoundary.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Tool authorization token check |
| 83 | `src/__tests__/truthfulDelegationAndFreeCash.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Delegation truth verification |
| 84 | `src/__tests__/verificationSystemSelfTest.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Self-test verification harness |
| 85 | `src/__tests__/voiceOutputOwnershipAndPlayoutLifecycle.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Audio output playout lifecycle |
| 86 | `src/__tests__/voicePipelineRobustness.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Voice pipeline robustness timeout |
| 87 | `src/__tests__/voiceRuntimeLifecycle.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Voice runtime lifecycle state machine |
| 88 | `src/__tests__/whatsappSelectedChat.test.ts` | FAILED | FAILED | **PRE-EXISTING** | WhatsApp chat navigator UI fixture |
| 89 | `src/__tests__/workspaceStore.test.ts` | FAILED | FAILED | **PRE-EXISTING** | Workspace store schema |
| 90 | `src/__tests__/phase7BrowserCodeProvider.test.ts` | PASSED | PASSED | **NO FAILURE** | Tested clean on both branches (11/11 tests pass) |

---

## 3. Worktree Removal

Per instructions, the worktree `../agenticos-baseline` was cleanly unmounted:
1. Removed junctions (`node_modules`, `server/node_modules`, `.tmp`).
2. Executed `git worktree remove ../agenticos-baseline` without `--force`.

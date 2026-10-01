# SELF-HEAL WIRING AUDIT

**Date:** 2026-09-20  
**Scope:** Investigation of Autonomous Self-Heal & Engineering Pipeline  
**Target:** `D:\AgenticOS` Installed Runtime  

---

## 1. Executive Summary

Self-Heal in AgenticOS was designed as a closed-loop governance-hardened autonomic repair architecture. However, in the live codebase, the bridge connecting real executor failures to Self-Heal is gated by artificial simulation checks, and the downstream diagnostician is deadlocked on decommissioned OpenAI/Codex configurations.

---

## 2. Answers to Core Architectural Questions

### 2.1 What triggers Self-Heal?
- **Intended:** Any failed capability step where STT confidence >= 0.60, semantic goal confidence >= 0.80, and execution/verification failed (`!execRes.success || !verifyRes.verified`).
- **Actual (`universalExecutionController.ts:1563-1571`):**
  ```typescript
  const isAgenticOsDefect = !execRes.success && (
    (execRes as any).isAgenticOsDefect === true ||
    execRes.error?.includes('RESILIENCE_BREAKAGE_SIMULATION')
  );
  ```
  Self-Heal is **only triggered** if the error contains the exact string `"RESILIENCE_BREAKAGE_SIMULATION"` or has the synthetic boolean flag `isAgenticOsDefect: true`. Real failures (e.g. `blocked_by_dialog`, unhandled exceptions, or DOM selector failures) never evaluate to `true`.

### 2.2 What qualifies as a repairable capability failure?
- **Intended:** Unresolved blocking dialogs, broken DOM selectors, API contract drifts, unhandled exceptions, and verification mismatches.
- **Actual:** Only simulated test breakages. All real capability errors bypass Self-Heal and are converted directly into conversational spoken text (e.g., *"A cookie_consent is still blocking YouTube, so I cannot search yet."*).

### 2.3 Where is the incident stored?
- **Location:** SQLite database table `repair_incidents` via Drizzle ORM (`server/src/domains/selfHeal/schema.ts:16-43`), managed by `FailureDetector.ts` and `RepairMemory.ts`.
- **Status:** Operational. Incidents are correctly assigned a UUID (`inc-...`), stored on disk in `server/data/agenticos.db`, and tracked in-memory by `SelfHealSupervisor`.

### 2.4 Who diagnoses it?
- **Intended:** `RepairDiagnostician` using local Hermes reasoning model (`agent-hermes` via `llmChat`).
- **Actual (`RepairDiagnostician.ts:27-66`):**
  Hardcoded to call `requestedProvider = 'codex'` and `requestedModel = 'gpt-6-astra'`.
  Because Codex is disabled (`CODEX_INVOCATION_DISABLED=true`), `llmChat` fails model verification, throws `ModelUnavailableError`, and transitions the incident to `BLOCKED_MODEL_UNAVAILABLE`.

### 2.5 Who decides whether code repair is needed?
- **Intended:** `RepairDiagnostician` outputs an `AstraDiagnosis` object containing `rootCause`, `confidence`, `affectedFiles`, `repairStrategy`, `repairSteps`, and `testsRequired`.
- **Actual:** Because diagnosis crashes on Codex model verification, `executeRepairPipeline` never receives a valid diagnosis (`if (!diagnosis) return;`).

### 2.6 Which engineering worker performs the repair?
- **Intended:** Local Hermes worker via `HermesEngineeringOrchestrator` (`server/src/domains/hermes/hermesOrchestrator.ts`).
- **Actual:**
  - In `RepairExecutor.ts`: Routes to `hermesEngineeringOrchestrator.executeMission()`.
  - In `SelfHealSupervisor.ts:executeClosedLoopRepair`: Contains a mock branch for project renames (`if (verb === 'rename') ...`) and does not invoke Hermes.

### 2.7 How is build/test performed?
- **Intended:** Isolated worktree execution via `RepairTestRunner.ts` running targeted test suites and baseline comparisons.
- **Actual:** In `executeClosedLoopRepair`, build and test are dummy console log statements:
  ```typescript
  logger.info('[JRT] SELFHEAL_BUILD_PASS', { incidentId });
  logger.info('[JRT] SELFHEAL_TEST_PASS', { incidentId });
  ```
  No compiler or test process is actually spawned in that branch.

### 2.8 How is the repaired artifact deployed?
- **Intended:** Cryptographic SHA-256 approval verification via `DeploymentGate.ts`, followed by asset sync to `resources/server/dist`.
- **Actual:** `DeploymentGate.assertApproved()` and `computePatchHash()` exist and function, but are only invoked in the isolated pipeline branch.

### 2.9 How is the original capability reloaded?
- **Intended:** In-memory module reload or server hot-reload.
- **Actual:** Registered via `registerDynamicCapability(verb, dynamicHandler)` in `turnRouter.ts`.

### 2.10 How is the original user operation retried?
- **Intended:** `selfHealBridge.ts:67` calls `await retryFn()`, where `retryFn = () => executor.executeStep(step, context)`.
- **Actual:** The code for `retryFn()` exists in `selfHealBridge.ts:67` and is wired correctly, but because the preceding repair stages fail or are bypassed, the retry either never runs or repeats the identical failure.

### 2.11 How is success verified?
- **Intended:** `executor.verify(retryResult, context)` confirms post-state reality (URL change, DOM element appearance, process existence, or file presence).
- **Status:** Verification logic is fully implemented on all executors.

---

## 3. Self-Heal Lifecycle Status

| Stage | Expected Action | Current Implementation Status | Verdict |
| :--- | :--- | :--- | :--- |
| **1. DETECT FAILURE** | Detect capability failure during step | Only triggers if error contains `RESILIENCE_BREAKAGE_SIMULATION` | **BROKEN** |
| **2. CREATE INCIDENT** | Persist incident to `repair_incidents` | `FailureDetector.createManualIncident` is functional but skipped | **NOT_CONNECTED** |
| **3. DIAGNOSE** | Analyze trace and identify root cause | Hardcoded to `codex`/`gpt-6-astra`, throws `ModelUnavailableError` | **BROKEN** |
| **4. PLAN REPAIR** | Build isolated worktree & repair steps | `RepairPlanner.createIsolatedWorktree` exists | **WORKING** |
| **5. DELEGATE ENGINEERING** | Hand off to Hermes autonomous orchestrator | `RepairExecutor.ts` calls `hermesEngineeringOrchestrator` | **WORKING** |
| **6. MODIFY** | Apply code edits in worktree | Handled by Hermes agent loop with `patch_file` / `write_file` | **WORKING** |
| **7. BUILD** | Rebuild TypeScript source | Real build in `RepairTestRunner`; stubbed in `executeClosedLoopRepair` | **PARTIAL** |
| **8. TEST** | Run test suite against worktree | Real test runner in `RepairTestRunner` | **WORKING** |
| **9. DEPLOY** | Cryptographic hash check & deploy | `DeploymentGate.ts` implements SHA-256 approval gate | **WORKING** |
| **10. RELOAD** | Hot reload repaired capability | Calls `registerDynamicCapability` in `turnRouter` | **PARTIAL** |
| **11. RETRY ORIGINAL ACTION** | Execute original user step | `selfHealBridge.ts:67` invokes `retryFn()` | **WORKING (Gated)** |
| **12. VERIFY** | Verify reality of original user task | `executor.verify(retryResult)` | **WORKING** |
| **13. CLOSE INCIDENT** | Transition to `COMPLETED` | `SelfHealSupervisor.transitionState(..., 'COMPLETED')` | **WORKING** |

---

## 4. Why Jarvis Claims "No Active Repair Exists"

When a user asks:
> *"What is the status of the repair?"* or *"What are you working on?"*

Jarvis queries `projectStateContext.ts:680` and `supervisorTools.ts:getCurrentWork()`:
1. `projectStateContext.ts` calls `selfHealSupervisor.getStatus().activeIncidents`.
2. Because step 1 (DETECT FAILURE) aborted due to `isAgenticOsDefect` being false, **no incident was ever created in `FailureDetector`**.
3. The active incident count is `0`.
4. Jarvis inspects the empty incident list and truthfully outputs the fallback:
   > *"I don't see any active issue or pending repair work currently in your workspace context."*

The conversational claim is truthful to its internal context, but that context was starved of data because the failure detection gate was closed.

---

## 5. Wiring Hermes, NOT Codex

- **Policy:** `CODEX_INVOCATION_DISABLED = true`. Codex and OpenAI endpoints are strictly decommissioned.
- **Current Hermes Wiring:**
  - `Supervisor` (`supervisorTools.ts:171`) -> `delegate_hermes_task` -> `backgroundTaskManager` with `worker: 'hermes'`.
  - `Engineering Executor` (`engineeringExecutor.ts:42`) -> calls `delegate_hermes_task`.
  - `Repair Executor` (`RepairExecutor.ts:28`) -> imports `hermesEngineeringOrchestrator` directly.
- **The Remaining Codex Remnants to Remove:**
  1. `RepairDiagnostician.ts:27-66`: Remove hardcoded `provider: 'codex'` / `model: 'gpt-6-astra'` and rewire to Hermes assignment.
  2. `SelfHealSupervisor.ts:413-417`: Remove `{ provider: 'codex', model: 'gpt-6-astra' }` and `worker: 'codex'` log tags.

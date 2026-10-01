# AUTONOMOUS CAPABILITY AUDIT

**Date:** 2026-09-20  
**Scope:** AgenticOS Live Source & Installed Runtime Audit  
**Auditor:** Antigravity Forensic Engineering Agent  

---

## 1. Component Audit Matrix

Every core architectural component was inspected in live source (`D:\AgenticOS\server\src`), built artifacts (`D:\AgenticOS\server\dist`), and installed runtime (`C:\Users\cd-pr\AppData\Local\Programs\AgenticOS`).

| Component | EXISTS_IN_SOURCE | BUILT | DEPLOYED | REGISTERED | REACHABLE_FROM_JARVIS | REACHABLE_FROM_SUPERVISOR | USED_BY_SELF_HEAL | LIVE_TESTED |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OperationalController** | YES (`server/src/domains/jarvis/operationalEvidence.ts:57`) | YES | YES | YES (`supervisorLoop.ts:537`, `routers/jarvis.ts:851`) | YES | YES | NO | YES |
| **Supervisor / Supervisor Executor** | YES (`server/src/domains/jarvis/supervisorLoop.ts:60`) | YES | YES | YES (JARVIS V2 supervisor router) | YES | YES | NO | YES |
| **supervisorLoop** | YES (`server/src/domains/jarvis/supervisorLoop.ts:400`) | YES | YES | YES (`routers/jarvis.ts:854`) | YES | YES | NO | YES |
| **capabilityRegistry** | YES (`server/src/domains/jarvis/capabilityRegistry.ts:50`) | YES | YES | YES (`conversationContext.ts`, `actionRuntime.ts`) | YES | YES | NO | YES |
| **Internal AgenticOS Executor** | YES (`server/src/domains/jarvis/execution/executors/internalAgenticOSExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:67`) | YES | YES | NO | YES |
| **Browser Executor** | YES (`server/src/domains/jarvis/execution/executors/browserExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:63`) | YES | YES | NO | YES |
| **Playwright / browser operator** | YES (`server/src/services/browser/browserOperator.ts`) | YES | YES | YES (Underlying browser driver) | YES | YES | NO | YES |
| **Desktop Executor** | YES (`server/src/domains/jarvis/execution/executors/desktopExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:64`) | YES | YES | NO | YES |
| **Terminal Executor** | YES (`server/src/domains/jarvis/execution/executors/terminalExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:62`) | YES | YES | YES | YES |
| **Filesystem Executor** | YES (`server/src/domains/jarvis/execution/executors/filesystemExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:66`) | YES | YES | YES | YES |
| **Git / GitHub Executor** | YES (`server/src/domains/jarvis/execution/executors/gitExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:65`) | YES | YES | YES | YES |
| **Engineering Executor** | YES (`server/src/domains/jarvis/execution/executors/engineeringExecutor.ts`) | YES | YES | YES (`universalExecutionController.ts:68`) | YES | YES | NO | YES |
| **Hermes engineering delegation** | YES (`server/src/domains/hermes/hermesOrchestrator.ts`) | YES | YES | YES (`supervisorTools.ts:171`, `toolRegistry`) | YES | YES | PARTIAL | YES |
| **Self-Heal** | YES (`server/src/domains/selfHeal/SelfHealSupervisor.ts`) | YES | YES | YES (`selfHealBridge.ts`, `routers/selfHeal.ts`) | PARTIAL | PARTIAL | YES | YES |
| **Incident / Failure Registry** | YES (`server/src/domains/selfHeal/FailureDetector.ts`, `schema.ts`) | YES | YES | YES (SQLite `repair_incidents`) | NO | NO | YES | YES |
| **Verification Layer** | YES (`executor.verify` on all 6 executors) | YES | YES | YES (`universalExecutionController.ts:1560`) | YES | YES | YES | YES |
| **Retry Layer** | YES (`selfHealBridge.ts:67`, `universalExecutionController.ts:1583`) | YES | YES | YES (`selfHealBridge.handleCapabilityFailure`) | NO | NO | YES | YES |
| **Deployment Layer** | YES (`server/src/domains/selfHeal/DeploymentGate.ts`) | YES | YES | YES (Cryptographic SHA-256 approval gate) | NO | NO | YES | YES |
| **HermesProgressBus** | YES (`server/src/domains/hermes/progressEvents.ts:86`) | YES | YES | YES (`hermesOrchestrator.ts`, `routers/jarvis.ts`) | YES | YES | YES | YES |

---

## 2. Deep Component Analysis

### 2.1 OperationalController
- **Source:** `server/src/domains/jarvis/operationalEvidence.ts`
- **Role:** Grounds conversational claims in real task/project/mission state. Intercepts queries about active operations, blockers, and worker status.
- **Verification:** Successfully handles operational requests across test suite (`jarvisPositiveEvidenceFixtures.test.ts`, `jarvisOperationalGrounding.test.ts`).

### 2.2 Supervisor & supervisorLoop
- **Source:** `server/src/domains/jarvis/supervisorLoop.ts`
- **Role:** LLM-driven supervisory front door that inspects system health, memory, and delegates to Hermes.
- **Tools Expose:** `get_system_health`, `delegate_hermes_task`, `delegate_codex_goal` (redirects to Hermes), `recall_memory`, `get_current_work`.

### 2.3 Capability Registry
- **Source:** `server/src/domains/jarvis/capabilityRegistry.ts`
- **Registered Capabilities:** `jarvis`, `hermes`, `codex` (decommissioned), `magnitude`, `research`, `agent_teams`, `boards`, `memory`, `automations`, `revenue_pipeline`, `revenue_operator`, `antigravity`, `terminal`, `desktop`, `browser`, `git`, `filesystem`.
- **Note:** `engineering` is mapped inside `universalExecutionController` but is missing an entry in `CAPABILITY_REGISTRY`.

### 2.4 Executors (Universal Execution Controller)
`UniversalExecutionController` maintains a direct runtime map of seven executors:
1. `terminal`: `terminalExecutor` (PowerShell, CMD, bash with exit code / stdout / stderr capture)
2. `browser`: `browserExecutor` (Playwright Chromium navigation, search, click, type, accessibility inspect)
3. `desktop`: `desktopExecutor` (Windows app launcher & OS process table verification)
4. `git`: `gitExecutor` (git status, pull, clone, branch, diff via terminal)
5. `filesystem`: `filesystemExecutor` (read, write, mkdir, copy, search with disk state checks)
6. `internal_agenticos`: `internalAgenticOSExecutor` (in-app UI navigation, page opening)
7. `engineering`: `engineeringExecutor` (npm build/test and Hermes task delegation)

---

## 3. The Broken Connection: Why the Loop Fails
While all 19 components exist in source and compiled distribution, **the autonomous self-heal chain is severed at three critical junctures**:

1. **Defect Gating (`universalExecutionController.ts:1563`)**:
   `isAgenticOsDefect` is hardcoded to only trigger if `(execRes as any).isAgenticOsDefect === true` or `execRes.error?.includes('RESILIENCE_BREAKAGE_SIMULATION')`. Real execution failures (like `blocked_by_dialog` on YouTube) evaluate to `false`, bypassing `selfHealBridge` entirely.
2. **Hardcoded Codex Model Verification (`RepairDiagnostician.ts:27-66`)**:
   `RepairDiagnostician` strictly requires `provider: 'codex'` and `model: 'gpt-6-astra'`. When called, fail-closed verification throws `ModelUnavailableError`, transitioning incidents to `BLOCKED_MODEL_UNAVAILABLE`.
3. **Mock Self-Heal Repair Implementation (`SelfHealSupervisor.ts:442-480`)**:
   `executeClosedLoopRepair` contains a stub handler for project renames and mock console logs for `SELFHEAL_BUILD_PASS` / `SELFHEAL_TEST_PASS`, without calling `hermesEngineeringOrchestrator` or applying real code patches.

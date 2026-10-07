# AgenticOS Phase 3 Step 1 — Trusted Human Approval Audit Report

**Date:** October 7, 2026  
**Status:** COMPLETE (AUDIT & DESIGN ONLY — ZERO PRODUCTION CODE MODIFICATIONS)  
**Branch:** `wip-secure-20261007`  
**Execution Context:** Autonomous Engineering Execution (Hermes / Antigravity)  

---

## 1. Executive Summary & Audit Scope

Phase 3 introduces **Trusted Human Approval** to AgenticOS, ensuring that privileged, high-impact, or destructive actions cannot execute solely based on an LLM's internal planning, an unauthenticated client HTTP request, or an in-process forged grant.

In accordance with the operational directive:
- **Scope:** Audit and design only. No production runtime code or behavior has been modified in this step.
- **Constraints Maintained:**
  - Zero OS credential store / vault writes (`keytar` remains read-only / untouched).
  - Zero Windows Hello or biometric credential prompts.
  - Zero interactive UI popups on the physical desktop.
  - Zero git checkout, push, merge, rebase, or reset operations.
  - Zero deployment or installed application execution.

This document inventories the existing approval subsystems, evaluates whether and how an agent/LLM process could forge an approval, catalogues every unapproved risky execution path in the current codebase, classifies vulnerabilities by severity, and records empirical pass/fail counts for the approval test suite.

---

## 2. Inventory of Existing Approval Code

### 2.1 Component Analysis

| # | Component / File | Purpose & Architecture | Live Caller Routes | Agent / LLM Forgeability Assessment |
|---|---|---|---|---|
| 1 | `domains/securitySupervisor/approvalVerifier.ts` | **Cryptographic Verifier**: Standalone TypeScript class `ApprovalVerifier` that validates Ed25519 or ECDSA P-256 signatures over an immutable `ApprovalPayload`. Checks canonical JSON, timestamps ($\le 60\text{s}$ TTL), and records single-use nonces in SQLite table `supervisor_approval_nonces` (`consumed = 1`). | **Zero (0) live routes**. Only referenced in `approvedGit.ts` (also unlinked) and unit tests. | **Unforgeable cryptographically** IF private key is kept strictly out-of-process. However, if the SQLite DB is co-located with a worker possessing arbitrary SQL write permissions, nonces could be marked unconsumed or pre-seeded. |
| 2 | `domains/securitySupervisor/approvedGit.ts` | **Supervisor-only Signed Git Dispatch**: Prepares approval binding for Git operations, challenges `ApprovalVerifier`, and verifies signature before dispatching native job via `runSupervisorGit`. | **Zero (0) live routes**. Completely disconnected from live Git tools (`gitExecutor`, `AgenticOsGitService`). | **Bypassed completely**: The agent does not need to forge an approval because live routers never invoke `ApprovedGitSupervisor`. They call `gitExecutor` directly. |
| 3 | `src/__tests__/nativeApprovalIssuer.test.ts` | **Native C# Issuer Test Suite**: Tests `ApprovalProbe.exe` and `ApprovalIssuer.exe` compiled from `native/security-supervisor/`. Tests P-256 non-exportable CNG signing and supervisor verification. | **Zero (0) live routes** (Test harness only). | **Probe executable risk**: `ApprovalProbe.exe` uses ephemeral keys to sign arbitrary stdin payloads without authentication. If deployed or made executable to an agent, it could act as an open oracle. |
| 4 | `domains/controlPlane/taskGraph/TrustedHumanApprovalBridge.ts` | **Human Approval Bridge**: Hard fail-closed stub. Exports `issueTrustedHumanApproval` and `verifyAndConsumeTrustedApproval` which unconditionally throw `TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE`. | **Zero (0) live routes**. Only called by `TrustedToolApproval.ts`. | **Cannot forge**: Throws unconditionally for all callers. |
| 5 | `domains/controlPlane/taskGraph/TrustedToolApproval.ts` | **Task Graph Tool Gate**: Verifies approval references. For `tha_` references, calls `TrustedHumanApprovalBridge` (throws). For legacy `mcp_prepared_tasks` records, verifies `approved` status but explicitly throws `TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE`. | **Zero (0) live routes**. Only imported by `ToolAuthorization.ts`. | **Cannot forge**: Fails closed unconditionally. |
| 6 | `src/__tests__/approvalIssuanceBoundary.test.ts` | **Boundary Unit Tests**: 24 tests validating `ApprovalVerifier` against replay, signature substitution, tamper resistance, and fail-closed bridge behavior. | **Zero (0) live routes** (Test harness only). | N/A (Unit test). |
| 7 | `src/__tests__/toolAuthorizationBoundary.test.ts` | **Tool Grant Tests**: Tests execution identity binding, rate limiting, and single-use grant consumption in `ToolAuthorization.ts`. | **Zero (0) live routes** (Test harness only). | **Vulnerability in test pattern**: Tests mock `TrustedToolApproval.ts` to simulate human approval, showing that `tool_authorization_grants` accepts arbitrary string `approval_ref` if not cryptographically checked. |
| 8 | `src/__tests__/apiAuthenticationBoundary.test.ts` | **API Ingress Tests**: Verifies `authMiddleware` fails closed on missing or invalid tokens in all environments. | **Applied globally** to all `/api/*` routes via `server/src/index.ts`. | **Trivial Bypass**: `authMiddleware` is bypassed in all non-production modes and logs a warning instead of blocking if `AGENTOS_API_TOKEN` is unset. |
| 9 | `src/__tests__/codexApprovalState.test.ts` | **Codex Goal Loop Tests**: Tests pause/resume states for goals requiring approval. | **Live routes**: `/api/chat`, `/api/project-execution`. | **Plain JSON bypass**: Approval state is a plain task property (`waiting_for_approval` $\rightarrow$ `approved`) settable via client HTTP request or model output. |
| 10 | `src/__tests__/fixtures/legacyHmacApproval.ts` | **Historical Prototype**: Previous implementation of `TrustedHumanApprovalBridge` using in-memory symmetric HMAC secret (`trustedApproverKeys`). | **Zero (0) live routes** (Demoted to fixture). | **CRITICAL VULNERABILITY (Historical)**: Shared in-process HMAC secret easily read or forged by any code running inside the Node.js process. |

---

## 3. Inventory of Risky Actions Proceeding WITHOUT Verified Human Approval

The following sections document every location in the production codebase where risky actions execute without requiring an authenticated, cryptographically verified human approval.

### 3.1 Shell / Terminal Command Execution
1. **`domains/jarvis/execution/executors/terminalExecutor.ts:runCommand`**
   - **Triggered By:** Universal Execution Controller, Jarvis Next, turn router, voice pipeline, `toolRegistryBridge`.
   - **Behavior:** Executes arbitrary PowerShell and cmd commands via Windows Job Object.
   - **Approval Status:** **UNCONFINED BY APPROVAL**. While constrained to the Phase 2 Windows Job Object boundary, execution proceeds immediately upon internal dispatch with **zero** human confirmation or digital signature.
2. **`domains/localWorker/toolRegistryBridge.ts:executeToolInner ('shell.execute')`**
   - **Triggered By:** `localWorkerManager.ts` during autonomous plan execution.
   - **Behavior:** Passes shell commands to `terminalExecutor.runCommand`.
   - **Approval Status:** **UNAPPROVED BY DEFAULT**. In `getRiskLevel()`, only commands containing `rmdir|del|rm|format|drop|truncate|kill` AND `/s|-rf|-r|\*` are categorized as `high_impact`. Arbitrary PowerShell scripts, network exfiltration, `curl`, `git push`, or registry edits are treated as low/normal risk and execute autonomously. Furthermore, if `task.config.autoApprove === true`, even `high_impact` commands bypass approval.
3. **`domains/sandbox/sandbox.ts:runSandboxedCommand`**
   - **Triggered By:** `codexLoop.ts` via `/api/chat` and background tasks.
   - **Behavior:** Spawns `node`, `git`, `rg`, `npm` inside Windows Job boundary.
   - **Approval Status:** **UNAPPROVED**. Executes programmatic tool calls directly without human signature.
4. **`domains/jarvis/execution/executors/engineeringExecutor.ts:runBuild / runTests`**
   - **Triggered By:** Engineering capability dispatch.
   - **Behavior:** Runs `npm test`, `npm run build`, `tsc` via `terminalExecutor`.
   - **Approval Status:** **UNAPPROVED**. Runs autonomously.

### 3.2 Git Operations (Write / Commit / Push / Mutation)
1. **`domains/jarvis/execution/executors/gitExecutor.ts:executeGit`**
   - **Triggered By:** Jarvis tool calls (`git pull`, `git clone`, `git commit`, `git checkout`).
   - **Behavior:** Executes raw git commands via `terminalExecutor.runCommand`.
   - **Approval Status:** **UNAPPROVED**. Does not invoke `ApprovedGitSupervisor`. Any conversation turn can execute repository-altering Git commands.
2. **`domains/controlPlane/AgenticOsGitService.ts:commitChanges / pushBranch`**
   - **Triggered By:** Control plane repository management.
   - **Behavior:** Runs `execSync('git add -u && git commit ...')` and `execSync('git push -u origin ...')` directly in `D:\AgenticOS`.
   - **Approval Status:** **UNAPPROVED**. Executes direct mutating Git operations synchronously with zero cryptographic approval.
3. **`domains/selfHeal/selfHealSupervisor.ts` & `routers/selfHeal.ts:approveRepair`**
   - **Triggered By:** `POST /api/self-heal/incidents/:id/approve`.
   - **Behavior:** Applies code patches to disk and runs test verification.
   - **Approval Status:** **UNAUTHENTICATED JSON**. The route accepts `{ approver: "human" }` in the request body. Any caller can trigger the repair workflow.

### 3.3 Filesystem Writes Outside Workspace
1. **`domains/jarvis/execution/executors/filesystemExecutor.ts:executeStep ('write')`**
   - **Triggered By:** Jarvis filesystem tool calls.
   - **Behavior:** Executes `fs.mkdir(path.dirname(targetPath))` and `fs.writeFile(targetPath, content)`.
   - **Approval Status:** **UNCONFINED & UNAPPROVED**. `targetPath` is resolved directly from input arguments without path confinement or workspace boundary enforcement. It can write arbitrary content to any location writable by the user process (e.g., `C:\Users\cd-pr\...`, startup folders, ssh keys) without approval.
2. **`domains/localWorker/toolRegistryBridge.ts:executeToolInner ('filesystem.write' / 'filesystem.create_folder')`**
   - **Triggered By:** Local worker plans.
   - **Behavior:** Writes files or creates folders via `fs.writeFile` / `fs.mkdir`.
   - **Approval Status:** **UNAPPROVED**. Classified as `'write'` (not `'high_impact'`), so `localWorkerManager` executes it automatically without waiting for user approval.

### 3.4 Network Send & External Services
1. **`routers/laneRouter.ts:POST /api/dispatch/dispatch`**
   - **Triggered By:** Kanban lane cards, automated dispatches.
   - **Behavior:** Dispatches `claude`, `hermes`, `codex`, or generic HTTP workers (`omniroute`, LLM gateways).
   - **Approval Status:** **PUBLIC BYPASS & UNAPPROVED**. Explicitly exempted from authentication in `server/src/index.ts:272` (`req.path.startsWith('/dispatch')`). Executes external AI worker commands with zero approval.
2. **`routers/telegramRouter.ts:POST /api/integrations/telegram/configure`**
   - **Triggered By:** Remote configuration.
   - **Behavior:** Updates bot token and allowed user IDs in `SecretStore`.
   - **Approval Status:** **PUBLIC BYPASS & UNAPPROVED**. Explicitly exempted from authentication in `server/src/index.ts:272` (`req.path.startsWith('/integrations/')`).
3. **`adapters/telegramAdapter.ts:sendPhoto / sendMessage`**
   - **Triggered By:** Remote Telegram requests (`/screenshot`, notifications).
   - **Behavior:** Captures physical desktop screen and transmits images over the public internet to Telegram servers.
   - **Approval Status:** **UNAPPROVED**. Does not verify human approval before transmitting desktop screenshots.
4. **`services/revenueOperator/revenueSupervisor.ts:runSupervisorCycle`**
   - **Triggered By:** Background cron loop (every 60s) or `POST /api/revenue-supervisor/trigger`.
   - **Behavior:** Executes autonomous business development actions across external APIs and platforms.
   - **Approval Status:** **UNAPPROVED (REACTIVE ONLY)**. Operates autonomously until it encounters an explicit human barrier (e.g. CAPTCHA, KYC) that causes an error, at which point it pauses. It does not seek approval *before* initiating actions.

### 3.5 Credential Use & Secret Store Access
1. **`services/gateway/secretStore.ts:get / set / delete`**
   - **Triggered By:** Model gateways, provider routes, integrations.
   - **Behavior:** Retrieves plaintext API keys from Windows Credential Manager (`keytar`) or decrypted SQLite.
   - **Approval Status:** **UNRESTRICTED IN-PROCESS ACCESS**. Any component running within the server process can read any secret by calling `secretStore.get(key)`.
2. **`routers/providers.ts:PUT /api/providers/:id/key`**
   - **Triggered By:** Provider settings UI or REST client.
   - **Behavior:** Updates secret store and injects plaintext key into `process.env[envVar]`.
   - **Approval Status:** **UNAPPROVED & IN-PROCESS EXPOSURE**. Propagates plaintext secrets to `process.env`, making them inheritable by unconfined child processes.
3. **`middleware/auth.ts:authMiddleware`**
   - **Behavior:** In `NODE_ENV !== 'production'`, completely bypasses authentication (`return next()`). In `production`, if `AGENTOS_API_TOKEN` is unset, logs a warning and passes requests through unauthenticated.
   - **Approval Status:** **GLOBAL SECURITY HOLE**. Allows unauthenticated local or network requests to reach all privileged API endpoints.

### 3.6 Application Launch & Desktop Automation
1. **`domains/jarvis/execution/executors/desktopExecutor.ts:openApplication`**
   - **Triggered By:** Jarvis intent router (`open telegram`, `launch notepad`, etc.).
   - **Behavior:** Executes `powershell Start-Process` or `spawn(executablePath, [], { detached: true })`.
   - **Approval Status:** **UNAPPROVED**. Checks turn ownership (`assertSideEffectOwnership`), but requires zero human authorization before launching arbitrary executables on the user's interactive desktop.
2. **`domains/jarvis/execution/executors/filesystemExecutor.ts:openFile / revealInExplorer`**
   - **Triggered By:** User or agent tool calls.
   - **Behavior:** Spawns `cmd.exe /c start` or `explorer.exe /select,<path>`.
   - **Approval Status:** **UNAPPROVED**. Launches native file associations and explorer windows without human verification.

---

## 4. Findings Table with Severity

| Finding ID | Severity | Affected Component | Flaw Description | Impact | Required Remediation |
|---|---|---|---|---|---|
| **SEC-01** | **CRITICAL** | `middleware/auth.ts` | Global API authentication bypass in development/test or when `AGENTOS_API_TOKEN` is unset. | Any local or network process can issue unauthenticated HTTP requests to privileged routes (`/api/projects/execute`, `/api/worker/tasks`, `/api/chat`). | Enforce fail-closed authentication across all modes. Deny requests with HTTP 503 if token is unconfigured, HTTP 401 if invalid. |
| **SEC-02** | **CRITICAL** | `index.ts:272` | Public path bypass for `/api/dispatch`, `/api/integrations/`, `/api/heavy-gen`, etc. | Unauthenticated callers can trigger worker process execution, modify Telegram bot configurations, and dispatch tasks. | Remove public bypasses for mutating endpoints. Require authentication and human approval. |
| **SEC-03** | **CRITICAL** | `routers/backgroundTasks.ts` & `routers/mcpBridge.ts` | Approval resolution accepts unauthenticated client JSON `{ choice: "allow" }` or `{ responder: "user" }`. | An LLM, web script, or malicious local process can approve its own gated tasks via simple HTTP POST requests. | Require cryptographically signed approval envelopes containing out-of-process operator signatures. |
| **SEC-04** | **CRITICAL** | `domains/localWorker/toolRegistryBridge.ts` | Overly narrow `high_impact` classification and `autoApprove` override flag. | Shell execution, arbitrary filesystem writes, and application launches run autonomously without human approval. | Reclassify all shell commands and mutating filesystem writes as approval-required. Deprecate `autoApprove`. |
| **SEC-05** | **CRITICAL** | `filesystemExecutor.ts` | Filesystem write operations lack path confinement or workspace checks. | Agent can overwrite sensitive user files (`~/.ssh`, Windows startup, config files) outside the project root. | Enforce workspace boundary confinement and require signed human approval for writes outside designated areas. |
| **SEC-06** | **HIGH** | `AgenticOsGitService.ts` & `gitExecutor.ts` | Mutating Git operations (`commit`, `push`, `checkout`) run directly via `execSync` / `terminalExecutor` without approval. | Unapproved changes can be committed and pushed to remote origin repositories autonomously. | Route all Git mutations through `ApprovedGitSupervisor` with verified cryptographic approval. |
| **SEC-07** | **HIGH** | `desktopExecutor.ts` | Interactive desktop application launch proceeds without human confirmation. | Agent can launch arbitrary local executables in the interactive user session. | Gate `desktop_launch` behind an out-of-band approval token. |
| **SEC-08** | **HIGH** | `routers/providers.ts` | Plaintext secrets injected into `process.env`. | Any child process spawned from the server inherits sensitive provider API keys. | Stop writing secrets to `process.env`. Pass credentials only via protected IPC or scoped memory. |
| **SEC-09** | **MEDIUM** | `native/security-supervisor/ApprovalProbe.cs` | Test binary creates ephemeral keys and signs requests without operator authentication. | If packaged or present in production paths, could be abused as a signing oracle. | Ensure test probes are strictly excluded from production distributions and protected by file ACLs. |
| **SEC-10** | **MEDIUM** | `toolAuthorizationBoundary.test.ts` | Test fails due to missing `ToolRegistry` constructor export in `toolRegistry.ts`. | Test suite regression obscures authorization boundary behavior. | Export `ToolRegistry` class in `services/agent/toolRegistry.ts`. |

---

## 5. Approval-Related Test Suite Execution Results

All existing approval-related test files were executed against the codebase in the `server` working directory. Results are recorded below:

| Test File | Total | Passed | Failed | Status | Root Cause of Failures |
|---|:---:|:---:|:---:|:---:|---|
| `src/__tests__/nativeApprovalIssuer.test.ts` | 11 | 11 | 0 | **PASS** | Ephemeral CNG P-256 signing, canonical validation, tamper rejection, bidi rejection. |
| `src/__tests__/trustedHumanApprovalBridge.test.ts` | 22 | 22 | 0 | **PASS** | Tests fail-closed behavior of `TrustedHumanApprovalBridge` and legacy HMAC prototype. |
| `src/__tests__/trustedToolApproval.test.ts` | 7 | 7 | 0 | **PASS** | Confirms legacy `mcp_prepared_tasks` records fail closed with `TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE`. |
| `src/__tests__/approvalIssuanceBoundary.test.ts` | 24 | 24 | 0 | **PASS** | Validates `ApprovalVerifier` against replay, tampering, binding mismatch, and expiry. |
| `src/__tests__/approvedGitSupervisor.test.ts` | 5 | 5 | 0 | **PASS** | Verifies signed native Git execution, nonce consumption, replay prevention across DB reopens. |
| `src/__tests__/codexApprovalClassification.test.ts` | 3 | 3 | 0 | **PASS** | Classifies read-only inspection as auto-executable vs write operations. |
| `src/__tests__/toolAuthorizationBoundary.test.ts` | 9 | 0 | 9 | **FAIL** | `TypeError: ToolRegistry is not a constructor`. `toolRegistry.ts` exports singleton instance `toolRegistry`, but test attempts `new ToolRegistry()`. |
| `src/__tests__/apiAuthenticationBoundary.test.ts` | 8 | 1 | 7 | **FAIL** | `authMiddleware` in `middleware/auth.ts` bypasses checks in dev/test and when `AGENTOS_API_TOKEN` is unset. |
| `src/__tests__/codexApprovalState.test.ts` | 6 | 3 | 3 | **FAIL** | Event schema and call count mismatches in `codexLoop.ts` (`task_failed` event emitted instead of `agent_completed`). |
| `src/__tests__/backgroundTaskApprovalPipeline.test.ts` | 15 | 14 | 1 | **FAIL** | Test 10 expected task status in `['waiting_approval', 'review', 'blocked']`, but received `validating_worker_output`. |
| **TOTAL** | **110** | **90** | **20** | **PARTIAL** | **90 passed, 20 failed** across 10 test suites. |

---

## 6. Audit Conclusion

The AgenticOS codebase contains solid cryptographic foundations in `ApprovalVerifier.ts` and `ApprovedGitSupervisor.ts` (using asymmetric digital signatures, canonical JSON formatting, and atomic SQLite single-use nonce tracking). 

However, **these foundations are currently completely disconnected from live execution pathways**. In production routes:
1. Shell execution, Git operations, filesystem writes, and application launches proceed without verified approval.
2. Existing approval resolution routes accept unauthenticated client JSON booleans.
3. API authentication middleware contains bypasses that allow unauthorized callers to trigger privileged actions.

Phase 3 Step 2 must resolve these gaps by implementing an out-of-process approval issuer and binding all risky execution pathways to fail closed without a verified cryptographic approval token.

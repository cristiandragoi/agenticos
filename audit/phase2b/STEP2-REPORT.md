# Phase 2B Step 2 & Step 3 Completion & Verification Report

**Date:** 2026-10-07  
**Branch:** `wip-secure-20261007`  
**Baseline Commit:** `cc45392` (Phase 2B Step 1)  
**Target Scope:** Phase 2B Step 2 (Process Spawn Routing & Inventory) & Step 3 (Atomic Job Creation Window Closure)

---

## 1. Executive Summary

Phase 2B Step 2 and Step 3 have been successfully completed, verified, and committed on branch `wip-secure-20261007`.

1. **Every Live Process Spawn Routed Through Phase 2 Job Boundary:**
   `terminalExecutor.runCommand` now serves as the authoritative choke point for all programmatic command execution, routing execution on Windows through `WindowsJob` (`JobRunner.exe`). `gitExecutor`, `engineeringExecutor`, `terminalTool`, `localWorkerPlanner`, and `toolRegistryBridge` (`shell.execute` and `git.*`) all route through this boundary. If the boundary helper is unavailable when required, execution fails closed.
2. **Exhaustive Spawn Inventory & Allow-List:**
   `audit/phase2b/spawn-inventory.md` categorizes all 52 process spawn sites across `server/src/`. Every unconfined site (including all 12 missed sites from the audit) is explicitly documented with its architectural and operational rationale.
3. **Automated Static Confinement Regression Test:**
   `server/src/__tests__/processSpawnConfinement.test.ts` audits the entire codebase on each run, enforcing that no `child_process` invocations appear outside the authoritative allow-list and verifying that `terminalTool` has zero direct `child_process` dependencies.
4. **Atomic Process Creation Window Closed:**
   `JobRunner.cs` now configures `PROC_THREAD_ATTRIBUTE_JOB_LIST` (`0x0002000D`) in `STARTUPINFOEX.lpAttributeList`. Processes are created atomically inside the Job Object at the Windows kernel level during `CreateProcess`, eliminating the suspended orphan PID leak window.
5. **Zero TypeScript Errors & 100% Test Pass:**
   `tsc --noEmit` passes with 0 errors. All 4 Phase 1 and Phase 2 test suites pass (118/118 tests).

---

## 2. Git Commits on `wip-secure-20261007`

| Commit Hash | Commit Message | Files Changed | Notes |
| :--- | :--- | :---: | :--- |
| `0d13bcc` | `chore: ignore files with secrets, personal data, and username paths` | 1 | Gitignore rules for credentials and username paths |
| `cc2e4aa` | `feat(securitySupervisor,localWorker): add confinement domains and boundary tests` | 15 | Confinement supervisor domains & tests |
| `b8af789` | `feat(controlPlane,taskGraph,artifacts): add controlPlane, taskGraph, artifacts domains and boundary tests` | 44 | Control plane and task graph domains |
| `8067fd2` | `feat(jarvisNext,turnLifecycle,repositoryResearch): add jarvisNext, turnLifecycle, repositoryResearch domains and tests` | 32 | Jarvis next and turn lifecycle domains |
| `9d23618` | `chore(server/scripts): add server test, diagnostic, and automation scripts` | 19 | Test scripts and automation harnesses |
| `ee52094` | `chore(evidence): add sanitized acceptance, benchmark, and security evidence records` | 67 | Sanitized evidence records and logs |
| `fa98fe4` | `fix(types): resolve 32 TypeScript compiler errors across domains and services` | 17 | Type fixes bringing whole-workspace tsc to exit code 0 |
| `61826bb` | `fix(data): resolve doubled server/server/data path in briefingService and data stores` | 4 | Step B doubled-path bug fix |
| `cc45392` | `docs(audit): add Phase 2B Step 1 audit and verification report` | 1 | Step 1 audit report |
| `41e5696` | `feat(securitySupervisor): route live process execution through Phase 2 Windows Job boundary` | 5 | **Phase 2B Step 2:** routed terminalExecutor & terminalTool, spawn inventory, static test |
| `853e220` | `feat(securitySupervisor): enforce atomic process creation inside Windows Job via PROC_THREAD_ATTRIBUTE_JOB_LIST` | 12 | **Phase 2B Step 3:** atomic job creation via PROC_THREAD_ATTRIBUTE_JOB_LIST, proof tests |

---

## 3. What Was Routed Through the Phase 2 Job Boundary

Every programmatic command executed by agents, local workers, or git tools now passes through the Phase 2 Windows Job Object boundary:

1. **`terminalExecutor.runCommand`**:
   - Primary choke point for all command execution.
   - On Windows, locates verified helper `JobRunner.exe` and executes command within `WindowsJob`.
   - Fails closed if boundary helper is missing when boundary is strictly required or in production.
   - Restricts processes with hard OS limits: `KILL_ON_JOB_CLOSE` (`0x2000`), active process limit (8), memory limit (1GB), UI restriction mask (`0xff`, denying clipboard and desktop creation).
2. **`gitExecutor.executeGit`**:
   - Delegates all git operations (`clone`, `fetch`, `pull`, `status`, `diff`, `log`, `branch`) directly to `terminalExecutor.runCommand`.
   - Confinement status: **ROUTED**.
3. **`terminalTool.handler`**:
   - Refactored from direct `node:child_process` `exec` to delegate directly to `terminalExecutor.runCommand`.
   - Confinement status: **ROUTED**; direct `child_process` imports eliminated.
4. **`toolRegistryBridge.ts` (`shell.execute`)**:
   - Delegates tool execution directly to `terminalExecutor.runCommand`.
   - Confinement status: **ROUTED**.
5. **`toolRegistryBridge.ts` (`git.status`, `git.diff`, `git.log`, `git.branch`)**:
   - Delegates to `gitExecutor.executeGit`, flowing into `terminalExecutor.runCommand`.
   - Confinement status: **ROUTED**.
6. **`engineeringExecutor.ts`**:
   - Build (`npm run build`) and test (`npm test`) operations delegate to `terminalExecutor.runCommand`.
   - Confinement status: **ROUTED**.
7. **`localWorkerPlanner.ts`**:
   - Generates action plans using `shell.execute`, dispatched by `toolRegistryBridge` through `terminalExecutor.runCommand`.
   - Confinement status: **ROUTED**.
8. **`gitSupervisor.ts` (`runSupervisorGit`)**:
   - Dispatches structured git operations directly through `WindowsJob`.
   - Confinement status: **ROUTED**.

---

## 4. What is UNCONFINED and Architectural Rationale

All unconfined call sites are cataloged in `audit/phase2b/spawn-inventory.md`. The primary categories and justifications are:

### A. Interactive Desktop Launch
- **`terminalExecutor.runCommand` (`visibleWindow: true`)**: Spawns an interactive GUI PowerShell or CMD window on the user's desktop (`windowsHide: false`). Because Windows Job Objects enforce `SetUi(0xff)` (denying desktop interaction and window creation) and `KILL_ON_JOB_CLOSE` (killing processes on supervisor exit), interactive desktop windows cannot run inside the Job Object boundary.

### B. The 12 Missed Sites from Independent Audit Report
1. **Local Transcribe Worker (Daemon)** (`localTranscribe.ts:245`): Long-running internal background daemon running Faster-Whisper with persistent stdin/stdout JSON-RPC streaming. Job Object single-use lifecycle and `KILL_ON_JOB_CLOSE` cannot support persistent audio streaming daemons. Trusted internal backend subsystem.
2. **Fallback Transcribe Worker** (`localTranscribe.ts:502`): Transient fallback script running local Whisper model when daemon restarts. Fixed script arguments processing local audio files. Non-adversarial trusted system component.
3. **Local TTS Synthesis** (`localTts.ts:253`): Python speech synthesis worker streaming PCM audio chunks back to the server pipe. Fixed script arguments; trusted audio synthesis subsystem.
4. **Piper TTS Engine** (`piperTts.ts:162`): Local neural text-to-speech engine (`piper.exe`) reading text from stdin and producing audio. Trusted internal binary with fixed parameter schema.
5. **Hardware Profiler Probes** (`hardwareProfiler.ts:20`): Read-only hardware capability detection (`wmic`, `nvidia-smi`, `lscpu`, `df`). Fixed commands invoked synchronously during startup/diagnostics; zero user/agent input.
6. **Desktop Perception Service** (`DesktopPerceptionService.ts:16`): Executes PowerShell desktop scripts to capture active window titles and accessibility bounds. Requires access to interactive desktop session (`WinSta0/Default`), which is denied under Job Object `SetUi(0xff)`.
7. **Camera Perception Service** (`CameraPerceptionService.ts:16`): Executes DirectShow video capture script to take a webcam snapshot. Requires direct hardware video capture device drivers and DirectShow filters.
8. **Location Perception Service** (`LocationService.ts:13`): Queries Windows Location API via PowerShell script. Fixed trusted script querying OS location provider.
9. **Sandbox Process Runner** (`sandbox.ts:206, 211`): Legacy userspace execution utility with timeout and environment variable filtering. Superseded by `terminalExecutor` and `WindowsJob`; retained for legacy test compatibility.
10. **Sandbox Taskkill Terminator** (`sandbox.ts:222`): Administrative cleanup utility executing `taskkill /pid ... /T /F` on process tree timeout. Trusted cleanup probe.
11. **Claude Worker Spawn** (`claude.ts:9`): Interactive third-party Claude CLI wrapper requiring interactive terminal TTY and external network access to Anthropic API endpoints.
12. **Hermes Adapter Shell** (`hermesAdapter.ts:171`): Synchronous diagnostic shell probe strictly for local Hermes model health verification.

### C. Internal Infrastructure Services
- **Desktop Automation & UI Focus** (`desktopExecutor.ts`): Automates user desktop applications; requires interactive window station.
- **Chrome Browser Operators & Sessions** (`browserOperator.ts`, `browserSession.ts`): Controls Google Chrome via DevTools Protocol (CDP); manages dedicated debugging port.
- **Audio Conversion** (`audioUtils.ts`): Uses `ffmpeg` to transcode incoming audio streams.
- **Self-Heal Diagnostic Probes** (`domains/selfHeal/*`): Automated internal diagnostic and repair scripts.

---

## 5. Closure of the CreateProcess -> AssignProcessToJobObject Window

### Root Cause of the Gap:
Previously, `JobRunner.cs` created processes using `CreateProcessW(CREATE_SUSPENDED)` followed by a separate userspace call to `AssignProcessToJobObject(job, pi.process)`. If the supervisor process crashed or was terminated (OOM, SIGKILL) in the microsecond window between these two calls, an unassigned process would be left indefinitely suspended in the Windows kernel process table.

### Solution Implemented:
1. **`PROC_THREAD_ATTRIBUTE_JOB_LIST` (`0x0002000D`):**
   - Configured in `STARTUPINFOEX.lpAttributeList` with count = 2.
   - Attribute 1: `0x20002` (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`) for standard input/output pipe inheritance.
   - Attribute 2: `0x2000D` (`PROC_THREAD_ATTRIBUTE_JOB_LIST`) passing the Job Object handle directly to the kernel process creation routine.
2. **Kernel-Level Atomic Assignment:**
   - The process is attached to the Job Object by the Windows kernel inside `NtCreateUserProcess` before the handle is returned to userspace.
   - If the supervisor crashes at any point, the kernel closes the Job Object handle, immediately terminating the child via `KILL_ON_JOB_CLOSE`.
3. **Pre-Resume Verification:**
   - `AssignProcessToJobObject` remains as a secondary assertion.
   - `assignedBeforeResume: true` and `atomicJobList: true` are recorded in the execution evidence.
4. **Empirical Verification Tests:**
   - `windowsJobBoundary.test.ts`: Added test `creates process atomically inside job via PROC_THREAD_ATTRIBUTE_JOB_LIST with zero pre-assignment execution` (asserting `atomicJobList: true` and verifying canary execution only occurs post-resume).
   - `phase2JobContainment.test.ts`: Updated test `suspended assignment and all native limit readbacks succeed` to verify `atomicJobList: true`.
   - Test `real assignment failure does not execute one instruction of fixture entrypoint` continues to verify that under fault conditions (`AssignmentFailure.exe`), zero instructions execute.

---

## 6. Verification Test Results

### A. TypeScript Whole-Workspace Typecheck
```
$ node server/node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json
Exit Code: 0 (Zero errors)
```

### B. Vitest Test Suites
```
$ npm test -- src/__tests__/phase1RuntimeIdentity.test.ts \
             src/__tests__/phase2JobContainment.test.ts \
             src/__tests__/windowsJobBoundary.test.ts \
             src/__tests__/processSpawnConfinement.test.ts

 Test Files  4 passed (4)
      Tests  118 passed (118)
   Duration  11.06s
```

Detailed test breakdown:
- `src/__tests__/phase1RuntimeIdentity.test.ts`: **87 / 87 passed** (Canonical Phase 1 identity hashing, specimen validation, and schema tests).
- `src/__tests__/processSpawnConfinement.test.ts`: **5 / 5 passed** (Static audit confirming zero unapproved child_process invocations, terminalTool refactoring, and delegation paths).
- `src/__tests__/phase2JobContainment.test.ts`: **13 / 13 passed** (Memory limits, CPU rate controls, process saturation, breakaway refusal, and fault injection).
- `src/__tests__/windowsJobBoundary.test.ts`: **13 / 13 passed** (Atomic job creation, pre-resume assignment, descendant termination on timeout/crash, and breakaway refusal).

---

## 7. Remaining Risks & Phase 3 Entry Criteria

1. **Job Objects Do Not Provide Filesystem or Network Sandboxing:**
   Windows Job Objects govern execution lifetimes, CPU quotas, memory limits, and basic UI isolation. They do not isolate file paths or restrict network sockets. Phase 3 must introduce AppContainer tokens or Low Integrity Levels for filesystem and network sandboxing.
2. **Helper Binary Distribution:**
   `JobRunner.exe` is currently compiled into `.tmp/` using .NET Framework 4.0 `csc.exe`. For production packaging, `JobRunner.exe` should be signed and bundled into the application release assets.
3. **Supervisor Pipe Buffer Sizing:**
   Output buffering caps at 1MB per invocation (`maxOutputBytes`). Large high-throughput outputs produce `OS_JOB_OUTPUT_LIMIT`, which safely terminates the process tree but requires callers to stream large outputs via external artifacts.

---

## 8. Hard Architectural Invariants & Stop Confirmation

- **Phase 3 Work Performed:** `FALSE` (Phase 3 has NOT been started).
- **Git Push / Merge / Rebase / Reset:** `NONE`.
- **Installed Runtime Touched:** `NONE`.
- **Status:** **COMPLETE. ALL ACCEPTANCE CRITERIA VERIFIED.**

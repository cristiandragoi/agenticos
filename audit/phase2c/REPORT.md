# Phase 2C Verification and Completion Report: Live Unconfined Path Confinement & Baseline Regression Audit

**Branch:** `wip-secure-20261007`  
**Date:** 2026-10-07  
**Status:** COMPLETED (0 regressions, 0 tsc errors, 142/142 tests passing across Phase 1 & 2 suites)

---

## 1. Executive Summary

Phase 2C completes the containment of live child process execution across AgenticOS:
1. **Baseline Regression Audit:** Executed all 90 failing test files from `audit/phase2b/STEP1-REPORT.md` inside an isolated git worktree created from baseline commit `ee52094` (the initial state before type/path/boundary modifications). The audit verified that **89 test failures are pre-existing** and **0 new regressions** were introduced by Phase 2B changes. (One test file, `phase2JobContainment.test.ts`, failed at `ee52094` but now passes 13/13 on `wip-secure-20261007`).
2. **Live Unconfined Path Containment:** Routed the two live unconfined child process execution paths through the Phase 2 Windows Job Object boundary (`WindowsJob`), failing closed by default:
   - **`server/src/utils/sandbox.ts` (`runSandboxedCommand`):** Used by `codexLoop.ts` via `/api/chat`. Programmatic execution on Windows now runs inside `WindowsJob` with atomic assignment via `PROC_THREAD_ATTRIBUTE_JOB_LIST`, bounded output, timeout, and signal cancellation (`terminateAndWait`). Fails closed with `BLOCKED_UNCONFINED` unless `AGENTICOS_UNCONFINED_TEST_ONLY=true`. `captureWorkspaceSnapshot` delegates to `runSandboxedCommand`.
   - **`server/src/workflows/workers/claude.ts` (`runProcess`):** Used by `dispatchClaude`, `dispatchHermes`, and `dispatchCodex` via `/api/dispatch`. Dispatches `omniroute` CLI or direct executables through `WindowsJob` using PowerShell `@targetArgs` array parameterization, `PATHEXT` resolution, and full process tree cleanup. Fails closed with `BLOCKED_UNCONFINED` by default.
3. **Static & Runtime Verification:** Static audit in `processSpawnConfinement.test.ts` now verifies boundary enforcement for `sandbox.ts` and `claude.ts`. Runtime execution tests confirm both pathways execute successfully within native Windows Job Objects.
4. **TypeScript and Test Health:** `tsc --noEmit` maintains **0 errors**. The Phase 1 & Phase 2 vitest suite executes **142 tests across 6 files with 100% pass rate**.

---

## 2. Step 1: Baseline Regression Check

- **Baseline Commit:** `ee520944b43161c2cc417be47d35edc8f6133527` (per user correction from `81f0274`, as untracked files existed on disk at baseline).
- **Worktree:** Created at `../agenticos-baseline` (`D:\agenticos-baseline`) via `git worktree add ../agenticos-baseline ee52094`.
- **Execution:** Ran all 90 failing test files identified in `STEP1-REPORT.md` with single-worker execution (`vitest run --fileParallelism=false`).
- **Classification:**
  - **Pre-existing Failures:** **89 files** failed identically at commit `ee52094` (database foreign keys, missing fixture mock routes, legacy auth mocks, etc.).
  - **New Regressions:** **0 files**. Zero failures were introduced by Phase 2B/2C changes.
  - **Fixed / Improved:** `phase2JobContainment.test.ts` failed at baseline commit `ee52094` due to missing `JobRunner.exe` binary / unlinked boundary, but passes 13/13 on `wip-secure-20261007`. `phase7BrowserCodeProvider.test.ts` passed 11/11 on both.
- **Cleanup:** Directory junctions cleaned and worktree cleanly removed with `git worktree remove ../agenticos-baseline`.
- **Detailed Report:** See [regressions.md](file:///D:/AgenticOS/audit/phase2c/regressions.md) for the per-file classification table.
- **Commit:** `963fe0a` (`docs(audit): add Phase 2C baseline regression analysis report`).

---

## 3. Step 2: Confinement of Live Unconfined Execution Paths

### 3.1 `server/src/utils/sandbox.ts` (`runSandboxedCommand`)
- **Callers:** `server/src/loops/codexLoop.ts` (lines 1474, 1498, 1503, reachable via `/api/chat`), `server/src/__tests__/sandboxRunner.test.ts`, and `server/src/__tests__/goalMode.test.ts`.
- **Changes Applied:**
  - Added native helper discovery `findJobRunnerHelper()` and executable hash caching.
  - On Windows (`isWin`):
    - If `JobRunner.exe` is absent and `AGENTICOS_UNCONFINED_TEST_ONLY !== 'true'`: Throws `BLOCKED_UNCONFINED: Sandboxed execution outside Phase 2 Windows Job boundary is blocked by policy`.
    - If helper is available: Resolves direct executables (`node`, `git`, `rg`, `python`) or formats batch shims (`npm`, `npx`, `tsc`, `vitest`) through `powershell.exe`.
    - Dispatches execution through `WindowsJob` with strict `safeEnv`, bounded output (1 MB), `windowsHide: true`, and atomic assignment via `PROC_THREAD_ATTRIBUTE_JOB_LIST`.
    - Hooks `signal.addEventListener('abort')` to `job.terminateAndWait()` ensuring prompt cancellation.
    - Treats `rg`/`grep` exit code 1 as empty matches.
    - Captures and truncates stdout and stderr.
  - `captureWorkspaceSnapshot` updated to delegate to `runSandboxedCommand('git', ...)`, eliminating unconfined `child_process.execFile` on Windows.
  - Unconfined fallback (`child_process.spawn` and `execFile taskkill`) is strictly restricted to test environments setting `AGENTICOS_UNCONFINED_TEST_ONLY=true`.

### 3.2 `server/src/workflows/workers/claude.ts` (`runProcess`)
- **Callers:**
  - `server/src/workflows/workers/claude.ts: dispatchClaude` (`runProcess("omniroute", args, cwd)`).
  - `server/src/workflows/workers/hermes.ts: dispatchHermes` (`runProcess("omniroute", args, cwd)`).
  - `server/src/workflows/workers/codex.ts: dispatchCodex` (redirects to `dispatchHermes`).
  - Reachable via `/api/dispatch` (`server/src/routers/laneRouter.ts:27, 29`).
- **Changes Applied:**
  - Dispatches via `WindowsJob` on Windows.
  - If helper is missing and `AGENTICOS_UNCONFINED_TEST_ONLY !== 'true'`: Throws `BLOCKED_UNCONFINED: Worker process execution outside Phase 2 Windows Job boundary is blocked by policy`.
  - For direct binaries (`node`, `.exe`): Executes binary directly inside `WindowsJob`.
  - For command wrappers (`omniroute`): Executes via `powershell.exe` using `@targetArgs` array parameterization to prevent argument interpolation bugs and escaping errors.
  - Environment passes `PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD'` ensuring Windows correctly locates `.exe`/`.ps1`/`.cmd` files.
  - Clamps `timeoutMs` to 60,000ms conforming to `JobRunner` native protocol limits.
  - Legacy `child_process.spawn` fallback is restricted strictly to non-Windows or `AGENTICOS_UNCONFINED_TEST_ONLY=true`.

### 3.3 Inventory and Confinement Tests
- **`audit/phase2b/spawn-inventory.md`:** Updated items 9 (`sandbox.ts`) and 11 (`claude.ts`) from **UNCONFINED** to **ROUTED**.
- **`server/src/__tests__/processSpawnConfinement.test.ts`:**
  - Added static assertion tests verifying `sandbox.ts` and `claude.ts` reference `WindowsJob`, `findJobRunnerHelper`, `job.run(plan)`, `BLOCKED_UNCONFINED`, and `AGENTICOS_UNCONFINED_TEST_ONLY`.
  - Added live runtime test verifying that `runProcess` executes child processes inside `WindowsJob` on Windows.

---

## 4. Verification Results

### 4.1 TypeScript Compilation
```bash
node server/node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json
# Exit code: 0 (Zero errors)
```

### 4.2 Vitest Confinement & Sandbox Suites
```text
 ✓ src/__tests__/phase1RuntimeIdentity.test.ts (87 tests)
 ✓ src/__tests__/processSpawnConfinement.test.ts (9 tests)
 ✓ src/__tests__/goalMode.test.ts (14 tests)
 ✓ src/__tests__/sandboxRunner.test.ts (6 tests)
 ✓ src/__tests__/phase2JobContainment.test.ts (13 tests)
 ✓ src/__tests__/windowsJobBoundary.test.ts (13 tests)

Test Files  6 passed (6)
     Tests  142 passed (142)
  Duration  13.10s
```

All 142 tests pass with 0 failures and 0 skipped.

---

## 5. Git Commit History on `wip-secure-20261007`

1. `fa98fe4` — `fix(types): resolve 32 tsc compilation errors in server`
2. `37ad661` — `fix(domains): fail closed on stubs and correct doubled data path`
3. `672a853` — `docs(audit): add Phase 2B Step 1 report on tsc audit, path fix, and vitest counts`
4. `9280d88` — `feat(securitySupervisor): route process spawns through Phase 2 Windows Job boundary`
5. `853e220` — `feat(securitySupervisor): enforce atomic process creation inside Windows Job via PROC_THREAD_ATTRIBUTE_JOB_LIST`
6. `d3fe961` — `docs(audit): add Phase 2B Step 2 and Step 3 verification report`
7. `aae2d69` — `feat(securitySupervisor): enforce Phase 2 Windows Job boundary by default in terminalExecutor`
8. `f39dc9e` — `docs(audit): add Phase 2B Step 2 review and architectural answers`
9. `963fe0a` — `docs(audit): add Phase 2C baseline regression analysis report`
10. `2535bfd` — `feat(securitySupervisor): route sandbox command execution and claude/hermes workers through Windows Job boundary`

---

## 6. Hard Limits Compliance & Next Steps

- **Hard Limits Observed:**
  - `git push`, `merge`, `rebase`, `reset`, `checkout`, `git clean`, `stash drop` were NOT executed.
  - No application deployment or running of installed app runtime.
  - No real credentials or vault access.
  - No browser, CDP, microphone, or speaker tests executed.
  - Work conducted strictly on local branch `wip-secure-20261007`.
- **Phase 3:** NOT started. Engineering halted per mission instructions.

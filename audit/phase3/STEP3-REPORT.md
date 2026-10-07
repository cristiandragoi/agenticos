# Phase 3 Step 3: Token Plumbing, High-Impact Allowlist & Filesystem Confinement Report

**Execution Date:** October 7, 2026  
**Branch:** `wip-secure-20261007`  
**Status:** COMPLETE (All criteria verified, 0 TypeScript errors)

---

## 1. Executive Summary

Phase 3 Step 3 closed three major security findings identified during the Phase 3 Step 1 audit and established production token plumbing so that AgenticOS functions securely without weakening authentication:

1. **Task A (Token Plumbing):** Implemented secure per-launch authentication token architecture across Electron main, backend process, renderer frontend, and administrative scripts. Electron main generates a 256-bit cryptographic token (`crypto.randomBytes(32)`), injects it into backend child environment, exposes it to renderer solely through IPC context bridge getter (no global window variable, never written to disk or logs), updates frontend API client to supply `Authorization: Bearer <token>`, and enforces token verification in administrative scripts.
2. **Task B (SEC-04 - High-Impact Allow-list):** Replaced legacy permissive regex (`rmdir|del|rm|format|drop|truncate|kill`) with strict read-only command allow-list (`isReadOnlyCommand`). Denies all shell operators (redirection `>`, `>>`, pipes `|`, command separators `;`, `&&`, `||`, subshells `$()`, `` ` ``, variable expansions). Classified all other commands and modifying operations as `high_impact`. High-impact commands fail closed with `APPROVAL_ISSUER_UNAVAILABLE` until the out-of-process issuer exists. Removed `autoApprove: true` bypass.
3. **Task C (SEC-05 - Filesystem Confinement):** Confined `filesystemExecutor` `write`, `create`/`create_folder`, and `delete` operations strictly to the workspace root via realpath validation, NTFS junction/symlink escape prevention, UNC path rejection, cross-drive hop rejection, and sensitive pattern protection. All out-of-workspace attempts fail closed with `CONFINEMENT_VIOLATION`.

---

## 2. Commit Manifest

| Workstream | Commit Hash | Subject | Key Files Changed |
|---|---|---|---|
| **Task A** | `890c614` | `feat(securitySupervisor): enforce per-launch API token plumbing across Electron, renderer, and scripts (Step 3A)` | `electron/backendLifecycle.ts`, `electron/preload.ts`, `electron/main.ts`, `src/api/client.ts`, 34 UI pages/components, `server/scripts/apiAuth.mjs`, `server/scripts/apiAuth.cjs`, `src/__tests__/apiClientTokenPlumbing.test.ts` |
| **Task B** | `9b984c5` | `feat(securitySupervisor): replace high-impact wildcard with allow-list and remove autoApprove bypass (SEC-04)` | `server/src/domains/localWorker/toolRegistryBridge.ts`, `server/src/domains/localWorker/localWorkerManager.ts`, `server/src/__tests__/highImpactCommandAllowlist.test.ts` |
| **Task C** | `397f84c` | `feat(securitySupervisor): confine filesystemExecutor write, create, and delete to workspace root (SEC-05)` | `server/src/domains/localWorker/index.ts`, `server/src/domains/localWorker/workspaceConfinement.ts`, `server/src/domains/jarvis/execution/executors/filesystemExecutor.ts`, `server/src/domains/localWorker/toolRegistryBridge.ts`, `server/src/__tests__/filesystemConfinementBoundary.test.ts` |

---

## 3. Detailed Technical Implementations

### Task A: Per-Launch API Token Plumbing
- **Generation & Propagation:** `electron/backendLifecycle.ts` generates 64-character hexadecimal token on startup. Injected into spawned backend environment `env.AGENTOS_API_TOKEN`. Never saved to disk, config files, or serialized in state/diagnostics.
- **IPC Exposure:** `electron/main.ts` registers `backend:getApiToken` IPC handler. `electron/preload.ts` exposes `window.backendLifecycle.getApiToken()` context bridge method. No token is ever attached to `window` globals directly.
- **Frontend Interceptor:** `src/api/client.ts` provides `apiFetch(input, init)` and `getApiToken()` cache. All direct `fetch()` calls across 34 renderer components and views converted to `apiFetch`, attaching `Authorization: Bearer <token>` on all requests.
- **Script Guardrails:** `server/scripts/apiAuth.mjs` and `apiAuth.cjs` read `AGENTOS_API_TOKEN` from `process.env`. If absent, scripts fail closed immediately with actionable guidance. Updated live scripts (`jarvis-acceptance-live.mjs`, `jarvis-voice-nav-live.mjs`, `sse-format-probe.mjs`, `verify-history.mjs`).

### Task B: SEC-04 Command Allow-List & AutoApprove Removal
- **Allow-list Engine (`isReadOnlyCommand`):**
  - Denies shell operators: `[;&|><`$\n\r]`.
  - Allows only explicit read-only commands:
    - Version queries: `node -v`, `npm -v`, `python -v`, `git -v` (and `--version`).
    - Informational utilities: `whoami`, `hostname`, `uname`, `pwd`, `which`, `where`.
    - Directory listings: `dir`, `ls`, `Get-ChildItem`, `gci`.
    - Content inspection: `cat`, `type`, `Get-Content`, `gc`, `head`, `tail`.
    - Process inspection: `tasklist`, `ps`, `Get-Process`.
    - Harmless echo: `echo <args>`.
    - Read-only git queries: `git status`, `git diff`, `git log`, `git show`, `git rev-parse`, `git describe`, non-mutating `git branch`, `git remote -v`.
- **High-Impact Classification:** All other commands (e.g. `npm install`, `rm`, `del`, `git push`, `git commit`, `curl`, arbitrary scripts) return `high_impact`.
- **Fail-Closed Gate:** In `toolRegistryBridge.ts` and `localWorkerManager.ts`, any `high_impact` operation fails closed with `APPROVAL_ISSUER_UNAVAILABLE` unless explicit test bypass (`AGENTICOS_AUTH_TEST_BYPASS === 'true'`) is enabled.
- **`autoApprove` Invariant:** `task.config?.autoApprove === true` is explicitly ignored for `high_impact` steps. Mutating operations cannot bypass human approval via client flags.

### Task C: SEC-05 Filesystem Confinement
- **Boundary Verification (`assertConfinedWorkspacePath`):**
  - Rejects null bytes (`\0`) and Windows Alternate Data Streams (`:stream`).
  - Rejects DOS reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`).
  - Rejects UNC network paths (`\\server\share`, `//server/share`).
  - Rejects cross-volume drive-letter hops (`C:\` vs `D:\`).
  - Rejects relative directory traversal escaping workspace (`..\`, `..\..\`).
  - Rejects NTFS directory junctions and symbolic links on all path segments.
  - Rejects sensitive file patterns (`.git`, `node_modules`, `server/src`, `.env*`, credentials, private keys, certificates, SQLite databases, `identity.json`, `*approval*`).
  - Verifies canonical `realpath` of candidate and nearest existing ancestor.
- **Executor Enforcement:**
  - `FilesystemExecutor.writeFile`, `createFolder`, `deletePath` enforce `assertConfinedWorkspacePath`.
  - `FilesystemExecutor.deletePath` explicitly refuses deletion of the workspace root itself.
  - Out-of-workspace writes fail closed with `CONFINEMENT_VIOLATION`.

---

## 4. Verification Evidence

### TypeScript Type-Check
```text
npx tsc --noEmit; npx --prefix server tsc --noEmit
Exit code: 0 (0 errors)
```

### Automated Vitest Suites
| Suite / Test File | Tests Passed | Tests Failed | Status |
|---|---|---|---|
| `src/__tests__/apiClientTokenPlumbing.test.ts` | 4 | 0 | **PASS** |
| `electron/__tests__/backendLifecycle.test.ts` | 22 | 0 | **PASS** |
| `server/src/__tests__/processSpawnConfinement.test.ts` | 3 | 0 | **PASS** |
| `server/src/__tests__/phase2JobBoundary.test.ts` | 19 | 0 | **PASS** |
| `server/src/__tests__/windowsJobConcurrency.test.ts` | 1 | 0 | **PASS** |
| `server/src/__tests__/windowsJobTimeout.test.ts` | 2 | 0 | **PASS** |
| `server/src/__tests__/windowsJobMemoryLimit.test.ts` | 2 | 0 | **PASS** |
| `server/src/__tests__/apiAuthenticationBoundary.test.ts` | 13 | 0 | **PASS** |
| `server/src/__tests__/highImpactCommandAllowlist.test.ts` | 20 | 0 | **PASS** |
| `server/src/__tests__/filesystemConfinementBoundary.test.ts` | 18 | 0 | **PASS** |
| **Total Phase 1 / Phase 2 / Phase 3 Tests Verified** | **104** | **0** | **ALL PASS** |

---

## 5. Inventory of Gated Features Pending Out-of-Process Issuer

Because `APPROVAL_ISSUER_UNAVAILABLE` is enforced fail-closed, the following subsystem actions are safely held in a blocked state until Step 4 implements the out-of-process approval issuer:

1. **Local Worker Mutating Commands:** Execution of shell commands outside the read-only allow-list (e.g. `npm install`, arbitrary scripts, file modifications, git mutations).
2. **Local Worker Plain Approval Endpoints:**
   - `POST /api/worker/tasks/:id/approve` (returns HTTP 503 `APPROVAL_ISSUER_UNAVAILABLE`).
   - `POST /api/worker/tasks/:id/resume` with `{ approved: true }` (returns HTTP 503 `APPROVAL_ISSUER_UNAVAILABLE`).
3. **Control Plane Repair / Self-Heal Approval:**
   - `POST /api/self-heal/approve-repair` (returns HTTP 503 `APPROVAL_ISSUER_UNAVAILABLE`).
4. **Third-Party Integrations & Dispatch:**
   - `POST /api/dispatch` (mutating workers blocked without auth/approval).
   - `POST /api/integrations/*` and Telegram configuration (requires auth/approval).
5. **Direct Filesystem Modifying Tools:**
   - `filesystem.write`, `filesystem.create_folder`, `filesystem.delete` called via worker tool registry without verified approval.

---

## 6. Next Steps

Proceed directly to **ITEM STEP4** of the Queued Overnight Plan:
- Implement Out-of-process approval issuer per `audit/phase3/APPROVAL-DESIGN.md`.
- Separate issuer process, ECDSA P-256 signatures, single-use nonce store, human presence interface.
- Wire verifier into approval endpoints, high-impact command paths, and git services.
- Execute 45-case test plan.
- Remove `ApprovalProbe.exe` from production paths (SEC-09).

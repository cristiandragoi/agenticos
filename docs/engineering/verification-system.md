# Antigravity V2 — Engineering Verification System

## 1. Overview & Architecture

The **Antigravity V2 Engineering Verification System** provides an authoritative, multi-level verification pipeline for **Agentic OS**. It prevents false verification claims by enforcing end-to-end component truth across all deployment and execution tiers:

$$\text{SOURCE} \longrightarrow \text{BUILD} \longrightarrow \text{RUNNING BACKEND} \longrightarrow \text{RUNNING ELECTRON RENDERER} \longrightarrow \text{PROVIDER/MODEL} \longrightarrow \text{HTTP/SSE} \longrightarrow \text{WORKER EXECUTION} \longrightarrow \text{USER-VISIBLE RESULT}$$

---

## 2. Explicit Verification Levels & Human Certification Rule

> [!IMPORTANT]
> **MANDATORY GOVERNANCE RULE**:
> - Antigravity may verify **Levels 1–4 automatically**.
> - **ONLY THE HUMAN USER** may grant **LEVEL 5 — USER ACCEPTANCE VERIFIED**.
> - No automated script, test runner, Playwright test, or model output may award Level 5 automatically.

| Level | Identifier | Description | Verification Authority |
| :--- | :--- | :--- | :--- |
| **Level 1** | `LEVEL 1 — UNIT VERIFIED` | Fast isolated unit tests & stream lifecycle invariant checks. | Vitest unit test runner |
| **Level 2** | `LEVEL 2 — INTEGRATION VERIFIED` | Self-test contracts, router integration, and schema validators. | Vitest integration runner |
| **Level 3** | `LEVEL 3 — RUNTIME VERIFIED` | Live backend HTTP/SSE transport, process truth, and scenario runs. | Real HTTP/SSE Test Harness |
| **Level 4** | `LEVEL 4 — PACKAGED APP VERIFIED` | Packaged Electron binary executable (`Agentic OS.exe`). | Real Packaged Desktop UI (`win-unpacked`) |
| **Level 5** | `LEVEL 5 — USER ACCEPTANCE VERIFIED` | Real-world interactive user acceptance on production hardware. | **Human User Only** |

---

## 3. CLI Commands & Verification Modes

| Command | Level Target | Purpose & Scope |
| :--- | :--- | :--- |
| `npm run verify:fast` | Level 1 | Runs fast unit & stream lifecycle tests (sub-second feedback). |
| `npm run verify:integration` | Level 1 + 2 | Runs unit tests and verification system self-test contracts. |
| `npm run verify:runtime` | Level 1 + 2 + 3 | Inspects process truth and executes live HTTP/SSE scenarios. |
| `npm run verify:acceptance` | Level 4 | Launches real packaged Electron binary and runs acceptance matrix. |
| `npm run verify:all` | Levels 1–4 | Full verification matrix from unit tests to packaged binary. |
| `npm run diagnose:runtime` | Diagnostics | Non-destructive port, PID, process, and Hermes truth inspection. |

---

## 4. Hardened Runtime Endpoints

### `GET /api/runtime/identity`
Public, hardened endpoint returning safe process and build metadata without leaking secrets, API keys, credentials, or sensitive database paths:

```json
{
  "status": "ok",
  "component": "backend",
  "buildIdentity": {
    "gitSha": "3e7dae2e7de43b747a5760a372897f1e33441046",
    "gitShort": "3e7dae2e",
    "isDirty": false,
    "buildTimestamp": "2026-08-23T14:31:42.758Z",
    "buildId": "3e7dae2e-20260823-143142",
    "version": "0.0.0",
    "component": "agenticos"
  },
  "process": {
    "pid": 24816,
    "startedAt": "2026-08-23T14:31:50.120Z",
    "uptimeSeconds": 120,
    "nodeVersion": "v24.14.0",
    "port": 4000,
    "mode": "packaged",
    "nodeEnv": "production"
  },
  "database": {
    "engine": "sqlite",
    "migrationVersion": "12",
    "status": "ready"
  },
  "health": {
    "ready": true,
    "databaseOpen": true,
    "apiResponding": true
  }
}
```

---

## 5. Hermes Gateway Endpoint Truth

Hermes endpoint resolution is dynamically evaluated:
1. `process.env.HERMES_API_URL`
2. `LOCALAPPDATA/hermes/profiles/backend-engineer/config.yaml` (`platforms.api_server.port`)
3. Canonical fallback to `http://127.0.0.1:8643` (verified port in runtime configuration).

`diagnose-processes.cjs` reports:
- `configuredEndpoint`
- `actualListeningEndpoint`
- `listeningPid`
- `probeStatus`

---

## 6. Build Mismatch Engine & Precedence

Compares renderer build metadata against backend runtime identity with deterministic precedence:

1. `UNKNOWN_RUNTIME`: Missing or unreachable backend identity metadata.
2. `BUILD_MISMATCH`: Divergent Git commit SHAs between frontend and backend.
3. `STALE_RENDERER`: Same SHA, but backend build is newer than loaded renderer bundle.
4. `STALE_BACKEND`: Same SHA, but loaded renderer bundle is newer than backend server.
5. `MATCH`: Same `buildId`, `gitSha`, and `version`.

---

## 7. Canonical Failure Classifications

| Failure Classification | Meaning / Diagnostic Target |
| :--- | :--- |
| `ROUTING_FAILURE` | Prompt routed to incorrect agent or intent classifier misclassified. |
| `TASK_CONTEXT_FAILURE` | Stale background tasks or zombie history contaminated active turn. |
| `QUEUE_STALL` | Task blocked in concurrency queue without progressing. |
| `WORKER_STALL` | Delegated worker stopped reporting heartbeat activity. |
| `PROVIDER_FAILURE` | LLM inference provider returned upstream 5xx or connection error. |
| `MODEL_TIMEOUT` | LLM inference exceeded execution timeout limit. |
| `TOOL_FAILURE` | Tool execution raised an uncaught exception or failed verification. |
| `APPROVAL_FAILURE` | Approval prompt was not dispatched or failed resolution. |
| `SSE_TRANSPORT_FAILURE` | HTTP/SSE socket closed prematurely or headers rejected. |
| `CLIENT_ABORT` | Post-completion teardown error improperly treated as request failure. |
| `BACKEND_CRASH` | Backend process terminated or restarted unexpectedly mid-turn. |
| `STALE_RENDERER` | Loaded renderer bundle is older than running backend. |
| `STALE_BACKEND` | Running backend process is older than compiled bundle. |
| `BUILD_MISMATCH` | Git SHA divergence between frontend and backend. |
| `DUPLICATE_PROCESS` | Multiple backend or orphaned Electron processes detected. |
| `TEST_ENVIRONMENT_FAILURE` | Test runner harness error or environment missing dependencies. |
| `UNKNOWN` | Unclassified anomalous failure. |

---

## 8. Evidence Bundle Schema (v2.0.0)

Saved to `docs/acceptance/evidence/acceptance-evidence-<timestamp>.json`:

```json
{
  "schemaVersion": "2.0.0",
  "acceptanceRunId": "v2-run-1787495627245-078185",
  "startedAt": "2026-08-23T14:33:47.246Z",
  "completedAt": "2026-08-23T14:34:00.120Z",
  "durationMs": 12874,
  "verificationLevel": "LEVEL 4 — PACKAGED APP VERIFIED",
  "gitSha": "3e7dae2e7de43b747a5760a372897f1e33441046",
  "dirtyState": false,
  "rendererIdentity": { "buildId": "3e7dae2e-20260823-143142" },
  "backendIdentity": { "buildId": "3e7dae2e-20260823-143142" },
  "processTruth": {
    "backendPort": 4000,
    "backendPid": 24816,
    "backendHealthy": true,
    "hermesConfigured": "http://127.0.0.1:8643",
    "hermesListening": true,
    "hermesPid": 27420
  },
  "finalStatus": "PASSED",
  "result": "SUCCESS",
  "failureClassification": null,
  "results": []
}
```

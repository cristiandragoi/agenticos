# AgenticOS — Deployment Record: `read_foreground_screen` (voice-path physical acceptance)

**Cycle scope:** deploy the reviewed build so the operator can physically test the voice
`read_foreground_screen` capability. Nothing else.

**Explicitly out of scope and NOT changed in this cycle:**
`server/src/domains/jarvis/canonicalTurnExecutionService.ts` (HTTP/canonical path) and the
Telegram ingress were not modified, and the HTTP path is **not** claimed fixed.

---

## 1. Gates (all PASS — deployment proceeded)

| Gate | Command | Result |
|---|---|---|
| Targeted tests | `cd server && npx vitest run foregroundScreenRead + voicePipelineRegression + quietRecoveryRouting` | **PASS** — 3 files, 41/41 tests, 5.94s, exit 0 |
| TypeScript | `cd server && npx tsc --noEmit` | **PASS** — exit 0, no output |
| Production build | `npm run build` (root) | **PASS** — exit 0 |

## 2. Identity before → after

| | Before | After |
|---|---|---|
| Installed server `buildId` (on disk) | `8f7463aa-dirty-20260930-200651` | `8f7463aa-dirty-20260930-204411` |
| Backend-reported `buildId` (`/api/health`) | `8f7463aa-dirty-20260930-200110` | `8f7463aa-dirty-20260930-204411` |
| `fingerprint` | `b67c476aa013e202ff0f36e62529425da6ee8b273ec45ed3cff72d61f642a2b8` | `cdce83fe17fd10f86f24f3156cdc02a5b03580a926807e00a99e349a34c3c8e6` |
| `filesCount` | 646 | 648 |

**Observation on the "before" row (reported for accuracy, not a defect):** before this
deployment the on-disk identity file said `…-200651` while the running backend reported
`…-200110`. Both carried the **same fingerprint** `b67c476a…`, i.e. the same code content;
only the identity file's build timestamp differed. After deployment, on-disk and running
identity agree exactly (`…-204411` / `cdce83fe…`).

**Why the fingerprint change is the load-bearing evidence:** `filesCount` went 646 → 648 and
the fingerprint changed, accounting for exactly the two new modules compiled by this task:
`resources/server/dist/services/perception/foregroundScreenReader.js` and
`resources/server/dist/domains/jarvis/execution/foregroundScreenIntent.js` (both present on
disk in the installed tree, timestamped 22:44).

## 3. Deployment

Stopped the previously running runtime first (0 `AgenticOS.exe` left, port 4600 free), then:

`npm run deploy:installed` → exit 0, complete replacement of all four trees, byte parity verified.

| Tree | Files |
|---|---|
| `server/dist` | 649 |
| `server/scripts` | 182 |
| `app/dist-electron` | 3 |
| `app/dist` (frontend) | 23 |

### Backups created by this deployment (rollback for the installed tree)

```
resources/server/dist.backup-2026-09-30T20-44-47-360Z
resources/server/scripts.backup-2026-09-30T20-44-47-360Z
resources/app/dist-electron.backup-2026-09-30T20-44-47-360Z
resources/app/dist.backup-2026-09-30T20-44-47-360Z
```

To roll back: stop the app, then for each `X.backup-2026-09-30T20-44-47-360Z` remove `X` and
rename the backup to `X`. The previous cycle's backups
(`*.backup-2026-09-30T20-01-42-895Z`) are also still present and unchanged.

## 4. Post-deployment verification

| Check | Evidence |
|---|---|
| Backend healthy | `GET /api/health` → `{"status":"healthy","pid":27744,...}` |
| **Running the new build** | `build.buildId = 8f7463aa-dirty-20260930-204411`, `fingerprint = cdce83fe…`, `filesCount = 648` — equals the deployed artifact |
| Backend runs from the installed tree | PID 27744 = `node.exe` → `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\server\dist\index.js` |
| Runtime identity | `GET /api/runtime/health` → `{"status":"healthy","ready":true,"databaseOpen":true,"pid":27744,"buildId":"8f7463aa-dirty-20260930-204411"}` |
| Electron shell | `AgenticOS.exe` MAIN 26156, gpu-process 26292, utility 33672, renderer 30176 |
| **Hermes gateway** | `GET /api/health/hermes-gateway` → `{"state":"HERMES_API_HEALTHY","processAlive":true,"processIds":[3888],"apiReachable":true,"apiHttpStatus":200,"apiUrl":"http://127.0.0.1:8642","apiContractValid":true,"critical":false}` |

## 5. Rollback state (this cycle)

`.deploy-rollback/20260930-224306/` contains: `HEAD-sha.txt`, `git-status-porcelain.txt`,
`tracked-changes.diff` (full working-tree diff), `untracked-files.txt`,
`installed-dist-identity.BEFORE.json`, `installed-dist-identity.AFTER.json`,
`runtime-health.BEFORE.json`, `runtime-health.AFTER.json`, and the four gate logs.

## 6. Constraints honoured

- No additional fixes were implemented.
- `canonicalTurnExecutionService` and the Telegram ingress were not modified.
- No GUI automation was run after deployment.
- No physical acceptance was performed by the agent.
- Nothing was committed or pushed.

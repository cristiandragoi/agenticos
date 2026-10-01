# AgenticOS — Physical Acceptance Deployment Record

**Generated:** 2026-09-30 22:0x (local, Europe/Berlin)
**Performed by:** Hermes implementation agent, on operator instruction
**Scope:** RC1 (acknowledgement lifecycle) + RC2 (quiet_recovery silence) + RC3 (turn identity) build → installed desktop runtime
**Independent review status:** PASS WITH CONCERNS (reviewer: Claude Sonnet)

---

## 1. Repository state snapshot (rollback source)

| Item | Value |
|---|---|
| Repo | `D:\AgenticOS` |
| Branch | `hermes-rescue-20260908` |
| HEAD | `8f7463aa6931d57e12ec81b904b98cec04e932cf` |
| Tracked files modified | 53 |
| Untracked files (excl. ignored) | 2928 |

Files in this directory:

| File | Contents |
|---|---|
| `HEAD-sha.txt` | HEAD commit sha |
| `git-status-porcelain.txt` | full `git status --porcelain` |
| `tracked-changes.diff` | full `git diff` (9031 lines) — every tracked modification |
| `untracked-files.txt` | list of all untracked, non-ignored files (2928) |
| `installed-build-identity.BEFORE.json` | installed runtime identity before deploy |
| `installed-build-identity.AFTER.json` | live `GET /api/health` after deploy |
| `installed-dist-identity.AFTER.json` | deployed `resources/server/dist/build-identity.json` after deploy |
| `installed-processes.BEFORE.csv` | process snapshot before deploy (empty → none running) |
| `listening-ports.BEFORE.txt` | listening sockets before deploy |
| `listening-ports.AFTER.txt` | listening sockets after deploy |
| `step3-targeted-tests.log` | targeted RC1/RC2 test output |
| `step4-tsc.log` | `npx tsc --noEmit` output |
| `step5-build.log` | production build output |
| `step6-deploy.log` | `npm run deploy:installed` output |

**Restore the working tree** (do not run while a build is in progress):
```
cd D:\AgenticOS
git apply --whitespace=nowarn .deploy-rollback/20260930-220013/tracked-changes.diff
```
Untracked files are enumerated in `untracked-files.txt`; they were not archived (list only).

---

## 2. Before / after identity

| | Before | After |
|---|---|---|
| Installed server `buildId` | `8f7463aa-dirty-20260930-182806` | `8f7463aa-dirty-20260930-200110` |
| Installed server `fingerprint` | `32e9edc18ebd469acedaa74bddd41a2024bae89fd2361dcafb6c38087d4d44f8` | `b67c476aa013e202ff0f36e62529425da6ee8b273ec45ed3cff72d61f642a2b8` |
| `filesCount` | 646 | 646 |
| Runtime process | **none running** (no `AgenticOS.exe`, port 4600 free) | Electron + backend running |

---

## 3. Gates run before deployment (all PASS)

| Gate | Command | Result |
|---|---|---|
| Targeted RC1/RC2 regression | `cd server && npx vitest run src/__tests__/voicePipelineRegression.test.ts src/__tests__/quietRecoveryRouting.test.ts` | **PASS** — 2 files, 11/11 tests, 5.50s |
| TypeScript | `cd server && npx tsc --noEmit` | **PASS** — exit 0, no output |
| Production build | `cd /d/AgenticOS && npm run build` | **PASS** — exit 0 → buildId `8f7463aa-dirty-20260930-200110` |

---

## 4. Deployment

Command: `npm run deploy:installed` (→ `scripts/deploy-installed.cjs`), exit 0.

| Tree | Files | Parity |
|---|---|---|
| `server/dist` | 647 | byte-verified |
| `server/scripts` | 182 | byte-verified |
| `app/dist-electron` | 3 | byte-verified |
| `app/dist` (frontend) | 23 | byte-verified |

Installed root: `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS`

### Rollback path (installed artifacts)

The deploy script never deletes backups. This deployment's backups:

```
resources/server/dist.backup-2026-09-30T20-01-42-895Z
resources/server/scripts.backup-2026-09-30T20-01-42-895Z
resources/app/dist-electron.backup-2026-09-30T20-01-42-895Z
resources/app/dist.backup-2026-09-30T20-01-42-895Z
```

To roll back: stop the app, then for each pair `X.backup-2026-09-30T20-01-42-895Z` → `X`,
remove `X` and rename the backup to `X`. Hundreds of older backups from previous cycles also
exist under `resources/app/` and `resources/server/`.

---

## 5. Post-deployment verification

| Check | Evidence |
|---|---|
| Backend healthy | `GET http://localhost:4600/api/health` → `{"status":"healthy","pid":26260,...}` |
| **Running the new build** | `build.buildId = 8f7463aa-dirty-20260930-200110`; `build.fingerprint = b67c476a…` — both equal the deployed artifact identity |
| Backend runs from installed tree | PID 26260 = `node.exe`, command line `node C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\server\dist\index.js` |
| Runtime identity endpoint | `GET /api/runtime/health` → `{"status":"healthy","ready":true,"databaseOpen":true,"pid":26260,"buildId":"8f7463aa-dirty-20260930-200110"}` |
| Electron shell | `AgenticOS.exe` PIDs `400, 11164, 28024, 32240`, all started 2026-09-30 22:02:08 |
| Hermes gateway | `GET /api/health/hermes-gateway` → `{"state":"HERMES_API_HEALTHY","processAlive":true,"processIds":[3888],"apiReachable":true,"apiHttpStatus":200,"apiUrl":"http://127.0.0.1:8642","apiContractValid":true,"critical":false}` |

---

## 6. Flagged items for the operator

1. **`VOICE ERROR` literal is NOT present in the deployed server bundle** (`grep -rl "VOICE ERROR" resources/server/dist` → 0 matches). A previously recorded deployment protocol required this string to be present before accepting a deployment. It is absent in this build. Not treated as a blocker here because the operator's stated acceptance criteria for this cycle were the targeted tests + `tsc` + build, and the independent review passed; reported so the operator can decide.
2. **voice `memory_write` is NOT fixed.** Independent review confirmed dedicated voice `memory_write` routing is still unresolved. No claim of a fix is made anywhere in this record or in the deployment report.
3. Deployment was performed with no AgenticOS runtime previously running, so there was no prior PID to terminate; the runtime was started fresh by launching the installed app.
4. No GUI automation was executed after deployment. No physical acceptance was performed.

---

## 7. Constraints honoured

- No source code was modified during the deployment cycle.
- No commit, no push.
- No GUI automation after deployment.
- No physical acceptance performed by the agent.

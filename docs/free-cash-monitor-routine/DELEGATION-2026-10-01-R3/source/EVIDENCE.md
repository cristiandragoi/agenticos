# Stream S — EVIDENCE LEDGER

Delegation DELEGATION-2026-10-01-R3 · Stream S · 2026-10-01 Europe/Berlin.
Every claim is tagged **[A]** measured this pass (command + exit + raw capture), **[B]** read from source (`file:line`),
or **[C]** inherited from another document and NOT re-verified. Raw captures are in `raw/`.

Shell = git-bash/MSYS. Interpreter of record =
`C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (3.11.9).

---

## A. MEASURED THIS PASS

### A0. Environment / provenance
Command: `git rev-parse --abbrev-ref HEAD; git rev-parse HEAD; date`
Exit 0. Output: `hermes-rescue-20260908` / `8f7463aa6931d57e12ec81b904b98cec04e932cf` / `Do, 1. Okt 2026 09:28:03`.
→ matches the brief's HEAD. Capture: run transcript.

### A1. Live HTTP on the Day-1 host — `raw/01-live-http-probes.txt`
| Command | Exit | Raw result |
|---|---|---|
| `curl -s -m5 -w 'HTTP %{http_code}\n' http://localhost:4600/api/health` | 0 | `HTTP 200` body `{"status":"healthy","pid":32500,"uptime":5130.6,...,"environment":"development","version":"9.0.0","build":{"fingerprint":"08029d64...","filesCount":648,"gitSha":"8f7463aa6931d57e12ec81b904b98cec04e932cf","gitShort":"8f7463aa","isDirty":true,"buildTimestamp":"2026-10-01T05:49:00.903Z","buildId":"8f7463aa-dirty-20261001-054900"}}` |
| `curl ... http://localhost:4600/api/v1/status/metrics` | 0 | `HTTP 404` `{"error":{"code":"NOT_FOUND","message":"Route GET /api/v1/status/metrics not found","requestId":"38a5002e-..."}}` |
| `curl ... http://localhost:4600/api/v1/status` | 0 | `HTTP 404` `Route GET /api/v1/status not found` |
| `curl ... http://127.0.0.1:3001/health` | 7 | `HTTP 000` (connection refused) |
| `curl ... http://localhost:3001/api/v1/status/metrics` | 7 | `HTTP 000` (connection refused) |
| `curl ... http://127.0.0.1:4600/api/health` | 0 | `HTTP 200` same body (IP form works) |

### A2. Listeners / processes — `raw/02-listeners-and-procs.txt`
- `netstat -ano | grep 4600` → `TCP 127.0.0.1:4600 0.0.0.0:0 LISTENING 32500` (+ many ESTABLISHED to 4600, peer PID 23988). No listener on 3001.
- `tasklist /FI "PID eq 32500"` → `node.exe 32500 Console 1 281.676 K`.
- `tasklist | grep -i electron` → `(no electron process)`. ⇒ the live FreeCash server is node, **0 electron**.

### A3. State roots — `raw/03-state-roots.txt`, `raw/07-state-contents.txt`
- `find /d/AgenticOS/data/freecash` → the directory only, **no children** (empty).
- `data/freecash-monitor/` → `state/{last-run.json, operator-state.json, day-locks/{2026-09-20,2026-09-30,2026-10-01}.lock, notified-keys.json}`, `snapshots/{2026-09-20,2026-09-30,2026-10-01}.json`, `alerts/alerts.jsonl`, `logs/`.
- `server/data/freecash-monitor/` → `INTEGRATION_STATUS.md`, `README.md` only (docs).
- `state/operator-state.json` → `"records": []` (no reading ever entered).
- `state/last-run.json` → `last_attempt_day=2026-10-01, last_success_day=2026-10-01, last_outcome=MONITOR_DEGRADED, consecutive_missed_days=0, timezone=Europe/Berlin, updated_at_utc=2026-10-01T06:53:46Z`.
- `snapshots/2026-10-01.json` → `source.data_available=false`, `degraded=true`, all four fields `null`.
- `alerts/alerts.jsonl` last line → `MONITOR_DEGRADED ... No data for 2026-10-01 (no operator-entered record ...) ... ts_utc=2026-10-01T06:53:46Z`.

### A4. The routine's real transport vs the live host — `raw/19-transport-probe.txt`
`probe_source_candidates.py` (calls the real `readonly_client`). Exit 0. Printed:
`ALLOWED_METHODS=['GET','HEAD']`, `ALLOWED_HOSTS=['127.0.0.1','::1','[::1]','localhost']`,
`ALLOWED_PATHS=['^/api/v1/status/metrics$','^/api/v1/status$']`, `DEFAULT_BASE_URL=http://localhost:3001`. Results:
```
READERR | read_metrics base=4600            -> ReadError: GET /api/v1/status/metrics returned HTTP 404
READERR | read_metrics base=3001 (default)  -> ReadError: GET /api/v1/status/metrics failed: [WinError 10061] ... Verbindung verweigerte
OK      | probe_status base=4600            -> HTTP 404
BLOCK   | GET /api/health (4600)            -> ForbiddenWriteError: R2: path not allowlisted: '/api/health'
BLOCK   | GET /api/projects/.../freecash/auth -> ForbiddenWriteError: R2: path not allowlisted
ERR     | GET /api/v1/status/metrics (3001)  -> ConnectionRefusedError [WinError 10061]
```

### A5. Wired routine end-to-end in a throwaway root — `raw/20-operator-source-e2e.txt`, `raw/20b-operator-source-present.txt`
`probe_operator_source.py` under `FREECASH_DATA_ROOT=$LOCALAPPDATA/Temp/fc-r3-src-*/root` (asserted to be under Temp).
- **empty records** → exit 0; stdout `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0`.
- **one record for today** → exit 0; stdout `RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) ... changes=0`; snapshot `account_status="ACTIVE", earnings_total_cents=1340, balance_cents=1340, pending_cents=0, currency="USD"`.

### A6. Live FreeCash auth/session endpoint — `raw/11-freecash-auth-endpoint.txt`
| Command | Exit | Result |
|---|---|---|
| `curl -s -m5 http://localhost:4600/api/projects` | 0 | `HTTP 200`; projects include `proj-shopify`, `proj-tiktok-shop`, `proj-3edb8bb8` |
| `curl -s -m5 http://localhost:4600/api/projects/proj-free-cash/freecash/auth` | 0 | `HTTP 200` `{"service":"freecash","label":"FreeCash","sessionState":"unauthenticated","satisfied":false,"blocker":"FreeCash session evidence is stale (last live check 2026-09-23T15:32:31.406Z).","checkedAt":"2026-10-01T07:30:55.335Z","evidence":{"sessionValid":false,"credentialAvailable":true,"externalConnected":true},"goal":{...,"projectId":"proj-free-cash","status":"blocked_waiting_for_auth",...},"tasks":[]}` |
| same with `projectId` = `main` and `1` | 0 | identical body (route ignores/loosely matches projectId) |

No credential or auth header was sent.

### A7. Local session evidence (outside the repo) — `raw/15-dbpath.txt`, `raw/16-appdata-evidence.txt`, `raw/18-evidence-contents.txt`
- `find ... -name session-evidence.json` (repo) → none; the file is at
  `C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\freecash\session-evidence.json` (found by searching `$APPDATA`).
- Content: `{"service":"freecash","authenticated":true,"verifiedAt":"2026-09-23T15:32:31.406Z","evidencePath":"...\\evidence\\session-authenticated-mue9i5qd-3b0799d2.json","detail":"final_url=https://freecash.com/en; cookie_count=8; session_cookie_present=true"}`.
- `evidence/` holds 26× `inspect-work-*.json` (each `{"state":"authenticated","items":[],"url":"https://freecash.com/en"}`) and 27× `session-authenticated-*.json`. **No balance/earnings figures.**
- `browser_profiles/freecash-main/storage_state.json` → keys `['cookies','origins']`, 8 cookies, names include `session_id, fc_access_token, fc_refresh_token`. **Credential-bearing; not read by the routine.**

### A8. Freshness math — `raw/23-legacy-runs-and-db.txt`
`verifiedAt 2026-09-23T15:32:31.406Z` vs `now 2026-10-01T07:34:49.417Z` → `age_days=7.67`, `fresh(<=1d)? False`.

### A9. False-compliance verifier — `raw/06-false-compliance.txt`
| Command | Exit | Result |
|---|---|---|
| `node --check server/scripts/freecash-daily-monitor.mjs` | **1** | `...mjs:41  function isDailyCheckAllowed(): boolean {` / `SyntaxError: Unexpected token ':'` |
| `node --check server/scripts/verify-freecash-rules.mjs` | 0 | (parses) |
| `node server/scripts/verify-freecash-rules.mjs` | **0** | prints `✓ Rule 1..4 → PASSED` and `[OK] All 4 operational rules verified (4/4 passed)` |
→ the verifier green-lights, exit 0, a monitor that cannot be parsed. (node v24.20.0.)

### A10. SQLite / prior-run artefacts — `raw/23-legacy-runs-and-db.txt`, `raw/24-runtime-logs-and-git.txt`
- `database.sqlite`, `server/database.sqlite`, `server/data/database.sqlite` → **all 0 bytes, 0 tables** (opened read-only via `sqlite3` URI `mode=ro`). No `accounts`/`events_logs`/`status_checks`.
- `server/tasks/daily_monitor.log` exists → `Running in SIMULATE mode ...`, `Database connected to D:\AgenticOS\server\tasks\..\database.sqlite`, `Checked 0 account(s): []`, `Daily routine finished (checks=0, approve_needed=False)`, `Daily check skipped (run within last 24h)` ×3. `last_run_time.json` = `1789847478.493505`.
- `logs/daily_monitor_runtime.log` (2026-09-20) → `action=fetch_error ... HTTPConnectionPool(host='localhost', port=3001): ... url: /api/v1/status/metrics ... [WinError 10061] ...`; then `action=daily_check_failed day=2026-09-20 details=metrics_not_available`. `data/monitoring/` does **not** exist.

### A11. Legacy path resolution — `raw/22-legacy-verification.txt`
`python -c` on `Path('D:/AgenticOS/scripts/make_freecash_check.py').resolve()` → `parents[2] = D:\` → `DATA_DIR = D:\data\freecash`, `exists = False`.

### A12. Git tracking of legacy artefacts — `raw/22-legacy-verification.txt`
`git ls-files --error-unmatch <f>` for each of the 7 artefacts → **UNTRACKED** (all seven).
`git status --porcelain -- docs/.../DELEGATION-2026-10-01-R3/` → `?? docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/` (only my new dir; no tracked file modified by this stream).

### A13. Scheduling / references — `raw/21-scheduling-and-refs.txt`
- `schtasks /query /fo LIST | grep -iE 'freecash|finance.monitor|daily.monitor'` → `(no matching scheduled task)`.
- `grep` for adapter import sites → `server/src/domains/jarvisNext/operator/operatorController.ts:4` and `server/src/domains/jarvisV2/turnController.ts:24`.

---

## B. READ FROM SOURCE (`file:line`)

- `monitoring/freecash/run_daily_check.py:52` — `DEFAULT_SOURCE = "operator_state"`; `:53` — `SOURCES = ("operator_state","metrics_http")`; `:64-77` — `read_source()` dispatch; `:307-321` — day-lock gate; `:371-393` — read-failure path (exit 5).
- `monitoring/freecash/paths.py:35` — `DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`; `:45-48` — `data_root()` honours `FREECASH_DATA_ROOT`.
- `monitoring/freecash/readonly_client.py:39` `ALLOWED_METHODS`; `:41` `ALLOWED_HOSTS`; `:43-49` `ALLOWED_PATHS`; `:54` `DEFAULT_BASE_URL`; `:110-140` guard in `request()`; `:146-176` audit hook; `:229-239` `read_status_source` = W1+W2.
- `monitoring/freecash/operator_state.py:12-15` (no socket/no credential); `:48-56` `TEMPLATE_RECORD`; `:91-97` `ensure_template`; `:119-151` `read_source` (returns `data_available` False when no record for `day`).
- `monitoring/freecash/changedetect.py:34-39` `COMPARED_FIELDS`; `:111-138` `normalize_metrics` (raises `MetricError` if `account_status` missing).
- `monitoring/freecash/gate.py:51-53,96-102` timezone/day-key; `:119-135` atomic `O_CREAT|O_EXCL` day lock; `:188-202` `record_outcome` (`SUCCESS_OUTCOMES` includes `MONITOR_DEGRADED`).
- `server/src/routers/projects.ts:344-379` `freeCashAuthStatus()` — "Cookie values, credentials and tokens are NEVER read, stored or returned"; `:381-392` GET/POST `/api/projects/:projectId/freecash/auth`.
- `server/src/index.ts:275` `app.use('/api/health', healthRouter)`; `:327` `app.use('/api/projects', projectsRouter)`.
- `server/src/services/prerequisites/prerequisiteService.ts:53-59` `dataDir()=dirname(resolvedDbPath)`, `sessionEvidencePath()`; `:51,148-153` 24 h freshness; `:137-146` `hasPersistedStorageState` (cookie *names/count* only).
- `server/src/db/index.ts:327` `export const resolvedDbPath = canonicalDbPath` (real DB = `%APPDATA%\AgenticOS\data\agentic-os.db`, per A7).
- `server/scripts/verify-freecash-rules.mjs:23-44` — `checkRule2/3/4` are `content.includes(...)` text greps.
- `server/scripts/freecash-daily-monitor.mjs:41` — `function isDailyCheckAllowed(): boolean {` (TS annotation in `.mjs`); `:32` hardcodes `https://api.freecash.com/v1/status`.
- `server/src/adapters/freecashMonitorAdapter.ts:198-209` — `fetchStatus()` hardcoded stub.
- `scripts/make_freecash_check.py:8-11` `BASE=parents[2]`, `DATA_DIR=BASE/"data"/"freecash"`; `:18-21` `prepare_actions` (withdraw); `:49-52` `run_action`; `:98-99` `__main__` guard.
- `scripts/monitoring/free-cash-daily-check.py:25` `BASE_URL=http://localhost:3001`; `:26` `METRICS_ENDPOINT=/api/v1/status/metrics`; `:225` `def main()`; file ends at `:294` with **no** `__main__` guard.
- `finance-monitor/src/wait_gate.py:95-102` — `import random`; `random.choice([("APPROVE",True),...])` fabricates approval.
- `finance-monitor/src/api_client.py:22,57-60,75-95` — sandbox base URL + simulated balances/earnings.
- `config/freecash-crontab:7` — `/path/to/AgenticOS/scripts/make_freecash_check.py` (literal placeholder).

---

## C. INHERITED — NOT RE-VERIFIED IN THIS PASS

Taken from prior plan documents (`docs/.../.hermes/plans/*`, `artifacts/freecash-monitor-plan/*`,
`docs/free-cash-monitor-routine/PROVIDER-*`). Leads only:
- `freecashMonitorAdapter` call sites `turnController.ts:414` and `operatorController.ts:115` (I confirmed the imports, not those exact call sites).
- `make_freecash_check.py` "`save_today()` lacks `mkdir` → exit 1" (I confirmed the non-existent `D:\data\freecash` path only).
- "`scripts/monitoring/free-cash-daily-check.py` had activity at 21:10:50 today / no scheduled task exists" (I confirmed the log exists and is dated 2026-09-20, and that no task is scheduled).
- "V13: every legacy candidate R1..R4 = FAIL, exit 1" and "quarantine, never delete".
- Provider-side: no live read-only provider status/earnings API exists for the account, and consumer-platform automation is ToS-prohibited (`PROVIDER-API-RESEARCH.md` §7) — assumed, not re-derived here; it is the stated reason the operator file exists.

---

## D. Constraint compliance for this stream
- No credential/token/secret used anywhere; the auth probe was a bare loopback GET; cookie **values** were never read (only names, in A7).
- No POST/PUT/PATCH/DELETE issued. No non-loopback socket. No `node` run that writes (only `--check` and the read-only verifier's `console.log`).
- All routine runs used `FREECASH_DATA_ROOT=$LOCALAPPDATA/Temp/.../root`; no state root under `D:/AgenticOS` was written.
- No allowlist widened, no file created/modified outside `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/source/`; no git write, no scheduled task.
- Desktop app not started (0 electron processes throughout).

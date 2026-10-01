# Stream S — SOURCE DECISION (read source)

**Delegation:** DELEGATION-2026-10-01-R3 · **Stream:** S · **Date:** 2026-10-01 (Europe/Berlin)
**Repo:** D:\AgenticOS · branch `hermes-rescue-20260908` · HEAD `8f7463aa6931d57e12ec81b904b98cec04e932cf` · `isDirty: true`
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (3.11.9)
**Question:** which status-reading source is *actually reachable today* without a provider credential, and what is the day-1 first action for each.

Evidence standard: every claim below is tagged **[A] measured this pass** (command + exit + raw capture in `raw/`),
**[B] read from source** (`file:line`), or **[C] inherited, NOT re-verified**.

---

## 0. Bottom line

| # | Candidate source | Reachable today, no credential? | Yields the 4 compared figures? | Verdict |
|---|---|---|---|---|
| 1 | **Operator-entered state file** (`state/operator-state.json`, source `operator_state`) | **YES** — local file, no socket | **YES** (all four) | **RANK 1 — the only source that can feed the monitor today.** Human-gated (a human types the figures). |
| 2 | **`GET /api/projects/:id/freecash/auth` on `http://localhost:4600`** | **YES** — live, HTTP 200, no credential, loopback GET | **NO** (session/auth state only) | RANK 2 — a real credential-free status signal, but for *auth/session state*, not earnings/balance. Needs an allowlist entry + new read op. |
| 3 | **Offline session-evidence file** `%APPDATA%\AgenticOS\data\freecash\session-evidence.json` | **YES** — local file, no socket | **NO** (auth boolean + timestamp) | RANK 3 — offline mirror of (2); stale (7.67 d); needs a new file-read source kind. |
| 4 | **`metrics_http`** (`GET /api/v1/status/metrics`, `HEAD /api/v1/status`) | **NO** | **NO** | **DEAD today** — HTTP 404 on the live server (4600); connection refused on the default base (3001). |
| 5 | `GET /api/health` on `http://localhost:4600` | yes, but **not allowlisted** | **NO** (liveness/build JSON) | Not a monitor source; at most a liveness probe. |

**The routine has never had a live number.** The only reachable source that produces the four compared fields
(`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`) is the **operator-entered file**, and it is
empty (`records: []`), which is exactly why every snapshot to date is `degraded: true` with all four fields `null` [A].

---

## 1. The wired read path (what "source" even means here)

`monitoring/freecash/run_daily_check.py` is the single entry point. It accepts exactly two sources [B, `run_daily_check.py:52-53`]:

```
DEFAULT_SOURCE = "operator_state"
SOURCES = ("operator_state", "metrics_http")
```

- `--source operator_state` (DEFAULT) → `operator_state.read_source(day)` — reads `state/operator-state.json`. **No socket.**
  [B, `run_daily_check.py:64-77`, `operator_state.py:119-151`]
- `--source metrics_http` → `readonly_client.read_status_source(...)` → `GET /api/v1/status/metrics` then `HEAD /api/v1/status`.
  [B, `run_daily_check.py:66-76`, `readonly_client.py:229-239`]

Both sources are normalised to the same four fields by `changedetect.normalize_metrics` [B, `changedetect.py:111-138`].
`readonly_client` is the routine's ONLY network path; its deny-by-default allowlist is [A + B, `readonly_client.py:39-49`]:

```
ALLOWED_METHODS = {'GET','HEAD'}                       # line 39
ALLOWED_HOSTS   = {'localhost','127.0.0.1','::1','[::1]'} # line 41
ALLOWED_PATHS   = ('^/api/v1/status/metrics$', '^/api/v1/status$') # lines 43-49
DEFAULT_BASE_URL = 'http://localhost:3001'             # line 54
```

I did **not** widen any allowlist. Any proposal below states the entry it would need and why it is safe.

---

## 2. Live facts (measured this pass)

Command set: `raw/01-live-http-probes.txt`, `raw/02-listeners-and-procs.txt`, `raw/19-transport-probe.txt`.

| Probe | Result | Capture |
|---|---|---|
| `curl -m5 localhost:4600/api/health` | **HTTP 200** `{"status":"healthy","pid":32500,...,"version":"9.0.0","build":{...,"gitSha":"8f7463aa...","isDirty":true}}` | 01 |
| `curl -m5 localhost:4600/api/v1/status/metrics` | **HTTP 404** `{"error":{"code":"NOT_FOUND","message":"Route GET /api/v1/status/metrics not found",...}}` | 01 |
| `curl -m5 localhost:4600/api/v1/status` | **HTTP 404** `Route GET /api/v1/status not found` | 01 |
| `curl -m5 127.0.0.1:3001/health` | **HTTP 000**, curl exit **7** (connection refused) | 01 |
| `curl -m5 localhost:3001/api/v1/status/metrics` | **HTTP 000**, curl exit **7** | 01 |
| `netstat -ano` | `127.0.0.1:4600` LISTENING, owner **PID 32500**; **nothing on 3001** | 02 |
| `tasklist /FI "PID eq 32500"` | `node.exe  32500  Console` (the live server is **node**, not electron) | 02 |
| electron processes | **0** | 02 |
| `GET /api/projects/:id/freecash/auth` (4600) | **HTTP 200** (see §4) — works with **no credential sent** | 11 |

**Reading of the live host:** the Free Cash server that is actually up is a **node process on 4600** exposing
`/api/health`. The routine's network source is hard-wired to **port 3001** with path `/api/v1/status/metrics` — a port on
which **nothing is listening** and a path that **does not exist on the live server**. This is a double miss.

### 2.1 The routine's own transport, run against the live host (measured)

`raw/19-transport-probe.txt` — `probe_source_candidates.py` calls the real `readonly_client` (GET/HEAD, loopback only):

```
READERR| W1 read_metrics base=4600            -> ReadError: GET /api/v1/status/metrics returned HTTP 404
READERR| W1 read_metrics base=3001 (default)  -> ReadError: GET /api/v1/status/metrics failed:
                                                 [WinError 10061] ... die Verbindung verweigerte
OK     | W2 probe_status base=4600            -> HTTP 404
BLOCK  | GET /api/health on 4600             -> ForbiddenWriteError: R2: path not allowlisted: '/api/health'
BLOCK  | GET /api/projects/.../freecash/auth -> ForbiddenWriteError: R2: path not allowlisted
```

So the `metrics_http` source fails **before any comparison can happen**, with two distinct dead ends recorded:
`404` (wrong path) and `WinError 10061` (wrong port). A dead end reported honestly is the result here.

---

## 3. RANK 1 — operator-entered state file (the only source that feeds the monitor today)

- **Reachable:** yes. Pure local file read, opens no socket, holds no credential. [B, `operator_state.py:12-15,119-151`]
- **Yields the four figures:** yes.
- **Wired:** yes — it is `DEFAULT_SOURCE`. [B, `run_daily_check.py:52`]
- **Current state:** `records: []` — no reading has ever been entered. [A, `raw/07-state-contents.txt`]

**Measured end-to-end** in a throwaway root (`FREECASH_DATA_ROOT=$LOCALAPPDATA/Temp/...`), interpreter of record
(`raw/20-operator-source-e2e.txt`, `raw/20b-operator-source-present.txt`):

```
# empty records -> no number
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) ... changes=0
snapshot: data_available=false, account_status=null, earnings_total_cents=null, balance_cents=null, pending_cents=null

# one record for today -> a real number
RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) ... changes=0
snapshot: account_status="ACTIVE", earnings_total_cents=1340, balance_cents=1340, pending_cents=0, currency="USD"
```

This proves the wired path yields a genuine first reading the moment a record exists. **Human-gated:** the monitor
cannot start the operator's browser; the human must log in themselves and read four numbers.

**Day-1 first action:**
1. Human opens their own FreeCash dashboard in a browser and signs in **themselves** (the routine must not, and cannot,
   do this). Read four values: account status, total earnings, current balance, pending amount.
2. Append **one** record for today's `Europe/Berlin` `day_key` to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json`
   under `records` — integer **cents** (`1340 == $13.40`), `entered_at_utc` = the moment of reading. (The file/template is
   created automatically on first `run_daily_check`; `operator_state.ensure_template()` [B, `operator_state.py:91-97`].)
3. Run the routine once for the day: `run_daily_check.py --source operator_state`. A first record → `INITIAL_BASELINE`;
   from the next day a change → notification + approval item (R4).

> Caveat: **today's production day-lock is already spent.** `state/day-locks/2026-10-01.lock` exists and
> `state/last-run.json` shows `last_attempt_day=last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED` [A, `raw/07-state-contents.txt`].
> R1/R2 forbid a second read today, so the day-1 action above applies to the **next** local day; today can only be audited.

---

## 4. RANK 2 — live `GET /api/projects/:projectId/freecash/auth` (credential-free, but session-state only)

- **Reachable today:** **YES.** `curl -m5 http://localhost:4600/api/projects/proj-free-cash/freecash/auth` → **HTTP 200**,
  no credential, no header, loopback. [A, `raw/11-freecash-auth-endpoint.txt`]
- **What it returns** (measured body):

```json
{"service":"freecash","label":"FreeCash","sessionState":"unauthenticated","satisfied":false,
 "blocker":"FreeCash session evidence is stale (last live check 2026-09-23T15:32:31.406Z).",
 "checkedAt":"2026-10-01T07:30:55.335Z",
 "evidence":{"sessionValid":false,"credentialAvailable":true,"externalConnected":true},
 "goal":{"id":"goal-mufxonpl-ud6lj6","status":"blocked_waiting_for_auth",...},"tasks":[]}
```

- **Why it is credential-safe [B]:** `freeCashAuthStatus()` returns only booleans/strings from
  `checkPrerequisites('freecash')`; the source comment states "Cookie values, credentials and tokens are NEVER read,
  stored or returned." [B, `server/src/routers/projects.ts:339-379`]. The route is GET (a POST alias exists but GET alone suffices).
- **Does it feed the monitor? NO.** `normalize_metrics` requires `account_status` + the three money fields; this payload
  has none of them → `MetricError["metrics payload is missing 'account_status'"]` would fire [B, `changedetect.py:111-138`].
  Its only monitor value is a coarse `account_status` proxy: `sessionState` `authenticated`/`unauthenticated`. So it can
  drive a **STATUS_CHANGED** event (session present↓/recovered↑) — never `EARNINGS_CHANGED`/`BALANCE_CHANGED`.
- **Allowlist gap:** the routine's `readonly_client` refuses this path today [A, `raw/19-transport-probe.txt`:
  `ForbiddenWriteError: R2: path not allowlisted: '/api/projects/proj-free-cash/freecash/auth'`]. To use it, an entry is required:

  ```python
  # readonly_client.py ALLOWED_PATHS — proposed (NOT applied by this stream)
  re.compile(r"^/api/projects/[^/]+/freecash/auth$"),  # GET-only, loopback, returns no secret values
  ```
  plus base `FREECASH_READ_BASE_URL=http://localhost:4600`. **Safety:** GET-only (method allowlist still blocks everything
  else), loopback host already allowed, path is a single read route that provably returns no secret values, request-body
  rejection untouched. **Do not apply this in Stream S** — the allowlist owner decides. It is also a **new read op (W3)**,
  so `readonly_client` and `run_daily_check` need real work, not just a path string.

**Day-1 first action:** escalate a *scoped allowlist request* (path regex above + base-url env) to whoever owns R2, with
the measured 200 body as justification, and record the decision. Until granted, the path stays blocked.

---

## 5. RANK 3 — offline `session-evidence.json` (auth-state mirror; local file)

- **Reachable:** yes, local file. Path resolves from `dataDir() = dirname(resolvedDbPath)` where the live DB is
  `%APPDATA%\AgenticOS\data\agentic-os.db`, so the evidence file is
  `C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\freecash\session-evidence.json` [A + B, `raw/15-dbpath.txt`, `raw/16-appdata-evidence.txt`].
  (`find` under the repo returns nothing — the file lives outside the repo, in `%APPDATA%`.)
- **What it holds** [A, `raw/16-evidence.txt`]:

```json
{"service":"freecash","authenticated":true,"verifiedAt":"2026-09-23T15:32:31.406Z",
 "evidencePath":"...\\evidence\\session-authenticated-mue9i5qd-3b0799d2.json",
 "detail":"final_url=https://freecash.com/en; cookie_count=8; session_cookie_present=true"}
```

- **Does it feed the monitor? NO** — it is auth/session state (a boolean + timestamp + a detail string), not the four figures.
  Sibling `evidence/inspect-work-*.json` artifacts carry `items: []` — **no balance/earnings figures** [A, `raw/18-evidence-contents.txt`].
- **Freshness:** `verifiedAt` 2026-09-23T15:32:31Z vs now 2026-10-01T07:34:49Z → **age 7.67 days**, i.e. **stale**
  (the service's own freshness window is 24 h) [A + B, `raw/23-legacy-runs-and-db.txt`, `prerequisiteService.ts:51,148-153`].
- **Credential warning [A]:** the *sibling* `browser_profiles/freecash-main/storage_state.json` contains cookie names
  `session_id, fc_access_token, fc_refresh_token, ...` — that file is **credential-bearing and must NEVER be read by the
  routine**. `session-evidence.json` itself is safe (no values).

**Day-1 first action:** post a scoping decision — is a **local-file source kind** acceptable to the routine at all?
(It opens no socket, so R2's host/path rules don't apply.) If yes, add a file-read source that emits a
`status_change`-only signal mapped from `authenticated`; if no, drop it. Either way, add an explicit "do not read
`storage_state.json`" note to the source contract.

---

## 6. DEAD / fixed-status (reported honestly, not dressed up)

### 6.1 `metrics_http` — DEAD today
Both allowlisted paths are unreachable on the Day-1 host: `/api/v1/status/metrics` → **404** on 4600, **conn-refused** on
3001 [A, `raw/01`, `raw/19`]. The legacy implementation that used the same endpoint recorded the identical failure on
2026-09-20 [A, `raw/24-runtime-logs-and-git.txt`]:
`fetch_error ... HTTPConnectionPool(host='localhost', port=3001): ... url: /api/v1/status/metrics ... 10061`.
**Conclusion:** the "local metrics substitute" (`readonly_client` W1/W2) has never had a live endpoint. Do not present it
as a fallback.

### 6.2 `GET /api/health` (4600) — reachable but not a status source
Live HTTP 200, but returns liveness/build JSON only (`status`, `pid`, `uptime`, `version`, `build.gitSha`), **not** the
four figures [A, `raw/01`]. It is also **not allowlisted** [A, `raw/19`]. At most it validates "the server is up"; it
cannot feed a change comparison. Leave it alone.

---

## 7. State roots — which code path writes which (paths.py is the arbiter)

| Root | On disk [A] | Written by | Evidence |
|---|---|---|---|
| `D:/AgenticOS/data/freecash-monitor` | **live**: `state/` (`last-run.json`, `operator-state.json`, `day-locks/`), `snapshots/` (2026-09-20/30, 2026-10-01), `alerts/alerts.jsonl`, `logs/` | **The wired routine.** `paths.DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`; overridable by `FREECASH_DATA_ROOT` [B, `paths.py:35,45-48`] | `raw/03`, `raw/07` |
| `D:/AgenticOS/data/freecash` | **empty directory** | Legacy `scripts/make_freecash_check.py` → but its `BASE.parents[2]` resolves to **`D:\data\freecash`**, not here [A, `raw/22`]; no code was found writing `D:\AgenticOS\data\freecash` [A, `raw/05`] | `raw/03`, `raw/22` |
| `D:/AgenticOS/server/data/freecash-monitor` | **docs only**: `README.md`, `INTEGRATION_STATUS.md` | **No code** — no writer found [A, `raw/05`] | `raw/03` |
| `%APPDATA%\AgenticOS\data\freecash` (outside repo) | `session-evidence.json`, `evidence/*.json`, `browser_profiles/freecash-main/storage_state.json` | The live server's FreeCash executor + prerequisites service (`dataDir() = dirname(resolvedDbPath)`) [B, `prerequisiteService.ts:53-59`, `freeCashExecutor.ts:44-59`] | `raw/15`, `raw/16` |

`paths.py` is the arbiter for the routine: everything the monitor writes goes to `data/freecash-monitor` (or the
throwaway `FREECASH_DATA_ROOT`). The other two `freecash*` roots are vestigial/foreign.

---

## 8. Legacy / parallel implementations — LABELLED, not fixed or deleted

All seven are **untracked in git** [A, `raw/22`]. "Runs?" answers are stated with their evidence class.

| Artefact | Exists | Does it run? | Evidence |
|---|---|---|---|
| `server/scripts/freecash-daily-monitor.mjs` | yes (326 lines) | **NO — cannot parse.** `node --check` → exit **1**, `SyntaxError: Unexpected token ':'` at **line 41** (a TS return type in a `.mjs`) [A, `raw/06`] | [A] |
| `server/scripts/verify-freecash-rules.mjs` | yes (80 lines) | **Runs and LIES.** Prints `[OK] All 4 operational rules verified (4/4 passed)`, exit **0**, while its `checkRule2/3/4` are text-`includes` greps over the **unparseable** monitor above [A, `raw/06`; B, `verify-freecash-rules.mjs:23-44`]. **Active false-compliance source.** | [A]+[B] |
| `server/src/adapters/freecashMonitorAdapter.ts` | yes (223 lines) | Imported by live controllers `operatorController.ts:4` and `turnController.ts:24` [A, `raw/22`]; `fetchStatus()` returns a **hardcoded sandbox stub** (`earnedToday:0, statusAlerts:[], externalConnected:false`), no I/O [B, `freecashMonitorAdapter.ts:198-209`] | [A]+[B] |
| `scripts/monitoring/free-cash-daily-check.py` | yes (294 lines) | **`main()` defined (line 225) and never called** — file ends at line 294 with no `if __name__ == '__main__'` guard [A+B]. Yet `logs/daily_monitor_runtime.log` (2026-09-20) exists, so *some* external launcher called it; the launcher was **not** identified here [A, `raw/24`] | [A]+[B] |
| `scripts/make_freecash_check.py` | yes (99 lines) | `BASE = parents[2]` → **`DATA_DIR = D:\data\freecash` (does NOT exist)** [A, `raw/22`]. `fetch_status()` returns hardcoded zeros (no source); carries a wired `withdraw`/`run_action` path (R1/R2 risk) [B, lines 14-15,19-21,49-52]. Referenced by `config/freecash-crontab` | [A]+[B] |
| `server/tasks/daily-finance-monitor.py` | yes (330 lines) | **Has run** — `server/tasks/daily_monitor.log` + `last_run_time.json` exist; log shows `Checked 0 account(s): []`, `Daily routine finished (checks=0)`, `Daily check skipped (run within last 24h)`. All three `*.sqlite` files are **0 bytes / 0 tables**, so `accounts`/`events_logs`/`status_checks` are absent [A, `raw/23`,`raw/24`]. Different domain (local sqlite, not FreeCash) | [A]+[B] |
| `finance-monitor/` package | yes | **Never scheduled** (no matching `schtasks` entry [A, `raw/21`]). Prototype: `api_client.py` returns **simulated** data; `wait_gate.py` fabricates consent via `random.choice([("APPROVE",True)~60%,...])` (lines 95-102) — an **R4 violation** [B]. `__init__` has a `__main__` guard that would call the orchestrator if invoked from inside the package [B, tail] | [A]+[B] |
| `config/freecash-crontab` | yes (11 lines) | **Can never fire** — the command is `/path/to/AgenticOS/scripts/make_freecash_check.py` (literal placeholder) [A+B, line 7] | [A]+[B] |

**Label:** all seven are legacy/parallel and **must not be wired**; none is fixed or deleted by this stream. Note the
compliance trap: the one artefact that *runs clean* (`verify-freecash-rules.mjs`) is the one that certifies a file that
cannot parse.

---

## 9. Inherited claims (class [C]) — NOT re-verified in this pass

Carried from prior plan documents; treat as leads, not measurements:
- "`freecashMonitorAdapter` is reachable from `jarvisV2/turnController.ts:414` and `jarvisNext/operator/operatorController.ts:115`" — I confirmed the **imports** at `:24`/`:4` [A], but the cited call sites `:414`/`:115` are [C].
- "`make_freecash_check.py` → `D:\data\freecash` (drive root); `save_today()` lacks `mkdir` → exit 1" — I confirmed the **path** [A]; the "exit 1" behaviour is [C].
- "`wait_gate.py` fabricates consent via `random.choice`" — confirmed [A/B, §8].
- Prior "V13: every legacy candidate `R1..R4 = FAIL`" and the "quarantine, never delete" recommendation — [C].
- The provider-side conclusion that no live read-only provider status/earnings API exists (and consumer-platform
  automation is ToS-prohibited) is **assumed** from `PROVIDER-API-RESEARCH.md` — [C] for this stream, and it is the reason
  the operator file exists at all.

---

## 10. Deliverables in this directory

- `SOURCE-DECISION.md` (this file)
- `EVIDENCE.md` — claim ledger with command + exit + capture pointer
- `probe_source_candidates.py` — exercises the real `readonly_client` (GET/HEAD, loopback)
- `probe_operator_source.py` — drives the wired routine end-to-end in a throwaway root
- `raw/01..25-*.txt` — the raw captures cited above

All runs used `FREECASH_DATA_ROOT=$LOCALAPPDATA/Temp/fc-r3-*/root`; **no** state root under `D:/AgenticOS` was written,
no credential/token/secret was used, no POST/PUT/PATCH/DELETE was issued, and no allowlist was widened.

# DESIGN TRACK 1 — READ PATH / DATASOURCE — FINDINGS

**Subject:** the canonical daily status monitor for Free Cash Finance Automation
(`D:\AgenticOS\monitoring\freecash\`, state root `D:\AgenticOS\data\freecash-monitor\`).
**Pass date:** 2026-10-01, 09:05–09:11 local (07:05–07:11 UTC).
**Method:** live commands only. Every row below is a command executed in this pass; the raw output
and exit code are in the named `evidence-*.txt` file in this folder.
**Interpreter used:** `python` = 3.11.9 (evidence-04b). Second interpreter on PATH: `C:/Python314/python.exe`.

---

## 0. Hermeticity proof (constraint 2)

| # | Command | Raw result | Exit | Evidence |
|---|---------|-----------|------|----------|
| 0.1 | `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` (BEFORE, 09:05:35) | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` · `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` | 0 | evidence-05 |
| 0.2 | same command (AFTER, 09:07:39) | **identical pair, byte for byte** | 0 | evidence-15 |
| 0.3 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00" \| sort` (BEFORE) | alerts.jsonl, snapshots/2026-10-01.json, state/day-locks/2026-10-01.lock, state/last-run.json | 0 | evidence-05 |
| 0.4 | same command (AFTER) | **same 4 paths, unchanged** | 0 | evidence-15 |
| 0.5 | `git status --porcelain data/freecash-monitor` | `?? data/freecash-monitor/` (untracked; no git write performed) | 0 | evidence-15 |

The production root is not referenced by `FREECASH_DATA_ROOT` in any run: every routine execution in
this pass ran with `FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/fc-r2-*`. No routine command
was executed against the production root (evidence-16 is `ls`/`cat` only).

---

## 1. The exact code that decides `data_available`, and the unresolved provider line

### 1.1 `data_available` — decided in `operator_state.read_source()`
`monitoring/freecash/operator_state.py:127-151` (evidence-01):

```python
    record = record_for_day(day, document)
    if record is None:
        return {
            "kind": KIND,
            "read_ops": list(READ_OPS),
            "data_available": False,                      # <-- the decision
            "note": ("no operator-entered record for %s in %s" % ...),
            "payload": None,
            "raw_body": b"",
        }
    payload = {key: record.get(key) for key in _RECORD_FIELDS if key in record}
    payload.pop("day_key", None)
    payload.pop("entered_at_utc", None)
    raw = json.dumps(record, sort_keys=True).encode("utf-8")
    return {
        ...
        "data_available": True,
        "note": "operator-entered record for %s" % day,
        "payload": payload,
        "raw_body": raw,
    }
```

`operator_state.py:104-116` `record_for_day()` matches **only** `entry.get("day_key") == day`
(exact string equal to today's operator-local day). Confirmed live: a file holding only a
`2026-09-30` record still produced `data_available=False` for `2026-10-01` (evidence-14).

Carried into the run at `run_daily_check.py:395-419` (evidence-04):

```python
    source = {
        "kind": raw.get("kind"),
        "read_ops": raw.get("read_ops"),
        "data_available": bool(raw.get("data_available")),   # line 398
        "note": raw.get("note"),
    }
    metrics = raw.get("payload") if source["data_available"] else {}   # line 401
    ...
    if not source["data_available"]:                            # line 410
        outcome = "MONITOR_DEGRADED"
```

The `metrics_http` source is unconditionally `data_available: True` (`run_daily_check.py:66-76`) —
it never degrades on missing fields; it fails hard instead (see §3, option B).

### 1.2 The provider endpoint is unresolved — one literal, three sites
`monitoring/freecash/readonly_client.py:59-60` (evidence-03):

```python
#: Not a URL, and deliberately never one: the provider read contract is unknown.
PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
```

`readonly_client.py:39-49` — the transport allowlist contains **no provider host and no provider path**:

```python
ALLOWED_METHODS = frozenset({"GET", "HEAD"})
ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
ALLOWED_PATHS = (
    re.compile(r"^/api/v1/status/metrics$"),
    re.compile(r"^/api/v1/status$"),
    # Provider paths are added here ONLY after research resolves them ...
)
```
`DEFAULT_BASE_URL = "http://localhost:3001"` (`readonly_client.py:54`). The same literal is copied
into the R4 approval payload as `proposed_action.provider_endpoint`
(`approval_queue.py:116`; observed live in evidence-13). Grep count for the marker (evidence-22):
`grep -rn "PROVIDER_ENDPOINT_UNKNOWN" monitoring/freecash/ | wc -l` → **12** = 6 lines in 3 tracked
`.py` files (`readonly_client.py` 3, `approval_queue.py` 1, `tests/test_r2_readonly.py` 2) plus 6 in
`__pycache__` binaries; `grep -rc` confirms the other seven modules contain 0. **No code path anywhere
resolves it.**

### 1.3 Minimal schema a reading must have

Source of truth: `operator_state.TEMPLATE_RECORD` / `_RECORD_FIELDS` (operator_state.py:48-66) and
`changedetect.COMPARED_FIELDS` + `normalize_metrics` (changedetect.py:34-138).

`<data root>/state/operator-state.json` →
`{"schema_version":1,"kind":"operator_entered_daily_status","records":[ <record> ],"template_record":{...}}`

| field | type | unit | required for R3? | note |
|---|---|---|---|---|
| `day_key` | `"YYYY-MM-DD"` | — | **yes** | must equal today's operator-local day exactly; a stale day is ignored (evidence-14) |
| `entered_at_utc` | `"YYYY-MM-DDTHH:MM:SSZ"` | — | no | stripped from the payload before comparison |
| `account_status` | string | — | **yes** | compared by **exact string**, see below |
| `earnings_total_cents` | int | **integer cents** (`1340` == 13.40) | **yes** | a float here is multiplied by 100 by `_as_cents` → `13.40` becomes `1340` (evidence-18) |
| `balance_cents` | int | integer cents | **yes** | |
| `pending_cents` | int | integer cents | **yes** | maps to `EARNINGS_CHANGED` subtype `pending` |
| `currency` | string | — | recommended | currency mismatch makes `compare()` skip all money comparison and emit MONITOR_DEGRADED |

Units — **cents, not euro/dollar**. `changedetect._as_cents` (evidence-18, live):
`int` → passed through as cents; `float 13.40` → `1340`; string `"13.40"` → `1340`; `bool` → `MetricError`.
The `metrics_http` path additionally accepts whole-currency aliases `earnings`/`balance`/`pending`
(×100) — the `operator_state` path does **no** conversion at all (`run_daily_check.read_source` returns
`operator_state.read_source()` verbatim; only `metrics_http` calls `normalize_metrics`). So a euro value
typed into `*_cents` is stored as-is and compared as cents.

Account-status vocabulary — the **published provider enum is `Operativa` / `Bloqueada` / `Cerrada`**
(HG.Cash OpenAPI, §3C). The routine's own template uses `"ACTIVE"` (operator_state.py:51). Both are
free-form strings to this code; `normalize_metrics` upper-cases (`.strip().upper()`) but the
`operator_state` path does not, and `compare()` is an exact `!=` (changedetect.py:264).
Live proof that this bites (evidence-18): `prior=Operativa` vs `current=OPERATIVA` produced a
**spurious `STATUS_CHANGED`** — the vocabulary therefore has to be pinned and used identically every
day, not merely "accepted".

---

## 2. Live runs of the routine (all in scratch roots)

| # | Command | Raw output | Exit | Evidence |
|---|---------|-----------|------|----------|
| 2.1 | `FREECASH_DATA_ROOT=…/fc-r2-empty python run_daily_check.py --source operator_state` (fresh root, no reading) | `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock` | 0 | evidence-06 |
| 2.2 | `cat …/snapshots/2026-10-01.json` (2.1) | `"data_available": false`, all four figures `null`, `"degraded": true`, `raw_response_sha256: e3b0c442…b855` (sha256 of empty bytes) | 0 | evidence-06 |
| 2.3 | inject one synthetic reading (format from §1.3) + `FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state` in **fresh** root `fc-r2-reading` | `RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock` | 0 | evidence-07 |
| 2.4 | `cat …/snapshots/2026-10-01.json` (2.3) | `"data_available": true`, `account_status: "Operativa"`, `earnings_total_cents: 1340`, `balance_cents: 1340`, `pending_cents: 0`, `currency: "USD"` — **a snapshot with `data_available=true` is produced** | 0 | evidence-07 |
| 2.5 | second run, **same** root, same day | `SKIP_DUPLICATE_DAY 2026-10-01` | 0 | evidence-08 |
| 2.6 | `cat …/alerts/alerts.jsonl` after 2.5 | exactly two lines: the `INITIAL_BASELINE` line and one appended `SKIP_DUPLICATE_DAY` line ("Duplicate run performed no read and wrote no snapshot.") | 0 | evidence-08 |
| 2.7 | only a stale `2026-09-30` record present, then run | `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED … data_available=False` — a stale record is **not** carried forward | 0 | evidence-14 |
| 2.8 | seeded ledger `timezone: Europe/Berlin`, `FREECASH_TZ=UTC` run | `MONITOR_DEGRADED` alert "Timezone changed since the last run (ledger=Europe/Berlin, now=UTC)" **plus** the no-data `MONITOR_DEGRADED` line | 0 | evidence-21 |

Reading-injection note: the reading was written in exactly the format `operator_state.read_source()`
reads — the `records[]` document of §1.3, day_key `2026-10-01`. No new file format was invented.

**Clock seam:** `run_daily_check.run(argv, now=…)` is the routine's own documented test seam
(`run_daily_check.py:266-273`). It was used for the "tomorrow" simulations below and is labelled as
simulated wherever it appears.

| # | Command | Raw output | Exit | Evidence |
|---|---------|-----------|------|----------|
| 2.9 | T1: copy the **real** production `snapshots/2026-10-01.json` (data_available=false) into a scratch root + one `2026-10-02` reading; run with pinned clock `2026-10-02T08:00Z` | `RUN_OK 2026-10-02 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) … changes=0 notifications=0` | 0 | evidence-12 |
| 2.10 | T2: identical, except the prior `2026-10-01.json` carries `data_available=true` (earnings 1000) | `RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) … changes=1 notifications=1 approvals=1` + alert line `[FreeCash] EARNINGS CHANGE 2026-10-02 / Earnings: $10.00 -> $13.40 (+$3.40) … / Approval: 49ec499c-… (PENDING - yours to decide, nothing executes)` | 0 | evidence-13 |

2.9/2.10 are the decisive pair: **R3's mechanics are intact** (`compare()` needs data on *both*
sides — `changedetect.py:235`), and a reading alone is not enough because today's only prior snapshots
carry `data_available: false`.

---

## 3. Alternative read paths — reachable today?

### (A) Operator-entered local reading — **REACHABLE TODAY** (proved, 2.3/2.4)
No network, no credential, `read_ops: []`. A single appended record flips the snapshot to
`data_available=true`. First day on which R3 can then fire is bounded by §5.

### (B) `metrics_http` against the AgenticOS listener / existing HTTP routes — **REACHABLE AS A ROUTE, USELESS AS A BALANCE SOURCE**

| # | Command | Raw output | Exit | Evidence |
|---|---------|-----------|------|----------|
| B1 | `FREECASH_TOAST_STUB=1 python run_daily_check.py --source metrics_http --base-url http://localhost:4600` (scratch root) | `RUN_FAILED 2026-10-01 reason=ReadError: GET /api/v1/status/metrics returned HTTP 404` | **5** | evidence-09 |
| B2 | `cat …/snapshots` after B1 | directory empty — no snapshot is written on a failed read | 0 | evidence-09 |
| B3 | default (no `--base-url`) → `readonly_client.DEFAULT_BASE_URL` | `RUN_FAILED … ReadError: GET /api/v1/status/metrics failed: [WinError 10061] … Verbindung verweigerte` | **5** | evidence-09b |
| B4 | `curl -s http://localhost:4600/api/health` | `{"status":"healthy","pid":32500,…,"version":"9.0.0",…}` | 0 | evidence-11 |
| B5 | `curl` on `4600` for `/api/v1/status/metrics`, `/api/v1/status`, `/api/freecash/status`, `/api/freecash/monitor` | `404 · 404 · 404 · 404` | 0 | evidence-11 |
| B6 | `curl http://localhost:3001/api/v1/status` | `000` | **7** (connection refused) | evidence-11 |
| B7 | `grep -rniE "(balance\|earnings\|payout\|account_?status)" server/src/index.ts` | **no output** (0 hits) | 0 | evidence-11 |
| B8 | `grep -rniE "(router\|app)\.get\(.*(balance\|earnings)" server/src --include=*.ts` (excl. tests) | **no output** (0 hits) | 1 | evidence-11 |
| B9 | `grep -rnE "(router\|app)\.(get\|post)\(" server/src/index.ts server/src/routers/*.ts \| wc -l` | `399` registered handlers — and none of them is a balance/earnings read | 0 | evidence-17 |
| B10 | `grep -rniE "(router\|app)\.(get\|post)\(.*(freecash\|balance\|earnings\|account.?status)" …` | only the freecash **auth** family: `router.get('/:projectId/freecash/auth', …)`, `POST …/auth`, `POST …/auth/login`, `POST …/auth/verify`, `POST …/auth/clear` | 0 | evidence-17 |
| B11 | `curl "http://localhost:4600/api/projects/does-not-exist/freecash/auth"` | `HTTP 200` → `{"service":"freecash","sessionState":"unauthenticated","satisfied":false,"blocker":"FreeCash session evidence is stale (last live check 2026-09-23T15:32:31.406Z)",…,"evidence":{"sessionValid":false,"credentialAvailable":true,"externalConnected":true},…}` | 0 | evidence-22 |
| B12 | `sed -n '385,397p' server/src/routers/projects.ts` | the route registrations that back B11 (`router.get('/:projectId/freecash/auth', …)` etc.) — all five are auth/session handlers, none reads a balance | 0 | evidence-22 |
| B13 | `server/src/adapters/freecashMonitorAdapter.ts:198-209` | `fetchStatus()` is **hard-coded**: `pendingEarnings: undefined, earnedToday: 0, statusAlerts: [], requiresApproval: [], adapterHealth:'healthy', externalConnected:false, externalStatusMessage:'… External FreeCash API connection is not configured.'` — no balance, no earnings, no socket | — | evidence-17 (read) |

Verdict: the transport is allowlisted for loopback (`ALLOWED_HOSTS`), so `metrics_http` is *mechanically*
reachable, but **the two allowlisted paths do not exist on any live listener** (B5), and **no AgenticOS
route exposes balance, earnings or account status** (B7–B10). The only live FreeCash route (B11) is an
auth/session readiness probe. `metrics_http` against `:4600` today returns exit 5 `RUN_FAILED`, and
under R1 that failure consumes the day's lock (`Day lock: CONSUMED (no automatic re-run today - R1)`,
evidence-09).

R2 remains enforced regardless of base URL (evidence-10):

| # | Command | Raw output | Exit |
|---|---------|-----------|------|
| R2.1 | `readonly_client.request("GET","https://hg.cash/api/v1/accounts")` | `ForbiddenWriteError: R2: host not allowlisted: 'hg.cash'` | 0 |
| R2.2 | `readonly_client.request("GET","http://localhost:4600/api/v1/accounts")` | `ForbiddenWriteError: R2: path not allowlisted: '/api/v1/accounts'` | 0 |
| R2.3 | `readonly_client.request("POST","http://localhost:4600/api/v1/status/metrics")` | `ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)` | 0 |

### (C) A real provider read API — web research (no authenticated call made)

**Who "Free Cash" actually is here: `freecash.com`.** The in-repo executor navigates
`FREECASH_HOME = 'https://freecash.com/en'` / `FREECASH_SIGNIN = 'https://freecash.com/en/signin'`
(`server/src/services/freeCash/freeCashExecutor.ts:39-40`, evidence-17 read). HG.Cash is the
payout/settlement rail discussed in the repo's research artefacts, not the earning platform.

| # | Claim | Evidence (fetched this pass) |
|---|-------|------------------------------|
| C1 | **freecash.com publishes no read API** for balance/earnings. The only automation guidance is prohibitive. | `https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned` — "*Do not use any automatic device like a robot or spider to access the site.*" and "*Freecash is for personal and non-commercial purposes only.*" (verbatim in evidence-23 §W2) |
| C2 | Its ToS bans scripted/bot access outright. | `https://freecash.com/en/policies/terms` §17 "Restrictions and Prohibited Uses": "*To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity, including … automating clicks, movements, or tasks … Such behavior is strictly prohibited*". Operator is **Almedia GmbH**. (evidence-23 §W1) |
| C3 | ⇒ **Option C for freecash.com is NOT REACHABLE and NOT PERMITTED.** No documented endpoint, no key, and the ToS forbids the automated read that a scrape would be. | C1 + C2 |
| C4 | **HG.Cash** does publish a documented read-only contract: `GET https://hg.cash/api/v1/accounts` and `GET https://hg.cash/api/v1/account/{id}/balance`; `Authorization: Bearer cash_<64-char-hex>`; response `data[] { id, name, balance (ledger, 2 dp), pendingFees, netBalance, status, currency, … }` with `status` enum **`Operativa` / `Bloqueada` / `Cerrada`**. | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` (200, verbatim in evidence-23 §W3) |
| C5 | HG.Cash's flow is explicitly backend/automation-oriented ("Generate your API token in the account settings page", "Implement in your backend services (never expose tokens in frontend)"), i.e. automated server-side GETs are the intended use — unlike freecash.com. | same page (Authentication / Getting Started sections), evidence-23 §W3 |
| C6 | **BUT** the same single Bearer token also authorises `POST /transactions` (**cash out**) — there is no read-only scope; and access requires onboarding + KYC. | `https://docs.hg.cash/api-reference/transactions/create-transaction-request-cash-out`; `https://docs.hg.cash/introduction` ("Platform access requires a registered user record … after HG.cash has engaged with you and completed required compliance checks, typically including KYC"), evidence-23 §W3 |
| C7 | **Cashfree Payouts** (`GET /payout/v1/getBalance`) is a documented read-only balance endpoint, but it is a different vendor/product (Cashfree Payments, payouts rail) — it is **not** the monitored account. | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`, evidence-23 §W4 |

| # | Command | Raw output | Exit | Evidence |
|---|---------|-----------|------|----------|
| C8 | `env \| grep -i "^FREECASH"` | `FREECASH_DATA_ROOT`, `FREECASH_TOAST_RETRY_SLEEP_SECONDS=0`, `FREECASH_REPO_ROOT`, `FREECASH_TZ=UTC`, `FREECASH_READ_SOURCE=operator_state`, `FREECASH_TOAST_STUB=1` — **no provider credential/key of any kind** | 0 | evidence-19 |
| C9 | `grep -rniE "freecash\|free-cash" .env server/.env \| sed -E "s/=.*/=[REDACTED]/"` | no output (no `.env` FreeCash key) | 0 | evidence-20 |
| C10 | `find . -name storage_state.json` | no output — no managed-browser sign-in state on disk | 0 | evidence-20 |
| C11 | `curl http://127.0.0.1:9223/json/version` | `000` | 7 — the CDP browser the scrape scripts need is **not running** | evidence-20 |
| C12 | `curl http://localhost:4600/api/projects/…/freecash/auth` | `sessionValid:false`, blocker "FreeCash session evidence is stale (last live check 2026-09-23T15:32:31.406Z)" | 0 | evidence-11 |

**Second-implementation warning (constraint 5).** A legacy FreeCash monitor already exists and must be
documented, not forked: `server/scripts/freecash-daily-monitor.mjs` (10,474 B, 2026-09-11) points at an
invented endpoint — `STATUS_API_URL: process.env.FREECASH_STATUS_API || 'https://api.freecash.com/v1/status'`
(evidence-20, line 32) — and `server/scripts/inspect_freecash_*.ts` scrape the dashboard by
`chromium.connectOverCDP('http://127.0.0.1:9223')` (evidence-20). Neither was executed in this pass.
`server/src/index.ts:435` reads: "*FreeCash is no longer our objective. Do not resume its tasks on startup*".

---

## 4. Viable options — four fields each

### Option A — operator-entered local reading (the only fully reachable path today)
- **Expected Effort:** ~5 minutes per day of operator time; **0 new code** (the reader exists and works, evidence-07).
- **Time-to-Revenue:** none directly — it is a monitoring signal, not a cash path. Earliest R3 notification: **2026-10-03** using routine-legitimate writes only (§5).
- **Dependencies:** the operator's own logged-in dashboard reading (4 figures + status) entered daily; nothing else — no credential, no socket, no approval.
- **First Concrete Action:** one append to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json` — add a record to `records[]` with `"day_key": "<today>"`, `"entered_at_utc"`, `"account_status"` (`Operativa`/`Bloqueada`, pinned casing), `"earnings_total_cents"`, `"balance_cents"`, `"pending_cents"` (integer cents), `"currency"`.

### Option B — `metrics_http` / existing AgenticOS HTTP route as the balance source
- **Reachable today?** The *transport* yes; **as a balance/earnings source, NO** (B5–B10; the only live FreeCash route B11 exposes auth state only). Currently it produces `RUN_FAILED` exit 5 and burns the day's lock.
- **Expected Effort:** to make it carry *real* figures: **BLOCKED** — it would still need a provider read (Option C) as its source of truth, plus a new AgenticOS route (~1 day of work for a route that can only restate an unresolved read).
- **Time-to-Revenue:** not applicable; no revenue path.
- **Dependencies:** an allowlisted-and-existing route returning the four fields; today neither exists.
- **First Concrete Action:** none worth taking — the only defensible use is to add `/api/v1/status/metrics` (or point `--base-url` at a route that returns the four fields) **after** Option C supplies real data. Today's equivalent action is a negative result: `python run_daily_check.py --source metrics_http --base-url http://localhost:4600` → `RUN_FAILED` exit 5.

### Option C1 — HG.Cash documented read API (the only *provider* read that is documented and automation-permitted)
- **Reachable today?** **NOT REACHABLE TODAY** — documented contract yes (C4/C5), but no `cash_<64-hex>` token on this host (C8/C9), applicability to the monitored account unverified, and HG.Cash access is behind onboarding + KYC (C6). Also not read-only-scoped: the same token can `POST /transactions` (cash out).
- **Expected Effort:** 0.5–1 day once a token exists (one allowlist line in `readonly_client.ALLOWED_PATHS` + a new reader + a status-enum map `Operativa/Bloqueada/Cerrada` → the compared vocabulary). Blocked on the credential + provider decision, not on code.
- **Time-to-Revenue:** fastest *provider-verified* signal; gated entirely on obtaining the token (KYC/onboarding). Also half-answers R3 only: HG.Cash publishes **no lifetime-earnings field** (`balance`/`pendingFees`/`netBalance` only), so "earnings changed" would have to be mapped to net-balance movement and labelled as such.
- **Dependencies:** HG.Cash account + KYC + API token (stored per the repo's no-secrets rule), plus the decision that HG.Cash is in fact the monitored account's rail.
- **First Concrete Action:** with no credential on this host, the first action is *not* a call — it is the credential/decision step. The first action once a token exists is one allowlist line with a justification comment in `monitoring/freecash/readonly_client.py:ALLOWED_PATHS` (`re.compile(r"^/api/v1/accounts$")`), followed by an unauthenticated-shaped probe. **Do not probe with a real token until the provider decision is made.**

### Option C2 — provider read via freecash.com (browser scrape / invented API)
- **Reachable today?** **NO, and it must not be built**: no documented endpoint, and the ToS forbids automated access (C1–C3). The legacy `https://api.freecash.com/v1/status` in `server/scripts/freecash-daily-monitor.mjs` is invented and returns nothing.

---

## 5. Can R3 fire today? — and the smallest change

**One line:** **R3 cannot fire today** — production's 2026-10-01 lock is already spent (a run would emit `SKIP_DUPLICATE_DAY` and perform no read, evidence-08/evidence-16), `operator-state.json` holds `records: []` so today's snapshot is `data_available=false` (evidence-16), and with no data-bearing prior snapshot `compare()` returns `baseline` (evidence-12) — and the *final* current production snapshot for 2026-10-01 is already written immutable (`save_snapshot` never rewrites, `changedetect.py:183-189`).

**Smallest change that would make it fire tomorrow (2026-10-02):** two file writes —
(1) append one record with `day_key: "2026-10-02"` and the operator's real figures to
`data/freecash-monitor/state/operator-state.json`; **and** (2) because R1 has already consumed today's
lock and `--force-recheck` is refused by design, the *baseline* snapshot `snapshots/2026-10-01.json`
must itself carry `source.data_available: true` with today's real figures — that baseline can no longer
be produced by a routine run today, so it has to be seeded by hand.
With (1)+(2), a 2026-10-02 run reproduces exactly evidence-13: `outcome=EARNINGS_CHANGED changes=1 notifications=1 approvals=1`.

**Smallest change using routine-legitimate writes only (no state seeding):** append the 2026-10-02
record to `operator-state.json` today. Tomorrow's run then writes a genuine data-bearing snapshot as
`INITIAL_BASELINE` (evidence-12 behaviour, with real figures instead of nulls), and **R3 first fires on
2026-10-03**. This is the honest zero-forgery option and is 1 day later.

---

## 6. BLOCKED / unresolved

- **BLOCKED — provider identity + credential.** No HG.Cash token, no `FREECASH_*` credential key, no
  browser `storage_state.json`, CDP 9223 down (C8–C11). Whether HG.Cash is the monitored account's rail
  is not decided in this pass. Cannot be resolved without the operator's account access; deliberately
  no authenticated call was made.
- **BLOCKED — freecash.com automated reads.** Prohibited by the platform's own ToS (C1/C2); no
  documented API exists. This is a business/compliance decision, not an engineering gap.
- **Open** — the routine's template status value `"ACTIVE"` (operator_state.py:51) does not match the
  published provider vocabulary `Operativa/Bloqueada/Cerrada`, and casing differences alone raise a
  false `STATUS_CHANGED` (evidence-18). The template should be corrected to the pinned vocabulary.
- **Open** — `FREECASH_TZ=UTC` is set in the ambient environment while production's ledger records
  `Europe/Berlin`, which by itself raises a `MONITOR_DEGRADED` "timezone changed" alert on the next run
  (evidence-21). Day-key semantics shift with it.
- **Open** — the FX/currency question: the template defaults to `USD` while HG.Cash accounts are
  `ARS`/`BRL`; a currency change makes `compare()` skip the money comparison entirely
  (`changedetect.py:242-247`).

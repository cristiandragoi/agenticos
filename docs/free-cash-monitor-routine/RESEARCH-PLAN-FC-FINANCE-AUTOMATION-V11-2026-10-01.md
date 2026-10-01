# RESEARCH PLAN — Free Cash Finance Automation, daily status-monitoring routine (V11)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a` · **Host:** Windows 11 (de-DE), git-bash (MSYS), non-elevated
**Written:** 2026-10-01, 09:25–09:4x operator-local (`date` → `Do,  1. Okt 2026 09:25:33`; Europe/Berlin, UTC+02:00)
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → `Python 3.11.9`; `zoneinfo.ZoneInfo("Europe/Berlin")` resolves on it (verified this pass). `python3` does not exist on this host.
**Subject:** the research unknowns that block a *compliant* daily status-monitoring routine for Free Cash Finance Automation, canonical package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`.
**Relationship to prior art:** this file is **new and additive**. It does not supersede V10; it is the *research* companion to it. Where V10 answers "what is the live state and what decisions are owed", this file answers "what is unknown, how exactly is each unknown closed, what contract must the routine consume, and how does the first real reading arrive".
**Footprint:** one new file. No existing file edited, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean` — no git write command of any kind. No scheduled task created or modified. No provider network call. No credential, token or secret recorded. Every external claim carries a URL and a quote.
**Evidence standard:** every row in §1 is a command executed *in this pass*. Inherited facts are labelled `inherited` with the file:line that carries them. Verbatim quotes are marked as quotes.

---

## 0. The four operational rules (operator numbering — the shipped code inverts this)

These are the **operator's** rule numbers, as given for this task. **The shipped package's own docstrings use inverted labels** (`readonly_client.py:1` says "R2" for the read-only transport; `gate.py:1` says "R1" for one-read-per-day). Every citation in this document uses the operator numbering, and the mapping is stated once here so no citation is ambiguous.

| # | TITLE | Meaning (binding) | Shipped code's *inverted* label | Canonical implementation |
|---|---|---|---|---|
| **R1** | **ZERO AUTOMATED EARNING / WITHDRAWAL ACTIONS — READ-ONLY TRANSPORT ONLY** | No earning, claim, withdrawal, payout or any write-verb action may ever be taken by the routine. Transport is `GET`/`HEAD` only. | code calls this "R2" | `readonly_client.py:39` (`ALLOWED_METHODS = {"GET","HEAD"}`), `:110-140` (deny-by-default `request()`), `:146-163` (process audit hook); `approval_queue.py:43-52` (no execution state but `NOT_EXECUTED`) |
| **R2** | **EXACTLY ONE STATUS READ PER Europe/Berlin CALENDAR DAY** | One status read, one snapshot, per operator-local calendar day. No back-fill, no forced re-check. | code calls this "R1" | `gate.py:119-135` (`os.open(..., O_CREAT\|O_EXCL\|O_WRONLY)` day lock), `run_daily_check.py:307-321` (`SKIP_DUPLICATE_DAY`), `:281-297` (`--force-recheck` refused) |
| **R3** | **NOTIFY EXACTLY ONCE ON EARNINGS OR ACCOUNT-STATUS CHANGE** | One change → exactly one notification, via a dedupe key written before dispatch. No change → log only. | code calls this "R3" (label unchanged) | `changedetect.py:34-39`, `:226-276`; `notify.py:220-302`; `run_daily_check.py:173-214` |
| **R4** | **HUMAN APPROVAL BEFORE ANY EXTERNAL ACTION; NO EXECUTION PATH MAY EXIST** | A change is enqueued as a PENDING handle for a human. No code path reads an approval and acts. | code calls this "R4" (label unchanged) | `approval_queue.py:1-3`, `:109-134` (`expires_at_utc` always `null`, `execution_state` always `NOT_EXECUTED`), `:161-201` (human-only `decide`) |

---

## 1. Live state, verified in this pass (2026-10-01, 09:2x local)

| # | Command (executed this pass) | Observed result | Reading |
|---|---|---|---|
| B1 | `git rev-parse --abbrev-ref HEAD` · `git rev-parse --short HEAD` | `hermes-rescue-20260908` · `8f7463a` | workspace line confirmed |
| B2 | `date` | `Do,  1. Okt 2026 09:25:33` | Europe/Berlin = UTC+02:00 |
| B3 | `.../venv/Scripts/python -V` · `command -v python` · `python -V` | `Python 3.11.9` · `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` · `Python 3.11.9` | interpreter of record; **bare `python` currently *is* the venv one** on this shell session |
| B4 | `.../venv/Scripts/python -c "import zoneinfo;print(zoneinfo.ZoneInfo('Europe/Berlin'))"` | `Europe/Berlin` | the configured zone resolves → no `MONITOR_DEGRADED` timezone fallback on this interpreter |
| B5 | `cat data/freecash-monitor/state/operator-state.json` → `.records` | `[]` — **zero records** | **no operator figure has EVER been entered** |
| B6 | `cat data/freecash-monitor/snapshots/{2026-09-20,2026-09-30,2026-10-01}.json` | all three: `source.kind="operator_entered"`, `"data_available": false`, `degraded: true`, `account_status/earnings_total_cents/balance_cents/pending_cents/currency = null`; 2026-10-01 note `"no operator-entered record for 2026-10-01 in operator-state.json"`; `raw_response_sha256 = e3b0c442…7855` (SHA-256 of the empty string) | **every snapshot ever written is null**; nothing has ever been compared |
| B7 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `last_attempt_at_utc=2026-10-01T06:53:46Z` | **a null read is booked as a success day** (see U4) |
| B8 | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock`** (mtime 2026-10-01 08:53) | today's key is **spent**; no reading for 2026-10-01 is obtainable without a deliberate operator decision |
| B9 | `wc -l data/freecash-monitor/alerts/alerts.jsonl` | `15` | canonical evidence record: 15 lines, last = `MONITOR_DEGRADED` for 2026-10-01 at `06:53:46Z` |
| B10 | `ls -la data/freecash-monitor/approvals/` | empty (no `pending.json`, no `decided.jsonl`) | **R4 has never enqueued anything** — consistent with zero changes ever detected |
| B11 | `sha256sum` of `state/last-run.json`, `state/operator-state.json`, `alerts/alerts.jsonl` | `a287a902…3bf9` · `be8becc3…a59c` · `1b9c7c07…99a8` | identical to the values pinned by V10 §0 A2/A14 → the production root has been **byte-stable since 08:53:46** |
| B12 | `ls -d data/freecash data/freecash-monitor server/data/freecash-monitor` | **all three exist** | state-root ambiguity (U9); `data/freecash` is empty, `server/data/freecash-monitor/` holds only `README.md` + `INTEGRATION_STATUS.md` |
| B13 | `cat config/freecash-crontab` | command line targets `/path/to/AgenticOS/scripts/make_freecash_check.py` | the configured cron entry points at a **placeholder path** and a script the prior audit records as a hardcoded stub (`AUDIT-RULE-COMPLIANCE.md:225`) |
| B14 | `schtasks //Query //FO CSV //NH \| grep -ic freecash` | `0` | no Free Cash task is registered |
| B15 | `grep -rn --include='*.py' -E 'freecash\.com\|hg\.cash\|cashfree' monitoring/freecash/` | **one** hit: `tests/test_r2_readonly.py:119: self.assertNotIn("freecash.com", text)` | the package **hardcodes no provider host**; a regression test actively forbids the string `freecash.com` in module files |
| B16 | `git status --porcelain \| wc -l` | `868` | pre-existing dirty tree; `monitoring/` and `data/freecash-monitor/` remain untracked |

**One-line status:** the routine runs, writes a null snapshot, books it as a success, and has never had a single figure to compare — so R3 has never had an input and R4 has never had an item.

---

## 2. What the routine expects TODAY — the read path and the fields it consumes

### 2.1 The read path (two sources; one is the default)

`run_daily_check.py:52-53` defines the two sources: `DEFAULT_SOURCE = "operator_state"`, `SOURCES = ("operator_state", "metrics_http")`.

**Source A — `operator_state` (the default).** `run_daily_check.py:77` → `operator_state.read_source(day)`.
- It opens **no socket** and holds **no credential** (`operator_state.py:12-15`).
- It reads `<data root>/state/operator-state.json` and selects **only** the record whose `day_key` equals today's local day; a stale record is never carried forward (`operator_state.py:35-37`, `:104-116`).
- The record schema is `operator_state.py:48-56` / `:58-66`:
  `day_key`, `entered_at_utc`, `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`.
- If there is no record for today, it returns `data_available: False` with the note `"no operator-entered record for <day> in operator-state.json"` (`operator_state.py:128-139`). **This is exactly what is happening today (B5/B6).**

**Source B — `metrics_http` (opt-in, non-default).** `run_daily_check.py:66-76` → `readonly_client.read_status_source(...)`.
- It performs the routine's **only** network I/O: `GET /api/v1/status/metrics` (W1) then `HEAD /api/v1/status` (W2) against `http://localhost:3001` — **loopback only** (`readonly_client.py:16-21`, `:54-56`, `:194-239`).
- The allowlists are the whole read surface: methods `{"GET","HEAD"}` (`:39`), hosts `{"localhost","127.0.0.1","::1","[::1]"}` (`:41`), paths exactly `^/api/v1/status/metrics$` and `^/api/v1/status$` (`:43-49`). Anything else raises `ForbiddenWriteError` before `_transport` is reached (`:110-140`).
- **W3 and W4 — "provider balance/earnings status" and "provider account status" — are documented in the module's own read-op table (`:20-21`) and are deliberately NOT allowlisted.** The gap is kept greppable as the literal at `:60`: `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`.

### 2.2 The field contract the routine already enforces (this is the contract to fill)

`changedetect.py:34-39` fixes **four compared fields, integer cents, exact equality**:

| field | type | change type on inequality |
|---|---|---|
| `account_status` | str (upper-cased) | `STATUS_CHANGED` |
| `earnings_total_cents` | int | `EARNINGS_CHANGED` |
| `balance_cents` | int | `BALANCE_CHANGED` |
| `pending_cents` | int | `EARNINGS_CHANGED` (subtype `pending`) |

plus `currency` (string, compared only to decide whether money comparison is safe: `changedetect.py:242-249`).

`normalize_metrics()` (`changedetect.py:111-138`) accepts these field **aliases**, checked in order:

- `account_status` ← `account_status` | `status` (`:63`)
- `earnings_total_cents` ← `earnings_total_cents` | `earnings_cents` | `total_earnings_cents`; whole-currency fallback `earnings_total` | `earnings` (`:49-53`, `:59`)
- `balance_cents` ← `balance_cents` | `available_cents` | `net_balance_cents`; whole-currency fallback `balance` | `available` (`:54`, `:60`)
- `pending_cents` ← `pending_cents` | `pending_total_cents`; whole-currency fallback `pending` (`:55`, `:61`)
- `currency` ← `currency` | `currency_code` (`:64`)
- Aliases are searched in the top-level object and then inside any of `metrics` / `data` / `snapshot` / `account` (`:65`, `:75-92`).

**A missing field is a read failure, not a zero** (`changedetect.py:16-18`, `:119-131` → `MetricError`). `run_daily_check.py:373-393` catches that and books `READ_FAILED` (exit 5).

### 2.3 Two live defects that sit between the code and a first reading

These are **verified by reading the shipped code in this pass**; they are the mechanical reason a reading is hard to acquire.

**U4 (defect D-1) — "ran" is booked as "read".** `gate.py:32-40` puts `MONITOR_DEGRADED` inside `SUCCESS_OUTCOMES`, and `gate.py:198-200` advances `last_success_day` for any outcome in that set. `watchdog.py:33` then computes `covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES`. Net effect, observed live in B7/B8/B9: **a day that read nothing is recorded as a success day, resets `consecutive_missed_days` to 0, and silences the missed-day watchdog for that day.** (`consecutive_missed_days` was 9 on 2026-09-30 and is 0 today — inherited from V10 §0 A5, consistent with B7.)

**U7 (defect D-2) — whole-currency integers are not multiplied by 100.** `changedetect.py:95-108` returns `int(value)` unchanged for an `int` input and only applies `*100` for `float`/`str`. The whole-currency branch at `:133-134` is `value = int(round(value)) if isinstance(value, int) else value` — a **no-op for ints**. So an integer amount such as `{"balance": 123}` (the shape HG.Cash's own docs example uses, §5.2) maps to **123 cents ($1.23)**, not 12300 cents ($123.00). This defect is dormant today (every snapshot is null) and only becomes real the moment a provider or operator figure arrives as a JSON integer.

### 2.4 What the routine does *not* expect

- No provider host, path, token or header name appears anywhere in the package (B15).
- No module imports `requests`, `urllib`, or `socket`; the single socket site is `readonly_client._transport` (`:34`, `:76-107`).
- `watchdog.py:9` opens no socket at all (it does not import `readonly_client`).

---

## 3. `grep -rn` over `monitoring/freecash/` — the endpoints and verbs actually referenced (verbatim)

Every match below is pasted as the shell returned it.

### 3.1 Endpoint / path tokens

```
$ grep -rn --include='*.py' -E '/accounts|/getBalance|getBalance|/stats|/transactions|/cashout|/balance|/earnings|/status|/metrics|/payout|/withdraw|/claim|endpoint' monitoring/freecash/

monitoring/freecash/approval_queue.py:115:        "provider_endpoint",
monitoring/freecash/operator_state.py:5:no live read-only provider status/earnings source exists for the monitored
monitoring/freecash/readonly_client.py:18:    W1  GET   /api/v1/status/metrics    local substitute metrics (degraded)
monitoring/freecash/readonly_client.py:19:    W2  HEAD  /api/v1/status            local health probe
monitoring/freecash/readonly_client.py:20:    W3  GET   <provider balance/earnings status>   UNKNOWN
monitoring/freecash/readonly_client.py:44:    re.compile(r"^/api/v1/status/metrics$"),
monitoring/freecash/readonly_client.py:45:    re.compile(r"^/api/v1/status$"),
monitoring/freecash/readonly_client.py:55:METRICS_PATH = "/api/v1/status/metrics"
monitoring/freecash/readonly_client.py:56:STATUS_PATH = "/api/v1/status"
monitoring/freecash/tests/test_r2_readonly.py:22:METRICS_URL = "http://localhost:3001/api/v1/status/metrics"
monitoring/freecash/tests/test_r2_readonly.py:23:STATUS_URL = "http://localhost:3001/api/v1/status"
monitoring/freecash/tests/test_r2_readonly.py:27:INJECTED_VIOLATION = "requests.post('http://localhost:3001/api/v1/status/claim', json={})"  # readonly-exempt: negative-control payload for the checker (R2)
monitoring/freecash/tests/test_r2_readonly.py:127:        self.assertEqual(allowlisted, [r"^/api/v1/status/metrics$", r"^/api/v1/status$"])
monitoring/freecash/tests/test_r2_readonly.py:164:                "http://localhost:3001/api/v1/status/other",
monitoring/freecash/tests/test_r2_readonly.py:165:                "http://localhost:3001/api/v1/status/metrics/extra",
monitoring/freecash/tests/test_r2_readonly.py:166:                "http://localhost:3001/api/v1/status/claim",  # readonly-exempt: negative control path
monitoring/freecash/tests/test_r2_readonly.py:186:                readonly_client.request("GET", "http://provider.invalid/api/v1/status/metrics", transport=self.spy)
monitoring/freecash/tests/test_r2_readonly.py:206:            response = readonly_client.request("GET", stub.base_url + "/api/v1/status/metrics")
monitoring/freecash/tests/test_r2_readonly.py:223:            self.assertEqual(sorted(stub.records), [("GET", "/api/v1/status/metrics"), ("HEAD", "/api/v1/status")])
monitoring/freecash/tests/_support.py:150:                if self.path == "/api/v1/status/metrics":
monitoring/freecash/verify_readonly.py:73:        "write-endpoint-path",
monitoring/freecash/verify_readonly.py:76:            r"|/offers/[^/]+/claim|/surveys/[^/]+/complete"  # readonly-exempt: scanner pattern table
monitoring/freecash/verify_readonly.py:77:            r"|/tasks/[^/]+/complete|/rewards/claim",  # readonly-exempt: scanner pattern table
```

### 3.2 Write verbs

```
$ grep -rn --include='*.py' -E '\b(POST|PUT|PATCH|DELETE)\b' monitoring/freecash/

monitoring/freecash/tests/test_r2_readonly.py:148:                readonly_client.request("POST", METRICS_URL, transport=self.spy)  # readonly-exempt: negative control; the assertion is the refusal
monitoring/freecash/tests/test_r2_readonly.py:150:                readonly_client.request("POST", METRICS_URL, json={}, transport=self.spy)  # readonly-exempt: negative control; body-carrying request must also be refused
monitoring/freecash/tests/test_r2_readonly.py:156:            for method in ("PUT", "PATCH", "DELETE", "TRACE", "OPTIONS", "CONNECT"):  # readonly-exempt: negative controls, all must be refused
monitoring/freecash/verify_readonly.py:42:    ("http-verb", re.compile(r"\b(POST|PUT|PATCH|DELETE)\b", re.IGNORECASE)),  # readonly-exempt: scanner pattern table
monitoring/freecash/verify_readonly.py:49:            r"|fetch\([^)]*method:\s*[\"'](POST|PUT|DELETE)"  # readonly-exempt: scanner pattern table
monitoring/freecash/verify_readonly.py:51:            r"|curl\s+[^|]*-X\s*(POST|PUT|DELETE)"  # readonly-exempt: scanner pattern table
```

### 3.3 What these greps prove

1. **No provider endpoint is referenced by the package** — not `/accounts`, not `/getBalance`, not `/stats`, not `/transactions`, not `/cashout`. `approval_queue.py:115` carries only the *placeholder* key `"provider_endpoint"` whose value is the `PROVIDER_ENDPOINT_UNKNOWN` literal (`approval_queue.py:116`, `readonly_client.py:60`).
2. **The only two allowlisted paths are local** (`readonly_client.py:44-45`), and `tests/test_r2_readonly.py:127` asserts the allowlist is *exactly* those two.
3. **Write verbs appear only as negative controls and scanner patterns** — every occurrence is either a test asserting a refusal or the verifier's own pattern table, each carrying the `readonly-exempt:` marker. There is **no unexempted write call anywhere in the package**.
4. `tests/test_r2_readonly.py:166,186` show the intended refusals: a path ending `/claim` and a host `provider.invalid` are both negative controls that must raise.

---

## 4. Prior-artifact audit — verified / unverified / stale (with citations)

Legend — **VERIFIED**: re-checked against a live command or a live public page in this pass, *or* true by reading the shipped file at the cited line. **UNVERIFIED**: asserted by a prior artifact; this pass did not independently reproduce it. **STALE**: was true when written and is now overtaken by the live state.

| # | Claim | Class | Citation |
|---|---|---|---|
| 1 | No provider is configured; no credential exists in the environment | **VERIFIED** (live) | B15 (one grep hit, a *forbidding* test); V10 §0 A24 `inherited`; `readonly_client.py:41` loopback-only |
| 2 | `readonly_client.py` is the routine's only network path; W3/W4 are `UNKNOWN` and unallowlisted | **VERIFIED** (code read) | `readonly_client.py:1`, `:16-27`, `:43-49`, `:60`, `:76-107` |
| 3 | The routine writes a null snapshot when no operator record exists for the day | **VERIFIED** (live) | B6; `operator_state.py:128-139`; `changedetect.py:169-173`; `run_daily_check.py:410-419` |
| 4 | R3 uses exact-integer comparison of four fields with a sha256 dedupe key including the day key | **VERIFIED** (code read) | `changedetect.py:34-39`, `:214-216`, `:226-276` |
| 5 | The prior snapshot is loaded **before** the new one is written (the legacy defect) | **VERIFIED** (code read) | `run_daily_check.py:402-405` — `load_prior_snapshot(day)` at `:402`, `build_snapshot` at `:403`, `save_snapshot` at `:405` |
| 6 | `MONITOR_DEGRADED` is a success outcome and advances `last_success_day` | **VERIFIED** (live + code) | B7; `gate.py:32-40`, `:198-200`; `watchdog.py:33` |
| 7 | `approvals/pending.json` does not exist; the queue is empty | **VERIFIED** (live) | B10 |
| 8 | freecash.com publishes no public developer API and its ToS forbids automated access *including monitoring* | **PARTIALLY VERIFIED** | ToS **effective date** re-confirmed live this pass (§5.4); the **§17 body text** was **not** re-fetched this pass (extractor truncated the page) → treat the verbatim §17 quote as **repo-recorded**, `PROVIDER-CONTRACT-RESEARCH-V2.md:136`, and see U11 |
| 9 | freecash.com `robots.txt` disallows `/user/`, `/myprofile`, `/fc-api/`, `/dev-playground/` | **VERIFIED** (live, this pass) | §5.4 quote |
| 10 | freecash.io is a parked GoDaddy for-sale domain, not a platform | **VERIFIED** (live, this pass) | §5.1 quote from `https://freecash.io/llms.txt` |
| 11 | HG.Cash `GET /accounts` returns ledger balance / `pendingFees` / `netBalance` / `status ∈ {Operativa, Bloqueada, Cerrada}` | **VERIFIED** (live, this pass) | §5.2 quotes |
| 12 | HG.Cash `GET /account/{id}/balance` exists with the same fields | **VERIFIED** (live, this pass) | §5.2 quotes |
| 13 | HG.Cash base URL `https://hg.cash/api/v1`, Bearer `cash_<64-char-hex>`, token issued from the dashboard | **VERIFIED (URL/auth format live)**; the "self-serve, no approval step" nuance is **UNVERIFIED** | §5.2; `PROVIDER-FINDINGS-REVERIFIED.md:141-143` |
| 14 | HG.Cash onboarding is KYC-gated ("does **not** automatically grant dashboard access to every signup") | **VERIFIED** (live, this pass) | §5.2 quote from `https://docs.hg.cash/introduction.md` |
| 15 | Cashfree `GET /payout/v1/getBalance` returns `balance` + `availableBalance` | **VERIFIED** (live, this pass) | §5.3 quotes |
| 16 | Cashfree `GET /payout/v1.2/getBalance` exists and is not deprecated | **VERIFIED** (live, this pass) | §5.3 — OpenAPI block `get /payout/v1.2/getBalance`, `deprecated: false` |
| 17 | Cashfree token acquisition needs a `POST` (`/payout/v1/authorize`) | **UNVERIFIED in this pass** (the doc page states the purpose, not the verb, in what was retrieved) | repo record: `PROVIDER-CONTRACT-RESEARCH-V2.md:180`; §5.3 |
| 18 | `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33` presents a "FreeCash.io Platform APIs" surface with `X-API-Key` | **VERIFIED (as an error)** — the file exists and says exactly that; freecash.io is a parked domain (§5.1) and `X-API-Key` is the third-party `parse.bot` scheme (§5.5) | `server/data/freecash-monitor/INTEGRATION_STATUS.md` (read this pass); `PROVIDER-CONTRACT-RESEARCH-V2.md:148` |
| 19 | `config/freecash-crontab` targets a broken stub with a placeholder path | **VERIFIED** (live) | B13 |
| 20 | No Free Cash scheduled task is registered | **VERIFIED** (live) | B14 |
| 21 | `RESEARCH-PLAN-V4.md §1.4` claim "default data root **ABSENT** … the routine has never performed a real run" | **STALE** | overtaken: `data/freecash-monitor/` exists with 3 snapshots, 3 locks and a 15-line alert log (B6/B8/B9) |
| 22 | `RESEARCH-PLAN-V4.md §1.3` "S2 remaining red tests (4 failures)" | **STALE** | V10 §0 A10 records `tests=52 failures=0 errors=0`, exit 0 (`inherited`; not re-run in this pass) |
| 23 | `IMPLEMENTATION-PLAN-V3.md §5.1` "`monitoring/` and `monitoring/freecash/` do not exist … T1.1–T5.2 unexecutable" | **STALE** | the package exists with 10 modules + tests (B15, §1) |
| 24 | `IMPLEMENTATION-PLAN-V3.md §5.3` "`pytest` is not available" | **UNVERIFIED / probable-still-true** | the suite's own runner is `tests/run_all.py`, not pytest; not re-checked this pass |
| 25 | `AUDIT-RULE-COMPLIANCE.md §(f)` "`server/scripts/verify-freecash-rules.mjs` is not a verifier (4/4 tautology)" | **VERIFIED** (re-confirmed live in V10 §0 A16, `inherited`) | `AUDIT-RULE-COMPLIANCE.md:230-246`; V10 A16 |
| 26 | `PROVIDER-CONTRACT-RESEARCH-V2.md §3.2` "freecash.io is NOT a platform" | **VERIFIED** (live, this pass) | §5.1 |
| 27 | `PROVIDER-FINDINGS-REVERIFIED.md Q3.4` "HG.Cash unauthenticated `GET /accounts` → 401" | **UNVERIFIED in this pass** — no provider network call was permitted | repo record `:147-159`; **do not restate as observed** |
| 28 | `PROVIDER-FINDINGS-REVERIFIED.md Q3.7` "Cashfree unauthenticated probe → edge-level 403 HTML, not the documented JSON" | **UNVERIFIED in this pass** — no provider network call was permitted | repo record `:188-206` |
| 29 | 13+ plan documents already exist in `docs/free-cash-monitor-routine/` | **VERIFIED** (live `ls`) | 41 entries in the directory; V10 + V9 + V9-addendum + 4 `DELEGATION-*` dirs |

**Net audit result:** the *code-level* claims (rows 1–7, 19–20, 25) hold and are the ones this plan builds on. The *provider-level* claims split cleanly into three groups: (i) the documented **contracts** (HG.Cash, Cashfree) are re-confirmed live (rows 11, 12, 15, 16); (ii) the **live probes** are `inherited` only and must not be restated as observed (rows 27, 28); (iii) the **freecash.*** findings are confirmed for robots.txt and the parked domain (rows 9, 10) but the §17 ToS body was not re-fetched (row 8). The `RESEARCH-PLAN-V4.md`/`IMPLEMENTATION-PLAN-V3.md` "does not exist / never ran" claims are **stale** (rows 21, 23).

---

## 5. External provider research — public docs only, URL + quote per claim

**Method and limits of this section.** No network call was made to any provider endpoint. Every claim below was obtained by reading **public documentation pages** through the agent's `web_search`/`web_extract` tools. Anything not stated by an official page is marked **UNVERIFIED**. No credential, token, secret or API key appears; where a doc names an auth header, only the **header name** is recorded.

### 5.1 FreeCash.io — **eliminated: parked domain, no API**

- **URL:** `https://freecash.io/llms.txt`
- **Quote (verbatim):** *"freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket. It is available via Buy-It-Now, Make-an-Offer, or Lease-to-Own, depending on the listing's current configuration."* and, under Status, *"For sale: Yes"* / *"Listed on: GoDaddy (aftermarket)"* / *"Marketplace listing: https://forsale.godaddy.com/forsale/freecash.io"*.
- **Reading:** FreeCash.io is **not a service**, exposes no API, holds no account, and cannot be a read source or a write target. The repo record that names it as a provider (`server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33`, re-read this pass) is **wrong on both counts** — the domain is parked and the `X-API-Key` scheme it attributes to it belongs to a third-party scraper (§5.5).
- **Status:** VERIFIED (live, this pass).

### 5.2 HG.Cash — real, documented, verb-pure read-only balance API (no earnings field)

**Get User Accounts**
- **URL:** `https://docs.hg.cash/api-reference/accounts/get-user-accounts`
- **Quote (request, verbatim from the page):**
  `curl --request GET --url https://hg.cash/api/v1/accounts --header 'Authorization: Bearer <token>'`
- **Quote (200 response example, verbatim):**
  `{"data":[{"id":"3c90c3cc-…","name":"<string>","balance":123,"pendingFees":123,"netBalance":123,"status":"Operativa","currency":"<string>","number":"<string>","alias":"<string>","platform":{…},"company":{…}}],"count":123}`
- **Quote (auth, verbatim):** Authorization — *"User API authentication token with format `cash_<64-char-hex>`."*

**Get Account Balance**
- **URL:** `https://docs.hg.cash/api-reference/accounts/get-account-balance`
- **Quote (request, verbatim):**
  `curl --request GET --url https://hg.cash/api/v1/account/{id}/balance --header 'Authorization: Bearer <token>'`
- **Quote (field descriptions, verbatim):** `balance` number — *"Account ledger balance rounded to 2 decimals"* · `currency` string · `pendingFees` number — *"Fees accrued but not yet collected, rounded to 2 decimals"* · `netBalance` number — *"Available balance after pending fees (balance minus pending fees), rounded to 2 decimals"* · `status` enum<string> — *"Account lifecycle status"*, options **`Operativa`, `Bloqueada`, `Cerrada`**.

**Onboarding gate**
- **URL:** `https://docs.hg.cash/introduction.md`
- **Quote (verbatim):** *"HG.cash does **not** automatically grant dashboard access to every signup. Platform access requires a **registered user record** tied to your email (and authentication). That record is created or enabled **after** HG.cash has engaged with you and completed required **compliance checks**, typically including **KYC**."*

**Documentation index (what read ops exist at all)**
- **URL:** `https://docs.hg.cash/llms.txt`
- **Observed:** the API-reference index enumerates **Transactions** (`Create Transaction Request (Cash Out)`, `Get Transaction Request Status`, `Get Transaction Receipt`, `Get Transaction ID for Request`), **Checkouts** (list/create/get/cancel/receipt), **Claims** (create/get) and **Webhooks**. There is **no** `/stats`, `/earnings`, or revenue endpoint in the index.

**Reading for the routine:**
- HG.Cash is the **only** candidate whose read path is *verb-pure*: a dashboard-issued Bearer token sent directly on a `GET`; no token-exchange call is needed (so it can work inside an R1 `GET`/`HEAD`-only transport).
- It supplies a **status** (`Operativa`/`Bloqueada`/`Cerrada`) and a **balance**, but **no `earnings_total_cents` field and no field that matches `pending_cents`** (its `pendingFees` is camelCase and matches none of the routine's aliases — `changedetect.py:55,61`). A provider-sourced **earnings** figure is therefore impossible from HG.Cash (see U3).
- Whether **this operator** holds an HG.Cash account, and whether that account is KYC-approved, is **UNVERIFIED** (§8, U8).
- HG.Cash **rate limits: UNVERIFIED** — not present in the docs index.

### 5.3 Cashfree Payouts — documented balance API whose read path is NOT verb-pure

**Get Balance (v1)**
- **URL:** `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`
- **Quote (request, verbatim):**
  `curl --request GET --url https://payout-api.cashfree.com/payout/v1/getBalance --header 'Authorization: <authorization>' --header 'Content-Type: <content-type>'`
- **Quote (200 example, verbatim):** `{"status":"SUCCESS","subCode":"200","message":"Ledger balance for the account","data":{"balance":"214735.50","availableBalance":"173980.50"}}`
- **Quote (headers, verbatim):** `Authorization` string required — *"Bearer auth token"*; `Content-Type` string required — *"application/json"*.
- **Quote (documented 403 example, verbatim):** `{"status":"ERROR","subCode":"403","message":"APIs not enabled. Please fill out the [Support Form](https://merchant.cashfree.com/merchants/landing?env=prod&raise_issue=1)"}`
- **Quote (error table, verbatim):** `403` — *"Token is not valid"*; `412` — *"Token missing in the request"*.

**Get Balance 1.2 Compat**
- **URL:** `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12`
- **Quote (verbatim):** *"Use this API to get the ledger balance and available balance of your account. Available balance is ledger balance minus the sum of all pending transfers (transfers triggered and processing or pending now)."*
- **Quote (OpenAPI block, verbatim):** `get /payout/v1.2/getBalance`, `operationId: get-balance-v1-21`, `deprecated: false`; servers `https://payout-api.cashfree.com` (Production) and `https://payout-gamma.cashfree.com` (Sandbox); optional query parameter `paymentInstrumentId`.

**Authorize (token acquisition)**
- **URL:** `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize`
- **Quote (verbatim):** *"Use this API to authenticate with the Cashfree system and obtain the authorization bearer token. All other API calls must have this token as Authorization header in the format 'Bearer ' (without quotes) for them to get processed."*
- **Quote (verbatim):** *"If you do not have a static IP, you can generate a public key and pass it with the API request."* … *"Retrieve your clientId (one which you are passing through the header `X-Client-Id`)"* … *"Pass this signature through the header `X-Cf-Signature`."*

**Reading for the routine:**
- The two balance paths supply **`balance`** (ledger) and **`availableBalance`** (ledger minus pending transfers). Neither is a **status**, an **earnings total**, or a plain **pending** figure — so `account_status`, `earnings_total_cents` and `pending_cents` are all **UNRESOLVABLE** from Cashfree's documented fields.
- The read path is **not verb-pure**: obtaining the token requires a call to `/payout/v1/authorize`. The **verb (POST) is UNVERIFIED in this pass** — the retrieved page text states the purpose but not the method; the repo record (`PROVIDER-CONTRACT-RESEARCH-V2.md:180`) says `POST`. Either way, if the monitor were to make that call **itself** it would need an exemption to the R1 `GET`/`HEAD`-only transport — a deliberate, reviewed widening. The honest alternative is an **out-of-band token** so the monitor stays `GET`-only.
- Whether **this operator** has a Cashfree merchant account with Payouts enabled is **UNVERIFIED** (§8, U8).
- Cashfree Get-Balance **rate limit: UNVERIFIED** — not stated on the balance pages.

### 5.4 freecash.com (Almedia GmbH) — the platform the routine's own docstrings name

- **URL:** `https://freecash.com/robots.txt` — **Quote (verbatim):**
  `User-Agent: *` / `Allow: /` / `Disallow: /user/` / `Disallow: /myprofile` / `Disallow: /r/` / `Disallow: /_next/` / `Disallow: /_ipx/` / `Disallow: /offer/` / `Disallow: /fc-api/` / `Disallow: /scd-cgi/` / `Disallow: /w/` / `Disallow: /dev-playground/`
  → an internal application backend exists and is deliberately excluded from crawlers.
- **URL:** `https://freecash.com/en/policies/terms` — **Quote (verbatim):** *"Last Updated: July 17, 2026"* / *"(Effective: July 17, 2026)"* and *"These Website Terms of Services are entered into by and between you and Almedia GmbH ("Almedia", "we", or "us")"*. The page lists **§17 "Restrictions and Prohibited Uses"** and **§19 "Monitoring and Enforcement; Termination"** among its sections.
- **§17 body text: NOT RE-FETCHED THIS PASS.** The extractor returned only the page head (through §2). The verbatim §17 quote that the prior artifacts rely on is **repo-recorded** at `PROVIDER-CONTRACT-RESEARCH-V2.md:136`: *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website."* **Treat as UNVERIFIED-in-this-pass and re-fetch before republishing the quote** (U11). What *is* re-verified live is that the ToS is still the July 17, 2026 edition — the same effective date the prior artifacts cite.
- **URL:** `https://status.freecash.com/` — **Observed:** a Datadog status page listing service groups *"Offers / Cashout / Surveys / Authentication"* with *"All Systems Operational"*. **Reading:** "status" for freecash.com means **service uptime**, not account status — it exposes no per-account field and is not a status/earnings API.
- **Provider search:** an exact-phrase search for the §17 wording returned no freecash.com result; the parse.bot listing states *"Freecash does not publish a documented public developer API."* (third-party source, §5.5).

### 5.5 Third-party and dead leads (recorded so they are not re-probed)

- **`https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api`** — **Quote (verbatim from the listing):** *"This isn't an officialfreecash.ioAPI — it's an independent, maintained REST wrapper over public data."* and *"Freecash does not publish a documented public developer API. This Parse API provides structured access to the public data Freecash exposes on its platform."* Endpoints are platform-wide (`get_leaderboard`, `get_withdrawals`, `get_stats`, `get_offer_categories`, `get_featured_offers`, `get_cashout_methods`) with **no notion of "your account"**; the listing's own auth scheme is `X-API-Key` (the scheme the repo's `INTEGRATION_STATUS.md` mis-attributed to freecash.io). **Verdict:** cannot serve this routine — public aggregate data only, and sourced from a parked domain.
- **`getfreecash.com`** — recorded by prior artifacts as a liveness placeholder answering `OK` (`PROVIDER-CONTRACT-RESEARCH-V2.md:193`). **Not re-probed this pass** (no provider network call permitted) → **UNVERIFIED**.

### 5.6 What the external research does NOT establish

1. That the monitored balance sits on **any** named provider — no public source connects "Free Cash Finance Automation" to HG.Cash or Cashfree.
2. Whether the operator is **entitled** on HG.Cash (KYC) or Cashfree (Payouts enabled).
3. Any **live value** (balance, earnings, pending, status).
4. Any **rate limit**.
5. Whether freecash.com has a **private/partner** API.
6. Any **read-only credential scope** — neither HG.Cash nor Cashfree publishes one (HG.Cash's `POST /transactions` cash-out is documented on the same token).

---

## 6. (a) The unknown list, ranked by how hard it blocks the routine

Ranking rule: **rank 1 blocks the routine from producing any *useful* output at all** (a real snapshot); **rank 10 blocks only the *quality* of an already-working routine**.

| Rank | ID | Unknown (the open question) | Why it blocks | Blocking severity | Resolvable from this machine? |
|---|---|---|---|---|---|
| 1 | **U1** | **Which provider/account holds the monitored balance?** No provider is bound anywhere in the package (B15). | Until answered, every snapshot is `degraded: true` and every "no change" is unverifiable. It is the gate on U5/U6/U8. | **Total** | **No** — operator-held. Only a written operator statement names provider + account. |
| 2 | **U2** | **No operator reading has ever been entered** (`records == []`, B5). | R3 has never had an input and cannot diff anything; R4 has never had an item (B10). This is the single cheapest, highest-leverage unknown. | **Total for R3/R4** | **Yes — today**, by an operator typing one record (§9). |
| 3 | **U3** | **No documented provider field carries `earnings_total_cents`.** HG.Cash has balance/`pendingFees`/`netBalance`/status only; Cashfree has `balance`/`availableBalance` only (§5.2, §5.3). | Even if U1 is answered, the routine's **earnings** field — the headline R3 trigger — has no provider source. Earnings can only ever be operator-sourced. | **High** (it narrows what "provider-verified" can mean to *balance/status only*) | **Yes — by enumeration**: the docs indices contain no earnings/stats endpoint (§5.2). |
| 4 | **U4** | **"Ran" is booked as "read"** — `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`, `last_success_day` advanced, `watchdog.covered = true` (§2.3, `gate.py:32-40,198`, `watchdog.py:33`). | The routine spends the day *before* a reading exists, then hides that it did. It is the mechanical reason a first reading is hard to obtain on any day the routine runs first. | **High** (blocks first-reading acquisition) | **Yes — by a code change**, which this plan proposes but does **not** apply (§7 U4). |
| 5 | **U5** | **No provider read path is allowlisted.** `ALLOWED_HOSTS` is loopback-only (`readonly_client.py:41`) and the audit hook aborts any non-loopback connect (`:146-163`). | Any provider integration is a **deliberate widening of R1** — two allowlists plus the audit hook, with a mutation test to prove the new path is still read-only. | **High** (blocks wiring, not diagnosis) | **Yes — by a code change** (§7 U5). |
| 6 | **U6** | **Cashfree's read path is not verb-pure**: the token comes from `/payout/v1/authorize` (verb UNVERIFIED, `POST` per repo record). | Consuming Cashfree inside an R1 `GET`/`HEAD`-only transport requires an explicit exemption, or an out-of-band token. | **Medium-high** (rules out one of two candidates unless the operator accepts a widening) | **Yes — by decision** (§7 U6). |
| 7 | **U7** | **Whole-currency integers are not multiplied by 100** (`changedetect.py:95-108`, `:133-134`). | A provider returning `{"balance": 123}` records **$1.23**. Dormant while every snapshot is null; live the moment any integer amount arrives. | **Medium** (silent data corruption once U1/U2 close) | **Yes — by a test + a code change** (§7 U7). |
| 8 | **U8** | **HG.Cash entitlement/KYC and both providers' rate limits are unknown.** | Decides whether either candidate is usable at all, and how often. | **Medium** | **Partly** — rate limits need one authenticated call's headers or provider support; entitlement is operator-held. |
| 9 | **U9** | **Three state roots exist** (`data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor`; B12). | Two roots can silently diverge; `paths.py:35` pins only `data/freecash-monitor`. | **Low-medium** | **Yes — by an operator decision** to freeze one root (§7 U9). |
| 10 | **U10** | **No notification sink is proven.** The default is a Windows toast never observed rendering; no email/webhook credential exists (V10 §0 A24, `inherited`). | Determines what "notified" is allowed to mean — today, only `alerts.jsonl` is observable. | **Low** | **Partly** — one human-observed toast closes it; external channels stay blocked. |
| 11 | **U11** | **The freecash.com §17 ToS body was not re-fetched this pass** (§5.4). | Only matters if the compliance argument is republished; the paused-candidate verdict does not depend on it. | **Low** | **Yes — by re-fetching** `freecash.com/en/policies/terms` with a full-text extractor (§7 U11). |

---

## 7. (b) Research method per unknown — exact command / page / call, expected artifact

All commands are **read-only**. Nothing here calls a provider endpoint; the provider "calls" are *documentation reads*. Where a fix is proposed, it is **proposed in a file**, not applied — this plan is additive-only.

| ID | Exact action | Expected artifact (what proves it) |
|---|---|---|
| **U1** | Ask the operator, in writing, one question: *"Which account holds the monitored balance, with which provider, and does it expose a dashboard-issued API token?"* No network, no credential. | A one-page **operator statement** naming provider + account + whether a dashboard token exists. Per `PROVIDER-CONTRACT-RESEARCH-V2.md:256-263` the only acceptable credentials are **provider-issued dashboard tokens** (HG.Cash `Authorization: Bearer cash_…`) — never a login password, session cookie or 2FA code. |
| **U2** | Operator opens **their own** dashboard in a browser, logs in themselves, reads four figures, appends **one** record to `state/operator-state.json` with `day_key` = the **next unspent local day** (§9). | `state/operator-state.json` with `len(records) >= 1`, and on the following run a snapshot with `source.data_available: true` and four non-null figures. |
| **U3** | Enumerate every read op in the two docs indices and grep them for an earnings field: read `https://docs.hg.cash/llms.txt` and `https://www.cashfree.com/docs/llms.txt`; on each balance page, list the 200-response schema. | A table of `endpoint → fields` showing **no** earnings/stats field (this pass already produced it: §5.2, §5.3). If none is found, record the contract as **balance/status-only** and earnings as operator-sourced. |
| **U4** | Reproduce the mis-booking offline on a **scratch** `FREECASH_DATA_ROOT` (never the production root): `FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-u4" .../venv/Scripts/python monitoring/freecash/run_daily_check.py --source operator_state` on a day with no record, then read `state/last-run.json`. Then file a **proposed** patch: remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` (`gate.py:32-40`) or add a separate `has_reading` condition to `watchdog.py:33`. | (a) A captured transcript showing `last_outcome=MONITOR_DEGRADED` **and** `last_success_day=<today>`; (b) a proposed-diff file under a `delivery/proposed/` path (not applied) plus a test that fails before and passes after. |
| **U5** | Draft, do **not** apply: one `ALLOWED_PATHS` regex per provider read op with a justification comment (`readonly_client.py:43-49`), the provider host added to **both** `ALLOWED_HOSTS` (`:41`) and the audit hook (`:146-163`), and the deliberate change to `tests/test_r2_readonly.py:119`. | A proposed diff + a **mutation test** on the pinned revision showing the new path is still `GET`/`HEAD`-only and that a planted write on the same path is refused. Treat the allowlist widening as an **R1 change**, reviewed as such — never as a "test fix". |
| **U6** | Read `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` and record the verb it documents (this pass retrieved the purpose only). Then decide: (i) out-of-band token so the monitor stays `GET`-only, or (ii) an explicit `# readonly-exempt:` on the authorize call. | A one-line decision record + the authorize page URL and the quoted method. Option (ii) widens R1 and must be an explicit operator decision. |
| **U7** | Write a unit test with an integer payload, e.g. `normalize_metrics({"balance": 123, "earnings": 0, "pending": 0, "status": "Operativa"})`, and assert the result. Run with the interpreter of record on a scratch copy. | Test output showing the current (wrong) value (`123` cents) vs the expected value (`12300` cents) → a proposed one-line fix in `changedetect.py:133-134`. |
| **U8** | For rate limits: one **authenticated** call's response headers (`X-RateLimit-*` if present) or a support request to HG.Cash / Cashfree. For entitlement: ask the operator directly. **This plan does not make that call** — it requires a credential this pass must not use. | Either the rate-limit headers captured by the operator, or a written "unknown, not published" record. Entitlement: the operator statement from U1. |
| **U9** | Enumerate the three roots and diff them: `ls -R data/freecash data/freecash-monitor server/data/freecash-monitor`. Note `paths.py:35` pins `data/freecash-monitor`. | A one-page **state-root freeze** decision naming the single authoritative root and the disposition of the other two (V10 §5 D-7). |
| **U10** | Have a human run the toast path once and observe it; then confirm `notified-keys.json` carries the delivery label. | A screenshot or a human attestation, plus the `delivery` label — `STUB_OK` must never be accepted as `TOAST_OK` (`notify.py:45-47`, `:151-164`). |
| **U11** | Re-fetch `https://freecash.com/en/policies/terms` with a full-text extractor and grep §17 for "monitor" / "robot" / "spider". | The verbatim §17 clause with the fetch timestamp; until then the quote stays repo-recorded (`PROVIDER-CONTRACT-RESEARCH-V2.md:136`). |

---

## 8. (c) The read-only endpoint + field contract the routine must consume

The routine's compared fields are fixed at `changedetect.py:34-39`. This is the contract to fill, mapped per source. **"UNRESOLVABLE" means no documented field on that source matches any of the routine's aliases.**

| Contract field | Operator source (**authoritative today**) | HG.Cash `GET /accounts` (or `GET /account/{id}/balance`) | Cashfree `GET /payout/v1/getBalance` |
|---|---|---|---|
| `account_status` (str) | `account_status` in the operator record (`operator_state.py:51`) | **`status`** → `Operativa`\|`Bloqueada`\|`Cerrada`; upper-cased by `changedetect.py:123` | **UNRESOLVABLE** — no status field documented |
| `earnings_total_cents` (int) | `earnings_total_cents` (`operator_state.py:52`) | **UNRESOLVABLE** — no earnings field on either HG.Cash endpoint | **UNRESOLVABLE** |
| `balance_cents` (int) | `balance_cents` (`operator_state.py:53`) | **`balance`** matches the whole-currency alias `balance` (`changedetect.py:60`) — but see U7 (integer amounts are not ×100) | **`balance`** (ledger, string "214735.50" → ×100 via `_as_cents` str branch) |
| `pending_cents` (int) | `pending_cents` (`operator_state.py:54`) | **UNRESOLVABLE as-is** — `pendingFees` matches neither `pending_cents`/`pending_total_cents` nor `pending`. A deliberate alias mapping would be required and must be a reviewed change. | **UNRESOLVABLE** — `availableBalance` is a derived value (`balance − pending transfers`), not a pending amount |
| `currency` (str) | `currency` (`operator_state.py:55`) | **`currency`** | **UNRESOLVABLE** — the 200 example shows bare numeric strings with no currency |
| Transport | none (local file read) | `GET`, Authorization header name: **`Authorization`** (value `Bearer cash_<64-char-hex>`) | `GET`, headers: **`Authorization`** (`Bearer`), **`Content-Type`** |
| Verb-pure under R1? | n/a | **YES** | **NO** — token comes from `/payout/v1/authorize` (U6) |

**Contract consequences (must be stated in any design that cites a provider):**

1. **No documented provider supplies `earnings_total_cents`.** Provider-verified *earnings* is impossible; the only provider-verifiable fields are **balance** (both) and **account status** (HG.Cash only). Earnings must remain operator-sourced. Any plan claiming "provider-verified earnings" is unsupported by §5.
2. **`pending_cents` is not obtainable** from either candidate without inventing an alias. `pendingFees` ≠ pending earnings; `availableBalance` ≠ pending.
3. **`status` is provider-verifiable only on HG.Cash**, and only as a three-value lifecycle enum, not the free-text status the operator may read.
4. **Every provider-sourced snapshot must stay `degraded: true`** unless and until a real provider read replaces the substitute — `changedetect.py:166-168` sets `degraded: true` unconditionally today, and the notification templates print `Source: DEGRADED (…)` (`notify.py:308-310`). A "no change" report must never be presented as provider-confirmed.
5. Two **auth header names** are the only credential-shaped facts recorded here (values `[REDACTED]`): HG.Cash → `Authorization`; Cashfree → `Authorization`, `Content-Type`, and (for authorize only) `X-Client-Id` / `X-Client-Secret` / optional `X-Cf-Signature`. **No token, key or secret is recorded anywhere in this document.**

---

## 9. (d) How to obtain the FIRST real reading so R3 change detection can fire

**Why this is the top actionable item.** `data/freecash-monitor/state/operator-state.json` has `records == []` (B5) and all three snapshots are null (B6). R3 compares the current snapshot against the prior one (loaded **before** the new one is written, `run_daily_check.py:402-405`), and `changedetect.compare()` returns `baseline: True` — **no change detection at all** — whenever either side lacks data (`changedetect.py:235-241`). So R3 cannot fire until **two consecutive days** exist that both carry real data.

### The exact sequence (operator procedure; no automated action, no credentials)

1. **Do not touch today (2026-10-01).** Its day-lock exists (B8) and its day is spent; re-running today yields `SKIP_DUPLICATE_DAY` (`run_daily_check.py:310-321`) and will **not** re-read. Do **not** delete the lock as a routine step — see the note below.
2. **Operator reads their own dashboard.** Open the provider dashboard in a browser and log in **yourself**. The routine is never given a password, session cookie or 2FA code (`PROVIDER-CONTRACT-RESEARCH-V2.md:265-267`). Note four figures: account status, total earnings, current balance, pending amount.
3. **Append exactly one record** to `data/freecash-monitor/state/operator-state.json` with `day_key` equal to the **next unspent local calendar day** (2026-10-02), matching the template at `operator_state.py:48-56`:
   ```json
   {"day_key": "2026-10-02",
    "entered_at_utc": "2026-10-02T05:10:00Z",
    "account_status": "ACTIVE",
    "earnings_total_cents": 1340,
    "balance_cents": 1340,
    "pending_cents": 0,
    "currency": "USD"}
   ```
   Amounts are **integer cents** (`1340 == 13.40`). The `day_key` must match the day the run will use; a **stale record is never carried forward** (`operator_state.py:35-37`, `:104-116`).
4. **Let the routine run on 2026-10-02.** `read_source` finds the record → `data_available: True` (`operator_state.py:144-151`) → snapshot carries the four figures.
5. **Day 1 outcome is `INITIAL_BASELINE`, not a notification.** With no prior data-bearing snapshot, `compare()` returns `baseline: True` and the routine emits the log-only `INITIAL_BASELINE` line (`changedetect.py:235`, `run_daily_check.py:420-422`, `notify.py:102-110`). **No notification and no approval item on the first real day** — a first run must never produce a fake alarm.
6. **Enter a second consecutive record on 2026-10-03.** Now the prior snapshot has data, `compare()` proceeds, and a difference in any of the four fields produces exactly one `EARNINGS_CHANGED` / `BALANCE_CHANGED` / `STATUS_CHANGED` line with one dedupe-keyed notification (`changedetect.py:214-216`, `notify.py:264-302`) **and one PENDING approval item** (`run_daily_check.py:149-166`, `approval_queue.py:109-143`). That is the first time R3 and R4 can fire at all.
7. **Keep entering one record per local day.** `pending_cents` moving is an `EARNINGS_CHANGED` subtype (`changedetect.py:38`, `:273-274`); an earnings change that drags the balance is deliberately **one** change, not two (`changedetect.py:250-261`).

### Notes and caveats

- **A minimum of two consecutive data-bearing days is required before R3 can produce its first change.** Day 1 is a baseline by design. Do not expect a notification on the very first reading — that expectation is itself a common source of false "R3 is broken" reports.
- **Today's spent key is not an emergency** for the *routine's* R2 (exactly one read/day) — it is only an emergency for *acquiring a reading for today*. The clean path is to start the record on the **next** day. Removing `2026-10-01.lock` to obtain today's reading is a **human decision** (V10 §5 D-3/S11), not a routine step, and this plan neither performs nor recommends it as a default.
- **The first reading is worth more than any further provider research**: it turns R3 from untestable into testable, gives the toast/approval path its first real exercise, and costs one lark of typing. It is the smallest action that unblocks the largest number of the unknowns in §6 (U2, and the R3/R4 half of every other row).
- **U4 will spend the next day before the reading if the routine runs first on a day the operator has not yet entered.** Fix U4 (§7) before relying on unattended timing, or ensure the record is present before the scheduled run.

---

## 10. (e) What remains UNKNOWN and cannot be resolved from this machine

These are recorded so they are not re-probed and not reported as observed:

1. **Which provider/account holds the monitored balance** (U1). No repo artifact, no public page, and no probe establishes it. **Operator-held.**
2. **Entitlement**: whether the operator holds an **HG.Cash** account (KYC-gated, §5.2) or a **Cashfree** merchant account with Payouts enabled (§5.3). **Operator-held.**
3. **Live values** — balance, earnings, pending, account status. No credential ⇒ no values; any figure produced without one is fabricated and is forbidden by this workflow's own manifest. **No credential exists in this environment.**
4. **Rate limits** for HG.Cash and for Cashfree `getBalance`. Not published; only a first authenticated call's headers or provider support can close them.
5. **Whether freecash.com operates a private/partner API** under contract. Only Almedia could confirm; the public posture indicates none for consumers, and the ToS posture is hostile to automation (§5.4).
6. **Whether freecash.com sends a periodic balance/status email** usable as a passive evidence source. Not established.
7. **Credential scope**: neither HG.Cash nor Cashfree publishes a read-only scope. HG.Cash's documented `POST /transactions` cash-out is reachable on the **same** token, so read-only-ness would be enforced by *our client's allowlist*, not by the credential (U5). **This makes the un-widened R1 transport guard load-bearing.**
8. **The verb of Cashfree `/payout/v1/authorize`** as documented today — the retrieved page text did not state it (§5.3, row 20 of §4).
9. **The verbatim freecash.com §17 ToS clause** — not re-fetched this pass; the quote stands only as repo-recorded (§5.4, U11).
10. **Whether the toast actually renders on this desktop** (U10). Deliberately not tested (it is a visible side effect); requires one human observation.
11. **Whether any scheduled task will exist.** Registration is human-gated and non-elevated on this host; nothing is scheduled (B14).
12. **The disposition of the two non-canonical state roots** (B12, U9) — an operator decision, not a research finding.

**Also explicitly not established by this pass, and therefore not to be restated as observed:** the prior artifacts' *live probe* results — HG.Cash unauthenticated `GET /accounts → 401` (`PROVIDER-FINDINGS-REVERIFIED.md:147-159`) and the Cashfree unauthenticated `403` edge HTML (`:188-206`). They remain **inherited repo evidence**; **no provider endpoint was contacted in this pass.**

---

## 11. Constraint-compliance record for this pass

| Constraint | How it was honoured |
|---|---|
| Additive only — create just this one file; edit/rename/delete nothing | Only `write_file` was used, and only for this new path. No existing file was edited, moved, renamed or deleted. |
| No git write commands at all | Only `git rev-parse`, `git status --porcelain` (reads). No `add/commit/stash/reset/restore/checkout/clean/push`. |
| No credentials/tokens/secrets | Only **header names** are recorded (`Authorization`, `Content-Type`, `X-Client-Id`, `X-Client-Secret`, `X-Cf-Signature`). Every credential value is **`[REDACTED]`**. No `.env`, vault or credential file was opened. |
| NEVER call a write/earning endpoint | No provider endpoint of any kind was contacted. The routine's write surface is described from documentation only. |
| No network call to any provider | All provider facts came from public documentation pages via `web_search`/`web_extract`. No `curl`, `HTTPConnection`, or request was issued to `hg.cash`, `cashfree.com`, `freecash.com`, `freecash.io` or any provider host. |
| URL + quote for every external claim | Every external claim in §5 carries its source URL and a verbatim quote; the one claim not re-fetched (§17 ToS) is labelled UNVERIFIED-in-this-pass with its repo citation. |
| No modification of production state | The production root was only read; its hashes were re-read (B11) and match V10's pinned values. No routine invocation was run against it. |

---

## 12. Sources

**Repository (read this pass):** `monitoring/freecash/{readonly_client,gate,changedetect,notify,approval_queue,paths,operator_state,run_daily_check,watchdog,verify_readonly}.py` · `monitoring/freecash/tests/test_r2_readonly.py` · `config/freecash-crontab` · `data/freecash-monitor/**` · `server/data/freecash-monitor/{README,INTEGRATION_STATUS}.md` · `docs/free-cash-monitor-routine/{PROVIDER-API-RESEARCH.md, PROVIDER-CONTRACT-RESEARCH-V2.md, PROVIDER-FINDINGS-REVERIFIED.md, PROVIDER-DECISION-PACKET-2026-09-20.md, PROVIDER-DECISION-PACKET-2026-09-20-v2.md, RESEARCH-PLAN-V4.md, IMPLEMENTATION-PLAN-V3.md, AUDIT-RULE-COMPLIANCE.md, WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V10-2026-10-01.md}`

**Public documentation (fetched this pass):**
- `https://docs.hg.cash/api-reference/accounts/get-user-accounts`
- `https://docs.hg.cash/api-reference/accounts/get-account-balance`
- `https://docs.hg.cash/llms.txt`
- `https://docs.hg.cash/introduction.md`
- `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`
- `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12`
- `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize`
- `https://freecash.io/llms.txt`
- `https://freecash.com/robots.txt`
- `https://freecash.com/en/policies/terms`
- `https://status.freecash.com/`
- `https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api` (third-party; recorded as an unreliable source)

**Not fetched (recorded as UNVERIFIED / inherited):** the freecash.com §17 ToS body; any provider API endpoint; `getfreecash.com`.

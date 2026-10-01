# WORKFLOW PLAN — Free Cash Finance Automation (V11, 2026-10-01)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a` · **Uncommitted paths:** 868
**Host:** Windows 11 (German-localised), git-bash (MSYS), non-elevated · **Date of this pass:** `Do,  1. Okt 2026 09:25:33` (Europe/Berlin, UTC+02:00)
**Today (from `date`):** **2026-10-01**
**Subject:** the operational daily status-monitoring routine for Free Cash Finance Automation — canonical package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`.
**Evidence standard:** every factual claim below is the observed output of a command executed **in this pass**. No PASS, hash, count or line number is inherited or reconstructed. Rows that could not be reproduced are labelled **NOT REPRODUCED** rather than dropped.
**Footprint (constraints honoured):** this file is **new** (additive). Nothing edited, renamed, moved or deleted. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created, modified, enabled, disabled or deleted. No Hermes cron job created. No provider network call. No credential, token or secret read, printed or stored. Every routine invocation in this pass used `FREECASH_DATA_ROOT` pinned to a **throwaway** directory under `%LOCALAPPDATA%\Temp\`. The production root is **byte-identical** before and after — proved in §7.

**The 4 rules (operator numbering — used everywhere in this document):**

| # | Title |
|---|---|
| **R1** | **zero automated earning/withdrawal actions, read-only transport only** |
| **R2** | **exactly one status read per Europe/Berlin calendar day** |
| **R3** | **notify exactly once on earnings or account-status change** |
| **R4** | **human approval before ANY external action; no execution path may exist** |

> **Numbering warning (measured, not recalled).** The shipped code's own docstrings use **inverted** numbering: `monitoring/freecash/gate.py:1` opens `"""gate.py -- R1: exactly one status read per operator-local calendar day.` and `monitoring/freecash/readonly_client.py:1` opens `"""readonly_client.py -- R2: the routine's ONLY network path.` Under operator numbering those are **R2** and **R1** respectively. A bare `R1`/`R2` in that code means the opposite of what it means here. **No bare `R1`/`R2` is ever emitted in this document without its title.**

---

## 0. Evidence table — every command executed in this pass, with raw output

| # | Command (executed this pass, from `D:\AgenticOS`) | Observed output (raw) | What it establishes |
|---|---|---|---|
| **A1** | `date` | `Do,  1. Okt 2026 09:25:33` | Operator-local clock = 2026-10-01, Europe/Berlin (UTC+02:00). Today's day key is `2026-10-01`. |
| **A2** | `git rev-parse --abbrev-ref HEAD`; `git rev-parse --short HEAD`; `git status --porcelain \| wc -l` | `hermes-rescue-20260908`; `8f7463a`; `868` | Workspace line confirmed: **Repository: D:\AgenticOS**, branch `hermes-rescue-20260908`, HEAD `8f7463a`, 868 uncommitted paths. |
| **A3** | `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` **(BEFORE)** | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json`<br>`1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl` | Pre-work production hashes. (Note: `alerts/alerts.jsonl` does **not** resolve from the repo root — the real path is `data/freecash-monitor/alerts/alerts.jsonl`; the literal `alerts/alerts.jsonl` gives `sha256sum: alerts/alerts.jsonl: No such file or directory`, exit 1.) |
| **A4** | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`<br>`2026-09-30.lock`<br>`2026-10-01.lock` | **Today's key `2026-10-01` is already consumed.** Under R2 the routine must not read again today; a second run today can only emit `SKIP_DUPLICATE_DAY`. |
| **A5** | `cat data/freecash-monitor/snapshots/2026-10-01.json` | `{ "schema_version": 1, "day_key": "2026-10-01", "captured_at_utc": "2026-10-01T06:53:46Z", "source": { "kind": "operator_entered", "read_ops": [], "data_available": false, "note": "no operator-entered record for 2026-10-01 in operator-state.json" }, "degraded": true, "account_status": null, "earnings_total_cents": null, "balance_cents": null, "pending_cents": null, "currency": null, "raw_response_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }` | A **null snapshot** exists for today: `data_available:false`, `degraded:true`, four figures `null`. It was not produced by this pass. |
| **A6** | `cat data/freecash-monitor/state/last-run.json` | `{ "schema_version": 1, "last_attempt_day": "2026-10-01", "last_success_day": "2026-10-01", "last_attempt_at_utc": "2026-10-01T06:53:46Z", "last_success_at_utc": "2026-10-01T06:53:46Z", "last_outcome": "MONITOR_DEGRADED", "consecutive_missed_days": 0, "timezone": "Europe/Berlin", "updated_at_utc": "2026-10-01T06:53:46Z" }` | Matches the context exactly, and shows defect **D8**: a day with **no reading** is booked as a **success day** (`last_success_day = 2026-10-01`) with `last_outcome = MONITOR_DEGRADED`. |
| **A7** | `python -c "import json;d=json.load(open(r'D:/AgenticOS/data/freecash-monitor/state/operator-state.json'));print('kind=',d['kind']);print('records=',len(d['records']))"` | `kind= operator_entered_daily_status`<br>`records= 0` | **No operator figure has ever been entered.** With `records == 0` no reading can exist, so **no change can ever be detected** (defect **D9**). |
| **A8** | `wc -l data/freecash-monitor/alerts/alerts.jsonl`; `tail -3 …` | `15 data/freecash-monitor/alerts/alerts.jsonl`; last line `{"day_key": "2026-10-01", "dedupe_key": null, "event_id": "c4b7e50d-b141-49c3-8305-c2ffd1160fd6", "event_type": "MONITOR_DEGRADED", …, "ts_utc": "2026-10-01T06:53:46Z"}` | 15 lines, last = `MONITOR_DEGRADED` for `2026-10-01T06:53:46Z`. The only end-to-end artefact the routine has ever produced is a *degraded* line. |
| **A9** | `ls -la data/freecash-monitor/approvals/`; `ls -la data/freecash-monitor/approvals/pending.json` | `total 0` (empty dir); `ls: cannot access 'data/freecash-monitor/approvals/pending.json': No such file or directory` | `approvals/` exists but **`pending.json` does not exist** — the R4 approval-queue write path has never produced a single artefact (defect **D10**). |
| **A10** | `FREECASH_DATA_ROOT="C:\Users\cd-pr\AppData\Local/Temp/fc-wp-v11-20261001/root" C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python monitoring/freecash/tests/run_all.py` | tail: `RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock`<br>`SKIP_DUPLICATE_DAY 2026-10-01`<br>`WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=INITIAL_BASELINE`<br>`WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=NOTIFIED`<br>`WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=DEDUPED`<br>`run_all: tests=52 failures=0 errors=0 skipped=0`<br>`SUITE_EXIT=0` | **Offline suite GREEN: 52 tests, 0 failures, 0 errors, 0 skipped, exit 0** — run against a **throwaway** root; the production root was never the target. Also empirically re-confirms **D8** inside the suite's own output: `RUN_OK … outcome=MONITOR_DEGRADED` is immediately followed by `WATCHDOG_OK … outcome=MONITOR_DEGRADED` (12 consecutive days, 2026-12-16 … 2026-12-30). |
| **A11** | `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python monitoring/freecash/verify_readonly.py` | `[verify_readonly] scanning: D:\AgenticOS\monitoring\freecash` … 28 `EXEMPT` lines … `[verify_readonly] forbidden=0 exempt=28 missing_targets=0`<br>`[verify_readonly] PASS - no unexempted write/earning token found.`<br>`VERIFY_EXIT=0` | **R1 static gate PASSES**: 0 unexempted write/earning tokens across the canonical package; all 28 exemptions are the scanner's own pattern table plus test fixtures. |
| **A12** | `node --check server/scripts/freecash-daily-monitor.mjs` | `D:\AgenticOS\server\scripts\freecash-daily-monitor.mjs:41`<br>`function isDailyCheckAllowed(): boolean {`<br>`                              ^`<br>`SyntaxError: Unexpected token ':'`<br>`    at checkSyntax (node:internal/main/check_syntax:72:5)`<br>`Node.js v24.20.0` | **Defect D2 reproduced.** A TypeScript annotation at **line 41** of a `.mjs` file: the file **cannot be parsed**, therefore cannot run. |
| **A13** | `node server/scripts/verify-freecash-rules.mjs` | `[FREECASH RULE VERIFIER] Starting checks...` … `✓ Rule 1 (No auto earnings)     → PASSED` / `✓ Rule 2 (Once daily check)      → PASSED` / `✓ Rule 3 (Notify changes)        → PASSED` / `✓ Rule 4 (Human approval queue)  → PASSED` / `[OK] All 4 operational rules verified (4/4 passed)`; `exit=0` | **Defect D3 reproduced: false compliance.** The verifier prints 4/4 PASSED / exit 0 on `freecash-daily-monitor.mjs` — a file `node --check` proved unparseable 1 second earlier. |
| **A14** | `schtasks /Query /FO CSV /NH \| grep -ic freecash`; `schtasks /Query /FO CSV /NH \| wc -l`; `hermes cron list` | `0` (`schtasks_exit=1` — grep found nothing); `278`; `No scheduled jobs.` / `Create one with 'hermes cron create ...' or the /cron command in chat.` (`cron_exit=0`) | **0 of 278 Windows tasks mention Free Cash; 0 Hermes cron jobs.** The routine is currently **unscheduled** — it has never run on a timer. |
| **A15** | `grep -n 'path/to/AgenticOS\|make_freecash_check' config/freecash-crontab`; `ls -la '/path/to/AgenticOS/scripts/make_freecash_check.py'` | `7:0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py >> /path/to/AgenticOS/logs/freecashioc_$(date +\%Y-\%m-\%d).log 2>&1`; `ls: cannot access '/path/to/AgenticOS/scripts/make_freecash_check.py': No such file or directory` | **Defect D4 reproduced.** The only shipped schedule definition points at a **placeholder path that does not exist**. |
| **A16** | `FREECASH_DATA_ROOT=<throwaway> python -c "…approval_queue._normalise_decider…"` (in `monitoring/freecash`) | `ACCEPTED 'hermes-agent' -> 'hermes-agent'`<br>`ACCEPTED 'Alice (operator)' -> 'Alice (operator)'`<br>`REFUSED  'system' -> refused: 'system' is not a human identity; …`<br>`REFUSED  'agent' -> refused: …`<br>`REFUSED  'routine' -> refused: …`<br>`NON_HUMAN_DECIDERS = ['agent', 'automation', 'bot', 'cron', 'machine', 'monitor', 'routine', 'scheduler', 'script', 'system']`<br>`count = 10`<br>`EXECUTION_STATE_NOT_EXECUTED = NOT_EXECUTED \| EXECUTION_ALLOWED = False \| NO_EXPIRY = None` | **Defect D7 reproduced.** The decider guard is a **denylist of ten literal words**, not an operator-editable allowlist, and **`hermes-agent` is ACCEPTED as a decider**. (Probe calls only the pure validator; it performed **no write** — no item existed and none was created.) |
| **A17** | `python` (venv) `-c "import sys,zoneinfo;print(sys.version);print(zoneinfo.ZoneInfo('Europe/Berlin'))"`; `py -3 -c "import sys;print(sys.version)"`; `py -3 -c "import zoneinfo;zoneinfo.ZoneInfo('Europe/Berlin')"` | `3.11.9 (tags/v3.11.9:de54cf5, Apr  2 2024, 10:12:12) [MSC v.1938 64 bit (AMD64)]` / `Europe/Berlin`<br>`3.14.7 (tags/v3.14.7:823f032, Aug  5 2026, 10:51:32) [MSC v.1944 64 bit (AMD64)]`<br>`zoneinfo._common.ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` | Interpreter of record **is** `…/hermes-agent/venv/Scripts/python` 3.11.9 and **has tzdata** → `Europe/Berlin` resolves and the R2 day key is a true Berlin calendar day. `py -3` is 3.14.7 and **lacks tzdata** → the routine degrades to `system-local` and reports `MONITOR_DEGRADED`. **Always the venv python, always with a forward-slash native path.** |
| **A18** | `find data/freecash-monitor -type f \| sort \| xargs sha256sum` **(BEFORE, full root)** + `sha256sum` of that manifest | 12 files; `last-run.json` `a287a902…3bf9`, `alerts.jsonl` `1b9c7c07…99a8`, `notified-keys.json` `0f28d569…e9dd`, `operator-state.json` `be8becc3…a59c`, `snapshots/2026-10-01.json` `bad8f35e…5e23`, all three `.lock` files `e3b0c442…b855` (zero bytes)<br>manifest sha256 = `9822cc71aed16958c8cdf4099b9f67f640eb6af094aaa72d630f924d4fb6e87e` | Full-root pre-work baseline for the byte-identity proof in §7. |
| **A19** | XML well-formedness probe over every `docs/free-cash-monitor-routine/**/*.xml` (10 files) + raw-`&` scan | 9 × `raw_ampersands=0  PARSE OK` (incl. **both** `DECISION-V2-*.xml`)<br>1 × `raw_ampersands=0  PARSE FAIL ParseError: encoding specified in XML declaration is incorrect: line 1, column 30` — `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/scheduler/evidence/reference-real-task-export-cua-driver-serve.xml` | **The "DECISION-V2 XMLs fail XML parse (raw `&` in `<Arguments>`)" claim is NOT REPRODUCED.** Both DECISION-V2 files use proper `&gt;`/`&amp;` entities (`DECISION-V2-FreeCash-Daily-Monitor.xml:96`) and parse clean. One *other* file fails, for a different reason (declared encoding vs. actual bytes), and it is a captured vendor export, not a task to be registered. See **D11**. |

---

## 1. The 4 rules, restated as binding contracts

| # | Title | What the routine MUST do | What the routine MUST NEVER do |
|---|---|---|---|
| **R1** | **zero automated earning/withdrawal actions, read-only transport only** | Use only an allowlisted read transport. Refuse every non-allowlisted verb, host, path, body and unknown keyword *before* a socket is opened. | Claim, complete, withdraw, redeem, transfer, deposit, bet, spin, or "prepare then execute" any earning action. |
| **R2** | **exactly one status read per Europe/Berlin calendar day** | Derive the day key from `Europe/Berlin`, consume it with one atomic exclusive-create lock, then read. A duplicate run performs **no read at all**. | Read status twice on the same Berlin day. Re-check, back-fill a missed day, or auto-retry a failed day. |
| **R3** | **notify exactly once on earnings or account-status change** | Load the **prior** snapshot first, compare four fields exactly (integer cents / exact string), compute a dedupe key, record the key **before** dispatch, notify at most once per distinct change. `OK_NO_CHANGE` is **log-only**. | Notify twice for the same change on the same day; notify on "no change"; treat a degraded/null reading as a change. |
| **R4** | **human approval before ANY external action; no execution path may exist** | Enqueue a `PENDING` handle for a human, with `execution_state` frozen at `NOT_EXECUTED`, `expires_at_utc` frozen at `null`, and `execution_allowed_by_this_routine` frozen at `false`. | Contain *any* code that reads an `APPROVED` status and acts, or that arms an item (expiry, retry, watchdog, scheduler). |

---

## 2. The operational routine, numbered

### 2.0 Trigger time

| Job | Canonical entry point | Trigger (operator-local, Europe/Berlin) | Rationale |
|---|---|---|---|
| **Task A — daily status read** | `monitoring/freecash/run_daily_check.py` | **09:00 daily** (`<StartBoundary>2026-10-02T09:00:00</StartBoundary>`, already drafted at `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/scheduler/DECISION-V2-FreeCash-Daily-Monitor.xml:86`) | Fires after the operator has plausibly entered the day's figures; leaves the whole afternoon free for the human approval step. |
| **Task B — same-day coverage alarm** | `monitoring/freecash/watchdog.py` | **21:30 daily** (`…DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml:64`) | Twelve and a half hours after Task A: a silently skipped run becomes visible while the operator can still act. |

Both XMLs are **drafts on disk only**: A14 proves **0 of 278** Windows tasks and **0** Hermes cron jobs exist, so no schedule is live today.

### 2.1 Ordered routine — one run of Task A

Every step below is bound to a line of shipped code that this pass read.

1. **Start under the pinned interpreter.** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` (3.11.9, **has tzdata** — A17), invoked with a **forward-slash native path** (MSYS path translation is off on this host). `py -3` (3.14.7) is **forbidden** for this job: it lacks tzdata, `ZoneInfo('Europe/Berlin')` raises, and the run degrades to a local day key (A17).
2. **Create the state layout** if absent — `paths.ensure_layout()` (`run_daily_check.py:278` → `paths.py:99-107`). Idempotent; creates directories only.
3. **Install the process-wide network guard** — `readonly_client.install_audit_guard()` (`run_daily_check.py:279`; hook at `readonly_client.py:146-176`). From here on, any `socket.connect` / `socket.getaddrinfo` aimed off the loopback allowlist raises `ForbiddenWriteError` at the OS-event layer.
4. **Read the clock and derive the day key** — `gate.day_key(now)` (`run_daily_check.py:308` → `gate.py:96-102`), `now.astimezone(ZoneInfo("Europe/Berlin")).date().isoformat()`.
5. **Acquire the day lock — atomic exclusive create.** `gate.acquire_day_lock(day)` (`run_daily_check.py:309` → `gate.py:119-135`) performs a single `os.open(lock, O_CREAT | O_EXCL | O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`. The **filename is the day key**; the file is zero bytes; there is no read-then-write window to race.
6. **If the lock was not acquired → stop, having read nothing.** Emit exactly one `SKIP_DUPLICATE_DAY` line to `alerts/alerts.jsonl`, print `SKIP_DUPLICATE_DAY <day>`, **exit 0** (`run_daily_check.py:310-321`). No read, no snapshot, no ledger write. *Today (2026-10-01) is in exactly this state — A4.*
7. **Record the attempt** — `gate.record_attempt(day, …)` (`run_daily_check.py:329` → `gate.py:179-185`). The returned ledger **must** be kept (the in-code comment at `run_daily_check.py:326-328` documents a real past bug here).
8. **Emit in-band missed-day lines, never back-filling** — `gate.missed_days()` (`run_daily_check.py:331-347` → `gate.py:208-225`) yields days **strictly between** the last success and today, excluding both endpoints. A missed day is reported, never re-read.
9. **Degrade honestly.** If the configured zone is unresolvable, log `MONITOR_DEGRADED` with the actual offset and print `WARNING timezone_unavailable …` (`run_daily_check.py:357-369`).
10. **Read-only fetch (R1 transport).** `read_source(...)` (`run_daily_check.py:64-84`, called at `:372`). Default source `operator_state` reads `state/operator-state.json` — a **local file**, no socket. The alternative `metrics_http` source goes through `readonly_client.read_status_source()`: `GET /api/v1/status/metrics` then `HEAD /api/v1/status` on **loopback only** (`readonly_client.py:194-239`, allowlists at `:39-49`).
11. **On a read failure → no second attempt.** Catch `ReadError` / `ForbiddenWriteError` / `MetricError`, notify `RUN_FAILED`, record outcome `READ_FAILED`, print `RUN_FAILED <day> reason=…`, **exit 5** (`run_daily_check.py:371-393`). The lock stays consumed; there is no automatic re-run.
12. **Load the PRIOR snapshot FIRST** — `changedetect.load_prior_snapshot(day)` at `run_daily_check.py:402`, **before** the new snapshot is built (`:403`) and written (`:405`). This ordering is the whole point: the comparison can never be against itself.
13. **Build and save the new snapshot.** `changedetect.save_snapshot()` (`:405` → `changedetect.py:183-189`) **refuses to overwrite** an existing `<day>.json` (`if path.exists(): return path, False`). One immutable snapshot per day.
14. **Change detection against the prior snapshot (R3).** `changedetect.compare(prior, snapshot)` (`:404` → `changedetect.py:226-276`) compares exactly four fields — `account_status` (`STATUS_CHANGED`), `earnings_total_cents` (`EARNINGS_CHANGED`), `balance_cents` (`BALANCE_CHANGED`), `pending_cents` (`EARNINGS_CHANGED`/subtype `pending`) — by **exact** inequality, integer cents (`changedetect.py:34-39`). Either side carrying no data ⇒ `baseline: True`, zero changes, no alarm (`:235-241`).
15. **Single deduped notification.** Per change: `dedupe_key = sha256(day_key | change_type | field | old_value | new_value)` (`changedetect.py:214-216`). `notify.notify_change` first checks `key_seen(key)`; if seen it writes **one log line only** and returns `DEDUPED` (`notify.py:272-281`). Otherwise `dispatch()` writes the key into `notified-keys.json` **before** the send attempt (`notify.py:224`), then sends at most **2** attempts, then gives up loudly with `DELIVERY_FAILED` + `MONITOR_DEGRADED` and never retries that key (`notify.py:228-261`). >5 changes coalesce into **one** summary notification (`run_daily_check.py:176, 207-213`). `OK_NO_CHANGE` is log-only by construction (`notify.py:91-99`).
16. **Approval-queue write (R4).** For each notified change, `approval_queue.enqueue(...)` (`run_daily_check.py:151` → `approval_queue.py:137-143`) appends one `PENDING` item to `approvals/pending.json` via atomic temp-file + `os.replace`. The item carries `expires_at_utc: null`, `execution_state: "NOT_EXECUTED"`, `execution_allowed_by_this_routine: false` as **constants, not parameters** (`approval_queue.py:118-134`). An `APPROVAL_PENDING` line with the handle is logged. Enqueueing is a notification with a handle — **not** a permission.
17. **Reminders, never decisions.** `nag_pending(...)` (`run_daily_check.py:217-245`) re-mentions an item at most once per 7 days (`approval_queue.py:59, 221-231`). It cannot change a status.
18. **Retention** — `changedetect.prune_old_artifacts(now)` (`:444` → `changedetect.py:298-325`): snapshots 90 days, `run-*.log` 30 days. **The alert log and decision trail are never pruned.**
19. **Record the outcome and print the line** — `gate.record_outcome(...)` (`:446`) then `RUN_OK <day> outcome=… source=… snapshot=… changes=… notifications=… approvals=… reminders=… lock=…` (`:447-463`), **exit 0**.

Routine (Task B, separate job, separate cron line — never the same process):

20. **Watchdog reads the ledger, opens no socket, and exits 0 always.** `watchdog.py` does not import `readonly_client` (`watchdog.py:9`). It never writes the ledger, never creates or clears a lock, never writes a snapshot, never touches the approval queue (`watchdog.py:7-17`). Its only writes are the alarm line and the dedupe index that stops the same alarm being sent twice in one evening (`watchdog.py:79-91`).

### 2.2 Day-key / lock / read ordering — stated explicitly

The task requires the **reading to be taken BEFORE the lock is acquired**. That requirement has two distinct referents and they must not be conflated:

| Ordering | Position | Verdict |
|---|---|---|
| **(a) The clock is read → the day key is computed → the lock is then acquired.** | `run_daily_check.py:308` (`gate.day_key`) strictly precedes `:309` (`gate.acquire_day_lock`) | **Implemented. This is the required ordering.** The *reading of the clock* — the only input from which the day key can be derived — happens before the lock exists, so the lock is named by a value the run already holds. |
| **(b) The lock is acquired → only then may the status be read.** | `:309-321` (lock) strictly precedes `:372` (status read) | **Mandatory, and also implemented.** Reading status before the lock would create a read-then-lock window in which two concurrent invocations could both read the same day — a direct R2 breach. It is refused by construction: `_run` returns at `:321` on a duplicate and never reaches `:372`. |
| **(c) The status reading is taken before the lock is acquired.** | nowhere | **Forbidden.** This ordering would make R2 unenforceable. Recorded here so the ambiguity is closed on the record rather than papered over. |

**Net: the day key is read before the lock (a); the status is read after the lock (b); (c) must never exist.**

### 2.3 Exit codes (the routine's own contract)

| Code | Task A — `run_daily_check.py` | Task B — `watchdog.py` | `verify_readonly.py` | `approval_queue.py` CLI |
|---|---|---|---|---|
| `0` | ran, **or** the day was already consumed (a duplicate is not an error) — `run_daily_check.py:23-29` | **always** (`watchdog.py:16, 104-108`) | no unexempted forbidden token (`verify_readonly.py:8`) | recorded, or `list` printed |
| `1` | — | — | ≥1 forbidden token found → **build must fail** (`verify_readonly.py:9`) | — (suite-level) |
| `2` | usage error — `run_daily_check.py:470-472` | — | a scan target did not exist — *absence of evidence is not a pass* (`verify_readonly.py:10`) | `REFUSED` (empty `--note`) — `approval_queue.py:289-291` |
| `3` | `--force-recheck` refused — a second status read in one day is forbidden (`run_daily_check.py:27, 281-297`) | — | — | no such `approval_id` (`approval_queue.py:286-288`) |
| `4` | — | — | — | `NotHumanError` — decider is not a human identity (`approval_queue.py:283-285`) |
| `5` | the status read failed; the day lock stays consumed, no automatic re-run (`run_daily_check.py:28, 391-393`) | — | — | — |

---

## 3. Enforcement mechanism per rule — code-level

| Rule | Mechanism | Code (read this pass) | Status |
|---|---|---|---|
| **R1 — zero automated earning/withdrawal actions, read-only transport only** | **Allowlist of read verbs** (fail-closed): `ALLOWED_METHODS = frozenset({"GET","HEAD"})`; anything else → `ForbiddenWriteError` **before** `_transport` is reached. Layered with a **loopback-only host allowlist**, a **2-entry compiled-regex path allowlist**, a **body-keyword rejection list**, a **rejection of any unknown keyword**, and a **`sys.addaudithook` process guard** that aborts an off-loopback `socket.connect`/`getaddrinfo`. Exactly **one** socket site exists in the whole routine. Statically gated by six forbidden token classes. | `readonly_client.py:34` (single socket import), `:39` (verbs), `:41` (hosts), `:43-49` (paths), `:52` (body kwargs), `:110-140` (`request` guard chain), `:76-107` (`_transport`, the only socket), `:146-176` (audit hook); `readonly_client.py:60` `PROVIDER_ENDPOINT_UNKNOWN`; `verify_readonly.py:41-88` (six token classes); `run_daily_check.py:279` (guard installed every run) | **ENFORCED.** A11: `forbidden=0 exempt=28`, exit 0. A12/A13 expose a *parallel* file with a provider URL, but the canonical package contains no provider egress and no write verb. |
| **R2 — exactly one status read per Europe/Berlin calendar day** | **Day lock** — one atomic `os.open(… O_CREAT \| O_EXCL \| O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`; the filename *is* the day key; zero-byte file; the ledger is explicitly **never** the gate, so a corrupt ledger cannot cause a second read. Day key resolved through `zoneinfo.ZoneInfo("Europe/Berlin")`. Fails closed: any lock error means "do not read". `--force-recheck` is accepted only to be refused (exit 3) and the refusal is audited to `logs/forced-recheck-requests.jsonl`. | `gate.py:5-17` (design), `:26` `DEFAULT_TZ`, `:56-82` `resolve_tz`, `:96-102` `day_key`, `:115-135` `lock_path`/`acquire_day_lock`, `:11-13` (ledger is not the gate), `:208-225` `missed_days` (never back-fills); `run_daily_check.py:308-321`; `paths.py:16`/`:55-56` layout | **ENFORCED.** A4: today's lock exists, so a second run today can only emit `SKIP_DUPLICATE_DAY`; A10 shows `SKIP_DUPLICATE_DAY 2026-10-01` firing for real. A17 confirms the venv python resolves the Berlin zone (a `py -3` run would degrade the key — hence the pinned interpreter is part of the control). |
| **R3 — notify exactly once on earnings or account-status change** | **Dedupe key** — `sha256(day_key \| change_type \| field \| old_value \| new_value)`, persisted in `state/notified-keys.json`, written **before** the dispatch attempt so a crash can lose a message but never duplicate one. Comparison is exact-integer over four exhaustive fields against the **prior** snapshot, **loaded before** the new snapshot is written. `OK_NO_CHANGE` never dispatches. No relative/percentage threshold exists, so no change can be silently swallowed. | `changedetect.py:19-25` (key contract), `:34-39` (`COMPARED_FIELDS`), `:197-208` (`load_prior_snapshot`), `:214-216` (`dedupe_key`), `:226-276` (`compare`), `:183-189` (`save_snapshot` refuses overwrite); `notify.py:116-145` (`key_seen` / `record_notified_key`), `:123-124`, `:272-281` (DEDUPED path, one log line), `:91-99` (log-only no-change), `:220-261` (`dispatch`, 2 attempts max); `run_daily_check.py:402-405` (prior loaded first) | **ENFORCED as code.** Caveat measured this pass: **D9** — `operator-state.json` `records=0`, so in production no change can ever be *detected*, hence R3 has never had a chance to fire on real figures. The mechanism is sound; the input is empty. |
| **R4 — human approval before ANY external action; no execution path may exist** | **Approval queue with frozen `execution_state`.** `enqueue()` may only append; the frozen trio `execution_state = "NOT_EXECUTED"`, `execution_allowed_by_this_routine = False`, `expires_at_utc = None` are **module constants re-asserted after every `decide()`**, so a decision cannot arm an item. No expiry exists ⇒ the historical "expired, so execute" path cannot occur. Nothing anywhere in the routine reads an `APPROVED` status and acts. A non-human decider is refused. | `approval_queue.py:1-19` (contract), `:43-48` (frozen constants), `:52` (`ACTION_LABEL_FOR_HUMAN_REVIEW` = a label for a human, no code executes it), `:108-134` (`build_item`), `:137-143` (`enqueue` is the only writer), `:149-158`/`:161-201` (`_normalise_decider`/`decide`), `:179-182` (**re-assert frozen fields on decide**), `:55-57` (`NON_HUMAN_DECIDERS`); `run_daily_check.py:18-21` (module docstring: no execution path here at all) | **PARTIALLY ENFORCED — and the gap is a measured defect, not an assumption.** The frozen-state half is airtight. The *identity* half is not: A16 shows `hermes-agent` is **ACCEPTED** as a decider because the guard is a 10-word **denylist** (`approval_queue.py:55-57`), not an operator-editable allowlist (**D7**). Until D7 is fixed, R4 holds only against a decider who picks one of ten specific words. |

---

## 4. Pre-existing defects re-measured in this pass (with `file:line`)

| # | Defect | Citation | Re-measurement this pass |
|---|---|---|---|
| **D1** | **Inverted rule numbering in shipped docstrings** — `gate.py` calls R2 "R1"; `readonly_client.py` calls R1 "R2". Any reader quoting those headers states the opposite of the operator's rules. | `monitoring/freecash/gate.py:1`; `monitoring/freecash/readonly_client.py:1` | Read directly, both verbatim in the §0 preamble. **REPRODUCED.** |
| **D2** | **`.mjs` file is unparseable** — TypeScript annotation `: boolean` in a `.mjs` at line 41. | `server/scripts/freecash-daily-monitor.mjs:41` | `node --check` → `SyntaxError: Unexpected token ':'` at `:41`, Node v24.20.0. **REPRODUCED (A12).** |
| **D3** | **False compliance verifier** — prints 4/4 PASSED, exit 0, on a file that cannot be parsed. `checkRule2` greps the broken `.mjs`; `checkRule1` greps a `.ts` adapter; **neither scans `monitoring/freecash/`** — the actual routine. R3's check is `!content.includes('checkForChanges') \|\| content.includes('.log(')`, i.e. true for almost any file; R4's ends in `\|\| content.includes('approval-request.json')`. These are the "checks". | `server/scripts/verify-freecash-rules.mjs:22-25` (Rule 2 reads `../scripts/freecash-daily-monitor.mjs`), `:17-21` (Rule 1 reads `../src/adapters/freecashMonitorAdapter.ts`), `:27-33` (Rule 3 tautology), `:35-40` (Rule 4 tautology) | `node server/scripts/verify-freecash-rules.mjs` → `[OK] All 4 operational rules verified (4/4 passed)`, exit 0 — one second after A12 proved the target unparseable. **REPRODUCED (A13).** |
| **D4** | **Shipped schedule points at a placeholder path** — the only crontab in the repo targets a path that does not exist, and a legacy script. | `config/freecash-crontab:7` | `ls -la '/path/to/AgenticOS/scripts/make_freecash_check.py'` → `No such file or directory`. **REPRODUCED (A15).** |
| **D5** | **A live execution path exists in a parallel implementation** — `prepare_actions()` builds `{"type":"withdraw"}`, `prompt_approve()` y/n prompts it, and `run_action()` returns `"Executed {name}."` on the "approved" set, writing an execution log. This is exactly the shape R1 and R4 forbid, and it is the target of D4's crontab. **I did not run it.** | `scripts/make_freecash_check.py:18-21` (withdraw action), `:24-46` (`prompt_approve`), `:49-52` (`run_action`, `msg = f"Executed {action['name']}."`), `:83-88` (executes every approved action) | Read directly. `config/freecash-crontab:7` names it as the daily job. **PRESENT (not executed by this pass).** |
| **D6** | **The routine is unscheduled** — nothing runs it. | `schtasks` / `hermes cron` | `schtasks /Query /FO CSV /NH \| grep -ic freecash` → `0` of `278`; `hermes cron list` → `No scheduled jobs.` **REPRODUCED (A14).** |
| **D7** | **R4 decider guard is a denylist, not an allowlist, and `hermes-agent` is ACCEPTED** — ten literal words are refused; every other string, including a machine handle, is accepted as a human identity. The module docstring claims "a machine may not sign a decision". | `monitoring/freecash/approval_queue.py:55-57` (`NON_HUMAN_DECIDERS`), `:149-158` (`_normalise_decider`) | Probe: `ACCEPTED 'hermes-agent' -> 'hermes-agent'`; `count = 10`. **REPRODUCED (A16).** |
| **D8** | **A day with no reading is booked as a SUCCESS day, and the watchdog then reports OK.** `MONITOR_DEGRADED` is a member of `SUCCESS_OUTCOMES`; `record_outcome` advances `last_success_day` for it; the watchdog's `covered` test is `attempt == today and outcome in SUCCESS_OUTCOMES`. Net: a null snapshot silences the missed-day alarm. | `gate.py:32-41` (set), **`gate.py:39` (`"MONITOR_DEGRADED"` inside it)**, `gate.py:188-202` (**`:198-200` advances `last_success_day`**), `watchdog.py:33` (`covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES`), `watchdog.py:58-64` (`WATCHDOG_OK` printed) | Live production proof: A6 (`last_success_day=2026-10-01` on a null reading) + A5 (`data_available:false`). Independent proof from my own pinned-root suite run (A10): twelve consecutive `RUN_OK … outcome=MONITOR_DEGRADED` lines each immediately followed by `WATCHDOG_OK … outcome=MONITOR_DEGRADED`. **REPRODUCED, twice, on two different roots.** |
| **D9** | **No reading has ever been entered, so no change can ever be detected.** `operator-state.json` `records == 0`; the only snapshot source is `operator_entered`; `snapshots/` holds three files (`2026-09-20`, `2026-09-30`, `2026-10-01`). R3 is therefore untested in production by construction. | `data/freecash-monitor/state/operator-state.json` (`"records": []`), `data/freecash-monitor/snapshots/2026-10-01.json` (`source.kind = operator_entered`), `readonly_client.py:43-49` (no provider path allowlisted), `readonly_client.py:60` (`PROVIDER_ENDPOINT_UNKNOWN`) | `records= 0` (A7). **REPRODUCED.** |
| **D10** | **The R4 write path has never produced an artefact.** `approvals/` exists; `pending.json` does not. Consequence: the human-approval queue — the mechanism R4 rests on — has zero operational history. | `paths.py:19` (layout), `paths.py:91-92` (`pending_path`), `approval_queue.py:137-143` | `ls -la …/approvals/` → `total 0`; `pending.json` → `No such file or directory`. **REPRODUCED (A9).** |
| **D11** | **Claim NOT REPRODUCED: "DECISION-V2 scheduler XMLs fail XML parse (raw `&` in `<Arguments>`)".** Both DECISION-V2 XMLs are well-formed; their `<Arguments>` escapes `&` correctly as `&gt;&amp;`. One *other* file does fail, for an unrelated reason and it is a captured vendor export, not a task to register. Recording this honestly matters: a "known defect" that does not reproduce is itself a risk to the plan. | **Clean:** `…/DELEGATION-2026-10-01/scheduler/DECISION-V2-FreeCash-Daily-Monitor.xml:96` → `<Arguments>… 2&gt;&amp;1</Arguments>`; same in `…-Missed-Day-Watchdog.xml:74`. **Actually broken:** `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/scheduler/evidence/reference-real-task-export-cua-driver-serve.xml` | 10-file probe: 9 × `raw_ampersands=0  PARSE OK` (incl. both DECISION-V2); 1 × `ParseError: encoding specified in XML declaration is incorrect: line 1, column 30`. **NOT REPRODUCED (A19).** |
| **D12** | **No provider read path exists at all.** `ALLOWED_PATHS` holds two loopback regexes; the provider read contract is literally the string `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`. No provider/network client has ever produced a live reading. | `readonly_client.py:43-49` (the two-entry allowlist), `:60` (the placeholder), `:16-27` (W3/W4 absent by design) | Read directly; A5/A7 show the only source kind ever recorded is `operator_entered`. **REPRODUCED.** |
| **D13** | **A parallel `.mjs` implementation hard-codes a provider endpoint and a webhook.** Not executed by this pass, and not reachable while D2 stands (the file cannot parse) — but it exists as a latent provider-egress path. | `server/scripts/freecash-daily-monitor.mjs:31` (`STATUS_API_URL: … 'https://api.freecash.com/v1/status'`), `:29` (`NOTIFICATION_WEBHOOK`), `:33` (`APPROVAL_INTERFACE: './data/freecash-approval-request.json'`), `:41` (the syntax error) | Read directly; A12 proves the parse failure that currently neutralises it. **PRESENT (not executed).** |

---

## 5. One implementation per job

### 5.1 Canonical entry points (the only three that may be scheduled or used)

| Job | Canonical file | Declared as the entry point |
|---|---|---|
| **Daily status read (Task A)** | `monitoring/freecash/run_daily_check.py` | `run_daily_check.py:1` — *"the routine's single entry point"*; invoked as `python monitoring/freecash/run_daily_check.py --source operator_state` by the drafted task (`DECISION-V2-FreeCash-Daily-Monitor.xml:96`) |
| **Same-day coverage alarm (Task B)** | `monitoring/freecash/watchdog.py` | `watchdog.py:1`; invoked by the drafted task (`DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml:74`) |
| **Human decision CLI (never scheduled)** | `monitoring/freecash/approval_queue.py` | `approval_queue.py:21-26` — *"CLI (human only)"*; `decide` / `list` |

Support modules with **no independent entry point**: `gate.py`, `changedetect.py`, `notify.py`, `operator_state.py`, `paths.py`, `readonly_client.py`, `verify_readonly.py` (CI gate), `tests/run_all.py` (test runner).

### 5.2 Dead / parallel implementations found (measured — not to be scheduled, and not to be deleted by this pass)

| # | Path | Why it is dead or parallel |
|---|---|---|
| 1 | `server/scripts/freecash-daily-monitor.mjs` (326 lines) | **Cannot parse** (D2/D13). Node/cron implementation with a provider URL, a webhook and a `data/freecash-approval-request.json` approval file — a parallel R1–R4 implementation that can never run. |
| 2 | `server/scripts/verify-freecash-rules.mjs` | The false-compliance verifier (D3) that certifies #1. |
| 3 | `scripts/make_freecash_check.py` (99 lines) | Legacy daily check with real `withdraw` + `run_action` execution (D5); named by `config/freecash-crontab:7` (D4). |
| 4 | `config/freecash-crontab` | Points at a non-existent placeholder path (D4). |
| 5 | `.hermes/scratch/freecash/pkg/` | Full parallel copy of the routine (`run_daily_check.py`, `watchdog.py`, `approval_queue.py`, `notify.py`, `paths.py`, `verify_readonly.py`, `tests/`). |
| 6 | `.hermes/scratch/freecash/pkg_swap/` | Second full parallel copy. |
| 7 | `.hermes/scratch/freecash/pkg_violate/` | Third full parallel copy — name indicates deliberately rule-violating mutants. |
| 8 | `.hermes/scratch/freecash/{case-a-nodata,case-b-runfail,locktest-native,notifytest,tztest-native,wraptest}/` | Six scratch **runtime roots**, each with its own `state/last-run.json` + `alerts/alerts.jsonl`. Not production, easily mistaken for it. |
| 9 | `docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/evidence/self-test/*/pkg/` | 11 mutant copies (control + m0-syntax-annotation, m1a, m1b, m2a, m2b, m3a, m3b, m4a, m4b, m4c). |
| 10 | `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/verifier/mutants/*/pkg/` | 11 more mutant copies incl. `canonical-control` (r1-a, r1-b, r2-a, r2-b, r3-a, r3-b, r4-a, r4-b). |
| 11 | `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/delivery/proposed/approval_queue.py` | A **proposed** variant sitting outside the package — must not be imported or scheduled. |
| 12 | 5 parallel scheduler XML pairs across delegations: `DELEGATION-2026-09-21/`, `DELEGATION-2026-09-30/scheduler/`, `DELEGATION-2026-10-01/scheduler/` (both `FreeCash-Daily-Monitor*.xml` **and** `DECISION-V2-*`), `DELEGATION-2026-10-01-R2/scheduler/FreeCash-Daily-Monitor-R2.xml` | Ten XMLs, one canonical decision (`SCHEDULER-DECISION-V2.md`). Registering the wrong one would double-schedule Task A. |
| 13 | 8 planning documents under `.hermes/plans/` (`*free-cash-finance-automation*.md`, `freecash-monitor/{WIRING-PLAN,research/PROVIDER-RESEARCH}.md`) | Superseded design narrative. |

**Rule adopted:** only §5.1 may be scheduled, imported or executed. Everything in §5.2 is evidence or history — **frozen, not deleted** (this pass is additive only).

---

## 6. First 90 minutes — execution order

**Step 1 is a single sitting.** The whole remediation is one uninterrupted 90-minute block by one human at the keyboard (`Block S`, T+0:00 → T+1:30). It is *not* split, *not* delegated mid-flight, and *not* interleaved with other work: three of the defects below (D7, D8, D9) interact, and a split session will fix one and silently re-break another. **If the sitting is interrupted before step 12, stop — do not proceed to §6 step 13 or beyond.** Everything before step 12 is read-only or additive and therefore safe to abandon; steps 13+ are the ones that write.

| Step | Minute | Action (single sitting, in this order) | Why this order | Gate to proceed |
|---|---|---|---|---|
| **1** | **T+0:00 → T+1:30** | **THE SITTING.** Confirm the workspace and clock (`git rev-parse --short HEAD` = `8f7463a`; `date` = 2026-10-01), then execute steps 2–12 below **inside this one block**, in order, without leaving the desk. | A remediation split across sittings loses the measured pre-state (D8/D9 interact); the interaction is only visible while both are in hand. | Sitting begins with a recorded start time. |
| 2 | T+0:02 | Re-take the production-root baseline: `find data/freecash-monitor -type f \| sort \| xargs sha256sum` and keep the manifest. | Every later step must be provably non-mutating (A18 is the template). | Manifest captured. |
| 3 | T+0:05 | Confirm no schedule exists before touching anything: `schtasks /Query /FO CSV /NH \| grep -ic freecash` (expect `0`) and `hermes cron list` (expect `No scheduled jobs.`). | Fixing an unscheduled routine is safe; discovering a live job mid-fix is not. | Both match A14. |
| 4 | T+0:08 | Capture the current live state verbatim: `cat state/last-run.json`, `cat snapshots/2026-10-01.json`, `ls -1 state/day-locks/`, `wc -l alerts/alerts.jsonl`. | These are the numbers D8 is judged against; they change the moment anyone runs the routine. | Output matches A4/A5/A6/A8. |
| 5 | **T+0:12** | **DECISION (human, recorded): what to do about D8 → `gate.py:39` + `gate.py:198-200` + `watchdog.py:33`.** `MONITOR_DEGRADED` must stop counting as a success day, so a null reading re-arms the missed-day alarm instead of silencing it. | This is the single highest-impact defect: it is *why* 12 consecutive no-data days read as OK. It is a **behaviour change to production state semantics** and is therefore an operator decision, explicitly **not** taken by this pass. | A written decision naming the chosen semantics. |
| 6 | T+0:15 | Re-measure the whole defect set before changing anything: `node --check server/scripts/freecash-daily-monitor.mjs`; `node server/scripts/verify-freecash-rules.mjs`; `grep -n 'path/to/AgenticOS' config/freecash-crontab`; the A16 decider probe; the A19 XML probe. | A fix is only a fix against a re-measured baseline. A19 in particular retires one claimed defect (D11) before anyone "fixes" a non-bug. | Each result matches §4, or the divergence is written down. |
| 7 | T+0:22 | Re-run the R1 static gate and the offline suite against a **throwaway** root only: `verify_readonly.py` (expect `forbidden=0`, exit 0) and `FREECASH_DATA_ROOT=<Temp>/…/root run_all.py` (expect `tests=52 failures=0 errors=0 skipped=0`). | Establishes a green starting line for the canonical package before any edit. **Never** point either at the production root. | Green. |
| 8 | T+0:28 | **DECISION (human, recorded) on D7 → `approval_queue.py:55-57`:** replace the ten-word denylist with an operator-editable **allowlist** of permitted decider identities. Until then, R4's identity half is not enforced and `hermes-agent` can sign a decision. | R4 is the rule with an actual measured hole; the fix is small but the *semantics* (who may sign) is a human call. | A written decision naming the allowlist's owner and file. |
| 9 | T+0:35 | **DECISION (human, recorded) on D11 and the scheduler choice:** record that the DECISION-V2 XMLs **do** parse, and confirm `DECISION-V2-FreeCash-Daily-Monitor.xml` + `…-Missed-Day-Watchdog.xml` are the canonical pair (trigger 09:00 / 21:30, §2.0). Fix the encoding of the one genuinely broken reference export only if it is needed. | Prevents a "fix" for a defect that is not there, and prevents registering a wrong XML from §5.2 item 12. | Decision recorded; XML pair named. |
| 10 | T+0:45 | **Quarantine by declaration, not deletion:** write the §5.2 list into the plan's successor as the frozen set. Do not delete, move or rename anything. | Deletion is out of scope (additive-only); a declared frozen set is sufficient to prevent mis-scheduling. | §5.2 list acknowledged. |
| 11 | T+0:55 | **DECISION (human, recorded) on the interpreter:** the scheduled command must be `…\hermes-agent\venv\Scripts\python.exe` (3.11.9, **has tzdata** — A17), never `py -3` (3.14.7, **no tzdata** → local day key). | A wrong interpreter silently breaks the R2 day key at midnight boundaries — invisible until it costs a day. | Decision recorded; §2.1 step 1 quoted. |
| 12 | **T+1:05** | **SITTING CHECKPOINT.** Re-read §1–§5 with the decisions from steps 5, 8, 9, 11 in hand. If any decision is still open, **stop here.** | Everything to this point is read-only or documentation. Stopping now costs nothing and mutates nothing. | All four decisions closed → continue. |
| 13 | *(post-sitting)* | Apply only the §4 fixes that were decided: D8 (`gate.py:39` + `:198-200`, `watchdog.py:33`), D7 (`approval_queue.py:55-57`), D1 (docstring numbering in `gate.py:1` / `readonly_client.py:1`), D4/D5 (retire the placeholder crontab's target and the legacy execution path). | One defect, one change, one re-measurement. | Each fix re-measured by its own A-row. |
| 14 | *(post-sitting)* | Fix D3 so the rule verifier actually scans `monitoring/freecash/` — and make it **fail** on an unparseable target. | The false-compliance verifier is why D2 shipped. | `verify-freecash-rules.mjs` fails on a deliberately unparseable fixture. |
| 15 | *(post-sitting)* | **First real R2 test with data:** have the operator enter one record into `operator-state.json` `records` (via the documented `how_to` at `operator-state.json`), run Task A once under the pinned interpreter, and confirm the `RUN_OK … outcome=` line is **not** `MONITOR_DEGRADED`. | D9 means R3/R4 have never executed on real figures; this is the first genuine reading the routine will ever see. | A non-degraded outcome, and a second entry that produces exactly one `EARNINGS_CHANGED`. |
| 16 | *(post-sitting)* | **Only then** register the two scheduled tasks, and immediately re-run `schtasks /Query /FO CSV /NH \| grep -ic freecash` (expect `2`) plus `hermes cron list`. | Scheduling an unverified routine only automates the defect. | 2 tasks visible; no duplicate from §5.2 item 12. |
| 17 | *(post-sitting)* | Record the production-root manifest again and diff against step 2. | The change must be exactly the intended one. | Diff is exactly the intended files. |

---

## 7. Production-root byte-identity proof

**Hashes taken before this pass** (A3/A18) and **after** this pass:

| File | sha256 BEFORE (this pass) | sha256 AFTER (this pass) |
|---|---|---|
| `data/freecash-monitor/state/last-run.json` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` |
| `data/freecash-monitor/alerts/alerts.jsonl` | `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` | `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` |
| full-root manifest (12 files) | `9822cc71aed16958c8cdf4099b9f67f640eb6af094aaa72d630f924d4fb6e87e` | `9822cc71aed16958c8cdf4099b9f67f640eb6af094aaa72d630f924d4fb6e87e` |

**Production-root manifest, measured AFTER all work in this pass** (`find data/freecash-monitor -type f | sort | xargs sha256sum` → 12 files, byte-for-byte the BEFORE set):

```
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl
94c8c98cd89af33f704fa2356b781c563dc66abea44164f26925e8a1f6b691f3 *data/freecash-monitor/logs/task-a.log
ec4eab60fe748d867172eb81974ad2474ee1b09747f2cc57b93becaa35df3d67 *data/freecash-monitor/logs/task-b-watchdog.log
965e1132078d8739ee445e5c36cdfc9523825c436d59a82d92e38bf71706d6e5 *data/freecash-monitor/snapshots/2026-09-20.json
804b5e435a64fc6fe67ee1b904608d2745b3f9762a85dc6d867231df5a16bc4b *data/freecash-monitor/snapshots/2026-09-30.json
bad8f35efc334ac4506b6bd42d79ff95a683e8bffa38afbf485331ebe5a05e23 *data/freecash-monitor/snapshots/2026-10-01.json
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *data/freecash-monitor/state/day-locks/2026-09-20.lock
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *data/freecash-monitor/state/day-locks/2026-09-30.lock
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *data/freecash-monitor/state/day-locks/2026-10-01.lock
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json
0f28d5699b30c6d7b48224f9fa6da26113938c66fafc99e16f391dbedd60e9dd *data/freecash-monitor/state/notified-keys.json
be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c *data/freecash-monitor/state/operator-state.json
--- manifest sha256 AFTER ---
9822cc71aed16958c8cdf4099b9f67f640eb6af094aaa72d630f924d4fb6e87e */c/Users/cd-pr/AppData/Local/Temp/fc-wp-v11-20261001/manifest-after.txt
=== diff BEFORE vs AFTER ===
diff_exit=0
=== file count ===
12
```

**Result: BYTE-IDENTICAL.** `diff manifest-before.txt manifest-after.txt` → **`diff_exit=0`** (no differences); `last-run.json` and `alerts.jsonl` carry their exact BEFORE hashes; the root still holds 12 files. The production root was **not** written by this pass. This document lives under `docs/free-cash-monitor-routine/` and is additive; it is the only artefact created.

**Also re-measured AFTER the write, and unchanged:** `schtasks /Query /FO CSV /NH | grep -ic freecash` → `0` (of `278`); `hermes cron list` → `No scheduled jobs.`; `git rev-parse --short HEAD` → `8f7463a`; `git stash list | wc -l` → `0`; `git status --porcelain` → `868` (unchanged — `docs/free-cash-monitor-routine/` is fully untracked, so the whole directory counts as one `??` entry; `git check-ignore` → `exit 1`, i.e. the new file is **not** ignored).

**Artefact of record:** `docs/free-cash-monitor-routine/WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V11-2026-10-01.md`.
Measured sizes at each checkpoint in this pass: **50 674 bytes** when §7 was written; **53 497 bytes / 267 lines** after the AFTER block was appended (an additive edit to this same new file), sha256 `c828ae2667909131ace3e5edf9c7d3785f5973ad9b1863d1e6fe376f7dde06a9`.
This final size statement is itself inside the file, so any later edit shifts the byte count by the size of the edit and invalidates the digest. **The only authoritative size and hash are the ones you measure now:** `stat -c '%s' <path>` and `sha256sum <path>`. Do not quote the numbers above as current.

---

## 8. Constraints honoured — and how each was demonstrated

| Constraint | How it was honoured | Evidence |
|---|---|---|
| Additive only: create this file; edit/rename/delete **nothing** | `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V11-2026-10-01.md` did not exist before this pass (`ls` → `No such file or directory`) and every §5.2 path was left frozen. | pre-write `ls` probe (before write); §5.2 |
| No `git add/commit/stash/reset/restore/checkout/clean` | No git write command was issued. Only `git rev-parse`, `git status --porcelain` (read-only). | A2 |
| No scheduled task created or modified | `schtasks /Query` only, never `/Create`; unchanged `278` total / `0` freecash. | A14; re-verified after the write |
| No Hermes cron job created | `hermes cron list` read-only. | A14 |
| No provider network call | Every routine invocation used `FREECASH_DATA_ROOT` pinned to `%LOCALAPPDATA%\Temp\fc-wp-v11-20261001\root`; the default source is `operator_state` (a local file); `readonly_client` allows loopback only; no live `run_daily_check.py` was executed at all. | A10, A11, `readonly_client.py:41-49` |
| No credentials or secrets of any kind | Nothing read from or written to any vault, `.env`, token store or key; no auth header was constructed. | — |
| Production data root byte-identical before and after | §7. | A3, A18, §7 AFTER block |
| One implementation per job | Canonical set named in §5.1; dead/parallel set enumerated in §5.2. | §5 |

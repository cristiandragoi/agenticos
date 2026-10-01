# WORKFLOW PLAN — Free Cash Finance Automation, daily status-monitoring routine (R3)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463aa6931d57e12ec81b904b98cec04e932cf` · **Host:** Windows 11 (German-localised), git-bash (MSYS), non-elevated, hostname `CDInternational`
**Clock at first command of this session:** `Do,  1. Okt 2026 09:26:20` (Europe/Berlin, UTC+02:00); last command `Do,  1. Okt 2026 09:31:09`
**Subject:** the daily status-monitoring routine for Free Cash Finance Automation. Canonical implementation `D:/AgenticOS/monitoring/freecash/` (entry point `run_daily_check.py`; modules `gate.py`, `readonly_client.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `paths.py`, `operator_state.py`, `watchdog.py`, `verify_readonly.py`; `tests/run_all.py` = 52-test suite). State root `data/freecash-monitor/` (override `FREECASH_DATA_ROOT`).
**Baseline this plan does not contradict:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V10-2026-10-01.md` (36 807 B, mtime 2026-10-01 09:05) — its stage and option tables are the current baseline and are adopted, amended only where this pass measured something different (§0.1). Also read: `…-V9-ADDENDUM-2026-10-01-GATE-SCOPE-AND-FALSE-COMPLIANCE.md` and `DELEGATION-2026-10-01-R2/` (mutant harness, `workflow/`, `delivery/`).
**Evidence standard:** every factual claim in this document is backed by a command executed **in this session**, with its observed output and exit code quoted in §A. Facts taken from a document or an earlier session are labelled `inherited` and are never quoted as a PASS. A static grep over source files is not rule verification; a process exiting 0 is not success unless the day-key/lock artifact, the snapshot and any appended alert line are shown to exist.
**Footprint:** this file is the **only** file created. No existing file was moved, renamed, edited or deleted. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created or modified (`schtasks` was queried only). No credential, token, secret or password read or written. No provider financial endpoint contacted. Every routine invocation used a freshly created scratch root under `%LOCALAPPDATA%\Temp\freecash-r3-scratch-20261001\` with `FREECASH_DATA_ROOT`, `AGENTICOS_DATA_DIR` and `AGENT_TEAMS_DB_PATH` all pinned; the production root's hash pair and the `-newermt` set are **identical before and after** (§A18, §A19).

---

## 0. Live state re-verified in this session

| # | Command (executed here) | Observed | Exit |
|---|---|---|---|
| A1 | `date` · `git rev-parse --abbrev-ref HEAD` · `git rev-parse HEAD` · `hostname` | `Do,  1. Okt 2026 09:26:20` · `hermes-rescue-20260908` · `8f7463aa6931d57e12ec81b904b98cec04e932cf` · `CDInternational` | 0 |
| A2 | `git status --porcelain \| wc -l` | **868** uncommitted paths (parent statement said 862 — **corrected**) | 0 |
| A3 | `ls -la data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` (Sep 20 21:08) · `2026-09-30.lock` (Sep 30 21:01) · **`2026-10-01.lock` (Okt 1 08:53)** | 0 |
| A4 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, **`last_success_day=2026-10-01`**, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`**, `last_attempt_at_utc=2026-10-01T06:53:46Z` | 0 |
| A5 | `cat data/…/snapshots/2026-10-01.json` | `source.kind=operator_entered`, `read_ops=[]`, **`data_available:false`**, `degraded:true`, all four figures `null`, `raw_response_sha256=e3b0c442…b855` (sha256 of the empty string) | 0 |
| A6 | `wc -l data/…/alerts/alerts.jsonl` · python key/type census | **15 lines**; `Counter({'MISSED_DAY': 10, 'MONITOR_DEGRADED': 3, 'SKIP_DUPLICATE_DAY': 2})`; `dedupe_key` non-null on 10; keys = `['day_key','dedupe_key','event_id','event_type','message','observed','severity','ts_utc']`; **`has writer/attribution key = False`** | 0 |
| A7 | `ls -la data/…/approvals/` · `cat …/approvals/pending.json` | directory **empty**; `pending.json` **does not exist** (`No such file or directory`) — the queue document has never been created, which is stronger than "empty" | 1 |
| A8 | `cat data/…/state/operator-state.json` | `records: []` — **no operator reading has ever been entered** | 0 |
| A9 | `cat data/…/state/notified-keys.json` | 10 keys, every one `delivery: TOAST_OK`; newest `first_notified_at_utc=2026-09-30T19:02:05Z`; **no key for 2026-10-01** | 0 |
| A10 | `grep -n -A 9 "^SUCCESS_OUTCOMES" monitoring/freecash/gate.py` | `gate.py:32-41` still contains **`MONITOR_DEGRADED`**; `gate.py:198-200` `if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day` | 0 |
| A11 | `grep -n "covered = " monitoring/freecash/watchdog.py` | `33: covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` — a null day is reported covered | 0 |
| A12 | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at **line 41** (`function isDailyCheckAllowed(): boolean {`) | **1** |
| A13 | `node server/scripts/verify-freecash-rules.mjs` | `[OK] All 4 operational rules verified (4/4 passed)`; `grep -n process.exit` → **not found (exit 1)**; it certifies the file that fails A12 | 0 |
| A14 | `python -c "ET.parse(f)"` over the four `DELEGATION-2026-10-01/scheduler/*.xml` | **all four parse OK**, exit 0, incl. both `DECISION-V2-*.xml` (`2&gt;&amp;1` is correctly escaped). The parent statement that `DECISION-V2-*.xml` fail `ET.parse` is **superseded — corrected** (§0.1) | 0 |
| A15 | `schtasks /Query /FO CSV /NH \| wc -l` · `… \| grep -ic freecash` · `hermes cron list` | **278** tasks · **0** Free Cash · `No scheduled jobs.` | 0 |
| A16 | `python monitoring/freecash/tests/run_all.py` (scratch root) | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit **0**. The run itself printed `WATCHDOG_OK 2026-12-28 attempt=2026-12-28 outcome=MONITOR_DEGRADED` — the suite **asserts** that a null day counts as covered (`tests/test_r5_smoke.py:105`) | 0 |
| A17 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS`, exit **0** | 0 |
| A18 | `sha256sum data/…/state/last-run.json data/…/alerts/alerts.jsonl` **before and after** all of A16–A17 | `a287a902…3bf9` / `1b9c7c07…99a8`, byte-identical both times | 0 |
| A19 | `find data/freecash-monitor -type f -newermt '2026-10-01 00:00'` after the session | the **same four** files as before it: `alerts.jsonl`, `snapshots/2026-10-01.json`, `state/day-locks/2026-10-01.lock`, `state/last-run.json`, all mtime `2026-10-01 08:53` — none written by this session | 0 |
| A20 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest package mtime **2026-09-20 06:59** (`changedetect.py`, `watchdog.py`); `gate.py` 2026-09-18 07:32 — no code changed since 2026-09-20 | 0 |
| A21 | scratch run #1, no reading (full §A dump) | `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock`, exit 0; artifacts: `state/day-locks/2026-10-01.lock`, `snapshots/2026-10-01.json`, `state/last-run.json` with `last_success_day=2026-10-01` and `consecutive_missed_days=0`, `alerts/alerts.jsonl` +1 line | 0 |
| A22 | scratch run #2, same day | `SKIP_DUPLICATE_DAY 2026-10-01`, exit 0; alert log gained exactly one `SKIP_DUPLICATE_DAY` line; no second snapshot | 0 |
| A23 | `readonly_client.request(...)` probe, four calls | `REFUSED POST /api/v1/status/metrics` · `REFUSED https://api.freecash.com/api/v1/balance` (host not allowlisted) · `REFUSED /api/v1/cashout` (path not allowlisted) · `REFUSED` a body keyword; `ALLOWED_METHODS=['GET','HEAD']`, `ALLOWED_HOSTS=['127.0.0.1','::1','[::1]','localhost']`, `ALLOWED_PATHS=['^/api/v1/status/metrics$','^/api/v1/status$']` | 0 |
| A24 | 3-day driver with readings (scratch), then 4 CLI decider probes | 09-25 `INITIAL_BASELINE`; 09-26 `EARNINGS_CHANGED changes=1 notifications=1 approvals=1`; 09-27 `OK_NO_CHANGE`; one dedupe key `4a00e537…`, one approval item `status=PENDING`, `execution_state=NOT_EXECUTED`, `expires_at_utc=null`, `execution_allowed_by_this_routine=false`. Deciders: `--by "system"` → **REFUSED, exit 4**; `--by "claude"` → **recorded, exit 0**; `--by "hermes-agent"` → **recorded, exit 0**; `--by "   "` → REFUSED, exit 4 | mix |

### 0.1 Corrections to the inherited state line (each measured here)

1. **`DECISION-V2-*.xml` now parse.** All four scheduler XMLs return `ET.parse` exit 0 (A14). The unescaped `&` is gone (`2&gt;&amp;1`). The payloads now carry `StartBoundary 2026-10-02T09:00:00` (Task A) and `2026-10-02T21:30:00` (Task B), `MultipleInstancesPolicy=IgnoreNew`, `StartWhenAvailable=true`, no `RestartOnFailure` element, and the pinned interpreter `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`. V10's "Task A 08:35 / Task B 23:50" is `inherited` and superseded by the file. The C26 failure mode remains a *class* to gate on, not a live defect.
2. **868 uncommitted paths, not 862** (A2).
3. **`approvals/pending.json` does not exist** (A7) — the queue has never been materialised, so `approval_queue.list` has no artifact to read in production.
4. **The 52-test suite bakes in the defect.** `tests/test_r5_smoke.py:105` asserts `state["covered"]` is true for a degraded day, and A16 shows `WATCHDOG_OK … outcome=MONITOR_DEGRADED` printed by the suite itself. Any fix to §7-4 must change the test, not just the code.
5. **The "snapshot saved before it is loaded" defect is not live in the shipped source.** `run_daily_check.py:402` LOADs the prior snapshot before `:405` writes the new one (read directly, quoted in §3). The inversion exists only as the prepared mutant `DELEGATION-2026-10-01-R2/verifier/mutants/r3-a-baseline-is-current/pkg/run_daily_check.py:402` and the scratch copy `.hermes/scratch/freecash/pkg_swap/run_daily_check.py:403-404`. What **is** live and provable is its permanent cousin: `changedetect.save_snapshot` never rewrites an existing file (`:186-187`) and Rule 1's lock refuses a second run, so a null snapshot fixes a day forever (§7-3).
6. **`tzdata` is present** under the venv interpreter: run A21 printed `timezone: Europe/Berlin` with no `timezone_unavailable` warning, contradicting the `gate.py:62-67` docstring ("not installed here"). The degradation path is untriggered on this host under the interpreter of record.

---

## 1. The four operational rules — titles, both numberings, mechanism, failing check, observation

**The numbering is ambiguous in this repo and must never be cited bare.** Two schemes are in force:

| Scheme | Source (verified) | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **A — operator / delegation / this document** | `docs/…-V10-2026-10-01.md` §1; `run_daily_check.py:1-21`; `tests/test_r1_gate.py`…`test_r4_approval.py` | once-per-day check | zero automated earning actions | notify on earnings/status changes | human approval before any external action |
| **B — legacy JS verifier** | `server/scripts/verify-freecash-rules.mjs:15-44, 62-67` | No auto-earning actions | Once per day check | Notify on changes | Human approval queue |

**The inversion, stated exactly:** `gate.py:1` says *"R1: exactly one status read per operator-local calendar day"* and `readonly_client.py:1` says *"R2: the routine's ONLY network path"*. Under **scheme B** the same strings "R1" and "R2" mean the opposite things. Therefore: **A1 = B2**, **A2 = B1**, **A3 = B3**, **A4 = B4**. A reader arriving from the `.mjs` report will mis-map `gate.py`'s "R1" onto "no earning actions" and `readonly_client.py`'s "R2" onto "once per day". Every citation below prints the title; the number alone is never used.

| Rule (scheme A) | Also called (scheme B) | Enforcement mechanism (file:line, read here) | Executable check that FAILS on a violation | How I observed it this session |
|---|---|---|---|---|
| **Rule 1 — once-per-day check** (at most one status read per Europe/Berlin calendar day) | B2 "Once per day check" | `gate.py:96-102` `day_key()`; `gate.py:115-135` `acquire_day_lock()` = `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`; `run_daily_check.py:308-321` refuses the duplicate and returns 0 | `run_all.py` (the R1 race test) and, in production shape, a second invocation on the same day must print `SKIP_DUPLICATE_DAY` and add **no** snapshot, no ledger `last_success_day` advance; `gate.acquire_day_lock` must return `(False, path)` | A22: second scratch run printed `SKIP_DUPLICATE_DAY 2026-10-01`, exit 0, exactly one alert line added, lock count unchanged at 1. A16: suite `tests=52 failures=0`, exit 0 (race test included) |
| **Rule 2 — zero automated earning actions** (read-only transport only) | B1 "No auto-earning actions" | `readonly_client.py:39` `ALLOWED_METHODS={'GET','HEAD'}`; `:41` `ALLOWED_HOSTS` loopback only; `:43-49` `ALLOWED_PATHS` two regexes; `:52` `BODY_KEYWORDS`; `:110-140` `request()` refuses before `_transport`; `:76-107` `_transport` is the sole socket site; `:146-163` `sys.addaudithook` blocks any connect to a non-allowlisted host. Static layer `verify_readonly.py:41-88`, exit codes `:170-185` | `verify_readonly.py` must exit **1** on any unexempted forbidden token and **2** if a target is missing; `request()` must raise `ForbiddenWriteError` for any non-GET/HEAD, any non-loopback host, any path outside the two regexes, and any body keyword; the mutant set `DELEGATION-2026-10-01-R2/verifier/mutants/r2-a-*`, `r2-b-*` must be caught | A17: `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit 0. A23: four refusals, quoted verbatim, allowlists printed. I did not call any provider endpoint |
| **Rule 3 — notify on earnings/status changes** (exactly once per change, deduplicated) | B3 "Notify on changes" | `changedetect.py:34-39` `COMPARED_FIELDS` (four exact integer/str fields, no threshold); `:197-208` `load_prior_snapshot`; `:226-276` `compare`; `:214-216` `dedupe_key = sha256(day\|type\|field\|old\|new)`; `notify.py:123-124` `key_seen`; **`notify.py:132-145` `record_notified_key` — docstring "Called BEFORE any dispatch"**, called at `:224` before the send loop; `run_daily_check.py:126-214` dispatch/coalesce; `:91` "OK_NO_CHANGE is log-only" | A change detected twice must produce exactly one `notified-keys.json` entry, one alert line pair, one delivery; a re-detected key must print/take the `DEDUPED` branch with `already_notified: true`; `OK_NO_CHANGE` must add a log line and dispatch nothing | A24: earnings 1000→1340 produced `changes=1 notifications=1 approvals=1`, one key `4a00e537…` with `delivery=STUB_OK`, one `EARNINGS_CHANGED` line + one `APPROVAL_PENDING` line; unchanged figures produced `OK_NO_CHANGE` with `notifications=0` and no new key. A9: production has 10 keys, all consumed |
| **Rule 4 — human approval before any external action** (no execution path exists) | B4 "Human approval queue" | `approval_queue.py:118-134` `build_item` freezes `expires_at_utc=NO_EXPIRY(None)`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False`; `:161-201` `decide` **re-asserts** all three at `:179-183`; `run_daily_check.py:18-21` and `:151` — enqueue only. No module in the package opens a provider connection or carries an execution path (`readonly_client.py` is the only socket, Rule 2) | `approval_queue.py list` must never show a non-null `expires_at_utc` or an `execution_state` other than `NOT_EXECUTED` after any decision; a decision must not change execution state; **and** a decider identity that is not a named human must be refused | A24: item after decision — `status=APPROVED`, `decided_by=hermes-agent`, `execution_state=NOT_EXECUTED`, `expires_at_utc=None`, `execution_allowed_by_this_routine=False` (safety property **holds**). The attribution property **failed**: `--by "claude"` and `--by "hermes-agent"` were both accepted, exit 0 (§6.2) |

---

## 2. Day-lifecycle state machine

**Terms.** An **attempt day** is a day on which `run_daily_check.py` acquired the day lock. A **consumed day** is a day whose `state/day-locks/<day>.lock` exists. Today they are the same object; that identity is the core defect.

In the **intended** machine they differ: a day is *consumed* only when a reading was obtained.

```
                 ┌─────────────┐
   day starts →  │  FREE DAY   │  no lock for <today>
                 └──────┬──────┘
                        │ run_daily_check._run()
            ┌───────────▼────────────────────────────────┐
            │ 1. day = gate.day_key(now)                 │  gate.py:96-102  (zoneinfo, FREECASH_TZ,
            │    (Europe/Berlin calendar day)            │                   default Europe/Berlin)
            │ 2. acquired, lock = acquire_day_lock(day)  │  run_daily_check.py:309 → gate.py:128
            │    os.open(O_CREAT|O_EXCL|O_WRONLY)        │  ← LOCK IS TAKEN HERE
            └───────────┬────────────────────────────────┘
                        │ acquired == False → SKIP_DUPLICATE_DAY, one alert line, exit 0, no read,
                        │                    no snapshot, no ledger write   (run_daily_check.py:310-321)
            ┌───────────▼────────────────────────────────┐
            │ 3. ledger = load_ledger(); record_attempt  │  run_daily_check.py:323-329
            │    missed = gate.missed_days(day, ledger)  │  ← attempt is now on record
            └───────────┬────────────────────────────────┘
            ┌───────────▼────────────────────────────────┐
            │ 4. raw = read_source(kind, day)            │  run_daily_check.py:372  ← SOURCE READ HERE
            └───────────┬────────────────────────────────┘
                ┌───────┴────────┐
   read raises  │                │  data_available == False      │ data_available == True
   ┌────────────▼─────┐  ┌───────▼───────────────────┐  ┌───────▼────────────────────────┐
   │ outcome=         │  │ outcome=MONITOR_DEGRADED  │  │ INITIAL_BASELINE / OK_NO_CHANGE│
   │ READ_FAILED,     │  │ null snapshot written     │  │ / *_CHANGED; compare vs prior  │
   │ exit 5           │  │ (changedetect.py:150-176) │  │ snapshot loaded BEFORE the new │
   │                  │  │                           │  │ one is written (:402 vs :405)  │
   └────────┬─────────┘  └────────┬──────────────────┘  └───────┬────────────────────────┘
            └──────────┬──────────┘                            │
                       │ gate.record_outcome(day, outcome, …)   │
                       │   gate.py:188-202                      │
                       │   if outcome in SUCCESS_OUTCOMES →     │
                       │       last_success_day = day           │
                       │   ← MONITOR_DEGRADED IS IN THAT SET    │
                       └───────────────┬────────────────────────┘
                                       ▼
                            ┌──────────────────────┐
                            │ CONSUMED DAY, forever│  lock present, snapshot immutable
                            └──────────────────────┘
```

**Facts a reader must not lose:**

1. **The key is resolved and the lock acquired BEFORE the source is read.** `run_daily_check.py:309` (`acquire_day_lock`) precedes `:372` (`read_source`) and `:405` (`save_snapshot`). A run on a day with **no reading still consumes that day permanently** — proven end-to-end today twice over: in production at 08:53 (§A3–A5) and in a fresh scratch root by me (A21 → `lock` + null snapshot + `last_success_day=2026-10-01`).
2. **Duplicate-day refusal** is `acquire_day_lock → (False, path)` → one `SKIP_DUPLICATE_DAY` alert line, `print`, `return 0`, and explicitly no read, no snapshot and no ledger write (`run_daily_check.py:310-321`). Observed: A22. The refusal is *not* an error — exit code 0.
3. **`--force-recheck` is refused by design** (`run_daily_check.py:281-297`, exit 3) and the refusal is appended to `logs/forced-recheck-requests.jsonl`. Manual re-check is deliberately not implemented.
4. **A degraded run MUST NOT:** advance `last_success_day`; reset `consecutive_missed_days`; write `state/day-locks/<day>.lock`; write `snapshots/<day>.json`; let `watchdog.check` report covered. **Today it does all five** (§7-4, §7-5).
5. **A snapshot is never rewritten** (`changedetect.py:183-189`: `if path.exists(): return path, False`). Combined with (1), a null snapshot is the permanent record of that day; the only reversal is a human deleting the artifact (`S11`).
6. **Missed-day detection is in two places**: in-band at the next run (`gate.missed_days`, `run_daily_check.py:324,331-347`) and same-evening in `watchdog.py:56-101`. `missed_days` deliberately never back-fills (`gate.py:208-225`).

---

## 3. Artifacts and formats (paths relative to `FREECASH_DATA_ROOT`, default `D:/AgenticOS/data/freecash-monitor`)

| Artifact | Path | Shape (observed) | Notes |
|---|---|---|---|
| **Day lock** | `state/day-locks/<YYYY-MM-DD>.lock` | 0 bytes; presence == day consumed | filename **is** the day key; created by one `O_CREAT\|O_EXCL` syscall (`gate.py:128`). Never cleared by any code path |
| **Snapshot** | `snapshots/<YYYY-MM-DD>.json` | `{schema_version, day_key, captured_at_utc, source:{kind, read_ops, data_available, note}, degraded:true, account_status, earnings_total_cents, balance_cents, pending_cents, currency, raw_response_sha256}` | `source.kind` ∈ `operator_entered` \| `agenticos_local_metrics`; `source.read_ops` = `[]` for `operator_entered`, `["W1","W2"]` for metrics; all four figures `null` when `data_available:false`; `degraded` is hard-coded `true` (`changedetect.py:168`) — no source available today is provider-verified |
| **Alert line** | `alerts/alerts.jsonl` (append-only, single `O_APPEND` write, `paths.py:183-200`) | `{day_key, dedupe_key, event_id, event_type, message, observed, severity, ts_utc}` — exactly these eight keys, `sort_keys=True`; **no writer / pid / entry-point field** (A6) | `event_type` ∈ `MISSED_DAY`, `MONITOR_DEGRADED`, `SKIP_DUPLICATE_DAY`, `INITIAL_BASELINE`, `OK_NO_CHANGE`, `EARNINGS_CHANGED`, `STATUS_CHANGED`, `BALANCE_CHANGED`, `APPROVAL_PENDING`, `READ_FAILED`, `RUN_FAILED`, `DELIVERY_FAILED`; `severity` ∈ `info` \| `notify` \| `alert` (`notify.py:52-57`) |
| **Approval queue** | `approvals/pending.json` | `{schema_version, updated_at_utc, items:[…]}`; **absent in production today** (A7) | created on the first enqueue only (`approval_queue.py:137-143`) |
| **Approval item** | inside `pending.json.items[]` | `{approval_id, created_at_utc, day_key, change_dedupe_key, reason, proposed_action:{action_type, amount_cents, destination, provider_endpoint}, status, status_reason, decided_at_utc, decided_by, decision_note, expires_at_utc, execution_state, execution_allowed_by_this_routine}` | `approval_queue.py:118-134`. **Design-schema mapping** for the `{id, action, provider, params, createdAt}` shape: `id`→`approval_id` · `action`→`proposed_action.action_type` · `provider`→`proposed_action.provider_endpoint` (always the literal `PROVIDER_ENDPOINT_UNKNOWN…`, `readonly_client.py:60`) · `params`→`proposed_action.{amount_cents, destination}` · `createdAt`→`created_at_utc`. The frozen fields are **constants, not parameters**: `status=PENDING`, `expires_at_utc=None`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False`. `action_type` is the frozen design-schema label `ACTION_LABEL_FOR_HUMAN_REVIEW` (`approval_queue.py:52`) — a handle for a human decision; **no option in this plan proposes that action, and nothing in the package executes it** |
| **Decision trail** | `approvals/decided.jsonl` (append-only) | `{schema_version, approval_id, day_key, decision, decided_by, decided_at_utc, decision_note, change_dedupe_key, proposed_action, expires_at_utc:null, execution_state:NOT_EXECUTED, execution_allowed_by_this_routine:false}` | `approval_queue.py:184-200`; observed twice (A24) |
| **Ledger (last-run)** | `state/last-run.json` | `{schema_version, last_attempt_day, last_success_day, last_attempt_at_utc, last_success_at_utc, last_outcome, consecutive_missed_days, timezone, updated_at_utc}` | `gate.py:141-152`; **never the gate** (`gate.py:11-13`) — a corrupt ledger cannot cause a second read |
| **Dedupe store** | `state/notified-keys.json` | `{schema_version, keys:{<sha256>: {first_notified_at_utc, delivery, updated_at_utc}}}` | `delivery` ∈ `QUEUED`→`TOAST_OK` \| `STUB_OK` \| `FAILED_TOAST`; written **before** dispatch (`notify.py:132-145`, called at `:224`), so a crash can lose one message but can never duplicate one |
| **Operator reading source** | `state/operator-state.json` | `{schema_version, kind, note, how_to, records:[{day_key, entered_at_utc, account_status, earnings_total_cents, balance_cents, pending_cents, currency}], template_record}` | only the record whose `day_key == today` is used; a stale record is never carried forward (`operator_state.py:104-116`). Amounts are **integer cents** (1340 == 13.40) |
| **Forced-recheck audit** | `logs/forced-recheck-requests.jsonl` | `{ts_utc, requested_day, reason, decision:"REFUSED", why}` | present only if `--force-recheck` is ever attempted |

---

## 4. Scheduling design (handover only — **this plan registers nothing**)

Two tasks, both proposals in text. The payloads exist and parse (§A14); the operator registers them, or explicitly declines.

| Field | **Task A — daily check** | **Task B — missed-day watchdog** |
|---|---|---|
| Payload | `docs/…/DELEGATION-2026-10-01/scheduler/DECISION-V2-FreeCash-Daily-Monitor.xml` | `…/DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml` |
| Command | `cmd.exe /c <venv>\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1>> …\logs\task-a.log 2>&1` | `… <venv>\python.exe D:\AgenticOS\monitoring\freecash\watchdog.py 1>> …\logs\task-b-watchdog.log 2>&1` |
| **Interpreter pinning** | absolute `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (Python 3.11.9, has `tzdata`). Never `python3` (not present as a real interpreter), never `py -3`, never a bare `python` resolved from `PATH` | same |
| `StartBoundary` | `2026-10-02T09:00:00` (as shipped in the payload) | `2026-10-02T21:30:00` |
| `MultipleInstancesPolicy` | **`IgnoreNew`** — a slow run is never stacked | `IgnoreNew` |
| `StartWhenAvailable` | **`true`** — a missed window fires once, on next availability | `true` |
| Restart policy | **no `RestartOnFailure` element — Do not restart.** A retry cannot produce a second status read in one day and must never be added | same |
| `LogonType` | `InteractiveToken`, per-user, least privilege (the toast channel needs the desktop session) | same |
| Env hygiene | must not inherit ambient `FREECASH_*`; if `FREECASH_DATA_ROOT` is ever set, the task must pin it too, otherwise the routine writes its default root | same |
| Payload well-formedness gate | **before any `schtasks /XML`**: `python -c "import xml.etree.ElementTree as ET; ET.parse('<payload>')"` must exit **0**, and `schtasks /XML` must be the *only* consumer trusted to reject it | same |

**Ordering constraint on Task A (measured, not assumed):** at 08:53 today a run fired before any figures existed and spent the day (§A3–A5). A 09:00 Task A therefore still spends a day before the operator's reading window. Task A must either (a) move after the operator's daily reading time, or (b) be preceded by the pre-flight guard of §5 S1 option O-3, which refuses to run when today's `operator_state` record is absent. Until (a) or (b) lands, unattended operation stays blocked.

**Registration is not proposed by this document.** Nothing here is a `schtasks /Create`. Verified today: 278 tasks, **0** Free Cash; `hermes cron list` → `No scheduled jobs.` (A15) — nothing must be undone first. Evidence that the payloads have been *driven* before: `logs/task-a.log` (230 B) and `logs/task-b-watchdog.log` (136 B), both mtime 2026-09-30 21:02.

---

## 5. Notify path (Rule 3) and approval path (Rule 4)

### 5.1 Rule 3 — notify on earnings/status changes

| Element | Definition (verified) |
|---|---|
| Dedupe key | `sha256("<day_key>\|<change_type>\|<field>\|<old_value>\|<new_value>")` — `changedetect.py:214-216`. The day key is inside the key on purpose: the same change re-detected on a later day is a new key and notifies again; a same-day re-run cannot notify twice (Rule 1 already prevents it) |
| Store | `state/notified-keys.json`, key → `{first_notified_at_utc, delivery}` |
| Write ordering | `record_notified_key(key, "QUEUED")` at `notify.py:224`, i.e. **before** the send loop `:228-238`. A delivery failure of both attempts writes `FAILED_TOAST` and two `alert()` lines (`DELIVERY_FAILED` + `MONITOR_DEGRADED`) and never retries that key |
| Log-only events | `OK_NO_CHANGE` (`notify.py:91-99`) and `INITIAL_BASELINE` (`:102-110`) append exactly one line and dispatch nothing |
| Coalescing | more than `MAX_NOTIFICATIONS = 5` distinct changes in one day (`run_daily_check.py:55,176-213`): one line per change, individual dispatches suppressed, and **one** summary payload under the key `dedupe_key(day,"MONITOR_DEGRADED","change_count",5,N)` |
| **Burst coalescing for missed-day catch-up** | **not implemented.** `run_daily_check.py:331-347` loops the missed days and calls `notify.notify_change` once *per day*; `watchdog.py:66-94` emits one `MISSED_DAY`. The observed counter-example is `inherited` but re-confirmed in the log's shape: 10 `MISSED_DAY` lines, most inside one minute on 2026-09-30 (`first_notified_at_utc` `19:01:05`→`19:02:05Z`). Remedy (S8′): N missed days → **one** payload naming N and the day keys |

### 5.2 Rule 4 — approval path, and the identity-provenance defect

**Two distinct properties must be stated separately:**

1. **Safety property — HOLDS, verified (A24).** There is no execution path anywhere in the package. `execution_state` is the literal `NOT_EXECUTED` and is a constant, not a parameter (`approval_queue.py:44,132`); `expires_at_utc` is `None` and re-asserted after every decision (`:179-183`); `execution_allowed_by_this_routine` is `False` (`:45,133`). A decision changes `status`/`decided_by`/`decision_note` and **nothing else**. Observed after two machine-labelled approvals: `execution_state=NOT_EXECUTED`, `expires_at_utc=None`, `execution_allowed_by_this_routine=False`, and `decided.jsonl` carries the same frozen values.
2. **Attribution property — FAILS, verified (A24).** The live guard is a **denylist of ten literal words**, `approval_queue.py:55-57`: `{"system","routine","automation","agent","cron","scheduler","monitor","bot","script","machine"}`, tested by substring-free `.lower() in NON_HUMAN_DECIDERS` at `:153`. Therefore **`hermes-agent`, `assistant` and `claude` are accepted**, each recorded as an `APPROVED` decision by a non-human. Probe results: `--by "system"` → `REFUSED … exit 4`; `--by "claude"` → `recorded APPROVED … exit 0`; `--by "hermes-agent"` → `recorded APPROVED … exit 0`; `--by "   "` → `REFUSED … exit 4`. The guard proves the *labeller*, never the provenance.

**Allowlist remedy (S6, specify-then-implement).** Replace the denylist with a positive identity check, one change, one gate run:

- Accept only when the decider string is present in an operator-controlled allowlist — env var `FREECASH_OPERATOR_IDENTITY` (a comma-separated set of names) **or** a file `state/operator-identity.json` holding `{"allowed_deciders": ["<name>", …]}`, both read at decision time. Absent/empty allowlist ⇒ **refuse every decision** (fail closed).
- Keep the denylist as a second layer (it costs nothing and catches the obvious).
- Keep the frozen-field re-assertion untouched: the allowlist must not become a way to arm an item.
- Do **not** widen the ten-word list into a longer substring match — an open-ended denylist is the same defect one edit later.

---

## 6. Failure-modes table (all from defects listed in §0 plus §7 evidence)

| ID | Failure mode | Where (file:line) | Status measured this session | Detection that must exist | Fix stage |
|---|---|---|---|---|---|
| F-1 | **Unparseable monitor** certified as compliant | `server/scripts/freecash-daily-monitor.mjs:41` (`function isDailyCheckAllowed(): boolean {`); certified by `verify-freecash-rules.mjs:25` | **LIVE** — `node --check` exit **1**, `SyntaxError line 41`; verifier prints `4/4 PASSED`, exit **0** (A12, A13) | A checker that (a) `node --check`s the target and (b) is incapable of exiting 0 without a `process.exit` path | S9′ (label deprecated) |
| F-2 | **Silent exit 0 with no artifact** | `verify-freecash-rules.mjs:62-79` — `console.log` only; `grep -n process.exit` → **not found** (grep exit 1) | **LIVE** — always exit 0; produces no evidence file, no JSON, no exit-code branch | Any verifier claim must name its gate file, produce an artifact and be able to exit non-zero | S9′ / S0′ |
| F-3 | **Snapshot saved before it is loaded** → change detection can never fire | Inversion present in `DELEGATION-2026-10-01-R2/verifier/mutants/r3-a-baseline-is-current/pkg/run_daily_check.py:402` and `.hermes/scratch/freecash/pkg_swap/run_daily_check.py:403-404` | **NOT LIVE in the shipped source**: `run_daily_check.py:402` LOAD precedes `:405` WRITE (read directly). The **live cousin is permanent immutability**: `changedetect.py:186-187` refuses to rewrite an existing snapshot, and Rule 1's lock refuses the second run ⇒ a null snapshot fixes a day forever (§A21) | The R2 mutant `r3-a-baseline-is-current` must be *caught*; the shipped suite must assert source ordering (today only a docstring/comment guards it) | S1 |
| F-4 | **`MONITOR_DEGRADED` counted as success** | `gate.py:32-41` (member of `SUCCESS_OUTCOMES`), `gate.py:198-200` advances `last_success_day` | **LIVE, reproduced here (A21)**: a fresh scratch day with no reading produced `last_success_day=2026-10-01`, `consecutive_missed_days=0`. Production shows the same (§A4) | A data-less run must leave `last_success_day` and `consecutive_missed_days` untouched | S1 (O-1) |
| F-5 | **Watchdog reports a null day as covered** | `watchdog.py:33` `covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | **LIVE and baked into the suite** — A16 printed `WATCHDOG_OK 2026-12-28 attempt=2026-12-28 outcome=MONITOR_DEGRADED`; `tests/test_r5_smoke.py:105` asserts `covered` true for that case | Coverage must key on `data_available`, and the test must be inverted with the code | S1 (O-1) |
| F-6 | **Lock before read** → a day is spent with no reading | `run_daily_check.py:309` (lock) precedes `:372` (read); `:329` records the attempt before the read | **LIVE, reproduced (A21, A22)**; production incident 2026-10-01 08:53 (§A3–A5) | A pre-flight guard, or two-phase attempt/consume accounting; the lock must not exist when no reading was obtained | S1 (O-1 / O-2 / O-3) |
| F-7 | **Denylist bypass in the R4 decider guard** | `approval_queue.py:55-57`, `:153` — ten literal words | **LIVE, reproduced (A24)**: `claude` and `hermes-agent` accepted as deciders, exit 0 | A positive allowlist that fails closed when unset | S6 |
| F-8 | **Alert lines carry no writer attribution** | `notify.py:63-79` — the record has eight keys and no writer/pid field | **LIVE** — all 15 production lines, including today's 08:53 line (A6); `has writer/attribution key = False` | A writer tag (pid + entry point + start time) on every new line, and a bundle baseline that includes the 15 unattributed lines | S8′ |
| F-9 | **Burst-shaped missed-day catch-up** | `run_daily_check.py:331-347` (one dispatch per missed day); `watchdog.py:66-94` | **LIVE in shape**: 10 `MISSED_DAY` lines; 10 `notified-keys` entries written `19:01:05`→`19:02:05Z` on 2026-09-30 (A6, A9) | N missed days must arrive as one payload naming N and the day keys | S8′ |
| F-10 | **Payload that does not parse in its consumer** | formerly both `DECISION-V2-*.xml` (raw `&` in `<Arguments>`) | **CLEARED** — all four XMLs `ET.parse` exit 0 today (A14). Retained as a permanent pre-registration gate, never as a satisfied checkbox | `ET.parse` exit 0 quoted per payload in the same session as any registration (`inherited` V10 A17 as the counter-example) | S7 |
| F-11 | **Two/three state roots** (`data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor`) | `paths.py:35` default; `AGENT_TEAMS_DB_PATH` precedence in `db/index.ts` | `inherited` (V10 A24) — out of scope for this pass, but it is the reason all my invocations pinned three variables | One authoritative root, stated in every run log | operator decision D-3 |

---

## 7. Staged build order — every stage with the five required fields

**Ordering (this plan's recommendation, superseding V10's ordering for the *first three steps only*):**

> **S1 (O-1) → S11 → S3** — that is the **single shortest honest build order**, all of it inside one sitting, none of it producing revenue.

Then, in parallel or after: `S6 · S8′ · S9′ · S7`; later: `S4`; separately: `S10` (revenue, human-gated). One change at a time; never widen an allowlist and exempt a scanner hit in the same change.

| # | Stage | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action | Exit criteria |
|---|---|---|---|---|---|---|
| **S1** | **Make the day budget honest** (Rule 1 + Rule 3 integrity). **START HERE.** | ~40 min (O-1) · 3–5 h (O-2) · ~1 h (O-3) | none — buys truthfulness, not cash | none | Write the failing test **first**: *"a run with `data_available=false` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog print `WATCHDOG_MISSED_DAY`"* — it fails today (A21, A16). Then remove `MONITOR_DEGRADED` from `gate.py:32-41` and key `watchdog.py:33` coverage on `data_available` | `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0`, exit 0, with the new test in the count and `test_r5_smoke.py:105` inverted; a data-less scratch run leaves `day-locks/` empty, `last_success_day` unchanged, miss counter preserved, `WATCHDOG_MISSED_DAY` emitted |
| **S11** | **Close the 2026-10-01 incident; decide the day** (human-owned; **no agent may execute this**) | 10 min of decisions | **same-day visibility** if remediated; none if accepted | operator, in writing | Record three answers: (1) is the 08:53:46 run accepted as a documented breach of "never spend the day before a reading exists"; (2) is `2026-10-01.lock` left in place; (3) if remediated, is a corrective note **appended** (never rewritten) to `alerts.jsonl`? Remediation shape, after hashing the root: remove `state/day-locks/2026-10-01.lock` and `snapshots/2026-10-01.json`, re-read the hashes, and state that the Rule 1 record now understates what happened | three answers recorded against this section, with the before/after hash pair if anything was removed; every later status sentence states that **2026-09-30 and 2026-10-01 were both spent by runs that read nothing** |
| **S3** | **First real operator reading** | ~1 h setup + ~60 s/day | **same day, visibility only** (never revenue) | **S1 must land first** (else the first data-less run burns the next day — proven twice), S11 decided, a free day key, the pinned interpreter | The operator opens their own dashboard in a browser, logs in themselves, and appends **one** record to `state/operator-state.json` with today's `day_key` and four figures in integer cents; then invoke once: `<venv>\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state` and quote the `RUN_OK … outcome=INITIAL_BASELINE` line | day-1 baseline snapshot with `data_available:true`; a later day with a moved figure produces exactly one payload and one approval item; `operator-state.json` `records` length ≥ 1 (today: 0, A8) |
| **S6** | **Approval surface + identity allowlist** (Rule 4 attribution) | 2–4 h (+1 h if the provenance control is adopted) | none | S3 (the production queue has never held an item, A7) | Implement the positive allowlist of §5.2 with a failing test first: *"a decision naming `hermes-agent` is refused when the allowlist does not contain it"* — today it is accepted (A24) | every decision attributable to a human identity set outside the routine; an unset allowlist refuses **all** decisions; `execution_state` still `NOT_EXECUTED` and `expires_at_utc=None` after a decision; a `PENDING` item survives any clock advance unchanged |
| **S7** | **Register Task A + Task B** (handover only, human-registered) | 1–2 h + the operator's approval | none | Rule-gate green (S0′ or a written override), S1, S3, a pinned root, `ET.parse` exit 0 per payload | Hand the operator the exact non-elevated `schtasks /Create /XML` text for the two payloads in §4, with the interpreter pinned to the venv path, `IgnoreNew`, `StartWhenAvailable`, **Do not restart**, and the Task A ordering constraint resolved — and **do not register it** | `ET.parse` exit 0 on both payloads (already true, A14) **and** `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and both policies; **or** an explicit recorded decision not to schedule, in which case the routine is described as *built and unverified in operation* |
| **S8′** | **Alert attribution + burst coalescing** (Rule 3 surface) | 1–2 h now, ~2 min/day after | none | none (parallel) | Add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — all 15 lines, including today's, carry none (A6) — and coalesce missed-day catch-up so N missed days reach the operator as one payload | a new line's origin is identifiable from the line alone; N missed days → exactly 1 payload naming N and the day keys; the next bundle's baseline **includes** the 10 `MISSED_DAY` lines, the 3 `MONITOR_DEGRADED` lines and the 2 `SKIP_DUPLICATE_DAY` lines, so nothing is laundered |
| **S9′** | **Deprecation index / false-compliance label** (delete nothing) | 1–2 h, read-only | none — false-compliance risk control | none | Write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs` and `server/scripts/verify-freecash-rules.mjs` (**DEPRECATED — do not cite as compliant**, with the A12/A13/F-2 defect), and `server/src/adapters/freecashMonitorAdapter.ts`, each with its gate command, naming `monitoring/freecash/` as the single implementation | index exists; **no file moved, edited or deleted**; no compliance claim anywhere in the repo originates from `verify-freecash-rules.mjs` |
| **S0′** | **Rule-gate scope** (blocking only for a *COMPLIANT* claim, not for a reading) | 3–5 h | none | the delivered `DELEGATION-2026-09-30/verifier/` artefact + `DELEGATION-2026-10-01-R2/verifier/` mutants | Add `--package <dir>` to `scripts/monitoring/rule_gate_verify.py` and move the four detectors under it; then re-run the R2 mutation harness and require a **closed** mutant set | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** non-zero exit on every mutant; exactly one gate file reachable from the repo root |
| **S4** | **Bridge Path B (authenticated app path) into Path A** | 4–8 h | 3–7 days of sight of the real account; **no revenue** | app running **with a human session** (listener answers, 0 Electron processes — `inherited`), S1 resolved | Start the app, call the existing probe once through the app's own path, quote its evidence artefact, write the four-field mapping into the shape `operator_state.py` already reads | one day's reading produced through Path B and consumed by the existing source; `verify_readonly.py` still `forbidden=0 exempt=28`; no new monitor module in `git status` |
| **S10** | **The revenue path** (carried so it is not silently dropped) | unknown — a human decision first | **the only stage with a revenue hypothesis, and it is unbounded** | app running, a human decision, a publication step that does not exist | Nothing here; see the two texts already on record (`inherited`, V10 §2 S10) | not a monitor criterion; explicitly outside this routine's scope |

### 7.1 Option table (recommended + rejected alternatives)

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action | Verdict |
|---|---|---|---|---|---|---|
| Day budget (S1) | **O-1 honest accounting only** — `MONITOR_DEGRADED` out of `SUCCESS_OUTCOMES`, coverage keyed on `data_available`, both tests inverted | ~40 min | none | none | failing test first, then two edits (`gate.py:32-41`, `watchdog.py:33`) | **RECOMMENDED — the shortest honest change; makes the watchdog truthful** |
| Day budget (S1) | O-2 two-phase lock + accounting (attempt record becomes a consumed day only on a successful read) | 3–5 h | none | none | failing test, then attempt-then-consume | rejected for now: deliberately weakens "one read per day" to "one **successful** read per day"; must be a written decision, not a default |
| Day budget (S1) | O-3 wrapper pre-flight guard (refuse when today's operator record is absent) | ~1 h | none | a wrapper that is itself scheduled | guard on `day_key` + record presence | rejected **alone** — defence in depth only; the 08:53 leak was a wrapper-shaped path. Adopt *with* O-1 if Task A stays at 09:00 |
| Day budget (S1) | O-4 = O-2 + O-3 | 3–6 h | none | none | both, in that order | rejected for now: do the 40-minute change first, measure, then decide |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | none | rejected: it leaves unattended operation blocked **forever**; acceptable only as a recorded interim |
| Incident (S11) | **O-A accept the breach, keep the lock** | 10 min | none | operator | record the three answers | **RECOMMENDED on truthfulness grounds: the lock is a true record; the record stays honest** |
| Incident (S11) | O-B remediate the day | 10 min + 1 removal | **same-day visibility** | operator; **S1 first** | hash → remove lock + null snapshot → re-read → append a corrective note | acceptable **only** after S1 and only with the corrective note; it falsifies the Rule 1 record |
| Rule gate (S0′) | **O-A″ port the detectors into the shipped verifier and close the mutants** | 3–5 h | none | delivered artefacts | add `--package`; re-run the harness until 0 uncaught | **RECOMMENDED** |
| Rule gate (S0′) | O-B″ move the delivered `rule_gate.py` in as-is | 0.5 h | none | none | file move + label the old gate | rejected: ships a **third** gate and its mutation blind spot; one implementation per job |
| Rule gate (S0′) | O-C″ operator override of the gate requirement in writing | 0.2 h | none | operator sign-off | record the override | rejected while an automatable remedy exists; keep as a recorded fallback |
| Rule gate (S0′) | O-D″ inline `gate.py`'s lock into the entry file so the single-file gate turns green | 3–5 h | none | none | duplicate the Rule 1 mechanism | **REJECTED outright — a second copy of Rule 1** (`inherited` V9 A3, re-usable) |
| Rule 3 surface (S8′) | **writer tag + N→1 coalescing** | 1–2 h | none | none | add the tag; coalesce | **RECOMMENDED** |
| Rule 3 surface (S8′) | raise `MAX_NOTIFICATIONS` | 5 min | none | none | edit one constant | rejected: changes the surface, not the shape of a catch-up burst |
| Rule 4 identity (S6) | **positive allowlist (`FREECASH_OPERATOR_IDENTITY` / `state/operator-identity.json`), fail closed** | 2–4 h | none | S3 | failing test first | **RECOMMENDED** |
| Rule 4 identity (S6) | extend the denylist with more words | 10 min | none | none | add strings | **REJECTED — same defect class one edit later; verified bypassable today (A24)** |
| Notification sink (S5) | toast only | 0.5–1 h | none | a change to notify | dispatch one real toast | recommended; email/SMS/webhook has no configured transport |
| Scheduling (S7) | handover, no registration | 1–2 h | none | S0′/override, S1, S3 | hand over the `schtasks` text | **RECOMMENDED** |
| Scheduling (S7) | register now by this agent | 0.2 h | none | — | `schtasks /Create` | **REJECTED — out of scope and forbidden by this delegation; also blocked on S1** |

---

## 8. Definition of done · non-goals · blocked register · operator decisions

### 8.1 Definition of done

1. **A data-less run leaves no day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, and is reported as `WATCHDOG_MISSED_DAY`** (S1). Today's evidence is the exact opposite: A21 in a scratch root and A3–A5 in production.
2. `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0`, exit 0, with the Rule 1 race asserted under full-suite load and `tests/test_r5_smoke.py:105` inverted (A16 is the pre-change baseline).
3. `python monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0`, exit 0, at a **pinned** exempt count (A17; adopted from V10 to keep the metric comparable).
4. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit 0, `R1=R2=R3=R4=PASS`, **and** non-zero exit on every mutant in the harness (S0′).
5. One real reading consumed, one real change notified exactly once, one approval item decided by a named human whose identity is on an allowlist, `execution_state` still `NOT_EXECUTED`, `expires_at_utc` still `None`.
6. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record.
7. Watchdog: healthy day silent; uncovered day exactly one alarm; a multi-day catch-up arrives as **one** payload naming N and the day keys.
8. Every `alerts.jsonl` line attributable to a known writer.
9. No `alerts.jsonl` line is edited or deleted; corrective notes are appended.
10. Both scheduled-task payloads `ET.parse` exit 0 in the registering session and are quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule.
11. No credential anywhere; no unrelated uncommitted path modified; **no earning, withdrawal or transaction action performed by anything, in any option**.
12. Every stage states its Time-to-Revenue, and no stage outside S10 claims a path to cash.
13. Every pass that touches the routine states its `FREECASH_DATA_ROOT` and quotes the production-root hash pair before/after; every footprint claim carries the timestamp of its window.
14. The 2026-09-30 and 2026-10-01 incident decisions are recorded with the operator's name, and every later status sentence states that both days were spent by runs that read nothing.

### 8.2 Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — label and disable, never delete. No live financial write path, **in any option, including as an example**. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session. No modification of the 868 pre-existing uncommitted paths. No `git` mutation of any kind. No scheduler registration by this or any agent. No modification of the production state root. No voice/Jarvis or revenue-pipeline component touched.

### 8.3 Blocked register

| Item | Blocked on | Reason (verified this session) |
|---|---|---|
| Any reading for 2026-10-01 | operator decision S11 + an artifact removal | `2026-10-01.lock` exists (mtime 08:53) and a null snapshot is permanent (A3, A5, F-3) |
| The next unattended run being safe | S1 (O-1 minimum) | a data-less run spends the day **and** books it as a success (A21) |
| Unattended scheduling | S1 **and** the Task A ordering constraint **and** a green gate | 09:00 Task A fires before the operator's reading window; a data-less run is booked as success (A21, A16) |
| Trustworthy "the monitor is alive" signal | S1 | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`; `watchdog.py:33` reports covered on a null snapshot (A10, A11, A16) |
| Any *COMPLIANT* claim | S0′ | the shipped gate is single-file scoped and has no `--package` (`inherited`, V10 A12); the delivered gate passes 4/4 with 3 of 10 mutants surviving (`inherited`, V10 A15) |
| Live account status | app running **with a human session** + S4 | no Electron process today (`inherited`, V10 A22) |
| Email / SMS / webhook alerting | a configured transport | only the toast is implemented (`notify.py:167-192`) |
| Any withdrawal or earning action | Rule 4 + human approval | must never run unattended; no execution path exists by design, but the decider guard is a denylist (A24) |
| Strong Rule 4 attribution | the unapplied provenance patch | `hermes-agent` accepted as a decider today (A24) |
| Writer attribution in the alert log | a code change or a documented operating window | 15 lines, none carrying a writer key (A6) |
| State-root disposition | operator decision D-3 | three roots exist (`inherited`, V10 A24) |

### 8.4 Decisions the operator must take

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S1 remedy: O-1 / O-2 / O-3 / O-4 / O-5 | operator | every unattended run keeps spending a day and hiding it; the watchdog keeps reporting null days as covered |
| D-2 | S11: accept or remediate 2026-10-01 | operator | the incident stays open; each new day inherits a spent key; **no reading is obtainable today** |
| D-3 | authoritative state root (`data/freecash` / `data/freecash-monitor` / `server/data/freecash-monitor`) | operator | two roots can silently diverge |
| D-4 | Rule-gate scope: O-A″ / O-B″ / O-C″ | operator | a *COMPLIANT* claim stays unavailable; a mutation-tested gate sits unused |
| D-5 | `verify-freecash-rules.mjs` + `freecash-daily-monitor.mjs` + `freecashMonitorAdapter.ts`: label now, remove once unused | operator | a green 4/4 report certifying an unparseable file stays available to any future reader |
| D-6 | Rule 4 identity remedy: allowlist vs recorded residual risk | operator | `hermes-agent`/`assistant`/`claude` remain acceptable deciders |
| D-7 | Task A time: move after the reading window, or adopt O-3 | operator | a 09:00 run spends each day before any figures exist |
| D-8 | Schedule at all (S7), and if so when the app must be running for the toast channel | operator | the routine stays *built and unverified in operation* |
| D-9 | Revenue (S10): resume / implement / monitor only | operator | the monitor stays a visibility instrument with €19 verified 2026-08-19 (`inherited`) |

---

## 9. Honest statement (read this before any other section)

**This routine is a VISIBILITY instrument, not a revenue instrument.** No option in §7 produces revenue; the only stage with a revenue hypothesis is S10, and it is outside this routine. Every snapshot it can currently produce is `degraded: true` by construction — the operator-entered source means a "no change" day proves only that the same four numbers were typed twice, never that the provider verified anything.

**Today's day key is already spent.** `data/freecash-monitor/state/day-locks/2026-10-01.lock` exists with mtime `2026-10-01 08:53` (§A3), a null snapshot for that day is on disk and cannot be rewritten (§A5, F-3), and `state/last-run.json` books the day as a success with a reset miss counter (§A4). **No reading is obtainable for 2026-10-01 without a human decision** (S11), and the only two honest answers are (a) accept the breach and keep the lock, losing the day, or (b) remediate it under a named human and append a corrective note. Nothing in this document may be read as authorising either.

**What is actually true after this session:** the routine refuses duplicate days and writes a real evidence trail (A22, A24); a data-less run spends the day, books it as a success and silences its own watchdog (A21, A16); the shipped Rule 4 decider guard accepts `hermes-agent` as a human (A24) while the safety property (nothing executes) holds; the shipped acceptance gate is red for reasons of scope and a second, hardcoded verifier prints a green 4/4 on a file that does not parse (A12, A13); nothing is scheduled (A15); the two registration payloads parse today (A14); and **no single operator figure has ever been entered** (A8).

---

## Appendix A — evidence transcript (commands I executed, with exit codes)

All routine invocations used `FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-r3-scratch-20261001/<sub>`, `AGENTICOS_DATA_DIR=…/agenticos`, `AGENT_TEAMS_DB_PATH=…/agent_teams.db`, `FREECASH_TOAST_STUB=1`, and the interpreter of record `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` (Python 3.11.9). `which python3` resolves to `/c/Users/cd-pr/AppData/Local/Microsoft/WindowsApps/python3`, the Windows Store alias — **not** the interpreter of record.

**A21 — hermetic no-reading run, fresh scratch root:**

```
$ python run_daily_check.py
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)
  snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0
  lock=2026-10-01.lock
run1_exit=0
$ find <scratch> -type f
…/data/alerts/alerts.jsonl
…/data/snapshots/2026-10-01.json
…/data/state/day-locks/2026-10-01.lock
…/data/state/last-run.json
…/data/state/operator-state.json
$ cat …/data/state/last-run.json
{"last_attempt_day":"2026-10-01","last_success_day":"2026-10-01",
 "last_attempt_at_utc":"2026-10-01T07:28:40Z","last_success_at_utc":"2026-10-01T07:28:41Z",
 "last_outcome":"MONITOR_DEGRADED","consecutive_missed_days":0,"timezone":"Europe/Berlin"}
```

**A22 — duplicate refusal:**

```
$ python run_daily_check.py
SKIP_DUPLICATE_DAY 2026-10-01
run2_exit=0
$ tail -1 …/data/alerts/alerts.jsonl
{"day_key":"2026-10-01","dedupe_key":null,"event_type":"SKIP_DUPLICATE_DAY",
 "message":"Day 2026-10-01 already consumed (lock 2026-10-01.lock). Duplicate run performed
 no read and wrote no snapshot.", …, "severity":"info"}
```

**A23 — Rule 2 transport probe:**

```
REFUSED  POST /api/v1/status/metrics (loopback) -> R2: method 'POST' is not read-only (allowed: GET, HEAD)
REFUSED  GET https://api.freecash.com/api/v1/balance -> R2: host not allowlisted: 'api.freecash.com'
REFUSED  GET /api/v1/cashout (loopback) -> R2: path not allowlisted: '/api/v1/cashout'
REFUSED  GET …/status/metrics with json body -> R2: request bodies are forbidden ('json')
probe_exit=0
```

**A24 — Rule 3 + Rule 4 drive, and the decider probes:**

```
RUN_OK 2026-09-25 outcome=INITIAL_BASELINE … changes=0 notifications=0 approvals=0
RUN_OK 2026-09-26 outcome=EARNINGS_CHANGED … changes=1 notifications=1 approvals=1
RUN_OK 2026-09-27 outcome=OK_NO_CHANGE … changes=0 notifications=0 approvals=0
alerts: INITIAL_BASELINE(info) · APPROVAL_PENDING(notify, dedupe 4a00e537…) ·
        EARNINGS_CHANGED(notify, dedupe 4a00e537…) · OK_NO_CHANGE(info, dedupe -)
notified-keys: 4a00e537… -> STUB_OK
approval item: status=PENDING execution_state=NOT_EXECUTED expires_at_utc=null
               execution_allowed_by_this_routine=false
--by "system"       -> REFUSED: 'system' is not a human identity …        exit=4
--by "claude"       -> recorded APPROVED … by claude                       exit=0
--by "hermes-agent" -> recorded APPROVED … by hermes-agent                 exit=0
--by "   "          -> REFUSED: --by is required …                         exit=4
after decisions: execution_state=NOT_EXECUTED expires_at_utc=None
```

**A16 / A17 — suite and static gate:**

```
run_all: tests=52 failures=0 errors=0 skipped=0        suite_exit=0
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.   verify_readonly_exit=0
```

**A18 / A19 — hermeticity (identical before and after):**

```
before: sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl
  a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *…/state/last-run.json
  1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *…/alerts/alerts.jsonl
after : identical, both files (hashes unchanged)
find data/freecash-monitor -type f -newermt '2026-10-01 00:00'
  …/alerts/alerts.jsonl · …/snapshots/2026-10-01.json · …/state/day-locks/2026-10-01.lock
  · …/state/last-run.json      (all mtime 2026-10-01 08:53 — the 08:53:46 run, not this session)
day-locks/ = 2026-09-20.lock · 2026-09-30.lock · 2026-10-01.lock   (unchanged, count 3)
```

---

**One-line reading of 2026-10-01 (09:31 local):** the routine runs, refuses a duplicate day and keeps an honest append-only trail — and this morning it spent the production day on a null read, booked it as a success, reset its 9-day miss counter to 0 and silenced the watchdog it exists to feed; the Rule 4 decider guard accepts `hermes-agent` as a human while nothing executes; a hardcoded verifier prints a green 4/4 on a file that does not parse; nothing is scheduled; and after 11 days and 15 alert lines **no operator figure has ever been entered**. The single shortest honest build order is **S1 (O-1, ~40 min) → S11 (operator, 10 min) → S3 (the first real reading, same sitting)** — and it buys visibility, never revenue.

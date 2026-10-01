# WORKFLOW PLAN — Free Cash Finance Automation, once-per-day read-only status routine

Track: `DELEGATION-2026-10-01-R2/workflow/` (delegation R2). Repository `D:\AgenticOS`, branch `hermes-rescue-20260908`, HEAD `8f7463a`.
Clock at write time: 2026-10-01 09:18 Europe/Berlin (07:18Z). Shell: git-bash (MSYS) on Windows 11.
Interpreter of record: `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (Python 3.11.9, IANA tzdata present).
Evidence standard: every factual claim below is the raw output of a command run in this pass, quoted inline as `EVIDENCE:`. Anything I could not run is marked **UNVERIFIED**.

**Supersedes / duplication:** nothing. The sibling `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/WORKFLOW-PLAN.md` (+ its ADDENDUM, 52 KB) was **read, not edited**; it holds the design narrative and a live-incident write-up. This document adds only: the machine-checkable step table, the U1–U4 verdict matrix with raw output, the flakiness quantification (26 runs), the existing rule gate's measured blind spots, the DST proof, the missed/reading-less payload counts, escalation thresholds, three arming options and a falsifiable definition-of-done. **No second gate file was created.**

Commands are given with these variables (all paths Windows-forward-slash, which is what the native interpreter accepts here):

```bash
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
ROUTE="D:/AgenticOS/monitoring/freecash/run_daily_check.py"
ROOT="D:/AgenticOS/data/freecash-monitor"      # production state root
TMP="C:/Users/cd-pr/AppData/Local/Temp/fc-r2"  # throwaway variant root used for every demo
```

---

## §0 Live state verified in this pass

| # | Command | Raw output |
|---|---------|-----------|
| L1 | `ls -la monitoring/freecash` | `approval_queue.py`, `changedetect.py`, `gate.py`, `notify.py`, `operator_state.py`, `paths.py`, `readonly_client.py`, `run_daily_check.py`, `tests/`, `verify_readonly.py`, `watchdog.py` |
| L2 | `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` (before AND after this pass) | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` / `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` — **identical before and after** |
| L3 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00" \| wc -l` | `4` — and the same 4 files before and after: `alerts/alerts.jsonl`, `snapshots/2026-10-01.json`, `state/day-locks/2026-10-01.lock`, `state/last-run.json` (all mtime `2026-10-01 08:53:46` local = `06:53:46Z`, i.e. the pre-existing incident, not this pass) |
| L4 | `find data/freecash-monitor -type f -exec sha256sum {} \;` | 12 files; `last-run.json` = `a287a9…`, `alerts.jsonl` = `1b9c7c…`, `snapshots/2026-10-01.json` = `bad8f35e…`, `state/operator-state.json` = `be8becc3…` |
| L5 | `$PY -c "…json.load(open('data/freecash-monitor/state/last-run.json'))"` | `{"last_attempt_day": "2026-10-01", "last_success_day": "2026-10-01", "last_outcome": "MONITOR_DEGRADED", "last_attempt_at_utc": "2026-10-01T06:53:46Z", "last_success_at_utc": "2026-10-01T06:53:46Z", "consecutive_missed_days": 0, "timezone": "Europe/Berlin"}` |
| L6 | `…json.load('…/snapshots/2026-10-01.json')` | `{'day_key': '2026-10-01', 'degraded': True, 'account_status': None, 'earnings_total_cents': None, 'balance_cents': None, 'pending_cents': None, 'raw_response_sha256': 'e3b0c442…b855'}` source `{'kind': 'operator_entered', 'read_ops': [], 'data_available': False, 'note': 'no operator-entered record for 2026-10-01 in operator-state.json'}` |
| L7 | `…json.load('…/state/operator-state.json').get('records')` | `[]` — the default read source has never carried a figure |
| L8 | `alerts.jsonl` by `event_type` | `{'MONITOR_DEGRADED': 3, 'SKIP_DUPLICATE_DAY': 2, 'MISSED_DAY': 10}`; `wc -l` = `15` |
| L9 | `ls -la data/freecash-monitor/approvals/` ; `ls -1 state/day-locks/` | approvals dir **empty**; locks `2026-09-20.lock`, `2026-09-30.lock`, `2026-10-01.lock` |
| L10 | `$PY monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` / `PASS - no unexempted write/earning token found.` exit 0 |
| L11 | negative control: `verify_readonly.py <tree with requests.post(.../withdraw)>` and `<clean tree>` | `forbidden=4 …` exit **1**; clean `forbidden=0 …` exit **0** — the checker has a proven fail path |
| L12 | 26 × `FREECASH_DATA_ROOT=$(mktemp -d) FREECASH_TOAST_STUB=1 $PY monitoring/freecash/tests/run_all.py` | 23 × `run_all: tests=52 failures=0 errors=0 skipped=0`; **3 red** (`run 18`, `run 20`, `run 26`) all `FAIL: test_five_concurrent_runs_yield_one_winner … AssertionError: 3 != 4` (evidence/suite-26-runs.txt, suite-run18-fail.txt) |
| L13 | `$PY scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS`, exit 1 |
| L14 | `$PY scripts/monitoring/rule_gate_verify.py monitoring/freecash/gate.py` | `SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL`; R1's failing sub-check is `no rolling 24h window used as the daily gate [line 220] evidence: cursor = last + timedelta(days=1)` — a **false positive** (that line is missed-day arithmetic) |
| L15 | `$PY scripts/monitoring/rule_gate_verify.py monitoring/freecash` (the package) | `PermissionError: [Errno 13] Permission denied: 'monitoring\\freecash'` — it cannot scan a directory at all |
| L16 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash`; `/TN "FreeCash-Daily-Monitor"`; `/TN "FreeCash-Missed-Day-Watchdog"` | `278` rows; `0` freecash matches; both name queries → `FEHLER: Das System kann die angegebene Datei nicht finden.` |
| L17 | `hermes cron list`; `ls -la "$LOCALAPPDATA/hermes/cron"` | `No scheduled jobs.` / `Create one with 'hermes cron create …'`; cron dir holds `executions.db`, `output/`, `ticker_heartbeat`, `ticker_last_success`, the ticker files mtime `2026-10-01 09:14` (ticker live) |
| L18 | `py -3 --version`; `py -3 -c "from zoneinfo import ZoneInfo; print(ZoneInfo('Europe/Berlin'))"` | `Python 3.14.7`; `ModuleNotFoundError: No module named 'tzdata'` → `zoneinfo._common.ZoneInfoNotFoundError` — the launcher has **no** IANA database |
| L19 | `FREECASH_DATA_ROOT=$TMP/root-tz … py -3 monitoring/freecash/run_daily_check.py` | `WARNING timezone_unavailable configured=Europe/Berlin offset=+0200` then `RUN_OK … outcome=MONITOR_DEGRADED` — day key degrades silently to machine-local |
| L20 | `git rev-parse --short HEAD`; `git ls-files monitoring \| wc -l`; `git status --porcelain \| wc -l` | `8f7463a`; `0` (whole implementation untracked); `865` dirty paths (unrelated; 807 untracked) |
| L21 | `git status --porcelain docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/` | `?? docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/` — the only path this pass touches |

**Production-root footprint:** hash pair unchanged (L2), `-newermt "2026-10-01 00:00"` still 4 (L3), no new file under `data/`, no git write verb, no scheduled task, no cron job (L16–L17), no credential, no provider call. Every demo below ran with `FREECASH_DATA_ROOT` pointed at `$TMP/root-*`.

---

## §1 The once-per-day timeline

One invocation of `run_daily_check.py` walks stages S2–S8 internally; S0/S9/S10 are separate commands the operator or the timer runs around it. Column *Evidence* = raw output observed in this pass.

| # | Stage | Exact command | Artifact written | Failure branch | Evidence (this pass) |
|---|-------|---------------|------------------|----------------|----------------------|
| **S0** | **Pre-flight reading guard** (new; prevents the reading-less success day) | `FREECASH_DATA_ROOT="$ROOT" "$PY" -c 'import sys; sys.path.insert(0,"D:/AgenticOS/monitoring/freecash"); import gate, operator_state; day=gate.day_key(); rec=operator_state.record_for_day(day); print("PREFLIGHT_READING_%s day=%s" % ("PRESENT" if rec else "MISSING", day)); sys.exit(0 if rec else 9)'` | stdout line only; **writes nothing** (no lock, no snapshot, no ledger, no alert) | `exit 9` → the wrapper **must not** invoke S1; today's day lock stays unclaimed, so the day can still be checked after the operator enters a reading. `exit 0` → proceed to S1. | `PREFLIGHT_READING_MISSING day=2026-10-01 … prod-preflight-exit=9` (production root, read-only); `PREFLIGHT_READING_MISSING … root-a-preflight-exit=9`; `PREFLIGHT_READING_PRESENT day=2026-10-01 … root-e-preflight-exit=0` |
| **S1** | **Fire** (timer or human) | `FREECASH_DATA_ROOT="$ROOT" "$PY" "$ROUTE"` (add `FREECASH_READ_SOURCE=metrics_http --base-url …` only if that source is ever commissioned) | exit code + one stdout line `RUN_OK …` or `SKIP_DUPLICATE_DAY …`; log `logs/` | exit **2** usage error; **3** `--force-recheck` refused (audited to `logs/forced-recheck-requests.jsonl`); **5** read failed; **0** either ran or duplicate | `RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock`; `SKIP_DUPLICATE_DAY 2026-10-01` |
| **S2** | **Gate / day-lock** | internal: `run_daily_check.py:309 acquired, lock = gate.acquire_day_lock(day)` → `gate.py:128 os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock` | `state/day-locks/2026-10-01.lock` (0 bytes) + `state/last-run.json` `last_attempt_day` via `record_attempt` (`:329`) | `FileExistsError` → `SKIP_DUPLICATE_DAY`: one alert line, **no read, no snapshot, no success-ledger write**, exit 0 | `EVIDENCE (grep -n)`: `run_daily_check.py:309:    acquired, lock = gate.acquire_day_lock(day)`; `run_daily_check.py:372:        raw = read_source(source_kind, day, …)`; demo: `SKIP_DUPLICATE_DAY 2026-10-01` then alerts `{'MONITOR_DEGRADED': 1, 'SKIP_DUPLICATE_DAY': 1}`, day-locks = one file, root file count `5` |
| **S3** | **Read** | internal: `run_daily_check.py:372 read_source(source_kind, day)` → `operator_state.read_source(day)` (default) or `readonly_client.read_status_source()` | nothing on disk when it succeeds (figures stay in memory); `state/operator-state.json` template is created if absent | `ReadError` / `ForbiddenWriteError` / `MetricError` → `RUN_FAILED` alert, `gate.record_outcome(day,"READ_FAILED",…)`, exit **5**; `READ_FAILED ∉ SUCCESS_OUTCOMES` so `last_success_day` is **not** advanced → the day stays uncovered | `gate.py:32 SUCCESS_OUTCOMES = frozenset({…"OK_NO_CHANGE","INITIAL_BASELINE","EARNINGS_CHANGED","STATUS_CHANGED","BALANCE_CHANGED","MONITOR_DEGRADED"})`; `gate.py:198 if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day` |
| **S4** | **Compare** | internal: `changedetect.load_prior_snapshot(day)` **then** `build_snapshot` **then** `compare(prior, snapshot)` | `snapshots/<day>.json` (immutable; `save_snapshot` refuses to overwrite) | prior missing **or** either side `data_available=false` → `baseline=True` → `INITIAL_BASELINE` (log only) or `MONITOR_DEGRADED`; currency change → money comparison skipped and `degraded` note emitted | `run_daily_check.py:402-405`; demo C: prior 2026-09-30 `earnings 1340` vs today `2340` → `changes=1 notifications=1 approvals=1`, alerts `{'APPROVAL_PENDING': 1, 'EARNINGS_CHANGED': 1}`; demo E (identical figures) → `outcome=OK_NO_CHANGE changes=0 notifications=0`, alerts `{'OK_NO_CHANGE': 1}` |
| **S5** | **Notify** | internal: `notify.notify_change(...)` → `dispatch(...)`; one change = one dedupe key = at most one payload | `alerts/alerts.jsonl` (append line) + `state/notified-keys.json` (key written **before** the dispatch attempt) | delivery raises twice → `DELIVERY_FAILED` line carrying the full message **plus** a `MONITOR_DEGRADED` "channel is down, read the log" line; key marked `FAILED_TOAST`; never retried; the snapshot/ledger writes still complete | demo G2 with a sender that always raises: `alert_event_counts= {'APPROVAL_PENDING': 1, 'EARNINGS_CHANGED': 1, 'DELIVERY_FAILED': 1, 'MONITOR_DEGRADED': 1}`, `delivery labels: {'23920b70': 'FAILED_TOAST'}`, exit 0 |
| **S6** | **Queue for approval** | internal: `run_daily_check.py:151 approval_queue.enqueue(day, change, reason)` → `approval_queue.py:137` | `approvals/pending.json` item: `status=PENDING`, `expires_at_utc=null`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=false`; plus one `APPROVAL_PENDING` alert line | >5 distinct changes → coalesce (`MAX_NOTIFICATIONS=5`): individual notifications suppressed, **no enqueue**, one summary payload | demo C: `6c7cffc2-…  PENDING  2026-10-01  expires_at_utc=None  execution_state=NOT_EXECUTED`; decision demo: after `decide --decision approve`, listing shows `APPROVED … expires_at_utc=None execution_state=NOT_EXECUTED` |
| **S7** | **Record** | internal: `gate.record_outcome(day, outcome, now, ledger, missed=len(missed))` → `save_ledger` (atomic temp+`os.replace`) | `state/last-run.json` | non-success outcome ⇒ `last_success_day` unchanged ⇒ the next run's `missed_days()` and the watchdog both see the day as uncovered — **except** `MONITOR_DEGRADED`, which is in `SUCCESS_OUTCOMES` (see §4) | demo A ledger: `last_attempt_day=2026-10-01, last_success_day=2026-10-01, last_outcome=MONITOR_DEGRADED` |
| **S8** | **Post-run "was today actually read?" verifier** (new; the compensating control for S7's hole) | `FREECASH_DATA_ROOT="$ROOT" "$PY" -c '<POST>' 2026-10-01` where `<POST>` loads `snapshots/<day>.json` + `state/last-run.json` and compares `source.data_available` against `last_success_day == day` | stdout verdict + exit code; operator appends one `UNREAD_DAY` line to `alerts/alerts.jsonl` (append-only, never rewritten) | exit **1** with `UNREAD_DAY_NOT_A_SUCCESS_DAY` → today was booked as a success day without a reading; escalate per §5 (the watchdog will **not** catch this by itself) | `snapshot_data_available=False booked_as_success_day=True => UNREAD_DAY_NOT_A_SUCCESS_DAY` exit **1** (root-a); `snapshot_data_available=True booked_as_success_day=True => OK_READ_AND_BOOKED` exit **0** (root-e) |
| **S9** | **Evening watchdog** (same local day, e.g. 21:00) | `FREECASH_DATA_ROOT="$ROOT" "$PY" monitoring/freecash/watchdog.py` | at most one `MISSED_DAY` line in `alerts/alerts.jsonl` + one dedupe key in `notified-keys.json`; stdout `WATCHDOG_OK` / `WATCHDOG_MISSED_DAY` | `covered = attempt == today and outcome in SUCCESS_OUTCOMES` (`watchdog.py:33`); if already alarmed today → `coverage=DEDUPED`, adds nothing; always exits 0 | demo A: `WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=MONITOR_DEGRADED` — i.e. a day on which **nothing was read** is reported covered |
| **S10** | **Escalation pass** (same evening as S9) | internal to S1 (`nag_pending`, `run_daily_check.py:217`); a stalled item re-notifies once per 7 days | `APPROVAL_PENDING` reminder line in `alerts.jsonl`, key written before dispatch | item already nagged within 7 days → no line, no payload; decided item → never nagged | demo F2: `reminders=1`, `Reminder: approval item 1111… has been waiting since 2026-09-20T19:00:00Z (still PENDING, no expiry).`; API table: `last nag 6 days ago -> nag_due=False`, `7 days ago -> nag_due=True` |

**Ordering trap that makes S0 mandatory.** The entry point claims the day lock (`:309`) *before* it resolves and reads the source (`:372`). A fire on a day with no reading therefore consumes the day permanently, writes a null snapshot and books the day as a success — which is exactly what happened in production today (L5/L6 and the `2026-10-01.lock`). The routine deliberately refuses recovery: `--force-recheck` exits 3 and audits the refusal (docstring `run_daily_check.py:30-37`).

---

## §2 Control matrix — U1 / U2 / U3 / U4

Verdicts are for the **canonical implementation** (`monitoring/freecash/`) as measured in this pass, against the operator's own four rules.

### U1 — "Don't perform earning actions automatically." → **PASS**

| Field | Value |
|---|---|
| Enforcer | `readonly_client.py::request` (deny-by-default): `ALLOWED_METHODS = frozenset({"GET","HEAD"})` (`:39`), `ALLOWED_HOSTS` loopback-only (`:41`), `ALLOWED_PATHS` two compiled regexes (`:43-49`), body-keywords `data/json/files/body/content` refused (`:52`, `:120-126`); every refusal raises `ForbiddenWriteError` **before** `_transport` — the single socket site (`:76`). Second layer: `_audit_hook` / `install_audit_guard` (`:146-176`) aborts any `socket.connect`/`getaddrinfo` to a non-allowlisted host. |
| Also enforced by | `verify_readonly.py` (static scan), `notify.py` (no network), `approval_queue.py::ACTION_LABEL_FOR_HUMAN_REVIEW` — a schema label only, no executor anywhere |
| Test | `monitoring/freecash/tests/test_r2_readonly.py` (261 lines) inside `run_all.py` |
| Command that shows it | `$PY monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0` / `PASS - no unexempted write/earning token found.` exit **0** |
| Negative control (the checker must fail) | bad tree with `requests.post("https://x/api/v1/withdraw", …)` → `forbidden=4 … FAIL` exit **1**; clean tree → `forbidden=0 … PASS` exit **0** |
| Caveat | The shipped rule gate cannot corroborate: on the package it crashes (`PermissionError … 'monitoring\freecash'`), on `gate.py` it reports `R2=FAIL` because the allowlist lives in a sibling file. `exempt=28` is the baseline — a rise means the gate is eroding. |
| UNVERIFIED | No live provider request was attempted (by constraint), so the deny-by-default path is proven by suite + static scan + negative control, not by a provider-side refusal. |

### U2 — "Check the status once a day." → **PARTIAL**

| Field | Value |
|---|---|
| Enforcer | `gate.py::acquire_day_lock` — `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` (`:128`), zero-byte file, filename *is* the day key; day key = `gate.py::day_key` calendar date in operator-local tz (`:96-102`); duplicate branch `run_daily_check.py:310-321` performs no read, no snapshot, no success-ledger write |
| Test | `monitoring/freecash/tests/test_r1_gate.py`, incl. `ConcurrencyTests::test_five_concurrent_runs_yield_one_winner` (`:121`) |
| Command that shows the single-process half (PASS) | run #1 then run #2 with the same root → `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED … lock=2026-10-01.lock`, then `SKIP_DUPLICATE_DAY 2026-10-01` (exit 0); alerts `{'MONITOR_DEGRADED': 1, 'SKIP_DUPLICATE_DAY': 1}`; `ls state/day-locks` = one file |
| Command that shows the concurrency half (**FAIL**) | 26 × `FREECASH_DATA_ROOT=$(mktemp -d) FREECASH_TOAST_STUB=1 $PY monitoring/freecash/tests/run_all.py` → **23 green, 3 red** (runs 18, 20, 26), each `FAIL: test_five_concurrent_runs_yield_one_winner … AssertionError: 3 != 4` |
| Verdict | **PARTIAL** — exactly-one-read-per-day is proven for sequential invocations and is atomic by syscall, but "5 concurrent processes → 1 winner + 4 skip-lines" failed 3 of 26 runs (11.5 %). A gate that flakes is not a gate, so the timer stage must not claim R1 concurrency as proven. |
| DST | day key is a calendar date, not a 24 h window → verified DST-safe, §3 |

### U3 — "Tell me if earnings or account status changes." → **PARTIAL**

| Field | Value |
|---|---|
| Enforcer | `changedetect.py::compare` (4 exhaustive fields, integer cents, no threshold; `:226-276`), `changedetect.py::dedupe_key` = sha256(day\|type\|field\|old\|new) (`:214`), `notify.py::dispatch` writes the key **before** dispatching (`:224`), `notify.py::emit_no_change` is log-only (`:91-99`) |
| Test | `monitoring/freecash/tests/test_r3_changedetect.py` + the two live demos below |
| Command that shows a real change (PASS half) | prior snapshot 2026-09-30 `earnings 1340` vs today's record `2340` → `changes=1 notifications=1 approvals=1`, alerts `{'APPROVAL_PENDING': 1, 'EARNINGS_CHANGED': 1}` — exactly one payload |
| Command that shows no-change (PASS half) | identical prior → `outcome=OK_NO_CHANGE changes=0 notifications=0`, alerts `{'OK_NO_CHANGE': 1}` — **zero** dispatches |
| Command that shows the production hole (**FAIL** half) | `records: []` in `state/operator-state.json`; `last-run.json` `last_outcome=MONITOR_DEGRADED`, `last_success_day=2026-10-01`; `watchdog.py` → `WATCHDOG_OK` — a day with no reading is booked as a success and the alarm agrees |
| Verdict | **PARTIAL** — the mechanism is exact and dedupe-safe on a day that has a reading; on the production path nothing has ever been compared, and the "we learned nothing" case produces 1 informational line and no alarm, while `last-run.json` reports success. |
| Payload storm in the missed-day path | 9 missed days → **9 payloads** (§4) |

### U4 — "Ask me before any external action." → **PASS** (with one PARTIAL sub-claim)

| Field | Value |
|---|---|
| Enforcer | `approval_queue.py::build_item` freezes `expires_at_utc = None`, `execution_state = NOT_EXECUTED`, `execution_allowed_by_this_routine = False` (`:118-134`); `decide()` re-asserts the frozen fields after recording (`:179-182`); no executor exists — the only writes are JSON/JSONL state files |
| Test | `monitoring/freecash/tests/test_r4_approval.py` |
| Command that shows "nothing executes" (PASS) | `decide --id <uuid> --decision approve --by "Christian" --note "reviewed dashboard myself"` → `recorded APPROVED … execuction_state` line `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)`; `approval_queue.py list` → `… APPROVED 2026-10-01  expires_at_utc=None  execution_state=NOT_EXECUTED` |
| Command that shows the queue is human-only (PASS) | unknown id → `no such approval_id: bogus` exit **3**; `--by ""` → `REFUSED: --by is required …` exit **4**; `--by cron` → `REFUSED: refused: 'cron' is not a human identity …` exit **4**; missing `--note` → argparse error exit **2** |
| Command that shows the sub-claim **FAILS** | `--by "autopilot"` → `recorded APPROVED … by autopilot` exit **0**. `_normalise_decider` is a 10-string **denylist** (`NON_HUMAN_DECIDERS = {system, routine, automation, agent, cron, scheduler, monitor, bot, script, machine}`, `:55-57`), so any other non-human token is accepted. Independently reproduces the sibling session's finding F-A. |
| Verdict | **PASS** for "anything that is not a read becomes a PENDING item, and no code path executes an approved item"; **PARTIAL** for "the decision is provably made by a person" — the guard is a denylist and is bypassable by any name not on it. Not a U4 violation of the operator rule (nothing executes either way), but the audit trail can record a non-human decider as if it were a human. |

**What the existing rule gate can and cannot see** (`scripts/monitoring/rule_gate_verify.py`, 47 KB, runnable, fail-closed):
- *Can* see: per-file static token/AST/call-shape evidence; it fails a non-parsing or write-shaped target correctly (negative control on a `requests.post(.../withdraw)` file → `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`, exit 1).
- *Cannot* see: a package. Pointed at the directory it dies (`PermissionError: [Errno 13] Permission denied: 'monitoring\freecash'`); pointed at `run_daily_check.py` it reports `R1=FAIL` because the lock lives in `gate.py`; pointed at `gate.py` it reports `R3/R4=FAIL` for the same scope reason **and** `R1=FAIL` on a false positive — it reads `cursor = last + timedelta(days=1)` (missed-day arithmetic, `gate.py:220`) as "a rolling 24h window".
- Consequence: **no verdict in this matrix is sourced from that gate.** It is quoted only as the negative control for U1 and as the demonstration of its own scope. A package-scope gate exists from the sibling session at `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/rule_gate.py` (with `--package` / `--self-test`); I did **not** run it and did not create a third gate file.

---

## §3 Idempotence, day key, DST and sleep-through

**Idempotence (verified).** Two invocations on the same local day produce one read:
`RUN_OK … lock=2026-10-01.lock` then `SKIP_DUPLICATE_DAY 2026-10-01` (exit 0). The duplicate branch (a) writes exactly one alert line, (b) takes no second lock, (c) performs no read, (d) writes no snapshot, (e) does not advance the ledger. Observed after the second run: `alert_event_counts= {'MONITOR_DEGRADED': 1, 'SKIP_DUPLICATE_DAY': 1}`, `state/day-locks/ = 2026-10-01.lock` (one file), 5 files total under the root.

Supporting invariants (code-read, exercised by the suite): `changedetect.save_snapshot` never overwrites an existing snapshot (`:185-189`); the prior snapshot is loaded **before** the new one is written (`run_daily_check.py:402-405`) so a re-run can never compare a snapshot with itself; `paths.ensure_layout()` and `operator_state.ensure_template()` create only what is missing; `notify.record_notified_key` rewrites the same entry rather than appending. The dedupe key contains the day, so the *same* change on a later day notifies again by design (a new key), while a same-day re-run cannot double-notify because R1 blocks it before the compare stage.

**Day key (verified).** `gate.day_key` = `now.astimezone(Europe/Berlin).date().isoformat()`; resolved kind `zoneinfo` under the venv interpreter, `tzdata: ()` (the `tzdata` pip package supplies the database).

Fall-back 2026-10-25 (25-hour local day) — hourly UTC instants, raw output:

```
2026-10-24T21:59:00Z -> 2026-10-24 23:59 +0200 day_key= 2026-10-24
2026-10-24T22:00:00Z -> 2026-10-25 00:00 +0200 day_key= 2026-10-25
2026-10-25T00:59:00Z -> 2026-10-25 02:59 +0200 day_key= 2026-10-25
2026-10-25T01:00:00Z -> 2026-10-25 02:00 +0100 day_key= 2026-10-25   (02:00 occurs twice)
2026-10-25T01:30:00Z -> 2026-10-25 02:30 +0100 day_key= 2026-10-25
2026-10-25T22:59:00Z -> 2026-10-25 23:59 +0100 day_key= 2026-10-25
2026-10-25T23:00:00Z -> 2026-10-26 00:00 +0100 day_key= 2026-10-26   (key flips at local midnight)
```

Spring-forward 2026-03-29 (23-hour local day): `2026-03-28T22:59Z -> 2026-03-28 23:59 +0100 (28)`; `2026-03-28T23:00Z -> 2026-03-29 00:00 +0100 (29)`; `2026-03-29T00:30Z -> 2026-03-29 01:30 +0100 (29)`; `2026-03-29T01:00Z -> 2026-03-29 03:00 +0200 (29)`; `2026-03-29T20:00Z -> 2026-03-29 22:00 +0200 (29)`.

- **Same-day delay on a 25-hour day:** fires at 19:00 and 23:00 local → `2026-10-25T17:00Z -> 18:00 +0100 (2026-10-25)` and `2026-10-25T22:00Z -> 23:00 +0100 (2026-10-25)`. One key, one lock, one read. No double-read, no lost day.
- **Missed-day arithmetic is calendar-based, not a 24 h window:** `missed_days('2026-03-29', {last_success:'2026-03-27'}) = ['2026-03-28']`; `missed_days('2026-10-26', {last_success:'2026-10-24'}) = ['2026-10-25']`.
- **Sleep-through:** a machine asleep at the fire time takes no lock (nothing ran). Woken later the *same* local day → same key → the day is checked normally, no phantom missed day, no double count. Woken the *next* day → today is checked and the skipped day surfaces as an in-band `MISSED_DAY` at S1 (§4) and, on the skipped evening, at S9. A machine that never wakes produces no local signal at all; the gap is only visible at the next run, so the DoD requires a human read of `last_attempt_day` (§8 D12).
- **Naive clocks:** `gate.day_key(datetime(2026,10,1,23,30))` (naive) is treated as UTC → `2026-10-02`; the routine itself always passes aware UTC (`paths.now_utc`), so this only bites a hand-rolled wrapper.
- **Interpreter is part of the day key.** venv python 3.11.9 → `Europe/Berlin` resolved. `py -3` (3.14.7) → `ModuleNotFoundError: No module named 'tzdata'` → `ZoneInfoNotFoundError`, and the routine degrades with `WARNING timezone_unavailable configured=Europe/Berlin offset=+0200` while still exiting 0. Any arming must pin the venv interpreter; a `py -3` task would silently key days off the machine's own zone.

---

## §4 Missed-day path and reading-less-day path

Both cases below were reproduced end-to-end in throwaway roots.

### 4.1 Missed day (the routine did not run on day D) — payloads = **N, one per missed day**

Detection is in-band at the next run: `gate.missed_days(day, ledger)` returns every local calendar day strictly between `last_success_day` and today, and `run_daily_check.py:331-347` emits **one `MISSED_DAY` alert per day** (severity `alert`, each with its own dedupe key), then proceeds with today's check. It never back-fills a missed day (a second read of a past day would defeat R1).

Measured: seeded `last_success_day = 2026-09-21`, run on 2026-10-01 →

```
RUN_OK 2026-10-01 outcome=INITIAL_BASELINE … changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
alert_event_counts= {'MISSED_DAY': 9, 'INITIAL_BASELINE': 1}
MISSED_DAY 2026-10-01 2026-09-22 alert 2918a891ffb9
MISSED_DAY 2026-10-01 2026-09-23 alert 28135c62ac7b        … (one per day)
MISSED_DAY 2026-10-01 2026-09-30 alert 23509d892322
```

- The operator receives **9 separate payloads** (9 toasts via the real channel, 9 log lines) for 9 missed days, each naming one day and the consecutive count — correct per U3 (no duplicate alert for the same change) but unusable as a notification surface. This matches the previously observed 9 `MISSED_DAY` alerts in 65 s.
- The same-evening detector is `watchdog.py`: at most **one** `MISSED_DAY` per local day (dedupe key checked first, `:79-91`); a second evening run prints `WATCHDOG_MISSED_DAY … coverage=DEDUPED` and adds nothing; exit is always 0.
- Recommended change (**not made** — a design decision, needs approval): coalesce the missed-day emission into one summary that names N and the day keys, exactly as `notify_changes` already does for >5 changes (`run_daily_check.py:207-213`).

### 4.2 Reading-less day (the routine ran, nothing was read) — payloads = **1, and it is not an alarm**

Seeded: a fresh root with no operator record, run today →

```
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
last_success_day: 2026-10-01   last_outcome: MONITOR_DEGRADED
snapshot: {'degraded': True, 'account_status': None, 'earnings_total_cents': None, 'balance_cents': None, 'pending_cents': None, 'raw_response_sha256': 'e3b0c442…b855'}
watchdog: WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=MONITOR_DEGRADED
alert_event_counts= {'MONITOR_DEGRADED': 1}
```

- Exactly **one** payload reaches the operator, severity `info`: *"No data for 2026-10-01 (no operator-entered record …). Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists."*
- The watchdog adds **zero** payloads — it reports the day covered, because `covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` and `MONITOR_DEGRADED` **is** in `SUCCESS_OUTCOMES` (`gate.py:32-41`, `watchdog.py:33`).
- Net effect: a day on which nothing was read is booked as a success day, the day lock is spent, recovery is refused by design, and the only alarm that exists for "we learned nothing" stays silent. This is the exact state production is in today (`last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, 4 alert lines of type `MONITOR_DEGRADED`/`SKIP_DUPLICATE_DAY`/`MISSED_DAY`, `approvals/` empty).
- **Prevention, two parts.**
  1. *Workflow (in this plan, runnable today):* **S0** refuses to fire when today's reading is absent (exit 9, nothing claimed, nothing written — verified), and **S8** verifies after any run that `snapshot.source.data_available` equals `last_success_day == today`, exiting 1 with `UNREAD_DAY_NOT_A_SUCCESS_DAY` (verified: exit 1 on the reading-less root, exit 0 on the reading-bearing root). An `UNREAD_DAY` line appended to `alerts/alerts.jsonl` is the operator-visible artifact.
  2. *Code (a required change, **NOT made** — editing `monitoring/freecash/` is outside this track's write scope; both are one-liners):* drop `"MONITOR_DEGRADED"` from `gate.py:32-41 SUCCESS_OUTCOMES`, and tighten `watchdog.py:33` so coverage also requires today's snapshot to carry a reading. Until then S0/S8 are the only barrier, and they only hold if the wrapper actually runs S0 — so the arming option in §7 A4 (wrapper-first) is the recommended one.

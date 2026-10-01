# Free Cash Finance Automation — Daily Status Monitoring Workflow Plan

Status: DESIGN + PLAN ONLY. Nothing here has been executed against a provider, no repo
file was modified, and the monitor described below was NOT built by this document.

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| `EVIDENCED` | I ran the command and read the output. The command is quoted. |
| `PROPOSED` | A design decision. Not yet built. |
| `UNKNOWN/NEEDS-RESEARCH` | Genuinely unknowable from what I can see. |

Author context: repository `D:\AgenticOS` on Windows 11; terminal is git-bash; node v24.20.0;
`py -3` resolves to `C:\Python314\python.exe` (3.14.7) `EVIDENCED`
(`py -3 -c "import sys; print(sys.executable)"` → `C:\Python314\python.exe`).

---

## 0. Executive summary

1. **The single source of truth already exists and is the right one: `monitoring/freecash/`.**
   It is the only candidate in the repo where all four rules map to an enforced *code*
   mechanism instead of prose. It is also **RED**: 18 of 52 of its own tests do not pass,
   and the R2 static gate fails on the routine's own tree. Chosen home, but it must be
   repaired to green before it is scheduled.
2. **The four rules are enforced by construction**, not documentation, once six named defects
   are fixed (§3). Two of those defects are total blockers: the R3/R4 change path raises
   `NameError` on every real change, and the R1 ledger loses `last_attempt_day` on every run.
3. **There are 10+ overlapping implementations.** Exactly one is kept as the monitor; the rest
   get an explicit disposition so a seventh is never added (§9).
4. **`server/scripts/verify-freecash-rules.mjs` prints "4/4 PASSED" for a file that does not
   parse.** It must be deleted-later, not trusted. A verifier that cannot fail certifies
   nothing; every verifier below ships with a proven negative control.
5. **The routine has never run in production**: `data/freecash-monitor/` does not exist
   `EVIDENCED` (`ls -la data/freecash-monitor/` → `NO data/freecash-monitor dir`).

---

## 1. Chosen implementation home and how it was chosen

### 1.1 Decision

| | |
|---|---|
| **Implementation home (single source of truth)** | `D:\AgenticOS\monitoring\freecash\` — Python 3.14 stdlib-only package, 10 modules, 52-test offline suite |
| **Entry point** | `monitoring/freecash/run_daily_check.py` |
| **Second detector** | `monitoring/freecash/watchdog.py` (23:50 same-day "did the check run?" alarm) |
| **R2 static gate** | `docs/free-cash-monitor-routine/verify-readonly.sh` + its Python port `monitoring/freecash/verify_readonly.py` |
| **R1–R4 structural verifier** | `scripts/monitoring/rule_gate_verify.py` (must be extended, §8.3) |
| **Design authority (read-only reference)** | `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md`, `RULE-GATE-CHECKLIST.md` |

### 1.2 Why this one

Only this candidate has, already written and already *tested* (passing tests cited), the
mechanisms the rules require:

- an atomic exclusive-create day lock (`gate.py::acquire_day_lock`) rather than an
  `if exists` check — `EVIDENCED` passing test `test_second_run_skips_with_no_side_effects`;
- a deny-by-default transport with a method/path/host allowlist that refuses *before* the
  single socket site (`readonly_client.py::request`) — `EVIDENCED` passing tests
  `test_write_method_is_refused_before_any_socket_opens`,
  `test_every_non_read_method_is_refused`, `test_non_loopback_host_is_refused`,
  `test_body_carrying_get_is_refused`;
- prior-state load **before** snapshot write (`run_daily_check.py:399` then `:402`);
- a dedupe key recorded **before** dispatch (`notify.py::dispatch`);
- an approval queue whose `expires_at_utc` / `execution_state` fields are frozen constants
  (`approval_queue.py`), plus a passing static test that no module reads an `APPROVED` status
  to act — `EVIDENCED` passing `test_no_module_treats_an_approved_status_as_a_trigger`.

The two obvious alternatives are disqualified by construction:
`finance-monitor/` contains `src/action_executor.py` (an execution path → R2 conflict), and
`server/scripts/freecash-daily-monitor.mjs` does not parse (§9).

### 1.3 Honest state of the chosen home

`EVIDENCED` — `py -3 D:/AgenticOS/monitoring/freecash/tests/run_all.py`:

```
run_all: tests=52 failures=7 errors=11 skipped=0
EXIT=1
```

`EVIDENCED` — `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash`:

```
[verify-readonly] forbidden=2 exempt=27 missing_targets=0
[verify-readonly] FAIL — R2 violation: an earning/write action path exists in a read-only routine.
EXIT=1
```

So: **correct architecture, not yet green.** Phase 0 (§7) is the repair list.

---

## 2. Rule → mechanism matrix

Every row names an enforcing symbol, the observable proof, and the residual failure mode.
Rows marked `(after Phase 0 fix)` do not hold yet — see §3 for the exact defect.

| Rule | Enforced by (file / symbol) | Evidence / observable proof | Failure mode if it regresses |
|---|---|---|---|
| **R1** exactly one status check per calendar day | `gate.py::acquire_day_lock()` → `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`. The filename *is* the day key; the file is zero bytes so a partial write cannot be misread. `state/last-run.json` is **never** the gate. | `EVIDENCED` passing: `test_second_run_skips_with_no_side_effects` (2nd run prints `SKIP_DUPLICATE_DAY`, snapshot mtime unchanged, ledger bytes unchanged, 0 pending items). Runtime line: `RUN_OK 2026-09-19 ... lock=2026-09-19.lock`. | Two reads in one day. Mitigated by a second layer: Task Scheduler `-MultipleInstances IgnoreNew`. |
| **R1** one winner under concurrent runs | same O_EXCL syscall; no read-then-write window | `EVIDENCED`: 5 concurrent subprocesses → outputs `RUN_OK` ×1 and `SKIP_DUPLICATE_DAY` ×4, 1 snapshot, 1 lock, all 5 exit 0 (reproduced outside the repo). | N identical runs fan out to N reads. |
| **R1** locale-independent day key | `gate.py::day_key()` → `now.astimezone(zone(tz)).date().isoformat()` — an ISO `YYYY-MM-DD` string, sortable, no epoch, no `toDateString()` | `EVIDENCED` passing `test_local_day_differs_from_utc_day_near_midnight`: `2026-09-17T22:30Z` → `2026-09-18` for `Europe/Berlin`, `2026-09-17` for `UTC`. | Day boundary drifts with locale; duplicate or skipped days. **Currently degraded** — tzdata missing (§3 D4). |
| **R1** missed day is loud, never back-filled | `gate.py::missed_days()` (in-band, at the next run) **and** `watchdog.py::check()` (same evening 23:50) | `EVIDENCED` passing `test_missed_days_are_reported_and_not_backfilled` (2 `MISSED_DAY` lines, `consecutive_missed_days=2`, no back-fill snapshot) and `test_no_missed_day_for_the_pre_history_period`. `WATCHDOG_MISSED_DAY <day> ... coverage=NOTIFIED`. | A silently skipped day goes unnoticed. |
| **R2** zero automated earning actions — transport level | `readonly_client.py::request()`: `ALLOWED_METHODS={GET,HEAD}`, `ALLOWED_PATHS` = exactly `^/api/v1/status/metrics$` and `^/api/v1/status$`, `ALLOWED_HOSTS={localhost,127.0.0.1,::1}`, body keywords (`data/json/files/body/content`) refused, unknown kwargs refused. Raises `ForbiddenWriteError` **before** `_transport()` — the only socket site in the routine. | `EVIDENCED` passing: `test_write_method_is_refused_before_any_socket_opens` also asserts `self.calls == []` (**the transport was never reached**) and no alert file was created; `test_every_non_read_method_is_refused` (PUT/PATCH/DELETE/TRACE/OPTIONS/CONNECT); `test_non_allowlisted_path_is_refused`; `test_body_carrying_get_is_refused`; `test_non_loopback_host_is_refused`; `test_bare_get_reaches_the_loopback_stub` (server recorded only `GET`). | A write reaches a provider. |
| **R2** zero automated earning actions — process level | `readonly_client.py::install_audit_guard()` → `sys.addaudithook` aborting `socket.connect`/`socket.getaddrinfo` to any non-loopback host | `EVIDENCED` passing `test_audit_guard_refuses_a_non_loopback_connect` (`provider.invalid` raises `ForbiddenWriteError`; `127.0.0.1` and unrelated `open` events pass through). | A dependency opens a socket the allowlist never saw. |
| **R2** zero automated earning actions — CI/text level | `docs/free-cash-monitor-routine/verify-readonly.sh` and `monitoring/freecash/verify_readonly.py`, six token classes: http-verb, write-call-shape, earning-verb (`claim\|withdraw\|cashout\|redeem\|payout\|…`), earning-action (`…\|request_payout`), write-endpoint-path (`/cashout`, `/transactions`, `/claim`, …), account-mutation. Per-line exemption requires the inline marker `readonly-exempt: <reason>`. Exit 0 clean / 1 forbidden found / 2 target missing (= **not** a pass). | `FAILS AS REQUIRED` `EVIDENCED`: `test_shipped_shell_checker_fails_on_a_planted_violation` (planted `requests.post('…/status/claim')` → nonzero exit, `FORBIDDEN`, correct `file:line`), and `test_missing_target_is_not_a_pass` → exit 2. **But the gate is RED on the routine's own tree** (§3 D5). | Forbidden token ships unnoticed, or the exemption budget erodes silently. Baseline to track: `exempt=27` `EVIDENCED`. |
| **R2** the routine contains no execution path at all | `approval_queue.py` writes `execution_state` only as the constant `NOT_EXECUTED`; `execution_allowed_by_this_routine` is always `False` | `EVIDENCED` passing `test_no_module_treats_an_approved_status_as_a_trigger` and `test_only_the_readonly_client_may_reach_a_socket_library`. | An `APPROVED` row becomes a trigger. |
| **R3** notify on earnings / status change | `changedetect.py::compare()` over four fields — `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`; exact integer cents, no relative/percentage threshold | `EVIDENCED` passing `test_one_cent_is_a_change_because_cents_are_exact` semantics reproduced via the suite; `test_currency_change_is_degraded_not_a_change`; `test_prior_without_data_is_a_baseline_not_a_change`. **Change-path tests currently ERROR** (§3 D1). | A real 1-cent or status movement is swallowed. |
| **R3** the comparison can never be against itself | `run_daily_check.py:399` `prior = changedetect.load_prior_snapshot(day)` runs **before** `:402 save_snapshot(...)`; `save_snapshot` refuses to overwrite an existing day file (`if path.exists(): return path, False`) | `EVIDENCED` by reading both line numbers and the `save_snapshot` early-return; `EVIDENCED` passing `test_snapshot_is_immutable_once_written`. This is the exact inversion of the legacy `free-cash-daily-check.py` anti-pattern (§9). | `previous == current` forever → change detection is impossible and always reports "no change". |
| **R3** exactly one notification per change | `changedetect.py::dedupe_key()` = `sha256(day_key\|change_type\|field\|old\|new)`; `notify.py::dispatch()` calls `record_notified_key(key, QUEUED)` **before** the first send attempt; `notified-keys.json` is written atomically | `EVIDENCED` passing `test_same_key_is_never_notified_twice_and_the_key_includes_the_day`. Day key is inside the key, so a genuinely repeated change on a later day does notify again. | Notification storm on every run. |
| **R3** no-change day is one quiet line, not silence | `notify.py::emit_no_change()` → one `OK_NO_CHANGE` line, `severity=info`, **log-only, never dispatches** | `EVIDENCED` passing `test_no_change_day_is_log_only`. Observed line: `RUN_OK 2026-10-02 outcome=OK_NO_CHANGE ... notifications=0`. | Silence, which reads as "the monitor is broken" — or a daily spam. |
| **R3** delivery failure is bounded and loud | `notify.py::dispatch()` — max 2 attempts, then `DELIVERY_FAILED` carrying the **full original message**, then `MONITOR_DEGRADED`; the key is marked `FAILED_TOAST` and never retried | `EVIDENCED` `test_delivery_failure_is_bounded_and_keeps_the_full_message` currently ERRORs on the upstream `NameError` (§3 D1); the two-alert design is `EVIDENCED` by reading `dispatch()`. | A failed toast is silently lost, or retried forever. |
| **R4** the monitor only ever QUEUES | `approval_queue.py::enqueue()` — called only on a real change; enqueueing is "a notification with a handle" | `EVIDENCED`: `run_daily_check.py:151` is the sole call site; `RUN_OK … approvals=N`. Currently ERRORs on the change path (§3 D1). | A change silently never reaches a human. |
| **R4** a human, and only a human, decides | `approval_queue.py::decide()` CLI requires `--by`, `--note`; `NON_HUMAN_DECIDERS = {system, routine, automation, agent, cron, scheduler, monitor, bot, script, machine}` → `NotHumanError`, exit 4 | `EVIDENCED` by reading `_normalise_decider` + the CLI exit-code mapping. `EVIDENCED` passing `test_documented_cli_invocation…` is currently ERROR (§3 D1). | A machine signs its own consent. |
| **R4** a stale/expired approval can never fire late | **There is no expiry at all.** `expires_at_utc` is the frozen constant `NO_EXPIRY = None`; `decide()` re-asserts `expires_at_utc=None`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False` *after* recording a decision | `EVIDENCED` passing `test_past_expiry_plus_approved_status_executes_nothing`, and a live `approval_queue.py list` output showing `expires_at_utc=2025-12-08T09:00:00Z execution_state=NOT_EXECUTED` — an APPROVED row four months past its own expiry and still not executed. | The classic laundering step "expired, therefore execute". Unreachable: no code path converts any status into an action. |
| **R4** nothing in the monitor path can execute an approval | no execution code path exists in the package; a static test enforces it | `EVIDENCED` passing `test_no_module_treats_an_approved_status_as_a_trigger` and `test_only_the_readonly_client_may_reach_a_socket_library`. | — |

---

## 3. Defects that must be fixed before any of the above is true in production (Phase 0)

All six are `EVIDENCED`. This list is the Phase 0 work order.

| # | Rule | Defect | Evidence | Fix (PROPOSED) |
|---|---|---|---|---|
| **D1** | R3, R4, R5 | `approval_queue.py:111` references `ACTION_LABEL_REQUEST_PAYOUT`, which **does not exist**. The defined constant is `ACTION_LABEL_FOR_HUMAN_REVIEW` (line 52). Every change path raises `NameError`. | `EVIDENCED`: 11 of the 18 non-passing tests traceback to `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined` at `approval_queue.py:111`. **The change → notify → enqueue pipeline has never worked end-to-end.** | Rename the reference to `ACTION_LABEL_FOR_HUMAN_REVIEW`. This single edit turns 11 ERRORs into real assertions. |
| **D2** | R1, R5 | `gate.record_attempt()` and `gate.record_outcome()` each do `ledger = dict(ledger)` and save their own **copy**. The caller's in-memory ledger is never updated between the two writes, so the final `record_outcome` write resurrects a stale copy and nulls the attempt fields. | `EVIDENCED` (reproduced outside the repo, single run, no concurrency): after `RUN_OK 2026-09-19 outcome=INITIAL_BASELINE`, the ledger on disk is `{"last_attempt_day": null, "last_success_day": "2026-09-19", "last_outcome": "INITIAL_BASELINE", …}`. `last_attempt_day` is `null` after **every** successful run. | Have `record_attempt`/`record_outcome` mutate and return the caller's ledger (or re-`load_ledger()` inside `record_outcome`). Assert `last_attempt_day == today` in a single-run test. |
| **D3** | R1 (watchdog) | **Consequence of D2**: `watchdog.evaluate()` computes `covered = (last_attempt_day == today) and outcome in SUCCESS_OUTCOMES`. With `last_attempt_day` always `null`, the watchdog raises a **false MISSED_DAY alarm on a perfectly healthy day**. | `EVIDENCED`: `test_healthy_day_raises_no_alarm` → `AssertionError: False is not true` on `state["covered"]`, and a live `WATCHDOG_MISSED_DAY 2026-09-19 last_attempt_day=None last_outcome=INITIAL_BASELINE`. | Fixed by D2; add a regression test that a healthy run is `covered=True`. |
| **D4** | R1 | `tzdata` is not installed, so `zoneinfo` cannot resolve `Europe/Berlin`; the routine silently falls back to the machine's local zone and emits `MONITOR_DEGRADED`. The day key is therefore **not** the configured wall clock. | `EVIDENCED`: `py -3 -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Berlin')"` → `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'`; `gate.timezone_report()` → `{'configured': 'Europe/Berlin', 'kind': 'system-local', 'available': False, 'offset_now': '+0200'}`. Also causes `test_first_run_without_data…` to see 2 `MONITOR_DEGRADED` lines instead of 1. | Install `tzdata` (`py -3 -m pip install tzdata`) **or** set `FREECASH_TZ` to an explicit fixed offset. The fail-closed behaviour is already correct — it degrades loudly rather than pretending. |
| **D5** | R2 | The R2 static gate **fails on the routine's own tree**: two unexempted forbidden tokens. | `EVIDENCED` `verify-readonly.sh monitoring/freecash` → `forbidden=2`, `EXIT=1`; `verify_readonly.py` → `EXIT=1`. Findings: `approval_queue.py:111` (`earning-action`, matched on `request_payout` — the same line as D1) and `tests/test_r4_approval.py:283` (`write-call-shape`, matched on the literal `"http.client"` inside an `assertNotIn` — the test that *proves* R2 flags itself). | Fix D1 by naming the constant (removes finding 1). Mark the second with the inline marker (`readonly-exempt: the assertion string, not a call`) or build the token from parts. Then re-scan for `forbidden=0`. |
| **D6** | R3 | `notify.notify_change()` hardcodes `severity=SEVERITY_NOTIFY` for the dispatch path instead of `default_severity(change["change_type"])`, so an alert-class event is downgraded. | `EVIDENCED`: `test_missing_check_raises_one_alarm_and_changes_no_state` → `AssertionError: 'notify' != 'alert'`. `MISSED_DAY` is in `notify._ALERT_EVENTS`, so `default_severity` would return `alert`. | Use `default_severity()`; re-assert the severity in the test. |

Additionally, two **test-suite defects** must be fixed or "green" is unreachable, because they
are assertions that can never hold:

| # | Defect | Evidence |
|---|---|---|
| **D7** | `test_r1_gate.py:33` asserts `assertIn("Europe/Berlin", str(env.root))` — that the **temporary data-root path** contains the configured timezone name. It is an assertion about a filesystem path, not about the day key. | `EVIDENCED`: `AssertionError: 'Europe/Berlin' not found in 'C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-test-s_osodmz\\freecash-monitor'`. |
| **D8** | `test_r5_smoke.py::test_first_run_without_data…` expects exactly 1 `MONITOR_DEGRADED` line; with the tz fallback (D4) there are legitimately 2. | `EVIDENCED`: `AssertionError: 2 != 1` listing the timezone line plus the no-data line. |

**Also dead code:** `gate.py::clock_moved_backwards()` (line 232) has **zero call sites**
`EVIDENCED` (`grep -rn "clock_moved_backwards" monitoring/` → only the definition and bytecode).
There is therefore **no clock-rollback detection in the run path** — see §6.5.

---

## 4. Day-lock mechanism (R1) — concrete specification

### 4.1 What exists and holds (EVIDENCED)

| Aspect | Value |
|---|---|
| Lock path | `<data root>/state/day-locks/<YYYY-MM-DD>.lock` |
| Data root | `D:/AgenticOS/data/freecash-monitor` (override: `FREECASH_DATA_ROOT`) |
| Create call | `os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)` — one atomic syscall on NTFS |
| Content | **zero bytes** — presence *is* the day key; a partial write cannot be misread |
| Day key | `datetime.now(zone).date().isoformat()` → `2026-09-19`. Locale-independent, sortable, not raw epoch, not `toDateString()` |
| Same-day restart | `FileExistsError` → `SKIP_DUPLICATE_DAY <day>` printed, **exactly one** `SKIP_DUPLICATE_DAY` alert line, exit **0**, and **no read, no snapshot write, no ledger write** |
| After a missed day | `gate.missed_days()` emits one `MISSED_DAY` line per uncovered day. **Never back-filled** — a second read of a past day would itself violate R1 |
| Fail-closed | Anything wrong with the lock means "do not read" |

`EVIDENCED` passing: `test_second_run_skips_with_no_side_effects` asserts the second run
leaves the snapshot mtime, the ledger bytes and the pending queue byte-identical.

### 4.2 The gap this plan closes (PROPOSED)

The lock is consumed **before** the status read. If the process dies between the lock and the
snapshot (crash, power loss, killed task), the day is consumed with no snapshot and no record —
a **silent lost day**, and the next day's run will report it only as an anonymous `MISSED_DAY`.

PROPOSED addition — a **run manifest** that makes the artifact triple self-verifying:

`<data root>/state/runs/<YYYY-MM-DD>.json`, written atomically (temp file + `os.replace`, as
`paths.write_json_atomic` already does):

```json
{
  "schema_version": 1,
  "day_key": "2026-09-19",
  "lock_path": "state/day-locks/2026-09-19.lock",
  "lock_created_at_utc": "2026-09-19T06:35:02Z",
  "pid": 12345,
  "command": "C:\\Python314\\python.exe monitoring/freecash/run_daily_check.py",
  "outcome": "OK_NO_CHANGE",
  "source_kind": "operator_entered",
  "data_available": true,
  "snapshot_file": "snapshots/2026-09-19.json",
  "snapshot_sha256": "…",
  "channel_delivery": "TOAST_OK",
  "schema_version_of_snapshot": 1
}
```

PROPOSED self-verification function `gate.verify_day_artifacts(day)`, observable output:

```
DAY_ARTIFACTS day=2026-09-19 lock=yes manifest=yes snapshot=yes sha_match=yes verdict=COMPLETE
```

Non-zero exit and `verdict=PARTIAL` when the lock exists but the manifest or snapshot does not
— i.e. **crashed after consuming the day** — which is exactly the silent-lost-day case, now
loud. This also gives the "how is the lock proven to have been created" answer: the lock alone
proves *consumption*; lock + manifest + snapshot + matching SHA-256 proves *completion*.

### 4.3 Day-lock behaviours to assert (acceptance)

| Scenario | Expected observable |
|---|---|
| First ever run | `RUN_OK <day> … written=True lock=<day>.lock`; lock + manifest + snapshot all present |
| Immediate restart, same day | `SKIP_DUPLICATE_DAY <day>`, exit 0, snapshot mtime and ledger bytes unchanged, exactly 1 new alert line |
| 5 concurrent runs | `RUN_OK` ×1, `SKIP_DUPLICATE_DAY` ×4, 1 lock, 1 snapshot, all exit 0 |
| 3 days missed | 2 `MISSED_DAY` lines, `consecutive_missed_days=2`, **no** snapshots written for the missed days |
| Crash after lock | `DAY_ARTIFACTS … verdict=PARTIAL` + a `MONITOR_DEGRADED` alert. No automatic re-read (R1 holds) |
| Clock rolled backwards | `clock_moved_backwards()` becomes **called** (D-fix) and emits a `MONITOR_DEGRADED` alert; the routine does not create a second lock for a day it already consumed |

---

## 5. Snapshot / diff order (R3) — concrete specification

### 5.1 Order (EVIDENCED as already correct)

```
prior  = changedetect.load_prior_snapshot(day)     # run_daily_check.py:399  ← LOAD FIRST
snapshot = changedetect.build_snapshot(...)        # :400
verdict  = changedetect.compare(prior, snapshot)   # :401
snapshot_file, written = changedetect.save_snapshot(snapshot)   # :402  ← WRITE AFTER
```

`load_prior_snapshot(day)` picks the newest `snapshots/*.json` whose stem is `< day` by
lexicographic compare — correct for ISO `YYYY-MM-DD` stems. `save_snapshot` refuses to
overwrite (`if path.exists(): return path, False`), so a day's snapshot is immutable.

This is the deliberate inverse of the legacy `scripts/monitoring/free-cash-daily-check.py`,
which calls `save_snapshot(snapshot_data)` at line 266 and only then
`old_snapshot = load_snapshot()` at line 270 `EVIDENCED` — making `previous == current`
permanently and change detection structurally impossible. That file is superseded (§9).

### 5.2 Fields compared (exact, exhaustive)

| Field | Type | Change type | Notes |
|---|---|---|---|
| `account_status` | `str`, upper-cased | `STATUS_CHANGED` | e.g. `OPERATIVA → BLOQUEADA` |
| `earnings_total_cents` | `int` cents | `EARNINGS_CHANGED` | |
| `balance_cents` | `int` cents | `BALANCE_CHANGED` | |
| `pending_cents` | `int` cents | `EARNINGS_CHANGED` (subtype `pending`) | pending-fee delta |

Guards: no percentage/relative threshold (a 1-cent move is a change). A **missing** field is a
read failure, never a silent zero. If `currency` changed, money fields are skipped and a
`MONITOR_DEGRADED` note is emitted instead of a nonsense delta. If either side has
`data_available: false`, the day is a **baseline**, not a change — a first run can never
produce a fake alarm.

### 5.3 "Changed" vs "no change"

| Case | Outcome | Channel behaviour |
|---|---|---|
| No prior snapshot / no data either side | `INITIAL_BASELINE` | log-only, `severity=info`, **no dispatch** |
| All four fields equal | `OK_NO_CHANGE` | **log-only, one quiet line**, no dispatch |
| ≥1 field differs | e.g. `EARNINGS_CHANGED` | exactly one alert line per change + at most one notification per change |
| >5 distinct changes in one day | coalesce | individual notifications suppressed, **one** summary notification |
| Source had no data | `MONITOR_DEGRADED` | `severity=info`, nothing compared, nothing notified |

Every snapshot carries `"degraded": true` and a `source.kind`, so a "no change" report can
never be mistaken for a provider-verified one. (Today every source is a substitute: the
operator-entered file or the local metrics probe. `PROVIDER_ENDPOINT_UNKNOWN - resolve in
research phase` is a deliberate, greppable literal — no provider read path is invented.)

---

## 6. Notifications, approval queue, failure semantics

### 6.1 Channels

| Channel | Status | Notes |
|---|---|---|
| `alerts/alerts.jsonl` | **always on**, append-only via one `O_APPEND` write | The canonical evidence record. Never rewritten, never pruned. |
| Windows toast (PowerShell `NotifyIcon` balloon) | default delivery | Raises on failure so the retry/`DELIVERY_FAILED` path is exercised |
| Stub sender (`FREECASH_TOAST_STUB=1`) | offline tests | Delivery label `STUB_OK`, **never** `TOAST_OK`, so a stubbed run can never be mistaken for a real delivery |
| SMTP | opt-in, **OFF by default**, not wired to any credential | PROPOSED: wire via env/vault only, never in-repo |

### 6.2 Message template (EVIDENCED, from `notify.py`)

```
[FreeCash] EARNINGS CHANGE 2026-09-19
Earnings:  $10.25 -> $13.40  (+$3.15)
Balance:   $13.40 (changed too)
Pending:   $0.00
Status:    OPERATIVA (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-19)
Detail:    alerts.jsonl dedupe=9f2c1a4e8b7d3f01
ACTION:    No action taken. Review and approve anything you want done.
```

The `ACTION:` line is not decoration — it is the R4 statement, present on every dispatched
message, that the monitor did nothing and will do nothing.

### 6.3 Dedup key

```
dedupe_key = sha256("<day_key>|<change_type>|<field>|<old_value>|<new_value>")
```

- The day key is **inside** the key: a genuinely repeated change on a later day legitimately
  notifies again; a re-run inside one day cannot (R1 already prevents it).
- `notified-keys.json` records the key with delivery `QUEUED` **before** the first send attempt.
  A crash can therefore lose one message but can **never** duplicate one.
- A key marked `FAILED_TOAST` is never retried.

### 6.4 Approval-queue record schema (R4)

Storage: `<data root>/approvals/pending.json` (atomic writes) and
`<data root>/approvals/decided.jsonl` (append-only human decision trail).

```json
{
  "approval_id": "<uuid4>",
  "created_at_utc": "2026-09-19T06:35:04Z",
  "day_key": "2026-09-19",
  "change_dedupe_key": "<sha256 of the change that caused it>",
  "reason": "Earnings moved from $10.25 to $13.40. Review and decide whether any action is wanted.",
  "proposed_action": {
    "action_type": "REQUEST_PAYOUT",
    "amount_cents": 1340,
    "destination": "OPERATOR_SPECIFIED - not stored by the routine",
    "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
  },
  "status": "PENDING",
  "status_reason": null,
  "decided_at_utc": null,
  "decided_by": null,
  "decision_note": null,
  "expires_at_utc": null,
  "execution_state": "NOT_EXECUTED",
  "execution_allowed_by_this_routine": false
}
```

**Expiry / escalation policy — the deliberate inversion.** There is **no expiry**, because
expiry is the historical laundering mechanism ("expired, so execute"). The three frozen fields
are constants, not parameters: `expires_at_utc` is always `null`,
`execution_state` is always `NOT_EXECUTED`, `execution_allowed_by_this_routine` is always
`false` — and `decide()` **re-asserts all three after** recording a decision, so a human
approval cannot arm an item. Escalation is a *nag*: at most one reminder per item per 7 days,
which also never decides anything. A `PENDING` item waits indefinitely.
`EVIDENCED` live output from `approval_queue.py list`: an `APPROVED` item with
`expires_at_utc=2025-12-08T09:00:00Z` (four months past its own expiry) and
`execution_state=NOT_EXECUTED` — i.e. the expired-and-approved combination fired nothing.

**Guarantee that nothing in the monitor path can execute an approval.** Three independent
layers, each with an observable proof:
1. no execution code path exists in the package — static test
   `test_no_module_treats_an_approved_status_as_a_trigger` `EVIDENCED` PASSING;
2. only `readonly_client._transport()` may reach a socket library — static test
   `test_only_the_readonly_client_may_reach_a_socket_library` `EVIDENCED` PASSING;
3. no watchdog, timer, cron entry or scheduler retry may change a `PENDING` status — `EVIDENCED`
   PASSING `test_pending_item_survives_a_ninety_day_clock_advance`.

Human decision CLI (the only way a decision enters the system):

```
py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py list
py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide \
    --id <uuid> --decision approve|reject --by "<your name>" --note "<why>"
```

Exit codes: `0` recorded · `2` missing note/decision · `3` unknown id · `4` refused
non-human identity.

### 6.5 Failure semantics

| Failure | Behaviour | Status |
|---|---|---|
| Parse failure of the routine's own source | Python raises at import; the structural verifier is **fail-closed** — a target that does not parse gets every rule reported `FAIL`, never `PASS`. `EVIDENCED`: `rule_gate_verify.py server/scripts/freecash-daily-monitor.mjs` → `FAIL-CLOSED: node --check FAILED: SyntaxError: Unexpected token ':'` and `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`, exit 1. | EVIDENCED |
| Network / HTTP failure on an allowlisted read | `ReadError` → `exit 5`, `RUN_FAILED <day> reason=…` alert (message includes "Day lock: CONSUMED (no automatic re-run today - R1)"), day lock **stays**, no snapshot, no retry. `EVIDENCED` PASSING `test_read_failure_is_loud_consumes_the_day_and_never_retries`; the second run of the same day then prints `SKIP_DUPLICATE_DAY`. | EVIDENCED |
| Schema drift / missing field | `MetricError` → treated as a read failure (exit 5), **not** a silent zero. `EVIDENCED` PASSING `test_missing_field_in_the_payload_is_a_read_failure` (stdout names `pending_cents`). | EVIDENCED |
| Clock / timezone | `MONITOR_DEGRADED` on tz change, checked against the ledger's recorded tz. **Gap:** `tzdata` absent (D4) → falls back to the machine zone and says so; and `clock_moved_backwards()` is dead code (D-fix) → **no rollback detection today**. | PARTIAL |
| Concurrent runs | O_EXCL single winner (EVIDENCED, 5 processes → 1 winner) **plus** Task Scheduler `-MultipleInstances IgnoreNew`. Atomic writes: unique temp file + `os.replace`; append-only log via a single `O_APPEND` write that verifies the byte count. | EVIDENCED |
| Crash after the lock, before the snapshot | **Today: silent lost day.** PROPOSED: the run manifest + `verify_day_artifacts()` → `verdict=PARTIAL` + `MONITOR_DEGRADED` alert (§4.2). | PROPOSED |
| Unexpected exception in the monitor | Propagates out of `main()` → **non-zero exit**, so the scheduler sees failure. Never a silent `exit 0`. | EVIDENCED (read of `main()`/`run()`) |
| Unexplained zero-snapshot day | `watchdog.py` at 23:50 emits `WATCHDOG_MISSED_DAY … coverage=NOTIFIED` if today's attempt/outcome is not a success. `watchdog.py` deliberately opens no socket, writes no ledger, creates no lock, touches no queue, and always exits 0 (it must never fail a scheduler slot). | EVIDENCED (2 of its 3 tests currently FAIL via D2/D6) |

---

## 7. Scheduling and manual operation

Two tasks. Both are `PROPOSED` registrations; neither exists on this host today —
`EVIDENCED` `schtasks /query /fo LIST` shows no `FreeCash-Daily-Monitor` and no
`FreeCash-Missed-Day-Watchdog`.

**Interpreter trap (important).** `python` on PATH resolves to the Hermes venv Python 3.11.9,
while `py -3` resolves to `C:\Python314\python.exe` (3.14.7) `EVIDENCED`
(`which -a python` → `.../hermes-agent/venv/Scripts/python` first). Task Scheduler does not
read bash aliases, so the registered command **must** use the absolute interpreter path.

### Task A — the daily check

```
schtasks /Create /TN "FreeCash-Daily-Monitor" /F /SC DAILY /ST 08:35 \
  /TR "C:\Python314\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py" \
  /RL LIMITED
schtasks /Change /TN "FreeCash-Daily-Monitor" /IT
# then set in Task Scheduler UI / XML:
#   Settings/MultipleInstances        = IgnoreNew     (second layer under R1)
#   Settings/StartWhenAvailable       = true          (a slept-through slot still runs once)
#   Settings/RestartOnFailure         = Do not restart (no catch-up storm under R1)
#   Settings/ExecutionTimeLimit       = PT10M
```

Log destination (PROPOSED): `D:\AgenticOS\data\freecash-monitor\logs\run-<YYYY-MM-DD>.log`,
via task action redirection; retention 30 days (`changedetect.prune_old_artifacts`). The
append-only `alerts/alerts.jsonl` and `approvals/decided.jsonl` are **never** pruned.

`-MultipleInstances IgnoreNew` and `Do not restart` are the two Task Scheduler settings that
make R1 hold even if the routine's own lock were ever bypassed, and they are the reason a
slept-through slot produces one run rather than a catch-up storm.

### Task B — the same-day watchdog

```
schtasks /Create /TN "FreeCash-Missed-Day-Watchdog" /F /SC DAILY /ST 23:50 \
  /TR "C:\Python314\python.exe D:\AgenticOS\monitoring\freecash\watchdog.py" \
  /RL LIMITED
```

### Manual commands

```
# dry inspection only (no read, no write)
py -3 D:/AgenticOS/monitoring/freecash/run_daily_check.py --print-state

# the single daily run, by hand
py -3 D:/AgenticOS/monitoring/freecash/run_daily_check.py

# the full offline suite (the runner that actually works here — see §8.1)
py -3 D:/AgenticOS/monitoring/freecash/tests/run_all.py

# a second status read in one day is REFUSED BY DESIGN and audited
py -3 D:/AgenticOS/monitoring/freecash/run_daily_check.py --force-recheck --reason "why"
#   → REFUSED_FORCE_RECHECK <day> … , exit 3, recorded in logs/forced-recheck-requests.jsonl
```

POSIX/cron equivalent for WSL or git-bash hosts (PROPOSED, supersedes `config/freecash-crontab`):

```
35 8  * * * /c/Python314/python.exe D:/AgenticOS/monitoring/freecash/run_daily_check.py >> /d/AgenticOS/data/freecash-monitor/logs/cron.log 2>&1
50 23 * * * /c/Python314/python.exe D:/AgenticOS/monitoring/freecash/watchdog.py    >> /d/AgenticOS/data/freecash-monitor/logs/cron.log 2>&1
```

---

## 8. Verification harness

### 8.1 What exists, honestly

| Harness | Covers | State |
|---|---|---|
| `monitoring/freecash/tests/run_all.py` (52 tests, 5 rule files) | R1–R5 offline | **RED**: `tests=52 failures=7 errors=11 skipped=0`, exit 1 `EVIDENCED` |
| `docs/free-cash-monitor-routine/verify-readonly.sh` | R2 static, 6 token classes | **Mutation-tested and proven able to fail** (planted violation → nonzero + correct `file:line`), but currently **EXIT=1 / `forbidden=2`** on the routine's own tree `EVIDENCED` |
| `monitoring/freecash/verify_readonly.py` | R2 static, Python port of the same six classes, same exit codes | `EXIT=1` on the routine tree `EVIDENCED` |
| `scripts/monitoring/rule_gate_verify.py` (1102 lines) | R1–R4 structural, **fail-closed**, evidence per verdict | **Proven not tautological**: on the known-broken `.mjs` it reports `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`, exit 1 `EVIDENCED`. **But it crashes on a directory** — `EVIDENCED` `PermissionError: [Errno 13] Permission denied: 'monitoring\\freecash'`. It is single-file oriented; per-file runs give `run_daily_check.py → R2/R3/R4 PASS, R1 FAIL` and all-pass for no file `EVIDENCED`. |
| `server/scripts/verify-freecash-rules.mjs` | claims R1–R4 | **TAUTOLOGICAL — delete-later.** `EVIDENCED`: prints `[OK] All 4 operational rules verified (4/4 passed)` while `node --check server/scripts/freecash-daily-monitor.mjs` fails with `SyntaxError: Unexpected token ':'` at line 41. `checkRule3` returns true whenever the string `checkForChanges` is *absent* **or** `.log(` is present — a disjunction that is true for almost any file. |

Environment facts the harness must respect, both `EVIDENCED`:
- **pytest is not installed** — `py -3 -m pytest --version` → `No module named pytest`. The
  `RULE-GATE-CHECKLIST.md` pre-flight item 5 (`py -3 -m pytest … -k "not live"` → "16 passed")
  **cannot run** and its expected count is stale (the suite is 52 tests, not 16). Use
  `unittest` via `run_all.py`.
- **tzdata is not installed** (D4).

### 8.2 Mutation-testing requirement (PROPOSED, the core of this section)

A verifier that cannot fail certifies nothing. Every rule verifier **must** ship a negative
control that provably makes it fail. R2 already has one; R1, R3 and R4 do not.
PROPOSED harness: `monitoring/freecash/tests/test_r0_mutation_harness.py`.

Mechanism: copy the routine tree to a throwaway directory using the existing
`_support.copy_routine()` (already used by the R2 negative control), inject exactly one
violation, run the relevant verifier against the copy, assert it FAILS and names the right
rule, then delete the copy. The real tree and the real data root are never touched.

| Mutation | Injected into | Verifier that must FAIL | Rule |
|---|---|---|---|
| **M1** | `gate.py::acquire_day_lock` → replace O_EXCL with `if lock.exists(): return True, lock` (the classic read-then-write race) | `rule_gate_verify.py` (R1) **and** a concurrency test with 5 processes that must then show >1 `RUN_OK` | R1 |
| **M2** | a new module containing `requests.post('http://localhost:3001/api/v1/status/claim', json={})` | `verify-readonly.sh` → exit 1, `FORBIDDEN`, correct `file:line`; `verify_readonly.py` → exit 1 | R2 |
| **M3** | `run_daily_check.py` → swap the order so `save_snapshot()` runs **before** `load_prior_snapshot()` (the legacy anti-pattern) | the R3 change test: a day with a real delta must then report **zero** changes → verifier FAILS R3 | R3 |
| **M4** | a new module that reads `status == "APPROVED"` and calls a write function | `rule_gate_verify.py` (R4) and the static freeze test `test_no_module_treats_an_approved_status_as_a_trigger` | R4 |

**Pass criteria as observable outputs.** The harness prints one `MUT` line per case and the
process exit code is 0 only if all five lines say `ok`:

```
MUTATION M1 injected=gate.py:119 target=copy verifier=rule_gate_verify exit=1 rule=R1 verdict=FAIL_R1 ok
MUTATION M2 injected=injected_probe.py:2 target=copy verifier=verify-readonly.sh exit=1 rule=R2 verdict=FORBIDDEN ok
MUTATION M3 injected=run_daily_check.py:399 target=copy verifier=test_r3 exit=1 rule=R3 verdict=ZERO_CHANGES ok
MUTATION M4 injected=injected_executor.py:7 target=copy verifier=rule_gate_verify exit=1 rule=R4 verdict=FAIL_R4 ok
MUTATION none target=routine verifier=all exit=0 rules=R1,R2,R3,R4 verdict=ALL_PASS ok
```

The last line is the control: unmutated tree, everything green. Without it, a verifier that
always fails would also print four `ok` lines.

### 8.3 Verifier repairs required (PROPOSED)

1. Extend `scripts/monitoring/rule_gate_verify.py` to accept a **directory** (today:
   `PermissionError`) by iterating the module files, and report per-file plus an aggregate in
   the same `SUMMARY:` format.
2. Reproduce its exit-code contract explicitly rather than relying on a pipeline tail:
   `0` all pass · `1` at least one rule FAIL · `2` verifier could not evaluate the target.
3. Keep the exemption budget honest: record
   `grep -rn "readonly-exempt" monitoring/freecash/ | wc -l` as a tracked baseline —
   currently **27** `EVIDENCED`. A rise means R2 is eroding, not passing.

### 8.4 Self-check that the monitor actually creates its day-key artifact (PROPOSED)

Run the entry point once against a throwaway `FREECASH_DATA_ROOT`, then assert the artifact
triple exists and is consistent:

```
DAY_ARTIFACTS day=2026-09-19 lock=yes manifest=yes snapshot=yes sha_match=yes verdict=COMPLETE
```

Asserted by: lock file present and zero bytes; manifest present and its `snapshot_sha256`
matches the SHA-256 of the snapshot file on disk; snapshot `day_key` equals the day key in all
three filenames. Failure mode that this catches: a run that consumed the day but produced no
snapshot (today: completely silent — see §4.2).

---

## 9. Deprecation decision for the parallel implementations

There are 10+ overlapping artifacts. **One** is the monitor. The others get an explicit
disposition so a seventh parallel implementation is never added. Verdicts are *decisions* —
nothing was moved, edited or deleted by this plan.

| Path | What it is | Verdict | Reason (evidence) |
|---|---|---|---|
| **`monitoring/freecash/`** | Python package, 10 modules, 52-test suite, R2 checker | **KEEP — the single source of truth** | Only candidate where all 4 rules map to enforced code; see §2. Must reach Phase 0 green. |
| `server/scripts/freecash-daily-monitor.mjs` (326 L) | the "current canonical" monitor | **DEPRECATE → delete-later** | Does not parse. `EVIDENCED` `node --check` → `SyntaxError: Unexpected token ':'` at line 41 (`function isDailyCheckAllowed(): boolean {`). Also `require()` inside ESM. Its rule comments invert R1/R2 numbering, and `checkForChanges` reads the *timestamp* file, not a snapshot. |
| `server/scripts/verify-freecash-rules.mjs` (80 L) | "rule verifier" | **DELETE-LATER — actively harmful** | Tautological. `EVIDENCED`: prints `4/4 passed` while the file it verifies does not parse. `checkRule3` is true whenever `checkForChanges` is absent **or** `.log(` is present. |
| `scripts/monitoring/free-cash-daily-check.py` (293 L) | earlier Python check | **QUARANTINE → superseded** | `EVIDENCED` save-before-load: `save_snapshot(snapshot_data)` at line 266 precedes `old_snapshot = load_snapshot()` at line 270 → `previous == current` forever, change detection impossible. Also: UTC `day_key` (not operator-local), one fixed `today_snapshot.json` (no per-day history), hardcoded `D:/AgenticOS/...` paths, blocking `input()` (not cron-safe). |
| `scripts/make_freecash_check.py` (98 L) | referenced by `config/freecash-crontab` | **DELETE-LATER** | `EVIDENCED` `BASE = Path(__file__).resolve().parents[2]` at line 8 → resolves to `D:\data\freecash` (drive root). Prior audit docs record it failing and then printing `No actions available.`, exit 0 — a silent false-green in cron. |
| `scripts/finance_monitor.py` (260 L) | token-based provider client | **QUARANTINE** | Holds a provider API token and has `_is_earning` / `_is_withdrawal` transaction handling → R2 risk surface. Contains no day lock, no snapshot diff, no approval queue. |
| `server/tasks/daily-finance-monitor.py` (330 L) | DB-driven finance monitor | **KEEP-SEPARATE — out of scope, do not merge** | Different domain: reads AgenticOS's own SQLite/`drizzle.config` DB, not the FreeCash provider. It has a `__main__` guard and a `prompt_for_approval`, but it is not the FreeCash status monitor. Merge would create the seventh implementation by another route. |
| `finance-monitor/` (package: `__init__.py` 350 L, `src/rule_engine.py`, `src/action_executor.py`, `.VERIFIED.md`, `.delivery_status.json`) | "audit-ready prototype" | **QUARANTINE → superseded** | Contains `src/action_executor.py` — an execution path, i.e. an R2 conflict by construction. `.VERIFIED.md` asserts "All 4 rules… ✓ Verified" from a **code review with no executed evidence**; `.delivery_status.json` self-describes as a "Prototype". A self-declared verified prototype is the failure mode this plan exists to prevent. |
| `server/src/adapters/freecashMonitorAdapter.ts` (159 L) | Jarvis capability registration | **KEEP — different layer, no change needed** | Legitimately read-only: capabilities are `get-balance` / `get-earnings` / `detect-alerts`, all tagged `readonly`, and it states `Local monitor adapter is operational in read-only sandbox mode. External FreeCash API connection is not configured.` It must **not** grow into a second monitor; it should consume the snapshot artifacts, not fetch status. |
| `scripts/monitoring/rule_gate_verify.py` (1102 L) | fail-closed R1–R4 structural verifier | **KEEP + FIX** | Genuinely mutation-sensitive (`EVIDENCED` 4/4 FAIL on the broken `.mjs`). Needs directory support (§8.3) and the M1/M4 negative controls (§8.2). |
| `docs/free-cash-monitor-routine/verify-readonly.sh` | R2 static gate | **KEEP** | Already proven able to fail on a planted violation. Must reach `forbidden=0` on the routine tree (D5). |
| `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` (49 KB) | full design spec | **KEEP — design authority** | The reference the implementation cites by section number. |
| `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` | 4-rule gate table | **KEEP + RESIGN** | Correct structure, but **every** "Observed result / Status" cell is blank — no rule is currently cleared. Its §"Blocking pre-flight" item 5 (`py -3 -m pytest …` → 16 passed) is unrunnable (pytest absent) and stale (52 tests). Correct it to `py -3 monitoring/freecash/tests/run_all.py` and re-sign with observed output. |
| `config/freecash-crontab` | cron fragment | **REPLACE** | Points at `make_freecash_check.py` and uses `/path/to/AgenticOS/` placeholders — non-functional as written. Superseded by the Task Scheduler entries in §7. |
| `docs/freecash-monitoring.md` | "workflow guide" | **QUARANTINE** | Prescribes execution: sections `06: Execute Single Actions One-at-a-Time` and `07: Finalize & Mark Complete` describe taking actions — a direct R2 conflict in operator-facing documentation. |
| `docs/freecash-automation-workflow-plan-v2.md`, `docs/free-cash-finance-automation-workflow-plan.md`, `free-cash-finance-automation-workflow.md`, `free-cash-finance-monitoring-specification.md`, `free-cash-finance_monitoring_plan.md`, `daily-status-monitoring-specification.md`, `resources/daily-monitoring-spec.md`, `finance_monitor_plan.json`, `docs/freecash-monitor-routine/{IMPLEMENTATION-PLAN-V3,DELEGATED-WORKFLOW-PLAN,DELEGATION-WORKFLOW-PLAN,DELEGATION-RESEARCH-PLAN,RESEARCH-PLAN,PROVIDER-API-RESEARCH,PROVIDER-CONTRACT-RESEARCH-V2,PROVIDER-FINDINGS-REVERIFIED,AUDIT-RULE-COMPLIANCE}.md` | prior plans, research and audits | **FOLD IN → mark superseded** | These are where the current facts come from (the `make_freecash_check.py` and `free-cash-daily-check.py` defects are already recorded there). This document becomes the single current plan; the rest stay on disk as history and must not be edited into a second plan. |

### 9.1 Rule for adding implementation #11

Any further "freecash monitor" file is refused unless it replaces a row above (with that row
deleted in the same change). Two monitors on one host is an R1 violation waiting to happen,
because each would hold its own day lock.

---

## 10. Phased rollout

Each phase has an executable acceptance test stated as an **observable output**. A phase is
not entered until the previous phase's acceptance test has been run and its output recorded.

### Phase 0 — Repair to green (blocking; no scheduling may happen before this)

Work order: D1–D8 from §3, plus the `clock_moved_backwards` call site.
Acceptance:

```
py -3 D:/AgenticOS/monitoring/freecash/tests/run_all.py
  → run_all: tests=52 failures=0 errors=0 skipped=0      exit 0

bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash
  → [verify-readonly] forbidden=0 exempt=N missing_targets=0
  → [verify-readonly] PASS                                exit 0

py -3 D:/AgenticOS/monitoring/freecash/verify_readonly.py monitoring/freecash   exit 0
py -3 scripts/monitoring/rule_gate_verify.py monitoring/freecash                exit 0
  → SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS
```

Plus: no `data/freecash-monitor/` directory may exist yet
(`ls -la data/freecash-monitor/` → not found), and `git status --short` shows no modification
to any pre-existing tracked file.

### Phase 1 — Read-only dry run, notifications disabled

Configuration: `FREECASH_DATA_ROOT` = a throwaway directory, `FREECASH_TOAST_STUB=1`,
notifications suppressed, no Task Scheduler entry.
Acceptance (observable):

- `py -3 …/run_daily_check.py` → `RUN_OK <day> outcome=INITIAL_BASELINE source=operator_entered(data_available=True) … notifications=0 approvals=0 lock=<day>.lock`, exit 0.
- `state/day-locks/<day>.lock` exists and is **0 bytes**; `snapshots/<day>.json` exists;
  `state/runs/<day>.json` exists with a matching `snapshot_sha256`.
- `DAY_ARTIFACTS day=<day> lock=yes manifest=yes snapshot=yes sha_match=yes verdict=COMPLETE`.
- `alerts/alerts.jsonl` contains **exactly one** line for the day, `event_type=INITIAL_BASELINE`.
- Zero toast deliveries; `approvals/pending.json` is absent or has `items: []`.
- Immediate second run → `SKIP_DUPLICATE_DAY <day>`, exit 0, snapshot mtime and ledger bytes
  unchanged, exactly one new `SKIP_DUPLICATE_DAY` line.
- Socket audit: the run's file access shows no socket opened at all (dry-run source is the
  operator-state file).

### Phase 2 — Notifications enabled

Configuration: stub or real toast on; still no scheduler.
Acceptance (observable):

- **Change day**: append a second operator record with `earnings_total_cents` differing by
  1 cent → exactly **1** `EARNINGS_CHANGED` alert line and exactly **1** toast delivery,
  message containing the old value, the new value, the delta, `Source: DEGRADED` and the
  `ACTION: No action taken.` line.
- **No-change day**: a third operator record identical to the second → **0** toasts and
  exactly **1** `OK_NO_CHANGE` line at `severity=info` (a quiet status line, not silence).
- **Dedup**: re-dispatching the same change's dedupe key produces **0** additional toasts and
  the key is marked delivered in `notified-keys.json`.
- **Delivery failure**: with a sender that always fails, at most **2** attempts occur, then
  exactly one `DELIVERY_FAILED` line carries the **full original message**, and a
  `MONITOR_DEGRADED` line follows; that key is never retried.
- **Status transition**: `OPERATIVA → BLOQUEADA` produces `STATUS_CHANGED`, not
  `EARNINGS_CHANGED`, with its own dedupe key.

### Phase 3 — Approval-queue staging

Configuration: enqueue enabled; still no scheduler.
Acceptance (observable):

- After a change day, `approvals/pending.json` contains exactly one item with
  `status=PENDING`, `expires_at_utc=null`, `execution_state=NOT_EXECUTED`,
  `execution_allowed_by_this_routine=false`, and a `change_dedupe_key` equal to that change's key.
- The dispatched message contains `Approval: <id> (PENDING - yours to decide, nothing executes)`.
- `approval_queue.py decide --id <id> --decision approve --by "system" --note "x"` → exit **4**,
  nothing recorded.
- `… --by "<a human name>" --note "reviewed"` → exit 0, `decided.jsonl` gains one line, and the
  item's `execution_state` is **still** `NOT_EXECUTED` on re-read.
- A 90-day clock advance leaves a `PENDING` item `PENDING` and executes nothing.
- Static checks pass: `test_no_module_treats_an_approved_status_as_a_trigger`,
  `test_only_the_readonly_client_may_reach_a_socket_library`.
- Mutation harness (§8.2) prints all five `ok` lines including the `MUTATION none` control.

### Phase 4 — Scheduled production

Configuration: real data root `D:\AgenticOS\data\freecash-monitor`, toast on, both tasks
registered.
Acceptance (observable):

- `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` shows the exact command with the
  absolute `C:\Python314\python.exe` path, `MultipleInstances=IgnoreNew`, restart-on-failure
  disabled, `StartWhenAvailable=true`.
- `schtasks /Query /TN "FreeCash-Missed-Day-Watchdog" /V /FO LIST` shows 23:50 daily.
- Over two consecutive days: exactly **1** lock + **1** snapshot + **1** run manifest per day
  (`ls data/freecash-monitor/state/day-locks/` → one file per day, no duplicates); day 2 emits
  `OK_NO_CHANGE` or a real change alert and never a second read.
- A deliberately killed run (kill the process after the lock exists) produces
  `verdict=PARTIAL` and a `MONITOR_DEGRADED` alert on the next verification, and **no**
  automatic re-read that day.
- `WATCHDOG_OK <day>` on a healthy day; `WATCHDOG_MISSED_DAY <day> … coverage=NOTIFIED` when the
  monitor is disabled for one day.
- Day-30 exit criterion: every snapshot has `degraded: true` until a real read-only provider
  contract exists; the operator acknowledges that until then, "no change" is a
  substitute-source reading, not a provider-verified one.

---

## 11. Open items — UNKNOWN / NEEDS-RESEARCH

| # | Item | Why it blocks | How to resolve |
|---|---|---|---|
| U1 | **The provider read contract.** `W3` (provider balance/earnings) and `W4` (provider account status) are absent from the allowlist by design; the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` is greppable in `readonly_client.py`. | Until this is known, every status reading is from a substitute source and every snapshot is `degraded: true`. There is **no** provider-verified reading today. | Read `docs/free-cash-monitor-routine/PROVIDER-FINDINGS-REVERIFIED.md` and `PROVIDER-CONTRACT-RESEARCH-V2.md`; add allowlist entries **one line each with a justification comment**, never a guessed URL. |
| U2 | Whether a live read-only provider status source exists for the monitored account at all, and whether automated access is permitted by the platform's terms. | If it does not exist, the operator-entered file is the permanent design, not a stopgap — which changes the phase plan's exit criteria. | Provider terms + prior research docs. Not resolved by this plan, and no provider call was attempted. |
| U3 | Whether the operator will type a daily record into `state/operator-state.json`. | If not, the only source is the local metrics substitute, and `data_available` will be `false` most days → no change detection at all. | Operator decision. |
| U4 | Notification channel choice beyond the Windows toast (email/other) and its credential storage. | SMTP is written but unwired and must never hold a credential in-repo. | Operator decision + existing vault/env conventions. |
| U5 | Whether Task Scheduler runs the task when the machine is asleep/asleep-woken, and the real-world `StartWhenAvailable` behaviour here. | R1's "missed day" story depends on it. Tested behaviour on this specific host is unverified. | Register in Phase 4 and observe two days; `schtasks /Query /V` plus the run manifest. |
| U6 | Root cause of the 7 `failures` beyond the 4 I traced individually (D2/D3/D4/D5 in test form, D7, D8, plus `test_five_concurrent_runs…` = D2). | Phase 0 green is the gate; an untraced failure could hide a seventh defect. | Re-run Phase 0 and attribute each remaining failure individually. |
| U7 | Whether `finance-monitor/`'s "verified" claims were ever executed anywhere. | Affects whether it is superseded history or a live risk. | No executed evidence exists in the repo; treated as unverified. |

---

## 12. What this plan did NOT do

- Did not modify, move, rename or delete any existing repository file.
- Did not create the monitor; `monitoring/freecash/` is untouched.
- Did not commit anything; `git status` shows the same untracked/modified set as before
  (`?? monitoring/`, `?? finance-monitor/`, `?? scripts/monitoring/` were already untracked).
- Did not authenticate to any provider and made no earning, cashout, claim or transaction call.
- The only files written were this document and scratch scripts under
  `%LOCALAPPDATA%\Temp\fc-monitor-evidence\` (outside the repository).
- Nothing here is labelled `EVIDENCED` that was not actually executed and read.

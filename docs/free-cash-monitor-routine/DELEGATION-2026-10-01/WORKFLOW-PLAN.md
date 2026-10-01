# WORKFLOW PLAN — Free Cash Finance Automation, Daily Status Monitoring Routine

**Delegation:** deleg_fec45ca6 · track `sa-0-47e7340f` (Workflow)
**Date written:** 2026-10-01 (Europe/Berlin) · **Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11, git-bash (MSYS), non-elevated
**Canonical implementation (subject of this plan):** `D:/AgenticOS/monitoring/freecash/` — entry point `run_daily_check.py`
**Design only.** No live monitor was executed, no provider was contacted, no scheduled task was registered, and no day-lock, snapshot, alert or approval was created in `data/freecash-monitor/`.

**Evidence standard.** Every factual claim below is followed by the exact command and its real output from this session, or is explicitly labelled `INHERITED` (from `DELEGATION-BRIEF.md` / `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V8-2026-09-30.md`) or `UNVERIFIED`. No `PASS` is claimed without its raw stdout. The two commands that were executed against live repository state were read-only or sandboxed: `verify_readonly.py` (static file scan) and `tests/run_all.py` (all state written through throwaway temp roots).

---

## 0. Live state verified in this session (2026-10-01 ~08:43 local)

| # | Command (executed this pass) | Observed output | Reading |
|---|---|---|---|
| E1 | `date` | `Do,  1. Okt 2026 08:43:26` | operator-local clock of record; Europe/Berlin, UTC+02:00 |
| E2 | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock` | **no `2026-10-01.lock`** → today is unconsumed |
| E3 | `ls data/freecash-monitor/snapshots/` | `2026-09-20.json`, `2026-09-30.json` | two snapshots, both `data_available:false` |
| E4 | `ls -la data/freecash-monitor/approvals/` | only `.` and `..` | approval queue is **empty** — no pending external action ever created |
| E5 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-30`, `last_success_day=2026-09-30`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=9`, `timezone=Europe/Berlin` | ledger's last covered day is **2026-09-30** |
| E6 | `wc -l < data/freecash-monitor/alerts/alerts.jsonl` | `14` | canonical evidence record holds 14 lines |
| E7 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | **no operator reading has ever been entered** |
| E8 | `cat config/freecash-crontab` | `0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py …` | configured timer points at a **literra placeholder path** and the known-broken `make_freecash_check.py` stub |
| E9 | `schtasks /query /fo LIST \| grep -i freecash` | *(no output)*, `exit=1`; total CSV rows `388` | **no Free Cash task is registered** |
| E10 | `"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python" -c "from zoneinfo import ZoneInfo; print('Europe/Berlin OK', ZoneInfo('Europe/Berlin'))"` | `Europe/Berlin OK Europe/Berlin` ; `Python 3.11.9` | the interpreter of record resolves the IANA zone (tzdata present) |
| E11 | `"…/venv/Scripts/python" monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` / `PASS - no unexempted write/earning token found.` ; `verify_exit=0` | R2 static gate is **GREEN** at a pinned baseline of 28 exemptions |
| E12 | `FREECASH_DATA_ROOT=<temp> "…/venv/Scripts/python" monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0` ; `runall_exit=0` | the routine's own offline suite is **fully green** (52 tests) |
| E13 | `git status --short \| wc -l` before and after the suite | `857` → `857` | the sandboxed suite wrote **nothing** to the real tree |
| E14 | `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` (after) | `2310072a…399a` / `7a90034f…96cc` | real root untouched by this pass and by the suite |

**Consequence (the honest one-line status):** the routine is fully implemented and its own checkers are green (E11, E12), but it has **never run on a timer** (E8, E9), **has no reading to compare against** (E7), and **has not run today** (E2). Today, 2026-10-01, is therefore an already-missed day for the routine. The absence of a registered task — not the monitor logic — is the reason days are missed.

> Known implementation hazard carried into this plan (INHERITED from V8 row V16, `F-1`/`C11`): the entry point takes the day lock **before** it resolves and reads the source. A day with no reading still consumes the day. This plan does not paper over it — it appears in §5, §7 and §9.

---

## 1. Numbered daily timeline, trigger time and timezone policy

### 1.1 Timezone policy (binding)

- **Day key** = operator-local calendar day, computed by `gate.day_key(now)` → `now.astimezone(zone(tz)).date().isoformat()` (`gate.py:96-102`). The key is a `YYYY-MM-DD` string and is also the day-lock filename.
- **Zone of record** = `FREECASH_TZ` env var, default `"Europe/Berlin"` (`gate.py:26,47-48`). DST-safety is structural: the routine uses `zoneinfo.ZoneInfo` (IANA), never a fixed UTC offset, so the +01:00/+02:00 transition on the last Sunday of March/October changes nothing in the code — the local `date()` is simply re-evaluated at the current instant. No arithmetic across days is naive (missed-day math compares `date` objects, `gate.py:208-225`).
- **Interpreter of record** = `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` (Python 3.11.9) — the only interpreter on this host verified to carry `tzdata` (E10). Any scheduler action that names a different interpreter risks the fallback path below.
- **Degraded fallback (never silent):** if the configured name cannot be resolved, `resolve_tz` returns the machine-local zone and reports `kind="system-local"`; the run emits a `MONITOR_DEGRADED` line and prints `WARNING timezone_unavailable …` (`gate.py:56-93`, `run_daily_check.py:357-369`). The routine never pretends the configured zone was honoured.

### 1.2 Daily timeline

| # | Local time (Europe/Berlin) | Event | Code path | Rule |
|---|---|---|---|---|
| 0 | 00:00:00 | New calendar day begins. `gate.day_key()` now yields a fresh `YYYY-MM-DD`; yesterday's lock is historical, not a barrier. | `gate.day_key` | R1 |
| 1 | **08:35:00** | **Task A — the once-per-day status check (proposed trigger; not yet registered).** | Task Scheduler calls the `.cmd` wrapper → `run_daily_check.py` | R1 |
| 2 | 08:35:00 | Attempt to consume today: atomic exclusive-create `state/day-locks/<day>.lock`. If it already exists → `SKIP_DUPLICATE_DAY`, print, exit 0, no read. | `gate.acquire_day_lock` (`gate.py:119-135`) | R1 |
| 3 | 08:35:01 | Record the attempt in the ledger; compute missed days strictly between `last_success_day` and today; record any timezone change. | `gate.load_ledger` / `record_attempt` / `missed_days` / `timezone_changed` | R1 |
| 4 | 08:35:01 | Emit one `MISSED_DAY` line per uncovered gap day (never back-filled). | `notify.notify_change` per gap day | R1 |
| 5 | 08:35:02 | **Read** today's figures from the selected read-only source (default `operator_state`; optional loopback `metrics_http`). | `run_daily_check.read_source` → `operator_state.read_source` / `readonly_client.read_status_source` | R2 |
| 6 | 08:35:02 | Load the **prior** snapshot **before** writing today's; build the immutable snapshot; write it once. | `changedetect.load_prior_snapshot` / `build_snapshot` / `save_snapshot` | R3 |
| 7 | 08:35:02 | Compare four exact-integer/string fields; if none changed → one log-only `OK_NO_CHANGE`. | `changedetect.compare` + `notify.emit_no_change` | R3 |
| 8 | 08:35:0x | If fields changed → one line per change; notify each change at most once (dedupe key recorded **before** dispatch); >5 changes coalesce to one summary. | `run_daily_check.notify_changes` → `notify.dispatch` | R3 |
| 9 | 08:35:0x | Enqueue one PENDING approval item per notified change (first 5). Nothing executes on it. | `approval_queue.enqueue` | R4 |
| 10 | 08:35:0x | Nag any PENDING item not mentioned for 7 days (at most one reminder per item per 7 days). | `run_daily_check.nag_pending` → `approval_queue.nag_due` | R4 |
| 11 | 08:35:0x | Retention pass (snapshots 90 d, run logs 30 d; alert log and decision trail never pruned) and record the outcome. | `changedetect.prune_old_artifacts` + `gate.record_outcome` | R1 |
| 12 | throughout | Manual only — a human decides a queued item, naming themselves. | `approval_queue.py decide --id … --by "<name>" --note "<why>"` | R4 |
| 13 | **23:50:00** | **Task B — watchdog.** Pure same-evening coverage alarm; opens no socket, runs no check, writes no lock/snapshot/ledger. One `MISSED_DAY` per uncovered day, deduped. | `watchdog.check` (`watchdog.py:45-101`) | R1 |

**Why 08:35 and 23:50:** inherited from the V8 plan (`S7`, "Task A 08:35, Task B 23:50"); they are a proposal, not a registered schedule — the scheduler track owns the exact times and the operator owns registration (R4 territory). At the time of writing it is 08:43 (E1), so **today's 08:35 window has already elapsed with no lock (E2)** — today is missed.

---

## 2. Step table — step | command / code path | artifact written | rule enforced

Every "artifact written" cell names a concrete path under the data root `data/freecash-monitor/` (default from `paths.DEFAULT_DATA_ROOT`, `paths.py:35`).

| # | Step | Command / code path (file + function) | Artifact written | Rule |
|---|---|---|---|---|
| S1 | Consume the day | `gate.acquire_day_lock(day)` — `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` (`gate.py:119-135`) | `state/day-locks/<YYYY-MM-DD>.lock` (0 bytes) | R1 |
| S2 | Duplicate-day no-op | `run_daily_check._run` → `notify.alert("SKIP_DUPLICATE_DAY", …)` (`run_daily_check.py:310-321`) | one line appended to `alerts/alerts.jsonl` | R1 |
| S3 | Record attempt | `gate.record_attempt(day, now, ledger)` (`gate.py:179-185`) | `state/last-run.json` (`last_attempt_day`, `last_attempt_at_utc`) | R1 |
| S4 | Missed-day arithmetic | `gate.missed_days(day, ledger)` (`gate.py:208-225`) | in-memory list (no back-fill) | R1 |
| S5 | Missed-day alert | `run_daily_check._run` → `notify.notify_change(..., "MISSED_DAY", …)` (`run_daily_check.py:331-347`) | one line per gap day in `alerts/alerts.jsonl` | R1 |
| S6 | Timezone change / fallback | `gate.timezone_changed` / `gate.timezone_report`; `notify.alert("MONITOR_DEGRADED", …)` (`run_daily_check.py:348-369`) | `alerts/alerts.jsonl` lines | R1 |
| S7 | Read (operator-entered) | `operator_state.read_source(day)` (`operator_state.py:119-151`) — reads only today's exact `day_key` record | none (read only) | R2 |
| S7b | Read (loopback metrics, opt-in) | `readonly_client.read_status_source` → `read_metrics` (`GET`) + `probe_status` (`HEAD`) (`readonly_client.py:194-239`) | none (read only) | R2 |
| S8 | Transport guard | `readonly_client.request(method, url, **kw)` — method/`host`/`path`/body-keyword allowlists; single socket site `_transport` (`readonly_client.py:76-140`) | none — raises `ForbiddenWriteError` **before** any socket | R2 |
| S9 | Process-level guard | `readonly_client.install_audit_guard()` → `sys.addaudithook(_audit_hook)` (`readonly_client.py:146-176`) | none | R2 |
| S10 | Static read-only gate | `verify_readonly.run()` (`verify_readonly.py:139-185`) | stdout report; exit 0/1/2 | R2 |
| S11 | Load prior snapshot | `changedetect.load_prior_snapshot(day)` (`changedetect.py:197-208`) | none (read only) | R3 |
| S12 | Build + write snapshot | `changedetect.build_snapshot(...)` / `save_snapshot(...)` (`changedetect.py:150-189`) | `snapshots/<YYYY-MM-DD>.json` (immutable; never rewritten) | R3 |
| S13 | Compare | `changedetect.compare(prior, snapshot)` (`changedetect.py:226-276`) | in-memory `{baseline, changes, degraded}` | R3 |
| S14 | No-change log | `notify.emit_no_change(day, …)` (`notify.py:91-99`) | one `OK_NO_CHANGE` line in `alerts/alerts.jsonl` | R3 |
| S15 | Initial baseline | `notify.emit_initial_baseline(day, …)` (`notify.py:102-110`) | one `INITIAL_BASELINE` line | R3 |
| S16 | Change notify (deduped) | `run_daily_check.dispatch_change` → `notify.notify_change`; key written by `notify.record_notified_key` **before** dispatch (`run_daily_check.py:126-170`, `notify.py:132-145,264-302`) | `state/notified-keys.json` entry + `alerts/alerts.jsonl` line | R3 |
| S17 | Coalesce >5 | `run_daily_check.notify_changes` (`MAX_NOTIFICATIONS = 5`) (`run_daily_check.py:173-214`) | one `MONITOR_DEGRADED` summary line | R3 |
| S18 | Enqueue approval | `approval_queue.enqueue(day, change, reason)` (`approval_queue.py:137-143`) | `approvals/pending.json` item (`status=PENDING`, `expires_at_utc=null`, `execution_state=NOT_EXECUTED`) | R4 |
| S19 | Approval-pending alert | `notify.alert("APPROVAL_PENDING", …)` (`run_daily_check.py:152-165`) | `alerts/alerts.jsonl` line | R4 |
| S20 | Human decision only | `approval_queue.decide` (`approval_queue.py:161-201`) | `approvals/pending.json` update + `approvals/decided.jsonl` row | R4 |
| S21 | Re-nag pending | `run_daily_check.nag_pending` / `approval_queue.nag_due` (`NAG_INTERVAL_DAYS = 7`) | `alerts/alerts.jsonl` line | R4 |
| S22 | Watchdog coverage alarm | `watchdog.check(now, ledger)` (`watchdog.py:45-101`) | `alerts/alerts.jsonl` (`MISSED_DAY`) + dedupe index | R1 |
| S23 | Retention | `changedetect.prune_old_artifacts` (90 d snapshots / 30 d run logs) (`changedetect.py:298-325`) | deletes only `snapshots/*.json` and `logs/run-*.log` older than the window | R1 |
| S24 | Record outcome | `gate.record_outcome(day, outcome, now, ledger)` (`gate.py:188-202`) | `state/last-run.json` | R1 |

> `alerts/alerts.jsonl` is the canonical evidence record and is append-only (`paths.append_jsonl`, `paths.py:183-200`). Every step that "writes an artifact" except snapshots and the ledger appends one JSON line to it.

---

## 3. R1–R4 control matrix (enforcing code in `monitoring/freecash/`)

| Rule | Requirement | Enforcing code (file :: function) | Concrete artifact on disk | Falsification evidence (command run this session unless marked) |
|---|---|---|---|---|
| **R1** | At most one status check per Europe/Berlin calendar day; DST-safe day-key; a second same-day invocation no-ops. | `gate.py :: acquire_day_lock` (`:119-135`, atomic `O_CREAT\|O_EXCL`), `gate.py :: day_key` (`:96-102`), second detector `watchdog.py :: check` | `state/day-locks/<YYYY-MM-DD>.lock`; `state/last-run.json`; `snapshots/<day>.json` | E2 (locks present only for 2026-09-20, 2026-09-30); suite output `SKIP_DUPLICATE_DAY 2026-10-01`; tests `test_second_run_skips_with_no_side_effects`, `test_five_concurrent_runs_yield_one_winner`, `test_local_day_differs_from_utc_day_near_midnight` (E12) |
| **R2** | Zero automated earning actions; read-only HTTP verbs + path allowlist only. | `readonly_client.py :: request` (`:110-140`, `ALLOWED_METHODS={GET,HEAD}`, loopback-only `ALLOWED_HOSTS`, regex `ALLOWED_PATHS`, body-keyword rejection), single socket site `_transport` (`:76-107`), audit hook `_audit_hook` (`:146-163`); static gate `verify_readonly.py :: run` | none (guards raise `ForbiddenWriteError` before any socket); scan report on stdout | E11 (`forbidden=0 exempt=28`); tests `test_write_method_is_refused_before_any_socket_opens`, `test_every_non_read_method_is_refused`, `test_non_allowlisted_path_is_refused`, `test_body_carrying_get_is_refused`, `test_non_loopback_host_is_refused`, `test_only_the_readonly_client_may_reach_a_socket_library` (E12) |
| **R3** | Notify on balance/earnings/account-status change vs the previous snapshot; no change ⇒ one coalesced status-OK or silence; never a duplicate alert for the same change. | `changedetect.py :: compare` (`:226-276`, four exact fields) · `dedupe_key` (`:214-216`, `sha256(day\|type\|field\|old\|new)`) · `notify.py :: record_notified_key` (written **before** `dispatch`, `:132-145`), `notify.py :: notify_change` (`:264-302`), `notify.py :: emit_no_change` (log-only, `:91-99`) | `snapshots/<day>.json`; `state/notified-keys.json`; `alerts/alerts.jsonl` | E6 (14 alert lines), E7 (empty `records`); suite lines `RUN_OK … outcome=EARNINGS_CHANGED … notifications=0` and `SKIP_DUPLICATE_DAY`; tests `test_earnings_change_notifies_exactly_once`, `test_same_key_is_never_notified_twice_and_the_key_includes_the_day`, `test_no_change_day_is_log_only`, `test_one_cent_is_a_change_because_cents_are_exact` (E12) |
| **R4** | Human approval before any external action; queue never auto-drained and never expires into execution. | `approval_queue.py :: enqueue` / `build_item` (frozen `expires_at_utc=NO_EXPIRY`, `execution_state="NOT_EXECUTED"`, `execution_allowed_by_this_routine=False`, `:108-143`), `approval_queue.py :: decide` + `_normalise_decider` (machine identities refused, `:149-201`); no execution code path exists in the package | `approvals/pending.json`; `approvals/decided.jsonl` | E4 (approvals dir empty — nothing pending, nothing executed); tests `test_pending_item_survives_a_ninety_day_clock_advance`, `test_a_machine_may_not_sign_a_decision`, `test_no_module_treats_an_approved_status_as_a_trigger`, `test_past_expiry_plus_approved_status_executes_nothing` (E12) |

**Rule → artifact summary:** R1 ⇒ day-lock + ledger + snapshot; R2 ⇒ stdout scan report (and the *absence* of any write artifact); R3 ⇒ snapshot diff + `notified-keys.json` + alert line; R4 ⇒ `approvals/pending.json` + `decided.jsonl` rows.

---

## 4. Idempotence proof — what happens on a second same-day invocation

**Mechanism.** `gate.acquire_day_lock` uses `os.open(..., O_CREAT | O_EXCL | O_WRONLY)` on a zero-byte file whose *name is the day key*. This is one atomic NTFS syscall: two concurrent processes cannot both create the same path, so there is no read-then-write window and no "if it exists" check to race (`gate.py:119-135`). The ledger is deliberately **not** the gate, so a corrupt or missing `last-run.json` cannot cause a second read (module docstring, `gate.py:11-13`).

**Behaviour on the second invocation (identical day):**

1. `_run` resolves the source, computes `day = gate.day_key(now)` (unchanged — same local calendar day), then `acquired, lock = gate.acquire_day_lock(day)` returns `(False, lock)` because the file exists (`run_daily_check.py:307-309`).
2. The `if not acquired` branch runs: `notify.alert("SKIP_DUPLICATE_DAY", …)` appends **exactly one** line to `alerts/alerts.jsonl`, prints `SKIP_DUPLICATE_DAY <day>`, and returns **0** (`run_daily_check.py:310-321`).
3. **No read occurs** (the source is never called on this path), **no snapshot is written**, and **no ledger write happens** (the early return precedes `record_attempt`). A duplicate is deliberately not an error → exit code 0.

**Evidence.**

- Suite stdout line (E12): `SKIP_DUPLICATE_DAY 2026-10-01`.
- A real, historical instance already on disk in E6's 14-line log:
  ```json
  {"day_key": "2026-09-30", "dedupe_key": null, "event_type": "SKIP_DUPLICATE_DAY",
   "message": "Day 2026-09-30 already consumed (lock 2026-09-30.lock). Duplicate run performed no read and wrote no snapshot.",
   "observed": {"lock": "D:\\AgenticOS\\data\\freecash-monitor\\state\\day-locks\\2026-09-30.lock"},
   "severity": "info", "ts_utc": "2026-09-30T19:02:06Z"}
  ```
- Passing tests (E12): `test_second_run_skips_with_no_side_effects`, `test_five_concurrent_runs_yield_one_winner`.
- **Also idempotent, not just the lock:** `save_snapshot` returns `(path, False)` without writing if the file already exists (`changedetect.py:183-189`, test `test_snapshot_is_immutable_once_written`), and `write_json_atomic` never leaves a partial file (`paths.py:168-180`).

**Forced re-check (`--force-recheck`) is refused by design.** The flag is accepted only to be recorded and rejected: it appends a `decision: "REFUSED"` row to `logs/forced-recheck-requests.jsonl`, prints `REFUSED_FORCE_RECHECK …`, and returns **3** — it never performs a second read (`run_daily_check.py:281-297`; test `test_force_recheck_is_refused_and_recorded`).

---

## 5. Failure and backoff policy (never retry-until-success)

The routine is built so that a failure is *reported and bounded*, never *retried into success*.

| Failure | Handling | Bounding rule | Evidence |
|---|---|---|---|
| **Read failure** (`ReadError`, `ForbiddenWriteError`, `MetricError`) | Emit one `RUN_FAILED` line, `gate.record_outcome(..., "READ_FAILED")` (leaves `last_success_day` unchanged), print `RUN_FAILED …`, return **5**. The day lock **stays in place**. | `READ_FAILED` is **not** in `gate.SUCCESS_OUTCOMES`, so the day stays *uncovered*; the message states verbatim "A second status read on the same day is not permitted by this routine (R1)". | `run_daily_check.py:371-393`; `notify.message_run_failed`; test `test_read_failure_is_loud_consumes_the_day_and_never_retries` (E12) |
| **Notification delivery failure** | At most **2 attempts** (`MAX_ATTEMPTS = 2`), then one `DELIVERY_FAILED` line carrying the **full original message** plus a `MONITOR_DEGRADED` line; the key is marked `FAILED_TOAST` and is **never retried again**. | A failed notification never blocks a state write, never re-reads the status source, never causes a second run, never touches the approval queue. | `notify.py:220-261`; test `test_delivery_failure_is_bounded_and_keeps_the_full_message` (E12) |
| **Corrupt/missing state file** | `paths.read_json` returns the default instead of raising; `gate.load_ledger` fills missing keys | The routine can always run and *report* the problem rather than crash-loop | `paths.py:154-166`; `gate.py:155-163` |
| **Scheduler-failure policy** (proposed, not registered) | The task definition must carry **restart-on-failure = Do not restart**, `IgnoreNew`, `StartWhenAvailable`. | A crashed/skipped day is reported by `RUN_FAILED` / `MISSED_DAY`, never retried automatically. | INHERITED (V8 `S7`); the scheduler track owns the XML |

**Explicit anti-pattern this rule forbids:** there is **no loop, timer, watchdog, cron entry or scheduler retry** anywhere in `monitoring/freecash/` that re-invokes the read after a failure. The only repeated element in the package is the notification *retry* (bounded at 2) and the every-7-days *reminder* for a pending approval (S21) — neither re-reads status and neither can execute anything.

**Known hazard (INHERITED V8 `F-1`/`C11`, reproduced by reading `run_daily_check.py:307-309` vs `:372`):** the day lock is acquired **before** the read is attempted. Consequently a *data-less* run still consumes the day (outcome `MONITOR_DEGRADED`, which **is** in `SUCCESS_OUTCOMES`). This is not a retry loop, but it does mean a premature run burns the day. The operational rule in §7.4 and the manual block at the end exist to prevent that. It is handed to the verifier track in §9.

---

## 6. Notification dedupe + queue-escalation policy

### 6.1 Dedupe (one change ⇒ at most one notification)

- **Key** = `sha256(day_key | change_type | field | old_value | new_value)` (`changedetect.dedupe_key`, `changedetect.py:214-216`). The day is part of the key on purpose: the same movement re-detected on a later day is a *new* key and *does* notify; a same-day re-detection (already blocked by R1) could never notify twice (module docstring `:19-25`).
- **Ordering:** `notify.dispatch` calls `record_notified_key(key, "QUEUED")` **before** the send attempt (`notify.py:224`). A crash can lose *one* message; it can never *duplicate* one. `key_seen(key)` short-circuits and returns `"DEDUPED"` (test `test_same_key_is_never_notified_twice_and_the_key_includes_the_day`).
- **No-change path:** `OK_NO_CHANGE` is **log-only** — `emit_no_change` appends to `alerts.jsonl` and dispatches nothing, ever (`notify.py:91-99`; test `test_no_change_day_is_log_only`). So a quiet day yields exactly one coalesced "status OK" *line*, or silence — never an alert.
- **Threshold / coalescing:** `MAX_NOTIFICATIONS = 5`. More than five distinct changes in one day ⇒ per-change toast notifications are suppressed and exactly **one** summary notification is dispatched, under a `MONITOR_DEGRADED` key derived from `(day, "change_count", 5, len(changes))` (`run_daily_check.py:173-214`). Each individual change still gets exactly one `alerts.jsonl` line.
- **Baseline:** the first run against no prior snapshot emits `INITIAL_BASELINE` (log-only) — a first run must never produce a fake alarm (`changedetect.compare`, `changedetect.py:226-241`; test `test_prior_without_data_is_a_baseline_not_a_change`).
- **Dedupe index on disk:** `state/notified-keys.json` (E6-era snapshot shows 10 keys, each with `first_notified_at_utc` + `delivery`).

### 6.2 Queue escalation (R4) — threshold, who is asked, what happens when nobody answers

- **Threshold to enqueue:** every notified change (up to `MAX_APPROVAL_ITEMS = 5`) produces one PENDING item (`run_daily_check.py:195-197`). No change ⇒ no item.
- **Who is asked:** the **operator / human owner** of the account. The queue is surfaced by a notification whose action text is the exact CLI (`approval_queue.decide …`), and the only accepted decider is a named human — `_normalise_decider` refuses `system`, `routine`, `automation`, `agent`, `cron`, `scheduler`, `monitor`, `bot`, `script`, `machine` (`approval_queue.py:54-57,149-158`; tests `test_a_machine_may_not_sign_a_decision`, `test_cli_refuses_a_machine_identity_with_exit_code_4`).
- **What happens when nobody answers:** **nothing automatic, ever.**
  - `expires_at_utc` is `null` by construction and re-asserted on every decision (`approval_queue.py:47-48,131,180`). There is no path by which a pending item "expires into execute" (test `test_pending_item_survives_a_ninety_day_clock_advance`; `test_past_expiry_plus_approved_status_executes_nothing`).
  - `execution_state` is always the literal `NOT_EXECUTED` and `execution_allowed_by_this_routine` is always `false` (test `test_no_module_treats_an_approved_status_as_a_trigger`).
  - The queue is **never auto-drained**: nothing in the package iterates `pending_items()` to act; the only iteration is `nag_pending`, which re-notifies at most once per item per 7 days (`NAG_INTERVAL_DAYS = 7`, `approval_queue.py:59,221-235`) and decides nothing.
  - Real queue state today (E4): `data/freecash-monitor/approvals/` is empty → **zero pending items** for the operator to answer.

---

## 7. The missed-day path (today, 2026-10-01, is already a missed day)

### 7.1 What "missed" means here

Task A's window (proposed 08:35) has elapsed (E1 = 08:43) and **no `2026-10-01.lock` exists** (E2), so today's single permitted check has not happened. The routine has *not* run today; because R1 allows only one check per day, the missed check cannot be caught up — it can only be *reported*.

### 7.2 How the routine reports it

- **In-band (at the next run):** `gate.missed_days(day, ledger)` returns every local day **strictly between** `last_success_day` and today, excluding both endpoints (`gate.py:208-225`). With `last_success_day = 2026-09-30` (E5) and today `2026-10-01`, the gap is **empty**, so the next run emits **no** `MISSED_DAY` line for today — by design, today is the day it is about to check, not a gap.
- **Same-evening (Task B watchdog, 23:50):** `watchdog.evaluate` marks today `covered` only if `last_attempt_day == today` **and** `last_outcome ∈ SUCCESS_OUTCOMES` (`watchdog.py:27-42`). Today it is neither, so at 23:50 the watchdog emits exactly **one** `MISSED_DAY` alarm for `2026-10-01`, deduped so a second evening run adds nothing (`watchdog.py:79-98`; tests `test_healthy_day_raises_no_alarm`, `test_missing_check_raises_one_alarm_and_changes_no_state`).
- **Never back-filled:** a missed day is never re-read later. A second read of a past day would be a second check for that day and would defeat R1 (`gate.missed_days` docstring).

### 7.3 Historical evidence that this path works

The 14-line canonical log (E6) already contains `MISSED_DAY` lines and their dedupe keys for the 2026-09-21…2026-09-30 window (e.g. `"[FreeCash] MISSED DAY 2026-09-29 … consecutive_missed_days=9"`, `alerts.jsonl`, `ts_utc=2026-09-30T19:01:58Z`). The ledger (E5) records `consecutive_missed_days = 9`.

### 7.4 Recovery procedure for today (human, read-only, one sitting)

1. **Do NOT run the monitor yet.** With `operator-state.json` `records: []` (E7), a run today would consume `2026-10-01` and write a null snapshot (outcome `MONITOR_DEGRADED`) — burning the day for nothing (see §5 hazard and S7/§1 timeline). This is the single most important operational caution in this plan.
2. **Enter today's reading first.** Append one record for `day_key: "2026-10-01"` to `data/freecash-monitor/state/operator-state.json` with the four figures as **integer cents** (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`) — see the manual block at the end.
3. **Then run Task A once** (manual block). Expected outcome for the first real data day: `RUN_OK 2026-10-01 outcome=INITIAL_BASELINE …` (test `test_first_run_with_operator_data_is_a_silent_baseline`) — a silent baseline, because there is no prior *data-bearing* snapshot to compare against.
4. **Tomorrow** (2026-10-02), with a second record entered, expect `EARNINGS_CHANGED` / `STATUS_CHANGED` / `BALANCE_CHANGED` → exactly one notification each and one approval item each.
5. If the operator cannot enter a reading today, the honest default is: let the day stay missed, let Task B report it at 23:50, and do **not** run the monitor.

---

## 8. OUT OF SCOPE (explicit)

This plan, and the routine it designs, do **not**:

- Perform, schedule, or propose any **earning action** — no click, claim, survey, offer, withdraw, cash out, redeem, payout, deposit, bet, wager, spin, transfer or transaction. R2 forbids it and no such code path exists.
- Reach any **provider / consumer platform** endpoint, host, or login flow. `ALLOWED_HOSTS` is loopback-only; no provider path is allowlisted (`readonly_client.py:41-49`, `PROVIDER_ENDPOINT_UNKNOWN` kept verbatim; tests `test_no_provider_host_is_hardcoded_anywhere`, `test_unresolved_provider_contract_keeps_its_literal`).
- Use any **credential, token, secret or session**. None is read, stored, or passed anywhere; `[REDACTED]` is the only permitted rendering if one is ever referenced.
- Touch `/transactions`, `/cashout`, `/earn`, or any write endpoint, verb, or path — by construction.
- **Register** the scheduled task, edit `config/freecash-crontab`, or modify any existing timer. Registration is an external action → R4 territory → produced as an artifact for human approval, never executed here.
- Modify, move, rename or delete **any** file in the repository. This document is new and additive; the sandboxed suite left `git status` at `857` lines (E13) and the real data root's hashes unchanged (E14).
- Implement a **second monitor** or extend a legacy one. `monitoring/freecash/` is the single implementation of record; the known-bad entry points (`server/scripts/freecash-daily-monitor.mjs`, `scripts/monitoring/free-cash-daily-check.py`, `scripts/make_freecash_check.py`, `finance-monitor/src/rule_engine.py`, `server/scripts/verify-freecash-rules.mjs`, `freecashMonitorAdapter.ts`) are **not** used as a basis and must not be cited as compliant.
- **Auto-drain** the approval queue, or resolve a pending item by expiry, timeout, watchdog or scheduler.
- Deliver by **email / SMS / webhook** — no such sink is configured or implemented (toast is the only channel; SMTP is opt-in and off).
- Guarantee **revenue**. This routine produces *visibility*, not income. The money path (mission `bgtask-07a8154b0`, Shopify publication) is a separate, human-gated track.
- Claim compliance from a **static grep** or a PASS quoted from another session. Every verdict here names a command run in *this* session.

---

## 9. Open questions handed to the verifier / research tracks

| # | Question | Why it matters | Owner |
|---|---|---|---|
| Q1 | **Lock-before-read (F-1/C11):** should a data-less day consume the day? `run_daily_check.py:308-309` acquires the lock before `:372` reads; a `records: []` day yields `MONITOR_DEGRADED` ∈ `SUCCESS_OUTCOMES`. | A scheduled run on a day with no operator reading silently spends the day. Blocks safe unattended scheduling. | Verifier (falsifiable test: "a data-less day leaves `day-locks/` empty") |
| Q2 | **Acceptance gate (C9):** `scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` was `R1=FAIL` (INHERITED V5, 2026-09-30). Does it still fail, and does a package-scope mode now exist? `rule_gate_verify.py` is present (`47141` bytes, mtime 2026-09-18). | An R1=FAIL gate withholds any compliance claim and any registration. | Verifier — run it and paste raw output |
| Q3 | **Opaque alert writer (C14):** an `alerts.jsonl` line at `2026-09-21T16:39:42Z` is attributed in V8 to a scratch package copy (`.hermes/scratch/freecash/pkg`). Is a writer tag (pid + entry point) needed before the log is trustworthy as evidence? | The alert log is the canonical evidence record; an unattributed writer undermines it. | Verifier |
| Q4 | **Provider read contract (R2/U):** no live read-only provider status/earnings endpoint is known (`PROVIDER_ENDPOINT_UNKNOWN`). What is the compliant read path, if any, for the monitored account? | Until resolved, every snapshot is `degraded: true` (operator-entered or loopback substitute). | Research |
| Q5 | **Read source selection:** operator-entered (available today) vs bridging Path B (`freeCashExecutor.ts::checkAuthenticatedSession`) vs a loopback metrics route that has never existed. Which becomes the source of record? | Determines whether a snapshot can ever be non-degraded. | Research (decision owner: operator) |
| Q6 | **Delivery proof:** does a real toast return `TOAST_OK` with the session locked *and* unlocked, and does the 2-attempt bound then `DELIVERY_FAILED` correctly? | The only implemented channel has never been exercised at the desk in a verification pass. | Verifier (needs the operator at an unlocked session) |
| Q7 | **State-root authority:** `data/freecash-monitor` (holds all real artifacts) vs `data/freecash` (empty). Confirm exactly one root holds state before any wrapper pins `FREECASH_DATA_ROOT`. | A second root could let a scheduled run write invisible state. | Verifier / scheduler track |
| Q8 | **Config timer is a live trap:** `config/freecash-crontab` names `/path/to/AgenticOS/scripts/make_freecash_check.py` (a literal placeholder + the known-broken stub, E8). Does anything on this host *read* that file? | A working timer pointed at the broken stub would corrupt the story of "nothing has run". | Verifier |

---

## 10. How to run this manually once, read-only (operator paste-block)

> **Read this first:** run this **only** after today's operator record exists in `operator-state.json` for today's `day_key`. With `records: []` (E7 today), the run consumes `2026-10-01` and writes a null snapshot — the day is then spent (R1). Enter the reading first.
>
> The read source `operator_state` opens **no socket**; the optional `metrics_http` source uses `GET`/`HEAD` to `localhost` only. Neither claims, withdraws, or transacts. Nothing below registers a task or modifies any file.

```bash
# 0. Working directory and interpreter of record (has tzdata; Python 3.11.9)
cd /d/AgenticOS
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python"

# 1. Confirm today's day-key is not already consumed (read-only)
ls data/freecash-monitor/state/day-locks/            # expect: no <today>.lock
"$PY" monitoring/freecash/run_daily_check.py --print-state   # prints ledger + pending count, then stops

# 2. Confirm the static read-only gate is green (read-only)
"$PY" monitoring/freecash/verify_readonly.py         # expect: forbidden=0 exempt=28 ... PASS ; exit 0

# 3. (Optional) Confirm the routine's own offline suite is green, sandboxed
export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-manual-$(date +%s)/freecash-monitor"
"$PY" monitoring/freecash/tests/run_all.py           # expect: tests=52 failures=0 errors=0 ; exit 0
unset FREECASH_DATA_ROOT

# 4. ENTER TODAY'S READING FIRST (edit data/freecash-monitor/state/operator-state.json),
#    appending one record to "records" with today's date and integer cents, e.g.:
#    {"day_key":"2026-10-01","entered_at_utc":"2026-10-01T06:40:00Z",
#     "account_status":"ACTIVE","earnings_total_cents":1340,
#     "balance_cents":1340,"pending_cents":0,"currency":"USD"}

# 5. Run the check ONCE (real root; acquires today's lock; writes today's snapshot)
"$PY" monitoring/freecash/run_daily_check.py
#    first data day  -> RUN_OK <day> outcome=INITIAL_BASELINE ... (silent baseline)
#    later day w/change -> RUN_OK <day> outcome=EARNINGS_CHANGED ... notifications=1 approvals=1

# 6. Inspect, read-only
ls data/freecash-monitor/snapshots/                  # one new <today>.json
tail -n 5 data/freecash-monitor/alerts/alerts.jsonl  # canonical evidence lines
"$PY" monitoring/freecash/approval_queue.py list     # PENDING items; expires_at_utc=None execution_state=NOT_EXECUTED

# 7. A SECOND run the same day is a no-op by design (safe to observe):
"$PY" monitoring/freecash/run_daily_check.py         # prints: SKIP_DUPLICATE_DAY <today> ; exit 0
```

**If you want to decide a queued item** (this is the only human-gated write; it never executes anything):

```bash
"$PY" monitoring/freecash/approval_queue.py decide \
    --id <approval_id-from-pending.json> \
    --decision approve|reject \
    --by "<your name>" --note "<why>"
# records the decision; execution_state remains NOT_EXECUTED — the routine acts on nothing.
```

**Never** run `--force-recheck` expecting a second check — it is refused (exit 3) and only recorded in `logs/forced-recheck-requests.jsonl`. **Never** point the run at a provider host or add one to `readonly_client.ALLOWED_PATHS`; that is an R2 widening and a second transport.

---

*End of workflow design. Evidence commands executed this session: E1–E14 (§0), E11/E12 raw outputs pasted above. Inherited facts are labelled `INHERITED`. Nothing in `data/freecash-monitor/` was created or modified; `git status --short` was `857` before and after (E13).*

---

# ADDENDUM — independent verification pass, 2026-10-01 ~09:05 local

Written by the parent session after the design above was filed. Purpose: to **measure** the three open questions this
document handed to the verifier track (§9 Q1–Q3), to correct two inherited rows that no longer hold, and to add the
option table (Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action) that a plan of record needs.
Nothing above was edited; nothing in `data/freecash-monitor/` was written (A12).

## A.0 Evidence produced in the addendum pass

| # | Command | Observed | Reading |
|---|---|---|---|
| A1 | `date` | `Do, 1. Okt 2026 08:41:06` | clock of record for this pass |
| A2 | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | suite GREEN (confirms E12) |
| A3 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1`, exit **1** | **answers Q2** |
| A4 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` | `error: unrecognized arguments: --package`, exit **2** | package-scope mode **still does not exist** |
| A5 | python probe of all 14 `alerts.jsonl` lines | every line carries exactly the same 8 keys (`day_key`, `dedupe_key`, `event_id`, `event_type`, `message`, `observed`, `severity`, `ts_utc`) | **answers Q3: no writer tag on any line** |
| A6 | `curl -m5 localhost:4600/api/health` · `:3001` · `:4600/api/v1/status/metrics` | `:4600` → **200** `{"status":"healthy","pid":32500,"uptime":2358.8,"version":"9.0.0","gitSha":"8f7463aa…"}`; `:3001` → 000; metrics → **404** | **the app is UP today** (it was down on 09-30) |
| A7 | `which -a python` + zoneinfo check; `py -3` check | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`, 3.11.9, `Europe/Berlin` resolves; `py -3` = 3.14.7 → `ZoneInfoNotFoundError` | interpreter pin (E10) independently confirmed |
| A8 | read of `server/data/agentic-os.db` | `bgtask-07a8154b0` `blocked`, `resumable=0`, blocker “Backend restarted…”, `updated_at=2026-09-19T18:05:18.690Z`; `provider_credentials=0`; `revenue_ledger_entries` 11 rows, all `2026-08-19` (`REALIZED_REVENUE` 5/€388, `VERIFIED_REVENUE` 2/€38, `ACTUAL_COST` 2/€40, `PIPELINE_VALUE` 2/€240); `treasury_ledger` 0; gates `SHOPIFY_AUTH_REQUIRED` resolved ×12, `OUTBOUND_APPROVAL` resolved ×4; scheduler max tick `2026-09-19T18:05:00.004Z` | money path idle 12 days |
| A9 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH"` | no match | no credential, no external sink |
| A10 | sandbox A: run / re-run / `--force-recheck` / watchdog | run 1 `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED … lock=2026-10-01.lock` exit 0 · run 2 `SKIP_DUPLICATE_DAY 2026-10-01` exit 0 · `REFUSED_FORCE_RECHECK` exit **3** · exactly one lock, exactly one snapshot · `watchdog.check()` → `{"covered":true,"alarm":false}` | R1 idempotence **demonstrated end to end**, not inferred |
| A11 | sandbox B: seeded two-day change | day 1 `INITIAL_BASELINE changes=0 notifications=0 approvals=0` · day 2 `EARNINGS_CHANGED changes=1 notifications=1 approvals=1` · day 2 re-run `SKIP_DUPLICATE_DAY` · pending item `execution_state=NOT_EXECUTED`, `expires_at_utc=None` | R3 exactly-once and R4 frozen fields **demonstrated** |
| A12 | `sha256sum` of real-root `alerts.jsonl` + `state/last-run.json` before/after every run; `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` | `7a90034fd656…` / `2310072a649d…` **unchanged**; **0** files newer than today | production root untouched |

## A.1 Answers to §9 open questions

- **Q1 (lock-before-read, `F-1`/`C11`) — CONFIRMED IN PRODUCTION, not just by reading code.** The real root shows
  `day-locks/2026-09-30.lock` together with `snapshots/2026-09-30.json`, while `operator-state.json` still holds
  `"records": []` and `last-run.json` says `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=9`. The 09-30 day
  was spent with `data_available=False`. A scheduled run that fires before the operator has entered a reading burns
  the day permanently — so the **pre-flight guard must land before any task is registered**, and the guard belongs in
  the wrapper (no weakening of strict R1).
- **Q2 (acceptance gate) — STILL RED, and the package mode still does not exist.** A3 (exit 1, `R1=FAIL`) and A4
  (argparse error, exit 2). The gate cannot go green on the shipped package as scoped: it attributes R1 to a rolling
  24-hour window rather than to `gate.py::acquire_day_lock`. Two remedies: repair the verifier's rule mapping (2–4 h,
  preferred) or record an explicit operator override (loses the automatable gate).
- **Q3 (opaque writer) — CONFIRMED: no writer tag.** All 14 lines carry the same 8 keys (A5); nothing identifies the
  pid or entry point that wrote the `2026-09-21T16:39:42Z` line. Until a writer tag is added (or an operating window
  is documented), the canonical log cannot by itself distinguish a scheduled run from any other writer.

## A.2 Correction to an inherited fact

**C-1 — “the app is down” no longer holds.** The 2026-10-01 brief and V8 (`D-2`/`C17`) both assumed no listener;
A6 measures `:4600` answering `200 healthy` at the current HEAD build `8f7463aa…`. Any plan that keeps Path B off the
critical path on the grounds of “the app is closed” must re-measure first. The metrics route (`/api/v1/status/metrics`)
remains a **404**, so the loopback-metrics read source still has no route to read.

## A.3 New finding — F-A: the R4 decider guard is a denylist, and it is bypassable

§3 states “machine identities refused” and §6.2 lists the ten denied words. Both are accurate **as written**; what is
new is the measured consequence:

```
NON_HUMAN_DECIDERS = ['agent','automation','bot','cron','machine','monitor','routine','scheduler','script','system']
_normalise_decider('agent'/'system'/'bot')  -> REFUSED (NotHumanError)
_normalise_decider('hermes-agent')          -> ACCEPTED
_normalise_decider('Hermes Agent')          -> ACCEPTED
_normalise_decider('assistant'/'claude'/'hermes'/'the monitor') -> ACCEPTED
```

and in sandbox B a decision was successfully recorded under a machine-shaped name:

```
decided.jsonl: decided_by='hermes-agent' decision=APPROVED execution_state=NOT_EXECUTED expires_at_utc=None
pending.json:  item status=APPROVED state=NOT_EXECUTED expires=None
```

Reading it precisely, in two halves:

- **The safety half holds.** Even after a wrongly-accepted decider, `execution_state` stayed `NOT_EXECUTED`,
  `expires_at_utc` stayed `null` and `execution_allowed_by_this_routine` stayed `false` — the routine still has no
  path that acts on an approval. The property “an approval can never arm an action” is verified (A11).
- **The attribution half does not.** “A machine is refused” is true only for ten literal strings. Recommend: replace
  the denylist with an operator-editable **allowlist** (`state/human-deciders.json`, created empty), refuse any name
  not on it, and add the paired test (`hermes-agent` ⇒ refused, `Christian` ⇒ accepted). Until that lands, no
  compliance statement may say more than “a decision must name a decider outside a ten-word denylist”.

## A.4 Options, with the four required attributes

| # | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| O-1 | ~~**Enter today's reading and run once**~~ **SUPERSEDED by A.6 — the 2026-10-01 day is now consumed; do this for 2026-10-02 instead** | 5 min | same day, **visibility only** | human at their own dashboard | append one record for `day_key: 2026-10-02` with the four integer-cent figures **before** the runner fires, then run the entry point once and quote `RUN_OK … outcome=INITIAL_BASELINE` |
| O-2 | **Pre-flight guard in the wrapper** (fixes Q1 without touching R1) | ~1 h | none | O-1's file format | guard on “today's `day_key` present in `operator-state.json`”; prove a data-less day leaves `day-locks/` **empty** |
| O-3 | **Repair the acceptance gate** (add `--package`, attribute R1 to `gate.py::acquire_day_lock`) | 2–4 h | none | none | add the mode; require exit 0 on the package **and** exit 1 on a temp copy whose lock check is non-atomic |
| O-4 | **R4 allowlist** (F-A fix) + paired test | 1–2 h | none | none | ship the two-case test; `--by hermes-agent` must be refused |
| O-5 | **Writer tag on `alerts.jsonl`** (fixes Q3/C14) | 1–2 h | none | none | add pid + entry point + start time to each new line, keeping the existing 14 lines byte-identical |
| O-6 | **Scheduler handover, unregistered** (Task A 08:35, Task B 23:50, `IgnoreNew`, `StartWhenAvailable`, no restart, pinned interpreter) | 1–2 h to author | none | O-2, O-3, operator approval to register | hand over the exact `schtasks /Create` text / XML and **do not register it** |
| O-7 | **Path-B bridged read** (real account status without typing) | 4–8 h | 3–7 days, visibility | **app running — it is up now (A6)**, operator login in the managed profile, four-field mapping | call the existing authenticated-session probe once through the app's own path and quote its artefact |
| O-8 | **Delivery proof** (toast locked/unlocked) | 0.5–1 h | none | operator at an unlocked session | dispatch one toast unlocked, then locked; record both labels |
| O-9 | **Revenue** — R-a resume `bgtask-07a8154b0` (1–2 h, unknown TTR) · R-b implement the missing publication step (unbounded) · R-c monitor only (0 h, 0 revenue) | see cells | **the only revenue hypothesis here, currently unbounded** | app up (A6), human decision, app-side re-dispatch | resume the blocked task in the UI and quote the new status |
| O-10 | **Stay manual, no scheduler** | 0 h | none | operator discipline (5 min/day) | describe the routine as *built and evidenced, unverified in operation* |

Recommended order: **O-1 → O-2 → O-3 → O-4/O-5 → O-6 (handover) → O-7 → O-8 → O-9**, with O-10 as the honest fallback.

## A.5 Addendum constraints statement

Design and measurement only: no scheduled task or cron entry created (278 host tasks, **0** Free Cash); every execution
used a throwaway `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp` with the production root's hashes verified unchanged
before and after (A12); no provider contacted, no credential read, no secret in any artifact; no git write verb; no
file in §0–§10 was modified by this addendum; the app was only *health-probed* over loopback, never driven.

## A.6 LIVE INCIDENT — the production root was driven at 2026-10-01T06:53:46Z, and today's day is now spent

Measured 08:52 → 08:54 local, i.e. minutes after A12's clean check:

| Fact | Measurement |
|---|---|
| New files under the production root, all at `08:53:46` local (`06:53:46Z`) | `state/day-locks/2026-10-01.lock`, `snapshots/2026-10-01.json`, an appended `alerts/alerts.jsonl` line, rewritten `state/last-run.json` |
| New ledger state | `last_attempt_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `last_success_at_utc=2026-10-01T06:53:46Z` |
| New alert line | `{"day_key":"2026-10-01","event_type":"MONITOR_DEGRADED", … "no operator-entered record for 2026-10-01 …", "ts_utc":"2026-10-01T06:53:46Z"}` — the 15th line |
| Hash drift | `alerts.jsonl` `7a90034f…` → `1b9c7c07…`; `last-run.json` `2310072a…` → `a287a902…` (A12's “unchanged” reading is superseded) |
| Unchanged | `state/notified-keys.json` (`0f28d569…`), `state/operator-state.json` (still `records: []`, mtime 2026-09-20), `logs/task-*.log`, `approvals/` (empty) |
| Writer attribution | **none** — the line carries no pid/entry-point tag, so the log cannot say which process ran it (this is Q3/C14 happening live) |

**Consequences, stated plainly:**

1. **2026-10-01 is consumed.** R1 permits one check per day, so today can no longer produce a data-bearing snapshot; the
   day now carries a null snapshot and `MONITOR_DEGRADED`. §7.4 step 1 (“do not run the monitor yet”) was correct and is
   now moot for today; the equivalent action applies to **2026-10-02**.
2. **The lock-before-read hazard (Q1) is no longer theoretical** — it has now cost a day in production twice
   (2026-09-30 and 2026-10-01). O-2 (pre-flight guard) is therefore the highest-value control in this plan, and it must
   be in place **before** any task is registered.
3. **The unguarded invocation path is live and reachable.** A guard exists as a deliverable in the sibling scheduler
   track (`DELEGATION-2026-10-01/scheduler/freecash-guarded-run.sh`, exit 9 when `FREECASH_DATA_ROOT` is unset or equal
   to the production default) but is wired into nothing; the run at `06:53:46Z` evidently went through the unguarded
   default (paths fall back to `DEFAULT_DATA_ROOT`, `paths.py:35`). Until every runner exports a sandbox root or is
   refused, any verification pass can burn the operator's day.
4. **Independent agreement.** The scheduler track's own forensics file
   (`scheduler/evidence/evidence-09-INCIDENT-production-leak-forensics.txt`, written 08:54:24) records the same hashes,
   the same 15-line count and the same `06:53:46Z` timestamp as the measurements above — two independent passes, one
   incident.
5. **Conduct note for the delegation:** §A.5's claim that no pass writes the production root was true of *this* pass and
   of the delivery track's byte-neutrality check at `06:51:20Z`; it is **not** true of the delegation as a whole for
   `2026-10-01`. Any track that repeats “the production root is byte-neutral” must re-measure and quote a timestamp,
   because it was falsified ~two minutes later.

**Revised first concret action for the operator (tomorrow, in this order):** (1) confirm no `2026-10-02.lock` exists;
(2) append the 2026-10-02 reading to `operator-state.json`; (3) run the entry point **once** with an explicit
`FREECASH_DATA_ROOT` (or through the guarded runner) and quote `RUN_OK … outcome=INITIAL_BASELINE`; (4) leave
`--force-recheck` alone — it is refused by design (exit 3).



# RULE-GATE-CHECKLIST.md — pre-flight, to be completed by the implementer

**Companion to:** `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` (section numbers refer to it)
**How to use:** fill every **File / function** cell with the exact enforcing path+symbol, run the cited test, then sign. A rule is **not** cleared until its test has been executed and its observed result written down. "Not implemented yet" is a blocking entry, not a pass.

Status values: `PASS` · `FAIL` · `N/A (blocked)` — the last one must name the blocker.

---

## Gate table

| Rule | Enforced by (file / function) | Mechanism that makes violation unreachable | Test ID (§8) | Test type | Observed result | Status | Verified by | Date |
|---|---|---|---|---|---|---|---|---|
| **R1** once per day | `monitoring/freecash/gate.py::acquire_day_lock()` — `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` | Atomic exclusive-create on a per-day path; the `if exists` check is never the gate | T1.1 | offline | | | | |
| **R1** no double run under concurrency | `monitoring/freecash/gate.py::acquire_day_lock()` + Task A `-MultipleInstances IgnoreNew` | Single atomic syscall; 5 concurrent processes → 1 winner, 4 `SKIP_DUPLICATE_DAY` | T1.2 | offline | | | | |
| **R1** missed-day detection | `monitoring/freecash/gate.py::reconcile_missed_days()` **and** `watchdog.py::main()` | Two independent detectors (in-band next-run + same-day 23:50 watchdog) | T1.3, T5.1 | offline | | | | |
| **R1** timezone / day-key | `monitoring/freecash/gate.py::day_key()` — `ZoneInfo(os.environ["FREECASH_TZ"])` | Day key from the operator wall clock, not UTC; `MONITOR_DEGRADED` on TZ change | T1.4 | offline | | | | |
| **R2** no earning action (transport) | `monitoring/freecash/readonly_client.py::request()` — `ALLOWED_METHODS={GET,HEAD}`, `ALLOWED_PATHS` regex, rejects `data`/`json`/`files` | Deny-by-default: raises `ForbiddenWriteError` **before** the only socket call in the routine | T2.2, T2.3 | offline | | | | |
| **R2** no earning action (static) | `monitoring/freecash/verify_readonly.py` — invoked as `docs/free-cash-monitor-routine/verify-readonly.sh` | CI grep over the source tree; forbidden verbs/paths/earning words fail the build | T2.1 | offline | | | | |
| **R2** reads are read-only (observed) | `monitoring/freecash/readonly_client.py::_transport()` (the single socket site) | Only one place opens a socket → one place to capture and audit | T2.4 | **live** | | | N/A until creds | |
| **R2** no `APPROVED`→execute path | `monitoring/freecash/approval_queue.py` (write of `execution_state` is the constant `NOT_EXECUTED`) | The routine contains no execution code path at all | T4.4 | offline | | | | |
| **R3** snapshot + comparison | `monitoring/freecash/changedetect.py::compare()` — fields `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents` | Exact integer-cent comparison; no relative thresholds that can swallow a real change | T3.1, T3.2 | offline | | | | |
| **R3** exactly one notify per change | `monitoring/freecash/changedetect.py::dedupe_key()` → `sha256(day_key\|change_type\|field\|old\|new)`; `notified-keys.json` written **before** dispatch | Key check precedes dispatch; crash window loses a message but can never duplicate one | T3.4 | offline | | | | |
| **R3** no storm on a no-change day | `monitoring/freecash/notify.py::emit_no_change()` — log-only, `severity=info` | `OK_NO_CHANGE` never dispatches; >5 changes/day coalesce into 1 summary | T3.3 | offline | | | | |
| **R3** delivery failure bounded | `monitoring/freecash/notify.py::dispatch()` — max 2 attempts, 5 s in-process backoff, then `DELIVERY_FAILED` with the full message and **stop** | No scheduler-level retry; a failed key is never retried | T5.2 | offline | | | | |
| **R4** approval queue only | `monitoring/freecash/approval_queue.py::enqueue()` | Enqueue happens only on a real change; enqueueing is a notification with a handle, not a permission to act | T4.1, T4.2 | offline | | | | |
| **R4** human decides | `monitoring/freecash/approval_queue.py::decide()` (CLI, `--by` required) → `approvals/decided.jsonl` | No non-human caller; decision fields `decided_by`/`decided_at_utc`/`decision_note` are required | T4.2 | offline | | | | |
| **R4** pending waits forever | `approvals/pending.json` — `expires_at_utc` **always null**, `execution_state` **always `NOT_EXECUTED`** | No TTL job, watchdog, cron or scheduler retry may change a `PENDING` status; 90-day clock-advance test proves it | T4.1, T4.3 | offline | | | | |
| **R4** audit trail | `approvals/decided.jsonl` (append-only) + `alerts/alerts.jsonl` (append-only) | Both files are never rewritten; `alerts.jsonl` is the canonical evidence record | T4.2 | offline | | | | |

---

## Blocking pre-flight (all must be green before Task Scheduler registration)

| # | Check | Command | Pass | Done |
|---|---|---|---|---|
| 1 | No secrets in the routine or state dir | `grep -rniE "password\|token\|secret\|api[_-]?key" monitoring/freecash/ data/freecash-monitor/` | 0 hits (secrets come from vault/env only) | ☐ |
| 2 | No invented endpoints | `grep -rn "PROVIDER_ENDPOINT_UNKNOWN" monitoring/freecash/` | every provider URL is either allowlisted-after-research or the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` | ☐ |
| 3 | R2 static check green | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | exit **0** (exit 1 = forbidden token found; exit 2 = target missing, i.e. not implemented yet) | ☐ |
| 4 | `# readonly-exempt:` markers reviewed | `grep -rn "readonly-exempt" monitoring/freecash/ \| wc -l` | count recorded as the baseline (rise = R2 eroding). Known deliberate false-positive class: prose/comments naming a forbidden verb must be marked exempted | ☐ |
| 5 | All offline tests pass | `py -3 -m pytest monitoring/freecash/tests -k "not live"` | 16 passed | ☐ |
| 6 | Task A registered, **restart-on-failure = Do not restart** | `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` | 08:35 daily, `IgnoreNew`, `StartWhenAvailable` | ☐ |
| 7 | Task B registered | `schtasks /Query /TN "FreeCash-Missed-Day-Watchdog" /V /FO LIST` | 23:50 daily | ☐ |
| 8 | No pre-existing file was modified by the implementation | `git status --short` before/after | only new paths under `monitoring/freecash/` and `data/freecash-monitor/` appear | ☐ |
| 9 | Legacy monitors disabled, not deleted | `git status` on `server/scripts/freecash-daily-monitor.mjs`, `scripts/monitoring/free-cash-daily-check.py` | unchanged on disk; documented as superseded in §11 | ☐ |
| 10 | Day-30 exit criteria understood | §9.2 check #4 (`degraded: true` count → 0) | operator acknowledges that until #4 is 0, "no change" reports are **unverified** | ☐ |

## Sign-off

| Role | Name | Date | Notes / open blockers |
|---|---|---|---|
| Implementer | | | |
| Operator (human approver) | | | |

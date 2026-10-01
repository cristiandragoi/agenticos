# WORKFLOW PLAN — Free Cash Finance Automation (V9, 2026-10-01)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` (HEAD `8f7463a`) · **Host:** Windows 11 (German-localised), git-bash, non-elevated
**Written:** 2026-10-01 ~08:40–08:46 operator-local (`date` → `Do,  1. Okt 2026 08:40:46`; Europe/Berlin, UTC+02:00) — i.e. **~11 h after V8**
**Supersedes:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V8-2026-09-30.md`. V8's D-2 ("app down, `:4600` refuses") is **no longer true**; V8's DoD #3 ("a data-less day leaves no day lock") is **falsified** — see F-1R below.
**Subject:** the daily status-monitoring routine for Free Cash Finance Automation, canonical package `D:/AgenticOS/monitoring/freecash/` (entry point `run_daily_check.py`), plus the revenue path it can never unblock.
**Evidence standard (C5):** every row in §0 is a command executed in *this* pass. Nothing is quoted from an earlier session. Inherited facts are labelled `inherited`.
**Footprint:** this file is **new** (additive). No existing file was edited, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created or modified. No provider network call. No credential, token or secret appears here. Every routine execution in this pass used a scratch `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp\`; the real root's hashes were pinned **before and after** the suite in the same command (V12).

---

## 0. Live state, verified in this pass (2026-10-01, 08:40–08:46 local / 06:40–06:46Z)

| # | Command (executed this pass) | Observed result | Verdict |
|---|---|---|---|
| V1 | `date` | `Do,  1. Okt 2026 08:40:46` — **11 h after V8** | clock of record |
| V2 | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` (exit measured **without** a pipe) | `run_all: tests=52 failures=0 errors=0 skipped=0`, `tests_exit=0` | routine self-tests **GREEN** |
| V3 | `python monitoring/freecash/verify_readonly.py` → `verify_readonly_exit=0` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` | R2 static gate **GREEN**, baseline **28** |
| V4 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → `shellscanner_exit=0` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` | both R2 scanners agree |
| V5 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` → **`entry_exit=1`** | `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · R1 sub-check evidence: `0 unexempted decisive hits in 476 lines (0 exempted by 'readonly-exempt:', 0 prose-only 'earning-verb' hits…)` | acceptance gate (C9) **RED**; the failure is now **attributed exactly**: the verifier scans the *entry file* for the lock mechanism that lives in `gate.py` |
| V6 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → **`package_exit=2`** | `usage: rule_gate_verify.py [-h] [--run] [--json] [--json-out JSON_OUT] target` · `error: unrecognized arguments: --package` | the package-scope command still **does not exist** (S0 unsolved) |
| V7 | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, **`2026-09-30.lock`** (09-30 lock mtime `2026-09-30 21:01`) | **the routine ran for real on 2026-09-30 — the day is consumed** |
| V8 | `cat data/freecash-monitor/snapshots/2026-09-30.json` | `day_key=2026-09-30`, `source.kind=operator_entered`, **`data_available: false`**, `degraded: true`, all four figures `null`, `note: "no operator-entered record for 2026-09-30 in operator-state.json"` | a **null snapshot** was written and the prior day (09-20) is its baseline |
| V9 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-30`, **`last_success_day=2026-09-30`**, `last_attempt_at_utc=2026-09-30T19:01:05Z`, `last_success_at_utc=2026-09-30T19:02:05Z`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=9` | **a day with no reading was recorded as a SUCCESS day** |
| V10 | `wc -l data/freecash-monitor/alerts/alerts.jsonl`; `tail -6` | **14 lines** (V8: 3). Tail = 4× `MISSED_DAY` (09-26…09-29, `ts 19:01:37–19:01:58Z`), 1× `MONITOR_DEGRADED` (19:02:05Z), 1× `SKIP_DUPLICATE_DAY` (19:02:06Z, `lock…2026-09-30.lock`) | a real run produced 11 new lines; R1's duplicate refusal **did fire** |
| V11 | `ls -1a data/freecash-monitor/approvals/` ; `python -c json.load(operator-state.json)['records']` | `approvals/` holds only `.`/`..`; `records=0` | **no approval item has ever existed; no reading has ever been entered** |
| V12 | `sha256sum` of real-root `last-run.json` + `alerts.jsonl` immediately **before and after** the suite, same command | `before=2310072a…8af399a 7a90034f…f82096cc`, `after=` identical → `HERMETIC: real root untouched by suite` | the offline suite is **hermetic** (re-measured today) |
| V13 | **F-1R — direct falsification of V8 DoD #3.** `FREECASH_DATA_ROOT=<clean temp> python monitoring/freecash/run_daily_check.py` on a day with no record | `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True … lock=2026-10-01.lock`; then `ls state/day-locks/` → **`2026-10-01.lock`**; `last-run.json` → `last_success_day=2026-10-01` | **REPRODUCED: a data-less day spends the lock AND is booked as a success day.** The clock is consumed by a run that read nothing |
| V14 | `sed -n '32,45p' monitoring/freecash/gate.py`; `grep -n "def record_outcome" -A14`; `grep -n "attempt\|outcome" monitoring/freecash/watchdog.py` | `SUCCESS_OUTCOMES = {OK_NO_CHANGE, INITIAL_BASELINE, EARNINGS_CHANGED, STATUS_CHANGED, BALANCE_CHANGED, `**`MONITOR_DEGRADED`**`}`; `record_outcome(): if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day`; `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | **root cause of F-1R**: "the monitor ran" is conflated with "a reading exists". A null snapshot makes the watchdog report `WATCHDOG_OK` |
| V15 | `grep -n "acquire_day_lock\|resolve_source\|day = gate.day_key" monitoring/freecash/run_daily_check.py` | `307: source_kind = resolve_source(args.source)` · `308: day = gate.day_key(now)` · `309: acquired, lock = gate.acquire_day_lock(day)`; the read itself only happens at `:372`, inside the lock | **F-1 still stands**: the day is claimed at `:309` before anything is read at `:372` |
| V16 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest package mtime **`2026-09-20 06:59`** (`changedetect.py`, `watchdog.py`); `gate.py` `2026-09-18 07:32` | **the code that ran on 09-30 is the code from 09-20** — the 09-30 run added no code and fixed nothing |
| V17 | `python -c` key-set over all 14 alert lines | keys = `day_key, dedupe_key, event_id, event_type, message, observed, severity, ts_utc` — **no writer/pid field**; the `2026-09-21T16:39:42Z` line is still present at line 3 | C14 **still open**: alert lines remain unattributable |
| V18 | `schtasks /Query /FO CSV /NH \| wc -l` → **278**; `… \| grep -ic freecash` → **0**; `schtasks /Query /TN "FreeCash-Daily-Monitor"` → `FEHLER: Das System kann die angegebene Datei nicht finden.` | 278 tasks, **0 Free Cash** | still **never scheduled**; nothing to undo before S7 |
| V19 | `curl -m5 http://localhost:4600/api/health` → **`4600=200`**; `curl -m5 http://127.0.0.1:3001/health` → `3001=000`; `tasklist \| grep -ic electron` → **0** | the backend **is up again** on `:4600` (V8 measured refused/000); `:3001` refused; **no Electron process** | **D-2 of V8 is stale**; the app's *server* answers, its *desktop shell* is not running |
| V20 | `sqlite3` replacement via `python sqlite3` on `server/data/agentic-os.db` | `provider_credentials = 0`; `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" → `status=blocked`, `current_stage=executing_mission`, `resumable=0`, `updated_at=2026-09-19T18:05:18.690Z`, blocker "Backend restarted while this task was in progress…", `result_text` **empty**; fleet `blocked 5 / completed 1144 / failed 1 / queued 7`; `schedule_executions max(triggered_at) = 2026-09-19T18:05:00.004Z` | revenue mission **still blocked**; in-app scheduler still dormant (now 12 days) |
| V21 | same DB → `revenue_ledger_entries`, `treasury_ledger`, `revenue_human_gates` | ledger 11 rows, newest `verified_at = 2026-08-19T13:45:25Z`, incl. `VERIFIED_REVENUE 19.0 EUR` (and unverified `REALIZED_REVENUE 100/100/150 EUR`, `ACTUAL_COST 20 EUR`); `treasury_ledger = 0`; 12 `SHOPIFY_AUTH_REQUIRED` gates, **all `resolved`** — 2 by `user` on `2026-08-19`, 10 by `operator-ui` on `2026-09-09` | recorded verified revenue is **€19, 6 weeks stale**; nothing shipped after the gate was satisfied |
| V22 | `git status --porcelain \| wc -l`; `git rev-parse --abbrev-ref HEAD`; `git log --oneline -1` | **855** untracked/modified lines (V8: 838, V7: 547); branch `hermes-rescue-20260908`, HEAD `8f7463a` | footprint keeps growing; `monitoring/` is **entirely untracked** (`?? monitoring/`) |
| V23 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH"` | only the scratch `FREECASH_DATA_ROOT` this pass set — **no credential, no external sink** | C6 holds |
| V24 | `ls server/src/services/freeCash/ server/src/adapters/freecashMonitorAdapter.ts` | `freeCashExecutor.ts` (18 443 B, mtime `2026-09-20 21:03`) and `freecashMonitorAdapter.ts` (6 428 B) both present | Path B exists (code); its *runtime* needs the app's session, not just the listener |

### 0.1 What changed since V8 (11 hours)

- **D-1 — the routine ran for real, against the real root, and it burned the day.** Between V8 (20:58) and now, `run_daily_check.py` executed at 21:01–21:02 local on a host with no operator record: it took `2026-09-30.lock`, wrote a **null** snapshot, emitted 4 `MISSED_DAY` + `MONITOR_DEGRADED` + `SKIP_DUPLICATE_DAY`, and recorded 09-30 as `last_success_day`. §0/V7–V10.
- **D-2 — V8's F-1 is no longer a prediction, it is an observed event, and it is worse than V8 described.** V8 said "the lock is taken before the read". Today's repro (§0/V13–V14) shows the same run **also advances `last_success_day`** and therefore **silences the watchdog**: a day with zero data is scored as a covered day. This is not a timing nit — it is the difference between "the monitor is alive" and "the monitor knows nothing", and the routine currently reports the second as the first.
- **D-3 — the backend came back.** `:4600 → 200` today (V8: refused). Path B is therefore *reachable again* in principle, but still needs a human-authenticated session, and the in-app scheduler has not ticked since 2026-09-19 (§0/V19–V20).
- **D-4 — nothing else moved.** No reading (V11), no approval item (V11), no task (V18), no code change in the package since 2026-09-20 06:59 (V16), revenue still €19 from 2026-08-19 (V21), footprint 838 → 855 (V22).

**One-line status:** the routine now demonstrably runs, refuses a duplicate the same day, and writes a real evidence trail — but the day it consumed on 09-30 produced no reading, was booked as a success, and silenced the watchdog (V13–V14); the acceptance gate is still red for a reasons-of-scope, not of code (V5–V6); nothing has ever run on a timer (V18); no reading or approval item has ever existed (V11); and the only authenticated money path is still blocked at a task last touched on 2026-09-19 (V20).

---

## 1. Operational constraints (binding — every stage is checked against these)

| ID | Constraint | Enforcement mechanism | Proof demanded at each stage |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py:119-135 AcquireDayLock` — `os.open(O_CREAT\|O_EXCL\|O_WRONLY)`; `gate.py:96 day_key()` | 2 runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY`; a race of N processes → one lock |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py` deny-by-default (`GET/HEAD`, loopback allowlist, no body) + two static scanners | both scanners exit **0** at `exempt=28` (V3, V4); a mutation copy still fails |
| **R3** | notify on status/earnings change, exactly once | `changedetect.py::compare` on integer cents; `dedupe_key` recorded before dispatch | seeded change → exactly one payload; no-change day → no dispatch |
| **R4** | human approval before ANY external action; no execution path exists | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decider must be a named human | clock advance changes nothing; a machine decider is refused |
| **C5** | evidence = live tool output, never carried over | every stage ends with a command re-executed in the same session | command + output quoted |
| **C6** | no secrets in code, state, logs, plans or chat | env/vault only, `[REDACTED]` elsewhere (V23) | `env`/log/state grep shows no credential |
| **C7** | never disturb unrelated uncommitted work; no destructive git | additive new files only; `git status` before/after; no `reset`/`clean`/`checkout --`/`stash` (855 lines, V22) | tracked-path status identical except the intended file |
| **C8 / C16** | one executable path per job — no third Free Cash implementation | extend before create; legacy runners labelled, never deleted; Path B is bridged, not extended | the stage names the file it extends; a grep shows one authoritative monitor |
| **C9** | acceptance gate green **before** any Task Scheduler registration | `scripts/monitoring/rule_gate_verify.py` exit 0 | `R1=PASS R2=PASS R3=PASS R4=PASS`, exit 0, **with the mutation probe still failing** |
| **C10** | interpreter of record = venv Python 3.11.9 | `py -3` (3.14.7) lacks `tzdata` → `ZoneInfoNotFoundError` → R1 day-key failure | the task action names `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (verified present this pass, `Python 3.11.9`) |
| **C11** | never spend the day before a reading exists | **VIOLATED today** — live repro V13: `day-locks/2026-10-01.lock` after a `data_available=False` run | a day with no reading leaves `day-locks/` **empty** after a run |
| **C12** | every health claim names the port and the time measured | V19: `:4600`=200, `:3001`=000, 0 Electron processes at 08:44 local | the port and the clock are in the sentence |
| **C13** | a scheduled run must not inherit ambient `FREECASH_*` | a `.cmd` wrapper sets root/timezone/source explicitly; `schtasks /TR` cannot set env | the wrapper's values are read back before registration |
| **C14** | `alerts/alerts.jsonl` is the canonical evidence record with exactly one writer per day | **OPEN** — V17: no line carries a writer/pid field; the `2026-09-21T16:39:42Z` line is still unattributed | a writer tag (pid + entry point) on each new line, or a documented operating window |
| **C15** | the acceptance gate cannot emit `COMPLIANT` for this package as scoped | V5 (entry file, R1 attributed to the wrong file) and V6 (no `--package` mode) | the chosen remedy is recorded in writing before C9 is claimed |
| **C17** | no plan may depend on an app-side component for timing or for the live read while the app may be closed | V19 (listener up, **no Electron process**); V20 (in-app scheduler last tick 2026-09-19) | any stage that needs Path B names "start the app" as its first concrete action and quotes a live health response in the same session |
| **C18** | single-sitting first actions | 11 days, 10 plan documents, 0 readings (§0/V11, V22) | the first concrete action is ≤ 1 command or ≤ 1 file append, measured in the same session |
| **C19 (NEW — "ran" ≠ "read")** | a run that produced no reading must never be recorded, counted, or reported as a covered/successful day | **VIOLATED** — `gate.py:32-40` puts `MONITOR_DEGRADED` in `SUCCESS_OUTCOMES`, `gate.py:198` advances `last_success_day`, `watchdog.py:33` then reports `WATCHDOG_OK` (V13–V14) | a `data_available=False` run leaves `day-locks/` empty **and** does not advance `last_success_day`; the watchdog reports that day as `WATCHDOG_MISSED_DAY` |
| **C20 (NEW — the monitor is a visibility instrument, not a revenue instrument)** | no stage outside S10 may be described as producing revenue | V21: recorded verified revenue €19 (2026-08-19), `treasury_ledger` 0, mission blocked since 2026-09-19 | every stage states Time-to-Revenue; only S10 may claim a path to cash |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**Ordering discipline:** `S0 ∧ S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8` (S8/S9 parallel, S10 separate and human-gated). One change between gate runs. A stage is complete only on output produced in the current session — never on a claim. Never widen an allowlist and exempt a scanner hit in the same change.

**S0 — Settle the acceptance gate (C9/C15). Blocking, and it is one file.**
Expected Effort: 2–4 h. Time-to-Revenue: none — this buys the verdict, not cash. Dependencies: none.
First Concrete Action: add a `--package <dir>` mode to `scripts/monitoring/rule_gate_verify.py` (argparse today: `target [--run] [--json] [--json-out]`, exit **2** on `--package`, V6) that attributes each rule to the module enforcing it — R1 to `gate.py::acquire_day_lock` (`gate.py:119-135`, `:128` `O_CREAT|O_EXCL`) — instead of scanning only the entry file, which today yields `0 unexempted decisive hits in 476 lines` (V5).
Exit: `… monitoring/freecash --package` exits **0** on the shipped package and exits **1** on a temp copy whose `O_CREAT|O_EXCL` is replaced by `if lock.exists()`.
Options: **O-A repair the verifier's scope (recommended, 2–4 h)** · O-B restructure one file to carry R1 (3–5 h, rejected — a second copy of the mechanism, C8 risk) · O-C declare C9 unsatisfiable and gate on `E2E-RULE-FLIGHT.md` instead (0.2 h documentation, only if O-A is refused; removes an automatable gate).

**S1 — Make the day budget honest and the scheduled path safe (C11 + C19, F-1/F-1R). Now the sharpest defect, and it is gating for scheduling.**
Expected Effort: 40 min (O-1) / 3–5 h (O-2) / ~1 h (O-3) / 3–5 h (O-4). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: write the failing test first — *"a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, and the watchdog reports that day as `WATCHDOG_MISSED_DAY`"* (today it does the opposite, V13) — then make coverage key on `data_available`, not on process completion.
Exit: a data-less run leaves `day-locks/` empty, `last_success_day` unchanged, watchdog `WATCHDOG_MISSED_DAY`; a day with a reading yields exactly one lock, one snapshot, and `SKIP_DUPLICATE_DAY` on the second run (that half already works, V10); the race test still shows one winner.
Options: **O-1 two-phase accounting only (~40 min, the honest minimum — stop scoring `MONITOR_DEGRADED` as a success; smallest change that makes the watchdog truthful)** · **O-2 two-phase lock + accounting (3–5 h, durable: an *attempt* record that only becomes a consumed day on a successful read; deliberately weakens "one read per day" to "one successful read per day" — must be stated in the decision record)** · **O-3 pre-flight guard in the `.cmd` wrapper (~1 h, defence in depth: refuse to invoke on a day whose `day_key` has no record; R1 code untouched)** · **O-4 both O-2 + O-3 (3–6 h, belt and braces)** · O-5 keep strict R1 and stay manual (0 h; unattended operation stays blocked — the safe default in force today).

**S2 — Settle the state root (one root, one writer).**
Expected Effort: 30–60 min. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: decide `data/freecash-monitor` (holds every real artifact — the 09-20 and 09-30 locks and snapshots, the 14-line alert log, `last-run.json`, V7–V11) over `data/freecash` (empty) and record the chosen `FREECASH_DATA_ROOT` in the task definition.
Exit: exactly one root holds state; a scheduled run cannot write a second one. Note: `server/data/freecash-monitor/` also exists untracked (V22) — it must be named and dispositioned, not left as an implicit second root.

**S3 — First real operator reading (O4).**
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day, visibility only** (C20). Dependencies: S1 (else the first data-less run burns the day — proven, V13), C10 interpreter.
First Concrete Action: the operator logs into their own dashboard and appends one record to `data/freecash-monitor/state/operator-state.json` for today's `day_key` with four integer-cent figures (`records: []` today, V11 — this would be the first ever), then runs the entry point once and quotes `RUN_OK … outcome=INITIAL_BASELINE`.
Exit: a day-1 baseline snapshot exists; a day-2 record with a changed figure produces exactly one payload and one approval item. Note: 2026-09-30 is already spent (V7) — day 1 of the new baseline cannot be 09-30.
Honest limit: every snapshot from this source is `degraded: true` by construction — a "no change" day only proves the same numbers were typed twice.

**S4 — Bridge Path B (authenticated app path) into Path A (the rule engine). Now unblocked at the listener, still gated on a human session.**
Expected Effort: 4–8 h (one mapping + a read-back test; no new module). Time-to-Revenue: **3–7 days of sight of the real account; no revenue** (C20). Dependencies: **a human starts the app and authenticates** (C17 — the listener answers `200` today but no Electron process runs, V19), the operator logs in via the existing `startInteractiveLogin()`, `checkAuthenticatedSession()` returns a live session, field names fixed in writing, and **S1 resolved first** (a reading obtained after the lock is burned is worthless — V13).
First Concrete Action: start the app, then call the existing probe **once** through the app's own path (`checkAuthenticatedSession()` in `server/src/services/freeCash/freeCashExecutor.ts`, present, mtime `2026-09-20 21:03`, V24) and quote its evidence artefact — then write the four-field mapping (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`) into the shape `operator_state.py` already reads.
Exit: one day's reading produced through Path B and consumed by Path A's existing `operator_state` source; `verify_readonly.py` still `forbidden=0 exempt=28`; `git status` shows no new monitor module.
Do not: create a third monitor (C16); add a provider host to `readonly_client.ALLOWED_PATHS` (an R2 widening and a second transport); extend `freecashMonitorAdapter.ts`, which enforces no rule and is a parallel monitor for the same job.

**S5 — Delivery: prove the one sink, or accept the log as the sink.**
Expected Effort: 0.5–1 h (test) / blocked for any off-host sink. Time-to-Revenue: none. Dependencies: S3 or S4 (needs a change to deliver).
First Concrete Action: with the operator at the desk and the session unlocked, dispatch one real toast and record the label (`TOAST_OK` vs `DELIVERY_FAILED`); then lock the session and repeat to see the bounded-failure path (2 attempts, then `DELIVERY_FAILED` carrying the full message).
Exit: the label observed under both conditions is written into the runbook.
Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` key, no mail tooling (V23).

**S6 — Approval surface (R4) surfaced to the human.**
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S3 or S4 (the queue is unreachable until a change is detected — `approvals/` has never held an item, V11).
First Concrete Action: decide one enqueued item as a named human via the documented CLI, and quote the append-only row from `approvals/decided.jsonl` together with `execution_state` staying `NOT_EXECUTED`; then repeat the machine-decider refusal.
Exit: every decision attributable to a human identifier; a `PENDING` item survives any clock advance unchanged; no execution path exists to be found.

**S7 — Schedule Task A + Task B — handover only, human-registered.**
Expected Effort: 1–2 h plus the operator's approval. Time-to-Revenue: none. Dependencies: **C9 green (S0)**, S1 (O-1 minimum), S3, and S2's pinned root; wrapper pinned to the 3.11.9 interpreter (C10, C13; interpreter verified present, V1/§0).
First Concrete Action: hand the operator the exact non-elevated `schtasks /Create` text (Task A 08:35, Task B 23:50, `IgnoreNew`, `StartWhenAvailable`, **restart-on-failure = Do not restart**) and **do not register it**.
Exit: `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and both policies, plus a quoted duplicate-day refusal; or an explicit recorded decision not to schedule, in which case the routine is described as *built and unverified in operation*.
Verified today: 278 scheduled tasks, **0 Free Cash** (V18) — nothing has to be undone first.

**S8 — Evidence bundle + writer attribution + tamper alarm (C14).**
Expected Effort: 1–2 h now, ~2 min/day after. Time-to-Revenue: none. Dependencies: none (parallel with S0/S1).
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — or document the operating window in which only the scheduled task may invoke the entry point — and archive, per day, the run-log line, snapshot hash, both scanner counts, alert/approval line counts and the real-root hash set (V12 pattern). **Newly urgent:** the log grew by 11 lines on 09-30 from a run nobody has attributed (V10, V17), so the writer question is no longer theoretical.
Exit: a new line's origin is identifiable from the line itself and the next bundle proves no line appeared outside the window; baseline taken **including** the 2026-09-21 anomaly line so it is not laundered.

**S9 — Deprecation index (delete nothing, C8/C16).**
Expected Effort: 1–2 h, read-only. Time-to-Revenue: none — false-compliance risk control. Dependencies: none.
First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `config/freecash-crontab` and `server/src/adapters/freecashMonitorAdapter.ts` as **DEPRECATED — do not cite as compliant**, each row with its exact gate command, naming `monitoring/freecash/` as the single implementation.
Exit: index exists; no file moved, edited or deleted.

**S10 — The revenue path (not the monitor; tracked so it is not silently dropped, C20).**
Expected Effort: unknown (a human decision and a worker re-dispatch first). Time-to-Revenue: **the only stage with a direct revenue hypothesis — and it is currently unbounded.** Dependencies: a human decision, the app running, and a publication step that does not exist.
First Concrete Action (option R-a): with the app running, the operator resumes `bgtask-07a8154b0` in the UI — `blocked`, `resumable=0`, `result_text` empty, blocker "Backend restarted while this task was in progress…", last update `2026-09-19T18:05:18Z` (V20).
Recorded reality: `revenue_ledger_entries` 11 rows, newest verified `2026-08-19`, incl. `VERIFIED_REVENUE 19.0 EUR`; `treasury_ledger` 0 rows; all 12 `SHOPIFY_AUTH_REQUIRED` human gates resolved (2 by `user` on 2026-08-19, 10 by `operator-ui` on 2026-09-09) (V21). The remaining blocker is a missing implementation step, not an approval: nothing has been published since the authorisation gate was satisfied.
Options: **R-a resume/re-dispatch the mission (1–2 h, unknown TTR, needs app + human)** · **R-b implement the publication step (unbounded effort, weeks-to-revenue if it works, needs app + decision)** · **R-c do nothing and keep the monitor as visibility only (0 h, 0 revenue — the honest default while S0/S1 are red)**.

---

## 3. Options at a glance (sorted by TTR within each decision)

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Gate (S0) | O-A repair verifier scope | 2–4 h | none | none | add `--package`; attribute R1 to `gate.py::acquire_day_lock` |
| Gate (S0) | O-B restructure one file | 3–5 h | none | none | rejected unless O-A fails |
| Gate (S0) | O-C override C9 | 0.2 h | none | operator sign-off | record the override; lose the automatable gate |
| Day budget (S1) | **O-1 honest accounting only** | ~40 min | none | none | failing test: data-less run must not advance `last_success_day` |
| Day budget (S1) | O-2 two-phase lock + accounting | 3–5 h | none | none | failing test first, then attempt-then-consume |
| Day budget (S1) | O-3 wrapper pre-flight guard | ~1 h | none | S7's wrapper | guard on today's `day_key` before invoking the entry point |
| Day budget (S1) | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | none — unattended operation stays blocked |
| Read source | **O4 operator-entered (available today)** | 0 h builder + 0.5 h operator | **same day, visibility** | S1 fix, pinned interpreter | append today's four integer-cent figures; expect `INITIAL_BASELINE` |
| Read source | **O6 Path-B bridged read (rank 1 target)** | 4–8 h | 3–7 days, visibility | app **running with a human session** (C17), S1 | start the app; call `checkAuthenticatedSession()` once; quote the artefact |
| Read source | O1 loopback metrics route | 3–5 h + new route work | 1–2 days, workstation metrics only | a route that has never existed | `curl :4600/api/v1/status/metrics` (expect 404) |
| Read source | O2 provider read contract | 2–4 h if an account exists, else onboarding | 3 days–2 weeks | confirmed account, out-of-repo token (**none: `provider_credentials`=0**, V20) | probe the documented endpoint with the operator's own token, `[REDACTED]` |
| Read source | O3 payout balance endpoint | 4–8 h + a written rules decision | 1–4 weeks, unbounded if refused | a POST-minted token, which R2 refuses by construction | probe unauthenticated; check for an enabled payouts key |
| Read source | O5 live-session automation in the routine | unknown | unknown | provider identity + session + credential | **BLOCKED** — keep off the critical path |
| Revenue (S10) | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume `bgtask-07a8154b0` in the UI |
| Revenue (S10) | R-b implement the publication step | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| Revenue (S10) | R-c monitor only | 0 h | none | none | none — say plainly that this produces visibility, not cash |

---

## 4. Blocked register (nothing here is achievable today without the named unblock)

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | S0 remedy or an operator override | `R1=FAIL`, `entry_exit=1` (V5); no `--package` mode, `package_exit=2` (V6) |
| Unattended scheduling | S1 remedy | a data-less run spends the lock **and** books the day as a success (V13) — scheduling now burns each day permanently and hides it |
| Trustworthy "monitor is alive" signal | S1 (C19) | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` → `watchdog.py:33` reports `WATCHDOG_OK` on a null snapshot (V14) |
| Live account status | the app running **with a human session** and the S4 bridge | listener `200`, but **0 Electron processes** (V19); `provider_credentials = 0` (V20) |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured (V23); only the toast is implemented |
| Any withdrawal or earning action | R4 human approval surface | must never run unattended; no execution path exists by design |
| In-app scheduler as a 24/7 mechanism | the desktop app process staying alive | last tick `2026-09-19T18:05Z` (V20); no Electron process today (V19) |
| Revenue mission `bgtask-07a8154b0` | worker re-dispatch after a lost worker | `blocked`, `resumable=0`, `result_text` empty, blocker names a backend restart (V20) |
| Publication of shopify-verified revenue | implementation | €19 verified 2026-08-19; all 12 `SHOPIFY_AUTH_REQUIRED` gates already `resolved`; nothing published since (V21) |
| Elevated task registration | elevated shell | non-elevated host by policy; a throwaway probe (S7) settles whether elevation is needed at all |
| Writer attribution on the canonical log (C14) | a code change or a documented operating window | no line carries a writer key; 11 lines appeared on 09-30 unattributed (V10, V17) |
| A second state root's disposition | an operator decision | `data/freecash-monitor/` and `server/data/freecash-monitor/` both exist untracked; `data/freecash` is empty (V22, §0/V7) |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S0 remedy: O-A / O-B / O-C | operator | C9 stays red and no task may be registered; the stall continues |
| D-2 | S1 remedy: O-1 / O-2 / O-3 / O-4 / O-5 | operator | one run per day keeps being spent with no reading, and the watchdog keeps reporting health it has not verified |
| D-3 | authoritative read source: O4 / O6 / O1 / O2 / O3 | operator | every snapshot stays `degraded: true` |
| D-4 | when the app is started, and by whom (C17) | operator | Path B — the only authenticated Free Cash path — stays unreachable even though its listener answers |
| D-5 | `freecashMonitorAdapter.ts`: label superseded, or remove once unused | operator | a second, rule-free monitor stays in the tree |
| D-6 | state-root disposition (S2) incl. `server/data/freecash-monitor/` | operator | two roots can silently diverge; evidence bundles become ambiguous |
| D-7 | revenue: R-a / R-b / R-c | operator | the money path stays blocked at €19 while the monitor keeps producing visibility only |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path, in any option. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session. No modification of the 855 pre-existing uncommitted paths (C7). No voice/Jarvis runtime path touched. **This routine produces visibility, not revenue** — no option in §3 outside S10 has a revenue time-to-value; the money path is `bgtask-07a8154b0`.

## 7. Definition of done

1. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=PASS R2=PASS R3=PASS R4=PASS`, with the mutation probe still failing (S0).
2. `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0`, `tests_exit=0`, and both R2 scanners exit 0 at a pinned `exempt=28` (today: V2–V4).
3. **A data-less day leaves no day lock, does not advance `last_success_day`, and is reported by the watchdog as `WATCHDOG_MISSED_DAY`** (S1, C11 + C19 — today the opposite is demonstrated, V13/V14).
4. One real reading consumed, one real change notified exactly once, one approval item decided by a named human, `execution_state` still `NOT_EXECUTED` (S3/S4/S6).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record — the duplicate half already observed on 09-30 (V10) (S3/S7).
6. Watchdog: healthy day silent; uncovered day exactly one alarm (S7).
7. Every `alerts.jsonl` line attributable to a known writer (S8, C14).
8. Both scheduled tasks quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule, with the routine described as *built and unverified in operation* (S7).
9. No credential anywhere in code, state, logs or plans (C6); no unrelated uncommitted path modified (C7); no earning action performed by anything (R2).
10. Every stage states its Time-to-Revenue, and no stage outside S10 claims a path to cash (C20).

**Honest one-line reading of 2026-10-01:** the routine now provably executes and refuses duplicates, but the one day it actually consumed (2026-09-30) contained no reading, was recorded as a success day, and silenced the watchdog (V13–V14); the compliance verdict is still withheld for a reasons-of-scope (V5/V6); nothing has ever run on a timer (V18); no reading or approval item has ever existed (V11); and verified revenue still stands at €19 from 2026-08-19 while the mission that could add to it sits blocked since 2026-09-19 (V20/V21). The shortest honest path to a first real number is **S1 (O-1, ~40 min) + S3 (operator-entered figures, same day)** — and the shortest honest path to a *trustworthy* monitor is that plus **S0**.

---

## 8. Independent second-pass verification (2026-10-01, 08:41–09:05 local) — addendum by a separate agent

A **separate** agent re-ran the evidence battery against the same live state ~4 minutes after §0 was written. **This addendum adds two corrections and one scope proof; it changes no conclusion and creates no second plan document** (deliberately, to avoid a second parallel plan — C8/C16 discipline applies to documents as much as to monitors).

| # | Command (executed this pass) | Observed result | Effect on this plan |
|---|---|---|---|
| A1 | `date`; `python -V` | `Do,  1. Okt 2026 08:41:11`; `Python 3.11.9` (`…/hermes-agent/venv/Scripts/python` on PATH) | §0/V1 re-confirmed; C10 holds on PATH today |
| A2 | `run_all.py` ×4, exit captured **without a pipe**, on fresh and dirty temp roots | 3× `tests=52 failures=0` · **1× `FAIL: test_five_concurrent_runs_yield_one_winner (test_r1_gate.ConcurrencyTests)` → `AssertionError: 3 != 4`**, `run_all: tests=52 failures=1`; `test_r1_gate.py` alone ×5 → 5/5 exit 0, `Ran 7 tests` | **CORRECTION to §7 DoD #2**: `tests=52 failures=0` is **not** stable. The R1 5-way race assertion is load-sensitive: it proves one winner in isolation, but failed once in four full-suite runs. DoD #2 must record the load condition, and S1's exit test must re-run the race **concurrently with the rest of the suite**, not alone |
| A3 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/gate.py` (exit captured directly) | `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`, exit **1** | **SCOPE PROOF for S0/D-1/O-A**: the verifier fails every rule on the very file that *holds* R1, because it is **file-scoped by construction**. No layout inside one file can satisfy four rules; package-scoped attribution (O-A) is therefore the **only** viable remedy, and O-B is now dead rather than merely disfavoured |
| A4 | gate on the entry file, exit captured **without a pipe** | `FAIL atomic same-day guard (double-run barrier)`; `FAIL day key is a calendar day`; `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1`; **exit 1** | §0/V5 re-confirmed, and the two failing R1 sub-checks are now named individually — both live in `gate.py:96`/`:128` |
| A5 | `python …/rule_gate_verify.py monitoring/freecash --package` | `error: unrecognized arguments: --package`, exit **2** (`add_argument` list `:1056–1061`) | §0/V6 re-confirmed with exit code |
| A6 | both R2 scanners, exit captured directly | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** (both) | §0/V3–V4 re-confirmed; baseline 28 stable |
| A7 | `sha256sum` of every real-root state file | `last-run.json 2310072a…399a` (len 64, matches §10.3 of `SCHEDULER-PLAN.md`), `operator-state.json be8becc3…a59c`, `alerts.jsonl 7a90034f…96cc`, `notified-keys.json 0f28d569…e9dd`, `logs/task-a.log 94c8c98c…91f3`, `logs/task-b-watchdog.log ec4eab60…3d67` | **hash set pinned for the next drift check**; the incident's values are byte-identical to the 09-30 forensic record, so **nothing has touched the real root in ~14 h** |
| A8 | 14-line `event_type`/`day_key` census + key set of the newest line | `MONITOR_DEGRADED 2`, `SKIP_DUPLICATE_DAY 2`, `MISSED_DAY 10`; by day `2026-09-20:2, 2026-09-21:1, 2026-09-30:11`; keys `day_key, dedupe_key, event_id, event_type, message, observed, severity, ts_utc` — **no writer field** | §0/V10/V17 re-confirmed; C14 still open on all 14 lines |
| A9 | `netstat -ano \| grep LISTENING \| grep -E ':4600\|:3001'`; `curl :4600/api/health` | a listener **is** bound on `:4600`; body served **200**; `:3001` → 000 | §0/V19 corroborated at the socket level — the `200` is a live listener, not a stale artifact |
| A10 | `git status --porcelain \| wc -l`; tracked-modified count; `… \| grep -iE "freecash\|monitoring"` | **856** total, **54** tracked-modified, **0** freecash/monitoring paths | §0/V22 re-confirmed at +1 (this document); C7 intact — no Free Cash path is tracked-modified |
| A11 | `sed -n '/^## 10/,/^## 11/p' …/scheduler/SCHEDULER-PLAN.md`; `cat …/freecash-task-a.cmd` | §10 documents the self-inflicted production write (`sed` rewrite matched nothing, exit 0 → two wrappers hit the real root); three **human** decisions open, with an explicit "do not let an agent decide this"; the `.cmd` wrapper pins root/tz/source and the 3.11.9 interpreter (C13) | confirms the 09-30 run arrived through the **wrapper path** — so §2/S1's wrapper pre-flight (O-3) alone is insufficient evidence, and **the incident's three decisions are a distinct, unowned work item this plan must carry** |

### 8.1 Two items added to the plan (both operator-owned, both cheap)

| Item | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **S11 — close the 2026-09-30 incident (new stage).** Accept or remediate the burned `2026-09-30.lock`, accept the 9 delivered toasts, decide whether to append (never rewrite) a corrective note to `alerts.jsonl` | 10 min of decisions (+ 1 command if remediated) | none | operator only; **no agent may execute this** | record three answers against §10.5 of `SCHEDULER-PLAN.md`; if remediating, hash the real root before and after `rm "D:/AgenticOS/data/freecash-monitor/state/day-locks/2026-09-30.lock"` |
| **F-7 fix inside S1 (new acceptance condition, not a new stage).** Make the R1 race proof load-robust | included in S1 (~40 min O-1 + ≤30 min) | none | S1 | add a suite-level test that runs the 5-way race **while the rest of `run_all.py` is executing**, and record the observed `skips=4 / runs=1` for that load condition |

### 8.2 Consequences for §4, §5 and §7

- §4 (blocked register) gains one row: **"trustworthy day-budget claim"** is blocked on S1 **and** on F-7's load-robust race proof — a single green in-isolation run no longer qualifies as evidence (A2).
- §5 gains **D-8: the 2026-09-30 incident decisions** (S11) — owner: operator; if deferred, every later state sentence must carry "one real day was spent by an incident and its decisions are open".
- §7 DoD #2 is **amended**: `tests=52 failures=0` **when the R1 race assertion runs under full-suite load** (A2). A green run in isolation is not sufficient.
- §2/S1's option table is refined by A11: **O-3 (wrapper pre-flight) alone cannot be the remedy** — the 09-30 run *was* the wrapper path.
- §2/S0's recommendation is upgraded from "recommended" to "**only viable**" (A3).

**Net effect of this addendum:** no conclusion of §0–§7 changes. Two claims are tightened (DoD #2, S1's option ranking), one option is eliminated (S0/O-B), one scope proof is added (S0/O-A), the real-root hash baseline is pinned, and the incident's three human decisions are formally carried as stage S11 with a named owner instead of being left in a delegation appendix.


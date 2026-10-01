# WORKFLOW PLAN — Free Cash Finance Automation (V8, 2026-09-30)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` (last commit 2026-09-28 12:12) · **Host:** Windows 11 (German-localised), git-bash, non-elevated
**Written:** 2026-09-30 ~20:50–20:58 operator-local (`date` → `Mi, 30. Sep 2026 20:50:51`, Europe/Berlin, UTC+02:00)
**Supersedes:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V7.md` (2026-09-21 18:43) and `…-V7-ADDENDUM-BRIDGE-2026-09-21.md` (18:49) — V7's rows V14/V15 (app healthy on :4600) are **no longer true**; see §1/D-2.
**Subject:** the daily status-monitoring routine for Free Cash Finance Automation, canonical package `D:/AgenticOS/monitoring/freecash/` (entry point `run_daily_check.py`), plus the revenue path it can never unblock.
**Evidence standard (C5):** every row in §0 is a command executed in *this* pass. Nothing is quoted from an earlier session. Inherited facts are labelled `inherited`.
**Footprint:** this file is **new** (additive). No existing file was edited, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean` was run. No scheduled task or crontab entry was created or modified. No provider network call was made. No credential, token or secret appears here. Every routine run in this pass used a scratch `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp\`; the real root's `last-run.json` and `alerts.jsonl` hashes are pinned in §0 V6 and were unchanged after the run.

---

## 0. Live state, verified in this pass (2026-09-30, 20:50–20:58 local)

| # | Command (executed this pass) | Observed result | Verdict |
|---|---|---|---|
| V1 | `date` | `Mi, 30. Sep 2026 20:50:51` — **9 days after V7** | clock of record |
| V2 | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit **0** | routine self-tests **GREEN** |
| V3 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** | R2 static gate **GREEN**, baseline **28** |
| V4 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** | both R2 scanners agree |
| V5 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · exit **1** | acceptance gate (C9) **RED** — unchanged after 9 days |
| V6 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` | `error: unrecognized arguments: --package` · exit **2** (only `target [--run] [--json] [--json-out]` exist, `rule_gate_verify.py:1056-1061`) | the package-scope command still **does not exist** |
| V7 | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` only — **no `2026-09-30.lock`** | today is unconsumed; no run has happened since 09-20 |
| V8 | `ls data/freecash-monitor/snapshots/` | `2026-09-20.json` only | no reading for 9 days |
| V9 | `wc -l data/freecash-monitor/alerts/alerts.jsonl`; `ls -1a data/freecash-monitor/approvals/`; `len(operator-state.json['records'])` | 3 lines; `approvals/` holds only `.`/`..`; `records = 0` | **no reading has ever been entered; no approval item has ever existed** |
| V10 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | ledger frozen since 09-20T19:08Z |
| V11 | `schtasks /Query /FO CSV /NH \| wc -l` → 278; `… \| grep -ic freecash` → 0; `schtasks /Query /TN "FreeCash-Daily-Monitor"` | 278 tasks, **0 Free Cash**; targeted query → `FEHLER: Das System kann die angegebene Datei nicht finden.` | **still never scheduled** |
| V12 | `curl -m5 http://localhost:4600/api/health`; `curl -m5 http://127.0.0.1:3001/health`; `tasklist \| grep -ic electron` | `4600` → **connect refused (000)**; `3001` → refused (000); **0** electron processes | **the AgenticOS backend is DOWN today** — V7 saw 200 here |
| V13 | `sqlite3 server/data/agentic-os.db` → `provider_credentials`; `background_tasks`; `schedules`; `schedule_executions` | `provider_credentials = 0`; `bgtask-07a8154b0` “Revenue Operator: Free Cash Mission” `status=blocked`, `current_stage=executing_mission`, `resumable=0`, blocker “Backend restarted while this task was in progress…”, `updated_at=2026-09-19T18:05:18.690Z`; fleet `blocked 5 / completed 1144 / failed 1 / queued 7`; 4 schedules, newest tick `2026-09-19T18:05:00.070Z`; `schedule_executions` 2875 rows, `max(triggered_at)=2026-09-19T18:05:00.004Z` | revenue mission **still blocked**; in-app scheduler dormant 11 days |
| V14 | same DB → `revenue_ledger_entries`, `treasury_ledger`, `revenue_human_gates` | ledger 11 rows, newest `2026-08-19`, incl. `VERIFIED_REVENUE 19.0 EUR` (source `shopify`, evidence “Order #1234 paid”); `treasury_ledger = 0`; 16 human gates, `SHOPIFY_AUTH_REQUIRED` rows `resolved` by `operator-ui` on `2026-09-09` | recorded revenue is **€19, 6 weeks stale**; the Shopify authorisation gate was satisfied but nothing shipped after it |
| V15 | `git status --porcelain \| wc -l` | **838** lines at first read, **842** after this pass's suite run (V7 measured 547 on 09-21); of the 53 non-untracked lines, all are pre-existing `server/src/domains/controlPlane/**` + `electron/**` edits unrelated to Free Cash; the +4 are `__pycache__` artefacts written by executing the suite, and no `monitoring/freecash/*.py` mtime is later than **2026-09-20T06:59** | untracked footprint keeps growing; nothing here is committed; **no source file was touched by this pass** |
| V16 | `grep -n "acquire_day_lock\|resolve_source\|day = gate.day_key" monitoring/freecash/run_daily_check.py` | `307: source_kind = resolve_source(…)` · `308: day = gate.day_key(now)` · `309: acquired, lock = gate.acquire_day_lock(day)` | **F-1 reproduced**: the day is spent before the source is resolved |
| V17 | `grep -n "O_CREAT\|def acquire_day_lock\|def day_key" monitoring/freecash/gate.py` | `96: def day_key` · `119: def acquire_day_lock` · `128: os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)` | the R1 mechanism genuinely exists — in `gate.py`, not in the file the gate reads |
| V18 | `ls .hermes/scratch/freecash/pkg` | a full package copy, incl. `gate.py`/`notify.py` | the F-6 unattributed-writer lead is still on disk; `paths.py`'s default root is `D:/AgenticOS/data/freecash-monitor` |
| V19 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH"` | only the scratch `FREECASH_DATA_ROOT` this pass set — **no credential, no external sink** | C6 holds |
| V20 | `ls server/src/services/freeCash/ server/src/adapters/freecashMonitorAdapter.ts` | `freeCashExecutor.ts` and `freecashMonitorAdapter.ts` both present | Path B exists (code), but its runtime needs the app, which is down (V12) |
| V21 | `sha256sum` of real-root `last-run.json` + `alerts.jsonl` before/after the suite | `5e25ae59…b4caf`, `81e811f1…6270a` — unchanged | the offline suite is **hermetic w.r.t. the real root** (re-measured) |

### 0.1 What changed since V7 (9 elapsed days)

- **D-1 — zero progress.** No reading, no snapshot, no approval item, no day lock, no scheduled task has appeared since 2026-09-20. The routine is exactly where V7 left it, minus 9 days.
- **D-2 — the app-side path is no longer merely dormant, it is unavailable.** V7 measured `:4600 → 200`; today `:4600` and `:3001` both refuse and no Electron process runs. Nothing app-side (Path B's executor, the in-app scheduler) can be relied on as a clock or as a live read until the app is started by a human.
- **D-3 — untracked footprint 547 → 838.** Ten parallel plan documents and one scratch package copy exist; none is committed; the deprecation index (S9) is still unwritten.
- **D-4 — the revenue blocker moved from “gate” to “code”.** The Shopify authorisation human-gate was resolved on 2026-09-09, and the supervisor's own result text says the remaining blocker is that *Shopify publication is not implemented*. Recorded, verified revenue stands at €19 (2026-08-19) with an empty `treasury_ledger`.

**One-line status:** the four rules are enforced in code and their own checkers are green and mutation-tested, but the acceptance gate is still red (V5), the package command that would settle it still does not exist (V6), nothing has run on a timer (V11), no reading was ever entered (V9), and the app that holds the only authenticated Free Cash path is switched off (V12).

---

## 1. Operational constraints (binding — every stage is checked against these)

| ID | Constraint | Enforcement mechanism | Proof demanded at each stage |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py:119-135 AcquireDayLock` — `os.open(O_CREAT\|O_EXCL\|O_WRONLY)` at `:128`; `gate.py:96 day_key()`; 23:50 watchdog as a second detector | 2 runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY`; a race of N processes → one lock |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py` deny-by-default (`GET/HEAD`, loopback allowlist, no body) + two static scanners | both scanners exit **0** at `exempt=28` (V3, V4); a mutation copy still fails |
| **R3** | notify on status/earnings change, exactly once | `changedetect.py::compare` on integer cents; `dedupe_key` recorded before dispatch; `OK_NO_CHANGE` log-only | seeded change → exactly one payload; no-change day → no dispatch |
| **R4** | human approval before ANY external action; no execution path exists | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decider must be a named human | clock advance changes nothing; a machine decider is refused |
| **C5** | evidence = live tool output, never carried over | every stage ends with a command re-executed in the same session | command + output quoted |
| **C6** | no secrets in code, state, logs, plans or chat | env/vault only, `[REDACTED]` elsewhere (V19) | `env`/log/state grep shows no credential |
| **C7** | never disturb unrelated uncommitted work; no destructive git | additive new files only; `git status` before/after; no `reset`/`clean`/`checkout --`/`stash` (838 lines, V15) | tracked-path status identical except the intended file |
| **C8 / C16** | one executable path per job — no third Free Cash implementation | extend before create; legacy runners labelled, never deleted; Path B is bridged, not extended | the stage names the file it extends; a grep shows one authoritative monitor |
| **C9** | acceptance gate green **before** any Task Scheduler registration | `scripts/monitoring/rule_gate_verify.py` exit 0 | `R1=PASS R2=PASS R3=PASS R4=PASS`, exit 0, **with the mutation probe still failing** |
| **C10** | interpreter of record = venv Python 3.11.9 | `py -3` (3.14.7) lacks `tzdata` → `ZoneInfoNotFoundError` → R1 day-key failure | the task action names `…/hermes-agent/venv/Scripts/python.exe` |
| **C11** | never spend the day before a reading exists to compare | today the lock is still taken at `run_daily_check.py:309`, before `resolve_source` at `:307`-adjacent (V16) | a day with no reading leaves `day-locks/` **empty** after a run |
| **C12** | the backend serves :4600 when it runs at all — and today it is not running | V12: both `:4600` and `:3001` refuse; 0 Electron processes | every health claim names the port measured and the time measured |
| **C13** | a scheduled run must not inherit ambient `FREECASH_*` | a `.cmd` wrapper sets root/timezone/source explicitly; `schtasks /TR` cannot set env | the wrapper's values are read back before registration |
| **C14** | `alerts/alerts.jsonl` is the canonical evidence record with exactly one writer per day | an unattributed append at `2026-09-21T16:39:42Z` (V18's copy is the lead) | a writer tag (pid + entry point) on each new line, or a documented operating window |
| **C15** | the acceptance gate cannot emit `COMPLIANT` for this package as scoped | V5 (entry file) and V6 (no `--package` mode) | the chosen remedy is recorded in writing before C9 is claimed |
| **C17 (NEW — the app is not a clock)** | no plan may depend on an app-side component for timing or for the live read while the app may be closed | V12 (no listener, no Electron process); V13 (in-app scheduler last tick 2026-09-19) | any stage that needs Path B names “start the app” as its first concrete action and quotes a live health response in the same session |
| **C18 (NEW — single-sitting first actions)** | a stage whose first concrete action depends on operator discipline that has already failed for 9 days must be reduced to one action in one sitting, or dropped | D-1/D-3: two documents and 9 days produced no reading and no task | the first concrete action is ≤ 1 command or ≤ 1 file append, and its effect is measured in the same session |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**Ordering discipline:** `S0 ∧ S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8` (S9 parallel, S10 separate and human-gated). One change between gate runs. A stage is complete only on output produced in the current session — never on a claim. Never widen an allowlist and exempt a scanner hit in the same change.

**S0 — Settle the acceptance gate (C9/C15). Blocking, and it is one file.**
Expected Effort: 2–4 h. Time-to-Revenue: none — this buys the verdict, not cash. Dependencies: none.
First Concrete Action: add a `--package <dir>` mode to `scripts/monitoring/rule_gate_verify.py` (argparse today: `target [--run] [--json] [--json-out]`, `:1056-1061`; V6) that attributes each rule to the module enforcing it — `gate.py::acquire_day_lock` (`:128`) for R1 — and drops the `:220` “rolling 24h window” false positive, which is missed-day arithmetic, not the daily gate.
Exit: `… monitoring/freecash --package` exits **0** on the shipped package and exits **1** on a temp copy whose `O_CREAT|O_EXCL` is replaced by an `if lock.exists()` check.
Options: **O-A repair the verifier's scope (recommended, 2–4 h)** · O-B restructure one file to carry R1 (3–5 h, rejected — adds a second copy of the mechanism, C8 risk) · O-C declare C9 unsatisfiable and gate on `E2E-RULE-FLIGHT.md` instead (0.2 h documentation, only if O-A is refused; it removes an automatable gate).

**S1 — Make the scheduled path safe to run unattended (C11, F-1). Gating decision for scheduling.**
Expected Effort: 1 h (O-1) or 3–5 h (O-2). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: write the failing test first — “a run on a day with `records: []` writes `MONITOR_DEGRADED` and leaves `day-locks/` empty” — then implement an *attempt* record that only becomes a consumed day on a successful read.
Exit: a data-less day leaves no lock; a day with a reading yields exactly one lock, one snapshot, and `SKIP_DUPLICATE_DAY` on a second run; the existing race test still shows one winner.
Options: **O-1 pre-flight guard in the `.cmd` wrapper (~1 h, defence in depth, R1 untouched)** · **O-2 two-phase lock inside the routine (3–5 h, durable; deliberately weakens “one read per day” to “one successful read per day” — must be stated in the decision record)** · O-3 keep strict R1 and stay manual (0 h; unattended operation stays blocked, and that is the safe default in force today).

**S2 — Settle the state root (one root, one writer).**
Expected Effort: 30–60 min. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: decide `data/freecash-monitor` (holds every real artifact, V7–V10) over `data/freecash` (empty) and record the chosen `FREECASH_DATA_ROOT` in the task definition.
Exit: exactly one root holds state; a scheduled run cannot write a second one.

**S3 — First real operator reading (O4).**
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day, visibility only**. Dependencies: S1 (else the first data-less run burns the day), C10 interpreter.
First Concrete Action: the operator logs into their own dashboard and appends one record to `data/freecash-monitor/state/operator-state.json` for today's `day_key` with four integer-cent figures (`records: []` today, V9 — this would be the first ever), then runs the entry point once and quotes `RUN_OK … outcome=INITIAL_BASELINE`.
Exit: a day-1 baseline snapshot exists; a day-2 record with a changed figure produces exactly one payload and one approval item.
Honest limit: every snapshot from this source is `degraded: true` by construction — a “no change” day only proves the same numbers were typed twice.

**S4 — Bridge Path B (authenticated app path) into Path A (the rule engine).**
Expected Effort: 4–8 h (one mapping + a read-back test; no new module). Time-to-Revenue: **3–7 days of sight of the real account; no revenue**. Dependencies: **a human starts the app** (C17 — it is down today, V12), the operator authenticates in the managed browser profile via the existing `startInteractiveLogin()`, `checkAuthenticatedSession()` returns a live session, field names fixed in writing, and S1 resolved first (a reading obtained after the lock is burned is worthless).
First Concrete Action: start the app, then call the existing probe **once** through the app's own path (`checkAuthenticatedSession()` in `server/src/services/freeCash/freeCashExecutor.ts`) and quote its evidence artefact — then write the four-field mapping (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`) into the shape `operator_state.py` already reads.
Exit: one day's reading produced through Path B and consumed by Path A's existing `operator_state` source; `verify_readonly.py` still `forbidden=0 exempt=28`; `git status` shows no new monitor module.
Do not: create a third monitor (C16); add a provider host to `readonly_client.ALLOWED_PATHS` (that is an R2 widening and a second transport); extend `freecashMonitorAdapter.ts`, which enforces no rule and is a parallel monitor for the same job.

**S5 — Delivery: prove the one sink, or accept the log as the sink.**
Expected Effort: 0.5–1 h (test) / blocked for any off-host sink. Time-to-Revenue: none. Dependencies: S3 or S4 (needs a change to deliver).
First Concrete Action: with the operator at the desk and the session unlocked, dispatch one real toast and record the label (`TOAST_OK` vs `DELIVERY_FAILED`); then lock the session and repeat to see the bounded-failure path (2 attempts, then `DELIVERY_FAILED` carrying the full message).
Exit: the label observed under both conditions is written into the runbook.
Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` key, no mail tooling (V19).

**S6 — Approval surface (R4) surfaced to the human.**
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S3 or S4 (the queue is unreachable until a change is detected).
First Concrete Action: decide one enqueued item as a named human via the documented CLI, and quote the append-only row from `approvals/decided.jsonl` together with `execution_state` staying `NOT_EXECUTED`; then repeat the machine-decider refusal.
Exit: every decision attributable to a human identifier; a `PENDING` item survives any clock advance unchanged; no execution path exists to be found.

**S7 — Schedule Task A + Task B — handover only, human-registered.**
Expected Effort: 1–2 h plus the operator's approval. Time-to-Revenue: none. Dependencies: **C9 green (S0)**, S1, S3, and S2's pinned root; wrapper pinned to the 3.11.9 interpreter (C10, C13).
First Concrete Action: hand the operator the exact non-elevated `schtasks /Create` text (Task A 08:35, Task B 23:50, `IgnoreNew`, `StartWhenAvailable`, **restart-on-failure = Do not restart**) and **do not register it**.
Exit: `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and both policies, plus a quoted duplicate-day refusal; or an explicit recorded decision not to schedule, in which case the routine is described as *built and unverified in operation*.
Verified today: 278 scheduled tasks, **0 Free Cash** (V11) — so nothing has to be undone first.

**S8 — Evidence bundle + writer attribution + tamper alarm (C14).**
Expected Effort: 1–2 h now, ~2 min/day after. Time-to-Revenue: none. Dependencies: none (parallel with S0/S1).
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — or document the operating window in which only the scheduled task may invoke the entry point — and archive, per day, the run-log line, snapshot hash, both scanner counts, alert/approval line counts and the real-root hash set (V21 pattern).
Exit: a new line's origin is identifiable from the line itself and the next bundle proves no line appeared outside the window; baseline taken **including** the 2026-09-21 anomaly line so it is not laundered.

**S9 — Deprecation index (delete nothing, C8/C16).**
Expected Effort: 1–2 h, read-only. Time-to-Revenue: none — false-compliance risk control. Dependencies: none.
First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `config/freecash-crontab` and `server/src/adapters/freecashMonitorAdapter.ts` as **DEPRECATED — do not cite as compliant**, each row with its exact gate command, naming `monitoring/freecash/` as the single implementation.
Exit: index exists; no file moved, edited or deleted.

**S10 — The revenue path (not the monitor; tracked so it is not silently dropped).**
Expected Effort: unknown (needs a human decision and a worker re-dispatch first). Time-to-Revenue: **the only stage with a direct revenue hypothesis — and it is currently unbounded.** Dependencies: a human decision, the app running, and a publication step that does not exist.
First Concrete Action (option R-a): with the app running, the operator resumes `bgtask-07a8154b0` in the UI — it is `blocked`, `resumable=0`, blocker “Backend restarted while this task was in progress…”, last update `2026-09-19T18:05:18Z` (V13).
Recorded reality: `revenue_ledger_entries` 11 rows, newest `2026-08-19`, incl. `VERIFIED_REVENUE 19.0 EUR`; `treasury_ledger` 0 rows (V14). The supervisor's own result text names the remaining blocker: *“Shopify publication is not implemented”*; the `SHOPIFY_AUTH_REQUIRED` human gate was already resolved on 2026-09-09.
Options: **R-a resume/re-dispatch the mission (1–2 h, unknown TTR, needs app + human)** · **R-b implement the Shopify publication step (unbounded effort, weeks-to-revenue if it works, needs app + decision)** · **R-c do nothing and keep the monitor as visibility only (0 h, 0 revenue — the honest default while S0/S1 are red)**.

---

## 3. Options at a glance (sorted by TTR within each decision)

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Gate (S0) | O-A repair verifier scope | 2–4 h | none | none | add `--package` mode; attribute R1 to `gate.py::acquire_day_lock` |
| Gate (S0) | O-B restructure one file | 3–5 h | none | none | rejected unless O-A fails |
| Gate (S0) | O-C override C9 | 0.2 h | none | operator sign-off | record the override; lose the automatable gate |
| Day budget (S1) | O-1 wrapper pre-flight | ~1 h | none | S7's wrapper | guard on today's `day_key` before invoking the entry point |
| Day budget (S1) | O-2 two-phase lock | 3–5 h | none | none | failing test first, then attempt-then-consume |
| Day budget (S1) | O-3 stay manual | 0 h | none | none | none — unattended operation stays blocked |
| Read source | **O4 operator-entered (available today)** | 0 h builder + 0.5 h operator | **same day, visibility** | S1 guard, pinned interpreter | append today's four integer-cent figures; expect `INITIAL_BASELINE` |
| Read source | **O6 Path-B bridged read (rank 1 target)** | 4–8 h | 3–7 days, visibility | app running (C17), operator login, S1 | start the app; call `checkAuthenticatedSession()` once; quote the artefact |
| Read source | O1 loopback metrics route | 3–5 h + new route work | 1–2 days, workstation metrics only | a route that has never existed; app running | `curl :4600/api/v1/status/metrics` (expect 404 while the app is down) |
| Read source | O2 provider read contract | 2–4 h if an account exists, else onboarding | 3 days–2 weeks | confirmed account, out-of-repo token (**none: `provider_credentials`=0**, V13) | probe the documented endpoint with the operator's own token, `[REDACTED]` |
| Read source | O3 payout balance endpoint | 4–8 h + a written rules decision | 1–4 weeks, unbounded if refused | a POST-minted token, which R2 refuses by construction | probe unauthenticated; check for an enabled payouts key |
| Read source | O5 live-session automation in the routine | unknown | unknown | provider identity + session + credential | **BLOCKED** — keep off the critical path |
| Revenue (S10) | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume `bgtask-07a8154b0` in the UI |
| Revenue (S10) | R-b implement Shopify publication | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| Revenue (S10) | R-c monitor only | 0 h | none | none | none — say plainly that this produces visibility, not cash |

---

## 4. Blocked register (nothing here is achievable today)

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | S0 remedy or an operator override | `R1=FAIL`, exit 1 (V5); no `--package` mode exists (V6) |
| Unattended scheduling | S1 remedy | the lock is taken before the read (V16) — scheduling now burns each day permanently |
| Live account status | the app running **and** a session **and** the S11 bridge | app down, no listener (V12); `provider_credentials` = 0 (V13) |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured (V19); only the toast is implemented |
| Any withdrawal or earning action | R4 human approval surface | must never run unattended; no execution path exists by design |
| In-app scheduler as a 24/7 mechanism | the desktop app process staying alive | last tick `2026-09-19T18:05Z`; 2875 executions, `max(triggered_at)` 2026-09-19 (V13); app down today (V12) |
| Revenue mission `bgtask-07a8154b0` | worker re-dispatch after a lost worker | `blocked`, `resumable=0`, blocker names a backend restart (V13) |
| Shopify publication | implementation | the supervisor's own result text: “Shopify publication is not implemented” (V13/V14) |
| Elevated task registration | elevated shell | non-elevated host by policy; a throwaway probe (S7) settles whether elevation is needed at all |
| Writer attribution on the canonical log (C14) | a code change or a documented operating window | an unattributed append at `2026-09-21T16:39:42Z`; the package copy that explains it is still at `.hermes/scratch/freecash/pkg` (V18) |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S0 remedy: O-A / O-B / O-C | operator | C9 stays red and no task may be registered; the 9-day stall continues |
| D-2 | S1 remedy: O-1 / O-2 / O-3 | operator | scheduling stays unsafe; the routine stays manual |
| D-3 | authoritative read source: O4 / O6 / O1 / O2 / O3 | operator | every snapshot stays `degraded: true` |
| D-4 | when the app is started, and by whom (C17) | operator | Path B — the only authenticated Free Cash path — stays unreachable |
| D-5 | `freecashMonitorAdapter.ts`: label superseded, or remove once unused | operator | a second, rule-free monitor stays in the tree |
| D-6 | revenue: R-a / R-b / R-c | operator | the money path stays blocked and the monitor keeps producing visibility only |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path, in any option. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session. No modification of the 838 pre-existing uncommitted paths (C7). No voice/Jarvis runtime path touched. **This routine produces visibility, not revenue** — no option in §3 outside S10 has a revenue time-to-value; the money path is `bgtask-07a8154b0`.

## 7. Definition of done

1. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=PASS R2=PASS R3=PASS R4=PASS`, with the mutation probe still failing (S0).
2. `python monitoring/freecash/tests/run_all.py` → `failures=0 errors=0`, exit 0, and both R2 scanners exit 0 at a pinned `exempt=28` (S0 baseline; today: V2–V4).
3. A data-less day leaves no day lock (S1, C11).
4. One real reading consumed, one real change notified exactly once, one approval item decided by a named human, `execution_state` still `NOT_EXECUTED` (S3/S4/S6).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S3/S7).
6. Watchdog: healthy day silent; uncovered day exactly one alarm (S7).
7. Every `alerts.jsonl` line attributable to a known writer (S8, C14).
8. Both scheduled tasks quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule, with the routine described as *built and unverified in operation* (S7).
9. No credential anywhere in code, state, logs or plans (C6); no unrelated uncommitted path modified (C7); no earning action performed by anything.

**Honest one-line reading of 2026-09-30:** the four rules are enforced in code and demonstrated by commands in this session; the compliance verdict is still withheld (V5/V6), the routine has still never run on a timer (V11), no reading has ever been entered (V9), and the app that holds the only authenticated Free Cash path is switched off (V12) — so the plan's shortest honest path to a first real number is **S1 + S3 today (operator-entered figures) and S0 + S4 next (gate verdict, then the bridge)**.

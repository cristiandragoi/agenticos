# WORKFLOW PLAN — Free Cash Finance Automation (V7)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11 (`CDINTERNATIONAL`), user `cd-pr`, git-bash, non-elevated
**Written:** 2026-09-21 ~18:38–18:45 local (`date` → `Mo, 21. Sep 2026 18:38:18`, `Europe/Berlin`, UTC+02:00)
**Supersedes:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V6.md` (2026-09-20 21:47) — V6's §0 row V12 is **wrong** and is corrected in §1/C12 below.
**Route under plan:** `monitoring/freecash/` (stdlib-only Python; entry point `run_daily_check.py`)
**Evidence standard (C5):** every claim below is a command executed in *this* pass (2026-09-21, 18:38–18:45 local / 16:38–16:45Z). Nothing is quoted from an earlier session.
**Footprint:** this file is new and additive. No existing file was modified, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout` was run. Pre-existing uncommitted work: **547** `git status --porcelain` lines (96 index-modified, rest untracked) — unchanged by this pass except where noted in F-6.

---

## 0. Live state, verified in this pass

| # | Command (executed this pass) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` (run twice: 18:39 and 18:44) | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 (both runs) | **GREEN** |
| V2 | `python monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` · `PASS` | **GREEN** |
| V3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `[verify-readonly] forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** | **GREEN — both R2 checkers agree; baseline still 28** |
| V4 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · **exit 1**; R1 fails on `atomic same-day guard (double-run barrier)` and `day key is a calendar day`, both "not found **in the file**" | **RED — acceptance gate (C9) still open** |
| V5 | `which python` / `python --version` / `py -3 --version` | `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → `3.11.9`; `py -3` → `3.14.7` | interpreter of record = the venv (C10) |
| V6 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` and `…-Missed-Day-Watchdog` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | **NOT SCHEDULED** |
| V7 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH"` | no match (exit 1) — this shell is clean (contrast B7: a concurrent harness injected `FREECASH_*` yesterday) | no credential, no external sink |
| V8 | `ls docs/free-cash-monitor-routine/DELEGATION-2026-09-21/` | `FreeCash-Daily-Monitor.xml`, `FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml`, `freecash-task-a.cmd`, `freecash-task-b-watchdog.cmd`, `GATE-FALSIFICATION.md` (52 KB), `E2E-RULE-FLIGHT.md` (155 KB), `SCHEDULER-AND-DELIVERY.md` (45 KB), `evidence/` | scheduler definitions exist **inert** — they register nothing |
| V9 | `find data/freecash-monitor -type f` | `alerts/alerts.jsonl`, `snapshots/2026-09-20.json`, `state/day-locks/2026-09-20.lock`, `state/last-run.json`, `state/notified-keys.json`, `state/operator-state.json` | real root; **no `2026-09-21.lock`** |
| V10 | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` only | **today's day is NOT consumed — a real reading is still possible today** |
| V11 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | one manual run, degraded; unchanged since 2026-09-20T19:08Z |
| V12 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | **no reading has ever been entered; R3/R4 have never run on real input** |
| V13 | `wc -l data/freecash-monitor/alerts/alerts.jsonl` → 3; `ls data/freecash-monitor/approvals/` → empty | lines: `MONITOR_DEGRADED`(09-20), `SKIP_DUPLICATE_DAY`(09-20), `MISSED_DAY`(09-21, `ts_utc=2026-09-21T16:39:42Z`) | no approval item has ever existed; see **F-6** on line 3 |
| V14 | `curl -sS -m5 http://localhost:4600/api/health` | `code=200` `{"status":"healthy","version":"9.0.0", "build":{"gitSha":"d14253df…","isDirty":true,"buildTimestamp":"2026-09-21T16:37:05.992Z"}, "uptime":7.16}`; `netstat` shows `127.0.0.1:4600` | **the app IS running — on 4600** |
| V15 | `curl -sS -m5 -o /dev/null -w 'code=%{http_code}' http://127.0.0.1:3001/health` | `code=000`, connect refused | **3001 is not the app's port — V6's row V12 drew the wrong conclusion** |
| V16 | `server/data/agentic-os.db` → `schedule_executions` | 2875 rows, `max(triggered_at)=2026-09-19T18:05:00.004Z`; outcomes `completed 2649`, `dispatch_failed 224`, `dispatched 1`, `execution_failed 1` → **7.9 % non-completed** | in-app scheduler is lossy and stopped |
| V17 | same DB → `schedules` | 4 rows; `schedule-revenue-supervisor-tick` `*/5 * * * *` enabled, last `2026-09-19T18:05:00.070Z`; briefings last `2026-09-09`/`2026-09-07`; `sched-cd341dac…` (`0 9 * * *`, enabled) `last_triggered_at=null` | in-app scheduler dormant since 2026-09-19 |
| V18 | same DB → `provider_credentials`, `system_secrets` | `0` rows each | no provider credential exists |
| V19 | same DB → `background_tasks` | `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" `blocked`, `current_stage=executing_mission`, `resumable=0`, `updated_at=2026-09-19T18:05:18.690Z`; fleet `blocked 5, completed 1144, failed 1, queued 7` | revenue path stalled at the **execution gate**, not at the monitor |
| V20 | same DB → `projects` | `proj-free-cash` `active`, priority 1, tags `["revenue","free_cash","p1"]` | project exists |
| V21 | `read_file monitoring/freecash/run_daily_check.py:307-309` | `source_kind = resolve_source(args.source)` … `day = gate.day_key(now)` … `acquired, lock = gate.acquire_day_lock(day)` — **lock acquired before the source is resolved/read** | **F-1: the day is spent before anything is read** |
| V22 | `grep gate.py` | `acquire_day_lock` uses `os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)` (line 128); `day_key` uses `ZoneInfo` (line 96); `missed_days` line 208 | the R1 mechanism genuinely **exists — in `gate.py`, not in the file the gate verifies** |
| V23 | `sha256sum` of all real-root state files **before** and **after** a suite run | byte-identical (`diff` empty) | **the offline suite is hermetic w.r.t. the real root** (measured, not asserted) |
| V24 | `grep -nE "smtp\|email\|webhook" monitoring/freecash/notify.py` | one hit, a docstring: `SMTP opt-in and OFF by default; not wired to any credential here`; implemented transports are `_stub_send` and `_toast_send` only | delivery = Windows toast, or nothing |
| V25 | `ls` legacy paths | `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `finance-monitor/`, `config/freecash-crontab` all still on disk | disable-and-label policy holds; nothing was deleted |

**Reading.** Offline gates green (R2 twice, 52 tests twice), **acceptance gate red (R1)**, unattended operation never achieved (V6), no operator reading ever entered (V12), no approval item ever created (V13), and today's day is still unconsumed (V10) so nothing has been permanently burnt yet. The reason not to register a task today is **F-1**, not the gate verdict alone.

---

## 1. Operational constraints (binding — every stage is checked against these)

| ID | Constraint | Enforcement mechanism | Proof demanded at each stage |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` (`O_CREAT\|O_EXCL`) + 23:50 watchdog as a second detector | 2 runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY` |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py::request` deny-by-default (`GET,HEAD`, loopback allowlist, no body) + 2 static scanners | both scanners exit 0 at `exempt=28`; a POST probe still exits 1 |
| **R3** | notify on status/earnings change, exactly once | `changedetect.py::compare` on integer cents; `dedupe_key` recorded **before** dispatch | seeded change → exactly one payload; no-change day → no dispatch |
| **R4** | human approval before ANY external action; no execution path exists | `approval_queue.py`: `expires_at_utc` null, `execution_state` always `NOT_EXECUTED`, decisions need a human `--by` | 90-day clock advance changes nothing; a tokenless write raises before any socket call |
| **C5** | evidence = live tool output, never carried over | each stage ends with a re-executed command quoted verbatim | command + output in the stage's evidence block |
| **C6** | no secrets in code, state, logs, reports | env / Hermes vault only; `[REDACTED]` elsewhere | log/state grep shows no secret-shaped token |
| **C7** | never disturb unrelated uncommitted work; no destructive git | additive edits; `git status` before/after; no `reset`/`clean`/`checkout --`/`stash` | tracked-path status identical except the intended file |
| **C8** | one executable path per job — no new parallel implementation | extend before create; legacy runners disabled, never deleted | the stage names the file it extends |
| **C9** | acceptance gate green **before** any Task Scheduler registration | `scripts/monitoring/rule_gate_verify.py` exit 0 | `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS`, exit 0 |
| **C10** | interpreter of record is the venv Python 3.11.9 | `py -3` (3.14.7) lacks `tzdata` → `ZoneInfoNotFoundError` → R1 day-key failure | the task action names `…/hermes-agent/venv/Scripts/python.exe` |
| **C11 (NEW — budget ordering)** | a run may not spend the day before a reading exists to compare | `run_daily_check.py:307-309` acquires the lock before resolving the source (V21); `--force-recheck` is refused by design | no day lock may be created on a day that has no reading — proven by running the guarded path on a day with an empty `records` list and observing the lock file absent afterwards |
| **C12 (NEW — port correction)** | the AgenticOS backend serves **:4600**, not :3001 | `curl localhost:4600/api/health` → 200 (V14); `:3001` refused (V15) | any health claim names the port it measured |
| **C13 (NEW — environment pinning)** | a scheduled run must not inherit ambient `FREECASH_*` | wrapper sets `FREECASH_DATA_ROOT`, `FREECASH_TZ`, `FREECASH_READ_SOURCE`, clears `FREECASH_TOAST_STUB`; `schtasks /TR` cannot set env | the task's action is a `.cmd` wrapper, and the wrapper's values are read back before registration |
| **C14 (NEW — single writer)** | `alerts/alerts.jsonl` is the canonical evidence record and must have exactly one writer per day | see **F-6**: an unattributed writer appended at `2026-09-21T16:39:42Z` | a writer-tag (pid + entry-point) in each new line, or a documented operating window in which no other process may run the entry point |
| **C15 (NEW — gate scope)** | the acceptance gate cannot emit `COMPLIANT` for this package in its present form | `GATE-FALSIFICATION.md` §2: a 17-file sweep gives `R1=FAIL` for **every** file, while an inline-atomic control gives `COMPLIANT` + exit 0 | the chosen remedy (§2 S-1 option) is recorded in writing before C9 is claimed |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**S-0 — Re-confirm the offline gates (no change).**
Expected Effort: 0.3 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: re-run V1–V3 and quote all three outputs plus the real-root hash check (V23) in the same block.
Exit: `tests=52 failures=0`, `forbidden=0 exempt=28` from both scanners, real-root hashes unchanged.
Status: **already observed twice in this pass (V1–V3, V23).**

**S-1 — Settle the acceptance gate (C9/C15). Pick ONE remedy, in writing, before registering anything.**
Expected Effort: option-dependent (§2.1). Time-to-Revenue: none (prerequisite). Dependencies: none.
First Concrete Action: record the chosen option and its rationale in `RULE-GATE-CHECKLIST.md` §Blocking pre-flight item 3, then execute it.
Exit: `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` **and** exit 0 quoted, **and** the mutation probe still exits 1 (a gate that cannot fail certifies nothing).

**S-2 — Make the scheduled path safe to run unattended (C11).** This is the gating decision for scheduling.
Expected Effort: option-dependent (§2.2). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: run the guarded path on a day whose `records` list is empty and show that **no lock file is created**.
Exit: `ls data/<scratch root>/state/day-locks/` is empty after such a run, while a day *with* a reading still produces exactly one lock, one snapshot and `SKIP_DUPLICATE_DAY` on a second run.

**S-3 — First real operator reading.**
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day, visibility only**. Dependencies: S-2.
First Concrete Action: the operator logs into their own dashboard and appends one record to `state/operator-state.json` (`day_key=2026-09-21`, four integer-cent figures, `entered_at_utc`), then runs the entry point and confirms `INITIAL_BASELINE`.
Exit: a day-1 baseline snapshot exists; a day-2 record with a changed figure produces exactly one payload and one approval item.
Limit: every snapshot from this source is `degraded: true` by construction — "no change" only proves the same numbers were typed twice.

**S-4 — Register Task A + Task B (only after S-1, S-2, S-3).**
Expected Effort: 1–2 h including the one-time elevation probe. Time-to-Revenue: none. Dependencies: **C9 green (S-1)**, S-2, S-3.
First Concrete Action: from a non-elevated shell, run the throwaway probe `schtasks /Create /TN "\ZZ-FreeCash-Elevation-Probe" /SC DAILY /MO 1 /ST 23:59 /TR "cmd.exe /c exit 0" /IT /RL LIMITED /F && schtasks /Delete /TN "\ZZ-FreeCash-Elevation-Probe" /F`, then — only if S-1/S-2/S-3 are green — `schtasks /Create /XML …FreeCash-Daily-Monitor.xml` and the watchdog XML.
Exit: `schtasks /Query /TN "\FreeCash-Daily-Monitor" /V /FO LIST` quoted, showing daily trigger, `LeastPrivilege`, `IgnoreNew`, `StartWhenAvailable`; a same-day second trigger yields `SKIP_DUPLICATE_DAY`.
Rejected on this host: `config/freecash-crontab` (no `crontab` in git-bash; targets the legacy `scripts/make_freecash_check.py`) and any `/RL HIGHEST` form.

**S-5 — Watchdog / missed-day detection.**
Expected Effort: 1 h. Time-to-Revenue: none. Dependencies: S-4.
First Concrete Action: register the 21:30 companion task; on a healthy day require `WATCHDOG_OK` with zero alarms, then delete only the day lock inside a **scratch** root and require exactly one `MISSED_DAY` with the ledger unchanged.
Exit: healthy day → 0 alarms; uncovered day → exactly 1 alarm (`coverage=NOTIFIED`, retry `DEDUPED`).
Status note: the machinery already behaves this way offline — V1's suite and `E2E-RULE-FLIGHT.md` §3 exercise it — but it **has never run on the real root from a real schedule**.

**S-6 — Delivery: prove the one sink, or accept the log as the sink.**
Expected Effort: 0.5 h (test) / 2–4 h (new sink, delivered externally). Time-to-Revenue: none. Dependencies: S-4.
First Concrete Action: with the operator at the desk and session unlocked, dispatch one real toast and record the delivery label (`TOAST_OK` vs `DELIVERY_FAILED`); then deliberately lock the session and repeat to see the bounded-failure path.
Exit: the label observed under both conditions is written into the runbook; the failure path leaves the full message in `alerts/alerts.jsonl` and a `MONITOR_DEGRADED` follow-up.
Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` key, no mail tooling (V7, V24). The toast is the only implemented sink.

**S-7 — Approval gate (R4) surfaced to the human.**
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S-3 (the queue is unreachable until a change is detected).
First Concrete Action: seed a change that enqueues one item; exercise the documented CLI decision path (`--by` required); confirm the decision lands in `approvals/decided.jsonl` while `execution_state` stays `NOT_EXECUTED`.
Exit: a pending item survives a 90-day clock advance unchanged; every decision is attributable to a named human; **no execution path exists to be found**.

**S-8 — Daily evidence bundle + drift baselines.**
Expected Effort: 1 h, then ~2 min/day. Time-to-Revenue: none. Dependencies: S-4–S-7.
First Concrete Action: archive, per day: run-log line, snapshot hash, both scanners' counts, alerts/approvals line counts, and the real-root hash set (V23 pattern) — pinning `exempt=28` as the eroding-R2 baseline.
Exit: ten consecutive daily bundles whose gate counts match a fresh gate run.

**S-9 — Attribute writers to the canonical log (C14 / F-6).**
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: none (can run in parallel with S-1).
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line, or — cheaper — define and document the operating window in which only the scheduled task may invoke the entry point, and check the log for lines outside it.
Exit: a new line's origin is identifiable from the line itself, and the next bundle proves no line appeared outside the window.

**S-10 — Revenue path (out of scope of the monitor, tracked so it is not silently dropped).**
The Free Cash *mission* is blocked independently of this routine: `bgtask-07a8154b0` `blocked`, `resumable=0`, last update 2026-09-19T18:05:18Z (V19), and the supervisor's own verdict (2026-09-20 pass) was "Shopify publication is not implemented". Re-dispatching it is a separate decision with a separate owner; this monitor never unblocks it.
Expected Effort: unknown (needs the lost-worker re-dispatch first). Time-to-Revenue: unknown. Dependencies: a human decision + the publication step existing. First Concrete Action: none until that decision is taken.

**Ordering discipline:** S-1 ∧ S-2 → S-3 → S-4 → S-5 → S-6 → S-7 → S-8 (+ S-9 in parallel, S-0 re-run after every change). One change between gate runs. No stage is complete on a claim — only on output produced in the current session. Never widen an allowlist and exempt a scanner hit in the same change.

### 2.1 Options for S-1 (gate)

**O-A — Repair the verifier's scope (recommended).**
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: extend `scripts/monitoring/rule_gate_verify.py` so R1's two failing checks accept the mechanism when it is present in the routine **package** (`gate.py::acquire_day_lock`), not only in the entry file.
Rationale: the mechanism genuinely exists (V22) and `acquisition` was proven atomic under a 2- and a 5-process race in `E2E-RULE-FLIGHT.md` §3.4 — the current verdict is a scope artifact, not a defect. Note this edits a **tracked** file (C7 allows it; verify `git diff --stat` shows only that file).

**O-B — Restructure so one file carries R1.**
Expected Effort: 3–5 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: none recommended; would move/duplicate the lock logic into `run_daily_check.py`.
Rejected unless O-A fails: it edits the routine to satisfy a verifier, adds a second copy of the R1 mechanism (C8 violation risk), and requires a fresh E2E flight.

**O-C — Declare C9 unsatisfiable and gate on the flight instead.**
Expected Effort: 0.2 h (documentation). Time-to-Revenue: none.
First Concrete Action: record that the acceptance gate is superseded by `E2E-RULE-FLIGHT.md` + `GATE-FALSIFICATION.md` + both R2 scanners.
Weakness: it removes an automatable gate and makes every future regression a manual read. Only acceptable if O-A is refused by the operator.

### 2.2 Options for S-2 (the day-budget trap, F-1)

**O-1 — Pre-flight guard in the wrapper (cheapest, R1 untouched).**
Expected Effort: ~1 h (one `.cmd` edit + a test). Time-to-Revenue: none. Dependencies: S-4's wrapper (already drafted, V8).
First Concrete Action: in `freecash-task-a.cmd`, before invoking the entry point, test that `state/operator-state.json` contains a record whose `day_key` equals today (git-bash `grep -q "\"day_key\": \"%TODAY%\""` or a tiny stdlib `--check-source` flag); exit 0 with a log line when absent.
Exit: a no-reading day leaves `day-locks/` empty; a reading day behaves as today.
Weakness: the guard lives outside the routine — honest label: **defence in depth, not an R1 change**. It must be paired with O-2 or documented as the only protection.

**O-2 — Two-phase lock inside the routine (durable).**
Expected Effort: 3–5 h (gate.py + run_daily_check.py + 4–6 new tests + a re-run of the E2E flight). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: write the failing test first — "a run on a day with no reading writes `MONITOR_DEGRADED` and leaves `day-locks/` empty" — then implement an *attempt* record that only becomes a consumed day on a successful read.
Exit: the strict R1 property still holds (verified by the existing race tests) **and** a data-less day is retryable later the same day.
Trade-off to state in the decision record: this deliberately weakens "one read per day" to "one *successful* read per day"; on a day where the source is reachable twice, a second read becomes legal. R2 is unaffected (reads are read-only).

**O-3 — Keep strict R1 and do not schedule until a real source exists.**
Expected Effort: 0 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: none. Consequence: unattended operation stays blocked indefinitely — the routine remains a manual, operator-driven check. This is the safe default already in force.

**O-4 — Source switch instead of a design change.** Make `--source metrics_http` viable by exposing today's four figures at `localhost:4600/api/v1/status/metrics`. Expected Effort: 4–8 h in the app; Time-to-Revenue: none; Dependencies: an app-side route decision; First Concrete Action: `curl -sS -o /dev/null -w 'code=%{http_code}\n' http://localhost:4600/api/v1/status/metrics` (expected today: **404** — the route does not exist). Note it does not fix F-1 by itself; it only makes the source non-empty.

---

## 3. Read-source options — the remaining real decision

**O4 — operator-entered figures (rank 1; available today, no network, no credential).**
Expected Effort: 0 h builder (implemented) + 0.5 h operator. Time-to-Revenue: **same day, visibility only**. Dependencies: S-2 guard; venv interpreter (C10); the operator's own personal login — no credential is ever handed to the routine.
First Concrete Action: append today's four figures (`records: []` today, V12 → genuinely the first reading) and run the entry point with `--source operator_state`; expect `INITIAL_BASELINE`.
Honest limit: `degraded: true` on every snapshot.

**O1 — loopback read-only metrics endpoint.**
Expected Effort: 3–5 h builder; 0.5 h operator. Time-to-Revenue: 1–2 days, and it reads workstation metrics, not the account. Dependencies: a process serving `GET /api/v1/status/metrics` — **none exists**; the app runs on **4600** (V14, C12), and the route is not implemented.
First Concrete Action: `curl -sS -o /dev/null -w 'code=%{http_code}\n' http://localhost:4600/api/v1/status/metrics`; only a JSON body justifies wiring `--source metrics_http`.
Caveat: `server/src/adapters/freecashMonitorAdapter.ts` is a stub returning `statusAlerts: []` / `externalConnected: false` unconditionally — it cannot carry an alert.

**O2 — a documented provider read-only `GET /accounts`-style contract.**
Expected Effort: 2–4 h builder **if** a KYC-complete account exists, else an onboarding project. Time-to-Revenue: 3 days–2 weeks. Dependencies: confirmed account ownership; a user-scoped token kept outside the repo (no `FREECASH_*`/`HG_CASH_*` key exists, V7); outbound HTTPS; an `ALLOWED_HOSTS`/`ALLOWED_PATHS` extension — itself an R2 change under the §2 ordering rule.
First Concrete Action: with the operator's own token exported in that shell only, `curl -sS -o /dev/null -w 'code=%{http_code}\n' -H "Authorization: Bearer ***" <documented endpoint>`; record the status code and field names, `[REDACTED]` for values.

**O3 — a payout-provider balance endpoint.**
Expected Effort: 4–8 h builder + a written rules decision. Time-to-Revenue: 1–4 weeks (activation queue), unbounded if refused. Dependencies: the payouts API being enabled; a token that is minted with a **POST**, which `readonly_client` refuses by construction — so either the token is minted out-of-band daily or **R2 must be amended in writing by the operator**.
First Concrete Action: probe the documented balance route unauthenticated and record the code (expectation: a refusal), then check the merchant dashboard for an enabled payouts key.

**O5 — direct live-account session automation.**
Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: provider identity + a documented authenticated read contract + a vault credential + a proven authenticated session.
First Concrete Action: none. Evidence against: `provider_credentials` = 0 (V18), no `FREECASH_*` key (V7), no session artefact.
Verdict: **BLOCKED** — keep off the critical path.

---

## 4. Blocked register (nothing here is planned as achievable today)

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | gate-scope decision (S-1) or operator override | `R1=FAIL`, exit 1 (V4); no file in the package can pass (C15) |
| Unattended scheduling | S-2 remedy | the lock is taken before the read (V21) — scheduling now burns each day permanently |
| Live provider/account status | provider identity + authenticated read contract + credential | `provider_credentials` = 0 (V18); no `FREECASH_*` key (V7) |
| Email / SMS / webhook notification | credentials or mail tooling | none configured (V7); `notify.py` implements only the toast (V24) |
| Any withdrawal/earning action | R4 human approval surface | must never execute unattended; no execution path exists by design |
| In-app (AgenticOS) scheduler as the 24/7 mechanism | the desktop app process staying alive | last tick `2026-09-19T18:05Z` (V17); 7.9 % non-completed history (V16); one schedule (`sched-cd341dac…`) has never fired |
| Revenue mission `bgtask-07a8154b0` | re-dispatch after a lost worker | `blocked`, `resumable=0` (V19) |
| Publication step (Shopify et al.) | implementation | supervisor's own result text: "Shopify publication is not implemented" |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | non-elevated host by policy; a throwaway probe (S-4) settles whether elevation is needed at all |
| Writer attribution on the canonical log | code change or an operating window | an unattributed append at `2026-09-21T16:39:42Z` (F-6) |

---

## 5. Findings that changed since V6

**F-1 — the day is spent before anything is read (V21).** `run_daily_check.py` acquires the R1 lock *before* it resolves and reads the source. Consequence: registering Task A today would take the 09:00 lock every morning, emit `MONITOR_DEGRADED`, and make a real reading impossible on every one of those days, because R1 refuses a second read and `--force-recheck` exits 3 by design. **This, not the gate verdict, is the reason not to schedule yet.** It is the same trap flagged in `DELEGATION-2026-09-20/DELIVERY-PLAN-OPTIONS.md` §3.4-B3.

**F-2 — the acceptance gate cannot pass for this package (C15).** A 17-file sweep in `GATE-FALSIFICATION.md` §2 returns `R1=FAIL` for **every** file — `run_daily_check.py` included — while an inline-atomic control file returns `COMPLIANT` / exit 0. The R1 mechanism exists and is atomic (V22); the verifier is single-file scoped. So `R1=FAIL` means "the verifier cannot see it", not "the property is absent". The honest resolution is a recorded decision (S-1), not a silent claim of compliance.

**F-3 — the app is running, on the wrong port (V14, V15).** V6's row V12 concluded "the app-side scheduler is dormant" from `curl :3001` → refused. The backend actually serves `localhost:4600` and answers 200 (`version 9.0.0`, `gitSha d14253df`, `isDirty true`, built `2026-09-21T16:37:05.992Z`). This does **not** make the in-app scheduler a valid 24/7 mechanism (it still stops when the app does, V16/V17) and it does **not** create a notification sink — it only corrects the premise.

**F-4 — the offline suite is hermetic, measured (V23).** Hash set of the real root before and after `run_all.py`: byte-identical. The suite's own `RUN_OK` / `WATCHDOG_MISSED_DAY` lines are temp-root runs (they carry the temp day keys and `RecordingSender` labels).

**F-5 — today's day is intact.** No `2026-09-21.lock` exists (V9, V10): the first real reading can still be taken today. Every execution performed in this pass went to a scratch/temp root or printed only.

**F-6 — an unattributed write to the canonical evidence record.** `alerts/alerts.jsonl` grew from 2 to 3 lines and `state/notified-keys.json` was rewritten, both at `2026-09-21T18:39:42–48` local, with `event_type=MISSED_DAY`, `dedupe_key=e049c636…`, `delivery=TOAST_OK`, and `observed.old_value=2026-09-20` / `new_value=MONITOR_DEGRADED` — i.e. a run that read the **real** `last-run.json` and used the **real** toast sender. The suite I ran at that time is hash-verified hermetic (V23), so the writer was not that suite. Most consistent explanation: a concurrent process/session invoking `watchdog.py` against the real root — exactly the class of interference recorded as B7 in `SCHEDULER-AND-DELIVERY.md` (an e2e harness injecting `FREECASH_*` into a shared shell). **Not resolved here; carried forward as C14 / S-9.** Consequence for the plan: the canonical evidence log is currently not single-writer, and one dedupe key for `2026-09-21` is now spent — a same-day `MISSED_DAY` alarm will not repeat.

---

## 6. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S-1 remedy: O-A (repair verifier scope) / O-B (restructure) / O-C (override C9) | operator | C9 stays red and no task may be registered |
| D-2 | S-2 remedy: O-1 (wrapper guard) / O-2 (two-phase lock) / O-3 (manual only) | operator | scheduling stays unsafe; the routine stays manual |
| D-3 | authoritative read source: O4 / O1 / O2 / O3 / O5 | operator | every snapshot stays `degraded: true` |
| D-4 | R2 amendment for a token-minting POST (O3 only) | operator, in writing | O3 stays unreachable by construction — the safe default |
| D-5 | notification sink: toast + read the log, or scope a real sink | operator | alerts stay in `alerts/alerts.jsonl` |
| D-6 | canonical state root: `data/freecash` (empty) or `data/freecash-monitor` (holds all real state) | operator | evidence keeps landing in two places |

---

## 7. Non-goals

No rewrite, move or deletion of the legacy monitors (`scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `finance-monitor/`, `config/freecash-crontab`) — disable and label, never delete (V25). No live financial write path. No compliance claim from a static grep or from any PASS quoted in an earlier session. No modification of the pre-existing uncommitted paths on `hermes-rescue-20260908`. No voice/Jarvis runtime path touched. **This routine produces visibility, not revenue** — no option in §3 has a revenue time-to-value; the money path is `bgtask-07a8154b0` (S-10).

---

## 8. Definition of done

1. `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` at exit 0, with the mutation probe still failing (S-1).
2. Both R2 scanners exit 0 at a pinned `exempt=28`, quoted in the same session (S-0).
3. A data-less day leaves no day lock (S-2, C11).
4. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S-3, S-4).
5. One real change detected end to end → one notification, one approval item, one human decision, `execution_state` unchanged (S-3, S-6, S-7).
6. Watchdog: healthy day silent; uncovered day exactly one alarm (S-5).
7. Every line in `alerts/alerts.jsonl` attributable to a known writer (S-9, C14).
8. No secrets in routine, state or reports (C6); no unrelated uncommitted path modified (C7).

# WORKFLOW-PLAN.md — Operational Workflow Plan, Free Cash daily status-monitoring routine

Delegation: `DELEGATION-2026-09-20-R2` · Author: delegated subagent · Written 2026-09-20 ~21:45 local (CEST, UTC+02:00)
Repository: `D:\AgenticOS`, branch `hermes-rescue-20260908` · Target system: Python package `monitoring/freecash/`
**Additive only.** This file is the only file created by this pass. No existing file was modified, moved, renamed or deleted. No git write command of any kind was run. No scheduled task was registered. The production entry point was never run against `data/freecash-monitor/`.

---

## 0. Authority, scope, and the numbering trap

**Rules, verbatim from the operator, using the operator's own numbers.** This document uses exactly these four labels and no others:

| Rule | Verbatim text | Enforced by (module) |
|---|---|---|
| **R1** | once-per-day check | `gate.py` (atomic day lock + ledger), `watchdog.py` (same-day second detector) |
| **R2** | zero automated earning actions | `readonly_client.py` (sole socket holder), `verify_readonly.py` + `verify-readonly.sh` (static gate) |
| **R3** | notify on earnings/status changes | `changedetect.py` (compare + dedupe key), `notify.py` (dispatch) |
| **R4** | human approval before any external action | `approval_queue.py` (queue + human-signature rule) |

**⚠ Numbering trap, and the correction it forces.** `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/DELIVERY-PLAN-OPTIONS.md` §1.1 asserts a "rule-numbering discrepancy" and, in its own table, prints the *task brief* as `R1 = no earning action` / `R2 = once per day`. **That inversion is not the brief this delegation runs under.** The operator's briefing text for this pass reads, in order: `R1 once-per-day check; R2 zero automated earning actions; R3 notify on earnings/status changes; R4 human approval before any external action` — which coincides with the repository's own headings in `DELEGATION-2026-09-20/RULE-GATES.md` §2 (`### R1 — exactly one status check per operator-local calendar day` → `### R2 — zero automated earning actions`, **CARRIED**, read by the earlier pass). **Consequence: `DELIVERY-PLAN-OPTIONS.md` §1.1's table is superseded for R2; anything in this delegation's sibling documents that maps "R1 = no earning" must be re-mapped before it is quoted as R1.** Every rule reference in this file is the operator's. Where a prior document used the inverted mapping, it is named explicitly.

**Scope.** This document designs the *operating* routine: who runs what, when, in what order, what appears on disk, what the human does with it, and which option to pick for scheduling on this host. It does not redesign the code and it does not claim the routine has ever produced a real reading.

**Evidence standard.** Every factual claim below is tagged:
- **OBSERVED** — command executed in this session, output quoted verbatim in §10 or inline;
- **CARRIED** — taken from a named artifact, marked as such, not re-executed here;
- **UNVERIFIED** — not run, not read, not claimed.

**No PASS is inherited.** The earlier pass's green gate is re-run from scratch in §10. Where a prior document reports a verifier that the tree does not contain, or a green gate that does not parse, that claim is not repeated: the two verifier entry points named in this document were `ls`-confirmed to exist before being cited.

---

## 1. Prior art — one line each: inherited, superseded

Read in this pass (headers + the specific sections cited). One line per document: what is carried forward, what this file replaces.

| Document | Inherited | Superseded / corrected here |
|---|---|---|
| `docs/free-cash-monitor-routine/WORKFLOW-PLAN-V4.md` | The **scheduling design** (`§5.1` daily task, `§5.2` watchdog task, `§5.4` interpreter pinning, `§5.5` 08:35 local rationale) and the **gap register G1–G13** framing. | Its G-register is reproduced only where re-verified this pass; `§5.1/§5.2` registration is explicitly **not executed** (no task may be registered in this pass). G3's tzdata claim is **refined with measured evidence** (§8). |
| `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/RULE-GATES.md` | The rule numbering (**R1 = once/day, R2 = no earning, R3 = notify, R4 = approval**) and the gate/negative-control pattern. | Its `§5 "what the routine must NEVER do"` list is folded into §6/§7 here with the three new findings from §3.3 layered on. |
| `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/WORKFLOW.md` | The operator-side daily ritual shape and the exit-code meaning table. | Its §7 options are re-ranked here with explicit Effort / Time-to-Revenue / Dependencies / First Concrete Action, and Option B/C of the earlier list are **not** available in this pass by constraint. |
| `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/DELIVERY-PLAN-OPTIONS.md` | The "eight implementations, one canonical" audit (§1.4/§1.5) and the "zero revenue by design" honest frame. | **§1.1's rule-numbering table is superseded** (§0 above). Its §1.5 caveat ("verified but baseline-only") is re-verified and carried as a **BLOCKER**, not a footnote. |
| `docs/free-cash-monitor-routine/OPERATIONS-WORKFLOW-PLAN.md` | The constraint register and the "each gate is an executed command, not a claim" principle. | Its option list is replaced by §7 — its Option D (consolidate duplicates) is upgraded from "nice to have" to a **quarantine action item**, because `config/freecash-crontab` is a live pointer to the one legacy script that contains a withdraw action (§9). |
| `docs/free-cash-monitor-routine/{RESEARCH-PLAN-V4.md, ROUTINE-DESIGN.md, IMPLEMENTATION-PLAN-V3.md, AUDIT-RULE-COMPLIANCE.md, RULE-GATE-CHECKLIST.md, verify-readonly.sh}` | `verify-readonly.sh` is a **live** gate and is re-run in §10. `RULE-DESIGN`/`ROUTINE-DESIGN 6.1` is the schema origin of the `REQUEST_PAYOUT` label. | Not re-litigated. No new claim is sourced from them. |
| `docs/free-cash-monitor-routine/WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` (cited in the brief as *repo-root*) | — | **Path correction:** this file does **not** exist at the repo root (`ls WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` → `No such file or directory`, **OBSERVED**). The only file of that name lives at `docs/free-cash-monitor-routine/WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` (19,891 bytes, mtime 2026-09-20 21:12). Any prior document citing it as a repo-root path is wrong about the path. |

**Not read in this pass, and therefore not relied on:** the R1 delegation's `RESEARCH-PLAN.md` (59 KB). Nothing in this file depends on it.

---

## 2. Verified state, 2026-09-20 ~21:45 local — every row re-executed in this session

| # | Claim | Status | Evidence (§10 command) |
|---|---|---|---|
| V1 | Branch is `hermes-rescue-20260908`; **528** modified/untracked entries pending | **OBSERVED** | C1 |
| V2 | Suite green: `tests=52 failures=0 errors=0 skipped=0`, exit 0 | **OBSERVED** | C2 |
| V3 | Python static gate green: `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit 0 | **OBSERVED** | C3 |
| V4 | Shell static gate green: same counts, `PASS`, exit 0 | **OBSERVED** | C4 |
| V5 | No scheduled task exists for this routine | **OBSERVED** | C5 |
| V6 | No `FREECASH_*`/`SMTP_*`/`WEBHOOK_*` env var on the host; `himalaya` absent from PATH and `~/.config/himalaya` absent | **OBSERVED** | C6 |
| V7 | `python` = 3.11.9 at the Hermes venv; **`python3` does not exist** (Store alias stub) | **OBSERVED** | C7 |
| V8 | `state/operator-state.json` → `"records": []`; no operator reading has ever been entered | **OBSERVED** | C8 |
| V9 | `alerts/alerts.jsonl` holds exactly 2 lines for 2026-09-20, both `severity=info`: `MONITOR_DEGRADED`, `SKIP_DUPLICATE_DAY` | **OBSERVED** | C8 |
| V10 | `state/last-run.json` → `last_attempt_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | **OBSERVED** | C8 |
| V11 | Live root contents: `snapshots/2026-09-20.json` (518 B), `state/day-locks/2026-09-20.lock` (0 B), `approvals/` **empty**, `logs/` **empty** | **OBSERVED** | C9 |
| V12 | The routine has never run on a timer (nothing scheduled + ledger populated by a single manual pass at 19:08Z) | **OBSERVED** | V5 + V10 |
| V13 | Legacy `.mjs` is unrunnable: `SyntaxError: Unexpected token ':'` at line 41 | **OBSERVED** | C10 |
| V14 | `config/freecash-crontab` exists and points at `scripts/make_freecash_check.py` via `/usr/bin/env python3` | **OBSERVED** | C11 |
| V15 | End-to-end 4-day simulation in a temp copy behaves exactly as the design says (§10 C12) | **OBSERVED** | C12 |
| V16 | `tzdata` **is** installed in the PATH-visible interpreter but **is not** in either standalone CPython on this host | **OBSERVED** | C13 |

**UNVERIFIED in this pass** (stated so it is not assumed): the toast channel's visual delivery; the `metrics_http` source end-to-end; any provider read contract; the R3/R4 path on a *real* operator reading (no reading has ever existed); retention/prune behaviour past 90 days; behaviour under two concurrently scheduled tasks.

---

## 3. Root-cause ledger — each known shape re-verified against current source, not copied

### 3.1 The five previously identified shapes

| # | Shape as previously reported | Verdict this pass | Evidence |
|---|---|---|---|
| (a) | `approval_queue.py` referenced an undefined action-label constant | **FIXED — refuted as a current defect** | `ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"` is defined at `approval_queue.py:52` with a `# readonly-exempt: design-schema label for a human decision; no code executes it` marker, and consumed at `:111` via `action.setdefault(...)`. Module imports and the suite runs, so the name resolves. |
| (b) | `run_daily_check.py` discarded `gate.record_attempt()`'s return and passed the stale ledger to `record_outcome()`, clobbering `last_attempt_day` to `None` | **FIXED — refuted as a current defect** | `run_daily_check.py:329` → `ledger = gate.record_attempt(day, now, ledger)`, preceded by an in-source comment at `:326-328` naming exactly this failure. Corroborated dynamically: after the C12 run the ledger reads `last_attempt_day = "2026-10-04"`, **not** `None`. |
| (c) | Missed-day severity contract (alert vs info) disputed between `watchdog.py` and its test | **FIXED — contract now consistent** | `notify.py:290` uses `severity=default_severity(change["change_type"])` (comment at `:286-289` says hard-coding `SEVERITY_NOTIFY` "silently downgraded every alarm routed through this path"); `_ALERT_EVENTS` at `notify.py:36` includes `MISSED_DAY`, so the watchdog alarm is `alert`. `tests/test_r5_smoke.py:116` asserts `missed[0]["severity"] == "alert"` — and that test is inside the 52/52 green run. |
| (d) | The R2 scanner flags its own negative-control assertion line; needs a documented exemption marker | **FIXED — refuted as a current defect** | `tests/test_r2_readonly.py:27` carries the marker inline: `INJECTED_VIOLATION = "requests.post(...)"  # readonly-exempt: negative-control payload for the checker (R2)`. The gate reports it under `EXEMPT`, and `forbidden=0`. |
| (e) | A test asserted the timezone name appears in a temp directory path | **FIXED — refuted as a current defect, and the fix is documented in-source** | `tests/test_r1_gate.py:34-40` carries a comment stating that a throwaway data root "can never contain a zone name, so asserting `Europe/Berlin` against it could only ever fail", and the test now pins `gate.timezone_report("Europe/Berlin")["configured"]` and that `kind ∈ {zoneinfo, system-local}` instead. |

**Conclusion for §3.1: none of the five is a live defect. All five are regressions to be guarded by §7 Option A, not repairs to schedule.** This is a change from the prior art's framing — do not budget repair effort for them. What *is* outstanding is operational (nothing is scheduled, nothing has ever run) plus the three items below.

### 3.2 Three findings this pass adds (not present in the prior art I read)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| **F1** | **A degraded day is invisible.** `MONITOR_DEGRADED` is in `_ALERT_EVENTS` (`notify.py:36`), i.e. the module's own table calls it an alarm — but the *specific* degraded emission for "no reading exists" hard-codes `severity=notify.SEVERITY_INFO` (`run_daily_check.py:408-415`) and dispatches nothing. Live proof: `alerts/alerts.jsonl` line 1 for 2026-09-20 → `MONITOR_DEGRADED`, `severity: "info"`, and the ledger still shows `last_success_day=2026-09-20`. | **High** | `notify.py:36`; `run_daily_check.py:405-415`; V9; and in C12, D3/D4 both ran `notifications=0` with `MONITOR_DEGRADED` at `severity=info`. |
| **F2** | **The watchdog is blind to degradation.** `MONITOR_DEGRADED ∈ gate.SUCCESS_OUTCOMES` (`gate.py:32-42`), so `watchdog.evaluate()` sets `covered = True` and prints `WATCHDOG_OK` on a day whose snapshot is entirely null. Measured: C12 D3 and D4 both returned `covered: True, alarm: False` with `last_outcome=MONITOR_DEGRADED`. **Combined with F1: if the operator simply stops typing readings, the routine reports success every day, logs at info, notifies nobody, and never alarms.** The seven-day `APPROVAL_PENDING` nag (`NAG_INTERVAL_DAYS = 7`) is the only recurring signal, and it nags about the *queue*, not about the missing reading. | **High** | `gate.py:32-42`; `watchdog.py:33`; C12 D3/D4 output. |
| **F3** | **An earnings change auto-proposes a money-movement label.** On a 1-cent earnings move the routine enqueued an item whose `proposed_action` is `{"action_type": "REQUEST_PAYOUT", "amount_cents": 1341, "destination": "OPERATOR_SPECIFIED - not stored by the routine", "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"}`, with `status= PENDING`, `execution_state= NOT_EXECUTED`, `execution_allowed_by_this_routine= false`, `decided_by= null`, `expires_at_utc= null`. This does **not** violate R2 (it is a label, not an action; nothing executes it) and `approval_queue.py:49-52` documents it as "a handle for a human decision, never an instruction this routine carries out". But it is a **payout-shaped draft created with zero human input, with `amount_cents` defaulted from the operator's own figures** — and it will read to a future maintainer as a pre-authorised instruction. | **Medium** | C12 `pending.json` dump, quoted verbatim in §10. |

**Recommended dispositions (design decisions, not code changes made in this pass):**
- **F1/F2** — the cheapest honest fix is a *documented* operator rule, not code: **a `MONITOR_DEGRADED` day counts as a missed reading for R3 purposes.** The watchdog's `covered` test is the wrong place to change blindly (its "a degraded read still consumed the day" reading is defensible under R1), so the plan makes it an explicit human-facing escalation (§6) and flags a code option in §7 Option A-2. If changed in code, the change must be: keep `last_success_day` semantics, add `deepest_missed_day` / a degradation streak counter, and add a negative control that a 3-day degradation streak raises one `MISSED_DAY` alarm — *do not* simply remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES`, because `run_all.py`'s two-month degradation loop and `test_r5_smoke` assert on the current behaviour.
- **F3** — the queue item should be enqueued with `proposed_action=None` (or `action_type="REVIEW_ONLY"`) and the `REQUEST_PAYOUT` label reserved for a human-authored proposal. Until then, the operator's standing instruction is: **treat every auto-created `proposed_action` as a placeholder, edit or reject it; never read it as approval.**

### 3.3 A fourth correction (path/claim hygiene)

| # | Correction | Evidence |
|---|---|---|
| **F4** | `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` is **not** at the repo root; it is at `docs/free-cash-monitor-routine/`. Also, prior art's blanket claim "tzdata is not installed here" is **true for the standalone interpreters and false for the PATH interpreter** — a material distinction the pinning rule depends on (§8). | §1 table note; C13. |

---

## 4. The daily operational workflow (target steady state)

### 4.1 The day at a glance

| Time (local, CEST) | Actor | Action | Artifact produced |
|---|---|---|---|
| ~08:30 | Operator (human) | Log into the FreeCash dashboard **in their own browser**, read 4 figures: account status, total earnings, current balance, pending amount | — |
| ~08:32 | Operator (human) | Append one record to `data/freecash-monitor/state/operator-state.json` → `records[]` with today's local `day_key`, integer cents, `entered_at_utc` | edited `operator-state.json` |
| ~08:35 | Scheduled task **or** manual command | `run_daily_check.py` — the single daily read window | `snapshots/<day>.json`, `state/day-locks/<day>.lock`, ledger update, zero or more alerts, zero or more queue items |
| ~08:36 | Operator | Read the one-line `RUN_OK …` / `SKIP_DUPLICATE_DAY …` output | `logs/run-<day>.log` (once a wrapper exists) |
| ~23:50 | Second scheduled task **or** manual command | `watchdog.py` — same-evening "did the check run?" detector | `alerts/alerts.jsonl` (only if uncovered), `state/notified-keys.json` |
| on change | Operator | `approval_queue.py list` → decide with `--by <human name>` | `approvals/pending.json`, `approvals/decided.json` |
| weekly (~5 min) | Operator | Review the queue, the last 7 alert lines, and the degradation streak | — |

**13.5 hours of headroom** between the 08:35 read and the 23:50 watchdog is deliberate (**CARRIED**, `WORKFLOW-PLAN-V4.md` §5.5): it leaves time for a manual re-run if the morning run fails at the socket, without ever producing a second read of the same day (R1 forbids that — see §4.3).

### 4.2 Routine-side sequence, in order — read from source

Every step below is a **read of the shipped code**, and every step is also exercised end-to-end in C12.

1. `paths.ensure_layout()` — create `state/`, `state/day-locks/`, `snapshots/`, `alerts/`, `approvals/`, `logs/` if absent.
2. **R1 — lock.** Atomic exclusive-create of `state/day-locks/<day>.lock`. A winner proceeds; a loser prints `SKIP_DUPLICATE_DAY <day>` and returns 0 **without reading anything and without writing a snapshot** (measured: C12 run 2, and the live 2026-09-20 evidence V9 line 2).
3. **R1 — ledger attempt, kept.** `ledger = gate.record_attempt(day, now, ledger)` (`:329`).
4. **Missed-day accounting.** Days between `last_attempt_day` and today are counted and reported — **reported, never back-filled**.
5. **R2 — read.** `source = operator_state` (default) → read `state/operator-state.json` only; **no socket is opened at all** for this source. The alternative `metrics_http` source is reachable only through `readonly_client.py`, the sole module permitted to import a socket library, behind a loopback-only allow-list and a body-carrying-GET refusal.
6. **R3 — compare before overwrite.** `changedetect.load_prior_snapshot(day)` runs **before** `save_snapshot`, so the prior day is the comparison base. `changedetect.compare()` classifies: baseline / no-change / earnings / status / balance / degraded.
7. **R3 — snapshot, immutably.** `save_snapshot` refuses to overwrite an existing same-day snapshot.
8. **R3 — notify, deduplicated.** Each change gets a `dedupe_key` built from `(day, change_type, field, old, new)`; `notified-keys.json` is written **before** dispatch, so at-most-once holds even if delivery fails. `MAX_NOTIFICATIONS = 5`; beyond that changes coalesce into one `MONITOR_DEGRADED` summary.
9. **R4 — enqueue only.** One approval item per notified change. `execution_state = "NOT_EXECUTED"`, `execution_allowed_by_this_routine = false`. **There is no execution code path in the package.**
10. **Nag.** Pending items older than `NAG_INTERVAL_DAYS = 7` produce one `APPROVAL_PENDING` reminder.
11. **Ledger outcome.** `gate.record_outcome(day, outcome, now, ledger, missed=len(missed))` — `last_success_*` advances only for `SUCCESS_OUTCOMES`.
12. **Maintenance.** `changedetect.prune_old_artifacts()`: snapshots **90** days, logs **30** days. Only runs when `now is None`, i.e. only in production, never in a clock-injected test.
13. **Print** the single audit line `RUN_OK <day> outcome=… source=… snapshot=… written=… changes=N notifications=N approvals=N reminders=N lock=…` and return the exit code.

### 4.3 Exit codes — the operator's only machine-readable signal

| Code | Meaning | Operator action |
|---|---|---|
| `0` | ran, *or* the day was already consumed (`SKIP_DUPLICATE_DAY`) | none; day is spent, wait for tomorrow |
| `2` | usage error | fix the invocation |
| `3` | `--force-recheck` refused — a second status read in one day is forbidden by R1 | **do not retry.** The refusal is written to `logs/forced-recheck-requests.jsonl`. Measured: C12. |
| `5` | the status read failed | the day lock **stays**, there is **no automatic re-run**, and `RUN_FAILED` is notified at `alert` severity. Under R1 the day is consumed by the failure. |

**Ordering rule that matters most (CARRIED, unchanged):** the human enters figures **before** the scheduled run. If the run fires first, the day is consumed as `MONITOR_DEGRADED`, and §4.2 step 2 means the figures entered later **cannot** produce a reading that day. R1 is absolute — and that is also exactly the F1/F2 blind spot.

### 4.4 The only write path outside the routine: the human decision

```
python monitoring/freecash/approval_queue.py list
python monitoring/freecash/approval_queue.py decide --id <uuid> --decision approve|reject \
       --by "<your real name>" --note "<why>"
```

`--by` must name a human. `NON_HUMAN_DECIDERS` (`approval_queue.py:55-57`) rejects `system|routine|automation|agent|cron|scheduler|monitor|bot|script|machine` with **exit code 4** (verified by `test_cli_refuses_a_machine_identity_with_exit_code_4`, inside the green 52). **`approve` records a decision. It does not execute anything**: the item keeps `execution_state = NOT_EXECUTED`, and an approval whose `expires_at_utc` has passed still executes nothing (`test_past_expiry_plus_approved_status_executes_nothing`). A pending item survives a 90-day clock advance unchanged.

---

## 5. Rule-by-rule control table

| Rule | Mechanism (file:symbol) | Positive evidence | Negative control | Residual gap |
|---|---|---|---|---|
| **R1** once-per-day | `gate.acquire_day_lock()` exclusive-create; `state/day-locks/<day>.lock` | C12: run 1 consumed the day, run 2 printed `SKIP_DUPLICATE_DAY 2026-09-20` **and wrote nothing** | `test_five_concurrent_runs_yield_one_winner` (5 processes → 1 winner, `skips==4`); `test_second_run_skips_with_no_side_effects` | Day is keyed to the interpreter's zone resolution (§8); a wrong interpreter silently re-keys the day. |
| **R2** zero automated earning actions | `readonly_client.py` sole socket holder; loopback-only; GET-only; no body; `verify_readonly.py` / `verify-readonly.sh` static token gate with per-line `readonly-exempt` markers | C3/C4 `forbidden=0 exempt=28 missing_targets=0` `PASS` | `test_missing_target_is_not_a_pass` (missing path → `FAIL`, "absence of evidence is not evidence"); `test_python_port_agrees_with_the_shell_checker` (planted violation → 4 `FORBIDDEN` hits, `FAIL`) | **Legacy duplication outside the scanned tree** (§9) — `config/freecash-crontab` targets the one legacy script that contains a withdraw action, and it is **not** inside `monitoring/freecash/`. |
| **R3** notify on earnings/status changes | `changedetect.compare()` + `dedupe_key()`; `notify.dispatch()` writes the key **before** sending; `notified-keys.json` | C12 D2: a 1-cent move (`1340 → 1341`) produced `EARNINGS_CHANGED changes=1 notifications=1 approvals=1` and exactly one `EARNINGS_CHANGED severity=notify` line | `test_same_key_is_never_notified_twice_and_the_key_includes_the_day`; `test_one_cent_is_a_change_because_cents_are_exact`; `test_no_change_day_is_log_only` | **F1: the "no reading" case notifies nobody and logs at info.** R3 has never been exercised on a real reading (V8). |
| **R4** human approval before any external action | `approval_queue.py`; `EXECUTION_ALLOWED_BY_THIS_ROUTINE = False`; `NON_HUMAN_DECIDERS`; `expires_at_utc` never enables execution | C12: the queue item carries `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=false`, `decided_by=null` | `test_no_module_treats_an_approved_status_as_a_trigger`; `test_only_the_readonly_client_may_reach_a_socket_library`; `test_a_machine_may_not_sign_a_decision` | No approved item has ever been produced from a real reading; and there is no *downstream* external action in the repo for an approval to gate — R4 is currently a freeze, not a gate on a live action. **F3** is the labelling hazard. |

---

## 6. Failure and degradation matrix — what the operator is told, and what they must do

| Condition | Outcome / signal | Severity | Notified? | Watchdog says | Operator action |
|---|---|---|---|---|---|
| First run with a reading, no prior | `INITIAL_BASELINE` | info | no (silent baseline by design) | `WATCHDOG_OK` | none |
| No change vs prior day | `OK_NO_CHANGE` | info | no | `WATCHDOG_OK` | none |
| Earnings / status / balance moved | `EARNINGS_CHANGED` / `STATUS_CHANGED` / `BALANCE_CHANGED` | **notify** | **yes**, once, dedupe-keyed | `WATCHDOG_OK` | read the message; review the queue item (§4.4) |
| **No operator record for today** | `MONITOR_DEGRADED`, snapshot written with **all-null fields**, nothing compared | **info** ← **F1** | **no** ← **F1** | **`WATCHDOG_OK`, `covered: True`** ← **F2** | **the reading is missing — enter it today or accept a hole; nothing will tell you** |
| Notification delivery fails | `DELIVERY_FAILED` (cap 2 tries), then a second `MONITOR_DEGRADED` alert | **alert** | n/a (channel is broken) | — | **read `alerts/alerts.jsonl` by hand until the channel is fixed** |
| Status read fails | `READ_FAILED`, exit 5; day lock stays; no auto re-run | **alert** | yes | `WATCHDOG_OK` (day consumed) | do **not** re-run today; wait for tomorrow |
| A day had no run at all | `MISSED_DAY` (at the next run, and from the watchdog the same evening; one alarm per day) | **alert** | **yes** | `WATCHDOG_MISSED_DAY … coverage=NOTIFIED/DEDUPED` | run the check today; yesterday can never be back-filled |
| Timezone changed since last run | `MONITOR_DEGRADED` — "day-key boundaries may show a gap or an extra day" | **alert** | yes | — | re-confirm the intended zone; expect a gap or an extra day in the key sequence |
| Configured zone unresolvable on this host | `WARNING timezone_unavailable …`, alert "Install the tzdata package", routine falls back to machine-local | **info** | no | — | **§8** — pin the interpreter, or accept machine-local day keys |
| > 5 changes in one day | changes coalesce into one `MONITOR_DEGRADED` summary | default | yes (one) | — | read the summary, then the log |
| Corrupt / unreadable state JSON | `paths.read_json` returns the default, `gate.load_ledger` fills missing keys, **never raises** | — | — | may report `ledger_missing: true` | inspect the file before trusting the ledger |

**Standing escalation rule this plan adds (F1/F2):** *two consecutive `MONITOR_DEGRADED` days are treated by the operator as a MISSED_DAY-class event*, even though the program will not say so. Evidence available to the operator for that check: `snapshots/<day>.json` with null fields, `alerts.jsonl` `MONITOR_DEGRADED` at `severity=info`, `ledger.last_success_day`.

---

## 7. Options — scheduling and hardening, with honest effort figures

**Effort figures are estimates** (small ~1–2 h, medium ~0.5–1 day, large >1 day of operator/session time). **Time-to-Revenue is `zero — by design`** for every option: R2 forbids automated earning, so this routine can never produce revenue. The recoverable value is *engineering time* and *compliance risk avoided*; it is named per option. **Dependencies** are hard preconditions.

### Option A — Manual daily ritual (the recommended starting point **and** the only correct option in this pass)

| Field | Value |
|---|---|
| What | Human reads 4 figures in their own browser → appends one record → runs `python monitoring/freecash/run_daily_check.py` → runs `python monitoring/freecash/watchdog.py` before bed → weekly queue review. |
| Expected Effort | **~3 min/day** + ~5 min/week. Setup: **zero** (nothing to install, nothing to register). |
| Time-to-Revenue | **Zero — by design.** Recovered: the entire planning cost of the other options, and the ban/ToS risk of automating a login to a money account. |
| Dependencies | `python` = the pinned interpreter (§8); the operator must actually be at the machine, or the day is degraded (F1). |
| First Concrete Action | Run `python monitoring/freecash/tests/run_all.py` (expect `tests=52 failures=0 errors=0 skipped=0`) and then enter **one** real reading and run the check, so that `operator-state.json` stops being `records: []`. Nothing else in this document is meaningful until that happens. |
| Why it wins | It exercises R3 and R4 on real input for the first time, and it is the only option with **zero new failure surface**. |

**Option A-2 (same option, hardening sub-step, still no scheduling):** add the F1/F2 degradation escalation. Estimated **small (~1–2 h)**, plus a new negative control (a 3-day degradation streak → exactly one `MISSED_DAY` alarm) and confirmation that `run_all.py`'s two-month degradation loop and `test_r5_smoke` still pass. Dependencies: agreement that "degraded 2 days in a row = alarm" is the wanted contract. First Concrete Action: write the failing test first, then change `watchdog.evaluate()`.

### Option B — Windows Task Scheduler, daily at a fixed local time

| Field | Value |
|---|---|
| What | Task A at ~08:35 (`run_daily_check.py`), Task B at ~23:50 (`watchdog.py`), both with the interpreter pinned by absolute path. |
| Expected Effort | **small (~1–2 h)**, dominated by the negative tests (register → prove one day consumed → prove the watchdog alarms on an uncovered day → unregister). |
| Time-to-Revenue | **Zero — by design.** Recovered: the operator's daily 3 minutes, *at the cost of* F1: an unattended run without a record degrades silently. |
| Dependencies | **BLOCKED in this pass** — no scheduled task may be registered. Also needs: the pinned interpreter (§8); a decision on whether the task runs `python` resolved via PATH or by absolute path (**must be absolute**); the reading entered *before* 08:35; and, to be honest, resolving F1 first or the task will report success on an empty reading forever. |
| First Concrete Action | Do **not** register. Instead: dry-run the exact command line in a temp root (C12 pattern) and record the observed output as the expected log line. Registration is a separate, explicitly authorised pass. |
| Rejected variant | `config/freecash-crontab` (`0 5 * * * /usr/bin/env python3 …/scripts/make_freecash_check.py`) — **three independent reasons it must never be used**: `python3` does not exist on this host (V7); `/usr/bin/env` and `>>` redirection are not a Windows Task Scheduler contract; and its target is the legacy script that contains a withdraw action (§9). It is documentation of an abandoned design, not a schedule. |

### Option C — Windows Task Scheduler at logon (missed-day-tolerant)

| Field | Value |
|---|---|
| What | Same two programs, triggered at logon/unlock rather than a fixed clock time, so a machine that was asleep at 08:35 still gets its run when the operator starts working. |
| Expected Effort | **small (~1–2 h)** — same as B, plus trigger semantics to verify. |
| Time-to-Revenue | **Zero — by design.** |
| Dependencies | **BLOCKED in this pass** (no registration). Plus: at-logon runs may fire repeatedly across a day — safe only because R1's lock makes repeats no-ops, which must be **proved** on the target host, not assumed. |
| First Concrete Action | Prove the duplicate is free: register nothing, but reproduce two consecutive runs in a temp root (C12 run 1 + run 2: `SKIP_DUPLICATE_DAY`, exit 0, no second snapshot) and archive that output as the acceptance evidence. |

### Option D — Diagnose and quarantine the duplicated implementations

| Field | Value |
|---|---|
| What | Make `monitoring/freecash/` the only runnable path: neutralise `config/freecash-crontab`'s pointer to the withdraw-containing legacy script, and stop the eight competing implementations from looking executable. **Delete nothing** (constraint: additive only). |
| Expected Effort | **small (~1–2 h)** for the crontab pointer (a comment/edit outside this pass); **medium (~0.5–1 day)** for a README-style quarantine index over the eight implementations. |
| Time-to-Revenue | **Zero — by design.** Recovered: the ~2,275 dead LOC that a future maintainer must otherwise re-audit (CARRIED, `DELIVERY-PLAN-OPTIONS.md` §1.4). |
| Dependencies | Editing `config/freecash-crontab` is a **modification of an existing file** — forbidden in this pass. Requires a separate authorisation. |
| First Concrete Action | Re-run the C10 probe (`node server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'`) and store the raw output next to the crontab's path claim as the anti-drift evidence. |

### Option E — Hermes cron job

Offered only for completeness: it would be a second scheduler with no Windows integration, and the pass constraint forbids registering it. **Expected Effort small; Time-to-Revenue zero — by design; Dependencies: a decision about which scheduler is authoritative; First Concrete Action: none until B/C is decided** — running two schedulers would make the R1 lock the sole guard against a double read, which is a bad place to be by accident.

---

## 8. Interpreter pinning and the tzdata caveat — measured, not assumed

This is the one configuration detail that can turn a green routine into a silent R1 deviation.

| Interpreter | Path | Version | `ZoneInfo('Europe/Berlin')` | `tzdata` installed? |
|---|---|---|---|---|
| **Pinned (recommended)** | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (= `which python`) | 3.11.9 | **OK** | **True** |
| Standalone | `C:\Users\cd-pr\AppData\Local\Programs\Python\Python311\python.exe` | 3.11.9 | `ZoneInfoNotFoundError` | False |
| Standalone | `C:\Python314\python.exe` | 3.14.7 | `ZoneInfoNotFoundError` | False |

**Observed consequence.** With the pinned interpreter, `gate.timezone_report("Europe/Berlin")` returns `{'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}`. With a standalone interpreter the same call resolves `kind = "system-local"`, prints `WARNING timezone_unavailable …`, and appends a `MONITOR_DEGRADED` **info** alert telling the operator to install `tzdata`. The machine's own zone is `W. Europe Standard Time`, currently `+0200` — i.e. **today the two paths agree on the day key**, so the difference is currently invisible on this host:

| Scenario | Pinned interpreter | Standalone interpreter |
|---|---|---|
| `FREECASH_TZ=Europe/Berlin` (default) | day key = Berlin | day key = machine-local (**same today**) |
| `FREECASH_TZ=America/New_York` | day key = New York | **day key = Berlin — the configured zone is silently ignored** |
| Provenance | `kind=zoneinfo` | `kind=system-local` + a recurring info alert |

**Rule for this routine:** *the interpreter is part of the contract.* Every invocation — manual now, scheduled later — must be the absolute path to the pinned interpreter, and the pinned venv must keep `tzdata`. Corollary: **`python3` does not exist on this host** (V7), so no document, shortcut, or cron line may use it.

*Correction to prior art:* `WORKFLOW-PLAN-V4.md` G3 and the earlier briefs state that `tzdata` is not installed here. That is **true of both standalone interpreters and false of the PATH interpreter** (C13). The risk is real but it is a *pinning* risk, not an unconditional one — and the failure mode is `system-local` fallback plus a warning, **not** a crash. This distinction matters because a routine that crashes gets noticed, and this one does not.

---

## 9. Duplication risk — eight implementations, one target (none of these is the routine)

| # | Path | State observed this pass | Risk to the operating routine |
|---|---|---|---|
| 1 | **`monitoring/freecash/`** | 52/52 green, static gate `PASS`, 11 files | **This is the target.** |
| 2 | `server/scripts/freecash-daily-monitor.mjs` | **OBSERVED** `SyntaxError: Unexpected token ':'` at line 41 (`function isDailyCheckAllowed(): boolean`) — a `.mjs` carrying TypeScript annotations, plus `require()` | Looks executable; dies on invocation. Any doc that names it as the routine is wrong. |
| 3 | `scripts/monitoring/free-cash-daily-check.py` | exists, 11,024 B | no entrypoint contract |
| 4 | `server/tasks/daily-finance-monitor.py` | exists, 13,434 B | own day-guard, empty store — a second `day_lock` is the R1 hazard |
| 5 | `finance-monitor/` | package present | own rule engine |
| 6 | `scripts/make_freecash_check.py` | **CARRIED** (`DELIVERY-PLAN-OPTIONS.md` §1.4 item 6): "compiles, contains a withdraw action" | **highest** — it is the target of `config/freecash-crontab` (V14), i.e. a live pointer to an R2-violating script |
| 7 | `scripts/finance_monitor.py`, `server/src/adapters/freecashMonitorAdapter.ts` | **CARRIED** — crashes on run / hardcoded chat stub | misleading surfaces |
| 8 | `scripts/finance_monitor.py` and remaining siblings | **CARRIED** | count: 8 competing monitor entrypoints |

**Rule:** this document's routine is `monitoring/freecash/` and nothing else. Items 2–8 are **duplication risk**, cited only as hazards. Quarantining them is Option D and requires a modification authority this pass does not have.

---

## 10. Acceptance evidence — commands executed in this session, with observed results

All commands were run from `D:\AgenticOS` unless noted. Verbatim results, trimmed to the decision-relevant lines.

**C1 — branch and pending work**
```
$ git branch --show-current
hermes-rescue-20260908
$ git status --porcelain | wc -l
528
```

**C2 — the suite (the only working entry point)**
```
$ python monitoring/freecash/tests/run_all.py
...
Ran 52 tests in 12.026s

OK
run_all: tests=52 failures=0 errors=0 skipped=0
EXIT=0
```
`python -m unittest discover` is **not** usable here (`Start directory is not importable`, carried from the brief and consistent with `run_all.py` being a bespoke driver).

**C3 — Python static gate (R2)**
```
$ python monitoring/freecash/verify_readonly.py
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
EXIT_PYVERIFY=0
```

**C4 — shipped shell gate (R2), the one cited by `RULE-GATES.md`**
```
$ bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash
  EXEMPT   [account-mutation] monitoring/freecash/verify_readonly.py:84: ... # readonly-exempt: scanner pattern table
[verify-readonly] forbidden=0 exempt=28 missing_targets=0
[verify-readonly] PASS — no unexempted write/earning token found.
EXIT_SHELL=0
```
Both gates were `ls`-confirmed to exist before being run: `verify_readonly.py` (7,856 B), `verify-readonly.sh` (3,443 B, mode `-rwxr-xr-x`).

**C5 — no scheduled task**
```
$ schtasks /query /tn "FreeCash"
FEHLER: Das System kann die angegebene Datei nicht finden.
$ schtasks /query /fo CSV | wc -l
385
$ schtasks /query /fo CSV | grep -i -E "freecash|free.cash|finance|monitor"
"\Microsoft\Office\Office ClickToRun Service Monitor",...
"\Microsoft\Windows\Hotpatch\Monitoring",...
   (only OS tasks — no routine task exists)
```

**C6 — notification sinks blocked**
```
$ env | grep -E "^(FREECASH|SMTP|WEBHOOK)"
(no output)
$ which himalaya
which: no himalaya in (...)
$ ls -d ~/.config/himalaya
ls: cannot access '/c/Users/cd-pr/.config/himalaya': No such file or directory
```

**C7 — interpreter**
```
$ python -V
Python 3.11.9
$ which python
/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python
$ python3 -V
Python wurde nicht gefunden; ohne Argumente ausführen, um aus dem Microsoft Store zu installieren, ...
```

**C8 — live state (read-only; the production entry point was NOT run)**
```
$ python -c "import json;print(json.load(open('data/freecash-monitor/state/operator-state.json'))['records'])"
[]
$ last-run.json
{ "last_attempt_day": "2026-09-20", "last_success_day": "2026-09-20",
  "last_attempt_at_utc": "2026-09-20T19:08:00Z", "last_outcome": "MONITOR_DEGRADED",
  "consecutive_missed_days": 0, "timezone": "Europe/Berlin", ... }
$ alerts.jsonl  (2 lines)
1 MONITOR_DEGRADED      severity=info
2 SKIP_DUPLICATE_DAY    severity=info
```

**C9 — live root inventory**
```
data/freecash-monitor/approvals/            (empty)
data/freecash-monitor/logs/                 (empty)
data/freecash-monitor/snapshots/2026-09-20.json      518 B
data/freecash-monitor/state/day-locks/2026-09-20.lock  0 B
```

**C10 — legacy `.mjs` is unrunnable**
```
$ node server/scripts/freecash-daily-monitor.mjs
file:///D:/AgenticOS/server/scripts/freecash-daily-monitor.mjs:41
function isDailyCheckAllowed(): boolean {
                              ^
SyntaxError: Unexpected token ':'
```

**C11 — the crontab still points at the withdraw-containing legacy script**
```
$ ls -la config/freecash-crontab
-rw-r--r-- 1 cd-pr 197609 578 Sep 11 10:12 config/freecash-crontab
config/freecash-crontab:7:0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py >> ...
```

**C12 — end-to-end acceptance run in a temp copy (`$LOCALAPPDATA/Temp/fc-r2-accept-<pid>`, live state root never touched)**
```
# Day 1, reading present, first ever run
RUN_OK 2026-09-20 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) \
  snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock
EXIT_DAY1=0
# Day 1, second run — duplicate
SKIP_DUPLICATE_DAY 2026-09-20
EXIT_DUP=0
# Watchdog
WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=INITIAL_BASELINE
# --print-state (read-only)
ledger: ...\state\last-run.json
  last_attempt_day 2026-09-20 | last_outcome INITIAL_BASELINE | timezone Europe/Berlin
pending items: 0
# --force-recheck (refused by design)
REFUSED_FORCE_RECHECK 2026-09-20 reason='test' (a second status read in one day is forbidden by R1; \
  the request was recorded in logs/forced-recheck-requests.jsonl)
EXIT_FRC=3
```
Then a 4-day clock-injected drive (`run_daily_check.run([], now=…)`, `now` injected in-process — the only clock seam; there is no env-var clock):
```
tz_report: {'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}
D1 2026-10-01 INITIAL_BASELINE  changes=0 notifications=0  notifications_sent=0
D2 2026-10-02 EARNINGS_CHANGED  changes=1 notifications=1 approvals=1  notifications_sent=1   (1340 -> 1341 cents)
D3 2026-10-03 MONITOR_DEGRADED  (no record) notifications=0  watchdog: covered=True alarm=False   <-- F1/F2
D4 2026-10-04 MONITOR_DEGRADED  (no record) notifications=0  watchdog: covered=True alarm=False   <-- F1/F2
ledger: last_attempt_day=2026-10-04 last_outcome=MONITOR_DEGRADED   (last_attempt_day is NOT None)
alerts: 2026-10-01 INITIAL_BASELINE info | 2026-10-02 APPROVAL_PENDING notify | 2026-10-02 EARNINGS_CHANGED notify
        2026-10-03 MONITOR_DEGRADED info | 2026-10-04 MONITOR_DEGRADED info
approvals/pending.json (1 item, verbatim):
 { "approval_id": "de49e03c-...", "day_key": "2026-10-02",
   "reason": "earnings_total_cents moved from $13.40 to $13.41. Review and decide whether any action is wanted.",
   "proposed_action": { "action_type": "REQUEST_PAYOUT", "amount_cents": 1341,
                        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
                        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase" },
   "status": "PENDING", "decided_by": null, "expires_at_utc": null,
   "execution_state": "NOT_EXECUTED", "execution_allowed_by_this_routine": false }
```
This is the first time in this session that the routine has produced a notification and a queue item from a real comparison. It confirms R3 and R4 **mechanically**, on **synthetic** input, in a **temp** root. It does not confirm the provider path, and it does not substitute for the first real reading.

**C13 — interpreter/tzdata matrix**
```
$ C:/Users/cd-pr/AppData/Local/Programs/Python/Python311/python.exe -c "..."
ver 3.11.9 | ZONEINFO_FAIL ZoneInfoNotFoundError | tzdata= False
$ C:/Python314/python.exe -c "..."
ver 3.14.7 | ZONEINFO_FAIL ZoneInfoNotFoundError | tzdata= False
$ C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe -c "..."
ver 3.11.9 | ZONEINFO_OK | tzdata= True
$ powershell.exe -NoProfile -Command "(Get-TimeZone).Id"
W. Europe Standard Time          # offset +0200 == Europe/Berlin today
```

---

## 11. Rollback / disengagement — returning the machine to "monitoring off"

Nothing in this design has been enabled, so rollback is currently a no-op. The procedure, for the day Option B/C is authorised:

1. Unregister the task(s): `schtasks /delete /tn "<name>" /f` (elevated). **Not executed in this pass.**
2. Leave the state tree in place. It is the evidence; deleting it destroys the only record that the routine ran.
3. To stop the routine without deleting history: leave `state/operator-state.json` untouched and simply stop entering readings. **The system will not complain (F1/F2) — the ledger will report a green, degraded, silent succession of days. Count on your own calendar, not on the alerts.**
4. To un-consume a day (a mistaken run): **there is deliberately no supported path.** Removing `state/day-locks/<day>.lock` manually re-opens the day to a second read, which is precisely what R1 forbids. If it is ever done, it must be recorded as an explicit human exception.

---

## 12. BLOCKED, UNVERIFIED, and not claimed

**BLOCKED — precise reasons**
1. **Scheduling (Options B, C, E).** No scheduled task may be registered in this pass. Registration also needs a decision about the interpreter path and, honestly, F1 resolved first.
2. **First real reading.** `operator-state.json` → `records: []` (V8). R3 and R4 have never processed real input, and the seven-day nag, the change taxonomy, and delivery have therefore never fired on real data. **Only the operator can unblock this** — it requires them to log into their own account and type four numbers (§4.1). This is the single highest-value action in the document.
3. **Credentials / provider contract.** No `FREECASH_*`/`SMTP_*`/`WEBHOOK_*` variables (V6), `himalaya` not installed (V6), and the provider read contract is `PROVIDER_ENDPOINT_UNKNOWN`. Every external notification and every provider read is therefore untestable here.
4. **Quarantining the legacy siblings (Option D).** Requires modifying `config/freecash-crontab`, forbidden by this pass's additive-only constraint.
5. **Deleting the 2,275 dead LOC.** Destructive; not authorised.

**UNVERIFIED** — the toast channel's visual delivery; `metrics_http` end-to-end; retention at 90/30 days; two-task concurrency on this host; the `RUN_FAILED` exit-5 path end-to-end (read from source, not exercised); the F1/F2 code fix (proposed, not written).

**Not claimed:** that the routine has ever produced a real reading; that any gate is green because an earlier pass said so (both gates were re-run here — C2/C3/C4); that `data/freecash-monitor/state/last-run.json`'s 2026-09-20 entry is a *real* monitoring day (it records `MONITOR_DEGRADED` on an empty `records[]`, i.e. exactly the F1 condition); and that any option produces revenue — **none does, by design.**

---

## 13. Change control for this document

- **Additive only, verified:** this pass created this file and nothing else. The temp-copy acceptance run wrote only under `$LOCALAPPDATA/Temp/`. The production entry point was **not** run against `data/freecash-monitor/` — every claim about the live root (§2) is a **read**.
- **Revision pin:** every claim is tied to the tree as of branch `hermes-rescue-20260908`, `monitoring/freecash/` mtimes 2026-09-18 07:25–07:32 and 2026-09-20 06:57–06:59, read 2026-09-20 ~21:45 local. The repository carries 528 uncommitted entries (V1) and a sibling scratch directory (`DELEGATION-2026-09-20/scratch/`, mtime 21:38) was being written *during* this pass — so **the tree is moving**. Re-run C2/C3/C4 before quoting any of this.
- **Supersession:** this file supersedes `DELIVERY-PLAN-OPTIONS.md` §1.1 (rule numbering) and refines `WORKFLOW-PLAN-V4.md` G3 (tzdata). It does not supersede `RULE-GATES.md` (numbering source) or `verify-readonly.sh` (live gate).

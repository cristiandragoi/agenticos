# Free Cash Finance Automation — Workflow Plan (grounded, 2026-09-20)

Repository: `D:\AgenticOS`
Branch: `hermes-rescue-20260908` (large body of pre-existing uncommitted work present)
Additive only: this file is new. No existing file was modified, moved, deleted or committed.
Evidence basis: every number below comes from a command executed on 2026-09-20 in this workspace; no claim is carried over from an earlier plan or PASS report.
Interpreter used for all Python commands: `python` = 3.11.9 (Hermes venv, `tzdata 2025.3` present).

---

## 0. Live state, verified today

| # | Command (executed) | Observed result | Verdict |
|---|---|---|---|
| L1 | `python monitoring/freecash/tests/run_all.py` | `Ran 52 tests` · `FAILED (failures=6, errors=11)` · exit 1 | GATE RED — the routine does not pass its own offline suite |
| L2 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=2 exempt=27 missing_targets=0` · exit 1 | R2 static gate RED |
| L3 | non-EXEMPT hits from L2 | `approval_queue.py:111` (class `earning-action`), `tests/test_r4_approval.py:283` (class `write-call-shape`) | two unresolved hits |
| L4 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` and `…-Missed-Day-Watchdog"` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | NOT SCHEDULED — routine has never run on a timer |
| L5 | `env \| grep FREECASH` | no match | no `FREECASH_*` configuration on the host |
| L6 | `python -c "import tzdata"` | `tzdata OK 2025.3` | venv interpreter can resolve `Europe/Berlin`; the `py -3` launcher (3.14.7) cannot |
| L7 | `ls data/freecash` / `data/freecash-monitor` | `data/freecash` empty; `data/freecash-monitor` absent; `keys.py` default root = `D:/AgenticOS/data/freecash-monitor` (`paths.py:35`) | STATE ROOT MISMATCH — canonical root vs default root |
| L8 | `grep -rn "https\?://" monitoring/freecash/*.py` | only `readonly_client.py:54 DEFAULT_BASE_URL = "http://localhost:3001"` | no live provider endpoint is wired; approval items carry the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` |
| L9 | `git log --oneline -- monitoring/freecash` | no output | the routine is untracked, uncommitted work — must be preserved, never reset |

Interpretation: Free Cash Finance Automation is one coherent, rule-disciplined routine (`monitoring/freecash/`) that is currently **red on its own acceptance gates, unscheduled and unconfigured**. Work starts at making the gate green, not at wiring an account.

---

## 1. Root causes (attributed from code + two independent failures each)

| ID | Symptom (test) | Root cause (grounded) | Fix shape |
|---|---|---|---|
| C1 | 11 errors: every change-dependent R3/R4 test | `approval_queue.py:111` calls `ACTION_LABEL_REQUEST_PAYOUT`; the only constant defined is `ACTION_LABEL_FOR_HUMAN_REVIEW` (`:52`) → `NameError` on the first detected change that must be enqueued | rename the reference to the defined constant (one line); the enqueue path is then reachable for the first time and must be re-tested |
| C2 | `test_five_concurrent_runs_yield_one_winner` (`last_attempt_day` = None), `test_healthy_day_raises_no_alarm` (`covered` = False) | `run_daily_check.py:326` discards the return value of `gate.record_attempt(day, now, ledger)`; the stale dict is then passed to `gate.record_outcome(..., ledger, ...)` at `:443`, which re-saves and clobbers `last_attempt_day` back to `None`. The watchdog then reads an uncovered day | rebind: `ledger = gate.record_attempt(day, now, ledger)` |
| C3 | `test_missing_check_raises_one_alarm_and_changes_no_state` (`'notify' != 'alert'`) | `watchdog._check()` raises `MISSED_DAY` through `notify.notify_change`, which stamps `SEVERITY_INFO`; the test demands `alert` for a missed day | decide the severity contract once (missed day = `alert`) and enforce it at the emit site or in the test, never both |
| C4 | `test_shipped_shell_checker_passes_on_the_routine_tree`, `test_python_port_agrees_with_the_shell_checker` | the shipped R2 scanner flags its own tree: `ACTION_LABEL_REQUEST_PAYOUT` (removed by C1) and the negative-control string `assertNotIn("http.client", …)` in `test_r4_approval.py:283`; both are scanner false positives, not code defects | exempt the assertion line with the documented `# readonly-exempt:` marker; re-run both checkers to exit 0 |
| C5 | `test_day_key_follows_the_configured_timezone` (`'Europe/Berlin' not found in 'C:\...\Temp\freecash-test-…'`) | test-side defect: line 33 asserts the TZ name appears in the *temp directory path*, which is impossible. The day-key assertions on lines 30/32 pass | correct the assertion (compare `gate.day_key()` under both TZ values), not the implementation |
| C6 | every run emits `WARNING timezone_unavailable` when launched via `py -3` | the launcher (3.14.7) has no IANA database; only the venv interpreter (3.11.9 + tzdata) resolves `Europe/Berlin` | pin the scheduled action to the venv interpreter, or install `tzdata` for the launcher; record which one in the gate checklist |

C1–C3 are the substance of the red gate; C4–C5 are gate hygiene; C6 is a deployment-pinning decision. None require new architecture.

---

## 2. Frozen constraint set (supersedes all earlier numbering)

| ID | Rule | Mechanism that makes violation unreachable | Proof required |
|---|---|---|---|
| R1 | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` — `O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock` | two runs same day → exactly one `RUN_OK`, one `SKIP_DUPLICATE_DAY`; 5 concurrent → 1 winner |
| R2 | no earning/withdrawal action; read-only transport | `readonly_client.py::request` deny-by-default `{GET,HEAD}`, no body/files; `verify_readonly.py` static scan | transport test + scanner exit 0 on the shipped tree |
| R3 | notify on status/earnings change, once | `changedetect.py::compare` exact integer cents; `dedupe_key` written before dispatch | seeded change → exactly one payload; no-change day → `OK_NO_CHANGE`, no dispatch |
| R4 | human approval before any external write | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decision requires human `--by` | tokenless write raises and performs no network write; 90-day clock advance changes nothing |

Inherited workspace constraints, non-negotiable: no secrets in code, state or logs (use `[REDACTED]` / vault / env only); no modification, reset or deletion of unrelated uncommitted work; no destructive git operations; PASS may only be claimed from output quoted in this session; every stage ends with a re-run of the gate it touches.

---

## 3. Workflow stages

Each stage is a unit of work with its own exit criterion. Effort figures are estimates, not measurements.

### S0 — Repair the routine's own gate (C1, C2, C3, C5)
Expected Effort: 2–4 h. Time-to-Revenue: none (unblocks everything). Dependencies: none.
First Concrete Action: apply the one-line C1 constant rename, then re-run `python monitoring/freecash/tests/run_all.py` and quote the new totals. Do not batch C2/C3 into the same run — each fix gets its own suite run so the delta is attributable.
Exit: suite totals trend to `failures=0 errors=0`; each remaining red test is named with its own root cause.

### S1 — Clear the R2 static gate (C4)
Expected Effort: 30–60 min. Time-to-Revenue: none. Dependencies: S0/C1 (one of the two hits disappears with C1).
First Concrete Action: mark the negative-control assertion line with `# readonly-exempt: negative-control payload for the checker (R2)`, then run both `verify-readonly.sh` and `verify_readonly.py` and require exit 0 from both; record the new `exempt` count as the baseline (any later rise means R2 is eroding).
Exit: `forbidden=0`, both checkers exit 0, exemption count recorded.

### S2 — Make the suite the acceptance gate, not a document
Expected Effort: 2–3 h. Time-to-Revenue: none. Dependencies: S0, S1.
First Concrete Action: run the 10 pre-flight checks in `RULE-GATE-CHECKLIST.md`, replacing check 5 (`pytest … 16 passed`) with `python monitoring/freecash/tests/run_all.py` — pytest is not installed on this host and the "16 passed" figure was never observed; fill each `Observed result` cell from this session's output only.
Exit: every pre-flight row carries a real command, real output and a status of PASS / FAIL / N/A(blocked with named blocker).

### S3 — Choose and configure the read source (three options)
**S3a — Operator-entered state (available today).** `state/operator-state.json` as source A; no network at all. Expected Effort: 1–2 h (mostly a documented daily entry step). Time-to-Revenue: none; this is the fastest path to a routine that genuinely runs. Dependencies: S0. First Concrete Action: create `D:/AgenticOS/data/freecash/` with the documented layout, write one operator record, run the entry point, and confirm one snapshot plus one daily log line appear.
**S3b — In-repo AgenticOS status route.** Add `GET /api/finance/freecash/status` (GET-only, read-only) over existing server data. Expected Effort: 6–10 h. Time-to-Revenue: indirect (feeds revenue tracking). Dependencies: S0, server running, DB schema. First Concrete Action: one route returning balance/earnings/pending fields, then `curl` it and paste the real JSON into the fixture — no fixture invented by hand.
**S3c — Live provider account (BLOCKED).** Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: provider identity, its authenticated read contract, and a credential stored in the Hermes vault or `.env` — never in chat or in code. First Concrete Action: one read-only authenticated GET probe. Current evidence is against it: `api.freecash.com/v1/status` returns 404 in earlier passes, no `FREECASH_*` key exists on this host (L5), and the current default base URL is `http://localhost:3001` (L8), a route that does not exist in `server/src/routers`. Keep it off the critical path.

### S4 — Scheduling (R1 on a real clock)
Expected Effort: 2–3 h. Time-to-Revenue: none. Dependencies: S0–S2, S3a or S3b.
Host facts: `crontab` is absent in git-bash; Windows Task Scheduler is the mechanism; no task exists today (L4).
First Concrete Action: register Task A (daily, `-MultipleInstances IgnoreNew`, restart-on-failure = Do not restart) pinned to the venv interpreter if C6 is not resolved, trigger it manually, then confirm one run-log line and a second trigger the same day exiting with `SKIP_DUPLICATE_DAY`.
Exit: `schtasks /Query /TN … /V /FO LIST` output quoted, plus the manual-trigger evidence.

### S5 — Watchdog / missed-day detection (R1 second detector)
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S0/C2 (the watchdog cannot be trusted while `last_attempt_day` is clobbered), S4.
First Concrete Action: register Task B (23:50 daily) and verify the healthy-day path prints `WATCHDOG_OK` and emits no alarm; then delete only the day lock in a temp root and confirm exactly one `MISSED_DAY` alarm.
Exit: healthy day → zero alarms; uncovered day → exactly one alarm, ledger unchanged.

### S6 — Notification delivery (R3 sink)
Expected Effort: 2–4 h, or blocked. Time-to-Revenue: none. Dependencies: S0, S4.
Options: (i) local toast + append-only `alerts/alerts.jsonl` (works today, testable); (ii) file/log sink asserted in test (works today); (iii) email/webhook — BLOCKED: no `SMTP_*`/`WEBHOOK_*` keys and `himalaya` is not installed.
First Concrete Action: run one seeded-change day with the local sink and quote the single emitted payload; keep any external sink a separate, credential-gated step.

### S7 — Approval gate (R4) surface + audit
Expected Effort: 3–5 h. Time-to-Revenue: none. Dependencies: S0/C1 (the queue is unreachable until then), S3, S6.
First Concrete Action: exercise the documented CLI decision path (`--by` required) against one enqueued item, confirm the decision lands in `approvals/decided.jsonl` and `execution_state` stays `NOT_EXECUTED`; then run the tokenless-write test proving no network write occurs.
Exit: pending item survives a 90-day clock advance unchanged; every decision is attributable to a human identifier.

### S8 — Reconcile the state root and freeze the docs (C6 + drift)
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S0–S7.
First Concrete Action: align `paths.py` default root with the canonical `D:/AgenticOS/data/freecash/` (or set `FREECASH_DATA_ROOT` in the task definition and document it), then add one-line `SUPERSEDED — see <canonical spec>` headers to the older design docs. Headers only: no rewrites, no deletions, and the legacy runners stay on disk (disable, never delete).

---

## 4. Critical path and ordering

S0 → S1 → S2 → (S3a or S3b) → S4 → S5 → S6 → S7 → S8.

S0 is the true blocker: with 11 errors caused by C1 and two more by C2, no scheduler or provider work can be validated, because the change path that R3/R4 depend on raises before it writes anything. S3c (a real money account) stays off the critical path and BLOCKED on provider details plus a credential.

Sequencing discipline: exactly one change between gate runs, so a red-to-green delta is attributable; no stage is reported complete on a claim — only on the command output it produced.

---

## 5. Blocked register

| Item | Blocked on | Reason (verified) |
|---|---|---|
| Live account status | provider identity + documented authenticated read contract + credential | no `FREECASH_*` key on the host (L5); default base URL is `http://localhost:3001` (L8); approval items literally carry `PROVIDER_ENDPOINT_UNKNOWN` |
| Email / SMS / webhook notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | none configured; `himalaya` not installed |
| Any real withdrawal / earning action | human approval surface + R4 implementation | no approve/reject surface exists yet, and per R4 it must never execute unattended |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | host is non-elevated by policy; plan uses a non-elevated-compatible task form |

---

## 6. Non-goals

- No rewrite, move or deletion of the parallel legacy implementations during this plan.
- No live financial write path is introduced; R4 exists to keep it that way.
- No compliance claim from `rule_gate_verify.py`, `verify-readonly.sh` or any earlier PASS report — only from a command run and quoted in the current session.
- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations.

---

## 7. Delta — 2026-09-20 ~21:10 local (re-verified; supersedes §0 rows L1, L2, L3 and adds the app-side surface)

Every row below is a command executed in this pass; no figure is carried over.

| # | Command (executed) | Observed result | §0 said | Status now |
|---|---|---|---|---|
| D1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0` | RED (6 failures / 11 errors) | **GREEN** — C1, C2, C3, C5 are resolved |
| D2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | RED (forbidden=2) | **GREEN** — C4 resolved |
| D3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | identical `forbidden=0 exempt=28` · exit 0 | RED | **GREEN, and both checkers agree** (old `exempt=27` baseline is now 28) |
| D4 | `python -m unittest discover -s tests -t .` (the "equivalent form" in `run_all.py`) | `ImportError: Start directory is not importable` | — | **NOT USABLE** — only `run_all.py` is a working entry point; fix the docstring, not the tests |
| D5 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` and `…-Missed-Day-Watchdog` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | not scheduled | **unchanged — still unscheduled; the routine has never run on a timer** |
| D6 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | root "absent" | **routine has run once, manually, degraded**; state root is `data/freecash-monitor` (L7 divergence persists) |
| D7 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | — | **no operator reading has ever been entered** → R3 (change detection) and R4 (approval queue) have never been exercised on real input; `approvals/` is empty |
| D8 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"`; `command -v himalaya` | no match; not installed | — | external notification sinks still **BLOCKED** |

### 7.1 The app-side surface §0 did not cover

| # | Evidence | Observation |
|---|---|---|
| D9 | `agentic-os.db` (`server/data/agentic-os.db`, 104 tables): `projects` row `proj-free-cash` = active, priority 1, tag `revenue/free_cash/p1` | the project exists in the live app DB; the root `database.sqlite` is 0 bytes and irrelevant |
| D10 | `schedules`: `schedule-revenue-supervisor-tick`, cron `*/5 * * * *`, `enabled=1`, `routine_id=routine-revenue-supervisor`, `last_triggered_at=2026-09-19T18:05:00Z`, `last_outcome=completed`; `schedule_executions`: 2770 runs, 2588 completed (~6.6% non-completed) | a **second, already-running scheduler** exists inside AgenticOS and it has been driving `proj-free-cash` — but it is dormant now |
| D11 | `curl -m5 localhost:3001/health` → `000`; `tasklist` → no `node.exe`, no `electron.exe` | the in-app scheduler only fires while the app is running; the last tick predates this session. **Windows Task Scheduler is the only 24/7 mechanism on this host** |
| D12 | `provider_credentials` = 0 rows; no `server/data/freecash/session-evidence.json`; no `server/data/browser_profiles/` | `hasCredentialConfigured('freecash')` is false and no authenticated session has ever been proven → the prerequisite gate (`executionGate.ts`, `freecashPrerequisiteGate.test.ts`) is correctly blocking |
| D13 | `background_tasks` for `proj-free-cash`: `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" = **blocked**, `current_stage=executing_mission`, `updated_at=2026-09-19T18:05:18Z`; `bgtask-cfed82a34` (revenue-supervisor cycle) = completed; fleet-wide: blocked 5, queued 7, failed 1, completed 1144 | the revenue path is stalled at the execution gate, not at the monitoring routine |
| D14 | `background_tasks.blocker` for `bgtask-07a8154b0` = *"Backend restarted while this task was in progress. The worker's live state was lost — resume or retry the task to continue."*, `resumable=0`, `last_error=null`, `result_text=null` | the Free Cash mission's real blocker is a **lost worker on backend restart**, not the affiliate-credential story repeated in `ACOUSTIC_ROBUSTNESS_REPORT.md`; `resumable=0` means it cannot be resumed in place and must be re-dispatched |
| D15 | `background_tasks.result_text` for `bgtask-cfed82a34` = *"Revenue Supervisor cycle #749 blocked — Human gate resolved; Shopify publication is not implemented."* | the supervisor loop's own last verdict: the human gate it can see is resolved; what it cannot do is publish |

Interpretation: the monitoring routine's gate is **green and unattended-run has never happened**; the revenue path is **stalled on an external-session prerequisite**; the scheduler that already exists (`routine-revenue-supervisor`) is dormant whenever the desktop app is closed. The critical path therefore no longer starts at S0 — it starts at **S3a → S4**.

### 7.2 One-line file footprint of this delta

Additive only: this section was appended to `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md`. No existing line was rewritten, no file was moved, renamed or deleted, and no git operation was performed (`git status --short` still lists `config/`, `finance-monitor/`, `monitoring/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/` as untracked `??`).

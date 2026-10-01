# Free Cash Finance Automation — Workflow Plan V5 (grounded, live re-verification 2026-09-20 21:34–21:42 local)

Repository: `D:\AgenticOS`
Branch: `hermes-rescue-20260908` (524 entries in `git status --short`; pre-existing uncommitted work — must be preserved)
Additive only: this file is new under `docs/free-cash-monitor-routine/`. No existing file was modified, moved, renamed or deleted; no git operation was performed.
Evidence basis: every figure below is from a command executed in this session. No PASS, count or provider claim is carried over from an earlier plan or report.

---

## 0. Live state, re-verified today

| # | Command (executed this session) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` ×4 | run1 `failures=1` (`test_five_concurrent_runs_yield_one_winner`), run2/3/4 `failures=0 errors=0 skipped=0` (exit 0) | **GATE FLAKY — not reproducibly green** |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | R2 GREEN |
| V3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | identical `forbidden=0 exempt=28` · exit 0 | R2 GREEN, both checkers agree |
| V4 | `schtasks /Query /TN "FreeCash-Daily-Monitor"`; `…-Missed-Day-Watchdog`; `schtasks /Query /FO CSV \| grep -i freecash` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both); CSV grep empty | **NOT SCHEDULED — the routine has never run on a timer** |
| V5 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | one manual run only, degraded |
| V6 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | **no operator reading has ever been entered** → R3 and R4 never exercised on real input |
| V7 | `cat data/freecash-monitor/alerts/alerts.jsonl` | 2 lines, both `severity=info`: `MONITOR_DEGRADED`, `SKIP_DUPLICATE_DAY` | R1 day-lock + alert sink proven live; no `EARNINGS_CHANGED` alert has ever been emitted |
| V8 | `ls data/freecash data/freecash-monitor` | `data/freecash` **empty**; `data/freecash-monitor` has `state/ snapshots/ alerts/ approvals/(empty) logs/(empty)` | canonical-root vs default-root divergence persists |
| V9 | `env \| grep -iE 'FREECASH\|SMTP_\|WEBHOOK_'`; `command -v himalaya` | no match; absent | external/credentialed sinks **BLOCKED** |
| V10 | `git status --short -- monitoring/freecash data/freecash-monitor config/freecash-crontab docs/free-cash-monitor-routine` | all `??` (untracked) | routine is uncommitted work — preserve, never reset |
| V11 | `grep -rniE "password\|token\|secret\|api[_-]?key" monitoring/freecash/*.py \| grep -v readonly-exempt` | 6 hits, **all in `verify_readonly.py` docstrings/comments** (scanner describing its own token classes) | no real secret in the tree; checklist #1 wording needs a scanner prose exemption |
| V12 | `grep -rn PROVIDER_ENDPOINT_UNKNOWN monitoring/freecash/` | 12 hits | no provider endpoint has been resolved |
| V13 | `grep -rn readonly-exempt monitoring/freecash/ \| wc -l` | 31 | R2 exemption baseline (a rise means R2 is eroding) |
| V14 | `python -c` online read of `server/data/agentic-os.db` | `provider_credentials=0`; `revenue_metrics=2`; `revenue_ledger_entries=11`; `revenue_missions=23`; `revenue_opportunities=9`; `revenue_human_gates=16`; `revenue_action_executions=32`; `treasury_ledger=0` | app-side revenue data exists and is non-trivial; no provider credential row |
| V15 | same DB: `background_tasks` | `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" = `blocked`, `current_stage=executing_mission`, `resumable=0`; fleet status counts `blocked 5 / queued 7 / failed 1 / completed 1144` | the revenue path is stalled at the execution gate, not at the monitor |
| V16 | same DB: `schedules` | `schedule-revenue-supervisor-tick` cron `*/5 * * * *`, `enabled=1`, `last_triggered_at=2026-09-19T18:05:00Z`, `completed` | a second scheduler exists in-app but is dormant |
| V17 | `curl -m5 localhost:3001/health` | HTTP `000` (no listener) though 5 `node.exe` processes are running | in-app scheduling only fires while the API is up; Windows Task Scheduler is the only 24/7 host mechanism |
| V18 | `grep -rl freecash server/src/routers/` | only `projects.ts` (contains the tag string); no Free Cash route exists | the monitor's configured read source has no implementation |

**Interpretation.** Free Cash Finance Automation is one coherent, rule-disciplined routine (`monitoring/freecash/`) whose R2 gate is green and whose R1 gate is **non-deterministic**, that has never been scheduled and never been fed a real reading. The revenue side of the same project is separately stalled on a blocked background task with zero configured credentials. The two must not be conflated: fixing the monitor does not move revenue, and re-dispatching the mission does not make the monitor trustworthy.

---

## 1. Frozen constraint set (supersedes all earlier numbering)

| ID | Rule | Mechanism that makes violation unreachable | Proof required (this session's output only) |
|----|------|-------------------------------------------|---------------------------------------------|
| R1 | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` — `O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock` | two runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY`; 5 concurrent runs → exactly 1 winner, **repeatedly, without flake** |
| R2 | no earning/withdrawal action; read-only transport | `readonly_client.py::request` deny-by-default `{GET,HEAD}`, no `data`/`json`/`files`; `verify_readonly.py` + shipped shell scanner | both scanners exit 0 with `forbidden=0`; transport spy shows only GET/HEAD |
| R3 | notify once on status/earnings change | `changedetect.py::compare` exact integer cents; `dedupe_key` written before dispatch | seeded change → exactly one payload in `alerts.jsonl`; no-change day → `OK_NO_CHANGE`, no dispatch |
| R4 | human approval before any external write | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decision requires human `--by` | tokenless write raises and performs no network write; 90-day clock advance changes nothing |

Inherited workspace constraints, non-negotiable: no secrets in code, state or logs (`[REDACTED]` / vault / env only); no modification, reset or deletion of unrelated uncommitted work (V10); no destructive git operations; PASS only from output quoted in the current session; one change between gate runs so a red→green delta is attributable.

---

## 2. Stages — each option carries Effort / Time-to-Revenue / Dependencies / First Concrete Action

### S0 (new, first) — De-flake the R1 concurrency proof
Expected Effort: 2–4 h. Time-to-Revenue: none (unblocks every scheduling step). Dependencies: none.
Why it is now stage zero: V1 shows `test_five_concurrent_runs_yield_one_winner` failing in 1 of 4 runs. R1 is the invariant the whole routine rests on, and the scheduler step below relies on `-MultipleInstances IgnoreNew` plus the lock; a lock proven green 3 times and red once is not proven.
First Concrete Action: run the concurrency test in a loop (`for i in $(seq 1 20)`) against a temp state root, capture the losing runs, and classify the failure as harness race (test spawns/joins processes too tightly), lock-path race, or `record_attempt` state race; then fix the mechanism — not the assertion — and re-run the loop to 20/20 green before touching anything else.

### S1 — Close the gate-checklist evidence gaps (no code change)
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S0.
Facts: checklist row 5 cites `py -3 -m pytest … 16 passed` — pytest is not the working entry point (`run_all.py` is) and the figure was never observed; checklist row 1's literal secret command returns 6 hits that are all scanner prose (V11); row 4's `readonly-exempt` baseline is now 31 (V13).
First Concrete Action: amend `RULE-GATE-CHECKLIST.md` rows 1/4/5 to cite `python monitoring/freecash/tests/run_all.py`, record `exempt=28` / `readonly-exempt=31` as the frozen baselines, and add the scanner-prose exemption note — fill each `Observed result` cell from this session's output only.

### S2 — Choose and configure the read source

**S2a — Operator-entered state (available today, recommended first)**
Expected Effort: 1–2 h (mostly a documented 2-minute daily entry step). Time-to-Revenue: none directly; it is the cheapest path to a routine that genuinely runs end to end. Dependencies: S0, S1.
First Concrete Action: create the documented layout under `D:/AgenticOS/data/freecash/` (resolving V8), append one real `record` to `operator-state.json` for today, run `python monitoring/freecash/run_daily_check.py`, and quote the resulting `snapshot=….json written=True` line plus the `INITIAL_BASELINE` alert.

**S2b — In-repo AgenticOS status route**
Expected Effort: 6–10 h. Time-to-Revenue: none directly; feeds app-side revenue tracking. Dependencies: S0, server listening (V17 shows it is not), existing `revenue_metrics` / `revenue_ledger_entries` tables (V14: 2 and 11 rows — thin but real).
First Concrete Action: add `GET /api/finance/freecash/status` (GET-only, read-only) in `server/src/routers/`, start the server, `curl` it, and paste the real JSON into the test fixture — never hand-written.

**S2c — Live provider account (BLOCKED)**
Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: provider identity + its documented authenticated read contract + a credential stored in the Hermes vault or `.env` (never in chat or code).
First Concrete Action: one read-only authenticated GET probe. Evidence against starting now: `provider_credentials` = 0 rows (V14), no `FREECASH_*` env key (V9), 12 `PROVIDER_ENDPOINT_UNKNOWN` markers in the routine (V12), and no route or client that could serve as a substitute (V18). Keep off the critical path.

### S3 — Scheduling (R1 on a real clock)
Expected Effort: 2–3 h. Time-to-Revenue: none. Dependencies: S0 (hard), S2a or S2b.
Facts: `crontab` is absent in git-bash; `config/freecash-crontab` is a template with placeholder paths (`/path/to/AgenticOS`) and is not installed; Windows Task Scheduler is the only 24/7 mechanism on this host (V17); no Free Cash task exists (V4).
First Concrete Action: register Task A (`FreeCash-Daily-Monitor`, daily, `-MultipleInstances IgnoreNew`, restart-on-failure = Do not restart, interpreter pinned to the 3.11.9 venv that resolves `Europe/Berlin`), trigger it manually, then quote `schtasks /Query /TN … /V /FO LIST` plus the skip evidence for a second same-day trigger.

### S4 — Missed-day watchdog (R1 second detector)
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S0, S3.
First Concrete Action: register Task B (`FreeCash-Missed-Day-Watchdog`, 23:50 daily), confirm a healthy day prints `WATCHDOG_OK` and emits no alarm; then remove only the day lock in a temp root and confirm exactly one `MISSED_DAY` alarm with an unchanged ledger.

### S5 — Notification sink (R3 delivery)
Expected Effort: 2–4 h, or blocked. Time-to-Revenue: none. Dependencies: S0, S3, S2a (a real reading to change).
Options: (i) append-only `alerts/alerts.jsonl` — already proven live (V7), testable; (ii) Windows toast via `notify.py::_toast_send` with the offline stub; (iii) email/SMS/webhook — BLOCKED (V9).
First Concrete Action: one seeded-change day producing exactly one payload line, quoted from `alerts.jsonl`; keep any external sink a separate, credential-gated step.

### S6 — Approval gate surface (R4) end-to-end
Expected Effort: 3–5 h. Time-to-Revenue: none. Dependencies: S0, S5, a real change to enqueue.
Facts: the CLI exists (`approval_queue.py:241` `main()`, `--id/--decision/--by/--note` all required); `approvals/` is empty because `operator-state.json` has no records (V6), so the decide path has never been exercised on real data.
First Concrete Action: exercise `decide --by <human>` against one enqueued real item, confirm the decision lands in `approvals/decided.jsonl` with `execution_state` still `NOT_EXECUTED`, then run the tokenless-write test proving no network write occurs.

### S7 — Revenue path (separate from the monitor; BLOCKED)
Expected Effort: unknown. Time-to-Revenue: blocked, therefore unestimable without inventing numbers. Dependencies: a provider credential plus a human gate decision; `bgtask-07a8154b0` cannot be resumed in place (`resumable=0`, V15) and must be re-dispatched.
First Concrete Action: re-dispatch (not resume) the Free Cash mission task only after S2c yields a credential; until then the honest position is that no Free Cash revenue workflow can be validated end to end.

---

## 3. Critical path

S0 → S1 → S2a → S3 → S4 → S5 → S6. S2b is parallel and optional; S2c and S7 are off the critical path and BLOCKED.

Sequencing discipline: exactly one change between gate runs; no stage is reported complete on a claim — only on the command output it produced.

---

## 4. Blocked register

| Item | Blocked on | Reason (verified this session) |
|---|---|---|
| Live account status | provider identity + documented authenticated read contract + credential | `provider_credentials` = 0 (V14); no `FREECASH_*` key (V9); 12 `PROVIDER_ENDPOINT_UNKNOWN` (V12) |
| Email / SMS / webhook notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | none configured; `himalaya` not installed (V9) |
| Any real withdrawal / earning action | human approval surface + R4 reached with real data | `approvals/` empty; `operator-state.json` `records: []` (V6) |
| In-app scheduler as the 24/7 mechanism | a listening API server | `localhost:3001/health` → `000` (V17) |
| Free Cash revenue mission | claim-free credential + re-dispatch of a `resumable=0` blocked task | V15 |

---

## 5. Non-goals

- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations (V10).
- No deletion or rewrite of the parallel legacy runners (`server/scripts/freecash-daily-monitor.mjs`, `scripts/monitoring/free-cash-daily-check.py`, `scripts/make_freecash_check.py`) — disable and document, never delete.
- No live financial write path is introduced; R4 exists to keep it that way.
- No compliance claim from any earlier PASS report — only from a command run and quoted in the session that claims it.
- No invented revenue timeline: the monitor produces evidence, not revenue, and the revenue path is currently blocked.

---

## 6. Correction — the runtime DB is not the repo DB (appended after §0 was written)

`server/src/db/index.ts:19-33` resolves the app database to `AGENTICOS_DATA_DIR`, else `%APPDATA%/agenticos/data/agentic-os.db` when that file exists, else `<repoServerRoot>/data/agentic-os.db`. On this host `C:\Users\cd-pr\AppData\Roaming\agenticos\data\agentic-os.db` exists (16,990,208 bytes, modified 2026-09-20 21:13), so **`D:\AgenticOS\server\data\agentic-os.db` is a stale/seed copy and rows V14–V16 above came from the wrong file.** The corrected readings from the runtime DB are:

| # | Runtime-DB query | Observed | Effect on this plan |
|---|---|---|---|
| C1 | `select count(*) from provider_credentials` → `provider_id` values | 2 rows: `omniroute`, `antigravity` | **no `freecash` credential** — S2c and the credential blocker stand, now grounded in the live DB |
| C2 | `schedules` | 3 rows, all `0 9 * * *`, `enabled=1`, `last_triggered_at` NULL | no Free Cash-specific schedule anywhere; V16's "second scheduler" was a repo-copy artifact |
| C3 | `background_tasks` where title like `%Free Cash%` | ~100 rows of history; latest `bgtask-a72583f64` "Revenue Operator: Free Cash Mission" `running`, last failed run `bgtask-b08ac4669` at `2026-09-20T19:39:11Z` | the revenue path is **actively churning, not dormant**, and repeatedly fails at `executing_mission` |
| C4 | last completed mission `result_text` | "Revenue Operator completed mission … This was INTERNAL planning — no external FreeCash action" | the loop emits internal plans only; **time-to-revenue from this path is currently unbounded** |
| C5 | table counts | `revenue_missions 82`, `revenue_opportunities 7`, `revenue_supervisor_state 1`, `revenue_metrics 0`, `revenue_human_gates 0`, `treasury_ledger 0`; `revenue_action_executions` absent in this DB (104 tables vs 104 in the repo copy, different sets) | S2b's in-repo route has a real `revenue_missions`/`revenue_opportunities` base but no populated metrics or ledger yet |

Revised consequence: S0–S6 (the monitoring routine) are unchanged and remain the only work whose completion this plan can actually prove. S7 must be restated as **"the mission loop is running and failing, not idle"** — its first concrete action is to read `background_tasks.blocker` / `last_error` for `bgtask-b08ac4669` before re-dispatching anything, because the failure is deterministic (repeated `executing_mission` failures across 2026-09-18 → 2026-09-20) and a blind re-dispatch will repeat it. Any DB figure quoted in a future pass must name the file it was read from.

# WORKFLOW PLAN — Free Cash Finance Automation (consolidated, constraint-complete)

**Repository:** `D:\AgenticOS` · **Branch/HEAD:** `hermes-rescue-20260908` @ `d14253d`
**Written:** 2026-09-20 ~21:40 operator-local (`date` → `So, 20. Sep 2026 21:34:52`, `Europe/Berlin`)
**Interpreter of record:** `python` = 3.11.9 (Hermes venv, `tzdata` present) — resolves `Europe/Berlin`. `py -3` = 3.14.x — does **not** (`ZoneInfoNotFoundError`), so it may never drive the daily run (C10).
**Evidence standard (C7):** every claim below is a command executed in this pass; a rule counts as enforced only when (a) the violating action is unreachable in code, (b) a command shows the mechanism denying it, (c) the checker is shown to **fail** on an injected violation.
**Footprint:** this file is new (additive). No existing file was modified, moved, renamed or deleted; no git add/commit/stash/reset/restore was run. `monitoring/`, `docs/free-cash-monitor-routine/`, `config/`, `finance-monitor/` are untracked (`??`) — an edit there is unrecoverable by git.
**Supersedes nothing, reads alongside:** `OPERATIONS-WORKFLOW-PLAN.md`, `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` §7 (delta), `RULE-GATE-CHECKLIST.md`, `ROUTINE-DESIGN.md`, `WORKFLOW-PLAN-V4.md`, `RESEARCH-PLAN-V4.md`, `PROVIDER-DECISION-PACKET-2026-09-20.md`.

---

## 0. Live state, verified in this pass (V-rows)

| # | Command (executed) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | **GREEN** — C1/C2/C3/C5 repairs from §7 of the prior plan hold up under re-run |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | R2 static gate **GREEN** |
| V3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | both checkers **agree** (exemption baseline = 28) |
| V4 | `python monitoring/freecash/verify_readonly.py <temp copy of monitoring/freecash with an appended \`POST /api/v1/claim\`>\` | `forbidden=4` · exit 1 | **mutation probe passes** — the R2 checker has demonstrated detection power, it is not a no-op |
| V5 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT` · **exit 1** | acceptance gate **RED** on R1 — verifier scope defect: the lock lives in `gate.py`, the verifier is single-file scoped |
| V6 | same gate over a temp copy of `run_daily_check.py` with an added approval-queue import | identical `R1=FAIL` verdict, exit 1 | the gate reports R1 only because of scope; its R4 check did **not** react to the injected import → R4 detection power is **unproven** (finding, not a pass) |
| V7 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` and `…-Missed-Day-Watchdog"` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | **never scheduled** — the routine has never run on a timer |
| V8 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"` | no match (exit 1) | no host configuration, no external notification sink |
| V9 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | one manual, degraded run ever |
| V10 | `python -c "json…operator-state.json"` · `ls approvals/` · `cat alerts/alerts.jsonl` | `records=0`; `approvals/` empty; 2 alert lines (`MONITOR_DEGRADED`, `SKIP_DUPLICATE_DAY`) | **R3 and R4 have never been exercised on real input** |
| V11 | `curl -m5 localhost:3001/health` | `http=000` | the app is not running → the in-app scheduler is dormant |
| V12 | app DB `server/data/agentic-os.db`: `projects` | `proj-free-cash` active, priority 1, tags `revenue/free_cash/p1` | the revenue project exists in the live app |
| V13 | app DB: `schedules` | `schedule-revenue-supervisor-tick` cron `*/5 * * * *`, `enabled=1`, `routine_id=routine-revenue-supervisor`, `last_triggered_at=2026-09-19T18:05:00Z`, `last_outcome=completed` | a **second scheduler exists inside the app**, dormant since 2026-09-19 |
| V14 | app DB: `schedule_executions` (latest) | newest row `project_id=proj-free-cash`, `outcome=completed`, `triggered_at=2026-09-19T18:05:00Z` | the in-app loop *has* been driving `proj-free-cash` |
| V15 | app DB: `background_tasks` | `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" = **blocked**, `current_stage=executing_mission`, blocker = *"Backend restarted while this task was in progress. The worker's live state was lost…"*; fleet: blocked 5, queued 7, failed 1, completed 1144 | the revenue path is stalled on a **lost worker**, not on a missing feature |
| V16 | app DB: `provider_credentials` | `count = 0` | no credential configured for any provider → the prerequisite gate blocking the mission is correct |
| V17 | `ls server/data/` | `freecash-monitor` present (docs only); no `freecash/session-evidence.json`, no `browser_profiles/` | **no authenticated provider session has ever been proven** |
| V18 | `ls scripts/monitoring/ scripts/finance_monitor.py scripts/make_freecash_check.py server/scripts/freecash-daily-monitor.mjs config/freecash-crontab` | all present on disk | the parallel legacy implementations still exist; `crontab` is unavailable in git-bash, so `config/freecash-crontab` is inert |

**One-line status:** the monitoring routine's own gate is **green and mutation-tested**, the acceptance gate `rule_gate_verify.py` is **red on R1 for scope reasons**, the routine has **never been scheduled**, **no operator reading has ever been entered**, and the in-app revenue path is **stalled on a lost worker plus a missing credential**. Two independent schedulers exist; neither is currently running the Free Cash routine.

---

## 1. Operational constraints (frozen; every stage is scored against these)

| ID | Constraint | Mechanism that makes violation unreachable | Proof required |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` — atomic `O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock`; a consumed day prints `SKIP_DUPLICATE_DAY` with no read, no snapshot, no ledger write | two runs same day → one `RUN_OK` + one `SKIP_DUPLICATE_DAY` (V1 observed in temp root) |
| **R2** | zero automated earning/withdrawal action; read-only transport | `readonly_client.py::request` deny-by-default `{GET,HEAD}`, path allowlist, no `data`/`json`/`files`; `verify_readonly.py` static scan | checker exit 0 on the shipped tree (V2/V3) **and** exit 1 on an injected write (V4) |
| **R3** | notify on status/earnings change, exactly once per distinct change | `changedetect.py::compare` on exact integer cents; `dedupe_key` written **before** dispatch; no-change day = log-only `OK_NO_CHANGE` | seeded change → exactly one payload; no-change day → no dispatch |
| **R4** | human approval before any external write | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`; decisions require a human `--by`; the routine contains **no execution path** | tokenless write raises and performs no network write; a 90-day clock advance changes nothing |
| **C5** | no secret in the repository, state or logs; resolve at runtime only; print `[REDACTED]` | vault/env only; pre-flight grep over `monitoring/freecash/` and `data/` | `grep -rniE "password\|token\|secret\|api[_-]?key"` → 0 hits |
| **C6** | additive edits only; temp backup of every file before editing; never `git add/commit/stash/reset/restore` | `git status --short` before and after each edit; untracked tree = no recovery | before/after status quoted |
| **C8** | off-limits: voice runtime, Jarvis runtime, `src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/components/jarvis/*`, `src/domains/jarvis/*` | touch nothing in those paths | diff review |
| **C9** | no provider call, no scheduler change, no message send, no login, no purchase without a recorded human decision | `approvals/` is the only decision record; agent never registers an unattended task | decision row present before the action |
| **C10** | interpreter pinning is mandatory when scheduled | scheduled action points at the 3.11.9 venv `python.exe`; `py -3` cannot resolve `Europe/Berlin` | `schtasks /Query /V /FO LIST` shows the pinned path |
| **C11** | never widen an allowlist; never let a timeout/watchdog/retry move a `PENDING` item to executed; never swallow an exception so a failed run exits 0; never delete a test to make a count green | diff review against this list | per-diff checklist |
| **C12** | provider endpoints are never invented | unresolved source stays the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` | `grep -rn "PROVIDER_ENDPOINT_UNKNOWN"` reviewed, every URL allowlisted-after-research |
| **C13** | a rule is satisfied only from output quoted in the current session | no PASS may be inherited from an earlier plan, report or `.delivery_status.json` | quoted command output |

---

## 2. Workflow stages (S) — Effort is an estimate, not a measurement

### S0 — Close the acceptance gate's R1 scope defect (the one red gate)
**Expected Effort:** 2–4 h. **Time-to-Revenue:** none (unblocks the "is it compliant?" answer).
**Dependencies:** none. **First Concrete Action:** extend `scripts/monitoring/rule_gate_verify.py` to accept a package target (`--package <dir>`) that scans `gate.py` + `run_daily_check.py` together for the R1 lock site, then re-run and require `R1=PASS` with exit 0 while a temp copy with the lock removed still yields `R1=FAIL`.
**Exit:** gate exits 0 on the shipped package and exits 1 on an injected R1 violation (mutation-verified), R2/R3/R4 detection power demonstrated the same way (V6 shows R4's is currently unproven).

### S1 — Record one operator reading and exercise the change path (R3/R4 first real flight)
**Expected Effort:** 1–2 h. **Time-to-Revenue:** immediate on the next real figure change.
**Dependencies:** S0 for a compliance verdict; otherwise standalone.
**First Concrete Action:** enter one record in `data/freecash-monitor/state/operator-state.json` for the current day, run the entry point, and quote the resulting `INITIAL_BASELINE` snapshot; then enter a second day's record with a changed `earnings_total_cents` and quote exactly one notification plus exactly one `approvals/pending.json` item.
**Exit:** change → one payload, one `NOT_EXECUTED` approval item; no-change day → `OK_NO_CHANGE`, no dispatch; `approvals/decided.jsonl` gets one human-attributed decision via `--by`.

### S2 — Fix the state-root divergence
**Expected Effort:** 1 h. **Time-to-Revenue:** none.
**Dependencies:** none. **First Concrete Action:** set `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash` in the task definition and align `paths.py`'s default (currently `data/freecash-monitor`), then re-run one day in the chosen root and quote the lock/snapshot paths.
**Exit:** exactly one canonical root; no state written outside it.

### S3 — Correct the run-entry documentation
**Expected Effort:** 30 min. **Time-to-Revenue:** none.
**Dependencies:** none. **First Concrete Action:** fix the `run_all.py` docstring claiming `python -m unittest discover -s tests -t .` is equivalent (it raises `ImportError: Start directory is not importable`).
**Exit:** the documented command is the one that actually runs.

### S4 — Schedule R1 on a real 24/7 clock
**Expected Effort:** 2–3 h. **Time-to-Revenue:** none; this is what makes the routine *operating* rather than *built*.
**Dependencies:** S0, S1; **C9 human decision before registration**.
**First Concrete Action:** hand the operator the exact non-elevated `schtasks /Create` command for Task A (daily, `-MultipleInstances IgnoreNew`, restart-on-failure = Do not restart, action = pinned 3.11.9 `python.exe` running the entry point with `FREECASH_DATA_ROOT`), then after approval register and manually trigger it twice, quoting (a) one run-log line and (b) `SKIP_DUPLICATE_DAY` on the second same-day trigger.
**Exit:** `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` quoted, plus the duplicate-day refusal.

### S5 — Watchdog / missed-day second detector
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none. **Dependencies:** S4.
**First Concrete Action:** register Task B (23:50 daily) and show the healthy-day path prints `WATCHDOG_OK` with zero alarms; then, in a temp root only, remove the day lock and show exactly one `MISSED_DAY` alarm with the ledger unchanged.
**Exit:** healthy day → 0 alarms; uncovered day → exactly 1 alarm, no state mutation.

### S6 — Notification sink (R3 delivery)
**Expected Effort:** 2–4 h, or blocked. **Time-to-Revenue:** none.
**Dependencies:** S1, S4. **First Concrete Action:** keep the working local sink (append-only `alerts/alerts.jsonl` + `DELIVERY_FAILED` after max 2 attempts / 5 s backoff), run one seeded-change day, and quote the single emitted payload. Any email/webhook sink stays a separate credential-gated step.
**Exit:** one change → one delivered payload; forced delivery failure → `DELIVERY_FAILED` with the full message retained and no scheduler-level retry.

### S7 — Approval surface hardening (R4)
**Expected Effort:** 3–5 h. **Time-to-Revenue:** none.
**Dependencies:** S1. **First Concrete Action:** run the documented CLI decision path against one enqueued item and quote the append-only decision row plus `execution_state` staying `NOT_EXECUTED`, then run the tokenless-write test proving no network write occurs.
**Exit:** a `PENDING` item survives a 90-day clock advance unchanged; every decision is attributable to a human identifier.

### S8 — Deprecation index (delete nothing)
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none — this is false-compliance risk control.
**Dependencies:** none, read-only. **First Concrete Action:** write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` with one row per candidate (`monitoring/freecash/` named as the single implementation to consolidate on; `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `config/freecash-crontab` marked `DEPRECATED — do not cite as compliant`), each row carrying its exact gate command.
**Exit:** index exists; no file moved or deleted.

### S9 — Unblock the revenue path (not the monitor)
**Expected Effort:** unknown; 1–2 h to re-dispatch, longer to prove. **Time-to-Revenue:** the only stage with a direct revenue hypothesis.
**Dependencies:** C9 human decision; a credential in the Hermes vault or `.env` (**never in chat, never in code**); S16-of-V16 evidence (0 credentials).
**First Concrete Action:** re-dispatch the blocked mission (`background_tasks.bgtask-07a8154b0`, `resumable=0` → re-dispatch, not resume) from the app UI and read back its new `status`/`blocker` from `agentic-os.db`; the credential question is a separate, explicit operator decision.
**Exit:** either a new task row with a non-blocked status and a recorded blocker-free stage, or an explicit `BLOCKED` line naming the credential and the ToS clause.

---

## 3. Options (each with Effort / Time-to-Revenue / Dependencies / First Concrete Action)

### Option A — Operate on operator-entered state (fastest to real, lowest risk)
**Expected Effort:** ~2 h (S1–S4). **Time-to-Revenue:** same-day, but bounded by how often the operator enters figures; every snapshot is honestly labelled `degraded: true`, `source=operator_entered`.
**Dependencies:** S1; C9 human approval for Task Scheduler registration; C10 pinned interpreter; C4/R4 human gate for anything beyond notification.
**First Concrete Action:** enter today's record in `operator-state.json`, run the entry point, and quote `RUN_OK … source=operator_entered(data_available=True)`; then hand over the exact `schtasks /Create` command for approval.

### Option B — Read-only in-app status route (`GET /api/finance/freecash/status`)
**Expected Effort:** 6–10 h. **Time-to-Revenue:** indirect (it feeds revenue tracking, produces no cash itself).
**Dependencies:** S1; server running; this route does not exist today (the routine's only default base URL is `http://localhost:3001`); the app must be running for the in-app scheduler, while Task Scheduler is the only 24/7 mechanism on this host.
**First Concrete Action:** implement one GET-only route returning `account_status`/`earnings_total_cents`/`balance_cents`/`pending_cents`, `curl` it, and paste the real JSON into the fixture — never hand-write a fixture.

### Option C — Live provider read
**Expected Effort:** unknown. **Time-to-Revenue:** unquantifiable.
**Dependencies:** provider identity; a documented authenticated read contract; a legal/ToS decision that is not the agent's to make; a credential in the vault/`.env`; C9 decision. **Currently BLOCKED** — no `FREECASH_*` key exists (V8), `provider_credentials` has 0 rows (V16), and no provider endpoint is wired (the plan's own rule C12 forbids inventing one).
**First Concrete Action:** BLOCKED pending the operator decision; the agent-side action is to re-run the research pass and emit the decision packet (per candidate source: URL, scope, read-only provability, ToS sentence, ownership requirement). First measurable signal = the first `degraded: false` snapshot.

### Option D — Unblock the revenue mission inside the app
**Expected Effort:** 1–2 h to re-dispatch; open-ended to verify. **Time-to-Revenue:** highest potential, lowest confidence.
**Dependencies:** S9; app running; credential decision; the supervisor routine only fires while the app is open (V11/V13).
**First Concrete Action:** re-dispatch `bgtask-07a8154b0` and read the new row back from `agentic-os.db`, quoting the resulting status.

### Option E — Consolidate / deprecate the parallel implementations (delete nothing)
**Expected Effort:** 2–4 h. **Time-to-Revenue:** none; prevents a future false-compliance claim.
**Dependencies:** none, read-only. **First Concrete Action:** write `IMPLEMENTATION-INDEX.md` (S8) with one gate command per candidate.

**Recommended order:** S0 → S1 → S2/S3 → S4 → S5/S6 → S7 → S8, with Option D (S9) and Option C pursued in parallel only where a human decision is available. Option A is the only path that yields a genuinely *running* monitor today.

---

## 4. Daily run contract (order is the contract)

1. **R1 gate** — atomic exclusive-create of the day lock on the operator-local day key. Consumed day → `SKIP_DUPLICATE_DAY`, one alert-log line, exit 0, no read, no snapshot, no ledger write.
2. **Attempt ledger** — record the attempt; emit in-band `MISSED_DAY` for uncovered days (never back-filled); an unresolved timezone is `MONITOR_DEGRADED`, never a silent success.
3. **R2 read** — one read-only acquisition through `readonly_client.request` (GET/HEAD, allowlisted paths only).
4. **R3 compare** — load the prior snapshot *before* writing the new one; one line per distinct change on exact integer cents; dedupe key recorded before dispatch; `OK_NO_CHANGE` is log-only; >5 changes coalesce into one summary.
5. **R4 enqueue** — one approval item per notified change, `NOT_EXECUTED`, `expires_at_utc=null`. Enqueueing is a notification with a handle; nothing in the routine acts on an approved status.
6. **No automatic re-run** — `--force-recheck` is accepted only to be refused (exit 3, recorded in `logs/forced-recheck-requests.jsonl`); a failed read (exit 5) deliberately leaves the day lock in place.

Failure vocabulary the operator is told about: `SKIP_DUPLICATE_DAY` (benign) · `MISSED_DAY` (machine asleep / task skipped) · `MONITOR_DEGRADED` (no reading, timezone unresolved, or read failed) · `DELIVERY_FAILED` (channel refused; full message retained; bounded retries; no timer decides anything) · exit 5 (read failed, lock stays).

---

## 5. Acceptance commands (the whole gate, in order)

```bash
cd D:/AgenticOS
python monitoring/freecash/tests/run_all.py                                    # expect failures=0 errors=0, exit 0
python monitoring/freecash/verify_readonly.py                                  # expect forbidden=0, exit 0
bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash      # expect identical counts, exit 0
python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py   # currently R1=FAIL, exit 1 — S0 closes this
schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST                        # only after the C9 human decision
ls -la data/freecash-monitor/{state/day-locks,snapshots,logs,approvals,alerts}  # first production-run evidence
```

---

## 6. Blocked register

| Item | Blocked on | Verified reason |
|---|---|---|
| Live provider read (Option C) | provider identity + authenticated read contract + legal/ToS decision + credential | 0 `provider_credentials` rows (V16); no `FREECASH_*` in env (V8); no session evidence file (V17); C12 forbids inventing an endpoint |
| Email / SMS / webhook notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | none configured (V8); `himalaya` not installed |
| Task Scheduler registration (S4/S5) | explicit human decision (C9) | agent must not register an unattended task; no task exists today (V7) |
| `rule_gate_verify.py` R1 verdict | verifier scope (S0) | single-file scope vs a lock that lives in `gate.py` (V5); R4 detection power unproven (V6) |
| `py -3` as the scheduled interpreter | `tzdata` for 3.14.x | `ZoneInfoNotFoundError`; use the pinned 3.11.9 venv |
| Operator-perceivable toast visibility | a human observing it | unverifiable from tool output |
| Any real earning/withdrawal action | R4 approval surface + human decision | by design: the routine contains no execution path |

---

## 7. Non-goals and untouched surfaces

- No rewrite, move or deletion of the parallel legacy implementations (`finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `config/freecash-crontab`): disable/deprecate in documentation only — the tree is untracked, so a deletion is unrecoverable.
- No live financial write path; R4 exists to keep it that way.
- No compliance claim from `rule_gate_verify.py`, `verify-readonly.sh`, `finance-monitor/.delivery_status.json` or any earlier report — only from a command run and quoted in the session making the claim.
- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations; temp backups before any edit.
- Voice runtimes, Jarvis runtimes and the C8 path list are untouched.
- Secrets: none in code, state or logs; `[REDACTED]` in artifacts; credential collection is an operator action in the vault, never in chat.

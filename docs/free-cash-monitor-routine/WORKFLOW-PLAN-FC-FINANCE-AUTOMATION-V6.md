# WORKFLOW PLAN — Free Cash Finance Automation (V6)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11, git-bash, non-elevated
**Written:** 2026-09-20 ~21:47 operator-local (`date` → `So, 20. Sep 2026 21:41:09`, `Europe/Berlin`)
**Route under plan:** `monitoring/freecash/` (stdlib-only Python; entry point `run_daily_check.py`)
**Evidence standard (C5):** every claim below is a command executed in *this* pass; nothing is quoted from an earlier session.
**Footprint:** this file is new (additive). No existing file was modified, moved, renamed or deleted. No git add/commit/stash/reset/restore was run. `monitoring/freecash/` and `data/freecash-monitor/` are untracked (`??`) — edits there have no git recovery, so changes must be verified by read-back, not by `git diff`.

---

## 0. Live state, verified in this pass (2026-09-20, 21:41–21:47 local / 19:41–19:47Z)

| # | Command (executed) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0` | **GREEN** (offline suite) |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` | **GREEN** |
| V3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` | **GREEN — both R2 checkers agree; baseline pinned at 28** |
| V4 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT` · **exit 1**; R1 fails on `atomic same-day guard` + `day key is a calendar day` ("not found **in the file**") | **RED — open blocker, acceptance gate** |
| V5 | `python --version` / `py -3 --version` | `3.11.9` (Hermes venv) resolves `Europe/Berlin`; `py -3` = `3.14.7` → `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` | only the venv interpreter may drive the daily run |
| V6 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` and `…-Missed-Day-Watchdog` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | **NOT SCHEDULED** |
| V7 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"` | no match | no credential, no external sink |
| V8 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | one manual run, degraded |
| V9 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | **no reading has ever been entered; R3/R4 never exercised on real input** |
| V10 | `wc -l data/freecash-monitor/alerts/alerts.jsonl`; `ls data/freecash-monitor/approvals/` | `2`; empty | only test alarms; no approval item has ever existed |
| V11 | `ls data/freecash-monitor/{snapshots,state/day-locks}`; `ls data/freecash` | `snapshots/2026-09-20.json`; `2026-09-20.lock`; canonical root `data/freecash` **empty** | root divergence still open (V13) |
| V12 | `netstat -ano \| grep -E "3001\|3000"`; `curl -m5 localhost:3001/health` | no listener; `code=000`, connect refused; yet `tasklist` matches **23 lines** of `node.exe` | app-side scheduler dormant — running node processes are *not* serving the AgenticOS API |
| V13 | `grep -n DEFAULT_DATA_ROOT monitoring/freecash/paths.py` | `D:/AgenticOS/data/freecash-monitor` (canonical `data/freecash` unused) | two roots in play |
| V14 | `server/data/agentic-os.db`: `projects` | `proj-free-cash` `active`, priority 1, tags `["revenue","free_cash","p1"]` | project exists |
| V15 | same DB: `schedules` | `schedule-revenue-supervisor-tick` `*/5 * * * *` enabled, `last_triggered_at=2026-09-19T18:05:00Z`; daily/weekly briefings last fired 2026-09-09 / 2026-09-07 | in-app scheduler **dormant since 2026-09-19** |
| V16 | same DB: `schedule_executions` | 2875 rows, max `triggered_at=2026-09-19T18:05:00Z`; `completed 2649`, `dispatch_failed 224`, `execution_failed 1`, `dispatched 1` (7.9 % lossy) | existing scheduler is lossy and stopped |
| V17 | same DB: `provider_credentials` | `0` rows | no provider credential exists |
| V18 | same DB: `background_tasks` where title like `%Free Cash%`/`%Revenue%` | `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" `blocked`, `current_stage=executing_mission`, `resumable=0`, `updated_at=2026-09-19T18:05:18Z`; fleet `blocked 5, queued 7, failed 1, completed 1144` | revenue path stalled at the **execution gate**, not at the monitor |
| V19 | same DB: `background_tasks` result_text | "Revenue Supervisor cycle #749 blocked — Human gate resolved; Shopify publication is not implemented." | supervisor's own last verdict |

**Reading:** the routine's own offline gates are green, its *acceptance* gate (V4) is red, and unattended operation has never occurred (V6, V9, V10). The revenue path is stalled on an external-session prerequisite plus an unimplemented publication step (V18, V19). The already-existing in-app scheduler fires only while the desktop app serves `:3001`, which it does not (V12, V15).

---

## 1. Operational constraints (binding — every stage checked against these)

| ID | Constraint | Enforcement mechanism | Proof demanded at each stage |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` (`O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock`) + 23:50 watchdog as second detector | 2 runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY` (observed in V1's suite) |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py::request` deny-by-default (`GET,HEAD` only, loopback allowlist, no body) + static scanners | both scanners exit 0, exemption count held at **28** |
| **R3** | notify on status/earnings change, exactly once | `changedetect.py::compare` on exact integer cents; `dedupe_key` recorded **before** dispatch | seeded change → exactly one payload; no-change day → `OK_NO_CHANGE`, no dispatch |
| **R4** | human approval before ANY external action; no execution path exists | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decisions need a human `--by` | 90-day clock advance changes nothing; tokenless write raises and performs no network write |
| **C5** | evidence = live tool output; no PASS carried over | every stage ends with a re-executed command quoted verbatim | command + output in the stage's evidence block |
| **C6** | no secrets in code, state, logs, reports | credentials only from env / Hermes vault; `[REDACTED]` everywhere else | log/state grep shows no secret-shaped token |
| **C7** | never disturb unrelated uncommitted work; no destructive git | additive edits only; `git status` before/after; no `reset`/`clean`/`checkout --`/`stash` | tracked-path status identical before/after (531 modified paths exist today — all pre-existing) |
| **C8** | one executable path per job — no new parallel implementation | extend before create; legacy runners disabled, never deleted | the stage names the file it extends |
| **C9** | the acceptance gate must be green **before** any Task Scheduler registration | `scripts/monitoring/rule_gate_verify.py` exit 0 | `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS`, exit 0 |
| **C10** | the interpreter of record is the venv Python 3.11.9 | `py -3` (3.14.7) has no `tzdata` → `ZoneInfoNotFoundError`; a task pointing at it would fail the R1 day-key rule | the task action names `…/hermes-agent/venv/Scripts/python.exe` |

---

## 2. Stages (each: Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action)

**S-1 — Repair the acceptance gate (NEW, first, blocking).**
Expected Effort: 1–2 h. Time-to-Revenue: none (prerequisite). Dependencies: none.
First Concrete Action: extend `scripts/monitoring/rule_gate_verify.py` so R1's two failing checks analyse the **package** (`monitoring/freecash/gate.py`) rather than the single entry file — no change to `monitoring/freecash/`, since the lock genuinely lives in `gate.py` (V4 evidence: "not found *in the file*").
Exit: `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` → `SUMMARY: R1=PASS …`, exit 0, quoted; mutation probe (append a `POST` claim call to a temp copy) still exits 1.

**S0 — Re-confirm the offline gates (no code change).**
Expected Effort: 0.5 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: re-run V1–V3 and quote all three outputs.
Exit: `tests=52 failures=0`, `forbidden=0`, both checkers exit 0 — **observed today (V1–V3)**, and again after S-1.

**S1 — Settle the canonical state root (decision, not code).**
Expected Effort: 0.5 h. Time-to-Revenue: none. Dependencies: S0.
First Concrete Action: pin the root per invocation as `FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash"` in the ops runbook and the task definition instead of editing `paths.py:35`, so nothing shipped changes; label `data/freecash-monitor` legacy-with-history (it holds the only real snapshot and lock, V11).
Exit: one root named canonical, every command in the runbook carries the same explicit `FREECASH_DATA_ROOT`.

**S2 — First real operator reading.**
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day** (visibility only). Dependencies: S1; operator logs into the provider dashboard personally.
First Concrete Action: append one record to `state/operator-state.json` (`day_key`, four integer-cent figures), then `FREECASH_DATA_ROOT=… python monitoring/freecash/run_daily_check.py --source operator_state`; confirm `INITIAL_BASELINE`.
Exit: a day-1 baseline snapshot exists; a day-2 record with a changed figure produces exactly one notification payload.
Limit: every snapshot is `degraded: true` by construction — "no change" only proves the same numbers were typed twice.

**S3 — Choose the read source** (options in §3).
Expected Effort: see §3. Time-to-Revenue: see §3. Dependencies: S0–S1.
First Concrete Action: record one option as authorised, in writing; others deferred/blocked.
Exit: one authorised option with its first concrete action executed.

**S4 — Scheduling (R1 on a real clock).**
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S-1 (**C9**), S2.
First Concrete Action: register a non-elevated Windows Task Scheduler entry, daily at a fixed local time, `-MultipleInstances IgnoreNew`, restart-on-failure disabled, action pinned to `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (**C10**) with `FREECASH_DATA_ROOT` in the task environment; trigger once, confirm one run-log line, trigger again the same day, require `SKIP_DUPLICATE_DAY`.
Exit: `schtasks /Query /TN … /V /FO LIST` quoted + the duplicate-day refusal.
Rejected on this host: `config/freecash-crontab` (no `crontab` in git-bash; targets the legacy `scripts/make_freecash_check.py`), and any `/RL HIGHEST` form (non-elevated host).

**S5 — Watchdog / missed-day detection.**
Expected Effort: 1 h. Time-to-Revenue: none. Dependencies: S4.
First Concrete Action: register the 23:50 companion task; verify a healthy day prints `WATCHDOG_OK` with zero alarms, then delete only the day lock inside a **scratch** root and confirm exactly one `MISSED_DAY` alarm with the ledger unchanged.
Exit: healthy day → 0 alarms; uncovered day → exactly 1 alarm (`coverage=NOTIFIED`, retry `DEDUPED`).

**S6 — Notification delivery (R3 sink).**
Expected Effort: 1–2 h local sink / **BLOCKED** external. Time-to-Revenue: none. Dependencies: S2, S4.
First Concrete Action: seeded-change day with the local sink; quote the single payload and its `dedupe_key`.
Exit: exactly one payload per changed figure; second identical day emits nothing.
Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` keys, mail tooling absent (V7).

**S7 — Approval gate (R4) surfaced to the human.**
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S2 (the queue is unreachable until a change is detected).
First Concrete Action: seed a change that enqueues one item, exercise the documented CLI decision path (`--by` required), confirm the decision lands in `approvals/decided.jsonl` while `execution_state` stays `NOT_EXECUTED`.
Exit: pending item survives a 90-day clock advance unchanged; every decision attributable to a named human.

**S8 — Daily evidence bundle + drift baselines.**
Expected Effort: 1 h. Time-to-Revenue: none. Dependencies: S4–S7.
First Concrete Action: archive per day the run-log line, snapshot hash, `verify_readonly` counts and alerts/approvals line counts; pin `exempt=28` as the eroding-R2 baseline.
Exit: ten consecutive daily bundles whose gate counts match a fresh gate run.

**Ordering discipline:** S-1 → S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8. One change between gate runs. No stage is complete on a claim — only on output produced in the current session. Never widen an allowlist and exempt a scanner hit in the same change.

---

## 3. Read-source options — the only real decision left

**O4 — operator-entered figures (rank 1; available today, no network).**
Expected Effort: 0 h builder (implemented) + 0.5 h operator. Time-to-Revenue: **same day** (human-attested visibility). Dependencies: writable state root (S1), venv interpreter (C10), the operator's own personal login — no credential is given to the routine.
First Concrete Action: append today's four figures to `state/operator-state.json`, then run `run_daily_check.py --source operator_state` (V9 shows `records: []`, so this is genuinely the first reading).
Honest limit: `degraded: true` on every snapshot.

**O1 — loopback read-only metrics endpoint.**
Expected Effort: 3–5 h builder + 0.5 h operator. Time-to-Revenue: 1–2 days, and it reads workstation metrics, not the account. Dependencies: a process serving `GET /api/v1/status/metrics` — **none exists** (V12: port 3001 refused, code 000).
First Concrete Action: with the app serving, `curl -sS -o /dev/null -w 'code=%{http_code}\n' http://localhost:3001/api/v1/status/metrics`; only a JSON body justifies wiring `--source metrics_http`.

**O2 — HG.Cash documented read-only `GET /accounts`.**
Expected Effort: 2–4 h builder **if a KYC-complete account exists**, else an onboarding project (weeks). Time-to-Revenue: 3 days–2 weeks. Dependencies: confirmed account ownership; a user-scoped Bearer token kept outside the repo (no `FREECASH_*`/`HG_CASH_*` key exists, V7); outbound HTTPS; `readonly_client.ALLOWED_PATHS` + host allowlist extension (an R2 change of its own, per §2 ordering rule 3).
First Concrete Action: with the operator's own token exported in that shell only, `curl -sS -o /dev/null -w 'code=%{http_code}\n' -H "Authorization: Bearer ***" https://hg.cash/api/v1/accounts` — record the status code and field names, `[REDACTED]` for values.

**O3 — Cashfree Payouts `GET /payout/v1/getBalance`.**
Expected Effort: 4–8 h builder + a rules decision. Time-to-Revenue: 1–4 weeks (activation queue), unbounded if refused. Dependencies: Payouts API enabled (documented unentitled state `403 "APIs not enabled"`); the token is minted by `POST /payout/v1/authorize` — a verb the transport refuses by construction, so either the token is minted out-of-band daily or **R2 must be amended in writing by the operator** (D-3).
First Concrete Action: `curl -sS -o /dev/null -w 'code=%{http_code}\n' https://payout-api.cashfree.com/payout/v1/getBalance` (expected today: `403`), then check the merchant dashboard for a Payouts-enabled key.

**O5 — live FreeCash account / any authenticated provider session.**
Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: provider identity + documented authenticated read contract + a vault credential + a proven authenticated session.
First Concrete Action: none. Evidence is against it: `provider_credentials` = 0 rows (V17), no `FREECASH_*` key (V7), no session-evidence artefact.
Verdict: **BLOCKED** — keep off the critical path.

---

## 4. Blocked register (nothing here is planned as achievable today)

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | `rule_gate_verify.py` scope repair | R1=FAIL, exit 1 — verifier is single-file scoped while the lock lives in `gate.py` (V4) |
| Live provider/account status | provider identity + authenticated read contract + credential | `provider_credentials` = 0 (V17); no `FREECASH_*` key (V7) |
| Email / SMS / webhook notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | none configured (V7) |
| Any withdrawal/earning action | R4 human approval surface | must never execute unattended; no execution path exists by design |
| In-app (AgenticOS) scheduler as the 24/7 mechanism | the desktop app serving `:3001` | no listener; `code=000`; last tick `2026-09-19T18:05Z`; 7.9 % non-completed history (V12, V15, V16) |
| Revenue Operator mission `bgtask-07a8154b0` | re-dispatch after a lost worker | `blocked`, `resumable=0`, last update 2026-09-19T18:05:18Z (V18) |
| Shopify publication step | implementation | supervisor's own result text: "Shopify publication is not implemented" (V19) |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | non-elevated host by policy |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | canonical state root: `data/freecash` or `data/freecash-monitor` | operator | evidence keeps landing in two places |
| D-2 | authorised read source: O4 / O1 / O2 / O3 / O5 | operator | the routine stays `degraded: true` forever |
| D-3 | R2 amendment for a token-minting POST (O3 only) | operator, in writing | O3 stays unreachable by construction — the safe default |
| D-4 | notification sink: local-only or credential-backed | operator | alerts stay in `alerts/alerts.jsonl` |

---

## 6. Non-goals

No rewrite, move or deletion of the legacy monitors (`scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `finance-monitor/`) — disable and label, never delete. No live financial write path. No compliance claim from a static grep or from any PASS quoted in an earlier session. No modification of the 531 pre-existing uncommitted paths on `hermes-rescue-20260908`. This routine produces **visibility**, not revenue.

## 7. Definition of done

1. Acceptance gate green at exit 0, with the mutation probe still failing (S-1, C9).
2. Offline gate re-run in the same session, output quoted (S0).
3. One canonical root in use by every command and task definition (S1).
4. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S2, S4).
5. One real change detected end-to-end → one notification, one approval item, one human decision, `execution_state` unchanged (S2, S6, S7).
6. Watchdog: healthy day silent; uncovered day exactly one alarm (S5).
7. Both R2 checkers exit 0 at a pinned exemption count (S0, S8).

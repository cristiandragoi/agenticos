# WORKFLOW PLAN — Free Cash Finance Automation (V5, consolidated)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11, git-bash, non-elevated
**Written:** 2026-09-20 ~21:37 local (19:37Z), against **executed** evidence only.
**Routine under plan:** `monitoring/freecash/` (stdlib-only Python; entry point `run_daily_check.py`).
**Delta vs `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` (§7, 21:10):** gate re-run today, no code change; the work now starts at *source decision + scheduling*, not at repair.
**This pass is additive:** one new file created. No existing file modified, moved, deleted or committed; no git write operation performed.

---

## 0. Live state, verified in this session (2026-09-20, 19:33–19:36Z)

| # | Command (executed) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | **GREEN** |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | **GREEN** |
| V3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | **GREEN, both checkers agree** |
| V4 | `python --version` | `Python 3.11.9` (`…/hermes-agent/venv/Scripts/python`) | interpreter that resolves `Europe/Berlin` |
| V5 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` / `…-Missed-Day-Watchdog` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | **NOT SCHEDULED** |
| V6 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"`; `command -v himalaya` | no match; not installed | no config, no external sink |
| V7 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | one manual run, degraded |
| V8 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | **no reading has ever been entered** → R3/R4 never exercised on real input |
| V9 | `ls data/freecash-monitor/{approvals,snapshots,state/day-locks}` | `approvals/` empty; `snapshots/2026-09-20.json`; `day-locks/2026-09-20.lock` present | today's day lock already consumed in the default root |
| V10 | `wc -l data/freecash-monitor/alerts/alerts.jsonl` | `2` | only watchdog test alarms exist |
| V11 | `grep -n "DEFAULT_DATA_ROOT" monitoring/freecash/paths.py` | `paths.py:35 DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`; canonical `data/freecash` exists and is **empty** | root divergence still open |
| V12 | `curl -m5 -o /dev/null -w %{http_code} localhost:3001/health`; `tasklist` | `000`; no `node.exe`, no `electron.exe` | app-side scheduler dormant |
| V13 | `agentic-os.db`: `projects` | `proj-free-cash` `active`, priority 1, tags `["revenue","free_cash","p1"]` | project exists |
| V14 | `agentic-os.db`: `schedules` (3 rows, all `enabled=1`) | `schedule-revenue-supervisor-tick` `*/5 * * * *`, `last_triggered_at=2026-09-19T18:05:00Z`; `recipe-…/daily/weekly` briefings last fired 2026-09-07/09 | in-app scheduler **dormant since 2026-09-19** |
| V15 | `agentic-os.db`: `schedule_executions` | 2875 rows: `completed 2649`, `dispatch_failed 224`, `execution_failed 1`, `dispatched 1` (~7.9% non-completed) | existing scheduler is lossy |
| V16 | `agentic-os.db`: `provider_credentials` | `0` rows | `hasCredentialConfigured('freecash')` is false |
| V17 | `agentic-os.db`: `background_tasks` for `proj-free-cash` | `bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" = `blocked`, `current_stage=executing_mission`, `resumable=0`, `blocker="Backend restarted while this task was in progress. The worker's live state was lost — resume or retry the task to continue."`, `updated_at=2026-09-19T18:05:18Z` | revenue path stalled at the **execution gate**, not at the monitor |
| V18 | `agentic-os.db`: same table | `bgtask-cfed82a34` = `completed`, `result_text="Revenue Supervisor cycle #749 blocked — Human gate resolved; Shopify publication is not implemented."`; fleet: `blocked 5, queued 7, failed 1, completed 1144` | supervisor's own last verdict |

Interpretation: the monitoring routine's own gates are **green and unattended operation has never happened**; the revenue path is stalled on an **external-session prerequisite plus an unimplemented publication step**; the already-existing in-app scheduler only fires while the desktop app runs, and the app is not running (V12).

---

## 1. Operational constraints (binding — every stage below is checked against these)

| ID | Constraint | Enforcement mechanism in the routine | Proof demanded at each stage |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` (`O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock`) + watchdog as second detector | 2 runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY`; 5 concurrent → 1 winner |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py::request` deny-by-default (`GET,HEAD` only, loopback allowlist, no body) + static scanners (`verify_readonly.py`, `verify-readonly.sh`) | transport test + both scanners exit 0 on the shipped tree, with exemption count held at 28 |
| **R3** | notify on status/earnings change, exactly once | `changedetect.py::compare` on exact integer cents; `dedupe_key` recorded **before** dispatch | seeded change → exactly one payload; no-change day → `OK_NO_CHANGE`, no dispatch |
| **R4** | human approval before ANY external action; no execution path exists | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decisions require a human `--by` | tokenless write raises and performs no network write; a 90-day clock advance changes nothing |
| **C5** | evidence = live tool output; no PASS carried over from earlier runs, docs or prior sessions | every stage ends with a re-executed command, quoted verbatim | the command line and its output appear in the stage's evidence block |
| **C6** | no secrets in code, state, logs or reports | credentials only from env / Hermes vault; `[REDACTED]` everywhere else | `git diff` + log grep show no secret-shaped token |
| **C7** | never disturb unrelated uncommitted work; no destructive git | additive edits only; `git status` before/after; no `reset`, `clean`, `checkout --`, `stash` | before/after `git status --short` diff of tracked paths unchanged |
| **C8** | one executable path per job — no new parallel implementation | audit-and-extend before create; legacy runners disabled, never deleted | the stage names the file it extends |

---

## 2. Stages (each stage: Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action · Exit)

### S0 — Re-confirm the gate is green (no code change)
Expected Effort: 0.5 h. Time-to-Revenue: none (prerequisite). Dependencies: none.
First Concrete Action: `python monitoring/freecash/tests/run_all.py` then `python monitoring/freecash/verify_readonly.py` and `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash`; quote all three outputs.
Exit: `tests=52 failures=0 errors=0`, `forbidden=0`, both checkers exit 0 — **observed in this session (V1–V3)**.

### S1 — Settle the canonical state root (decision, not code)
Expected Effort: 0.5 h. Time-to-Revenue: none. Dependencies: S0.
First Concrete Action: record the decision in this file's §6 and pin it per invocation as `FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash"` (the canonical path in the dispatch) instead of editing `paths.py:35`, so nothing in the shipped routine changes.
Exit: one root is named canonical, the other is labelled legacy, and every command in the ops runbook carries the same explicit `FREECASH_DATA_ROOT`.

### S2 — First real operator reading (makes the routine meaningful)
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day** (visibility only). Dependencies: S1; operator logs into the provider dashboard personally.
First Concrete Action: append one record to `state/operator-state.json` (`day_key`, four figures in integer cents), then `FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash" python monitoring/freecash/run_daily_check.py --source operator_state`; confirm `INITIAL_BASELINE` and a snapshot stamped `degraded: true`.
Exit: a day-1 baseline snapshot exists; day-2 reading with a changed figure produces exactly one notification payload.
Constraint note: every snapshot from this source is `degraded: true` by construction (`changedetect.build_snapshot()`); it attests what the operator saw, not what the provider said.

### S3 — Choose the read source (options in §3)
Expected Effort: see §3. Time-to-Revenue: see §3. Dependencies: S0–S1.
First Concrete Action: pick one option from §3, in writing, and execute that option's first concrete action.
Exit: one option is recorded as authorised; the others are recorded as deferred/blocked.

### S4 — Scheduling (R1 on a real clock)
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S2 (a run that is worth scheduling) or S3.
First Concrete Action: register a **non-elevated** Windows Task Scheduler entry, daily at a fixed local time, `-MultipleInstances IgnoreNew`, restart-on-failure **disabled**, pinned to `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe`, with `FREECASH_DATA_ROOT` set in the task environment; then trigger it manually and confirm one run-log line, then trigger again the same day and require `SKIP_DUPLICATE_DAY`.
Exit: `schtasks /Query /TN … /V /FO LIST` output quoted, plus the duplicate-day refusal evidence.
Rejected on this host: `config/freecash-crontab` (no `crontab` in git-bash; the file targets `scripts/make_freecash_check.py`, a known silent-exit-0 artefact) and any `/RL HIGHEST` task form (non-elevated host).

### S5 — Watchdog / missed-day detection
Expected Effort: 1 h. Time-to-Revenue: none. Dependencies: S4.
First Concrete Action: register the 23:50 companion task; verify the healthy-day path prints `WATCHDOG_OK` with zero alarms, then delete **only** the day lock inside a scratch root and confirm exactly one `MISSED_DAY` alarm with the ledger unchanged.
Exit: healthy day → 0 alarms; uncovered day → exactly 1 alarm (`coverage=NOTIFIED`, second attempt `DEDUPED`).

### S6 — Notification delivery (R3 sink)
Expected Effort: 1–2 h (local sink) / BLOCKED (external). Time-to-Revenue: none. Dependencies: S2, S4.
First Concrete Action: seeded-change day with the local sink; quote the single emitted payload and the `dedupe_key`.
Exit: exactly one payload per changed figure; second identical day emits nothing.
Blocked: email/webhook/SMS — no `SMTP_*`/`WEBHOOK_*` keys, `himalaya` not installed (V6).

### S7 — Approval gate (R4) surfaced to the human
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S2 (the queue is unreachable until a change is detected).
First Concrete Action: seed a change that enqueues one item, then exercise the documented CLI decision path (`--by` required) and confirm the decision lands in `approvals/decided.jsonl` while `execution_state` stays `NOT_EXECUTED`.
Exit: pending item survives a 90-day clock advance unchanged; every decision attributable to a named human; tokenless write raises and performs no network write.

### S8 — One-page daily evidence bundle + drift baselines
Expected Effort: 1 h. Time-to-Revenue: none. Dependencies: S4–S7.
First Concrete Action: archive, per day: run-log line, snapshot hash, `verify_readonly` counts, alerts/approvals line counts — and pin `exempt=28` as the drift baseline (any later rise means R2 is eroding).
Exit: ten consecutive daily bundles exist; the gate counts in the bundle match a fresh gate run.

---

## 3. Read-source options (the only real decision left) — required fields each

**O4 — operator-entered figures (rank 1, available today, no network)**
Expected Effort: 0 h builder (implemented) + 0.5 h operator. Time-to-Revenue: **same day** (visibility the operator already has, human-attested).
Dependencies: writable state root (S1); the venv interpreter; the operator's own personal login. No credential is given to the routine.
First Concrete Action: append today's four figures to `state/operator-state.json`, then run `run_daily_check.py --source operator_state`.
Honest limit: `degraded: true` on every snapshot — "no change" proves only that the same numbers were typed twice.

**O1 — loopback read-only metrics endpoint (`GET /api/v1/status/metrics`)**
Expected Effort: 3–5 h builder + 0.5 h operator. Time-to-Revenue: 1–2 days (and it reads **workstation metrics**, not the account).
Dependencies: a process serving that route (**none exists** — verified: `curl localhost:3001/health` → `000`, V12); app running; the root decision.
First Concrete Action: `curl -sS -o /dev/null -w 'code=%{http_code}\n' http://localhost:3001/api/v1/status/metrics` while the app is up; only if it serves JSON does the builder wire `--source metrics_http`.
Note: does not close the visibility gap by itself.

**O2 — HG.Cash documented read-only `GET /accounts`**
Expected Effort: 2–4 h builder **if an account exists**, else an operator onboarding project (weeks). Time-to-Revenue: 3 days–2 weeks with an existing KYC-complete account.
Dependencies: written confirmation of account ownership; user-scoped Bearer token in `%LOCALAPPDATA%\hermes\.env` (no `HG_CASH_*`/`FREECASH_*` name exists today, V6); outbound HTTPS; `readonly_client.ALLOWED_PATHS` + host allowlist extension.
First Concrete Action: with **the operator's own** token exported in that shell only, `curl -sS -o /dev/null -w 'code=%{http_code}\n' -H "Authorization: Bearer ***" https://hg.cash/api/v1/accounts`; record status code and field names, `[REDACTED]` for values. Unauthenticated today → `401`.

**O3 — Cashfree Payouts `GET /payout/v1/getBalance`**
Expected Effort: 4–8 h builder + a rules decision. Time-to-Revenue: 1–4 weeks (activation queue), unbounded if refused.
Dependencies: Payouts API enabled (documented unentitled state `403 "APIs not enabled"`); token minted by `POST /payout/v1/authorize` — a verb the transport refuses by construction, so either the token is minted out-of-band daily or **R2 must be amended in writing by the operator**.
First Concrete Action: `curl -sS -o /dev/null -w 'code=%{http_code}\n' https://payout-api.cashfree.com/payout/v1/getBalance` → today `403` (generic edge page, not the documented JSON); then check the merchant dashboard for a Payouts-enabled key.

**O5 — live FreeCash account / any authenticated provider session**
Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: provider identity + documented authenticated read contract + a credential in the Hermes vault, plus a proven authenticated browser session.
First Concrete Action: none until the provider contract and credential exist — evidence is against it: `provider_credentials` = 0 rows (V16), no session-evidence file, no `FREECASH_*` key (V6), default base URL is `http://localhost:3001` (`readonly_client.py:54`), and approval items literally carry `PROVIDER_ENDPOINT_UNKNOWN`.
Verdict: keep off the critical path; BLOCKED.

---

## 4. Critical path and ordering discipline

S0 (verify) → S1 (root decision) → S2 (first real reading) → S3 (source decision) → S4 (schedule) → S5 (watchdog) → S6 (sink) → S7 (approval surface) → S8 (evidence bundle).

Ordering rules:
1. **One change between gate runs**, so any red→green delta is attributable to that change.
2. No stage is reported complete on a claim — only on the command output it produced in the current session.
3. Never widen an allowlist and exempt a scanner hit in the same change; each gets its own gate run.
4. R2 exemptions are a counted budget (`exempt=28`); the baseline may only be re-pinned deliberately, with the reason recorded.

---

## 5. Blocked register (nothing here is planned as achievable today)

| Item | Blocked on | Reason (verified in this session) |
|---|---|---|
| Live provider/account status | provider identity + authenticated read contract + credential | `provider_credentials` = 0 (V16); no `FREECASH_*` key (V6); approval payload carries `PROVIDER_ENDPOINT_UNKNOWN` |
| Email / SMS / webhook notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | none configured; `himalaya` absent (V6) |
| Any withdrawal/earning action | R4 human approval surface | must never execute unattended; no execution path exists by design |
| In-app (AgenticOS) scheduler as the 24/7 mechanism | the desktop app being open | `localhost:3001/health` → `000`; no `node.exe`/`electron.exe`; last tick `2026-09-19T18:05Z` (V12, V14) |
| Revenue Operator mission `bgtask-07a8154b0` | re-dispatch after a lost worker | `blocked`, `resumable=0`, blocker = backend restart lost the worker's live state (V17) |
| Shopify publication step | implementation | `bgtask-cfed82a34.result_text` = "Shopify publication is not implemented" (V18) |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | non-elevated host by policy |

---

## 6. Decision record this plan asks for (the plan's actual deliverable)

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | canonical state root: `data/freecash` or `data/freecash-monitor` | operator | two roots keep diverging; evidence lands in two places |
| D-2 | authorised read source: O4 / O1 / O2 / O3 / O5 | operator | the routine stays `degraded: true` forever |
| D-3 | R2 amendment for a token-minting POST (only relevant to O3) | operator, in writing | O3 stays unreachable by construction — which is the safe default |
| D-4 | notification sink: local-only or credential-backed | operator | alerts stay in `alerts/alerts.jsonl` |

---

## 7. Non-goals

- No rewrite, move or deletion of the parallel legacy monitors (`scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `finance-monitor/`): disable and label, never delete.
- No live financial write path; R4 exists to keep it that way.
- No compliance claim from `verify-freecash-rules.mjs` (static grep, two tautological assertions) or from any PASS quoted in an earlier session.
- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations.
- This routine produces **visibility**, not revenue. Nothing in §2–§3 changes that.

---

## 8. Definition of done

1. Gate re-run in the current session, output quoted (S0) — **satisfied today**.
2. One canonical root in use by every command and task definition (S1).
3. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S2, S4).
4. At least one real change detected end-to-end → one notification, one approval item, one human decision, `execution_state` unchanged (S2, S6, S7).
5. Watchdog: healthy day silent, uncovered day exactly one alarm (S5).
6. Both R2 checkers exit 0 with a pinned exemption count and no unexempted hit (S0, S8).

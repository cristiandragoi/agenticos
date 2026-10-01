# Free Cash Finance Automation — Workflow Plan (grounded re-verification, 2026-09-20 21:31 local)

Repository: `D:\AgenticOS`  ·  Branch: `hermes-rescue-20260908`
Canonical routine: `monitoring/freecash/` (untracked work — preserve, never reset)
Additive only: this file is new. No existing file was modified, moved, renamed or deleted. No git operation was performed.

Evidence rule for this plan: every claim below is a command executed in this session (2026-09-20, 21:2x–21:3x local, `python` = 3.11.9 Hermes venv). Nothing is carried over from an earlier plan or PASS report. `pytest` is NOT installed on this host; `monitoring/freecash/tests/run_all.py` is the only working test entry point.

---

## 0. Verified live state

| # | Command (executed) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` | `SKIP_DUPLICATE_DAY 2026-09-20` · `RUN_OK … outcome=INITIAL_BASELINE … changes=0 notifications=0 approvals=0` · `WATCHDOG_OK` · `WATCHDOG_MISSED_DAY … coverage=NOTIFIED` / `DEDUPED` · `run_all: tests=52 failures=0 errors=0 skipped=0` · exit 0 | **GREEN** — 52/52 offline tests pass |
| V2 | `python monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | **GREEN** (R2 static) |
| V3 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | identical `forbidden=0 exempt=28` · `PASS` · exit 0 | **GREEN, both checkers agree** |
| V4 | Negative control: checker run against a temp tree containing `requests.post("…/api/v1/withdraw")` | `forbidden=4` · `FAIL` · exit 1 (both checkers) | checker is **discriminating**, not a rubber stamp |
| V5 | Positive control: checker against a clean temp tree with one `requests.get` | `forbidden=0 exempt=0` · `PASS` · exit 0 | no false failure on clean input |
| V6 | `schtasks /Query /TN "FreeCash-Daily-Monitor"` and `…-Missed-Day-Watchdog"` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | **NOT SCHEDULED** — the routine has never run on a timer |
| V7 | `data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | routine has run **once, manually, degraded** |
| V8 | `data/freecash-monitor/state/operator-state.json` | `records=0` (template present) | **no operator reading has ever been entered** |
| V9 | `data/freecash-monitor/alerts/alerts.jsonl` (2 records) + `approvals/` | `MONITOR_DEGRADED` ("no data for 2026-09-20") and `SKIP_DUPLICATE_DAY`; `approvals/` empty | R3 has only ever emitted no-data/skip events; **R4 queue has never been populated** |
| V10 | mtimes of `data/freecash-monitor/**` before/after V1 | unchanged (`21:08`, earlier than the suite run) | the test suite runs in a temp root — **it does not pollute live state** |
| V11 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"`, `command -v himalaya` | no match; not installed | external sinks **BLOCKED** |
| V12 | `grep -n DEFAULT_DATA_ROOT monitoring/freecash/paths.py` | `35: DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`; `data/freecash/` exists but is empty | **state-root divergence** persists (docs still cite `data/freecash/`) |
| V13 | `python scripts/monitoring/rule_gate_verify.py <target>` on 6 legacy candidates (`server/scripts/freecash-daily-monitor.mjs`, `scripts/monitoring/free-cash-daily-check.py`, `scripts/finance_monitor.py`, `finance-monitor/src/{orchestrator,rule_engine,wait_gate}.py`) | every target: `R1=FAIL R2=FAIL R3=FAIL R4=FAIL`, exit 1 | legacy/parallel implementations are **all non-compliant**; do not wire them |
| V14 | `node server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` (TypeScript annotation in `.mjs`) | that monitor **cannot execute** |
| V15 | `node server/scripts/verify-freecash-rules.mjs` | `4/4 passed`, exit 0 — against the file that fails to parse in V14 | `verify-freecash-rules.mjs` is a **static-grep rubber stamp**; it certifies non-running code and must not gate anything |
| V16 | `date` | `So, 20. Sep 2026 21:30:53` (CEST, UTC+02) | day-key basis for R1 |

Interpretation: exactly one implementation is worth working on — `monitoring/freecash/`. Its own gates are green and proven discriminating (V1–V5). What is missing is **input, scheduling and delivery**: the routine has never run unattended (V6), has never seen a real reading (V8), and therefore has never exercised R3 change detection or R4 approvals on real data (V9).

---

## 1. Constraint set (non-negotiable, frozen)

| ID | Rule | Mechanism that makes violation unreachable | Proof already available |
|---|---|---|---|
| R1 | exactly one status read per operator-local calendar day | `monitoring/freecash/gate.py::acquire_day_lock` — `O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock` | V1 `SKIP_DUPLICATE_DAY` after `RUN_OK` |
| R2 | no earning/withdrawal action; read-only transport | `readonly_client.py::request` deny-by-default `{GET,HEAD}`, no body/files; `verify_readonly.py` static scan | V2–V5 |
| R3 | notify on status/earnings change, exactly once | `changedetect.py::compare` (integer cents) + `dedupe_key` written before dispatch | V1 R3 tests; not yet exercised on real input |
| R4 | human approval before any external write; no execution path in the routine | `approval_queue.py` — `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, decision requires human `--by` | V1 R4 tests; queue never populated (V9) |

Inherited workspace constraints (also binding on this plan): no secrets in code, state or logs (`[REDACTED]`, vault or env only); no modification, reset or deletion of unrelated uncommitted work; no destructive git operations; PASS only from output quoted in the current session; one change per gate run so deltas stay attributable.

---

## 2. Stages — each with Effort / Time-to-Revenue / Dependencies / First Concrete Action

Effort figures are estimates, not measurements. "Time-to-Revenue" = time until this stage can affect money. For a read-only monitor that number is honestly "none — enabling" for every stage; it is stated per stage rather than inflated.

### S1 — Give the routine a real reading (operator-entered source, R3's missing input) — **critical path start**
Expected Effort: 1–2 h (mostly the documented 4-figure daily entry step).
Time-to-Revenue: none; shortest path to a routine that genuinely runs end to end.
Dependencies: none (V1 gate already green).
First Concrete Action: add one record to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json` following its own `template_record`/`how_to`, then re-run `python monitoring/freecash/tests/run_all.py` and confirm the live path produces a non-degraded snapshot — `grep MONITOR_DEGRADED data/freecash-monitor/alerts/alerts.jsonl | wc -l` must stop growing.
Exit: two consecutive days with a real reading; day 2 produces a real change comparison, not `INITIAL_BASELINE`.

### S2 — Prove R3 change detection on real input
Expected Effort: 2–3 h.
Time-to-Revenue: none (produces the signal that later protects earnings).
Dependencies: S1; a second day-key (either a real next day or a documented date-shift in a copy root — never by editing live state files).
First Concrete Action: run day 2 with one figure changed, then quote `alerts/alerts.jsonl`: exactly one `CHANGE_DETECTED` record, then re-run the same day and quote `SKIP_DUPLICATE_DAY` with no second notification.
Exit: one change → exactly one notification; no-change day → `OK_NO_CHANGE`, zero dispatches.

### S3 — Exercise R4 end to end (queue → human decision → no execution)
Expected Effort: 3–5 h.
Time-to-Revenue: none (it is the control that keeps the whole routine from touching money).
Dependencies: S1.
First Concrete Action: against one enqueued item, run the documented CLI decision path with `--by <human id>` and show the decision landing in `approvals/decided.jsonl` while `execution_state` remains `NOT_EXECUTED`; then run the tokenless-write test proving no network write occurs.
Exit: pending item unchanged after a 90-day clock advance; every decision attributable to a human identifier.

### S4 — Register the timer (R1 on a real clock)
Expected Effort: 2–3 h.
Time-to-Revenue: none; without it nothing runs at all.
Dependencies: S1–S3; Task Scheduler (no `crontab` in git-bash).
First Concrete Action: register Task A (`FreeCash-Daily-Monitor`, 08:35 daily, `-MultipleInstances IgnoreNew`, restart-on-failure = Do not restart) pinned to the venv interpreter `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (the `py -3` launcher is 3.14.x without `tzdata`), trigger it manually, then quote `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` plus one run-log line and a same-day second trigger producing `SKIP_DUPLICATE_DAY`.
Exit: quoted task definition; manual run creates exactly one day lock + one log line.

### S5 — Missed-day watchdog
Expected Effort: 1–2 h.
Time-to-Revenue: none (R1's second detector).
Dependencies: S4.
First Concrete Action: register Task B (`FreeCash-Missed-Day-Watchdog`, 23:50 daily) and confirm a healthy day prints `WATCHDOG_OK` with no alarm; then, in a **temp root only**, remove the day lock and confirm exactly one `MISSED_DAY` alarm.
Exit: healthy day → 0 alarms; uncovered day → exactly 1 alarm, ledger unchanged.

### S6 — Notification sink (R3 delivery)
Expected Effort: 2–4 h, or blocked for external sinks.
Time-to-Revenue: none.
Dependencies: S2.
Options: (i) append-only `alerts/alerts.jsonl` + local toast — works today, testable; (ii) log/file sink asserted in the test suite — works today; (iii) email/webhook — **BLOCKED** (V11: no `SMTP_*`/`WEBHOOK_*`, `himalaya` absent; credentials belong in the vault, never in chat or code).
First Concrete Action: run one seeded-change day with the local sink and quote the single emitted payload; keep any external sink as a separate credential-gated step.
Exit: one payload per change, no repeat on a duplicate run.

### S7 — Choose/confirm the read source beyond operator entry (three options)
**S7a — operator-entered figures (in use from S1).** Effort already covered by S1; dependencies none; first action: the S1 record. This is the only source available today.
**S7b — in-repo read-only route** `GET /api/finance/freecash/status` over existing AgenticOS server data. Expected Effort: 6–10 h. Time-to-Revenue: indirect (feeds revenue tracking). Dependencies: S1–S4, server running, DB schema. First Concrete Action: one GET-only route returning the four fields, `curl` it, and paste the real JSON in as the fixture — no hand-invented fixture.
**S7c — live provider account.** **BLOCKED.** Dependencies: provider identity, its documented authenticated read contract, and a credential stored in the vault/`.env` (never in chat). First Concrete Action: a single read-only authenticated GET probe, executed only after the contract is documented. Evidence against starting now: no `FREECASH_*` key on the host (V11), `readonly_client.py` default base URL is `http://localhost:3001`, approval items still carry the literal `PROVIDER_ENDPOINT_UNKNOWN`, and `provider_credentials` has 0 rows. Keep it off the critical path.
Exit for S7: whichever source is chosen has a captured, quoted live response or a quoted operator record; the routine never contacts a platform it has no documented contract for.

### S8 — Reconcile state root and freeze superseded docs
Expected Effort: 1–2 h.
Time-to-Revenue: none.
Dependencies: S1–S7.
First Concrete Action: align `paths.py` default (`D:/AgenticOS/data/freecash-monitor`, V12) with the documented canonical root — or document `FREECASH_DATA_ROOT` in the task definition — then add one-line `SUPERSEDED — see <canonical spec>` headers to the older design docs. Headers only; no rewrites, no deletions; legacy runners stay on disk (disable, never delete).
Exit: one documented root; the pre-flight checklist §1 reflects it.

---

## 3. Critical path

S1 → S2 → S3 → S4 → S5 → S6 → S7(a/b) → S8.

S1 is the true blocker: with `records=0` (V8) the routine can only ever emit `MONITOR_DEGRADED`, so R3 and R4 cannot be proven on real data until a reading exists. The gate work that earlier plans started at is already done (V1–V5). S7c stays off the critical path and BLOCKED.

Sequencing discipline: exactly one change between gate runs; after every stage, re-run `python monitoring/freecash/tests/run_all.py` **and** both R2 checkers, and quote the new totals. Never accept the legacy node verifier (V15) as evidence.

---

## 4. Blocked register

| Item | Blocked on | Verified reason |
|---|---|---|
| Live provider reads | provider identity + documented authenticated read contract + credential (vault/env) | no `FREECASH_*` on host (V11); default base URL `http://localhost:3001`; `PROVIDER_ENDPOINT_UNKNOWN` literals in approval items; `provider_credentials` = 0 rows |
| Email / SMS / webhook delivery | `SMTP_*` / `WEBHOOK_*` credentials or mail tooling | none configured; `himalaya` not installed (V11) |
| Any real withdrawal/earning action | R4 approval surface (S3) | no execution path exists by design; it must never execute unattended |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | host is non-elevated by policy; plan uses a non-elevated-compatible task form |

---

## 5. Files likely to be touched (all additive or single-line)

- Modify (one record): `data/freecash-monitor/state/operator-state.json`
- Created by the routine: `data/freecash-monitor/{snapshots,logs,approvals,alerts}/**`
- Modify (one line, S8): `monitoring/freecash/paths.py:35`
- Task definitions registered outside the repo (Task Scheduler), documented in the plan output
- Headers only (S8): older design docs under `docs/`, `.hermes/plans/`, root `free-cash-*.md`

## 6. Non-goals

- No rewrite, move or deletion of the parallel legacy implementations (`server/scripts/freecash-daily-monitor.mjs`, `scripts/monitoring/free-cash-daily-check.py`, `scripts/finance_monitor.py`, `finance-monitor/`) — disable, document as superseded, never delete.
- No live financial write path is introduced.
- No compliance claim from `verify-freecash-rules.mjs` or any earlier PASS report (V15 shows it certifies non-parsing code); only from a command run and quoted in the current session.
- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations; no secrets in any file, log or chat.

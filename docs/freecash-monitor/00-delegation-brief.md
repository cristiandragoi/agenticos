# Free Cash Finance Automation — Daily Status Monitoring: Delegation Brief

Repository: D:\AgenticOS
Date of recon: 2026-10-01 (Europe/Berlin)
Status of this document: master index for the delegated design work. Deliverables 01–03 are written by three parallel Hermes subagents (delegation id `deleg_1b3c55be`) and must be verified against live files before acceptance.

## 1. The four operational rules (verbatim, non-negotiable)

| Rule | Statement |
|---|---|
| R1 | No earning action automatically. The monitor never transacts, withdraws, cashes out, or spends. |
| R2 | Check status once per day. Exactly one calendar day key per day; a duplicate run consumes nothing. |
| R3 | Notify only if earnings or account status CHANGED. No change -> no notification. |
| R4 | Human approval before ANY external action. The monitor may only queue a request. |

## 2. Live ground truth (recon evidence, 2026-10-01)

Checked with terminal + read_file against D:\AgenticOS.

| Item | Finding | Evidence |
|---|---|---|
| Canonical implementation | `monitoring/freecash/` package (run_daily_check.py, gate.py, changedetect.py, notify.py, approval_queue.py, operator_state.py, readonly_client.py, paths.py, watchdog.py, verify_readonly.py) | `ls -la monitoring/freecash` |
| Test suite | test_r1_gate, test_r2_readonly, test_r3_changedetect, test_r4_approval, test_r5_smoke, run_all.py | `ls -la monitoring/freecash/tests` |
| Decoy #1 (does not parse) | `server/scripts/freecash-daily-monitor.mjs` fails `node --check` at line 41 (`function isDailyCheckAllowed(): boolean {`) — TS annotation in a .mjs. Never executed. | `node --check` output: `SyntaxError: Unexpected token ':'` |
| Decoy #2 (string-grep verifier) | `server/scripts/verify-freecash-rules.mjs` exits 0 printing "4/4 PASSED" but is a static grep over source with tautological assertions. Evidence of nothing. | file exists; assertions reviewed |
| Stub overlaps | `scripts/monitoring/free-cash-daily-check.py`, `server/tasks/daily-finance-monitor.py`, `scripts/make_freecash_check.py`, `finance-monitor/src/rule_engine.py` | `ls -la` on each |
| Today already burned | `state/day-locks/2026-10-01.lock` exists; snapshot 2026-10-01 written with NULL fields; `last_outcome = MONITOR_DEGRADED`; `last_success_day = 2026-10-01` (a "success" with no reading) | `state/last-run.json`, `alerts/alerts.jsonl` |
| Root cause | `run_daily_check.py` acquires the day lock at :308-309 but reads the source at :372 — lock-before-read. A run on a day with no reading permanently consumes that day. | `grep -n` on run_daily_check.py |
| Last real operator reading | `state/operator-state.json` last modified 2026-09-20 — 11 days with no human reading | `find state -printf` |
| Approval queue | `data/freecash-monitor/approvals/` is EMPTY. No approval has ever been queued. | `ls -la approvals` |
| Alert log | `alerts/alerts.jsonl`, 15 lines; last two: SKIP_DUPLICATE_DAY (2026-09-30), MONITOR_DEGRADED (2026-10-01) | `tail -2 alerts/alerts.jsonl` |
| Scheduler | NONE. `crontab -l` empty; Windows Task Scheduler has no freecash/monitor task. The routine only runs when a human invokes it. | `schtasks /query` |
| Notification channel | NONE bound. No ALERT/NOTIFY/WEBHOOK/SMTP/FREECASH keys in server/.env or .env | `grep` on .env files |
| Real data source | Not a provider API. `monitoring/freecash/operator_state.py` reads a human-entered file. The monitor never contacts the platform. | operator-state.json `note` field |

## 3. Options considered for the routine (each with effort / revenue / dependencies / first action)

Because the monitor is read-only by construction, "Time-to-Revenue" below means time until the routine is delivering its business value (visibility + audit-ready status), not time until money moves — R1 forbids that.

### Option A — Harden the existing `monitoring/freecash/` package (RECOMMENDED)
- Expected Effort: 1–2 days. Fix lock-before-read ordering, add pre-flight refusal wrapper, replace the decoy verifier with a falsifiable one.
- Time-to-Revenue: Immediate. The routine already writes real day-keyed artifacts; it needs ordering fixed and a scheduler.
- Dependencies: existing package; a Python interpreter with `tzdata`; a Windows Task Scheduler entry.
- First Concrete Action: pin `FREECASH_DATA_ROOT` to a throwaway dir and run `python monitoring/freecash/tests/run_all.py` to establish a real baseline (report failures verbatim).

### Option B — Wire a real provider API (HG.Cash / Cashfree / FreeCash.io) as the read-only source
- Expected Effort: 3–5 days, unknown-unknowns heavy.
- Time-to-Revenue: Slow. The endpoint table in the skill's `references/api-compliance.md` cites no live response and no credentials are configured.
- Dependencies: provider accounts, auth scheme, token lease, rate limits — all currently UNVERIFIED.
- First Concrete Action: settle one auth question with one manual, human-driven, read-only request outside the monitor; document the response before writing any client code.

### Option C — Scheduler-only (cron/Task Scheduler wrapping today's script, no fixes)
- Expected Effort: ~1 hour.
- Time-to-Revenue: Negative. Would automate burning day locks on days with no reading (rule R2 violated in effect, R3 never fires).
- Dependencies: none.
- First Concrete Action: do not do this before Option A's ordering fix.

## 4. Delegated deliverables

| File | Owner | Scope |
|---|---|---|
| `01-daily-routine-workflow.md` | subagent sa-0-474a16f3 | Ordered daily step list, human-vs-machine split, scheduler design, degraded mode, recovery for burned days |
| `02-provider-research-plan.md` | subagent sa-1-d6a449a9 | Research plan: live data source, offline-answerable questions, provider unknowns, sandbox-isolation protocol |
| `03-rule-verification-and-approval-gate.md` | subagent sa-2-c8233f94 | Rule->artifact map, falsifiable verifier design, R4 allowlist hardening, R3 notification contract, R2 day contract |

## 5. Acceptance criteria for these deliverables

1. Every mechanism claimed must cite `file:line` or a live command output; unverifiable items marked UNVERIFIED or BLOCKED.
2. The verifier design must be shown to FAIL on a known violation; "PASSED" alone is not acceptance.
3. No source file modified; no day lock created; no snapshot written to the real data root.
4. Each deliverable must state, per option: Expected Effort, Time-to-Revenue, Dependencies, First Concrete Action.

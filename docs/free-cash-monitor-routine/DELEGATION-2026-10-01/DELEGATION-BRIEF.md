# Delegation Brief — Free Cash Finance Automation, Daily Status Monitoring Routine

Date: 2026-10-01 (Europe/Berlin)
Repository: D:\AgenticOS
Delegation id: deleg_fec45ca6
Supersedes: DELEGATION-2026-09-30 (brief + scheduler/datasource/verifier/delivery tracks)

## Objective

Design — not execute — a once-per-day, read-only status monitoring routine for Free Cash
Finance Automation, satisfying four operational rules end to end, with every claim backed by
the raw output of a command that was actually run.

## The four operational rules

| Id | Rule | Meaning in this routine |
|----|------|-------------------------|
| R1 | Once-per-day check | At most one status check per Europe/Berlin calendar day. Day-key must be DST-safe. A second same-day invocation must no-op without consuming the lock and without alerting. |
| R2 | Zero automated earning actions | No click/claim/withdraw/transact. Read-only HTTP verbs and path allowlist only, enforced in code plus a CI grep for forbidden write tokens. |
| R3 | Notify on earnings/status changes | A notification fires when balance / earnings / account status differ from the previous snapshot. No change => one coalesced "status OK" or silence. No duplicate alerts for the same change. |
| R4 | Human approval before any external action | Anything that is not a read becomes an approval request in a queue. The queue is never auto-drained and never "expires" into execution. |

## Verified live state at dispatch time (raw command output, not inference)

| Fact | Command | Observed |
|------|---------|----------|
| Canonical package exists | `ls -la monitoring/freecash` | `run_daily_check.py`, `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `readonly_client.py`, `watchdog.py`, `verify_readonly.py`, `paths.py`, `operator_state.py`, `tests/` |
| Day-locks only for two days | `ls data/freecash-monitor/state/day-locks` | `2026-09-20.lock`, `2026-09-30.lock` |
| Snapshots only for those days | `ls data/freecash-monitor/snapshots` | `2026-09-20.json`, `2026-09-30.json` |
| Approval queue is empty | `ls data/freecash-monitor/approvals` | (empty) — no pending external actions |
| Routine is NOT scheduled | `schtasks /query /fo LIST \| grep -i freecash` | no output — no matching task registered |
| Configured cron target is broken | `cat config/freecash-crontab` | points at `scripts/make_freecash_check.py`, a known stub with a silent exit 0 |
| tzdata-capable interpreter | `python -c "import zoneinfo; print(zoneinfo.ZoneInfo('Europe/Berlin'))"` | `Europe/Berlin` on Python 3.11.9 at `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` |
| Repo has uncommitted work elsewhere | `git status --short` | many modified files under `electron/` and `server/src/domains/` — unrelated to this track; children must not add to it |

Consequence: the routine has missed the day it was supposed to run today (2026-10-01), and the
absence of a registered task — not the monitor logic — is the reason most days were missed.

## Known-bad implementations (must not be used as the basis of the design)

| Path | Failure mode |
|------|--------------|
| `server/scripts/freecash-daily-monitor.mjs` | fails `node --check` (TS annotation + `require()` in a `.mjs`); has never executed |
| `server/scripts/verify-freecash-rules.mjs` | static string-grep; two of four assertions are tautologies and always pass |
| `scripts/monitoring/free-cash-daily-check.py` | defines `main()`, never calls it; exit 0 with no output and no artifacts |
| `scripts/make_freecash_check.py` | `parents[2]` off-by-one resolves the data dir to `D:\data\freecash`; prints an error then "No actions available." with exit 0 |
| `finance-monitor/src/rule_engine.py` | f-string SyntaxError; the `.VERIFIED.md` in that package is a self-report |
| `freecashMonitorAdapter.ts` | returns a hardcoded `externalConnected: false` stub and is absent from `runtimeRegistry` |

## Delegated tracks

| Track | Subagent | Deliverable |
|-------|----------|-------------|
| Workflow | sa-0-47e7340f | `WORKFLOW-PLAN.md` — daily timeline, step table, R1–R4 control matrix, idempotence, escalation, missed-day path, out-of-scope list |
| Research | sa-1-d11dbb65 | `RESEARCH-PLAN.md` — question register, live read-only probe results, read-only boundary table, unproven claims and what would close them, prioritized next actions |
| Verifier | sa-2-e3327100 | `verifier/VERIFIER-SPEC.md` + a falsifiable checker proven to FAIL on injected violations, plus the real output of `tests/run_all.py` and `verify_readonly.py` |
| Scheduler | sa-3-6510f83b | `scheduler/SCHEDULER-SPEC.md` + Task Scheduler XML and wrapper, WITHOUT registering anything; day-lock idempotence proven in a sandboxed state root |

## Constraints imposed on every track

- Read-only. No live provider calls, no authentication, no login flows.
- Any execution uses a sandboxed `FREECASH_DATA_ROOT`; `data/freecash-monitor/` must gain no day-lock,
  snapshot, alert or approval. `git status --short` must be unchanged apart from newly written docs.
- No credentials, tokens or secrets in any artifact or output — `[REDACTED]` only.
- No write/withdraw/earn endpoints under any circumstance.
- Registering the scheduled task is itself an external action: it is R4 territory and is produced
  as an artifact for human approval, never executed by a track.
- A verifier is trusted only after it has been shown to fail on a known violation. "PASSED" without
  pasted raw output is treated as evidence of nothing.

# PARENT BRIEF — Free Cash Finance Automation, daily status monitoring routine (delegation R2, 2026-10-01)

Repository: D:\AgenticOS   Shell: Windows 11, terminal tool runs git-bash (MSYS). Do NOT use execute_code for reading repo files (Windows file-control policy blocks it) — use terminal / read_file.
Parent: Hermes Agent (this session). Date: 2026-10-01 (Europe/Berlin, UTC+02:00).
Artifact root for this delegation: `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/<track>/`
This brief SUPERSEDES nothing on disk; the earlier `DELEGATION-2026-10-01/` (a parallel session, deleg_fec45ca6) may be READ for context but must NOT be edited.

## Mission

DESIGN (do not execute, do not schedule, do not contact any provider) a once-per-day, read-only status
monitoring routine for Free Cash Finance Automation that satisfies the four operator rules end to end.
Every claim in your deliverable must be backed by the raw output of a command YOU ran in this pass.

## The four operator rules, in the operator's own words and order

| Id | Operator wording | Meaning in this routine |
|----|------------------|-------------------------|
| U1 | "Don't perform earning actions automatically." | No click/claim/withdraw/transact/cashout. Read-only HTTP verbs + path allowlist, enforced in code, plus a grep/AST gate for forbidden write tokens. A read failure is a failure — never a silent no-op. |
| U2 | "Check the status once a day." | At most one status check per Europe/Berlin calendar day; DST-safe day key; a second same-day invocation must no-op WITHOUT consuming anything and without alerting. |
| U3 | "Tell me if earnings or account status changes." | One notification per real change (earnings total / balance / pending / account status) vs the PREVIOUS day's snapshot. No change => silence or one coalesced line. No duplicate alert for the same change. Silence must never be the only signal for a missed day. |
| U4 | "Ask me before any external action." | Anything that is not a read becomes a PENDING approval request in a queue. The queue never auto-drains, never "expires" into execution, and only a human may sign a decision. |

## Verified live state at dispatch (raw output from this pass — treat as facts, re-check anything you rely on)

| # | Command | Observed |
|---|---------|----------|
| F1 | `ls -la monitoring/freecash` | `run_daily_check.py`, `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `readonly_client.py`, `watchdog.py`, `verify_readonly.py`, `paths.py`, `operator_state.py`, `tests/` |
| F2 | `<VENV>/python monitoring/freecash/tests/run_all.py` (4 runs) | 3 consecutive clean runs: `tests=52 failures=0 errors=0 skipped=0`; the FIRST run of the day returned `tests=52 failures=1 errors=0` and no test name was captured. A 52-test gate that fails ~1 run in 4 is not yet a trustworthy gate — quantify it. |
| F3 | `<VENV>/python monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` / `PASS - no unexempted write/earning token found.` |
| F4 | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock`** — today's key is already spent. |
| F5 | `cat data/freecash-monitor/snapshots/2026-10-01.json` | `"degraded": true`, `data_available: false`, `account_status/earnings_total_cents/balance_cents/pending_cents` all `null`, `raw_response_sha256` = sha256 of the empty string. |
| F6 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED` — a day on which NOTHING was read is recorded as a success day. This is the ledger/watchdog defect (U3/U2 interaction) in production, not in theory. |
| F7 | `wc -l data/freecash-monitor/alerts/alerts.jsonl` | 15 lines; `ls data/freecash-monitor/approvals/` → empty (no pending external actions). |
| F8 | `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` / `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` (production-root fingerprint; take it before and after any run of yours and quote both) |
| F9 | `cat data/freecash-monitor/state/operator-state.json` | `records: []` — the default read source has never carried a single operator figure, so every production run is `MONITOR_DEGRADED`. |
| F10 | `cat config/freecash-crontab` | points at `scripts/make_freecash_check.py`, a known stub with a silent exit 0 and a `parents[2]` path off-by-one. |
| F11 | `<VENV>/python -c "from zoneinfo import ZoneInfo; print(ZoneInfo('Europe/Berlin'))"` | `Europe/Berlin` on `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` (Python 3.11). System `python3` resolves tzdata too here, but the venv is the known-good one. |
| F12 | `git ls-files monitoring | wc -l`; `git status --porcelain | wc -l` | 0 tracked files under `monitoring/` (whole implementation untracked); 863 dirty paths elsewhere — unrelated. Do not add to them. |
| F13 | `ls docs/free-cash-monitor-routine/DELEGATION-2026-10-01/` | a full WORKFLOW-PLAN.md + RESEARCH-PLAN.md from a parallel session already exist for today; read them, do not duplicate them, and do not edit them. |
| F14 | `ls server/scripts/` | contains `freecash-daily-monitor.mjs` (fails `node --check`) and `verify-freecash-rules.mjs` (static grep, two tautological assertions, always exits 0, hardcodes its target) — a live false-compliance source. |

## Known-bad implementations (never use as the basis of the design; label, do not silently reuse)

| Path | Failure mode |
|------|--------------|
| `server/scripts/freecash-daily-monitor.mjs` | `node --check` fails (TS annotation + `require()` in `.mjs`); has never executed |
| `server/scripts/verify-freecash-rules.mjs` | static string-grep; tautological assertions; no `process.exit`; reports `4/4 PASSED` on a file that does not parse |
| `scripts/monitoring/free-cash-daily-check.py` | defines `main()`, never calls it; exit 0, no output, no artifacts |
| `scripts/make_freecash_check.py` | `parents[2]` off-by-one → data dir `D:\data\freecash`; prints an error then "No actions available.", exit 0 |
| `finance-monitor/src/rule_engine.py` | f-string SyntaxError; its `.VERIFIED.md` is a self-report |
| `freecashMonitorAdapter.ts` | hardcoded `externalConnected: false` stub; absent from `runtimeRegistry` |

## Constraints on every track (non-negotiable)

1. READ-ONLY with respect to everything outside your own artifact folder. No provider network calls, no authentication, no login flows, no scraping of a provider dashboard.
2. Any invocation of the routine must set `FREECASH_DATA_ROOT` to a throwaway directory under `$LOCALAPPDATA/Temp` (or `/tmp`). `data/freecash-monitor/` must gain NO day-lock, snapshot, alert or approval. Quote the production-root hash pair (F8) before and after, plus `find data/freecash-monitor -type f -newermt "<today> 00:00"` expecting zero.
3. No `git add/commit/stash/reset/restore/checkout/clean/push`. `git status --porcelain` must change only by your new files under the artifact root.
4. No scheduled task / cron job may be created or registered. Arming is U4 territory: it is produced as an artifact for human approval.
5. No credential, token, secret or account number in any artifact or stdout — `[REDACTED]` only.
6. A verifier/gate is trusted only after it has been shown to FAIL on a known violation, with the failing command and output pasted. "PASSED" without raw output is evidence of nothing.
7. Do not create a second/third competing gate file. If your track needs a gate, name the existing one you used or state that the existing one is structurally unable to pass and why (single-file scope vs package scope).
8. Files over ~400 lines: write in sections; do not paste whole source files into a doc.

## Required return format (every track)

Return a short report (not a paste of the doc) containing:
- `deliverable`: absolute path(s) written
- `evidence`: for each factual claim, the exact command and the observed output line(s)
- `rules`: U1/U2/U3/U4 → `VERIFIED` / `PARTIAL` / `NOT VERIFIED` with the one command that shows it
- `sandbox_proof`: production-root hash pair before/after + the `-newermt` count
- `open_questions`: what you could not determine and what would close it
- `blocked`: anything you were unable to do, with the accurate reason
- `not_done`: anything in your scope you deliberately did not do

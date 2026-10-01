# Free Cash Finance Automation — Daily Status-Monitoring Routine
## Delegated Workflow & Research Plan

Repository: D:\AgenticOS
Date: 2026-09-21 (Europe/Berlin, UTC+02:00)
Author: Hermes Agent (parent), work delegated to 3 parallel subagents (deleg_9db49455)
Status: DESIGN — nothing armed, nothing scheduled, no external action taken.

---

## 0. The four operational rules (non-negotiable)

| # | Rule | Enforced how (implementation) | Evidence status |
|---|------|-------------------------------|-----------------|
| R1 | No earning action automatically | `readonly_client.py` interceptor: audit hook + verb/path allowlist, `ForbiddenWriteError`, plus `verify_readonly.py` grep gate over the whole package | PASS today: `forbidden=0 exempt=28 missing_targets=0` |
| R2 | Check status once per day | `gate.py` atomic day lock: `os.open(state/day-locks/<YYYY-MM-DD>.lock, O_CREAT|O_EXCL|O_WRONLY)` — single atomic syscall; second same-day run gets `SKIP_DUPLICATE_DAY` and performs **no read** | PASS today: 52/52 tests incl. 5-process concurrency proof |
| R3 | Notify if earnings or account status changes | `changedetect.py` compares today's reading against the **previous** day's snapshot; `notify.py` emits one message per change with dedupe key, appended to `alerts/alerts.jsonl` then dispatched to a sender | PASS today (52/52 tests); live firing depends on a data source existing |
| R4 | Human approval before any external action | `approval_queue.py`: proposals go to `approvals/pending.json` as `PENDING`, nag via `APPROVAL_PENDING`, and only a human `decide()` flips to `APPROVED`; nothing in the package executes | PASS today; the monitor never reaches a provider, so no external action is even possible |

Canonical entry point (the only one that runs):
`monitoring/freecash/run_daily_check.py` — argparse CLI (`--source {operator_state,metrics_http}`, `--base-url`, `--print-state`, `--force-recheck` refused by design).

Dead / discredited entry points that must NOT be armed:
`server/scripts/freecash-daily-monitor.mjs` (does not parse — TS annotation in .mjs), `server/scripts/verify-freecash-rules.mjs` (tautological 4/4, exit 0 always), `scripts/make_freecash_check.py` (path off-by-one; still cited by `config/freecash-crontab`), `scripts/monitoring/free-cash-daily-check.py` (no `__main__` guard), `server/tasks/daily-finance-monitor.py`, `finance-monitor/` (`src/rule_engine.py` f-string SyntaxError).

---

## 1. Verified current state (commands run today, real output)

- `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0`
- `python monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0` / `PASS`
- `python monitoring/freecash/watchdog.py` → `WATCHDOG_MISSED_DAY 2026-09-21 last_attempt_day=2026-09-20 last_outcome=MONITOR_DEGRADED coverage=NOTIFIED` (today has not been checked yet)
- `python monitoring/freecash/run_daily_check.py --print-state` → ledger `last_outcome MONITOR_DEGRADED`, `timezone Europe/Berlin`, `pending items: 0` (and it consumes no day lock)
- State root `data/freecash-monitor/`: `snapshots/2026-09-20.json` (all readings `null`, `degraded: true`), `state/day-locks/2026-09-20.lock`, `state/last-run.json`, `alerts/alerts.jsonl` (2 records), `approvals/` empty
- Interpreter with `tzdata`: `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → `ZoneInfo('Europe/Berlin')` resolves. System `python3` does **not**, which degrades the day key and reports `MONITOR_DEGRADED`.
- Git: `git ls-files monitoring` → 0 files, i.e. the whole implementation is **untracked**; the repo has many unrelated uncommitted modifications. Nothing in this plan may touch them.
- No Hermes cron job exists (`cronjob_manage list` → 0 jobs).

**The honest headline:** the routine enforces all four rules rigorously, but it currently has **no live data source**. Default `--source operator_state` reads a locally typed reading with `data_available=False`, so every real run reports `MONITOR_DEGRADED`, snapshot fields are `null`, and R3 can never fire. `metrics_http` requires a `--base-url` that is not configured. The provider read endpoint is literally unresolved in code (`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` in `readonly_client.py`).

---

## 2. The workflow (once-per-day loop)

1. **Fire** — one scheduler entry per operator-local day, at a fixed local time (proposed 08:30 Europe/Berlin, after the daily reset window).
2. **Gate** — `run_daily_check.py` acquires `state/day-locks/<YYYY-MM-DD>.lock` atomically. Already exists → log `SKIP_DUPLICATE_DAY`, exit 0, no read, no snapshot. This makes the once-per-day invariant independent of scheduler reliability.
3. **Read** — `readonly_client` performs an allowlisted GET/HEAD only. Any write verb or write path raises `ForbiddenWriteError` and the run aborts before any read. If no reading is available → `MONITOR_DEGRADED`, snapshot written with nulls, **no comparison and no notification**.
4. **Compare** — load the *previous* snapshot first, then write today's. Compare `earnings_total_cents`, `balance_cents`, `pending_cents`, `account_status`. No change → single coalesced "no change" line, delivered only to `alerts/alerts.jsonl`.
5. **Notify** — each change produces one deduped message (event id, day key, prior vs current value, `Detail: alerts.jsonl dedupe=…`) onto `alerts.jsonl` and through the configured sender.
6. **Queue, never execute** — anything that would be an external action becomes a `PENDING` item in `approvals/pending.json` with a nagging `APPROVAL_PENDING` event. It is executed by a human, or not at all.
7. **Record** — ledger updated (`last_attempt_day`, `last_success_day`, `last_outcome`, `consecutive_missed_days`). `watchdog.py` reports `WATCHDOG_MISSED_DAY` when a day is skipped, so silence is never mistaken for "all good".

Silence is meaningful only because the watchdog breaks it.

---

## 3. Options, with effort / time-to-revenue / dependencies / first action

Time-to-Revenue here means: elapsed time until the routine can put a monetizable, human-approvable signal in front of the operator. The routine itself never earns — by R1 it cannot.

**Option A (recommended) — operator_state + Hermes cronjob.**
Expected Effort: 3–4 h (wrapper that prints only on change/failure, plus the cron entry).
Time-to-Revenue: 1 day (first reading tomorrow; any earnings delta surfaces the same morning).
Dependencies: operator types one daily reading; Hermes venv python with tzdata; alert delivery wired to chat (today it is not).
First Concrete Action: write `monitoring/freecash/harness/daily_cron.sh` that runs `run_daily_check.py` with the tzdata interpreter and suppresses stdout unless the outcome is a change, run failure, or missed day; then arm the cronjob below.

**Option B — metrics_http against an AgenticOS loopback route.**
Expected Effort: 1–2 days (the route must be built and must be provably read-only).
Time-to-Revenue: 2–3 days.
Dependencies: an AgenticOS HTTP route exposing account/earnings state, loopback-only, allowlisted in `readonly_client`.
First Concrete Action: `grep -rn "app.get\|router.get" server/src` for an existing read route that can serve `/stats`-shaped JSON, and check whether the Revenue Operator schema already holds the numbers.

**Option C — real provider read API (Freecash.io / HG.Cash / Cashfree Payouts).**
Expected Effort: unknown until research resolves (see §4); 1–3 days if a documented read API exists, otherwise indefinite.
Time-to-Revenue: 3–7 days, and zero if no read-only API exists.
Dependencies: a documented read-only status/balance endpoint, a bearer token, and provider terms that permit automated reads. Currently BLOCKED — the endpoint is `PROVIDER_ENDPOINT_UNKNOWN` and no credentials exist in `.env`.
First Concrete Action: research subagent is resolving this in parallel; the provider identity question is answered before any credential is requested.

**Option D — do nothing but keep the manual CLI.**
Expected Effort: 0.
Time-to-Revenue: n/a (no signal).
Dependencies: none.
First Concrete Action: keep running `run_daily_check.py` by hand; fine as a fallback but it silently loses the missed-day signal the moment you forget.

Every option proceeds only after the operator approves the arming step (R4 applied to the monitor's own deployment).

---

## 4. Research plan (delegated, in flight)

Three subagents are running against this workspace; each writes an evidence file under `.hermes/scratch/freecash/` and reports back.

1. **Provider resolution** (`provider-research.md`) — which real entity "Free Cash" is; whether a documented read-only balance/earnings API exists; auth, rate limits, ToS stance on automated access; 3–5 options with effort/TtR/dependencies/first action; explicit open questions. Goal: kill or confirm `PROVIDER_ENDPOINT_UNKNOWN`.
2. **Scheduling & delivery** (`scheduling-workflow.md`) — Hermes cronjob vs Windows Task Scheduler vs the repo crontab, with real command lines, tzdata interpreter, env vars, log paths, day-lock argument, and a plain statement (with the command used to prove it) of where alerts can actually land today. Open gap to close: `notify.py`'s senders are a file append plus a Windows toast, so chat delivery currently depends on the scheduled job's own output channel.
3. **Adversarial rule verification** (`rule-verification.md`) — each rule attacked in an isolated `FREECASH_DATA_ROOT` (never the real one); matrix of violation attempted → command → observed → verdict, plus any hole. Prior art is unkind here: an earlier verifier was tautological and certified a script that does not parse, so no rule counts as enforced until a known violation has been shown to fail.

Open questions they must answer, in priority order: (a) does a read-only provider endpoint exist at all; (b) can an alert reach the operator's chat without a new sender implementation; (c) can a single scheduler entry be proven to fire at most once per operator-local day across DST and a sleeping machine; (d) is the day-lock safe if the clock moves backwards; (e) what is the minimum evidence set that makes "4/4 rules hold" a falsifiable claim rather than a slogan.

---

## 5. Staged (NOT yet executed) arming step — needs operator approval

Pending approval, the recommended arming is a Hermes cronjob at 08:30 Europe/Berlin whose script emits nothing on a quiet day and the alert text on a change, delivering to this chat. The exact create payload and wrapper path will be finalised from the scheduling subagent's verified recommendation; it will not be armed without an explicit go-ahead, and the Windows Task Scheduler / crontab alternatives will be documented as fallbacks rather than armed in parallel (two schedulers would be safe because of the day lock, but would double the noise).

---

## 6. What stays true regardless of option chosen

- Nothing in the monitor writes to a provider. R1 is enforced by interceptor, not by intention.
- A second same-day run is not just skipped, it does not read.
- No notification means no *change*, not no *news* — the watchdog is what separates those two.
- Approval queue items never expire into execution.

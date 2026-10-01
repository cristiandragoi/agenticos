# DELEGATION BRIEF — 2026-09-30 — Free Cash daily status monitor (workflow + research plan)

**Repository:** `D:\AgenticOS` (§ workspace) · branch `hermes-rescue-20260908` (working tree heavily dirty; additive-only)
**Written:** 2026-09-30, Europe/Berlin · **Author:** Hermes (parent session)
**Artifact of this pass:** this brief + the four sub-agent deliverable directories named in §4. No source file modified, no scheduler entry created, no provider contacted, no credential used, no git write verb run.

---

## 1. The four operational rules (operator's numbering — binding)

| ID | Rule (operator's words) | Code-side control that must enforce it |
|----|-------------------------|----------------------------------------|
| **1** | Don't perform earning actions automatically | `readonly_client.py` deny-by-default transport: `ALLOWED_METHODS = {GET, HEAD}`, loopback-only `ALLOWED_HOSTS`; `verify_readonly.py` static gate |
| **2** | Check the status once a day | `gate.py` atomic `O_CREAT\|O_EXCL` lock at `state/day-locks/<YYYY-MM-DD>.lock`; a second run must print `SKIP_DUPLICATE_DAY` and exit 0 |
| **3** | Tell me if earnings or account status changes | `changedetect.py` integer-cents compare vs the **prior** snapshot; `notify.py` writes one payload with a persisted `dedupe_key` before dispatch |
| **4** | Ask me before any external action | `approval_queue.py`; `execution_state` always `NOT_EXECUTED`; a decision requires `--by "<human>"`; no execution path exists in the routine |

Note: the repo also contains an **inverted numbering** (a prior plan labels "R1 = no earning action, R2 = once per day"). This brief uses the operator's numbering above, which matches the requirement text.

---

## 2. Baseline verified in the parent session (2026-09-30, commands executed, output quoted)

| # | Command | Observed | Verdict |
|---|---------|----------|---------|
| V1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | suite GREEN |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit 0 | static rule-1 gate GREEN |
| V3 | `ls monitoring/freecash/` | `run_daily_check.py` (18977 B), `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `readonly_client.py`, `operator_state.py`, `paths.py`, `watchdog.py`, `verify_readonly.py`, `tests/` | canonical implementation exists |
| V4 | `find data/freecash-monitor -type f -printf '%T+ %p'` | only `day-locks/2026-09-20.lock`, `snapshots/2026-09-20.json`, `state/operator-state.json`, `state/last-run.json` (all 2026-09-20 21:08); `alerts/alerts.jsonl` + `state/notified-keys.json` 2026-09-21 18:39 | **9-day silent gap** (09-22 … 09-30); today's day key still free |
| V5 | `cat data/freecash-monitor/state/last-run.json` | `last_outcome: MONITOR_DEGRADED`, `last_attempt_day: 2026-09-20`, `timezone: Europe/Berlin` | last real run 10 days ago |
| V6 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` — empty | **rule 3 has never had a change to detect**; every snapshot is `null` + `degraded: true` |
| V7 | `ls data/freecash-monitor/approvals/` | empty | no approval item has ever been queued |
| V8 | `schtasks /query` grep `free`; no freecash task | no match | **nothing schedules the routine** |
| V9 | `ls ~/AppData/Local/hermes/cron` | ticker files only, no job definitions | **no Hermes cron job either** |
| V10 | `grep -iE "freecash\|SMTP\|WEBHOOK" .env server/.env` | nothing (names checked only; no value read) | no provider, no notification channel configured |
| V11 | `python -c "import sys,tzdata; print(sys.executable)"` | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` | only this interpreter resolves `Europe/Berlin` (system `py -3`/3.14 has no IANA db) |
| V12 | `cat monitoring/freecash/readonly_client.py` (grep) | `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`; `ALLOWED_HOSTS = {localhost, 127.0.0.1, ::1}` | **no provider read contract exists** — rule 3 cannot be fed from a real account today |

**Net:** the code side of rules 1, 2 and 4 is implemented and green. The failures are operational: *(a)* nothing runs it, *(b)* no data source feeds it, *(c)* no delivery sink is configured, *(d)* the older in-repo rule gate (`server/scripts/verify-freecash-rules.mjs`) prints `4/4 PASSED` while certifying `server/scripts/freecash-daily-monitor.mjs`, which does not parse (`node --check` → `SyntaxError` line 41). A green rule report currently proves nothing.

---

## 3. Hard constraints handed to every sub-agent

- No scheduled-task / cron registration, no modification or deletion of existing files, no git write verb, no network beyond loopback, no provider contact, no credential read/typed/stored, no production-state-root writes (`FREECASH_DATA_ROOT` must be pointed at a throwaway dir; a stray export may exist in some shells).
- Pinned interpreter: `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`.
- Evidence bar: a PASS may only be claimed from output quoted in the same session. Unverifiable items are labelled UNVERIFIED.

---

## 4. Delegated workstreams (4 sub-agents, parallel)

| # | Directory | Question it answers | Rule focus |
|---|-----------|--------------------|-----------|
| 1 | `DELEGATION-2026-09-30/scheduler/` | What exactly must be registered so the routine runs unattended once per day, and is the once-per-day lock real? | 2 |
| 2 | `DELEGATION-2026-09-30/datasource/` | What feeds the daily figure, and does a real change actually produce exactly one notification? | 3 |
| 3 | `DELEGATION-2026-09-30/verifier/` | What gate fails when a rule is broken (and what does the existing one miss)? | 1–4 |
| 4 | `DELEGATION-2026-09-30/delivery/` | Does the approval gate refuse illegitimate decisions, and where does the notification land? | 4 (+3) |

Parent synthesises §4 into the consolidated workflow + research plan with, per option: **Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action**.

---

## 5. Out of scope / not claimed

- No provider account, balance, earnings or status has been read from any real account by this pass or by the routine.
- No automated earning or withdrawal path is proposed anywhere; rules 1 and 4 are permanent exclusions, not staging items.
- The 52/52 result is the routine's own suite on this host — it shows the gate / change-detection / approval logic behaves as specified, not that any figure is true.

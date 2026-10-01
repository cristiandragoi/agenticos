# Free Cash Finance Automation — Workflow Plan

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `d14253d`
**Written:** 2026-09-20 21:32 CEST · **Deliverable of this turn:** this one new file only.
**Goal:** bring `monitoring/freecash/` (the green read-only routine) to an unattended, once-daily, notifying, approval-gated state that satisfies R1–R4 on this host — without touching the provider account, without a second writer, and without modifying any pre-existing uncommitted work.
**Architecture:** one entry point (`monitoring/freecash/run_daily_check.py`) + one state root (`data/freecash-monitor/`, overridable via `FREECASH_DATA_ROOT`) + static R2 scanners + a Windows scheduled task. Everything else in the repo is legacy to be disabled, not deleted.
**Tech stack:** Python 3.11.9 (Hermes venv, `tzdata 2025.3`), stdlib only, `schtasks` for scheduling, JSONL/JSON on disk for state.
**Evidence standard:** every §0 row is output of a command run in this session and is quoted verbatim. No prior PASS report, plan, audit or checklist was accepted as evidence.
**Scope of this turn:** planning only — no code change, no task registration, no provider contact, no credential use, no git mutation.

---

## 0. Live state verified this session (2026-09-20 21:29–21:31 CEST)

| # | Command (executed) | Observed | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` (twice) | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 both runs | gate **GREEN**, reproducible |
| V1b | `stat` of `alerts/alerts.jsonl` + `state/last-run.json` before and after both runs | identical: `21:08:01.077661100 / 992 B` and `21:08:00.732912700 / 341 B` | suite is **hermetic** — it did not touch the production state root |
| V2 | `python monitoring/freecash/verify_readonly.py monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit 0 | R2 static gate GREEN; **exemption baseline = 28** |
| V2b | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | same counts, `PASS`, exit 0 | shell and Python checkers **agree** |
| V3 | `schtasks /Query /TN "FreeCash-Daily-Monitor"`; `schtasks /Query /FO csv /NH \| grep -iE "cash\|finance\|monitor\|agentic"` | `FEHLER: Das System kann die angegebene Datei nicht finden.`; 7 matches, all `\Microsoft\...` built-ins | **NOT SCHEDULED** |
| V4 | `env \| grep -iE "freecash\|smtp_\|webhook_"` | 0 matches | no host configuration for the routine |
| V5 | `python -c "import zoneinfo,tzdata; zoneinfo.ZoneInfo('Europe/Berlin')"` | resolves; `3.11.9` (`/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python`) | only the venv interpreter can compute the operator-local day key |
| V6 | `find data/freecash-monitor -type f -printf '%T+ %s %p\n'` | exactly 5 files, **all stamped 2026-09-20 21:08:00–21:08:01**: `state/day-locks/2026-09-20.lock` (0 B), `state/operator-state.json` (879 B, `records: []`), `snapshots/2026-09-20.json` (518 B, `degraded: true`, every metric `null`), `state/last-run.json` (341 B, `last_outcome=MONITOR_DEGRADED`), `alerts/alerts.jsonl` (992 B, 2 lines: `MONITOR_DEGRADED`, `SKIP_DUPLICATE_DAY`) | state root exists and **today's day key is already consumed**; `approvals/` and `logs/` are empty |
| V7 | `ls -la logs/daily_monitor_runtime.log` + `tail` | mtime `21:10`, unchanged through 21:31; last lines `action=fetch_error … localhost:3001 … NewConnectionError` and `action=daily_check_failed day=2026-09-20 details=metrics_not_available` | a **legacy monitor is (or was, until 21:10) running and failing every run** |
| V8 | `curl -m8 …:4600/api/health`; `…/api/revenue/metrics` | `200`; `{"totalOpportunities":7,"countsByStage":{"evaluated":6,"converted":1},"averageOverallScore":70,…}` | AgenticOS server live on **4600**; a live GET-only read surface already exists |
| V9 | `curl -m8 …/api/projects/proj-free-cash/freecash/auth` | `sessionState:"authenticated"`, `satisfied:true`, `credentialAvailable:true`, `externalConnected:true`, `blocker:null`, `checkedAt:2026-09-20T19:31:04Z`; goal `goal-mua716b6-21ytxf` (`"Jarvis, start working on FreeCash."`) `status: active` | **state changed since the 21:16 plan** (then `unauthenticated`/`false`); a **parallel Jarvis workstream is live on the same project right now** |
| V10 | `git status --porcelain -- monitoring/freecash data/freecash-monitor` | `?? monitoring/freecash/`, `?? data/freecash-monitor/` | both **untracked** → must be preserved; 511 dirty entries exist repo-wide |
| V11 | `ProcessId 39252/34520` (Win32_Process, cmdline match `cash`) | a second agent session created `21:30:14`, fetching `docs.hg.cash` / `cashfree.com` API docs | **a second live agent session exists on this host** |

**Net:** the routine's own gates are green and self-consistent; the blockers are now *operational* (unattributed first writer, consumed day key, no scheduler, one live competitor process, one live parallel workstream), not code defects.

---

## 1. Frozen constraint set (non-negotiable)

| ID | Constraint | Enforcing mechanism (live) | Proof required |
|----|-----------|----------------------------|----------------|
| R1 | exactly one status read per operator-local calendar day | `gate.py` atomic `O_CREAT\|O_EXCL` lock on `state/day-locks/<day>.lock` | two invocations same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY` |
| R2 | zero earning/withdrawal actions; read-only transport | `readonly_client.py` deny-by-default `{GET,HEAD}`, loopback + allowlisted paths only; `verify_readonly.py` + `verify-readonly.sh` static scan | both scanners exit 0; `exempt` may never exceed **28** (V2/V2b) |
| R3 | notify on earnings/status change, once, no storm | `changedetect.py` integer-cents compare + `dedupe_key` written **before** dispatch; `OK_NO_CHANGE` is log-only | seeded change → exactly one payload with its `dedupe_key`; no-change day → no dispatch |
| R4 | human approval before any external write | `approval_queue.py`: `execution_state` always `NOT_EXECUTED`, decision requires `--by "<human>"`; no execution path exists in the routine | tokenless/machine-signed decision is refused; pending item survives a 90-day clock advance unchanged |
| W1 | no secrets in code, state or logs | env/vault only; `[REDACTED]` in reports | secret scan returns no credential value |
| W2 | additive only; never reset/delete unrelated uncommitted work | 511 dirty entries on `hermes-rescue-20260908`; `monitoring/freecash/` untracked (V10) | `git status --short` before/after; only new paths appear |
| W3 | no destructive git operations | — | no `reset --hard`, `checkout --`, `clean -fdx`, no force push |
| W4 | PASS only from output quoted in the current session | — | each status cell carries its command and observed text |
| W5 | voice runtime off-limits | `src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/components/jarvis/JarvisComposer.tsx`, `src/domains/jarvis/*` | zero diff in those paths |
| W6 | one writer against the state root at a time | **not yet enforced** — see F1/F8 | two consecutive days with writes attributable to exactly one actor |

---

## 2. Stages

Each stage: **Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action · Exit criteria.**
"Time-to-Revenue: none" means the stage produces verifiable instrumentation, not money; the only revenue in this project is the operator's own account balance, which no stage in this plan automates.

### F0 — Canonicalize the routine, freeze the drift *(prerequisite for every report)*
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none (it removes the false-PASS surface).
**Dependencies:** none.
**First Concrete Action:** create `docs/freecash/SPEC.md` containing the §1 table verbatim, the chosen read source, the pinned interpreter, and the measured `exempt=28` baseline, then add a **one-line** `SUPERSEDED — see docs/freecash/SPEC.md` header to the older plans (`docs/free-cash-monitor-routine/WORKFLOW-PLAN-V4.md`, `docs/freecash-monitor-workflow-plan.md`, `docs/free-cash-finance-automation-workflow-plan.md`, `free-cash-automation-workflow.md`, `free-cash-finance-monitoring-specification.md`, `freecash-monitoring.md`). Headers only — no rewrites, no deletions.
**Exit:** one canonical spec; `server/scripts/verify-freecash-rules.mjs` is marked non-authoritative in it (that gate greps text, not behaviour).

### F1 — Attribute the first writer of `data/freecash-monitor` *(blocking)*
**Expected Effort:** 0.5–1 h. **Time-to-Revenue:** none.
**Dependencies:** none.
**First Concrete Action:** reproduce the 21:08 residue in isolation — set `FREECASH_DATA_ROOT` to a throwaway dir under `$LOCALAPPDATA/Temp`, run each candidate once (`python monitoring/freecash/run_daily_check.py`, the Jarvis `freecash` execution path behind route V9, the legacy `scripts/monitoring/free-cash-daily-check.py`), and diff `sha256sum` of `alerts/alerts.jsonl` + `state/last-run.json` per candidate against the production pair `21:08:01.077661100/992 B` and `21:08:00.732912700/341 B`.
**Exit:** the writer is named with quoted evidence and the operator has decided whether the 21:08 residue is history or is moved to a documented archive path. **Until then a first live run today can only return `SKIP_DUPLICATE_DAY` (V6)**, and R1 is unprovable because a second writer could consume a day unseen.

### F2 — Pin interpreter and timezone
**Expected Effort:** 0.5 h. **Time-to-Revenue:** none.
**Dependencies:** F1.
**First Concrete Action:** write the interpreter into the task action as the absolute venv path `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` and record the `Europe/Berlin` day key in the acceptance log; `py -3` (3.14.x) must not be used — it has no IANA database and would degrade the day key to `WARNING timezone_unavailable`.
**Exit:** a quoted run under the pinned interpreter shows no timezone warning and a `2026-…` local day key.

### F3 — Choose the read source (three options)

**F3a — Operator-entered figures (available today; recommended first).**
**Expected Effort:** 1–2 h (mostly a documented 2-minute daily manual step). **Time-to-Revenue:** none directly; it is what makes R3 honest.
**Dependencies:** F1.
**First Concrete Action:** append one record to `data/freecash-monitor/state/operator-state.json` `records[]` (integers in cents, `day_key` = operator-local date), run the entry point once, and quote `RUN_OK … outcome=INITIAL_BASELINE source=operator_entered(data_available=True)`; the next day's changed figures must produce exactly one notification.
**Exit:** one snapshot with `degraded: false`, zero notifications on the baseline day, one day lock. No network call, no credential, R2 untouched.

**F3b — In-repo AgenticOS read route (recommended second; real data, no provider).**
**Expected Effort:** 4–8 h. **Time-to-Revenue:** indirect — it feeds the same DB that already reports 7 opportunities / 1 converted (V8).
**Dependencies:** F1, F2, server on 4600, a new `read_source` kind wired into `run_daily_check.py` (the existing `metrics_http` source is loopback-only by design).
**First Concrete Action:** `curl -m8 http://127.0.0.1:4600/api/revenue/metrics`, paste the **real** JSON into the read-source test fixture (never a hand-written fixture), and map `earnings_total_cents` / `balance_cents` / `pending_cents` onto those fields with an explicit `null` where the route has no equivalent.
**Exit:** a live GET yields `degraded: false`; route failure yields `READ_FAILED` + one deduped notification, not a crash. Do **not** invent `/api/v1/status/metrics` — it does not exist and is exactly the legacy monitor's failure (V7).

**F3c — Live provider account (BLOCKED — now newly *tempting*, still not ready).**
**Expected Effort:** unknown. **Time-to-Revenue:** unknown; only real earnings.
**Dependencies:** a documented read contract for the provider, a credential stored in vault/env (never in chat or code), **and an explicit, reviewed change to `readonly_client.py`'s loopback/allowlist policy** — the routine currently refuses every non-loopback host by test, so pointing it at a provider is itself an R2-sensitive change requiring the scanner exemption count to be re-baselined.
**First Concrete Action:** with the operator present, one read-only authenticated `GET` through an isolated probe (outside the routine), logged with `[REDACTED]` credentials.
**Current evidence:** V9 now reports `authenticated` / `credentialAvailable:true` from the Jarvis route, which **contradicts** the 21:16 reading (`unauthenticated`, `credentialAvailable:false`). Treat V9 as a *self-report of another workstream*, not as a verified provider read. Prior research records a provider ToS clause forbidding automated access — **cited as repo text, not re-verified this session** — so F3c must not be started without that question being answered first. Keep it off the critical path.

### F4 — Scheduling (R1 on a real clock)
**Expected Effort:** 2–3 h. **Time-to-Revenue:** none.
**Dependencies:** F1, F2, F3a or F3b.
**First Concrete Action:** register the task in the non-elevated-compatible form — `schtasks /Create` **without** `/RL HIGHEST`, action pinned to the venv interpreter, `-MultipleInstances IgnoreNew`, restart-on-failure = **Do not restart** — trigger it manually, quote one run-log line, trigger again the same day, quote `SKIP_DUPLICATE_DAY`.
**Exit:** `schtasks /Query /TN … /V /FO LIST` output quoted plus both manual-trigger results. **No task may be registered before F1 closes**, because an unattributed second writer makes R1 unprovable.

### F5 — Notification sink (R3)
**Expected Effort:** 2–4 h, or blocked. **Time-to-Revenue:** none.
**Dependencies:** F1, F4.
**First Concrete Action:** run one seeded-change day with the shipped sinks (`alerts/alerts.jsonl` always on, Windows toast by default, `FREECASH_TOAST_STUB=1` for offline runs so the label is `STUB_OK` and never `TOAST_OK`) and quote the single emitted payload with its `dedupe_key`.
**Exit:** exactly one payload per real change; a delivery failure produces bounded attempts, one `FAILED_TOAST` record, then stops.
**Blocked variants:** email / webhook / SMS — `env` shows no `SMTP_*`/`WEBHOOK_*` and `himalaya` is not installed (V4).

### F6 — Approval surface and audit (R4)
**Expected Effort:** 3–5 h. **Time-to-Revenue:** none (it is the guardrail that keeps money-moving steps out of automation).
**Dependencies:** F1, F3a/b, F5.
**First Concrete Action:** after a seeded change enqueues one item, run the documented decision path from inside `monitoring/freecash/` — `python approval_queue.py decide --id <uuid> --decision approve --by "<human name>" --note "<why>"` — and quote the resulting line from `approvals/decided.jsonl`; confirm `execution_state=NOT_EXECUTED` and that no module consumes an `APPROVED` status as a trigger.
**Exit:** pending item unchanged after a simulated 90-day advance; every decision attributable to a named human; machine identity refused with exit code 4; still no execution path anywhere in the routine.

### F7 — Retire the competing monitors (non-destructive)
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none; removes a live source of false failure signal.
**Dependencies:** F1, F4.
**First Concrete Action:** identify what kept `logs/daily_monitor_runtime.log` growing until 21:10 (no scheduled task exists — V3; check the Electron/Jarvis process tree and any in-app scheduler), quote the launcher, then disable it in a documented, reversible way and confirm the log stops growing.
**Candidates to disable, never delete:** `scripts/monitoring/free-cash-daily-check.py`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py` (carries a wired `withdraw` action path — highest R2 risk in the repo), `server/scripts/freecash-daily-monitor.mjs` (does not parse), `server/tasks/daily-finance-monitor.py`, `config/freecash-crontab` (literal `/path/to/AgenticOS`), the `finance-monitor/` package (its `wait_gate.py` fabricates consent via `random.choice`).
**Exit:** exactly one monitor is live; `git status` shows the retired files unchanged on disk.

### F8 — Single-writer discipline against the live parallel workstream
**Expected Effort:** 0.5 h. **Time-to-Revenue:** none.
**Dependencies:** F1.
**First Concrete Action:** write a one-page hand-off rule for `data/freecash-monitor` between this plan's implementer and the active Jarvis/FreeCash session (`goal-mua716b6-21ytxf`, `status: active`, auth route refreshed `19:31:04Z` — V9) and the second agent process (`21:30:14` — V11); readers may read the tree, never write it.
**Exit:** two consecutive days with writes attributable to exactly one actor.

### F9 — Daily evidence bundle
**Expected Effort:** 1 h. **Time-to-Revenue:** none.
**Dependencies:** F4, F5, F6.
**First Concrete Action:** define the per-day archive as the 5 state files' `sha256` + mtimes, the `RUN_OK`/`SKIP_DUPLICATE_DAY` line, `exempt=28` from both scanners, and the alert/approval counts; the bundle must be reproducible from disk alone.
**Exit:** two archived days whose contents match the live tree.

---

## 3. Critical path and sequencing discipline

`F1 → F2 → (F3a or F3b) → F4 → F5 → F6 → F7 → F9`, with **F0 in parallel from the start** and **F8 in parallel from the start**.
F3c is off the critical path and blocked. Total ≈ **15–28 h** of tool-verified work against an internal data source.
One change between gate runs only, so any green→red delta is attributable; no stage is reported complete from a claim — only from output quoted in the session that ran it.

---

## 4. Blocked / open register

| Item | Blocked on | Evidence (this session) |
|---|---|---|
| Writer of `data/freecash-monitor` (F1) | attribution | V6: all 5 files created 21:08:00–21:08:01; V1b: an identical suite run left both mtimes/sizes untouched; leading candidate is the parallel Jarvis workstream (V9/V11). **Must close before F4.** |
| Today's day key (F4 live proof) | operator decision | V6: `state/day-locks/2026-09-20.lock` exists → the first live run today returns `SKIP_DUPLICATE_DAY`; today's snapshot is degraded with null fields. First real acceptance day is 2026-09-21. |
| Live provider read (F3c) | documented read contract + credential + R2 allowlist decision + ToS answer | V9 is another workstream's self-report; V4 shows no configured key; `readonly_client.py` refuses non-loopback hosts by test. |
| Email / webhook / SMS notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | V4: 0 env matches; `himalaya` not installed. |
| Any real withdrawal / earning action | human approval surface + R4 implementation | By design R4 never executes; no execution path exists in the routine. |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | Non-elevated host; plan uses the non-elevated-compatible task form. |

---

## 5. Non-goals

- No rewrite, move or deletion of the parallel implementations (routine vs. legacy scripts vs. `finance-monitor/`) — disable and document only.
- No live financial write path; R4 exists to keep it that way.
- No compliance claim from any earlier plan, audit or PASS report — only from output quoted in the running session.
- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations; `monitoring/freecash/` and `data/freecash-monitor/` stay untracked and intact (V10).
- No changes under the voice-runtime paths (W5), and no new entity that duplicates an existing schema table (reuse `revenueOpportunities`).
- No provider contact while the ToS question is open (F3c).

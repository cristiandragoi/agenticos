# Free Cash Finance Automation — Workflow Plan (re-verified 2026-09-20 21:16 CEST)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `d14253d`
**Deliverable of this turn:** this one new file. Nothing else was created, modified, moved, deleted or committed.
**Evidence standard:** every fact in §1 comes from a command executed in this session and is quoted below. No earlier PASS report, plan or document was treated as evidence.
**Plan-only scope:** no code was changed, no task was registered, no credential was used, no account was touched.

---

## 0. What the previous plan got wrong (and why that matters)

`docs/free-cash-monitor-routine/WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` (written earlier today) records the routine as **red**: `FAILED (failures=6, errors=11)` and R2 exit 1. That is no longer true. The two defects it named are fixed in the working tree:

| Prior claim | Live check this session | Verdict |
|---|---|---|
| C1: `approval_queue.py` referenced an undefined constant → `NameError` | `grep -n ACTION_LABEL monitoring/freecash/approval_queue.py` → `:52 ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"`, `:111` uses that constant | C1 resolved |
| C2: `run_daily_check.py` discarded `record_attempt()`'s return, clobbering `last_attempt_day` | `run_daily_check.py:329 ledger = gate.record_attempt(day, now, ledger)` (with a comment explaining exactly that hazard) | C2 resolved |
| L1: suite red | `python monitoring/freecash/tests/run_all.py` → `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 (run twice, same result) | **GREEN** |
| L2: R2 gate red | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → `forbidden=0 exempt=28 missing_targets=0`, exit 0; `python monitoring/freecash/verify_readonly.py monitoring/freecash` → `forbidden=0 exempt=28`, exit 0 | **GREEN**, both checkers agree |

Consequence: the work has moved on from "make the gate green" to **"make the green routine actually run, unattended, without colliding with the live legacy workstreams"**. This plan is written against that reality.

---

## 1. Live state, verified 2026-09-20 21:05–21:16 CEST

| # | Command (executed this session) | Observed result | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` (twice) | `tests=52 failures=0 errors=0 skipped=0`, exit 0 | gate GREEN, reproducible |
| V2 | `bash …/verify-readonly.sh monitoring/freecash` and `python monitoring/freecash/verify_readonly.py monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` / `forbidden=0 exempt=28`, both exit 0 | R2 GREEN; exemption baseline = **28** |
| V3 | `schtasks /Query /TN "FreeCash-Daily-Monitor"`, `…-Missed-Day-Watchdog` | `FEHLER: Das System kann die angegebene Datei nicht finden.` (both) | **NOT SCHEDULED** |
| V4 | `schtasks /Query /FO csv /NH \| grep -iE "cash\|finance\|monitor\|agentic"` | only Microsoft built-ins | no hidden freecash/finance task exists |
| V5 | `env \| grep -iE "freecash\|smtp_\|webhook_"` | no output | no routine configuration on the host |
| V6 | `python -V` / `py -3 -V` / `import tzdata` | `3.11.9` + `tzdata 2025.3` (venv) · `3.14.7` (launcher) | only the venv interpreter resolves `Europe/Berlin` |
| V7 | `py -3 -m pytest --version`, `python -m pytest --version` | `No module named pytest` (both) | checklist check 5 (`pytest … 16 passed`) is **unrunnable as written** |
| V8 | `ls -d data/freecash-monitor`, `ls -laR` | exists; created **today 21:08:00–21:08:01**; contains `state/day-locks/2026-09-20.lock`, `state/last-run.json` (`last_outcome=MONITOR_DEGRADED`), `state/operator-state.json` (`records: []`), `snapshots/2026-09-20.json` (degraded, all fields `null`), `alerts/alerts.jsonl` (2 lines: `MONITOR_DEGRADED`, `SKIP_DUPLICATE_DAY`) | **state root already consumed today — writer UNATTRIBUTED** |
| V9 | re-ran `run_all.py` while watching `stat -c %y alerts.jsonl` | mtime unchanged (`21:08:01`), still 2 lines | the suite is hermetic; the writer is **not** the test suite |
| V10 | `logs/daily_monitor_runtime.log` (tail, mtime) | mtime `21:10:50`; last lines `[2026-09-20 19:10:50 UTC] action=fetch_error … localhost:3001 … NewConnectionError` + `action=daily_check_failed day=2026-09-20 details=metrics_not_available` | a **legacy monitor is still running and failing**, every run |
| V11 | `curl -m8 http://127.0.0.1:4600/api/v1/status/metrics` → `404`; `curl … :3001/api/v1/status/metrics` → `000` (refused) | no such route anywhere; port 3001 dead | the legacy monitor's endpoint does not exist |
| V12 | `curl -m8 http://127.0.0.1:4600/api/health` | `{"status":"healthy","version":"9.0.0","gitSha":"d14253df179d…","isDirty":true}` | AgenticOS server live on **4600** |
| V13 | `curl -m8 http://127.0.0.1:4600/api/revenue/metrics` | `{"totalOpportunities":7,"countsByStage":{"evaluated":6,"converted":1},"averageOverallScore":70,…}` | a **live, GET-only, in-repo read surface already exists** |
| V14 | `curl -m8 http://127.0.0.1:4600/api/projects/proj-free-cash/freecash/auth` | `sessionState:"unauthenticated"`, `satisfied:false`, `credentialAvailable:false`, blocker: *"FreeCash requires an authenticated browser account session before work can start. No live session verification exists."*; open goal `goal-mua716b6-21ytxf` from *"Jarvis, start working on FreeCash."* | provider path **BLOCKED**, and a parallel Jarvis/FreeCash workstream is live |
| V15 | `Get-CimInstance Win32_Process` filter `freecash` | bash process created `21:13:58` running an acceptance script (`POST /api/jarvis/conversations/:id/message/stream` with prompt *"Jarvis, start working on FreeCash."*, then reading the `freecash/auth` route) | a **second agent session is working the same project right now** |
| V16 | `grep -rniE "password\|token\|secret\|api[_-]?key" monitoring/freecash/ data/freecash/` | 13 hits, all prose/tests/`.pyc` binaries (the word *token* in scanner docs and test names); no credential value | pre-flight check 1 passes with a note |
| V17 | `grep -rn "PROVIDER_ENDPOINT_UNKNOWN" monitoring/freecash/` | `approval_queue.py:116`, `readonly_client.py:27,48,60`, `tests/test_r2_readonly.py:24` | no invented endpoint; the literal placeholder is used as designed |
| V18 | `git status --porcelain -- monitoring/freecash data/freecash-monitor` | `?? monitoring/freecash/`, `?? data/freecash-monitor/` | both untracked → must be preserved, never reset |

---

## 2. Frozen constraint set (inherited, non-negotiable)

| ID | Rule | Enforcing mechanism (live, verified) | Proof required |
|---|---|---|---|
| R1 | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` (`O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock`) | two runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY` (already observable in V8) |
| R2 | no earning/withdrawal action; read-only transport | `readonly_client.py::request` deny-by-default `{GET,HEAD}`, no body/files; `verify_readonly.py` / `verify-readonly.sh` static scan | transport test + both scanners exit 0 on the shipped tree (V2) |
| R3 | notify on status/earnings change, once, no storm | `changedetect.py::compare` (integer cents) + `dedupe_key` written **before** dispatch; `notify.py::emit_no_change` log-only | seeded change → exactly one payload; no-change day → `OK_NO_CHANGE`, no dispatch |
| R4 | human approval before any external write | `approval_queue.py`: `expires_at_utc` always `null`, `execution_state` always `NOT_EXECUTED`, decision requires `--by` | tokenless write raises and performs no network write; pending item survives a clock advance unchanged |
| W1 | no secrets in code, state or logs | env/vault only; `[REDACTED]` in any report | secret scan returns no credential value (V16) |
| W2 | additive only; never reset/delete unrelated uncommitted work | branch `hermes-rescue-20260908` carries a large body of uncommitted work; `monitoring/freecash/` is untracked (V18) | `git status --short` before/after; only new paths |
| W3 | no destructive git operations, no history rewrite | — | no `reset --hard`, `checkout --`, `clean -fdx`, no force push |
| W4 | PASS only from output quoted in the current session | — | every status cell carries a command and its observed text |
| W5 | voice runtime is off-limits for this work | per `revenue-operator` hardline: `src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/components/jarvis/JarvisComposer.tsx`, `src/domains/jarvis/*` | no diff in those paths |
| W6 | one writer at a time against the state root | **not yet enforced** — see §5 open item | §5 O1 closed |

---

## 3. Workflow stages

Each stage lists **Expected Effort**, **Time-to-Revenue**, **Dependencies**, **First Concrete Action** (the very next command/step), and exit criteria.

### W0 — Attribute and freeze the live state root *(blocking)*
**Expected Effort:** 0.5–1 h. **Time-to-Revenue:** none (removes an R1-provenance hole).
**Dependencies:** none.
**First Concrete Action:** with the operator watching `Get-CimInstance Win32_Process` output, identify the writer of `data/freecash-monitor` by re-running each candidate (`python monitoring/freecash/run_daily_check.py`, the Jarvis `freecash` execution path, the legacy monitor) against a throwaway `FREECASH_DATA_ROOT` and diffing `alerts.jsonl`; record the attributed writer in this file.
**Exit:** the writer is named with quoted evidence, and the operator has decided whether the 21:08 residue (consumed day lock, degraded snapshot, empty operator-state) is kept as history or moved to a documented archive path. Until then, a first live run today can only return `SKIP_DUPLICATE_DAY`.

### W1 — Make the suite the acceptance instrument, not a document
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none.
**Dependencies:** W0.
**First Concrete Action:** fill `RULE-GATE-CHECKLIST.md` check 5 with `python monitoring/freecash/tests/run_all.py` (pytest is absent — V7) and record `tests=52 failures=0 errors=0` verbatim; record `exempt=28` (V2) as the R2 baseline.
**Exit:** every pre-flight row carries a real command, real output and PASS / FAIL / N/A(named blocker). Any later rise of `exempt` above 28 means R2 is eroding.

### W2 — Pin interpreter and timezone
**Expected Effort:** 0.5–1 h. **Time-to-Revenue:** none.
**Dependencies:** W1.
**First Concrete Action:** capture the interpreter decision in one line — the task action must invoke the Hermes venv `python` (`3.11.9`, `tzdata 2025.3`, V6); `py -3` (`3.14.7`) has no IANA database and would emit `WARNING timezone_unavailable`, degrading the day key.
**Exit:** a quoted run under the pinned interpreter shows no timezone warning and a `Europe/Berlin` day key.

### W3 — Choose the read source (three options)

**W3a — Operator-entered figures (available today).**
**Expected Effort:** 1–2 h (mostly a documented daily manual step). **Time-to-Revenue:** none directly; it is what makes R3 honest.
**Dependencies:** W0. **First Concrete Action:** create the canonical root, append one operator record for tomorrow (`records[0]`, integer cents), run the entry point once under the pinned interpreter, and quote `RUN_OK … outcome=INITIAL_BASELINE source=operator_entered(data_available=True)`.
**Exit:** one snapshot with `degraded: false`, zero notifications on the baseline day, one day lock.

**W3b — In-repo AgenticOS read route (recommended).**
**Expected Effort:** 4–8 h. **Time-to-Revenue:** indirect — it feeds revenue tracking (the same DB already reports 7 opportunities, 1 converted, V13).
**Dependencies:** W0, server on 4600, `FREECASH_READ_SOURCE`-style new kind wired into `monitoring/freecash/run_daily_check.py::read_source`.
**First Concrete Action:** `curl -m8 http://127.0.0.1:4600/api/revenue/metrics`, paste the **real** JSON into the new read-source test fixture (never a hand-made fixture), and map `earnings_total_cents` / `balance_cents` / `pending_cents` onto existing fields with an explicit `null` where the route has no equivalent.
**Exit:** a live authenticated-free GET yields a snapshot with `degraded: false`; failure of the route yields `READ_FAILED` + one deduped notification, not a crash.
**Note:** do not invent a `/api/v1/status/metrics` route — it does not exist (V11) and the legacy monitor's failure is exactly that mistake.

**W3c — Live provider account (BLOCKED).**
**Expected Effort:** unknown. **Time-to-Revenue:** unknown.
**Dependencies:** an authenticated FreeCash browser session, a documented read contract, and a credential stored in vault/env — never in chat or code.
**First Concrete Action:** one read-only authenticated GET probe, only after V14's blocker is cleared.
**Current evidence against it:** V14 (`unauthenticated`, `credentialAvailable:false`, no live session verification), V5 (no `FREECASH_*` key), V17 (`PROVIDER_ENDPOINT_UNKNOWN` literal in the enqueue payload). Keep it off the critical path.

### W4 — Scheduling (R1 on a real clock)
**Expected Effort:** 2–3 h. **Time-to-Revenue:** none.
**Dependencies:** W0–W2, W3a or W3b.
**First Concrete Action:** register the daily task in the non-elevated-compatible form (`schtasks /Create` without `/RL HIGHEST`), `-MultipleInstances IgnoreNew`, restart-on-failure = **Do not restart**, action pinned to the venv interpreter; trigger it manually, quote one run-log line, then trigger again the same day and quote `SKIP_DUPLICATE_DAY`.
**Exit:** `schtasks /Query /TN … /V /FO LIST` output quoted, plus both manual-trigger results. No task is registered until W0 is closed, because an unattributed second writer makes R1 unprovable.

### W5 — Notification sink (R3)
**Expected Effort:** 2–4 h, or blocked. **Time-to-Revenue:** none.
**Dependencies:** W1, W4.
**First Concrete Action:** run one seeded-change day with the shipped sinks (`alerts/alerts.jsonl` always-on, Windows toast default, `FREECASH_TOAST_STUB=1` for offline runs) and quote the single emitted payload with its `dedupe_key`.
**Exit:** exactly one payload for a real change; a delivery failure produces 2 attempts, one `DELIVERY_FAILED` record and then stops.
**Blocked variants:** email / webhook / SMS — no `SMTP_*`/`WEBHOOK_*` keys on the host and `himalaya` is not installed (V5).

### W6 — Approval surface + audit (R4)
**Expected Effort:** 3–5 h. **Time-to-Revenue:** none (it is the guardrail that keeps money-moving steps out of automation).
**Dependencies:** W1, W3a/b, W5.
**First Concrete Action:** enqueue one item on a seeded change, then run the CLI decision path with `--by "<human>" --note "…"` and quote the resulting line from `approvals/decided.jsonl`; confirm the record's `expires_at_utc` is `null` and `execution_state` is `NOT_EXECUTED`.
**Exit:** pending item unchanged after a simulated 90-day advance; every decision attributable to a named human; no code path exists that executes an approved action.

### W7 — Retire the competing monitors (non-destructive)
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none; removes a live source of false failure signal.
**Dependencies:** W1, W4.
**First Concrete Action:** find the launcher that keeps `scripts/monitoring/free-cash-daily-check.py` running (V10 shows activity at 21:10:50 today, and **no** scheduled task exists — V3/V4), quote the parent process/entry point, then disable it (documented, reversible) and confirm `logs/daily_monitor_runtime.log` stops growing.
**Candidates to disable, never delete:** `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `config/freecash-crontab` (points at a non-existent `/path/to/…`), the `finance-monitor/` package, and the older design docs — the latter get a one-line `SUPERSEDED — see <canonical spec>` header only, no rewrites.
**Exit:** only one monitor is live; `git status` shows those files unchanged on disk.

### W8 — Single-writer discipline against the live Jarvis workstream
**Expected Effort:** 0.5 h. **Time-to-Revenue:** none.
**Dependencies:** W0.
**First Concrete Action:** establish a written hand-off rule for `data/freecash-monitor` (state root) between this plan's implementer and the running Jarvis/FreeCash acceptance session (V15); the acceptance session may read the tree, never write it.
**Exit:** two consecutive days with writes attributable to exactly one actor.

---

## 4. Critical path

`W0 → W1 → W2 → (W3a or W3b) → W4 → W5 → W6 → W7`, with W8 in parallel from the start. W3c is off the critical path and blocked.

Ordering discipline: exactly one change between gate runs, so a red-to-green (or green-to-red) delta is attributable; no stage is reported complete from a claim — only from output quoted in the session that ran it.

---

## 5. Blocked / open register

| Item | Blocked on | Reason (verified this session) |
|---|---|---|
| Live FreeCash account status | authenticated browser session + read contract + credential | V14: `unauthenticated`, `credentialAvailable:false`, *"No live session verification exists."*; V5: no `FREECASH_*` key; prior research doc `PROVIDER-FINDINGS-REVERIFIED.md` records the ToS clause forbidding automated access — **not re-verified this session** |
| Email / webhook / SMS notification | `SMTP_*`/`WEBHOOK_*` credentials or mail tooling | V5: none configured; `himalaya` not installed |
| Any real withdrawal / earning action | human approval surface + R4 implementation | by design R4 never executes; no execution path exists in the routine |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | non-elevated host; plan uses the non-elevated-compatible task form |
| **O1 — writer of `data/freecash-monitor`** | attribution | V8/V9: root created today 21:08:00–21:08:01; identical suite re-run did not touch it; leading candidate is the parallel Jarvis acceptance session (V15). **Unresolved — must close before scheduling.** |
| **O2 — today's day lock is consumed** | operator decision | V8: `state/day-locks/2026-09-20.lock` exists, so the first live run today returns `SKIP_DUPLICATE_DAY`; snapshot for today is degraded with null fields |

---

## 6. Non-goals

- No rewrite, move or deletion of the parallel implementations (routine vs. legacy script vs. `finance-monitor/`) during this plan — disable, document, never delete.
- No live financial write path; R4 exists to keep it that way.
- No compliance claim from any earlier plan or PASS report — only from output quoted in the running session.
- No modification of unrelated uncommitted work on `hermes-rescue-20260908`; no destructive git operations.
- No changes under the voice-runtime paths listed in W5, and no new files that duplicate existing schema entities (`revenueOpportunities` already exists — reuse it).

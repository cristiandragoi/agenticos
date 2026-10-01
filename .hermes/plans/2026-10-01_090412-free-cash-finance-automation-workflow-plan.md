# WORKFLOW PLAN — Free Cash Finance Automation (2026-10-01, plan-mode)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463aa6931d57e12ec81b904b98cec04e932cf` · **Host:** Windows 11 (German-localised), git-bash, non-elevated
**Written:** 2026-10-01 09:01–09:04 operator-local (`date` → `Do,  1. Okt 2026 09:01:58`; UTC 07:01:58Z; Europe/Berlin, UTC+02:00)
**Supersedes (claims re-derived, not inherited):** `docs/free-cash-monitor-routine/WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V9-2026-10-01.md` (~20 min older), `…-V9-ADDENDUM-2026-10-01-GATE-SCOPE-AND-FALSE-COMPLIANCE.md`, `.hermes/plans/2026-09-30_205230-free-cash-finance-automation-workflow-plan.md`. Nothing in the V-series is edited by this file.
**Subject:** the daily status-monitoring routine `D:/AgenticOS/monitoring/freecash/` (entry point `run_daily_check.py`) and the revenue path it cannot unblock.
**Evidence standard (C1):** every row in §0 is a command executed in *this* pass. Nothing is quoted from an earlier session. Where a prior document's fact was checked, its outcome is stated as "unchanged / changed / falsified".
**Footprint:** this file is **new and additive**. No existing file was created, edited, moved, renamed or deleted in any other path. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created or modified. No credential written or read. No provider-side request. Every routine execution in this pass used a scratch `FREECASH_DATA_ROOT` under `/tmp` (suite + a temp root), and the real root's hash pair was taken and is published in §0/V12. The production root was **not** written by this pass — its only new artifacts (§0/V7) carry an 08:53 mtime from another actor, before this pass began.

---

## 0. Live state, every row executed in this pass (2026-10-01 09:01–09:04 local / 07:01–07:04Z)

| # | Command | Observed | Verdict |
|---|---|---|---|
| V1 | `date` / `date -u` | `Do,  1. Okt 2026 09:01:58` / `07:01:58Z` | clock of record |
| V2 | `FREECASH_DATA_ROOT=$(mktemp -d) <venv>/python.exe monitoring/freecash/tests/run_all.py` (exit read without a pipe) | `run_all: tests=52 failures=0 errors=0 skipped=0`, `suite_exit=0`; tail also shows `RUN_OK … INITIAL_BASELINE`, `SKIP_DUPLICATE_DAY 2026-10-01`, `WATCHDOG_OK`, `WATCHDOG_MISSED_DAY … last_attempt_day=None coverage=NOTIFIED` | suite **GREEN** (52/0/0); the negative watchdog paths are exercised in-suite |
| V3 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS`, `exit=0` | R2 static gate **GREEN**, baseline **28** |
| V4 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` (exit read without a pipe) | same counts, `PASS`, `exit=0` | both scanners agree |
| V5 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `exit=1`; `R1=FAIL  R2=PASS  R3=PASS  R4=PASS` | acceptance gate **RED**; R1 is a verifier-scope artefact (lock lives in `gate.py`), not an R1 violation |
| V6 | `ls -1la --time-style=long-iso data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` (09-20 21:08), `2026-09-30.lock` (09-30 21:01), **`2026-10-01.lock` (2026-10-01 08:53)** | **today is already consumed** — a live run now can only print `SKIP_DUPLICATE_DAY` |
| V7 | `ls -1 data/freecash-monitor/snapshots/` | `2026-09-20.json`, `2026-09-30.json`, **`2026-10-01.json`** | a null snapshot was written for today by the 08:53 run |
| V8 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, **`last_success_day=2026-10-01`**, `last_attempt_at_utc=2026-10-01T06:53:46Z`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `timezone=Europe/Berlin` | **a day with no reading is recorded as a SUCCESS day** (C6 violated) |
| V9 | `python -c json.load(operator-state.json)['records']` | `records=0` | no reading has **ever** been entered; R3/R4 have never run on real data |
| V10 | `ls -1a data/freecash-monitor/approvals/` | `.` `..` only | no approval item has ever existed |
| V11 | `wc -l alerts/alerts.jsonl` + per-line `json.load` | **15 lines**, `MISSED_DAY 10 / MONITOR_DEGRADED 3 / SKIP_DUPLICATE_DAY 2`; keys = `day_key, dedupe_key, event_id, event_type, message, observed, severity, ts_utc` (**no writer/pid**); last = `2026-10-01T06:53:46Z MONITOR_DEGRADED 2026-10-01` | log grew 14→15 since V9; lines remain **unattributable** (C8) |
| V12 | `sha256sum` real-root `last-run.json` + `alerts.jsonl` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9`, `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` | hash pair published as the tamper baseline for the next pass |
| V13 | `MSYS_NO_PATHCONV=1 schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -icE freecash`; `schtasks /Query /TN "FreeCash-Daily-Monitor"`; `… "FreeCash-Missed-Day-Watchdog"` | **278** rows, **0** freecash, both names → `FEHLER: Das System kann die angegebene Datei nicht finden.` | still **never scheduled**; nothing to undo before S7 |
| V14 | `git status --porcelain \| wc -l` | **863** lines (V9: 855, V8: 838) | footprint still growing |
| V15 | `env \| grep -icE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH"` | `0` | no credential, no external sink (C2 holds) |
| V16 | `curl -m5 :4600/api/health`; `:3001/health`; `tasklist \| grep -ic electron` | `4600=200`, `3001=000`, **0 Electron processes** | the app's *listener* is up; its *desktop shell* is not running (C12) |
| V17 | `sed -n '30,45p' monitoring/freecash/gate.py`; `grep -n SUCCESS_OUTCOMES -A6`; `grep -n covered monitoring/freecash/watchdog.py` | `SUCCESS_OUTCOMES = frozenset({OK_NO_CHANGE, INITIAL_BASELINE, EARNINGS_CHANGED, STATUS_CHANGED, BALANCE_CHANGED, `**`MONITOR_DEGRADED`**`})`; `gate.py:198-200 if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day`; `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | root cause of V8 confirmed on disk — "ran" is booked as "read" |
| V18 | `grep -n "acquire_day_lock\|resolve_source\|day = gate.day_key" monitoring/freecash/run_daily_check.py` | `:307 source_kind = resolve_source(...)`, `:308 day = gate.day_key(now)`, `:309 acquired, lock = gate.acquire_day_lock(day)` | the day is claimed **before** anything is read (C7 violated) |
| V19 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest package mtime **2026-09-20 06:59** (`changedetect.py`, `watchdog.py`); `gate.py` 2026-09-18 07:32 | **code unchanged for 11 days** — no fix has landed |
| V20 | read-only `sqlite3` on `C:\Users\cd-pr\AppData\Roaming\agenticos\data\agentic-os.db` (**208 187 392 B**) | `provider_credentials=2` → `[('omniroute',1,None),('antigravity',1,None)]` (**no freecash row**); `schedules=3`, all `0 9 * * *`, `enabled=1`, `last_triggered_at=NULL`; `background_tasks=416`, newest `%Free Cash%` rows all `cancelled`, `blocker="Cancelled during restart reconciliation — upstream run terminated."`, `updated_at=2026-09-27T13:02:56.824Z`; `revenue_ledger_entries=0`; `treasury_ledger=0`; `revenue_opportunities=7`; `revenue_missions=99` | no Free Cash credential; **no Free Cash timer has ever fired**; the mission fleet was cancelled by restart reconciliation on 09-27 |
| V21 | `curl -m8 :4600/api/revenue/metrics` | `{"totalOpportunities":7,"countsByStage":{"evaluated":6,"converted":1},"averageOverallScore":70,"totalAssets":0,…}` | the strongest in-repo read surface answers **live**; it reports pipeline counts, not account money |
| V22 | `curl -m8 :4600/api/projects/proj-free-cash/freecash/auth` | `sessionState="unauthenticated"`, `satisfied=false`, `blocker="FreeCash session evidence is stale (last live check 2026-09-23T15:32:31.406Z)."`, `evidence={sessionValid:false, `**`credentialAvailable:true`**`, `**`externalConnected:true`**`}` | the vertical's own gate: a credential exists and a session validated on **2026-09-23**; the blocker is now **staleness**, not "no verification exists" |
| V23 | `ls -d data/freecash data/freecash-monitor server/data/freecash-monitor` | all three exist | **three state roots** on disk (C8) |
| V24 | `find . -maxdepth 3 -iname "*freecash*.cmd" -o … ".bat" -o … "run_freecash*"` | no output | no wrapper exists — V9's C13 (scheduled run must not inherit ambient `FREECASH_*`) is still unimplemented |

### 0.1 What changed since V9 (≈20 minutes)

- **D-1 — the day-budget defect is now the live state, not a scratch repro.** At **08:53 local** (06:53:46Z) — *after* V9 was written at 08:46 — `run_daily_check.py` executed against the **production** root on a day with no operator record: it took `day-locks/2026-10-01.lock`, wrote a **null** `snapshots/2026-10-01.json`, advanced `last_success_day` to `2026-10-01`, and added 1 line to `alerts.jsonl` (14→15) (§0/V6–V11). Consequence for every later stage: **today is spent**, a live run today returns `SKIP_DUPLICATE_DAY`, and the first baseline of any new series cannot be `2026-10-01`.
- **D-2 — the Path-B blocker moved from "unverifiable" to "stale".** V9 quoted the auth route as `unauthenticated` with *"No live session verification exists."* Today the same route returns `credentialAvailable: true`, `externalConnected: true` and *"session evidence is stale (last live check 2026-09-23T15:32:31.406Z)"* (§0/V22). Path B needs a **fresh human login**, not a new integration — and it has a live URL to prove it either way.
- **D-3 — vocabulary of the revenue blocker changed.** V9 carried `bgtask-07a8154b0 … status=blocked, resumable=0` from the repo-tree DB. The runtime DB (§0/V20) now shows the newest `%Free Cash%` tasks as **`cancelled` at 2026-09-27T13:02:56Z** with `"Cancelled during restart reconciliation — upstream run terminated."`, `revenue_ledger_entries=0`, `treasury_ledger=0`. Restart reconciliation, not an approval gate, is what ended them.
- **D-4 — nothing else moved.** No reading (V9), no approval item (V10), no scheduled task (V13), no code change in the package since 2026-09-20 06:59 (V19), footprint 855 → 863 (V14), no credential in env (V15).

**One-line status:** the routine is green on its own suite and both read-only scanners, but the two defects that make it unsafe to schedule are both **live today** — a data-less run spends the calendar day and is booked as a success day that silences the watchdog (§0/V6–V8, V17–V18); the acceptance gate is still red for a scope reason (§0/V5); nothing has ever been scheduled, read, or approved (§0/V9–V13); and the only authenticated money path is gated on a browser session whose evidence went stale 8 days ago (§0/V22) while the mission fleet was cancelled by restart reconciliation on 09-27 (§0/V20).

---

## 1. Binding constraints (every stage is tested against these)

Rule ids `R1–R4` are the vertical's own canonical four (also in `server/src/domains/jarvisNext/operator/instructionResolver.ts`). Constraint ids `C1–C12` are **this document's**; where a V9 id covers the same rule its mapping is given, because the V-series reuses ids for different rules.

| ID | Constraint | Enforcement mechanism (verified this pass) | Proof demanded | V9 id |
|---|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py:119-135` `os.open(O_CREAT\|O_EXCL\|O_WRONLY)`; `gate.py:96 day_key()` | 1× `RUN_OK` + 1× `SKIP_DUPLICATE_DAY` same day; a race yields one winner | R1 |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py` deny-by-default GET/HEAD + both scanners exit 0 at `exempt=28` (§0/V3–V4) | both scanners green with the exemption count recorded; a mutation copy still fails | R2 |
| **R3** | notify exactly once per change | `changedetect.py::compare` on integer cents; dedupe key written before dispatch | seeded change → exactly one payload; no-change day → `OK_NO_CHANGE`, zero dispatches | R3 |
| **R4** | human approval before ANY external action; no execution path | `approval_queue.py`: `expires_at_utc` always null, `execution_state` always `NOT_EXECUTED`, named-human decider; machine deciders refused | decision recorded in `approvals/decided.jsonl`, `execution_state` unchanged; a pending item survives a clock advance | R4 |
| **C1** | evidence = output produced in the same session | each §0 row is a command run now | command + observed output quoted | C5 |
| **C2** | no secret in code, state, logs, plan or chat | `env` grep → 0 (§0/V15); secrets by vault/env only, `[REDACTED]` elsewhere | no credential in any artifact | C6 |
| **C3** | additive only; no destructive git; never disturb 863 uncommitted lines | `git status` before/after (§0/V14) | tracked-path status identical except the intended file | C7 |
| **C4** | one executable path per job — no third Free Cash implementation | `monitoring/freecash/` is the single authoritative monitor; extend it, never fork it | the stage names the file it extends | C8/C16 |
| **C5** | acceptance gate green **before** any scheduler registration | `rule_gate_verify.py` exit 0 **with the mutation probe still failing** | `R1..R4=PASS`, exit 0 | C9 |
| **C6** | "ran" ≠ "read": a run that produced no reading must never be counted, booked or reported as covered | **VIOLATED live** — `gate.py:32-40` puts `MONITOR_DEGRADED` in `SUCCESS_OUTCOMES`, `:198-200` advances `last_success_day`, `watchdog.py:33` then answers `WATCHDOG_OK` (§0/V8, V17) | a `data_available=False` run leaves `day-locks/` empty **and** leaves `last_success_day` unchanged; the watchdog reports that day `WATCHDOG_MISSED_DAY` | C19 |
| **C7** | never spend the day before a reading exists | **VIOLATED live today** — `run_daily_check.py:307-309` claims the day before the read at `:372`; `2026-10-01.lock` exists (§0/V6, V18) | a day with no reading leaves `day-locks/` empty after the run | C11 + V13 |
| **C8** | one state root, one writer, attributable lines | **OPEN** — three roots exist (§0/V23); no alert line carries a writer field (§0/V11) | one root holds state; each new alert line names its writer, or the operating window is documented | C14 + S2 |
| **C9** | interpreter of record = venv Python 3.11.9 | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (used for §0/V2) | the scheduled action names it; `py -3` (3.14, no `tzdata`) is rejected | C10 |
| **C10** | the monitor is a **visibility** instrument, not a revenue instrument | `revenue_ledger_entries=0`, `treasury_ledger=0` in the runtime DB (§0/V20) | every stage names Time-to-Revenue; only S8 may claim a path to cash | C20 |
| **C11** | first concrete action ≤ 1 command or ≤ 1 file append, measurable in the same session | 11 days, 12+ plan documents, 0 readings (§0/V9) | the action is quoted with its own output in the reply that proposes it | C18 |
| **C12** | scheduler registration stays with the operator; nothing may move a pending approval forward | no `schtasks` entry, 278 rows, 0 freecash (§0/V13) | the exact `schtasks /Create` text is handed over, **not executed** | S7 / R4 |

---

## 2. Stages (dependency order) — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

Ordering: `S0 → S1 → S2 → S3 → {S4, S5} → S6 → S7`, with `S8` separate and human-gated. One change between gate runs. A stage is complete only on output produced in the session that claims it; never widen an allowlist and exempt a scanner hit in the same change.

**S0 — Make the acceptance gate verdict-bearing (C5). 2–4 h · none · no dependencies.**
*First Concrete Action:* add a `--package <dir>` mode to `scripts/monitoring/rule_gate_verify.py` that attributes each rule to the module enforcing it (R1 → `gate.py::acquire_day_lock`, `gate.py:119-135`) instead of scanning only the 476-line entry file, which is why today's run reports `R1=FAIL` while R2–R4 pass (§0/V5).
*Exit:* `… --package monitoring/freecash` exits 0; on a temp copy whose `O_CREAT|O_EXCL` is replaced by `if lock.exists()`, it exits 1.
*Options:* **O-A repair the verifier's scope (2–4 h; recommended — today's red is a scope artefact, proven by §0/V5 plus `gate.py:119-135`)** · O-B restructure one file to carry R1 inline (3–5 h; rejected — a second copy of the lock mechanism, C4) · O-C declare C5 unsatisfiable and gate on a manual checklist (0.2 h; removes the only automatable gate).

**S1 — Make the day budget honest and the scheduled path safe (C6 + C7). 40 min – 6 h · none · no dependencies. Blocking for S7.**
*First Concrete Action:* write the failing test first — *"a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, and the watchdog reports `WATCHDOG_MISSED_DAY` for that day"* — then make coverage key on `data_available`, not on process completion (`gate.py:32-40`, `:198-200`, `watchdog.py:33`).
*Exit:* a data-less run leaves `day-locks/` empty, leaves `last_success_day` unchanged and makes the watchdog report `WATCHDOG_MISSED_DAY`; a day with a reading still yields one lock, one snapshot and `SKIP_DUPLICATE_DAY` on a second run; the concurrency test still shows one winner.
*Options:* **O-1 accounting only — drop `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` (~40 min; smallest change that makes the watchdog truthful; recommended)** · O-2 two-phase lock + accounting (3–5 h; an *attempt* record becomes a consumed day only on a successful read — deliberately weakens R1 to "one **successful** read per day" and must be recorded as such) · O-3 pre-flight guard in a wrapper `.cmd` (~1 h; refuse to invoke on a day with no record; R1 code untouched; needs the wrapper that does not exist, §0/V24) · O-4 both O-2 + O-3 (3–6 h) · O-5 keep strict R1 and stay manual (0 h; unattended operation stays blocked — today's safe default).

**S2 — One state root, one writer (C8). 30–60 min · none · no dependencies.**
*First Concrete Action:* declare `data/freecash-monitor` canonical (it holds every real artifact: three locks, three snapshots, the 15-line log, `last-run.json` — §0/V6–V12) and disposition the two others (`data/freecash`, `server/data/freecash-monitor`, §0/V23) in writing; record the chosen `FREECASH_DATA_ROOT` in the task definition.
*Exit:* exactly one root holds state; a scheduled run cannot create a second.
*Options:* **O-A declare `data/freecash-monitor` canonical and document the others as superseded (30–60 min; recommended — it is the only root with evidence in it)** · O-B migrate to `data/freecash` (2–4 h; moves the evidence trail and invalidates the V12 hash baseline; rejected unless a second consumer needs it) · O-C defer (0 h; leaves the hash baseline ambiguous).
*Second, separable sub-item:* the writer tag for `alerts.jsonl` (C8 second half) — 1–2 h; today 15 lines are unattributable (§0/V11), and the newest arrived 7 minutes after V9 was written (§0/V6).

**S3 — First real operator reading. 1 h setup + ~60 s/day · same day, visibility only (C10) · depends on S1 (else the first data-less run burns the day — live, §0/V6).**
*First Concrete Action:* append one record to `data/freecash-monitor/state/operator-state.json` for the **next** `day_key` (not 2026-10-01 — today is spent) with the four integer-cent figures, then run the entry point once and quote `RUN_OK … INITIAL_BASELINE`.
*Exit:* a baseline snapshot exists; a second day with one changed figure produces exactly one payload and one approval item.
*Honest limit:* every snapshot from this source is `degraded: true` by construction — a "no change" day only proves the same numbers were typed twice.

**S4 — Bridge Path B (authenticated app path) into Path A's read source. 4–8 h · 3–7 days of sight of the real account; no revenue (C10) · depends on a human starting the app and logging in (C12), and on S1.**
*First Concrete Action:* start the app, then call the existing probe once — `curl -m8 http://127.0.0.1:4600/api/projects/proj-free-cash/freecash/auth` (today: `unauthenticated`, `blocker="session evidence is stale (last live check 2026-09-23T15:32:31.406Z)"`, `credentialAvailable=true`, §0/V22) — and quote the payload before and after the login.
*Exit:* one day's reading produced through the app path and consumed by the existing `operator_state` source; both scanners still `exempt=28`; no new monitor module in `git status`.
*Options:* **O-A map the four figures from the existing session probe into `operator_state.py`'s shape (4–8 h; one mapping, no new module; recommended)** · O-B add a new read-source kind in `run_daily_check.read_source` backed by `/api/revenue/metrics` (4–8 h; answers today — §0/V21 — but reports pipeline counts, so `balance_cents`/`pending_cents` stay `null` and `degraded` must stay honest) · O-C wait for a published provider read API (unknown effort; freecash.com publishes none and forbids automated access — the clock is not engineering's).
*Do not:* create a third monitor (C4); widen `readonly_client.ALLOWED_PATHS` to a provider host in the same change as an exemption (R2); extend `server/src/adapters/freecashMonitorAdapter.ts` — its `fetchStatus()` hardcodes `externalConnected:false`/`statusAlerts:[]` and it enforces no rule.

**S5 — Delivery sink: prove the one that exists, or label the log as the sink. 0.5–1 h · none · depends on S3 or S4 (needs a change to deliver).**
*First Concrete Action:* with the session unlocked, dispatch one real toast and record the label (`TOAST_OK` vs `DELIVERY_FAILED`), then lock and repeat to exercise the bounded-failure path.
*Exit:* both labels written into the runbook.
*Blocked:* email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` key, no mail tooling, `env` grep = 0 (§0/V15).

**S6 — Approval surface (R4) reachable by a human. 2–4 h · none · depends on S3/S4 (the queue is unreachable until a change is detected — `approvals/` has never held an item, §0/V10).**
*First Concrete Action:* decide one enqueued item as a named human via the documented CLI and quote the append-only row plus `execution_state` staying `NOT_EXECUTED`; then repeat the machine-decider refusal.
*Exit:* every decision attributable to a human identifier; a `PENDING` item survives a clock advance unchanged; no execution path exists to be found.

**S7 — Hand over the scheduler registration; do not execute it (C5, C9, C12). 1–2 h + the operator's approval · none · depends on S0 green, S1 (O-1 minimum), S3, S2's pinned root.**
*First Concrete Action:* hand the operator the exact non-elevated `schtasks /Create` text for Task A (daily, `-MultipleInstances IgnoreNew`, `StartWhenAvailable`, restart-on-failure = Do not restart) whose action is the venv 3.11.9 interpreter + `D:/AgenticOS/monitoring/freecash/run_daily_check.py`, plus Task B (late-evening watchdog); **do not register it**.
*Exit:* a quoted `schtasks /Query … /V /FO LIST` showing both policies, plus a quoted duplicate-day refusal — or an explicit recorded decision not to schedule, in which case the routine stays *built and unverified in operation*. Verified today: 278 tasks, 0 Free Cash (§0/V13) — nothing to undo first.

**S8 — The revenue path (tracked so it is not silently dropped; C10). Effort unknown · the only stage with a direct revenue hypothesis, currently unbounded · depends on a human decision and the app running.**
*First Concrete Action (R-a):* with the app running, open the task cockpit and inspect the newest `%Free Cash%` rows — today all `cancelled`, `resumable` 0/1, `"Cancelled during restart reconciliation — upstream run terminated."`, `updated_at=2026-09-27T13:02:56.824Z`, and `revenue_ledger_entries=0` (§0/V20) — then decide re-dispatch vs stop.
*Options:* **R-a re-dispatch the mission from the cockpit (1–2 h, TTR unknown)** · R-b implement the missing publication step (unbounded, weeks-to-revenue if it works) · **R-c leave the monitor as visibility only (0 h, 0 revenue — the honest default while S0/S1 are red)**.

---

## 3. Options at a glance

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Gate (S0) | O-A repair verifier scope | 2–4 h | none | none | add `--package`; attribute R1 to `gate.py::acquire_day_lock` |
| Gate (S0) | O-B restructure one file | 3–5 h | none | none | move the lock inline (rejected: C4 duplicate) |
| Gate (S0) | O-C manual checklist | 0.2 h | none | none | write the checklist; gate becomes non-automatable |
| Day budget (S1) | O-1 accounting only | ~40 min | none | none | drop `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` |
| Day budget (S1) | O-2 two-phase lock + accounting | 3–5 h | none | decision to relax R1 wording | attempt→consumed-day ledger |
| Day budget (S1) | O-3 wrapper pre-flight guard | ~1 h | none | create the missing `.cmd` (§0/V24) | guard exits before invoking |
| Day budget (S1) | O-4 O-2 + O-3 | 3–6 h | none | both above | — |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | keep today's strict R1 |
| State root (S2) | O-A declare canonical | 30–60 min | none | none | mark the other two roots superseded |
| State root (S2) | O-B migrate to `data/freecash` | 2–4 h | none | second consumer | move evidence, re-baseline hashes |
| State root (S2) | O-C defer | 0 h | none | none | keep three roots |
| Reading (S3) | operator-entered record | 1 h + 60 s/day | **same day, visibility only** | S1 | append one record for the next `day_key` |
| Reading (S4) | O-A map the app session probe | 4–8 h | 3–7 days of sight; no revenue | app running + human login + S1 | quote the auth payload before/after login |
| Reading (S4) | O-B new source kind on `/api/revenue/metrics` | 4–8 h | indirect | app on :4600 | curl the route, paste real JSON as fixture |
| Reading (S4) | O-C wait for a provider API | unknown | unknown | published contract that does not exist | — |
| Delivery (S5) | toast sink | 0.5–1 h | none | S3/S4 | dispatch one toast, unlocked then locked |
| Delivery (S5) | email/SMS/webhook | blocked | none | SMTP/webhook key | none available (§0/V15) |
| Approval (S6) | CLI decision round-trip | 2–4 h | none | S3/S4 | decide one item as a named human |
| Schedule (S7) | task A + task B handover | 1–2 h + approval | none | S0, S1, S2, S3, C9 | hand over the `schtasks /Create` text; do not run it |
| Revenue (S8) | R-a / R-b / R-c | 1–2 h / unbounded / 0 h | unknown / weeks / 0 | app + human / app + decision / none | open the cockpit list |

---

## 4. Blocked / open register (each entry names the reason verified this session)

| ID | Blocker | Evidence from this pass |
|---|---|---|
| B1 | **No reading exists, so R3 and R4 have never fired** | `operator-state.json records=0`; `approvals/` empty (§0/V9–V10) |
| B2 | **The day is spent before the read, and a spent day is booked as success** | `day-locks/2026-10-01.lock` (08:53) + `last_success_day=2026-10-01` + `last_outcome=MONITOR_DEGRADED`; `SUCCESS_OUTCOMES` contains `MONITOR_DEGRADED` (§0/V6, V8, V17–V18) |
| B3 | **Acceptance gate red for a scope reason** | `R1=FAIL` on the entry file while the lock lives in `gate.py:119-135`; no `--package` mode (§0/V5) |
| B4 | **Never scheduled; operator registration outstanding (C12)** | 278 tasks, 0 freecash, both task names absent (§0/V13) |
| B5 | **Automatic account read blocked at the provider, not in the code** | freecash.com publishes no read API and forbids automated access; the runtime's own gate answers `unauthenticated` with stale evidence from 2026-09-23 (§0/V22) |
| B6 | **Off-host delivery blocked** | no `SMTP_*`/`WEBHOOK_*` in `env`; `grep -ic` = 0 (§0/V15) |
| B7 | **Three state roots; alert lines unattributable** | three roots exist; 15 alert lines carry no writer field (§0/V11, V23) |
| B8 | **Revenue path dormant** | runtime DB: newest `%Free Cash%` tasks `cancelled` 2026-09-27T13:02:56Z; `revenue_ledger_entries=0`; `treasury_ledger=0` (§0/V20) |
| B9 | **The app's timing components are unreachable to a monitor** | `:4600` answers 200 but 0 Electron processes run and no Free Cash schedule has ever triggered (`last_triggered_at=NULL`) (§0/V16, V20) |

---

## 5. Decisions requested from the operator

| # | Decision | Default if unanswered |
|---|---|---|
| 1 | S1: O-1 (accounting only) / O-2 / O-3 / O-4 / O-5 | **O-1** — smallest honest change; unattended scheduling stays blocked |
| 2 | S0: O-A / O-B / O-C | **O-A** — repair the verifier rather than reshape the routine |
| 3 | S2: which root is canonical, and do the other two get marked superseded | **`data/freecash-monitor`**, others marked superseded |
| 4 | S3: do you enter readings daily (the only source that can produce a truthful number today) | **no** → the monitor stays permanently `MONITOR_DEGRADED` |
| 5 | S4/S8: start the app and log in to FreeCash in the managed browser profile | **deferred** → Path B stays `unauthenticated` |
| 6 | S7: register the two scheduled tasks or not | **not registered** |
| 7 | S8: R-a / R-b / R-c | **R-c** — visibility only |

---

## 6. Non-goals (explicitly out of scope for this plan)

1. **No third monitor implementation** (C4). Nothing here forks `monitoring/freecash/`, extends the stub adapter, or adds a provider host to the read allowlist.
2. **No code that moves money or resolves an approval.** `execution_state` stays `NOT_EXECUTED`; no retry/timeout may advance a pending item (R4).
3. **No scheduler registration, and no elevated command** (C12).
4. **No deletion, move or edit of `monitoring/**`, `docs/free-cash-monitor-routine/**`, `finance-monitor/**`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `config/freecash-crontab`, or the legacy `.mjs` verifiers** — all untracked, so an edit is unrecoverable; deprecation is an index entry, not a deletion.
5. **No credential handling of any kind** (C2); no provider-side request.
6. **No revenue claim from any monitoring stage** (C10).
7. **No consolidation of the ~30 existing free-cash plans** beyond naming a canonical set in S2/S9-style index work.

---

## 7. Definition of done (numbered, each falsifiable)

1. `scripts/monitoring/rule_gate_verify.py --package monitoring/freecash` exits **0** with `R1..R4=PASS`, and exits **1** on a temp copy with `O_CREAT|O_EXCL` replaced by `if lock.exists()` (C5).
2. On a day with no operator record, a run leaves `day-locks/` **empty**, leaves `last_success_day` unchanged, and `watchdog.py` prints `WATCHDOG_MISSED_DAY` for that day (C6, C7).
3. A day **with** a reading yields exactly one lock, one snapshot and `SKIP_DUPLICATE_DAY` on a second same-day run (R1).
4. Both read-only scanners exit 0 at `exempt=28`, and a mutation copy carrying `requests.post(..., "/withdraw")` still fails (R2).
5. One state root holds all state; each new `alerts.jsonl` line names its writer, or the operating window is documented and the next bundle proves no line appeared outside it (C8).
6. `records >= 1` in `operator-state.json`; a day-2 changed figure produces exactly one notification and exactly one approval item labelled `ACTION_HUMAN_REVIEW` (R3).
7. One approval decided by a named human appears in `approvals/decided.jsonl` with `execution_state=NOT_EXECUTED`; a machine decider is refused (R4).
8. Scheduled runs, if registered, are quoted from `schtasks /Query … /V /FO LIST` with the venv 3.11.9 action, `IgnoreNew`, `StartWhenAvailable`, restart-on-failure = Do not restart — or an explicit recorded "not scheduled" decision exists (C5, C9, C12).
9. Every claim in the acceptance report carries a command executed in the session that writes it (C1).

**Honest reading of today:** the monitor is built, self-tested and green on its own suite, but it is **not operating** — never scheduled, never fed a reading, never approving anything — and its two most dangerous behaviours (spending the day before reading, and booking a data-less run as a success that silences the watchdog) are both **observable in the live state root right now**, which is why S1 precedes every scheduling and revenue stage.

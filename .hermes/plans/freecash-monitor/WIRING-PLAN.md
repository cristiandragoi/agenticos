# Free Cash Daily Monitor — WIRING + INTEGRATION PLAN

Repo: `D:\AgenticOS` · branch `hermes-rescue-20260908` · 2026-09-20
Status: **PLANNING ONLY — no production source file was created, modified, moved or deleted.**
This plan is the artifact that must be approved before any change is made.

Rules used in THIS document (the task's numbering; note the repo's own docs and
`server/scripts/verify-freecash-rules.mjs` use an inverted numbering — see
`docs/free-cash-monitor-routine/AUDIT-RULE-COMPLIANCE.md:19-22`):

| ID | Rule |
|----|------|
| **R1** | No automated earning action — ever |
| **R2** | Exactly one check per day |
| **R3** | Notify on earnings / account-status change |
| **R4** | Human approval before any external action; never auto-executed |

---

## 0. Method and what was actually executed

Every claim below is either a static read (file:line) or a command I ran in this
session. Commands run (all read-only; no network; no source file written):

```
node --check server/scripts/freecash-daily-monitor.mjs        # exit 1, SyntaxError ':' line 41
node --check server/scripts/verify-freecash-rules.mjs         # exit 0 (parses)
node -e "…node-cron check…" / grep server/package.json        # node-cron ^4.6.0 present
python monitoring/freecash/tests/run_all.py                   # tests=52 failures=0 errors=0 skipped=0, exit 0
bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash
                                                              # forbidden=0 exempt=28 missing_targets=0, PASS, exit 0
python monitoring/freecash/run_daily_check.py --help          # usage printed, exit 0
node -e "…better-sqlite3 read…" server/data/agentic-os.db     # schedules=4 enabled, background_tasks=1157
schtasks /Query /FO csv /NH                                   # 275 tasks; no freecash/finance/monitor task
schtasks /Query /TN Hermes_Gateway /V /FO LIST                 # at-logon trigger, last result 0
hermes cron list                                              # "No scheduled jobs."
git ls-files --error-unmatch <file>                           # tracking state of every named artifact
```

`python monitoring/freecash/*` was run with `PYTHONDONTWRITEBYTECODE=1`; the state
root is byte-identical before and after (all 5 files under `data/freecash-monitor/`
still carry their 2026-09-20 21:08 mtimes, epochs 1789931280–1789931281).

---

## 1. Every scheduling mechanism present in the repo, and whether it is live today

| # | Mechanism | Definition | Registered / enabled **today**? | Evidence |
|---|-----------|-----------|--------------------------------|----------|
| 1 | **node-cron scheduler** (`activeCronJobs` Map) | `server/src/services/scheduler/scheduler.ts:12`, `:52-104`, `:138-157` | **YES — ACTIVE.** Booted unconditionally at `server/src/index.ts:66-67`. It registers every `enabled` row with a `cron_expression` (`scheduler.ts:65-72`). The live DB `server/data/agentic-os.db` holds **4 enabled schedules**, all with cron expressions → **4 jobs registered at runtime today**. Three carry `last_outcome='completed'` with real fire timestamps (`2026-09-09T08:00:00Z`, `2026-09-07T08:00:00Z`, `2026-09-19T18:05:00Z`) → the mechanism is proven live, not merely present. | `scheduler.ts:12,52-104,138-157`; `index.ts:66-67`; sqlite read of `server/data/agentic-os.db` (`schedules`) |
| 2 | **Misfire / catch-up recovery** | `scheduler.ts:74-101` (gate at `:89` `if (!lastTriggered && created)`) | **PARTLY LIVE, PARTLY DEAD.** It runs at boot for enabled rows, but the gate requires a non-null `created_at`. Live row `sched-cd341dac-6e5c-4aca-90e2-1a790f1d67ad` has `created_at = NULL` → its recovery branch can never execute. `run_once` fires at most **once per boot** (`:92-94`); `skip` records an outcome without firing (`:95-97`). | `scheduler.ts:74-101`; sqlite read (one row with `created_at NULL`) |
| 3 | `seedDefaultSchedules()` | `server/src/routers/schedules.ts:141` | **CALLED BUT A NO-OP.** It is literally `export const seedDefaultSchedules = async () => {};` and is invoked at boot (`index.ts:384`). It seeds **zero** schedule rows — which is why the 4 live rows are user-created, not defaulted. | `schedules.ts:141`; `index.ts:107,384` |
| 4 | **REST schedule CRUD** | `schedules.ts:12-139`; mounted `index.ts:299` | **ACTIVE.** `POST /api/schedules` inserts a row and immediately `registerCronJob(...)` (`:79-81`); `PATCH` re-registers/unregisters (`:113-117`); `DELETE` unregisters (`:131`). This is the only supported way to add a cron job to a running server. | `schedules.ts:79-81,113-117,131`; `index.ts:299` |
| 5 | **`worker_task` dispatch bridge** | `scheduler.ts:112-120` → `services/scheduler/scheduleDispatcher.ts:1-21,70+` | **ACTIVE.** Fires a canonical background task through real worker adapters, writes `schedule_executions` provenance rows and events. Two live rows use it (`schedule-revenue-daily-briefing`, `schedule-revenue-supervisor-tick`). | `scheduler.ts:112-120`; `scheduleDispatcher.ts:1-21`; `routines/store.ts:70-107,242-278`; sqlite read |
| 6 | **`automation` worker that self-registers a cron job** | `services/backgroundTasks/adapters.ts:1213-1249` (insert `schedulesTable` `:1222-1229`, `registerCronJob` `:1231`) | **ACTIVE code path.** A task with `worker:'automation'` creates a new schedule row and cron job as its *work product* — a scheduler-of-schedulers. Its own event text admits the missing back-channel (`:1239`). | `adapters.ts:1213-1249`; dispatch switch `:1775` |
| 7 | **In-process `setInterval` / `setTimeout` loops** | `index.ts:212` (stale runs, 5 min), `:217-222` (news radar, 4 h), `:228-230` (supervisor, 60 s), `:233-237` (synthetic attribution, 60 s), `:363-365` (evaluation loop, boot only) | **ACTIVE, unconditional, in-memory.** No persistence, no day-idempotency, no catch-up, and they die with the process. | `index.ts:212,217-222,228-230,233-237,363-365` |
| 8 | Run worker | `startRunWorker()` | **ACTIVE** (`index.ts:64`). Executes runs; it is not a scheduler. | `index.ts:64` |
| 9 | **BackgroundTaskManager** | `index.ts:389-391` (`restoreAfterRestart()`); `manager.ts:131-166` | **ACTIVE.** 1157 rows in `background_tasks`. Restores interrupted work at boot and re-materialises pending approvals in memory from persisted events (`manager.ts:148-166`). | `index.ts:389-391`; `manager.ts:114-166`; sqlite read |
| 10 | FreeCash auth reconcile boot hook | `index.ts:398-401` → `services/freeCash/freeCashExecutor.ts:397-417` | **ACTIVE, but not a scheduler.** Boot-time, once per process (`:395-402`), auth-evidence only. | `index.ts:398-401`; `freeCashExecutor.ts:395-417` |
| 11 | **Hermes cron** | `hermes cron` CLI, `%LOCALAPPDATA%/hermes/cron/` | **CAPABILITY INSTALLED, 0 JOBS.** `hermes cron list` → *"No scheduled jobs."* The ticker is alive (`cron/ticker_heartbeat`, `ticker_last_success` updated 2026-09-20 21:28), and it is kept alive by an **OS-scheduled task** (see #12). | `hermes cron list`; `ls ~/AppData/Local/hermes/cron` |
| 12 | **Windows Task Scheduler** | `schtasks` | **ACTIVE, WITH A WORKING PRECEDENT.** 275 tasks exist. The only Hermes/AgenticOS-related one is `\Hermes_Gateway` — trigger type *"Bei der Anmeldung"* (at logon), action `wscript.exe //B //Nologo "C:\Users\cd-pr\AppData\Local\hermes\gateway-service\Hermes_Gateway.vbs"`, last run 2026-09-17 08:46:06, **last result 0**. **No FreeCash / finance / monitor task exists.** | `schtasks /Query /FO csv /NH`; `schtasks /Query /TN Hermes_Gateway /V /FO LIST` |
| 13 | `config/freecash-crontab` | plain text file | **NOT A SCHEDULER.** A Unix crontab template whose only command line contains the literal placeholder `/path/to/AgenticOS`; there is no cron daemon on this host. Documentary only. | `config/freecash-crontab` (line 8); `schtasks` evidence |
| 14 | `monitoring/freecash/watchdog.py` | `monitoring/freecash/watchdog.py:1-17` | **NOT A SCHEDULER — an R2 alarm.** Same-evening "did the check run?" detector: opens no socket, never writes the ledger/lock/snapshot/queue; its only writes are `alerts/alerts.jsonl` and `state/notified-keys.json`; always exits 0. It only becomes useful if *something* invokes it on a schedule. | `watchdog.py:1-17` |

**Net:** the repo has exactly one *live production* scheduler (#1, in-process node-cron,
4 enabled jobs) plus one *live OS* scheduler host (#12, Task Scheduler, with a working
AgenticOS precedent). Hermes cron is installed with zero jobs. `config/freecash-crontab`
and `seedDefaultSchedules()` are inert.

---

## 2. Decision: what the once-per-day check hangs off, and what happens when the app is closed

### 2.0 The fact that decides this

The monitor candidate **already enforces exactly-once-per-day internally**, not via its
scheduler: `monitoring/freecash/gate.py:119-128` takes an atomic
`os.open(lock, O_CREAT | O_EXCL | O_WRONLY)` day lock, and a duplicate invocation prints
`SKIP_DUPLICATE_DAY`, appends exactly one alert line and exits 0 having performed no read
and written no snapshot (`monitoring/freecash/run_daily_check.py:6-8,313-320`). This is
reproduced in the evidence file on disk: `data/freecash-monitor/alerts/alerts.jsonl`
contains a `SKIP_DUPLICATE_DAY` record for 2026-09-20 alongside the run record.

**Consequence:** the scheduler does not carry R2. The scheduler only has to provide
*at-least-once firing*; the day-lock converts that to *exactly-once reading*. This makes
the choice a pure reliability question — and it removes the "two triggers would break R2"
objection that blocked earlier plans.

### 2.1 CHOSEN: Windows Task Scheduler (one OS task), as the single trigger

**Decision:** register **one** daily OS task whose action is the pinned Python interpreter
running `D:/AgenticOS/monitoring/freecash/run_daily_check.py`, plus **one** evening OS task
running `watchdog.py` (same-evening missed-day alarm). Nothing else triggers the check.

Why:

1. **It is the only mechanism that fires while the desktop app is closed.** Every Node-based
   candidate (#1, #6, #7) lives inside the backend process `server/dist/index.js` spawned by
   Electron (`electron/backendLifecycle.ts:1-27,76-80`) — if the app is off, they are off.
   A monitor whose entire purpose is to notice that the account/app was silent must not be
   hosted by the thing it watches.
2. **It gives real catch-up semantics, the Node path cannot.** Task Scheduler's
   *"run as soon as possible after a missed start"* (`StartWhenAvailable`) fires a missed run
   once when the machine next becomes available. The in-repo equivalent is a single-shot
   heuristic (`scheduler.ts:78-101`) that is *silently dead* for any row with NULL
   `created_at` — one of the 4 live rows is already in that state.
3. **Missed runs are reported, not back-filled.** After a catch-up, the routine computes the
   uncovered days and emits `MISSED_DAY` records for them (`gate.py:208-231`,
   `run_daily_check.py:333-339`) instead of pretending the gap did not happen. Missing a day
   is therefore *visible*, which is the property R3 actually needs.
4. **No new runtime, no bridge.** The monitor is Python-3-stdlib-only
   (`monitoring/freecash/paths.py:1-16`, zero third-party imports); Task Scheduler can invoke
   it directly. Any in-app route would require a Node→Python execution bridge that does not
   exist anywhere in `server/src`.
5. **The host already proves the pattern.** `\Hermes_Gateway` is a registered, activated,
   last-result-0 Task Scheduler entry for AgenticOS-adjacent tooling. This is not a new
   operating mode for this machine.

### 2.2 Rejected as the trigger (each for a stated reason)

| Candidate | Verdict | Why — and what happens to the daily check when the app is closed |
|---|---|---|
| **#1 node-cron `schedules` row** | **REJECTED as trigger** (keep for unrelated existing jobs) | Live and proven, but it stops when the backend stops. **App closed → NO run.** Catch-up is single-shot per boot and defeated by a NULL `created_at` (`scheduler.ts:89`). Placing the monitor's only trigger inside the process it monitors is disqualifying. |
| **#6 `automation` worker** | **REJECTED** | It schedules *other* work by writing a `schedules` row (`adapters.ts:1222-1231`), so it inherits every weakness of #1, plus it claims completion immediately (`:1236-1240`) — it would assert success for a check that has not happened. |
| **#7 in-process intervals** | **REJECTED** | No persistence, no day-idempotency, no catch-up; `setInterval` with a 4-hour or 60-second period is structurally the wrong shape for "once per day". **App closed → NO run.** |
| **#11 Hermes cron** | **NOT the trigger; keep as an OPTIONAL R3 delivery upgrade** | It *can* reach the human (a session/digest channel) and its ticker is alive — but its own liveness is provided by an **at-logon OS task** (`\Hermes_Gateway`), so using it as the trigger chains a daily job behind a gateway that must already be up. With 0 jobs today it is also the only job on an unproven path in this repo. **App closed → no ticker → NO run.** Adopt *only* for delivery, *only* after the OS trigger is proven. |
| **#13 `config/freecash-crontab`** | **REJECTED / inert** | Placeholder paths, no daemon on this host. Nothing to hang off. |

### 2.3 Explicit answer to "missed-run catch-up vs skip"

| Mechanism | App closed at 08:05 | Next launch / next boot behaviour |
|---|---|---|
| **OS Task Scheduler (chosen)** | Run occurs (host awake) or is deferred | `StartWhenAvailable` → fires **once** as soon as possible; the routine then consumes *that* day and emits `MISSED_DAY` for any uncovered day (never back-fills them) |
| node-cron (#1) | **Skipped** | `run_once` misfire branch may fire **once** at boot — but only if `created_at` is non-null; `skip` policy never fires (`scheduler.ts:92-97`) |
| Hermes cron (#11) | **Skipped** | No gateway → nothing records the miss; the job never learns it missed |
| Intervals (#7) | **Skipped** | Resumes on the next interval tick; no memory of the gap |

---

## 3. End-to-end trace: how the result reaches the human (R3) and where R4 approval lives

### 3.1 The chain today (as far as it actually goes)

```
[TRIGGER — missing today]                      ≈ nothing invokes the routine
        │
        ▼
monitoring/freecash/run_daily_check.py:467-476   single entry point (main → sys.exit)
        │
        ├─ R2  gate.py:119-128   atomic O_CREAT|O_EXCL day lock
        │        duplicate → run_daily_check.py:313-320 "SKIP_DUPLICATE_DAY", exit 0
        │        --force-recheck is accepted only to be refused (:27,:259-260), refusal logged
        │
        ├─ R1  read-only source: operator_state (default, :52) or allowlisted GET/HEAD
        │        static proof of no write verb in the tree:
        │        verify-readonly.sh monitoring/freecash → forbidden=0 PASS exit 0 (reproduced today)
        │
        ├─ R2  MISSED_DAY records for uncovered days (gate.py:208-231, run_daily_check.py:333-339)
        │
        ├─ R3  changedetect + notify, one line per distinct change, dedupe key written
        │        before dispatch → at most one notification per change (:176,:210; MAX_NOTIFICATIONS=5 :55)
        │
        ├─ R4  approval_queue.py:111  build_item → action_type frozen
        │        approval_queue.py:131-132  expires_at_utc = null ; execution_state = NOT_EXECUTED
        │        NON_HUMAN_DECIDERS frozenset (:55-57) rejects machine signers (:153)
        │        → enqueue ONLY. No execution path exists in the routine (run_daily_check.py:23-24).
        │
        ▼
STATE ROOT  D:/AgenticOS/data/freecash-monitor/     (paths.py:35, override FREECASH_DATA_ROOT :47)
        ├── state/last-run.json            ← exists: last_outcome MONITOR_DEGRADED, 2026-09-20T19:08:00Z
        ├── state/day-locks/<day>.lock     ← exists: 2026-09-20.lock
        ├── state/operator-state.json      ← exists: records: []  (empty!)
        ├── snapshots/<day>.json           ← exists: 2026-09-20.json
        ├── alerts/alerts.jsonl            ← exists: 2 lines (MONITOR_DEGRADED, SKIP_DUPLICATE_DAY)
        └── approvals/{pending.json,decided.jsonl}   ← not yet created (no change has been enqueued)

        ▼
*** NOTHING IN THE APPLICATION READS THIS DIRECTORY ***
   grep "freecash-monitor" over server/src , src/ , electron/  → no reader.
   R3 IS THEREFORE UNENFORCED END-TO-END: the result reaches a human only as files + a CLI.
```

### 3.2 The surfaces that *do* reach the human, and what to flow the alert through

These already exist, are polled by the shipped UI, and need **no new notification channel**:

| Surface | Definition | Already consumed by |
|---|---|---|
| `GET /api/background-tasks/summary` | `server/src/routers/backgroundTasks.ts:39-45` → `manager.ts:1290-1299` | `src/pages/JarvisStudio.tsx:815`; `src/pages/MissionControlPage.tsx:69` |
| `GET /api/background-tasks/approvals` | `backgroundTasks.ts:47-53` → `manager.ts:898` | `JarvisStudio.tsx:932,968`; `MissionControlPage.tsx:70` |
| `GET /api/background-tasks/:taskId/events` (SSE, with persistence catch-up) | `backgroundTasks.ts:106-138`; events emitted at `manager.ts:687` | `JarvisStudio.tsx:872` |
| Task detail incl. `pendingApproval` | `backgroundTasks.ts:99-104` | `JarvisStudio.tsx:872+` |

**Recommended pipeline (needs approval — nothing applied):** add a read-only ingestion
router `server/src/routers/freeCashMonitor.ts`, mounted in `index.ts` alongside the existing
routers (`index.ts:295-299` pattern), exposing exactly three endpoints:

- `GET /api/freecash-monitor/status` → `state/last-run.json` + latest `snapshots/<day>.json`
  + tail of `alerts/alerts.jsonl`. Pure read; it must never write the state root, never
  create a lock, never run the check.
- `GET /api/freecash-monitor/approvals` → `approvals/pending.json` + tail of `decided.jsonl`.
- `POST /api/freecash-monitor/approvals/:id/decide` → delegates to the **existing**
  `approval_queue.decide(approval_id, decision, by, note)` code path
  (`monitoring/freecash/approval_queue.py:161-197`), requiring an explicit human `by`
  identity. The `NON_HUMAN_DECIDERS` guard (`:55-57`, enforced `:153`) is retained.

The alert then appears on the surfaces in the table above; the UI change is additive (one
panel + one decision button), not a new notification system.

### 3.3 Where the R4 approval queue lives — human-initiated, never auto-executed

Two layers, deliberately separated:

**Layer 1 — durable source of truth (already implemented, in the routine):**
`data/freecash-monitor/approvals/pending.json` and the append-only
`approvals/decided.jsonl` (`monitoring/freecash/paths.py:91-95`). Written by
`approval_queue.py` (`build_item` `:108-140`, `decide` `:161-197`). Every item is frozen at
enqueue time with `expires_at_utc = null` (`:131-132`) and `execution_state = NOT_EXECUTED`
(`:132`, re-asserted on decision `:180-181`, `:196-197`). Human decision CLI —
`approval_queue.py:241-255`: `decide --id … --decision approve|reject --by "<your name>" --note "…"`;
after a decision it prints `execution_state=… (unchanged; this routine executes nothing)`
(`:296`). A machine signer is refused at `:153`.

**Layer 2 — the in-app UI queue to mirror it into (already implemented, generic):**
the background-task approval machinery, which is the correct home for the R4 UI because it
is *already* human-initiated and *already* survives restarts:

| Piece | Definition | Property preserved |
|---|---|---|
| Create a pending approval | `manager.ts:822-857` — normalises via `approvalNormalization.ts`, transitions the task to `waiting_approval` (`:847`) and emits `task.approval_requested` (`:848`) | Creating a *request* is not an action |
| HTTP entry | `POST /api/background-tasks/:taskId/request-approval` — `backgroundTasks.ts:197-209` | |
| List pending | `manager.ts:898` → `GET /api/background-tasks/approvals` (`backgroundTasks.ts:47-53`) | |
| **Resolve (the only mutation path)** | `POST /api/background-tasks/:taskId/approval` with `choice: 'allow' \| 'deny'` — `backgroundTasks.ts:211-233` → `manager.ts:911` | Requires an explicit choice; `400` otherwise (`:216-218`) |
| Who can call it | only the UI: `src/pages/JarvisStudio.tsx:991` and `src/pages/MissionControlPage.tsx:113` | No cron, no worker, no adapter calls it |
| Nothing auto-resolves | `manager.ts:148-166` — after a restart a pending approval is **re-materialised from the persisted event**, never dropped and never auto-approved; `TERMINAL_STATUSES` guarded at `:824`, `:861` | R4 holds across restarts |

**Non-negotiable invariant for this plan:** the in-app decision must record a *human
opinion*, not execute anything. `execution_state` stays `NOT_EXECUTED`; there is no
execution code path in the routine (`run_daily_check.py:23-24` — *"There is no execution
code path here at all"*). Any future external action is a **separate, explicitly approved
piece of work** with its own gate — not a consequence of this wiring.

---

## 4. Dead-code artifacts to retire or quarantine so there is ONE monitor implementation

**The ONE implementation to keep and consolidate on: `monitoring/freecash/`** — Python
stdlib only, single entry point, R1 enforced by absence of any write verb (`verify-readonly.sh`
→ `forbidden=0 PASS`, reproduced today), R2 by the atomic day lock, R3 by dedupe-keyed
change detection, R4 by enqueue-only approval with a NON_HUMAN_DECIDERS guard. Its own suite
is **green**: `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0`, exit 0.

> Note: `docs/free-cash-monitor-routine/AUDIT-RULE-COMPLIANCE.md:205-217` recommends
> consolidating on `scripts/make_freecash_check.py` instead, and
> `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md:30` reports the
> `monitoring/freecash` suite as red (7 failures / 11 errors, `approval_queue.py:111`
> `NameError`). **Both statements are now stale** and were re-checked today: line 111 reads
> `ACTION_LABEL_FOR_HUMAN_REVIEW`, which *is* defined at `:52`, the suite is green, and
> `make_freecash_check.py` still carries a live `withdraw` construct (§4 row 5). Do not act
> on the older recommendation.

| # | Artifact | Classification (evidence) | **Disposition** |
|---|---|---|---|
| 1 | `server/src/adapters/freecashMonitorAdapter.ts` | **STUB / NOT WIRED.** `fetchStatus()` hardcodes `externalConnected: false` (`:206`) and `statusAlerts: []` (`:203`); "once per day" is `input.prompt.includes('double-check')` (`:99`, `:118`) — a substring test, not a schedule; `evaluateRules()` returns on every branch (`:211-219`). Not registered: `index.ts:141-145` registers only Hermes/Jarvis/Codex/Video/HeavyGen, and `services/runtimeRegistry.ts:16-35,123` contains no free-cash entry. This file is the source of the false impression that the monitor is wired. | **RETIRE** (delete from `src/`). Do *not* register it. |
| 2 | `server/scripts/freecash-daily-monitor.mjs` | **BROKEN.** `node --check` → `SyntaxError: Unexpected token ':'` at line 41, exit 1 (reproduced today): TypeScript annotations in a `.mjs` (`:41`, `:91`, `:137`, `:194`, `:252`) plus `require()` in ESM (`:14`). Nothing it contains can ever run. | **RETIRE** |
| 3 | `server/scripts/verify-freecash-rules.mjs` | **FALSE VERIFIER.** Exits 0 printing "4/4 PASSED" while checking only source *text*, against file #2 which does not compile; two of its four checks are unconditional tautologies. It manufactures compliance evidence rather than producing it. | **RETIRE** (it is worse than absent: it reports success) |
| 4 | `server/dist/adapters/freecashMonitorAdapter.js`; `release/win-unpacked/resources/server/scripts/freecash-daily-monitor.mjs`; `release/win-unpacked/resources/server/scripts/verify-freecash-rules.mjs` | Build/package twins of #1–#3, shipped in `release/`. | **QUARANTINE** (regenerate from a clean build; must not ship in the next release) |
| 5 | `scripts/make_freecash_check.py` | **R1 HAZARD.** `prepare_actions()` constructs a `withdraw` action (`:18-21`), the loop executes each approved action (`:85-87`) through `run_action()`, a stub that returns `success = True` (`:49-52`); approval is stdin-only (`:33`) so it raises `EOFError` under any scheduler; and `config/freecash-crontab:8` points at **this** file. | **RETIRE** — the single most dangerous consolidation target in the repo |
| 6 | `config/freecash-crontab` | **DOC-ONLY / INERT.** The only command line contains the literal placeholder `/path/to/AgenticOS`; Unix crontab format with no cron daemon on this host. | **RETIRE** (replace its role with the documented `schtasks` registration from §5 W1) |
| 7 | `scripts/finance_monitor.py`, `scripts/notification_service.py`, `scripts/approval_gate.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/tasks/daily-finance-monitor.py`, `server/tasks/register_approved_change.py`, `server/tasks/README_daily-monitor.md`, `server/tasks/last_run_time.json`, `server/tasks/daily_monitor.log` | No live caller anywhere; each carries an independent defect documented in `docs/free-cash-monitor-routine/AUDIT-RULE-COMPLIANCE.md` §a–§b (unawaited `async`, `NameError`, gates never called, unverifiable tokens, 24 h window instead of a calendar day). | **QUARANTINE** (move, as a set, to a single `_superseded/` folder after approval) |
| 8 | `finance-monitor/**` (repo root; incl. `.VERIFIED.md`, `.COMPLETION_REPORT.md`, `src/rule_engine.py`, `src/wait_gate.py`) | **NON-RUNNABLE SKELETON + R4 VIOLATION.** `src/rule_engine.py:122` is a `SyntaxError` (its own test cannot import); the only approval gate fabricates consent via `random.choice`; the verification docs claim READY. | **RETIRE** (do not consolidate here under any circumstances) |
| 9 | Overlapping design docs: `daily-status-monitoring-specification.md`, `DAILY_MONITORING_DESIGN_SUMMARY.md`, `design_doc.json`, `finance_monitor_plan.json`, `script_schedule_spec.json`, `free-cash-automation-workflow.md`, `free-cash-finance_monitoring_plan.md`, `free-cash-finance-monitoring-specification.md`, `docs/freecash-monitoring.md`, `docs/freecash-automation-workflow-plan-v2.md`, `docs/freecash-monitor-research-plan.md`, `docs/freecash-monitor-workflow-plan.md`, `docs/research-workflows/FreeCash-*` | **DRIFT.** Six-plus designs with mutually contradictory schedules (08:00 local, 02:00 UTC, 05:05 UTC, 08:30) and inverted rule numbering. | **QUARANTINE** into one `_superseded/` folder; keep exactly **two** authoritative documents: this file and `docs/free-cash-monitor-routine/OPERATIONS-WORKFLOW-PLAN.md` |
| 10 | `server/data/freecash-monitor/INTEGRATION_STATUS.md` (and `README.md`) | **FALSE CLAIMS.** Asserts the adapter and CLI script were "Created" and the four rules "COMPLIANT" — both artifacts are a stub and an unparseable file. | **RETIRE** |
| 11 | `monitoring/freecash/**`; `docs/free-cash-monitor-routine/verify-readonly.sh`; `monitoring/freecash/verify_readonly.py`; `scripts/monitoring/rule_gate_verify.py`; `server/src/services/freeCash/freeCashExecutor.ts`; `server/src/services/backgroundTasks/approvalNormalization.ts` | **KEEP — live or load-bearing.** The routine is the chosen implementation; `verify-readonly.sh` is the R1/R2 static gate (exit 2 when the target is missing — "absence of evidence is not a pass"); `freeCashExecutor.ts` is genuinely wired (`index.ts:398`, `routers/projects.ts:399,416,445`, `adapters.ts:1681`); `approvalNormalization.ts` classifies risk for the R4 UI. | **KEEP** |

Ordering constraint: rows 1–10 are retired **last**, deliberately, so that "there is exactly
one monitor implementation" is provable by absence at the moment the wiring is accepted.

---

## 5. Work items requiring approval (none applied)

| ID | Change | Type | Where |
|---|---|---|---|
| **W1** | Register the daily OS task: `schtasks /Create /TN "FreeCash-Daily-Monitor" /SC DAILY /ST 08:05` with `StartWhenAvailable`, action pinned to the absolute Python interpreter + `D:/AgenticOS/monitoring/freecash/run_daily_check.py`, `-MultipleInstances IgnoreNew`, restart-on-failure = none | OS state (outside the repo) | Windows Task Scheduler |
| **W2** | Register the evening watchdog task running `monitoring/freecash/watchdog.py` | OS state | Windows Task Scheduler |
| **W3** | Add read-only ingestion router `server/src/routers/freeCashMonitor.ts` + mount it in `server/src/index.ts` (pattern: `index.ts:295-299`) | Production source (needs explicit approval) | `server/src/` |
| **W4** | Additive UI panel on the existing Mission Control / Jarvis approvals surface consuming W3 | Front-end source | `src/pages/` |
| **W5** | Retire/quarantine §4 rows 1–10 | Deletions/moves | repo-wide |

W1–W2 must be green before W5, and W3–W4 must not introduce any write to
`data/freecash-monitor/` — the app is a **reader** of the monitor, never its trigger or
its executor. That property is what keeps R1 and R4 intact.

---

## 6. Acceptance evidence

Already reproduced in this session:

- `node --check server/scripts/freecash-daily-monitor.mjs` → exit **1**, `SyntaxError` line 41.
- `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0`, exit **0**.
- `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit **0**.
- `python monitoring/freecash/run_daily_check.py --help` → usage, exit **0**.
- Live DB read: `schedules` = 4 rows, all `enabled=1` (3 with `last_outcome='completed'`);
  `background_tasks` = 1157 rows.
- `schtasks`: no FreeCash/finance/monitor task; `\Hermes_Gateway` at-logon task last result 0.
- `hermes cron list` → `No scheduled jobs.`
- Prior real run evidence on disk: `data/freecash-monitor/state/last-run.json`
  (`last_outcome: MONITOR_DEGRADED`, `2026-09-20T19:08:00Z`) and
  `data/freecash-monitor/alerts/alerts.jsonl` (2 lines incl. `SKIP_DUPLICATE_DAY`).

Required after W1 (the proof that R2 holds end-to-end under a real scheduler):

1. Trigger the OS task manually twice on the same day.
2. First run: one snapshot for the day, one lock file, ledger updated.
3. Second run: stdout contains `SKIP_DUPLICATE_DAY`, exactly **one** new line in
   `alerts/alerts.jsonl`, **no** new snapshot, exit 0.
4. `verify-readonly.sh` still exits 0.
5. Trigger on a day with no prior run after a deliberately skipped day: `MISSED_DAY` present
   in the alert log for the uncovered day.

---

## 7. Blockers (each must be resolved before the monitor can be called operational)

| ID | Blocker | Evidence |
|---|---|---|
| **B1** | **Nothing in the application reads the state root**, so R3 has no delivery path today. `.env` and `server/.env` contain only `JARVIS_SUPERVISOR_V2`, `OLLAMA_*`, `DEFAULT_LLM_*`, `GATEWAY_PROVIDER_ORDER` — no notification config of any kind. | `grep freecash-monitor server/src src/ electron/` → no reader; `.env`, `server/.env` (values `[REDACTED]`) |
| **B2** | **There is nothing real to monitor yet.** The default read source is `operator_state` (`run_daily_check.py:52`) and the operator file is empty — `data/freecash-monitor/state/operator-state.json` has `records: []`. Every run has therefore produced `MONITOR_DEGRADED`; no earnings change can be detected, so R3 cannot fire on real data. No provider endpoint is agreed, and the historical URLs are dead/404 per the repo's own audits. | `state/operator-state.json`; `state/last-run.json` (`MONITOR_DEGRADED`) |
| **B3** | **No schedule may be registered without the user's approval** (R4). W1/W2 are therefore unapplied by design, and the monitor remains unscheduled after this plan. | this document |
| **B4** | **The 4 live node-cron schedules are unrelated and must not be touched** (they are the user's revenue briefings). One of them has `created_at = NULL`, so its misfire recovery is dead code — worth a separate fix, explicitly **out of scope** here. | sqlite read of `schedules`; `scheduler.ts:89` |
| **B5** | If Hermes cron is chosen later as the R3 delivery channel, it inherits an **at-logon** dependency: `\Hermes_Gateway` is trigger type *"Bei der Anmeldung"*, so no digest is delivered on a boot where the user never logs in. | `schtasks /Query /TN Hermes_Gateway /V /FO LIST` |

---

## 8. Rule mapping (final)

| Rule | Enforced by (after W1–W3) |
|---|---|
| **R1** no automated earning action | Static gate `verify-readonly.sh` (forbidden=0), absence of any write verb in `monitoring/freecash/**`, and the architectural property that the app only *reads* the state root (W3 must not write it) |
| **R2** exactly one check per day | `gate.py:119-128` atomic exclusive-create day lock, surfaced as `SKIP_DUPLICATE_DAY` (`run_daily_check.py:313-320`); scheduler choice made independent of this guarantee |
| **R3** notify on change | `changedetect` + dedupe-keyed `notify` (`run_daily_check.py:176,210`) → state root → **W3 ingestion** → existing `/api/background-tasks/summary` + `/approvals` → already-polled UI (`JarvisStudio.tsx:815,932`; `MissionControlPage.tsx:69-70`) |
| **R4** human approval first, never auto-executed | `approvals/pending.json` + `decided.jsonl` (`paths.py:91-95`); `execution_state = NOT_EXECUTED` and `expires_at_utc = null` frozen (`approval_queue.py:131-132,180-181,196-197`); `NON_HUMAN_DECIDERS` (`:55-57,:153`); in-app resolution only via `POST /api/background-tasks/:taskId/approval` driven by the UI (`JarvisStudio.tsx:991`, `MissionControlPage.tsx:113`), re-materialised rather than auto-approved after restart (`manager.ts:148-166`) |

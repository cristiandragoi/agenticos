# 01 — Daily Routine Workflow (operational design)

**Project:** Free Cash Finance Automation — daily status monitoring
**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a`
**Host:** Windows 11, git-bash (MSYS), non-elevated
**Written:** 2026-10-01 (Europe/Berlin)
**Status of this document:** design only. Nothing here was executed. No source file was modified. Nothing in `data/freecash-monitor/` was created, and the production root was only read (see §9 Evidence).
**Canonical implementation this routine drives:** `D:/AgenticOS/monitoring/freecash/run_daily_check.py`

---

## 0. Rule numbering — read this first

The four rules are given in one numbering; the shipped code labels them in **another**. Citing "R1" without saying whose numbering is a real source of error, so every rule in this document is written as **T-R*n*** (task numbering, as mandated) with the code's own label alongside.

| Task rule | Statement (verbatim, non-negotiable) | Code's own label | Enforcing code |
|---|---|---|---|
| **T-R1** | No earning/transaction action is ever taken automatically. | code **R2** | `readonly_client.py` allowlist + `verify_readonly.py` static gate |
| **T-R2** | The status check runs exactly once per calendar day. | code **R1** | `gate.py::acquire_day_lock` |
| **T-R3** | The operator is notified only when earnings or account status actually CHANGED. | code **R3** | `changedetect.py::compare` + `notify.py` |
| **T-R4** | No external action happens without explicit human approval. | code **R4** | `approval_queue.py` (PENDING, `NOT_EXECUTED`) |

Where the code's own file names it, e.g. `gate.py` header says "R1: exactly one status read per operator-local calendar day" — that is **T-R2**. `run_daily_check.py` docstring "**R2** — acquire today's figures through a read-only source" is **T-R1**.

The repository's own delegation brief (`docs/freecash-monitor/00-delegation-brief.md` §1) uses the *task* numbering; the package uses the *code* numbering. Both appear in the tree; do not cross-read them.

---

## 1. The routine in one paragraph

Once per operator-local calendar day, a human reads four figures from their own account dashboard and types them into a local file. A machine then, in a single run, consumes the day with an atomic lock, reads that file, compares the four figures against the previous day's snapshot, notifies the operator **only if something moved**, and enqueues one approval item per movement. The machine never acts on an approval, never contacts the platform, and never reads status twice in a day. Missed days are reported, never back-filled.

---

## 2. (a) Ordered step list — once per day

Steps are ordered **human reading → lock → read → compare → notify → queue**, exactly as mandated. Each step names the exact command and the exact file:line mechanism.

| # | Step | Exact invocation / code path | Rule |
|---|---|---|---|
| **0** | **HUMAN reads the dashboard** and appends today's record to `operator-state.json` | Edit `D:\AgenticOS\data\freecash-monitor\state\operator-state.json`; append one object to `records[]` with `day_key` = today's local date and the four figures as **integer cents** (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`). Format documented in `operator_state.py:17-37,48-73`. | T-R2, T-R3 |
| **1** | **MACHINE pre-flight** — refuse if today's reading is absent | New wrapper (design in §4). Reuses `gate.day_key()` (`gate.py:96-102`) + `operator_state.record_for_day(day)` (`operator_state.py:104-116`). Refusal = exit 9, entry point never invoked. | T-R2 |
| **2** | **MACHINE consumes the day (lock)** | `"<PY>" D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state` → `gate.acquire_day_lock(day)` = `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock` (`run_daily_check.py:308-309`; `gate.py:119-135`, syscall at `:128`). If the file already exists → print `SKIP_DUPLICATE_DAY <day>`, one `alerts.jsonl` line, **no read, no snapshot, no ledger write**, exit 0 (`run_daily_check.py:310-321`). | T-R2 |
| **3** | **MACHINE records the attempt** and computes missed days | `gate.record_attempt(day, now, ledger)` (`gate.py:179-185`) writes `state/last-run.json`; `gate.missed_days(day, ledger)` (`gate.py:208-225`) returns days **strictly between** `last_success_day` and today (never today, never the last success day). One `MISSED_DAY` alert line per gap day (`run_daily_check.py:331-347`). | T-R2 |
| **4** | **MACHINE reads the source (read-only)** | `read_source("operator_state", day)` → `operator_state.read_source(day)` (`run_daily_check.py:64-77,372`; `operator_state.py:119-151`). Opens no socket. Absent record → `data_available=False` (`operator_state.py:128-139`). | T-R1 |
| **5** | **MACHINE loads the PRIOR snapshot before writing today's**, then builds and writes today's immutably | `changedetect.load_prior_snapshot(day)` (`changedetect.py:197-208`) → `build_snapshot(...)` (`:150-176`) → `save_snapshot(...)` (`:183-189`, refuses to rewrite an existing file) → written at `run_daily_check.py:402-405`. Ordering is deliberately prior-before-write. | T-R3 |
| **6** | **MACHINE compares four exact fields** | `changedetect.compare(prior, snapshot)` (`changedetect.py:226-276`) over `COMPARED_FIELDS` (`:34-39`): `account_status`→`STATUS_CHANGED`; `earnings_total_cents`→`EARNINGS_CHANGED`; `balance_cents`→`BALANCE_CHANGED`; `pending_cents`→`EARNINGS_CHANGED` (subtype `pending`). Any inequality is a change; one cent is a change. | T-R3 |
| **7** | **MACHINE notifies only on change** | Changed → one alert line per distinct change and **at most one** notification per change, key = `sha256(day\|type\|field\|old\|new)` (`changedetect.py:214-216`), recorded in `state/notified-keys.json` **before** dispatch (`notify.py:132-145,224`). No change → `OK_NO_CHANGE` is **log-only**, never dispatched (`run_daily_check.py:423-430`; `notify.py:91-99`). First run vs no data → `INITIAL_BASELINE`, log-only (`run_daily_check.py:420-422`; `notify.py:102-110`). More than 5 changes → one coalesced summary notification (`run_daily_check.py:173-214`, `MAX_NOTIFICATIONS=5` at `:55`). | T-R3 |
| **8** | **MACHINE queues one approval item per notified change** | `approval_queue.enqueue(day, change, reason)` (`run_daily_check.py:149-151`; `approval_queue.py:137-143`) → `approvals/pending.json`. Item is frozen `status=PENDING`, `expires_at_utc=None`, `execution_state="NOT_EXECUTED"`, `execution_allowed_by_this_routine=False` (`approval_queue.py:108-134`, constants at `:43-48`). At most the first `MAX_APPROVAL_ITEMS=5` items are enqueued (`run_daily_check.py:56,195-197`). | T-R4 |
| **9** | **MACHINE re-nags stale pending items** | `nag_pending(day, now, sender, ...)` (`run_daily_check.py:217-245`) — at most one reminder per item per `NAG_INTERVAL_DAYS=7` (`approval_queue.py:59,221-235`). A reminder never decides and never executes. | T-R4 |
| **10** | **MACHINE records the outcome and exits** | `gate.record_outcome(day, outcome, now, ledger, missed)` (`run_daily_check.py:446`; `gate.py:188-202`), then prints `RUN_OK …` and returns 0 (`run_daily_check.py:447-464`). | T-R2 |
| **11** | **HUMAN decides a queued item** (only if one exists) | `"<PY>" D:\AgenticOS\monitoring\freecash\approval_queue.py decide --id <uuid> --decision approve\|reject --by "<name>" --note "<why>"` (`approval_queue.py:241-297`). Recording a decision **never** arms the item: `execution_state` is re-asserted to `NOT_EXECUTED` and `expires_at_utc` to `None` (`:179-182`). List with `approval_queue.py list` (`:262-279`). | T-R4 |
| **12** | **HUMAN performs any actual earning/withdrawal action, on the platform, outside this routine** | There is no code path in `monitoring/freecash/` that does this; it is out of scope by construction (`run_daily_check.py:18-21`). | T-R1, T-R4 |

**Interpreter of record (every command above):**
`C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` — Python 3.11.9, `tzdata` 2025.3 present, `ZoneInfo("Europe/Berlin")` resolves. Verified this pass (§9 E3). Any other interpreter on this host (`py -3` = 3.14) lacks the IANA database and would degrade the day key (§6.2).

**Second, independent daily job (same evening):** `watchdog.py` at 21:30 raises at most one `MISSED_DAY` alarm if today's check never ran. It opens no socket, writes no ledger, creates no lock, writes no snapshot, never runs the check, and always exits 0 (`watchdog.py:7-17,104-108`). Invoke: `"<PY>" D:\AgenticOS\monitoring\freecash\watchdog.py`.

---

## 3. (b) Who does what — human vs machine

| # | Step | Owner | Why it must be that owner |
|---|---|---|---|
| 0 | Read own dashboard, write today's record | **HUMAN** | No compliant provider read path exists; `operator_state.py:1-15` records that automated access to the consumer platform is prohibited by its own terms. The machine must never hold a credential or contact the platform (T-R1). |
| 1 | Pre-flight refuses on missing reading | MACHINE | Protects the operator from the lock-before-read defect (§8). A human cannot be relied on to remember. |
| 2 | Acquire day lock | MACHINE | Atomic syscall; must not be a human judgement call (T-R2). |
| 3 | Record attempt, missed-day math | MACHINE | Arithmetic over dates; deterministic. |
| 4 | Read the local file | MACHINE | File read only; no network (`operator_state.py:10-15`). |
| 5 | Load prior, build, save snapshot | MACHINE | Immutability and ordering are mechanical guarantees. |
| 6 | Compare | MACHINE | Exact integer comparison; no threshold to negotiate. |
| 7 | Notify | MACHINE | But gated: fires only on a real change; no-change is log-only. |
| 8 | Enqueue approval | MACHINE | Enqueueing is "a notification with a handle", not a permission (`approval_queue.py:1-19`). |
| 9 | Re-nag pending | MACHINE | Bounded reminder; decides nothing. |
| 10 | Decide a queued item | **HUMAN ONLY** | `_normalise_decider` refuses a machine identity; `--note` is required (`approval_queue.py:149-158,166-168`). |
| 11 | Perform any real earning/withdrawal action | **HUMAN ONLY** | No code path exists (T-R1). |
| — | Register / edit the scheduled task | **HUMAN ONLY** | Registration is an external, state-changing action → T-R4. |

**Safety vs attribution — state them separately (do not overclaim).**
`approval_queue.py:55-57` denies **ten literal strings** (`system`, `routine`, `automation`, `agent`, `cron`, `scheduler`, `monitor`, `bot`, `script`, `machine`). It is a **denylist**, so machine-shaped names such as `hermes-agent`, `assistant`, `claude` or `the monitor` are *accepted* — a decision was historically recorded as `decided_by='hermes-agent'` (prior audit, `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/WORKFLOW-PLAN.md` §A.3). Therefore:

- **"An approval can never arm an action" — HOLDS.** Even with a bad decider, `execution_state` stays `NOT_EXECUTED`, `expires_at_utc` stays `null`, `execution_allowed_by_this_routine` stays `false` (`approval_queue.py:179-182`).
- **"Only a human can sign" — DOES NOT HOLD** for this ten-word denylist. The fix (operator-editable allowlist `state/human-deciders.json`, refuse any name not on it) is a code change and is **out of scope here** (doc-only); it is recorded as BLOCKED in §10.

---

## 4. (c) Scheduler design

### 4.1 Jobs

| | Task A | Task B |
|---|---|---|
| **Task Scheduler name** | `FreeCash-Daily-Monitor` | `FreeCash-Daily-Monitor-Missed-Day-Watchdog` |
| **URI** | `\FreeCash-Daily-Monitor` | `\FreeCash-Daily-Monitor-Missed-Day-Watchdog` |
| **Trigger** | daily, `StartBoundary` **2026-10-02T09:00:00** local, `ScheduleByDay/DaysInterval=1` | daily, `StartBoundary` **2026-10-02T21:30:00** local |
| **Action process** | `C:\Windows\System32\cmd.exe` | `C:\Windows\System32\cmd.exe` |
| **Action arguments** | `/c "D:\AgenticOS\monitoring\freecash\freecash-preflight-run.cmd"` (see §4.2) | `/c "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe" D:\AgenticOS\monitoring\freecash\watchdog.py 1>> D:\AgenticOS\data\freecash-monitor\logs\task-b-watchdog.log 2>&1` |
| **WorkingDirectory** | `D:\AgenticOS` | `D:\AgenticOS` |
| **Log path** | `D:\AgenticOS\data\freecash-monitor\logs\daily-<YYYY-MM-DD>.log` (dated) + `logs\preflight-refusals.jsonl` (refusals) | `D:\AgenticOS\data\freecash-monitor\logs\task-b-watchdog.log` |
| **Settings** | `StartWhenAvailable=true`, `MultipleInstancesPolicy=IgnoreNew`, `RunLevel=LeastPrivilege`, `LogonType=InteractiveToken`, `ExecutionTimeLimit=PT10M`, **no `RestartOnFailure`** | same, `ExecutionTimeLimit=PT5M` |

**Chosen times.** 09:00 / 21:30 are the times carried by the most recent scheduler artifact on disk — `DECISION-V2-FreeCash-Daily-Monitor.xml` and `DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml` (`docs/free-cash-monitor-routine/DELEGATION-2026-10-01/scheduler/`). Earlier artifacts propose 08:35 / 23:50 (`FreeCash-Daily-Monitor.xml` in the same directory; `WORKFLOW-PLAN.md` §1.2). 09:00 is late enough that a morning reading exists, and 21:30 leaves the evening free. Either pair is a proposal; the operator owns the final choice — registration is a T-R4 human action.

**Why each setting (quoted from the shipped XML comments):**

- `StartBoundary` = the **day after** the earliest plausible approval date, because with `StartWhenAvailable=true` a boundary already in the past fires **one catch-up run at registration time**, and that catch-up would consume the day's lock before a reading exists (`DECISION-V2-FreeCash-Daily-Monitor.xml` header, "INTERPRETER, PINNED"/"settings" block).
- `InteractiveToken` — the Windows-toast transport needs a real desktop session; `S4U`/`PASSWORD` would run without one and the balloon would go nowhere (same header). Corroborated: every delivered notification in `state/notified-keys.json` carries `delivery: "TOAST_OK"`, and `notify._toast_send` spawns `powershell -NoProfile -NonInteractive` (`notify.py:167-192`).
- **No `RestartOnFailure`** — deliberate. A retry cannot produce a second status read (today's lock is already consumed, so it would print `SKIP_DUPLICATE_DAY` and exit 0), and a failed read (exit 5) must not be retried automatically (`run_daily_check.py:23-28`; `DECISION-V2` header).

**Registration (human, T-R4).** `schtasks /Create /TN "FreeCash-Daily-Monitor" /XML "<path>.xml"` — and the same for Task B. This is the one external action in this design and it is **not taken here**.

### 4.2 The pre-flight wrapper (the control that stops a day being burned)

**What exists today vs what is new — be precise:**

- **No wrapper that checks for today's operator reading exists anywhere in the repository.** A repo-wide search for a reading-presence guard found none (§9 E7).
- The closest existing artifact is `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/scheduler/freecash-guarded-run.sh`. It is a **sandbox** guard: it refuses (exit 9) when `FREECASH_DATA_ROOT` is **unset** or **equal to the production root**, so a verification run cannot redirect or hit production state. It does **not** look at `operator-state.json`. Its `norm()` canonicaliser (lowercase, `\`→`/`, squeeze repeats, drop trailing slash) and its exit-9 refusal are the pattern this design reuses.
- The Windows wrapper proposed earlier, `scheduler/freecash-daily.cmd`, resolves a tzdata-capable interpreter (fail-loud exit 90) and pins every `FREECASH_*` value, but **has no reading check** — it will happily run on a day with no reading and burn the lock.

So the wrapper below is a **new design**, grounded in existing functions but **not yet a file on disk**.

**File:** `D:\AgenticOS\monitoring\freecash\freecash-preflight-run.cmd` (new)
**Behaviour, in order:**

1. Pin production values as literals (no environment seam): `FREECASH_DATA_ROOT`, `FREECASH_TZ=Europe/Berlin`, `FREECASH_READ_SOURCE=operator_state`, clear `FREECASH_TOAST_STUB`, `FREECASH_TOAST_RETRY_SLEEP_SECONDS=5`. Rationale is on disk: an ambient `FREECASH_DATA_ROOT=<temp>` / `FREECASH_TOAST_STUB=1` was once observed injected into the shell by a concurrent harness (`freecash-daily.cmd` header; `DELEGATION-2026-09-30/scheduler/freecash-daily.sh` header).
2. Resolve a tzdata-capable interpreter from a fallback list; if none resolves → print `FAIL no tzdata interpreter` and **exit 90** without invoking anything (`freecash-daily.cmd` `:fc_probe`/`:fc_no_python`).
3. Compute today's day key via `gate.day_key()` (`gate.py:96-102`), not by a shell `date` call, so the key is the same one the routine will use.
4. **Pre-flight 1 — already consumed?** If `state/day-locks/<day>.lock` exists, print `ALREADY_CONSUMED <day>` and exit 0, invoking nothing (the run would be a harmless no-op anyway, but this avoids an extra alert line).
5. **Pre-flight 2 — today's reading present?** Call the existing reader directly:
   `"<PY>" -c "import sys;sys.path.insert(0,r'D:\AgenticOS\monitoring\freecash');import gate,operator_state as os_;rec=os_.record_for_day(gate.day_key());sys.exit(0 if rec else 9)"`
   If it exits **9**: print `REFUSED_NO_TODAY_READING <day> — append today's record to state/operator-state.json, then re-run`; append one JSON line to `logs/preflight-refusals.jsonl` (`{"ts_utc":…,"day_key":…,"reason":"no_operator_record","decision":"REFUSED"}`); **exit 9**. The entry point is never invoked, so `gate.acquire_day_lock` never runs and **no lock is created**.
6. Only if both pre-flights pass: `cd /d D:\AgenticOS` and run
   `"<PY>" D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state >> "<log>" 2>&1`, then `exit /b %ERRORLEVEL%` so the routine's own exit code propagates.

**Why the pre-flight belongs in the wrapper, not the entry point.** Wrapping is the "no weakening of strict T-R2" option recorded in the prior addendum (`WORKFLOW-PLAN.md` §A.1 Q1, §A.4 O-2): the entry point keeps its unconditional "consume-then-read" semantics, and the guard is a separate, independently testable process that can only *prevent* a run. Splitting it also means the guard can be shown to fail by construction: point it at a temp root with `records: []` and assert `state/day-locks/` stays empty.

**Falsification test for the wrapper** (to be run against a throwaway `FREECASH_DATA_ROOT`, never production):

```bash
# expect: exit 9, REFUSED_NO_TODAY_READING, and ZERO files under state/day-locks/
export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-preflight-$(date +%s)"
"<WRAPPER>" ; echo "exit=$?"
find "$FREECASH_DATA_ROOT/state/day-locks" -type f 2>/dev/null | wc -l   # expect 0
```

### 4.3 State layout the routine writes (default root)

From `paths.py:10-23,35,45-96`, root `D:/AgenticOS/data/freecash-monitor` (override `FREECASH_DATA_ROOT`; `paths.py:35`):

```
state/last-run.json          R1 ledger (attempt + success + outcome)
state/day-locks/<day>.lock   0-byte, exclusive-create; presence == day consumed
state/notified-keys.json     dedupe_key index (R3)
state/operator-state.json    operator-entered daily figures (step 0)
snapshots/<day>.json         one immutable snapshot per covered day
approvals/pending.json       approval queue (R4)
approvals/decided.jsonl      append-only human decision trail
alerts/alerts.jsonl          APPEND-ONLY canonical evidence record
logs/                        run logs, forced-recheck audit, preflight refusals
```

---

## 5. (d) Failure and degraded-mode behaviour

### 5.1 Exit-code table

**`run_daily_check.py`** (documented in its own docstring, `run_daily_check.py:23-28`):

| Code | Meaning | Side effect |
|---|---|---|
| `0` | Ran, **or** the day was already consumed (a duplicate is not an error) | snapshot/ledger per run; duplicate does none |
| `2` | Usage error (unknown `--source`, etc.) | nothing |
| `3` | `--force-recheck` refused — a second status read in one day is forbidden | appends a `REFUSED` row to `logs/forced-recheck-requests.jsonl` (`run_daily_check.py:281-297`) |
| `5` | The status read failed; **the day lock stays in place**, no automatic re-run | `RUN_FAILED` alert; `last_outcome=READ_FAILED`; `last_success_day` deliberately **not** advanced (`run_daily_check.py:371-393`; `gate.py:188-200`) |

**`approval_queue.py`** (`approval_queue.py:283-291`): `0` recorded; `2` `REFUSED` (bad decision, blank note, or non-human identity by `ValueError`); `3` no such `approval_id`; `4` `REFUSED` not-a-human (`NotHumanError`).

**`watchdog.py`**: always `0` by design (`watchdog.py:16,104-108`).

**Wrapper-only codes** (new design, following the on-disk precedent): `9` pre-flight refusal (no today reading, or — in the sandbox guard — refusing the production root); `90` no tzdata interpreter; `91` cwd missing; `92` entry point missing (`freecash-daily.cmd` failure paths). Each of these consumes **nothing**.

### 5.2 Bounded, never retried

- **Read failure** → one `RUN_FAILED` line, exit 5. `READ_FAILED` is **not** in `gate.SUCCESS_OUTCOMES` (`gate.py:32-41`), so the day stays *uncovered* and the message says verbatim "A second status read on the same day is not permitted by this routine" (`notify.message_run_failed`, `notify.py:384-396`).
- **Delivery failure** → at most `MAX_ATTEMPTS=2` (`notify.py:42,220-261`), then one `DELIVERY_FAILED` line carrying the **full original message**, the key marked `FAILED_TOAST`, and **no further retry of that key ever** (`notify.py:238-251`). A failed notification never blocks a state write, never re-reads the source, and never touches the queue (`notify.py:18-19`).
- **Corrupt/missing state** → `paths.read_json` returns the default instead of raising (`paths.py:154-166`); `gate.load_ledger` fills missing keys (`gate.py:155-163`). The routine can always run and *report* rather than crash-loop.
- There is **no loop, timer, watchdog, cron or scheduler retry** anywhere in the package that re-invokes the read after a failure (§5.5 anti-pattern from `WORKFLOW-PLAN.md`).

### 5.3 What a `MONITOR_DEGRADED` day means to the operator

`MONITOR_DEGRADED` is an **outcome label**, and it has **five distinct causes** in the code. Do not read it as one thing:

1. **No reading for the day** — `source.data_available == False`: *"No data for <day>. Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists."* (`run_daily_check.py:410-419`). This is the benign one.
2. **Timezone not resolvable on this host** — `gate.timezone_report()["kind"] == "system-local"`: the day key silently falls back to the machine-local zone; a `WARNING timezone_unavailable …` is printed (`run_daily_check.py:357-369`; `gate.py:56-77`). **Not benign** — the R1 day boundary is now machine-local, not `Europe/Berlin`.
3. **Timezone changed since the last run** — a `MONITOR_DEGRADED` alert is emitted (`run_daily_check.py:348-356`; `gate.timezone_changed`, `gate.py:174-176`).
4. **Notification channel failed twice** — `MONITOR_DEGRADED` line: *"this message exists only in alerts.jsonl. Operator must read the log until the channel is fixed."* (`notify.py:252-260`).
5. **More than 5 changes today** — the per-change toasts are suppressed and one summary notification is dispatched under a `MONITOR_DEGRADED` key (`run_daily_check.py:207-213`). Also a currency change skips the money comparison and appends a degraded note (`changedetect.py:242-246`).

**The trap the operator must know about.** `MONITOR_DEGRADED` is a member of `gate.SUCCESS_OUTCOMES` (`gate.py:39`). `record_outcome` therefore **advances `last_success_day`** for a degraded day (`gate.py:198-200`). Consequences:

- A degraded day is counted as a *success* in the ledger even though no figure was ever read.
- `missed_days()` returns only days **strictly between** `last_success_day` and today, **excluding `last_success_day`** (`gate.py:208-225`). So once a no-data degraded run advances `last_success_day`, the days before it are **never reported as missed again** — the miss is hidden.
- Production proof of exactly this: `snapshots/2026-09-20.json`, `2026-09-30.json` and `2026-10-01.json` are **all three NULL** (`data_available:false`, every figure `null`), `last_success_day` has walked forward to `2026-10-01`, and `consecutive_missed_days` reads `0` — while `state/operator-state.json` still has `"records": []` and was last modified 2026-09-20. No day ever carried a reading.

**Operator-facing rule of thumb:** if a day's outcome is `MONITOR_DEGRADED` **because no reading was entered**, treat the day as **lost for monitoring purposes** — it cannot be recovered by a second run (T-R2 forbids it). Enter the reading and let the next day be the first real one. If it is degraded for cause 2 (timezone), fix the interpreter before the next run.

### 5.4 Notification channel reality

- No **configured** channel: `grep -iE "ALERT|NOTIFY|WEBHOOK|SMTP|FREECASH"` over `.env` returned **nothing** (§9 E6).
- The **effective** channel is the Windows toast, which is the code **default** and needs no configuration: `notify.get_sender()` returns `_toast_send` unless `FREECASH_TOAST_STUB=1` (`notify.py:201-206`; `_toast_send` at `:167-192`).
- It **has** delivered: `state/notified-keys.json` holds 10 keys, every one with `delivery: "TOAST_OK"` (e.g. `2026-09-21T16:39:42Z`, `2026-09-30T19:01:05Z`).
- Consequence for the scheduler: Task A and Task B **must** run in the operator's interactive session (`LogonType=InteractiveToken`). If run headless, toasts fail; after two attempts the message survives only as a `DELIVERY_FAILED` line plus a `MONITOR_DEGRADED` line in `alerts.jsonl` (`notify.py:238-260`).
- **Email / webhook / SMS: BLOCKED** — never configured, and no credential or sink exists (§10).

### 5.5 Missed days are reported, never back-filled

`missed_days` docstring: a missed day is never re-read later, because a second read of a past day would be a second check for that day and would defeat T-R2 (`gate.py:208-215`). Same-evening detection is Task B's job (`watchdog.evaluate` marks today covered only if `last_attempt_day == today` **and** `last_outcome ∈ SUCCESS_OUTCOMES`, `watchdog.py:27-42`).

---

## 6. (e) Recovery procedure for days already burned by the lock-before-read defect

### 6.1 The defect, precisely

`run_daily_check.py` acquires the day lock at **:308-309** but reads the source at **:372**. Between them it records the attempt, computes missed days and reports timezone state (:323-369). Therefore a run on a day with **no operator reading** still consumes the day: the lock is created, a null snapshot is written, `MONITOR_DEGRADED` is recorded, and because `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` (`gate.py:39`) the ledger records it as a **success** (`gate.py:198-200`). Production proof: `2026-09-30` and `2026-10-01` each have a lock **and** a NULL snapshot, with `last_success_day` advanced to `2026-10-01`.

**Burn inventory (re-measured this pass):** locks `2026-09-20`, `2026-09-30`, `2026-10-01`; snapshots for the same three days, **all `data_available:false`, all figures `null`**; `approvals/` empty; `alerts.jsonl` 15 lines; `operator-state.json` `records: []`, mtime `2026-09-20`.

### 6.2 What recovery can and cannot mean

**Cannot happen:** a second status read of any burned day. `gate.acquire_day_lock` will refuse (the lock file exists), and T-R2 forbids it regardless (`run_daily_check.py:310-321`). `--force-recheck` is refused and only recorded (exit 3, `run_daily_check.py:281-297`). **Do not delete `state/day-locks/*.lock`** — the locks are the permanent, correct record that those days were consumed without a reading; deleting one would be an attempt to re-read a past day.

**Can happen:** make the miss *visible* again, and stop it recurring.

### 6.3 Exact procedure (human, one sitting, read-only until step 4)

**Step 0 — Confirm, read-only (never run the monitor).**

```bash
cd /d/AgenticOS
ls -la data/freecash-monitor/state/day-locks/                 # expect locks incl. burned days
cat data/freecash-monitor/snapshots/2026-09-30.json           # expect data_available:false, nulls
cat data/freecash-monitor/snapshots/2026-10-01.json           # expect data_available:false, nulls
cat data/freecash-monitor/state/last-run.json                 # last_success_day advanced; outcome MONITOR_DEGRADED
cat data/freecash-monitor/state/operator-state.json           # expect "records": []
tail -n 5 data/freecash-monitor/alerts/alerts.jsonl           # canonical evidence of the burn
"<PY>" data/freecash-monitor >/dev/null 2>&1 || true          # (no-op guard; do NOT run the entry point)
```

**Step 1 — Decide, as the operator, between two honest options.**

- **Option A (default, recommended): accept the burns.** The two days stay permanently un-covered; their NULL snapshots stand as the audit record; nothing is edited. Loss: the miss is invisible in `missed_days()` because `last_success_day` has already walked past them.
- **Option B: record an explicit human correction so the miss is visible again.** This is a **manual ledger edit that no code supports** — it is outside the routine's contract and must be done by the operator, with a backup.

**Step 2 (Option B only) — back up, then correct the ledger.**
Take a copy first: `cp data/freecash-monitor/state/last-run.json data/freecash-monitor/state/last-run.json.bak-<date>`, then set `last_success_day` to the last day that genuinely carried a reading. **Ironically, that day does not exist:** all three snapshots (2026-09-20, 2026-09-30, 2026-10-01) are NULL, so there has never been a data-bearing success. The honest correction is therefore to set `last_success_day` to `null` (and `last_success_at_utc` to `null`), leaving `last_outcome` as `MONITOR_DEGRADED`. On the next real run, `missed_days()` (`gate.py:208-225`) will then emit one `MISSED_DAY` line per uncovered day, making the whole gap visible. **BLOCKED as a routine capability:** there is no supported command to un-set `last_success_day`; this is a raw JSON edit and must be labelled as such in any audit.

**Step 3 — Do NOT run the entry point for a past day, and do NOT remove locks.** See §6.2.

**Step 4 — Enter today's reading BEFORE the next run** (step 0 of §2). With `records: []`, any run today reproduces the burn.

**Step 5 — Install the pre-flight wrapper (§4.2) and prove it fails closed**, using a throwaway root:

```bash
export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-recovery-$(date +%s)"
"<WRAPPER>" ; echo "exit=$?"                                    # expect exit 9, REFUSED_NO_TODAY_READING
find "$FREECASH_DATA_ROOT/state/day-locks" -type f | wc -l       # expect 0 — the day was NOT consumed
```

**Step 6 — Only then run once for real, and read the outcome line:**

```bash
"<PY>" monitoring/freecash/run_daily_check.py --source operator_state
# first data-bearing day -> RUN_OK <day> outcome=INITIAL_BASELINE … (silent baseline, no notification)
# later day with a change -> RUN_OK <day> outcome=EARNINGS_CHANGED … notifications=1 approvals=1
```

**Step 7 — Verify recovery, read-only:** `snapshots/<day>.json` now has non-null figures; `alerts.jsonl` has the `MISSED_DAY` lines (Option B) or a clean `INITIAL_BASELINE` (Option A); `approval_queue.py list` shows only `PENDING`, `expires_at_utc=None`, `execution_state=NOT_EXECUTED` for any item.

**Permanent structural fix (out of scope here):** re-order `run_daily_check.py` so the source is read **before** the lock is acquired, or split the lock so a no-data day is not recorded as a success. Both are source changes; this document is doc-only.

---

## 7. Daily operating summary (the one card)

| Time (Europe/Berlin) | Who | Action | Command |
|---|---|---|---|
| morning, before 09:00 | **HUMAN** | enter today's four figures | edit `state/operator-state.json` |
| 09:00 | machine | pre-flight + one status check | `freecash-preflight-run.cmd` → `run_daily_check.py --source operator_state` |
| 09:00 | machine | snapshot → compare → notify (only on change) → enqueue | (in the same run) |
| any time | **HUMAN** | decide any pending item | `approval_queue.py decide --id … --by "<name>" --note "<why>"` |
| 21:30 | machine | same-evening missed-day alarm (read-only) | `watchdog.py` |
| any time | **HUMAN** | perform any real earning/withdrawal action, on the platform | (out of scope; never automated) |
| once | **HUMAN** | register the two tasks (T-R4) | `schtasks /Create /TN "FreeCash-Daily-Monitor" /XML "<path>.xml"` |

---

## 8. What this design does NOT do

No earning, transaction, withdrawal, cash-out, click, claim, or transfer — no such code path exists (`run_daily_check.py:18-21`). No provider/platform contact, credential, token or session — the only read source reads a local file (`operator_state.py:10-15,119-151`); the optional `metrics_http` source is loopback-only `GET`/`HEAD` with a verb+path allowlist (`readonly_client.py`). The queue is never auto-drained and never expires into execution (`approval_queue.py:47-48,179-182`). Nothing is scheduled or registered by this document. The monitor produces **visibility**, not income.

---

## 9. Evidence produced this pass (all read-only)

| # | Command | Observed | Read |
|---|---|---|---|
| E1 | `ls -la monitoring/freecash/` | 10 package modules + `tests/` (`test_r1_gate`…`test_r5_smoke`, `run_all.py`) | canonical implementation present |
| E2 | `sed -n '308,309p;372p' run_daily_check.py` | `day = gate.day_key(now)`/`acquired, lock = gate.acquire_day_lock(day)` at 308-309; `raw = read_source(...)` at 372 | **lock-before-read confirmed** |
| E3 | `python --version`; `python -c "import tzdata;…"`; `ZoneInfo('Europe/Berlin')` | `Python 3.11.9`; `tzdata OK 2025.3`; `ZoneInfo('Europe/Berlin')` resolves | interpreter of record is tzdata-capable |
| E4 | `cat data/freecash-monitor/state/last-run.json` | `last_outcome=MONITOR_DEGRADED`, `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `consecutive_missed_days=0` | a "success" that consumed the day with no reading |
| E5 | `cat snapshots/2026-09-20.json 2026-09-30.json 2026-10-01.json` | all three `data_available:false`, figures `null` | no day ever carried a reading |
| E6 | `grep -iE "ALERT\|NOTIFY\|WEBHOOK\|SMTP\|FREECASH" .env` | no output | no configured notification channel/credential |
| E7 | repo-wide search for a reading-presence pre-flight guard (`record_for_day`/`preflight`/`REFUSED_NO_…` in `*.sh`/`*.cmd`/`*.py`) | only the package's own `operator_state.py` and scratch/pkg copies | **the pre-flight wrapper in §4.2 does not exist yet** |
| E8 | `cat state/notified-keys.json` (via python) | 10 keys, all `delivery: "TOAST_OK"` | the toast channel has actually delivered |
| E9 | `cat config/freecash-crontab` | `0 5 * * * … /path/to/AgenticOS/scripts/make_freecash_check.py` | a **placeholder path** pointing at a known-broken stub |
| E10 | `schtasks /query /fo LIST \| grep -i freecash` | no Free Cash entry (only Office/Windows monitors) | **no task registered** |
| E11 | `verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` / `PASS` ; exit 0 | T-R1 static gate GREEN |
| E12 | `rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` ; `VERDICT: NOT COMPLIANT` ; **exit 1** | acceptance gate is RED (its R1 = once-per-day) |
| E13 | `wc -l < alerts/alerts.jsonl` | `15` | canonical evidence record |
| E14 | `stat state/operator-state.json` | mtime `2026-09-20 21:08` , `records: []` | 11 days with no human reading |
| E15 | `git rev-parse --abbrev-ref HEAD` / `--short HEAD` | `hermes-rescue-20260908` / `8f7463a` | build of record |

**Production root was never written this pass:** every command above is a read (`cat`/`ls`/`grep`/`stat`/`wc`) or a static scan (`verify_readonly.py`, `rule_gate_verify.py` — the entry point was not run; `rule_gate_verify` reported "RUNTIME PROBE … skipped … nothing was executed"). No day-lock, snapshot, alert or approval was created. No `FREECASH_DATA_ROOT` was ever set to production, and the monitor was not invoked.

---

## 10. BLOCKED items (cannot be grounded in a live file)

| # | Item | Reason |
|---|---|---|
| **B1** | **Pre-flight reading-guard wrapper** — required by §4.2 | **Does not exist in the repository.** Only the sandbox guard `scheduler/freecash-guarded-run.sh` (guards the data root, not the reading) and the earlier reading-guard-less `scheduler/freecash-daily.cmd` exist. §4.2 is a new design, not a description of a live file. |
| **B2** | **Scheduler registration** | Nothing is registered. `schtasks` has no Free Cash task (E10) and the `crontab` binary is not even present (`crontab: command not found`). Registration is a T-R4 human action. |
| **B3** | **`SCHEDULER-DECISION-V2.md`** — the "single approval command" the DECISION-V2 XMLs point to | The file is **referenced by both XML headers but is absent from the tree** (`find docs -iname "SCHEDULER-DECISION*"` → empty). The exact `schtasks /Create` string cannot be quoted from it. The XML paths and settings in §4.1 are real files, cited directly. |
| **B4** | **Email / webhook / SMS channel** | Never configured (E6). The only live channel is the Windows toast (`notify.py:167-206`), which requires an interactive desktop session. |
| **B5** | **`--by` identity allowlist** | The decider guard is a ten-word denylist (`approval_queue.py:55-57`) and is bypassable by machine-shaped names (`hermes-agent` accepted). The "only a human can sign" property does **not** hold; the allowlist fix is a code change and is out of scope. The separate safety property (an approval can never arm an action) **does** hold (`approval_queue.py:179-182`). |
| **B6** | **Repair of lock-before-read / the RED acceptance gate** | `run_daily_check.py:308-309` vs `:372` is a source-ordering defect and `rule_gate_verify.py` exits 1 with `R1=FAIL` (E12). Both require source edits; §6 mitigates the *effect* (the pre-flight wrapper) without changing the code. |
| **B7** | **Un-setting `last_success_day`** (§6.3 Step 2) | No supported command exists; it is a raw `state/last-run.json` edit by the operator, outside the routine's contract. |
| **B8** | **A non-degraded (provider-verified) snapshot** | No compliant live provider status/earnings source exists (`operator_state.py:1-15`; `PROVIDER_ENDPOINT_UNKNOWN`). Every snapshot is `degraded: true` (`changedetect.py:165-168`). |

---

*End of daily-routine workflow design. Doc-only: no source file was modified; no state was created. Evidence commands and outputs are in §9; unverified/absent mechanisms are named in §10.*

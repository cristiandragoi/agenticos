# TRIGGER DECISION PACKET — what fires the once-daily Free Cash status run

**Delegation:** `DELEGATION-2026-10-01-R4`, stream **T (trigger)** · **Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908`
**Written:** 2026-10-01, 11:44–11:47 operator-local (Europe/Berlin, UTC+02:00) · **Host:** Windows 11 (de-DE), git-bash/MSYS, non-elevated
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (3.11.9, `tzdata 2025.3`, `ZoneInfo("Europe/Berlin")` resolves)
**Canonical entry point:** `D:/AgenticOS/monitoring/freecash/run_daily_check.py` (**not** `server/scripts/freecash-daily-monitor.mjs`, which does not parse)
**Evidence standard:** `[A]` measured this pass · `[B]` source `file:line` · `[C]` inherited, not re-verified. Every quoted block is output of a command run in this pass.

> ### ⚠ RULE NUMBERING HAZARD — carry the TITLE with the number
> The **operator numbering** is binding for this packet and it is the *inverse* of the shipped code docstrings (`gate.py:1` labels "once per day" as R1; `readonly_client.py:1` labels "no earning action" as R2):
> **R1 — no earning action automatically** · **R2 — check status once per day** · **R3 — notify on earnings or status change** · **R4 — human approval before any external action.**
> Read every "R1/R2" below as the operator title above, never as the bare number.

---

## 0. Status of this packet

**REGISTERED NOTHING.** No `schtasks /Create`, no `hermes cron create`, no registry write, no service, no file outside `…/DELEGATION-2026-10-01-R4/scheduler/`. The two `DECISION-V2-*.xml` payloads cited below already exist and are **inert** — they register nothing by themselves.

### 0.1 Live scheduler state, re-measured in this pass (`[A]`)

```
### captured at
Do,  1. Okt 2026 11:44:04

### CMD1: /c/Windows/System32/schtasks.exe /query /fo LIST | grep -i -E 'free|cash'
grep_exit=1                       <-- NO MATCH

### CMD2: schtasks task-name lines filtered
namen_grep_exit=1                 <-- NO MATCH

### CMD3: hermes cron list
No scheduled jobs.
Create one with 'hermes cron create ...' or the /cron command in chat.
cron_list_exit=0

### CMD4: hermes cron status
✓ Gateway is running — cron jobs will fire automatically
  PID: 392
  Ticker heartbeat: 26s ago

  No active jobs
cron_status_exit=0

### CMD5: ls C:/Users/cd-pr/AppData/Local/hermes/scripts/
ls: cannot access 'C:/Users/cd-pr/AppData/Local/hermes/scripts/': No such file or directory
ls_exit=2
```

**Verdict:** the expectation holds — **nothing triggers the routine today.** `schtasks` enumerates **278** registered tasks on this host (`[A]`), so the enumeration works and the routine genuinely has none. Hermes cron has **no jobs**, and the Route-H prerequisite directory `…\hermes\scripts\` **does not exist**. R2 ("check status once per day") is currently enforced by a day lock that **no scheduler honours** — and, as §5 shows, that lock currently cuts the wrong way.

Raw: `evidence/raw-01-live-scheduler-state.txt`. Post-pass re-measure identical: `evidence/raw-05-isolation-and-entrypoint.txt`.

---

## 1. Pinned facts (all `[A]` this pass unless marked)

| Fact | Value | Evidence |
|---|---|---|
| Interpreter of record resolves the zone | `3.11.9 Europe/Berlin tzdata 2025.3` | raw-01 |
| Zone key today | `day_key= 2026-10-01` via `ZoneInfo("Europe/Berlin")` | raw-06 |
| System clock offset | `2026-10-01 11:45:03 +0200`; Windows tz `Mitteleuropäische Zeit` / `Sommerzeit` = Europe/Berlin | raw-06 |
| Canonical entry point exists | `monitoring/freecash/run_daily_check.py` (18977 B) | raw-05 |
| Legacy `.mjs` does **not** parse | `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` at line 41, exit 1 (TypeScript syntax in a `.mjs`) | raw-05 |
| Day-key source | `gate.py:48 DEFAULT_TZ = "Europe/Berlin"` (`FREECASH_TZ` override) | `[B]` SCHEDULER-PLAN §1 |
| Day lock | atomic `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`, acquired **before** the read | `[B]` `gate.py`, `run_daily_check.py:309` |
| Today's production day lock | **already consumed** (`2026-10-01.lock`, mtime `08:53:46`) by the 08:53 incident | raw-05, `[B]` SCHEDULER-DECISION-V2 §0 |
| DST boundary 2026 | 25 Oct 2026: 09:00 local is UTC+1 (a wall-clock 09:00 daily fire stays on 09:00 local; the *date* boundary is unaffected) | raw-06 |

### 1.1 The XML payloads — parsed in THIS pass

> The brief warns that an earlier pass found these failing `ET.parse` on a raw `&`, and a later pass found them clean. **I re-ran the parse in this pass and it is CLEAN.**

```
### ET.parse of the two DECISION-V2 XML payloads (THIS pass)
PARSE_OK …/DECISION-V2-FreeCash-Daily-Monitor.xml
  URI= \FreeCash-Daily-Monitor     StartBoundary= 2026-10-02T09:00:00
  Command= C:\Windows\System32\cmd.exe
  Arguments= /c C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1>> D:\AgenticOS\data\freecash-monitor\logs\task-a.log 2>&1
  WorkingDirectory= D:\AgenticOS     StartWhenAvailable= true
  parse_exit=0
PARSE_OK …/DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml
  URI= \FreeCash-Daily-Monitor-Missed-Day-Watchdog   StartBoundary= 2026-10-02T21:30:00
  Command= C:\Windows\System32\cmd.exe
  Arguments= /c C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\watchdog.py 1>> D:\AgenticOS\data\freecash-monitor\logs\task-b-watchdog.log 2>&1
  WorkingDirectory= D:\AgenticOS     StartWhenAvailable= true
  parse_exit=0
```

The parsed `2>&1` (from the XML-escaped `2&gt;&amp;1`) is the value a shell must receive. **Contrast, in the same repo:** `evidence-11-xml-validation-and-blast-radius.txt` (captured 09:02) recorded the *same two files* failing with `ParseError: not well-formed (invalid token): line 96, column 227` / `line 74, column 205` — i.e. a raw `&`. The files were fixed between 09:02 and now. **What I measured this pass is that they parse and the fields extract as intended** — nothing more. Raw: `evidence/raw-02-xml-parse.txt`.

**What parsing does NOT prove** (`[C]`, inherited and still unverified): that this Task Scheduler build **accepts** the schema at `/Create /XML`, and that registration succeeds **unelevated**. Both require a registration attempt, which is forbidden here.

---

## 2. Route comparison

All three routes call **the same canonical entry point with the same pinned interpreter**; they differ only in what fires them and what happens when the machine is unavailable.

### 2.1 The table

| | **(1) Hermes cron** | **(2) Windows Task Scheduler — RECOMMENDED** | **(3) Manual / on-app-open** |
|---|---|---|---|
| **Exact command shape** | Deploy `freecash-daily.sh` to `C:/Users/cd-pr/AppData/Local/hermes/scripts/` (dir **does not exist** today), which does: `unset FREECASH_*` → `export FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash-monitor" FREECASH_TZ="Europe/Berlin" FREECASH_READ_SOURCE="operator_state" FREECASH_TOAST_STUB=""` → `"C:/Users/cd-pr/…/venv/Scripts/python.exe" "D:/AgenticOS/monitoring/freecash/run_daily_check.py" --source operator_state` → append `>> "$FC_DATA_ROOT/logs/task-a.log"`. cwd irrelevant (absolute paths). Register: `hermes cron create "0 9 * * *" --name "FreeCash-Daily-Monitor" --script freecash-daily.sh --no-agent --deliver local`. | `cmd.exe /c` → interpreter `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` → script `D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state` → redirect `1>> D:\AgenticOS\data\freecash-monitor\logs\task-a.log 2>&1`. **Working directory** `D:\AgenticOS`. Env: none set (schtasks cannot set env; relies on code defaults `paths.py:35` / `gate.py:48` / `run_daily_check.py:52`). Register: `schtasks /Create /XML "…\DECISION-V2-FreeCash-Daily-Monitor.xml"` (+ the watchdog XML). **Unquoted** action form — the fully-quoted form fails (`[B]` evidence-08). | Same command as (2), run by hand or from a shortcut: `"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" "D:/AgenticOS/monitoring/freecash/run_daily_check.py" --source operator_state >> "D:/AgenticOS/data/freecash-monitor/logs/task-a.log" 2>&1`. No hook exists today; "on-app-open" would need a per-user Run key or a Hermes startup action, i.e. a *registration* in disguise. |
| **Sleeping machine at trigger time** | **Not covered.** The job is a tick of the user-session gateway process (`PID 392`). Asleep ⇒ no tick ⇒ no attempt. `hermes cron create --help` exposes **no** misfire/catch-up flag (`[B]` evidence-06) — a documented absence. | **Covered by design.** `StartWhenAvailable=true` (parsed this pass) fires the missed run **once** when the machine is next available; `MultipleInstancesPolicy=IgnoreNew` prevents stacking. `DisallowStartIfOnBatteries=false`. **`[C]` UNVERIFIED that catch-up actually fires on this host** — registration is forbidden, so no catch-up has been observed. | **Not covered** — nothing fires. A missed day stays missed until the operator acts. |
| **Missed day (operator away N days)** | No catch-up ⇒ **N days appear as absence**, not as alarms, until the routine next runs (in-band `MISSED_DAY`) or the watchdog job fires (same evening). If the gateway was down, `hermes cron runs` shows no attempt at all — a gap is invisible in Hermes' own record. | Task A fires once on next availability (same-day if it wakes the same evening), then daily. Every uncovered day is reported by the in-band detector at the next run; the **watchdog task** alarms the *same evening*. OS run history (`schtasks /Query /TN … /V`, `Get-ScheduledTaskInfo`) survives reboots and shows `Last Run Time` / `Last Result`, so a gap is visible in the OS record too. | No trigger ⇒ no run ⇒ in-band detector fires only at the next manual run; the watchdog still alarms if Job B is separately scheduled. Gap visibility depends entirely on the operator. |
| **Across a DST / timezone change** | Cron expression `0 9 * * *` is evaluated on the **gateway's** local wall clock. The wrapper **pins** `FREECASH_TZ=Europe/Berlin`, so the **day key stays Europe/Berlin** even if the OS zone changes — trigger time and day key can therefore drift apart (a machine-local 09:00 ≠ Berlin 09:00) but the day key is never wrong. 25 Oct 2026: 09:00 local = UTC+08:00Z; a daily wall-clock 09:00 still fires. | `<StartBoundary>2026-10-02T09:00:00</StartBoundary>` + `<ScheduleByDay><DaysInterval>1</DaysInterval>` fires at **local wall-clock 09:00** daily; DST does not skip or double a *date*. Day key = `Europe/Berlin` via `gate.py:48` default. **Risk:** the XML ships **no wrapper**, so it relies on the **code default** zone rather than a pinned env var. On this host the OS zone *is* Europe/Berlin (`[A]`), but a host whose OS zone differs would fire at OS-local 09:00 while keying days in Berlin time — at extreme offsets that can land on the wrong calendar day. Pinning `FREECASH_TZ` would need a wrapper, which this XML deliberately drops. | Same as the operator's shell at run time. If the operator's shell has `FREECASH_TZ` unset, `gate.py:48` default Europe/Berlin applies; if a stray ambient value is exported, the day key silently follows it. Highest variance of the three routes. |
| **How a missed day still surfaces to the operator** | In-band `MISSED_DAY` at the next run (one per uncovered day, never back-filled) + the watchdog job's same-evening alarm (dedupe-indexed) + `alerts/alerts.jsonl`. If the gateway was down: **only** what the watchdog wrote. | In-band `MISSED_DAY` + same-evening watchdog alarm + `alerts/alerts.jsonl` + **OS-backed run history** (`Last Run Time`/`Last Result`) that survives a reboot. **Three independent signals.** | In-band `MISSED_DAY` at the next manual run (reports every uncovered day since the last success) + watchdog if separately scheduled. No OS record. |
| **Expected Effort** | ~1–2 h: create `…\hermes\scripts\`, deploy 2 `.sh`, register 2 jobs, verify. | ~2–3 h: validate XML (`done` this pass), decide D1/D2, register 2 tasks, verify `LastTaskResult=0`, confirm catch-up empirically over one sleep cycle. | ~30 min: document the command + a copy-paste block; ~2 min/day of operator habit. |
| **Time-to-Revenue** | Same day **if** the gateway is up at 09:00. | 1 day (one sleep cycle to observe a catch-up). | Same day (whatever the operator runs first). |
| **Dependencies** | Hermes gateway alive at trigger time; `…\hermes\scripts\` created; scripts deployed. | Non-elevated `schtasks /Create /XML` (untested on this host); the two XML files as-is; decisions D1/D2. | Operator present; nothing else. |
| **First Concrete Action** | `mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"` then deploy the two proposal scripts — **but not before §5's precondition.** | Decide **D1** (the 2026-10-01 lock) and **D2** (the 2026-09-30 lock + 9 toasts), then run the two `schtasks /Create /XML` lines — **but not before §5's precondition.** | Enter today's reading in `state/operator-state.json` and run the command once; document it in the operating procedure. |

### 2.2 What the dry-run proves about the route-2 command shape

The route-(2) action string — the XML's **own** `<Arguments>` program portion, unquoted `cmd.exe` form — was executed in a throwaway root this pass (§3). It runs, keys the day correctly (`2026-10-01`), and exits 0. That is a proof of the **command shape**, not of the trigger.

### 2.3 Recommendation

**Route (2), Windows Task Scheduler, as the primary trigger — registered only after §5 is satisfied — paired with its watchdog task.** It is the only route that survives **both** a sleeping machine (`StartWhenAvailable`, `[C]` unverified on this host) and a closed desktop app (an OS service, `Schedule`, `Running`/`Automatic`), and the only one with a **reboot-surviving run history** independent of the Hermes gateway process. Route (1) is a viable secondary *while the gateway is up* and needs no elevation, but it is exactly where this routine is weakest: a monitor whose whole purpose is to notice a missed day should not depend on a user-session process staying alive. Route (3) is not a trigger — it is the fallback that keeps the routine honest when neither trigger fires.

Do **not** register both (1) and (2) unless intended: doing so is *safe* (the second invocation prints `SKIP_DUPLICATE_DAY` and exits 0 — proven §3), but R2 reads best with one trigger and one audit trail.

---

## 3. Dry-run of the chosen command (Route 2 shape) in a throwaway root

```
### throwaway root
FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/fc-r4-scheduler-10070/root

### env exported into the child
FREECASH_DATA_ROOT=…/fc-r4-scheduler-10070/root     <-- exported, not echoed (the 08:53 incident's exact failure)
FREECASH_TZ=Europe/Berlin
FREECASH_READ_SOURCE=operator_state
FREECASH_TOAST_STUB=1            <-- stub sender: no human is notified by this proof
FREECASH_TOAST_RETRY_SLEEP_SECONDS=0

### CHOSEN COMMAND (Route W, DECISION-V2 Task A shape, unquoted cmd.exe form)
cmd.exe /c "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1>> <ROOT>/logs/task-a.log 2>&1"

### DRY-RUN 1
RUN1_EXIT=0
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock

### DRY-RUN 2 (same calendar day)
RUN2_EXIT=0
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
SKIP_DUPLICATE_DAY 2026-10-01

### day-locks
-rw-r--r-- 1 cd-pr 197609 0 Okt  1 11:44 2026-10-01.lock      <-- exactly one, zero bytes

### state/last-run.json (throwaway)
{ "last_attempt_day": "2026-10-01", "last_success_day": "2026-10-01",
  "last_outcome": "MONITOR_DEGRADED", "consecutive_missed_days": 0,
  "timezone": "Europe/Berlin", … }
```

**Read this as:** first invocation of the day → `RUN_OK 2026-10-01 …`, **exit 0**, one 0-byte lock; **second invocation the same day → `SKIP_DUPLICATE_DAY 2026-10-01`, exit 0**, no second read, no second lock, exactly one `SKIP_DUPLICATE_DAY` alert line. The **day key is `2026-10-01` under `Europe/Berlin`** with the pinned interpreter. Raw: `evidence/raw-03-dryrun-chosen-command.txt`.

> ⚠ **Note the second line of that ledger:** a run with **no data at all** produced `MONITOR_DEGRADED` yet set `last_success_day=2026-10-01` and reset `consecutive_missed_days=0`. That is the day-budget defect (`gate.py:32-40`, `:198`), reproduced in this pass — see §5.

---

## 4. What happens when the trigger does **not** fire (missed-day detection still works)

```
### SCENARIO: the trigger DID NOT FIRE (no run today) -- watchdog on a fresh empty root
FREECASH_DATA_ROOT=…/fc-r4-scheduler-10193/uncovered
WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=NOTIFIED
WD_UNCOVERED_RUN1_EXIT=0
WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=DEDUPED
WD_UNCOVERED_RUN2_EXIT=0

### alerts.jsonl line count (exactly one MISSED_DAY)
1 …

### state/ contents: no ledger, no lock, no snapshot
day-locks
notified-keys.json
day-locks:            (empty)
snapshots:            (does not exist)
```

**Read this as:** a day on which the trigger never fired is **still detected and surfaced** — the watchdog prints `MISSED_DAY` with `coverage=NOTIFIED`, then `DEDUPED` on a second same-evening run, and it **writes no ledger, no lock, no snapshot** (so it can never become a second run, and it can never spend a day). This is what makes the trigger safe to keep **off the critical path**: if it fails, the failure degrades to a *missed-day alarm*, not to silence. Control on a covered root: `WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=MONITOR_DEGRADED` (silent). Raw: `evidence/raw-04-missed-day-watchdog.txt`.

---

## 5. CRITICAL — the trigger must stay OFF the critical path, and must be registered ONLY AFTER the day-budget defect is remedied

**Stated plainly, because it is the single most important line in this packet:**

> **Do not register any trigger for this routine until the day-budget defect is fixed.** Today, a run with **no data** acquires the day lock, writes a null snapshot, reports `MONITOR_DEGRADED` — and **books itself as a success**: `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` (`gate.py:32-40`) and `gate.py:198` advances `last_success_day` and resets `consecutive_missed_days`. The watchdog then reads the day as *covered* and prints `WATCHDOG_OK`. Registering a daily trigger **before** that fix does not merely fail to help — it **increases the rate at which days are burned silently**: every scheduled day that fires with no reading consumes the day, marks it a success, resets the miss streak, and silences the alarm that would otherwise have surfaced the gap.

**Measured in this pass (`[A]`, throwaway root), reproducing the exact defect:**

```
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED … data_available=False … lock=2026-10-01.lock
→ state/last-run.json:  "last_success_day": "2026-10-01",  "consecutive_missed_days": 0
```

with `operator-state.json.records = []` — i.e. **nothing was read**, yet the day is recorded as a success and the miss counter is zeroed.

**Production already demonstrates the harm** (`[A]` + `[B]`): `2026-10-01.lock` exists (mtime `08:53:46`), `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0` — the day was spent on a null read this morning and the miss streak was reset to 0. Scheduling a trigger on top of this would repeat that at machine speed.

**Therefore, the ordering constraint is:**

1. Land the **day-budget remedy** — a data-less run must **not** consume the day and must **not** advance `last_success_day` (and must not silence the watchdog). This is stream **D**'s deliverable (`…-R4/daybudget/`), gate: R3's `test_daybudget_data_less.py` **6 RED → 7 GREEN**, full suite `failures=0`.
2. Land the **acceptance gate of record** — one named gate, exit 0 on the repaired package and non-zero on all 10 mutants (stream **G**).
3. **Then** register the trigger (this packet's D0), together with its watchdog task.

**Re-registration precondition that must be observable before D0, not asserted:**
```
python monitoring/freecash/tests/run_all.py            → run_all: tests=52 failures=0 errors=0 skipped=0
<chosen gate> <repaired package>                       → exit 0, and non-zero on every mutant
data-less run in a throwaway root                      → day-locks/ EMPTY, last_success_day UNCHANGED,
                                                          consecutive_missed_days PRESERVED,
                                                          watchdog prints WATCHDOG_MISSED_DAY, NO snapshot
```

Also unresolved and must accompany D0 (both are the **operator's** decisions, not an agent's — R4):
- **D1 — the 2026-10-01 production lock.** The 08:53 incident consumed it. *Accept* ⇒ today has a `MONITOR_DEGRADED` reading and no second read is possible. *Remediate* ⇒ a **human** removes `state/day-locks/2026-10-01.lock`. `--force-recheck` is refused by design (exit 3), so removal is the only path. **Do not let an agent decide this.**
- **D2 — the 2026-09-30 incident** (inherited, still open): accept or remediate the `2026-09-30` lock, accept the 9 spurious desktop toasts, and whether to *append* (never rewrite) a corrective note to `alerts/alerts.jsonl`.

---

## 6. What I deliberately did not do

- **Registered nothing.** No `schtasks /Create`, no `hermes cron create`, no registry/service write.
- **Did not create** `C:/Users/cd-pr/AppData/Local/hermes/scripts/` (that is part of the approved Route-H action, not a probe).
- **Did not edit** `monitoring/freecash/**`, `scripts/monitoring/**`, or anything under `data/freecash-monitor/**`.
- **Did not run** any git write verb.
- **No non-loopback socket, no credential, no secret.** All proofs used `FREECASH_TOAST_STUB=1`, so **no notification reached a human**.

## 7. Isolation proof (by hash, not by intention)

```
### PRE/POST production hashes (identical before and after this pass)
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *…/state/last-run.json     <-- matches the pin
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *…/alerts/alerts.jsonl      <-- matches the pin

### find data/freecash-monitor -type f -newermt '2026-10-01 00:00'
data/freecash-monitor/alerts/alerts.jsonl
data/freecash-monitor/snapshots/2026-10-01.json
data/freecash-monitor/state/day-locks/2026-10-01.lock
data/freecash-monitor/state/last-run.json
find_exit=0

### mtimes of those 4 files (all 08:53:46 -- NOT this pass)
…alerts.jsonl                 2026-10-01 08:53:46.704717500 +0200
…snapshots/2026-10-01.json    2026-10-01 08:53:46.700191600 +0200
…state/day-locks/2026-10-01.lock 2026-10-01 08:53:46.692255500 +0200
…state/last-run.json          2026-10-01 08:53:46.718415800 +0200

### find data/freecash-monitor -type f -mmin -60
(no output)  mmin_exit=0        <-- nothing touched in this pass window
```

**Honest reading of the `-newermt` result:** the brief expected **zero**, and I measured **four** — but all four carry mtime `08:53:46`, the timestamp of the **pre-existing 08:53 incident**, not of this pass. The correct hermeticity proof for *this* pass is: (a) both pinned sha256 match exactly, and (b) `find … -mmin -60` returns **nothing**. I did not re-touch, clean or remediate any of those four files. Raw: `evidence/raw-05-isolation-and-entrypoint.txt`.

## 8. Open defects and UNVERIFIED items (never inherited as PASS)

| # | Item | State |
|---|---|---|
| O1 | **Day-budget defect** — a data-less run books itself a success and advances `last_success_day`; watchdog then reports covered | **LIVE, reproduced this pass** (`[A]`). Blocks registration (§5). |
| O2 | **Acceptance gate of record** — three gates, three verdicts on the same tree | **Open** (`[B]` brief A11). |
| O3 | `StartWhenAvailable` catch-up actually firing on this host after sleep/off | **UNVERIFIED** — needs a registration attempt (forbidden here). `[C]`. |
| O4 | `schtasks /Create /XML` accepted **unelevated**, and schema acceptance of these XMLs | **UNVERIFIED** — registration-time checks. `[C]`. |
| O5 | Hermes-cron behaviour after a missed tick (catch-up/retry/delivery) | **UNVERIFIED** — `[B]` no misfire flag in `cron create --help`; absence documented, behaviour unproven. |
| O6 | The DECISION-V2 XMLs ship **no env-pinning wrapper** (unlike the V1 `.cmd` wrappers), so the task relies on **code defaults** for the state root and zone; an ambient `FREECASH_DATA_ROOT` would not be neutralised by the XML itself | **Open design consequence** of dropping the wrapper. `[B]` XML §"WHY NO .cmd WRAPPER". |
| O7 | Today's real check outcome is unrecoverable (`2026-10-01.lock` consumed) | **Open** — decision D1 is the operator's. |

## 9. Evidence index (raw outputs saved beside this packet)

| File | Contents |
|---|---|
| `evidence/raw-01-live-scheduler-state.txt` | §0 — `schtasks /query /fo LIST` filtered, `hermes cron list/status`, `…\hermes\scripts\` absent |
| `evidence/raw-02-xml-parse.txt` | §1.1 — `ET.parse` of both DECISION-V2 XMLs **this pass** (PARSE_OK, fields extracted) |
| `evidence/raw-03-dryrun-chosen-command.txt` | §3 — chosen command dry-run ×2 in a throwaway root; `RUN_OK` then `SKIP_DUPLICATE_DAY` |
| `evidence/raw-04-missed-day-watchdog.txt` | §4 — trigger-never-fired: `WATCHDOG_MISSED_DAY … NOTIFIED` → `DEDUPED` |
| `evidence/raw-05-isolation-and-entrypoint.txt` | §7 — PRE/POST hashes, `-newermt`/`-mmin`, mtimes, nothing-registered re-measure, `.mjs` parse failure |
| `evidence/raw-06-timezone-and-daykey.txt` | §1 — local offset, system tz name, `day_key`, DST boundary table |

**Bottom line:** nothing is registered; the Route-2 command shape is dry-run-proven with the day key correct under `Europe/Berlin`; a day the trigger misses **still surfaces** as a `MISSED_DAY` alarm; and **the trigger must stay off the critical path and be registered only after the day-budget defect is remedied** — because today a data-less run books itself as a success, and scheduling it now would burn days silently.

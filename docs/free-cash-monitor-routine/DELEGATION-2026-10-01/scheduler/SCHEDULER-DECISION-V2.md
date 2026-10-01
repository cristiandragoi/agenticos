# SCHEDULER-DECISION-V2.md

**Delegation:** `DELEGATION-2026-10-01` · **Track:** scheduler (decision + semantics) ·
**Supersedes for this decision:** `DELEGATION-2026-09-30/scheduler/SCHEDULER-PLAN.md` (§2/§3/§5 of that
document are the `V1` decision; this is `V2`, re-grounded on today's live state).
**Repo:** `D:\AgenticOS` · **Host:** `CDInternational`, Windows 11 Pro for Workstations build 26200,
user `cdinternational\cd-pr` · **Date of evidence:** 2026-10-01, local `Europe/Berlin` (UTC+02:00)
**Runtime under decision:** `D:\AgenticOS\monitoring\freecash\` — entry point `run_daily_check.py`,
watchdog `watchdog.py`.

---

## 0. Status: what was registered, what was executed, and one incident you must read first

**Registered NOTHING.** No Windows scheduled task was created, changed, enabled, disabled or deleted.
No Hermes cron job was created. Verified at the end of this session (evidence-10):
`schtasks /query` free|cash → no match; `hermes cron list` → `No scheduled jobs.`

**Executed:** today's live fact re-read; the state-isolation guard (four refusal cases + one control);
the same-day duplicate proof; the watchdog missed-day proofs (absent ledger and interrupted prior
day); the first-day-after-a-gap proof; XML well-formedness and field extraction; and the XML's own
action string run against a throwaway root. Every quoted block below is output of a command run in
this session.

> ### ⚠ INCIDENT (2026-10-01, 08:53:46 local) — the PRODUCTION state root was written, and today's day lock for 2026-10-01 was consumed
>
> While verifying the Route-W action-string **shape**, I invoked the pinned interpreter through
> `cmd.exe` and **echoed** `FREECASH_DATA_ROOT` instead of **exporting** it. The child therefore saw
> the variable unset, `paths.py:47` fell back to `DEFAULT_DATA_ROOT`, and the run went to
> `D:\AgenticOS\data\freecash-monitor`. The guarded wrapper — which refuses exactly this — was not in
> the path of that probe: the guard protects only runs routed through it.
>
> Produced: `state/day-locks/2026-10-01.lock` (NEW), `snapshots/2026-10-01.json` (NEW),
> `state/last-run.json` rewritten, one new `alerts.jsonl` line. **No notification was dispatched and
> no desktop toast was delivered** (`state/notified-keys.json` byte-identical, still 10 × `TOAST_OK`)
> — the `MONITOR_DEGRADED` line is log-only, and `missed_days` was empty because the prior success was
> 2026-09-30.
>
> **I did not clean it up.** Deleting the lock or restoring the ledger is another unapproved write to
> production and a decision this routine's R1/R4 discipline reserves for a human (§2, §6). Full
> forensics: `evidence/evidence-09-INCIDENT-production-leak-forensics.txt`.

**State isolation is the first rule of this workstream** (SCHEDULER-PLAN.md §10, the 2026-09-30
incident). This session repeated the *class* of that mistake once, through a different mechanism. Both
incidents are described in §2; the guard that must prevent the next one is in §5 and is proven to fire.

---

## 1. Today's live scheduling facts, re-read with the exact commands

Raw output: `evidence/evidence-01-live-scheduling-facts.txt` (captured 2026-10-01 08:46:11 +02:00).

| # | Command (exact) | Observed today |
|---|---|---|
| 1 | `MSYS_NO_PATHCONV=1 schtasks /query /fo CSV /nh \| grep -iE 'free\|cash'` | **no match** (`grep_exit=1`) — no task named for this routine |
| 2 | `MSYS_NO_PATHCONV=1 schtasks /query /fo CSV /nh \| wc -l` | **278** registered tasks total (so the enumeration works; the routine simply has none) |
| 3 | `hermes cron list` | `No scheduled jobs.` / `Create one with 'hermes cron create ...' or the /cron command in chat.` |
| 4 | `ls -la "C:/Users/cd-pr/AppData/Local/hermes/scripts/"` | `ls: cannot access ...: No such file or directory` (`ls_exit=2`) — **the Route-H prerequisite directory does not exist** |
| 5 | `"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" -c "import sys,tzdata;from zoneinfo import ZoneInfo;print(sys.version.split()[0], ZoneInfo('Europe/Berlin'))"` | `3.11.9 Europe/Berlin` (`py_exit=0`) — the pinned interpreter resolves the zone |
| 6 | `ls -la "D:/AgenticOS/data/freecash-monitor/state/day-locks/"` | `2026-09-20.lock`, `2026-09-30.lock` — and, after 08:53:46, `2026-10-01.lock` |
| 7 | `ls "D:/AgenticOS/data/freecash-monitor/state/day-locks/2026-10-01.lock"` | at **08:46** → `No such file or directory` (`exit=2`, **today's lock was FREE**); at **09:02** → present (consumed by the §0 incident) |
| 8 | `cat "D:/AgenticOS/data/freecash-monitor/state/last-run.json"` | at 08:46 → `last_attempt_day`/`last_success_day` `2026-09-30`, `last_outcome` `MONITOR_DEGRADED`, `consecutive_missed_days` `9`, sha256 `2310072a…8af399a`; at 09:02 → `2026-10-01`, sha256 `a287a902…2a293bf9` |
| 9 | `echo "FREECASH_DATA_ROOT=[${FREECASH_DATA_ROOT:-<UNSET>}]"` | `<UNSET>` (also `FREECASH_TZ`, `FREECASH_TOAST_STUB` unset); `HERMES_HOME=C:\Users\cd-pr\AppData\Local\hermes` |
| 10 | `powershell -NoProfile -Command "Get-Service Schedule \| Select-Object Name,Status,StartType \| Format-List"` | `Name: Schedule / Status: Running / StartType: Automatic` |
| 11 | `/c/Windows/System32/whoami.exe /user` | `cdinternational\cd-pr  S-1-5-21-3435097649-250514390-3575566063-1001` |
| 12 | `hermes cron status` | `✓ Gateway is running — cron jobs will fire automatically  PID: 21660  Ticker heartbeat: 55s ago` / `No active jobs` |

**Net reading of the live state at dispatch time:** neither route is wired; today's check had **not**
run and today's lock was **free** before the §0 incident, and is **consumed** after it. The
consequence of the incident for the decision is narrow but real: whichever route is approved, its Task
A equivalent will print `SKIP_DUPLICATE_DAY 2026-10-01` on its first firing today and will not produce
a real reading for 2026-10-01 without a human removing that lock (§6, decision D1).

Quoted verbatim (evidence-01, §CMD1/CMD3/CMD4/CMD5):

```
### CMD1: MSYS_NO_PATHCONV=1 schtasks /query /fo CSV /nh | grep -iE 'free|cash'
grep_exit=1
### CMD3: hermes cron list
No scheduled jobs.
### CMD4: ls C:/Users/cd-pr/AppData/Local/hermes/scripts/
ls: cannot access 'C:/Users/cd-pr/AppData/Local/hermes/scripts/': No such file or directory
ls_exit=2
### CMD5: pinned interpreter check
3.11.9 Europe/Berlin
py_exit=0
### CMD7: is TODAY's lock (2026-10-01) present?
ls: cannot access 'D:/AgenticOS/data/freecash-monitor/state/day-locks/2026-10-01.lock': No such file or directory
exit=2
```

---

## 2. The two incidents, and why state isolation is a code-path property, not a promise

**Incident A — 2026-09-30 (SCHEDULER-PLAN.md §10, inherited).** A scratch-copy rewrite used to
redirect the 09-30 wrappers produced **zero replacements and exited 0**, so two wrapper runs hit
production: the real `2026-09-30` lock was consumed, the ledger/snapshot/alert log were written, and
**9 real desktop notifications** were delivered.

**Incident B — 2026-10-01, this session (new).** Same class, different mechanism: the production
default was reached not through a failed text transform but through a **missing export**. Full
forensics in `evidence-09`; the changes are:

| Path under `D:\AgenticOS\data\freecash-monitor\` | Before (08:46) | After (09:02) |
|---|---|---|
| `state/day-locks/2026-10-01.lock` | absent | **NEW**, 0 B, 08:53:46 |
| `snapshots/2026-10-01.json` | absent | **NEW**, 518 B |
| `state/last-run.json` | sha256 `2310072a…8af399a`, `last_attempt_day` 2026-09-30 | sha256 `a287a902…2a293bf9`, `last_attempt_day`/`last_success_day` 2026-10-01, `MONITOR_DEGRADED`, `consecutive_missed_days` 0 |
| `alerts/alerts.jsonl` | 14 lines | 15 lines (+1 `MONITOR_DEGRADED` for 2026-10-01), sha256 `1b9c7c07…3999a8` |
| `state/notified-keys.json` | 10 × `TOAST_OK` | **UNCHANGED** (sha256 `0f28d569…0e9dd`) → no dispatch |
| `logs/`, `state/operator-state.json`, `approvals/` | — | **untouched** (mtimes unchanged) |
| desktop notifications | — | **none delivered** |

The two incidents together give the rule this workstream needs:

> **A guard is only as strong as the code path it sits on.** Every production-capable invocation must
> go through the one guarded entry point, and any command whose child could default to production
> needs `FREECASH_DATA_ROOT` **exported** (not echoed) with an assertion immediately before the call.
> A text transform, an `echo`, or a "we set it earlier" belief is not isolation.

---

## 3. The two candidate routes

Both routes invoke **the same pinned interpreter**
(`C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`, 3.11.9, has `tzdata`) and
hit **exactly one status read per operator-local calendar day**, enforced by `gate.py`'s atomic
`os.open(lock, O_CREAT | O_EXCL | O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`.

### 3.1 Route W — Windows Task Scheduler

**Exact registration commands (PROPOSAL ONLY — do not run; see §6):**

```
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01\scheduler\DECISION-V2-FreeCash-Daily-Monitor.xml"
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01\scheduler\DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml"
```

Task names come from `<URI>` inside each XML (`\FreeCash-Daily-Monitor`,
`\FreeCash-Daily-Monitor-Missed-Day-Watchdog`).

**The XML, verbatim** (full file: `DECISION-V2-FreeCash-Daily-Monitor.xml`; watchdog:
`DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml`). Both are **well-formed and
field-verified** today (evidence-12: `XML_OK`, `UserId=S-1-5-21-…-1001`, `LogonType=InteractiveToken`,
`RunLevel=LeastPrivilege`, `StartWhenAvailable=true`, `MultipleInstancesPolicy=IgnoreNew`,
`StartBoundary=2026-10-02T09:00:00`, `ExecutionTimeLimit=PT10M`, no `RestartOnFailure` element):

```xml
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>FreeCash daily read-only status monitor (R1: exactly one status read per operator-local day). LeastPrivilege, per-user, IgnoreNew, StartWhenAvailable. PROPOSAL ONLY, registers nothing by itself.</Description>
    <URI>\FreeCash-Daily-Monitor</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-21-3435097649-250514390-3575566063-1001</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-10-02T09:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Windows\System32\cmd.exe</Command>
      <Arguments>/c C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1>> D:\AgenticOS\data\freecash-monitor\logs\task-a.log 2&gt;&amp;1</Arguments>
      <WorkingDirectory>D:\AgenticOS</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
```

The watchdog XML is identical except `<URI>`, the description, `ExecutionTimeLimit=PT5M`,
`StartBoundary=2026-10-02T21:30:00`, and `<Arguments>` ending
`…watchdog.py 1>> D:\AgenticOS\data\freecash-monitor\logs\task-b-watchdog.log 2&gt;&amp;1`.

**Why `/XML` and not `/Create` switches:** probed live (evidence-07, CMD-RW1/CMD-RW1b) —
`schtasks /create /?` offers **no** `/SWA` or `StartWhenAvailable` switch (grep → no match), so
catch-up-after-sleep and `IgnoreNew` are reachable **only** through `/XML` (or PowerShell). `/XML` is
present in the live option inventory (`[/XML XML-Datei]`).

**Why no `.cmd` wrapper (a deliberate change from V1):** `schtasks` cannot set environment variables.
The values the routine needs *are* its code defaults and are therefore exactly right for production —
`paths.py:35 DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`,
`gate.py:48 DEFAULT_TZ = "Europe/Berlin"`, `run_daily_check.py:52 DEFAULT_SOURCE = "operator_state"` —
and **no `FREECASH_*` variable exists at User or Machine scope** (evidence-07, CMD-RW7: all four report
`User=[] Machine=[]`), so a service-spawned task's environment is deterministic. Cost: stdout is not
captured as its own file, so the action string redirects it into `logs\task-a.log` itself.

**The action string is executable** — not a guess about quoting. Evidence-12 ran the XML's *own*
`<Arguments>` program portion through `cmd.exe` with `FREECASH_DATA_ROOT` **exported** to a throwaway
root and got `RUN_OK … lock=2026-10-01.lock` plus throwaway state, with production byte-identical
(`PRODUCTION_UNCHANGED=true`). The **quoted** variant was tested too and **failed** — evidence-08:
`Die Syntax für den Dateinamen, Verzeichnisnamen oder die Datenträgerbezeichnung ist falsch.` — so the
unquoted form is the verified one. `2>&1` must stay XML-escaped as `2&gt;&amp;1` in the file; the
parsed value today is literally `2>&1` (evidence-12: both boolean assertions true).

### 3.2 Route H — Hermes cron

**Exact registration commands (PROPOSAL ONLY — see §6; the scripts must first be deployed, which is
also part of the approved action):**

```bash
mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"
# copy freecash-daily.sh and freecash-watchdog.sh there (verbatim content in
# DECISION-V2-HERMES-CRON-SCRIPTS-PROPOSAL.md)
hermes cron create "0 9 * * *"   --name "FreeCash-Daily-Monitor"                     --script freecash-daily.sh    --no-agent --deliver local
hermes cron create "30 21 * * *" --name "FreeCash-Daily-Monitor-Missed-Day-Watchdog" --script freecash-watchdog.sh --no-agent --deliver local
```

`--no-agent` is deliberate: the job must be a deterministic script, never an LLM turn.
`--script` must point at a file **under `~/.hermes/scripts/`** (live `hermes cron create --help`,
evidence-06), which **does not exist today** (evidence-01 CMD4). Schedule grammar `0 9 * * *` is the
form the same help text advertises (`'30m'`, `'every 2h'`, or `'0 9 * * *'`).

**Environment caveat that makes the wrapper mandatory on this route:** a cron-spawned process inherits
the *gateway's* environment, and this shell has previously been observed carrying
`FREECASH_DATA_ROOT=<throwaway>` and `FREECASH_TOAST_STUB=1` injected by a concurrent e2e harness
(SCHEDULER-PLAN.md §2.1). Either leaking in would silently redirect state or downgrade delivery to the
stub sender while still printing what looks like success. The proposed scripts therefore `unset` every
`FREECASH_*` name and then `export` exactly what is intended (`DECISION-V2-HERMES-CRON-SCRIPTS-PROPOSAL.md`).

### 3.3 The comparison the decision turns on

| Question | **Route W — Windows Task Scheduler** | **Route H — Hermes cron** |
|---|---|---|
| **Fires when the machine was asleep/off at the scheduled time?** | **Yes, by design.** `StartWhenAvailable=true` is in the XML (parsed `true`, evidence-12) — Task Scheduler fires the missed run once when the machine is next available. The switch is unavailable from `/Create` (evidence-07). **UNVERIFIED that it actually fires** — registration is forbidden here, so no catch-up has been observed on this host. | **No catch-up exists in the live interface.** The job is a tick of a user-session gateway process; if the machine is off, or the gateway is down, no tick happens and the day has no attempt. `hermes cron create --help` (evidence-06) exposes **no** misfire/catch-up/`StartWhenAvailable` equivalent — a documented absence, not a proven failure. **UNVERIFIED either way.** |
| **Does it retry?** | **No, deliberately.** No `RestartOnFailure` element (asserted absent, evidence-12). A retry could never produce a second status read (today's lock is already consumed → `SKIP_DUPLICATE_DAY`, exit 0), and a failed read (exit 5) must **not** be retried automatically (`run_daily_check.py` exit table: *"5 the status read failed; the day lock stays in place, no automatic re-run"*). `IgnoreNew` stops a slow run being stacked. | **No retry flag exists** for a `--no-agent` script (evidence-06 shows no retry option). Observation of failures is possible (`hermes cron runs`, `hermes cron incidents`), but no automatic re-run. **UNVERIFIED** whether the gateway re-ticks a job it missed. |
| **How is a "missed day" surfaced?** | Two independent, **files/service-backed** signals that survive a reboot: (1) Task Scheduler's own run history — `schtasks /Query /TN "\FreeCash-Daily-Monitor" /FO LIST /V` and `Get-ScheduledTaskInfo` (present on this host, evidence-07 CMD-RW5) give `Last Run Time` / `Last Result`, so a gap is visible in the OS record; (2) the routine's own detectors — in-band `MISSED_DAY` lines for each uncovered day at the next run, plus the **same-evening** watchdog alarm. Also `alerts/alerts.jsonl`, the canonical append-only evidence record. | `hermes cron runs <name>` / `history` and `hermes cron incidents` (both in the live interface, evidence-06). But if the machine was off or the gateway was down, there is simply **no attempt recorded** — the gap shows as absence, not as an alarm, until the routine next runs (in-band detector) or the watchdog next fires. No OS-level run history to cross-check against. |
| **What identity/permissions does it run as?** | The logged-on user `cdinternational\cd-pr`, SID `S-1-5-21-3435097649-250514390-3575566063-1001`, `LogonType=InteractiveToken` (**needs a real desktop session** — the toast transport requires one), `RunLevel=LeastPrivilege` (**never** `HighestAvailable`; nothing here needs elevation). Launched by the Task Scheduler service (`Schedule`, `Running`, `Automatic`, evidence-07 CMD-RW2). Elevated registration may be required on some configurations — **UNVERIFIED on this host**. | The user who owns the Hermes gateway process (PID 21660, evidence-01 CMD3), launched from that process's environment. No separate principal to configure; no elevation. Identity is therefore only as durable as the gateway process. |

**Recommendation:** **Route W is the primary route.** The routine's entire point is to notice a day that
was *missed*, and Route W is the only route with an expressed, inspectable catch-up mechanism
(`StartWhenAvailable`), an OS-backed run history that survives reboots, and an identity that does not
depend on a user-session process staying alive. Route H remains a viable secondary *while the gateway
is running*, and needs no elevation; it is the weaker choice precisely where this routine is strongest.

**Do not register both** unless you want two independent triggers for the same day. Doing so is *safe*
— the §4(a) proof shows the second invocation prints `SKIP_DUPLICATE_DAY` and exits 0 having performed
no read — but R2 ("checked once per day — not more") reads best with one registered trigger and one
audit trail. If both are ever registered, `state/day-locks/<day>.lock` remains the single authority.

---

## 4. Missed-day and same-day semantics (executed against throwaway state roots)

### 4.0 Normative definitions

* **Day key.** The operator-local calendar day, `gate.day_key()` via `zoneinfo` (`Europe/Berlin`,
  `FREECASH_TZ`). With the pinned interpreter this resolves exactly; with the system 3.14 interpreter
  it silently degrades to the machine zone and the run reports `MONITOR_DEGRADED`.
* **Same-day re-invocation.** The day is already consumed → `SKIP_DUPLICATE_DAY <day>`, exactly **one**
  alert line, **no** read, **no** snapshot, **no** ledger write, **exit 0**. The gate is the atomic
  exclusive create at `gate.py:119-135`, not the ledger.
* **Missed day.** A local day with no successful coverage. Surfaced **twice**, on purpose: in-band at
  the next run (one `MISSED_DAY` per uncovered day, never back-filled) and the **same evening** by the
  watchdog (one alarm per day, dedupe-indexed).
* **Interrupted day.** The day was attempted but the outcome is not in `SUCCESS_OUTCOMES` (e.g.
  `READ_FAILED`): the lock stays consumed, `last_success_day` stays at the previous success, the
  watchdog treats the day as **uncovered**, and there is **no automatic re-run** (R1 by design).
* **First day after a gap.** Today's read runs normally under today's lock; the missed days are
  **reported, never re-read**. `consecutive_missed_days` = number of uncovered days strictly between
  the last success and today.

### 4.1 Commands actually used

Every run below used the same shape, with the root echoed immediately before the call (the value was
**exported into the child's environment by the wrapper**, which is exactly what the §0 incident got
wrong):

```bash
$ echo "FREECASH_DATA_ROOT=$FREECASH_DATA_ROOT"
$ FREECASH_DATA_ROOT=<throwaway dir> ./freecash-guarded-run.sh <check|watchdog>; echo "exit=$?"
```

with `<throwaway dir>` ∈ `C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20261001/{proof-a-sameday, proof-b1-absent, proof-b2-interrupted, proof-c-after-gap, proof-xml-action}`.

### 4.2 (a) Second same-day run → `SKIP_DUPLICATE_DAY`, exit 0

Raw: `evidence/evidence-03-sameday.txt`.

```
### RUN a-1 (first run today)
FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20261001/proof-a-sameday
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
exit=0

### RUN a-2 (SECOND run, same calendar day 2026-10-01)
FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20261001/proof-a-sameday
SKIP_DUPLICATE_DAY 2026-10-01
exit=0

### state root listing after a-2
.../proof-a-sameday/alerts/alerts.jsonl
.../proof-a-sameday/logs/guarded-run.log
.../proof-a-sameday/snapshots/2026-10-01.json
.../proof-a-sameday/state/day-locks/2026-10-01.lock
.../proof-a-sameday/state/last-run.json
.../proof-a-sameday/state/operator-state.json

### the duplicate's own alert line
      1 "event_type": "MONITOR_DEGRADED"
      1 "event_type": "SKIP_DUPLICATE_DAY"
```

**Read this as:** the duplicate produced exactly one `SKIP_DUPLICATE_DAY` alert line, no second
snapshot (only `2026-10-01.json`), no second lock, and exit 0.

### 4.3 (b) Interrupted / absent prior day → watchdog `MISSED_DAY` coverage output

Raw: `evidence/evidence-04-watchdog-missed-day.txt`.

```
### B1: ABSENT prior day (ledger file does not exist at all)
FREECASH_DATA_ROOT=.../proof-b1-absent
WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=NOTIFIED
exit=0
### B1 again (same day) -- must DEDUPE, add nothing
WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=DEDUPED
exit=0
### B1 alert log after two watchdog runs
      1 "event_type": "MISSED_DAY"
### B1 notified-keys deliveries
      1 "delivery": "STUB_OK"

### B2: INTERRUPTED prior day (ledger: last_attempt_day=2026-09-30, last_outcome=READ_FAILED)
WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=2026-09-30 last_outcome=READ_FAILED coverage=NOTIFIED
exit=0
### B2 again (same day)
WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=2026-09-30 last_outcome=READ_FAILED coverage=DEDUPED
exit=0
### B2 alert log after two runs
      1 "event_type": "MISSED_DAY"
```

Addendum proving the watchdog is not a second writer (evidence-05): the B2 ledger's sha256
`650c9a2c5787e57df48b677130770c71846e6212e194076185fa2ca46f36af79` is **identical before and after a
third run**.

**`coverage=NOTIFIED` then `coverage=DEDUPED`** is the coverage output: exactly one alarm and one
delivery per day, and the second same-evening run adds nothing. `STUB_OK` (not `TOAST_OK`) is because
the sandbox wrapper defaults `FREECASH_TOAST_STUB=1` — a throwaway root must never put a balloon on
the operator's desktop (this is one of the harms Incident A caused).

**Covered-day control (evidence-15):** when today's check **has** run, the watchdog is **silent** — two
consecutive runs both printed `WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=MONITOR_DEGRADED` and
wrote nothing new. That asymmetry is the point: `MISSED_DAY` is emitted **only** on an uncovered day.

### 4.4 (c) First day after a gap — reported, never back-filled

Raw: `evidence/evidence-05-first-day-after-gap.txt`. Fixture: `last_success_day = 2026-09-27`, gap
`2026-09-28 … 2026-09-30`, today `2026-10-01`.

```
### RUN c-1
FREECASH_DATA_ROOT=.../proof-c-after-gap
RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
exit=0

### day-locks after the run (NOT backfilled -- only today's day may be locked):
2026-10-01.lock

### snapshots after the run (no snapshot for any missed day):
2026-10-01.json

### ledger AFTER the run:
  "last_attempt_day": "2026-10-01",
  "last_success_day": "2026-10-01",
  "last_outcome": "INITIAL_BASELINE",
  "consecutive_missed_days": 3,

### alert log event counts:
      1 "event_type": "INITIAL_BASELINE"
      3 "event_type": "MISSED_DAY"

### the three in-band MISSED_DAY lines, as recorded:
"message": "[FreeCash] MISSED DAY 2026-09-28\nNo successful status check recorded for 2026-09-28.\nLast success: 2026-09-27. consecutive_missed_days=3\nACTION:    No action taken. ..."
"message": "[FreeCash] MISSED DAY 2026-09-29\n..."
"message": "[FreeCash] MISSED DAY 2026-09-30\n..."

### stub deliveries recorded (sandbox: real toasts never attempted):
      3 "delivery": "STUB_OK"
```

**Read this as:** the first day after a gap performs **today's** read only. The three missed days get
one `MISSED_DAY` notification each, no lock, no snapshot and no read — no silent back-filling, which
is exactly what R2 requires. `consecutive_missed_days` is reported as `3`.

---

## 5. The state-isolation guard (a deliverable), and its proof

`freecash-guarded-run.sh` (in this directory) is the **only** wrapper script written by this track, and
it is deliberately **sandbox-only**: it refuses to run when `FREECASH_DATA_ROOT` is unset (because
`paths.py:35` would then default to production) or resolves to
`D:/AgenticOS/data/freecash-monitor`, normalising case, `\` vs `/`, repeated separators and a trailing
slash. Refusal is exit 9 and the entry point is never invoked. It also defaults
`FREECASH_TOAST_STUB=1`, so a sandbox run cannot deliver a desktop notification.

Proof that the guard **fires** (raw: `evidence/evidence-02-guard-fire.txt`):

```
### CMD-G1 (case 1: FREECASH_DATA_ROOT UNSET)
REFUSED_STATE_ROOT: FREECASH_DATA_ROOT is UNSET; refusing to run. paths.py:35 falls back to the production root (D:/AgenticOS/data/freecash-monitor). Set FREECASH_DATA_ROOT to a throwaway directory. Nothing was executed.
exit=9
### CMD-G2 (case 2: root == production, forward slashes)
REFUSED_STATE_ROOT: FREECASH_DATA_ROOT='D:/AgenticOS/data/freecash-monitor' resolves to the PRODUCTION root ...
exit=9
### CMD-G3 (case 3: backslashes + trailing slash)
REFUSED_STATE_ROOT: FREECASH_DATA_ROOT='D:\AgenticOS\data\freecash-monitor\' resolves to the PRODUCTION root ...
exit=9
### CMD-G4 (case 4: uppercase + doubled separators)
REFUSED_STATE_ROOT: FREECASH_DATA_ROOT='D://AgenticOS//DATA//freecash-monitor' resolves to the PRODUCTION root ...
exit=9
### CMD-G5 (control: a throwaway root is ACCEPTED)
SANDBOX_RUN root=C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20261001/guard-control mode=check ...
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED ... lock=2026-10-01.lock
exit=0
### production state after the four refusal probes
PRODUCTION_UNCHANGED=true
```

`bash -n freecash-guarded-run.sh` → `BASH_SYNTAX_OK` (evidence-10). **Honest limit:** the guard only
protects runs that go **through it** — the §0 incident happened on a probe that bypassed it.

---

## 6. The single human approval step, the string to approve, and the rollback

**One step, and it is the operator's alone (R4).** Registering a scheduled task / cron job is an
external, state-changing action; an agent must never do it. The step is:

> **D0 — Approve and run (or explicitly instruct an agent to run) the two `schtasks /Create /XML`
> commands below, from a shell, after deciding D1 and D2.**

**The exact registration string the operator would approve, verbatim:**

```
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01\scheduler\DECISION-V2-FreeCash-Daily-Monitor.xml"
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01\scheduler\DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml"
```

(Or, for Route H instead of Route W, the two `hermes cron create …` lines in §3.2 together with the
script deployment in `DECISION-V2-HERMES-CRON-SCRIPTS-PROPOSAL.md`. Choose one route.)

**Two decisions that must accompany D0** (both are consequences of the incidents, both are yours):

* **D1 — the 2026-10-01 production lock.** Incident B consumed it. *Accept* ⇒ today simply has a
  `MONITOR_DEGRADED` reading and no second read is possible. *Remediate* ⇒ a **human** removes it:
  `rm "D:/AgenticOS/data/freecash-monitor/state/day-locks/2026-10-01.lock"`
  (and, if you want the ledger clean, restore `state/last-run.json` to the 08:46 content). **Do not
  let an agent decide this** — and note that `--force-recheck` is refused by design (exit 3), so this
  file removal is the only path.
* **D2 — the 2026-09-30 incident's three decisions** (SCHEDULER-PLAN.md §10.5) remain open and
  independent: accept or remediate the `2026-09-30` lock, accept the 9 spurious notifications, and
  whether to append (never rewrite) a corrective note to `alerts/alerts.jsonl`.

**Verify after registration:**

```
MSYS_NO_PATHCONV=1 schtasks /Query /TN "\FreeCash-Daily-Monitor" /FO LIST /V
MSYS_NO_PATHCONV=1 schtasks /Query /TN "\FreeCash-Daily-Monitor-Missed-Day-Watchdog" /FO LIST /V
powershell -NoProfile -Command "Get-ScheduledTaskInfo -TaskName '\FreeCash-Daily-Monitor'"
```

**Rollback — the command that removes the entry again:**

```
schtasks /Delete /TN "\FreeCash-Daily-Monitor" /F
schtasks /Delete /TN "\FreeCash-Daily-Monitor-Missed-Day-Watchdog" /F
```

Route-H rollback (if Route H was chosen): `hermes cron remove "FreeCash-Daily-Monitor"` and
`hermes cron remove "FreeCash-Daily-Monitor-Missed-Day-Watchdog"`.

**Registration warning:** `StartWhenAvailable=true` with a `StartBoundary` already in the past fires
**one catch-up run at registration time**. The XMLs use `2026-10-02T09:00:00` / `2026-10-02T21:30:00`
precisely to avoid a surprise run; if you register on 2026-10-02 **after** 09:00, expect exactly one
immediate catch-up run (which, given D1, would print `SKIP_DUPLICATE_DAY` for 2026-10-01 or run the
first real 2026-10-02 check — both harmless).

---

## 7. VERIFIED vs UNVERIFIED

**VERIFIED this session (commands executed, output quoted):**
`hermes cron list` empty; `schtasks` free|cash no match (278 tasks enumerated); `…\hermes\scripts\`
absent; pinned interpreter resolves `Europe/Berlin` (3.11.9); production day-locks
`2026-09-20`/`2026-09-30`/`2026-10-01` and ledger/alerts/notified-keys hashes; `Schedule` service
running/Automatic; user SID `S-1-5-21-…-1001`; no `FREECASH_*` at User/Machine scope; `hermes cron
status` gateway up (PID 21660) with no misfire option in `cron create --help`; guard fires in 4
spellings and refuses to run (exit 9, nothing executed, production byte-identical); same-day second run
→ `SKIP_DUPLICATE_DAY` exit 0; watchdog → `MISSED_DAY` `coverage=NOTIFIED` then `DEDUPED` for an absent
ledger and for an interrupted prior day, ledger hash unchanged; first day after a gap → 3 in-band
`MISSED_DAY` + `INITIAL_BASELINE`, `consecutive_missed_days=3`, no back-filled lock or snapshot; both
proposal XMLs well-formed with the intended principal/settings/trigger; the XML's own action string
executes (`RUN_OK` in a throwaway root, production unchanged); the quoted cmd.exe variant fails;
`bash -n` on the wrapper; **and the §0 incident's exact production changes**.

**UNVERIFIED (could not be executed without registering, which is forbidden):** that
`StartWhenAvailable` actually fires a catch-up run on this host after a sleep/off event; that
`schtasks /Create /XML` succeeds unelevated on this host (access-denied path untested); that the Task
Scheduler schema accepts these XMLs as written (well-formedness and field values are verified, schema
acceptance is a registration-time check — element order follows a task exported from this host per
SCHEDULER-PLAN.md §2.1); every Route-H behaviour after a missed tick (catch-up, retry, delivery to a
desktop toast via `--deliver local`); and whether `0 9 * * *` / `30 21 * * *` are accepted verbatim
(the grammar form is quoted from the live help). **UNVERIFIED for 2026-10-01:** the real check outcome
— the day's lock was consumed by the §0 incident, so no real reading can be recorded for it.

---

## 8. Files created by this track (all new; nothing else touched)

In `D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01\scheduler\`:

| File | Purpose |
|---|---|
| `SCHEDULER-DECISION-V2.md` | this document |
| `freecash-guarded-run.sh` | the sandbox-only runner; carries the mandated state-root guard (§5) |
| `DECISION-V2-FreeCash-Daily-Monitor.xml` | Route W Task A definition — **PROPOSAL ONLY** |
| `DECISION-V2-FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml` | Route W Task B definition — **PROPOSAL ONLY** |
| `DECISION-V2-HERMES-CRON-SCRIPTS-PROPOSAL.md` | Route H script content + deployment/registration — **PROPOSAL ONLY** |
| `evidence/evidence-01…12-*.txt` | raw evidence (§9) |

**No existing file was modified or deleted.** The sibling files `FreeCash-Daily-Monitor.xml`,
`FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml`, `freecash-daily.cmd`, `freecash-watchdog.cmd` in this
directory belong to track `sa-3-6510f83b` and were left untouched (my proposals are deliberately named
`DECISION-V2-*` after a write-collision was detected). `git status --short` shows only **new** files
under the already-untracked `docs/free-cash-monitor-routine/`; no tracked file in the
`freecash`/`monitoring`/`docs` scope was modified (the 57 pre-existing modified files are the unrelated
`electron/` + `server/src/` work the delegation brief warns about).

## 9. Evidence file index

| File | Contents |
|---|---|
| `evidence/evidence-01-live-scheduling-facts.txt` | §1 — today's live facts, all commands + raw output |
| `evidence/evidence-02-guard-fire.txt` | §5 — guard refuses in 4 spellings, control accepted, production byte-identical |
| `evidence/evidence-03-sameday.txt` | §4.2 — `RUN_OK`, then `SKIP_DUPLICATE_DAY`, exit 0, state listing |
| `evidence/evidence-04-watchdog-missed-day.txt` | §4.3 — absent ledger and interrupted prior day, `NOTIFIED`→`DEDUPED` |
| `evidence/evidence-05-first-day-after-gap.txt` | §4.4 — 3 in-band `MISSED_DAY`, `INITIAL_BASELINE`, no back-fill; watchdog ledger-hash addendum |
| `evidence/evidence-06-hermes-cron-route.txt` | Route H — `hermes cron --help` / `create --help` / `status` / `list` |
| `evidence/evidence-07-schtasks-route.txt` | Route W — `schtasks /create /?` inventory, `Schedule` service, SID, User/Machine env, `Get-ScheduledTaskInfo` |
| `evidence/evidence-08-route-w-command-shape.txt` | §0 incident trace — quoted form fails, unquoted form runs, production lock consumed |
| `evidence/evidence-09-INCIDENT-production-leak-forensics.txt` | §0/§2 — exact production changes from the leak |
| `evidence/evidence-10-final-verification.txt` | end state — nothing registered, hashes, git status, `bash -n` |
| `evidence/evidence-11-xml-validation-and-blast-radius.txt` | XML parse attempts, wrapper listing, mtime scan |
| `evidence/evidence-12-route-w-action-verified.txt` | §3.1 — XML fields extracted, action string executed against a throwaway root |
| `evidence/evidence-13-final-verification.txt` | end state — nothing registered, no tracked file modified, approval/rollback strings present |
| `evidence/evidence-14-verification.txt` | first verification pass; **two FAILs were bugs in the harness, not the artifacts** (see evidence-15) |
| `evidence/evidence-15-verification-corrected.txt` | corrected pass: `ALL_CHECKS_PASS` — covered-day watchdog silence, uncovered `NOTIFIED`→`DEDUPED`, production untouched |

*(`evidence-08` and `evidence-11` deliberately retain the failed attempts that led to the incident and
to the XML fixes; they are evidence, not noise.)*

# SCHEDULER-PLAN.md

**Delegation:** `DELEGATION-2026-09-30` · **Scope:** scheduler wiring for the Free Cash daily
status monitor · **Host:** Windows 11 (`CDINTERNATIONAL`), user `cdinternational\cd-pr`
**Repo:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Date of evidence:** 2026-09-30
(local `Europe/Berlin`, UTC+02:00, confirmed `2026-09-30 20:57:48 +0200`)
**Runtime under test:** `monitoring/freecash/` — entry point `run_daily_check.py`, watchdog
`watchdog.py`

---

## 0. What this document is, and what it is not

**Registered nothing.** No Windows scheduled task was created, enabled, deleted or modified
(`schtasks /create` was never run — see §5, probe O: task enumeration still matches **NONE**). No
Hermes cron job was created (`hermes cron list` → `No scheduled jobs.`). No existing file was
modified or deleted; no `git` write verb was run. The only files written are the **new** ones listed
in §7, all inside this delegation's `scheduler/` directory, plus throwaway state under
`$LOCALAPPDATA\Temp`.

**⚠ INCIDENT — read §10 before trusting anything about production state.** The claim originally
written here ("production was only ever read, never written") was true when I wrote it (probe M,
20:59) and **became false at 21:01–21:02**. A verification step I added later used a scratch-copy
rewrite that **silently did not match**, so two wrapper executions ran against the *production*
state root and consumed the real `2026-09-30` day lock, sending 9 real desktop notifications. Full
forensics, the exact list of production changes, and the human decisions required are in **§10**.
No production file was modified or deleted by hand — but production *was* written, and that must not
be glossed over.

**State isolation for every other probe.** Every other executed run of the routine and of the
watchdog used a **throwaway state root** under
`C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20260930/`. Reads of
`D:\AgenticOS\data\freecash-monitor` before 21:01 were read-only, and the post-incident re-run in
§4.3 was proved byte-neutral by sha256 (§10.4).

**Every quoted block below is output from this session.** Nothing here is a prediction or a
reconstruction. Claims that could not be executed (registration itself) are marked **UNVERIFIED**
in §6 — I did not register, so I cannot claim a registered task fires.

---

## 1. Pinned facts (all VERIFIED this session)

| Fact | Value | Evidence (probe) |
|---|---|---|
| Pinned interpreter | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` | `3.11.9 … [MSC v.1938 64 bit (AMD64)]` + `Europe/Berlin` resolves (probe 0) |
| Why it must be pinned | "the system `py -3`/3.14 has no IANA database and makes `Europe/Berlin` unresolvable, degrading the day key" | task constraint; the tz behaviour itself is quoted in probe 0 |
| Entry point | `D:\AgenticOS\monitoring\freecash\run_daily_check.py` | present, `VERSION = "1.0.0"` |
| Watchdog | `D:\AgenticOS\monitoring\freecash\watchdog.py` | present, always exits 0 (module docstring + probes B/C) |
| State-root env var | `FREECASH_DATA_ROOT` (`paths.py:47`), default `D:/AgenticOS/data/freecash-monitor` (`paths.py:35`) | read from source, exercised in every probe |
| Day-key env var | `FREECASH_TZ` (`gate.py:48`), default `Europe/Berlin` | `gate.py:47-48` |
| Source env var | `FREECASH_READ_SOURCE` (`run_daily_check.py:81`), default `operator_state` | `run_daily_check.py:52,80-84` |
| Stub-sender switch | `notify.get_sender()` returns the stub iff `FREECASH_TOAST_STUB == "1"` | `notify.py:204-206` |
| Task identity (for the XML `Principal`) | `cdinternational\cd-pr` = `S-1-5-21-3435097649-250514390-3575566063-1001` | `whoami /user` (probe 0) |
| Hermes home / scripts dir | `HERMES_HOME=C:\Users\cd-pr\AppData\Local\hermes`; **`…\hermes\scripts\` does not exist yet** | probe I |
| Gateway | running, so cron jobs *would* fire: `✓ Gateway is running — cron jobs will fire automatically  PID: 21660` | probe J |
| Nothing registered today | `schtasks` free|cash matches **NONE**; `hermes cron list` → `No scheduled jobs.` | probes E, O |
| Pinned-python test suite | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | probe F |
| Static read-only gate | `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit 0 | probe G |

Probe 0 (verbatim):

```
=== python pinned ===
3.11.9 (tags/v3.11.9:de54cf5, Apr  2 2024, 10:12:12) [MSC v.1938 64 bit (AMD64)]
Europe/Berlin
=== identity (for the XML Principal UserId) ===
Benutzername          SID
===================== =============================================
cdinternational\cd-pr S-1-5-21-3435097649-250514390-3575566063-1001
=== local date (Europe/Berlin) ===
2026-09-30 20:57:48     +0200
```

---

## 2. (a) Exact registration commands

Two independent routes are specified. **Both are written to require exactly one registered job per
calendar day, and both run the same pinned interpreter against the same absolute paths.** The
routine's own R1 day lock (§3) is the *second* line of defence: even if a scheduler ever fired
twice, the second invocation performs no read.

### 2.1 Route W — Windows Task Scheduler

**Action wrappers** (created by this delegation, currently inert, verified content in §7):

* `…\DELEGATION-2026-09-30\scheduler\freecash-task-a.cmd` → daily check
* `…\DELEGATION-2026-09-30\scheduler\freecash-task-b-watchdog.cmd` → watchdog

Each wrapper `set`s **every** `FREECASH_*` value explicitly and **clears** `FREECASH_TOAST_STUB`,
because `schtasks` cannot set environment variables (`/TR` takes a command only) and an ambient
value must never be inherited. This is not theoretical: the 2026-09-21 delegation observed this
shell carrying `FREECASH_DATA_ROOT=<throwaway temp dir>` and `FREECASH_TOAST_STUB=1` injected by a
concurrent e2e harness, either of which would have silently redirected state or downgraded delivery
to the `STUB_OK` test sender. The wrapper pattern is mandatory, not cosmetic. The
anti-contamination property is **executed and proved** in §4 probe K (a decoy ambient root stays
empty).

#### Form A — `/Create /XML` (recommended; the only `schtasks` form that carries the reliability settings)

```cmd
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\scheduler\FreeCash-Daily-Monitor.xml"
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\scheduler\FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml"
```

The task name comes from `<URI>` inside each XML. Add `/TN "\Name"` only to override it.

Why `/XML` is the recommended form — `StartWhenAvailable` (fire a missed run once when the machine
is next available) and `MultipleInstancesPolicy=IgnoreNew` are **not reachable from `/Create`
switches**. Probed explicitly (probe N):

```
$ /c/Windows/System32/schtasks.exe /create /? | grep -ai "swa"
NO /SWA SWITCH -> StartWhenAvailable is only reachable via /XML or PowerShell

$ /c/Windows/System32/schtasks.exe /create /?   (option inventory, German host)
    [/RU Benutzer [/RP Kennwort]] /SC Zeitplan [/MO Wert] [/D Tag]
    [/M Monate] [/I Leerlaufzeit] /TN Aufgabenname /TR AuszuführendeAufgabe
    [/ST Startzeit]
    [/RI Intervall] [ {/ET Endzeit | /DU Dauer} [/K] [/XML XML-Datei] [/V1]]
    [/SD Startdatum] [/ED Enddatum] [/IT | /NP] [/Z] [/F] [/HRESULT] [/?]
```

Both XML files pin `RunLevel=LeastPrivilege` (the `/RL LIMITED` equivalent — never
`HighestAvailable`; nothing here needs elevation) and `LogonType=InteractiveToken` (the toast
transport needs a real desktop session).

#### Form B — pure `/Create` switches (minimal; loses `StartWhenAvailable` **and** `IgnoreNew`)

```cmd
schtasks /Create /TN "\FreeCash-Daily-Monitor" /SC DAILY /MO 1 /ST 09:00 ^
  /TR "cmd.exe /c \"D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\scheduler\freecash-task-a.cmd\"" ^
  /IT /RL LIMITED /F

schtasks /Create /TN "\FreeCash-Daily-Monitor-Missed-Day-Watchdog" /SC DAILY /MO 1 /ST 21:30 ^
  /TR "cmd.exe /c \"D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\scheduler\freecash-task-b-watchdog.cmd\"" ^
  /IT /RL LIMITED /F
```

With this form a missed 09:00 is simply lost and a slow run can be stacked. Prefer Form A.

#### Form C — PowerShell (order-proof alternative; cmdlet names read from the live module)

`Get-Module -ListAvailable ScheduledTasks` → `ScheduledTasks` (probe 0, present on this host).

```powershell
$sched = "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\scheduler"
$act  = New-ScheduledTaskAction -Execute "C:\Windows\System32\cmd.exe" `
          -Argument ('/c "' + $sched + '\freecash-task-a.cmd"') -WorkingDirectory "D:\AgenticOS"
$trg  = New-ScheduledTaskTrigger -Daily -At 09:00
$set  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
          -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$prn  = New-ScheduledTaskPrincipal -UserId "CDINTERNATIONAL\cd-pr" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "FreeCash-Daily-Monitor" -Action $act -Trigger $trg -Settings $set -Principal $prn
```

XML element *ordering* is strict in the Task Scheduler schema; the cmdlets build it for you, so
this avoids that class of failure. It is the mitigation for the *unproven* schema acceptance
(§6, U2).

#### Verify / unregister (both forms)

```cmd
schtasks /Query /TN "\FreeCash-Daily-Monitor" /FO LIST /V
schtasks /Query /TN "\FreeCash-Daily-Monitor-Missed-Day-Watchdog" /FO LIST /V
schtasks /Delete /TN "\FreeCash-Daily-Monitor" /F
schtasks /Delete /TN "\FreeCash-Daily-Monitor-Missed-Day-Watchdog" /F
```

**Operational warning (concrete):** `StartWhenAvailable=true` combined with a `StartBoundary` in
the past fires **one catch-up run at registration time**. The XMLs here use
`2026-10-01T09:00:00` / `2026-10-01T21:30:00`. Register only *after* the read-source blocker in §8
is resolved, or the catch-up run consumes that day's lock for nothing.

### 2.2 Route H — Hermes cronjob alternative

**Prerequisite, and it is a real one — the scripts directory does not exist.** Probed (probe I):

```
$ echo "HERMES_HOME=[${HERMES_HOME:-<unset>}]"
HERMES_HOME=[C:\Users\cd-pr\AppData\Local\hermes]
$ ls -la "C:/Users/cd-pr/AppData/Local/hermes/scripts/"
ls: cannot access 'C:/Users/cd-pr/AppData/Local/hermes/scripts/': No such file or directory
```

`hermes cron create --help` states the script must be **under `~/.hermes/scripts/`**:

```
--script SCRIPT       Path to a script under ~/.hermes/scripts/. Default
                      mode: script stdout is injected into the agent's
                      prompt each run. With --no-agent: the script IS the
                      job and its stdout is delivered verbatim. .sh/.bash
                      files run via bash, everything else via Python.
--no-agent            Skip the LLM entirely — run --script on schedule and
                      deliver its stdout directly. Empty stdout = silent.
                      Classic watchdog pattern (memory alerts, disk alerts,
                      CI pings).
```

So the deploy step is:

```bash
mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"
cp "D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-09-30/scheduler/freecash-daily.sh"    "C:/Users/cd-pr/AppData/Local/hermes/scripts/"
cp "D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-09-30/scheduler/freecash-watchdog.sh" "C:/Users/cd-pr/AppData/Local/hermes/scripts/"
```

Registration (schedule grammar per `hermes cron create --help`: *"Schedule like `'30m'`, `'every 2h'`, or `'0 9 * * *'`"*):

```bash
hermes cron create "0 9 * * *"   --name "FreeCash-Daily-Monitor"                     --script freecash-daily.sh    --no-agent --deliver local
hermes cron create "30 21 * * *" --name "FreeCash-Daily-Monitor-Missed-Day-Watchdog" --script freecash-watchdog.sh --no-agent --deliver local
```

`--no-agent` is deliberate: this job must be a deterministic script, not an LLM turn. The wrappers
print the entry point's own `RUN_OK …` / `SKIP_DUPLICATE_DAY …` / `WATCHDOG_*` line verbatim, which
`--no-agent` delivers as-is. (The wrappers always print at least one line, so a Hermes-cron
watchdog job will always produce a delivery; if you want silence on healthy days, append
`| grep -v '^WATCHDOG_OK'` to the wrapper — not done here, so the healthy-day evidence stays
visible.)

Verify / remove:

```bash
hermes cron list
hermes cron status                      # ✓ Gateway is running … PID / ticker heartbeat
hermes cron runs "FreeCash-Daily-Monitor"   # durable execution attempts
hermes cron remove "FreeCash-Daily-Monitor"
hermes cron remove "FreeCash-Daily-Monitor-Missed-Day-Watchdog"
```

Today, before registration (probe J, verbatim):

```
$ hermes cron list
No scheduled jobs.
Create one with 'hermes cron create ...' or the /cron command in chat.

$ hermes cron status
✓ Gateway is running — cron jobs will fire automatically
  PID: 21660
  Ticker heartbeat: 47s ago
  No active jobs
```

### 2.3 Which route

| | Route W — Task Scheduler | Route H — Hermes cron |
|---|---|---|
| Works with the app/gateway closed | **yes** (OS service) | no — needs the Hermes gateway process alive (it is: PID 21660) |
| Catch-up after a missed day | **yes** (`StartWhenAvailable`) | not evidenced |
| Needs one-time admin elevation at registration | documented: yes (`schtasks /create` Remarks) | no |
| Script location | absolute paths anywhere | must sit under `$HERMES_HOME/scripts/` |
| Per-run time cap | `ExecutionTimeLimit` (10 min / 5 min in the XMLs) | *"3-minute hard interrupt per run"* (Hermes docs) |
| Observable run history | `schtasks /Query /TN … /V`, `Get-ScheduledTaskInfo` | `hermes cron runs <name>` |
| Own same-day duplicate guard | `IgnoreNew` (+ R1 lock) | R1 lock only |

Because the routine is a *daily* monitor whose whole point is to notice a day that was missed,
**Route W is the better primary**, and Route H is viable while the gateway is running. Either is
safe to run alongside the other: the R1 day lock makes a second invocation of the day inert (§3).

---

## 3. Why a duplicate trigger is harmless by construction

`gate.py::acquire_day_lock` is a single atomic `os.open(lock, O_CREAT | O_EXCL | O_WRONLY)` on
`state/day-locks/<YYYY-MM-DD>.lock` — the filename *is* the day key, and the file is zero bytes, so
there is no read-then-write window to race and no partial write to misread. `run_daily_check.py:309`
calls it **before** the read, and on failure (`:310-321`) prints `SKIP_DUPLICATE_DAY`, appends
exactly one alert line, and returns 0 having done no read, no snapshot write and no ledger write.
Verified live in probes A and D below.

---

## 4. (b) Executed once-per-day proof — throwaway state root

**Throwaway root used (recorded exactly):**
`FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20260930/daily`
also exported for these probes: `FREECASH_TZ=Europe/Berlin`, `FREECASH_READ_SOURCE=operator_state`,
`FREECASH_TOAST_STUB=1` (stub sender — **no notification was sent to a human**),
`FREECASH_TOAST_RETRY_SLEEP_SECONDS=0`. The ambient `FREECASH_*` environment was empty at the start
of this session (`env | grep -i freecash` → nothing), and every command below sets the root
explicitly regardless.

### 4.1 Proof A — the entry point, twice on one calendar day

```
$ cd "$LOCALAPPDATA/Temp"          # neutral cwd, exactly what a scheduled action has
$ "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" \
      "D:/AgenticOS/monitoring/freecash/run_daily_check.py" --source operator_state
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
exit=0

----- RUN 2 (same calendar day) -----
SKIP_DUPLICATE_DAY 2026-09-30
exit=0
```

`RUN_OK 2026-09-30` **then** `SKIP_DUPLICATE_DAY 2026-09-30`, both exit 0. Exactly what the exit
criteria require.

**Lock-file listing after run 1 + run 2** — one lock, zero bytes, no second suffix:

```
----- day-lock listing -----
total 4
drwxr-xr-x 1 cd-pr 197609 0 Sep 30 20:55 .
drwxr-xr-x 1 cd-pr 197609 0 Sep 30 20:55 ..
-rw-r--r-- 1 cd-pr 197609 0 Sep 30 20:55 2026-09-30.lock

$ wc -c …/state/day-locks/2026-09-30.lock
0 …/state/day-locks/2026-09-30.lock
```

**The duplicate run's footprint, exactly.** The alert log after run 1 + run 2 contains exactly two
lines — the run's own `MONITOR_DEGRADED`, then one `SKIP_DUPLICATE_DAY`:

```
{"day_key": "2026-09-30", … "event_type": "MONITOR_DEGRADED", "message": "No data for 2026-09-30 (no operator-entered record for 2026-09-30 in operator-state.json). Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists.", …}
{"day_key": "2026-09-30", … "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-30 already consumed (lock 2026-09-30.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-sched-proof-20260930\\daily\\state\\day-locks\\2026-09-30.lock"}, "severity": "info", …}
```

**Hard proof it rewrites nothing (probe D).** sha256 of every state artefact before and after a
*third* duplicate run — three of four hashes are byte-identical; only the append-only alert log
changes, by exactly one line (`wc -l` = 3):

```
$ sha256sum <root>/snapshots/2026-09-30.json <root>/state/last-run.json <root>/state/operator-state.json <root>/alerts/alerts.jsonl
6555258ac891e1c0aa4010262e34744cda125f3edc81976b95f3f5fe5b89d252 *…/snapshots/2026-09-30.json
eef9aaf3cf3ae13d3e63a52af996b1d6c78f658f426b1eb26074131b8fdffa4d *…/state/last-run.json
be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c *…/state/operator-state.json
1130b510853ae21d157df68e6c5952a8cbcb407b6208a17b97f1bdc6d5ba4512 *…/alerts/alerts.jsonl
--- RUN 3 ---
SKIP_DUPLICATE_DAY 2026-09-30
exit=0
--- sha256 after RUN 3 ---
6555258ac891e1c0aa4010262e34744cda125f3edc81976b95f3f5fe5b89d252 *…/snapshots/2026-09-30.json   <-- identical
eef9aaf3cf3ae13d3e63a52af996b1d6c78f658f426b1eb26074131b8fdffa4d *…/state/last-run.json           <-- identical
be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c *…/state/operator-state.json     <-- identical
9f663d4d86bf092d89afa799c693e2011e5f959d12a8ce8133c50c87a694e51e *…/alerts/alerts.jsonl           <-- changed: one appended line

$ wc -l …/alerts/alerts.jsonl
3 …/alerts/alerts.jsonl
```

### 4.2 Proof K — the **Hermes-cron wrapper** is correct too (executed, not just proposed)

Registration is forbidden, so the *job* cannot be proved to fire. But the **wrapper the job would
run** can be, and was: `freecash-daily.sh` was copied with **exactly one line rewritten**
(`FC_DATA_ROOT`) to the throwaway root, then run twice via `bash` from a neutral cwd — with a
**decoy ambient `FREECASH_DATA_ROOT`** deliberately exported to prove nothing is inherited.

```
--- the one rewritten line in each selftest copy ---
…/selftest/daily.sh:37:FC_DATA_ROOT="C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20260930/cron-selftest-daily"
…/selftest/watchdog.sh:31:FC_DATA_ROOT="C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20260930/cron-selftest-watchdog"
--- confirm the shipped wrappers still pin production ---
…/scheduler/freecash-daily.sh:37:FC_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"
…/scheduler/freecash-watchdog.sh:31:FC_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"

ambient decoy: FREECASH_DATA_ROOT=…/decoy-ambient-root  (must be IGNORED)
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
wrapper run1 exit=0
SKIP_DUPLICATE_DAY 2026-09-30
wrapper run2 exit=0

--- wrapper log (/logs/task-a.log) ---
2026-09-30T18:58:31Z rc=0 RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED … lock=2026-09-30.lock
2026-09-30T18:58:32Z rc=0 SKIP_DUPLICATE_DAY 2026-09-30

--- DECOY ambient root contents (must be empty: nothing inherited) ---
C:/Users/cd-pr/AppData/Local/Temp/freecash-sched-proof-20260930/decoy-ambient-root:
total 4
drwxr-xr-x 1 cd-pr 197609 0 Sep 30 20:58 .
drwxr-xr-x 1 cd-pr 197609 0 Sep 30 20:58 ..
```

The decoy root is **empty** → the wrapper's env pinning defeats ambient contamination, and the exit
code reaches the caller unchanged (`rc=0` is logged from a captured `$?`, not a pipeline stage).

### 4.3 Proof V8 — the **Windows-route** wrapper (.cmd) executed via cmd.exe

The `.cmd` wrappers are what `schtasks` actually invokes, so they were executed the same way —
through `cmd.exe`, from a neutral cwd, against a throwaway root, with a **fail-closed guard** that
aborts unless exactly one production literal was found and none survived the rewrite (§10.4). The
wrappers were also converted from LF-only to native **CRLF** first (the LF-only form did run, but
CRLF is the correct Windows convention):

```
GUARD PASS freecash-task-a.cmd            CRLF=52  prod_hits=0  -> …\selftest\cmd-selftest-daily.cmd
GUARD PASS freecash-task-b-watchdog.cmd   CRLF=35  prod_hits=0  -> …\selftest\cmd-selftest-watchdog.cmd
guard exit=0
clean: cmd-selftest-daily.cmd
clean: cmd-selftest-watchdog.cmd

===== Task A wrapper via cmd.exe, twice in one day (THROWAWAY root) =====
cmd task-a run1 exit=0
cmd task-a run2 exit=0
--- wrapper log ---
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
SKIP_DUPLICATE_DAY 2026-09-30
--- day-lock listing ---
-rw-r--r-- 1 cd-pr 197609 0 Sep 30 21:04 2026-09-30.lock

===== Task B watchdog wrapper via cmd.exe, twice in one day (THROWAWAY root) =====
cmd task-b run1 exit=0
cmd task-b run2 exit=0
--- wrapper log ---
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=NOTIFIED
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=DEDUPED
--- watchdog touched no ledger/lock/snapshot ---
day-locks
notified-keys.json
```

Production sha256 before and after this run were **identical** (`last-run.json 2310072a…399a`,
`alerts.jsonl 7a90034f…96cc`) — i.e. this time the isolation held.

---

## 5. (c) The watchdog, as a **separate** job

`watchdog.py` is scheduled as its own task / cron entry. It is the **R1 second detector**: the
in-band detector in `gate.py` notices a missed day only at the *next* run (up to 24 h late); this
job notices it the same evening. By construction it cannot become a second run — no socket, no
ledger write, no day lock, no snapshot, no approval-queue touch — and it always exits 0.

### 5.1 Probe B — watchdog on a root where **today's check already ran** (covered day): silent, and silent again

```
$ FREECASH_DATA_ROOT=…/daily  …/venv/Scripts/python.exe D:/AgenticOS/monitoring/freecash/watchdog.py
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED
watchdog run1 exit=0
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED
watchdog run2 exit=0

--- alerts.jsonl line count on covered root ---
2 …/daily/alerts/alerts.jsonl        <-- unchanged: the watchdog added NOTHING
```

### 5.2 Probe C — watchdog on a root where today's check **never ran** (uncovered day): one alarm, then dedupe

```
$ FREECASH_DATA_ROOT=…/watchdog-uncovered  …/watchdog.py
--- run 1 ---
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=NOTIFIED
watchdog run1 exit=0
--- run 2 (same calendar day) ---
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=DEDUPED
watchdog run2 exit=0
```

This **is** the watchdog's own second-daily-run behaviour: first run notifies, second run in the
same day is deduped and adds nothing. The evidence that nothing was added:

```
--- alerts.jsonl  (616 bytes, ONE line) ---
{"day_key": "2026-09-30", "dedupe_key": "4ce85a86350908be895f62cce210d402080c8b57ae19f7bd960d609a5ea5c926", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-30\nNo successful status check recorded for 2026-09-30.\nLast success: none recorded. consecutive_missed_days=0\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_attempt_day", "new_value": null, "old_value": null, "prior_day_key": null}, "severity": "alert", "ts_utc": "2026-09-30T18:55:40Z"}

--- notified-keys.json ---
{ "schema_version": 1, "keys": { "4ce85a…c926": { "first_notified_at_utc": "2026-09-30T18:55:40Z", "delivery": "STUB_OK", "updated_at_utc": "2026-09-30T18:55:40Z" } } }

--- proof: no ledger written, no day-lock, no snapshot ---
$ ls -A …/state/          ->  day-locks   notified-keys.json     (no last-run.json)
$ ls -A …/state/day-locks/ ->  (empty)
$ ls -A …/snapshots/      ->  (does not exist)
```

(`delivery: STUB_OK` is the offline test sender, selected because `FREECASH_TOAST_STUB=1` was set
for this throwaway proof — a stubbed run can never masquerade as a real delivery, which is exactly
why `notify.py` labels it `STUB_OK` and never `TOAST_OK`. **No notification reached a human.**)

### 5.3 Probe L — the watchdog **wrapper** the cron job would run, twice

```
$ bash …/selftest/watchdog.sh
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=NOTIFIED
watchdog wrapper run1 exit=0
$ bash …/selftest/watchdog.sh
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=DEDUPED
watchdog wrapper run2 exit=0

--- watchdog touched NO ledger / lock / snapshot ---
$ ls -A …/cron-selftest-watchdog/state/
day-locks
notified-keys.json
```

### 5.4 Why a separate job, and how it stays safe as one

| Property | Where it is enforced | Observed |
|---|---|---|
| Never reads the status | imports no `readonly_client`; `watchdog.py:9-10` | probe C/L: only `MISSED_DAY`/`WATCHDOG_*` ever emitted |
| Never writes the ledger | `state/` after two runs contains no `last-run.json` | probe C/L |
| Never creates a day lock | `state/day-locks/` stays empty | probe C/L |
| Never writes a snapshot | `snapshots/` does not exist | probe C/L |
| At most one alarm per day | dedupe key written before dispatch (`notify.py:224`) | probe C/L: run 2 = `DEDUPED` |
| Always exits 0 | `watchdog.py:104-108` | probes B/C/L: `exit=0` every run |

---

## 6. (d) Exit criteria — as observable output, not intent

Each line is a **command plus the exact string that must appear**. Nothing here says "should" or
"intended".

**Pre-registration gate**

1. `python monitoring/freecash/tests/run_all.py` (pinned interpreter) → stdout contains
   `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0. *Observed this session.*
2. `python monitoring/freecash/verify_readonly.py monitoring/freecash` → stdout contains
   `forbidden=0 exempt=28 missing_targets=0` followed by
   `[verify_readonly] PASS - no unexempted write/earning token found.`, exit 0. *Observed.*
3. `cat D:\AgenticOS\data\freecash-monitor\state\operator-state.json` → `"records"` contains an
   entry whose `day_key` equals today. **(Not met today — see §8, blocker B1. Registration before
   this line is observable is what permanently burns a day.)**

**A registered Route-W task**

4. `schtasks /Query /TN "\FreeCash-Daily-Monitor" /FO LIST /V` → output contains
   `Aufgabenname:                  \FreeCash-Daily-Monitor` and
   `Status der geplanten Aufgabe:  Aktiviert` and `Anmeldemodus:  Nur interaktiv`.
5. Same for `\FreeCash-Daily-Monitor-Missed-Day-Watchdog`. Two distinct task names, not one.
6. The two `<Arguments>` paths in the registered tasks resolve to
   `…\DELEGATION-2026-09-30\scheduler\freecash-task-a.cmd` and `…\freecash-task-b-watchdog.cmd`
   (differ by exactly one file).
7. `Get-ScheduledTaskInfo -TaskName "FreeCash-Daily-Monitor"` → `LastTaskResult` is `0` after the
   first real run, and `NextRunTime` advances by exactly one day.

**A registered Route-H job**

8. `hermes cron list` → two rows named `FreeCash-Daily-Monitor` and
   `FreeCash-Daily-Monitor-Missed-Day-Watchdog`.
9. `hermes cron status` → `✓ Gateway is running — cron jobs will fire automatically`.
10. `hermes cron runs "FreeCash-Daily-Monitor"` → at least one attempt with the job's schedule
    tick, and the delivered stdout is the entry point's own `RUN_OK …` line (proving the wrapper,
    not an LLM, produced it).

**The once-per-day behaviour, on any root**

11. First invocation of the day, stdout line: `RUN_OK <YYYY-MM-DD> outcome=<…> … lock=<YYYY-MM-DD>.lock`,
    exit 0.
12. Second invocation of the same day, stdout is exactly one line:
    `SKIP_DUPLICATE_DAY <YYYY-MM-DD>`, exit 0.
13. `ls <root>/state/day-locks/` → exactly one file per calendar day that ran, size 0, named
    `<YYYY-MM-DD>.lock`.
14. `<root>/alerts/alerts.jsonl` gains exactly one `SKIP_DUPLICATE_DAY` line per duplicate run and
    nothing else; `sha256sum` of `<root>/snapshots/<day>.json`, `<root>/state/last-run.json` and
    `<root>/state/operator-state.json` are **unchanged** across a duplicate run.

**The watchdog, on any root**

15. Day covered by a successful check → stdout is exactly
    `WATCHDOG_OK <YYYY-MM-DD> attempt=<YYYY-MM-DD> outcome=<success outcome>`, exit 0, and
    `alerts.jsonl` line count is unchanged.
16. Day not covered → first run stdout
    `WATCHDOG_MISSED_DAY <YYYY-MM-DD> last_attempt_day=<…> last_outcome=<…> coverage=NOTIFIED`,
    exit 0; second run the same day `… coverage=DEDUPED`, exit 0; `alerts.jsonl` gains exactly one
    `MISSED_DAY` line in total.
17. After either watchdog run, `<root>/state/last-run.json` still absent-or-unchanged,
    `<root>/state/day-locks/` still empty, `<root>/snapshots/` unchanged.

**Production integrity**

18. `sha256sum D:\AgenticOS\data\freecash-monitor\state\last-run.json` →
    `5e25ae59115daa369e1cf3f57b8fd118c67cac7d3a70608cd7fd0f7b811b4caf` **before** registration.
    *(Observed pre-incident — probe M. After the §10 incident this hash is `2310072a…399a`; see §10.5
    for the corrected baseline and the pending human decisions.)*
19. `ls D:\AgenticOS\data\freecash-monitor\state\day-locks\` → contains **only** the lock for a day
    that legitimately ran, and **after the §10 incident** therefore reads
    `2026-09-20.lock` + `2026-09-30.lock`. A clean pre-registration baseline is `2026-09-20.lock`
    only.
20. `schtasks /Query /FO LIST | grep -aiE "^Aufgabenname:" | grep -aiE "free|cash"` → no output.
    *(Observed — probes E/O.)*
21. `hermes cron list` → `No scheduled jobs.` *(Observed — probes J/O.)*

Cross-check of what the gate actually enforces in code, so the criteria above are not merely
empirical (`run_daily_check.py`):

```
:307    source_kind = resolve_source(args.source)
:308    day = gate.day_key(now)
:309    acquired, lock = gate.acquire_day_lock(day)
:310    if not acquired:
:311        # R1 duplicate: exactly one log line, no read, no snapshot, no ledger write.
...
:320        print("SKIP_DUPLICATE_DAY %s" % day)
:321        return 0
```

---

## 7. VERIFIED vs UNVERIFIED

**VERIFIED — output quoted from this session**

| # | Claim | Where |
|---|---|---|
| V1 | Pinned interpreter is 3.11.9 and resolves `Europe/Berlin` (tzdata present) | probe 0 |
| V2 | Task identity `S-1-5-21-3435097649-250514390-3575566063-1001` (`cdinternational\cd-pr`) | probe 0 |
| V3 | Local date is 2026-09-30 Europe/Berlin | probe 0 |
| V4 | Entry point twice in one day → `RUN_OK 2026-09-30 …` + exit 0, then `SKIP_DUPLICATE_DAY 2026-09-30` + exit 0 | probe A |
| V5 | Exactly one zero-byte lock `<day>.lock` exists after the duplicate | probe A |
| V6 | Duplicate run rewrites nothing: snapshot / ledger / operator-state sha256 unchanged; alert log gains exactly one line | probe D |
| V7 | The Hermes-cron wrapper (`freecash-daily.sh`, one line rewritten) reproduces V4 from a neutral cwd | probe K |
| V8 | The wrapper defeats an ambient `FREECASH_DATA_ROOT` decoy (decoy root left empty) | probe K |
| V9 | Watchdog on a **covered** day → `WATCHDOG_OK … outcome=MONITOR_DEGRADED`, exit 0, adds no alert line | probe B |
| V10 | Watchdog on an **uncovered** day → `coverage=NOTIFIED` then `coverage=DEDUPED`, both exit 0, one `MISSED_DAY` line total | probe C |
| V11 | Watchdog writes no ledger, no lock, no snapshot (state dirs examined after run) | probes C, L |
| V12 | Watchdog wrapper reproduces V10 | probe L |
| V13 | `schtasks /create` has **no** `/SWA` switch → `StartWhenAvailable` only via `/XML` or PowerShell | probe N |
| V14 | PowerShell `ScheduledTasks` module is present on this host | probe 0 |
| V15 | `HERMES_HOME=C:\Users\cd-pr\AppData\Local\hermes`; `…\hermes\scripts\` **does not exist** | probe I |
| V16 | Hermes gateway is running and would fire cron jobs (PID 21660, heartbeat 47 s) | probe J |
| V17 | `hermes cron create` accepts `--script <under ~/.hermes/scripts/>`, `--no-agent`, `--deliver`, and cron-expression schedules | `hermes cron create --help` quoted §2.2 |
| V18 | No FreeCash scheduled task exists (`schtasks` free/cash matches NONE) | probes E, O |
| V19 | No Hermes cron job exists (`No scheduled jobs.`) | probes J, O |
| V20 | Test suite green on the pinned interpreter: `tests=52 failures=0 errors=0 skipped=0`, exit 0 | probe F |
| V21 | Static gate green: `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit 0 | probe G |
| V22 | Production state was intact at 20:59: only `2026-09-20.lock`; ledger sha256 `5e25ae59…b4caf`; last_attempt_day `2026-09-20`; **zero** locks in 2026-09-22…2026-09-30 | probe M |
| V24 | Both `.cmd` action wrappers execute correctly under **cmd.exe**: Task A twice in one day → `RUN_OK 2026-09-30 …` then `SKIP_DUPLICATE_DAY 2026-09-30`, both `exit=0`, one 0-byte lock; Task B twice → `coverage=NOTIFIED` then `coverage=DEDUPED`, both `exit=0`, no ledger/lock/snapshot | probe V8 |
| V25 | The `.cmd` wrappers are native **CRLF** (`CRLF=52` / `CRLF=35`, zero bare LF) — they were LF-only when first written, which is a latent cmd.exe portability risk | probe V7 |
| V26 | A rewrite harness that asserts "exactly one production literal, and production literal absent after replace" **fails closed**: the earlier unguarded `sed` version silently no-op'd (the cause of §10); the guarded version aborts before executing anything | probes V8a/V8b |
| V27 | The `.sh` wrappers pass `bash -n` and every hardcoded path in both wrapper families exists on disk | probes V2, V3 |
| V23 | The shipped wrappers still pin production `FC_DATA_ROOT=D:/AgenticOS/data/freecash-monitor` | probe K |

**UNVERIFIED — not executed, and why**

| # | Claim | Why it is unverified |
|---|---|---|
| U1 | That a **registered** Task-Scheduler task fires once per day at 09:00 / 21:30 | Registration is forbidden by this delegation. Only the *action* was executed, never a *trigger*. |
| U2 | That Task Scheduler **accepts** the XML schema on this build | Needs a registration attempt. Element order mirrors a task this build exported itself and both files parse as XML, but acceptance is not proven. Form C (PowerShell) is the mitigation. |
| U3 | That registration needs (or does not need) elevation | Not probed — no throwaway task was created. MS docs say "Only Administrators can schedule tasks"; the 2026-09-21 analysis found the current token non-elevated (`S-1-16-8192`) while `cd-pr` is in `S-1-5-32-544`, so UAC elevation is available if needed. |
| U4 | That a **registered** Hermes cron job fires at 09:00 / 21:30 | Registration is forbidden. The wrapper's *behaviour* is verified (V7–V12); the *schedule* is not. |
| U5 | That Hermes cron's "3-minute hard interrupt per run" does not truncate a `--no-agent` script | Documented in the Hermes background-systems reference but not exercised. Risk is negligible: the whole run is a few hundred ms of file I/O (logged `18:58:31Z` → `18:58:32Z`). |
| U6 | Real toast delivery from a scheduled context | Deliberately not attempted (would notify a human and, per the 2026-09-21 finding, the only implemented transport is a Windows balloon tip whose delivery depends on a live interactive session). Throwaway proofs used the `STUB_OK` sender. |
| U7 | That the operator-state read source will contain a record for the scheduled day | External to scheduling — see blocker B1 in §8. |

---

## 8. Blockers and inherited warnings re-confirmed

**B1 — do not register Task A before the read source has a record for the day (unchanged, and this
delegation re-confirmed the mechanism).** The R1 lock is acquired **before** the read
(`run_daily_check.py:309` vs `:372`), and `--force-recheck` is refused by design (exit 3). So an
unattended daily task registered while `operator-state.json.records` is empty takes the day's lock
at 09:00, produces `MONITOR_DEGRADED`, and *makes a real reading impossible for that day*. Production
state confirms the shape of the trap: last attempt 2026-09-20, `MONITOR_DEGRADED`, and **zero** day
locks for 2026-09-22…2026-09-30 (probe M) — i.e. nine days were never covered by anything.

Correct order: (1) resolve the read source; (2) enter the day's reading; (3) *then* register Task A
and Task B together.

**B2 — the watchdog is data-safe to register at any time** (V9–V12: it cannot lock or spend a day),
but until Task A is live it will correctly emit one `MISSED_DAY` per evening for a check that was
never scheduled. Register the pair together.

**B3 — the toast is the only implemented delivery sink**; on failure the message exists only in
`alerts/alerts.jsonl` (marked `DELIVERY_FAILED` + `MONITOR_DEGRADED`). "Read the alert log" is part
of the operating procedure until a second sink exists.

**B4 — registration approval (R4).** A human must run §2.1 or §2.2. Nothing here registered itself.

---

## 9. Files created by this delegation (all new; nothing else touched)

| File | Nature |
|---|---|
| `SCHEDULER-PLAN.md` | this document |
| `FreeCash-Daily-Monitor.xml` | **inert** Task A definition (`StartBoundary 2026-10-01T09:00:00`); registers nothing |
| `FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml` | **inert** Task B definition (`StartBoundary 2026-10-01T21:30:00`); registers nothing |
| `freecash-task-a.cmd` | Task A action wrapper; pins interpreter + every `FREECASH_*` value; native CRLF; body **executed via cmd.exe** against a throwaway root (§4.3) |
| `freecash-task-b-watchdog.cmd` | Task B action wrapper; same pinning; native CRLF; body **executed via cmd.exe** against a throwaway root (§4.3) |
| `freecash-daily.sh` | Hermes-cron `--no-agent` wrapper for Task A; body **executed** against a throwaway root (§4.2) |
| `freecash-watchdog.sh` | Hermes-cron `--no-agent` wrapper for Task B; body **executed** against a throwaway root (§5.3) |

Scratch (outside the repo, under `$LOCALAPPDATA\Temp`): throwaway state roots
`…/freecash-sched-proof-20260930/{daily,watchdog-uncovered,cron-selftest-*,cmd-selftest-*}` plus the
fail-closed rewrite harness `guarded_scratch.py` described in §10.4, safe to delete at any time.

**Method limits.** No network call of any kind was made (the routine's default `operator_state`
source opens no socket; `readonly_client` was never exercised here). No credential was read, typed or
stored. No browser automation, no contact with any provider host. No existing file was modified or
deleted by hand; no `git add/commit/checkout/reset/clean/stash` was run. `schtasks` was used for
**query only** (`/Query`, `/create /?`); `hermes cron` was used for **`list`, `status` and `--help`
only**. **One exception to "no writes to production" is documented in §10 and is not excused by this
paragraph.**

---

## 10. INCIDENT — production state was written, and the day lock for 2026-09-30 was consumed

This is the most important section in the document. It describes a constraint violation caused by
this delegation's own verification step.

### 10.1 What happened

At **21:01:05–21:02:06 local (2026-09-30T19:01:05Z … 19:02:06Z)** I ran a verification step that was
supposed to execute the two `.cmd` action wrappers against a **throwaway** root. The scratch-copy
rewrite used to redirect them (`sed`) **silently produced zero replacements and exited 0**, so both
wrappers still named the production root. Executing them therefore ran against
`D:\AgenticOS\data\freecash-monitor`.

Consequences, in order of seriousness:

1. **The production day lock `state/day-locks/2026-09-30.lock` was created.** R1 now refuses a
   second status read for 2026-09-30, and `--force-recheck` is refused by design (exit 3). **A real
   reading can no longer be recorded for 2026-09-30.** This is exactly the trap §8/B1 warns about,
   now realised for one day.
2. **9 real Windows desktop notifications were delivered** — the in-band `MISSED_DAY` detector fired
   for the 9 uncovered days 2026-09-21…2026-09-29, each recorded `delivery: TOAST_OK` (no
   `logs/toast-stub.log` exists, so `_toast_send` ran for real, not the stub). The operator may have
   seen a burst of balloon tips. Total run time was one minute because each toast sleeps 6 s.
3. The production ledger, notify dedupe index, snapshot and alert log were written.

### 10.2 Production forensic timeline (verbatim, quoted from alerts.jsonl)

Lines 1–3 pre-date this delegation; **lines 4–14 are mine**:

```
 1  2026-09-20T19:08:00Z  MONITOR_DEGRADED     No data for 2026-09-20 (no operator-entered record f
 2  2026-09-20T19:08:01Z  SKIP_DUPLICATE_DAY   Day 2026-09-20 already consumed (lock 2026-09-20.loc
 3  2026-09-21T16:39:42Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-21
 4  2026-09-30T19:01:05Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-21
 5  2026-09-30T19:01:11Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-22
 6  2026-09-30T19:01:18Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-23
 7  2026-09-30T19:01:24Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-24
 8  2026-09-30T19:01:31Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-25
 9  2026-09-30T19:01:37Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-26
10  2026-09-30T19:01:44Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-27
11  2026-09-30T19:01:51Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-28
12  2026-09-30T19:01:58Z  MISSED_DAY           [FreeCash] MISSED DAY 2026-09-29
13  2026-09-30T19:02:05Z  MONITOR_DEGRADED     No data for 2026-09-30 (no operator-entered record f
14  2026-09-30T19:02:06Z  SKIP_DUPLICATE_DAY   Day 2026-09-30 already consumed (lock 2026-09-30.loc
```

```
$ cat D:/AgenticOS/data/freecash-monitor/logs/task-a.log
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
SKIP_DUPLICATE_DAY 2026-09-30

$ cat D:/AgenticOS/data/freecash-monitor/logs/task-b-watchdog.log
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED
```

```
$ grep -o '"delivery": "[A-Z_]*"' state/notified-keys.json | sort | uniq -c
     10 "delivery": "TOAST_OK"
```

(The watchdog, run twice, correctly reported `WATCHDOG_OK` because by then the day was covered — it
added no state beyond its own log file.)

### 10.3 Exact list of production changes caused by the incident

| Path under `D:\AgenticOS\data\freecash-monitor\` | Before | After |
|---|---|---|
| `state/day-locks/2026-09-30.lock` | absent | **NEW, 0 bytes** |
| `state/last-run.json` | sha256 `5e25ae59…b4caf`; `last_attempt_day` 2026-09-20 | sha256 `2310072a649dbfdbf7072dfb44915eeb75ab4ada8d849e9e78961e8358af399a`; `last_attempt_day`/`last_success_day` 2026-09-30; `last_outcome` `MONITOR_DEGRADED`; `consecutive_missed_days` 9 |
| `state/notified-keys.json` | absent | **NEW**, 2172 B, 10 keys, all `TOAST_OK` |
| `snapshots/2026-09-30.json` | absent | **NEW**, 518 B, null fields, `degraded: true` |
| `alerts/alerts.jsonl` | 3 lines | 14 lines (+11), sha256 `7a90034f…96cc` |
| `logs/task-a.log` | absent | **NEW**, 194 B |
| `logs/task-b-watchdog.log` | absent | **NEW**, 136 B |
| 9 Windows desktop toasts | — | **delivered** |
| `state/operator-state.json` | mtime 2026-09-20 | **untouched** (mtime unchanged) |
| `state/day-locks/2026-09-20.lock` | 0 B | **untouched** |
| `approvals/` | empty | **untouched** |

### 10.4 Root cause (and what is still unverified about it)

Verified:

* The production literal is present **exactly once** in the source wrapper:
  `grep -cF 'set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"' → 1`.
* The `sed` substitution I used produced **zero replacements and exit 0** — re-run twice against the
  untouched source, both times the production path survived.
* The equivalent rewrite for the `.sh` wrappers **did** work, because those use forward slashes with
  no characters needing escaping.

**UNVERIFIED:** the precise `bash`-quoting / `sed`-BRE escapement interaction that made the pattern
non-matching. Three attempts to isolate it failed on shell-quoting in the isolation harness itself,
and I stopped rather than burn more time on a moot point — because the actual defect was **not** the
escaping. The defect was that the transform had **no assertion that it changed anything**, and
`sed` exits 0 when a pattern silently matches nothing.

**The fix is assertion-based, not escaping-based** — see §10.5 item 2 and the guarded harness
(`guarded_scratch.py`), which aborts unless `bytes.count(prod) == 1` and `prod not in result`. With
the guard in place the same class of mistake is impossible: it fails closed and executes nothing.

### 10.5 What I did NOT do, and the decisions that are yours

I deliberately **did not clean up**. Deleting `2026-09-30.lock` or restoring the ledger would (a) be
another unapproved write to production, (b) destroy the audit trail of what happened, and (c) decide
a question that this routine's R1/R4 discipline reserves for a human. The state above is left exactly
as the incident left it.

Three human decisions:

1. **Accept or remediate the 2026-09-30 lock.** Accepting means today simply has a `MONITOR_DEGRADED`
   reading and no second read is possible. Remediating means a human deliberately removes
   `state/day-locks/2026-09-30.lock` so a real reading can be entered —
   `rm "D:/AgenticOS/data/freecash-monitor/state/day-locks/2026-09-30.lock"` — and, if you want the
   ledger clean, restores `last-run.json`. **Do not let an agent decide this.**
2. **Accept the 9 spurious notifications** (they went to the desktop at 21:01–21:02 local) or treat
   them as a false alarm to be explained to whoever saw them.
3. **Amend the alert log?** I recommend **no** — `alerts/alerts.jsonl` is the append-only canonical
   evidence record (`paths.py:21`), and appending a corrective note is the only edit consistent with
   that design. Rewriting history there would be worse than the incident.

### 10.6 The lesson, applied

The mistake was mine and it was avoidable: **a text transform that can silently no-op was used to
isolate a destructive action, and its output was not verified before that action ran.** Two rules
follow, and both are now enforced in the artifacts:

1. Any wrapper used to redirect state must be **asserted** to contain zero occurrences of the
   production root before it is executed (`guarded_scratch.py`, verified failing closed in probe
   V8b).
2. Run destructive-capable steps against a root that **cannot** be production, and re-hash the
   production artefacts before and after (probes V8a/V8e — production bytes identical across the
   corrected run).

**Bottom line for a reviewer:** everything in §1–§9 about *scheduler wiring* stands and is
executable; everything about *production state being untouched* was true until 21:01 and is false
from 21:01 onward. Treat §10 as authoritative for production state.

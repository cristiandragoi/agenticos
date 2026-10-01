# 01 — Scheduling & Operations Workflow

Daily status-monitoring plan for the FreeCash routine (`D:/AgenticOS/monitoring/freecash/`).
Scope of this section: **when the daily check fires, on which interpreter, how a missed
day is surfaced, where output is kept, and how the schedule is proven to have fired.**

Date of authoring: 2026-09-30 · Timezone: Europe/Berlin (machine TZ `W. Europe Standard Time`)

---

## Rules (verbatim, apply to the whole plan)

> **R1 — exactly one status check per day (no retry, no manual re-check).**
> **R2 — no earning/transaction action ever.**
> **R3 — notify when earnings or account status changes.**
> **R4 — human approval before any external action.**

---

## 0. Current state (all claims re-verified live on 2026-09-30)

| Fact | Command | Observed |
|---|---|---|
| No scheduled task exists | `schtasks /query /fo LIST /v \| grep -i freecash` | no output / no match |
| No Hermes cron job exists | `ls C:/Users/cd-pr/AppData/Local/hermes/cron/jobs.json` ; `grep -ril freecash .../cron/` | `No such file or directory`; `NO freecash ref in hermes cron` |
| Last real run | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED` |
| Artifacts on disk | `ls data/freecash-monitor/state/day-locks/ data/freecash-monitor/snapshots/` | only `2026-09-20.lock`, `2026-09-20.json` |
| Routine is green | `python monitoring/freecash/tests/run_all.py` | `tests=52 failures=0 errors=0`, exit 0 |
| Read-only verifier is real | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 … PASS`, exit 0 |
| Machine TZ | `tzutil /g` | `W. Europe Standard Time` (== Europe/Berlin offsets) |
| Machine wall clock | `date` | `Mi, 30. Sep 2026 20:52` (+0200 CEST) |

**The routine is currently unscheduled.** It last ran 10 days ago. From tomorrow it is
silently missed every day until a trigger is registered.

---

## 1. Pinned interpreter (a)

**Pin: `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`**

This is the *only* interpreter on this host that can resolve `ZoneInfo("Europe/Berlin")`,
because it is the only one with `tzdata` installed.

Live proof (2026-09-30):

```
$ "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" -c "import sys, tzdata; from zoneinfo import ZoneInfo; print(sys.version); print('tzdata', tzdata.__version__); print(ZoneInfo('Europe/Berlin'))"
3.11.9 (tags/v3.11.9:de54cf5, Apr  2 2024, 10:12:12) [MSC v.1938 64 bit (AMD64)]
tzdata 2025.3
Europe/Berlin

$ "C:/Python314/python.exe" -c "import tzdata"
ModuleNotFoundError: No module named 'tzdata'

$ "C:/Users/cd-pr/AppData/Local/Programs/Python/Python311/python.exe" -c "import tzdata"
ModuleNotFoundError: No module named 'tzdata'
```

`gate.resolve_tz()` **fails closed**: when the IANA name cannot be resolved it silently
degrades to the machine's own local zone and reports `kind="system-local"`. That is a
`MONITOR_DEGRADED` day. Observable difference, same entry point, same scratch state root:

```
$ FREECASH_DATA_ROOT=<scratch> <venv python>  monitoring/freecash/run_daily_check.py
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED …              # no tz warning
$ FREECASH_DATA_ROOT=<scratch> <venv python> -c "…gate.timezone_report()…"
{'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}

$ FREECASH_DATA_ROOT=<scratch> C:/Python314/python.exe monitoring/freecash/run_daily_check.py
WARNING timezone_unavailable configured=Europe/Berlin offset=+0200
{'configured': 'Europe/Berlin', 'kind': 'system-local', 'available': False, 'offset_now': '+0200'}
```

**Why pinning is mandatory, not cosmetic:** the day key (`day_key()`) and the day-lock
filename are derived from `ZoneInfo("Europe/Berlin")`. On a non-`tzdata` interpreter the
key is derived from the *system* zone. Today the two agree (both +0200), but they diverge
for the ~2 weeks a year around the DST transitions and whenever the machine zone is
changed — producing a wrong/gap day key and a permanent `MONITOR_DEGRADED` verdict.
The pinned path also matches `where python`'s first hit, so a bare `python` is *accidentally*
correct today; that is exactly why it must be written down explicitly.

The routine is **stdlib-only**, so no package installation, no venv activation, no `PATH`
manipulation is needed — the absolute path to the interpreter is the whole dependency.

> Do not put the venv `Scripts` dir on `PATH`; invoke by absolute path so the interpreter
> can never drift when other tools edit `PATH`.

---

## 2. Trigger time and rationale (b)

**Register two triggers, one task each, at operator-local wall-clock time:**

| Task | Time (local, Europe/Berlin) | Purpose |
|---|---|---|
| `\FreeCash\DailyStatusCheck` | **20:00** | the one and only daily status check (R1) |
| `\FreeCash\MissedDayWatchdog` | **22:00** | same-evening miss detector (see §4) |

**Why 20:00:**

1. **After the earning day.** The snapshot is meant to describe "today". 20:00 local is
   after normal daytime activity and matches the only observed real run (2026-09-20,
   21:08 local / `19:08Z`).
2. **Margin before midnight.** R1's day key rolls at Berlin midnight. A 20:00 trigger leaves
   ~4 hours of slack to absorb `StartWhenAvailable`'s queue delay (below) and a slow first
   start without the run leaking into the next day key (which would consume tomorrow's lock
   and make *today* look missed).
3. **Room for the watchdog.** The watchdog fires 2 h later at 22:00 — still the same evening,
   so a skipped check becomes visible while the operator can act on it, and the operator can
   inspect `state/operator-state.json` before the day closes.
4. **Not at 00:00/23:xx.** Avoids the day-boundary and the DST transition hour; both are the
   two moments where a "one per operator-local day" rule is most fragile.

**Surviving sleep / reboot — the actual flag.**

The Task Scheduler setting on the **Settings** tab is
*"Run task as soon as possible after a scheduled start is missed"*. Its real, on-disk
identity is the XML element:

```xml
<StartWhenAvailable>true</StartWhenAvailable>
```

This is not a guess — it was read back out of a live task on this machine:

```
$ schtasks /query /tn "\Microsoft\Windows\Time Synchronization\SynchronizeTime" /xml | grep -i StartWhenAvailable
    <StartWhenAvailable>true</StartWhenAvailable>
$ schtasks /query /tn "\Microsoft\Windows\Defrag\ScheduledDefrag" /xml | grep -i StartWhenAvailable
    <StartWhenAvailable>true</StartWhenAvailable>
```

Documented behaviour (Microsoft, `ITaskSettings::get_StartWhenAvailable`): a task started
after its scheduled time has passed is queued and started **after a delay, default 10 minutes**.

> **Important:** `schtasks /create` exposes **no** command-line switch for this flag. The
> German help output on this host confirms only `/SC /MO /D /ST /RI /ET /DU /K /XML /V1` and
> friends — registration must go through `**/XML**`. Registering with
> `schtasks /create /sc DAILY /st 20:00` would silently create a task **without** the
> catch-up setting, i.e. a missed run on a sleeping machine would simply be lost.

Also set in the XML:

- `<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>` and
  `<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>` — otherwise a laptop on battery
  silently skips the run (a self-inflicted R1 violation).
- `<WakeToRun>true</WakeToRun>` — wakes the machine from sleep for the 20:00 trigger.
  (It does **not** help when the machine is fully powered off; that case is `StartWhenAvailable`
  + the watchdog, §4.)
- `<ExecutionTimeLimit>PT15M</ExecutionTimeLimit>` — a hung run must not hold the day open
  indefinitely; the day-lock is already written, so a timeout means "attempted, outcome not
  recorded", which the next day's `missed_days()` reports.
- `<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>` — structural second belt
  against two runs overlapping (R1 is owned by the lock, this just avoids the pile-up).

---

## 3. Registration (c) — literal commands

Run from **an elevated PowerShell/cmd** (creating a task under a folder needs admin).
Paths use real Windows separators; nothing under `monitoring/` or `server/` is written.

### 3.1 Materialise the task XML (in the artifacts dir, not the repo code tree)

Write this to `D:\AgenticOS\artifacts\freecash-monitor-plan\freecash-daily-check.xml`:

```xml
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>FreeCash daily status monitor (rules R1-R4). One status read per operator-local day. Read-only; executes no earning action.</Description>
    <URI>\FreeCash\DailyStatusCheck</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-10-01T20:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <WakeToRun>true</WakeToRun>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Windows\System32\cmd.exe</Command>
      <Arguments>/c ""C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe" "D:\AgenticOS\monitoring\freecash\run_daily_check.py" >> "D:\AgenticOS\data\freecash-monitor\logs\run-%DATE%.log" 2>&1"</Arguments>
      <WorkingDirectory>D:\AgenticOS</WorkingDirectory>
    </Exec>
  </Actions>
  <Principals>
    <Principal id="Author">
      <UserId>cd-pr</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
</Task>
```

Notes on the `<Arguments>` string:

- `cmd /c` is required because Task Scheduler has no redirection of its own; it is the
  shell that opens the log file.
- `%DATE%` on this host expands to `30.09.2026`, producing
  `run-30.09.2026.log`. The retention pass globs `run-*.log` and cuts off on **mtime**
  (`entry.stat().st_mtime`), so the German date format is safe — the name only has to match
  the pattern, its date is never parsed. Verified:
  `cmd.exe /c "echo %DATE%"` → `30.09.2026`.
- `LogonType InteractiveToken` + `RunLevel LeastPrivilege` means the task runs only while
  `cd-pr` is logged on — which is the normal case for a desktop monitor, and means the run
  can see the same user's `data/` files. If the machine is used logged-off, switch to
  `<LogonType>Password</LogonType>` with a stored credential; the routine needs no elevation.

### 3.2 Create the folder and register the task

```bat
schtasks /create /tn "\FreeCash\DailyStatusCheck" /xml "D:\AgenticOS\artifacts\freecash-monitor-plan\freecash-daily-check.xml" /f
```

### 3.3 Register the watchdog (22:00, same interpreter, same hardening)

Same XML with `<URI>\FreeCash\MissedDayWatchdog</URI>`,
`<StartBoundary>2026-10-01T22:00:00</StartBoundary>` and the script swapped to
`D:\AgenticOS\monitoring\freecash\watchdog.py`, then:

```bat
schtasks /create /tn "\FreeCash\MissedDayWatchdog" /xml "D:\AgenticOS\artifacts\freecash-monitor-plan\freecash-watchdog.xml" /f
```

### 3.4 Verify registration

```bat
schtasks /query /tn "\FreeCash\DailyStatusCheck" /xml | findstr /i "StartWhenAvailable WakeToRun StartBoundary"
schtasks /query /tn "\FreeCash\DailyStatusCheck" /fo LIST /v
```

Expected: `StartWhenAvailable` = `true`, `StartBoundary` = `…T20:00:00`,
`Next Run Time` = today/tomorrow 20:00, `Last Result` = `267011` (`0x41303`, "has not yet run").

---

## 4. Missed-day detection (d)

Two independent detectors already exist in the routine. Scheduling must wire up **both**,
because they cover different failure modes.

**(i) In-band, next-run detector — `gate.missed_days()`.**
On each run the routine compares `last_success_day` to today and emits a `MISSED_DAY`
change for every gap day (see `run_daily_check._run`). This is authoritative for *how many*
days were missed, but it only speaks on the **next** run — too late if the routine is never
scheduled at all.

**(ii) Out-of-band, same-evening detector — `watchdog.py`, task `\FreeCash\MissedDayWatchdog`
at 22:00.** It reads only the ledger and prints/alerts:

- `WATCHDOG_OK <day> attempt=<day> outcome=<outcome>` when today is covered, or
- `WATCHDOG_MISSED_DAY <day> last_attempt_day=… last_outcome=… coverage=<outcome>`
  otherwise, appended to `alerts/alerts.jsonl`.

The watchdog is deliberately crippled so it can never become a second status check:
it opens no socket, imports no `readonly_client`, writes no ledger, creates/clears no
day-lock, writes no snapshot, and always exits 0. Its only writes are `alerts/alerts.jsonl`
and the dedupe index `state/notified-keys.json` — so it emits **at most one** MISSED_DAY
alarm per day (`coverage=DEDUPED` on a second run). Both branches were exercised live today
by the test suite:

```
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=INITIAL_BASELINE
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=NOTIFIED
WATCHDOG_MISSED_DAY 2026-09-30 last_attempt_day=None last_outcome=None coverage=DEDUPED
```

**Machine was powered off at 20:00 → what happens:**

| Scenario | Behaviour |
|---|---|
| Asleep at 20:00, wakes before 22:00 | `WakeToRun` wakes it, or `StartWhenAvailable` queues the run and fires it ~10 min after wake. Day is consumed normally. |
| Asleep/off at 20:00 and 22:00, wakes 23:40 same day | `StartWhenAvailable` runs the check late, still under the **same** Berlin day key → correct day-lock, correct snapshot. Watchdog may already have alarmed at 22:00; that alarm is accurate at the time and is deduped afterwards. |
| Off for one or more whole days | On next boot `StartWhenAvailable` runs the check **for the new day**. The old day(s) are reported by `gate.missed_days()` on that run as `MISSED_DAY` changes → alerting (R3) fires; and the 22:00 watchdog on each of the missed evenings could not run, so the *next* run is the reporter. `consecutive_missed_days` in `last-run.json` carries the count. |
| Stays off for days | R1 is **not** back-filled: the routine never reads a past day's status. Missed days are reported as missed, never silently reconstructed. That is intentional — a retroactive read would be a status read outside the operator's current day and would collide with R1. |

**Escape hatch that must stay closed:** `run_daily_check.py --force-recheck` is refused by
design, appends a `REFUSED` record to `logs/forced-recheck-requests.jsonl`, and exits **3**.
It is not a route around a missed day. Nothing in this schedule passes that flag.

---

## 5. Logs, state and retention (e)

**State root (fixed):** `D:\AgenticOS\data\freecash-monitor\` — default from
`paths.DEFAULT_DATA_ROOT`, overridable by `FREECASH_DATA_ROOT` (the tests override it to a
`tempfile.TemporaryDirectory`, which is why the 52-test run left the real state untouched —
re-checked: real `day-locks/` still contains only `2026-09-20.lock`).

| Path | Written by | Retention |
|---|---|---|
| `state/last-run.json` | the check | live, single source of truth |
| `state/day-locks/<YYYY-MM-DD>.lock` | the check (O_CREAT\|O_EXCL) | **never pruned** — this is the R1 evidence |
| `state/notified-keys.json` | notify / watchdog | live dedupe index |
| `state/operator-state.json` | operator (hand-entered daily figures) | live |
| `snapshots/<YYYY-MM-DD>.json` | the check | **90 days** |
| `alerts/alerts.jsonl` | notify / watchdog, append-only | **never pruned** (audit record) |
| `approvals/pending.json`, `approvals/decided.jsonl` | approval queue | `decided.jsonl` never pruned (audit) |
| `logs/run-<DD.MM.YYYY>.log` | the scheduled task's stdout/stderr redirect | **30 days** |
| `logs/forced-recheck-requests.jsonl` | `--force-recheck` attempts | never pruned |

**Rotation is already implemented and already runs** at the end of every real check
(`changedetect.prune_old_artifacts`, called from `_run` only when no clock is injected, so
tests never prune):

```
_RETENTION_SNAPSHOT_DAYS = 90
_RETENTION_LOG_DAYS      = 30
```

It deletes snapshots older than 90 days and `logs/run-*.log` older than 30 days (by file
mtime). It deliberately leaves `alerts/alerts.jsonl` and `approvals/decided.jsonl` alone.

Two consequences to accept explicitly:

1. **`logs/` is only populated by the scheduled task's shell redirect.** The routine writes
   nothing to `logs/` on a normal run (its evidence record is `alerts/alerts.jsonl`). If the
   task is registered without the `>>` redirect, `logs/` stays empty and there is no
   stdout trail — the XML above exists specifically to prevent that.
2. Day-locks and the alert log grow without bound by design (~365 tiny files and ~1 line/day
   respectively). That is the correct trade for an audit trail; do not "tidy" them.

---

## 6. Acceptance test (f) — prove the trigger actually fired

Every step is a command you can paste. Steps 1–3 are safe at any time; step 4 is the real
daily run and must not be performed twice in one Berlin day.

### Step 1 — registration is correct (no run happens)

```bat
schtasks /query /tn "\FreeCash\DailyStatusCheck" /xml | findstr /i "StartWhenAvailable WakeToRun StartBoundary DaysInterval"
schtasks /query /tn "\FreeCash\DailyStatusCheck" /fo LIST /v | findstr /i "TaskName Next Status Last"
```

**PASS:** `StartWhenAvailable>true`, `WakeToRun>true`, `StartBoundary` ends `T20:00:00`,
`DaysInterval>1`, and `Last Result: 267011` (`0x41303`, "has not yet run") before the first fire.
**FAIL:** any of those absent, or `StartWhenAvailable>false` — the task will not catch up after sleep.

### Step 2 — dry run the exact task command against a scratch state root (never touches real state)

```bash
cd /d/AgenticOS
SCRATCH="C:/Users/cd-pr/AppData/Local/Temp/fc-acceptance-$$"
FREECASH_DATA_ROOT="$SCRATCH" "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" monitoring/freecash/run_daily_check.py
echo "exit=$?"          # MUST be 0
ls "$SCRATCH/state/day-locks/" "$SCRATCH/snapshots/"
rm -rf "$SCRATCH"
```

**PASS:** one `RUN_OK <today> outcome=… snapshot=<today>.json written=True …` line, `exit=0`,
and exactly one lock + one snapshot in the scratch root. **No `WARNING timezone_unavailable`.**
**FAIL:** a `WARNING timezone_unavailable` line (wrong interpreter pinned), a traceback, or `exit!=0`.

Live result of this exact dry run on 2026-09-30:

```
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
exit=0
```

### Step 3 — force one real run through the scheduler itself

Either wait for 20:00, or (on install day only) run it on demand — the same single run,
which is still exactly one status read for today:

```bat
schtasks /run /tn "\FreeCash\DailyStatusCheck"
```

If today's check has **already** fired, this returns `SKIP_DUPLICATE_DAY <today>` and exit 0
— which is itself the R1 proof (no second read, no second snapshot, no ledger change).

### Step 4 — the assertions that prove the schedule fired and produced today's artifacts

```bash
cd /d/AgenticOS
TODAY=$(TZ=Europe/Berlin date +%F)                 # operator-local day key
test -f "data/freecash-monitor/state/day-locks/$TODAY.lock"        && echo "PASS day-lock $TODAY" || echo "FAIL day-lock missing"
test -f "data/freecash-monitor/snapshots/$TODAY.json"              && echo "PASS snapshot $TODAY" || echo "FAIL snapshot missing"
grep -o '"last_attempt_day": "[^"]*"' data/freecash-monitor/state/last-run.json   # MUST equal $TODAY
ls -l "data/freecash-monitor/logs/run-$(TZ=Europe/Berlin date +%d.%m.%Y).log"     # non-empty stdout trail
tail -n 5 data/freecash-monitor/alerts/alerts.jsonl
```

```bat
schtasks /query /tn "\FreeCash\DailyStatusCheck" /fo LIST /v | findstr /i "Last Run Time Last Result"
```

**PASS (all of):**
- `Last Run Time` = today, `Last Result: 0`.
- `state/day-locks/<today>.lock` exists.
- `snapshots/<today>.json` exists.
- `last-run.json` → `"last_attempt_day": "<today>"`.
- `logs/run-<DD.MM.YYYY>.log` exists and contains a `RUN_OK` line.
- `alerts/alerts.jsonl` contains **no** `WATCHDOG_MISSED_DAY` for today.

**FAIL looks like any of:**
- `Last Result` non-zero (`0x1`, `0x2`, `0x80070002` = path/interpreter not found — the
  symptom of a mistyped pinned interpreter path).
- Today's day-lock or snapshot absent while `Last Run Time` is today → the task fired but the
  routine failed before writing; read the day's `logs/run-*.log`.
- `last_attempt_day` still `2026-09-20` → nothing fired.
- `WATCHDOG_MISSED_DAY <today>` in `alerts.jsonl` → the watchdog judged today uncovered at
  22:00; the schedule did not fire.
- `Last Run Time` older than today → the task is disabled or `StartWhenAvailable` is false.

### Step 5 — negative control (proves the test can fail)

Temporarily disable the task and confirm the watchdog alarms, so the whole chain is known to
be sensitive rather than vacuously green:

```bat
schtasks /change /tn "\FreeCash\DailyStatusCheck" /disable
schtasks /run  /tn "\FreeCash\MissedDayWatchdog"
type D:\AgenticOS\data\freecash-monitor\alerts\alerts.jsonl
schtasks /change /tn "\FreeCash\DailyStatusCheck" /enable
```

**Expected:** a `WATCHDOG_MISSED_DAY` line appears. If it does not, the detection chain is
broken and the green steps above mean nothing. A second watchdog run the same day must add
**no** new line (`coverage=DEDUPED`) — that is the one-alarm-per-day property.

---

## 7. Windows Task Scheduler vs. a Hermes cron job

**Chosen: Windows Task Scheduler.** Trade-off, stated plainly:

| | Windows Task Scheduler (chosen) | Hermes cron job |
|---|---|---|
| Fires when Hermes is not running | **Yes** — the OS owns the trigger | No — depends on the Hermes ticker/daemon being alive (`cron/ticker_heartbeat`, `ticker_last_success` present, so a ticker *is* running today, but it is not an OS guarantee) |
| Determinism | One process, one stdlib script, fixed exit code | Injects an agent/LLM turn — non-deterministic text, and an LLM turn is itself an actor that could overstep R2/R4 |
| Missed start after sleep/off | Native `StartWhenAvailable` + `WakeToRun` | No native catch-up; a missed tick is just skipped |
| Audit | `Last Run Time` / `Last Result` from the OS, plus the routine's own lock/snapshot | `executions.db` |
| Management | XML + `schtasks` (manual, needs admin) | Chat-native if you have the `cronjob_manage` tool |
| Fit for "exactly one read, no retry" (R1) | Strong — fires once, the code refuses a second read | Weaker — an agent turn invites ad-hoc re-checks |

For a deterministic, read-only, run-when-idle job the OS scheduler is the correct home; a
Hermes cron job would add an LLM turn precisely where the plan wants none.

**Blocked:** I do not have the `cronjob_manage` tool in this session, so I could not create,
inspect or dry-run a Hermes cron job to compare empirically. The Hermes-cron column above is
reasoning from the observed `cron/` directory contents, not from an executed cron job. If a
Hermes cron path is ever wanted, it must be validated by someone holding that tool.

---

## 8. Which rules this section enforces

**Enforced here:**

- **R1 — exactly one status check per day (no retry, no manual re-check).** This is the
  rule *this section owns*. The schedule creates exactly one trigger per day
  (`DaysInterval>1`, one task); `MultipleInstancesPolicy=IgnoreNew`; `gate.acquire_day_lock`
  refuses a second consumption of the same day; a duplicate run prints `SKIP_DUPLICATE_DAY`
  and exits 0 having done no read and written no snapshot; `--force-recheck` is refused
  (exit 3) and audited. There is no scheduled retry and no scheduled re-check.

**Supported operationally, but not enforced here:**

- **R3 — notify when earnings or account status changes.** The schedule guarantees the daily
  run *happens*, which is what makes the existing notify path (`notify.py`,
  `alerts/alerts.jsonl`, `state/notified-keys.json`) reachable; the watchdog's `MISSED_DAY`
  alarm is delivered on the same channel. What counts as a change, and the dedupe, live in
  `changedetect.py` / `notify.py` — not in this section.
- **R4 — human approval before any external action.** The schedule reaches the approval path
  (`approvals/pending.json`, `demands` reminders), but it grants no approval and performs no
  external action. The gate itself is `approval_queue.py` — out of scope here.

**Not enforced here (this section cannot violate or satisfy them, and must not be read as doing so):**

- **R2 — no earning/transaction action ever.** Enforced by `readonly_client.py`,
  `readonly_client.install_audit_guard()` and `verify_readonly.py` (`forbidden=0 … PASS`).
  Scheduling neither adds nor removes that guarantee; the pinned interpreter and the task
  action deliberately invoke only `run_daily_check.py` / `watchdog.py`.
- **R3/R4 content ownership** — the *policy* of what to notify and what needs approval lives
  in the notify/approval modules, not in the trigger.

---

## 9. Blocked / unverifiable

- **A Hermes cron job was never created or exercised**, because `cronjob_manage` is not in
  this session's toolset. The comparison in §7 is inferred from the observed `cron/`
  directory, not measured.
- **The registration commands in §3 have not been executed** against this machine — they are
  written from the live `schtasks /create /?` help output, a live `/xml` read-back of two
  existing tasks confirming `StartWhenAvailable`, and the observed `%DATE%` format. Registering
  is a state-changing, admin-level action outside this task's remit; the first execution of
  §3 is itself the first run of the acceptance test in §6.
- **Wall-clock behaviour across a real sleep/DST boundary is not empirically tested** here.
  It rests on the documented `StartWhenAvailable` semantics plus the routine's day-key code
  (`gate.day_key` via `ZoneInfo("Europe/Berlin")`), both verified, but not observed over a
  real event.
- Whether the operator machine is routinely **logged off** is unknown; if so, the
  `LogonType InteractiveToken` principal must be switched to a stored-credential
  `Password` logon (noted in §3.1).

# SCHEDULER-AND-DELIVERY.md

**Delegation:** DELEGATION-2026-09-21 · **Host:** Windows 11 (`CDINTERNATIONAL`), user `cd-pr`
**Repo:** `D:\AgenticOS` · **Date of evidence:** 2026-09-21 (local `Europe/Berlin`, UTC+02:00)
**Scope:** reconnaissance and specification only. **Nothing was registered, created, enabled,
deleted or modified.** No notification or email was sent. Rule **R4** (human approval before any
external action) was honoured throughout.

---

## 0. Two corrections to the inherited findings, stated up front

These change the conclusions, so they come first.

| Inherited claim | Verified reality | How it was established |
|---|---|---|
| "`curl -m5 localhost:3001/health` returned http=000 — **the app was not running**" | **False.** The backend default port is **4600**, not 3001. The app **is running**: `curl -sS -m5 http://localhost:4600/api/health` → `http=200`, body `{"status":"healthy",...,"version":"9.0.0",...}`. `netstat` shows `0.0.0.0:4600 ... ABHÖREN 13900` (PID 13900 = `node.exe`). | §3.4 below, quoted raw |
| "`schtasks /Query` filtered by `TaskName`" | The pattern was wrong. This is a **German-localised** Windows: the column is `Aufgabenname:`, the listening state is `ABHÖREN`, not `LISTENING`. A `grep "^TaskName"` over the localised output returns **0 tasks** and would falsely suggest the scheduler is empty. | §1.2 below |

A third inherited finding is confirmed and is the single most consequential fact in this report:
**an unattended scheduled run spends the day lock *before* it reads anything.** See §4.3.

---

## 1. Scheduler reality

### 1.1 Targeted queries — the two candidate task names do not exist

```
$ schtasks /Query /TN "FreeCash-Daily-Monitor"
FEHLER: Das System kann die angegebene Datei nicht finden.

$ schtasks /Query /TN "FreeCash-Daily-Monitor-Missed-Day-Watchdog"
FEHLER: Das System kann die angegebene Datei nicht finden.
```

`FEHLER: Das System kann die angegebene Datei nicht finden.` ("the system cannot find the file
specified") is the expected German-Windows text for a task that does not exist.

Encoding note — the output is **plain ASCII/CP850, not UTF-16**, verified so that the quotes above
are trustworthy rather than a decoding artefact:

```
$ schtasks /Query /TN "FreeCash-Daily-Monitor" | head -c 120 | od -c
0000000   F   E   H   L   E   R   :       D   a   s       S   y   s   t
0000020   e   m       k   a   n   n       d   i   e       a   n   g   e
0000040   g   e   b   e   n   e       D   a   t   e   i       n   i   c
0000060   h   t       f   i   n   d   e   n   .  \r  \r  \n
```

### 1.2 Full enumeration — 275 tasks, none Free Cash related

```
$ schtasks /Query /FO LIST /V > all-tasks.txt
bytes: 646086  lines: 8111

$ grep -c "^Aufgabenname:" all-tasks.txt
275

$ grep "^Aufgabenname:" all-tasks.txt | grep -vE "^\\Microsoft" | sort -u
\Adobe Acrobat Update Task
\cua-driver-serve
\Hermes_Gateway
\Microsoft\Office\Office Actions Server
... (Microsoft\Office and Microsoft\Windows entries omitted for brevity) ...
\OneDrive Per-Machine Standalone Update Task
\OneDrive Reporting Task-S-1-5-21-3435097649-250514390-3575566063-1001
\OneDrive Startup Task-S-1-5-21-3435097649-250514390-3575566063-1001
\SoftLanding\S-1-5-21-...\SoftLandingCreativeManagementTask
\SoftLanding\S-1-5-21-...\SoftLandingDeferralTask-{2769049f-...}
\SoftLanding\S-1-5-21-...\SoftLandingTriggerTask-128000000001615609-render-{3eb4d7c6-...}

$ grep "^Aufgabenname:" all-tasks.txt | grep -iE "free|cash|dispatch|earn"
NONE
```

**Verdict: no Free Cash monitor task has ever been registered on this host.** The routine has
never been scheduled. This confirms the inherited finding.

### 1.3 Two existing per-user tasks prove the *shape* is supported here

`\Hermes_Gateway` and `\cua-driver-serve` are real, registered, activated tasks that run as
`cd-pr` in an interactive session:

```
$ schtasks /Query /TN "Hermes_Gateway" /FO LIST /V   (excerpt)
Aufgabenname:                  \Hermes_Gateway
Anmeldemodus:                  Nur interaktiv          <- Logon mode: Interactive only
Autor:                         Nicht zutreffend        <- Author: N/A (installer-created)
Auszuführende Aufgabe:         wscript.exe //B //Nologo "...\Hermes_Gateway.vbs"
Status der geplanten Aufgabe:  Aktiviert
Als Benutzer ausführen:        cd-pr
Zeitplantyp:                   Bei der Anmeldung      <- Trigger: At logon

$ schtasks /Query /TN "cua-driver-serve" /FO LIST /V   (excerpt)
Aufgabenname:                  \cua-driver-serve
Anmeldemodus:                  Nur interaktiv
Als Benutzer ausführen:        cd-pr
Zeitplantyp:                   Bei der Anmeldung
```

Important limit on what this proves: `Autor: Nicht zutreffend` means neither task records a
creating author, so **their provenance (elevated installer vs. non-elevated install) is unknown**.
They demonstrate that a root-level per-user interactive task is a supported configuration on this
host. They do **not** prove a non-elevated process can register one.

---

## 2. Exact proposed Task A and Task B definitions

### 2.1 The elevation question — what the documentation actually says, and what this host shows

Microsoft's `schtasks create` reference is unambiguous in its Remarks:

> "The **/ru** parameter determines the permissions under which the task runs, not the permissions
> used to schedule the task. **Only Administrators can schedule tasks, regardless of the value of
> the /ru parameter.**"
> — <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create>

So the *documented* answer is: **registration requires administrator rights; the task's own run
level is a separate matter.** Nothing about `/ru`, `/np` or `/it` changes that — they configure the
task, not the privilege needed to create it.

What this host shows, for the human deciding how to proceed:

```
$ /c/Windows/System32/whoami.exe /groups   (excerpt)
Gruppenname                                              Typ          SID
Verbindliche Beschriftung\Mittlere Verbindlichkeitsstufe Bezeichnung  S-1-16-8192
VORDEFINIERT\Administratoren                             Alias        S-1-5-32-544  ... Gruppen, die nur zum Ablehnen verwendet wird
NT-AUTORITÄT\Authentifizierte Benutzer                   Bekannte ... S-1-5-11

$ net session          (admin-only probe)
net session FAILED -> NOT elevated (exit 2)
```

Two facts to read from that:

1. **The current token is not elevated.** `S-1-16-8192` = *Medium Mandatory Level* ("Mittlere
   Verbindlichkeitsstufe"). An elevated token would read `S-1-16-12288`.
2. **`cd-pr` *is* a member of `Administratoren` (S-1-5-32-544)** — but the group is currently
   marked "deny-only" (this is the normal filtered token from a non-elevated UAC start). So
   elevation is **available to this user via a UAC prompt**; there is no missing-rights problem.

The task store ACL is the only evidence pointing the other way:

```
$ icacls "C:/Windows/System32/Tasks"
C:/Windows/System32/Tasks VORDEFINIERT\Administratoren:(CI)(F)
                          VORDEFINIERT\Administratoren:(OI)(R,W,D,WDAC,WO)
                          NT-AUTORITÄT\SYSTEM:(CI)(F)
                          NT-AUTORITÄT\SYSTEM:(OI)(R,W,D,WDAC,WO)
                          NT-AUTORITÄT\Authentifizierte Benutzer:(CI)(W,Rc)
                          NT-AUTORITÄT\Netzwerkdienst:(CI)(W,Rc)
                          NT-AUTORITÄT\Lokaler Dienst:(CI)(W,Rc)
                          ERSTELLER-BESITZER:(OI)(CI)(IO)(F)
1 Dateien erfolgreich verarbeitet, ...

$ ls "C:/Windows/System32/Tasks"
ls: cannot open directory 'C:/Windows/System32/Tasks': Permission denied
```

`Authentifizierte Benutzer:(CI)(W,Rc)` grants Authenticated Users write on the container, and
`ERSTELLER-BESITZER:(OI)(CI)(IO)(F)` gives Creator-Owner full control on objects it creates. That
is consistent with non-elevated creation sometimes succeeding — but list access is denied, and the
ACL is **not** a reliable predictor of how the Task Scheduler service will authorise the
registration call.

**Honest verdict:** the documented semantics say elevation is required; the local ACL is
suggestive but not authoritative; the two existing tasks have unknown provenance. **The question
cannot be settled without attempting a registration, and I did not perform one** (see §2.6).
The practical resolution is trivial and costs nothing: `cd-pr` is an Administrator, so if the
non-elevated attempt fails with "Access is denied", re-run the identical command from an elevated
shell. Elevation is needed **only once, for registration** — the task itself runs non-elevated.

### 2.2 Flag semantics I can substantiate (with citations)

| Setting | Documented meaning | Citation |
|---|---|---|
| `StartWhenAvailable` | "gets or sets a Boolean value that indicates that the Task Scheduler **can start the task at any time after its scheduled time has passed**." | [TaskSettings.StartWhenAvailable](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable) |
| `MultipleInstancesPolicy = IgnoreNew` | `TASK_INSTANCES_IGNORE_NEW` (value 2): "**Does not start a new instance if an existing instance of the task is running.**" | [TaskSettings.MultipleInstances](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-multipleinstances) |
| `/RL <level>` | "Specifies the Run Level for the job. Acceptable values are **LIMITED** (scheduled tasks will be ran with the least level of privileges, such as Standard User accounts) and **HIGHEST** ... **The default value is Limited.**" | `schtasks create` reference, *Parameters* |
| `/IT` | "Specifies to run the scheduled task **only when the run as user ... is logged on** to the computer." | `schtasks create` reference, *Parameters* |
| `/XML <xmlfile>` | "Creates a task specified in the XML file. Can be combined with the **/ru** and **/rp** parameters..." | `schtasks create` reference, *Parameters* |
| Logon type for a per-user interactive task | `TASK_LOGON_INTERACTIVE_TOKEN` (3): "**User must already be logged on. The task will be run only in an existing interactive session.**" | [Principal.LogonType](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype) |
| Elevation for registration | "**Only Administrators can schedule tasks**, regardless of the value of the /ru parameter." | `schtasks create` reference, *Remarks* |

**Critical limitation — `StartWhenAvailable` and `IgnoreNew` are NOT reachable from `/Create`
switches.** Verified on this host:

```
$ schtasks /create /? | grep -ai "swa"
NO /swa flag -> StartWhenAvailable not settable via /create switches

$ schtasks /create /?   (switches actually offered, German)
    [/RI Intervall] [ {/ET Endzeit | /DU Dauer} [/K] [/XML XML-Datei] [/V1]]
    [/SD Startdatum] [/ED Enddatum] [/IT | /NP] [/Z] [/F] [/HRESULT] [/?]
    /IT   Ermöglicht das interaktive Ausführen der Aufgaben nur ...
    /NP   Es wird kein Kennwort gespeichert ...
    /XML  XML-Datei  Erstellt eine Aufgabe aus der Aufgaben-XML ...
    /RL   Ebene      Legt die Ausführungsebene für den Auftrag fest ...
```

There is no `/SWA` and no multiple-instances switch. `/XML` is therefore the **only** `schtasks`
route that carries the reliability semantics this routine wants. (PowerShell's `ScheduledTasks`
module can also express them — verified live on this host in §2.5.)

Substantiating quote on catch-up, from the prior in-repo decision record
(`.hermes/plans/freecash-monitor/WIRING-PLAN.md` §2.1), which reached the same conclusion
independently:

> "**It gives real catch-up semantics, the Node path cannot.** Task Scheduler's *"run as soon as
> possible after a missed start"* (`StartWhenAvailable`) fires a missed run once when the machine
> next becomes available."

### 2.3 Task A — daily status read

**Name:** `\FreeCash-Daily-Monitor`
**Trigger:** every day at **09:00 local** (`Europe/Berlin`), first fire **2026-09-22** (today's
09:00 has passed).
**Action:** `cmd.exe /c "<delegation dir>\freecash-task-a.cmd"`, working dir `D:\AgenticOS`.
**Effective environment (pinned inside the wrapper, not inherited):**

| Variable | Value | Why |
|---|---|---|
| `FREECASH_DATA_ROOT` | `D:\AgenticOS\data\freecash-monitor` | the real state root; `paths.py:35` default, pinned so no ambient value can redirect it |
| `FREECASH_TZ` | `Europe/Berlin` | read by `gate.py:48` to compute the R1 operator-local day key |
| `FREECASH_READ_SOURCE` | `operator_state` | `run_daily_check.py:81`; the default, pinned for explicitness |
| `FREECASH_TOAST_STUB` | *(cleared)* | `notify.get_sender()` returns the **stub** sender iff this equals `"1"` |
| `FREECASH_TOAST_RETRY_SLEEP_SECONDS` | `5` | the documented default |

**Pinned interpreter:** `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`

```
$ "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" -c "import sys,tzdata,zoneinfo;print(sys.version);print(zoneinfo.ZoneInfo('Europe/Berlin'))"
3.11.9 (tags/v3.11.9:de54cf5a, Apr  2 2024, 10:12:12) [MSC v.1938 64 bit (AMD64)]
tzdata ok
Europe/Berlin
```

Invocation verified to work from a **neutral cwd** with an absolute script path (this is what a
scheduled task does), read-only, against a scratch root:

```
$ cd /c && FREECASH_DATA_ROOT=".../fc-recon/neutral-cwd" FREECASH_TZ=Europe/Berlin \
    python.exe "D:/AgenticOS/monitoring/freecash/run_daily_check.py" --print-state
ledger: C:\Users\cd-pr\AppData\Local\Temp\fc-recon\neutral-cwd\state\last-run.json
  consecutive_missed_days  0
  last_attempt_day         None
  last_outcome             None
  ...
rc=0

$ python.exe "D:/AgenticOS/monitoring/freecash/run_daily_check.py" --version
freecash-monitor 1.0.0
```

`--print-state` is confirmed side-effect-free by reading its code path
(`run_daily_check.py:299-305`: loads the ledger, prints it, prints the pending count, `return 0`)
— it takes **no** day lock, writes **no** snapshot, sends **no** notification. Running it was
therefore safe and did not spend a day.

**Action XML:** `FreeCash-Daily-Monitor.xml` (in this directory). Relevant body:

```xml
<Principal id="Author">
  <UserId>S-1-5-21-3435097649-250514390-3575566063-1001</UserId>
  <LogonType>InteractiveToken</LogonType>
  <RunLevel>LeastPrivilege</RunLevel>
</Principal>
<Settings>
  <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
  <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
  <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
  <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
  <StartWhenAvailable>true</StartWhenAvailable>
  ...
</Settings>
<Triggers>
  <CalendarTrigger>
    <StartBoundary>2026-09-22T09:00:00</StartBoundary>
    <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
  </CalendarTrigger>
</Triggers>
```

`RunLevel=LeastPrivilege` is the `/RL LIMITED` equivalent; **never** `HighestAvailable` — nothing
in this routine needs elevation and asking for it would defeat the point.

### 2.4 Task B — late-day missed-run watchdog

**Name:** `\FreeCash-Daily-Monitor-Missed-Day-Watchdog`
**Trigger:** every day at **21:30 local**, first fire **2026-09-22**.
**Action:** `cmd.exe /c "<delegation dir>\freecash-task-b-watchdog.cmd"`.
Same interpreter, same `FREECASH_DATA_ROOT` / `FREECASH_TZ`, `FREECASH_TOAST_STUB` cleared.

The watchdog is safe to run unattended by construction — its own docstring is the specification:

> "* it opens **no** socket (it does not import `readonly_client` at all);
> * it never writes the ledger, never creates or clears a day lock, never writes a snapshot, never
>   touches the approval queue;
> * it never runs the status check;
> * its only writes are the two append-only records of the alert mechanism itself:
>   `alerts/alerts.jsonl` … and `state/notified-keys.json` …
> * exit code is always 0."

End-to-end smoke of that entry point, from a neutral cwd against a scratch root (no real state
touched, nothing sent to a human because the ambient test stub was in effect):

```
$ FREECASH_DATA_ROOT=".../fc-recon/neutral-cwd" python.exe "D:/AgenticOS/monitoring/freecash/watchdog.py"
WATCHDOG_MISSED_DAY 2026-09-21 last_attempt_day=None last_outcome=None coverage=NOTIFIED
watchdog rc=0
```

**Action XML:** `FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml` (in this directory).

### 2.5 The exact command lines a human would run

**Form A — `schtasks /Create /XML` (recommended; the only `schtasks` form carrying
`StartWhenAvailable` + `IgnoreNew`):**

```cmd
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-21\FreeCash-Daily-Monitor.xml"
schtasks /Create /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-21\FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml"
```
The task name comes from `<URI>` inside each XML. Add `/TN "\Name"` only if an override is wanted.

**Form B — pure `/Create` switches (minimal; loses both reliability settings):**

```cmd
schtasks /Create /TN "\FreeCash-Daily-Monitor" /SC DAILY /MO 1 /ST 09:00 ^
  /TR "cmd.exe /c \"D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-21\freecash-task-a.cmd\"" ^
  /IT /RL LIMITED /F

schtasks /Create /TN "\FreeCash-Daily-Monitor-Missed-Day-Watchdog" /SC DAILY /MO 1 /ST 21:30 ^
  /TR "cmd.exe /c \"D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-21\freecash-task-b-watchdog.cmd\"" ^
  /IT /RL LIMITED /F
```
`/IT` gives the interactive-token logon the toast needs; `/RL LIMITED` keeps it non-elevated. With
this form you get neither `StartWhenAvailable` (a missed 09:00 is simply lost) nor `IgnoreNew`.

**Form C — PowerShell, order-proof alternative.** XML element *ordering* is strict in the Task
Scheduler schema; the cmdlets build it for you, so this avoids that class of failure. Parameter
names below were read from the live module on this host, not from memory:

```
$ powershell -c "(Get-Command New-ScheduledTaskSettingsSet).Parameters['MultipleInstances'].ParameterType.GetEnumNames()"
Parallel
Queue
IgnoreNew

$ powershell -c "(Get-Command New-ScheduledTaskPrincipal).Parameters['RunLevel'].ParameterType.GetEnumNames()"
Limited
Highest

$ powershell -c "(Get-Command New-ScheduledTaskPrincipal).Parameters['LogonType'].ParameterType.GetEnumNames()"
None / Password / S4U / Interactive / Group / ServiceAccount / InteractiveOrPassword

$ powershell -c "if ((Get-Command New-ScheduledTaskSettingsSet).Parameters.ContainsKey('StartWhenAvailable')) {'StartWhenAvailable: PRESENT'}"
StartWhenAvailable: PRESENT

$ powershell -c "Get-Module -ListAvailable ScheduledTasks | Select-Object -First 1 -ExpandProperty Name"
ScheduledTasks
```

```powershell
$act = New-ScheduledTaskAction -Execute "C:\Windows\System32\cmd.exe" `
         -Argument '/c "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-21\freecash-task-a.cmd"' `
         -WorkingDirectory "D:\AgenticOS"
$trg = New-ScheduledTaskTrigger -Daily -At 09:00
$set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
         -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$prn = New-ScheduledTaskPrincipal -UserId "CDINTERNATIONAL\cd-pr" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "FreeCash-Daily-Monitor" `
  -Action $act -Trigger $trg -Settings $set -Principal $prn
```

**XML validity actually checked (not assumed):** both XML files in this directory were parsed and
their element order compared against a task this Windows build exported itself
(`\cua-driver-serve`):

```
FreeCash-Daily-Monitor.xml -> WELL-FORMED, version 1.4
  top-level order: ['RegistrationInfo', 'Principals', 'Settings', 'Triggers', 'Actions']
  Settings order : ['DisallowStartIfOnBatteries', 'StopIfGoingOnBatteries', 'ExecutionTimeLimit',
                    'MultipleInstancesPolicy', 'StartWhenAvailable', 'IdleSettings',
                    'UseUnifiedSchedulingEngine']

REFERENCE (real exported task on this host, cua-driver-serve):
  top-level order: [RegistrationInfo, Principals, Settings, Triggers, Actions]
  Settings order : [DisallowStartIfOnBatteries, StopIfGoingOnBatteries, ExecutionTimeLimit,
                    MultipleInstancesPolicy, RestartOnFailure, StartWhenAvailable,
                    IdleSettings, UseUnifiedSchedulingEngine]
```

Order matches the local reference exactly (the optional `RestartOnFailure` is deliberately
omitted). Well-formedness is proven; **schema acceptance by the registration service is not**,
because proving that requires registering, which R4 forbids. Form C is the mitigation.

### 2.6 Throwaway-task test — NOT performed, explicitly

**I did not create, register, enable, delete or modify any scheduled task.** The brief permitted a
single throwaway task created and deleted in the same breath; the hard constraint on this
delegation states flatly "DO NOT REGISTER, CREATE, ENABLE, DELETE OR MODIFY ANY SCHEDULED TASK,
cron entry, service or app schedule". I resolved the conflict in favour of the absolute
prohibition, because R4 exists precisely to prevent agent-initiated registration and because the
elevation answer is obtainable without it (documentation + token inspection + a UAC-elevated
retry, all of which are the human's to run). This is recorded here rather than silently skipped.

Consequently the elevation requirement remains **documented-only**, not empirically proven, and
the first command in §4 is the safe, reversible probe that settles it.

---

## 3. Notification reality — which sink can reach this human **today**

### 3.1 Candidate sinks, with verdict and evidence

| # | Candidate sink | Verdict | Evidence |
|---|---|---|---|
| 1 | **Windows toast** (`PowerShell` + `System.Windows.Forms.NotifyIcon` balloon) — implemented in `notify.py::_toast_send` | **ONLY IMPLEMENTED TRANSPORT.** Prerequisites verified; end-to-end delivery **deliberately unproven** (sending is forbidden) | `_toast_send` builds a PowerShell balloon script and raises on non-zero exit; `get_sender()` returns it by default. Live checks: `powershell.exe` present at `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell`; WinForms loads — `powershell -NoProfile -NonInteractive -c "Add-Type -AssemblyName System.Windows.Forms; ..."` → `WinForms loaded OK: System.Windows.Forms.NotifyIcon`; an active interactive desktop exists — `query user` → `>cd-pr  console  1  Aktiv  17.09.2026 08:45` |
| 2 | **`alerts/alerts.jsonl`** (append-only evidence log) | **WORKING. Always on. Not a notification** — it only reaches a human who opens the file | Real file exists, 2 lines. Append path proven empirically, including the failure branch (§3.3) |
| 3 | **SMTP inside `notify.py`** | **DOES NOT EXIST** | `grep -niE "smtp\|smtplib\|email\.\|sendgrid\|webhook\|requests\|urllib\|socket" monitoring/freecash/notify.py` → the **only** hit is line 8, a docstring: `SMTP   opt-in and OFF by default; not wired to any credential here`. No function in the module's `def` list implements it |
| 4 | **SMTP/webhook env vars** | **ABSENT AND NOT PERSISTENT** | See §3.2 |
| 5 | **`server/.env` mail settings** | **ABSENT** | 7 keys only: `DEFAULT_LLM_MODEL`, `DEFAULT_LLM_PROVIDER`, `GATEWAY_PROVIDER_ORDER`, `JARVIS_SUPERVISOR_V2`, `OLLAMA_BASE_URL`, `OLLAMA_FALLBACK_MODEL`, `OLLAMA_MODEL`. No SMTP/Resend/webhook key. The root `.env` has the identical 7 keys. `server/.env.example` *declares* `RESEND_API_KEY` and `EMAIL_FROM`, but they are not present in the live `.env` |
| 6 | **AgenticOS internal notifications / alerts table** | **DOES NOT EXIST** | 98 tables enumerated in `server/data/agentic-os.db`; the only notification-like table is `conversation_messages`. No `notifications`, `alerts`, `outbox` or `webhook` table |
| 7 | **AgenticOS notification endpoint** | **DOES NOT EXIST** | No `router.(get\|post)('/notif…'\|'/alert…')` in `server/src/routers/*.ts`. `health.ts` exposes `/`, `/restart`, `/system`, `/gateway`, `/behavioral`, `/incidents` — none deliver |
| 8 | **AgenticOS schedules table (in-app cron)** | **NOT A DELIVERY CHANNEL, and off-limits** | 4 rows in `schedules`; only fire while the app process is alive. `schedule-revenue-supervisor-tick` (`*/5 * * * *`) `last_triggered_at = 2026-09-19T18:05:00.070Z`. One row (`sched-cd341dac-…`, `0 9 * * *`, `enabled=1`, `last_triggered_at=null`) has never fired. **Not modified — forbidden** |
| 9 | **`scripts/notification_service.py`** (in-repo SMTP class) | **BROKEN — unusable** | Real `smtplib` code, but `_compose_message` returns `{"type": channel_type, …}` where `channel_type` is undefined (line 112) → `NameError`; module-level `send_notification` references undefined `config` (line 171); the recipients filter (lines 124-125) selects nothing sensible. Requires `smtp_server` config + a credential env var that do not exist |
| 10 | **`server/tasks/daily-finance-monitor.py`** | **BROKEN — SMTP fully commented out** | Lines 183-191 are all `#`-commented (`# import smtplib`, `# smtplib.SMTP(host='smtp.gmail.com'…)`). Its store `server/database.sqlite` is 0 bytes (prior audit) |
| 11 | **Local mail CLI** (`himalaya`, `sendmail`, `msmtp`, `mutt`, `mailx`) | **ALL ABSENT** | `command -v` for each: `(absent)`. Only `curl` (`/mingw64/bin/curl`) and `powershell` exist |
| 12 | **Stored credentials that could power a sink** | **NONE** | `system_secrets` → `row count: 0`; `provider_credentials` → `count: 0` |

### 3.2 Environment audit (keys and presence only — every value redacted)

```
$ env | grep -iE "FREECASH|SMTP_|WEBHOOK_|MAIL|SENDGRID|SLACK|TELEGRAM|TWILIO"   (first probe, ~09:38:30)
(nothing)

$ echo "FREECASH_DATA_ROOT=[${FREECASH_DATA_ROOT}]"     (second probe, ~09:40)
FREECASH_DATA_ROOT=[C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846]

$ env | grep -i freecash
FREECASH_DATA_ROOT=<throwaway temp dir>          [value shown for diagnosis only]
FREECASH_TZ=Europe/Berlin
FREECASH_TOAST_STUB=1
```

**These three variables are NOT system configuration.** They were injected into the agent's shell
by a **concurrent end-to-end test harness** part-way through this reconnaissance — the directory
name's timestamp `20260921-093846` matches the moment the variables appeared, and the harness
leaves its scratch root recorded:

```
$ cat "$LOCALAPPDATA/Temp/freecash-e2e-root.txt"
C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846

$ ls -ld --time-style=full-iso "$LOCALAPPDATA/Temp/freecash-e2e-rules-20260921-093846"
drwxr-xr-x 1 cd-pr 197609 0 2026-09-21 09:40:01.087453200 +0200 ...
```

Persistence check — nothing is configured at user or machine level:

```
$ reg query "HKCU\Environment"
HKEY_CURRENT_USER\Environment
    Path    REG_EXPAND_SZ    ...
    TEMP    REG_EXPAND_SZ    %USERPROFILE%\AppData\Local\Temp
    TMP     REG_EXPAND_SZ    %USERPROFILE%\AppData\Local\Temp
    OneDrive    REG_EXPAND_SZ    C:\Users\cd-pr\OneDrive
    OLLAMA_MODELS    REG_SZ    D:\OllamaModels
    ChocolateyLastPathUpdate    REG_SZ    134322445623894041
    OneDriveConsumer    REG_EXPAND_SZ    C:\Users\cd-pr\OneDrive

$ reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" | grep -iE "FREECASH|SMTP|WEBHOOK|MAIL"
(no FREECASH/SMTP/WEBHOOK/MAIL in HKLM env)
```

**This is operationally important, not just a curiosity:** the ambient `FREECASH_DATA_ROOT` pointed
at a throwaway directory and `FREECASH_TOAST_STUB=1` would have silently downgraded the delivery
channel to the `STUB_OK` test sender while still reporting success. A scheduled task must not
inherit its environment — which is exactly why the wrappers in this directory pin every
`FREECASH_*` value explicitly and clear `FREECASH_TOAST_STUB`.

### 3.3 The app **is** running — but that does not create a sink

```
$ curl -sS -m5 -o /dev/null -w "http=%{http_code}\n" http://localhost:4600/api/health
http=200

$ curl -sS -m5 http://localhost:4600/api/health
{"status":"healthy","uptime":447.4586199,"environment":"development","version":"9.0.0",
 "build":{"fingerprint":"13c7f90e…","algorithm":"content-sha256-v1","filesCount":552,
 "gitSha":"d14253df179dd8ceff1d1e4ee43ca9035cdb69ff","gitShort":"d14253df","isDirty":true,
 "buildTimestamp":"2026-09-21T07:31:18.412Z","buildId":"d14253df-dirty-20260921-073118"}}

$ netstat -ano | grep -E ":4600"
  TCP    0.0.0.0:4600     0.0.0.0:0     ABHÖREN     13900

$ powershell -c "Get-CimInstance Win32_Process -Filter 'ProcessId=13900' | Select-Object ProcessId,Name,ExecutablePath | Format-List"
ProcessId      : 13900
Name           : node.exe
ExecutablePath : C:\Program Files\nodejs\node.exe
```

Default port confirmed in source: `server/src/index.ts:123` →
`const PORT = process.env.PORT ? ... : (process.env.AGENTICOS_BACKEND_PORT ? ... : 4600);`
and the health route is `app.use('/api/health', healthRouter)` (`index.ts:260`), with
`GET /` → `{status, uptime, …}` (`health.ts:8`). Note `GET /health` (no `/api`) returns **404** —
the prior probe used both the wrong port and the wrong path.

The app being up does not help, because the application has no notification capability and
nothing reads the monitor's state root. The codebase says so explicitly
(`server/src/domains/jarvis/operationalEvidence.ts`):

> `// Notification subscriptions are not implemented in this system.`
> `reply: 'Automatic status notifications are not configured. Ask me for the current status.'`
> `missingEvidence: 'No notification subscription capability exists'`

This independently corroborates the prior audit's finding that "*NOTHING IN THE APPLICATION READS
THIS DIRECTORY* … R3 IS THEREFORE UNENFORCED END-TO-END" (`.hermes/plans/freecash-monitor/WIRING-PLAN.md` §3.1).

### 3.4 What `notify.py` actually does — transports and the no-sink case

**Transports actually implemented** (complete function inventory cross-checked against the module):

| Transport | Implemented? | Delivery label | Notes |
|---|---|---|---|
| `alerts/alerts.jsonl` append | **Yes** — `alert()` writes every record | n/a (log) | "append-only, always on — the canonical evidence record" |
| Windows toast | **Yes** — `_toast_send()` | `TOAST_OK` | the default sender |
| Stub (offline tests) | **Yes** — `_stub_send()` | `STUB_OK` | used iff `FREECASH_TOAST_STUB == "1"`; writes to `logs/toast-stub.log`; deliberately "never `TOAST_OK`, so a stubbed run can never be mistaken for a real delivery" |
| SMTP | **NO** | — | docstring-only (line 8); no `smtplib`, no network import anywhere in the module |

**What happens when no sink is configured / the sink fails.** There is no "none configured" state —
the routine *always* attempts the toast. A delivery failure is handled by `dispatch()`: at most
**2** attempts, then it writes `DELIVERY_FAILED` (carrying the **full original message**), marks
the dedupe key `FAILED_TOAST`, appends a `MONITOR_DEGRADED` line, and returns `FAILED`.

**Does the alert still reach `alerts.jsonl`? YES — and this is guaranteed by ordering, not luck.**
`notify_change()` writes the change line with `alert(...)` *before* it calls `dispatch(...)`. The
dedupe key is also written *before* dispatch, so a crash can lose one message but can never
duplicate one.

Proven empirically in a scratch data root with a sender that raises (`simulated: no interactive
desktop / toast unavailable`) — no real state touched, nothing delivered to a human:

```
notify_change returned: FAILED

--- alerts.jsonl contents ---
{"day_key": "2026-09-21", "dedupe_key": "proof:EARNINGS_CHANGED:earnings_total_cents:2026-09-21",
 "event_type": "EARNINGS_CHANGED", "message": "TEST MESSAGE: earnings changed", "observed": {...}}
{"day_key": "2026-09-21", "dedupe_key": "proof:...", "event_type": "DELIVERY_FAILED",
 "message": "TEST MESSAGE: earnings changed", "observed": {"attempts": 2, ...}}
{"day_key": "2026-09-21", "dedupe_key": "proof:...", "event_type": "MONITOR_DEGRADED",
 "message": "Notification channel failed twice; this message exists only in a..."}

--- notified-keys.json ---
{"schema_version": 1, "keys": {"proof:EARNINGS_CHANGED:earnings_total_cents:2026-09-21":
 {"first_notified_at_utc": "2026-09-21T07:40:29Z", "delivery": "FAILED_TOAST", ...}}}
```

So: **the change is always recorded as evidence; only the push can fail.** A failed push never
blocks a state write, never causes a second run and never touches the approval queue.

**Design-vs-implementation gap worth flagging.** The design document claims an escalation that does
not exist (`docs/free-cash-monitor-routine/ROUTINE-DESIGN.md:348`):

> "| Escalation | the toast channel failing twice switches the routine to SMTP-only for that day and records `MONITOR_DEGRADED` |"

There is no SMTP path to switch to (`ROUTINE-DESIGN.md:559` names
`scripts/notification_service.py` as the pattern — that script raises `NameError`, §3.1 row 9). The
`MONITOR_DEGRADED` half is real; the "switches to SMTP" half is not. On this host, a toast failure
means the alert exists **only** in `alerts.jsonl`.

---

## 4. Recommendation

### 4.1 The delivery channel that will actually notify the human

**One channel exists: the Windows toast, sent by `notify.py::_toast_send`.** It is the only
implemented transport besides the log, and its prerequisites are verified present on this host
(interactive session 1 active, `powershell.exe` present, WinForms/`NotifyIcon` loads).

**Honest statement of what happens if that sink is unavailable** — a headless run, a locked
session, Focus Assist / quiet hours, or a group-policy that disables balloon tips:

1. The routine attempts the toast **twice**.
2. It appends `DELIVERY_FAILED` to `alerts/alerts.jsonl` **containing the full original message**
   and marks the key `FAILED_TOAST`.
3. It appends `MONITOR_DEGRADED`: *"Notification channel failed twice; this message exists only in
   alerts.jsonl. Operator must read the log until the channel is fixed."*
4. **Nothing else happens** — no email, no SMS, no webhook, no app notification. Those do not
   exist. **The only way the human learns of the change is by opening
   `D:\AgenticOS\data\freecash-monitor\alerts\alerts.jsonl`.**

There is no fallback to configure, because there is no second sink. Closing that gap is a **new
decision with new work** — it is blocked, not solved, in §5.

### 4.2 The single first command a human must approve

Scheduling has an unresolved prerequisite (elevation, §2.1) and an unresolved blocker (§4.3). The
first thing to settle, safely and reversibly, is whether registration needs elevation at all. Run
this **from a normal, non-elevated shell**; it creates one throwaway task and deletes it
immediately, changing nothing permanent:

```cmd
schtasks /Create /TN "\ZZ-FreeCash-Elevation-Probe" /SC DAILY /MO 1 /ST 23:59 /TR "cmd.exe /c exit 0" /IT /RL LIMITED /F && schtasks /Delete /TN "\ZZ-FreeCash-Elevation-Probe" /F
```

- **Succeeds** → registration works non-elevated; use §2.5 Form A or C directly.
- **`FEHLER: Zugriff verweigert` / "Access is denied"** → re-run the identical registration command
  from a shell started with "Als Administrator ausführen". Elevation is needed **once, for
  registration only**; the task still runs non-elevated (`RunLevel=LeastPrivilege`).

Verify it left nothing behind: `schtasks /Query /TN "\ZZ-FreeCash-Elevation-Probe"` should again
print `FEHLER: Das System kann die angegebene Datei nicht finden.`

### 4.3 DO NOT schedule Task A yet — the day lock is taken before the read

This is the finding that should govern the decision. `run_daily_check.py` acquires the R1 day lock
**before** it resolves and reads the source:

```
run_daily_check.py:308    day = gate.day_key(now)
run_daily_check.py:309    acquired, lock = gate.acquire_day_lock(day)
...
run_daily_check.py:307    source_kind = resolve_source(args.source)
```

The live state root proves the consequence: on 2026-09-20 the day was **spent** on a no-data
result, and R1 forbids a second read that day.

```
$ cat data/freecash-monitor/state/day-locks/
2026-09-20.lock

$ cat data/freecash-monitor/alerts/alerts.jsonl        (line 1)
{"day_key": "2026-09-20", "event_type": "MONITOR_DEGRADED",
 "message": "No data for 2026-09-20 (no operator-entered record for 2026-09-20 in
 operator-state.json). Snapshot written with null fields; nothing is compared and nothing is
 notified until a reading exists.", ...}
```

And the source is still empty:

```
$ cat data/freecash-monitor/state/operator-state.json
  "records": [],
```

**Therefore:** registering Task A today would make it take the day lock at 09:00 every morning,
produce `MONITOR_DEGRADED` every day, and — because R1 refuses a second status read on a consumed
day and `--force-recheck` is "refused by design" — make it *impossible* to record a real reading on
any of those days. An unattended schedule started before the read source exists does not degrade
gracefully; **it burns every day permanently.** This is the same ordering trap the prior audit
flagged as "the single most consequential ordering trap in this routine"
(`DELEGATION-2026-09-20/DELIVERY-PLAN-OPTIONS.md` §3.4-B3).

**Correct order of operations:**

1. Decide the read source — the blocked item **B1** (`operator-state.json.records` is `[]`; the
   automated alternative needs the operator to authenticate in a managed browser profile first).
2. Enter the day's reading (four figures, integer cents, `day_key` = today) **before** any run.
3. Then, and only then, run the elevation probe (§4.2) and register Task A and Task B.

Task B (the watchdog) is *data*-safe to register at any time — it cannot take a lock or spend a
day — but until Task A is live it would correctly and noisily emit `MISSED_DAY` every evening for a
check that was never scheduled. Register the pair together.

### 4.4 Answer summary

| Question | Answer |
|---|---|
| Is the routine scheduled today? | **No.** 275 tasks enumerated; neither `\FreeCash-Daily-Monitor` nor `\FreeCash-Daily-Monitor-Missed-Day-Watchdog` exists |
| Can it be scheduled once per day on this host? | **Yes** — Windows Task Scheduler, per-user, daily `CalendarTrigger`. Registration likely needs a **one-time UAC elevation** (MS docs: "Only Administrators can schedule tasks"); the task itself runs non-elevated |
| Exact `FREECASH_DATA_ROOT` | `D:\AgenticOS\data\freecash-monitor` (real root; `alerts.jsonl` and `last-run.json` confirmed present) |
| Exact interpreter | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (3.11.9, `tzdata` present, `Europe/Berlin` resolves) |
| Exact delivery channel | **Windows toast via `notify.py::_toast_send`** — the only implemented transport |
| What if that sink is unavailable? | Alert exists **only** in `data/freecash-monitor/alerts/alerts.jsonl`, marked `DELIVERY_FAILED` + `MONITOR_DEGRADED`. **No email, SMS, webhook or app notification exists or can be configured today** |

---

## 5. Explicit blocked items

| ID | Blocked item | Why it is blocked | What unblocks it |
|---|---|---|---|
| **B1** | **The read source** — blocks the first real reading, and therefore blocks registering Task A at all | `operator-state.json.records` is `[]`; every run against it yields `MONITOR_DEGRADED`. The automated alternative requires the operator to authenticate in a managed browser profile. **And by §4.3 the lock is taken before the read, so registering Task A now would permanently burn each day** | A human decision: operator-entered figures (zero credentials, zero platform contact) vs. an automated source |
| **B2** | **A delivery channel that survives a failed toast** | No second sink exists: no SMTP in `notify.py`, no mail credentials anywhere (`system_secrets` = 0 rows, `provider_credentials` = 0 rows), no mail CLI installed, no notifications table, no notification endpoint. The documented "switch to SMTP-only" escalation is **not implemented** | Either accept the toast + "read `alerts.jsonl`" as the operating procedure, or scope new work (wire the toast failure to a real sink). A credential must be supplied by a human — **no agent may invent, guess or type one** |
| **B3** | **Registration approval (R4)** | This delegation is reconnaissance only; no task was created, and a human has not approved anything | Human runs §4.2, then §2.5 Form A or C — **only after B1 is resolved** |
| **B4** | **Elevation requirement not empirically proven** | The throwaway-task test was **not performed** — the hard constraint forbade creating any scheduled task, and I chose not to exercise the narrower permission. Confidence rests on Microsoft documentation plus token inspection: `S-1-16-8192` (Medium) / `net session` exit 2 → the current token is not elevated, while `cd-pr` *is* in `S-1-5-32-544` (deny-only filtered), so UAC elevation is available | Running §4.2 |
| **B5** | **XML schema acceptance not proven** | Both XML files parse and their element order matches a task this build exported itself, but Task Scheduler's own schema validation can only be exercised by registering | First registration attempt; use §2.5 Form C if Form A is rejected on ordering |
| **B6** | **`AgenticOS` in-app scheduling is not an alternative** | The `schedules` table only fires while the app process is alive, and this delegation is forbidden from modifying app schedules. One live row (`sched-cd341dac-…`, `0 9 * * *`, `enabled=1`) has `last_triggered_at=null`, i.e. never fired | Not pursued, by constraint |
| **B7** | **FREECASH_* environment contamination** | A concurrent e2e harness injected `FREECASH_DATA_ROOT=<temp>` and `FREECASH_TOAST_STUB=1` into the agent shell mid-reconnaissance. Neither is persistent (HKCU/HKLM confirmed clean), but any process inheriting that shell would have written state to a throwaway directory and used the `STUB_OK` sender | Already mitigated: both wrappers in this directory pin every value and clear the stub. **This is a reason the wrapper pattern is mandatory, not optional** |

---

## 6. Method, limits, and what was not done

**Read-only guarantee.** No existing file was edited, moved, renamed or deleted. No
`git add/commit/stash/reset/restore/checkout` was run. No voice or Jarvis runtime path was touched.
No scheduled task, cron entry, service or app schedule was created, enabled, deleted or modified.
No notification or email was sent. No secret was printed — environment and `.env` values were
reduced to key names plus present/absent, at the point of read. No app process was started or
stopped; the app's running state was only observed.

**State isolation.** Every execution of the routine touched a scratch data root under
`$LOCALAPPDATA/Temp/fc-recon/`, never `data/freecash-monitor`. The one read of the real root was
`--print-state`, whose code path (`run_daily_check.py:299-305`) takes no lock and writes nothing.
`data/freecash-monitor/state/day-locks/` still contains **only** `2026-09-20.lock` — today's
(2026-09-21) day lock has **not** been consumed, so the day is still available for a real reading.

**Files created by this delegation** (all new, all inside
`docs/free-cash-monitor-routine/DELEGATION-2026-09-21/`):

| File | Nature |
|---|---|
| `SCHEDULER-AND-DELIVERY.md` | this report |
| `FreeCash-Daily-Monitor.xml` | **inert** Task A definition; registers nothing |
| `FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml` | **inert** Task B definition; registers nothing |
| `freecash-task-a.cmd` | Task A action wrapper; **not executed** |
| `freecash-task-b-watchdog.cmd` | Task B action wrapper; **not executed** |

Both `.cmd` wrappers hard-code the interpreter path and the delegation directory. If the human
prefers them not to live under `docs/`, relocate them and update the `<Arguments>` path in each
XML.

**Known limits of this report.**

- Web-search and several Microsoft Learn pages returned `403` part-way through; all citations above
  came back successfully before that and are quoted verbatim. Three schema-element pages
  (`taskschedulerschema-*`) could not be retrieved — mitigated by exporting real task XML from this
  host instead of citing the schema pages.
- End-to-end toast delivery is **unverified by design**: proving it requires sending a
  notification, which this delegation forbids. Prerequisites were verified; the delivery itself is
  not.
- The elevation requirement is documented-only (B4).
- `server/src/adapters/freecashMonitorAdapter.ts` was read and is a **sandbox stub**: `fetchStatus()`
  returns `statusAlerts: []` and `externalConnected: false` unconditionally, so it can never carry a
  real alert. It is not a delivery candidate and is listed here only to close that line of enquiry.

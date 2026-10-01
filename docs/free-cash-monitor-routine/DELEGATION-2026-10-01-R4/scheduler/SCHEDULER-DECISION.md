# SCHEDULER-DECISION.md — stream S5 `scheduler`

Free Cash daily status monitor · delegation **DELEGATION-2026-10-01-R4** · 2026-10-01 (Europe/Berlin, UTC+02:00)
Repo `D:\AgenticOS` · stream dir `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/scheduler/`

## STATUS: REGISTRATION WITHHELD — NOTHING WAS REGISTERED

**Nothing is scheduled, and nothing was made scheduled by this stream.** The task
does not exist before this pass and does not exist after it. Registration is an
external, state-changing action, and rule **R4 APPROVAL BEFORE EXTERNAL ACTION**
requires the operator's explicit consent first. This stream therefore stops at a
reviewed decision document plus an XML file that parses and is proven
observe-only. Section 6 holds the command the *operator* may run; it was not run
here, and it must not be run by an agent.

---

## 0. Rule numbering — every rule is printed with its TITLE

The operator numbering is authoritative in this delegation:

| # | Rule title | Meaning |
|---|---|---|
| R1 | **NO EARNING ACTION** | the routine never performs an earning / withdraw / claim transaction |
| R2 | **ONCE PER DAY** | exactly one status read per calendar day, operator-local |
| R3 | **NOTIFY ON CHANGE** | tell the operator when earnings or account status changes |
| R4 | **APPROVAL BEFORE EXTERNAL ACTION** | nothing external is executed without explicit human approval |

**The shipped code inverts R1 and R2 in its own docstrings.** Re-verified this pass
by reading the files, not by trusting any inherited note:

- `monitoring/freecash/gate.py:1` → `"""gate.py -- R1: exactly one status read per operator-local calendar day."""`  … that is operator **R2 ONCE PER DAY**.
- `monitoring/freecash/readonly_client.py:1` → `"""readonly_client.py -- R2: the routine's ONLY network path."""` … that is operator **R1 NO EARNING ACTION**.

R3 and R4 agree between code and brief. Raw: `raw/12-rulenumbering-and-paths.txt`.
Because of this, no bare `R1`/`R2` appears anywhere in this document or in the XML
without its title attached.

---

## 1. Live confirmation that nothing is scheduled

Re-run this pass; every inherited `scheduled` / `registered` claim was treated as
unverified until re-measured. Raw: `raw/02-schtasks-query.txt`,
`raw/03-schtasks-detail.txt`, `raw/20-nothing-registered.txt`.

```
$ schtasks /query /tn 'FreeCash-Daily-Monitor' /fo LIST
FEHLER: Das System kann die angegebene Datei nicht finden.
exit=1                       <- the task does not exist

$ schtasks /query /fo LIST | grep -i freecash
                             <- zero matches, grep exit=1
```

Full `schtasks /query /fo LIST` (1820 lines saved in `raw/02`). The only task
names matching the word **monitor** are Microsoft's own:

```
\Microsoft\Office\Office ClickToRun Service Monitor
\Microsoft\Office\Office Performance Monitor
\Microsoft\Windows\Hotpatch\Monitoring          (x3)
\Microsoft\Windows\Shell\FamilySafetyMonitor
\Microsoft\Windows\TextServicesFramework\MsCtfMonitor
```

Two `AgenticOS`-named tasks exist and are **not** this monitor — both launch the
desktop app `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe`, both
are `Einmal` (one-shot) triggers last run 29.09.2026, `\AgenticOS_Desktop`
(last result 0) and `\AgenticOS_Launch` (last result −1). Raw: `raw/03`.

The repo's only schedule-shaped file is inert, and it is worse than inert — it
points at the file with a wired withdraw path:

- `config/freecash-crontab` line **7**: `0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py >> /path/to/AgenticOS/logs/freecashioc_$(date +\%Y-\%m-\%d).log 2>&1`
  — a literal `/path/to/AgenticOS`, and no cron daemon exists on this host.
  Note the line is **7**, not the `:8` cited in several earlier documents in this
  corpus; and its interpreter is `python3`, exactly the interpreter class that
  lacks tzdata (§4). Raw: `raw/04-crontab-template.txt`.

---

## 2. Route decision

| Route | Verdict | Why |
|---|---|---|
| **Windows Task Scheduler** | **CHOSEN** | Native, per-user, deterministic, no LLM anywhere in the boundary, survives the Hermes gateway being closed, and the registration artifact is a single readable file the operator can review before consenting (R4). |
| **Hermes cron** | **REJECTED as the primary route** for the daily read (viable later for *delivery* only) | See §3 — inspected live, not assumed. |
| **Nothing / retire the routine** | **REJECTED** | The whole finding of this delegation is the missing registration. Refusing to schedule is a defensible *interim* state (and is the current state) but it is not a decision that gets R2/R3 coverage. |

**Decision: the daily observe-only read goes to Windows Task Scheduler, and the
file in this stream is its definition. Registration is withheld (§6).**

The deciding property is not convenience, it is where the failure lands. The
routine is deterministic file I/O with no model in the loop. Putting an
LLM-capable scheduler between the trigger and the day-lock means the actor that
enforces **R2 ONCE PER DAY** is the same actor that can be re-prompted; keeping
the trigger native means the only code that can run is
`run_daily_check.py` itself, which is what §5 asserts mechanically.

---

## 3. Hermes cron: what actually exists (inspected, not assumed)

Hermes cron is **live** on this host, so it was a real candidate and had to be
inspected rather than dismissed. Raw: `raw/05`, `raw/06`, `raw/07`.

```
$ hermes cron status
✓ Gateway is running — cron jobs will fire automatically
  PID: 392
  Ticker heartbeat: 52s ago
  No active jobs

$ hermes cron list
No scheduled jobs.

$ ls -la ~/AppData/Local/hermes/cron
.tick.lock          Okt  1 11:40      <- ticker ran ~1 min before this check
ticker_heartbeat    Okt  1 11:40
ticker_last_success Okt  1 11:40
executions.db       Sep 17 19:44
```

So the scheduler is alive with **zero jobs**. Why it is still not the primary
route:

1. **`--no-agent --script` requires the script to live under `~/.hermes/scripts/`.**
   The canonical entry point is `D:\AgenticOS\monitoring\freecash\run_daily_check.py`
   and `monitoring/` is **untracked in git**, so a copy or shim under
   `~/.hermes/scripts/` is a second, drifting definition of the same routine with
   no diff to review. It also duplicates the thing R2's day-lock exists to keep
   single.
2. **It couples R2 ONCE PER DAY to the gateway's liveness.** The status line is
   explicit that jobs fire *because* the gateway is running. If the gateway is
   down, the day silently passes with no reading — and the natural detector for a
   missed reading would be a job on the same gateway that just failed to fire.
3. **An LLM in the boundary for a job that must never reason.** Without
   `--no-agent`, the payload is a prompt, and the enforcement actor for
   NO EARNING ACTION becomes a model. With `--no-agent` you get a deterministic
   script — but then see (1).
4. **Creating a cron job is itself registration.** `hermes cron create` writes
   durable job state under `~/AppData/Local/hermes/cron` — an external,
   state-changing action, so R4 APPROVAL BEFORE EXTERNAL ACTION applies to it
   identically. It was therefore not run, and this stream cannot report what its
   output would look like.

Hermes cron remains the **better route for R3 delivery** once the read exists —
its stdout is delivered to the operator's chat, which is exactly what a change
notification needs. That is a phase-2 decision and it is **not** made here.

---

## 4. Interpreter pin — re-verified, and this is the silent failure

The task pins the executable to:

```
C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
```

Measured this pass (`raw/09-entrypoint-interpreter.txt`):

```
$ <venv python> -c "import sys, zoneinfo; print(sys.version.split()[0]); print(zoneinfo.ZoneInfo('Europe/Berlin'))"
3.11.9
Europe/Berlin                                   <- OK

$ py -3.11 -c "import zoneinfo; zoneinfo.ZoneInfo('Europe/Berlin')"
zoneinfo._common.ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'

$ py -3.14 -c "import zoneinfo; zoneinfo.ZoneInfo('Europe/Berlin')"
zoneinfo._common.ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'
```

This failure is **silent**, which is why the pin is a hard requirement and not a
style preference. `gate.resolve_tz()` fails *open* to the machine zone and reports
kind `"system-local"` with `timezone_report()["available"] == False`. A task
pointed at `py` or `python3` would not crash — it would keep writing locks and
snapshots while quietly computing the **wrong operator-local day key**, i.e. it
would break **R2 ONCE PER DAY** without ever raising. Never change this path to
`python3`, `py` or `pythonw`.

`monitoring/freecash/run_daily_check.py` also passes `py_compile` under that
interpreter (exit 0) — `raw/09`. (The XML is not Python; this is the artifact the
task will actually invoke, so it is compiled, not just read.)

---

## 5. The artifact

| | |
|---|---|
| File | `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/scheduler/FreeCash-Daily-Monitor-R4.xml` |
| sha256 | `e8471630aab0f8f3ed091169eb958d19b0de09172f375b42d027121d12dbe319` |
| Size | 117 lines |
| Task name it would claim | `\FreeCash-Daily-Monitor` (still unregistered) |
| Action | `cmd.exe /c <pinned venv python> D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1>> <log> 2>&1` |
| Trigger | one `CalendarTrigger`, `ScheduleByDay` / `DaysInterval=1`, `StartBoundary 2026-10-05T09:00:00` (Monday) |
| Principal | `S-1-5-21-3435097649-250514390-3575566063-1001`, `InteractiveToken`, `LeastPrivilege` |
| Settings | `IgnoreNew`, `StartWhenAvailable=true`, `ExecutionTimeLimit=PT10M`, **no** `RestartOnFailure` |

### 5.1 It parses — and the parse was re-run in the same call that handed the payload over

`raw/18-xml-parse-proof.txt` contains the artifact verbatim, its sha256, and the
parse proof **in one call**:

```
$ <venv python> -c "import xml.etree.ElementTree as ET; ET.parse('D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/scheduler/FreeCash-Daily-Monitor-R4.xml')"
ET.parse exit=0          (0 and no output = well-formed)

XML PARSE OK: well-formed
```

The ampersand trap was hit for real, twice, and both are now closed by evidence
rather than by hope:

- **A raw `&` inside `<Arguments>` breaks this exact step.** The redirect on disk
  is escaped, quoted from the file byte-for-byte (line 113):

  ```
  <Arguments>/c C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1&gt;&gt; D:\AgenticOS\data\freecash-monitor\logs\task-a.log 2&gt;&amp;1</Arguments>
  ```

  i.e. `2>&1` is written `2&gt;&amp;1`. A whole-file check confirms **no raw
  ampersand survives outside entities** (`raw/18`).
- **A second, subtler trap was found by this stream's own gate in its own first
  draft:** a `--` inside an XML **comment** is illegal, and expat reports it only
  as `not well-formed (invalid token)`. The draft said `` --source operator_state ``
  inside the header comment, and `ET.parse` rejected the file. The wording was
  changed and the gate now names this trap explicitly instead of leaking the
  parser's message (`raw/17`, `mv11`).

### 5.2 The task is observe-only, and a gate proves it

`xml_gate.py` (sha256 `35fb53c96c446d0cb6ad7f7a123ddb5a714c5d09e0eb555553de236877995a8f`)
asserts, by rule title: exactly one `<Exec>` and no other action; `<Command>` is
`cmd.exe`; `<Arguments>` names the pinned venv interpreter and the **single**
canonical script `D:\AgenticOS\monitoring\freecash\run_daily_check.py`; no shell
chaining beyond the one `2>&1` redirect; no earning/write verb anywhere in the
document **or in the raw bytes including comments**; one daily calendar trigger;
`IgnoreNew`; `StartWhenAvailable`; never `HighestAvailable`; and a `StartBoundary`
that is not in the past.

**Acceptance bar — failing-something proof, both lines in one file** (`raw/17-redgreen.txt`,
regenerated after the final edit):

```
RED   : 12 planted mutants, gate exits 1 on all 12      <- xml_gate.py, --today 2026-10-01
GREEN : verifier exits 0 on the unmodified artifact     <- VERDICT: OBSERVE-ONLY (gate exit 0)
mutants planted 12 · caught 12 · survived 0 · plant failures 0
HARNESS VERDICT : ALL MUTANTS CAUGHT, ARTIFACT CLEAN
```

The mutants are not cosmetic; each one is a specific way this schedule could stop
being a read:

| Mutant | Planted violation | Rule title named by the gate |
|---|---|---|
| mv01 | raw `&` in `<Arguments>` | R4 APPROVAL BEFORE EXTERNAL ACTION *(well-formedness)* |
| mv02 | `Python314\python.exe` instead of the venv | R2 ONCE PER DAY |
| mv03 | a second `<Exec>` running `--force-recheck` | R2 ONCE PER DAY / R1 NO EARNING ACTION |
| mv04 | `&& echo done` appended | R2 ONCE PER DAY |
| mv05 | `StartBoundary` moved to the past | R2 ONCE PER DAY |
| mv06 | `MultipleInstancesPolicy=Parallel` | R2 ONCE PER DAY |
| mv07 | `StartWhenAvailable=false` | R2 ONCE PER DAY |
| mv08 | `RunLevel=HighestAvailable` | R1 NO EARNING ACTION |
| mv09 | `DaysInterval=2` | R2 ONCE PER DAY |
| mv10 | `--withdraw` appended | R1 NO EARNING ACTION |
| mv11 | `--` inside an XML comment | R4 APPROVAL BEFORE EXTERNAL ACTION |
| mv12 | a *verb-free* second `<Exec>` | R2 ONCE PER DAY (*found 2 `<Exec>` actions*) |

`mv03` was caught early by the verb check, so it alone does **not** prove the
"exactly one `<Exec>`" detector — `mv12` exists solely to isolate that detector,
and it is caught by it (`raw/19`). No mutant survives, so no OPEN DEFECT is
carried in this file. The gate's own RED/GREEN is in `raw/19-shape-and-redgreen.txt`.

### 5.3 The action string was executed end-to-end through `cmd.exe`

The `<Arguments>` shape was not assumed. A **copy** of the package (`isolation
clause 1`: copy first, never exercise in place) was run by `cmd.exe /c` with the
same unquoted action form the XML ships, against throwaway roots
(`raw/14-isolated-runs.txt`, `raw/15-throwaway-tree.txt`):

```
run 1: EXITCODE=0
  RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)
         snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0
         reminders=0 lock=2026-10-01.lock

run 2 (same day): EXITCODE=0
  SKIP_DUPLICATE_DAY 2026-10-01
```

Two things this buys, beyond the string parsing:

- **A double trigger cannot produce a double read.** Same day, second run: no
  read, no snapshot, exit 0. `gate.acquire_day_lock` (`O_CREAT|O_EXCL`) is the
  reason, and `IgnoreNew` means the scheduler will not stack a slow run anyway.
  This is the belt-and-braces part of **R2 ONCE PER DAY**.
- **No wrapper is needed, and a wrapper would be wrong.** `schtasks` cannot set
  environment variables; the routine's production values *are* its code defaults
  (`paths.py:35 DEFAULT_DATA_ROOT = D:/AgenticOS/data/freecash-monitor`,
  `run_daily_check.py:52 DEFAULT_SOURCE = "operator_state"`). A `.cmd` wrapper
  exists in this stream's `raw/exec/` but for **isolation only**: it exports a
  throwaway `FREECASH_DATA_ROOT`, which is precisely the opposite of production
  behaviour, so it must not be part of the shipped definition. The cost of having
  no wrapper is that stdout must be redirected from the `Arguments` string.

### 5.4 `schtasks /XML` shape validation

Non-registering validation that was actually possible:

- `ET.parse` — well-formed (§5.1).
- **Structural agreement with a live task on this host.**
  `raw/host-task-reference-utf8.xml` is a live export of `\Hermes_Gateway`
  (`schtasks /query /tn '\Hermes_Gateway' /xml`). Both files agree on
  `version="1.4"`, on the namespace
  `http://schemas.microsoft.com/windows/2004/02/mit/task`, and on the top-level
  element order `RegistrationInfo, Principals, Settings, Triggers, Actions`
  (`raw/19`).
- The `UserId` was not invented: it is copied from that live task's `<Principals>`.
- The non-space paths make the **unquoted** `cmd.exe` action form safe, and that
  form is the one that was executed successfully in §5.3.

**What could NOT be validated, stated plainly:** `schtasks` is the only thing that
can fully accept a task definition, and its only read path is registration
(`schtasks /create /xml`). There is no dry-run flag. Because R4 APPROVAL BEFORE
EXTERNAL ACTION forbids registering, **this XML has never been seen by
`schtasks`**. Shape agreement plus a successful end-to-end `cmd.exe` execution is
the strongest non-registering evidence available, and it is weaker than an
actual `schtasks /create` acceptance. Do not upgrade this to "schtasks-validated".

---

## 6. Registration — withheld, and the preconditions that must hold first

**Withheld.** Rule **R4 APPROVAL BEFORE EXTERNAL ACTION** requires the operator's
explicit consent, and `schtasks /create` is an external, state-changing action.
This stream does not register, and an agent must not run the command below.

If and when the operator approves, the command is:

```
schtasks /create /tn "FreeCash-Daily-Monitor" \
  /xml "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R4\scheduler\FreeCash-Daily-Monitor-R4.xml" /f
```

Assent is **not** sufficient. Two hard preconditions must hold first:

- **P1 — the source record must not be empty.** `data/freecash-monitor/state/operator-state.json`
  is `records: []` and has never been filled in. Registering against an empty
  source buys one `MONITOR_DEGRADED` run per day and **zero readings** — day 1
  becomes a burnt day (§7), exactly reproducing 2026-09-30. The operator should
  populate today's record (or accept S1's pre-flight wrapper) *before* the task
  can first fire.
- **P2 — the `StartBoundary` must still be in the future at registration time.**
  It is `2026-10-05T09:00:00`. If the operator registers after that moment, the
  boundary is in the past and `StartWhenAvailable=true` fires **one catch-up run
  immediately**, which consumes a day while reading nothing. Move the boundary
  forward in the XML first. `xml_gate.py` fails on this condition and will say so.

Deliberately absent: any `RestartOnFailure` element. `run_daily_check.py`'s exit
table gives `5` for "the status read failed; the day lock stays in place, no
automatic re-run", and a retry within the same day can only print
`SKIP_DUPLICATE_DAY`, so a retry loop adds noise and no coverage.

---

## 7. Blast radius if the task mis-fires

Scope of what a misfire can do, bounded by §5.2: the only executable is
`run_daily_check.py`, with one flag, one script, one daily trigger.

**The day-budget burn is the real damage, and it is permanent for that day.**
`run_daily_check.py` resolves the day key and acquires the lock at **`:309`**
*before* it reads the source at **`:372`** — re-verified this pass by line
(`raw/10`). The lock is `O_CREAT|O_EXCL` on `state/day-locks/<YYYY-MM-DD>.lock`
and nothing in the routine ever clears it. So **any run on a day whose source
record is absent spends that day's one reading on nothing**: the lock exists, the
run books `MONITOR_DEGRADED`, and no later run that day can read — it can only
`SKIP_DUPLICATE_DAY`. The only remedy is a human deleting the lock, which
falsifies the day record; append a corrective note instead. This is not
hypothetical: §5.3 reproduced it on a throwaway root, and 2026-10-01's lock is
already spent in production (the four expected baseline files are listed in §9).

Specific misfire paths and their ceilings:

| Misfire | Consequence | Ceiling |
|---|---|---|
| Fires on a day with no source record | burns that day's single reading; `MONITOR_DEGRADED`; null-valued snapshot written | one day per occurrence; no data corruption, no provider contact |
| Trigger fires while a run is still going | nothing | `IgnoreNew`; and the day lock makes a second read impossible anyway |
| Trigger double-fires the same day | `SKIP_DUPLICATE_DAY`, exit 0, no read, no snapshot | proven in `raw/14` run 2 |
| Machine asleep at 09:00, wakes later *the same day* | one catch-up run, correct day key | `StartWhenAvailable=true` is the intent |
| Machine asleep at 09:00, wakes **after midnight** | the catch-up run books **the new day's** lock — a late alarm consumes the *following* day's budget | **OPEN ITEM** — inherent to `StartWhenAvailable`; no schedule-level fix exists |
| Interpreter path disappears (venv rebuilt/moved) | task fails, no delivery, day quietly unread | **OPEN ITEM** — no external watchdog is registered; the in-band `MISSED_DAY` detector only sees it at the next run |
| Change detected | one Windows toast via `powershell`, ≤2 attempts, dedupe key written *before* dispatch | local-only; `notifications=0` in every run so far, because `records: []` |
| Log growth | `1>>` appends to `data/freecash-monitor/logs/task-a.log` with no rotation | **OPEN ITEM** — unbounded; the task's only non-routine write path |
| Approval handling | `<Exec>` has no approval flag; the routine only *enqueues* items | `execution_state=NOT_EXECUTED`, `expires_at_utc=None` — an approval cannot arm anything |
| Elevation | none | `LeastPrivilege`; `HighestAvailable` is rejected by the gate (mv08) |
| Credentials | none held, none in the file | read-only transport is loopback-allowlisted |

Worst realistic case: a **silent, repeated, one-day-at-a-time loss of coverage**
that announces itself only as `MONITOR_DEGRADED` rows in `alerts/alerts.jsonl` —
never as an error, and never for **R3 NOTIFY ON CHANGE**, because there has never
been a reading to compare.

---

## 8. Answering the inherited lie

`DELEGATION-2026-10-01/scheduler/DECISION-V2-FreeCash-Daily-Monitor.xml` exists
and parses (re-confirmed, `raw/08`), but **it was never registered**, and this pass
confirms no FreeCash task exists. An unregistered XML file is a proposal, not a
schedule; several plans in the V1–V11B corpus describe it as though the job were
live. It is not. Nothing in this stream supersedes that file in the registry —
there is no registry entry to supersede.

---

## 9. Isolation evidence

Contract clause 3, recorded in order into `raw/`:
`01-isolation-before.txt` → runs → `99-isolation-after.txt`.

```
$ sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl

BEFORE 11:40:31   a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  last-run.json
                  1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts.jsonl

AFTER  11:52:50   a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  last-run.json
                  1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts.jsonl
```

**Byte-identical, and identical to the baseline digests named in the brief.** The
production root still holds exactly **12 files**. `find data/freecash-monitor -type f
-newermt "2026-10-01 00:00"` returns **4** lines, all pre-existing 06:53Z baseline
files — accounted for one by one:

| Line | Accounting |
|---|---|
| `alerts/alerts.jsonl` | baseline; hash unchanged before/after |
| `snapshots/2026-10-01.json` | baseline; 2026-10-01's lock was already spent at 08:53 local, before this stream ran |
| `state/day-locks/2026-10-01.lock` | baseline; the pre-existing lock named in brief §1.4 |
| `state/last-run.json` | baseline; hash unchanged before/after |

`config/` and `monitoring/` are untouched (mtimes unchanged: `freecash-crontab`
still `Sep 11 10:12`; the package's newest `.py` mtime is `Sep 20 06:59`). All
execution output landed in throwaway roots under this stream's own directory
(`raw/exec/throwaway-root/**`). Every execution pinned `FREECASH_DATA_ROOT`,
`AGENT_TEAMS_DB_PATH` and `AGENTICOS_DATA_DIR` to throwaway paths, and the routine
was **copied** before being exercised. **Nothing was written, moved, deleted,
chmod-ed or touched under `monitoring/**`, `data/freecash-monitor/**` or
`config/**`.**

---

## 10. What this stream could NOT establish

1. **That `schtasks` accepts this XML.** Its only read path is registration,
   which R4 forbids here (§5.4). Shape agreement with a live task and a working
   end-to-end `cmd.exe` execution are not the same as acceptance.
2. **That a registered run would produce a real figure.** The source is
   `operator_state`, which is `records: []`, and `readonly_client.py` allowlists
   **loopback only** — so the routine cannot reach any provider even in principle.
   A registered task today buys degraded days, not readings.
3. **That the R3 toast renders.** Every isolated run reported
   `notifications=0` (nothing changed, because nothing was read), so the
   `powershell` toast path was never exercised. Unproven on this host by this
   stream.
4. **That Hermes cron would deliver anything for this job.** No job was created
   (§3), because creating one is itself an external action under R4.
5. **That the approval path can act.** Out of scope for S5; `approval_queue.py`'s
   frozen fields (`execution_state=NOT_EXECUTED`, `expires_at_utc=None`) are
   cited from the brief, not re-measured here.
6. **Whether registration is wanted yet.** §6 P1/P2 say it should not be
   registered until the source is non-empty and the boundary is still future.
   That is the operator's call, not this stream's.
7. **Any change to the production root.** By design: 12 files, two digests,
   identical before and after.

---

## 11. Stream deliverables

| Artifact | Path |
|---|---|
| This decision | `scheduler/SCHEDULER-DECISION.md` |
| Task XML (unregistered, parses) | `scheduler/FreeCash-Daily-Monitor-R4.xml` — sha256 `e8471630aab0f8f3ed091169eb958d19b0de09172f375b42d027121d12dbe319` |
| Observe-only gate | `scheduler/xml_gate.py` — sha256 `35fb53c96c446d0cb6ad7f7a123ddb5a714c5d09e0eb555553de236877995a8f` |
| Gate RED/GREEN harness | `scheduler/run_xml_gate_redgreen.py` — sha256 `2f591b7bfcb2e78751e0d580da3001dd7f8b29fedd5a0af785a3654cf8d78054` |
| Raw evidence | `scheduler/raw/01…20`, `raw/99`, plus `raw/exec/`, `raw/mutants/`, `raw/host-task-reference-utf8.xml` |

**Registration status: WITHHELD. Nothing registered. `schtasks` still shows no
FreeCash task and `hermes cron list` still shows no jobs.**

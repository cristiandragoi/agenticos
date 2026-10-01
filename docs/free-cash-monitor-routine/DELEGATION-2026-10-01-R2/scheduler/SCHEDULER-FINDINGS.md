# SCHEDULER-FINDINGS.md — DESIGN TRACK 2

**Scheduling, the day lock, and the once-per-day invariant (R1)**

| | |
|---|---|
| Repository | `D:\AgenticOS` (git-bash / MSYS, Windows 11, non-elevated) |
| HEAD at time of run | `8f7463a` |
| Delegation | `DELEGATION-2026-10-01-R2` |
| Written | 2026-10-01, 09:0x–09:2x Europe/Berlin |
| Subject | `monitoring/freecash/` (entry `run_daily_check.py`), state root `data/freecash-monitor` (override `FREECASH_DATA_ROOT`) |
| Interpreter of record | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` — Python 3.11.9, **has** `tzdata` |
| Files changed in the repo | **none** (all writes are new files under this `DELEGATION-2026-10-01-R2` folder) |
| Production state | **untouched** — hash pair identical before/after (§8) |

---

## 0. Verdict in one table

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| R1 | At most one status read per Europe/Berlin calendar day is enforced by an atomic lock | **PASS — proven by execution.** 5 simultaneous processes × 10 rounds = 50 launches, exactly 1 winner per round, **0 red rounds** | `evidence-06` |
| R1a | A duplicate run performs **no read**, writes no snapshot, writes no ledger | **PASS** | `evidence-05` |
| R1b | The day is claimed **before** anything is read | **CONFIRMED — yes.** Lock at `run_daily_check.py:309`, read at `:372` | `evidence-03` |
| R1c | A **data-less run permanently consumes the day** | **YES — and it is also scored as a success.** Real production instance: 2026-10-01 | `evidence-03`, §1.4 |
| R1d | Day key is calendar-day correct across both DST transitions | **PASS** | `evidence-07`, §3(b) |
| R1e | A wrong interpreter can silently move the day boundary | **CONFIRMED — it does, without raising** | `evidence-04`, `evidence-09` |
| F2 | The watchdog reports a data-less day as `covered` | **DEFECT — reported, not changed** | `evidence-08` |
| F3 | `gate.clock_moved_backwards()` is dead code; the ledger can move backwards | **DEFECT — reported, not changed** | `evidence-08`, `evidence-03` |
| R2 | The scheduled artifact performs no earning action | PASS for the staged wrapper (read-only, one `--source operator_state` read). The **repo crontab route is an R2 hazard** | `evidence-10` |

**Bottom line:** R1 is genuinely enforced — the lock is a single atomic `O_CREAT|O_EXCL` syscall and 50 racing processes produced exactly one read every time. What is *not* sound is the **cost model and the alarm** around it: the day is claimed before a source is resolved, `MONITOR_DEGRADED` is counted as success, and a backwards clock is detected by a function nothing calls. All three are documented below with reproductions; none required a code change to establish and none was made.

---

## 1. The code: day key, atomic lock, ordering

### 1.1 The day key — `monitoring/freecash/gate.py:96–102`

```python
 96  def day_key(now=None, tz=None) -> str:
 97      """Operator-local calendar day for *now* (default: the current instant)."""
 98      if now is None:
 99          now = datetime.now(timezone.utc)
100      elif now.tzinfo is None:
101          now = now.replace(tzinfo=timezone.utc)
102      return now.astimezone(zone(tz)).date().isoformat()
```

`zone(tz)` is `gate.resolve_tz()` (`gate.py:56–82`), which tries `ZoneInfo(name)` and, on `ZoneInfoNotFoundError`, **falls back to `system_local_zone()` with `kind="system-local"`** rather than raising. `DEFAULT_TZ = "Europe/Berlin"` (`gate.py:26`), overridable with `FREECASH_TZ` (`gate.py:48`).

### 1.2 The atomic day lock — `gate.py:115–135`

```python
115  def lock_path(day: str):
116      return paths.day_locks_dir() / ("%s.lock" % day)
117
119  def acquire_day_lock(day: str):
120      """Try to consume *day*.  Returns ``(acquired, lock_path)``.
121
122      ``acquired is False`` means another invocation already consumed this day --
123      the caller must then perform no further work at all.
124      """
125      lock = lock_path(day)
126      lock.parent.mkdir(parents=True, exist_ok=True)
127      try:
128          fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
129      except FileExistsError:
130          return False, lock
131      try:
132          os.close(fd)
133      except OSError:
134          pass
135      return True, lock
```

The filename **is** the day key; the file is zero bytes. `os.open(..., O_CREAT | O_EXCL)` is one atomic syscall — there is no read-then-write window to race on. Verified live (§2c).

### 1.3 The real ordering — the day is claimed BEFORE the read

```python
307      source_kind = resolve_source(args.source)          # which source, not the read
308      day = gate.day_key(now)
309      acquired, lock = gate.acquire_day_lock(day)        # <-- DAY CLAIMED HERE
310      if not acquired:
311          # R1 duplicate: exactly one log line, no read, no snapshot, no ledger write.
...
320          print("SKIP_DUPLICATE_DAY %s" % day)
321          return 0
...
329      ledger = gate.record_attempt(day, now, ledger)     # ledger written, still no read
...      (missed-day notices, timezone-degraded notice, lines 331–369)
371      try:
372          raw = read_source(source_kind, day, base=..., transport=...)   # <-- READ HERE
```

`run_daily_check.py:309` claims the day; `:372` performs the read — **63 lines and three writes later**. In between, `record_attempt()` (`:329`) persists `last_attempt_day` to `last-run.json`. So a run that will later fail to obtain data has already: created the lock, written the ledger, and possibly emitted MISSED_DAY notices.

The module docstring states the intent plainly (`run_daily_check.py:5–8`):

> `1. **R1** -- consume today's operator-local day with an atomic exclusive-create lock. If the day is already consumed, print SKIP_DUPLICATE_DAY, append exactly one SKIP_DUPLICATE_DAY line to the alert log, and exit 0 having performed no read, no snapshot write and no ledger write.`

### 1.4 Does a data-less run permanently consume the day? — YES

Three independent reasons, each checked:

**(a) Nothing ever removes a lock.** `grep -rn --include=*.py -e unlink -e "remove(" -e rmtree monitoring/freecash/` finds exactly one removal path: `changedetect.prune_old_artifacts()` (`changedetect.py:298–325`). It prunes only `snapshots_dir()/*.json` (90 days) and `logs_dir()/run-*.log` (30 days). **`state/day-locks/` is not in the retention list.** The lock is permanent — no expiry, no TTL, no cleanup. (Consequence worth knowing: after 90 days the snapshot is pruned while the lock that proves the day was spent remains.)

**(b) `--force-recheck` is refused by design.** `run_daily_check.py:281–297` accepts the flag only to write `decision: "REFUSED"` to `logs/forced-recheck-requests.jsonl` and return exit 3. There is no re-read path in the codebase.

**(c) Real production instance.** Today's production run at `2026-10-01T06:53:46Z` was a **data-less** run, and it consumed the day:

`data/freecash-monitor/state/last-run.json` (read-only):
```json
{ "last_attempt_day": "2026-10-01", "last_success_day": "2026-10-01",
  "last_attempt_at_utc": "2026-10-01T06:53:46Z", "last_success_at_utc": "2026-10-01T06:53:46Z",
  "last_outcome": "MONITOR_DEGRADED", "consecutive_missed_days": 0,
  "timezone": "Europe/Berlin", "updated_at_utc": "2026-10-01T06:53:46Z" }
```
`data/freecash-monitor/snapshots/2026-10-01.json` — every figure `null`, `"degraded": true`, source note `"no operator-entered record for 2026-10-01 in operator-state.json"`. `data/freecash-monitor/state/day-locks/2026-10-01.lock` exists. `state/operator-state.json` has `"records": []`.

**So: yes, plainly.** A data-less run burns the Europe/Berlin day irrecoverably — and it also recorded `last_success_day = 2026-10-01`, because `MONITOR_DEGRADED` is in `SUCCESS_OUTCOMES` (`gate.py:32–41`, with `:198–200` advancing `last_success_day` when the outcome is in that set). The same holds for a hard read failure: `RUN_FAILED` (exit 5) leaves the lock in place too — `run_daily_check.py:28` says so explicitly: *"the status read failed; the day lock stays in place, no automatic re-run"*.

**Consequence for the scheduler:** the only lever that prevents burning a day is *not firing* until the read source is populated (see Precondition **P6** in `REGISTRATION-COMMAND.txt`).

---

## 2. Executed proofs (scratch roots only — never production)

All runs used the interpreter of record with `FREECASH_DATA_ROOT` pointed at a throwaway dir under `$LOCALAPPDATA/Temp/fc-r2/`, `FREECASH_TZ=Europe/Berlin`, `FREECASH_READ_SOURCE=operator_state`, and `FREECASH_TOAST_STUB=1` (so evidence runs do not spam the operator's desktop; the stub affects delivery only — it does not touch the lock or read path). Every exit code was measured **without a pipe**.

### (a) First run of the day — `evidence-05`

```
run1_exit=0
RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)
       snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0
       reminders=0 lock=2026-10-01.lock
stderr bytes: 0
```
Lock created (`state/day-locks/2026-10-01.lock`, 0 bytes), snapshot written, `last-run.json` written. Note the outcome: with no operator figures the run is `MONITOR_DEGRADED` **and exits 0**.

### (b) Immediate second run, same day — `evidence-05`

The second run was **armed with an unreachable read source** (`--source metrics_http --base-url http://127.0.0.1:1`). If any read had been attempted it would have failed loudly (`RUN_FAILED`, exit 5). It did not:

```
run2_exit=0
SKIP_DUPLICATE_DAY 2026-10-01
stderr bytes: 0
```
State before vs after the duplicate run:

| check | before | after | verdict |
|---|---|---|---|
| snapshot files | `2026-10-01.json` | `2026-10-01.json` | unchanged |
| snapshot `mtime@`+size listing | identical string | identical string | `snapshot_listing_unchanged=YES` |
| `last-run.json` sha256 | `e2cf24d0…53ed8` | `e2cf24d0…53ed8` | `ledger_unchanged=YES` |
| alert lines | 1 | 2 (delta **+1**) | exactly one `SKIP_DUPLICATE_DAY` record appended |

**Proof that no read happened:** an unreachable transport was armed and the run still printed `SKIP_DUPLICATE_DAY` with exit 0 and an unchanged snapshot set — so `read_source()` (line 372) was never reached. The only write is the single append-only alert line the design mandates.

### (c) Concurrent race — `evidence-06`

5 processes of `run_daily_check.py` launched simultaneously in one scratch root, repeated over **10 independent fresh roots**:

```
round 1: RUN_OK=1 SKIP=4 other=0 locks=1 snapshots=1 alert_lines=5 -> OK
...
round 10: RUN_OK=1 SKIP=4 other=0 locks=1 snapshots=1 alert_lines=5 -> OK
SUMMARY: rounds=10 launches=50 red_rounds=0
```
Round 1 verbatim: `race-1.1.out` → `RUN_OK …`; `race-1.2..5.out` → `SKIP_DUPLICATE_DAY 2026-10-01`; every stderr 0 bytes; exactly one lock file and one snapshot in the root. **Exactly one acquires the lock, 10/10 rounds.** (Looped 10× deliberately: an atomicity assertion can pass on a lucky run — see the `agenticos-live-data-verification` lesson on repeating a concurrency claim. 0 red rounds here.)

---

## 3. Day-key edge cases

### (a) Interpreter with vs without `tzdata` — `evidence-04`, `evidence-09`

| | venv python 3.11.9 | `py -3` = Python 3.14.7 |
|---|---|---|
| `importlib.util.find_spec('tzdata')` | `ModuleSpec(…tzdata…)` | `None` |
| `ZoneInfo('Europe/Berlin')` | `Europe/Berlin` ✅ | raises `ZoneInfoNotFoundError: No time zone found with key Europe/Berlin` |
| `gate.resolve_tz('Europe/Berlin')` | `(ZoneInfo(key='Europe/Berlin'), 'zoneinfo')` | `(datetime.timezone(timedelta(seconds=7200), 'Mitteleuropäische Sommerzeit'), 'system-local')` |
| `gate.timezone_report()` | `{'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}` | `{'kind': 'system-local', 'available': False, 'offset_now': '+0200'}` |
| `gate.day_key(now)` | `2026-10-01` | `2026-10-01` (coincidence — see below) |
| exit / stderr | 0 / empty | **0 / empty** |

The `py -3` claim is **verified**: it fails to resolve the zone. But be precise about the *consequence* — the routine does **not** crash under it. `resolve_tz` swallows the error and substitutes the machine's own zone; `run_daily_check.py:358–369` then prints `WARNING timezone_unavailable` and emits a `MONITOR_DEGRADED` notice. Today the day key still came out right only because this machine's local zone happens to *be* Central European.

**The hazard is real and was demonstrated** (`evidence-09`). With `FREECASH_TZ=America/New_York`:

| instant | venv 3.11.9 (tzdata) | `py -3` (no tzdata, falls back to +0200) |
|---|---|---|
| `2026-07-01T03:30:00Z` | `2026-06-30` | **`2026-07-01`** |
| `2026-01-15T04:30:00Z` | `2026-01-14` | **`2026-01-15`** |

A wrong interpreter therefore **silently moves the R1 day boundary** — and because the fallback outcome is `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`, that day is recorded as a success. This is precisely why the staged wrapper probes for a tzdata-capable interpreter and **exits 90 without invoking the monitor** if none qualifies (§5, `evidence-11`).

### (b) DST — `evidence-07`

Transitions for 2026 were located from the zone itself, not from memory:
`2026-03-29T01:00Z` (offset +01:00 → +02:00) and `2026-10-25T01:00Z` (+02:00 → +01:00).

| timestamp | day key |
|---|---|
| spring, local `2026-03-29T01:30+01:00` (before the jump) | `2026-03-29` |
| spring, local `2026-03-29T03:30+02:00` (after the jump) | `2026-03-29` |
| autumn, `2026-10-25T01:30+02:00` (first 01:30, CEST) | `2026-10-25` |
| autumn, `2026-10-25T01:30+01:00` (**the repeated hour**, CET) | `2026-10-25` |
| autumn, local `2026-10-25T04:00+01:00` | `2026-10-25` |
| local `2026-10-26T00:30+01:00` (after the change) | `2026-10-26` |

Exhaustive check — 145 sample instants at 15-minute resolution across a 36-hour window over each transition collapse to exactly three consecutive dates with **no gap and no repeat** for the transition date itself.

**Is the key calendar-day correct? YES.** Both instants inside the autumn repeated hour map to the same date, so the lock filename is identical and the second is refused by the lock — a DST transition cannot produce a second read for one calendar day. Across the spring gap the date never skips. Note the 30-hour/25-hour *day length* is irrelevant: the lock is keyed on the date, not on elapsed hours, so a short or long day is still exactly one day.

### (c) A clock that moves BACKWARDS across midnight — `evidence-08`

Driven through the real entry point with an injected clock, in its own scratch root:

```
step 1: now 2026-10-05T00:05+02:00 → RUN_OK 2026-10-05   locks=[2026-10-05.lock]
step 2: clock JUMPS BACK to 2026-10-04T23:30+02:00 → RUN_OK 2026-10-04   locks=[2026-10-04.lock, 2026-10-05.lock]
        ledger: last_attempt_day="2026-10-04", last_success_day="2026-10-04"   <-- MOVED BACKWARDS
step 3: clock returns to 2026-10-05T01:00 → SKIP_DUPLICATE_DAY 2026-10-05
step 4: clock back onto 2026-10-04 (already consumed) → SKIP_DUPLICATE_DAY 2026-10-04
```

Three findings:

1. **The lock still protects an already-consumed day.** Step 4 printed `SKIP_DUPLICATE_DAY`; a rewind onto a spent day cannot produce a second read. Rewinding *within* the same calendar day (C2: 12:00 → 07:00 on `2026-10-06`) likewise prints `SKIP_DUPLICATE_DAY`. **R1 is not violated by a backwards clock.**
2. **A backwards jump onto a never-run day claims that day and reads.** Step 2 acquired a *fresh* lock for `2026-10-04` and performed a full run. The two dates are distinct calendar days, so this is not literally an R1 violation — but it is a *back-fill* of an earlier day, which `gate.missed_days`' own docstring says the routine never does (`gate.py:213–214`).
3. **`last-run.json` moves backwards with no alarm.** After step 2, `last_attempt_day` and `last_success_day` both read `2026-10-04`, i.e. *earlier* than the value recorded before the jump. `gate.clock_moved_backwards()` (`gate.py:232–235`) computes exactly this condition — and is **never called**: `grep -rn --include=*.py clock_moved_backwards monitoring/freecash/` returns **1 definition line and 0 call sites** (the earlier count of 2 in the raw evidence log counted binary `__pycache__` hits; see the correction appended at the end of `evidence-03`). `missed_days()` returns `[]` when today < last_success, so a backwards clock produces no missed-day notice either. **Dead code + silent ledger regression = 3F.**

> Note on scope: this is a *finding*, not a change. Fixing it means editing `gate.py`/`run_daily_check.py`, which this track was forbidden from doing ("extend or document, never fork") and which would invalidate a sibling track's verification of those exact files. The minimal patch, for the owner, is one call site after line 308: refuse the run and emit an alert when `gate.clock_moved_backwards(day, gate.load_ledger())` is true.

### (d) A machine asleep at the scheduled hour — which catch-up exists? — `evidence-08`, `evidence-10`

**Two mechanisms exist. Neither back-fills the reading.**

1. **Routine-side (already implemented): awareness on the next run, never a retroactive read.** Seeding a ledger with `last_success_day = 2026-09-25` and running at `2026-10-01`:
   ```
   gate.missed_days('2026-10-01', seeded) = ['2026-09-26','2026-09-27','2026-09-28','2026-09-29','2026-09-30']
   RUN_OK 2026-10-01 … consecutive_missed_days: 5
   5 MISSED_DAY lines written to alerts.jsonl
   ```
   The gap is *reported*, not repaired — by design (`gate.py:213–214`: *"The routine never back-fills a missed day: a second read of a past day would be a second check for that day and would defeat R1"*). `watchdog.py` adds the same-evening detector.
2. **OS-side (the one that actually recovers the missed fire): Windows Task Scheduler `StartWhenAvailable`.** This is why the recommendation is the XML route: `schtasks /Create` has **no switch for it** (`evidence-13`: `schtasks /Create /?` exposes `/D /DELAY /DU /EC /ED /ET /F /I /IT /K /M /MO /NP /P /RI /RL /RP /RU /S /SC /SD /ST /TN /TR /U /V1 /XML /Z` and zero matches for `whenavailable`), while a real task on this host carries `<StartWhenAvailable>true</StartWhenAvailable>`. A missed 09:00 fires once when the machine is next available.

**And note the trap in the routine-side mechanism.** After the wake run above, the watchdog's coverage predicate (`watchdog.py:33`, `covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES`) returns:
```
{'day_key': '2026-10-01', 'covered': True, 'last_attempt_day': '2026-10-01',
 'last_success_day': '2026-10-01', 'last_outcome': 'MONITOR_DEGRADED', …}
```
`covered=True` on a day whose snapshot contains only `null`s. Because `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`, **the alarm is built to miss its own failure mode**: a run that read nothing reports itself fully covered, and the preceding 5-day gap is closed silently. This is finding **F2**; the corrective change would be to drop `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` (or have the watchdog require `last_success_day == today` *and* a non-degraded snapshot). Not applied.

---

## 4. Recommendation: exactly ONE route

> ### Adopt **Windows Task Scheduler**, registered from the staged XML
> `FreeCash-Daily-Monitor-R2.xml` via the single command in `REGISTRATION-COMMAND.txt`.
> Run the monitor through the staged wrapper `freecash-daily.cmd`.

### Justification against the alternatives

| | **Windows Task Scheduler** ✅ | Hermes cronjob | repo crontab |
|---|---|---|---|
| Exists today? | Route available; **no Free Cash task registered** (278 task rows, 0 matches) | Available but **`hermes cron list` → "No scheduled jobs."**; no `jobs.json` anywhere under `$HERMES_HOME`; `cron/executions.db` = 0 rows; no `freecash` string in the store | File exists at `config/freecash-crontab`; **no `crontab`/`cron` binary on the host** (`which` → exit 2) → **non-functional** |
| Fires when Hermes is down? | **Yes** — OS service | **No.** "Cron jobs are fired by the gateway's background ticker thread… A regular CLI chat session does not automatically fire cron jobs." | n/a |
| Catch-up for a slept/off machine | **Yes** — `StartWhenAvailable` | **No documented catch-up**; jobs are "delayed or skipped" on contention | n/a |
| Token cost | zero | zero (only via `--no-agent --script`) | zero |
| Survives reboot | Yes (per-user, InteractiveToken) | Requires gateway process/scheduled task to be up | n/a |
| Explicit env + workdir + log redirect | Yes — pinned in the wrapper; `WorkingDirectory` in the XML | Partial — `--workdir` exists; script must live under `~/.hermes/scripts/` (**absent on this host**) | No |
| R2/R4 risk | None — read-only wrapper | A prompt-mode job would run an LLM with tools; only the `--no-agent` form is acceptable | **HIGH** — its target `scripts/make_freecash_check.py` is a stub that builds a `{"type": "withdraw", …}` action and uses a *different* state root (`data/freecash/state.json`), i.e. a parallel monitor with no R1 enforcement |
| Diagnostics | Task history + the wrapper's own dated log | `hermes cron runs/incidents` | none |

**Decisive reasons, in order:**
1. **It is the only route with a catch-up for a machine that was asleep at the hour** — which is exactly the failure R1 must survive, since a lost fire is a permanently uncovered day.
2. **It does not depend on the Hermes gateway staying alive.** A monitoring routine whose availability is conditional on an application process is a monitoring routine that silently stops.
3. **It gives the explicit environment, working directory and log redirect the design requires**, with the env pinned as literals so no ambient value can redirect the production state root.
4. It is the **only** route with zero R2 exposure.

Hermes cron is the legitimate runner-up and worth keeping in mind if the machine is never off — its `--no-agent` mode ("empty stdout = silent", zero tokens) matches the quiet-day requirement well. It loses on catch-up and on gateway dependency. The repo crontab is rejected outright: it cannot execute at all, and its target is both a stub and an R2 hazard — **do not wire it.**

Scheduling time is **09:00 machine-local** with `StartBoundary 2026-10-02T09:00:00`. R1 does not depend on the fire time: the lock is keyed on the Europe/Berlin date, so a shifted or duplicated fire can only ever produce `SKIP_DUPLICATE_DAY`.

---

## 5. The staged artifacts, and the wrapper read back from disk

Written under `D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R2\scheduler\`:

| file | sha256 | state |
|---|---|---|
| `freecash-daily.cmd` | `0155f63f94021d95d90a20d1aa6ab1869e2394e89af5bccfa33432154c46741a` | **INERT** — registered by nothing |
| `FreeCash-Daily-Monitor-R2.xml` | `a2963ab276e2bd1acd063d1f141130a26e039da7406dacd4ae975cbf3ecdd067` | **INERT** — registers nothing |
| `REGISTRATION-COMMAND.txt` | — | command recorded, **NOT executed** |

> **Hash correction.** The XML hash was first read back as `eed52014ef179f9d1ea871f416117bb8c23340670ca73036f3a001806f1c88a0`, which is the value still shown in `evidence-12-wrapper-readback.txt`. That read-back predates the fix described in §5.4 (a `--` sequence inside an XML comment, caught by `validate_task_xml.py`, made the first draft not well-formed). The **current, verified** hash is the `a2963ab2…` above — the two differ only in the comment block, and every value quoted in §5.1–5.3 was re-read from the current file by `evidence-13` and is unchanged. Do not quote `eed52014…` as the delivered artifact; it is a superseded draft.

### 5.1 Exact wrapper command line (from the XML on disk)

```
<Command>C:\Windows\System32\cmd.exe</Command>
<Arguments>/c "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R2\scheduler\freecash-daily.cmd"</Arguments>
<WorkingDirectory>D:\AgenticOS</WorkingDirectory>
```

### 5.2 Exact interpreter path (pinned in the wrapper, resolved at run time)

Candidates, read back from `freecash-daily.cmd` lines 72–76:
```
if defined FREECASH_PY call :probe "%FREECASH_PY%"
call :probe "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
call :probe "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe"
call :probe "%HERMES_HOME%\hermes-agent\venv\Scripts\python.exe"
call :probe "py -3.11"
```
Resolved at run time by the `:probe` label, which requires `ZoneInfo('Europe/Berlin')` to resolve and prints `sys.executable`. **Observed resolved value**, from the wrapper's own log line:
```
freecash-daily py="C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe" root=... tz=Europe/Berlin source=operator_state
```
Read back from the interpreter itself: `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`, `3.11.9 (tags/v3.11.9:de54cf5, Apr 2 2024) [MSC v.1938 64 bit (AMD64)]`. `py -3` (3.14.7) is deliberately **not** a candidate.

### 5.3 Pinned environment, read back from disk (lines 62–68)
```
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"
set "FREECASH_TZ=Europe/Berlin"
set "FREECASH_READ_SOURCE=operator_state"
set "FREECASH_TOAST_STUB="
set "FC_ENTRY=D:\AgenticOS\monitoring\freecash\run_daily_check.py"
set "FC_CWD=D:\AgenticOS"
set "FC_LOGDIR=%FREECASH_DATA_ROOT%\logs"
```
`FREECASH_DATA_ROOT`, the timezone and the source are pinned as **literals** (not inherited), so an ambient value left by a test harness cannot redirect production state. `FREECASH_TOAST_STUB` is explicitly cleared so a real run really notifies (R3).

### 5.4 The wrapper is proven by execution — `evidence-11`

Because the production wrapper deliberately pins the production root, it was tested through a **path-redirected harness copy**, with the substitution asserted (occurrences == 1, original absent afterwards, replacement present) and the script aborting otherwise:

```
=== HARNESS COPY 1: data-root redirect, interpreter unchanged ===
  [copy1/data-root] occurrences of target = 1 (must be exactly 1)
  [copy1/data-root] substituted; original string now present = False
  run1: exit=0  stdout_bytes=0  stderr_bytes=0   locks=['2026-10-01.lock'] snapshots=['2026-10-01.json'] logs=['daily-2026-10-01.log']
  run2: exit=0  stdout_bytes=0  stderr_bytes=0   locks unchanged=True   snapshots unchanged=True
  (log carried RUN_OK ... MONITOR_DEGRADED, then SKIP_DUPLICATE_DAY — logged, not emitted)
=== HARNESS COPY 2: interpreter candidates replaced by a NO-TZDATA python ===
  copy2 run: exit=90  stdout_bytes=0  stderr_bytes=207
    stderr: "freecash-daily: FAIL no tzdata-capable Python interpreter found ... The monitor was NOT run and no day lock was consumed."
  after copy2 run: locks=[] snapshots=[]      <-- NO day consumed
WRAPPER VERIFIED BY EXECUTION = True
```

So: **quiet/duplicate day → exit 0 with 0 bytes on stdout and 0 bytes on stderr** (it emits nothing; it logs), and **wrong interpreter → exit 90 with no day lock consumed** (it fails closed). The XML itself parses and its element order matches a task this Windows build serialised — `evidence-13`, which also caught and fixed a real defect during this track (a `--` sequence inside an XML comment, which made the first draft not well-formed).

---

## 6. For the chosen route: the four required figures

**Expected Effort**
One command, about a minute, plus a human review of the XML. No code change, no new monitor, no new dependency. Includes a read-back check (`schtasks /Query /TN … /XML`) and a first-fire verification of `day-locks/` and `last-run.json`. Preconditions P5 (StartBoundary must be in the future) and P6 (the read source is currently empty) are the only real review items.

**Time-to-Revenue**
**None — this is visibility only, same day.** Scheduling the monitor produces no money and introduces no earning path; it makes one read per day happen reliably and on the record. The revenue-bearing path is entirely separate: a human (or an explicitly approved automation) acting on the Free Cash opportunities once the monitor's *read source* is actually populated. Explicitly: **do not read this option's "same day" as revenue.** Today's production evidence shows the source has never contained a reading (`operator-state.json` `"records": []`), so the monitor has been reporting `MONITOR_DEGRADED` every day it ran — including the day it silently consumed. Sequencing that matters more than the scheduler: populate a read source, then schedule, or the schedule just burns a day per day.

**Dependencies**
1. Human approval of the registration command (R4) — the only blocker that is not already satisfied.
2. Python 3.11.9 at the Hermes venv path, with `tzdata` (present, verified).
3. `D:\AgenticOS\monitoring\freecash\run_daily_check.py` present and read-only (present).
4. The machine's local timezone should be Europe/Berlin so the 09:00 fire and the day key agree (it is: `Mitteleuropäische Sommerzeit`, +0200) — and note the fire time is *not* what enforces R1.
5. A populated read source before the first fire, or that day is spent for nothing (P6). **Not currently satisfied.**
6. Optional, not required for R1: a same-evening `watchdog.py` task. Note it inherits defect F2, so it cannot currently distinguish "read and unchanged" from "read nothing".

**First Concrete Action**
Do **not** register yet. First, in this order: (1) have the operator append one real record — `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency` — to `D:\AgenticOS\data\freecash-monitor\state\operator-state.json` with `day_key: "2026-10-02"`, following the in-file `template_record`; then (2) register once, as the ordinary user, with the command in `REGISTRATION-COMMAND.txt`:

```
schtasks /Create /TN "FreeCash-Daily-Monitor-R2" /XML "D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R2\scheduler\FreeCash-Daily-Monitor-R2.xml"
```

and (3) read it back with `schtasks /Query /TN "FreeCash-Daily-Monitor-R2" /XML`, confirming `StartWhenAvailable=true` and `RunLevel=LeastPrivilege`. Leave today's spent lock alone.

---

## 7. Evidence index (all under this `scheduler/` folder unless noted)

> **Files in this folder that are NOT mine.** A concurrent session wrote
> `freecash-daily-wrapper.sh` (09:14) and, under `evidence/`,
> `01-proof-sandbox-run-and-duplicate.txt`, `02-quiet-vs-change-day.txt`,
> `03-sleep-and-no-backfill.txt`, `03b-missed-day-parsed.txt` and
> `driver-catchup-sim.py` (all 09:14–09:17). I did not create, read, edit or
> delete them, and none of them is cited below as my evidence. Note the second
> wrapper: two candidate wrappers for one job is exactly the parallel-path
> problem this routine keeps re-creating — the sibling's `.sh` is a Windows
> `bash` script, mine is the `.cmd` the staged XML actually points at. Whichever
> is promoted, the other must be retired.

| file | contents |
|---|---|
| `evidence-01-production-hermeticity-before.txt` | pre-run hashes, `find -newermt`, full mtime listing, day-lock dir |
| `evidence-03-code-daykey-lock-ordering.txt` | machine-generated line numbers and quotes for every code claim in §1, plus the production ledger/snapshot and the `clock_moved_backwards` correction |
| `evidence-04-daykey-under-no-tzdata-interpreter.txt` | §3(a): both interpreters, both outputs/errors, exit codes |
| `evidence-05-scratch-first-run-and-duplicate.txt` | §2(a)+(b): first run, duplicate run, mtime/file-count proof, ledger hashes |
| `evidence-06-concurrency-race.txt` | §2(c): 10 rounds × 5 processes, per-round counts, verbatim round-1 output |
| `evidence-07-daykey-dst-edge-cases.txt` | §3(b)+(c): transitions, DST day keys, exhaustive 15-minute sweep, backwards-clock arithmetic |
| `evidence-08-backward-clock-and-slept-machine.txt` | §3(c)+(d): four-step backwards-clock scenario, same-day rewind, 5-day gap wake run, watchdog `covered=True` |
| `evidence-09-no-tzdata-daykey-divergence.txt` | §3(a) hazard: the same instants bucketed into different days |
| `evidence-10-scheduler-route-facts.txt` | §4: Hermes cron (list/status/doctor/store), schtasks census + no freecash task, repo crontab contents and its stub/earning surface |
| `evidence-11-wrapper-verified-by-execution.txt` | §5.4: asserted substitution + both harness copies executed, byte counts, exit codes |
| `evidence-12-wrapper-readback.txt` | §5.1–5.3: sha256s, grepped command line/interpreter/env, resolved interpreter, current day key |
| `evidence-13-task-xml-validation.txt` | well-formedness, element-order comparison against the host's own export, R1-relevant values |
| `evidence-14-production-hermeticity-after.txt` | post-run hashes and listing; scratch roots |
| `evidence/probe_daykey_edge_cases.py` | the DST / day-key probe (executes the real `gate.day_key`) |
| `evidence/driver_backward_clock_and_catchup.py` | backwards-clock and slept-machine driver (executes the real entry point) |
| `evidence/test_wrapper_by_execution.py` | harness-copy generator + asserted substitution + executor |
| `evidence/validate_task_xml.py` | XML validator |
| `evidence/wrapper-harness-copy1-dataroot-redirect.cmd` | harness copy, data root redirected (runnable) |
| `evidence/wrapper-harness-copy2-no-tzdata.cmd`, `…-copy2b-…-own-root.cmd` | harness copies with no-tzdata interpreter |
| `evidence/reference-real-task-export-cua-driver-serve.xml` | read-only export of a real task on this host, used for element-order comparison |

---

## 8. Production hermeticity, attribution, and limits

**Production was never touched.** `sha256sum` of `data/freecash-monitor/state/last-run.json` and `data/freecash-monitor/alerts/alerts.jsonl`, and the `find -newermt "2026-10-01 00:00"` result and full mtime listing, are **byte-identical** before and after:

```
before: a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  last-run.json
after : a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  last-run.json
before: 1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts.jsonl
after : 1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts.jsonl
```
`find` returned the same four files both times (`alerts.jsonl`, `snapshots/2026-10-01.json`, `state/day-locks/2026-10-01.lock`, `state/last-run.json`), all with the pre-existing `2026-10-01 08:53:46` mtimes. Today's spent lock was **not** read, written or removed. All executions used `FREECASH_DATA_ROOT` pointing at `$LOCALAPPDATA/Temp/fc-r2/…`.

**No git writes; no task registered.** `git status --short | wc -l` was 863 at the start; the only files this track created are the new ones listed in §7 plus the two artifacts in §5. No Windows scheduled task was created, modified or deleted (`schtasks` was used only for `/Query`).

**Attribution caveat.** Two sibling writers were active during this run.
1. **`$LOCALAPPDATA/Temp/fc-r2/`** is shared: alongside my own distinctly-named roots (`scratchA`, `race-1…10`, `backclock*`, `asleep-gap`, `wrapperprod*`) it now holds `suite-*.txt`, `rgv-*` and `root-a…root-tz`, which were **not** produced by this track (timestamps 09:07–09:15; `rgv-` is a rule-gate-verifier namespace). I only ever created or removed my own named subdirectories, and I removed the base directory once, at 09:06, before those files existed. Treat any residue there as multi-writer.
2. **This deliverable folder is shared.** While I worked, another session wrote `freecash-daily-wrapper.sh` and five files under `evidence/` (listed in §7). I did not touch them. The sibling `DELEGATION-2026-10-01/scheduler/` folder was likewise being written by a third session at 09:01 while I read it. My artifacts are the ones enumerated in §5 and §7 with their sha256s recorded — and one of those hashes (`evidence-12`'s XML value) was superseded mid-track by my own fix, corrected in §5.

**Limits — what this track could NOT prove (stated plainly):**

1. **`schtasks /Create` non-elevated was not tested.** Registration is forbidden by this track's constraints, so "a per-user task registers without elevation" is **UNVERIFIED BY EXECUTION**. Recorded as note N2 in `REGISTRATION-COMMAND.txt`.
2. **The XML was not validated by import.** It parses and its element order matches this build's own serialisation (`evidence-13`), but only `schtasks /Create /XML` can prove the importer accepts it, and that is the gated action.
3. **`StartWhenAvailable` catch-up was not observed firing.** Its semantics are cited from the setting that a real registered task on this host carries; producing the actual slept-machine fire would require waiting for a real sleep event with a registered task.
4. **Hermes cron's absence of catch-up is read from the vendor documentation, not measured** (a job would have to be created to test it, which is a live scheduler change no track asked for).
5. **No timing measurement of the 09:00 fire** was possible for the same reason.
6. **F2/F3 were not fixed.** They are documented, reproduced, and left for the code owner; this track's mandate was R1's provability plus the scheduler entry, and `gate.py`/`run_daily_check.py` are under verification by a sibling track.

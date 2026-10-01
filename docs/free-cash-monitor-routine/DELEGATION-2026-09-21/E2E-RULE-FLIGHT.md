# E2E-RULE-FLIGHT — first real end-to-end flight of R1–R4
## Free Cash daily status monitor (`monitoring/freecash/`)

| field | value |
| --- | --- |
| flight date | 2026-09-21 (host local, Europe/Berlin) |
| host / repo | Windows 11, `D:/AgenticOS` |
| interpreter | `python` = Hermes venv **Python 3.11.9** (has `tzdata`; `Europe/Berlin` resolved as `zoneinfo`) |
| throwaway state root | `C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846` |
| scratch (tooling + transcript) | `C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846` |
| real state root | `D:/AgenticOS/data/freecash-monitor` — **never pointed at, never written** (proof in §11) |
| routine source | `monitoring/freecash/run_daily_check.py` v1.0.0 + `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `readonly_client.py`, `operator_state.py`, `paths.py`, `watchdog.py` |
| files created by this task | this `.md` only, plus the temp scratch/tooling above |

**Why this flight exists.** Every prior run of the routine on this host ran with an
empty operator file. In the real state root the operator file still says
`"records": []`, no approval item has ever existed, and the alert log holds only
two degraded lines. Quoted read-only from the real root, unchanged by this flight:

```text
--- D:/AgenticOS/data/freecash-monitor/state/operator-state.json ---
  ... "records": [], ...
--- D:/AgenticOS/data/freecash-monitor/alerts/alerts.jsonl ---
  {"day_key": "2026-09-20", ... "event_type": "MONITOR_DEGRADED", ...}
  {"day_key": "2026-09-20", ... "event_type": "SKIP_DUPLICATE_DAY", ...}
```

So R3's real notification path and R4's real queue path had **never** been
exercised on real input. This document is the transcript of the first flight that
does, and of the four rule events it produced.

## 0. Honest scope of the flight (read this before the verdicts)

1. **Simulated days through the routine's own clock seam, not two real calendar
   days.** `run_daily_check.py` deliberately has no `--now` flag; the day key is
   the operator's real local day. The flight therefore drives the real
   `run_daily_check.run(argv, now=...)` entry point (documented in the module as
   the test seam that pins the whole run's clock via `paths.set_clock`). Inside
   the process this pins the day key, the lock filename, the snapshot `day_key`,
   the ledger stamps and every alert `ts_utc`. **No routine source file was
   modified** (§11). Everything else — the lock syscall, the read, the compare,
   the snapshot, the notification, the queue, the CLI — is the shipped code path.
2. **The offline delivery stub was used** (`FREECASH_TOAST_STUB=1`), so the
   process-local dispatch path ran fully but the OS-level balloon tip was not
   fired (constraint: no messages sent). The delivery label recorded is
   therefore `STUB_OK`, **never** `TOAST_OK` — reported as such below.
3. **No network egress is measured, not assumed**: the launcher installs a
   process-wide audit hook that counts every `socket.*` event, and prints the
   count at exit (`AUDIT socket_events=...`).

## 1. Setup

`python -V` and the throwaway root; then the launcher's idea of the state root
printed by the routine itself (`paths.data_root()`), which is the same string in
every run below.

### Setup 0 — interpreter, zoneinfo, throwaway root, and the real state root (untouched)
The real state root is listed **read-only, before any run**, so §9 can show it was never touched.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python -V && python -c "import sys,zoneinfo;print('tz ok', zoneinfo.ZoneInfo('Europe/Berlin'))"
ROOT=$(cat "$LOCALAPPDATA/Temp/freecash-e2e-root.txt")   # made with: mkdir -p "C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-$(date +%Y%m%d-%H%M%S)"
export FREECASH_DATA_ROOT="$ROOT" FREECASH_TOAST_STUB=1 FREECASH_TZ=Europe/Berlin
ls -la D:/AgenticOS/data/freecash-monitor
```

Raw output (`transcript/step00_setup.txt`):

```text
Python 3.11.9
tz ok Europe/Berlin
throwaway state root = C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846 FREECASH_TOAST_STUB=1 FREECASH_TZ=Europe/Berlin
total 4
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 .
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 ..
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 alerts
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 approvals
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 logs
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 snapshots
drwxr-xr-x 1 cd-pr 197609 0 Sep 20 21:08 state
```


### Tools used (all under the scratch dir, all read-only w.r.t. the repo)

* `sim_run.py` — clock-pinned launcher: installs the socket audit counter, prints
  `paths.data_root()`, the resolved tz kind and the computed `day_key`, then calls
  `run_daily_check.run(argv, now=<simulated UTC instant>)`; prints the exit code
  and the socket-event tally.
* `set_record.py` — upserts one operator-entered daily record using the routine's
  own `operator_state`/`paths` modules (exact schema of
  `operator_state.py`: `schema_version, kind, note, how_to, records[],
  template_record`, records carrying `day_key, entered_at_utc, account_status,
  earnings_total_cents, balance_cents, pending_cents, currency`).
* `race.py` — launches *N* fresh interpreters on the same simulated day behind a
  shared start barrier, so all of them hit `gate.acquire_day_lock()` together.
* `dump_state.py`, `check.py`, `hash_tree.py`, `list_tree.py` — evidence readers
  (full state dump, rule-focused summary, whole-root sha256 diff, mtime listing).

Their full source is in Appendix B, so the flight is reproducible.

## 2. The two-day scenario (and the extra days it needed)

The parent request asked for day 1 = baseline and day 2 = **one** change that
yields **exactly one** notification and **exactly one** approval item, plus an
account-status change *if the schema supports it*. The schema does support
`account_status`, but R3 is **one notification per distinct change**, so a single
day that moves both money and status necessarily yields two. The scenario
therefore exercises each in isolation, and then proves the granularity on a third
day:

| # | simulated day (operator-local) | operator record entered (exact JSON of the record) | intent | `changes` / `notifications` / `approvals` |
| --- | --- | --- | --- | --- |
| 1 | 2026-09-19 | `{"account_status": "ACTIVE", "balance_cents": 1340, "currency": "USD", "day_key": "2026-09-19", "earnings_total_cents": 1340, "entered_at_utc": "2026-09-19T06:40:00Z", "pending_cents": 0}` | baseline | 0 / 0 / 0 → `INITIAL_BASELINE` |
| 2 | 2026-09-20 | `{"account_status": "ACTIVE", "balance_cents": 1465, "currency": "USD", "day_key": "2026-09-20", "earnings_total_cents": 1465, "entered_at_utc": "2026-09-20T06:35:00Z", "pending_cents": 0}` | earnings **+125 cents** ($13.40 → $14.65); the balance moves with it and is coalesced into the same change, by design ("Balance: $14.65 (changed too)") | **1 / 1 / 1** → `EARNINGS_CHANGED` |
| 2b | 2026-09-20, later | same record | second run, same day | `SKIP_DUPLICATE_DAY`, no read/snapshot/ledger write |
| 3 | 2026-09-21 | `{"account_status": "PAUSED", "balance_cents": 1465, "currency": "USD", "day_key": "2026-09-21", "earnings_total_cents": 1465, "entered_at_utc": "2026-09-21T06:50:00Z", "pending_cents": 0}` | **account status** ACTIVE → PAUSED, money unchanged | **1 / 1 / 1** → `STATUS_CHANGED` |
| 4 | 2026-09-22 | `{"account_status": "ACTIVE", "balance_cents": 1500, "currency": "USD", "day_key": "2026-09-22", "earnings_total_cents": 1500, "entered_at_utc": "2026-09-22T06:45:00Z", "pending_cents": 0}` | **two** distinct changes at once (+35 cents and PAUSED → ACTIVE) | **2 / 2 / 2** (granularity proof) |
| 5 | 2026-09-23 | `{"account_status": "ACTIVE", "balance_cents": 1500, ..., "earnings_total_cents": 1500, ...}` | concurrent same-day race (2 processes) | 1 × `RUN_OK` + 1 × `SKIP_DUPLICATE_DAY` |
| 6 | 2026-09-24 | — (source forced to `metrics_http`) | unreachable base URL | `RUN_FAILED`, exit 5 |
| 7 | 2026-09-25 | — (source forced to `metrics_http`) | non-loopback host | `RUN_FAILED`, exit 5, **0 socket events** |
| 8 | 2026-09-26 | `{"account_status": "ACTIVE", "balance_cents": 1600, ..., "earnings_total_cents": 1600, ...}` | +100 cents, then **lock tamper** | 1 / 1 / 1, then tampered re-run |
| — | 2026-09-27 | `{"account_status": "ACTIVE", "balance_cents": 1600, ..., "earnings_total_cents": 1600, ...}` | `--force-recheck` refusal, then a 5-way race | refused (exit 3); 1 × `RUN_OK` + 4 × `SKIP_DUPLICATE_DAY` |
| — | 2026-09-28 | `{... "earnings_total_cents": 1600, ...}` | run *after* the human approval | `OK_NO_CHANGE`, approval file untouched |

Every entry above was written with `set_record.py`, which prints the record it
entered — that printed JSON is quoted per day in §3–§5.

## 3. R1 — exactly one status read per operator-local calendar day

### 3.1 Day 1: the lock consumes the day, exactly one snapshot, zero notifications

### Day 1 — operator record + one run

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python set_record.py "$FREECASH_DATA_ROOT" 2026-09-19 2026-09-19T06:40:00Z ACTIVE 1340 1340 0 USD
SIM_NOW=2026-09-19T09:00:00Z python sim_run.py
```

Raw output (`transcript/step01_set_record_day1.txt`):

```text
set_record: path=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\state\operator-state.json template_created=True records_now=1
set_record: record entered = {"account_status": "ACTIVE", "balance_cents": 1340, "currency": "USD", "day_key": "2026-09-19", "earnings_total_cents": 1340, "entered_at_utc": "2026-09-19T06:40:00Z", "pending_cents": 0}
```


### Day 1 — the run itself
`written=True`, `notifications=0`, `approvals=0`, `lock=2026-09-19.lock`, and the audit tally shows `socket_events=0`.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ SIM_NOW=2026-09-19T09:00:00Z python sim_run.py
```

Raw output (`transcript/step02_run_day1.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-19T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-19 pid=23028
RUN_OK 2026-09-19 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-19.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-19.lock
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=375
```


### 3.2 Day 2: the changed day (the first real notification and queue item)

### Day 2 — operator record (earnings +125 cents) + run

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python set_record.py "$FREECASH_DATA_ROOT" 2026-09-20 2026-09-20T06:35:00Z ACTIVE 1465 1465 0 USD
SIM_NOW=2026-09-20T09:00:00Z python sim_run.py
```

Raw output (`transcript/step03_set_record_day2.txt`):

```text
set_record: path=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\state\operator-state.json template_created=False records_now=2
set_record: record entered = {"account_status": "ACTIVE", "balance_cents": 1465, "currency": "USD", "day_key": "2026-09-20", "earnings_total_cents": 1465, "entered_at_utc": "2026-09-20T06:35:00Z", "pending_cents": 0}
```


### Day 2 — the run
`outcome=EARNINGS_CHANGED changes=1 notifications=1 approvals=1` — the first non-degraded change this routine has ever produced on real input.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ SIM_NOW=2026-09-20T09:00:00Z python sim_run.py
```

Raw output (`transcript/step04_run_day2.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-20T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-20 pid=8048
RUN_OK 2026-09-20 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-09-20.lock
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=404
```


### Day 2 a second time — the duplicate-day refusal (R1)
Prints `SKIP_DUPLICATE_DAY 2026-09-20` and exits **0** (a duplicate is not an error). Same output shape for the third run in §3.3.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ SIM_NOW=2026-09-20T15:30:00Z python sim_run.py
```

Raw output (`transcript/step05_run_day2_duplicate.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-20T15:30:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-20 pid=18860
SKIP_DUPLICATE_DAY 2026-09-20
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=356
```


### 3.3 A duplicate run must not touch anything — proved byte-for-byte

`hash_tree.py` hashes every file of the throwaway root before and after a
duplicate run; `diff` then reports exactly which bytes changed.

### Third run of day 2, with a whole-root sha256 diff

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python hash_tree.py "$FREECASH_DATA_ROOT" > before.txt
SIM_NOW=2026-09-20T20:00:00Z python sim_run.py      # duplicate
python hash_tree.py "$FREECASH_DATA_ROOT" > after.txt
diff -u before.txt after.txt
```

Raw output (`transcript/step07_diff_dup3.txt`):

```text
--- C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846/transcript/step07_hashes_before_dup3.txt	2026-09-21 09:40:20.265426300 +0200
+++ C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846/transcript/step07_hashes_after_dup3.txt	2026-09-21 09:40:20.592545500 +0200
@@ -1,4 +1,4 @@
-aed6f80adb6fa32decb6c43b176988dba7f3686a4327db315162e4193035f554      2390  alerts\alerts.jsonl
+3e01efef193b358fccd5af67b4271cd25a99dbe363f3a50649db0b57d2c5ffb1      2839  alerts\alerts.jsonl
 a4e6247aa06f698d74de9604d457cf72f9a1fd0907a69ddc9817dcebd4f6c723       978  approvals\pending.json
 3e70354dbaae41c9f28349fc02ea8ae98705cbcbb4ef2115b82e9da77df334cd       479  logs\toast-stub.log
 b179b0e163fc5b89780d897c821563b4fa66e9b8012bf5557a068004167da8d7       493  snapshots\2026-09-19.json
```


**Result: exactly one file changed — `alerts/alerts.jsonl` — and only by the one
`SKIP_DUPLICATE_DAY` line (2390 → 2839 bytes).** No snapshot was rewritten, the
ledger `last-run.json` is byte-identical (so `record_attempt()` was never called,
which is the routine's proof that *no read happened*), `notified-keys.json` is
unchanged (no dispatch), and `approvals/pending.json` is unchanged (no new
queue item). The only permitted write is the one audit line.

### 3.4 The day-lock is atomic under a real race

### Two processes, same simulated day 2026-09-23, shared start barrier
`race.py` forks two fresh interpreters, both spinning until the same `SIM_START_AT` epoch, then both call `run_daily_check.run(now=2026-09-23T09:00:00Z)`.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python race.py "$FREECASH_DATA_ROOT" 2026-09-23T09:00:00Z 2 "$TRANSCRIPT/step13_conc1"
```

Raw output (`transcript/step13_concurrency_round1.txt`):

```text
race: root=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846 sim_now=2026-09-23T09:00:00Z children=2 barrier_epoch=1789976444.905666
--- child 1 exit=0 (step13_conc1_proc1.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-23T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-23 pid=40420
RUN_OK 2026-09-23 outcome=OK_NO_CHANGE source=operator_entered(data_available=True) snapshot=2026-09-23.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-23.lock
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=376
--- child 2 exit=0 (step13_conc1_proc2.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-23T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-23 pid=4320
SKIP_DUPLICATE_DAY 2026-09-23
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=356
race tally: RUN_OK=1 SKIP_DUPLICATE_DAY=1 RUN_FAILED=0
```


### Five processes, same simulated day 2026-09-27 (harder race)
Exactly one `RUN_OK` and four `SKIP_DUPLICATE_DAY` — the `os.open(lock, O_CREAT|O_EXCL|O_WRONLY)` syscall is the only arbiter; there is no read-then-write window. Note also `reminders=1`: the same run nagged a 7-day-old pending item, which is the R4 nudge, not an action.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python race.py "$FREECASH_DATA_ROOT" 2026-09-27T09:00:00Z 5 "$TRANSCRIPT/step19_conc2"
```

Raw output (`transcript/step19_concurrency_round2.txt`):

```text
race: root=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846 sim_now=2026-09-27T09:00:00Z children=5 barrier_epoch=1789976475.454649
--- child 1 exit=0 (step19_conc2_proc1.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-27T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-27 pid=19096
SKIP_DUPLICATE_DAY 2026-09-27
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=356
--- child 2 exit=0 (step19_conc2_proc2.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-27T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-27 pid=33488
SKIP_DUPLICATE_DAY 2026-09-27
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=356
--- child 3 exit=0 (step19_conc2_proc3.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-27T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-27 pid=40676
SKIP_DUPLICATE_DAY 2026-09-27
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=356
--- child 4 exit=0 (step19_conc2_proc4.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-27T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-27 pid=38064
SKIP_DUPLICATE_DAY 2026-09-27
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=356
--- child 5 exit=0 (step19_conc2_proc5.txt) ---
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-27T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-27 pid=29588
RUN_OK 2026-09-27 outcome=OK_NO_CHANGE source=operator_entered(data_available=True) snapshot=2026-09-27.json written=True changes=0 notifications=0 approvals=0 reminders=1 lock=2026-09-27.lock
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=414
race tally: RUN_OK=1 SKIP_DUPLICATE_DAY=4 RUN_FAILED=0
```


### 3.5 The lock population at the end: exactly one lock per consumed day

### Rule-focused summary of the throwaway root
10 locks for 10 distinct consumed days (2026-09-19 … 2026-09-28), never two for one day.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python check.py "$FREECASH_DATA_ROOT" FINAL
```

Raw output (`transcript/step24b_check_final.txt`):

```text
--- CHECK FINAL (C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846) ---
R1 day-locks (10): 2026-09-19.lock, 2026-09-20.lock, 2026-09-21.lock, 2026-09-22.lock, 2026-09-23.lock, 2026-09-24.lock, 2026-09-25.lock, 2026-09-26.lock, 2026-09-27.lock, 2026-09-28.lock
R3 snapshots (8): 2026-09-19.json, 2026-09-20.json, 2026-09-21.json, 2026-09-22.json, 2026-09-23.json, 2026-09-26.json, 2026-09-27.json, 2026-09-28.json
R3 alerts.jsonl lines=29 event_types={'APPROVAL_PENDING': 7, 'EARNINGS_CHANGED': 4, 'INITIAL_BASELINE': 1, 'MISSED_DAY': 3, 'OK_NO_CHANGE': 3, 'RUN_FAILED': 2, 'SKIP_DUPLICATE_DAY': 7, 'STATUS_CHANGED': 2}
R3 notified-keys=12 deliveries={'STUB_OK': 12}
R4 approval items=5
R4   432aed66-f285-4bf2-bcca-046db665caa4 status=APPROVED exec=NOT_EXECUTED allowed=False expires=None day=2026-09-20
R4   15a7d637-5694-44b2-b4eb-c1e6638e358c status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-21
R4   eeb354d1-010c-4d7b-a138-98f28b19e2b7 status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-22
R4   95931e50-52bd-4884-bf81-d49cc3640ade status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-22
R4   56b49c66-8ee6-40c0-87eb-cd5d84501f56 status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-26
R4 decided.jsonl lines=1 -> APPROVED by=Chris (operator) exec=NOT_EXECUTED
R1 ledger last_attempt_day=2026-09-28 last_success_day=2026-09-28 last_outcome=OK_NO_CHANGE missed=0 tz=Europe/Berlin
--- END CHECK FINAL ---
```


## 4. R3 — notify exactly once per distinct status/earnings change

The two change days produced real notifications: an `EARNINGS_CHANGED` for a
+125 cent move and a `STATUS_CHANGED` for ACTIVE → PAUSED, each with exactly one
dispatch and exactly one approval item. The proof that R3 counts *distinct
changes* (not days) is day 4, where two changes produced two notifications.

### Day 3 — account status change (ACTIVE → PAUSED), money unchanged

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python set_record.py "$FREECASH_DATA_ROOT" 2026-09-21 2026-09-21T06:50:00Z PAUSED 1465 1465 0 USD
SIM_NOW=2026-09-21T09:00:00Z python sim_run.py
```

Raw output (`transcript/step09_run_day3.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-21T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-21 pid=16316
RUN_OK 2026-09-21 outcome=STATUS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-21.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-09-21.lock
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=408
```


### Day 4 — two distinct changes in one day (+35 cents AND PAUSED → ACTIVE)
`changes=2 notifications=2 approvals=2` — one notification per *distinct* change, not one per day.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python set_record.py "$FREECASH_DATA_ROOT" 2026-09-22 2026-09-22T06:45:00Z ACTIVE 1500 1500 0 USD
SIM_NOW=2026-09-22T09:00:00Z python sim_run.py
```

Raw output (`transcript/step11_run_day4.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-22T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-22 pid=580
RUN_OK 2026-09-22 outcome=STATUS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-22.json written=True changes=2 notifications=2 approvals=2 reminders=0 lock=2026-09-22.lock
[sim_run] exit=0
[sim_run] AUDIT socket_events=0 all_events=454
```


### 4.1 The dedupe key is written **before** dispatch, and it held

The tampered re-run of day 8 (§7) re-detected the same change with the same
dedupe key. The routine logged the change but dispatched **nothing**
(`notifications=0`), and no new key was added to `notified-keys.json`. The alert
line it wrote is quoted here straight from the state root:

```text
see §8.2 — the second `EARNINGS_CHANGED` line for 2026-09-26 carries
"observed": {"already_notified": true} and severity "info" (log-only), while the
first carries severity "notify" and the approval handle.
```

The `notified-keys.json` index shows the seeded key for day 2 with its delivery
label — `STUB_OK`, i.e. the offline stub, never `TOAST_OK`:

```text
"2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb": {
  "first_notified_at_utc": "2026-09-20T09:00:00Z",
  "delivery": "STUB_OK",
  "updated_at_utc": "2026-09-20T09:00:00Z"
}
```

`OK_NO_CHANGE` is log-only: the day-5, day-7 (race winner) and day-9 runs each
wrote exactly one `OK_NO_CHANGE` line and dispatched nothing
(`notifications=0` in their `RUN_OK` lines, and 12 `STUB_OK` keys in total for
29 alert lines).

### 4.2 The exact notification payloads (from `alerts/alerts.jsonl`)

Quoted verbatim in Appendix A. The two real change notifications read:

```text
[FreeCash] EARNINGS CHANGE 2026-09-20
Earnings:  $13.40 -> $14.65  (+$1.25)
Balance:   $14.65 (changed too)
Pending:   $0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-20)
Detail:    alerts.jsonl dedupe=2efb946ed0a52059
ACTION:    No action taken. Review and approve anything you want done.
Approval:  432aed66-f285-4bf2-bcca-046db665caa4 (PENDING - yours to decide, nothing executes)
```

## 5. R4 — human approval before any external action

### 5.1 The queue the routine built (real items, real handles)

### Queue listing with the documented human CLI
Five real items; every one `PENDING`, `expires_at_utc=None`, `execution_state=NOT_EXECUTED`.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python monitoring/freecash/approval_queue.py list
```

Raw output (`transcript/step20a_queue_list.txt`):

```text
432aed66-f285-4bf2-bcca-046db665caa4  PENDING  2026-09-20  expires_at_utc=None  execution_state=NOT_EXECUTED
15a7d637-5694-44b2-b4eb-c1e6638e358c  PENDING  2026-09-21  expires_at_utc=None  execution_state=NOT_EXECUTED
eeb354d1-010c-4d7b-a138-98f28b19e2b7  PENDING  2026-09-22  expires_at_utc=None  execution_state=NOT_EXECUTED
95931e50-52bd-4884-bf81-d49cc3640ade  PENDING  2026-09-22  expires_at_utc=None  execution_state=NOT_EXECUTED
56b49c66-8ee6-40c0-87eb-cd5d84501f56  PENDING  2026-09-26  expires_at_utc=None  execution_state=NOT_EXECUTED
```


### 5.2 A decision cannot be made by a machine, and only a person may sign

### --by routine (machine identity) / missing --by / missing --note
Exit 4: `REFUSED: refused: 'routine' is not a human identity…`. The other two invocations are the CLI's own `argparse` refusals (`--by` and `--note` are mandatory), exit 2 — quoted in `transcript/step20c_no_by.txt` and `step20d_no_note.txt`.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python monitoring/freecash/approval_queue.py decide --id 432aed66-... --decision approve --by routine --note "automated review"
python monitoring/freecash/approval_queue.py decide --id 432aed66-... --decision approve --note "no identity"
python monitoring/freecash/approval_queue.py decide --id 432aed66-... --decision approve --by "Chris"
```

Raw output (`transcript/step20b_machine_identity.txt`):

```text
REFUSED: refused: 'routine' is not a human identity; this routine may only record a decision made by a person
```


### 5.3 The human decision, with `--by` attribution

### The decision the operator recorded

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python monitoring/freecash/approval_queue.py decide --id 432aed66-f285-4bf2-bcca-046db665caa4 \
    --decision approve --by "Chris (operator)" \
    --note "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only."
```

Raw output (`transcript/step20e_human_decision.txt`):

```text
recorded APPROVED for 432aed66-f285-4bf2-bcca-046db665caa4 by Chris (operator) at 2026-09-21T07:41:40Z
execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)
```


### Queue after the decision + the append-only decision trail

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python monitoring/freecash/approval_queue.py list
python -c "print(open(r'$FREECASH_DATA_ROOT/approvals/decided.jsonl').read())" 
```

Raw output (`transcript/step20f_decided_jsonl.txt`):

```text
{"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "day_key": "2026-09-20", "decided_at_utc": "2026-09-21T07:41:40Z", "decided_by": "Chris (operator)", "decision": "APPROVED", "decision_note": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.", "execution_allowed_by_this_routine": false, "execution_state": "NOT_EXECUTED", "expires_at_utc": null, "proposed_action": {"action_type": "REQUEST_PAYOUT", "amount_cents": 1465, "destination": "OPERATOR_SPECIFIED - not stored by the routine", "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"}, "schema_version": 1}
```


### 5.4 A decision can never be executed automatically

Three independent pieces of evidence, all from this flight:

1. **The decision record itself re-asserts the freeze.** `execution_state` is
   still `NOT_EXECUTED`, `execution_allowed_by_this_routine` is `false`, and
   `expires_at_utc` is `null` — after approval. (Quoted verbatim below.)
2. **The first run after the approval touched neither the queue nor the decision
   trail.** A whole-root sha256 diff across that run lists only
   `alerts.jsonl`, `toast-stub.log`, the new snapshot, the new day lock,
   `last-run.json` and `notified-keys.json` — `approvals/pending.json` and
   `approvals/decided.jsonl` do not appear.
3. **Static freeze:** the only `execution_state` assignment sites in the routine
   are `approval_queue.py:132` and `:181` (plus the trail write at `:197`), and
   every one of them writes `EXECUTION_STATE_NOT_EXECUTED`. `"APPROVED"` appears
   in the package only as the constant/`DECISIONS` mapping — no module branches
   on it to take an action.

Also note the approved item stops being nagged while the others continue
(`APPROVAL_PENDING` reminder for item `15a7d637` on 2026-09-28) — the routine
keeps prompting a human, and does nothing else.

### Run AFTER the human approval (2026-09-28) + whole-root diff

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python set_record.py "$FREECASH_DATA_ROOT" 2026-09-28 2026-09-28T06:35:00Z ACTIVE 1600 1600 0 USD
python hash_tree.py "$FREECASH_DATA_ROOT" > before.txt
SIM_NOW=2026-09-28T09:00:00Z python sim_run.py
python hash_tree.py "$FREECASH_DATA_ROOT" > after.txt
diff -u before.txt after.txt
```

Raw output (`transcript/step20g_diff.txt`):

```text
--- diff of the entire state root across the run that followed the approval ---
--- C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846/transcript/step20g_hashes_before.txt	2026-09-21 09:41:41.005681500 +0200
+++ C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846/transcript/step20g_hashes_after.txt	2026-09-21 09:41:41.410444200 +0200
-0e850227805330d2953fa736044986a9c1a3c649f55910b2a12438735dd3a745     16671  alerts\alerts.jsonl
+a041ce9453b6fd63845353fa07f0ffb435381d6262e18f1f0c88fac6e02b43b8     17673  alerts\alerts.jsonl
-c305df057a94caadcaa04289d29f7ff77e85a5e04788934d350bd26c5ca7bf88      4704  logs\toast-stub.log
+7e03ac4bcc4364057a864b0741e703de5f8119541f6def1115e67c1b9d42e376      5271  logs\toast-stub.log
+591e48842f7a05cd4a4433a0f58b71c83ab374a62587b2d799372c9a9c82c696       493  snapshots\2026-09-28.json
-61ff4e884b037bae1207db857bfa09a28d1f483202f599593ed89fe592856465       337  state\last-run.json
-906859d486f4251aecabb30bf59a34b7419c3e05b9b4485ed1bece8dba79a430      2374  state\notified-keys.json
+e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855         0  state\day-locks\2026-09-28.lock
+4c867e5a03ee7a7940d21533aa665264906c2c725a56c4389e75777ece2d2272       337  state\last-run.json
+f12cc56b0bf49eabcdf0b0d32bf2b498fd1d25e9bd5e52194fcfeecf9011000b      2586  state\notified-keys.json
diff_exit=1
```


### The approved item as stored (status APPROVED, execution state still frozen)

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python -c "import json;print(json.dumps([i for i in json.load(open(r'$FREECASH_DATA_ROOT/approvals/pending.json'))['items'] if i['approval_id']=='432aed66-f285-4bf2-bcca-046db665caa4'], indent=2))"
```

Raw output (`transcript/step20g_item_after_approval.txt`):

```text
{
  "approval_id": "432aed66-f285-4bf2-bcca-046db665caa4",
  "created_at_utc": "2026-09-20T09:00:00Z",
  "day_key": "2026-09-20",
  "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb",
  "reason": "earnings_total_cents moved from $13.40 to $14.65. Review and decide whether any action is wanted.",
  "proposed_action": {
    "action_type": "REQUEST_PAYOUT",
    "amount_cents": 1465,
    "destination": "OPERATOR_SPECIFIED - not stored by the routine",
    "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
  },
  "status": "APPROVED",
  "status_reason": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.",
  "decided_at_utc": "2026-09-21T07:41:40Z",
  "decided_by": "Chris (operator)",
  "decision_note": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.",
  "expires_at_utc": null,
  "execution_state": "NOT_EXECUTED",
  "execution_allowed_by_this_routine": false
}
```


## 6. R2 — zero automated earning/withdrawal action, read-only transport

### 6.1 The static checker is unaffected by the flight

### verify_readonly.py — the static R2 check

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python monitoring/freecash/verify_readonly.py
```

Raw output (`transcript/step00_verify_readonly_before.txt`):

```text
[verify_readonly] scanning: D:\AgenticOS\monitoring\freecash
  EXEMPT    [earning-action] D:\AgenticOS\monitoring\freecash\approval_queue.py:52
  EXEMPT    [write-call-shape] D:\AgenticOS\monitoring\freecash\readonly_client.py:34
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:42
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:46
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:47
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:48
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:49
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:51
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:59
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:60
  EXEMPT    [earning-action] D:\AgenticOS\monitoring\freecash\verify_readonly.py:67
  EXEMPT    [earning-action] D:\AgenticOS\monitoring\freecash\verify_readonly.py:68
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:75
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:76
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\verify_readonly.py:76
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:77
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\verify_readonly.py:77
  EXEMPT    [account-mutation] D:\AgenticOS\monitoring\freecash\verify_readonly.py:84
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [write-call-shape] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:148
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:150
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:156
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:166
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:166
  EXEMPT    [write-call-shape] D:\AgenticOS\monitoring\freecash\tests\test_r4_approval.py:283
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
```


### verify_readonly.py re-run at the end of the flight
Both captures: `forbidden=0 exempt=28 missing_targets=0`, exit 0, PASS — the setup-time run and the end-of-flight run print the identical verdict line, and §9 shows the scanned source tree is byte-unchanged. The exemption count is unchanged, so the flight added no forbidden token anywhere in the scanned tree.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python monitoring/freecash/verify_readonly.py
```

Raw output (`transcript/step23_verify_readonly_final.txt`):

```text
[verify_readonly] scanning: D:\AgenticOS\monitoring\freecash
  EXEMPT    [earning-action] D:\AgenticOS\monitoring\freecash\approval_queue.py:52
  EXEMPT    [write-call-shape] D:\AgenticOS\monitoring\freecash\readonly_client.py:34
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:42
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:46
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:47
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:48
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:49
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:51
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:59
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:60
  EXEMPT    [earning-action] D:\AgenticOS\monitoring\freecash\verify_readonly.py:67
  EXEMPT    [earning-action] D:\AgenticOS\monitoring\freecash\verify_readonly.py:68
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:75
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:76
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\verify_readonly.py:76
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\verify_readonly.py:77
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\verify_readonly.py:77
  EXEMPT    [account-mutation] D:\AgenticOS\monitoring\freecash\verify_readonly.py:84
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [write-call-shape] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:27
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:148
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:150
  EXEMPT    [http-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:156
  EXEMPT    [earning-verb] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:166
  EXEMPT    [write-endpoint-path] D:\AgenticOS\monitoring\freecash\tests\test_r2_readonly.py:166
  EXEMPT    [write-call-shape] D:\AgenticOS\monitoring\freecash\tests\test_r4_approval.py:283
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
```


### 6.2 No network egress on any `operator_state` run — measured, not asserted

Every launch printed `AUDIT socket_events=N`, counted by a process-wide
`sys.addaudithook` over `socket.*` events:

| run | day | `socket_events` |
| --- | --- | --- |
| day 1 (baseline) | 2026-09-19 | 0 |
| day 2 (earnings change) | 2026-09-20 | 0 |
| day 2 duplicate #2 | 2026-09-20 | 0 |
| day 2 duplicate #3 | 2026-09-20 | 0 |
| day 3 (status change) | 2026-09-21 | 0 |
| day 4 (two changes) | 2026-09-22 | 0 |
| race, 2 children | 2026-09-23 | 0, 0 |
| day 8 (+100 cents) | 2026-09-26 | 0 |
| day 8 tampered re-run | 2026-09-26 | 0 |
| `--force-recheck` refusal | 2026-09-27 | 0 |
| race, 5 children | 2026-09-27 | 0, 0, 0, 0, 0 |
| run after the approval | 2026-09-28 | 0 |
| unreachable `metrics_http` | 2026-09-24 | **3** (`socket.__new__`, `socket.getaddrinfo`, `socket.connect`) |
| non-loopback `metrics_http` | 2026-09-25 | **0** (refused before any socket) |

The read source is the local operator file, so its snapshot records
`"read_ops": []` — the same value in `snapshots/2026-09-19.json` and
`snapshots/2026-09-20.json` quoted in Appendix A.

### 6.3 Degradation instead of silent success when the read cannot happen

### Unreachable base URL: `--source metrics_http --base-url http://127.0.0.1:59999`
The host and path *are* allowlisted, so the guard lets it reach the single socket site: 3 socket events, connection refused, `RUN_FAILED`, **exit 5**. The day lock stays consumed (no automatic re-run), the ledger keeps `last_success_day=2026-09-23`, and one `RUN_FAILED` alert plus (next day) one `MISSED_DAY` alert were written. No silent success, no invented numbers.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ SIM_NOW=2026-09-24T09:00:00Z python sim_run.py --source metrics_http --base-url http://127.0.0.1:59999
```

Raw output (`transcript/step14_metrics_unreachable.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-24T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-24 pid=27052
RUN_FAILED 2026-09-24 reason=ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte
[sim_run] exit=5
[sim_run] AUDIT socket_events=3 all_events=404
[sim_run] AUDIT socket event names=['socket.__new__', 'socket.connect', 'socket.getaddrinfo']
```


### Non-loopback host: `--source metrics_http --base-url https://example.com`
`RUN_FAILED reason=ForbiddenWriteError: R2: host not allowlisted: 'example.com'`, exit 5, and **0 socket events**: the refusal happens before `_transport` is ever reached.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ SIM_NOW=2026-09-25T09:00:00Z python sim_run.py --source metrics_http --base-url https://example.com
```

Raw output (`transcript/step15_metrics_nonloopback.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-25T09:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-25 pid=27120
RUN_FAILED 2026-09-25 reason=ForbiddenWriteError: R2: host not allowlisted: 'example.com'
[sim_run] exit=5
[sim_run] AUDIT socket_events=0 all_events=423
```


### Rule summary after the two failed read days
Note the ledger: `last_success_day=2026-09-23` while `last_attempt_day=2026-09-25` — a failed read leaves the day **uncovered**, and the next run reported it as `MISSED_DAY` (1 line) instead of back-filling it.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python check.py "$FREECASH_DATA_ROOT" "after the two network-degradation days"
```

Raw output (`transcript/step15b_check_after_network.txt`):

```text
--- CHECK after the two network-degradation days (C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846) ---
R1 day-locks (7): 2026-09-19.lock, 2026-09-20.lock, 2026-09-21.lock, 2026-09-22.lock, 2026-09-23.lock, 2026-09-24.lock, 2026-09-25.lock
R3 snapshots (5): 2026-09-19.json, 2026-09-20.json, 2026-09-21.json, 2026-09-22.json, 2026-09-23.json
R3 alerts.jsonl lines=16 event_types={'APPROVAL_PENDING': 4, 'EARNINGS_CHANGED': 2, 'INITIAL_BASELINE': 1, 'MISSED_DAY': 1, 'OK_NO_CHANGE': 1, 'RUN_FAILED': 2, 'SKIP_DUPLICATE_DAY': 3, 'STATUS_CHANGED': 2}
R3 notified-keys=7 deliveries={'STUB_OK': 7}
R4 approval items=4
R4   432aed66-f285-4bf2-bcca-046db665caa4 status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-20
R4   15a7d637-5694-44b2-b4eb-c1e6638e358c status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-21
R4   eeb354d1-010c-4d7b-a138-98f28b19e2b7 status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-22
R4   95931e50-52bd-4884-bf81-d49cc3640ade status=PENDING  exec=NOT_EXECUTED allowed=False expires=None day=2026-09-22
R4 decided.jsonl lines=0
R1 ledger last_attempt_day=2026-09-25 last_success_day=2026-09-23 last_outcome=READ_FAILED missed=1 tz=Europe/Berlin
--- END CHECK after the two network-degradation days ---
```


## 7. Duplicate-day refusal, tamper, and forced re-check

### 7.1 The duplicate-day refusal output (raw)

```text
SKIP_DUPLICATE_DAY 2026-09-20        # duplicate #2, sim time 2026-09-20T15:30:00Z
SKIP_DUPLICATE_DAY 2026-09-20        # duplicate #3, sim time 2026-09-20T20:00:00Z
```
plus the alert line the refusal writes (`event_type=SKIP_DUPLICATE_DAY`, severity
`info`, `dedupe_key: null`), quoted in Appendix A.

### 7.2 Tamper check — what happens if the day-lock is deleted?

The lock is the day's consumption record. Deleting it is outside the routine's
control, so this is the one integrity question worth answering explicitly.

### Day 8 first run (a real change), then delete the lock and run the same day again

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python set_record.py "$FREECASH_DATA_ROOT" 2026-09-26 2026-09-26T06:40:00Z ACTIVE 1600 1600 0 USD
SIM_NOW=2026-09-26T09:00:00Z python sim_run.py                 # normal run
python hash_tree.py "$FREECASH_DATA_ROOT" > before.txt
python -c "print(open(r'$FREECASH_DATA_ROOT/state/last-run.json').read())"
python -c "import os;print(sorted(os.listdir(r'$FREECASH_DATA_ROOT/state/day-locks')))"
rm "$FREECASH_DATA_ROOT/state/day-locks/2026-09-26.lock"       # TAMPER (temp root only)
python -c "import os;print(sorted(os.listdir(r'$FREECASH_DATA_ROOT/state/day-locks')))"
SIM_NOW=2026-09-26T14:00:00Z python sim_run.py                 # same day again
python hash_tree.py "$FREECASH_DATA_ROOT" > after.txt
diff -u before.txt after.txt
```

Raw output (`transcript/step17_diff_tamper.txt`):

```text
--- diff of the entire state root across the tampered re-run ---
--- C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846/transcript/step17_hashes_before_tamper.txt	2026-09-21 09:41:02.512304900 +0200
+++ C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-scratch-20260921-093846/transcript/step17_hashes_after_tamper.txt	2026-09-21 09:41:03.254943000 +0200
@@ -1,4 +1,4 @@
-029d1606e1bc8456755098e189f663147b2750561aff84dd86eb6c763ee46c74     13157  alerts\alerts.jsonl
+a6fb60b1463848826ead3fb7856494bad5487f86dbe7c66a94a7323dba0dc22d     13873  alerts\alerts.jsonl
 2b85ca35192299e8970660ad6a7a767472cfaa652de125f6b7d3fbc287460f53      4538  approvals\pending.json
 8f0c4e238b43f874dab61cdf0e36de956c2bf8ce682b76a4d25c349b5be560be      4131  logs\toast-stub.log
 b179b0e163fc5b89780d897c821563b4fa66e9b8012bf5557a068004167da8d7       493  snapshots\2026-09-19.json
@@ -15,6 +15,6 @@
 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855         0  state\day-locks\2026-09-24.lock
 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855         0  state\day-locks\2026-09-25.lock
 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855         0  state\day-locks\2026-09-26.lock
-fd6d19fb2c00266cf8a9171f9576fc2a68fea1d4ab387ced86caabd9c66fa1b8       341  state\last-run.json
+d9c8d67bb1ec3da9dc25e085239602b28f5e0121ab2fd996bd021e1610428bb5       341  state\last-run.json
 b819869b18cd5719b7685ec7ce492974e974a2138f8c98c47414dcaca2554118      2162  state\notified-keys.json
 7b7c286da7ee5280896ff3bc2f12e3dd77901d2a16508d4ebb52585e14fc6787      2327  state\operator-state.json
diff_exit=1
```


**Routine behaviour: it RE-RUNS (it does not refuse), but it cannot re-notify.**

```text
RUN_OK 2026-09-26 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True)
       snapshot=2026-09-26.json written=False changes=1 notifications=0 approvals=0
       reminders=0 lock=2026-09-26.lock
```

What that means, precisely:

* **R1 was defeated by the tamper.** The lock is R1's only gate, so with the lock
  gone the routine acquired it again and performed a **second status read on the
  same day**. There is no in-routine tamper detector: `gate.record_attempt()`
  does not compare the ledger's `last_attempt_day` against the day being run, so
  nothing objects. The whole-root diff confirms exactly two files changed:
  `alerts/alerts.jsonl` (one more `EARNINGS_CHANGED` line, `already_notified:
  true`, log-only) and `state/last-run.json` (`last_attempt_at_utc` re-stamped
  `09:00:00Z → 14:00:00Z`).
* **R3 held anyway.** `written=False` (the snapshot is immutable), and
  `notifications=0` because the dedupe key `sha256(day|type|field|old|new)` was
  already in `notified-keys.json`. So the tamper can produce a duplicate *read*
  and a duplicate *log line*, but never a duplicate notification, and never a
  rewritten snapshot.
* This is a **residual weakness worth recording**: R1's guarantee is exactly as
  strong as the lock file's presence on disk. An operator-visible tamper alarm
  does not exist.

### 7.3 The audited forced re-check path

### `--force-recheck --reason` (a human asking for a second read of the same day)
The flag is accepted **only to be refused**, exit 3, and the request itself is written to `logs/forced-recheck-requests.jsonl` as `decision: REFUSED` — so the ask is auditable even though it is never granted. This is the audit line the request asked about: the routine records the *request*, not a tamper event, because the lock is not deleted in this path.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ SIM_NOW=2026-09-27T08:00:00Z python sim_run.py --force-recheck \
    --reason "operator wants to re-read after a dashboard refresh"
python -c "print(open(r'$FREECASH_DATA_ROOT/logs/forced-recheck-requests.jsonl').read())"
```

Raw output (`transcript/step18_force_recheck.txt`):

```text
[sim_run] FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/freecash-e2e-rules-20260921-093846
[sim_run] paths.data_root()=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
[sim_run] simulated now=2026-09-27T08:00:00Z tz=Europe/Berlin resolved_tz=zoneinfo day_key=2026-09-27 pid=32280
REFUSED_FORCE_RECHECK 2026-09-27 reason='operator wants to re-read after a dashboard refresh' (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)
[sim_run] exit=3
[sim_run] AUDIT socket_events=0 all_events=354
--- logs/forced-recheck-requests.jsonl ---
{"decision": "REFUSED", "reason": "operator wants to re-read after a dashboard refresh", "requested_day": "2026-09-27", "ts_utc": "2026-09-27T08:00:00Z", "why": "one status read per operator-local calendar day (R1)"}
```


## 8. Every artefact exists — paths, sizes, hashes, and quoted content

```text
| what (rule) | path in the throwaway root | exists | bytes | sha256 |
| --- | --- | --- | --- | --- |
| R1 day-lock, day 2 | `state/day-locks/2026-09-20.lock` | yes | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| R1 day-lock, tampered day 8 (recreated by the re-run) | `state/day-locks/2026-09-26.lock` | yes | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| R1 ledger | `state/last-run.json` | yes | 337 | `4c867e5a03ee7a7940d21533aa665264906c2c725a56c4389e75777ece2d2272` |
| R3 snapshot, day 1 (baseline) | `snapshots/2026-09-19.json` | yes | 493 | `b179b0e163fc5b89780d897c821563b4fa66e9b8012bf5557a068004167da8d7` |
| R3 snapshot, day 2 (earnings change) | `snapshots/2026-09-20.json` | yes | 493 | `15a87f0a4ec749728255d007ce691e0356670dfe688d0f2cc9f147040b04c508` |
| R3 snapshot, day 3 (status change) | `snapshots/2026-09-21.json` | yes | 493 | `1e6918fa841a66cfae98f691d1ff7aa26c31abf56077f12047cefb2c55cb23c6` |
| R3 snapshot, day 4 (two changes) | `snapshots/2026-09-22.json` | yes | 493 | `d81a7909b4748a5d666719db5db05ddbaccbc93a28ea543d3b2c1a52e1e194f7` |
| R3 dedupe index | `state/notified-keys.json` | yes | 2586 | `f12cc56b0bf49eabcdf0b0d32bf2b498fd1d25e9bd5e52194fcfeecf9011000b` |
| R3 alert ledger | `alerts/alerts.jsonl` | yes | 17673 | `a041ce9453b6fd63845353fa07f0ffb435381d6262e18f1f0c88fac6e02b43b8` |
| R4 approval queue | `approvals/pending.json` | yes | 4749 | `b610f8b7ad0fba0552e2a08ecff5cfc5da1a4e209252bc27f40f460908426c08` |
| R4 decision trail | `approvals/decided.jsonl` | yes | 726 | `dc4ca3dc83f8048340966bc6ea72b1317a72c97659d575538e71ecc68b906425` |
| R1/R2 audit, forced re-check requests | `logs/forced-recheck-requests.jsonl` | yes | 218 | `f18e7ba1b9293dcd6f117689171d115d169764c417cf509987c9cdd463d66073` |
| R3 delivery log (offline stub) | `logs/toast-stub.log` | yes | 5271 | `7e03ac4bcc4364057a864b0741e703de5f8119541f6def1115e67c1b9d42e376` |
| read source (operator-entered figures) | `state/operator-state.json` | yes | 2809 | `5aa6d257c17d4598e9b500de26d7d2cedde9e6bddc2c2966494fcf29364ea47a` |
```

### 8.1 The day-lock (R1) — content quoted

### Day-lock `2026-09-20.lock` — zero bytes; presence alone consumes the day

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\state\day-locks\2026-09-20.lock`  (0 bytes, sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)

```text
<zero bytes: the day lock consumes the day by its presence alone>
```


### Ledger `state/last-run.json` (R1 coverage + missed-day arithmetic)

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\state\last-run.json`  (337 bytes, sha256 `4c867e5a03ee7a7940d21533aa665264906c2c725a56c4389e75777ece2d2272`)

```text
{
  "schema_version": 1,
  "last_attempt_day": "2026-09-28",
  "last_success_day": "2026-09-28",
  "last_attempt_at_utc": "2026-09-28T09:00:00Z",
  "last_success_at_utc": "2026-09-28T09:00:00Z",
  "last_outcome": "OK_NO_CHANGE",
  "consecutive_missed_days": 0,
  "timezone": "Europe/Berlin",
  "updated_at_utc": "2026-09-28T09:00:00Z"
}
```


### Snapshot `snapshots/2026-09-19.json` (day 1, baseline, `read_ops: []`)

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\snapshots\2026-09-19.json`  (493 bytes, sha256 `b179b0e163fc5b89780d897c821563b4fa66e9b8012bf5557a068004167da8d7`)

```text
{
  "schema_version": 1,
  "day_key": "2026-09-19",
  "captured_at_utc": "2026-09-19T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-19"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1340,
  "balance_cents": 1340,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "3f69b55b98369e486eab900aa851c2129f08bf5bd8c2ad1aad68eb115bc566e1"
}
```


### Snapshot `snapshots/2026-09-20.json` (day 2, the change)

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\snapshots\2026-09-20.json`  (493 bytes, sha256 `15a87f0a4ec749728255d007ce691e0356670dfe688d0f2cc9f147040b04c508`)

```text
{
  "schema_version": 1,
  "day_key": "2026-09-20",
  "captured_at_utc": "2026-09-20T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-20"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1465,
  "balance_cents": 1465,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "991ba6aee3af0f1d9e0451c8aa0a3a3f5359ec973dfe550b6697271a19a97a92"
}
```


### 8.2 The alert ledger (R3) — full content, 29 lines

### `alerts/alerts.jsonl` — the canonical evidence record (append-only)

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\alerts\alerts.jsonl`  (17673 bytes, sha256 `a041ce9453b6fd63845353fa07f0ffb435381d6262e18f1f0c88fac6e02b43b8`)

```text
{"day_key": "2026-09-19", "dedupe_key": null, "event_id": "0a2de6ff-3398-4e55-94aa-9aa92b0a2df7", "event_type": "INITIAL_BASELINE", "message": "First run: baseline recorded for 2026-09-19. No notification sent. Source DEGRADED (operator-entered record for 2026-09-19).", "observed": {"account_status": "ACTIVE", "balance_cents": 1340, "degraded": true, "earnings_total_cents": 1340, "pending_cents": 0, "prior_day_key": null, "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-19T09:00:00Z"}
{"day_key": "2026-09-20", "dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "event_id": "fe3b61d1-a9b6-46cc-be2f-3ae828872718", "event_type": "APPROVAL_PENDING", "message": "Approval item 432aed66-f285-4bf2-bcca-046db665caa4 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-20T09:00:00Z"}
{"day_key": "2026-09-20", "dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "event_id": "f97ab83c-5bb7-4969-9a80-9c6eddd7dc7f", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-20\nEarnings:  $13.40 -> $14.65  (+$1.25)\nBalance:   $14.65 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-20)\nDetail:    alerts.jsonl dedupe=2efb946ed0a52059\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  432aed66-f285-4bf2-bcca-046db665caa4 (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1465, "old_value": 1340, "prior_day_key": "2026-09-19"}, "severity": "notify", "ts_utc": "2026-09-20T09:00:00Z"}
{"day_key": "2026-09-20", "dedupe_key": null, "event_id": "d3652338-d28f-46d3-9593-a734db664d55", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-20.lock"}, "severity": "info", "ts_utc": "2026-09-20T15:30:00Z"}
{"day_key": "2026-09-20", "dedupe_key": null, "event_id": "fd986a12-cde8-41e2-907b-f73e705aea2e", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-20.lock"}, "severity": "info", "ts_utc": "2026-09-20T20:00:00Z"}
{"day_key": "2026-09-21", "dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7", "event_id": "581f90ad-d908-4541-86c8-7a415302c2f0", "event_type": "APPROVAL_PENDING", "message": "Approval item 15a7d637-5694-44b2-b4eb-c1e6638e358c enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "15a7d637-5694-44b2-b4eb-c1e6638e358c", "change_dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-21T09:00:00Z"}
{"day_key": "2026-09-21", "dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7", "event_id": "0420a516-dc77-4abf-8863-025e0954e489", "event_type": "STATUS_CHANGED", "message": "[FreeCash] STATUS CHANGE 2026-09-21\nAccount status: ACTIVE -> PAUSED\nEarnings:  $14.65 (unchanged)  Balance: $14.65 (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-21)\nDetail:    alerts.jsonl dedupe=989f6f8406e200dd\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  15a7d637-5694-44b2-b4eb-c1e6638e358c (PENDING - yours to decide, nothing executes)", "observed": {"field": "account_status", "new_value": "PAUSED", "old_value": "ACTIVE", "prior_day_key": "2026-09-20"}, "severity": "notify", "ts_utc": "2026-09-21T09:00:00Z"}
{"day_key": "2026-09-22", "dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2", "event_id": "694a07ad-fe40-40fa-b1e6-50a65ea06110", "event_type": "APPROVAL_PENDING", "message": "Approval item eeb354d1-010c-4d7b-a138-98f28b19e2b7 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "eeb354d1-010c-4d7b-a138-98f28b19e2b7", "change_dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
{"day_key": "2026-09-22", "dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2", "event_id": "d1bd53b2-96ff-4f59-a395-b79c46fa563e", "event_type": "STATUS_CHANGED", "message": "[FreeCash] STATUS CHANGE 2026-09-22\nAccount status: PAUSED -> ACTIVE\nEarnings:  $15.00 (unchanged)  Balance: $15.00 (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-22)\nDetail:    alerts.jsonl dedupe=e1f54e19fe7ff497\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  eeb354d1-010c-4d7b-a138-98f28b19e2b7 (PENDING - yours to decide, nothing executes)", "observed": {"field": "account_status", "new_value": "ACTIVE", "old_value": "PAUSED", "prior_day_key": "2026-09-21"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
{"day_key": "2026-09-22", "dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708", "event_id": "ee5c25a2-5da2-4a9d-90dc-954522ba5b14", "event_type": "APPROVAL_PENDING", "message": "Approval item 95931e50-52bd-4884-bf81-d49cc3640ade enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "95931e50-52bd-4884-bf81-d49cc3640ade", "change_dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
{"day_key": "2026-09-22", "dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708", "event_id": "366c98a4-f824-4229-b75d-5b95406fa968", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-22\nEarnings:  $14.65 -> $15.00  (+$0.35)\nBalance:   $15.00 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-22)\nDetail:    alerts.jsonl dedupe=ea9eea5bea4f8f4f\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  95931e50-52bd-4884-bf81-d49cc3640ade (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1500, "old_value": 1465, "prior_day_key": "2026-09-21"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
{"day_key": "2026-09-23", "dedupe_key": null, "event_id": "df4e5cff-7720-4bd7-9b4c-33b36e7117be", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-23 already consumed (lock 2026-09-23.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-23.lock"}, "severity": "info", "ts_utc": "2026-09-23T09:00:00Z"}
{"day_key": "2026-09-23", "dedupe_key": null, "event_id": "0480dd12-ed19-49ad-bbe5-c98916f4acbd", "event_type": "OK_NO_CHANGE", "message": "No change vs 2026-09-22. No notification sent. Source DEGRADED (operator-entered record for 2026-09-23).", "observed": {"account_status": "ACTIVE", "balance_cents": 1500, "degraded": true, "earnings_total_cents": 1500, "pending_cents": 0, "prior_day_key": "2026-09-22", "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-23T09:00:00Z"}
{"day_key": "2026-09-24", "dedupe_key": "5c6346c1e9cebf34040ef22eda71f484a4465e0b47e66bff2b839c9439b5c997", "event_id": "abf392ee-7b7b-403c-accb-273016d6eb68", "event_type": "RUN_FAILED", "message": "[FreeCash] RUN FAILED 2026-09-24\nReason:    ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte\nDay lock:  CONSUMED (no automatic re-run today - R1)\nAttempts:  last_attempt_day=2026-09-24 last_success_day=2026-09-23\nDetail:    alerts.jsonl dedupe=run:2026-09-24\nACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).", "observed": {"field": "read", "new_value": "ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte", "old_value": "metrics_http", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-24T09:00:00Z"}
{"day_key": "2026-09-25", "dedupe_key": "247e56a10af4f92ed066dcdbaf57265db70c084180a0a11380dc1a433c439679", "event_id": "f5f090b5-f643-49b0-a37c-d78ec53c0f48", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-24\nNo successful status check recorded for 2026-09-24.\nLast success: 2026-09-23. consecutive_missed_days=1\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_success_day", "new_value": "2026-09-23", "old_value": "2026-09-24", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-25T09:00:00Z"}
{"day_key": "2026-09-25", "dedupe_key": "bdcdf44031ff9539d4dc8c77918ca95b983e9a18da30294605729464454d4d63", "event_id": "013d53df-17d9-483f-8a3a-74f65ca03743", "event_type": "RUN_FAILED", "message": "[FreeCash] RUN FAILED 2026-09-25\nReason:    ForbiddenWriteError: R2: host not allowlisted: 'example.com'\nDay lock:  CONSUMED (no automatic re-run today - R1)\nAttempts:  last_attempt_day=2026-09-25 last_success_day=2026-09-23\nDetail:    alerts.jsonl dedupe=run:2026-09-25\nACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).", "observed": {"field": "read", "new_value": "ForbiddenWriteError: R2: host not allowlisted: 'example.com'", "old_value": "metrics_http", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-25T09:00:00Z"}
{"day_key": "2026-09-26", "dedupe_key": "ebb32495017bdaabed0b08f267b2dc57d097f23e250720c992322c5de9920f34", "event_id": "b0ea7319-e12a-4c9a-9764-64773a3b7233", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-24\nNo successful status check recorded for 2026-09-24.\nLast success: 2026-09-23. consecutive_missed_days=2\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_success_day", "new_value": "2026-09-23", "old_value": "2026-09-24", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-26T09:00:00Z"}
{"day_key": "2026-09-26", "dedupe_key": "9d1d28f3aab68733a87e841f74ee80da8a73b0cf9f2bcef32797f68d75d94143", "event_id": "a8f3f27f-eb33-453a-8a30-e25366039957", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-25\nNo successful status check recorded for 2026-09-25.\nLast success: 2026-09-23. consecutive_missed_days=2\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_success_day", "new_value": "2026-09-23", "old_value": "2026-09-25", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-26T09:00:00Z"}
{"day_key": "2026-09-26", "dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "event_id": "56117e8f-1fa2-4f0e-be45-63a160382f1f", "event_type": "APPROVAL_PENDING", "message": "Approval item 56b49c66-8ee6-40c0-87eb-cd5d84501f56 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "56b49c66-8ee6-40c0-87eb-cd5d84501f56", "change_dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-26T09:00:00Z"}
{"day_key": "2026-09-26", "dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "event_id": "c288141c-4d62-478a-a596-d3424b40d606", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-26\nEarnings:  $15.00 -> $16.00  (+$1.00)\nBalance:   $16.00 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-26)\nDetail:    alerts.jsonl dedupe=7db3227236ffd825\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  56b49c66-8ee6-40c0-87eb-cd5d84501f56 (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1600, "old_value": 1500, "prior_day_key": "2026-09-23"}, "severity": "notify", "ts_utc": "2026-09-26T09:00:00Z"}
{"day_key": "2026-09-26", "dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "event_id": "f22e6216-b97f-482f-aca5-507b096f3d78", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-26\nEarnings:  $15.00 -> $16.00  (+$1.00)\nBalance:   $16.00 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-26)\nDetail:    alerts.jsonl dedupe=7db3227236ffd825\nACTION:    No action taken. Review and approve anything you want done.", "observed": {"already_notified": true, "field": "earnings_total_cents", "new_value": 1600, "old_value": 1500}, "severity": "info", "ts_utc": "2026-09-26T14:00:00Z"}
{"day_key": "2026-09-27", "dedupe_key": null, "event_id": "445f73b8-1a40-4b0c-a067-c670abd5659e", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
{"day_key": "2026-09-27", "dedupe_key": null, "event_id": "566a8f65-1a4d-45f9-96bf-386b1bb16505", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
{"day_key": "2026-09-27", "dedupe_key": null, "event_id": "56e06883-a676-4707-8038-4ebab64ab1ab", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
{"day_key": "2026-09-27", "dedupe_key": null, "event_id": "2eb27eb7-e49f-45cd-84e4-e86c602f6769", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
{"day_key": "2026-09-27", "dedupe_key": null, "event_id": "6c546268-e40c-42e0-a9f0-ffa8a38020c5", "event_type": "OK_NO_CHANGE", "message": "No change vs 2026-09-26. No notification sent. Source DEGRADED (operator-entered record for 2026-09-27).", "observed": {"account_status": "ACTIVE", "balance_cents": 1600, "degraded": true, "earnings_total_cents": 1600, "pending_cents": 0, "prior_day_key": "2026-09-26", "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
{"day_key": "2026-09-27", "dedupe_key": "7b8eee506df5e22632097e9fba326d4fd0818243d79a5975e8e5f25e094d07bc", "event_id": "6a9ad616-90dd-4724-b28b-a29dbda19869", "event_type": "APPROVAL_PENDING", "message": "Reminder: approval item 432aed66-f285-4bf2-bcca-046db665caa4 has been waiting since 2026-09-20T09:00:00Z (still PENDING, no expiry).", "observed": {"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "reminder": true, "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-27T09:00:00Z"}
{"day_key": "2026-09-28", "dedupe_key": null, "event_id": "a3ea5b4d-3c32-48b7-9410-512e1f66d787", "event_type": "OK_NO_CHANGE", "message": "No change vs 2026-09-27. No notification sent. Source DEGRADED (operator-entered record for 2026-09-28).", "observed": {"account_status": "ACTIVE", "balance_cents": 1600, "degraded": true, "earnings_total_cents": 1600, "pending_cents": 0, "prior_day_key": "2026-09-27", "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-28T09:00:00Z"}
{"day_key": "2026-09-28", "dedupe_key": "034badf79d3118c691590365e45f6669c726a2691b04f56724ab07d1cbfefb56", "event_id": "17055db5-28e3-4317-adcb-1b86465f6dee", "event_type": "APPROVAL_PENDING", "message": "Reminder: approval item 15a7d637-5694-44b2-b4eb-c1e6638e358c has been waiting since 2026-09-21T09:00:00Z (still PENDING, no expiry).", "observed": {"approval_id": "15a7d637-5694-44b2-b4eb-c1e6638e358c", "reminder": true, "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-28T09:00:00Z"}
```


### 8.3 The approval queue (R4) — full content

### `approvals/pending.json` — five items, all `NOT_EXECUTED`, none with an expiry

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\approvals\pending.json`  (4749 bytes, sha256 `b610f8b7ad0fba0552e2a08ecff5cfc5da1a4e209252bc27f40f460908426c08`)

```text
{
  "schema_version": 1,
  "updated_at_utc": "2026-09-21T07:41:40Z",
  "items": [
    {
      "approval_id": "432aed66-f285-4bf2-bcca-046db665caa4",
      "created_at_utc": "2026-09-20T09:00:00Z",
      "day_key": "2026-09-20",
      "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb",
      "reason": "earnings_total_cents moved from $13.40 to $14.65. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 1465,
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "APPROVED",
      "status_reason": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.",
      "decided_at_utc": "2026-09-21T07:41:40Z",
      "decided_by": "Chris (operator)",
      "decision_note": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.",
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "15a7d637-5694-44b2-b4eb-c1e6638e358c",
      "created_at_utc": "2026-09-21T09:00:00Z",
      "day_key": "2026-09-21",
      "change_dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7",
      "reason": "Account status moved from ACTIVE to PAUSED. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": "PAUSED",
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "eeb354d1-010c-4d7b-a138-98f28b19e2b7",
      "created_at_utc": "2026-09-22T09:00:00Z",
      "day_key": "2026-09-22",
      "change_dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2",
      "reason": "Account status moved from PAUSED to ACTIVE. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": "ACTIVE",
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "95931e50-52bd-4884-bf81-d49cc3640ade",
      "created_at_utc": "2026-09-22T09:00:00Z",
      "day_key": "2026-09-22",
      "change_dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708",
      "reason": "earnings_total_cents moved from $14.65 to $15.00. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 1500,
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "56b49c66-8ee6-40c0-87eb-cd5d84501f56",
      "created_at_utc": "2026-09-26T09:00:00Z",
      "day_key": "2026-09-26",
      "change_dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02",
      "reason": "earnings_total_cents moved from $15.00 to $16.00. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 1600,
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    }
  ]
}
```


### `approvals/decided.jsonl` — the human decision, append-only

`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846\approvals\decided.jsonl`  (726 bytes, sha256 `dc4ca3dc83f8048340966bc6ea72b1317a72c97659d575538e71ecc68b906425`)

```text
{"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "day_key": "2026-09-20", "decided_at_utc": "2026-09-21T07:41:40Z", "decided_by": "Chris (operator)", "decision": "APPROVED", "decision_note": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.", "execution_allowed_by_this_routine": false, "execution_state": "NOT_EXECUTED", "expires_at_utc": null, "proposed_action": {"action_type": "REQUEST_PAYOUT", "amount_cents": 1465, "destination": "OPERATOR_SPECIFIED - not stored by the routine", "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"}, "schema_version": 1}
```


## 9. Nothing outside the throwaway root was written

`paths.data_root()` printed by every single run was
`C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`
(quoted in every transcript above); `FREECASH_DATA_ROOT` was exported for every
command, including the `approval_queue.py` CLI and all evidence readers.

Two read-only listings prove the two trees the flight must not have touched:

### Routine sources — every mtime predates the flight (last write 2026-09-20T04:59:58Z)
No `.py` in the package was modified: the newest is `watchdog.py` at 2026-09-20T04:59:58Z, ~28 hours before this flight started.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python list_tree.py D:/AgenticOS/monitoring/freecash "*.py"
```

Raw output (`transcript/step21_routine_sources.txt`):

```text
listing D:\AgenticOS\monitoring\freecash (17 files, pattern='*.py')
  mtime_utc=2026-09-20T04:57:40Z  size=   10914  sha256=0a2c982fbcfb9ca4f3371c309e308046f37976ccdb6b54e587912790fd42d506  approval_queue.py
  mtime_utc=2026-09-20T04:59:46Z  size=   11983  sha256=296c65aaf0be395d391ff3cb5ec92bcc1c83b191f7c3cf73377a36ff5773786b  changedetect.py
  mtime_utc=2026-09-18T05:32:28Z  size=    7983  sha256=1c726b27e0f6d577c28454e66530d297925fd83d23de2313a3c15d13120608e7  gate.py
  mtime_utc=2026-09-20T04:57:46Z  size=   15479  sha256=9bfca8cddfdea913353e7a27bb6bb9d0c17f5959c3ca11935954a0c445abcb22  notify.py
  mtime_utc=2026-09-18T05:26:12Z  size=    4942  sha256=32f0fd7201e0f2179c434d67fb48bffe14e3adf54a69d603d4436f8c3cd1d4a7  operator_state.py
  mtime_utc=2026-09-18T05:31:20Z  size=    6429  sha256=a38ab2e73d25d88fb0512b6e42d2877465f5a2329a73c5973999e77fc0ef1938  paths.py
  mtime_utc=2026-09-18T05:25:45Z  size=    8847  sha256=5426b56c11d20fbe65aa197a4f11660536e6371d585c31f827914d2930aecc27  readonly_client.py
  mtime_utc=2026-09-20T04:57:40Z  size=   18977  sha256=bda54e7d56d31f2eb7d70ae1fb5697ef4e08693060fbd2ee5c6b81327487a54c  run_daily_check.py
  mtime_utc=2026-09-18T05:31:34Z  size=    9083  sha256=1995e415000f17ba875dbb0d26e37537a2546e2d36aa3d6781926a5228ebeef4  tests\_support.py
  mtime_utc=2026-09-18T05:31:40Z  size=    1032  sha256=f886d4bfa5476c7c2e91e88374b8f10f4e3c99c2d47814b8f94db04b900e1c0a  tests\run_all.py
  mtime_utc=2026-09-20T04:57:55Z  size=    8126  sha256=e5d30e603f1baadd960d24401e8da35a862dcb0e8ab4398bb142127686679065  tests\test_r1_gate.py
  mtime_utc=2026-09-18T05:29:57Z  size=   12578  sha256=b88ae7f901124a5c7e10c30137fce68f679c5173aba1c0d8afa15ad3437e2d95  tests\test_r2_readonly.py
  mtime_utc=2026-09-18T05:30:20Z  size=   10144  sha256=7c5293f7ca7366d6c691c596336fc15816db56fe1863c56ce6eae5f3c445b819  tests\test_r3_changedetect.py
  mtime_utc=2026-09-20T04:57:46Z  size=   12348  sha256=8ad866e65867c7bf10c1ceb268767c53c53d57baef4cf298ce15a4cca39d2bc1  tests\test_r4_approval.py
  mtime_utc=2026-09-18T05:31:15Z  size=    7710  sha256=780a2fd2d02ddc603e4358d5a7e1d20b1c9aa55b81b437a580f3d70cd109f937  tests\test_r5_smoke.py
  mtime_utc=2026-09-18T05:27:18Z  size=    7856  sha256=2c91a1fc0179a486a07b550cdbc60aa69cafa96641a6a1d3205db7062b590aa0  verify_readonly.py
  mtime_utc=2026-09-20T04:59:58Z  size=    4176  sha256=11dfa88bff930be0886a1006190d72a72da051c8a57515029e9cdfabb7d3acdd  watchdog.py
```


### Real state root `D:/AgenticOS/data/freecash-monitor` — mtimes and hashes
Five files, newest mtime 2026-09-20T19:08:01Z — untouched by this flight. It still holds the degraded history: no `approvals/pending.json` at all, and only `MONITOR_DEGRADED` + `SKIP_DUPLICATE_DAY` in its alert log.

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python list_tree.py D:/AgenticOS/data/freecash-monitor
```

Raw output (`transcript/step22_real_state_root.txt`):

```text
listing D:\AgenticOS\data\freecash-monitor (5 files, pattern='*')
  mtime_utc=2026-09-20T19:08:01Z  size=     992  sha256=18e6539b560e0869ddb3d0e92dc6058f97bffca4a0102443446647ae69ac5976  alerts\alerts.jsonl
  mtime_utc=2026-09-20T19:08:00Z  size=     518  sha256=965e1132078d8739ee445e5c36cdfc9523825c436d59a82d92e38bf71706d6e5  snapshots\2026-09-20.json
  mtime_utc=2026-09-20T19:08:00Z  size=       0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  state\day-locks\2026-09-20.lock
  mtime_utc=2026-09-20T19:08:00Z  size=     341  sha256=5e25ae59115daa369e1cf3f57b8fd118c67cac7d3a70608cd7fd0f7b811b4caf  state\last-run.json
  mtime_utc=2026-09-20T19:08:00Z  size=     879  sha256=be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c  state\operator-state.json
```


The four standalone tests still pass and the static checker is unchanged
(quoted in §6.1 and Appendix C): `run_all: tests=52 failures=0 errors=0
skipped=0`, `[verify_readonly] forbidden=0 exempt=28 missing_targets=0`, PASS.
No test was deleted, weakened or skipped.

**One incidental, pre-existing side effect of *any* import of the package**:
`D:/AgenticOS/monitoring/freecash/__pycache__/` (a directory that already existed
and is regenerated by the routine's own `tests/run_all.py`) may have its `.pyc`
files refreshed. No source file, state file or config in the repo was created,
edited, moved or deleted by this flight.

## 10. Verdict: which rules are now proven on REAL input

| rule | proven on real input by this flight? | the artefact / output that proves it | still only unit-test coverage |
| --- | --- | --- | --- |
| **R1** exactly one status read per operator-local calendar day | **YES** (mechanism, refusal and atomicity) | one `.lock` per consumed day for 10 days; `SKIP_DUPLICATE_DAY 2026-09-20` (exit 0); whole-root sha256 diff across a duplicate run showing only `alerts.jsonl` changed; race tallies `RUN_OK=1 SKIP_DUPLICATE_DAY=1` (2 procs) and `RUN_OK=1 SKIP_DUPLICATE_DAY=4` (5 procs); ledger+missed-day arithmetic on the failed-read days | two **real** calendar days (the flight pinned the clock through the routine's documented `now` seam); `prune_old_artifacts()` (skipped whenever `now` is pinned — never exercised here) |
| **R2** zero automated earning/withdrawal action; read-only transport | **YES** | `verify_readonly.py`: `forbidden=0 exempt=28 missing_targets=0` PASS, identical before and after the flight; `AUDIT socket_events=0` on all 14 `operator_state` runs; non-loopback `metrics_http` refused with `socket_events=0`; unreachable loopback read → `RUN_FAILED` exit 5, day left uncovered, no silent success; `"read_ops": []` in both snapshots | the provider read path (W3/W4) — deliberately absent by design (`PROVIDER_ENDPOINT_UNKNOWN`); SMTP channel (opt-in, not wired) |
| **R3** notify exactly once per distinct change | **YES** — this is the first time the path has ever fired | `RUN_OK 2026-09-20 … changes=1 notifications=1 approvals=1` and `RUN_OK 2026-09-21 … changes=1 notifications=1 approvals=1`; `RUN_OK 2026-09-22 … changes=2 notifications=2 approvals=2`; 12 real `STUB_OK` dispatch records in `notified-keys.json`; the `EARNINGS_CHANGED` / `STATUS_CHANGED` / `APPROVAL_PENDING` lines in `alerts.jsonl`; the tampered re-run producing `notifications=0` and `written=False` with `already_notified: true` | the >5-changes coalescing path (max 2 changes occurred); the `DELIVERY_FAILED` two-attempt path (forced in unit tests only); the real OS toast (`TOAST_OK`) |
| **R4** human approval before any external action | **YES** | 5 real queue items, every one `PENDING`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=false`, `expires_at_utc=null`; the `--by`-attributed decision `recorded APPROVED … by Chris (operator)` with `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)`; `decided.jsonl` trail; the machine-identity refusal exit 4; the run after the approval not touching `pending.json`/`decided.jsonl` | the "past expiry" scenario (`expires_at_utc` is structurally always `null`, so it can only be simulated); the 7-day nag is exercised but the 90-day pending-survival path is not |

### Residual weaknesses this flight exposed (nothing here is a rule change — recorded for the operator)

1. **Deleting a day-lock defeats R1** (§7.2). The lock *is* the gate; with it gone
   the routine silently performs a second status read of the same day. R3's dedupe
   still prevents a second notification and the snapshot stays immutable, but the
   "one read per day" promise is only as strong as the file's presence. No tamper
   alarm exists.
2. **`--force-recheck` cannot grant a manual re-read** — it is refused (exit 3) and
   the request is audited. That is the documented design, but it means the *only*
   way an operator can re-read a day is the tampering route in (1), which is
   unlogged. If a manual re-check is ever genuinely wanted, it needs a first-class,
   audited path rather than lock deletion.
3. **The day key depends on `tzdata`.** On this host `Europe/Berlin` resolved as
   `zoneinfo` (`resolved_tz=zoneinfo` in every run). On a host without `tzdata`
   the routine degrades to the system-local zone and reports `MONITOR_DEGRADED`
   — observed historically, not in this flight.
4. **The delivery label is `STUB_OK`, not `TOAST_OK`.** The last centimetre
   (Windows balloon tip) was deliberately not fired, so "the operator sees a
   toast" remains unproven on this host.

## Appendix A — the full final state dump (verbatim)

Produced by `dump_state.py`, which lists every file under the throwaway root with
size and sha256 and prints its exact content.

### Final artefact dump of the throwaway root

Command  (`FREECASH_DATA_ROOT=C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846`):

```bash
$ python dump_state.py "$FREECASH_DATA_ROOT" "FINAL, after every phase"
```

Raw output (`transcript/step24_dump_final.txt`):

```text
==============================================================================
ARTEFACT DUMP FINAL, after every phase
root = C:\Users\cd-pr\AppData\Local\Temp\freecash-e2e-rules-20260921-093846
root exists = True
==============================================================================
directories: alerts, approvals, logs, snapshots, state, state\day-locks
file count = 26
------------------------------------------------------------------------------
FILE alerts\alerts.jsonl  size=17673  sha256=a041ce9453b6fd63845353fa07f0ffb435381d6262e18f1f0c88fac6e02b43b8
  {"day_key": "2026-09-19", "dedupe_key": null, "event_id": "0a2de6ff-3398-4e55-94aa-9aa92b0a2df7", "event_type": "INITIAL_BASELINE", "message": "First run: baseline recorded for 2026-09-19. No notification sent. Source DEGRADED (operator-entered record for 2026-09-19).", "observed": {"account_status": "ACTIVE", "balance_cents": 1340, "degraded": true, "earnings_total_cents": 1340, "pending_cents": 0, "prior_day_key": null, "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-19T09:00:00Z"}
  {"day_key": "2026-09-20", "dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "event_id": "fe3b61d1-a9b6-46cc-be2f-3ae828872718", "event_type": "APPROVAL_PENDING", "message": "Approval item 432aed66-f285-4bf2-bcca-046db665caa4 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-20T09:00:00Z"}
  {"day_key": "2026-09-20", "dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "event_id": "f97ab83c-5bb7-4969-9a80-9c6eddd7dc7f", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-20\nEarnings:  $13.40 -> $14.65  (+$1.25)\nBalance:   $14.65 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-20)\nDetail:    alerts.jsonl dedupe=2efb946ed0a52059\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  432aed66-f285-4bf2-bcca-046db665caa4 (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1465, "old_value": 1340, "prior_day_key": "2026-09-19"}, "severity": "notify", "ts_utc": "2026-09-20T09:00:00Z"}
  {"day_key": "2026-09-20", "dedupe_key": null, "event_id": "d3652338-d28f-46d3-9593-a734db664d55", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-20.lock"}, "severity": "info", "ts_utc": "2026-09-20T15:30:00Z"}
  {"day_key": "2026-09-20", "dedupe_key": null, "event_id": "fd986a12-cde8-41e2-907b-f73e705aea2e", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-20.lock"}, "severity": "info", "ts_utc": "2026-09-20T20:00:00Z"}
  {"day_key": "2026-09-21", "dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7", "event_id": "581f90ad-d908-4541-86c8-7a415302c2f0", "event_type": "APPROVAL_PENDING", "message": "Approval item 15a7d637-5694-44b2-b4eb-c1e6638e358c enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "15a7d637-5694-44b2-b4eb-c1e6638e358c", "change_dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-21T09:00:00Z"}
  {"day_key": "2026-09-21", "dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7", "event_id": "0420a516-dc77-4abf-8863-025e0954e489", "event_type": "STATUS_CHANGED", "message": "[FreeCash] STATUS CHANGE 2026-09-21\nAccount status: ACTIVE -> PAUSED\nEarnings:  $14.65 (unchanged)  Balance: $14.65 (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-21)\nDetail:    alerts.jsonl dedupe=989f6f8406e200dd\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  15a7d637-5694-44b2-b4eb-c1e6638e358c (PENDING - yours to decide, nothing executes)", "observed": {"field": "account_status", "new_value": "PAUSED", "old_value": "ACTIVE", "prior_day_key": "2026-09-20"}, "severity": "notify", "ts_utc": "2026-09-21T09:00:00Z"}
  {"day_key": "2026-09-22", "dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2", "event_id": "694a07ad-fe40-40fa-b1e6-50a65ea06110", "event_type": "APPROVAL_PENDING", "message": "Approval item eeb354d1-010c-4d7b-a138-98f28b19e2b7 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "eeb354d1-010c-4d7b-a138-98f28b19e2b7", "change_dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
  {"day_key": "2026-09-22", "dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2", "event_id": "d1bd53b2-96ff-4f59-a395-b79c46fa563e", "event_type": "STATUS_CHANGED", "message": "[FreeCash] STATUS CHANGE 2026-09-22\nAccount status: PAUSED -> ACTIVE\nEarnings:  $15.00 (unchanged)  Balance: $15.00 (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-22)\nDetail:    alerts.jsonl dedupe=e1f54e19fe7ff497\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  eeb354d1-010c-4d7b-a138-98f28b19e2b7 (PENDING - yours to decide, nothing executes)", "observed": {"field": "account_status", "new_value": "ACTIVE", "old_value": "PAUSED", "prior_day_key": "2026-09-21"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
  {"day_key": "2026-09-22", "dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708", "event_id": "ee5c25a2-5da2-4a9d-90dc-954522ba5b14", "event_type": "APPROVAL_PENDING", "message": "Approval item 95931e50-52bd-4884-bf81-d49cc3640ade enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "95931e50-52bd-4884-bf81-d49cc3640ade", "change_dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
  {"day_key": "2026-09-22", "dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708", "event_id": "366c98a4-f824-4229-b75d-5b95406fa968", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-22\nEarnings:  $14.65 -> $15.00  (+$0.35)\nBalance:   $15.00 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-22)\nDetail:    alerts.jsonl dedupe=ea9eea5bea4f8f4f\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  95931e50-52bd-4884-bf81-d49cc3640ade (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1500, "old_value": 1465, "prior_day_key": "2026-09-21"}, "severity": "notify", "ts_utc": "2026-09-22T09:00:00Z"}
  {"day_key": "2026-09-23", "dedupe_key": null, "event_id": "df4e5cff-7720-4bd7-9b4c-33b36e7117be", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-23 already consumed (lock 2026-09-23.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-23.lock"}, "severity": "info", "ts_utc": "2026-09-23T09:00:00Z"}
  {"day_key": "2026-09-23", "dedupe_key": null, "event_id": "0480dd12-ed19-49ad-bbe5-c98916f4acbd", "event_type": "OK_NO_CHANGE", "message": "No change vs 2026-09-22. No notification sent. Source DEGRADED (operator-entered record for 2026-09-23).", "observed": {"account_status": "ACTIVE", "balance_cents": 1500, "degraded": true, "earnings_total_cents": 1500, "pending_cents": 0, "prior_day_key": "2026-09-22", "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-23T09:00:00Z"}
  {"day_key": "2026-09-24", "dedupe_key": "5c6346c1e9cebf34040ef22eda71f484a4465e0b47e66bff2b839c9439b5c997", "event_id": "abf392ee-7b7b-403c-accb-273016d6eb68", "event_type": "RUN_FAILED", "message": "[FreeCash] RUN FAILED 2026-09-24\nReason:    ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte\nDay lock:  CONSUMED (no automatic re-run today - R1)\nAttempts:  last_attempt_day=2026-09-24 last_success_day=2026-09-23\nDetail:    alerts.jsonl dedupe=run:2026-09-24\nACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).", "observed": {"field": "read", "new_value": "ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte", "old_value": "metrics_http", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-24T09:00:00Z"}
  {"day_key": "2026-09-25", "dedupe_key": "247e56a10af4f92ed066dcdbaf57265db70c084180a0a11380dc1a433c439679", "event_id": "f5f090b5-f643-49b0-a37c-d78ec53c0f48", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-24\nNo successful status check recorded for 2026-09-24.\nLast success: 2026-09-23. consecutive_missed_days=1\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_success_day", "new_value": "2026-09-23", "old_value": "2026-09-24", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-25T09:00:00Z"}
  {"day_key": "2026-09-25", "dedupe_key": "bdcdf44031ff9539d4dc8c77918ca95b983e9a18da30294605729464454d4d63", "event_id": "013d53df-17d9-483f-8a3a-74f65ca03743", "event_type": "RUN_FAILED", "message": "[FreeCash] RUN FAILED 2026-09-25\nReason:    ForbiddenWriteError: R2: host not allowlisted: 'example.com'\nDay lock:  CONSUMED (no automatic re-run today - R1)\nAttempts:  last_attempt_day=2026-09-25 last_success_day=2026-09-23\nDetail:    alerts.jsonl dedupe=run:2026-09-25\nACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).", "observed": {"field": "read", "new_value": "ForbiddenWriteError: R2: host not allowlisted: 'example.com'", "old_value": "metrics_http", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-25T09:00:00Z"}
  {"day_key": "2026-09-26", "dedupe_key": "ebb32495017bdaabed0b08f267b2dc57d097f23e250720c992322c5de9920f34", "event_id": "b0ea7319-e12a-4c9a-9764-64773a3b7233", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-24\nNo successful status check recorded for 2026-09-24.\nLast success: 2026-09-23. consecutive_missed_days=2\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_success_day", "new_value": "2026-09-23", "old_value": "2026-09-24", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-26T09:00:00Z"}
  {"day_key": "2026-09-26", "dedupe_key": "9d1d28f3aab68733a87e841f74ee80da8a73b0cf9f2bcef32797f68d75d94143", "event_id": "a8f3f27f-eb33-453a-8a30-e25366039957", "event_type": "MISSED_DAY", "message": "[FreeCash] MISSED DAY 2026-09-25\nNo successful status check recorded for 2026-09-25.\nLast success: 2026-09-23. consecutive_missed_days=2\nACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).", "observed": {"field": "last_success_day", "new_value": "2026-09-23", "old_value": "2026-09-25", "prior_day_key": "2026-09-23"}, "severity": "alert", "ts_utc": "2026-09-26T09:00:00Z"}
  {"day_key": "2026-09-26", "dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "event_id": "56117e8f-1fa2-4f0e-be45-63a160382f1f", "event_type": "APPROVAL_PENDING", "message": "Approval item 56b49c66-8ee6-40c0-87eb-cd5d84501f56 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "56b49c66-8ee6-40c0-87eb-cd5d84501f56", "change_dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-26T09:00:00Z"}
  {"day_key": "2026-09-26", "dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "event_id": "c288141c-4d62-478a-a596-d3424b40d606", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-26\nEarnings:  $15.00 -> $16.00  (+$1.00)\nBalance:   $16.00 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-26)\nDetail:    alerts.jsonl dedupe=7db3227236ffd825\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  56b49c66-8ee6-40c0-87eb-cd5d84501f56 (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1600, "old_value": 1500, "prior_day_key": "2026-09-23"}, "severity": "notify", "ts_utc": "2026-09-26T09:00:00Z"}
  {"day_key": "2026-09-26", "dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02", "event_id": "f22e6216-b97f-482f-aca5-507b096f3d78", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-09-26\nEarnings:  $15.00 -> $16.00  (+$1.00)\nBalance:   $16.00 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-09-26)\nDetail:    alerts.jsonl dedupe=7db3227236ffd825\nACTION:    No action taken. Review and approve anything you want done.", "observed": {"already_notified": true, "field": "earnings_total_cents", "new_value": 1600, "old_value": 1500}, "severity": "info", "ts_utc": "2026-09-26T14:00:00Z"}
  {"day_key": "2026-09-27", "dedupe_key": null, "event_id": "445f73b8-1a40-4b0c-a067-c670abd5659e", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
  {"day_key": "2026-09-27", "dedupe_key": null, "event_id": "566a8f65-1a4d-45f9-96bf-386b1bb16505", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
  {"day_key": "2026-09-27", "dedupe_key": null, "event_id": "56e06883-a676-4707-8038-4ebab64ab1ab", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
  {"day_key": "2026-09-27", "dedupe_key": null, "event_id": "2eb27eb7-e49f-45cd-84e4-e86c602f6769", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-27 already consumed (lock 2026-09-27.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "C:\\Users\\cd-pr\\AppData\\Local\\Temp\\freecash-e2e-rules-20260921-093846\\state\\day-locks\\2026-09-27.lock"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
  {"day_key": "2026-09-27", "dedupe_key": null, "event_id": "6c546268-e40c-42e0-a9f0-ffa8a38020c5", "event_type": "OK_NO_CHANGE", "message": "No change vs 2026-09-26. No notification sent. Source DEGRADED (operator-entered record for 2026-09-27).", "observed": {"account_status": "ACTIVE", "balance_cents": 1600, "degraded": true, "earnings_total_cents": 1600, "pending_cents": 0, "prior_day_key": "2026-09-26", "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-27T09:00:00Z"}
  {"day_key": "2026-09-27", "dedupe_key": "7b8eee506df5e22632097e9fba326d4fd0818243d79a5975e8e5f25e094d07bc", "event_id": "6a9ad616-90dd-4724-b28b-a29dbda19869", "event_type": "APPROVAL_PENDING", "message": "Reminder: approval item 432aed66-f285-4bf2-bcca-046db665caa4 has been waiting since 2026-09-20T09:00:00Z (still PENDING, no expiry).", "observed": {"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "reminder": true, "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-27T09:00:00Z"}
  {"day_key": "2026-09-28", "dedupe_key": null, "event_id": "a3ea5b4d-3c32-48b7-9410-512e1f66d787", "event_type": "OK_NO_CHANGE", "message": "No change vs 2026-09-27. No notification sent. Source DEGRADED (operator-entered record for 2026-09-28).", "observed": {"account_status": "ACTIVE", "balance_cents": 1600, "degraded": true, "earnings_total_cents": 1600, "pending_cents": 0, "prior_day_key": "2026-09-27", "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-09-28T09:00:00Z"}
  {"day_key": "2026-09-28", "dedupe_key": "034badf79d3118c691590365e45f6669c726a2691b04f56724ab07d1cbfefb56", "event_id": "17055db5-28e3-4317-adcb-1b86465f6dee", "event_type": "APPROVAL_PENDING", "message": "Reminder: approval item 15a7d637-5694-44b2-b4eb-c1e6638e358c has been waiting since 2026-09-21T09:00:00Z (still PENDING, no expiry).", "observed": {"approval_id": "15a7d637-5694-44b2-b4eb-c1e6638e358c", "reminder": true, "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-09-28T09:00:00Z"}
------------------------------------------------------------------------------
FILE approvals\decided.jsonl  size=726  sha256=dc4ca3dc83f8048340966bc6ea72b1317a72c97659d575538e71ecc68b906425
  {"approval_id": "432aed66-f285-4bf2-bcca-046db665caa4", "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb", "day_key": "2026-09-20", "decided_at_utc": "2026-09-21T07:41:40Z", "decided_by": "Chris (operator)", "decision": "APPROVED", "decision_note": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.", "execution_allowed_by_this_routine": false, "execution_state": "NOT_EXECUTED", "expires_at_utc": null, "proposed_action": {"action_type": "REQUEST_PAYOUT", "amount_cents": 1465, "destination": "OPERATOR_SPECIFIED - not stored by the routine", "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"}, "schema_version": 1}
------------------------------------------------------------------------------
FILE approvals\pending.json  size=4749  sha256=b610f8b7ad0fba0552e2a08ecff5cfc5da1a4e209252bc27f40f460908426c08
{
  "schema_version": 1,
  "updated_at_utc": "2026-09-21T07:41:40Z",
  "items": [
    {
      "approval_id": "432aed66-f285-4bf2-bcca-046db665caa4",
      "created_at_utc": "2026-09-20T09:00:00Z",
      "day_key": "2026-09-20",
      "change_dedupe_key": "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb",
      "reason": "earnings_total_cents moved from $13.40 to $14.65. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 1465,
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "APPROVED",
      "status_reason": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.",
      "decided_at_utc": "2026-09-21T07:41:40Z",
      "decided_by": "Chris (operator)",
      "decision_note": "Reviewed the +125 cent earnings move; nothing further is wanted, recording the review only.",
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "15a7d637-5694-44b2-b4eb-c1e6638e358c",
      "created_at_utc": "2026-09-21T09:00:00Z",
      "day_key": "2026-09-21",
      "change_dedupe_key": "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7",
      "reason": "Account status moved from ACTIVE to PAUSED. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": "PAUSED",
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "eeb354d1-010c-4d7b-a138-98f28b19e2b7",
      "created_at_utc": "2026-09-22T09:00:00Z",
      "day_key": "2026-09-22",
      "change_dedupe_key": "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2",
      "reason": "Account status moved from PAUSED to ACTIVE. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": "ACTIVE",
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "95931e50-52bd-4884-bf81-d49cc3640ade",
      "created_at_utc": "2026-09-22T09:00:00Z",
      "day_key": "2026-09-22",
      "change_dedupe_key": "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708",
      "reason": "earnings_total_cents moved from $14.65 to $15.00. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 1500,
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    },
    {
      "approval_id": "56b49c66-8ee6-40c0-87eb-cd5d84501f56",
      "created_at_utc": "2026-09-26T09:00:00Z",
      "day_key": "2026-09-26",
      "change_dedupe_key": "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02",
      "reason": "earnings_total_cents moved from $15.00 to $16.00. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 1600,
        "destination": "OPERATOR_SPECIFIED - not stored by the routine",
        "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
      },
      "status": "PENDING",
      "status_reason": null,
      "decided_at_utc": null,
      "decided_by": null,
      "decision_note": null,
      "expires_at_utc": null,
      "execution_state": "NOT_EXECUTED",
      "execution_allowed_by_this_routine": false
    }
  ]
}
------------------------------------------------------------------------------
FILE logs\forced-recheck-requests.jsonl  size=218  sha256=f18e7ba1b9293dcd6f117689171d115d169764c417cf509987c9cdd463d66073
  {"decision": "REFUSED", "reason": "operator wants to re-read after a dashboard refresh", "requested_day": "2026-09-27", "ts_utc": "2026-09-27T08:00:00Z", "why": "one status read per operator-local calendar day (R1)"}
------------------------------------------------------------------------------
FILE logs\toast-stub.log  size=5271  sha256=7e03ac4bcc4364057a864b0741e703de5f8119541f6def1115e67c1b9d42e376
  [STUB TOAST 2026-09-20T09:00:00Z] [FreeCash] EARNINGS CHANGE 2026-09-20 | Earnings:  $13.40 -> $14.65  (+$1.25) | Balance:   $14.65 (changed too) | Pending:   $0.00 | Status:    ACTIVE (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-20) | Detail:    alerts.jsonl dedupe=2efb946ed0a52059 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  432aed66-f285-4bf2-bcca-046db665caa4 (PENDING - yours to decide, nothing executes)
  [STUB TOAST 2026-09-21T09:00:00Z] [FreeCash] STATUS CHANGE 2026-09-21 | Account status: ACTIVE -> PAUSED | Earnings:  $14.65 (unchanged)  Balance: $14.65 (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-21) | Detail:    alerts.jsonl dedupe=989f6f8406e200dd | ACTION:    No action taken. Review and approve anything you want done. | Approval:  15a7d637-5694-44b2-b4eb-c1e6638e358c (PENDING - yours to decide, nothing executes)
  [STUB TOAST 2026-09-22T09:00:00Z] [FreeCash] STATUS CHANGE 2026-09-22 | Account status: PAUSED -> ACTIVE | Earnings:  $15.00 (unchanged)  Balance: $15.00 (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-22) | Detail:    alerts.jsonl dedupe=e1f54e19fe7ff497 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  eeb354d1-010c-4d7b-a138-98f28b19e2b7 (PENDING - yours to decide, nothing executes)
  [STUB TOAST 2026-09-22T09:00:00Z] [FreeCash] EARNINGS CHANGE 2026-09-22 | Earnings:  $14.65 -> $15.00  (+$0.35) | Balance:   $15.00 (changed too) | Pending:   $0.00 | Status:    ACTIVE (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-22) | Detail:    alerts.jsonl dedupe=ea9eea5bea4f8f4f | ACTION:    No action taken. Review and approve anything you want done. | Approval:  95931e50-52bd-4884-bf81-d49cc3640ade (PENDING - yours to decide, nothing executes)
  [STUB TOAST 2026-09-24T09:00:00Z] [FreeCash] RUN FAILED 2026-09-24 | Reason:    ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte | Day lock:  CONSUMED (no automatic re-run today - R1) | Attempts:  last_attempt_day=2026-09-24 last_success_day=2026-09-23 | Detail:    alerts.jsonl dedupe=run:2026-09-24 | ACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).
  [STUB TOAST 2026-09-25T09:00:00Z] [FreeCash] MISSED DAY 2026-09-24 | No successful status check recorded for 2026-09-24. | Last success: 2026-09-23. consecutive_missed_days=1 | ACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).
  [STUB TOAST 2026-09-25T09:00:00Z] [FreeCash] RUN FAILED 2026-09-25 | Reason:    ForbiddenWriteError: R2: host not allowlisted: 'example.com' | Day lock:  CONSUMED (no automatic re-run today - R1) | Attempts:  last_attempt_day=2026-09-25 last_success_day=2026-09-23 | Detail:    alerts.jsonl dedupe=run:2026-09-25 | ACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).
  [STUB TOAST 2026-09-26T09:00:00Z] [FreeCash] MISSED DAY 2026-09-24 | No successful status check recorded for 2026-09-24. | Last success: 2026-09-23. consecutive_missed_days=2 | ACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).
  [STUB TOAST 2026-09-26T09:00:00Z] [FreeCash] MISSED DAY 2026-09-25 | No successful status check recorded for 2026-09-25. | Last success: 2026-09-23. consecutive_missed_days=2 | ACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).
  [STUB TOAST 2026-09-26T09:00:00Z] [FreeCash] EARNINGS CHANGE 2026-09-26 | Earnings:  $15.00 -> $16.00  (+$1.00) | Balance:   $16.00 (changed too) | Pending:   $0.00 | Status:    ACTIVE (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-26) | Detail:    alerts.jsonl dedupe=7db3227236ffd825 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  56b49c66-8ee6-40c0-87eb-cd5d84501f56 (PENDING - yours to decide, nothing executes)
  [STUB TOAST 2026-09-27T09:00:00Z] [FreeCash] APPROVAL PENDING 2026-09-20 | Approval id: 432aed66-f285-4bf2-bcca-046db665caa4 | What changed: earnings_total_cents moved from $13.40 to $14.65. Review and decide whether any action is wanted. | Waiting since: 2026-09-20T09:00:00Z  (no expiry - this item waits indefinitely) | Detail:    approvals/pending.json | ACTION:    No action taken. Decide it yourself: py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id 432aed66-f285-4bf2-bcca-046db665caa4 --decision approve|reject --by "<your name>" --note "<why>"
  [STUB TOAST 2026-09-28T09:00:00Z] [FreeCash] APPROVAL PENDING 2026-09-21 | Approval id: 15a7d637-5694-44b2-b4eb-c1e6638e358c | What changed: Account status moved from ACTIVE to PAUSED. Review and decide whether any action is wanted. | Waiting since: 2026-09-21T09:00:00Z  (no expiry - this item waits indefinitely) | Detail:    approvals/pending.json | ACTION:    No action taken. Decide it yourself: py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id 15a7d637-5694-44b2-b4eb-c1e6638e358c --decision approve|reject --by "<your name>" --note "<why>"
------------------------------------------------------------------------------
FILE snapshots\2026-09-19.json  size=493  sha256=b179b0e163fc5b89780d897c821563b4fa66e9b8012bf5557a068004167da8d7
{
  "schema_version": 1,
  "day_key": "2026-09-19",
  "captured_at_utc": "2026-09-19T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-19"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1340,
  "balance_cents": 1340,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "3f69b55b98369e486eab900aa851c2129f08bf5bd8c2ad1aad68eb115bc566e1"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-20.json  size=493  sha256=15a87f0a4ec749728255d007ce691e0356670dfe688d0f2cc9f147040b04c508
{
  "schema_version": 1,
  "day_key": "2026-09-20",
  "captured_at_utc": "2026-09-20T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-20"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1465,
  "balance_cents": 1465,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "991ba6aee3af0f1d9e0451c8aa0a3a3f5359ec973dfe550b6697271a19a97a92"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-21.json  size=493  sha256=1e6918fa841a66cfae98f691d1ff7aa26c31abf56077f12047cefb2c55cb23c6
{
  "schema_version": 1,
  "day_key": "2026-09-21",
  "captured_at_utc": "2026-09-21T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-21"
  },
  "degraded": true,
  "account_status": "PAUSED",
  "earnings_total_cents": 1465,
  "balance_cents": 1465,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "60672d125a3c7b230941630a909eb37d09d27002dc4e64810fcbb24a280bfeb2"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-22.json  size=493  sha256=d81a7909b4748a5d666719db5db05ddbaccbc93a28ea543d3b2c1a52e1e194f7
{
  "schema_version": 1,
  "day_key": "2026-09-22",
  "captured_at_utc": "2026-09-22T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-22"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1500,
  "balance_cents": 1500,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "733afd2d7b4a03ddb1c86ba7dab137046fcda8b459535bac2fd2973e51950d17"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-23.json  size=493  sha256=40a455b02de97ba9bafa6ead4291c028bd14ac6a1a7552e432c7a1d7ed31cccd
{
  "schema_version": 1,
  "day_key": "2026-09-23",
  "captured_at_utc": "2026-09-23T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-23"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1500,
  "balance_cents": 1500,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "cbb0af67d842f5af9e0ef7558dd2b3d591ce58966a4c525ee0e297519b907859"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-26.json  size=493  sha256=3a99c1b29866aa05445873b14da4be4e93d3f39d4a978bb933cb39d30e383318
{
  "schema_version": 1,
  "day_key": "2026-09-26",
  "captured_at_utc": "2026-09-26T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-26"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1600,
  "balance_cents": 1600,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "9e0405c4d5cdf134ecc361bc1bcb73b64570db0e3f571e357f9e69e08b53f4a3"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-27.json  size=493  sha256=6572225d99134e1b7c9dfa92295eab7780927382c314b102cdcd61b76c3c1489
{
  "schema_version": 1,
  "day_key": "2026-09-27",
  "captured_at_utc": "2026-09-27T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-27"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1600,
  "balance_cents": 1600,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "c0bdf9e070b06fba14174b43a28f8bf8ca17d73179429445538a4430b471cebc"
}
------------------------------------------------------------------------------
FILE snapshots\2026-09-28.json  size=493  sha256=591e48842f7a05cd4a4433a0f58b71c83ab374a62587b2d799372c9a9c82c696
{
  "schema_version": 1,
  "day_key": "2026-09-28",
  "captured_at_utc": "2026-09-28T09:00:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-09-28"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1600,
  "balance_cents": 1600,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "7f948a0ec61ea70ddce6910911ca719cc4abe3ee150289458affa9b99f32de76"
}
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-19.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-20.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-21.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-22.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-23.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-24.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-25.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-26.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-27.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\day-locks\2026-09-28.lock  size=0  sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  <zero bytes - the day lock consumes the day by its presence alone>
------------------------------------------------------------------------------
FILE state\last-run.json  size=337  sha256=4c867e5a03ee7a7940d21533aa665264906c2c725a56c4389e75777ece2d2272
{
  "schema_version": 1,
  "last_attempt_day": "2026-09-28",
  "last_success_day": "2026-09-28",
  "last_attempt_at_utc": "2026-09-28T09:00:00Z",
  "last_success_at_utc": "2026-09-28T09:00:00Z",
  "last_outcome": "OK_NO_CHANGE",
  "consecutive_missed_days": 0,
  "timezone": "Europe/Berlin",
  "updated_at_utc": "2026-09-28T09:00:00Z"
}
------------------------------------------------------------------------------
FILE state\notified-keys.json  size=2586  sha256=f12cc56b0bf49eabcdf0b0d32bf2b498fd1d25e9bd5e52194fcfeecf9011000b
{
  "schema_version": 1,
  "keys": {
    "2efb946ed0a52059db89db4c1bd69e1212f010b3f021a9be193e29293f25becb": {
      "first_notified_at_utc": "2026-09-20T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-20T09:00:00Z"
    },
    "989f6f8406e200dde466389d436017456c9ac9bea9f5bdbf8671c5e7601a79a7": {
      "first_notified_at_utc": "2026-09-21T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-21T09:00:00Z"
    },
    "e1f54e19fe7ff4979f44d2f0a59bd9265248992ebd3f41f90da6efd4101a68d2": {
      "first_notified_at_utc": "2026-09-22T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-22T09:00:00Z"
    },
    "ea9eea5bea4f8f4f1a54cb17696f770c826163b6bb628c518a2b3128da9c4708": {
      "first_notified_at_utc": "2026-09-22T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-22T09:00:00Z"
    },
    "5c6346c1e9cebf34040ef22eda71f484a4465e0b47e66bff2b839c9439b5c997": {
      "first_notified_at_utc": "2026-09-24T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-24T09:00:00Z"
    },
    "247e56a10af4f92ed066dcdbaf57265db70c084180a0a11380dc1a433c439679": {
      "first_notified_at_utc": "2026-09-25T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-25T09:00:00Z"
    },
    "bdcdf44031ff9539d4dc8c77918ca95b983e9a18da30294605729464454d4d63": {
      "first_notified_at_utc": "2026-09-25T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-25T09:00:00Z"
    },
    "ebb32495017bdaabed0b08f267b2dc57d097f23e250720c992322c5de9920f34": {
      "first_notified_at_utc": "2026-09-26T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-26T09:00:00Z"
    },
    "9d1d28f3aab68733a87e841f74ee80da8a73b0cf9f2bcef32797f68d75d94143": {
      "first_notified_at_utc": "2026-09-26T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-26T09:00:00Z"
    },
    "7db3227236ffd8258ea7301a716546187dc4f4aad8016fc7d1915cb3dd6d0e02": {
      "first_notified_at_utc": "2026-09-26T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-26T09:00:00Z"
    },
    "7b8eee506df5e22632097e9fba326d4fd0818243d79a5975e8e5f25e094d07bc": {
      "first_notified_at_utc": "2026-09-27T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-27T09:00:00Z"
    },
    "034badf79d3118c691590365e45f6669c726a2691b04f56724ab07d1cbfefb56": {
      "first_notified_at_utc": "2026-09-28T09:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-09-28T09:00:00Z"
    }
  }
}
------------------------------------------------------------------------------
FILE state\operator-state.json  size=2809  sha256=5aa6d257c17d4598e9b500de26d7d2cedde9e6bddc2c2966494fcf29364ea47a
{
  "schema_version": 1,
  "kind": "operator_entered_daily_status",
  "note": "Operator-entered daily status figures. This routine only reads this file; it never contacts the platform and never takes an action. Every snapshot built from it is marked degraded: true.",
  "how_to": [
    "Open your own account dashboard in a browser and log in yourself.",
    "Note four figures: account status, total earnings, current balance, pending amount.",
    "Append one record to the records list with today's local date as day_key.",
    "Amounts are integer cents (1340 == 13.40). entered_at_utc is the moment you read them."
  ],
  "records": [
    {
      "day_key": "2026-09-19",
      "entered_at_utc": "2026-09-19T06:40:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1340,
      "balance_cents": 1340,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-20",
      "entered_at_utc": "2026-09-20T06:35:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1465,
      "balance_cents": 1465,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-21",
      "entered_at_utc": "2026-09-21T06:50:00Z",
      "account_status": "PAUSED",
      "earnings_total_cents": 1465,
      "balance_cents": 1465,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-22",
      "entered_at_utc": "2026-09-22T06:45:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1500,
      "balance_cents": 1500,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-23",
      "entered_at_utc": "2026-09-23T06:55:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1500,
      "balance_cents": 1500,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-26",
      "entered_at_utc": "2026-09-26T06:40:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1600,
      "balance_cents": 1600,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-27",
      "entered_at_utc": "2026-09-27T06:30:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1600,
      "balance_cents": 1600,
      "pending_cents": 0,
      "currency": "USD"
    },
    {
      "day_key": "2026-09-28",
      "entered_at_utc": "2026-09-28T06:35:00Z",
      "account_status": "ACTIVE",
      "earnings_total_cents": 1600,
      "balance_cents": 1600,
      "pending_cents": 0,
      "currency": "USD"
    }
  ],
  "template_record": {
    "day_key": "YYYY-MM-DD",
    "entered_at_utc": "YYYY-MM-DDTHH:MM:SSZ",
    "account_status": "ACTIVE",
    "earnings_total_cents": 0,
    "balance_cents": 0,
    "pending_cents": 0,
    "currency": "USD"
  }
}
==============================================================================
alerts.jsonl event_type counts (29 lines total):
  APPROVAL_PENDING         7
  EARNINGS_CHANGED         4
  INITIAL_BASELINE         1
  MISSED_DAY               3
  OK_NO_CHANGE             3
  RUN_FAILED               2
  SKIP_DUPLICATE_DAY       7
  STATUS_CHANGED           2
==============================================================================
```


## Appendix B — the flight tooling (verbatim source)

Reproduce the flight by copying these into any scratch directory and setting
`FREECASH_DATA_ROOT` to a **brand-new** temp path.

### `sim_run.py`

```python
"""sim_run.py -- clock-pinned launcher for ONE real run of run_daily_check.py.

The routine deliberately has no ``--now`` flag: its day key is the operator's
real local calendar day.  A two-day flight therefore uses the routine's own
documented programmatic clock seam (``run_daily_check.run(now=...)`` ->
``paths.set_clock``), which pins every "now" inside the process: the day key,
the lock filename, the snapshot day_key, the ledger stamps and every alert
ts_utc.  No routine source file is modified.

It also installs an audit hook that counts EVERY socket-level event in this
process, so "no network egress" is a measured number, not a claim.

Environment:
    FREECASH_DATA_ROOT   throwaway state root (required, printed below)
    FREECASH_TOAST_STUB  1 = offline stub delivery (label STUB_OK, never TOAST_OK)
    SIM_NOW              the simulated UTC instant, e.g. 2026-09-20T09:00:00Z
    SIM_START_AT         optional epoch float; the process spins until then so
                         several processes can start a run simultaneously
"""

import os
import sys
import time
from datetime import datetime, timezone

ROUTINE_DIR = "D:/AgenticOS/monitoring/freecash"
sys.path.insert(0, ROUTINE_DIR)

# --- audit counter: installed before the routine's own guard -------------------

_SOCKET_EVENTS = []
_ALL_EVENTS = {}


def _counting_hook(event, args):
    _ALL_EVENTS[event] = _ALL_EVENTS.get(event, 0) + 1
    if event.startswith("socket."):
        _SOCKET_EVENTS.append(event)


sys.addaudithook(_counting_hook)

import gate  # noqa: E402
import paths  # noqa: E402
import run_daily_check  # noqa: E402


def main(argv):
    sim_now = os.environ["SIM_NOW"]
    start_at = os.environ.get("SIM_START_AT")
    if start_at:
        target = float(start_at)
        while time.time() < target:
            time.sleep(0.001)
    moment = datetime.strptime(sim_now, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    print("[sim_run] FREECASH_DATA_ROOT=%s" % os.environ.get("FREECASH_DATA_ROOT"))
    print("[sim_run] paths.data_root()=%s" % paths.data_root())
    print(
        "[sim_run] simulated now=%s tz=%s resolved_tz=%s day_key=%s pid=%d"
        % (sim_now, gate.tz_name(), gate.timezone_report()["kind"], gate.day_key(moment), os.getpid())
    )
    code = run_daily_check.run(argv, now=moment)
    print("[sim_run] exit=%d" % code)
    print(
        "[sim_run] AUDIT socket_events=%d all_events=%d"
        % (len(_SOCKET_EVENTS), sum(_ALL_EVENTS.values()))
    )
    if _SOCKET_EVENTS:
        print("[sim_run] AUDIT socket event names=%s" % sorted(set(_SOCKET_EVENTS)))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### `set_record.py`

```python
"""set_record.py -- upsert one operator-entered daily record (the read source).

Usage:
    python set_record.py <FREECASH_DATA_ROOT> <day_key> <entered_at_utc> \
        <account_status> <earnings_total_cents> <balance_cents> <pending_cents> <currency>

Writes exactly the schema operator_state.py documents:
    {"schema_version": 1, "kind": "operator_entered_daily_status", ...,
     "records": [{day_key, entered_at_utc, account_status,
                  earnings_total_cents, balance_cents, pending_cents, currency}]}
"""

import json
import os
import sys

sys.path.insert(0, "D:/AgenticOS/monitoring/freecash")

import operator_state  # noqa: E402
import paths  # noqa: E402


def main(argv):
    data_root, day, entered, status, earnings, balance, pending, currency = argv
    os.environ["FREECASH_DATA_ROOT"] = data_root
    paths.ensure_layout()
    created = operator_state.ensure_template()
    doc = operator_state.load_document() or operator_state.template_document()
    doc.setdefault("records", [])
    record = {
        "day_key": day,
        "entered_at_utc": entered,
        "account_status": status,
        "earnings_total_cents": int(earnings),
        "balance_cents": int(balance),
        "pending_cents": int(pending),
        "currency": currency,
    }
    kept = [r for r in doc["records"] if r.get("day_key") != day]
    kept.append(record)
    kept.sort(key=lambda r: r.get("day_key") or "")
    doc["records"] = kept
    paths.write_json_atomic(paths.operator_state_path(), doc)
    print("set_record: path=%s template_created=%s records_now=%d" % (
        paths.operator_state_path(), created, len(kept)))
    print("set_record: record entered = %s" % json.dumps(record, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### `race.py`

```python
"""race.py -- launch N truly-concurrent same-day runs (separate processes).

Usage: python race.py <FREECASH_DATA_ROOT> <SIM_NOW> <N> <OUT_PREFIX>

Every child is a fresh interpreter running sim_run.py with the same simulated
day and an identical SIM_START_AT barrier, so all children reach
gate.acquire_day_lock() at the same instant.  The O_CREAT|O_EXCL lock is the
only thing deciding which one wins; this prints every child's stdout and the
tally, so "exactly one RUN_OK and one SKIP_DUPLICATE_DAY" is measured.
"""

import os
import subprocess
import sys
import time

SCRATCH = os.path.dirname(os.path.abspath(__file__))


def main(argv):
    root, sim_now, count, prefix = argv[0], argv[1], int(argv[2]), argv[3]
    barrier = time.time() + 3.0
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = root
    env["FREECASH_TOAST_STUB"] = "1"
    env["FREECASH_TZ"] = os.environ.get("FREECASH_TZ", "Europe/Berlin")
    env["SIM_NOW"] = sim_now
    env["SIM_START_AT"] = "%.6f" % barrier
    print("race: root=%s sim_now=%s children=%d barrier_epoch=%.6f" % (root, sim_now, count, barrier))
    procs = []
    for index in range(1, count + 1):
        path = "%s_proc%d.txt" % (prefix, index)
        handle = open(path, "w", encoding="utf-8")
        proc = subprocess.Popen(
            [sys.executable, os.path.join(SCRATCH, "sim_run.py")],
            stdout=handle, stderr=subprocess.STDOUT, env=env,
        )
        procs.append((index, path, proc, handle))
    tally = {"RUN_OK": 0, "SKIP_DUPLICATE_DAY": 0, "RUN_FAILED": 0}
    for index, path, proc, handle in procs:
        code = proc.wait()
        handle.close()
        text = open(path, encoding="utf-8").read()
        print("--- child %d exit=%d (%s) ---" % (index, code, os.path.basename(path)))
        sys.stdout.write(text)
        for line in text.splitlines():
            event = line.split(" ", 1)[0]
            if event in tally:
                tally[event] += 1
    print("race tally: RUN_OK=%d SKIP_DUPLICATE_DAY=%d RUN_FAILED=%d"
          % (tally["RUN_OK"], tally["SKIP_DUPLICATE_DAY"], tally["RUN_FAILED"]))
    return 0 if tally["RUN_OK"] == 1 and tally["SKIP_DUPLICATE_DAY"] == count - 1 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### `check.py`

```python
"""check.py -- compact verification of the R1/R3/R4 evidence in a state root.

Usage: python check.py <FREECASH_DATA_ROOT> <LABEL>

Prints only the fields a rule claim depends on: the day locks present (one per
consumed day), the alerts ledger by event type, the approval queue by status /
execution_state / expiry, and the ledger's coverage fields.
"""

import collections
import json
import sys
from pathlib import Path


def read_jsonl(path):
    out = []
    if Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def main(argv):
    root = Path(argv[0])
    label = argv[1] if len(argv) > 1 else ""
    print("--- CHECK %s (%s) ---" % (label, root))
    locks = sorted(p.name for p in (root / "state" / "day-locks").glob("*.lock"))
    print("R1 day-locks (%d): %s" % (len(locks), ", ".join(locks)))
    snaps = sorted(p.name for p in (root / "snapshots").glob("*.json"))
    print("R3 snapshots (%d): %s" % (len(snaps), ", ".join(snaps)))
    alerts = read_jsonl(root / "alerts" / "alerts.jsonl")
    counts = collections.Counter(a.get("event_type") for a in alerts)
    print("R3 alerts.jsonl lines=%d event_types=%s" % (len(alerts), dict(sorted(counts.items()))))
    keys = json.loads((root / "state" / "notified-keys.json").read_text(encoding="utf-8"))["keys"] \
        if (root / "state" / "notified-keys.json").exists() else {}
    deliveries = collections.Counter(v.get("delivery") for v in keys.values())
    print("R3 notified-keys=%d deliveries=%s" % (len(keys), dict(sorted(deliveries.items()))))
    pending_path = root / "approvals" / "pending.json"
    items = json.loads(pending_path.read_text(encoding="utf-8"))["items"] if pending_path.exists() else []
    print("R4 approval items=%d" % len(items))
    for item in items:
        print("R4   %s status=%-8s exec=%-12s allowed=%s expires=%s day=%s" % (
            item.get("approval_id"), item.get("status"), item.get("execution_state"),
            item.get("execution_allowed_by_this_routine"), item.get("expires_at_utc"),
            item.get("day_key")))
    decided_path = root / "approvals" / "decided.jsonl"
    decisions = read_jsonl(decided_path)
    print("R4 decided.jsonl lines=%d%s" % (
        len(decisions),
        "" if not decisions else " -> " + ", ".join(
            "%s by=%s exec=%s" % (d.get("decision"), d.get("decided_by"), d.get("execution_state"))
            for d in decisions)))
    ledger_path = root / "state" / "last-run.json"
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        print("R1 ledger last_attempt_day=%s last_success_day=%s last_outcome=%s missed=%s tz=%s" % (
            ledger.get("last_attempt_day"), ledger.get("last_success_day"),
            ledger.get("last_outcome"), ledger.get("consecutive_missed_days"), ledger.get("timezone")))
    print("--- END CHECK %s ---" % label)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### `dump_state.py`

```python
"""dump_state.py -- print the throwaway state root as raw evidence.

Usage: python dump_state.py <FREECASH_DATA_ROOT> <LABEL>

Prints every file with size + sha256 and, unless the file is binary or a
zero-byte lock, its exact content.  Also prints the per-event-type count of
alerts.jsonl, which is the R1/R3 evidence ledger.
"""

import collections
import hashlib
import json
import os
import sys
from pathlib import Path


def sha256(path, limit=None):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        blob = fh.read() if limit is None else fh.read(limit)
    h.update(blob)
    return h.hexdigest()


def main(argv):
    root = Path(argv[0])
    label = argv[1] if len(argv) > 1 else ""
    print("=" * 78)
    print("ARTEFACT DUMP %s" % label)
    print("root = %s" % root)
    print("root exists = %s" % root.exists())
    print("=" * 78)
    files = sorted(p for p in root.rglob("*") if p.is_file())
    dirs = sorted(p for p in root.rglob("*") if p.is_dir())
    print("directories: %s" % ", ".join(str(d.relative_to(root)) for d in dirs))
    print("file count = %d" % len(files))
    for path in files:
        rel = path.relative_to(root)
        size = path.stat().st_size
        print("-" * 78)
        print("FILE %s  size=%d  sha256=%s" % (rel, size, sha256(path)))
        if size == 0:
            print("  <zero bytes - the day lock consumes the day by its presence alone>")
            continue
        if path.suffix == ".json":
            try:
                print(json.dumps(json.loads(path.read_text(encoding="utf-8")),
                                 indent=2, sort_keys=False, ensure_ascii=False))
                continue
            except ValueError:
                pass
        for line in path.read_text(encoding="utf-8").splitlines():
            print("  %s" % line)
    alerts = root / "alerts" / "alerts.jsonl"
    print("=" * 78)
    if alerts.exists():
        counts = collections.Counter()
        for line in alerts.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            counts[json.loads(line).get("event_type")] += 1
        print("alerts.jsonl event_type counts (%d lines total):" % sum(counts.values()))
        for event_type in sorted(counts):
            print("  %-24s %d" % (event_type, counts[event_type]))
    else:
        print("alerts.jsonl does not exist")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### `hash_tree.py`

```python
"""hash_tree.py -- sha256 + size of every file under a state root, sorted.

Usage: python hash_tree.py <FREECASH_DATA_ROOT>

Used to diff the whole state root across a run: any file a duplicate run touches
would show up, and a file it must not touch stays byte-identical.
"""

import hashlib
import sys
from pathlib import Path


def main(argv):
    root = Path(argv[0])
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        print("%s  %8d  %s" % (digest, path.stat().st_size, path.relative_to(root)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

### `list_tree.py`

```python
"""list_tree.py -- mtime + size + sha256 for every file under a path (read-only).

Usage: python list_tree.py <PATH> [GLOB]

Used to prove that a directory was NOT written to during the flight: every mtime
must predate the flight, and the hashes are the bytes on disk right now.
"""

import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path


def main(argv):
    target = Path(argv[0])
    pattern = argv[1] if len(argv) > 1 else "*"
    files = sorted(p for p in target.rglob(pattern) if p.is_file())
    print("listing %s (%d files, pattern=%r)" % (target, len(files), pattern))
    for path in files:
        stat = path.stat()
        stamp = datetime.fromtimestamp(stat.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        print("  mtime_utc=%s  size=%8d  sha256=%s  %s"
              % (stamp, stat.st_size, digest, path.relative_to(target)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

## Appendix C — the standing proofs, re-verified in this flight

```text
run_all: tests=52 failures=0 errors=0 skipped=0
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
```
(`python monitoring/freecash/tests/run_all.py` and
`python monitoring/freecash/verify_readonly.py`, run before and after the flight;
no test was changed, added or removed by this task.)

Static freeze evidence from the source tree (searched read-only):

```text
D:/AgenticOS/monitoring/freecash/approval_queue.py
  39: STATUS_APPROVED = "APPROVED"
  41: DECISIONS = {"approve": STATUS_APPROVED, "reject": STATUS_REJECTED}
  44: EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"
 132:         "execution_state": EXECUTION_STATE_NOT_EXECUTED,
 181:     item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED
 197:             "execution_state": EXECUTION_STATE_NOT_EXECUTED,
D:/AgenticOS/monitoring/freecash/run_daily_check.py
 163:                 "execution_state": item["execution_state"],
D:/AgenticOS/monitoring/freecash/tests/test_r4_approval.py
 269:                 if 'execution_state"] =' in line:
 270:                     self.assertIn("EXECUTION_STATE_NOT_EXECUTED", line, "%s:%d" % (name, lineno))
```

There is no other writer of `execution_state` anywhere in the package, and no
module branches on `"APPROVED"` to take an action.

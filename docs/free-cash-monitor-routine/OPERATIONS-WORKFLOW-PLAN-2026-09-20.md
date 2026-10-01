# OPERATIONS-WORKFLOW-PLAN-2026-09-20.md — Operator-facing daily status-monitoring workflow

**Routine:** Free Cash Finance Automation — daily status-monitoring routine
**Implementation under this plan:** `D:/AgenticOS/monitoring/freecash/` (the canonical tree; `verify_readonly.py` / `verify-readonly.sh` scan it)
**Production state root:** `D:/AgenticOS/data/freecash-monitor/`
**Document date:** 2026-09-20 (operator-local, Europe/Berlin, machine offset `+0200` observed)
**Status of this document:** design + procedure, written to be read directly by the operator.

---

## §0 Honest status banner — read this first

| Statement | Status |
|---|---|
| R1–R4 are enforced in code by construction (atomic day lock, read-only transport, dedupe index, enqueue-only queue) | **VERIFIED** (test suite + source, §2) |
| R2 static/CI gate is green on the shipped tree | **VERIFIED** — `forbidden=0 exempt=28 … PASS`, exit 0 (§1) |
| The routine has **never been scheduled** | **VERIFIED** — `schtasks` match count `0` (§1) |
| No operator reading has **ever** been entered into production | **VERIFIED** — `state/operator-state.json` → `"records": []` (§1) |
| Production has ever produced a non-degraded snapshot | **NOT OBSERVED** — the single snapshot is `degraded: true` with null fields (§1) |
| **R3 has been exercised on real operator input** | **NO — never.** It has only been exercised on synthetic input in a scratch root (§1.4) and in the test suite |
| **R4 has been exercised on real operator input** | **NO — never.** No production approval item has ever existed (`approvals/` is empty) |
| The R1 gate is reproducibly green | **NO** — 1 of 2 suite runs in this session failed (`failures=1`), §1.2 and §11.1 |
| Anything in this routine can perform an external action | **FALSE by design and by code** (§5.5) |

**This routine is therefore NOT reported as compliant-and-operational. It is reported as: rules enforced in code, R2 gate green, never scheduled, never fed a real reading.** Everything below is either backed by a command run in this session (quoted) or explicitly labelled `UNVERIFIED` / `BLOCKED-on-<id>`.

Evidence policy used in every section: a step counts as verified **only** from a command run in this session with its output quoted. Source-read facts are labelled `[read from source]`. Tests are labelled `[suite]` and are only as good as §11.1.

---

## §1 STEP 0 — independent re-verification performed in this session

### 1.1 Command ledger (verbatim commands, observed results)

| # | Command | Observed result | Exit |
|---|---|---|---|
| C1 | `cd /d/AgenticOS && python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=1 errors=0 skipped=0` — failing test `test_five_concurrent_runs_yield_one_winner (test_r1_gate.ConcurrencyTests)`, `AssertionError: 3 != 4` at `test_r1_gate.py:121` | **1** |
| C2 | `cd /d/AgenticOS && python monitoring/freecash/tests/run_all.py 2>&1 \| tail -20` (immediate re-run) | `run_all: tests=52 failures=0 errors=0 skipped=0` | **0** |
| C3 | `cd /d/AgenticOS && bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `[verify-readonly] forbidden=0 exempt=28 missing_targets=0` / `[verify-readonly] PASS — no unexempted write/earning token found.` | **0** |
| C4 | `cd /d/AgenticOS && schtasks //query //fo LIST 2>/dev/null \| grep -icE 'freecash\|finance\|daily-monitor'` | `0` | 1 (grep: no match → **zero scheduled tasks match**) |
| C5 | `find data/freecash-monitor -maxdepth 3 \| sort` | one lock `state/day-locks/2026-09-20.lock`, one snapshot `snapshots/2026-09-20.json`, `alerts/alerts.jsonl`, `state/last-run.json`, `state/operator-state.json`; `approvals/` and `logs/` empty | 0 |
| C6 | `find data/freecash -maxdepth 2` | `data/freecash` only (empty) — **no state there** | 0 |
| C7 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `timezone=Europe/Berlin`, `last_attempt_at_utc=2026-09-20T19:08:00Z` | 0 |
| C8 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` — **no reading has ever been entered** | 0 |
| C9 | `cat data/freecash-monitor/alerts/alerts.jsonl` | exactly **2** lines: `MONITOR_DEGRADED` (`"No data for 2026-09-20 (no operator-entered record for 2026-09-20 …). Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists."`) and `SKIP_DUPLICATE_DAY` (`"Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot."`) | 0 |
| C10 | `cat data/freecash-monitor/snapshots/2026-09-20.json` | `"degraded": true`, `account_status/earnings_total_cents/balance_cents/pending_cents/currency` all `null`, `source.data_available=false`, `raw_response_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (sha256 of the empty byte string) | 0 |
| C11 | `ls -l data/freecash-monitor/state/day-locks/` | `-rw-r--r-- 0 … 2026-09-20.lock` — **0 bytes**, the filename *is* the day key | 0 |
| C12 | `which python && python -V && python -c "import tzdata; print(tzdata.__version__)"` | `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python`; `Python 3.11.9`; `executable= C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`; `tzdata= 2025.3` | 0 |
| C13 | `py -3 -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Berlin')"` | `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` (from `C:\Python314\Lib\zoneinfo\_common.py`) | non-zero (expected) |
| C14 | `python -c "from zoneinfo import ZoneInfo; print(ZoneInfo('Europe/Berlin'))"` | `resolved Europe/Berlin` | 0 |
| C15 | `which python3` / `python3 -V` | resolves to `…/Microsoft/WindowsApps/python3`, which prints the Microsoft-Store alias notice: `Python wurde nicht gefunden; ohne Argumente ausführen …` — **not a usable interpreter** | — |
| C16 | `date` / `date +%z` / `python -c "print(datetime.datetime.now().astimezone())"` | `So, 20. Sep 2026 21:45:15`, `+0200`, `2026-09-20T21:45:15.298490+02:00` — machine local == operator-local (Europe/Berlin) | 0 |
| C17 | `test -e docs/free-cash-monitor-routine/OPERATIONS-WORKFLOW-PLAN-2026-09-20.md` | `ABSENT` before writing — no existing file was overwritten | 0 |

### 1.2 The two findings that change what may be claimed

1. **The suite is flaky, so "gate green" is not reproducible.** C1 `failures=1`, C2 `failures=0`, identical command, 12 s apart. The single failure is `test_five_concurrent_runs_yield_one_winner`, which asserts at line 121 that `alerts.jsonl` contains exactly 4 `SKIP_DUPLICATE_DAY` records after 5 simultaneous runs. The earlier assertions in the same test passed in the failing run (`returncode` all `0`, 4 processes printed `SKIP_DUPLICATE_DAY`, exactly 1 printed `RUN_OK`) — so **the gate itself held: one winner, one lock, one snapshot**, and the failure is in the *evidence record*: one of the four expected duplicate-day alert lines was not found in the log under 5-way concurrency. R1 is intact; **the alert log is not a byte-perfect evidence record under concurrent writers**. Both facts are operator-relevant (§5.1, §7.3).
2. **Nothing is scheduled, and no reading has ever been entered.** C4 = `0` tasks, C8 = `records: []`, C9 = 2 alert lines both about the *absence* of a reading. Consequently the production panel has never seen a real reading, and §4/§5 have never fired on real input.

### 1.3 What the production state proves by itself

* Exactly one day was ever attempted (`2026-09-20`) and it was a **duplicate-guarded** day: the `SKIP_DUPLICATE_DAY` line (C9) is the duplicate protection firing in production, not in a test.
* The day/attempt was consumed even though no reading existed (C7 `last_outcome=MONITOR_DEGRADED`, `last_success_day=2026-09-20` because `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` `[read from source]` `gate.py:32-41`). **Operational consequence: a reading entered *after* the day's run cannot be used that day** (§3.2 step 0).
* `data/freecash` (C6) is empty and unused: `paths.DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"` `[read from source]` `paths.py:35`. Two state roots would be an operator trap; this plan pins `FREECASH_DATA_ROOT` explicitly everywhere (§8.3).

### 1.4 Second-scenario run performed by this session (scratch root, no provider, no production file touched)

The daily procedure and the R1/R3/R4 mechanisms were additionally **executed end-to-end** on a throwaway root, so §3–§5 describe observed behaviour, not only source. Root used: `C:/Users/cd-pr/AppData/Local/Temp/fc-opsplan-103678` (outside the repo), `FREECASH_DATA_ROOT` pointed at it, `FREECASH_TOAST_STUB=1` so the notifier wrote to `logs/toast-stub.log` instead of raising a desktop balloon. No repository file was read-modified, no production artifact was touched, no socket was opened, no provider was contacted. Observed output (quoted):

```
RUN_OK 2026-09-18 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-18.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-18.lock
exit(A, no reading) = 0
SKIP_DUPLICATE_DAY 2026-09-18
exit(A, immediate duplicate run) = 0

RUN_OK 2026-09-19 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-19.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-19.lock
exit(B, reading entered) = 0

RUN_OK 2026-09-20 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-09-20.lock
exit(C, earnings moved) = 0

WATCHDOG_MISSED_DAY 2026-09-22 last_attempt_day=2026-09-20 last_outcome=EARNINGS_CHANGED coverage=NOTIFIED
WATCHDOG_MISSED_DAY 2026-09-22 last_attempt_day=2026-09-20 last_outcome=EARNINGS_CHANGED coverage=DEDUPED
watchdog = True DEDUPED

a04c9ba2-0a60-4cee-a5a1-3a4a063853a6  PENDING  2026-09-20  expires_at_utc=None  execution_state=NOT_EXECUTED
frozen: expires_at_utc=None execution_state='NOT_EXECUTED' execution_allowed_by_this_routine=False

REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person
decision-by-machine exit = 4
recorded APPROVED for a04c9ba2-0a60-4cee-a5a1-3a4a063853a6 by operator at 2026-09-20T19:42:56Z
execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)
decision-by-human exit = 0
after decision: status=APPROVED decided_by=operator expires_at_utc=None execution_state='NOT_EXECUTED'

Counter({'MISSED_DAY': 2, 'MONITOR_DEGRADED': 1, 'SKIP_DUPLICATE_DAY': 1, 'INITIAL_BASELINE': 1, 'APPROVAL_PENDING': 1, 'EARNINGS_CHANGED': 1})
day locks: ['2026-09-18.lock', '2026-09-19.lock', '2026-09-20.lock']
snapshots: ['2026-09-18.json', '2026-09-19.json', '2026-09-20.json']
decided.jsonl lines = 1
```

Time handling note (observed, not theorised): the instants above were supplied in UTC, so the resulting `day_key`s are the Europe/Berlin days. A watchdog instant of `2026-09-18 23:50 UTC` is `2026-09-19 01:50` operator-local and therefore alarms for day `2026-09-19` (which had genuinely not been checked yet). **The day boundary is operator-local, never UTC** (`gate.day_key` `[read from source]` `gate.py:96-102`) — this is why §8 pins the schedule in local time and pins an interpreter that can resolve the zone.

---

## §2 Rule → mechanism map (enforcement is structural, not conventional)

| Rule | Mechanism that enforces it | Where | Structural property |
|---|---|---|---|
| **R1** one status check per operator-local calendar day | `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock` | `gate.acquire_day_lock` `gate.py:119-135` | single atomic syscall on NTFS; there is no read-then-write window and no "does it exist" check to race. The **filename is the day key**; the file is 0 bytes (C11) so a partial write cannot be misread |
| **R1** (2nd layer) | `state/last-run.json` ledger for audit + missed-day maths — **never the gate** | `gate.load_ledger/record_attempt/record_outcome` `gate.py:155-202` | a corrupt or deleted ledger cannot cause a second read in one day |
| **R1** fail closed | anything wrong with the lock ⇒ "do not read"; duplicate ⇒ `SKIP_DUPLICATE_DAY`, exit 0, no read, no snapshot, no ledger write | `run_daily_check.py:309-321` | duplicate is not an error and has no side effects beyond one log line |
| **R2** zero automated earning actions | the routine has **one** socket library, reached only through `readonly_client`, allowlisted `GET`/`HEAD` paths, loopback-only | `readonly_client.py`; audit guard installed at `run_daily_check.py:279` | every non-read method, non-allowlisted path, non-loopback host and body-carrying `GET` is refused before a socket opens `[suite]` |
| **R2** (static gate) | `verify-readonly.sh` + `verify_readonly.py` scan 6 token families; a violation is exempt only with an inline `# readonly-exempt: <reason>` comment | `docs/free-cash-monitor-routine/verify-readonly.sh` | C3: `forbidden=0 exempt=28 missing_targets=0`, exit 0. A missing target is `FAIL`, never a pass |
| **R3** exactly one notification per distinct change | dedupe key `sha256(day_key\|change_type\|field\|old_value\|new_value)`, recorded in `state/notified-keys.json` **before** the dispatch attempt | `changedetect.dedupe_key`; `notify.record_notified_key` `notify.py:132-145` | a crash can lose one message but can never duplicate one. The day key is part of the key: the same movement on a later day is a new change and notifies again |
| **R3** none when nothing changed | `OK_NO_CHANGE` is log-only; `INITIAL_BASELINE` is log-only | `notify.emit_no_change` `notify.py:91-99`, `notify.emit_initial_baseline` `notify.py:102-110` | these two functions have no dispatch call at all |
| **R4** human approval before **any** external action | `approval_queue` can only `enqueue` and record a human `decide`; `expires_at_utc` is always `None`, `execution_state` always `NOT_EXECUTED`, `execution_allowed_by_this_routine` always `False` | `approval_queue.py:43-52, 108-201` | the frozen fields are **constants in the builder**, not parameters; `decide()` re-asserts them so no decision can arm an item |
| **R4** no execution path | no module in the routine treats `APPROVED` as a trigger; only `readonly_client` may import a socket library | `[suite]` `test_no_module_treats_an_approved_status_as_a_trigger`, `test_only_the_readonly_client_may_reach_a_socket_library` | there is nothing to call. `ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"` is a schema label for a person, never an instruction the code carries out |

### 2.1 The four rules in one line each
* **R1** — the day lock is a single atomic syscall; the ledger is audit only.
* **R2** — one transport, reads only, and a static gate that fails the build on any write/earning token.
* **R3** — exact-integer comparison of four fields, one dedupe key per distinct change, logged before dispatched.
* **R4** — the queue is a notification with a handle; decisions are human-signed text; **nothing executes**.

---

## §3 The daily procedure (operator-facing)

### 3.1 The ordering rule that matters most

> **Enter today's reading FIRST, then run the check.** The run consumes the day's lock whether or not a reading exists. A reading entered after the day's run is only usable on the *next* day.

This is not style advice. It was observed: a run with no reading produced `MONITOR_DEGRADED` and consumed the day (`RUN_OK 2026-09-18 … MONITOR_DEGRADED … lock=2026-09-18.lock`, exit 0), while a subsequent same-day invocation produced `SKIP_DUPLICATE_DAY 2026-09-18` and did nothing else. There is no `--force-recheck` escape: it is accepted only in order to be refused (exit 3) and recorded in `logs/forced-recheck-requests.jsonl` `[read from source]` `run_daily_check.py:281-297`; `[suite]` `test_force_recheck_is_refused_and_recorded`.

### 3.2 The daily ritual (target ~08:35 operator-local; ~5 minutes)

| # | When | What the operator does | Command / input | Exit / signal |
|---|---|---|---|---|
| 0 | 08:30 | **Enter the reading before anything else.** Log into your own dashboard in your browser, yourself — the routine never logs in and holds no credential | — | — |
| 1 | 08:33 | Note four figures: account status, total earnings, current balance, pending amount. Amounts are **integer cents** (`1340` == `13.40`) | — | — |
| 2 | 08:34 | Append **one** record to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json` under `records`, with `day_key` = today's local date. `entered_at_utc` = the moment you read them | see §3.3 | — |
| 3 | 08:35 | Run the check | `cd /d/AgenticOS && python monitoring/freecash/run_daily_check.py --source operator_state` | see §3.4 |
| 4 | 08:36 | Read the one-line result. `RUN_OK … outcome=OK_NO_CHANGE` = nothing moved, no notification (by design). `outcome=EARNINGS_CHANGED` / `STATUS_CHANGED` / `BALANCE_CHANGED` = a notification was dispatched and an approval item exists | same line | — |
| 5 | on notification | Decide the approval item, or deliberately leave it. Leaving it is safe: items have no expiry and no execution path (§5) | §5.2 | exit 0 / 4 |
| 6 | any day | Optional read-only peek: ledger + pending count | `python monitoring/freecash/run_daily_check.py --print-state` | `[suite]` `test_print_state_is_read_only` |

Step 2 is the only step that makes R3 meaningful; without it the day is a degraded snapshot (§3.5) and **nothing is ever compared**.

### 3.3 Exactly what you type into the operator-state file

The file already exists in production (C8) with `records: []` and a `template_record`. Append one object to `records`; do not edit or delete earlier records — the file is the audit trail of your own readings.

```json
{
  "day_key": "2026-09-20",
  "entered_at_utc": "2026-09-20T06:35:00Z",
  "account_status": "ACTIVE",
  "earnings_total_cents": 1340,
  "balance_cents": 1340,
  "pending_cents": 0,
  "currency": "USD"
}
```

Rules the code enforces about this file `[read from source]` `operator_state.py:104-150`:
* only the record whose `day_key` **equals** today's operator-local day is used — a stale record is never carried forward as if it were today's reading;
* missing fields behave as follows: a record present but with a compared field absent is treated as **no data** (baseline/degraded), never as a silent zero `[suite]` `test_missing_field_is_a_metric_error_not_a_zero`;
* the file must remain valid JSON `[read from source]` `paths.read_json` returns a default on corrupt input, so a typo produces a degraded day rather than a crash — the degraded day is a visible, honest result, not a silent one.

### 3.4 Reading the result (exit codes)

| Exit | Meaning | Operator action |
|---|---|---|
| 0 | ran (or the day was already consumed — a duplicate is **not** an error) | read the `RUN_OK …` / `SKIP_DUPLICATE_DAY …` line |
| 2 | usage error (e.g. unknown `--source`) | fix the flag; nothing was consumed? — **no**: the lock is acquired after argument parsing, so a usage error consumes no day `[read from source]` `run_daily_check.py:277-309` |
| 3 | `--force-recheck` refused (a second read in one day is forbidden by R1) | none; the refusal is itself logged |
| 5 | the status read failed; the day lock **stays** in place and there is **no** automatic re-run | read the `RUN_FAILED` alert; the day counts as uncovered for the watchdog |

Observed CLI strings (this session, scratch root): `RUN_OK 2026-09-20 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-09-20.lock` and `SKIP_DUPLICATE_DAY 2026-09-18`.

### 3.5 If the operator never enters a reading (degraded snapshot) — observed

| Aspect | Behaviour | Evidence |
|---|---|---|
| What is written | one snapshot, `degraded: true`, all four compared fields `null`, `source.data_available=false`, `raw_response_sha256` = sha256 of empty input | C10 (production) and §1.4 `RUN_OK … outcome=MONITOR_DEGRADED … written=True changes=0 notifications=0 approvals=0` |
| What is compared | **nothing.** `compare()` returns `baseline: True` when either side has no data | `[read from source]` `changedetect.compare`; `[suite]` `test_prior_without_data_is_a_baseline_not_a_change` |
| What is notified | **nothing** — no toast, no approval item, no reminder. One `MONITOR_DEGRADED` line in `alerts.jsonl` | C9 line 1; §1.4 counters |
| What the day counts as | a **covered** day (`MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`), so the watchdog will **not** raise a missed-day alarm for it | `[read from source]` `gate.py:32-41`; C7 `last_outcome=MONITOR_DEGRADED` |
| Operator meaning | "the machine checked; I never told it what to compare against." Degraded is not failure, and it is **not** a green light | §7.4 metric `D` |

---

## §4 Notification contract for R3

### 4.1 What counts as a change (exhaustive)

`[read from source]` `changedetect.COMPARED_FIELDS`; comparison is **exact integer cents** against the prior snapshot, no percentage or relative threshold. One cent is a change `[suite]` `test_one_cent_is_a_change_because_cents_are_exact`.

| Field | Inequality yields | Notes |
|---|---|---|
| `account_status` | `STATUS_CHANGED` | its own event and its own dedupe key `[suite]` |
| `earnings_total_cents` | `EARNINGS_CHANGED` | |
| `balance_cents` | `BALANCE_CHANGED` | **suppressed** when earnings also moved, because the earnings message carries the balance movement inline — so "earnings + balance moved" is **one** distinct change, not two `[read from source]` `changedetect.compare`; `[suite]` `test_balance_movement_has_its_own_type` |
| `pending_cents` | `EARNINGS_CHANGED` (subtype `pending`) | a pending movement counts as an earnings change `[suite]` `test_pending_movement_counts_as_an_earnings_change` |

Two conditions that are deliberately **not** changes: a first run with data (`INITIAL_BASELINE`, log-only) and a prior snapshot with no data (`baseline`, log-only). A currency change is **degraded**, not a change: money comparison is skipped and a `MONITOR_DEGRADED` line is emitted `[suite]` `test_currency_change_is_degraded_not_a_change`.

### 4.2 What the operator receives, and through which sink

| Sink | When | Content | Status |
|---|---|---|---|
| `alerts/alerts.jsonl` | **always**, one line per event, append-only | canonical evidence record; full message text | **verified live** (C9, §1.4) |
| Windows toast (balloon tip via `powershell` + `NotifyIcon`) | default delivery channel for every dispatch | the message template of §4.4 | **UNVERIFIED on this host** — every dispatch in this session used the stub (§11.5) |
| stub (`FREECASH_TOAST_STUB=1`) | tests, headless runs | writes `logs/toast-stub.log`; delivery label is `STUB_OK`, never `TOAST_OK` | verified live in §1.4 — **a stub run can never be mistaken for a real delivery** |
| SMTP | opt-in, **off by default**, not wired to any credential here | — | `[read from source]` `notify.py:1-20` |

Severity table `[read from source]` `notify.py:36-57`: `alert` = `READ_FAILED`, `RUN_FAILED`, `MISSED_DAY`, `DELIVERY_FAILED`, `MONITOR_DEGRADED`; `notify` = `EARNINGS_CHANGED`, `STATUS_CHANGED`, `BALANCE_CHANGED`, `APPROVAL_PENDING`; everything else `info` (`OK_NO_CHANGE`, `INITIAL_BASELINE`, `SKIP_DUPLICATE_DAY`).

### 4.3 The dedupe rule (exactly one notification per distinct change)

1. key = `sha256(day_key | change_type | field | old_value | new_value)`.
2. The key is written into `state/notified-keys.json` **before** the dispatch attempt.
3. If the key is already present, the day's line is logged as `INFO` with `already_notified: true` and the run reports `DEDUPED`; **no second delivery**.
4. Same change on a **later** day = different key = notifies again (the day key is in the subject string).
5. More than 5 distinct changes in one day coalesce into **one** summary notification; each change still gets its own alert line `[read from source]` `run_daily_check.py:173-214`.
6. No change at all ⇒ zero dispatches; `OK_NO_CHANGE` is log-only.
7. Observed consequence: the watchdog alarm for a day fires **once**; a second watchdog run the same evening adds no line and no delivery — `coverage=NOTIFIED` then `coverage=DEDUPED` (§1.4).

### 4.4 Message shape (what the operator actually sees)

`[read from source]` `notify.message_for_change` `notify.py:321-369`:

```
[FreeCash] EARNINGS CHANGE 2026-09-20
Earnings:  13.40 -> 15.72  (+2.32)
Balance:   15.72
Pending:   0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-20)
Detail:    alerts.jsonl dedupe=<first 16 chars>
ACTION:    No action taken. Review and approve anything you want done.
```

Every template ends with `ACTION:    No action taken. …` — the routine states its own non-action in the message. The `Source: DEGRADED` line is mandatory because **all** operator-entered snapshots are degraded (`operator_state.py` marks every one of them).

### 4.5 Bounded delivery failure (no infinite retry)

`[read from source]` `notify.dispatch` `notify.py:220-261`: at most `MAX_ATTEMPTS = 2`; on failure the key is marked `FAILED_TOAST` and never retried again; **two** alert lines are written — `DELIVERY_FAILED` carrying the **full original message** (so it is not lost) and a `MONITOR_DEGRADED` line saying `"Notification channel failed twice; this message exists only in alerts.jsonl. Operator must read the log until the channel is fixed."` `[suite]` `test_delivery_failure_is_bounded_and_keeps_the_full_message`. A failed notification never blocks a state write, never re-reads the status source, never causes a second run and never touches the approval queue.

---

## §5 Approval surface for R4

### 5.1 How an item is enqueued

Enqueueing happens **only** on a real detected change, in `run_daily_check.dispatch_change` `[read from source]` `run_daily_check.py:126-170`: one `PENDING` item per notified change (at most `MAX_APPROVAL_ITEMS = 5` per day), then one `APPROVAL_PENDING` alert line and a notification whose body carries the approval id. Enqueueing is **a notification with a handle** — not a request for permission to act.

Item fields written at enqueue — observed in §1.4 and confirmed by the read-only `list` CLI:

| Field | Value | Nature |
|---|---|---|
| `approval_id` | uuid4 | handle |
| `status` | `PENDING` | until a **human** decides |
| `expires_at_utc` | **`None` always** | there is no timer, so "expired ⇒ execute" cannot exist |
| `execution_state` | **`NOT_EXECUTED` always** | the only value this routine may ever write |
| `execution_allowed_by_this_routine` | **`False` always** | constant |
| `proposed_action` | `action_type: REQUEST_PAYOUT`, `amount_cents`, `destination: "OPERATOR_SPECIFIED - not stored by the routine"`, `provider_endpoint: "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` | a **description for a human**, not an instruction the code runs |

### 5.2 Who may decide, and the exact command identity requirement

Deciding is a **human-only CLI**; enqueueing is automatic, deciding is not.

```bash
# read-only view
python monitoring/freecash/approval_queue.py list

# a decision (example identity: the operator's own name)
python monitoring/freecash/approval_queue.py decide \
  --id <approval_id> --decision approve \
  --by "<your name>" --note "<why you decided this>"
```

Identity requirements, enforced in code, not by convention `[read from source]` `approval_queue.py:149-168, 241-297`:

| Requirement | Enforcement | Observed |
|---|---|---|
| `--by` is mandatory and must be a **human** name | `_normalise_decider` raises `NotHumanError` for the denylist `{system, routine, automation, agent, cron, scheduler, monitor, bot, script, machine}` (case-insensitive) and for empty/whitespace | §1.4: `REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person`, **exit 4** |
| `--note` is mandatory | empty note ⇒ `ValueError`, exit 2 | `[read from source]` |
| unknown id | `KeyError`, exit 3 | `[read from source]` |
| the decision must not arm anything | `decide()` re-asserts `expires_at_utc=None`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False` **after** writing the decision | §1.4: after an `approve`, `status=APPROVED` **and** `execution_state='NOT_EXECUTED'` |

**Therefore `--by` naming a machine, an agent, a cron job or this routine itself is refused by code.** An approval signed by a process is not a possible state of this system.

### 5.3 Where decisions are recorded

| Artifact | Content | Mutability |
|---|---|---|
| `approvals/pending.json` | live queue, including decided items with `status`, `status_reason`, `decided_at_utc`, `decided_by`, `decision_note` | rewritten atomically (`os.replace`) |
| `approvals/decided.jsonl` | append-only decision trail: `approval_id`, `day_key`, `decision`, `decided_by`, `decided_at_utc`, `decision_note`, `change_dedupe_key`, `proposed_action`, and the frozen fields | append-only; **never pruned** `[read from source]` `changedetect.prune_old_artifacts` |
| `alerts/alerts.jsonl` | the notification + `APPROVAL_PENDING` lines, with `dedupe_key` and `observed` values | append-only; **never pruned** |

Production today: `approvals/` is **empty** (C5) — no item has ever existed, so no decision has ever been recorded outside the scratch run of §1.4.

### 5.4 Reminders, and what a reminder may not do

`nag_pending` `[read from source]` `run_daily_check.py:217-245`: at most **one reminder per item per 7 days** (`NAG_INTERVAL_DAYS = 7`), keyed on the day so it cannot repeat within the interval. A reminder **never decides**, never changes `status`, never changes `execution_state` — it only re-sends the `APPROVAL_PENDING` message. `[suite]` `test_pending_item_survives_a_ninety_day_clock_advance`.

### 5.5 The explicit statement (R4)

> **Nothing in this routine can execute an external action.** There is no code path — in `run_daily_check.py`, `approval_queue.py`, `changedetect.py`, `gate.py`, `notify.py`, `operator_state.py`, `paths.py` or `watchdog.py` — that acts on an approved item, contacts a provider, moves money, or writes anything but local files. `expires_at_utc` is always `null`, `execution_state` is always `NOT_EXECUTED`, and `execution_allowed_by_this_routine` is always `false`. A human `approve` is a **record that a person decided something**; the routine's role ends at that record. Only `readonly_client` may import a socket library, and it can only issue allowlisted `GET`/`HEAD` to loopback `[suite]` `test_only_the_readonly_client_may_reach_a_socket_library`, `test_no_module_treats_an_approved_status_as_a_trigger`.

Consequence to be honest about: **revenue cannot flow from this routine at all.** It is a monitor plus an approval ledger. Any actual earning action is a separate, human-executed activity outside this system.

---

## §6 Missed-day / watchdog escalation, and the max-attempt rule

### 6.1 Two independent detectors

| Detector | When it fires | What it does | What it must never do |
|---|---|---|---|
| **In-band** (`gate.missed_days`, called at the start of the next run) | at the next successful invocation, for **each** local day strictly between `last_success_day` and today | emits one `MISSED_DAY` line + notification per uncovered day; today and the last success day are excluded | never back-fills: a past day is **not** re-read and gets **no** snapshot |
| **Same-evening watchdog** (`watchdog.py`) | when today's attempt is missing or did not succeed (`covered = attempt == today and outcome in SUCCESS_OUTCOMES`) | one `MISSED_DAY` alarm, `severity=alert` | opens **no socket** (does not import `readonly_client` at all); never writes the ledger, never creates or clears a day lock, never writes a snapshot, never touches the approval queue; exit code always 0 |

`[read from source]` `gate.missed_days` `gate.py:208-225`, `watchdog.py:1-17, 27-108`.

### 6.2 The max-attempt rule (this is the part that is easy to get wrong)

| Rule | Enforcement | Evidence |
|---|---|---|
| **A missed day produces exactly one alarm** | dedupe key `sha256(day \| MISSED_DAY \| last_attempt_day \| old \| new)`; if the key is already in `notified-keys.json`, the watchdog prints `coverage=DEDUPED`, writes **no** alert line and dispatches nothing | §1.4: `WATCHDOG_MISSED_DAY … coverage=NOTIFIED` then `… coverage=DEDUPED`; `[suite]` `test_missing_check_raises_one_alarm_and_changes_no_state`, `test_healthy_day_raises_no_alarm` |
| **A missed day is never back-filled** | `missed_days()` only *reports*; no code path takes a snapshot for a past day | `[suite]` `test_missed_days_are_reported_and_not_backfilled` |
| **No retry may consume a second status read** | `MAX_ATTEMPTS = 2` in `notify.py` applies **only to notification delivery attempts** inside a single run; it never re-reads the status source and never re-runs the routine. A watchdog re-run consumes no read at all (it has no read code). A daily re-run after the day is consumed is refused by the day lock (`SKIP_DUPLICATE_DAY`) | `[read from source]` `notify.py:42, 220-238`; observed §1.4 duplicate run and duplicate watchdog alarm |
| **A failed read consumes the day** and is never retried automatically — the lock stays | `gate.record_outcome` only advances `last_success_*` for `SUCCESS_OUTCOMES`; `RUN_FAILED` leaves the previous success day, so the day shows as uncovered to the watchdog | `[read from source]` `run_daily_check.py:371-393`, `gate.py:188-202`; `[suite]` `test_read_failure_is_loud_consumes_the_day_and_never_retries` |

### 6.3 Escalation ladder the operator follows (target behaviour; not yet exercised on a real day)

| Step | Trigger | Operator action | Status |
|---|---|---|---|
| E0 | normal day | nothing | n/a |
| E1 | `MISSED_DAY` alarm (no check ran) | read the message: `No successful status check recorded for <day>`; check whether the machine was on / task history exists; enter today's reading and run the check (never back-fill yesterday) | behaviour verified in §1.4 on synthetic days; **never fired on a real day** (`BLOCKED-on-B2`) |
| E2 | `DELIVERY_FAILED` | the message text is preserved in `alerts.jsonl`; read the log until the toast channel works. R3 is then "logged, not notified" — treat the log as the channel | `[suite]` only |
| E3 | `RUN_FAILED` (exit 5) | day is consumed and uncovered; no automatic retry exists. Enter the reading and run again **only if** the day was not consumed — otherwise the next day is the earliest new read by R1 | `[suite]` only |
| E4 | `MONITOR_DEGRADED` on many consecutive days | the operator is not entering readings (or the timezone is unresolvable). Fix §3.2 step 2 / install `tzdata` into the scheduled interpreter | observed as a class of event (§7.4) |
| E5 | `consecutive_missed_days` rising in `last-run.json` | the routine is not running at all; schedule it (§8) or run it by hand | C7 shows `0` today |

---

## §7 Weekly and 30-day review metrics

Run these once a week (5 minutes) and once per 30 days. All are **read-only**; none of them runs the check, consumes a day lock, or notifies.

```bash
cd /d/AgenticOS
# M1 day coverage: covered local days in the window vs calendar days
python - <<'PY'
import json,glob,os
from datetime import date,timedelta
root="data/freecash-monitor"
led=json.load(open(root+"/state/last-run.json"))
snaps=sorted(os.path.basename(p)[:-5] for p in glob.glob(root+"/snapshots/*.json"))
locks=sorted(os.path.basename(p)[:-5] for p in glob.glob(root+"/state/day-locks/*.lock"))
print("last_success_day:",led["last_success_day"],"last_outcome:",led["last_outcome"],
      "consecutive_missed_days:",led["consecutive_missed_days"],"tz:",led["timezone"])
print("snapshot_days:",len(snaps),"lock_days:",len(locks)); print("first/last snapshot:",snaps[:1],snaps[-1:])
PY
# M2 missed days, M3 duplicate-guard, M4 delivery failures, and the degraded share
grep -c '"event_type": "MISSED_DAY"'           data/freecash-monitor/alerts/alerts.jsonl
grep -c '"event_type": "SKIP_DUPLICATE_DAY"'   data/freecash-monitor/alerts/alerts.jsonl
grep -c '"event_type": "DELIVERY_FAILED"'      data/freecash-monitor/alerts/alerts.jsonl
grep -c '"degraded": true'                     data/freecash-monitor/snapshots/*.json
python monitoring/freecash/approval_queue.py list   # oldest pending item age is visible via created_at_utc
```

| # | Metric | How it is computed | What it tells the operator | Escalate when |
|---|---|---|---|---|
| **M1** | **Day coverage** | distinct days with a snapshot (and a lock) over the window ÷ calendar days in the window | the fraction of days the machine actually observed. A covered day is `OK_NO_CHANGE \| EARNINGS_CHANGED \| STATUS_CHANGED \| BALANCE_CHANGED \| INITIAL_BASELINE \| MONITOR_DEGRADED` | < 95% in 30 days ⇒ find the cause before trusting any trend |
| **M2** | **MISSED_DAY count** | count of `MISSED_DAY` lines (each is one day, exactly one per day by dedupe) | how many days have **no** reading at all. Watch the *run* of consecutive days, not the total | 2+ consecutive ⇒ E1/E5 ladder |
| **M3** | **SKIP_DUPLICATE_DAY count** | count of duplicate-guard lines | proof the R1 lock is doing work — and a warning: a rising count means something (a stray scheduled task, a copied command, a second operator) is invoking the routine more than once a day. Cheap to check, expensive to ignore: two invokers is exactly the condition R1 exists to neutralise | any count > 0 in an unmonitored period ⇒ find the second invoker (C4 today = `0` tasks) |
| **M4** | **DELIVERY_FAILED count** | count of delivery-failure lines | whether the *notification* channel works. Each line carries the full message that failed to be delivered, so the log is the fallback channel. Every failure means R3 was met only as a log entry | 1 ⇒ fix the toast channel (interactive session, PowerShell available); **UNVERIFIED on this host** (§11.5) |
| **M5** | **Degraded-true trend** | `degraded: true` snapshots ÷ snapshots, per week | how much of the panel is *unverified* rather than observed. All operator-entered snapshots are degraded by construction, so this trend reads: "how much of this is my own typed reading?" A 100% degraded month means the routine is a diary, not a monitor — no provider-verified reading exists | 7 consecutive degraded days ⇒ the operator stopped entering readings (§7.4) or the timezone became unresolvable |
| **M6** | **Oldest pending approval age** | `created_at_utc` of the oldest `PENDING` item | whether R4's human gate is *used* or merely *satisfied*. Items never expire, so this only grows if you never decide. An unread queue is a silent backlog, not a safety feature | > 14 days ⇒ decide or reject (a decision is cheap; the routine is not waiting on it) |
| **M7** | **Rule-gate reproduction** | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` and the suite | R2 remains structurally true, and the suite is currently **flaky** (§11.1) — treat a red suite as a finding, not noise | any `failures > 0` ⇒ investigate before claiming green |

---

## §8 Scheduling — **PROPOSAL ONLY**, requiring the operator's explicit written approval

### 8.1 The rule about registering it

> **No agent may register either task. No automated process may register it. Only the operator, after recording explicit written approval, may run the registration commands below.** Registering a scheduled task is an external action with lasting side effects; it is exactly the class of action R4 keeps behind a human. Nothing in this document has been registered: C4 returned `0` matching tasks.

Required approval artifact (to be **created by the operator**, not by this document — path proposed, `NOT CREATED`): `docs/free-cash-monitor-routine/SCHEDULING-APPROVAL.md`, containing at minimum: the two task names, the interpreter absolute path, `FREECASH_DATA_ROOT`, the trigger times, the two policy settings, the approver's name, and the date.

### 8.2 Interpreter: pin the absolute path (the choice is forced by measurement)

| Candidate | Result here | Verdict |
|---|---|---|
| `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` | `Python 3.11.9`; `tzdata 2025.3`; resolves `Europe/Berlin` (`resolved Europe/Berlin`) | **USE THIS** — the only interpreter on this host observed to satisfy the day-key requirement |
| `py -3` (3.14.7) | `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` raised at `C:\Python314\Lib\zoneinfo\_common.py:29` **before** the day lock is created | **MUST NOT BE THE SCHEDULED INTERPRETER** — a run would fail before R1 even applies |
| `python3` | resolves to `…/Microsoft/WindowsApps/python3`, the Store alias stub: `Python wurde nicht gefunden; …` | **MUST NOT BE USED** |

Consequence for the operator: the `python` you use interactively in git-bash is already the correct one; the *scheduler* does not inherit that PATH, which is why the path is pinned absolutely in both task definitions.

### 8.3 The two task definitions

| Field | Task 1 — daily status check | Task 2 — missed-day watchdog |
|---|---|---|
| Name | `FreeCash-DailyMonitorCheck` | `FreeCash-DailyMonitorWatchdog` |
| Trigger | daily at **08:35 operator-local** | daily at **23:50 operator-local** |
| Rationale | §3.2's ritual leaves ~08:35 as the check time; the reading is entered first | fires the same evening, while the operator can still act |
| Program | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` | same |
| Arguments | `D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state` | `D:\AgenticOS\monitoring\freecash\watchdog.py` |
| Start in | `D:\AgenticOS` | `D:\AgenticOS` |
| Environment | `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor`, `FREECASH_TZ=Europe/Berlin` | same |
| Logon type | **only when the operator is logged on** (`InteractiveToken`) — the toast sink needs an interactive session | same (it may also run headless; then R3 is log-only) |
| **MultipleInstances** | **`IgnoreNew`** (a second instance never starts a second status read) | **`IgnoreNew`** |
| **StartWhenAvailable** | **`true`** (a missed start runs late — safe, because R1 still allows only one read per local day) | **`true`** |
| **Restart on failure** | **none — "Do not restart."** A crash/every restart means another invocation; the day lock makes extra invocations harmless but the operator must see the failure, not have it papered over | **none — "Do not restart."** |
| ExecutionTimeLimit | `PT30M` | `PT10M` |
| What it may do | local file reads/writes only; one allowlisted loopback `GET`/`HEAD` at most; one toast | local file reads/writes only; **no socket at all**; one toast |

### 8.4 Policy fields: how they are actually expressed (honest limitation)

`schtasks /Create` has no switch for `MultipleInstances`, `StartWhenAvailable` or restart-on-failure; those live in the task XML (`<Settings>`). Two registration routes, both proposed:

**Route A — XML (authoritative; lets all three policies be pinned exactly).** The operator creates `docs/free-cash-monitor-routine/freecash-daily-check.xml` and `…-watchdog.xml` (`NOT CREATED` by this document) with `<Settings>` containing:

```xml
<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
<StartWhenAvailable>true</StartWhenAvailable>
<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
<ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
<!-- restart-on-failure: deliberately ABSENT (no <RestartOnFailure> element) -->
```

and imports each with:

```bat
schtasks /Create /TN "FreeCash-DailyMonitorCheck" /XML "D:\AgenticOS\docs\free-cash-monitor-routine\freecash-daily-check.xml"
schtasks /Create /TN "FreeCash-DailyMonitorWatchdog" /XML "D:\AgenticOS\docs\free-cash-monitor-routine\freecash-daily-watchdog.xml"
```

**Route B — single-command registration (baseline; policies then verified in the GUI).**

```bat
schtasks /Create /TN "FreeCash-DailyMonitorCheck" /SC DAILY /ST 08:35 /RL LIMITED /F ^
  /TR "cmd /c set \"FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor\" && set \"FREECASH_TZ=Europe/Berlin\" && set \"FREECASH_TOAST_STUB=0\" && \"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" \"D:\AgenticOS\monitoring\freecash\run_daily_check.py\" --source operator_state"

schtasks /Create /TN "FreeCash-DailyMonitorWatchdog" /SC DAILY /ST 23:50 /RL LIMITED /F ^
  /TR "cmd /c set \"FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor\" && set \"FREECASH_TZ=Europe/Berlin\" && \"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" \"D:\AgenticOS\monitoring\freecash\watchdog.py\""
```

Then verify in Task Scheduler → *Properties → Settings*: "If the task is already running, then the following rule applies: **Do not start a new instance**", "Start the task only if…"/**StartWhenAvailable** as desired, "If the task fails, restart every…" **unchecked**.

**Post-registration verification the operator runs (and the only acceptable proof it happened):**

```bash
schtasks //query //fo LIST | grep -icE 'freecash|finance|daily-monitor'   # must be 2, today it is 0
```

`[UNVERIFIED]` Route A/B XML semantics were **not** tested on this host in this session — the only `schtasks` command run was the read-only query (C4). Whether `schtasks /Create` alone yields `IgnoreNew` is therefore **not asserted here**; Route A is the route that pins it explicitly.

### 8.5 Standing statements about scheduling

1. **No agent may register, modify, disable or delete either task.** The commands above are written for the operator's hands only.
2. Registration is valid **only** after the operator's written approval (§8.1) exists, because it is an external action.
3. Scheduling changes nothing about R1–R4: the day lock still allows exactly one read per local day no matter how many times a task fires (`IgnoreNew`, `StartWhenAvailable` and late starts are all safe for the same reason).
4. If the operator prefers the headless variant, set `FREECASH_TOAST_STUB=1` and accept that R3's *delivery* is then satisfied by `alerts.jsonl` alone (labelled `STUB_OK`, never `TOAST_OK`).
5. Until registration happens, the routine's real coverage is **zero**; everything in §3–§6 is a procedure for a routine that is not yet running on a schedule.

---

## §9 Blocked register

| ID | Blocked item | Why blocked | Unblock condition | Owner |
|---|---|---|---|---|
| **B1** | Provider-verified status read (the only thing that makes "no change" mean something) | no live read-only status/earnings source exists for the monitored account; automated access to the consumer platform is prohibited by its own terms `[read from source]` `operator_state.py:1-16` → `PROVIDER-API-RESEARCH.md §7` | a provider-sanctioned read contract, or an official export the operator may read | operator + provider decision (research doc) |
| **B2** | Any unattended day-cycle coverage | nothing is scheduled — `schtasks` match count `0` (C4) | §8 approval + registration by the operator | operator |
| **B3** | R3/R4 exercised on **real** input | `state/operator-state.json → "records": []` (C8); production has one `degraded: true` snapshot and 2 alert lines (C9, C10); `approvals/` empty (C5) | operator enters readings on two consecutive days (one baseline, one change) | operator |
| **B4** | Reproducible green suite | C1 `failures=1` vs C2 `failures=0`, same command: `test_five_concurrent_runs_yield_one_winner` found 3 of 4 expected `SKIP_DUPLICATE_DAY` alert records under 5-way concurrency (stdout showed all 4 skips and exactly 1 `RUN_OK`, so R1 held; the **log** lost a line) | fix the concurrency evidence path (append/parse under concurrent writers) so the assertion is deterministic | engineering |
| **B5** | Real toast delivery verified | every dispatch in this session used `FREECASH_TOAST_STUB=1`; no real balloon was raised, so `TOAST_OK` has never been observed on this host | run one dispatch with the stub unset while logged on and observe the balloon | operator |
| **B6** | Any human decision recorded in production | `approvals/` empty; `decided.jsonl` absent in production (only present in the scratch root of §1.4) | first real change + a human `decide` | operator |
| **B7** | Scheduling policies pinned by command | `MultipleInstances` / `StartWhenAvailable` / restart-on-failure are XML-only; `schtasks /Create` switches do not express them `[UNVERIFIED — not attempted]` | Route A XML import, or GUI confirmation | operator (after §8 approval) |
| **B8** | A defined human identity for `--by` | no named operator is recorded anywhere; the CLI refuses non-human names (exit 4) | operator chooses the exact string they will sign with, and uses it consistently | operator |
| **B9** | Any earning/revenue execution | **by design**: the routine contains no execution path and cannot be made to act on an approval (§5.5); `proposed_action.provider_endpoint` is literally `PROVIDER_ENDPOINT_UNKNOWN` | an explicit, separate human decision to build/operate an execution system outside this routine | operator |

---

## §10 Critical path

Each stage: **Expected Effort**, **Time-to-Revenue**, **Dependencies**, **First Concrete Action**.

| Stage | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **S1 — Operator reading entered (R3 becomes meaningful)** | ~5 min/day, indefinitely | none (monitoring only — this routine cannot produce revenue by design) | operator only; no provider access needed | append one record with today's `day_key` to `data/freecash-monitor/state/operator-state.json`, then run `python monitoring/freecash/run_daily_check.py --source operator_state` |
| **S2 — First real change detected + approval enqueued (R3/R4 first real exercise)** | 2 consecutive days × 5 min | none directly; this is the evidence that the gate works on real input | S1 on two consecutive local days (day 1 baseline, day 2 with a moved figure) | on day 2, enter the reading **before** the run and read `outcome=EARNINGS_CHANGED … notifications=1 approvals=1` |
| **S3 — Notification delivery proven on the real sink** | 30 min, once | none | S2 (or any event that dispatches); interactive logon | run one dispatch with `FREECASH_TOAST_STUB` unset on a scratch `FREECASH_DATA_ROOT` and observe the balloon (closes B5) |
| **S4 — Scheduling approved and registered** | operator decision + ~20 min; 1 day | none; it changes coverage, not revenue | S1–S3 evidence + **written approval** (§8.1) | operator writes `SCHEDULING-APPROVAL.md` (not created by this document), then runs the two `schtasks /Create` commands and re-runs the C4 query expecting `2` |
| **S5 — Green, reproducible gate** | 1–4 h of engineering, 1 day | none | B4 reproduced deterministically under load | re-run `python monitoring/freecash/tests/run_all.py` 5× and capture a deterministic concurrency result; fix the alert-append/parse path if it still loses a line |
| **S6 — Provider-verified reading** | unknown; days-to-weeks of decision latency | the precondition for any earnings insight that is not the operator's own typing | **B1 cleared** (provider-sanctioned read or export) | decide whether to pursue a provider agreement/export path, or permanently accept an operator-entered, degraded-only panel |
| **S7 — Any earning/revenue execution** | out of scope of this routine (would be a new, separately approved system) | this is the only stage that could produce revenue, and it is **not** in this design | B9: explicit human decision + separate R4-compliant execution system | operator states in writing whether manual execution (their own hands, their own login) is the intended revenue path — the monitor's role ends at the approval record |

---

## §11 Verification not performed — stated plainly

### 11.1 The suite is flaky (highest-severity open item)
`failures=1` (C1) vs `failures=0` (C2). The failing assertion is about the **count of alert-log lines** under 5 simultaneous processes, not about the gate: in the failing run, all five processes exited `0`, four printed `SKIP_DUPLICATE_DAY`, one printed `RUN_OK`, and the comparison target was `len(events(root,"SKIP_DUPLICATE_DAY")) == 4` → got `3`. Treat the suite as **indicative, not yet deterministic**, and treat "gate green" as **reproducible only within the same minute it was measured**.

### 11.2 Never exercised on real input
R3 and R4 have never fired on operator-entered production data (C8, C5). Their behaviour here is from the scratch run of §1.4 (`EARNINGS_CHANGED → notifications=1 approvals=1`, decision refusal exit 4, human decision recorded with `execution_state=NOT_EXECUTED`) and from the suite. **Both are synthetic.**

### 11.3 Never scheduled
No task exists (C4). All scheduling content in §8 is a **proposal**; `[UNVERIFIED]` for the XML/policy claims (§8.4).

### 11.4 Not exercised in this session (source-read or suite-only)
`--force-recheck` refusal at the CLI (source `[read from source]`; suite-verified) · the `metrics_http` read source end to end (suite-verified negative controls only) · `RUN_FAILED` exit 5 at the CLI (suite-verified) · email/SMTP sink (off by default; not configured, not tested) · `prune_old_artifacts` retention behaviour · rollback/disengagement procedure (described in `DELEGATION-2026-09-20/WORKFLOW.md §9`, not executed here).

### 11.5 Notification delivery
Every dispatch in this session used the stub, so `STUB_OK` is the only delivery label ever observed by me. `TOAST_OK` on this host is **UNVERIFIED** (B5). What *is* verified is that a stub delivery cannot be mistaken for a real one, by construction of the label.

### 11.6 Repo hygiene respected while producing this document
No git command of any kind was run (no `add`/`commit`/`checkout`/`stash`/`reset`/`clean`). No existing file was modified, moved or deleted; `OPERATIONS-WORKFLOW-PLAN-2026-09-20.md` was confirmed `ABSENT` before writing (C17) and the production state files were only read (`cat`, `find`, `ls`). No scheduled task was created, modified or deleted (C4 is read-only). No provider was contacted, no login was performed, no credential or secret was written or printed anywhere in this document (nothing needed `[REDACTED]`). All writes performed by me outside this report went to `C:/Users/cd-pr/AppData/Local/Temp/fc-opsplan-103678` (scratch, outside the repo); the test suite likewise wrote only to its own temp roots.

---

## §12 One-page operator checklist

| When | Do | Because |
|---|---|---|
| Daily ~08:30 | Log in to your own dashboard yourself; note status, earnings, balance, pending | the routine never logs in and holds no credential (R2) |
| Daily ~08:34 | Append one record for today's `day_key` to `state/operator-state.json` | a reading entered after the run waits until tomorrow (R1 consumes the day) |
| Daily ~08:35 | `python monitoring/freecash/run_daily_check.py --source operator_state` | one check per local day; a second invocation is refused and logged (R1) |
| On a notification | Decide the item, or leave it — either is safe | items never expire and nothing executes (R4) |
| Weekly | M1–M7 from §7 | coverage, missed days, duplicate-guard hits, delivery failures, degraded share, pending age |
| Any day | `python monitoring/freecash/run_daily_check.py --print-state` | read-only ledger + pending count |
| Never | Back-fill a missed day, re-read after a `RUN_FAILED` day, run with `py -3`, or register a task without written approval | each would violate R1, or break the day key, or bypass R4 |

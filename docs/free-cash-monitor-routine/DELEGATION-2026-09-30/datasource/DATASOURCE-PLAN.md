# DATASOURCE-PLAN.md — what feeds the daily figure, and does a real change notify exactly once?

**Delegation:** `DELEGATION-2026-09-30` · workstream 2 (`datasource/`) — rule **3**: *"tell me if earnings or account status changes"*
**Repository:** `D:\AgenticOS` · branch `hermes-rescue-20260908` · tree heavily dirty, **additive only**
**Written:** 2026-09-30, Europe/Berlin
**Interpreter (required, only one with `tzdata`):** `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`
**Evidence bar:** every PASS/VERIFIED below comes from output produced and quoted in *this* session.

**Constraint ledger — what this pass did NOT do:** no scheduled task or cron entry; no modification or deletion of any pre-existing file; no git write verb; no network call of any kind (not even loopback in the proof — the `operator_state` source has zero read ops); no provider contact; no credential read/typed/stored; the production state root `D:\AgenticOS\data\freecash-monitor` was never written by this pass (§7 records both that fact and a *concurrent* workstream's later write). All new files live under `docs/free-cash-monitor-routine/DELEGATION-2026-09-30/datasource/` only.

---

## 0. How to reproduce (two commands)

```bash
cd /d/AgenticOS
PYBIN="/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"

# (a)+(b)+(c) clock-seam harness: two days, a change, a duplicate day, a status change
"$PYBIN" docs/free-cash-monitor-routine/DELEGATION-2026-09-30/datasource/run_change_detection_proof.py

# (b) production-path companion: the real CLI, real clock, same day twice
"$PYBIN" docs/free-cash-monitor-routine/DELEGATION-2026-09-30/datasource/run_cli_same_day_proof.py
```

Both scripts are self-contained, wipe and recreate **their own** throwaway state roots (`_state-root/`, `_state-root-cli/`) under this directory, and print every artifact verbatim. Captured transcripts: `run-output.txt`, `run-output-cli.txt`.

Environment actually used (quoted from `run-output.txt`):

```
interpreter            : C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
tzdata importable      : True
FREECASH_DATA_ROOT     : D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\datasource\_state-root
paths.data_root()      : D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\datasource\_state-root
PRODUCTION root        : D:\AgenticOS\data\freecash-monitor
FREECASH_TZ            : Europe/Berlin
tz resolve             : {"configured": "Europe/Berlin", "kind": "zoneinfo", "available": true, "offset_now": "+0200"}
DEFAULT_SOURCE         : operator_state
FREECASH_READ_SOURCE   : None (unset -> default)
read source resolved   : operator_state
```

Note on the stray-export warning in the brief: in this shell `FREECASH_DATA_ROOT` was **empty/unset** before the scripts ran; the scripts set it explicitly and printed it. `kind=zoneinfo` (not `system-local`) confirms the pinned interpreter resolves the IANA zone, so the day key is real — **VERIFIED**.

---

## 1. Baseline sanity of the code under test (re-run this session)

```
run_all: tests=52 failures=0 errors=0 skipped=0
suite_exit=0
```
```
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
gate_exit=0
```

So the change-detection logic proven below is the same revision the suite and the rule-1 static gate certify. **VERIFIED.**

---

## (a) Reproducible two-day sequence: baseline, then a changed earnings figure

Sequence (harness, `run_change_detection_proof.py`, `BASE = 2026-10-01T06:35Z = 08:35 Europe/Berlin`, the design's run time):

| step | day key | seeded record | injected clock |
|---|---|---|---|
| 1 | `2026-10-01` | earnings 1340, balance 1340, ACTIVE | `2026-10-01T06:35:00Z` |
| 2 | `2026-10-02` | earnings **1670**, balance 1670, ACTIVE | `2026-10-02T06:35:00Z` |
| 3 | `2026-10-02` | (no new record) run again | `2026-10-02T06:35:00Z` |
| 4 | `2026-10-03` | earnings 1670, balance 1670, **RESTRICTED** | `2026-10-03T06:35:00Z` |

Read source is the operator-entered local file, i.e. `DEFAULT_SOURCE = "operator_state"` — the routine's own default, unoverridden.

### Exact `RUN_OK` lines (quoted)

```
--- run day1 baseline (2026-10-01T06:35:00Z) exit=0 ---
  RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
```
```
--- run day2 earnings moved (2026-10-02T06:35:00Z) exit=0 ---
  RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-10-02.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-10-02.lock
```
```
--- run day3 status changed (2026-10-03T06:35:00Z) exit=0 ---
  RUN_OK 2026-10-03 outcome=STATUS_CHANGED source=operator_entered(data_available=True) snapshot=2026-10-03.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-10-03.lock
```

`INITIAL_BASELINE` then `EARNINGS_CHANGED` — exactly as required. Day 3 (`STATUS_CHANGED`) is the other half of rule 3 ("…or account status"), added at no extra cost. **VERIFIED.**

### Resulting snapshot JSON (quoted verbatim)

`snapshots/2026-10-01.json`:
```json
{
  "schema_version": 1,
  "day_key": "2026-10-01",
  "captured_at_utc": "2026-10-01T06:35:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-10-01"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1340,
  "balance_cents": 1340,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "cbf03a7ea89069b8f37d860eca8841eb0cf90d9625921b4cce3bfd99749bfcbc"
}
```

`snapshots/2026-10-02.json`:
```json
{
  "schema_version": 1,
  "day_key": "2026-10-02",
  "captured_at_utc": "2026-10-02T06:35:00Z",
  "source": {
    "kind": "operator_entered",
    "read_ops": [],
    "data_available": true,
    "note": "operator-entered record for 2026-10-02"
  },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1670,
  "balance_cents": 1670,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "709617445096887704e91ce677f925bc299fd29a5ff721182434c037a2ed4d54"
}
```

Two things worth stating plainly: `"read_ops": []` — the operator source performs **zero** network/read operations; and `"degraded": true` on every snapshot — an operator-entered reading is **not** provider-verified and the artefact never claims to be.

### `alerts/alerts.jsonl` rows (6 lines, raw)

```jsonl
{"day_key": "2026-10-01", "dedupe_key": null, "event_id": "d0528957-9bfe-46a3-9c2e-37d640628a32", "event_type": "INITIAL_BASELINE", "message": "First run: baseline recorded for 2026-10-01. No notification sent. Source DEGRADED (operator-entered record for 2026-10-01).", "observed": {"account_status": "ACTIVE", "balance_cents": 1340, "degraded": true, "earnings_total_cents": 1340, "pending_cents": 0, "prior_day_key": null, "source": "operator_entered"}, "severity": "info", "ts_utc": "2026-10-01T06:35:00Z"}
{"day_key": "2026-10-02", "dedupe_key": "47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281", "event_id": "14eb39ba-9ac2-42ca-ad5c-277ebe38c6fa", "event_type": "APPROVAL_PENDING", "message": "Approval item 74782821-7785-465f-82f3-eeb6fb40f943 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "74782821-7785-465f-82f3-eeb6fb40f943", "change_dedupe_key": "47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-10-02T06:35:00Z"}
{"day_key": "2026-10-02", "dedupe_key": "47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281", "event_id": "7c37e602-f87b-4dae-86c4-a9e96c6e65bb", "event_type": "EARNINGS_CHANGED", "message": "[FreeCash] EARNINGS CHANGE 2026-10-02\nEarnings:  $13.40 -> $16.70  (+$3.30)\nBalance:   $16.70 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-10-02)\nDetail:    alerts.jsonl dedupe=47d85a19609e1576\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  74782821-7785-465f-82f3-eeb6fb40f943 (PENDING - yours to decide, nothing executes)", "observed": {"field": "earnings_total_cents", "new_value": 1670, "old_value": 1340, "prior_day_key": "2026-10-01"}, "severity": "notify", "ts_utc": "2026-10-02T06:35:00Z"}
{"day_key": "2026-10-02", "dedupe_key": null, "event_id": "b9a3a0fd-b9bd-4786-84ab-9c87bf1ad0d9", "event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-10-02 already consumed (lock 2026-10-02.lock). Duplicate run performed no read and wrote no snapshot.", "observed": {"lock": "D:\\AgenticOS\\docs\\free-cash-monitor-routine\\DELEGATION-2026-09-30\\datasource\\_state-root\\state\\day-locks\\2026-10-02.lock"}, "severity": "info", "ts_utc": "2026-10-02T06:35:00Z"}
{"day_key": "2026-10-03", "dedupe_key": "ab423bf859529b136d21234230bf04ee873cf6deb01465591a6e71669313a23e", "event_id": "70070120-98b5-4b41-ba86-44f2889792d0", "event_type": "APPROVAL_PENDING", "message": "Approval item 27962e54-e7f0-49b8-8d4b-4b2bdfbcaf94 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.", "observed": {"approval_id": "27962e54-e7f0-49b8-8d4b-4b2bdfbcaf94", "change_dedupe_key": "ab423bf859529b136d21234230bf04ee873cf6deb01465591a6e71669313a23e", "execution_state": "NOT_EXECUTED", "status": "PENDING"}, "severity": "notify", "ts_utc": "2026-10-03T06:35:00Z"}
{"day_key": "2026-10-03", "dedupe_key": "ab423bf859529b136d21234230bf04ee873cf6deb01465591a6e71669313a23e", "event_id": "49115d2a-19d8-4c48-9665-37bd0dcc317f", "event_type": "STATUS_CHANGED", "message": "[FreeCash] STATUS CHANGE 2026-10-03\nAccount status: ACTIVE -> RESTRICTED\nEarnings:  $16.70 (unchanged)  Balance: $16.70 (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-10-03)\nDetail:    alerts.jsonl dedupe=ab423bf859529b13\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  27962e54-e7f0-49b8-8d4b-4b2bdfbcaf94 (PENDING - yours to decide, nothing executes)", "observed": {"field": "account_status", "new_value": "RESTRICTED", "old_value": "ACTIVE", "prior_day_key": "2026-10-02"}, "severity": "notify", "ts_utc": "2026-10-03T06:35:00Z"}
```

Exactly **one** `EARNINGS_CHANGED` row for the 1340→1670 move, carrying `old_value`/`new_value` and `prior_day_key: "2026-10-01"`; the balance move 1340→1670 is **folded into** the earnings event (`"Balance: $16.70 (changed too)"`), which is what the design requires — one distinct change, one row, one notification, not two. The duplicate-day line is row 4 and the `SKIP_DUPLICATE_DAY` message is explicit: *"Duplicate run performed no read and wrote no snapshot."* **VERIFIED.**

### `state/notified-keys.json` dedupe entries (quoted verbatim)

```json
{
  "schema_version": 1,
  "keys": {
    "47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281": {
      "first_notified_at_utc": "2026-10-02T06:35:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-10-02T06:35:00Z"
    },
    "ab423bf859529b136d21234230bf04ee873cf6deb01465591a6e71669313a23e": {
      "first_notified_at_utc": "2026-10-03T06:35:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-10-03T06:35:00Z"
    }
  }
}
```

Cross-check against the routine's own key derivation (`sha256(day|change_type|field|old|new)`):

```
EARNINGS_CHANGED dedupe key (day2) = 47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281
  present in notified-keys.json : True
  entry                          : {"delivery": "STUB_OK", "first_notified_at_utc": "2026-10-02T06:35:00Z", "updated_at_utc": "2026-10-02T06:35:00Z"}
STATUS_CHANGED dedupe key (day3)  = ab423bf859529b136d21234230bf04ee873cf6deb01465591a6e71669313a23e
  present in notified-keys.json : True
  entry                          : {"delivery": "STUB_OK", "first_notified_at_utc": "2026-10-03T06:35:00Z", "updated_at_utc": "2026-10-03T06:35:00Z"}
```

The keys in `notified-keys.json` are byte-identical to the keys the routine computed for those changes, and each key is written with `delivery` — i.e. recorded **before/around** dispatch, per `notify.record_notified_key()` being called before `sender(message)` in `notify.dispatch()`. Delivery label is `STUB_OK`, **never** `TOAST_OK`, because the channel was the offline stub (`FREECASH_TOAST_STUB=1`) — the proof does not claim a real Windows toast fired. **VERIFIED** (dedupe persistence and key equality); the toast itself is **UNVERIFIED** (deliberately stubbed).

Delivery actually attempted (the real dispatch path, stub transport), from `logs/toast-stub.log`:

```
[STUB TOAST 2026-10-02T06:35:00Z] [FreeCash] EARNINGS CHANGE 2026-10-02 | Earnings:  $13.40 -> $16.70  (+$3.30) | Balance:   $16.70 (changed too) | Pending:   $0.00 | Status:    ACTIVE (unchanged) | Source:    DEGRADED (operator-entered record for 2026-10-02) | Detail:    alerts.jsonl dedupe=47d85a19609e1576 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  74782821-7785-465f-82f3-eeb6fb40f943 (PENDING - yours to decide, nothing executes)
[STUB TOAST 2026-10-03T06:35:00Z] [FreeCash] STATUS CHANGE 2026-10-03 | Account status: ACTIVE -> RESTRICTED | Earnings:  $16.70 (unchanged)  Balance: $16.70 (unchanged) | Source:    DEGRADED (operator-entered record for 2026-10-03) | Detail:    alerts.jsonl dedupe=ab423bf859529b13 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  27962e54-e7f0-49b8-8d4b-4b2bdfbcaf94 (PENDING - yours to decide, nothing executes)
```

Two notifications for two distinct changes across two days; **zero** for the baseline day and zero for the duplicate day. The message carries what moved, the source DEGRADED caveat, and `ACTION: No action taken` — rule 4's posture held even on an alarm. **VERIFIED.**

---

## (b) Third same-day run → `SKIP_DUPLICATE_DAY`

Harness (clock-injected, same root, run 3):

```
--- run day2 duplicate (2026-10-02T06:35:00Z) exit=0 ---
  SKIP_DUPLICATE_DAY 2026-10-02
```

and the corresponding append-only log row is quoted in §(a) row 4 (`event_type: SKIP_DUPLICATE_DAY`, `severity: info`).

Production-path companion (`run_cli_same_day_proof.py`: real child process, real clock, **no** clock seam, fresh throwaway root, today's real local day):

```
real local day   : 2026-09-30
--- CLI first run (consumes the day) ---
  command : C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py
  exit    : 0
  stdout  : RUN_OK 2026-09-30 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock

--- CLI second run (same day, duplicate) ---
  command : C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py
  exit    : 0
  stdout  : SKIP_DUPLICATE_DAY 2026-09-30

day-locks present: ['2026-09-30.lock']
snapshots present: ['2026-09-30.json']
alerts.jsonl rows: 2
notified-keys.json: (absent - baseline dispatches nothing)
```

Note the side-effect asymmetry, which is the point of rule 2: after the duplicate run there is still exactly **one** lock, exactly **one** snapshot, and only the two append-only log rows (§(a) shows the same pattern at the harness level). The second run consumed `exit=0` because a duplicate is *not* an error. **VERIFIED** on the real entry point, real clock, real subprocess.

---

## (c) Timing knobs — what had to be overridden, and is the override reachable in production?

**Two knobs exist. Only one of them had to be overridden, and that one is NOT reachable from production.**

### Knob 1 — the injected clock (this is the one I overrode)

There is no "day" parameter anywhere in the routine. The day key is a pure function of *the clock*:

`monitoring/freecash/gate.py:96-102`
```python
def day_key(now=None, tz=None) -> str:
    """Operator-local calendar day for *now* (default: the current instant)."""
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(zone(tz)).date().isoformat()
```

`gate.day_key(now)` is called from `run_daily_check._run()` with the run's `now`, and the lock file name **is** that string (`gate.lock_path(day)` → `state/day-locks/<day>.lock`). So moving `now` forward one day is the only way to reach a second day key without waiting 24 h.

The override mechanism, `monitoring/freecash/paths.py:112-131`:
```python
#: Test/simulation seam: when set, every "now" in the routine resolves to it.
#: The routine itself only sets this while a run is in progress with an injected
#: clock (see run_daily_check.run and watchdog.check); production runs never set it.
_clock_override = None

def set_clock(moment) -> None:
    global _clock_override
    _clock_override = moment

def clear_clock() -> None:
    global _clock_override
    _clock_override = None

def now_utc() -> datetime:
    if _clock_override is not None:
        return _clock_override
    return datetime.now(timezone.utc)
```

and the single production-visible setter, `monitoring/freecash/run_daily_check.py:265-273`:
```python
def run(argv=None, now=None, sender=None, transport=None, base=None) -> int:
    """Entry point.  ``now`` is a test seam: it pins the whole run's clock."""
    if now is not None:
        paths.set_clock(now)
        try:
            return _run(argv, now, sender, transport, base)
        finally:
            paths.clear_clock()
    return _run(argv, now, sender, transport, base)
```

Callers of `paths.set_clock` in the whole routine (grep, this session): `paths.py:118` (definition), `run_daily_check.py:268`, `watchdog.py:48`. Nothing else.

### Knob 2 — the timezone (production-reachable, but it cannot simulate a day)

`FREECASH_TZ` (default `Europe/Berlin`, `gate.py:47-48`) *is* an ordinary environment knob a production run honours, and it does move the day boundary. I deliberately did **not** abuse it: shifting TZ mid-sequence just re-labels the same instant, and changing it between runs raises `MONITOR_DEGRADED` instead of a second day (`run_daily_check.py:348-356`, and the suite covers it as `test_timezone_change_is_reported_as_degraded`). Shifting the zone also cannot produce the required *baseline-then-change* pair, so it is not a substitute for Knob 1.

### Is Knob 1 reachable in production? **No — VERIFIED.**

`monitoring/freecash/run_daily_check.py:467-469`:
```python
def main(argv=None) -> int:
    try:
        return run(argv)
    except ValueError as exc:
```

`main()` calls `run(argv)` with **no** `now`, so `_run(..., now=None)` → `gate.day_key(None)` → `datetime.now(timezone.utc)`. And the CLI carries no day/clock/date flag at all — `build_parser()` (`run_daily_check.py:251-262`) accepts exactly:

```python
parser.add_argument("--source", ...)
parser.add_argument("--base-url", ...)
parser.add_argument("--print-state", action="store_true", ...)
parser.add_argument("--force-recheck", action="store_true", ...)
parser.add_argument("--reason", default=None, ...)
parser.add_argument("--version", action="version", ...)
```

**Consequences, stated plainly:**

1. A production run (`python run_daily_check.py`, which is what a scheduler will call) is **pinned to the real clock** and can only ever produce today's day key. Two consecutive production days are reached by *time passing*, not by anything the operator can set.
2. Therefore the two-day change-detection proof in §(a) is necessarily a **harness-level** proof: it exercises the real entry point (`run_daily_check.run`) through the module's own documented seam, but it cannot be reproduced from the CLI in one sitting. This is a limitation of the *proof*, not of the routine — the routine's day-crossing behaviour is the same code either way (`gate.day_key(now)` sees a different date).
3. What can be and **was** proven on the untouched production path is the duplicate-day half (§(b), real subprocess, real clock).
4. If a *production* means of crossing days is ever wanted, the only paths are: wait for the next local calendar day, or change the OS clock (which the routine does not support and which would also distort `last_attempt_day`/missed-day arithmetic). Adding a `--now`/`--date` CLI flag would be a **new capability and a rule-1/rule-2 risk** (it would let a caller force a second day's read), so it should NOT be added. **Recommendation: keep the seam Python-API-only.**

---

## (d) Ranked read sources for the daily status figure

Ranked by *can this feed the routine today, on this host, without breaching a rule or a ToS*. Every "available today" claim below was checked in this session; inherited claims are labelled.

| # | Source | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action | Available on this host TODAY? |
|---|---|---|---|---|---|---|
| 1 | **Operator-entered local file** (`state/operator-state.json`, source kind `operator_entered`) | **None** — implemented, tested, default (`DEFAULT_SOURCE="operator_state"`) | **Immediate** — a first real reading can be diffed today | Operator opens their own dashboard and types 4 figures once a day | Append one record for today's local day key to `D:\AgenticOS\data\freecash-monitor\state\operator-state.json` (its `records[]` is currently empty, so today's run yields `MONITOR_DEGRADED`) | ✅ **AVAILABLE — proven end-to-end in §(a)/(b)** |
| 2 | **Passive provider-mail / receipt parsing** (IMAP, e.g. the `himalaya` skill / `scripts/notification_service.py` pattern) | Medium — mailbox wiring + regex templates | Days (needs a monitored mailbox) | A mailbox the operator forwards provider mail to; per-template parsers; **no live balance** (post-hoc only) | Identify/create a mailbox for provider mail and confirm 1 real provider email can be fetched read-only | ❌ **NOT AVAILABLE TODAY** — no mailbox/IMAP config wired (inherited: brief V10 found no SMTP/provider config; not re-verified here). Passive and ToS-safe if built |
| 3 | **In-repo AgenticOS HTTP read surface** (`GET http://localhost:3001/api/v1/status/metrics`, `HEAD /api/v1/status`) | Medium — build the route **and** a real figures producer | Weeks — and it would still be a *substitute*, not provider truth | A running AgenticOS server on :3001 serving those paths with real figures; allowlist already permits both paths (`readonly_client.py:43-49`) | Bring up the server and confirm `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/status` returns a code | ❌ **BLOCKED — nothing is listening.** Checked this session: `netstat -ano | grep LISTEN` shows no common dev port, and `curl -m 3 http://127.0.0.1:3001/api/v1/status` returned `000`. No route matching `/api/v1/status` exists under `server/src` (grep → 0 hits), and the in-repo adapter concedes it is not connected: `server/src/adapters/freecashMonitorAdapter.ts:206` → `externalConnected: false`, `'… External FreeCash API connection is not configured.'` |
| 4 | **Live provider API** (read-only status/balance from the operator's real account) | High/indefinite — no contract exists to implement against | Unknown; gated on facts only the operator can supply | (a) *which* provider the account sits on — **unverifiable from this repo**; (b) a read-only token/credential; (c) a documented read-only endpoint | Operator answers "which provider/account is monitored, and can a read-only token be issued?" | ❌ **BLOCKED.** No public API exists for the named consumer platform; its own ToS §16/17 prohibits automated **and** manual monitoring without written consent; `api.freecash.com/v1/status` is a 404; no credentials are configured (all inherited verbatim from `PROVIDER-API-RESEARCH.md` §§0–1, and `readonly_client.py:60` still carries `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`, quoted live this session). Consent would not be reachable from this host even with a token: the provider identity is unknown |
| 5 | **Browser / session automation** (log in as the human, scrape the rendered balance) | Technically medium; **non-starter on policy** | n/a | A browser session, stored session cookies, and **written provider consent** | **None — do not build.** | ❌ **BLOCKED, and by design.** ToS §16/17 bans "any robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring**", and separately bans **manual** monitoring without prior written consent; the platform restricts/terminates accounts for automation, so this path attacks the very account the routine exists to protect. `PROVIDER-API-RESEARCH.md` §7 and §8.2 reach the same verdict ("**Do not build.**"), and the routine's read-only allowlist (`readonly_client.py`) deliberately has **no** provider or session path compiled in |

**Ranking rationale.** Only #1 is live today, and it is also the cheapest and the only one with zero legal exposure — which is why it is the routine's `DEFAULT_SOURCE`. #2 is the best *next* move: passive, cheap, and genuinely non-invasive, but it needs a mailbox that does not exist yet. #3 adds machinery without adding truth (the snapshot stays `degraded: true`). #4 and #5 are **BLOCKED**, not merely unbuilt: #4 is blocked by the absence of any provider contract plus an unknown provider identity, #5 by an explicit ToS prohibition that also risks the monitored account.

---

## 6. VERIFIED vs UNVERIFIED

| # | Claim | Status | Basis |
|---|---|---|---|
| V1 | Real entry point, operator-entered source, throwaway root: day 1 → `INITIAL_BASELINE`, day 2 (earnings 1340→1670) → `EARNINGS_CHANGED` | **VERIFIED** | `RUN_OK` lines quoted in §(a) |
| V2 | Exactly one `EARNINGS_CHANGED` alert row and one notification for that change; balance move folded in, not doubled | **VERIFIED** | 6-row `alerts.jsonl` + `toast-stub.log` quoted in §(a) |
| V3 | Immutable snapshot written per day, `degraded: true`, `read_ops: []` for the operator source | **VERIFIED** | snapshot JSON quoted in §(a) |
| V4 | Dedupe key persisted with the change, matching `sha256(day\|type\|field\|old\|new)` | **VERIFIED** | `notified-keys.json` + computed keys quoted in §(a) |
| V5 | A third same-day run prints `SKIP_DUPLICATE_DAY`, exit 0, no read, no snapshot, no ledger write; still one lock and one snapshot | **VERIFIED** | §(b) harness + real-CLI transcripts |
| V6 | The only timing override used is the injected clock (`paths.set_clock`), whose sole setters are `run_daily_check.run` and `watchdog.check` | **VERIFIED** | grep quoted in §(c); `set_clock` called nowhere else |
| V7 | That override is **not** reachable from production: `main()` → `run(argv)` with `now=None`, and `build_parser()` exposes no day/clock flag | **VERIFIED** | source lines quoted in §(c) |
| V8 | Pinned interpreter resolves `Europe/Berlin` as `zoneinfo` (day key is real, not `system-local`) | **VERIFIED** | `tz resolve` line quoted in §0 |
| V9 | Nothing listening on `127.0.0.1:3001`; no `/api/v1/status` route in `server/src`; adapter reports `externalConnected: false` | **VERIFIED** | netstat/curl + greps + source line quoted in §(d) row 3 |
| V10 | Suite 52/52 and static gate `forbidden=0 exempt=28` on the revision under test | **VERIFIED** | output quoted in §1 |
| V11a | This pass wrote nothing to the production root `D:\AgenticOS\data\freecash-monitor` | **VERIFIED** | `find -printf '%T+'` at 20:59 local (all mtimes still 2026-09-20/21 — §7 phase 1) plus the pinned throwaway roots shown in both transcripts |
| V11b | The production root **was** written at 21:01–21:02 local by a **concurrent** workstream, not by this pass | **VERIFIED** | §7 phase 2 listing + `logs/task-a.log` / `logs/task-b-watchdog.log` quoted; this pass's own lock/snapshot paths are under `_state-root*` |
| V12 | A real Windows toast fired on the operator's desktop | **UNVERIFIED — not claimed** | delivery was the offline stub; labels are `STUB_OK`, never `TOAST_OK` |
| V13 | Provider API availability / ToS wording / credential absence | **UNVERIFIED by this pass — inherited** | quoted from `PROVIDER-API-RESEARCH.md` (fetched 2026-09-17) and `DELEGATION-BRIEF.md` V10; not re-probed here (no provider contact permitted) |
| V14 | Provider-mail/IMAP source feasibility | **UNVERIFIED by this pass** | reasoned from `PROVIDER-API-RESEARCH.md` §7; no mailbox was contacted |
| V15 | Multi-cent / pending-subtype / currency-change exactness of the comparator | **UNVERIFIED directly here, but** covered by the passing suite | `test_one_cent_is_a_change…`, `test_pending_movement_counts_as_an_earnings_change`, `test_currency_change_is_degraded_not_a_change` all `ok` in §1 |

---

## 7. Production root — what this pass wrote there (nothing), and what a concurrent workstream did

### Phase 1 — measured at 20:59 local, while this pass was running

```
=== PRODUCTION ROOT (must be untouched) ===
2026-09-20+21:08:00.7001879000          0 data/freecash-monitor/state/day-locks/2026-09-20.lock
2026-09-20+21:08:00.7189663000        879 data/freecash-monitor/state/operator-state.json
2026-09-20+21:08:00.7234377000        518 data/freecash-monitor/snapshots/2026-09-20.json
2026-09-20+21:08:00.7329127000        341 data/freecash-monitor/state/last-run.json
2026-09-21+18:39:42.1261341000       1635 data/freecash-monitor/alerts/alerts.jsonl
2026-09-21+18:39:48.6723234000        255 data/freecash-monitor/state/notified-keys.json
=== day-locks ===
-rw-r--r-- 1 cd-pr 197609 0 Sep 20 21:08 2026-09-20.lock
```

Every mtime was still 2026-09-20/21 and the only lock was `2026-09-20.lock`. Both proof scripts confirmed `prod root operator-state.json size: 879` before and after. **At that point: this pass had written nothing to production — VERIFIED.** The reason is structural, not lucky: `run_change_detection_proof.py` and `run_cli_same_day_proof.py` both set `FREECASH_DATA_ROOT` to their own throwaway roots before importing the routine, and the transcripts print those roots, e.g.

```
FREECASH_DATA_ROOT     : D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\datasource\_state-root
...
lock=D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\datasource\_state-root-cli\state\day-locks\2026-09-30.lock
```

### Phase 2 — re-checked at 21:02 local (a *concurrent* workstream has since written it)

```
2026-09-30+21:01:05.5325622000          0 data/freecash-monitor/state/day-locks/2026-09-30.lock
2026-09-30+21:02:05.6301726000       2172 data/freecash-monitor/state/notified-keys.json
2026-09-30+21:02:05.6346945000        518 data/freecash-monitor/snapshots/2026-09-30.json
2026-09-30+21:02:05.6541865000        341 data/freecash-monitor/state/last-run.json
2026-09-30+21:02:06.5200774000       8368 data/freecash-monitor/alerts/alerts.jsonl
2026-09-30+21:02:06.5210720000        230 data/freecash-monitor/logs/task-a.log
2026-09-30+21:02:08.6695380000        136 data/freecash-monitor/logs/task-b-watchdog.log
```

`data/freecash-monitor/logs/task-a.log` (read-only):
```
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
SKIP_DUPLICATE_DAY 2026-09-30
```
`data/freecash-monitor/logs/task-b-watchdog.log`:
```
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED
```
`data/freecash-monitor/state/last-run.json`:
```json
{
  "schema_version": 1,
  "last_attempt_day": "2026-09-30",
  "last_success_day": "2026-09-30",
  "last_attempt_at_utc": "2026-09-30T19:01:05Z",
  "last_success_at_utc": "2026-09-30T19:02:05Z",
  "last_outcome": "MONITOR_DEGRADED",
  "consecutive_missed_days": 9,
  "timezone": "Europe/Berlin",
  "updated_at_utc": "2026-09-30T19:02:05Z"
}
```

**This was not this pass.** The writers are named `task-a` / `task-b-watchdog` — a different workstream's (the scheduler workstream's) labelling — and this pass's own lock, snapshot and log paths are all under `_state-root*`, quoted above. The `21:01–21:02` timestamps are also *after* Phase 1 was measured and after this deliverable was drafted.

**Consequences the parent should carry forward (not this pass's doing, but material):**

1. **Today's production day lock is now consumed** (`state/day-locks/2026-09-30.lock`, created 21:01:05 by that other run). Any further run against the production root today prints `SKIP_DUPLICATE_DAY 2026-09-30` — the next real opportunity is the operator-local day `2026-10-01`.
2. The production run was `MONITOR_DEGRADED`, because `state/operator-state.json` is **still** 879 bytes / 2026-09-20 with an empty `records[]`. Source #1 in §(d) is therefore still un-fed in production: the change-detection half is proven, but production has nothing to detect on.
3. `consecutive_missed_days: 9` in the production ledger is the real 2026-09-22 → 2026-09-30 gap, unchanged by this pass.


---

## 8. What this does and does not establish

**Establishes.** On the real entry point, reading the routine's default operator-entered source on a throwaway root, a baseline day is silent (`INITIAL_BASELINE`, no notification, no approval item), the next day's 1340→1670 earnings move produces exactly one `EARNINGS_CHANGED` line, exactly one notification and exactly one `PENDING / NOT_EXECUTED` approval item, an account-status move produces exactly one `STATUS_CHANGED`, a same-day re-run produces `SKIP_DUPLICATE_DAY` with no side effects, and every notification's dedupe key is persisted. So **rule 3's detection-and-notify half is real, not aspirational** — the failure the delegation brief describes ("rule 3 has never had a change to detect") is a *data* failure, not a *logic* failure.

**Does not establish.** No figure in this proof is true: every number was seeded by the harness. No provider was contacted; no credential was used. Nothing here says the operator can comply with the manual chore — that is an operations question. And the two-day crossing itself is a **harness** construct (§(c)): in production the routine reaches a second day only by the clock turning. Finally, as of 21:02 local the production root's **day lock for 2026-09-30 is already consumed** by a concurrent workstream (§7 phase 2), so nothing in production can be exercised again before the operator-local day `2026-10-01`.

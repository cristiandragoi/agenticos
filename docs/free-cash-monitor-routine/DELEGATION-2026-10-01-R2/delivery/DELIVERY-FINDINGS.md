# DELIVERY-FINDINGS — Track 4: R3 (notification) and R4 (approval)

**Delegation:** `DELEGATION-2026-10-01-R2`
**Repo:** `D:\AgenticOS` (Windows 11, git-bash, non-elevated)
**Subject:** `monitoring/freecash/{notify,changedetect,approval_queue,run_daily_check,paths,gate}.py`
**Production state root:** `D:\AgenticOS\data\freecash-monitor`
**Produced:** 2026-10-01

Every row below is a command run in this pass, with its raw output and exit code.
Evidence files sit beside this document (`evidence-*.txt`). Driver scripts are
`drive_r3.py`, `drive_r3_counts.py`, `drive_trace.py`, `drive_r4.py`,
`stage_hardening.py`, `run_proposed_proof.py`.

---

## 0. Method, hermeticity, and what is NOT claimed

Every executed run used `FREECASH_DATA_ROOT` pointed at a throwaway root under
`%LOCALAPPDATA%\Temp`:

| root | used for |
|---|---|
| `%LOCALAPPDATA%\Temp\fc-r2-scratch\{run1,run2,trace,trace-fresh,r4,counts}` | all R3/R4 driving |
| `%LOCALAPPDATA%\Temp\fc-r2-proof` | exercising the staged patch in a copy |
| `%LOCALAPPDATA%\Temp\fc-r2-proposed` | staged copies the diff was generated from |
| `%LOCALAPPDATA%\Temp\fc-r2-baseline` | start-of-pass hashes |

**Hermeticity proof** — `evidence-09-hermeticity.txt`:

```
$ find data/freecash-monitor -type f | sort | xargs sha256sum     # NOW, whole tree
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json
0f28d5699b30c6d7b48224f9fa6da26113938c66fafc99e16f391dbedd60e9dd *data/freecash-monitor/state/notified-keys.json
... exit=0

$ diff <(START hashes) <(NOW hashes)          # diff exit=0   (0 == IDENTICAL)
$ diff baseline-newer.txt now-newer.txt       # diff exit=0   (0 == IDENTICAL file set)
$ test -f data/freecash-monitor/approvals/pending.json
pending.json ABSENT (an approval item has never existed in production)
```

`find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` returned the
same four files before and after my pass (`alerts.jsonl`, `snapshots/2026-10-01.json`,
`state/day-locks/2026-10-01.lock`, `state/last-run.json`) — all four were already
in that set at my *first* command, i.e. they are Oct-1 production activity that
pre-dates this delegation, not mine. No production byte changed.

**Honest limits (BLOCKED items):**

| # | Claim | Status | Reason |
|---|---|---|---|
| B1 | a real Windows balloon visibly appeared | **BLOCKED** | would spam the operator's desktop and I cannot see the screen. Verified instead: `powershell` present (5.1.26100.9444), `NotifyIcon` constructible, and production `notified-keys.json` carries `TOAST_OK ×10`. |
| B2 | `git` proves `monitoring/` untouched | **BLOCKED** | `git status --porcelain monitoring/` → `?? monitoring/` (the tree is **untracked**), so git cannot compare against HEAD. Proof is the sha256 pair before/after in `evidence-07`. |
| B3 | chat delivery works end to end | **BLOCKED** | `hermes send --list` → *"Telegram: (no channels discovered yet)"*. No target resolves, and sending would be an external action R4 forbids without approval. |
| B4 | the 6.5 s burst spacing reproduced live | **BLOCKED (proxy used)** | running the real sink would pop 10 balloons. Proven instead from code (`Start-Sleep -Seconds 6`, the only sleep, `notify.py:179`) **and** the production timestamp deltas (mean 6.62 s). |

---

## 1. R3 mechanics — exact code, then execution

### 1.1 The exact comparison code (`changedetect.py`)

Compared fields are exhaustive and exact (`evidence-01-r3-mechanics-code.txt`):

```python
COMPARED_FIELDS = (                                     # changedetect.py:34-39
    ("account_status", "STATUS_CHANGED", None),
    ("earnings_total_cents", "EARNINGS_CHANGED", None),
    ("balance_cents", "BALANCE_CHANGED", None),
    ("pending_cents", "EARNINGS_CHANGED", "pending"),
)
```

The comparison itself (`changedetect.py:256-275`):

```python
earnings_moved = prior.get("earnings_total_cents") != current.get("earnings_total_cents")
for field, change_type, subtype in COMPARED_FIELDS:
    if field in money_fields:
        continue
    if field == "balance_cents" and earnings_moved:
        continue
    old = prior.get(field)
    new = current.get(field)
    if old == new:
        continue
    change = {"change_type": change_type, "field": field,
              "old_value": old, "new_value": new,
              "prior_day_key": prior.get("day_key")}
    if subtype:
        change["subtype"] = subtype
    result["changes"].append(change)
```

Two consequences worth naming:
* **exact equality, no threshold** — `if old == new: continue`. One cent notifies.
* **earnings swallows the balance** — `if field == "balance_cents" and earnings_moved: continue`
  (comment at `changedetect.py:250-255` cites acceptance test T3.1). An earnings
  change that drags the balance is **one** change, not two.
* **baseline guard** (`changedetect.py:235-241`): if there is no prior snapshot, or
  either side has `source.data_available == False`, `baseline = True` and **no**
  change is reported — a first run can never raise a fake alarm.

### 1.2 The exact dedupe-key construction (`changedetect.py:214-216`)

```python
def dedupe_key(day, change_type, field, old_value, new_value) -> str:
    subject = "%s|%s|%s|%s|%s" % (day, change_type, field, old_value, new_value)
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()
```

called from `run_daily_check.py:102-109`:

```python
def change_dedupe_key(day, change) -> str:
    return changedetect.dedupe_key(
        day, change["change_type"], change["field"],
        change["old_value"], change["new_value"],
    )
```

**The day key is inside the hash.** Verified by reconstruction —
`evidence-02-r3-drive.txt`:

```
reconstructed dedupe_key(2026-09-21,EARNINGS_CHANGED,earnings_total_cents,1000,1500) =
  9910aea316e2073e70a8d56d8bb481cf6764fa74bedb8f5f74bad0f9e8e18a6b
  -> the alert line written by the real run carries dedupe16=9910aea316e2073e
reconstructed dedupe_key(2026-09-22,STATUS_CHANGED,account_status,ACTIVE,REVIEW_REQUIRED) =
  41f5d0d760bf31baa2e5401b66566d4fac9039e0d472b2df014b283f52b70e90
  -> the alert line written by the real run carries dedupe16=41f5d0d760bf31ba
```

`notify.record_notified_key` writes the key into `notified-keys.json`
**before** the dispatch attempt (`notify.py:132-145`, called at `notify.py:224`),
so a crash loses one message but can never duplicate one.

### 1.3 Execution — (a) identical reading

`evidence-02b-r3-dispatch-counts.txt` (sink = stub log, so a "dispatch" is a
countable line):

```
DAY    SCENARIO                NEW_ALERTS  NEW_DISPATCH  OUTCOME
2026-09-19 first run                   1             0    INITIAL_BASELINE
2026-09-20 identical reading           1             0    OK_NO_CHANGE
2026-09-21 earnings 1000->1500         2             1    EARNINGS_CHANGED
2026-09-22 status ACTIVE->REVIEW       2             1    STATUS_CHANGED
2026-09-23 identical again             1             0    OK_NO_CHANGE
```

`RUN_OK 2026-09-20 outcome=OK_NO_CHANGE ... changes=0 notifications=0 approvals=0`
and the single line written is log-only:

```
{"dedupe_key": "", "event_type": "OK_NO_CHANGE", "severity": "info",
 "message": "No change vs 2026-09-19. No notification sent. Source DEGRADED (...)",
 "ts_utc": "2026-09-20T12:00:00Z"}
```

`toast-stub.log exists=False` after that run — **zero** dispatches. Matches
`notify.emit_no_change` (`notify.py:91-99`) which calls `alert()`, never `dispatch()`.

### 1.4 Execution — (b) one figure changed, earnings and status separately

Earnings 1000 → 1500 (`evidence-02-r3-drive.txt`):

```
RUN_OK 2026-09-21 outcome=EARNINGS_CHANGED ... changes=1 notifications=1 approvals=1
NEW lines added this run: 2
  event_type=APPROVAL_PENDING severity=notify dedupe16=9910aea316e2073e
  event_type=EARNINGS_CHANGED severity=notify dedupe16=9910aea316e2073e
```

Two **log lines**, exactly one **notification**. The payload delivered to the sink:

```
[STUB TOAST 2026-09-21T12:00:00Z] [FreeCash] EARNINGS CHANGE 2026-09-21
Earnings:  $10.00 -> $15.00  (+$5.00)
Balance:   $10.00
Pending:   $0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-21)
Detail:    alerts.jsonl dedupe=9910aea316e2073e
ACTION:    No action taken. Review and approve anything you want done.
Approval:  b3bbf0e0-f0ef-441d-a780-5080ef949efd (PENDING - yours to decide, nothing executes)
```

Status `ACTIVE` → `REVIEW_REQUIRED` (`evidence-02-r3-drive.txt`):

```
RUN_OK 2026-09-22 outcome=STATUS_CHANGED ... changes=1 notifications=1 approvals=1
NEW lines added this run: 2
  event_type=APPROVAL_PENDING severity=notify dedupe16=41f5d0d760bf31ba
  event_type=STATUS_CHANGED  severity=notify dedupe16=41f5d0d760bf31ba
```

The `APPROVAL_PENDING` line is `notify.alert()` inside `dispatch_change`
(`run_daily_check.py:152-165`) — a **log record of the enqueue**, not a second
notification. R3 hold: one change → one notification. ✔

### 1.5 Execution — (c) re-running the same change

Two independent gates, both measured:

```
RE-RUN 2026-09-22 (R1 gate):
SKIP_DUPLICATE_DAY 2026-09-22
  new alerts=1  new dispatches=0     # the 1 line is SKIP_DUPLICATE_DAY, log-only

RE-DISPATCH the SAME change object, fresh key (dedupe gate):
  attempt 1 -> NOTIFIED  new dispatches=1
  attempt 2 -> DEDUPED   new dispatches=0
  attempt 3 -> DEDUPED   new dispatches=0
  total stub lines for this key: 1
  notified-keys entry: {"first_notified_at_utc": "2026-10-01T07:14:31Z", "delivery": "STUB_OK", ...}
```

R1 refuses the second read of the day before the compare is even reached; the
dedupe index then makes every later attempt of the same key log-only
(`run_daily_check.py:131-145`, `notify.notify_change` `notify.py:272-281`).
Re-posting an already-seen key returns `"DEDUPED"` and sends nothing.

### 1.6 Execution — (d) multi-day catch-up: **NOT coalesced — it is a burst**

`evidence-02-r3-drive.txt`, ledger rolled to `last_success_day=2026-09-19`, run
on `2026-09-30`:

```
gate.missed_days('2026-09-30', ledger) = ['2026-09-20', ..., '2026-09-29']
count = 10
RUN_OK 2026-09-30 outcome=EARNINGS_CHANGED ... notifications=1
exit_code=0  wall_clock_seconds=0.258 (STUB sender, no toast)
MISSED_DAY alerts produced: 10
stub delivery lines written: 11
Is there ONE coalesced summary? searching for a summary/coalesce line: []
```

**10 separate dispatches.** No summary, no grouping. The only coalescing in the
codebase is `notify_changes` (`run_daily_check.py:176`, `MAX_NOTIFICATIONS = 5`)
and it applies to **snapshot** changes only — the missed-day loop at
`run_daily_check.py:331-347` sits above it and calls `notify.notify_change` per
day with `sleep_seconds=0`.

Production confirms exactly this shape. `evidence-08-production-alerts-characterisation.txt`:

```
### per-alert spacing of the MISSED_DAY burst on 2026-09-30
  2026-09-30T19:01:05Z  +  0.0s  [FreeCash] MISSED DAY 2026-09-21
  2026-09-30T19:01:11Z  +  6.0s  [FreeCash] MISSED DAY 2026-09-22
  2026-09-30T19:01:18Z  +  7.0s  [FreeCash] MISSED DAY 2026-09-23
  ...
  2026-09-30T19:01:58Z  +  7.0s  [FreeCash] MISSED DAY 2026-09-29
  burst length=9  span=53.0s  mean spacing=6.62s

$ grep -c "CHANGES" data/freecash-monitor/alerts/alerts.jsonl
0      grep -c exit=1 (0 matches = no summary line was ever written)
```

**Verdict on (d): a burst, not a coalesced summary.** The 6.6 s cadence is not a
deliberate throttle: `sleep_seconds=0` is passed for every missed day, and the
delay is the toast's own lifetime — `notify.py:179` `"Start-Sleep -Seconds 6;"`
inside the PowerShell script, spawned once per dispatch.

**Amplification (worse than a one-off burst).** Because the dedupe key embeds
`day`, a day that keeps failing re-alerts the whole gap with brand-new keys.
`evidence-02-r3-drive.txt`, PHASE D2:

```
MISSED_DAY alert lines already on disk for run2: 10
gate.missed_days('2026-10-01', ledger) = [...11 days...]   count = 11
MISSED_DAY alert lines now on disk: 21
days alerted TWICE (same missed day, different day_key in the key):
  [FreeCash] MISSED DAY 2026-09-20 x2
  ... (10 days)
distinct MISSED_DAY alerts for 2026-09-20..2026-09-29 re-emitted on 2026-10-01: 10
```

So a week of downtime with a failing return-day run produces ~6.5 s of toasts
per missed day, repeated daily. **This is the notification-fatigue defect in R3**
— not in the change path (which holds perfectly), but in the catch-up path.

---

## 2. Snapshot ordering — and does R3 fire on the first day after a gap?

**Code order** (`run_daily_check.py:402-405`):

```python
prior = changedetect.load_prior_snapshot(day)
snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
verdict = changedetect.compare(prior, snapshot)
snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
```

**Proven by execution, not by reading.** `drive_trace.py` wraps only the two
module attributes `run_daily_check` looks up at call time
(`changedetect.load_prior_snapshot`, `changedetect.save_snapshot`) and records
the order. `evidence-03-snapshot-ordering.txt`:

```
ORDER PROOF -- day 1 (2026-09-24) on an empty root: no prior exists
recorded call order: [["load_prior_snapshot","2026-09-24",null],
                      ["save_snapshot","2026-09-24","written=True"]]
load_prior_snapshot called before save_snapshot? True

ORDER PROOF -- day 2 (2026-09-25) with a change present
recorded call order: [["load_prior_snapshot","2026-09-25","2026-09-24"],
                      ["save_snapshot","2026-09-25","written=True"]]
prior snapshot the compare used: 2026-09-24
```

**Self-comparison is structurally impossible**, twice over:

1. `load_prior_snapshot` skips every key `>= day`
   (`changedetect.py:202-208`), so today's file can never be its own baseline:

```
snapshots on disk before the probe: ['2026-09-24.json', '2026-09-25.json']
changedetect.load_prior_snapshot('2026-09-25') -> day_key=2026-09-24
changedetect.load_snapshot('2026-09-25')      -> day_key=2026-09-25 earnings=900
```

2. `save_snapshot` refuses to rewrite an existing day
   (`changedetect.py:183-189`, `if path.exists(): return path, False`).

**First day after a gap: R3 fires correctly.** The prior snapshot is whatever is
most recent *before* today, however stale. `evidence-03-snapshot-ordering.txt`:

```
FIRST DAY AFTER A GAP -- prior is stale, does R3 still fire?
snapshots on disk: ['2026-09-24.json', '2026-09-25.json']
gate.missed_days('2026-09-30', ledger) = ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']
RUN_OK 2026-09-30 outcome=EARNINGS_CHANGED ... changes=1 notifications=1
recorded call order: [["load_prior_snapshot","2026-09-30","2026-09-25"],
                      ["save_snapshot","2026-09-30","written=True"]]
  EARNINGS_CHANGED dedupe16=324033d622afe88d observed={"field":"earnings_total_cents",
    "new_value":100,"old_value":900,"prior_day_key":"2026-09-25"}
```

It fired against a **5-day-old** snapshot (`900 → 100`, a large drop) and reported
it as one change with `prior_day_key=2026-09-25`. Two honest caveats:

* the movement is attributed to the return day, and only to the return day — a
  change that happened four days ago is reported as "today's" change. There is no
  per-day attribution across a gap, and there cannot be (the intermediate days
  were never read; R1 forbids back-filling them).
* If there is **no** prior snapshot at all, the guard produces silence, not an
  alarm:

```
SECOND-DAY-AFTER-GAP WITH NO PRIOR SNAPSHOT AT ALL (fresh root)
RUN_OK 2026-10-05 outcome=INITIAL_BASELINE ... changes=0 notifications=0
  INITIAL_BASELINE severity=info msg='First run: baseline recorded for 2026-10-05...'
notifications dispatched (stub log lines): 0
```

---

## 3. Sink inventory — where an alert can actually land today

`evidence-04-sink-inventory.txt`. The routine's **only** sender implementations
are two functions (`notify.py:151`, `notify.py:167`), selected in `get_sender()`
(`notify.py:201-206`):

```python
def get_sender():
    if _sender_override is not None:
        return _sender_override
    if os.environ.get("FREECASH_TOAST_STUB") == "1":
        return _stub_send
    return _toast_send
```

| # | Sink | Code path | Live check | Present? |
|---|---|---|---|---|
| 1 | `alerts/alerts.jsonl` append | `notify.alert` → `paths.append_jsonl` (`notify.py:78`, `paths.py:183-200`, single `O_APPEND` write) | production file exists, 15 lines, grew in every scratch run | **YES — always on, cannot be disabled** |
| 2 | Windows toast | `notify._toast_send` → `subprocess.run(["powershell", ...])` (`notify.py:167-192`) | `command -v powershell` → `/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell`; version `5.1.26100.9444`; `NotifyIcon` constructible (`TOAST_SINK_CONSTRUCTIBLE`); production `notified-keys.json` = `Counter({'TOAST_OK': 10})` | **YES — the default delivery channel** |
| 3 | `logs/toast-stub.log` | `notify._stub_send` (`notify.py:151-161`), label `STUB_OK`, never `TOAST_OK` | resolves only when `FREECASH_TOAST_STUB=1`; production `logs/toast-stub.log` → **ABSENT** | offline/test only |
| 4 | SMTP / email | **none** | `grep -rn "smtplib" monitoring/freecash/` → **exit 1, no match**; the only hit anywhere is the docstring line `notify.py:8` | **NO — NOT WIRED** |
| 5 | chat / webhook / HTTP push | **none** | `grep -rniE "telegram\|slack\|discord\|webhook\|sendmail\|smtp" monitoring/freecash/*.py` → one docstring line; `notify.py` imports are only `os, subprocess, time, uuid, paths` | **NO — NOT WIRED** |
| 6 | any other sink | — | `readonly_client._transport` (`readonly_client.py:76`) is the single socket site in the whole routine, GET/HEAD to loopback only | none exists |

**Honest statement of the notification problem.** `notify.py`'s docstring (line 8)
claims *"SMTP — opt-in and OFF by default"*. **There is no SMTP code**: no import,
no credential lookup, no send path. The claim is unbacked and should be deleted or
implemented; leaving it there invites a reader to believe a channel exists that does not.

The live chat sink today is therefore: **a Windows balloon tip that disappears**,
plus an append-only log nobody is paged on.

**Smallest wiring change for chat delivery** (not applied):

```python
# notify.py -- add ONE sender beside _toast_send, and ONE branch in get_sender()
def _chat_send(message: str) -> None:
    """Deliver through the Hermes gateway CLI (no new dependency, no credential here)."""
    completed = subprocess.run(
        ["hermes", "send", "--to", os.environ.get("FREECASH_CHAT_TARGET", "telegram"),
         "--subject", "[FreeCash]"],
        input=message.encode("utf-8"), capture_output=True, timeout=60,
    )
    if completed.returncode != 0:
        raise RuntimeError("chat send exited %s: %s"
                           % (completed.returncode,
                              (completed.stderr or b"").decode("utf-8", "replace")[:200]))
_chat_send.delivery_label = "CHAT_OK"


def get_sender():
    if _sender_override is not None:
        return _sender_override
    if os.environ.get("FREECASH_TOAST_STUB") == "1":
        return _stub_send
    if os.environ.get("FREECASH_CHAT_TARGET"):
        return _chat_send          # chat wins when configured; toast stays the fallback
    return _toast_send
```

That is ~14 added lines in one file, no new package. Grounded on what is actually
installed — `evidence-04` and `evidence-10`:

```
$ command -v hermes
/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes

$ hermes send --list
Available messaging targets:
Telegram:
  (no channels discovered yet — send directly with telegram:<chat_id>, or bare 'telegram' for the home channel)
```

`hermes send` is documented by its own `--help` as *"Pipe text from any shell
script to any messaging platform Hermes is already configured for… no LLM, no
agent loop, no running gateway required for bot-token platforms"*, exit codes
`0 ok, 1 delivery/backend error, 2 usage error`. **Dependency: a resolvable
Telegram target chat id** — the platform credential exists but no channel is
discovered yet.

---

## 4. R4 — approval required, and no execution path

`evidence-05-r4-approval-queue.txt`, `evidence-06-repo-tests.txt`.

### 4.1 The code: PENDING write, the flip, and the frozen fields

`build_item` (`approval_queue.py:108-134`) — the frozen fields are **constants,
not parameters**:

```python
def build_item(day, change, reason, now=None, proposed_action=None) -> dict:
    """Build a PENDING item.  The frozen fields are constants, not parameters."""
    action = dict(proposed_action or {})
    action.setdefault("action_type", ACTION_LABEL_FOR_HUMAN_REVIEW)
    action.setdefault("amount_cents", change.get("new_value") if change else None)
    action.setdefault("destination", "OPERATOR_SPECIFIED - not stored by the routine")
    action.setdefault("provider_endpoint", "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase")
    return {
        "approval_id": str(uuid.uuid4()),
        "created_at_utc": paths.iso_utc(now),
        "day_key": day,
        "change_dedupe_key": change.get("dedupe_key") if change else None,
        "reason": reason,
        "proposed_action": action,
        "status": STATUS_PENDING,
        "status_reason": None,
        "decided_at_utc": None,
        "decided_by": None,
        "decision_note": None,
        # ---- frozen by design: never a date, never an executable state ----
        "expires_at_utc": NO_EXPIRY,                       # == None, line 48
        "execution_state": EXECUTION_STATE_NOT_EXECUTED,   # == "NOT_EXECUTED", line 44
        "execution_allowed_by_this_routine": EXECUTION_ALLOWED_BY_THIS_ROUTINE,  # == False, line 45
    }
```

`enqueue` (`approval_queue.py:137-143`) appends and saves — nothing else:

```python
def enqueue(day, change, reason, now=None, proposed_action=None) -> dict:
    """Add one PENDING item.  Called only on a real change."""
    doc = load_document()
    item = build_item(day, change, reason, now=now, proposed_action=proposed_action)
    doc["items"].append(item)
    save_document(doc, now=now)
    return item
```

The flip to APPROVED (`approval_queue.py:161-201`):

```python
    item["status"] = DECISIONS[decision]        # {"approve": "APPROVED", "reject": "REJECTED"}
    item["status_reason"] = reason
    item["decided_at_utc"] = stamp
    item["decided_by"] = who
    item["decision_note"] = reason
    # Re-assert the frozen fields: a decision must not be able to arm the item.
    item["expires_at_utc"] = NO_EXPIRY
    item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED
    item["execution_allowed_by_this_routine"] = EXECUTION_ALLOWED_BY_THIS_ROUTINE
    save_document(doc, now=now)
    paths.append_jsonl(paths.decided_path(), {...  "expires_at_utc": NO_EXPIRY,
                          "execution_state": EXECUTION_STATE_NOT_EXECUTED,
                          "execution_allowed_by_this_routine": EXECUTION_ALLOWED_BY_THIS_ROUTINE})
```

Note the re-assertion comment: a decision **cannot arm the item**, even by editing
the file first — `decide()` overwrites the fields on the way through.

### 4.2 (b) An invented external action — "withdraw 25 EUR"

`drive_r4.py` calls the real `approval_queue.enqueue` with a `WITHDRAW` action
under a `PYTHONAUDITHOOK` recording `subprocess.Popen / os.system / os.exec /
socket.connect / socket.getaddrinfo / urllib.Request / smtplib.connect`, plus the
routine's own `readonly_client.install_audit_guard()`:

`evidence-05-r4-approval-queue.txt`:

```json
{
  "schema_version": 1,
  "updated_at_utc": "2026-09-30T09:00:00Z",
  "items": [
    {
      "approval_id": "0888ac0d-df58-4462-b226-37803662c8a2",
      "created_at_utc": "2026-09-30T09:00:00Z",
      "day_key": "2026-09-30",
      "change_dedupe_key": "00000000000000000000000000000000000000000000000000000000000000ab",
      "reason": "Earnings moved from $15.00 to $25.00. Review and decide whether any action is wanted.",
      "proposed_action": {
        "action_type": "WITHDRAW",
        "amount_cents": 2500,
        "destination": "OPERATOR_IBAN_PLACEHOLDER",
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

`setdefault` means a caller-supplied `action_type` is kept — so the label is
**caller data**, which is exactly why it is inert: no code reads it.

**Proof nothing ran.** Whole-scratch-tree sha256 diff across the enqueue:

```
files CREATED by enqueue(): ['approvals\\pending.json']
files MODIFIED by enqueue(): []
provider / network / subprocess events observed during enqueue(): NONE
sockets opened during enqueue(): NONE
```

```
  status                                 = 'PENDING'
  expires_at_utc                         = None
  execution_state                        = 'NOT_EXECUTED'
  execution_allowed_by_this_routine      = False
  proposed_action.action_type            = 'WITHDRAW'   (the label is data, not an instruction)
```

And after **all** the R4 probing, including an APPROVED decision:

```
files changed by ALL of the above beyond the approvals/ files:
  (none listed above == nothing outside approvals/ moved)
total subprocess/network/exec events recorded in the entire R4 pass: [5 × subprocess.Popen
  = this script's own CLI invocations]
```

Zero socket events, zero network events. The only subprocess events are my own
`approval_queue.py` CLI calls.

### 4.3 (c) Auto-drain, and "expire into execution" — both impossible

**Auto-drain.** Enumerating every public callable and grepping for a primitive:

```
public callables: ['NotHumanError', 'build_item', 'decide', 'enqueue', 'find_item',
                   'last_nag_utc', 'load_document', 'main', 'nag_due', 'nag_items',
                   'pending_items', 'save_document']
module imports: []
source grep for an execution primitive in approval_queue.py:
  NO MATCHES
```

There is no `drain`, no `execute`, no `run`, no `process`. `enqueue` appends;
`pending_items`/`nag_items`/`last_nag_utc`/`nag_due` read; `decide` records;
`main` is the CLI. `approval_queue.py` imports only `argparse, os, sys, uuid, paths`
— no `subprocess`, no socket, no `urllib`.

**Nothing consumes APPROVED:**

```
$ grep -rn "APPROVED" monitoring/freecash --include=*.py
monitoring/freecash/approval_queue.py:39:STATUS_APPROVED = "APPROVED"
monitoring/freecash/approval_queue.py:41:DECISIONS = {"approve": STATUS_APPROVED, "reject": STATUS_REJECTED}
monitoring/freecash/tests/test_r4_approval.py: ... (assertions only)
```

The only hits outside the constants are **tests**. No branch anywhere acts on
`status == "APPROVED"`.

**"Expire into execution" does not exist.** I hand-edited
`approvals/pending.json` to `expires_at_utc = "2020-01-01T00:00:00Z"` (six years
past) with `status = "PENDING"`:

```
hand-edited pending.json to expires_at_utc=2020-01-01T00:00:00Z (past), status=PENDING
reloading through the routine's own loader:   ... "expires_at_utc": "2020-01-01T00:00:00Z", ...
pending_items() as the routine sees them: 1
nag_due(item, now=2026-09-30)? True  (a nag is a reminder, never an execution)
occurrences of expires_at_utc as something OTHER than an assignment to NO_EXPIRY:
  approval_queue.py:15, 47, 131, 180, 196   (docstring / constant / assignments)
  approval_queue.py:270, 275                (the `list` subcommand PRINTING it)
execution/network events during the 'expired' item's existence: NONE
```

**Honest nuance worth recording:** the routine does *not* defend the file —
a hand-edited past expiry survives `load_document()` verbatim. The safety
property is therefore **"there is no consumer of `expires_at_utc`"**, not
"the field is immutable". That is sufficient today (verified: no branch reads it
to decide anything), but it is a weaker guarantee than the docstring's
*"the field is always `null`"*, which is true only of routine-written items.
Same for a hand-edited `status: APPROVED` — it executes nothing, because nothing
executes anything.

### 4.4 (d) What a decider must be — denylist, and both directions

`approval_queue.py:55-57` and `149-158`:

```python
NON_HUMAN_DECIDERS = frozenset(
    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}
)
...
def _normalise_decider(name) -> str:
    who = (name or "").strip()
    if not who:
        raise NotHumanError("--by is required: a decision must name the human who made it")
    if who.lower() in NON_HUMAN_DECIDERS:
        raise NotHumanError(
            "refused: %r is not a human identity; this routine may only record a "
            "decision made by a person" % who
        )
    return who
```

**This is a denylist, not an allowlist.** It rejects ten known machine words and
accepts everything else. Both directions, by execution:

```
NON_HUMAN_DECIDERS = ['agent','automation','bot','cron','machine','monitor','routine','scheduler','script','system']
-> this is a DENYLIST of known machine words, not an allowlist of known humans.

  by=''                 (empty)                          -> REFUSED(NotHumanError)
  by='   '              (whitespace only)                 -> REFUSED(NotHumanError)
  by='system'           (in the denylist)                 -> REFUSED(NotHumanError)
  by='System'           (denylist entry, mixed case)      -> REFUSED(NotHumanError)
  by='  routine  '      (denylist entry, padded)          -> REFUSED(NotHumanError)
  by='agent'            (in the denylist)                 -> REFUSED(NotHumanError)
  by='cron'             (in the denylist)                 -> REFUSED(NotHumanError)
  by='monitor'          (in the denylist)                 -> REFUSED(NotHumanError)
  by='Jarvis'           (NOT in the denylist)             -> ACCEPTED
  by='freecash-monitor' (NOT in the denylist)             -> ACCEPTED
  by='DeepSeek-v4-flash'(NOT in the denylist)             -> ACCEPTED
  by='python3'          (NOT in the denylist)             -> ACCEPTED
  by='Ada Lovelace'     (a human)                         -> ACCEPTED
```

CLI exit codes confirm the same, end to end:

```
$ approval_queue.py decide --id 0888ac0d... --decision approve --by system --note n
  exit=4
  stderr="REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person"
$ approval_queue.py decide --id 0888ac0d... --decision approve --by Jarvis --note auto
  exit=0
  stdout='recorded APPROVED for 0888ac0d... by Jarvis at 2026-10-01T07:09:04Z
          execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)'
$ approval_queue.py list
  exit=0
  stdout='0888ac0d-...  APPROVED 2026-09-30  expires_at_utc=None  execution_state=NOT_EXECUTED'
```

**Verdict: a bypassable denylist.** `--by "Jarvis"` and `--by "freecash-monitor"`
are accepted by the very routine they claim a human decided. The consequences are
currently contained — an APPROVED item still shows
`execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=false` — so the
defect is **latent, not live**: it becomes a real control failure the moment an
execution path is designed against this queue. Fix it *before* building that path,
not after.

**Independent confirmation of the R4 claims** — the repo's own offline suite,
`evidence-06-repo-tests.txt`:

```
$ FREECASH_DATA_ROOT=... FREECASH_TOAST_STUB=1 FREECASH_TZ=UTC python monitoring/freecash/tests/run_all.py
run_all: tests=52 failures=0 errors=0 skipped=0
run_all exit=0
```

(`tests/_support.py:49,53` allocates its own `TemporaryDirectory(prefix="freecash-test-")`
per test and points `FREECASH_DATA_ROOT` at it, so the suite is hermetic without a
root from me.) `test_r4_approval.py` contains `T4.3 -- a past expiry and an
APPROVED status still execute nothing`.

---

## 5. Alert-surface hardening — staged, **NOT APPLIED**

**File:** `proposed-alerts-writer-tag-and-catchup-coalesce.diff` (144 lines, 72
added / 18 removed, two files). It was **never applied**. `evidence-07-alert-surface-hardening.txt`:

```
### CMD: sha256sum monitoring/freecash/notify.py monitoring/freecash/run_daily_check.py   (BEFORE)
9bfca8cddfdea913353e7a27bb6bb9d0c17f5959c3ca11935954a0c445abcb22 *monitoring/freecash/notify.py
bda54e7d56d31f2eb7d70ae1fb5697ef4e08693060fbd2ee5c6b81327487a54c *monitoring/freecash/run_daily_check.py

### CMD: python delivery/stage_hardening.py delivery/proposed-...diff
diff notify.py -> exit=1, 56 diff lines
diff run_daily_check.py -> exit=1, 70 diff lines

### CMD: sha256sum ... (AFTER)      -> IDENTICAL, both files
### CMD: find monitoring/freecash -type f -newermt "2026-10-01 00:00"   -> no output
```

The diff was generated by copying the two files to `%LOCALAPPDATA%\Temp` and
running `diff -u` against the untouched originals, so it is a real unified diff,
not a hand-drawn sketch. Its substance:

```diff
--- a/monitoring/freecash/notify.py
+++ b/monitoring/freecash/notify.py
@@ -21,6 +21,7 @@
 import os
 import subprocess
+import sys
 import time

@@ -48,6 +49,15 @@
 _sender_override = None
 
+#: Provenance stamped onto every line this PROCESS appends.  One field answers
+#: "which process wrote this line?" -- a burst of identical alerts from an
+#: unknown writer is exactly the failure this field makes visible.
+_WRITER = {
+    "pid": os.getpid(),
+    "entry_point": os.path.basename(sys.argv[0] or "") or "unknown",
+    "started_utc": paths.iso_utc(),
+}
+
@@ -66,6 +76,7 @@
     record = {
+        "writer": dict(_WRITER),
         "event_id": str(uuid.uuid4()),
         "ts_utc": paths.iso_utc(),

--- a/monitoring/freecash/run_daily_check.py
+++ b/monitoring/freecash/run_daily_check.py
@@ -328,23 +328,51 @@
-    for missed_day in missed:
-        change = {...}
-        key = changedetect.dedupe_key(day, "MISSED_DAY", "last_success_day", missed_day, ...)
-        notify.notify_change(day, change, notify.message_missed_day(...), key, sender=sender, sleep_seconds=0)
+    if len(missed) > 1:
+        # A catch-up is ONE event, not N.  Every day still gets its own
+        # log-only MISSED_DAY line (the per-day audit record is not lost), but
+        # exactly one notification is dispatched, naming N and the day keys.
+        for missed_day in missed:
+            notify.alert("MISSED_DAY", day, notify.message_missed_day(...),
+                         severity=notify.SEVERITY_ALERT,
+                         dedupe_key=changedetect.dedupe_key(day, "MISSED_DAY", "last_success_day", missed_day, ...),
+                         observed={"missed_day": missed_day, "coalesced": True})
+        key = changedetect.dedupe_key(day, "MISSED_DAY", "missed_days", missed[0],
+                                      "%d:%s" % (len(missed), missed[-1]))
+        if not notify.key_seen(key):
+            notify.dispatch(notify.message_missed_days(day, missed, ledger.get("last_success_day")),
+                            key, day, "MISSED_DAY", sender=sender, sleep_seconds=0)
+    else:
+        ... existing single-day path unchanged ...
```

plus a new `message_missed_days(day, missed, last_success)` template naming N and
every day key. **Not changed:** the comparison, the dedupe-key construction, R1,
R2, R4.

**Proven to work — in a throwaway copy, still not applied.**
`evidence-07b-proposed-patch-proof.txt` builds `%LOCALAPPDATA%\Temp\fc-r2-proposed-pkg`
(copy of `monitoring/freecash` overlaid with the staged files) and re-runs the
identical catch-up scenario:

```
notify loaded from:          C:\...\fc-r2-proposed-pkg\notify.py
run_daily_check loaded from: C:\...\fc-r2-proposed-pkg\run_daily_check.py
missed days (10): ['2026-09-20', ..., '2026-09-29']

DISPATCHES SENT TO THE SINK: 1   (was 10 before the change)
---
[FreeCash] 10 MISSED DAYS 2026-09-30
No successful status check recorded for: 2026-09-20, 2026-09-21, ..., 2026-09-29
First missed: 2026-09-20.  Last missed: 2026-09-29.
Last success: 2026-09-19.
Per-day detail: alerts.jsonl (one MISSED_DAY line per day, no notification).
ACTION:    No action taken. Investigate why no check ran (...)

alerts.jsonl lines written: 11
every line now carries a writer object:
  MISSED_DAY  writer={'entry_point': 'run_proposed_proof.py', 'pid': 31412, 'started_utc': '2026-10-01T07:12:39Z'}
  ... (×10)
MISSED_DAY log lines still one-per-day: 10
coalesced summary dispatched once: True

### CMD: sha256sum monitoring/freecash/notify.py ... (AFTER the proof run)   -> IDENTICAL
### CMD: find monitoring/freecash -type f -newermt "2026-10-01 00:00"        -> no output
```

10 dispatches → 1. The per-day audit lines are preserved (log-only), so nothing
is hidden from the log. Measured effort basis: **72 added / 18 removed lines
across 2 files** (`evidence-10-effort-basis.txt`).

---

## 6. Expected Effort / Time-to-Revenue / Dependencies / First Concrete Action

### 6.1 R3 wiring — make the notification actually reach a human

| | |
|---|---|
| **Expected Effort** | **~0.5 day (≈4 h).** Measured basis: `get_sender()` is 6 lines (`notify.py:201-206`); the proposed `_chat_send` + branch is ~14 added lines in **one** file; the transport (`hermes send`) is already installed — no new dependency, no credential handling. Plus ~0.5 h to re-run the 52-test suite. |
| **Time-to-Revenue** | **0 days of direct revenue.** This does not earn; it makes the monitor's findings *reachable*, which is the precondition for acting on any of them. Fastest path is same-day: it is a config value plus one sender. |
| **Dependencies** | (1) `hermes` on PATH — **present** (`.../venv/Scripts/hermes`). (2) A resolvable Telegram target chat id — **currently missing**: `hermes send --list` says *"no channels discovered yet"*. (3) Operator decides the target and whether the toast stays as fallback. (4) `FREECASH_CHAT_TARGET` must be exported in the scheduler's environment, not just the interactive shell. |
| **First Concrete Action** | Resolve the target and prove delivery **before** touching code: `hermes send --list telegram`, then `echo "[FreeCash] sink test $(date -u +%FT%TZ)" \| hermes send --to telegram`. If that exits non-zero, no code change is worth making yet. |

### 6.2 R4 hardening — turn the decider check into a real control

| | |
|---|---|
| **Expected Effort** | **~0.25–0.5 day.** Replace the 10-word `NON_HUMAN_DECIDERS` denylist (`approval_queue.py:55-57`) with an allowlist read from `approvals/deciders.json` (or bind `--by` to the OS user / require a second `--confirm` token): ~20–30 lines + one config file + a failing test asserting `--by Jarvis` is **REFUSED**. |
| **Time-to-Revenue** | **0 days, and explicitly deferrable.** There is no execution path today (`evidence-05`: no consumer of `APPROVED`, zero socket events), so hardening a gate that guards nothing yields no revenue and no immediate risk reduction. The correct sequencing is: **harden the decider before — or in the same change as — the first execution path**, never after. |
| **Dependencies** | (1) The operator supplies the real allowlist of human identities. (2) A decision: is the decider *verified* (OS username, signed token) or merely *asserted* (a typed string)? An allowlist of asserted strings is still forgeable — decide this consciously. (3) Must land with a regression test; `tests/run_all.py` is the gate. |
| **First Concrete Action** | Write the failing test first (TDD, and the repo's convention): add `test_decider_allowlist.py` asserting `approval_queue.decide(..., by="Jarvis")` raises `NotHumanError`, run `python monitoring/freecash/tests/run_all.py`, confirm **RED**, then implement. |

### 6.3 Alert-surface hardening — the staged diff (recommended, cheap)

| | |
|---|---|
| **Expected Effort** | **~2–3 h.** Measured: 72 added / 18 removed lines across 2 files, already written and already **validated end-to-end in a copy** (10 dispatches → 1; writer tag on every line). Remaining work is review + `git apply`, and re-running the 52-test suite. |
| **Time-to-Revenue** | **0 days of direct revenue; reduces triage cost on the next outage.** Concrete saving: the 2026-09-30 incident burned 53 s of toast cadence and 9 alerts for one event; the same day costs 1 alert and ~0 s after the change. Without this, the D2 amplification (`evidence-02`, PHASE D2: 10 days re-alerted on every failing day) compounds indefinitely. |
| **Dependencies** | None new — stdlib only, no new import beyond `sys`. Must be applied with the routine **stopped** (no run mid-patch), by a human, from the delegation folder. Note `monitoring/` is **untracked in git** (`evidence-07`), so `git apply` will not work as-is: use `patch -p1 --dry-run` first. |
| **First Concrete Action** | Dry-run the patch, then re-run the suite against the patched tree: `cd /d/AgenticOS && patch -p1 --dry-run < docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/delivery/proposed-alerts-writer-tag-and-catchup-coalesce.diff`. If it applies clean, apply it and run `python monitoring/freecash/tests/run_all.py` — expect `tests=52 failures=0`. |

---

## 7. Verdict

**R3 (notify on change): the change path is correct; the catch-up path is not.**

* Identical reading → one `OK_NO_CHANGE` log line, **zero** notifications. ✔
* One changed figure → **exactly one** notification, one line per change, correct
  severity (`notify` for a change, `alert` for a missed day / failure). ✔
* Re-run and re-dispatch → R1 refuses first, dedupe suppresses after;
  `notified-keys.json` records the key **before** dispatch. ✔
* Multi-day catch-up → **9–10 separate dispatches ~6.6 s apart, no summary**
  (mean spacing 6.62 s over 53 s in production). **This is the fatigue defect.**
  Worse, it re-fires the whole gap every day until a run succeeds, because the
  dedupe key embeds the day. ✘
* Delivery is a **Windows balloon tip that vanishes**, plus an append-only log.
  SMTP and chat are **not wired** — the SMTP claim in `notify.py:8` is unbacked. ✘

**R4 (human approval before any external action): holds today, with one latent hole.**

* Enqueue writes `PENDING`, `expires_at_utc: null`, `execution_state: NOT_EXECUTED`,
  `execution_allowed_by_this_routine: false`; `decide` re-asserts all three. ✔
* `approval_queue.py` contains **no** execution primitive; **nothing anywhere
  consumes `APPROVED`**; a hand-edited past expiry executes nothing. Verified with
  audit hooks: zero socket events, the only changes under `approvals/`. ✔
* The decider check is a **bypassable denylist** — `--by "Jarvis"`, `--by
  "freecash-monitor"`, `--by "python3"` are all accepted. Latent, because nothing
  executes. **Fix before designing an execution path.** ✘ (latent)

**Hermeticity:** production root byte-identical before/after; `approvals/` still
empty; `pending.json` has never existed in production. ✔

---

## 8. Evidence index

| File | Contents |
|---|---|
| `evidence-01-r3-mechanics-code.txt` | sha256 + exact source quotes: `dedupe_key`, `compare`, `COMPARED_FIELDS`, `load_prior_snapshot`, `change_dedupe_key`, `key_seen`, `record_notified_key`, `dispatch`, `alert`, `append_jsonl` |
| `evidence-02-r3-drive.txt` | R3 driven through `run_daily_check.run`: phases 1–5, 5c, D, D2; payloads; approval JSON; catch-up counts; amplification |
| `evidence-02b-r3-dispatch-counts.txt` | per-scenario log-line vs dispatch counts table |
| `evidence-03-snapshot-ordering.txt` | call-order trace; self-comparison impossibility; first day after a gap; no-prior-snapshot silence |
| `evidence-04-sink-inventory.txt` | every sink, its code path, and a live presence check for each |
| `evidence-05-r4-approval-queue.txt` | R4: enqueue JSON, no-execution proof, auto-drain impossibility, expire-into-execution failure, denylist both directions, CLI exit codes |
| `evidence-06-repo-tests.txt` | `run_all.py` → `tests=52 failures=0 errors=0 skipped=0`, exit 0 |
| `evidence-07-alert-surface-hardening.txt` | sha256 before/after staging; diff generation; `monitoring/` untouched |
| `evidence-07b-proposed-patch-proof.txt` | staged patch exercised in a copy: 10 dispatches → 1, writer tag present |
| `evidence-08-production-alerts-characterisation.txt` | production `alerts.jsonl` read-only: key set per line, event counts, **no writer field**, 6.62 s burst spacing, no summary line |
| `evidence-09-hermeticity.txt` | whole-tree hashes; start-vs-now diff (identical); `approvals/` empty |
| `evidence-10-effort-basis.txt` | measured inputs behind §6 |
| `proposed-alerts-writer-tag-and-catchup-coalesce.diff` | the staged patch — **NOT APPLIED** |
| `drive_r3.py`, `drive_r3_counts.py`, `drive_trace.py`, `drive_r4.py`, `stage_hardening.py`, `run_proposed_proof.py` | the drivers; each prints the raw output captured above |

# APPROVAL GATE & NOTIFICATION DELIVERY — rule 4 (and the rule-3 delivery half)

**Repository:** `D:\AgenticOS` · branch `hermes-rescue-20260908` · HEAD `8f7463a` · `git status --short | wc -l` = **842** at session start (heavily dirty; additive-only respected)
**Written:** 2026-09-30 21:0x, Europe/Berlin (CEST, UTC+2) · **Author:** delivery sub-agent (Hermes)
**Interpreter used for every quoted run:** `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`
**State root used for every quoted run:** `C:\Users\cd-pr\AppData\Local\Temp\fc-deliv-1790794557\root_*` (throwaway; `FREECASH_DATA_ROOT` set explicitly, overwriting the empty stray export — `echo "FREECASH_DATA_ROOT=[${FREECASH_DATA_ROOT}]"` → `[]`).
**Production state root `D:/AgenticOS/data/freecash-monitor`:** NOT written. Proof in §6.
**Files created by this pass:** this file only (inside `…/DELEGATION-2026-09-30/delivery/`). No source file modified, no scheduler entry, no cron job, no message/mail/webhook/toast sent, no git write verb, no network beyond loopback, no credential read.

---

## 0. Verdict summary

| # | Claim | Verdict |
|---|-------|---------|
| 1 | The approval queue refuses a decision that names no human (`--by` absent) | **VERIFIED** |
| 2 | The approval queue refuses a decision signed with a machine identity (`system`, `scheduler`, `MONITOR`, `agent`, `cron`, `machine`) | **VERIFIED** |
| 3 | There is no execution path: no subcommand, no library callable, and a crafted APPROVED + long-expired item still runs nothing | **VERIFIED** |
| 4 | A pending item is untouched by a day boundary, and there is no deadline in the code that can fire it | **VERIFIED** |
| 5 | `execution_state` is *always* `NOT_EXECUTED`; only one assignment exists in non-test code | **VERIFIED** |
| 6 | The human-identity gate is an exact-match denylist, not a provenance check: `--by "Hermes Agent"` / `"agent-1"` / `"FreeCash Monitor Bot"` are **accepted** | **VERIFIED — DEFECT (see §1.5)** |
| 7 | The only off-host-capable sink on this host is Telegram, and nothing in the routine can reach it | **VERIFIED** |
| 8 | Email/SMS/webhook delivery is unavailable on this host today | **VERIFIED (absence established by probe)** |
| 9 | A Windows toast would reach the operator's live desktop session | **VERIFIED as capability; NOT exercised (forbidden — it would notify the user without his approval)** |
| 10 | Delivering to a local file the operator reads is *not* an external action under rule 4 | **VERIFIED as a classification judgement (code + policy reasoning, not a run)** |

Suite context (not the deliverable, quoted for honesty): `run_all: tests=52 failures=0 errors=0 skipped=0` — **4 consecutive runs, each with its own isolated root** (`suite_1..4.txt`); `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` → `PASS`. A single green run would not have been quotable (the R1 concurrency test has flaked on this tree before); 4/4 removes the best-run ambiguity for *this* pass.

---

## 1. (a) Illegitimate actions actually attempted against the approval queue

**Method.** Probe: `C:\Users\cd-pr\AppData\Local\Temp\fc-deliv-1790794557\probe_approval.py` → raw output `out_approval.txt` (185 lines). It drives the real CLI as a child process and the real library functions, hashes **every file in the throwaway state root** before and after each attempt (`sha256`), and prints the queue item's frozen fields after each attempt. A pending item was first produced through the routine's own path, not hand-written:

```
P0  produce a REAL pending item through the routine's own path
    run_daily_check.run(now=2026-10-01) -> 0      RUN_OK 2026-10-01 outcome=INITIAL_BASELINE … approvals=0
    run_daily_check.run(now=2026-10-02) -> 0      RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED … changes=1 notifications=1 approvals=1
    approval_id = 39dd2630-7181-4b7e-8eb0-2ee0a1880225
    item: status=PENDING  execution_state=NOT_EXECUTED  expires_at_utc=None  execution_allowed_by_this_routine=False  decided_by=None
    item JSON: {"approval_id": "39dd2630-…", "execution_allowed_by_this_routine": false, "execution_state": "NOT_EXECUTED",
                "expires_at_utc": null, "proposed_action": {"action_type": "REQUEST_PAYOUT", …, "provider_endpoint":
                "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"}, "status": "PENDING", "status_reason": null, …}
```

The tree baseline the three attempts are measured against (9 files, `sha256` prefixes):

```
BASELINE tree hash map (9 files):
  15a114651615089a  alerts/alerts.jsonl
  49a12922f5f24ff9  approvals/pending.json
  3614d1348f68493a  snapshots/2026-10-01.json
  caea65683a135e35  snapshots/2026-10-02.json
  e3b0c44298fc1c14  state/day-locks/2026-10-01.lock
  e3b0c44298fc1c14  state/day-locks/2026-10-02.lock
  6bd5793617e3e7b0  state/last-run.json
  50c789aa3fe2e7d3  state/notified-keys.json
  3b41faaa2d7af65d  state/operator-state.json
```

### 1.1 Attempt #1 — decide WITHOUT `--by`

CLI (the flag omitted entirely):

```
$ python.exe D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id 39dd2630-… --decision approve --note auto-approve
exit=2
stderr> usage: approval_queue.py decide [-h] --id ID --decision {approve,reject} --by
                                BY --note NOTE
approval_queue.py decide: error: the following arguments are required: --by
queue: status=PENDING  execution_state=NOT_EXECUTED  expires_at_utc=None  execution_allowed_by_this_routine=False  decided_by=None
decided.jsonl exists: False
  (not one byte of the state root changed)
```

Library level, bypassing argparse — the guard is in the function, not only in the CLI:

```
[P1b library] approval_queue.decide(id, 'approve', None, 'auto-approve')
  NotHumanError: --by is required: a decision must name the human who made it

[P1c library] approver name = '   ' (whitespace)
  NotHumanError: --by is required: a decision must name the human who made it
  queue: status=PENDING  execution_state=NOT_EXECUTED  expires_at_utc=None  execution_allowed_by_this_routine=False  decided_by=None
  decided.jsonl exists: False
  (not one byte of the state root changed)
```

Code path (`monitoring/freecash/approval_queue.py:149-158`):

```python
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

**VERIFIED.** Error quoted; `execution_state` unchanged (`NOT_EXECUTED`); item still `PENDING`; `decided.jsonl` still absent; whole-tree hash identical.

### 1.2 Attempt #2 — decide WITH a machine-looking approver name

```
NON_HUMAN_DECIDERS = ['agent', 'automation', 'bot', 'cron', 'machine', 'monitor', 'routine', 'scheduler', 'script', 'system']

$ … approval_queue.py decide --id 39dd2630-… --decision approve --by system --note automated
exit=4
stderr> REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person
queue: status=PENDING  execution_state=NOT_EXECUTED  expires_at_utc=None  execution_allowed_by_this_routine=False  decided_by=None
decided.jsonl exists: False
  (not one byte of the state root changed)

$ … approval_queue.py decide --id 39dd2630-… --decision approve --by scheduler --note automated
exit=4
stderr> REFUSED: refused: 'scheduler' is not a human identity; this routine may only record a decision made by a person
  (not one byte of the state root changed)

$ … approval_queue.py decide --id 39dd2630-… --decision approve --by MONITOR --note automated
exit=4
stderr> REFUSED: refused: 'MONITOR' is not a human identity; this routine may only record a decision made by a person
  (not one byte of the state root changed)

[P2 library] --by 'agent'   -> NotHumanError: refused: 'agent' is not a human identity; …
[P2 library] --by 'cron'    -> NotHumanError: refused: 'cron' is not a human identity; …
[P2 library] --by 'machine' -> NotHumanError: refused: 'machine' is not a human identity; …
  decided.jsonl exists: False
  (not one byte of the state root changed)
```

Note the case-insensitivity: `MONITOR` is refused because the set test runs on `who.lower()`.

**VERIFIED.** Error quoted; `execution_state` unchanged; item still `PENDING`; nothing written.

### 1.3 Attempt #3 — EXECUTE a pending item

```
$ … approval_queue.py execute --id 39dd2630-…
exit=2
stderr> usage: approval_queue.py [-h] {decide,list} ...
approval_queue.py: error: argument command: invalid choice: 'execute' (choose from 'decide', 'list')
  (not one byte of the state root changed)

$ … approval_queue.py decide --id 39dd2630-… --decision execute --by "Operator Jane" --note "run it"
exit=2
stderr> approval_queue.py decide: error: argument --decision: invalid choice: 'execute' (choose from 'approve', 'reject')
  (not one byte of the state root changed)

$ … approval_queue.py approve --id 39dd2630-…
exit=2
stderr> approval_queue.py: error: argument command: invalid choice: 'approve' (choose from 'decide', 'list')
  (not one byte of the state root changed)

[P3d library] public callables in approval_queue: ['ACTION_LABEL_FOR_HUMAN_REVIEW', 'DECISIONS', 'EXECUTION_ALLOWED_BY_THIS_ROUTINE',
  'EXECUTION_STATE_NOT_EXECUTED', 'NAG_EVENT', 'NAG_INTERVAL_DAYS', 'NON_HUMAN_DECIDERS', 'NO_EXPIRY', 'NotHumanError',
  'SCHEMA_VERSION', 'STATUS_APPROVED', 'STATUS_PENDING', 'STATUS_REJECTED', 'argparse', 'build_item', 'decide', 'enqueue',
  'find_item', 'last_nag_utc', 'load_document', 'main', 'nag_due', 'nag_items', 'os', 'paths', 'pending_items', 'save_document', 'sys', 'uuid']
  hasattr(approval_queue, 'execute')  = False
  hasattr(approval_queue, 'run')      = False
  hasattr(approval_queue, 'perform')  = False
  hasattr(approval_queue, 'withdraw') = False
  hasattr(approval_queue, 'payout')   = False
```

The strongest available "execute" attempt — an item that *is* APPROVED and whose `expires_at_utc` is **long past**, run through the full routine, the watchdog and the CLI:

```
P4  craft an item with status=APPROVED and a LONG-PAST expires_at_utc (2025-12-08T09:00:00Z), then run
    run_daily_check.run(now=2026-10-31) -> 0
    watchdog.check(now=2026-10-31) -> alarm=False
11111111-2222-3333-4444-555555555555  APPROVED 2025-12-01  expires_at_utc=2025-12-08T09:00:00Z  execution_state=NOT_EXECUTED
  pending.json bytes unchanged after the full run: True
  scan for an EXECUTED token (excluding NOT_EXECUTED) anywhere in the state root: []
  CHANGED  alerts/alerts.jsonl  …   CHANGED  snapshots/2026-10-31.json (absent)->…
  CHANGED  state/day-locks/2026-10-31.lock  CHANGED  state/last-run.json  CHANGED  state/notified-keys.json
  ↑ the five files a normal run is *supposed* to touch; approvals/* is not among them
```

Static confirmation that there is nothing to call — every membership/assignment of the tokens, non-test code only:

```
$ grep -rn 'execution_state"\]\s*=\|execution_state.*=.*EXECUTION' --include=*.py .   # excluding ./tests/
./approval_queue.py:181:    item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED      ← the ONLY assignment in the package

$ grep -rn "APPROVED" --include=*.py . | grep -v "^./tests/"
./approval_queue.py:39:STATUS_APPROVED = "APPROVED"                                        ← a label
./approval_queue.py:41:DECISIONS = {"approve": STATUS_APPROVED, "reject": STATUS_REJECTED} ← a mapping to write

$ grep -rnE "^import (socket|requests|httpx|urllib|http)|from (socket|requests|httpx|urllib|http)" --include=*.py . | grep -v "^./tests/"
./readonly_client.py:34:from http.client import HTTPConnection  # readonly-exempt: the single socket library, used only inside _transport()
./readonly_client.py:35:from urllib.parse import urlparse
```

`verify_readonly.py` over the whole package: `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` → `PASS - no unexempted write/earning token found.`

**VERIFIED.** All three exit codes and errors quoted; `execution_state` `NOT_EXECUTED` throughout; `pending.json` byte-identical (`True`); no `EXECUTED` token anywhere in the state root.

### 1.4 What the required three attempts did **not** cover, and one thing that did show a hole

Read the acceptance criterion as "the queue is closed to a machine" and the run says otherwise — see §1.5. Nothing in the required three failed.

### 1.5 DEFECT (new, found by this pass): the human-identity gate is a denylist of ten literal words

```
[P5 CLI: --by 'Hermes Agent']
$ … approval_queue.py decide --id 1111…5555 --decision approve --by Hermes Agent --note probe
exit=0
stdout> recorded APPROVED for 1111…5555 by Hermes Agent at 2026-09-30T18:56:57Z
execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)
  CHANGED  approvals/decided.jsonl (absent) -> fe2256807e7f
  CHANGED  approvals/pending.json  ea6518339de3 -> 9615c0883f4e

[P5 CLI: --by 'agent-1']              exit=0   stdout> recorded APPROVED … by agent-1
[P5 CLI: --by 'FreeCash Monitor Bot'] exit=0   stdout> recorded APPROVED … by FreeCash Monitor Bot
```

`_normalise_decider` does `who.lower() in NON_HUMAN_DECIDERS` — an **exact match against 10 strings** (`system`, `routine`, `automation`, `agent`, `cron`, `scheduler`, `monitor`, `bot`, `script`, `machine`). Any other machine-looking name passes: `Hermes Agent`, `agent-1`, `FreeCash Monitor Bot`, `System (automated)`, `nightly-job`.

**Honest reading:** rule 4's *execution* half is intact — even these accepted decisions leave `execution_state=NOT_EXECUTED` and `expires_at_utc=null` (`decide()` re-asserts both, lines 179-182), and the accepted writes landed only in the throwaway root. What is *not* enforced is the authorship claim: `decided_by` is a self-declared string, so a machine can write a decision that reads like a human's. Recommendation (do not fold into this pass — it is a code change): replace the denylist with a positive requirement, e.g. require `--by` to match an operator-supplied allowlist from config, or add `--confirm-human` plus an OS-level identity (`whoami`) cross-check, and record both in `decided.jsonl`. Until then, standing ops (§5) must treat a non-empty `decided_by` as an unverified claim.

---

## 2. (b) What happens to a pending item across a day boundary and after any deadline

**Method.** `probe_days.py` → `out_days.txt` (211 lines), throwaway root `root_days`; `probe_frozen.py` → `root_frozen` for the strict equality check. Simulated clock via the routine's own documented seam (`paths.set_clock`, used by `run_daily_check.run(now=…)`); every day after Day 1 runs `run_daily_check` **and** `watchdog.check`.

### 2.1 Where the local day boundary actually is

```
DAY-KEY BOUNDARY (FREECASH_TZ=Europe/Berlin)
  2026-09-30T21:59:00+00:00 UTC  ->  day_key 2026-09-30
  2026-09-30T22:00:00+00:00 UTC  ->  day_key 2026-10-01
  2026-09-30T21:59:59+00:00 UTC  ->  day_key 2026-09-30
  2026-09-30T22:00:01+00:00 UTC  ->  day_key 2026-10-01
  2026-12-31T22:30:00+00:00 UTC  ->  day_key 2026-12-31
  2026-12-31T23:30:00+00:00 UTC  ->  day_key 2027-01-01
```

Code path — `gate.py:96-102`:

```python
def day_key(now=None, tz=None) -> str:
    """Operator-local calendar day for *now* (default: the current instant)."""
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(zone(tz)).date().isoformat()
```

with `timezone report : {'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}` — the IANA zone resolved, so the boundary is the real 22:00 UTC = 00:00 Berlin CEST edge, not a fallback offset.

### 2.2 Item created on Day 1, then 30 consecutive day boundaries

```
STEP 1  seed day 0 (baseline) and day 1 (a real cents change -> one PENDING item)
  approval_id=c289b6d3-a01d-4dac-89b9-e3406f3f7064 created_at_utc=2026-10-02T06:35:00Z day_key=2026-10-02
  frozen fields: {"decided_at_utc": null, "decided_by": null, "execution_allowed_by_this_routine": false,
                  "execution_state": "NOT_EXECUTED", "expires_at_utc": null, "status": "PENDING"}

  offset  day_key     run_outcome      item.status  expires_at_utc  exec_state   reminders_so_far  decided_by
  0       2026-10-01  EARNINGS_CHANGED PENDING      None            NOT_EXECUTED 0                 None
  1       2026-10-02  EARNINGS_CHANGED PENDING      None            NOT_EXECUTED 0                 None
  2       2026-10-03  OK_NO_CHANGE     PENDING      None            NOT_EXECUTED 0                 None
  …
  8       2026-10-09  OK_NO_CHANGE     PENDING      None            NOT_EXECUTED 1                 None
  …
  15      2026-10-16  OK_NO_CHANGE     PENDING      None            NOT_EXECUTED 2                 None
  …
  22      2026-10-23  OK_NO_CHANGE     PENDING      None            NOT_EXECUTED 3                 None
  …
  29      2026-10-30  OK_NO_CHANGE     PENDING      None            NOT_EXECUTED 4                 None
  30      2026-10-31  OK_NO_CHANGE     PENDING      None            NOT_EXECUTED 4                 None
```

The item's row is identical on every one of the 31 simulated days; the only thing that advances is the reminder counter. Strict equality check on the whole item object:

```
after 29 further day boundaries: {"approval_id": "298a69cd-…", "created_at_utc": "2026-10-02T06:35:00Z",
  "decided_at_utc": null, "decided_by": null, "decision_note": null,
  "execution_allowed_by_this_routine": false, "execution_state": "NOT_EXECUTED", "expires_at_utc": null,
  "status": "PENDING", "status_reason": null, …}
BYTE-IDENTICAL item across 29 day boundaries: True
status still PENDING: True
```

### 2.3 The only thing a day boundary causes: a ≤1-per-7-days reminder

```
STEP 2b  reminder cadence (APPROVAL_PENDING alert lines carrying observed.reminder=true):
  ts=2026-10-02T06:35:00Z reminder=None severity=notify  ← the enqueue notification itself
  ts=2026-10-09T06:35:00Z reminder=True  severity=notify
  ts=2026-10-16T06:35:00Z reminder=True  severity=notify
  ts=2026-10-23T06:35:00Z reminder=True  severity=notify
  ts=2026-10-30T06:35:00Z reminder=True  severity=notify
  offline deliveries recorded by the stub sender: 6
```

Code path — `approval_queue.py:59-60, 207-235`:

```python
NAG_INTERVAL_DAYS = 7
NAG_EVENT = "APPROVAL_PENDING"
…
def nag_due(item, now=None, records=None) -> bool:
    """True when a PENDING item has not been mentioned for NAG_INTERVAL_DAYS."""
    if item.get("status") != STATUS_PENDING:      # a decided item is never nagged
        return False
    moment = now or paths.now_utc()
    if moment.tzinfo is None:
        moment = moment.astimezone()
    last = last_nag_utc(item.get("approval_id"), records=records)
    if last is None:
        return True
    return (moment - last).days >= NAG_INTERVAL_DAYS
```

and its only caller, `run_daily_check.py:217-245`:

```python
def nag_pending(day, now, sender, sleep_seconds) -> int:
    """At most one reminder per item per seven days.  A reminder never decides."""
    records = paths.read_jsonl(paths.alerts_path())
    count = 0
    for item in approval_queue.pending_items():
        if not approval_queue.nag_due(item, now=now, records=records):
            continue
        key = changedetect.dedupe_key(day, "APPROVAL_PENDING", "approval_id", item.get("approval_id"), item.get("status"))
        notify.alert("APPROVAL_PENDING", day,
            "Reminder: approval item %s has been waiting since %s (still PENDING, no expiry)." % (…),
            severity=notify.SEVERITY_NOTIFY, dedupe_key=key, observed={"approval_id": …, "status": …, "reminder": True})
        notify.dispatch(notify.message_approval_pending(item), key, day, "APPROVAL_PENDING", …)
        count += 1
    return count
```

A day the routine never ran adds only `MISSED_DAY` alarms and does not touch the queue — `gate.py:208-225` (`missed_days`) and `watchdog.py:9-15` docstring: *"it never writes the ledger, never creates or clears a day lock, never writes a snapshot, **never touches the approval queue**"*.

### 2.4 After any deadline — there is none, and the field is never read as a condition

```
STEP 4  deadline behaviour: the routine never reads expires_at_utc as a trigger
  NO_EXPIRY constant = None
  build_item() writes expires_at_utc = None
  every item in the queue has expires_at_utc=None: True
  nag_due() on the 30-day-old item: False        ← its last reminder was 2 days ago, not ≥7
```

Every occurrence of the field in the whole package, non-test code:

```
$ grep -rn "expires_at_utc" --include=*.py . | grep -v "^./tests/"
approval_queue.py:15 : * it never sets ``expires_at_utc`` -- the field is always ``null``.  A
approval_queue.py:47 : #: ``expires_at_utc`` is always exactly this value.
approval_queue.py:131: "expires_at_utc": NO_EXPIRY,            ← build_item (constant)
approval_queue.py:180: item["expires_at_utc"] = NO_EXPIRY      ← decide() re-asserts it
approval_queue.py:196: "expires_at_utc": NO_EXPIRY,            ← decided.jsonl audit line
approval_queue.py:270,275: print formatting in `list`
```

Four writes, all the same constant, and **zero reads** — no comparison, no `if expires`, no sweep. The design intent is stated at `approval_queue.py:15-19`:

```
* it never sets ``expires_at_utc`` -- the field is always ``null``.  A
  non-null expiry is the historical mechanism by which a pending item turns
  into "expired, so execute"; that mechanism does not exist here, and no
  watchdog, timer, cron entry or scheduler retry may change a pending item's
  status.  A pending item waits indefinitely.
```

And §1.3's P4 run is the behavioural proof: a crafted `expires_at_utc=2025-12-08T09:00:00Z` (18 days in the past at run time) survived the full routine + watchdog + CLI with `pending.json bytes unchanged: True`.

An accepted decision cannot arm the item either (`approval_queue.py:179-182`):

```python
    # Re-assert the frozen fields: a decision must not be able to arm the item.
    item["expires_at_utc"] = NO_EXPIRY
    item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED
    item["execution_allowed_by_this_routine"] = EXECUTION_ALLOWED_BY_THIS_ROUTINE
```

Behaviourally, after a human decision and 30 further day boundaries with the routine + watchdog running:

```
STEP 5  decide(…, now=2026-10-31) -> status=APPROVED decided_by='Operator Jane' decided_at_utc=2026-10-31T06:35:00Z
  post-decision frozen fields: {"decided_at_utc": "…", "decided_by": "Operator Jane", "execution_allowed_by_this_routine": false,
                                "execution_state": "NOT_EXECUTED", "expires_at_utc": null, "status": "APPROVED"}
  after 30 further days + routine + watchdog, pending.json identical: True
  decided.jsonl line count: 1
```

**VERIFIED.** Day boundary: item byte-identical, only reminders at +7/+14/+21/+28. Deadline: field exists, is always `null`, is written four times and read zero times, and a past expiry changes nothing.

---

## 3. (c) Every notification sink actually available on this host today

**How the inventory was established (all local; nothing contacted):** file/`command -v` probes, `tasklist`/`query session`, `schtasks /query /FO CSV /NH` (278 rows), `hermes cron list`, `hermes gateway list`, `hermes send --help`, `hermes --help`, `grep` of `~/AppData/Local/hermes/.env` and `…/config.yaml` and `channel_directory.json`/`gateway_state.json` for **variable and platform NAMES only** (no value printed, no token read).

Raw facts behind the table:

```
command -v: himalaya NO | gws NO | ntn NO | mail NO | sendmail NO | msmtp NO | curl YES | powershell YES | schtasks YES | hermes YES
~/AppData/Local/hermes/.env sink variable names: TELEGRAM_ALLOWED_USERS, TELEGRAM_BOT_TOKEN, TELEGRAM_HOME_CHANNEL
  (no SMTP_*, MAIL_*, WEBHOOK_*, SLACK_*, DISCORD_*, TWILIO_*, NOTIFY_*, EMAIL_* names)
repo .env + server/.env variable names: ALIBABA_API_KEY, DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL, DEEPGRAM_API_KEY,
  DEFAULT_LLM_MODEL, DEFAULT_LLM_PROVIDER, GATEWAY_PROVIDER_ORDER, JARVIS_SUPERVISOR_V2, OLLAMA_BASE_URL,
  OLLAMA_FALLBACK_MODEL, OLLAMA_MODEL, OPENROUTER_API_KEY, QWEN_API_KEY        ← no notification channel at all
channel_directory.json (default profile, updated_at 2026-09-30T20:56:23): platforms present: ['telegram']
gateway_state.json: platforms = ['api_server', 'telegram']
hermes gateway list: ✓ default (current) — PID 21660 | ✗ proposal-writer/researcher/reviewer — not running
hermes cron list: No scheduled jobs.
schtasks /query /FO CSV /NH | grep -iE 'freecash|hermes': "\\Hermes_Gateway" … "\\Hermes_Gateway_researcher"  (no freecash task)
query session: console cd-pr ID 1 Aktiv ; tasklist: explorer.exe ×2, hermes-agent.exe ×10 running
~/.env grep for SMTP/mail/webhook: nothing.  ~/Documents/Obsidian Vault: No such file or directory.
~/AppData/Roaming/obsidian/obsidian.json: No such file or directory.  OBSIDIAN_VAULT_PATH: unset.
hermes send --help: "Pipe text from any shell script to any messaging platform Hermes is already configured for …
  Reuses the gateway's platform credentials (~/.hermes/.env + config.yaml) … Examples: hermes send --to telegram …"
routine code, delivery only: notify.py:184 subprocess.run(["powershell", …]) — the toast; notify.py:8 "SMTP opt-in and OFF
  by default; not wired to any credential here"; grep of the package for smtp|webhook|telegram|discord|slack|email|https?://
  (non-test) returns only that docstring line and readonly_client's `http://localhost:3001`.
```

### 3.1 The sinks, classified

**Classification rule applied** (from the pass constraints): *delivering to the operator over a channel he already uses — his own desktop/voice app, or a local file he reads — is **local** and is not an external action under rule 4. Publishing to third parties, sending mail/SMS off-host, executing transactions, or writing to any provider **are** external: approval-gated and unauthorised today.*

| # | Sink | Class | Available today? | Evidence | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|------|-------|------------------|----------|-----------------|-----------------|--------------|----------------------|
| 1 | `<root>/alerts/alerts.jsonl` — append-only alert log (the routine's canonical evidence record) | **LOCAL** (file on this machine) | **YES — already written on every run, no config** | runs above show it written every day; `notify.alert()` → `paths.append_jsonl` O_APPEND | **Zero** (exists) | Same day — visibility only (no revenue path) | none | Read the tail of it as the standing check; it is the fallback of last resort when every other channel fails (`dispatch()` writes `MONITOR_DEGRADED`: *"this message exists only in alerts.jsonl. Operator must read the log until the channel is fixed."*) |
| 2 | `<root>/approvals/pending.json` + `decided.jsonl` — the queue itself | **LOCAL** | **YES — already written** | §1/§2 runs | **Zero** (exists) | Same day — visibility only | none | `…/approval_queue.py list` is the standing "what is waiting" command (prints id, status, day, `expires_at_utc`, `execution_state`) |
| 3 | Windows toast via `notify._toast_send()` (PowerShell `NotifyIcon.ShowBalloonTip`) | **LOCAL** (the operator's own desktop; reaches no third party) | **YES — coded and the preconditions are met** (interactive session `cd-pr` ID 1 **Aktiv**, `explorer.exe` running) | `notify.py:167-192`; session probe | **Low** — already implemented; only a scheduler entry is missing | Same day — visibility only | the daily task must be registered (§4 of the parent plan), or run manually | Run one day's check with the default sender **after** the operator approves enabling notification — deliberately NOT done here: a toast in the live session would notify him without his approval |
| 4 | Hermes desktop / voice app (the operator's own agent surface, `hermes-agent.exe`, gateway PID 21660) | **LOCAL** | **YES — running now** | `tasklist`: 10 × `hermes-agent.exe`; `hermes gateway list`: `✓ default (current) — PID 21660` | **Low–Medium** — needs a bridge (the routine has no Hermes client; today the operator would paste/announce) | Same day — visibility only | gateway up (it is) | Append a one-line summary to a file the desktop session reads, or have the operator ask the agent "what's in the Free Cash queue" — no credential, no publish |
| 5 | `<root>/logs/toast-stub.log` via `FREECASH_TOAST_STUB=1` | **LOCAL**, but **not a delivery channel** — a test stub whose label is `STUB_OK`, never `TOAST_OK` | YES | `notify.py:151-164`; used by this pass | Zero | n/a | none | None — named only to stop anyone quoting a stubbed run as a real delivery |
| 6 | A local markdown/ops file the operator reads (e.g. `docs/free-cash-monitor-routine/DAILY-QUEUE.md`) | **LOCAL** | **YES** — but the routine does not write it yet | none exists; the routine's only file writers are `paths.write_json_atomic`/`append_jsonl` under the state root | **Low** (one new writer, ~20 lines) | Same day — visibility only | decision on the path; must stay outside the state root or `verify_readonly`'s scope must be re-measured | Add a `render_queue_markdown()` next to `approval_queue list` and print it at the end of a run |
| 7 | `hermes send --to telegram …` (the bot token + home channel are configured) | **OFF-HOST / EXTERNAL** — publishes to a third-party service | **CONFIGURED but UNTESTED — and UNAUTHORISED today** | `.env` names `TELEGRAM_BOT_TOKEN`/`TELEGRAM_HOME_CHANNEL`/`TELEGRAM_ALLOWED_USERS`; `gateway_state.json` platforms `['api_server','telegram']`; `channel_directory.json` platforms `['telegram']`; `hermes send --help` | **Low** (a shell-out or `subprocess` call) | Same day — visibility only | **operator authorisation (rule 4)**, live token validity UNVERIFIED | Ask the operator to approve Telegram as a delivery channel; do not test it (a test send is an external write) |
| 8 | Email / SMTP / SMS / generic webhook | **OFF-HOST / EXTERNAL** | **NO — nothing installed, nothing named** | `himalaya`, `mail`, `sendmail`, `msmtp` all absent; no `SMTP_*`/`MAIL_*`/`WEBHOOK_*`/`TWILIO_*` name in either `.env`; `notify.py:8` says SMTP is *"opt-in and OFF by default; not wired to any credential here"* | **Medium–High** (new credential + new transport + its own approval) | Same day — visibility only | an account, a credential, an approved external channel | None — leave closed; it is explicitly outside rule 4's allowance |
| 9 | Obsidian vault / Notion / Google Workspace (`ntn`, `gws`) | **LOCAL** for a vault file, **EXTERNAL** for Notion/Drive; **all unavailable today** | **NO** | `OBSIDIAN_VAULT_PATH` unset, `~/Documents/Obsidian Vault` absent, `~/AppData/Roaming/obsidian/obsidian.json` absent; `ntn`/`gws` not installed | High | Same day — visibility only | install + account | None |
| 10 | Windows Task Scheduler / Hermes cron | **not a notification sink** — a *trigger* | scheduler YES (278 rows, no `freecash` task); Hermes cron 0 jobs | `schtasks` / `hermes cron list` | n/a | n/a | n/a | Belongs to the scheduler workstream, not this one — listed so the two are not confused |

### 3.2 Ranking for a routine whose whole point is "ask the human first"

1. **`alerts/alerts.jsonl` + `approval_queue.py list` (LOCAL, zero effort, already live).** The routine's own evidence record and the queue read-back. Nothing published, nothing to authorise.
2. **Windows toast to the active desktop session (LOCAL, low effort, already coded).** It notifies *the operator, on the operator's own machine* — the same class as the Hermes desktop app, not a third party. Because it is the mechanism that would actually tap him on the shoulder, it is the honest default candidate *after* he approves it; this pass deliberately did not fire one.
3. **Hermes desktop/voice app (LOCAL, low–medium).** Running now; needs one small bridge, no credential.
4. **A rendered local markdown queue file (LOCAL, low).** Readable outside the agent too.
5. **Telegram (EXTERNAL).** The only off-host sink that exists at all on this host, and therefore the only one rule 4 gates. **Unauthorised today**; enabling it is itself an external-action decision for the operator, not for the routine.
6. **Email/SMS/webhook (EXTERNAL, absent).** Keep closed.

**Honest default: channels 1 + 2 (+ 4 if a durable human-readable copy is wanted), all LOCAL; the external Telegram/webhook path stays OFF.** That keeps the whole delivery path inside the operator's own machine, so the only thing crossing rule 4's boundary is a notification he himself would have asked for, and it means the delivery plan needs no new credential and no external approval before it can work. `Time-to-Revenue` for every row above is **same day — visibility only**: a notification sink has no revenue time-to-value in its own right; the revenue path is the account reading (datasource workstream), not the channel.

---

## 4. Live host facts re-checked this session (the requester's assumption, re-derived)

```
$ netstat -ano | grep -E ':(4600|3001)\s'          → (no rows)
$ curl -s -m 4 -o /dev/null -w 'code=%{http_code}\n' http://127.0.0.1:4600/api/health   → code=000 ; exit=7  (connection refused)
$ curl -s -m 4 -o /dev/null -w 'code=%{http_code}\n' http://127.0.0.1:3001/             → code=000 ; exit=7  (connection refused)
```

**AgenticOS server: DOWN** — re-confirmed today at 20:54, not assumed. This does not affect the approval gate (it is file-based) but it does mean the routine's `metrics_http` source and any Hermes-app-side bridge are unreachable right now; the `operator_state` source and the file/toast sinks are not.

`hermes cron list` → `No scheduled jobs.` · `schtasks` → no `freecash` task (the only Hermes entries are `\Hermes_Gateway`, `\Hermes_Gateway_researcher`). **Nothing schedules the routine** — consistent with the parent brief's V8/V9.

---

## 5. (d) Standing operations

### 5.1 Who reads the queue

**The operator (the human, `cd-pr`) — and nobody else.** The machine-side contract cannot be "someone will notice":
- the routine **never** decides an item (no code path assigns `status` outside `decide()`), so the queue only moves when a person runs the CLI;
- the queue is a **file** on this machine (`<root>/approvals/pending.json`) plus its audit trail (`decided.jsonl`); the authoritative read-back command is `python monitoring/freecash/approval_queue.py list`, which prints per item: `approval_id`, `status`, `day_key`, `expires_at_utc`, `execution_state`;
- `run_daily_check.py --print-state` prints the ledger **and** `pending items: <n>` and stops — that is the one-command "is anything waiting" check, and it reads and writes nothing else.

Cadence that matches the code: the routine itself reminds at most once per 7 days per item (§2.3), so a weekly human pass over `approval_queue.py list` is the designed rhythm; the reminder is the prompt, not a decision.

### 5.2 How a pending item is answered

Exactly one mechanism, human-only, from `approval_queue.py:21-27` and `:251-257`:

```
py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide \
    --id <uuid> --decision approve|reject --by "<name>" --note "<why>"
```

- `--id` — the `approval_id` from `pending.json` / the alert line / the notification text;
- `--decision` — `approve` or `reject`, nothing else (`invalid choice` otherwise, exit 2 — §1.3);
- `--by "<your real name>"` — required, and required to be human-looking (`_normalise_decider`); with the §1.5 defect in mind, **type your actual name**, and treat the field as self-declared;
- `--note "<why>"` — required (`--note is required: record why the decision was made`, exit 2);
- on success: `recorded APPROVED for <id> by <name> at <ts>` + `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)`, one line appended to `decided.jsonl`, and the item's frozen fields re-asserted.

**What the decision does and does not do.** It records the human's judgement and *nothing else*: `execution_state` stays `NOT_EXECUTED`, `execution_allowed_by_this_routine` stays `false`, `expires_at_utc` is re-forced to `null`, and no component reads `APPROVED` as a trigger (§1.3 greps). The actual external action, if the operator wants it, is performed **by the human, outside this routine** — the routine's role ends at "asked you, and recorded your answer".

### 5.3 What the routine does if the human never answers

1. **Nothing happens to the item, ever.** §2: 30 consecutive day boundaries left it byte-identical; a forged/expired `expires_at_utc` changes nothing; `decide()` re-asserts the freeze; `execution_state` has exactly one assignment in the codebase, the literal `NOT_EXECUTED`.
2. **A reminder every 7 days**, attached to the run, not to a timer of its own (`nag_pending`, §2.3): at most one `APPROVAL_PENDING` alert line + one dispatch per item per 7 days (observed: 4 over 30 days). If the daily task is not running, the reminders stop — they are a property of a run, not a separate alarm, so a dead scheduler also silences the reminder. (The watchdog covers the *missing run*, not the unanswered item: it never touches the approval queue.)
3. **The item stays in `pending.json` and keeps being listed** by `approval_queue.py list` and counted by `--print-state`. There is no expiry, no auto-reject, no escalation, no "close stale items" sweep — by design (`approval_queue.py:15-19`).
4. **Notification failure does not change any of that** (`notify.py:10-19`): at most 2 attempts, then one `DELIVERY_FAILED` line carrying the full original message, the key marked `FAILED_TOAST`, and *"a failed notification never blocks a state write, never re-reads the status source, never causes a second run and never touches the approval queue."* When that happens the operator must read `alerts/alerts.jsonl` — which is why sink #1 in §3 outranks every other channel.
5. **The gap today is operational, not logical:** `data/freecash-monitor/approvals/` is still empty and `operator-state.json` holds `records: []`, so **no approval item has ever been queued on the production root** — rule 4's queue has been exercised only on throwaway roots and by the suite.

---

## 6. Read-only / no-side-effect proof for this pass

```
$ find /d/AgenticOS/data/freecash-monitor -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort
2026-09-20 21:08 0    …/state/day-locks/2026-09-20.lock
2026-09-20 21:08 341  …/state/last-run.json
2026-09-20 21:08 518  …/snapshots/2026-09-20.json
2026-09-20 21:08 879  …/state/operator-state.json
2026-09-21 18:39 1635 …/alerts/alerts.jsonl
2026-09-21 18:39 255  …/state/notified-keys.json
```

That listing was identical to the one taken at the start of this session (20:54 CEST: same 6 files, same mtimes 2026-09-20/2026-09-21, same sizes), and every run this pass was pinned to a throwaway root.

**Production root changed after that measurement — by another writer, not by this pass.** Re-listing at 21:02 CEST shows 10 files, the new ones all stamped 21:01–21:02:

```
2026-09-30 21:01 0    data/freecash-monitor/state/day-locks/2026-09-30.lock        ← NEW
2026-09-30 21:02 230  data/freecash-monitor/logs/task-a.log                       ← NEW
2026-09-30 21:02 136  data/freecash-monitor/logs/task-b-watchdog.log              ← NEW
2026-09-30 21:02 341  data/freecash-monitor/state/last-run.json   (was 2026-09-20 21:08)
2026-09-30 21:02 518  data/freecash-monitor/snapshots/2026-09-30.json             ← NEW
2026-09-30 21:02 2172 data/freecash-monitor/state/notified-keys.json (was 2026-09-21 18:39, 255 B)
2026-09-30 21:02 8368 data/freecash-monitor/alerts/alerts.jsonl   (was 2026-09-21 18:39, 1635 B)

$ cat logs/task-a.log
RUN_OK 2026-09-30 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-30.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-30.lock
SKIP_DUPLICATE_DAY 2026-09-30
$ cat logs/task-b-watchdog.log
WATCHDOG_OK 2026-09-30 attempt=2026-09-30 outcome=MONITOR_DEGRADED   (×2)
```

Attribution: the writer is a **sibling sub-agent session** (the scheduler workstream, whose artifact names are `task-a` / `task-b-watchdog`); this pass wrote no file under `data/freecash-monitor/`, every one of its six state roots and all raw output live under `…/Temp/fc-deliv-1790794557/`, and the delta timestamps (19:01–19:02 UTC) postdate this pass's last production-root listing. Consequences worth carrying to the parent:

- **Today's day key is now consumed** (`state/day-locks/2026-09-30.lock`) — the parent brief's V4 "today's day key still free" is superseded; any further run today can only return `SKIP_DUPLICATE_DAY`.
- The run recorded `MONITOR_DEGRADED` yet **`last_success_day` advanced to 2026-09-30**, because `gate.SUCCESS_OUTCOMES` includes `MONITOR_DEGRADED` (`gate.py:32-41`) — a degraded, no-data run counts as a covered day for R1/missed-day arithmetic while producing no comparable figure. That is a real nuance for the datasource workstream, not a defect introduced today.
- `approvals/` is still `total 0` after that run: still **no approval item has ever been queued on the production root**, and this report's rule-4 evidence remains throwaway-root evidence.

Also observed and honoured: **no toast was sent.** All six notifications in the day-boundary run went to a recording stub (`delivery_label = "TOAST_OK"` passed explicitly as `sender=`) — the live desktop session (`Aktiv`) was left alone, because a toast there would have notified the user without his approval.

### Reproduction commands

```bash
VENV="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
D="$LOCALAPPDATA/Temp/fc-deliv-1790794557"                     # throwaway, holds all raw output
FC_ROOT="$D/root_approval" "$VENV" "$D/probe_approval.py"      # §1  → out_approval.txt
FC_ROOT="$D/root_days"     "$VENV" "$D/probe_days.py"          # §2  → out_days.txt
FC_ROOT="$D/root_frozen"   "$VENV" "$D/probe_frozen.py"        # §2.2 strict equality
for i in 1 2 3 4; do FREECASH_DATA_ROOT="$D/suite_$i" "$VENV" monitoring/freecash/tests/run_all.py; done
"$VENV" monitoring/freecash/verify_readonly.py monitoring/freecash
```

### Artifact paths

- `…/Temp/fc-deliv-1790794557/probe_approval.py`, `out_approval.txt` (185 lines)
- `…/Temp/fc-deliv-1790794557/probe_days.py`, `out_days.txt` (211 lines)
- `…/Temp/fc-deliv-1790794557/probe_frozen.py`
- `…/Temp/fc-deliv-1790794557/suite_1..4.txt` (4 × 43 886 bytes, identical size = identical result)
- `…/Temp/fc-deliv-1790794557/verify_readonly.txt`
- throwaway state roots: `root_approval/`, `root_days/`, `root_frozen/`, `suite_1..4/`
- this document

### VERIFIED vs UNVERIFIED — residual list

VERIFIED (quoted output produced in this session): §0 rows 1–9, and every numeric/exit-code claim above.

UNVERIFIED / explicitly not claimed:
- **Telegram token validity and deliverability** — names exist in `~/AppData/Local/hermes/.env`; no test performed (a test send is an external write). Sink #7 is *configured*, not *working*.
- **The toast's physical on-screen appearance** — the code path, the PowerShell availability and the active session were verified; no toast was fired, so "the operator would see it" is an inference from `_toast_send` + session state, not an observation.
- **`metrics_http` read source / any Hermes-app bridge** — the app is DOWN (curl exit 7), so nothing app-side was exercised.
- **Whether the denylist hole in §1.5 is exploitable in production** — it was demonstrated only on a throwaway root; the production queue is empty, so no item has ever been at risk.
- **`exempt=28` as a stable baseline** — measured again this session and equal to the brief's V2, but a rise would indicate the read-only gate eroding; it is a baseline, not a pass.
- **The R1 concurrency test** — green 4/4 this pass, but it has flaked on this tree before; the scheduler workstream owns looping it to 20/20 before any timer is registered.

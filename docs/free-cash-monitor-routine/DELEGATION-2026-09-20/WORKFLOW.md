# WORKFLOW.md — OPERATIONS WORKFLOW, Free Cash daily status-monitoring routine

**Routine:** `D:/AgenticOS/monitoring/freecash/` (canonical implementation, `freecash-monitor 1.0.0`)
**Document date:** 2026-09-20 (Europe/Berlin) · **Host:** Windows 11, git-bash shell · **Interpreter used for all verified runs:** `python` → `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (3.11.9; `python3` does **not** exist on this host)
**Author's constraint set:** read-only investigation. Every command quoted in §1 was executed by the author of this document; everything else is marked **[read from source]** or **[UNVERIFIED]**.

---

## 0. Scope, and what this document does not claim

This document is the **operating procedure**: who does what, in what order, with which command, on what file. It is not a design document (see `ROUTINE-DESIGN.md`) and not a research plan.

It contains **no provider endpoint, no URL, no credential, no price, and no revenue claim**, because none of those were verifiable. The single fact that governs everything below:

> **The routine has no live data source.** Its default read source is `operator_entered`: you read your own dashboard and type the numbers into a local file. Until you do that, every snapshot is `degraded: true` with null figures and outcome `MONITOR_DEGRADED`. Nothing is compared, nothing is notified. The routine observes what you type in. It never touches the platform.

The four non-negotiable rules this procedure exists to protect:

| # | Rule |
|---|---|
| **R1** | Exactly one status check per operator-local calendar day |
| **R2** | Zero automated earning actions — no claim/withdraw/cashout/redeem/payout/transfer/bet/deposit, no POST/PUT/PATCH/DELETE to any provider, ever |
| **R3** | Notify the operator when earnings or account status changes — exactly one notification per distinct change |
| **R4** | Human approval before ANY external action. The routine contains no execution path at all; it may only enqueue approval items |

---

## 1. Verified state at the time of writing (commands executed, outputs verbatim)

| Check | Command | Output |
|---|---|---|
| Suite green | `cd /d/AgenticOS/monitoring/freecash && python tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0` |
| R2 static gate (bash) | `cd /d/AgenticOS && bash docs/free-cash-monitor-routine/verify-readonly.sh` | `[verify-readonly] forbidden=0 exempt=28 missing_targets=0` / `PASS — no unexempted write/earning token found.` (exit 0) |
| R2 static gate (python) | `python verify_readonly.py` (from `monitoring/freecash`) | `forbidden=0 exempt=28 missing_targets=0` / `PASS` (exit **0**) |
| R1 first real run | `FREECASH_DATA_ROOT=<scratch> python run_daily_check.py` | `RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock` (exit 0) |
| R1 duplicate run | same command, second time, same day | `SKIP_DUPLICATE_DAY 2026-09-20` (exit 0) |
| R1 forced retry refused | `python run_daily_check.py --force-recheck --reason "verify"` | `REFUSED_FORCE_RECHECK 2026-09-20 reason='verify' (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)` (exit **3**) |
| R3+R4 end-to-end (seeded scratch run) | prior snapshot + operator record, `FREECASH_TOAST_STUB=1` | `RUN_OK 2026-09-20 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) ... changes=1 notifications=1 approvals=1 reminders=0` — one `alerts.jsonl` line, one toast-stub line, one `pending.json` item with `"status": "PENDING"`, `"execution_state": "NOT_EXECUTED"`, `"execution_allowed_by_this_routine": false` |
| Watchdog | `python watchdog.py` | `WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=MONITOR_DEGRADED` |
| Queue is empty | `python approval_queue.py list` | `approval queue is empty` |
| cwd independence | `cd /d/AgenticOS && python monitoring/freecash/run_daily_check.py --version` | `freecash-monitor 1.0.0` (script dir is on `sys.path`; cwd does not matter) |
| Nothing scheduled (Hermes) | `hermes cron list` | `No scheduled jobs.` |
| Nothing scheduled (Windows) | `schtasks /query /fo LIST` filtered for cash/monitor | no Free Cash entry (only unrelated Microsoft/Office tasks) |
| No cron daemon | `crontab -l` | `crontab: command not found` |
| Live data root contents | `find data/freecash-monitor` | `alerts/alerts.jsonl`, `snapshots/2026-09-20.json`, `state/day-locks/2026-09-20.lock`, `state/last-run.json`, `state/operator-state.json` — and nothing else |
| Ledger | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `timezone=Europe/Berlin` |
| Operator records | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` — **empty. No reading has ever been entered.** |
| Approvals dir | `ls data/freecash-monitor/approvals/` | empty |
| Today is consumed | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` (zero bytes, created 21:08 local). **No further check is possible on 2026-09-20.** The first operative day is **2026-09-21**. |

### 1.1 Two findings that change what you may safely schedule

1. **`config/freecash-crontab` must not be used as-is.** It is stale on two counts: it points at the placeholder `/path/to/AgenticOS`, and it points at `scripts/make_freecash_check.py` — a superseded prototype, **not** the canonical routine. The R2 gate confirms the prototype is unsafe: `python verify_readonly.py D:/AgenticOS/scripts/make_freecash_check.py` → `FORBIDDEN [earning-verb] .../make_freecash_check.py:20: return [{"name": f"Withdraw ${status['available_to_withdraw']:.2f}", ...` / `FAIL - R2 violation` (exit **1**), versus exit **0** for `monitoring/freecash`. Also note `verify-readonly.sh` scans **only** `monitoring/freecash` by default, so that prototype is *not* covered by the standing gate. **Never schedule it.** Its `run_action()`/`prompt_approve()` shape is exactly the automated-earning pattern R2 forbids. (Not modified — it is outside this task's write scope; it stays as-is and unscheduled.)
2. **The interpreter choice is an operational decision, not a detail.** `Europe/Berlin` resolves as a real IANA zone only under the interpreter that has `tzdata` (verified: Hermes venv python, `tzdata 2025.3`, resolves to `+0200`). Under the system interpreters it does **not** resolve and the routine prints `WARNING timezone_unavailable configured=Europe/Berlin offset=+0200` and falls back to the machine's own local zone, reporting the day as `MONITOR_DEGRADED`:
   - `C:/Users/cd-pr/AppData/Local/Programs/Python/Python311/python.exe run_daily_check.py` → `WARNING timezone_unavailable ...` then `RUN_OK ... MONITOR_DEGRADED` (exit 0)
   - `py -3 run_daily_check.py` (that launcher is Python **3.14.7**, `C:\Python314`) → same warning, same `RUN_OK` (exit 0)
   Both still run, still take the day lock, and still agree on the day key **today** (offset `+0200` either way). The warning is the routine refusing to pretend it honoured the configured name. Whatever you schedule, schedule it with the interpreter you actually verified.

---

## 2. The daily operating procedure

### 2.0 The one ordering rule that matters most

**Enter the reading first, then run the check.** In the code the day lock is acquired (`run_daily_check.py:309`) *before* the source is read (`:372`). So a run that happens before you have typed your numbers **spends the day's single check** on a degraded, null reading — and no change can ever be notified for that day. Every step below is ordered to respect this.

### 2.1 Routine-side steps (what the program does, in order) — [read from source]

1. Creates any missing state dirs (`state/`, `state/day-locks/`, `snapshots/`, `approvals/`, `alerts/`, `logs/`).
2. Installs the read-only audit guard.
3. Resolves the read source (default `operator_entered`).
4. Computes the day key = **your** local calendar day (`FREECASH_TZ`, default `Europe/Berlin`).
5. **R1:** tries to atomically create `state/day-locks/<day>.lock`. Already present → prints `SKIP_DUPLICATE_DAY`, writes one alert line, does **no read, no snapshot, no ledger write**, exits 0.
6. Reads the ledger `state/last-run.json`, computes missed days, checks for a timezone change.
7. Records the attempt, notifies each missed day.
8. Reads the source (opens no socket for `operator_entered`).
9. Builds and saves an immutable `snapshots/<day>.json`; compares against the previous day's snapshot.
10. Branches: no data → `MONITOR_DEGRADED`; nothing trustworthy to compare against → `INITIAL_BASELINE`; no differences → `OK_NO_CHANGE`; differences → one notification per distinct change (**R3**) **and** one enqueued approval item (**R4**, enqueue only).
11. Re-mentions any approval item pending for 7+ days (`APPROVAL_PENDING`).
12. Prunes old artifacts (snapshots 90 d, run logs 30 d); `alerts.jsonl` and `decisions.jsonl` are audit records and are **never** pruned.
13. Records the outcome (`last_success_day` advances only on a snapshot-producing outcome) and prints the `RUN_OK` line.

### 2.2 Operator-side steps — the daily ritual

| # | Step | Command / file |
|---|---|---|
| 1 | Open your own dashboard in a browser and log in **yourself** | no command — deliberately manual |
| 2 | Note four figures: account status, total earnings, current balance, pending | — |
| 3 | Append **one** record for today to the operator state file (see §4) | `D:/AgenticOS/data/freecash-monitor/state/operator-state.json` |
| 4 | **Then** run the day's single check exactly once | `cd /d/AgenticOS/monitoring/freecash && python run_daily_check.py` |
| 5 | Read the one-line result and act on it (§2.3) | stdout |
| 6 | If a notification arrives, work §5; if an approval item exists, work §6 | `alerts/alerts.jsonl`, `approvals/pending.json` |
| 7 | Weekly: confirm the day was covered | `cd /d/AgenticOS/monitoring/freecash && python watchdog.py` |

### 2.3 Reading the output (exit codes)

| Output token / exit | Meaning | Your action |
|---|---|---|
| `RUN_OK ... outcome=OK_NO_CHANGE` | Reading existed, nothing moved | Nothing to do |
| `RUN_OK ... outcome=INITIAL_BASELINE` | Reading existed but there is no trustworthy prior reading to compare against | Nothing to do; change detection starts with the **next** day's reading |
| `RUN_OK ... outcome=EARNINGS_CHANGED` / `STATUS_CHANGED` / `BALANCE_CHANGED` | A distinct change was found, one notification dispatched, one approval item enqueued | Work §5, then §6 |
| `RUN_OK ... outcome=MONITOR_DEGRADED` | No reading for today (or timezone fallback). Snapshot written with nulls; nothing compared, nothing notified | Confirm you forgot step 3. Today's check is spent — accept it and fix it tomorrow (§8.2) |
| `SKIP_DUPLICATE_DAY <day>` | Today's check already happened | Nothing. Do **not** delete the lock |
| `REFUSED_FORCE_RECHECK <day>` (exit **3**) | You asked for a second read of the same day; refused; the request is logged | Nothing. Do not retry |
| `RUN_FAILED <day> reason=...` (exit **5**) **[read from source — not exercised]** | The read itself raised | §8.4 |
| `WARNING timezone_unavailable configured=... offset=...` | Configured zone unresolvable under this interpreter; machine local zone used | §8.5 |
| exit **2** `USAGE ERROR` **[read from source — not exercised]** | Bad arguments | Fix the command |

---

## 3. R1 — the day-lock mechanism, duplicates, and missed days

**Mechanism (the gate).** One zero-byte file per day: `data/freecash-monitor/state/day-locks/<YYYY-MM-DD>.lock`, created with a single atomic `os.open(..., O_CREAT | O_EXCL | O_WRONLY)` call on NTFS. Two simultaneous processes cannot both create the same path, so there is no read-then-write window and no "if it exists" check to race — and a partial write can never be misread because the file is empty. **The filename is the day key.** The ledger is *not* the gate: a corrupt or missing `last-run.json` cannot cause a second read in one day. Anything wrong with the lock means "do not read" — the routine fails closed.

**Duplicate run.** Second invocation the same local day → `SKIP_DUPLICATE_DAY <day>`, exit 0, exactly one `SKIP_DUPLICATE_DAY` line appended to `alerts/alerts.jsonl`, **no read, no snapshot, no ledger write**. Header lines already in the live log:

```
{"day_key": "2026-09-20", "event_type": "MONITOR_DEGRADED", ... "message": "No data for 2026-09-20 (no operator-entered record for 2026-09-20 in operator-state.json). Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists." ...}
{"day_key": "2026-09-20", "event_type": "SKIP_DUPLICATE_DAY", ... "message": "Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot." ...}
```

**Second read refused by design.** `--force-recheck` never re-reads. It records the request in `logs/forced-recheck-requests.jsonl` with `"decision": "REFUSED"`, prints `REFUSED_FORCE_RECHECK`, exits 3. There is no operator override for R1, and you should not add one.

**Missed day (a day with no run at all).** Detected, never back-filled:
- At the next run, `gate.missed_days()` returns every local calendar day strictly between `last_success_day` and today (not today, not the last success day). Each one produces a `MISSED_DAY` notification: one per missed day.
- Deliberately **no catch-up read of the past day** — a second read of a past day would itself be a second check for that day and would defeat R1. The gap is reported, not hidden and not repaired.
- `state/last-run.json` records `consecutive_missed_days`; `last_success_*` only advances on a snapshot-producing outcome, so a failed or missing day stays visible as uncovered.
- Out-of-band detector: `python watchdog.py` compares today's attempt against today's outcome → `WATCHDOG_OK ... attempt=<day> outcome=<outcome>` or `WATCHDOG_MISSED_DAY <day> ... coverage=NOTIFIED|DEDUPED`. Run it weekly (or daily, it is read-only and takes no lock).

**Operator rule:** the lock is a receipt, not a cache. Never delete a `.lock` file to "get another run". If today's reading was missed, the correct move is §8.2.

---

## 4. The operator data-entry step (this is what makes a real reading possible)

**File:** `D:/AgenticOS/data/freecash-monitor/state/operator-state.json`
**Format:** one record per local calendar day in `records[]`; only the record whose `day_key` equals **today's** operator-local day is used. A stale record is never silently carried forward as if it were today's reading.
**Exact record fields** (from the file's own `template_record`): `day_key`, `entered_at_utc`, `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`. Amounts are **integer cents** (`1340` = 13.40). The file you have today has `"records": []`.

**The daily entry (run this yourself, with today's real numbers):**

```bash
cd /d/AgenticOS
python - <<'PY'
import json, pathlib
p = pathlib.Path("D:/AgenticOS/data/freecash-monitor/state/operator-state.json")
doc = json.loads(p.read_text(encoding="utf-8"))
doc["records"].append({
    "day_key": "2026-09-21",                    # TODAY, operator-local date
    "entered_at_utc": "2026-09-21T07:05:00Z",   # the moment you read the numbers
    "account_status": "ACTIVE",                 # what your dashboard shows
    "earnings_total_cents": 1500,               # 1500 == 15.00, integer cents
    "balance_cents": 1500,
    "pending_cents": 0,
    "currency": "USD",
})
p.write_text(json.dumps(doc, indent=2), encoding="utf-8")
print("records now:", [r["day_key"] for r in doc["records"]])
PY
```

Notes that are grounded in the code, not advice in the abstract:
- This file is read by `operator_state.py`, which **opens no socket and holds no credential**. Every snapshot built from it is stamped `"source": {"kind": "operator_entered", ...}`, `"degraded": true` — so a "no change" report can never be mistaken for a provider-verified one.
- Enter the numbers **before** the day's run (§2.0), and do not enter a second record for a day you already entered.
- If the file is corrupted, the routine does not crash: `read_json` tolerates a corrupt state file and the read simply reports no data → `MONITOR_DEGRADED`. That is a safe failure, but it is also a silent one — so re-read the JSON after editing (the snippet prints what it wrote).

**What a real reading then produces (verified, seeded scratch run):**

```
RUN_OK 2026-09-20 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-09-20.lock
```

with one `alerts.jsonl` line, one toast-stub line —

```
[STUB TOAST 2026-09-20T19:11:20Z] [FreeCash] EARNINGS CHANGE 2026-09-20 | Earnings:  $13.40 -> $15.00  (+$1.60) | Balance:   $15.00 (changed too) | Pending:   $0.00 | Status:    ACTIVE (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-20) | Detail:    alerts.jsonl dedupe=308b52cabce8ec79 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  29fa02b5-fadd-4157-a5f0-24b762cdda0e (PENDING - yours to decide, nothing executes)
```

— and one `approvals/pending.json` item (see §6). Note the one-notification-per-distinct-change rule in the mechanism itself: an earnings movement that drags the balance with it is **one** change (with the balance called out inside it), while a balance movement on its own is its own `BALANCE_CHANGED` event.

---

## 5. R3 — the notification path, and what you do when one arrives

**Channel.** Default delivery is a Windows-native balloon tip, raised by `notify._toast_send` via a non-interactive PowerShell `System.Windows.Forms.NotifyIcon` call (title `FreeCash Monitor`, 20 s balloon, message truncated to 1200 chars, 90 s subprocess timeout). An offline stand-in exists for hosts without a desktop: set `FREECASH_TOAST_STUB=1` and messages are appended to `logs/toast-stub.log` with delivery label `STUB_OK` — **never** `TOAST_OK`, so a stubbed run can never be mistaken for a real delivery.

**Delivery rules.**
- **Always** one line in `alerts/alerts.jsonl`. That file is the canonical evidence record and is never pruned.
- The dedupe key is recorded (`notified-keys.json`) as `QUEUED` **before** dispatch, then updated to the delivery label. A repeated dispatch of the same key returns `DEDUPED` and appends only a log line — no second toast. One distinct change → exactly one notification, ever.
- **At most 2 attempts**, then it gives up loudly: `record_notified_key(..., DELIVERY_FAILED)` plus a `DELIVERY_FAILED` alert and a `MONITOR_DEGRADED` alert reading *"Notification channel failed twice; this message exists only in alerts.jsonl. Operator must read the log until the channel is fixed."*
- If more than 5 distinct changes land in one day (`MAX_NOTIFICATIONS = 5`), they **coalesce into one summary notification**; one log line per change remains.
- Zero notifications have ever fired from the real channel for a real change on this host: before the seeded test there had never been a change at all, and the seeded test used the stub. **[UNVERIFIED: real balloon delivery on this desktop.]**

**What you do on receiving one:**
1. Confirm the `day_key` in the message is **today**. A stale/manual replay is not a new event.
2. Read `data/freecash-monitor/alerts/alerts.jsonl` (last lines) for the authoritative record of the change — old value, new value, prior day, source.
3. Cross-check against your own dashboard. The source is stamped `DEGRADED (operator-entered ...)`: it reflects what you typed, not a provider feed.
4. Open the approval queue (§6). **The notification itself authorises nothing.**
5. If a notification is *expected* but absent — go to §8.3.

**No notification is not the same as no data.** `OK_NO_CHANGE` emits a heartbeat style line but no alert-level noise; `MONITOR_DEGRADED` means nobody compared anything. Check the outcome token, not the silence.

---

## 6. R4 — the approval queue, and the human gate

**Where items live:** `data/freecash-monitor/approvals/pending.json` (queue) and `data/freecash-monitor/approvals/decided.jsonl` (append-only human decision trail, never pruned). The queue is **empty right now** (`python approval_queue.py list` → `approval queue is empty`).

**What an item is.** When a real change is detected, the routine **enqueues** one item — enqueueing is *not* a decision and *not* an action. Every item carries structurally frozen fields:

| Field | Value | Why |
|---|---|---|
| `proposed_action.action_type` | `REQUEST_PAYOUT` | A label for a human to weigh, nothing more |
| `proposed_action.destination` | `OPERATOR_SPECIFIED - not stored by the routine` | No destination is ever derived or stored |
| `proposed_action.provider_endpoint` | `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` | There is no endpoint — the routine will not invent one |
| `execution_state` | `NOT_EXECUTED` (always) | The only execution state this routine may ever write |
| `execution_allowed_by_this_routine` | `false` (always) | Never settable by this code |
| `expires_at_utc` | `null` (always) | No clock exists that can turn "expired" into "execute". The routine never sets an expiry |

**Inspecting and deciding (the human step):**

```bash
cd /d/AgenticOS/monitoring/freecash
python approval_queue.py list
python approval_queue.py decide --id <approval_id-uuid> \
  --decision approve \
  --by "Your Name" \
  --note "why you decided this"
```

`--decision` accepts `approve` or `reject`; `--by` must name a human (a decision without a human identity is refused with `NotHumanError`, exit 4). Recording a decision appends to `decided.jsonl` and updates the item's `status` — and prints, verbatim, `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)`. **`approve` does not trigger anything.** It records your intent for the audit trail.

**The approval gate.** Everything after `approve` is **out of band and on you**: you, a human, in your own browser session, deciding whether to take an external action at all. The routine has no code path from the queue to a provider — no request builder, no transport, no credential holder. If you decide to act, you do it yourself outside this system; if you decide not to, nothing happens. Pending items are re-mentioned every 7 days (`APPROVAL_PENDING`) so an item cannot rot invisibly, and they can sit forever without consequence.

**NEVER automate — these are the R2/R4 boundary, not preferences:**

- Any earning or money-movement verb: `claim`, `withdraw`, `cashout`, `redeem`, `payout`, `transfer`, `bet`, `spin`, `deposit`, `purchase`, `checkout`.
- Any `POST`, `PUT`, `PATCH` or `DELETE` to any provider or platform, ever, for any reason.
- Any automated login, credential entry, or session handling on your behalf by this routine. (No secret is stored by it anywhere; if a token is ever discussed in a document, write `[REDACTED]`.)
- Auto-approving, auto-deciding, or "deciding as the agent" — `decide` requires a human name; do not script it.
- Adding an expiry-driven execution path ("expired, so execute"). That mechanism deliberately does not exist here.
- Scheduling `scripts/make_freecash_check.py` or anything else that contains a `withdraw`/`claim`/`run_action` shape (R2 gate: exit 1).
- Back-filling or re-reading a past day to "catch up" (R1).
- Deleting a day lock to obtain a second reading.

---

## 7. Scheduling options actually available on this Windows host

**Nothing is scheduled, and this document does not schedule anything.** `hermes cron list` → `No scheduled jobs.`; no Free Cash entry exists in Task Scheduler; `crontab` does not exist on this host (`crontab: command not found`), which also disqualifies `config/freecash-crontab` as a mechanism regardless of its stale contents. What follows are the options you can choose from, with the exact commands **you** would run.

**One consequence that shapes every option below:** any automatic trigger fires *before* you have typed the day's reading, and the day lock is taken before the read (§2.0). So an early automatic run burns the day on a degraded snapshot. Schedule **after** your normal dashboard-reading time, or make the trigger itself the moment you have entered the numbers.

### Option A — Manual daily ritual (recommended starting point)
| | |
|---|---|
| **What** | You enter the reading (§4) and then run the check once yourself. |
| **Command** | `cd /d/AgenticOS/monitoring/freecash && python run_daily_check.py` |
| **Expected Effort** | ~5 minutes/day. Zero setup: nothing to install, nothing to schedule, nothing to maintain. |
| **Time-to-Revenue** | **Zero revenue produced by this option, by design.** The routine never earns, claims, or moves money; it observes and notifies. Any revenue requires a separate external human action outside this system. What you get instead is a daily, auditable, rule-compliant record. |
| **Dependencies** | The repo at `D:/AgenticOS`; the interpreter you verified (`python` in git-bash); your own dashboard login done by you; the `state/operator-state.json` file being writable. |
| **First Concrete Action** | Tomorrow (2026-09-21) morning: do §2.2 steps 1–3 for the first time, then run the command once. Expect `RUN_OK 2026-09-21 outcome=INITIAL_BASELINE` — the first real reading has no prior to compare, so nothing is notified that day. |

### Option B — Windows Task Scheduler, once daily at a fixed local time
| | |
|---|---|
| **What** | Task Scheduler runs the single command each day, after your usual reading time. Documented, **not created here**. |
| **Command you would run** | `schtasks /Create /TN "FreeCashMonitorDaily" /TR "cmd /c cd /d D:\AgenticOS\monitoring\freecash && \"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" run_daily_check.py" /SC DAILY /ST 08:30 /F` · verify: `schtasks /query /TN "FreeCashMonitorDaily" /v /fo LIST` · remove: `schtasks /Delete /TN "FreeCashMonitorDaily" /F` |
| **Expected Effort** | ~15 minutes once, then ~0/day. Note `schtasks` exists at `C:/WINDOWS/system32/schtasks` (verified). |
| **Time-to-Revenue** | **Zero revenue produced, by design** (see Option A). This option buys coverage, not income: it guarantees the daily record exists even on days you forget, at the cost of burning the day on a degraded reading whenever you have not entered data by 08:30. |
| **Dependencies** | An **absolute** interpreter path (a scheduled task has no git-bash profile and no venv activation): the bare word `python` resolves through `PATH` to four different interpreters on this machine — `...\hermes-agent\venv\Scripts\python.exe` (3.11.9, has `tzdata`, resolves `Europe/Berlin`), `C:\Python314\python.exe`, `C:\Users\cd-pr\AppData\Local\Programs\Python\Python311\python.exe` (no `tzdata` → `WARNING timezone_unavailable`), and the WindowsApps stub. Pin one path explicitly and test it. Also: whether the task runs while the session is locked has **not** been tested here. |
| **First Concrete Action** | Pick your interpreter, confirm the exact command works by hand from a plain `cmd` window (`cd /d D:\AgenticOS\monitoring\freecash` then the absolute-path command), and only then create the task — keeping the time after your reading ritual. |

### Option C — Windows Task Scheduler at logon (missed-day-tolerant variant)
| | |
|---|---|
| **What** | Fires at first logon instead of a fixed clock time, so a machine that was off does not silently skip the day. Still at most one run per day (the lock is the guarantee, not the scheduler). |
| **Command you would run** | `schtasks /Create /TN "FreeCashMonitorAtLogon" /TR "cmd /c cd /d D:\AgenticOS\monitoring\freecash && \"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" run_daily_check.py" /SC ONLOGON /F` |
| **Expected Effort** | ~15 minutes once; ~0/day. |
| **Time-to-Revenue** | **Zero revenue produced, by design.** Benefit is a smaller probability of an uncovered day, since logon is closer to when you actually read your dashboard. |
| **Dependencies** | Same pinned-interpreter dependency as Option B; the machine must be logged into at least once that day; a logon run that happens before your data entry still spends the day degraded. |
| **First Concrete Action** | Decide between Option B and C on one criterion: does this machine get switched on daily? If yes → B at a post-reading time. If not → C. Then test the command by hand once before scheduling it. |

### Option D — Hermes cron job
| | |
|---|---|
| **What** | Hermes's own scheduler drives the run. The CLI is present and working (verified `hermes --version` → `Hermes Agent v0.21.3`, `hermes cron --help` lists `create/list/run/pause/resume/remove`), and `hermes cron list` currently shows nothing scheduled. |
| **Command shape you would run** | `hermes cron create "30 8 * * *" --name "FreeCash daily check" --no-agent --script freecash_daily_check.sh --deliver local` — note `--script` must be a script under `~/.hermes/scripts/`, and with `--no-agent` the script's stdout is delivered verbatim (**empty stdout = silent**, the classic watchdog pattern). The wrapper script is yours to author; it was **not** written or tested here. |
| **Expected Effort** | ~30–45 minutes once (wrapper script under `~/.hermes/scripts/`, then `hermes cron create`, then `hermes cron run` to force one tick and confirm). |
| **Time-to-Revenue** | **Zero revenue produced, by design.** The upside over Option B is that the result is delivered into your Hermes/Bot-Chat surface where you already are, rather than into a Task Scheduler void. |
| **Dependencies** | Hermes installed and its scheduler running on this host (installed, version verified); a wrapper script you write under `~/.hermes/scripts/`; the same pinned-interpreter care. **[UNVERIFIED: that a Hermes cron job actually fires on this host — no job exists to observe.]** |
| **First Concrete Action** | Create the wrapper script, run `hermes cron create ... --paused`, then `hermes cron list` and `hermes cron run` to observe one real tick before unpausing. |

### Option E — crontab / `config/freecash-crontab` (rejected)
| | |
|---|---|
| **What** | The vendored crontab file. Rejected on two independent grounds. |
| **Command** | `crontab -l` → **`crontab: command not found`** on this host: there is no cron daemon to read that file, so it is inert. |
| **Expected Effort** | n/a — do not build on it. |
| **Time-to-Revenue** | n/a. |
| **Dependencies** | A POSIX cron daemon (absent), *and* a corrected path (the file still says `/path/to/AgenticOS`), *and* a corrected target (it points at `scripts/make_freecash_check.py`, which **fails** the R2 gate with exit 1 — see §1.1). |
| **First Concrete Action** | Leave the file untouched and unscheduled. If you want it to stop being a trap later, that is a separate, deliberate edit — not part of this workflow. |

---

## 8. Failure and escalation handling

### 8.1 Missed day (no run at all)
- **Detect:** `python watchdog.py` → `WATCHDOG_MISSED_DAY <day> last_attempt_day=... last_outcome=...`; or a `MISSED_DAY` notification at the next run; or `consecutive_missed_days > 0` in `state/last-run.json`.
- **Do:** run today's check normally, **after** entering today's reading. The gap stays a gap.
- **Never:** back-fill the missed day, delete a lock, or re-read a past day. One check per day is the point of the system; a repaired gap is a violated rule.
- **Escalate:** 3+ consecutive missed days → the scheduler is not firing. Check the trigger first (`hermes cron list`, `schtasks /query /TN "FreeCashMonitorDaily"`) before touching the routine.

### 8.2 Degraded reading (`MONITOR_DEGRADED`, null snapshot)
- **Meaning:** for today there was no `operator-state.json` record whose `day_key` equals today (or the timezone fell back, §8.5). The snapshot exists but holds nulls; nothing was compared, nothing notified.
- **Confirm the cause:** `python run_daily_check.py --print-state` prints the ledger path and values; then read the `MONITOR_DEGRADED` line in `alerts/alerts.jsonl` — it names the reason verbatim (`no operator-entered record for <day> in operator-state.json`).
- **Do:** treat today's check as spent and accept it. Enter the reading for the **next** day and run then.
- **Do not:** delete the day lock to "get a real reading today". That is the one action this whole design exists to prevent.
- **Expect a second-order effect (grounded in `changedetect.compare`):** tomorrow's first real reading has a data-less prior, so tomorrow is `INITIAL_BASELINE` — no change notification will be emitted that day. Change detection starts from the reading after that. Two days, not one, to be back in business.

### 8.3 Notification channel failure
- **Detect:** `DELIVERY_FAILED` lines in `alerts/alerts.jsonl` after 2 attempts, plus the companion `MONITOR_DEGRADED` line: *"Notification channel failed twice; this message exists only in alerts.jsonl. Operator must read the log until the channel is fixed."*
- **Do:** read `data/freecash-monitor/alerts/alerts.jsonl` daily by hand until the channel is fixed — that file is the canonical record and does not depend on any channel. `logs/toast-stub.log` (`STUB_OK`) is **not** a real delivery and does not count.
- **Diagnose:** the real channel is a PowerShell `NotifyIcon` balloon. Confirm the toast path works on this desktop at all (notifications may be disabled by Focus Assist / Do Not Disturb, or the session may be non-interactive). **[UNVERIFIED: real balloon delivery from this routine has never been observed on this host.]**
- **Do not** escalate a delivery failure into anything else: the failure is already recorded and the routine continues by design; a delivery failure must never become an action.
- **Escalate:** channel failing on 3+ consecutive days → make manual `alerts.jsonl` review the standing procedure until the desktop notification path is proven.

### 8.4 Read failure (`RUN_FAILED <day> reason=...`, exit 5) **[path read from source; not exercised]**
- **Meaning:** the read itself raised (a `ReadError`/`ForbiddenWriteError`/`MetricError`). A `READ_FAILED` notification is emitted and the ledger records the outcome **without** advancing `last_success_day` — so the day counts as uncovered.
- **Do:** read the reason in the printed line and in `alerts/alerts.jsonl`. For `operator_entered` the realistic cause is a malformed/unreadable `operator-state.json`; fix the JSON, then accept that today's check is spent.
- **Never:** retry in a way that would produce a second read of the same day.

### 8.5 Timezone change / timezone unavailable
- **Configured zone:** `FREECASH_TZ` (default `Europe/Berlin`). If it differs from the zone recorded in `state/last-run.json`, the routine emits a `MONITOR_DEGRADED` alert: *"Timezone changed since the last run (ledger=..., now=...). Day-key boundaries may show a gap or an extra day."*
- **Unavailable zone:** if the configured name cannot be resolved (Python's `zoneinfo` ships without an IANA database; `tzdata` is required on Windows), the routine prints `WARNING timezone_unavailable configured=... offset=...` and uses the machine's own local zone — which *is* your wall clock — reporting the condition as `MONITOR_DEGRADED` rather than pretending the configured name was honoured. Verified both ways on this host: Hermes venv python resolves `Europe/Berlin` (`tzdata 2025.3`, `+0200`); the system 3.11 and `py -3` (3.14.7) do **not** (warning printed, run still `RUN_OK`).
- **Do:** keep `FREECASH_TZ` and the interpreter **stable** from the moment you start relying on the day key. A change of either can shift the day boundary and show up as one extra or one missing day.
- **Expect:** around a DST change, one boundary day may read as missed or as an extra day. That is the correct, visible behaviour — do not "fix" it by re-reading; the routine reports the gap and moves on.
- **If you must change the zone:** do it deliberately, note the date, and read the next day's `MONITOR_DEGRADED` line as the receipt.

### 8.6 Corrupt state file
- `state/last-run.json` is **not** the gate: a corrupt or missing ledger cannot cause a second read in one day, and `load_ledger()` fills missing keys without raising. `read_json` tolerates a corrupt file so a bad state file can never crash startup.
- **Consequence to know:** a corrupt ledger can make `last_success_day` unknown, which suppresses missed-day arithmetic — a silent loss of coverage *reporting*, not of the R1 gate. Detection stays available through `python watchdog.py`.

---

## 9. Rollback / disengagement — returning the system to "monitoring off"

Goal: stop all monitoring, keep the audit trail intact, leave no trigger behind, and confirm nothing is executing. Order matters — **stop the trigger first**, because a run that happens after the archive is pointless (and spends a lock).

**Step 1 — stop the trigger (whichever you created; check all three, they are independent):**

```bash
hermes cron list                       # if a job exists: hermes cron pause <id>  (or: hermes cron remove <id>)
schtasks /query /TN "FreeCashMonitorDaily"     # if it exists:
schtasks /Delete /TN "FreeCashMonitorDaily" /F
schtasks /query /TN "FreeCashMonitorAtLogon"   # if it exists:
schtasks /Delete /TN "FreeCashMonitorAtLogon" /F
crontab -l                             # expected: command not found (no cron on this host)
```

**Step 2 — confirm nothing is scheduled:** `hermes cron list` → `No scheduled jobs.`; `schtasks /query /FO LIST` shows no Free Cash task.

**Step 3 — archive the state (keep it, do not delete it).** `alerts/alerts.jsonl` and `approvals/decided.jsonl` are audit records and are never pruned by the routine; preserve that property by hand too:

```bash
mkdir -p /d/AgenticOS/data/freecash-monitor-archive-20260920
cp -r /d/AgenticOS/data/freecash-monitor/. /d/AgenticOS/data/freecash-monitor-archive-20260920/
find /d/AgenticOS/data/freecash-monitor-archive-20260920 -type f | sort
```

**Step 4 — decide what happens to the live data root.** "Monitoring off" needs no mutation: with no trigger, nothing runs. Leaving `state/day-locks/*.lock` in place is harmless and honest (it records which days were spent). If you prefer a clean slate, remove files only *after* the archive in Step 3 exists, and never as a way to obtain a second reading same-day.

**Step 5 — settle the approval queue.** Nothing can execute, ever, but leaving items PENDING muddies the audit trail if you are disengaging:

```bash
cd /d/AgenticOS/monitoring/freecash
python approval_queue.py list
# per open item, as a deliberate human decision:
python approval_queue.py decide --id <uuid> --decision reject --by "Your Name" --note "monitoring disengaged on <date>"
```

**Step 6 — re-confirm the two invariants one last time (cheap, read-only):**

```bash
cd /d/AgenticOS && bash docs/free-cash-monitor-routine/verify-readonly.sh   # expect: forbidden=0 ... PASS (exit 0)
cd /d/AgenticOS/monitoring/freecash && python verify_readonly.py            # expect: PASS (exit 0)
cd /d/AgenticOS/monitoring/freecash && python tests/run_all.py              # expect: tests=52 failures=0 errors=0 skipped=0
```

**Step 7 — verify "off" by observation, not assertion.** Note today's date `D`. Then:
- `ls -1 data/freecash-monitor/state/day-locks/` — no `.lock` file is created for any day after `D`.
- `ls -1 data/freecash-monitor/snapshots/` — no snapshot for any day after `D`.
- `cat data/freecash-monitor/state/last-run.json` — `last_attempt_day` stops advancing.
Those three observations together are the proof that monitoring is off. Nothing else is required.

**Step 8 — no credential cleanup, because there is nothing to clean.** The routine stores no credential, holds no session, and opens no socket for the `operator_entered` source. If you ever find a token-shaped value anywhere in this tree, treat it as an incident: rotate it at the provider, and record it in the document as `[REDACTED]`.

**Restarting later:** reverse Steps 1 and 4 (re-create the trigger, keep the same interpreter and `FREECASH_TZ`), enter a reading for the new day, run once. Because the prior snapshot may be old and the ledger stale, expect `MISSED_DAY` notifications for the gap and `INITIAL_BASELINE` for the first reading — both are correct and neither is an error.

---

## 10. Compliance table — R1–R4, mechanism, evidence

| Rule | Concrete enforcing mechanism (in the code) | Command that evidences it | Verified output |
|---|---|---|---|
| **R1** exactly one check per local day | `gate.acquire_day_lock()`: atomic `os.open(..., O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock` (zero bytes; the filename *is* the day key). Lock taken **before** the read. Ledger is deliberately **not** the gate. `--force-recheck` refused by design (exit 3, logged). Missed days detected and never back-filled. | `cd /d/AgenticOS/monitoring/freecash && python run_daily_check.py` — **run twice in one day**; then `python run_daily_check.py --force-recheck --reason "verify"`; plus `python tests/run_all.py` (`test_r1_gate.py`) | run 1: `RUN_OK 2026-09-20 ... lock=2026-09-20.lock` (exit 0) · run 2: `SKIP_DUPLICATE_DAY 2026-09-20` (exit 0) · force: `REFUSED_FORCE_RECHECK ...` (exit **3**) · `tests=52 failures=0` |
| **R2** zero automated earning actions | `readonly_client.py` permits only `GET`/`HEAD`, only hosts `{localhost, 127.0.0.1, ::1}`, only an allowlisted path set, plus an installed audit hook; no execution path exists anywhere in the routine; no credential stored. Static gate scans for earning verbs, write-call shapes, write-endpoint paths and account-mutation names. | `cd /d/AgenticOS && bash docs/free-cash-monitor-routine/verify-readonly.sh` · `cd /d/AgenticOS/monitoring/freecash && python verify_readonly.py` · `python tests/run_all.py` (`test_r2_readonly.py`) | `forbidden=0 exempt=28 missing_targets=0` / `PASS` (exit 0) · python gate exit **0** · `tests=52 failures=0` |
| **R3** one notification per distinct change | `changedetect.compare()` produces one change per distinct movement (an earnings move that drags the balance is **one** change); `notify.dispatch()` records the dedupe key as `QUEUED` **before** dispatch and marks repeats `DEDUPED`; always one line in `alerts/alerts.jsonl`; at most 2 delivery attempts then `DELIVERY_FAILED`; >5 changes (`MAX_NOTIFICATIONS=5`) coalesce into one summary. | Seed a prior snapshot + today's operator record in a scratch root, then `FREECASH_DATA_ROOT=<scratch> FREECASH_TOAST_STUB=1 python run_daily_check.py`; inspect `alerts/alerts.jsonl`, `state/notified-keys.json`, `logs/toast-stub.log`; `python tests/run_all.py` (`test_r3_changedetect.py`) | `RUN_OK ... outcome=EARNINGS_CHANGED ... changes=1 notifications=1 approvals=1`; `notified-keys.json` → one key with `"delivery": "STUB_OK"`; one toast line; `tests=52 failures=0` |
| **R4** human approval before any external action | `approval_queue.py`: enqueue-only. Frozen fields — `execution_state` = `NOT_EXECUTED`, `execution_allowed_by_this_routine` = `false`, `expires_at_utc` = `null` (no expiry clock that could turn into execution). `decide()` records a human decision and never changes execution state; `--by` is mandatory (`NotHumanError`, exit 4). Nothing in the routine can execute anything. | `cd /d/AgenticOS/monitoring/freecash && python approval_queue.py list` · inspect the item JSON written by the seeded run · `python tests/run_all.py` (`test_r4_approval.py`) | `approval queue is empty` (live root) · seeded item: `"status": "PENDING"`, `"execution_state": "NOT_EXECUTED"`, `"execution_allowed_by_this_routine": false`, `"expires_at_utc": null` · `tests=52 failures=0` |

**One standing gate, whole-suite view, to be run by the operator after any change:**

```bash
cd /d/AgenticOS/monitoring/freecash && python tests/run_all.py          # expect tests=52 failures=0 errors=0 skipped=0
cd /d/AgenticOS && bash docs/free-cash-monitor-routine/verify-readonly.sh  # expect forbidden=0 exempt=28 missing_targets=0 / PASS
```

---

## 11. Not verified (stated plainly, so it is not assumed)

1. **Real toast delivery has never been observed** on this host for a real change. Every verified notification used `FREECASH_TOAST_STUB=1` (label `STUB_OK`), and before the seeded test no change had ever occurred. The desktop balloon path is code-verified only.
2. **Exit codes 2 (`USAGE ERROR`) and 5 (`RUN_FAILED`)** were read from source, not exercised.
3. **Task Scheduler behaviour** — running a task while the session is locked, wake-from-sleep, and catch-up semantics — was **not** tested. The `schtasks` commands in §7 are documented commands for you to run, not executed here.
4. **Hermes cron** is installed and its CLI responds, but **no job has ever been created or observed firing** on this host (`hermes cron list` → `No scheduled jobs.`). The wrapper script under `~/.hermes/scripts/` does not exist yet.
5. **There is no provider data source.** No provider endpoint, URL or API is configured or known to this routine; `metrics_http` can only reach localhost through `readonly_client`. All figures in every snapshot so far are null.
6. **No revenue is produced or implied by any option in §7.** The routine has no earning path at all, by construction.
7. `monitoring/freecash/paths.py` references a `README.md` in its docstring; **no `README.md` exists in `monitoring/freecash/`** (the directory contains only `.py` files, `tests/`, and `__pycache__/`). Documentation gap, harmless to operation.
8. `config/freecash-crontab` and `scripts/make_freecash_check.py` were **not modified** (outside this task's write scope). The R2 gate fails on the latter with exit 1; it must remain unscheduled.

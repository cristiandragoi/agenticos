# Free Cash Finance Automation — Daily Status-Monitoring Routine
## Workflow & Operations Plan (evidence-backed)

| | |
|---|---|
| **Routine** | `D:\AgenticOS\monitoring\freecash\` (canonical implementation, untracked by git) |
| **Entry point** | `run_daily_check.py` (v1.0.0) |
| **Second detector** | `watchdog.py` |
| **Document date** | 2026-09-20 |
| **Host** | Windows 11, git-bash (MSYS), node v24.20.0, PowerShell 5.1.26100.9444 |
| **Repo** | `D:\AgenticOS`, HEAD `d14253df179dd8ceff1d1e4ee43ca9035cdb69ff` |
| **Interpreters** | `python` → `…\hermes-agent\venv\Scripts\python.exe` (3.11.9, **has tzdata**) · `py -3` → `C:\Python314\python.exe` (3.14.7, **no tzdata**) |
| **Prior evidence read** | `docs/freecash-monitor-audit-evidence.md` (2026-09-19 audit), `docs/freecash-monitor-research-plan.md`, `docs/freecash-monitor-workflow-plan.md`, `docs/freecash-automation-workflow-plan-v2.md`, `docs/freecash-monitoring.md`, `config/freecash-crontab` |

**Evidence tags used on every factual claim:**

| Tag | Meaning |
|---|---|
| `[E]` | **verified by execution** — the command was run on this host and its real output is quoted here |
| `[S]` | **read from source / read from a file** — not executed |
| `[U]` | **unknown / not verified** |

**One document, no new monitor.** Every command below was executed against an **isolated data root** under
`%LOCALAPPDATA%\Temp\` (`FREECASH_DATA_ROOT` override). The repository's own data root
`D:\AgenticOS\data\freecash-monitor\` was **not** written to by this work `[E]` — its files still carry the
21:08 timestamp of an earlier, unrelated run. The only file this work added to the repository is this document.

**No credential, token or secret appears in this document, and none was used.** A scan of the routine tree for
`token|secret|api_key|bearer|password|credential|authorization` returns only docstring prose `[E]`; the routine reads
exactly seven `FREECASH_*` environment variables and no secret-bearing one `[E]`; `D:\AgenticOS\.env` contains no
`FREECASH_*` / `HG_CASH_*` / `CASHFREE_*` / `PAYOUT_*` variable `[E]`. No provider API was called by this work.

---

## 0. Scope and method

Scope: a **workflow/operations plan** for one daily status-monitoring routine, backed by live execution evidence,
enforcing four binding rules:

| Rule | Binding statement |
|---|---|
| **R1** | No automated earning action. Read-only `GET`/`HEAD` only. Never withdraw / cashout / claim / redeem / transfer / complete an offer. |
| **R2** | Exactly one status check per **operator-local calendar day**. A second same-day run must skip. |
| **R3** | Notify the operator when **earnings or account status changes**. Change detection must compare against the **prior snapshot** and must be provably able to fire. |
| **R4** | Human approval before **any** external action. Approval queue written and read back; never auto-executed. |

Method: the canonical implementation was (a) read in full, (b) executed against **five isolated data roots**
(`freecash-proof-A` … `freecash-proof-E`) with raw stdout and exit codes captured, (c) mutation-checked by
attempting forbidden verbs/hosts/paths at the transport layer, and (d) re-gated by its own 52-test suite and its own
static read-only checker. Anything carried over from the 2026-09-19 audit was **re-run rather than repeated**; §11
records what changed.

### 0.1 Label drift — read this before reading any log line

The implementation numbers the rules **differently** from this plan `[S]`:

| Binding rule (this document, the task) | Implementation's own label | Where |
|---|---|---|
| R1 no automated earning action | *(no rule label — enforced structurally by the transport)* | `readonly_client.py`; `verify_readonly.py` calls itself "R2 layer C" |
| R2 one check per operator-local day | **"R1"** | `gate.py` docstring `"R1: exactly one status read…"`; refusal text `"forbidden by R1"` |
| R3 notify on change | "R3" | `changedetect.py` |
| R4 human approval | "R4" | `approval_queue.py` |

Consequence: `REFUSED_FORCE_RECHECK … forbidden by R1` means **R2 of this plan** (a second read in one day).
An operator reading logs against this document must apply that mapping. Flagged as an operational wart, not a defect
in behaviour `[S]`.

---

## 1. The routine in one screen

```
        ┌─ one operator-local calendar day ────────────────────────────────────────────┐
        │                                                                              │
  cron ─┤ run_daily_check.py                                                           │
 08:35  │   1. os.open(day-locks/<YYYY-MM-DD>.lock, O_CREAT|O_EXCL|O_WRONLY)   ← the gate│
        │      exists? → SKIP_DUPLICATE_DAY, exit 0, NO read, NO snapshot, NO ledger   │
        │   2. ledger: record attempt, detect missed days (never back-fill)            │
        │   3. R1 read-only source: operator-state file, or allowlisted loopback GET   │
        │   4. prior = load_prior_snapshot(day)      ← LOAD BEFORE WRITE               │
        │      snapshot = build_snapshot(...)                                          │
        │      verdict = compare(prior, snapshot)    4 fields, exact integer cents      │
        │      save_snapshot(...)                    ← immutable once written          │
        │   5. R3 one alert line per change + ≤1 notification per change (dedupe key)   │
        │   6. R4 enqueue an approval item per notified change — nothing executes       │
        └──────────────────────────────────────────────────────────────────────────────┘
 23:50  watchdog.py  → WATCHDOG_OK | WATCHDOG_MISSED_DAY (no socket, no ledger write, no lock)
```

Data root (`FREECASH_DATA_ROOT`, default `D:/AgenticOS/data/freecash-monitor`) `[S]`:

```
<root>/state/last-run.json            ledger — missed-day math, tz record, outcome
<root>/state/day-locks/<day>.lock     zero-byte file; presence == day consumed
<root>/state/notified-keys.json       dedupe index for R3
<root>/state/operator-state.json      the operator's four daily figures (read-only input)
<root>/snapshots/<day>.json           one immutable snapshot per successful day
<root>/approvals/pending.json         approval queue (R4)
<root>/approvals/decided.jsonl        append-only human decision trail (R4)
<root>/alerts/alerts.jsonl            append-only alert log — the canonical evidence record
<root>/logs/forced-recheck-requests.jsonl, logs/toast-stub.log
```

---

## 2. The four rules as enforced invariants

### R1 — no automated earning action, ever

| # | Enforcing artifact | Mechanism | Proof in this session |
|---|---|---|---|
| 1 | `readonly_client.py::request()` lines 110–140 | method allowlist `ALLOWED_METHODS={'GET','HEAD'}` — everything else raises `ForbiddenWriteError` **before** the single socket site | `[E]` POST / PUT / DELETE all refused; **`transport` was never reached** (`calls == []`), while the allowlisted control GET *did* reach it |
| 2 | `readonly_client.py::ALLOWED_PATHS` lines 43–49 | path allowlist = exactly `^/api/v1/status/metrics$` and `^/api/v1/status$`. Provider paths are deliberately absent; the greppable literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` marks the gap | `[E]` `GET http://localhost:3001/api/v1/withdraw` → `ForbiddenWriteError: R2: path not allowlisted`; `…/api/v1/status/claim` → refused |
| 3 | `readonly_client.py::ALLOWED_HOSTS` line 41 | loopback only — `localhost`, `127.0.0.1`, `::1`, `[::1]`. A provider hostname cannot be reached even if a caller supplies one | `[E]` `GET https://hg.cash/api/v1/accounts` → `ForbiddenWriteError: R2: host not allowlisted: 'hg.cash'` |
| 4 | `readonly_client.py::BODY_KEYWORDS` line 52 + unknown-kwarg rejection | request bodies (`data/json/files/body/content`) and unknown keywords are refused | `[E]` `request("POST", …, json={})` refused on the **method** gate; source shows the body gate at lines 120–126 `[S]` |
| 5 | `readonly_client.py::install_audit_guard()` lines 146–176 | process-wide `sys.addaudithook` aborting `socket.connect`/`socket.getaddrinfo` to any non-loopback address (installed by `run_daily_check._run` at startup) | `[E]` guard installed during every proof run; its behavioural test passes in the 52/52 suite |
| 6 | `verify_readonly.py` (204 L) | static CI gate over six forbidden token classes — `http-verb`, `write-call-shape`, `earning-verb`, `earning-action`, `write-endpoint-path`, `account-mutation`. Per-line exemption requires the inline marker `readonly-exempt: <reason>`. exit 0 clean / 1 forbidden / 2 target missing (**not** a pass) | `[E]` `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit **0** |
| 7 | `approval_queue.py::EXECUTION_STATE_NOT_EXECUTED`, `EXECUTION_ALLOWED_BY_THIS_ROUTINE = False` lines 44–45 | the only execution state the package can write | `[E]` see §7 — every queued and every decided item still reads `NOT_EXECUTED` / `false` |
| 8 | The routine's own tree | there is **no** execution code path, no provider client, no credential | `[E]` credential scan clean; `[S]` no module other than `approval_queue.py` names `STATUS_APPROVED` |

**Residual risk `[U]`:** R1 is enforced for *this routine*. It does not constrain any other file in the repo —
`docs/freecash-monitoring.md` still prescribes `POST /withdraw` and `POST /survey/complete<id>` in its
"06: Execute Single Actions…" step `[S]`, and `finance-monitor/src/action_executor.py` is an execution path `[S]`.
Those are not part of the routine and are not scheduled by anything (§4).

### R2 — exactly one status check per operator-local calendar day

| # | Enforcing artifact | Mechanism | Proof in this session |
|---|---|---|---|
| 1 | `gate.py::acquire_day_lock()` lines 119–135 | `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`. One atomic syscall — there is no read-then-write window and no `if exists` check to race on. The filename **is** the day key; the file is zero bytes so a partial write cannot be misread. `FileExistsError` ⇒ `(False, lock)` ⇒ caller performs no work at all | `[E]` **5 simultaneous processes → exactly 1 `RUN_OK` + 4 `SKIP_DUPLICATE_DAY`, 1 lock, 1 snapshot, all exit 0**; lock is 0 bytes |
| 2 | `run_daily_check.py` lines 309–321 | the duplicate path prints `SKIP_DUPLICATE_DAY`, appends exactly one alert line, and returns 0 **before** any read, snapshot or ledger write | `[E]` second and third same-day runs: ledger and snapshot `sha256` **byte-identical before/after**; only a `SKIP_DUPLICATE_DAY` alert line added |
| 3 | `gate.py::day_key()` lines 96–102 + `zone()` | day key = `now.astimezone(zone).date().isoformat()` under `FREECASH_TZ` (default `Europe/Berlin`) — an ISO `YYYY-MM-DD` string, no epoch, no locale formatter | `[E]` the ledger records `timezone: Europe/Berlin`; a clock pinned to `2026-09-22T23:50Z` yields day key **`2026-09-23`** (the next operator-local day) |
| 4 | `gate.py::lock_path()` + `paths.day_locks_dir()` | a second read of a *past* day is impossible without creating that day's lock, and `gate.missed_days()` explicitly never back-fills | `[E]` a failed day produced a lock with **no** snapshot and no catch-up run; `[S]` `missed_days()` excludes today and the last success |
| 5 | `run_daily_check.py` lines 281–297 | `--force-recheck` is accepted only to be **refused** (exit 3) and audited | `[E]` exit **3**, refusal line written to `logs/forced-recheck-requests.jsonl` |
| 6 | `watchdog.py` (112 L) | the same-evening "did the check run?" alarm. Opens **no** socket, never writes the ledger, never creates or clears a lock, never writes a snapshot, never touches the queue, always exits 0 | `[E]` healthy day → `WATCHDOG_OK`; uncovered day → `WATCHDOG_MISSED_DAY … coverage=NOTIFIED` then `…DEDUPED` on a second run |
| 7 | Task Scheduler (alternative host) | `-MultipleInstances IgnoreNew` is a *second, independent* layer that makes R2 hold even if the file lock were ever bypassed | `[U]` not applied — no task is registered on this host (§4) |

**The 52-test suite includes a five-process concurrency assertion** and passes 52/52 `[E]` (§3.7).

### R3 — notify when earnings or account status change

| # | Enforcing artifact | Mechanism | Proof in this session |
|---|---|---|---|
| 1 | `changedetect.py::COMPARED_FIELDS` lines 34–39 | exactly four compared fields, **exact integer cents**, no relative or percentage threshold: `account_status` → `STATUS_CHANGED`; `earnings_total_cents` → `EARNINGS_CHANGED`; `balance_cents` → `BALANCE_CHANGED`; `pending_cents` → `EARNINGS_CHANGED` (subtype `pending`). A 1-cent move is a change | `[E]` a 1-cent-class move fired: `$10.25 → $13.40` and `$0.00 → $2.50` each produced their own alert + notification |
| 2 | `run_daily_check.py` lines 402–405 | **prior snapshot is loaded before the new snapshot is written** — the comparison can never be against itself. `save_snapshot` refuses to overwrite an existing day file | `[E]` the change fired against a real prior-day snapshot produced by the routine itself; `[E]` same-day re-run left the snapshot byte-identical (immutable) |
| 3 | `changedetect.py::compare()` lines 226–276 | returns `baseline` when there is nothing trustworthy to compare (no prior snapshot, or either side has no data) so a first run **cannot** produce a fake alarm; skips money fields and reports `MONITOR_DEGRADED` when `currency` changed; treats a missing field as a **read failure**, never a silent zero | `[E]` first-ever run → `outcome=INITIAL_BASELINE … notifications=0`, log-only |
| 4 | `changedetect.py::dedupe_key()` lines 214–216 | `sha256("<day>|<change_type>|<field>|<old>|<new>")` — one change, one notification. The day key is inside the key, so the same movement on a later day legitimately notifies again | `[E]` three distinct changes → three distinct 64-hex keys, one per change |
| 5 | `notify.py::dispatch()` lines 220–261 | the key is written to `notified-keys.json` as `QUEUED` **before** the first send attempt, so a crash may lose one message but can never duplicate one; at most 2 attempts, then `DELIVERY_FAILED` carrying the **full original message** + a `MONITOR_DEGRADED` line, key marked `FAILED_TOAST`, never retried | `[E]` a sender that always fails produced exactly `['DELIVERY_FAILED','MONITOR_DEGRADED']` and `key_delivery == 'FAILED_TOAST'`, exit 0 |
| 6 | `notify.py::emit_no_change()` lines 91–99 | `OK_NO_CHANGE` is **log-only** — it never dispatches, whatever else happens | `[S]` + `[E]` `--print-state`/ledger show the no-change outcome path; the suite asserts log-only |
| 7 | `run_daily_check.py::notify_changes()` lines 173–214 | one alert line per distinct change, ≤1 notification each; **>5** distinct changes coalesce into **one** summary notification (`message_summary`) | `[S]` not exercised at >5 changes |

### R4 — human approval before any external action

| # | Enforcing artifact | Mechanism | Proof in this session |
|---|---|---|---|
| 1 | `approval_queue.py::enqueue()` lines 137–143 | enqueueing is *a notification with a handle*, called only on a real change. `run_daily_check.py` line 151 is the **sole** call site | `[E]` 3 changes → 3 `PENDING` items in `approvals/pending.json`, each with the change's `dedupe_key` |
| 2 | `approval_queue.py::build_item()` lines 108–134 | `expires_at_utc = NO_EXPIRY (None)`, `execution_state = 'NOT_EXECUTED'`, `execution_allowed_by_this_routine = False` — **constants, not parameters** | `[E]` every item reads exactly those three values; `approval_queue.py list` prints them |
| 3 | `approval_queue.py::decide()` lines 161–201 | records `APPROVED`/`REJECTED` with `--by` and `--note`, then **re-asserts all three frozen fields** so a decision cannot arm the item | `[E]` after an `approve` and a `reject`, both items still read `expires_at_utc=None`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False` |
| 4 | `approval_queue.py::_normalise_decider()` + `NON_HUMAN_DECIDERS` lines 54–57, 149–158 | a machine may not sign: `system, routine, automation, agent, cron, scheduler, monitor, bot, script, machine` ⇒ `NotHumanError` ⇒ exit 4; `--by` and `--note` are mandatory | `[E]` `--by "cron"` → exit **4**; `--by "agent"` → exit **4**; empty `--note` → exit **2**; unknown id → exit **3** |
| 5 | Absence of an execution path | nothing anywhere in the routine acts on an `APPROVED` status; only `approval_queue.py` names `STATUS_APPROVED` and only for storage/display | `[E]` grep: `STATUS_APPROVED` appears in `approval_queue.py` only; `run_daily_check.py:163` merely *logs* `item["execution_state"]` |
| 6 | Expiry policy | there **is** no expiry, deliberately: `expires_at_utc` is always `null`. A non-null expiry is the historical laundering step ("expired, therefore execute") and no watchdog, timer, cron entry or scheduler retry may change a pending item's status. A pending item waits indefinitely | `[E]` `[S]` — all live items `expires_at_utc=None`; `decide()` re-asserts it |
| 7 | Nag / escalation | at most one reminder per item per **7 days**; a reminder never decides | `[S]` `nag_pending()` / `nag_due()`; `[E]` the suite's 90-day-clock test passes (`reminders=1` appears in suite output) |

**What R4 does not do:** there is no code path in this repository that carries out a payout, and this plan proposes
none. The queue is a **decision surface for a human**, nothing else.

---

## 3. Verified run evidence

All runs: `cwd = /d/AgenticOS/monitoring/freecash` (`D:\AgenticOS\monitoring\freecash`),
`FREECASH_DATA_ROOT` pointed at an isolated temp root, `FREECASH_TOAST_STUB=1` unless stated.
Interpreter: `python` (`…\venv\Scripts\python.exe`, 3.11.9). `FREECASH_TZ` unset ⇒ default `Europe/Berlin`.
Both roots were created fresh by this session: `rm -rf <root> && mkdir -p <root>/state`, then a **synthetic
example** `operator-state.json` was written into `state/` (four invented figures; no real account data).

### 3.1 Run #1 — clean first run of the day (`freecash-proof-A`)

```
$ cd /d/AgenticOS/monitoring/freecash
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-A' FREECASH_TOAST_STUB=1 \
    python run_daily_check.py
RUN_OK 2026-09-20 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock
$ echo $?
0
```

Exit **0**. The artefact triple appears: lock + snapshot + ledger (§4). `INITIAL_BASELINE` is the correct,
deliberate outcome: there was no prior snapshot, so no comparison and **no fake alarm** (R3 invariant 3).

### 3.2 Run #2 — the second same-day run (R2 enforced)

```
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-A' FREECASH_TOAST_STUB=1 \
    python run_daily_check.py
SKIP_DUPLICATE_DAY 2026-09-20
$ echo $?
0
```

Exit **0** (a duplicate is not an error). Side-effect proof — a third same-day run was bracketed by hashes:

```
### BEFORE
ee88244c2325762b938061fe1c90b7adad1e48096c434cbefa89da3123cc8e4c *state/last-run.json
3e86ab222956e9f2f944644ae9f4731514655489d743da4f47a34cdb1f75e343 *snapshots/2026-09-20.json
alert_lines_before=2

### CMD A2b (third same-day run)
SKIP_DUPLICATE_DAY 2026-09-20
EXIT=0

### AFTER
ee88244c2325762b938061fe1c90b7adad1e48096c434cbefa89da3123cc8e4c *state/last-run.json
3e86ab222956e9f2f944644ae9f4731514655489d743da4f47a34cdb1f75e343 *snapshots/2026-09-20.json
alert_lines_after=3
```

The ledger and the snapshot are **byte-identical**; only one `SKIP_DUPLICATE_DAY` line was appended. No read, no
snapshot write, no ledger write — R2 holds at the artefact level, not merely in the printed word.

### 3.3 Run #3 — `--force-recheck` refusal

```
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-A' FREECASH_TOAST_STUB=1 \
    python run_daily_check.py --force-recheck --reason "routine-proof: prove a second read is refused"
REFUSED_FORCE_RECHECK 2026-09-20 reason='routine-proof: prove a second read is refused' (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)
$ echo $?
3
```

Exit **3**. The refusal itself is audited:

```
$ cat <root>/logs/forced-recheck-requests.jsonl
{"decision": "REFUSED", "reason": "routine-proof: prove a second read is refused", "requested_day": "2026-09-20", "ts_utc": "2026-09-20T19:46:48Z", "why": "one status read per operator-local calendar day (R1)"}
```

> Label drift in action: `forbidden by R1` here means **R2 of this plan** (one check per day). See §0.1.

### 3.4 Corroborating runs (`freecash-proof-A`)

```
$ FREECASH_DATA_ROOT=… python run_daily_check.py --print-state
ledger: C:\Users\cd-pr\AppData\Local\Temp\freecash-proof-A\state\last-run.json
  consecutive_missed_days  0
  last_attempt_at_utc      2026-09-20T19:46:42Z
  last_attempt_day         2026-09-20
  last_outcome             INITIAL_BASELINE
  last_success_at_utc      2026-09-20T19:46:42Z
  last_success_day         2026-09-20
  schema_version           1
  timezone                 Europe/Berlin
  updated_at_utc           2026-09-20T19:46:42Z
pending items: 0
EXIT=0

$ python run_daily_check.py --version
freecash-monitor 1.0.0
EXIT=0

$ FREECASH_DATA_ROOT=… FREECASH_TOAST_STUB=1 python watchdog.py
WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=INITIAL_BASELINE
EXIT=0
```

`last_attempt_day` is populated — this is the field the 2026-09-19 audit found permanently `null` (§11), and the
reason the watchdog used to raise a false alarm on a healthy day.

### 3.5 The change path — R3 and R4 provably able to fire (`freecash-proof-B`)

Step B0 seeds a **real prior-day snapshot** by running the routine itself with a pinned clock (the documented test
seam `run_daily_check.run(now=…)`), so the comparison in B1 is against a routine-produced predecessor rather than a
hand-written fixture:

```
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-B' FREECASH_TOAST_STUB=1 python -c "
import datetime,run_daily_check
raise SystemExit(run_daily_check.run([], now=datetime.datetime(2026,9,19,6,40,tzinfo=datetime.timezone.utc)))"
RUN_OK 2026-09-19 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-19.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-19.lock
EXIT=0
```

Then today's **first** run, real clock, with the operator's 2026-09-20 figures having moved:

```
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-B' FREECASH_TOAST_STUB=1 \
    python run_daily_check.py
RUN_OK 2026-09-20 outcome=STATUS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=3 notifications=3 approvals=3 reminders=0 lock=2026-09-20.lock
$ echo $?
0
```

`changes=3 notifications=3 approvals=3` — **R3 fires on a real change and R4 enqueues one item per change.**
The append-only alert log (`alerts/alerts.jsonl`), verbatim, newlines shown as `|` for readability:

```
2026-09-19 | INITIAL_BASELINE/info | First run: baseline recorded for 2026-09-19. No notification sent. Source DEGRADED (operator-entered record for 2026-09-19).
2026-09-20 | APPROVAL_PENDING/notify | Approval item ef040dc7-6fe4-4dd9-917c-245fd0bcd2d6 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.
2026-09-20 | STATUS_CHANGED/notify | [FreeCash] STATUS CHANGE 2026-09-20 | Account status: ACTIVE -> PAUSED | Earnings:  $13.40 (unchanged)  Balance: $13.40 (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-20) | Detail:    alerts.jsonl dedupe=d117af43d2d98224 | ACTION:    No action taken. Review and approve anything you want done. | Approval:  ef040dc7-6fe4-4dd9-917c-245fd0bcd2d6 (PENDING - yours to decide, nothing executes)
2026-09-20 | APPROVAL_PENDING/notify | Approval item cc1002a3-b86f-4f18-bf9a-25a7247c9b13 enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.
2026-09-20 | EARNINGS_CHANGED/notify | [FreeCash] EARNINGS CHANGE 2026-09-20 | Earnings:  $10.25 -> $13.40  (+$3.15) | Balance:   $13.40 (changed too) | Pending:   $2.50 | Status:    PAUSED (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-20) | Detail:    alerts.jsonl dedupe=0ac2c9cf5a4df1cf | ACTION:    No action taken. Review and approve anything you want done. | Approval:  cc1002a3-b86f-4f18-bf9a-25a7247c9b13 (PENDING - yours to decide, nothing executes)
2026-09-20 | APPROVAL_PENDING/notify | Approval item 999ab081-b75d-4859-b2f6-2aa16e4c6b5d enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you.
2026-09-20 | EARNINGS_CHANGED/notify | [FreeCash] EARNINGS CHANGE 2026-09-20 | Pending:   $0.00 -> $2.50  (+$2.50) | Earnings:  $13.40 (unchanged) | Balance:   $13.40 (unchanged) | Source:    DEGRADED (operator-entered record for 2026-09-20) | Detail:    alerts.jsonl dedupe=efe015cb2ff9c7fb | ACTION:    No action taken. Review and approve anything you want done. | Approval:  999ab081-b75d-4859-b2f6-2aa16e4c6b5d (PENDING - yours to decide, nothing executes)
```

Note the three invariants visible in that log: the earnings change absorbs the balance movement into **one**
notification (`Balance: $13.40 (changed too)`), while a balance move *without* an earnings move would be its own
`BALANCE_CHANGED` `[S]`; the `ACTION: No action taken.` line is present on every dispatched message; and every
notification carries the approval handle.

### 3.6 Concurrency — 5 simultaneous processes, one day (`freecash-proof-E`)

```
### CONCURRENCY PROOF: 5 simultaneous processes, same isolated root, same operator-local day
interpreter: C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
proc1 exit=0  RUN_OK 2026-09-20 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock
proc2 exit=0  SKIP_DUPLICATE_DAY 2026-09-20
proc3 exit=0  SKIP_DUPLICATE_DAY 2026-09-20
proc4 exit=0  SKIP_DUPLICATE_DAY 2026-09-20
proc5 exit=0  SKIP_DUPLICATE_DAY 2026-09-20
--- tally: {'RUN_OK': 1, 'SKIP_DUPLICATE_DAY': 4}
locks=1 ['2026-09-20.lock']
snapshots=1 ['2026-09-20.json']
```

Exactly one winner; one lock; one snapshot; all five exit 0. **R2 is not a check-then-act race.**

### 3.7 Forbidden-action transport proof (R1)

```
POST    http://localhost:3001/api/v1/status/metrics          -> ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)
PUT     http://localhost:3001/api/v1/status/metrics          -> ForbiddenWriteError: R2: method 'PUT' is not read-only (allowed: GET, HEAD)
DELETE  http://localhost:3001/api/v1/status/metrics          -> ForbiddenWriteError: R2: method 'DELETE' is not read-only (allowed: GET, HEAD)
GET     http://localhost:3001/api/v1/withdraw                -> ForbiddenWriteError: R2: path not allowlisted: '/api/v1/withdraw'
GET     http://localhost:3001/api/v1/status/claim            -> ForbiddenWriteError: R2: path not allowlisted: '/api/v1/status/claim'
GET     https://hg.cash/api/v1/accounts                      -> ForbiddenWriteError: R2: host not allowlisted: 'hg.cash'
POST    http://localhost:3001/api/v1/status/metrics          -> ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)
transport reached for refusals? calls=[]
control allowlisted GET reached transport: [('GET', 'http://localhost:3001/api/v1/status/metrics')]
```

Every refusal happened **before** the single socket site (`_transport` was never entered — `calls == []`), while the
allowlisted control GET reached it. No packet left the machine in the refusal cases.

### 3.8 Failure modes, executed (`freecash-proof-D`)

Read failure (closed loopback port, `--source metrics_http`):

```
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-D' FREECASH_TOAST_STUB=1 python -c "
import datetime, run_daily_check
raise SystemExit(run_daily_check.run(['--source','metrics_http','--base-url','http://localhost:9'],
                 now=datetime.datetime(2026,9,21,6,40,tzinfo=datetime.timezone.utc)))"
RUN_FAILED 2026-09-21 reason=ReadError: GET /api/v1/status/metrics failed: [WinError 10061] Es konnte keine Verbindung hergestellt werden, da der Zielcomputer die Verbindung verweigerte
EXIT=5
```

Exit **5**; the day lock **stays consumed** (`state/day-locks/2026-09-21.lock` is present, 0 bytes) and **no snapshot**
was written for 2026-09-21 — there is no automatic re-run. A deliberately lost day looks exactly like this.

Notification channel failure (sender that always raises):

```
dispatch returned: 'FAILED_TOAST'
recorded delivery for key: 'FAILED_TOAST'
last two alert event_types: ['DELIVERY_FAILED', 'MONITOR_DEGRADED']
EXIT=0
```

Bounded at two attempts, the **full original message** is preserved in `alerts.jsonl`, and the failure is announced.
A failed notification never blocks a state write, never re-reads the status source and never causes a second run.

Watchdog on an uncovered day (`freecash-proof-A`, clock pinned):

```
$ FREECASH_DATA_ROOT=… FREECASH_TOAST_STUB=1 python -c "import datetime, watchdog; watchdog.check(now=datetime.datetime(2026,9,22,23,50,tzinfo=datetime.timezone.utc))"
WATCHDOG_MISSED_DAY 2026-09-23 last_attempt_day=2026-09-20 last_outcome=INITIAL_BASELINE coverage=NOTIFIED
EXIT=0
$ … same evening, second run
WATCHDOG_MISSED_DAY 2026-09-23 last_attempt_day=2026-09-20 last_outcome=INITIAL_BASELINE coverage=DEDUPED
```

The `MISSED_DAY` message the operator receives:

```
[FreeCash] MISSED DAY 2026-09-23
No successful status check recorded for 2026-09-23.
Last success: 2026-09-20. consecutive_missed_days=2
ACTION:    No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).
severity=alert dedupe=a9469d19c8178e69
```

One alarm per day (`NOTIFIED` then `DEDUPED`), severity `alert`. Incidentally this proves the day-key semantics:
`2026-09-22T23:50Z` is **`2026-09-23`** operator-local.

### 3.9 Interpreter matters (`freecash-proof-C`)

```
$ FREECASH_DATA_ROOT='C:/Users/cd-pr/AppData/Local/Temp/freecash-proof-C' FREECASH_TOAST_STUB=1 py -3 run_daily_check.py
WARNING timezone_unavailable configured=Europe/Berlin offset=+0200
RUN_OK 2026-09-20 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock
EXIT=0

$ … py -3 run_daily_check.py      # second run, same day
SKIP_DUPLICATE_DAY 2026-09-20
EXIT=0
```

`py -3` (3.14.7) has **no** `tzdata`, so `Europe/Berlin` is unresolvable, the routine fails loudly to the machine's own
zone (`+0200`, which here *is* the operator's wall clock) and appends a `MONITOR_DEGRADED` info alert **every run**.
The same command under `python` (3.11.9 venv, has `tzdata`) prints no warning and honours the configured name exactly.
**Pick the interpreter deliberately — see §5.2.**

### 3.10 Re-verification of the routine's own gates

```
$ python tests/run_all.py
run_all: tests=52 failures=0 errors=0 skipped=0
EXIT=0

$ python verify_readonly.py
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
EXIT=0
```

Both gates are **green** on this host today, including the suite's concurrency test and its "no module treats an
approved status as a trigger" static test. `[E]`

---

## 4. Artefact manifest — what a run actually creates

`freecash-proof-A` after run #1 + two duplicate runs + one refused force-recheck `[E]`:

```
    1374  ./alerts/alerts.jsonl
     212  ./logs/forced-recheck-requests.jsonl
     493  ./snapshots/2026-09-20.json
       0  ./state/day-locks/2026-09-20.lock      ← zero bytes; presence IS the day key
     341  ./state/last-run.json
    1018  ./state/operator-state.json
```

| Expected artefact | Present? | Evidence |
|---|---|---|
| `state/day-locks/2026-09-20.lock` | ✅ 0 bytes | `[E]` `stat` shows `0 bytes`; is the R2 gate |
| `snapshots/2026-09-20.json` | ✅ 493 B | `[E]` written once (`written=True`), byte-identical on re-run |
| `state/last-run.json` | ✅ 341 B | `[E]` full JSON quoted in §3.4 |
| `state/operator-state.json` | ✅ | `[E]` my seeded input; the routine also creates an empty template if absent `[S]` |
| `alerts/alerts.jsonl` | ✅ 3 lines | `[E]` `INITIAL_BASELINE` + 2 × `SKIP_DUPLICATE_DAY`, all quoted in §3 |
| `logs/forced-recheck-requests.jsonl` | ✅ 212 B | `[E]` refusal audit line |
| `approvals/pending.json` | ✅ (`freecash-proof-B`) | `[E]` 3 `PENDING` items, full JSON in §7 |
| `approvals/decided.jsonl` | ✅ 2 lines | `[E]` the synthetic decision trail, §7 |
| `state/notified-keys.json` | ✅ | `[E]` appears in root D/B after any dispatch; `FAILED_TOAST` entry observed |
| `logs/toast-stub.log` | ✅ | `[E]` the three delivery attempts from §3.5 |

Production root, for contrast — `D:\AgenticOS\data\freecash-monitor\`, **untouched by this work** `[E]`:

```
2026-09-20 21:08   alerts/alerts.jsonl
2026-09-20 21:08   snapshots/2026-09-20.json
2026-09-20 21:08   state/day-locks/2026-09-20.lock
2026-09-20 21:08   state/last-run.json
2026-09-20 21:08   state/operator-state.json
```

> **Operational note `[E]`:** the production root already contains a **2026-09-20 lock** (from a run at 21:08, before
> this session). The first *scheduled* run today would therefore print `SKIP_DUPLICATE_DAY` and read nothing. The
> production day has already been spent; the first real production reading would be tomorrow.

---

## 5. Schedule and registration

### 5.1 The exact once-per-day command line

This is the proven command (§3.1), with only the isolated-root override removed:

```bash
cd D:/AgenticOS/monitoring/freecash && \
FREECASH_TOAST_STUB=0 \
"/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" run_daily_check.py
```

Watchdog (23:50, same evening):

```bash
cd D:/AgenticOS/monitoring/freecash && \
"/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" watchdog.py
```

`FREECASH_TOAST_STUB` must be **unset or `0`** in production: with `1` the delivery label is `STUB_OK`, never
`TOAST_OK`, so a stubbed run can never be mistaken for a real delivery `[S]`.

### 5.2 Interpreter decision (do not skip this)

| Interpreter | `tzdata` | Effect | Verdict |
|---|---|---|---|
| `…\hermes-agent\venv\Scripts\python.exe` (3.11.9) | **yes** | `Europe/Berlin` resolved exactly; no degradation | ✅ **verified working end-to-end** `[E]` |
| `C:\Python314\python.exe` (`py -3`, 3.14.7) | **no** | `WARNING timezone_unavailable` + one `MONITOR_DEGRADED` info alert **per run**; day key falls back to the machine zone ($+0200$ here, which does equal the operator's wall clock today) | ⚠️ works, but noisy and does not honour the configured name `[E]` |

Either install `tzdata` into `C:\Python314` (`py -3 -m pip install tzdata`) or register the venv interpreter. The venv
interpreter is verified working today but couples a repo routine to Hermes's virtualenv; installing `tzdata` is the
cleaner long-term answer. **Do not** leave this unspecified: the `MONITOR_DEGRADED` alert on every run trains the
operator to ignore alerts.

### 5.3 Registration — primary: Hermes scheduler

The Hermes cron subsystem is installed and **live on this host** `[E]`: `hermes cron status` →

```
✓ Gateway is running — cron jobs will fire automatically
  PID: 34428
  Ticker heartbeat: 6s ago
  No active jobs
```

`hermes cron list` → `No scheduled jobs.` `[E]` — nothing is scheduled today.

**Step 1 — write the wrapper outside the repository.** Cron scripts live in the Hermes profile scripts directory
(`cron/scheduler_script.py` resolves `get_hermes_home()/scripts` and refuses paths outside it `[S]`); for the default
profile that is `C:\Users\cd-pr\AppData\Local\hermes\scripts\` (created on demand; does not exist yet `[E]`).
File `freecash_daily_monitor.sh`:

```bash
#!/bin/bash
# Free Cash daily status-monitoring routine -- exactly one check per operator-local day.
# Read-only by construction; the routine performs no earning/write action.
# Deliberately identical to the command verified on 2026-09-20 (see docs/freecash-daily-monitor-routine.md).
set -uo pipefail
cd "D:/AgenticOS/monitoring/freecash" || exit 1
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"

out="$("$PY" run_daily_check.py 2>&1)"; code=$?

# "No news" days stay silent so the once-a-day message means something.
case "$out" in
  *"outcome=OK_NO_CHANGE"*)  exit 0 ;;
  *"SKIP_DUPLICATE_DAY"*)    exit 0 ;;
esac
printf '%s\n' "$out"
exit "$code"
```

The filter changes **only what is printed** — it never re-runs, never re-reads and never weakens a rule.
Changes, alarms (`RUN_FAILED`, `MISSED_DAY`, `DELIVERY_FAILED`, `MONITOR_DEGRADED`) and the exit code all pass through.

`freecash_watchdog.sh` (same directory) is the same three lines without the filter and with `watchdog.py`.

**Step 2 — register both jobs.**

```bash
hermes cron create "35 8 * * *" --name freecash-daily-monitor \
  --no-agent --script freecash_daily_monitor.sh --deliver local

hermes cron create "50 23 * * *" --name freecash-missed-day-watchdog \
  --no-agent --script freecash_watchdog.sh --deliver local
```

Flag semantics as documented by `hermes cron create --help` `[S]`: `--no-agent` "Skip the LLM entirely — run
`--script` on schedule and deliver its stdout directly"; `.sh`/`.bash` files run via bash. **The LLM is not in the
loop**, which is exactly what R1/R2 require — a model turn can neither decide to read twice nor decide to act.
`[U]` I did **not** register these jobs (see §12); `--deliver local` as a delivery target is read from `--help`, not
observed.

**Step 3 — verify.**

```bash
hermes cron list          # both jobs present, schedule + script name
hermes cron status         # ticker heartbeat must be seconds, not hours
hermes cron doctor         # "Cron doctor found no issues"
hermes cron runs freecash-daily-monitor   # durable execution attempts after the first fire
```

### 5.4 Registration — fallback: Windows Task Scheduler (git-bash)

`schtasks` exists at `/c/WINDOWS/system32/schtasks` `[E]`; no FreeCash task is registered today
(`schtasks /Query /TN "FreeCash-Daily-Monitor"` → task not found) `[E]`.

```bash
schtasks /Create /TN "FreeCash-Daily-Monitor" /F /SC DAILY /ST 08:35 \
  /TR "\"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" \
D:\AgenticOS\monitoring\freecash\run_daily_check.py" /RL LIMITED

schtasks /Create /TN "FreeCash-Missed-Day-Watchdog" /F /SC DAILY /ST 23:50 \
  /TR "\"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" \
D:\AgenticOS\monitoring\freecash\watchdog.py" /RL LIMITED
```

Task Scheduler caveats, stated honestly:

* `run_daily_check.py` imports its siblings by bare module name, so the task's **working directory must be
  `D:\AgenticOS\monitoring\freecash`**. `schtasks /Create` has **no** CLI flag for a start-in directory `[U]` —
  it must be set in the Task Scheduler UI or by registering from XML (`/Create /XML <file>` with
  `<WorkingDirectory>` and `<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`). Use the wrapper script
  from §5.3 instead: `bash C:\…\hermes\scripts\freecash_daily_monitor.sh` is immune to the cwd problem because the
  wrapper `cd`s itself.
* `-MultipleInstances IgnoreNew` (XML/UI only) and `Do not restart on failure` are the second layer under R2 and the
  reason a slept-through slot produces one run instead of a catch-up storm. `[U]` Task Scheduler behaviour when the
  machine is asleep at 08:35 is **not verified on this host**.
* Do **not** use `config/freecash-crontab` `[E]`: it points at `scripts/make_freecash_check.py`, which the audit
  recorded exiting 1 with a `D:\data\freecash` path error, and its paths are `/path/to/AgenticOS/` placeholders.

### 5.5 Why double-running is structurally impossible

| Layer | Mechanism | Status |
|---|---|---|
| 1 | `O_CREAT\|O_EXCL` day lock — a single atomic syscall; two processes cannot both create the same path. No check-then-act window `[S]` | `[E]` 5 concurrent processes → 1 `RUN_OK`, 4 `SKIP_DUPLICATE_DAY`, 1 lock, 1 snapshot |
| 2 | The loser does **no work**: no read, no snapshot write, no ledger write, exit 0 `[S]` | `[E]` ledger + snapshot `sha256` identical across three same-day runs |
| 3 | The day key is the operator-local **calendar** day, not a rolling window — "twice today" is impossible by construction `[S]` | `[E]` `2026-09-22T23:50Z` ⇒ day key `2026-09-23` |
| 4 | `--force-recheck` (the documented human second-read path) is **refused**, exit 3 `[S]` | `[E]` exit 3 + audit line |
| 5 | Missed days are detected, never back-filled — a catch-up read would itself be a second check `[S]` | `[E]` the failed 2026-09-21 produced a lock and **no** snapshot; no catch-up run occurred |
| 6 | Windows fallback adds `MultipleInstances=IgnoreNew` | `[U]` not applied |
| 7 | Watchdog cannot become a second run: no socket, no ledger write, no lock, no snapshot, no queue touch, exit always 0 `[S]` | `[E]` `WATCHDOG_OK` on a healthy day; alarm only on an uncovered day |

Residual risks, honestly: (a) if the **machine zone changes** (travel, VM move) while `tzdata` is missing, a run could
land on a new day key — surfaced by `gate.timezone_changed()` → `MONITOR_DEGRADED` `[S]`; (b) the lock proves
*consumption*, not *completion* — a crash between lock and snapshot silently loses the day, reported only as a
`MISSED_DAY` at the next run (§8).

---

## 6. The notification path on this host — what is actually wired

| Channel | State | Evidence |
|---|---|---|
| `alerts/alerts.jsonl` | **WIRED, always on, append-only** — the canonical record | `[E]` every run appended lines; the log is never rewritten or pruned `[S]` |
| Windows toast (PowerShell `NotifyIcon` balloon) | **WIRED and executes on this host.** PowerShell 5.1.26100.9444 present; `_toast_send()` returned without exception in **6.3 s** | `[E]` — see the honest limitation below |
| Stub sender (`FREECASH_TOAST_STUB=1`) | WIRED, test/offline only. Label `STUB_OK`, **never** `TOAST_OK` | `[E]` used for the change proof (§3.5) so the demo could not be mistaken for a live desktop delivery |
| SMTP | **NOT wired.** "opt-in and OFF by default; not wired to any credential here" | `[S]` `notify.py` header |
| Email / chat / any other channel | **Not implemented.** No delivery adapter exists beyond the toast | `[S]` |

**Honest statement of the delivery claim.** What is *verified* is that the toast code path runs to completion on this
host without raising, after which `dispatch()` records the delivery label and returns. What is **not** verified is
whether a *visible* balloon actually rendered on the desktop — a zero exit code from the PowerShell script is not
proof that Windows 11 displayed it `[U]`. Consequently the operationally reliable channel today is the **append-only
log**; the toast is best-effort. Treat a `TOAST_OK` label as "the sender was invoked successfully", not as "a human
saw it". If guaranteed human notification is a requirement, wire a real channel (Hermes cron delivery, email) —
see §9 option 4.

### 6.1 What a change alert looks like (verbatim, from §3.5)

```
[FreeCash] EARNINGS CHANGE 2026-09-20
Earnings:  $10.25 -> $13.40  (+$3.15)
Balance:   $13.40 (changed too)
Pending:   $2.50
Status:    PAUSED (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-20)
Detail:    alerts.jsonl dedupe=0ac2c9cf5a4df1cf
ACTION:    No action taken. Review and approve anything you want done.
Approval:  cc1002a3-b86f-4f18-bf9a-25a7247c9b13 (PENDING - yours to decide, nothing executes)
```

Status change variant:

```
[FreeCash] STATUS CHANGE 2026-09-20
Account status: ACTIVE -> PAUSED
Earnings:  $13.40 (unchanged)  Balance: $13.40 (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-20)
Detail:    alerts.jsonl dedupe=d117af43d2d98224
ACTION:    No action taken. Review and approve anything you want done.
Approval:  ef040dc7-6fe4-4dd9-917c-245fd0bcd2d6 (PENDING - yours to decide, nothing executes)
```

`Source: DEGRADED` is not decoration and must never be dropped: every snapshot carries `"degraded": true` and a
`source.kind`, so a "no change" report can **never** be mistaken for a *provider-verified* no-change. Today the only
sources are the operator-entered file and the local metrics substitute; no provider read path exists (§9 option 3).
`ACTION: No action taken.` is present on every dispatched message — it *is* the R4 statement.

---

## 7. Approval-queue contract

| | |
|---|---|
| **Queue path** | `<data root>/approvals/pending.json` (atomic write: unique temp file + `os.replace`) `[S]` |
| **Decision trail** | `<data root>/approvals/decided.jsonl` (append-only, one line per human decision) `[S]` |
| **Producer** | `run_daily_check.py` → `approval_queue.enqueue()` — the **sole** call site, reached only on a real change `[S]` `[E]` |
| **Consumer** | **A human, via the CLI.** `approval_queue.py list` (read-only) and `approval_queue.py decide --id … --decision approve\|reject --by "<name>" --note "<why>"`. Nothing else in the routine reads a status to act on it `[S]` `[E]` |
| **States** | `PENDING` → `APPROVED` \| `REJECTED`. Nothing else can be written; `decide()` re-asserts the frozen fields **after** recording `[S]` `[E]` |
| **Auto-execution** | **None, by construction.** No execution code path exists; `execution_state` is only ever `NOT_EXECUTED`; `execution_allowed_by_this_routine` is only ever `false` `[S]` `[E]` |
| **Expiry behaviour** | **There is no expiry.** `expires_at_utc` is always `null` (constant `NO_EXPIRY`). Nothing may convert a pending item into action on age grounds. A pending item waits indefinitely `[S]` `[E]` |
| **Escalation** | A *nag*, not a decision: at most one reminder per item per 7 days `[S]` |
| **Machine identities refused** | `system, routine, automation, agent, cron, scheduler, monitor, bot, script, machine` → exit 4 `[E]` |
| **Decision CLI exit codes** | `0` recorded · `2` missing/blank note or bad decision · `3` unknown id · `4` non-human identity `[E]` |

JSON shape of one item (`approvals/pending.json`, quoted verbatim from `freecash-proof-B`; the `reason` and values are
synthetic example content — `pending.json` is written by the routine, never by this document):

```json
{
  "approval_id": "cc1002a3-b86f-4f18-bf9a-25a7247c9b13",
  "created_at_utc": "2026-09-20T19:47:03Z",
  "day_key": "2026-09-20",
  "change_dedupe_key": "0ac2c9cf5a4df1cf639d7e9d16eba0ca63f4adff0cafddfb0155fae04c065a7c",
  "reason": "earnings_total_cents moved from $10.25 to $13.40. Review and decide whether any action is wanted.",
  "proposed_action": {
    "action_type": "REQUEST_PAYOUT",
    "amount_cents": 1340,
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
```

Written and read back — the CLI:

```
$ approval_queue.py list
ef040dc7-6fe4-4dd9-917c-245fd0bcd2d6  PENDING  2026-09-20  expires_at_utc=None  execution_state=NOT_EXECUTED
cc1002a3-b86f-4f18-bf9a-25a7247c9b13  PENDING  2026-09-20  expires_at_utc=None  execution_state=NOT_EXECUTED
999ab081-b75d-4859-b2f6-2aa16e4c6b5d  PENDING  2026-09-20  expires_at_utc=None  execution_state=NOT_EXECUTED
$ echo $?
0
```

Machine signatures refused:

```
$ approval_queue.py decide --id ef040dc7-… --decision approve --by "cron" --note "auto"
REFUSED: refused: 'cron' is not a human identity; this routine may only record a decision made by a person
EXIT=4
$ approval_queue.py decide --id ef040dc7-… --decision approve --by "agent" --note "x"
REFUSED: refused: 'agent' is not a human identity; …                                                       EXIT=4
$ approval_queue.py decide --id ef040dc7-… --decision approve --by "Some Person" --note ""
REFUSED: --note is required: record why the decision was made                                          EXIT=2
$ approval_queue.py decide --id 00000000-… --decision approve --by "Some Person" --note "x"
no such approval_id: 00000000-0000-0000-0000-000000000000                                             EXIT=3
```

**Synthetic decisions, clearly labelled.** To prove that recording a decision cannot arm an item, two **synthetic,
inert** decisions were recorded in the isolated root only, by the identity
`EXAMPLE OPERATOR (synthetic proof run)`:

```
recorded APPROVED for ef040dc7-6fe4-4dd9-917c-245fd0bcd2d6 by EXAMPLE OPERATOR (synthetic proof run) at 2026-09-20T19:47:17Z
execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)
recorded REJECTED for cc1002a3-… by EXAMPLE OPERATOR (synthetic proof run) at 2026-09-20T19:47:17Z
execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)
```

Read-back after those decisions:

```
ef040dc7-6fe4-4dd9-917c-245fd0bcd2d6 status=APPROVED expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed_by_this_routine=False
cc1002a3-b86f-4f18-bf9a-25a7247c9b13 status=REJECTED expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed_by_this_routine=False
999ab081-b75d-4859-b2f6-2aa16e4c6b5d status=PENDING  expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed_by_this_routine=False
```

An `APPROVED` row is still `NOT_EXECUTED` with `execution_allowed_by_this_routine=false`, and the decision trail
`decided.jsonl` carries the same three frozen fields. **No external action resulted, no real approval exists, and no
money moved.** These were synthetic demonstration decisions in a throwaway data root, and this document is not an
approval of anything.

> **Wart, verified by execution `[E]`:** for a `STATUS_CHANGED` item, `proposed_action.amount_cents` copies the
> non-monetary change value — the live JSON reads `"amount_cents": "PAUSED"` with `"action_type": "REQUEST_PAYOUT"`.
> Cosmetic but misleading; a human could read it as an amount. Worth fixing (see §9 option 3) or at minimum flagging
> in the operator's reading instructions.

---

## 8. Failure-mode table

| What breaks | Observable symptom | Detected by | Rule at risk | Evidence |
|---|---|---|---|---|
| Same day, second run (manual + scheduled, two schedulers, double-click) | `SKIP_DUPLICATE_DAY <day>`, exit 0, **no** read/snapshot/ledger write | stdout + one alert line | R2 holds | `[E]` §3.2, §3.6 |
| `--force-recheck` attempted | `REFUSED_FORCE_RECHECK … forbidden by R1`, exit 3, audited in `logs/forced-recheck-requests.jsonl` | exit code 3 | R2 holds | `[E]` §3.3 |
| A second read is attempted under concurrency | 4 of 5 processes print `SKIP_DUPLICATE_DAY`; 1 lock, 1 snapshot | lock count | R2 holds | `[E]` §3.6 |
| Operator does not append today's figures to `state/operator-state.json` | `RUN_OK … outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)`, snapshot written with **null** fields, nothing compared, nothing notified | `MONITOR_DEGRADED` info line | R3 blind (by design — no invented values, no fake alarm) | `[E]` §3.8 second run; `[S]` `operator_state.read_source` |
| Status read fails (HTTP refused / non-200 / unparsable JSON / missing field) | `RUN_FAILED <day> reason=ReadError: …`, exit **5**; **day lock stays consumed**; **no snapshot**; no automatic re-run; the next day reports it | exit 5 + `RUN_FAILED` alert (severity `alert`) | R2 holds deliberately | `[E]` §3.8 |
| Process dies between the lock and the snapshot | Day consumed, no snapshot. **Silent lost day.** Next run may not even name it: `gate.missed_days()` needs a prior `last_success_day` to compute a range, so with no prior success the in-band detector returns nothing | the **watchdog** (a failed day is not in `SUCCESS_OUTCOMES` ⇒ `covered=False` ⇒ `WATCHDOG_MISSED_DAY`, severity `alert`) | R2 (coverage, not the gate) | `[E]` failed day left a lock + no snapshot and produced **no** in-band `MISSED_DAY`; `[E]` watchdog fires when today has no successful attempt; `[S]` `covered` expression |
| Notification channel fails | 2 attempts, then `DELIVERY_FAILED` with the **full message**, then `MONITOR_DEGRADED`; key marked `FAILED_TOAST`, never retried; **exit 0** | `alerts.jsonl` only — the operator must read the log | R3 degrades to log-only | `[E]` §3.8 |
| Whole day missed (machine off, scheduler dead) | `WATCHDOG_MISSED_DAY <day> … coverage=NOTIFIED`, severity `alert`, one per day (`DEDUPED` after that) | watchdog + `consecutive_missed_days` | R2 coverage visible | `[E]` §3.8 |
| `tzdata` missing for the registered interpreter | `WARNING timezone_unavailable configured=Europe/Berlin offset=+0200` on **every** run + one `MONITOR_DEGRADED` info alert per run; day key = machine zone | stdout + alert log | alert fatigue → real alerts get ignored | `[E]` §3.9 |
| Alert-log writes under concurrent writers | `alerts.jsonl` **silently loses lines**: 20 concurrent writers × 5 appends ⇒ **97 of 100** lines on disk, none malformed, every child exit 0; sequential control 100/100; the 5-process routine race lost 1 of 5 lines in 1 of 3 trials | only by counting lines against expected | **audit completeness** — the record the R1–R4 evidence rests on is not provably complete under concurrency. Root cause `[U]` unknown | `[E]` §11, §3.6 |
| Currency of the reading changes between days | `compare()` skips money fields and emits `MONITOR_DEGRADED` instead of a nonsense delta | alert | R3 (deliberate) | `[S]` |
| Corrupt / missing `state/last-run.json` | Ledger is **never the gate**: a corrupt ledger cannot cause a second read in one day; `read_json` returns the default instead of raising | — | R2 holds | `[S]` |
| Baseline/no-data day | `INITIAL_BASELINE` / `MONITOR_DEGRADED`, `notifications=0` — log-only | stdout | R3 cannot produce a fake alarm | `[E]` §3.1 |
| >5 distinct changes in one day | individual notifications suppressed, **one** summary notification; one alert line per change | stdout `changes=N notifications=1` | R3 bounded | `[S]` |
| Success metrics of an approved item | nothing happens, ever | — | R4 holds | `[E]` §7 |

---

## 9. Options

All four share the same base state (the routine is repaired, gated green, and proven read-only). They differ in what
they buy. **"Time-to-Revenue" is stated honestly: this routine produces no revenue itself.** It is a *decision-latency
and loss-prevention* instrument — it tells the operator what moved, so a payout/continue/stop decision is made on
evidence instead of memory. The revenue-bearing paths are the human decisions downstream.

### Option 1 — Run exactly what is proven today

| | |
|---|---|
| **What** | Register the two Hermes cron jobs (§5.3) against the canonical implementation, operator-entered source, no code change. |
| **Expected Effort** | ~30 minutes: two wrapper scripts, two `hermes cron create` calls, verification. |
| **Time-to-Revenue** | None direct. First decision-grade reading at 08:35 local tomorrow; today's production day is already consumed (`[E]` §4). |
| **Dependencies** | Hermes gateway running with a live ticker (`[E]` PID 34428, heartbeat 6 s) · the operator appending four figures daily · an interpreter decision (§5.2). |
| **First Concrete Action** | `mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"` and write `freecash_daily_monitor.sh` from §5.3, then `hermes cron create "35 8 * * *" --name freecash-daily-monitor --no-agent --script freecash_daily_monitor.sh --deliver local`. |

### Option 2 — Harden the run wrapper and the interpreter policy

| | |
|---|---|
| **What** | Absolute tzdata-capable interpreter; the "no news = silence" stdout filter; a dedicated run log with the exit code recorded; watchdog job; a documented recovery runbook for `RUN_FAILED`/exit 5 (the day is spent — the operator re-enters tomorrow, never re-runs). |
| **Expected Effort** | 1–2 hours. |
| **Time-to-Revenue** | Same as option 1, but the daily message *means* something: no alert on healthy days, so a change alert is not lost in noise. |
| **Dependencies** | Option 1. Decide: install `tzdata` for `C:\Python314`, or pin the venv interpreter. |
| **First Concrete Action** | `py -3 -m pip install tzdata` (or pin the venv interpreter), then re-run §3.1 in a fresh isolated root and confirm the `WARNING timezone_unavailable` line is gone. |

### Option 3 — Repair the two verified warts (alert-log atomicity, status-item amount field)

| | |
|---|---|
| **What** | (a) Make `paths.append_jsonl` concurrency-safe so `alerts.jsonl` cannot silently lose lines; (b) stop `proposed_action.amount_cents` from copying a non-monetary value on `STATUS_CHANGED`. Both come with a red-first regression test (20 concurrent writers × 5 appends ⇒ exactly 100 parseable lines; a status item whose `amount_cents` is not a string status). |
| **Expected Effort** | 2–4 hours including tests. **Requires a code change to `monitoring/freecash/`** — outside this document-only task; proposed, not performed. |
| **Time-to-Revenue** | None direct. It protects the evidence trail every R1–R4 claim rests on: an audit record that silently drops lines is exactly how a "4/4 passed" verifier happened in this repo before. |
| **Dependencies** | Option 1 (a scheduled writer makes the race real) · a mutation/negative-control harness so the fix cannot be a no-op. |
| **First Concrete Action** | Add the red test (5 processes × 20 appends ⇒ assert exactly 100 lines) and watch it fail; then fix the append, and keep the test as the negative control. |

### Option 4 — Resolve a real read-only provider contract (un-degrade the snapshots)

| | |
|---|---|
| **What** | Replace/augment the operator-entered source with a documented provider read (e.g. HG.Cash `GET /api/v1/accounts` and `GET /api/v1/account/{id}/balance`) added to `ALLOWED_PATHS` **one line at a time with a justification comment**, credential held outside the repo (Hermes `.env`/keyring only). Until then every snapshot stays `degraded: true`. |
| **Expected Effort** | Days to weeks, gated on the operator's account and a token (HG.Cash onboarding is KYC-gated). |
| **Time-to-Revenue** | Highest ceiling: automatic, provider-verified balance/pending/status with no daily typing — which is what makes the change signal trustworthy rather than self-reported. Blocked on U1 (which provider the entity actually holds). |
| **Dependencies** | Operator confirms the account and mints a token out-of-band (never in the repo) · provider paths allowlisted with justification · research doc `docs/freecash-monitor-research-plan.md` U1–U5 answered · a decision on whether automated access is permitted by the platform's terms (freecash.com's own terms prohibit automated access *including monitoring*). |
| **First Concrete Action** | Ask the operator the single load-bearing question — *which dashboard actually holds the money* — and have them mint one read-only token out-of-band; then run the documented `GET` **once, by hand, not from the monitor**, to see real `status` strings before any allowlist entry is written. |

**Recommended sequencing:** Option 1 → Option 2 → Option 3 → Option 4. Options 1–3 are a day's work and make the
routine trustworthy; Option 4 is the only path that removes `degraded: true`, and it is blocked on a human answer,
not on engineering.

---

## 10. Not verified / unknown

| # | Item | Why it matters | Status |
|---|---|---|---|
| U1 | **Whether the entity holds any provider account at all, and with whom** (freecash.com / HG.Cash / Cashfree). | Decides whether option 4 exists. Until answered, every reading is a substitute and every snapshot is `degraded: true`. | `[U]` prior research reached the same conclusion; this work did not call any provider |
| U2 | `metrics_http` read source against a **live** AgenticOS metrics endpoint. I exercised only its failure path (exit 5). | The second read source is unproven end-to-end; whether `GET /api/v1/status/metrics` returns the four fields on this host is unknown. | `[U]` |
| U3 | Whether the Windows toast **visibly rendered**. The sender ran to completion in 6.3 s with no exception; PowerShell returncode 0. | §6 claims "wired and executes", not "shown to a human". | `[U]` |
| U4 | Root cause of the alert-log append loss under concurrent writers. The symptom is reproduced and quantified (97/100); the mechanism is not proven. | Determines the fix (file locking, per-process log, or a lock-protected appender). | `[U]` mechanism; symptom `[E]` |
| U5 | Windows Task Scheduler behaviour on this host: sleeping machine at the scheduled time, `StartWhenAvailable`, `MultipleInstances=IgnoreNew` effect, per-task working directory via `schtasks`. | The fallback schedule's correctness under real conditions. | `[U]` nothing registered; §5.4 caveats stated |
| U6 | Hermes cron **delivery** semantics: what `--deliver local` does in practice for a `--no-agent` script job; where stdout lands; whether an empty stdout is silent as documented. | Option 1's notification path. | `[U]` read from `hermes cron create --help` only; **no job was registered by this work** |
| U7 | `changedetect` paths not executed: currency-change degradation, the **>5 changes coalesce** rule, `prune_old_artifacts` retention, the 7-day nag reminder, `nag_pending` in a real run. | Edge behaviour on unusual days. | `[S]` only |
| U8 | The 52-test suite's individual assertions. I ran the suite (52/52, exit 0) but did not trace each test. | A green suite is a gate, not a proof of each behaviour. | `[E]` aggregate only |
| U9 | The routine has **never run against a real account figure** and has **never fired on a schedule**. All evidence here is from isolated roots with synthetic example values. | The production path is unproven in situ. | `[E]` (roots under `%LOCALAPPDATA%\Temp`; `hermes cron list` → no jobs) |
| U10 | `readonly_client`'s audit hook behaviour against a *real* non-loopback connect (I exercised the allowlist refusals, not a live socket attempt to a provider). | Defence-in-depth layer B. | `[S]` + the suite's audit-guard test `[E]` |
| U11 | Whether any other FreeCash artifact in the repo could read twice on the same day (the parallel implementations listed in `docs/freecash-monitor-workflow-plan.md` §9). | Two monitors on one host = two day locks = an R2 violation waiting to happen. | `[U]` this work scheduled nothing and changed nothing, so the risk is latent, not active |

**Also not done:** no provider API was called; no credential was collected or used; no earning, cashout, claim,
redeem, transfer or offer action was performed or attempted; no file in the repository was created, modified, moved
or deleted other than this document; no git commit/checkout/reset/stash was run. `[E]` (§12)

---

## 11. Re-verification: state of the routine since the 2026-09-19 audit

Everything below was **re-run on 2026-09-20** rather than carried over from the audit document. The audit's
conclusion — "canonical candidate, but RED" — no longer holds for the gates it measured.

| Audit finding (2026-09-19) | Status on 2026-09-20 | Evidence |
|---|---|---|
| Own test suite red: `tests=52 failures=6 errors=11` (or `failures=7` in a later plan), exit 1 | **GREEN**: `tests=52 failures=0 errors=0 skipped=0`, exit 0 | `[E]` §3.10 |
| Own R2 static gate red: `forbidden=2 exempt=27`, exit 1 | **GREEN**: `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit 0 | `[E]` §3.10 |
| Defect D1 — `approval_queue.py` referenced an undefined constant ⇒ `NameError` on every real change | **FIXED**: the constant is `ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"` with a `readonly-exempt` marker; the change path now enqueues 3 items without error | `[E]` §3.5, §7 |
| Defect D2 — `last_attempt_day` was `null` after every run, so the ledger lost the watchdog's coverage signal | **FIXED**: ledger reads `last_attempt_day: 2026-09-20`; the fix is visible in the call site (`ledger = gate.record_attempt(...)`) | `[E]` §3.4 |
| Defect D3 — consequent false `MISSED_DAY` alarm on a healthy day | **FIXED**: `WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=INITIAL_BASELINE` | `[E]` §3.4 |
| Defect D4 — `tzdata` missing ⇒ `Europe/Berlin` unresolvable, silent fallback to the machine zone | **PARTIALLY FIXED**: resolvable under the venv `python` (3.11.9) — no warning, configured zone honoured. Still **missing** under `py -3` (3.14.7), where the loud degraded path still fires on every run | `[E]` §3.9 |
| Defect D5 — the static gate failed on the routine's own tree (same root cause as D1) | **FIXED**: `forbidden=0` | `[E]` §3.10 |
| Defect D6 — `notify_change()` hard-coded `SEVERITY_NOTIFY`, downgrading alarms | **FIXED**: the call now uses `default_severity(change["change_type"])` (with an explanatory comment) | `[S]` `notify.py:282–293`; `[E]` `MISSED_DAY` now carries `severity=alert` |
| "E is the only implementation observed to enforce a real one-read-per-day day lock" | **CONFIRMED and strengthened**: 5 concurrent processes → 1 read, 1 lock, 1 snapshot | `[E]` §3.6 |
| (Not claimed by the audit, found here) `alerts.jsonl` loses lines under concurrent writers | **NEW FINDING**: 97/100 lines survive 20 concurrent writers; sequential control 100/100; a 5-process routine race lost 1 of 5 lines in one of three trials | `[E]` §3.6, §8 |
| (Not claimed by the audit, found here) `amount_cents` copies a status string on `STATUS_CHANGED` | **NEW FINDING**: `"amount_cents": "PAUSED"` | `[E]` §7 |

---

## 12. What this work did not do

* **Did not modify, move or delete any existing repository file.** The only write to `D:\AgenticOS` is this document.
* **Did not create a new monitor implementation** and did not touch `monitoring/freecash/` — its module mtimes are
  unchanged (2026-09-18 / 2026-09-20 06:57–06:59) `[E]`.
* **Did not schedule anything.** `hermes cron list` → `No scheduled jobs.`; no Windows task registered. The
  registration commands in §5 are documented, not executed — scheduling is an external action.
* **Did not write to the production data root.** `D:\AgenticOS\data\freecash-monitor\` still carries its
  21:08 timestamps; no file under it is newer than this session began `[E]`. All proof runs used
  `FREECASH_DATA_ROOT` pointed at `%LOCALAPPDATA%\Temp\freecash-proof-{A,B,C,D,E}` and `fc-conc-t1..t3`,
  `fc-append{2,3}`.
* **Did not commit, checkout, reset or stash.** `git status --short` was captured before the first command and after
  the last; the delta is reported in the session summary.
* **Did not call any provider API**, hold any credential, or perform any earning, cashout, claim, redeem, transfer or
  offer action. The only network-attempting code exercised was the allowlist refusal path, which refuses *before* the
  socket site `[E]` §3.7.
* **Did not register the routine's day as "checked" in production.** Every day-lock written by this work is in a
  throwaway root.
* The one desktop side effect: the toast channel test in §6 invoked the Windows notification sender once with a
  clearly-labelled test string. Nothing else was displayed, and no account data was involved.

---

### Appendix — file-by-file reference

| File | Role in the enforcement chain |
|---|---|
| `run_daily_check.py` (476 L) | the single entry point; sequences the gate → read → compare → notify → enqueue order |
| `gate.py` (235 L) | R2 gate: `O_CREAT\|O_EXCL` day lock, day key, ledger, missed-day arithmetic, timezone resolution |
| `readonly_client.py` (239 L) | R1 transport: method/path/host allowlists, body rejection, the single socket site, process-wide audit hook |
| `operator_state.py` (151 L) | read source B: the operator's own daily figures; opens no socket, holds no credential |
| `changedetect.py` (333 L) | R3: four-field exact comparison, prior-before-write order, immutable snapshots, dedupe key, retention |
| `notify.py` (424 L) | R3 delivery: append-only alert log, Windows toast, stub sender, bounded retries, message templates |
| `approval_queue.py` (301 L) | R4: enqueue-only, frozen `expires_at_utc`/`execution_state`, human-only `decide` CLI, JSONL decision trail |
| `watchdog.py` (112 L) | R2 coverage detector: same-evening "did the check run?"; cannot become a second run |
| `verify_readonly.py` (204 L) | R1 static CI gate: six forbidden token classes, exemption marker, exit 0/1/2 |
| `paths.py` (218 L) | state layout, atomic JSON writes, append-only JSONL, clock seam |
| `tests/` (52 tests, 5 rule files + `run_all.py` + `_support.py`) | offline rule gate — **52/52 green** on this host |

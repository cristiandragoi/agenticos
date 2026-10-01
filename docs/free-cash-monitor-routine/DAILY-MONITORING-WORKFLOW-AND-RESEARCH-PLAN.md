# DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md — Free Cash Finance Automation daily status routine

**Repository:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11, git-bash, non-elevated, node v24.20.0, Python launcher `py -3` = 3.14.7, `python` (PATH) = 3.11.9 (Hermes venv)
**Written:** 2026-09-19, by a delegated subagent, against **executed** evidence only.
**Deliverable of this task:** this one new file. No other file was created, modified, deleted or committed; every command below is read-only or ran against a throwaway copy under `%LOCALAPPDATA%\Temp`.
**Companions (pre-existing, read, unmodified):** `ROUTINE-DESIGN.md`, `RULE-GATE-CHECKLIST.md`, `verify-readonly.sh`, `DELEGATED-WORKFLOW-PLAN.md`, `DELEGATION-WORKFLOW-PLAN.md`, `DELEGATION-RESEARCH-PLAN.md`, `delegation-manifest.json`, `IMPLEMENTATION-PLAN-V3.md`, `AUDIT-RULE-COMPLIANCE.md`, `PROVIDER-API-RESEARCH.md`, `PROVIDER-CONTRACT-RESEARCH-V2.md`, `PROVIDER-FINDINGS-REVERIFIED.md`.
**Acceptance gate for everything in this document:** `D:/AgenticOS/scripts/monitoring/rule_gate_verify.py` (exists, 47 141 B, pre-existing). This plan does **not** propose a sibling verifier — it extends that one (§11.4), because five concrete check gaps are demonstrated in §11.3.

---

## 0. Status in one paragraph

The four operating rules are enforced **by code, not by convention**: an atomic exclusive-create day lock (`gate.py::acquire_day_lock`), a deny-by-default read transport (`readonly_client.py::request`), an exact integer-cent snapshot diff with a pre-dispatch dedupe key (`changedetect.py`), and an approval queue whose `execution_state` is frozen at `NOT_EXECUTED` with `expires_at_utc` always `null` (`approval_queue.py`). **Today that code does not yet pass its own gates:** the acceptance gate returns `EXIT=1` for every candidate including the canonical entry point, and the routine's own suite reports `tests=52 failures=7 errors=11` (§1.2). Every run also reports `WARNING timezone_unavailable` because the configured interpreter cannot resolve `Europe/Berlin` (§1.3). Nothing here is deployed: no scheduled task exists yet (`schtasks` query, §12.3).

---

## 1. What is verified today, and what is not

### 1.1 Verified in this pass (commands actually run, output observed)

| # | Command | Observed | Meaning |
|---|---|---|---|
| V1 | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at line 41, exit 1 | The legacy `.mjs` still cannot parse (TS annotation in a `.mjs`). Never deploy, never cite as compliant. |
| V2 | `py -3 scripts/monitoring/rule_gate_verify.py server/scripts/freecash-daily-monitor.mjs` | `parse: FAILED`; `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`; `EXIT=1` | Confirms the task brief exactly. |
| V3 | `py -3 …/rule_gate_verify.py scripts/monitoring/free-cash-daily-check.py` | `parse: OK`; `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`; exit 1 | Confirms the brief. |
| V4 | `py -3 …/rule_gate_verify.py scripts/make_freecash_check.py` | `parse: OK`; `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL`; exit 1 | Confirms the brief. |
| V5 | `py -3 …/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`; exit 1 | R1 fails **because the gate verifier is single-file scoped** — the atomic lock and the calendar-day key live in `gate.py`. See gap D3 (§11.3). |
| V6 | `py -3 …/rule_gate_verify.py monitoring/freecash/gate.py` | 4× FAIL, incl. `FAIL no rolling 24h window used as the daily gate [line 220]` with evidence `line 220: cursor = last + timedelta(days=1)` | **False positive**: that line is missed-day arithmetic, not the daily gate. Gap D3b. |
| V7 | `py -3 …/rule_gate_verify.py monitoring/freecash/run_daily_check.py --run` | `run#1 exit=1 created=NO ARTIFACT CREATED`; `concurrency: 5 simultaneous copies in 0.09s -> 5 did NOT report skip/duplicate` | The runtime probe copies **one file**, so sibling imports fail and the probe can never exercise a multi-module routine. Gap D4. |
| V8 | `py -3 monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=7 errors=11 skipped=0`, exit 1 | The offline suite is **red**. 11 of the 18 red tests share one root cause: `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined` (`approval_queue.py:111` uses a constant that is defined at `:52` as `ACTION_LABEL_FOR_HUMAN_REVIEW`). Any detected change that must be enqueued raises. |
| V9 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=2 exempt=27 missing_targets=0`, exit 1 | Two unexempted R2 hits exist in the routine tree today: `approval_queue.py:111` (`earning-action` class) and `tests/test_r4_approval.py:283` (`write-call-shape` class, inside an `assertNotIn("http.client", …)`). The suite names this too (`test_shipped_shell_checker_passes_on_the_routine_tree` FAIL). |
| V10 | `py -3 -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Berlin')"` vs `python -c …` | `py -3` → `ZoneInfoNotFoundError: No time zone found with key Europe/Berlin`; `python` (3.11.9 venv) → OK | Only the venv interpreter can compute the operator-local day key right now. Confirms `IMPLEMENTATION-PLAN-V3.md` §1(f) still true on 2026-09-19. |
| V11 | `schtasks /Query /FO LIST \| grep -iE "freecash\|daily-monitor\|missed-day"` | no match | No task is registered; the routine is not scheduled. |
| V12 | Mutation probes M1–M5 (§11.2), run against **temp copies** of `monitoring/freecash/*.py` | `EXIT=1` and the targeted rule flipping to FAIL in every case; one injection (M5) was **not** detected | The gate does fail on planted violations — and has one demonstrated false-negative class. |

### 1.2 What the prior documents claim and this pass did not reproduce

Marked explicitly; a claim is listed here unless it was re-executed in §1.1.

| Prior claim (source) | Status | Note |
|---|---|---|
| `ROUTINE-DESIGN.md` §8 test matrix T1.1–T5.2 "18 tests, 16 offline" | **UNPROVEN** | No test output for that matrix exists. The shipped suite is 52 `unittest` cases and is currently red (V8). |
| `RULE-GATE-CHECKLIST.md` step 5: `py -3 -m pytest … → 16 passed` | **FALSE as written** | `pytest` is absent on this host (`IMPLEMENTATION-PLAN-V3.md` §5.3, re-confirmed by the suite being a stdlib `unittest` runner). "16 passed" was never observed. |
| `RULE-GATE-CHECKLIST.md` step 3: `verify-readonly.sh monitoring/freecash` → exit 0 | **FALSE today** | exit **1**, `forbidden=2` (V9). |
| `ROUTINE-DESIGN.md` §5.1 toast channel works | **UNPROVEN (physical)** | Assembly load/object construction were verified earlier; that a balloon *appears* is a physical user-observed claim. Nobody has reported seeing one. |
| `ROUTINE-DESIGN.md` §7.1 "run whether logged on = Yes" **and** `… /IT` in the same section | **SELF-CONTRADICTORY** | `/IT` = interactive token = only while logged on. Flagged in `IMPLEMENTATION-PLAN-V3.md` §1(d); unresolved. §12.2 decides it. |
| `StartWhenAvailable` will catch up a plain daily trigger | **UNPROVEN** | Microsoft documents the property as applying to time-based tasks "with an end boundary or … repeat infinitely"; a plain daily trigger has neither. Treat catch-up as unproven and rely on the watchdog. |
| `schtasks /Create … /RL HIGHEST` on this non-elevated shell | **UNPROVEN / BLOCKED** | Never attempted (hard constraint). §12.2 uses a non-elevated-compatible form instead. |
| Provider read contract (W3/W4) | **BLOCKED / UNKNOWN** | `PROVIDER-FINDINGS-REVERIFIED.md`: freecash.com ToS forbids automated access "for any purpose, including monitoring"; `https://api.freecash.com/v1/status` → 404; HG.Cash is the only documented read-only API but account ownership is operator-held and unknown. Every snapshot is therefore `degraded: true` and **a "no change" report currently proves nothing about the real account**. |
| `daily-status-monitoring-specification.md`, `DAILY_MONITORING_DESIGN_SUMMARY.md`, `docs/freecash-monitoring.md` | **NOT EVIDENCE** | These propose execution paths this routine forbids: `docs/freecash-monitoring.md` step 06 POSTs `/withdraw` and `/survey/complete<id>`; the specification's `vault_loader.py` sample calls `Get-Credential`/`Get-WinEvent` to "retrieve" secrets (it retrieves nothing) and its Task Scheduler XML does not parse as XML (the fence and the first line are concatenated); `DAILY_MONITORING_DESIGN_SUMMARY.md` claims "Status: Complete" with no executed check and its ASCII block is corrupted by literal `\n`. Keep as intent, quote nothing from them as fact. |
| `server/data/freecash-monitor/INTEGRATION_STATUS.md`: "FreeCash.io Platform APIs … X-API-Key" | **VERIFIED ERROR** | `PROVIDER-CONTRACT-RESEARCH-V2.md` #19/#33: freecash.io is a parked GoDaddy lander. |

### 1.3 Environment facts that change the design (all re-verified today)

1. **Interpreter pinning is mandatory.** `py -3` = 3.14.7 → `ZoneInfoNotFoundError` for `Europe/Berlin`. The routine degrades to the machine's own local zone and emits `WARNING timezone_unavailable configured=Europe/Berlin offset=+0200` + `MONITOR_DEGRADED` on **every** run (observed in V8's output). Pin the action to `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (3.11.9, tzdata 2025.3) or install `tzdata` for the launcher — until then the day key is the system zone, which happens to equal `Europe/Berlin` here but is not the configured name.
2. **No scheduler entry exists** (V11), and `crontab` is absent in git-bash; Hermes cron exists but cannot wake a sleeping machine. Windows Task Scheduler is the recommended mechanism (§12).
3. **State root mismatch:** `monitoring/freecash/paths.py:35` defaults to `D:/AgenticOS/data/freecash-monitor`. This plan pins the canonical root to **`D:/AgenticOS/data/freecash/`** via `FREECASH_DATA_ROOT` (the module honours it, `paths.py:47`). No file is changed in this pass; aligning the default is required work (§14, item 6).

---

## 2. State layout (`D:/AgenticOS/data/freecash/`)

```
D:/AgenticOS/data/freecash/
├── state/
│   ├── last-run.json                 # ledger: audit + missed-day math ONLY, never the gate
│   ├── day-locks/<YYYY-MM-DD>.lock   # zero-byte, O_CREAT|O_EXCL — THE success artifact
│   ├── notified-keys.json            # dedupe index: one change → one notification
│   └── operator-state.json           # operator-entered daily figures (read source A)
├── snapshots/<YYYY-MM-DD>.json       # one immutable snapshot per successful day (90-day retention)
├── daily/<YYYY-MM-DD>.jsonl          # the daily log (§5) — one line per run, zero-change days included
├── approvals/
│   ├── pending.json                  # approval-request queue (§8)
│   └── decided.jsonl                 # append-only human decision trail
├── alerts/alerts.jsonl               # APPEND-ONLY, canonical evidence record
└── logs/
    ├── run-<YYYY-MM-DD>.log          # raw stdout/stderr of the scheduled action
    └── forced-recheck-requests.jsonl # audited refusals (§10.4)
```

`state/last-run.json` (exact keys, `gate.new_ledger()`):

```json
{"schema_version":1,"last_attempt_day":"2026-09-19","last_success_day":"2026-09-18",
 "last_attempt_at_utc":"2026-09-19T06:35:04Z","last_success_at_utc":"2026-09-18T06:35:11Z",
 "last_outcome":"OK_NO_CHANGE","consecutive_missed_days":0,
 "timezone":"Europe/Berlin","updated_at_utc":"2026-09-19T06:35:11Z"}
```

`state/day-locks/<YYYY-MM-DD>.lock` — **zero bytes**; the filename *is* the day key; presence means "today was consumed". `state/notified-keys.json` = `{"schema_version":1,"keys":{"<sha256>":{"first_notified_at_utc":"…","delivery":"TOAST_OK|STUB_OK|QUEUED|FAILED_TOAST"}}}`.

`alerts/alerts.jsonl` line schema (`notify.alert()`): `event_id` (uuid4), `ts_utc` (ISO-8601 Z), `day_key`, `event_type` ∈ {`OK_NO_CHANGE`, `INITIAL_BASELINE`, `EARNINGS_CHANGED`, `STATUS_CHANGED`, `BALANCE_CHANGED`, `SKIP_DUPLICATE_DAY`, `READ_FAILED`, `RUN_FAILED`, `MISSED_DAY`, `DELIVERY_FAILED`, `APPROVAL_PENDING`, `MONITOR_DEGRADED`}, `dedupe_key` (nullable), `severity` ∈ {`info`,`notify`,`alert`}, `message` (≤500 chars), `observed` (object; compared values only, never secrets).

---

## 3. Rule 1 — one status read per operator-local calendar day

**Mechanism (the only gate):** `gate.acquire_day_lock(day)` → `os.open(state/day-locks/<day>.lock, O_CREAT|O_EXCL|O_WRONLY)`. One atomic syscall on NTFS (`D:` is local fixed NTFS; a 5-process race on this volume previously produced 1 winner / 4 `FileExistsError` — `IMPLEMENTATION-PLAN-V3.md` §1(a)). There is no `if exists` check to race on, and the ledger is **never** consulted to decide whether to run, so a corrupt ledger cannot cause a second read.

**Day key:** operator-local calendar day, `gate.day_key()` = `now.astimezone(zone).date().isoformat()` with `FREECASH_TZ` (default `Europe/Berlin`). Not a rolling 24 h window: a 24 h rule permits two runs inside one calendar day (00:30 then 23:30), which is exactly what R1 forbids.

**Duplicate path (same day):** `acquire_day_lock` returns `(False, lock)` → the process appends exactly one `SKIP_DUPLICATE_DAY` line (`severity=info`), prints `SKIP_DUPLICATE_DAY <day>`, exits **0**, and performs **no** read, **no** snapshot write, **no** ledger write, **no** queue touch, **no** notification.

**Success artifact — the definition of "ran":** a run is successful **only if** all three exist afterwards: (a) `state/day-locks/<day>.lock`, (b) `snapshots/<day>.json`, (c) one `daily/<day>.jsonl` line with `"outcome"` ∈ the success set. **An exit code of 0 with no day-lock artifact is a failure, not a pass** — this is the single most important assertion in §11.1 (VT-04).

**Concurrency:** Task Scheduler `MultipleInstances = IgnoreNew` is a second layer, not the barrier.

**Two independent missed-run detectors** (§10.1): in-band at the next run (`gate.missed_days`) and a same-evening watchdog task (`watchdog.py`, no socket, no lock write, no snapshot, exit 0 always).

---

## 4. The exact run order (`monitoring/freecash/run_daily_check.py::_run`)

1. `paths.ensure_layout()` — create the state directories. No network, no read.
2. `readonly_client.install_audit_guard()` — process-wide guard: any `socket.connect`/`getaddrinfo` to a non-allowlisted host raises `ForbiddenWriteError`.
3. Refuse and audit `--force-recheck` (§10.4). Exit 3.
4. `day = gate.day_key()`; `acquired, lock = gate.acquire_day_lock(day)`.
   - **not acquired** → one `SKIP_DUPLICATE_DAY` line, print `SKIP_DUPLICATE_DAY <day>`, exit 0, stop. Nothing else in this list runs.
5. `ledger = gate.load_ledger()`; compute `missed = gate.missed_days(day, ledger)`; `timezone_changed = gate.timezone_changed(ledger)`; `gate.record_attempt(day)` (atomic write).
6. Emit one `MISSED_DAY` alert per uncovered day (never back-filled) and `MONITOR_DEGRADED` if the timezone changed or the configured zone is unresolvable.
7. **Read** today's figures through the allowlisted transport only (`operator_state.read_source(day)` or `readonly_client.read_status_source()` — see §9). A failure here is `READ_FAILED`: alert, record outcome, exit **5**, day lock **stays consumed** (no in-day retry).
8. **`prior = changedetect.load_prior_snapshot(day)` — the most recent snapshot strictly before today.**
9. `snapshot = changedetect.build_snapshot(day, metrics, source, raw_body)`.
10. `verdict = changedetect.compare(prior, snapshot)` — comparison happens **before** anything is persisted.
11. `changedetect.save_snapshot(snapshot)` — write-once; an existing file for the day is never overwritten.
12. Emit exactly one `OK_NO_CHANGE` (log-only) **or** one alert line + at most one notification per distinct change + one approval item per notified change (§7, §8). Then the ≤1-per-7-day `APPROVAL_PENDING` reminder pass.
13. `gate.record_outcome(day, outcome)` — advances `last_success_day` only for success outcomes.
14. Retention: prune `snapshots/*.json` > 90 d and `logs/run-*.log` > 30 d. Never prune `alerts.jsonl` or `decided.jsonl`.
15. Print the single machine-readable summary line and exit 0:
    `RUN_OK <day> outcome=<outcome> source=<kind>(data_available=<bool>) snapshot=<file> written=<bool> changes=<n> notifications=<n> approvals=<n> reminders=<n> lock=<file>`

**Ordering invariant (non-negotiable):** step 8 must precede step 11. The legacy script saved first and loaded second (`free-cash-daily-check.py:266` → `:270`), which made `old == new` and rendered change detection incapable of ever firing. The mutation test VT-08 exists solely to prove the gate fails when this order is inverted; `rule_gate_verify.py` already detects it (V12/M2).

---

## 5. Snapshot and daily-log schemas

**Snapshot — `snapshots/<day_key>.json`, immutable once written** (`changedetect.build_snapshot`):

```json
{"schema_version":1,"day_key":"2026-09-19","captured_at_utc":"2026-09-19T06:35:11Z",
 "source":{"kind":"operator_entered","read_ops":[],"data_available":true,
           "note":"operator-entered record for 2026-09-19"},
 "degraded":true,
 "account_status":"ACTIVE","earnings_total_cents":1340,"balance_cents":1340,"pending_cents":0,
 "currency":"USD","raw_response_sha256":"9f2c…"}
```

Field rules: `degraded` is `true` whenever the source is not the real provider — true for **every** snapshot today (§1.2, provider blocked); it must be carried into every report so a "no change" can never be read as provider-verified. Amounts are **integer cents**. `raw_response_sha256` is a hash, never the raw body — no secret or PII may enter the state dir. A missing amount field is a `MetricError` (a read failure), never a silent zero. `data_available: false` writes the snapshot with `null` figures and comparisons are skipped (step 12 emits `MONITOR_DEGRADED`).

**Daily log — `daily/<YYYY-MM-DD>.jsonl`, one JSON object per line, appended, zero-change days included** (satisfies the "balance logging" rule of `docs/freecash-monitoring.md` while keeping the day's outcome machine-readable):

```json
{"schema_version":1,"day_key":"2026-09-19","ts_utc":"2026-09-19T06:35:11Z","run":"primary",
 "source":"operator_entered","data_available":true,"degraded":true,
 "prev_snapshot_day":"2026-09-18",
 "prev":{"earnings_total_cents":1025,"balance_cents":1025,"pending_cents":0,"account_status":"ACTIVE"},
 "now":{"earnings_total_cents":1340,"balance_cents":1340,"pending_cents":0,"account_status":"ACTIVE"},
 "delta_cents":{"earnings_total":315,"balance":315,"pending":0},
 "changes":[{"change_type":"EARNINGS_CHANGED","field":"earnings_total_cents","old_value":1025,"new_value":1340,"dedupe_key":"<sha256>"}],
 "notifications":1,"approval_ids":["0f5b9b2e-…"],
 "outcome":"EARNINGS_CHANGED","lock":"state/day-locks/2026-09-19.lock",
 "snapshot":"snapshots/2026-09-19.json","exit_code":0,
 "tz_configured":"Europe/Berlin","tz_resolved_kind":"system-local"}
```

`outcome` ∈ {`INITIAL_BASELINE`, `OK_NO_CHANGE`, `EARNINGS_CHANGED`, `STATUS_CHANGED`, `BALANCE_CHANGED`, `MONITOR_DEGRADED`, `READ_FAILED`, `RUN_FAILED`, `SKIP_DUPLICATE_DAY`}. The day-lock file remains the authoritative "day consumed" signal; the daily log is the human-readable per-day ledger and the input to the weekly runbook (§13). Both are projections of `alerts/alerts.jsonl`, which stays the canonical evidence record and is never rewritten.

---

## 6. Rule 3 — change detection, field by field

Compared fields are **exhaustive** (four fields, nothing else is ever compared) and **exact** (integer cents, no percentage/relative threshold — the legacy 1 %/5 % thresholds could swallow a real $0.99 movement on a $200 balance, which is precisely the change the operator asked to be told about).

| Field | Type | Comparison rule | Emitted `change_type` | Notified? |
|---|---|---|---|---|
| `account_status` | string (uppercased, trimmed from `account_status`/`status`) | any inequality | `STATUS_CHANGED` | **yes**, 1 notification |
| `earnings_total_cents` | int cents (`earnings_total_cents`/`earnings_cents`/`total_earnings_cents`; whole-currency aliases ×100, rounded) | any inequality | `EARNINGS_CHANGED` | **yes**, 1 notification |
| `balance_cents` | int cents (`balance_cents`/`available_cents`/`net_balance_cents`) | any inequality | `BALANCE_CHANGED` | **yes**, 1 notification |
| `pending_cents` | int cents (`pending_cents`/`pending_total_cents`) | any inequality | `EARNINGS_CHANGED` + `"subtype":"pending"` | **yes**, 1 notification |

Rules that make the comparison honest:

1. **Earnings vs status are different events with different keys and different messages.** A status move is reported as an account-state transition; a money move is reported as a delta with sign. They never share a dedupe key, so a day with both produces two notifications, not one merged report.
2. **Baseline, not a fake alarm.** No prior snapshot (or either side `data_available:false`) → `baseline: true` → exactly one `INITIAL_BASELINE` line, severity `info`, **zero notifications**.
3. **No change → log only.** Exactly one `OK_NO_CHANGE` line, severity `info`, **zero notifications** ("all fine" pushes train the operator to ignore the channel).
4. **Currency change is not a change.** `currency` mismatch → `MONITOR_DEGRADED`, money fields are **not** compared (comparing USD to EUR would fabricate movements).
5. **Dedupe:** `dedupe_key = sha256("<day_key>|<change_type>|<field>|<old_value>|<new_value>")`; the key is written into `notified-keys.json` **before** dispatch, so a crash loses one message but can never duplicate one. The key includes `day_key` deliberately: the same value change re-detected tomorrow is a new key and does notify again.
6. **Storm control:** more than 5 distinct changes in a day → individual notifications suppressed, exactly one coalesced summary notification, one alert line per change retained.
7. **Degraded comparison rules:** with `degraded: true`, a "no change" report is **unknown**, not verified — the message template says `Source: DEGRADED (…)` on every line, and the runbook counts degraded snapshots (§13, check 4).

Exact message shapes (from `notify.message_for_change`, which is the shipped implementation of the design's templates):

```
[FreeCash] EARNINGS CHANGE 2026-09-19
Earnings:  $10.25 -> $13.40  (+$3.15)
Balance:   $13.40 (changed too)
Pending:   $0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED (operator-entered record for 2026-09-19)
Detail:    alerts.jsonl dedupe=<first 16 hex>
ACTION:    No action taken. Review and approve anything you want done.
```
```
[FreeCash] STATUS CHANGE 2026-09-19
Account status: ACTIVE -> RESTRICTED
Earnings:  $13.40 (unchanged)  Balance: $13.40 (unchanged)
Source:    DEGRADED (…)
Detail:    alerts.jsonl dedupe=<first 16 hex>
ACTION:    No action taken. Review and approve anything you want done.
```

---

## 7. Notification payload shape

**Channels (priority order, all verified reachable on this host except where noted):** (1) `alerts/alerts.jsonl` — always on, zero dependency, the canonical record; (2) Windows-native toast via PowerShell 5.1 `System.Windows.Forms.NotifyIcon` (assembly load/object construction verified; whether a balloon physically renders is **UNVERIFIED** and must be seen once by the operator); (3) Telegram push — `TELEGRAM_BOT_TOKEN`/`TELEGRAM_HOME_CHANNEL` already exist in the Hermes `.env` (names observed, validity not tested — a test send is an external action and was not performed); (4) SMTP opt-in only, and only once a mailbox credential exists (none does). SMS is out (paid). `_send_sms()` from `scripts/notification_service.py` must never be used: it returns `True` without sending.

**In-process payload object (fixed shape, each dispatch):**

```json
{"schema_version":1,
 "event_id":"7c9e…","ts_utc":"2026-09-19T06:35:11Z","day_key":"2026-09-19",
 "event_type":"EARNINGS_CHANGED",
 "severity":"notify",
 "title":"[FreeCash] EARNINGS CHANGE 2026-09-19",
 "dedupe_key":"<sha256>",
 "body_lines":["Earnings:  $10.25 -> $13.40  (+$3.15)","Balance:   $13.40 (changed too)","Pending:   $0.00","Status:    ACTIVE (unchanged)","Source:    DEGRADED (…)","Detail:    alerts.jsonl dedupe=…","ACTION:    No action taken. Review and approve anything you want done."],
 "observed":{"field":"earnings_total_cents","old_value":1025,"new_value":1340,"delta_cents":315,"prior_day_key":"2026-09-18"},
 "degraded":true,
 "approval_id":"0f5b9b2e-…optional…",
 "delivery":{"channel":"toast","label":"TOAST_OK|STUB_OK|FAILED_TOAST","attempts":1}}
```

**Delivery contract (enforced in `notify.dispatch`):** at most **2** attempts, 5 s in-process backoff between them; after the second failure append `DELIVERY_FAILED` **carrying the full original message verbatim**, set the key's `delivery` to `FAILED_TOAST`, append `MONITOR_DEGRADED` ("this message exists only in alerts.jsonl — read the log"), and **stop**. A failed notification never blocks the state write, never re-reads the source, never triggers a second run, never touches the queue. A stubbed sender (tests) must label deliveries `STUB_OK`, never `TOAST_OK`, so a stubbed run can never be mistaken for a real delivery.

---

## 8. Rule 4 — approval-request queue and the human gate

**The routine's total capability is: enqueue.** There is no execution code path in `run_daily_check.py`, `approval_queue.py`, `notify.py`, `changedetect.py`, `gate.py`, `readonly_client.py`, `operator_state.py` or `watchdog.py`. `execution_state` is written only as the literal `NOT_EXECUTED`, `execution_allowed_by_this_routine` is always `false`, `expires_at_utc` is always `null`.

`approvals/pending.json` (exact shape, `approval_queue.build_item`):

```json
{"schema_version":1,"updated_at_utc":"2026-09-19T06:35:11Z",
 "items":[{"approval_id":"0f5b9b2e-6f4a-4a1e-9d6f-3c2b7a1e5d40",
   "created_at_utc":"2026-09-19T06:35:11Z","day_key":"2026-09-19",
   "change_dedupe_key":"<sha256 of the change that caused this item>",
   "reason":"earnings_total_cents moved from $10.25 to $13.40. Review and decide whether any action is wanted.",
   "proposed_action":{"action_type":"REQUEST_PAYOUT","amount_cents":1340,
     "destination":"OPERATOR_SPECIFIED - not stored by the routine",
     "provider_endpoint":"PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"},
   "status":"PENDING","status_reason":null,"decided_at_utc":null,"decided_by":null,
   "decision_note":null,
   "expires_at_utc":null,"execution_state":"NOT_EXECUTED","execution_allowed_by_this_routine":false}]}
```

`proposed_action` is a **label for a human**, never an instruction: `provider_endpoint` stays the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` until research resolves it, and `destination` is never stored.

**Decision path (human-only CLI):**

```
py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id <uuid> --decision approve|reject --by "<your name>" --note "<why>"
py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py list
```

`--by` and `--note` are required; a non-human identity (`system`, `routine`, `automation`, `agent`, `cron`, `scheduler`, `monitor`, `bot`, `script`, `machine`) is refused with exit 4. A decision writes `status`, `status_reason`, `decided_at_utc`, `decided_by`, `decision_note`, appends one line to `approvals/decided.jsonl`, **and re-asserts the frozen fields**. It never executes anything, and no timer, watchdog, cron entry or scheduler retry may change a `PENDING` status — a pending item waits indefinitely (the ≤1-per-7-days `APPROVAL_PENDING` reminder never decides).

**Every external action is gated. Enumerated and closed:**

| ID | External action | Who may do it | Gate |
|---|---|---|---|
| A1 | Any payout / claim / withdrawal / transfer / survey / offer / wager | **nobody, ever, from this routine** | No code path exists; widening the allowlist is forbidden (§9). Permanently out of scope. |
| A2 | Registering the scheduled tasks | operator, at the machine | §12.2; human action, not a routine action |
| A3 | Widening `ALLOWED_PATHS`/`ALLOWED_HOSTS` to a provider read path | operator + review | requires the research exit criteria (operator names the provider, one `GET` succeeds, values logged `[REDACTED]`); plus a `readonly-exempt:`-free justification comment |
| A4 | Enabling a push channel (Telegram send / SMTP) | operator | credential lives in the Hermes env only, never in the repo; a channel test send is itself an external action |
| A5 | Acting on an `APPROVED` item | operator, **outside this routine** | this routine never reads `APPROVED` as a trigger; any executor is a separate artifact with its own approval verification |
| A6 | Superseding/removing a legacy monitor | operator | legacy files stay on disk, marked superseded (never cited as compliant) |

---

## 9. Read-only enforcement (Rule 2) — allowlist design

**Layer A — deny-by-default transport (`readonly_client.py::request`), checked before the single socket site is ever reached:**

- **Method allowlist:** `ALLOWED_METHODS = frozenset({"GET","HEAD"})`; anything else → `ForbiddenWriteError("R2: method %r is not read-only …")`.
- **Host allowlist:** `ALLOWED_HOSTS = frozenset({"localhost","127.0.0.1","::1","[::1]"})`; a non-loopback host is refused, so an unresolved provider hostname cannot be reached even if a caller passes one.
- **Path allowlist:** a closed tuple of compiled regexes, currently exactly `/api/v1/status/metrics` (GET) and `/api/v1/status` (HEAD). Anything else → `ForbiddenWriteError("R2: path not allowlisted: …")`.
- **Body rejection:** any of `data`, `json`, `files`, `body`, `content`, and any unknown keyword argument → `ForbiddenWriteError`. A GET carrying a body is a refused request.
- **One socket site:** `_transport()` is the only function in the whole routine that opens a socket (`http.client.HTTPConnection`), so a network capture has exactly one place to audit. Provider read paths (W3/W4) are deliberately **absent** and the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` is kept verbatim and greppable.

**Layer B — process guard:** `install_audit_guard()` adds a `sys.addaudithook` that raises `ForbiddenWriteError` on `socket.connect`/`socket.getaddrinfo` to any host outside the allowlist. Installed at the top of every run, before any read.

**Layer C — static, build-breaking grep:** `docs/free-cash-monitor-routine/verify-readonly.sh` (and its Python port `monitoring/freecash/verify_readonly.py`) scan the routine source tree for six forbidden token classes — http-verb, write-call-shape, earning-verb, earning-action, write-endpoint-path, account-mutation — and exit **1** on any hit without an inline `# readonly-exempt: <reason>` marker, **2** when the target path does not exist ("absence of evidence is not a pass"). Prose is scanned deliberately: a fail-closed scanner that skips comments is eventually defeated by generated code, so a comment that names a forbidden verb must carry a marker and the marker count is a tracked metric (a rise = R2 eroding).

**Required fix in the same change as any deploy (currently red, V9):** remove the two unexempted hits — `approval_queue.py:111` (rename the constant usage to the defined `ACTION_LABEL_FOR_HUMAN_REVIEW`, or add a justified marker) and `tests/test_r4_approval.py:283` (add the `readonly-exempt:` marker to the negative-control assertion). Until both are resolved, `verify-readonly.sh monitoring/freecash` exits 1 and **no deploy claim is valid**.

---

## 10. Failure paths — what the operator is told, in each case

### 10.1 Missed run (machine asleep, task skipped, run failed)

| Detector | Where | Trigger | Artifact | Message |
|---|---|---|---|---|
| In-band, next run | `gate.missed_days()` | every local day strictly between `last_success_day` and today | one `MISSED_DAY` alert per day + `consecutive_missed_days` | `[FreeCash] MISSED DAY <day>` / `No successful status check recorded for <day>.` / `Last success: <day>. consecutive_missed_days=<n>` / `ACTION: No action taken. Investigate why no check ran (machine uptime, scheduler history, or a failed run).` |
| Same-evening watchdog (23:50 task) | `watchdog.py::check()` | `last_attempt_day != today` **or** `last_outcome` ∉ success outcomes | one `MISSED_DAY` alert, deduped per day | same text, so the operator learns the same evening instead of the next day |

The watchdog opens **no socket**, never runs the check, never writes the ledger/lock/snapshot/queue (its only writes are the alert line and the dedupe index), and always exits 0. Missed days are **never back-filled** — a back-fill would be a second status read for a past day and would defeat R1. Visibility beyond the alert: `state/last-run.json` (`last_attempt_day`, `consecutive_missed_days`), the absence of `daily/<day>.jsonl`, and Task Scheduler's own last-run result (non-zero when the interpreter crashed before the lock, e.g. the `ZoneInfoNotFoundError` case in §1.3 — that failure produces **no** lock, **no** log, **only** the scheduler result, which is why the interpreter must be pinned).

### 10.2 Provider / read error (source down, 401/403, DNS, timeout, 404, unparsable JSON, or the local substitute refusing connections)

- The day lock **stays consumed**: no automatic re-run (a retry would be a second read in the same day).
- `alerts.jsonl` gets `READ_FAILED`; the ledger records `last_outcome = READ_FAILED` and leaves `last_success_day` at its previous value, so the day remains uncovered and the watchdog alarms it that evening.
- Exit code **5**. Notification text:

```
[FreeCash] RUN FAILED 2026-09-19
Reason:    ReadError: GET /api/v1/status/metrics failed: [Errno 111] Connection refused
Day lock:  CONSUMED (no automatic re-run today - R1)
Attempts:  last_attempt_day=2026-09-19 last_success_day=2026-09-18
Detail:    alerts.jsonl dedupe=run:2026-09-19
ACTION:    No action taken. A second status read on the same day is not permitted by this routine (R1).
```
- Manual, human-only escape hatch: `run_daily_check.py --force-recheck --reason "<why>"` is **refused** (exit 3), prints `REFUSED_FORCE_RECHECK …`, and appends the refusal with the reason to `logs/forced-recheck-requests.jsonl` so the request is auditable. Turning that refusal into a working re-read requires a deliberate code change (§14, item 7).

### 10.3 Malformed snapshot / malformed state

| Case | Behaviour | What the user is told |
|---|---|---|
| Today's snapshot file already exists | never overwritten; `save_snapshot` returns `written=false` | the run summary line says `written=False`; the day's original values stand |
| A prior snapshot file is corrupt/unreadable | treated as "no prior" → baseline path, **no** comparison, **no** notification | `INITIAL_BASELINE` line + `Source: DEGRADED`; never a fabricated change |
| Payload missing a compared field, or a non-numeric value | `MetricError` → the read is a **failure**, not a zero | `RUN_FAILED` text of §10.2 with `MetricError: metrics payload is missing 'balance_cents'` |
| `last-run.json` corrupt | `gate.load_ledger()` returns a fresh ledger (never raises); the lock still governs | the day's run proceeds; `MONITOR_DEGRADED` if `last_outcome` looked inconsistent |
| `notified-keys.json` corrupt | treated as empty; a message may be re-sent once | `DELIVERY_FAILED`/duplicate risk is preferred over a silently dropped alert (a missed message is visible in the log; a duplicate erodes trust) |
| `pending.json` corrupt | `load_document()` returns an empty queue; **no** item is ever auto-decided | enqueueing continues; nothing executes |

### 10.4 Failure paths that must never happen (assertion list)

No automatic retry anywhere (no scheduler restart-on-failure, no in-process re-run, no "second attempt" of the status read); no `return True` from a `*_allowed()`/`is_run_*()` guard on error (fail **closed**, never open — the legacy `.mjs` fails open and can double-run); no swallowed exception that turns a failed run into exit 0; no write of any kind to a provider.

---

## 11. Verifier suite — `scripts/monitoring/rule_gate_verify.py` is the acceptance gate

### 11.1 Observed current status (this pass, exact commands)

| Target | Parse gate | SUMMARY | Exit |
|---|---|---|---|
| `server/scripts/freecash-daily-monitor.mjs` | **FAILED** (`node --check`: `SyntaxError: Unexpected token ':'`) | `R1=FAIL R2=FAIL R3=FAIL R4=FAIL` | 1 |
| `scripts/monitoring/free-cash-daily-check.py` | OK (`ast.parse`) | `R1=FAIL R2=FAIL R3=FAIL R4=FAIL` | 1 |
| `scripts/make_freecash_check.py` | OK | `R1=FAIL R2=FAIL R3=FAIL R4=FAIL` | 1 |
| `monitoring/freecash/run_daily_check.py` (canonical entry point) | OK | `R1=FAIL R2=PASS R3=PASS R4=PASS` | 1 |
| `monitoring/freecash/gate.py` | OK | `R1=FAIL R2=FAIL R3=FAIL R4=FAIL` | 1 |

**Interpretation, stated plainly:** the entry-point R1 FAIL is a **scope artifact**, not proof that the lock is missing — `gate.py` alone passes the atomic-lock, calendar-day, missed-day and fail-closed checks, and the R1 FAIL is produced because a single-file verifier cannot see another module's lock. Conversely `gate.py`'s FAIL on "no rolling 24h window used as the daily gate" is a **false positive** on `cursor = last + timedelta(days=1)` in the missed-day loop. The only honest one-line verdict today is: **NOT COMPLIANT — the canonical routine has no PASSing file-level gate run, and its own suite is red.**

### 11.2 Mutation probes already executed (temp copies only; repo untouched)

| # | Target (copied to `%TEMP%\fc-mut-*`) | Violation injected | Observed result |
|---|---|---|---|
| M1 | `readonly_client.py` | added a `urllib.request` POST call to `/api/v1/status/claim` | exit 1; `R2 RESULT: FAIL`; flips the check `no non-GET/HEAD HTTP method is used [line 42]`. **Separately observed:** the decisive-token check printed `PASS … 0 unexempted decisive hits in 242 lines` on that same line → gap D1. |
| M2 | `run_daily_check.py` | swapped `load_prior_snapshot`/`save_snapshot` (save first) | exit 1; `R3 RESULT: FAIL`; `FAIL prior state is loaded BEFORE the new snapshot is written [line 400]` — evidence: `in _run(): WRITE at line 400 (snapshot_file, written = changedetect.save_snapshot(…)) precedes PRIOR-STATE LOAD at line 401`. |
| M3 | `approval_queue.py` | added `execute_action()` + a branch that acts on `status == "APPROVED"` | exit 1; `R4 RESULT: FAIL`; `FAIL the routine contains NO execution path [line 92]`, `FAIL an APPROVED item is not auto-executed [line 101]`, `FAIL the approval gate is actually reachable [line 98]`. |
| M4 | `gate.py` | replaced `os.open(…, O_CREAT\|O_EXCL\|O_WRONLY)` with `if lock.exists(): return False, lock` | exit 1; `R1 RESULT: FAIL`; `FAIL atomic same-day guard (double-run barrier) [line 128]` — evidence names the TOCTOU race. |
| M5 | `notify.py` | downgraded `dispatch()` to a `print()` stub (real dispatcher renamed) | exit 1 **but the targeted check did not flip**: `PASS notification is a delivery path, not a print stub [line 78]`, evidence `paths.append_jsonl(paths.alerts_path(), record)` → **false negative**, gap D2. |

### 11.3 Demonstrated check gaps (why §11.4 extends this verifier rather than adding a sibling)

| Gap | Evidence | Impact |
|---|---|---|
| **D1** decisive-token scan is order-dependent | M1: a line containing `POST` produced `PASS … 0 unexempted decisive hits` because `scan_tokens()` `break`s after the first matching class (`http-verb`) and that class is not in the "decisive" set | an actual write verb can be reported as "no decisive hits"; only the separate method check saved the verdict |
| **D2** delivery check is a substring proxy | M5: a `print`-stub dispatcher is not detected because `NOTIFY_DISPATCH` matches `alerts.jsonl` anywhere in the file | a monitor that notifies nobody can still PASS R3's delivery check |
| **D3** single-file scope | V5/V6: `run_daily_check.py` → false `R1=FAIL`; `gate.py` → false rolling-window FAIL on missed-day arithmetic | a modular routine can never be given a clean verdict, and a correct implementation looks broken |
| **D4** runtime probe cannot execute a package | V7: `--run` copies one file → `run#1 exit=1 created=NO ARTIFACT CREATED`, traceback, 5/5 concurrent copies failing | the strongest evidence class (runtime artifacts) is unavailable exactly for the routine that exists |
| **D5** no end-to-end change-path check | V8: `R2/R3/R4 = PASS` on the entry point while the package raises `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined` on the first real change | a PASS verdict coexists with a broken change→notify→enqueue path |

### 11.4 The mutation-tested suite (each test: inject, run, require the exact failure)

Rules for the suite: it runs from a **temp copy** of the routine tree (never the working tree); every test must be **shown to fail before it passes** (a test whose assertion never fires is a tautology and is deleted); each assertion must name the check string it expects, not just an exit code; the acceptance gate stays `scripts/monitoring/rule_gate_verify.py` — the new modes below are **added to it**, no second verifier file is created.

| ID | Rule | Violation to inject (exact edit) | Command | Expected failing check + message | Status |
|---|---|---|---|---|---|
| VT-01 | R1 | replace `os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)` with `if lock.exists(): return False, lock` + `os.open(…, O_CREAT \| O_WRONLY)` | `py -3 …/rule_gate_verify.py <copy>/gate.py --package` | `FAIL  atomic same-day guard (double-run barrier) [line N]` + evidence containing `TOCTOU race` | **detected** (M4) |
| VT-02 | R1 | make the guard fail open: in `acquire_day_lock`, `except FileExistsError: return True, lock`; and in the caller, `except Exception: return True` | same | `FAIL  guard fails CLOSED on error` + evidence `a read/parse error grants permission instead of denying it` | to run |
| VT-03 | R1 | add a rolling-window gate: `if last_ts and (time.time()-last_ts) < 86400: return 0` in the entry point | same | `FAIL  no rolling 24h window used as the daily gate` + evidence quoting the `86400` line | to run |
| VT-04 | R1 | **no injection**: run the package twice on the same day in a temp data root | `FREECASH_DATA_ROOT=<tmp> py -3 <copy>/run_daily_check.py` (×2) | run 1: exit 0 **and** `state/day-locks/<day>.lock` **and** `snapshots/<day>.json` exist; run 2: exit 0, stdout `SKIP_DUPLICATE_DAY <day>`, snapshot mtime unchanged, ledger unchanged, exactly +1 `SKIP_DUPLICATE_DAY` line. **Exit 0 with no day-lock artifact = FAIL** | **blocked by D4** until `--package` staging exists |
| VT-05 | R2 | append `urllib.request.urlopen(urllib.request.Request("<host>/api/v1/status/claim", data=b"{}", method="POST"))` | `… verify_readonly.sh <copy>` and `… rule_gate_verify.py <copy>/readonly_client.py` | `FAIL  no non-GET/HEAD HTTP method is used` **and** the token scan must report the decisive hit (`write-endpoint-path`/`write-call-shape`), not `0 unexempted decisive hits` — closes D1 | **partially detected** (method check only; M1) |
| VT-06 | R2 | delete `ALLOWED_METHODS`/`ALLOWED_PATHS` and the `ForbiddenWriteError` raise from `request()` | same | `FAIL  deny-by-default allowlist exists (structural barrier)` + evidence `read-only-ness is a convention here, not an enforced denial` | to run |
| VT-07 | R2 | add a `GET https://api.freecash.com/v1/status` literal to `readonly_client.py` (no `PROVIDER_ENDPOINT_UNKNOWN` marker) | same | `FAIL  no invented/unresolved provider endpoint` + evidence naming host `api.freecash.com` | to run |
| VT-08 | R3 | move `save_snapshot` above `load_prior_snapshot` in `_run()` | `…/rule_gate_verify.py <copy>/run_daily_check.py` | `FAIL  prior state is loaded BEFORE the new snapshot is written [line N]` + `WRITE at line N … precedes PRIOR-STATE LOAD at line M` | **detected** (M2) |
| VT-09 | R3 | introduce a threshold: `if old and abs(new-old)/old > 0.01: notify_change(...)` | same | `FAIL  change comparison is exact (no threshold can swallow it)` | to run |
| VT-10 | R3 | downgrade `dispatch()` to `print(message)` (keep the real dispatcher under another name) | `…/rule_gate_verify.py <copy>/notify.py` | **must become** `FAIL  notification is a delivery path, not a print stub`; today it PASSes — the check must require a *call site* of a delivery function (toast/SMTP/webhook/`dispatch(`) that itself writes the alert log, not any appearance of `alerts.jsonl` — closes D2 | **false negative** (M5) |
| VT-11 | R4 | add `def execute_action(item)` + `if item.get("status") == "APPROVED": execute_action(item)` | `…/rule_gate_verify.py <copy>/approval_queue.py` | `FAIL the routine contains NO execution path`, `FAIL an APPROVED item is not auto-executed`, `FAIL the approval gate is actually reachable` | **detected** (M3) |
| VT-12 | R4 | make a timeout decide: `if item["expires_at_utc"] and item["expires_at_utc"] < now: execute_action(item)` | same | `FAIL  a timeout cannot convert pending -> executed` | to run |
| VT-13 | R4 | fabricate consent: `approved = True` beside an enqueue; and separately `decision = random.choice(["approve","reject"])` | same | `FAIL  consent is not hardcoded` / `FAIL  consent is not fabricated by RNG` | to run |
| VT-14 | R3/R4 end-to-end | **no injection**, change fixture: day-1 `earnings_total_cents=1025`, day-2 `1340` (temp data root, stub sender) | `FREECASH_DATA_ROOT=<tmp> py -3 <copy>/run_daily_check.py` (day 2) | must print `RUN_OK … outcome=EARNINGS_CHANGED … changes=1 notifications=1 approvals=1`; exactly 1 `EARNINGS_CHANGED` alert with `old_value=1025,new_value=1340`; exactly 1 delivery to the stub sender; exactly 1 `PENDING` item whose `expires_at_utc` is `null`. **Today: FAILS with `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined`** — closes D5 | **fails today** (V8) |
| VT-15 | package scope | **no injection**: verify the whole routine directory | `py -3 …/rule_gate_verify.py monitoring/freecash --package` | per-rule verdicts with each mechanism attributed to `file:line` (`gate.py::acquire_day_lock`, `readonly_client.py::request`, `changedetect.py::compare`, `approval_queue.py::enqueue`), and no false `R1=FAIL` for the entry point while the lock exists in `gate.py` — closes D3 | **fails today** (V5/V6) |

**Acceptance criteria for the routine (all must hold, executed, output recorded):** VT-01…VT-13 green with the exact messages above; VT-14 green; VT-15 green; `verify-readonly.sh monitoring/freecash` exit **0**; `run_all.py` `failures=0 errors=0`; and a **rule_gate_verify.py run that exits 0 for the routine as a package**. Until then the honest report is: *"rules structurally enforced in code; not yet verified by a passing gate run."*

---

## 12. Schedule — exact intended commands

### 12.1 Recommended mechanism

Windows Task Scheduler, two tasks, **no other entry point**. Rationale from `PROVIDER-FINDINGS-REVERIFIED.md` Q7 (re-verified): Task Scheduler is present and can wake a hibernating machine; `crontab` is absent in git-bash; Hermes cron exists and is currently running but cannot wake the machine and depends on its gateway daemon.

### 12.2 Task A — the daily check (08:00 local; 08:35 also acceptable and preferred by `ROUTINE-DESIGN.md` §7.2 because it sits inside normal uptime and after the provider's overnight rollover)

PowerShell (preferred: `schtasks /create` cannot set `WakeToRun`/`StartWhenAvailable`/`MultipleInstances`). **Requires operator approval (A2) — this plan does not register it.**

```powershell
$py = "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"   # ONLY interpreter that resolves Europe/Berlin today
$action    = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument '/c set FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash&&"' + $py + '" "D:\AgenticOS\monitoring\freecash\run_daily_check.py" >> "D:\AgenticOS\data\freecash\logs\run-latest.log" 2>&1' `
  -WorkingDirectory "D:\AgenticOS"
$trigger   = New-ScheduledTaskTrigger -Daily -At 08:00
$settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 0
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName "FreeCash-Daily-Monitor" -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Description "Free Cash read-only daily status monitor (R1-R4). One run per operator-local calendar day."
```

Constraint notes, all deliberate:
- `-RestartCount 0` (**no** restart-on-failure): a restart is a same-day re-run and R1 says once. Task Scheduler retry must stay off in the GUI too.
- `S4U` + `RunLevel Limited` avoids the elevation requirement that `schtasks /Create … /RL HIGHEST` has (never verified on this non-elevated shell) and still runs while logged off. Interactive-only (`/IT`) is the cheaper non-elevated option but skips runs while logged off — that is what Task B exists to catch. **Pick one; do not write both** (`ROUTINE-DESIGN.md` §7.1 contains the contradiction).
- `StartWhenAvailable` catch-up is **unproven** for a plain daily trigger; do not rely on it. The day lock makes a late run safe (clock-catchup would otherwise double-log a day).
- `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash` is set inline because `paths.py` defaults to `data/freecash-monitor` (§1.3, item 3).
- Interpreter pinning is mandatory: with `py -3` the day key raises `ZoneInfoNotFoundError` **before** the lock is created → no lock, no log, only a non-zero scheduler result (§10.1, last column).
- Locale: this host is `de-DE`, so `%DATE%` → `19.09.2026` (dots, no slashes) — a `%DATE%`-based log name works here but is locale-dependent; a wrapper `.cmd` that computes the log name is the portable form and is **required work** (new file, not created here).

Read-only equivalent `schtasks` form (query/validation only):

```
schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST
```

### 12.3 Task B — the watchdog (23:50 local, same day)

```powershell
$action2 = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument '/c set FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash&&"' + $py + '" "D:\AgenticOS\monitoring\freecash\watchdog.py" >> "D:\AgenticOS\data\freecash\logs\watchdog-latest.log" 2>&1' `
  -WorkingDirectory "D:\AgenticOS"
$trigger2 = New-ScheduledTaskTrigger -Daily -At 23:50
Register-ScheduledTask -TaskName "FreeCash-Missed-Day-Watchdog" -Action $action2 -Trigger $trigger2 `
  -Settings $settings -Principal $principal -Description "Alerts once if today's Free Cash status check did not succeed. Opens no socket; runs no check."
```

Current reality: **no task of either name exists** (`schtasks /Query /FO LIST | grep -iE "freecash|daily-monitor|missed-day"` → no match, V11). Until both exist and a first run has produced a day lock and a snapshot, the routine is not operating.

### 12.4 How a missed run becomes visible (four independent signals)

1. **Same evening:** Task B's `MISSED_DAY` alert (23:50) — the only signal that arrives while the operator can still act the same day.
2. **Next run:** in-band `MISSED_DAY` per uncovered day from `gate.missed_days()` (never back-filled).
3. **Ledger:** `last_attempt_day` / `last_success_day` / `consecutive_missed_days` in `state/last-run.json` — one file answers "did the check run today?".
4. **Filesystem + scheduler:** absence of `daily/<day>.jsonl` and of `state/day-locks/<day>.lock`, plus Task Scheduler's last-run result (the only signal at all when the interpreter crashes before the lock).

---

## 13. Operator touchpoints (weekly, ~5 minutes) and day-30 criteria

| Check | Command / artifact | Pass | If it fails |
|---|---|---|---|
| Day coverage | `state/last-run.json` + `daily/*.jsonl` | 7 distinct `last_success_day` values in the last 7 local days | inspect Task A history; fix logon/wake settings |
| No silent gaps | `grep -c MISSED_DAY alerts/alerts.jsonl` | 0 new this week | investigate uptime; confirm Task B is firing |
| Alerts actually delivered | count `DELIVERY_FAILED` | 0 new | read the missed messages **from `alerts.jsonl`**; switch channel (Telegram is already configured; SMTP needs a credential) |
| Degraded mode | `grep -c '"degraded": true' snapshots/*.json` | target **0** | until 0, treat every "no change" as **unverified** — escalate the provider question |
| Approval queue age | oldest `PENDING` in `approvals/pending.json` | decide or reject anything > 7 days old (safe either way — nothing executes) | — |
| R2 still structural | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | exit 0 | review new `readonly-exempt:` markers; a rise means R2 is eroding |
| Gate still green | `py -3 scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` and `py -3 monitoring/freecash/tests/run_all.py` | exit 0 both | a red gate voids the "operational" claim; do not report a green 30-day run |

**Day-30 exit criteria (same as `ROUTINE-DESIGN.md` §9.2, restated with the honest caveat):** 7/7 weekly checks for 4 consecutive weeks **and** degraded count 0. Until the provider read exists, degraded cannot reach 0, so the correct status is **"operational but unverified"** — never "compliant".

---

## 14. Required work before deploy (each item is a change, not a convention)

1. Fix `approval_queue.py:111` (`ACTION_LABEL_REQUEST_PAYOUT` → the defined `ACTION_LABEL_FOR_HUMAN_REVIEW`) — 11 suite errors and the whole change→enqueue path depend on it.
2. Add the missing `readonly-exempt:` marker at `tests/test_r4_approval.py:283`; re-run `verify-readonly.sh monitoring/freecash` to exit 0 (V9).
3. Extend `scripts/monitoring/rule_gate_verify.py` with `--package <dir>` (whole-tree staging for the runtime probe + per-rule module attribution, closing D3/D4) and fix D1 (token scan: do not `break` before recording decisive classes) and D2 (delivery check: require a delivery call site). **No sibling verifier.**
4. Make the offline suite green (`run_all.py` `failures=0 errors=0`), including the four currently-failing behavioural tests (`test_five_concurrent_runs_yield_one_winner`, `test_day_key_follows_the_configured_timezone`, `test_healthy_day_raises_no_alarm`, `test_missing_check_raises_one_alarm_and_changes_no_state`) and the data-less-run expectation.
5. Install `tzdata` for the launcher **or** pin every action to the venv interpreter (V10) — otherwise every run is `MONITOR_DEGRADED` and a crash-loop produces no lock, no log, no alert.
6. Align `paths.DEFAULT_DATA_ROOT` with `D:/AgenticOS/data/freecash/` (or keep the env var and document it in the task definitions) — one canonical state root, not two.
7. Decide the `--force-recheck` policy explicitly (today: accepted only to be refused, recorded in `logs/forced-recheck-requests.jsonl`).
8. Add the wrapper `.cmd` for locale-safe log naming, then register Task A + Task B (§12) — **operator-gated (A2)**.
9. Answer the provider question in writing (`HG.Cash` / `Cashfree` / `freecash.com` / other, and whether the account is personal). Until then `PROVIDER_ENDPOINT_UNKNOWN` stays verbatim and no provider request may be scheduled — freecash.com automation is prohibited by its own terms.
10. Confirm with the operator, once and physically, that a toast balloon actually appears on this desktop; until then the only proven delivery is `alerts.jsonl`.

**Never, in any change:** add a write/claim/withdraw/survey/cashout endpoint; widen the allowlist without the research exit criteria; let a timeout, watchdog, cron entry or scheduler retry change a `PENDING` item; swallow an exception so a failed run exits 0; store a credential in the repository; delete or edit a legacy monitor (keep superseded, never cite as compliant); create a second verifier beside `rule_gate_verify.py`.

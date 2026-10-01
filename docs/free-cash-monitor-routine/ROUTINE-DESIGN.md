# ROUTINE-DESIGN.md — Canonical Daily Status-Monitoring Routine

**Project:** Free Cash Finance Automation — daily status monitoring
**Repo:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908`
**Status:** design complete, deployment-ready; implementation files named below are **to be created** (nothing in this document has been executed).
**Author scope:** design + test plan only. No existing file is modified by this routine.

---

## 0. Rules, and what "structural enforcement" means here

| Rule | Requirement | Enforcement class used in this design |
|---|---|---|
| **R1** | Check status **once per day**, no double runs, missed-day detected | **Atomic OS-level mutual exclusion** (exclusive-create day lock) + independent watchdog task |
| **R2** | **Never** take an earning action automatically | **Deny-by-default network transport** (verb+path allowlist in code) + **static CI grep** over the source tree |
| **R3** | Notify operator when earnings **or** account status changes | **Dedupe-keyed change detector** over a versioned snapshot; exactly one notification per change |
| **R4** | Human approval before **any** external action; pending waits indefinitely | **Approval queue file with `execution_state` frozen at `NOT_EXECUTED`**; the routine contains **no execution code path at all** |

"Structural" here means: the violation is **not reachable by the code as written**, not merely "we did not do it today". Every rule has a mechanism that fails closed (denies) when in doubt.

---

## 1. Component diagram and state/directory layout

### 1.1 Component diagram

```
                     Windows Task Scheduler  (2 tasks, no other entry points)
                     ┌──────────────────────────────┬───────────────────────────────┐
                     │ Task A: FreeCash-Daily-Monitor│ Task B: FreeCash-Missed-Day-Watchdog
                     │ 08:35 local, daily            │ 23:50 local, daily
                     │ -MultipleInstances IgnoreNew  │ read-only over state/
                     └───────────────┬───────────────┴───────────────┬───────────────┘
                                     │                               │
                                     v                               v
                    ┌────────────────────────────────┐   ┌───────────────────────────┐
                    │  run_daily_check.py (routine)  │   │  watchdog.py              │
                    │  the ONLY orchestrator         │   │  (no network access)      │
                    └───┬───────┬───────────┬────────┘   └──────────┬────────────────┘
                        │       │           │                       │
   (R1) DAY-LOCK GATE   │       │           │                       │
   ┌────────────────────v──┐    │           │                       │
   │ gate.py                │   │           │                       │
   │ O_CREAT|O_EXCL          │  │           │                       │
   │ state/day-locks/<D>.lock│  │           │                       │
   │ -> SKIP_DUPLICATE_DAY   │  │           │                       │
   └───────────┬────────────┘  │           │                       │
               │ ACQUIRED      │           │                       │
               v               v           v                       v
   ┌───────────────────┐  ┌────────────────────┐  ┌──────────────────────────────┐
   │ READ-ONLY CLIENT  │  │ changedetect.py    │  │ notify.py                    │
   │ readonly_client.py│  │ snapshot vs prior  │  │ 1) append alerts.jsonl       │
   │ (R2) ALLOWLIST    │  │ dedupe_key         │  │ 2) Windows toast (native)    │
   │ GET|HEAD only     │  │ (R3)               │  │ 3) optional SMTP (stdlib)    │
   │ raises on write   │  └─────────┬──────────┘  └──────────────┬───────────────┘
   └────────┬──────────┘            │                            │
            │ GET (only)            │ change?                    │ max 2 attempts
            v                       v                            v
   ┌───────────────────┐  ┌────────────────────┐  ┌──────────────────────────────┐
   │ READ SOURCE       │  │ snapshots/<D>.json │  │ approvals/pending.json      │
   │ A) AgenticOS local│  │ (immutable, 90d)   │  │ (R4) enqueue ONLY           │
   │    metrics API    │  └────────────────────┘  │ status=PENDING forever      │
   │ B) Free Cash API  │                          │ execution_state=NOT_EXECUTED│
   │  PROVIDER_ENDPOINT│                          └──────────────┬───────────────┘
   │  _UNKNOWN - resolve│                                        │ human decides
   │  in research phase │                                        v
   └───────────────────┘                          ┌──────────────────────────────┐
                                                  │ approvals/decided.jsonl      │
                                                  │ (append-only, human-written) │
                                                  └──────────────────────────────┘
   ── no arrow from the routine to any earning endpoint exists in this diagram ──
```

### 1.2 State / directory layout

```
D:/AgenticOS/data/freecash-monitor/
├── state/
│   ├── last-run.json              # single source of truth for R1 + missed-day detection
│   ├── day-locks/
│   │   └── 2026-09-17.lock        # exclusive-create lock; presence == "day consumed"
│   └── notified-keys.json         # dedupe_key index for R3 (no re-notify, ever)
├── snapshots/
│   └── 2026-09-16.json            # one immutable snapshot per successful day; 90-day retention
├── approvals/
│   ├── pending.json               # approval queue (JSON, schema in §6.1)
│   └── decided.jsonl              # append-only decision audit trail
├── alerts/
│   └── alerts.jsonl               # APPEND-ONLY alert log — the canonical evidence record
└── logs/
    └── run-2026-09-17.log         # Task Scheduler stdout/stderr redirection target
```

**State file schemas (exact):**

`state/last-run.json`
```json
{
  "schema_version": 1,
  "last_attempt_day": "2026-09-17",
  "last_success_day": "2026-09-17",
  "last_attempt_at_utc": "2026-09-17T06:35:04Z",
  "last_success_at_utc": "2026-09-17T06:35:11Z",
  "last_outcome": "OK_NO_CHANGE",
  "consecutive_missed_days": 0,
  "timezone": "Europe/Berlin",
  "updated_at_utc": "2026-09-17T06:35:11Z"
}
```

`state/day-locks/<YYYY-MM-DD>.lock` — zero-byte marker written with `O_CREAT|O_EXCL`. The **filename is the day key**; contents are irrelevant, so a partially-written file can never be misread.

`state/notified-keys.json`
```json
{
  "schema_version": 1,
  "keys": {
    "1f0c…": {"first_notified_at_utc": "2026-09-17T06:35:11Z", "delivery": "TOAST_OK"}
  }
}
```

`alerts/alerts.jsonl` — one JSON object per line, append-only, never edited:

| Field | Type | Notes |
|---|---|---|
| `event_id` | uuid4 str | unique per line |
| `ts_utc` | ISO-8601 Z | write time |
| `day_key` | `YYYY-MM-DD` | operator-local day |
| `event_type` | enum | `OK_NO_CHANGE`, `EARNINGS_CHANGED`, `STATUS_CHANGED`, `BALANCE_CHANGED`, `INITIAL_BASELINE`, `SKIP_DUPLICATE_DAY`, `RUN_FAILED`, `READ_FAILED`, `MISSED_DAY`, `DELIVERY_FAILED`, `APPROVAL_PENDING`, `MONITOR_DEGRADED` |
| `dedupe_key` | str \| null | null for run-level events |
| `severity` | enum | `info`, `notify`, `alert` |
| `message` | str | ≤ 500 chars, operator-readable |
| `observed` | object | the compared field values (no secrets) |

---

## 2. R1 — Once-per-day gate

### 2.1 Mechanism (exact)

Two-layer, both in `gate.py`:

1. **Atomic day lock (the actual barrier).** Before *any* network or disk work:
   ```python
   day = datetime.now(ZoneInfo(TZ)).date().isoformat()      # operator-local calendar day
   lock = STATE / "day-locks" / f"{day}.lock"
   try:
       fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)   # atomic on NTFS
       os.close(fd)
   except FileExistsError:
       emit_alert("SKIP_DUPLICATE_DAY", severity="info")          # ONE line, no other side effect
       sys.exit(0)                                                # exit code 0, by design
   ```
   `O_CREAT|O_EXCL` is a single atomic syscall; two simultaneous processes cannot both create the same file. This is what makes a concurrent double-fire safe — no read-then-write race, no `if exists` check.
2. **Ledger + reconciliation.** Immediately after acquiring the lock, `gate.py` writes `last_attempt_day` to `state/last-run.json` (atomic write: temp file + `os.replace`). On success it writes `last_success_day`. The ledger is for **audit and missed-day math only** — it is never the gate, so a corrupted ledger cannot cause a double run.

**Duplicate same-day invocation exits with no side effects:** the second invocation writes exactly one `SKIP_DUPLICATE_DAY` info line to `alerts.jsonl`, prints `SKIP_DUPLICATE_DAY <day>` to stdout, and exits `0`. It does **not**: read the network, write a snapshot, touch `pending.json`, send a notification, or modify `last-run.json`. (Deliberate: a Task Scheduler "already running / missed" retry must not be able to break R1, and exit 0 prevents the scheduler's own retry logic from re-firing.)

### 2.2 Timezone handling

| Concern | Decision |
|---|---|
| Day key | **Operator-local calendar day** via `zoneinfo.ZoneInfo("Europe/Berlin")` (DST-aware, UTC+01:00/+02:00), overridable with env `FREECASH_TZ`. |
| Why not UTC | A UTC day key in a UTC+02:00 locale means the "day" rolls at 02:00 local — a 00:30 local run and a 23:30 local run land on different local days but the operator reads them as "same day". Local day == operator's mental model == what R1 means. |
| DST transitions | 08:35 local is far from the 02:00–03:00 transition, so a run is never skipped or doubled by the DST jump. The day key is computed from the *wall clock at run time*, so the 25-hour and 23-hour days still produce exactly one key each. |
| Ledger cross-check | `last-run.json` stores `timezone`; if it changes, the routine emits `MONITOR_DEGRADED` (a timezone change can produce a 2-day or 0-day gap). |

### 2.3 Missed-run behaviour (two independent detectors)

| Detector | Where | Trigger | Alert |
|---|---|---|---|
| **In-band** at next run | `gate.py` | `last_success_day < yesterday` (local) | `MISSED_DAY` for each missing day, then **continue with today's check** (do not back-fill: back-filling would be a second check on a past day and would defeat R1) |
| **Same-day watchdog** (Task B, 23:50 local) | `watchdog.py` | today's `last_attempt_day != today` **or** `last_outcome` ∉ {success outcomes} | `MISSED_DAY`, severity `alert` |

The watchdog is what makes a silently skipped run visible **the same evening**, not a day later. It never runs the check itself.

**Failure semantics that respect R1:** a run that fails (network error, parse error) leaves the day lock in place and records `last_outcome = RUN_FAILED` / `READ_FAILED`. The routine does **not** retry within the same day (that would be a second check). The failure is surfaced immediately as an alert, and the day counts as a missed **success**. Manual re-check, if the operator wants it, is a human action: `run_daily_check.py --force-recheck --reason "…"` — it consumes a distinct `-forced` lock suffix, is recorded to `decided.jsonl`-adjacent audit with the reason, and cannot be triggered by the scheduler (the scheduled action never passes `--force-recheck`).

---

## 3. R2 — Read-only status acquisition

### 3.1 Read operations (explicit whitelist)

| # | Operation | Verb | Target | Buildable today? |
|---|---|---|---|---|
| W1 | Today's metrics snapshot | `GET` | `http://localhost:3001/api/v1/status/metrics` (internal AgenticOS API, from `scripts/monitoring/free-cash-daily-check.py`) | **Yes** |
| W2 | Account status/health probe | `HEAD` | same host, `/api/v1/status` | Yes |
| W3 | Provider balance/earnings status read | `GET` | **`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`** | **No — blocked on external access** |
| W4 | Provider account-status read | `GET` | **`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`** | **No — blocked** |

No other read operation is permitted. W3/W4 must be resolved by research/observation of the real provider contract; this design deliberately does not invent them. (Note: the pre-existing `server/scripts/freecash-daily-monitor.mjs` invented `https://api.freecash.com/v1/status` — that URL is **not** grounded in anything and must not be carried forward.)

### 3.2 The deny-list interception layer (structural, not policy)

Three independent layers; a claim of R2 compliance requires all three:

**Layer A — deny-by-default transport (`readonly_client.py`).**
```python
ALLOWED_METHODS = frozenset({"GET", "HEAD"})
ALLOWED_PATHS = (
    re.compile(r"^/api/v1/status/metrics$"),
    re.compile(r"^/api/v1/status$"),
    # provider paths added ONLY after research resolves them, each with a justification comment
)

class ForbiddenWriteError(RuntimeError): ...

def request(method: str, url: str, **kw):
    method = method.upper()
    if method not in ALLOWED_METHODS:
        raise ForbiddenWriteError(f"R2: method {method} is not read-only")
    if "data" in kw or "json" in kw or "files" in kw:
        raise ForbiddenWriteError("R2: request bodies are forbidden")
    if not any(p.match(urlparse(url).path) for p in ALLOWED_PATHS):
        raise ForbiddenWriteError(f"R2: path not allowlisted: {urlparse(url).path}")
    return _transport(method, url)     # the ONLY socket call in the routine
```
Every other module imports `readonly_client.request` instead of `requests`/`http.client`. `_transport` is the single place a socket is opened, so network-capture testing (§8, T2.4) has exactly one code path to audit.

**Layer B — process-level guard.** At import of `readonly_client`, install an audit hook that aborts if the routine opens a socket to a non-allowlisted host, and (in tests) monkeypatch-free fixtures assert that `requests.post/put/patch/delete` do not exist on the injected transport object.

**Layer C — static/CI check (`verify_readonly.py`, runnable now: `docs/free-cash-monitor-routine/verify-readonly.sh`).** Greps the routine's source tree for forbidden tokens and exits non-zero on any hit outside a justified exemption.

### 3.3 Exact forbidden token patterns (the CI grep)

Line-based, case-insensitive for prose words, case-sensitive for verbs/paths. A hit fails the build unless the line carries an inline `# readonly-exempt: <reason>` marker.

```
# --- 1. HTTP verbs (case-sensitive) ---
\b(POST|PUT|PATCH|DELETE)\b

# --- 2. verb-invoking call shapes ---
\.post\(|\.put\(|\.patch\(|\.delete\(|requests\.post|requests\.put|requests\.patch|requests\.delete
axios\.post|axios\.put|axios\.patch|axios\.delete|fetch\([^)]*method:\s*["'](POST|PUT|PATCH|DELETE)
http\.client|urllib\.request\.urlopen|urlopen\(|socket\.socket\(|curl\s+[^|]*-X\s*(POST|PUT|DELETE)|curl\s+[^|]*(-d|--data|--upload-file)

# --- 3. earning / money-movement verbs (case-insensitive) ---
(?i)\b(claim|withdraw|withdrawal|cashout|cash_out|cash-out|redeem|payout|pay_out|transfer|wager|bet|spin|deposit|purchase|checkout)\b

# --- 4. earning action names (case-insensitive) ---
(?i)(submit_offer|complete_survey|complete_task|start_task|accept_offer|claim_reward|redeem_reward|request_payout)

# --- 5. write / earning endpoint paths ---
/(claim|withdraw|withdrawal|cashout|redeem|payout|transfer|bet|spin|deposit|checkout)\b
/offers/[^/]+/claim|/surveys/[^/]+/complete|/tasks/[^/]+/complete|/rewards/claim

# --- 6. mutation of remote account state ---
(?i)(update_balance|set_balance|credit_account|debit_account)
```

**Exemption policy:** the only standing exemption is `readonly_client.py`'s own `_transport` and the `ALLOWED_*` constants. Every new exemption must be a one-line `# readonly-exempt: <reason>` on the forbidden line, and the number of exemptions is a tracked metric in the weekly runbook (§9). An unexplained rise in exemptions is the earliest signal that R2 is eroding.

**Verified behaviour of the shipped check** (`docs/free-cash-monitor-routine/verify-readonly.sh`, executed during design):

| Scenario | Observed | Exit |
|---|---|---|
| Read-only scratch module (allowlist constants + `GET`/`HEAD` guard) | `forbidden=0 exempt=0` → PASS | 0 |
| Scratch module containing `requests.post("http://x/claim", …)` | 4 hits across 4 patterns (`http-verb`, `write-call-shape`, `earning-verb`, `write-endpoint-path`), offending `file:line` printed → FAIL | 1 |
| Target path does not exist (e.g. the routine is not implemented yet) | `TARGET MISSING … NOT a pass` → FAIL | 2 |
| Real repo code: `finance-monitor/src` | 1 hit — `rule_engine.py:32` (a docstring mentioning `"withdraw", "transfer"`) → FAIL | 1 |

The last row is a **known false-positive class and it is deliberate**: comment and docstring prose is scanned too, because a fail-closed scanner that skips comments will eventually be defeated by generated code or a multi-line string. Prose that legitimately names a forbidden verb must carry a `# readonly-exempt:` marker, so the exemption count stays an honest metric rather than a blind spot. The default scan target is the routine's own code tree (`monitoring/freecash`), not the whole repo.

**What this makes impossible:** adding a working earning action requires (a) an `ALLOWED_METHODS`/`ALLOWED_PATHS` edit, (b) an exemption marker, and (c) a failing-then-edited CI check — three deliberate, reviewable acts. It cannot happen by accident, and cannot happen silently.

---

## 4. R3 — Change detection

### 4.1 Snapshot schema (`snapshots/<day_key>.json`, immutable once written)

```json
{
  "schema_version": 1,
  "day_key": "2026-09-17",
  "captured_at_utc": "2026-09-17T06:35:11Z",
  "source": { "kind": "agenticos_local_metrics", "read_ops": ["W1", "W2"] },
  "degraded": true,
  "account_status": "ACTIVE",
  "earnings_total_cents": 1025,
  "balance_cents": 1025,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "9f2c…"
}
```
`degraded: true` means the snapshot came from a **substitute** source (the local metrics API) rather than the provider. `degraded` snapshots still compare and still notify, but every report carries the marker so a "no change" report can never be mistaken for "provider verified no change" (§9 risk).

### 4.2 Compared fields (exact, exhaustive)

| Field | Type | Compare rule |
|---|---|---|
| `account_status` | string enum | any inequality → `STATUS_CHANGED` |
| `earnings_total_cents` | int (cents) | any inequality → `EARNINGS_CHANGED` |
| `balance_cents` | int (cents) | any inequality → `BALANCE_CHANGED` |
| `pending_cents` | int (cents) | any inequality → `EARNINGS_CHANGED` (subtype `pending`) |

**No relative/percentage threshold.** Money fields are compared as exact integers in cents: the prior implementation's 1% balance / 5% rate thresholds (`scripts/monitoring/free-cash-daily-check.py`) can swallow a real $0.99 movement on a $200 balance, which is exactly the change the operator asked to be told about. `currency` mismatch is not a "change" — it is `MONITOR_DEGRADED`. Fields not listed are never compared.

Baseline rule: with no prior snapshot, write `INITIAL_BASELINE` (severity `info`, one log line, **no notification**) — a first run must not produce a fake alarm.

### 4.3 Dedupe key — one change, exactly one notification

```
dedupe_key = sha256( day_key | change_type | field | old_value | new_value )
```
- Emitted at most **once per change**, because before dispatch `notified-keys.json` is consulted: if the key is present, the change is appended to `alerts.jsonl` with severity `info` and **no notification is dispatched**.
- The key deliberately **includes `day_key`**, so the *same* change re-detected tomorrow is a new key and does notify (the operator wants to know it is still there / still different), while a re-run within the same day (which R1 already prevents) could not double-notify.
- `notified-keys.json` is written **before** dispatch (`os.replace` atomic). Crash between write and dispatch loses one notification — never duplicates one. Fail-safe direction chosen deliberately: a missed message is visible in `alerts.jsonl`; a duplicate erodes trust in the channel.

### 4.4 Noise suppression on a no-change day

| Day type | `alerts.jsonl` lines | Notifications dispatched |
|---|---|---|
| No change | **exactly 1** (`OK_NO_CHANGE`, severity `info`) | **0** |
| Earnings/status change | 1 per distinct change + 1 summary | **exactly 1 per distinct change**, hard cap 5 |
| First run (no baseline) | 1 (`INITIAL_BASELINE`) | 0 |
| >5 distinct changes in one day | 1 per change in log | **1 coalesced summary** ("7 changes; see alerts.jsonl") |
| Run failure | 1 | 1 (`RUN_FAILED`) |

`OK_NO_CHANGE` is **log-only by design**: R3 requires notification on *change*, and a daily "all fine" push trains the operator to ignore the channel. Additional guard: if the routine ever believes it produced >5 notifications in a day, it emits 1 coalesced summary — a notification storm is structurally impossible, not just unlikely.

---

## 5. R4-adjacent: Notification

### 5.1 Channels

| Option | Cost | Dependency | Verdict |
|---|---|---|---|
| **Append-only `alerts/alerts.jsonl`** | free | none (stdlib) | **Primary source of truth — always on** |
| **Windows-native toast** (PowerShell `System.Windows.Forms.NotifyIcon` balloon, no modules) | free | none (built into Windows) | **Recommended default delivery channel** |
| SMTP via **stdlib `smtplib`** (reuse `scripts/notification_service.py` pattern) | free | an existing mailbox; credential from vault, never in repo | **Opt-in secondary (recommended for away-from-desk days)** |
| ntfy.sh / Telegram / Slack webhook | free tier | third-party service + URL secret | Optional; **not required** |
| SMS (Twilio/Nexmo) | **paid** | third-party | Explicitly **not** the default |

> The pre-existing `scripts/notification_service.py` `_send_sms()` returns `True` without sending anything — a false-success stub. It must not be used as a delivery path until it actually reports failures.

### 5.2 Delivery-failure handling (no infinite retry)

| Step | Behaviour |
|---|---|
| Attempt 1 | dispatch to the channel |
| Attempt 2 | only if attempt 1 raised; sleep 5 s (in-process, not a scheduler retry) |
| After 2 failures | append `DELIVERY_FAILED` to `alerts.jsonl` **with the full original message**, mark the dedupe key `delivery: FAILED_TOAST`, **stop**. Never retry that key, ever. |
| Escalation | the toast channel failing twice switches the routine to SMTP-only for that day and records `MONITOR_DEGRADED` |
| Invariant | notification failure **never** blocks the state write, **never** re-triggers the status read, **never** causes a second run, and **never** touches the approval queue |

Because the undelivered message is stored verbatim in `alerts.jsonl`, a delivery failure degrades to "operator must open the file" — never to silent data loss.

### 5.3 Message templates (exact)

**(a) Earnings change — `EARNINGS_CHANGED`**
```
[FreeCash] EARNINGS CHANGE 2026-09-17
Earnings:  $10.25 -> $13.40  (+$3.15)
Balance:   $10.25 -> $13.40
Pending:   $0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED (local metrics, not provider-verified)
Detail:    alerts.jsonl dedupe=1f0c…
ACTION:    No action taken. Review and approve anything you want done.
```

**(b) Account status change — `STATUS_CHANGED`**
```
[FreeCash] STATUS CHANGE 2026-09-17
Account status: ACTIVE -> RESTRICTED
Earnings:  $13.40 (unchanged)  Balance: $13.40 (unchanged)
Source:    DEGRADED (local metrics, not provider-verified)
Detail:    alerts.jsonl dedupe=2ab9…
ACTION:    No action taken. Review and approve anything you want done.
```

**(c) No change — log line only (template of the line, NOT a notification)**
```
{"event_type":"OK_NO_CHANGE","day_key":"2026-09-17","severity":"info",
 "observed":{"earnings_total_cents":1340,"balance_cents":1340,"pending_cents":0,"account_status":"ACTIVE"},
 "message":"No change vs 2026-09-16. No notification sent. Source DEGRADED."}
```

**(d) Run failure / missed day — `RUN_FAILED`, `MISSED_DAY`**
```
[FreeCash] RUN FAILED 2026-09-17
Reason:    ReadError: GET /api/v1/status/metrics timed out after 10s
Day lock:  CONSUMED (no automatic re-run today — R1)
Attempts:  last_attempt_day=2026-09-17 last_success_day=2026-09-16
Detail:    logs/run-2026-09-17.log, alerts.jsonl dedupe=run:2026-09-17
ACTION:    No action taken. Manual re-check (audited, human-only):
           py -3 D:/AgenticOS/monitoring/freecash/run_daily_check.py --force-recheck --reason "<why>"
```
```
[FreeCash] MISSED DAY 2026-09-16
No successful status check recorded for 2026-09-16 (watchdog 2026-09-16T21:50Z).
Last success: 2026-09-15. consecutive_missed_days=1
ACTION:    No action taken. Investigate Task Scheduler history (Task A) and machine uptime.
```

---

## 6. R4 — Approval queue

### 6.1 File format (`approvals/pending.json`)

```json
{
  "schema_version": 1,
  "updated_at_utc": "2026-09-17T06:35:11Z",
  "items": [
    {
      "approval_id": "0f5b9b2e-6f4a-4a1e-9d6f-3c2b7a1e5d40",
      "created_at_utc": "2026-09-17T06:35:11Z",
      "day_key": "2026-09-17",
      "change_dedupe_key": "1f0c…",
      "reason": "Earnings of $3.15 detected; operator may wish to request payout.",
      "proposed_action": {
        "action_type": "REQUEST_PAYOUT",
        "amount_cents": 315,
        "destination": "OPERATOR_SPECIFIED — not stored by the routine",
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

| Field | Why it exists |
|---|---|
| `approval_id` | stable handle for the human decision + audit join key |
| `change_dedupe_key` | ties the item back to the exact alert that created it |
| `expires_at_utc: null` | **explicitly null, never a date.** A non-null expiry is the mechanism by which pending items historically turn into "expired, so execute" — this design forbids that field from ever being set. |
| `execution_state` | frozen at `NOT_EXECUTED`; the routine only ever writes this constant |
| `execution_allowed_by_this_routine: false` | a machine-readable assertion that this component cannot execute |
| `status_reason`, `decided_by`, `decision_note`, `decided_at_utc` | audit trail (who/when/why) |

### 6.2 Enqueue / decide / execute

| Step | Actor | Mechanism |
|---|---|---|
| Enqueue | routine, **only on a real change** | append an item with `status: PENDING`; append `APPROVAL_PENDING` (severity `notify`) to `alerts.jsonl`; notification includes the `approval_id`. Enqueueing is **not** a request for permission to act — it is a notification with a handle. |
| Approve / reject | **human only** | `py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id <uuid> --decision approve\|reject --by "<name>" --note "<why>"` writes the decision into `pending.json` **and** appends a line to `decided.jsonl`. There is no non-human caller. |
| Execute | **outside this routine** | no code path in this routine reads `status: APPROVED`. The routine's only write to `execution_state` is the constant `NOT_EXECUTED`. Any real payout/transfer must be a separate artifact with its own approval verification (existing precedent: `scripts/approval_gate.py` verifies a signed consent token; `server/tasks/register_approved_change.py` records an approval row **without** executing). |

### 6.3 No timeout ever converts pending → executed

| Timeout source | Exists? | Behaviour |
|---|---|---|
| `finance-monitor/src/wait_gate.py` `_timeout_seconds = 86400` | yes, in a **non-canonical** module | `handle_timeout()` returns `False` → abort, never approve. Correct direction, but that module's `request_approval()` also uses `random.choice` with a 60% chance of simulated `APPROVE` — **it must never be on the execution path.** |
| `scripts/approval_gate.py` `token_expiry_hours` (default 4) | yes | expiry invalidates a *consent token*; an expired token means **do not execute**. Fails closed. |
| `server/tasks/register_approved_change.py` `expires_at = now + 7 days` | yes | governs the window in which a *human already approved* record may be relied upon. It never approves anything on its own. |
| This routine's approval queue | **`expires_at_utc` is always `null`** | an item waits **indefinitely**. No cron, no watchdog, no scheduler retry, no TTL job may change a `PENDING` item's status. A weekly nag line (`APPROVAL_PENDING`, max 1 per item per 7 days) reminds the human; the nag never decides. |

**Invariant (testable):** for any clock advance N days with no human input, `pending.json` item count and every item's `status` are unchanged, and `alerts.jsonl` contains no `EXECUTED` event of any kind.

---

## 7. Scheduling (Windows-native)

### 7.1 Tasks

| | Task A — the check | Task B — the watchdog |
|---|---|---|
| Name | `FreeCash-Daily-Monitor` | `FreeCash-Missed-Day-Watchdog` |
| Time | **08:35 local**, daily | 23:50 local, daily |
| Multi-instance policy | `IgnoreNew` (scheduler-level R1 backstop) | `IgnoreNew` |
| Missed-start policy | `StartWhenAvailable` = **true** (a missed 08:35 still runs once, late, same local day — R1 still holds because the day lock is per-day) | true |
| Run whether logged on | **Yes (`-RunLevel Highest`, stored credentials)** — avoids the "only when logged on" trap that silently skips runs after a reboot | same |
| Network | no network needed | no network at all |

**Exact command (Task A):**
```
schtasks /Create /TN "FreeCash-Daily-Monitor" /SC DAILY /ST 08:35 /F ^
  /TR "cmd /c py -3 D:\AgenticOS\monitoring\freecash\run_daily_check.py 1>> D:\AgenticOS\data\freecash-monitor\logs\run-%DATE%.log 2>&1" ^
  /RL HIGHEST /RU "%USERNAME%"
schtasks /Change /TN "FreeCash-Daily-Monitor" /IT
```
**Exact command (Task B):**
```
schtasks /Create /TN "FreeCash-Missed-Day-Watchdog" /SC DAILY /ST 23:50 /F ^
  /TR "cmd /c py -3 D:\AgenticOS\monitoring\freecash\watchdog.py 1>> D:\AgenticOS\data\freecash-monitor\logs\watchdog-%DATE%.log 2>&1" ^
  /RL HIGHEST /RU "%USERNAME%"
```
Notes: `%DATE%` is locale-dependent; if the locale produces `/` in the date the redirection breaks — the portable form is a wrapper `.cmd` that computes the log name, or redirect to a fixed `logs/run-latest.log` and rely on the per-day `logs/` naming inside the routine. Use `py -3` (Windows Python launcher) rather than `python` so the interpreter is not PATH-dependent. Task Scheduler's own "restart on failure" must be set to **Do not restart** — a restart is a same-day re-run, and R1 says once.

### 7.2 Recommended run time: **08:35 local (Europe/Berlin)**

| Reason | Detail |
|---|---|
| After provider day-rollover settles | Earnings/status rollovers typically settle in the provider's own (US-anchored) overnight window, which lands in the EU early morning; 08:35 avoids reading a half-rolled ledger. |
| Before the operator's working day | A pending approval created at 08:35 is visible while the human is at the keyboard — R4's "waits indefinitely" is safer when the human is awake to see it. |
| Away from DST | 02:00–03:00 local is where a DST jump makes local-time triggers double-fire or skip; 08:35 is immune. |
| Away from midnight | 00:00–03:00 collides with backups/rollover and any machine-sleep window; 08:35 sits well inside normal uptime. |
| Not too late | Late-evening runs push the approval to the next morning — a full 24-hour latency for a human decision. |

---

## 8. Verification test matrix

`O` = runs offline (no credentials, no network, fixtures + `localhost` only) · `L` = requires live credentials/provider access.
Every test's expected result is **observable** (file contents, exit code, line count) — not "looks right".

| ID | Rule | Procedure | Expected observable result | O/L |
|---|---|---|---|---|
| **T1.1** | R1 | Run `run_daily_check.py` twice in a row, same local day, same TZ. | 1st: exit 0, `snapshots/<day>.json` created, `last_success_day == day`. 2nd: exit 0, stdout `SKIP_DUPLICATE_DAY`, `alerts.jsonl` grew by exactly 1 `SKIP_DUPLICATE_DAY` line, snapshot mtime unchanged, `last-run.json` unchanged. | O |
| **T1.2** | R1 | Launch 5 copies simultaneously (`&` in bash); wait for all. | Exactly one snapshot file exists for the day; `alerts.jsonl` has exactly 4 `SKIP_DUPLICATE_DAY` lines; `last_attempt_at_utc` written once; no partial/corrupt JSON (validate with `json.load`). | O |
| **T1.3** | R1 | Fixture: set `last_success_day = D-3`, run once for D. | Exactly 3 `MISSED_DAY` alert lines (one each for D-2, D-1, and the uncovered part of D-3..D-1 boundary as implemented), `consecutive_missed_days == 3`, and exactly **1** snapshot written for D only — **no back-fill run for the missed days**. | O |
| **T1.4** | R1 | Set `FREECASH_TZ` to `Europe/Berlin` at 00:30 local and to `UTC` at 23:30 local (frozen clock fixtures). | The two runs produce **different** day keys under a UTC config and the **same** day key under local config; with a timezone change recorded, `MONITOR_DEGRADED` is emitted. | O |
| **T2.1** | R2 | Run `docs/free-cash-monitor-routine/verify-readonly.sh` over the routine source tree. | Exit 0 with 0 unexempted hits; then add `requests.post("…")` to a scratch copy → exit non-zero and the offending line printed with file:line. | O |
| **T2.2** | R2 | Call `readonly_client.request("POST", "http://localhost:3001/api/v1/status/metrics", json={...})`. | `ForbiddenWriteError` raised **before** any socket is opened (assert with a transport spy that was never called); nothing written to `alerts.jsonl`. | O |
| **T2.3** | R2 | Call `request("GET", <non-allowlisted path>)` and `request("GET", <allowlisted path>, data=b"x")`. | Both raise `ForbiddenWriteError`; the allowlisted bare GET succeeds against `localhost`. | O |
| **T2.4** | R2 | Run a full monitoring cycle with a network capture (`tshark`, or a proxy logging methods) for one day. | Capture contains **only** `GET`/`HEAD` requests, to allowlisted hosts only; 0 `POST`/`PUT`/`PATCH`/`DELETE`. | **L** |
| **T3.1** | R3 | Fixture: day-1 snapshot `earnings_total_cents=1025`; day-2 read returns `1340`. | Exactly 1 `EARNINGS_CHANGED` alert line with `old=1025 new=1340`; exactly 1 notification dispatched (toast spy); message matches template (a); dedupe key recorded. | O |
| **T3.2** | R3 | Fixture: `account_status` `ACTIVE` → `RESTRICTED`, money fields unchanged. | Exactly 1 `STATUS_CHANGED` alert; exactly 1 notification; template (b) text; independent of the earnings dedupe key (a second, distinct key). | O |
| **T3.3** | R3 | Fixture: identical snapshots day-1/day-2 (all four fields equal). | `alerts.jsonl` gains **exactly 1** `OK_NO_CHANGE` line; **0** notifications dispatched (toast spy count == 0); no `pending.json` item created. | O |
| **T3.4** | R3 | Force a re-detection of an already-notified change (replay the same snapshot pair with the same `day_key`), then replay with a different `day_key`. | Same `day_key`: 0 additional notifications (key already in `notified-keys.json`). Different `day_key`: exactly 1 new notification (new key) — proving the key includes the day. | O |
| **T4.1** | R4 | Create a `PENDING` item, then advance the clock 90 days running the routine + watchdog daily. | Item still `status: PENDING`, `expires_at_utc` still `null`, `execution_state` still `NOT_EXECUTED`; at most 13 weekly nag lines (1 per 7 days); **zero** execution events anywhere. | O |
| **T4.2** | R4 | Human-invoked `approval_queue.py decide --id <uuid> --decision approve --by "operator" --note "…"`. | `pending.json` item → `APPROVED` with `decided_at_utc`, `decided_by`, `decision_note` populated; exactly 1 line appended to `decided.jsonl`; `execution_state` **still** `NOT_EXECUTED`. | O |
| **T4.3** | R4 | Attempt to make a pending item executable: set `expires_at_utc` to a past date and run every scheduled component. | No component changes the item's status; a past `expires_at_utc` produces **no** execution (assert by searching all state files for any `EXECUTED` string → 0 hits). Cross-check against `scripts/approval_gate.py`: an expired token fails `verify_approval` → not executed. | O |
| **T4.4** | R4 | Grep the entire routine for any caller that reads `status == "APPROVED"` and performs a write. | **0 hits** (this is the structural proof that the routine cannot execute); the static check T2.1 also passes. | O |
| **T5.1** | R1/R3 | Fresh install: empty state dir, first ever run. | Exactly 1 `INITIAL_BASELINE` line, **0** notifications, 1 snapshot, `last_success_day` set; no `MISSED_DAY` for the pre-history period. | O |
| **T5.2** | R3/R4 | Smoke-test: toast channel made to fail (invalid host) for one cycle. | ≤2 dispatch attempts, then 1 `DELIVERY_FAILED` line **containing the full message**, `delivery: FAILED` on the key, `MONITOR_DEGRADED` recorded; run still exits 0; snapshot still written; **no** retry loop and no second run. | O |

**Totals:** 18 tests — **16 offline (O)**, **1 live (T2.4)**, **1 mixed (T2.2–T2.3 offline; T2.4 is the live half)**. The live-blocked set is small by design: every rule's *enforcement mechanism* is offline-provable; only the true provider read is not.

---

## 9. 30-day unattended-operability review

### 9.1 What breaks first (ranked by probability × impact)

| # | Failure | Likelihood over 30 days | Impact | Early signal |
|---|---|---|---|---|
| 1 | **Provider read contract unresolved** (`PROVIDER_ENDPOINT_UNKNOWN`) → the routine only ever reads the local metrics API, so 30 days of "no change" prove nothing about the real account | **Certain today** (blocked on external access) | **High** — silent false confidence in R3 | `degraded: true` on every snapshot |
| 2 | Task runs "only when logged on" / machine asleep at 08:35 → skipped run | High after any reboot/update | Medium — a missed day, caught by Task B | `MISSED_DAY` from the watchdog, Task Scheduler "last run result" ≠ 0x0 |
| 3 | Provider session/auth expiry (if the read needs a session cookie/token) | Medium–High | Medium — R3 becomes silent, not loud | repeated `READ_FAILED` with 401/403 |
| 4 | Unbounded growth of `snapshots/` + `logs/` | Medium by day ~90, low by day 30 | Low | disk usage of `data/freecash-monitor/` |
| 5 | Toast delivery silently failing (focus-assist/quiet-hours) | Medium | Medium — alerts exist only in the log | `DELIVERY_FAILED` lines, operator never saw a message |
| 6 | DST / timezone drift changing the day-key boundary | Low (08:35 chosen to avoid it) | Low–Medium | `MONITOR_DEGRADED` on TZ change; a 2-day or 0-day gap |
| 7 | Approval queue accumulating unread `PENDING` items | Medium | Low–Medium (R4 is safe — items just wait) | `consecutive` nags, oldest PENDING age |

Retention (removes #4): delete `snapshots/*.json` older than **90 days**, `logs/run-*.log` older than **30 days**, never touch `alerts.jsonl` or `approvals/decided.jsonl` (the audit record grows forever by design).

### 9.2 Minimal weekly runbook (operator, ~5 minutes, one day per week)

| Check | Command / artefact | Pass condition | If it fails |
|---|---|---|---|
| 1. Day coverage | `state/last-run.json` | 7 distinct `last_success_day` values in the last 7 local days | Open Task Scheduler → Task A history; fix logon/sleep settings |
| 2. No silent gaps | `grep -c MISSED_DAY alerts/alerts.jsonl` | 0 new since last week | Investigate machine uptime; consider `StartWhenAvailable` confirmation |
| 3. Alerts actually delivered | count `DELIVERY_FAILED` | 0 new | Switch channel to SMTP (`scripts/notification_service.py` pattern); re-read missed alerts from `alerts.jsonl` |
| 4. Degraded mode | `grep -c '"degraded": true' snapshots/*.json` (last 7) | target: **0** (all provider-verified) | Escalate: resolve `PROVIDER_ENDPOINT_UNKNOWN` in research phase — until then treat all "no change" reports as unverified |
| 5. Approval queue age | oldest `PENDING` item in `approvals/pending.json` | decide or reject anything older than 7 days (safe either way — nothing executes) | — |
| 6. R2 still structural | `bash docs/free-cash-monitor-routine/verify-readonly.sh` | exit 0 | Review the new `# readonly-exempt:` markers; an unexplained rise means R2 is eroding |
| 7. Disk & retention | `du -sh data/freecash-monitor/` | < 100 MB; snapshots pruned to ≤90 days | run the retention pass |
| 8. Weekly summary | `alerts/alerts.jsonl` for the 7 days | 1 `OK_NO_CHANGE` per quiet day; ≤5 notifications per day | if any day has >5 notifications, the change stream needs the coalescing threshold reviewed |

**Day-30 exit criteria:** 7/7 weekly checks pass for 4 consecutive weeks **and** check #4 reaches 0 — i.e. the routine is reading the real provider, not a substitute. Until #4 is 0, the routine is "operational but unverified", and that must be stated plainly in any status report rather than reported as a green 30-day run.

---

## 10. Buildable today vs blocked on external access

| Buildable today (no external access) | Blocked on external access |
|---|---|
| Day-lock gate, ledger, missed-day math (R1) | Provider status/earnings **read** endpoints (W3, W4) — `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` |
| Read-only client + allowlist + static CI check + all T2.1–T2.3 (R2) | Live network-capture test T2.4 (needs real creds/session) |
| Snapshot schema, comparison fields, dedupe key, noise suppression (R3) | Real earnings/status values to detect changes against (fixtures work, real signal does not) |
| Approval queue, audit trail, freeze at `NOT_EXECUTED` (R4) | Provider payout/claim **execution** contract (out of scope here, and forbidden to automate anyway) |
| Task Scheduler registration, watchdog, runbook, all offline tests | SMTP credential (vault) if the email channel is enabled |

## 11. Existing artifacts — reuse vs supersede (all paths verified to exist)

| Existing path | Decision | Reason |
|---|---|---|
| `server/scripts/freecash-daily-monitor.mjs` | **SUPERSEDE — do not deploy** | TypeScript annotations (`: boolean`, `Promise<any>`) and `require()` inside a `.mjs` (cannot run on Node 24 ESM); invented endpoint `https://api.freecash.com/v1/status`; `isDailyCheckAllowed()` returns `true` on error (**fail-open → double run**); `getDailyCheckCount()` reads a `count` field the record never writes; no lock file, so concurrent runs race. |
| `scripts/monitoring/free-cash-daily-check.py` | **SUPERSEDE, reuse the endpoint constant** | Calls `save_snapshot()` **before** `load_snapshot()` → compares the new snapshot to itself → **R3 can never fire**; `save_snapshot` computes its directory from `Path(snapshot_timestamp_utc).parent`; `is_run_for_today()` returns `True` on a parse error (**monitoring silently stops forever**); `send_notification()` is a `print` stub; 1%/5% thresholds suppress small real movements. Good part kept: the local read endpoint `GET /api/v1/status/metrics` (op W1). |
| `finance-monitor/src/rule_engine.py` | Reuse concepts, not code | `check_rule2` builds a `%Y-%m-%d` flag name while `__init__` sets a `%Y-%m` `_flag_name` (inconsistent, unused); a flag file is not an atomic gate. |
| `finance-monitor/src/wait_gate.py` | **Reuse `handle_timeout()` semantics only; keep off the execution path** | `request_approval()` uses `random.choice` with a ~60% chance of simulated `APPROVE` — acceptable as a sandbox demo, unacceptable in the canonical routine. `handle_timeout()` returning `False` (abort) matches this design. |
| `finance-monitor/src/action_executor.py`, `api_client.py` | Not used by the routine | Sandbox-only stubs; `api_client.py` defaults to the invented `https://api.example.finance/v1`. |
| `scripts/approval_gate.py` | Reuse for the **human-invoked** executor only | Signed consent token with `token_expiry_hours` (fails closed: expired → not executed). Requires a `webhook_url`; out of scope for the monitor. |
| `scripts/notification_service.py` | Reuse the SMTP path; **do not use `_send_sms()`** | stdlib `smtplib` = no paid third party. `_send_sms()` returns `True` without sending (false success); the module-level `send_notification()` helper references an undefined `config` global. |
| `server/tasks/register_approved_change.py` | Reuse the *pattern* (approval is recorded, never executed) | Its docstring already states it "does NOT execute payouts/transfers directly". Defects: uses `timedelta` without importing it (`NameError` on the print path), and `sys.path.insert('/d/AgenticOS/server')` is an MSYS path that native Python will not resolve. |
| `server/tasks/daily-finance-monitor.py`, `last_run_time.json`, `README_daily-monitor.md` | **SUPERSEDE the state file** | `last_run_time.json` holds a bare float epoch (`1789115102.649168`) with no day key, outcome, or timezone — it cannot support missed-day detection. The README's "<24h since last run" rule is not a calendar-day rule and permits 2 runs in one day (00:30 then 23:30). |
| `config/freecash-crontab` | **SUPERSEDE for Windows** | POSIX crontab, placeholder path `/path/to/AgenticOS/`, log name typo `freecashioc_`; POSIX cron is not the Windows-native schedule (§7). |
| `docs/freecash-monitoring.md` | Superseded in substance | Describes `HEAD/GET only` (keep) but also describes a **step 06 that executes POST withdraw / POST survey-submit** after a CLI `y` — that violates R4's "no automatic action by this routine" and is not part of this design. |
| `daily-status-monitoring-specification.md`, `free-cash-finance-monitoring-specification.md`, `free-cash-finance_monitoring_plan.md`, `free-cash-automation-workflow.md`, `DAILY_MONITORING_DESIGN_SUMMARY.md`, `resources/daily-monitoring-spec.md` | Reference/context | Prior design intent. `DAILY_MONITORING_DESIGN_SUMMARY.md` points at `D:/AgenticOS/design_doc.json` (and its embedded ASCII block is corrupted by literal `\n` sequences); no canonical, deployable routine exists yet — this document is it. |

## 12. Implementation phase — files to be created (none created by this design task)

| Path | Purpose | Rule |
|---|---|---|
| `D:/AgenticOS/monitoring/freecash/run_daily_check.py` | the orchestrator (only entry point) | R1–R4 |
| `D:/AgenticOS/monitoring/freecash/gate.py` | atomic day lock, ledger, missed-day math, timezone | R1 |
| `D:/AgenticOS/monitoring/freecash/readonly_client.py` | allowlisted GET/HEAD transport, `ForbiddenWriteError` | R2 |
| `D:/AgenticOS/monitoring/freecash/changedetect.py` | snapshot schema, field comparison, dedupe key | R3 |
| `D:/AgenticOS/monitoring/freecash/notify.py` | alert log + toast + optional SMTP, 2-attempt cap | R3 |
| `D:/AgenticOS/monitoring/freecash/approval_queue.py` | enqueue + human decide, never executes | R4 |
| `D:/AgenticOS/monitoring/freecash/watchdog.py` | 23:50 same-day missed-run alert | R1 |
| `D:/AgenticOS/monitoring/freecash/verify_readonly.py` | static grep check (CI) | R2 |
| `D:/AgenticOS/monitoring/freecash/tests/` | the 18 tests in §8 | all |
| `D:/AgenticOS/data/freecash-monitor/**` | state, snapshots, approvals, alerts, logs | all |

Pre-flight before deploy: fill in `RULE-GATE-CHECKLIST.md` and run every offline test (T1.1→T5.2 minus T2.4) — no credentials required.

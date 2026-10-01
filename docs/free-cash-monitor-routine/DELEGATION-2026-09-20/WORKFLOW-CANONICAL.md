# CANONICAL WORKFLOW — Free Cash Finance Automation: once-per-day READ-ONLY status monitor

- **Document status:** CANONICAL (supersedes `WORKFLOW-PLAN-V4.md` and `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` as the *operational* spec)
- **Date:** 2026-09-20
- **Repo:** `D:\AgenticOS`
- **Host:** Windows 11, shell = bash (git-bash/MSYS), local timezone now `+0200` (Europe/Berlin, CEST) [E40]
- **Scope:** a scheduled routine that reads a cash-provider account status **once per calendar day**, notifies a human **only when something changed**, and **never executes anything** — no earning action, no withdrawal, no transaction, no account mutation.
- **Evidence policy:** every status claim in this document is marked with an `[E<nn>]` tag that resolves to a command actually run in this session and its observed output, listed in **Appendix A**. Anything not so marked is explicitly labelled `ASSERTED (not yet verified)`. No speculative claim is presented as verified.
- **Write footprint of this session:** one new file (this document) + scratch files under `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/scratch/`. No source file was modified. One runtime log line was appended to `server/tasks/daily_monitor.log` by exercising that monitor [E5] — disclosed in §5.

---

## 0. Executive verdict (read this first)

There are **seven** overlapping "Free Cash monitor" implementations in the repo. An eighth, `monitoring/freecash/`, was found during this audit and is the only one that implements all four rules as *executable gates* and passes its own tests.

| # | Candidate | Runs today? | Verdict |
|---|---|---|---|
| 1 | `monitoring/freecash/` (**discovered in this audit**) | **YES** — 52 tests / 0 failures; real run writes snapshot+lock; second run refused [E8][E10][E11] | **PROMOTE** → canonical |
| 2 | `server/scripts/freecash-daily-monitor.mjs` | **NO** — SyntaxError, cannot parse [E1] | **PARK** (superseded) |
| 3 | `scripts/monitoring/free-cash-daily-check.py` | **NO** — exit 0, zero output, zero artifacts [E3] | **DELETE proposed** (human approval required) |
| 4 | `server/tasks/daily-finance-monitor.py` | **YES, but the gate is wrong** [E5][E6] | **FIX** |
| 5 | `finance-monitor/*` | **NO** — SyntaxError in `src/rule_engine.py` [E7] | **FIX** (or DELETE proposed) |
| 6 | `server/src/adapters/freecashMonitorAdapter.ts` | Not provable runnable; hardcoded stub; not registered [E19] | **PARK** |
| 7 | `server/src/services/freeCash/freeCashExecutor.ts` | Not provable (needs a real provider login) | **PARK** — blocked on credential |
| 8 | `server/scripts/verify-freecash-rules.mjs` | **YES, exit 0, 4/4 PASSED** — and it certifies a file that cannot parse [E2] | **DELETE proposed** (the verifier is worse than no verifier: it manufactures false confidence) |

**The one-line conclusion:** the canonical routine is `monitoring/freecash/run_daily_check.py`; nothing else in the repo may be wired to a scheduler; and the "known-good monitor" named in the prior skill/plan (`server/scripts/freecash-daily-monitor.mjs`) **has never run a single time** — `node --check` rejects it at line 41 [E1].

---

## 1. The four rules as enforceable gates

A rule is only a gate if there is a code path that (a) always executes, and (b) refuses work when the rule would be broken. The table below names the enforcement point for each rule in the canonical routine. "Intent" (a comment saying we won't do a thing) is not listed as enforcement anywhere.

| Rule | Statement | Enforcing artifact (code) | Behaviour when violated |
|---|---|---|---|
| **R1** | No automated earning/write action, ever | `readonly_client.request()` — method/host/path/body allowlists, one socket site `_transport()`; `readonly_client.install_audit_hook()` — process-wide `sys.addaudithook` that raises on `socket.connect`/`socket.getaddrinfo` to a non-loopback host; `verify_readonly.py` — CI token scanner | `ForbiddenWriteError` raised **before** any socket is opened. There is no code path in the routine that would consume such an error and retry differently. |
| **R2** | At most one status check per calendar day | `gate.acquire_day_lock(day)` — `os.open(lock, O_CREAT\|O_EXCL\|O_WRONLY)` on `state/day-locks/<YYYY-MM-DD>.lock`; `run_daily_check._run()` returns `SKIP_DUPLICATE_DAY` before any read; `--force-recheck` is accepted only to be **refused** (exit 3) and audited | Second invocation in the same operator-local day performs **no read, no snapshot write, no ledger write** — proven at [E11] and by the pre-existing real-state line in `alerts/alerts.jsonl` [E45]. |
| **R3** | Notify on earnings-balance / account-status change; stay silent otherwise | `changedetect.load_prior_snapshot(day)` → `compare(prior, snapshot)` → `notify.emit_no_change()` (log-only) vs `notify.notify_change()`; `notify.key_seen()`/`record_notified_key()` dedupe index at `state/notified-keys.json`; coalescing at `MAX_NOTIFICATIONS = 5` | No change ⇒ `OK_NO_CHANGE` is written to the alert log and **no notification is dispatched**. Same change re-seen ⇒ `DEDUPED`. >5 changes ⇒ one summary notification instead of N. |
| **R4** | Every external write action is queued for explicit human approval and never auto-executed | `approval_queue.enqueue()` writes a `PENDING` item with `execution_state = "NOT_EXECUTED"` and `execution_allowed_by_this_routine = False` (frozen constants, not parameters); `approval_queue.decide()` requires `--by <human>` and refuses machine identities via `NON_HUMAN_DECIDERS` | The routine **contains no execution code path at all** — deciding an item changes a status field and nothing else; `run_daily_check.py` and every module under `monitoring/freecash/` are scanned by `verify_readonly.py` at [E9]. |

Rule-gate consequence for promotion: **R1 and R2 are hard gates (refuse work). R3 and R4 are output gates (shape what leaves the routine).** A candidate that merely *documents* R1–R4 in a docstring is not promoted.

---

## 2. (a) Data flow

### 2.1 Canonical flow (text diagram)

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │  SCHEDULER   (see §5 — Hermes cronjob OR Task Scheduler)     │
                    │  fires once per day at a fixed local wall-clock time         │
                    └───────────────────────────┬──────────────────────────────────┘
                                                │  argv: python monitoring/freecash/run_daily_check.py
                                                v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 1  DAY-LOCK CHECK                     gate.acquire_day_lock(day)                   │
   │   day   = gate.day_key(now)   # operator-local calendar day, "2026-09-20", via zoneinfo │
   │   lock  = os.open("state/day-locks/<day>.lock", O_CREAT|O_EXCL|O_WRONLY)  # 1 syscall  │
   │                                                                                        │
   │   lock EXISTS  ──► SKIP_DUPLICATE_DAY                                                   │
   │                    • append exactly ONE line to alerts/alerts.jsonl                    │
   │                    • no read · no snapshot · no ledger write · exit 0                  │
   │   lock CREATED ──► continue                                                            │
   │   lock ERROR   ──► fail closed = "do not read" (never a second read)                   │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               │  (day consumed — recorded in state/last-run.json as last_attempt_day)
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 2  READ-ONLY PROVIDER FETCH      (§4 — allowlisted transport only)                 │
   │   source = operator_state (default)   OR   metrics_http                                 │
   │   metrics_http path: readonly_client.read_status_source()                               │
   │        W1 GET  /api/v1/status/metrics   (host must be loopback-allowlisted)              │
   │        W2 HEAD /api/v1/status                                                           │
   │   provider-facing reads W3/W4 are ABSENT BY DESIGN → PROVIDER_ENDPOINT_UNKNOWN           │
   │   on failure: RUN_FAILED → alert · day lock STAYS (no auto-rerun) · exit 5               │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 3  SNAPSHOT LOAD   (BEFORE the new snapshot is written)   —— see §2.2 ——            │
   │   prior = changedetect.load_prior_snapshot(day)                                        │
   │       most recent snapshots/<D>.json with D < day, else None                            │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 4  DIFF            compare(prior, snapshot)                                        │
   │   baseline      : prior is None / has no data  → INITIAL_BASELINE (no change events)    │
   │   no change     : OK_NO_CHANGE           → log-only, NO notification                    │
   │   changes[]     : field, old_value, new_value, change_type, dedupe_key(sha256)          │
   │   degraded      : currency mismatch etc. → MONITOR_DEGRADED alerts                      │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 4b WRITE TODAY'S SNAPSHOT   save_snapshot()  — only after prior has been read       │
   │   snapshots/<day>.json    (written once; never rewritten — path.exists() ⇒ written=False) │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 5  NOTIFY            (R3)                                                          │
   │   for each distinct change: check notify.key_seen(dedupe_key)                            │
   │       unseen → dispatch once (Windows toast via notify._toast_send, STUB fallback)       │
   │       seen   → DEDUPED (log only)                                                       │
   │   + APPROVAL_PENDING notification, + one reminder per item per 7 days (nag_pending)      │
   │   every emission is appended to alerts/alerts.jsonl  (append-only evidence record)       │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 6  APPROVAL QUEUE   (R4)   approval_queue.enqueue(day, change, reason)              │
   │   approvals/pending.json  ← item { status: PENDING, execution_state: NOT_EXECUTED,       │
   │                                    expires_at_utc: null }                                │
   │   *** enqueueing is a notification with a handle — it is NOT a permission ***            │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 7  HUMAN DECISION   (out of band, human-initiated, never scheduled)                 │
   │   python monitoring/freecash/approval_queue.py list                                      │
   │   python monitoring/freecash/approval_queue.py decide \                                  │
   │        --id <approval_id> --decision approve|reject --by "<your name>" --note "<why>"     │
   │   → status APPROVED/REJECTED recorded in approvals/pending.json                          │
   │   → appended to approvals/decided.jsonl (append-only decision trail)                     │
   │   → execution_state REMAINS NOT_EXECUTED.  No routine code consumes APPROVED.            │
   └───────────────────────────┬────────────────────────────────────────────────────────────┘
                               v
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ STEP 8  RECORD OUTCOME   gate.record_outcome(day, outcome, ...)                          │
   │   → state/last-run.json (last_outcome, last_success_day, consecutive_missed_days, tz)    │
   │   → prune_old_artifacts(): snapshots 90d, logs 30d                                       │
   │   exit 0                                                                                 │
   └────────────────────────────────────────────────────────────────────────────────────────┘

   OUT OF BAND, EVERY RUN (before STEP 2):  watchdog / missed-day reconciliation
       gate.missed_days(day, ledger)  →  one MISSED_DAY line per uncovered day
       (a missed day is NEVER back-filled: back-filling = a second read for that day = R2 violation)
       gate.timezone_changed()        →  MONITOR_DEGRADED alert
       gate.timezone_report()         →  if Europe/Berlin is unresolvable, use machine-local zone
                                         and say so loudly instead of pretending
```

**Step ordering is not stylistic.** Day-lock before read (R2 cannot be raced), read before diff (nothing to diff otherwise), **prior-snapshot load before snapshot save** (§2.2), diff before notify (R3 must be evidence-driven), notify before enqueue (the human is told before the queue grows), enqueue before human decision (trivially), outcome recorded last so a crash mid-run leaves the day *consumed* (fail-closed) rather than silently re-runnable.

### 2.2 Why the snapshot MUST be loaded *before* the new snapshot is written

`save_snapshot()` writes to `snapshots/<day>.json` — the *same day-keyed path* that the comparison reads from. If the write happens first:

1. **The prior state is destroyed for the rest of the run.** Whatever the comparison then loads **is the current state**, so `prior == current` for every compared field, `changes[]` is empty, and `OK_NO_CHANGE` is emitted. Rule 3 can never fire — not rarely, *never*, on any input. The monitor becomes a machine that costs a run per day and can only ever say "nothing changed".
2. **The change history is lost, so the failure is permanent and silent.** Because the file is one-per-day and immutable, an overwrite-before-read also destroys the *previous* day's baseline. Even a later ordering fix cannot reconstruct what changed on the day the bug ran: the evidence needed to notice is exactly the evidence the bug overwrote.
3. **It fails in the direction that hides itself.** A wrong order produces a *valid-looking, successful* outcome (`OK_NO_CHANGE`, exit 0) — nothing crashes, nothing logs an error, and the artifact tree looks healthy. This is precisely the shape of the defect the audit found in the repo: `scripts/monitoring/free-cash-daily-check.py` calls `save_snapshot(snapshot_data)` on line 266 and `load_snapshot()` on line 270 [E26][E46] — save-then-load, so R3 is dead code in that file, and the file also writes no artifacts at all because `main()` is never invoked [E3].
4. **It breaks the "one immutable snapshot per day" invariant** that the whole ledger/watchdog design leans on. `save_snapshot()` in the canonical routine returns `(path, written=False)` if the path already exists, so a same-day re-run cannot rewrite history; that guarantee only has meaning if the read happens first.

The canonical routine encodes this at `run_daily_check.py` lines 402–405: `prior = load_prior_snapshot(day)` → `snapshot = build_snapshot(...)` → `verdict = compare(prior, snapshot)` → `save_snapshot(snapshot)` — read, build, compare, *then* persist. Retained as gate G5 in §6.

---

## 3. (b) Artifact contract

**Data root:** `D:/AgenticOS/data/freecash-monitor` (override with `FREECASH_DATA_ROOT` — this is how the test suite keeps its hands off real state). Every path below was observed on disk in this session except where marked. Creation is performed by `paths.ensure_layout()`; writes are atomic (`write_json_atomic` = temp file + `os.replace`) or append-only (`append_jsonl` = single `O_APPEND` write).

| Artifact | Exact path (relative to data root) | Purpose / rule | Shape | Observed? |
|---|---|---|---|---|
| **Day-lock** | `state/day-locks/<YYYY-MM-DD>.lock` | **R2** the gate itself. Zero-byte file; existence == day consumed. Created with `O_CREAT\|O_EXCL\|O_WRONLY`. The *filename* is the day key. | 0 bytes | YES — `2026-09-20.lock` [E21]; created by scratch run [E10] |
| **Ledger / timestamp file** | `state/last-run.json` | Audit + missed-day arithmetic (R2). **Never the gate** — a corrupt ledger cannot cause a second read. | `{schema_version, last_attempt_day, last_success_day, last_attempt_at_utc, last_success_at_utc, last_outcome, consecutive_missed_days, timezone, updated_at_utc}` | YES — `--print-state` [E12] |
| **Snapshot history** | `snapshots/<YYYY-MM-DD>.json` | **R3** baseline. One file per successful day, immutable. | `{schema_version, day_key, captured_at_utc, source{kind,read_ops,data_available,note}, degraded, account_status, earnings_total_cents, balance_cents, pending_cents, currency, raw_response_sha256}` | YES — `2026-09-20.json` [E21]; written by scratch run [E10] |
| **Notification log** | `alerts/alerts.jsonl` | **R3** canonical evidence record. Append-only (`O_APPEND`); never rewritten, so a line can never be lost. | one JSON object/line: `{event_id, event_type, severity, day_key, dedupe_key, message, observed, ts_utc}` | YES — 2 lines [E45] |
| **Dedupe index** | `state/notified-keys.json` | **R3** anti-fatigue. `{keys: {<dedupe_key>: {first_notified_at_utc, delivery}}}`; delivery ∈ `QUEUED/TOAST_OK/STUB_OK/FAILED_TOAST` | JSON object | NOT PRESENT yet (created on first real notification) [E62] |
| **Approval queue** | `approvals/pending.json` | **R4** queue | see §3.1 | not yet populated (0 pending items) [E12] |
| **Decision trail** | `approvals/decided.jsonl` | **R4** append-only human-decision audit | one decided item per line | not yet populated |
| **Audit trail (run)** | `logs/` (e.g. `logs/forced-recheck-requests.jsonl`, `logs/toast-stub.log`) | Every refusal and every stubbed delivery is recorded | JSONL / text | dir exists, empty [E21] |
| **Operator input** | `state/operator-state.json` | The human-entered figures that are the *default* read source while no provider credential exists | `{schema_version, kind, note, how_to[], records[], template_record{day_key, entered_at_utc, account_status, earnings_total_cents, balance_cents, pending_cents, currency}}` | YES [E21] |

### 3.1 Approval queue item — required field spec and implemented names

The delegation spec requires `{id, action, provider, params, createdAt, status}`. The implemented item is a superset; the mapping is exact and must be used when reading the queue:

| Required field | Implemented field (exact) | Notes |
|---|---|---|
| `id` | `approval_id` | UUID4 string |
| `action` | `proposed_action.action_type` | frozen default `"REQUEST_PAYOUT"`; this is a **label for a human decision**, not a callable |
| `provider` | `proposed_action.provider_endpoint` | frozen default `"PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` — kept verbatim so the gap stays greppable |
| `params` | `proposed_action` (whole object) | `{action_type, amount_cents, destination: "OPERATOR_SPECIFIED - not stored by the routine", provider_endpoint}` |
| `createdAt` | `created_at_utc` | ISO-8601 `Z` |
| `status` | `status` | `PENDING` \| `APPROVED` \| `REJECTED` |
| (extra, load-bearing) | `day_key`, `change_dedupe_key`, `reason`, `status_reason`, `decided_at_utc`, `decided_by`, `decision_note`, **`expires_at_utc` (always `null`)**, **`execution_state` (always `"NOT_EXECUTED"`)**, **`execution_allowed_by_this_routine` (always `False`)** | the three bolded fields are frozen constants, not parameters — see §4.3 |

### 3.2 Day keys — calendar days, never raw epoch

**Contract:** every day-scoped artifact is keyed by the **operator-local calendar day** as an ISO date string `YYYY-MM-DD` (the "`toDateString()`" style key the spec asks for, in its ISO form), resolved through `zoneinfo` from `FREECASH_TZ` (default `Europe/Berlin`), via `gate.day_key()`.

Verified: `gate.day_key()` → `2026-09-20`, `tz_name()` → `Europe/Berlin`, `timezone_report()` → `{'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}` [E65]. So on this host the name resolves exactly; no silent degradation.

**Raw epoch milliseconds are forbidden as a day key** — and this is a live defect in the repo, not hypothetical: `server/tasks/last_run_time.json` holds the bare float **`1789847478.493505`** (17 bytes) and `server/tasks/daily-finance-monitor.py` computes `datetime.now().timestamp() - float(open(path).read()) > 86400` on it [E6][E29][E30]. Consequences: the value is unreadable to a human reviewing the audit trail; it encodes no timezone, so it silently changes meaning across a DST boundary or a machine-clock change; a 24-hour rolling window is **not** a calendar day (two runs can land in one calendar day after a host clock/timezone shift, and a run at 23:55 followed by the next at 00:05 is refused even though it is a new day); and a truncated/corrupt float yields a silently wrong answer instead of a refusal. `toDateString()`-class keys have none of these properties. Any candidate promoted later must be re-keyed before it is scheduled.

---

## 4. (c) Read-only interceptor design

Rule 1 in this routine is **not** a comment saying "read-only". It is three layers, two of which are in-code enforcement and one of which is CI.

### 4.1 Layer A — allowlists in the only network path (`monitoring/freecash/readonly_client.py`)

Deny-by-default. Every request goes through `request(method, url, **kw)`; the guard runs **before** `_transport()` — the single function in the whole routine that opens a socket.

```
ALLOWED_METHODS = frozenset({"GET", "HEAD"})                       # verbs
ALLOWED_HOSTS   = frozenset({"localhost","127.0.0.1","::1","[::1]"}) # loopback only
ALLOWED_PATHS   = ( re.compile(r"^/api/v1/status/metrics$"),        # path prefixes/regexes
                    re.compile(r"^/api/v1/status$") )
BODY_KEYWORDS   = ("data","json","files","body","content")          # bodies refused on any method
```

Guard order and refusals (`ForbiddenWriteError`, raised pre-socket):

1. `method` not a string → refuse
2. `verb = method.strip().upper()` not in `ALLOWED_METHODS` → refuse (`POST`/`PUT`/`PATCH`/`DELETE` can never reach the wire)
3. any body keyword present → refuse
4. **any other keyword argument at all** → refuse (`if kw: raise`) — the signature cannot be widened by a caller without tripping the guard
5. scheme not `http`/`https` → refuse
6. `parts.hostname.lower()` not in `ALLOWED_HOSTS` → refuse *(an unresolvable provider host cannot be reached even if a caller passes one)*
7. `parts.path` matching **no** allowlisted regex → refuse
8. `headers` not a mapping → refuse

Non-allowlisted path ⇒ refusal, not a 404. Provider read paths (`W3`/`W4` in the module docstring) are **deliberately absent** from `ALLOWED_PATHS`; the placeholder `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` is kept verbatim so the gap stays greppable rather than being filled in with an invented endpoint.

**Why loopback-only is the strongest part of this design:** today the routine has no provider credential and no confirmed provider read contract. A host allowlist of loopback means a future edit that "just adds the provider URL" fails closed until a human deliberately widens `ALLOWED_HOSTS` *and* `ALLOWED_PATHS` in a reviewed diff. The default answer to "can this routine talk to the internet?" is **no**.

### 4.2 Layer B — process-wide audit hook (`install_audit_guard()`)

`readonly_client.install_audit_guard()` is called first thing in `run_daily_check._run()` and installs a `sys.addaudithook` that inspects `socket.connect` and `socket.getaddrinfo`. A connect or resolution aimed at a host outside `ALLOWED_HOSTS` raises `ForbiddenWriteError` **inside the interpreter, at the syscall boundary** — so a *third-party* library (requests, urllib3, a stray SDK) imported later in the process cannot open an outbound connection either. Layer A polices this routine's own API; Layer B polices everything sharing the process. The install is idempotent and never raises (a hook failure must not take down the routine — it is defence in depth, not the primary gate).

### 4.3 The R4 analogue — execution_state as a frozen constant

The same "enforcement, not intent" shape applies to Rule 4. In `approval_queue.build_item()` the three fields that could ever turn a queue item into an action are **literal constants inside the returned dict**, not parameters and not derived from input:

```python
EXECUTION_ALLOWED_BY_THIS_ROUTINE = False
NO_EXPIRY = None
...
"expires_at_utc": NO_EXPIRY,
"execution_state": EXECUTION_STATE_NOT_EXECUTED,          # "NOT_EXECUTED"
"execution_allowed_by_this_routine": EXECUTION_ALLOWED_BY_THIS_ROUTINE,
```

`decide()` therefore cannot change what happens next, because *nothing happens next*: no module in `monitoring/freecash/` reads an `APPROVED` status to do anything with it. An approved item is a recorded human decision; the actual action (if any) is outside this routine entirely and outside its authority. Also `NON_HUMAN_DECIDERS` makes `decide --by` refuse machine identities — a decision must name a person.

### 4.4 Layer C — CI grep for forbidden tokens (`monitoring/freecash/verify_readonly.py`)

A six-class token scanner run over the routine's tree. Classes (from `FORBIDDEN_PATTERNS`):

| Label | What it catches |
|---|---|
| `http-verb` | `\b(POST\|PUT\|PATCH\|DELETE)\b` (case-insensitive) |
| `write-call-shape` | `.post(`/`.put(`/`.patch(`/`.delete(`, `requests.post/put/patch/delete`, `axios.post/put/patch/delete`, `fetch(…method:"POST")`, `http.client`, `urllib.request.urlopen`, `urlopen(`, `socket.socket(`, `curl -X POST/DELETE`, `curl -d/--data/--upload-file` |
| `earning-verb` | `claim\|withdraw\|withdrawal\|cashout\|cash_out\|cash-out\|redeem\|payout\|pay_out\|transfer\|wager\|bet\|spin\|deposit\|purchase\|checkout` |
| `earning-action` | `submit_offer\|complete_survey\|complete_task\|start_task\|accept_offer\|claim_reward\|redeem_reward\|request_payout` |
| `write-endpoint-path` | `/claim\|/withdraw\|/cashout\|/redeem\|/payout\|/transfer\|/bet\|/spin\|/deposit\|/checkout` and `/offers/<x>/claim`, `/surveys/<x>/complete`, `/tasks/<x>/complete`, `/rewards/claim` |
| `account-mutation` | `update_balance\|set_balance\|credit_account\|debit_account` |

**Enforcement semantics that make it a gate rather than decoration:**

- **Exemption is explicit, line-scoped and greppable.** A hit is allowed only if the same line carries the marker `readonly-exempt:`. Each exemption is a deliberate, reviewable decision — *not* a path or directory exclusion. The scanner's own pattern table carries the marker on every line because scanning itself would be self-referential.
- **It fails closed on an unreadable target.** `missing_targets` is reported and non-zero exits non-zero — you cannot pass by pointing the scanner at nothing.
- **It is run as a step, not as advice.** Verified this session: `python monitoring/freecash/verify_readonly.py` → `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` / `[verify_readonly] PASS - no unexempted write/earning token found.` exit 0 [E9]. 28 exempt hits are all in the scanner's own table and in the negative-path tests that assert refusals — exactly what should be exempt.
- **Cross-check observed across the seven candidates** [E18]: scanning the six named implementations for the delegation's token list gives `/transactions` = 0, `/cashout` = 0, `method: 'POST'/'PUT'/'PATCH'` = 0, `DELETE` = 0, `requests.post/put/delete` = 0, `fetch(...POST` = 0, and `withdraw` = 4 — of which 3 are in `scripts/make_freecash_check.py` (`available_to_withdraw`, `"type": "withdraw"`, and an action labelled `Withdraw $N`) and 1 is a docstring in `freeCashExecutor.ts` ("no withdrawals"). So the only withdraw-shaped code in the monitored set is in a script that is *not* scheduled and does not run [E4].

**CI wiring (recommended, not yet present):** add to the repo's test gate
`python monitoring/freecash/verify_readonly.py || exit 1`, and a pure-token grep over any file added to the scheduled path:
`grep -rnE '\b(POST|PUT|PATCH|DELETE)\b|/transactions|/cashout|withdraw' <scheduled-path> || true` — with the exit status used, not eyeballed.

---

## 5. (d) The once-per-day gate, and how it is scheduled

### 5.1 The gate as code-shaped pseudocode (Windows-correct)

Windows has no `fcntl.flock`. `O_CREAT|O_EXCL` **is** an atomic create on NTFS, so the lock is a single syscall with no check-then-act window. This is the shape to use:

```python
# gate.py — R2: exactly one status read per operator-local calendar day.
# Windows-correct: os.open(..., O_CREAT|O_EXCL) is atomic on NTFS; no flock needed.
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TZ = "Europe/Berlin"

def zone(spec=None):
    """Operator wall-clock zone. Never raises: falls back to the machine's own zone."""
    name = spec or os.environ.get("FREECASH_TZ") or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError, KeyError):
        return datetime.now().astimezone().tzinfo or timezone.utc   # system-local, reported as DEGRADED

def day_key(now=None, tz=None) -> str:
    """Calendar-day key 'YYYY-MM-DD' (NOT epoch ms) in the operator's local zone."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(zone(tz)).date().isoformat()

def lock_path(day):                     # state/day-locks/<YYYY-MM-DD>.lock
    return DATA_ROOT / "state" / "day-locks" / f"{day}.lock"

def acquire_day_lock(day):
    """Consume `day`. Returns (acquired, path). FAIL CLOSED on any error."""
    lock = lock_path(day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)   # atomic create
    except FileExistsError:
        return False, lock          # day already consumed -> caller does NOTHING further
    except OSError:
        return False, lock          # <-- fail CLOSED: an unusable lock means "do not read"
    os.close(fd)
    return True, lock
```

and the caller, in order, with each branch's rule consequence made explicit:

```python
def run(argv=None, now=None):
    day = gate.day_key(now)                      # "2026-09-20"
    acquired, lock = gate.acquire_day_lock(day)

    if not acquired:                             # R2 second run in the same day
        notify.alert("SKIP_DUPLICATE_DAY", day,
                     f"Day {day} already consumed (lock {lock.name}). "
                     "Duplicate run performed no read and wrote no snapshot.",
                     severity=notify.SEVERITY_INFO, observed={"lock": str(lock)})
        return 0                                 # exit 0: a duplicate is NOT an error

    # --- day is consumed; everything below is at most once per day ---
    ledger = gate.load_ledger()                  # corrupt/missing ledger never blocks the run
    for missed in gate.missed_days(day, ledger): # never back-filled (a back-fill = a 2nd read)
        notify.notify_change(day, missed_change(missed), ..., key=dedupe(...))
    if gate.timezone_changed(ledger):
        notify.alert("MONITOR_DEGRADED", day, "Timezone changed since the last run ...")
    ledger = gate.record_attempt(day, now, ledger)   # KEEP the returned ledger

    try:
        raw = read_source(source_kind, day)      # §4 allowlisted transport ONLY
    except (ReadError, ForbiddenWriteError) as exc:
        gate.record_outcome(day, "READ_FAILED", now, ledger)
        return 5                                 # lock STAYS; NO automatic re-run, ever

    prior    = changedetect.load_prior_snapshot(day)   # 1) READ prior
    snapshot = changedetect.build_snapshot(day, raw_payload, source)
    verdict  = changedetect.compare(prior, snapshot)   # 2) DIFF
    changedetect.save_snapshot(snapshot)               # 3) WRITE only after the read (§2.2)

    if not raw["data_available"]:        notify.alert("MONITOR_DEGRADED", ...)
    elif verdict["baseline"]:            notify.emit_initial_baseline(day, ...)
    elif not verdict["changes"]:         notify.emit_no_change(day, ...)   # log-only, SILENT
    else:                                notify_changes(day, verdict["changes"], ...)  # R3
                                         approval_queue.enqueue(...)                   # R4
    nag_pending(day, now)                # <= 1 reminder per item per 7 days
    gate.record_outcome(day, outcome, now, ledger, missed=len(missed))
    return 0
```

Rules the pseudocode encodes, stated as invariants: **(i)** the lock is attempted before anything else and its failure is fail-closed; **(ii)** the ledger is never the gate; **(iii)** `--force-recheck` is *refused* (exit 3) and the refusal is written to `logs/forced-recheck-requests.jsonl` — "no manual re-check" is a decision, not an omission; **(iv)** a failed read leaves the lock in place so the day is *not* silently retried (no retry loop, no backoff, no watchdog auto-run); **(v)** the prior snapshot read precedes the snapshot write.

Verified end-to-end on a clean state root [E10][E11]:

```
$ FREECASH_DATA_ROOT=…/scratch/proof-A python monitoring/freecash/run_daily_check.py
RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)
       snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0
       reminders=0 lock=2026-09-20.lock          (exit 0)
$ FREECASH_DATA_ROOT=…/scratch/proof-A python monitoring/freecash/run_daily_check.py
SKIP_DUPLICATE_DAY 2026-09-20                    (exit 0, no new artifacts: 5 files before and after)
```

### 5.2 Scheduler wiring — Option A: Hermes cronjob (available on this machine)

Available and live: `hermes --version` → v0.21.3 [E32]; `hermes cron status` → `✓ Gateway is running — cron jobs will fire automatically · PID 34428 · Ticker heartbeat: 18s ago` [E37]; `C:/Users/cd-pr/AppData/Local/hermes/cron/` contains `ticker_heartbeat` and `ticker_last_success` both stamped seconds ago, plus `executions.db` [E11b][E38]. **`hermes cron list` currently shows `No scheduled jobs.`** [E16][E35] — nothing is wired.

**Timezone:** no cron timezone is configured in `C:/Users/cd-pr/AppData/Local/hermes/config.yaml` (no `timezone`/`tz` key; `hermes_time.get_timezone()` returns `None` = server-local) [E71][E72][E73]. The machine's own zone is `+0200` = **Europe/Berlin (CEST)** [E40]. Therefore a `0 9 * * *` schedule fires at **09:00 machine-local = 09:00 Europe/Berlin**, and the OS owns the CET/CEST switch. The routine's own day key is `Europe/Berlin` too [E65], so scheduler wall clock and day-key boundary agree all year. If you want the binding to be explicit rather than implied, set the timezone in Hermes config (or `TZ=Europe/Berlin` for the job) — but do **not** leave both sides implicit and then debug a 1-hour offset in late March.

**Command line** (the script path must live under the Hermes scripts dir — that dir **does not exist yet**, observed [E36], so it must be created first):

```bash
# 1. create the scripts dir (one-time)
mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"

# 2. wrapper — placed at C:/Users/cd-pr/AppData/Local/hermes/scripts/freecash-daily-monitor.sh
#    (content in §5.2.1; it is the routine's ONLY scheduler-facing surface)

# 3. create the job  --no-agent => NO LLM in the loop, so R1 cannot be violated by an agent
hermes cron create "0 9 * * *" \
  --name "FreeCash daily status monitor (read-only)" \
  --workdir "D:/AgenticOS" \
  --no-agent \
  --script freecash-daily-monitor.sh \
  --deliver telegram

# 4. verify
hermes cron list
hermes cron runs   --name "FreeCash daily status monitor (read-only)"
hermes cron doctor
```

Notes that matter for the rules:

- `--no-agent` is **required**. It means "skip the LLM entirely — run the script on schedule and deliver its stdout". With an agent in the loop, an LLM would be choosing what to do near a financial account; R1/R4 are far more credible when there is no model in the execution path at all.
- `--script` runs `.sh`/`.bash` via bash and everything else via Python; stdout is delivered **verbatim**, and **empty stdout = silent** — which is exactly the R3 "no notification fatigue" contract: the wrapper prints only when a human needs to hear something (§5.2.1).
- `--monitor-script` is the *alternative* shape (cheap script each tick; unchanged exact-bytes output suppresses the agent run entirely; changed output injects a diff). It requires **stable output with no timestamps**, which our routine's stdout satisfies within a day (`RUN_OK 2026-09-20 outcome=…`) — but for a `--no-agent` daily job the plain `--script` form is simpler and equally rule-safe. Do not combine `--no-agent` semantics with `--monitor-*`: they are mutually exclusive.
- `--deliver` chooses the channel (`origin`, `local`, `telegram`, `discord`, `signal`, `platform:chat_id`). Pick the channel the human actually reads; `local` suppresses delivery of successes.
- The once-a-day guarantee is enforced by the **routine's day lock**, not by the scheduler. A missed tick (machine asleep) therefore does not produce a second read later that day; it produces a `MISSED_DAY` line the next time the routine does run — which is the correct, auditable behaviour.

#### 5.2.1 Wrapper script (design; **not yet created** — `C:/Users/cd-pr/AppData/Local/hermes/scripts/` does not exist [E36])

```bash
#!/usr/bin/env bash
# freecash-daily-monitor.sh — scheduler-facing wrapper for the canonical routine.
# prints NOTHING when nothing needs a human (Hermes --no-agent: empty stdout = silent).
set -u
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"  # the interpreter that HAS tzdata
ROUTINE="D:/AgenticOS/monitoring/freecash/run_daily_check.py"
cd "D:/AgenticOS" || exit 1
export FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"
export FREECASH_TZ="Europe/Berlin"
out="$("$PY" "$ROUTINE" 2>&1)"; code=$?

case "$out" in
  *SKIP_DUPLICATE_DAY*)  exit 0 ;;                       # already consumed today: silent
  *READ_FAILED*|*RUN_FAILED*) printf '%s\n' "$out"; exit 0 ;;   # tell the human, loudly
  *notifications=0*approvals=0*)                         # nothing changed: silent (R3)
      case "$out" in *MONITOR_DEGRADED*) printf '%s\n' "$out" ;; esac
      exit 0 ;;
  *) printf '%s\n' "$out" ;;                             # anything else: report
esac
exit 0
```

`READ_FAILED` exits the *routine* with 5 but the wrapper still returns 0 so the scheduler does not build up a "failed job" history for a designed, auditable refusal — the alert log is the record. The interpreter path is pinned deliberately: `python` on PATH is the Hermes venv python, which **has** `tzdata`; the ambient system Python does **not** [E63][E69], and without `tzdata` `ZoneInfo("Europe/Berlin")` is unresolvable and the routine degrades to `system-local` [E64][E73] — correct behaviour, but avoidable noise.

### 5.3 Scheduler wiring — Option B: Windows Task Scheduler

`schtasks` is present at `C:\WINDOWS\system32\schtasks.exe` [E39]. Task Scheduler runs in the user session, inherits the OS time zone (**automatically CET↔CEST**), and needs no Hermes gateway or shell profile.

```bat
schtasks /Create ^
  /TN "FreeCash\DailyStatusMonitor" ^
  /SC DAILY /ST 09:00 ^
  /TR "\"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe\" \"D:\AgenticOS\monitoring\freecash\run_daily_check.py\"" ^
  /F
```

- **Interpreter is pinned absolutely** because a Task-Scheduler action does not inherit the bash PATH: the venv python above is the one with `tzdata` [E63][E69].
- `/SC DAILY /ST 09:00` uses the machine's **local wall clock**; Windows applies the CET/CEST change itself, and 09:00 local is inside the same `Europe/Berlin` calendar day either side of the switch — so the day-key boundary and the run time never disagree.
- Set **"Run task as soon as possible after a scheduled start is missed"** (`StartWhenAvailable`) so a sleeping laptop still gets its one check that day; because the day lock is atomic, the catch-up run cannot become a second read.
- Environment (data root, TZ, read source) must be supplied by the **wrapper**, not by shell exports — a `schtasks` action with a bare `python.exe` inherits no bash environment. Point `/TR` at the same `freecash-daily-monitor.sh` (via `bash.exe`) or at a `.cmd` twin that sets `FREECASH_DATA_ROOT` and `FREECASH_TZ` before invoking python.
- Verify with `schtasks /Query /TN "FreeCash\DailyStatusMonitor" /V /FO LIST` and `schtasks /Run /TN "FreeCash\DailyStatusMonitor"` for a manual trial — then confirm the trial was *refused* as a duplicate if the day is already consumed, which is the whole point.

### 5.4 Option A vs Option B

| | Hermes cronjob | Windows Task Scheduler |
|---|---|---|
| Present & live on this machine | YES — gateway running, ticker heartbeating [E32][E37] | YES — `schtasks` present [E39] |
| LLM in the execution path | none with `--no-agent` | none |
| Delivery/notification built in | yes (`--deliver`, `--continuity`, run history, incidents) | no (routine's own toast + `alerts.jsonl`) |
| DST handling | OS local clock (no cron TZ configured) [E71] | OS local clock, explicit |
| Survives: laptop asleep / gateway stopped | missed tick → `MISSED_DAY` next run | `StartWhenAvailable` catch-up |
| Audit surface | `executions.db`, `hermes cron runs/history/incidents` | Task Scheduler history |
| Recommended | **yes, primary** | fallback / second opinion |

Use one, not both. Two schedulers means two tick sources racing for the same day lock — the lock makes that *safe* (one wins, the other prints `SKIP_DUPLICATE_DAY`), but it doubles the audit noise for no benefit.

---

## 6. Gate checklist (bind a promotion to these)

| # | Gate | Pass condition | Evidence | Status |
|---|---|---|---|---|
| G1 | R1 interceptor exists in code | verb+host+path+body allowlists in a single `request()` guard, one socket site, plus a process audit hook | `readonly_client.py` §4.1–4.2 | ✅ in canonical |
| G2 | R1 CI scanner passes | executor with an **exempt** count of 0 unexempted hits, `missing_targets=0` | [E9] `forbidden=0 exempt=28 missing_targets=0` | ✅ in canonical |
| G3 | R2 gate is an atomic consume, not a check-then-act | `O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock`; fail **closed** | [E10][E11] | ✅ in canonical |
| G4 | R2 no manual re-check | `--force-recheck` refused (exit 3) + audited to `logs/forced-recheck-requests.jsonl` | `run_daily_check.py` §5.1 | ✅ in canonical |
| G5 | R3 prior snapshot loaded **before** snapshot save | `load_prior_snapshot` precedes `save_snapshot` in the run path | [E55] source order; §2.2 | ✅ in canonical; ❌ in `free-cash-daily-check.py` [E46] |
| G6 | R3 silence when unchanged | `emit_no_change` writes to the alert log only; no dispatch; dedupe key recorded | [E10] `changes=0 notifications=0` | ✅ in canonical |
| G7 | R3 anti-fatigue | dedupe index + coalescing >5 + ≤1 reminder/item/7d | §1 R3 row | ✅ in canonical |
| G8 | R4 queue, never execute | `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False`, no consumer of `APPROVED` | §4.3 | ✅ in canonical |
| G9 | R4 human-decision audit | `decide --by <human>` refuses machine identities; decision appended to `decided.jsonl` | §4.3 | ✅ in canonical |
| G10 | Day keys are calendar strings | `YYYY-MM-DD`, never epoch | [E65]; violation found at [E29] | ✅ in canonical |
| G11 | Suite green | `run_all.py` reports 0 failures / 0 errors | [E8] `tests=52 failures=0 errors=0 skipped=0` | ✅ in canonical |
| G12 | Wired to exactly one scheduler | one job exists and its runs are visible | [E16][E35] `No scheduled jobs` | ❌ **NOT WIRED** |

---

## 7. (e) Reality check — implementation files

`RUNS?` means: **a command was executed in this session and its observed output is recorded.** Anything not executed is marked NOT PROVEN and never promoted.

### 7.1 The six files named in the delegation

| File | RUNS? (command → observed) | RULE GAPS | Verdict |
|---|---|---|---|
| **`server/scripts/freecash-daily-monitor.mjs`** (326 lines) | **NO.** `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` at line 41 `function isDailyCheckAllowed(): boolean {`, exit 1, node v24.20.0 [E1]. The file has never executed: `require()` inside a `.mjs`, TS annotations on 6 signatures, and bare TS types `Promise<void>`/`ChangeAlert[]`. | R2 gate is never reached. Even if it parsed: the outer entry point gates on `CHECK_TIMESTAMP_FILE + '.today'`, a file nothing in the repo ever creates, so the real day-check is bypassed; `checkForChanges()` reads `existing.status?.balance` from the *timestamp* file, which only ever holds `{date, checkedAt, checkNumber}` ⇒ `status` is always `undefined`, so R3 can only ever report `INITIAL_CHECK`; `prepareActionRequests()` builds `existingRequests.requests.push(...)` and then **returns without writing** — the R4 queue is never persisted; no interceptor/allowlist of any kind; host is derived by string-splitting a URL. | **PARK** — superseded; not a promotion candidate. If it must become the entry point, it is a FIX with a rewrite of the gate, the diff source, and the queue write. |
| **`scripts/monitoring/free-cash-daily-check.py`** (294 lines) | **NO — and it looks like it passed.** `python scripts/monitoring/free-cash-daily-check.py` → **zero output, exit 0** [E3]. `ast.parse` → PARSE-OK [E10b]. `main()` is defined at line 225 and **never called**: there is no `if __name__ == "__main__":` guard anywhere in the file [E26]. Nothing is created: `data/monitoring/` does not exist [E7]. | R2 gate never executes. **R3 is structurally dead: `save_snapshot(snapshot_data)` at line 266 runs *before* `load_snapshot()` at line 270** — the exact load-order defect of §2.2 [E46]. R4 is a comment placeholder ("implemented by user before deploy") with no queue artifact. `load_last_run()` reads a file nothing writes. `save_snapshot()` derives its directory from `Path(data["snapshot_timestamp_utc"]).parent` — a timestamp string, so the parent is `'.'`. The exit-0-with-no-output shape is the most dangerous failure mode here: any harness that checks only exit status reports this monitor as healthy. | **DELETE proposed** — requires human approval. It cannot run, produces no artifact, and its exit 0 is actively misleading. Until decided: PARK and never schedule. |
| **`server/tasks/daily-finance-monitor.py`** (330 lines) | **YES.** `python server/tasks/daily-finance-monitor.py --simulate-notification` → `[2026-09-20 21:31:41] Daily check skipped (run within last 24h)`, exit 0 [E5]; a scratch copy executed the full path → `Daily Finance Status Monitor starting … Running in SIMULATE mode … ✓ Daily check complete; no external actions triggered … Daily routine finished (checks=0, approve_needed=False)`, exit 0, creating `last_run_time.json` (17 bytes) + `daily_monitor.log` [E6]. | **R2 is the wrong shape:** the "day" is `now.timestamp() - float(last_run_time.json) > 86400` — a **raw epoch float** rolling 24 h window, not a calendar day [E29][E30]. Raw epoch is unbounded by any timezone, so a clock/DST shift can admit two reads in one calendar day. **R3 can never fire:** `compare_with_last_check()` reads `last_status.json`, which the script never writes [E46b]; the notify branch fires only when `change_count == 1` **exactly** (`if change_count == 1`), so 0 or ≥2 changes are silently not notified. `needs_approval` is `any('payout' in account_name ...)` — it inspects the *account's name*, not the action. **R4 is a blocking `input()` prompt**, which in a scheduler context has no TTY: the routine either hangs or gets EOF, with no queue artifact to fall back on. SQL at line 74 is malformed (`SELECT a.id, name,.balance AS …`) and row access uses `acc['balance']` on `sqlite3` tuples — exceptions are swallowed into `status: 'unknown'`, so the comparison is comparing nothing. | **FIX** — the only candidate that executes today via a scheduler-safe surface, but the day key, the diff source, the notify condition and the approval step all need replacing. Do not schedule it before then. |
| **`finance-monitor/*`** (350-line `__init__.py` + `src/`, `config/`, `docs/`, `tests/`) | **NO.** `python finance-monitor/__init__.py` → `Traceback … from src.rule_engine import RuleEngine` → `File "D:\AgenticOS\finance-monitor\src\rule_engine.py", line 122` → `SyntaxError: f-string: invalid syntax. Perhaps you forgot a comma?`, exit 1 [E7]. The package has a real `MonitorOrchestrator`, a `WaitGate`, `NotifyManager` and an `ActionExecutor` in `src/` [E28], so the design intent is there — it just does not compile. | R2 exists as a "flag file" design but is unreachable. R1/R4 rest on `WaitGate` — unproven, and `ActionExecutor`/`api_client.simulate_action` are sandbox stubs, so "no auto-execution" is currently true only because the code cannot run. `.VERIFIED.md` / `.COMPLETION_REPORT.md` / `.delivery_status.json` claim an audit-ready prototype [E26b] — those claims are not reproducible today [E7]. | **FIX** (repair the f-string, then run `tests/test_rule_enforcement.py`) — or **DELETE proposed** if the canonical routine is adopted, since it duplicates R1–R4 with a second, divergent design. |
| **`server/src/adapters/freecashMonitorAdapter.ts`** (223 lines) | **NOT PROVEN.** Deliberately not executed (TS source under `src/`, hard constraint: do not modify; and no runtime registration to reach it through). What *is* verified: `grep -rn freecashMonitorAdapter server/src` shows it is imported by exactly `turnController.ts:24` and `operatorController.ts:4`, and `server/src/index.ts` registers only **`HermesAdapter, JarvisAdapter, CodexAdapter, VideoAdapter, HeavyGenAdapter`** (lines 141–145) — the adapter is **absent from the runtime registry**, so nothing reaches it through the runtime path [E19]. | `fetchStatus()` returns a hardcoded literal — `earnedToday: 0, statusAlerts: [], requiresApproval: [], externalConnected: false`, plus the message "External FreeCash API connection is not configured" [E37b]. Consequences: **R3 cannot fire** (`statusAlerts` is always `[]`, so `evaluateRules`' `statusAlerts.length > 0` branch is never entered); **R2 is not a gate** — the only "day" logic is `new Date().toDateString()` and a `prompt.includes('double-check')` string check, with no lock artifact and no ledger; **R4 has no queue** — `requiresApproval` is a typed field that is never populated; **R1 is trivially satisfied by doing nothing**, with no interceptor. Its `health()` reports `status: 'healthy'` unconditionally. | **PARK** — do not promote: wiring it would create a second, unledgered "monitor" with no day lock and no approval queue, and its `toDateString()` day key is not a lock. Wire it to the canonical routine *only* if the Jarvis UI genuinely needs a status surface. |
| **`server/src/services/freeCash/freeCashExecutor.ts`** (419 lines) | **NOT PROVEN.** Not executed — it drives a browser page (`withFreeCashPage`, `detectSession`, `startInteractiveLogin`) and needs a real provider login, which does not exist (see §8). What *is* verified: it **is** wired at startup — `server/src/index.ts:398` imports `reconcileGoalsOnStartup` from it and calls it in a try/catch logging `[FreeCash] startup goal reconciliation failed` [E13]; and the read-only token scan finds no write verbs in it — the single `withdraw` hit is a docstring: "external account: no withdrawals, no offers, no identity actions" [E18]. | No day-lock, no ledger, no snapshot, no diff, no approval queue — it is a session/goal *driver*, not a monitor; so R2/R3/R4 are simply out of its scope and must not be attributed to it. Real gaps: `startInteractiveLogin()` implies a browser session, so an automated *login* is itself an external interaction whose read-only status is a policy decision, not a code fact; its functions are unreachable-by-audit until a credential exists. | **PARK** — blocked on a provider credential and a human decision on whether an automated login is permitted at all. Keep the read-only docstring and the absence of write tokens as preconditions, not as proof. |

### 7.2 Adjacent implementations found during this audit (same rule surface, not in the delegation list)

| File | RUNS? | RULE GAPS / ROLE | Verdict |
|---|---|---|---|
| **`monitoring/freecash/`** (`run_daily_check.py`, `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `readonly_client.py`, `operator_state.py`, `paths.py`, `watchdog.py`, `verify_readonly.py`, `tests/`) | **YES.** `python monitoring/freecash/tests/run_all.py` → `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 [E8]. `python monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit 0 [E9]. Real run on a clean root → `RUN_OK … written=True` + 5 artifacts; immediate second run → `SKIP_DUPLICATE_DAY`, no new files, exit 0 [E10][E11]. `--print-state` → ledger with `last_outcome MONITOR_DEGRADED`, `timezone Europe/Berlin` [E12]. `gate.timezone_report()` → `kind: 'zoneinfo', available: True` [E65]. | Implements R1–R4 as gates (§1, §4), day-lock + ledger, load-before-save diff, dedupe+coalesce notification, queue with frozen `NOT_EXECUTED`. Gaps: (i) **not scheduled** — `hermes cron list` → no jobs [E16][E35]; (ii) its only *data* source today is `operator-state.json`, which has **zero records**, so every real run is `MONITOR_DEGRADED` by construction [E21]; (iii) provider read paths `W3/W4` absent by design (`PROVIDER_ENDPOINT_UNKNOWN`) [E28b]; (iv) `state/notified-keys.json` and `approvals/pending.json` are empty/absent because no change has ever been detected on real state. | **PROMOTE** — this is the canonical routine. Next steps are wiring (§5) and a data source (§8), not code. |
| `monitoring/freecash/watchdog.py` | **YES** — `python monitoring/freecash/watchdog.py` → `WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=MONITOR_DEGRADED`, exit 0; `alerts/alerts.jsonl` unchanged (2 lines, mtime 21:08:01, before this run) [E22][E61][E62]. | Read-only coverage check + missed-day coverage notification; correctly stayed silent on a covered day. Keep it, but **never** let it re-run the daily check (that would be a second read). | **PROMOTE** (as part of the canonical routine) |
| `scripts/make_freecash_check.py` (99 lines) | **YES-ish but broken.** `python scripts/make_freecash_check.py` → `Error: [Errno 2] No such file or directory: 'D:\data\freecash\state.json'` then `No actions available.`, **exit 1** [E4]. Root cause: `BASE = Path(__file__).resolve().parents[2]` → `D:\` (repo is `D:\AgenticOS`, so `parents[1]` was meant) ⇒ `D:\data\freecash` does not exist [E7b]. | Contains the repo's only `withdraw`-shaped code: `prepare_actions()` builds `{"name": f"Withdraw $…", "type": "withdraw"}`, and `prompt_approve()` gates it on an interactive `input()` [E18]. `run_action()` is a stub that returns `True, True` — an execution-shaped function with no execution, which is fine *only as long as it stays a stub*. It has no snapshot, no diff and no notification ⇒ R3 absent. It does have a proper `if __name__ == "__main__": sys.exit(main())` guard, unlike candidate #3. | **PARK** — not scheduled, not a monitor. Its day key is a UTC `%Y-%m-%d` string (good shape) and its `state.json` day-gate is a check-then-act (bad shape). **DELETE proposed** (it is the only file that names a withdrawal action) — human approval required. |
| `scripts/approval_gate.py`, `scripts/notification_service.py`, `scripts/resolve-approval.cjs` | **NOT PROVEN** — not executed in this session. | Found by path search [E42][E43]; role not audited. Any of them may already implement R3/R4 delivery outside `monitoring/freecash/`. Must be audited *before* two approval systems are allowed to coexist. | **PARK pending audit** — do not wire; do not delete. |
| `server/tasks/last_run_time.json` + `server/tasks/daily_monitor.log` | **YES** — read directly: `1789847478.493505` (raw epoch, 17 bytes, mtime Sep 19 21:51) and a log whose tail shows `Daily routine finished (checks=0, approve_needed=False)` and `Daily check skipped (run within last 24h)` twice [E6]. | Artifacts of candidate #4. The epoch-float day key is the contract violation called out in §3.2. The log duplicates what `alerts.jsonl` should be the single source for. | **FIX** — either retire these paths or re-key to ISO calendar days; do not add a third log. |

**Attribution note on the *known-good* claim.** `optional-skills/serverops/automated-status-monitor/SKILL.md` names `server/scripts/freecash-daily-monitor.mjs` as the "known-good entry point" and tells the reader to copy it as a template. This session proves it cannot parse [E1] and that its "verifier" certifies it anyway [E2]. Any plan or doc built on that skill's "known-good" line is built on a file that has never run. The skill's own Pitfalls section already warns about this; the Quick Reference line above it still contradicts it — that inconsistency is the highest-value documentation fix in this area.

---

## 8. (f) BLOCKED — cannot proceed without a credential or a human decision

Each item states exactly what is missing and who/what unblocks it. None of these may be resolved by guessing, inventing an endpoint, or creating a credential-shaped placeholder.

| # | Blocked item | Blocker | Unblocked by |
|---|---|---|---|
| **B1** | Any **provider-facing read** (`W3`: balance/earnings status; `W4`: account status) | No provider read contract is known, and no credential exists. `.env` contains only `JARVIS_SUPERVISOR_V2, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_FALLBACK_MODEL, DEFAULT_LLM_PROVIDER, DEFAULT_LLM_MODEL, GATEWAY_PROVIDER_ORDER` — **no cash-provider key of any kind** [E17]. The routine encodes the gap deliberately as `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` [E28b]. | **Human decision**: *which* provider, *which* read endpoints, and a read-only credential scoped to reads. Until then the only honest source is `state/operator-state.json`. |
| **B2** | Widening the interceptor's `ALLOWED_HOSTS` / `ALLOWED_PATHS` beyond loopback | By design (§4.1) the allowlists are loopback + two local status paths. A provider host cannot be added without a reviewed code change; that is the point. | **Human decision** on B1 first, then a reviewed diff adding one path per line **with a justification comment** (per `readonly_client.ALLOWED_PATHS`). |
| **B3** | A **meaningful, non-degraded** daily reading | `state/operator-state.json` has `"records": []` — zero operator-entered records — so `data_available` is false and every real run is `MONITOR_DEGRADED`; the diff machinery has never been exercised end-to-end on real data [E21]. | **Human action**: the human logs into their own account in their own browser and appends one record per the file's own `how_to` (integer cents, `entered_at_utc`). This is explicitly the design (routine never contacts the platform). |
| **B4** | Creating the **Hermes cronjob** | Not created: `hermes cron list` → `No scheduled jobs.` [E16][E35]. `C:/Users/cd-pr/AppData/Local/hermes/scripts/` **does not exist**, so `--script` has nowhere to point [E36]. | **Human decision**: approve the wrapper script (§5.2.1), approve the run time (**09:00 Europe/Berlin** recommended), approve the delivery channel. Creating a scheduled job is an external state change and was deliberately not performed. |
| **B5** | Registering the **Task Scheduler** task | Not registered. `schtasks` exists but no task was created — creating one is a machine-state change. | **Human decision** on time + `/RL` level + whether a Hermes job also exists. Use one scheduler, not both (§5.4). |
| **B6** | **tzdata** for any non-venv interpreter | The Hermes venv python **has** `tzdata` [E64]; the ambient system Python 3.11 at `C:\Users\cd-pr\AppData\Local\Programs\Python\Python311\python.exe` does **not** [E69]. Without it `ZoneInfo("Europe/Berlin")` is unresolvable and the routine degrades to `system-local` while reporting `MONITOR_DEGRADED` [E73]. | **Human decision** to `pip install tzdata` (a package install), or simply pin the venv interpreter in every scheduler action — which is what §5 does. |
| **B7** | **Deleting** any candidate | All delete verdicts are **proposals**: `scripts/monitoring/free-cash-daily-check.py` (§7.1 #2), `finance-monitor/*` (§7.1 #4, if not fixed), `scripts/make_freecash_check.py` (§7.2), and the false verifier `server/scripts/verify-freecash-rules.mjs` (which must be removed or rewritten — [E2] shows it printing `4/4 PASSED` for a file that cannot parse, and two of its four checks are tautologies: Rule 3 is `!includes('checkForChanges') \|\| includes('.log(')` and Rule 4 ends `\|\| includes('approval-request.json')`, both unconditionally true). | **Human approval.** Nothing was deleted. |
| **B8** | Any change under `server/src/` (adapter registration in `runtimeRegistry`, wiring `freeCashExecutor`) | Out of scope by hard constraint this session; `index.ts` registers only 5 adapters [E19]. | **Human decision** to authorise the edit, then a normal reviewed PR. |
| **B9** | Auditing `scripts/approval_gate.py`, `scripts/notification_service.py`, `scripts/resolve-approval.cjs` | Not read in this session [E42][E43]. | **Scope decision** — if promoted, they must be reconciled with `monitoring/freecash/approval_queue.py` so the human has exactly **one** approval inbox. |
| **B10** | Any earning / payout / withdrawal / transaction action | Blocked **permanently and by design** (R1). No credential, approval, or human decision unblocks this inside this routine; execution, if it ever happens, is a separate system with its own review. | **Nothing. This is the intended terminal state.** |

---

## 9. Promotion plan (ordered, smallest reversible steps)

1. **Freeze the canonical routine.** No code change. `monitoring/freecash/` is the monitor; every other candidate is parked by this document. Add `python monitoring/freecash/verify_readonly.py && python monitoring/freecash/tests/run_all.py` to the repo's CI gate so R1 cannot regress by a later edit. *(Gates it satisfies: G2, G11.)*
2. **Remove the false verifier or make it fail on a known violation.** `server/scripts/verify-freecash-rules.mjs` currently certifies a non-parsing file with two tautological checks [E2]. A verifier that has never been shown to FAIL is not evidence. *(Proposal — needs approval, B7.)*
3. **Re-key the epoch artifact.** Replace `server/tasks/last_run_time.json` (raw float, 17 bytes) with an ISO calendar-day key, or retire the file with candidate #4. *(G10.)*
4. **Give the routine a data source.** Either the human appends an `operator-state.json` record per day (B3, zero code) or a provider read contract is decided (B1, code + credential). Do not invent an endpoint.
5. **Wire exactly one scheduler** at 09:00 Europe/Berlin via the `--no-agent` Hermes cronjob (§5.2), verified by `hermes cron list` + `hermes cron runs`. *(G12.)*
6. **Prove the first real change-notification.** Force one operator-state record, then change one figure the next day, and confirm: one `CHANGE` line in `alerts.jsonl`, one toast, one `PENDING` item in `approvals/pending.json`, `execution_state=NOT_EXECUTED`, and a second run the same day printing `SKIP_DUPLICATE_DAY`. That single sequence exercises R2, R3 and R4 together.
7. **Only then** open a decision on the surrounding duplicates (B7, B9).

---

## Appendix A — command evidence log

Every `E<n>` cited above. Commands are reproduced verbatim; output is quoted as observed.

| Tag | Command (in `D:\AgenticOS` unless noted) | Observed output | Exit |
|---|---|---|---|
| E1 | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at `freecash-daily-monitor.mjs:41  function isDailyCheckAllowed(): boolean {` (Node v24.20.0) | 1 |
| E2 | `node server/scripts/verify-freecash-rules.mjs` | `[CHECK] Rule 1..4 … Result: PASSED` ×4; `[OK] All 4 operational rules verified (4/4 passed)` | 0 |
| E3 | `python scripts/monitoring/free-cash-daily-check.py` | *(no output at all)* | 0 |
| E4 | `python scripts/make_freecash_check.py` | `Error: [Errno 2] No such file or directory: 'D:\\data\\freecash\\state.json'` / `No actions available.` | **1** |
| E5 | `python server/tasks/daily-finance-monitor.py --simulate-notification` | `[2026-09-20 21:31:41] Daily check skipped (run within last 24h)` | 0 |
| E6 | `cp server/tasks/daily-finance-monitor.py scratch/dfm-copy.py && python scratch/dfm-copy.py --simulate-notification` | `Daily Finance Status Monitor starting` / `Running in SIMULATE mode` / `Skipping account balance read …` / `✓ Daily check complete; no external actions triggered` / `Daily routine finished (checks=0, approve_needed=False)`; scratch artifacts `last_run_time.json` (17 B), `daily_monitor.log` | 0 |
| E7 | `python finance-monitor/__init__.py` | `Traceback … from src.rule_engine import RuleEngine` → `finance-monitor/src/rule_engine.py, line 122  (snapshot_hash[:8]...)  SyntaxError: f-string: invalid syntax. Perhaps you forgot a comma?` | 1 |
| E7b | `ls -la data/monitoring data/freecash D:/data/freecash` | `data/monitoring` → No such file; `data/freecash` → empty; `D:/data/freecash` → No such file | 2 |
| E8 | `python monitoring/freecash/tests/run_all.py` | per-case `RUN_OK …` / `WATCHDOG_OK …` / `SKIP_DUPLICATE_DAY 2026-09-20`, then `run_all: tests=52 failures=0 errors=0 skipped=0` | 0 |
| E9 | `python monitoring/freecash/verify_readonly.py` | `… EXEMPT [class] file:line` ×28; `[verify_readonly] forbidden=0 exempt=28 missing_targets=0`; `[verify_readonly] PASS - no unexempted write/earning token found.` | 0 |
| E10 | `FREECASH_DATA_ROOT=…/scratch/proof-A python monitoring/freecash/run_daily_check.py` (clean root) | `RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock`; files created: `alerts/alerts.jsonl`, `snapshots/2026-09-20.json`, `state/day-locks/2026-09-20.lock`, `state/last-run.json`, `state/operator-state.json` | 0 |
| E10b | `python -c "ast.parse(open(f).read())"` for the 4 python candidates | `PARSE-OK` ×4 (`free-cash-daily-check.py`, `daily-finance-monitor.py`, `make_freecash_check.py`, `finance-monitor/__init__.py`) | 0 |
| E11 | same command as E10, run a second time, same root | `SKIP_DUPLICATE_DAY 2026-09-20`; file count 5 before and after | 0 |
| E11b | `ls -la "C:/Users/cd-pr/AppData/Local/hermes/cron/"` | `.jobs.lock`, `.tick.lock`, `executions.db` (24576 B), `output/`, `ticker_heartbeat` (18 B), `ticker_last_success` (18 B) — both mtime `Sep 20 21:30` | 0 |
| E12 | `python monitoring/freecash/run_daily_check.py --print-state` | `ledger: D:\AgenticOS\data\freecash-monitor\state\last-run.json` + `consecutive_missed_days 0`, `last_attempt_day 2026-09-20`, `last_outcome MONITOR_DEGRADED`, `last_success_day 2026-09-20`, `timezone Europe/Berlin`, … ; `pending items: 0` | 0 |
| E13 | `grep -rn "freecashMonitorAdapter\|freeCashExecutor\|freecashMonitor" server/src/index.ts` | `398:import { reconcileGoalsOnStartup } from './services/freeCash/freeCashExecutor.js';` (no adapter import) | 0 |
| E16 | `hermes cron list` | `No scheduled jobs.` / `Create one with 'hermes cron create ...'` | 0 |
| E17 | `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env` | `JARVIS_SUPERVISOR_V2`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK_MODEL`, `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL`, `GATEWAY_PROVIDER_ORDER` (values `[REDACTED]`) — no provider credential | 0 |
| E18 | per-token `grep -rnE` over the 6 named candidates | `/transactions` 0 · `/cashout` 0 · `withdraw` **4** · `method: 'POST|PUT|PATCH'` 0 · `DELETE` 0 · `requests.post/put/delete` 0 · `fetch(…POST` 0. The 4 `withdraw` hits: 3× `scripts/make_freecash_check.py` (`available_to_withdraw` ×2, `"type": "withdraw"`), 1× docstring in `freeCashExecutor.ts` | 0 |
| E19 | `grep -rn freecashMonitorAdapter server/src --include=*.ts`; `grep -n "register(" server/src/index.ts` | imports only at `operatorController.ts:4` and `turnController.ts:24`; registry lines 141–145 = `HermesAdapter, JarvisAdapter, CodexAdapter, VideoAdapter, HeavyGenAdapter` — **no FreeCash adapter** | 0 |
| E21 | `find data/freecash-monitor -type f -o -type d` (+ `cat` each) | `snapshots/2026-09-20.json`, `state/day-locks/2026-09-20.lock` (0 B), `state/last-run.json`, `state/operator-state.json` (**`"records": []`**), `alerts/alerts.jsonl` (2 lines), `approvals/`, `logs/` | 0 |
| E22 | `python monitoring/freecash/watchdog.py` | `WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=MONITOR_DEGRADED`; `alerts.jsonl` unchanged (2 lines, mtime 21:08:01 < 21:31) | 0 |
| E26 | `read_file scripts/monitoring/free-cash-daily-check.py` | `def main():` at line 225; **no `__main__` guard**; `save_snapshot(snapshot_data)` line 266, `load_snapshot()` line 270 | — |
| E26b | `cat finance-monitor/.delivery_status.json` | `{"name": "daily-monitoring-setup", "summary": "Daily Status Monitoring Routine for Free Cash Finance Automation - Audit-Ready Prototype"}` | 0 |
| E28 | `find finance-monitor -maxdepth 2` | `src/{action_executor,api_client,notify_manager,orchestrator,rule_engine,wait_gate}.py`, `config/`, `docs/`, `tests/` | 0 |
| E28b | `read_file monitoring/freecash/readonly_client.py` | `ALLOWED_METHODS = {"GET","HEAD"}`; `ALLOWED_HOSTS` loopback-only; `ALLOWED_PATHS` = 2 local regexes; `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` | — |
| E29 | `cat server/tasks/last_run_time.json` | `1789847478.493505` (raw epoch seconds, 17 bytes) | 0 |
| E30 | `python -c "…datetime.fromtimestamp(float(open('server/tasks/last_run_time.json').read()))…"` | `last_run_time.json -> 2026-09-19T21:51:18.493505+02:00`, `age_hours = 23.66`, `gate would skip (>24h)? True` | 0 |
| E30b | `git status --porcelain` | only pre-existing modifications in unrelated areas (`.claude/settings.local.json`, `data/boards.json`, `index.html`, `package*.json`, `server/data/leads.json`, `server/jest.config.cjs`, `server/src/__tests__/*`) — **no `monitoring/`, `scripts/`, `finance-monitor/` or `docs/free-cash-monitor-routine/` source file appears as modified by this session** | 0 |
| E32 | `hermes --version` | `Hermes Agent v0.21.3 (2026.9.14) · upstream 64ea66b0`; install dir `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent` (git) | 0 |
| E35 | `hermes cron create --help` | flags observed: `--name --deliver --failure-deliver --repeat --skill --script --no-agent --monitor-script --monitor-url --workdir --model --provider --reasoning-effort --continuity --paused`; `--script` = "Path to a script under ~/.hermes/scripts/" | 0 |
| E36 | `ls -la "C:/Users/cd-pr/AppData/Local/hermes/scripts/"` | `No such file or directory` | 2 |
| E37 | `hermes cron status` | `✓ Gateway is running — cron jobs will fire automatically` / `PID: 34428` / `Ticker heartbeat: 18s ago` / `No active jobs` | 0 |
| E37b | `read_file server/src/adapters/freecashMonitorAdapter.ts` | `fetchStatus()` returns literal `earnedToday: 0, statusAlerts: [], requiresApproval: [], externalConnected: false` + "External FreeCash API connection is not configured."; `id = 'free-cash-monitor'` | — |
| E38 | `cat cron/ticker_heartbeat; cat cron/ticker_last_success` | `1789932713.205072` / `1789932713.2303042` (both current) | 0 |
| E39 | `which schtasks; schtasks /query /?` | `/c/WINDOWS/system32/schtasks`; usage text for `SCHTASKS /Query` | 0 |
| E40 | `date; date +%z` | `So, 20. Sep 2026 21:31:10` / `+0200` | 0 |
| E42 | `find . -maxdepth 4 \( -name "*approval*" -o -name "*snapshot*" -o -name "*last_run*" -o -name "*day-lock*" \)` | incl. `data/freecash-monitor/{approvals,snapshots,state/day-locks}`, `monitoring/freecash/approval_queue.py`, `scripts/approval_gate.py`, `scripts/resolve-approval.cjs` | 0 |
| E43 | `find . -maxdepth 4 -name "*notif*"` | `finance-monitor/src/notify_manager.py`, `monitoring/freecash/notify.py`, `scripts/notification_service.py` | 0 |
| E45 | `wc -l data/freecash-monitor/alerts/alerts.jsonl; tail -2 …` | `2`; last line = `{"event_type": "SKIP_DUPLICATE_DAY", "message": "Day 2026-09-20 already consumed (lock 2026-09-20.lock). Duplicate run performed no read and wrote no snapshot.", …}` — real-state proof that the R2 gate already fired | 0 |
| E46 | `read_file` of the 6 candidates | `free-cash-daily-check.py`: `save_snapshot(snapshot_data)` L266 then `old_snapshot = load_snapshot()` L270 (save-before-load) | — |
| E46b | `read_file server/tasks/daily-finance-monitor.py` | `compare_with_last_check()` reads `last_status.json`; `grep` finds no writer of that path in the file; notify branch guarded by `if change_count == 1` (L306); `input()` approval at L236 | — |
| E55 | `read_file monitoring/freecash/run_daily_check.py` | L402 `prior = changedetect.load_prior_snapshot(day)` → L403 `build_snapshot` → L404 `compare(prior, snapshot)` → L405 `save_snapshot(snapshot, now=now)` | — |
| E61 | `wc -l …/alerts.jsonl` | `2` | 0 |
| E62 | `ls -la --time-style=full-iso data/freecash-monitor/{alerts/alerts.jsonl,state/last-run.json,state/notified-keys.json}` | `alerts.jsonl` 992 B `2026-09-20 21:08:01.077661100 +0200`; `last-run.json` 341 B `21:08:00.732912700`; **`notified-keys.json` → No such file or directory** | 2 |
| E63 | `which python; python -c "import sys; print(sys.executable)"` | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (Python 3.11.9) | 0 |
| E64 | `python -c "from zoneinfo import ZoneInfo; …"` | `ZoneInfo Europe/Berlin OK -> 2026-09-20T21:35:11.846258+02:00 CEST +0200`; `tzdata installed? True` | 0 |
| E65 | `cd monitoring/freecash && python -c "import gate,paths; print(gate.timezone_report()); print(gate.day_key()); print(gate.tz_name()); print(paths.data_root())"` | `{'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}` / `2026-09-20` / `Europe/Berlin` / `D:\AgenticOS\data\freecash-monitor` | 0 |
| E69 | `C:\Users\cd-pr\AppData\Local\Programs\Python\Python311\python.exe -c "…find_spec('tzdata')…"` | `tzdata False` | 0 |
| E71 | `ls config.yaml; grep -inE "time\|tz" config.yaml` | file present (9094 B); **no `timezone`/`tz` key** | 0 |
| E72 | `py -0p`; `ls -d /c/Python3*` | `-V:3.14 * C:\Python314\python.exe`, `-V:3.11 …Python311\python.exe`, `uv` 3.11.16 | 0 |
| E73 | `grep -rn "timezone" cron/occurrences.py cron/scheduler.py`; `grep -rn "def get_timezone" hermes_time.py` | scheduler works in UTC internally; `hermes_time.get_timezone()` → "the active profile's configured ZoneInfo, **or None (server-local)**" | 0 |

### Disclosures

- **Writes performed by this session:** (1) this document; (2) scratch files under `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/scratch/` (`dfm-copy.py`, its `last_run_time.json`, its `daily_monitor.log`, and `proof-A/` — a throwaway state root); (3) **one appended line** in `server/tasks/daily_monitor.log` from exercising candidate #4 at [E5]. No file under `server/src/` or `src/` was touched; no source file was edited; `git status --porcelain` shows only pre-existing modifications in unrelated areas [E30b].
- **No write/withdraw/cashout/transaction endpoint was called. No live earning action was executed.** The only network-capable code exercised was the local, loopback-allowlisted `readonly_client` path, and only through its test harness.
- **No secret value is reproduced.** `.env` contents appear as key names only [E17].
- **Nothing was deleted.** All DELETE verdicts are proposals pending human approval (§8 B7).

# WORKFLOW-PLAN-V4.md — Daily Operational Workflow Plan

**Project:** Free Cash Finance Automation — daily status-monitoring routine
**Repo:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908` · HEAD `d14253d`
**Written:** 2026-09-20, 07:02 Europe/Berlin (UTC+02:00), by a delegated subagent, against **executed** evidence only.
**Deliverable of this task:** this one new file. No existing file was created, modified, deleted or committed. Every command in §1.3 and §10 is read-only or ran against a `%LOCALAPPDATA%\Temp` `FREECASH_DATA_ROOT`.
**Implementation under plan:** `monitoring/freecash/` (stdlib-only Python: `run_daily_check.py`, `gate.py`, `readonly_client.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `operator_state.py`, `watchdog.py`, `paths.py`, `verify_readonly.py`).

---

## 0. The four rules, and what "enforced" means in this plan

| ID | Rule, verbatim | Enforcement class used here |
|---|---|---|
| **R1** | **Exactly one status check per day. Zero automated earning actions.** | Atomic OS-level mutual exclusion (exclusive-create day lock) + two independent missed-day detectors + a refusal path that has no second-read code |
| **R2** | **Zero automated earning / transaction actions.** | Deny-by-default network transport (verb + host + path + body allowlists) + a single socket site + a static CI scanner + the absence of any execution call path |
| **R3** | **Notify the human when earnings or account status changes.** | Exact integer-cent snapshot diff over a versioned snapshot, compared against the **prior** snapshot; dedupe key recorded **before** dispatch; delivery bounded at 2 attempts |
| **R4** | **Human approval required before ANY external action.** | Approval queue frozen at `execution_state = NOT_EXECUTED` and `expires_at_utc = null`; an approvals CLI whose `--by` must name a human; **no execution code path exists anywhere in the routine** |

"Enforced" here means the violation is **not reachable by the code as written**, not "we did not do it today". Every rule has a mechanism that denies when in doubt. Where a mechanism is currently weaker than the rule demands, §6 says so and ranks it.

**Non-negotiable invariants that follow from the rules** (assert these in any change review):

1. No write/claim/withdraw/cashout/redeem/transfer/survey-submit endpoint may be added, and the read allowlist may not be widened without the research exit criteria.
2. `expires_at_utc` stays `null` and `execution_state` stays `NOT_EXECUTED` for every item, forever. No TTL, watchdog, cron entry, scheduler retry or timeout may change a `PENDING` status.
3. A failed run must exit non-zero and must **not** be retried the same day.
4. A duplicate invocation must produce no read, no snapshot and no ledger write.
5. `alerts/alerts.jsonl` and `approvals/decided.jsonl` are append-only audit records and are never rewritten or pruned.
6. No credential is ever stored in the repository or in the state tree.

---

## 1. Revision pin, and the change that happened during this session

### 1.1 This plan describes a pinned revision, not "the tree"

The routine's source tree was **rewritten by another process while this plan was being written**. That is a material fact for a plan of this kind, so the revision is pinned by hash.

| Revision | When | Evidence |
|---|---|---|
| **A** — the revision the task brief described | file mtimes `2026-09-18 07:2x–07:32` | Observed at the start of this session: `approval_queue.py` 10 912 B, `run_daily_check.py` 18 732 B, `notify.py` 15 172 B, `changedetect.py` 11 330 B, `watchdog.py` 3 439 B |
| **B** — the revision that exists now | mtimes `2026-09-20 06:57:40`–`06:59:58` | `approval_queue.py` 10 914 B, `run_daily_check.py` 18 977 B, `notify.py` 15 479 B, `changedetect.py` 11 983 B, `watchdog.py` 4 176 B; new `.pyc` files for both cpython-311 and cpython-314 |

The single change that flipped revision A to B is directly observable: on revision A, `approval_queue.py:111` read `action.setdefault("action_type", ACTION_LABEL_REQUEST_PAYOUT)` while only `ACTION_LABEL_FOR_HUMAN_REVIEW` was defined at line 52 — a `NameError` on every enqueue. On revision B, line 111 reads `ACTION_LABEL_FOR_HUMAN_REVIEW`. A second change added the missing `# readonly-exempt:` marker in the test tree.

**Consequence for the numbers in the brief.** The brief's ground truth (`tests=52 failures=6 errors=11`, static checker red) was accurate **for revision A** and I reproduced it there. On revision B the same suite reports `tests=52 failures=0 errors=0`, and the static checker exits 0. **This plan is written against revision B**, and §6 ranks what is still open on revision B. Nothing in this plan should be read as "the suite is red today".

### 1.2 Revision B hashes (`sha256sum monitoring/freecash/*.py monitoring/freecash/tests/*.py`)

```
0a2c982fbcfb9ca4f3371c309e308046f37976ccdb6b54e587912790fd42d506  approval_queue.py
296c65aaf0be395d391ff3cb5ec92bcc1c83b191f7c3cf73377a36ff5773786b  changedetect.py
1c726b27e0f6d577c28454e66530d297925fd83d23de2313a3c15d13120608e7  gate.py
9bfca8cddfdea913353e7a27bb6bb9d0c17f5959c3ca11935954a0c445abcb22  notify.py
32f0fd7201e0f2179c434d67fb48bffe14e3adf54a69d603d4436f8c3cd1d4a7  operator_state.py
a38ab2e73d25d88fb0512b6e42d2877465f5a2329a73c5973999e77fc0ef1938  paths.py
5426b56c11d20fbe65aa197a4f11660536e6371d585c31f827914d2930aecc27  readonly_client.py
bda54e7d56d31f2eb7d70ae1fb5697ef4e08693060fbd2ee5c6b81327487a54c  run_daily_check.py
2c91a1fc0179a486a07b550cdbc60aa69cafa96641a6a1d3205db7062b590aa0  verify_readonly.py
11dfa88bff930be0886a1006190d72a72da051c8a57515029e9cdfabb7d3acdd  watchdog.py
1995e415000f17ba875dbb0d26e37537a2546e2d36aa3d6781926a5228ebeef4  tests/_support.py
f886d4bfa5476c7c2e91e88374b8f10f4e3c99c2d47814b8f94db04b900e1c0a  tests/run_all.py
e5d30e603f1baadd960d24401e8da35a862dcb0e8ab4398bb142127686679065  tests/test_r1_gate.py
b88ae7f901124a5c7e10c30137fce68f679c5173aba1c0d8afa15ad3437e2d95  tests/test_r2_readonly.py
7c5293f7ca7366d6c691c596336fc15816db56fe1863c56ce6eae5f3c445b819  tests/test_r3_changedetect.py
8ad866e65867c7bf10c1ceb268767c53c53d57baef4cf298ce15a4cca39d2bc1  tests/test_r4_approval.py
780a2fd2d02ddc603e4358d5a7e1d20b1c9aa55b81b437a580f3d70cd109f937  tests/test_r5_smoke.py
```

**Rule for the operator: a hash mismatch against this table invalidates the green measured in §1.3.** The suite is not a stable gate while the tree is being edited — across 22 executions spanning the A→B rewrite I observed `failures=0` and `failures=6 errors=11` on the same command line, with intermediate values of 1, 4 and 5.

### 1.3 Observed current state (exact commands, observed output)

| Claim | Command | Observed |
|---|---|---|
| Suite green on revision B | `python monitoring/freecash/tests/run_all.py` (6 consecutive runs, fresh `FREECASH_DATA_ROOT` each) | `run_all: tests=52 failures=0 errors=0 skipped=0` ×6 |
| Suite red on revision A | same, earlier in session | `run_all: tests=52 failures=6 errors=11 skipped=0`; all 11 errors = `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined` at `approval_queue.py:111` |
| R2 static checker green | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit 0 |
| R2 static checker was red on A | same, earlier | `forbidden=2` at `approval_queue.py:111` and `tests/test_r4_approval.py:283`, exit 1 |
| Entry point runs | `python monitoring/freecash/run_daily_check.py --version` | `freecash-monitor 1.0.0`, exit 0 |
| Entry point reads its ledger | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/run_daily_check.py --print-state` | prints `ledger: <temp>/state/last-run.json`, `timezone Europe/Berlin`, `pending items: 0`, exit 0 |
| **Routine has never run in production** | `ls -la data/freecash-monitor` | `No such file or directory` |
| **No scheduled task exists** | `schtasks /query /fo CSV /nh \| grep -icE "freecash"` | `0`; `schtasks /query /TN "FreeCash-Daily-Monitor"` → `FEHLER: Das System kann die angegebene Datei nicht finden` |
| No CI runner exists | `command -v crontab`; `ls .github/workflows` | `crontab NOT FOUND`; `No such file or directory` |
| Interpreter: only one resolves the configured tz | `python --version`; `python -c "from zoneinfo import ZoneInfo; ..."` | `Python 3.11.9` (Hermes venv) → `Europe/Berlin OK -> 2026-09-20`; `tzdata 2025.3` present |
| The launcher does **not** | `py -3 --version`; `py -3 -c "ZoneInfo('Europe/Berlin')"` | `Python 3.14.7`; `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` |
| `python3` is not Python | `command -v python3; python3 --version` | WindowsApps Store redirector → "Python wurde nicht gefunden" |
| No test runner in the docs' sense | `python -m pytest --version`; `py -3 -m pytest --version` | `No module named pytest` (both) |
| Ambient env is a hazard | `python -c "import os;print(repr(os.environ.get('FREECASH_DATA_ROOT')))"` | `'C:\\Users\\cd-pr\\AppData\\Local/Temp/fcv4-probe/live'` — **a stale Temp path is exported in this shell** |
| Legacy `.mjs` cannot run | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at line 41, Node v24.20.0 |
| Adapter is unregistered | `grep -n "Adapter" server/src/index.ts`; `grep -rn "freecashMonitorAdapter" server/src/` | `index.ts` registers only `HermesAdapter, JarvisAdapter, CodexAdapter, VideoAdapter, HeavyGenAdapter`; the freecash adapter is imported by `domains/jarvisV2/turnController.ts:24` and `domains/jarvisNext/operator/operatorController.ts:4` only; `externalConnected: false` hardcoded at `freecashMonitorAdapter.ts:206` |
| Crontab points at the wrong target | `cat config/freecash-crontab` | `0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py >> …` — placeholder root, `python3` (a Store stub here), log-name typo `freecashioc_` |
| Off-by-one data dir in the crontab's target | `grep -n "parents\[" scripts/make_freecash_check.py` | `8: BASE = Path(__file__).resolve().parents[2]` → resolves to `D:\data\freecash`, not the real state root |
| Dead script never enters `main()` | `grep -n "def main\|__main__\|main()" scripts/monitoring/free-cash-daily-check.py` | `225:def main():` — no `__main__` block, no call site |

### 1.4 How this plan relates to the existing documents

Read before writing, so this plan **extends** rather than contradicts.

| Document | Relationship |
|---|---|
| `ROUTINE-DESIGN.md` | Authoritative on mechanism, message templates, state-layout intent and the 08:35/23:50 run times. **Partially superseded by this plan:** §2.3 promises a human `--force-recheck` that consumes a `-forced` lock suffix; revision B accepts the flag only to refuse it (exit 3) and records the refusal in `logs/forced-recheck-requests.jsonl`. That is the stricter reading of R1 and this plan adopts it. §7.1 also contradicts itself ("Run whether logged on = Yes" vs `/IT` = interactive only); §5.6 resolves it. |
| `IMPLEMENTATION-PLAN-V3.md` | Authoritative on capability verification (atomic `O_EXCL` proven on local NTFS `D:`: 1 winner / 4 `FileExistsError`; the CI grep proven build-breaking; the interpreter/tz hazard). **Extended by** this plan: §5 turns its P5 into a concrete task definition and §6 ranks the gaps on the current revision. |
| `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` | Closest sibling. **Superseded in three specifics:** §2 states the state root is `D:/AgenticOS/data/freecash/`, but the implementation's `paths.DEFAULT_DATA_ROOT` is `D:/AgenticOS/data/freecash-monitor` and `data/freecash/` exists and is empty; §11 names `scripts/monitoring/rule_gate_verify.py` as *the* acceptance gate, whereas this plan's gate is the routine's own `tests/run_all.py` + `verify_readonly.py`; §0's `failures=7 errors=11` is the revision-A class of measurement and is now stale. Its §14 pre-deploy list is consistent with §6 here on items 1–2 (both now done on revision B). |
| `RULE-GATE-CHECKLIST.md` | **Stale in two ways, must be re-based before sign-off:** step 5 says `py -3 -m pytest … -k "not live"` expecting `16 passed` — `pytest` is absent everywhere and the suite is 52 stdlib `unittest` tests run by `tests/run_all.py`. Its sign-off table is unsigned. It should not be signed until §6's G1–G3 are closed. |
| `AUDIT-RULE-COMPLIANCE.md` | Inventory of the legacy/dead artifacts. Used here for §6 G9; its verdicts are not re-derived and its UNVERIFIED section is respected. |
| `config/freecash-crontab` | **Documentation only.** See §5.6. |
| `OPERATIONS-WORKFLOW-PLAN.md`, `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md`, `RESEARCH-PLAN-V4.md`, `PROVIDER-DECISION-PACKET-2026-09-20.md`, `DELEGATION-DISPATCH-2026-09-20.md` | **Written concurrently with this plan by other agents** (mtimes `2026-09-20 06:56`–`07:02`) and therefore neither read in full nor reconciled here. One divergence is material and is recorded as **G13** in §6: both sibling workflow plans name `D:/AgenticOS/data/freecash/` as the canonical state root and treat `paths.py`'s default `D:/AgenticOS/data/freecash-monitor` as a defect to be aligned, whereas this plan pins `FREECASH_DATA_ROOT` to the **code's default**. Both work; **only one may be chosen**, or two state trees exist and R1/R3 break (§6 G13). |

---

## 2. (a) End-to-end daily sequence — actors, timings, artifacts

### 2.1 The day at a glance

| Time (local) | Actor | Action | Artifact produced |
|---|---|---|---|
| 08:35:00 | Task Scheduler → Task A | launches the pinned interpreter on `run_daily_check.py` | `logs/run-latest.log` opened (wrapper-created) |
| 08:35:00–08:35:05 | routine (`_run`) | `ensure_layout()`; install process audit guard; compute operator-local `day_key`; attempt the atomic day lock | `state/`, `state/day-locks/`, `snapshots/`, `approvals/`, `alerts/`, `logs/` (dirs); **`state/day-locks/<YYYY-MM-DD>.lock`** (zero bytes) |
| +0 s | routine | record attempt; detect missed days; check tz drift | `state/last-run.json` (`last_attempt_day`, `last_attempt_at_utc`) |
| +0–2 s | routine | read today's figures from the configured read source | `state/operator-state.json` (created from template on first run; read afterwards) |
| +2 s | routine | load **prior** snapshot, build today's, compare | in-memory `verdict = {baseline, changes[], degraded[]}` |
| +2 s | routine | write today's snapshot (only if absent) | **`snapshots/<YYYY-MM-DD>.json`** (immutable once written) |
| +2–3 s | routine | R3: one alert line per distinct change, at most one notification per change | `alerts/alerts.jsonl` (append-only); `state/notified-keys.json` (dedupe index, written **before** dispatch); toast delivered |
| +2–3 s | routine | R4: enqueue one item per notified change (max 5/day) | **`approvals/pending.json`** (`status=PENDING`, `expires_at_utc=null`, `execution_state=NOT_EXECUTED`) |
| +3 s | routine | reminders for stale pending items (≤1 per item per 7 days) | `alerts/alerts.jsonl` |
| +3 s | routine | retention pass (snapshots >90 d, `logs/run-*.log` >30 d) | deletions only; **never** `alerts.jsonl` or `decided.jsonl` |
| +3 s | routine | record outcome; print `RUN_OK …` | `state/last-run.json` (`last_outcome`, `last_success_day`, `consecutive_missed_days`); `logs/run-latest.log` |
| 08:35–all day | **human** | sees the toast; opens `approvals/pending.json`; decides with the CLI (optional, never forced) | `approvals/decided.jsonl` (append-only) |
| 23:50:00 | Task Scheduler → Task B | launches `watchdog.py` | `logs/watchdog-latest.log` |
| +1 s | watchdog | read ledger; did today get a *successful* attempt? | stdout `WATCHDOG_OK <day> …` **or** `WATCHDOG_MISSED_DAY <day> …` |
| +1 s | watchdog (only if uncovered) | one `MISSED_DAY` alarm for today | `alerts/alerts.jsonl`; `state/notified-keys.json`; toast. Exit 0 either way |
| any day, ~5 min | **human** | weekly runbook (§2.4) | decisions/no-change in `decided.jsonl` |

### 2.2 The sequence in rule terms, with exact symbols

**Step 1 — R2 pre-flight, before anything reads.** `run_daily_check._run` calls `readonly_client.install_audit_guard()` first. It installs a `sys.addaudithook` that aborts any `socket.connect` / `socket.getaddrinfo` to a host outside `ALLOWED_HOSTS` (`readonly_client.py:41`). This is a process-wide backstop that does not depend on the caller behaving.

**Step 2 — R1 gate (the only barrier).** `day = gate.day_key(now)` (`gate.py:96`, operator-local calendar day via `zoneinfo`, default `Europe/Berlin`, `FREECASH_TZ` overrides), then `gate.acquire_day_lock(day)` (`gate.py:119`) which does `os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)` (`gate.py:128`) on `state/day-locks/<day>.lock`. **The filename is the day key and the file is zero bytes**, so a partially written file can never be misread, and the `if exists` check is never the gate. The ledger is explicitly *not* the gate, so a corrupt or deleted `last-run.json` cannot cause a second read.

**Step 3 — R1 duplicate path.** If the lock was not acquired: exactly one `SKIP_DUPLICATE_DAY` line is appended to `alerts/alerts.jsonl`, `SKIP_DUPLICATE_DAY <day>` is printed, and the process returns **0**. No read, no snapshot write, no ledger write, no notification, no queue touch. Exit 0 is deliberate: a scheduler retry must not be triggered by a duplicate.

**Step 4 — R1 missed-day accounting.** `gate.load_ledger()` → `gate.missed_days(day, ledger)` → every local day strictly between `last_success_day` and today (today and the last success day excluded). `gate.record_attempt(day, now, ledger)` writes `last_attempt_day` **immediately after the lock**, so a crash later still leaves the day visibly consumed. Then one `MISSED_DAY` notification per missed day, and the run **continues with today's check** — missed days are **never back-filled**, because a read of a past day would be a second read for that day (R1).

**Step 5 — R1/R3 timezone reporting.** `gate.timezone_changed(ledger)` compares the ledger's stored `timezone` with `gate.tz_name()`; a change emits `MONITOR_DEGRADED` (severity `alert`). `gate.timezone_report()` additionally reports `kind`: if the configured zone is not resolvable on this host, `gate.resolve_tz` falls back to the machine's own local zone, `kind == "system-local"`, and the run emits `MONITOR_DEGRADED` plus a stdout `WARNING timezone_unavailable …`. **This is a degraded-but-running path, not a crash** — see §6 G3, where that is rated as a risk, because it makes the tz hazard quiet rather than loud.

**Step 6 — R2 read (one of two sources).** `resolve_source()` selects `operator_state` (default) or `metrics_http` (`--source`, or `FREECASH_READ_SOURCE`; anything else is a usage error, exit 2).
- `operator_state.read_source(day)` (`operator_state.py`) reads `state/operator-state.json`, returns the record whose `day_key` equals today **exactly** — a stale record is never carried forward as today's reading. No socket, no credential.
- `metrics_http` → `readonly_client.read_status_source()` runs W1 `GET /api/v1/status/metrics` then W2 `HEAD /api/v1/status` against `FREECASH_READ_BASE_URL` (default `http://localhost:3001`). Both paths must match `ALLOWED_PATHS`; the verb must be in `ALLOWED_METHODS = {GET, HEAD}`; the host must be in `ALLOWED_HOSTS`; and any `data`/`json`/`files`/`body`/`content` keyword or unknown keyword raises `ForbiddenWriteError` **before** `_transport` (`readonly_client.py:76`) — the single place in the routine that opens a socket.

**Step 7 — R2 read failure.** Any `ReadError`, `ForbiddenWriteError` or `MetricError` produces one `RUN_FAILED` notification with the reason, `gate.record_outcome(day, "READ_FAILED", …)` (which leaves `last_success_day` **unadvanced**, so the day stays uncovered for the watchdog and the next run), a `RUN_FAILED …` stdout line, and **exit 5**. The day lock stays in place: **no automatic re-run today.**

**Step 8 — R3 comparison.** `changedetect.load_prior_snapshot(day)` is called **before** `save_snapshot`, so the comparison is never against the file just written (this is the exact defect that made the legacy script unable to ever fire — `free-cash-daily-check.py:266` then `:270`). `changedetect.build_snapshot` marks `"degraded": True` unconditionally, because no currently-available source is the provider. `changedetect.compare` walks `COMPARED_FIELDS` exhaustively: `account_status` (any inequality → `STATUS_CHANGED`), `earnings_total_cents` (→ `EARNINGS_CHANGED`), `balance_cents` (→ `BALANCE_CHANGED`), `pending_cents` (→ `EARNINGS_CHANGED`, subtype `pending`). Comparison is exact integer cents — **no percentage or relative threshold may swallow a real movement.** A currency change skips money comparison and reports `MONITOR_DEGRADED` instead of comparing unlike units.

**Step 9 — R3 delivery, bounded.** `notify.notify_change` → dedupe key `changedetect.dedupe_key(day, change_type, field, old, new)` = `sha256(day|type|field|old|new)`. If the key is already in `state/notified-keys.json` the change is logged and returns `DEDUPED` — no second notification, ever. Otherwise the key is written (`DELIVERY_QUEUED`) **before** `notify.dispatch`, so a crash between key and dispatch can lose one message but can never duplicate one. `dispatch` makes at most `MAX_ATTEMPTS = 2` attempts (`notify.py:42`), then appends one `DELIVERY_FAILED` line carrying the **full original message**, marks the key `FAILED_TOAST`, appends a `MONITOR_DEGRADED` line saying the message exists only in the log, and stops — no scheduler-level retry, and the key is never retried. A delivery failure never blocks a state write, never re-reads the source, never causes a second run and never touches the approval queue.
- `OK_NO_CHANGE` is **log-only** (`notify.emit_no_change` takes no sender and never dispatches). A first run emits `INITIAL_BASELINE`, also log-only. A no-data day emits `MONITOR_DEGRADED` with null fields and compares nothing. More than `MAX_NOTIFICATIONS = 5` changes coalesce into one summary notification (`run_daily_check.py:55`).

**Step 10 — R4 enqueue only.** For each notified change (up to `MAX_APPROVAL_ITEMS = 5`, `run_daily_check.py:56`), `approval_queue.enqueue` appends an item to `approvals/pending.json` with `status = PENDING`, `expires_at_utc = NO_EXPIRY` (`None`), `execution_state = EXECUTION_STATE_NOT_EXECUTED`, `execution_allowed_by_this_routine = False`. **Enqueueing is a notification with a handle, not a permission to act**, and `notify.alert("APPROVAL_PENDING", …)` says so in the message the human reads. Note the message's own text: *"PENDING - yours to decide, nothing executes"*.

**Step 11 — R4 pending-forever maintenance.** `nag_pending` emits at most one reminder per item per `NAG_INTERVAL_DAYS = 7`. A reminder **never decides**. There is no TTL job, no watchdog, no cron entry and no scheduler retry that may change a `PENDING` status.

**Step 12 — R3/R4 audit close.** `gate.record_outcome(day, outcome, now, ledger, missed=…)` advances `last_success_day`/`last_success_at_utc` **only** for outcomes in `gate.SUCCESS_OUTCOMES`. Then `RUN_OK <day> outcome=… source=… snapshot=… written=… changes=… notifications=… approvals=… reminders=… lock=…` is printed and the process exits 0.

### 2.3 The human's decisions (the only write path outside the routine)

```
# list the queue (read-only)
python D:/AgenticOS/monitoring/freecash/approval_queue.py list

# decide — --by must name a human; --note is required
python D:/AgenticOS/monitoring/freecash/approval_queue.py decide \
    --id <uuid> --decision approve|reject --by "<your name>" --note "<why>"
```
`_normalise_decider` rejects an empty name and any name in `NON_HUMAN_DECIDERS` (`system`, `routine`, `automation`, `agent`, `cron`, `scheduler`, `monitor`, `bot`, `script`, `machine`) with `NotHumanError` → exit 4. Deciding writes `decisions` into `approvals/pending.json` **and** appends to `approvals/decided.jsonl`, and **re-asserts** the frozen fields (`expires_at_utc = None`, `execution_state = NOT_EXECUTED`). **A decision cannot arm an item**, and approving one has no automatic consequence anywhere — the routine contains no code that reads `status == "APPROVED"` and acts.

### 2.4 Weekly operator touchpoint (~5 minutes)

| # | Check | Command / artifact | Pass condition |
|---|---|---|---|
| 1 | Day coverage | `state/last-run.json` | 7 distinct `last_success_day` values over the last 7 local days |
| 2 | No silent gaps | `grep -c MISSED_DAY data/freecash-monitor/alerts/alerts.jsonl` | no new since last week |
| 3 | Alerts actually reached a human | count `DELIVERY_FAILED` | 0 new |
| 4 | Degraded mode | `grep -c '"degraded": true' data/freecash-monitor/snapshots/*.json` (last 7) | target **0**; until it is 0, treat every "no change" as **unverified** |
| 5 | Queue age | oldest `PENDING` in `approvals/pending.json` | decide or reject anything older than 7 days (safe either way — nothing executes) |
| 6 | R2 still structural | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | exit **0**; a rising `exempt=` count means R2 is eroding |
| 7 | Revision integrity | `sha256sum monitoring/freecash/*.py` vs §1.2 | matches, or re-run §7's gate before trusting the green |
| 8 | Disk / retention | `du -sh data/freecash-monitor/` | < 100 MB |

---

## 3. (b) Rule-by-rule control table

Every row is a control, not a convention. Line numbers are revision B.

| Rule | Requirement | Mechanism | Enforced in code (file:symbol / line) | How it **fails closed** |
|---|---|---|---|---|
| **R1** | one check per operator-local calendar day | Atomic exclusive-create day lock — a single `O_CREAT\|O_EXCL` syscall on a per-day path; the filename *is* the day key | `gate.py:119 acquire_day_lock`, `gate.py:128 os.open(...)` | `FileExistsError` → `(False, lock)` → the caller performs **no read, no snapshot, no ledger write** and exits 0. Any other `OSError` propagates and the process dies **before** any read. Absence of the lock file is never treated as "allowed" — only a successful exclusive create is |
| **R1** | no double run under concurrency | The lock is a single atomic syscall, so there is no read-then-write window; the scheduler adds `MultipleInstances = IgnoreNew` | `gate.py:119`; Task A setting (§5.1) | 5 simultaneous processes → 1 winner, 4 `SKIP_DUPLICATE_DAY`. Proven on this volume by `IMPLEMENTATION-PLAN-V3.md` §1(a): `winners=1, losers_fileexists=4` |
| **R1** | missed day is detected, not hidden | Two **independent** detectors: in-band at the next run, and same-evening | `gate.py:missed_days` + `run_daily_check.py` MISSED_DAY block; `watchdog.py:evaluate` (`covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES`) | Neither detector ever re-runs the check. A day with no successful outcome is reported as missed; the ledger's `last_success_day` is not advanced, so the gap cannot be silently closed |
| **R1** | no back-fill of a past day | `missed_days` returns only days strictly between `last_success_day` and today, and the run does not read for any of them | `gate.py:missed_days` | A missed day produces an alarm and nothing else — the only read is today's |
| **R1** | a no-arg second read is impossible | `--force-recheck` is accepted **only to be refused**; the refusal is audited | `run_daily_check.py` force-recheck block (`return 3`), audit to `logs/forced-recheck-requests.jsonl` | The flag cannot produce a read. Exit 3, one audit line, no lock consumed, no snapshot |
| **R1** | a failed read does not become a retry loop | Failure records `READ_FAILED`, leaves the lock, exits 5, and `last_success_day` is not advanced | `run_daily_check.py:382–393`; `gate.record_outcome` + `SUCCESS_OUTCOMES` | Bounded: one attempt per day, by construction. No retry code exists |
| **R2** | no write/earning verb ever leaves the process | Verb allowlist `{GET, HEAD}` | `readonly_client.py:39 ALLOWED_METHODS`; `request()` refuses anything else with `ForbiddenWriteError` | Method not in the set → raise **before** the transport is reached |
| **R2** | no invented endpoint can be reached | Host allowlist (loopback only) + path allowlist of compiled regexes | `readonly_client.py:41 ALLOWED_HOSTS`; `readonly_client.py:ALLOWED_PATHS`; checked in `request()` | Non-allowlisted host or path → `ForbiddenWriteError`. Provider paths are deliberately absent and the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` is kept verbatim (`readonly_client.py:60`) so the gap stays greppable |
| **R2** | no request body, on any method | Body-keyword rejection (`data`, `json`, `files`, `body`, `content`) **and** rejection of any unknown keyword | `readonly_client.py:BODY_KEYWORDS`; `request()` | Any body-bearing or unknown keyword → `ForbiddenWriteError` |
| **R2** | one auditable socket site | A single function opens sockets; a process-wide audit hook aborts non-allowlisted connects | `readonly_client.py:76 _transport` (the only socket site); `install_audit_guard` / `_audit_hook`; called from `run_daily_check.py:279` | The hook raises `ForbiddenWriteError` on a non-allowlisted `connect`/`getaddrinfo` regardless of which code path attempted it |
| **R2** | regressions fail the build | Static scanner over six forbidden token classes with a per-line exemption marker and exit codes 0/1/2 | `monitoring/freecash/verify_readonly.py` (`main` → exit 0/1/2) and the shipped shell parity checker `docs/free-cash-monitor-routine/verify-readonly.sh` | **Exit 1** on any unexempted forbidden token; **exit 2** when a scan target is missing — "absence of evidence is not a pass" |
| **R2** | no approved→execute path exists | The routine contains no execution code path at all; `execution_state` is a **constant**, not a parameter | `approval_queue.py:44–45, 131–133` (`build_item`); `approval_queue.py:180–182` (re-asserted on decide) | There is nothing to fail closed to — the call path does not exist. `execution_allowed_by_this_routine` is `False` by constant |
| **R3** | a real change is detected, small ones included | Exact integer-cent comparison of four exhaustive fields; no relative/percentage threshold | `changedetect.py:COMPARED_FIELDS`; `changedetect.compare` | A missing/unparsable field raises `MetricError` → `RUN_FAILED` (a read failure), never a silent zero |
| **R3** | comparison is against the **prior** day | Prior snapshot loaded **before** the new one is written | `run_daily_check.py` (`load_prior_snapshot` then `save_snapshot`); `changedetect.load_prior_snapshot`, `save_snapshot` | No prior, or either side lacking data, sets `baseline = True` — a first run can never produce a fake alarm |
| **R3** | exactly one notification per distinct change, ever | `sha256(day\|type\|field\|old\|new)` dedupe key; key index checked first and **written before dispatch** | `changedetect.dedupe_key`; `notify.key_seen`, `record_notified_key`, `notify_change` | Key already present → `DEDUPED`, log line only. The pre-dispatch write means a crash can lose a message but can never duplicate one |
| **R3** | a quiet day is quiet | `OK_NO_CHANGE` and `INITIAL_BASELINE` are log-only; no dispatch call exists on those paths | `notify.emit_no_change`, `notify.emit_initial_baseline` (no sender parameter) | Never dispatches, whatever else happens. >5 changes coalesce to one summary |
| **R3** | delivery failure is bounded and loud | Max 2 attempts, in-process backoff, then one `DELIVERY_FAILED` line carrying the **full message** | `notify.py:42 MAX_ATTEMPTS = 2`; `notify.dispatch` (`notify.py:220–258`) | After 2 attempts: key marked `FAILED_TOAST`, the message is preserved verbatim in `alerts.jsonl`, a `MONITOR_DEGRADED` line says the channel is down, and the key is never retried. Run still exits 0 |
| **R3** | a degraded reading is never reported as verification | Every snapshot is marked `degraded: true`; the marker is carried into the message templates | `changedetect.build_snapshot` (`"degraded": True`); `notify._source_line` / `message_for_change(… source_note)` | A "no change" over degraded data is labelled unverified in the human-visible text, not silently presented as a clean result |
| **R4** | nothing executes; pending waits forever | `execution_state` frozen at the literal `NOT_EXECUTED`; `expires_at_utc` always `null`; no TTL/timeout job exists | `approval_queue.py:44–48, 131–133`; re-asserted at `approval_queue.py:180–182`; no component reads `status == "APPROVED"` | Any expiry-driven "expired, so execute" mechanism **does not exist**; a past `expires_at_utc` produces no execution because no code consumes the field |
| **R4** | only a human can decide | `--by` required and checked against `NON_HUMAN_DECIDERS`; `--note` required | `approval_queue.py:55 NON_HUMAN_DECIDERS`, `_normalise_decider`, `decide`; CLI `main` → exit 4 | Missing/machine identity → `NotHumanError` → exit 4, nothing written. Missing note → exit 2 |
| **R4** | the enqueue is not a permission | Enqueue happens only on a real change, and the message says what it is | `run_daily_check.dispatch_change` → `approval_queue.enqueue`; the `APPROVAL_PENDING` alert text | The item is a handle for a human. No code path consumes it |
| **R4** | the audit trail cannot be rewritten | `alerts/alerts.jsonl` and `approvals/decided.jsonl` are append-only via one `O_APPEND` write; the retention pass never touches them | `paths.append_jsonl` (single `os.write` with a short-write check); `changedetect.prune_old_artifacts` (only `snapshots/*.json` and `logs/run-*.log`) | A short append raises `OSError` rather than silently truncating |

---

## 4. (c) Failure and degradation modes

Each row states the **required human-visible outcome** — what the operator must be able to see without reading code. "Visible" means: in a toast if the channel works, and **always** in `alerts/alerts.jsonl`, which is the canonical evidence record.

| # | Mode | Trigger | Routine's behaviour | Required human-visible outcome | Rule at risk |
|---|---|---|---|---|---|
| **F1** | **Missed day** — machine asleep/off at 08:35, task skipped, or the run crashed before the ledger | `last_attempt_day != today` or `last_outcome ∉ SUCCESS_OUTCOMES` at 23:50 | `watchdog.py` emits one `MISSED_DAY` alarm the same evening; the **next** run emits one `MISSED_DAY` per uncovered day in band | A `[FreeCash] MISSED DAY <day>` message naming `last_success` and `consecutive_missed_days`, with the explicit line `ACTION: No action taken. Investigate why no check ran`. Same evening, not a day later. **Zero extra reads** — no back-fill | R1 |
| **F2** | **Duplicate run** — Task Scheduler fires twice, an operator runs it by hand, a wrapper retries | Day lock exists | Exactly one `SKIP_DUPLICATE_DAY` line in `alerts.jsonl`, `SKIP_DUPLICATE_DAY <day>` on stdout, exit **0**; no read, no snapshot, no ledger write | One info-level `SKIP_DUPLICATE_DAY` line. **Not an error and not an alert** — deliberately quiet, so a legitimate scheduler retry does not train the operator to ignore alarms | R1 |
| **F3** | **Read failure** — source down, DNS/route change, 401/403, timeout, 404, unparsable JSON, or the substitute source refusing connections | Any `ReadError` / `ForbiddenWriteError` / `MetricError` from the read | `RUN_FAILED` notification with the exception type and message; `last_outcome = READ_FAILED`; **`last_success_day` not advanced**; day lock stays; **exit 5**; no re-run today | A `[FreeCash] RUN FAILED <day>` message containing `Day lock: CONSUMED (no automatic re-run today - R1)`, the attempt/success day pair, and `ACTION: No action taken.` Plus a non-zero Task Scheduler result. The day is also reported as missed by the watchdog | R1, R3 |
| **F4** | **Delivery failure** — toast suppressed (Focus Assist / quiet hours), PowerShell blocked, no interactive session, or the SMTP path misconfigured | Sender raises on both attempts | ≤2 attempts; one `DELIVERY_FAILED` line with the **full original message**; key marked `FAILED_TOAST`; one `MONITOR_DEGRADED` line stating the message exists only in the log; no further retry of that key; run still exits 0 | The alert text is **preserved verbatim in `alerts.jsonl`** — the operator must be able to read the lost message without reconstructing it. Weekly runbook check #3 removes the class. Until a human has physically seen one toast, `alerts.jsonl` is the only *proven* channel (see G7) | R3 |
| **F5** | **Timezone / DST change** — `FREECASH_TZ` changed, machine zone changed, or the configured zone is unresolvable (the live case: `py -3` = 3.14.7 has no IANA database) | Ledger's stored `timezone` ≠ `gate.tz_name()`, or `timezone_report()["kind"] == "system-local"` | `MONITOR_DEGRADED` (severity `alert`) on a tz change; on an unresolvable zone, `MONITOR_DEGRADED` (severity `info`) plus stdout `WARNING timezone_unavailable configured=… offset=…`, and the day key falls back to the machine's own local zone | A message stating the configured zone was **not** honoured and which zone is in use. The operator must be able to see that the day boundary moved. Acceptable outcome: a possible 2-day or 0-day gap, **explicitly reported** rather than silently absorbed. DST itself is a non-event because the run time (08:35) is far from the 02:00–03:00 transition and the day key is computed from the wall clock at run time | R1, R3 |
| **F6** | **Stale pending approvals** — items wait indefinitely by design | `status == PENDING` and no `APPROVAL_PENDING` line for that id in ≥7 days | `nag_pending` emits **at most one reminder per item per 7 days**. A reminder never decides, never expires, never executes | A `[FreeCash] APPROVAL PENDING <day>` message naming the approval id, what changed, `Waiting since: … (no expiry - this item waits indefinitely)`, the file to read, and the exact `decide` command. **The required outcome is that the queue gets *noisier*, never that it gets cleared automatically.** No status change is permitted | R4 |
| **F7** | **No data for today** — operator did not type figures, or the metrics source is unreachable | `source["data_available"] is False` | Snapshot written with **null** fields and `degraded: true`; `outcome = MONITOR_DEGRADED`; nothing is compared and nothing is notified | A message stating `No data for <day> (<reason>). Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists.` The day counts as a **degraded success** — it does not masquerade as a verified check | R3 |
| **F8** | **Malformed / corrupt state** | `last-run.json`, `pending.json`, `notified-keys.json` or a snapshot fails to parse | `paths.read_json` returns the caller's default instead of raising, so the run can proceed and report; a ledger read is never the R1 gate | The run continues and the condition surfaces as a degraded/`SKIP_DUPLICATE_DAY`/`MISSED_DAY` outcome. **A corrupt ledger must never be able to cause a second read** — that is the reason the ledger is not the gate | R1 |
| **F9** | **Simultaneous independent tasks** — someone runs `run_daily_check.py` by hand at 08:36 | Day lock held | Second process does no work (F2) | As F2. Note the reverse direction is also safe: the *scheduled* run cannot be pre-empted, because the lock is taken by whoever creates it first and the scheduler setting `IgnoreNew` prevents a second instance | R1 |
| **F10** | **A change re-detected on a later day** | Same field/values, different `day_key` | The dedupe key includes the day, so the key differs and the change **does** notify again | A fresh notification. Required, because "still different from yesterday" is new information each day | R3 |

**Failure paths that must never happen** (assert these in review; a single occurrence is a defect, not a degradation):

1. A failed run exits **0**.
2. A failed read is retried within the same day.
3. A `PENDING` item's status changes without a human `decide`.
4. Any file contains the string `EXECUTED` as an `execution_state` value.
5. A `PENDING` item's `expires_at_utc` is non-null.
6. A duplicate invocation writes a snapshot or modifies `last-run.json`.
7. A past day is read to back-fill it.
8. A read request is sent with a method outside `{GET, HEAD}`, to a non-loopback host, or with a body.
9. A "no change" report is presented without the degraded/unverified labelling.
10. A credential appears in the repository or under the state root.

---

## 5. (d) Scheduling design on Windows

**Mechanism: Windows Task Scheduler, two tasks, and no other entry point.** Scheduled execution is not native cron on this host — `command -v crontab` → `crontab NOT FOUND`, and no CI runner exists (`ls .github/workflows` → `No such file or directory`). Task Scheduler is present and queryable (`schtasks` on PATH at `C:\WINDOWS\system32\schtasks`), and — unlike a Hermes cron entry — it can wake a hibernating machine and does not depend on a gateway daemon being alive.

### 5.1 Task A — the daily check

| Property | Value | Why |
|---|---|---|
| **Name** | `FreeCash-Daily-Monitor` | Verified unused: `schtasks /query /TN "FreeCash-Daily-Monitor"` → `FEHLER: Das System kann die angegebene Datei nicht finden` |
| **Trigger** | Daily, **08:35 local** | §5.5 |
| **Multi-instance policy** | `MultipleInstances = IgnoreNew` | Scheduler-level R1 backstop in addition to the atomic lock |
| **Missed-start policy** | `StartWhenAvailable = true` | A missed 08:35 still runs once, late, the same local day — **R1 still holds**, because the day lock is per-day, not per-time. A 09:10 run and a 08:35 run cannot both consume the day |
| **Restart-on-failure** | **Do not restart** | A restart would be a same-day second run. R1 says once. This must be set explicitly — Task Scheduler's default restart behaviour is unsafe here |
| **Run whether logged on** | Decide once, in writing (see §5.6) | |
| **Program/script** | `cmd.exe` | Needed for redirection |
| **Add arguments** | `/c "D:\AgenticOS\monitoring\freecash\run-task-a.cmd"` | The wrapper `.cmd` (below) owns the interpreter path, the data root, the working directory and the log name — so none of them depend on the scheduler's inherited environment or the machine locale |
| **Start in (working directory)** | `D:\AgenticOS` | The routine's modules are imported as **top-level** modules (`import paths`), not as a package. That resolves because Python puts the *script's* directory on `sys.path`, so the working directory is not load-bearing for imports — but it is set anyway so any relative path in a future change resolves predictably, and so `FREECASH_REPO_ROOT` defaults behave |
| **Interpreter** | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (**absolute**, pinned) | §5.4 |
| **Log destination** | `D:\AgenticOS\data\freecash-monitor\logs\run-latest.log` (append), with per-run detail already recorded by the routine in `alerts/alerts.jsonl` | §5.3 |

Wrapper (a **new** file; creating it is a change, not a convention):

```cmd
@echo off
REM D:\AgenticOS\monitoring\freecash\run-task-a.cmd
REM Pins interpreter, data root and log path so the scheduled run cannot be
REM affected by an inherited or stale environment variable. R1/R2/R3/R4 apply.
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"
set "FREECASH_TZ=Europe/Berlin"
set "FREECASH_TOAST_STUB="
if not exist "D:\AgenticOS\data\freecash-monitor\logs" mkdir "D:\AgenticOS\data\freecash-monitor\logs"
"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe" ^
  "D:\AgenticOS\monitoring\freecash\run_daily_check.py" ^
  1>>"D:\AgenticOS\data\freecash-monitor\logs\run-latest.log" 2>&1
exit /b %ERRORLEVEL%
```

Registration (`schtasks /create` cannot set `WakeToRun` / `StartWhenAvailable` / `MultipleInstances`, so use PowerShell — **operator-gated, requires elevation for `-RunLevel Highest`**):

```powershell
$py = "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
$action  = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument '/c "D:\AgenticOS\monitoring\freecash\run-task-a.cmd"' `
  -WorkingDirectory "D:\AgenticOS"
$trigger = New-ScheduledTaskTrigger -Daily -At 08:35
$set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
  -RestartCount 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "FreeCash-Daily-Monitor" `
  -Action $action -Trigger $trigger -Settings $set -RunLevel Highest
```

**Do not register the design's literal `py -3 …` command** from `ROUTINE-DESIGN.md` §7.1 — see §5.4.

### 5.2 Task B — the watchdog

Identical shape, with these differences:

| Property | Value |
|---|---|
| Name | `FreeCash-Missed-Day-Watchdog` |
| Trigger | Daily, **23:50 local** |
| Program | `cmd.exe` / `/c "D:\AgenticOS\monitoring\freecash\run-task-b.cmd"` |
| Start in | `D:\AgenticOS` |
| Log | `D:\AgenticOS\data\freecash-monitor\logs\watchdog-latest.log` |
| Exit code | Always 0, by design — the watchdog has no failure state that should trigger a scheduler restart |
| Network | The watchdog opens **no** socket: it does not import `readonly_client` at all (verified: its imports are `sys`, `changedetect`, `gate`, `notify`, `paths`). It never writes the ledger, never creates or clears a day lock, never writes a snapshot and never touches the approval queue. Its only writes are the alarm itself (`alerts/alerts.jsonl`) and the dedupe index that stops the same alarm firing twice in a day (`state/notified-keys.json`) |

The watchdog's job is the one thing the in-band detector cannot do: make a silently skipped 08:35 run visible **the same evening**, while the operator can still act.

### 5.3 Log destination

- **Task A stdout/stderr** → `...\logs\run-latest.log` (append, wrapper-computed). The wrapper also `mkdir`s `logs\` first: **the redirect must not fail because the directory does not exist**, and on a first-ever run it does not (`data/freecash-monitor/` is absent today — verified).
- **The canonical record is not the log file.** It is `alerts/alerts.jsonl` — append-only, one JSON object per line, with `event_id`, `ts_utc`, `day_key`, `event_type`, `dedupe_key`, `severity`, `message`, `observed`. Every outcome of every run appears there, including `SKIP_DUPLICATE_DAY`, `OK_NO_CHANGE`, `MISSED_DAY`, `RUN_FAILED`, `DELIVERY_FAILED`, `MONITOR_DEGRADED`, `INITIAL_BASELINE`, `APPROVAL_PENDING`. Retention: `logs/run-*.log` older than 30 days are pruned by `changedetect.prune_old_artifacts`; `alerts.jsonl` and `decisions.jsonl` are **never** pruned.
- **Do not use `%DATE%` in the redirect.** It is locale-dependent (`(Get-Date).ToString('d')` on this host is `de-DE` → `18.09.2026`). A fixed `-latest.log` plus the routine's own per-day detail in `alerts.jsonl` is locale-proof and avoids a filename explosion.

### 5.4 Interpreter — the pinning is not optional

| Invocation | Resolves to | Version | `ZoneInfo("Europe/Berlin")` |
|---|---|---|---|
| **`C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`** (the pin) | the Hermes venv | **3.11.9** | **OK** — `Europe/Berlin OK -> 2026-09-20`; `tzdata 2025.3` present |
| `py -3` | `C:\Python314\python.exe` | 3.14.7 | **FAIL** — `zoneinfo._common.ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` |
| `py -3.11`, uv 3.11.16 | base installs | 3.11.x | **FAIL** (no `tzdata`) |
| `python3` | WindowsApps Store redirector | — | not Python at all — "Python wurde nicht gefunden" |

`gate.day_key()` is the **first** thing that decides whether today has been consumed. On a `py -3` task the zone lookup would fail before the lock is created — so the design's literal command turns an R1 guarantee into a crash-loop. In revision B the failure is *softer and worse*: `gate.resolve_tz` catches the lookup failure and falls back to the machine's own local zone, sets `kind = "system-local"`, and the run emits `MONITOR_DEGRADED` (severity `info`) instead of dying. The run then proceeds on a day key derived from a zone the operator did not configure. **Both outcomes are unacceptable for a scheduled task**, which is why the interpreter is pinned to an absolute path in the wrapper rather than being left to `PATH` or the Python launcher.

Equivalent remedies, in order of preference: (1) pin the absolute venv path (above, needs no install); (2) `py -3.11 -m pip install tzdata` for the launcher's interpreter and pin `py -3.11`; (3) set `FREECASH_TZ=UTC` **only if** the operator accepts a UTC day boundary, which changes what "one check per day" means. Option 3 is a rule change, not a fix.

### 5.5 Why 08:35 local

| Reason | Detail |
|---|---|
| After the provider's day-rollover settles | Earnings/status rollovers usually land in the EU early morning; 08:35 avoids reading a half-rolled ledger |
| Before the operator's working day | A pending approval created at 08:35 is visible while a human is at the keyboard — R4's "waits indefinitely" is safer when someone is awake to see it |
| Away from DST | 02:00–03:00 is where a local-time trigger can double-fire or skip; 08:35 is immune, so the day key is never ambiguous |
| Away from midnight | 00:00–03:00 collides with backups, rollover jobs and machine-sleep windows |
| Not too late | A late-evening run pushes the human decision to the next morning — a full 24 h of latency on R4 |

`DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` §12.2 proposed 08:00; 08:35 is preferred for the reasons above and matches `ROUTINE-DESIGN.md` §7.2. **Pick one and record it**; the watchdog's 23:50 only needs to be after it.

### 5.6 `config/freecash-crontab` is documentation only — three independent reasons

`config/freecash-crontab` is **never** an execution path on this host:

1. **There is no cron.** `command -v crontab` → `crontab NOT FOUND`, and WSL is not installed. The file is a POSIX crontab-format note; nothing reads it.
2. **Its command is not runnable as written.** The single line is `0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py >> …/logs/freecashioc_$(date +\%Y-\%m-\%d).log 2>&1`. It contains the literal placeholder `/path/to/AgenticOS/`, invokes **`python3`** (which on this host is the WindowsApps Store redirector, not Python), and writes to a log name with a typo (`freecashioc_`). It would fail even on a host with cron.
3. **Its target is the wrong program.** `scripts/make_freecash_check.py` is not the routine. It resolves its own data directory with `BASE = Path(__file__).resolve().parents[2]` → `D:\data\freecash`, not the routine's state root, and `AUDIT-RULE-COMPLIANCE.md` records a **latent R2 violation** in it: `prepare_actions()` builds `{"type": "withdraw", "amount": …}` and the execute loop calls `run_action(a)` for every approved action. Today `run_action` is a no-op, but **the withdraw path is wired and pre-approved for implementation, and this crontab file points at it.** Leaving the file in place as "documentation" is acceptable only if it is labelled; pointing any scheduler at it is not.

**Required treatment:** keep the file for provenance, but (a) add a header line stating it is **documentation only, not the schedule**, that the real schedule is Task Scheduler per this plan, and that the target is superseded and must not be registered; and (b) replace §5.1's design reference so no one re-derives the `py -3` command from `ROUTINE-DESIGN.md` §7.1. Both are documentation edits, not code changes, and neither is part of this deliverable.

### 5.7 Registration procedure and how to verify it

```bash
# 1. Pre-flight: the suite and the static checker must both be green FIRST (see §7 O3)
python D:/AgenticOS/monitoring/freecash/tests/run_all.py          # expect tests=52 failures=0 errors=0
python D:/AgenticOS/monitoring/freecash/verify_readonly.py        # expect exit 0
sha256sum monitoring/freecash/*.py                                # compare with §1.2

# 2. Register both tasks (elevated, once) — see §5.1 / §5.2
# 3. Prove the task actually runs and consumes exactly one day:
schtasks /Run /TN "FreeCash-Daily-Monitor"
ls D:/AgenticOS/data/freecash-monitor/state/day-locks/            # expect <today>.lock
schtasks /Run /TN "FreeCash-Daily-Monitor"                        # second invocation
#    expect stdout "SKIP_DUPLICATE_DAY <day>" in logs/run-latest.log and exit 0
grep -c SKIP_DUPLICATE_DAY D:/AgenticOS/data/freecash-monitor/alerts/alerts.jsonl   # expect 1
cat D:/AgenticOS/data/freecash-monitor/state/last-run.json        # last_attempt_day == today, one write

# 4. Prove the watchdog alarms when the day is uncovered:
#    (do this on a day where Task A was NOT run)
schtasks /Run /TN "FreeCash-Missed-Day-Watchdog"
grep MISSED_DAY D:/AgenticOS/data/freecash-monitor/alerts/alerts.jsonl

# 5. Confirm the settings actually landed:
schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST
```

The registration itself is a **change to the host**, is human-gated (elevation), and is **not** performed by this plan.

---

## 6. (e) Open gaps between this design and the code that exists today — ranked

Ranking is by **(probability × impact) within the first 30 days**, most severe first. G13 is a cross-plan coordination gap and is deliberately appended **after** the ranked list rather than interleaved, because it is conditional on two independently-written plans both being carried out. "Revision B" = §1.2.

### Rank 1 — G1: nothing is scheduled and the routine has never run in production. **The design exists; the operational routine does not.**
`schtasks /query /fo CSV /nh | grep -icE "freecash"` → `0`. `data/freecash-monitor/` does not exist on disk. Every rule is therefore enforced only in a test harness, which is exactly the "ONLY-IN-TEXT" failure class `AUDIT-RULE-COMPLIANCE.md` documented for the legacy artifacts. **Impact: total** — R1–R4 protect nothing until a task exists.
*Close by:* §5.1/§5.2 registration plus §5.7 step 3.

### Rank 2 — G2: a stale `FREECASH_DATA_ROOT` in the ambient environment silently relocates the entire state tree.
`python -c "import os;print(repr(os.environ.get('FREECASH_DATA_ROOT')))"` → `'C:\\Users\\cd-pr\\AppData\\Local\\Temp\\fcv4-probe/live'`. `paths.data_root()` prefers that variable over `DEFAULT_DATA_ROOT`. If a task is registered without pinning the variable, then **the ledger, the day locks, the snapshots, the notified-keys index and the approval queue all land under `%TEMP%`** — where they can be cleaned at any time. Losing `state/day-locks/` means the next run re-acquires the day and **reads a second time (R1 broken)**; losing `snapshots/` means `load_prior_snapshot` returns `None`, `compare` reports `baseline`, and **R3 goes permanently silent while reporting success** — the exact failure mode of the legacy script, arrived at by a different route. **Impact: high, and silent.**
*Close by:* the wrapper's explicit `set "FREECASH_DATA_ROOT=…"` (§5.1) and, independently, a startup assertion that refuses to run when `FREECASH_DATA_ROOT` resolves under a temp directory.

### Rank 3 — G3: the interpreter pin is the difference between a working day key and a quiet rule-1 violation.
Only the Hermes venv interpreter resolves `Europe/Berlin` (`python --version` → 3.11.9, `tzdata 2025.3`); `py -3` is 3.14.7 and raises `ZoneInfoNotFoundError`. Revision B **catches** that (fallback to system-local + `MONITOR_DEGRADED`), which converts a loud crash into a quiet, correct-looking run on an unconfigured day boundary. **Impact: high.** 08:35 is far from the DST transition, so this is not a daily breakage — but it is the difference between "one check per *operator-local* day" and "one check per *whatever zone Python guessed*", which is a rule-1 scope change the operator did not make.
*Close by:* absolute interpreter path in the wrapper (§5.1) plus `pip install tzdata` for the launcher as belt-and-braces; and treat `MONITOR_DEGRADED` with `condition=timezone_unavailable` as a **pre-flight failure**, not an info line.

### Rank 4 — G4: the provider read contract is unresolved, so every snapshot is `degraded: true` and R3 has no real input.
`readonly_client.py:60 PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`; no provider path is in `ALLOWED_PATHS`. `changedetect.build_snapshot` sets `"degraded": True` unconditionally. **Consequence: the routine can report `OK_NO_CHANGE` every day, correctly and honestly, while proving nothing about the account.** This is the highest-value gap in terms of *revenue signal* and the lowest-value in terms of *effort* — it is a business/ToS decision (`freecash.com` automation is prohibited by its own terms, per `PROVIDER-API-RESEARCH.md`), not a coding task, and its effort is genuinely unknown. **Impact: high (silent false confidence), pre-existing and acknowledged.**
*Close by:* §7 O2. Until closed, every status report must state "operational but unverified" rather than "30 days green".

### Rank 5 — G5: the default read source requires a human to type figures daily, and nothing schedules or enforces that.
`DEFAULT_SOURCE = "operator_state"`; `operator_state.read_source(day)` returns `data_available: False` unless a record exists whose `day_key` equals today **exactly**. There is no reminder task, no staleness alarm and no editor UI. **Impact: medium-high** — the routine's R3 signal depends on a manual daily action that the plan never made anyone responsible for. The realistic failure is `MONITOR_DEGRADED` every day with nothing compared.
*Close by:* either a scheduled reminder, or a readiness check at the top of Task A that escalates a missing record to `READ_FAILED`-class severity, or accepting G4's route instead.

### Rank 6 — G6: the substitute `metrics_http` source cannot work on this host at all.
The allowlist targets `http://localhost:3001/api/v1/status/metrics` and `/api/v1/status` (`readonly_client.py DEFAULT_BASE_URL`, `METRICS_PATH`, `STATUS_PATH`). `IMPLEMENTATION-PLAN-V3.md` §1(g1–g2) recorded: **connection refused on 3001 (no listener)**, and on the live AgenticOS port 4600 `/api/health` → 200, `/api/revenue/metrics` → 200, but `/api/v1/status/metrics` and `/api/v1/status` → **404**. `/api/revenue/metrics` returns opportunity/stage fields and **no money or account-status fields**, so it cannot populate the four compared fields even as a substitute. **Impact: medium** — the only non-manual path is dead.
*Close by:* §7 O2.

### Rank 7 — G7: the toast channel's *visual* delivery has never been observed.
`IMPLEMENTATION-PLAN-V3.md` §1(e) verified PowerShell 5.1 + `System.Windows.Forms.NotifyIcon` loads, an icon assigns and `Dispose()` is clean — and deliberately did **not** pop a balloon. Focus Assist / quiet hours / non-interactive sessions can suppress it. **Impact: medium** — and it is partly mitigated by design: `dispatch` preserves the full message in `alerts.jsonl` on failure, so the *information* survives even when the *notification* does not. But until a human has seen one balloon, **`alerts.jsonl` is the only proven channel** and R3's human-notification half is only half-verified.
*Close by:* one human observation, recorded in the runbook, of a real toast on this desktop.

### Rank 8 — G8: there is no gate that runs the tests, and the tree is being edited concurrently.
`pytest` is absent on every interpreter (`No module named pytest`), so `RULE-GATE-CHECKLIST.md` step 5 is not executable; the suite is 52 stdlib `unittest` tests run by `tests/run_all.py`. Nothing invokes it automatically. Meanwhile the file hashes changed at `2026-09-20 06:57:40`–`06:59:58` during this session, and across 22 executions of the same command I observed `failures=6 errors=11` (revision A, three consistent runs, all 11 errors the same `NameError`) and `failures=0 errors=0` (revision B, six consecutive runs), with intermediate values of 1, 4 and 5 in between. **Impact: medium** — "the tests pass" is currently a claim about an unrecorded revision. The specific risk is the one already realized in this repo: a green check that certifies nothing (`server/scripts/verify-freecash-rules.mjs` reports `4/4 PASSED` on a file that fails `node --check`).
*Close by:* §7 O3.

### Rank 9 — G9: the dead and broken siblings are still present, still executable-looking, and one of them is the crontab's target.
`server/scripts/freecash-daily-monitor.mjs` fails `node --check` (`SyntaxError: Unexpected token ':'` at line 41) and its `isDailyCheckAllowed()` fails **open**; `server/scripts/verify-freecash-rules.mjs` parses and reports `4/4 PASSED` on that unparsable file with two tautological assertions; `scripts/monitoring/free-cash-daily-check.py` defines `main()` at line 225 and never calls it; `scripts/make_freecash_check.py` uses `parents[2]` (wrong data dir) and contains a wired withdraw path; `config/freecash-crontab` points at that last one; `server/tasks/daily-finance-monitor.py` and `finance-monitor/**` are superseded. Additionally `server/src/adapters/freecashMonitorAdapter.ts` is imported by `domains/jarvisV2/turnController.ts:24` and `domains/jarvisNext/operator/operatorController.ts:4` while **not** being registered in `server/src/services/runtimeRegistry.ts` (`server/src/index.ts:141–145` registers only `HermesAdapter, JarvisAdapter, CodexAdapter, VideoAdapter, HeavyGenAdapter`), and its status payload is a hardcoded `externalConnected: false` (`:206`). **Impact: medium** — the operational risk is a human or a future agent wiring the wrong entry point, which is precisely what the crontab file already does. Never delete them (they are evidence); label them superseded and make the canonical entry point unmissable.
*Close by:* §5.6 labelling, plus a one-line pointer at the top of each superseded file. Adapter integration is a separate, unimplemented workstream and must not be presented as the routine's status source.

### Rank 10 — G10: the pre-flight checklist is stale and unsigned, so the intended gate cannot be run as written.
`RULE-GATE-CHECKLIST.md` step 5 says `py -3 -m pytest monitoring/freecash/tests -k "not live"` and expects `16 passed`; `pytest` is absent and the real suite is 52 `unittest` tests. Its gate table's "Observed result" and "Status" columns and its sign-off table are empty. `ROUTINE-DESIGN.md` §2.3's `--force-recheck` description contradicts the implementation (which refuses it, exit 3). `ROUTINE-DESIGN.md` §7.1 contradicts itself on logon mode. `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` §2 places state at `data/freecash/` while the code uses `data/freecash-monitor`, and `data/freecash/` exists and is empty. **Impact: medium** — documentation drift is how the `4/4 PASSED` class of false green gets re-created.
*Close by:* re-base the checklist on `tests/run_all.py`, resolve the `/IT`-vs-stored-credentials question in writing, and record the `--force-recheck` decision (this plan's position: **refused**, per R1).

### Rank 11 — G11: no heartbeat between 08:35 and 23:50, and the watchdog shares the machine's uptime fate.
If the machine is asleep at both 08:35 and 23:50, nothing alerts at all until the next day's in-band detector — which also needs the machine. There is no external notifier (no SMTP configured, no delivery to a phone). **Impact: medium-low** for a single workstation, higher if the operator travels.
*Close by:* the opt-in SMTP path, or accepting that a powered-off machine is a known, documented blind spot.

### Rank 12 — G12: retention and long-run behaviour are unexercised.
`changedetect.prune_old_artifacts` runs only when `now is None` (production runs) and has never run against a real 90-day-old tree. `alerts.jsonl`, `decided.jsonl` and `notified-keys.json` grow without bound by design; `notified-keys.json` is rewritten whole on every notification (`record_notified_key` does a read-modify-atomic-write), so its cost grows with history. **Impact: low** at 1 run/day and ≤5 changes/day for years, but unbounded-by-design needs to be a conscious choice, and the 90-day snapshot pruning and the 30-day log pruning have never been observed to actually fire.
*Close by:* a synthetic old-tree test once, then leave it alone.

### G13 (appended, out of rank order) — two concurrent plans disagree on the state root, and picking both breaks R1 and R3.
`paths.py` defaults to `DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"` (`paths.py:35`) and prefers `FREECASH_DATA_ROOT` over it (`paths.py:47`). My §1.3 measurements: `data/freecash-monitor` **does not exist**; `data/freecash` **exists and is empty**. Two sibling plans written in the same window (`OPERATIONS-WORKFLOW-PLAN.md` §3/§5, `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` L7/S3a) call the code's default a **state-root mismatch to be aligned** and nominate `D:/AgenticOS/data/freecash/` as canonical; this plan pins `FREECASH_DATA_ROOT` to the **code's default**, `data/freecash-monitor/`. Either root is defensible on its own. **The danger is that both end up in use:** `state/day-locks/` would then exist in two trees, each tree would see its own day as unconsumed, and the day could be **read twice (R1 broken)**; `snapshots/` would be split, so `load_prior_snapshot` would return `None` on alternate days, `compare` would report `baseline`, and **R3 would go silent while every run reported success.** That is the legacy script's failure mode reached from a new direction. **Impact: high, silent, and created by documentation rather than by code.**
*Close by:* one written decision naming a single canonical root, then make it explicit in **both** task definitions (never rely on the default and never rely on an inherited environment variable — see G2), and make the other tree's absence a pre-flight assertion.

---

## 7. (f) The three highest-value next options

Ranked by value delivered per unit of risk. Each is independently shippable; O1 does not depend on O2, and O3 protects both.

### O1 — Register the two tasks on the pinned interpreter with an explicit data root, and observe one honest production day.

- **Expected Effort:** 1.5–2.5 h agent work (wrapper `.cmd` ×2, a startup assertion for G2, the pre-flight script) **+ ~15 min human** (elevation for `-RunLevel Highest`, and the logon-mode decision). No new dependency, no new module.
- **Time-to-Revenue:** **No revenue, and none is possible from this option alone.** What it buys is the transition from "rule-enforced in a harness" to "rule-enforced on a live machine" — and the first *true* operational artifact within ~24 h: day 1's `INITIAL_BASELINE` line in `alerts.jsonl`, a `<today>.lock`, and a `last-run.json` that either advances or does not. If it fails, it fails loudly (`READ_FAILED`, exit 5, or a same-evening `MISSED_DAY`), which is information; if it succeeds silently, the operator at least knows the machine is running it. Earliest possible earnings/status **signal**: none — that requires O2.
- **Dependencies:** G2 fixed (wrapper pins `FREECASH_DATA_ROOT`) and G3 fixed (absolute interpreter path) — **both inside this option**, which is why it is ranked first. Human-gated: elevation, and the `/IT`-vs-stored-credentials decision. Must not register `ROUTINE-DESIGN.md` §7.1's literal `py -3` command. Prerequisite: the suite and `verify_readonly.py` green on the current revision (§7 O3's one-liner), because registering with a red gate is how this repo produced `4/4 PASSED` before.
- **First Concrete Action:** create `D:\AgenticOS\monitoring\freecash\run-task-a.cmd` and `run-task-b.cmd` exactly as in §5.1/§5.2 (new files, nothing existing modified), then in an elevated shell run the two `Register-ScheduledTask` commands, then `schtasks /Run /TN "FreeCash-Daily-Monitor"` **twice** and confirm `data/freecash-monitor/state/day-locks/<today>.lock` exists, the second invocation prints `SKIP_DUPLICATE_DAY <today>` in `logs/run-latest.log`, `alerts.jsonl` contains exactly one `SKIP_DUPLICATE_DAY` line, and `state/last-run.json` was written exactly once with `last_attempt_day == today`.

### O2 — Close the R3 signal gap: get a permitted read source that actually carries the four compared fields, and prove change detection on real figures.

- **Expected Effort:** **4–8 h agent work + an unbounded-time business decision.** The engineering half is small (either add a route to AgenticOS that exposes `account_status` / `earnings_total_cents` / `balance_cents` / `pending_cents`, one allowlist line in `readonly_client.ALLOWED_PATHS` with a justification comment, and one test with a stubbed provider payload); the decision half is not an engineering task at all.
- **Time-to-Revenue:** **This is the only option that can produce a money-relevant signal.** First true signal: the day after the source is live — a real `EARNINGS_CHANGED` or `STATUS_CHANGED` notification with an exact integer-cent delta, which is the first moment the routine can tell the operator something about the account they did not already know. Until it is done, every `OK_NO_CHANGE` is honest but empty, and every status report must carry the "operational but unverified" label.
- **Dependencies:** G4 (the business/ToS decision: `freecash.com` automation is prohibited by its own terms, per `PROVIDER-API-RESEARCH.md`; the alternatives are a first-party route, a documented read API, or committing to the operator-entered path of G5 with the discipline to actually type the figures daily). Also G6 if the substitute route is chosen: `/api/v1/status/metrics` and `/api/v1/status` do **not** exist on this host, so a real AgenticOS route must be named explicitly. Depends on O1 only in the sense that a live signal needs a live schedule to surface it.
- **First Concrete Action:** enumerate, on the live API, whether **any** existing route already carries the four fields — `curl -sS http://localhost:4600/api/revenue/metrics` and the same for `/api/health`, `/api/v1/status/metrics`, `/api/v1/status` — and record the observed bodies. If none does, write the one-page decision: *which permitted source feeds `account_status` / `earnings_total_cents` / `balance_cents` / `pending_cents`, and who types it if a human does*. Then either add the single allowlist regex plus its justification comment and a stubbed-transport test, or bind `operator_state` as the committed path and make G5's daily-typing responsibility explicit.

### O3 — Make the suite a load-bearing gate, pinned to a revision.

- **Expected Effort:** 2–3 h agent work. Stdlib only, no new dependency. One pre-flight script (or one wrapper line), one recorded baseline of hashes and exit codes, and the `RULE-GATE-CHECKLIST.md` re-base from `pytest`/16-tests to `tests/run_all.py`/52-tests.
- **Time-to-Revenue:** **None, directly, ever** — this option produces evidence, not signal. Its value is realized the first time it blocks a bad change: today it would have caught revision A's `failure=6 errors=11` and the failing static checker before either was presented as a green state, and it would have flagged that the tree changed mid-audit. A gate that cannot fail is worse than no gate, and this repo has already shipped that mistake once (`verify-freecash-rules.mjs`, `4/4 PASSED` on a file that fails `node --check`).
- **Dependencies:** none. Must use `python` (venv 3.11.9), not `py -3`, for any test that touches the day key — or `pytest`/`tzdata` first. The measurable definition of done is: `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0` **and** `python monitoring/freecash/verify_readonly.py` → exit 0 **and** `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → exit 0, all three recorded **together with `sha256sum` output** so the green is attached to a revision rather than to a moment. Treat `verify_readonly.py`'s exit 2 (target missing) as a **failure**, never as "nothing to check".
- **First Concrete Action:** run the three commands above and paste their output plus the §1.2 hash list into a single recorded baseline; then add a one-command pre-flight (a small `monitoring/freecash/preflight.sh` or a documented three-line block) and make it a precondition of O1's registration. **Do not build a second verifier** beside the routine's own suite — extend `verify_readonly.py` and `tests/`, which is already the shape the docs prescribe.

### Why this order

O1 first because **right now the routine protects nothing** — R1–R4 are enforced only in a harness, and the highest-probability failure in the next 30 days is simply that nothing runs (G1, G2, G3). O2 second because it is the only path to revenue-relevant signal — but it is gated on a business decision whose effort is unknown, so it must not block O1's cheap, certain, rule-enforcing win. O3 third because it is insurance on the other two rather than a deliverable in its own right: it costs 2–3 h and prevents the one failure this repo has already committed — a green check that certified nothing, while the thing it certified did not run.

---

## 8. Definition of done for this plan

The plan is satisfied when, **on one recorded revision**:

1. `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0`.
2. `python monitoring/freecash/verify_readonly.py` → exit 0, and `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → exit 0.
3. Both scheduled tasks exist with the §5.1/§5.2 settings **verified by `schtasks /Query /V`**, not by assumption, and both run on the pinned absolute interpreter.
4. A 3-day observation window shows: 3 distinct `last_success_day` values, 0 `MISSED_DAY` lines, 0 unaddressed `DELIVERY_FAILED` lines, and exactly 3 `<day>.lock` files.
5. `state/day-locks/` contains one lock per day and **no** day has two snapshots.
6. Every `PENDING` item is still `PENDING`, with `expires_at_utc = null` and `execution_state = NOT_EXECUTED` — including after a 90-day clock advance.
7. A human has physically seen one toast balloon on this desktop.
8. The §6 items G1, G2, G3, G8, G10 are closed; G4, G5, G7 are either closed or **explicitly recorded as open** with the consequence stated (unverified/no-signal); G13 is closed by a single written choice of canonical state root, reflected in both task definitions.
9. No legacy artifact was deleted, and `config/freecash-crontab` is labelled documentation-only.

---

## 9. What this plan does not claim

- It does **not** claim the routine has ever run in production: `data/freecash-monitor/` does not exist.
- It does **not** claim any real earnings, balance, pending or account-status value has ever been read. No source on this machine produces the four compared fields.
- It does **not** claim a toast balloon has ever rendered on this desktop.
- It does **not** claim the suite is green in general — only on the revision pinned in §1.2, measured six consecutive times at ~07:02 on 2026-09-20. The same command line returned `failures=6 errors=11` earlier in the same session on the prior revision.
- It does **not** claim the provider question is resolvable by engineering effort.
- It does **not** re-derive the verdicts in `AUDIT-RULE-COMPLIANCE.md` or the capability probes in `IMPLEMENTATION-PLAN-V3.md`; those are cited as recorded evidence and the parts I independently reproduced are marked as such in §1.3.
- It does **not** register, create, modify or delete any scheduled task, source file, config file or state directory. §5.7 is a procedure for a human to execute.

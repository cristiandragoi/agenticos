# WORKFLOW PLAN — Free Cash Finance Automation (daily read-only status monitor)

**Repository:** `D:\AgenticOS` · branch `hermes-rescue-20260908` · HEAD `8f7463aa6931d57e12ec81b904b98cec04e932cf` (dirty)
**Host:** Windows 11, git-bash (MSYS), non-elevated · **Written:** 2026-10-01 (Europe/Berlin, UTC+02:00), ~09:10 local
**Subject of record:** `D:/AgenticOS/monitoring/freecash/` — entry point `run_daily_check.py`
**Filename note:** additive file. `WORKFLOW-PLAN.md` (delegation `deleg_fec45ca6`) already exists in this directory and is **not modified**; this pass writes `WORKFLOW-PLAN-V2.md` only, per the `-V2` collision convention in `PARENT-BRIEF-17a8732d.md`.
**Mode:** design + measurement. Nothing was registered, no provider was contacted, no credential read, no existing file edited.

**Evidence standard.** Every factual row carries the command run in *this* session and its observed output, or is labelled `INHERITED` (from `DELEGATION-BRIEF.md`, `PARENT-BRIEF-17a8732d.md`, the sibling tracks' evidence files) or `UNVERIFIED`. A `PASS` is never quoted from another session.

---

## 1. Live state measured in this pass (2026-10-01, 08:59–09:10 local)

| # | Command (executed now) | Observed | Reading |
|---|---|---|---|
| E1 | `date` | `Do, 1. Okt 2026 08:59:29` | operator-local clock of record, UTC+02:00 |
| E2 | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock`** | **today's day key is already consumed** (was free at 08:43, consumed at 08:53:46Z) |
| E3 | `ls data/freecash-monitor/snapshots/` | `2026-09-20.json`, `2026-09-30.json`, `2026-10-01.json` (518 B each) | 2026-10-01 snapshot exists and is `data_available:false` (null snapshot) |
| E4 | `cat …/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`**, `timezone=Europe/Berlin` | the degraded run counted as a "success" and reset the miss counter (see §5 hazard) |
| E5 | `wc -l < …/alerts/alerts.jsonl` | `15` | 15 evidence lines; the 15th is the 06:53:46Z `MONITOR_DEGRADED` line |
| E6 | `cat …/state/operator-state.json` | `"records": []` (mtime 2026-09-20) | **no operator reading has ever been entered** → no real figure has ever been monitored |
| E7 | `ls -la …/approvals/` | only `.` and `..` | approval queue empty; no external action ever queued |
| E8 | `sha256sum …/alerts.jsonl …/state/last-run.json …/state/notified-keys.json` | `1b9c7c07…99a8` / `a287a902…3bf9` / `0f28d569…e9dd` | hashes of record for this pass (unchanged before *and* after every command below) |
| E9 | `find data/freecash-monitor -type f -newermt "2026-10-01 09:00"` | *(no output)* | **zero** production files touched between 09:00 and 09:10 by this pass |
| E10 | `sha256sum monitoring/freecash/*.py` | `run_daily_check.py bda54e7d…a54c`, `gate.py 1c726b27…08e7`, `changedetect.py 296c65aa…786b`, `notify.py 9bfca8cd…cb22`, `approval_queue.py 0a2c982f…d506`, `readonly_client.py 5426b56c…cc27`, `operator_state.py 32f0fd72…d4a7`, `paths.py a38ab2e7…1938`, `watchdog.py 11dfa88b…acdd`, `verify_readonly.py 2c91a1fc…0aa0` | the reviewed artifact set is pinned; all statements below are about exactly these hashes |
| E11 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` → `PASS - no unexempted write/earning token found.` / `verify_exit=0` | static read-only gate GREEN at a 28-exemption baseline |
| E12 | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` | `Ran 52 tests in 12.884s` / `OK` / `run_all: tests=52 failures=0 errors=0 skipped=0` / `runall_exit=0` | the routine's own offline suite is GREEN (throwaway root) |
| E13 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · `gate_exit=1`; R1 failures read `no O_CREAT|O_EXCL … anywhere in the file`, `no calendar-day key derivation found` | the shipped acceptance gate is **RED**, because it scans the entry point file only while the lock (`gate.py:128`) and day key (`gate.py:102`) live in another module; `--package` mode still does not exist (`argparse` exit 2, INHERITED A4) |
| E14 | `./scheduler/freecash-guarded-run.sh check` (no `FREECASH_DATA_ROOT`) | `REFUSED_STATE_ROOT: … UNSET; refusing to run.` / `unset_exit=9` | the pre-flight guard **fires** |
| E15 | `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor ./scheduler/freecash-guarded-run.sh check` | `REFUSED_STATE_ROOT: … resolves to the PRODUCTION root …; refusing to run.` / `prod_exit=9` | the guard blocks production by path normalisation |
| E16 | `FREECASH_DATA_ROOT=<temp> ./scheduler/freecash-guarded-run.sh check` | `SANDBOX_RUN root=…Temp/fc-workflow-suite/…` · `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED … written=True changes=0 notifications=0 approvals=0` / `sandbox_exit=0` | a sandbox run works end to end and notifies nobody |
| E17 | `schtasks /query /fo LIST \| grep -i freecash` | *(no output)*, `schtasks_grep_exit=1` | **no Free Cash scheduled task exists** |
| E18 | `hermes cron list` | `No scheduled jobs.` | **no Hermes cron job exists** |
| E19 | `curl -s -m 5 localhost:4600/api/health` · `…/api/v1/status/metrics` | `200` `{"status":"healthy","pid":32500,…,"gitSha":"8f7463aa…","isDirty":true,…}` · `metrics_http=404` | the app is UP, but the loopback metrics route the routine would read **does not exist** |
| E20 | `git status --short \| wc -l` · `git rev-parse HEAD` | `863` · `8f7463aa6931d57e12ec81b904b98cec04e932cf` | tree dirty (+6 vs the 857 recorded at 08:45: sibling tracks' new docs). No tracked source file was modified by any Free Cash track |

**One-line status (the honest one):** the routine is implemented, its own suite is green (E12) and its static read-only gate is green (E11), but **nothing runs it** (E17, E18), **nothing feeds it** (E6 — `records: []`), **nothing receives it** (toast-only, §8), the shipped acceptance gate is **RED** (E13), and the one day it could have covered — today — was **spent by a verification run at 06:53:46Z** (E2, E3, E4).

---

## 2. Rule set and numbering (read this before any compliance table)

Two numbering schemes are live in this repo and they are **inverted**. Both agree on the four constraints; only the labels swap. This document uses the **operator numbering** (`PARENT-BRIEF-17a8732d` §0 calls it binding), and prints the legacy label beside every rule.

| Operator id | Rule (binding here) | Legacy label in `DELEGATION-BRIEF.md` / `WORKFLOW-PLAN.md` |
|---|---|---|
| **RULE-1** | No automated earning action, ever — read-only verbs and path allowlist only | R2 |
| **RULE-2** | Exactly one status check per operator-local calendar day, DST-safe | R1 |
| **RULE-3** | Notify on balance / earnings / account-status change; no change ⇒ one coalesced line or silence; never a duplicate | R3 |
| **RULE-4** | Human approval before any external action; the queue is never auto-drained and never expires into execution | R4 |

**Operational consequence:** a bare sentence like "R1 PASS" in this workspace is unreadable. Any verdict quoted into the operator's record must state its scheme. The verifier track's gate output does state it (`RULE 1: no automated earning action (legacy label R2)`), and E13's gate does not — E13's `R1` is the once-per-day rule.

Workspace constraints that bind every pass (from `DELEGATION-BRIEF.md` §constraints and `PARENT-BRIEF-17a8732d.md` §4): additive files only; no scheduled task created/enabled/disabled/deleted; the production state root must gain no day-lock, snapshot, alert or approval; pinned interpreter `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`; no provider contact, no credential read/stored/typed, `[REDACTED]` only; no real desktop notification; no git write verb; a PASS only from output quoted in the same session.

---

## 3. Daily timeline (trigger times are a proposal, not a registration)

| # | Local time (Europe/Berlin) | Event | Code path |
|---|---|---|---|
| 0 | 00:00:00 | New calendar day. `gate.day_key()` yields a fresh `YYYY-MM-DD`; yesterday's lock is historical, not a barrier. | `gate.day_key` (`gate.py:96-102`) |
| 1 | **08:35** | **Task A — pre-flight guard** (does today's reading exist in `operator-state.json`?). If absent → refuse, exit 9, consume nothing. | guarded wrapper (§11) |
| 2 | 08:35 | **Task A — the once-per-day check.** Atomic exclusive-create `state/day-locks/<day>.lock`; already present ⇒ `SKIP_DUPLICATE_DAY`, no read, exit 0. | `gate.acquire_day_lock` (`gate.py:119-135`) |
| 3 | 08:35 | Record the attempt; compute missed days strictly between `last_success_day` and today. | `gate.record_attempt` / `gate.missed_days` |
| 4 | 08:35 | One `MISSED_DAY` line per uncovered gap day (never back-filled). | `notify.notify_change` |
| 5 | 08:35 | Read today's figures from the selected read-only source (`operator_state` default; loopback `metrics_http` opt-in, currently 404 — E19). | `run_daily_check.read_source` |
| 6 | 08:35 | Load the **prior** snapshot **before** writing today's; write the snapshot once. | `changedetect.load_prior_snapshot` / `save_snapshot` |
| 7 | 08:35 | Compare four exact fields; none changed ⇒ one log-only `OK_NO_CHANGE`. | `changedetect.compare` / `notify.emit_no_change` |
| 8 | 08:35 | Changed ⇒ one line per change; notify each change at most once (dedupe key recorded before dispatch); >5 changes coalesce to one summary. | `run_daily_check.notify_changes` |
| 9 | 08:35 | Enqueue one PENDING approval item per notified change (first 5). Nothing executes on it. | `approval_queue.enqueue` |
| 10 | 08:35 | Nag any PENDING item not mentioned for 7 days (max one reminder per item per 7 days). | `run_daily_check.nag_pending` |
| 11 | 08:35 | Retention (snapshots 90 d, run logs 30 d; alert log and decision trail never pruned) + record the outcome. | `changedetect.prune_old_artifacts` + `gate.record_outcome` |
| 12 | manual | A human decides a queued item, naming themselves. | `approval_queue.py decide --id … --by "<name>"` |
| 13 | **23:50** | **Task B — watchdog.** Same-evening coverage alarm: opens no socket, runs no check, writes no lock/snapshot. One deduped `MISSED_DAY` per uncovered day. | `watchdog.check` |

Why 08:35 / 23:50: `INHERITED` from the V8 plan. **Neither is registered** (E17, E18).

---

## 4. Step table — step / code path / artifact / rule

Artifacts are under the data root `data/freecash-monitor/` (`paths.DEFAULT_DATA_ROOT`, `paths.py:35`) unless stated.

| # | Step | Code path | Artifact | Rule |
|---|---|---|---|---|
| S1 | Consume the day | `gate.acquire_day_lock` — `os.open(…, O_CREAT\|O_EXCL\|O_WRONLY)` (`gate.py:128`) | `state/day-locks/<day>.lock` (0 B) | RULE-2 |
| S2 | Duplicate-day no-op | `run_daily_check._run` → `notify.alert("SKIP_DUPLICATE_DAY")` | one `alerts.jsonl` line | RULE-2 |
| S3 | Record attempt | `gate.record_attempt` | `state/last-run.json` | RULE-2 |
| S4 | Missed-day arithmetic | `gate.missed_days` | in-memory (no back-fill) | RULE-2 |
| S5 | Missed-day alert | `notify.notify_change(…, "MISSED_DAY")` | one line per gap day | RULE-2 |
| S6 | Degraded/timezone fallback | `gate.timezone_report` → `notify.alert("MONITOR_DEGRADED")` | `alerts.jsonl` | RULE-2 |
| S7 | Read (operator-entered) | `operator_state.read_source(day)` | none | RULE-1 |
| S7b | Read (loopback metrics, opt-in; route currently 404) | `readonly_client.read_status_source` → `GET` + `HEAD` | none | RULE-1 |
| S8 | Transport guard | `readonly_client.request` — method/host/path/body allowlists; single socket site `_transport` | none — raises `ForbiddenWriteError` **before** any socket | RULE-1 |
| S9 | Process-level guard | `readonly_client.install_audit_guard()` → `sys.addaudithook` | none | RULE-1 |
| S10 | Static read-only gate | `verify_readonly.run()` | stdout report + exit code | RULE-1 |
| S11 | Load prior snapshot | `changedetect.load_prior_snapshot` | none | RULE-3 |
| S12 | Build + write snapshot | `changedetect.save_snapshot` (immutable; never rewritten) | `snapshots/<day>.json` | RULE-3 |
| S13 | Compare | `changedetect.compare` (four exact fields) | in-memory | RULE-3 |
| S14 | No-change log | `notify.emit_no_change` | one `OK_NO_CHANGE` line | RULE-3 |
| S15 | Initial baseline | `notify.emit_initial_baseline` | one `INITIAL_BASELINE` line | RULE-3 |
| S16 | Change notify (deduped) | `notify.record_notified_key` (**before** dispatch) → `notify.notify_change` | `state/notified-keys.json` + alert line | RULE-3 |
| S17 | Coalesce >5 | `run_daily_check.notify_changes` (`MAX_NOTIFICATIONS = 5`) | one summary line | RULE-3 |
| S18 | Enqueue approval | `approval_queue.enqueue` | `approvals/pending.json` item (`status=PENDING`, `expires_at_utc=null`, `execution_state=NOT_EXECUTED`) | RULE-4 |
| S19 | Approval-pending alert | `notify.alert("APPROVAL_PENDING")` | alert line | RULE-4 |
| S20 | Human decision only | `approval_queue.decide` | `pending.json` update + `approvals/decided.jsonl` | RULE-4 |
| S21 | Re-nag pending | `nag_pending` / `nag_due` (`NAG_INTERVAL_DAYS = 7`) | alert line | RULE-4 |
| S22 | Watchdog coverage alarm | `watchdog.check` | alert line + dedupe index | RULE-2 |
| S23 | Retention | `changedetect.prune_old_artifacts` | deletes only old snapshots / run logs | RULE-2 |
| S24 | Record outcome | `gate.record_outcome` | `state/last-run.json` | RULE-2 |

---

## 5. Control matrix — requirement, enforcing code, artifact, how it was falsified here

| Rule | Requirement | Enforcing code (pinned hash, E10) | Artifact on disk | Falsification evidence |
|---|---|---|---|---|
| **RULE-1** | Zero automated earning actions; GET/HEAD + path allowlist only, enforced in code plus a CI grep for forbidden write tokens | `readonly_client.request` (`ALLOWED_METHODS`, loopback `ALLOWED_HOSTS`, regex `ALLOWED_PATHS`, body-keyword rejection), single socket site `_transport`, audit hook; static gate `verify_readonly.run` | none (guards raise before any socket); stdout scan report | E11 `forbidden=0 exempt=28 … PASS` exit 0; E12 tests `test_write_method_is_refused_before_any_socket_opens`, `test_every_non_read_method_is_refused`, `test_body_carrying_get_is_refused`, `test_non_loopback_host_is_refused`, `test_only_the_readonly_client_may_reach_a_socket_library` all ok. **Scoped caveat: see §10 blind spots.** |
| **RULE-2** | ≤1 check per operator-local calendar day; DST-safe day key; second invocation no-ops | `gate.acquire_day_lock` (`O_CREAT\|O_EXCL`), `gate.day_key` (`zoneinfo`, IANA), second detector `watchdog.check` | `state/day-locks/<day>.lock`; `state/last-run.json`; `snapshots/<day>.json` | E2 (only 09-20 / 09-30 / 10-01 locks); E12 tests `test_second_run_skips_with_no_side_effects`, `test_five_concurrent_runs_yield_one_winner`, `test_local_day_differs_from_utc_day_near_midnight`; E16 sandbox run produced exactly one lock; E15/E14 the refusal path fires before the entry point |
| **RULE-3** | Notify on balance/earnings/status change vs prior snapshot; no change ⇒ one coalesced line or silence; never a duplicate | `changedetect.compare` + `dedupe_key = sha256(day\|type\|field\|old\|new)`; `notify.record_notified_key` written before dispatch; `emit_no_change` (log-only) | `snapshots/<day>.json`; `state/notified-keys.json`; `alerts/alerts.jsonl` | E5 (15 lines); E12 tests `test_earnings_change_notifies_exactly_once`, `test_same_key_is_never_notified_twice_and_the_key_includes_the_day`, `test_no_change_day_is_log_only`, `test_one_cent_is_a_change_because_cents_are_exact`; suite stdout `Run day 2 … outcome=EARNINGS_CHANGED … notifications=1`. **Caveat: every real change so far has been synthetic — `records: []` (E6).** |
| **RULE-4** | Human approval before any external action; queue never auto-drained, never expires into execution | `approval_queue.enqueue`/`build_item` (frozen `expires_at_utc=None`, `execution_state="NOT_EXECUTED"`, `execution_allowed_by_this_routine=False`); `decide` + `_normalise_decider`; **no execution code path exists in the package** | `approvals/pending.json`; `approvals/decided.jsonl` | E7 (queue empty — nothing pending, nothing executed); E12 tests `test_pending_item_survives_a_ninety_day_clock_advance`, `test_past_expiry_plus_approved_status_executes_nothing`, `test_no_module_treats_an_approved_status_as_a_trigger`. **Caveat: identity check is a 10-word denylist (`hermes-agent` ACCEPTED, INHERITED A3) — §10, O-4** |

Rule → artifact summary: RULE-1 ⇒ the *absence* of any write artifact, plus a stdout scan report; RULE-2 ⇒ day-lock + ledger + snapshot; RULE-3 ⇒ snapshot diff + `notified-keys.json` + alert line; RULE-4 ⇒ `pending.json` + `decided.jsonl`.

---

## 6. Idempotence (what a second same-day invocation does)

`gate.acquire_day_lock` is one atomic NTFS syscall on a zero-byte file named by the day key — no read-then-write window to race. The ledger is deliberately not the gate, so a corrupt `last-run.json` cannot cause a second read.

1. `day = gate.day_key(now)` is unchanged within the local day; `acquire_day_lock` returns `(False, lock)`.
2. The `if not acquired` branch appends **exactly one** `SKIP_DUPLICATE_DAY` line, prints it, returns **0**.
3. **No read occurs**, no snapshot, no ledger write (the early return precedes `record_attempt`).

Evidence this pass: E16 sandbox produced exactly one lock; E12 includes `test_second_run_skips_with_no_side_effects` and `test_five_concurrent_runs_yield_one_winner`; the production log already contains a historical duplicate line for 2026-09-30. Also idempotent: `save_snapshot` returns without writing when the file exists, and `write_json_atomic` never leaves a partial file.

`--force-recheck` is refused by design: recorded as `REFUSED` in `logs/forced-recheck-requests.jsonl`, printed `REFUSED_FORCE_RECHECK …`, exit **3**, no second read.

---

## 7. Failure and backoff policy (never retry-until-success)

| Failure | Handling | Bounding rule | Evidence |
|---|---|---|---|
| Read failure (`ReadError` / `ForbiddenWriteError` / `MetricError`) | one `RUN_FAILED` line, `record_outcome(…, "READ_FAILED")` (leaves `last_success_day` unchanged), exit **5**, lock **stays** | `READ_FAILED` is not in `SUCCESS_OUTCOMES`, so the day stays uncovered and is never re-read | E12 `test_read_failure_is_loud_consumes_the_day_and_never_retries` |
| Notification delivery failure | at most **2** attempts, then `DELIVERY_FAILED` with the full original message + `MONITOR_DEGRADED`; key marked `FAILED_TOAST`, never retried | a failed notification never blocks a state write, never re-reads, never touches the queue | E12 `test_delivery_failure_is_bounded_and_keeps_the_full_message` |
| Corrupt/missing state file | `paths.read_json` returns the default instead of raising | the routine always runs and *reports* rather than crash-looping | `paths.py:154-166`, `gate.py:155-163` |
| Scheduler failure (proposed, unregistered) | task definition must carry restart-on-failure = **Do not restart**, `IgnoreNew`, `StartWhenAvailable` | a crashed/skipped day is reported by `RUN_FAILED` / `MISSED_DAY`, never auto-retried | `INHERITED` V8, scheduler track |

**Forbidden anti-pattern:** no loop, timer, cron entry or scheduler retry anywhere in `monitoring/freecash/` re-invokes the read after a failure. The only repeated elements are the bounded notification retry and the 7-day approval reminder; neither re-reads status and neither can execute anything.

**Carried hazard (F-1/C11) — now measured in production twice.** The lock is taken at `run_daily_check.py:309` **before** the source is read at `:372`, so a data-less run consumes the day and records `MONITOR_DEGRADED`, which **is** in `SUCCESS_OUTCOMES`. Evidence: the real root shows `2026-09-30.lock` with a null snapshot and `records: []`, and `2026-10-01.lock` with `last_outcome=MONITOR_DEGRADED` and the miss counter reset to 0 (E2–E4). **A scheduled run that fires before the operator has entered a reading burns the day permanently.** The remedy is the wrapper pre-flight guard (§11), which must land **before** any registration — not a weakening of the lock.

---

## 8. Notification dedupe and escalation

**Dedupe.** Key = `sha256(day_key | change_type | field | old_value | new_value)` — the day is part of the key on purpose (same movement on a later day *is* a new notification; same-day re-detection is already impossible under RULE-2). `record_notified_key` runs **before** the send, so a crash can lose one message but can never duplicate one. `OK_NO_CHANGE` is log-only — a quiet day yields one coalesced line or silence, never an alert. `INITIAL_BASELINE` is log-only: a first run must never raise a fake alarm. `MAX_NOTIFICATIONS = 5`; more than five changes ⇒ exactly one summary notification under a `MONITOR_DEGRADED` key, with one alert line per change.

**Escalation (RULE-4).** Threshold: one PENDING item per notified change, capped at 5. Who: the operator/human owner, surfaced by a notification whose action text is the exact CLI. When nobody answers: **nothing automatic, ever** — `expires_at_utc` is null by construction and re-asserted on every decision; `execution_state` is always `NOT_EXECUTED`; nothing in the package iterates `pending_items()` to act (the only iteration is the 7-day reminder). Real state today: `approvals/` empty (E7).

**Delivery reality (constraint, not a defect to hide):** the only implemented channel is a desktop toast, exercised only offline (`TOAST_STUB`, delivery label `STUB_OK`). No SMTP/webhook/`himalaya` sink is configured, and constraint discipline forbids a real desktop notification during verification. So until a deliberate delivery step lands, a detected change reaches **nobody** — the alert log is the record.

---

## 9. Missed-day path, and the 2026-10-01 incident

**What "missed" means.** Task A's proposed window (08:35) elapsed, so if no lock exists by 23:50, today is missed. RULE-2 permits one check per day, so a missed check **cannot be caught up** — it can only be *reported*.

**How it is reported.** In-band, `gate.missed_days` returns every local day strictly between `last_success_day` and today, excluding both endpoints (so the day about to be checked is not reported as a gap). Same-evening, the 23:50 watchdog marks today `covered` only if `last_attempt_day == today` **and** `last_outcome ∈ SUCCESS_OUTCOMES`, else emits exactly one deduped `MISSED_DAY` alarm. A missed day is **never back-filled**: re-reading a past day would be a second check for that day.

**The incident (measured, INHERITED A6 + re-measured here as E2–E4).** At `2026-10-01T06:53:46Z` the **production** root was driven by a verification pass: it created `state/day-locks/2026-10-01.lock`, `snapshots/2026-10-01.json`, a 15th alert line (`MONITOR_DEGRADED`, "no operator-entered record for 2026-10-01") and rewrote `last-run.json`. Consequences:

1. **2026-10-01 is spent.** It can no longer produce a data-bearing snapshot. The sibling track's own forensics file records the same hashes, the same 15-line count and the same timestamp — two independent passes, one incident.
2. **`consecutive_missed_days` went 9 → 0** (E4), i.e. a data-less degraded run *reset the miss counter*. Any dashboard reading that counter as "the routine is healthy" is now wrong. Treat the counter as "days since the last attempt", not "days since a real reading".
3. **No writer attribution (Q3/C14).** All 15 alert lines carry the same 8 keys; none names a pid or entry point (INHERITED A5). The canonical evidence log therefore cannot, by itself, distinguish a scheduled run from any other writer.
4. **The unguarded path is live and reachable.** The guard that prevents exactly this exists (`scheduler/freecash-guarded-run.sh`, E14–E16 prove it fires) but is **wired into nothing**; the 06:53:46Z run went through the bare entry point, whose default root is production (`paths.py:35`).

**Recovery procedure for the next valid day (2026-10-02), in this order:**

1. Confirm `data/freecash-monitor/state/day-locks/2026-10-02.lock` does **not** exist.
2. Append today's reading to `data/freecash-monitor/state/operator-state.json` — one record with `day_key: "2026-10-02"` and **integer cents** for `earnings_total_cents`, `balance_cents`, `pending_cents` plus `account_status` and `currency`. **Do this before any run.**
3. Run the entry point **once** through the guarded wrapper (or with an explicit non-production `FREECASH_DATA_ROOT`), and quote the line: first data day ⇒ `RUN_OK 2026-10-02 outcome=INITIAL_BASELINE …` (silent baseline — correct, because no prior *data-bearing* snapshot exists).
4. From 2026-10-03 onward, with a second reading, expect `EARNINGS_CHANGED` / `BALANCE_CHANGED` / `STATUS_CHANGED` ⇒ exactly one notification and one approval item each.
5. If no reading can be entered, the honest default is: let the day stay missed, let the watchdog report it at 23:50, and **do not run the monitor**.

---

## 10. Verification layer — what the green gate does and does not certify

Two independent checkers exist for the same package, and they disagree, which is itself the finding:

| Checker | Verdict this pass | Scope |
|---|---|---|
| `monitoring/freecash/tests/run_all.py` (52 tests, offline, sandboxed) | GREEN, exit 0 (E12) | the package's own behaviour as specified |
| `monitoring/freecash/verify_readonly.py` (static token scan) | GREEN `forbidden=0 exempt=28`, exit 0 (E11) | read-only token discipline at a pinned exemption baseline |
| `scripts/monitoring/rule_gate_verify.py` (shipped acceptance gate) | **RED — `R1=FAIL`, exit 1** (E13) | single-file scope: the atomic lock and day key live in `gate.py`, so a file-scoped scan cannot see them; `--package` mode does not exist |
| Sibling verifier gate `rule_gate.py` (AST + runtime, 4/4 PASS on the clean package) | GREEN on `run_daily_check.py bda54e7d…` | per-rule, with detectors actually executed |

**And the green one has blind spots, proven live.** The sibling track's mutation harness ran 10 mutants; **3 were NOT detected**, and a liveness probe showed two of them are *real* violations, not harness artifacts:

| Mutant | Gate said | Reality (probe) |
|---|---|---|
| `adv3-r4-getattr-exec` — queued item executed via `getattr(os, 'sys'+'tem')(…)` | 4/4 PASS (missed) | `EXECUTED 303bf3dc…` — `os.system` really ran |
| `adv4-r1-conditional-backdoor` — obfuscated `POST /api/v1/cashout` fires when `FREECASH_LIVE_READ=1` | 4/4 PASS (missed) | wire showed `('POST','/api/v1/status/cashout') … ('POST','/api/v1/cashout')` with the var set; clean wire without it |
| `adv6-r1-new-socket-file` — a new module importing a socket client | R1 PASS (missed), caught only by R4 | `FORBIDDEN_IMPORTS` has no `http.client`; `PINNED_IMPORTS` pins only `readonly_client.py` |

**Therefore:** a compliance statement may be no stronger than *"the shipped package at the E10 hashes, scanned by an AST layer plus executed detectors, is free of the four rule violations those checks know how to express — the checks demonstrably miss an effect-obfuscated execution, an environment-conditioned write, and a new un-pinned socket file."* It is **not** a claim that the package cannot be made to earn or execute. Two additional scope caveats: the RULE-4 identity check is a 10-word denylist (`hermes-agent` ACCEPTED, INHERITED A3) and the shipped acceptance gate is RED (E13).

**Also broken (scheduler track, INHERITED evidence-10):** both `DECISION-V2-*.xml` Task Scheduler proposals fail XML parsing (`ElementTree.ParseError: not well-formed (invalid token)`, line 4). Nothing can be registered from them as-is.

---

## 11. The pre-flight guard (highest-value control, fixes the day-burning hazard)

`docs/free-cash-monitor-routine/DELEGATION-2026-10-01/scheduler/freecash-guarded-run.sh` already implements the sandbox half: it refuses when `FREECASH_DATA_ROOT` is unset or normalises to `D:/AgenticOS/data/freecash-monitor` (exit 9, entry point never invoked), pins the interpreter and timezone, clears ambient `FREECASH_*` values, and defaults `FREECASH_TOAST_STUB=1` so a sandbox run can never raise a real desktop balloon. **Measured this pass: exit 9 / exit 9 / exit 0 (E14, E15, E16).**

What it does **not** yet do is the other half: refuse to invoke the entry point when **today's `day_key` has no record in `operator-state.json`**. That is the guard that would have saved 2026-09-30 and 2026-10-01. It must be wired into the *production* wrapper (the `freecash-daily.cmd` proposal) before any task is registered, and it must be proven with a falsifiable test: **a data-less day leaves `state/day-locks/` empty.**

---

## 12. Options, with the four required attributes

| # | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| O-1 | **Enter the 2026-10-02 reading and run once, sandbox-guarded** | 5 min | same day, **visibility only** | operator reads their own dashboard; guard wired or explicit `FREECASH_DATA_ROOT` | append one `operator-state.json` record for `day_key: 2026-10-02` with integer cents, then run once through the wrapper and quote `RUN_OK … INITIAL_BASELINE` |
| O-2 | **Pre-flight guard in the production wrapper** (fixes F-1/C11 without weakening the lock) | ~1 h | none | O-1's file format; the existing `freecash-guarded-run.sh` refusal logic | add the "today's record required" refusal; prove a data-less day leaves `day-locks/` **empty** and exits nonzero |
| O-3 | **Repair the acceptance gate** (`--package`; map R1 to `gate.py::acquire_day_lock`) | 2–4 h | none | none | add the package mode; require exit 0 on the package **and** exit 1 on a temp copy whose lock check is non-atomic |
| O-4 | **RULE-4 identity: denylist → operator-editable allowlist** (`state/human-deciders.json`, empty by default) + paired test | 1–2 h | none | operator's own name for the allowlist | ship the paired test in one run: `--by hermes-agent` refused, `--by <operator>` accepted |
| O-5 | **Writer tag on `alerts.jsonl`** (pid + entry point + start time), existing 15 lines byte-identical | 1–2 h | none | none | append-tag a sandbox line and re-verify the production log's hash is unchanged |
| O-6 | **Close the verifier blind spots** (effect-obfuscation, env-conditioned write, new socket module) | 4–6 h | none | O-3's package mode | make `adv3`/`adv4`/`adv6` fail the gate; the liveness probe already proves they are real violations |
| O-7 | **Scheduler handover, unregistered** — repair the two XML files to well-formed, Task A 08:35 / Task B 23:50, `IgnoreNew`, `StartWhenAvailable`, no restart, pinned interpreter | 1–2 h | none | O-2, O-3, operator approval to register (RULE-4) | re-emit both XMLs so `ElementTree.parse` exits 0, then hand over the exact `schtasks /Create` text and **do not register it** |
| O-8 | **Delivery proof / real sink decision** (toast locked+unlocked, or a deliberate SMTP/webhook step) | 1–3 h | none | operator at an unlocked session; for a sink, a credential decision | dispatch one toast unlocked, then locked, and record both labels; if a sink is wanted, write the config proposal (no secret in the artifact) |
| O-9 | **Real read source** — Path B bridged account read through the app's own authenticated session | 4–8 h | 3–7 days, visibility | app is UP now (E19, `8f746aa`); operator login in the managed profile; four-field mapping | call the existing authenticated-session probe once through the app's own code path and quote the artefact; the loopback metrics route is a 404 (E19) and cannot be the source |
| O-10 | **Revenue track** — separate mission `bgtask-07a8154b0` (blocked) | unknown | unknown — **the only revenue hypothesis here** | app up, human decision, app-side re-dispatch | resume the blocked task in the UI and quote the new status; the monitor itself produces **no** revenue |
| O-11 | **Stay manual, no scheduler** | 0 h | none | operator discipline (~5 min/day) | describe the routine as *built and evidenced, unverified in operation* |

**Recommended order:** O-1 → O-2 → O-3/O-4 → O-5/O-6 → O-7 → O-9 → O-8 → O-10, with O-11 as the honest fallback. **Critical path to a routine that is genuinely once-daily, read-only, change-notifying and approval-gated:** O-2 + O-3 (without them, either a scheduled run burns days or no acceptance verdict can be claimed).

---

## 13. OUT OF SCOPE (explicit non-goals)

This plan, and the routine it designs, do **not**:

- Perform, schedule or propose any **earning action** — no click, claim, survey, offer, spin, withdraw, cash out, redeem, payout, deposit, wager or transfer. RULE-1 forbids it and no such code path exists in the package.
- Reach any **provider / consumer platform** endpoint, host or login flow. `ALLOWED_HOSTS` is loopback-only; `PROVIDER_ENDPOINT_UNKNOWN` is kept verbatim.
- Use any **credential, token, secret or session**. None is read, stored or passed; `[REDACTED]` is the only permitted rendering.
- Touch `/transactions`, `/cashout`, `/earn`, `/claim` or any write verb/path — by construction.
- **Register** any scheduled task, cron job or timer, or edit `config/freecash-crontab` (which currently points at a placeholder path and the known-broken stub). Registration is RULE-4 territory: produced as an artifact for human approval, never executed by an agent.
- Modify, move, rename or delete any existing repository file. This document is new and additive.
- Implement a **second monitor** or extend a legacy one. `monitoring/freecash/` is the single implementation of record; the known-bad paths (`server/scripts/freecash-daily-monitor.mjs` — fails `node --check`; `server/scripts/verify-freecash-rules.mjs` — tautological greps; `scripts/monitoring/free-cash-daily-check.py` — never calls `main()`; `scripts/make_freecash_check.py` — `parents[2]` off-by-one, silent exit 0; `finance-monitor/src/rule_engine.py` — SyntaxError; `freecashMonitorAdapter.ts` — hardcoded `externalConnected: false`) must not be cited as compliant or used as a basis.
- **Auto-drain** the approval queue, or resolve a pending item by expiry, timeout, watchdog or scheduler.
- Deliver by **email / SMS / webhook** — no such sink is configured or implemented.
- Guarantee **revenue**. This routine produces *visibility*, not income.
- Claim compliance from a **static grep**, from `rule_gate_verify.py`'s file-scoped verdict, or from a `PASS` quoted out of another session.

---

## 14. Blocked register

| Item | Blocked on | Reason (measured) |
|---|---|---|
| Real account figures in a snapshot | operator reading (`operator-state.json` `records: []`) | no reading has ever been entered; every snapshot is `degraded: true` (E6) |
| A live read-only provider/loopback feed | a documented read contract | `PROVIDER_ENDPOINT_UNKNOWN`; `/api/v1/status/metrics` → 404 while the app is healthy (E19) |
| Any change notification reaching a human | a delivery sink decision | toast-only, stub-only; no SMTP/webhook/`himalaya` configured |
| Registering a schedule | operator approval (RULE-4) + O-2 + O-3 + well-formed XML | nothing registered (E17, E18); both XML proposals fail to parse |
| A green acceptance verdict | `rule_gate_verify.py` fix | `R1=FAIL`, exit 1 on the shipped package (E13) |
| Revenue | app-side re-dispatch of `bgtask-07a8154b0` | blocked mission, not this routine's scope |

---

## 15. Operator paste-block — one manual, read-only run (for a day with a reading)

> Run **only** after the reading for that `day_key` exists in `operator-state.json`. The guarded wrapper refuses production and refuses an unset root, so copy the throwaway-root form only if you intend a rehearsal.

```bash
cd /d/AgenticOS
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"

# 1. Is today's day key free? (read-only)
ls data/freecash-monitor/state/day-locks/          # must NOT list <today>.lock
"$PY" monitoring/freecash/run_daily_check.py --print-state

# 2. Static read-only gate (read-only) — expect forbidden=0 exempt=28 ... PASS, exit 0
"$PY" monitoring/freecash/verify_readonly.py

# 3. Sandbox rehearsal (writes nothing to production)
export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-rehearsal-$(date +%s)/freecash-monitor"
./docs/free-cash-monitor-routine/DELEGATION-2026-10-01/scheduler/freecash-guarded-run.sh check
unset FREECASH_DATA_ROOT

# 4. ENTER THE READING FIRST — append one record to
#    data/freecash-monitor/state/operator-state.json with the day's key and integer cents.

# 5. Then run the real day ONCE (through the wrapper once O-2 lands; today, explicitly):
"$PY" monitoring/freecash/run_daily_check.py --source operator_state

# 6. Inspect (read-only)
ls data/freecash-monitor/snapshots/
"$PY" monitoring/freecash/approval_queue.py list

# 7. A second run the same day is a no-op by design: prints SKIP_DUPLICATE_DAY <day>, exit 0
```

Deciding a queued item is the only human-gated write and still executes nothing:

```bash
"$PY" monitoring/freecash/approval_queue.py decide \
    --id <approval_id-from-pending.json> --decision approve|reject \
    --by "<your name>" --note "<why>"
# execution_state remains NOT_EXECUTED; expires_at_utc stays null.
```

Never run `--force-recheck` expecting a second check (refused, exit 3). Never add a provider host or path to the allowlists — that is a RULE-1 widening and a second transport.

---

## 16. Constraint-compliance ledger for *this* pass

| Constraint | Measurement |
|---|---|
| Production root gains nothing | `sha256sum` before (E8) and after (E9-batch) are **identical**: `alerts.jsonl 1b9c7c07…99a8`, `last-run.json a287a902…3bf9`, `notified-keys.json 0f28d569…e9dd`; `find data/freecash-monitor -type f -newermt "2026-10-01 09:00"` → **0 files** |
| Every execution sandboxed | suite and guard runs used `%LOCALAPPDATA%\Temp\fc-workflow-*` roots; both directories removed at the end |
| Nothing registered | `schtasks /query /fo LIST \| grep -i freecash` → no output, exit 1 (E17); `hermes cron list` → `No scheduled jobs.` (E18) |
| Additive only | this file is new; no tracked file was modified by this pass (`git status --short` = 863, the +6 over the 08:45 reading being sibling-track docs) |
| No provider contact / no credential | no network call to any provider; `curl` used only against `localhost:4600` for a health read (E19); no `FREECASH_*`/`SMTP_*`/`WEBHOOK_*` value read or printed |
| No real notification | all dispatches offline (`TOAST_STUB`); no desktop balloon raised |
| Evidence bar | every `PASS`/`FAIL` above is quoted from a command run in this session; inherited rows are labelled `INHERITED` |

---

## 17. Open questions handed on

| # | Question | Owner |
|---|---|---|
| Q1 | Does a data-less day still consume the day after O-2? Falsifiable test: a day with no reading leaves `day-locks/` empty. | Verifier |
| Q2 | Should `consecutive_missed_days` stop counting a `MONITOR_DEGRADED` run as success? Today it reset 9 → 0 on a null snapshot (E4). | Verifier / operator |
| Q3 | Does the acceptance gate go green once it is package-scoped and R1 is attributed to `gate.py::acquire_day_lock`? | Verifier (O-3) |
| Q4 | Which read source becomes the source of record — operator-entered, app-bridged session read, or a loopback route that must first be built? | Research, decision owner: operator |
| Q5 | Do the two `DECISION-V2-*.xml` files get repaired to well-formed, and what exact `schtasks /Create` string does the operator approve? | Scheduler + operator (RULE-4) |
| Q6 | Is a real delivery sink wanted at all, or is `alerts.jsonl` + a manual daily look the intended channel? | Operator |

*End of workflow design. Evidence commands in this pass: E1–E20 (§1) with raw outputs quoted; the suite (52 tests) and the guard's three exit codes are the only executions, all sandboxed. Nothing in `data/freecash-monitor/` was created or modified.*

# WORKFLOW PLAN — Daily Status Monitoring Routine, Free Cash Finance Automation

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908`
**Written:** 2026-09-21, ~18:45 operator-local (`date` → `Mo, 21. Sep 2026 18:40:18`, UTC+02:00)
**Subject:** the daily status-monitoring routine for *Free Cash Finance Automation*, canonical implementation `D:/AgenticOS/monitoring/freecash/`
**Interpreter of record:** `python` = **3.11.9** at `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`, `tzdata 2025.3`, resolves `Europe/Berlin`. `py -3` = **3.14.7** and raises `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'` — it may never drive the daily run.
**Footprint (additive):** this file is new. No existing file was created-over, edited, moved, renamed or deleted; no `git add/commit/stash/reset/checkout` was run; no Windows scheduled task or crontab entry was registered or modified (verified: none exists, §0 V8); no network request was made to any provider; no credential, token or secret appears here or in chat. Every monitor run quoted in this document ran against a scratch `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp\` — `data/freecash-monitor/` was not written by this pass (proof: §0 V9).
**Evidence standard:** only the four operational rules that are *structurally unbreakable* qualify — the violating action must be unreachable in code, a command in this session must show it being denied, and at least one checker must be shown to **fail** on an injected violation. No PASS is inherited from an earlier plan.

**Prior art read and built on (kept, not re-derived):** `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` (its gap analysis D1–D4 and the VT-01…VT-15 mutation table are the basis for §2 S0 and the acceptance gate), `WORKFLOW-PLAN-CONSOLIDATED-2026-09-20.md` (V-row live-state format, the six-step daily run contract §4, the stage template with Effort/Time-to-Revenue/Dependencies/First-Concrete-Action, and the blocked register), `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V6.md` (stage vocabulary), `RULE-GATE-CHECKLIST.md` (rule-to-`file::function` binding table), `ROUTINE-DESIGN.md` §7.1/§7.2 (the scheduler task matrix, run time 08:35 / 23:50 and the reasons for it) and §8 (test matrix), `docs/free-cash-monitor-audit-evidence.md`. What this plan adds: the four rules re-bound to **exact `file:line`** on today's code, the daily cycle as an operator timeline with artifact-by-artifact output, and the approval handover surface written as a contract the human can accept or refuse.

---

## 0. Live state, re-verified in this session

Every row is a command executed in this pass with its observed output. Nothing here is carried over from an earlier report.

| # | Command (executed in this pass) | Observed output | Reading |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` (with `FREECASH_DATA_ROOT` → temp; the harness gives every test its own temp root, `tests/_support.py:49-53`, so the real state dir is untouched) | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | routine self-tests **GREEN** |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS - no unexempted write/earning token found.` · exit 0 | R2 static gate **GREEN**, exemption baseline **28** |
| V3 | `python monitoring/freecash/verify_readonly.py` on a **mutated temp copy** (`notify.py` + `requests.post("https://example.com/api/v1/withdraw", …)`) | 4 × `FORBIDDEN` on `notify.py:429` (`http-verb`, `write-call-shape`, `earning-verb`, `write-endpoint-path`) · `forbidden=4` · `FAIL - R2 violation` · exit 1 | the checker has **demonstrated detection power** — it is not a no-op |
| V4 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · exit 1. R1 evidence: `FAIL atomic same-day guard … no O_CREAT\|O_EXCL … anywhere in the file`; `FAIL day key is a calendar day` | acceptance gate **RED on R1 only**, and the reason is **scope**: the verifier reads one file, the lock lives in `gate.py` |
| V5 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/gate.py` | R1: `PASS atomic exclusive-create day guard present [line 128]` + `FAIL no rolling 24h window used as the daily gate [line 220]` (`cursor = last + timedelta(days=1)`); overall `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL` | pointed at the module that actually holds the lock, R1's *lock* check passes and the remaining FAIL is a **false positive**: line 220 is missed-day arithmetic, not the daily gate |
| V6 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` | `error: unrecognized arguments: --package` (argparse: only `target [--run] [--json] [--json-out]` exist, `rule_gate_verify.py:1056-1061`) | **there is no package-scope mode yet** — the acceptance command the plan needs cannot run at all today |
| V7 | `python monitoring/freecash/tests/run_all.py` (see V1) and a scratch two-run sequence in a temp root | run 1 `RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED … lock=2026-09-21.lock` exit 0; run 2 `SKIP_DUPLICATE_DAY 2026-09-21` exit 0; `run_daily_check.py --force-recheck --reason "…"` → `REFUSED_FORCE_RECHECK … (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)` exit **3**; day-locks contained exactly `2026-09-21.lock` and snapshots exactly `2026-09-21.json` | R1 holds under a real second invocation and under an explicit manual re-check request |
| V8 | `schtasks /Query /TN FreeCash-Daily-Monitor` · `schtasks /Query /TN FreeCash-Missed-Day-Watchdog` · `(unset FREECASH_DATA_ROOT; env \| grep -iE 'FREECASH\|SMTP_\|WEBHOOK_')` · `crontab -l` | both tasks: `FEHLER: Das System kann die angegebene Datei nicht finden.`; env: **no match**; `crontab: command not found` | **never scheduled**, no host configuration, **no external notification sink and no credential** — the routine has never run on a timer |
| V9 | `ls -1 data/freecash-monitor/state/day-locks/ snapshots/` · `ls -1a data/freecash-monitor/approvals/` · `wc -l data/freecash-monitor/alerts/alerts.jsonl` · `python -c "json.load(...operator-state.json)['records']"` · `cat data/freecash-monitor/state/last-run.json` | day-locks: `2026-09-20.lock` only (**no lock for 2026-09-21**); snapshots: `2026-09-20.json` only (**no snapshot for 2026-09-21**); `approvals/` contains only `.` and `..` (**empty**); `records= []`; ledger `last_attempt_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED` | **no reading for today exists**; R3/R4 have never had real input; my scratch runs did not touch this root (no `2026-09-21` lock here) |
| V10 | `data/freecash` inspected | empty directory | the second candidate state root is genuinely empty; **`data/freecash-monitor` is the only root with content** |
| V11 | `python -c "import sys; print(sys.executable)"` · `python -c "ZoneInfo('Europe/Berlin')"` · `py -3 -V` · `py -3 -c "ZoneInfo('Europe/Berlin')"` | `…\hermes-agent\venv\Scripts\python.exe` · resolves `Europe/Berlin` (`tzdata 2025.3`) · `Python 3.14.7` · `ZoneInfoNotFoundError` | interpreter pinning is **mandatory**: the 3.14 launcher breaks the R1 day-key rule |
| V12 | `python monitoring/freecash/run_daily_check.py --source metrics_http --base-url http://localhost:9` (temp root) | `RUN_FAILED 2026-09-21 reason=ReadError: GET /api/v1/status/metrics failed: [WinError 10061] …` · exit **5** · day lock **still present** · ledger `last_outcome=READ_FAILED`, `last_success_day=null` | an unreachable source does **not** silently retry, does not unlock the day, and does not claim success |
| V13 | transport-spy call into `readonly_client.request` (temp root) | `REFUSED POST method -> R2: method 'POST' is not read-only (allowed: GET, HEAD)`; `REFUSED plain GET off-loopback -> R2: host not allowlisted: 'evil.example'`; `REFUSED GET write-path -> R2: path not allowlisted: '/api/v1/withdraw'`; `REFUSED GET with body -> R2: request bodies are forbidden ('json')`; `transport_calls_never_called = 0` | deny-by-default is **structural**: the only socket site is never reached |
| V14 | seeded two-day flight in a temp root (yesterday baseline `$13.40`, today `$15.80` + `$2.40` pending) | run for yesterday `RUN_OK … outcome=INITIAL_BASELINE`, run for today `RUN_OK … outcome=EARNINGS_CHANGED … changes=2 notifications=2 approvals=2`, immediate re-run `SKIP_DUPLICATE_DAY`; `alerts.jsonl` = 6 lines, exactly one `EARNINGS_CHANGED` line per distinct change; `approvals/pending.json` = 2 items, each `status=PENDING execution_state=NOT_EXECUTED expires_at_utc=None` | **R3 and R4 fire correctly on real input**: one change → one notification → one handle, and nothing executable |
| V15 | forced delivery failure in a temp root (`sender` raising) | `first -> FAILED`, `second -> DEDUPED`, `delivery attempts total = 2`, `key_delivery(K1) = FAILED_TOAST`; the `DELIVERY_FAILED` line carries the **full original message**; a second call for the same key dispatched nothing | delivery failure is **bounded** (2 attempts) and **never retried again**; the message survives in the append-only log |
| V16 | `approval_queue` enqueue → `decide … --by` sequence (temp root, in-process) | `enqueued status=PENDING execution_state=NOT_EXECUTED expires_at_utc=None`; after approval `APPROVED execution_state=NOT_EXECUTED expires_at_utc=None execution_allowed=False`; machine decider → `REFUSED machine decision -> refused: 'routine' is not a human identity` | **approving changes nothing executable**, and a machine cannot sign a decision |
| V17 | `python scripts/monitoring/rule_gate_verify.py <mutated temp copy>/notify.py` | R2 `FAIL no write/earning call shape or endpoint path [line 429]`, `FAIL no non-GET/HEAD HTTP method is used [line 429]`, `FAIL no invented/unresolved provider endpoint [line 429]` → `R2 RESULT: FAIL` | the acceptance gate's R2 checks also respond to an injected violation |

**One-line status:** all four rules are already enforced in code and the routine's own checkers are green and mutation-tested; the **only** thing standing between this design and a compliance verdict is that the acceptance gate `rule_gate_verify.py` cannot yet scan the routine as a *package*, so it reports a false `R1=FAIL` (§2 S0). No reading has been entered, no task has ever been scheduled, and no credential or external sink exists.

---

## 1. Binding constraints — the four rules, each bound to mechanism and proof

These four are the operational contract. Each row names the action that must be **unreachable**, the code that makes it unreachable, and the single command that demonstrates it. Columns: mechanism cited as `file:line`; proof command run in this session.

| Rule | What is forbidden | Enforcement mechanism (`file:line`) | Command that proves it (this session) |
|---|---|---|---|
| **R1 — no earning action is ever taken automatically** | any claim / withdraw / payout / redeem / survey / offer / transfer / bet / deposit call, any non-GET method, any request body, any account mutation | `readonly_client.py:39` `ALLOWED_METHODS = frozenset({"GET","HEAD"})`; `readonly_client.py:41` loopback-only `ALLOWED_HOSTS`; `readonly_client.py:43-49` path allowlist (provider paths **not** allowlisted); `readonly_client.py:52` `BODY_KEYWORDS`; `readonly_client.py:110-140` `request()` raises `ForbiddenWriteError` **before** the only socket site; `readonly_client.py:76-107` `_transport()` = the single socket call; `readonly_client.py:146-176` process-level audit hook; `verify_readonly.py:41-88` six forbidden token classes; `verify_readonly.py:177-183` `exit 1` on any unexempted hit; `approval_queue.py:44-48` `EXECUTION_STATE_NOT_EXECUTED` / `EXECUTION_ALLOWED_BY_THIS_ROUTINE = False`; `approval_queue.py:131-133` + `:180-182` the frozen fields re-asserted at decision time; `run_daily_check.py:18-21` "There is no execution code path here at all." | `python monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28` · `PASS` · exit 0 (V2); same command on a mutated copy → `forbidden=4` · exit 1 (V3); transport-spy proof → 4 × `REFUSED`, `transport_calls_never_called = 0` (V13); `rule_gate_verify.py` R2 all-PASS (V4) and R2 FAIL on the mutated copy (V17) |
| **R2 — exactly one status check per day** | a second status read on any operator-local calendar day, by any caller, including the scheduler, a retry, a timer, a watchdog or a human asking again | `gate.py:96-102` `day_key()` = operator-local calendar day via `zoneinfo`; `gate.py:119-135` `acquire_day_lock()`; `gate.py:128` `os.open(lock, os.O_CREAT\|os.O_EXCL\|os.O_WRONLY)` — one atomic syscall on `state/day-locks/<YYYY-MM-DD>.lock`, zero-byte file, no read-then-write window; `gate.py:11-13` the ledger is explicitly **never** the gate; `run_daily_check.py:309-321` duplicate branch = one `SKIP_DUPLICATE_DAY` line, `return 0`, **no read, no snapshot, no ledger write**; `run_daily_check.py:281-297` `--force-recheck` accepted only to be refused (exit 3, request itself audited); `run_daily_check.py:371-393` a failed read keeps the lock (exit 5, no automatic re-run); `watchdog.py:7-16` the watchdog opens no socket, runs no check, locks nothing | `python run_daily_check.py` twice in one day → `RUN_OK …` then `SKIP_DUPLICATE_DAY 2026-09-21`, both exit 0, exactly one `2026-09-21.lock` and one `2026-09-21.json` in the temp root (V7); `--force-recheck` → `REFUSED_FORCE_RECHECK …` exit 3 (V7) |
| **R3 — the human is told when earnings or account status change** | a change that never reaches the operator; a duplicated notification for the same change; a change that is silently swallowed by a threshold; a "no change" day that pings the operator | `changedetect.py:36-38` the exhaustive compared field set; `changedetect.py:95-97` integer-cent validation (no floats, no tolerance); `changedetect.py:144-146` sha256 of the raw body; `changedetect.py:226-279` `compare()`; `changedetect.py:214-217` `dedupe_key()`; `run_daily_check.py:402-405` prior snapshot loaded **before** the new one is written (ordering is the invariant); `notify.py:63-79` `alert()` = append-only line in `alerts/alerts.jsonl`; `notify.py:272-302` `notify_change()` = dedupe-checked, at most one dispatch per distinct change; `notify.py:91-99` `OK_NO_CHANGE` is **log-only**; `notify.py:42` + `notify.py:220-261` `dispatch()` = max 2 attempts then `DELIVERY_FAILED` carrying the full message; `run_daily_check.py:173-214` >5 changes coalesce into exactly one summary | seeded change flight (V14): `outcome=EARNINGS_CHANGED changes=2 notifications=2`, one `EARNINGS_CHANGED` line per distinct change in `alerts.jsonl`; no-change path log-only via `notify.py:91-99`; forced failure (V15): `first -> FAILED`, `second -> DEDUPED`, message retained verbatim |
| **R4 — the human is asked before ANY external action; the routine has no execution path, and a pending item never auto-executes** | the routine acting on an approved item; a timeout/TTL/watchdog/cron/retry converting `PENDING` to executed; a decision signed by a machine; a pending item that expires; an approval that authorises an unspecified action | `run_daily_check.py:18-21` no execution path in the entry point; `run_daily_check.py:149-151` enqueue-only; `approval_queue.py:5-19` (module contract: never acts on `APPROVED`, never writes any state but `NOT_EXECUTED`, never sets an expiry — "a pending item waits indefinitely"); `approval_queue.py:44-48` the two frozen constants; `approval_queue.py:118-134` `build_item()` writes `status=PENDING`, `expires_at_utc=None`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=False` as **constants, not parameters**; `approval_queue.py:55-57` + `:149-158` `NON_HUMAN_DECIDERS` and `_normalise_decider()` (a decision must name a person); `approval_queue.py:161-201` `decide()` re-asserts the frozen fields and appends to `approvals/decided.jsonl`; `approval_queue.py:207-235` a reminder never decides | enqueue → `status=PENDING execution_state=NOT_EXECUTED expires_at_utc=None`; after `decide(..., 'approve', 'Jane Operator', …)` → `status=APPROVED execution_state=NOT_EXECUTED expires_at_utc=None execution_allowed=False`; machine decider → `REFUSED … 'routine' is not a human identity` (V16); `rule_gate_verify.py` R4 → 7/7 PASS including `an APPROVED item is not auto-executed` and `a timeout cannot convert pending -> executed` (V4) |

**Everything else that binds the routine, kept from the consolidated plan and still true today:**

| ID | Constraint | Mechanism / proof |
|---|---|---|
| B5 | no secret in the routine, state or logs; secrets resolve at runtime only and are written `[REDACTED]` | none exist to leak: `env \| grep -iE 'FREECASH\|SMTP_\|WEBHOOK_'` → no match (V8); nothing in this document contains a credential |
| B6 | the routine is read-only over its own state: two append-only sinks, everything else atomic-rewritten | `notify.py:78` → `alerts/alerts.jsonl`; `approval_queue.py:184-200` → `approvals/decided.jsonl`; `paths.py:168-181` atomic JSON writes |
| B7 | no invented provider endpoint | `readonly_client.py:59-60` `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`; R2 check `no invented/unresolved provider endpoint` PASS (V4) |
| B8 | interpreter pinning is mandatory when scheduled | `py -3` (3.14.7) cannot resolve `Europe/Berlin` (V11) |
| B9 | additive only; no destructive git; no scheduler registered by an agent | this file is the only artifact of this pass; V8 shows no task exists |
| B10 | a timezone that cannot be resolved is reported, never assumed | `gate.py:56-93` `resolve_tz()/timezone_report()`; `run_daily_check.py:357-369` emits `MONITOR_DEGRADED` + `WARNING timezone_unavailable` |

---

## 2. Stages (ordered) — each with Effort · Time-to-Revenue · Dependencies · First Concrete Action

### ⛔ The single blocking gate that must go green first: **S0 — the acceptance gate must exit 0 for the routine as a package**

Today the honest verdict is *"rules structurally enforced in code; not yet verified by a passing gate run"* (V4/V6). Until `rule_gate_verify.py` reports `R1=PASS` for the routine as a **package** and exits **0**, every "compliant" or "operational" statement about this routine is unsupported, so S0 blocks the compliance verdict for S1–S8. It does **not** block S1's *mechanical* flight, which can be run in a scratch root at any time.

**Ordered dependency of stages:**
`S0 → S1 → (S2 ∥ S3) → S4 → (S5 ∥ S6) → S7 → S8`, with `S9` running in parallel and gated only on an explicit human decision plus a credential that does not exist today.

---

#### S0 — Close the acceptance gate's R1 scope defect *(the one red gate)*
- **Expected Effort:** 2–4 h
- **Time-to-Revenue:** none — this buys the *answer*, not cash
- **Dependencies:** none
- **First Concrete Action:** add a `--package <dir>` mode to `scripts/monitoring/rule_gate_verify.py` (argparse today exposes only `target [--run] [--json] [--json-out]`, `rule_gate_verify.py:1056-1061`) that attributes each rule to the module that enforces it — `gate.py::acquire_day_lock` for R1 — while removing the line-220 false positive (`FAIL no rolling 24h window used as the daily gate`, V5) which is missed-day arithmetic, not the daily gate. Re-run and require `R1=PASS` with exit 0.
- **Exit:** `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` exits **0** on the shipped package **and** exits 1 on a temp copy with `os.O_CREAT|O_EXCL` replaced by an `if lock.exists()` check — the same mutation discipline the R2 checker already passes (V3/V17).

#### S1 — One real reading, then one real change (R3/R4's first genuine flight)
- **Expected Effort:** 1–2 h
- **Time-to-Revenue:** same day — this is the first day a monitoring result exists at all
- **Dependencies:** S0 for the compliance verdict; otherwise standalone
- **First Concrete Action:** the operator opens their own account dashboard, logs in **themselves**, and appends one record for today to `data/freecash-monitor/state/operator-state.json` in the documented shape (`operator_state.py:17-33`; `how_to` is already embedded in the file by `operator_state.py:68-73`); then run the entry point once and quote the `RUN_OK … outcome=INITIAL_BASELINE` line.
- **Exit:** tomorrow's changed figures produce exactly one notification per distinct change and exactly one `NOT_EXECUTED` approval item (demonstrated end-to-end in a scratch root at V14).

#### S2 — Settle the state-root divergence (decision, then one root)
- **Expected Effort:** 30–60 min
- **Time-to-Revenue:** none
- **Dependencies:** none
- **First Concrete Action:** decide the canonical root — `data/freecash-monitor` (the default in `paths.py:45-49`, and the only root with content: V9) or `data/freecash` (empty: V10) — and record the decision plus the chosen `FREECASH_DATA_ROOT` in the task definition, so a scheduled run can never write into a second root.
- **Exit:** exactly one root holds state; a second root contains no artifacts.

#### S3 — Correct the run-entry documentation
- **Expected Effort:** 30 min
- **Time-to-Revenue:** none
- **Dependencies:** none
- **First Concrete Action:** replace `py -3 …` in every run example with the **pinned 3.11.9 interpreter path** (V11) and re-state the two-run acceptance sequence; the 3.14 launcher silently breaks the day-key rule.
- **Exit:** every documented command is one that actually runs on this host, as pasted.

#### S4 — Schedule Task A on a real 24/7 clock *(human decision required — see §7)*
- **Expected Effort:** 1–2 h, plus whatever the operator's approval takes
- **Time-to-Revenue:** none directly; this is what turns a *built* routine into an *operating* one
- **Dependencies:** S0 (compliance verdict), S1 (a reading exists), **and an explicit human approval of the handover text in §7**
- **First Concrete Action:** hand the operator the exact non-elevated `schtasks /Create` command from §7 for their approval; **do not register it**. After approval, register it and trigger it manually twice in one day, quoting (a) one `RUN_OK` line and (b) `SKIP_DUPLICATE_DAY` on the second same-day trigger.
- **Exit:** `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` quoted showing the pinned 3.11.9 path, `IgnoreNew`, `StartWhenAvailable`, and **restart-on-failure = Do not restart**, plus a quoted duplicate-day refusal.

#### S5 — Task B, the missed-day watchdog *(human decision required — see §7)*
- **Expected Effort:** 1 h
- **Time-to-Revenue:** none
- **Dependencies:** S4
- **First Concrete Action:** hand over the §7 Task B command for approval; after approval, register it and show the healthy-day path printing `WATCHDOG_OK` with **zero** alarms, then in a **temp root only** remove the day lock and show exactly one `MISSED_DAY` alarm with the ledger unchanged (`watchdog.py:9-16` forbids every other write).
- **Exit:** healthy day → 0 alarms; uncovered day → exactly 1 alarm; no state mutation from the watchdog.

#### S6 — Notification sink: keep it honest, add nothing unattended
- **Expected Effort:** 1–2 h, or **blocked** for any off-host sink
- **Time-to-Revenue:** none
- **Dependencies:** S1, S4
- **First Concrete Action:** confirm the local sink already in place — append-only `alerts/alerts.jsonl` (`notify.py:78`) plus the Windows toast default (`notify.py:201-206`) — and prove its failure mode on a seeded-change run by forcing a failing sender, quoting `DELIVERY_FAILED` with the full message retained and `second -> DEDUPED` (V15). Any email/webhook sink is a separate credential-gated step and is **blocked today** (V8).
- **Exit:** one change → one delivered payload; forced failure → bounded attempts, message preserved, no retry, no scheduler-level retry.

#### S7 — Approval-surface hardening (R4)
- **Expected Effort:** 2–4 h
- **Time-to-Revenue:** none
- **Dependencies:** S1
- **First Concrete Action:** run the documented CLI decision against one enqueued item (`approval_queue.py:21-27`) as a human, and quote the append-only decision row from `approvals/decided.jsonl` together with `execution_state` staying `NOT_EXECUTED` — then repeat the machine-decider refusal and quote `REFUSED: 'routine' is not a human identity`.
- **Exit:** every decision attributable to a human identifier; a `PENDING` item survives any clock advance unchanged; approving performs no action, ever.

#### S8 — Deprecation index (delete nothing)
- **Expected Effort:** 1–2 h
- **Time-to-Revenue:** none — this is false-compliance risk control
- **Dependencies:** none (read-only)
- **First Concrete Action:** write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing the parallel implementations (`finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `config/freecash-crontab`) as **DEPRECATED — do not cite as compliant**, naming `monitoring/freecash/` as the single implementation to consolidate on, each row carrying its exact gate command.
- **Exit:** index exists; no file moved, edited or deleted.

#### S9 — Unblock the revenue path (this is not the monitor)
- **Expected Effort:** unknown; 1–2 h to re-dispatch, longer to prove
- **Time-to-Revenue:** the only stage with a direct revenue hypothesis
- **Dependencies:** an explicit human decision, plus a provider credential that does **not** exist today (V8: no `FREECASH_*` in the environment)
- **First Concrete Action:** BLOCKED pending that decision. The agent-side action is to re-run the research pass and emit the decision packet (candidate source URL, read-only provability, the ToS sentence, the credential location) — never to invent an endpoint (B7) and never to place a credential in chat, code or state.
- **Exit:** either a grounded, read-only, credential-backed read contract with a decision recorded, or an explicit `BLOCKED` line naming the credential and the clause that blocks it.

---

## 3. The daily cycle, step by step

Order is the contract. Every step names what runs, what artifact it writes, what the human sees, and what the human must do.

| # | When | What runs | Artifact written | What the human sees | What the human must do |
|---|---|---|---|---|---|
| 0 | before the run, once a day | nothing mechanical — the human reads their own dashboard | one appended record in `state/operator-state.json` (`records[]`, today's `day_key`, integer cents) | your own dashboard figures | open the dashboard yourself, note four figures (account status, total earnings, balance, pending), append them as integer cents. **This is the only human input the routine needs.** |
| 1 | 08:35 local (Task A) | `run_daily_check.py` — R1 gate first: atomic exclusive-create of `state/day-locks/<day>.lock` (`gate.py:119-135`) | zero-byte lock file named for the operator-local day | nothing yet | nothing |
| 1a | duplicate case | the run stops here | exactly one `SKIP_DUPLICATE_DAY` line appended to `alerts/alerts.jsonl`; **no read, no snapshot, no ledger entry** | a quiet log line; you may ignore it | nothing — a duplicate is benign and exits 0 by design |
| 2 | same run | attempt recorded; uncovered days reported in-band; unresolved timezone reported | `state/last-run.json` (attempt), `MISSED_DAY` / `MONITOR_DEGRADED` lines if applicable | an alarm only if a day was missed or the timezone is unresolved | if you see `MISSED_DAY`, note the machine was asleep — nothing is back-filled and nothing is lost |
| 3 | same run | R2 read: today's figures from `operator_state` (default) or, if configured, the loopback metrics substitute through `readonly_client` (`GET`/`HEAD`, allowlisted path only) | nothing yet | nothing | if no record exists for today, expect the degraded path (§6 no-reading row) |
| 4 | same run | R3 compare: prior snapshot is loaded **before** the new snapshot is written (`run_daily_check.py:402-405`), exact integer-cent comparison | `snapshots/<day>.json` (atomic) | nothing yet | nothing |
| 5 | same run | R3 notify: one line per distinct change; **`OK_NO_CHANGE` is log-only**; a change sends at most one notification per dedupe key | `alerts/alerts.jsonl` (append-only), `state/notified-keys.json` (dedupe index, written **before** dispatch) | **a Windows toast naming the field, old → new value and the delta** | read it. No action is expected from the toast itself |
| 6 | same run | R4 enqueue: one `PENDING` item per notified change, `NOT_EXECUTED`, `expires_at_utc = null` | `approvals/pending.json` | an `APPROVAL_PENDING` toast carrying the approval id and the words *"PENDING – yours to decide, nothing executes"* | **decide, or don't.** An item waiting is a correct state, not a failure (§5) |
| 7 | same run | reminders: at most one per item per 7 days | `alerts/alerts.jsonl` | a reminder toast if an item has been waiting ≥ 7 days | re-read it and decide, or deliberately leave it |
| 8 | same run | ledger outcome recorded (`last_success_day` advances only for success outcomes) | `state/last-run.json` | the `RUN_OK …` stdout line (in the task's log file, once scheduled) | nothing |
| 9 | 23:50 local (Task B, after approval) | `watchdog.py` — reads the ledger only; opens no socket, locks nothing, runs no check | `alerts/alerts.jsonl` + `notified-keys.json` **only** | `WATCHDOG_OK` (quiet) or exactly one `MISSED_DAY` alarm | on `MISSED_DAY`: check Task Scheduler history and machine uptime; today's check cannot be re-run (R2) — tomorrow's run reports the gap in-band |
| — | any time | the human decides a pending item | `approvals/decided.jsonl` (append-only) | `recorded APPROVED|REJECTED … by …` + `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)` | act, if at all, **outside** this routine, deliberately and yourself |

**What the whole cycle never does:** it never logs in, never claims, never withdraws, never pays out, never completes a task or offer, never sends money, and never re-runs today.

---

## 4. NEVER-DO list

Written as prohibitions on the routine, on any future agent, and on any future scheduled task. Each is enforced in code today; the point of writing it down is that a *change* violating it must fail a checker or a review, not be argued about.

1. **Never add a write, earning or mutation path** — no non-`GET`/`HEAD` method, no request body, no `claim`/`withdraw`/`payout`/`redeem`/`transfer`/`deposit` call, no account mutation. `readonly_client.py:39,52,110-140`; `verify_readonly.py:41-88` fails the build on any of them.
2. **Never widen an allowlist** (`readonly_client.py:41,43-49`) except after research resolves a real read-only contract, one line at a time, with a justification comment — and never for a write endpoint. Provider endpoints stay the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` (`readonly_client.py:59-60`) until then.
3. **Never run the status check twice on one operator-local calendar day** — not by scheduler retry, not by `StartWhenAvailable`, not by a manual re-invocation, not by "back-filling" a missed day (`gate.py:119-135`; `gate.py:208-215` deliberately excludes back-fill; `run_daily_check.py:281-297`).
4. **Never let a timeout, TTL, expiry, watchdog, cron entry, scheduler retry or nag change a `PENDING` item's status** or make anything execute (`approval_queue.py:5-19,44-48,131-133`).
5. **Never auto-execute an `APPROVED` item**, and never add code that reads an approval status in order to act on it (`approval_queue.py:14-16`; the routine contains no execution path at all, `run_daily_check.py:18-21`).
6. **Never record a decision without a named human**, and never accept a machine identity as the decider (`approval_queue.py:55-57,149-158`).
7. **Never set an expiry on a pending item.** A non-null `expires_at_utc` is the historical mechanism by which "expired" becomes "execute"; it is constant `None` (`approval_queue.py:47-48`).
8. **Never swallow an exception so a failed run exits 0**, and never clear the day lock on a failed read — a `READ_FAILED` day stays uncovered on purpose and exits 5 (`run_daily_check.py:371-393`).
9. **Never put a secret, token or credential in the document, the code, the state files, the logs or the chat** — `[REDACTED]` only; credentials live in the vault and are resolved at runtime (B5).
10. **Never register or modify a Windows scheduled task, crontab entry or in-app schedule on the human's behalf.** Scheduling text is handover material for the human to approve and execute (§7).
11. **Never delete or edit a parallel legacy monitor** (`finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-monitor.mjs`, `config/freecash-crontab`). The tree is untracked; a deletion is unrecoverable. Deprecate in documentation only (S8).
12. **Never cite compliance from a stale artifact** — not from `.delivery_status.json`, not from an earlier plan or report, not from a PASS run in another session. Only from a command run and quoted in the session making the claim.
13. **Never let a delivery failure cause a re-read, a second run or an automatic retry of the same key** — two attempts, then a loud `DELIVERY_FAILED` carrying the full message, and stop (`notify.py:42,220-261`; V15).
14. **Never present a `degraded: true` snapshot as provider-verified.** Operator-entered and substitute readings are marked `degraded: true` and `source=operator_entered` for exactly this reason (`run_daily_check.py:90-99`; `operator_state.py:12-15`).

---

## 5. The human-approval handover surface

**What an approval request is.** A notification with a handle — nothing more. It is created only when a *real change* was detected (`run_daily_check.py:146-166`), it is written to `approvals/pending.json`, and the toast says so in words: *"Approval item &lt;id&gt; enqueued (PENDING, no expiry, NOT_EXECUTED). Nothing will act on it without you."*

**The exact shape of one item** (fields fixed by `approval_queue.py:118-134`):

```json
{
  "approval_id": "<uuid>",
  "created_at_utc": "<iso>",
  "day_key": "<YYYY-MM-DD>",
  "change_dedupe_key": "<sha256>",
  "reason": "<field> moved from <old> to <new>. Review and decide whether any action is wanted.",
  "proposed_action": {
    "action_type": "REQUEST_PAYOUT",          // a design label for a HUMAN decision, not a call this routine can make
    "amount_cents": <new value>,              // the observed figure, not a computed instruction
    "destination": "OPERATOR_SPECIFIED - not stored by the routine",
    "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
  },
  "status": "PENDING",
  "expires_at_utc": null,                      // frozen: never a date
  "execution_state": "NOT_EXECUTED",           // frozen: the only value this routine may ever write
  "execution_allowed_by_this_routine": false   // frozen
}
```

Note what the payload deliberately **cannot** contain: no endpoint, no destination account, no amount the routine computed, no expiry, no "approved therefore proceed" flag. It describes an *observation* and asks for a *decision*; the acting, if any, is the human's own, elsewhere.

**How the human decides.** Read-only listing first, then an explicit decision:

```bash
# what is waiting (read-only)
python D:/AgenticOS/monitoring/freecash/approval_queue.py list

# record a decision — your name and your reason are required
python D:/AgenticOS/monitoring/freecash/approval_queue.py decide \
  --id <approval_id> --decision approve|reject --by "Your Name" --note "why"
```

**How the human should decide:** the question an item asks is *"do you want to do anything about this?"*, not *"may the routine do X?"* — option one is always **do nothing**, and it is a valid, expected answer. Leaving the item `PENDING` is a correct state: it never expires, it is never escalated, and it is only reminded once per 7 days (`approval_queue.py:221-235`). `approve` records *your* decision and changes no execution state; `reject` is equally final. If a decision requires an action (a payout request, a support ticket), **you** perform it, outside this routine, and the recorded decision is your audit trail.

**Refusals the human will see if they try to shortcut it:** a missing `--by` → `REFUSED: --by is required: a decision must name the human who made it`; `--by system` (or routine/agent/cron/scheduler/monitor/bot/script/machine) → `REFUSED: … is not a human identity`; a missing `--note` → `--note is required`; a bad `--id` → `no such approval_id` (exit 3); and after any successful decision, `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)` (V16).

---

## 6. Failure / degradation matrix

| Situation | What the routine does | Observable artifact | What the human sees | What the human must do | Automatic recovery? |
|---|---|---|---|---|---|
| **Provider / read source unreachable** (metrics substitute down, or any read error) | one `READ_FAILED` entry, exit **5**, **day lock stays in place**, ledger `last_success_day` unchanged (so the day stays visibly uncovered) | `alerts/alerts.jsonl` `RUN_FAILED` message; `state/last-run.json` `last_outcome=READ_FAILED` (verified: V12, exit 5) | an alert with the reason (e.g. `ReadError: … WinError 10061 … refused`) | fix the source if you want it read; do **not** ask for a re-run — R2 forbids a second read today. Today's gap is reported in-band by tomorrow's run and by tonight's watchdog | **none** — deliberately no automatic re-run |
| **No reading entered for today** | snapshot written with **null** fields; **nothing is compared and nothing is notified**; `MONITOR_DEGRADED` | `snapshots/<day>.json` with `data_available=false`; `alerts.jsonl` `MONITOR_DEGRADED` "No data for &lt;day&gt;" (verified: V7 run 1) | a log-only `MONITOR_DEGRADED` (severity `info`) — **no toast**, so a forgotten reading does not train you to ignore alarms | enter today's record before the run, or accept a gap; either way nothing false is reported | none — and no reading is ever invented |
| **Duplicate run attempted** (scheduler retry, second trigger, a human running it again) | stops at the R1 gate: exactly one `SKIP_DUPLICATE_DAY` line, exit **0**, **no read, no snapshot, no ledger write, no notification, no queue change** | `state/day-locks/<day>.lock` (zero bytes) already existed; `alerts.jsonl` +1 info line only (verified: V7 run 2) | `SKIP_DUPLICATE_DAY <day>` on stdout / in the task log | nothing — this is the routine working correctly | none needed; exit 0 stops the scheduler's own retry logic |
| **A manual re-check is requested** (`--force-recheck`) | **refused** by design, exit **3**; the request itself is audited | `logs/forced-recheck-requests.jsonl` with `decision: REFUSED` and the R2 reason (verified: V7) | `REFUSED_FORCE_RECHECK <day> reason='…'` naming why | accept it, or edit the figures and wait for tomorrow's run | none — a second status read in one day is exactly what R2 forbids |
| **Change detected** (earnings, balance, pending, or account status) | one line per distinct change; **at most one notification per dedupe key**; one `PENDING` approval item per notified change; >5 changes coalesce into a single summary | `snapshots/<day>.json` (new), `alerts.jsonl` (one line per change), `state/notified-keys.json`, `approvals/pending.json` (verified: V14 — `EARNINGS_CHANGED changes=2 notifications=2 approvals=2`, one line each) | a toast per change naming field, old → new, delta, **and** the approval id with *"PENDING – yours to decide, nothing executes"* | read the change; open `approvals/pending.json` if you want to consider anything; act yourself if warranted | none — no action is taken, ever |
| **Delivery failure** (toast channel refuses, no sink configured) | max **2 attempts**, 5 s in-process backoff, then `DELIVERY_FAILED` carrying the **full original message**; the key is marked `FAILED_TOAST` and **never retried again**; a second call for the same key dispatches nothing | `alerts.jsonl` `DELIVERY_FAILED` + `MONITOR_DEGRADED` "this message exists only in alerts.jsonl"; `notified-keys.json` `FAILED_TOAST` (verified: V15 — `first -> FAILED`, `second -> DEDUPED`, `attempts total = 2`) | possibly **nothing** — the toast never arrived | **read `alerts/alerts.jsonl`** until the channel is fixed. This is the one case where silence means "go look" | none by design — no scheduler-level retry; the log is the fallback channel |
| **Missed day** (machine asleep, task skipped, run never happened) | in-band: the *next* successful run emits `MISSED_DAY` for each uncovered day and **never back-fills**; same-day: Task B confirms at 23:50 and emits exactly **one** `MISSED_DAY` alarm per day | `alerts.jsonl` `MISSED_DAY` (severity `alert`) with last success and consecutive count; ledger `consecutive_missed_days` (Task B healthy path prints `WATCHDOG_OK`) | a `MISSED_DAY` alarm: *no successful status check was recorded for &lt;day&gt;* | check Task Scheduler history and machine uptime; do not attempt a same-day catch-up read | **none** — the routine never back-fills and never runs twice |
| **Timezone unresolved / changed** | `MONITOR_DEGRADED` (severity `alert` on change, `info` on unresolvable zone) plus a stdout `WARNING timezone_unavailable` | `alerts.jsonl`; ledger `timezone` | an alert naming the configured zone and the offset actually used | install `tzdata` for the scheduled interpreter, or pin the interpreter that has it (V11) | none — the day key is never assumed |
| **Interpreter wrong** (`py -3`, 3.14.7) | the process fails before any check: `ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'`, no lock created, no read | nothing written — the run never started | a task that shows a failed exit in Scheduler history, or a degradation warning if a fallback zone was used | use the pinned 3.11.9 interpreter (§7) | none |

---

## 7. Scheduling — handover text for the human to approve (not an action taken)

**Status: nothing is scheduled.** `schtasks /Query /TN FreeCash-Daily-Monitor` and `…/FreeCash-Missed-Day-Watchdog` both return `FEHLER: Das System kann die angegebene Datei nicht finden.` (V8). Registering an unattended task is a human decision (B9); the agent must not do it, and has not.

**What is being handed over for approval:**

- **Two tasks, no other entry points.** Task A is the check; Task B is the same-day missed-day watchdog (`ROUTINE-DESIGN.md:28-32`).
- **Times:** **08:35 local** daily for Task A and **23:50 local** daily for Task B, kept from `ROUTINE-DESIGN.md` §7.1/§7.2 because 08:35 sits after the provider's overnight rollover settles, before your working day (so a pending approval is visible while you are at the keyboard), away from the 02:00–03:00 DST jump, and away from midnight backups/machine-sleep.
- **Two settings are rule-critical, not preferences.** Multi-instance policy = `IgnoreNew` (a scheduler-level backstop to the atomic day lock) and **restart-on-failure = "Do not restart"** — a restart is a same-day re-run, and R2 says once.
- **Interpreter:** the action must point at the **pinned 3.11.9** interpreter with `tzdata`; `py -3` (3.14.7) cannot resolve `Europe/Berlin` and breaks the day-key rule (V11).
- **State root:** the canonical root you picked in S2, passed explicitly as `FREECASH_DATA_ROOT`, so a scheduled run cannot write into a second root.

**Commands for you to run after you approve — as written in `ROUTINE-DESIGN.md:480-492`, with the interpreter and root substitutions this session requires** (`%PY311%` = `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`; `%FCDATA%` = your canonical root):

```
schtasks /Create /TN "FreeCash-Daily-Monitor" /SC DAILY /ST 08:35 /F ^
  /TR "cmd /c \"%PY311%\" D:\AgenticOS\monitoring\freecash\run_daily_check.py 1>> D:\AgenticOS\data\freecash-monitor\logs\run-latest.log 2>&1" ^
  /RL HIGHEST /RU "%USERNAME%"
schtasks /Change /TN "FreeCash-Daily-Monitor" /IT

schtasks /Create /TN "FreeCash-Missed-Day-Watchdog" /SC DAILY /ST 23:50 /F ^
  /TR "cmd /c \"%PY311%\" D:\AgenticOS\monitoring\freecash\watchdog.py 1>> D:\AgenticOS\data\freecash-monitor\logs\watchdog-latest.log 2>&1" ^
  /RL HIGHEST /RU "%USERNAME%"
```

Then, still as handover (the operator can do this at any time):

```
schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST
schtasks /Run   /TN "FreeCash-Daily-Monitor"     # first trigger
schtasks /Run   /TN "FreeCash-Daily-Monitor"     # second trigger, same day -> expect SKIP_DUPLICATE_DAY
```

Notes to carry into the adopted text: `%DATE%` in a redirect is locale-dependent (a `/` in the localized date breaks the path) — a fixed `logs/run-latest.log` plus the routine's own per-day artifacts avoids that; `StartWhenAvailable = true` is safe because the day lock is per local day, so a late run still runs **at most once** that day; `-RunLevel Highest` (stored credentials) avoids the "only when logged on" trap that silently skips runs after a reboot; and Task Scheduler's own restart-on-failure stays **Do not restart**.

**What the operator is approving, in one sentence:** two daily triggers that only ever read a status, never an action — one at 08:35 that can run at most once per calendar day, and one at 23:50 that can only tell you a day was missed.

---

## 8. Definition of done for this design

1. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → **exit 0**, `R1=PASS R2=PASS R3=PASS R4=PASS` (blocking gate, S0).
2. `python monitoring/freecash/tests/run_all.py` → `failures=0 errors=0`, exit 0.
3. `python monitoring/freecash/verify_readonly.py` → `forbidden=0` and `exempt=28` **or a lower count that is explained**, exit 0 — with the mutation copy still failing (V3).
4. One real operator reading entered, one real change notified, one approval item decided by a named human, and `execution_state` still `NOT_EXECUTED` afterwards — all quoted from `alerts.jsonl` / `pending.json` / `decided.jsonl`.
5. `schtasks /Query` quoted showing both tasks with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit, recorded human decision *not* to schedule, in which case the routine is honestly described as *built and unverified in operation*, never as *operating*.
6. No credential anywhere in code, state, logs or this document; no live provider call; no earning action performed by anything.

**Honest one-line reading of today:** the four rules are structurally enforced in code and demonstrated by command output in this session; the routine is **not yet given a clean compliance verdict** (S0), has **never run on a timer** (V8), and has **never had a real reading entered** (V9) — so it is designed and proven, not yet operating.

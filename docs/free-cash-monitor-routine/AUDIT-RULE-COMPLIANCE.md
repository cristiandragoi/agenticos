# Free Cash Daily-Monitor — Rule-Compliance Audit (R1–R4)

Scope: every existing "Free Cash / finance daily monitor" artifact in `D:/AgenticOS`.
Repo branch `hermes-rescue-20260908`, HEAD `d14253d`.
Method: static read of every candidate + bounded, non-mutating execution checks only
(`node --check`, `ast.parse`, running the repo's own read-only verifier, running one test
file's `--list` path, SQLite schema read, `schtasks /query`). No network call was made and
no pre-existing file was modified. Date of audit: 2026-09-17.

Rule numbering used here is the task's numbering:

| ID | Rule |
|----|------|
| R1 | Exactly one status check per calendar day (no double runs) |
| R2 | ZERO automated earning actions (no write/withdraw/transfer/cashout/claim/bet endpoint) |
| R3 | Operator is notified when earnings/account status change (detection + delivery) |
| R4 | Human approval required before ANY external action (approval gate; nothing auto-executes) |

Note on naming drift: `server/scripts/freecash-daily-monitor.mjs` and `finance-monitor/**`
number these rules differently (`Rule 1 = no auto earnings`, `Rule 2 = once/day`) and
`server/scripts/verify-freecash-rules.mjs` uses that inverted numbering. Mappings are given
explicitly in the matrix.

---

## (a) Inventory

`git status --porcelain` / `git ls-files` show **every candidate is untracked** (`??`,
never committed). Sizes/mtimes from `stat`; commands in §(f).

| # | Path | Bytes | mtime (2026) | Git | Classification |
|---|------|-------|--------------|-----|----------------|
| 1 | `server/scripts/freecash-daily-monitor.mjs` | 10 474 | Sep 11 10:21 | `??` untracked | **BROKEN / NON-RUNNABLE** — `node --check` → `SyntaxError: Unexpected token ':'` at line 41 (TS annotations in a `.mjs`), plus ESM `require()` |
| 2 | `server/scripts/verify-freecash-rules.mjs` | 3 034 | Sep 11 11:52 | `??` | **FALSE VERIFIER** — exists (skill claims path `scripts/verify-freecash-rules.mjs`, which does **not** exist); reports 4/4 PASSED against a file that does not parse |
| 3 | `server/tasks/daily-finance-monitor.py` | 13 434 | Sep 11 10:15 | `??` | **BROKEN / PARTLY DEAD** — runs, but the DB read path is unreachable and the notification/approval helpers are never called |
| 4 | `server/tasks/register_approved_change.py` | 3 366 | Sep 11 10:16 | `??` | **BROKEN helper** — `NameError: timedelta`; target table absent from the DB |
| 5 | `server/tasks/README_daily-monitor.md` | 5 094 | Sep 11 10:19 | `??` | **DOC-ONLY**, several claims contradicted by the code (see §c) |
| 6 | `server/tasks/last_run_time.json` | 17 | Sep 11 10:25 | `??` | State file (`1789115102.649168` = 2026-09-11T08:25:02Z). Not a program |
| 7 | `server/tasks/daily_monitor.log` | 201 | Sep 11 10:25 | `??` | **Evidence of the only recorded run**: all 4 lines are `--simulate-notification` output ("Running in SIMULATE mode", "checks=0") |
| 8 | `scripts/monitoring/free-cash-daily-check.py` | 11 024 | Sep 11 11:18 | `??` | **DEAD** — parses, but `main()` is never invoked and the R1 gate is never fed |
| 9 | `scripts/make_freecash_check.py` | 2 957 | Sep 11 11:00 | `??` | **RUNNABLE, closest to compliant** — real once-per-day gate + approval-before-action ordering; contains an ungated withdraw code path |
| 10 | `scripts/finance_monitor.py` | 10 944 | Sep 11 11:35 | `??` | **BROKEN** — `async` method never awaited; no R1 gate; notification import path wrong |
| 11 | `scripts/notification_service.py` | 7 086 | Sep 11 11:44 | `??` | **BROKEN delivery** — `NameError: config` on the only entry point; recipient list always resolves empty; SMS is a mock that returns success |
| 12 | `scripts/approval_gate.py` | 5 443 | Sep 11 11:38 | `??` | **NON-FUNCTIONAL gate** — issues tokens it can never verify; needs a config file that does not exist |
| 13 | `config/freecash-crontab` | 578 | Sep 11 10:12 | `??` | **DOC-ONLY / placeholders** — the single cron line contains the literal `/path/to/AgenticOS` |
| 14 | `finance-monitor/` (16 files, ~72 KB) | — | Sep 11 10:33–11:59 | `??` | **NON-RUNNABLE SKELETON** — `.VERIFIED.md` / `.COMPLETION_REPORT.md` claims are contradicted (see §c). No importable entry point, no scheduler, no config |
| 15 | `server/src/adapters/freecashMonitorAdapter.ts` | 6 428 | (tracked?) `??` untracked | | **STUB** — `fetchStatus()` returns hardcoded empty data; "once per day" is a substring match on the word `double-check` |

Duplicates / dead copies:

| Artifact | Duplicate of | Evidence |
|---|---|---|
| `release/win-unpacked/resources/server/scripts/freecash-daily-monitor.mjs` | #1 | build copy, shipped in `release/` |
| `release/win-unpacked/resources/server/scripts/verify-freecash-rules.mjs` | #2 | `diff` → **IDENTICAL** |
| `server/dist/adapters/freecashMonitorAdapter.js` | #15 | compiled twin of a `.ts` that itself is untracked |
| `finance-monitor/__init__.py` vs `finance-monitor/src/orchestrator.py` | each other | two different `class MonitorOrchestrator` implementations of the same pipeline |
| `docs/free-cash-monitor-routine/` | — | pre-existing sibling artifacts (`ROUTINE-DESIGN.md`, `RULE-GATE-CHECKLIST.md`, `RESEARCH-PLAN.md`, `verify-readonly.sh`) — **not touched by this audit** |

There is **no scheduled-task registration** for any of these: `schtasks /query /fo LIST | grep -i "freecash|finance|monitor"` returns **nothing**.

---

## (b) R1–R4 compliance matrix

Legend: **ENFORCED** (real, reachable enforcement) · **PARTIAL** · **ABSENT** · **ONLY-IN-TEXT** (documented/commented or unreachable-coded) · **VIOLATION** (actively wrong).
"?" = cannot be reached at runtime because the file cannot execute.

### R1 — exactly one status check per calendar day

| Implementation | Verdict | Enforcement point (file:line) | Reason |
|---|---|---|---|
| `server/scripts/freecash-daily-monitor.mjs` | **ONLY-IN-TEXT** | gate: `:41-59` (`isDailyCheckAllowed`), record: `:65-76`; entry guard `:314` | Text is correct, but the file cannot parse (`node --check` fails at `:41`); the `.today` guard at `:314` is never created by any line; `:58` fails **open** (`return true`) on read error |
| `scripts/monitoring/free-cash-daily-check.py` | **ABSENT** | intended gate `:79-105`, call site `:234` | `save_last_run()` (`:52-56`) is **never called** (grep: only the `def`), so `last_run_utc.txt` never exists → `is_run_for_today` always returns `False` (`:81-82`) → every invocation re-runs. `main()` is never invoked either (last line `:294`, no `if __name__`) |
| `server/tasks/daily-finance-monitor.py` | **PARTIAL** | `:255-263` | Rolling **24 h** window (`> 86400`), not a calendar day; and the timestamp is written at `:262-263` **before** the work, so any crash burns the day. `daily_monitor.log` shows the only recorded run was `--simulate-notification` |
| `scripts/make_freecash_check.py` | **ENFORCED** | gate `:69-73`, day key written `:62-64` | Calendar-day key (`%Y-%m-%d`, UTC) from `data/freecash/state.json`; `if st.get("today") == today: return 0`. Real, reachable, invoked via `:98-99` |
| `scripts/finance_monitor.py` | **ABSENT** | — | No date/timestamp/flag check anywhere; `main()` (`:210-256`) always runs the check |
| `finance-monitor/**` | **ONLY-IN-TEXT** | `src/rule_engine.py:53-101`, `src/orchestrator.py:69`, `docs/rules.md:35-44` | The flag `last_check_<date>.flag` is **only ever read** (`rule_engine.py:77`, `orchestrator.py:69`); no module writes it (grep: no writer), so the gate always allows. `rule_engine.py:22-23` builds a **monthly** flag name while `:70` builds a daily one. `orchestrator.py` has no entry point at all |
| `server/src/adapters/freecashMonitorAdapter.ts` | **ONLY-IN-TEXT** | `:99-104`, `:118-125` | "Once per day" is implemented as `input.prompt.includes('double-check')` — a substring test, not a schedule |

### R2 — zero automated earning / write actions

| Implementation | Verdict | Evidence (file:line) | Reason |
|---|---|---|---|
| `freecash-daily-monitor.mjs` | **ENFORCED (by absence)** | only request: `:100` `method: 'GET'`, `:32` | No write/withdraw/claim call exists. Vacuously true — the file cannot run |
| `free-cash-daily-check.py` | **ENFORCED (by absence)** | `:112` `requests.get(...)` | Single GET; no POST/PUT/withdraw path |
| `daily-finance-monitor.py` | **ENFORCED (by absence)** | `:56`, `:66-69`, `:111-119` all `SELECT` | Read-only SQL only; `:224-234` lists action types but executes none |
| `scripts/make_freecash_check.py` | **VIOLATION (latent)** | construct `:19-20`, execute loop `:85-87`, stub `:49-52` | `prepare_actions()` builds `{"type": "withdraw", "amount": …}` and the loop calls `run_action(a)` for every approved action. Today `run_action` is a no-op returning `success = True` + `"Executed …"` — **the withdraw path is wired and pre-approved for implementation, and the crontab (`config/freecash-crontab:8`) already targets this file** |
| `finance_monitor.py` | **PARTIAL** | `:48-52`, `:101-105` GET only; but `:125` `"actions_allowed": any(...'new_earning'...)` | No write call today, but the monitor publishes an `actions_allowed` boolean flag for downstream consumers (no consumer found in-repo) |
| `finance-monitor/**` | **ENFORCED (by absence)** | `api_client.py:134-159`, `action_executor.py:39-41` | No HTTP client is even imported (`api_client.py:22` base URL is never called); "action" is a log entry |
| `freecashMonitorAdapter.ts` | **ENFORCED (by absence)** | `:198-209`, `:177-183` | Tools are `read-only` by name only; no network call exists |

### R3 — notify on earnings / account-status change

| Implementation | Verdict | Enforcement point (file:line) | Reason |
|---|---|---|---|
| `freecash-daily-monitor.mjs` | **ABSENT** | detection `:137-189`; delivery `:226-247` | Delivery is `console.log` only — `:235` literally says *"stubbed - implement actual SMTP/SES integration"*; `:240-243` prints "Webhook notification sent" **without sending anything**. Notify is also gated on `actionRequests.length > 0` (`:284-288`), so plain earnings changes are never reported |
| `free-cash-daily-check.py` | **ABSENT** | `:266` vs `:270`; delivery `:180-182` | Ordering bug: `save_snapshot()` runs at `:266`, then `old_snapshot = load_snapshot()` at `:270` loads **the file just written** → `compare_snapshots` returns `[]` always (`:126-127`) → change detection can never fire. `send_notification` is `print` + *"Replace with actual API call in production"* |
| `daily-finance-monitor.py` | **ABSENT** | detection `:134-172` (never called); delivery `:175-194` | `compare_with_last_check()` is defined and never called (grep). `trigger_notification()` prints `!!! NOTIFICATION TRIGGERED !!!` (`:179-181`); the SMTP body is commented out (`:182-193`). Fire condition `:306` `change_count == 1` means **>1 change ⇒ no notification at all** |
| `make_freecash_check.py` | **ABSENT** | n/a; only `log_entry` `:55-59` | No notification code and no change detection of any kind — only a JSONL append |
| `finance_monitor.py` | **ABSENT** | detection `:129-188`; delivery `:238-247` | `previous_state` is in-memory only (`:117-118`) and re-initialised per process → nothing to compare across days. Notification needs `configs/notification.json` in a directory that **does not exist** (`configs/` missing) and `from scripts.notification_service import …` (`:239`) fails for a directly-run script |
| `notification_service.py` | **BROKEN** | `:171` `if config.get(...)`; recipients `:124-125`; SMS `:146-158` | `config` is undefined (**NameError** — the variable is `cfg`), so the only public entry point always raises. `to_addresses` iterates the *keys* of `recipients` and tests `isinstance(emails, list)` → always `[]` ⇒ `sendmail(..., []) `. `_send_sms` returns `True` without sending (`:157-158`) — a fabricated success |
| `finance-monitor/**` | **ABSENT** | `notify_manager.py:85-132`, `:128-132` | No SMTP/webhook call exists; `:128-132` logs and `return len(messages) > 0` — i.e. it **returns "sent" having delivered nothing**. Hosts are placeholders (`:48` `smtp.example.com`). `check_channel_connectivity` fabricates results with `random.choice([True, False])` (`:189-190`) |
| `freecashMonitorAdapter.ts` | **ABSENT** | `:198-209`, `:136-145` | `statusAlerts: []` is hardcoded, `externalConnected: false`, message says *"External FreeCash API connection is not configured"* → the notify branch can never trigger |

### R4 — human approval before any external action

| Implementation | Verdict | Enforcement point (file:line) | Reason |
|---|---|---|---|
| `freecash-daily-monitor.mjs` | **ONLY-IN-TEXT** | `:194-221`, notify `:283-291` | `prepareActionRequests()` reads the approval queue at `:214-216`, mutates it at `:218` — and **never writes it back** (no `writeFileSync` for `approvalPath`). The queue file is never created; nothing can ever approve anything |
| `free-cash-daily-check.py` | **ABSENT** | `:206-213` (unused), `:284-291` | `prepare_approval_request()` is defined and never called (grep). The R4 block is a comment placeholder: *"(placeholder for action approval workflow — implemented by user before deploy)"* |
| `daily-finance-monitor.py` | **ABSENT** | `:197-245` (never called), `:315-323` | `prompt_for_approval()` contains a real `input("Type APPROVE…")` gate but **no production path calls it** (grep: only the `def`). `main()` merely prints `⏸️ HALT - External action pending human approval` (`:320`) — a message, not a gate |
| `make_freecash_check.py` | **ENFORCED (best in repo)** | approve `:24-46`, ordering `:83-87` | Real interactive gate: `prompt_approve()` is invoked **before** the execution loop, default is no-action, `"e"` exits, unapproved actions are never executed. **Caveat:** it is stdin-only, so under cron/Task Scheduler it raises `EOFError` at `:33`, caught at `:91` |
| `finance_monitor.py` | **ABSENT** | — | No consent gate; `requires_approval` is only a data flag on a change record (`:171`) |
| `finance-monitor/**` | **VIOLATION** | `wait_gate.py:86-102` (esp. `:95-102`) | The only "approval gate" in the repo **fabricates consent**: in sandbox mode it picks `random.choice([("APPROVE",True),("REJECT",False),("MODIFY",False)])` and returns `True` ~60 % of the time with **no human involved**, then logs it as an approval event (`:108-112`). `_sandbox_mode` is derived from `config_path.exists()` (`:31`), so wherever a config file exists the simulated path is taken. In non-sandbox it `sleep(5)` then `return False` (`:105-106`) — no notification, no polling, no consent capture. `handle_timeout` exists (`:116-138`) but is never called by production code |
| `finance-monitor/src/action_executor.py` | **PARTIAL** | `:31-37` | Fails closed when `user_consent.get("approved")` is falsy — but the "consent" it consumes can be the RNG value above. Both live callers of `execute_with_approval` are… none (grep) |
| `approval_gate.py` | **NON-FUNCTIONAL** | issue `:40-68`, verify `:70-97` | The JWT payload (`:47-53`) contains `user/action_type/details/expires_at/created_at` — **no `exp`, no `iss`, no `aud`**. `verify_approval()` calls `jwt.decode(..., issuer="FreeCashFinance", audience=user_id)` (`:73-79`) and reads `decoded["exp"]` (`:82`), so every token it issues is either rejected as missing claims or raises `KeyError`. `capture_consent()` (`:102-106`) therefore always returns `"rejected"`. It also requires `D:/AgenticOS/configs/approval_gate.json` (`:133`, directory **missing**) and a signing key at `D:/AgenticOS/secrets/signing.key` (`:21`, `:35`, directory **missing**) |
| `register_approved_change.py` | **PARTIAL** | `:46-57` | A genuine human-attributed approval ledger (CLI flags, no prompts), but: the `INSERT` targets `approved_changes`, which **does not exist** in `server/database.sqlite` (schema read: 0 tables), and `:67` references `timedelta` that is never imported → after the `commit()` at `:57` the function raises `NameError`, catches it at `:76` and exits 1 **reporting failure for a write that already happened**. No code anywhere consumes the table, so it gates nothing |
| `freecashMonitorAdapter.ts` | **ONLY-IN-TEXT** | `:211-219` | `evaluateRules()` returns `undefined` on every branch; `requiresApproval` is data, never a gate |

### Compliance counts

| Implementation | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| `freecash-daily-monitor.mjs` | ONLY-IN-TEXT | ENFORCED | **ABSENT** | ONLY-IN-TEXT |
| `free-cash-daily-check.py` | **ABSENT** | ENFORCED | **ABSENT** | **ABSENT** |
| `daily-finance-monitor.py` | PARTIAL | ENFORCED | **ABSENT** | **ABSENT** |
| `make_freecash_check.py` | ENFORCED | **VIOLATION (latent)** | **ABSENT** | ENFORCED |
| `finance_monitor.py` | **ABSENT** | PARTIAL | **ABSENT** | **ABSENT** |
| `finance-monitor/**` | ONLY-IN-TEXT | ENFORCED | **ABSENT** | **VIOLATION** |
| `freecashMonitorAdapter.ts` | ONLY-IN-TEXT | ENFORCED | **ABSENT** | ONLY-IN-TEXT |
| `approval_gate.py` / `notification_service.py` / `register_approved_change.py` | n/a (helpers) | n/a | `notification_service.py` **BROKEN** | PARTIAL / non-functional |
| `verify-freecash-rules.mjs` | false PASS | false PASS | false PASS | false PASS |

**Rule violations found: 20** = cells counted as ABSENT (13) + ONLY-IN-TEXT (4) + VIOLATION (2) = 19, **plus 1 verification-integrity violation** (#2/§f: 4/4 "PASSED" against a file that does not compile). PARTIAL cells (4) are listed as gaps, not counted. No implementation satisfies all four rules; only one of the 28 cells is a *real, reachable* enforcement of a rule that file claims (R1 and R4 in `make_freecash_check.py`).

---

## (c) Where a write / earning / withdraw / claim path could be reached

Ranked by proximity to real money movement:

1. **`scripts/make_freecash_check.py:18-21` + `:85-87` + `:49-52` — the only wired external-action path.**
   `prepare_actions()` returns a `withdraw` action whenever `available_to_withdraw` is truthy; `main()` calls `run_action(a)` for every approved action. `run_action` is a **success-returning stub**: `success = True; msg = f"Executed {action['name']}."; return True, success, msg`. It also calls `save_today()` only after the action loop, so a half-done action is re-offered next day. This file is what the only schedule in the repo points at (`config/freecash-crontab:8`).
2. **`finance-monitor/src/wait_gate.py:95-114` — approval fabricated by RNG**, consumed by `src/action_executor.py:31-33` (`user_consent.get("approved")` → executes `_api_simulate`) and by `__init__.py:298-305`. Today the "execution" is a log entry, so no money moves — but the gate that is supposed to make that safe does not exist, it only *looks* like it does.
3. **`finance-monitor/__init__.py:298-302` — the approval call cannot even be made**: `request_approval(action_id=…, action_type=…, **status_snapshot)` passes `status`/`balance_snapshot_fiat_usd`/… as unexpected kwargs and omits the required `action_details`/`user_email` → `TypeError`. So the *only* production attempt to use the gate fails before reaching it.
4. **`server/tasks/register_approved_change.py:46-57`** — writes an `approved_changes` audit row (currently a hard error because the table is missing), which the README (`README_daily-monitor.md:61`) says a *"supervised action scheduler"* will consume. **No such scheduler exists in the repo** → the ledger gates nothing.
5. **`scripts/monitoring/free-cash-daily-check.py:284-291`** — the R4 section is a comment that says the approval workflow is *"implemented by user before deploy"*; any deployer who follows `README_daily-monitor.md:61`'s pattern would add action execution there with **no gate in this file**.
6. **`daily-finance-monitor.py:315-323`** — `needs_approval` is decided by a **string test** (`:317`: `'payout' in account_name.lower() or 'transfer' in change_type`). An action whose name/type does not contain those words is treated as needing no approval, and the branch that "halts" only prints.

Endpoints referenced but never gated (no approval path exists around them):
`scripts/finance_monitor.py:49-52` and `:101-105` (4 GET endpoints, read-only, ungated) · `freecash-daily-monitor.mjs:32` (GET, ungated) · `notification_service.py:130` (`smtplib.SMTP(...).sendmail`, ungated and broken).

### Hardcoded / placeholder / missing values that break a real run

| Value | Location | Problem |
|---|---|---|
| `/path/to/AgenticOS/…` (twice, incl. the log path) | `config/freecash-crontab:8` | Literal placeholder — the only schedule in the repo cannot execute |
| `http://localhost:3001/api/v1/status/metrics` | `free-cash-daily-check.py:25-26` | **Invented endpoint**: no such route in the server (`grep "status/metrics" server/src` → only `/api/revenue/metrics`, `server/src/routers/revenue.ts:390`) |
| `https://api.freecash.com/v1/status` | `freecash-daily-monitor.mjs:32` | Repo-recorded measurement: **HTTP 404** (`.hermes/plans/2026-09-17_213843-free-cash-finance-automation.md:39`, `docs/free-cash-finance-automation-workflow-plan.md:20`). Also the URL→path parser at `:97-99` yields `v1/status` **without a leading slash**, so the request line is malformed even if the host existed |
| `https://api.example.finance/v1` | `finance-monitor/src/api_client.py:22` | Placeholder host; `fetch_account_status` returns hardcoded `balance_snapshot_fiat_usd: 1234.56` (`:60`), `get_earnings_summary` returns `4250.00 + period_days*130` (`:95`) — invented data |
| `smtp.example.com`, `noreply@finance-monitor.example.com`, `#finance-alerts` | `finance-monitor/src/notify_manager.py:48,52,60` | Placeholders; no SMTP call exists anyway |
| `D:/AgenticOS/configs/approval_gate.json` | `approval_gate.py:133` | Directory `D:/AgenticOS/configs/` **does not exist** |
| `D:/AgenticOS/secrets/signing.key`, `SIGNING_KEY` | `approval_gate.py:21,35` | Directory `D:/AgenticOS/secrets/` **does not exist**; key resolves to `None` → `jwt.encode` raises |
| `D:/AgenticOS/configs/finance_settings.json` | `finance_monitor.py:212` | Missing → `FileNotFoundError`; if it fails before `:223`, the `except` at `:251-253` then hits an unbound `log_file` |
| `D:/AgenticOS/configs/notification.json` | `finance_monitor.py:240-243` | Missing → notification block silently skipped |
| `%APPDATA%/FreeCash/tokens.json` | `finance_monitor.py:21-23` | External, unverified; absent ⇒ `token` falsy ⇒ `main()` prints "No API token configured" and returns 1 (`:217-219`) |
| `D:/AgenticOS/data/monitoring/` | `free-cash-daily-check.py:27` | Directory **does not exist**; only created inside `save_last_run`/`load_snapshot`, and `load_snapshot` (`:59-67`) creates it while `save_snapshot` (`:70-76`) derives its parent from `Path(ISO-timestamp).parent` → `Path('.')`, i.e. CWD |
| `finance-monitor/config/monitor.json`, `scripts/run_daily_check.ps1`, `Finance-Daily-Monitor` task, `.env`/`SANDBOX_MODE` | `finance-monitor/config/scheduler_setup.md:29,68,109`; `.COMPLETION_REPORT.md:47,121,151`; `.VERIFIED.md:46` | **None of these exist** (verified by `find`). `SANDBOX_MODE` appears only in prose; the code derives sandbox from `config_path.exists()` (`wait_gate.py:31`, `notify_manager.py:29`) — so the documented "set `SANDBOX_MODE=false`" step is a no-op |
| `approved_changes`, `status_checks`, `accounts`, `events_logs`, `pending_changes` tables | `register_approved_change.py:47`; `daily-finance-monitor.py:56,68,111-118`; `README_daily-monitor.md:125` | `server/database.sqlite` contains **0 tables** → every DB read/write path fails on first use |
| `.env` variables `FREECASH_NOTIFICATION_EMAIL`, `FREECASH_WEBHOOK_URL`, `FREECASH_STATUS_API` | `freecash-daily-monitor.mjs:28-32` | Unset; and `.hermes/plans/2026-09-17_213918-…md:33` records that no `FREECASH_*` key exists in `.env` or `server/.env` |

### What the code actually contacts (literal hosts/paths)

| Implementation | Host / path | Real or invented | Reached? |
|---|---|---|---|
| `freecash-daily-monitor.mjs` | `GET https://api.freecash.com/v1/status` (`:32`, `:96-102`) | **Invented** (repo-recorded 404) | never (file does not parse) |
| `free-cash-daily-check.py` | `GET http://localhost:3001/api/v1/status/metrics` (`:25-26`) | **Invented** (route absent in `server/src`) | never (`main()` uncalled) |
| `daily-finance-monitor.py` | no HTTP; SQLite file `D:/AgenticOS/server/database.sqlite` (`:32`, `:275`) | real path, **empty schema** | queries fail at `:56` |
| `make_freecash_check.py` | **nothing** — `fetch_status()` returns `{"balance": 0, "available_to_withdraw": 0, …}` (`:14-15`) | n/a | n/a |
| `finance_monitor.py` | `GET <config base> + /accounts/overview, /transactions/recent, /balance/current, /alerts/status` (`:48-52`, `:101-105`) | base URL is **config-supplied and the config is missing** | never |
| `notification_service.py` | `smtplib.SMTP(<config smtp_server>, 587)` (`:130`) | config missing | never (and `:171` NameError first) |
| `approval_gate.py` | `POST`-shaped consent URL `<webhook_url>/<user>/approve?token=…` (`:61`) — string only, never fetched | `webhook_url` from missing config | never |
| `finance-monitor/**` | `https://api.example.finance/v1` (`api_client.py:22`), `smtp.example.com` (`notify_manager.py:48`) | **invented placeholders** | **never** — no HTTP/SMTP client is imported anywhere in the package |
| `freecashMonitorAdapter.ts` | none; `externalConnected: false`, *"External FreeCash API connection is not configured"* (`:206-207`) | n/a | n/a |

Net: **no candidate contacts a real provider.** Two of them reference invented hosts, and neither of those references is ever executed.

---

## (d) Gap list ranked by severity for a 30-day unattended run

| Rank | Gap | Evidence (file:line) | Why it blocks 30 days |
|---|---|---|---|
| **1** | **There is no runnable, scheduled monitor.** Every candidate is either unparseable, uninvoked, or unwired | `node --check` → `freecash-daily-monitor.mjs:41` SyntaxError; `free-cash-daily-check.py:294` has no `if __name__`; `finance-monitor/src/rule_engine.py:122` SyntaxError (confirmed by running the package's own test: `SyntaxError: f-string: invalid syntax`); `finance-monitor/__init__.py:236,241` `get_status` undefined; `finance-monitor/src/orchestrator.py` has no entry point; `finance_monitor.py:45` `async` never awaited (`result` is a coroutine → `TypeError` at `:227`); schedule = `config/freecash-crontab:8` with `/path/to/AgenticOS`; `schtasks` shows no registered task | Day 1 produces nothing; R1 is unsatisfiable because there is nothing to run |
| **2** | **The human-approval gate is either missing or fabricated** | `wait_gate.py:95-102` returns `True` from `random.choice` with no human; `daily-finance-monitor.py:197` / `free-cash-daily-check.py:206` gates never called; `approval_gate.py:47-53` vs `:73-82` tokens unverifiable; `freecash-daily-monitor.mjs:214-220` queue never persisted | Any action path that gets implemented inherits an "approved" verdict that no human gave, or no verdict at all |
| **3** | **No notification can be delivered by anything** | `freecash-daily-monitor.mjs:235-243` (stub console.log); `free-cash-daily-check.py:182` (print) + `:266/:270` (change detection structurally dead); `daily-finance-monitor.py:179-193` (print, SMTP commented) + `:306` (`change_count == 1`); `notify_manager.py:128-132` returns `True` while delivering nothing; `notification_service.py:171` NameError + `:124-125` empty recipients; `make_freecash_check.py` has none | R3 unenforced for 30 days — the operator learns nothing, so even a manual approval loop cannot start |
| 4 | **R2 latent breach sitting on the wired path** | `make_freecash_check.py:19-20` (withdraw action) + `:85-87` (execution loop) + `:49-52` (stub returning `success=True`); `config/freecash-crontab:8` targets this file | One "finish the stub" edit converts the only scheduled file into an automated withdrawal |
| 5 | **No state, no schema, no evidence trail** | `server/database.sqlite` → 0 tables (needed by `register_approved_change.py:47`, `daily-finance-monitor.py:56,68,111-118`); `data/monitoring/` and `configs/` do not exist; only recorded run is `--simulate-notification` (`server/tasks/daily_monitor.log`) | Even a manually-triggered run cannot record what it saw; a 30-day audit trail is impossible |
| 6 | **Doc claims contradict the code** (trust hazard) | `.VERIFIED.md:23` "Clean syntax – No lint errors" vs `rule_engine.py:122` SyntaxError; `.VERIFIED.md:46` "set `SANDBOX_MODE=false`" (no such switch); `.COMPLETION_REPORT.md:47` non-existent `run_daily_check.ps1`; `:121` flag file with no writer; `:157` `--list` is not an accepted option (`test_rule_enforcement.py:196-208`); `README_daily-monitor.md:96,137` "last_run_time.json enforces once-per-day" (it is a 24 h window written before the work) | The repo currently tells a reader the routine is ready; it is not |

---

## (e) Recommendation — one implementation to consolidate on

**None of the seven candidates is compliant today; do not deploy any of them as-is.**
Consolidate on **`D:/AgenticOS/scripts/make_freecash_check.py`** — the only file in the repo with a real, reachable R1 gate and a real approval gate placed *before* action execution — and treat everything else as reference material.

Why this one (all verifiable above):

1. **R1 is genuinely implemented, not documented**: `:69-73` compares a UTC calendar-day key from `data/freecash/state.json`; `:62-64` writes it. This is the only calendar-day gate in the repo that is actually on an executable path.
2. **R4 is genuinely implemented and correctly ordered**: `prompt_approve()` (`:24-46`) runs at `:83`, *before* the execution loop at `:85-87`; unapproved actions are never executed; the default is "no action".
3. **R2 has no live write path**: the only action object is a `withdraw` whose executor `run_action` (`:49-52`) performs no I/O — a no-op stub, not a live endpoint.
4. **It is the file the only schedule points at** (`config/freecash-crontab:8`), so consolidating here costs the fewest wiring changes.
5. **It is small (2 957 B) and syntactically clean** (`ast.parse` OK) — cheaper to harden than the 72 KB `finance-monitor/` skeleton, which cannot even be imported.

Mandatory hardening before it can run 30 days unattended (in order):

1. Replace `fetch_status()` (`:14-15` — hardcoded zeros) with a real read-only source **once one exists**. Until a documented provider endpoint and credential exist, run the routine ledger-only: read a state file the operator maintains. Do **not** ship `api.freecash.com` (404) or `localhost:3001/api/v1/status/metrics` (no such route).
2. **Delete the action path**: `prepare_actions()` `:18-21`, `run_action()` `:49-52`, and the execution loop `:85-87`; record `approved` as a *request* (JSONL/queue row) instead. This removes the only woundable R2 surface.
3. Make R4 non-interactive: `input()` at `:33` cannot work under cron/Task Scheduler. Write an approval **request** to `data/freecash/approval-queue.json` and require a separate, human-run step to record consent.
4. Add R3: persist the previous snapshot, diff it, and deliver through a channel that exists. Prefer fixing `notification_service.py` (`:171` NameError, `:124-125` recipients, `:157-158` SMS mock returns success) and reuse it rather than writing a fourth notifier.
5. Fix the schedule: `config/freecash-crontab:8` must carry real absolute paths, and the task must actually be registered — today none is.
6. Create the state/schema the routine needs (`data/freecash/`, the approval ledger table) and fix `register_approved_change.py:67` (`timedelta` import) so the audit write is not reported as a failure.
7. Re-run a verifier that *executes* code rather than greps it (see §f) before claiming compliance again.

Do not consolidate on `finance-monitor/**`: `rule_engine.py` cannot be imported, `__init__.py` raises `NameError`/`KeyError`, `wait_gate.py` fabricates approval, and there is no entry point, config, or scheduler — its `.VERIFIED.md` is unsupported (details in §f).

---

## (f) Verification-integrity findings and UNVERIFIED section

**`server/scripts/verify-freecash-rules.mjs` is not a verifier.** It exists (3 034 B, `server/scripts/`, untracked; the skill's claimed path `scripts/verify-freecash-rules.mjs` does **not** exist — `find` shows only `server/scripts/…` and a byte-identical `release/win-unpacked/resources/…` copy). It only greps source text, and two of its four checks are tautologies:

- `:34-35` `checkRule3` → `!content.includes('checkForChanges') || content.includes('.log(')` — the file does contain `console.log`, so this returns `true` unconditionally.
- `:41-43` `checkRule4` → `… || content.includes('approval-request.json')` — the string appears in the config block at `freecash-daily-monitor.mjs:35`, so this too is unconditionally `true`.
- `:26-28` `checkRule2` passes on the mere presence of the strings `isDailyCheckAllowed` / `lastCheck.date !== today`, which are present in a file that does not compile.

Real, reproduced output (`node server/scripts/verify-freecash-rules.mjs`, exit 0), run against `freecash-daily-monitor.mjs`, which `node --check` rejects:

```
[CHECK] Rule 1: No auto-earning actions...   Result: PASSED
[CHECK] Rule 2: Once per day check...        Result: PASSED
[CHECK] Rule 3: Notify on earnings/status changes...  Result: PASSED
[CHECK] Rule 4: Human approval before external action...  Result: PASSED
[OK] All 4 operational rules verified (4/4 passed)
```

`.VERIFIED.md` ("Prototype Status: READY", "zero syntax errors") and `.COMPLETION_REPORT.md` ("PROTOTYPE STATUS: VERIFIED & READY") are **unsupported**: the package's own test cannot start —

```
$ python D:/AgenticOS/finance-monitor/tests/test_rule_enforcement.py --list
  File "D:\AgenticOS\finance-monitor\src\rule_engine.py", line 122
    (snapshot_hash[:8]...)
SyntaxError: f-string: invalid syntax. Perhaps you forgot a comma?
```

Commands actually run for this audit (all read-only, no network, no repository modifications):

```
node --check server/scripts/freecash-daily-monitor.mjs        # SyntaxError line 41
node --check server/scripts/verify-freecash-rules.mjs         # clean
node server/scripts/verify-freecash-rules.mjs                 # 4/4 PASSED (false)
python -c "import ast; ast.parse(open(F).read())"             # 15 files: 14 OK, rule_engine.py:122 SyntaxError
python D:/AgenticOS/finance-monitor/tests/test_rule_enforcement.py --list   # SyntaxError on import
python -c "sqlite3 … sqlite_master"                            # server/database.sqlite: 0 tables
schtasks //query //fo LIST | grep -i "freecash|finance|monitor"  # no matches
git status --porcelain / git ls-files / git log --oneline -1
stat / ls -la / find (existence, size, mtime, duplicates)
```

Cleanup: the one artifact my run created (`finance-monitor/tests/__pycache__/test_rule_enforcement.cpython-311.pyc`) was **deleted**. `finance-monitor/__pycache__/` and `finance-monitor/src/__pycache__/` were created at 21:41:57–21:42:00 by a **concurrent** process, not by this audit, and were left untouched (note: `src/__pycache__` contains no `rule_engine.*.pyc`, independently corroborating the SyntaxError). `server/tasks/__pycache__/` (21:38) likewise pre-exists this audit. No tracked or untracked pre-existing file was modified, deleted, or reset.

### UNVERIFIED

- **Provider reality.** Whether any real, documented read-only endpoint exists for this entity is **not established by me**. I made no network call. The repo-recorded claims that `api.freecash.com/v1/status` → 404 and that freecash.com forbids automated access (`.hermes/plans/2026-09-17_213843-…md:39,86,211`, `.hermes/plans/2026-09-17_213918-…md:33,62`, `docs/free-cash-finance-automation-workflow-plan.md:20`, `docs/free-cash-monitor-routine/RESEARCH-PLAN.md:15-17,46-47`) are **another agent's measurements, cited here as repo text, not re-verified by me**.
- **Whether any of these scripts has ever been executed against real data.** `server/tasks/daily_monitor.log` proves one `--simulate-notification` run; I found no log, DB row, or output file for any other candidate. Absence of evidence, not proof of absence.
- **Runtime behaviour of the interactive gates** (`make_freecash_check.py:33`, `daily-finance-monitor.py:236`) under cron/Task Scheduler: I did not execute them (they would block on stdin). The `EOFError` claim is read from the code path `:33` → `:91`, not observed.
- **`finance-monitor/` import failure inside a properly-packaged context.** I did not `pip install`/repackage anything; the "cannot be imported as a package" statement rests on the hyphenated directory name and the `from src.rule_engine import …` statements plus the reproduced SyntaxError.
- **The `approved_changes` / `status_checks` / `events_logs` tables** may exist in a different database or be created by migrations not present in this working tree; I only confirmed absence in `server/database.sqlite` (0 tables) and by grep.
- **Legality/ToS** of any automated monitoring of the named provider is outside this audit's evidence base; it is flagged in `docs/free-cash-monitor-routine/RESEARCH-PLAN.md` (§F1–F3) by a sibling workstream.

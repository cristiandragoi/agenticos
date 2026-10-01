# Free Cash Finance Automation — Workflow Plan

**Goal:** Make the once-daily Free Cash monitoring routine actually execute end-to-end inside D:\AgenticOS — read-only, once per calendar day, change-only notifications, hard human-approval gate — with every claim backed by live tool output.

**Architecture:** One authoritative runner (Python, stdlib + `requests`) owns the schedule, the state file, the read-only provider client, the notifier and the approval queue. The existing duplicate implementations (`finance-monitor/`, `server/scripts/*.mjs`, `server/tasks/*.py`, `scripts/make_freecash_check.py`) are either wired into that runner or explicitly retired — no third parallel implementation.

**Tech Stack:** Python 3.11.9 (present), `requests` 2.33.0 (present), Windows Task Scheduler or Hermes cron for the trigger (no cron installed today), Node 24 present but not required.

**Repo:** D:\AgenticOS (branch `hermes-rescue-20260908`, worktree dirty with unrelated modified files — never reset, never `git checkout`).

---

## 1. Verified Current State (2026-09-17 21:38 local, UTC+02:00)

Four-state model per `agenticos-runtime-verification` skill.

| Layer | Evidence | Status |
|---|---|---|
| SOURCE | 6 independent Free Cash implementations exist (see §1.1) | fragmented |
| BUILD | `finance-monitor/src/rule_engine.py:122` → `SyntaxError: f-string: invalid syntax` | **broken** |
| RUNNING | `schtasks /query \| grep -i freecash` → empty; Hermes `cronjob_manage list` → `count: 0` | **nothing scheduled** |
| USER-OBSERVED | `turnController.ts:415` already answers: "live external account connectivity is disconnected" | **honest-negative** |

### 1.1 Implementation inventory (measured, not assumed)

| Artifact | Verified condition |
|---|---|
| `server/src/adapters/freecashMonitorAdapter.ts` | Valid TS, reachable from `jarvisV2/turnController.ts:414` and `jarvisNext/operator/operatorController.ts:115`. `fetchStatus()` returns `externalConnected: false`, `statusAlerts: []` — a sandbox stub, no I/O. |
| `finance-monitor/src/*.py` | `rule_engine.py:122` syntax error → package non-importable → `orchestrator.py` (imports `RuleEngine`) is dead code. `check_rule3` does `float(current_hash) - float(snapshot_hash)` on string hashes. |
| `finance-monitor/.VERIFIED.md` | Claims "Clean syntax - No lint errors" and "READY". **False** — contradicted by `ast.parse`. |
| `finance-monitor/config/monitor.json` | Missing (only `README.md`, `scheduler_setup.md` exist). |
| `finance-monitor/scripts/run_daily_check.ps1` | Missing; `scheduler_setup.md:29,105` points Task Scheduler at it. |
| `server/scripts/freecash-daily-monitor.mjs` | `node --check` → `SyntaxError: Unexpected token ':'` (TypeScript annotations in `.mjs`) + `require()` inside ESM. **Cannot run.** |
| `scripts/finance_monitor.py` | Needs `configs/finance_settings.json` — absent repo-wide. Live run: `FileNotFoundError` → except-block `UnboundLocalError: log_file` → exit 1, **no log written**. |
| `scripts/make_freecash_check.py` | `BASE = parents[2]` → targets `D:\data\freecash` (drive root; does not exist). `save_today()` lacks `mkdir` → exit 1. `fetch_status()` returns hard-coded zeros — no data source. |
| `scripts/notification_service.py` | `send_notification()` references bare `config` (line 171) → `NameError` on every call; `sent` unbound for non-email/sms channels. |
| `server/tasks/daily-finance-monitor.py` | Malformed SQL (`name,.balance` line 74); needs tables `accounts`, `events_logs`, `status_checks`. `server/database.sqlite` is **0 KB / 0 tables**. |
| `config/freecash-crontab` | Placeholder paths (`/path/to/AgenticOS/...`); not installed anywhere. |
| Provider connectivity | `GET https://api.freecash.com/v1/status` → **HTTP 404**; `freecash.com` → 302. No `FREECASH_*` / `FREE_CASH_*` keys in `.env` or `server/.env`. |

### 1.2 Doc-level constraint conflicts (must be resolved before coding)

| Doc | Ordering of rules |
|---|---|
| `free-cash-finance-monitoring-specification.md` | 1 once/day · 2 zero-earning · 3 notify · 4 approval |
| `server/data/freecash-monitor/README.md` | 1 zero-earning · 2 once/day · 3 notify · 4 approval |
| `docs/freecash-monitoring.md` | 1 once/day · 2 no-auto-actions · **3 human approval** · **4 balance logging** |

Three docs, three different rule numbers.

---

## 2. Canonical Operational Constraints (binding for all work below)

| ID | Constraint | Machine-enforced check |
|---|---|---|
| C1 | **Read-only.** No POST/PUT/PATCH/DELETE to any provider or financial endpoint, ever. Only `GET`/`HEAD`. | Static grep over the runner for `requests.post\|put\|patch\|delete` → 0 hits; runtime HTTP response log shows GET only. |
| C2 | **Once per calendar day (UTC)** with ≥24 h cooldown; max 1 attempt per day, no retry storm. | Second same-day invocation exits 0 with `"already checked <date>"` and does not touch the network. |
| C3 | **Notify on change only.** Identical state → silent log line, zero notifications. Dedupe by SHA-256 of normalised state. | Two consecutive runs with frozen fixture produce exactly 1 notification. |
| C4 | **Human approval before any external write.** Missing/expired token ⇒ `ApprovalRequired` raised, no API call. **Deny-by-default.** | Token absent → action raises; network log shows no write attempt. |
| C5 | **No secrets in repo, logs, or chat.** Env/vault only; `[REDACTED]` in any artifact. | `grep -ri "api[_-]key\|token=" logs/ data/` → only redaction markers. |
| C6 | **Evidence discipline.** PASS only from live runtime output; "file written" claims need a read-back. | Every phase gate below names the command that proves it. |

Rule numbering for all docs/code from here on: **R1 = zero automated earning action, R2 = once per day, R3 = notify on change, R4 = human approval.** `docs/freecash-monitoring.md` must be corrected (its R3/R4 are swapped and R4 "balance logging" is a logging requirement, not a safety rule).

---

## 3. Options

### Option A — Single read-only runner, ledger-only (no live account binding)
Repair one Python runner that executes R1–R4 against a pluggable status source, starting with a local fixture/ledger source until real credentials exist.
- **Expected Effort:** 6–9 h (fix runner, scheduler, notifier, approval queue, acceptance suite).
- **Time-to-Revenue:** $0 direct. Indirect: prevents missed withdrawal windows and produces the earnings ledger an accountant/cashout decision needs — first measurable effect the day after first scheduled run.
- **Dependencies:** Python 3.11.9 + `requests` (present), write access to `D:\AgenticOS\logs`, `data\freecash`, one scheduler (Task Scheduler or Hermes cron).
- **First Concrete Action:** `python - <<'EOF'` AST-scan gate over `scripts/` + `finance-monitor/` to freeze the defect baseline, then fix `finance-monitor/src/rule_engine.py:122`.

### Option B — Bind the runner to the real Free Cash account (browser-session read path)
Keep C1 (GET-only / read pages), obtain status from the authenticated Free Cash web session via the browser tool or the notification-email path, since no public account API exists.
- **Expected Effort:** 4–8 h after Option A lands (session capture, field mapping, staleness guards).
- **Time-to-Revenue:** first real balance/earnings reading visible in the daily report; cash only moves when the user completes offers and triggers a cashout — that step stays human.
- **Dependencies:** an actual Free Cash login (user-provided, vault-stored), working browser session, HTML/field stability, acceptance of ToS/rate limits.
- **First Concrete Action:** one manual read-only capture of the account balance/rewards page and diff it against the ledger schema — no credential guessing, no automated login.

### Option C — Third-party "FreeCash API" aggregator (`parse.bot`, HG.Cash, Cashfree)
- **Expected Effort:** 8–14 h (contract discovery, per-provider auth, schema mapping, reconciliation).
- **Time-to-Revenue:** unknown; none of these is a documented personal-account API for freecash.com (404 measured on `api.freecash.com`).
- **Dependencies:** paid third-party subscription, unverified data provenance, credential custody for an account that can move money.
- **First Concrete Action:** read-only contract probe of one provider's `/accounts` endpoint with a trial key, then decide.
- **Verdict:** **not recommended** — adds a funds-capable third party inside a read-only discipline with no verified benefit.

### Option D — Retire the parallel artifacts and keep the adapter's honest-negative answer
- **Expected Effort:** 1–2 h (delete/mark-superseded `finance-monitor/`, `.mjs`, `server/tasks/*.py`, wrong cron file).
- **Time-to-Revenue:** $0; removes false-PASS surface that has already produced a wrong `.VERIFIED.md`.
- **Dependencies:** none.
- **First Concrete Action:** move the four dead artifacts to `docs/archive/freecash-retired/` with a one-paragraph post-mortem each (no deletions without confirmation).

**Recommended:** **D → A → B.** Retire the false surface first so verification means something, then make one runner real, then bind the real account read-only.

---

## 4. Step-by-Step Work

> Convention: every task ends with a command whose output is the proof. No PASS without it.

### Phase 0 — Retire and baseline (Option D)

**Task 0.1 — Freeze the defect baseline**
- Files: create `docs/freecash/BASELINE-2026-09-17.md`
- Run: the AST/`node --check` scan from §1.1; paste raw output into the doc.

**Task 0.2 — Quarantine superseded artifacts**
- Move (do not delete): `finance-monitor/` → `docs/archive/freecash-retired/finance-monitor/`; `server/scripts/freecash-daily-monitor.mjs`; `server/tasks/daily-finance-monitor.py`; `config/freecash-crontab`.
- Keep `server/src/adapters/freecashMonitorAdapter.ts` (it is wired into two live controllers and carries the honest-negative message).
- Run: `git status --porcelain` → confirm only adds/renames, no modifications to the 30+ unrelated dirty files.

**Task 0.3 — Correct the false verification claim**
- File: `docs/archive/freecash-retired/.../finance-monitor/.VERIFIED.md` — annotate each "✓ Verified" row with the actual measured status.
- Run: `read_file` read-back of the edited file.

**Task 0.4 — Canonicalise rule numbering**
- File: `docs/freecash-monitoring.md` — apply R1–R4 mapping from §2; add a "superseded" banner to the other two spec docs pointing at one source of truth.
- Run: `search_files "Rule #?3" docs/` → all hits agree.

### Phase 1 — One runner (Option A)

**Task 1.1 — Scaffold the runner package with a failing test**
- Create `scripts/freecash_runner/__init__.py`, `scripts/freecash_runner/state_store.py`, `tests/freecash/test_state_store.py`.
- Test: writing then reading today's run date; second call returns `already_ran_today=True`.
- Run: `python -m unittest tests.freecash.test_state_store -v` → **FAIL** (`ModuleNotFoundError`).

**Task 1.2 — Implement `state_store.py` minimum**
- `data/freecash/state.json` = `{"last_run_utc": "...", "last_run_date": "YYYY-MM-DD", "state_hash": "<sha256>"}`; `mkdir(parents=True, exist_ok=True)` before every write (the current `make_freecash_check.py` bug).
- Run: same command → **PASS**; then `read_file data/freecash/state.json` for read-back.

**Task 1.3 — Red: cooldown + once-per-day gate (C2)**
- `tests/freecash/test_cooldown.py`: 12 h ago → blocked with reason `cooldown`; 25 h ago → allowed; same UTC date → blocked with reason `already_ran_today`.
- Run: `python -m unittest tests.freecash.test_cooldown -v` → FAIL.

**Task 1.4 — Green: `scripts/freecash_runner/cooldown.py`**, `MIN_COOLDOWN_HOURS = 24`, injected clock for testability.
- Run: same command → PASS. Exit code for a blocked run is **0** (a skip is not a failure).

**Task 1.5 — Read-only client with a hard write guard (C1)**
- `scripts/freecash_runner/read_client.py`: `requests.Session`, allow-list of GET paths, default `timeout=30`, `max_consecutive_failures=3` circuit breaker.
- A `_forbid_write(method)` guard raises `WriteAttemptBlocked` for any non-GET.
- Test `tests/freecash/test_read_only.py`: monkeypatched session records methods; assert the recorded set == `{"GET"}`.
- Run: `python -m unittest tests.freecash.test_read_only -v` → PASS.

**Task 1.6 — Wire the runner entrypoint**
- `scripts/freecash_runner/main.py`: load config → cooldown gate → read → hash → diff vs `state.json` → notify if changed → append ledger → save state. Exit codes: 0 ok/skip, 1 error, 2 approval pending.
- Config: `config/freecash/monitor.json` (new) with `schedule`, `thresholds`, `notification`, `approval`, `read_only_endpoints` — replaces the never-created `configs/finance_settings.json`.
- Run: `python scripts/freecash_runner/main.py` → prints JSON summary; `echo $?` → 0; then re-run → `already checked` and `echo $?` → 0.

**Task 1.7 — Ledger + audit trail (C6)**
- `data/freecash/YYYYMMDD.log` — one JSON line per run including `prev_balance`, `current_balance`, `change`, `actions_considered`, `approvals`, `complete`.
- Run: `read_file data/freecash/<today>.log` → exactly one line per run, no secrets.

### Phase 2 — Notify on change only (C3)

**Task 2.1 — Red: dedupe test** — frozen fixture, two runs, assert exactly 1 notification.
**Task 2.2 — Green: `scripts/freecash_runner/notifier.py`** — hash-compare, 1-minute dedupe window, channels email→push, **no retry loop**, failures logged and counted (3 consecutive failures → single ops alert).
- Replace `scripts/notification_service.py`'s `NameError` path; keep it only as an archive artifact.
- Run: `python -m unittest tests.freecash.test_notifier -v` → PASS, notification count printed.

### Phase 3 — Approval gate (C4)

**Task 3.1 — Red: missing token ⇒ halt** — `test_approval_gate.py`: no token → `ApprovalRequired` raised and **zero** HTTP writes attempted; valid 15-min token → exactly one approved call recorded.
**Task 3.2 — Green: `scripts/freecash_runner/approval_gate.py`** — HMAC-SHA256 signed, 15-minute expiry, single-use, JSON queue at `data/freecash/approval-request.json`, expiry ⇒ abort (never default-allow).
- Signing key from env `FREECASH_APPROVAL_KEY`; log only the token fingerprint (C5).
- Run: `python -m unittest tests.freecash.test_approval_gate -v` → PASS. Also `search_files "FREECASH_APPROVAL_KEY" logs/ data/` → only fingerprint lines.

### Phase 4 — Bind the real data source (Option B)

**Task 4.1 — Read-only capture** of balance/earnings/rewards fields from the authenticated session (browser tool or notification email). Record the exact field names in `docs/freecash/provider-fields.md`.
**Task 4.2 — Add an adapter behind the existing interface** so `read_client` accepts `source="fixture" | "freecash-web"`; fixture stays the default until Task 4.1 is signed off.
**Task 4.3 — Staleness guard**: page older than 24 h ⇒ `status: "stale"`, notify, never act.
- Run: `python scripts/freecash_runner/main.py --source freecash-web` → JSON with real numbers, plus a ledger line.

### Phase 5 — Schedule and acceptance

**Task 5.1 — Register the trigger** (one only): Windows Task Scheduler task `FreeCashDailyCheck` → `python D:/AgenticOS/scripts/freecash_runner/main.py`, daily 08:00 local, run-if-missed, 1 h limit — **or** a Hermes cron job. Not both.
- Verify: `schtasks /query /fo list /v /tn FreeCashDailyCheck | grep -E "TaskName|Schedule|Next Run|Last Result"` **or** `cronjob_manage list` shows exactly one enabled job.
**Task 5.2 — Missed-window alert**: if no successful run by 12:00 local, emit one summary alert to the configured channel (C2 "raise alert if missed").
**Task 5.3 — Acceptance matrix** `docs/freecash/ACCEPTANCE.md`, all run live:

| # | Constraint | Procedure | Required evidence |
|---|---|---|---|
| AC-01 | C2 | run twice same UTC day | 1 network pass; 2nd prints `already checked`; exit 0 |
| AC-02 | C1 | run with HTTP logging on | method set == {GET}; grep of runner finds no write verbs |
| AC-03 | C3 | frozen fixture ×2 | exactly 1 notification |
| AC-04 | C3 | frozen fixture ×1 | 0 notifications, silent ledger line present |
| AC-05 | C4 | action with token removed | `ApprovalRequired`; 0 write attempts |
| AC-06 | C4 | valid 15-min token, then re-use | 1 success, 2nd rejected expired/used |
| AC-07 | C2 | simulate crash mid-run | no false `complete: true`; next-day run proceeds |
| AC-08 | C6 | every AC above | raw stdout + exit codes pasted into the doc |

**Task 5.4 — Runtime truth check**: ask Jarvis "what's the Free Cash monitoring status?" and confirm the answer matches the runner's real state (adapter stays honest-negative until Task 4.3 lands).

---

## 5. Files Likely to Change

- New: `scripts/freecash_runner/{__init__,main,cooldown,state_store,read_client,notifier,approval_gate}.py`, `config/freecash/monitor.json`, `tests/freecash/test_*.py`, `docs/freecash/{BASELINE-2026-09-17,provider-fields,ACCEPTANCE}.md`.
- Modified: `docs/freecash-monitoring.md` (rule numbering), `server/data/freecash-monitor/README.md` (point at the runner), `server/src/adapters/freecashMonitorAdapter.ts` (status message once Task 4.3 lands).
- Quarantined (moved, not deleted): `finance-monitor/`, `server/scripts/freecash-daily-monitor.mjs`, `server/tasks/daily-finance-monitor.py`, `config/freecash-crontab`, `scripts/make_freecash_check.py`, `scripts/finance_monitor.py`, `scripts/notification_service.py`, `scripts/approval_gate.py`.
- Untouched: the 30+ unrelated dirty files on `hermes-rescue-20260908`.

## 6. Blocker Register

| ID | Blocker | Status | Resolution path |
|---|---|---|---|
| B1 | No public Free Cash account API. `api.freecash.com/v1/status` → 404 (measured). | **OPEN — external** | Option B read path (session/email) or drop the account binding and run ledger-only. |
| B2 | No Free Cash credentials/endpoints configured (`externalConnected: false`; no `FREECASH_*` env keys). | **OPEN — user input** | User supplies login via vault (never in chat); never guessed. |
| B3 | Three docs disagree on rule numbers; two docs claim verification that measurement contradicts. | **Resolvable now** | Task 0.4 + Task 0.3. |
| B4 | `pytest` not installed (stdlib `unittest` used instead). | Mitigated | Tests written for `python -m unittest`. |
| B5 | `server/database.sqlite` is 0 KB / 0 tables, so the DB-backed monitor variant has no data. | Closed by quarantine | Option D. |

## 7. Risks

- **False PASS recurrence.** `.VERIFIED.md` already asserted clean syntax while `rule_engine.py` did not parse. Mitigation: every task's gate is a command output, never a doc statement.
- **Over-notification.** Dedupe window + no-retry rule (Task 2.2); consecutive-failure counter instead of loops.
- **Approval fatigue → default-allow drift.** C4 is deny-by-default with expiry abort; the test asserts 0 write attempts when the token is absent, not "proceeds with warning".
- **Scope creep into a second scheduler.** One trigger only; Task 5.1 verifies exactly one registered job.
- **Doing an automated cashout.** Out of scope permanently: R1 forbids it; withdrawals remain a human action outside the runner.

## 8. Open Questions

1. Which single source is authoritative for the account data — browser session or the notification email?
2. Retire or keep `scripts/approval_gate.py` (unverified, overlaps Task 3.2)?
3. Is the intended account a *rewards* account (freecash.com-style) or an *investment/checking* account (the "dividend/interest" wording in two specs)? The provider is undecided in the current docs.

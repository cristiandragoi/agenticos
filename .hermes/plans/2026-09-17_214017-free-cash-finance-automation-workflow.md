# Free Cash Finance Automation — Workflow Plan

**Repository:** D:\AgenticOS (branch `hermes-rescue-20260908`)
**Mode:** plan only. No project file was modified while producing this document.
**Goal:** Make the existing Free Cash runtime path (Jarvis → OperatorController → mission/tasks → daily monitor) actually execute and actually obey the four operational rules, instead of relying on artefacts that only satisfy textual checks.

**Architecture:** Reuse the live path that already exists — `operatorController` (intent "start free cash"), `missionPlanner`, `backgroundTaskManager`, `schedules` table in `server/data/agentic-os.db`, and `freeCashMonitorAdapter`. Repair the enforcement chain so that each rule is backed by a runtime assertion, then optionally attach a real read-only provider. No new parallel stacks, no voice-runtime edits.

**Tech stack:** TypeScript (server, vitest), Node 20 ESM, Python 3.11.9 (`python` only; `python3` is absent), SQLite via drizzle/rawDb.

---

## 1. Verified current state (live tool output, this session)

| Check | Command | Result |
|---|---|---|
| Adapter exists | `ls server/src/adapters/` | `freecashMonitorAdapter.ts` present (6 428 B) — my first check used repo-root `src/adapters/` and was wrong |
| Adapter is wired | `grep -rn freeCashMonitorAdapter server/src` | used at `jarvisNext/operator/operatorController.ts:115` and `jarvisV2/turnController.ts:414` — **not dead code** |
| Adapter has real data | read `fetchStatus()` | returns hard-coded `externalConnected: false`, `statusAlerts: []`, `adapterHealth: 'healthy'`; `health()` hard-codes `healthy`, `latencyMs: 5` |
| Rule verifier | `node server/scripts/verify-freecash-rules.mjs` | prints **4/4 PASSED** — but it is a text grep; rule 3 is `!content.includes('checkForChanges') \|\| content.includes('.log(')` which is trivially true |
| Daily monitor parses | `node --check server/scripts/freecash-daily-monitor.mjs` | **SyntaxError: Unexpected token ':' (line 41)** — TypeScript annotations inside a `.mjs` file; also uses `require()` in ESM. The once-per-day script cannot run at all |
| Python monitor runs | `python scripts/finance_monitor.py` | **crashes**: `FileNotFoundError: D:/AgenticOS/configs/finance_settings.json` (no `configs/` dir exists), then `UnboundLocalError: log_file` in its own `except` block |
| Approval gate verifies | round-trip in temp dir with `SIGNING_KEY=testkey` | `token issued: True` → `VERIFY valid=False reason=invalid_token details=Token is missing the "iss" claim` → `capture_consent` always `rejected`. Tokens carry `expires_at` (ISO string), never the JWT `exp` claim, yet `verify_approval` reads `decoded["exp"]` |
| Daily schedule exists | `select * from schedules` in `server/data/agentic-os.db` | 4 rows, **none** is `sched-daily-free-cash-0900`. That id appears only as a string literal at `operatorController.ts:103`. DB mtime `Sep 9 22:08`, last `last_triggered_at` `2026-09-09` |
| Free-cash tests | `npx vitest run src/__tests__/truthfulDelegationAndFreeCash.test.ts` | 5/5 passed (1.13 s) |
| Git tracking | `git ls-files --error-unmatch <each artefact>` | **all six are untracked**: adapter, daily monitor, finance_monitor.py, approval_gate.py, notification_service.py, verify-freecash-rules.mjs |
| Working tree | `git status --porcelain \| wc -l` | 378 modified entries already present — preserve, never reset |
| Runtime deps | — | `requests 2.33.0`, `pyjwt 2.13.0`, `node-cron ^4.6.0` present; `FREECASH_*` env keys unset in `.env` |
| Windows scheduler | `schtasks /query /tn FreeCashDailyCheck` | not present; `crontab` unavailable on this host; `config/freecash-crontab` references placeholder `/path/to/AgenticOS` |
| Store DBs | `D:/AgenticOS/database.sqlite`, `server/database.sqlite` | 0 bytes — no revenue tables there; live store is `server/data/agentic-os.db` (50 MB) |

**Rule reality check today:** Rule 1 holds only because nothing can run. Rule 2 holds only on the adapter's "contains 'double-check'" string check. Rule 3 output is `console.log` only (no email/webhook configured, no real source). Rule 4 fails closed — verification rejects every token, so no external action can ever be authorised. Docs (`INTEGRATION_STATUS.md`, `README.md`) claim all four "COMPLIANT / verified"; that claim is not supported by runtime evidence.

**Conflicting plans already in the repo:** `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md` (SaaS business plan for `opp-4a3f4cfc`, domain purchase, Stripe) vs `free-cash-automation-workflow.md` + `free-cash-finance_monitoring_plan.md` (read-only monitoring routine). They disagree on scope, cost and next steps.

**Operational constraints that bind every step below**
1. No earning action automatically. 2. Status check once per day only. 3. Notify on earnings/account-status change. 4. Human approval before any external action.
Plus: voice runtime is off-limits (`src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/domains/jarvis/*`, JarvisComposer); never write secrets into files or logs; verify with live output after every patch, never from earlier runs; never overwrite uncommitted work.

---

## 2. Options

| # | Option | Expected effort | Time-to-revenue | Dependencies | First concrete action |
|---|---|---|---|---|---|
| A | **Repair the enforcement chain** (rules 1–4 provable at runtime on the existing path) | 6–10 h | none directly; unblocks everything else (gate for any future earning) | No new deps; existing test harness | `node --check server/scripts/freecash-daily-monitor.mjs` must exit 0 — rewrite it as ESM JavaScript (drop `: boolean`/`Promise<T>`, replace `require` with `import`) |
| B | **Persist and fire the daily schedule** (insert `sched-daily-free-cash-0900` into `schedules`, wire the monitor to it) | 4–8 h | none directly; this is what makes rule 2/3 continuous | Option A (monitor must be runnable); DB write approval | Read `server/src/services/scheduler/scheduler.ts` + `scheduleDispatcher.ts` and dump the exact column set the dispatcher requires, then stage a dry-run insert in a temp copy of `agentic-os.db` |
| C | **Real read-only provider connection** (one provider, GET-only, credentials via env/vault) | 8–16 h | Month 0–1 *if* an account exists and pays; otherwise no path | Verified account + read-only API token; provider TOS review; A | Confirm in writing which provider account exists (HG.Cash / Cashfree / other) and fetch that provider's read-only balance endpoint once by hand with curl |
| D | **Notification delivery** (email/webhook out of the monitor, per rule 3) | 3–5 h | none directly | SMTP/webhook credentials; A | Pick channel + env var names, then send one test message through the existing notification service stub |
| E | **Commercialisation** (per `FREE-CASH-WORKFLOW-PLAN.md`: domain, landing page, Stripe, beta) | 20–40 h + spend | Month 3–9 by that document's own estimate; unvalidated | Budget approval, legal/compliance copy, payment processor | Decide whether E is in scope at all, then register domain (≈$12/yr) — do not start before that decision, since E's costs and its 6–9 month horizon conflict with an unfunded 90-day budget |

Recommended order: **A → D → B → C**, with E held until A–C produce real status data worth selling.

---

## 3. Step-by-step plan

### Task 1 — Freeze the untracked artefacts (10 min)
**Files:** none modified; `git add` only the six free-cash files.
1. `git add server/src/adapters/freecashMonitorAdapter.ts server/scripts/freecash-daily-monitor.mjs server/scripts/verify-freecash-rules.mjs scripts/finance_monitor.py scripts/approval_gate.py scripts/notification_service.py`
2. `git commit -m "chore: track free-cash automation artefacts (pre-repair)"`
Verification: `git status --porcelain | grep -i freecash` returns nothing.
Note: 378 unrelated modified files stay untouched — commit only the explicit paths.

### Task 2 — Make the daily monitor executable (60–90 min)
**Files:** `server/scripts/freecash-daily-monitor.mjs` (rewrite), new `server/src/__tests__/freecashDailyMonitor.test.ts`.
1. Write the failing test: import the module's pure helpers and assert `isDailyCheckAllowed()` returns `false` when the marker holds today's `toDateString()`.
2. Run `npx vitest run src/__tests__/freecashDailyMonitor.test.ts` — expect FAIL (module cannot be imported: TS syntax in `.mjs`, `require` in ESM).
3. Rewrite as ESM JavaScript: `import cron from 'node-cron'`, `import { readFileSync, writeFileSync, existsSync } from 'fs'`; delete all type annotations (`): boolean`, `Promise<any>`, `ChangeAlert[]`, `ActionRequest[]`); export the helpers for testability.
4. `node --check server/scripts/freecash-daily-monitor.mjs` → expect exit 0, no output.
5. Re-run the test → expect PASS.
6. Commit.

### Task 3 — Strengthen the rule verifier so it cannot pass on unparseable code (30 min)
**Files:** `server/scripts/verify-freecash-rules.mjs`.
1. Add a syntax gate: `child_process.execFileSync(process.execPath, ['--check', targetPath])` for the monitor, and fail loudly on non-zero exit.
2. Replace rule 3's trivially-true assertion with: monitor contains an outbound notify call site AND does not contain any write verb (`POST`, `/cashout`, `/transactions`, `.method = 'POST'`) in a fetch path.
3. Exit non-zero when any rule fails (`process.exitCode = 1`) — today it always exits 0.
4. Run `node server/scripts/verify-freecash-rules.mjs` → expect the four rules re-evaluated against the repaired monitor, exit code inspected with `echo $?`.

### Task 4 — Fix the approval gate (90 min)
**Files:** `scripts/approval_gate.py`, new `scripts/tests/test_approval_gate.py`.
1. Failing test first: `request_action(...)` → `verify_approval(...)` returns `valid=True` for the same user; expired token → `valid=False, reason='expired'`.
2. In `request_action`, add the standard claims the verifier demands: `iss: 'FreeCashFinance'`, `aud: user_config_id`, `exp: now + token_expiry`. Keep `created_at`/`details` as-is.
3. In `verify_approval`, use `decoded['exp']` only after confirming presence; map `jwt.ExpiredSignatureError` → `reason='expired'`.
4. Separate test: `jwt.decode` with an `iss` that differs → `invalid_token`. Never log the token; redact to `[REDACTED]` in any log line.
5. Run `python -m pytest scripts/tests/test_approval_gate.py -v` → expect all PASS. Note the interpreter is `python` (3.11.9); `python3` does not exist on this host.

### Task 5 — Repair the Python monitor or retire it (60 min)
**Files:** `scripts/finance_monitor.py`.
1. Decide (see open questions) whether it stays: it duplicates the Node monitor. If it stays, fix in TDD order: `await monitor.daily_status_check()`; remove the undefined `trx` reference in the `alerts` branch; stop passing the freshly-assigned `results` as its own `previous` (compare against the *persisted* prior state, otherwise change detection is dead); set `log_file` before the `try`; make the config path point at an existing file (`config/` exists, `configs/` does not); ensure a `new_earning` change type is actually produced, since `actions_allowed` tests for it.
2. Reproduce the crash first (`python scripts/finance_monitor.py`) so the fix has a before/after, then re-run for `status: ok|degraded` with no traceback.
3. If it is retired, delete it and say so in one commit — do not leave a second, unused implementation (user rejects parallel architecture).

### Task 6 — Notification channel (90 min)
**Files:** `scripts/notification_service.py`, monitor call sites, `.env` (names only — no secret values, and `.env` stays untracked).
1. Send one message through the existing stub to a local sink (e.g. a file under `logs/`) and assert the payload contains `event_type`, `account_id`, `timestamp_utc`, `action_required`, `approval_needed`.
2. Dedupe by event hash within a 1-minute window; log failures without retry storms.
3. Verify: run the monitor twice in one day → second run must exit with "already performed today", and exactly one notification artefact must appear.

### Task 7 — Persist the daily schedule (60 min, DB write — requires approval)
**Files:** `server/data/agentic-os.db` (row insert), `server/src/domains/jarvisNext/operator/operatorController.ts` (replace the orphan `scheduleId` literal with the id that was actually inserted).
1. First copy the DB and dry-run the insert on the copy; confirm the column set from `PRAGMA table_info(schedules)`.
2. Insert one row, `cron_expression '0 9 * * *'`, `enabled 1`, `routine_id` matching the monitor, `project_id 'proj-free-cash'`.
3. Prove it fires: read the row back, then trigger one dispatch through `scheduleDispatcher` and show the run record.
4. Only then update the operator's response text so "scheduled the daily monitor" is true rather than aspirational.

### Task 8 (optional) — Real read-only provider (2 days)
Per `server/data/freecash-monitor/INTEGRATION_STATUS.md`, candidates are HG.Cash `GET /accounts` (Bearer), Cashfree `GET /payout/v1.2/getBalance`. Implement exactly one, GET only, behind a feature flag, and make `fetchStatus()` return `externalConnected: false` plus a real `externalStatusMessage` until credentials exist. The adapter's "contains double-check → reject" heuristic must be replaced by the persisted once-per-day marker; a substring test is not rule 2.

---

## 4. Files likely to change

- `server/scripts/freecash-daily-monitor.mjs` (rewrite), `server/scripts/verify-freecash-rules.mjs`
- `server/src/adapters/freecashMonitorAdapter.ts` (honest health/status, real rule-2 marker)
- `server/src/domains/jarvisNext/operator/operatorController.ts` (real scheduleId; response text only after proof)
- `scripts/approval_gate.py`, `scripts/finance_monitor.py`, `scripts/notification_service.py`
- New: `server/src/__tests__/freecashDailyMonitor.test.ts`, `scripts/tests/test_approval_gate.py`
- New config (subject to approval): `config/finance_settings.json`, `config/approval_gate.json`
- **Off-limits:** `src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/domains/jarvis/*`, `src/components/jarvis/JarvisComposer.tsx`

## 5. Tests / validation

| Rule | Runtime proof required (not a grep) |
|---|---|
| 1 | `node --check` passes; no POST/write path exists; monitor run logs zero write calls |
| 2 | Second same-day run exits "already performed today" using the persisted marker; adapter rejects a duplicate invoke for a different reason than a prompt substring |
| 3 | One notification artefact per material change, with rule payload fields, deduped |
| 4 | Token round-trip valid=True; expired → `expired`; foreign issuer → `invalid_token`; no secret in logs |
| Schedule | `schedules` row read back; one dispatcher-triggered run record |

Full regression before any deployment: `cd server && npx vitest run src/__tests__/truthfulDelegationAndFreeCash.test.ts src/__tests__/freecashDailyMonitor.test.ts` plus the repo's own build; verify `git status` shows no untouched-file churn afterwards.

## 6. Risks, tradeoffs, open questions

- **Untracked artefacts**: six files with no history; a bad `git clean` loses them. Fixed by Task 1.
- **478-entry dirty tree**: any broad `git add -A` or reset contaminates unrelated work — always commit explicit paths.
- **Deployment cycle**: touching `resources/app/dist` requires backup of `resources/app/dist` and `dist-electron`, full replacement, and confirmation the VOICE ERROR string is present — not part of this plan; do not bundle it with monitor repairs.
- **Duplicate-monitor risk**: two monitors (Node + Python) with different failure modes; keep one.
- **Open questions**: (1) does a real FreeCash/HG.Cash/Cashfree account with credentials exist at all, or is the whole vertical an unfunded hypothesis? (2) Is the SaaS business plan (Option E) in scope, or does it conflict with the monitoring-only scope the rules describe? (3) Who receives the notifications — no `FREECASH_*` env values are set. (4) Approval decision `pa-a2ef648f-1` referenced in `FREE-CASH-WORKFLOW-PLAN.md` is still pending and gates E.

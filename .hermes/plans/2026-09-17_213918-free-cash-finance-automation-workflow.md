# Free Cash Finance Automation — Workflow Plan (Constraint-Compliant)

**Goal:** Make the Free Cash daily monitoring workflow actually execute end-to-end inside AgenticOS, with all four operational rules enforceable and verifiable at runtime, without breaking the running backend or any uncommitted work.

**Architecture:** One scheduled entry point (Hermes cron, once per day) → read-only status fetch → append-only daily log under `data/freecash/` → alert generation on change → human approval queue for any external action. Existing runtime paths (`freecashMonitorAdapter`, `instructionResolver`, `operatorController`) are reused, not duplicated.

**Constraint set (hard invariants, non-negotiable):**
- C1 — No earning action is ever executed automatically. Read-only fetches only.
- C2 — Status is checked once per day. A same-day second invocation must no-op.
- C3 — Changes in earnings or account status are notified.
- C4 — Human approval is required before any external action (withdrawal, survey submit, credential use).
- C5 — Workspace: branch `hermes-rescue-20260908` carries a large uncommitted working set. No reset/checkout/overwrite. Modify only files named in a task.
- C6 — Evidence discipline: no claim of working state from source inspection. PASS only from live command output (process, HTTP, log line, test run). A static text match is not runtime proof.
- C7 — No secrets in artifacts or logs. Use `[REDACTED]`.
- C8 — Backend `http://127.0.0.1:4600` must stay healthy after every change (re-probe after each patch).

**Tech stack:** Node 24 / TypeScript (server, vitest), Python 3.11 (`scripts/`), Hermes cron (`cronjob_manage`), SQLite/JSON stores under `server/data/`.

---

## 1. Verified current state (live evidence, 2026-09-17 21:39 local)

| # | Component | Evidence | State |
|---|-----------|----------|-------|
| E1 | Backend | `curl http://127.0.0.1:4600/api/health` → `{"status":"healthy","version":"9.0.0","environment":"development","build.gitSha":"d14253df","isDirty":true}` | HEALTHY |
| E2 | Runtime adapter wiring | `server/src/adapters/freecashMonitorAdapter.ts` imported at `operatorController.ts:4` and `turnController.ts:24`; voice path `CURRENT_STATUS` (turnController.ts:411-417) answers with the read-only status string | WIRED |
| E3 | Adapter behaviour | `fetchStatus()` is a hard-coded sandbox return: `externalConnected:false`, `earnedToday:0`, no network call | STUB |
| E4 | CLI monitor | `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` at line 41 (TS return type in `.mjs`); line 14 `require('node-cron')` in an ESM file | NOT EXECUTABLE |
| E5 | Rule verifier | `node server/scripts/verify-freecash-rules.mjs` → **4/4 PASSED**, but each check is a source string grep; Rule 2 "passes" on a string inside the non-executable file | FALSE PASS |
| E6 | Python monitor | `python -m py_compile scripts/make_freecash_check.py scripts/finance_monitor.py` → OK; but `fetch_status()` returns `{"balance":0,"available_to_withdraw":0,"pending_surveys":[]}` — no HTTP call anywhere | COMPILES / STUB |
| E7 | Run history | `data/freecash/` is empty; no `state.json`, no `YYYYMMDD.log`, no `daily.log`; no `logs/freecashioc_*.log` | ZERO RUNS EVER |
| E8 | Scheduling | `cronjob_manage list` → 0 jobs; `schtasks /query` → no freecash/agentic task; `config/freecash-crontab` still contains `/path/to/AgenticOS` placeholders; `server/data/schedules.json` has no free-cash entry; `scheduleId 'sched-daily-free-cash-0900'` (operatorController.ts:103) is defined nowhere else | NOT SCHEDULED |
| E9 | Credentials / endpoint | No `FREECASH_*` keys in `.env` or `server/.env` (7 keys total, all Ollama/LLM). Default `https://api.freecash.com/v1/status` resolves (Cloudflare) but returns **404** → fabricated endpoint, not a documented API | NOT CONFIGURED |
| E10 | Approval gate | `scripts/approval_gate.py` requires `configs/approval_gate.json` — directory does not exist; `secrets/` does not exist; `logs/` does not exist. `jwt.decode(..., issuer="FreeCashFinance", audience=user)` requires `iss`/`aud` claims that `jwt.encode` never sets → `verify_approval` can never return valid | UNRUNNABLE / DEFECT |
| E11 | Policy resolution | `instructionResolver.KNOWN_FREE_CASH_RULES` holds the 5 rules and categorises them into AUTOMATIC / APPROVAL_REQUIRED / SCHEDULED / NOTIFICATION_RULE; `APPROVAL_REQUIRED`, `PROHIBITED`, `SCHEDULED`, `NOTIFICATION_RULE` start empty and are filled by substring match | REAL, PARTIAL |
| E12 | Tests | `npx vitest run src/__tests__/truthfulDelegationAndFreeCash.test.ts src/__tests__/revenueProjectPriorities.test.ts` → 2 files, 20 tests passed, 1.76s | GREEN |

**Defect summary:** the compliance story is documentation plus a string-grep verifier. Nothing in the chain (`schedule → fetch → log → notify → approve`) has ever executed. E5 is the worst failure mode for this workspace: it reports PASS for a file that cannot parse.

---

## 2. Options (each with Expected Effort / Time-to-Revenue / Dependencies / First Concrete Action)

### Option A — Repair the CLI path and install a real once-daily schedule
**Scope:** delete or rewrite `server/scripts/freecash-daily-monitor.mjs` (it is dead code that E5 certifies as green); make `scripts/make_freecash_check.py` the single entry point; add `data/freecash/state.json` same-day guard (already implemented at lines 67-73 — needs a test); install a Hermes cron job that runs it once daily; harden `verify-freecash-rules.mjs` so it executes the module it claims to verify instead of grepping it.
- **Expected Effort:** 3-5 hours (1 rewrite, 1 cron install, 2 tests: same-day no-op + log line shape).
- **Time-to-Revenue:** none directly. This is the evidence loop, not a revenue line. Indirect: makes the revenue opportunity trackable.
- **Dependencies:** Node 24 + Python 3.11 present (verified); `cronjob_manage` tool available (verified); no external credentials needed.
- **First Concrete Action:** `node --check server/scripts/freecash-daily-monitor.mjs` is already failing — run `git ls-files --error-unmatch server/scripts/freecash-daily-monitor.mjs` to confirm tracked status, then rewrite it as valid ESM (or delete it and repoint E5's Rule 2/3/4 checks at the Python entry point).

### Option B — In-process scheduler inside the running server (no external cron)
**Scope:** register the daily check with the existing schedule store (`server/data/schedules.json`) and the server's scheduler loop so it runs while the app is up; expose `GET /api/finance/freecash/status` and `POST /api/finance/freecash/approvals/:id` over the existing Fastify/Express surface; surface it in `src/pages/RevenueOperatorPage.tsx`.
- **Expected Effort:** 6-10 hours (route + scheduler registration + UI read-out + vitest coverage).
- **Time-to-Revenue:** none directly; enables C3 notification to reach the UI the user actually watches.
- **Dependencies:** Option A's entry point must work first; server restart required → user-visible downtime of the voice app; must not disturb the 392-file dirty working set.
- **First Concrete Action:** inspect the existing scheduler registration in `server/src/index.ts` (or equivalent bootstrap) for how `server/data/schedules.json` entries are consumed, and confirm whether that loop is currently running in the live process (`curl /api/schedules`).

### Option C — Real read-only provider connectivity
**Scope:** replace the stubbed `fetch_status()` with an actual authenticated GET against a provider that has a real, documented read-only balance/status endpoint; keep the write path behind the approval gate.
- **Expected Effort:** 4-8 hours once a provider and credentials exist; unbounded until then.
- **Time-to-Revenue:** unknown; entirely dependent on the external provider.
- **Dependencies:** a provider choice (the docs name HG.Cash `/accounts` and Cashfree `/payout/v1.2/getBalance`; the FreeCash.io lead is a third-party marketplace API, not first-party). Requires credentials in the vault — **must be supplied by the user, never typed by the agent**. `https://api.freecash.com/v1/status` is a 404 and must not be trusted as a target.
- **First Concrete Action:** decide the provider, then write a single read-only probe script that performs one unauthenticated GET and prints the HTTP status — no credential handling until the provider is confirmed.

### Option D — Revenue path (the only option with money attached)
**Scope:** the SaaS plan in `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md` (subscription $29-49/mo, beta-first). Nothing in the repository implements any part of it: no domain, no landing page, no payment integration, no external accounts.
- **Expected Effort:** the docs estimate 2-4h (domain) through 8-16h/week (scale-out) — all of it outside this repo, plus $70-2,750 of external spend in the first 90 days.
- **Time-to-Revenue:** the docs claim Month 6-9 full-price launch. That projection is unvalidated by anything in the workspace — treat it as a hypothesis, not a plan.
- **Dependencies:** registrar account, Framer/Webflow or equivalent, Stripe account, legal templates, community outreach capacity. None are present or verified here.
- **First Concrete Action:** decide whether the opportunity is real before spending: the only current artifact is a research document plus a pending-action ID (`pa-a2ef648f-1`) that appears in exactly two markdown files and in no database, queue, or API response (verified by repo-wide grep).

---

## 3. Recommended sequence (constraint-compliant)

1. **Stop the false PASS.** Fix `verify-freecash-rules.mjs` (E5) so it imports/smoke-runs the monitor instead of grepping it, and have it fail loudly on a non-parsable file. A verifier that green-lights dead code is a constraint violation under C6.
2. **Option A** — one working entry point, one same-day guard, one real cron install.
3. **Option C** — only after the user names the provider; credential entry happens in the vault UI, never in chat or in a file the agent writes.
4. **Option B** — UI/API surfacing once A is stable.
5. **Option D** — separate decision; do not bundle it into the monitoring workstream.

## 4. Files likely to change

| File | Change | Constraint |
|------|--------|------------|
| `server/scripts/freecash-daily-monitor.mjs` | rewrite as valid ESM or remove | C5, C6 |
| `scripts/make_freecash_check.py` | real read-only fetch once provider chosen | C1, C4 |
| `server/scripts/verify-freecash-rules.mjs` | execute-based verification | C6 |
| `server/src/adapters/freecashMonitorAdapter.ts` | only if Option C lands | C1, C2 |
| `server/src/domains/jarvisV2/turnController.ts:413-417` | status text may need updating once real connectivity exists | C6 |
| `server/data/freecash/state.json`, `data/freecash/YYYYMMDD.log` | produced at runtime | C3 |
| `config/freecash-crontab` | replace placeholder paths or retire in favour of Hermes cron | C2 |

`src/pages/RevenueOperatorPage.tsx` is read-only for this plan (one file named in an unrelated 40-file test-churn list; not touched).

## 5. Validation / acceptance tests (each must produce live output)

| # | Test | Command | Pass condition |
|---|------|---------|----------------|
| T1 | Monitor parses and runs | `node --check <entry>` then one real invocation | exit 0, log line written |
| T2 | Rule C2 same-day no-op | run twice in one day | second run prints "Already checked", exit 0, no new log line |
| T3 | Rule C1 read-only | instrument the fetch, capture requests | only GET/HEAD observed; no POST to `/withdraw`, `/cashout`, `/transactions` |
| T4 | Rule C3 change detection | inject a balance delta into the fixture path | one alert emitted, entries logged both days |
| T5 | Rule C4 approval gate | attempt an external action with no approval record | execution refused, refusal logged with reason |
| T6 | Approval gate actually validates | sign a token, verify it | currently returns invalid for valid tokens — must be fixed or the gate must not be presented as working |
| T7 | Schedule exists | `cronjob_manage list` | exactly one free-cash job, daily cadence |
| T8 | Backend still healthy | `curl /api/health` after every change | `status: healthy` |
| T9 | No regression | `npx vitest run src/__tests__/truthfulDelegationAndFreeCash.test.ts` | 20/20 still pass |

## 6. Risks and open questions

- **Verification discipline (highest):** the existing verifier demonstrates how this project green-lights non-functional code. Any PASS in this workstream must cite command output, not a source match.
- **Dirty tree:** the branch carries a very large uncommitted change set. Every edit must be scoped and read back; no `git checkout`/`reset`/`stash`.
- **Windows scheduling reality:** `config/freecash-crontab` is a Unix crontab template and no cron daemon exists on this host. Hermes cron (0 jobs today) or Windows Task Scheduler are the only real options. The current file is documentation, not a schedule.
- **Credential handling:** no provider credentials exist anywhere; the agent must not accept them in chat.
- **Open question (user):** which provider, if any, is the real target — HG.Cash, Cashfree, or a FreeCash account API? Without that, Option C stays BLOCKED.
- **Open question (user):** does the $29-49/mo SaaS plan reflect an actual decision, or is it a generated artefact? Repo-wide grep finds `opp-4a3f4cfc` / `pa-a2ef648f-1` only in two markdown files.

---

Saved: `D:\AgenticOS\.hermes\plans\2026-09-17_213918-free-cash-finance-automation-workflow.md`
Repository: D:\AgenticOS (branch `hermes-rescue-20260908`) — planning only, no project files modified.

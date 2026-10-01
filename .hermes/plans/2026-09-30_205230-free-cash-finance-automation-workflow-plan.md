# Free Cash Finance Automation — Workflow Plan (constraint-first, re-verified)

**Repository:** `D:\AgenticOS`
**Branch:** `hermes-rescue-20260908` · working tree heavily dirty (uncommitted pre-existing work, untouched by this plan)
**Written:** 2026-09-30 20:52 local (Europe/Berlin)
**Deliverable of this turn:** this one new file only. No code change, no scheduler entry created, no provider contact, no credential use, no git mutation.
**Supersedes as "current":** `.hermes/plans/2026-09-20_213245-*` and the 2026-09-17 variants (same topic, older evidence). Underlying design docs are NOT edited or deleted by this plan.

---

## 0. Live state verified in THIS session (2026-09-30, commands actually executed)

| # | Command (executed) | Observed (quoted) | Verdict |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | **GREEN, reproducible today** |
| V1b | `find data/freecash-monitor -type f -exec sha256sum {} \; \| sort \| md5sum` before **and** after V1 | `3c7e3ea4b4fee9f9a60d774161afabf0` both times | suite is **hermetic** — production state root not touched |
| V2 | `python monitoring/freecash/verify_readonly.py monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit 0 | R2 static gate **GREEN**; exemption baseline **28** |
| V3 | `schtasks //query //fo LIST \| grep -iE "freecash\|finance"` | no match | **NOT SCHEDULED** |
| V4 | `cronjob_manage list` | `count: 0` | **no Hermes cron job either** |
| V5 | `find data/freecash-monitor -type f -printf '%T+ …'` | newest files: `alerts.jsonl` 2026-09-21 18:39, `notified-keys.json` 2026-09-21 18:39; day-locks contains **only** `2026-09-20.lock` | **9 consecutive missed days** (09-22 … 09-30); today's day key is **still free** |
| V6 | `cat data/freecash-monitor/state/last-run.json` | `last_outcome: MONITOR_DEGRADED`, `last_attempt_day: 2026-09-20`, `timezone: Europe/Berlin` | routine last produced a real run 10 days ago |
| V7 | `tail alerts/alerts.jsonl` | one `MISSED_DAY` alert for `2026-09-21`; nothing for 09-22…09-30 | the **watchdog is also unscheduled** — it fired once, then stopped |
| V8 | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at line 41 (`function isDailyCheckAllowed(): boolean`) | still **NOT EXECUTABLE** |
| V9 | `node server/scripts/verify-freecash-rules.mjs` | `✓ Rule 1..4 → PASSED`, `[OK] All 4 operational rules verified (4/4 passed)`, exit 0 | **FALSE-GREEN confirmed today** — certifies the file that fails V8 |
| V10 | `grep -n "externalConnected" server/src/adapters/freecashMonitorAdapter.ts` | line 206 `externalConnected: false`, line 207 `… External FreeCash API connection is not configured.` | adapter is still a **LIVE STUB** |
| V11 | `grep -n "registry.register" server/src/index.ts` | Hermes, Jarvis, Codex, Video, HeavyGen only | adapter **not registered** — not part of the runtime |
| V12 | `curl 127.0.0.1:4600/api/health`; `netstat` on :4600 and :3001 | `000` / UNREACHABLE; no listener | **AgenticOS server is DOWN** → every route-based read source is unavailable right now |
| V13 | `grep -oiE "^(FREECASH\|FINANCE\|SMTP\|MAIL\|WEBHOOK)[A-Z_]*" .env server/.env` | no output | **no provider, no notification channel configured** (names only checked; no value ever read) |
| V14 | `python -m py_compile finance-monitor/src/rule_engine.py` | `SyntaxError: f-string: invalid syntax` | 7th implementation still **broken at import** |
| V15 | `python -c "import sys,zoneinfo; …"` | `…hermes-agent\venv\Scripts\python.exe`, `Europe/Berlin` resolves | only the **venv interpreter** can compute the operator-local day key |
| V16 | `git ls-files \| grep -ci freecash` | `0` | every Free Cash artifact is **untracked** → destructive git ops are forbidden (W3) |
| V17 | `ls docs/freecash/` ; `ls _archive/` | both absent | no canonical spec exists; no quarantine area exists |

**Net (changed picture vs. 2026-09-20):** the code-side problem is *solved in one path*. `monitoring/freecash/` is a real, self-consistent, hermetic, read-only routine that passes 52/52 tests and its own R2 scanner **today**. The remaining failures are **operational**, not defects:

1. **Nothing runs it** (V3, V4) → 9-day silent gap (V5), watchdog dead too (V7).
2. **No data source** → every snapshot is `MONITOR_DEGRADED` with `null` metrics (V6); R3 has never had a real change to detect.
3. **No notification channel** (V13) → R3 delivery has no sink.
4. **The false-green gate is still authoritative-looking** (V9 certifying V8).
5. **Seven dead/duplicate implementations still on disk** and one of them, plus the adapter, still emits the appearance of compliance (V8, V10, V14).

---

## 1. Frozen constraint set (binding)

| ID | Constraint | Enforcing mechanism (live) |
|----|-----------|----------------------------|
| R1 | exactly one status read per operator-local calendar day | `gate.py` atomic `O_CREAT\|O_EXCL` on `state/day-locks/<day>.lock`; second run must print `SKIP_DUPLICATE_DAY` and exit 0 |
| R2 | zero earning/withdrawal actions; read-only transport | `readonly_client.py` deny-by-default `{GET,HEAD}`; `verify_readonly.py` + `verify-readonly.sh`; `exempt` may never exceed the measured baseline **28** |
| R3 | notify on earnings/status change, exactly once, no storm | `changedetect.py` integer-cents compare + `dedupe_key` persisted **before** dispatch; no-change day stays log-only |
| R4 | human approval before any external write | `approval_queue.py`; `execution_state` always `NOT_EXECUTED`; decision requires `--by "<human>"`; no execution path exists in the routine |
| W1 | no secrets in code, state, logs or reports | env/vault only; `[REDACTED]` in every written report |
| W2 | additive only; never revert unrelated uncommitted work | 500+ dirty entries on `hermes-rescue-20260908` (V16); `git status --short` before/after each stage |
| W3 | no destructive git operations | no `reset --hard`, `checkout --`, `clean -fdx`, no force push |
| W4 | PASS only from output quoted in the current session | each claim above carries its command |
| W5 | voice runtime off-limits | `src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/components/jarvis/JarvisComposer.tsx`, `src/domains/jarvis/*` — zero diff |
| W6 | one writer against the state root at a time | currently trivially true (nothing writes since 09-21); must be re-proved after F1 |

Every stage below carries **Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action · Exit criteria**.

---

## 2. Stages

### F0 — Canonicalize and freeze the drift
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none (removes the false-PASS surface).
**Dependencies:** none.
**First Concrete Action:** create `docs/freecash/SPEC.md` holding the §1 table verbatim, plus (a) the chosen entry point `monitoring/freecash/run_daily_check.py`, (b) the pinned interpreter `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (V15 — `py -3`/3.14 has no IANA database and would degrade the day key), (c) the measured `exempt=28` baseline, (d) an explicit line stating `server/scripts/verify-freecash-rules.mjs` is **non-authoritative** (V9). Then add a one-line `SUPERSEDED — see docs/freecash/SPEC.md` header to the older docs (`free-cash-automation-workflow.md`, `free-cash-finance-monitoring-specification.md`, `free-cash-finance_monitoring_plan.md`, `docs/freecash-monitoring.md`, `docs/freecash-monitor-workflow-plan.md`, `docs/free-cash-finance-automation-workflow-plan.md`, `docs/freecash-automation-workflow-plan-v2.md`). Headers only — no rewrites, no deletions.
**Exit:** one canonical spec; the 4/4-PASS gate is documented as text-grep, not behaviour.

### F1 — Put the routine on a real scheduler *(the single highest-value stage; it is the entire 9-day gap)*
**Expected Effort:** 1–2 h. **Time-to-Revenue:** none directly; converts "never runs" into "runs daily and can prove it".
**Dependencies:** F0 (needs the pinned interpreter + entry point recorded); W6.
**First Concrete Action:** register one Windows scheduled task with absolute native paths — action `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` with argument `D:\AgenticOS\monitoring\freecash\run_daily_check.py`, `StartIn D:\AgenticOS`, and a second daily task for `watchdog.py` (V7 proves the watchdog must be scheduled separately, not assumed). Trigger it manually, then immediately trigger it a second time.
**Exit (observable):** (i) run 1 prints `RUN_OK <today> …`; (ii) run 2 prints `SKIP_DUPLICATE_DAY <today>` and exits 0; (iii) `state/day-locks/<today>.lock` exists; (iv) a third invocation the next calendar day produces a new lock. Until all four are quoted, R1 is unproven.
**Note:** today's day key is still **free** (V5 — only `2026-09-20.lock` exists), so run 1 today will be a genuine first read, not a skip.

### F2 — Give the routine a data source (choose exactly one)

**F2a — Operator-entered figures (available today; recommended first).**
**Expected Effort:** 1–2 h code-side + ~2 min/day manual. **Time-to-Revenue:** none directly; it is what makes R3 honest.
**Dependencies:** F1.
**First Concrete Action:** append exactly one record to `data/freecash-monitor/state/operator-state.json` `records[]` (integer **cents**, `day_key` = operator-local date) using the file's own `how_to`, run the entry point once, and quote `RUN_OK <today> outcome=INITIAL_BASELINE source=operator_entered(data_available=True)`. The suite already proves the next day with changed figures yields `EARNINGS_CHANGED` (V1) — reproduce that on the production root, not in the test harness.
**Exit:** one baseline snapshot with non-null metrics; next day's changed record produces exactly one payload carrying its `dedupe_key`.
**Caveat:** this is a **manual, human-entered** figure — it is instrumentation, not automation, and it must never be presented as an automatic account read.

**F2b — In-repo AgenticOS read surface.** **Expected Effort:** 6–10 h. **Time-to-Revenue:** none. **Dependencies:** the server must actually be **running** (V12 shows it is down; no `freecash` status route exists — `server/src/routers/projects.ts` exposes an auth-state route only, and it is unreachable while :4600 is dead). **First Concrete Action:** start the server, `curl` the existing `GET /api/projects/proj-free-cash/freecash/auth`, and paste the real JSON as the fixture before writing any new route.

**F2c — Live provider account.** **BLOCKED.** **Dependencies:** user must name the provider and supply a read-only credential (env/vault only — never in chat or a file, W1). Evidence against today: no `FREECASH_*`/`FINANCE_*` key in either `.env` (V13), the adapter self-reports "not configured" (V10), and the previously documented default endpoint returned 404. **First Concrete Action:** a single authenticated read-only GET probe, logging status code + field names only. Until then this stays BLOCKED and off the critical path.

### F3 — Notification delivery sink (R3's other half)
**Expected Effort:** 2–4 h. **Time-to-Revenue:** none.
**Dependencies:** F1, F2a.
**First Concrete Action:** decide and record one sink in `docs/freecash/SPEC.md`. Facts today: no `SMTP_*`/`MAIL_*`/`WEBHOOK_*` key exists (V13) and `himalaya` is not installed, so the honest default is **local** — the run log plus `alerts/alerts.jsonl` asserted in a test — with an external channel only as a deliberate later step.
**Exit:** a seeded change writes exactly one row to `alerts.jsonl` **and** `notified-keys.json`; a no-change day writes neither.

### F4 — Quarantine the dead implementations
**Expected Effort:** 1 h. **Time-to-Revenue:** none; removes the surface that lets 4/4 PASS be claimed on non-parsing code.
**Dependencies:** F0 (a winner must be named first); W2/W3 (all candidates are untracked, V16 → **move, never delete**).
**First Concrete Action:** create `_archive/freecash-legacy/` (does not exist, V17) and move into it: `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `scripts/finance_monitor.py`, `server/scripts/freecash-daily-monitor.mjs` (V8), `server/scripts/verify-freecash-rules.mjs` (V9), `server/tasks/daily-finance-monitor.py`, `finance-monitor/` (V14), and `config/freecash-crontab` (contains literal `/path/to/...`, can never fire). Leave a one-line README naming the surviving path.
**Exit:** one searchable executable path for the job; a repo-wide grep for the archived names returns only the archive.

### F5 — Wire monitoring into the live runtime (adapter)
**Expected Effort:** 4–8 h. **Time-to-Revenue:** none directly; makes status reachable from the voice/operator path that already exists.
**Dependencies:** F2 (real data must exist first — wiring a stub only publishes fabricated status); `runtimeRegistry.register()` in `server/src/index.ts` (V11); server must be running (V12).
**First Concrete Action:** replace the hardcoded `fetchStatus()` (V10) with a read of the routine's `state/last-run.json` + latest snapshot, register the adapter alongside the five existing adapters, then run `server/src/__tests__/truthfulDelegationAndFreeCash.test.ts`, `freeCashGoalDurability.test.ts`, `freeCashPrerequisiteGate.test.ts` and add one assertion that `externalConnected` reflects reality rather than the literal `false`.
**Exit:** the adapter's status string no longer says "not configured" when the routine has a fresh snapshot; the three existing suites still pass.

### F6 — Prove the approval gate refuses (R4)
**Expected Effort:** 4–8 h. **Time-to-Revenue:** none.
**Dependencies:** F1, F2a.
**First Concrete Action:** attempt a decision on `approval_queue.py` without `--by`, and with a machine-signed token, and quote the refusal plus the unchanged `execution_state: NOT_EXECUTED`; confirm no network write occurs during the attempt.
**Exit:** tokenless write attempt raises and performs no write; the pending item survives a clock advance unchanged. **No stage in this plan creates a live financial write path** — R4 exists to keep it that way.

---

## 3. Revenue side (separate from the monitoring pipeline; none of it is automated by this plan)

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|--------|-----------------|-----------------|--------------|-----------------------|
| R1 Earning-account yield only (no product) | 2–4 h/month ongoing | first payout cycle after F1+F2a+F3 — weeks, not months | F1, F2a/b/c, F3, F6 | enter one operator record, run the entry point, and let F3's diff surface the first real change |
| R2 Micro-SME SaaS | 40–80 h to MVP | Month 2–4 beta, Month 4–6 full price (as previously documented) | domain, payment processor approval, F2b/c data layer | register the domain and stand up the waitlist page |
| R3 Sell the 4-rule monitor pattern as a template | 8–16 h | Month 1–2 | F1 + a verifier that demonstrably **fails** on a violation (V9 shows the current one cannot) | ship the corrected routine plus a failure-provable verifier, then list it |

R1–R3 inherit an unrun pipeline unless F1–F3 hold. **F2a + F1 alone already turn 9 silent days into daily, evidenced coverage** — that is the cheapest real win available today.

---

## 4. Recommended order and critical path

**F0 → F1 → F2a → F3 → F4 → F6 → F5 → F2b → F2c(BLOCKED) → R1/R3.**

Critical path for "a routine that actually runs daily, once, notifying, approval-gated, against an internal source": **F0, F1, F2a, F3** ≈ **5–9 h** of tool-verified work. F5 and F2b add the runtime/route surface; F2c is blocked on the user. F4 is housekeeping that must wait for F0's winner. Total for the full non-blocked set ≈ 20–35 h.

## 5. Verification gates (each must pass on live output, quoted in that session)

- G1 `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0`, exit 0. *(today: PASSES)*
- G2 `verify_readonly.py` → `forbidden=0 exempt=28`, exit 0. *(today: PASSES)*
- G3 `schtasks /Query /TN "<task>"` returns the task; a manual trigger prints `RUN_OK <today>`. *(today: FAILS — not scheduled)*
- G4 Second same-day trigger prints `SKIP_DUPLICATE_DAY` and exits 0 without a second read. *(today: possible, unproven on the production root)*
- G5 A record in `operator-state.json` yields non-null metrics; the next changed record yields exactly one notification with its `dedupe_key`. *(today: FAILS — all metrics `null`)*
- G6 The scheduled routine fires unattended for two consecutive days and writes a lock for each. *(today: FAILS — 9-day gap)*
- G7 A write attempt without a human approval fails and writes nothing. *(today: not proven)*
- G8 No secret value appears in any log, doc or report. *(enforced by W1)*
- G9 `git status --short` before/after each stage shows only new/ignored paths; no pre-existing modification reverted. *(W2/W3)*

## 6. Blocked register

| Item | Blocked on | Reason |
|------|-----------|--------|
| Live provider account status | provider identity + API docs + read-only credential (env/vault) | no `FREECASH_*`/`FINANCE_*` key in either `.env` (V13); adapter self-reports "External FreeCash API connection is not configured" (V10); no endpoint verified in this session |
| External notification channel | SMTP/webhook credential or mail tooling | no `SMTP_*`/`MAIL_*`/`WEBHOOK_*` key (V13); `himalaya` not installed → local sink is the only honest option today |
| Server-hosted read source (F2b) | AgenticOS server must be running | `curl 127.0.0.1:4600/api/health` → `000` UNREACHABLE; no listener on :4600 or :3001 (V12) |
| Any automated earning/withdrawal action | — | **permanently out of scope**: R2/R4 forbid it; no stage here implements it |

## 7. Out of scope / not claimed

- No provider account, balance, earnings figure or account status has been read from any real account — by this plan or by the routine.
- No financial write path is proposed; every write path stays behind R4.
- The 52/52 test result (V1) is the **routine's own** suite on this host; it is not an external audit and does not establish that any figure is correct — only that the gate/change-detection/approval logic behaves as specified.
- Revenue projections are carried over from earlier planning documents, not re-derived or validated here.

# Free Cash Finance Automation — Workflow Plan v2 (Constraint-First)

Repository: D:\AgenticOS
Date: 2026-09-17
Status: PLAN ONLY — no execution, no file in the pipeline has been modified by this plan.
Baseline commit: d14253d (working tree has ~unrelated uncommitted modifications; none touched)

---

## 1. Operational constraints (binding, non-negotiable)

| ID | Constraint | Enforcement point |
|----|------------|-------------------|
| C1 | No earning/write action executed automatically | code interceptor + CI grep gate, not documentation |
| C2 | Status check exactly once per calendar day | persisted day-key lock, second run must skip |
| C3 | Notify on earnings/status change | alert channel actually invoked, not `console.log` only |
| C4 | Human approval before any external action | approval queue that is actually written and read back |
| C5 | Evidence = live tool output; no PASS from prior runs or static greps | each step ends with a re-executed command |
| C6 | No secrets in any artifact or report | credentials via env only, `[REDACTED]` in reports |
| C7 | Do not disturb unrelated uncommitted work | `git status` before/after; new files only |
| C8 | One executable path per job — no new parallel implementations | audit before adding |

---

## 2. Verified current state (every line below was executed on this host, 2026-09-17)

| Artifact | Live result | Verdict |
|----------|-------------|---------|
| `server/scripts/freecash-daily-monitor.mjs` | `node scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` at line 41 (TypeScript annotations inside `.mjs`; also `require()` in ESM, and duplicate `isDailyCheckAllowed(): boolean`) | NOT EXECUTABLE — dead code |
| `server/scripts/verify-freecash-rules.mjs` | exits 0, prints 4/4 PASSED | Not a verifier: static string grep. Rule 3 test is `!includes('checkForChanges') \|\| includes('.log(')` (always true); Rule 4 test ends `\|\| includes('approval-request.json')` (always true). It certifies a file that cannot parse. |
| `server/src/adapters/freecashMonitorAdapter.ts` | imported at `turnController.ts:414` and `operatorController.ts:115` (live-wired), but `fetchStatus()` returns hardcoded `externalConnected: false`, `earnedToday: 0`, empty alerts; not registered in `runtimeRegistry` (`server/src/index.ts` registers Hermes/Jarvis/Codex/Video/HeavyGen only) | LIVE STUB — status is fabricated |
| `scripts/make_freecash_check.py` | ran it: `Error: [Errno 2] No such file or directory: 'D:\data\freecash\state.json'` then `No actions available.`, exit 0 (`BASE = parents[2]` resolves to `D:\`); uses blocking `input()` | NOT RUNNABLE in cron; silent false-green |
| `scripts/monitoring/free-cash-daily-check.py` | ran it: exit 0, zero output, created no artifacts; file defines `main()` and never calls it (no `__main__` guard). If it were called, `save_snapshot()` runs before `load_snapshot()`, so change detection would compare the snapshot to itself and can never fire; Rule 4 is a comment block; rule numbering is swapped vs. canonical | NOT RUNNABLE; Rule 3 dead by construction |
| `server/tasks/daily-finance-monitor.py` | notification delivery is `# Placeholder for notification delivery` | PARTIAL |
| `scripts/finance_monitor.py` | requires `configs/finance_settings.json`; references `APPDATA/FreeCash/tokens.json` | CONFIG-BLOCKED |
| `config/freecash-crontab` | contains literal `/path/to/AgenticOS/...` and `/usr/bin/env python3` | PLACEHOLDER — will never fire on this host |
| Scheduling | `cronjob_manage list` → count 0; `schtasks /query` → no FreeCash/Finance task | NOTHING IS SCHEDULED |
| Provider config | no `FREECASH*`/`FINANCE*` keys in `.env` or `server/.env` (names checked, values never read) | BLOCKED — no provider |
| Local API target | `curl http://localhost:3001/api/v1/status/metrics` → `000` (unreachable) | no metrics source up |
| `server/data/freecash-monitor/` | README + INTEGRATION_STATUS.md claim "COMPLIANT, ready for testing, approval queue JSON writes" | Claims contradicted by the runtime evidence above |
| `finance-monitor/` package (7th implementation, `__init__.py` + `src/*.py`) | `python -c "ast.parse(open('finance-monitor/src/rule_engine.py').read())"` → `SyntaxError: f-string: invalid syntax` (line ~122, `(snapshot_hash[:8]...)`) | BROKEN at import; `.VERIFIED.md` claims "Clean syntax - No lint errors" and "No blocking issues found" |
| `server/src/__tests__/truthfulDelegationAndFreeCash.test.ts` | `npx vitest run` → 5 passed (vitest 4.1.10) | Jarvis-side "Free Cash research workflow plan" path is real |
| Repo state | `git ls-files | grep -c freecash` → 0; `data/freecash/` empty | All prior Free Cash work is untracked, never executed |

Net: 7 parallel implementations, 0 executable, 0 scheduled, 0 provider connectivity. Rules 2, 3 and 4 have never actually run. Claims of compliance in `INTEGRATION_STATUS.md`, `finance-monitor/.VERIFIED.md` and `finance-monitor/.COMPLETION_REPORT.md` are documentation-only and, in the `rule_engine.py` case, contradicted by a hard SyntaxError.

Runtime context: branch `hermes-rescue-20260908`, backend healthy at `http://127.0.0.1:4600/api/health` (version 9.0.0, gitSha `d14253df`, `isDirty: true`); nothing on `:3001`. Two sibling plans for this same topic already exist under `.hermes/plans/` (2026-09-17_213843 and 2026-09-17_213918) — this document is an independent constraint-first variant, not an edit of them.

---

## 3. Options

### Option A — Consolidate to one executable monitor (single source of truth)
| Field | Value |
|-------|-------|
| Expected Effort | 6–10 h |
| Time-to-Revenue | None directly. Indirect only: protects the earning balance the revenue path depends on. No revenue before a provider is connected. |
| Dependencies | C1–C8; pick ONE of `server/scripts/` (Node) or `scripts/` (Python); provider credentials (blocked — see Option C) |
| First Concrete Action | Fix `server/scripts/freecash-daily-monitor.mjs`: remove TS annotations, convert `require` → `import`, delete the duplicate helper, then run `node server/scripts/freecash-daily-monitor.mjs` twice and paste both outputs (second must print the skip line and exit 0). |

### Option B — Wire monitoring into the live runtime instead of a side cron
| Field | Value |
|-------|-------|
| Expected Effort | 4–8 h |
| Time-to-Revenue | None directly; makes status reachable by voice/operator path that already exists. |
| Dependencies | Option A complete; `runtimeRegistry.register()` in `server/src/index.ts`; real `fetchStatus()` |
| First Concrete Action | Register the adapter in `runtimeRegistry` and replace the stub `fetchStatus()`; then run the existing `truthfulDelegationAndFreeCash.test.ts` plus a new assertion that `externalConnected === true` under a mocked provider. |

### Option C — Read-only provider connectivity (HG.Cash / Cashfree / FreeCash.io)
| Field | Value |
|-------|-------|
| Expected Effort | 6–12 h |
| Time-to-Revenue | None directly; prerequisite for any earnings signal (and for the SaaS opportunity's data layer). |
| Dependencies | **BLOCKED until the user supplies read-only API credentials** (env only); C6 applies — never in a doc/code/chat |
| First Concrete Action | Add `FREECASH_STATUS_API` + token env vars to `server/.env`, then run a single `GET` balance call from `scripts/monitoring/` and log only status code + field names, `[REDACTED]` values. |

### Option D — Replace the static rule verifier with a runtime verifier
| Field | Value |
|-------|-------|
| Expected Effort | 4–6 h |
| Time-to-Revenue | None directly; prevents the false-GREEN class of defect that produced the current docs. |
| Dependencies | Option A; a dry-run mode in the chosen monitor |
| First Concrete Action | Rewrite `server/scripts/verify-freecash-rules.mjs` so each rule is asserted from executed behaviour (dry-run exit code, lock file, queue file contents) and prove it fails: point it at the current dead `.mjs` and confirm it reports FAIL. |

### Option E — Activate the schedule with a real once-per-day lock
| Field | Value |
|-------|-------|
| Expected Effort | 1–2 h |
| Time-to-Revenue | None directly; converts the pipeline from "never ran" to "ran today". |
| Dependencies | Option A (must already print a correct skip on second run); C2 |
| First Concrete Action | Schedule the corrected monitor via Windows Task Scheduler (native paths, no `/path/to` placeholders) or a Hermes cron job, then run it manually once and show the timestamp file plus the second-invocation skip. |

### Option F — Quarantine the dead implementations
| Field | Value |
|-------|-------|
| Expected Effort | 1 h |
| Time-to-Revenue | None; removes the surface that lets 4/4 PASS be claimed on non-executable code. |
| Dependencies | C7 (these files are untracked — move, do not delete without approval) |
| First Concrete Action | Move the non-chosen implementations to `_archive/freecash-legacy/` and correct the false COMPLIANT table in `server/data/freecash-monitor/INTEGRATION_STATUS.md`. |

### Revenue-side options (separate from the monitoring pipeline)

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|--------|-----------------|-----------------|--------------|-----------------------|
| R1 Micro-SME SaaS (per `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md`, opp-4a3f4cfc) | 40–80 h to MVP | Month 2–4 beta, Month 4–6 full price (as already documented there) | Domain, payment processor approval, provider data layer (Option C) | Register domain + stand up the waitlist page as that plan's step 1.1 |
| R2 Earning-account yield only (no product) | 2–4 h/month ongoing | First payout cycle after Option C + E are live — weeks, not months | Options A, C, E; C4 approval gate | Once C is connected, produce one logged balance snapshot and let the daily diff (Rule 3) surface the first actual earning. |
| R3 Charge for the monitoring pattern itself (sell the 4-rule monitor as a template) | 8–16 h | Month 1–2 | Options A + D (a working, failure-provable artifact) | Ship the corrected monitor + a verifier that demonstrably fails on violations, then list it. |

---

## 4. Recommended order

1. **Option A + D** (make one path executable, then make the verifier able to fail) — nothing else is testable until a monitor parses.
2. **Option E** (schedule it) — satisfies C2 with observable evidence.
3. **Option C** (provider link) — the only step that produces a real earnings signal; blocked on credentials.
4. **Option B** (runtime wiring) — after the adapter returns real data instead of the stub.
5. **Option F** (archive) — only once a replacement is verified.
6. Revenue options only after 1–3 hold; otherwise R1/R3 inherit a pipeline that has never run.

## 5. Verification gates (each must pass on live output)

- G1 `node <monitor>` parse+run, exit 0, visible status line. (today: FAILS — SyntaxError)
- G2 Second invocation same day prints the skip and exits 0 without a second fetch.
- G3 `verify-freecash-rules.mjs` FAILS when pointed at a known violation (proves it can fail) and PASSES on the chosen implementation.
- G4 Approval queue file exists on disk with a timestamped record after a change is detected (today: not written).
- G5 Scheduled task fires unattended and writes the day-key lock (today: nothing scheduled).
- G6 No secret value appears in any log, doc or report (`[REDACTED]`).
- G7 `git status` before/after shows no pre-existing modification reverted.

## 6. Out of scope / not claimed

- No provider is connected; no balance, earnings or account status has been read from any real account.
- No external action is proposed by this plan; every write path stays behind the C4 approval gate.
- The revenue projections in `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md` are carried over as written by that earlier plan, not re-derived or validated here.

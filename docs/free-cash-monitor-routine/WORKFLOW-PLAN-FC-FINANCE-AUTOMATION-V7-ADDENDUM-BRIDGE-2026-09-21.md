# WORKFLOW PLAN ADDENDUM — Free Cash Finance Automation · the missing bridge (2026-09-21)

**Companion to:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V7.md` (same directory; written 18:38–18:45 local by a concurrent session — **not** modified by this pass)
**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11 (German-localised), git-bash, non-elevated
**Written:** 2026-09-21, 18:38–18:55 local (Europe/Berlin), interpreter `python` = `…/hermes-agent/venv/Scripts/python.exe` 3.11.9
**Evidence standard (C5):** every claim below was produced by a command executed in *this* pass. Inherited claims are labelled `inherited`.
**Footprint:** this file is **new** (additive). No existing file was modified, moved, renamed, deleted. No `git add/commit/stash/reset/restore/checkout/clean` was run. `monitoring/`, `data/freecash-monitor/` and this directory are untracked; nothing under `monitoring/freecash/` has an mtime later than **2026-09-20 21:15**.

This addendum does **not** restate V7. It records (a) an independent re-verification of V7's key claims, (b) three facts V7 does not contain, one of which removes the plan's hardest blocker, and (c) the resulting stage/option.

---

## 1. Independent re-verification of V7's load-bearing claims

| Claim in V7 | My command (this pass) | My observation | Agrees? |
|---|---|---|---|
| offline gates green | `python monitoring/freecash/tests/run_all.py`; `python monitoring/freecash/verify_readonly.py`; `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `run_all: tests=52 failures=0 errors=0 skipped=0`; `forbidden=0 exempt=28 missing_targets=0` · `PASS` (both scanners) | **yes** |
| acceptance gate red (C9/C15) | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · **exit 1** | **yes** |
| gate is scoped to one file, and no file can pass | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/gate.py` | `SUMMARY: R1=FAIL R2=FAIL R3=FAIL R4=FAIL` · exit 1 — the R1 mechanism's own file fails **four** rules, three of them because those mechanisms live in sibling files | **yes, and stronger**: the verifier is scope-broken in *both* directions |
| nothing scheduled | `schtasks /Query /FO CSV /NH \| wc -l` → 275; `… \| grep -ic freecash` → 0; targeted `/TN "FreeCash-Daily-Monitor"` + `…-Missed-Day-Watchdog` | 275 tasks, 0 Free Cash; both targeted queries → `FEHLER: Das System kann die angegebene Datei nicht finden.` | **yes** |
| app runs on 4600, not 3001 | `curl -sS -m5 http://localhost:4600/api/health`; `curl … :3001/health` | `http=200`, `{"status":"healthy",…,"version":"9.0.0","gitSha":"d14253df…","isDirty":true}`; 3001 → refused, `code=000` | **yes** |
| no credential, no sink | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH"` → no match; DB `provider_credentials` = **0** rows | as stated | **yes** |
| today's day is intact | `ls data/freecash-monitor/state/day-locks/` → `2026-09-20.lock` only (0 bytes) | **no `2026-09-21.lock`** — the first real reading is still takeable today | **yes** |
| ledger unchanged | `ls -l --time-style=full-iso data/freecash-monitor/state/last-run.json` | mtime **2026-09-20 21:08**, `last_attempt_day=2026-09-20`, `MONITOR_DEGRADED` | **yes** |
| no reading ever entered | `cat data/freecash-monitor/state/operator-state.json` | `"records": []`, mtime 2026-09-20 21:08; `approvals/` and `logs/` empty | **yes** |
| F-1: lock acquired before the read | `read_file …/run_daily_check.py` region around `day = gate.day_key(now)` / `acquired, lock = gate.acquire_day_lock(day)` / `resolve_source` | confirmed — the day is consumed before the source is resolved | **yes** |
| F-6: unattributed append | `cat data/freecash-monitor/alerts/alerts.jsonl`; `cat state/notified-keys.json` | 3rd line `MISSED_DAY 2026-09-21`, `dedupe_key=e049c636…`, `ts_utc=2026-09-21T16:39:42Z`; `notified-keys.json` created mtime **18:39:48** with `"delivery": "TOAST_OK"` | **yes — plus an attribution lead, §2.3** |

**Anomaly corroboration worth keeping.** Two *independently* produced document sets (V7's row V1/V23 and my W2) ran the offline suite inside the same 18:38–18:50 window. `tests/_support.py` pins `FREECASH_DATA_ROOT` to a `tempfile.TemporaryDirectory` per test, and V7's hash check shows the real root byte-identical across a suite run — so the live append did not come from the suite. It also did not come from the app (§2.1) and not from the routine (§2.3 lead).

### 1.1 New operational constraint to add to V7's table

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C16 (NEW — one Free Cash path per job)** | no **third** Free Cash implementation may be started; the two that exist are labelled, and the missing read is obtained by bridging them | V7's C8 (extend before create) applied to the Free Cash domain; the two paths are named in §2 | each stage names the file it extends; a `grep` shows exactly one authoritative monitoring implementation |

---

## 2. Three facts V7 does not contain

### 2.1 There is a second, app-side Free Cash path — and it already implements the authenticated read

| | Path **A** — Python routine (what every plan so far measures) | Path **B** — app-side executor (absent from V7) |
|---|---|---|
| Files | `monitoring/freecash/**`, state root `data/freecash-monitor/` | `server/src/services/freeCash/freeCashExecutor.ts`; `server/src/adapters/freecashMonitorAdapter.ts` |
| Capability | R1–R4 enforcement: atomic day lock, cent-exact change detection, dedupe, approval queue, watchdog, append-only evidence | **live authenticated session** against the real service through the managed browser profile: `checkAuthenticatedSession()`, `startInteractiveLogin()`, `inspectAccountState()`, `inspectAvailableWork()`, session-evidence contract (evidence alone satisfies the prerequisite — project state does not) |
| Wiring (measured) | **nothing in the app imports it** — `grep -rn -iE "watchdog\.py\|run_daily_check\|freecash-monitor\|FREECASH_DATA_ROOT" server/src electron src scripts server/scripts` → **0 hits** | wired: `server/src/index.ts:398` `import { reconcileGoalsOnStartup } from './services/freeCash/freeCashExecutor.js'`; `server/src/services/backgroundTasks/adapters.ts:1681` dynamic-imports `checkAuthenticatedSession, inspectAvailableWork`; `freecashMonitorAdapter.ts:53` class / `:222` singleton export — **no importer found** |
| Rule enforcement | yes (its own tests + two R2 scanners) | none — no day lock, no dedupe, no approval queue |
| Live state | 1 spent day, no reading, 1 unattributed alarm | `provider_credentials` = 0 rows; no session-evidence artefact proven in this pass |

**Why this matters.** V7's blocked register (and V6's) says the live-account reading is BLOCKED on "provider identity + authenticated read contract + credential + proven session" (V7 §3 O5), and every plan so far has treated the reading as an external prerequisite. But Path B **is** that mechanism: a session established by the operator through `startInteractiveLogin()` in the managed browser profile, with `checkAuthenticatedSession()` as the live probe and a written evidence contract. The honest re-framing:

- the blocker is **not** "no way to authenticate" — it is "the authenticated path exists app-side and nothing hands its reading to the rule engine";
- therefore the correct next step is a **bridge (one mapping, no new transport, no new monitor)**, not a new integration project, and not an R2 allowlist widening;
- `freecashMonitorAdapter.ts` is a *second* monitor for the same job that enforces **no** rule (its `approval_gate` capability is declarative only) — under the user's standing objection to parallel architectures it must be labelled superseded or removed once unused (**D-5**); it must not be extended.

### 2.2 The legacy in-app runner points at a route that does not exist

`logs/daily_monitor_runtime.log` (mtime 2026-09-20 21:10) ends with:

```text
[2026-09-20 19:10:50 UTC] action=fetch_error … HTTPConnectionPool(host='localhost', port=3001): … url: /api/v1/status/metrics
[2026-09-20 19:10:50 UTC] action=daily_check_failed day=2026-09-20 details=metrics_not_available
```

and `grep -rn "status/metrics" server/src` → **0 hits**. So the legacy monitor used the wrong port **and** a route the server never exposes; its failure was structural, not a transient outage. Consequence: V7's O-4 / O1 ("make `--source metrics_http` viable by exposing the four figures at `localhost:4600/api/v1/status/metrics`") is not a repair of something dormant — it is **new route work** and a second read transport, i.e. a new implementation (C16). Rank it below the §2.1 bridge.

### 2.3 Attribution lead for the unattributed append (V7's F-6)

`.hermes/scratch/freecash/pkg/**` — a full copy of the routine package — carries mtimes **18:39–18:40**, i.e. exactly the window of the live append, and `paths.py`'s `DEFAULT_DATA_ROOT` is `"D:/AgenticOS/data/freecash-monitor"`. A process executing a package copy with `FREECASH_DATA_ROOT` unset therefore writes **live** state by construction. Combined with the sibling V7 pass that touched the same file at the same minute, the most consistent explanation is a **concurrent session running a copy of the routine against the default root** — the same class of interference documented as blocked item **B7** in `DELEGATION-2026-09-21/SCHEDULER-AND-DELIVERY.md`. Not proven; carried forward unchanged as V7's **C14 / S-9**, with these consequences:

1. the toast transport is **live-proven on this host** (`TOAST_OK` recorded in the live root, first real delivery evidence) — unproven is only that a human saw it;
2. the `2026-09-21` `MISSED_DAY` dedupe key is **spent**, so any later watchdog run today reports `DEDUPED` and stays silent (V7's S-5 collision);
3. the S-1/S-8 baseline must be taken **including** the third line, so the anomaly is not laundered into the baseline;
4. the routine has no tamper alarm (`inherited`, `E2E-RULE-FLIGHT.md` §7.2): deleting a day lock defeats R1 silently, and `--force-recheck` refuses a legitimate re-read (exit 3) — the only manual re-read route is unlogged lock deletion.

### 2.4 Locale/false-negative hazard when auditing the scheduler (German Windows)

`schtasks /Query` output on this host is localised: the column is `Aufgabenname:`, the listening state is `ABHÖREN`. A `grep "^TaskName"` returns **0 rows** and would falsely suggest an empty scheduler. Use `schtasks /Query /FO CSV /NH | wc -l` (275 here) and locale-free name matching, as done above.

---

## 3. Stage and option this addendum adds (Effort · Time-to-Revenue · Dependencies · First Concrete Action)

**S-11 — Bridge Path B into Path A (the real unblock; insert immediately after V7's S-3).**
Expected Effort: 4–8 h (one mapping + one read-back test; no new module).
Time-to-Revenue: **3–7 days of visibility; no revenue** — this routine never earns, and no option in either plan has a revenue time-to-value (the money path is `bgtask-07a8154b0`, V7's S-10).
Dependencies: the operator authenticates in the managed browser profile via the existing `startInteractiveLogin()` (no credential is given to the routine — the secrets rule holds); `checkAuthenticatedSession()` returns a live session; the field names are fixed in writing; V7's S-2 (the day-budget guard) is resolved first, because a reading obtained after the lock is burned is worthless.
First Concrete Action: call the existing probe **once** through the app's own path (`checkAuthenticatedSession()`), quote its evidence artefact, then write the four-field mapping from `inspectAccountState()` to `operator-state.json` (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`). Do **not** create a new monitor file and do **not** add a provider host to `readonly_client.ALLOWED_PATHS` (that is an R2 change and a second transport).
Exit: one day's reading produced through Path B and consumed by Path A's existing `operator_state` source; `verify_readonly.py` still `forbidden=0 exempt=28`; `git status` shows no new monitor module.
Rejected first-order alternatives: (i) *direct provider endpoint in the routine* — second transport, R2 widening, fails C16; (ii) *expose `/api/v1/status/metrics`* — §2.2 shows the route never existed, so this is new route work for workstation metrics, not account status; (iii) *a third implementation* — forbidden by C16.

**O6 — Path-B bridged reading (rank 1 target); O4 — operator-entered figures (rank 1 today, unchanged).**
O4: Effort 0 h builder + 0.5 h operator · TTR **same day (visibility)** · Deps: pinned root + V7's S-2 guard · FCA: append today's four integer-cent figures (`records: []` today) and run with `--source operator_state`; honest limit `degraded: true` on every snapshot.
O6: as S-11 above.

---

## 4. What must not be claimed

Nothing in this addendum certifies R3/R4 on live account data, changes the routine's code, or makes the acceptance gate green. The gate remains `R1=FAIL`, exit 1, on both the entry file and `gate.py` (§1). No scheduled task was created. No day lock was created or deleted in the live root. The live root's day **2026-09-21** remains unconsumed, and its `alerts.jsonl` contains one line whose writer is not attributable from the file itself.

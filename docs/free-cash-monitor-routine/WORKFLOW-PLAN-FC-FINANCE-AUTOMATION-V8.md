# WORKFLOW PLAN — Free Cash Finance Automation (V8)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11 (German-localised), user `cd-pr`, git-bash, non-elevated
**Written:** 2026-09-30, 20:50–21:05 local (`Europe/Berlin`, UTC+02:00)
**Supersedes:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V7.md` + `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V7-ADDENDUM-BRIDGE-2026-09-21.md` (both 2026-09-21). V7's R1–R4 / C5–C15 and the addendum's C16 are carried forward; **two of their load-bearing claims are corrected in §3 (F-2, F-3)**.
**Route under plan:** `monitoring/freecash/` (stdlib-only Python; entry point `run_daily_check.py`), bridged — not duplicated — to the app-side path in `server/src/services/freeCash/`.
**Evidence standard (C5):** every claim below is a command executed in *this* pass (2026-09-30, 20:50–21:05 local). Inherited claims are labelled `inherited`. Nothing is quoted from an earlier session.
**Footprint:** this file is **new and additive**. No existing file was modified, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean` was run. Pre-existing uncommitted work: **838** `git status --porcelain` lines (was 547 on 2026-09-21) — untouched by this pass.

---

## 0. Live state, verified in this pass

| # | Command (executed this pass) | Observed result | Verdict |
|---|---|---|---|
| V1 | `date` | `Mi, 30. Sep 2026 20:50:41` (Europe/Berlin, UTC+02:00) | the plan is **9 days** younger than the state it inherits |
| V2 | `find docs/free-cash-monitor-routine monitoring data/freecash-monitor -newermt "2026-09-21 19:00" -type f` | **no output** | **nothing in the routine, its plans or its live root has changed in 9 days.** Last touch: `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V7-ADDENDUM…` 2026-09-21 18:49 |
| V3 | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` (0 bytes) only | **10 day keys (09-21 → 09-30) have never been consumed.** Today's read is still takeable |
| V4 | same, re-run **after** the test suite | `2026-09-20.lock` only | the suite is hermetic w.r.t. the real root (V7's V23 re-confirmed); no `2026-09-30.lock` |
| V5 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_success_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0` | the ledger has **not advanced since 2026-09-20T19:08Z** |
| V6 | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` | **no reading has ever been entered** — R3/R4 have never run on real input, 10 days on |
| V7 | `wc -l data/freecash-monitor/alerts/alerts.jsonl`; `ls data/freecash-monitor/approvals/` | 3 lines; empty | unchanged since V7's F-6. **No `MISSED_DAY` alarm was appended for any of 09-22 → 09-30** |
| V8 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0` | **GREEN** |
| V9 | `python monitoring/freecash/verify_readonly.py`; `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` (both) | **GREEN — baseline still 28** |
| V10 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` | **RED — acceptance gate (C9) still open, unchanged** (exit code not separately captured this pass; the verdict line is quoted verbatim) |
| V11 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash` | 278 tasks; **0** Free Cash | **NOT SCHEDULED** — 10 consecutive unattended days never happened |
| V12 | `curl -sS -m5 -o /dev/null -w '%{http_code}' http://localhost:4600/api/health` | `curl: (7) Failed to connect … port4600=000` | the app is **not running now**. C12 (port 4600, not 3001) stands for when it *is* up; no health claim may be made **today** |
| V13 | `grep -n "day_key" …/run_daily_check.py`; `sed -n '300,315p'` | `307: source_kind = resolve_source(args.source)` → `308: day = gate.day_key(now)` → `309: acquired, lock = gate.acquire_day_lock(day)`; the data read is later (`401: raw.get("payload")`) | **F-1 live and unfixed** — the day is consumed before anything is read (C11) |
| V14 | `sha256sum` set of all real-root files | 6 files, ledger `5e25ae59115daa36…`, operator-state `be8becc30e04fa24…`, alerts `81e811f1a086255a…` | **baseline hash set pinned in this pass** for S-8 drift checks |
| V15 | `grep -rn "freeCashExecutor\|freecashMonitorAdapter\|checkAuthenticatedSession\|inspectAccountState" server/src --include=*.ts` | `freecashMonitorAdapter` imported by `jarvisNext/operator/operatorController.ts:4` **and** `jarvisV2/turnController.ts:24`; `index.ts:436` freeCashExecutor import is now **commented out**; `routers/projects.ts:391–445` wires login / verify / clear routes | **app-side wiring changed since 2026-09-21** — see F-2 |
| V16 | `grep -nE "earnings\|pending_cents\|parseFloat\|parseInt" server/src/services/freeCash/freeCashExecutor.ts` | **0 matches**; `inspectAccountState()` (:252) records only `balance_text_present=<boolean>` (:267) | **the app-side probe yields no numeric figure** — see F-3 |
| V17 | `find . -maxdepth 5 -ipath "*freecash*evidence*"` | only `docs/freecash-monitor-audit-evidence.md`; no artifact dir under `data/` | **no authenticated session has ever been established through the app path** |
| V18 | `grep -rn "operator-state\|operator_state" server/src electron src` | **no hits** | no app-side writer exists into the routine's source file — the bridge is genuinely absent |

**Reading.** Nine days produced **zero** progress on the critical path and **zero** alarms. Offline gates are green; the acceptance gate is red; nothing is scheduled; no reading exists; nine uncovered days passed **silently** because the only thing that would have reported them is the unregistered watchdog. Three of V7's and the addendum's load-bearing claims are now corrected rather than inherited (§3).

---

## 1. Operational constraints (binding — every stage is checked against these)

V7's R1–R4 and C5–C15 and the addendum's C16 remain in force verbatim. This pass adds three.

| ID | Constraint | Enforcement mechanism | Proof demanded at each stage |
|---|---|---|---|
| **R1** | exactly one status read per operator-local calendar day | `gate.py::acquire_day_lock` (`O_CREAT\|O_EXCL`), 23:50 watchdog as second detector | 2 runs same day → one `RUN_OK`, one `SKIP_DUPLICATE_DAY` |
| **R2** | zero earning/withdrawal actions; read-only transport | `readonly_client.py::request` deny-by-default + 2 static scanners | both scanners exit 0 at `exempt=28`; a POST probe still fails |
| **R3** | notify on status/earnings change, exactly once | `changedetect.py::compare` on integer cents; `dedupe_key` recorded **before** dispatch | seeded change → exactly one payload |
| **R4** | human approval before ANY external action; no execution path exists | `approval_queue.py`; `execution_state` always `NOT_EXECUTED` | 90-day clock advance changes nothing |
| **C5** | evidence = live tool output, never carried over | each stage ends with a re-executed command quoted verbatim | command + output in the stage's evidence block |
| **C6** | no secrets in code, state, logs, reports | env / Hermes vault only; `[REDACTED]` elsewhere | log/state grep shows no secret-shaped token |
| **C7** | never disturb unrelated uncommitted work; no destructive git | additive edits; `git status` before/after; no `reset`/`clean`/`checkout --`/`stash` | tracked-path status identical except the intended file. **Weight raised this pass: 838 uncommitted paths vs 547 nine days ago** |
| **C8** | one executable path per job — no new parallel implementation | extend before create; legacy runners disabled, never deleted | the stage names the file it extends |
| **C9** | acceptance gate green **before** any Task Scheduler registration | `scripts/monitoring/rule_gate_verify.py` | `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` |
| **C10** | interpreter of record is the venv Python 3.11.9 | `py -3` (3.14.x) lacks `tzdata` → `ZoneInfoNotFoundError` → R1 day-key failure | the task action names the venv `python.exe` |
| **C11** | budget ordering: a run may not spend the day before a reading exists to compare | `run_daily_check.py:307–309` (V13); `--force-recheck` refused by design | no day lock may be created on a day with an empty `records` list — proven by running the guarded path and observing `day-locks/` empty afterwards |
| **C12** | the AgenticOS backend serves **:4600**, not :3001 | `curl :4600/api/health` (200 when up — V12 shows it **down today**); `:3001` refused | any health claim names the port **and** the local time it was measured |
| **C13** | a scheduled run must not inherit ambient `FREECASH_*` | the task action is a `.cmd` wrapper that pins `FREECASH_DATA_ROOT`/`FREECASH_TZ`/`FREECASH_READ_SOURCE`; `schtasks /TR` cannot set env | the wrapper's values are read back before registration |
| **C14** | `alerts/alerts.jsonl` has exactly one writer per day | see V7's F-6 | a writer tag (pid + entry point) in each new line, or a documented operating window, and no line outside it |
| **C15** | the acceptance gate cannot emit `COMPLIANT` for this package in its present form | `GATE-FALSIFICATION.md` §2 (17-file sweep → `R1=FAIL` for every file; inline-atomic control → `COMPLIANT`) | the chosen remedy is recorded in writing **before** C9 is claimed |
| **C16** | no **third** Free Cash implementation may be started | the two existing paths are labelled; the missing read is obtained by bridging them | a `grep` shows exactly one authoritative monitoring implementation |
| **C17 (NEW — staleness)** | a plan older than 48 h may not be inherited; every load-bearing claim is re-measured before it is restated | this document's §0 executes each inherited claim as a fresh command | an inherited claim that fails re-measurement is **corrected in writing**, not silently dropped |
| **C18 (NEW — source-before-schedule)** | no schedule may be registered while the configured read source cannot produce a full record | 10 idle days (V2, V3) prove that scheduling without a source buys nothing but spent day locks | the read source is shown producing one complete record **before** Task A is created |
| **C19 (NEW — target-field existence)** | a bridge may only map fields the source **actually produces**; a field that must be newly extracted is new work, costed as such | V16: the app-side probe emits **no** numeric figure, so three of the four mapped fields do not exist | the mapping is written beside a quoted probe output showing each source field |

---

## 2. The one decision that matters today

The routine is not blocked by a missing monitor. It is blocked by a **missing reading**: `records: []` (V6) after ten days. Everything downstream — R3 change detection, R4 approval queue, S-5 watchdog value, S-8 bundles — is inert until one real record exists. So the plan's ordering is: **get one honest record, then guard the day budget, then schedule.** No stage may be reordered to put scheduling first.

---

## 3. Findings (each measured in this pass)

**F-1 — ten days, zero runs, zero alarms, and silence is the default.** `last_attempt_day=2026-09-20` (V5), 3 alert lines, none for 09-22 → 09-30 (V7), `consecutive_missed_days=0`. The missed-day watchdog is invoked only by the unregistered Task B (V11), so **missed-day detection is not a safety net today** — it has never run against the real root. Unattended operation is not merely unproven; its absence produced no signal at all.

**F-2 — the app-side path changed under the old plan (corrects V7-addendum §2.1).** The addendum recorded `freecashMonitorAdapter.ts` as orphaned ("no importer found"). Live: it has **two** importers (`operatorController.ts:4`, `jarvisV2/turnController.ts:24`), and `freeCashExecutor`'s startup import in `index.ts:436` is now **commented out**. So the app-side path is *partially* wired — its session/probe functions are reachable via `routers/projects.ts` (`auth`, `auth/login`, `auth/verify`, `auth/clear`), while its startup reconciliation is off. The addendum's "nothing hands its reading to the rule engine" conclusion survives; its wiring details do not. Any V8 stage must cite V15, not the addendum.

**F-3 — the bridge cannot produce the figures it was specified to map (corrects V7-addendum §2.1 / S-11).** The addendum's first concrete action was to "write the four-field mapping from `inspectAccountState()` to `operator-state.json`". Measured: `freeCashExecutor.ts` contains **zero** matches for `earnings|pending_cents|parseFloat|parseInt` (V16); `inspectAccountState()` returns `{state, observed[], evidencePath, inspectedAt, error}` and captures only `balance_text_present=<boolean>` — a boolean, not an amount. **Three of the four target fields do not exist at the source.** The bridge as specified is not a mapping; it is a new read-only DOM-extraction feature plus a mapping. Its effort estimate rises accordingly (S-4 below), and C19 exists so this class of error is caught by rule rather than by review.

**F-4 — no authenticated session has ever been established app-side.** No evidence artifact exists anywhere under `data/` (V17); evidence is written to `dataDir()/freecash/evidence/` only on a probe that actually opened the page (V17/V16). So the app-side reading is not "available but unwired" — it is **never yet exercised** on this host. S-4's dependency is therefore a human login, not a code change.

**F-5 — the day budget is still intact, against the odds.** Ten unattended days did *not* burn ten day locks, because nothing is scheduled and the entry point is not on any startup path (V11). The first real reading is still takeable today (V3). Every execution performed in this pass printed to stdout only or ran against a temp root (V4, V8).

---

## 4. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**S-0 — Re-confirm the offline gates.** (No change; re-run after every later change.)
Expected Effort: 0.3 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: re-run V8, V9 and the V14 hash set in one block and quote all three.
Exit: `tests=52 failures=0`; `forbidden=0 exempt=28` from both scanners; real-root hashes unchanged.
Status: **already green in this pass (V8, V9, V14).**

**S-1 — Settle the acceptance gate (C9/C15).** Unchanged from V7; still the precondition for scheduling.
Expected Effort: 1–2 h (O-A). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: record the chosen option in writing, then execute it.
Exit: `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` **and** the mutation probe still failing (a gate that cannot fail certifies nothing).

**S-2 — Make the scheduled path safe to run unattended (C11 / F-1).** Still the gating decision for scheduling.
Expected Effort: 1 h (O-1) or 3–5 h (O-2). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: run the guarded path on a day whose `records` list is empty and show **no lock file is created**.
Exit: `day-locks/` empty after a data-less run, while a day *with* a reading still yields exactly one lock, one snapshot and `SKIP_DUPLICATE_DAY` on a second run.

**S-3 — First real operator reading.** *(Rank 1 today — the only stage that ends in a usable artifact.)*
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day, visibility only** — this routine never earns. Dependencies: none (S-2 guards it, but does not block the first manual reading).
First Concrete Action: the operator logs into their own dashboard, appends one record to `state/operator-state.json` (`day_key=2026-09-30`, four integer-cent figures, `entered_at_utc`), and runs the entry point with `--source operator_state`; expect `INITIAL_BASELINE`.
Exit: a day-1 snapshot exists; a day-2 record with a changed figure produces exactly one payload and one approval item.
Honest limit: every snapshot from this source is `degraded: true` by construction — "no change" only proves the same numbers were typed twice.

**S-4 — Bridge the app-side read into the routine (F-3; the durable source).**
Expected Effort: **6–10 h** (revised up from the addendum's 4–8 h): read-only numeric extraction of three figures in `freeCashExecutor.ts` **plus** the mapping **plus** a read-back test. Time-to-Revenue: 3–7 days of visibility; no revenue. Dependencies: the operator completes `POST /api/projects/:projectId/freecash/auth/login` and `…/auth/verify` in the managed profile (F-4 — no session has ever existed); the three field names fixed in writing; S-2 resolved first, because a reading taken after the lock is burned is worthless.
First Concrete Action: call the existing probe once through the app's own route (`POST /api/projects/:projectId/freecash/auth/verify`) with the operator at the desk, quote `probe.state`, `probe.evidencePath` and the artifact's contents — **then** write the mapping beside that quoted output. Do **not** create a new monitor file, do **not** add a provider host to `readonly_client.ALLOWED_PATHS`, and do **not** re-enable the commented `index.ts:436` import without a written decision (it changes startup behaviour under C7's 838 uncommitted paths).
Exit: one day's reading produced app-side and consumed by the routine's existing `operator_state` source; `verify_readonly.py` still `forbidden=0 exempt=28`; `git status` shows no new monitor module.

**S-5 — Register Task A + Task B (only after S-1, S-2, S-3).**
Expected Effort: 1–2 h including the elevation probe. Time-to-Revenue: none. Dependencies: C9 green (S-1), S-2, S-3, **and C18** (a source that produces a full record).
First Concrete Action: from a non-elevated shell run the throwaway probe `schtasks /Create /TN "\ZZ-FreeCash-Elevation-Probe" /SC DAILY /MO 1 /ST 23:59 /TR "cmd.exe /c exit 0" /IT /RL LIMITED /F && schtasks /Delete /TN "\ZZ-FreeCash-Elevation-Probe" /F`, then the two XML definitions (already drafted `inherited`, V8 of the 09-21 pass).
Exit: `schtasks /Query /TN "\FreeCash-Daily-Monitor" /V /FO LIST` quoted, showing the daily trigger, `LeastPrivilege`, `IgnoreNew`, `StartWhenAvailable`; a same-day second trigger yields `SKIP_DUPLICATE_DAY`.
Rejected on this host: `config/freecash-crontab` (no `crontab` in git-bash; targets the legacy runner) and any `/RL HIGHEST` form.

**S-6 — Watchdog / missed-day detection — now with a proven need (F-1).**
Expected Effort: 1 h. Time-to-Revenue: none. Dependencies: S-5.
First Concrete Action: register the 21:30 companion; on a healthy day require `WATCHDOG_OK` with zero alarms, then delete only the day lock inside a **scratch** root and require exactly one `MISSED_DAY` with the ledger unchanged.
Exit: healthy day → 0 alarms; uncovered day → exactly 1 alarm (`coverage=NOTIFIED`, retry `DEDUPED`).
Note: nine real uncovered days passed with **zero** alarms (V7). The behaviour exists offline; it has never run on the real root.

**S-7 — Delivery: prove the one sink, or accept the log as the sink.**
Expected Effort: 0.5 h (test) / 2–4 h (new sink, external). Time-to-Revenue: none. Dependencies: S-5.
First Concrete Action: with the operator at the desk and the session unlocked, dispatch one real toast and record the label (`TOAST_OK` vs `DELIVERY_FAILED`); then lock the session and repeat.
Exit: the observed label under both conditions is written into the runbook; the failure path leaves the full message in `alerts/alerts.jsonl`.
Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` key, no mail tooling (V7's V7/V24, `inherited`).

**S-8 — Approval gate (R4) surfaced to the human.**
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S-3 (the queue is unreachable until a change is detected).
First Concrete Action: seed a change that enqueues one item; exercise the documented CLI decision path (`--by` required); confirm the decision lands in `approvals/decided.jsonl` while `execution_state` stays `NOT_EXECUTED`.
Exit: a pending item survives a 90-day clock advance unchanged; every decision is attributable to a named human; **no execution path exists to be found**.

**S-9 — Canonical-log attribution (C14) and daily drift bundles (C16/V14).**
Expected Effort: 1–2 h, then ~2 min/day. Time-to-Revenue: none. Dependencies: S-3 for the bundle content.
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line, or document the operating window in which only the scheduled task may invoke the entry point; pin the V14 hash set as the drift baseline and the 3rd (unattributed) line as part of it.
Exit: a new line's origin is identifiable from the line itself; ten consecutive bundles whose gate counts match a fresh gate run.

**S-10 — Revenue path (out of scope of the monitor, tracked so it is not silently dropped).**
The Free Cash *mission* is blocked independently of this routine (`bgtask-07a8154b0`, `inherited`: `blocked`, `resumable=0`, last update 2026-09-19T18:05:18Z). The supervisor's own verdict was "Shopify publication is not implemented". Re-dispatching it is a separate decision with a separate owner; **this monitor never unblocks it.** Note F-2: the app-side adapter now has live importers, so the mission's surface changed this month too.
Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: a human decision + the publication step existing. First Concrete Action: none until that decision is taken.

**Ordering discipline:** S-3 (one record) ∧ S-1 ∧ S-2 → S-5 → S-6 → S-7 → S-8 → S-9, with S-4 parallel to S-3. S-0 re-run after every change. **One change between gate runs.** No stage is complete on a claim — only on output produced in the current session. Never widen an allowlist and exempt a scanner hit in the same change.

---

## 5. Options, each with the four required fields

### 5.1 For S-1 — the acceptance gate

**O-A — Repair the verifier's scope (recommended).** Effort: 1–2 h. Time-to-Revenue: none. Dependencies: none. First Concrete Action: extend `scripts/monitoring/rule_gate_verify.py` so R1's two failing checks accept the mechanism when present in the routine **package** (`gate.py::acquire_day_lock`), not only in the entry file. Edits a tracked file — verify `git diff --stat` shows only that file (C7, raised to 838 uncommitted paths).
**O-B — Restructure so one file carries R1.** Effort: 3–5 h. Time-to-Revenue: none. Dependencies: none. First Concrete Action: none recommended — would duplicate the R1 mechanism (C8 risk) and require a fresh E2E flight.
**O-C — Declare C9 unsatisfiable and gate on the flight instead.** Effort: 0.2 h (documentation). Time-to-Revenue: none. Dependencies: operator override. First Concrete Action: record that `E2E-RULE-FLIGHT.md` + `GATE-FALSIFICATION.md` + both scanners supersede the gate. Weakness: removes an automatable gate; every future regression becomes a manual read.

### 5.2 For S-2 — the day-budget trap

**O-1 — Pre-flight guard in the wrapper (cheapest, R1 untouched).** Effort: ~1 h. Time-to-Revenue: none. Dependencies: S-5's wrapper. First Concrete Action: in `freecash-task-a.cmd`, before invoking the entry point, test that `operator-state.json` holds a record whose `day_key` equals today; exit 0 with a log line when absent. Honest label: **defence in depth, not an R1 change.**
**O-2 — Two-phase lock inside the routine (durable).** Effort: 3–5 h (+ a re-run of the E2E flight). Time-to-Revenue: none. Dependencies: none. First Concrete Action: write the failing test first — "a run on a day with no reading writes `MONITOR_DEGRADED` and leaves `day-locks/` empty" — then implement an *attempt* record that only becomes a consumed day on a successful read. Trade-off to record: this deliberately weakens "one read per day" to "one *successful* read per day".
**O-3 — Keep strict R1 and stay manual until a real source exists.** Effort: 0 h. Time-to-Revenue: none. Dependencies: none. First Concrete Action: none. This is the safe default already in force, and F-1 shows it costs nothing but visibility.

### 5.3 For the read source (the remaining real decision)

**O4 — operator-entered figures. Rank 1 today.** Effort: 0 h builder (implemented) + 0.5 h operator. Time-to-Revenue: **same day, visibility only**. Dependencies: none. First Concrete Action: append today's four figures and run with `--source operator_state`; expect `INITIAL_BASELINE`. Limit: `degraded: true` on every snapshot.
**O6 — app-side bridged reading (S-4). Rank 2 (was rank 1 in the addendum).** Effort: **6–10 h** (F-3). Time-to-Revenue: 3–7 days, visibility only. Dependencies: a real interactive login (F-4) + new extraction code + S-2. First Concrete Action: `POST /api/projects/:projectId/freecash/auth/verify` with the operator present, then quote the evidence artifact.
**O1 — loopback metrics endpoint.** Effort: 3–5 h builder; 0.5 h operator. Time-to-Revenue: 1–2 days, and it reads workstation metrics, not the account. Dependencies: a route that has never existed (`grep "status/metrics" server/src` → 0 hits, `inherited`); the app is **down today** (V12). First Concrete Action: `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:4600/api/v1/status/metrics`. Rank last: it is new route work and a second read transport (C16).
**O2 — documented provider read-only contract.** Effort: 2–4 h **if** a KYC-complete account exists, else an onboarding project. Time-to-Revenue: 3 days–2 weeks. Dependencies: confirmed account ownership; a user-scoped token outside the repo; outbound HTTPS; an `ALLOWED_HOSTS` extension (itself an R2 change). First Concrete Action: with the operator's own token exported in that shell only, probe the documented endpoint and record the status code and field names, values `[REDACTED]`.
**O3 — payout-provider balance endpoint.** Effort: 4–8 h + a written rules decision. Time-to-Revenue: 1–4 weeks, unbounded if refused. Dependencies: the payouts API enabled; a token minted by a **POST**, which `readonly_client` refuses by construction, so either it is minted out-of-band or **R2 is amended in writing**. First Concrete Action: probe the documented balance route unauthenticated and record the refusal.
**O5 — direct live-account session automation.** Effort: unknown. Time-to-Revenue: unknown. Dependencies: provider identity + authenticated read contract + vault credential + proven session. First Concrete Action: none. **BLOCKED** — `provider_credentials` = 0 rows (`inherited`), no session artefact exists (V17).

---

## 6. Blocked register

| Item | Blocked on | Reason (verified) |
|---|---|---|
| Acceptance gate green (C9) | gate-scope decision (S-1) or operator override | `R1=FAIL` (V10); no file in the package can pass (C15) |
| Unattended scheduling | S-2 remedy **and** a source that produces a record (C18) | the lock is taken before the read (V13); `records: []` after 10 days (V6) |
| App-side bridged reading | operator login (F-4) + extraction code (F-3) | no session artefact has ever existed (V17); the probe emits no numeric figure (V16) |
| Live provider/account status | provider identity + authenticated read contract + credential | no credential configured (`inherited`), none in the live root (V14) |
| Email / SMS / webhook notification | credentials or mail tooling | none configured; `notify.py` implements the toast only (`inherited`) |
| Any withdrawal/earning action | R4 human approval surface | must never execute unattended; no execution path exists by design |
| In-app scheduler as the 24/7 mechanism | the desktop app process staying alive | V12: the app is **not running today**; 7.9 % non-completed history (`inherited`) |
| Missed-day safety net | S-5 / S-6 | 9 uncovered days (09-22→09-30) produced no alarm (V7) |
| Revenue mission `bgtask-07a8154b0` | re-dispatch after a lost worker | `blocked`, `resumable=0` (`inherited`) |
| Publication step (Shopify et al.) | implementation | supervisor's result text: "Shopify publication is not implemented" |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | non-elevated host by policy; the S-5 probe settles whether it is needed |
| Writer attribution on the canonical log | code change or an operating window | an unattributed append at 2026-09-21T16:39:42Z (V7's F-6) |

---

## 7. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S-1 remedy: O-A / O-B / O-C | operator | C9 stays red; nothing may be scheduled |
| D-2 | S-2 remedy: O-1 / O-2 / O-3 | operator | scheduling stays unsafe; the routine stays manual |
| D-3 | first reading source: O4 today, O6 as the durable target | operator | every snapshot stays `degraded: true` |
| D-4 | app-side extraction (F-3): add read-only numeric extraction, or keep readings operator-typed | operator | O6 stays unimplementable as specified |
| D-5 | `freecashMonitorAdapter.ts`: it now has two live importers (F-2) — keep, label superseded, or remove once unused | operator | a rule-less second monitor stays wired into Jarvis |
| D-6 | re-enable `index.ts:436` (`reconcileGoalsOnStartup`) or leave it commented | operator | startup reconciliation stays off without a record of the choice |
| D-7 | notification sink: toast + read the log, or scope a real sink | operator | alerts stay in `alerts/alerts.jsonl` |
| D-8 | canonical state root: `data/freecash` (empty) or `data/freecash-monitor` (holds all real state) | operator | evidence keeps landing in two places |

---

## 8. Definition of done

1. `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` with the mutation probe still failing (S-1).
2. Both R2 scanners exit 0 at a pinned `exempt=28`, quoted in the same session (S-0).
3. A data-less day leaves no day lock (S-2, C11) — observed, not asserted.
4. One complete operator record exists and produces exactly one snapshot (S-3, C18).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S-5).
6. One real change end to end → one notification, one approval item, one human decision, `execution_state` unchanged (S-8).
7. Watchdog: healthy day silent; uncovered day exactly one alarm (S-6) — including at least one day that would otherwise have passed silently as 09-22→09-30 did.
8. Every line in `alerts/alerts.jsonl` attributable to a known writer (S-9, C14).
9. No secrets in routine, state or reports (C6); no unrelated uncommitted path modified (C7, 838 baseline).

---

## 9. Non-goals and claims this plan refuses to make

No rewrite, move or deletion of the legacy monitors (`scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `finance-monitor/`, `config/freecash-crontab`) — disable and label, never delete. No live financial write path. No compliance claim from a static grep or from a PASS quoted in an earlier session. No modification of the pre-existing 838 uncommitted paths. No voice/Jarvis runtime path touched.

**This routine produces visibility, not revenue.** No option in §5 has a revenue time-to-value; the money path is `bgtask-07a8154b0` (S-10). Nothing here certifies R3/R4 on live account data, makes the acceptance gate green, or creates a scheduled task.

---

## 10. Concurrent-session observations (2026-09-30, 20:50–20:55) — appended after the body was written

Measured while this plan was being written; recorded because two of the three change a stage's premise.

| # | Observation | Command | Consequence for this plan |
|---|---|---|---|
| W1 | **Another session wrote its own Free Cash plan at the same minute.** `.hermes/plans/2026-09-30_205230-free-cash-finance-automation-workflow-plan.md` (18,432 bytes, mtime 20:52), header `Workflow Plan (constraint-first, re-verified)`, `Written: 2026-09-30 20:52 local`. It independently reports the same load-bearing facts (52 tests green, `exempt=28`, not scheduled, 9 missed days, today's day key free) — **independent corroboration of §0**. Its scratch root is `C:/Users/cd-pr/AppData/Local/Temp/fc-plan-20260930-205213` (`.tmp-fcplan-root.txt`) — **a temp root, so it did not write live state.** | `ls -l .hermes/plans/`; `head -20 <that file>`; `cat .tmp-fcplan-root.txt` | **Two plans for one job exist as of this pass (C16 applies to plans as well as code).** The operator must name one as current; the duplicate-work hazard that produced V7's F-6 (an unattributed append) is live again tonight, and C14's single-writer rule now needs a plan-level equivalent. This file claims authority only as an *implementation* plan against live evidence; it does not delete or overwrite the other. |
| W2 | **The revenue path's precondition is being re-verified tonight, and its own probe says it is still blocked.** `.tmp/shopify-verify-20260930/` (DB copy 194 MB + `channel-verification.json`, `credential-probe.json`, `inventory-scan.json`, 20:52–20:54): `step7_capability_inventory_declared: true`, `step7_auth_state: "auth_required"`, **`step7_auth_established: false`**; `provider_credentials.rowCount = 2` but **`rowsContainingShopify: []`**; `system_secrets.rowCount = 14`, **`rowsContainingShopify: []`**; `shopifyHostOrCredentialHits: []`, `shopifyTasks: []`; `verifiedRevenueSum: 38` across `experimentsWithSales: 5`. | `cat`/`tail -c` of those four files | **S-10's blocker is unchanged and now re-verified today**: Shopify auth is not established and no Shopify credential exists. Note the plan-visible distinction — `provider_credentials` is **not** 0 rows now (2 rows exist) but holds nothing Shopify; V7's "0 rows" claim is stale on the count even though its conclusion holds. The revenue path remains a human decision, not a monitor stage. |
| W3 | **The Hermes cron mechanism is alive; it has zero jobs.** `hermes/cron/` holds `ticker_heartbeat` and `.tick.lock`, both mtime **2026-09-30 20:54** (ticker running), `executions.db` last touched 2026-09-17, and no job definitions. The concurrent session's own probe reports `cronjob_manage list → count: 0`. | `ls -la C:/Users/cd-pr/AppData/Local/hermes/cron/` | A third scheduling surface exists beyond Task Scheduler and the in-app scheduler. It is **empty and therefore safe today**, but S-5 must name which surface owns Task A/B — registering the same job on two tickers violates R1 in a way no day lock can prevent. |
| W4 | **This pass's own footprint was not solely mine.** `git status --porcelain` moved 838 → 842 during this window; only one line matches `free-cash-monitor-routine` (and the routine dir is untracked, so the new file adds nothing to the count). The other entries come from concurrent writers (`.agentic/handoffs/bgtask-*.json` × 8 at 20:51, `.hermes/plans/*`, `.tmp/*`). | `git status --porcelain \| wc -l`; `find . -newermt "2026-09-30 20:20"` | **C7 must be read as "I did not disturb it", not "it did not change."** Per-file attribution, not the global count, is the honest footprint measure on this host. |

**Net effect on the plan:** no stage changes order, and no finding in §3 is withdrawn. W1 adds a decision (D-9: which plan is current), W3 adds a constraint check to S-5, W2 hardens S-10's blocked entry with same-day evidence.

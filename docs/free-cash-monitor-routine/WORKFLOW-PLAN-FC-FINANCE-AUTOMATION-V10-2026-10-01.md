# WORKFLOW PLAN — Free Cash Finance Automation (V10, 2026-10-01 09:0x local)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` (HEAD `8f7463a`) · **Host:** Windows 11 (German-localised), git-bash (MSYS), non-elevated
**Written:** 2026-10-01, 08:58–09:0x operator-local (`date` → `Do,  1. Okt 2026 08:58:59`; Europe/Berlin, UTC+02:00)
**Supersedes:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V8*.md` (stale) **and consolidates** `…-V9-2026-10-01.md` + `…-V9-ADDENDUM-2026-10-01-GATE-SCOPE-AND-FALSE-COMPLIANCE.md` **and** the concurrent `DELEGATION-2026-10-01/WORKFLOW-PLAN.md` (deleg_fec45ca6) set. It **replaces their verdicts on two points** that this pass re-measured: (a) "today's key 2026-10-01 is still free" is **false as of 08:53:46 local**; (b) the delivered package-scope gate does **not** satisfy C9, because 3 of its 10 mutants escape.
**Subject:** the daily status-monitoring routine for Free Cash Finance Automation, canonical package `D:/AgenticOS/monitoring/freecash/` (entry point `run_daily_check.py`), plus the revenue path it can never unblock.
**Evidence standard (C5):** every row in §0 is a command executed in *this* pass (08:58–09:0x). Inherited facts are labelled `inherited`. No PASS is quoted from an earlier session.
**Footprint:** this file is **new** (additive). No existing file edited, moved, renamed or deleted — including the parallel V9 and delegation documents. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created or modified. No provider network call. No credential/token/secret. Every routine invocation here used a scratch `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp\`; the production root's hashes were read before and after and are **byte-identical** (§0 A14) — the production root was modified only by the leaked run of 08:53:46, not by this pass.

---

## 0. Live state, verified in this pass

| # | Command (executed this pass) | Observed result | Verdict |
|---|---|---|---|
| A1 | `date`; `which python`; `python -V` | `Do,  1. Okt 2026 08:58:59`; `…/hermes-agent/venv/Scripts/python`; `Python 3.11.9` | clock + interpreter of record confirmed (C10) |
| A2 | `sha256sum` of `last-run.json`, `alerts.jsonl`, `operator-state.json` | `a287a902…3bf9`, `1b9c7c07…99a8`, `be8becc3…a59c` | **`last-run.json` and `alerts.jsonl` differ from the values pinned at 08:41 and again at 08:51** (`2310072a…399a`, `7a90034f…96cc`) — the production root changed between those passes |
| A3 | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock` (mtime 2026-10-01 08:53)** | **today's day is spent**; V9:V13's repro and the addendum's A10 ("2026-10-01 is still free") are both overtaken |
| A4 | `cat snapshots/2026-10-01.json` | `day_key=2026-10-01`, `source.kind=operator_entered`, **`data_available:false`**, `degraded:true`, all four figures `null`, note "no operator-entered record for 2026-10-01 in operator-state.json" | a **null snapshot** was written for today |
| A5 | `cat state/last-run.json` | `last_attempt_day=2026-10-01`, **`last_success_day=2026-10-01`**, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0` (was 9), `last_attempt_at_utc=2026-10-01T06:53:46Z` | **a day with no reading is booked as a SUCCESS day, and the 9-day miss counter was reset to zero** (C19 violated again, now in the production root) |
| A6 | `tail -6 alerts/alerts.jsonl`; `wc -l` | **15 lines** (was 14); last line `event_type=MONITOR_DEGRADED`, `day_key=2026-10-01`, `ts_utc=2026-10-01T06:53:46Z` | the canonical evidence record gained one line today from a run **no one has attributed** (C14) |
| A7 | `python -c json.load(operator-state.json)['records']` | `records=0` | **no reading has ever been entered** — the run of 08:53:46 could not have produced a figure |
| A8 | `DELEGATION-2026-10-01/delivery/evidence-04-production-root-byte-neutral-V2.txt` | captured **2026-10-01T06:51:20Z**: full-root sha set, `diff exit=0`, "files before: 10 files after: 10", "no `2026-10-01.lock` = the production root was never driven by this session" | the byte-neutrality claim was **true for its window and falsified 2 min 26 s later** by the 06:53:46 run → new constraint **C27** |
| A9 | `DELEGATION-2026-10-01/scheduler/evidence/evidence-09-INCIDENT-…txt` | sibling-pass forensics of the same leak, header "PRODUCTION FORENSICS after the leak at ~08:53:46 local" | the leak is already on the record by a sibling pass; **this plan carries its decisions as S11** |
| A10 | `python monitoring/freecash/tests/run_all.py` (scratch root; exit captured without a pipe) | `run_all: tests=52 failures=0 errors=0 skipped=0`, `tests_exit=0`; the run printed `WATCHDOG_MISSED_DAY 2026-10-01 … coverage=NOTIFIED` / `coverage=DEDUPED` | offline suite **GREEN this run**; note the suite is load-sensitive (`inherited`: 1 failure in 4 full-suite runs at 08:41) |
| A11 | `python monitoring/freecash/verify_readonly.py` · `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | both `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** | R2 static gate green, baseline **28** (both scanners agree) |
| A12 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` · `… monitoring/freecash --package` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`, `VERDICT: NOT COMPLIANT -- 1/4`, exit **1** · `error: unrecognized arguments: --package`, exit **2** | shipped acceptance gate (C9) **RED**; package mode **still does not exist** |
| A13 | `python docs/…/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash` · `--self-test` | `DETECTOR-RESULT: rule=1 PASS (15) … rule=4 PASS (20)` · `SUMMARY: R1..R4=PASS` · `VERDICT: COMPLIANT` exit **0** · self-test `PASS`, exit **0** | the package-scope gate exists and runs (confirms the V9 addendum A1/A2) — **but see A15** |
| A14 | `sha256sum` production `last-run.json` + `alerts.jsonl` **after** A10–A13 | `a287a902…3bf9`, `1b9c7c07…99a8` — identical to A2; `day-locks/` unchanged (3 locks) | this pass is **hermetic** w.r.t. the production root |
| A15 | `DELEGATION-2026-10-01/verifier/mutation-harness-run.txt` (10 mutants vs the delivered gate) | `DETECTED=YES` ×7; **`DETECTED=NO` ×3: `adv3-r4-getattr-exec`, `adv4-r1-conditional-backdoor`, `adv6-r1-new-socket-file`** → "UNDETECTED MUTATIONS (blind spots)"; the blind-spot liveness probe shows the first two are **real** (`EXECUTED 303bf3dc-…` from `os.system`; `POST /api/v1/status/cashout` + `POST /api/v1/cashout` on the wire under `FREECASH_LIVE_READ=1`) | **C9's "with the mutation probe still failing" property is NOT met by the delivered gate** → new constraint **C25** |
| A16 | `node server/scripts/verify-freecash-rules.mjs` · `node --check server/scripts/freecash-daily-monitor.mjs` | verifier: `[OK] All 4 operational rules verified (4/4 passed)`, exit **0** · target: `SyntaxError … line 41 function isDailyCheckAllowed(): boolean`, exit **1** | **live false-compliance source**: a green 4/4 on a file that does not parse (re-confirmed) |
| A17 | `python -c ET.parse(...)` over the four scheduler XMLs | `FreeCash-Daily-Monitor.xml` + `-Missed-Day-Watchdog.xml` → **OK**; `DECISION-V2-FreeCash-Daily-Monitor.xml` → `ParseError line 96, column 227`; `DECISION-V2-…-Missed-Day-Watchdog.xml` → `ParseError line 74, column 205`; offending text observed: `<Arguments>…task-a.log 2&gt;1` written as a **raw `&`** | **the DECISION-V2 registration payloads cannot be imported (`schtasks /XML` requires well-formed XML)** → new constraint **C26** |
| A18 | `grep -c OPERATOR_IDENTITY_ENV monitoring/freecash/approval_queue.py`; `grep -n NON_HUMAN_DECIDERS` | `0` (exit 1); the live guard is still the denylist at `:55`, `:153` (`if who.lower() in NON_HUMAN_DECIDERS`) | the R4 identity-provenance patch is **proposed but not applied** (only in `delivery/proposed/`) |
| A19 | `grep -n SUCCESS_OUTCOMES -A 8 gate.py`; `grep -n covered watchdog.py` | `gate.py:32-40` still contains `MONITOR_DEGRADED`; `gate.py:198` `if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day`; `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | **root cause unchanged**: "the monitor ran" is still conflated with "a reading exists"; the watchdog on a null snapshot reports covered |
| A20 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest package mtime `2026-09-20 06:59` (`changedetect.py`, `watchdog.py`); `gate.py` `2026-09-18 07:32` | **no code in the package has changed since 2026-09-20** — all of today's activity is documents and delegations |
| A21 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash`; `hermes cron list` | **278** tasks, **0** Free Cash; `hermes cron list` → "No scheduled jobs." | still never scheduled; nothing to undo before S7 |
| A22 | `curl -m5 localhost:4600/api/health`; `curl -m5 127.0.0.1:3001/health`; `tasklist \| grep -ic electron` | `4600=200`; `3001=000`; `electron=0` | the API answers, the **desktop shell is not running** (C17 binds) |
| A23 | `git status --porcelain \| wc -l`; `git rev-parse --abbrev-ref HEAD`; `git log --oneline -1` | **862** (was 856 at 08:4x, 838 at V8); branch `hermes-rescue-20260908`; HEAD `8f7463a` | footprint grows ~1 file/2 min in this hour; `monitoring/` and `data/freecash-monitor/` remain entirely untracked (C7) |
| A24 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"`; `ls -d data/freecash data/freecash-monitor server/data/freecash-monitor` | no credential/sink in the environment (only this pass's scratch root); **all three roots exist** | C6 holds; the state-root ambiguity (S2) is still unresolved |
| A25 | `cat config/freecash-crontab` | points at `scripts/make_freecash_check.py` with placeholder `/path/to/AgenticOS` | the configured cron target is a **broken stub pointing at a non-existent path** (inherited defect, re-confirmed in the file) |

### 0.1 What changed in the last ~20 minutes (read this before any other plan)

1. **Today's day key was spent at 08:53:46 local, on a run that read nothing.** It created `2026-10-01.lock`, wrote a null snapshot, appended `MONITOR_DEGRADED` as line 15, advanced `last_success_day` to today **and reset `consecutive_missed_days` from 9 to 0** (§0 A3–A7). Consequences: the watchdog will report today as covered; the 10-day silent gap is now invisible in the ledger; and **no operator reading can be obtained for 2026-10-01 unless a human deliberately removes the lock (§2 S11/O-B)**.
2. **The byte-neutrality evidence for the delegated sessions was falsified 2 min 26 s after it was captured** (§0 A8) — not by dishonesty but by a later run in the same hour. A footprint claim is only valid to the second it is quoted.
3. **The compliance picture is now dual and neither half is green.** The shipped verifier is structurally unable to pass a modular package (A12) while the delivered package-scope gate passes 4/4 (A13) **yet lets 3 of 10 mutants through, two of them live and executable** (A15). "COMPLIANT" from the delivered gate is a statement about its own detector coverage, not about the package.
4. **Nothing in the package was fixed today** (A20), **nothing is scheduled** (A21), **no reading exists** (A7), and the only authenticated money path is still blocked (`inherited`, V9:V20/V21).

**One-line status:** the routine demonstrably runs — and this morning it spent the production day on a null read, booked it as a success, reset its own miss counter, and silenced the watchdog it was built to feed; the shipped acceptance gate is still red for a reasons-of-scope; the working gate still passes three live mutants; and after 11 days, 13 plan documents, 862 uncommitted paths and a 15-line alert log, **no single operator figure has ever been entered**.

---

## 1. Operational constraints (binding; every stage is checked against these)

Adopted unchanged from V9 §1: **R1** one status read per Europe/Berlin calendar day · **R2** zero earning/withdrawal actions, read-only transport · **R3** notify on change, exactly once · **R4** human approval before ANY external action, no execution path exists · **C5** live evidence only · **C6** no secrets · **C7** never disturb the 862 uncommitted paths, no destructive git · **C8/C16** one implementation per job · **C9** acceptance gate green before any registration · **C10** venv Python 3.11.9 is the interpreter of record (`py -3` = 3.14.7 lacks `tzdata`) · **C11** never spend the day before a reading exists · **C12** name port and clock in every health claim · **C13** a scheduled run must not inherit ambient `FREECASH_*` · **C14** one attributable writer per `alerts.jsonl` day · **C17** no plan may depend on an app-side component while the app may be closed · **C18** single-sitting first actions · **C19** "ran" ≠ "read" · **C20** the monitor is a visibility instrument, not a revenue instrument · **C21** the production root is not a scratch dir · **C22** no machine-timed bursts · **C23** gate identity (each claim names its gate file and exit code).

**New in V10:**

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C24 (NEW — a spent day is spent)** | no plan, brief or stage may assume a free day key; every pass reads `day-locks/` in the same session before proposing any run against the production root | A3: `2026-10-01.lock` appeared at 08:53:46, 15 min after a plan stated the key was free | the day key and the `ls day-locks/` output are quoted together |
| **C25 (NEW — an escaping mutant is not evidence)** | a gate is "green" only when its mutant set is *closed*; a surviving mutant is a named open defect, and a live one blocks the verdict outright | A15: 3/10 mutants survive, two of them live (`os.system` executed; `POST …/cashout` on the wire) | mutant table with `caught=NO` rows named as defects, not footnotes |
| **C26 (NEW — a payload must parse in its consumer)** | no proposal artifact counts as deliverable until the tool that will consume it accepts it (`schtasks /XML` ⇒ `ET.parse`) | A17: both `DECISION-V2-*.xml` fail `ET.parse` on an unescaped `&` in `<Arguments>` | the parse command and exit 0 are quoted per artifact |
| **C27 (NEW — footprints expire)** | a "no footprint / byte-neutral" claim is valid only for the window ending the moment it is quoted; any hand-off re-reads the root | A8: neutrality measured 06:51:20Z, falsified 06:53:46Z | the hash pair, both timestamps and the re-read at hand-off |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**Ordering:** `S0′ ∧ S1 → S11 → S3 → S4 → S5 → S6 → S7 → S8′ → S9′` (S8′/S9′ parallel; S10 separate and human-gated). One change between gate runs. A stage is complete only on output produced in the session that claims it. Never widen an allowlist and exempt a scanner hit in the same change.

**S0′ — Gate: port the working detectors into the shipped verifier, and close the mutants. Blocking.**
Expected Effort: 3–5 h (2–4 h port + 1–2 h closing 3 blind spots). Time-to-Revenue: none — this buys the verdict, not cash. Dependencies: the delivered `DELEGATION-2026-09-30/verifier/` artefact (present) and `DELEGATION-2026-10-01/verifier/mutation_harness.py` (present).
First Concrete Action: add `--package <dir>` to `scripts/monitoring/rule_gate_verify.py` (argparse today `target [--run] [--json] [--json-out]`, exit **2** on `--package`, A12) and move the four detectors under it — then re-run `mutation_harness.py` and require a **closed** mutant set (A15's three `caught=NO` rows are the acceptance bar, not a footnote).
Exit: `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** exit non-zero on every mutant in the harness (C25); exactly one gate file reachable from the repo root (C8/C16/C23).
Options: **O-A″ port + close mutants (recommended, 3–5 h)** · O-B″ move `verifier/rule_gate.py` in as-is (0.5 h — ships a third gate *and* a 3-mutant blind spot; C8/C16/C25 risk) · O-C″ operator override of C9 in writing (0.2 h; removes the automatable gate) · O-D″ inline `gate.py`'s lock into the entry file (3–5 h; **rejected** — a second copy of R1, and R2–R4 would still fail; the shipped verifier is file-scoped by construction).

**S1 — Make the day budget honest (C11 + C19). Unchanged root cause, now with a production incident behind it.**
Expected Effort: ~40 min (O-1) / 3–5 h (O-2) / ~1 h (O-3) / 3–6 h (O-4). Time-to-Revenue: none. Dependencies: none.
First Concrete Action: write the failing test first — *"a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog report `WATCHDOG_MISSED_DAY`"* (today it does the opposite, A5/A19) — then make coverage key on `data_available`, not on process completion.
Exit: a data-less run leaves `day-locks/` empty, `last_success_day` unchanged, the miss counter preserved, watchdog `WATCHDOG_MISSED_DAY`; a day with a reading yields exactly one lock, one snapshot, one `SKIP_DUPLICATE_DAY` on the second run; the R1 race still shows one winner (under full-suite load, per C25-style evidence discipline).
Options: **O-1 two-phase accounting only (~40 min, the honest minimum — take `MONITOR_DEGRADED` out of `SUCCESS_OUTCOMES` and key coverage on `data_available`; smallest change that makes the watchdog truthful)** · O-2 two-phase lock + accounting (3–5 h; an *attempt* record that only becomes a consumed day on a successful read — deliberately weakens "one read per day" to "one successful read per day", to be stated in the decision record) · O-3 wrapper pre-flight guard (~1 h; defence in depth only — **insufficient alone**, the 09-30 run *was* the wrapper path) · O-4 O-2 + O-3 · O-5 stay manual (0 h; unattended operation stays blocked — the safe default in force today).

**S11 — Close the 2026-10-01 incident and decide the day (operator-owned; no agent may execute this).**
Expected Effort: 10 min of decisions (+1 command if remediated). Time-to-Revenue: **same-day visibility if remediated** (a reading today is still obtainable), none if accepted. Dependencies: a human decision; if the day is remediated, do it **before** any run against the production root (C24).
First Concrete Action: record three answers in writing — (1) is the 08:53:46 run accepted as a documented C11/C19/C21 breach, (2) is `2026-10-01.lock` left in place, (3) is a corrective note **appended** (never rewritten) to `alerts.jsonl`? If the day is remediated: hash the root, `rm data/freecash-monitor/state/day-locks/2026-10-01.lock`, re-read the root, and state that the R1 record now understates what happened.
Exit: three answers recorded against this section, with the before/after hash pair if anything was removed; and one sentence in every later status stating that **2026-09-30 and 2026-10-01 were both spent by runs that read nothing**.
Options: **O-A accept the breach and keep the lock (0 effort; one day lost; the record stays true — recommended default)** · O-B remediate (remove the lock + null snapshot after a human decision; ~10 min; recovers one read today; falsifies the day record — only defensible if the corrective note is appended).

**S3 — First real operator reading.**
Expected Effort: 1 h setup + ~60 s/day. Time-to-Revenue: **same day, visibility only** (C20). Dependencies: S1 (else the first data-less run burns the next day — proven twice now), C10 interpreter, S11 decided, a free day key (C24).
First Concrete Action: the operator logs into their own dashboard and appends one record to `data/freecash-monitor/state/operator-state.json` for the chosen free `day_key` with four integer-cent figures (`records: []` today, A7 — this would be the first ever), then runs the entry point once through the 3.11.9 interpreter and quotes the `RUN_OK … outcome=INITIAL_BASELINE` line.
Exit: a day-1 baseline snapshot with `data_available:true`; a later day with a changed figure produces exactly one payload and one approval item.
Honest limit: every snapshot from this source is `degraded: true` by construction — a "no change" day only proves the same numbers were typed twice.

**S4 — Bridge Path B (authenticated app path) into Path A.** Unchanged from V9; still gated on a human session.
Expected Effort: 4–8 h. Time-to-Revenue: 3–7 days of sight of the real account; **no revenue** (C20). Dependencies: a human starts the app and authenticates (A22: listener `200`, **0 Electron processes**), the operator logs in via the existing `startInteractiveLogin()`, `checkAuthenticatedSession()` returns a live session, field names fixed in writing, **S1 resolved first**.
First Concrete Action: start the app, call the existing probe once through the app's own path, quote its evidence artefact, then write the four-field mapping (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`) into the shape `operator_state.py` already reads.
Do not: create a third monitor (C8/C16); add a provider host to `readonly_client.ALLOWED_PATHS`; extend `freecashMonitorAdapter.ts`, which enforces no rule.
Exit: one day's reading produced through Path B and consumed by Path A's existing source; `verify_readonly.py` still `forbidden=0 exempt=28`; `git status` shows no new monitor module.

**S5 — Delivery: prove the one sink.** Expected Effort 0.5–1 h · Time-to-Revenue none · Dependencies S3 or S4 · First Concrete Action: with the session unlocked, dispatch one real toast and record the label; then lock the session and repeat to observe the bounded-failure path. Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*`, no mail tooling (A24).

**S6 — Approval surface (R4), including the identity defect.**
Expected Effort: 2–4 h (+1 h if the provenance patch is adopted). Time-to-Revenue: none. Dependencies: S3 or S4 (the queue has never held an item, A24/`approvals/` empty).
First Concrete Action: decide one enqueued item as a named human and quote the append-only row together with `execution_state` staying `NOT_EXECUTED`; then attempt a **machine-labelled** decider and record the refusal — noting that the live guard is a **denylist** (`approval_queue.py:55`, `:153`; the provenance patch is unapplied, A18), so the refusal proves the labeller, not the provenance.
Exit: every decision attributable to a human identity set outside the routine; a `PENDING` item survives any clock advance unchanged; the denylist's bypassability is either closed by the proposed `FREECASH_OPERATOR_IDENTITY` control or recorded as an accepted residual risk.

**S7 — Schedule Task A + Task B — handover only, human-registered.** Still blocked.
Expected Effort: 1–2 h plus the operator's approval (+0.2 h to escape the `&`). Time-to-Revenue: none. Dependencies: **C9 green (S0′), S1 (O-1 minimum), S3, S2's pinned root, and a well-formed payload (C26)**.
First Concrete Action: escape the raw `&` in `<Arguments>` (`2>&1` → `2>&amp;1`) in both `DECISION-V2-*.xml` files and re-run `ET.parse` on each (A17), then hand the operator the exact non-elevated `schtasks /Create /XML` text (Task A 08:35, Task B 23:50, `IgnoreNew`, `StartWhenAvailable`, restart-on-failure = **Do not restart**) and **do not register it**.
Exit: `ET.parse` exit 0 on both payloads; `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and both policies; or an explicit recorded decision not to schedule, in which case the routine is described as *built and unverified in operation*. Verified today: 278 tasks, **0 Free Cash** (A21) — nothing has to be undone first.

**S8′ — Alert attribution + burst coalescing (C14/C22).**
Expected Effort: 1–2 h now, ~2 min/day after. Time-to-Revenue: none. Dependencies: none (parallel).
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — **all 15 lines, including today's, carry none** (A6, keys `day_key,dedupe_key,event_id,event_type,message,observed,severity,ts_utc`) — and coalesce missed-day catch-up so N missed days reach the operator as one payload.
Exit: a new line's origin is identifiable from the line itself; the next bundle's baseline **includes** the 2026-09-21 unattributed line, the 09-30 burst and today's line, so nothing is laundered.

**S9′ — Deprecation index (delete nothing, C8/C16).**
Expected Effort: 1–2 h, read-only. Time-to-Revenue: none — false-compliance risk control. Dependencies: none.
First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py` (and its broken `config/freecash-crontab` entry, A25), `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `server/scripts/verify-freecash-rules.mjs` (**DEPRECATED — do not cite as compliant**, with its observed defect: 4/4 PASSED, exit 0, no `process.exit`, target fails `node --check`, A16) and `server/src/adapters/freecashMonitorAdapter.ts`, each with its exact gate command, naming `monitoring/freecash/` as the single implementation and noting that the package-scope gate exists in two places until S0′ resolves it.
Exit: index exists; no file moved, edited or deleted.

**S10 — The revenue path (not the monitor; carried so it is not silently dropped, C20).**
Expected Effort: unknown (a human decision and a worker re-dispatch first). Time-to-Revenue: **the only stage with a direct revenue hypothesis, and it is unbounded.** Dependencies: a human decision, the app running, and a publication step that does not exist.
First Concrete Action (option R-a): with the app running, resume `bgtask-07a8154b0` in the UI — `blocked`, `resumable=0`, `result_text` empty, blocker "Backend restarted while this task was in progress…", last update `2026-09-19T18:05:18Z` (`inherited`, V9:V20). Recorded reality: `revenue_ledger_entries` 11 rows, newest verified `2026-08-19` (incl. `VERIFIED_REVENUE 19.0 EUR`), `treasury_ledger` 0 rows, all Shopify authorisation gates `resolved` — **the remaining blocker is a missing implementation step, not an approval**.
Options: **R-a resume/re-dispatch the mission (1–2 h, unknown TTR, needs app + human)** · **R-b implement the publication step (unbounded, weeks-to-revenue if it works)** · **R-c monitor only (0 h, 0 revenue — the honest default while S0′/S1 are red)**.

---

## 3. Options at a glance

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Gate (S0′) | **O-A″ port detectors + close 3 mutants** | 3–5 h | none | delivered `verifier/` + harness | add `--package` to the shipped verifier; re-run the harness until 0 uncaught |
| Gate (S0′) | O-B″ move the delivered gate in as-is | 0.5 h | none | none | ship a third gate + a live blind spot (C8/C25) |
| Gate (S0′) | O-C″ override C9 in writing | 0.2 h | none | operator sign-off | record the override; lose the gate |
| Gate (S0′) | O-D″ inline the lock in the entry file | 3–5 h | none | none | **rejected** (A12 shows R2–R4 still fail) |
| Day budget (S1) | **O-1 honest accounting only** | ~40 min | none | none | failing test: data-less run must not advance `last_success_day` |
| Day budget (S1) | O-2 two-phase lock + accounting | 3–5 h | none | none | failing test first, then attempt-then-consume |
| Day budget (S1) | O-3 wrapper pre-flight guard | ~1 h | none | S7 wrapper | guard on today's `day_key` (insufficient alone) |
| Day budget (S1) | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | unattended operation stays blocked |
| Incident (S11) | **O-A accept the breach, keep the lock** | 10 min | none | operator | record three answers; keep 2026-10-01 spent |
| Incident (S11) | O-B remediate the day | 10 min + 1 command | **same-day visibility** | operator; S1 first | hash → `rm 2026-10-01.lock` → re-read → append a corrective note |
| Read source | **O4 operator-entered** (available) | 0 h builder + 0.5 h operator | **same day, visibility** | S1, S11, a free day key, pinned interpreter | append four integer-cent figures; expect `INITIAL_BASELINE` |
| Read source | **O6 Path-B bridged read (rank 1 target)** | 4–8 h | 3–7 days, visibility | app **running with a human session**, S1 | start the app; call `checkAuthenticatedSession()` once; quote the artefact |
| Read source | O1 loopback metrics route | 3–5 h + new route work | 1–2 days, workstation metrics only | a route that has never existed | `curl :4600/api/v1/status/metrics` (expect 404) |
| Read source | O2 provider read contract | 2–4 h if an account exists | 3 days–2 weeks | confirmed account, out-of-repo token (**`provider_credentials`=0**) | probe the documented endpoint with the operator's own token, `[REDACTED]` |
| Read source | O3 payout balance endpoint | 4–8 h + a rules decision | 1–4 weeks, unbounded if refused | a POST-minted token, which R2 refuses | probe unauthenticated; check for an enabled payouts key |
| Read source | O5 live-session automation in the routine | unknown | unknown | provider identity + session + credential | **BLOCKED** — keep off the critical path |
| Delivery (S5) | toast only | 0.5–1 h | none | S3/S4 + a change | one real toast, label recorded under locked/unlocked |
| Schedule (S7) | handover (no registration) | 1–2 h + 0.2 h | none | C9, S1, S3, C26 | escape `&` in both XMLs; hand over the `schtasks` text |
| Revenue (S10) | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume `bgtask-07a8154b0` in the UI |
| Revenue (S10) | R-b implement the publication step | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| Revenue (S10) | R-c monitor only | 0 h | none | none | say plainly: visibility, not cash |

---

## 4. Blocked register

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | S0′ port | shipped verifier `R1=FAIL`, exit 1, no `--package` (exit 2) (A12); the delivered gate passes but 3/10 mutants survive, two live (A15) |
| Any reading for 2026-10-01 | S11 (human decision) + a lock removal | today's key was spent at 08:53:46 on a null read (A3–A5) |
| Unattended scheduling | S1 remedy **and** C26 **and** C9 | a data-less run spends the day *and* books it as a success (A5/A19); the DECISION-V2 XML payloads do not parse (A17) |
| Trustworthy "monitor is alive" signal | S1 (C19) | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` → `watchdog.py:33` reports covered on a null snapshot (A19) |
| Live account status | the app running **with a human session** + the S4 bridge | listener `200`, **0 Electron processes** (A22); `provider_credentials = 0` |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured (A24); only the toast is implemented |
| Any withdrawal or earning action | R4 human approval surface | must never run unattended; no execution path exists by design (but the decider guard is a denylist, A18) |
| Strong R4 identity provenance | the unapplied `delivery/proposed/…-approval-identity-V2.diff` | `OPERATOR_IDENTITY_ENV` absent from the live file (A18) |
| In-app scheduler as a 24/7 mechanism | the desktop app process staying alive | `inherited`: last tick `2026-09-19T18:05Z`; no Electron process today (A22) |
| Revenue mission `bgtask-07a8154b0` | worker re-dispatch after a lost worker | `blocked`, `resumable=0`, `result_text` empty (`inherited`) |
| Publication of shopify-verified revenue | implementation | €19 verified 2026-08-19; all authorisation gates `resolved`; nothing published since (`inherited`) |
| Writer attribution (C14) | a code change or a documented operating window | 15 lines, none carrying a writer key; today's line unattributed (A6) |
| A second/third state root's disposition | an operator decision | `data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor` all exist (A24) |
| Elevated task registration | elevated shell | non-elevated host by policy |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S0′ remedy: O-A″ / O-B″ / O-C″ | operator | C9 stays red, no task may be registered |
| D-2 | S1 remedy: O-1 / O-2 / O-3 / O-4 / O-5 | operator | every unattended run keeps spending a day and hiding it |
| D-3 | S11: accept or remediate 2026-10-01 | operator | the incident stays open and each new day inherits a spent key |
| D-4 | authoritative read source: O4 / O6 / O1 / O2 / O3 | operator | every snapshot stays `degraded: true` |
| D-5 | when the app is started, and by whom (C17) | operator | the only authenticated path stays unreachable |
| D-6 | `verify-freecash-rules.mjs` + `freecashMonitorAdapter.ts` + `freecash-daily-monitor.mjs`: label now, remove once unused | operator | a green 4/4 certifying an unparseable file stays available to any future reader |
| D-7 | state-root disposition (S2) incl. `server/data/freecash-monitor/` | operator | two roots can silently diverge |
| D-8 | revenue: R-a / R-b / R-c | operator | the money path stays at €19 verified 2026-08-19 |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path, in any option. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session (C5). No modification of the 862 pre-existing uncommitted paths (C7). No voice/Jarvis runtime path touched. **This routine produces visibility, not revenue** — no option in §3 outside S10 has a revenue time-to-value.

## 7. Definition of done

1. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** exit non-zero on every mutant in `mutation_harness.py` (S0′, C25); exactly one gate file reachable from the repo root (C23).
2. `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0`, `tests_exit=0`, with the R1 race asserted **under full-suite load**; both R2 scanners exit 0 at a pinned `exempt=28` (A10/A11 this pass).
3. **A data-less run leaves no day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, and is reported as `WATCHDOG_MISSED_DAY`** (S1, C11+C19 — today's 08:53:46 run demonstrably does the opposite, A5/A19).
4. One real reading consumed, one real change notified exactly once, one approval item decided by a named human, `execution_state` still `NOT_EXECUTED` (S3/S4/S6).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S3/S7).
6. Watchdog: healthy day silent; uncovered day exactly one alarm, and a multi-day catch-up arrives as **one** payload naming N and the day keys (S7/S8′, C22).
7. Every `alerts.jsonl` line attributable to a known writer (S8′, C14).
8. Both scheduled tasks' payloads parse (`ET.parse` exit 0, C26) and are quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule (S7).
9. No credential anywhere (C6); no unrelated uncommitted path modified (C7); no earning action performed by anything (R2).
10. Every stage states its Time-to-Revenue, and no stage outside S10 claims a path to cash (C20).
11. Every pass that touches the routine states its `FREECASH_DATA_ROOT` and quotes the production-root hash pair before/after (C21); every footprint claim carries the timestamp of its window (C27).
12. The 2026-09-30 and 2026-10-01 incident decisions are recorded with the operator's name (S11), and every later status sentence states that both days were spent by runs that read nothing.

**Honest one-line reading of 2026-10-01 (09:0x):** the routine runs, refuses duplicates and writes a real evidence trail — and this morning it spent the production day on a null read, booked it as a success, reset its miss counter from 9 to 0 and silenced its own watchdog; the acceptance gate is red for a reasons-of-scope while the working gate lets three mutants through, two of them live; the two registration payloads do not parse; nothing is scheduled; no reading has ever been entered; and verified revenue still stands at €19 from 2026-08-19. The shortest honest path to a first real number is **S1 (O-1, ~40 min) → S11 (O-A or O-B, 10 min) → S3 (operator-entered figures, same sitting)**; the shortest honest path to a *trustworthy* monitor adds **S0′ (3–5 h)**.

# WORKFLOW PLAN — Free Cash Finance Automation (V11B, 2026-10-01 09:25–09:42 local)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` (HEAD `8f7463a`, 868 uncommitted paths) · **Host:** Windows 11 (German-localised), git-bash (MSYS), non-elevated
**Written:** 2026-10-01, evidence window `09:25:43` → `09:42` operator-local (`date` → `Do,  1. Okt 2026 09:25:43`; Europe/Berlin, UTC+02:00)
**Relationship to the other documents (additive, nothing superseded):**
- **Companion, not a replacement:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V11-2026-10-01.md` (mtime **09:30**, produced by a concurrent sibling session) holds the routine's step-by-step contract and the trigger times. This file carries the **gate, mutant and concurrency measurements** that no other plan in the tree has, and revises three claims that were still standing at 09:00.
- **Read, not edited:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V10-2026-10-01.md` (09:05), `DELEGATION-2026-10-01/verifier/VERIFIER-PLAN-V2.md` (09:07), `DELEGATION-2026-10-01-R2/workflow/WORKFLOW-PLAN.md` (09:19), both `DELEGATION-2026-10-01-R2/verifier/` harnesses, `DELEGATION-2026-10-01/scheduler/DECISION-V2-*.xml` (09:04).
- **Revises three standing claims, each re-measured in this pass:**
 (a) **S0′ is smaller than the 3–5 h V10 priced** — the delivered package gate catches **8 of 8 semantic mutants** (§0 A13);
 (b) **there are two true evasions, not three escapes** — `adv6` is a *misattributed catch* (non-zero exit via a different rule), new constraint **C29** (§0 A14);
 (c) **the "DECISION-V2 XMLs do not parse" claim from V10 is no longer true** — both parse clean in this pass (§0 A25); that constraint is now satisfied, not open.
**Subject:** the once-daily, read-only status routine for Free Cash Finance Automation — canonical package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py` — and the revenue path the routine can never unblock.
**Evidence standard (C5):** every row of §0 is the output of a command executed **in this pass**. Sibling-produced artefacts are labelled `sibling` and carry the **mtime I read in this pass** (C30). No PASS, hash or count is inherited.
**Footprint:** this file is **new** (additive). No existing file edited, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean`; no scheduled task or cron created or modified; no provider network call; no credential, token or secret read. Every routine or gate invocation used a scratch `FREECASH_DATA_ROOT`/`--workdir` under `%LOCALAPPDATA%\Temp\fcplan-*`; the production root's three hashes are **byte-identical before and after** (§0 A2/A24).

---

## 0. Live state, verified in this pass

| # | Command (executed `09:25:43`–`09:42`) | Observed result | Verdict |
|---|---|---|---|
| A1 | `date`; `which python`; `python -V` | `Do,  1. Okt 2026 09:25:43` … `09:29:37`; `…/hermes-agent/venv/Scripts/python`; `Python 3.11.9` | clock and interpreter of record confirmed (C10) |
| A2 | `sha256sum data/freecash-monitor/state/last-run.json alerts/alerts.jsonl state/operator-state.json` **before and after** | `a287a902…3bf9` / `1b9c7c07…99a8` / `be8becc3…a59c` — **identical at 09:25 and 09:29** | this pass is **hermetic** (C21); the root still holds the 08:53:46 values V10 pinned |
| A3 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` | exactly **4** files, all mtime `08:53`: `alerts/alerts.jsonl`, `snapshots/2026-10-01.json`, `state/day-locks/2026-10-01.lock`, `state/last-run.json` | nothing has been written to production since 08:53 (C27 holds for this window) |
| A4 | `ls -la state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock` (08:53)** | today's key is spent (C24); **2026-09-30 and 2026-10-01 were both consumed by runs that read nothing** |
| A5 | `cat state/last-run.json`; `ls -la snapshots/` | `last_attempt_day=last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`** (was 9); 3 snapshots of 518 bytes, `2026-10-01.json` = `data_available:false`, `degraded:true`, four figures `null` | **"ran" is still booked as "read"** and the 10-day miss counter is still zeroed (C19 violated in production) |
| A6 | `wc -l alerts/alerts.jsonl`; `tail -5` | **15** lines; newest `MONITOR_DEGRADED`, `day_key=2026-10-01`, `ts_utc=2026-10-01T06:53:46Z`; line keys `day_key,dedupe_key,event_id,event_type,message,observed,severity,ts_utc` — **no writer key on any of the 15** | one unattributed writer per day (C14) |
| A7 | `python -c json.load(operator-state.json)['records']` | `records = []` | **no operator figure has ever been entered** (11th day) |
| A8 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest mtime **`2026-09-20 06:59`** (`changedetect.py`, `watchdog.py`); `gate.py` `2026-09-18 07:32` | **zero code change in 11 days**; today's entire output is documents (C31) |
| A9 | `python monitoring/freecash/verify_readonly.py` · `bash docs/…/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** (both, this pass) | R1 static gate green at the pinned baseline **28** |
| A10 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` · `… monitoring/freecash --package` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`, exit **1** · `error: unrecognized arguments: --package`, exit **2** | the **shipped** acceptance gate (C9) is RED and file-scoped by construction |
| A11 | `python docs/…/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash --workdir <temp>` | `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` · `VERDICT: COMPLIANT` · exit **0** | the **delivered package gate** is green on the canonical package (independently re-confirmed) |
| A12 | same gate vs `DELEGATION-2026-10-01-R2/verifier/mutants/canonical-control/pkg` | exit **0** · `COMPLIANT` | the gate's own control is non-vacuous |
| A13 | **same gate vs the 8 semantic mutants** `…R2/verifier/mutants/*/pkg` (all run in this pass) | `r1-a-lock-removed` exit 1 (R2 FAIL) · `r1-b-lock-nonbinding` 1 (R2) · `r2-a-post-cashout-on-read-path` 1 (R1) · `r2-b-urllib-write-path` 1 (R1+R4) · `r3-a-baseline-is-current` 1 (R3+R4) · `r3-b-sub-dollar-threshold` 1 (R3+R4) · `r4-a-nonhuman-decider-accepted` 1 (R4) · `r4-b-arms-on-approve` 1 (R4) | **8/8 caught** — every mutation of a rule the package actually implements is detected. This is why S0′ is a **port**, not a rebuild |
| A14 | `MUTATION-TABLE.tsv` (`sibling`, mtime **09:26**, read inside this pass) — 10-mutant adversarial harness vs the same gate | 7 `detected=YES`; **`adv3-r4-getattr-exec` exit 0**, **`adv4-r1-conditional-backdoor` exit 0** (no rule fails); **`adv6-r1-new-socket-file` exit 1 but the failing check is R4's effect-pinning, not R1's import check** | **2 true evasions + 1 misattribution** — not "3 escapes" (revises V10 A15; new constraint C29) |
| A15 | my own hermetic probe: temp package + new module `earn_client.py` (`http.client.HTTPSConnection(…).request("POST","/api/v1/cashout")`) + `getattr(os,"sys"+"tem")("echo EXECUTED")` inside `decide()`; gate with `--workdir` under `%LOCALAPPDATA%\Temp` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=FAIL`, exit **1** | a **naive** blind spot is caught; the surviving evasions require deliberate obfuscation (fragment-built strings, condition-gated writes, dispatch the effect vocabulary never sees) |
| A16 | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit **0** | offline suite green in this pass |
| A17 | `suite-26-runs.txt` (`sibling`, mtime 09:17, re-read this pass) | 23 × `tests=52 failures=0`; **3 red** (runs 18, 20, 26), each `FAIL: test_five_concurrent_runs_yield_one_winner … AssertionError: 3 != 4` → **11.5 % flake** | a single green suite run is **not** attestation of R2 concurrency (new constraint **C28**) |
| A18 | `grep -c OPERATOR_IDENTITY_ENV monitoring/freecash/approval_queue.py`; `grep -n NON_HUMAN_DECIDERS` | `0` (absent); denylist defined `:55`, applied `:153` | R4 identity-provenance patch still **proposed, not applied**; the live guard is a bypassable ten-word denylist |
| A19 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash`; `hermes cron list` | **278** rows, **0** Free Cash; `No scheduled jobs.` | nothing is scheduled; nothing has to be undone before S7 |
| A20 | `env \| grep -icE "FREECASH\|SMTP_\|WEBHOOK_"` | **0** | C6/C13 hold: no credential or sink in the ambient environment |
| A21 | `curl -m5 localhost:4600/api/health`; `… 127.0.0.1:3001/health`; `tasklist \| grep -ic electron` | `4600=200`; `3001=000`; `electron=0` | the API answers; the **desktop shell is not running** — the authenticated path is unreachable (C17) |
| A22 | `git status --porcelain \| wc -l`; branch; HEAD | **868** (V10: 862 at 09:0x; V8: 838); `hermes-rescue-20260908`; `8f7463a` | the dirty set grows by **plan documents**; `monitoring/` and `data/freecash-monitor/` stay untracked (C7) |
| A23 | `find … -newermt "2026-10-01 09:05"` over the routine tree | sibling artefacts at 09:05, 09:07, 09:11, 09:16, 09:17, 09:19, **09:25–09:26** (shared `mutation-evidence/` rewritten mid-pass), **09:27–09:30** (a new `DELEGATION-2026-10-01-R3/` tree), **09:30** (`V11` + `RESEARCH-PLAN-…-V11`); foreign scratch trees `fcplan-rules`, `fcplan-scheduler`, `fcplan-verify` present | **≥3 concurrent sessions writing in these directories right now** — every quoted sibling artefact expires in minutes (new constraint **C30**); the `V11` filename was already taken when this pass went to write |
| A24 | re-read of A2 hashes + `find … -newermt` at 09:29 | identical to A2; still 4 files at 08:53 | hermetic across the whole pass; only `%LOCALAPPDATA%\Temp\fcplan-*` was written |
| A25 | `find . -name "DECISION-V2-*.xml"` + `ET.parse` + raw-`&` scan (my own) | both `DELEGATION-2026-10-01/scheduler/DECISION-V2-*.xml` (**mtime 09:04**) → `raw_ampersands=0` · `PARSE OK`; daily payload `<StartBoundary>2026-10-02T09:00:00</StartBoundary>`, `<Arguments>` uses `1>>` | **V10's A17 ("both payloads fail `ET.parse` on a raw `&`") is overtaken** — C26 is satisfied for both registration payloads; only the hand-over/registration step remains |
| A26 | `ls -d data/freecash data/freecash-monitor server/data/freecash-monitor` | all three exist | the state-root ambiguity (S2) is still unresolved |

### 0.1 What this pass changes in the picture (read before any other plan)

1. **The gate story is two-sided, and less bleak than 09:00 suggested.** The delivered package gate is green on the package (A11), catches **8/8 semantic mutants** (A13) and fails a poisoned tree (A15) — while the *shipped* gate is red-by-scope and cannot accept a directory at all (A10). What remains is **two obfuscation classes plus one attribution gap** (A14): a 2–4 h port-and-close job (S0′), not the 3–5 h rebuild V10 priced.
2. **Two production-semantics defects are untouched by any gate work.** A data-less run consumes the day, writes a null snapshot, advances `last_success_day` and zeroes `consecutive_missed_days` (A4/A5) — and the watchdog was built to agree with it. That is S1.
3. **Concurrency is uncertified.** One green suite run today (A16) against 3 red in 26 (A17); per C28, attestation must quote N.
4. **One V10 blocker has silently cleared.** The registration payloads parse now (A25). It stays in the plan only as a verification step, not as work.
5. **The only things that have not moved in 11 days are the code (A8) and the operator's figures (A7).** 14+ plan documents, 868 dirty paths, 15 alert lines, zero readings.

**One-line status (09:42):** the routine runs, refuses duplicates and writes a real evidence trail; this morning it spent the production day on a null read, booked it a success, reset its own miss counter from 9 to 0 and silenced the watchdog it feeds; the shipped acceptance gate is red for reasons of scope while the delivered gate is green and catches every semantic mutant thrown at it plus the naive adversarial ones, losing only to two deliberately obfuscated mutations; the concurrency test flakes 1 run in 9, so one green suite run proves nothing; the registration payloads now parse but nothing is scheduled; and **no operator figure has ever been entered**.

---

## 1. Operational constraints (binding; every stage below is checked against these)

**The four operator rules** (operator numbering; a bare `R1`/`R2` is never printed — the shipped code's docstrings use the *inverted* numbering):

| Rule | Title |
|---|---|
| R1 | no automated earning action — zero earning/withdrawal calls, read-only transport |
| R2 | exactly one status read per operator-local (Europe/Berlin) calendar day |
| R3 | notify on earnings/status change, exactly once per change |
| R4 | human approval before ANY external action; no execution path exists |

**Carried from V9/V10:** C5 live evidence only · C6 no secrets · C7 never disturb the 868 pre-existing dirty paths, no destructive git · C8/C16 one implementation per job · C9 acceptance gate green before any registration · C10 venv Python 3.11.9 is the interpreter of record (`py -3` = 3.14.7 lacks `tzdata`) · C11 never spend the day before a reading exists · C12 name the port and the clock in every health claim · C13 a scheduled run must not inherit ambient `FREECASH_*` · C14 one attributable writer per `alerts.jsonl` day · C17 no plan may depend on an app-side component while the app may be closed · C18 single-sitting first actions · C19 "ran" ≠ "read" · C20 the monitor is a visibility instrument, not a revenue instrument · C21 the production root is not a scratch dir · C22 no machine-timed bursts · C23 name the gate file and its exit code · C24 a spent day is spent · C25 an escaping mutant is not evidence · C26 a payload must parse in its consumer (now satisfied for both payloads, A25) · C27 footprints expire.

**New in V11B:**

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C28** | **a flaky gate is a red gate** — no attestation may rest on one green run of a suite containing a concurrency test | A17: 3 of 26 full-suite runs failed `test_five_concurrent_runs_yield_one_winner` (`3 != 4`) = 11.5 %; A16: this pass's single run was green | the attestation quotes **N runs, the failure count and the failing test name** |
| **C29** | **name the rule that failed** — an *evasion* (exit 0, no rule fails) and a *misattributed catch* (non-zero exit via another rule) are different facts and are never merged into one number | A14: `adv3`/`adv4` exit 0 = evasions; `adv6` exits 1 **via R4 effect-pinning** while R1's import check still misses it | the mutant table names the failing rule per row; evasion rows and gap rows are labelled separately |
| **C30** | **concurrent-session evidence expires in minutes** — any quoted sibling artefact carries its mtime and is re-read at hand-off, never assumed; a filename may already be taken | A23: the shared `mutation-evidence/` dir was rewritten at 09:25–09:26 mid-pass, a new `DELEGATION-…-R3/` tree appeared at 09:27, and `V11` landed at 09:30 while this file was being drafted | the mtime is printed beside the artefact and it is re-read in the claiming pass |
| **C31** | **a document is not progress** — the count of plans/briefs/delegations is never evidence toward C9; only changed bytes plus a gate run count | A8: no code changed since **2026-09-20 06:59** while 14+ plan documents were produced | any "progress" sentence names the file whose bytes changed and the gate exit code |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**Ordering:** `S1 → S11 → S3 → S0′ → S1b → S4/S5/S6 → S7 → S8′ → S9′` (S8′/S9′ parallel; S10 separate and human-gated). One change between gate runs. A stage counts as complete only on output produced in the session that claims it. Never widen an allowlist and exempt a scanner hit in the same change.

**S1 — Make the day budget honest (C11 + C19). Highest value per hour; root cause unchanged, now with a production incident behind it.**
Expected Effort: ~40 min (O-1) / 3–5 h (O-2) / ~1 h (O-3) / 3–6 h (O-4). Time-to-Revenue: **none** (C20). Dependencies: none — pure code change plus tests.
First Concrete Action: write the **failing test first** — *"a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog print `WATCHDOG_MISSED_DAY`"* (`gate.py:32` `SUCCESS_OUTCOMES` contains `MONITOR_DEGRADED`; `gate.py:198` advances the ledger; `watchdog.py:33` keys coverage on it — A5) — then make coverage key on `data_available`, not on process completion.
Exit: a data-less run ⇒ no lock, `last_success_day` unchanged, miss counter preserved, `WATCHDOG_MISSED_DAY`; a day with a reading ⇒ exactly one lock, one snapshot, one `SKIP_DUPLICATE_DAY` on a second run.
Options: **O-1 two-phase accounting only (~40 min; remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES`, key coverage on `data_available` — the smallest change that makes the watchdog truthful)** · O-2 two-phase lock + accounting (3–5 h; an *attempt* record that only becomes a consumed day on a successful read — weakens "one read per day" to "one successful read per day", to be stated in the decision record) · O-3 wrapper pre-flight guard (~1 h; defence in depth only — **insufficient alone**, the 09-30 run *was* a wrapper path) · O-4 O-2 + O-3 · O-5 stay manual (0 h; unattended operation stays blocked — the safe default in force today).

**S11 — Close the 2026-10-01 incident and decide the day (operator-owned; no agent may execute this).**
Expected Effort: 10 min of decisions (+1 command if remediated). Time-to-Revenue: **same-day visibility if remediated**, none if accepted. Dependencies: a human decision; if remediated, do it **before** any run against the production root (C24).
First Concrete Action: record three answers in writing — (1) is the 08:53:46 run accepted as a documented C11/C19/C21 breach, (2) does `2026-10-01.lock` stay, (3) is a corrective note **appended** (never rewritten) to `alerts.jsonl`? If remediated: hash the root, `rm data/freecash-monitor/state/day-locks/2026-10-01.lock`, re-read the root, and state that the R2 record now understates what happened.
Exit: three answers recorded against this section with the before/after hash pair if anything was removed; every later status states that 2026-09-30 and 2026-10-01 were both spent by runs that read nothing.
Options: **O-A accept the breach, keep the lock (0 effort; one day lost; the record stays true — recommended default)** · O-B remediate (remove the lock + null snapshot after a human decision; ~10 min; recovers one read today; only defensible with an appended corrective note).

**S3 — First real operator reading. The fastest honest path to a number.**
Expected Effort: 1 h setup (once) + ~60 s/day. Time-to-Revenue: **same day, visibility only** (C20). Dependencies: S1 (else the first data-less run burns the next day — proven twice), S11 decided, C10 interpreter, a free day key (C24).
First Concrete Action: the operator logs into their own dashboard, appends **one** record to `data/freecash-monitor/state/operator-state.json` for the chosen free `day_key` with four integer-cent figures (`records: []` today — A7), then runs the entry point **once** through the 3.11.9 interpreter and quotes the `RUN_OK … outcome=INITIAL_BASELINE` line.
Exit: a day-1 baseline snapshot with `data_available:true`; a later day with a changed figure produces exactly one payload and one approval item.
Honest limit: every snapshot from this source is `degraded: true` by construction — a "no change" day only proves the same numbers were typed twice.

**S0′ — Consolidate the gate: port the delivered detectors into the shipped verifier, close the two evasions and the attribution gap. Blocking for C9.**
Expected Effort: **2–4 h** (1–2 h port + 1–2 h for `adv3`/`adv4`; the `adv6` R1 gap is a smaller third fix). Time-to-Revenue: none — this buys the verdict, not cash. Dependencies: the delivered gate `DELEGATION-2026-09-30/verifier/rule_gate.py` (present, green, 8/8 semantic catches — A11/A13) and the adversarial harness `DELEGATION-2026-10-01/verifier/mutation_harness.py` (present; **do not create a second one** — C8/C16).
First Concrete Action: add `--package <dir>` to `scripts/monitoring/rule_gate_verify.py` (argparse today `target [--run] [--json] [--json-out]`, exit **2** on `--package` — A10) and move the four detectors under it; then re-run the adversarial harness and require **every** row `detected=YES` **with the correct rule attributed** — `adv3-r4-getattr-exec` and `adv4-r1-conditional-backdoor` (exit 0 = evasions) are the acceptance bar, and `adv6-r1-new-socket-file` must fail **R1's** import check, not merely R4's pinning (C29).
Exit: `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** exit non-zero on every mutant with the correct rule named (C25/C29); exactly one gate file reachable from the repo root (C8/C16/C23).
Options: **O-A′ port + close both evasions + fix the `adv6` gap (2–4 h, recommended — A13 shows the detectors already work)** · O-B′ move `rule_gate.py` in as-is (0.5 h; ships a third gate *and* two live evasions — C8/C16/C25 risk) · O-C′ operator override of C9 in writing (0.2 h; removes the automatable gate) · O-D′ inline `gate.py`'s lock into the entry file (3–5 h; **rejected** — A10 shows R2–R4 would still fail; the shipped verifier is file-scoped by construction).

**S1b — Fix the concurrency flake (C28). New; blocks any unattended timer.**
Expected Effort: 1–3 h (diagnose the `3 != 4` race in `tests/test_r1_gate.py::ConcurrencyTests::test_five_concurrent_runs_yield_one_winner`; the production lock itself is atomic by syscall, so this looks like a harness/start-order race, not a lock defect). Time-to-Revenue: none. Dependencies: none; may run parallel to S0′ but must land **before** S7.
First Concrete Action: reproduce it — run the suite N=26 times with a pinned scratch root and capture the failing assertion (`…R2/workflow/evidence/suite-run18-fail.txt`, mtime 09:17, is the starting artefact; re-read it first per C30), then instrument the **writer count per run** rather than the winner count.
Exit: **26 consecutive green runs** (the same N that produced 3 red today) with the failure text absent; any future concurrency attestation quotes N and the failure count (C28).
Options: **O-a diagnose then fix (1–3 h)** · O-b assert the invariant at a lower level (0.5–1 h; count lock files, not winners — weaker, must be stated as such) · O-c mark the test `xfail` and record the flake as accepted residual (0.2 h; **rejected** — an xfail on the only concurrency proof removes the evidence entirely).

**S4 — Bridge Path B (the authenticated app path) into Path A.** Unchanged from V10; still gated on a human session.
Expected Effort: 4–8 h. Time-to-Revenue: 3–7 days of sight of the real account; **no revenue** (C20). Dependencies: a human starts the app and authenticates (A21: API `200`, **0 Electron processes**), the existing `startInteractiveLogin()` path, `checkAuthenticatedSession()` returning a live session, field names fixed in writing, **S1 resolved first**.
First Concrete Action: start the app, call the existing probe once through the app's own path, quote its evidence artefact, then write the four-field mapping (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`) into the shape `operator_state.py` already reads.
Do not: create a third monitor (C8/C16); add a provider host to `readonly_client.ALLOWED_PATHS`; extend `freecashMonitorAdapter.ts`, which enforces no rule.
Exit: one day's reading produced through Path B and consumed by Path A's existing source; `verify_readonly.py` still `forbidden=0 exempt=28`; `git status` shows no new monitor module.

**S5 — Delivery: prove the one sink.** Expected Effort 0.5–1 h · Time-to-Revenue none · Dependencies S3 or S4 · First Concrete Action: with the session unlocked, dispatch one real toast and record the label; then lock the session and repeat to observe the bounded-failure path. Blocked: email/SMS/webhook — no `SMTP_*`/`WEBHOOK_*` in the environment (A20), no mail tooling.

**S6 — Approval surface (R4), including the identity defect.**
Expected Effort: 2–4 h (+1 h if the provenance patch is adopted). Time-to-Revenue: none. Dependencies: S3 or S4 (the queue has never held an item; `approvals/` empty).
First Concrete Action: decide one enqueued item as a named human and quote the append-only row together with `execution_state` staying `NOT_EXECUTED`; then attempt a **machine-labelled** decider and record the refusal — noting the live guard is a **denylist** (`approval_queue.py:55`, `:153`; `OPERATOR_IDENTITY_ENV` absent — A18), so the refusal demonstrates the labeller, not the provenance.
Exit: every decision attributable to a human identity set outside the routine; a `PENDING` item survives any clock advance unchanged; the denylist's bypassability is either closed by the proposed `FREECASH_OPERATOR_IDENTITY` control or recorded as an accepted residual risk.

**S7 — Schedule Task A + Task B — handover only, human-registered.** Still blocked.
Expected Effort: 1–2 h plus the operator's approval. Time-to-Revenue: none. Dependencies: **C9 green (S0′), S1 (O-1 minimum), S1b (C28), S3, S2's pinned root**; the payload well-formedness gate (C26) is **already satisfied** (A25).
First Concrete Action: re-verify the two payloads parse (`ET.parse` exit 0 — measured OK this pass, mtime 09:04, daily `<StartBoundary>2026-10-02T09:00:00</StartBoundary>`, `<Arguments>` using `1>>`), confirm the pinned interpreter path inside `<Arguments>` is the venv 3.11.9 (C10), confirm `IgnoreNew` + `StartWhenAvailable` + restart-on-failure = **Do not restart**, then hand the operator the exact non-elevated `schtasks /Create /XML` text and **do not register it**. A sibling scheduler decision exists at `DELEGATION-2026-10-01/scheduler/SCHEDULER-DECISION-V2.md` (mtime 09:11) — read it, do not merge it blind (C30).
Exit: `ET.parse` exit 0 quoted for both payloads; `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and both policies; or an explicit recorded decision not to schedule, in which case the routine is described as *built and unverified in operation*. Verified today: 278 tasks, **0 Free Cash** (A19).

**S8′ — Alert attribution + burst coalescing (C14/C22).**
Expected Effort: 1–2 h now, ~2 min/day after. Time-to-Revenue: none. Dependencies: none (parallel).
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — **all 15 lines, including today's, carry none** (A6) — and coalesce missed-day catch-up so N missed days reach the operator as one payload. A sibling has staged a candidate diff (`…R2/delivery/proposed-alerts-writer-tag-and-catchup-coalesce.diff`, mtime 09:12): read it first (C30).
Exit: a new line's origin is identifiable from the line itself; the next bundle's baseline **includes** the 2026-09-21 unattributed line, the 09-30 burst and today's line, so nothing is laundered.

**S9′ — Deprecation index (delete nothing, C8/C16).**
Expected Effort: 1–2 h, read-only. Time-to-Revenue: none — false-compliance risk control. Dependencies: none.
First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py` (and its broken `config/freecash-crontab` entry pointing at a non-existent `/path/to/AgenticOS`), `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs` (**does not parse**: `node --check` fails at line 41), `server/scripts/verify-freecash-rules.mjs` (**DEPRECATED — do not cite as compliant**: 4/4 PASSED, exit 0, certifying a file that fails `node --check`) and `server/src/adapters/freecashMonitorAdapter.ts` (hardcoded `externalConnected: false`, absent from `runtimeRegistry`), each with its exact gate command, naming `monitoring/freecash/` as the single implementation and noting that the package-scope gate lives in two places until S0′ resolves it.
Exit: index exists; no file moved, edited or deleted.

**S10 — The revenue path (not the monitor; carried so it is not silently dropped, C20).**
Expected Effort: unknown (a human decision and a worker re-dispatch first). Time-to-Revenue: **the only stage with a direct revenue hypothesis, and it is unbounded.** Dependencies: a human decision, the app running, and a publication step that does not exist.
First Concrete Action (option R-a): with the app running, resume `bgtask-07a8154b0` in the UI — `blocked`, `resumable=0`, `result_text` empty, blocker "Backend restarted while this task was in progress…" (`inherited`, V9:V20; re-quote from the live UI before acting, C30). Recorded reality: `revenue_ledger_entries` 11 rows, newest verified `2026-08-19` (incl. `VERIFIED_REVENUE 19.0 EUR`), `treasury_ledger` 0 rows, all Shopify authorisation gates `resolved` — **the remaining blocker is a missing implementation step, not an approval**.
Options: **R-a resume/re-dispatch the mission (1–2 h, unknown TTR, needs app + human)** · **R-b implement the publication step (unbounded, weeks-to-revenue if it works)** · **R-c monitor only (0 h, 0 revenue — the honest default while S0′/S1 are red)**.

---

## 3. Options at a glance (decision → option → effort → time-to-revenue → dependencies → first concrete action)

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Day budget (S1) | **O-1 honest accounting only** | ~40 min | none (visibility) | none | failing test: a data-less run must not advance `last_success_day` |
| Day budget (S1) | O-2 two-phase lock + accounting | 3–5 h | none | none | failing test first, then attempt-then-consume |
| Day budget (S1) | O-3 wrapper pre-flight guard | ~1 h | none | S7 wrapper | guard on today's day key (insufficient alone) |
| Day budget (S1) | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | say plainly: unattended operation stays blocked |
| Incident (S11) | **O-A accept the breach, keep the lock** | 10 min | none | operator | record the three answers; keep 2026-10-01 spent |
| Incident (S11) | O-B remediate the day | 10 min + 1 command | **same-day visibility** | operator; S1 first | hash → `rm 2026-10-01.lock` → re-read → append a corrective note |
| Read source | **O4 operator-entered** (available now) | 0 h build + 0.5 h operator | **same day, visibility** | S1, S11, a free day key, pinned interpreter | append four integer-cent figures; expect `INITIAL_BASELINE` |
| Read source | **O6 Path-B bridged read (rank 1 target)** | 4–8 h | 3–7 days, visibility | app **running with a human session**, S1 | start the app; call `checkAuthenticatedSession()` once; quote the artefact |
| Read source | O1 loopback metrics route | 3–5 h + new route work | 1–2 days, workstation metrics only | a route that has never existed | `curl :4600/api/v1/status/metrics` (expect 404) |
| Read source | O2 provider read contract | 2–4 h if an account exists | 3 days–2 weeks | confirmed account, out-of-repo token (`provider_credentials`=0) | probe the documented endpoint with the operator's own token, `[REDACTED]` |
| Read source | O3 payout balance endpoint | 4–8 h + a rules decision | 1–4 weeks, unbounded if refused | a POST-minted token, which R1 refuses | probe unauthenticated; check for an enabled payouts key |
| Read source | O5 live-session automation in the routine | unknown | unknown | provider identity + session + credential | **BLOCKED** — keep off the critical path |
| Gate (S0′) | **O-A′ port + close 2 evasions + fix the R1 gap** | 2–4 h | none | delivered gate + adversarial harness (both present) | add `--package`; re-run the harness until 0 undetected **and** 0 misattributed (C29) |
| Gate (S0′) | O-B′ move the delivered gate in as-is | 0.5 h | none | none | ships a third gate + two live evasions (C8/C16/C25) |
| Gate (S0′) | O-C′ override C9 in writing | 0.2 h | none | operator sign-off | record the override; lose the automatable gate |
| Gate (S0′) | O-D′ inline the lock in the entry file | 3–5 h | none | none | **rejected** — A10 shows R2–R4 still fail |
| Concurrency (S1b) | **O-a diagnose then fix** | 1–3 h | none | none | reproduce `3 != 4` over 26 suite runs, then instrument |
| Concurrency (S1b) | O-b assert the lock count, not the winner | 0.5–1 h | none | none | state plainly that the invariant is weaker |
| Concurrency (S1b) | O-c `xfail` + accept the flake | 0.2 h | none | none | **rejected** — removes the only concurrency evidence |
| Delivery (S5) | toast only | 0.5–1 h | none | S3/S4 + a change | one real toast, label recorded locked/unlocked |
| Approval (S6) | record decisions; close or accept the denylist | 2–4 h (+1 h patch) | none | S3/S4 | decide one item as a named human; then test a machine label |
| Schedule (S7) | handover (no registration) | 1–2 h | none | C9, S1, S1b, S3 | re-parse both payloads; confirm the pinned interpreter; hand over the `schtasks` text |
| Attribution (S8′) | writer tag + catch-up coalescing | 1–2 h | none | none | tag every new line; read the staged diff first (C30) |
| Deprecation (S9′) | implementation index | 1–2 h | none | none | write the index; delete nothing |
| Revenue (S10) | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume `bgtask-07a8154b0` in the UI |
| Revenue (S10) | R-b implement the publication step | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| Revenue (S10) | R-c monitor only | 0 h | none | none | say plainly: visibility, not cash |

---

## 4. Blocked register

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | S0′ port | shipped verifier `R1=FAIL`, exit 1, no `--package` (exit 2) (A10) |
| **C25 "closed mutant set"** | S0′ | 2 evasions (`adv3-r4-getattr-exec`, `adv4-r1-conditional-backdoor`, both exit 0) + 1 misattributed catch (`adv6`, exit 1 via R4) (A14, C29) |
| Trustworthy concurrency attestation | S1b | 3 of 26 suite runs red, `3 != 4` (A17, C28) |
| Any reading for 2026-10-01 | S11 (human decision) + a lock removal | today's key was spent at 08:53:46 on a null read (A3–A5) |
| Unattended scheduling | S1 remedy **and** S1b **and** C9 | a data-less run spends the day *and* books it a success (A5); the concurrency proof flakes (A17); C26 is now satisfied (A25) |
| Trustworthy "monitor is alive" signal | S1 (C19) | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` → `watchdog.py:33` reports covered on a null snapshot (A5) |
| Live account status | the app running **with a human session** + the S4 bridge | listener `200`, **0 Electron processes** (A21); `provider_credentials = 0` |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured (A20); only the toast is implemented |
| Any withdrawal or earning action | R4 human approval surface | must never run unattended; no execution path exists by design, but the decider guard is a denylist (A18) |
| Strong R4 identity provenance | the unapplied `…-approval-identity-V2.diff` | `OPERATOR_IDENTITY_ENV` absent from the live file (A18) |
| In-app scheduler as a 24/7 mechanism | the desktop app process staying alive | no Electron process today (A21); `inherited`: last tick `2026-09-19T18:05Z` |
| Revenue mission `bgtask-07a8154b0` | worker re-dispatch after a lost worker | `blocked`, `resumable=0`, `result_text` empty (`inherited`) |
| Publication of shopify-verified revenue | implementation | €19 verified 2026-08-19; all authorisation gates `resolved`; nothing published since (`inherited`) |
| Writer attribution (C14) | a code change or a documented operating window | 15 lines, none carrying a writer key (A6) |
| A second/third state root's disposition | an operator decision | `data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor` all exist (A26) |
| Elevated task registration | elevated shell | non-elevated host by policy |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S1 remedy: O-1 / O-2 / O-3 / O-4 / O-5 | operator | every unattended run keeps spending a day and hiding it |
| D-2 | S11: accept or remediate 2026-10-01 | operator | the incident stays open and each new day inherits a spent key |
| D-3 | S0′ remedy: O-A′ / O-B′ / O-C′ | operator | C9 stays red, no task may be registered |
| D-4 | S1b remedy: O-a / O-b / O-c | operator | concurrency stays uncertified (C28) |
| D-5 | authoritative read source: O4 / O6 / O1 / O2 / O3 | operator | every snapshot stays `degraded: true` |
| D-6 | when the app is started, and by whom (C17) | operator | the only authenticated path stays unreachable |
| D-7 | `verify-freecash-rules.mjs` + `freecashMonitorAdapter.ts` + `freecash-daily-monitor.mjs`: label now, remove once unused | operator | a green 4/4 certifying an unparseable file stays available to any reader |
| D-8 | state-root disposition (S2) incl. `server/data/freecash-monitor/` | operator | two roots can silently diverge |
| D-9 | revenue: R-a / R-b / R-c | operator | the money path stays at €19 verified 2026-08-19 |
| D-10 | which of the concurrent plan documents is authoritative for the next session (V11 or this V11B, and the R2/R3 delegation plans) | operator | readers keep re-deriving state that changed minutes earlier (C30/C31) |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path, in any option. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session (C5). No modification of the 868 pre-existing dirty paths (C7). No second/third gate file, harness or monitor (C8/C16). **No further plan, brief or delegation may be counted as progress (C31).** No voice/Jarvis runtime path touched. No editing of the sibling delegation trees (`DELEGATION-2026-10-01`, `-R2`, `-R3`) — they are **read-only inputs**. **This routine produces visibility, not revenue** (C20): no option in §3 outside S10 has a revenue time-to-value.

## 7. Definition of done

1. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** exit non-zero on every mutant in the adversarial harness **with the correct rule named** (S0′, C25/C29); exactly one gate file reachable from the repo root (C23).
2. `python monitoring/freecash/tests/run_all.py` → **26 consecutive** runs `tests=52 failures=0 errors=0`, `tests_exit=0`, with the concurrency race asserted under full-suite load (S1b, C28); both R1 static scanners exit 0 at the pinned `exempt=28` (A9).
3. A data-less run leaves no day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, and is reported as `WATCHDOG_MISSED_DAY` (S1, C11+C19 — today's 08:53:46 run does the opposite, A5).
4. One real reading consumed, one real change notified exactly once, one approval item decided by a named human, `execution_state` still `NOT_EXECUTED` (S3/S4/S6).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S3/S7).
6. Watchdog: healthy day silent; uncovered day exactly one alarm; a multi-day catch-up arrives as **one** payload naming N and the day keys (S7/S8′, C22).
7. Every `alerts.jsonl` line attributable to a known writer (S8′, C14).
8. Both scheduled tasks' payloads re-parse (`ET.parse` exit 0, C26 — satisfied at 09:42, A25) and are quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule (S7).
9. No credential anywhere (C6); no unrelated dirty path modified (C7); no earning action performed by anything (R1).
10. Every stage states its Time-to-Revenue; no stage outside S10 claims a path to cash (C20); every "progress" sentence names changed bytes and a gate exit code (C31).
11. Every pass that touches the routine states its `FREECASH_DATA_ROOT` and quotes the production-root hash pair before/after (C21); every footprint claim and every quoted sibling artefact carries the timestamp of its window (C27, C30).
12. The 2026-09-30 and 2026-10-01 incident decisions are recorded with the operator's name (S11), and every later status sentence states that both days were spent by runs that read nothing.

**Honest one-line reading of 2026-10-01 (09:42):** the routine runs, refuses duplicates and writes a real evidence trail — and this morning it spent the production day on a null read, booked it a success, reset its miss counter from 9 to 0 and silenced its own watchdog; the shipped acceptance gate is red for reasons of scope while the delivered gate is green on the package and catches 8 of 8 semantic mutants plus naive adversarial ones, losing only to two deliberately obfuscated mutations and one misattributed catch; the concurrency test fails 1 run in 9, so a single green suite run proves nothing; the two registration payloads now parse but nothing is scheduled; no reading has ever been entered; and verified revenue still stands at €19 from 2026-08-19.
**Shortest honest path to a first real number:** `S1 (O-1, ~40 min) → S11 (O-A or O-B, 10 min) → S3 (operator-entered figures, same sitting)`.
**Shortest honest path to a *trustworthy* monitor:** that path plus `S0′ (2–4 h, O-A′) + S1b (1–3 h, O-a)` before any timer is registered.

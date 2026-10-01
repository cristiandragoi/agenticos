# WORKFLOW PLAN — Free Cash Finance Automation (V12C, 2026-10-01, evidence window 11:37:31 → 11:53 local)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a` · **Uncommitted paths:** **869 → 870** (`git status --porcelain | wc -l`, measured at 11:37 and again at 11:52) · **Host:** Windows 11 (de-DE), git-bash (MSYS), non-elevated
**Interpreter of record (C10):** `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → **Python 3.11.9**. `py -3` (3.14) has no `tzdata` and degrades the day key.
**Subject:** the once-daily, read-only status routine for Free Cash Finance Automation — package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`, state root `data/freecash-monitor/`.
**Assumption stated, not asked (the brief forbids clarifying questions):** "Free Cash Finance Automation" is the routine that already exists at that path; this plan is scoped to it and to the gate/verifier layer that certifies it. No new subsystem is proposed.

**Relationship to the other documents — third companion, supersedes nothing, edits nothing:**
- **Read as read-only inputs, all quoted with the mtime I read in this pass (C30):** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V12-2026-10-01.md` (**mtime 11:44**, 40 567 B) and `…-V12B-2026-10-01.md` (**mtime 11:47**, 37 045 B) — both were written by concurrent sessions into the two names this pass first tried to take; `…-V11B-2026-10-01.md` (**09:31**), `…-V11-…` (**09:30**), `DELEGATION-2026-10-01-R4/DELEGATION-BRIEF-R4.md` (**11:39**), `DELEGATION-2026-10-01-R3/**` (09:23–09:44), `DELEGATION-2026-10-01-R2/verifier/mutants/**` (09:15–09:18), `DELEGATION-2026-09-30/verifier/**` (09-30 21:09).
- **Stage vocabulary:** V12's `S1`–`S10` is adopted unchanged so the tree does not grow a third stage vocabulary. This file adds **one** stage (`S11`), and states per stage what it adds that V12 (11:44) and V12B (11:47) did not carry.
- **What V12C adds, each measured by me in this pass:** (i) the **largest single-pass concurrency measurement in the tree — N=20 suite runs, 2 red (10.0 %)**, failing test named (A21), where V12 carries N=1 and V12B N=6; (ii) my own **9-tree differential mutant loop against the delivered 09-30 gate**, with the failing rule named per row (A14); (iii) the **R3 gate run over the same 9 trees: exit 1 on all 9 including the canonical control** (A16) — an absolute verdict that cannot attribute anything, plus its green evidence tree now holding **0 entries** (A17); (iv) the **fork measurement** — the two R3 gate copies differ by **2 228 diff lines** and `detector_r1_earn.py` diverges across trees (A18), with a full checker inventory (A19); (v) the **two-sided watchdog measurement** — empty scratch ledger → `WATCHDOG_MISSED_DAY`, production null-read ledger → covered, mechanism pinned to `watchdog.py:33` / `gate.py:32-40,198` (A22); (vi) the **deprecated verifier is shipped inside the release bundle** (A29, `release/win-unpacked/resources/server/scripts/`).
- **Evidence standard (C5):** every §0 row is a command executed **in this pass**. Sibling artefacts are labelled `sibling` with their mtime. No PASS, hash or count is inherited.
- **Footprint (C21/C27):** this file is **new**; nothing edited, moved, renamed or deleted; no `git add/commit/stash/reset/restore/checkout/clean`; no `schtasks /Create`, no cron job (both only queried); no provider network call; no credential, token or secret read; nothing written under `data/freecash-monitor/**`. Every suite/gate invocation used a scratch root under `%LOCALAPPDATA%\Temp\fcplan12-*`. The production root's three hashes are **byte-identical at 11:37 and at 11:52** (A3). **Declared exception:** importing the package to run its suite wrote 8 `monitoring/freecash/__pycache__/*.pyc` at **11:36/11:40** while every `.py` mtime under that package is unchanged (2026-09-18/2026-09-20) — bytecode, not source (A31).

---

## 0. Live state, verified in this pass

| # | Command (executed 11:37:31–11:53) | Observed (raw) | What it establishes |
|---|---|---|---|
| A1 | `date`; `which python`; `python -V` | `Do,  1. Okt 2026 11:37:31` … `11:47:42`; `…/hermes-agent/venv/Scripts/python`; `Python 3.11.9` | clock + interpreter of record (C10) |
| A2 | `git rev-parse --abbrev-ref HEAD`; `--short HEAD`; `git status --porcelain \| wc -l` | `hermes-rescue-20260908`; `8f7463a`; **869** at 11:37 → **870** at 11:52 | the dirty set grows by documents only (C31); `monitoring/` and `data/freecash-monitor/` stay untracked (C7) |
| A3 | `sha256sum data/freecash-monitor/state/last-run.json alerts/alerts.jsonl state/operator-state.json`, **before and after** | `a287a902…293bf9` / `1b9c7c07…9399a8` / `be8becc3…3eca59c`, identical at 11:37 and 11:52 | this pass is **hermetic** (C21); same pin as 09:25 (V11B), 11:39 (V12) and 11:39 (V12B) — four consecutive passes |
| A4 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` | exactly **4** files, all mtime `08:53`: `state/day-locks/2026-10-01.lock` (0 B), `snapshots/2026-10-01.json` (518 B), `alerts/alerts.jsonl` (8 956 B), `state/last-run.json` (341 B) | nothing written to production between 08:53 and this pass (C27) |
| A5 | `ls -la state/day-locks/` | `2026-09-20.lock` (09-20 21:08), `2026-09-30.lock` (09-30 21:01), **`2026-10-01.lock` (08:53)** | **today's day key is spent** (C24); 09-30 and 10-01 were both consumed by runs that read nothing |
| A6 | `cat state/last-run.json` | `last_attempt_day=last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`** (was 9), `timezone=Europe/Berlin` | a null read is **booked as a success day** and reset the miss streak (C19 violated in production) |
| A7 | `cat snapshots/2026-10-01.json` | `source.data_available=false`, `read_ops=[]`, `degraded=true`, all four figures `null`, `raw_response_sha256=e3b0c442…b855` | the snapshot is a successfully written **null** — that hash is the sha256 of the empty string |
| A8 | `wc -l alerts/alerts.jsonl` + key union over all lines | **15** lines; keys = `day_key, dedupe_key, event_id, event_type, message, observed, severity, ts_utc`; newest `MONITOR_DEGRADED day_key=2026-10-01 ts_utc=2026-10-01T06:53:46Z` | **no writer key on any of the 15 lines** (C14) |
| A9 | `python -c "json.load(operator-state.json)"` | `record_keys=[schema_version, kind, note, how_to, records, template_record]`, **`records = []`** | **no operator figure has ever been entered** — 11th consecutive day with no reading |
| A10 | `ls -la monitoring/freecash/*.py` | newest mtime **`2026-09-20 06:59`** (`changedetect.py`, `watchdog.py`); `gate.py` `2026-09-18 07:32` | **zero code change in 11 days**; today's output is documents and gates (C31) |
| A11 | `python monitoring/freecash/verify_readonly.py`; `bash docs/…/verify-readonly.sh monitoring/freecash` (exit codes read **without a pipe**) | `forbidden=0 exempt=28 missing_targets=0` / `PASS`; exit **0**; exit **0** | both R1 scanners green at the pinned baseline **28** |
| A12 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` and `… monitoring/freecash --package` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`, exit **1**; `error: unrecognized arguments: --package`, exit **2** | the **shipped** verifier is still red and still file-scoped (mtime `2026-09-18 07:28`, unchanged) — S2 has not landed |
| A13 | `python docs/…/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash --workdir <temp>` | `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` · `VERDICT: COMPLIANT` · exit **0** | the **delivered 09-30 gate** is green on the live package (C5, re-measured) |
| A14 | **my own 9-tree loop**: same gate × `DELEGATION-2026-10-01-R2/verifier/mutants/*/pkg` | `canonical-control` exit **0** PASS; `r1-a-lock-removed` exit 1 **R2=FAIL**; `r1-b-lock-nonbinding` 1 **R2**; `r2-a-post-cashout-on-read-path` 1 **R1**; `r2-b-urllib-write-path` 1 **R1+R4**; `r3-a-baseline-is-current` 1 **R3+R4**; `r3-b-sub-dollar-threshold` 1 **R3+R4**; `r4-a-nonhuman-decider-accepted` 1 **R4**; `r4-b-arms-on-approve` 1 **R4** | **8/8 semantic mutants caught with the correct rule named**, control clean — this pass's own differential table (C25/C29) |
| A15 | `python DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py --package monitoring/freecash` (mtime **09:36**) | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=FAIL` · `NOT COMPLIANT -- rule(s) violated: R1, R4` · exit **1**; failing checks: `[R1.3] gate.SUCCESS_OUTCOMES contains 'MONITOR_DEGRADED' (gate.py:32) AND run_daily_check.py assigns outcome='MONITOR_DEGRADED' on the data_available=False branch`; `[R4.3b] guard is a DENYLIST only (['NON_HUMAN_DECIDERS','who'])` | the R3 gate is **red on the live package by design**: it encodes the two live defects (C19 day budget, R4 identity) as checks. Three gates, three verdicts on the same bytes (A12/A13/A15) |
| A16 | same R3 gate × the **same 9 mutant trees** | exit **1** on **all 9**, `canonical-control` included (`R1=FAIL R4=FAIL` on every row) | in absolute mode the R3 gate **cannot discriminate** across trees: its red rows are dominated by the two baseline checks. Cross-tree comparison of absolute verdicts is invalid; only per-check differentials against a control run in the same pass attribute anything (C39) |
| A17 | `rule_gate_r3.py --package … --workdir <temp>`; `ls -A R3/gate/scratch/clean` | `error: unrecognized arguments: --workdir`, exit **2**; **0 entries** | the R3 gate takes no throwaway evidence dir (its invocation writes into its own tree), and its green evidence (`gate/clean-gate-run.txt`, `sibling`, mtime **09:37**) points at a scratch tree that is **empty now** — the verdict is not replayable from the artefact (C42) |
| A18 | `diff -q R3/gate/rule_gate.py R3/verifier/rule_gate_r3.py`; `diff -q 09-30/detectors/detector_r1_earn.py R3/gate/detectors/detector_r1_earn.py` | **DIFFER — 2 228 diff lines** (69 598 B @09:35 vs 30 001 B @09:36); detectors **DIFFER** | the port source is **already forked inside one tree**: two copies of the same gate, divergent bytes, and an R1 detector that differs between the 09-30 and R3 trees — no single artefact can be named the gate of record (C40) |
| A19 | repo-wide inventory (my find) | gate scripts: `scripts/monitoring/rule_gate_verify.py` (09-18 07:28) · `DELEGATION-2026-09-30/verifier/rule_gate.py` (09-30 21:09) · `R3/gate/rule_gate.py` (09:35) · `R3/verifier/rule_gate_r3.py` (09:36) · `DELEGATION-2026-10-01/verifier/verify_freecash_rules.py` (09:07). Harnesses: `DELEGATION-2026-10-01/verifier/mutation_harness.py`, `R3/gate/mutation_harness_r3gate.py`, `R3/gate/probe_mutants.py`, `R3/verifier/mutation_harness_r3.py` (+`DELEGATION-2026-09-21/evidence/harness.py`). Scanners: `monitoring/freecash/verify_readonly.py`, `docs/…/verify-readonly.sh`. **New in this pass:** `DELEGATION-2026-10-01-R4/gate/{build_trees.py 11:44, run_matrix.py 11:47, trees-manifest.json 11:44}` + **12 trees** (`adv1…adv6`, `mv1…mv4`, `repaired`, `shipped`) | **5 gate scripts, 5 harnesses, 2 scanners, 12 more mutant trees** in flight while the count was supposed to go **down** (C8/C16); checker count is now a defect metric (C41) |
| A20 | `FREECASH_DATA_ROOT=<scratch> python monitoring/freecash/tests/run_all.py` (timed) | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit **0**, **13.5 s** | offline suite green in this run (N=1 — not attestation) |
| A21 | **N=20** suite runs, one fresh scratch root per run, this pass | **2 red (10.0 %)** — runs 1 and 6, exit 1, failing test `test_r1_gate.ConcurrencyTests.test_five_concurrent_runs_yield_one_winner`, `AssertionError: 3 != 4`; 18 green | the flake is **reproduced independently at N=20** (sibling: 3 of 26 at 09:17; V12B: 6/6 green at 11:39). A single green run proves nothing (C28) |
| A22 | scratch-run output vs production ledger vs source | scratch (empty ledger): `WATCHDOG_MISSED_DAY 2026-10-01 last_attempt_day=None last_outcome=None coverage=NOTIFIED`; production: `last_attempt_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`; `watchdog.py:33` `covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES`; `gate.py:32-40` `SUCCESS_OUTCOMES` contains `MONITOR_DEGRADED`; `gate.py:198-199` advances `last_success_day` for it | **two-sided proof of the C19 defect**: the alarm fires only when the ledger is *empty*, never when a day was spent on no data. The watchdog is truthful about absence, silent about a null read |
| A23 | `grep -c OPERATOR_IDENTITY_ENV monitoring/freecash/approval_queue.py`; `grep -n NON_HUMAN_DECIDERS` | `0` (absent); defined `:55`, applied `:153` | the R4 identity remedy is **proposed, not applied** (C14/C42 — proposal lives at `R3/identity/proposed/**`, mtime 09:32–09:33) |
| A24 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash`; `hermes cron list` | **278** rows; **0** Free Cash; `No scheduled jobs.` | nothing is scheduled; nothing has to be undone before S6 |
| A25 | `env \| grep -icE "FREECASH\|SMTP_\|WEBHOOK_"` | **0** | C6/C13 hold: no credential or sink in the ambient environment; email/webhook alerting remains unavailable |
| A26 | `curl -m5 localhost:4600/api/health`; `127.0.0.1:3001/health`; `tasklist \| grep -ic electron`; `node.exe` | **4600=000**; **3001=000**; electron **0**; node **10** | the listener that answered `200` at 09:29 (V11B) is **refused at 11:37** — the authenticated app path is unreachable *and* the inherited "200" row has expired (C17/C27) |
| A27 | `ET.parse` both `DELEGATION-2026-10-01/scheduler/DECISION-V2-*.xml` + raw-`&` scan | both **PARSE OK**, `raw_ampersands=0`; `<Arguments>` → `/c C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state 1>> …` (watchdog payload likewise) | C26 is satisfied in this pass for both payloads, and the pinned interpreter is the 3.11.9 venv — only the hand-over step remains |
| A28 | `ls -d data/freecash data/freecash-monitor server/data/freecash-monitor` | all three exist | the state-root ambiguity (S2) is still unresolved: two roots can diverge silently |
| A29 | `ls -la release/win-unpacked/resources/server/scripts/` | `verify-freecash-rules.mjs` (**2026-09-11 11:52**, 3 034 B) and `freecash-daily-monitor.mjs` (**2026-09-11 10:21**, 10 474 B) are **inside the shipped bundle** | the deprecated verifier whose `4/4 PASSED` certifies a file that fails `node --check` is **packaged and shipped**, not just present in `server/scripts/` (C43) |
| A30 | `find docs -newermt "2026-10-01 09:44" -name "*.md"` (re-run at 11:47) | `V12` **11:44**, `R4/scheduler/TRIGGER-DECISION-PACKET.md` **11:45**, `docs/shopify-channel-verification-2026-10-01.md` **11:45**, `V12B` **11:47**; R4 tree files 11:39–11:47 | **≥3 concurrent sessions** wrote into these directories and `…-V12-…` and `…-V12B-…` were both taken before this file was written (C30); every sibling row above expires |
| A31 | `find monitoring/freecash -type f -newermt "2026-10-01 11:30"`; `ls -la monitoring/freecash/*.py` | **8 × `__pycache__/*.pyc` at 11:36/11:40**; no `.py` newer than `2026-09-20 06:59` | importing the package writes bytecode **into the package**: any footprint claim of "nothing written under `monitoring/freecash/**`" is false unless `PYTHONDONTWRITEBYTECODE=1` is set or the exception is named (C35) |

### 0.1 What this pass changes in the picture (read before any other plan)

1. **The flake is now measured, not anecdotal.** N=20, 2 red, named test, named assertion (A21) — alongside V12B's N=6 green. Two passes, two different single-run outcomes: the suite's green line is a coin-flip on ~10 % of runs, so *any* attestation must quote N and the red count (C28).
2. **There are three gates with three verdicts on identical bytes, and a fourth/fifth being built.** Delivered 09-30 gate `COMPLIANT exit 0` (A13); R3 gate `NOT COMPLIANT R1+R4 exit 1` (A15); shipped verifier `R1=FAIL exit 1` and unable to accept a directory at all (A12); R4 has opened a new matrix with 12 trees (A19). The R3 gate is red on the live package *because it checks the two live defects* — so "which gate is green" is the wrong question; the right one is **which per-rule verdicts match the reproduced evidence** (A22, and the repaired-control row in its own table).
3. **Absolute verdicts do not travel across trees.** My run of the R3 gate over the 9 mutant trees is red on the control too (A16). Attribution requires a control row and a newly-failed-check column, run in the same pass — otherwise a baseline defect is misread as detector coverage (C39).
4. **The port source is forked before the port starts.** 2 228 diff lines between two same-name gate copies and a divergent R1 detector (A18) — the port cannot begin from "the gate" until one artefact is named and hashed (C40).
5. **The watchdog cannot see today's failure, and I can show both sides.** Empty ledger → alarm; null-read ledger → covered (A22). Repaired together with S1, not separately.
6. **What has not moved in 11 days: the code (A10) and the operator's figures (A9).** 15 alert lines, 0 readings, 869 → 870 dirty paths, 20+ plan documents.

**One-line status (11:53):** the routine still runs, refuses duplicate days and writes a real evidence trail — and this morning it spent the production day on a null read, booked it a success, dropped its miss streak 9 → 0 and silenced its own watchdog; the defect has a two-sided measurement now; the concurrency proof fails 2 of 20 runs; three gates return three verdicts on the same bytes while a fourth matrix is being built and the port source is already forked by 2 228 diff lines; the registration payloads parse but nothing is scheduled; the app path is refused two hours after siblings measured it healthy; and no operator figure has ever been entered.

---

## 1. Operational constraints (binding; every stage below is checked against these)

**The four operator rules** — printed by **title** with both numberings, because the shipped docstrings use the *inverted* numbering (`gate.py:1` calls the once-per-day rule `R1`, `readonly_client.py:1` calls no-earning `R2`):

| Operator # | Title | Enforced by |
|---|---|---|
| R1 | **no automated earning action** — read-only transport only | `readonly_client.py` allowlist + `verify_readonly.py` static pass |
| R2 | **exactly one status read per operator-local (Europe/Berlin) calendar day** | atomic `O_CREAT\|O_EXCL` day lock in `gate.py`, acquired before the read |
| R3 | **notify on earnings/status change, exactly once per change** | prior snapshot loaded before the new one is written; dedupe key |
| R4 | **human approval before ANY external action; no execution path exists** | enqueue-only queue, `execution_state=NOT_EXECUTED`, `expires_at_utc=None` |

**Carried (unchanged, by title):** live-evidence-only (C5) · no secrets (C6) · never disturb the pre-existing dirty paths / no destructive git (C7) · one implementation per job (C8/C16) · a green acceptance gate before any registration (C9) · the 3.11.9 venv is the interpreter of record (C10) · never spend the day before a reading exists (C11) · name the port and the clock in every health claim (C12) · a scheduled run must not inherit ambient `FREECASH_*` (C13) · one attributable writer per `alerts.jsonl` day (C14) · no plan depends on a component that may be closed (C17) · single-sitting first actions (C18) · "ran" ≠ "read" (C19) · the monitor is a visibility instrument, not a revenue instrument (C20) · the production root is not a scratch dir (C21) · no machine-timed bursts (C22) · name the gate file and its exit code (C23) · a spent day is spent (C24) · an escaping mutant is not evidence (C25) · a payload must parse in its consumer (C26) · footprints expire (C27) · a flaky gate is a red gate (C28) · name the rule that failed (C29) · concurrent-session evidence expires in minutes (C30) · a document is not progress (C31).

**New in V12C:**

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C35** | **bytecode is a write into the package** — a footprint claim of "nothing written under `monitoring/freecash/**`" is false for any session that imports the package | A31: 8 `__pycache__/*.pyc` written at 11:36/11:40 by this session's own imports, no `.py` touched | the footprint statement names the `.pyc` files **or** the invocation sets `PYTHONDONTWRITEBYTECODE=1`; a delegation rule forbidding writes there must name the exemption |
| **C39** | **an absolute verdict is not an attribution** — a gate whose check set includes known baseline defects is red on every tree, including an unmutated control, so its exit code measures the baseline, not the mutation | A16: the R3 gate exits 1 on all 9 trees including `canonical-control`, while its own table lists `CTRL newly_failed=NONE` | every mutant table carries a **control row** and a **newly-failed-check column**, all rows run in the claiming pass with the tree hash quoted |
| **C40** | **the port source must be one named, byte-identical artefact** — a gate that exists in two divergent copies cannot be the gate of record | A18: `R3/gate/rule_gate.py` vs `R3/verifier/rule_gate_r3.py` differ by 2 228 diff lines; `detector_r1_earn.py` differs between the 09-30 and R3 trees | the plan names gate path + `sha256` + mtime; the port starts only after the other copies are labelled deprecated |
| **C41** | **checker count is a defect metric** — adding a gate, harness or tree set is not progress; the exit criterion is a reduction to one | A19: 5 gate scripts, 5 harnesses, 2 scanners, 12 new R4 trees, all inside one 11-day window with 0 lines of routine code changed (A10) | each stage states whether the checker count goes up or down; up is refused |
| **C42** | **green-on-a-throwaway-tree expires with the tree** — a verdict whose input tree no longer exists is unverifiable | A17: R3's `clean-gate-run.txt` (09:37) is COMPLIANT against `gate/scratch/clean`, which holds **0 entries** now | every quoted verdict names its input tree, that tree's hash, and a replay command runnable in the claiming pass |
| **C43** | **the shipped bundle is part of the audit surface** — deprecation that stops at `server/scripts/` leaves the packaged copy live | A29: `release/win-unpacked/resources/server/scripts/` still ships `verify-freecash-rules.mjs` (09-11) certifying `freecash-daily-monitor.mjs`, which fails `node --check` | the deprecation index lists the in-bundle paths and the bundle hash; nothing deleted (C8/C16) |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**Ordering:** `S1 → S3 → S2 → S7 → S4/S5/S6 → S8 → S9 → S11`; `S10` separate and human-gated. One change between gate runs. A stage is complete only on output produced in the session that claims it (C30). Never create a second gate, harness, monitor or state root (C8/C16) — and per C41 the checker count must fall, not rise.

**S1 — Make the day budget honest (C11 + C19). Highest value per hour; the defect now has a two-sided measurement.**
Expected Effort: ~40 min (O-1) / 3–5 h (O-2) / ~1 h (O-3) / 3–6 h (O-4). Time-to-Revenue: **none** (C20). Dependencies: none.
First Concrete Action: reuse the **existing** failing test staged by the sibling (`DELEGATION-2026-10-01-R3/daybudget/failing-test-first/test_daybudget_data_less.py`, mtime 09:44 — 8 180 B; its raw red/green runs are `daybudget/raw/02-red-against-shipped.txt`, `04-green-against-remedy.txt`) — do **not** author a second one (C8/C16) — and make it cover A22's two sides: a run with `data_available=False` must advance neither `last_success_day` nor `day-locks/`, must not reset `consecutive_missed_days`, and `watchdog.py:33` must report it as a miss (`MONITOR_DEGRADED` removed from `gate.SUCCESS_OUTCOMES`, `gate.py:32-40`).
Exit: a data-less run ⇒ no lock, `last_success_day` unchanged, miss counter preserved, `WATCHDOG_MISSED_DAY`; a day with a reading ⇒ exactly one lock, one snapshot, one `SKIP_DUPLICATE_DAY` on a second run; the R3 gate's `[R1.3]` check flips to PASS (A15).
Options: **O-1 accounting only (~40 min)** · O-2 two-phase lock + accounting (3–5 h; weakens "one read per day" to "one successful read per day" — state it in the decision record) · O-3 wrapper pre-flight (~1 h; **insufficient alone** — the 09-30 run *was* a wrapper path) · O-4 O-2+O-3 · O-5 stay manual (0 h; unattended operation stays blocked).

**S3 — First real operator reading. The fastest honest path to a number.**
Expected Effort: ~1 h setup + ~60 s/day. Time-to-Revenue: **same day, visibility only** (C20). Dependencies: a free day key (C24 — 2026-10-01 is spent, A5), the 3.11.9 interpreter, `S1` preferred but not blocking for a *single* attended read.
First Concrete Action: the operator logs into their own dashboard and appends **one** record with four integer-cent figures to `data/freecash-monitor/state/operator-state.json` (`records: []` today, A9), then runs the entry point **once** and quotes the outcome line.
Exit: a day-1 baseline snapshot with `data_available:true`; a later day with a changed figure produces exactly one payload and one approval item; the new `alerts.jsonl` line carries a writer key (S8).
Honest limit: every snapshot from this source is `degraded:true` by construction — a "no change" day only proves the same numbers were typed twice.

**S2 — Name the acceptance gate of record (C9/C23/C39/C40/C41/C42).**
Expected Effort: 1–2 h for the divergence matrix; **2–4 h** only if the port also closes the obfuscation classes. Time-to-Revenue: none — this buys the verdict. Dependencies: the 5 gate scripts and the 2 mutant-tree sets listed in A18/A19; **create no new gate, harness or tree set** (C8/C16/C41).
First Concrete Action: build the matrix **gate × {live package, `R2/mutants/canonical-control`, each of the 8 mutants, `R4/gate/trees/repaired`, `R4/gate/trees/shipped`}** with exit code **and failing rule per row**, a control row, and each tree's hash — i.e. exactly the A14 loop, extended, run in one pass; then explain the A15/A16 contradiction at `file:line` and name the single gate whose per-rule verdicts match A14 + A22.
Exit: **one** gate reachable from the repo root (C23/C41); it exits **0** on the S1-repaired copy and non-zero on all mutants with the correct rule named (C25/C39); the other copies are labelled deprecated with a hash, not deleted; every quoted verdict is replayable (C42).
Options: **O-A′ port the R3 gate after de-forking it (C40) and adopt it as the entry, re-pointing `scripts/monitoring/rule_gate_verify.py` (2–4 h)** · O-B′ adopt the delivered 09-30 gate as-is (0.5 h; it is green on the live package, i.e. blind to both live defects — A13 vs A15; acceptable only with those two defects named as open) · O-C′ keep the shipped verifier and accept a file-scoped gate (0 h; A12 shows `R1=FAIL`, so C9 stays red and nothing may be registered) · O-D′ operator override of C9 in writing (0.2 h; loses the automatable gate).

**S7 — Concurrency flake (C28). Now measured at N=20.**
Expected Effort: 1–3 h (diagnose `3 != 4` in `tests/test_r1_gate.py::ConcurrencyTests`; the production lock is atomic by syscall, so this looks like a harness/start-order race, not a lock defect). Time-to-Revenue: none. Dependencies: none; must land **before** any timer (S6).
First Concrete Action: instrument the **writer count per run** rather than the winner count, using A21's two red outputs as the starting artefacts (this pass, runs 1 and 6, with the assertion text captured); keep running in a pinned scratch root.
Exit: **26 consecutive green runs** (the N that produced 3 red at 09:17) with the failure text absent; every future concurrency attestation quotes N, the red count and the failing test name.
Options: **O-a diagnose then fix (1–3 h)** · O-b assert lock-file count, not winners (0.5–1 h; weaker — say so) · O-c `xfail` (0.2 h; **rejected** — removes the only concurrency evidence).

**S4 — R4 identity: allowlist instead of denylist.**
Expected Effort: ~1 h to apply the staged patch + proof run. Time-to-Revenue: none. Dependencies: `R3/identity/proposed/approval-allowlist.patch` + `human-deciders.example.json` (mtime 09:32–09:33); the live file still has `OPERATOR_IDENTITY_ENV` absent and the denylist at `:55`/`:153` (A23).
First Concrete Action: apply the staged diff under a single reviewable commit-free patch, then run `R3/identity/test_identity_allowlist.py` and require **both directions in one run**: `hermes-agent`/`assistant`/`claude` **refused**, `<operator name>` **accepted**, `execution_state` still `NOT_EXECUTED`.
Exit: the R3 gate's `[R4.3b]` check flips to PASS; `expires_at_utc=None` survives every clock advance; a machine label is refused (C29).
Options: **O-A apply the staged allowlist (~1 h)** · O-B keep the denylist and record the bypassability as accepted residual (0 h; the safety property holds, the provenance property does not) · O-C both (denylist removed **and** an allowlist file under `state/`) — preferred, ~1.5 h.

**S5 — Make R3 falsifiable for a human, offline.**
Expected Effort 2–4 h · Time-to-Revenue none · Dependencies `S3` · First Concrete Action: one recorded change pair in a scratch root through `changedetect` → `notify` and quote the single dedupe key. Exit: exactly one notification per change, none on a repeat.

**S6 — Trigger decision packet; register nothing.**
Expected Effort 1–2 h + the operator's approval. Time-to-Revenue: none. Dependencies: **C9 green (S2), S1, S7, S3**; C26 already satisfied — both payloads parse in this pass with the 3.11.9 venv pinned and `1>>` redirection (A27). A sibling packet exists at `R4/scheduler/TRIGGER-DECISION-PACKET.md` (mtime **11:45**) — read it, do not merge blind (C30).
First Concrete Action: re-run the `ET.parse` check in the hand-over pass, confirm `IgnoreNew` + `StartWhenAvailable` + restart-on-failure = **Do not restart**, then hand the operator the exact non-elevated `schtasks /Create /XML` text and **do not register it**. Verified today: 278 tasks, 0 Free Cash, no cron (A24).
Exit: parse exit 0 quoted for both payloads; or an explicit recorded decision not to schedule, in which case the routine is described as *built and unverified in operation*.

**S8 — Alert attribution + catch-up coalescing (C14/C22).**
Expected Effort 1–2 h now, ~2 min/day after · Time-to-Revenue none · Dependencies none (parallel). First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — all 15 lines, including today's, carry none (A8) — and coalesce missed-day catch-up so N missed days arrive as one payload. Exit: a line's origin is identifiable from the line itself; the baseline bundle **includes** the 09-21 unattributed line, the 09-30 burst and today's line so nothing is laundered.

**S9 — Implementation index + release-bundle deprecation (C43); delete nothing.**
Expected Effort 1–2 h, read-only · Time-to-Revenue none — false-compliance risk control. Dependencies none. First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs` (**fails `node --check` at line 41**), `server/scripts/verify-freecash-rules.mjs` (**DEPRECATED — do not cite as compliant**), `server/src/adapters/freecashMonitorAdapter.ts` (hardcoded `externalConnected:false`, absent from `runtimeRegistry`) — **and the packaged copies in `release/win-unpacked/resources/server/scripts/`** (A29) — each with its gate command and its hash. Exit: index exists; no file moved, edited or deleted.

**S10 — The revenue path (not the monitor; carried so it is not silently dropped, C20).**
Expected Effort unknown (a human decision and a worker re-dispatch first). Time-to-Revenue: **the only stage with a direct revenue hypothesis, and it is unbounded.** Dependencies: a human decision, the app running (A26: listener refused right now), and a publication step that does not exist.
First Concrete Action (O-R-a): with the app running, resume `bgtask-07a8154b0` in the UI — `blocked`, `resumable=0`, `result_text` empty (`inherited` from V9/V11B; re-quote from the live UI before acting, C30). Recorded reality: `revenue_ledger_entries` 11 rows, newest verified `2026-08-19` (`VERIFIED_REVENUE 19.0 EUR`), `treasury_ledger` 0 rows, all Shopify authorisation gates `resolved` — **the remaining blocker is a missing implementation step, not an approval**.

**S11 — Reconcile the footprint claim inside the routine's own fence (C35). New in V12C.**
Expected Effort: 15–30 min. Time-to-Revenue: none. Dependencies: none; must land before any delegation that forbids writes under `monitoring/freecash/**` (several existing briefs do).
First Concrete Action: state in the operating note whether the routine's test invocations set `PYTHONDONTWRITEBYTECODE=1`; if not, name `monitoring/freecash/__pycache__/*.pyc` as an allowed write and quote the `find … -newermt` output (A31) that any future pass must not read as a source change.
Exit: a future pass can say "nothing written under `monitoring/freecash/**` except bytecode" truthfully, and a `find -newermt` hit on a `.pyc` is never reported as a code change.

---

## 3. Options at a glance (decision → option → effort → time-to-revenue → dependencies → first concrete action)

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Day budget (S1) | **O-1 honest accounting** | ~40 min | none (visibility) | none | make the **existing** staged failing test cover A22's two sides; drop `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` |
| Day budget (S1) | O-2 two-phase lock + accounting | 3–5 h | none | none | attempt-then-consume; state the weakened R2 wording |
| Day budget (S1) | O-3 wrapper pre-flight guard | ~1 h | none | S6 wrapper | guard on today's day key (**insufficient alone**) |
| Day budget (S1) | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | say plainly: unattended operation stays blocked |
| Gate of record (S2) | **O-A′ de-fork (C40) then port the R3 gate + re-point the shipped verifier** | 2–4 h | none | A14/A19 artefacts; no new gate | matrix `gate × 9 trees` with control row + failing rule per row; after that, hash the single named gate |
| Gate of record (S2) | O-B′ adopt the 09-30 gate as-is | 0.5 h | none | none | record that it is blind to the two live defects (A13 vs A15) |
| Gate of record (S2) | O-C′ keep the shipped verifier | 0 h | none | none | accept `R1=FAIL` → C9 stays red, nothing may be registered |
| Gate of record (S2) | O-D′ operator override of C9 | 0.2 h | none | operator sign-off | record the override; lose the automatable gate |
| Concurrency (S7) | **O-a diagnose then fix** | 1–3 h | none | none | instrument writer count per run from A21's red outputs |
| Concurrency (S7) | O-b assert the lock count | 0.5–1 h | none | none | state plainly that the invariant is weaker |
| Concurrency (S7) | O-c `xfail` | 0.2 h | none | none | **rejected** — removes the only concurrency evidence |
| Identity (S4) | **O-C denylist removed + allowlist file** | ~1.5 h | none | staged patch (09:32) | both directions proven in one run (`hermes-agent` refused, operator accepted) |
| Identity (S4) | O-A apply the staged patch only | ~1 h | none | same | as above, minus the allowlist file |
| Identity (S4) | O-B accept the denylist as residual risk | 0 h | none | none | record that provenance, not safety, is the gap |
| Read source | **operator-entered (available now)** | 0 h build + 0.5 h operator | **same day, visibility** | a free day key, pinned interpreter | append four integer-cent figures; expect `INITIAL_BASELINE` |
| Read source | Path-B bridged read (`R4` stream **S**) | 4–8 h | 3–7 days, visibility | app **running with a human session** (A26 refused now) | start the app; call `checkAuthenticatedSession()` once; quote the artefact |
| Read source | loopback metrics route | 3–5 h + new route | 1–2 days, workstation metrics | a route that never existed | `curl :4600/api/v1/status/metrics` (expect refusal, as A26) |
| Read source | provider read contract | 2–4 h if an account exists | 3 days–2 weeks | confirmed account, out-of-repo token | probe the documented endpoint with the operator's token, `[REDACTED]` |
| Delivery (S5) | toast only | 0.5–1 h | none | S3/S4 + a change | one real toast, label recorded locked/unlocked |
| Trigger (S6) | handover, no registration | 1–2 h | none | C9, S1, S7, S3 | re-parse both payloads; confirm the pinned interpreter; hand over the `schtasks` text |
| Attribution (S8) | writer tag + catch-up coalescing | 1–2 h | none | none | tag every new line; do not rewrite the 15 existing |
| Deprecation (S9) | implementation index incl. the shipped bundle | 1–2 h | none | none | write the index; delete nothing (C43) |
| Footprint (S11) | name the bytecode write or set `PYTHONDONTWRITEBYTECODE=1` | 15–30 min | none | none | quote A31; rule on the invocation |
| Revenue (S10) | O-R-a resume the mission | 1–2 h | unknown | app running + human decision | resume `bgtask-07a8154b0` in the UI |
| Revenue (S10) | O-R-b implement the publication step | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| Revenue (S10) | O-R-c monitor only | 0 h | none | none | say plainly: visibility, not cash |

---

## 4. Blocked register

| Item | Blocked on | Reason (re-verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | S2 | shipped verifier `R1=FAIL` exit 1 and no `--package` (exit 2) (A12); three verdicts on identical bytes (A13/A15) |
| A gate of record existing at all | S2 + C40 | the R3 gate exists in two copies differing by 2 228 diff lines; detectors diverge across trees (A18) |
| Closed mutant set (C25) | S2 | only the **differential** table attributes (A14 for the 09-30 gate; A16 shows the R3 gate's absolute verdicts attribute nothing) |
| Replayable green evidence | C42 | the R3 gate's COMPLIANT run names a scratch tree that now holds 0 entries (A17) |
| Trustworthy concurrency attestation | S7 | **2 of 20** runs red this pass, `3 != 4`; sibling 3 of 26; V12B 6/6 green (A21) |
| Any reading for 2026-10-01 | a human decision + a lock removal | today's key was spent at 08:53:46 on a null read (A4–A6); only a human may remove the lock, and that falsifies the day record unless a corrective note is **appended** |
| Trustworthy "monitor is alive" signal | S1 | `watchdog.py:33` keys coverage on `last_outcome ∈ SUCCESS_OUTCOMES`, which contains `MONITOR_DEGRADED`; production books the null read as covered (A22) |
| Live account status | the app running **with a human session** + S4's source decision | `:4600` **refused** at 11:37 (A26), `provider_credentials = 0` |
| Email / SMS / webhook alerting | credentials or mail tooling | 0 `SMTP_*`/`WEBHOOK_*` variables (A25); only the toast is implemented |
| Any withdrawal or earning action | R4 approval surface | must never run unattended; the decider guard is a **denylist** (A23) |
| Strong R4 provenance | the unapplied allowlist patch (09:32–09:33) | `OPERATOR_IDENTITY_ENV` absent from the live file (A23) |
| Unattended scheduling | S1 **and** S7 **and** C9 | null read spends the day *and* books it a success (A22); concurrency flakes (A21); no gate of record (A18) |
| Deprecation of the non-certifying verifier | S9 | it is **inside the shipped bundle** (A29), not only in `server/scripts/` |
| Writer attribution (C14) | a code change or a documented operating window | 15 lines, none carrying a writer key (A8) |
| Disposition of the second/third state root | an operator decision | `data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor` all exist (A28) |
| Elevated task registration | elevated shell | non-elevated host by policy |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S1 remedy: O-1 / O-2 / O-3 / O-4 / O-5 | operator | every unattended run keeps spending a day and hiding it |
| D-2 | S2: which gate is the gate of record, and is the R3 gate de-forked before it is ported? | operator | C9 stays red; a fourth matrix is built and the count grows (C41) |
| D-3 | S7 remedy: O-a / O-b / O-c | operator | concurrency stays uncertified (C28) |
| D-4 | S4 remedy: apply the allowlist, or record the denylist as residual risk | operator | any label outside the ten words can sign a decision |
| D-5 | authoritative read source (operator-entered now / Path B / provider) | operator | every snapshot stays `degraded:true` |
| D-6 | when the app is started, and by whom (C17) | operator | the only authenticated path stays unreachable (A26) |
| D-7 | S11: `PYTHONDONTWRITEBYTECODE=1`, or name the bytecode write as allowed | operator | delegation rules forbidding writes under `monitoring/freecash/**` stay unsatisfiable (C35) |
| D-8 | state-root disposition incl. `server/data/freecash-monitor/` | operator | two roots can silently diverge |
| D-9 | revenue: O-R-a / O-R-b / O-R-c | operator | the money path stays at €19 verified 2026-08-19 |
| D-10 | which document is authoritative for the next session — V12 (11:44), V12B (11:47), this V12C, or the R4 brief (11:39) | operator | readers keep re-deriving state that changed minutes earlier (C30/C31) |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path in any option. No compliance claim from a static grep, a stale artefact, a PASS quoted from another session (C5), or a verdict whose input tree no longer exists (C42). No modification of the 869–870 pre-existing dirty paths (C7). **No second/third/fourth/fifth gate, harness, monitor or state root** (C8/C16/C41) — S2 must **reduce** the checker count. No further plan, brief or delegation counted as progress (C31). No voice/Jarvis runtime path touched. No editing of the sibling trees (`DELEGATION-2026-10-01*`) or of the `V12`/`V12B` plan files — read-only inputs. **This routine produces visibility, not revenue** (C20): no option in §3 outside S10 has a revenue time-to-value.

---

## 7. Definition of done

1. **One** gate is reachable from the repo root (C23/C41), named with path + sha256 + mtime (C40); it exits **0** on the S1-repaired copy and non-zero on every mutant with the **correct rule named**, control row included (C25/C39); every quoted verdict names its input tree and a replay command (C42).
2. `python monitoring/freecash/tests/run_all.py` → **26 consecutive** green runs `tests=52 failures=0 errors=0`, with the concurrency race asserted under full-suite load — attested by N and the red count, never by one run (S7, C28); both R1 scanners exit 0 at the pinned `exempt=28` (A11).
3. A data-less run leaves no day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, writes no snapshot, and produces `WATCHDOG_MISSED_DAY` (S1, C11+C19+A22) — while a day with a reading produces exactly one lock, one snapshot and one `SKIP_DUPLICATE_DAY` on a second run.
4. One real reading consumed; one real change notified exactly once; one approval item decided by a named human with `execution_state=NOT_EXECUTED`; a machine label refused in the same run (S3/S4/S5, C29).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S3/S6).
6. Both task payloads re-parse in their consumer with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule; 0 Free Cash tasks and 0 cron jobs otherwise (S6, C26, A24/A27).
7. Every `alerts.jsonl` line attributable to a known writer (S8, C14); the implementation index exists, covers the **shipped bundle**, and deletes nothing (S9, C43).
8. No credential anywhere (C6); no unrelated dirty path modified (C7); no earning action performed by anything (R1); the production root's hash pair quoted unchanged (C21, A3).
9. Every pass touching the routine states its `FREECASH_DATA_ROOT`, quotes the before/after root hashes, and names any `__pycache__` write inside the package or sets `PYTHONDONTWRITEBYTECODE=1` (C35, A31); every quoted sibling artefact carries its mtime (C30, A30).
10. The 2026-09-30 and 2026-10-01 incident decisions are recorded with the operator's name, and every later status sentence states that both days were spent by runs that read nothing (C24, A4/A5).

**Honest one-line reading of 2026-10-01 (11:53):** the routine still runs and refuses duplicate days, and its only real changes in 11 days are documents — this morning it spent the production day on a null read, booked it a success, dropped its miss streak 9 → 0 and silenced the watchdog it feeds, a defect now measured from both sides; the concurrency proof failed 2 of 20 runs today; three gates return three verdicts on identical bytes while a fourth matrix is being built and the port source is already forked by 2 228 diff lines; the registration payloads parse but nothing is scheduled; the app path that answered `200` at 09:29 is refused at 11:37; and no operator figure has ever been entered.

**Shortest honest path to a first real number:** `S1 (O-1, ~40 min) → S3 (operator-entered figures, same sitting)`.
**Shortest honest path to a *trustworthy* monitor:** that path plus `S2 (O-A′, 2–4 h) + S7 (O-a, 1–3 h)` **before** any timer is registered.

# WORKFLOW PLAN — Free Cash Finance Automation (V12, 2026-10-01 11:36–11:43 local)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a` · **dirty paths:** **870** (`git status --porcelain | wc -l`, measured this pass) · **Host:** Windows 11 (de-DE localised), git-bash (MSYS), non-elevated
**Clock of this pass:** `date` → `Do,  1. Okt 2026 11:39:12` … `11:43:00` (Europe/Berlin, UTC+02:00)
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` — `3.11.9`, `tzdata 2025.3`, `ZoneInfo("Europe/Berlin")` resolves (A1). `py -3` (3.14) has no `tzdata`.
**Subject:** the once-daily, read-only status routine for Free Cash Finance Automation — canonical package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`.

**Relationship to the other documents (additive; supersedes nothing):**

- **Read, not edited:** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V11B-2026-10-01.md` (mtime **09:31**, the last complete workflow plan), `…-V11-2026-10-01.md` (**09:30**), `RESEARCH-PLAN-…-V11` (**09:30**), `…-V10-2026-10-01.md` (**09:05**), `docs/freecash-monitor/04-workflow-plan-v3.md` (**09:26**, a second concurrent plan set), `DELEGATION-2026-10-01-R3/**` (09:23–09:44), `DELEGATION-2026-10-01-R4/**` (**11:39**).
- **The live authority as of this pass is `DELEGATION-2026-10-01-R4/DELEGATION-BRIEF-R4.md` (mtime 11:39, read in this pass)** — six streams (D day-budget, G gate authority, I identity, S source, T trigger, V adversarial verifier). This V12 does **not** re-dispatch them and creates no second gate, harness or monitor (C8/C16). Every stage below is mapped to the R4 stream that owns it, and each stage states what V12 adds that R4 did not have at 11:39.
- **What V12 adds, measured in this pass and absent from every earlier plan:** (i) **two package-scope gates return opposite verdicts on identical bytes** — delivered 09-30 gate `R1=PASS R2=PASS R3=PASS R4=PASS`, exit **0** vs R3 gate `R1=FAIL R2=PASS R3=PASS R4=FAIL`, exit **1** (A15–A17); (ii) an **independently reproduced** day-budget failure with the six assertion strings quoted verbatim (A18) and the `RUN_OK … written=True … lock=…` line that proves a null read consumes the day (A19); (iii) the **inherited `:4600 → 200` health row expired inside two hours** (A23), which invalidates the source ranking's RANK 2 as a same-day option.
- **Evidence standard (C5):** every §0 row is the output of a command **executed in this pass**. Sibling artefacts are labelled `sibling` with the **mtime read in this pass** (C30). No PASS, hash or count is inherited.
- **Footprint:** this file is **new**. No existing file edited, moved, renamed or deleted; no `git add/commit/stash/reset/restore/checkout/clean`; no `schtasks /Create`; no cron registration; no provider network call; no credential, token or secret read; nothing written to `monitoring/freecash/**`, `scripts/monitoring/**` or `data/freecash-monitor/**`. Routine and gate invocations used throwaway roots under `%LOCALAPPDATA%\Temp\fcv12-*` (removed). The production root's three hashes are **byte-identical before (11:39) and after (11:42)** and **zero** files in it are newer than 11:38 (A4, A28).

---

## 0. Live state, verified in this pass (11:36–11:43)

| # | Command | Observed result | What it establishes |
|---|---|---|---|
| A1 | `date`; `which python`; `python -V`; venv `python -V` | `Do,  1. Okt 2026 11:39:12`; `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python`; `Python 3.11.9`; `tzdata 2025.3 zone Europe/Berlin` | clock and interpreter of record confirmed (C10); the day key resolves |
| A2 | `git rev-parse --abbrev-ref HEAD`; `… --short HEAD`; `git status --porcelain \| wc -l` | `hermes-rescue-20260908`; `8f7463a`; **870** | dirty set grew 868 → 870 since V11B (09:31); growth is documents (C31); `monitoring/` stays untracked (C7) |
| A3 | `sha256sum` on the three production state files, **before** | `last-run.json a287a902…293bf9` · `alerts.jsonl 1b9c7c07…9399a8` · `operator-state.json be8becc3…3eca59c` | byte-identical to V11B's 09:25/09:29 pin and to R4's 11:43 pin — the pin is the same for three consecutive passes |
| A4 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` | exactly **4** files, all mtime `08:53:46`: `state/day-locks/2026-10-01.lock` (0 B), `snapshots/2026-10-01.json` (518 B), `alerts/alerts.jsonl` (8956 B), `state/last-run.json` (341 B) | nothing has been written to production in the ~3 h between 08:53 and this pass (C27) |
| A5 | `ls -la data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` (21:08), `2026-09-30.lock` (21:01), **`2026-10-01.lock` (08:53)** | **today's day key is spent** (C24); 09-30 and 10-01 were both consumed by runs that read nothing |
| A6 | `cat state/last-run.json` | `last_attempt_day=last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`** (was 9) | a null read is booked as a **success day** and reset the miss streak (C19 violated in production) |
| A7 | `cat snapshots/2026-10-01.json` | `source.kind=operator_entered`, `data_available=false`, `degraded=true`, all four figures `null`, `raw_response_sha256=e3b0c442…b855` | the snapshot is a **successfully written null** — the sha256 of the empty string (C19) |
| A8 | `wc -l alerts/alerts.jsonl`; `tail -3` | **15** lines; newest `MONITOR_DEGRADED`, `day_key=2026-10-01`, `ts_utc=2026-10-01T06:53:46Z`. Line keys: `day_key,dedupe_key,event_id,event_type,message,observed,severity,ts_utc` | **no writer key on any of the 15 lines** (C14) |
| A9 | `python -c json.load(operator-state.json)['records']` | `top_keys=[schema_version, kind, note, how_to, records, template_record]`, `records = []` | **no operator figure has ever been entered** — 11th consecutive day (A9 is the whole reason R3 is unfalsifiable) |
| A10 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest mtime **`2026-09-20 06:59`** (`changedetect.py`, `watchdog.py`); `gate.py` `2026-09-18 07:32` | **zero code change in 11 days**; today's entire output is documents (C31) |
| A11 | `ls -la data/freecash-monitor/approvals/` | empty directory — no `pending.json` | the approval queue has never held an item; the R4 path is unexercised in production |
| A12 | `python monitoring/freecash/verify_readonly.py` · `bash docs/…/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit **0** · `PASS — no unexempted write/earning token found.`, exit **0** | the R1 static scanner is green at the pinned baseline **28**, both ports of the checker (C23) |
| A13 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS` · `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1` · exit **1** | the **shipped** acceptance gate is RED, and is **file-scoped by construction** (the day key and `O_CREAT\|O_EXCL` live in `gate.py`) |
| A14 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` | `error: unrecognized arguments: --package` · exit **2** | the shipped gate cannot accept a directory at all |
| A15 | `python docs/…/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash --workdir <temp>` | `SUMMARY: R1=PASS  R2=PASS  R3=PASS  R4=PASS` · `VERDICT: COMPLIANT -- 4/4 operator rules enforced by an AST layer and a runtime layer` · exit **0** | the **delivered 09-30 gate** is green on the live package (independently re-confirmed; C5) |
| A16 | `python docs/…/DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py --package monitoring/freecash` (it rejects `--workdir`, exit 2) | `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=FAIL` · `VERDICT: NOT COMPLIANT -- rule(s) violated: R1, R4` · exit **1**; R3 tree file count `275 → 275` | the **R3 gate** is **red on the live package** and writes nothing |
| **A17** | A15 and A16 compared | **same bytes, same pass, opposite verdicts on `R1` and `R4`**: delivered `R1=PASS R4=PASS` exit 0 vs R3 `R1=FAIL R4=FAIL` exit 1 | **"the gate is green" is a statement about which defects a gate can see, not about the package** (new constraint **C32**). One of the two is blind to the two defects A18 reproduces live |
| **A18** | `FREECASH_DATA_ROOT=<scratch> FREECASH_ROUTINE_DIR=D:/AgenticOS/monitoring/freecash <venv> docs/…/R3/daybudget/failing-test-first/test_daybudget_data_less.py` | exit **1**, **6 of 7 RED**, assertion text quoted: `Lists differ: ['2026-10-01.lock'] != []` · `'2026-10-01' != '2026-09-30'` · `0 != 9 : a data-less run must not reset the miss counter` · `True is not false : WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=MONITOR_DEGRADED` · `Lists differ: ['2026-10-01.json'] != []` · `Lists differ: ['2026-10-01.lock'] != []` | the #1 defect is **live-reproduced by me**, with the six acceptance strings (new constraint **C34**). The 7th test (reading-present run) is `ok` — the guard must not break it |
| A19 | same run, `RUN_OK` lines | data-less leg ×4: `RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock`; reading-present leg: `outcome=INITIAL_BASELINE … data_available=True`; then `SKIP_DUPLICATE_DAY 2026-10-01` | a **null read consumes the day and writes a snapshot**; the duplicate branch is the only correct behaviour shipped today |
| A20 | `FREECASH_DATA_ROOT=<scratch> python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit **0** (**N=1**) | offline suite green **this run** — and per C28 a single run is **not** attestation (3 of 26 were red at 09:17, sibling) |
| A21 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash`; `hermes cron list` | **278** task rows, **0** Free Cash; `No scheduled jobs.` | **nothing triggers the routine**; nothing has to be undone before a trigger decision (R2 is enforced by a lock no scheduler honours) |
| A22 | `env \| grep -icE "FREECASH\|SMTP_\|WEBHOOK_\|HG_CASH\|CASHFREE"` | **0**; `AGENT_TEAMS_DB_PATH`, `AGENTICOS_DATA_DIR`, `AGENTICOS_USER_DATA_DIR`, `AGENTICOS_LEGACY_DATA_DIR` are set | C6/C13 hold: no credential or sink in the ambient environment; a scheduled run would inherit the AgenticOS roots (pin them, R4 §5.3) |
| **A23** | `curl 127.0.0.1:4600/api/health`; `localhost:3001/health`; `LC_ALL=C netstat -ano` | `curl: (7) Failed to connect to 127.0.0.1:4600 after 2029 ms` → code **000**; `3001` → **000**; **40** listening rows, **none** for 4600/3001; `electron=0` | the app/API path is **DOWN in this pass** — it answered `200` (node PID 32500) at 09:37 `sibling` and `200` at 09:42 `sibling`. Any stage that routes through `:4600` must re-measure it (new constraint **C35**) |
| **A24** | `netstat -ano \| grep -c LISTENING`; `awk '{print $4}' \| sort` | **0**; `sort: string comparison failed: Invalid or incomplete multibyte or wide character` | on this de-DE host the state word is CP-encoded `ABHÖREN`, so `grep LISTENING` is **always empty** — a "no listener" claim built on it is vacuous. Use `LC_ALL=C` + `ABH` (C35) |
| A25 | `find docs/…/DELEGATION-2026-10-01-R4 -maxdepth 2` | created **11:39**: `DELEGATION-BRIEF.md`, `DELEGATION-BRIEF-R4.md`, `RESEARCH-PLAN.md`, stream dirs `research/ source/ verify/ workflow/` (no `daybudget/ gate/ identity/ scheduler/` yet) | the live delegation started in the same minute as this pass; **its stream dirs are the write targets, not new ones** (C8/C16, C30) |
| A26 | `ls -la docs/…/R3/daybudget/…`; R3 tree read | `daybudget/remedy/` **exists and is empty** (dir 09:33, 0 files); `failing-test-first/` 7 tests; `daybudget/repro/` a remedied copy; R3 `verifier/mutation-table.txt` reports 10/10 mutants caught; R3 `identity/proposed/` a proposal that is **not applied**; R3 `source/SOURCE-DECISION.md` RANK 1 = operator-entered file | R3 closed 3 of 4 streams as artefacts and delivered **no remedy** — an empty directory named `remedy/` reads as delivered (new constraint **C33**) |
| A27 | `grep -n "^#\{1,3\} " docs/freecash-monitor/04-workflow-plan-v3.md` | headings S0–S7 + revenue options, an independent third plan set (`00`–`04`, 09:00–09:26) | ≥3 concurrent workflows exist over the same routine; V12 is the version-numbered continuation of the `docs/free-cash-monitor-routine/` series |
| A28 | `sha256sum` again at 11:40 + `find data/freecash-monitor -type f -newermt "2026-10-01 11:38"` | hashes identical to A3; **0** new files; files newer than 11:38 elsewhere are `DELEGATION-2026-10-01-R4/*` (11:39), `.agentic/handoffs/bgtask-*.json`, `.tmp/shopify-verify-20261001T0940Z/*`, `data/jarvis-runtime-trace.log`, `server/.agentic/gateway-*` | this pass is **hermetic against the production root** (C21) and at least one concurrent session (R4) is writing in these directories right now (C30) |

### 0.1 What this pass changes in the picture (read before the stages)

1. **The gate story has a new, load-bearing fact.** V11B (09:42) concluded "the delivered gate is green and catches 8/8 semantic mutants; the shipped gate is red by scope". Both remain true — and on the **same bytes in this pass** the delivered gate says **COMPLIANT (exit 0)** while the R3 gate says **NOT COMPLIANT on R1 and R4 (exit 1)** (A15–A17). A gate that returns COMPLIANT on a package whose null read consumes the day (A18/A19) and whose decider guard accepts `hermes-agent` is **blind to both live defects**. Naming the gate of record therefore requires a **per-rule divergence table**, not a green line.
2. **The top defect is now reproducible by a third party, not just by its author.** My own run of R3's harness against the shipped package produced the six assertion strings in A18 and the `written=True … lock=…` line in A19. Those six strings are the acceptance bar (**C34**).
3. **The app/API path is down (A23)**, two hours after two siblings measured `200`. RANK 2 of R3's source table (`GET /api/projects/:id/freecash/auth` on `:4600`) is **not available today** and must not be planned against without a re-measure.
4. **Nothing has moved in 11 days except documents** (A10: code 2026-09-20 06:59; A9: `records: []`; A2: 870 dirty paths). Per **C31** the count of plans is not progress: the only changed bytes that would count are a remedy diff and a gate exit code.
5. **The one thing that has not been tried is the cheapest.** The only source reachable today with no credential and no socket is the operator-entered file (A26, RANK 1) and it has **never** been written (A9).

---

## 1. Binding operational constraints

### 1.1 The four operator rules — by **title**, with both numberings printed (the repo inverts them)

| Operator rule | Title | Shipped code's own label | R3 delivered gate label |
|---|---|---|---|
| **R1** | **no earning action automatically** — observe only; read-only transport | `readonly_client.py:1` calls it **R2** | `RULE 1` ✅ agrees |
| **R2** | **check status once per operator-local day** (Europe/Berlin) | `gate.py:1` calls it **R1** | `RULE 2` ✅ agrees |
| R3 | notify on earnings/status change, exactly once per change | R3 | ✅ agrees |
| R4 | human approval before ANY external action; no execution path exists | R4 | ✅ agrees |

A bare `R1`/`R2` is never printed in this plan. Enforcement layers: R1 = `readonly_client.py` deny-by-default `ALLOWED_METHODS={GET,HEAD}` + loopback `ALLOWED_HOSTS` + path allowlist + `verify_readonly.py`; R2 = atomic `O_CREAT|O_EXCL` day lock keyed on `gate.day_key()`; R3 = prior snapshot loaded before the new one is written; R4 = enqueue-only queue with `execution_state=NOT_EXECUTED`.

### 1.2 Carried constraints (named by title; unchanged)

C5 live evidence only · C6 no secrets (`[REDACTED]`) · C7 never disturb the 870 pre-existing dirty paths, no destructive git · C8/C16 one implementation, one gate per job · C9 acceptance gate green before any registration · C10 the venv 3.11.9 is the interpreter of record · C11 never spend the day before a reading exists · C12 name the port and the clock in every health claim · C13 a scheduled run must not inherit ambient `FREECASH_*` · C14 one attributable writer per `alerts.jsonl` day · C17 no plan depends on a component that may be closed · C18 single-sitting first actions · C19 "ran" ≠ "read" · C20 the monitor is a visibility instrument, not a revenue instrument · C21 the production root is not a scratch dir · C22 no machine-timed bursts · C23 name the gate file and its exit code · C24 a spent day is spent · C25 an escaping mutant is not evidence · C26 a payload must parse in its consumer · C27 footprints expire · C28 a flaky gate is a red gate (quote N) · C29 name the rule that failed (evasion ≠ misattributed catch) · C30 concurrent-session evidence expires in minutes · C31 a document is not progress.

### 1.3 New in V12

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C32** | **a gate's green is a claim about scope, not about the package** — two package-scope gates returned opposite verdicts on identical bytes in one pass | A15 `exit 0`, `R1=R4=PASS` vs A16 `exit 1`, `R1=FAIL R4=FAIL`; A18 shows the package *is* defective in exactly those two rules | every gate quote names **gate file + scope + exit code + per-rule verdict**; a rule one gate enforces and another does not is an **open defect**, never a footnote. The gate of record is the one whose per-rule verdicts match the six assertion strings in A18 |
| **C33** | **an empty delivery directory is a false delivery signal** | A26: `R3/daybudget/remedy/` exists (09:33) with 0 files while R4 recorded "REMEDY MISSING" | a named deliverable directory contains its artefact (diff + runnable repro) or does not exist; a directory without its artefact is reported as **absent** |
| **C34** | **the acceptance bar for a defect fix is the failing test's own assertion strings, quoted verbatim** | A18: six exact `AssertionError` strings; A19 the `RUN_OK … written=True … lock=…` line | the fix's hand-off quotes the six strings passing **and** the 7th test (reading present) still `ok`; exit code alone is not acceptance |
| **C35** | **a health row expires with its listener, and "no listener" must be measured in a way that can be true** | A23 `curl (7)`/`000` at 11:39 vs `200` at 09:37 and 09:42; A24 `grep -c LISTENING` → `0` on a host with 40 listening sockets | every plan that routes through a port re-measures in its own pass and quotes **both** the HTTP code and the socket check; on this host use `LC_ALL=C` + `ABH`, never `LISTENING` |

---

## 2. Stages

**Ordering:** `S1 → S2 → S3 → S5 → S6`, with `S4`, `S7`, `S8`, `S9` parallel; `S10` separate and human-gated. One change between gate runs. A stage counts as complete only on output produced in the session that claims it. **Never create a second gate, harness, monitor or state root** — every stage writes into the R4 stream directory that owns it (C8/C16).

**S1 — Day-budget remedy (the one defect behind this morning's incident).** *R4 stream **D**.*
Expected Effort: **~40 min (O-1)** / 3–5 h (O-2) / ~1 h (O-3). Time-to-Revenue: **none** (C20 — this buys a truthful record, not cash). Dependencies: none; pure package code + tests, on a **copy** under `…-R4/daybudget/`.
First Concrete Action: run R3's 7-test file against a copy of the package and make the **six** assertion strings in A18 pass — remove `MONITOR_DEGRADED` from `gate.SUCCESS_OUTCOMES` (`gate.py:32-40`), stop `gate.py:198` advancing `last_success_day` for it, and key `watchdog.py:33` coverage on the snapshot's `data_available` rather than on process completion (A19).
Exit: data-less run ⇒ `day-locks/` empty, `last_success_day` unchanged, `consecutive_missed_days` preserved, `WATCHDOG_MISSED_DAY`, **no snapshot**; reading-present run ⇒ exactly 1 lock, 1 snapshot, second run `SKIP_DUPLICATE_DAY`; full suite still `failures=0`; **`remedy/` contains a runnable diff** (C33).
Options: **O-1 two-phase accounting only (~40 min, recommended — the smallest change that makes the watchdog truthful)** · O-2 two-phase lock + accounting (3–5 h; weakens "one read per day" to "one *successful* read per day" — state it in the decision record) · O-3 wrapper pre-flight guard (~1 h; **insufficient alone**, the 09-30 run was a wrapper path) · O-4 O-2 + O-3 (3–6 h) · O-5 stay manual (0 h; say plainly that unattended operation stays blocked).

**S2 — Name the acceptance gate of record.** *R4 stream **G**; V12 adds the A17 divergence.*
Expected Effort: 1–2 h for the divergence matrix; **2–4 h** if the port closes the `adv3`/`adv4` evasions and the `adv6` misattribution. Time-to-Revenue: none — this buys the verdict. Dependencies: the three gate files (`scripts/monitoring/rule_gate_verify.py` 2026-09-18 07:28; `DELEGATION-2026-09-30/verifier/rule_gate.py` 09-30 21:09; `DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py` 09:36) and the 10-mutant harness; **do not create a fourth** (C8/C16).
First Concrete Action: build the matrix **gate × {live package, repaired copy from S1, each of the 10 mutants}** with exit codes as raw output, then explain the A17 contradiction at `file:line` — the delivered gate passes the live package on R1 and R4 while A18 shows a data-less run consuming the day and R4's denylist accepting `hermes-agent`. Name the gate whose per-rule verdicts match A18, in one sentence the operator can paste into CI.
Exit: one gate named; it exits **0** on the S1-repaired copy and **non-zero on all 10 mutants with the correct rule named** (C25/C29); exactly one gate reachable from the repo root (C23).
Options: **O-A′ adopt the R3 gate as the port base and re-point the shipped entry at it (2–4 h)** · O-B′ port the four detectors into the shipped verifier behind a new `--package` flag (2–4 h; no third file) · O-C′ keep the delivered 09-30 gate and record its R1/R4 blindness as an accepted residual (0 h; **carries a live false-green**) · O-D′ operator override of C9 in writing (0.2 h; removes the automatable gate).

**S3 — First real operator reading (the fastest honest path to a number).** *R4 stream **S**.*
Expected Effort: 0.5–1 h once + ~60 s/day. Time-to-Revenue: **same-day visibility only** (C20 — there is no revenue path here). Dependencies: **S1** (else the first data-less run burns the next day — proven twice: A5), a decision on the spent 2026-10-01 key, a free `day_key`, the venv interpreter.
First Concrete Action: the operator opens their own dashboard, types **one** record for the next free `day_key` into `data/freecash-monitor/state/operator-state.json` (four integer-cent figures; `records` is `[]` today — A9), then the routine runs **once** and the `RUN_OK … outcome=INITIAL_BASELINE source=operator_entered(data_available=True)` line is quoted (the exact shape was measured in a scratch root, A19).
Exit: a day-1 baseline snapshot with `data_available=true`; on a later day a changed figure produces **exactly one** `EARNINGS_CHANGED` and a repeat produces `DEDUPED`.
Honest limit: every snapshot from this source is `degraded: true` by construction; a "no change" day only proves the same numbers were typed twice.

**S4 — R4 identity: allowlist instead of denylist.** *R4 stream **I**; the proposal already exists (A26).*
Expected Effort: ~1 h to apply on a copy + **~1 h to update the delivered gate's own R4 detector** (it currently fails closed on the repaired package — the detector depends on the old defect). Time-to-Revenue: none. Dependencies: R3 `identity/proposed/approval_queue.py` + both-directions test; the gate detector update must ship in the same change.
First Concrete Action: on a copy, apply the proposal and run the both-directions proof **in one run**: `hermes-agent` → exit 4 `REFUSED`, an operator name on `state/human-deciders.json` → exit 0 `APPROVED`, `execution_state` still `NOT_EXECUTED`.
Exit: only configured humans can sign; the safety property (frozen fields, no execution path) stated **separately** from the attribution property; the delivered gate's R4 detector updated or its dependence recorded as an open defect.

**S5 — Make R3 falsifiable for a human, offline.** *R4 stream **S**.*
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S1, S3, a scratch root.
First Concrete Action: in a scratch root, day-1 record → `INITIAL_BASELINE`, `notifications=0`; day-2 record with one changed figure → exactly one `EARNINGS_CHANGED`/`STATUS_CHANGED`; repeat → `DEDUPED`. No provider credential, no non-loopback socket.
Exit: the notify path has fired for a human-entered change at least once, with dedupe shown.

**S6 — Trigger decision packet; register nothing.** *R4 stream **T**.*
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S1, S2, S5.
First Concrete Action: re-parse both `DELEGATION-2026-10-01/scheduler/DECISION-V2-*.xml` payloads **in this consumer** (C26/C30 — V11B A25 reports them parsing at 09:42; re-verify), confirm the pinned interpreter path and `IgnoreNew` + `StartWhenAvailable` + **Do not restart** inside the XML, and hand over the `schtasks /Create /XML` text only. Current state: 278 tasks, **0** Free Cash (A21).
Exit: `ET.parse` exit 0 quoted for both payloads; a dry run of the exact command against a scratch root; a written decision packet naming the command, the missed-day semantics and the behaviour when the trigger **does not** fire — or an explicit decision not to schedule.

**S7 — Concurrency flake (C28).** *R4 stream **V** is the adversarial verifier; this is package work.*
Expected Effort: 1–3 h. Time-to-Revenue: none. Dependencies: none; must land before any timer.
First Concrete Action: reproduce the `3 != 4` failure with N=26 suite runs in a pinned scratch root, instrumenting **writer count per run** rather than winner count.
Exit: **26 consecutive** green runs with the failing test named on any red; every future concurrency attestation quotes N and the failure count.
Options: **O-a diagnose then fix (1–3 h)** · O-b assert the lock-file count, not the winner (0.5–1 h; weaker — say so) · O-c `xfail` and accept (0.2 h; **rejected** — removes the only concurrency evidence).

**S8 — Alert attribution + catch-up coalescing (C14/C22).** Parallel.
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — **all 15 lines carry none, today's included** (A8) — and coalesce catch-up so N missed days reach the operator as one payload.
Exit: a line's origin is identifiable from the line; the next bundle's baseline explicitly **includes** the 2026-09-21 unattributed line, the 09-30 burst and today's line (nothing laundered).

**S9 — Deprecation index; delete nothing (C8/C16).** Read-only.
Expected Effort: 1–2 h. Time-to-Revenue: none — this is false-compliance risk control. Dependencies: none.
First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing the parallel implementations (`finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `server/scripts/verify-freecash-rules.mjs`, `server/src/adapters/freecashMonitorAdapter.ts`), each with its exact gate command, naming `monitoring/freecash/` as the single implementation and `server/scripts/verify-freecash-rules.mjs` as **do-not-cite** (4/4 PASSED while its target fails `node --check`).
Exit: index exists; no file moved, edited or deleted.

**S10 — The revenue path (carried so it is not silently dropped; C20).** Separate, human-gated.
Expected Effort: unknown (a human decision first). Time-to-Revenue: **the only stage with a direct revenue hypothesis, and it is unbounded**. Dependencies: a human decision, the app running (A23: not running this pass), and a publication step that does not exist.
First Concrete Action: with the app running and a listener re-measured (C35), resume the blocked background task in the UI, or take the decision to implement the publication step. Recorded reality (inherited from V11B, **not** re-measured here): 11 revenue-ledger rows, newest verified `2026-08-19` (`VERIFIED_REVENUE 19.0 EUR`), treasury ledger empty, all Shopify authorisation gates `resolved`.
Options: **R-a resume/re-dispatch the mission (1–2 h, unknown TTR)** · R-b implement the publication step (unbounded; weeks if it works) · R-c monitor only (0 h, 0 revenue — the honest default while S1/S2 are open).

### 2.1 Stage → stream map (no work is duplicated, nothing new is created)

| Stage | R4 stream that owns it | What V12 adds beyond the R4 brief |
|---|---|---|
| S1 | D `daybudget/` | the six assertion strings and the `written=True … lock=…` line re-measured by a third party (A18/A19) |
| S2 | G `gate/` | the A17 divergence: delivered gate `exit 0 / R1,R4 PASS` vs R3 gate `exit 1 / R1,R4 FAIL` on identical bytes |
| S3, S5 | S `source/` | A23/A24: the `:4600` route is down and the "no listener" check must use `ABH`, not `LISTENING` |
| S4 | I `identity/` | the gate-side consequence: the delivered R4 detector fails closed on the repaired package |
| S6 | T `scheduler/` | — (V11B A25 carried forward for re-verification) |
| S7, S8 | V `verifier/` (adversarial) | C28 restated as a work item with N=26 |
| S9, S10 | none | carried from V11B so the index and the money path are not lost |

---

## 3. Options at a glance — every option carries all four columns

| Stage | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| S1 day budget | **O-1 accounting only** | ~40 min | none (visibility) | none | make the six A18 assertions pass on a copy; remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` |
| S1 day budget | O-2 two-phase lock + accounting | 3–5 h | none | none | failing test first, then attempt-then-consume |
| S1 day budget | O-3 wrapper pre-flight guard | ~1 h | none | S6 wrapper | refuse to invoke when today's record is absent (**insufficient alone**) |
| S1 day budget | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| S1 day budget | O-5 stay manual | 0 h | none | none | say plainly: unattended operation stays blocked |
| S2 gate | **O-A′ port the R3 gate, adopt as the entry** | 2–4 h | none | R3 gate + 10-mutant harness | divergence matrix; re-point `scripts/monitoring/rule_gate_verify.py` |
| S2 gate | O-B′ port the detectors behind a new `--package` flag | 2–4 h | none | same | no third gate file (C8/C16) |
| S2 gate | O-C′ keep the delivered gate, record its blindness | 0 h | none | operator sign-off | live false-green on R1/R4 stays in force |
| S2 gate | O-D′ operator override of C9 | 0.2 h | none | operator sign-off | lose the automatable gate |
| S3 read source | **operator-entered file (RANK 1)** | 0.5–1 h + 60 s/day | **same day, visibility** | S1, a free day key, venv interpreter | type one record; expect `INITIAL_BASELINE` |
| S3 read source | `:4600` auth route (RANK 2) | 0 h today | none **this pass** | a live listener (A23: `000`), allowlist entry + new read op | re-measure the port first (C35) |
| S3 read source | provider read contract (HG.Cash, documented) | 2–4 h if an account exists | 3 days–2 weeks | confirmed account + out-of-repo token | one operator-authorised `GET`, field names only, values `[REDACTED]` |
| S3 read source | provider session automation | unknown | unknown | provider identity + session + credential | **BLOCKED** — keep off the critical path |
| S4 identity | **apply the allowlist proposal + update the gate detector** | ~1 h + ~1 h | none | R3 proposal; detector update in the same change | both directions in one run (`hermes-agent` refused, operator accepted) |
| S4 identity | record the denylist as accepted residual | 0.2 h | none | operator sign-off | state that `hermes-agent`/`assistant`/`claude` are accepted today |
| S5 notify | offline day-1 → day-2 change demo | 1–2 h | none | S1, S3 | one `EARNINGS_CHANGED`, then `DEDUPED` |
| S6 trigger | **handover only (no registration)** | 1–2 h | none | S1, S2, S5 | re-parse both payloads; confirm interpreter + `Do not restart` |
| S6 trigger | register now | <1 h | none | C9 green (it is not) | **rejected** — a flaky gate is a red gate (C28) |
| S7 concurrency | **O-a diagnose then fix** | 1–3 h | none | none | 26 runs; instrument writer count |
| S7 concurrency | O-c `xfail` the flake | 0.2 h | none | none | **rejected** — removes the only concurrency evidence |
| S8 attribution | writer tag + catch-up coalescing | 1–2 h | none | none | tag every new line; baseline includes the 15 unattributed |
| S9 index | implementation index | 1–2 h (read-only) | none | none | write the index; delete nothing |
| S10 revenue | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume the blocked task in the UI |
| S10 revenue | R-b implement publication | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| S10 revenue | R-c monitor only | 0 h | none | none | say plainly: visibility, not cash |

---

## 4. Blocked register

| Item | Blocked on | Reason (measured in this or a cited pass) |
|---|---|---|
| Any reading for 2026-10-01 | a human decision on the spent key + a lock removal | the day was consumed at 08:53:46 by a run that read nothing (A4/A5) |
| Acceptance gate of record (C9) | S2 | three gates, three verdicts; two package-scope gates **disagree on the same bytes** on R1 and R4 (A13/A15/A16/A17) |
| Closed mutant set (C25) | S2 | `adv3-r4-getattr-exec` and `adv4-r1-conditional-backdoor` are evasions (exit 0) and `adv6-r1-new-socket-file` exits 1 via R4, not R1 `sibling` (R3 `mutation-table.txt`, 09:37) |
| Trustworthy concurrency attestation | S7 | 3 of 26 suite runs red `sibling` (09:17); my run is N=1 (A20) |
| Unattended scheduling | S1 + S2 + S7 | a data-less run spends the day and books it a success (A5/A18/A19); the concurrency proof flakes; no gate of record |
| Trustworthy "monitor is alive" signal | S1 | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` → `watchdog.py:33` reports covered on a null snapshot (A18: `WATCHDOG_OK … outcome=MONITOR_DEGRADED`) |
| Live account status / authenticated path | a live listener **and** a human session | `:4600` refused in this pass (A23), `:3001` refused, 0 Electron processes; `provider_credentials = 0` |
| Email / SMS / webhook alerting | credentials or mail tooling | no `SMTP_*`/`WEBHOOK_*` in the environment (A22); only the toast is implemented |
| Strong R4 identity provenance | the unapplied allowlist proposal | the live guard is a ten-word **denylist** (`approval_queue.py:55`, `:153`); `hermes-agent`, `assistant`, `claude` are accepted — reproduced `sibling` at 09:38 |
| Any withdrawal or earning action | R4 human approval surface | must never run unattended; no execution path exists by design |
| Writer attribution (C14) | a code change | 15 lines, none carrying a writer key (A8) |
| A second/third state root's disposition | an operator decision | `data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor` all exist |
| Elevated task registration | an elevated shell | non-elevated host by policy |
| Revenue publication | a human decision + implementation | €19 verified 2026-08-19 `inherited`; nothing published since |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S1 remedy: O-1 / O-2 / O-3 / O-4 / O-5 | operator | every unattended run keeps spending a day and hiding it |
| D-2 | 2026-10-01: accept the spent day or remediate it (append a corrective note if anything is removed) | operator | each later status must restate that 09-30 and 10-01 were spent by runs that read nothing |
| D-3 | S2: which gate is the acceptance gate of record (O-A′/O-B′/O-C′/O-D′) | operator | C9 stays red and a live false-green stays quotable |
| D-4 | S3: enter the first operator reading (RANK 1) or pursue a source that needs a listener | operator | every snapshot stays `degraded: true` with four nulls — the 11th such day |
| D-5 | S4: apply the allowlist or record the denylist as residual risk | operator | "only a human may sign" stays false while the safety property holds |
| D-6 | S6: schedule or explicitly not schedule | operator | R2's once-per-day property depends on a trigger that does not exist (A21) |
| D-7 | S9: label the parallel implementations and the decoy verifier now | operator | a "4/4 PASSED" that certifies an unparseable file stays available to any reader |
| D-8 | state-root disposition (three roots exist) | operator | two roots can silently diverge |
| D-9 | S10: R-a / R-b / R-c | operator | the money path stays at €19 verified 2026-08-19 |
| D-10 | which plan is authoritative for the next session (V12 vs V11B vs `docs/freecash-monitor/04`, vs the R4 brief) | operator | readers keep re-deriving state that changed minutes earlier (C30/C31) |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path in any option. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session (C5). No modification of the 870 pre-existing dirty paths (C7). **No second/third gate file, harness, monitor or state root** (C8/C16). No editing of the sibling delegation trees (`DELEGATION-2026-10-01*`) — they are read-only inputs. No further plan, brief or delegation may be counted as progress (C31). No voice/Jarvis runtime path touched. **This routine produces visibility, not revenue** (C20): no option in §3 outside S10 has a revenue time-to-value.

## 7. Definition of done

1. R3's `test_daybudget_data_less.py` runs **7 GREEN** against a copy in one run, with the six A18 strings absent and the seventh still `ok`; `remedy/` contains a runnable diff; the full suite still `failures=0` (S1, C33/C34).
2. **One** gate is named as the acceptance gate of record; it exits **0** on the S1-repaired copy and **non-zero on all 10 mutants with the correct rule named** (S2, C25/C29/C32), and the A17 divergence is explained at `file:line`.
3. A data-less run leaves no day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, writes no snapshot, and is reported as `WATCHDOG_MISSED_DAY` (S1, A18/A19).
4. One real reading consumed; one real change notified exactly once; one approval item decided by a named human with `execution_state=NOT_EXECUTED`; a machine label refused in the same run (S3/S4/S5).
5. Ten consecutive daily runs, one per day, with one deliberate duplicate-day refusal on record (S3/S6).
6. `26` consecutive green suite runs with the concurrency test under full-suite load (S7, C28).
7. Every `alerts.jsonl` line attributable to a known writer (S8, C14); the implementation index exists and deletes nothing (S9).
8. Both task payloads re-parse in their consumer and are quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule (S6, C26).
9. No credential anywhere (C6); no unrelated dirty path modified (C7); no earning action performed by anything (R1); the production root's hash pair is quoted unchanged (C21).

**Honest one-line reading of 2026-10-01 (11:43):** the routine still runs and refuses duplicates, but its only changes in 11 days are documents — this morning it spent the production day on a null read, booked it a success, reset its miss counter 9 → 0 and silenced its own watchdog; the defect that does all of that is now reproduced by a third party with six assertion strings; two mutant-closed package gates returned opposite verdicts on the same bytes (delivered `exit 0 R1/R4 PASS`, R3 `exit 1 R1/R4 FAIL`), so no gate of record exists; the app path is down (`:4600` refused, `0` Electron processes) two hours after two siblings measured `200`; and no operator figure has ever been entered.

**Shortest honest path to a first real number:** `S1 (O-1, ~40 min) → S3 (one operator record, same sitting)`.
**Shortest honest path to a trustworthy monitor:** that, plus `S2 (O-A′/O-B′, 2–4 h) + S4 (~2 h) + S7 (1–3 h)` **before** any timer is registered.

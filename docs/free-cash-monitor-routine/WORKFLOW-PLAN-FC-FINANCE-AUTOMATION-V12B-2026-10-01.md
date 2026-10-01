# WORKFLOW PLAN — Free Cash Finance Automation (V12B, 2026-10-01 11:39–11:56 local)

**Companion to `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V12-2026-10-01.md`, not a replacement for it.** That file (40 567 B, **mtime 11:44**) was written by a concurrent session into the name this pass first tried to take; it is **read as an input and left untouched** (C30). V12B adds the four measurements V12 does not carry, and adopts V12's stage numbering (`S1`–`S10`) so no second stage vocabulary is created.
**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463aa6931d57e12ec81b904b98cec04e932cf` · **Uncommitted paths:** **870** · **Host:** Windows 11 (de-DE), git-bash (MSYS), non-elevated
**Written:** 2026-10-01, evidence window `11:39:04` → `11:56` operator-local (`date -Is` → `2026-10-01T11:39:04+02:00`; Europe/Berlin, UTC+02:00)
**Interpreter of record (C10):** `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → **Python 3.11.9**; every §0 command ran through it.
**Subject:** the once-daily, read-only status routine for Free Cash Finance Automation — package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`, state root `data/freecash-monitor/`.
**Docs read as read-only inputs:** `…-V12-2026-10-01.md` (11:44) · `…-V11B-2026-10-01.md` (09:31) · `…-V11-2026-10-01.md` (09:30) · `DELEGATION-2026-10-01/{,R2,R3,R4}/**` (09:04–11:43).
**Evidence standard (C5):** every §0 row is a command executed **in this pass**; sibling rows are labelled `sibling` with the **mtime read in this pass** (C30); no PASS, hash or count is inherited.
**Footprint (C21/C27):** this file is **new**; nothing edited, moved, renamed or deleted; no `git add/commit/stash/reset/restore/checkout/clean`; no scheduled task or cron created (`schtasks`/`hermes cron` queried only); no provider network call; no credential read. All gate/suite invocations used scratch roots under `%LOCALAPPDATA%\Temp\fcplan-v12*`. The production root's three hashes are **byte-identical before (11:39) and after (11:42)**, and no file under it is newer than `08:53` (B4). **One exception, declared:** importing the package to run its suite wrote 7 `__pycache__/*.pyc` inside `monitoring/freecash/` at **11:36** (B28) — see C38.

---

## 0. Live state, verified in this pass

| # | Command (executed `11:39`–`11:56`) | Observed (raw) | What it establishes |
|---|---|---|---|
| B1 | `date -Is`; `which python`; `python -V` | `2026-10-01T11:39:04+02:00` … `2026-10-01T11:42:56+02:00`; `…/hermes-agent/venv/Scripts/python`; `Python 3.11.9` | clock + interpreter of record (C10) |
| B2 | `git rev-parse --short HEAD`; `git status --porcelain \| wc -l` | `8f7463a`; **870** (V11B 868 at 09:42) | growth is documents, not code (C31) |
| B3 | `sha256sum state/last-run.json alerts/alerts.jsonl state/operator-state.json` at `11:39` **and** `11:42` | `a287a902…3bf9` / `1b9c7c07…99a8` / `be8becc3…a59c`, identical both times | pass is **hermetic** (C21); same pin as V11B (09:25) and V12/R4 (11:39–11:43) — three consecutive passes |
| B4 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` | exactly **4** files, all `08:53`: `alerts/alerts.jsonl`, `snapshots/2026-10-01.json`, `state/day-locks/2026-10-01.lock`, `state/last-run.json` | production untouched for ~3 h (C27) |
| B5 | `ls -la state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock` (08:53)** | **today's key is spent** (C24) |
| B6 | `cat state/last-run.json` | `last_success_day="2026-10-01"`, `last_outcome="MONITOR_DEGRADED"`, **`consecutive_missed_days=0`** | a null read is booked a success and reset the miss streak (C19 violated) |
| B7 | `cat snapshots/2026-10-01.json` | `data_available:false`, `degraded:true`, four `null` figures, `raw_response_sha256=e3b0c442…b855` (sha256 of empty string) | the day was consumed by a run that read nothing |
| B8 | `wc -l alerts/alerts.jsonl`; `tail -5` | **15** lines; newest `MONITOR_DEGRADED` `2026-10-01T06:53:46Z`; no writer key on any line | unattributed writer (C14) |
| B9 | `python -c json.load(operator-state.json)['records']` | `records: []` | **no reading has ever been entered** (11th day) |
| B10 | `ls -la approvals/`; `cat approvals/pending.json` | empty dir; `No such file or directory` | the queue document has never existed |
| B11 | `grep -n -A9 "^SUCCESS_OUTCOMES" gate.py`; `grep -n last_success_day gate.py`; `grep -n "covered = " watchdog.py` | `:32-41` contains **`MONITOR_DEGRADED`**; `:199 ledger["last_success_day"] = day`; `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | the incident is a code property (S1) |
| B12 | `grep -n "NON_HUMAN_DECIDERS\|OPERATOR_IDENTITY_ENV\|human-deciders" approval_queue.py` | denylist `:55`, applied `:153`; `OPERATOR_IDENTITY_ENV` absent | live R4 guard is a bypassable denylist |
| B13 | `ls -la --time-style=long-iso monitoring/freecash/*.py` | newest mtime `2026-09-20 06:59`; `gate.py` `2026-09-18 07:32` | **no production code change in 11 days** (C31) |
| B14 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py`; `… monitoring/freecash --package` — exits | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`, exit **1**; `error: unrecognized arguments: --package`, exit **2** | the **shipped** gate is RED and file-scoped by construction (C9 red) |
| B15 | `python …/DELEGATION-2026-09-30/verifier/rule_gate.py --package <t> --workdir <temp>` over **9 trees** | pristine exit **0** `R1=R2=R3=R4=PASS`; control 0; `r1-a` 1 (R2) · `r1-b` 1 (R2) · `r2-a` 1 (R1) · `r2-b` 1 (R1+R4) · `r3-a` 1 (R3+R4) · `r3-b` 1 (R3+R4) · `r4-a` 1 (R4) · `r4-b` 1 (R4) | **9/9**, independently re-measured — the port has a green donor |
| **B16** | `python docs/…/DELEGATION-2026-10-01-R3/gate/rule_gate.py --package <t> --workdir <temp>` — **69 598 B, sha256 head `11b605f2…`, mtime 09:35** — over **5 trees** | pristine exit **0** `R1=PASS R2=PASS R3=PASS R4=PASS`; canonical-control exit 0; `r1-a` 1 (R2 FAIL) · `r2-b` 1 (R1+R4 FAIL) · `r4-b` 1 (R4 FAIL) | **the R3 tree holds a second gate that is GREEN on the live package** — measured by me, not quoted |
| **B17** | B16 vs V12's A16 (`sibling`, mtime **11:44**) | V12 measured `DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py` on the same package: `R1=FAIL R4=FAIL`, exit **1**. B16 measured `…R3/gate/rule_gate.py` on the same package: `R1=R2=R3=R4=PASS`, exit **0** | **one delegation tree contains two gates that contradict each other on identical bytes** — sharper than V12's "two gates disagree" and the reason no staged gate may be adopted as-is (new **C36**) |
| B18 | `DELEGATION-2026-10-01/verifier/mutation-evidence/MUTATION-TABLE.tsv` (`sibling`, mtime **09:26**) vs `DELEGATION-2026-10-01-R3/gate/mutation-evidence/MUTATION-TABLE.tsv` (`sibling`, mtime **09:35**) | 09:26: `adv3-r4-getattr-exec` exit **0**, `adv4-r1-conditional-backdoor` exit **0**, `adv6-r1-new-socket-file` exit 1 **via R4 only**. 09:35: **10/10 `detected=YES`** with the failing rule named — incl. `adv3` → R4, `adv4` → R1, `adv6` → R1 | the mutant set is **closed in staging and open in the shipped gate**; quoting either table without its mtime reverses the verdict (C29/C30) |
| B19 | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` × **6** | **6/6** `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | N=6 green **here** |
| B20 | `DELEGATION-2026-10-01-R2/workflow/evidence/suite-26-runs.txt` (`sibling`, mtime **09:17**) | 23 green, **3 red** (18/20/26), `test_five_concurrent_runs_yield_one_winner … 3 != 4` | the flake is real and unfixed — neither N settles it (C28) |
| B21 | `python monitoring/freecash/verify_readonly.py`; `bash docs/…/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit **0** (both) | R1 static scanners green at the pinned `28` |
| B22 | `node --check server/scripts/freecash-daily-monitor.mjs`; `node server/scripts/verify-freecash-rules.mjs` — exits | `SyntaxError: Unexpected token ':'`, line **41**, exit **1**; `[OK] All 4 operational rules verified (4/4 passed)`, exit **0** | the deprecated verifier certifies an unparseable file (S9) |
| B23 | `schtasks /Query /FO CSV /NH \| wc -l`; `… \| grep -ic freecash`; `hermes cron list` | **278** tasks, **0** Free Cash; `No scheduled jobs.` | nothing scheduled; nothing to undo before S6 |
| B24 | `ET.parse` over `DELEGATION-2026-10-01/scheduler/*.xml` ×4 | `PARSE OK` ×4, no raw `&` | payloads parse in their consumer (C26 satisfied) |
| B25 | `curl -m4 http://127.0.0.1:{4600,3001,5173}/api/health`; `tasklist \| grep -ic electron` | **`000` / `000` / `000`** (curl exit 7 at 11:42 per R4 raw, mtime 11:42); `electron=0`; 5 `node.exe` present | the API path is **down in this pass**; V11B's `4600=200` expired (C35) |
| B26 | `env \| grep -E 'FREECASH\|SMTP\|WEBHOOK\|AGENT_TEAMS\|AGENTICOS_DATA'` | `AGENT_TEAMS_DB_PATH=<set>`, `AGENTICOS_DATA_DIR=<set>`; **no `FREECASH_*`/`SMTP_*`/`WEBHOOK_*`** | C6/C13 hold; isolation must pin **both** AgenticOS roots for any sandboxed run |
| B27 | `find docs/free-cash-monitor-routine -newermt "2026-10-01 11:00"` | `DELEGATION-2026-10-01-R4/**` 11:39–11:43, `…-V12-2026-10-01.md` **11:44** | **≥3 sessions writing these directories during this pass** (C30/C37) |
| B28 | `find monitoring data/freecash-monitor -type f -newermt "2026-10-01 11:00"` | 7 × `monitoring/freecash/__pycache__/*.pyc` at **11:36** (this session's imports); nothing else outside `%LOCALAPPDATA%\Temp` | importing the package **writes into the package** (new **C38**) |
| B29 | `DELEGATION-2026-10-01-R3/identity/EVIDENCE.md` + `gate/harness-run.txt` (`sibling`, mtimes **09:37–09:38**) | staged allowlist: 14/14 cases, `hermes-agent` **REFUSED exit 4**, `Alice Operator` **ACCEPTED**; pristine-package probe: `hermes-agent`/`assistant`/`claude` **ACCEPTED**, `system`/`routine` refused | defect reproduced **and** remedy staged; production unchanged (B12) |
| B30 | `DELEGATION-2026-10-01-R3/daybudget/raw/{03-defect-demo-shipped,04-green-against-remedy}.txt` (`sibling`, mtime **09:44**) | shipped: `last_success_day 09-30 → 10-01`, `missed 9 → 0`, lock created, `WATCHDOG_OK`; remedied **copy**: `RUN_NO_DATA … snapshot=NONE day_lock=RELEASED(True) last_success_day=2026-09-30 consecutive_missed_days=9`, 7/7 green | S1's remedy exists as a **green copy only** (C37) |

### 0.1 What V12B adds, and what it corrects

1. **The gate contradiction is inside a single tree, not only between trees** (B16/B17): `…R3/gate/rule_gate.py` is green on the live package while `…R3/verifier/rule_gate_r3.py` is red on it. This is why S2's exit condition must be *one* gate of record **and** an explicit statement about which staged copies are retired — adopting the R3 tree wholesale would adopt a self-contradiction.
2. **The mutant set is closed in staging with correct attribution** (B18): `adv3`/`adv4` — the two live evasions V11B reported — now exit non-zero under the correct rule, and `adv6`'s R1 gap is closed. The remaining C25/C29 work is the **port**, not detection design.
3. **A footprint claim of "nothing written under `monitoring/freecash/**`" is false unless byte-code writing is disabled** (B28): any import of the package writes `__pycache__/*.pyc` there. This affects the delegation briefs that forbid all writes under `monitoring/freecash/**` and V12's own footprint row — the rule must either name the exception or the invocation must set `PYTHONDONTWRITEBYTECODE=1` (C38).
4. **Staged ≠ landed, and tree count ≠ progress** (B30/B29/B27): two of the three production defects have green remedies sitting in `DELEGATION-*/**` while `monitoring/freecash/*.py` are byte-unchanged since 2026-09-20 (B13). Fourth delegation tree appeared during this pass (B27).
5. Everything else V12 measured reconfirmed, including the spent day key (B5–B7), the red shipped gate (B14) and the down API path (B25).

**One-line status (11:56):** the routine still runs, refuses duplicates and writes a real evidence trail — and this morning it spent the production day on a null read, booked it a success, reset its miss counter from 9 to 0 and silenced its own watchdog; the shipped acceptance gate is red and cannot accept a directory; the three staged gates give **four** verdicts on the same bytes, two of them from the same tree, and the newest of them nonetheless closes the whole mutant set with the correct rule attributed; both production remedies exist only as green copies; the concurrency test stayed green 6/6 here against 3/26 red earlier; the payloads parse, nothing is scheduled, the API is down, and no reading has ever been entered.

---

## 1. Operational constraints (binding)

**The four operator rules — always printed with the title** (the shipped code inverts R1/R2; the operator numbering below matches `DELEGATION-BRIEF-R4.md:20-27` and is binding):

| Rule | Title |
|---|---|
| **R1** | **no earning action automatically** — observe only; deny-by-default read-only transport |
| **R2** | **check status once per operator-local (Europe/Berlin) calendar day** |
| **R3** | **notify on earnings/status change, exactly once per change** |
| **R4** | **human approval before ANY external action; no execution path exists** |

**Carried:** C5–C31 exactly as V12 §1.2 lists them (live evidence · no secrets · do not disturb the 870 dirty paths · one implementation/gate per job · gate green before registration · venv 3.11.9 · never spend the day before a reading · name port and clock · no ambient `FREECASH_*` · one attributable writer · no app-dependent plans · single-sitting first actions · "ran" ≠ "read" · visibility not revenue · production root is not scratch · no machine-timed bursts · name gate file + exit code · a spent day is spent · escaping mutant ≠ evidence · payloads must parse · footprints expire · flaky gate = red gate · name the rule that failed · sibling evidence expires · a document is not progress), plus **V12's C32–C35** (gate scope vs package · empty delivery dir is a false signal · acceptance bar is the failing test's own assertion strings · a health row expires with its listener).

**New in V12B:**

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C36** | **one tree, two gates, opposite verdicts — a staged gate is never a verdict of record** | B16 vs B17: `…R3/gate/rule_gate.py` exit 0 `R1=R2=R3=R4=PASS` vs `…R3/verifier/rule_gate_r3.py` exit 1 `R1=FAIL R4=FAIL`, same package, same pass | every verdict names **gate path + sha256 head + scope + target sha256 + exit code + per-rule result**; the gate of record is the one the shipped entry point reaches; staged copies are labelled `staging — not acceptance` and a plan may not cite two of them as confirmation |
| **C37** | **a green copy is not a repair, and a tree count is not progress** | B30/B29: day-budget remedy green in `…R3/daybudget/repro/tree/`, identity allowlist staged in `…R3/identity/proposed/`, while B13 shows production code unchanged since 2026-09-20; B27 shows a fourth tree appearing mid-pass | a remedy is "landed" only when the shipped bytes change and the gate of record is re-run **in the same session**; otherwise it is named *staged*; no plan may cite the number of plans, briefs or delegation trees as movement (extends C31) |
| **C38** | **importing the package is a write into the package** | B28: 7 `__pycache__/*.pyc` inside `monitoring/freecash/` at 11:36 from this session's own imports | a footprint statement either names the `__pycache__` writes or the invocation sets `PYTHONDONTWRITEBYTECODE=1`; a delegation rule forbidding writes under `monitoring/freecash/**` must state that byte-code caches are exempt, otherwise it is unsatisfiable by a session that runs the tests |

---

## 2. Stages — each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

**Ordering (V12's, adopted):** `S1 → S2 → S3 → S5 → S6`; `S4`, `S7`, `S8`, `S9` parallel; `S10` separate and human-gated; **new `S11` (authority note) may run any time and is required before S6**. One change between gate runs. Never create a second gate, harness, monitor or state root (C8/C16). A stage is complete only on output produced in the claiming session (C30).

**S1 — Day-budget remedy (the defect behind this morning's incident; remedy staged, not landed).**
Expected Effort: ~40 min to port the staged fix (O-1) · 3–5 h (O-2) · ~1 h (O-3) · 3–6 h (O-4) · 0 h (O-5). Time-to-Revenue: **none** (C20). Dependencies: none; donor at `…R3/daybudget/repro/tree/monitoring/freecash/` + `failing-test-first/test_daybudget_data_less.py` (`sibling`, mtime 09:44 — re-read before use, C30).
First Concrete Action: write the **failing test first** against the shipped package — *"a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog print `WATCHDOG_MISSED_DAY`"* — confirm RED (B11 is the code that makes it fail), then port and re-run in the same session.
Exit: data-less run ⇒ no lock, no snapshot, `last_success_day` unchanged, miss counter preserved, `WATCHDOG_MISSED_DAY`; reading-present run ⇒ exactly one lock, one snapshot, `SKIP_DUPLICATE_DAY` on the second; shipped bytes changed (C37).
Options: **O-1 port the staged two-phase accounting (~40 min)** · O-2 own two-phase lock + accounting (3–5 h; state that this weakens "one read per day" to "one *successful* read per day") · O-3 wrapper pre-flight only (~1 h; insufficient alone) · O-4 O-2+O-3 · O-5 stay manual (0 h).

**S2 — Name the gate of record, then port (C36).** *V12's S2, with the R3 self-contradiction added as an acceptance item.*
Expected Effort: 1–2 h for the divergence matrix; **2–4 h** for the port. Time-to-Revenue: none. Dependencies: the **four** gate files — `scripts/monitoring/rule_gate_verify.py` (shipped, RED, no `--package`), `DELEGATION-2026-09-30/verifier/rule_gate.py` (green 9/9, B15), `DELEGATION-2026-10-01-R3/gate/rule_gate.py` (69 598 B, sha head `11b605f2…`, green, B16), `DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py` (red on the same bytes, B17). **Do not create a fifth** (C8/C16).
First Concrete Action: build the matrix `gate × {live package, S1-repaired copy, each mutant}` with exit codes as raw output, explain the B17 contradiction at `file:line`, and name the gate whose per-rule verdicts match the reproduced defect behaviour; then port its detectors under a new `--package` flag on the shipped verifier and retire the staged copies from the verdict trail.
Exit: `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** non-zero on every mutant with the correct rule named (C25/C29); **one** gate reachable from the repo root (C23/C36); the staged files labelled `staging — not acceptance`.
Options: **O-A′ port from the R3 gate detectors (2–4 h; it closes 10/10 mutants — B18) and retire the staged copies** · O-B′ port the 09-30 detectors (2–4 h; its `adv3`/`adv4` rows are open at mtime 09:26) · O-C′ adopt a staged gate as-is (0.5 h; **rejected** — B17 shows it ships a self-contradiction) · O-D′ operator override of C9 (0.2 h; removes the automatable gate).

**S3 — First real operator reading (fastest honest path to a number).**
Expected Effort: 0.5–1 h once + ~60 s/day. Time-to-Revenue: **same-day visibility only** (C20). Dependencies: S1, a decision on the spent `2026-10-01` key (B5), a free `day_key`, the venv interpreter (C10).
First Concrete Action: the operator logs into their own dashboard and appends **one** record for a free `day_key` to `data/freecash-monitor/state/operator-state.json` (`records: []` — B9), then the routine runs once and the `RUN_OK … outcome=INITIAL_BASELINE` line is quoted.
Exit: a day-1 snapshot with `data_available:true`; a later changed figure produces exactly one payload and one approval item. Honest limit: every snapshot from this source is `degraded: true` by construction.

**S4 — R4 identity allowlist instead of denylist.** Expected Effort: ~1 h on a copy + ~1 h to update the gate detector that depends on the old defect. Time-to-Revenue: none. Dependencies: staged proposal `…R3/identity/proposed/approval_queue.py` + patch (mtimes 09:32–09:33) and the both-directions test `…R3/identity/test_identity_allowlist.py`. First Concrete Action: one run — `hermes-agent` refused (exit 4) / operator name accepted, `execution_state` still `NOT_EXECUTED` — then port into the shipped file (C37). Exit: only allowlisted humans can sign; the safety property (frozen fields, no execution path) stated separately from the attribution property.

**S5 — Make R3 falsifiable for a human, offline.** Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S1, S3, scratch root. First Concrete Action: day-1 record → `INITIAL_BASELINE` with `notifications=0`; day-2 record with one changed figure → exactly one `EARNINGS_CHANGED`; repeat → `DEDUPED`. Exit: the notify path has fired for a human-entered change at least once, with dedupe shown.

**S6 — Trigger decision packet; register nothing.** Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: S1, S2, S5, **S11**. First Concrete Action: re-parse both `DECISION-V2-*.xml` payloads in this consumer (`ET.parse` exit 0 — four files parsed clean at B24, C26/C30), confirm the pinned interpreter and `IgnoreNew` + `StartWhenAvailable` + **Do not restart** inside the XML, then hand over the `schtasks /Create /XML` text only. Current state: 278 tasks, **0** Free Cash (B23). Exit: parse exit 0 quoted; the exact command dry-run against a scratch root; a written packet naming the command, the missed-day semantics and the behaviour when the trigger does **not** fire — or an explicit decision not to schedule.

**S7 — Concurrency flake (C28).** Expected Effort: 1–3 h. Time-to-Revenue: none. Dependencies: none; must land before any timer. First Concrete Action: reproduce `3 != 4` with N=26 suite runs in a pinned scratch root (B20 is the starting artefact; B19 is this pass's 6/6), instrumenting **writer count per run**. Exit: 26 consecutive green runs, and every future attestation quotes N and the failure count. Options: **diagnose then fix (1–3 h)** · assert the lock-file count (0.5–1 h; weaker, say so) · `xfail` (**rejected**).

**S8 — Alert attribution + catch-up coalescing (C14/C22).** Expected Effort: 1–2 h. Time-to-Revenue: none. First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — **all 15 carry none** (B8) — and coalesce catch-up so N missed days arrive as one payload. Exit: a line's origin is identifiable from the line; the next bundle's baseline includes the 2026-09-21 unattributed line, the 09-30 burst and today's line.

**S9 — Deprecation index (delete nothing, C8/C16).** Expected Effort: 1–2 h, read-only. First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` covering `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs` (**does not parse**: `node --check` exit 1, line 41 — B22), `server/scripts/verify-freecash-rules.mjs` (**do not cite**: 4/4 PASSED, exit 0, certifying that file) and `server/src/adapters/freecashMonitorAdapter.ts`, each with its gate command. Exit: index exists; nothing moved or deleted.

**S10 — The revenue path (carried so it is not silently dropped, C20).** Expected Effort: unknown (a human decision first). Time-to-Revenue: **the only stage with a direct revenue hypothesis, and it is unbounded.** Dependencies: human decision, the app running (down in this pass — B25), a publication step that does not exist. First Concrete Action: with the app running and the port re-measured (C35), resume `bgtask-07a8154b0` in the UI (`blocked`, `resumable=0` — `inherited`, re-quote live). Options: **R-a resume (1–2 h, unknown TTR)** · R-b implement publication (unbounded) · **R-c monitor only (0 h, 0 revenue — honest default while S1/S2 are red)**.

**S11 — Authority note: one gate of record, one plan of record, no new trees (new; scoped by C37).**
Expected Effort: 30–60 min, read-only plus one short file. Time-to-Revenue: none — false-confidence control. Dependencies: none (parallel; required before S6).
First Concrete Action: write `docs/free-cash-monitor-routine/NEXT-PASS-AUTHORITY.md` naming (a) the gate of record with path + sha256 head (four candidates, B14–B17), (b) the plan of record and what each of V11/V11B/V12/V12B supersedes, (c) the four delegation trees with mtimes and which stream was still writing (`-R4` at 11:43, B27), (d) that tree/document counts are not progress (C31/C37).
Exit: the note exists, and a reader can determine the gate of record and the plan of record in one step; no new delegation tree is created after it (or the reason is recorded).

---

## 3. Options at a glance (every option carries all four columns)

| Stage | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| S1 day budget | **O-1 port the staged fix** | ~40 min | none | staged donor (09:44) | failing test first, then port; gate of record re-run |
| S1 day budget | O-2 two-phase lock + accounting | 3–5 h | none | none | failing test first |
| S1 day budget | O-3 wrapper pre-flight | ~1 h | none | S6 wrapper | guard on today's key (**insufficient alone**) |
| S1 day budget | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| S1 day budget | O-5 stay manual | 0 h | none | none | say plainly: unattended operation stays blocked |
| S2 gate | **O-A′ port the R3 detectors + retire staged copies** | 2–4 h | none | R3 gate (10/10, B18) | `--package` on the shipped verifier; mutants named by rule |
| S2 gate | O-B′ port the 09-30 detectors | 2–4 h | none | 09-30 gate (9/9; two evasions open at 09:26) | close `adv3`/`adv4`/`adv6` yourself |
| S2 gate | O-C′ adopt a staged gate as-is | 0.5 h | none | none | **rejected** — B17 self-contradiction, C36 |
| S2 gate | O-D′ operator override of C9 | 0.2 h | none | operator sign-off | lose the automatable gate |
| S3 read source | **operator-entered file** | 0.5–1 h + 60 s/day | **same day, visibility** | S1, free day key, venv interpreter | type one record; expect `INITIAL_BASELINE` |
| S3 read source | `:4600` auth route | 0 h this pass | none this pass | a live listener (B25: `000`) | re-measure the port first (C35) |
| S3 read source | provider read contract | 2–4 h if an account exists | 3 days–2 weeks | confirmed account + out-of-repo token | one operator-authorised `GET`, values `[REDACTED]` |
| S3 read source | provider session automation | unknown | unknown | identity + session + credential | **BLOCKED** — off the critical path |
| S4 identity | **apply the staged allowlist + update the gate detector** | ~1 h + ~1 h | none | staged proposal (09:32) | both directions in one run |
| S4 identity | record the denylist as accepted residual | 0.2 h | none | operator sign-off | state that `hermes-agent`/`assistant`/`claude` are accepted today (B12/B29) |
| S5 notify | offline day-1 → day-2 change demo | 1–2 h | none | S1, S3 | one `EARNINGS_CHANGED`, then `DEDUPED` |
| S6 trigger | **handover only (no registration)** | 1–2 h | none | S1, S2, S5, S11 | re-parse both payloads; confirm interpreter + `Do not restart` |
| S6 trigger | register now | <1 h | none | C9 green (it is not) | **rejected** — flaky gate is a red gate (C28) |
| S7 concurrency | **diagnose then fix** | 1–3 h | none | none | 26 runs; instrument writer count |
| S7 concurrency | assert the lock count, not the winner | 0.5–1 h | none | none | state that the invariant is weaker |
| S7 concurrency | `xfail` the flake | 0.2 h | none | none | **rejected** — removes the only concurrency evidence |
| S8 attribution | writer tag + catch-up coalescing | 1–2 h | none | none | tag every new line; include the 15 unattributed in the baseline |
| S9 index | implementation index | 1–2 h (read-only) | none | none | write the index; delete nothing |
| S10 revenue | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume the blocked task in the UI |
| S10 revenue | R-b implement publication | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| S10 revenue | R-c monitor only | 0 h | none | none | say plainly: visibility, not cash |
| S11 authority | **authority note + freeze new trees** | 30–60 min | none | none | name the gate of record and the plan of record |

---

## 4. Blocked register

| Item | Blocked on | Reason (verified in this pass) |
|---|---|---|
| Acceptance gate green (C9) | S2 port | shipped gate `R1=FAIL`, exit 1, rejects `--package` (exit 2) (B14) |
| "One gate" (C8/C16/C23) | S2 retirement | **four** gate files; two of them live in one tree and disagree (B16/B17, C36) |
| C25/C29 closed **in the shipped gate** | S2 | open at mtime 09:26 (`adv3`/`adv4` exit 0; `adv6` misattributed), closed at 09:35 (10/10, correct rule) (B18) |
| Trustworthy concurrency attestation | S7 | 3 of 26 runs red earlier (B20); 6/6 green here (B19) — N must be quoted (C28) |
| Any reading for 2026-10-01 | operator decision + lock removal | today's key spent at `08:53:46` on a null read (B4–B6) |
| Unattended scheduling | S1 **and** S7 **and** C9 | a null read spends the day *and* books it a success (B6/B11); the concurrency proof flakes (B20) |
| Trustworthy "monitor is alive" signal | S1 (C19) | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`; `watchdog.py:33` reports covered on a null snapshot (B11) |
| Live account status | app started **with a human session** + S3 bridge | `4600` refused (`000`, curl exit 7 at 11:42), **0 Electron processes** (B25) |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured (B26); only the toast is implemented |
| Any withdrawal or earning action | R4 approval surface | must never run unattended; the shipped decider guard is a denylist (B12) |
| Day-budget honesty **in production** | S1 port | remedy green only in `…R3/daybudget/repro/tree/` (B30, C37) |
| R4 identity provenance **in production** | S4 port | allowlist exists only as a staged patch (B29, C37) |
| Writer attribution (C14) | a code change or a documented operating window | 15 lines, none carrying a writer key (B8) |
| Revenue mission `bgtask-07a8154b0` | worker re-dispatch | `blocked`, `resumable=0` (`inherited`) |
| Publication of shopify-verified revenue | implementation | €19 verified `2026-08-19`; gates `resolved`; nothing published since (`inherited`) |
| A footprint claim of "nothing written under `monitoring/freecash/**`" | an invocation change | imports write `__pycache__/*.pyc` there (B28, C38) |
| Elevated task registration | elevated shell | non-elevated host by policy |

---

## 5. Decisions this plan asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | S1 remedy: O-1 port / O-2 / O-3 / O-4 / O-5 | operator | unattended runs keep spending a day and hiding it |
| D-2 | the spent `2026-09-30` / `2026-10-01` keys: accept or remediate | operator | each new day inherits a spent key |
| D-3 | S2: **which gate is the gate of record**, and are the three staged copies retired from the verdict trail (C36) | operator | four contradictory verdicts stay quotable; C9 stays red |
| D-4 | S7 remedy: diagnose / weaker invariant / `xfail` | operator | concurrency stays uncertified (C28) |
| D-5 | authoritative read source: operator-entered / `:4600` / provider | operator | every snapshot stays `degraded: true` |
| D-6 | when the app is started, and by whom (C17) | operator | the authenticated path stays unreachable (B25) |
| D-7 | `verify-freecash-rules.mjs`, `freecash-daily-monitor.mjs`, `freecashMonitorAdapter.ts`: label now, remove once unused | operator | a 4/4 green certifying an unparseable file stays available (B22) |
| D-8 | state-root disposition, incl. `server/data/freecash-monitor/` | operator | two roots can silently diverge |
| D-9 | revenue: R-a / R-b / R-c | operator | the money path stays at €19 verified 2026-08-19 |
| D-10 | S11: which plan is of record, which trees are frozen, does `-R4` continue | operator | readers keep re-deriving state that moved minutes ago (B27, C30/C37) |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — disable and label, never delete. No live financial write path in any option. No compliance claim from a static grep, a stale artefact, a PASS quoted from another session (C5), or a gate that is not the gate of record (C36). No modification of the 870 pre-existing dirty paths (C7). No second/third/fourth/fifth gate, harness or monitor (C8/C16) — the port must **reduce** the count. **No further plan, brief or delegation may be counted as progress (C31); a green copy is not a repair (C37).** No voice/Jarvis runtime path touched. No editing of the sibling trees or of `…-V12-2026-10-01.md` — read-only inputs. **This routine produces visibility, not revenue** (C20): no option outside S10 has a revenue time-to-value.

## 7. Definition of done

1. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** non-zero on every mutant with the correct rule named (S2); exactly **one** gate reachable from the repo root; staged copies labelled `staging — not acceptance` (C23/C36).
2. `python monitoring/freecash/tests/run_all.py` → **26 consecutive** runs `tests=52 failures=0 errors=0` with the concurrency race asserted under load (S7, C28); both R1 scanners exit 0 at pinned `exempt=28` (B21).
3. A data-less run leaves no lock, writes no snapshot, does not advance `last_success_day`, does not reset `consecutive_missed_days`, and is reported `WATCHDOG_MISSED_DAY` — **in the shipped file**, not in a `repro/tree/` copy (S1, C37; today's run does the opposite — B6/B11).
4. One real reading consumed, one real change notified exactly once, one approval item decided by a named human with the guard being an **allowlist in the shipped file**, `execution_state` still `NOT_EXECUTED` (S3/S4/S5).
5. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record (S3/S6).
6. Watchdog: healthy day silent; uncovered day exactly one alarm; multi-day catch-up arrives as **one** payload naming N and the day keys (S6/S8, C22).
7. Every `alerts.jsonl` line attributable to a known writer (S8, C14).
8. Both payloads re-parse (`ET.parse` exit 0, C26) in the handing-over session, quoted with the pinned 3.11.9 interpreter and **Do not restart** — or an explicit recorded decision not to schedule (S6).
9. No credential anywhere (C6); no unrelated dirty path modified (C7); no earning action performed by anything (R1).
10. Every stage states its Time-to-Revenue; no stage outside S10 claims a path to cash (C20); every "progress" sentence names changed bytes and a gate exit code (C31/C37).
11. Every pass states its `FREECASH_DATA_ROOT`, quotes the production-root hash pair before/after (C21), and names any `__pycache__` write inside the package (C38); every quoted sibling artefact carries its mtime (C27/C30).
12. The `2026-09-30` and `2026-10-01` decisions are recorded with the operator's name, and every later status says both days were spent by runs that read nothing.
13. `NEXT-PASS-AUTHORITY.md` exists: the gate of record and the plan of record are determinable in one step, and no fifth gate, tree or plan appears without a recorded decision (S11).

**Honest one-line reading of 2026-10-01 (11:56):** the routine runs, refuses duplicates and writes a real evidence trail — and this morning it spent the production day on a null read, booked it a success, reset its miss counter from 9 to 0 and silenced the watchdog it feeds; the shipped acceptance gate is red and cannot accept a directory, the three staged gates yield four verdicts on the same bytes with two of them from the same tree, and the newest one still closes all ten mutants with the correct rule named; both production remedies are green only inside delegation trees; the concurrency test was 6/6 green here against 3/26 red earlier; the payloads parse, nothing is scheduled, the API path is down, and no reading has ever been entered.
**Shortest honest path to a first real number:** `S1 (O-1, ~40 min) → operator decision on the spent day → S3 (operator-entered figures, same sitting)`.
**Shortest honest path to a *trustworthy* monitor:** that path plus `S2 (O-A′, 2–4 h) + S7 (1–3 h)` before any timer is registered.

# PARENT BRIEF R4 — delegation of the workflow + research plan (reconciled)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD** `8f7463a` · **870** dirty paths
**Written:** 2026-10-01, pass window `11:37:50` → `11:44` local (`Do,  1. Okt 2026 11:37:50`; Europe/Berlin, UTC+02:00)
**Author:** parent session. **Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → `Python 3.11.9`
**Companion to, not a replacement for:** `DELEGATION-BRIEF-R4.md` (sibling session, **mtime 11:39**, read in this pass — contains the six-stream topology D/G/I/S/T/V and its own live baseline). This file does not overwrite it; it **reconciles** it and adds the three research streams nobody is running.
**Raw evidence for every number below:** `source/raw/00-parent-pass-2026-10-01-1142.txt`
**Plans of record in this tree:** `workflow/WORKFLOW-PLAN-R4.md` (execution order, effort/TTR/dependencies/first actions) · `research/RESEARCH-PLAN-R4.md` (open questions + stream acceptance bars)

**Footprint (disclosed, not assumed):** additive only — three new documents plus this brief and one raw evidence file, all under `DELEGATION-2026-10-01-R4/`. No existing file edited, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task or cron created. No provider network call. No credential read or printed. Scratch state under `%LOCALAPPDATA%\Temp\fcr4-*`. Production root **byte-identical before and after** (A2 = G10: `a287a902…`, `1b9c7c07…`, `be8becc3…`), and **zero** files under the production root newer than 11:30. **One real footprint is disclosed rather than claimed away:** importing the package wrote bytecode caches only — `monitoring/freecash/__pycache__/*.cpython-311.pyc` (11:36, 11:42). No `.py` under `monitoring/` or `scripts/monitoring/` has an mtime later than 2026-09-20 06:59; the count of non-`__pycache__` files touched today inside those trees is **0**.

---

## 1. The four operational rules (binding; number **and** title always printed together)

| # (operator numbering) | Rule | Hard boundary it must be enforced by |
|---|---|---|
| **R1 — zero automated earning actions** | observe only; no claim, cash-out, withdraw, redeem, offer or survey execution; no write-capable transport | `readonly_client.py` — deny-by-default method/host/path allowlist, no request body; `verify_readonly.py` static interceptor |
| **R2 — exactly one status read per operator-local (Europe/Berlin) calendar day** | one read per calendar day; a second run the same day performs **no read** | atomic `O_CREAT\|O_EXCL` day lock under `state/day-locks/<YYYY-MM-DD>.lock`, acquired **before** the read; day key from `Europe/Berlin` |
| **R3 — notify on earnings/status change, exactly once per change** | prior snapshot loaded **before** the new one is written; exact comparison; one change → one notification; "no change" never notifies | `changedetect.py` prior-load ordering + content-hash dedupe key persisted before dispatch; `notify.py` sink |
| **R4 — human approval before ANY external action; no execution path exists** | the routine may **enqueue only**; an approved item is never auto-executed; a timeout never converts pending → executed | `approval_queue.py` with `execution_state=NOT_EXECUTED`, `execution_allowed=False`, `expires_at_utc=None`, no execution call site |

**Numbering hazard (measured today, not inherited):** the *shipped* gate's output prints `R1 = status check at most ONCE per calendar day` and `R2 = NO automated earning action` — the inverse of the operator numbering used in every brief and in this file. The 2026-09-30 delivered gate and R3's gate use `RULE 1..4` in the operator order. Any artifact that prints a bare `R1`/`R2` is defective; print `R2 (once-per-day)` style labels.

## 2. Acceptance bar for every stream (unchanged by anything a sibling reports)

1. **Live evidence only.** Every claim is the output of a command in the claiming session; inherited PASS/hash/count is a violation (C5/C30).
2. **Failing-something proof.** A green result is accepted only with the demonstration that the same check goes **red** on a known-violation input (planted mutant, poisoned tree, absent reading, locked session).
3. **Name the gate file, its exit code, and the failing rule** per row (C23/C29: evasion = exit 0 with no rule failing; misattribution = non-zero via a different rule — reported separately, never summed).
4. **Hermeticity by hash:** throwaway `FREECASH_DATA_ROOT`; production hash triple before/after; `find <production root> -type f -newermt "<today> 00:00"` expecting only the four existing 08:53 files.
5. **Interpreter:** the 3.11.9 venv path quoted. 3.14 has no `tzdata` → `Europe/Berlin` unresolvable → `MONITOR_DEGRADED`, which corrupts every day-key result.
6. **Never spend the production day:** the entry point is never invoked against `data/freecash-monitor` (today's key was spent at 08:53 by a run that read nothing).
7. **Write scope:** own stream directory only. `monitoring/freecash/**`, `scripts/monitoring/**`, `data/freecash-monitor/**` and sibling delegation trees are **read-only**. If a sibling's file already occupies your intended filename, read it, cite its mtime, and write under a distinct name — never overwrite another session's work.
8. **Propose, do not apply:** fixes land as a diff/repro under your own directory.
9. **No secrets** (`[REDACTED]`, length only), **no non-loopback socket**, **no `schtasks /Create`**, **no cron registration**, **no external action** — registration stays human-owned (R4).
10. **A document is not progress** (C31): progress = changed implementation bytes + a gate run in the same pass.

## 3. Live state at 11:44 — measured in this pass

| # | Fact | Observation | Consequence |
|---|---|---|---|
| 1 | Day `2026-10-01` is **spent** | `state/day-locks/2026-10-01.lock` (08:53); `snapshots/2026-10-01.json` `data_available=false`, four figures `null` (`raw_response_sha256 = e3b0c442…` = sha256 of the empty string) | no reading remains for today |
| 2 | A data-less run is booked a **success** | `last-run.json`: `last_attempt_day = last_success_day = 2026-10-01`, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`** (was 9) | the watchdog keyed on this ledger reports a null day as covered → no trustworthy liveness signal |
| 3 | **Second consecutive** spent day | `2026-09-30.lock` (21:01) with a 518-byte null snapshot | the defect is a production incident, twice reproduced |
| 4 | **Defect re-confirmed by me** | `docs/…/DELEGATION-2026-10-01-R3/daybudget/failing-test-first/test_daybudget_data_less.py` → `Ran 7 tests`, `FAILED (failures=6)`, exit **1**; each data-less run printed `lock=2026-10-01.lock … snapshot written=True` | the top defect is live on the shipped package; **6 of 7 day-budget assertions are RED** |
| 5 | Remedy **missing** | `DELEGATION-2026-10-01-R3/daybudget/remedy/` is an **empty directory** (verified) | the fix does not exist; only the failing test does |
| 6 | R3's gate artifacts exist | `…R3/verifier/rule_gate_r3.py` (09:36), `…R3/verifier/mutation_harness_r3.py` (09:37) | a third package-scope gate exists as a delegation artifact, not as the repo's gate |
| 7 | Shipped gate is **RED** | `rule_gate_verify.py monitoring/freecash/run_daily_check.py` → `R1=FAIL R2=PASS R3=PASS R4=PASS`, exit **1** (its R1 = once-per-day, file-scoped; the lock lives in `gate.py`) | no green automatable acceptance gate |
| 8 | Shipped gate **cannot even see a package** | `--package` → `error: unrecognized arguments`, exit **2** | C9 blocked on a port, not a rewrite |
| 9 | Delivered gate (2026-09-30, mtime 21:09) is **green** | `rule_gate.py --package monitoring/freecash --workdir <temp>` → `R1=R2=R3=R4=PASS`, `COMPLIANT`, exit **0**; rule 4 alone ran 20 checks | a working package scope exists to port |
| 10 | Static read-only gate green | `verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0`, exit **0** | R1 has a real interceptor with a 28-entry baseline |
| 11 | Legacy monitor **does not parse** | `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` line 41, exit **1** | never executed; must never be cited as compliant |
| 12 | Suite green **this run** | `FREECASH_DATA_ROOT=<temp> python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0`, exit **0** (N=1) | a single green run is not attestation: a sibling measured 3 red in 26 (`3 != 4`) |
| 13 | Operator source **empty** | `operator-state.json` `records = []` | 11th day with no reading; the routine has never held a live number |
| 14 | Approval queue **never used** | `data/freecash-monitor/approvals/` is empty (the sibling brief's `pending.json` absent claim is confirmed) | the R4 path has never been exercised in production |
| 15 | Alert trail unattributed | 15 lines, keys `day_key, dedupe_key, event_id, event_type, message, observed, severity, ts_utc` — no writer/pid key on any line | one unattributed writer per day |
| 16 | Code **frozen** | newest `monitoring/freecash/*.py` mtime **2026-09-20 06:59** | 12 days of documents, zero implementation change (C31) |
| 17 | Nothing triggers the routine | 278 scheduled tasks, **0** Free Cash; `hermes cron list` → `No scheduled jobs.` | R2's once-per-day property rests on a trigger that does not exist |
| 18 | Mutant material present | `…R2/verifier/mutants/`: control + 8 semantic mutants (`r1-a-lock-removed`, `r1-b-lock-nonbinding`, `r2-a-post-cashout-on-read-path`, `r2-b-urllib-write-path`, `r3-a-baseline-is-current`, `r3-b-sub-dollar-threshold`, `r4-a-nonhuman-decider-accepted`, `r4-b-arms-on-approve`) | the port has its acceptance material already |
| 19 | R4 identity guard is a **denylist** | ten refused words; `hermes-agent` is **accepted** | "only a human can sign" is false today, while "an approval cannot arm an action" holds |

**One-line status (11:44):** the routine runs, refuses a duplicate day and writes a real evidence trail — but this morning it **spent the production day on a null read, booked it a success, reset its own miss counter 9 → 0 and silenced the watchdog it feeds**; the failing day-budget test exists (6 of 7 RED) while the remedy directory is **empty**; the repo's own gate is red and cannot accept a directory while two delegation gates disagree about the same tree; nothing is scheduled; no reading has ever been entered; and **the research questions about real account state are still open** — which is what the three streams below exist to close.

## 4. Delegation topology — how this dispatch relates to the sibling's six streams

Read `DELEGATION-BRIEF-R4.md` (**mtime 11:39**, sibling) beside this file. Its streams `D` (day budget) / `G` (gate authority) / `I` (identity) / `S` (source + first reading) / `T` (trigger) / `V` (adversarial verifier) own the **implementation and authority** questions. This dispatch does **not** restate them and does **not** write into their directories. It adds the three streams that no sibling is running, each in a directory no sibling uses:

| Stream (this dispatch) | Directory | Question | Overlap declared |
|---|---|---|---|
| **P — provider read-only contract** | `provider/` | Is there a **documented read-only** path to real account state (balance/earnings/status) that R1 permits? | none — no sibling stream touches public provider contracts |
| **A — app-path bridge** | `apppath/` | What artefact carries the already-authenticated app state, does it survive an app restart, and what exactly is the four-field mapping into `operator_state.py`'s shape? | partial with sibling `S` (which re-measures sources and demonstrates R3 end-to-end offline); **A owns the mapping + artefact durability**, S owns the end-to-end demo — coordinate by reading, not by merging |
| **L — delivery/sink inventory** | `delivery/` | Which notification sinks exist in `notify.py`, which are reachable **without** new credentials, and what does a locked/unauthenticated session produce (bounded failure)? | none — sibling `S` counts notifications, no stream owns sink reachability |

Their acceptance bars are in `research/RESEARCH-PLAN-R4.md` §2 (RS-1/RS-2/RS-4), each stated as a **failing-something** proof. Execution order, effort, time-to-revenue, dependencies and first concrete actions for the whole routine (including the sibling's stream outputs as inputs, never as inherited facts) are in `workflow/WORKFLOW-PLAN-R4.md`.

**Dependency note that binds this dispatch:** streams P/A/L are independent of each other and of D/G/I/S/T/V. None of them may unblock scheduling (S7) on its own; S7 additionally requires a green gate of record (sibling `G`), the day-budget remedy (sibling `D`, currently missing), and a concurrency attestation quoting N.

## 5. Reconciliation rules for concurrent sessions in this tree

1. A sibling artifact is evidence only after being **re-read and re-measured in the claiming pass**; quote its mtime when you cite it (C30). The sibling brief at 11:39 reports a live baseline measured 11:36–11:43 — treat it as a lead, not as a fact.
2. Filenames in this tree are **already taken**: `DELEGATION-BRIEF-R4.md`, `RESEARCH-PLAN.md`, `RESEARCH-PLAN-R4.md`, `WORKFLOW-PLAN-R4.md` all exist. Do not overwrite; suffix instead.
3. Where two sessions disagree, the disagreement is **recorded as a finding** (which pass, which command, which exit code) rather than resolved by seniority. The three-gates-three-verdicts contradiction the sibling reports is exactly such a finding and must be re-measured before it is cited.
4. Untracked-tree editing produces **no reviewable diff**: `monitoring/`, `scripts/monitoring/rule_gate_verify.py` and `data/freecash-monitor/` are untracked, so any in-place edit is invisible to review. Streams therefore propose diffs under their own directory and never patch in place.

## 6. Hand-off

The operator receives: three research deliverables (P/A/L) with raw evidence and isolation hash pairs, a workflow plan whose every stage carries Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action, and an explicit list of what stays **BLOCKED with the reason** — never presented as done. Nothing is scheduled, nothing is executed against the production root, no external action is taken: R1–R4 are intact at hand-off, with the hash pair to prove it.

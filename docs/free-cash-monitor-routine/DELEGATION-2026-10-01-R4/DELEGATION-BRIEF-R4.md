# DELEGATION BRIEF R4 — daily status monitoring routine, Free Cash Finance Automation

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a` · **Host:** Windows 11 (de-DE locale), git-bash (MSYS), non-elevated
**Written:** 2026-10-01, 11:36–11:44 operator-local (`date` → `Do,  1. Okt 2026 11:37:19`, Europe/Berlin UTC+02:00)
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (3.11.9, `tzdata 2025.3`; `ZoneInfo("Europe/Berlin")` resolves). The system `py -3` is 3.14 and has **no** `tzdata`.
**Subject:** the once-daily, read-only status routine for Free Cash Finance Automation — canonical package `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`.
**Supersedes nothing.** Additive to `DELEGATION-BRIEF-R3.md` (09:23–09:44), which it reads and continues; R4 exists because two of R3's four streams returned proposals with **no remedy applied and no acceptance gate of record**, and because three gates now return three different verdicts on the same code.
**Evidence standard:** every row of §2 is a command **I executed in this pass**. No PASS, hash or count is inherited from R3 or from any sibling document.
**Footprint:** this brief and `RESEARCH-PLAN.md` are **new** files under `DELEGATION-2026-10-01-R4/`. No existing file edited, moved or deleted. No `git add/commit/stash/reset/restore/checkout/clean`; no scheduled task created; no cron job registered; no provider network call; no credential read. Routine and gate invocations used throwaway roots under `%LOCALAPPDATA%\Temp\fc-baseline-*`; the production root's hashes are byte-identical before and after (§2 A12).

---

## 1. The four operational rules (binding specification — the operator's own wording)

| # | Operator rule (verbatim intent) | Enforcement layer that must hold it |
|---|---|---|
| **R1** | **No earning action automatically.** The routine observes only. | Deny-by-default interceptor: `ALLOWED_METHODS={GET,HEAD}`, loopback hosts, path allowlist, no request body. `readonly_client.py` is the only network path. |
| **R2** | **Check status once per day.** At most one status read per operator-local calendar day. | Atomic `O_CREAT\|O_EXCL` day lock keyed on the Europe/Berlin calendar date, acquired **before** the read; duplicate-day branch performs no read. |
| **R3** | **Notify me if earnings or account status changes.** | Prior snapshot loaded **before** the new one is written; exact-equality comparison; content-hash dedupe key persisted **before** dispatch. |
| **R4** | **Human approval before any external action.** Nothing auto-executes. | Routine may **enqueue only**; `execution_state=NOT_EXECUTED`, `execution_allowed=False`, `expires_at_utc=None`; no execution site exists; a timeout cannot convert PENDING → EXECUTED. |

### ⚠ Numbering hazard — carry the title with the number, always

The same four rules carry **two different numberings** in this repo. The *operator* numbering above (R1 = no earning action, R2 = once per day) is binding for this delegation; the *shipped code's own docstrings* are **inverted**:

| Operator rule | Shipped `gate.py:1` docstring | Shipped `readonly_client.py:1` docstring | R3 delivered gate |
|---|---|---|---|
| R1 no earning action | *(unlabelled)* | labels it **R2** | `RULE 1` ✅ agrees |
| R2 once per day | labels it **R1** | — | `RULE 2` ✅ agrees |
| R3 notify on change | R3 | — | ✅ agrees |
| R4 approval first | R4 | — | ✅ agrees |

Every artifact produced under this brief must print the rule **title plus both numberings** on first use. A reader who takes "R2 = once per day" from this brief and then reads `gate.py`'s `R1` will mis-map the two.

---

## 2. Live baseline, measured in this pass (all commands executed 11:36–11:43 local)

| # | Command | Observed result | Verdict |
|---|---|---|---|
| A1 | `date`; `python -V` | `Do,  1. Okt 2026 11:37:19`; `Python 3.11.9` (`…/hermes-agent/venv/Scripts/python`) | clock + interpreter of record confirmed |
| A2 | `ls -la data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock` (08:53)** | **today's day key is already spent** — by a run that read nothing. Today cannot be read again without a human removing the lock. |
| A3 | `grep last_* data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0` | a **null read is booked as a success day**; the miss counter was reset 9 → 0 by it |
| A4 | `sha256sum` on the three production state files | `last-run.json a287a902…293bf9`, `alerts.jsonl 1b9c7c07…9399a8`, `operator-state.json be8becc3…3eca59c` | the pin this pass is hermetic against |
| A5 | `python -c "json.load(operator-state.json)['records']"` | `records = 0` | **no operator reading has ever been entered** — the routine has never held a live number |
| A6 | `cat data/freecash-monitor/approvals/pending.json` | `No such file or directory` | the approval queue has never held an item; R4 path is unexercised in production |
| A7 | `python monitoring/freecash/tests/run_all.py` (scratch `FREECASH_DATA_ROOT`) | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit **0** | offline suite GREEN this run |
| A8 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` → `PASS`, exit **0** | R1 static scanner green at baseline **28** |
| A9 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` → `VERDICT: NOT COMPLIANT -- 1/4`, exit **1** | the **shipped** acceptance gate is RED. It is **file-scoped**: `run_daily_check.py` alone has no `O_CREAT\|O_EXCL` and no day-key derivation, because both live in `gate.py`. |
| A10 | R3 `verifier/rule_gate_r3.py` + `mutation_harness_r3.py` (read from `harness-run.txt`, re-run required) | 10/10 mutants `DETECTED=YES`, harness exit 0 | a package-scoped gate **does** exist and **is** mutant-closed — but it is a delegation artifact, not the gate the repo runs |
| A11 | R3 `verifier/evidence/mutation-harness-result.json` — `CTRL` row (repaired package: `MONITOR_DEGRADED` removed from `SUCCESS_OUTCOMES`, decider guard made an allowlist) | R3 gate `exit=0 1=PASS 2=PASS 3=PASS 4=PASS` · 2026-09-30 gate `exit=0 4/4 PASS` · **2026-10-01 gate `exit=1`, R4 FAIL on the repaired package** | **three gates, three verdicts on the same tree.** No acceptance gate of record exists. One of them is wrong about the repair, and nobody has said which. |
| A12 | `sha256sum -c` (pre/post) + `find data/freecash-monitor -type f -newermt "2026-10-01 11:30"` | both files `OK`; **zero** new/modified files | sandbox isolation proven by hash, not by intention |
| A13 | `FREECASH_DATA_ROOT=<scratch> FREECASH_ROUTINE_DIR=D:/AgenticOS/monitoring/freecash python …/R3/daybudget/failing-test-first/test_daybudget_data_less.py` | `Ran 7 tests … FAILED (failures=6)`, exit **1** | **the top defect is live and re-confirmed by me**: 6 of 7 day-budget tests are RED against the shipped package |
| A14 | `grep -n SUCCESS_OUTCOMES -A 10 monitoring/freecash/gate.py` | `gate.py:32-40` lists `MONITOR_DEGRADED`; `gate.py:198` advances `last_success_day` for it | root cause of A3 unchanged |
| A15 | `grep -n covered monitoring/freecash/watchdog.py` | `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | the watchdog is silenced by the same conflation: *"the monitor ran"* is treated as *"a reading exists"* |
| A16 | `grep -n NON_HUMAN_DECIDERS -A 4 monitoring/freecash/approval_queue.py` | `frozenset({"system","routine","automation","agent","cron","scheduler","monitor","bot","script","machine"})`, checked at `:153` | R4 identity guard is a **denylist** → `hermes-agent`, `assistant`, `claude` are all accepted today |
| A17 | `schtasks /query /fo LIST \| grep -i "free.?cash"`; `hermes cron list` | *(no match)*; `No scheduled jobs.` | **nothing triggers the routine.** R2 is enforced by a lock nobody's scheduler honours. |
| A18 | `git status --porcelain` (repo-wide) | 868+ pre-existing modified/untracked paths incl. `?? monitoring/`, `?? scripts/monitoring/rule_gate_verify.py` | the routine **and both gates are untracked** — edits produce no reviewable diff |
| A19 | R3 `source/SOURCE-DECISION.md` (read this pass) | RANK 1 operator-entered file (**reachable, yields all four fields**) · RANK 2 `GET /api/projects/:id/freecash/auth` on `:4600` (200, auth state only) · RANK 4 `metrics_http` **404** | the only source that can feed the comparison today is the human-entered file; the wire source is dead |

**One-line status:** the routine runs, refuses a duplicate day, and writes a real evidence trail — but this morning it **spent the production day on a null read, booked it as a success, reset its own miss counter 9 → 0 and silenced its own watchdog**; nothing is scheduled, no reading has ever been entered, the shipped acceptance gate is red, three gates disagree, and the one defect that explains all of it (R2 day budget) has a failing test and **no remedy** (R3's `daybudget/remedy/` is empty).

---

## 3. What R3 closed, and what is genuinely open

| R3 stream | Delivered | Status entering R4 |
|---|---|---|
| gate | `verifier/rule_gate_r3.py`, 4 detectors, mutation harness — **10/10 mutants caught**, including `adv3-r4-getattr-exec`, `adv4-r1-conditional-backdoor`, `adv6-r1-new-socket-file` | **CLOSED as an artifact**; **open as authority** — it is not the gate the repo runs, and A11 shows it disagrees with two others |
| identity | `identity/proposed/approval_queue.py`, `approval-allowlist.patch`, `human-deciders.example.json`, both-directions test | **PROPOSED, not applied** — shipped guard is still the denylist (A16) |
| source | `SOURCE-DECISION.md`, probes, ranked table | **CLOSED** — re-measure only |
| daybudget | `failing-test-first/test_daybudget_data_less.py` (7 tests, 6 RED — re-confirmed A13), `repro/` | **REMEDY MISSING** — `daybudget/remedy/` is an empty directory. This is the #1 open item. |

Open items carried into R4, in priority order:
1. **Day budget (R2 + R3 credibility).** A data-less run consumes the day, advances `last_success_day`, preserves no miss streak, silences the watchdog, and writes a null snapshot. The failing test exists; the fix does not.
2. **Gate authority.** Which single gate is the acceptance gate of record, and does it close the mutant set *and* pass the repaired package? (A9, A10, A11 disagree.)
3. **R4 identity.** Denylist → allowlist, proven both directions in one run.
4. **Rule 3 has never fired for a human.** No reading ever entered (A5); no change ever observed; nothing scheduled (A17). R3 is currently unfalsifiable in production.
5. **Scheduler.** R2's once-per-day property depends on a trigger that does not exist.

---

## 4. Delegation topology — six streams, dispatched in parallel

| Stream | Directory | Question it must answer | Acceptance bar — the **failing-something** proof |
|---|---|---|---|
| **D — day budget** | `…-R4/daybudget/` | Can a data-less run be made to **not** consume the day and **not** advance success, while a reading-present run still consumes exactly one day? | Run R3's `test_daybudget_data_less.py` (7 tests) against a **copy** of the package: **6 RED → 7 GREEN** in one run, command + exit + raw output. Then: data-less run → `day-locks/` empty, `last_success_day` unchanged, `consecutive_missed_days` preserved, watchdog prints `WATCHDOG_MISSED_DAY`, **no snapshot written**; reading-present run → 1 lock, 1 snapshot, second run `SKIP_DUPLICATE_DAY`. Full 52-test suite still `failures=0`. **Deliver `remedy/` with a runnable diff — R3 left it empty.** |
| **G — gate authority** | `…-R4/gate/` | Of the three gates (shipped `scripts/monitoring/rule_gate_verify.py`, `DELEGATION-2026-09-30/verifier/rule_gate.py`, R3 `verifier/rule_gate_r3.py`), which one is the acceptance gate of record — and why are they disagreeing on the repaired package? | A verdict matrix: each gate × {shipped, repaired, each of the 10 mutants} with exit codes as raw output. The named gate must exit **0** on the repaired package and **non-zero on every one of the 10 mutants**. Explain the A11 contradiction with a `file:line` cause, not a guess. Name the gate in one sentence the operator can paste into CI. |
| **I — R4 identity** | `…-R4/identity/` | Can "only a human may decide" be made **true**, not merely "some words are refused"? | An operator-editable allowlist (`state/human-deciders.json`), proven **both directions in ONE run**: `hermes-agent` **refused**, an operator name **accepted**. State the safety property separately from the attribution property (`execution_state=NOT_EXECUTED`, `expires_at_utc=None` survive even a bad decider). Apply-ready diff only — **propose, do not apply**. |
| **S — source & first reading** | `…-R4/source/` | Re-measure the reachable sources today, and prove **end-to-end that R3 can fire for a human** — offline, human-gated. | Day-1 record entered in a scratch root → `RUN_OK … outcome=INITIAL_BASELINE`, `notifications=0`. Day-2 record with a changed figure → `EARNINGS_CHANGED` / `STATUS_CHANGED` with **exactly one** notification, and the same change **not** re-notified on a repeat. Re-run the live probes: `metrics_http` expected **404**; report any change from R3's table. No provider credential, no non-loopback socket. |
| **T — trigger** | `…-R4/scheduler/` | What actually fires the once-daily run, with the day-key/timezone correct on a machine that may be asleep at the trigger time? | A decision packet comparing the available routes (Hermes cron, Windows Task Scheduler, manual) with **exact command shape**, the missed-day/backfill semantics, and a **dry-run proof** of the trigger command in a scratch root. Register nothing. Keep the trigger **off the critical path** and prove the routine's behaviour when the trigger does **not** fire (missed-day detection must still work). |
| **V — adversarial verifier** | `…-R4/verifier/` | Is each sibling deliverable's gate **non-tautological**, and do the claims survive a hostile re-run? | Plant a violation in a copy of each sibling's target and show the sibling's gate exits **non-zero**; show it exits **0** on the unmutated copy. Re-run R3's 10-mutant harness against the gate **D** proposes. Report each surviving mutant as an **open defect**, never as a footnote. State the rule title + both numberings on first use. |

### Sequence and dependency
`D` and `I` and `G` are independent and parallel. `S` and `T` are independent of all. `V` runs against copies of `D`/`I`/`G` outputs, so `V` may **start** immediately on R3's artifacts and **finish** by re-running against whatever `D`/`I`/`G` produced. No stream may block another: if `V` finds the others' deliverables absent by the time it finishes, it reports that as a finding, not an excuse.

---

## 5. Isolation rules (binding on every stream)

1. Write **only** under `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/<your-stream>/`. Never edit a tracked file.
2. **Never** write to `monitoring/freecash/**`, `scripts/monitoring/**`, or anything under `data/freecash-monitor/**`. All routine work happens on a **copy** in your own directory.
3. Every routine invocation exports a throwaway root: `export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-r4-<stream>-<pid>/root"`. If anything reads the AgenticOS DB, also pin `AGENT_TEAMS_DB_PATH` away from the live DB — two roots exist for a reason.
4. No `git add/commit/stash/reset/restore/checkout/clean`. No `schtasks /Create`. No cron registration. No non-loopback socket. No credential. No secret in any artifact — print `[REDACTED]`.
5. **Prove isolation by hash, not by intention**: `sha256sum` the production `last-run.json` + `alerts.jsonl` before and after, and `find data/freecash-monitor -type f -newermt "<today> 00:00"` expecting zero. A footprint claim **expires** — re-hash at hand-off.
6. Use the 3.11.9 interpreter explicitly: `"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"`. 3.14 has no `tzdata` → `ZoneInfo("Europe/Berlin")` unresolvable → `MONITOR_DEGRADED`, which corrupts every day-key result you produce.
7. **Propose, do not apply.** Code changes land as a diff plus a runnable repro under your own directory. The operator applies nothing without a decision.
8. **Never claim PASS from an earlier run.** Re-execute in the pass you report from.

## 6. Evidence standard

- Quote the **command**, its **exit code**, and its **raw output** for every claim. A stream that cannot show the command did not run it.
- Label every claim `[A]` measured this pass, `[B]` read from source (`file:line`), or `[C]` inherited **and not re-verified**.
- A gate is green only when its **mutant set is closed**: exit 0 on the clean target **and** non-zero on every planted violation. Name surviving mutants as open defects.
- Never cite a script path without `ls`-ing it first.
- `MONITOR_DEGRADED` is currently a **success outcome** (`gate.py:32-40`) — never report it as coverage. Verify coverage by the **snapshot's** `data_available`/null figures, not by the ledger's `last_outcome`.

## 7. Definition of done for R4

R4 is done when, and only when:
1. `daybudget/remedy/` contains a diff that turns **6 RED → 7 GREEN** and keeps the 52-test suite at `failures=0`;
2. **one** gate is named as the acceptance gate of record, exits 0 on the repaired package, and is non-zero on all 10 mutants;
3. the identity guard is an allowlist proven **both directions in one run**;
4. R3 (notify-on-change) has been demonstrated end-to-end for a human **offline**, with dedupe shown;
5. the trigger decision packet names the command, the missed-day semantics and the dry-run evidence;
6. an adversarial stream has planted a violation in each target and shown the corresponding gate go non-zero;
7. the production root's hashes are unchanged, and every stream can show the pre/post pair.

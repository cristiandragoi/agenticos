# S3 `verifier/` — RULE GATE report (DELEGATION-2026-10-01-R4)

Interpreter for every run below:
`C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (3.11.9, tzdata OK).

## 1. What was delivered

| artifact | purpose |
|---|---|
| `rule_gate.py` | static gate: takes a file-or-dir, asserts the four rules **by title**, exits 0 / 2 |
| `mutation_harness.py` | plants 12 concrete violations into **copies** and requires the gate to fail on each |
| `raw/verifier-evidence.txt` | **the single evidence file** — RED and GREEN together |
| `raw/00-prior-gate-fraud.txt` | live proof the gate this stream replaces is fraudulent |
| `raw/10-pycompile.txt` | py_compile of the certified artifact + gate + harness |
| `raw/20-harness-stdout.txt`, `raw/30-mutation-report.txt` | raw harness output |
| `raw/40-gate-red-planted.txt` | standalone RED capture (exit 2) |
| `raw/50-offline-suite-baseline.txt`, `raw/51-suite-full.txt` | offline suite on the copied routine |
| `raw/01-isolation-before.txt`, `raw/99-isolation-after.txt` | isolation hashes |
| `raw/60-isolation-deviation-and-remediation.txt` | **self-reported process deviation** (see §6) |
| `raw/mutants/**` | pristine BASELINE copy + one copy per mutant |

## 2. The four rules, asserted by TITLE

The shipped docstrings invert R1/R2 (`gate.py:1` labels once-per-day “R1”;
`readonly_client.py:1` labels the network path “R2”). The gate therefore prints the
operator number **with its title on every line** and never emits a bare `R1`/`R2`.

| # | title | gate detectors (static) |
|---|---|---|
| R1 | NO EARNING ACTION | write-verb HTTP method; earning/withdrawal path; `os.system`/`os.popen`/`subprocess(shell=True)`; request body on a read; non-loopback URL literal; `ALLOWED_HOSTS` non-loopback; `ALLOWED_METHODS` ⊄ {GET,HEAD} |
| R2 | ONCE PER DAY | day lock must be `O_CREAT\|O_EXCL`; exactly one `read_source(...)` call-site in the entry point; `DEFAULT_TZ`/`ZoneInfo()` names must resolve under tzdata |
| R3 | NOTIFY ON CHANGE | prior snapshot loaded **before** any `save_snapshot()`; the loop over detected changes must call a per-change dispatcher |
| R4 | APPROVAL BEFORE EXTERNAL ACTION | `execution_state`/`EXECUTION_STATE_NOT_EXECUTED` must be `NOT_EXECUTED`; `EXECUTION_ALLOWED_BY_THIS_ROUTINE`/`execution_allowed_by_this_routine` must be `False`; `expires_at_utc` must be null; no trusted/allowed decider list containing an automation identity; decider denylist non-empty and applied |

## 3. RED / GREEN (failing-something proof)

Both lines are in `raw/verifier-evidence.txt` with raw output.

```
GREEN : verifier exits 0 on the unmodified artifact (raw/mutants/BASELINE/freecash)
        RULE GATE: PASS -- ... satisfies R1 NO EARNING ACTION, R2 ONCE PER DAY,
        R3 NOTIFY ON CHANGE, R4 APPROVAL BEFORE EXTERNAL ACTION (10 source files scanned)

RED   : verifier exits 2 on named planted violation M01 (POST /cashout write call)
        RULE VIOLATION [R1 NO EARNING ACTION] .../run_daily_check.py:308
            write-verb HTTP method present; R1 permits reads only
            offending line: _MUT = readonly_client.request("POST", ".../api/v1/cashout", json={...})
        RULE GATE: FAIL -- 3 violation(s)
```

## 4. Mutation results — **12/12 caught, 0 survivors**

`N = 12 ≥ 10`. Every required mutant from the brief is present. Harness exit 0.

| id | rule | planted violation | result |
|---|---|---|---|
| M01 | R1 NO EARNING ACTION | `POST /cashout` write call | CAUGHT (exit 2) |
| M02 | R1 NO EARNING ACTION | `os.system(...)` shell-out | CAUGHT |
| M03 | R1 NO EARNING ACTION | request body (`json=`) on a GET | CAUGHT |
| M04 | R1 NO EARNING ACTION | connect to a non-loopback host (`DEFAULT_BASE_URL`) | CAUGHT |
| M05 | R2 ONCE PER DAY | second `read_source()` in one day | CAUGHT |
| M06 | R2 ONCE PER DAY | unresolvable timezone name | CAUGHT |
| M07 | R2 ONCE PER DAY | day lock loses `O_EXCL` (non-atomic) | CAUGHT |
| M08 | R3 NOTIFY ON CHANGE | `save_snapshot()` before `load_prior_snapshot()` | CAUGHT |
| M09 | R3 NOTIFY ON CHANGE | dropped change notification | CAUGHT |
| M10 | R4 APPROVAL BEFORE EXTERNAL ACTION | auto-executed approval (`EXECUTED`) | CAUGHT |
| M11 | R4 APPROVAL BEFORE EXTERNAL ACTION | bypassable decider string `hermes-agent` | CAUGHT |
| M12 | R4 APPROVAL BEFORE EXTERNAL ACTION | non-human-decider denylist emptied | CAUGHT |

**OPEN DEFECTS: none.** (One survivor was found on the first run — M08 — caused by a
`(?<![\w.])` lookbehind that rejected the module-qualified `changedetect.save_snapshot(`.
The detector was fixed and the full 12 were re-run from scratch; the raw first-run output
is superseded in `raw/20-harness-stdout.txt`, which now shows 12/12.)

## 5. py_compile of the exact certified artifact

```
$ venv-python -m py_compile <BASELINE copy>/gate.py ... run_daily_check.py   (8 core modules)
exit=0    stdout=''    stderr=''
```
The gate and harness also compile clean (exit 0). See `raw/10-pycompile.txt`.

Target health (offline suite on the **copy**): `run_all: tests=52 failures=0 errors=0
skipped=0`, exit 0 (`raw/50-offline-suite-baseline.txt`).

> Note: run from the relocated copy the suite initially reported `failures=2`. Both were
> relocation artifacts — `tests/_support.py:21` locates the checker at
> `REPO_ROOT/docs/free-cash-monitor-routine/verify-readonly.sh`, and `REPO_ROOT` is derived
> by a parent climb from the tests dir. Mirroring that one sibling file under
> `raw/mutants/docs/…` made the copy faithful; the suite then passed 52/0/0/0. The two
> failures were **never** a property of the routine.

## 6. Isolation

Digests of the production state, byte-identical before and after every run:

```
sha256  data/freecash-monitor/state/last-run.json
      = a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9
sha256  data/freecash-monitor/alerts/alerts.jsonl
      = 1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8
```

Both match the brief's baseline. `find data/freecash-monitor -type f -newermt "2026-10-01
00:00"` returns the same 4 pre-existing 06:53Z files in `01-` and `99-`. Every child
process ran with throwaway `FREECASH_DATA_ROOT`, `AGENT_TEAMS_DB_PATH`,
`AGENTICOS_DATA_DIR`. `D:/AgenticOS/monitoring/freecash` was **read**, never written, and
the mutation work happened only on copies under `raw/mutants/`.

**Self-reported deviation:** one manual step (`raw/10-pycompile.txt`) compiled the *in-place*
originals and wrote 8 `cpython-311.pyc` files into the forbidden
`monitoring/freecash/__pycache__/`. No `.py` source and no data file changed. The 8 files
were deleted, restoring the pre-session file set — see
`raw/60-isolation-deviation-and-remediation.txt`. The delivered harness/gate do not do this.

## 7. The gate this replaces is fraudulent (cited)

`D:/AgenticOS/server/scripts/verify-freecash-rules.mjs` — **exists** (`ls -la` in
`raw/00-prior-gate-fraud.txt`). It exits **0** printing `[OK] All 4 operational rules
verified (4/4 passed)` while certifying `server/scripts/freecash-daily-monitor.mjs`, which
fails `node --check` at **line 41** (`function isDailyCheckAllowed(): boolean {` — a TS
annotation in a `.mjs`) and has never executed.

- Lines 34–35 (Rule 3) are a **tautology**:
  `return !content.includes('checkForChanges') || content.includes('.log(');` — true for
  any content lacking `checkForChanges`. Demonstrated live: `rule3("") === true`.
- Lines 41–43 (Rule 4) have a **precedence bug**:
  `(!A && B) || content.includes('approval-request.json')` — the `||` branch is true
  whenever the filename string appears. Demonstrated live: a file whose only content is
  `"approval-request.json"` passes.
This stream does not trust, extend, or cite any prior gate's PASS.

## 8. Limitations (what this gate does NOT establish)

- It is a **static** detector; it does not execute the routine, so a violation expressed
  only at runtime through a path the regexes miss would not be caught.
- Lines carrying the package's own `readonly-exempt` sentinel are skipped. A mutant that
  appends that comment to a real violation would evade R1 detection — none of the 12 does.
- The timezone check needs tzdata; under an interpreter without it the check prints a
  WARNING and is SKIPPED (the harness pins the tzdata-capable venv python).
- 12/12 does not prove completeness — only that the gate fails on the 12 planted
  violations and passes on the unmodified artifact.

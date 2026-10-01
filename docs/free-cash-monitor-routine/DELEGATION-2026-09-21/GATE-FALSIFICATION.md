# GATE-FALSIFICATION — mutation testing of `scripts/monitoring/rule_gate_verify.py`

**Task:** prove or falsify the four rule gates for the Free Cash daily monitor by mutation testing.
**Target under test:** the executable gate `scripts/monitoring/rule_gate_verify.py` (47 141 bytes) and its verdict on
`monitoring/freecash/run_daily_check.py`.
**Date:** 2026-09-21 · **Host:** Windows 11 · **Shell:** git-bash (MSYS)
**Interpreter:** `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (Python 3.11.9, tzdata 2025.3)
**Node:** v24.20.0 · **Repo:** `D:/AgenticOS`
**Scratch (all mutants + raw logs):** `C:/Users/cd-pr/AppData/Local/Temp/fc-gate-mutation-2026-09-21/`

**Integrity of the real tree (verified, not asserted):**

```text
$ (cd monitoring/freecash && find . -name '*.py' -type f | sort | xargs sha256sum) > pre-manifest.txt   # before
$ ... harness + mutants + runtime probes run from temp copies only ...
$ (cd monitoring/freecash && find . -name '*.py' -type f | sort | xargs sha256sum) > post-manifest.txt  # after
$ diff pre-manifest.txt post-manifest.txt
DIFF_EMPTY=source py files byte-identical
$ diff pre-tree-times.txt post-tree-times.txt        # every file in the tree, mtime+size
WHOLE_TREE_MTIMES_UNCHANGED
$ diff pre-live-state.txt post-live-state.txt        # data/freecash-monitor/**
LIVE_STATE_UNCHANGED
```

No file under `monitoring/` was edited, moved, renamed or deleted (the only writes anywhere in the repo from this task are
the new files listed in §8). No `git add/commit/stash/reset/restore/checkout` was run. No network request was made (the R2
probe uses a stub transport and the guard raises before the single socket site; the R2 mutant was never executed). No
scheduled task was registered, no message was sent, and every run against the routine used a throwaway
`FREECASH_DATA_ROOT`. The live state root still reads `last-run.json` mtime **2026-09-20 21:08:00**.

---

## 0. Bottom line

| rule | mutant | gate on the **unmutated** tree | gate on the **mutant** | exit (unmutated → mutant) | detection power |
|---|---|---|---|---|---|
| **R1** one read per local day | `m1` / `m1b` | **FAIL** | **FAIL** | 1 → 1 | **UNPROVEN** |
| **R2** zero write/earning action | `m2` | PASS | **FAIL** | 1 → 1 | **PROVEN** |
| **R3** notify once per change | `m3` | PASS | **FAIL** | 1 → 1 | **PROVEN** |
| **R4** human approval, no execution | `m4` | PASS | **FAIL** | 1 → 1 | **PROVEN** |

**4×2 matrix as counts:**

| | gate verdict on unmutated tree | gate verdict on that rule's mutant |
|---|---|---|
| **PASS** | 3 (R2, R3, R4) | 0 |
| **FAIL** | 1 (R1) | 4 (R1, R2, R3, R4) |

R1 can never be proven by this method **because the gate already reports FAIL on the unmutated tree** — the mutation can
only produce the same FAIL, so nothing is attributable to it. That FAIL is a **scope artefact**, not an R1 violation:
the day lock is in `monitoring/freecash/gate.py`, and the gate reads only the one file it is pointed at (§2). Supporting
control pair (§4.1) shows the R1 *check* does discriminate when the mechanism is inside the scanned file:
`ctl-r1-inline-atomic` → `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` / `VERDICT: COMPLIANT …` / **exit 0**;
`ctl-r1-inline-noatomic` (same file, atomic create replaced by an existence check) → `SUMMARY: R1=FAIL …` / **exit 1**.

---

## 1. The gate's CURRENT verdict on the shipped tree (raw)

Command (run from `D:/AgenticOS`), output redirected to a file so the exit status is not read through a pipe:

```text
$ python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py > "$LOCALAPPDATA/Temp/gate-baseline.txt" 2>&1
$ echo "EXIT=$?"
EXIT=1
```

Raw output, unedited (`$LOCALAPPDATA/Temp/gate-baseline.txt`, 80 lines, 5 373 bytes):

```text
==============================================================================
rule-gate-verify :: executable rule gate for the Free Cash daily monitor
==============================================================================
target : D:/AgenticOS/monitoring/freecash/run_daily_check.py
exists : True   kind: python
parse  : OK -- python ast.parse OK

------------------------------------------------------------------------------
R1: status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)
------------------------------------------------------------------------------
  FAIL  atomic same-day guard (double-run barrier)
        evidence: no O_CREAT|O_EXCL / 'x'-mode create / atomic mkdir anywhere in the file
  FAIL  day key is a calendar day
        evidence: no calendar-day key derivation found (no %Y-%m-%d / toDateString / date().isoformat)
  PASS  no rolling 24h window used as the daily gate
        evidence: no 86400/24h/timedelta(days=1) daily-gate arithmetic found
  PASS  duplicate-run path is side-effect free
        evidence: no state write found inside the already-ran early-exit branch
  PASS  missed day is detectable  [line 324]
        evidence: line 324: missed = gate.missed_days(day, ledger)
  PASS  guard fails CLOSED on error
        evidence: no except/catch branch was found returning a permissive value from a *ran()*/*allowed()* style guard
  >>> R1 RESULT: FAIL

------------------------------------------------------------------------------
R2: NO automated earning action (no POST/PUT/PATCH/DELETE; no claim/withdraw/payout/redeem/survey/offer execution)
------------------------------------------------------------------------------
  PASS  no write/earning call shape or endpoint path
        evidence: 0 unexempted decisive hits in 476 lines (0 exempted by 'readonly-exempt:', 0 prose-only 'earning-verb' hits in the known false-positive class)
  PASS  no non-GET/HEAD HTTP method is used
        evidence: no POST/PUT/PATCH/DELETE call or method literal found
  PASS  deny-by-default allowlist exists (structural barrier)  [line 373]
        evidence: line 373: except (readonly_client.ReadError, readonly_client.ForbiddenWriteError, changedetect.MetricError) as exc:
  PASS  no invented/unresolved provider endpoint
        evidence: every URL literal is localhost/127.0.0.1 or explicitly marked PROVIDER_ENDPOINT_UNKNOWN
  PASS  no earning-action execution path in the monitor
        evidence: no run_action/execute_*/perform_action/simulate_action call site found
  >>> R2 RESULT: PASS

------------------------------------------------------------------------------
R3: operator notified when earnings/account status CHANGES (prior-state load BEFORE snapshot write; dedupe = one change = one notification)
------------------------------------------------------------------------------
  PASS  prior state is loaded BEFORE the new snapshot is written  [line 402]
        evidence: in _run(): LOAD at line 402 (prior = changedetect.load_prior_snapshot(day)) precedes WRITE at line 405 (snapshot_file, written = changedetect.save_snapshot(snapshot, now=now))
  PASS  exactly-one-notification dedupe key exists  [line 102]
        evidence: line 102: def change_dedupe_key(day, change) -> str:
  PASS  change comparison is exact (no threshold can swallow it)
        evidence: no relative/percentage threshold found next to a balance/earnings field
  PASS  notification is a delivery path, not a print stub  [line 212]
        evidence: line 212: notify.dispatch(summary, key, day, "MONITOR_DEGRADED", sender=sender, sleep_seconds=sleep_seconds)
  >>> R3 RESULT: PASS

------------------------------------------------------------------------------
R4: human approval before ANY external action (may enqueue; no execution path; timeout never converts pending -> executed)
------------------------------------------------------------------------------
  PASS  the routine may enqueue a request for a human  [line 44]
        evidence: line 44: import approval_queue
  PASS  consent is not fabricated by RNG
        evidence: no random.choice/random.random in the approval path
  PASS  consent is not hardcoded
        evidence: no success=True / approved=True / {'approved': True} literal found
  PASS  the routine contains NO execution path
        evidence: no action-executing call site found
  PASS  an APPROVED item is not auto-executed
        evidence: nothing reads an APPROVED status and executes it
  PASS  a timeout cannot convert pending -> executed
        evidence: no timeout/expiry branch that proceeds or executes
  PASS  the approval gate is actually reachable
        evidence: every approval/decide function has at least one call site
  >>> R4 RESULT: PASS

------------------------------------------------------------------------------
RUNTIME PROBE (temp-dir copy of the target; cwd = temp)
------------------------------------------------------------------------------
  - skipped (pass --run to enable; nothing was executed)

==============================================================================
SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS
VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1
==============================================================================
```

**Exit code: 1.** Verdict string: `SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS` / `VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1`.
This is **stable**: four consecutive runs printed the identical `SUMMARY`/`VERDICT` and all exited 1:

```text
run1 exit=1 SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1
run2 exit=1 SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1
run3 exit=1 SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1
run4 exit=1 SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1
```

### Prior findings re-verified this session (not carried over)

```text
$ FREECASH_DATA_ROOT="$(mktemp -d)" python monitoring/freecash/tests/run_all.py        # exit 0
run_all: tests=52 failures=0 errors=0 skipped=0
$ python monitoring/freecash/verify_readonly.py                                       # exit 0
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
$ bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash           # exit 0
[verify-readonly] forbidden=0 exempt=28 missing_targets=0
[verify-readonly] PASS — no unexempted write/earning token found.
```

All three prior findings reproduce (`52/0/0/0`; `forbidden=0 exempt=28 missing_targets=0` twice, both checkers agreeing).

---

## 2. Scope limitation, determined by reading the script

The gate is **single-file scoped, for every rule**. In `scripts/monitoring/rule_gate_verify.py`:

```python
1064|    target = Path(args.target)
1065|    rep = verify(target, args.run)
...
 976|    src = target.read_text(encoding="utf-8", errors="replace")
 977|    lines = src.splitlines()
 978|    ok, detail, kind = parse_gate(target, src)
...
 999|    code = code_view(src, lines, target.suffix.lower())
1001|    check_r1(rep, lines, code, spans)
1002|    check_r2(rep, src, lines, code)
1003|    check_r3(rep, lines, code, spans)
1004|    check_r4(rep, lines, code, spans)
1005|    runtime_probe(rep, target, src, lines, do_run)
```

* `main()` takes **one positional path**; `verify()` calls `target.read_text()` once and every rule function receives
  **only that file's `lines` / `code`** (plus `ast` spans of that same file). There is no package, directory or import
  resolution anywhere in the checks.
* `parse_gate()` runs `ast.parse` on that file only — the fail-closed "does not parse ⇒ every rule FAIL" path is per file.
* `runtime_probe()` copies **just the target file** into the temp dir (`shutil.copy2(target, copy)`), so even `--run`
  exercises one file, not its package.
* No rule check imports a module, follows a call across files, or resolves `gate.acquire_day_lock` to its definition.

**Therefore this invocation scans exactly one file: `monitoring/freecash/run_daily_check.py`.** It never reads
`gate.py`, `readonly_client.py`, `changedetect.py`, `approval_queue.py`, `notify.py`, `operator_state.py`, `paths.py`,
`watchdog.py` or the tests.

| rule | what the check looks for (in the scanned file) | where that mechanism actually lives in the routine |
|---|---|---|
| R1 | `O_EXCL` / `'x'`-mode create / `mkdir(exist_ok=False)` → `ATOMIC_LOCK` (l.107); a `%Y-%m-%d` day key → `CALENDAR_DAY` (l.118); no `86400`/`timedelta(days=1)` → `ROLLING_WINDOW` (l.122); no state write in the already-ran branch (l.425-451); a `last_success_day`/`MISSED_DAY`/`reconcile` token → `MISSED_DAY` (l.126); no permissive `except` return in a `*ran()*`/`*allowed()*` guard (l.463-493) | **`gate.py`** — atomic lock at `gate.py:119-135` (`os.open(str(lock), os.O_CREAT \| os.O_EXCL \| O_WRONLY)`), day key at `gate.py:96-102`, missed-day math at `gate.py:208-229`. `run_daily_check.py` only *calls* `gate.acquire_day_lock(day)` (l.309) — a call is invisible to every token the check greps for. |
| R2 | `FORBIDDEN_TOKENS` token scan on the raw lines (l.73-91), `NET_WRITE_CALL` (l.94), `ALLOWLIST_MARKERS` (l.103), invented-host scan, `EXECUTION_PATH` (l.151) | The **allowlist itself** is `readonly_client.py` (`ALLOWED_METHODS`, `ALLOWED_PATHS`, `ALLOWED_HOSTS`, `_transport`). `run_daily_check.py` passes only because it *mentions* `readonly_client.ForbiddenWriteError` in an `except` clause (line 373), which satisfies `ALLOWLIST_MARKERS`. |
| R3 | `PRIOR_LOAD` vs `SNAPSHOT_WRITE` ordering **inside one function** of the scanned file (l.586-628), `DEDUPE` token (l.140), `RELATIVE_THRESHOLD` (l.142), `NOTIFY_DISPATCH` (l.145) | The **comparison and dedupe logic** is `changedetect.py` (`compare`, `dedupe_key`, `save_snapshot`, `load_prior_snapshot`). The ordering statement happens to live in `run_daily_check.py::_run`, which is why R3=PASS. |
| R4 | `enqueue`/`pending.json`/`approval_queue`/`PENDING` token (l.680), `AUTO_APPROVE_RNG` (l.155), `HARDCODED_CONSENT` (l.157), `EXECUTION_PATH` (l.151), APPROVED-then-execute lookahead (l.719-740), timeout×execute (l.742-756), dead-approval-def (l.758-789) | The **queue + the human-only decision** is `approval_queue.py` (`NotHumanError`, `_normalise_decider`, frozen `NOT_EXECUTED`). `run_daily_check.py` is credited by the bare tokens `import approval_queue` (line 44) and `approval_queue.enqueue(...)`. |

**Consequence of the scope limitation — a per-file sweep of the whole package** (command:
`for f in monitoring/freecash/*.py monitoring/freecash/tests/*.py; do python scripts/monitoring/rule_gate_verify.py "$f"; done`,
exit code captured per file):

```text
approval_queue.py                exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=PASS
changedetect.py                  exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
gate.py                          exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
notify.py                        exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
operator_state.py                exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
paths.py                         exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
readonly_client.py               exit=1 SUMMARY: R1=FAIL  R2=PASS  R3=FAIL  R4=FAIL
run_daily_check.py               exit=1 SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS
verify_readonly.py               exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
watchdog.py                      exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
_support.py                      exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=PASS
run_all.py                       exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
test_r1_gate.py                  exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
test_r2_readonly.py              exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=PASS
test_r3_changedetect.py          exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=PASS
test_r4_approval.py              exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
test_r5_smoke.py                 exit=1 SUMMARY: R1=FAIL  R2=FAIL  R3=FAIL  R4=FAIL
```

**No file in the package passes R1**, so the gate cannot emit a `COMPLIANT` verdict for this routine however it is
invoked — the six R1 sub-checks are split across files (`run_daily_check.py` has the missed-day path and the side-effect-free
skip branch but no atomic primitive; `gate.py` has the atomic primitive and the day key but not the rest).

**And the file that *does* own the R1 mechanism still fails R1 — on a false positive.** Raw R1 section for `gate.py`
(`$LOCALAPPDATA/Temp/fc-gate-mutation-2026-09-21/logs/perfile/gate.py.txt`):

```text
R1: status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)
------------------------------------------------------------------------------
  PASS  atomic exclusive-create day guard present  [line 128]
        evidence: line 128: fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | O_WRONLY)
  PASS  day key is a calendar day  [line 102]
        evidence: line 102: return now.astimezone(zone(tz)).date().isoformat()
  FAIL  no rolling 24h window used as the daily gate  [line 220]
        evidence: line 220: cursor = last + timedelta(days=1) -- a rolling window permits two runs inside one calendar day (00:30 then 23:30)
  PASS  duplicate-run path is side-effect free
        evidence: no state write found inside the already-ran early-exit branch
  PASS  missed day is detectable  [line 145]
        evidence: line 145: "last_success_day": None,
  PASS  guard fails CLOSED on error
        evidence: no except/catch branch was found returning a permissive value from a *ran()*/*allowed()* style guard
  >>> R1 RESULT: FAIL
```

`gate.py:220` is `cursor = last + timedelta(days=1)` inside `missed_days()` — **calendar-date arithmetic for missed-day
enumeration**, not a 24-hour rolling window used as the daily gate. `ROLLING_WINDOW` (l.122) matches the literal
`timedelta(days=1` anywhere in the file and the "day key is a calendar day" PASS is independent of it, but the FAIL is
emitted regardless. So this gate produces both a false negative (the shipped tree: a real mechanism reported as absent) and
a false positive (the module that implements R1 reported as violating it).

---

## 3. The mutation harness

Built in a temp dir, never in the repo, and re-runnable from the copy shipped in §8:

* `…/fc-gate-mutation-2026-09-21/harness.py` — for each rule: `shutil.copytree(monitoring/freecash → <scratch>/<label>/monitoring/freecash)`
  (ignoring `__pycache__`), applies one byte-exact text replacement to the **copy's** `run_daily_check.py` (each anchor is
  asserted to match **exactly once**, else the harness aborts), then runs the gate against that copy and records
  stdout/stderr/exit code plus the `--json-out` report. It also runs the gate on the pristine tree as the "unmutated" column.
* `…/fc-gate-mutation-2026-09-21/runtime_probes.py` — runs the pristine and mutated **packages** against throwaway
  `FREECASH_DATA_ROOT` roots (`FREECASH_TOAST_STUB=1`, no network) to show each mutation is a *genuine* violation and that
  the unmutated mechanism denies it.

Command: `python "$LOCALAPPDATA/Temp/fc-gate-mutation-2026-09-21/harness.py"`

```text
scratch   : C:/Users/cd-pr/AppData/Local/Temp/fc-gate-mutation-2026-09-21
python    : C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
gate      : D:/AgenticOS/scripts/monitoring/rule_gate_verify.py    (47141 bytes)

run                                rule       exit  R1   R2   R3   R4
-----------------------------------------------------------------------
baseline-pristine                  baseline      1  FAIL PASS PASS PASS
ctl-newline-lf-only                control       1  FAIL PASS PASS PASS
m1-r1-remove-daylock               R1            1  FAIL PASS PASS PASS
m1b-r1-disable-daylock             R1            1  FAIL PASS PASS PASS
m2-r2-post-cashout                 R2            1  FAIL FAIL PASS PASS
m3-r3-save-before-load             R3            1  FAIL PASS FAIL PASS
m4-r4-auto-execute-approved        R4            1  FAIL FAIL PASS FAIL
ctl-r1-inline-atomic               R1-control    0  PASS PASS PASS PASS
ctl-r1-inline-noatomic             R1-control    1  FAIL PASS PASS PASS
```

Two controls make the harness self-checking:

* **`ctl-newline-lf-only`** — the pristine text re-written unchanged through `Path.write_text` (which normalises to CRLF on
  this host; the original file is pure LF, `crlf=0 lf_only=476`). Verdict is byte-for-byte the same as `baseline-pristine`,
  so the copy/rewrite step itself changes no verdict; every difference below is attributable to the mutation.
* **`ctl-r1-inline-atomic` / `ctl-r1-inline-noatomic`** — the R1 control pair in §4.1.

---

## 4. Per-rule mutation results

### 4.1 R1 — "remove/disable the day-lock acquisition so two same-day runs would both read"

**Mutation A (`m1`), removal → non-atomic barrier.** In the copy's `run_daily_check.py`, the anchor

```python
    source_kind = resolve_source(args.source)
    day = gate.day_key(now)
    acquired, lock = gate.acquire_day_lock(day)
    if not acquired:
```

became (mutant lines 307-314):

```text
 307|     source_kind = resolve_source(args.source)
 308|     day = gate.day_key(now)
 309|     lock = paths.day_locks_dir() / ("%s.lock" % day)
 310|     lock.parent.mkdir(parents=True, exist_ok=True)
 311|     acquired = not lock.exists()
 312|     if acquired:
 313|         lock.write_text("", encoding="utf-8")
 314|     if not acquired:
```

**Mutation B (`m1b`), disable.** Same anchor replaced by (mutant lines 307-312):

```text
 307|     source_kind = resolve_source(args.source)
 308|     day = gate.day_key(now)
 309|     lock = paths.day_locks_dir() / ("%s.lock" % day)
 310|     lock.parent.mkdir(parents=True, exist_ok=True)
 311|     acquired = True  # R1 MUTATION: the day lock no longer denies anything
 312|     if not acquired:
```

Command (identical form for both): `python scripts/monitoring/rule_gate_verify.py <scratch>/<label>/monitoring/freecash/run_daily_check.py`

Raw R1 section, `m1-r1-remove-daylock` (exit 1):

```text
R1: status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)
------------------------------------------------------------------------------
  FAIL  atomic same-day guard (double-run barrier)  [line 311]
        evidence: no O_CREAT|O_EXCL / 'x'-mode create / atomic mkdir anywhere in the file; the only same-day barrier is a read-then-write existence check at line 311: acquired = not lock.exists() -> TOCTOU race, two concurrent runs can both pass it
  FAIL  day key is a calendar day
        evidence: no calendar-day key derivation found (no %Y-%m-%d / toDateString / date().isoformat)
  PASS  no rolling 24h window used as the daily gate
        evidence: no 86400/24h/timedelta(days=1) daily-gate arithmetic found
  PASS  duplicate-run path is side-effect free
        evidence: no state write found inside the already-ran early-exit branch
  PASS  missed day is detectable  [line 328]
        evidence: line 328: missed = gate.missed_days(day, ledger)
  PASS  guard fails CLOSED on error
        evidence: no except/catch branch was found returning a permissive value from a *ran()*/*allowed()* style guard
  >>> R1 RESULT: FAIL
```

Raw R1 section, `m1b-r1-disable-daylock` (exit 1) — identical to `baseline-pristine`:

```text
R1: status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)
------------------------------------------------------------------------------
  FAIL  atomic same-day guard (double-run barrier)
        evidence: no O_CREAT|O_EXCL / 'x'-mode create / atomic mkdir anywhere in the file
  FAIL  day key is a calendar day
        evidence: no calendar-day key derivation found (no %Y-%m-%d / toDateString / date().isoformat)
  PASS  no rolling 24h window used as the daily gate
        evidence: no 86400/24h/timedelta(days=1) daily-gate arithmetic found
  PASS  duplicate-run path is side-effect free
        evidence: no state write found inside the already-ran early-exit branch
  PASS  missed day is detectable  [line 326]
        evidence: line 326: missed = gate.missed_days(day, ledger)
  PASS  guard fails CLOSED on error
        evidence: no except/catch branch was found returning a permissive value from a *ran()*/*allowed()* style guard
  >>> R1 RESULT: FAIL
```

#### Runtime probe: is each mutation a genuine violation?

`python runtime_probes.py` (throwaway roots, 5 simultaneous plus 2 sequential same-day runs per package):

```text
--- pristine
    proc1: exit=0 last_stdout='RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-21.json writte'
    proc2: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
    proc3: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
    proc4: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
    proc5: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
    => RUN_OK(reads)=1  SKIP_DUPLICATE_DAY=4  locks=['2026-09-21.lock']
--- m1-r1-remove-daylock
    proc1..proc4: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
    proc5: exit=0 last_stdout='RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED ...'
    => RUN_OK(reads)=1  SKIP_DUPLICATE_DAY=4  locks=['2026-09-21.lock']

=== two SEQUENTIAL same-day runs, same root ===
--- pristine
    run#1: exit=0 last_stdout='RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED ...'
    run#2: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
--- m1-r1-remove-daylock
    run#1: exit=0 last_stdout='RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED ...'
    run#2: exit=0 last_stdout='SKIP_DUPLICATE_DAY 2026-09-21'
--- m1b-r1-disable-daylock
    run#1: exit=0 last_stdout='RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED ...'
    run#2: exit=0 last_stdout='RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED ... written=False ch'
    => snapshots: ['2026-09-21.json']
```

* **`m1` is a weakened barrier, not a demonstrated double read.** It removes atomicity (the gate's TOCTOU diagnosis is
  correct in principle), but in this round the winner wrote the lock file before the other four reached the existence
  check, and the sequential second run still skipped: `RUN_OK(reads)=1 SKIP_DUPLICATE_DAY=4` — the same outcome as the
  pristine tree.
* **`m1b` is a genuine violation.** The pristine tree denies the second same-day run (`SKIP_DUPLICATE_DAY`); the mutant
  runs the whole routine twice on the same local day — `run#2 … RUN_OK 2026-09-21 … snapshot=2026-09-21.json written=False`
  — i.e. a second status read on a day that already had one. The unmutated lock is what denies it, and the gate cannot see
  that lock.

#### Control pair: does the R1 check discriminate at all?

Two further copies, identical except for the atomic primitive. Both put the whole R1 mechanism (atomic lock **and**
calendar-day key) *inside* `run_daily_check.py`, i.e. inside the gate's single-file scope:

* `ctl-r1-inline-atomic` — anchor replaced by (mutant line 312) `fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)`
  plus (line 308) `day = now.strftime("%Y-%m-%d") if now is not None else gate.day_key(now)`.

```text
R1: status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)
------------------------------------------------------------------------------
  PASS  atomic exclusive-create day guard present  [line 312]
        evidence: line 312: fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
  PASS  day key is a calendar day  [line 308]
        evidence: line 308: day = now.strftime("%Y-%m-%d") if now is not None else gate.day_key(now)
  PASS  no rolling 24h window used as the daily gate
        evidence: no 86400/24h/timedelta(days=1) daily-gate arithmetic found
  PASS  duplicate-run path is side-effect free
        evidence: no state write found inside the already-ran early-exit branch
  PASS  missed day is detectable  [line 332]
        evidence: line 332: missed = gate.missed_days(day, ledger)
  PASS  guard fails CLOSED on error
        evidence: no except/catch branch was found returning a permissive value from a *ran()*/*allowed()* style guard
  >>> R1 RESULT: PASS
==============================================================================
SUMMARY: R1=PASS  R2=PASS  R3=PASS  R4=PASS
VERDICT: COMPLIANT -- 4/4 rules structurally enforced with cited evidence
==============================================================================
gate exit=0
```

* `ctl-r1-inline-noatomic` — the same file with only the atomic create replaced by
  `acquired = not lock.exists()` / `lock.write_text("", encoding="utf-8")`:

```text
R1: status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)
------------------------------------------------------------------------------
  FAIL  atomic same-day guard (double-run barrier)  [line 311]
        evidence: no O_CREAT|O_EXCL / 'x'-mode create / atomic mkdir anywhere in the file; the only same-day barrier is a read-then-write existence check at line 311: acquired = not lock.exists() -> TOCTOU race, two concurrent runs can both pass it
  PASS  day key is a calendar day  [line 308]
        evidence: line 308: day = now.strftime("%Y-%m-%d") if now is not None else gate.day_key(now)
  ...
==============================================================================
SUMMARY: R1=FAIL  R2=PASS  R3=PASS  R4=PASS
VERDICT: NOT COMPLIANT -- 1/4 rule(s) violated: R1
==============================================================================
gate exit=1
```

So the R1 check *is* a working detector **for a mechanism written inside the scanned file** (PASS→FAIL on the same file,
exit 0→1), and the gate *can* emit an overall `COMPLIANT`/exit 0 verdict. It simply cannot see this routine's R1 mechanism
across the `run_daily_check.py` / `gate.py` boundary.

#### R1 verdict

**UNPROVEN.** By the stated criterion (FAIL on the mutant **AND** PASS on the unmutated tree) R1 cannot be proven: the
unmutated tree already reads FAIL, and both R1 mutants also read FAIL with the same rule result, so the FAILs are not
attributable to the mutations. The R1 check is demonstrably single-file scoped, emits a false negative on the shipped tree
and a false positive on `gate.py`, but it does discriminate when the mechanism is in-file (control pair above).

---

### 4.2 R2 — "add a POST/withdrawal call (POST /api/v1/cashout) to the read client path"

**Mutation (`m2`).** In `read_source()` (the read path), the anchor `    if kind == "metrics_http":\n` became mutant lines 66-74:

```text
  66|     if kind == "metrics_http":
  67|         import urllib.request  # R2 MUTATION: real outbound write call
  68|
  69|         urllib.request.urlopen(
  70|             urllib.request.Request(
  71|                 "http://localhost:3001/api/v1/cashout", method="POST", data=b"{}"
  72|             )
  73|         )  # R2 MUTATION: POST /api/v1/cashout on the read client path
  74|         raw = readonly_client.read_status_source(base=base, transport=transport)
```

This bypasses `readonly_client.request` entirely (it is stdlib `urllib.request`, which is not the routine's audited
transport), so it is a *genuine*, executable write with a request body.

Command: `python scripts/monitoring/rule_gate_verify.py <scratch>/m2-r2-post-cashout/monitoring/freecash/run_daily_check.py`

Raw R2 section (exit 1):

```text
R2: NO automated earning action (no POST/PUT/PATCH/DELETE; no claim/withdraw/payout/redeem/survey/offer execution)
------------------------------------------------------------------------------
  FAIL  no write/earning call shape or endpoint path  [line 69]
        evidence: line 69 [write-call-shape]: urllib.request.urlopen(
  FAIL  no non-GET/HEAD HTTP method is used  [line 71]
        evidence: line 71: "http://localhost:3001/api/v1/cashout", method="POST", data=b"{}"
  PASS  deny-by-default allowlist exists (structural barrier)  [line 380]
        evidence: line 380: except (readonly_client.ReadError, readonly_client.ForbiddenWriteError, changedetect.MetricError) as exc:
  PASS  no invented/unresolved provider endpoint
        evidence: every URL literal is localhost/127.0.0.1 or explicitly marked PROVIDER_ENDPOINT_UNKNOWN
  PASS  no earning-action execution path in the monitor
        evidence: no run_action/execute_*/perform_action/simulate_action call site found
  >>> R2 RESULT: FAIL
==============================================================================
SUMMARY: R1=FAIL  R2=FAIL  R3=PASS  R4=PASS
VERDICT: NOT COMPLIANT -- 2/4 rule(s) violated: R1, R2
==============================================================================
```

`R2=FAIL` on the mutant versus `R2=PASS` on the unmutated tree — the mutation is detected, and only the R2 result changed
(R1/R3/R4 are identical to the baseline column).

#### Runtime probe: the mutation is genuine, and the unmutated mechanism denies it

`readonly_client.request(...)` with a **stub** transport (so no socket can be reached), same probe run against pristine and
against the mutant package:

```text
--- pristine
    REFUSED   POST  http://localhost:3001/api/v1/cashout               -> ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)
    REFUSED   PUT   http://localhost:3001/api/v1/status/metrics        -> ForbiddenWriteError: R2: method 'PUT' is not read-only (allowed: GET, HEAD)
    REFUSED   GET   http://localhost:3001/api/v1/cashout               -> ForbiddenWriteError: R2: path not allowlisted: '/api/v1/cashout'
    REFUSED   GET   http://example.com/api/v1/status/metrics           -> ForbiddenWriteError: R2: host not allowlisted: 'example.com'
```

The routine's transport denies the exact method, path and host the mutation abuses, **before** `_transport` is reached
(no request is made). The mutant's `urllib.request.urlopen(...)` does not go through that function, which is precisely why
the mutation is a real violation rather than a blocked one. The gate itself also refuses to execute a write-shaped file:

```text
--- gate --run against the R2 mutant (verifier's own write-call guard)
    - REFUSED by the verifier's own R2 guard: line 71 contains a write-call shape ("http://localhost:3001/api/v1/cashout", method="POST", data=b"{}"). Executing this file could send a write request; withheld.
    gate --run exit=1
```

#### R2 verdict

**PROVEN.** Gate reads `R2=PASS` on the unmutated tree and `R2=FAIL` on the mutant (exit 1 both times, but the rule result
flips), and the mutant is a genuine bypass of a mechanism that demonstrably denies `POST /api/v1/cashout` on the real tree.

---

### 4.3 R3 — "make the snapshot save-before-load ordering bug reappear so a change cannot be detected"

**Mutation (`m3`).** In `_run()`, the anchor

```python
    prior = changedetect.load_prior_snapshot(day)
    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
    verdict = changedetect.compare(prior, snapshot)
    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
```

became mutant lines 402-405:

```text
 402|     snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
 403|     snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
 404|     prior = changedetect.load_snapshot(day)
 405|     verdict = changedetect.compare(prior, snapshot)
```

The comparison now loads **today's own snapshot** (`load_snapshot(day)`, matching the gate's `PRIOR_LOAD` pattern
`load_snapshot\s*\(`) immediately after writing it, so `prior` is the object that was just written: `old == new` for every
field and a real change can never be reported. This is the legacy defect (the one `changedetect.py`'s module docstring says
the current ordering was introduced to prevent) reappearing.

Command: `python scripts/monitoring/rule_gate_verify.py <scratch>/m3-r3-save-before-load/monitoring/freecash/run_daily_check.py`

Raw R3 section (exit 1):

```text
R3: operator notified when earnings/account status CHANGES (prior-state load BEFORE snapshot write; dedupe = one change = one notification)
------------------------------------------------------------------------------
  FAIL  prior state is loaded BEFORE the new snapshot is written  [line 403]
        evidence: in _run(): WRITE at line 403 (snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)) precedes PRIOR-STATE LOAD at line 404 (prior = changedetect.load_snapshot(day)) [delta=1 lines]: the new snapshot overwrites the file the comparison then reads, so old[:=]new and the change can never be reported
  PASS  exactly-one-notification dedupe key exists  [line 102]
        evidence: line 102: def change_dedupe_key(day, change) -> str:
  PASS  change comparison is exact (no threshold can swallow it)
        evidence: no relative/percentage threshold found next to a balance/earnings field
  PASS  notification is a delivery path, not a print stub  [line 212]
        evidence: line 212: notify.dispatch(summary, key, day, "MONITOR_DEGRADED", sender=sender, sleep_seconds=sleep_seconds)
  >>> R3 RESULT: FAIL
==============================================================================
SUMMARY: R1=FAIL  R2=PASS  R3=FAIL  R4=PASS
VERDICT: NOT COMPLIANT -- 2/4 rule(s) violated: R1, R3
==============================================================================
```

#### Runtime probe: the mutation really does kill change detection

Two consecutive day runs (2026-09-15 earnings 1000 → 2026-09-16 earnings 1500, same throwaway root, injected clock), run
against the pristine package and against the mutant package:

```text
--- pristine
    day=2026-09-15 earnings=1000 | RUN_OK 2026-09-15 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-15.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-15.lock
    day=2026-09-16 earnings=1500 | RUN_OK 2026-09-16 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-09-16.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-09-16.lock
    => alerts.jsonl event_types: ['INITIAL_BASELINE', 'APPROVAL_PENDING', 'EARNINGS_CHANGED']
--- m3-r3-save-before-load
    day=2026-09-15 earnings=1000 | RUN_OK 2026-09-15 outcome=OK_NO_CHANGE source=operator_entered(data_available=True) snapshot=2026-09-15.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-15.lock
    day=2026-09-16 earnings=1500 | RUN_OK 2026-09-16 outcome=OK_NO_CHANGE source=operator_entered(data_available=True) snapshot=2026-09-16.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-16.lock
    => alerts.jsonl event_types: ['OK_NO_CHANGE', 'OK_NO_CHANGE']
```

Pristine: `EARNINGS_CHANGED`, `changes=1 notifications=1 approvals=1`, and an `EARNINGS_CHANGED` line in the alert log.
Mutant: a 500-cent real move produces `OK_NO_CHANGE`, `changes=0`, and **no** `EARNINGS_CHANGED` event at all. Genuine
violation, and the gate catches it.

#### R3 verdict

**PROVEN.** `R3=PASS` on the unmutated tree → `R3=FAIL` on the mutant (with the ordering violation quoted at
`run_daily_check.py:403/404`), and the mutation is demonstrated at runtime to suppress a real change.

---

### 4.4 R4 — "add a code path that executes a queued approval automatically without a human `--by`"

**Mutation (`m4`).** Two replacements in the copy. Before `def nag_pending(...)` (mutant lines 217-238):

```text
 217| def execute_action(item):
 218|     """R4 MUTATION: carries out a queued approval with no human in the loop."""
 219|     paths.append_jsonl(
 220|         paths.logs_dir() / "executed.jsonl",
 221|         {"executed": item.get("approval_id"), "by": "routine", "human_approval": None},
 222|     )
 223|     return True
 224|
 225|
 226| def auto_execute_approved(day) -> int:
 227|     """R4 MUTATION: picks up APPROVED items and executes them automatically."""
 228|     document = approval_queue.load_document()
 229|     count = 0
 230|     for item in document.get("items", []):
 231|         if item.get("status") != "APPROVED":
 232|             continue
 233|         execute_action(item)
 234|         item["execution_state"] = "EXECUTED"
 235|         count += 1
 236|     if count:
 237|         approval_queue.save_document(document, now=None)
 238|     return count
```

and in `_run()` (mutant line 465), the anchor `    reminders = nag_pending(day, now, sender, 0)` became

```text
 465|     reminders = nag_pending(day, now, sender, 0) + auto_execute_approved(day)
```

so the new path is reachable from the routine's single entry point on every normal run, needs no `--by`, no CLI and no
human, and rewrites `execution_state` to `EXECUTED`.

Command: `python scripts/monitoring/rule_gate_verify.py <scratch>/m4-r4-auto-execute-approved/monitoring/freecash/run_daily_check.py`

Raw R4 section (exit 1):

```text
R4: human approval before ANY external action (may enqueue; no execution path; timeout never converts pending -> executed)
------------------------------------------------------------------------------
  PASS  the routine may enqueue a request for a human  [line 44]
        evidence: line 44: import approval_queue
  PASS  consent is not fabricated by RNG
        evidence: no random.choice/random.random in the approval path
  PASS  consent is not hardcoded
        evidence: no success=True / approved=True / {'approved': True} literal found
  FAIL  the routine contains NO execution path  [line 217]
        evidence: line 217: def execute_action(item): -- a pending/approved item can be executed inside the routine itself
  FAIL  an APPROVED item is not auto-executed  [line 233]
        evidence: line 233: execute_action(item) -- reads APPROVED status and then executes
  PASS  a timeout cannot convert pending -> executed
        evidence: no timeout/expiry branch that proceeds or executes
  PASS  the approval gate is actually reachable
        evidence: every approval/decide function has at least one call site
  >>> R4 RESULT: FAIL
```

Cross-rule effect to note: the same `EXECUTION_PATH` regex (l.151) drives R2's "no earning-action execution path in the
monitor" check, so this mutant also flips R2:

```text
  FAIL  no earning-action execution path in the monitor  [line 217]
        evidence: line 217: def execute_action(item): -- the routine contains a callable that performs an action
  >>> R2 RESULT: FAIL
==============================================================================
SUMMARY: R1=FAIL  R2=FAIL  R3=PASS  R4=FAIL
VERDICT: NOT COMPLIANT -- 3/4 rule(s) violated: R1, R2, R4
==============================================================================
```

#### Runtime probe: the mutation really does execute without a human

One `APPROVED` item seeded into a throwaway `approvals/pending.json`, then the routine's entry point run with **no**
arguments (no `--by`, nothing on stdin):

```text
--- pristine  (root …/roots/r4-pristine)
    RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-21.json written=True changes=0 notifications=0 approva
    entry-point exit=0
    logs/executed.jsonl: NOT CREATED (nothing was executed)
    queue item after the run: {'approval_id': '11111111-1111-1111-1111-111111111111', 'status': 'APPROVED', 'execution_state': 'NOT_EXECUTED', 'expires_at_utc': None, 'decided_by': 'Operator Name'}
--- m4-r4-auto-execute-approved  (root …/roots/r4-m4-r4-auto-execute-approved)
    RUN_OK 2026-09-21 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-21.json written=True changes=0 notifications=0 approva
    entry-point exit=0
    logs/executed.jsonl EXISTS: '{"by": "routine", "executed": "11111111-1111-1111-1111-111111111111", "human_approval": null}'
    queue item after the run: {'approval_id': '11111111-1111-1111-1111-111111111111', 'status': 'APPROVED', 'execution_state': 'EXECUTED', 'expires_at_utc': None, 'decided_by': 'Operator Name'}
```

The unmutated routine leaves the approved item untouched (`NOT_EXECUTED`, no execution record) and its human-decision CLI
refuses a machine identity:

```text
--- pristine: the human-decision CLI refuses a machine identity (R4 mechanism)
    --by 'routine' exit=4 stdout='' stderr="REFUSED: refused: 'routine' is not a human identity; this routine may only record a decision made by a person"
    --by 'Operator Name' exit=0 stdout='recorded APPROVED for 11111111-… by Operator Name at 2026-09-21T07:41:08Z\nexecution_state=NOT_EXECUTED (unchanged; this routine execut' stderr=''
    queue item after both attempts: {'approval_id': '…', 'status': 'APPROVED', 'execution_state': 'NOT_EXECUTED', 'expires_at_utc': None, 'decided_by': 'Operator Name'}
```

Note the mutant's execution record is a local append (`logs/executed.jsonl`) rather than an outbound provider call —
deliberate, because this routine has no resolved provider endpoint (`PROVIDER_ENDPOINT_UNKNOWN`) and the hard constraints
forbid network traffic. The mutation is nevertheless a genuine R4 violation: the routine now picks up an `APPROVED` queue
item and acts on it automatically, with no human `--by` anywhere in the path, and marks it `EXECUTED`.

#### R4 verdict

**PROVEN.** `R4=PASS` on the unmutated tree → `R4=FAIL` on the mutant (two R4 sub-checks fire, at mutant lines 217 and
233), and the mutant is demonstrated to execute an approved item automatically while the real routine does not and cannot.

---

## 5. Summary table

| rule | gate verdict on unmutated tree | gate verdict on that rule's mutant | exit (unmut/ mutant) | detection power | genuine violation shown at runtime? |
|---|---|---|---|---|---|
| R1 | FAIL (`run_daily_check.py` has no in-file `O_EXCL`; the lock is in `gate.py`) | FAIL (`m1`), FAIL (`m1b`) | 1 / 1 | **UNPROVEN** — the unmutated tree already FAILs, so the mutant's FAIL is not attributable; the mutation does not even change the rule result | `m1`: no (weakened barrier; still 1 winner / 1 read). `m1b`: **yes** — two same-day runs both ran |
| R2 | PASS | FAIL (`m2`) | 1 / 1 | **PROVEN** | yes — `urllib` POST `/api/v1/cashout` bypasses the transport that denies `POST`/`/cashout`/non-loopback hosts |
| R3 | PASS | FAIL (`m3`) | 1 / 1 | **PROVEN** | yes — a 500-cent move yields `OK_NO_CHANGE` and zero `EARNINGS_CHANGED` alerts |
| R4 | PASS | FAIL (`m4`) | 1 / 1 | **PROVEN** | yes — an `APPROVED` item is executed with no `--by` and marked `EXECUTED` |

**Counts:** unmutated column → **PASS 3 / FAIL 1**; mutant column → **PASS 0 / FAIL 4**.
**Controls:** `ctl-r1-inline-atomic` → `R1=PASS` + `VERDICT: COMPLIANT` + exit **0**; `ctl-r1-inline-noatomic` → `R1=FAIL` + exit **1**;
`ctl-newline-lf-only` (no mutation) → identical to baseline (`R1=FAIL R2=PASS R3=PASS R4=PASS`, exit 1).

Gate exit code is 1 in **every** mutant run, so the exit code alone carries no per-rule information — only the `SUMMARY:` line does.

---

## 6. What remains unproven

1. **R1's detection power over this routine.** The gate fails R1 on the unmutated tree, so no mutation can be attributed
   to it. The R1 mechanism (atomic day lock, day key) is never read by the gate at all — it lives in `gate.py`, which the
   gate only reads when pointed at it, and then it fails R1 on a false positive (`missed_days()`'s
   `last + timedelta(days=1)`). **R1's enforcement by the shipped routine is therefore not certified by this gate in either
   invocation**; the only R1 evidence in this report is the runtime behaviour (`RUN_OK` then `SKIP_DUPLICATE_DAY`;
   5 concurrent runs → 1 winner), which is the routine's own mechanism, not the gate's finding.
2. **The gate cannot emit `COMPLIANT` for this package at all** (no single file passes R1 — see the 17-file sweep). There
   is no invocation of `rule_gate_verify.py` that yields exit 0 against the real `monitoring/freecash` tree, so its exit
   code cannot be used as a release gate for this routine.
3. **`m1` (the TOCTOU mutation) never produced a double read** in 5-way concurrency or in two sequential same-day runs, so
   "a non-atomic existence check permits two same-day reads" is asserted by the check's evidence text but **not reproduced
   here**. Only the fully disabled lock (`m1b`) was shown to double-read. The gate cannot distinguish `m1` from `m1b` from
   the pristine tree.
4. **Rule isolation is incomplete for R4.** The only R4 mutation that the gate detects also flips R2 (shared
   `EXECUTION_PATH` regex), and the R4 "timeout cannot convert pending → executed" and "consent is not hardcoded"
   sub-checks were **not** exercised by any mutation here — their ability to fail is untested, so R4's PASS rests on
   detection shown for two of its seven sub-checks.
5. **R3's other three sub-checks and R2's `ALLOWLIST_MARKERS` sub-check were not mutated.** For example
   `ALLOWLIST_MARKERS` PASSes on `run_daily_check.py` purely because line 373's `except` clause *mentions*
   `readonly_client.ForbiddenWriteError` — an allowlist in another module; a file could satisfy it without any real barrier.
   Not falsified, not proven.
6. **The gate's own `--run` mode was exercised only for its R2 refusal path.** The runtime half of the gate (artifact
   creation, duplicate-run side effects, concurrency election) was not mutation-tested; the routine was probed directly
   instead, which tests the routine, not the gate.
7. **Nothing here certifies R3/R4 on live data.** The runtime probes used operator-entered fixtures in throwaway roots;
   `state/operator-state.json` in the live root is not proven to have ever produced a real change, and the live state root
   was not touched by this task (verified in the header).

---

## 7. Reproduction

```bash
cd /d/AgenticOS
export PYTHONDONTWRITEBYTECODE=1
S="C:/Users/cd-pr/AppData/Local/Temp/fc-gate-mutation-2026-09-21"

# 1. current verdict (exit 1)
python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py

# 2. build the 7 mutated copies + 2 controls and re-run the gate on each
python "$S/harness.py"                     # writes $S/matrix.json and $S/logs/<label>.gate.txt

# 3. runtime probes: prove each mutation is genuine and that the real mechanism denies it
python "$S/runtime_probes.py"              # writes $S/runtime/runtime-probe-output.txt
```

---

## 8. Artifacts created by this task (all new; nothing edited)

| path | what |
|---|---|
| `D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-09-21/GATE-FALSIFICATION.md` | this report |
| `…/DELEGATION-2026-09-21/evidence/harness.py` | the mutation harness |
| `…/DELEGATION-2026-09-21/evidence/runtime_probes.py` | the runtime probes |
| `…/DELEGATION-2026-09-21/evidence/matrix.json` | machine-readable per-run verdicts + exit codes |
| `…/DELEGATION-2026-09-21/evidence/logs/*.gate.txt`, `*.json` | raw gate stdout/stderr + JSON report per run |
| `…/DELEGATION-2026-09-21/evidence/logs/*.run_daily_check.py` | the exact mutated files that were scanned |
| `…/DELEGATION-2026-09-21/evidence/logs/perfile/*.txt` | raw gate output for the 17-file sweep |
| `…/DELEGATION-2026-09-21/evidence/logs/stability-*.txt` | 4 consecutive baseline runs |
| `…/DELEGATION-2026-09-21/evidence/runtime/runtime-probe-output.txt` | raw runtime probe output |
| `…/DELEGATION-2026-09-21/evidence/integrity/*.txt` | pre/post sha256 manifest, tree mtimes, live-state mtimes |
| `C:/Users/cd-pr/AppData/Local/Temp/fc-gate-mutation-2026-09-21/**` | scratch tree with the mutant packages and throwaway state roots |

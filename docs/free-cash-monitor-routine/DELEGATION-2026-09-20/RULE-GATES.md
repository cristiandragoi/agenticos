# RULE-GATES.md — executable rule-enforcement and acceptance verification plan

**Deliverable:** compliance evidence standard for the Free Cash daily monitoring routine (R1–R4).
**Repository:** `D:/AgenticOS` · branch `hermes-rescue-20260908` · HEAD `d14253d`
**Harness:** Windows 11, git-bash, `python` = 3.11.9 (**`python3` does not exist**; **`pytest` is not installed** — `python -m pytest --version` → `No module named pytest`). The suite is `unittest`-based.
**Written:** 2026-09-20. Every command in §2, §3 and Appendix A was executed by me; the observed output is quoted. Anything not executed is labelled **UNVERIFIED**.

**Evidence standard (from `delegation-manifest.json`):** a rule is compliant only if (a) the violating action is unreachable in code, (b) a test was executed showing the mechanism denying the violation, and (c) **the checker was shown to FAIL on an injected violation**. Requirement (c) is the whole point of this document: *a gate that has never been observed failing certifies nothing.*

---

## §0 What I verified, and what I reject from the prior art

### 0.1 Verified live by me (2026-09-20)

| Fact | Evidence |
|---|---|
| The offline suite passes, 52 tests, exit 0, ~10.5 s | `run_all: tests=52 failures=0 errors=0 skipped=0` |
| Both R2 static scanners pass on the shipped tree | shell: `forbidden=0 exempt=28 missing_targets=0` + `PASS`; python twin: `forbidden=0 exempt=28 missing_targets=0` + `PASS` |
| The suite does **not** consume or touch production state | production `day-locks/2026-09-20.lock` sha256 `e3b0c442…7852b855` and `state/last-run.json` sha256 `5e25ae59…11b4caf` byte-identical and mtime-identical (`2026-09-20 21:08:00`) before and after a full suite run |
| The five negative controls in §2 all make their gate FAIL (observed) | §2, quoted exit codes and assertion text |
| No scheduled task exists for this routine | `schtasks //query //fo LIST \| grep -iE "freecash\|finance\|monitor"` → no output |
| No CI/hook surface exists today | `.github/workflows` absent, `.pre-commit-config.yaml` absent, `.git/hooks/pre-commit` absent |
| `zoneinfo` resolves on this host | `{'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}` — so the `system-local` degradation branch is *not* triggered here |
| Live production evidence so far | `data/freecash-monitor/alerts/alerts.jsonl` has exactly 2 lines for `2026-09-20` (MONITOR_DEGRADED `info` @ `2026-09-20T19:08:00Z`; SKIP_DUPLICATE_DAY `info` @ `2026-09-20T19:08:01Z`); `approvals/` and `logs/` are empty; `snapshots/2026-09-20.json` = 518 B; `state/last-run.json` = 341 B |

### 0.2 `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` — validated vs rejected

**Validated (mechanism names checked against source):** the R1 lock (`gate.py::acquire_day_lock`, `os.open(..., O_CREAT|O_EXCL|O_WRONLY)` at `gate.py:128`), `gate.py::day_key` (:96), the readonly client allowlists (`readonly_client.py:39-49`, guard `request()` :110-140), the R2 checker's exit codes 0/1/2, `changedetect.dedupe_key`, `notify.py::emit_no_change`, `notify.py::dispatch` (2 attempts), `approval_queue.enqueue/decide`, `expires_at_utc` always `null`.

**Rejected (do not execute these rows as written):**
1. Row 5 `py -3 -m pytest monitoring/freecash/tests -k "not live"` → *"16 passed"*. **REJECTED: the command cannot run here** (`No module named pytest`), and the count is stale — the shipped suite is 52 tests, not 16. Use `python tests/run_all.py`.
2. Row for R1 missed-day detection naming `monitoring/freecash/gate.py::reconcile_missed_days()`. **REJECTED: that symbol does not exist** (`grep -rn "reconcile_missed_days" .` → no output). The real symbol is `gate.missed_days()` (`gate.py:208`), plus the independent second detector `watchdog.py::evaluate/check`.
3. Rows 6/7 (Task A / Task B registration) are unchecked and **no task is registered**; they cannot be evidence of anything until the operator registers them.
4. Its claim that ">5 changes coalesce into one summary" is attributed to `notify.py::emit_no_change`; the coalescing logic is actually `run_daily_check.notify_changes` with `MAX_NOTIFICATIONS = 5` (`run_daily_check.py:55,176-214`), and the summary is `notify.message_summary`.
5. Column "Test ID (§8)" points at a section numbering that does not exist in this repository's checklist file. Treat the **command + observed output** as the evidence, not the IDs.

### 0.3 `AUDIT-RULE-COMPLIANCE.md` — validated vs rejected

**Validated:** its method statement (static read + bounded non-mutating checks) and the substance of its core finding that the pre-existing candidate implementations were not compliant; the R2 "latent violation" reading of `scripts/make_freecash_check.py` (`prepare_actions`/`run_action`/execution loop, 2 957 B — I confirmed size/mtime `2026-09-11`).

**Corrected:** it states `server/scripts/verify-freecash-rules.mjs` exists. That is correct — it exists (3 034 B). The *skill-cited* path `scripts/verify-freecash-rules.mjs` is the one that is **MISSING** (verified: `MISSING scripts/verify-freecash-rules.mjs`). Both the file's existence and its non-existence at the skill's path are now verified.

**REJECTED as an enforcement mechanism:** `server/scripts/verify-freecash-rules.mjs` must never be part of this gate. Its "4/4 PASSED" is tautological string-grep and it certified a file that does not parse. I did **not** run it (deliberately — running it adds no evidence and risks quoting it as a pass). Its exact output quoted in the audit is **UNVERIFIED by me**.

---

## §1 Reuse map — extend these, invent nothing parallel

| Existing artifact | Role in this plan | Change required |
|---|---|---|
| `monitoring/freecash/tests/test_r1_gate.py` (7 tests) | R1 gate | none |
| `monitoring/freecash/tests/test_r2_readonly.py` (17 tests) | R2 gate (static + transport) | none — already contains its own injected-violation test |
| `monitoring/freecash/tests/test_r3_changedetect.py` (12 tests) | R3 gate | none |
| `monitoring/freecash/tests/test_r4_approval.py` (8 tests) | R4 gate | none |
| `monitoring/freecash/tests/test_r5_smoke.py` (8 tests) | first-install, bounded delivery failure, watchdog, refusals | none |
| `monitoring/freecash/tests/run_all.py` | the single blocking command (7+17+12+8+8 = 52) | none |
| `monitoring/freecash/tests/_support.py` | temp data root, loopback stub source, recording sender, `copy_routine()` — the negative-control harness already exists here | none |
| `docs/free-cash-monitor-routine/verify-readonly.sh` | R2 static check (CI/bash form) | none |
| `monitoring/freecash/verify_readonly.py` | R2 static check (python-only form, no bash needed) | none |
| `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` | human sign-off sheet | repair rows 5 and the `reconcile_missed_days`/coalescing attributions (§0.2); do not duplicate it here |
| `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` | rationale for exemptions/layers | none |

Nothing in this plan requires a new test file, a new runner, or a second verifier. **Adding a parallel verifier is the failure mode this document exists to prevent.**

---

## §2 The gates — enforcer, command, pass signal, negative control

### R1 — exactly one status check per operator-local calendar day

**Enforcing mechanism:** `monitoring/freecash/gate.py::acquire_day_lock(day)` — `os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)` at `gate.py:128` (single atomic syscall on `state/day-locks/<YYYY-MM-DD>.lock`; the filename *is* the day key). Day key: `gate.py::day_key` (:96) via `ZoneInfo(FREECASH_TZ)`, default `Europe/Berlin`. `state/last-run.json` is audit/reconciliation only — **never the gate**. Missed-day detector #1: `gate.missed_days` (:208) in-band at the next run; detector #2: `watchdog.py::check` (`main()` always exits 0).

**Command (the gate):**
```
cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py
```
**Pass signal:** exit code `0` and the final line `run_all: tests=52 failures=0 errors=0 skipped=0`. R1-specific: inside the suite, `test_r1_gate.DoubleRunTests.test_second_run_skips_with_no_side_effects` and `ConcurrencyTests.test_five_concurrent_runs_yield_one_winner` (5 processes → `skips==4`, `runs==1`, exactly one snapshot, one lock).

**NEGATIVE CONTROL (observed FAIL):**
1. *Mutation control* — remove `O_EXCL` from a scratch copy (`os.O_CREAT | os.O_EXCL | os.O_WRONLY` → `os.O_CREAT | os.O_WRONLY`), i.e. turn the atomic lock into the non-atomic "check then create" the design forbids:
   ```
   python tests/test_r1_gate.py      # run inside the mutated copy
   ```
   **Observed: `FAILED (failures=2)`, exit 1** → the gate is load-bearing (bytecode copy under `%LOCALAPPDATA%/Temp`, repo untouched).
2. *Live day-lock removal control* — with `FREECASH_DATA_ROOT` pointed at a scratch root:
   ```
   python D:/AgenticOS/monitoring/freecash/run_daily_check.py     # 1st: RUN_OK …, lock=2026-09-20.lock
   python D:/AgenticOS/monitoring/freecash/run_daily_check.py     # 2nd: SKIP_DUPLICATE_DAY 2026-09-20
   rm -f "$FREECASH_DATA_ROOT/state/day-locks/2026-09-20.lock"    # inject the violation
   python D:/AgenticOS/monitoring/freecash/run_daily_check.py     # 3rd: RUN_OK again  → R1 violated
   ```
   **Observed 3rd line:** `RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-20.json written=False changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock`, exit 0 — a **second status read for a consumed day**. Honest nuance: `written=False` because snapshots are immutable once written (`changedetect.save_snapshot`), so the violation is *a second read of the source plus a second ledger/attempt write*, not an overwritten snapshot. This control proves the lock is the sole R1 enforcement and that lock deletion is an operator-visible violation, not a permitted repair.

**Also part of R1 (refusal):** `python run_daily_check.py --force-recheck --reason "I want to look again"` → exit **3**, stdout `REFUSED_FORCE_RECHECK 2026-09-20 reason='I want to look again' (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)`, plus one line in `logs/forced-recheck-requests.jsonl` with `"decision": "REFUSED"`. There is no code path that performs a second read; the flag exists only to be refused.

---

### R2 — zero automated earning actions

**Enforcing mechanisms (three layers):**
- **Transport (runtime):** `readonly_client.py::request` (:110-140) — `ALLOWED_METHODS = frozenset({"GET","HEAD"})` (:39), `ALLOWED_HOSTS` loopback-only (:41), `ALLOWED_PATHS` = exactly `^/api/v1/status/metrics$` and `^/api/v1/status$` (:43-49), body keywords `data/json/files/body/content` refused (:52), every refusal raises `ForbiddenWriteError` **before** `_transport` (:76) — the only socket site in the routine.
- **Process guard:** `readonly_client.install_audit_guard()` / `_audit_hook` (:146-176) — aborts any `socket.connect`/`socket.getaddrinfo` to a non-loopback host, installed at the start of every run (`run_daily_check.py:279`).
- **Static (build):** `verify_readonly.py` (six token classes, exit 0/1/2) and its shell twin `verify-readonly.sh` (same patterns, same exit codes, `readonly-exempt:` inline marker policy).

**Commands (the gate):**
```
cd D:/AgenticOS && python monitoring/freecash/verify_readonly.py
bash D:/AgenticOS/docs/free-cash-monitor-routine/verify-readonly.sh
cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py
```
**Pass signals:** python twin → `forbidden=0 exempt=28 missing_targets=0` + `PASS - no unexempted write/earning token found.` exit 0; shell twin → `[verify-readonly] forbidden=0 exempt=28 missing_targets=0` + `PASS — no unexempted write/earning token found.` exit 0; suite → `tests=52 failures=0 errors=0 skipped=0`. Transport proof inside the suite: `ReadOnlyIntegrationTests.test_entry_point_only_ever_sends_reads` asserts the loopback stub recorded exactly `[("GET", "/api/v1/status/metrics"), ("HEAD", "/api/v1/status")]`.

**NEGATIVE CONTROLS (observed FAIL):**
1. *Static control (shipped test does this too):* write `injected_probe.py` containing
   `requests.post('http://localhost:3001/api/v1/status/claim', json={})` into a scratch copy, then
   `bash D:/AgenticOS/docs/free-cash-monitor-routine/verify-readonly.sh <scratch>/monitoring/freecash`
   **Observed:** `forbidden=4 exempt=28 missing_targets=0` then `[verify-readonly] FAIL — R2 violation: an earning/write action path exists in a read-only routine.`, **exit 1**. (One injected line trips four token classes: `http-verb`, `write-call-shape`, `earning-verb`, `write-endpoint-path`.)
2. *Transport control:* widen the method allowlist in a scratch copy (`ALLOWED_METHODS = frozenset({"GET", "HEAD", "POST"})`), then `python tests/test_r2_readonly.py`.
   **Observed:** `Ran 17 tests in 7.042s` · `FAILED (failures=3)` · `AssertionError: ForbiddenWriteError not raised` — **exit 1**. The static checker independently flags the same mutation: `hits: 1 … 'file': '…/readonly_client.py', 'line': 39, 'text': 'ALLOWED_METHODS = frozenset({"GET", "HEAD", "POST"})'`.
3. *Hardcoded-provider control (shipped):* `StaticCheckerTests.test_no_provider_host_is_hardcoded_anywhere` fails if any `http(s)://` host other than `localhost`/`127.0.0.1` appears in the module files, and the unresolved contract literal must stay verbatim: `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` (`readonly_client.py:60`).

---

### R3 — notify the operator when earnings or account status change

**Enforcing mechanisms:** `changedetect.compare` / `dedupe_key` = `sha256("<day>|<change_type>|<field>|<old>|<new>")` (integer-cent exactness, no thresholds) · `notify.notify_change` (:264-302) — one line per distinct change, `key_seen` → `DEDUPED` (no dispatch) · `notify.dispatch` (:220-261) writes the key **before** the first attempt (`record_notified_key(dedupe_key, DELIVERY_QUEUED)` at :224, dispatch at :231), `MAX_ATTEMPTS = 2`, then `DELIVERY_FAILED` carrying the full original message + `MONITOR_DEGRADED` ("this message exists only in alerts.jsonl") · `notify.emit_no_change` (:91) log-only, `OK_NO_CHANGE` never dispatches · `emit_initial_baseline` (:102) so a first run cannot produce a fake alarm · coalescing: `run_daily_check.notify_changes` (`MAX_NOTIFICATIONS = 5`, `MAX_APPROVAL_ITEMS = 5`) emits one `message_summary` and per-change `info` lines.

**Command (the gate):**
```
cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py
```
**Pass signal:** `run_all: tests=52 failures=0 errors=0 skipped=0`, specifically `test_r3_changedetect.py` (`Ran 12 tests`) — exactly one `EARNINGS_CHANGED`/`STATUS_CHANGED` line and exactly one dispatch per distinct change, `NOTIFIED` then `DEDUPED` for the same key, a different key on a different day, no dispatch on `OK_NO_CHANGE`, one-cent movement counts, `pending_cents` movement counts, `balance_cents` has its own type, a missing field is a `MetricError` not a zero, and a currency change is `degraded` not a change. Delivery bound is in `test_r5_smoke.DeliveryFailureTests` (`fail_times=2` → exactly 2 attempts, one `DELIVERY_FAILED`, `key_delivery(key) == "FAILED_TOAST"`, and the run still exits 0).

**NEGATIVE CONTROL (observed FAIL):** disable the dedupe index in a scratch copy (`notify.key_seen` → `return False`), then
```
python tests/test_r3_changedetect.py
```
**Observed:** `Ran 12 tests in 0.214s` · `FAILED (failures=1)` · `AssertionError: 'NOTIFIED' != 'DEDUPED'` — **exit 1**. (A second control worth running when the notification templates change: bound the sender to zero attempts, i.e. make `dispatch` return before the retry loop, and watch `fail_times=2` / `MAX_ATTEMPTS` assertions fail.)

**Honest limitation:** with `FREECASH_TOAST_STUB=1` (or a host without a desktop) the delivered artefact is `logs/toast-stub.log` and the alert line; the "operator was actually notified" claim is only as strong as the channel. **Physical delivery of a Windows toast to a human is NOT verified by anything in this plan** — the only proof is the operator confirming they saw it, plus `TOAST_OK` (not `STUB_OK`) in `state/notified-keys.json`.

---

### R4 — human approval before ANY external action; the routine contains no execution path

**Enforcing mechanisms:** `approval_queue.enqueue` (:137) — the routine's only write, called only on a real change, with a human-label `ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"` (:52, marked `readonly-exempt:`), `proposed_action.provider_endpoint` staying `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` (:116) · `build_item` (:108-134) freezes `expires_at_utc = NO_EXPIRY = None` (:48,:131), `execution_state = EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"` (:44,:132), `execution_allowed_by_this_routine = False` (:45,:133) · `decide` (:161-201) re-asserts all three frozen fields after a human decision (:180-182) and refuses machine identities (`NON_HUMAN_DECIDERS`, :55-57,:149-158) · every decision appends to the append-only `approvals/decided.jsonl` · `run_daily_check.py` contains no branch on an approved status; `nag_pending` (:217) only re-notifies · no TTL job, no scheduler retry, nothing anywhere acts on `APPROVED`.

**Commands (the gate):**
```
cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py
python approval_queue.py list
python run_daily_check.py --print-state
python approval_queue.py decide --id <uuid> --decision approve|reject --by "<human name>" --note "<why>"
```
**Pass signals:** suite green; `list` prints `… PENDING <day> expires_at_utc=None execution_state=NOT_EXECUTED` (**observed verbatim:** `52a43751-9997-4685-8fcd-d64eb7c7d3a0  PENDING  2026-10-02  expires_at_utc=None  execution_state=NOT_EXECUTED`); a machine identity is refused with exit **4** — **observed verbatim:** `REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person`; a human decision prints `recorded APPROVED for 52a43751-9997-4685-8fcd-d64eb7c7d3a0 by Operator Jane at 2026-09-20T19:14:23Z` then `execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)`, and `approvals/decided.jsonl` gains exactly one line with `"execution_state": "NOT_EXECUTED"` and `"execution_allowed_by_this_routine": false`.

**NEGATIVE CONTROL (observed FAIL):** make the frozen state executable in a scratch copy (`EXECUTION_STATE_NOT_EXECUTED = "EXECUTED"`), then
```
python tests/test_r4_approval.py
```
**Observed:** `Ran 8 tests in 1.365s` · `FAILED (failures=4)` · three × `AssertionError: 'EXECUTED' != 'NOT_EXECUTED'` and `AssertionError: <re.Match object; span=(32, 40), match='EXECUTED'> is not false : approval_queue.py:44 carries an executable state token: EXECUTION_STATE_NOT_EXECUTED = "EXECUTED"` — **exit 1**. Supporting controls already shipped in the same file: `test_pending_item_survives_a_ninety_day_clock_advance` (90 days + watchdog ticks → still `PENDING`, `expires_at_utc` null, `execution_state` `NOT_EXECUTED`, 12–13 reminders, and a whole-tree token scan `scan_for_execution(root) == []`); `test_past_expiry_plus_approved_status_executes_nothing` (a hand-crafted `APPROVED` + past-expiry item: the file must be byte-identical after a run, a watchdog check and a `list`); `StaticFreezeTests` (no module reads an `"APPROVED"` literal, no module imports `socket`/`requests`/`httpx`/`http.client`/`urllib.request` except the two exempted files).

**Honest limitation:** R4's guarantee is *"this routine has no execution path"*, not *"nothing anywhere can ever execute"*. An external actor holding an `approval_id` could act out-of-band; that is exactly why `execution_allowed_by_this_routine` is `false` on every item and why the decision trail is append-only. Do not restate R4 as authorization.

---

### R5 (harness, not a rule) — first install, bounded failure, refusals

`test_r5_smoke.py` (`Ran 8 tests … OK`) covers: first run with data is a silent `INITIAL_BASELINE` (no fake alarm), first run without data records the day and says so, `--force-recheck` refused with exit 3 and audited, `--print-state` is read-only (no snapshot, no lock), an unknown read source is rejected and consumes no day, the watchdog alarms once per day and changes no state. **Negative control for R5:** set `FREECASH_READ_SOURCE=provider_api` → non-zero exit + `unknown read source` and `day_locks(root) == []`; or point `FREECASH_READ_BASE_URL` at a stub returning HTTP 500 → exit **5**, `RUN_FAILED`, one alert line, no snapshot, lock retained (no automatic re-run). Both are asserted in `test_r5_smoke.py` / `test_r2_readonly.py` — the HTTP-500 case observed live in the suite output as `RUN_FAILED`/`READ_FAILED` paths.

---

## §3 Headless CI / pre-commit — with zero external action

**Why this is safe (verified, not assumed):** the suite builds its own temp data root (`_support.TempDataRoot` → `tempfile.TemporaryDirectory(prefix="freecash-test-")`), talks only to a throwaway `127.0.0.1` `ThreadingHTTPServer` (`StubSource`) and a recording sender / `FREECASH_TOAST_STUB=1`. Measured: after a full suite run, production `day-locks/2026-09-20.lock` and `state/last-run.json` were byte-identical (same sha256, same mtime `2026-09-20 21:08:00`). The static scanners read files only.

**Blocking command set (each must be run in this order; any non-zero exit fails the build):**
```
cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py          # require exit 0 AND "failures=0 errors=0"
cd D:/AgenticOS && python monitoring/freecash/verify_readonly.py        # require exit 0 (no bash needed)
bash D:/AgenticOS/docs/free-cash-monitor-routine/verify-readonly.sh      # optional belt-and-suspenders (needs git-bash)
grep -rn "readonly-exempt" D:/AgenticOS/monitoring/freecash --include=*.py --include=*.sh | wc -l
```
**Pinned drift baselines (verified 2026-09-20):** exemption **marker lines = 27**; checker-reported **exempt hits = 28** (one line, `verify_readonly.py:76`, trips two token classes — the two numbers legitimately differ). **A rise in either number is an R2 erosion signal and must fail review**; a scan that reports `missing_targets` > 0 exits 2 and is *not* a pass.

**What the gate must never invoke:** `run_daily_check.py` (it consumes a real day lock) and `watchdog.py` (it appends alerts) must **not** be part of the CI step. If a smoke invocation is ever wanted, it must be wrapped with a scratch root, e.g. `FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-ci/freecash-monitor" python run_daily_check.py` — and even then it is an extra risk with no added evidence. The offline suite already covers the entry point end-to-end via `subprocess`.

**Wiring (proposed, NOT created by me — no CI/hook file exists in this repo today):** `.github/workflows` is absent, `.pre-commit-config.yaml` is absent, `.git/hooks/pre-commit` is absent, and `package.json` has no freecash script (`scripts` contains `dev`, `build`, `test`, `verify:fast`, `verify:integration`, `verify:runtime`, `verify:acceptance`, `verify:all`, `diagnose:runtime`, … ; `grep` for `freecash` in `scripts/verify.cjs` → 0 matches). So the gate must be installed by the operator, per clone. Sketch (**UNVERIFIED — never executed, because creating it is outside this task's write scope**):
```sh
# .git/hooks/pre-commit  (chmod +x)   -- UNVERIFIED proposal
#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)/monitoring/freecash" && python tests/run_all.py
cd "$(git rev-parse --show-toplevel)" && python monitoring/freecash/verify_readonly.py
```
and the matching one-line addition to `package.json` `scripts` (**UNVERIFIED proposal**): `"verify:freecash": "cd monitoring/freecash && python tests/run_all.py && cd ../.. && python monitoring/freecash/verify_readonly.py"`.

---

## §4 End-to-end acceptance run — what on disk proves R1–R4

An acceptance run is a sequence of real entry-point invocations against a **scratch** `FREECASH_DATA_ROOT`, then a read of the artefacts. The scratch run I executed (2026-09-20) injected three consecutive operator-local days through the entry point's documented test seam `run_daily_check.run([], now=<aware datetime>)` (the same seam the shipped tests use; the CLI has no clock flag by design):

```
RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-10-02.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-10-02.lock
RUN_OK 2026-10-03 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-10-03.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-03.lock
```

Resulting artefact tree (`find` output, root = scratch `FREECASH_DATA_ROOT`):
```
<root>/alerts/alerts.jsonl
<root>/approvals/pending.json
<root>/logs/toast-stub.log
<root>/snapshots/2026-10-01.json
<root>/snapshots/2026-10-02.json
<root>/snapshots/2026-10-03.json
<root>/state/day-locks/2026-10-01.lock
<root>/state/day-locks/2026-10-02.lock
<root>/state/day-locks/2026-10-03.lock
<root>/state/last-run.json
<root>/state/notified-keys.json
<root>/state/operator-state.json
```

| Rule | Artefact on disk that proves it | Observed content |
|---|---|---|
| **R1** | `state/day-locks/<day>.lock`, one per day, **0 bytes** | `2026-10-01.lock`, `2026-10-02.lock`, `2026-10-03.lock`; production twin `2026-09-20.lock` = 0 B, sha256 `e3b0c442…7852b855` (the empty-string digest — i.e. provably zero bytes) |
| **R1** | `state/last-run.json` (ledger) | `last_attempt_day` `2026-10-03`, `last_success_day` `2026-10-03`, `last_outcome` `MONITOR_DEGRADED`, `consecutive_missed_days` 0, `timezone` `Europe/Berlin` |
| **R1** | duplicate-run line | `SKIP_DUPLICATE_DAY 2026-09-20` on stdout **and** exactly one `SKIP_DUPLICATE_DAY` line in `alerts.jsonl` (production lines for 2026-09-20, `severity=info`) |
| **R2** | `snapshots/<day>.json` `source` block | `"kind": "agenticos_local_metrics"` only when the HTTP source is used, with `"read_ops": ["W1","W2"]`; `operator_entered` for the default source. `changedetect.save_snapshot` is write-once (`written=False` on re-save) |
| **R2** | static scans | `forbidden=0 exempt=28 missing_targets=0` on both checkers |
| **R2** | loopback stub verb record (suite) | `[("GET", "/api/v1/status/metrics"), ("HEAD", "/api/v1/status")]` — no write verb is ever observed |
| **R3** | `alerts/alerts.jsonl` lines for the change day | `2026-10-02 EARNINGS_CHANGED notify` and `2026-10-02 APPROVAL_PENDING notify` (plus `2026-10-01 INITIAL_BASELINE info`, `2026-10-03 MONITOR_DEGRADED info`) — **note the append order: `APPROVAL_PENDING` precedes `EARNINGS_CHANGED`** |
| **R3** | `state/notified-keys.json` | the dedupe index: key → `{first_notified_at_utc, delivery}` where `delivery ∈ {QUEUED, TOAST_OK, STUB_OK, FAILED_TOAST}`; the key is written **before** the dispatch attempt |
| **R3** | `logs/toast-stub.log` | the offline stand-in's `[STUB TOAST …]` line (stub runs can never be mistaken for a real toast: label `STUB_OK`, never `TOAST_OK`) |
| **R4** | `approvals/pending.json` entry | `status: PENDING`, `expires_at_utc: null`, `execution_state: "NOT_EXECUTED"`, `execution_allowed_by_this_routine: false`, `proposed_action.action_type: "REQUEST_PAYOUT"`, `proposed_action.provider_endpoint: "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`, `change_dedupe_key` equal to the `EARNINGS_CHANGED` key |
| **R4** | `approvals/decided.jsonl` | one append-only line per human decision with `decided_by`, `decided_at_utc`, `decision_note`, still `"execution_state": "NOT_EXECUTED"` |
| **R4** | refusal lines | `logs/forced-recheck-requests.jsonl` (`"decision": "REFUSED"`) |
| **R5** | watchdog output | `WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=INITIAL_BASELINE` when covered; `WATCHDOG_MISSED_DAY 2026-09-20 last_attempt_day=None last_outcome=None coverage=NOTIFIED|DEDUPED` when not (always exit 0, never writes the ledger or a lock) |

**README-level acceptance statement (what an operator may sign off on):** *the routine performed exactly one status read for the day, only ever through the allowlisted read path, wrote one immutable snapshot, notified at most once per distinct change, enqueued at most one human-review item per notified change, and executed nothing.* Anything stronger than that sentence is **UNVERIFIED** by this plan.

**Gaps in a real acceptance run (state these, do not paper over them):** the default source `operator_state` yields `data_available=False` unless the operator entered figures, so a day can end `MONITOR_DEGRADED` and prove only R1/R2/R4 — not R3's detection quality; and there is still **no provider read path** (`PROVIDER_ENDPOINT_UNKNOWN`), so every reading today is either operator-entered or the local metrics substitute.

---

## §5 What the routine must NEVER do — even when every gate is green

A green gate is a statement about the code that was scanned. It is never a licence. The following are permanent invariants; if a change makes one of them desirable, the change is wrong, not the invariant.

1. **Never perform a second status read for a day that already has a lock** — including "just this once", including via `--force-recheck` (exit 3 by design), including after a failed read (exit 5 leaves the lock; no automatic re-run), including after a lock deletion (see the R1 control — that is a violation, not a repair).
2. **Never send a write/earning request** — no `POST/PUT/PATCH/DELETE`, no `claim/withdraw/cashout/redeem/payout/transfer/bet/deposit`, no request body, no non-allowlisted host or path, ever, for any reason, including "to check whether the endpoint still exists".
3. **Never widen an allowlist to make something work.** `ALLOWED_METHODS`, `ALLOWED_HOSTS`, `ALLOWED_PATHS` may only change with (a) documented provider research, (b) explicit human approval, (c) a *new* gate row here whose negative control was observed failing. `PROVIDER_ENDPOINT_UNKNOWN` stays verbatim until then.
4. **Never treat `APPROVED` (or any status) as a trigger**; never write an `execution_state` other than `NOT_EXECUTED`; never set `expires_at_utc` to anything non-null; never let a machine identity sign a decision; never let a pending item expire, auto-close, or be "cleaned up".
5. **Never back-fill a missed day** — a gap is reported (`MISSED_DAY`), never re-read.
6. **Never notify more than once per distinct change**, never dispatch on `OK_NO_CHANGE`, never retry a failed delivery beyond the two in-process attempts, never add a scheduler-level retry, never add an email/SMTP/webhook channel without explicit operator opt-in and a gate row.
7. **Never let the watchdog become a second run** — it keeps opening no socket, writing no ledger, creating no lock, and exiting 0.
8. **Never `readonly-exempt:` a line to silence a real finding.** The marker is for prose and for the scanner's own pattern table (policy: the two scanner files plus explicit negative-control payloads). Exemption counts 27 lines / 28 hits are pinned; growth is a defect signal.
9. **Never let the gate itself perform an external action** — the CI step runs the offline suite and static scanners only (never a provider call, never a scheduled task, never a message send, never a purchase).
10. **Never claim delivery to a human** without evidence: `TOAST_OK` in `notified-keys.json` plus the operator's own confirmation. `STUB_OK` and an `alerts.jsonl` line are not proof the operator saw anything.

---

## §6 Evidence bundle the operator archives per day

One directory per operator-local day, e.g. `D:/AgenticOS/data/freecash-monitor/archive/<YYYY-MM-DD>/` (**the path does not exist yet; creating it is the operator's decision — this document only specifies it**):

| # | Copy of | Why it is in the bundle |
|---|---|---|
| 1 | `state/day-locks/<day>.lock` | 0-byte proof the day was consumed exactly once (R1) |
| 2 | `snapshots/<day>.json` | the immutable reading of the day (R2/R3 input) |
| 3 | `state/last-run.json` | ledger: `last_attempt_day`, `last_success_day`, `last_outcome`, `consecutive_missed_days`, `timezone` (R1) |
| 4 | `state/notified-keys.json` | R3 proof: which keys were notified and the delivery label (`TOAST_OK`/`STUB_OK`/`FAILED_TOAST`) |
| 5 | the day's lines from `alerts/alerts.jsonl` (filter by `day_key`) | canonical evidence record: `event_type`, `severity`, `dedupe_key`, `ts_utc`, `observed` (R1–R4) |
| 6 | `approvals/pending.json` + `approvals/decided.jsonl` | R4: every item, its frozen fields, every human decision |
| 7 | the day's lines of `logs/forced-recheck-requests.jsonl` | R1: every refusal, with reason |
| 8 | `logs/toast-stub.log` lines for the day (if the stub channel was used) | distinguishes stub from real delivery |
| 9 | the stdout of the day's run (`RUN_OK …` / `SKIP_DUPLICATE_DAY …`) | the human-readable one-line summary, quoted verbatim in the weekly review |
| 10 | a SHA-256 manifest of items 1–9 | tamper evidence for the bundle |

The day's one-line summary is the `RUN_OK <day> outcome=… changes=… notifications=… approvals=… reminders=… lock=…` line; when a day is a duplicate it is `SKIP_DUPLICATE_DAY <day>`, and **that is not an error** (exit 0, no read, no snapshot write, no ledger write).

A copy/hash/archive helper does **not** exist yet. Any command for it is **UNVERIFIED** (never executed); do not put an unverified helper into the gate — the bundle is an operator procedure, not a gate.

---

## §7 Sequencing options

### Option A — Minimum viable gate now (zero code changes)
**What:** run the two verified commands and the six negative controls once, then record the transcript in the repaired `RULE-GATE-CHECKLIST.md` and sign it.
**Expected Effort:** 0.5–1 h of operator/agent time. Measured machine cost: suite 10.5 s, each scanner ≈1 s, each negative control 0.2–7 s (copying a scratch tree is the slow part).
**Time-to-Revenue:** none directly. It clears gate G1 (W1 sign-off) and is on the critical path to any later value; revenue still depends on a read source that does not exist yet.
**Dependencies:** `python` 3.11.9 on PATH (**not** `python3`, **not** pytest); git-bash for the shell checker (the python twin needs none); a scratch directory under `$LOCALAPPDATA/Temp` for the controls — never the production data root.
**First Concrete Action:** `cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py` → expect `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0; then run negative control R1-#2 (lock removal in a scratch root) and paste both outputs into the checklist.

### Option B — Full CI gate (blocking pre-commit + pinned drift baselines)
**What:** install the three-command blocking gate (§3) as `.git/hooks/pre-commit` (and/or a CI job), pin the exemption baselines (27 lines / 28 hits) as a drift test, and prove the hook blocks a deliberate regression by committing a mutated copy on a throwaway branch.
**Expected Effort:** 2–4 h: hook + the first *observed failing commit* + the exemption-count check + documenting the bypass-free install step per clone.
**Time-to-Revenue:** none directly, but it is the only thing that keeps this routine a monitor. The realistic revenue risk here is not "the monitor is late" — it is "someone finishes the payout stub" (`scripts/make_freecash_check.py`) or widens the method allowlist, and the de-facto outcome is an automated withdrawal routine. A blocking gate is what prevents that edit from landing quietly.
**Dependencies:** a decision that the gate *blocks* (fails the commit); git-bash in the commit environment (the python twin avoids this); the hook must be installed per clone because the repo has no central CI (`.github/workflows` absent — verified); **creating the hook touches a new file outside this task's write scope, so it needs the operator's explicit go-ahead.**
**First Concrete Action:** `cd D:/AgenticOS && python monitoring/freecash/verify_readonly.py; echo $?` → capture `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit `0`; hand that literal to the hook as its first check.

### Option C — Continuous daily evidence archival
**What:** after every real run, archive the ten-item bundle (§6) for that day, append the run's one-line summary to an operator log, and do a weekly review of three counters: `degraded: true` snapshots, `MISSED_DAY` lines, `DELIVERY_FAILED` lines (all three must trend to 0 for the day-30 exit criteria).
**Expected Effort:** 1–2 h to write and test the archive helper (**UNVERIFIED — it does not exist**), plus ~2 min per day of operator time and ~10 min per week of review.
**Time-to-Revenue:** this is what makes R3/R4 defensible to a third party (payment partner, accountant, future me) and it is the precondition for the day-30 review (W6). No revenue attaches until a read source exists; the archive is what makes the first real reading auditable instead of anecdotal.
**Dependencies:** real daily runs, i.e. Task A (08:35) and Task B (23:50) registered — **no task is registered today** (verified: `schtasks //query //fo LIST | grep -iE "freecash|finance|monitor"` → no output), and registration is blocked on human approval (W5, gate G5). A read source is also required for R3 to have any signal: today the default `operator_state` source returns `data_available=False` until the operator enters figures.
**First Concrete Action:** run Option A once (certify the routine), then perform **one** operator-observed real run of `python D:/AgenticOS/monitoring/freecash/run_daily_check.py` against the production data root and copy the resulting bundle by hand — proving the archival procedure before automating it, and **without registering any scheduled task** (that is the operator's R4 decision, not this plan's).

**Recommended order:** A → B → C. A is a prerequisite for B (you cannot gate what you have not run) and C is meaningless without A/B because an unarchived day cannot be evidenced later.

---

## Appendix A — command ledger (every command below was executed; output quoted from the run)

```text
# --- the gate, in the shipped repository -------------------------------------------------
cd D:/AgenticOS/monitoring/freecash && python tests/run_all.py
  run_all: tests=52 failures=0 errors=0 skipped=0            [exit 0, real 0m10,500s]

cd D:/AgenticOS && python monitoring/freecash/verify_readonly.py
  [verify_readonly] forbidden=0 exempt=28 missing_targets=0
  [verify_readonly] PASS - no unexempted write/earning token found.            [exit 0]

bash D:/AgenticOS/docs/free-cash-monitor-routine/verify-readonly.sh
  [verify-readonly] forbidden=0 exempt=28 missing_targets=0
  [verify-readonly] PASS — no unexempted write/earning token found.            [exit 0]

cd D:/AgenticOS/monitoring/freecash && python tests/test_r1_gate.py     -> Ran 7 tests in 0.628s   OK
cd D:/AgenticOS/monitoring/freecash && python tests/test_r5_smoke.py    -> Ran 8 tests in 0.596s   OK

grep -rn "readonly-exempt" D:/AgenticOS/monitoring/freecash --include=*.py --include=*.sh | wc -l
  27                                          # marker LINES; the checkers report 28 HITS
grep -rn "reconcile_missed_days" .            # (in monitoring/freecash) -> no output
schtasks //query //fo LIST | grep -iE "freecash|finance|monitor"          -> no output
ls -d .github/workflows; ls .pre-commit-config.yaml; ls .git/hooks/pre-commit  -> all absent
python -m pytest --version                    -> No module named pytest
python -c "import gate;print(gate.timezone_report())"
  {'configured': 'Europe/Berlin', 'kind': 'zoneinfo', 'available': True, 'offset_now': '+0200'}

# --- production evidence (read-only) -----------------------------------------------------
sha256sum D:/AgenticOS/data/freecash-monitor/state/day-locks/2026-09-20.lock
  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855   # 0 bytes
sha256sum D:/AgenticOS/data/freecash-monitor/state/last-run.json
  5e25ae59115daa369e1cf3f57b8fd118c67cac7d3a70608cd7fd0f7b811b4caf
# both sha256 and both mtimes (2026-09-20 21:08:00 +0200) identical before/after a suite run
cat D:/AgenticOS/data/freecash-monitor/alerts/alerts.jsonl      # 2 lines (2026-09-20)

# --- negative controls, in a byte-copy of the routine under
#     C:/Users/cd-pr/AppData/Local/Temp/fc-rule-gates-nc (repo never modified) --------------
<paste-in copies>/base/monitoring/freecash: python tests/run_all.py
  run_all: tests=52 failures=0 errors=0 skipped=0            [exit 0 — relocated harness works]
nc1  gate.py: O_EXCL removed            -> python tests/test_r1_gate.py
  FAILED (failures=2)                                        [exit 1]
nc2a injected_probe.py: requests.post(…/status/claim)  -> bash …/verify-readonly.sh <scratch>
  [verify-readonly] forbidden=4 exempt=28 missing_targets=0
  [verify-readonly] FAIL — R2 violation: an earning/write action path exists in a read-only routine.
                                                             [exit 1]
nc2b readonly_client.py: POST allowlisted -> python tests/test_r2_readonly.py
  Ran 17 tests in 7.042s
  AssertionError: ForbiddenWriteError not raised
  FAILED (failures=3)                                        [exit 1]
nc3  notify.py: key_seen -> False        -> python tests/test_r3_changedetect.py
  Ran 12 tests in 0.214s
  AssertionError: 'NOTIFIED' != 'DEDUPED'
  FAILED (failures=1)                                        [exit 1]
nc4  approval_queue.py: frozen state -> "EXECUTED"  -> python tests/test_r4_approval.py
  Ran 8 tests in 1.365s
  AssertionError: 'EXECUTED' != 'NOT_EXECUTED'   (x3)
  AssertionError: … approval_queue.py:44 carries an executable state token: EXECUTION_STATE_NOT_EXECUTED = "EXECUTED"
  FAILED (failures=4)                                        [exit 1]
r1-live lock removal (scratch FREECASH_DATA_ROOT):
  RUN_OK 2026-09-20 … lock=2026-09-20.lock
  SKIP_DUPLICATE_DAY 2026-09-20
  rm -f "$FREECASH_DATA_ROOT/state/day-locks/2026-09-20.lock"
  RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) snapshot=2026-09-20.json written=False changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock
                                                             [exit 0 — R1 violated: 2nd read]

# --- acceptance run (scratch root, 3 injected days) --------------------------------------
RUN_OK 2026-10-01 outcome=INITIAL_BASELINE … changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED … changes=1 notifications=1 approvals=1 reminders=0 lock=2026-10-02.lock
RUN_OK 2026-10-03 outcome=MONITOR_DEGRADED  … changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-03.lock
python run_daily_check.py --print-state                     -> ledger + "pending items: 1"   [exit 0]
python approval_queue.py list
  52a43751-9997-4685-8fcd-d64eb7c7d3a0  PENDING  2026-10-02  expires_at_utc=None  execution_state=NOT_EXECUTED   [exit 0]
python approval_queue.py decide --id 52a43751-… --decision approve --by system --note automatic
  REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person  [exit 4]
python approval_queue.py decide --id 52a43751-… --decision approve --by "Operator Jane" --note "checked the figures myself"
  recorded APPROVED for 52a43751-9997-4685-8fcd-d64eb7c7d3a0 by Operator Jane at 2026-09-20T19:14:23Z
  execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)      [exit 0]
python run_daily_check.py --force-recheck --reason "I want to look again"
  REFUSED_FORCE_RECHECK 2026-09-20 reason='I want to look again' (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)
                                                             [exit 3]
```

## Appendix B — UNVERIFIED (do not treat as evidence)

- Any real provider read: no endpoint is known (`PROVIDER_ENDPOINT_UNKNOWN`); no credential was used and no external host was contacted by me.
- Physical delivery of a Windows toast to a human: not exercised (`FREECASH_TOAST_STUB=1`); `logs/toast-stub.log` proves only that the stub was called.
- The `system-local` timezone degradation branch: not triggered on this host (`kind` = `zoneinfo`).
- `server/scripts/verify-freecash-rules.mjs`: I did **not** run it; the tautological `4/4 PASSED` output quoted in `AUDIT-RULE-COMPLIANCE.md` is that document's measurement, not mine.
- The pre-commit hook and `package.json` script in §3, the archive helper and the SHA-256 manifest in §6, the `archive/` directory in §6: **proposed only, never created or executed** (creating them is outside this task's write scope and would need operator approval). The `sha256sum`/`grep | wc -l` forms are verified commands; the helper that wraps them is not.
- Whether pytest was ever installed on another machine, and whether `py -3` (3.14) behaves identically to `python` (3.11.9): not tested here. This plan uses `python` only.
- Test counts per file were confirmed by grep (`def test_` = 7/17/12/8/8 → 52) and by observed `Ran …` lines for r1/r2/r3/r4/r5; a single `run_all.py` invocation is the canonical count.
- Runtime of parallel sibling documents dropped into `DELEGATION-2026-09-20/` (`RESEARCH-PLAN.md`, `WORKFLOW.md`) by other agents — not read, not modified, not relied upon.

## Appendix C — the change-control rule this document imposes on itself

A gate row may be marked **PASS** only with all four of: (1) the enforcer named by file+symbol, (2) the command executed on the committed tree, (3) the pass signal quoted verbatim, and (4) the negative control executed with a quoted FAIL. If a row's negative control has never been run, the row is **UNVERIFIED**, not PASS — and a scanner that reports `missing_targets > 0` (exit 2) is a failure of the verification, never a pass. This is the defect class that produced `verify-freecash-rules.mjs`'s "4/4 PASSED" against a file that does not parse; do not reproduce it.

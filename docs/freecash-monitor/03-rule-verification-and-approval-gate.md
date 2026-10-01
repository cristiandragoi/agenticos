# 03 — Executable Rule-Enforcement + Human-Approval Gate

**Repository:** `D:\AgenticOS` · **Host:** Windows 11, git-bash (MSYS), non-elevated
**Written:** 2026-10-01, operator-local (Europe/Berlin, UTC+02:00)
**Nature:** DESIGN + VERIFICATION ONLY. No source file was modified. No day lock or snapshot was
created in the production data root. No scheduler armed. No provider contacted. No secret written.

**Delegation:** `deleg_1b3c55be` → deliverable `03` (subagent `sa-2-c8233f94`).
**Read with:** `docs/freecash-monitor/00-delegation-brief.md`.

**Interpreter of record for every command quoted here:**
`C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` — `3.11.9`, `tzdata 2025.3`,
resolves `Europe/Berlin`. `python` on `PATH` resolves to it; `python3` does **not** exist on this host.
Verified live in this pass (see §7.1).

---

## 0. Numbering warning — READ THIS BEFORE USING ANY `R#` IN THIS DOCUMENT

**Three numberings for the same four invariants are live in this repository. A bare `R1`/`R2` is
ambiguous and has already mis-communicated once.** This is documented independently at
`docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/VERIFIER-PLAN-V2.md:24-40` (§0.1).

| Invariant (the only stable identifier) | **This document / operator / `rule_gate.py`** | `DELEGATION-BRIEF-R2.md:48-53` **and the shipped code's own docstrings/tests** | `rule_gate.py` `LEGACY_LABEL` |
|---|---|---|---|
| **no automated earning action** (read-only interceptor) | **R1** | R2 | R2 |
| **once per operator-local day** (day lock) | **R2** | R1 | R1 |
| **notify on change** | R3 | R3 | R3 |
| **human approval, never auto-executed** | R4 | R4 | R4 |

The shipped package labels itself in the **second** column's numbering:

- `monitoring/freecash/gate.py:1` — `"""gate.py -- R1: exactly one status read per operator-local calendar day."""`
- `monitoring/freecash/readonly_client.py:1` — `"""readonly_client.py -- R2: the routine's ONLY network path."""`
- `monitoring/freecash/changedetect.py:1` — `R3`
- `monitoring/freecash/approval_queue.py:1` — `R4`

This deliverable uses **operator numbering** (R1 = no-earning, R2 = once-per-day), because the task
assigns `R4 = approval gate`, `R3 = notification`, `R2 = once-per-day`. **Everywhere below, each rule is
also named by title and the code's own label is given as `code-label R#`.** A future UI/report must print
the rule *title* and state the numbering in its header, never a bare `R1`/`R2`
(`VERIFIER-PLAN-V2.md:38-40`, hardening item H8).

---

## 1. (a) Rule → enforcement artifact → violation-by-edit → mechanical check

One row per rule. "Artifact" = the file:line that actually *binds* (not the doc that describes it).
"Mechanical check" = a command or test that fails when the row's "violation by a later edit" is made.

### R1 — No earning action automatically (read-only interceptor)

**Enforced by**

| Mechanism | file:line |
|---|---|
| Method allowlist `ALLOWED_METHODS = frozenset({"GET","HEAD"})` | `monitoring/freecash/readonly_client.py:39` |
| Loopback-only host allowlist `ALLOWED_HOSTS` | `monitoring/freecash/readonly_client.py:41` |
| Path allowlist `ALLOWED_PATHS` (2 local read ops only) | `monitoring/freecash/readonly_client.py:43-49` |
| Body-keyword rejection `BODY_KEYWORDS = ("data","json","files","body","content")` | `readonly_client.py:52`, enforced `:120-126` |
| Refusal **before** the only socket site: `raise ForbiddenWriteError` at method/host/path/scheme | `readonly_client.py:115-119`, `:130-137` |
| The single socket site `_transport()` (`HTTPConnection` used once) | `readonly_client.py:76-107` (use at `:90`) |
| Process-wide audit hook refusing non-loopback `socket.connect`/`getaddrinfo` | `readonly_client.py:146-163`, installed `:166-176` |
| Static token scan (6 forbidden classes) | `monitoring/freecash/verify_readonly.py:41-88` |
| Shell equivalent, CI-runnable | `docs/free-cash-monitor-routine/verify-readonly.sh` (exists, 3443 B) |
| Tests | `monitoring/freecash/tests/test_r2_readonly.py` — `TransportGuardTests:133-210`, `StaticCheckerTests:52-130`, `ReadOnlyIntegrationTests:213-258` |

**How a later edit violates it**

1. Widen the allowlist: add a provider host to `ALLOWED_HOSTS:41` or a write path to `ALLOWED_PATHS:43-49`.
2. Add a write verb in *any* module (new file): `requests.post(...)`, `HTTPConnection(...).request("POST", …)`.
3. Obfuscate the verb at runtime: `"PO"+"ST"`, `getattr(os,"sys"+"tem")(…)`.
4. Add a second socket site outside `_transport()` (e.g. `import http.client` in a new module).
5. Loosen `BODY_KEYWORDS:52` so a `json=` body rides a `GET`.

**Mechanical check that catches it**

- Static: `python monitoring/freecash/verify_readonly.py` → exit **0** on the canonical tree,
  exit **1** on any planted write token, exit **2** if the target does not exist
  (`verify_readonly.py:176-185`). A line is exempt only with the inline marker
  `readonly-exempt: <reason>` (`verify_readonly.py:33`, honoured `:130`).
- Runtime (the load-bearing layer — the static layer alone passed 3 of 6 adversarial mutants,
  `DELEGATION-2026-10-01/verifier/rules-detector-map.md:25`): run one `metrics_http` cycle against a
  loopback stub that records every method/path and assert it saw only `GET` and `HEAD`
  (`test_r2_readonly.py:216-228`).
- Guard-level: assert `transport` was never entered on a refusal (`test_r2_readonly.py:151`, `:159`, `:171`).
- **Gap (must be closed):** `adv4` (env-gated `FREECASH_LIVE_READ=1` backdoor) escapes **both** layers,
  and `adv6` (new file importing `http.client`) is caught only by R4's effect-pinning, not by R1's check
  (`mutation-harness-run.txt:21-26`). Fix hooks H1/H2/H3 (`rules-detector-map.md:10`).

### R2 — Check status once per day (day lock)

**Enforced by**

| Mechanism | file:line |
|---|---|
| Atomic day lock `os.open(lock, O_CREAT \| O_EXCL \| O_WRONLY)` | `monitoring/freecash/gate.py:128` (`acquire_day_lock` `:119-135`) |
| Lock filename **is** the day key: `state/day-locks/<YYYY-MM-DD>.lock` | `gate.py:115-116` (`lock_path`) |
| Day key from the operator wall clock, DST-safe, never UTC | `gate.py:96-102` (`day_key`), tz resolution `:56-77`, `:80-82` |
| Acquire-then-branch: `acquired, lock = gate.acquire_day_lock(day)` | `run_daily_check.py:309` |
| Duplicate branch performs **no read, no snapshot, no ledger write** | `run_daily_check.py:310-321` |
| Ledger is *not* the gate (`last-run.json` is audit only) | `gate.py:155-163`, `:179-185`, `:188-202` |
| Second detector (same-evening watchdog), no socket, no lock | `monitoring/freecash/watchdog.py:27-42`, `:45-53` |
| Tests | `test_r1_gate.py` — `DayKeyTests:17-59`, `DoubleRunTests:62-92`, `ConcurrencyTests:95-128`, `MissedDayTests:131-167` |

**How a later edit violates it**

1. Replace `os.O_EXCL` with a `Path.exists()` pre-check → read-then-write race (`gate.py:128`).
2. Swallow `FileExistsError` into `acquired=True` (`gate.py:129-130`).
3. Compute the day key from UTC (`datetime.utcnow().date()`) instead of `zone(tz)` (`gate.py:102`).
4. Move the day-key/lock acquisition **after** the source read (the shipped `lock-before-read` ordering
   defect is the live proof: lock at `:309`, read at `:372`).
5. Add `MONITOR_DEGRADED` to / keep it in `SUCCESS_OUTCOMES` so a data-less day advances
   `last_success_day` (`gate.py:32-41`, `:198-200`) and `watchdog.py:33` reports `WATCHDOG_OK`.
6. Let a watchdog/timer path take the lock or write the ledger (`watchdog.py:8-16` forbids it).

**Mechanical check that catches it**

- Behavioural, not textual: run the entry point twice on the same injected clock; assert run #2 prints
  `SKIP_DUPLICATE_DAY`, exit 0, and that the snapshot mtime/ledger bytes/queue are unchanged
  (`test_r1_gate.py:84-92`).
- 5-process race: exactly 1 `RUN_OK`, 4 `SKIP_DUPLICATE_DAY`, one lock file (`test_r1_gate.py:98-128`).
- Non-vacuity: run #3 on the *next* day must read (else a checker that always skips would pass) —
  `DELEGATION-2026-10-01/verifier/rules-detector-map.md:11`.
- Negative control: delete/neuter the lock barrier in a scratch copy → the verifier must exit non-zero
  (`mv2-r2-lock-removed`, `mutation-harness-run.txt:9-10`; `adv2-r2-lock-nonbinding` `:17-18`).
- Day-key DST: `gate.day_key(frozen, tz="Europe/Berlin") != gate.day_key(frozen, tz="UTC")` near midnight
  (`test_r1_gate.py:20-25`).

### R3 — Notify only if earnings or account status CHANGED

**Enforced by**

| Mechanism | file:line |
|---|---|
| Four exhaustive compared fields (exact integer cents, no threshold) | `changedetect.py:34-39` |
| `compare()` — any inequality is a change; earnings drags balance into one event | `changedetect.py:226-276` (balance folded `:256`, `:260-261`) |
| **Prior snapshot loaded before the new one is written** | `run_daily_check.py:402` (`load_prior_snapshot`) then `:405` (`save_snapshot`) |
| Dedupe key `sha256(day\|change_type\|field\|old\|new)` | `changedetect.py:214-216` |
| Key persisted **before** dispatch | `notify.py:224` (`record_notified_key`) inside `dispatch` `:220-261`; index `paths.py:83-84` |
| Bounded delivery: 2 attempts then `DELIVERY_FAILED` + full message, key never retried | `notify.py:42`, `:228-261` |
| No-change is log-only and never dispatches | `notify.py:91-99` (`emit_no_change`), `:82-88` |
| Baselines never alarm | `changedetect.py:235-241`, `notify.py:102-110` |
| >5 changes coalesce into one summary | `run_daily_check.py:176`, `:207-213`; `MAX_NOTIFICATIONS` `:55` |
| Tests | `test_r3_changedetect.py:29-204` |

**How a later edit violates it**

1. **Swap the snapshot ordering** — `save_snapshot()` before `load_prior_snapshot()` makes
   `prior == current`, and the change notification can never fire. This is the documented defect of the
   overlapping legacy implementation (see §7.4) and mutant `mv3-r3-save-before-load`.
2. Make `compare()` short-circuit to `{"changes": []}` (`adv5`).
3. Change exact equality to a tolerance/percentage (`abs(new-old) > X`) — swallows a 1-cent change.
4. Move `record_notified_key` after `sender(message)` → duplicates on crash.
5. Drop the day key from the dedupe key → the same change never re-notifies on a later day.
6. Emit a notification from `emit_no_change()`.
7. Raise `MAX_ATTEMPTS` / retry a failed key outside the process.

**Mechanical check that catches it**

- Ordering is a **line-order** invariant: assert `load_prior_snapshot` line < `save_snapshot` line in
  `run_daily_check.py` (currently `402 < 405`), and behaviourally assert that a 2-day sequence with a
  changed figure produces exactly 1 `EARNINGS_CHANGED` line **and** 1 delivery, and that a day with
  identical figures produces `OK_NO_CHANGE` and 0 deliveries — the 4-day sequence at
  `rules-detector-map.md:12`.
- 1-cent exactness: `test_r3_changedetect.py:104-109`.
- Dedupe: same key twice → second returns `"DEDUPED"`, 1 delivery, 2 log lines
  (`test_r3_changedetect.py:142-145`).
- Negative control: `adv5` / `mv3` → verifier exit non-zero (`mutation-harness-run.txt:11-12`, `:23`).

### R4 — Human approval before ANY external action

**Enforced by**

| Mechanism | file:line |
|---|---|
| Enqueue-only module (no execution code path exists) | `approval_queue.py:1-27`, `enqueue` `:137-143` |
| `execution_state` is the constant `NOT_EXECUTED` | `approval_queue.py:44`, written at `:132`, re-asserted `:181` |
| `execution_allowed_by_this_routine = False` (constant) | `approval_queue.py:45`, `:133`, `:182` |
| `expires_at_utc` is always exactly `None` | `approval_queue.py:48`, `:131`, `:180` |
| Decision requires `--by` and `--note` | `approval_queue.py:149-152`, `:166-168`; CLI `:254-255` |
| Machine-identity guard (denylist — **defective**, see §4) | `approval_queue.py:55-57`, `:153-158` |
| CLI refusal exits 4; unknown id exits 3; bad input exits 2 | `approval_queue.py:283-291` |
| Append-only decision trail `approvals/decided.jsonl` | `approval_queue.py:184-200`; `paths.py:95-96` |
| Enqueue happens only on a detected change | `run_daily_check.py:149-151` |
| Reminders never decide (≤1 per 7 days, still `PENDING`) | `approval_queue.py:59`, `:217-245` |
| Tests | `test_r4_approval.py:63-285` |

**How a later edit violates it**

1. Add any branch that reads `status == "APPROVED"` and does something (`test_r4_approval.py:39-40,257-270`).
2. Make `--by` optional, or replace `_normalise_decider` with `return name or "system"`.
3. Make `NON_HUMAN_DECIDERS` an allowlist of one, or accept any non-empty string (the current denylist
   already accepts `hermes-agent` — §4, verified live at §7.2).
4. Set a non-null `expires_at_utc` or add a TTL sweep that flips `PENDING` → any other state.
5. Write any `execution_state` other than `NOT_EXECUTED` (`:132`, `:181`, `:197`).
6. Add an external-effect call (`subprocess.run`, `os.system`, `urlopen`) reachable from `enqueue()`.

**Mechanical check that catches it**

- Freeze survives time: 90-day clock advance → item still `PENDING`, `expires_at_utc is None`,
  `execution_state == "NOT_EXECUTED"` (`test_r4_approval.py:66-101`).
- Freeze survives a decision: after `decide()` the three frozen fields are unchanged
  (`test_r4_approval.py:127-129`).
- No executable token anywhere: scan the whole state tree for `EXECUTED` not preceded by `NOT_`
  (`test_r4_approval.py:40,51-60,101,141,247`).
- No module reads an approved status: `APPROVED_LITERAL` scan over the 10 module files
  (`test_r4_approval.py:39,257-270`).
- Effect-site pinning (static): every external-effect call site must be one of the three pinned sites
  (`rules-detector-map.md:17-21`); a new unpinned call fails `adv6`'s check.
- Negative controls: `mv4`, `m4a`, `m4b`, `m4c` → verifier exit non-zero
  (`mutation-harness-run.txt:13-14`, `gate-self-test.txt`).

---

## 2. (b) Verifier design, and the proof it FAILS on a known violation

### 2.1 The trust rule

> **A verifier is trusted only after it has been shown to FAIL on a known violation.**
> "PASSED" alone is not acceptance; `docs/freecash-monitor/00-delegation-brief.md:69`.

### 2.2 Why the shipped `.mjs` verifier is not a verifier (falsified live, §7.3)

`server/scripts/verify-freecash-rules.mjs` (3034 B) exits **0** and prints
`[OK] All 4 operational rules verified (4/4 passed)` — whole output reproduced at §7.3. Two facts
disqualify it:

1. **Its own hardcoded target does not parse.** `checkRule1` reads
   `../src/adapters/freecashMonitorAdapter.ts` (`:17`); `checkRule2/3/4` read
   `../scripts/freecash-daily-monitor.mjs` (`:25`, `:33`, `:40`). That target fails
   `node --check` at line 41 (`function isDailyCheckAllowed(): boolean {` — a TS annotation in a `.mjs`)
   with exit **1** (live output, §7.3). A verifier whose certified artifact cannot be executed certifies
   nothing.
2. **At least two assertions are tautologies** (static reading of the file):
   - `:34-35` — `return !content.includes('checkForChanges') || content.includes('.log(');`
     If `checkForChanges` is absent, `!false === true` → the whole check is `true` unconditionally.
   - `:41-43` — `return (!A && B) || C;` with `C = content.includes('approval-request.json')`; JS
     precedence makes this pass whenever `C` is present, regardless of `A`/`B`.

**Action:** delete it from any acceptance path (it may remain on disk, unreferenced). It is *evidence of
nothing*, and it currently backs a "4/4 PASSED" claim.

### 2.3 The verifier that is trusted: two layers + a mutation harness

The reference implementation already exists and is **proven to fail**:

- Gate: `docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py`
  (54947 B, sha256 `fca9b4a60e7fb6d9…`), with detectors `detectors/detector_r1_earn.py`,
  `_r2_daily.py`, `_r3_notify.py`, `_r4_approval.py`.
- Self-test + mutation harness: `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/mutation_harness.py`;
  results in `mutation-harness-run.txt`, `gate-self-test.txt`, `mutation-evidence/` (10 mutants + 6
  adversarial, each with a full gate transcript).
- Cheap R1-layer static+runtime verifier (code numbering): `scripts/monitoring/rule_gate_verify.py`
  (`:8-20` states its own numbering; `--run` is refused in a sandbox if a write-shape or a hardcoded
  in-repo absolute path is present, `:1-20`).

**Design (normative):**

1. **Two layers, and both must pass.** Layer A = static/AST over the package source. Layer B = behavioural:
   run the real entry point in a **throwaway copy** with `cwd` = temp dir and
   `FREECASH_DATA_ROOT` = throwaway root; observe the wire, the files, and stdout. Measured: the static
   layer alone passed `adv1`, `adv2`, `adv5` in full — **the runtime layer is load-bearing**
   (`rules-detector-map.md:25`).
2. **FAIL-CLOSED.** If the target does not parse, every rule FAILs and the exit code is non-zero; "not
   verifiable" is never "passed" (`rule_gate_verify.py:1-20`, self-test `m0` → exit 2, `NOT_VERIFIABLE`).
3. **Every verdict carries evidence:** a `file:line`, a quoted token, or an observed runtime fact. A
   verdict with no evidence is not emitted.
4. **Never print a bare `R1`/`R2`** — print the rule title and the numbering (§0, hardening item H8).
5. **Never write to the production root.** The gate refuses to run a detector whose resolved root equals
   `D:/AgenticOS/data/freecash-monitor` (per `VERIFIER-PLAN-V2.md:52-56`; source lines ~796-809).
6. **Exit codes:** `0` all rules PASS · `1` ≥1 rule FAIL · `2` not verifiable / target missing.

### 2.4 The falsification test — stated explicitly

**Protocol (the trust bar).** `mutation_harness.py`:

```
for each fixture F in the set below:
    scratch := copy of D:/AgenticOS/monitoring/freecash  ->  %LOCALAPPDATA%\Temp\<run>\<F>
    apply the one-line mutation to the copy            (the repo is never written)
    run:  <venv python> rule_gate.py --package <scratch> --workdir <temp workdir>
    REQUIRE exit != 0
    REQUIRE a "FAIL" evidence line naming the mutated rule's check
control: run the same gate against the pristine package
    REQUIRE exit == 0 and R1..R4 all PASS
```

A fixture counts as *covered* only when the control passes **and** the fixture fails. This is the
"negative-control" pattern already used for R1 in `test_r2_readonly.py:43-49,77-102`.

**The fixtures (described here; deliberately NOT created in the repository).**
Each is a one-line edit inside the throwaway copy only.

| # | Rule | Fixture (file : edit) | Required observation |
|---|---|---|---|
| F1 | R1 no-earning (static) | new file `<scratch>/injected_probe.py` line 2 = `requests.post("http://localhost:3001/api/v1/status/claim", json={})` | checker exit **1**, `FORBIDDEN` line with `injected_probe.py:2` |
| F1b | R1 no-earning (runtime) | `readonly_client.ALLOWED_METHODS` widened to `{"GET","HEAD","POST"}` | run reaches the wire with a non-`GET/HEAD` verb |
| F1c | R1 obfuscation | on the read path: `getattr(requests, "PO"+"ST")(...)` | **static passes, runtime catches** (`adv1`) |
| F2 | R2 once-per-day | `gate.py:128` → drop `os.O_EXCL` (or swallow `FileExistsError` at `:129-130`) | run #2 on the same day still performs a read (`mv2`, `adv2`) |
| F2b | R2 day key | `gate.py:102` `.astimezone(zone(tz))` → `.astimezone(timezone.utc)` | local-day key test fails near midnight |
| F3 | R3 notify | swap `run_daily_check.py:402` and `:405` (`save_snapshot` before `load_prior_snapshot`) | day-2 change is not detected/notified (`mv3`) |
| F3b | R3 non-vacuity | `changedetect.compare` returns `{"changes": []}` early | day-2 `1025→1050` produces no delivery (`adv5`) |
| F4 | R4 approval | `approval_queue.py` — accept an empty `--by`, or an auto-execute call reachable from an `APPROVED` item | `mv4` / `m4a` / `m4b` / `m4c` fail |

**Live results already on disk (inherited evidence — I did not re-run the harness in this pass):**

- Gate self-test: control exit 0 with `R1..R4 = ['PASS','PASS','PASS','PASS']`; **all 10 seeded mutants
  flagged, non-zero exit**; `SELF-TEST VERDICT: PASS` (`gate-self-test.txt`, tail).
- Mutation harness: `mv1`…`mv4` (one per rule) all `exit=1 … DETECTED=YES`
  (`mutation-harness-run.txt:7-14`); 7 of 10 mutants detected; **3 blind spots** —
  `adv3-r4-getattr-exec`, `adv4-r1-conditional-backdoor`, `adv6-r1-new-socket-file`
  (`mutation-harness-run.txt:36-41`).

**Falsifications I ran *in this pass* (not inherited):**

- **R1 static check, shell and Python, both falsified** — planted `injected_probe.py` in a temp copy
  (outside the repo): shell checker `forbidden=4 … FAIL` exit **1**; `verify_readonly.py` `forbidden=4
  exempt=18` exit **1**; the canonical tree still exits **0** (§7.5). So the R1 checker is *proven* to
  fail on a known violation.
- **R1 semantic guard falsified** by the in-suite negative controls
  (`test_write_method_is_refused_before_any_socket_opens`, `test_every_non_read_method_is_refused`, …) —
  all `ok` in the 52-test run (§7.6).
- **The old `.mjs` verifier falsified as a verifier** — exits 0 while its target fails `node --check`
  (§2.2, §7.3).

**Honesty requirement — blind spots must ship with the pass:**

| Blind spot | Fixture | Why it escapes | Fix hook |
|---|---|---|---|
| `adv3-r4-getattr-exec` | `getattr(os,"sys"+"tem")(…)` on the enqueue path | callee is itself a `Call`; static effect scanner never sees it | H4/H5 |
| `adv4-r1-conditional-backdoor` | write gated behind `FREECASH_LIVE_READ=1` | not exercised by the runtime happy path; static pattern has no literal | H1/H2 |
| `adv6-r1-new-socket-file` | new file importing `http.client` | R1's import check passes; only R4 effect-pinning trips | H3 |

A verifier report that prints `4/4 PASS` **and** these three rows is honest. One that prints `4/4 PASS`
alone is not. **Do not build the replacement on `verify-freecash-rules.mjs`.**

---

## 3. (c) R4 approval-gate hardening spec

### 3.1 The two properties, stated separately (this separation is the whole point)

- **Property S (safety): "an approval can never arm an action."**
  Holds **today**, and must hold even for a bad decider. Mechanism: the frozen fields are constants,
  not parameters — `execution_state = "NOT_EXECUTED"` (`approval_queue.py:44,132,181,197`),
  `expires_at_utc = None` (`:48,131,180,196`), `execution_allowed_by_this_routine = False`
  (`:45,133,182,198`); and there is no execution code path
  (`test_r4_approval.py:257-270`). Independently measured: after `decided_by='hermes-agent'` was accepted,
  the item stayed `NOT_EXECUTED` / `expires=None` (`DELEGATION-2026-10-01/WORKFLOW-PLAN.md:372-376`).
- **Property A (attribution): "only a human can sign."**
  Holds **only vacuously** today. `NON_HUMAN_DECIDERS` (`approval_queue.py:55-57`) denies exactly ten
  literal words; `_normalise_decider` (`:149-158`) does a case-folded **membership test** against that
  set. Anything else is accepted. **Verified live in this pass: `hermes-agent`, `Hermes Agent`,
  `assistant`, `claude`, `hermes`, and `the monitor` are each ACCEPTED** (§7.2).

**No compliance statement may say more than:** *"a decision must name a decider outside a ten-word
denylist; the routine cannot execute anything regardless."*

### 3.2 Operator-editable human allowlist — `state/human-deciders.json`

New artifact. Path accessor to add: `paths.human_deciders_path() ->
data_root() / "state" / "human-deciders.json"` (mirrors `paths.py:83-84`, `:87-88`).

```json
{
  "schema_version": 1,
  "updated_at_utc": "2026-10-01T07:00:00Z",
  "deciders": ["Christian"]
}
```

Rules:

- **Operator-editable, human-authored.** The routine never writes this file; only a human edits it.
- **Fail-closed on absence.** If the file is missing, unreadable, or `deciders` is not a non-empty list
  of non-empty strings → **refuse every decider**, exit 4, and append one `MONITOR_DEGRADED` line
  (the allowlist is a *gate*, so absence of evidence must be a refusal, never a pass — the same
  philosophy as `verify_readonly.py:170-176`, exit 2 on a missing target).
- **Created empty in the plan.** An empty `deciders: []` refuses everyone, including the operator; this is
  deliberate and is the bootstrap state. Seeding it is an explicit human action.
- **No secrets in it.** Only a name. Do not store a password, token, or [REDACTED] marker here.

### 3.3 Refusal semantics

Replace `_normalise_decider` (`approval_queue.py:149-158`) with an allowlist check. Contract:

| Condition | Result |
|---|---|
| `who` missing/blank after `.strip()` | `NotHumanError`, CLI exit **4** (unchanged, `:152`) |
| `who.strip().casefold()` **not** in the allowlist | `NotHumanError` — message names the file and the required action: `refused: <who> is not on the human-decider allowlist (state/human-deciders.json). Add the name yourself, then retry.` |
| allowlist file missing/empty/unparsable | `NotHumanError` (fail-closed), **plus** one `MONITOR_DEGRADED` alert |
| `who` on the allowlist | accepted; record `decided_by` = the name as typed, plus `decided_by_canonical` = the allowlist entry (so `Christian` and `christian` are one decider in audit) |
| `--note` blank | `ValueError`, exit **2** (unchanged, `:166-168`) |

**Refusal must be side-effect-free and must not touch the freeze.** In the shipped code the identity check
(`:165`) runs **before** any item field is mutated (`:174-182`) and the document is only saved at `:183`.
So a refusal writes nothing. That ordering is part of the contract and must be preserved: *identity is
validated before state is touched.* A refusal appends **no** `decided.jsonl` line.

### 3.4 Frozen execution fields — must survive a bad decider

The freeze is **independent of** the decider's identity, and is enforced at three points so a bad decider
(or a future edit) cannot arm an item:

1. **Construction:** `build_item` (`:108-134`) hard-codes the three frozen fields (`:131-133`). They are
   `setdefault`-free constants — not read from `change`, `proposed_action`, CLI args, or env.
2. **Decision:** `decide` re-asserts all three after recording the decision (`:179-182`), so even an
   accepted `decided_by` cannot carry an expiry in.
3. **Post-hoc verification:** a scanner asserts the three frozen fields in every item and every
   `decided.jsonl` line, and that no file in the state tree contains `EXECUTED` without the `NOT_` prefix
   (`test_r4_approval.py:40,51-60,101,247`).

Additionally: **no timer, watchdog, cron entry, or scheduler retry may change a `PENDING` status**
(`approval_queue.py:15-19`); a pending item waits indefinitely. `watchdog.py:7-16` explicitly enumerates
that it never touches the queue.

### 3.5 The two-direction test (one test, both directions)

Add one test method (to `test_r4_approval.py::HumanDecisionTests`, alongside the existing
`test_a_machine_may_not_sign_a_decision:173-182`, which currently only probes
`("system","routine","cron","   ","scheduler")` — none of the four names that actually get through).

```
test_decider_allowlist_refuses_machines_and_accepts_the_operator
  fixture: temp data root; write state/human-deciders.json = {"deciders":["<operator name>"]}
  seed one PENDING item

  (1) REFUSED direction:  decide(id,"approve","hermes-agent","x")  -> raises NotHumanError
                          decide(id,"approve","assistant","x")     -> raises NotHumanError
                          decide(id,"approve","claude","x")        -> raises NotHumanError
                          decide(id,"approve","the monitor","x")   -> raises NotHumanError
  (2) ACCEPTED direction: decide(id,"approve","<operator name>","x") -> returns status APPROVED,
                          decided_by == "<operator name>"
  (3) FREEZE direction:   after (2), item.execution_state == "NOT_EXECUTED"
                          and item.expires_at_utc is None
                          and item.execution_allowed_by_this_routine is False
  (4) NEGATIVE CONTROL:   overwrite the allowlist with {"deciders": []} ; a *fresh* item
                          decide(...,"<operator name>",...) -> now REFUSED
                          (proves the gate reads the FILE, not a hardcoded word)
  (5) CLI direction:      subprocess the shipped CLI:
                          --by hermes-agent  -> exit 4, stderr contains REFUSED
                          --by <operator>    -> exit 0, stdout contains "this routine executes nothing"
  (6) SIDE-EFFECT:        after (1), status is still PENDING and approvals/decided.jsonl does not exist
```

Direction (4) is what makes the test falsifiable: without it, a hardcoded `"Christian"` would pass (1)–(3).

### 3.6 What an approval record must contain

**`approvals/pending.json` item** (build_item `:118-134`) — required keys:

| Key | Meaning | Invariant |
|---|---|---|
| `approval_id` | uuid4, the human's handle | non-empty |
| `created_at_utc` | when enqueued | ISO-8601 `Z` (`paths.py:39`) |
| `day_key` | the operator-local day of the change | `YYYY-MM-DD` |
| `change_dedupe_key` | links the item to the R3 notification | = `changedetect.dedupe_key(...)` |
| `reason` | operator-readable: what moved | names old→new |
| `proposed_action` | a **label**, never an instruction | `action_type`, `amount_cents`, `destination = "OPERATOR_SPECIFIED - not stored by the routine"`, `provider_endpoint = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` |
| `status` | `PENDING`/`APPROVED`/`REJECTED` | starts `PENDING` |
| `status_reason`, `decided_at_utc`, `decided_by`, `decision_note` | `None` until decided | — |
| **`expires_at_utc`** | **always `null`** | frozen |
| **`execution_state`** | **always `"NOT_EXECUTED"`** | frozen |
| **`execution_allowed_by_this_routine`** | **always `false`** | frozen |

**`approvals/decided.jsonl` line** (`:184-200`) — append-only, one line per decision, must carry:
`schema_version`, `approval_id`, `day_key`, `decision`, `decided_by`, `decided_at_utc`, `decision_note`,
`change_dedupe_key`, `proposed_action`, and the three frozen fields. With the §3.3 change, add
`decided_by_canonical`.

**Labelling hazard to document, not fix (inherited, `DELEGATION-2026-09-20-R2/WORKFLOW-PLAN.md:96`):** an
earnings change auto-fills `proposed_action.action_type = "REQUEST_PAYOUT"` with
`amount_cents` defaulted from the operator's own figure (`:111-117`). It is a label, not an action
(`approval_queue.py:49-52`), but it reads to a future maintainer as a pre-authorised instruction. A
freeze test cannot catch a *reading* hazard; the mitigation is a docstring/field rename
(`ACTION_LABEL_FOR_HUMAN_REVIEW`) plus this note.

---

## 4. (d) R3 notification contract

### 4.1 What counts as a "change"

`changedetect.COMPARED_FIELDS` (`:34-39`) is the exhaustive list. Comparison is **exact integer cents** —
**no relative or percentage threshold** (`changedetect.py:8-14`), so a 1-cent move is a change
(`test_r3_changedetect.py:104-109`).

| Field | Type | Inequality produces | Notes |
|---|---|---|---|
| `account_status` | str, upper-cased (`:118-123`) | `STATUS_CHANGED` | **status delta** |
| `earnings_total_cents` | int cents | `EARNINGS_CHANGED` | **earnings delta** |
| `balance_cents` | int cents | `BALANCE_CHANGED` | **suppressed if earnings also moved** — folded into the earnings message as `(changed too)` (`:256`, `:260-261`, `notify.py:353`) |
| `pending_cents` | int cents | `EARNINGS_CHANGED`, `subtype="pending"` | **earnings delta** (subtype) |

Non-changes (each produces a line/shape but **never** a "changed" notification):

- **Baseline** — no prior snapshot, or either side has `source.data_available == false`
  (`:235-241`). First run must not produce a fake alarm (`test_r3_changedetect.py:52`).
- **Currency mismatch** — reported as `degraded`, money comparison skipped, **not** a change (`:242-247`).
- **`OK_NO_CHANGE`** — log-only, `severity=info`, never dispatches (`notify.py:91-99`).
- **A missing field is a `MetricError`, never a silent zero** (`:16-17`, `:130-131`).
- **`>5` distinct changes** coalesce into one summary notification (`run_daily_check.py:176,207-213`).

### 4.2 Dedupe-key design

```
key = sha256_hex( "%s|%s|%s|%s|%s" % (day_key, change_type, field, old_value, new_value) )
```

- Implementation: `changedetect.dedupe_key()` (`:214-216`); built for a change in
  `run_daily_check.change_dedupe_key` (`:102-109`).
- **Semantics:** *one change → exactly one notification.* The same change re-detected on a **later day** is
  a **new key** and re-notifies; a re-run inside the same day (already impossible under R2) could never
  notify twice (`changedetect.py:19-25`, `test_r3_changedetect.py:147-155`).
- **Index:** `data/freecash-monitor/state/notified-keys.json` (`paths.py:83-84`), read by `key_seen`
  (`notify.py:123-124`), written by `record_notified_key` (`:132-145`).
- **Written BEFORE dispatch** (`notify.py:224`, first statement of `dispatch`). Consequence: a crash can
  **lose** one message but can **never duplicate** one (`notify.py:12-14`).
- **Delivery states recorded per key:** `QUEUED` (`:44`) → `TOAST_OK` / `STUB_OK` (`:45-46`, the stub is
  never labelled `TOAST_OK`) or `FAILED_TOAST` (`:47`).
- **Dedupe outcome is visible in two places:** `notify_change` returns `"DEDUPED"` (`:281`), and the
  re-detection is still logged with `observed.already_notified = true` (`run_daily_check.py:138-145`).
- **Run-level keys** that are not per-change: missed-day (`run_daily_check.py:339`), read-failure
  (`:382`), coalesced summary (`:210`), watchdog (`watchdog.py:76-78`), approval reminder
  (`run_daily_check.py:224-226`).

### 4.3 Operator-facing message templates (exact)

Source of truth: `notify.py:321-381`, `:82-110`, `:411-424`. `fmt = changedetect.format_cents`
(`:282-286`), rendering `int` cents as `$%d.%02d`; `delta_text` = `"  (+$3.15)"` / `"  (-$0.05)"`
(`:337-341`).

**(a) CHANGED — earnings delta** (`field = earnings_total_cents`, `:347-357`):

```
[FreeCash] EARNINGS CHANGE {day_key}
Earnings:  $10.25 -> $13.40  (+$3.15)
Balance:   $13.40 (changed too)          <- " (changed too)" only if balance also moved
Pending:   $0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED ({source note, or "substitute source"})
Detail:    alerts.jsonl dedupe={first 16 hex of the key}
ACTION:    No action taken. Review and approve anything you want done.
```

**(b) CHANGED — status delta** (`:329-335`) — note the fixed two-space alignment after `Earnings:`:

```
[FreeCash] STATUS CHANGE {day_key}
Account status: ACTIVE -> RESTRICTED
Earnings:  $13.40 (unchanged)  Balance: $13.40 (unchanged)
Source:    DEGRADED (...)
Detail:    alerts.jsonl dedupe=...
ACTION:    No action taken. Review and approve anything you want done.
```

**(c) CHANGED — balance-only delta** (`:362-365`) → heading `[FreeCash] BALANCE CHANGE {day}` then
`Balance:   $10.25 -> $15.25  (+$5.00)` / `Earnings:  … (unchanged)` / `Pending:   … (unchanged)`.
**(d) CHANGED — pending delta** (`:358-361`) → heading `[FreeCash] EARNINGS CHANGE {day}` then
`Pending:   $0.00 -> $3.15  (+$3.15)` / `Earnings:  … (unchanged)` / `Balance:   … (unchanged)`.

**UNCHANGED** (`notify.py:82-88`, emitted by `emit_no_change` `:91-99`) — log-only, one `severity=info`
line, and **no dispatch at all**:

```
No change vs {prior_day_key}. No notification sent. Source DEGRADED ({source note}).
```

If no source note is supplied the suffix is the bare `Source DEGRADED.`

**BASELINE** (`:102-110`) — also log-only:

```
First run: baseline recorded for {day_key}. No notification sent. Source DEGRADED ({source note}).
```

**COALESCED (>5 changes)** (`:372-381`) — this one *does* dispatch, once:

```
[FreeCash] {N} CHANGES {day_key}
More than 5 distinct changes today: individual notifications suppressed.
Source:    DEGRADED (...)
Detail:    alerts.jsonl (one line per change)
ACTION:    No action taken. Review and approve anything you want done.
```

**APPROVAL PENDING** (`:411-424`) — reminder, ≤1 per item per 7 days (`approval_queue.py:59,221-231`);
it never decides:

```
[FreeCash] APPROVAL PENDING {day_key}
Approval id: {approval_id}
What changed: {reason}
Waiting since: {created_at_utc}  (no expiry - this item waits indefinitely)
Detail:    approvals/pending.json
ACTION:    No action taken. Decide it yourself: py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id {approval_id} --decision approve|reject --by "<your name>" --note "<why>"
```

**Run failed / missed day** (`:384-396`, `:399-408`) are `severity=alert`; both end with an `ACTION:` line
that says no action was taken and why a second same-day read is not permitted.

**Length cap:** messages are truncated at 500 chars with a `...` suffix (`notify.py:41`, `:65-67`).
**Delivery cap:** 2 attempts, then one `DELIVERY_FAILED` line carrying the **full** original message, the
key marked `FAILED_TOAST`, and a `MONITOR_DEGRADED` line telling the operator to read the log
(`notify.py:228-261`). A delivery failure never fails the run, never re-reads, never re-runs, and never
touches the queue (`notify.py:18-19`, `test_r5_smoke.py:71-93`).

---

## 5. (e) R2 once-per-day contract

### 5.1 The contract

**At most one status check per operator-local calendar day.** The day key is the operator wall clock
(default `Europe/Berlin`, override `FREECASH_TZ`), resolved via `zoneinfo`; if the configured zone is not
resolvable on the host the routine falls back to the system-local zone and reports `MONITOR_DEGRADED`
rather than pretending (`gate.py:15-17`, `:56-77`, `:96-102`).

The gate is a **single atomic syscall**, not a check:

```
lock = state/day-locks/<YYYY-MM-DD>.lock
fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
```

`gate.acquire_day_lock()` (`gate.py:119-135`, the `os.open` at `:128`); the lock file is zero bytes, so a
partial write can never be misread (`gate.py:5-10`). `last-run.json` is **audit only** and is explicitly
**never** the gate (`gate.py:11-13`, `:155-163`) — a corrupt ledger cannot cause a second read.

### 5.2 How `SKIP_DUPLICATE_DAY` is reported

The duplicate path is `run_daily_check.py:310-321` and it does **four** things, in this order:

1. **one** alert line appended to `alerts/alerts.jsonl`
   (`notify.alert("SKIP_DUPLICATE_DAY", …)`, `:312-319`) with
   `severity = info` (via `default_severity`, `notify.py:52-57`), `dedupe_key = null`, and
   `observed = {"lock": "<abs path to the lock>"}`;
2. **one** stdout line: `SKIP_DUPLICATE_DAY <day>` (`:320`);
3. **no** read — `read_source` is never reached (it is at `:372`);
4. **no** snapshot write and **no** ledger write — `record_attempt`/`record_outcome` are at `:329`/`:446`;
5. exit code **0** — a duplicate is explicitly *not* an error (`run_daily_check.py:23-25`, `:320-321`).

The message text is:
`Day {day} already consumed (lock {lock.name}). Duplicate run performed no read and wrote no snapshot.`
Live production instances: `alerts.jsonl` line 14 (`day_key 2026-09-30`,
`observed.lock = D:\AgenticOS\data\freecash-monitor\state\day-locks\2026-09-30.lock`,
`ts_utc 2026-09-30T19:02:06Z`) — see §7.4.

**Proof it is stated and enforced, not asserted by name:** `test_second_run_skips_with_no_side_effects`
(`test_r1_gate.py:65-92`) asserts the second run's exit 0, the `SKIP_DUPLICATE_DAY` stdout, exactly one
new skip line, exactly one new alert line, **and** that the snapshot `st_mtime_ns`, the ledger bytes and
the queue are all unchanged. `test_five_concurrent_runs_yield_one_winner` (`:98-128`) asserts
`skips == 4`, `runs == 1`. Both `ok` in this pass (§7.6).

### 5.3 How a forced re-check must consume a distinct lock

**Specified (ROUTINE-DESIGN §2.3, `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md:178` and `:392`):**
`run_daily_check.py --force-recheck --reason "…"` is a **human** action; it "consumes a distinct `-forced`
lock suffix, is recorded to `decided.jsonl`-adjacent audit with the reason, and cannot be triggered by the
scheduler (the scheduled action never passes `--force-recheck`)".

**Shipped behaviour (verified live in this pass, §7.6 / `test_r5_smoke.py:128-142`):** the flag is
accepted **only to be refused**. `run_daily_check.py:281-297`:

- appends one line to `logs/forced-recheck-requests.jsonl` with
  `{ts_utc, requested_day, reason, decision: "REFUSED", why: "one status read per operator-local calendar day (R1)"}`;
- prints `REFUSED_FORCE_RECHECK <day> reason='…'`;
- exits **3**.

That audit line is itself a `{day_key, change_type, field, old, new}`-style record but is **not** written
to the alert log, so it cannot be confused with a status read.

**Therefore: "a forced re-check consumes a distinct lock" is currently NOT IMPLEMENTED — it is refused.**
If the operator chooses to enable it, this is the contract it must satisfy (**design, not code — see §6,
UNVERIFIED against the implementation**):

1. Lock name `<day>.forced-<N>.lock` with `N` = 1, 2, … — distinct from `<day>.lock`, so it can never
   be mistaken for the ordinary day lock and never collides with it. Acquired by the *same*
   `os.O_CREAT | os.O_EXCL` primitive (`gate.py:128`); non-atomic acquisition is not permitted.
2. The ordinary `<day>.lock` must **already exist**; a forced re-check may never be the gate (it is a
   second read, not the first).
3. It writes `<day>.forced-<N>.json`, never overwriting `<day>.json` (`save_snapshot` already refuses to
   overwrite, `changedetect.py:183-189`).
4. It must **not** advance `last_success_day` and must **not** be counted as a missed day
   (`gate.record_outcome` only advances on `SUCCESS_OUTCOMES`, `:198-200`; `missed_days` is date-arithmetic,
   `:208-225`).
5. It must be **scheduler-unreachable**: the scheduled command never passes `--force-recheck`.
6. It must be **audited twice**: the request line (already written, `:282-291`) and a distinct
   `change_type`/`subtype` so the forced read is distinguishable from the ordinary read in `alerts.jsonl`.
7. Its R3 comparison must compare against the **most recent prior snapshot** as usual — a forced re-check
   on the same day must not make `prior == current` (the `mv3` hazard).

### 5.4 The live R2 defect that must be fixed (and is not a rule in this document's scope to fix)

- **Lock-before-read.** The day key is resolved and the lock acquired at `run_daily_check.py:308-309`, but
  the source is read at `:372`. A run on a day with no reading therefore consumes that day permanently.
- **Exacerbated by the ledger:** `MONITOR_DEGRADED` is in `SUCCESS_OUTCOMES` (`gate.py:32-41`), and
  `record_outcome` advances `last_success_day` for it (`:198-200`), so a data-less day is booked as a
  *success* and `watchdog.py:33` prints `WATCHDOG_OK`.
- **Production proof (verified live, §7.4):** `state/day-locks/2026-10-01.lock` exists;
  `snapshots/2026-10-01.json` has all-null figures; `state/last-run.json` has
  `last_outcome = "MONITOR_DEGRADED"` **and** `last_success_day = "2026-10-01"`.
- **Fix belongs in the wrapper, not in the lock** (so R2 is not weakened): a pre-flight that refuses to
  invoke the entry point when today's `day_key` is absent from `operator-state.json`
  (`DELEGATION-2026-10-01/WORKFLOW-PLAN.md:334-336`, `:387`; `00-delegation-brief.md:27-28`).

---

## 6. UNVERIFIED register

| # | Claim | Status | Reason |
|---|---|---|---|
| U1 | "A real decision was recorded as `decided_by='hermes-agent'`." | **PARTIALLY VERIFIED** | The **code path** is verified live: `_normalise_decider('hermes-agent')` is ACCEPTED (§7.2). The *production record* is **UNVERIFIED**: `data/freecash-monitor/approvals/` is **empty** — no `pending.json`, no `decided.jsonl`, no approval item has ever existed (§7.4). The recorded decision exists only in a sandbox, quoted at `DELEGATION-2026-10-01/WORKFLOW-PLAN.md:365-370`. |
| U2 | "A forced re-check consumes a distinct `-forced` lock." | **UNVERIFIED — NOT IMPLEMENTED** | Specified in `ROUTINE-DESIGN.md:178`; the shipped entry point **refuses** `--force-recheck` with exit 3 (`run_daily_check.py:281-297`, test `test_r5_smoke.py:128-142`). The §5.3 contract is design, not code. |
| U3 | Gate clean-run and mutation-harness results (`clean-run-gate-v1`, `mv1`…`adv6`, self-test tables). | **INHERITED, not re-run this pass** | Quoted from `DELEGATION-2026-10-01/verifier/*.txt`. I did not execute `rule_gate.py` or `mutation_harness.py` (they write to temp dirs; time-boxed out of this pass). The R1 static checker's falsification **was** re-run by me (§7.5). |
| U4 | The 3 blind spots (`adv3`, `adv4`, `adv6`) still escape at HEAD. | **INHERITED** | Same as U3. The detector map is dated 2026-10-01 (`rules-detector-map.md:3`). |
| U5 | Whether the *scheduled* route (Task Scheduler / Hermes cron) can double-fire across DST or sleep. | **UNVERIFIED** | No scheduler is registered (`schtasks` count 0; `DELEGATION-BRIEF-R2.md:29`). Out of scope of this deliverable; owned by the scheduler track. |
| U6 | Whether a provider read endpoint exists at all. | **UNVERIFIED** | `readonly_client.PROVIDER_ENDPOINT_UNKNOWN` (`readonly_client.py:59-60`); the metrics route `/api/v1/status/metrics` returned 404 per `DELEGATION-2026-10-01/WORKFLOW-PLAN.md:349-350`. The allowlist holds exactly two local paths (`readonly_client.py:43-49`, asserted `test_r2_readonly.py:126-127`). |
| U7 | Live notification delivery (a real Windows toast reaching the operator). | **UNVERIFIED** | No channel is bound (no ALERT/NOTIFY/WEBHOOK/SMTP/FREECASH keys in `.env`); every test uses the `STUB_OK` sender (`notify.py:151-164`). The R3 *contract* is verified; the *delivery* is not. |
| U8 | The `>>` figures in §7.2 are the exact production state at the time of writing. | **VERIFIED** | Two `sha256sum` lines taken after all test runs match the values independently recorded at `DELEGATION-BRIEF-R2.md:28` (`a287a902…293bf9`, `1b9c7c07…3999a8`) — the production root was not touched by this pass. |

---

## 7. Evidence appendix — commands run in this pass, verbatim

All quoted blocks below are real output from this session. The production root
`D:/AgenticOS/data/freecash-monitor` was hashed before and after and is **unchanged**.

### 7.1 Interpreter of record

```
$ python -c "import sys,zoneinfo,tzdata; print(sys.executable); print(sys.version.split()[0]); print('tzdata', tzdata.__version__); print(zoneinfo.ZoneInfo('Europe/Berlin'))"
C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
3.11.9
tzdata 2025.3
Europe/Berlin
exit=0
```

`which -a python` → `/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` first.
(`python3` missing; `python` on `PATH` is the tzdata interpreter, so no `WARNING timezone_unavailable`
appears in a normal run — contrast `gate.py:62-67`.)

### 7.2 R4 denylist — falsified live (`hermes-agent` is ACCEPTED)

```
$ cd monitoring/freecash && python -c "<probe _normalise_decider>"
'agent'            -> REFUSED (NotHumanError)
'system'           -> REFUSED (NotHumanError)
'bot'              -> REFUSED (NotHumanError)
'cron'             -> REFUSED (NotHumanError)
'scheduler'        -> REFUSED (NotHumanError)
'monitor'          -> REFUSED (NotHumanError)
'routine'          -> REFUSED (NotHumanError)
'automation'       -> REFUSED (NotHumanError)
'script'           -> REFUSED (NotHumanError)
'machine'          -> REFUSED (NotHumanError)
'hermes-agent'     -> ACCEPTED as 'hermes-agent'
'Hermes Agent'     -> ACCEPTED as 'Hermes Agent'
'assistant'        -> ACCEPTED as 'assistant'
'claude'           -> ACCEPTED as 'claude'
'hermes'           -> ACCEPTED as 'hermes'
'the monitor'      -> ACCEPTED as 'the monitor'
'Operator Jane'    -> ACCEPTED as 'Operator Jane'
'Chris (operator)' -> ACCEPTED as 'Chris (operator)'
''                 -> REFUSED (NotHumanError)
NON_HUMAN_DECIDERS= ['agent','automation','bot','cron','machine','monitor','routine','scheduler','script','system']
EXECUTION_ALLOWED_BY_THIS_ROUTINE= False NO_EXPIRY= None
```

This is the live basis for §3.1 Property A and §3.5.

### 7.3 The old `.mjs` verifier and its target

```
$ node server/scripts/verify-freecash-rules.mjs
[FREECASH RULE VERIFIER] Starting checks...
[CHECK] Rule 1: No auto-earning actions...    Result: PASSED
[CHECK] Rule 2: Once per day check...         Result: PASSED
[CHECK] Rule 3: Notify on earnings/status changes...  Result: PASSED
[CHECK] Rule 4: Human approval before external action...  Result: PASSED
✓ Rule 1 (No auto earnings) → PASSED
✓ Rule 2 (Once daily check) → PASSED
✓ Rule 3 (Notify changes) → PASSED
✓ Rule 4 (Human approval queue) → PASSED
[OK] All 4 operational rules verified (4/4 passed)
exit=0

$ node --check server/scripts/freecash-daily-monitor.mjs
D:\AgenticOS\server\scripts\freecash-daily-monitor.mjs:41
function isDailyCheckAllowed(): boolean {
                              ^
SyntaxError: Unexpected token ':'
exit=1
```

Same target, opposite verdicts. The verifier is falsified as a verifier (§2.2).

### 7.4 Live state root

```
$ ls data/freecash-monitor/approvals/          -> (empty)
$ wc -l data/freecash-monitor/alerts/alerts.jsonl -> 15
last two lines (day_key 2026-09-30 SKIP_DUPLICATE_DAY, day_key 2026-10-01 MONITOR_DEGRADED):
  {"day_key":"2026-09-30","event_type":"SKIP_DUPLICATE_DAY","severity":"info","dedupe_key":null,
   "message":"Day 2026-09-30 already consumed (lock 2026-09-30.lock). Duplicate run performed no read and wrote no snapshot.",
   "observed":{"lock":"D:\\AgenticOS\\data\\freecash-monitor\\state\\day-locks\\2026-09-30.lock"},
   "ts_utc":"2026-09-30T19:02:06Z", ...}
  {"day_key":"2026-10-01","event_type":"MONITOR_DEGRADED","severity":"info","dedupe_key":null,
   "message":"No data for 2026-10-01 (no operator-entered record for 2026-10-01 in operator-state.json). Snapshot written with null fields; nothing is compared and nothing is notified until a reading exists.",
   "observed":{"account_status":null,"balance_cents":null,"degraded":true,"earnings_total_cents":null,"pending_cents":null,"prior_day_key":"2026-09-30","source":"operator_entered"},
   "ts_utc":"2026-10-01T06:53:46Z", ...}

$ cat data/freecash-monitor/state/last-run.json
{"last_attempt_day":"2026-10-01","last_success_day":"2026-10-01","last_outcome":"MONITOR_DEGRADED",
 "consecutive_missed_days":0,"timezone":"Europe/Berlin","last_attempt_at_utc":"2026-10-01T06:53:46Z",
 "last_success_at_utc":"2026-10-01T06:53:46Z","schema_version":1,"updated_at_utc":"2026-10-01T06:53:46Z"}

$ ls data/freecash-monitor/state/day-locks/  -> 2026-09-20.lock  2026-09-30.lock  2026-10-01.lock
$ ls data/freecash-monitor/snapshots/        -> 2026-09-20.json  2026-09-30.json  2026-10-01.json  (all 518 B)

$ find data/freecash-monitor -type f -newermt "2026-10-01 09:00"   -> (nothing)
$ sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  state/last-run.json
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts/alerts.jsonl
```

Both hashes equal the values independently recorded at `DELEGATION-BRIEF-R2.md:28` → the production root
gained no file in this pass (U8 satisfied).

### 7.5 R1 static checker — proven to FAIL (fixture in a temp dir, **not** the repo)

```
$ D=.../Temp/fc-verify-probe-$$ ; cp monitoring/freecash/*.py $D/pkg/
$ printf '# planted R2 violation\nrequests.post("http://localhost:3001/api/v1/status/claim", json={})\n' > $D/pkg/injected_probe.py
$ python monitoring/freecash/verify_readonly.py $D/pkg      # native path required (MSYS mangles /tmp for native python)
  ... EXEMPT lines ...
[verify_readonly] forbidden=4 exempt=18 missing_targets=0
py_exit=1

$ bash docs/free-cash-monitor-routine/verify-readonly.sh $D2/pkg
  FORBIDDEN [http-verb] .../injected_probe.py:2:requests.post("http://localhost:3001/api/v1/status/claim", json={})
  ...
[verify-readonly] forbidden=4 exempt=28 missing_targets=0
[verify-readonly] FAIL - R2 violation: an earning/write action path exists in a read-only routine.
shell_exit=1

$ python monitoring/freecash/verify_readonly.py            # canonical tree, default target
[verify_readonly] forbidden=0 exempt=28 missing_targets=0
[verify_readonly] PASS - no unexempted write/earning token found.
clean_exit=0
```

Both checkers fail on a planted violation and pass on the canonical tree — the negative control at
`test_r2_readonly.py:77-102` is therefore *earned*, not asserted.

### 7.6 The shipped test suite, sandboxed (`FREECASH_DATA_ROOT` = throwaway `/tmp/…`)

```
$ export FREECASH_DATA_ROOT="$(mktemp -d)/freecash-monitor"   # NOT the production root
$ python monitoring/freecash/tests/run_all.py
...
run_all: tests=52 failures=0 errors=0 skipped=0
tests_exit=0

$ python -m unittest discover -s . -p "test_*.py" -t . -v
... 52 test names ... (see below)
Ran 52 tests in 11.302s
OK
```

Named assertions include (all `ok`): `test_second_run_skips_with_no_side_effects`,
`test_five_concurrent_runs_yield_one_winner`, `test_missed_days_are_reported_and_not_backfilled`,
`test_shipped_shell_checker_fails_on_a_planted_violation`,
`test_python_port_agrees_with_the_shell_checker`, `test_missing_target_is_not_a_pass`,
`test_write_method_is_refused_before_any_socket_opens`, `test_every_non_read_method_is_refused`,
`test_non_allowlisted_path_is_refused`, `test_non_loopback_host_is_refused`,
`test_entry_point_only_ever_sends_reads`, `test_earnings_change_notifies_exactly_once`,
`test_status_change_notifies_exactly_once_and_uses_its_own_key`, `test_no_change_day_is_log_only`,
`test_one_cent_is_a_change_because_cents_are_exact`,
`test_same_key_is_never_notified_twice_and_the_key_includes_the_day`,
`test_snapshot_is_immutable_once_written`, `test_pending_item_survives_a_ninety_day_clock_advance`,
`test_a_machine_may_not_sign_a_decision`, `test_cli_refuses_a_machine_identity_with_exit_code_4`,
`test_past_expiry_plus_approved_status_executes_nothing`,
`test_no_module_treats_an_approved_status_as_a_trigger`,
`test_only_the_readonly_client_may_reach_a_socket_library`,
`test_force_recheck_is_refused_and_recorded`, `test_missing_check_raises_one_alarm_and_changes_no_state`.

### 7.7 Asserted-genuinely vs asserted-by-name (the review the task asked for)

| Rule | Genuinely asserted by | Asserted **only by name** (must be strengthened) |
|---|---|---|
| **R1** no-earning | transport refusals with `transport` spy (`test_r2_readonly.py:145-189`); wire recording `assertEqual(stub.methods, ["GET","HEAD"])` (`:222`); static checker control+falsification (`:65-102`) | obfuscated / runtime-assembled verbs (`adv1` static half, `adv4` fully); a **new file** importing `http.client` is not in R1's import check (`adv6`) |
| **R2** once-per-day | 2-run skip with mtime+ledger+queue immutability (`test_r1_gate.py:84-92`); 5-process race 1 vs 4 (`:98-128`) | no test asserts that a *data-less* day must **not** advance `last_success_day` — the shipped behaviour advances it and every test passes (the §5.4 defect is **untested**) |
| **R3** notify | 2-day/4-day behaviour, delivery counts, dedupe, log-only no-change (`test_r3_changedetect.py`) | snapshot **line ordering** is asserted only indirectly (a swap is caught by `mv3`/runtime, not by any shipped unit test) |
| **R4** approval | freeze over 90 days (`:66-101`), freeze across a decision (`:127-129`), no executable token (`:40,51-60`), no `APPROVED` trigger (`:257-270`) | the identity guard is asserted only against `("system","routine","cron","   ","scheduler")` (`:176`) — **none** of the accepted machine-shaped names, and **no** allowlist/positive direction. §3.5 supplies the missing test. |

---

## 8. Recommended change order (all doc-gated by this deliverable)

| # | Action | Why | Cost | Blocks |
|---|---|---|---|---|
| 1 | **Remove `server/scripts/verify-freecash-rules.mjs` from every acceptance path.** | It prints `4/4 PASSED` while certifying a file that does not parse (§7.3). | 5 min | any compliance claim |
| 2 | **Fix the numbering** — print rule titles, never bare `R1`/`R2` (§0). | Three live numberings; already mis-communicated once. | 30 min | operator reports |
| 3 | **R4 allowlist** `state/human-deciders.json` + §3.5 two-direction test. | `hermes-agent`/`assistant`/`claude`/`the monitor` are ACCEPTED today (§7.2). | 1–2 h | R4 attribution claim |
| 4 | **Publish the verifier report with its blind spots** (§2.4 honesty table). | 3 mutants still escape (§U4). | 1 h | verifier trust |
| 5 | **Pre-flight wrapper** that refuses to invoke the entry point when today's `day_key` is absent from `operator-state.json`. | Locks are burned with no reading (§5.4, live on 2026-09-30 and 2026-10-01). | 1 h | R2 in effect |
| 6 | Add a test that a data-less day does **not** advance `last_success_day`. | The R2 defect is currently untested (§7.7). | 45 min | R2 |
| 7 | **Only then** consider arming a scheduler (itself an external action → needs operator R4 approval). | `schtasks` count 0; nothing is scheduled. | — | — |

**No source file was modified to produce this document.**

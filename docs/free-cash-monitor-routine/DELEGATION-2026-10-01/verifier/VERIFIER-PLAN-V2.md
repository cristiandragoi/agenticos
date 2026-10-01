# VERIFIER-PLAN-V2 — falsification of the 2026-09-30 rule gate, and the hardened verifier

**Deliverable of:** `sa-2` (verifier track) · **Delegation:** `deleg_fec45ca6` · **Supersedes:** `DELEGATION-2026-09-30/verifier/`
**Written:** 2026-10-01, Europe/Berlin · **Repository:** `D:\AgenticOS`
**Verifier under test:** `D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py`
`sha256 = fca9b4a60e7fb6d97b0758db7cd3e5e44c668401033bf72fd4ef28f16c759a6e` (+ `detectors/detector_r1_earn.py`, `_r2_daily.py`, `_r3_notify.py`, `_r4_approval.py`)
**Target:** `D:/AgenticOS/monitoring/freecash/` — byte-identical to what the gate certified (hash block in §1.3).
**Pinned interpreter:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (`3.11.9`, resolves `Europe/Berlin`).

Every block below is the output of a command run **in this session**, with the command shown. Nothing is inferred from reading source. Items I could not execute are labelled **UNVERIFIED**.

**Hard constraints honoured (all verified in §5):** additive only — new files exist only under `DELEGATION-2026-10-01/verifier/`; `monitoring/freecash/` unmodified (hash-identical to the certified baseline); no scheduled task or cron job registered; no provider/network contact beyond loopback; no credential read; no git write verb. **Anomaly:** `data/freecash-monitor/` gained a live `2026-10-01` run at `06:53:46Z` during this session — that write was **not** produced by this track (§5.1 quantifies and exonerates it; the parent must read §5.1 because today's day-lock is now consumed).

---

## 0. Verdict

**The 2026-09-30 gate is NOT vacuous — it fails on all four of the specified violations — but it is not yet trustworthy as an unconditional gate, because three concrete violations escape it.**

| Question | Answer |
|---|---|
| Does the gate run clean against the canonical package? | **YES** — exit 0, `R1=PASS R2=PASS R3=PASS R4=PASS` (§1) |
| Does its own self-test pass (control passes, every seeded violation flagged)? | **YES** — `SELF-TEST VERDICT: PASS`, exit 0 (§1.2) |
| Does it FAIL on one concrete violation per rule (the trust bar)? | **YES for all four** — `mv1`…`mv4` all flagged, non-zero exit (§2) |
| Is any rule's detector vacuous (passes a real violation)? | **NO** — no vacuous detector found |
| Is it complete? | **NO** — 2 mutations are entirely undetected (`adv3`, `adv4`) and 1 is detected only by a different rule's check (`adv6`) (§2, §3) |
| Smallest V2 change that closes the gaps | 4 targeted checks — H1/H2 (R1), H4/H5 (R4); plus H6 (R2 static depth) and H7 (self-test coverage) (§4) |

Trust rule applied throughout (from the standing skill rule and the 2026-10-01 brief §Constraints): *a verifier is trusted only after it has been shown to FAIL on a known violation.*

### 0.1 Numbering warning (must be fixed in V2 — it is a live mis-communication risk)

Three different numberings are in play for the same four invariants:

| Invariant | Operator / this brief & the 2026-09-30 gate | 2026-10-01 `DELEGATION-BRIEF.md` §"The four operational rules" | gate's `LEGACY_LABEL` |
|---|---|---|---|
| no automated earning action | **R1** | R2 | R2 |
| once per operator-local day | **R2** | R1 | R1 |
| notify on change | R3 | R3 | R3 |
| human approval, never auto-executed | R4 | R4 | R4 |

The gate prints `RULE n: <title> (legacy label Rm)` — but its "legacy label" is the **pre-2026-09-30** design numbering, and it is *inverted* relative to the 2026-10-01 brief. So a reader who takes "R2" from the 2026-10-01 brief ("zero automated earning actions") and reads the gate's `RULE 1 … (legacy label R2)` will mis-map. **V2 requirement (H8): never print a bare `R1`/`R2`; print the rule title (or the "once-per-day / no-earning" names) and state the numbering in the header.** This document uses the operator numbering throughout and always names the rule.

---

## 1. Part 1 — clean run of the existing gate

### 1.1 Exact command and environment

```
FREECASH_DATA_ROOT at invocation = []
CMD: C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe \
       D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py \
       --package D:/AgenticOS/monitoring/freecash \
       --workdir C:/Users/cd-pr/AppData/Local/Temp/verifier-v2-2026-10-01/work-clean
EXIT=0
```
Evidence: `clean-run-gate-v1.txt` (215 lines, full stdout) + `clean-run-gate-v1.exit.txt`.

`FREECASH_DATA_ROOT` was **unset** at invocation and is forced by the gate itself to a throwaway root per detector (`<workdir>/runtime-roots/ruleN`, source lines 796–809). The gate also refuses to run a detector if the resolved root equals the production root. No export was needed on my side.

### 1.2 Quoted output (head, tail, self-test)

```
==============================================================================
freecash rule-gate  ::  AST layer + runtime layer, per operator rule 1-4
==============================================================================
gate      : D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-30\verifier\rule_gate.py
gate sha  : fca9b4a60e7fb6d97b0758db7cd3e5e44c668401033bf72fd4ef28f16c759a6e
package   : D:\AgenticOS\monitoring\freecash
python    : C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe (3.11.9)
utc now   : 2026-10-01T06:44:27Z
workdir   : C:\Users\cd-pr\AppData\Local\Temp\verifier-v2-2026-10-01\work-clean
data roots: throwaway roots under <workdir>/runtime-roots, one per rule
prod root : D:/AgenticOS/data/freecash-monitor newest file logs\task-b-watchdog.log at 2026-09-30T19:02:08Z ; PREDATES this run -- production state untouched by this verification
runtime   : on (detectors are executed)
...
>>> RULE 1 RESULT: PASS
>>> RULE 2 RESULT: PASS
>>> RULE 3 RESULT: PASS
>>> RULE 4 RESULT: PASS
==============================================================================
SUMMARY: R1=PASS  R2=PASS  R3=PASS  R4=PASS
VERDICT: COMPLIANT -- 4/4 operator rules enforced by an AST layer and a runtime layer
==============================================================================
```

The gate's own mutation self-test, run in this session (`--self-test`, evidence `gate-self-test.txt`):

```
SELF-TEST TABLE  (control exit 0, rule results ['PASS', 'PASS', 'PASS', 'PASS'])
  mutation                         rule  exit  rule result    flagged
  m0-syntax-annotation             G0    2     NOT_VERIFIABLE yes
  m1a-cashout-post-on-read-path    1     1     FAIL           yes
  m1b-method-allowlist-widened     1     1     FAIL           yes
  m2a-day-lock-disabled            2     1     FAIL           yes
  m2b-lock-name-not-the-day        2     1     FAIL           yes
  m3a-notify-always                3     1     FAIL           yes
  m3b-change-never-notified        3     1     FAIL           yes
  m4a-queue-arms-itself            4     1     FAIL           yes
  m4b-non-human-decider            4     1     FAIL           yes
  m4c-approval-executes            4     1     FAIL           yes
  PROVEN: every one of the 4 operator rules has >= 1 seeded violation the gate flags with a non-zero exit
SELF-TEST VERDICT: PASS
SELFTEST_EXIT=0
```

### 1.3 Target integrity — the certified bytes are the bytes on disk now

`sha256sum D:/AgenticOS/monitoring/freecash/*.py` (run after all mutation work) is **identical** to the `target sha256` block the gate printed in §1 — so the package was not disturbed by anything I did:

```
approval_queue.py      0a2c982fbcfb9ca4f3371c309e308046f37976ccdb6b54e587912790fd42d506
changedetect.py        296c65aaf0be395d391ff3cb5ec92bcc1c83b191f7c3cf73377a36ff5773786b
gate.py                1c726b27e0f6d577c28454e66530d297925fd83d23de2313a3c15d13120608e7
notify.py              9bfca8cddfdea913353e7a27bb6bb9d0c17f5959c3ca11935954a0c445abcb22
operator_state.py      32f0fd7201e0f2179c434d67fb48bffe14e3adf54a69d603d4436f8c3cd1d4a7
paths.py               a38ab2e73d25d88fb0512b6e42d2877465f5a2329a73c5973999e77fc0ef1938
readonly_client.py     5426b56c11d20fbe65aa197a4f11660536e6371d585c31f827914d2930aecc27
run_daily_check.py     bda54e7d56d31f2eb7d70ae1fb5697ef4e08693060fbd2ee5c6b81327487a54c
verify_readonly.py     2c91a1fc0179a486a07b550cdbc60aa69cafa96641a6a1d3205db7062b590aa0
watchdog.py            11dfa88bff930be0886a1006190d72a72da051c8a57515029e9cdfabb7d3acdd
```

---

## 2. Part 2 — MUTATION TEST (independent of the gate's own self-test)

Harness: `mutation_harness.py` (mine). It copies the package to `$LOCALAPPDATA/Temp/verifier-v2-2026-10-01/mutants/<id>/pkg`, applies **one concrete violation per rule** (plus adversarial probes that try to *evade* the detector), re-runs `rule_gate.py` against each copy with an identical command line, and records exit code + per-rule RESULT + the first FAIL line.

Exact invocation (evidence: `mutation-harness-run.txt`, per-mutant raw gate output in `mutation-evidence/`):

```
FREECASH_DATA_ROOT at invocation = []
CMD: .../venv/Scripts/python.exe D:/.../DELEGATION-2026-10-01/verifier/mutation_harness.py
```

### 2.1 Result table — mutation → detected YES/NO → evidence file

| # | mutation id | rule | violation injected | gate exit | rule result | **detected on that rule?** | first FAIL line | evidence file |
|---|---|---|---|---|---|---|---|---|
| 1 | `mv1-r1-post-cashout` | R1 earn | `POST /cashout` added beside the read in `readonly_client.request()` | 1 | R1=FAIL | **YES** | `no HTTP write verb literal reaches any call` | `mutation-evidence/mv1-r1-post-cashout.gate.txt` |
| 2 | `mv2-r2-lock-removed` | R2 daily | `O_EXCL` removed from `gate.acquire_day_lock` (`O_CREAT|O_EXCL` → `O_CREAT`), `FileExistsError` → `return True` | 1 | R2=FAIL | **YES** | `an atomic exclusive-create barrier exists in the package` | `mutation-evidence/mv2-r2-lock-removed.gate.txt` |
| 3 | `mv3-r3-save-before-load` | R3 notify | `save_snapshot()` moved **before** `load_prior_snapshot()` in `run_daily_check._run` | 1 | R3=FAIL | **YES** | `the prior snapshot is loaded before the new one is written` | `mutation-evidence/mv3-r3-save-before-load.gate.txt` |
| 4 | `mv4-r4-execute-without-by` | R4 approval | `decide()` no longer requires `--by` (`… or "system"`) **and** `subprocess.run(["echo","EXECUTED-APPROVAL",…])` on `STATUS_APPROVED` | 1 | R4=FAIL | **YES** | `the approval queue defines a human decision path that can refuse` | `mutation-evidence/mv4-r4-execute-without-by.gate.txt` |
| 5 | `adv1-r1-obfuscated-method` | R1 | same POST, but method/path built as `"PO"+"ST"` / `"/cash"+"out"` | 1 | R1=FAIL | **YES** (runtime only) | `only GET/HEAD reached the wire` | `mutation-evidence/adv1-r1-obfuscated-method.gate.txt` |
| 6 | `adv2-r2-lock-nonbinding` | R2 | `O_CREAT|O_EXCL` kept, but `FileExistsError` swallowed into `return True` | 1 | R2=FAIL | **YES** (runtime only) | `run #2 on the same day D does NOT perform a status read` | `mutation-evidence/adv2-r2-lock-nonbinding.gate.txt` |
| 7 | `adv3-r4-getattr-exec` | R4 | on `enqueue()`, executes every pending item via `getattr(os, "sys"+"tem")("echo EXECUTED …")` | 0 | R4=**PASS** | **NO — BLIND SPOT** | `<none>` | `mutation-evidence/adv3-r4-getattr-exec.gate.txt` |
| 8 | `adv4-r1-conditional-backdoor` | R1 | obfuscated `POST /cashout` gated on `FREECASH_LIVE_READ == "1"` | 0 | R1=**PASS** | **NO — BLIND SPOT** | `<none>` | `mutation-evidence/adv4-r1-conditional-backdoor.gate.txt` |
| 9 | `adv5-r3-compare-disabled` | R3 | `compare()` short-circuits to "no changes" for any pair that has data | 1 | R3=FAIL | **YES** (runtime only) | `day 2 (earnings 1025 -> 1050) is detected and notified` | `mutation-evidence/adv5-r3-compare-disabled.gate.txt` |
| 10 | `adv6-r1-new-socket-file` | R1 | new module `status_shim.py` with `from http.client import HTTPConnection` + `conn.request("PO"+"ST", …)` | 1 | R1=**PASS**, R4=FAIL | **NO on R1** — caught only by R4's effect-pinning check | `every external-effect call site in the package is pinned and reviewed` (RULE 4) | `mutation-evidence/adv6-r1-new-socket-file.gate.txt` |

Machine-readable: `mutation-evidence/MUTATION-TABLE.tsv`. Full harness stdout: `mutation-harness-run.txt`.

### 2.2 The three uncaught / misfiled violations are LIVE, not dead code

The liveness probe (`blindspot_probe.py` → `blindspot-liveness.txt`) drives each uncaught mutant and shows the harm actually happens:

```
A. adv3-r4-getattr-exec : enqueue() -> drain_and_execute() -> os.system('echo ...')
EXECUTED 303bf3dc-8f5c-4ffe-b549-b742e5234e00          <- the shell command really ran
ENQUEUED id=303bf3dc-… status=PENDING execution_state=NOT_EXECUTED   <- and the item still claims NOT_EXECUTED

B. adv4-r1-conditional-backdoor : condition FREECASH_LIVE_READ=1 SET
WIRE=[('POST', '/api/v1/status/cashout'), ('GET', '/api/v1/status/metrics'), ('POST', '/api/v1/cashout'), ('HEAD', '/api/v1/status')]

C. adv4-r1-conditional-backdoor : condition FREECASH_LIVE_READ unset  (what every detector run does)
WIRE=[('GET', '/api/v1/status/metrics'), ('HEAD', '/api/v1/status')]
```

- `adv3`: a **real process spawn** happens on the routine's own enqueue path; the queue still reports `NOT_EXECUTED`, so the runtime check "an approval delivered no notification and took no action" is satisfied by a lie of omission. Gate verdict for this copy: `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` / `VERDICT: COMPLIANT`.
- `adv4`: the write **is** on the wire — but only when `FREECASH_LIVE_READ=1`, which no detector run sets. Gate verdict: `VERDICT: COMPLIANT`.
- `adv6`: the R1 import check reports `PASS no un-pinned network client is imported` while a brand-new module imports `http.client` and can POST. It is caught, but by R4's `every external-effect call site … is pinned` — i.e. **R1's own transport check is evadable by adding a file**. `PINNED_IMPORTS` only pins `("readonly_client.py","http.client")`, but the scan only *rejects* names in `FORBIDDEN_IMPORTS`, which does not contain `http.client` (source lines 120–138, 411–434).

### 2.3 The runtime layer is what rescues the static layer

For `adv1`, `adv2`, `adv5` the **static AST layer passed every one of its checks** and the violation was caught only by the runtime detector on the wire / in the data root:

```
adv1 static R1:  PASS no HTTP write verb literal reaches any call
                 PASS no .post/.put/.patch/.delete/urlopen call site exists
                 PASS no earning/write endpoint path appears as a string literal
                 PASS no earning-action call site exists
                 PASS the method allowlist is exactly {GET, HEAD}
                 PASS the host allowlist is loopback-only
                 PASS the allowlist is actually enforced by a guard …
                 PASS no un-pinned network client is imported
                 -> caught only by:  FAIL only GET/HEAD reached the wire

adv2 static R2:  PASS an atomic exclusive-create barrier exists in the package
                 PASS the day key is a calendar date …
                 PASS no rolling 24h window is used as the daily gate
                 PASS the day lock is acquired before the status read
                 PASS the duplicate-day branch performs no status read
                 PASS no exception handler turns a lock failure into a run
                 -> caught only by:  FAIL run #2 on the same day D does NOT perform a status read

adv5 static R3:  PASS the prior snapshot is loaded before the new one is written
                 PASS the comparison is exact equality, with no numeric threshold
                 PASS the dedupe key is a content hash of the change
                 PASS the dedupe key is persisted before the message is dispatched
                 -> caught only by:  FAIL day 2 (earnings 1025 -> 1050) is detected and notified
                                     FAIL day 4 (status ACTIVE -> LIMITED) is detected and notified
```

**Conclusion:** the static layer is a "known-bad-name / known-bad-order" filter and is evadable by construction; the two-layer design is what makes the gate non-vacuous. Any V2 must keep both layers and treat the runtime layer as load-bearing.

---

## 3. Part 3 — per-rule verdict: FAILS on the violation (trust bar) or vacuous, and the smallest fix

| Rule | Detector FAILS on the specified violation? | Vacuous? | Evasion resistance (measured) | Blind spot | Smallest fix that makes it fail |
|---|---|---|---|---|---|
| **R1** no automated earning action | **YES** — `mv1` → R1=FAIL (static: write-verb literal + forbidden path literal), and the runtime wire check also fires | **No** | Static evadable (`adv1` obfuscated literals; `adv6` new socket file) — runtime rescues `adv1`; **`adv4` escapes both layers** | **`adv4`** — a condition-gated, obfuscated write | **H2** (static: flag string-concatenation that assembles a write verb/path) — one new check |
| **R2** once per operator-local day | **YES** — `mv2` → R2=FAIL (static: no exclusive-create barrier left); `adv2` → R2=FAIL (runtime: second same-day run read again) | **No** | Static evadable (`adv2`) — runtime rescues it; **no blind spot found** | none found | **H6** — `_swallows_lock`/exclusivity check must also inspect the module that *defines* `acquire_day_lock`, not only the module that calls it |
| **R3** notify on change | **YES** — `mv3` → R3=FAIL (static: load-after-save order); `adv5` → R3=FAIL (runtime: day-2/day-4 changes never notified) | **No** | Static evadable (`adv5`) — runtime rescues it; **no blind spot found** | none found | none required for the literal violation; optional static depth check that `compare()` cannot `return` before the field loop |
| **R4** human approval, never auto-executed | **YES** — `mv4` → R4=FAIL (static: no reachable refusal path + unpinned `subprocess.run`; runtime: 11 of 20 checks failed) | **No** | **`adv3` escapes both layers** — a `getattr(os, "sys"+"tem")(...)` exec on the enqueue path; the effect scanner never sees it because the callee is itself a `Call` | **`adv3`** — any dynamically-dispatched spawn | **H4 + H5** (static: flag `getattr(<expr>, <const str>)` and `f()(...)` as unpinned effects; runtime: install an audit hook on `subprocess.Popen` / `os.system` / `os.exec*` during the detector run and assert zero) |

No detector in the gate was found to be **vacuous**: every violation I injected for a rule was flagged by that rule, and no rule reported PASS for a live violation *of its own rule* — except R1's own transport-import check for `adv6` (which the gate catches under R4 instead).

---

## 4. Part 4 — the hardened verifier (V2) and its wiring

### 4.1 What V2 must add (smallest fixes, in priority order)

| ID | Layer | Fix | Kills |
|---|---|---|---|
| **H1** | R1 static | Replace the import **deny-list** with an **allow-list**: `ALLOWED_IMPORTS` per package, and every socket-capable module (`http`, `http.client`, `socket`, `ssl`, `urllib*`, `requests`, `httpx`, …) must be pinned by `(file, module)`. Any `(file, module)` not explicitly pinned → FAIL. | `adv6` (a new file importing `http.client`) |
| **H2** | R1 static | Flag any `ast.BinOp(Add)` of string constants whose folded value matches a write verb or a forbidden path; flag `getattr(<expr>, <constant str>)` anywhere in the package. No legitimate use exists today. | `adv1`, `adv4` (obfuscated literals) |
| **H3** | R1 runtime | Exercise the routine under a **matrix of `FREECASH_*` environment conditions** and assert the wire is `{GET,HEAD}` on allowlisted paths for every run; install an audit hook on `socket.connect` / `http.client.*` that records the method of every request. | conditions a single run never sets (defence in depth for H2) |
| **H4** | R4 static | Extend the effect scan: a call whose callee is itself a `Call` (`f()(...)`), and any `getattr` with a constant-string second argument, is an **un-pinned effect** → FAIL. | `adv3` (the static half) |
| **H5** | R4 runtime | In `detector_r4_approval.py`, `sys.addaudithook` recording `subprocess.Popen`, `os.system`, `os.exec*`, `os.spawn*` for the whole detector run; assert the recording is empty. Name-shape independent — catches any spawn mechanism. | `adv3` (the runtime half) |
| **H6** | R2 static | The exclusivity/`_swallows_lock` checks must be evaluated against the module that **defines** `acquire_day_lock` (`gate.py`), and require that a `FileExistsError` handler in `acquire_day_lock` returns `False`. | `adv2` static half |
| **H7** | self-test | Add the adversarial shapes (`adv1`…`adv6`) to the gate's own `MUTATIONS` tuple so evasion resistance is regression-tested, not incidental. | silent regression of H1–H6 |
| **H8** | reporting | Never print a bare `R1`/`R2`; print the rule **title** and state the numbering once in the header. | the §0.1 mis-mapping |

Optional (not required by any measured gap): H9 — pin the rule count and fail if a rule produces fewer than N checks (already present as `MIN_CHECKS_PER_RULE = 4`; consider raising it for R3, which runs 4 static + 7 runtime checks).

### 4.2 Wiring: making the gate executable by a human or CI (no scheduler, no cron)

**Where it should live.** The gate currently sits in a *delegation* directory, which is not durable and is not versioned with the code it certifies. Promote it (and `detectors/`) to:

```
D:/AgenticOS/monitoring/freecash/tools/rule_gate.py
D:/AgenticOS/monitoring/freecash/tools/detectors/detector_r1_earn.py
D:/AgenticOS/monitoring/freecash/tools/detectors/detector_r2_daily.py
D:/AgenticOS/monitoring/freecash/tools/detectors/detector_r3_notify.py
D:/AgenticOS/monitoring/freecash/tools/detectors/detector_r4_approval.py
```

Caveat: `rule_gate.py` computes `DEFAULT_PACKAGE = HERE.parents[3]/monitoring/freecash`, so after moving it the default is wrong — **always pass `--package` explicitly** (as both commands below do). Do **not** register a Task Scheduler entry or a Hermes cron job: the gate is a *check*, and scheduling is deliberately out of scope for this track (the scheduler track owns that, and registration is itself an R4 action).

**Exact commands.**

```bash
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
PKG="D:/AgenticOS/monitoring/freecash"
GATE="D:/AgenticOS/monitoring/freecash/tools/rule_gate.py"
WD="C:/Users/cd-pr/AppData/Local/Temp/freecash-rule-gate"

# 1) Falsify the gate first — it must be able to fail.
"$PY" "$GATE" --self-test  --package "$PKG" --workdir "$WD/selftest"

# 2) Certify the package.
"$PY" "$GATE" --package "$PKG" --workdir "$WD/clean"
```

**Expected exit codes** (defined by the gate's own module docstring, and observed in this session):

| exit | meaning | CI action |
|---|---|---|
| `0` | all four rules pass (both layers) | green |
| `1` | one or more rules violated | **red** — attach the report |
| `2` | **not verifiable**: unparseable target, missing detector, detector error/timeout, or the self-test failed | **red and escalate** — this is "cannot certify", not "clean" |

`--self-test` uses the same codes: `0` = every rule has ≥1 seeded violation the gate flags; `2` = the gate failed to fail → the gate itself is broken.

**CI/human contract (no scheduler):**
1. Run the **self-test first**; require exit `0`. This is the standing rule made executable: a green clean-run means nothing until the gate has been shown to fail.
2. Run the clean certification; require exit `0`.
3. Treat exit `2` as a hard stop — never as green.
4. Run with `FREECASH_DATA_ROOT` **unset**; the gate forces throwaway roots per rule itself (`<workdir>/runtime-roots/ruleN`) and refuses the production root by path comparison. Use `--keep-workdir` for forensics; otherwise it deletes its temp dir.
5. Pin the interpreter. `detectors/` re-exec `sys.executable` as a child; the system Python has no IANA db and resolves `Europe/Berlin` to `system-local`. The pinned venv Python is required for exact day-key semantics.
6. Add `--static-only` only for a fast pre-commit smoke check, and label it non-certifying (it prints `NOT a full certification`); the mutation results in §2.3 show the static layer alone is evadable.

Commit-ready form (as an artifact for human approval — **not executed by this track**): a CI job or pre-commit hook that runs the two commands above and fails on any non-zero exit. That is the whole wiring; nothing needs to be scheduled, because the gate is deterministic and cheap (~seconds to a minute).

---

## 5. Constraint compliance (checked, not asserted) — including one observed breach that was NOT mine

```
=== git status --short -- monitoring/freecash ===      ?? monitoring/freecash/      (pre-existing untracked tree; no diff produced)
=== git status --short -- data/freecash-monitor ===    ?? data/freecash-monitor/    (pre-existing untracked tree)
=== git status --short -- docs/…/DELEGATION-2026-10-01/verifier ===  ?? …/verifier/  (only my new files)
=== no scheduler task named freecash ===               NO MATCHING SCHEDULED TASK
=== hermes cron ===  ticker files only (.jobs.lock, .tick.lock, executions.db, output/, ticker_heartbeat, ticker_last_success) — no job definitions added
```

The canonical package's `sha256` matches the gate's certified `target sha256` block (§1.3), so `monitoring/freecash/` is byte-identical to before this pass. No git write verb was run. All my files are under `DELEGATION-2026-10-01/verifier/`.

### 5.1 OBSERVED: the production state root gained a live 2026-10-01 run at 06:53:46Z — produced by something other than this track

My first inventory at 08:44 local showed the newest production file dated `2026-09-30`. The final inventory shows four new/updated files dated `2026-10-01T06:53:46Z`:

```
2026-10-01+08:53:46.6922555000  …/state/day-locks/2026-10-01.lock
2026-10-01+08:53:46.7001916000  …/snapshots/2026-10-01.json
2026-10-01+08:53:46.7047175000  …/alerts/alerts.jsonl
2026-10-01+08:53:46.7184158000  …/state/last-run.json
```
`last-run.json` now reads `last_attempt_day: "2026-10-01"`, `last_outcome: "MONITOR_DEGRADED"`; the new alert line is `MONITOR_DEGRADED … "day_key": "2026-10-01" … "source": "operator_entered"`.

**This track did not produce it.** The evidence:

1. The run carries the **live wall-clock day key `2026-10-01`**. Every invocation I made pins the clock: the gate's detectors call `run_daily_check.run(..., now=2026-03-10T12:00Z)` / `2026-03-10T09:00Z`, and my liveness probe pins `2026-03-10`/`2026-03-11`. A `2026-10-01` key is only possible from a caller that does **not** pass `now`.
2. The run used the **production root**. Every invocation I made either runs the gate (which forces `<workdir>/runtime-roots/ruleN`, and prints `data roots: throwaway roots under <workdir>/runtime-roots, one per rule`) or sets `FREECASH_DATA_ROOT` explicitly in the child.
3. No artefact of day `2026-10-01` exists anywhere under my scratch tree: every day-lock in `$LOCALAPPDATA/Temp/verifier-v2-2026-10-01/…` is `2026-03-10`…`2026-03-13`:
   ```
   2026-03-10.lock  2026-03-10-0645…lock (adv2 mutant)
   2026-03-11.lock  2026-03-12.lock  2026-03-13.lock
   ```
4. Timing: my probe wrote its throwaway roots at 08:52:19–08:52:21; the production write is 08:53:46 — a separate event. The most likely source is a *sibling track* on this delegation (the scheduler track, or a direct `run_daily_check.py` run by another agent) executed with the real clock.

**Operational consequence the parent must act on:** today's day-lock `state/day-locks/2026-10-01.lock` is now consumed. Any genuine run today will take the `if not acquired:` branch and exit 0 with `SKIP_DUPLICATE_DAY … performed no read and wrote no snapshot` — R2 is satisfied for 2026-10-01, and the day's snapshot is the `degraded: true`, all-null one above. If the operator expected today's real check to happen, it has already been spent by whoever ran it at 06:53:46Z; that is outside this track's authority to undo (and undoing it would itself be an unapproved external action).

**UNVERIFIED:** the identity of the process that wrote those four files. I can only bound it (a live-clock caller against the production root) and exonerate this track.

---

## 6. Evidence file index (all in this directory)

| File | What it proves |
|---|---|
| `VERIFIER-PLAN-V2.md` | this document |
| `clean-run-gate-v1.txt` / `.exit.txt` | §1 — clean run, exit 0, 4/4 PASS, target hashes |
| `gate-self-test.txt` | §1.2 — the gate's own `--self-test`, verdict PASS, exit 0 |
| `mutation_harness.py` | §2 — the independent mutation harness (reproducible) |
| `mutation-harness-run.txt` | §2 — harness stdout (all 10 mutants) |
| `mutation-evidence/*.gate.txt` | §2 — full gate output per mutant |
| `mutation-evidence/*.mutation.txt` | §2 — what each mutant changed |
| `mutation-evidence/MUTATION-TABLE.tsv` | §2.1 — machine-readable result table |
| `blindspot_probe.py` / `blindspot-liveness.txt` | §2.2 — proof the uncaught mutations are live |
| `rules-detector-map.md` | §4 — rule → control → detector → check map for V2 authoring |

## 7. Limitations / UNVERIFIED

- **UNVERIFIED:** the detectors' behaviour on a *live* provider account. No provider endpoint exists (`PROVIDER_ENDPOINT_UNKNOWN`), no network beyond loopback was contacted, and no credential was read. R3 is verified only against the operator-state and loopback-metrics sources.
- **UNVERIFIED:** the gate's behaviour under a *concurrent* second invocation (two processes racing the day lock on the same millisecond). `detector_r2_daily` runs the two same-day runs sequentially, not concurrently; the atomicity claim rests on `os.open(O_CREAT|O_EXCL)` semantics, which I did not race-test.
- **UNVERIFIED:** Windows Task Scheduler / Hermes cron wiring — explicitly out of scope and not registered.
- **Scope of the evasion probes:** `adv1`…`adv6` are my constructions, not an exhaustive adversarial search. They show the gate is evadable, not that these are the only evasions.
- The numbering conflict (§0.1) is a documentation/communication defect, not a code defect; V2 must fix it in the report header (H8).

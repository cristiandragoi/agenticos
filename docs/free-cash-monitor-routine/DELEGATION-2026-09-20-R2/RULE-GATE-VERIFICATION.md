# RULE-GATE-VERIFICATION.md — executable rule-enforcement gate for the Free Cash daily monitor (R1–R4)

**Delegation:** `DELEGATION-2026-09-20-R2` · **Harness:** `docs/free-cash-monitor-routine/DELEGATION-2026-09-20-R2/rule-gate-harness.sh`
**Run of record:** `2026-09-20T19:52Z` (host clock `21:52 +0200`), git-bash 5.3.15 on `MINGW64_NT-10.0-26200`, Python `3.11.9` (`C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`), repo `D:/AgenticOS`, branch `hermes-rescue-20260908`.
**Verdict of that run:** harness **exit 0** — **4/4 rules refused every injected violation (24/24 controls REFUSED_OK, 0 ACCEPTED_VIOLATION)** and **8/8 weakened mechanisms were detected as harness FAIL** (no vacuous control).
**Raw transcript:** `<temp root>/…` — the harness prints everything to stdout; the run of record is reproduced verbatim in the sections below. Full transcript captured to `C:\Users\cd-pr\AppData\Local\Temp\harness-final.txt` (246 lines) and re-copied here as the quoted blocks.

---

## 0. The one command

```bash
bash docs/free-cash-monitor-routine/DELEGATION-2026-09-20-R2/rule-gate-harness.sh
```

Options: `--only R1[,R2…]`, `--no-mutants`, `--clean`, `--quiet-prepare`. Exit codes: `0` all rules refused and all mutants caught · `1` a rule ACCEPTED its violation (or the suite is red) · `2` a mutation was not detected = harness vacuous · `3` environment/setup · `4` the production state tree changed.
Observed exit of the run of record: **0**.

Header the harness prints (observed):

```
RULE-GATE HARNESS -- Free Cash daily monitor (R1-R4) -- executable acceptance gate
run_utc=2026-09-20T19:51:40Z  host_os=MINGW64_NT-10.0-26200  bash=5.3.15(2)-release
repo=D:/AgenticOS
python=3.11.9 C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
temp_root=C:/Users/cd-pr/AppData/Local/Temp/freecash-rule-gate
injected_day=2026-09-20  injected_clock=2026-09-20T12:00:00+00:00  FREECASH_TZ=UTC
network_policy: no socket is opened by this harness; every network-shaped control uses a patched in-process transport
```

## 1. Evidence labels used in this document

| Label | Meaning |
|---|---|
| **OBSERVED** | command + verbatim stdout/stderr/exit code produced by this session (quoted below). |
| **CARRIED** | named pre-existing artifact; in this document every CARRIED claim was **re-executed in this session** and the fresh output is quoted (2026-09-20). |
| **UNVERIFIED** | not established by any run; listed in §8, never silently upgraded. |

A control is a **deliberately violating input**. `REFUSED_OK` / `NOTIFIED_OK` / `DETECTED_OK` / `NOT_EXECUTED_OK` / `LOG_ONLY_OK` / `STILL_PENDING_OK` / `NO_EXECUTION_PATH` = the violation was denied. `ACCEPTED_VIOLATION` and the rule-specific failure labels = the violation got through and the harness exits 1.

## 2. Prior art audited — defective artifacts exposed, not inherited

| Artifact | Status | Defect exposed (OBSERVED, this session) |
|---|---|---|
| `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` | **not a gate** | Every "Observed result"/"Status"/"Verified by"/"Date" cell is **empty**; §33-46 pre-flight boxes are unchecked `☐`; it cites `py -3 -m pytest` (pytest is not installed; suite is unittest) and `16 passed` (actual: 52). It is a blank form, so it can never fail. Not modified by this delegation. |
| `docs/free-cash-monitor-routine/verify-readonly.sh` | **sound, co-opted** | Exit codes correct (`0/1/2`) and it fails on injected violations — see R2.2. Its weakness is class coverage, not behaviour: it is a **token grep**, defeated by any verb/path assembled at runtime (`getattr(s, "po"+"st")`, base64, a provider SDK). Its own exemption marker is the escape hatch (`forbidden=0 exempt=28` observed). Reused by the harness as a *control*, not as the gate. |
| `monitoring/freecash/verify_readonly.py` | **sound, co-opted** | Faithful port of the shell checker; same six token classes, same exit codes; exits 1 on an injected `session.post("…/v1/cashout")` (R2.1). Same class-coverage weakness. |
| `server/scripts/verify-freecash-rules.mjs` (legacy) | **REJECTED — certifies nothing** | Runs green (`exit=0`, "All 4 operational rules verified (4/4 passed)") while certifying a file that **cannot parse**. Two of its four assertions are tautologies. Details below. |

### 2.1 Legacy verifier: certifies a file that cannot run

OBSERVED:

```
[LEGACY] verifier=D:\AgenticOS\server\scripts\verify-freecash-rules.mjs sha256=b72a770ab4fe4f60
[LEGACY] certified artifact=D:\AgenticOS\server\scripts\freecash-daily-monitor.mjs sha256=70a66b57e31f7834
[LEGACY] command: node server/scripts/verify-freecash-rules.mjs -> exit=0
[LEGACY] out| ✓ Rule 1 (No auto earnings)     → PASSED
[LEGACY] out| ✓ Rule 2 (Once daily check)      → PASSED
[LEGACY] out| ✓ Rule 3 (Notify changes)        → PASSED
[LEGACY] out| ✓ Rule 4 (Human approval queue)  → PASSED
[LEGACY] out| [OK] All 4 operational rules verified (4/4 passed)
[LEGACY] command: node --check server/scripts/freecash-daily-monitor.mjs -> exit=1
[LEGACY] parse-error| D:\AgenticOS\server\scripts\freecash-daily-monitor.mjs:41
[LEGACY] parse-error| function isDailyCheckAllowed(): boolean {
[LEGACY] parse-error|                               ^
```

`node --check` (parse only, executes nothing) exits 1 with `SyntaxError: Unexpected token ':'` on the very function the verifier's Rule-2 assertion reads as text. The certified artifact is a `.mjs` (ESM by extension) that also calls `require('node-cron')`, `require('fs')`, … — it dies before any rule code executes. **CONFIRMED, not refuted.**

### 2.2 Legacy verifier: two assertions are tautologies

Its own expressions, evaluated against the real monitor (OBSERVED):

```
[LEGACY] expression ProbeR3 (checkRule3 return) on the real monitor -> True [checkForChanges=True, '.log(' occurrences=10]
[LEGACY] expression ProbeR4 (checkRule4 return) on the real monitor -> True [requiresApproval=True, prepareActionRequests=True, 'approval-request.json' occurrences=1]
[LEGACY] expression ProbeR3 on a SYNTHETIC monitor whose only action is an unguarded cashout POST -> True
```

| Rule claimed | Actual expression | Why it cannot fail |
|---|---|---|
| R3 "notify on changes" | `!content.includes('checkForChanges') \|\| content.includes('.log(')` | Any file containing a single `console.log` passes; any file *lacking* `checkForChanges` passes via the first disjunct. A monitor whose only action is an unguarded `cashout` POST evaluates **True** (last line above). |
| R4 "human approval" | `(!includes('requiresApproval') && includes('prepareActionRequests')) \|\| includes('approval-request.json')` | The OR arm is satisfied by an inert config string: `APPROVAL_INTERFACE: './data/freecash-approval-request.json'`. Enforcement is never checked. |
| R1 "no auto-earning" | `!includes('/transactions') && !includes('/cashout') && /read-only/.test(content)` | The word `read-only` appears in the file's own doc comment (`adapter … sha256` — 4 occurrences). A comment satisfies half the assertion. |
| R2 "once per day" | `includes('isDailyCheckAllowed') && /toDateString/ && includes('lastCheck.date !== today')` | A text grep over the file that does not parse; also its `catch { return true }` branch allows the check on error. |

The legacy verifier is used in this delegation **only as the worked example of a verifier not to imitate**: the harness never accepts a text-grep as proof of a rule; every rule is refused a *live* injected violation, and the harness itself is proven able to fail (§5).

---

## 3. The four rules — mechanism, injected violation, observed refusal, residual risk

### 3.0 Summary table (4 rows, as required)

| Rule | Negative control (injected violation) | Observed refusal (exit / assertion) | Verdict |
|---|---|---|---|
| **R1** once per operator-local day | 2nd run same day; 5 concurrent runs; `--force-recheck`; (INFO) lock deleted | `exit=0 stdout="SKIP_DUPLICATE_DAY 2026-09-20"` + `lock_sha256_unchanged=True ledger_sha256_unchanged=True`; `RUN_OK=1 SKIP_DUPLICATE_DAY=4`; `exit=3 … REFUSED_FORCE_RECHECK` | **REFUSED_OK 3/3** |
| **R2** zero earning actions, read-only transport | injected `session.post("…/v1/cashout")` source file; POST/PUT/DELETE; GET `/api/v1/cashout`; GET with body; non-allowlisted host | both scanners `exit=1` with `FORBIDDEN [http-verb] …`; `ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)`; `host not allowlisted: 'api.freecash.example'`; every one with `transport_calls_delta=0` | **REFUSED_OK 9/9** |
| **R3** notify exactly once per distinct change | re-emit same change (same dedupe key); 1-cent move; failed delivery then re-emit; no-change day with a live sender | `second emission result=DEDUPED sends=1 keys_in_index=1`; `changes=1` for a 1240→1241 move; `re-emit=DEDUPED attempts_now=2`; `OK_NO_CHANGE … sends=0` | **REFUSED_OK 5/5** (1 DETECTED_OK, 1 NOTIFIED_OK, 1 LOG_ONLY_OK) |
| **R4** human approval first, no execution path | `decide` with no `--by`; `--by system`; `--by '   '`; `--by automation`; approve then hunt for any executable state; expired PENDING item run past a full routine + watchdog run | `exit=2 … error: the following arguments are required: --by`; `exit=4 REFUSED: refused: 'system' is not a human identity…`; `exit=4 REFUSED: --by is required…`; `status=APPROVED expires_at_utc=None execution_state=NOT_EXECUTED … offenders=none`; `status=PENDING expires_at_utc='2020-01-01T00:00:00Z'` after both runs | **REFUSED_OK 7/7** |

### R1 — exactly one status read per operator-local calendar day

| Field | Value |
|---|---|
| Mechanism | `monitoring/freecash/gate.py::acquire_day_lock()` — `os.open(state/day-locks/<YYYY-MM-DD>.lock, O_CREAT\|O_EXCL\|O_WRONLY)`; day key from `gate.day_key()` (operator wall clock; `FREECASH_TZ`). The ledger `state/last-run.json` is audit only, never the gate. Duplicate path in `run_daily_check.py` prints `SKIP_DUPLICATE_DAY` and performs **no** read, snapshot or ledger write. |
| Injected violation | A second invocation on the same day (`R1.1`); 5 simultaneous invocations (`R1.2`); `--force-recheck` (`R1.3`). |
| Environment | Throwaway data roots `…/freecash-rule-gate/data-r1{b,d}`; injected clock `now=2026-09-20T12:00:00+00:00`, `FREECASH_TZ=UTC` → day key exactly `2026-09-20` (no dependence on host zone). |

Baseline (`[BASE R1.0]`, observed): `exit=0 stdout="RUN_OK 2026-09-20 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-20.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-09-20.lock" lock_exists=True snapshots=['2026-09-20.json']`

Observed refusals (verbatim):

```
[CTRL R1.1] INJECT a SECOND status read on the same operator-local day 2026-09-20 (duplicate run)
[CTRL R1.1] OBSERVED exit=0 stdout="SKIP_DUPLICATE_DAY 2026-09-20"
[CTRL R1.1] OBSERVED snapshots=['2026-09-20.json'] lock_sha256_unchanged=True ledger_sha256_unchanged=True
[CTRL R1.1] VERDICT REFUSED_OK assertion: stdout contains "SKIP_DUPLICATE_DAY 2026-09-20" AND snapshots==1 AND day-lock and ledger byte-identical (exit 0 is by design: a duplicate is not an error)
[CTRL R1.2] INJECT 5 concurrent invocations racing on the same day (O_CREAT|O_EXCL lock)
[CTRL R1.2] OBSERVED outcomes: RUN_OK=1 SKIP_DUPLICATE_DAY=4 snapshots=['2026-09-20.json'] locks=['2026-09-20.lock']
[CTRL R1.2] VERDICT REFUSED_OK assertion: exactly 1 winner, 4 refusals, 1 snapshot, 1 lock file
[CTRL R1.3] INJECT --force-recheck (an explicit request for a second same-day status read)
[CTRL R1.3] OBSERVED exit=3 stdout="REFUSED_FORCE_RECHECK 2026-09-20 reason='gate-harness negative control' (a second status read in one day is forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)"
[CTRL R1.3] VERDICT REFUSED_OK assertion: exit==3 AND stdout contains REFUSED_FORCE_RECHECK
```

Note on exit codes: the duplicate run exits **0 by design** (`run_daily_check.py` docstring: "a duplicate is not an error"); the refusal assertion is the `SKIP_DUPLICATE_DAY` line **plus** byte-identical lock/ledger and a single snapshot. `--force-recheck` refuses with **exit 3**.

Mechanism attribution + residual risk (observed, `[INFO R1.4]`):

```
[INFO R1.4] MECHANISM-ATTRIBUTION: the day-lock FILE is the gate: with the lock present, run1 exit=0 issued 2 status reads (GET/HEAD pair); after deleting only state/day-locks/2026-09-20.lock in the throwaway root, run2 exit=0 issued 2 MORE status reads for the same day. No OS-level immutability, ACL or signature protects the lock.
```

Residual risks that remain **unproven**:

1. **The lock is deletable.** Anyone with write access to the state root can `rm state/day-locks/<day>.lock` and obtain a second status read the same day. Observed (R1.4). Mitigation is procedural only — no ACL, no signature, no off-host anchor.
2. **Clock trust.** "Per calendar day" rests on the host clock and `FREECASH_TZ`. The harness injected a fixed clock; the gate was not tested against a clock jump, NTP correction, or DST transition. On this host the configured `Europe/Berlin` is unresolvable (no IANA db), so production degrades to the machine's local zone and reports `MONITOR_DEGRADED` (documented in `gate.resolve_tz`).
3. **Single-host only.** The `O_CREAT|O_EXCL` guarantee was observed on local NTFS. Cross-host concurrency on a shared/network state root is **UNVERIFIED**.
4. **Only this routine is gated.** A hand-run script, the legacy `.mjs` monitor (if it were ever fixed), or any other process can still read provider status on the same day. R1 constrains `run_daily_check.py`, not the machine.
5. The lock is created **before** the read; a crashed run therefore burns the day (no re-read). That is fail-closed and intentional, but it means a transient failure costs a day of coverage — not tested here.

### R2 — zero automated earning actions, read-only transport

| Field | Value |
|---|---|
| Mechanism | (a) `readonly_client.py::request()` — deny-by-default: `ALLOWED_METHODS={GET,HEAD}`, `ALLOWED_PATHS` regex tuple, `ALLOWED_HOSTS={localhost,127.0.0.1,::1}`, `BODY_KEYWORDS=("data","json","files","body","content")`, unknown kwargs refused; every refusal raises `ForbiddenWriteError` **before** `_transport` — the single `conn.request` site in the whole routine. (b) process-wide `sys.addaudithook` aborting non-loopback connects. (c) static scanners `monitoring/freecash/verify_readonly.py` and `docs/free-cash-monitor-routine/verify-readonly.sh` (six token classes, `# readonly-exempt:` per-line escape). |
| Injected violations | `R2.1/R2.2` a source file containing `session.post("https://api.freecash.example/v1/cashout", json={"amount_cents": 99999})` and `session.request("POST", "/offers/…/claim")` seeded into a scanned tree. `R2.3–R2.9` live calls through `readonly_client.request()` with the transport patched to a recorder (no socket exists). |

Observed refusals (verbatim; `C:\\…\\r2-violation\\cashout.py` is the injected file):

```
[BASE R2.0] shipped R2 static scanners on the real tree monitoring/freecash: verify_readonly.py exit=0 [verify_readonly] forbidden=0 exempt=28 missing_targets=0 | verify-readonly.sh exit=0 [verify-readonly] forbidden=0 exempt=28 missing_targets=0
[CTRL R2.1] OBSERVED verify_readonly.py exit=1 findings=['FORBIDDEN [http-verb] …\r2-violation\cashout.py:5: return session.post("https://api.freecash.example/v1/cashout", json={"amount_cents": 99999})', 'FORBIDDEN [write-call-shape] …cashout.py:5: …']
[CTRL R2.2] OBSERVED verify-readonly.sh exit=1 findings=['FORBIDDEN [http-verb] …cashout.py:5:    return session.post("https://api.freecash.example/v1/cashout", json={"amount_cents": 99999})', 'FORBIDDEN [http-verb] …cashout.py:9:    return session.request("POST", "/offers/%s/claim" % offer_id)']
[CTRL R2.3] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)   [transport_calls_delta=0]
[CTRL R2.4] INJECT POST http://localhost:3001/api/v1/cashout with an earnings payload json={"amount_cents": 99999}
[CTRL R2.4] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)   [transport_calls_delta=0]
[CTRL R2.5] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: method 'PUT' is not read-only (allowed: GET, HEAD)   [transport_calls_delta=0]
[CTRL R2.6] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: method 'DELETE' is not read-only (allowed: GET, HEAD)   [transport_calls_delta=0]
[CTRL R2.7] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: path not allowlisted: '/api/v1/cashout'   [transport_calls_delta=0]
[CTRL R2.8] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: request bodies are forbidden ('data')   [transport_calls_delta=0]
[CTRL R2.9] OBSERVED REFUSED before any socket write: ForbiddenWriteError: R2: host not allowlisted: 'api.freecash.example'   [transport_calls_delta=0]
```

Anti-vacuity and static corroboration (observed):

```
[BASE R2.10] NON-VACUITY allowlisted read: GET http://localhost:3001/api/v1/status/metrics -> 'HTTP 200' ; transport_calls_total=1 (exactly the one allowlisted read)
[BASE R2.11] static: network-capable imports and the single socket site: imports={"run_daily_check": [], "gate": [], "changedetect": [], "notify": [], "approval_queue": [], "operator_state": [], "paths": [], "watchdog": [], "readonly_client": ["http.client", "urllib.parse"], "verify_readonly": []} ; non-readonly_client offenders=none ; 'conn.request(' in readonly_client.py=1
```

Residual risks that remain **unproven**:

1. **In-process guard, not a sandbox.** The guard is Python-level. Code that imports `socket`/`http.client` directly, a provider SDK, or a future edit adding a second socket site bypasses it. The `sys.addaudithook` blocks non-loopback `connect`/`getaddrinfo` only — a **loopback** POST would pass the audit hook (it is the method/path guard that stops it).
2. **The static scanners are token greps.** Defeated by runtime-assembled verbs/paths (`getattr`, `"po"+"st"`, base64, `eval`), by a new file extension the walker skips, or by a provider SDK that hides the verb. Coverage of six classes ≠ absence of earning actions.
3. **Exemption erosion is unguarded.** `forbidden=0 exempt=28` today; nothing fails if that 28 grows, and the marker is on the same line as the offending token — a contributor can exempt any line by appending `# readonly-exempt: <reason>`.
4. **The transport was never exercised for real.** Every transport control used a patched in-process recorder, so no socket, no TLS, no auth, no provider semantics were observed. `ROUTINE-DESIGN.md` test T2.4 ("reads are read-only, observed live") remains **N/A — no credentials** (see §8).
5. **GET/HEAD is not proof of no side effects.** A GET is only harmless if the server implements it as harmless; the allowlist currently contains only `/api/v1/status[/metrics]` on loopback, so this is moot for the routine today but would become live the moment a provider read path is allowlisted.
6. The routine's live provider read does not exist (`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`), so "R2 holds for provider traffic" is vacuously true (there is no provider traffic).

### R3 — exactly one notification per distinct earnings/status change

| Field | Value |
|---|---|
| Mechanism | `changedetect.py::compare()` — four compared fields (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`), **exact integer cents**, no relative threshold; `changedetect.dedupe_key() = sha256(day\|change_type\|field\|old\|new)`; `notify.dispatch()` calls `record_notified_key(key, QUEUED)` **before** the send; `notify.notify_change()` returns `DEDUPED` when `key_seen()`; max 2 attempts, then one `DELIVERY_FAILED` (+ a `MONITOR_DEGRADED` alert) and no retry of that key ever; `OK_NO_CHANGE` is log-only (`severity=info`). |
| Injected violations | `R3.1` a 1-cent move; `R3.2` re-emit the same change (same key); `R3.3` same change on the next day (must still notify — anti-vacuity); `R3.4` sender raises, then the key is re-emitted; `R3.5` a no-change day with a live sender installed. |

Observed (verbatim):

```
[BASE R3.0] baseline comparison: earnings 1340 -> 1500 with the balance dragged along: changes=1 [('EARNINGS_CHANGED', 'earnings_total_cents')]
[CTRL R3.1] OBSERVED changes=1 [('EARNINGS_CHANGED', 1240, 1241)]            -> VERDICT DETECTED_OK
[CTRL R3.2] INJECT re-emit the SAME distinct change (same dedupe key 308b52cabce8ec79...) a second time
[CTRL R3.2] OBSERVED first emission result=NOTIFIED sends=1
[CTRL R3.2] OBSERVED second emission result=DEDUPED sends=1 keys_in_index=1
[CTRL R3.2] VERDICT REFUSED_OK assertion: second emission returns DEDUPED and the sender is never invoked again
[CTRL R3.3] OBSERVED result=NOTIFIED sends=2                                  -> VERDICT NOTIFIED_OK
[CTRL R3.4] OBSERVED first=FAILED attempts=2 key_recorded=True delivery='FAILED_TOAST'
[CTRL R3.4] OBSERVED re-emit=DEDUPED attempts_now=2 delivery_failed_lines=1
[CTRL R3.4] VERDICT REFUSED_OK assertion: at most 2 attempts, the key is already in the index after the failure, and a re-emit of a FAILED key is refused (no retry storm)
[CTRL R3.5] OBSERVED event_type=OK_NO_CHANGE severity=info sends=0            -> VERDICT LOG_ONLY_OK
```

Residual risks that remain **unproven**:

1. **No end-to-end double-run control.** Exactly-once is proven at the `changedetect`/`notify` layer, because R1 makes a second same-day run unreachable. A full-run duplicate-notify path therefore cannot be injected without first breaking R1 — the two rules cover each other's blind spot, which is not the same as being independently proven.
2. **At-most-once, not exactly-once.** The key is written before dispatch, so a crash between key-write and delivery loses the notification silently (the message survives only in `alerts.jsonl`). Deliberate, but the operator must read the log.
3. **Dedupe state is a mutable file.** Deleting `state/notified-keys.json` re-notifies everything; nothing anchors it. Concurrent writers (read-modify-write, no file lock) could lose a key and produce a duplicate notification — **UNVERIFIED** (no concurrency control in `record_notified_key`).
4. **Key includes the day.** The same underlying change re-detected tomorrow notifies again — by design, but "one notification per change" is really "per change per day", and a caller that omits the day component would silently suppress real news forever.
5. **Float dollar fallback.** `_DOLLAR_ALIASES` converts whole-currency values with `round()`; sub-cent moves in a provider payload in dollars could collapse. Only the integer-cents path was exercised. **UNVERIFIED** against any real provider payload.
6. **>5 changes coalesce** into one summary notification keyed `MONITOR_DEGRADED|change_count`; per-change visibility then depends on reading `alerts.jsonl`. Not exercised by the harness (fixed at ≤5 in the fixtures).

### R4 — human approval before any external action; no execution path exists

| Field | Value |
|---|---|
| Mechanism | `approval_queue.py`: `enqueue()` writes `status=PENDING`, `expires_at_utc=NO_EXPIRY` (always `None`), `execution_state="NOT_EXECUTED"`, `execution_allowed_by_this_routine=False`; `decide()` (`--by` + `--note` required) refuses machine identities (`NON_HUMAN_DECIDERS` = system/routine/automation/agent/cron/scheduler/monitor/bot/script/machine, empty string refused) and **re-asserts** the frozen fields; the routine contains no code that consumes an `APPROVED` item. |
| Injected violations | `R4.1` no `--by`; `R4.2` `--by system`; `R4.3` `--by '   '`; `R4.4` `--by automation`; `R4.5` approve as a human then hunt for any executable state / expiry anywhere in the store; `R4.6` a PENDING item carrying `expires_at_utc=2020-01-01T00:00:00Z` exposed to a full routine run **and** the watchdog; `R4.7` static hunt for any consumer of a decision. |

Observed (verbatim):

```
[BASE R4.0] enqueue one item (the routine's only approval-queue write): status=PENDING expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed_by_this_routine=False
[BASE R4.0b] frozen module constants: NO_EXPIRY=None EXECUTION_STATE_NOT_EXECUTED='NOT_EXECUTED' EXECUTION_ALLOWED_BY_THIS_ROUTINE=False
[CTRL R4.1] OBSERVED exit=2 stderr='usage: approval_queue.py decide [-h] --id ID --decision {approve,reject} --by\n                                BY --note NOTE\napproval_queue.py decide: error: the following arguments are required: --by'
[CTRL R4.2] INJECT decide --by "system" (a non-human identity)
[CTRL R4.2] OBSERVED exit=4 stderr="REFUSED: refused: 'system' is not a human identity; this routine may only record a decision made by a person"
[CTRL R4.3] OBSERVED exit=4 stderr='REFUSED: --by is required: a decision must name the human who made it'
[CTRL R4.4] OBSERVED exit=4 stderr="REFUSED: refused: 'automation' is not a human identity; this routine may only record a decision made by a person"
[CTRL R4.5] OBSERVED after approval: status=APPROVED expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed_by_this_routine=False audit_records=1 offenders=none
[CTRL R4.5] VERDICT NOT_EXECUTED_OK assertion: the human decision is recorded (non-vacuity) AND nothing anywhere holds an executable state or an expiry
[CTRL R4.6] OBSERVED routine exit=0 stdout="RUN_OK 2026-09-20 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-09-20.json written" ; watchdog exit=0 stdout="WATCHDOG_OK 2026-09-20 attempt=2026-09-20 outcome=INITIAL_BASELINE"
[CTRL R4.6] OBSERVED expired item after both runs: status=PENDING expires_at_utc='2020-01-01T00:00:00Z' execution_state=NOT_EXECUTED
[CTRL R4.6] VERDICT STILL_PENDING_OK assertion: the item is still PENDING, its expiry is untouched and its execution state is still NOT_EXECUTED (no TTL job, no watchdog, no scheduler retry exists)
[CTRL R4.7] OBSERVED outside approval_queue.py: decide() callers=none ; execution_state/expires_at_utc writers=none ; references to APPROVED=none
[CTRL R4.7] VERDICT NO_EXECUTION_PATH assertion: no module outside approval_queue.py calls decide(), writes an executable state, or even mentions APPROVED (a decision is not consumable by this routine)
```

`R4.5` is also the **anti-vacuity** control for R4: a human decision is *accepted* (`exit=0`, `recorded APPROVED for 83513a8a-… by Alice (gate-harness human)`), proving the refusals are targeted at machines rather than "everything is refused".

Residual risks that remain **unproven**:

1. **"No execution path" is a code fact, not a capability.** Proven for this source tree (R4.7). Anyone who can edit the routine can add the path; nothing binds an approval record to a code revision, hash or signature.
2. **No authentication of the human.** `--by "Alice"` is accepted with no verification, no OS-user binding, no signature. The gate proves a *name* was typed, not that a person decided. `decided_by` is free text (`"Alice"` and `"alice"` are distinct deciders).
3. **External consumers are out of scope.** R4.6 covers the routine and its watchdog. A third-party script, a future scheduler, or a human editing `approvals/pending.json` can flip state; `decided.jsonl` is append-only by convention, not by file permission.
4. **No encryption/integrity** on `pending.json`/`decided.jsonl`; anyone with write access can forge or delete a decision trail. **UNVERIFIED** — no threat model was tested.
5. **No re-decision guard**: `decide()` can be applied repeatedly to the same item (each appends a line). Not a rule violation, but the audit trail can hold contradictory decisions; not tested.
6. **Expiry semantics are only as strong as the absence of code.** `expires_at_utc` is `None` by constant; a *future* feature that reads `created_at_utc` and computes staleness could re-introduce a TTL — nothing fails today, and nothing would fail then except the R4.0b premise check.

---

## 4. Mutation self-test — proof that the harness itself can fail

For each rule the harness weakens exactly one mechanism in the throwaway copy (anchor must occur exactly once, else the mutation is reported as setup-failed) and requires its own section to report FAIL. A mutation that the harness still passes would make the whole document worthless; that is why the exit code for it is `2`, not `0`.

Observed (verbatim, abridged to the verdict lines):

```
[MUTANT R1.lock-always-acquired] APPLIED gate.py: 'except FileExistsError:\n        return False, lock' -> 'except FileExistsError:\n        return True, lock'
    [CTRL R1.1] VERDICT ACCEPTED_VIOLATION …   [CTRL R1.2] VERDICT ACCEPTED_VIOLATION …
    [SECTION R1] FAIL controls=3 refused=1 accepted_violations=2 errors=0
[MUTANT R1.lock-always-acquired] DETECTED_OK harness reported FAIL for R1 (section exit=1) -- the gate is not vacuous

[MUTANT R2.method-allowlist-off] APPLIED readonly_client.py: 'if verb not in ALLOWED_METHODS:' -> 'if False and verb not in ALLOWED_METHODS:'
    [CTRL R2.3] VERDICT ACCEPTED_VIOLATION …   [CTRL R2.5] VERDICT ACCEPTED_VIOLATION …   [CTRL R2.6] VERDICT ACCEPTED_VIOLATION …
    [BASE R2.10] PREMISE-FAILED the rule cannot be evaluated from this run
    [SECTION R2] FAIL controls=9 refused=6 accepted_violations=3 errors=1
[MUTANT R2.path-allowlist-off] APPLIED readonly_client.py: 'if not any(pattern.match(path) for pattern in ALLOWED_PATHS)' -> 'if False and not any(…'
    [CTRL R2.7] VERDICT ACCEPTED_VIOLATION …   [SECTION R2] FAIL controls=9 refused=8 accepted_violations=1 errors=1
[MUTANT R2.host-allowlist-off] APPLIED readonly_client.py: 'if host not in ALLOWED_HOSTS:' -> 'if False and host not in ALLOWED_HOSTS:'
    [CTRL R2.9] VERDICT ACCEPTED_VIOLATION …   [SECTION R2] FAIL controls=9 refused=8 accepted_violations=1 errors=1
[MUTANT R3.dedupe-off] APPLIED notify.py: 'if key_seen(dedupe_key):' -> 'if False:'
    [CTRL R3.2] VERDICT ACCEPTED_VIOLATION …   [CTRL R3.3] VERDICT WRONGLY_SUPPRESSED …   [CTRL R3.4] VERDICT ACCEPTED_VIOLATION …
    [SECTION R3] FAIL controls=5 refused=2 accepted_violations=3 errors=0
[MUTANT R4.human-guard-off] APPLIED approval_queue.py: 'if who.lower() in NON_HUMAN_DECIDERS:' -> 'if False:'
    [CTRL R4.7] VERDICT NO_EXECUTION_PATH …   [SECTION R4] FAIL controls=7 refused=5 accepted_violations=2 errors=0
[MUTANT R4.execution-state-armed] APPLIED approval_queue.py: 'EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"' -> '"EXECUTED"'
    [BASE R4.0] PREMISE-FAILED …  [BASE R4.0b] PREMISE-FAILED …  [SECTION R4] FAIL premise failed; refusals cannot be evaluated
[MUTANT R4.expiry-armed] APPLIED approval_queue.py: 'NO_EXPIRY = None' -> 'NO_EXPIRY = "2099-01-01T00:00:00Z"'
    [BASE R4.0] PREMISE-FAILED …  [BASE R4.0b] PREMISE-FAILED …  [SECTION R4] FAIL premise failed; refusals cannot be evaluated

[MUTANTS] total=8 detected=8 vacuous_count=0
```

| Mutant | Weakened mechanism | Caught by | Honest limitation |
|---|---|---|---|
| `R1.lock-always-acquired` | `O_CREAT\|O_EXCL` conflict returns "acquired" | R1.1 + R1.2 both ACCEPTED_VIOLATION | — |
| `R2.method-allowlist-off` | method allowlist | R2.3/R2.5/R2.6 accepted; R2.10 non-vacuity premise failed | body/kwarg guards still held (a POST *with* a body would still be refused) |
| `R2.path-allowlist-off` | path allowlist | R2.7 accepted | only the path arm was exercised |
| `R2.host-allowlist-off` | host allowlist | R2.9 accepted | probe deliberately uses an **allowlisted path** so the path guard cannot mask the host guard (the first draft was masked — fixed and re-run) |
| `R3.dedupe-off` | `key_seen` check | R3.2/R3.4 accepted; R3.3 wrongly suppressed | — |
| `R4.human-guard-off` | non-human identity deny-list | R4.2/R4.4 accepted | the no-`--by`/blank refusals are argparse-level and unaffected |
| `R4.execution-state-armed` | the frozen `NOT_EXECUTED` constant | R4.0/R4.0b **premise** assertions | caught at premise level, not by a per-control refusal — weaker evidence, stated as such |
| `R4.expiry-armed` | `NO_EXPIRY = None` | R4.0/R4.0b **premise** assertions | same limitation |

A ninth check was added after the first run: `R2.host-allowlist-off` **escaped detection** in run #2 (`[MUTANTS] total=8 detected=7 vacuous_count=1 names: R2.host-allowlist-off`) because the host probe used a non-allowlisted *path* as well, so the path guard refused first and masked the weakened host guard. The probe now uses an allowlisted path on a non-allowlisted host. This is recorded because it is the reason the mutant table above is trustworthy: the harness demonstrated it can be vacuous and that defect was repaired.

## 5. Isolation, no-egress, additive-only (all OBSERVED)

| Property | How it was established |
|---|---|
| No repository file written | All runs use a throwaway copy `C:/Users/cd-pr/AppData/Local/Temp/freecash-rule-gate/pkg` (`[PREPARE] copy-fidelity … identical=True` for all 10 modules) and throwaway state roots. `find monitoring -newermt "2026-09-20 21:45"` → **0 files**. `PYTHONDONTWRITEBYTECODE=1` for every child. |
| Production state untouched | Whole-tree digest before and after: `[ISOLATION] digest_before=d46409b4620bfb5a428faf5fff45b1acb04a058e19d474f7e3d24347fd6c652e`, `[ISOLATION] digest_after=d46409b4620bfb5a428faf5fff45b1acb04a058e19d474f7e3d24347fd6c652e identical=True`. `find data/freecash-monitor -newermt "2026-09-20 21:40"` → **0 files**. Day-lock sha256 `e3b0c442…7852b855` and `last-run.json` sha256 `5e25ae59…11b4caf` re-read after the run — unchanged from the value in the delegation brief. |
| No scheduled task registered | The harness never invokes `schtasks`; no Task A/B was created or queried. |
| No network egress | Every network-shaped control passes `transport=fake_transport`; `transport_calls_total=1` for the whole R2 section (the single allowlisted read). No host was contacted; the routine's own audit hook was never even needed. |
| No secret read | No credential, token or endpoint secret is read or printed; the only literal URL is `http://localhost:3001` / `http://api.freecash.example:3001` (RFC-reserved example host, never resolved). |
| Fail-closed on setup error | A mutation whose anchor is not found exactly once is reported `SETUP-FAILED` and counted **vacuous** (exit 2), rather than silently skipped. |

## 6. Carried evidence re-verified in this session

| Carried claim | Re-executed command | Observed result |
|---|---|---|
| suite `tests=52 failures=0 errors=0 skipped=0` | `cd D:/AgenticOS && python monitoring/freecash/tests/run_all.py` | `[CARRIED] run_all: tests=52 failures=0 errors=0 skipped=0` · `exit=0` |
| `verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0 PASS` | `python monitoring/freecash/verify_readonly.py` | `exit=0`, same counts (quoted at R2.0) |
| `verify-readonly.sh` → `forbidden=0 exempt=28 missing_targets=0 PASS` | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `exit=0`, same counts (quoted at R2.0) |
| a full suite run leaves the day-lock and ledger byte-identical | `sha256sum data/freecash-monitor/state/day-locks/2026-09-20.lock data/freecash-monitor/state/last-run.json` before and after the suite | `e3b0c442…7852b855` / `5e25ae59…11b4caf` — identical (CARRIED re-confirmed this session) |

## 7. Counts

| Metric | Value |
|---|---|
| Rules passing (all controls refused, no error) | **4 / 4** — R1(3), R2(9), R3(5), R4(7) |
| Injected violations | **24** — `REFUSED_OK`-class **24**, `ACCEPTED_VIOLATION` **0** |
| Weak mechanisms detected as harness FAIL | **8 / 8** |
| Rules that could **not** be proven | **none of the four** — but see §8: three properties *within* R2/R3/R4 remain UNVERIFIED, and R1's cross-host/clock properties are untested |
| Harness exit code of the run of record | **0** |

## 8. BLOCKED / not proven (named, not papered over)

| # | Item | Precise blocker |
|---|---|---|
| B1 | **Live read-only provider transport (R2, test T2.4)** | No credentials and no resolved provider read endpoint exist (`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`). Every transport control therefore used a patched in-process recorder: **no socket, no TLS, no provider semantics were observed**. R2 is proven as "no earning action exists in this source tree and the guard refuses what it is asked to refuse", **not** as "provider reads were observed to be read-only". |
| B2 | **Second same-day end-to-end run (R3 duplicate-notify)** | R1 makes the scenario unreachable: a same-day second run cannot get past the day lock, so the integration-level duplicate-notification path cannot be injected without first disabling R1 (which the mutation test does not do for R3). Exactly-once is proven at the `changedetect`/`notify` layer only. |
| B3 | **Concurrency on the lock (`R1.2`) beyond a single host** | Only 5 local processes on local NTFS were raced. Cross-host/shared-root behaviour is UNVERIFIED. |
| B4 | **Clock integrity (`R1`)** | No test of a backwards clock jump, NTP step, DST transition, or a `FREECASH_TZ` change *after* the lock exists; the harness injected a fixed clock and `TZ=UTC`. Production here runs degraded (`Europe/Berlin` unresolvable → system-local, `MONITOR_DEGRADED`), so the "operator-local calendar day" in production is the machine's zone, not the configured one. |
| B5 | **`notified-keys.json` concurrent writers (R3)** | No file lock in `record_notified_key`; a lost key would duplicate a notification. Not exercised. |
| B6 | **Task Scheduler registration and restart policy (checklist items 6/7)** | Out of scope for this delegation: the brief forbids registering any scheduled task, and `RULE-GATE-CHECKLIST.md` items 6–7 remain unchecked. Consequence: the routine's once-a-day guarantee is proven for any invocation, but *nothing* proves a scheduled task will actually invoke it once a day. |
| B7 | **`docx`-level provider payload shapes (R3 dollar fallback)** | Not exercised: only integer-cents payloads were fed through `changedetect.normalize_metrics`. |
| B8 | **Evidence of no earning action outside `monitoring/freecash/`** | The scanners were pointed at `monitoring/freecash` and at the injected violation file only. The legacy monitor, the adapter, other repositories and any future code are outside this gate's scope (and the legacy `.mjs` is dead code — §2.1). |
| B9 | **`docs/free-cash-monitor-routine/DELEGATION-2026-09-20/verify-freecash-rules-v2.mjs`** | A sibling delegation's artifact appeared in the same directory during this session. It is **not** in this delegation's prior-art list and was **not** audited here; this document makes no claim about it. |

## 9. Artifacts written by this delegation (additive only)

| Path | Bytes | Note |
|---|---|---|
| `D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-20-R2\rule-gate-harness.sh` | 54546 | the runnable gate (bash driver + embedded Python section checks; the helper is written into the temp root at run time) |
| `D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-09-20-R2\RULE-GATE-VERIFICATION.md` | 39874 | this document |

No existing file was modified, moved or deleted: `RULE-GATE-CHECKLIST.md` (mtime Sep 17 21:39), `verify-readonly.sh` (Sep 17 21:39), `monitoring/freecash/*` (all mtimes ≤ Sep 20 21:08), `server/scripts/verify-freecash-rules.mjs` (Sep 11 11:52) are untouched. No git commit, no staged change, no scheduled task. Temp artifacts are confined to `C:\Users\cd-pr\AppData\Local\Temp\freecash-rule-gate\` (throwaway copy + throwaway state roots; announced by the harness, removable with `--clean` or `rm -rf`). The transcript of the run of record was additionally copied to `C:\Users\cd-pr\AppData\Local\Temp\harness-final.txt` (outside the repository).

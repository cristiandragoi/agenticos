# DELEGATION BRIEF R3 — daily status monitoring routine, Free Cash Finance Automation
**Repository:** `D:\AgenticOS` · branch `hermes-rescue-20260908` · HEAD `8f7463a` · Windows 11 (de-DE locale), git-bash (MSYS), non-elevated
**Written:** 2026-10-01, 09:24–09:3x operator-local (`date` → `Do,  1. Okt 2026 09:23:50`, Europe/Berlin UTC+02:00)
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (3.11.9 — the system `py -3` is 3.14 and has no `tzdata`)
**Subject:** the daily status-monitoring routine for Free Cash Finance Automation — canonical package `D:/AgenticOS/monitoring/freecash/` (entry point `run_daily_check.py`).
**Evidence standard:** every row in §0 is a command executed in *this* pass. No PASS is quoted from an earlier document.
**Footprint:** this brief is new. The dispatched streams may only write under `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/<stream>/` and scratch roots under `%LOCALAPPDATA%\Temp`. No git write command, no scheduler registration, no provider network call, no credential, no write to `data/freecash-monitor/`.

---

## 1. The four operational rules (binding specification — read the numbering note first)

The operator's rules, in the operator's own order. Every artifact in this repo numbers them differently, so **always carry the title with the number**:

| Operator rule (this brief) | Title | Shipped `gate.py` docstring | `readonly_client.py` docstring | Delivered `verifier/rule_gate.py` |
|---|---|---|---|---|
| **R1** | no earning action is ever taken automatically | `R?` (not labelled) | `R2` | `RULE 1` ✅ agrees |
| **R2** | status is checked at most once per operator-local calendar day | `R1` | — | `RULE 2` ✅ agrees |
| **R3** | operator is notified when earnings or account status changes | `R3` | — | `RULE 3` ✅ agrees |
| **R4** | human approval before ANY external action; nothing auto-executes | `R4` | — | `RULE 4` ✅ agrees |

`gate.py:1` says *"R1: exactly one status read per day"* and `readonly_client.py:1` says *"R2: the routine's ONLY network path"* — i.e. the shipped code's internal labels are **inverted** relative to the operator list. R3 and R4 agree everywhere. Any report from a delegated stream must print rule **title + both numberings** on first use.

Enforcement intent, per rule, as it must hold in the delivered routine:

- **R1** — the only network transport is an interceptor with a deny-by-default allowlist (`ALLOWED_METHODS = {GET, HEAD}`, loopback hosts only, no request body, path allowlist). Verified live this pass: `readonly_client.py:39/41/115`; `verify_readonly.py` `forbidden=0 exempt=28 missing_targets=0`, exit 0.
- **R2** — atomic `O_CREAT|O_EXCL` day lock keyed on the Europe/Berlin calendar date (`gate.py:102`, `gate.py:128`), acquired before the read, duplicate-day branch performs no read. Verified live via the delivered gate's runtime layer (run #2 on day D: wire delta = 0).
- **R3** — prior snapshot loaded **before** the new one is written; exact-equality comparison (no threshold); content-hash dedupe key persisted **before** dispatch.
- **R4** — the routine may *enqueue* only; `execution_state` is hard-coded `NOT_EXECUTED`, `execution_allowed=False`, `expires_at_utc=None`; no execution site exists; a timeout cannot convert PENDING → EXECUTED.

---

## 0. Live state, verified in this pass (all commands executed 09:23–09:27 local)

| # | Command | Observed result | Verdict |
|---|---|---|---|
| B1 | `date`; `which python`; `python -V` | `Do,  1. Okt 2026 09:23:50`; `…/hermes-agent/venv/Scripts/python`; `Python 3.11.9` | clock + interpreter of record confirmed |
| B2 | `ls -la data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock` (08:53)** | **today's day key was spent at 08:53 by a run that read nothing — it is NOT free** |
| B3 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, **`consecutive_missed_days=0`**, `last_attempt_at_utc=2026-10-01T06:53:46Z` | a null read is booked as a **success day**, and the miss counter was reset 9 → 0 |
| B4 | `wc -l alerts/alerts.jsonl`; `tail -3` | **15 lines**; last = `event_type=MONITOR_DEGRADED`, `day_key=2026-10-01`, `ts_utc=2026-10-01T06:53:46Z` | the canonical evidence record gained today's line; no line carries a writer key |
| B5 | `python -c json.load(operator-state.json)['records']` | `records= 0` | **no operator reading has ever been entered** |
| B6 | `cat snapshots/` | `2026-09-20.json`, `2026-09-30.json`, `2026-10-01.json` — all 518 bytes, `data_available:false` | three null snapshots; nothing has ever been compared |
| B7 | `cat approvals/pending.json` | `No such file or directory` | the approval queue has never held an item |
| B8 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`, `VERDICT: NOT COMPLIANT -- 1/4`, exit **1** | the **shipped** acceptance gate is RED, on the file it targets |
| B9 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` | `error: unrecognized arguments: --package`, exit **2** | the shipped gate has **no package mode** — it is file-scoped by construction |
| B10 | `python …/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash` | `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS`, `VERDICT: COMPLIANT -- 4/4`, exit **0**; AST layer + executed runtime detectors (15/8/8/20 checks) | a working package-scope gate exists — **but see B11** |
| B11 | `python …/DELEGATION-2026-10-01/verifier/mutation_harness.py` (re-run live) | `mv1…mv5,adv1,adv2,adv5 DETECTED=YES` · **`adv3-r4-getattr-exec exit=0`**, **`adv4-r1-conditional-backdoor exit=0`** `DETECTED=NO`, `adv6-r1-new-socket-file exit=1 DETECTED=NO` | **3 of 10 mutants survive; two of them leave the gate printing 4/4 PASS and exit 0 on a live backdoor** |
| B12 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit **0** | R1 static scanner green at baseline **28** |
| B13 | `python monitoring/freecash/tests/run_all.py` (scratch root) | `run_all: tests=52 failures=0 errors=0 skipped=0` | offline suite GREEN this run |
| B14 | `grep -n SUCCESS_OUTCOMES -A 10 gate.py`; `grep -n covered watchdog.py` | `gate.py:32-40` contains `MONITOR_DEGRADED`; `gate.py:198` advances `last_success_day` for it; `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | **root cause of B3/B4 unchanged**: "the monitor ran" is still conflated with "a reading exists" |
| B15 | `grep -n NON_HUMAN_DECIDERS -A 3 approval_queue.py` | `frozenset({"system","routine","automation","agent","cron","scheduler","monitor","bot","script","machine"})`, checked at `:153` (`if who.lower() in NON_HUMAN_DECIDERS`) | R4 identity guard is a **denylist** — `hermes-agent`, `assistant`, `claude` are all currently accepted |
| B16 | `curl :4600/api/v1/status/metrics`; `curl :4600/api/health` | `404` · `{"status":"healthy","pid":32500,…,"gitSha":"8f7463aa","isDirty":true}` | the API answers (200) but **the metrics read route does not exist** |
| B17 | `ls -d data/freecash data/freecash-monitor server/data/freecash-monitor`; `hermes cron list` | all three roots exist; `No scheduled jobs.` | state-root ambiguity open; **nothing is scheduled** |
| B18 | `git status --porcelain scripts/monitoring/rule_gate_verify.py monitoring/` | `?? scripts/monitoring/rule_gate_verify.py`, `?? monitoring/` | the gate **and the whole package are untracked** — editing them adds no tracked-file modification (but they are not reviewable by diff either) |
| B19 | `sha256sum` production `last-run.json` / `alerts.jsonl` / `operator-state.json` | `a287a902…3bf9` / `1b9c7c07…99a8` / `be8becc3…a59c` | the pin this pass is hermetic against — **re-hash at hand-off: a footprint claim expires (V10 C27)** |

**One-line status:** the routine runs, refuses duplicates and writes a real evidence trail; this morning it spent the production day on a null read, booked it as a success, reset its own miss counter 9 → 0 and silenced its own watchdog; the shipped acceptance gate is red, the working gate passes three mutants (two live), nothing is scheduled, no reading has ever been entered.

---

## 2. Delegation topology — four streams, dispatched in parallel

All four run against the **same working tree** (`D:\AgenticOS`, 800+ pre-existing uncommitted paths). Isolation rules, identical for every stream:

1. Write **only** under `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/<your-stream>/`. Never edit a tracked file. Never edit `monitoring/freecash/**`, `scripts/monitoring/rule_gate_verify.py`, or anything under `data/freecash-monitor/`.
2. Every routine invocation uses a **throwaway** state root: `export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-r3-<stream>-<pid>/root"` **and** pin `AGENT_TEAMS_DB_PATH` away from the live DB if anything reads it. Two independent roots exist for a reason; the production root is not a scratch dir.
3. No `git add/commit/stash/reset/restore/checkout/clean`. No `schtasks /Create`. No non-loopback socket. No credential. No secret in any artifact (`[REDACTED]`).
4. Quote the **command, its exit code and its raw output** for every claim. A stream that cannot show the command did not run it.
5. Use the 3.11.9 interpreter explicitly: `"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"` (3.14 has no `tzdata` → `ZoneInfo("Europe/Berlin")` unresolvable → `MONITOR_DEGRADED`).
6. Propose, do not apply: code changes land as diffs + a runnable repro under your own directory. The operator applies nothing without a decision.

| Stream | Question it must answer | Acceptance bar (the failing-something proof) |
|---|---|---|
| **G — gate** (`DELEGATION-2026-10-01-R3/gate/`) | Can one gate, reachable from the repo root, be **package-scoped and mutant-closed**? | A copy of the mutation harness pointed at your gate shows **10/10 caught** — including `adv3-r4-getattr-exec`, `adv4-r1-conditional-backdoor`, `adv6-r1-new-socket-file` — and your gate still exits **0** on the unmutated package. A gate that passes its own target proves nothing: run `ast.parse` on everything you certify. |
| **D — day budget** (`…-R3/daybudget/`) | Can a data-less run be made to **not** consume the day and **not** advance success? | A **failing test written first** on the current package; then a diff under your dir that makes it pass, proven with: data-less run → `day-locks/` empty, `last_success_day` unchanged, `consecutive_missed_days` preserved, watchdog prints `WATCHDOG_MISSED_DAY`; reading-present run → one lock, one snapshot, `SKIP_DUPLICATE_DAY` on the second run. |
| **S — read source** (`…-R3/source/`) | Which status source is actually reachable **today**, with no provider credential, and what is the day-1 first action per source? | Live `curl`/code evidence per candidate (metrics route `:4600` → expect 404; provider read contract; payout balance; authenticated app bridge). Ranked table; the operator-entered path must be shown to produce `RUN_OK … outcome=INITIAL_BASELINE` in a scratch root. |
| **I — R4 identity** (`…-R3/identity/`) | Can "only a human may decide" be made true rather than "some words are refused"? | Denylist → **allowlist** (`state/human-deciders.json`, operator-editable) proven **both directions in one test**: `hermes-agent` **refused**, an operator name **accepted** — and the safety property stated separately (frozen `execution_state=NOT_EXECUTED`, `expires_at_utc=None` survive even a bad decider). |

### Research questions carried into every stream (not decoration — each one is a claim the routine currently cannot make)

- RQ1: what is the *authoritative* state root? Three exist (`data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor`) — which is written by which code path?
- RQ2: what makes `data_available` true, per source, and is that predicate checkable without the operator typing a number?
- RQ3: which alert sink actually delivers on this host (toast only; no `SMTP_*` / `WEBHOOK_*` in env)?
- RQ4: how is "one read per day" bounded when a reading does not exist — is the day consumed by the *attempt* or by the *read*, and which semantics is the operator choosing?
- RQ5: is there any path by which the routine could take an earning action; if the answer is "the allowlist", is the allowlist proven to be the only transport?

---

## 3. Stages — Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

Ordering: `G ∥ D ∥ S ∥ I → operator decisions → apply (human) → schedule (human) → first real reading`. One change per gate run.

**G — one package-scope, mutant-closed acceptance gate. Blocking.**
Expected Effort: 3–5 h. **Time-to-Revenue: none** — this buys the verdict, not cash.
Dependencies: `DELEGATION-2026-10-01/verifier/mutation_harness.py` (present, GATE path hardcoded, no CLI — copy and repoint), `DELEGATION-2026-09-30/verifier/rule_gate.py` (the working detector set, sha `fca9b4a6…`).
First Concrete Action: copy `rule_gate_verify.py` and add `--package <dir>` (today argparse is `target [--run] [--json] [--json-out]`, B9 exit 2), port the four detectors, then run the repointed harness and name every `caught=NO` row as an open defect, not a footnote.

**D — an honest day budget (a spent day is spent; "ran" ≠ "read").**
Expected Effort: ~40 min (accounting only) / 3–5 h (two-phase lock) / +1 h (wrapper pre-flight). **Time-to-Revenue: none.**
Dependencies: none; do it **before** any further unattended run.
First Concrete Action: write the failing test — *a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog report `WATCHDOG_MISSED_DAY`* — then key coverage on `data_available`, not on process completion (`gate.py:32-40`, `:198`; `watchdog.py:33`).

**S — a read source that produces a real number.**
Expected Effort: 0.5 h operator (operator-entered) / 4–8 h (authenticated app bridge) / 3–5 h (a metrics route that does not exist). **Time-to-Revenue: same-day visibility only — the routine produces visibility, never cash.**
Dependencies: D (else the first data-less run burns the next day), a free day key, the pinned interpreter.
First Concrete Action: in a scratch root, drive the operator-entered source on a free day key and quote the `RUN_OK … outcome=INITIAL_BASELINE` line; in parallel, `curl :4600/api/v1/status/metrics` and record the 404 as the reason the loopback-metrics option is not currently a source.

**I — human approval, proven by identity rather than by word list.**
Expected Effort: 1–3 h. **Time-to-Revenue: none** — pure rule-R4 safety.
Dependencies: none (`approvals/` has never held an item, B7).
First Concrete Action: replace `NON_HUMAN_DECIDERS` (`approval_queue.py:55`, checked `:153`) with an allowlist read from `state/human-deciders.json`, and prove both directions in one run.

**Operator decisions this brief asks for (no agent may take them):**
D-1 gate remedy · D-2 day-budget remedy · D-3 accept or remediate the 2026-10-01 spent day · D-4 authoritative read source · D-5 when/where the app is started · D-6 label the three legacy monitors (`server/scripts/verify-freecash-rules.mjs` reports `4/4 passed` on a file that fails `node --check`) · D-7 state-root disposition · D-8 revenue path.

---

## 4. Blocked register

| Item | Blocked on | Reason (verified this pass) |
|---|---|---|
| Acceptance gate green | stream G | shipped gate `R1=FAIL`, exit 1, no `--package` (B8/B9); delivered gate green but 3/10 mutants survive, two live (B11) |
| Any reading for 2026-10-01 | operator decision D-3 + lock removal | the key was spent at 08:53 on a null read (B2–B4) |
| Unattended scheduling | D-1 + D-2 + a parsing payload | nothing is scheduled today (B17) and the DECISION-V2 XML payloads do not parse |
| Trustworthy "monitor is alive" signal | D-2 | `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` → watchdog reports covered on a null snapshot (B14) |
| Live account status | app running **with a human session** | `provider_credentials = 0`; the metrics route 404s (B16) |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured; toast is the only sink |
| Any earning/withdrawal action | R4 (by design) | must never run unattended; no execution path exists — but the decider guard is a denylist (B15) |
| Strong R4 identity provenance | stream I | denylist at `approval_queue.py:55` accepts `hermes-agent` |
| Revenue | D-8 | the monitor is a visibility instrument (C20); verified revenue stands at €19 from 2026-08-19 |

---

## 5. Definition of done for the delegated set

1. One gate reachable from the repo root, package-scoped, exiting 0 on the unmutated package **and** non-zero for every one of the 10 mutants in the harness.
2. A data-less run leaves no day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, and is reported `WATCHDOG_MISSED_DAY` — with the failing test that proves the change.
3. `tests=52 failures=0 errors=0` and both R1 scanners green at a pinned `exempt` baseline.
4. One scratch-root reading with `data_available:true`; a changed figure yields exactly one notification and one approval item.
5. `hermes-agent` refused and an operator name accepted as a decider; every decided item still `NOT_EXECUTED` with `expires_at_utc=None`.
6. Every claim traceable to a command + exit code executed in the claiming session; no PASS quoted from an earlier document.
7. No credential anywhere; no tracked file modified; no write to `data/freecash-monitor/` — re-hash B19's three files at hand-off (a footprint claim expires).

## 6. Non-goals

No rewrite, move or deletion of any legacy monitor — label and disable, never delete. No live financial write path in any option. No compliance claim from a static grep or a stale artifact. No touching the 800+ pre-existing uncommitted paths. No voice/Jarvis runtime path. **The routine produces visibility, not revenue.**

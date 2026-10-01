# DELEGATION BRIEF — R4 — Daily Status Monitoring Routine, Free Cash Finance Automation

Repository: D:\AgenticOS
Date: 2026-10-01 (Europe/Berlin, UTC+02:00)
Parent pass: DELEGATION-2026-10-01-R3 (09:33) — newest prior pass; V1–V11B plan corpus also present.
Scope: produce a WORKFLOW PLAN and a RESEARCH PLAN for a daily status monitoring routine
that observes Free Cash account state read-only and obeys the operator's four rules.

This brief is deliberately hostile. Every stream below inherits ~30 documented prior
defects. A stream that reports COMPLIANT without a failing-something proof has
reproduced the defect under a new name.

---

## 0. RULE NUMBERING — READ THIS FIRST, IT IS INVERTED SOMEWHERE IN THE CODE

The operator numbering (authoritative for this brief, and the one the four rules below
use) is:

| # | Rule title | Meaning |
|---|---|---|
| R1 | NO EARNING ACTION | the routine never performs an earning/withdraw/claim transaction |
| R2 | ONCE PER DAY | exactly one status read per calendar day, operator-local |
| R3 | NOTIFY ON CHANGE | tell the operator when earnings or account status changes |
| R4 | APPROVAL BEFORE EXTERNAL ACTION | nothing external is executed without explicit human approval |

The SHIPPED CODE docstrings are INVERTED for R1/R2:
- `monitoring/freecash/gate.py:1` says `R1: exactly one status read per day` (= operator R2)
- `monitoring/freecash/readonly_client.py:1` says `R2: the routine's ONLY network path` (= operator R1)
R3 and R4 agree everywhere.

CONSEQUENCE: every stream MUST print the rule TITLE alongside the numbering in any
header, table or verdict it writes. Never emit a bare `R1`/`R2` without its title.
A reader who takes "R2 = zero earning actions" from this brief and then reads the
code's `R2` will mis-map the rule.

---

## 1. VERIFIED GROUND TRUTH (measured this pass, not inherited)

All facts below were produced by live tool execution on 2026-10-01 between 11:35 and
11:40 local. Treat inherited claims in the V1–V11B corpus as UNVERIFIED until re-run.

### 1.1 Canonical entry point — parses, does not yet produce data
- `monitoring/freecash/` = 10 modules + `tests/` (6 test files, 52 tests) + `verify_readonly.py`.
- `py -3.11 -m py_compile` over all 8 core modules: exit 0. The canonical package PARSES.
- Full suite run: `FREECASH_DATA_ROOT=<throwaway> <venv-python> monitoring/freecash/tests/run_all.py`
  → `tests=52 failures=0 errors=0 skipped=0`, exit 0. Reproduced this pass.

### 1.2 Interpreter — tzdata is the deciding factor
- System `py -3.11` (C:\Users\cd-pr\AppData\Local\Programs\Python\Python311) → NO tzdata.
  `ZoneInfo("Europe/Berlin")` raises `ZoneInfoNotFoundError`.
- System `py -3.14` (default) → NO tzdata. Same failure.
- ONLY interpreter with tzdata:
  `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`
  → `3.11.9 tzdata OK Europe/Berlin`. VERIFIED.
- `gate.resolve_tz()` fails open to `system-local` and reports kind `"system-local"`;
  `timezone_report()["available"]` is False in that case. A scheduler pointed at the
  wrong interpreter silently loses the operator-local day key. Pin the venv python.

### 1.3 Production state root — ZERO real readings have EVER been taken
`data/freecash-monitor/` contains exactly 12 files:
```
state/last-run.json          state/operator-state.json     state/notified-keys.json
state/day-locks/2026-09-20.lock  ...09-30.lock  ...10-01.lock
snapshots/2026-09-20.json  snapshots/2026-09-30.json  snapshots/2026-10-01.json
alerts/alerts.jsonl        logs/task-a.log  logs/task-b-watchdog.log
approvals/  -- EMPTY, no pending approval was ever raised
```
- All THREE snapshots are `degraded: true`, `data_available: false`, and every figure
  (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`,
  `currency`) is `null`. `raw_response_sha256` is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  = sha256 of the EMPTY STRING, on all three.
- `state/operator-state.json` `records: []` — the human-entered source has NEVER been
  filled in. Its `note` states the routine "only reads this file; it never contacts the
  platform and never takes an action."
- `state/last-run.json`: `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`,
  `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `timezone=Europe/Berlin`.
  NOTE: a DEGRADED run is booked as `last_success_day`. Coverage read from `last_outcome`
  therefore lies; read the snapshot's `data_available` instead.
- `alerts/alerts.jsonl` = 15 JSONL rows: `MISSED_DAY` x10, `MONITOR_DEGRADED` x3,
  `SKIP_DUPLICATE_DAY` x2. By day: 2026-09-20 x2, 2026-09-21 x1, 2026-09-30 x11, 2026-10-01 x1.

BOTTOM LINE: the routine has run, written locks and snapshots, and emitted alerts —
but it has never carried a single real figure, so R3 (notify on change) has NEVER had
an input and has never fired a change notification in production.

### 1.4 TODAY'S DAY IS ALREADY SPENT
`state/day-locks/2026-10-01.lock` exists (created 08:53 local / 06:53Z). In
`run_daily_check.py` the day key is resolved and the lock acquired (`:308-309`) BEFORE
the source is read (`:372`). The lock for today means ZERO readings remain for
2026-10-01. The only remedy is a human deleting the lock, which falsifies the day
record — append a corrective note to `alerts/alerts.jsonl` instead of rewriting it, and
say plainly that the day was spent by a run that read nothing.

### 1.5 Read-only enforcement — real, but scoped to nothing provider-facing
`readonly_client.py`: method allowlist GET/HEAD only; path allowlist of compiled
regexes; HOST ALLOWLIST IS LOOPBACK ONLY. Its own comment states "no provider read path
is" allowlisted and "nothing provider-facing is allowlisted". An `sys.addaudithook`
aborts any `connect`/`getaddrinfo` to a non-allowlisted host.
So R1's read-only claim is ENFORCED IN CODE, and simultaneously the routine CANNOT
reach any real provider even if credentials existed. The metric source is
`operator_state` (a human-entered JSON file) with `metrics_http` as the only alternative.
This is the single largest gap between "the routine complies" and "the routine monitors".

### 1.6 Nothing is scheduled
`schtasks /query /fo LIST` shows NO FreeCash task. Only Microsoft Office monitor tasks
match. `config/freecash-crontab` is a commented TEMPLATE pointing at
`scripts/make_freecash_check.py` (a known non-functional stub) via a fictional
`/path/to/AgenticOS`. Prior passes produced XML
(`DELEGATION-2026-10-01/scheduler/DECISION-V2-FreeCash-Daily-Monitor.xml`) but it was
never registered. Treat any inherited "scheduled"/"registered" row as UNVERIFIED.

### 1.7 No reviewable diff — the whole implementation is untracked
`git status --porcelain` → `?? monitoring/` and `?? scripts/monitoring/`. Neither is
tracked. In-place edits to either produce NO reviewable diff. HEAD is
`8f7463a feat(antigravity): route live Jarvis delegation commands to AntiGravity worker`.

### 1.8 Known-unrunnable neighbours (do not resurrect, do not cite)
- `server/scripts/freecash-daily-monitor.mjs` — fails `node --check` at line 41 (TS
  annotation in `.mjs`). Never executed.
- `server/scripts/verify-freecash-rules.mjs` — exits 0 printing `4/4 PASSED` while
  certifying that unparseable file; two of its four assertions are tautologies.
- `scripts/monitoring/free-cash-daily-check.py` — defines `main()`, never calls it:
  exit 0, no output. `scripts/make_freecash_check.py` — `parents[2]` off-by-one, prints
  an Errno 2 then "No actions available." with exit 0.
- `finance-monitor/src/rule_engine.py` — f-string SyntaxError.

### 1.9 Approval identity guard is a bypassable denylist
`approval_queue.py` denies ten literal words (`agent, automation, bot, cron, machine,
monitor, routine, scheduler, script, system`). `hermes-agent`, `assistant`, `claude`,
`the monitor` are each ACCEPTED. A prior decision was recorded as
`decided_by='hermes-agent'`. The frozen fields (`execution_state=NOT_EXECUTED`,
`expires_at_utc=None`) mean an approval still cannot arm an action — but "only a human
can sign" is FALSE. State the two properties separately.

---

## 2. ISOLATION CONTRACT — MANDATORY FOR EVERY STREAM

Breach of any clause voids the stream's output.

1. WRITE ONLY under your own stream directory
   `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/<your-stream>/`.
   NEVER write, move, delete, chmod or `touch` anything under `monitoring/freecash/**`,
   `scripts/monitoring/**`, `data/freecash-monitor/**`, `config/**` or `finance-monitor/**`.
   If you must exercise the routine, COPY it into your stream dir first and run the copy.
2. Export a THROWAWAY `FREECASH_DATA_ROOT` for EVERY execution and set
   `AGENT_TEAMS_DB_PATH` and `AGENTICOS_DATA_DIR` to throwaway paths too.
3. PROVE isolation by hash, not intention. Record, in this order, into
   `<your-stream>/raw/`:
   - `01-isolation-before.txt` — `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl`
   - your runs
   - `99-isolation-after.txt` — the SAME sha256sum command
   The two digests must be byte-identical. Also append the output of
   `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` and account for
   every line (the four pre-existing 06:53Z baseline files are expected).
   Baseline digests measured this pass:
   - `last-run.json`   = `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9`
   - `alerts.jsonl`    = `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8`
4. INTERPRETER: use `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`
   for anything touching `zoneinfo`. System 3.11 and 3.14 lack tzdata.
5. Paste RAW tool output into `raw/*.txt`. A summary is not evidence.

## 3. ACCEPTANCE BAR — FAILING-SOMETHING PROOF

Every gate or verifier a stream produces MUST be shown to FAIL on a planted violation,
in the same file as the passing run. Required shape, both lines in one evidence file:

```
RED   : verifier exits <non-zero> on <named planted violation>  <raw output>
GREEN : verifier exits 0 on the unmodified artifact              <raw output>
```
A verifier whose only evidence is exit 0 is rejected. Specifically:
- `node --check` / `python -m py_compile` the exact artifact the gate certifies.
- Name every surviving mutant as an OPEN DEFECT, never as a footnote.
- Do not edit an untracked gate in place and call the result verified.

---

## 4. STREAMS

Five parallel streams. Each writes ONLY in its own dir. Each returns: artifact paths,
the RED/GREEN evidence lines, the two isolation digests, and an explicit list of what it
could NOT establish.

### S1 `workflow/` — the daily routine workflow plan
Deliver `<stream>/WORKFLOW-PLAN.md` + `raw/`.
Must specify, concretely and runnably:
- The day-budget problem: lock-before-read means a data-less run burns the day
  (`:308-309` before `:372`; 2026-09-30 is the production proof). Propose a pre-flight
  wrapper that REFUSES to invoke the entry point when today's source record is absent,
  so the lock is only acquired on a day that will actually carry a reading. Show the
  wrapper refusing on a data-less day and proceeding on a data-carrying day.
- All four rules with TITLES + numbering, each mapped to the code that enforces it, with
  a file:line citation, and an honest column "enforced in code / only asserted in docs".
- The alerting path (R3): what a change notification looks like, dedupe key, and the
  fact that it has never fired because `records: []`.
- The approval path (R4): queue format, the denylist bypass (§1.9), and the proposed
  operator-editable allowlist `state/human-deciders.json`. Prove BOTH directions in ONE
  run: `hermes-agent` REFUSED, the operator name ACCEPTED. State the frozen-field
  property separately from the attribution property.
- A status report format for the operator: what changed, or "no reading today".

### S2 `research/` — the research plan (datasource reality)
Deliver `<stream>/RESEARCH-PLAN.md` + `raw/`.
- Answer the decisive question: what READ-ONLY source can actually supply
  `account_status, earnings_total_cents, balance_cents, pending_cents` daily, given
  `readonly_client.py` allowlists LOOPBACK ONLY? Options: (a) operator-entered file
  (wired today, empty), (b) a loopback metrics bridge that the operator's own browser
  session writes, (c) a documented provider read API added to the allowlist.
  For each: Expected Effort, Time-to-Revenue, Dependencies, First Concrete Action.
- For any provider API claim, cite a live-fetched source. Do NOT invent endpoint
  schemas. If a provider is unreachable or undocumented, report BLOCKED and say so.
- Inventory the V1–V11B corpus: for each plan file, one line — still-valid / stale /
  superseded-by-what. Flag contradictions between the two rule numberings.
- Note that the routine's authority is observational only: it cannot and must not earn.

### S3 `verifier/` — the rule gate
Deliver `<stream>/rule_gate.py` + `mutation_harness.py` + `raw/`.
- The gate takes a file path and asserts the four rules by TITLE, exiting non-zero on
  violation with a specific message naming the rule title and the offending line.
- The mutation harness plants N >= 10 concrete violations into copies of the routine:
  e.g. a `POST /cashout`, an `os.system(...)`, a second read in the same day, a
  `save_snapshot()` before `load_snapshot()`, a missing notification, an auto-executed
  approval, a bypassable decider string, an unresolvable tz name.
- REQUIRED evidence: the harness catches ALL planted mutants, and the gate exits 0 on
  the unmodified copy. If any mutant survives, report the count as an OPEN DEFECT and
  do NOT print a COMPLIANT verdict. A `VERDICT: COMPLIANT` line describing detector
  coverage rather than the target is the failure mode this stream exists to prevent.
- First: prove the gate parses and that `monitoring/freecash/` modules still parse.

### S4 `source/` — read-only enforcement audit + bridge proposal
Deliver `<stream>/READONLY-AUDIT.md` + `raw/`.
- Enumerate `readonly_client.py`'s allowlists verbatim (methods, path regexes, hosts)
  and classify what is reachable TODAY (expect: loopback only, nothing provider-facing).
- Prove enforcement empirically: attempt a non-allowlisted method, a non-allowlisted
  host, and a request body — capture the exact raised error for each. Then prove a
  loopback GET succeeds.
- Design (do not install) the minimal read-only bridge that lets the routine observe a
  real figure while keeping zero write capability. State the threat model and what a
  compromised bridge could still do.
- Report the largest gap honestly: read-only enforcement is real, monitoring is not.

### S5 `scheduler/` — the missing registration
Deliver `<stream>/SCHEDULER-DECISION.md` + validated task XML + `raw/`.
- Confirm by live command that NO FreeCash task exists (`schtasks /query /fo LIST`).
- Produce a task XML that PARSES:
  `python -c "import xml.etree.ElementTree as ET; ET.parse('<file>')"` — and re-run that
  parse in the SAME call that hands the payload over. A raw `&` inside `<Arguments>`
  (`2>&1`) has broken this exact step before; escape it.
- Pin the executable to the tzdata-capable venv python from §1.2, NOT `python3`/`py`.
- The task must be OBSERVE-ONLY: it may run the entry point and nothing else. No write
  verbs, no approval execution, no earning path.
- DO NOT REGISTER THE TASK. Produce the decision doc + the parsing XML and stop. An
  external action requires the operator's approval (rule R4).
- Include `schtasks /XML`-shape validation notes and the blast radius if it mis-fires.

---

## 5. WHAT THE PARENT WILL DO WITH THIS

The parent will re-verify every returned artifact itself (children's summaries are
self-reports, not facts): re-parse the gate, re-run the harness, re-run the isolation
hash check, re-parse the XML, and re-hash the production root. Any stream whose
isolation digests do not match, or whose gate is only ever seen exiting 0, is reported
to the operator as FAILED regardless of what the stream claimed.

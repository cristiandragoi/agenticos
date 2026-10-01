# Free Cash Daily-Monitor — Runtime Evidence Audit

Audit date: 2026-09-19 · Host: Windows 11, git-bash (MSYS), node v24.20.0
Scope: every existing "Free Cash" daily-monitor implementation under `D:\AgenticOS`.
Method: each component was *executed*; raw output captured. READ-ONLY on the repo —
no source file was edited, moved or deleted. Byte-identical copies under
`$LOCALAPPDATA/Temp/` were used for mutation testing.

Evidence classes used below:
- **verified by execution** — a command was run and its real output is quoted.
- **read from source** — the file was read; not executed.
- **unknown** — not determinable from what was run.

---

## 1. Component inventory

| path | lang | lines | parses? | executes? | artifacts created | classification |
|---|---|---|---|---|---|---|
| `server/scripts/freecash-daily-monitor.mjs` | JS/TS mix | 326 | **NO** (SyntaxError L41) | **NO** (exit 1) | none | **broken** |
| `server/scripts/verify-freecash-rules.mjs` | JS | 80 | yes | yes, exit 0 | none | **broken verifier** (blind/tautological) |
| `scripts/make_freecash_check.py` | Python | 98 | yes | yes, **exit 1** | none | **broken** (path off-by-one) |
| `scripts/monitoring/free-cash-daily-check.py` | Python | 293 | yes | no entry point → exit 0, no output | none | **dead-code** (no `__main__`) |
| `server/tasks/daily-finance-monitor.py` | Python | 330 | yes | yes, exit 0 | `last_run_time.json` (new), `daily_monitor.log` (appended) | **partial** (runs; 0 accounts, DB table missing) |
| `monitoring/freecash/run_daily_check.py` | Python | ~480 | yes | **yes, exit 0**, day-lock enforced | lock+snapshot+ledger+state+alerts | **working** (canonical candidate) |
| `server/src/adapters/freecashMonitorAdapter.ts` | TS | 223 | not compiled here | lib-only; `fetchStatus()` hardcoded | none | **stub + dead-code** (not registered) |
| `scripts/create-free-cash-fina.mjs` | JS | 42 | unknown | **not run** (DB write) | n/a | out-of-scope (write path, not a monitor) |
| `server/dist/adapters/freecashMonitorAdapter.js` (build copy) | JS | — | yes (`node --check` exit 0) | identical to source | none | build duplicate |
| `release/win-unpacked/resources/server/scripts/*.mjs` (build copy) | JS | — | byte-identical to source (`diff` exit 0) | same breakage | none | build duplicate |
| `server/src/__tests__/truthfulDelegationAndFreeCash.test.ts` | TS | 106 | — | — | — | **name-misleading** (tests operationalEvidence/backgroundTasks, NOT the adapter) |

Notes on inventory:
- `monitoring/freecash/` is **untracked by git** (`git ls-files monitoring/freecash` → empty). It exists only on disk.
- `server/tasks/` is likewise untracked.

---

## 2. Verifier integrity — `server/scripts/verify-freecash-rules.mjs`

### 2a. Exact assertion lines (read from source)

```
18|  return !content.includes('/transactions') &&
19|         !content.includes('/cashout') &&
20|         /read-only/.test(content);                    // Rule 1  (reads ../src/adapters/freecashMonitorAdapter.ts)

26|  return !!content.includes('isDailyCheckAllowed') &&
27|         /toDateString/.test(content) &&
28|         content.includes('lastCheck.date !== today'); // Rule 2

34|  return !content.includes('checkForChanges') ||
35|         content.includes('.log(');                     // Rule 3  — '||' ⇒ true unless BOTH sides false

41|  return !content.includes('requiresApproval') &&
42|         content.includes('prepareActionRequests') ||
43|         content.includes('approval-request.json');     // Rule 4  — precedence: (A && B) || C
```

Static observations (read from source):
- **Rule 3 is near-tautological**: it is satisfied whenever the string `checkForChanges`
  is absent (true here) *or* `.log(` is present.
- **Rule 4** is satisfied by any file containing `approval-request.json`, which this repo's
  monitor contains in its `config` block — the `requiresApproval`/`prepareActionRequests`
  conjuncts are never reached.
- **Rules 1, 2, 4 are string-presence checks, not behavioural checks.** None of them executes
  or traces anything.

### 2b. Mutation test (verified by execution)

Byte-identical copies of the verifier + the adapter + the monitor were placed under
`$LOCALAPPDATA/Temp/freecash-mutation/pkg/{scripts,src/adapters}`. The repo originals were
never touched.

| scenario | what was done to the COPY | verifier verdict | exit |
|---|---|---|---|
| Baseline | unmodified copy | `4/4 passed` | 0 |
| **Mutation A2** | appended a real earning action to the **adapter**: `fetch("https://api.freecash.com/v1/withdraw", {method:"POST"})` while keeping the string `read-only` | **`4/4 passed`** | 0 |
| Mutation A | same idea in the monitor copy | `4/4 passed` | 0 |
| Mutation B | stripped day-lock strings (`isDailyCheckAllowed`, `toDateString`, `lastCheck.date !== today`) | `Rule 2 → FAILED`; `[WARN] Some rules not fully met` | **0** |

**Conclusions (verified):**
1. **The verifier is blind to a real earning action.** A POST to `/v1/withdraw` in the adapter
   still yields `4/4 passed` — Rule 1 only greps for the two literals `/transactions` and
   `/cashout`, so any earning endpoint spelled otherwise is invisible.
2. **The verifier's exit code is always 0**, including in Mutation B where a rule is reported
   `FAILED`. It contains no `process.exit(nonzero)`. A CI step keyed on its exit status can
   never go red. This exactly matches the earlier observation that it reports `4/4 passed`
   while the monitor it audits does not even parse.
3. Rule 2 is *not* a pure tautology (Mutation B flips it) — but it is a text-presence test:
   it passes on the monitor whose day-lock never runs, because the file merely *contains*
   the three required substrings.

---

## 3. Wiring — is the adapter live or dead?

Commands and real output:

```
$ grep -in "freecash\|free.cash" server/src/services/runtimeRegistry.ts
(no output; grep exit 1)                       # → no freecash reference in the registry

$ grep -n "Adapter\|register" server/src/index.ts | grep -i adapter
52:import { HermesAdapter } from './adapters/hermesAdapter.js';
53:import { JarvisAdapter } from './adapters/jarvisAdapter.js';
54:import { VideoAdapter } from './adapters/videoAdapter.js';
137:import { HeavyGenAdapter } from './adapters/heavyGenAdapter.js';
138:import { CodexAdapter } from './adapters/codexAdapter.js';
141:runtimeRegistry.register(new HermesAdapter());
142:runtimeRegistry.register(new JarvisAdapter());
143:runtimeRegistry.register(new CodexAdapter());
144:runtimeRegistry.register(new VideoAdapter());
145:runtimeRegistry.register(new HeavyGenAdapter());

$ grep -rn "freecash\|FreeCash" server/dist/index.js
(no output)                                    # → not present in the built server entry either
```

Registered adapters: Hermes, Jarvis, Codex, Video, HeavyGen. **`freeCashMonitorAdapter` is not
among them.** The only references to it are two `import` + two `fetchStatus()` call sites:

```
server/src/domains/jarvisNext/operator/operatorController.ts:115:  const connStatus = await freeCashMonitorAdapter.fetchStatus();
server/src/domains/jarvisV2/turnController.ts:414:          const status = await freeCashMonitorAdapter.fetchStatus();
```

`fetchStatus()` (source, lines 198–209) returns a **hardcoded object**:

```
externalConnected: false,
earnedToday: 0,
statusAlerts: [],
adapterHealth: 'healthy',
externalStatusMessage: 'Local monitor adapter is operational in read-only sandbox mode. ...'
```

**Verdict:** the adapter is **not on any provider-call path / not in the runtime registry**;
it is reachable only through two controller methods (unknown whether those branches fire at
runtime — not exercised here). It performs **no real read** — it always reports healthy with
zero data. Classification: **stub that is effectively dead code for monitoring purposes.**
`evaluateRules()` (lines 211–219) only ever `return`s; it takes no action.

---

## 4. Duplication map

Four independent "daily check" designs exist, plus two build copies:

| design | day-lock | real read | approval queue | actually runs? |
|---|---|---|---|---|
| A. `server/scripts/freecash-daily-monitor.mjs` (+ verifier) | code present, never executes | intended (`api.freecash.com/v1/status`) | writes `approval-request.json` | **no — does not parse** |
| B. `scripts/make_freecash_check.py` | intended | intended | prints "No actions available" | no — path off-by-one, exit 1 |
| C. `scripts/monitoring/free-cash-daily-check.py` | present in `main()` | `fetch_metrics()` | `prepare_approval_request()` | **no — no `__main__` guard** |
| D. `server/tasks/daily-finance-monitor.py` | `last_run_time.json` | DB query (`events_logs` table missing) | `prompt_for_approval()` | **yes, in SIMULATE mode** |
| E. `monitoring/freecash/` package (run_daily_check + gate/notify/approval_queue/changedetect/watchdog) + tests | **real atomic day-lock, verified** | operator-state or allowlisted HTTP | **real approval queue, no execution path** | **yes** |

- A, B, C, D, E are five overlapping implementations of the same four rules.
- **Canonical candidate: E (`monitoring/freecash/run_daily_check.py`)** — the only one observed
  to enforce "one read per calendar day" at runtime (2nd same-day run → `SKIP_DUPLICATE_DAY`)
  and to refuse the second-read flag (`--force-recheck` → exit 3).
- Caveat: E's own test suite is **17 of 52 not passing** (`tests=52 failures=6 errors=11`,
  `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined`, plus static-checker failures).
  E is functional for its main path but its regression gate is red.
- A + its verifier are the pair the earlier audits relied on; §2 shows the verifier cannot
  justify any claim about A.

---

## 5. Exact commands + raw output

### 5.1 `freecash-daily-monitor.mjs` — does not parse
```
$ node server/scripts/freecash-daily-monitor.mjs
file:///D:/AgenticOS/server/scripts/freecash-daily-monitor.mjs:41
function isDailyCheckAllowed(): boolean {
                              ^
SyntaxError: Unexpected token ':'
    at compileSourceTextModule (node:internal/modules/esm/utils:319:16)
Node.js v24.20.0
$ echo $?
1
```
Cause (source): a TypeScript annotation in a `.mjs`, and `require()`/`module.exports` in an ESM
file (lines 14–17, 42/66). Two layered defects.

### 5.2 `verify-freecash-rules.mjs` — always 4/4, always exit 0
```
$ node server/scripts/verify-freecash-rules.mjs
[FREECASH RULE VERIFIER] Starting checks...
[CHECK] Rule 1: No auto-earning actions...   Result: PASSED
[CHECK] Rule 2: Once per day check...        Result: PASSED
[CHECK] Rule 3: Notify on earnings/status... Result: PASSED
[CHECK] Rule 4: Human approval...            Result: PASSED
✓ Rule 1 (No auto earnings)     → PASSED
✓ Rule 2 (Once daily check)      → PASSED
✓ Rule 3 (Notify changes)        → PASSED
✓ Rule 4 (Human approval queue)  → PASSED
[OK] All 4 operational rules verified (4/4 passed)
$ echo $?
0
```
Mutation A2 (adapter copy given a real `POST /v1/withdraw`):
```
$ node verify-freecash-rules.mjs
   Result: PASSED   (x4)
[OK] All 4 operational rules verified (4/4 passed)
$ echo $?    → 0
```
Mutation B (day-lock strings stripped from the copy):
```
   Result: PASSED
   Result: FAILED
   Result: PASSED
   Result: PASSED
✗ Rule 2     → FAILED
[WARN] Some rules not fully met. Review code implementation.
$ echo $?    → 0        # still zero
```

### 5.3 `make_freecash_check.py` — path off-by-one, exit 1
```
$ python scripts/make_freecash_check.py
Error: [Errno 2] No such file or directory: 'D:\\data\\freecash\\state.json'
No actions available.
$ echo $?
1
$ ls -la /d/data/freecash
ls: cannot access '/d/data/freecash': No such file or directory
```
Source: `BASE = Path(__file__).resolve().parents[2]` (line 8) resolves a script at
`D:/AgenticOS/scripts/…` to `D:\`, so `DATA_DIR = D:\data\freecash` instead of
`D:/AgenticOS/data/freecash`. (Correction to prior ground truth: this script exits **1**, not 0.)

### 5.4 `free-cash-daily-check.py` — no entry point
```
$ python scripts/monitoring/free-cash-daily-check.py
$ echo $?
0
$ grep -c "__main__" scripts/monitoring/free-cash-daily-check.py
0
```
`def main()` exists (line 225) but is never called. Zero output, zero artifacts.

### 5.5 `daily-finance-monitor.py` — runs, but nothing to report
```
$ python server/tasks/daily-finance-monitor.py
[2026-09-19 21:51:18] Daily Finance Status Monitor starting
===...
[2026-09-19 21:51:18] Database connected to D:\AgenticOS\server\tasks\..\database.sqlite
[2026-09-19 21:51:18] Checked 0 account(s): []
Earnings query failed (READ-ONLY check): no such table: events_logs
[2026-09-19 21:51:18] Found 0 recent earnings event(s) for review
✓ Daily check complete; no external actions triggered
[2026-09-19 21:51:18] Daily routine finished (checks=0, approve_needed=False)
$ echo $?
0
```
Has a `__main__` guard (line 329) and is in SIMULATE mode. Artifacts written:
`server/tasks/last_run_time.json` (newly created, content `1789847478.493505`) and an append to
the pre-existing `server/tasks/daily_monitor.log`. **No earning action occurred.**

### 5.6 `monitoring/freecash/run_daily_check.py` — the only working one
```
$ FREECASH_DATA_ROOT=$TEMP/freecash-audit-run1 python run_daily_check.py
RUN_OK 2026-09-19 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)
  snapshot=2026-09-19.json written=True changes=0 notifications=0 approvals=0 reminders=0
  lock=2026-09-19.lock
$ echo $?    → 0

$ python run_daily_check.py          # same day, second run
SKIP_DUPLICATE_DAY 2026-09-19
$ echo $?    → 0                      # Rule 2 enforced — verified
```
Other modes:
```
$ python run_daily_check.py --version
freecash-monitor 1.0.0                                              (exit 0)

$ python run_daily_check.py --force-recheck --reason "audit test"
REFUSED_FORCE_RECHECK 2026-09-19 reason='audit test' (a second status read in one day is
forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)
$ echo $?    → 3

$ python run_daily_check.py --print-state
ledger: .../state/last-run.json
  consecutive_missed_days  0
  timezone                 Europe/Berlin
pending items: 0                                                     (exit 0)

$ python watchdog.py
WATCHDOG_MISSED_DAY 2026-09-19 last_attempt_day=None last_outcome=None coverage=NOTIFIED
$ echo $?    → 0
```
Its own static checker **fails on its own tree**:
```
$ python verify_readonly.py
  FORBIDDEN [earning-action] .../approval_queue.py:111: action.setdefault("action_type", ACTION_LABEL_REQUEST_PAYOUT)
  FORBIDDEN [write-call-shape] .../tests/test_r4_approval.py:283: self.assertNotIn("http.client", text, name)
[verify_readonly] FAIL - R2 violation: an earning/write action path exists in a read-only routine.
[verify_readonly] forbidden=2 exempt=27 missing_targets=0
$ echo $?    → 1
```
Its own test suite is red:
```
$ python tests/run_all.py
run_all: tests=52 failures=6 errors=11 skipped=0
$ echo $?    → 1
```

### 5.7 Default (production) data root — artifacts created in the repo
```
$ python monitoring/freecash/run_daily_check.py      # FREECASH_DATA_ROOT unset
RUN_OK 2026-09-19 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)
  snapshot=2026-09-19.json written=True ... lock=2026-09-19.lock
$ echo $?    → 0
$ find data/freecash-monitor -type f
data/freecash-monitor/alerts/alerts.jsonl
data/freecash-monitor/snapshots/2026-09-19.json
data/freecash-monitor/state/day-locks/2026-09-19.lock
data/freecash-monitor/state/last-run.json
data/freecash-monitor/state/operator-state.json
```
`data/freecash-monitor/` did **not** exist before this audit (`ls` → "No such file or directory").
It is untracked (`git status` → `?? data/freecash-monitor/`). Nothing was deleted afterwards.

---

## 6. Files created / touched by this audit (nothing deleted)

Created (untracked, left in place):
- `data/freecash-monitor/{alerts/alerts.jsonl, snapshots/2026-09-19.json, state/day-locks/2026-09-19.lock, state/last-run.json, state/operator-state.json}` — by `run_daily_check.py` on the default root.
- `server/tasks/last_run_time.json` — by `daily-finance-monitor.py`.
- `docs/freecash-monitor-audit-evidence.md` — this report.
- `$LOCALAPPDATA/Temp/freecash-mutation/**`, `…/freecash-audit-run1`, `…/freecash-audit-run2`, `…/freecash-tests.txt` — scratch, outside the repo.

Appended to (pre-existing, not rewritten):
- `server/tasks/daily_monitor.log` — one run appended its lines.

No repo source file was modified, moved or deleted. No git commit, checkout or reset was run.
No provider API was contacted; no credential was used; no earning/transaction action was executed.

---

## 7. Explicitly unverified / unknown

- The **telemetry** branch at `turnController.ts:414` and `operatorController.ts:115` was not
  exercised; whether those code paths fire in a live turn is **unknown**. Only the static
  call sites were observed.
- `scripts/create-free-cash-fina.mjs` was **not executed** (it performs a DB `INSERT` — a write
  side effect, out of scope for a monitor audit). Its parse status is **unknown**; it is
  classified from source reading as a one-off write script, not a daily monitor.
- Full TypeScript compilation of `freecashMonitorAdapter.ts` was **not** run (no `tsc`/build
  invoked). Only the pre-built `server/dist` copy was syntax-checked with `node --check` (exit 0).
- The 6 failures / 11 errors in `monitoring/freecash/tests` were summarised from the run; the
  distinct root causes beyond the recurring `NameError: ACTION_LABEL_REQUEST_PAYOUT` were not
  individually triaged.
- Design docs (`docs/freecash-monitoring.md`, `daily-status-monitoring-specification.md`,
  `resources/daily-monitoring-spec.md`, `server/tasks/README_daily-monitor.md`,
  `config/freecash-crontab`) were **not** audited for accuracy against runtime behaviour in this
  report — `config/freecash-crontab` was read only to the extent that it contains a commented-out
  example cron line pointing at `scripts/make_freecash_check.py` (the script that exits 1).

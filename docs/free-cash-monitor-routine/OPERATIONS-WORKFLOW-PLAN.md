# OPERATIONS-WORKFLOW-PLAN.md — Free Cash Finance Automation, the daily status-monitoring routine

**Repository:** `D:/AgenticOS` (every path in this file is relative to it)
**Branch / HEAD:** `hermes-rescue-20260908` @ `d14253d` (2026-09-08). `monitoring/` and `docs/free-cash-monitor-routine/` are **untracked** (`git status --porcelain` → `?? monitoring/`, `?? docs/free-cash-monitor-routine/`); 40+ other tracked files are modified and uncommitted. An edit to an untracked file cannot be recovered by git.
**Host:** Windows 11, git-bash, non-elevated. `python` = 3.11.9 (Hermes venv, has `tzdata`); `py -3` = 3.14.7 (no `Europe/Berlin`).
**Written:** 2026-09-20 06:56 local, by the orchestrator, from commands executed in this pass only.
**Reads alongside, supersedes nothing:** `DELEGATION-DISPATCH-2026-09-20.md` (its §2 workstreams W1–W6 are the live backlog), `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` (2026-09-19), `ROUTINE-DESIGN.md`, `IMPLEMENTATION-PLAN-V3.md`, `AUDIT-RULE-COMPLIANCE.md`, `RULE-GATE-CHECKLIST.md`, `verify-readonly.sh`.
**Acceptance gate:** `scripts/monitoring/rule_gate_verify.py` (pre-existing). This plan extends it (workstream W4) and does not author a sibling verifier.

---

## 0. What this plan is, and what it is not

It is the **operating workflow**: the ordered, gated sequence of work that takes the Free Cash Finance monitor from "built but red" to "scheduled, audit-able, allowlisted read-only observation with a human gate", together with the four options for how far to take it.

It is not a redesign. It adds no rule, no entity, no endpoint, no verb. Every phase below already has a design document; the phases exist to make the existing design *verifiable* and *scheduled*.

---

## 1. Constraints register (hard, non-negotiable)

| ID | Constraint | Enforced by / measured with |
|----|-----------|------------------------------|
| C1 | **R1** — exactly one status read per operator-local calendar day | atomic `O_CREAT\|O_EXCL` day lock; second run prints `SKIP_DUPLICATE_DAY` and does no read, no snapshot, no ledger write |
| C2 | **R2** — zero automated earning / write actions | deny-by-default transport: `ALLOWED_METHODS` = GET/HEAD, `ALLOWED_PATHS` allowlist, `ForbiddenWriteError` otherwise; assert the tree contains no write/claim/withdraw/cashout path |
| C3 | **R3** — notify on earnings / status change, exactly once per distinct change | integer-cent snapshot diff + pre-dispatch dedupe key recorded before dispatch |
| C4 | **R4** — human approval before any external action | approval queue frozen at `execution_state = NOT_EXECUTED`, `expires_at_utc = null`; the routine contains no execution path at all |
| C5 | No secret in the repository; secrets resolve at runtime only; never print them | `[REDACTED]` in every artifact |
| C6 | Additive edits only; temp backup of every file before editing it (untracked tree); never `git add/commit/stash/reset/restore` | `git status` before and after each edit |
| C7 | Evidence standard: a rule is satisfied only if (a) the violating action is unreachable in code, (b) a command shows the mechanism denying it, (c) the checker is shown to **fail** on an injected violation | gate + `verify-readonly.sh` + mutation probes |
| C8 | Off-limits: voice runtime, Jarvis runtime, `src/hooks/useVoiceIO.ts`, `server/src/routers/voice.ts`, `src/components/jarvis/JarvisComposer.tsx`, `src/domains/jarvis/*` | touch nothing in those paths |
| C9 | No provider call, no scheduler change, no message send, no login, no purchase without a recorded human decision | operator approval per `approvals/` |
| C10 | Interpreter pinning is mandatory when the routine is scheduled | use the 3.11.9 venv `python.exe`; `py -3` cannot resolve `Europe/Berlin` |
| C11 | Never widen an allowlist, never let a timeout/watchdog/retry move a `PENDING` item to executed, never swallow an exception so a failed run exits 0, never delete a test to make a count green | review of each diff against this list |

---

## 2. Verified state on 2026-09-20 (commands executed in this pass)

| # | Command | Observed | Reading |
|---|---------|----------|---------|
| S1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=6 errors=11 skipped=0`, exit 1 | Suite **red**. 11 errors share one root cause: `NameError: ACTION_LABEL_REQUEST_PAYOUT` at `approval_queue.py:111` (the constant exists as `ACTION_LABEL_FOR_HUMAN_REVIEW`, `:52`). That single defect breaks the whole change → enqueue path (R3/R4). |
| S2 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=2 exempt=27 missing_targets=0` → `FAIL — R2 violation`, exit 1 | Two unexempted hits: `approval_queue.py:111` (`earning-action` class — the same `NameError` line) and `tests/test_r4_approval.py:283` (`write-call-shape`, inside an `assertNotIn("http.client", …)`). |
| S3 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` → `VERDICT: NOT COMPLIANT — 1/4 rule(s) violated: R1` | R1 FAIL is a **verifier scope defect**: the atomic lock and the calendar-day key live in `gate.py`, and the verifier is single-file scoped. Behavioural R1 works (S4). |
| S4 | (suite smoke output, temp data root) | `RUN_OK … lock=2026-09-20.lock`, then `SKIP_DUPLICATE_DAY 2026-09-20`; `MONITOR_DEGRADED`; `WATCHDOG_MISSED_DAY … coverage=NOTIFIED` | R1/R3/R5 mechanisms fire in a temp root. |
| S5 | `schtasks /Query /FO LIST \| grep -iE "freecash\|daily-monitor\|missed-day"` | no match | **Not scheduled. Not operating.** |
| S6 | `python` Hermes-cron job list | `count: 0`, `jobs: []` | No Hermes cron entry either; and Hermes cron cannot wake a sleeping machine. |
| S7 | `py -3 -c "ZoneInfo('Europe/Berlin')"` vs `python -c …` | `py -3` → `ZoneInfoNotFoundError`; venv `python` → OK | Interpreter pinning decides whether the day key is the configured zone. |
| S8 | `ls -la data/freecash/` · `ls data/freecash-monitor/` | first empty, second does not exist | No production state root: no lock, snapshot, alert or approval has ever been written outside a temp dir. |
| S9 | `git status --porcelain monitoring/ docs/free-cash-monitor-routine/` | `?? monitoring/` · `?? docs/free-cash-monitor-routine/` | Temp backup before any edit is mandatory (C6). |

**One-line status:** the four rules are enforced by code and have been observed firing in a throwaway data root; the suite and the read-only checker are red, the acceptance gate exits 1, and no scheduled run has ever produced a production day lock. The routine is **built, not verified, not deployed**.

---

## 3. Operating workflow (target steady state)

### 3.1 Gate sequence (strict order; each gate is an executed command, not a claim)

```
W1-FIX  clear the single-defect cascade + both R2 hits
   G1b  run_all.py exit 0 AND verify-readonly.sh → forbidden=0 exit 0   [blocks everything downstream]
W3      adversarial verification, negative controls per rule
   G3   per rule: clean case + ≥1 detected injected violation, or an explicit false-negative finding
W4      extend rule_gate_verify.py: --package <dir>, whole-tree staging, per-rule module attribution;
        close gap D1 (token scan drops decisive hits) and D2 (delivery check accepts a print stub)
   G4   gate exits 0 for the routine as a package AND still FAILs on a planted violation of each rule
G5      human decision on scheduler registration (R4)
W5      register Task A daily + Task B watchdog
   G5b  schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST shows both, interpreter pinned,
        FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash, MultipleInstances IgnoreNew, RestartCount 0
W6      30-day unattended-operability review (day coverage, MISSED_DAY count, DELIVERY_FAILED count, degraded:true trend)
W2      provider / ToS research — parallel, gates only the "is the real account actually observed?" question
```

### 3.2 The daily run itself (order is the contract)

1. **R1 gate** — atomic exclusive-create of `<data_root>/locks/<day>.lock` on the operator-local day key. Already-consumed day → `SKIP_DUPLICATE_DAY`, exactly one alert-log line, exit 0, no read, no snapshot, no ledger write.
2. **Attempt ledger** — record the attempt; emit in-band `MISSED_DAY` lines for uncovered days (never back-filled); a timezone change is `MONITOR_DEGRADED`, not a silent success.
3. **R2 read** — one read-only acquisition: operator-entered state file (default) or the local metrics substitute through `readonly_client.request` (GET/HEAD, allowlisted paths only).
4. **R3 compare** — prior snapshot is loaded *before* the new snapshot is written; one line per distinct change; at most one notification per change via a dedupe key recorded before dispatch; `OK_NO_CHANGE` is log-only; >5 changes coalesce into one summary.
5. **R4 enqueue** — one approval item per notified change, `NOT_EXECUTED`, `expires_at_utc=null`. Enqueueing is a notification with a handle; **nothing in the routine acts on an approved status**. There is no execution code path.
6. **No automatic re-run.** `--force-recheck` is accepted only to be refused (exit 3) and the refusal is written to `logs/forced-recheck-requests.jsonl`. A failed read (exit 5) leaves the day lock in place deliberately.

### 3.3 Failure paths the operator is told about

`SKIP_DUPLICATE_DAY` (benign) · `MISSED_DAY` (machine asleep / task skipped) · `MONITOR_DEGRADED` (no data, timezone unresolved, or provider read failed) · `DELIVERY_FAILED` (channel refused; message kept in full, bounded retries, no timer decides anything) · exit 5 (status read failed, lock stays, no auto re-run).

---

## 4. Options

Each option is assessed against C1–C11. "Time-to-Revenue" is measured honestly: this routine is a **read-only observer**, so revenue appears only when a real account read is bound and the operator acts on a detected change.

### Option A — Harden the existing routine to green (recommended, and the precondition for everything else)

**Effort:** ~0.5–1 engineer-day. One `NameError` clears 11 suite errors; remaining 6 failures are four distinct causes: R1 concurrency (`test_five_concurrent_runs_yield_one_winner`), day-key timezone, the two static-checker hits, and watchdog severity (`'notify' != 'alert'`) plus `state["covered"] == False`.
**Time-to-Revenue:** none directly — it is the gate that makes B or C credible. Indirect: without it, no snapshot the operator acts on can be trusted.
**Dependencies:** temp backup of `monitoring/freecash/*.py` (C6); no provider access; no scheduler change; no human decision beyond authorising the edit.
**First Concrete Action:** copy `monitoring/freecash/approval_queue.py` to `%LOCALAPPDATA%\Temp`, then make the one-token fix at `:111` (`ACTION_LABEL_REQUEST_PAYOUT` → the constant that exists, `ACTION_LABEL_FOR_HUMAN_REVIEW`), then re-run `python monitoring/freecash/tests/run_all.py` and paste the new count.

### Option B — Bind the real provider read contract (the only path that makes "no change" meaningful)

**Effort:** 3–5 days of research + integration, contingent on a legal/ToS decision that is not the agent's to make.
**Time-to-Revenue:** unquantifiable today, and the reason is documented: `PROVIDER-FINDINGS-REVERIFIED.md` records that freecash.com's ToS forbids automated access "for any purpose, including monitoring"; `https://api.freecash.com/v1/status` returns 404; HG.Cash is the only documented read-only API and account ownership is operator-held and unknown. Every snapshot is therefore `degraded: true` and a "no change" report currently proves nothing about the real account. First measurable signal = the first `degraded: false` snapshot.
**Dependencies:** operator decision on ToS/account ownership; a verified read endpoint (never invented — unresolved stays literally `PROVIDER_ENDPOINT_UNKNOWN`); C9 (no login, no provider call without a recorded human decision).
**First Concrete Action:** **BLOCKED** pending that operator decision. The agent-side first action is to re-run the W2 evidence pass and produce the decision packet (five fields per candidate source: URL, scope, read-only provability, ToS sentence, ownership requirement).

### Option C — Operate on operator-entered state only (works today, zero provider dependency)

**Effort:** ~2 hours of mechanical work: pick the data root, pin the interpreter, register the two tasks for operator review.
**Time-to-Revenue:** immediate — same-day real change notifications, because the figures are the operator's own. Value is bounded by how often the operator enters figures, and every run is honestly labelled `source=operator_entered`.
**Dependencies:** Option A's green gate for the notification path; C10 interpreter pinning; C4 human approval for Task Scheduler registration; state root fixed via `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash` (the module honours it; the `paths.py:35` default `data/freecash-monitor` must be aligned as follow-up work).
**First Concrete Action:** after G1b, run one end-to-end day in a temp root with the configured interpreter and show `RUN_OK … source=operator_entered(data_available=True)`, then hand the operator the exact `schtasks /Create` command for approval.

### Option D — Consolidate the parallel implementations (stop the sprawl, delete nothing)

**Effort:** 2–4 hours of inventory + a deprecation index. **Deletion is not an available action** — the tree is untracked, so a deleted file is unrecoverable (C6).
**Time-to-Revenue:** none. It prevents a future false-compliance claim, which is its own risk control: `docs/freecash-monitoring.md` step 06 POSTs `/withdraw` and `/survey/complete<id>`; `server/scripts/freecash-daily-monitor.mjs` does not even parse (`SyntaxError` at line 41); `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py` and `finance-monitor/` all score R1–R4 FAIL against the gate; `finance-monitor/.delivery_status.json` claims an "Audit-Ready Prototype" that no executed check supports.
**Dependencies:** none; read-only.
**First Concrete Action:** write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` — one row per candidate (path, gate verdict with the exact command, one-line status), prominently naming `monitoring/freecash/` as the single implementation to consolidate on and marking the rest `DEPRECATED — do not cite as compliant`.

---

## 5. Acceptance commands (the whole gate, in order)

```bash
cd D:/AgenticOS
python monitoring/freecash/tests/run_all.py                       # G1b: expect failures=0 errors=0, exit 0
bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash   # G1b: expect forbidden=0, exit 0
python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py   # G4: expect R1..R4 PASS after W4
schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST          # G5b: two tasks, pinned interpreter, data root
ls -la data/freecash/{locks,snapshots,logs,approvals}             # first production run evidence
```

## 6. Blocked / not claimed

- **Provider read contract — BLOCKED** (ToS + unknown endpoint + account ownership). Not resolvable with the tools in this session.
- **Task Scheduler registration — BLOCKED pending human approval** (C4/C9). The agent must not register an unattended task.
- **`pytest` — absent on this host.** The suite is a stdlib `unittest` runner; any document citing `pytest … 16 passed` is citing an unobserved result.
- **`py -3` timezone — BLOCKED** without installing `tzdata`; use the pinned venv interpreter instead.
- **Physical toast visibility — UNVERIFIED** (needs a human to observe a balloon).

## 7. Inherited non-negotiables

No external action of any kind without an explicit human decision recorded in `approvals/`. No credential in the repository. No invented provider endpoint. Never add a write/claim/withdraw/cashout/complete verb or path; never widen an allowlist. Never let a timeout, watchdog, cron entry or scheduler retry move a `PENDING` item to executed. Never swallow an exception so a failed run exits 0. Never delete a test to make a count green. Never `git add/commit/stash/reset`. Additive edits only, temp backup of every edited file. Touch nothing in the voice/Jarvis runtime paths.

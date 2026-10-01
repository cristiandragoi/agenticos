# DELEGATION DISPATCH R2 — Free Cash Finance Automation daily status-monitoring routine

**Repository (workspace):** `D:/AgenticOS`
**Routine under design:** `D:/AgenticOS/monitoring/freecash/` (canonical implementation)
**Delegation id:** `deleg_254504e3` — 3 parallel subagents, dispatched 2026-09-20 ~21:35 local (Europe/Berlin)
**Predecessor round:** `deleg_462be34a` + `docs/free-cash-monitor-routine/DELEGATION-DISPATCH-2026-09-20.md`
**This file is additive.** No existing file was modified, moved or deleted; no git operation was performed.

---

## 0. The four operational rules — enforced in mechanism, not convention

| Rule (operator's words) | Mechanism that makes violation unreachable | File |
|---|---|---|
| **R1** Check the status once a day | atomic `O_CREAT\|O_EXCL` day lock keyed on the operator-local calendar day; a second same-day run prints `SKIP_DUPLICATE_DAY` and performs no read | `monitoring/freecash/gate.py`, `run_daily_check.py` |
| **R2** No earning action automatically | deny-by-default transport: GET/HEAD only, path allowlist, `ForbiddenWriteError` otherwise; no claim/withdraw/cashout/redeem/payout/transfer path exists in the tree | `monitoring/freecash/readonly_client.py` |
| **R3** Notify on earnings / account-status change | exact integer-cent snapshot diff + dedupe key written *before* dispatch (one distinct change → one notification; no change → log only, no dispatch) | `monitoring/freecash/changedetect.py`, `notify.py` |
| **R4** Human approval before any external action | approval queue with `execution_state = NOT_EXECUTED` and `expires_at_utc = null`; the routine contains **no execution path at all** — it can only enqueue | `monitoring/freecash/approval_queue.py` |

No auto-approve. No timeout-decides. No retry that consumes a second status read. No scheduled task registered.

---

## 1. Live state re-verified by the orchestrator this pass (commands executed, output observed)

| # | Command | Observed 2026-09-20 ~21:35 | Reading |
|---|---|---|---|
| V1 | `python monitoring/freecash/tests/run_all.py` | `Ran 52 tests` · `OK` · `run_all: tests=52 failures=0 errors=0 skipped=0` · exit 0 | suite **GREEN** (was 6 failures / 11 errors on the morning pass) |
| V2 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=0 exempt=28 missing_targets=0` · `PASS — no unexempted write/earning token found.` · exit 0 | R2 static gate **GREEN** |
| V3 | `python verify_readonly.py` (from `monitoring/freecash`) | `forbidden=0 exempt=28 missing_targets=0` · `PASS` · exit 0 | python port **agrees with the shell checker** |
| V4 | `schtasks //query //fo LIST \| grep -icE 'freecash\|finance\|daily-monitor'` | `0` | **never scheduled — the routine has never run on a timer** |
| V5 | `data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-09-20`, `last_outcome=MONITOR_DEGRADED`, `timezone=Europe/Berlin` | exactly one manual run, degraded |
| V6 | `data/freecash-monitor/state/operator-state.json` | `"records": []` | **no operator reading has ever been entered** → R3/R4 never exercised on real input |
| V7 | `data/freecash-monitor/alerts/alerts.jsonl` | 2 lines for 2026-09-20: `MONITOR_DEGRADED` (info), `SKIP_DUPLICATE_DAY` (info) | the lock and the notify sink demonstrably write |
| V8 | `find data/freecash-monitor -type f` | 1 day lock, 1 snapshot, 2 alerts, 2 state files; `approvals/` and `logs/` empty | nothing has ever been approved or executed |
| V9 | `data/freecash` (canonical name in earlier plans) | empty directory | state root in use is the `paths.py` default `data/freecash-monitor` — divergence still open (Q6) |
| V10 | `docs/.../DELEGATION-2026-09-20/scratch/daily_monitor.log` | `Running in SIMULATE mode` … `Daily routine finished (checks=0, approve_needed=False)` | a parallel legacy runner (`dfm-copy.py`) is a **stub**: it checks nothing and approves nothing. Not the routine; do not mistake it for evidence. |

**Honest one-line status:** the four rules are structurally enforced and the routine's own gate is now green, but it is **unscheduled, unconfigured, and has never observed a real account** — R3 and R4 have never fired on operator input. Built, not verified on live input, not deployed.

---

## 2. This round's delegation — three parallel workstreams (all background, evidence-only)

| ID | Subagent | Deliverable (new file) | Acceptance gate |
|---|---|---|---|
| **D-A** adversarial rule verification | `sa-0-8b2a1a7d` | `docs/free-cash-monitor-routine/verification-report-adversarial-2026-09-20.md` | per rule: mechanism file:line + executed denial + an **injected violation proving the checker FAILS** + verdict COMPLIANT/PARTIAL/FAIL |
| **D-B** provider / sink / scheduler research | `sa-1-dfcb0ac6` | `docs/free-cash-monitor-routine/PROVIDER-DECISION-PACKET-2026-09-20-v2.md` | every claim VERIFIED-with-URL or COULD NOT VERIFY; O1–O5 rows carry Effort / Time-to-Revenue / Dependencies / First Concrete Action / Blocker / verdict; no credential, no provider login |
| **D-C** operator-facing workflow design | `sa-2-043ae00f` | `docs/free-cash-monitor-routine/OPERATIONS-WORKFLOW-PLAN-2026-09-20.md` | re-runs the gate itself and quotes output; daily procedure, R3 notification contract, R4 approval surface, missed-day escalation, 30-day metrics, scheduling as **proposal only**, blocked register |

Shared constraints handed to every child: no external action of any kind (no provider call, no message send, **no scheduled-task registration**, no login), no credential anywhere, no git operations at all, additive only (each may create exactly one new file), all mutation confined to `$LOCALAPPDATA/Temp`, and every claim backed by a command executed in its own session — no claim inherited from an earlier plan or PASS report.

---

## 3. Workflow plan (design-level, per stage: Effort / Time-to-Revenue / Dependencies / First Concrete Action)

Time-to-Revenue here means *visibility that the account is intact and earning*. This routine can never create earnings.

| Stage | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **S1 fix the gate to green** | 2–4 h | none (unblocks all) | none | **DONE this pass** — suite exit 0, both R2 checkers exit 0 (V1–V3) |
| **S2 make the suite the acceptance gate, not a document** | 2–3 h | none | S1 | replace the non-existent `pytest … 16 passed` pre-flight row with `python monitoring/freecash/tests/run_all.py`; fill every row from live output only |
| **S3 choose + configure the read source** | S3a 1–2 h · S3b 6–10 h · S3c unknown | S3a same day · S3b indirect · S3c unknown | S1 · S3b needs the server running · S3c needs provider identity + credential | S3a: create the state root, enter ONE operator record, run the entry point, confirm one snapshot + one log line. S3c stays **BLOCKED** |
| **S4 scheduling (R1 on a real clock)** | 2–3 h | none | S1–S3, **operator written approval (R4)** | paste the two `schtasks /Create` commands for the operator to run himself; then trigger manually and confirm one run + one `SKIP_DUPLICATE_DAY` |
| **S5 watchdog / missed-day** | 1–2 h | none | S4 | healthy day → `WATCHDOG_OK`, zero alarms; uncovered day → exactly one `MISSED_DAY` alarm, ledger unchanged |
| **S6 notification delivery (R3 sink)** | 2–4 h, or blocked externally | none | S4 | one seeded-change day, quote the single emitted payload; external sinks stay credential-gated |
| **S7 approval surface (R4)** | 3–5 h | none | S3, S6 | exercise the CLI decision path against one enqueued item; confirm the decision lands in `approvals/decided.jsonl` and `execution_state` stays `NOT_EXECUTED`; prove a tokenless write raises and opens no socket |
| **S8 reconcile state root + pin interpreter** | 1–2 h | none | S1–S7 | freeze ONE canonical data root (`data/freecash-monitor`, where state already exists) and pin the 3.11 venv interpreter absolute path in the task definitions — the `py -3` launcher cannot resolve `Europe/Berlin` and dies before the day lock |

Critical path: S2 → S3a → (human approval) → S4 → S5 → S6 → S7 → S8. S3c (a real provider account) stays off the critical path and BLOCKED.

---

## 4. Research plan — questions that must be answered before this is called operational

| ID | Question | Method | Owner | What "answered" looks like |
|---|---|---|---|---|
| Q1 | Which read source is authorised: O1 local metrics, O2 HG.Cash `/accounts`, O3 Cashfree `getBalance`, O4 operator-entered file, O5 scripted browser? | D-B | sa-1-dfcb0ac6 | decision packet, five required fields per option, incl. the ToS clause + URL behind the rejected option |
| Q2 | Does the provider's ToS / robots.txt forbid monitoring-style automated access? | D-B (fetch + verbatim quote) | sa-1-dfcb0ac6 | quoted clause + fetched URL, or COULD NOT VERIFY |
| Q3 | Do the O2/O3 read-only balance endpoints exist as documented? | D-B | sa-1-dfcb0ac6 | official doc URL + path + method + scope, or the literal `PROVIDER_ENDPOINT_UNKNOWN` stays |
| Q4 | Which notification sink actually works on THIS host today? | D-B + operator | sa-1-dfcb0ac6 / operator | installed tooling + env-var NAMES (never values); the JSONL alert sink is the only one already observed writing (V7) |
| Q5 | Is `StartWhenAvailable` catch-up real for a plain daily trigger, and does registration need elevation? | D-B | sa-1-dfcb0ac6 | Microsoft documentation URL + wording; catch-up treated as unproven until then, the day lock + watchdog carry the missed-day case |
| Q6 | One canonical state root: `data/freecash-monitor` (has live state) or `data/freecash` (empty, named in older plans)? | D-B + D-C | sa-1-dfcb0ac6 | one root documented in the task definitions; the env var must not be the only thing holding it together |

---

## 5. Blocked register — what no agent may unblock, and why

| Blocked item | Blocked on | Who unblocks | Reason (verified) |
|---|---|---|---|
| Registering the daily / watchdog scheduled tasks | **R4 — human approval** | operator, in writing | no agent may register a scheduled task for this routine (V4: none exists today) |
| Any real earning, claim or withdrawal action | R4 approval surface + human decision | operator | the routine contains no execution path; that is the design, not a gap |
| `degraded: true` → `false` snapshots | Q1/Q2/Q3 — an authorised read source | operator (decision) + builder | no credential configured, no provider contract resolved |
| External notification sink (email/webhook) | SMTP/webhook credentials or mail tooling | operator | no `SMTP_*`/`WEBHOOK_*` configured; `himalaya` absent |
| Elevated task registration (`/RL HIGHEST`) | elevated shell | operator | host is non-elevated by policy; the plan uses the non-elevated form |

**Do not report this routine as compliant or operational until:** a production day lock exists from a *scheduled* run, at least one operator reading has been entered, one change has produced exactly one notification, one approval item has been decided by a human, and the acceptance gate passes as a whole package with a demonstrated failing negative control.

---

## 6. What this dispatch does not claim

- No provider endpoint, URL, credential, price or revenue figure appears here — none was verifiable in this pass.
- No compliance verdict is asserted from the subagents' work until their artifacts are read back and their quoted commands are checked against the tree.
- The scheduling proposal is a **proposal**; the operator's explicit approval is the only thing that can turn it into a registered task.

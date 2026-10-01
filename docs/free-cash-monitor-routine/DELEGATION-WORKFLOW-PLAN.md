# DELEGATION-WORKFLOW-PLAN.md — Hermes execution workflow for the Free Cash daily status-monitoring routine

**Project:** Free Cash Finance Automation — daily status monitoring
**Workspace (repository):** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `d14253d`
**Delegator:** Hermes orchestrator (this session) · **Executors:** Hermes subagents (isolated contexts)
**Date:** 2026-09-18 · **Status:** delegation package issued; W1/W2 dispatched, W3 gated on W1, W5 blocked on human approval.

---

## 0. The contract this workflow is judged against

| ID | Rule (operator's wording) | Operational definition used here | Structural enforcement (fail-closed) |
|---|---|---|---|
| **R1** | once-per-day check | exactly one *status read* per operator-local calendar day; duplicate/concurrent/second invocation performs no I/O and cannot notify | `os.open(lock, O_CREAT\|O_EXCL)` on `state/day-locks/<YYYY-MM-DD>.lock` — single atomic syscall; the ledger is for audit only and is never the gate |
| **R2** | zero automated earning actions | no request that mutates remote account state is reachable from the routine; `GET`/`HEAD` to allowlisted paths only | deny-by-default transport (`ALLOWED_METHODS`, `ALLOWED_PATHS`, body rejection) + static CI grep that **fails the build** on forbidden verbs/paths |
| **R3** | notify on earnings/status change | exact-change detection vs prior day snapshot; at most one notification per distinct change | `dedupe_key` index written **before** dispatch; `OK_NO_CHANGE` is log-only, never notified |
| **R4** | human approval before any external action | the routine contains **no execution path at all**; pending items wait forever and never auto-convert | `execution_state` frozen at the literal `NOT_EXECUTED`; `expires_at_utc` always `null`; decision CLI requires `--by <human>` |

**"Strictly adhering" is defined operationally:** a rule counts as enforced only when (a) a mechanism makes the violation unreachable by the code as written, **and** (b) a test has been *executed* whose observed output shows the mechanism denying the violation, **and** (c) the checker itself has been shown to **fail** on a deliberately injected violation. A PASS from an unexercised checker is treated as evidence of nothing.

**Corollary for this delegation:** no delegated agent may register a scheduled task, contact a provider, store a credential, or take any external action. Those are human-approval items (R4, §7).

---

## 1. Verified starting state (reconnaissance, 2026-09-18)

| Fact | Command / evidence | Result |
|---|---|---|
| Implementation tree absent | `ls -d monitoring` , `ls monitoring/freecash` | **does not exist** → nothing is implemented yet |
| State tree absent | `ls data/freecash-monitor` | **does not exist** |
| Static read-only checker present, target missing | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | prints `TARGET MISSING: monitoring/freecash (nothing to scan — NOT a pass)` and `FAIL` — a checker that cannot find its target is a **failure**, never a pass |
| No scheduled task registered | `schtasks /query /fo LIST \| grep -iE "freecash\|finance\|monitor"` | no match → the routine is not scheduled |
| Canonical design exists | `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` (612 lines) | design-complete, **nothing executed**; §12 lists files **to be created** |
| Pre-flight gate sheet unexecuted | `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` | every `Observed result` / `Status` cell empty |
| Rule audit of legacy artifacts exists | `docs/free-cash-monitor-routine/AUDIT-RULE-COMPLIANCE.md` (280 lines) | no legacy artifact enforces all four rules; several *violate* R4 or fabricate success |
| Toolchain | `node --version` → v24.20.0 · `py -3 --version` → Python 3.14.7 | both present; routine is specified in Python (stdlib + `zoneinfo`) |

**Blocking external unknown (carried forward, not invented):** the provider read contract for the real account is `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`. Research to date (`RESEARCH-PLAN.md`, `PROVIDER-API-RESEARCH.md`) found that **freecash.com forbids automated access outright (ToS §17, explicitly including monitoring)**, that **`freecash.io` is a parked domain, not a platform**, and that the only documented read-only balance APIs in scope belong to **HG.Cash** and **Cashfree Payouts** — neither confirmed as held by the entity. Until a provider read is confirmed *and* approved, every snapshot is `degraded: true` and every "no change" report is **unverified**.

---

## 2. Delegation model

| Party | Scope | May touch | May NOT touch |
|---|---|---|---|
| **Delegator (this Hermes session)** | owns the contract, gates, and final verdict | docs under `docs/free-cash-monitor-routine/`, reads of `git status` | implementation code, scheduled tasks |
| **W1 builder subagent** | implement the routine per `ROUTINE-DESIGN.md` §12 + tests | **new** paths only: `monitoring/freecash/**`, `data/freecash-monitor/**`, this doc dir | existing tracked files, provider network, credentials, `schtasks`, `git add/commit` |
| **W2 research subagent** | re-verify the provider/ToS/notification facts live | read-only web fetches, `localhost` probes | any credential use, any authenticated call, any write to the provider |
| **W3 verifier subagent** | adversarial verification of W1's artifact | read the artifact, run it, write only under `monitoring/freecash/tests/` and a scratch dir | fixing the artifact (a verifier that patches what it verifies is not a verifier) |
| **Operator (human)** | all R4 decisions, all external actions | schtasks registration, credentials, provider access | — |

Isolation rule: subagents cannot see this conversation, so each task carries its own contract text (rules, paths, forbidden actions, evidence format). Child summaries are **self-reports**; every claimed artifact is re-verified by the delegator from the filesystem before it is reported as done.

---

## 3. Task graph

```
W2 research (start now, parallel) ──┐
                                    ├─> W4 operator decision packet  ──> W5 scheduling (BLOCKED: human approval)
W1 build offline-provable core ─────┤
        │                           │
        └─> W3 adversarial verify ──┘   (verifier must run AFTER builder; never parallel on the same files)
```

| ID | Task | Input | Output (artifact) | Gate | Evidence required | State |
|---|---|---|---|---|---|---|
| **W1** | Implement R1–R4 core offline: day-lock gate, read-only client, change detector, notify, approval queue, watchdog, static checker wiring | `ROUTINE-DESIGN.md` §2–§8, §12 | `monitoring/freecash/*.py`, `monitoring/freecash/tests/*.py` | **G1** | file list; `git status --short` before/after (only new paths); executed test output; checker exit codes | dispatched |
| **W2** | Re-verify provider/ToS/notification/scheduler facts live; state confidence + `COULD NOT VERIFY` explicitly | `RESEARCH-PLAN.md`, `PROVIDER-API-RESEARCH.md` | findings append with URL + observed result per claim | **G2** | each claim carries a fetched URL or a command actually run; zero invented endpoints | dispatched |
| **W3** | Adversarial rule verification (R1–R4) with negative controls | W1 artifact | `monitoring/freecash/tests/verification-report.md` + scratch fixtures | **G3** | per-rule PASS/FAIL with the command and its observed output; minimum one injected-violation control per rule | gated on W1 |
| **W4** | Operator decision packet: which read source, which channel, which schedule | W2 + design §10 | `PROVIDER-DECISION-PACKET.md` (§ option table) | **G4** | options with Expected Effort / Time-to-Revenue / Dependencies / First Concrete Action; named blocker per option | gated on W2 |
| **W5** | Register Task A (08:35) + Task B (23:50), `IgnoreNew`, `StartWhenAvailable=true`, restart-on-failure = **Do not restart** | W1+W3 green, W4 decided | task definitions | **G5** | `schtasks /Query /V /FO LIST` output | **BLOCKED — human approval (R4)** |
| **W6** | 30-day unattended-operability review (weekly runbook §9.2) | running routine | weekly report | — | `degraded: true` count trend, `MISSED_DAY` count, `DELIVERY_FAILED` count | after W5 |

---

## 4. Options (operator-facing decision table)

**Time-to-Revenue is interpreted honestly:** a monitoring routine cannot *create* earnings (R2 forbids automated earning actions), so the column below reports **when the operator first gets verified earnings visibility**, i.e. the point at which monitoring starts protecting real money (faster payout decisions, and avoided ToS/account loss).

| # | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| **O1 ★** | **Offline-provable routine with a declared `degraded` read source** (local `GET /api/v1/status/metrics` + operator-entered state file) — ship all four rules with executable enforcement now | 6–10 h (mostly W1+W3, mostly mechanical from the existing 612-line design) | **Same day for rule guarantees; day 1–2 for the first verified daily cycle.** Visibility is honest but *unverified against the provider* — every snapshot carries `degraded: true`, so no false confidence | nothing external (Python 3.14 + stdlib only) | Create the day-lock gate and prove `SKIP_DUPLICATE_DAY` by running the entry point twice (W1, gate G1) |
| **O2** | **Provider-verified read via HG.Cash documented API** (`GET /accounts` → `balance`, `pendingFees`, `netBalance`, `status`) — the only documented read-only balance API tied to this entity's history | 4–8 h on top of O1 (one allowlisted path + one mapping function + one live capture test) | **3 days – 2 weeks** — blocked on the operator confirming the entity actually holds an HG.Cash account and generating a dashboard Bearer token (no partner approval needed) | HG.Cash account + token in `.env` (never in the repo); outbound HTTPS; live network-capture test T2.4 | Operator confirms account ownership; then an unauthenticated `curl -i https://hg.cash/api/v1/accounts` returning **401** (endpoint live) and an authenticated one returning **200** |
| **O3** | Provider-verified read via Cashfree Payouts (`GET /payout/v1/getBalance`) | 4–8 h on top of O1 | **1–4 weeks** — the endpoint is documented but access is gated behind an activation queue (unentitled accounts get HTTP 403 `APIs not enabled`), so the clock is admin, not engineering | Cashfree merchant account with Payouts API enabled; token in `.env` | Submit the Payouts activation request; record the 403 → 200 transition as the readiness signal |
| **O4** | **Operator-entered daily state file only** (no machine read at all): 60 s of the operator's own normal use of their dashboard, one appended line | 1–2 h | **Same day** — first appended record is the first visibility; zero ToS surface | a writable `data/freecash-monitor/state/status.jsonl`; the operator's own login (ordinary personal use) | Append the seed record and make the change detector consume it as source `operator_entered` |
| **O5 ✗** | Scripted/headless browser session against freecash.com to read the balance | 4–6 h | **Negative expected value — do not build** | user profile, live 2FA handling, stored credentials | Record the rejection with citation (ToS §17 bans automatic processes "for any purpose, including monitoring"; `/user/`, `/myprofile` disallowed in `robots.txt`) so it is not re-proposed |

**Recommended composition:** **O1 now** (all four rules provably enforced and exercised) → **O4 immediately in parallel** (real numbers, zero ToS risk) → **O2 or O3 as soon as the operator confirms entitlement** (turns `degraded: true` off) → O5 permanently rejected.

---

## 5. Acceptance gates (exact commands, observable results)

| Gate | Command | Expected observable result | Fails if |
|---|---|---|---|
| **G1** R1/R2/R4 offline-provable | `py -3 D:/AgenticOS/monitoring/freecash/run_daily_check.py` (×2 same day) | 1st: exit 0, one snapshot, `last_success_day == today`. 2nd: exit 0, stdout `SKIP_DUPLICATE_DAY`, exactly +1 `SKIP_DUPLICATE_DAY` line, snapshot mtime unchanged | 2nd run reads the network, writes a snapshot, notifies, or touches the ledger |
| **G1b** concurrency | `for i in 1 2 3 4 5; do py -3 …/run_daily_check.py & done; wait` | exactly 1 snapshot for the day; exactly 4 `SKIP_DUPLICATE_DAY` lines; ledger written once | more than one winner |
| **G2** research grounding | every W2 claim | carries a URL that was fetched or a command actually run; unknowns labelled `COULD NOT VERIFY` | any invented endpoint, path, or price |
| **G3** negative controls | inject `requests.post("http://localhost:3001/api/v1/status/claim", json={})` into a **scratch copy**; run `bash docs/free-cash-monitor-routine/verify-readonly.sh <scratch>` | exit **1**, offending `file:line` printed, ≥1 forbidden-token class matched | exit 0 (checker is a tautology) or exit 2 (target missing) |
| **G3b** R4 freeze | craft `pending.json` with `status: APPROVED` + `expires_at_utc` in the past; run every routin component; then `grep -r "EXECUTED" data/freecash-monitor/approvals/` | **0** execution events; item still waits; only `NOT_EXECUTED` appears | any file shows an executed action |
| **G4** decision packet | W4 doc | every option has Expected Effort / Time-to-Revenue / Dependencies / First Concrete Action and a named blocker | an option with no first action |
| **G5** scheduling | `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` | 08:35 daily, `IgnoreNew`, `StartWhenAvailable`, restart-on-failure = **Do not restart** | a restart policy is set (a restart is a second same-day run → R1 violation) — **requires human approval first** |

---

## 6. Hard constraints on every delegated agent

1. **No external action.** No provider call, no scheduled-task registration, no message/e-mail send, no purchase, no credential creation. R4 applies to the delegation itself.
2. **No credentials, ever.** Tokens come from the operator's vault/env at runtime; `grep -rniE "password|token|secret|api[_-]?key"` over the routine and state dirs must return 0 hits.
3. **No invented endpoints.** Unresolved provider paths stay as the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`.
4. **Additive only.** New paths under `monitoring/freecash/` and `data/freecash-monitor/`; never edit, delete, reset, or stage an existing file (the worktree holds a large body of unrelated uncommitted work on `hermes-rescue-20260908`).
5. **No `git add` / `git commit` / `git checkout` / `git stash`.**
6. **stdlib-first.** Python 3.14 stdlib + `zoneinfo`; do not install packages to make a test pass.
7. **Report evidence, not intentions.** Every claim in a child summary must be accompanied by a command and its observed output, or be labelled unverified.
8. **Stop on ambiguity** rather than guessing a provider contract, a schedule time, or a notification channel.

---

## 7. Human approval points (R4) — nothing below happens automatically

| # | Action awaiting human approval | Why it is gated |
|---|---|---|
| 1 | Registering Task A / Task B with Task Scheduler | a system-level change and the only thing that makes the routine recurring |
| 2 | Enabling any provider read (HG.Cash / Cashfree) | external access + credential handling |
| 3 | Enabling the SMTP channel | mailbox credential |
| 4 | Any payout/claim/transfer | **permanently out of scope for this routine** — no code path exists or will be added here |
| 5 | Superseding/removing legacy monitors | destructive; keep them on disk, mark superseded |

---

## 8. Legacy artifacts: keep, don't delete

Per `AUDIT-RULE-COMPLIANCE.md`, every pre-existing "Free Cash monitor" artifact is untracked and none enforces all four rules (`server/scripts/freecash-daily-monitor.mjs` cannot even parse; `finance-monitor/src/wait_gate.py` fabricates consent with `random.choice` at ~60% APPROVE; `server/scripts/verify-freecash-rules.mjs` reports 4/4 PASSED against a file that does not parse). The workflow leaves all of them **in place and unmodified**, records them as superseded, and never cites them as evidence of compliance.

---

## 9. Delegation status (live)

| Task | Dispatched | Returns |
|---|---|---|
| W1 build | yes | artifact under `monitoring/freecash/` + executed test output |
| W2 provider/ToS research | yes | re-verified findings with URLs/commands + confidence |
| W3 adversarial verification | no — gated on W1 | verification report with negative controls |
| W4 decision packet | no — gated on W2 | option table for the operator |
| W5 scheduling | no — **human approval required** | — |

Delegator obligation after children return: verify each claimed artifact on disk (exists, hashes/paths, re-run the gate command) before any part of it is reported as done.

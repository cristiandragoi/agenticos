# DELEGATED-WORKFLOW-PLAN.md — delegation, workflow and research plan

**Project:** Free Cash Finance Automation — daily status monitoring routine
**Repo:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908` (pre-existing uncommitted work left untouched)
**Written:** 2026-09-18, by the orchestrating agent, against *executed* evidence only.
**Companions (pre-existing):** `ROUTINE-DESIGN.md`, `RESEARCH-PLAN.md`, `AUDIT-RULE-COMPLIANCE.md`, `PROVIDER-API-RESEARCH.md`, `RULE-GATE-CHECKLIST.md`, `verify-readonly.sh`
**Status:** P0–P5 buildable now, offline. P6 (real provider read) is **BLOCKED** on operator-held credentials. No code in this plan performs an earning action at any point.

---

## 1. Hard constraints (the 4 operational rules — non-negotiable, enforced structurally)

| Rule | Requirement | Enforcement class mandated by this plan | Executable gate that must pass |
|---|---|---|---|
| **R1** | Check status **once per day**, no double runs, missed day detectable | Atomic exclusive-create day lock (`os.open(O_CREAT\|O_EXCL)`) + ledger for audit only + independent same-day watchdog | run twice same day → 1 snapshot, 1 `SKIP_DUPLICATE_DAY` line; 5 concurrent → exactly 1 winner |
| **R2** | **Zero** automated earning actions (no claim/withdraw/payout/redeem/survey/offer/bet/spin/deposit) | Deny-by-default transport: method allowlist `{GET,HEAD}` + path allowlist regex + body rejection + static CI grep over the routine source | `verify-readonly` exit 0; `request("POST", …)` raises `ForbiddenWriteError` *before* any socket opens |
| **R3** | Notify the operator when **earnings or account status changes** | Prior snapshot loaded **before** new snapshot written; exact integer-cent comparison (no % thresholds); dedupe key `sha256(day_key\|change_type\|field\|old\|new)` consulted *before* dispatch | day-1 $10.25 → day-2 $13.40 → exactly 1 notification; identical days → 0 notifications |
| **R4** | **Human approval before ANY external action** | Routine may only *enqueue*; `execution_state` frozen at `NOT_EXECUTED`; `expires_at_utc` always null; no code path reads `status == APPROVED` | 90-day clock advance with no human input → item still `PENDING`, zero `EXECUTED` events anywhere |

Two meta-rules apply to the whole programme:

- **A verifier must be shown to FAIL on a known violation before it is trusted.** The existing `server/scripts/verify-freecash-rules.mjs` prints "4/4 PASSED" and exits 0 while certifying a file that does not parse — a green check that proves nothing is treated as evidence of nothing.
- **A monitor that exits 0 without creating its day-key/lock artifact is not a pass.** Absence of evidence is a failure, not a pass.

---

## 2. Verified baseline (everything below was executed on this host on 2026-09-18)

Exact commands and observed results:

| Command | Observed result | Meaning |
|---|---|---|
| `ls monitoring data/freecash-monitor` | `No such file or directory` (both) | The canonical routine from `ROUTINE-DESIGN.md` **does not exist**. All 18 planned tests are currently unexecutable. |
| `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at line 41 (`isDailyCheckAllowed(): boolean`) | The one "known-good entry point" cannot run on Node v24.20.0. Not deployable. |
| `node server/scripts/verify-freecash-rules.mjs` | prints `All 4 operational rules verified (4/4 passed)`, exit 0 | **False pass.** It certifies the non-parsing file above. Do not cite this as compliance. |
| `bash docs/free-cash-monitor-routine/verify-readonly.sh` | `TARGET MISSING: D:/AgenticOS/monitoring/freecash (nothing to scan — NOT a pass)`; exit **2** | The R2 static gate is real and fail-closed. It is currently red because the target is unimplemented. |
| `python -m py_compile scripts/monitoring/free-cash-daily-check.py scripts/make_freecash_check.py server/tasks/daily-finance-monitor.py` | exit 0, no output | These parse; parsing is not compliance (snapshot ordering + stub defects documented in `AUDIT-RULE-COMPLIANCE.md`). |
| `grep -oiE '^[A-Za-z0-9_]+=' .env server/.env` (names only, values redacted) | only `DEFAULT_LLM_*`, `GATEWAY_PROVIDER_ORDER`, `JARVIS_SUPERVISOR_V2`, `OLLAMA_*` | **No provider credential exists in this repo.** There is no configured Free Cash provider account here — P6 is blocked on operator input, not on engineering. |
| `git rev-parse --abbrev-ref HEAD` + `git status --porcelain` | branch `hermes-rescue-20260908`, ~30+ modified tracked files pre-existing | All writes in this programme are **new files only**; nothing pre-existing is modified or committed. |
| Prior research (already executed, cited in `RESEARCH-PLAN.md`) | freecash.com ToS §17 forbids automated access "for any purpose, including monitoring"; `freecash.io` is a parked GoDaddy lander; HG.Cash and Cashfree Payouts have documented read-only APIs but need operator accounts | Any **automated** read of freecash.com is a ToS violation. Compliant acquisition is operator-mediated or an official provider API. |

Accepted lesson from the baseline: the failure mode of this project is not missing code, it is **documents asserting compliance that no execution backs**. This plan therefore makes every deliverable carry an executed check.

---

## 3. Delegation map

Three workstreams were dispatched in parallel. Each one is forbidden from touching pre-existing files, from sending any write request to any provider, and from creating scheduled tasks or commits.

**W1 — Provider contract research** → `docs/free-cash-monitor-routine/PROVIDER-CONTRACT-RESEARCH-V2.md`
Goal: determine which provider this repo actually targets (evidence, not assumption), documented read-only status/earnings endpoints with citations, and a VERIFIED / UNKNOWN / DEPRECATED split.
Acceptance test: the document names, for every endpoint it proposes, either a repo file+line or a fetched official URL; anything else is marked UNKNOWN. Secrets appear as `[REDACTED]`.
Constraint: no logins, no account creation, no POST/PUT/PATCH/DELETE to any provider, read-only GET/HEAD doc fetches only.

**W2 — Executable rule gate + empirical candidate audit** → `scripts/monitoring/rule_gate_verify.py` + `docs/free-cash-monitor-routine/EXECUTABLE-RULE-AUDIT.md`
Goal: a verifier that reports PASS/FAIL per rule with evidence, **proven to fail on a planted violation**, then run against every candidate monitor in the tree.
Acceptance test: the planted-violation run exits non-zero and lists each violated rule; each candidate is classified VIABLE / SUPERSEDE / STUB-ONLY from observed execution (command, exit code, artifacts).
Constraint: no provider write calls; no modification of existing files (scratch copies only).

**W3 — Capability verification + phased implementation plan** → `docs/free-cash-monitor-routine/IMPLEMENTATION-PLAN-V3.md`
Goal: prove the capabilities the design depends on (NTFS atomic `O_CREAT|O_EXCL`, concurrency winner, `py -3`, `python3` absence, `schtasks /Query`, PowerShell toast assembly, `zoneinfo` Europe/Berlin, localhost `:3001` metrics endpoint) and lay out phases P0–P6 with dependencies.
Acceptance test: every capability has a command, an observed result and a PASS/FAIL/BLOCKED verdict; no phase depends on an unverified capability.
Constraint: no scheduled task created/modified, no registry change, no commit.

---

## 4. Phase plan — Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

Honest framing of value: **monitoring produces no revenue by itself.** Its return is *detection latency* (how fast the operator learns of an earnings or status change) and *avoided loss* (no automated action, no ToS breach, no silent drift). "Time-to-Revenue" below therefore means: earliest point at which the routine produces its first *true, acted-upon* signal.

**P0 — Executable rule gate (W2).**
Expected Effort: 2–3 h, agent-executable.
Time-to-Revenue: no direct revenue; unlocks trust in every later phase — without it, every later "PASS" is unverifiable (today's baseline already contains one false 4/4 pass). First defensible compliance statement: same day.
Dependencies: nothing. Runs entirely offline.
First Concrete Action: `python D:/AgenticOS/scripts/monitoring/rule_gate_verify.py --self-test` → must exit non-zero on the planted violating copy.

**P1 — R1 day-lock gate, ledger, missed-day math, watchdog.**
Expected Effort: 3–4 h, agent-executable.
Time-to-Revenue: no revenue; buys certainty that the daily signal exists exactly once per day. First true "day consumed" artifact: same day.
Dependencies: P0 green; writable state dir `data/freecash-monitor/state/` on the D: volume (atomicity proven in W3).
First Concrete Action: create `monitoring/freecash/gate.py` with `acquire_day_lock()`, then run the double-invocation and 5-process concurrency tests.

**P2 — R2 read-only client + static CI grep.**
Expected Effort: 3–4 h, agent-executable.
Time-to-Revenue: no revenue; this is the phase that makes "zero automated earning actions" a fact rather than a promise, which is what protects the account itself.
Dependencies: P1 (state dir), `docs/free-cash-monitor-routine/verify-readonly.sh` (exists, currently exit 2 = target missing).
First Concrete Action: create `monitoring/freecash/readonly_client.py` with `ALLOWED_METHODS={GET,HEAD}` and the path allowlist, then `bash docs/free-cash-monitor-routine/verify-readonly.sh` → expect exit 0.

**P3 — R3 snapshot, diff, dedupe.**
Expected Effort: 3–4 h, agent-executable.
Time-to-Revenue: **not yet real** — with no provider contract (P6 blocked) the diff runs against the local metrics API only and every snapshot carries `degraded: true`. First *true* earnings-change notification cannot happen before P6.
Dependencies: P1 (day key), P2 (read path); a working data source.
First Concrete Action: create `monitoring/freecash/changedetect.py` with `load_snapshot()` called **before** `save_snapshot()`, then run the two-day fixture test (1025 → 1340 cents → exactly 1 notification).

**P4 — Notification channel + approval queue frozen at NOT_EXECUTED.**
Expected Effort: 4–5 h (agent-executable; toast channel test needs one interactive PowerShell run, 15 min human).
Time-to-Revenue: this is where R3/R4 become operator-visible; first human-visible alert same day.
Dependencies: P0 (gate), P3 (change events); Windows toast assembly availability (W3 verifies); SMTP optional and needs a vault-held mailbox credential.
First Concrete Action: create `monitoring/freecash/notify.py` + `approval_queue.py`, then run the forced-delivery-failure test: ≤2 attempts, one `DELIVERY_FAILED` line with the full message, exit 0, no retry loop.

**P5 — Task Scheduler registration + dry run.**
Expected Effort: 1–2 h, needs human approval to register a task (agent can compose the command; registration is an external action under R4).
Time-to-Revenue: converts the routine into an unattended daily signal. Earliest: next scheduled run.
Dependencies: P0–P4 green; `schtasks` present and permitted (W3 verifies); explicit human go-ahead (this *is* an external action, so R4 applies to it).
First Concrete Action: `schtasks /Create /TN "FreeCash-Daily-Monitor" /SC DAILY /ST 08:35 … /RL HIGHEST` after operator sign-off, then `/Query /V /FO LIST` to prove `IgnoreNew` and restart-on-failure disabled.

**P6 — Bind the real provider read contract. BLOCKED.**
Expected Effort: 4–8 h engineering **plus** an external wait (account entitlement / activation queue 1–4 weeks for gated providers).
Time-to-Revenue: the earliest date on which the daily report is *provider-verified* rather than degraded. Unknown until the operator names the account holding the earnings.
Dependencies: **operator-held credentials that do not exist in this repo** (verified: `.env` contains only LLM/gateway keys); provider selection; and — if the target is freecash.com — a compliance decision, because its ToS §17 forbids automated access "for any purpose, including monitoring".
First Concrete Action: operator answers one question — *which account actually holds the money, and does it expose a documented read-only balance/earnings endpoint?* Until answered, W3's provider slot stays the literal string `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` (an invented URL is never an acceptable substitute).

---

## 5. Delivery-shape options

**Option A — Full routine + Windows Task Scheduler + watchdog (as designed in `ROUTINE-DESIGN.md`).**
Expected Effort: 18–25 h total (P0–P5), agent-executable except task registration and the toast check.
Time-to-Revenue: unattended daily signal within ~2 working days, but **degraded/unverified** until P6; no cash movement is ever automated, so the financial value is loss-avoidance and latency, not income.
Dependencies: all capabilities in W3; operator approval for the scheduled task; provider contract for any real earnings number.
First Concrete Action: P0 — build and self-test `scripts/monitoring/rule_gate_verify.py`.

**Option B — Minimal single-file monitor + one scheduled task, no watchdog.**
Expected Effort: 5–7 h.
Time-to-Revenue: same day to first run; ≈1 day to unattended.
Dependencies: a writable state dir and one scheduled task; still needs P6 for a true number.
First Concrete Action: write `monitoring/freecash/minimal_monitor.py` (day lock + allowlisted GET + one alerts.jsonl line).
Recommendation: **do not choose this as the end state.** It saves ~15 h and loses the missed-day detector and the CI-enforced read-only gate, i.e. it loses exactly the two properties (once-a-day provability, un-automatable earning actions) that the 4 rules exist to guarantee.

**Option C — External managed scheduling (existing cron/CI/hosted runner on this machine).**
Expected Effort: 4–6 h **if** a runner already exists; 10 h+ otherwise, plus secrets-handling work.
Time-to-Revenue: 1–3 days, and the first run is a *scheduled job outside the operator's machine*, which makes "did it run today?" harder to observe locally.
Dependencies: a runner that already exists on this host (W3 checks); secret distribution; network egress policy.
First Concrete Action: `schtasks /Query /FO LIST | grep -i runner` plus checking for any CI agent service — if none exists, reject this option immediately rather than building one.

**Option D — Operator-entered state file (bridge option, already researched in `RESEARCH-PLAN.md`).**
Expected Effort: 1–2 h.
Time-to-Revenue: **day 1** — the operator's own dashboard read, typed once into a local file, is the only acquisition path that is both immediate and unambiguously ToS-compliant for freecash.com.
Dependencies: none beyond a text file; no credentials, no automation touching the provider.
First Concrete Action: create `docs/free-cash-monitor-routine/state/status.jsonl` and append the seed record.

**Recommended sequence:** P0 → P1 → P2 → P3 → P4 → (P5 with sign-off) → P6 last; run Option D in parallel from day 1 so the operator has *some* real visibility while P6 is blocked. Option B only as a stopgap if P0–P4 cannot be completed this week; Option C only if a runner is already present.

---

## 6. Blocked items (accurate reasons, no workarounds invented)

1. **Provider read contract (P6) — BLOCKED (external dependency).** No provider account credential exists in this repo; `.env` and `server/.env` hold only LLM/gateway keys. Nothing in the codebase can produce a real earnings or balance value today.
2. **Live read-only network-capture test (design test T2.4) — BLOCKED.** Requires real credentials and a session; cannot be run offline.
3. **Automated monitoring of freecash.com — REJECTED on compliance grounds, not technical ones.** ToS §17 forbids automated access "for any purpose, including monitoring"; the downside is account restriction and voided rewards (§19). Every design here assumes the operator-mediated path until a provider with a documented read-only API is named.
4. **SMTP notification channel — BLOCKED pending a vault-held mailbox credential.** No mailbox credential is present in the repo.

---

## 7. How this programme is accepted (verification loop)

A phase is done only when its check has been executed *in this session* and its output recorded:

1. Run the command, capture exit code and output verbatim.
2. Read back the artifact it was supposed to create (day lock file, snapshot, alert line, approval item) — file existence plus parsed content, not a status message.
3. For any rule claim, run the rule gate from P0; a green result that came from a verifier never shown to fail is discarded.
4. Re-run `bash docs/free-cash-monitor-routine/verify-readonly.sh` after any change to routine source; an increase in `# readonly-exempt:` markers is treated as R2 eroding, not as noise.
5. Report "operational but unverified" until `degraded: true` disappears from snapshots — never report a green 30-day run while the data source is a substitute.

---

## 8. Status log

| Date | Event |
|---|---|
| 2026-09-18 | Orchestrator baseline verified (§2). Three delegated workstreams dispatched (§3). This plan created. No pre-existing file modified; no commit made; no provider call made. |

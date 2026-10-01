# DELEGATION DISPATCH — Free Cash Finance Automation daily status-monitoring routine

**Repository:** `D:/AgenticOS` (workspace root for every path in this file)
**Branch / HEAD:** `hermes-rescue-20260908` @ `d14253d` (2026-09-08) — 40+ modified tracked files uncommitted; `monitoring/` and `docs/free-cash-monitor-routine/` are **untracked** (`git ls-files monitoring/ | wc -l` = 0)
**Host:** Windows 11, git-bash, non-elevated · `python` = 3.11.9 (Hermes venv, has tzdata) · `py -3` = 3.14.7 (no `Europe/Berlin` → `ZoneInfoNotFoundError`)
**Written:** 2026-09-20 by the orchestrator, evidence-only. Supersedes nothing; read alongside `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` (2026-09-19) whose §14 work list is still the live backlog.
**Delegation id:** `deleg_462be34a` (3 parallel subagents, dispatched 2026-09-20)

---

## 0. The four operational rules and where they are enforced

| Rule (operator's words) | Enforcement mechanism (code, not convention) | File |
|---|---|---|
| R1 "Check the status once a day" | atomic `O_CREAT\|O_EXCL` day lock keyed on the operator-local calendar day; second run prints `SKIP_DUPLICATE_DAY` | `monitoring/freecash/gate.py::acquire_day_lock`, `run_daily_check.py` |
| R2 "Don't perform earning actions automatically" | deny-by-default transport: `ALLOWED_METHODS` = GET/HEAD, `ALLOWED_PATHS` allowlist, `ForbiddenWriteError` raised otherwise; **no** write/claim/withdraw/cashout path exists in the tree | `monitoring/freecash/readonly_client.py::request` |
| R3 "Tell me if earnings or account status changes" | exact integer-cent snapshot diff + pre-dispatch dedupe key (one distinct change → one notification) | `monitoring/freecash/changedetect.py`, `notify.py` |
| R4 "Ask me before any external action" | approval queue with `execution_state = NOT_EXECUTED` and `expires_at_utc = null`; the routine contains **no execution path at all** | `monitoring/freecash/approval_queue.py::enqueue` |

There is no auto-approve, no timeout-decides, no retry, and no scheduled task registered. Nothing in the routine can spend, claim or withdraw — by construction, not by policy.

---

## 1. Verified state on 2026-09-20 (commands actually executed this pass)

| # | Command | Observed today | Reading |
|---|---|---|---|
| A1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=6 errors=11 skipped=0`, exit 1 | Suite **red**. Was 7 failures / 11 errors on 09-19 → one failure cleared, one root cause remains. Output shows live mechanisms working: `SKIP_DUPLICATE_DAY 2026-09-20`, `MONITOR_DEGRADED`, `WATCHDOG_MISSED_DAY … coverage=NOTIFIED`. |
| A2 | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` | `forbidden=2 exempt=27 missing_targets=0` → `FAIL — R2 violation`, exit 1 | Two unexempted hits: `approval_queue.py:111` (`earning-action`) and `tests/test_r4_approval.py:283` (`write-call-shape`). |
| A3 | `py -3 scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` | `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS` → `VERDICT: NOT COMPLIANT — 1/4 rule(s) violated: R1`, exit 1 | R1 FAIL is a **verifier scope defect** (lock lives in `gate.py`, verifier is single-file). Not proof the lock is missing — see A4. |
| A4 | `FREECASH_DATA_ROOT=<tmp> python <copy>/run_daily_check.py` (during A1's smoke run) | `RUN_OK … lock=2026-09-20.lock`, then `SKIP_DUPLICATE_DAY 2026-09-20` | R1 works behaviourally: the lock is created and the second same-day run is refused. |
| A5 | `schtasks /Query /FO LIST \| grep -icE "freecash\|daily-monitor\|missed-day"` | `0` | **Not scheduled. Not operating.** |
| A6 | `ls -la data/freecash/` · `ls -la data/freecash-monitor/` | first is empty; second does not exist | No production state root exists yet — no locks, snapshots, alerts or approvals have ever been written outside temp dirs. |
| A7 | `git status --porcelain monitoring/ docs/free-cash-monitor-routine/` | `?? monitoring/` · `?? docs/free-cash-monitor-routine/` | The routine is untracked: **git cannot recover an edit**. Temp backup before any edit is mandatory. |

**Honest status in one line:** the four rules are structurally enforced in code and R1/R3/R4 mechanisms have been observed firing in a temp data root; the suite and the read-only static checker are red, the acceptance gate reports NOT COMPLIANT, and no scheduled run has ever produced a production day lock. The routine is **built, not verified, not deployed**.

---

## 2. Workflow plan — delegated workstreams

Evidence standard for every item (non-negotiable): a rule counts as satisfied only if (a) the violating action is unreachable in code, (b) a command was executed showing the mechanism denying it, and (c) the checker was shown to **fail** on an injected violation. A checker that has never been shown to fail certifies nothing.

| ID | Workstream | Owner | Gate / acceptance | State |
|---|---|---|---|---|
| W1 | Build routine core (lock, read transport, diff, notify, queue, watchdog, verifier) | builder | G1 | deliverable exists under `monitoring/freecash/`; **red** (A1/A2) |
| W1-FIX | Fix `approval_queue.py:111` NameError (11 suite errors + the entire change→enqueue path); clear both R2 hits; suite to `failures=0 errors=0` | subagent `sa-0-d31e525e` | G1b: `run_all.py` exit 0 **and** `verify-readonly.sh` → `forbidden=0` exit 0, before/after output pasted | **dispatched 2026-09-20** |
| W2 | Provider / ToS / notification / scheduler research + operator decision packet (read source O1–O5, five required fields each) | subagent `sa-2-637b6ff6` | G2: every claim VERIFIED-with-fetched-URL or COULD NOT VERIFY; no credential used | **dispatched 2026-09-20** |
| W3 | Adversarial rule verification with negative controls (mutation matrix VT-01…VT-15) → `docs/free-cash-monitor-routine/verification-report.md` | subagent `sa-1-6b42aff6` | G3: per rule, clean case **and** ≥1 detected injected violation, or an explicit false-negative finding | **dispatched 2026-09-20** |
| W4 | Extend `scripts/monitoring/rule_gate_verify.py` with `--package <dir>` (whole-tree staging + per-rule module attribution) and close gaps D1 (token scan drops decisive hits) / D2 (delivery check accepts a `print` stub) | builder | G4: the gate exits 0 for the routine **as a package** and still FAILs on a planted violation of each rule | pending — must follow G1b (a gate is only meaningful against a green suite) |
| W5 | Register Task A 08:35 daily + Task B 23:50 watchdog (`MultipleInstances IgnoreNew`, `StartWhenAvailable`, **`RestartCount 0`**, S4U/Limited, interpreter pinned to the 3.11 venv exe, `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash`) | **operator (human, R4)** | G5: `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` output | **blocked — human approval required, do not register unattended** |
| W6 | 30-day unattended-operability review (day coverage, MISSED_DAY count, DELIVERY_FAILED count, `degraded:true` trend) | operator | weekly runbook | not started (needs W5) |

Sequencing: W1-FIX → W3 (verdict on the fixed revision) → W4 → G5 human approval → W5 → W6. W2 runs in parallel and gates only the "is the account actually observed?" question.

### Non-negotiables for any agent working on this routine
- No external action of any kind without an explicit human decision recorded in `approvals/`: no provider call, no scheduler change, no message send, no purchase, no login.
- No credential in the repository; secrets resolve at runtime from env/vault only.
- No invented provider endpoint — unresolved paths stay literally `PROVIDER_ENDPOINT_UNKNOWN`.
- Never add a write/claim/withdraw/cashout/complete verb or path; never widen an allowlist.
- Never let a timeout, watchdog, cron entry or scheduler retry move a `PENDING` item to executed.
- Never swallow an exception so a failed run exits 0; never delete a test to make a count green; never git add/commit/stash/reset.
- Additive edits only, temp backup of every file before editing it (the tree is untracked).

---

## 3. Research plan — questions that must be answered before this is called operational

| ID | Question | Method | What "answered" looks like |
|---|---|---|---|
| Q1 | Which read source is authorised: O1 local metrics, O2 HG.Cash `/accounts`, O3 Cashfree `getBalance`, O4 operator-entered file, O5 scripted browser? | W2 (fetch provider docs + ToS + robots.txt) | signed-off decision packet with the five fields per option, incl. ToS clause + URL for the rejected option |
| Q2 | Does the operator actually hold the account the routine would read, and under which provider name? | operator, in writing | the literal account provider string replaces `PROVIDER_ENDPOINT_UNKNOWN` |
| Q3 | Does a desktop toast balloon actually appear? | operator, once, physically | "I saw it" — until then the only proven delivery channel is append-only `alerts/alerts.jsonl` |
| Q4 | Which interpreter runs the scheduled action? | W2/W5 | pinned absolute path; `py -3` (3.14.7) is disqualified — it raises `ZoneInfoNotFoundError` **before** the day lock is created, producing no lock, no log and no alert |
| Q5 | Is `StartWhenAvailable` catch-up real for a plain daily trigger? | W2 | Microsoft docs wording recorded; catch-up treated as unproven, the day lock + watchdog carry the missed-day case |
| Q6 | Does the state root default (`paths.py` → `data/freecash-monitor`) get aligned to `data/freecash/`, or is the env var required forever? | W4 | one canonical root, documented in the task definitions |

---

## 4. Read-source options — decision inputs

Effort is wall-clock engineering/operator time; Time-to-Revenue means *visibility that the account is intact and earning* (this routine cannot create earnings).

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action | Blocker |
|---|---|---|---|---|---|
| **O1** local read-only `GET /api/v1/status/metrics` + operator-entered state file (current default, `degraded: true`) | 6–10 h builder | same day for rules; 1–2 days first full cycle | python 3.14 stdlib; local endpoint reachable; writable state dir | `python monitoring/freecash/run_daily_check.py --source operator_state --print-state` | none for the rules; cannot substitute for account observation |
| **O2** HG.Cash `GET /accounts` (documented read-only) | 4–8 h builder on top of O1 | 3 days – 2 weeks | **confirmed HG.Cash account + dashboard token** (operator-held, currently unverified) | create the token in the provider dashboard, then `FREECASH_DATA_ROOT=… run_daily_check.py --source metrics_http` against the documented path | account ownership unknown — operator must confirm it exists |
| **O3** Cashfree Payouts `GET /payout/v1/getBalance` | 4–8 h builder on top of O1 | 1–4 weeks | merchant account with Payouts API enabled (activation queue) + a **read-only-scoped** key | open the Payouts activation request in the provider dashboard | merchant account + activation queue; key must not be write-capable |
| **O4** operator-entered state file only, zero automation | 1–2 h operator | same day | writable state dir; ~60 s/day login + typing | `cp` the sample operator-state template and enter today's figures by hand | none — but a "no change" report only proves the file did not change |
| **O5** scripted browser / scraping freecash.com | 4–6 h | negative expected value | stored credentials + 2FA | — | **REJECTED**: provider ToS forbids automated access including monitoring (per `PROVIDER-FINDINGS-REVERIFIED.md`; W2 re-verifies the clause and URL today) |

Recommended now: **O4 + O1** (rules enforceable and verifiable today, degraded, nothing automated against a provider) with **O2** as the first non-degraded upgrade once the operator confirms the account. **O5 stays rejected**; a monitor that violates the provider's own terms is not a monitoring routine, it is a liability.

---

## 5. What is blocked, and on what

| Blocked item | Blocked on | Who unblocks |
|---|---|---|
| Registering Task A / Task B (W5) | R4 — human approval; no agent may register a scheduled task | operator |
| `degraded: true` → `false` in snapshots | Q1/Q2 — a real, authorised read source | operator (decision) + builder |
| Passing acceptance gate for R1 (`--package` mode) | W4, gated behind W1-FIX going green | builder |
| Toast delivery being *observed* | physical confirmation by the operator on this desktop | operator |
| 30-day review (W6) | W5 running | operator |

**Do not report this routine as "compliant" or "operational" until:** `run_all.py` exits 0, `verify-readonly.sh monitoring/freecash` exits 0, the acceptance gate exits 0 for the package, and at least one production day lock exists at `data/freecash/state/day-locks/<day>.lock` from a scheduled run.

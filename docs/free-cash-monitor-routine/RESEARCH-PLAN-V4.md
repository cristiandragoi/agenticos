# RESEARCH-PLAN-V4.md — Research plan (design document) for the Free Cash Finance Automation daily status-monitoring routine

**Status:** research design document. **This file is the only artifact written by this pass.**
**Repo:** `D:/AgenticOS` · **Host:** Windows 11, git-bash (MSYS), `python` = 3.11.9 (`python3` = Windows Store stub, broken), `node` = v24.20.0, PowerShell 5.1.26100.9444
**Date of pass:** 2026-09-20 (Europe/Berlin), 06:57–07:00 local · **Branch/state:** `monitoring/freecash` and `docs/free-cash-monitor-routine/` are **untracked** by git (`git status --porcelain` → `?? monitoring/freecash/`, `?? docs/free-cash-monitor-routine/`)

**Scope of this pass:** read-only inspection of the repository plus read-only local execution of the routine against **throwaway** `FREECASH_DATA_ROOT` directories under `$LOCALAPPDATA/Temp/`. No credential was read, requested, written or used. **No remote/provider request was made.** No existing file was modified, moved or deleted.

---

## 0. The four operational rules this plan must serve

| Rule | Statement | Enforcement point that exists today |
|---|---|---|
| **R1** | Exactly one status read per operator-local calendar day | `gate.py`: `os.open(state/day-locks/<Y-M-D>.lock, O_CREAT|O_EXCL|O_WRONLY)`; `state/last-run.json` is audit only, never the gate |
| **R2** | Zero automated earning actions | `readonly_client.py`: method allowlist `{GET, HEAD}`, host allowlist loopback-only, path allowlist of two local regexes, body keywords refused, unknown kwargs refused, single socket site `_transport()`, plus a process-wide `sys.addaudithook` guard; `verify_readonly.py` / `verify-readonly.sh` static checkers |
| **R3** | Notify on earnings/status change | `changedetect.py` compare → `notify.py` (append-only `alerts/alerts.jsonl` always; toast/stub dispatch with a dedupe key written **before** dispatch; `OK_NO_CHANGE` is log-only) |
| **R4** | Human approval before any external action | `approval_queue.py`: PENDING items with `expires_at_utc = null`, `execution_state = NOT_EXECUTED`, `execution_allowed_by_this_routine = False`; `decide` refuses non-human identities; **no module treats an approved status as a trigger** |

The plan below is ordered by what actually **blocks a trustworthy daily monitor**, not by what is interesting.

---

## 1. Baseline snapshot of current state (timestamped — read the drift warning first)

### 1.1 DRIFT WARNING: the implementation changed *during* this pass

`monitoring/freecash/approval_queue.py`, `notify.py` and `run_daily_check.py` were modified at **06:57:40–06:57:46 local on 2026-09-20**, i.e. *between two of this pass's own measurement runs*, by a process that is not this one (this pass executed only read-only commands and tests into temp data roots). Two consecutive measurements therefore disagree:

| Snapshot | Time | Suite (`python monitoring/freecash/tests/run_all.py`) | Static checkers | Notable cause |
|---|---|---|---|---|
| **S1 (pre-fix)** | ~06:57:40 | `tests=52 failures=6 errors=11` (exit 1) | **exit 1**, `forbidden=2` — `approval_queue.py:111: action.setdefault("action_type", ACTION_LABEL_REQUEST_PAYOUT)` (earning-action) and `tests/test_r4_approval.py:283: self.assertNotIn("http.client", …)` (write-call-shape) | all 11 ERRORs were `NameError: name 'ACTION_LABEL_REQUEST_PAYOUT' is not defined` (`approval_queue.py:111`); the name was never defined — only `ACTION_LABEL_FOR_HUMAN_REVIEW` existed (`:52`) |
| **S2 (post-fix)** | 06:58:33–06:58:44 | `tests=52 failures=4 errors=0` (exit 1) | **exit 0**, `forbidden=0 exempt=28 missing_targets=0` on both checkers | `:111` now reads `ACTION_LABEL_FOR_HUMAN_REVIEW`; the negative-control string in the test was exempted |

**Consequence for this whole plan:** any "current state" claim in this repo has a shelf life of minutes. **Every verifier verdict must be recorded together with the md5 of the revision it certified** (§6.4). Re-measure before relying on any number in this section.

### 1.2 S2 revision pin (md5, measured 06:58:33)

```
a74d7973e1cc75b7a46903f4b7e6682d  approval_queue.py
6e04974d7a8d7a4f5eb778a6c7eee42c  changedetect.py
bef3aab5fa743e04fb762309f9dceab2  gate.py
4e513bcedb751ab245bd04f6da2154f7  notify.py
4b9a07d15e3da71bbffe9f48ae3db7e2  operator_state.py
b806f01085ea0c5a80fed4bc51d88b02  paths.py
778cbe18a9032933631ae3f0b92437bd  readonly_client.py
3a7bdbe7c1191338209dc1b9ff588fee  run_daily_check.py
adde879ea1a972775c010f00031c5717  verify_readonly.py
0e65f505a016e1a517c23087ad6e0471  watchdog.py
```

### 1.3 S2 remaining red tests (4 failures, 0 errors)

| Test | Observed assertion | Reading |
|---|---|---|
| `test_r3_changedetect…test_earnings_change_notifies_exactly_once` | (R3) notification-count assertion | R3 exact-once behaviour not yet proven green |
| `test_r4_approval…test_pending_item_survives_a_ninety_day_clock_advance` | (R4) pending item durability | R4 "waits forever" not yet proven green |
| `test_r5_smoke…test_delivery_failure_is_bounded_and_keeps_the_full_message` | (R3 delivery) | the 2-attempt-then-loud-fail path not yet proven green |
| `test_r5_smoke…test_missing_check_raises_one_alarm_and_changes_no_state` | `AssertionError: 'notify' != 'alert'` — `missed[0]["severity"]` | **severity-mapping defect: a missed day is emitted at `notify`, the test (and R3's intent) expects `alert`** |

In S1 the same watchdog area failed differently (`test_healthy_day_raises_no_alarm`: `assertTrue(state["covered"])` → `False`), and two further S1 failures were `test_five_concurrent_runs_yield_one_winner` (`AssertionError: 3 != 4` on `SKIP_DUPLICATE_DAY` count) and `test_day_key_follows_the_configured_timezone` (`AssertionError: 'Europe/Berlin' not found in 'C:\\…\\Temp\\freecash-test-pp1xd3sx\\freecash-monitor'` — a **test bug**: it asserts the timezone name appears in the *temp directory path*, so it cannot pass anywhere).

### 1.4 What the routine has actually produced in production: nothing

| Fact | Observation |
|---|---|
| Default data root `D:/AgenticOS/data/freecash-monitor` | **ABSENT** (`ls` → "No such file or directory"), i.e. the routine has never performed a real run on this host |
| `D:/AgenticOS/logs` | exists, **empty** |
| Scheduled task `FreeCashDailyCheck` | absent (`schtasks /Query /TN FreeCashDailyCheck` → "FEHLER: Das System kann die angegebene Datei nicht finden.") |
| `crontab` | **absent** in git-bash |
| Provider credential | none in the repo (reconciled with prior research; not re-derived here) |

---

## 2. (a) The ranked research questions that actually block a trustworthy daily monitor

Legend — **Blocks** = the reason a PASS on this question is a precondition for calling the monitor trustworthy. **Design change** = what concretely changes when the question is answered.

### RQ1 — Does the R3 notify path actually fire exactly once per distinct change, end to end? *(rank 1)*
- **Why it blocks:** R3 *is* the routine's entire output. At S1 the whole R3/R4 path was dead code: every change day reached `run_daily_check.py:151 → approval_queue.enqueue → build_item` and raised `NameError`, i.e. a change day could not complete. At S2 the path runs offline (see §5.2 demonstration) but four R3/R4/R5 assertions are still red. A monitor that logs instead of notifying satisfies R1 and R2 and **fails R3** — silently, which is the worst failure mode for a monitoring routine.
- **How the answer changes the design:** if exactly-once cannot be shown, the routine must ship as *log-only* with an explicitly stated R3 gap, or the notify path must be split so a notification-channel fault can never abort the state write (the code already intends this; unknown whether it holds under a duplicate-key race).
- **Method:** offline, temp `FREECASH_DATA_ROOT`; drive three consecutive local days through `run_daily_check.run(argv, now=<pinned>, sender=<recording sender>)`: day1 baseline (no notify), day2 earnings+balance change, day3 no change; then re-run day2's change key by re-entering the same figures after a change and back (dedupe path). Count: alert lines per event type, dispatch attempts, `notified-keys.json` entries and their `delivery` label.
- **Evidence standard:** a captured transcript where `changes=N`, `notifications=N`, `approvals=N` agree, `OK_NO_CHANGE` produced **zero** dispatch attempts, and each dedupe key appears in `notified-keys.json` with a delivery label **written before** the sender call (provable by making the sender raise and showing the key is present).
- **Effort:** 2–4 h.
- **Decision unblocked:** whether the routine may be scheduled at all, and whether R3 is satisfied by code or only by intent.

### RQ2 — Which provider/account holds the monitored balance, and does it expose a read-only `GET`/`HEAD` surface this routine may call? *(rank 2)*
- **Why it blocks:** no provider is bound anywhere in the repo; `readonly_client.py` carries the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` and `ALLOWED_PATHS` contains **only** two loopback local paths. Until this is answered, W3/W4 stay `UNKNOWN` and every snapshot is `degraded: true` — so a "no change" report is *unverifiable*, which is exactly the silent-false-confidence risk recorded in `ROUTINE-DESIGN.md:543`.
- **How the answer changes the design:** (i) *a provider with a verb-pure GET surface* → add exactly one `ALLOWED_PATHS` regex **and** widen `ALLOWED_HOSTS` beyond loopback (see §3.5 — this is a real, deliberate widening that the current audit hook blocks by design), plus a mutation test proving the new path is still read-only. (ii) *freecash.com* → no API path exists; close W3/W4 as **UNRESOLVABLE** and ship operator-entered only. (iii) *Cashfree Payouts* → requires defending an R2 exemption for `POST /payout/v1/authorize`, or requiring an out-of-band token so the monitor stays GET-only.
- **Method:** operator confirmation in writing of (a) the provider, (b) the account, (c) whether a dashboard-issued token exists. Then **one** read-only call to the documented path, with status code and field names logged and all values redacted.
- **Evidence standard:** an operator statement naming provider + account, plus one captured HTTP exchange showing `200` and the field names; for the negative case, the provider's own ToS/robots text (already fetched and quoted in the prior artifacts).
- **Effort:** 0.5 h operator time + 1 h to record it; 4–8 h for the integration if an API exists.
- **Decision unblocked:** whether the routine can ever be more than a degraded local substitute.

### RQ3 — What proves the read-only verifier fails on a known violation before its PASS is trusted? *(rank 3)*
- **Why it blocks:** this repo has already shipped a `4/4 PASSED` verifier whose assertions were tautologies and whose target did not parse — **re-confirmed live in this pass** (§6.1). A green static check that cannot go red is not evidence of R2 compliance, and R2 compliance is the property the whole design is built to protect. The current checker is better, but this pass found **five mutations it does not detect** (§6.2).
- **How the answer changes the design:** fixes what "R2 verified" is allowed to mean. If the static check alone is cited, R2 is unproven; the acceptance evidence must be the *runtime* refusals (transport guard + audit hook) plus a static check that has been shown to fail on planted violations on the same revision (md5-pinned, §6.4).
- **Method:** per-revision mutation matrix: byte-identical copy of the routine in temp, one planted violation per copy, both checkers run on each copy, exit codes recorded; plus parsing-awareness (`node --check` / Python `ast`) as a precondition of any assertion.
- **Evidence standard:** a table of (mutation, expected verdict, observed verdict, exit code) in which **at least one row is a detected violation** and at least one row is a green baseline on the same revision — a checker that never goes red on any row certifies nothing.
- **Effort:** 2–3 h (the matrix in §6.2 is a working prototype: ~20 min to reproduce, ~1 h to turn into a gate).
- **Decision unblocked:** what evidence the project is allowed to accept for R2, and whether the static checker gets a vote at all.

### RQ4 — Is the watchdog's missed-day signal correct and correctly severe? *(rank 4)*
- **Why it blocks:** the watchdog is the only mechanism that makes a *missed* day visible — i.e. the only thing standing between R1 and a silently unmonitored balance. At S2 it still emits a missed day at severity `notify` where the design and test expect `alert`, and at S1 the "healthy day" case reported `covered: False`. A watchdog that is wrong in either direction (cries wolf, or stays quiet) destroys the operator's trust in the one alarm that matters.
- **How the answer changes the design:** decides the severity table for `MISSED_DAY`/`RUN_FAILED`/`DELIVERY_FAILED` and whether missed-day detection must be moved off the ledger (and onto lock-file enumeration, which is the durable record) to survive a lost/corrupt `last-run.json`.
- **Method:** offline clock-advance experiments: (a) healthy contiguous days → expect zero alarms; (b) one day skipped → expect exactly one `alert`-severity line and **no** state mutation; (c) ledger deleted/corrupted while locks exist → what does the watchdog say?
- **Evidence standard:** alert-log excerpts per scenario, with the count and severity of each `MISSED_DAY` line and a diff of `last-run.json` proving "changes no state".
- **Effort:** 2–3 h.
- **Decision unblocked:** whether the missed-day alarm may be trusted as the R1 backstop, and whether lock-file enumeration becomes a second source of truth.

### RQ5 — Which notification channel is real today, and which are provably offline-testable? *(rank 5)*
- **Why it blocks:** R3 says "notify". The shipped default channel is a Windows toast via PowerShell `NotifyIcon`, which **this pass could not observe rendering** (doing so produces a visible desktop side effect). Telegram variable *names* exist on this host but validating them requires an external send, which is forbidden here. So today's honest status is: the routine is **log-capable and dispatch-code-complete**, and **delivery-observable only through the stub/grep-able artefacts**.
- **How the answer changes the design:** fixes the default channel, the fallback contract after two failed attempts (`DELIVERY_FAILED` + `MONITOR_DEGRADED` already exist), and whether the operator is told to read `alerts.jsonl` as the primary surface.
- **Method:** per channel: presence probe, then an offline capability test (loopback sink, stub sender, or file drop). See §5.1 table.
- **Evidence standard:** per channel, either (i) a captured artifact proving delivery without egress (log line, file fragment, stub entry), or (ii) an explicit "not offline-testable" verdict with the reason.
- **Effort:** 1–2 h for the local channels; the external ones cannot be closed here at all.
- **Decision unblocked:** the delivery contract in the runbook, and what "notified" is allowed to mean in a report.

### RQ6 — What exactly does "one status read per operator-local calendar day" mean at the edges? *(rank 6)*
- **Why it blocks:** R1 is enforced by a filename (`<Y-M-D>.lock`), so its correctness is entirely a question of *day-key arithmetic*: DST days have 23/25 hours, `FREECASH_TZ` can be unresolvable (the code then falls back to the machine zone and emits `MONITOR_DEGRADED`), the clock can move backwards, and a scheduler catch-up run can arrive on the next wall-clock day.
- **How the answer changes the design:** decides whether the day-key needs a documented rule for DST/backward clock, whether a catch-up run on the following day is a *second* read (it is not, under a per-day lock — but the operator must be told), and whether `timezone_changed` must block the run rather than merely annotate it.
- **Method:** offline simulation with the pinned-clock seam: run across a DST transition weekend; run with a backward clock; run twice inside one local day; simulate a catch-up arriving the next day; run with an unresolvable `FREECASH_TZ`.
- **Evidence standard:** one lock file and one snapshot per local calendar day, with the alert log showing the expected degradation lines — and **no second status read** in any scenario.
- **Effort:** 3–4 h.
- **Decision unblocked:** the scheduler config and the operator-facing statement of what R1 guarantees.

### RQ7 — What stops an operator-entered figure from producing a false change notification? *(rank 7)*
- **Why it blocks:** the default source is a **hand-edited JSON file**. A mistyped figure, a stale record, a duplicated `day_key`, or a copy-paste of yesterday's line is indistinguishable from a real change, and will fire a notification and enqueue a PENDING approval. Noise here is what teaches an operator to ignore R3.
- **How the answer changes the design:** decides whether `operator_state.py` gains plausibility gates (record older than N hours → `MONITOR_DEGRADED` not `EARNINGS_CHANGED`; delta above a sanity bound → alert instead of notify; duplicate `day_key` → refuse the record; schema validation of every field) and how an entry's confidence is labelled.
- **Method:** offline adversarial-entry matrix against a temp state file: stale `entered_at_utc`; delta of 10 000×; duplicate `day_key`; missing field; string in a cents field; `earnings_total_cents` < previous.
- **Evidence standard:** the alert/notification each input produces (event type, severity, and whether an approval item was created) — the desired behaviour is stated per row before running.
- **Effort:** 2–3 h.
- **Decision unblocked:** whether the operator-entered source is decision-grade or merely indicative.

### RQ8 — Do the artefacts survive: immutability, retention, and the evidence record? *(rank 8)*
- **Why it blocks:** `alerts/alerts.jsonl` is the routine's canonical evidence record and must never be rewritten; `snapshots/` is pruned by `prune_old_artifacts`; `state/day-locks/` grows without bound. If pruning or rotation ever touches the alert log, R3's history is destroyed.
- **How the answer changes the design:** fixes the prune window, whether lock files are compacted, and whether a periodic integrity check (line count only ever increases; snapshot files byte-identical once written) becomes part of the routine.
- **Method:** offline: run N simulated days, assert snapshot immutability, then force the prune path and diff line counts on `alerts.jsonl` before/after.
- **Evidence standard:** before/after line counts and hashes for the alert log and each snapshot.
- **Effort:** 1–2 h.
- **Decision unblocked:** retention policy and whether an integrity check ships.

### RQ9 — Which day-key does the operator actually get? *(rank 9)*
- **Why it blocks:** the day key is the unit R1 counts in. On this host `ZoneInfo("Europe/Berlin")` **resolves** (`zoneinfo` + `tzdata` present in the 3.11.9 interpreter), but the code path for an *unresolvable* zone silently substitutes the machine zone and marks the run degraded. Both currently happen to be the same offset, so a misconfiguration would be invisible while it lasted.
- **How the answer changes the design:** decides whether an unresolvable `FREECASH_TZ` is a hard stop or a documented degradation, and pins the day boundary the operator must reason about.
- **Method:** probe `zoneinfo` availability per interpreter (`python` 3.11.9 vs the `py -3` default 3.14.7 — **the routine must be run with the interpreter that has tzdata**), then run the same instant under both zones.
- **Evidence standard:** the resolved zone, the `timezone_report()` output, and the resulting `day_key` for a chosen instant, on each interpreter.
- **Effort:** 0.5–1 h.
- **Decision unblocked:** the interpreter and TZ policy in the runbook.

### (b) Summary table — method, evidence, effort, decision

| # | Question | Method (short) | Evidence standard (the artifact) | Effort | Decision unblocked |
|---|---|---|---|---|---|
| RQ1 | R3 fires exactly once per change, end to end | Pinned-clock 3-day drive with recording sender | Transcript: change/notification/approval counts agree; `OK_NO_CHANGE` dispatches nothing; dedupe keys written before send | 2–4 h | May the routine be scheduled at all |
| RQ2 | Which provider, and is a read-only GET surface real | Operator confirmation + one redacted read-only call | Written provider/account statement (or provider ToS/robots text for the negative) | 0.5 h + 1 h; 4–8 h if an API exists | Whether the monitor can ever be provider-verified |
| RQ3 | Verifier fails before it is trusted | Per-revision mutation matrix + parse check | Table with ≥1 detected violation and a green baseline on the same md5 | 2–3 h | What evidence R2 may claim |
| RQ4 | Watchdog missed-day signal correct/severity | Offline clock-advance scenarios | Alert-log excerpts + `last-run.json` diff proving no state change | 2–3 h | Whether the missed-day alarm is trustworthy |
| RQ5 | Which channels are real / offline-testable | Presence probe + offline capability test per channel | Captured non-egress artifact per channel, or an explicit "not testable" verdict | 1–2 h locals | The delivery contract; meaning of "notified" |
| RQ6 | R1 semantics at DST / clock-change / catch-up edges | Pinned-clock simulations incl. a DST weekend | One lock + one snapshot per local day; no second read | 3–4 h | Scheduler config; the R1 guarantee text |
| RQ7 | Operator-entered data integrity | Adversarial entry matrix | Per-input event type + severity + whether an approval was created | 2–3 h | Whether the source is decision-grade |
| RQ8 | Artefact immutability and retention | N-day run + forced prune | Before/after line counts and hashes | 1–2 h | Retention policy; integrity check on/off |
| RQ9 | Which day-key the operator gets | zoneinfo probe across interpreters; same instant, two zones | `timezone_report()` + resulting `day_key` per interpreter | 0.5–1 h | Interpreter + TZ policy |

---

## 3. (c) Provider read-only capability research — what `GET`/`HEAD` on allowlisted paths can and cannot obtain

### 3.1 The allowlist that exists today (verified by reading `readonly_client.py`, S2 revision)

```
ALLOWED_METHODS = {"GET", "HEAD"}
ALLOWED_HOSTS   = {"localhost", "127.0.0.1", "::1", "[::1]"}          # loopback only
ALLOWED_PATHS   = (re.compile(r"^/api/v1/status/metrics$"),           # W1 GET
                   re.compile(r"^/api/v1/status$"))                   # W2 HEAD
DEFAULT_BASE_URL = "http://localhost:3001"
BODY_KEYWORDS    = ("data", "json", "files", "body", "content")       # refused on any method
PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
```

**Read ops W3/W4 (provider balance/earnings status, provider account status) are deliberately absent from the allowlist.** Nothing provider-facing is allowlisted, and the placeholder literal is kept verbatim so the gap stays greppable.

### 3.2 Candidate-by-candidate: obtainable with allowlisted `GET`/`HEAD` — and what is not

Every row below is **UNVERIFIED in this pass** unless its "Status this pass" cell says otherwise. This pass made **no** remote request, so no provider response observed here is claimed. Where a prior artifact in this repo recorded a probe, it is cited as prior evidence with its date — not re-asserted as observed.

| Candidate | Read-only endpoint (as documented/asserted elsewhere) | Verb-pure? (no `POST` needed by the monitor) | What a `GET` would yield | Status this pass | UNVERIFIED items (cannot be determined without credentials) |
|---|---|---|---|---|---|
| **freecash.com** (Almedia GmbH) — the platform the routine *thinks* it monitors | **none published.** `/docs`, `/developers` asserted 302→404 | n/a | nothing account-specific | **UNVERIFIED here**; prior artifacts (`PROVIDER-API-RESEARCH.md`, `PROVIDER-FINDINGS-REVERIFIED.md`) recorded live fetches of `/en/policies/terms`, `/robots.txt`, `/docs`, `/developers` on 2026-09-17/18 | Whether any partner/NDA API exists (**UNVERIFIED**, not falsifiable by public research); whether a periodic balance email exists; whether the dashboard offers an export |
| **HG.Cash** | `GET /accounts` (ledger balance, `pendingFees`, `netBalance`, `status ∈ {Operativa, Bloqueada, Cerrada}`, `currency`); `GET /account/{id}/balance` (same fields) | **YES** — dashboard-issued Bearer sent directly on `GET`; no token-exchange call | account status + balance fields in one read | **UNVERIFIED here**; documented in HG.Cash's own OpenAPI per the prior artifacts, with an unauthenticated probe previously recorded as `401` | Rate limits (**UNVERIFIED** — not published); whether this operator holds an account; whether the token can be scoped read-only (**the same token can call `POST /transactions`** per the prior spec reading) |
| **Cashfree Payouts** | `GET /payout/v1/getBalance`, `GET /payout/v1.2/getBalance` → `balance`, `availableBalance` | **NO** — token acquisition requires `POST /payout/v1/authorize` with `X-Client-Id`/`X-Client-Secret` | ledger + available balance | **UNVERIFIED here**; documented paths per prior artifacts; unauthenticated probe previously seen as an **edge-level 403 HTML** page, *not* the documented application JSON | Whether Payouts is entitled for the account (documented gate: `403 "APIs not enabled"`); Get-Balance rate limit; whether the egress IP needs `X-Cf-Signature` |
| **freecash.io** | none — the domain serves no platform | n/a | nothing | **UNVERIFIED here**; prior artifact recorded a 114-byte client-side redirect to a GoDaddy "for sale" lander | nothing to verify — candidate eliminated (a parked domain cannot hold an account) |
| **getfreecash.com** | none — liveness placeholder answering `OK` | n/a | nothing | **UNVERIFIED here**; prior artifact recorded `200` with body `OK` | n/a |
| **parse.bot "freecash.io API" wrapper** | `GET get_leaderboard`, `get_stats`, `get_withdrawals`, … | yes (but pointless) | **public platform-wide data only** — no notion of "your account" (`is_authenticated: false`) | **UNVERIFIED here**; prior artifact recorded its own disclaimer | Cannot yield the monitored account's balance/status by construction; source domain is parked |
| **AgenticOS local metrics substitute** | `GET /api/v1/status/metrics`; `HEAD /api/v1/status` on `http://localhost:3001` | **YES** (the only allowlisted paths) | whatever the local service returns — **not a provider fact** | **VERIFIED this pass, end-to-end, offline**: `RUN_OK 2026-09-21 outcome=INITIAL_BASELINE source=agenticos_local_metrics(data_available=True) … ` with `verbs_seen=['GET','HEAD']` against a loopback stub | Whether anything listens on `localhost:3001` in normal operation (**it does not today**: `curl` → exit 7, HTTP 000) |

### 3.3 What **cannot** be determined without credentials (provider-side, by construction)

1. **Live values** — balance, earnings, pending, account status. No credential ⇒ no values; any number produced without one is fabricated and is forbidden by this workflow's own manifest.
2. **Entitlement** — whether the account is KYC-approved (HG.Cash) or Payouts-enabled (Cashfree). The documented gates cannot be observed from outside.
3. **Rate limits** — undocumented for both HG.Cash and Cashfree Get Balance; only a first authenticated call's headers (or provider support) can close this.
4. **Credential scope** — neither provider publishes a read-only scope. HG.Cash's own documentation, as read in the prior artifacts, describes one user token that can also call the money-leaving endpoint. **Read-only-ness would therefore be enforced by this client's allowlist, not by the credential** — which makes R2's transport guard load-bearing, and makes RQ3 (verifier trust) a security control rather than a nicety.
5. **Whether the monitored account sits on any of these providers at all** — entirely operator-held.

### 3.4 What a `GET` can *never* establish

A `GET` on an allowlisted path proves only that a read happened. It does not prove the value is current, unmodified, or provider-verified. Every snapshot built from the substitute sources is marked `degraded: true` and `source: operator_entered` / `agenticos_local_metrics`, and the notification templates print `Source: DEGRADED (…)`. **A "no change" report must never be presented as provider-confirmed** — this is the single most important honesty constraint in the design.

### 3.5 The concrete, easily-missed consequence of any real integration

Integrating a provider is **not** "add a URL". As the code stands (S2, md5 `778cbe18…`):

1. `ALLOWED_HOSTS` is **loopback-only**, and the `sys.addaudithook` guard aborts any `socket.connect` / `socket.getaddrinfo` whose host is not in it. A provider host must therefore be added to **both** the request-path allowlist and the audit guard.
2. `ALLOWED_PATHS` must gain exactly one regex per read op, with a justification comment.
3. The regression test `test_no_provider_host_is_hardcoded_anywhere` currently asserts that every `http(s)://` host in the routine's module files is in `{localhost, 127.0.0.1}` and that the string `freecash.com` appears nowhere. **That test must be changed deliberately** when a provider path is added — with the change reviewed as a widening of R2, not as a test fix.
4. The credential lives in the Hermes env (`%LOCALAPPDATA%\hermes\.env`), never in `D:/AgenticOS`.
5. The new path must be shown to be read-only by a **mutation test on the pinned revision** (§6), not by reading the diff.

---

## 4. (d) Local-substitute research — what is legitimately monitorable today with zero credentials

### 4.1 The two legitimate zero-credential sources, and both were exercised in this pass

| Source | Module | Mechanism | Zero-credential? | Exercised this pass |
|---|---|---|---|---|
| **Operator-entered daily state file** | `operator_state.py` → `state/operator-state.json` | The operator reads their own dashboard and appends one record per local day (`day_key`, `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`); the routine **reads the file only** | **YES** — the human reads; the automation touches a local file | **YES**: three pinned-clock days produced `INITIAL_BASELINE` → `EARNINGS_CHANGED` (2 changes: earnings + balance) → `OK_NO_CHANGE`, 2 notifications, 2 approval items, `notified-keys.json` entries with `"delivery": "STUB_OK"` |
| **Local metrics substitute (W1/W2)** | `readonly_client.py` | `GET /api/v1/status/metrics` + `HEAD /api/v1/status` on loopback, against a local service | **YES** — no credential; loopback only | **YES**: `RUN_OK … source=agenticos_local_metrics(data_available=True)`, verbs observed `['GET','HEAD']` |

Honest caveat carried from `operator_state.py`'s own docstring and re-observed: a day with **no** record does not fail loudly as an error but produces `outcome=MONITOR_DEGRADED`, a snapshot with null fields, and the message *"nothing is compared and nothing is notified until a reading exists."* That is the correct fail-closed behaviour, but it means **an operator who stops typing gets silence plus a degraded log line, not an alarm** — a design gap worth closing (see RQ4/RQ7).

### 4.2 The exact boundary between the substitute and a real provider integration

**Inside the boundary (legitimate today, zero credentials, no external action):**

1. Reading a local file the **operator** wrote (`state/operator-state.json`).
2. Reading a **loopback** HTTP path, on the two allowlisted regexes only, with `GET`/`HEAD` only, no body, no query params, no other kwargs.
3. Writing and reading the routine's own state under `FREECASH_DATA_ROOT` (`state/`, `snapshots/`, `approvals/`, `alerts/`, `logs/`).
4. Delivering notifications that never leave the machine (`alerts.jsonl`, file drop, the stub sender).

**Outside the boundary (each requires a reviewed, deliberate change — and some are permanently forbidden):**

1. Any request to a **non-loopback host** — blocked twice today (path host check **and** the process-wide audit hook).
2. Any **credential** at all: passwords, session cookies, 2FA codes are refused by design; only provider-issued dashboard tokens from the Hermes env would ever be in scope, and only for a verb-pure `GET` API.
3. Any **verb other than GET/HEAD**, including a webhook delivery or a token-exchange POST.
4. Any **browser automation / scraping** against a rewards platform — rejected on the platform's own terms (its Terms forbid "any robot, spider or other automatic device, process or means… **for any purpose, including monitoring**") and because it puts the monitored account itself at risk.
5. Any **automated earning action** — out of scope permanently under R2 and R4: the approval queue records decisions and nothing in the routine acts on an approved status.

**The boundary in one sentence:** the routine may read *what the human already wrote down* and *what the loopback interface already serves*; everything else is a different, reviewed project.

### 4.3 What the substitute covers, per rule

| Rule | Covered by the substitute? | Gap |
|---|---|---|
| R1 one read/day | **Yes** — day lock is independent of the source | Edge cases per RQ6 |
| R2 zero earning actions | **Yes, trivially** — the source opens no socket (operator file) or only a loopback socket | A widened allowlist would need RQ3's proof |
| R3 notify on change | **Yes, demonstrated** for local logs + stub; delivery to a human surface is RQ5 | Channel reality |
| R4 human approval | **Yes** — items enqueue as `PENDING`/`NOT_EXECUTED` | R4 durability test still red (S2) |

---

## 5. (e) Notification-channel research on this Windows host

### 5.1 Channel matrix with offline-testability verdicts

"Offline-testable" means: can the channel be proven to work with **no egress, no credential, and no irreversible side effect outside a temp data root**, on this machine, today.

| Channel | Mechanism actually present | Offline-testable? | Verdict + evidence |
|---|---|---|---|
| **stdout / run transcript** | `run_daily_check.py` prints one summary line | **YES** | **PROVEN this pass**: `RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) …`, `SKIP_DUPLICATE_DAY 2026-09-20`, `REFUSED_FORCE_RECHECK …`, `WARNING timezone_unavailable …` |
| **append-only alert log** `alerts/alerts.jsonl` | `notify.alert()` → `paths.append_jsonl()` (single `O_APPEND` write; the file is never rewritten) | **YES** | **PROVEN this pass**: 6 lines written across the drive including `INITIAL_BASELINE|info`, `EARNINGS_CHANGED|notify`, `BALANCE_CHANGED|notify`, `APPROVAL_PENDING|notify`, `OK_NO_CHANGE|info`. **This is the canonical evidence record and the only channel with no dependency at all.** |
| **file drop** | Any file the routine writes into the data root (`logs/toast-stub.log`, `snapshots/<day>.json`) can be watched by an external tool | **YES** | **PROVEN this pass**: `logs/toast-stub.log` contained `[STUB TOAST 2026-09-19T06:45:00Z] [FreeCash] EARNINGS CHANGE …` |
| **Windows toast — stub sender** (`FREECASH_TOAST_STUB=1`) | `notify._stub_send` writes the fragment above; delivery label `STUB_OK`, **never** `TOAST_OK` by design | **YES** | **PROVEN**: `notified-keys.json` shows `"delivery": "STUB_OK"` for both change keys |
| **Windows toast — real sender** | `notify._toast_send` → `powershell -NoProfile -NonInteractive -Command` with `System.Windows.Forms.NotifyIcon` / `ShowBalloonTip(20000)`; PowerShell 5.1.26100.9444 present | **NO** | **Not offline-verifiable**: it requires an interactive desktop session and produces a visible, non-reversible UI side effect; it also appears as a Windows "PowerShell" balloon, not a branded toast. **UNVERIFIED that it renders at all on this host.** Achieving a strong verdict needs a single consented visual confirmation by the operator. |
| **SMTP email** | `smtplib` present in the 3.11.9 interpreter; `python -m smtpd` sink available (deprecated); **`notify.py` contains no SMTP code** (the module docstring says "SMTP opt-in and OFF by default; not wired to any credential here"), and no `SMTP*`/`MAIL*`/`IMAP*` name exists in the Hermes env | **PARTIAL** | **Loopback-testable only after it is implemented** (a local sink at `127.0.0.1:<port>`); a real send is external egress and is **not** testable here. **Verdict: unavailable today.** |
| **Webhook** | None in the routine. A webhook is an **outbound POST**, and the routine's single socket site is `GET`/`HEAD` + loopback only | **NO (as designed)** | A webhook cannot be delivered by the routine without widening R2 (method + host allowlists). A loopback HTTP *listener* is trivially offline-testable (the test suite already stands one up), but the routine has **no code path that calls it**. **Verdict: incompatible with R2 as currently enforced; needs an explicit reviewed exemption if ever wanted.** |
| **Telegram push** | Variable **names** present in `%LOCALAPPDATA%\hermes\.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HOME_CHANNEL`, `TELEGRAM_ALLOWED_USERS` (names only were read) | **NO** | External egress; validating the token requires sending a message, which this pass is forbidden to do. **Values UNVERIFIED**; `NTFY*`, `SLACK*`, `SMTP*`, `MAIL*`, `IMAP*` names are **absent**. |
| **Windows Event Log** | `eventcreate` and `msg` binaries present | **PARTIAL** | Local and testable, but it writes into the system log — a side effect outside the routine's data root, and not something the routine currently does. **UNVERIFIED / not adopted.** |
| **SMS, Slack, ntfy** | No credential or module present | **NO** | Not available; would add a new secret. |

### 5.2 The verdict the design must adopt

Only **stdout, `alerts/alerts.jsonl`, and a file drop** are zero-credential, zero-egress and offline-provable on this host today. The toast is the designed default but its real sender is **unproven**; every other channel is either unimplemented, incompatible with R2, or requires forbidden external egress.

**Therefore:** the runbook must state that `alerts/alerts.jsonl` is the **primary** operator surface today, that a `MONITOR_DEGRADED` line after two failed dispatches means "this message exists only in the log — read the log", and that "notified" in any report means *"written to the alert log and dispatched to the configured channel with label X"*, never *"the operator has seen it"*.

---

## 6. (f) Research on verifier trust — proving a verifier FAILS before trusting its PASS

### 6.1 The precedent, re-confirmed live in this pass

`server/scripts/verify-freecash-rules.mjs` (3 034 bytes) prints `[OK] All 4 operational rules verified (4/4 passed)` and exits 0 — while the file it certifies **does not parse**:

- `node server/scripts/verify-freecash-rules.mjs` → `✓ Rule 1..4 → PASSED`, `[OK] All 4 operational rules verified (4/4 passed)`, **exit 0**
- `node --check server/scripts/freecash-daily-monitor.mjs` → **`SyntaxError: Unexpected token ':'` at line 41**, exit 1 (node v24.20.0)

Why it cannot go red (read from source, not inferred):

- Rule 3 is `!content.includes('checkForChanges') || content.includes('.log(')` — satisfied unless the string is present *and* `.log(` is absent; effectively a tautology for any file containing a log call.
- Rule 4 is `!content.includes('requiresApproval') && content.includes('prepareActionRequests') || content.includes('approval-request.json')` — precedence makes it `(A && B) || C`, so the final disjunct alone satisfies it.
- Rules 1/2/4 are **substring presence tests**; nothing is parsed, executed or traced. The file's exit code is 0 on both branches (no `process.exit(nonzero)` anywhere).
- Prior repo evidence records the same verifier returning `4/4 passed` on a byte-identical copy into which a **real earning action** (`fetch("https://api.freecash.com/v1/withdraw", {method:"POST"})`) had been appended — see `docs/freecash-monitor-audit-evidence.md` §2b (mutation A2).

**Rule derived from this:** *a green check that has never been observed to go red is evidence of nothing.* Treat a PASS as an untested hypothesis until the verifier has failed on a known violation.

### 6.2 The current checker, mutation-tested this pass (both checkers, isolated temp copies)

Method: `cp -r monitoring/freecash <temp>/<case>` (caches stripped), append **one** planted line, run **both** checkers, record exit codes. Reproduce with the commands in §8.

| # | Planted violation (one line, isolated copy) | Expected | Shell checker | `verify_readonly.py` | Verdict |
|---|---|---|---|---|---|
| 0 | *(baseline, unmutated)* | PASS | exit 0 | exit 0 | **correct** |
| 1 | `socket.create_connection(("api.provider.example", 443))` | FAIL (an outbound connection to a provider host) | **exit 0** | **exit 0** | **BLIND SPOT — not detected** |
| 2 | `smtplib.SMTP("smtp.example.net", 25).sendmail(…)` | FAIL (outbound egress) | **exit 0** | **exit 0** | **BLIND SPOT — not detected** |
| 3 | `ACTION = "claim_reward"  # readonly-exempt: looks harmless` | FAIL (a real earning-action name) | **exit 0** | **exit 0** | **BLIND SPOT — the exemption marker defeats the check on a line that names an executable earning action** |
| 4 | `BASE = "https://api.provider.example/v1"` | FAIL (a provider host hardcoded in the routine) | **exit 0** | **exit 0** | **BLIND SPOT — hostnames are not checked at all** |
| 5 | `def broken(:` (a file that cannot parse) | FAIL | **exit 0** | **exit 0** | **BLIND SPOT — the scanner never parses** (the exact defect class of §6.1) |
| 6 | `Invoke-RestMethod -Uri https://api.provider.example/x -Method Post` | FAIL | exit 1 | exit 1 | **detected** — but only incidentally, by the literal word `POST` |
| 7 | `urllib.request.Request(…, method="POST")` | FAIL | exit 1 | exit 1 | **detected** (word `POST`) |
| 8 | `from http.client import HTTPConnection` | FAIL | exit 1 | exit 1 | **detected** |
| 9 | `x = "withdraw"` | FAIL | exit 1 | exit 1 | **detected** (prose-only, i.e. a false-positive-prone word match) |

**Conclusions (all observed, not inferred):**

1. The two checkers **agree in every case** — the Python port is a faithful port *as of this revision*, which is itself a property worth re-testing whenever either changes.
2. The checker is a **token scanner, not a capability prover**. It detects literal verbs and named write-shapes; it does **not** detect the two capabilities that matter most in this design — an outbound socket to a provider host (row 1) and outbound mail (row 2).
3. **A `# readonly-exempt:` marker fully disables the check on that line** (row 3), and the exemption count is a blind-spot budget. At S2 it is **28** exemptions (up from 27 at S1 inside the same hour). Under the design's own intent, a marker is defensible only on a line that must *name* a forbidden token (the scanner's own pattern table, a negative-control test); it is **not** defensible on a line that could execute.
4. Nothing here proves the routine *is* read-only in the runtime sense. The stronger R2 evidence is the **runtime** refusal set, which is green: `test_every_non_read_method_is_refused`, `test_body_carrying_get_is_refused`, `test_non_allowlisted_path_is_refused`, `test_non_loopback_host_is_refused`, `test_write_method_is_refused_before_any_socket_opens`, `test_audit_guard_refuses_a_non_loopback_connect` — all `ok` at S2.

### 6.3 The protocol this project should adopt (the deliverable of RQ3)

1. **Parse before you assert.** Any verifier whose inputs are source text must first parse them (`ast.parse` for Python, `node --check` for JS) and fail if parsing fails. A checker that certifies a non-parsing file has already happened here.
2. **Two controls per revision, always:** a **negative control** (unmutated tree → PASS) and a **positive control** (planted violation → FAIL). A checker run without a positive control on the same revision yields no information.
3. **Mutation set minimum** for R2: a write verb; a body-carrying request; a non-allowlisted path; a non-loopback host; a raw socket; an outbound mail call; a hardcoded provider hostname; a non-parsing file; and an earning-action name *with* an exemption marker. Rows 1, 2, 4, 5, 3 above must all go **red** before the checker counts.
4. **Exit-code contract:** `0` pass; `1` violation; `2` **a target did not exist — a failure, never a pass** (the current checkers already do this correctly and the test `test_missing_target_is_not_a_pass` is green: observed `[verify_readonly] FAIL - target path did not exist; absence of evidence is not evidence of a read-only routine.`). *("README" prose that says "exit 2 = not a failure" must be corrected wherever it appears.)*
5. **Track the exemption count as a metric** in every report (`exempt=28` at S2), and require each new marker to name *why* the line cannot execute.
6. **Behaviour beats text where it is affordable:** prefer a test that asserts a refusal (the transport guard and the audit hook) over a test that greps for a string.
7. **Never let the two checkers diverge silently:** keep the parity test (`test_python_port_agrees_with_the_shell_checker`) green, and make it assert on **both** the exit code and the hit count on a mutated copy.

### 6.4 Revision pinning (mandatory, because of the drift observed in §1.1)

Every verifier verdict must be recorded as `(verdict, exit code, md5 of every file in the scanned tree, timestamp, command)`. Without the md5, a PASS from 06:57 and a FAIL from 06:58 look like a contradiction instead of a revision change. Two facts observed this pass make this non-optional: the routine was edited mid-measurement, and the edit changed the checker verdict from `forbidden=2`/exit 1 to `forbidden=0`/exit 0.

---

## 7. (g) The three highest-value research options

"Time-to-Revenue" is stated honestly: this routine **earns nothing by design** (zero automated earning actions; nothing executes on an approval). Its revenue function is *protection* — of the monitored balance and of any unredeemed rewards — plus the removal of unverifiable compliance claims. So the metric below is **time until the option converts into an operator-usable, decision-grade capability**, not income.

### Option A — Prove the R3 notify path end to end on the operator-entered source (RQ1 + RQ4 + RQ5-local)
- **Expected Effort:** 4–6 h (RQ1 2–4 h, RQ4 2 h; the two local channels are already proven).
- **Time-to-Revenue:** **immediate on completion** — this is the only option that makes the routine *worth running* with zero external dependencies. Until it lands, the monitor is a logger, not a notifier.
- **Dependencies:** none external; `python` 3.11.9; a temp `FREECASH_DATA_ROOT`; one operator-entered record per day; a decision on the real channel (or an explicit "log is the channel" statement).
- **First Concrete Action:** re-pin the revision (md5s of `monitoring/freecash/*.py`), then run the three-day pinned-clock drive with a recording sender and publish the transcript next to the md5s — reproducing §5.2's demonstration plus the four still-red assertions (`test_earnings_change_notifies_exactly_once`, `test_pending_item_survives_a_ninety_day_clock_advance`, `test_delivery_failure_is_bounded_and_keeps_the_full_message`, `test_missing_check_raises_one_alarm_and_changes_no_state`).

### Option B — Verifier-trust hardening: make the R2 gate fail on a known violation, then pin it (RQ3)
- **Expected Effort:** 3–5 h (parse step 1 h; mutation gate 1–2 h; exit-code + marker policy and the §6.2 rows 1/2/3/4/5 close 1–2 h).
- **Time-to-Revenue:** proportional to risk, not to income — it is what allows the claim "no automated earning action exists" to be *evidence* rather than assertion. It also protects the asset: this repo has already produced one false `4/4 PASSED`.
- **Dependencies:** `node` v24.20.0 (for `node --check` and for the legacy verifier's negative control), Python `ast`, and the agreement to treat the static checker as necessary-but-not-sufficient.
- **First Concrete Action:** turn the §6.2 matrix into a repeatable script that (i) parses every scanned file, (ii) plants rows 1–5 into isolated temp copies, (iii) **fails the gate if any planted violation passes**, and (iv) prints `verdict + exit code + md5 set + timestamp` for the report.

### Option C — Close or kill the provider question (RQ2)
- **Expected Effort:** 0.5 h of operator time to answer; 1 h to record and reconcile; 4–8 h of integration **only if** the answer names a verb-pure `GET` API (HG.Cash-shaped), and 0 h if the answer is "no API exists" (close W3/W4 as UNRESOLVABLE).
- **Time-to-Revenue:** the longest and the least controllable — it depends on a KYC/entitlement queue and on one operator statement. Do not sequence anything else behind it.
- **Dependencies:** operator confirmation of provider **and** account; if an API exists: a dashboard-issued token stored only in `%LOCALAPPDATA%\hermes\.env`, plus the reviewed widening of `ALLOWED_HOSTS`/`ALLOWED_PATHS` (§3.5) and a passing mutation gate (Option B) *before* the path is allowlisted.
- **First Concrete Action:** send the operator the single blocking question — *which provider and which account holds the monitored balance, and does that provider dashboard offer an API token?* — and record the answer verbatim in the routine's docs; in parallel, verify that the negative branch is written down (the freecash.com case is closed by the platform's own Terms and `robots.txt`, both already fetched and quoted in the prior artifacts).

**Sequencing:** A (makes the monitor real) → B (makes the claim honest) → C (makes the data real, when the operator answers). C must not block A or B.

---

## 8. Reconciliation with existing artifacts (do not duplicate — read and extend)

| Artifact | What it already establishes | What this plan adds |
|---|---|---|
| `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md` | Verdict **NOT AVAILABLE**; repo-local evidence table; alternatives matrix | Reconciles it into a per-endpoint capability table with explicit UNVERIFIED marking (§3) |
| `docs/free-cash-monitor-routine/PROVIDER-CONTRACT-RESEARCH-V2.md` | VERIFIED/UNKNOWN/DEPRECATED register (40 rows); options A–G with effort; exit criteria for the provider blocker | Adds the *mechanical* consequence of any provider binding: `ALLOWED_HOSTS` is loopback-only and the audit hook blocks it (§3.5) — the piece that turns "add a URL" into a reviewed R2 widening |
| `docs/free-cash-monitor-routine/PROVIDER-FINDINGS-REVERIFIED.md` | Live re-verification of ToS/robots/docs; notification-channel presence table (Q6); scheduler comparison (Q7) | Reconciles the channel table with **offline-testability verdicts measured this pass** (§5.1) and adds the scheduler/sleep edge to RQ6 |
| `.../optional-skills/serverops/automated-status-monitor/references/api-compliance.md` | Asserts a FreeCash.io `X-API-Key` read-only API | **Must not be trusted**: the prior artifacts record that `freecash.io` is a parked GoDaddy domain and that `X-API-Key` is the wrapper's key. The skill also asserts `GET /withdrawals` is "Rule 1 compliant"; **UNVERIFIED and contradicted** |
| `docs/free-cash-monitor-routine/IMPLEMENTATION-PLAN-V3.md` | Names verification rot as risk #8; asks for a parsing, mutation-proven verifier | Supplies the measured mutation matrix (§6.2) that shows *where* the current checker is blind |
| `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` | The design contract; W3/W4 left as `PROVIDER_ENDPOINT_UNKNOWN` | Leaves the contract untouched; treats W3/W4 as the open item RQ2 closes or kills |
| `docs/free-cash-monitor-routine/DELEGATED-WORKFLOW-PLAN.md` | States the verifier rule ("a verifier must be shown to FAIL on a known violation before it is trusted") | Operationalises it into the protocol + matrix of §6 |

---

## 9. UNVERIFIED register (explicit; nothing below is asserted)

1. **Every provider endpoint in §3.2 is UNVERIFIED in this pass** — no remote request was made. The rows carry prior-artifact provenance, not fresh observation.
2. `GET /payout/v1/getBalance` applicability-response and Cashfree entitlement — **UNVERIFIED**; the prior unauthenticated probe returned an edge-level 403 HTML page, *not* the documented application JSON, so even application-level liveness is unproven.
3. HG.Cash and Cashfree **rate limits** — **UNVERIFIED**, undocumented publicly.
4. Whether this operator holds **any** account on HG.Cash / Cashfree / freecash.com — **UNVERIFIED**, operator-held.
5. Whether freecash.com sends periodic balance/status **email** or offers a statement/export — **UNVERIFIED**.
6. Whether any freecash.com read API exists under private contract — **UNVERIFIED** and not publicly falsifiable.
7. Whether the **real Windows toast renders** on this host — **UNVERIFIED**; the stub path is proven, the real path was not exercised (it is a visible desktop side effect).
8. Validity of `TELEGRAM_BOT_TOKEN` / `TELEGRAM_HOME_CHANNEL` — **UNVERIFIED**; only the variable *names* were observed, and validating them requires an external send.
9. Whether `StartWhenAvailable` actually catches up a plain daily trigger, and whether the active power plan permits wake timers — **UNVERIFIED** here (documentation restricts catch-up to tasks "with an end boundary or … repeat infinitely"; checking needs a created task / elevation).
10. Whether `%LOCALAPPDATA%\hermes\.env` values are usable by any future notifier — **UNVERIFIED** (names only were read; no value was printed, stored or transmitted).
11. Whether the routine's `python` interpreter is the one that will run in production (3.11.9 has `tzdata`; the `py -3` default is 3.14.7) — **UNVERIFIED**; **`python3` on this host is a broken Windows Store stub** (exit 49, "Python wurde nicht gefunden").
12. Whether any snapshot from a real run exists — **UNVERIFIED/none**: the default data root `D:/AgenticOS/data/freecash-monitor` is **ABSENT**.
13. The exact behaviour of the routine's own reporters under a **concurrent edit** of its source (§1.1) — **UNVERIFIED**; observed only as verdict drift inside one hour.

---

## 10. Reproduce-everything appendix (read-only; all temp writes under `$LOCALAPPDATA/Temp`)

```bash
# 0. revision pin
cd /d/AgenticOS && md5sum monitoring/freecash/*.py

# 1. suite + both static checkers, on a throwaway data root
export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fcv4/r" FREECASH_TOAST_STUB=1 \
       FREECASH_TOAST_RETRY_SLEEP_SECONDS=0 FREECASH_TZ=Europe/Berlin
rm -rf "$FREECASH_DATA_ROOT"; python monitoring/freecash/tests/run_all.py; echo "suite_exit=$?"
bash docs/free-cash-monitor-routine/verify-readonly.sh; echo "shell_exit=$?"
python monitoring/freecash/verify_readonly.py; echo "py_exit=$?"

# 2. the legacy false verifier + the file it certifies
node server/scripts/verify-freecash-rules.mjs; echo "exit=$?"      # 4/4 PASSED, exit 0
node --check server/scripts/freecash-daily-monitor.mjs; echo "exit=$?"  # SyntaxError :41, exit 1

# 3. verifier mutation matrix (per-case isolated copy; see §6.2 for the payloads)
M="$LOCALAPPDATA/Temp/fcv4/mut"; rm -rf "$M"; mkdir -p "$M"
for c in baseline m_socket m_smtp m_marker m_host m_syntax m_powershell; do
  cp -r monitoring/freecash "$M/$c"; rm -rf "$M/$c/__pycache__" "$M/$c/tests/__pycache__"
  # append the one planted line for that case, then:
  bash docs/free-cash-monitor-routine/verify-readonly.sh "$M/$c" >/dev/null 2>&1; echo "$c shell=$?"
  python monitoring/freecash/verify_readonly.py "$M/$c" >/dev/null 2>&1;      echo "$c py=$?"
done

# 4. R1/R3 live behaviour, three pinned-clock days (driver in the pass transcript)
#    run_daily_check.run([], now=<ISO instant>) with a temp FREECASH_DATA_ROOT

# 5. local-metrics substitute over the wire (loopback stub, verbs recorded)
#    run_daily_check.run(["--source","metrics_http","--base-url","http://127.0.0.1:<port>"], now=…)

# 6. host capability probes (no egress, no credential)
curl -sS -o /dev/null -w 'code=%{http_code}\n' --max-time 5 http://localhost:3001/api/v1/status/metrics   # exit 7
command -v python3; python --version; node --version; command -v crontab || echo CRONTAB_ABSENT
schtasks /Query /TN FreeCashDailyCheck; grep -oiE '^(TELEGRAM|NTFY|SLACK|SMTP|MAIL|IMAP)[A-Z0-9_]*' "$LOCALAPPDATA/hermes/.env" | sort -u
```

---

### Closing statement of the design position

Today the routine is a **credential-free, loopback-only, operator-fed monitor**: it reads a file the human wrote, gates itself with an atomic day lock, diffs against the prior snapshot, writes an append-only evidence log, notifies through a channel whose only proven delivery is that log, and records approval items that **nothing executes**. Its provider integration is not merely missing — it is *blocked twice over* (by the transport allowlist and by the audited socket guard) and cannot be added without a reviewed widening plus a mutation-proven verifier. Its most valuable open item is therefore not the provider: it is **proving the notify path end to end on the source it already has**, while making the compliance claim honest by showing the verifier can go red.

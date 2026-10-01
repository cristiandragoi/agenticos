# RESEARCH PLAN — Daily Status-Monitoring Routine, Free Cash Finance Automation

**Delegation:** DELEGATION-2026-10-01-R3 · track: research
**Repository:** `D:\AgenticOS` · host Windows 11 · shell git-bash (MSYS) · non-elevated
**Written:** 2026-10-01, 09:26–09:29 operator-local (`date` → `Do,  1. Okt 2026 09:26:20`, Europe/Berlin, UTC+02:00)
**Subject:** what must be known before/while building the daily status-monitoring routine for Free Cash Finance Automation, under its four operational rules.
**Canonical implementation under study:** `D:\AgenticOS\monitoring\freecash\` (entry `run_daily_check.py`; `gate.py`, `readonly_client.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `watchdog.py`, `operator_state.py`, `paths.py`, `verify_readonly.py`). Production state root `D:\AgenticOS\data\freecash-monitor\`.
**Footprint:** this file is **new and additive**. No existing file edited, moved, renamed or deleted. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created or modified. No provider network call, no credential, no token. Every routine-related command in this pass was read-only (`cat`, `ls`, `wc`, `grep`, `python -c`, `node --check`, `curl` GET, `schtasks /Query`).

---

## A. Method and evidence standard

**Method.** One pass, 09:26–09:29 local. Every factual row carries the command executed in *this* pass and its observed result; anything taken from a document is labelled `inherited`. No PASS quoted from an earlier session is treated as live evidence. Row IDs below are `A#` (state), `X#` (parallel-implementation audit), `N#` (network/scheduler), `I#` (incident). Where this pass contradicts the parent brief, the row says so and the contradiction is listed in Appendix Z.

**Evidence standard.**
1. A claim without an in-session command + observed output + exit code is `unknown`, not a fact.
2. A `404` from an endpoint is a finding and is quoted as such (N4).
3. A zero-row count, a `000` curl code and an empty directory are evidence of absence and are quoted with their command.
4. Any run against the production root requires a scratch `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp` **and** pinned `AGENTICOS_DATA_DIR` + `AGENT_TEAMS_DB_PATH` (A15 — the session env exports `AGENT_TEAMS_DB_PATH=C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\agentic-os.db`); hermeticity is proven by a `sha256sum` pair and a `find … -newermt` set that is unchanged. No routine run was performed in this pass (A9), so the hermeticity proof is a requirement on the *next* pass, not a result of this one.
5. Rule numbers are **never** cited bare. Every reference prints the title beside the number, because the shipped docstrings invert the brief's ordering (see §A.1).

### A.1 The two rule numberings — both stated, always titled

| Title | **Brief numbering** (this document uses this) | **Shipped-code docstring numbering** |
|---|---|---|
| at most one status read per Europe/Berlin calendar day | **Rule 1 (once-per-day check)** | `gate.py:1` → "**R1**: exactly one status read per operator-local calendar day" |
| zero earning/withdrawal/transaction actions; read-only transport only | **Rule 2 (zero automated earning actions)** | `readonly_client.py:1` → "**R2**: the routine's ONLY network path" |
| notify on earnings/status change, exactly once, deduplicated | **Rule 3 (notify on earnings/status changes)** | not comment-tagged in a single file |
| explicit named-human approval; no execution path exists | **Rule 4 (human approval before any external action)** | `run_daily_check.py:1` → "the routine's single entry point (rules R1-R4)" |

Verified today: `head -8 monitoring/freecash/gate.py` → first line `"""gate.py -- R1: exactly one status read per operator-local calendar day.`; `head -8 monitoring/freecash/readonly_client.py` → first line `"""readonly_client.py -- R2: the routine's ONLY network path.`. **Consequence for every later document: a bare "R1" is ambiguous between "once-per-day" and "exactly one status read per operator-local calendar day" only in wording, but a bare "R2" is ambiguous between "zero earning actions" (brief) and "the only network path" (code) — print the title.**

### A.2 What CANNOT be known in this session (explicit, not hedged)

Five facts are **structurally unreachable** from a non-interactive, credential-free shell, and no amount of further probing in this session changes that:

1. **The real account figures.** `operator-state.json.records = []` (A7) and the live DB has no reading either. The single canonical source that works today contains nothing; the account status, earnings total, balance and pending amount are knowable only by a human logging into their own dashboard and typing them in.
2. **Whether a provider read API exists and what it returns.** The live DB `provider_credentials` table has **2 rows** (A14 — see Appendix Z; the repo DB has 0) but no value may be read or used, and Rule 2 forbids the POST-minted token any such read might require. An unauthenticated GET can prove an endpoint is *routable* (404/401/403) but never what it *returns*.
3. **The shape and liveness of the app-side bridged read (Path B).** `checkAuthenticatedSession()` and `startInteractiveLogin()` exist in `server/src/services/freeCash/freeCashExecutor.ts` and are wired to HTTP routes (A11), but the desktop shell is **not running** (`tasklist | grep -ic electron` = 0, A12) and the managed browser profile is unauthenticated. A live session requires a human to start the app and log in.
4. **Which state root production writes to, and by what precedence.** All three roots exist (A8) and the deciding code path has not been traced to a single winner this pass (§G).
5. **Whether the provider's terms permit automated read.** That is a document/contract question that needs an account, not a shell.

Stated plainly: **the routine has run but has never obtained a figure, and nothing in this session can obtain one.** Every research question below is therefore about (a) making a reading possible, (b) making the already-proven mechanisms honest, or (c) deciding between options a human must own.

---

## B. Prioritised research-question register

Priority P0 = blocks a real reading or actively hides truth; P1 = correctness of an already-running mechanism; P2 = decision support.

| ID | Question | Rule(s) served | Verified TODAY (command → result) | Method / probe to answer | Evidence demanded (exact command → pass shape) | Falsifier (what KILLS the option) | Verdict |
|---|---|---|---|---|---|---|---|
| **RQ-01** | Which single read path can actually produce a figure, and what is its minimal build? | Rule 1 (once-per-day); Rule 2 (zero earning actions) | A7: `cat state/operator-state.json` → `"records": []` (only a template); A4: `cat snapshots/2026-10-01.json` → `data_available:false`, figures `null` | Operator-entered record (works now) vs Path B bridged app read; compare in §C | A day-1 run on a scratch root yields `RUN_OK … outcome=INITIAL_BASELINE` and a snapshot with `data_available:true` | If the operator will not type four figures and will not start the app, **every** read source is dead and only `MONITOR_DEGRADED` is producible | available (operator-entered) / blocked (Path B) |
| **RQ-02** | Why does a run that read nothing book `last_success_day` = today and reset the miss counter to 0? | Rule 1 (truthful day accounting) | A3: `cat state/last-run.json` → `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0` (was 9); `inherited` V10 A19: `gate.py:32-40` has `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES`, `gate.py:198` advances success on that outcome | Trace `gate.py` success/coverage logic and `watchdog.py:33`; write the failing test first | `python monitoring/freecash/tests/run_all.py` on a scratch root after the change → a `data_available=False` run leaves `day-locks/` empty, `last_success_day` unchanged, miss counter preserved | If "ran" is allowed to stay equal to "read", the watchdog is permanently blind — kills any claim the monitor is trustworthy | available |
| **RQ-03** | Is the acceptance gate green, and is it green for the *right* reason? | all four | A16: `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py` → `SUMMARY: R1=FAIL R2=PASS R3=PASS R4=PASS`, `VERDICT: NOT COMPLIANT -- 1/4`, exit **1**; `… --package` → `error: unrecognized arguments: --package`, exit **2** | Port package-scope detectors into the shipped verifier; re-run the mutation harness until the mutant set is closed | gate prints `R1=R2=R3=R4=PASS` **and** exits non-zero on every harness mutant | If a `--package` mode is added but 3/10 mutants still survive (V10 A15), "COMPLIANT" is a statement about the detector, not the package — kills the verdict | available |
| **RQ-04** | Does `verify-freecash-rules.mjs` certify a file that does not parse? | all four | A13: `node server/scripts/verify-freecash-rules.mjs` → `[OK] All 4 operational rules verified (4/4 passed)`, exit **0**; A13b: `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError … line 41 function isDailyCheckAllowed(): boolean`, exit **1** | Read the verifier's parse step; it must fail when its target fails `node --check` | verifier exits non-zero when run against a target with a syntax error | If the verifier never parses its target, its 4/4 is permanently false — kills its use as evidence | available |
| **RQ-05** | Who or what invoked the 08:53:46 run? | Rule 1; Rule 3 | A5: `wc -l alerts/alerts.jsonl` → **15**; last line `ts_utc=2026-10-01T06:53:46Z`, `event_type=MONITOR_DEGRADED`; A5b: `grep -o '"writer"[^,]*' alerts.jsonl` → **no match** (exit 1, zero lines carry a writer key) | Correlate the lock mtime, the log files, `schtasks /Query /V`, and any parent-process trace; then add a writer tag | A new alert line carries `pid`+`entry point`+`start time`, and the 08:53:46 origin is named or formally recorded as unattributable | If the writer stays unidentifiable, no future run can be trusted to be the *only* run — kills unattended operation | unknown |
| **RQ-06** | Which of the three state roots does production actually use? | Rule 1 (day key); Rule 3 (dedupe) | A8: `find data/freecash data/freecash-monitor server/data/freecash-monitor -maxdepth 3` → all three exist; `server/data/freecash-monitor/` holds only `README.md` + `INTEGRATION_STATUS.md` | Trace `paths.py` resolution + env precedence; run the settling experiment (§G) | A single pinned root, quoted from `paths.py`, plus a scratch run that writes only there | If two roots can silently diverge, the day-lock in one is invisible to the other — kills the "exactly one read/day" guarantee | unknown |
| **RQ-07** | Is there any read-only provider endpoint, unauthenticated, that returns account data? | Rule 2 (read-only); Rule 1 | A10/N4: `curl -m5 localhost:4600/api/v1/status/metrics` → `{"error":{"code":"NOT_FOUND",...}}`, HTTP **404**; live `provider_credentials` = 2 rows (A14) but unusable under Rule 2 | Probe candidate provider hosts unauthenticated (expect 401/403/404); read public API docs | An unauthenticated GET returns a documented, non-null account payload **without** a token | If the only read path needs a POST-minted token, the option is refused by Rule 2 — record as option-level falsifier, do not try | blocked |
| **RQ-08** | What sink, if any, can deliver a change notification beyond the toast? | Rule 3 (notify once) | A17: `env | grep -Ei 'SMTP|WEBHOOK|FREECASH'` → only `AGENT_TEAMS_DB_PATH`, `AGENTICOS_DATA_DIR` present; **no SMTP/WEBHOOK**; A17b: `notify.py:152` implements only a toast/stub (`TOAST_OK`/`STUB_OK`) | Inventory installed mail/webhook tooling; decide whether to build one | One real toast delivered with a recorded label; for email/SMS, a configured transport + a delivered message | No credential and no tooling ⇒ email/SMS/webhook cannot be built this session — kills those options until a sink is provisioned | toast available / email·SMS·webhook blocked |
| **RQ-09** | Can the routine be scheduled safely, on which mechanism, with which interpreter? | Rule 1; Rule 3 | N1: `schtasks /Query /FO CSV /NH | wc -l` → **278**, `grep -ic freecash` → **0**; N2: `hermes cron list` → `No scheduled jobs.`; A18: `python -c "import tzdata"` → 3.11.9 with `tzdata 2025.3` (a system interpreter lacking tzdata degrades the day key → `MONITOR_DEGRADED`) | Compare Task Scheduler / hermes cron / in-app `scheduler.js`; escape the XML `&`; pin the 3.11.9 interpreter | `ET.parse` exit 0 on each payload + the non-elevated `schtasks /Create /XML` text handed over (not executed) | If any mechanism launches a data-less run that spends the day (RQ-02 unfixed), scheduling multiplies the harm — kills registration | available (research) / blocked (registration) |
| **RQ-10** | What exactly did the 2026-09-30 and 2026-10-01 runs do? | Rule 1; Rule 3 | A3/A4/A5: three locks (`2026-09-20`, `2026-09-30`, `2026-10-01`); today's snapshot null; alert line 15 `MONITOR_DEGRADED`; `last_success_day` advanced; miss counter reset 9→0 | Read the alert log chronologically + snapshot set; reconstruct the sequence | A timeline naming each run's day_key, whether a read occurred, and each ledger field it wrote | If the sequence cannot be reconstructed from the log alone, the log is not a sufficient audit record — kills its use as the compliance artefact | available |
| **RQ-11** | Does any parallel implementation enforce a rule it claims to? | all four | X1: `python -m py_compile finance-monitor/src/rule_engine.py` → `SyntaxError line 122`; X2: `grep -n "def main\|main()" scripts/monitoring/free-cash-daily-check.py` → only `225:def main():` (never called → exit 0, no output); X3: `grep -n "parents\[" scripts/make_freecash_check.py` → `8:BASE = …parents[2]` (resolves to `D:\data\freecash`, an off-by-one); X4: `server/src/adapters/freecashMonitorAdapter.ts:206` → `externalConnected: false` hardcoded, and the adapter is **absent** from `runtimeRegistry` in `server/src/index.ts` (which registers Hermes/Jarvis/Codex/Video/HeavyGen only) | Static audit + one import/parse attempt each; label DEPRECATED, never reuse | Each parallel file has a named defect + a gate command; the index exists | If any parallel file is treated as authority, a non-parsing or no-op implementation can be cited as compliant — kills the "one implementation per job" rule | available |
| **RQ-12** | What is the R4 approval queue's real behaviour with zero items? | Rule 4 | A6: `ls -la approvals/` → empty; `approval_queue.py` guard is `inherited` as a denylist at `:55`,`:153` (V10 A18) | Enqueue one synthetic item on a scratch root as a named human; attempt a machine decider | One named-human decision quoted with `execution_state` staying `NOT_EXECUTED`; a machine-labelled decider refused | If the guard is a bypassable denylist, "human approval" is unproven provenance — kills the R4 claim (not the queue) | unknown |
| **RQ-13** | Does the shipped `--package` gate's mutant set close? | all four | `inherited` V10 A15: 3/10 mutants survive (`adv3-r4-getattr-exec`, `adv4-r1-conditional-backdoor`, `adv6-r1-new-socket-file`), two live | Re-run `mutation_harness.py`; require `caught=YES` on all | Zero surviving mutants, each named defect closed | Any surviving live mutant blocks the gate verdict outright | unknown |
| **RQ-14** | Is the app-side scheduler a viable 24/7 mechanism? | Rule 1 | `inherited` V10 A22: last in-app tick `2026-09-19T18:05Z`; today `electron=0` (A12); `server/src/index.ts:58,66` calls `initScheduler` | Read `services/scheduler/scheduler.js`; require the app to stay alive | A 24 h run with ≥1 in-app tick and a log line proving it | If the app is closed, this mechanism cannot fire — kills it as the primary scheduler | blocked |
| **RQ-15** | What is the read/write boundary any future adapter must obey? | Rule 2 | A16: `verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0`, `PASS`, exit **0** | Derive the boundary from `readonly_client.py` allowlists (method GET/HEAD, path regex, host loopback) | Boundary stated as: GET/HEAD only, fixed path allowlist, loopback-only host, no credential in-repo | Any adapter that adds a provider host to `ALLOWED_PATHS` or mints a token violates Rule 2 — kills the adapter | available |

---

## C. Read-source research — option-by-option comparison

Baseline: V10 §3 "Read source" rows. This pass re-measured the environment each option depends on.

| Attribute | **O4 — Operator-entered record** (`operator-state.json`) | **O6 — Path B bridged app read** (authenticated, live) | **O1 — Loopback metrics route** (`:4600/api/v1/status/metrics`) | **O2 — Provider read contract** | **O3 — Payout-balance endpoint** |
|---|---|---|---|---|---|
| Rule(s) served | Rule 1, Rule 3 | Rule 1, Rule 2, Rule 3 | Rule 1 | Rule 1, Rule 2 | Rule 1, Rule 2 |
| **Works today?** | **Yes** — code path exists and ran (A4) | No — app not running (`electron=0`, A12) | No — route 404 (N4) | Unknown — no usable credential (A14) | Unknown — needs a POST-minted token (Rule 2 refuses) |
| Verified today | A7 `records: []`; A4 null snapshot; `operator_state.py` reads this file | A11: `checkAuthenticatedSession`/`startInteractiveLogin` live in `freeCashExecutor.ts`, routed via `projects.ts:399-417` and `backgroundTasks/adapters.ts:1816` | N4: `curl :4600/api/v1/status/metrics` → `NOT_FOUND`, HTTP **404** | A14: live `provider_credentials` = 2 rows, repo = 0 | — |
| Effort | 0 h build + ~60 s/day operator | 4–8 h | 3–5 h + new route work | 2–4 h if an account exists | 4–8 h + a rules decision |
| Time-to-Revenue | same day, **visibility only** | 3–7 days, visibility only | 1–2 days, workstation metrics only | 3 days–2 weeks | 1–4 weeks; unbounded if refused |
| Dependencies | RQ-02 fixed; a free day key; 3.11.9 interpreter | app running **with a human session**; RQ-02; field-name mapping | a route that has never existed | confirmed account + out-of-repo token | an enabled payouts key + a token |
| First concrete action | Operator appends one record for a free `day_key` with four integer-cent figures; run once on a scratch root | Start the app, call the probe once, quote its artefact | `curl -m5 localhost:4600/api/v1/status/metrics` (expect 404 — done, N4) | Probe the documented endpoint with the operator's own token, `[REDACTED]` | Probe unauthenticated; check for an enabled payouts key |
| **Rule 2 implication** | safest — the routine reads a local file, never the network | read-only **if** the existing transport is used; must not create a third monitor (V10 C8/C16) | local only | the token must live outside the repo; no write method | **fails Rule 2** if the only read needs a POST-minted token |
| **Falsifier** | operator will not type four figures ⇒ dead | app never started, or field names undefined ⇒ dead | any write/earning method on the route ⇒ re-classified as a Rule 2 violation, not a read source | only a POST-token read exists ⇒ refused by Rule 2 | no enabled payouts key, or POST-only ⇒ dead |
| Verdict | **available (recommended first)** | blocked — needs human session | blocked | blocked | blocked |
| Honest limit | every snapshot is `degraded: true` by construction; a "no change" day only proves the same numbers were typed twice | sight of the real account, still no revenue (V10 C20) | workstation metrics, not account data | — | — |

**Ranking.** O4 is the only source producible this session and the only one with a same-day result; O6 is the only source that can ever show the *real* account and should be the primary research target once a human session exists; O1/O2/O3 are lower and each carries a Rule 2 hazard.

---

## D. Provider research

**Providers in scope (named).** Two candidate surfaces exist in this repository; both are provider-named and must be decided by a human:
1. **Free Cash** itself (the app referenced by `server/src/services/freeCash/freeCashExecutor.ts`) — the only surface with existing app-side plumbing (`startInteractiveLogin`, `checkAuthenticatedSession`).
2. Any **payout/earnings provider** reachable through the `provider_credentials` table (live DB = 2 rows, A14). The row *labels* were not read; only the count.

**What read-only endpoints/documentation would be required.** A provider read contract must expose, by GET only: account status, cumulative earnings, current balance, pending amount — the exact four fields `operator-state.json.template_record` already defines (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`). The contract must be documented by the provider, not reverse-engineered, and the four field names must be fixed in writing before any adapter is built (V10 S4).

**Auth model.** Two possible models, and the difference is decisive for Rule 2:
- *Session-cookie / profile-based* (what Path B uses): a human logs in once; the managed browser profile holds the session; the routine performs read-only GETs. This does **not** require the routine to hold a credential.
- *API token*: if the only read path requires minting a token via POST, that action is a write-class call and is **refused by Rule 2** — such an option is recorded as an option-level falsifier, never attempted (A.2 point 2; RQ-07 falsifier).

**NOT knowable in this session (plainly).**
- Whether a provider read API exists at all.
- What auth model it uses.
- What any endpoint returns.
- Whether its terms permit automated read.
Reason: **no credential may be read or used**, `env | grep -Ei 'SMTP|WEBHOOK|FREECASH'` shows no secret (A17), and the live `provider_credentials` table has 2 rows whose values are off-limits (A14). An unauthenticated GET can only prove routability.

**Read/write boundary rule any future adapter MUST obey** (derived from `readonly_client.py`, A15):
1. Method allowlist: **GET and HEAD only**; every other method refused.
2. Path allowlist: a **fixed tuple of compiled regexes**; everything else refused — a provider host may **not** be added to `ALLOWED_PATHS` without a recorded rules decision.
3. Host allowlist: **loopback only** — so an unresolved provider host cannot be reached even if a caller passes a hostname.
4. **No credential, token or secret in the repository** (V10 C6); any token lives outside the repo.
5. A new adapter must not become a **third monitor** (V10 C8/C16); it plugs into the existing source interface that `operator_state.py` already exposes.
6. Static gate: any adapter keeps `verify_readonly.py` at `forbidden=0` and the exemption baseline pinned at **28** (A16).

---

## E. Scheduling-mechanism research

| Mechanism | Verified today | Interpreter pinning | Rule implication | Falsifier | Verdict |
|---|---|---|---|---|---|
| **Windows Task Scheduler** | N1: `schtasks /Query /FO CSV /NH | wc -l` → **278** tasks; `grep -ic freecash` → **0**; nothing to undo | Must pin the **3.11.9 venv** (`/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python`), which has `tzdata 2025.3` (A18) | Rule 1 depends on an accurate Europe/Berlin day key | The `DECISION-V2-*.xml` payloads failed `ET.parse` **earlier today** (`inherited` V10 A17) — **but see Appendix Z: both now parse OK** (A20). Registration is still blocked by RQ-02/RQ-03, not by XML. | research available / **registration blocked** |
| **hermes cron** | N2: `hermes cron list` → `No scheduled jobs.` | Same interpreter of record | Rule 3 (deliver a change) | A cron job that does not pin the interpreter degrades the day key | research available / registration blocked |
| **In-app scheduler** | A12: `electron=0` today; `server/src/index.ts:58,66` calls `initScheduler`; `inherited` last tick `2026-09-19T18:05Z` | Runs under the app | Rule 1 | The app is closed ⇒ it cannot fire (V10 C17) | **blocked** |

**Interpreter-pinning requirement (verified).** `python` resolves to `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` = **Python 3.11.9** with **tzdata 2025.3** (A18). A system interpreter lacking `tzdata` cannot resolve `Europe/Berlin` reliably; the day key degrades and the routine reports `MONITOR_DEGRADED` (V10 C10; RQ-09). Every scheduled action must therefore name this absolute path, not `python`.

**XML payload note.** The four scheduler XMLs were re-parsed this pass (A20): all four return **OK, exit 0**. The raw-`&` defect recorded in V10 A17 is **no longer reproducible** (files mtime 09:04). Scheduling remains blocked for two *other* verified reasons: the acceptance gate is red (A16) and a data-less run still spends the day (A3/A4/RQ-02).

---

## F. Notification-sink research

| Sink | Verified today | What must exist to use it | Rule 3 status | Verdict |
|---|---|---|---|---|
| **Windows toast** | A17b: `notify.py:152` implements it; delivery label `TOAST_OK` on success, `STUB_OK` offline, `FAILED_TOAST` after cap; `notified-keys.json` shows 10 keys all `TOAST_OK` (A5c) | A desktop session (the toast needs the shell) | **implemented** | available |
| **Email** | A17: `env | grep -Ei 'SMTP|WEBHOOK'` → **no `SMTP_*`** present | SMTP host/port/user/secret + a mail library or client | not implemented | **blocked** — no credential, no tooling |
| **SMS** | No gateway variable, no SMS tooling observed | A gateway provider + credential | not implemented | **blocked** |
| **Webhook** | A17: **no `WEBHOOK_*`** in the environment | A destination URL + (usually) a signing secret | not implemented | **blocked** |

Deduplication is a separate axis and **is** exercised: `notified-keys.json` holds 10 dedupe keys (A5c), and `changedetect.py` + `notify.py` implement once-per-change. Email/SMS/webhook cannot be built this session; each needs a credential or tooling that does not exist (RQ-08).

---

## G. State-root research

**Verified today.** All three roots exist (A8): `data/freecash/` (empty, mtime Sep 11), `data/freecash-monitor/` (the live root: `state/`, `snapshots/`, `alerts/`, `approvals/`, `logs/`), and `server/data/freecash-monitor/` (only `README.md` + `INTEGRATION_STATUS.md`). The **day-locks live under `state/day-locks/`**, not directly under the root (see Appendix Z).

**How precedence is determined (to be traced, RQ-06).** `paths.py` resolves the data root and the session environment exports two overrides: `AGENTICOS_DATA_DIR=C:\Users\cd-pr\AppData\Roaming\AgenticOS\data` and `AGENT_TEAMS_DB_PATH=C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\agentic-os.db` (A15). `db/index.ts` gives `AGENT_TEAMS_DB_PATH` precedence for the *database*; whether `paths.py` honours `FREECASH_DATA_ROOT` over `AGENTICOS_DATA_DIR` for the *monitor root* was not traced this pass and is the open question.

**The exact experiment that would settle it** (read-only; no production write):
1. Read `monitoring/freecash/paths.py` and quote the resolution order.
2. On a scratch `FREECASH_DATA_ROOT` **with** `AGENTICOS_DATA_DIR` pinned, run the entry point once and capture which root received `state/last-run.json` (compare the `day-locks/` path the run prints against each candidate root).
3. Re-run with `AGENTICOS_DATA_DIR` unset and compare.
4. Expected shape of a pass: exactly one root gains `state/day-locks/<day>.lock` and one gains `state/last-run.json`; the printed lock path names the winner.
5. Falsifier: if both roots change, precedence is not single-valued → the Rule 1 day-lock is not a global guarantee.

---

## H. Incident forensics as a research item

**What the two runs did (verified from the artefacts, A3–A5, plus `inherited` V10 A5/A19):**

| Step | 2026-09-30 run | 2026-10-01 run |
|---|---|---|
| Day lock | created `2026-09-30.lock` | created `2026-10-01.lock` (mtime 08:53:46) |
| Reading | **none** (`operator-state.json` has no record) | **none** |
| Snapshot | null snapshot | `data_available:false`, four figures `null` (A4) |
| Ledger | advanced `last_success_day`, reset miss counter | `last_success_day=2026-10-01`, `consecutive_missed_days` **0 (was 9)** (A3) |
| Watchdog | reports covered (`SUCCESS_OUTCOMES` contains `MONITOR_DEGRADED`) | same — the watchdog is silenced |
| Alert line | `MONITOR_DEGRADED` + `SKIP_DUPLICATE_DAY` | line 15 `MONITOR_DEGRADED` (A5) |

**Plain finding.** Both days were **spent by runs that read nothing**, each was **booked as a success**, the **9-day miss counter was reset to zero**, and the **watchdog was silenced** — on a day with no reading.

**Open question (RQ-05).** **Who or what invoked the 08:53:46 run is unknown.** All 15 alert lines carry no writer key (A5b: `grep -o '"writer"[^,]*'` → zero matches). `schtasks` has 0 freecash tasks (N1) and `hermes cron` has no jobs (N2), so the invoker is not the two mechanisms a plan would propose — it is something else in the session that ran at 08:53:46. Until a writer tag exists, no run can be attributed.

---

## I. Recommended research order, and the blocked table

**Recommended order** (each step is the smallest thing that unblocks the next; no step may spend a production day):

1. **RQ-02** — fix the "ran = read" conflation (write the failing test first). Everything else is unsafe until a data-less run cannot spend a day. ~40 min.
2. **RQ-10 / RQ-05** — reconstruct the 09-30 and 10-01 incidents and add a writer tag, so the log becomes an attributed audit record. ~1–2 h.
3. **RQ-01 (O4)** — have the operator enter the first four figures for a free `day_key`; obtain the first real baseline. Same sitting, ~60 s.
4. **RQ-06** — trace `paths.py` and settle the authoritative state root before any scheduler is discussed.
5. **RQ-03 / RQ-13** — port the package detectors into the shipped gate and close the mutant set.
6. **RQ-04 / RQ-11** — label the false-compliance verifier and the parallel implementations DEPRECATED (no file deleted).
7. **RQ-12** — exercise the R4 approval queue with one synthetic item and one refused machine decider.
8. **RQ-08 (F)** — record that email/SMS/webhook are unbuildable this session; keep the toast as the one sink.
9. **RQ-09 (E)** — compare scheduling mechanisms with the pinned 3.11.9 interpreter; hand over, do not register.
10. **RQ-07 (O2/O3) and RQ-14** — provider and in-app paths, last; both need an external capability.

**Genuinely BLOCKED items — missing external capability named:**

| Blocked item | Missing external capability | Verified reason |
|---|---|---|
| Any real account figure | A **human** logging into their own dashboard and typing four figures | `operator-state.json.records = []` (A7); live DB has no reading |
| Path B bridged authenticated read (RQ-01 O6) | A **running app with a human session** | `electron = 0` today (A12); profile unauthenticated |
| Provider read contract (RQ-07 O2) | A **confirmed account + an out-of-repo token** | live `provider_credentials` = 2 rows, values off-limits; Rule 2 refuses a POST-minted token |
| Payout-balance endpoint (RQ-07 O3) | An **enabled payouts key** | would need a POST-minted token → refused by Rule 2 |
| Email / SMS / webhook alerting (RQ-08) | **Credentials or installed mail tooling** | `env | grep -Ei 'SMTP|WEBHOOK'` → none (A17) |
| In-app scheduler as 24/7 mechanism (RQ-14) | The **desktop app process staying alive** | last tick `2026-09-19T18:05Z`; `electron = 0` |
| Unattended scheduling (RQ-09) | RQ-02 + RQ-03 fixed **and** operator sign-off | gate `R1=FAIL` exit 1 (A16); a data-less run books success (A3) |
| Attributable writer on alerts (RQ-05) | A **code change** adding a writer tag | 15/15 lines carry none (A5b) |
| Strong R4 identity provenance (RQ-12) | An **applied identity control** (patch proposed, unapplied) | `inherited` V10 A18 |
| The revenue path (money, not monitoring) | A **human decision + worker re-dispatch** | `bgtask-07a8154b0` `blocked`, `resumable=0` (`inherited`) |

---

## Appendix Z — contradictions found this pass (corrections to the parent brief)

Each row is a claim in the brief that this pass could not reproduce; the measured value stands.

| Z# | Brief claim | Measured this pass (command) | 
|---|---|---|
| Z1 | day-locks at `data/freecash-monitor/day-locks/` | the directory is `data/freecash-monitor/**state/**day-locks/` — `ls -la --time-style=full-iso data/freecash-monitor/state/day-locks/` (A2) | 
| Z2 | `provider_credentials` has **0 rows** | live canonical DB (`AGENT_TEAMS_DB_PATH` → `…\Roaming\AgenticOS\data\agentic-os.db`) has **2 rows**; the repo DB `server/data/agentic-os.db` has **0** — `python -c "sqlite3…select count(*) from provider_credentials"` (A14). Also: no `revenue_ledger` table; the table is `revenue_ledger_entries`. | 
| Z3 | DECISION-V2 XMLs fail `ET.parse` on a raw unescaped `&` | **all four** scheduler XMLs now `ET.parse` → **OK, exit 0** (mtime 09:04) — `python -c "ET.parse(…)"` (A20) | 
| Z4 | prior art at `docs/free-cash-monitor-research-plan.md` and `docs/free-cash-monitor-workflow-plan.md` | actual paths are `docs/**freecash**-monitor-research-plan.md` and `docs/**freecash**-monitor-workflow-plan.md`; `ls` on the briefed names → `No such file` (A21) | 
| Z5 | "the only toast sink is implemented" | confirmed, **and** `notified-keys.json` shows **10** dedupe keys already recorded, all `TOAST_OK` (A5c) — Rule 3 dedupe is exercised, not just coded | 

## Appendix Y — exact commands run this pass (for reproduction)

```
date
ls -la --time-style=full-iso data/freecash-monitor/state/day-locks/
cat data/freecash-monitor/state/last-run.json
cat data/freecash-monitor/state/notified-keys.json
cat data/freecash-monitor/state/operator-state.json
cat data/freecash-monitor/snapshots/2026-10-01.json
ls -la data/freecash-monitor/approvals/
wc -l data/freecash-monitor/alerts/alerts.jsonl
tail -3 data/freecash-monitor/alerts/alerts.jsonl
grep -o '"writer"[^,]*' data/freecash-monitor/alerts/alerts.jsonl
find data/freecash data/freecash-monitor server/data/freecash-monitor -maxdepth 3
curl -s -o /dev/null -w "%{http_code}" -m5 localhost:4600/api/health          # 200
curl -s -o /dev/null -w "%{http_code}" -m5 127.0.0.1:3001/health              # 000
curl -s -w "\nHTTP:%{http_code}\n" -m5 localhost:4600/api/v1/status/metrics   # 404 NOT_FOUND
tasklist | grep -ic electron                                                  # 0
env | grep -Ei 'SMTP|WEBHOOK|FREECASH|AGENT_TEAMS_DB_PATH|AGENTICOS_DATA_DIR'
schtasks /Query /FO CSV /NH | wc -l                                           # 278
schtasks /Query /FO CSV /NH | grep -ic freecash                               # 0
hermes cron list                                                              # No scheduled jobs.
python -c "import sys,tzdata;print(sys.version);print('tzdata',tzdata.__version__)"   # 3.11.9 / 2025.3
python -c "sqlite3 … select count(*) from provider_credentials"               # live=2, repo=0
python -m py_compile finance-monitor/src/rule_engine.py                       # SyntaxError line 122
python scripts/monitoring/rule_gate_verify.py monitoring/freecash/run_daily_check.py  # R1=FAIL exit 1
python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package   # argparse error exit 2
python monitoring/freecash/verify_readonly.py monitoring/freecash             # forbidden=0 exempt=28 PASS exit 0
node --check server/scripts/freecash-daily-monitor.mjs                        # SyntaxError line 41
node server/scripts/verify-freecash-rules.mjs                                 # 4/4 PASSED exit 0
python -c "import xml.etree.ElementTree as ET, glob; [ET.parse(f) for f in glob.glob('…/scheduler/*.xml')]"  # all OK
grep -n "startInteractiveLogin|checkAuthenticatedSession" server/src/services/freeCash/freeCashExecutor.ts
grep -n "externalConnected" server/src/adapters/freecashMonitorAdapter.ts     # :206 false
grep -n "freecashMonitor|runtimeRegistry" server/src/index.ts                  # adapter absent
```

**End of plan.**

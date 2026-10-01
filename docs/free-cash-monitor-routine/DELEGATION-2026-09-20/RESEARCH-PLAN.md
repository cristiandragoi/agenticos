# RESEARCH-PLAN — closing the ONE real blocker: there is no trustworthy, rule-compliant read source

**Canonical status:** this file is the **single authoritative plan for the open data-source blocker** of the Free Cash daily status-monitoring routine. It supersedes the plan documents listed in §9.2 as *plans*; it does not supersede the design contract (`ROUTINE-DESIGN.md`), the gate contract (`RULE-GATE-CHECKLIST.md`, `verify-readonly.sh`) or the evidence registers (`PROVIDER-FINDINGS-REVERIFIED.md`, `PROVIDER-DECISION-PACKET-2026-09-20.md`).

| Field | Value |
|---|---|
| **Repository / branch** | `D:/AgenticOS` · `hermes-rescue-20260908` |
| **Written** | 2026-09-20 (Europe/Berlin), delegation `DELEGATION-2026-09-20` |
| **Routine under plan** | `monitoring/freecash/` — entry point `run_daily_check.py` |
| **Rules served** | R1 one status check per operator-local day · R2 zero automated earning actions (GET/HEAD, allowlisted paths) · R3 notify on earnings/status change · R4 human approval before any external action, no execution path |
| **Scope of the pass that wrote this** | read-only inspection only: source reads, directory listings, greps — plus the creation of this one file. No status read was executed, no routine run, no test run, no network request (not even loopback), no credential read, no scheduler query, no existing file modified or deleted. |
| **Evidence standard** | every factual claim below is either **OBSERVED** (with the file/line or command that shows it) or **CARRIED** (from a named prior artifact, not re-verified here) or **UNRESOLVED**. Nothing is asserted from memory. |

---

## 0. The blocker, stated exactly

The routine has no read source that is both rule-compliant and populated.

**What is structurally true (OBSERVED by reading the code, not re-litigated):**

1. The routine offers exactly two sources — `SOURCES = ("operator_state", "metrics_http")` (`monitoring/freecash/run_daily_check.py:53`), default `operator_state` (`:52`). The *source kind string* it records is `operator_entered`.
2. `operator_state.read_source()` returns `data_available=False` when no record exists whose `day_key` equals today (`monitoring/freecash/operator_state.py:128-139`). The records list is **empty today** (CARRIED, verified live 2026-09-20 21:08: `RUN_OK 2026-09-20 outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)`, `changes=0 notifications=0 approvals=0`).
3. With `data_available=False`, `run_daily_check._run()` takes the `MONITOR_DEGRADED` branch and never reaches change detection (`run_daily_check.py:410-419`). **This is the mechanical reason R3 cannot fire**: zero changes are found because zero figures exist, not because the compare or notify path is missing.
4. `metrics_http` is confined by construction to loopback: `ALLOWED_HOSTS = {localhost, 127.0.0.1, ::1, [::1]}`, `ALLOWED_PATHS = (^/api/v1/status/metrics$, ^/api/v1/status$)`, `ALLOWED_METHODS = {GET, HEAD}`, request bodies refused, unknown kwargs refused, and a process-wide `sys.addaudithook` aborts any `socket.connect` / `socket.getaddrinfo` to a non-loopback host (`readonly_client.py:39-49, 110-140, 146-176`).
5. **Nothing serves those two paths.** OBSERVED by repo-wide search: `api/v1/status` appears only in the routine, its tests, `scripts/monitoring/free-cash-daily-check.py` and one planning JSON — never in a server route, router, or listener. (CARRIED: a 2026-09-20 probe of `http://localhost:3001/api/v1/status` returned curl exit 7 / `[WinError 10061]`.)
6. The provider contract is deliberately absent: `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` (`readonly_client.py:60`), and `ALLOWED_PATHS` carries the comment that provider paths are added only after research resolves them (`:46-48`).
7. `degraded` is a **hard-coded literal `True`**, not a function of the source — `changedetect.build_snapshot()` at `changedetect.py:168` and `run_daily_check.observed_for()` at `run_daily_check.py:98`. Therefore *every* snapshot from *every* source is stamped degraded, including a future provider-authoritative read, until that code changes.

**The blocker in one sentence:** the routine cannot fire its Rule-3 notification because no figures ever enter it, and it cannot honestly claim the account was observed because no rule-permitted machine read of the account exists — so the work is to (a) get real human-entered figures flowing today, and (b) decide, on evidence, whether a machine read may ever exist.

**What this plan does *not* do:** it does not authorise any provider contact, does not invent an endpoint, does not widen an allowlist, and does not propose an execution path. Nothing here may be executed without the human gates in §7.

---

## 1. Decision criteria — how a candidate source is judged

Every candidate is scored against six gates. **G1 and G2 are eliminatory**; a candidate that fails either is rejected outright, not queued.

| Gate | Question | Pass condition |
|---|---|---|
| **G1 — Rule compliance (eliminatory)** | Can the routine acquire this data without any write verb, without any credential material inside `D:/AgenticOS`, and without violating the platform's own terms? | Automated access is permitted by the platform's terms (quoted, with URL + section + date) **and** acquisition needs at most `GET`/`HEAD` on a named path **and** no secret is stored in the repo. A platform whose terms forbid automated access "*including monitoring*" fails G1 permanently. |
| **G2 — Truthfulness (eliminatory for `degraded:false`)** | Is the value a **machine-verified provider fact**, or a human attestation / local substitute? | Only a value that originated from the provider's own documented endpoint may ever be eligible for `degraded:false` — and only after a deliberate code change (see §5, T7). Human-attested and local-substitute values stay `degraded:true` **forever**; they may never be presented as evidence of a healthy account. |
| **G3 — Evidence** | Can a reviewer point to a fetched primary source or an executed command that shows the value is real? | A recorded HTTP status code, response header names and response field names from a human-performed call; or a public primary document (OpenAPI/docs page/ToS/robots.txt) with URL, date and section. |
| **G4 — Cost and blast radius** | What does it cost, and which defensible boundary does it change? | Effort estimate in hours; the exact allowlist/host/test changes named; reversibility stated. Any widening of `ALLOWED_HOSTS` is an **R2 change** requiring review, not a bug fix. |
| **G5 — Dependency on third parties** | Who else must act before this yields data? | Named owner (operator / provider KYC queue / provider entitlement queue). Third-party queues mean the calendar time is not controlled here. |
| **G6 — Time-to-Rule-3** | How soon does a *change notification* become possible at all? | Measured against the thing the operator actually wants: a Rule-3 notification that means something. |

**Decision rule (priority order):** safety first (G1), then time-to-Rule-3 (G6), then truthfulness uplift (G2), then cost (G4). A candidate is never ranked above another because it is more interesting; only because it is safer, faster to a trustworthy notification, or more truthful.

**Ranked outcome:** **Rank 1 = A operator-entered** · **Rank 2 = B local read-only metrics endpoint** · **Rank 3 = C documented read-only provider API** (blocked on an operator-held fact and on a human-performed verification). **Rank 1 closes the "R3 can never fire" half of the blocker today. Only Rank 3 can ever close the "account not observed" half.**

---

## 2. Candidate A — operator-entered figures (Rank 1)

**What it is:** the operator logs into their own dashboard personally, reads four figures, and appends one record to `<data root>/state/operator-state.json`. The routine only opens that file; `operator_state.read_source()` `READ_OPS = []` — it opens no socket and holds no credential (`operator_state.py:12-16, 46`). Record schema (`operator_state.py:48-66`): `day_key` (`YYYY-MM-DD`), `entered_at_utc`, `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`. Only a record whose `day_key` equals today's operator-local day is used; a stale record is never carried forward (`:104-116`).

| Field | Value |
|---|---|
| **Expected Effort** | **Builder: 0 h — the source is already implemented and shipped.** Operator one-time: **≈0.5 h** (settle the canonical data root, create the file, enter one record). Recurring: **≈60 s/day**. (CARRIED effort figures "0 h builder / 0.5 h operator / ~60 s per day" from `PROVIDER-DECISION-PACKET-2026-09-20.md` §2 O4; independently consistent with the code OBSERVED here.) |
| **Time-to-Revenue** | **Same day.** The first record yields a baseline snapshot at the next run; the second distinct day yields the first real Rule-3 change notification. |
| **Dependencies** | A writable data root; the interpreter that has `tzdata` (`python` = 3.11.9 on this host — CARRIED: `py -3` = 3.14.7 raises `ZoneInfoNotFoundError` before the day lock is created); the operator's own ordinary login on their own dashboard (**no credential is given to the routine and none may be asked for** — no passwords, session cookies or 2FA codes). No provider account action, no token, no approval, no network egress. |
| **First Concrete Action** | (i) Create the template: run the routine's `--source operator_state` path once against the canonical root so `ensure_template()` produces an empty `records` list and a `template_record`; (ii) the operator appends **today's** record by hand with today's local date as `day_key`; (iii) the operator or a reviewer confirms the run reports `data_available=True`. *Precision note:* the read-only-looking `--print-state` flag still calls `paths.ensure_layout()` first (`run_daily_check.py:278`) and therefore **creates the state directories**; it consumes no day lock and performs no status read, but it is not a zero-side-effect command. |
| **What evidence would prove it works** | A run transcript showing `RUN_OK <day> outcome=INITIAL_BASELINE source=operator_entered(data_available=True)` with a non-null snapshot, followed on a later day by `EARNINGS_CHANGED`/`BALANCE_CHANGED` with `notifications=1` per distinct change, `approvals=1` enqueued `PENDING`/`NOT_EXECUTED`, and the corresponding lines in the append-only `alerts/alerts.jsonl`. The snapshot must still read `"degraded": true`. (CARRIED pattern, previously demonstrated in a temp root: `INITIAL_BASELINE` → `EARNINGS_CHANGED` (2 changes) → `OK_NO_CHANGE`, 2 notifications, 2 approval items, `"delivery": "STUB_OK"`.) |
| **How it could fail** | (a) **Operator stops typing** → silence plus a `MONITOR_DEGRADED` info line, not an alarm: an absent record is not an error, so nobody is shouted at when the monitoring stops. (b) **Noise:** a mistyped figure, a duplicated `day_key`, or a copy-paste of yesterday's line is indistinguishable from a real change and will fire a notification — a plausible cause of notification fatigue that trains the operator to ignore R3. (c) **False confidence:** a `no change` result from this source proves only that the same numbers were entered twice; it is **not** evidence the account is intact or earning, and must never be reported as such. (d) **Root ambiguity:** `paths.py` defaults to `D:/AgenticOS/data/freecash-monitor` (`paths.py:35`) while the dispatch pins `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash` — two roots means two empty ledgers and two "first" baselines. |
| **Gate verdict** | **G1 pass** (human reading their own dashboard; no automated access). **G2 fail-by-design** for `degraded:false` — stays `degraded:true` permanently. **G6 best possible** — Rule 3 becomes reachable today. |

**Decision:** authorise A as the read source **now**, with `degraded:true` preserved and the honesty sentence carried in every report. This is the only candidate that requires no new code, no new secret, and no provider contact.

---

## 3. Candidate B — local read-only metrics endpoint on `localhost` served by the existing AgenticOS backend (Rank 2)

**What it is:** stand up a loopback-only service that actually answers `GET /api/v1/status/metrics` (and `HEAD /api/v1/status`) — the only two paths, on the only permitted host, that `readonly_client` can reach. `DEFAULT_BASE_URL = "http://localhost:3001"` (`readonly_client.py:54`); the intended read ops are W1 (`GET` metrics) and W2 (`HEAD` health), deliberately marked *"local substitute metrics (degraded)"* (`:16-25`).

**What it is *not*:** it cannot observe the account. It reads the workstation's own metrics. Its snapshots must therefore stay `degraded:true`, exactly as the code comment says.

| Field | Value |
|---|---|
| **Expected Effort** | **2–3 h builder** to build and stand up a loopback-only read-only service exposing those exact two routes (CARRIED from `PROVIDER-DECISION-PACKET-2026-09-20.md` §2 O1: "2–3 h to build and stand up a loopback-only read-only service that actually serves `GET /api/v1/status/metrics` — no such route or process exists today"; that packet's total for O1 was 3–5 h including unrelated acceptance work). **Verified negative here:** OBSERVED that no route serving those paths exists anywhere in the repo. |
| **Time-to-Revenue** | **Same day–1 day** for a machine-checkable local health signal. **Zero uplift** to account visibility: it produces no provider fact and cannot fire a *meaningful* Rule-3 earnings notification on its own. |
| **Dependencies** | A decision on **which process owns the route** — the existing AgenticOS backend on `localhost:3001` (a code change in `server/`, i.e. another component, requiring review) **or** a small loopback-only listener scoped to the routine; the exact JSON shape the routine will normalise (`changedetect.normalize_metrics`); agreement that the route is `GET`/`HEAD`-only and read-only; the routine's interpreter; the canonical data root from Candidate A. |
| **First Concrete Action** | **Inspection, not implementation:** (i) identify the backend process that listens on `localhost:3001` in normal operation (currently **nothing** does — CARRIED: curl exit 7 / `[WinError 10061]`), (ii) locate its router/registration point and read whether adding a read-only route is additive and reversible, (iii) write down the exact response shape that `changedetect.normalize_metrics` accepts, **before** any code is written. A route spec that names fields the routine cannot normalise is worse than no route. |
| **What evidence would prove it works** | A run with `--source metrics_http` against the live local service printing `source=agenticos_local_metrics(data_available=True)`, with the served verbs observed to be exactly `GET` and `HEAD` on the two allowlisted paths. (CARRIED: previously demonstrated only against a **test stub**, verbs `['GET','HEAD']`.) The snapshot must still read `"degraded": true`. |
| **How it could fail** | (a) **It is not the account** — the single most likely misreading; it must never be allowed to make `degraded:false`. (b) **Scope creep into the shared backend**: adding a route to `server/` puts the routine's read path inside a component with a much larger blast radius than `monitoring/freecash/`, and that component has its own tests and its own release build. (c) **Field mismatch:** normalisation fails or silently nulls fields, producing a plausible-looking but meaningless series. (d) **Port collision:** another process claims `3001`, and the routine then reads a service nobody vetted. (e) **Drift:** the endpoint is stood up once, then removed or changed by unrelated work, and the routine reports `READ_FAILED` (exit 5) with no automatic re-run. |
| **Gate verdict** | **G1 pass** (loopback, no credential, no provider terms engaged). **G2 not applicable** — never eligible for `degraded:false`. **G6 poor** — no uplift to what the operator actually asked for, unless a *local* health bead is explicitly wanted for its own sake. |

**Decision:** **do not build B in order to make the routine "look productive."** Build it only if the operator explicitly wants a loopback health signal, and then only with the field contract fixed in advance and `degraded:true` untouched. B is a *substitute*, and the code already says so.

---

## 4. Candidate C — a documented read-only provider API for the platform in question (Rank 3)

**The provider contract is UNRESOLVED and must never be invented.** The literal placeholder is preserved verbatim in code (`readonly_client.py:60`: `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`) and must remain greppable until a human-performed verification (§7) replaces it with a *verified* value. No endpoint, hostname, field name or API behaviour may be asserted before that verification.

**Two things are already settled for the platform the routine has been built around (CARRIED, from live fetches recorded in `PROVIDER-FINDINGS-REVERIFIED.md` and re-confirmed in `PROVIDER-DECISION-PACKET-2026-09-20.md`):**

- **freecash.com — closed to automated reads, permanently.** Its Terms §17 ("Restrictions and Prohibited Uses") forbid any "*robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring***"; the same section bans macros/bots/scripts; §16 restricts use to "*personal, non-commercial use only*"; §19 permits suspending or **voiding unredeemed rewards**. `robots.txt` independently disallows `/user/`, `/myprofile`, `/fc-api/`. `/docs` and `/developers` do not exist. **Any scripted read of freecash.com — including a once-daily GET of a status page — fails G1.** This candidate can never be satisfied on that platform.
- **The two provider leads on file are conditional and unverified as usable:** HG.Cash documents a read-only `GET /accounts` (Bearer token generated in the dashboard, format `cash_<64-hex>`), but **the same token can also call the money-leaving `POST /transactions`** — so read-only-ness would be enforced by our allowlist, not by the credential — and its onboarding is approval-gated (Contact → KYC → provider approval). Cashfree documents `GET /payout/v1/getBalance`, but the read token is minted by `POST /payout/v1/authorize`, which the routine's transport refuses by construction; no read-only key scope is documented. Both remain **conditional on an operator-held fact that no amount of research can supply: whether the entity holds an account at all.**

| Field | Value |
|---|---|
| **Expected Effort** | **0 h until the operator names the platform.** Then: **≈0.5 h operator** to answer + **≈1 h** to record; **≈4–8 h builder** for a verb-pure, credential-bearing `GET` integration *if* a documented read-only endpoint exists (allowlist entry + host allowlist *plus* the audit hook + source selector + field normalisation + `degraded` semantics change + mutation-proven read-only evidence). **0 h if the answer is "no API exists"** — the candidate closes as UNRESOLVABLE and Candidate A remains the source. (Effort figures CARRIED from `PROVIDER-DECISION-PACKET-2026-09-20.md` §2 O2/O3 and `RESEARCH-PLAN-V4.md` §3.5.) |
| **Time-to-Revenue** | **The longest and least controllable path: 3 days – 2 weeks** if an existing, KYC-complete account is confirmed and an API exists; **2–6+ weeks** if onboarding is required (provider-controlled queue); **unbounded** if entitlement is refused. This is the **only** candidate that can ever retire `degraded:true`. |
| **Dependencies** | (a) A written operator statement naming **which platform holds the monitored balance** — this single fact is unresolved and gates everything below; (b) written confirmation an account exists and its onboarding/KYC state; (c) a provider-issued token, resolved at runtime from env/vault only (§8), never in the repo; (d) a **human-performed verification of the endpoint before it is coded** (§7); (e) a deliberate, reviewed widening of `ALLOWED_HOSTS` *and* the audit hook (`readonly_client.py:132-137, 160-163`) plus one `ALLOWED_PATHS` regex with a justification comment; (f) a change to the test that currently asserts no provider host is hardcoded — to be reviewed as an R2 widening, not as a test fix; (g) a mutation-proven read-only result for the new path. |
| **First Concrete Action** | **Write the question, not the code.** Send the operator the single blocking question — *which platform and which account holds the monitored balance, and does that platform's dashboard offer an API token?* — and record the answer verbatim. In parallel, close the freecash.com branch in writing (terms §17 + `robots.txt`, already fetched). **No request to any provider is authorised by this plan.** |
| **What evidence would prove it works** | A recorded human-performed verification (§7): date/time, the exact command with the credential written as `[REDACTED]`, the HTTP status code, the response **header names** and **field names** — and **no values**. Plus a public primary source (provider docs page or OpenAPI) with URL, section and fetch date. Only then may code be written, and only then may the corresponding `ALLOWED_PATHS` regex be added. |
| **How it could fail** | (a) **The platform has no API** (the freecash.com case) — candidate closes, permanently. (b) **The account does not exist** — the blocker becomes an onboarding project whose duration a third party controls. (c) **The endpoint needs a POST** (token exchange) — either the operator mints a token out-of-band each day and the routine stays `GET`-only, **or** R2 is deliberately amended, which is the operator changing their own rule and must be recorded as such. (d) **The credential is not scope-limited** — then an allowlist mistake becomes a money-moving mistake; the allowlist, not the token, is the control. (e) **Rate limits unknown** — undocumented for both leads; 1 call/day is inside any plausible policy but is not *proven* to be. (f) **Terms change / jurisdiction** — a permission today is not a permission in perpetuity; a provider's terms can forbid automated access later. (g) **Widening goes wrong** — the audit hook exists precisely to stop a non-loopback connect; a careless widening disables the one process-wide control that makes "only loopback" a fact rather than a convention. (h) **A fabricated contract enters the repo** — a plausible-looking hostname or field name, never verified, silently producing `degraded:false` figures that mean nothing. This is the failure mode the `PROVIDER_ENDPOINT_UNKNOWN` literal exists to prevent. |
| **Gate verdict** | **G1 conditional** — passes only with a quoted terms position permitting automated access. **G2 the only G2-passing candidate.** **G5 provider-controlled.** **G6 worst.** |

**Decision:** keep C **open but strictly gated**. It must not be sequenced in front of A, and no work on it may begin before the operator's written answer and the human verification.

---

## 5. (i) Ranked, time-boxed research task list, with exit criteria per task

**Rules for this list:** each task has a time box *and* an exit criterion that is a command output or a written artefact — not an opinion. A task that hits its box without meeting its exit criterion is reported as **NOT CLOSED** and the dependent task does not start. No task may perform an external action (R4). Tasks marked **[operator]** require a human.

| # | Task | Owner | Time box | Exit criterion (must be an observed output) | Blocks |
|---|---|---|---|---|---|
| **T1** | Enter today's operator figures and get one real reading into the routine | operator + reviewer | **0.5 h** | `RUN_OK <today> outcome=INITIAL_BASELINE source=operator_entered(data_available=True)` (or `EARNINGS_CHANGED` if a prior baseline exists) with a non-null snapshot file present under `snapshots/`, and exactly one day-lock file for that day. | R3 (the whole point) |
| **T2** | Settle the canonical data root and make it the only one | operator | **0.5 h** | One root named in writing; a run against it producing a ledger and a pending count; the second root either documented as unused or reconciled. Exit artefact: the `--print-state` output showing the ledger path. | T1, T3, T5, all evidence |
| **T3** | Prove the R3 → R4 path end to end on real operator entries, and characterise the suite's non-determinism | builder/verifier | **2–3 h** | A transcript over ≥3 consecutive local days showing baseline → change → no-change, with `changes`/`notifications`/`approvals` agreeing; `OK_NO_CHANGE` producing **zero** dispatch attempts; each dedupe key present in `notified-keys.json` **before** dispatch (provable by a sender that raises). Plus `python tests/run_all.py` green **twice consecutively** on the same revision, or the flake captured with test names. | go/no-go on scheduling |
| **T4** | Decide Candidate B: build the loopback metrics service or record "not wanted" | operator + builder | **2–3 h build / 0.5 h decision**, box **1 day** | Either (a) a written "not wanted, for the following reason" entry, or (b) a fixed field contract (the exact JSON the routine will normalise) plus a run showing `--source metrics_http` → `data_available=True` against the live local service, with `degraded:true` still true and verbs observed as `GET`/`HEAD` only. | nothing critical — must not block T1 |
| **T5** | Answer the provider-identity question in writing — the one fact research cannot fetch **[operator]** | operator | **0.5 h answer + 0.5 h record**, box **1 day** | The literal platform name (and account state) written into the decision record, replacing `PROVIDER_ENDPOINT_UNKNOWN` **only if verified**; or an explicit "no automated source authorised" decision. The freecash.com branch is recorded as closed either way. | T6, T7 |
| **T6** | If and only if T5 names a platform whose terms permit automated access: **human-performed verification of one candidate endpoint** (§7) | operator (human, by hand) | **1 h**, box **1 day** | The verification record: timestamp, exact command with `[REDACTED]` credential, HTTP status code, response header names, response field names, primary-source URL with section and fetch date, and **no values**. If not performed: the endpoint stays **UNRESOLVED** and no code is written. | T7 |
| **T7** | Decide and implement the `degraded` semantics change (make it a function of the source) | builder + reviewer | **2–3 h**, box **1 day** | A test proving `degraded:false` is reachable **only** for a provider-authoritative, human-verified source, and that operator-entered and local-metrics sources remain `degraded:true`; plus mutation evidence that the change cannot silently mark a substitute as verified. | the word "verified" in any report |
| **T8** | Consolidate the documents and retire the broken legacy artefacts (§9) | operator + builder | **2–4 h**, box **2 days** | The canonical set named in §9.1 exists; every archived file carries a supersession banner; each artefact on the retirement list (§9.4) is archived or has a written disposition; no scheduled task or config references a retired path. | future agents' sanity |
| **T9** | Re-pin the revision and record the evidence bundle | verifier | **0.5 h** | `md5sum` of every file in `monitoring/freecash/` plus every command and observed output from T1–T8 in one bundle, timestamped. (Mandatory because the tree has already drifted mid-measurement once: a verifier verdict changed from `forbidden=2`/exit 1 to `forbidden=0`/exit 0 inside one hour. CARRIED from `RESEARCH-PLAN-V4.md` §1.1.) | trusting any earlier verdict |

**Sequencing:** T1 → T2 → T3 → T9 (the routine becomes trustworthy on the source it already has) ‖ T5 → T6 → T7 (the only path to a non-degraded read) ‖ T4 (optional, never blocking) and T8 (housekeeping, may run in parallel). **T5 must not block T1–T3.**

**Total effort to close the blocker's first half:** roughly **3.5–6 h** of builder/reviewer time plus **≈1 h** of operator time, all of it offline.

---

## 6. (ii) The exact questions that must be answered before any provider integration is attempted

All of these are **UNRESOLVED** today for every platform unless a cited fetched source says otherwise. An answer that does not come from a fetched primary source or a human-performed verification is not an answer — it is an assumption, and it stays UNRESOLVED.

**A. Authentication model**
- **A1** What is the exact authentication scheme — header name, scheme prefix, token format? (Nothing about any platform may be assumed from another platform's docs.)
- **A2** How is the credential issued, and by whom — self-serve in an existing account's dashboard, or behind an approval/KYC gate? (HG.Cash's token is dashboard-self-serve *inside an existing account*, but the account itself is approval-gated: Contact → KYC → approval. CARRIED.)
- **A3** Can the credential be scoped read-only, or can the same credential also move money? **If read-only scoping does not exist, record it explicitly**, because it makes the client's allowlist the *only* control and turns R2 verification into a security control rather than a nicety.
- **A4** What is the credential's lifetime, and how is it rotated or revoked?
- **A5** Does any request require request signing, a client certificate, or an egress-IP allowlist? (Cashfree documents a possible `X-Cf-Signature` path; whether it applies is UNRESOLVED.)
- **A6** Is a token exchange required — i.e. does obtaining the read token itself need a verb the routine refuses (a `POST`)? If yes, this is an **R2 decision for the operator**, not a build detail.

**B. Read-only endpoint availability**
- **B1** Does a documented `GET` (or `HEAD`) return the account's balance / earnings / status **with no accompanying write call**?
- **B2** Are the exact response **field names** documented, and what are the **units and scaling** (integer cents, decimal string, minor units)? A routine that diffs integer cents needs this exact answer.
- **B3** Is endpoint liveness observable **without** a credential — does an unauthenticated call return a documented error that proves the route exists? (A route that only errors generically is not evidence; Cashfree's unauthenticated probe returned an edge-level HTML `403`, *not* the documented application JSON, so its application-level liveness is UNRESOLVED. CARRIED.)
- **B4** Is there an official machine-readable specification (OpenAPI/Swagger) that can be cited instead of prose docs?
- **B5** Does the endpoint's response include an authoritative timestamp, so a reading can be shown to be current rather than cached?

**C. Rate limits and quotas**
- **C1** Is a rate limit documented at all? (Undocumented for both leads on file — an absence of documentation is not proof that none exists.)
- **C2** What is the documented behaviour on exceeding it (HTTP status, body, retry-after)?
- **C3** Is one `GET` per operator-local day inside any documented policy — and, if a limit is per-minute/per-hour, is 1/day trivially inside it?
- **C4** Is there any per-day, per-month or per-token quota that a monitor could exhaust over a year?

**D. Terms-of-service position on automated access**
- **D1** Do the platform's terms permit automated access **at all** — quoted verbatim, with **URL, section number and the document's own date**?
- **D2** Is **monitoring** named explicitly in the prohibition (the decisive wording found on freecash.com)?
- **D3** Is there a robot/spider/scraper/script/bot prohibition, and does `robots.txt` independently disallow the path in question?
- **D4** What is the stated consequence of a breach — account restriction, suspension, or **forfeiture of unredeemed rewards**? (For freecash.com this is documented and is why that platform is REJECTED.)
- **D5** Does any clause limit use to personal, non-commercial purposes, and does that framing conflict with running an automated monitor?
- **D6** Is there a documented developer/partner programme or a written-consent route that could make automated access permitted — and if so, is it available to this operator?
- **D7** Where does the *documented API* sit relative to the *website* terms — does using the official API fall inside or outside the website's automation clauses?

**E. Geographic availability**
- **E1** Is the API reachable and permitted from the operator's jurisdiction (currently Germany, Europe/Berlin)?
- **E2** Is the platform/product itself available in that jurisdiction, and is the account legitimately held there?
- **E3** Are there residency, data-transfer or currency-rails constraints that affect the account (the HG.Cash lead is a LatAm settlement platform per its own docs — its rails are a documented fact, the operator's entitlement to them is not)?
- **E4** Does any jurisdiction-specific term change the G1 verdict — i.e. could the *same* automation be permitted in one country and prohibited in another?

**F. Facts only the operator can answer (these gate everything else)**
- **F1** Which platform holds the monitored balance — by name — and does an account exist today (with its onboarding/KYC/entitlement state)? **UNRESOLVED.**
- **F2** Is the activity personal or commercial? (A business determination, not a fetchable one.)
- **F3** Does the platform's dashboard offer an **Export / Reports / Statement** control, and if so what is the exact menu path? (An export parsed locally would be the highest-evidence zero-network option; its existence is UNRESOLVED.)
- **F4** Does the platform send periodic balance/status **email**? (UNRESOLVED; post-hoc at best, so it could never be the sole R3 source.)
- **F5** Which local notification channel is acceptable, and has its real delivery ever been observed?

---

## 7. (iii) Verification protocol — a human confirms the endpoint by hand *before* it is coded

**Principle:** an endpoint becomes usable **only** after a documented, human-performed verification. Until then it is a candidate and the value is **UNRESOLVED**. No code may be written against an unverified endpoint, no matter how plausible it looks, and no placeholder may be replaced with a guess.

**The protocol, in order. A step not performed means the next step is not permitted.**

1. **Record the candidate as a candidate.** Write it down with status `UNRESOLVED`, the primary source it came from (URL + fetch date), and what is *not* known about it. Never write it into `readonly_client.py`, a test, a config file or a document as if it were a fact.
2. **A human performs exactly one read, by hand.** The operator — not an agent, not a script in this repo, not a scheduled task — executes a single documented read from their own machine with their own credential, in their own shell. One call. `GET` (or `HEAD`) only. The command is recorded with the credential written as `[REDACTED]`.
3. **Record the observation, never the values.** The verification record contains: timestamp (local + UTC), the exact command, the HTTP status code, the response **header names**, the response **field names**, and the primary-source citation. **No balances, no account identifiers, no token material, no PII** — every value is `[REDACTED]`. A verification record that quotes a balance is a data-leak artefact, not an evidence artefact.
4. **State the negative explicitly.** If the human did not perform the read, or it failed, or the response did not match the documentation: write **UNRESOLVED** and stop. "Asserted but not observed" is a failure, not a pass — history in this repo already includes a verifier that printed `4/4 PASSED` on a file that did not even parse, so an untested claim has negative value here.
5. **Only now may code be written** — and only for the exact path and verb that were verified: one `ALLOWED_PATHS` regex with a justification comment, the host added to **both** the request-path allowlist and the audit hook (`readonly_client.py:132-137` and `:160-163`), a source selector, and field normalisation matching the *observed* field names. Any widening of `ALLOWED_HOSTS` is reviewed as an **R2 change**, not as a bug fix.
6. **Prove the new path is still read-only, on the pinned revision.** Run the mutation matrix (parse check first; then planted violations: a write verb, a body-carrying request, a non-allowlisted path, a non-loopback host, a raw socket, an outbound mail call, a hardcoded provider host, a non-parsing file, an earning-action name carrying an exemption marker). **A checker that has not been observed to fail certifies nothing.** The recorded verdict is `(verdict, exit code, md5 of every scanned file, timestamp, command)`.
7. **Change `degraded` deliberately and separately.** Making `degraded` a function of the source is its own reviewed change with its own test (§5 T7). Until that lands, a provider read still produces `degraded:true` and a `no change` report still proves nothing about the account — and the routine must keep saying so.
8. **Expire the verification.** A verification is valid only for the revision and the documented API version it was performed against. Re-verify if the provider changes version, if the response shape moves, or at a stated interval (recommend: 90 days). A stale verification is not a licence to keep reading.
9. **No unverified value ever enters a snapshot.** If a read cannot be traced to a human-verified endpoint, the value must not be compared, notified, or written as if it were a reading — the correct outcome is `MONITOR_DEGRADED` with null figures, which is exactly what the routine does today.
10. **Never back-fill.** A day with no verified reading stays a day with no reading. Fabricating or reconstructing a value to fill a gap destroys the evidence record.

**Acceptance test for this protocol itself:** hand a reviewer a *plausible* fabricated endpoint and confirm the process stops (stays `UNRESOLVED`, no code written). If a fabricated endpoint can get through the protocol, the protocol is not working.

---

## 8. (iv) Credential-handling policy — secrets never enter the repository

**Baseline facts (OBSERVED / CARRIED):** the routine currently holds **no credential at all** — `operator_state` opens no socket (`READ_OPS = []`), and `run_daily_check` passes only `base`/`transport` to the client. `readonly_client.request()` accepts a `headers` mapping (`:110, 138-139`), so a future provider integration *could* pass one; this policy governs that case. On this host, runtime secrets live in `%LOCALAPPDATA%\hermes\.env` (outside the repo). `monitoring/` and `docs/free-cash-monitor-routine/` are **untracked** by git (`?? monitoring/`, `?? docs/…`) — CARRIED from the dispatch — which means **git cannot recover or un-leak anything there**; there is no history safety net.

| # | Rule | Rationale |
|---|---|---|
| **P1** | **No secret in `D:/AgenticOS` — ever.** Not in source, tests, fixtures, config, JSON state, snapshots, the alert log, or documentation. | The repo is the artefact most likely to be copied, shared or committed by accident; the tree is untracked, so a leak is not recoverable by git. |
| **P2** | **`[REDACTED]` is the only representation of a secret in any document.** Verification records, reports and transcripts carry the placeholder, never a value or a prefix. Even a partial token is a secret. | A verification record that quotes a token becomes the leak, not the evidence. |
| **P3** | **Secrets are resolved at runtime from a vault or the environment only** — e.g. an env var read once inside the process, injected from `%LOCALAPPDATA%\hermes\.env`. The routine reads `os.environ`; it never reads a dotfile itself. | Keeps the secret outside every artefact the routine writes. |
| **P4** | **Never pass a secret as a command-line argument.** argv is visible to other processes and lands in shell history and logs. | A token in argv is a token in a log. |
| **P5** | **Never write a secret into routine state.** Not into `snapshots/*.json`, not `alerts/alerts.jsonl`, not `logs/*`, not `notified-keys.json`. The alert log is the canonical evidence record and is append-only — a secret written there is permanent. | One leak into an append-only file cannot be edited out. |
| **P6** | **Names may be checked; values may never be read or printed.** Verifying that a needed variable *exists* is permitted; printing its value, hashing it, or transmitting it anywhere is not. | This is how the "no credential is provisioned" state was established without exposing anything. |
| **P7** | **Prefer a provider-issued, read-only-scoped credential. If none exists, write that down** — and treat the client's method/host/path allowlist and the process-wide audit hook as the real enforcement boundary (`readonly_client.py`). | If the credential can move money, the allowlist is the only thing standing between a diff and a withdrawal. |
| **P8** | **Only provider-issued API tokens are ever in scope.** Passwords, session cookies and 2FA codes are refused by design and must never be handled, stored, logged, or asked for — not by an agent, not by the routine. A session-based read is a scraping path and is out of scope permanently. | The forbidden credential pattern is exactly the one a "just read the dashboard" shortcut would require. |
| **P9** | **Rotation and revocation:** revoke at the provider **first**, then rotate the env value; record the revocation date in the decision record. Assume compromise on any suspicion. | Order matters: rotating locally while the old token stays live leaves the exposure open. |
| **P10** | **Pre-commit secret hygiene.** Before any future `git add` of anything under `monitoring/` or `docs/`, run a secret scan (pattern-based is acceptable) and record the result. Never `git add` a file that contains a token. | The tree is untracked today, so the first commit is the moment a leak becomes permanent. |
| **P11** | **Incident response (recorded, not improvised):** revoke → rotate → scan the artefacts written since exposure (`alerts.jsonl`, `logs/`, snapshots) → note the incident in the decision record with the affected variable **name** only. **Never paste the value into any file or message while investigating.** | Containment before diagnosis. |
| **P12** | **Agents never handle credentials.** An agent may ask whether a variable exists, may write code that reads it at runtime, and may never receive a value. If a task appears to require a secret, the task stops and is escalated to the human. | The routine's whole compliance story rests on a boundary an agent cannot be trusted to hold implicitly; make it explicit. |

**Enforcement point to name in any review:** the single socket site, `readonly_client._transport()` (`readonly_client.py:76-107`) — one place to audit. Any future credential must arrive there as a header built inside the process from `os.environ`, and must never be persisted, logged or echoed.

---

## 9. (v) Consolidation plan — one canonical document, an archive set, and a retirement list

### 9.1 The canonical set (kept, authoritative — everything else defers to these)

| Role | Document | Why it is the one |
|---|---|---|
| **Design contract (normative)** | `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` | It is the contract the code was built against (read ops W1–W4, state layout, rule semantics); plans cite it rather than restating it. |
| **Gate contract (normative)** | `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` + `docs/free-cash-monitor-routine/verify-readonly.sh` | These are executable/checkable gates, not prose. A gate that is a document is already suspect; keep the executable one. |
| **The single plan for the open blocker** | **`docs/free-cash-monitor-routine/DELEGATION-2026-09-20/RESEARCH-PLAN.md` (this file)** | It supersedes every other *plan* document: one ranked task list, one decision framework, one verification protocol, one credential policy, one consolidation decision. |
| **Evidence registers (retained, frozen)** | `PROVIDER-FINDINGS-REVERIFIED.md`, `PROVIDER-DECISION-PACKET-2026-09-20.md`, `docs/freecash-monitor-audit-evidence.md` | These are evidence, not plans: they record what was fetched and observed, with dates. Freeze them — correct them with a dated correction, never fork a "V5". |
| **Machine-readable rule/evidence standard** | `docs/free-cash-monitor-routine/delegation-manifest.json` | It already carries R1–R4, the evidence standard and the hard constraints; **update it in place** (its `degraded`/effort fields are already known to be wrong — see 9.3) rather than adding a parallel manifest. |
| **Live backlog (kept, single source)** | `docs/free-cash-monitor-routine/DELEGATION-DISPATCH-2026-09-20.md` | Its §2 workstream table (W1-FIX…W6) is the live work list; this plan defers to it for delivery sequencing and only owns the data-source blocker. Do not restate its table anywhere else. |

**Canonical-set rule going forward:** a new fact goes into **one** of these by role — design → `ROUTINE-DESIGN.md`; gate → `RULE-GATE-CHECKLIST.md`; plan/decision → this file; evidence → an evidence register with a fetch date. A new *variant plan* (V5, FINAL, REVISED) is not permitted; extend the canonical file or add a dated evidence entry.

### 9.2 The archive set (superseded planning artifacts — nothing deleted outright)

**OBSERVED inventory.** The `docs/free-cash-monitor-routine/` directory holds **20 files** (so not all of them are plans). Counting every free-cash/FreeCash plan-like document repo-wide yields **~35**, which matches the "roughly 30 overlapping plan documents" premise:

| Location | Count | Files |
|---|---|---|
| `docs/free-cash-monitor-routine/` | 20 | the 20 listed in the directory listing — of which **14 are plans/research** and 6 are design/gate/evidence |
| repo root | 6 | `daily-status-monitoring-specification.md`, `DAILY_MONITORING_DESIGN_SUMMARY.md`, `free-cash-automation-workflow.md`, `free-cash-finance_monitoring_plan.md`, `free-cash-finance-monitoring-specification.md`, `plan.md` |
| `docs/` (top level) | 6 | `freecash-automation-workflow-plan-v2.md`, `free-cash-finance-automation-workflow-plan.md`, `freecash-monitoring.md`, `freecash-monitor-research-plan.md`, `freecash-monitor-workflow-plan.md`, `freecash-monitor-audit-evidence.md` |
| `docs/research-workflows/` | 2 | `FREE-CASH-WORKFLOW-PLAN.md`, `FreeCash-opp-4a3f4cfc-research-plan.md` |
| `.hermes/plans/` | 3 | `2026-09-17_213843-…`, `…213918-…`, `…214017-free-cash-finance-automation*.md` (three same-day near-duplicates) |
| `resources/daily-monitoring-spec.md` | 1 | — |
| `server/data/freecash-monitor/` | 2 | `README.md`, `INTEGRATION_STATUS.md` |
| `finance-monitor/` | ~6 | `docs/architecture.md`, `docs/rules.md`, `config/scheduler_setup.md`, `tests/scenarios.md`, `.COMPLETION_REPORT.md`, `.VERIFIED.md` — plus a whole superseded implementation |

**Archive action (in this order, and never as a raw delete):**
1. Create `docs/free-cash-monitor-routine/archive/2026-09/` (planning) and `…/archive/2026-09/rejected/` (documents that prescribe forbidden write paths — see below).
2. Move each superseded plan there and **prepend a two-line banner**: `SUPERSEDED — do not execute. Canonical: docs/free-cash-monitor-routine/DELEGATION-2026-09-20/RESEARCH-PLAN.md` + the one line that says why it was superseded (e.g. "asserts `degraded:false` for every source, contradicted by `changedetect.py:168`").
3. **Archive rather than delete, as the default.** `monitoring/` and `docs/free-cash-monitor-routine/` are untracked by git, so a deletion here is **unrecoverable** — there is no history to restore from. Deletion is warranted **only** for byte-identical duplicates (the three same-day `.hermes/plans/` entries and the `DELEGATION-WORKFLOW-PLAN.md` / `DELEGATED-WORKFLOW-PLAN.md` near-duplicate pair are the candidates — confirm byte-identity *before* deleting anything).
4. **Documents that prescribe forbidden write paths go to `archive/…/rejected/` with a loud banner**, never merely archived as "old": `docs/freecash-monitoring.md` (proposes `POST /withdraw` and `POST /survey/complete`) and `server/data/freecash-monitor/INTEGRATION_STATUS.md` (asserts a `freecash.io` `X-API-Key` API for a domain that is a parked for-sale lander). These are the documents most likely to mislead a future agent into building an earning action. Neither may be executed, and both must carry the reason they are wrong.
5. **Archive the entire `finance-monitor/` tree as superseded.** It contains `src/action_executor.py` and `src/api_client.py` — an execution path — which contradicts R4 outright. **This is a live hazard:** it is a plausible-looking implementation of the same goal with exactly the capability the current routine forbids by design. Retire it with a banner pointing at `monitoring/freecash/` and stating that no execution path may exist.
6. Update the canonical set's cross-references in one pass, and record the archival in the decision record (§9.5) so the move itself is auditable.

### 9.3 Known-wrong content that must be corrected *in place* (not archived away)

- `delegation-manifest.json` records `degraded: false` for O2/O3/O4 and `degraded: true` for O1. **Contradicted by the code:** `degraded` is a hard-coded literal `True` (`changedetect.py:168`, `run_daily_check.py:98`), so *every* source is degraded today. Correct in place.
- The same file's effort fields for O1 (`6–10 h`) and O4 (`1–2 h`) are corrected by the later packet (O4 ≈ 0 build hours — it is already implemented; O1's missing piece is the *service*, 2–3 h).
- Any README/text that says the read-only checker's **exit 2 means "not a failure"** must be corrected: exit 2 = **a target did not exist — a failure, never a pass**.

### 9.4 Retirement list — the broken legacy artefacts

Each row is a **disposition plan**. Nothing here was executed by this pass; every deletion requires the review of §9.2 step 3 and, for anything inside `server/`, a human decision under R4.

| # | Artefact | Observed defect | Disposition | Blocking work |
|---|---|---|---|---|
| **1** | `server/scripts/freecash-daily-monitor.mjs` | **Cannot run.** `node --check` → `SyntaxError: Unexpected token ':'` (TypeScript annotations in a `.mjs`, ~line 41). Its default target was also a fabricated endpoint (`api.freecash.com/v1/status`, since confirmed 404). | **RETIRE.** Move to `archive/2026-09/retired/` with a tombstone naming `monitoring/freecash/run_daily_check.py` as the replacement. Update anything that references it (see #4). | Confirm no live scheduler or config references it. (Nothing is scheduled today: `schtasks` query for freecash/daily-monitor/missed-day returned 0. CARRIED.) |
| **2** | `scripts/monitoring/free-cash-daily-check.py` | Defines `main()` but has **no `__main__` guard** → silent exit 0. A monitor that fails by doing nothing is the worst failure mode. | **RETIRE** to `archive/…/retired/` with a tombstone. | None beyond the move; note it in the decision record. |
| **3** | `scripts/make_freecash_check.py` | Computes its base dir with `Path(__file__).resolve().parents[2]` → **off-by-one**, resolving to `D:\data\freecash` (outside the repo). | **RETIRE** to `archive/…/retired/` with a tombstone. | None beyond the move. |
| **4** | `config/freecash-crontab` | Contains a placeholder path (`/path/to/AgenticOS`) and calls the broken script from #1. | **RETIRE** — archive and delete the whole file, or replace its content with a two-line tombstone naming the canonical entry point. | Must be retired **together with #1**, in one change, so no config ever points at a retired script. |
| **5** | `server/src/adapters/freecashMonitorAdapter.ts` | Returns a **hardcoded `externalConnected: false` stub**; **NOT registered** in `server/src/index.ts`, yet **imported** by `server/src/transports`-adjacent modules `turnController.ts` and `operatorController.ts`. It looks like a live integration and is not one. | **RETIRE, but as a reviewed multi-file change** — not a silent delete: remove the two import sites, remove or repurpose the adapter, and update the TypeScript tests that reference it (`server/src/__tests__/truthfulDelegationAndFreeCash.test.ts` and neighbours). Because the adapter is compiled into `server/dist/…` and `release/win-unpacked/…`, retiring the source means those build outputs become stale — regenerate or ignore deliberately. | **Human approval (R4)** + test-impact analysis + a read of the three call sites *before* any edit. |
| **6** | `server/scripts/verify-freecash-rules.mjs` — *(additional recommendation, not on the mandated list)* | Printed `4/4 PASSED`, exit 0, while certifying a file that **does not parse**; its "rules" are substring-presence tests whose exit code is 0 on both branches (and it also passed on a copy into which a real `POST`/withdraw call had been appended). | **RETIRE.** It is the mechanism by which #1 stayed "verified". Leaving it in place invites a future agent to trust the same empty green. | Confirm no active pipeline calls it, then archive with a tombstone explaining *why* an un-failable checker is worse than no checker. |
| **7** | `finance-monitor/` (whole tree) — *(additional recommendation)* | Contains `src/action_executor.py`: an execution path for the same goal, forbidden by R4. | **Archive the tree as superseded** (see 9.2 step 5). | Written confirmation that nothing imports it. |
| **—** | Related but **out of scope** (owned by the wider Free Cash Finance Automation workflow, not this routine): `scripts/create-free-cash-fina.mjs`, `server/tasks/daily-finance-monitor.py`, `scripts/notification_service.py`, `scripts/monitoring/rule_gate_verify.py`, `server/dist/**` and `release/win-unpacked/**` mirrors. | — | **Named, not touched.** `rule_gate_verify.py` in particular is a gate referenced by the dispatch and must be **extended, not retired** (its R1 single-file scope defect is the known gap). | Decide ownership in the decision record. |

### 9.5 The decision record this plan produces (the actual deliverable of the consolidation)

One signed block, in one place, answering: authorised read source (A / B / C); the provider string that replaces `PROVIDER_ENDPOINT_UNKNOWN` **or** an explicit "no automated source authorised"; the canonical data root; whether B is wanted; the archival performed; the retirement of items 1–7; and the acknowledgement that **while every snapshot is `degraded:true`, a "no change" report is not evidence that the real account is intact, earning or unchanged, and will not be presented as such.**

---

## 10. UNRESOLVED register (nothing below may be asserted as fact until closed)

1. **Which platform holds the monitored balance** — UNRESOLVED, operator-held. Gates Candidate C entirely.
2. **Whether the entity holds an account on any candidate provider** (and its onboarding/KYC/entitlement state) — UNRESOLVED.
3. **The provider endpoint contract**: host, path, verb set, auth scheme, response field names and units — **UNRESOLVED; must remain the literal `PROVIDER_ENDPOINT_UNKNOWN` until a human-performed verification (§7) replaces it.**
4. **Whether any candidate credential can be scoped read-only** — UNRESOLVED (an absence of documentation is not proof of absence).
5. **Rate limits for every candidate provider** — UNRESOLVED.
6. **Terms position for any platform other than freecash.com** — UNRESOLVED (freecash.com itself is documented and closed).
7. **Application-level liveness of the Cashfree Payouts balance endpoint** — UNRESOLVED (the unauthenticated probe returned an edge-level HTML `403`, not the documented application JSON).
8. **Whether the platform offers a statement/export control, or sends periodic status email** — UNRESOLVED.
9. **Whether the local metrics service will be built** (Candidate B) — a decision, not yet taken.
10. **The canonical data root** (`data/freecash` vs `data/freecash-monitor`) — UNRESOLVED; two roots produce two empty ledgers.
11. **Why the suite once reported `failures=2`** while four other runs were green — UNRESOLVED; the flake is uncharacterised, so no verdict is deterministic yet.
12. **Whether the real Windows toast renders on this host** — UNRESOLVED (only the stub path is proven).
13. **Whether the configured Telegram variables are valid** — UNRESOLVED (validating needs an external send, which is forbidden).
14. **Whether `StartWhenAvailable` actually catches up a plain daily trigger, and whether the active power plan permits wake timers** — UNRESOLVED.
15. **Whether any credential is provisioned in the runtime env** — CARRIED as "no `FREECASH_*` / `HG_CASH_*` / `CASHFREE_*` / `SMTP*` / `MAIL*` / `IMAP*` name exists" (names-only check, 2026-09-20); re-check before wiring anything.

---

## 11. Definition of done for this plan

The blocker is closed when **all** of the following are true, each with a recorded observation:

1. `alerts/alerts.jsonl` in the canonical data root contains **at least one** Rule-3 change line produced from a genuine change in operator-entered figures, with the matching `PENDING` / `NOT_EXECUTED` approval item.
2. `snapshots/<day>.json` contains **non-null** figures for the days in question — and still says `"degraded": true` unless and until §5 T7 has landed *and* a human-verified provider read exists.
3. `python tests/run_all.py` is green on two consecutive runs of the same pinned revision, or the flake is named and captured.
4. The provider question is answered in writing, and either a verified endpoint exists with its verification record, or the `PROVIDER_ENDPOINT_UNKNOWN` literal is confirmed as a deliberate, permanent decision.
5. The canonical/archive/retired state of §9 is executed, and no config, script or scheduled task references a retired artefact.
6. No secret exists anywhere under `D:/AgenticOS`, and the credential policy (§8) is acknowledged in the decision record.
7. The honesty sentence ("a `no change` report from a degraded source proves nothing about the real account") is carried in every operator-facing report.

**And the standing rule this plan exists to protect:** *a monitoring routine that cannot go red is not monitoring, and a value nobody verified is not data.* An endpoint is not real because it is plausible; it is real because a human read it by hand and wrote down exactly what happened.

---

*Pass record: this file is the only artefact written by this pass. No status read was executed, no routine run, no test run, no network request of any kind (including loopback), no credential read, no scheduler query, no message sent, no provider contacted, no existing file modified, moved or deleted, and no `git add`/`commit`/`stash` executed. Every code reference above was verified by reading the file at the stated line during this pass; every provider/ToS/robots claim is marked CARRIED from a named prior artifact and was **not** re-fetched here.*

# PROVIDER DECISION PACKET — 2026-09-20 — Free Cash daily status-monitoring routine: which read source is authorised

**Repository:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11, git-bash, non-elevated workstation
**Routine:** `monitoring/freecash/` (entry point `run_daily_check.py`, read source selectable with `--source operator_state|metrics_http`)
**Written:** 2026-09-20 by the research/decision subagent (`deleg_462be34a` / W2) · **Gate:** G2
**Supersedes nothing.** Read alongside `DELEGATION-DISPATCH-2026-09-20.md`, `PROVIDER-FINDINGS-REVERIFIED.md` (2026-09-18), `PROVIDER-CONTRACT-RESEARCH-V2.md` (2026-09-18).
**This file is the only file this pass created.** No existing file was modified, no credential was used, no authenticated provider request was made, no account was created, no scheduler change was made, no message was sent, no purchase was made, no `git add`/`commit`/`stash` was run. Every provider-facing request in this pass was an unauthenticated public GET of a documentation page, ToS page or `robots.txt`; every local command was read-only or ran against a scratch `$LOCALAPPDATA/Temp` data root.

**Evidence standard:** every factual claim below is labelled **VERIFIED** (with the URL or command actually fetched/run today, and what was seen) or **COULD NOT VERIFY** (with what was tried). No URL is cited that was not fetched during this pass. Prior documents were treated as unverified until re-fetched.

---

## 1. The unresolved question this packet answers

**The routine cannot currently read the real account.**

Its only working read source is a file the operator types numbers into by hand (`<data root>/state/operator-state.json`). Every snapshot the routine writes is stamped `"degraded": true`, because the flag is a hard-coded literal in `changedetect.build_snapshot()` (`monitoring/freecash/changedetect.py`, line 168) and in `run_daily_check.observed_for()`. Consequently a `OK_NO_CHANGE` report proves only that the same numbers were entered twice — **it proves nothing about the real account.**

The operator must therefore decide **in writing which read source is authorised** for this routine. Until that decision is recorded, the correct status of the routine is: *built, rules enforced in code, account not observed.*

---

## 2. Options — the five required fields each

Effort is stated in hours with the owner named. "Revenue" in this routine means **visibility that the account is intact and earning** — the routine cannot create earnings and nothing here changes that.

### O1 — local read-only metrics endpoint (`GET /api/v1/status/metrics`) + operator-entered state file — the current degraded default

| Field | Value |
|---|---|
| **Expected Effort** | **3–5 h builder** (2–3 h to build and stand up a loopback-only read-only service that actually serves `GET /api/v1/status/metrics` — no such route or process exists today — plus 1–2 h to close the still-open acceptance work: the gate's R1 single-file scope defect, and one invocation of the suite that ran red today while four others ran green). **0.5 h operator** (approve the canonical state root). |
| **Time-to-Revenue** | Rules observable **same day** (already true: a scratch-root run today produced `RUN_OK … MONITOR_DEGRADED … lock=2026-09-20.lock`, then `SKIP_DUPLICATE_DAY 2026-09-20`); first full daily cycle **1–2 days**. **But this option produces no visibility of the account:** the metrics half reads the workstation's own metrics, the operator half reads a file the operator typed, and both yield `degraded: true`. |
| **Dependencies** | Python interpreter that has tzdata (the routine's own interpreter; `py -3` = 3.14.7 is disqualified — it raises `ZoneInfoNotFoundError` before the day lock is created); **a process that serves `/api/v1/status/metrics` (does not exist)**; writable state root; a decision on the canonical root, which is currently ambiguous — `paths.py` defaults to `D:/AgenticOS/data/freecash-monitor` while the dispatch pins `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash`. No provider account, credential or approval. |
| **First Concrete Action** | `cd /d/AgenticOS && FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash" python monitoring/freecash/run_daily_check.py --source operator_state --print-state` — read-only, consumes no day lock; prints the ledger and the pending-approval count. (Executed today against a scratch root: printed `timezone Europe/Berlin`, `pending items: 0`, exit 0.) |
| **Named Blocker** | **No local metrics service exists and none is scheduled.** Today: `curl http://localhost:3001/api/v1/status` → curl exit 7 (connection refused) and `python run_daily_check.py --source metrics_http` → `RUN_FAILED … ReadError: GET /api/v1/status/metrics failed: [WinError 10061]`, exit 5. No route serving `/api/v1/status/metrics` exists anywhere in the repo (only clients reference it). **O1 cannot observe the account under any configuration, even when fully repaired.** |
| **tos_permitted** | `not applicable — no provider is contacted` |

### O2 — HG.Cash documented read-only `GET /accounts` (operator-held, unverified account + dashboard token)

| Field | Value |
|---|---|
| **Expected Effort** | **2–4 h builder** *if the account exists*: add `^/accounts$` and `^/account/[^/]+/balance$` to `readonly_client.ALLOWED_PATHS`, add a provider host to the host allowlist, add a `--source hg_cash` selector, map `balance`/`pendingFees`/`netBalance`/`status` onto the snapshot schema, log status code + field names with values `[REDACTED]`, and make `degraded` a function of the source instead of the hard-coded `True`; then re-run `verify-readonly.sh` (today `forbidden=0 exempt=28 missing_targets=0` → PASS) and the suite. **0.5 h operator** (generate the token in the HG.Cash dashboard, place it in `%LOCALAPPDATA%\hermes\.env`; never in the repo). *If no HG.Cash account exists*, engineering effort is 0 h and the effort becomes an operator onboarding project measured in weeks (see Blocker). |
| **Time-to-Revenue** | **3 days – 2 weeks** if an existing, KYC-complete HG.Cash account is confirmed (confirm → token in env → builder wires → one redacted call logged). **2–6+ weeks if a new account must be onboarded**, because HG.Cash documents a three-step approval path (below). Visibility is provider-authoritative: this is the only option where the read is execution-path-free *and* the numbers come from the provider's own API. |
| **Dependencies** | (a) **Written confirmation by the operator that the entity holds an HG.Cash account** — none exists today; (b) a user-scoped Bearer token, documented format `cash_<64-char-hex>`, generated in the account settings page; **no such variable name exists in `%LOCALAPPDATA%\hermes\.env` today** (names-only check, 2026-09-20: no `HG_CASH_*`, no `FREECASH_*`); (c) HG.Cash onboarding approval — the docs' own sequence is *Step 1: Contact HG.cash · Step 2: Complete KYC · Step 3: Receive access to the platform*, "after HG.cash approves onboarding for your profile"; (d) outbound HTTPS; (e) code changes above. Rate limits are not documented — start at 1 request/day (R1 already caps this). |
| **First Concrete Action** | Operator runs, with **their own** token exported in that shell only (never in a file in the repo, never pasted into the routine): `curl -sS -o /dev/null -w 'code=%{http_code}\n' -H "Authorization: Bearer $HG_CASH_TOKEN" https://hg.cash/api/v1/accounts` — a single GET; record only the status code and field names, `[REDACTED]` for every value. Without a credential, the same check today returns `HTTP/1.1 401` with body `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}`. |
| **Named Blocker** | **Account ownership is unconfirmed in writing.** No evidence exists in the repo or on this host that the entity holds an HG.Cash account; HG.Cash is a LatAm settlement platform (ARS/BRL/CLP/BOB rails per its own docs), not a rewards platform, and it entered the candidate list only from repo planning notes. If no account exists, O2 stops being a two-week wiring job and becomes an onboarding project whose duration HG.Cash controls. |
| **tos_permitted** | `permitted — the provider's own documented API, not scraping` |

### O3 — Cashfree Payouts `GET /payout/v1/getBalance` (merchant account with Payouts enabled; activation queue)

| Field | Value |
|---|---|
| **Expected Effort** | **4–8 h builder** plus **a rule decision by the operator** (1–3 h operator for credentials and activation). The rule decision dominates: the documented call is `GET /payout/v1/getBalance` with `Authorization: Bearer <token>`, but that token is minted by `POST /payout/v1/authorize` with `X-Client-Id` + `X-Client-Secret` — a write verb and a body-less POST that the routine's transport refuses by construction (GET/HEAD only, loopback hosts only, bodies rejected). Either the operator mints a short-lived token out-of-band each day (routine stays GET-only) **or R2 is deliberately amended** — which is the operator changing their own rule, and must be recorded as such. |
| **Time-to-Revenue** | **1–4 weeks**, dominated by Cashfree's Payouts activation queue; unbounded if activation is refused. And the visibility obtained is a **merchant payout balance**, not a FreeCash earning balance — only useful if the earning funds actually land there. |
| **Dependencies** | Cashfree merchant account; **Payouts API enabled** (the documented unentitled state is `403 {"status":"ERROR","subCode":"403","message":"APIs not enabled…"}`); `X-Client-Id` + `X-Client-Secret` (write-capable; **no read-only key scope is documented on the pages fetched** — an absence of documentation, not proof it cannot exist); possibly an RSA public key + `X-Cf-Signature` if the egress IP is not whitelisted; the R2 decision; code changes as in O2. |
| **First Concrete Action** | Operator opens the Cashfree merchant dashboard (`https://merchant.cashfree.com`) → **Developers / API keys** and records whether a Payouts-enabled key already exists; if not, submits the Payouts activation request from that same dashboard (the docs themselves point at `https://merchant.cashfree.com/merchants/landing?env=prod&raise_issue=1`). Before doing either, the operator can confirm the endpoint edge-rejects unauthenticated calls: `curl -sS -o /dev/null -w 'code=%{http_code} type=%{content_type}\n' https://payout-api.cashfree.com/payout/v1/getBalance` → today `code=403 type=text/html` (generic edge page, **not** the documented JSON). |
| **Named Blocker** | **Payouts API is not enabled for any account this operator controls, and the enabling step is Cashfree's queue, not a build task.** The documented unentitled response is `403 "APIs not enabled"`; no amount of code changes that. |
| **tos_permitted** | `permitted — the provider's own documented API, not scraping` |

### O4 — operator-entered state file only (no provider at all, zero automation, ~60 s/day of operator login)

| Field | Value |
|---|---|
| **Expected Effort** | **0 h builder — the source is already implemented and was exercised today** (`operator_state.py`: template creation, exact-day record lookup, `degraded: true` on every snapshot; observed `RUN_OK … outcome=INITIAL_BASELINE` with a seeded record). **0.5 h operator one-time** (create the state root, settle the canonical root), then **~60 s/day**: log in to the provider dashboard yourself, read four figures (account status, total earnings, balance, pending), append one record. |
| **Time-to-Revenue** | **Same day.** The first typed record produces a baseline snapshot today, and R3 change notifications begin on the second day. "Revenue" here is *the operator's own eyes on the dashboard* recorded in a file — real visibility, but human-attested, not machine-verified: the file says what the operator saw, not what the provider said. |
| **Dependencies** | Writable state root; the routine's interpreter; the operator's ordinary personal login on the provider site (no credential is given to the routine, and none may be asked for — no passwords, session cookies or 2FA codes). No provider account, no token, no approval, no network egress. |
| **First Concrete Action** | `cd /d/AgenticOS && FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash" python -c "import sys; sys.path.insert(0,'monitoring/freecash'); import operator_state; print(operator_state.ensure_template()); print(operator_state.paths.operator_state_path())"` → creates `D:/AgenticOS/data/freecash/state/operator-state.json` with an empty `records` list and a template record. (Executed today against a scratch root: `created= True`, path printed.) Then append today's record and run: `FREECASH_DATA_ROOT="D:/AgenticOS/data/freecash" python monitoring/freecash/run_daily_check.py --source operator_state`. |
| **Named Blocker** | **none** — with the plain statement that "no blocker" is not evidence of a healthy account: a `no change` result from O4 proves only that the operator typed the same numbers twice. |
| **tos_permitted** | `permitted — a human reading their own dashboard; the provider's terms permit use "for your personal, non-commercial use only"` |

### O5 — any scripted browser session / scraping against freecash.com — **REJECTED**

| Field | Value |
|---|---|
| **Expected Effort** | 4–6 h builder *if it were permitted* (it is not), plus permanent maintenance of a session that the provider actively breaks. |
| **Time-to-Revenue** | **Negative expected value — never.** The plausible outcome is restriction of the account being monitored and forfeiture of unredeemed rewards, i.e. destruction of the visibility being sought. |
| **Dependencies** | Stored account credentials + live 2FA handling — exactly the credential pattern the operator's rules forbid, and the pattern this routine's transport cannot express. |
| **First Concrete Action** | No command follows. The action today is to write `REJECTED` against O5 in the sign-off block (§8). If you want to see the basis for yourself, `curl -sS https://freecash.com/robots.txt` prints the disallow list (VERIFIED today: HTTP 200, 298 bytes). |
| **Named Blocker** | **The provider's own terms.** `https://freecash.com/en/policies/terms` — §17 "Restrictions and Prohibited Uses", part 2, second bullet, page states "Last Updated: July 17, 2026" / "(Effective: July 17, 2026)": *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring** or copying any of the material on the Website."* The same section adds *"Use any manual process to monitor or copy any of the material on the Website … without our prior written consent."* and *"To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity … Such behavior is strictly prohibited…"* §19 "Monitoring and Enforcement; Termination" adds that the operator's rewards may be suspended or voided. `https://freecash.com/robots.txt` independently disallows `/user/`, `/myprofile`, `/fc-api/` (and `/offer/`, `/w/`, `/scd-cgi/`). You cannot authorise this option; the provider has already refused it. |
| **tos_permitted** | **`prohibited`** |

### O6 *(extension found this pass)* — manual dashboard statement / export, parsed locally as a records backstop

| Field | Value |
|---|---|
| **Expected Effort** | **2–4 h builder** (a local parser for one known export format + a watched drop folder; **no network egress at all**); **~15 min per period operator** (download the export and drop it in the folder). |
| **Time-to-Revenue** | **1–2 weeks** to the first useful artefact — and only if the provider offers an export at all, which is unverified. Highest evidential value per hour of any option *if* an export exists, because a provider-generated statement is not operator-typed. |
| **Dependencies** | An export/report/statement control that actually exists for the operator's provider; a local drop folder; no credentials, no provider account action beyond the operator's normal dashboard use. |
| **First Concrete Action** | Operator opens their provider dashboard and looks for **Export / Reports / Statement**, then records yes-or-no and the exact menu path in §8. No command. |
| **Named Blocker** | **No export control is documented or verified for freecash.com.** The option is inert until the operator confirms one exists; do not assume it. |
| **tos_permitted** | `permitted — a human using a provider feature as intended` |

### O7 *(extension found this pass)* — passive parsing of the operator's own provider email

| Field | Value |
|---|---|
| **Expected Effort** | **3–5 h builder** (mailbox reader + event extractor; repo precedent `scripts/notification_service.py`); **0.5 h operator** (mailbox app-password into the Hermes env). |
| **Time-to-Revenue** | **1–3 weeks**, and strictly post-hoc: it cannot show a balance change that generated no mail, so it can never be the sole read source for R3. |
| **Dependencies** | The provider must actually send periodic balance/status mail (unverified; the ToS observed today commits only to service-related communications); mailbox credentials — **none configured today** (names-only check of `%LOCALAPPDATA%\hermes\.env`, 2026-09-20: no `SMTP*`, `MAIL*` or `IMAP*` entry; Telegram variables are present but a Telegram *send* was not tested and must not be without approval). |
| **First Concrete Action** | Operator searches their own mailbox for any FreeCash/Almedia message and records whether a periodic balance or statement email exists. No command. |
| **Named Blocker** | **Unknown whether the provider sends periodic status mail**; with no mail, there is nothing to parse. |
| **tos_permitted** | `permitted — reading one's own mailbox` |

---

## 3. What the routine can and cannot claim today

**It can claim, and these are structurally enforced in code plus observed on this host today:**

1. **Exactly one status check per operator-local calendar day.** `gate.acquire_day_lock()` uses an atomic exclusive-create day lock. Observed today in a scratch root: first run `RUN_OK 2026-09-20 … lock=2026-09-20.lock`, second run for the same day `SKIP_DUPLICATE_DAY 2026-09-20` (no read, no snapshot, no ledger write), and `--force-recheck` is refused (exit 3, request recorded in `logs/forced-recheck-requests.jsonl`).
2. **Read-only enforcement.** `readonly_client.request()` refuses any method other than GET/HEAD, refuses request bodies, refuses any host that is not loopback, and refuses any path outside a two-entry allowlist; a process-wide audit hook aborts `socket.connect`/`getaddrinfo` to non-loopback hosts; `_transport()` is the single socket call site in the whole routine. Static check today: `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → `forbidden=0 exempt=28 missing_targets=0` → **PASS, exit 0**.
3. **No execution path.** `approval_queue.enqueue()` creates `PENDING` / `NOT_EXECUTED` items and nothing in `monitoring/freecash/` acts on them. There is no withdraw, claim, cash-out, redeem or purchase code in the tree.
4. **Nothing is scheduled and nothing has ever run in production.** `schtasks /Query /FO LIST | grep -icE "freecash|daily-monitor|missed-day"` → **0** today. `data/freecash/` is empty and `data/freecash-monitor/` does not exist; every state file produced today lives in a scratch temp root.

**It cannot claim — and this is the sentence that must travel with every report it emits:**

> **It cannot claim the account was observed.** The read source is degraded. `degraded` is a hard-coded `true` in `changedetect.build_snapshot()` and in `run_daily_check.observed_for()`, so it is true for *every* snapshot from *every* source, today and after any provider wiring, until that code is changed. The only read source that works is a file the operator types into by hand; the alternative source exits 5 today because nothing listens on `localhost:3001`. Therefore **a "no change" report proves only that the same numbers were entered twice** — it is not evidence that the account is intact, earning, unfrozen, or unchanged, and **it must never be presented to the operator as evidence of a healthy real account.**

Supplementary honesty about the code state as measured today: the suite ran `tests=52 failures=0 errors=0 skipped=0`, exit 0, on four invocations, and once reported `failures=2 errors=0`, exit 1, whose failing test names were not captured — the routine's own suite is therefore **not yet deterministic**, and the acceptance gate's R1 single-file scope defect (per the 2026-09-20 dispatch) is still open. The routine is *built and rule-enforced*, not *verified*, and not *deployed*.

---

## 4. Re-verification record — VERIFIED / COULD NOT VERIFY (all of 2026-09-20)

### VERIFIED — freecash.com: automated access, including monitoring, is prohibited

| Claim | Evidence fetched today |
|---|---|
| ToS forbids automatic access "for any purpose, including monitoring" | `https://freecash.com/en/policies/terms` → **HTTP 200**, 424,956 bytes, final URL unchanged. Section heading **"17. Restrictions and Prohibited Uses"** (the page's own H2 list also contains "16. Use of the Website", "18. User Contributions", "19. Monitoring and Enforcement; Termination"). Clause: *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website."* |
| Same section bans scripts/bots and manual monitoring | *"Use any manual process to monitor or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, without our prior written consent."* · *"To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity, including but not limited to automating clicks, movements, or tasks within offers or apps. Such behavior is strictly prohibited, as it undermines the integrity of the platform and results in unfair advantages over other users."* |
| Personal use only; breach can void rewards | §16: *"These Terms of Services permit you to use the Website for your personal, non-commercial use only."* §19: *"Terminate or suspend your access to all or part of the Website…"* and *"…may suspend or void any Rewards or potential Rewards … but not yet successfully redeemed…"* |
| Document date | Page text: *"Last Updated : July 17, 2026"* · *"(Effective: July 17, 2026)"* |
| robots.txt disallows account paths | `https://freecash.com/robots.txt` → **HTTP 200, 298 bytes**, full body: `User-Agent: * / Allow: / / Allow: /r/*?worldcupbet=* / Disallow: /user/ / Disallow: /myprofile / Disallow: /r/ / Disallow: /_next/ / Disallow: /_ipx/ / Disallow: /offer/ / Disallow: /fc-api/ / Disallow: /scd-cgi/ / Disallow: /w/ / Disallow: /dev-playground/ / Disallow: /*mailto:* / Sitemap: https://freecash.com/sitemap.xml`. |
| No developer/docs portal | `https://freecash.com/docs` → **302 → `https://freecash.com/en/docs` → 404** today. |

### VERIFIED — the two retired leads are still dead

| Claim | Evidence fetched today |
|---|---|
| `https://api.freecash.com/v1/status` still 404s | GET → **404**; HEAD → **404**; and `https://api.freecash.com/` → **404**. (The repo's `server/scripts/freecash-daily-monitor.mjs` default target remains a fabricated endpoint.) |
| `freecash.io` is still a parked for-sale domain | `https://freecash.io/` → **HTTP 200, 114 bytes**, body is a client-side redirect: `<script>window.onload=function(){window.location.href="/lander"}</script>`. `https://freecash.io/lander` → **1 redirect** → `https://forsale.godaddy.com/forsale/freecash.io?utm_source=TDFS_BINNS2&utm_medium=parkedpages…` → **HTTP 403** "Access Denied" (Akamai edge). `https://freecash.io/llms.txt` → **HTTP 200, 571 bytes**: *"freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket."* **Therefore any "FreeCash.io API key" contract in this repo is wrong.** |

### VERIFIED — HG.Cash documented read-only endpoints and their gate

| Claim | Evidence fetched today |
|---|---|
| `GET /accounts` is documented, read-only, Bearer-authenticated | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` → **HTTP 200**, 311,484 bytes; and its markdown twin `.../get-user-accounts.md` → **HTTP 200**, 6,873 bytes, showing the OpenAPI block: server `https://hg.cash/api/v1` (plus `http://dev.hg.cash/api/v1`), `--request GET --url https://hg.cash/api/v1/accounts --header 'Authorization: Bearer ***'`. |
| Field list | Documented 200 example: `{"data":[{"id","name","balance","pendingFees","netBalance","status","currency","number","alias","platform{id,name}","company{id,name}"}],"count"}`; `status` enum on the balance page = `Operativa | Bloqueada | Cerrada`. |
| Token issuance is dashboard self-serve *inside an existing account* | `.../get-user-accounts.md`: *"1. **Generate your API token** in the account settings page"*; *"This API uses **Bearer Token** authentication…"*; token format `cash_<64-char-hex>` (sample value shown in the docs, **not** reproduced here). |
| Onboarding is approval-gated | `https://docs.hg.cash/introduction` → **HTTP 200**, 234,688 bytes: *"Step 1: Contact HG.cash"* · *"Step 2: Complete KYC"* · *"Step 3: Receive access to the platform"* — *"After HG.cash approves onboarding for your profile: Your account is created or activated…"*. |
| Full read/write surface visible | `https://docs.hg.cash/api-reference/openapi.yaml` → **HTTP 200**, 90,616 bytes; GET operations include `/accounts`, `/account/{id}/balance`, `/transaction/{id}/status`, `/transactions/{id}/receipt`, `/transaction-statuses`, `/transaction-types`; POST operations include `/transactions` (cash-out). The same token can call the write path — read-only-ness must be enforced by our client's allowlist, not by the credential. |
| Endpoint is live | `curl -sS -i https://hg.cash/api/v1/accounts` (no credential) → **HTTP/1.1 401 Unauthorized**, `X-Matched-Path: /api/v1/accounts`, body `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}`. |

### VERIFIED — Cashfree Payouts balance endpoint, and that its token needs a write-capable credential + a POST

| Claim | Evidence fetched today |
|---|---|
| `GET /payout/v1/getBalance` shape | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` → **HTTP 200**, 695,116 bytes: `--url https://payout-api.cashfree.com/payout/v1/getBalance`, header `Authorization` = "Bearer auth token" (required), 200 example `{"status":"SUCCESS","data":{"balance":"214735.50","availableBalance":"173980.50"}}`, 403 example `{"status":"ERROR","subCode":"403","message":"APIs not enabled. Please fill out the [Support Form](…)"}`, and a documented **v1.2** twin `get /payout/v1.2/getBalance`. |
| The read token is minted by a POST with client id + secret | `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` → **HTTP 200**, 755,333 bytes: `--request POST --url https://payout-api.cashfree.com/payout/v1/authorize --header 'X-Client-Id: <x-client-id>' --header 'X-Client-Secret: <x-client-secret>'`; documented failure `{"status":"ERROR","subCode":"401","message":"Invalid clientId and clientSecret combination"}`. No read-only key scope appears on either page fetched. |
| Unauthenticated liveness is not confirmable at the application layer | `curl -sS -o /dev/null -w 'code=%{http_code} type=%{content_type}' https://payout-api.cashfree.com/payout/v1/getBalance` → **403, `text/html`** (generic edge `403 Forbidden` page), **not** the documented JSON and **not** the documented `412 "Token missing in the request"`. |

### VERIFIED — local runtime facts, today

| Claim | Evidence |
|---|---|
| Nothing serves the local metrics endpoint | `curl http://localhost:3001/api/v1/status` → **curl exit 7** ("Failed to connect … Could not connect to server"); `python run_daily_check.py --source metrics_http` (scratch root) → `RUN_FAILED 2026-09-20 … [WinError 10061]`, **exit 5**. No repo route serves `/api/v1/status/metrics` — the only references are clients (`scripts/monitoring/free-cash-daily-check.py`, `monitoring/freecash/readonly_client.py` and its tests). |
| Operator-entered source works and is always degraded | Scratch root, no record: `RUN_OK … outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)`; scratch root with a seeded record: `RUN_OK … outcome=INITIAL_BASELINE source=operator_entered(data_available=True)`; both snapshots on disk contain `"degraded": true`. |
| Read-only static check is green | `bash docs/free-cash-monitor-routine/verify-readonly.sh monitoring/freecash` → `forbidden=0 exempt=28 missing_targets=0` → PASS, exit 0. |
| Test suite | `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0`, exit 0 on four invocations; one earlier invocation reported `failures=2 errors=0`, exit 1 (names not captured). |
| Nothing scheduled | `schtasks /Query /FO LIST \| grep -icE "freecash\|daily-monitor\|missed-day"` → **0**. |
| No provider credential is provisioned | Names-only read of `%LOCALAPPDATA%\hermes\.env` (values never read or printed): present names include `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HOME_CHANNEL`, `DEEPSEEK_API_KEY`, `API_SERVER_KEY` etc.; **no** `FREECASH_*`, `HG_CASH_*`, `CASHFREE_*`, `SMTP*`, `MAIL*` or `IMAP*` name exists. |
| Routine tree is untracked | `git status --porcelain monitoring/ docs/free-cash-monitor-routine/` → `?? monitoring/` · `?? docs/free-cash-monitor-routine/` — git cannot recover an edit; temp backups before edits remain mandatory. |

### COULD NOT VERIFY

- **Whether the entity holds any HG.Cash, Cashfree or freecash.com account.** Operator-only fact; nothing public can answer it. This single unknown gates O2 and O3.
- **Cashfree Payouts application-level liveness.** Attempted the unauthenticated probe; got the edge 403 HTML, not the documented JSON (and not the documented 412 for a missing token). Confirming it needs a credential, which this pass may not use.
- **Whether Cashfree offers a read-only-scoped key.** Not documented on either page fetched — absence of documentation is not proof, so this stays unknown rather than "no".
- **HG.Cash rate limits.** Not documented on any page fetched.
- **Whether freecash.com exposes any statement/export (O6) or sends periodic status email (O7).** Not documented anywhere fetched; the ToS commits only to service-related communications.
- **Validity of the existing `TELEGRAM_BOT_TOKEN` / `TELEGRAM_HOME_CHANNEL`.** Testing requires sending a message — an external write, forbidden this pass.
- **The two test names behind the single `failures=2` suite run.** The output was not captured before the next run came back green; the flake is uncharacterised.
- **`StartWhenAvailable` catch-up semantics for a plain daily trigger** (carried forward from 2026-09-18 as unproven; Microsoft's own wording restricts the property to tasks "with an end boundary or … repeat infinitely").

---

## 5. Corrections to prior documents (do not copy them blindly)

| Prior statement | Correction from today's evidence |
|---|---|
| `delegation-manifest.json` O4 `degraded: false`; O2/O3 `degraded: false` | **Contradicted.** `degraded` is a hard-coded `true` (`changedetect.py:168`, `run_daily_check.observed_for`). Every source is degraded today, including operator-entered data — observed in the snapshots written today. `degraded:false` for O2/O3 requires a code change, not just a working provider read. |
| `delegation-manifest.json` O1 effort `6-10 h`, O4 effort `1-2 h` | **Corrected.** The operator-entered source is already built and ran today (O4 build effort ≈ 0; ~0.5 h operator setup). What is actually missing for O1 is the *service* behind `/api/v1/status/metrics`: 2–3 h builder, and even then it cannot observe the account. |
| `DELEGATION-DISPATCH-2026-09-20.md` O2 first action: "`FREECASH_DATA_ROOT=… run_daily_check.py --source metrics_http` against the documented path" | **Contradicted and unsafe as written.** `--source metrics_http` reads the *local* metrics URL on loopback only; there is no `--source hg_cash`, and the transport's host allowlist is loopback-only, so that command cannot reach `hg.cash`. The correct first action is the operator's own `curl` (O2 above), followed by a builder change to the allowlist. |
| `DELEGATION-DISPATCH-2026-09-20.md` A2: `verify-readonly.sh` → `forbidden=2 … FAIL` | **Superseded today.** Same command now prints `forbidden=0 exempt=28 missing_targets=0` → PASS, exit 0. |
| `DELEGATION-DISPATCH-2026-09-20.md` A1: `tests=52 failures=6 errors=11` | **Superseded.** Today: `tests=52 failures=0 errors=0` (exit 0) on four runs; one run reported `failures=2` (exit 1). Still not deterministic. |
| `server/data/freecash-monitor/INTEGRATION_STATUS.md` — "FreeCash.io Platform APIs", `X-API-Key`, `parse.bot` listing | **Wrong, again confirmed today.** `freecash.io` serves a 114-byte redirect to a GoDaddy for-sale lander and its own `/llms.txt` says the domain is listed for sale. `X-API-Key` is the third-party marketplace's scheme, not any provider's. |
| `docs/freecash-monitoring.md` — proposes `POST /withdraw` and `POST /survey/complete` after approval | **Quoted here only as the anti-pattern that must NOT be built.** This routine's transport refuses non-GET/HEAD methods, refuses bodies, and its host allowlist is loopback-only; no write path may ever be added to satisfy that document. |
| 2026-09-18 finding that HG.Cash token issuance is self-serve with "no partner/approval step documented" | **Refined today.** Token generation inside an existing account is dashboard self-serve, but `docs.hg.cash/introduction` documents an approval-gated path before that account exists: Contact → KYC → *"After HG.cash approves onboarding for your profile"*. Effort and calendar time for O2 must include that gate. |

---

## 6. Recommended now

**Authorise O4 as the read source, keep every snapshot `degraded: true`, and treat O1 as not operational.**

1. **Today — O4 only.** It is the only source that is both compliant (no provider contact at all, ToS §16 personal use) and working (exercised today). Roughly 60 s/day of the operator's own time. Nothing else in this packet is authorised until §8 is signed.
2. **Today — do not repair O1 to look productive.** Stand up a real loopback metrics service only if a *local* health signal is wanted for its own sake; it can never observe the account, and its snapshots must stay degraded.
3. **This week — answer the one blocking question in writing**, replacing `PROVIDER_ENDPOINT_UNKNOWN`: *which provider holds the balance — HG.Cash, Cashfree, freecash.com, something else, or nothing yet?*
4. **If HG.Cash is confirmed → O2** is the first provider-authoritative upgrade (4 h build on a documented read-only GET; 0 h of R2 widening). Its blocker is ownership confirmation, not code.
5. **If Cashfree → O3**, and decide the R2 question *before* coding: operator-minted token out-of-band (preferred) vs a deliberate, reviewed exemption for `POST /payout/v1/authorize`. Time-to-visibility starts at the activation queue, not at the first commit.
6. **If freecash.com → no API path exists.** Say so plainly; then O4 + O6 (if an export exists) + O7 (if mail exists). Schedule no request to freecash.com, ever.
7. **O5 stays REJECTED**, quoting §17 and `robots.txt`, so it is not re-proposed. A monitor that violates the provider's own terms is not a monitoring routine; it is a liability to the account being monitored.
8. **Never present a `no change` report from a degraded source as evidence of a healthy account.** The routine's own output must keep carrying the degraded marker until a real provider read exists *and* the code makes `degraded` a function of the source.

---

## 7. The two things only the operator can decide (still open after this pass)

| # | Unknown | Why research cannot close it |
|---|---|---|
| 1 | Does the entity hold an HG.Cash account, a Cashfree merchant account, both, or neither? | Requires the operator's own login/entitlement; it decides whether any non-degraded read source exists at all. |
| 2 | Is the activity personal or commercial, and which provider is the monitored platform? | A factual/business determination, not a fetchable one; it also decides whether freecash.com's §16 "personal, non-commercial" framing applies. |

---

## 8. Operator decision record — sign in writing (this is the deliverable of the packet)

Copy this block into your own notes, answer every line, and only then authorise any build or scheduling work.

```
Free Cash daily status-monitoring routine — authorised read source, decided by the operator

Date (local):            ____________
Authorised read source:  [ ] O1  [ ] O2  [ ] O3  [ ] O4  [ ] O6  [ ] O7   (choose one primary; list any secondary)
O5 (scripted browser / scraping freecash.com):  [X] REJECTED  — terms prohibit automated access "for any purpose, including monitoring"
Provider holding the balance (literal string, replaces PROVIDER_ENDPOINT_UNKNOWN):  ______________________
Account exists today?    [ ] yes, KYC/onboarding complete  [ ] yes, onboarding pending  [ ] no  [ ] not sure
O6: does the provider dashboard offer Export / Reports / Statement?  [ ] yes → menu path: ____________  [ ] no  [ ] not checked
O7: does the provider send periodic balance/statement email?        [ ] yes  [ ] no  [ ] not checked
Canonical state root:    [ ] D:/AgenticOS/data/freecash   [ ] D:/AgenticOS/data/freecash-monitor   [ ] other: ____________
I understand that while every snapshot is degraded:true, a "no change" report is NOT evidence that the
real account is intact, earning or unchanged, and I will not be given one as if it were.   [ ] accepted
I understand O5 is refused by the provider's terms and will not be built.                  [ ] accepted
Signature:               ______________________
```

**After signing:** a signed copy belongs in `docs/free-cash-monitor-routine/` and the authorised source string is the one the builder wires in — nothing else is authorised, and no scheduled task may be registered until G1b/G3/G4 are green (dispatch §2).

---

*Pass record: this file is the only artifact written by this pass. No credential was used or stored, no authenticated provider request was made, no account was created, no scheduler entry was created or modified, no message was sent, no purchase was made, no existing file was modified, and no `git add`/`commit`/`stash` was executed.*

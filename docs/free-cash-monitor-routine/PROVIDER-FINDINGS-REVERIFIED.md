# PROVIDER-FINDINGS-REVERIFIED.md — live re-verification of the facts that decide whether an automated daily status read is legitimate

**Project:** Free Cash Finance Automation — daily status monitoring (workflow stage **W2**, research)
**Executed:** 2026-09-18 · **Host:** Windows 11 workstation (`D:\AgenticOS`, branch `hermes-rescue-20260908`) · **Shell:** git-bash/MSYS
**Scope actually performed:** read-only. No credential used, no authenticated request sent, no account action taken, no scheduled task created. The only file written is this one.
**Rules the findings serve:** R1 one check/day · R2 zero automated earning actions · R3 notify on earnings/status change · R4 human approval before any external action.

**Evidence standard:** every row below carries the exact URL or command used and the raw observed status code or quoted text. A fact that could not be observed on this run is labelled `COULD NOT VERIFY` even where a prior document asserts it. Prior findings in `RESEARCH-PLAN.md` were treated as **unverified** until fetched here.

**Re-run note:** the `/tmp` scratch path is *not* usable for redirecting native `curl` output on this host (MSYS path translation is disabled, so `-o /tmp/x` writes to a drive-relative path and the file is later missing). All captures below were written under `$LOCALAPPDATA/Temp/fcres/`.

---

## Q1 — Does freecash.com permit any automated/read-only access?

**Prior claim (RESEARCH-PLAN.md F1/F2, HIGH):** freecash.com (Almedia GmbH) forbids automated access outright, *including monitoring*; no public developer API; `/docs` and `/developers` → 404; `robots.txt` disallows `/user/`, `/myprofile`, `/fc-api/`.

#### Q1.1 The automation clause (verbatim)

- **Claim:** ToS contains a clause forbidding any "robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying".
- **URL:** `https://freecash.com/en/policies/terms`
- **Command:** `curl -sS -L -o fc_tos.html 'https://freecash.com/en/policies/terms'` → **HTTP 200**, `text/html; charset=utf-8`, 426 423 bytes, final URL unchanged (no redirect).
- **Raw observed (section heading immediately preceding the clause):** `<h2>17. Restrictions and Prohibited Uses</h2>` — the clause sits under **§17, part 2, second bullet**:
  > "Use any robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website."
- **Additional §17.1 bullet, observed on the same fetch (not in the prior finding, strengthens it):**
  > "To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity, including but not limited to automating clicks, movements, or tasks within offers or apps. Such behavior is strictly prohibited, as it undermines the integrity of the platform and results in unfair advantages over other users."
- **Section numbering:** the page's own `<h2>` list runs `1.` … `34.`, with **`17. Restrictions and Prohibited Uses`**, **`16. Use of the Website`**, **`19. Monitoring and Enforcement; Termination`** — the prior finding's section numbers are correct.
- **Document date observed on the page:** "Last Updated … **July 17, 2026**".
- **Confidence:** **HIGH**
- **Verdict:** **CONFIRMS** the prior finding, verbatim, and adds an explicit "bots, scripts" prohibition in the same section.
- **Design must:** treat any automated request to freecash.com — including a once-daily unauthenticated GET of an account/status page — as a Terms breach. R1's daily check may not be satisfied by a machine read of freecash.com. The rejected-option record (`Scripted browser against freecash.com`) is correctly rejected and must cite §17.1 and §17.2.

#### Q1.2 Legal exposure if the clause is breached (verbatim, same fetch)

- **Raw observed, §16 part 1:** "These Terms of Services permit you to use the Website for **your personal, non-commercial use only**."
- **Raw observed, §16 part 3:** "You must not access or use for any **commercial purposes** any part of the Website or any features, services, or materials available through the Website."
- **Raw observed, §19 (Monitoring and Enforcement; Termination):** "Terminate or suspend your access to all or part of the Website for any or no reason, including without limitation, any violation of these Terms of Services." and "…may **suspend or void any Rewards** … not yet successfully redeemed if we determine in our sole and absolute discretion that you have not complied with these Terms of Services."
- **Confidence:** **HIGH**
- **Verdict:** **CONFIRMS.** The downside of a breach is account restriction plus forfeiture of unredeemed rewards — not merely a ban.
- **Design must:** record this as the reason no automation may touch freecash.com. Note the §16 "personal, non-commercial use only" wording also argues against framing this routine as a commercial automation of that platform.

#### Q1.3 robots.txt Disallow rules

- **URL:** `https://freecash.com/robots.txt`
- **Command:** `curl -sS -L -o fc_robots.txt 'https://freecash.com/robots.txt'` → **HTTP 200**, `text/plain`, 298 bytes.
- **Raw observed, complete file:**
  ```
  User-Agent: *
  Allow: /
  Allow: /r/*?worldcupbet=*
  Disallow: /user/
  Disallow: /myprofile
  Disallow: /r/
  Disallow: /_next/
  Disallow: /_ipx/
  Disallow: /offer/
  Disallow: /fc-api/
  Disallow: /scd-cgi/
  Disallow: /w/
  Disallow: /dev-playground/
  Disallow: /*mailto:*

  Sitemap: https://freecash.com/sitemap.xml
  ```
- **Account-bearing paths covered by `Disallow`:** `/user/`, `/myprofile`, `/fc-api/`. (Also disallowed, for completeness: `/r/`, `/_next/`, `/_ipx/`, `/offer/`, `/scd-cgi/`, `/w/`, `/dev-playground/`, `/*mailto:*`.)
- **Confidence:** **HIGH** (file fetched in full and reproduced above)
- **Verdict:** **CONFIRMS** the prior three-path claim and additionally shows `/offer/`, `/w/`, `/scd-cgi/` are disallowed.
- **Design must:** no acquisition agent may fetch a disallowed path. Together with Q1.1, freecash.com is closed to automated reads *twice over* (ToS and robots).

#### Q1.4 `/docs` and `/developers`

- **Command:** `curl -sS -o /dev/null -w 'code=%{http_code} redirect=%{redirect_url}' 'https://freecash.com/docs'` → **HTTP 302**, `redirect=https://freecash.com/en/docs`
- **Followed:** `curl -sS -L … 'https://freecash.com/docs'` → final `https://freecash.com/en/docs`, **HTTP 404**, `text/html`, 55 279 bytes
- **Command:** `curl -sS -o /dev/null -w … 'https://freecash.com/developers'` → **HTTP 302**, `redirect=https://freecash.com/en/developers`
- **Followed:** → final `https://freecash.com/en/developers`, **HTTP 404**, `text/html`, 55 291 bytes
- **Confidence:** **HIGH** for "no public developer/docs portal exists at these paths".
- **Verdict:** **CONFIRMS** the prior 404 finding, with one correction of detail: the **raw first-hop status is 302, not 404** (there is a locale redirect `/x` → `/en/x`). The 404 is the status at the resolved URL. The prior document's flat "HTTP 404" is right in substance and imprecise in the raw code.
- **Design must:** record no developer API. Do not build against `/docs`, `/developers`, or the robots-disallowed `/fc-api/`.

**Q1 overall verdict: CONFIRMS** the prior finding — freecash.com forbids automated access including for monitoring, and exposes no public API.

---

## Q2 — Is freecash.io a platform with an API?

**Prior claim (F3, HIGH):** freecash.io is a parked GoDaddy "for sale" lander, not a platform.

- **Command:** `curl -sS -L 'https://freecash.io/'` → final URL `https://freecash.io/`, **HTTP 200**, `text/html`, **114 bytes**
- **Raw observed body, in full:**
  ```html
  <!DOCTYPE html><html><head><script>window.onload=function(){window.location.href="/lander"}</script></head></html>
  ```
- **Command:** `curl -sS -I 'https://freecash.io/'` → `HTTP/1.1 200 OK`, `Content-Type: text/html`, `Content-Length: 114`
- **Command:** `curl -sS -L -o fc_lander.html -w 'final=%{url_effective} code=%{http_code} …' 'https://freecash.io/lander'`
  → **1 redirect**, final URL
  `https://forsale.godaddy.com/forsale/freecash.io?utm_source=TDFS_BINNS2&utm_medium=parkedpages&utm_campaign=x_corp_tdfs-binns2_base&traffic_type=TDFS_BINNS2&traffic_id=binns2&`
  → **HTTP 403**, `text/html`, 403 bytes, body:
  ```html
  <HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1> You don't have permission to access "http://forsale.godaddy.com/forsale/freecash.io?" on this server.<P>Reference #18.b3a72917.1789708985.4a5ce58
  ```
- **Confidence:** **HIGH** for "freecash.io is a parked for-sale domain, not a platform". The lander *page* itself could not be rendered (the GoDaddy host answered 403 — Akamai bot protection), so the landed content is unobserved; the 114-byte client-side redirect and its absolute destination (+ `utm_medium=parkedpages`, `forsale.godaddy.com/forsale/freecash.io`) are the decisive evidence and were observed directly.
- **Verdict:** **CONFIRMS** (F3). Correction of detail: the parked destination is reached via a 114-byte JavaScript redirect to `/lander`, not by the root response carrying the lander HTML.
- **Design must:** any design assuming "FreeCash.io" endpoints (`X-API-Key`, `GET /withdrawals`, `total_earnings`) is built on a domain that serves no platform. The Hermes skill `automated-status-monitor` and its `references/api-compliance.md` assert exactly such endpoints and must be corrected, not trusted.

---

## Q3 — Read-only balance APIs a legitimate entity could use

### Q3.1 HG.Cash — accounts endpoint (documented fields)

- **Docs URL:** `https://docs.hg.cash/api-reference/accounts/get-user-accounts` → **HTTP 200**, 310 790 bytes
- **Raw observed docs text:** "Returns the authenticated user's accounts, including ledger balance, pending fees, net available balance (balance minus pending fees), and account status."
- **Raw observed path block:** `GET https://hg.cash/api/v1` … `/ accounts`
- **Raw observed 200 response example (verbatim from the docs page):**
  ```json
  { "data": [ { "id": "3c90c3cc-…", "name": "<string>", "balance": 123, "pendingFees": 123,
                "netBalance": 123, "status": "Operativa", "currency": "<string>",
                "number": "<string>", "alias": "<string>",
                "platform": { "id": "…", "name": "<string>" },
                "company":  { "id": "…", "name": "<string>" } } ],
    "count": 123 }
  ```
- **Confidence:** **HIGH**
- **Verdict:** **CONFIRMS** the prior field list (`id`, `name`, `balance`, `pendingFees`, `netBalance`, `status`, `currency`) and adds `number`, `alias`, `platform{id,name}`, `company{id,name}`, `count`.

### Q3.2 HG.Cash — single-account balance endpoint

- **Docs URL:** `https://docs.hg.cash/api-reference/accounts/get-account-balance` (and its `.md` form) → **HTTP 200**, 5 693 bytes
- **Raw observed:** `GET /account/{id}/balance`; "Returns the balance, pending fees, net available balance, currency, and account status for the authenticated user's account by ID."
- **Raw observed field list, verbatim:** `id` string<uuid> · `balance` number "Account ledger balance rounded to 2 decimals" · `currency` string · `pendingFees` number "Fees accrued but not yet collected" · `netBalance` number "Available balance after pending fees (balance minus pending fees)" · `status` enum<string> "Account lifecycle status" with options **`Operativa`, `Bloqueada`, `Cerrada`**
- **Confidence:** **HIGH**
- **Verdict:** **CONFIRMS** the prior claim including the `Operativa / Bloqueada / Cerrada` lifecycle values.

### Q3.3 HG.Cash — authentication and token issuance (self-serve claim)

- **Raw observed, OpenAPI description on the same docs host (`.md` source):**
  - "**Generate your API token** in the account settings page"
  - "**Authentication** — This API uses **Bearer Token** authentication. Include your user API token in the Authorization header, for example `Authorization: Bearer cash_y…re`."
  - "⚠️ Important Security Notes — Never share or expose your user API authentication token · Store tokens securely on your backend servers only · All API calls must be made from secure backend services"
  - Token format documented as `cash_<64-char-hex>`.
  - Ticket/self-serve nuance observed: the docs describe generating the token in **account settings**, and reference a dashboard-configured webhook signing secret — i.e. **no partner/approval step is documented**. Whether the *account itself* is provisioned/entitled is a separate matter (see Q4 / blocked list).
- **Confidence:** **HIGH** for the token mechanism being dashboard-generated and Bearer-based; **MEDIUM** for "no approval step exists" (an absence of documentation is not proof of no gating).
- **Verdict:** **CONFIRMS** the prior "Bearer token generated self-serve in the dashboard" claim.

### Q3.4 HG.Cash — unauthenticated liveness probe (no credential sent)

- **Command:** `curl -sS -i 'https://hg.cash/api/v1/accounts'`
- **Raw observed:**
  ```
  HTTP/1.1 401 Unauthorized
  Content-Type: application/json
  Server: Vercel
  X-Matched-Path: /api/v1/accounts

  {"error":"Missing or invalid authorization header. Expected: Bearer <token>"}
  ```
- **Command:** `curl -sS -o /dev/null -w 'code=%{http_code}' 'https://hg.cash/api/v1/account/1/balance'` → **HTTP 401**
- **Confidence:** **HIGH** — the endpoint is live and answers with a JSON error that names the expected auth scheme.
- **Verdict:** **CONFIRMS** the prior 401 finding. *Note:* the 401 on `/account/{id}/balance` was probed with a placeholder id `1`; the 401 (auth layer) rather than a 404/422 means the route is matched before the id is validated, which is consistent with a live route.
- **Design must:** this is the only fully documented, unauthenticated-probe-confirmed read-only balance source found. Its use still requires an account and a token held **outside** the repository (R4 / constraint 4).

### Q3.5 Cashfree Payouts — getBalance endpoint (documented)

- **Docs URL:** `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` → **HTTP 200**, 694 355 bytes
- **Raw observed:** `GET https://payout-api.cashfree.com/payout/v1/getBalance` (sandbox: `https://payout-gamma.cashfree.com`)
- **Raw observed description, verbatim:** "Use this API to get the ledger balance and available balance of your account. **Available balance is ledger balance minus the sum of all pending transfers**."
- **Raw observed required headers:** `Authorization` ("Bearer auth token", required) and `Content-Type` (required).
- **Raw observed 200 example, verbatim:**
  ```json
  { "status": "SUCCESS", "subCode": "200", "message": "Ledger balance for the account",
    "data": { "balance": "214735.50", "availableBalance": "173980.50" } }
  ```
- **Raw observed 403 example, verbatim:**
  ```json
  { "status": "ERROR", "subCode": "403",
    "message": "APIs not enabled. Please fill out the [Support Form](https://merchant.cashfree.com/merchants/landing?env=prod&raise_issue=1)" }
  ```
- **Also observed on the same page:** the documented error table maps **`403` → "Token is not valid"** and **`412` → "Token missing in the request"**.
- **Confidence:** **HIGH** for the documented method/path/fields.
- **Verdict:** **CONFIRMS** the prior documented path and field list.

### Q3.6 Cashfree — the v1.2 path string (prior item 7 was `COULD NOT VERIFY`)

- **Found and confirmed live:** `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12` documents `get /payout/v1.2/getBalance` with the same `balance` / `availableBalance` response and the same `403 "APIs not enabled…"` example, plus an optional `paymentInstrumentId` query parameter.
- **Confidence:** **HIGH**
- **Verdict:** **RESOLVES a prior `COULD NOT VERIFY`** (RESEARCH-PLAN.md §3.7). The v1.2 path string exists and is documented; it is *additional to*, not a replacement for, the v1 path.

### Q3.7 Cashfree — unauthenticated liveness probe (no credential sent)

- **Command:** `curl -sS -i 'https://payout-api.cashfree.com/payout/v1/getBalance'`
- **Raw observed:**
  ```
  HTTP/1.1 403 Forbidden
  Server: awselb/2.0
  Content-Type: text/html
  Content-Length: 118

  <html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center></body></html>
  ```
- **Also:** `curl -sS -o /dev/null -w '%{http_code}' 'https://payout-api.cashfree.com/payout/v1.2/getBalance'` → **HTTP 403** (same generic body shape).
- **Confidence:** **MEDIUM** for endpoint liveness — **HIGH** that the observed 403 is not the documented application error.
- **Verdict:** **PARTIALLY CONFIRMS / CORRECTS the prior finding.** The **status code 403 was observed**, as the prior finding said. But the prior finding attributed the *documented JSON body* — `"APIs not enabled. Please fill out the Support Form"` — to what an unentitled account receives. In this run the 403 body was a **generic `awselb/2.0` HTML "Access Denied" page**, i.e. a load-balancer/edge block, not the application's JSON. Notably the docs' own error table says a request with **no** token should return **412 "Token missing in the request"**, which was **not** observed. The likely reading is that an edge rule rejects the unauthenticated request before it reaches the application, so:
  - the **path** is documented and real (Q3.5),
  - the **endpoint's application-level liveness was NOT confirmed** by an unauthenticated probe,
  - the `"APIs not enabled"` string is a **documented** claim, not an observed one.
- **Design must:** do not present `403 "APIs not enabled"` as an observed live state of this operator's account. The 403-vs-412 mismatch should be recorded honestly; confirming the application response requires a token, which this research is forbidden to use.

---

## Q5 — What is "Free Cash Finance Automation"?

**Prior claim:** every reference is internal to this repo; no external product of that name exists.

#### Q5.1 In-repo references (command actually run)

- **Command:** `search_files pattern='Free Cash Finance Automation|FreeCash Finance Automation|freecash-finance-automation' path=D:/AgenticOS`
- **Raw observed:** **40 files** match. Named examples observed in the result set:
  `daily-status-monitoring-specification.md` · `design_doc.json` · `data/selfheal-audit.jsonl` · `finance_monitor_plan.json` · `free-cash-finance-monitoring-specification.md` · `free-cash-finance_monitoring_plan.md` · `free-cash-automation-workflow.md` · `docs/free-cash-finance-automation-workflow-plan.md` · `docs/freecash-monitoring.md` · `docs/freecash-automation-workflow-plan-v2.md` · `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md` · `docs/research-workflows/FreeCash-opp-4a3f4cfc-research-plan.md` · `docs/free-cash-monitor-routine/*` (ROUTINE-DESIGN, RESEARCH-PLAN, DELEGATION-*, DELEGATED-WORKFLOW-PLAN, PROVIDER-*, delegation-manifest.json) · `finance-monitor/**` · `resources/daily-monitoring-spec.md` · `scripts/create-free-cash-fina.mjs` · `scripts/notification_service.py` · `server/data/freecash-monitor/README.md` · `server/scripts/freecash-daily-monitor.mjs` · `server/tasks/daily-finance-monitor.py` · `server/tasks/README_daily-monitor.md` · `server/src/adapters/freecashMonitorAdapter.ts` · plus several `server/src/__tests__/*` and `server/src/domains/jarvisV2/turnController.ts`.
- **Confidence:** **HIGH** that the name is an internal construct used across repo docs, config, scripts, server code and tests.
- **Verdict:** **CONFIRMS** the prior in-repo half.

#### Q5.2 External product search

- **Query 1:** `"Free Cash Finance Automation"` (exact phrase) → returned no page of that name; results were unrelated cash-flow vendors (trezy.io, ProactiveCash, Lunos, Finoya, Seizmic, Obol).
- **Query 2:** `"Free Cash Finance Automation" product vendor software` → results again unrelated (Freefinance/Tracxn, CashFlo, Cashbook for Dynamics 365, Redwood "Finance Automation", Zoho Creator, Pcash, Cashflowy).
- **Verdict:** **CONFIRMS** — **no external product or vendor named "Free Cash Finance Automation" was found.** Stated explicitly: **none found.**
- **Confidence:** **MEDIUM** for the negative. Two web searches cannot prove non-existence of an obscure product; it establishes only that no such product is discoverable by exact-phrase search.
- **Verdict on prior finding:** **CONFIRMS.**
- **Design must:** treat the entity as an internal AgenticOS construct. There is no vendor whose API or ToS could be consulted for it; the provider question can only be answered by whichever platform the operator/entity actually holds funds with (Q4).

*(Third-party context observed but not relied on: `https://parse.bot/marketplace/…/freecash-io-api` returned HTTP 200 and markets "Freecash API" endpoints including withdrawals/earnings data for `freecash.io`. Its own title says "Freecash API – Leaderboard, Withdrawals & Stats". This is a third-party scraper listing for a domain that Q2 shows is a parked for-sale lander, so it is an unreliable source and is not used to support any finding here.)*

---

## Q6 — Notification channels reachable from this workstation, free, without repo secrets

All probes below were read-only existence/capability checks. No configuration file was created; no secret value was printed. For the Hermes `.env` the probe listed **variable names only**.

| Channel | Exact dependency | Observed on this host | Command / raw result | Confidence |
|---|---|---|---|---|
| **Append-only local JSONL log** | none (filesystem only) | **Available** | target dir exists and is writable-owned by `cd-pr`: `ls -la D:/AgenticOS/docs/free-cash-monitor-routine/` (11 files listed, e.g. `RULE-GATE-CHECKLIST.md`, `verify-readonly.sh`) | **HIGH** |
| **Windows-native toast** | WinRT `Windows.UI.Notifications.ToastNotificationManager` + `Windows.Data.Xml.Dom.XmlDocument` via PowerShell | **Available** | `TOAST_TYPES_LOADED=OK` | **HIGH** |
| `BurntToast` module (optional nicety) | PowerShell module | **Not installed** | `BURNTOAST=NOT_INSTALLED` | **HIGH** |
| **stdlib `smtplib`** | Python stdlib | **Available** | `SMTPLIB=OK python=3.11.9` | **HIGH** — but **no mailbox credentials are configured** (see `.env` names below) |
| **Himalaya mail CLI** | external binary | **Absent** | `HIMALAYA=ABSENT` | **HIGH** |
| **Hermes `.env` (home for secrets)** | file at `%LOCALAPPDATA%\hermes\.env` | **EXISTS** | `HERMES_ENV=EXISTS` | **HIGH** |
| **Telegram push** | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_HOME_CHANNEL` in the Hermes `.env` | **Configured already** — no new secret needed | names present in `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HOME_CHANNEL`, `TELEGRAM_ALLOWED_USERS` | **HIGH** that the variables exist; **MEDIUM** that they are valid (validity was not tested — testing would send a message) |
| **ntfy.sh topic push** | a topic string (effectively a password) in the Hermes `.env` | **Not configured** — no `NTFY*` variable exists | `.env` name list contains no `NTFY` entry | **HIGH** |
| **Slack webhook** | webhook URL secret | **Not configured** — no `SLACK*` variable exists | `.env` name list contains no `SLACK` entry | **HIGH** |
| **SMTP / email send** | mailbox app-password | **Not configured** — no `SMTP*`/`MAIL*` variable exists | `.env` name list contains no `SMTP`/`MAIL`/`IMAP` entry | **HIGH** |
| **SMS** | paid third-party; no free local path | **n/a** | no dependency present or configured | **HIGH** (that it is paid / not free) |

**Observed `.env` variable names (names only — no values were read or printed):** `API_SERVER_KEY`, `BROWSER_INACTIVITY_TIMEOUT`, `BROWSER_SESSION_TIMEOUT`, `BROWSERBASE_ADVANCED_STEALTH`, `BROWSERBASE_PROXIES`, `CUSTOM_PROVIDER_LOCAL_OLLAMA_KEY`, `CUSTOM_PROVIDER_LOCAL_OLLAMA_QWEN3_CODER_30B_KEY`, `CUSTOM_PROVIDER_QWEN3_5_27B_KEY`, `DEEPSEEK_API_KEY`, `HERMESONE_API_KEY`, `IMAGE_TOOLS_DEBUG`, `MOA_TOOLS_DEBUG`, `TELEGRAM_ALLOWED_USERS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HOME_CHANNEL`, `TERMINAL_ENV`, `TERMINAL_LIFETIME_SECONDS`, `TERMINAL_MODAL_IMAGE`, `TERMINAL_TIMEOUT`, `VISION_TOOLS_DEBUG`, `WEB_TOOLS_DEBUG`.

**Verdict vs. prior finding — CORRECTS it.** The prior plan recommended **ntfy.sh as the default** ("★ default") and described a Telegram surface only as a possibility ("whether the operator already has a chat surface configured with Hermes"). On this host the situation is the reverse: **Telegram is already configured and ntfy is not.** ntfy would require introducing a *new* secret; Telegram requires none.

- **Design must:**
  - **Local JSONL log** stays the always-on baseline (zero dependency) and the R3 change-detection baseline.
  - **Preferred push channel is the already-configured Telegram surface**, not ntfy — it satisfies "without repo secrets" without adding a secret at all.
  - **Windows toast** remains the zero-credential local fallback (`BurntToast` must not be assumed).
  - **`smtplib` is available in the interpreter but has no mailbox configured**, so it is not a usable channel today; it becomes usable only if the operator supplies credentials.
  - Do not treat ntfy/Slack/SMS as ready-to-use.
  - Sending a test Telegram message **was not performed** (that is a write to an external service, forbidden here), so the token's validity is unverified.

---

## Q7 — Scheduler capable of "exactly one check per day" on a workstation that sleeps

| Criterion | Windows Task Scheduler | Hermes cron | cron under git-bash |
|---|---|---|---|
| **Present on this host** | **Yes** — `SCHTASKS=PRESENT` (`command -v schtasks`) | **Yes** — `Hermes Agent v0.21.3 (2026.9.14)`, `hermes cron --help` lists `list/create/edit/pause/resume/run/remove/status/runs/history/incidents/doctor/tick` | **No** — `CRONTAB=ABSENT` |
| **Can wake a sleeping machine** | **Yes** — documented | **No documented wake capability** | **No** — not installed |
| **Catches up a missed run** | **Yes** — documented | **Yes, but only while its gateway daemon runs** | n/a |

**Raw evidence per row**

- **git-bash cron absent:** `command -v crontab` → `CRONTAB=ABSENT`. (Matches prior finding.)
- **No task registered yet:** `schtasks /Query /TN FreeCashDailyCheck` → `FEHLER: Das System kann die angegebene Datei nicht finden.` (German-locale "file not found"), i.e. **no task of that name exists**. No task was created.
- **The settings are settable on this host (read-only capability check):** `New-ScheduledTaskSettingsSet`, `Register-ScheduledTask`, `Get-ScheduledTask`, `New-ScheduledTaskTrigger`, `New-ScheduledTaskAction` → all `AVAILABLE`. The actual parameter names present on this host are `WakeToRun`, `StartWhenAvailable`, `MultipleInstances`.
- **Sleep states exist, so wake timers are meaningful:** `powercfg /a` → available: `Standby (S3)`, `Ruhezustand` (hibernate), `Hybrid Standby`, `Fast Startup`; unavailable: `S1`, `S2`, `S0 Low Power Idle`. (Whether wake timers are *permitted* by the active power plan was **not** checked — `powercfg /waketimers` may require elevation and was not run.)
- **Hermes cron is currently able to fire:** `hermes cron status` → "✓ Gateway is running — cron jobs will fire automatically · PID: 30288 · Ticker heartbeat: 9s ago · No active jobs"; `hermes cron doctor` → "✓ Cron doctor found no issues · No active jobs configured."
- **Hermes cron depends on that daemon:** docs, `https://hermes-agent.nousresearch.com/docs/user-guide/features/cron` → "**Cron execution is handled by the gateway daemon.** The gateway ticks the scheduler every 60 seconds, running any due jobs in isolated agent sessions."

**Documented semantics, quoted from primary sources**

- **`StartWhenAvailable`** — `https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable`:
  > "the Task Scheduler can start the task at any time after its scheduled time has passed. … The default is False."
  > "Tasks that are started after the scheduled time has passed (because of the **StartWhenAvailable** property being set to True) are queued in the Task Scheduler service's queue of tasks and they are started after a delay. **The default delay is 10 minutes.**"
  - **Caveat observed on the same page and important here:** "This property applies only to time-based tasks with **an end boundary** or time-based tasks that are set to repeat infinitely." A plain daily trigger has neither, so whether catch-up actually engages for this job is **not established** by the documentation — see blocked list.
- **`WakeToRun`** — `https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-waketorun`:
  > "the Task Scheduler will wake the computer when it is time to run the task."
- **`MultipleInstances`** — `https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-multipleinstances`:
  > `TASK_INSTANCES_IGNORE_NEW` = 2 — "Does not start a new instance if an existing instance of the task is running."
- **Hermes cron local missed-run policy** — same Hermes docs page:
  > "If the gateway was down (or restarting) when a recurring job's scheduled time passed, the job **catches up once** when the scheduler is back: a slot missed inside a restart gap fires exactly one time, a slot that already ran before the restart is never run again, and a long outage collapses into a single run rather than one run per missed slot."
  > "`cron.catch_up_missed: false   # default: true`"
  > Each catch-up shows in `hermes cron list` as `⚠ late` / `⚠ catch-up after missed fire`.
- **Confidence:** **HIGH** for all quoted capability statements and for every local presence/absence probe.
- **Verdict:** **CONFIRMS** the prior finding that Windows Task Scheduler is the only one of the three that can wake a sleeping machine and catch up a run missed while the machine was off, and that `crontab` is absent in git-bash. Two refinements:
  1. Hermes cron's catch-up is **daemon-bound** ("gateway was down … catches up once when the scheduler is back") and the gateway **is currently running** on this host (PID 30288, heartbeat 9s), so it is a live option *while that process stays alive* — it is a delivery/summarisation layer, not the reliability guarantee.
  2. `StartWhenAvailable`'s documented "end boundary or repeat infinitely" restriction means Task Scheduler catch-up for a plain daily trigger **cannot be assumed** from documentation alone.
- **Design must:** use Windows Task Scheduler for the daily trigger with `-StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew` (the PowerShell cmdlets and parameter names are confirmed present here; `schtasks /create` cannot set them). Keep a **date-guarded** state file so a catch-up run cannot double-log a day (R1), because catch-up is exactly the case that would otherwise produce two checks in one calendar day. Treat Hermes cron as an optional second layer.

---

## Consolidated verdict on the key decision

**The key fact holds: CONFIRMED on primary sources.** freecash.com's Terms (§17, part 2, bullet 2, re-fetched live) forbid any "robot, spider or other automatic device, process or means to access the Website **for any purpose, including monitoring**", §17.1 additionally bans "macros, bots, scripts, or any other automation tools", §16 restricts use to "personal, non-commercial use only", and §19 permits suspending or **voiding unredeemed rewards**. `robots.txt` independently disallows `/user/`, `/myprofile` and `/fc-api/`. `/docs` and `/developers` do not exist. **Every automated acquisition path against freecash.com is a Terms violation**, and the compliant options remain the operator's own manual entry, or a documented API belonging to whichever provider the entity actually holds funds with.

**The only fully documented read-only balance API confirmed live in this run is HG.Cash** (`GET https://hg.cash/api/v1/accounts` → HTTP 401 unauthenticated, with the JSON body naming the expected `Bearer <token>` scheme; `GET /account/{id}/balance` → HTTP 401). Cashfree's `GET /payout/v1/getBalance` and `GET /payout/v1.2/getBalance` are documented with the expected fields, but the unauthenticated probe returned an **edge-level 403 HTML page rather than the documented application JSON** — so its application-level liveness is **not** confirmed.

**freecash.io is not a platform** — it is a 114-byte client-side redirect to `forsale.godaddy.com/forsale/freecash.io`.

---

## Blocked on the operator (research cannot answer these)

| # | Unknown | Who can answer | Why research cannot |
|---|---|---|---|
| 1 | **Does the entity hold an HG.Cash account, a Cashfree merchant account, both, or neither?** | Operator | Requires the operator's own login/entitlement. This decides whether *any* automatic read source exists. |
| 2 | **If Cashfree: is the Payouts API actually entitled?** | Operator (+ Cashfree activation queue) | The documented gate is `403 "APIs not enabled"`; confirming or clearing it needs a real token. The live unauthenticated probe was blocked at the edge (403 HTML, not the documented JSON, and not the documented 412 for a missing token). |
| 3 | **Is freecash.com even the target platform?** | Operator | All ToS/robots conclusions apply to freecash.com specifically; a different platform needs its own §17-equivalent check. |
| 4 | **Is the entity's activity personal or commercial?** (ToS §16 permits "personal, non-commercial use only") | Operator | A factual/business determination, not a fetchable one. |
| 5 | **Has the operator deliberately accepted the manual-entry path (R2/R4-safe, zero ToS surface)?** | Operator | A decision, not a fact. Nothing in this research may be executed automatically. |
| 6 | **Do the existing `TELEGRAM_BOT_TOKEN` / `TELEGRAM_HOME_CHANNEL` values actually work?** | Operator (or an authorized test send) | Verifying requires sending a message — an external write, forbidden here. Only the variable *names* were observed. |
| 7 | **Which notification channel is acceptable?** (Telegram is configured; ntfy is not) | Operator | A preference; research only establishes reachability. |
| 8 | **Is a wake timer permitted by the active power plan?** | Operator (`powercfg /waketimers`) | Not checked — may need elevation. `powercfg /a` confirmed S3/hibernate exist. |
| 9 | **Does Task Scheduler `StartWhenAvailable` actually catch up a plain daily trigger?** | Operator (a controlled observation) | The Microsoft doc restricts the property to tasks "with an end boundary or … repeat infinitely"; testing requires creating a task, which this task forbids. |
| 10 | **What does freecash.com's `/fc-api/` namespace serve?** | — (deliberately unanswered) | robots-disallowed and undocumented; it must not be probed or used. |
| 11 | **Does freecash.com send a periodic balance/status email, or offer a statement/export?** | Operator (mailbox + dashboard inspection) | Requires the operator's own data; not publicly observable. |
| 12 | **Machine uptime pattern (sleeps vs. always-on), and operator jurisdiction for tax** | Operator | Environment/business facts, unchanged from the prior plan. |

*No credential was used, no authenticated request was made, no account action was taken, no scheduled task was created, and no existing file was modified by this research.*

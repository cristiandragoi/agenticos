# PROVIDER-READ-SOURCE-RESEARCH.md — the EXTERNAL provider / read-source question, researched and rule-filtered

**Repository:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Host:** Windows 11, git-bash, non-elevated
**Pass:** `DELEGATION-2026-09-20-R2` · **Written:** 2026-09-20 (Europe/Berlin) · **Additive artifact**
**Routine under research:** `monitoring/freecash/` (entry point `run_daily_check.py`)
**Rules used to filter every option (R1–R4):** R1 one status check per operator-local calendar day · R2 zero automated earning actions (read-only `GET`/`HEAD`, never a write verb) · R3 notify on earnings/status change · R4 human approval before any external action.

**Compliance record for this pass.** No account was created. No login, signup, form submission, or terms acceptance occurred anywhere. No credential, token, email address or personal data was entered, read, or handled. No `POST`/`PUT`/`PATCH`/`DELETE` was sent to any host. No request was sent to a provider *API* endpoint — every external request was an unauthenticated `GET` of a **public documentation page, ToS page, robots.txt, or marketing page**. No scheduled task was registered or queried for modification. `monitoring/freecash/run_daily_check.py` was **not** run against `data/freecash-monitor`. No existing file was modified, moved or deleted; no `git add`/`commit`/`stash` was executed. The only file written is this one.

**Evidence standard.** Every claim is **OBSERVED** (URL or command + what was seen + fetched today 2026-09-20), **CARRIED** (named repo artifact, not re-fetched here), or **UNVERIFIED**. Each source is labelled **provider-published** (the provider's own docs/ToS/robots) or **third-party** (blog, forum, directory, scraper marketplace). An endpoint not found in official documentation is reported **NOT DOCUMENTED**, never as "available".

---

## 1. WHICH PROVIDER IS ACTUALLY IN SCOPE

### 1.1 What prior art named, and what each candidate actually is

| Candidate | Where prior art names it | Evidence class | Actually configured? |
|---|---|---|---|
| **freecash.com** (Almedia GmbH) | `PROVIDER-CONTRACT-RESEARCH-V2.md` §1.2; `RESEARCH-PLAN.md` §4; routine docs throughout | Doc-only + **one live executable artifact** (§1.2 below) | **No credential** — but it *is* the platform the repo's own code targets |
| **HG.Cash** | `PROVIDER-API-RESEARCH.md` §4; `PROVIDER-FINDINGS-REVERIFIED.md` Q3.1–Q3.4; `PROVIDER-DECISION-PACKET-2026-09-20.md` O2 | Doc-only; no `hg.cash` host anywhere in code | **No** (OBSERVED today: 0 rows in `provider_credentials`) |
| **Cashfree Payouts** | `PROVIDER-API-RESEARCH.md` §5; `PROVIDER-FINDINGS-REVERIFIED.md` Q3.5–Q3.7; packet O3 | Doc-only; no `cashfree` host anywhere in code | **No** |
| **FreeCash.io** | `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33`; Hermes skill `automated-status-monitor/references/api-compliance.md:12,64-65` | Doc-only **and false** — parked GoDaddy domain (re-verified §3.4) | **No — not a platform at all** |
| **parse.bot "freecash.io API"** | `INTEGRATION_STATUS.md:28-33` | Third-party scraper marketplace; its own page says it is **not** an official API and returns only public platform-wide data | **No — cannot express "your account"** |

### 1.2 The decisive repo evidence — `proj-free-cash`'s revenue target

**OBSERVED.** `grep -rnoE "https?://[^ ]*" server/src/ --include=*.ts` filtered for provider hostnames returns exactly three hits, all in one file:

| File:line | Value | Meaning |
|---|---|---|
| `server/src/services/freeCash/freeCashExecutor.ts:39` | `const FREECASH_HOME = 'https://freecash.com/en'` | the app's external target is **freecash.com** |
| `server/src/services/freeCash/freeCashExecutor.ts:40` | `const FREECASH_SIGNIN = 'https://freecash.com/en/signin'` | login is a **browser** login page |
| `server/src/services/freeCash/freeCashExecutor.ts:84` | cookies read from `'https://freecash.com'` | session detection is cookie/DOM-based |

**OBSERVED.** `server/src/services/prerequisites/prerequisiteService.ts:39`:
`freecash: { authRequired: true, authType: 'browser_account', label: 'FreeCash' }`
and `:9-10` — *"`sessionValid` is only true when a REAL verification happened (FreeCash browser session probe)"*.
**OBSERVED.** `server/data/agentic-os.db` (read-only URI): `projects` row `proj-free-cash` = `active`, `priority 1`; `provider_credentials` = **0 rows**; `server/data/freecash/session-evidence.json` = **does not exist**.

**Verdict.** The repo's own artifacts treat **freecash.com (Almedia GmbH)** as the platform behind `proj-free-cash`, and the repo's intended access mechanism is a **managed browser account session**, not a provider API token. No HG.Cash or Cashfree host, key, or config appears in any executable code.

### 1.3 The routine's own source establishes **no** provider

**OBSERVED** (`grep -rnE "https?://|hg\.cash|cashfree|freecash" monitoring/freecash/`):
- every match is `http://localhost:3001` (client base URL and tests) or a `freecash` identifier;
- `readonly_client.py:39` `ALLOWED_METHODS = frozenset({"GET","HEAD"})`
- `readonly_client.py:41` `ALLOWED_HOSTS = frozenset({"localhost","127.0.0.1","::1","[::1]"})`
- `readonly_client.py:43-49` `ALLOWED_PATHS = (^/api/v1/status/metrics$, ^/api/v1/status$)` + comment *"Provider paths are added here ONLY after research resolves them"*
- `readonly_client.py:60` `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` (also literal at `approval_queue.py:116`, `tests/test_r2_readonly.py:24`)

**Finding (legitimate and useful):** the routine **does not establish a provider at all**. Provider identity rests solely on the app-side artifact in §1.2, and that artifact's mechanism (browser account session) is the one pattern R2's transport cannot express and freecash.com's terms forbid.

---

## 2. RULE FILTER APPLIED TO EVERY CANDIDATE

A read source is **DISQUALIFIED** if it would (a) require a write verb to obtain the read token, (b) require transaction/earning scope, or (c) grant the automation any earning capability. It is **DISQUALIFIED BY PROVIDER** if the platform's own terms forbid automated access including monitoring.

---

## 3. CANDIDATE READ SURFACES

| # | Provider / surface | Source URL (all fetched 2026-09-20) | Source type | Status | Auth a read needs | Documented rate limit | Rule verdict |
|---|---|---|---|---|---|---|---|
| S1 | **freecash.com** — public developer API / docs | `https://freecash.com/en/docs` · `https://freecash.com/en/developers` | provider-published | **NOT DOCUMENTED** — both return **HTTP 200 (570,023 / 569,657 B)** but the body is the **marketing homepage** (`<title>Freecash: Get Paid for Games &amp; Surveys \| Earn Real Cash</title>`), with **0** occurrences of "api key"/"developer"/"documentation" | n/a | n/a | **DISQUALIFIED BY PROVIDER + R2** |
| S2 | **freecash.com** — account balance / earnings / payout-status read | none exists publicly | — | **NOT DOCUMENTED** | n/a | n/a | **DISQUALIFIED BY PROVIDER** |
| S3 | **freecash.com** — robots.txt | `https://freecash.com/robots.txt` (**200, 298 B**) | provider-published | **documented prohibition**: `Disallow: /user/`, `/myprofile`, `/fc-api/`, `/offer/`, `/w/`, `/scd-cgi/`, `/dev-playground/` | n/a | n/a | **DISQUALIFIED** (robots) |
| S4 | **freecash.com** — ToS §17 automation clause | `https://freecash.com/en/policies/terms` (**200, 453,111 B**; page states *"Effective: July 17, 2026"*) | provider-published | **documented prohibition**, quoted verbatim today: *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring** or copying any of the material on the Website."* | n/a | n/a | **DISQUALIFIED — permanent** |
| S5 | **freecash.com** — affiliate/partner reporting | `https://freecash.com/academy/en/discover/partner/become-a-partner` (**200, 231,859 B**); `.../partner/affiliates` (**200, 242,269 B**) | provider-published | **documented program, GATED**: partners apply via **Impact** (`impact.com/campaign-campaign-info-v2/Freecash…`); analytics in a **Partner dashboard** (screenshots only); **no API documented**; consumer referral ("Invite Friends") is behind login | network partner agreement + Impact login | n/a | **GATED — stop** |
| S6 | **freecash.io** | `https://freecash.io/llms.txt` (**200, 571 B**) | provider-published (domain's own file) | **NOT A PLATFORM**: *"freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket."* | n/a | n/a | **N/A — removed from list** |
| S7 | **HG.Cash** — `GET /accounts` | `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md` (**200, 6,873 B**) + `https://docs.hg.cash/api-reference/openapi.yaml` (**200, 90,616 B**) | **provider-published** | **DOCUMENTED, read-only, `GET` only, no token-exchange call**: returns `balance`, `pendingFees`, `netBalance`, `status` (`Operativa`\|`Bloqueada`\|`Cerrada`), `currency`, `platform{id,name}`, `company{id,name}`, `count` | `Authorization: Bearer cash_<64-char-hex>` — token generated **in the dashboard's account settings**; `openapi.yaml:52-58` declares **one** `bearerAuth` scheme, **no scopes** | **NOT DOCUMENTED** — no numeric limit; `429 "Rate limit exceeded"` is declared only on the **claims** operations, **not** on `/accounts` or `/account/{id}/balance` | **CONDITIONAL — see §4.1** |
| S8 | **HG.Cash** — `GET /account/{id}/balance` | `https://docs.hg.cash/api-reference/accounts/get-account-balance.md` (**200, 5,693 B**) | provider-published | **DOCUMENTED**, same fields, per-account | same single token | NOT DOCUMENTED | **CONDITIONAL — see §4.1** |
| S9 | **HG.Cash** — write path that shares the token | `openapi.yaml` | provider-published | **DOCUMENTED**: `POST /transactions` is the cash-out — *"To create cash-outs (money leaving your accounts), you must call the Cash Out endpoint"* | same token | — | **R2 risk: the credential is not scope-limited** |
| S10 | **HG.Cash** — onboarding / access gate | `https://docs.hg.cash/introduction.md` (**200, 3,855 B**) | provider-published | **GATED**: *"HG.cash does **not** automatically grant dashboard access to every signup"* — Step 1 **contact form** (submit = a form, forbidden here) → Step 2 KYC → Step 3 approval | n/a | n/a | **GATED — stop asserting it is available** |
| S11 | **HG.Cash** — affiliate / partner / referral interface | `https://docs.hg.cash/llms.txt` (**200, 10,712 B**, **53 pages**); `https://hg.cash/` (**200, 207,071 B**) | provider-published | **NOT DOCUMENTED** — no affiliate/partner/referral page in the docs index; **0** occurrences of "affiliate"/"partner program"/"referral" on the marketing homepage; the only outbound links are to `docs.hg.cash` | n/a | n/a | **NOT DOCUMENTED** |
| S12 | **Cashfree Payouts** — `GET /payout/v1/getBalance` | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance.md` (**200, 4,250 B**) | provider-published | **DOCUMENTED**: `200 → {status,subCode,message,data{balance,availableBalance}}`; `403 "Token is not valid"`, `412 "Token missing in the request"`; unentitled → `403 "APIs not enabled…"` | `Authorization: Bearer <token>` + `Content-Type` — **the token is minted by `POST /payout/v1/authorize`** with `X-Client-Id` + `X-Client-Secret` (and possibly `X-Cf-Signature`) | **DOCUMENTED today**: **3,000 TPM** (`https://www.cashfree.com/docs/api-reference/payouts/v2/payouts-rate-limiting.md`, 200, 7,128 B); `Get Balance V1.2` = **100 TPM** | **DISQUALIFIED under R2 if wired directly** (§4.2); permitted only if the operator mints the token out-of-band |
| S13 | **Cashfree** — token exchange | `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize.md` (**200, 7,239 B**) | provider-published | **DOCUMENTED** `POST /payout/v1/authorize`; *"All other API calls must have this token"* | write verb + client id/secret | — | **DISQUALIFIED under R2 (write verb)** |
| S14 | **Cashfree** — read-only key scope | `.../payouts/v1/end-points.md` (**200, 1,018 B**): *"Cashfree uses API keys… Once you have signed up at our merchant site, you will be able to see your AppId and SecretKey."* | provider-published | **NOT DOCUMENTED** — no read-only scope appears; the same credential can trigger transfers | — | — | **R2 risk: credential grants earning capability** |
| S15 | **Cashfree** — affiliate program / reporting | `https://www.cashfree.com/docs/partners/affiliates/dashboard.md` (**200, 5,230 B**); `.../partner-commissions-and-invoices.md` (**200, 7,878 B**) | provider-published | **documented affiliate program, GATED to a login dashboard**; commissions + monthly payout tracked in the **Affiliate Dashboard**; **0** occurrences of "api"/"endpoint"/"programmatic" on the dashboard page | affiliate login | n/a | **GATED — no documented API** |
| S16 | **Cashfree Payouts** — manual export / scheduled reports | `https://www.cashfree.com/docs/payouts/payouts/dashboard/reports.md` (**200, 14,482 B**); Email Notifications page listed in `cf_llms.txt:19` | provider-published | **documented dashboard reports + scheduled email reports** (transfers, beneficiaries, **balances**) | operator dashboard login | n/a | **PERMITTED (human use)** — zero routine network egress |
| S17 | **Cashfree** — rate-limit reference | `.../api-reference/rate-limits.md` (**200, 2,422 B**) — points only at **Payments** and **SecureID** limits | provider-published | the generic page omits Payouts; the Payouts limit is on S12's page | — | see S12 | informational |
| S18 | **Local AgenticOS metrics** (`GET /api/v1/status/metrics`) | `readonly_client.py:54` `http://localhost:3001` | repo artifact | **NOT A PROVIDER READ** — reads the workstation's own metrics; nothing listens (`curl` exit 7 today) | none | n/a | cannot ever observe the account |
| S19 | **Operator-entered state file** | `monitoring/freecash/operator_state.py` | repo artifact | **implemented and rule-clean**; `READ_OPS = []` (opens no socket) | none | n/a | **PERMITTED — only candidate that passes R1–R4 today** |

---

## 4. THE TWO CONDITIONAL OPTIONS, WITH THE FOUR REQUIRED FIELDS

### 4.1 HG.Cash (`GET /accounts` + `GET /account/{id}/balance`)

| Field | Value |
|---|---|
| **Expected Effort** | **0 h until the operator confirms an account exists.** Then **≈0.5 h operator** + **4–8 h builder**: add one `ALLOWED_PATHS` regex + a provider host to `ALLOWED_HOSTS` **and** to the audit-hook allowlist in `readonly_client.py` (this is an **R2 widening needing review, not a bug fix**), a `--source hg_cash` selector, field normalisation, and the separate `degraded`-semantics change. **≈1 h** verification record. |
| **Time-to-Revenue** | **3 days – 2 weeks** if a KYC-complete account already exists; **2–6+ weeks** if not — the gate is HG.Cash's own queue (contact form → KYC → *"After HG.cash approves onboarding"*). |
| **Dependencies** | (a) written operator statement that the entity holds an HG.Cash account; (b) a dashboard-generated token in `%LOCALAPPDATA%\hermes\.env` only, never in the repo; (c) **an explicit R2 decision on the credential-scope gap** — HG.Cash publishes **no read-only scope**, and the same token can call the cash-out `POST /transactions`, so the client allowlist is the *only* control (the repo's own policy `RESEARCH-PLAN.md` §8 P7 requires this be written down, not assumed); (d) one human-performed `GET` before any code is written. |
| **First Concrete Action** | Operator, using **their own** token in their own shell, performs **one** `GET https://hg.cash/api/v1/accounts` and records **only** the HTTP status code and response **field names**, every value `[REDACTED]` — nothing is sent from this research pass. |
| **Rule status** | **CONDITIONAL.** *Strict reading of R2:* because no read-only credential scope is documented and the token can move money, it is **DISQUALIFIED** as a wired source ("grants the automation any earning capability"). *Client-allowlist reading:* permitted only if the operator records that the allowlist, not the credential, is the control. The credential itself is `GET`-only in use — no token exchange, no write verb. |

### 4.2 Cashfree Payouts (`GET /payout/v1/getBalance`)

| Field | Value |
|---|---|
| **Expected Effort** | **4–8 h builder** + **1–3 h operator** (credentials/activation) + **an R2 decision that must precede code**. |
| **Time-to-Revenue** | **1–4 weeks**, dominated by Cashfree's Payouts activation queue (documented unentitled state: `403 "APIs not enabled…"`); unbounded if refused. And the figure obtained is a **merchant payout balance**, not a FreeCash earning balance. |
| **Dependencies** | merchant account with **Payouts enabled**; `X-Client-Id`/`X-Client-Secret`; possibly IP whitelisting + `X-Cf-Signature`; the R2 decision. |
| **First Concrete Action** | Operator opens `https://merchant.cashfree.com` → Developers → API keys and records whether a Payouts-enabled key already exists. No command issued by this pass. |
| **Rule status** | **DISQUALIFIED under R2 as a directly-wired source**, because the read token is minted by `POST /payout/v1/authorize` (a write verb the routine's transport refuses) **and** no read-only key scope is documented. The *only* compliant form is (i) the **operator mints the token out-of-band** each day and the routine consumes it with a bare `GET`, or (ii) R2 is deliberately amended — a change the operator makes to their own rule, to be recorded as such. |

---

## 5. DISQUALIFIED / REJECTED, WITH THE RULE NAMED

| Option | Violates | Basis |
|---|---|---|
| Any scripted read of **freecash.com** (incl. a once-daily `GET`) | **R1/R2 cannot be satisfied at all; provider ToS** | ToS §17 verbatim today: automated device access *"for any purpose, including monitoring"*; `robots.txt` disallows `/user/`, `/myprofile`, `/fc-api/` (OBSERVED) |
| **Browser account session** against freecash.com (the repo's own `freeCashExecutor` pattern) | **R2** (session credential is not a provider-issued API token) and **R4** (a live session can act) | `freeCashExecutor.ts:39-40,84`; `prerequisiteService.ts:39` `authType: 'browser_account'` |
| **Cashfree** token exchange inside the routine | **R2** | S13 = `POST` |
| **HG.Cash** cash-out path | **R2** | S9 = `POST /transactions`; **must never enter the allowlist** |
| Wired source with an unscoped credential | **R2 (strict)** | S9/S14 — no read-only scope documented for either provider |
| Local metrics endpoint as an account read | **G2/truthfulness** (not R1–R4) | it can never observe the account; snapshots must stay `degraded:true` |

---

## 6. EXACT FETCHES PERFORMED (all unauthenticated `GET`, 2026-09-20, `curl -sS -L --max-time 30`)

| URL | Code | Bytes | Used for |
|---|---|---|---|
| `https://freecash.com/robots.txt` | 200 | 298 | S3 |
| `https://freecash.com/en/docs` | 200 | 570,023 | S1 (marketing homepage body) |
| `https://freecash.com/en/developers` | 200 | 569,657 | S1 |
| `https://freecash.com/en/policies/terms` | 200 | 453,111 | S4 (verbatim §17) |
| `https://freecash.com/academy/en/discover/partner/become-a-partner` | 200 | 231,859 | S5 |
| `https://freecash.com/academy/en/discover/partner/affiliates` | 200 | 242,269 | S5 |
| `https://freecash.io/llms.txt` | 200 | 571 | S6 |
| `https://docs.hg.cash/llms.txt` | 200 | 10,712 | S11 (53-page index; no affiliate page) |
| `https://docs.hg.cash/introduction.md` | 200 | 3,855 | S10 |
| `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md` | 200 | 6,873 | S7 |
| `https://docs.hg.cash/api-reference/accounts/get-account-balance.md` | 200 | 5,693 | S8 |
| `https://docs.hg.cash/api-reference/openapi.yaml` | 200 | 90,616 | S7/S9 (one bearer scheme, no scopes; 429 only on claims ops) |
| `https://docs.hg.cash/countries/introduction.md` | 200 | 2,440 | LatAm rails context |
| `https://hg.cash/` | 200 | 207,071 | S11 (0 affiliate mentions) |
| `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance.md` | 200 | 4,250 | S12 |
| `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize.md` | 200 | 7,239 | S13 |
| `https://www.cashfree.com/docs/api-reference/payouts/v2/payouts-rate-limiting.md` | 200 | 7,128 | S12 (3,000 TPM Get Balance; 100 TPM V1.2) |
| `https://www.cashfree.com/docs/api-reference/payouts/overview.md` | 200 | 6,779 | Payouts API scope |
| `https://www.cashfree.com/docs/api-reference/payouts/v1/end-points.md` | 200 | 1,018 | S14 |
| `https://www.cashfree.com/docs/api-reference/rate-limits.md` | 200 | 2,422 | S17 |
| `https://www.cashfree.com/docs/payouts/payouts/dashboard/reports.md` | 200 | 14,482 | S16 |
| `https://www.cashfree.com/docs/partners/affiliates/dashboard.md` | 200 | 5,230 | S15 |
| `https://www.cashfree.com/docs/partners/affiliates/partner-commissions-and-invoices.md` | 200 | 7,878 | S15 |
| `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` (HTML twin) | 200 | 699,252 | S12 |
| `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` (HTML twin) | 200 | 759,469 | S13 |
| `https://www.cashfree.com/docs/llms.txt` | 200 | 89,498 | discovered S12/S15/S16 pages |
| `https://www.cashfree.com/docs/payouts/payouts/overview.md` | **404** | 13,716 | dead path, recorded so it is not re-probed |

**Local read-only commands (re-verified today, all OBSERVED):** `env | grep -icE "FREECASH|SMTP_|WEBHOOK_|HG_CASH|CASHFREE"` → **0**; `command -v himalaya` → **ABSENT**; `schtasks /Query /FO LIST | grep -icE "freecash|daily-monitor|missed-day"` → **0**; `curl http://localhost:3001/api/v1/status` → **curl exit 7**; sqlite read-only `provider_credentials` → **0 rows**, `projects proj-free-cash` → `active/p1`; `server/data/freecash/session-evidence.json` → **absent**; `ls -la docs/free-cash-monitor-routine/DELEGATION-2026-09-20-R2/` at 21:37 → **No such file or directory**; at 21:46 the directory holds three files — this one (27,140 B) plus `RESEARCH-PLAN.md` and `WORKFLOW-PLAN.md` written concurrently by sibling passes of the same delegation. This pass created only its own file.

---

## 7. BLOCKED ITEMS (precise reasons)

| # | Blocked | Reason |
|---|---|---|
| B1 | Any provider-API call | **Policy of this pass**: public documentation pages only; no authenticated endpoint, no request to a provider API. Deliberately not attempted, including the previously-used unauthenticated liveness probes. |
| B2 | HG.Cash access | **GATED**: contact form → KYC → provider approval (S10). Reaching behind the gate means submitting a form, which is forbidden. |
| B3 | Cashfree affiliate/partner reporting | **GATED** behind an Affiliate Dashboard login (S15); no documented API. |
| B4 | freecash.com partner/referral reporting | **GATED** behind an Impact network agreement + partner dashboard login (S5). |
| B5 | Cashfree Payouts entitlement | **Provider-controlled queue**: the documented unentitled response is `403 "APIs not enabled"`; no code changes that. |
| B6 | Whether the entity holds **any** account | Requires the operator's own login/entitlement. Re-verified today: `provider_credentials` = 0 rows, no `FREECASH_*`/`HG_CASH_*`/`CASHFREE_*` env name exists. |
| B7 | Application-level liveness of Cashfree's balance endpoint | CARRIED (`PROVIDER-FINDINGS-REVERIFIED.md` Q3.7): the unauthenticated probe returned a generic `awselb/2.0` HTML `403`, **not** the documented JSON and **not** the documented `412`. Confirming it needs a credential, which this pass may not use. Not re-attempted (B1). |
| B8 | HG.Cash rate limits | **NOT DOCUMENTED** — 53-page docs index has no rate-limit page; `429` is declared only on the claims operations (OBSERVED). |

---

## 8. WHAT I COULD NOT ESTABLISH

- **That any provider holds the monitored balance.** No repo artifact, config, credential, or public source maps `proj-free-cash`'s balance to HG.Cash or Cashfree. The repo's own code points at **freecash.com**, whose terms make an automated read permanently non-compliant.
- **A read surface that satisfies R1–R4 strictly.** Under a strict reading of R2 (credential must be scope-limited, must not grant earning capability), **no** candidate qualifies: HG.Cash's single token can call the cash-out endpoint; Cashfree's read token needs a `POST` and its client id/secret can move money; freecash.com is refused by its own terms. The only candidate that passes R1–R4 today is the operator-entered state file (S19), which is human-attested, not machine-verified.
- **Whether the `/en/docs` 200 responses are intentional.** Today they return the marketing homepage body rather than a docs page; prior art recorded `404` (2026-09-18). Both readings support "no developer documentation", but which status the path *should* return is unknown.
- **HG.Cash's numeric rate limits, and whether any per-day quota exists** — not published anywhere fetched.
- **Whether Cashfree's Payouts balance and Cashfree's Affiliate commissions are two separate account types** — the docs describe them as distinct products; no page fetched states they can coexist on one login.
- **Whether HG.Cash has an affiliate/referral programme at all** — a search-derived negative only; HG.Cash's own docs and homepage contain no such page (OBSERVED), but an absence of documentation is not proof of absence.
- **Small print of the Impact/Freecash partner agreement** — gated behind an application (S5/B4).

---

## 9. RECOMMENDED, FILTERED BY R1–R4

1. **Keep the provider string literal `PROVIDER_ENDPOINT_UNKNOWN`** (`readonly_client.py:60`). This pass did **not** resolve it, and no candidate may replace it on the evidence available.
2. **Authorise the operator-entered state file as the live read source** (S19): 0 h build, same-day Rule-3, no credential, no provider contact.
3. **Record freecash.com as permanently closed to automation** (S4/S3), and record that the repo's *own* `freeCashExecutor` browser-session pattern is an R2/R4 violation if it were ever pointed at this routine.
4. **If HG.Cash is confirmed in writing:** treat it as **conditional**, and record the R2 credential-scope decision *before* any code. If Cashfree: decide operator-minted-token vs. an explicit R2 exemption *before* any code.
5. **Never widen the allowlist to a write path** — `POST /transactions` (HG.Cash) and every Cashfree transfer/withdrawal endpoint stay forbidden.
6. **Nothing here is executed, scheduled, or wired by this pass.** No account was created, no form submitted, no credential handled, no scheduled task registered.

**Standing sentence this research adds to the routine's report:** *Under R2 as written, a provider read cannot be authorised merely because an endpoint exists — the credential must also be incapable of moving money, and for both remaining candidates it is not.*

---

*Pass record: this file is the only artifact created by this pass. No account was created, no login or form submission occurred, no credential/token/email/personal data was entered or read, no `POST`/`PUT`/`PATCH`/`DELETE` was sent, no provider API endpoint was called, no scheduled task was registered, `run_daily_check.py` was not run against the live state root, no existing file was modified, moved or deleted, and no git write operation was executed.*

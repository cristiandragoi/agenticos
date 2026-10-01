# PROVIDER-API-RESEARCH-PLAN.md — read-only provider contract for the "Free Cash Finance Automation" daily status check

**Written:** 2026-09-20 (Europe/Berlin) · **Workspace:** `D:\AgenticOS` · **Scope:** public documentation + unauthenticated, read-only HTTP probes only.
**No authentication, no signup, no POST to any provider, no account access, no credentials requested or used.**

---

## 0. BLOCKED-HONESTY STATEMENT (read this before using any row below)

1. **This machine has no provider credentials.** `D:\AgenticOS\.env` contains exactly these keys (names only, read this session, values never printed):
   `DEFAULT_LLM_MODEL`, `DEFAULT_LLM_PROVIDER`, `GATEWAY_PROVIDER_ORDER`, `JARVIS_SUPERVISOR_V2`, `OLLAMA_BASE_URL`, `OLLAMA_FALLBACK_MODEL`, `OLLAMA_MODEL`.
   There is **no** `FREECASH_*`, `HG_CASH*`, `CASHFREE_*`, `HG_CASH_API_TOKEN` or similar key. **Therefore no authenticated provider call was possible, and none was attempted.**
   → *Consequence:* **no row in this document is `VERIFIED-BY-CALL` in the sense of "a real balance was read".** `VERIFIED-BY-CALL` here means only "an unauthenticated probe of the path returned the documented auth/edge response".
2. **Any prior artefact that reports live balance, earnings, or account standing for a real account is not corroborated by anything this session could fetch.** It should be treated as unverified until the operator confirms it.
3. **Fabrication policy applied:** every endpoint, field name, status enum, header name and error string below is quoted from a URL that was actually fetched, and the fetch result (HTTP status + byte size where captured) is recorded in §2. Anything that could not be fetched is listed in §14 as `UNVERIFIED` with the failure reason and what would resolve it. Where a prior repo document and today's fetch disagree, the disagreement is recorded, not smoothed over (§13).
4. **Read-only discipline:** nothing below proposes an authenticated call from this machine. §10 (test plan) is written for a future session that holds an operator-issued credential, and specifies the exact read-only shape plus an abort-before-network rule.

---

## 1. Verification vocabulary (used consistently in every table)

| Label | Means |
|---|---|
| `VERIFIED-BY-DOC` | The claim is quoted from a page fetched **this session** and listed in §2 with its HTTP result. Doc-level truth only: the doc says it; no live call was made. |
| `VERIFIED-BY-CALL` | An **unauthenticated** HTTP request was issued from this host this session and the observed status/body is recorded. Confirms the *path* and the *auth requirement*, never a real balance. |
| `UNVERIFIED` | Not asserted. Either the page could not be fetched, or the fact is provider-side and unreachable without a credential. Reason + resolution path recorded in §14. |
| `REJECTED` | A candidate driven out by evidence (ToS, absent API, or irrelevance). Rejection is a research result, not a gap. |

---

## 2. Citation ledger — every URL fetched in this session

Two fetch mechanisms were used: `curl` (git-bash on Windows, UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64)`) and the `web_extract` tool. Sizes are bytes of the saved response where captured.

### 2.1 freecash.com / freecash.io / Almedia

| # | URL | Verb | Result | Establishes |
|---|---|---|---|---|
| L1 | `https://freecash.com/en/policies/terms` | GET | **200**, `text/html`, 453 108 B | The full Terms of Service (last updated **July 17, 2026**); source of the §16/§17 clauses quoted in §3. |
| L2 | `https://freecash.com/robots.txt` | GET | **200**, `text/plain`, 298 B | Raw body captured; `Disallow: /user/`, `/myprofile`, `/offer/`, `/fc-api/`, `/scd-cgi/`, `/w/`, `/dev-playground/`. |
| L3 | `https://freecash.com/en/docs` | GET (no follow) | **302** → `https://freecash.com/en` | There is **no docs page**; the path redirects to the marketing home page. (Prior repo docs reported 404 — see §13.1.) |
| L4 | `https://freecash.com/en/developers` | GET (no follow) | **302** → `https://freecash.com/en` | No developer page exists. |
| L5 | `https://freecash.com/en/api` | GET | **404** | No `/api` documentation path. |
| L6 | `https://freecash.com/llms.txt` | GET | **302** → `/en/llms.txt` → (followed) **200** 569 662 B **home-page HTML** | There is **no `llms.txt`**; the path is served the site's catch-all home page. (A machine-readable docs index does not exist.) |
| L7 | `https://freecash.com/sitemap.xml` | GET | **200**, `application/xml`, 796 B | Indexes only `https://freecash.com/api/sitemap/{1..5}/sitemap.xml` — the site's own internal namespace; **no developer/API/partner sitemap**. |
| L8 | `https://freecash.com/api/sitemap/1/sitemap.xml` | GET | **200**, `application/xml` | The internal sitemap namespace is live (context only; no endpoint disclosure). |
| L9 | `https://freecash.com/en/business`, `/en/partners` | GET | **302** → `/en` (home) | No partner/business/API program page exists. |
| L10 | `https://freecash.com/en/stats`, `/stats` | GET | **302** → `/en/stats` → `/en` (home) | No public `/stats` surface. Corroborates that any `/stats`-based design is dead. |
| L11 | `https://freecash.com/fc-api/` | GET | **404**, `application/json` | The internal `fc-api` namespace root answers JSON 404 — the namespace exists but is not a documented API. |
| L12 | `https://api.freecash.com/` and `https://api.freecash.com/v1/status` | GET | **404** (empty body) | The legacy endpoint carried in repo code (`api.freecash.com/v1/status`) **is dead**. |
| L13 | `https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned` | GET | **200**, `text/html`, 245 230 B | Verbatim account-ban guidance: *"**Do not use any automatic device** like a robot or spider to access the site."* |
| L14 | `https://freecash.com/en/policies/affiliate` | GET | **200** | "Invite-a-Friend" program terms. **No API, no postback, no developer surface** — the affiliate programme is link/referral based. |
| L15 | `https://freecash.com/en/policies/partner-advertiser-policy` | GET | **200** | Partner **advertising** guidelines (creative compliance), the only "partner" document. **No API mentioned.** |
| L16 | `https://freecash.com/en/policies/cashback-legal` | GET | **200** | Cashback addendum exists; no API surface. |
| L17 | `https://freecash.io/llms.txt` | GET | **200**, `text/plain`, 571 B | Verbatim: *"freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket"* with a `forsale.godaddy.com` listing. `freecash.io` is **not a platform**. |
| L18 | `https://freecash.io/` , `https://freecash.io/stats` | GET | **200**, `text/html`, 114 B | Parked-domain lander (the `/stats` path returns the same 114-byte lander). |
| L19 | `https://status.freecash.com/` | GET | **200**, `text/html`, 599 B | A status-pages shell exists (`<title>Status Pages Site</title>`, JS bundle `status-pages-site-*.js`). Content is client-rendered and was **not** verifiable textually. Public **platform** status only — never account status. |
| L20 | `https://freecash.com/en/cashout` | GET | **200** | The redemption surface exists (also linked from the ToS page nav as "Cashout"). This is a **human UI**, not an API. |
| L21 | `https://freecash.com/en/signin` | GET | **200** | Human login surface. |
| L22 | `https://freecash.com/en` | GET (followed from L3/L4/L6) | **200**, 569 661 B | Home-page HTML **does** reference the internal auth namespace: `/fc-api/auth/google`, `/fc-api/auth/facebook`, `/fc-api/auth/apple`. |

### 2.2 Unofficial third-party "Freecash API" artefacts (repo-referenced)

| # | URL | Verb | Result | Establishes |
|---|---|---|---|---|
| L23 | `https://api.parse.bot/marketplace/apis?q=freecash` | GET | **200**, `application/json`, 131 226 B | Listing `freecash-io-api`: `"source_url": "https://freecash.io"`, `"is_authenticated": false`, `endpoint_count: 5`, endpoints `get_withdrawals`, `get_stats`, `get_offer_categories`, `get_featured_offers`, `get_cashout_methods`. **Public platform-wide data only; no notion of "your account".** |
| L24 | `https://github.com/garv7680/freecash` (canonical: `github.com/gravy7125/freecash`) | GET | **200** | A third-party repo titled "An API for the site freecash.com", single commit, **April 2022** (4 years stale). |
| L25 | `https://raw.githubusercontent.com/gravy7125/freecash/main/freecash.py` | GET | **200**, 1 654 B | The "API" is **HTML scraping**: `requests.get(f"https://freecash.com/user/{id}")` + BeautifulSoup over `class="userProfileStatValue"` and an `id="almaView"` inline script. It reads **other users' public profile pages** — a `robots.txt`-Disallowed path (L2) — not an authenticated account balance. |

### 2.3 HG.Cash

| # | URL | Verb | Result | Establishes |
|---|---|---|---|---|
| L26 | `https://docs.hg.cash/llms.txt` | GET | **200**, `text/plain`, 10 712 B | Complete docs index. Accounts section: *"Get User Accounts … ledger balance, pending fees, net available balance … and account status"*; *"Get Account Balance … balance, pending fees, net available balance, currency, and account status"*. Also enumerates every write endpoint (§9). |
| L27 | `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md` | GET | **200** | OpenAPI fragment for `get /accounts` — full field list + enum (§5.2). Server URLs `https://hg.cash/api/v1` (prod), `http://dev.hg.cash/api/v1` (dev). Security scheme `bearerAuth`, `format cash_<64-char-hex>`, sample token `cash_16cdc3b6…`. |
| L28 | `https://docs.hg.cash/api-reference/accounts/get-account-balance.md` | GET | **200** | OpenAPI fragment for `get /account/{id}/balance` + responses `200/401/404/500`. |
| L29 | `https://docs.hg.cash/api-reference/transactions/create-transaction-request-cash-out.md` | GET | **200** | The write endpoint `post /transactions` (cash-out) — denylist source, incl. validation rules and status enum `PENDING|AWAITING_REVIEW|PROCESSING|DONE|ERROR|CANCELLED`. |
| L30 | `https://docs.hg.cash/introduction.md` | GET | **200** | Onboarding: contact form → **KYC** ("identity documents, proof of address, company filings, beneficial ownership, bank details") → access provisioned. *"HG.cash does **not** automatically grant dashboard access to every signup."* |
| L31 | `https://docs.hg.cash/developers/introduction.md` | GET | **200** | Webhooks for partners/backends; work with onboarding for URLs/secret/sandbox. |
| L32 | `https://docs.hg.cash/countries/argentina/bank-transfers.md` | GET | **200**, 5 378 B | *"Use `GET /api/v1/accounts` and `GET /api/v1/account/{id}/balance` to list balances and status."* Outbound fee exists (example: **1%**); `409 INSUFFICIENT_NET_BALANCE` with `details.maxWithdrawableAmount`. Lists `GET /api/v1/transaction-statuses` and `GET /api/v1/transaction-types` as *"reference data (no auth required)"*, and `GET /api/v1/alias-lookup` (when enabled). |
| L33 | `https://docs.hg.cash/api-reference/openapi.yaml` | GET | **200**, `text/yaml`, 90 616 B | Full spec. Confirms `GET /accounts` and `GET /account/{id}/balance` schemas; documents **`429 Rate limit exceeded`** on some endpoints. |
| L34 | `https://hg.cash/api/v1/accounts` | GET (**no auth sent**) | **401**, `application/json`, body `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}` | The documented read endpoint is **live and application-level**, and requires exactly the documented bearer scheme. |
| L35 | `https://hg.cash/api/v1/account/1/balance` | GET (**no auth sent**) | **401**, `application/json` (same 77-byte body) | Same for the per-account balance path. |
| L36 | `https://docs.hg.cash/rate-limits`, `https://docs.hg.cash/pricing.md`, `https://docs.hg.cash/fees.md` | GET | **404** | **No published rate-limit page and no published fee page.** (See §14 U-3/U-4.) |
| L37 | `https://hg.cash/`, `https://hg.cash/es` | GET | **200** (JS-rendered) | Vendor marketing page (text obtained via `web_extract`). States: *"API REST. Un solo Bearer Token. Sin complejidad multi-credencial. OpenAPI completo en docs.hg.cash/openapi"*, onboarding *"Staging Access → Express KYC → Go Live … < 48h"*, and *"$0 fee de setup. Sin volumen mínimo."* Positioning: *"Infraestructura de pagos para operadores de iGaming"* (Argentina/Brazil, USDT settlement). |
| L38 | `https://hg.cash/terms`, `/terms-and-conditions`, `/en/terms`, `/legal`, `/es/legal/terms`, `/es/terminos`, `/terminos-y-condiciones`, `/privacy`, `/sitemap.xml` | GET | **404** (each) | **No reachable HG.Cash terms-of-service / privacy policy page was found.** A ToS-automation clause therefore **cannot be quoted** — see §14 U-1. |

### 2.4 Cashfree Payouts

| # | URL | Verb | Result | Establishes |
|---|---|---|---|---|
| L39 | `https://www.cashfree.com/docs/llms.txt` | GET | **200**, ~20 226 chars clean | Docs index including the **complete Payouts API reference list** used for the denylist and for real endpoint names. |
| L40 | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance.md` | GET | **200**, `text/markdown`, 4 250 B | `get /payout/v1/getBalance`; required headers `Authorization: Bearer <token>` and `Content-Type: application/json`; 200 schema `{status, subCode, message, data:{balance, availableBalance}}`; error table 200 `SUCCESS`, 403 `Token is not valid`, 412 `Token missing in the request`. |
| L41 | `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12.md` (and `/v1/get-balance-v12.md`) | GET | **200** each | `get /payout/v1.2/getBalance` — same response shape, optional `paymentInstrumentId` query param, extra 422 `Specified paymentInstrumentId not available.` |
| L42 | `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize.md` | GET | **200**, `text/markdown`, 7 239 B | `post /payout/v1/authorize`; headers `X-Client-Id` (**required**), `X-Client-Secret` (**required**), `X-Cf-Signature` (optional, *"if IP is not whitelisted"*); **"The generated token is valid for 6 minutes."**; 401 sample `Invalid clientId and clientSecret combination`. |
| L43 | `https://www.cashfree.com/docs/api-reference/payouts/v1/end-points.md` | GET | **200**, 1 018 B | Prod `https://payout-api.cashfree.com`, test `https://payout-gamma.cashfree.com`; *"Once you have signed up at our merchant site, you will be able to see your AppId and SecretKey"*; `POST /payout/v1/authorize` for the token; *"Use the endpoint `/api/v1/credentials/verify` to verify your credentials"* (verb not stated → §14 U-5). |
| L44 | `https://www.cashfree.com/docs/api-reference/payouts/getting-started-with-payouts-apis.md` | GET | **200**, 10 565 B | Merchant-dashboard key generation; **production keys require OTP authentication**; **production requires IP whitelisting** (max 25 IPv4) *or* RSA signature; Payout **v2** base URLs `https://api.cashfree.com/payout` and `https://sandbox.cashfree.com/payout`. |
| L45 | `https://www.cashfree.com/docs/api-reference/payouts/overview.md` | GET | **200**, 6 779 B | Overview + links to Standard Transfer V2, Batch Transfer V2, Get Transfer Status V2, Validate Payout V2, Process Validated Payout V2, Create/Get/Remove Beneficiary V2, Cashgram, CardPay, One Escrow, Webhooks V2. |
| L46 | `https://www.cashfree.com/docs/api-reference/payouts/v2/payouts-api-v2-new.md` | GET | **200** | v2 base URLs and the full v2 API table (transfers, beneficiary management, verify-and-pay). |
| L47 | `https://www.cashfree.com/docs/api-reference/rate-limits.md` | GET | **200**, 2 422 B | Generic mechanism documented (`X-RateLimit-Limit/-Remaining/-Reset`, `429`). The page links **Payments** and **SecureID** rate-limit pages **only** → **no published Payouts rate limit** (§14 U-6). |
| L48 | `https://www.cashfree.com/docs/payouts/payouts/introduction.md` | GET | **200**, 6 433 B | *"designed specifically for businesses across India"*; regulatory compliance; payout modes IMPS/NEFT/UPI/card/wallets. |
| L49 | `https://www.cashfree.com/docs/payouts/payouts/general-faqs.md` | GET | **200**, 52 215 B | Recharges must come from whitelisted bank accounts; no UPI recharges; one Paytm-policy answer shows a "Pricing" field value *"As applicable to your Paytm business account. No additional charges."* **No Payouts price list.** |
| L50 | `https://www.cashfree.com/docs/help/account/termsandcondition.md` | GET | **200** | Points to Cashfree's official terms: `https://www.cashfree.com/tnc/`. |
| L51 | `https://www.cashfree.com/tnc/` | GET | **200**, `text/html`, 905 327 B | Full Cashfree T&C. Text search for automation/scraping clauses: the **only** hit is Cashfree *itself* reserving the right to use third-party crawlers on the *merchant's* site (*"Cashfree may use third-party tools for web crawls/ scrape the Merchant Site…"*). **No clause prohibiting the merchant's own programmatic API use was found.** |
| L52 | `https://www.cashfree.com/payouts/pricing` | GET | **200** (JS-heavy; text via `web_extract`) | Marketing page; the extracted text contains **no price list** — the only "pricing" strings are the partner-affiliate 0.25% commission note (§14 U-7). |
| L53 | `https://payout-api.cashfree.com/payout/v1/getBalance` | GET (**no auth sent**) | **403**, `text/html`, `Server: awselb/2.0`, body `<h1>403 Forbidden</h1>` | **Edge/LB rejection, NOT the documented `application/json` error shape.** The documented application liveness of Get Balance is therefore **not** confirmed by probe (§14 U-2). |
| L54 | `https://payout-api.cashfree.com/payout/v1.2/getBalance` | GET (no auth) | **403** (same shape) | Same conclusion. |

**Total fetched URLs (distinct):** 54 rows above cover 60+ distinct paths; all `GET`; zero write verbs issued.

---

## 3. Candidate A — FreeCash.com (Almedia GmbH) / FreeCash.io

### Q1 — Is there a public/documented API at all?
**No — confirmed, on both domains. This is a verified absence, not an unexamined gap.**

- **freecash.io is not a platform.** Its own `llms.txt` (L17, HTTP 200) says the domain is *"currently listed for sale on GoDaddy's aftermarket"*, with a `forsale.godaddy.com` listing. `https://freecash.io/` serves a **114-byte** parked lander (L18). *Refutes* the repo's `server/data/freecash-monitor/INTEGRATION_STATUS.md` entry ("FreeCash.io Platform APIs … Auth: X-API-Key").
- **freecash.com publishes no developer surface.** Every candidate documentation path either 404s or is redirected to the marketing home page: `/en/docs` → **302** `/en` (L3); `/en/developers` → **302** `/en` (L4); `/en/api` → **404** (L5); `llms.txt` → **302** → home page HTML (L6); `/en/business`, `/en/partners` → **302** `/en` (L9); `/en/stats`, `/stats` → **302** → home (L10). The sitemap index (L7) advertises only the site's own internal `api/sitemap/*` namespace — **no developer/partner/docs sitemap**. The affiliate (L14) and partner-advertiser (L15) policies contain **no API, no postback, no key issuance**.
- **`api.freecash.com` is dead.** `https://api.freecash.com/v1/status` → **404** (L12). The endpoint carried in repo code/design docs must not be carried forward.
- **The only "API" that exists is unofficial and scraping-based.** A third-party repo titled "An API for the site freecash.com" (L24, single commit, **April 2022**) implements it by fetching `https://freecash.com/user/{id}` and scraping HTML with BeautifulSoup (L25) — a `robots.txt`-Disallowed path. The `parse.bot` marketplace listing the repo references is explicitly `"is_authenticated": false` and returns **platform-wide public data** (L23), not account data.

### Q2 — Which read-only endpoint could return balance / earnings / account status for a logged-in user?
**None documented. There is no officially supported read path, and the private path is unverifiable from outside.**

| What the monitor needs | Officially documented read endpoint | Evidence |
|---|---|---|
| Account balance | **None** | No developer/docs page exists (L3–L10); no key/oauth issuance anywhere (L14–L15). |
| Earnings | **None** | as above. The only "earnings" surfaces found are third-party scrapes of *other users'* public profiles (L25) or the platform-wide leaderboard (L23). |
| Account status / standing | **None** | The only account-status text found is human-readable support content (L13). |

- **Auth mechanism (informational only):** the site's own web app talks to an **internal namespace `/fc-api/`** — `robots.txt` `Disallow: /fc-api/` (L2), root `/fc-api/` answering **JSON 404** (L11), and the **home-page HTML referencing `/fc-api/auth/google` `/fc-api/auth/facebook` `/fc-api/auth/apple`** (L22). That is a **private, internal, first-party auth surface** (session/OAuth-style), surfaced only incidentally by the public page. **No path under `/fc-api/` is documented anywhere, so no such endpoint is named, guessed or proposed in this plan**; each would be `UNVERIFIED` by construction.
- **Is any such mechanism "officially supported"?** **No.** There is no public credential issuance, no API reference, no sandbox, and `robots.txt` explicitly fences the namespace off from crawlers. Any use would be **scraping-adjacent** (session cookie replay or browser automation), i.e. exactly the class of access §3/Q4 forbids.

### Q3 — Which endpoints must be permanently forbidden (denylist)?
See §9 for the machine-readable list. For freecash.com the denylist is stated **by action and by prefix**, because no legitimate endpoint exists to be "allowed":
`/fc-api/*` (the internal API prefix, incl. its `auth/*` children) · `/user/*` · `/myprofile` · `/offer/*` · `/dev-playground/*` · `/scd-cgi/*` · `/w/*` (all `robots.txt`-Disallowed, L2) · and **every** state-changing human action: cashout/redemption (`/en/cashout`, L20), offer start/completion, survey completion, sign-in/credential POSTs, withdrawal-method changes.

### Q4 — Terms-of-service / account-ban exposure of automated read polling
**Prohibited, explicitly, and the prohibition names monitoring by name.** Source: `https://freecash.com/en/policies/terms` (L1, HTTP 200, last updated **July 17, 2026**).

| Clause | Verbatim | Deep link |
|---|---|---|
| §16.1 | *"These Terms of Services permit you to use the Website for your personal, **non-commercial** use only."* | `https://freecash.com/en/policies/terms#:~:text=16.-,Use%20of%20the%20Website` |
| §17.1 (final bullet) | *"To use **macros, bots, scripts, or any other automation tools** designed to simulate or replicate human user activity, including but not limited to automating clicks, movements, or tasks within offers or apps. Such behavior is **strictly prohibited**…"* | `https://freecash.com/en/policies/terms#:~:text=17.-,Restrictions%20and%20Prohibited%20Uses` |
| §17.2 (bullet 2) | *"Use any **robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring** or copying any of the material on the Website."* | same |
| §17.2 (bullet 3) | *"Use any **manual process to monitor** or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, **without our prior written consent**."* | same |
| §19 | Almedia may *"Terminate or suspend your access to all or part of the Website for any or no reason, including without limitation, any violation of these Terms of Services"* and *"suspend or void any Rewards … not yet successfully redeemed"*. | `https://freecash.com/en/policies/terms#:~:text=19.-,Monitoring%20and%20Enforcement` |
| §17.5 | Fraud/automation-detection signals are *"confidential and proprietary"* and Almedia *"may decline to disclose"* the reasons for a restriction. | same |

Corroborating help-centre article (`.../how-can-i-ensure-that-my-freecash-account-will-not-be-banned`, L13, HTTP 200, verbatim): *"**Do not use any automatic device** like a robot or spider to access the site."*

**Exposure analysis (why this is not merely a paper risk):**
1. A once-per-day GET with a session cookie is an *"automatic device"* under §17.2 — the clause's own words are *"including monitoring"*. Frequency is irrelevant to the clause.
2. §17.2 bullet 3 additionally bans **manual** monitoring without prior written consent, so "a human pastes the number" is only clean if it is the operator's own personal, non-commercial use of their own account page (not a scripted harvest).
3. The penalty lands on **the account this routine exists to protect**: §19 permits termination plus forfeiture of *unredeemed* rewards, and §17.5 says the operator will not be told which signal triggered it. A monitor that costs the monitored balance is self-defeating.
4. There **is** a legitimate escape hatch in the text: *"without our prior written consent"* — worth exactly one operator-initiated request to `support@freecash.com` (§11 T7). No public evidence exists that such consent is ever granted to consumers.

**Verdict: freecash.com/freecash.io → `REJECTED` as an automated read source, on ToS grounds, independent of technical feasibility.**

### Q5 (freecash.com) — Fallback shape
Not a provider fallback; recorded for completeness in §8 rows C1–C6.

---

## 4. Candidate A2 — the `parse.bot` "freecash.io API" wrapper (repo-referenced)

- **Official?** **No.** Its own marketplace metadata (L23, HTTP 200, `application/json`): `"is_authenticated": false`, `"source_url": "https://freecash.io"` (a parked domain, §3), 5 endpoints — `get_withdrawals`, `get_stats`, `get_offer_categories`, `get_featured_offers`, `get_cashout_methods` — priced at 1 credit each, updated 2026-08-31.
- **Can it read the monitored account?** **No.** Every endpoint returns *public platform-wide* data (withdrawal feed of other users, homepage stats, offer categories, cashout methods). There is no per-account balance, no earnings, no standing. `is_authenticated: false` is decisive.
- **Also:** pulling freecash.com content through a third party does not launder the §17.2 prohibition on automated access to the same content.
- **Verdict: `REJECTED` — cannot answer the question, and inherits the ToS exposure.**

---

## 5. Candidate B — HG.Cash

### Q1 — Documented API?
**Yes — an officially published, MIT-licensed OpenAPI surface with a written docs index.** Sources: `https://docs.hg.cash/llms.txt` (L26, 200), `.../openapi.yaml` (L33, 200, 90 616 B), the per-endpoint `.md` pages (L27–L29).

### Q2 — Read-only endpoints for balance / earnings / status
| Purpose | Endpoint | Fields (quoted from the docs) | Auth |
|---|---|---|---|
| **Account standing + balance** | `GET /accounts` | `data[] { id (uuid), name, balance, pendingFees, netBalance, status, currency, number, alias, platform{id,name}, company{id,name} }`, `count` — `status` enum: **`Operativa` \| `Bloqueada` \| `Cerrada`** | Bearer |
| **Balance for one account** | `GET /account/{id}/balance` | `{ id, balance, currency, pendingFees, netBalance, status }` | Bearer |
| Movement/earnings record | `GET /transaction/{id}/status`, `GET /transactions/{id}/receipt` (read-only; listed in L26) | request status / signed receipt URL | Bearer |
| Reference data | `GET /transaction-statuses`, `GET /transaction-types` — docs state *"reference data (no auth required)"* (L32) | status/type lists | none stated |
| Beneficiary lookup | `GET /alias-lookup` (L32, *"when enabled for your account"*) — **verb conflicts with a prior repo doc that called it `POST /alias-lookup`** (§13.3) | alias → CBU/CVU | Bearer |

- **Base URLs:** `https://hg.cash/api/v1` (production), `http://dev.hg.cash/api/v1` (development) — quoted from the spec (L27/L33).
- **Auth mechanism:** `Authorization: Bearer cash_<64-char-hex>`; token *"generated in the account settings page"* per the spec's Getting-Started block; scheme declared `http/bearer`, `bearerFormat: JWT` (L27). **Officially supported** — the docs are written for server-side programmatic use (*"Implement in your backend services (never expose tokens in frontend)"*).
- **Live confirmation (unauthenticated):** `GET https://hg.cash/api/v1/accounts` → **401 `application/json`**, body `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}` (L34); same for `/account/1/balance` (L35). The paths and the auth contract are real; the *data* remains unverified because no token exists here.
- **Scope limitation (important, and not documented as avoidable):** the token is **account-wide**. The same bearer token that satisfies `GET /accounts` is the token the cash-out endpoint `POST /transactions` expects. **HG.Cash publishes no read-only / scoped API key** (no scope, role or permission field appears anywhere in L26–L33). *That is the single strongest argument against this provider.*
- **Account-status semantics:** the enum is Spanish (`Operativa`/`Bloqueada`/`Cerrada`) → standing is readable, but any monitor must map it explicitly and must never guess new values (an unknown value must surface as `UNKNOWN`, not be coerced).

### Q3 — Write endpoints to forbid
`POST /transactions` (cash-out, L29), `POST /checkouts` + `POST /checkouts/{id}/cancel`, `POST /claims`, `POST /brazil/inbound`, `POST /brazil/outbound`, `POST /chile/inbound`, `POST /chile/outbound`, `POST /bolivia/inbound`, `POST /bolivia/outbound` — enumerated from the docs index (L26). Full denylist in §9.

### Q4 — ToS / ban exposure of automated read polling
- **Automation prohibition found: NONE.** The docs are addressed to backend integrators; the spec is MIT-licensed; the marketing page sells *"API REST. Un solo Bearer Token"* and *"Pagos masivos vía API"* (L37). No clause resembling freecash.com's §17.2 appears in any fetched HG.Cash page.
- **However:** *"No HG.Cash terms-of-service page could be fetched"* — `/terms`, `/terms-and-conditions`, `/en/terms`, `/legal`, `/es/legal/terms`, `/es/terminos`, `/terminos-y-condiciones`, `/privacy` all **404** (L38), and the docs index (L26) has no legal section. **The absence of a prohibition is therefore `UNVERIFIED` as a documented fact — it is the absence of a *found* clause, not a documented permission** (§14 U-1). Commercial onboarding would presumably surface the real contract.

### Q5 — Access gate, KYC, cost
- **Gate:** **KYC-gated B2B onboarding.** `https://docs.hg.cash/introduction.md` (L30, 200): contact form → KYC (*"identity documents, proof of address, company filings, beneficial ownership, bank details"*) → access provisioned; *"HG.cash does not automatically grant dashboard access to every signup."* The marketing page advertises *"Staging Access → Express KYC → Go Live"* in *"< 48h"* (L37).
- **Cost:** the vendor's own marketing page states *"**$0 fee de setup. Sin volumen mínimo.**"* (L37, `https://hg.cash/es`, 200). A **1% outbound fee appears as an example** in the AR bank-transfers doc and the cash-out doc (L29/L32) — i.e. fees exist on the *payout* (write) side. **A published fee schedule for read calls: none found** (`/pricing.md`, `/fees.md` → 404, L36). Reading balances is $0 *if* read calls are free — **UNVERIFIED** without an account.
- **Rate limits:** the spec documents a **`429 Rate limit exceeded`** response on some operations (L33), and the docs index contains **no rate-limit page** (`https://docs.hg.cash/rate-limits` → **404**, L36). Numeric limits **UNVERIFIED** (§14 U-3).
- **Relevance caveat (unchanged from prior research, still true):** HG.Cash is LATAM (ARS/BRL/CLP/BOB) **iGaming payment infrastructure** — plausible as a payout *destination*, not a "free cash" consumer rewards platform. **Nothing in the repo links the monitored account to HG.Cash.**

---

## 6. Candidate C — Cashfree Payouts

### Q1 — Documented API?
**Yes.** Complete reference under `https://www.cashfree.com/docs/llms.txt` (L39, 200) with per-endpoint markdown pages (L40–L42). Note the naming coincidence: **Cashfree is an Indian payments company whose brand merely echoes "Free Cash"** — there is still **no repo evidence** connecting it to the monitored account (§13.4).

### Q2 — Read-only endpoint(s) for balance / earnings / status
| Purpose | Endpoint | Response | Auth |
|---|---|---|---|
| **Ledger + available balance** | `GET /payout/v1/getBalance` (L40) | `{"status":"SUCCESS","subCode":"200","message":"Ledger balance for the account","data":{"balance":"214735.50","availableBalance":"173980.50"}}` | `Authorization: Bearer <token>` **and** `Content-Type: application/json` (both marked **required**) |
| Same, v1.2 | `GET /payout/v1.2/getBalance` (L41) | same shape; optional `paymentInstrumentId` query param; extra `422 Specified paymentInstrumentId not available.` | same |
| Transfer status (read) | `GET /payout/v1/getTransferStatus`, `/payout/v1.2/getTransferStatus`, `/payout/v2/…/get-transfer-status-v2` (L39/L46) | transfer status JSON | Bearer |
| Beneficiary read | `GET /payout/v1/get-beneficiary-details`, `get-beneficiary-history`, `get-beneficiary-id`, v2 `get-beneficiary-v2` (L39) | beneficiary JSON | Bearer |
| Credential check | `/api/v1/credentials/verify` — documented in prose only (L43): *"Use the endpoint `/api/v1/credentials/verify` to verify your credentials"* | ? | ? — **verb and full base-path prefix not stated → UNVERIFIED** (§14 U-5) |

- **Auth mechanism — two-step, and the first step is a POST:**
  1. `POST /payout/v1/authorize` with headers **`X-Client-Id` (required)** + **`X-Client-Secret` (required)**; `X-Cf-Signature` (RSA signature of `clientId + "." + unix_ts`) is optional **only if the calling IP is whitelisted**. Response `200` → `{status, message:"Token is valid", subCode:"200"}`. **"The generated token is valid for 6 minutes."** (L42). Failure: `401` `Invalid clientId and clientSecret combination`.
  2. Then `GET /payout/v1/getBalance` with `Authorization: Bearer <token>` (L40).
- **Production prerequisites (L44, 200):** API keys are generated in the merchant dashboard; **production key generation requires OTP authentication**; **production requires IP whitelisting (max 25 IPv4) or signature-based 2FA** — *"Your IP address needs to be whitelisted in the Cashfree production server or it rejects all incoming requests."* This is a *documented* explanation for edge-level rejections.
- **Official?** Yes — first-party docs. **Supported for programmatic server-side use by merchants.** Not scraping-adjacent.
- **Live liveness check was inconclusive at application level:** unauthenticated `GET https://payout-api.cashfree.com/payout/v1/getBalance` → **403 `text/html`**, `Server: awselb/2.0`, `<h1>403 Forbidden</h1>` (L53); same for v1.2 (L54). The **documented** error shape for this endpoint is `application/json` (`403 Token is not valid` / `403 APIs not enabled…` / `412 Token missing`), so what was observed is a **load-balancer/edge rejection, not proof that the application route is live** (§14 U-2). Conclusion: path behind auth *as documented*; application liveness **not** confirmed.

### Q3 — Write endpoints to forbid
All of Cashfree's transfer/withdrawal/destination-mutating endpoints — the real names, from the docs index (L39) and v2 tables (L45/L46): `Standard Transfer` + `Standard Transfer Sync/Async v1.2` + `Standard Transfer V2`, `Batch Transfer` (+ v1.2, + V2), `Direct Transfer` (+ v1.2), `Internal Transfer` (+ v1.2), `Validate Payout`/`Process Validated Payout` (Verify-and-Pay consumer), `Create Cashgram`/`Deactivate Cashgram`, `CardPay`, `Self Withdrawal`, `Lend`, `Add Beneficiary`/`Create Beneficiary V2`/`Remove Beneficiary`(+V2), One-Escrow endpoints (`Create Virtual Account`, `Add Registered Recharge Account`, `recharge-oneescrow-account`, `Debit Connected Wallet`, `Transfer Funds Between VAs`). Full list in §9. Note that **token acquisition itself is a POST** (`/payout/v1/authorize`) — a read-only monitor must treat that one POST as the single permitted non-GET, and nothing else.

### Q4 — ToS / ban exposure of automated read polling
- Cashfree's T&C (`https://www.cashfree.com/tnc/`, L51, **200**, 905 327 B) was text-searched for `automat*`, `scrap*`, `robot`, `spider`, `crawl`, `extract`: the **only** relevant hit is Cashfree reserving the right to crawl **the merchant's** site (*"Cashfree may use third-party tools for web crawls/ scrape the Merchant Site in order to identify high-risk keywords…"*). **No clause restricting the merchant's own programmatic API use was found.**
- **Programmatic use is the product's stated purpose** (L48: Payouts is a developer API for disbursals). Ban exposure of a once-daily read therefore appears **low** — but the T&C page is large and JS-rendered; this is a **text search, not a legal review** (§14 U-8).

### Q5 — Access gate, KYC, cost
- **Gate:** a **Cashfree merchant account with Payouts enabled**, plus (production) OTP-authenticated key generation and IP whitelisting/signature 2FA (L43/L44). The documented *"APIs not enabled. Please fill out the Support Form"* error (L40) is the activation gate.
- **KYC/business:** yes in substance — *"designed specifically for businesses across India"*, *"fully compliant disbursal processes that meet Indian regulatory requirements"* (L48). A consumer "free cash" rewards user does not fit this shape.
- **Cost:** **no published Payouts price list was found.** `/docs/payouts/payouts/general-faqs.md` (L49) contains no price list; `https://www.cashfree.com/payouts/pricing` (L52, 200) renders marketing content with **no price table** in the extracted text. The only monetary figure found anywhere is the **0.25% affiliate commission** for referring clients (L45) — unrelated to cost of use. **Cost = UNVERIFIED** (§14 U-7).

---

## 7. Non-provider, zero-credential read sources (recorded so the monitor is not left with nothing)

These are **not** provider APIs and must never be reported as provider-verified.

| Source | Status this session | What it can and cannot establish |
|---|---|---|
| Operator-entered daily figure (a file the operator writes) | no dependency; trivially available | Can establish *"the operator says the balance is X"*. Cannot establish the provider's view. Zero ToS exposure. |
| Provider email → IMAP parse (redemption receipts, restriction notices) | passive, post-hoc | Can establish *"a redemption/status email arrived"*. Cannot show a balance that changed without an email. Not "an automatic device accessing the **Website**" — stays outside the freecash.com §17.2 wording. |
| Existing provider export/statement downloaded by the operator | provider-dependent, manual | Truthful but not automated; the fetch is human. |
| `https://status.freecash.com/` (L19, 200, 599 B JS shell) | exists; page content not text-readable this session | Could establish **platform** availability only — **never** the account's balance or standing. UNVERIFIED content (§14 U-9). |
| Local AgenticOS metrics endpoint (`http://localhost:3001/api/v1/status/metrics`) | local substitute | Provider-unverified by construction; every snapshot it produces must remain `degraded: true`. |

---

## 8. CONTRACT TABLE (the deliverable)

`C#` = citable row id. "Auth" is the mechanism **as documented**; nothing here was exercised with real credentials.

| C# | Provider | Endpoint (as documented) | Verb | Returns | Auth | Official? | Verification status |
|---|---|---|---|---|---|---|---|
| C1 | freecash.com (Almedia) | *(no public API exists)* | — | — | — | — | **VERIFIED-BY-DOC** (absence: L3–L12, L14–L15) |
| C2 | freecash.com | `https://api.freecash.com/v1/status` (legacy repo endpoint) | GET | **HTTP 404**, empty body | n/a | no (does not exist) | **VERIFIED-BY-CALL** (L12) — DEAD, must not ship |
| C3 | freecash.com | `https://freecash.com/fc-api/…` (internal namespace; `auth/{google,facebook,apple}` referenced by the home page) | GET (candidate) | namespace root: **404 `application/json`**; sub-paths **undocumented** | session/OAuth-style, undocumented | **no** — private, `robots.txt`-Disallowed | **UNVERIFIED** (no schema; must not be used) — L2, L11, L22 |
| C4 | freecash.com | `https://freecash.com/user/{id}` (public profile HTML scraped by a third-party lib) | GET | HTML (username, level, offer stats, 7-day earnings) | none | **no** — unofficial scraper, `robots.txt`-Disallowed, 2022 | **VERIFIED-BY-DOC** (L2, L24, L25) — public data only, not the account |
| C5 | freecash.com | account balance / earnings / account standing for a logged-in user | — | — | none documented | **no** | **UNVERIFIED** — no evidence any documented endpoint exists |
| C6 | parse.bot (unofficial) | `GET https://api.parse.bot/scraper/{id}/{endpoint}` — `get_withdrawals`, `get_stats`, `get_offer_categories`, `get_featured_offers`, `get_cashout_methods` | GET | **platform-wide public data** | `X-API-Key` (parse.bot's key) | **no** | **VERIFIED-BY-DOC** (L23: `is_authenticated:false`) — cannot read an account |
| C7 | HG.Cash | `https://hg.cash/api/v1/accounts` | GET | `data[] {id,name,balance,pendingFees,netBalance,status,currency,number,alias,platform,company}` + `count`; `status ∈ {Operativa,Bloqueada,Cerrada}` | `Authorization: Bearer cash_<64-hex>` | **yes** | **VERIFIED-BY-DOC** (L26, L27, L32, L33) |
| C8 | HG.Cash | `https://hg.cash/api/v1/account/{id}/balance` | GET | `{id,balance,currency,pendingFees,netBalance,status}` | Bearer | **yes** | **VERIFIED-BY-DOC** (L28, L32, L33) |
| C9 | HG.Cash | `GET /accounts` with **no** credential | GET | **401** `application/json` `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}` | — | yes | **VERIFIED-BY-CALL** (L34) |
| C10 | HG.Cash | `GET /account/1/balance` with no credential | GET | **401** `application/json` (same body) | — | yes | **VERIFIED-BY-CALL** (L35) |
| C11 | HG.Cash | `GET /transaction/{id}/status` · `GET /transactions/{id}/receipt` | GET | request status · signed receipt URL (1h expiry) | Bearer | yes | **VERIFIED-BY-DOC** (L26) |
| C12 | HG.Cash | `GET /transaction-statuses` · `GET /transaction-types` | GET | reference lists | *"no auth required"* (single source) | yes | **VERIFIED-BY-DOC** (L32) |
| C13 | HG.Cash | `GET /alias-lookup` | GET | alias → CBU/CVU | Bearer (feature-gated) | yes | **VERIFIED-BY-DOC (conflicting verb)** — L32 says GET; prior repo doc says POST (see §13.3) |
| C14 | HG.Cash | `POST /transactions` (cash-out) and all other writes | POST | transaction request | Bearer | yes | **VERIFIED-BY-DOC** (L29) — **DENYLIST** (§9) |
| C15 | HG.Cash | numeric rate limits for the read endpoints | — | — | — | — | **UNVERIFIED** (L33 documents a generic `429`; no limits page: L36) |
| C16 | Cashfree | `POST /payout/v1/authorize` | **POST** | token (valid **6 minutes**) · `401 Invalid clientId and clientSecret combination` | headers `X-Client-Id` + `X-Client-Secret` (required); optional `X-Cf-Signature` | yes | **VERIFIED-BY-DOC** (L42) |
| C17 | Cashfree | `GET /payout/v1/getBalance` | GET | `{status,subCode,message,data:{balance,availableBalance}}` | `Authorization: Bearer <token>` + `Content-Type: application/json` | yes | **VERIFIED-BY-DOC** (L40) |
| C18 | Cashfree | `GET /payout/v1.2/getBalance` | GET | same + optional `paymentInstrumentId`; `422` if instrument unavailable | same | yes | **VERIFIED-BY-DOC** (L41) |
| C19 | Cashfree | `GET /payout/v1/getTransferStatus`, `/v1.2/getTransferStatus`, `/v2/…/get-transfer-status-v2`, `get-batch-transfer-status*`, v2 `get-beneficiary-v2` | GET | transfer/beneficiary JSON | Bearer | yes | **VERIFIED-BY-DOC** (L39, L45, L46) — read-only allowlist candidates |
| C20 | Cashfree | `GET https://payout-api.cashfree.com/payout/v1/getBalance` with **no** credential | GET | **403 `text/html`**, `Server: awselb/2.0` (edge) — **not** the documented JSON error | — | yes | **VERIFIED-BY-CALL** (L53) — path fenced; app liveness **not** proven |
| C21 | Cashfree | all transfer/withdrawal/destination writes (§9) | POST | — | Bearer | yes | **VERIFIED-BY-DOC** (L39, L45, L46) — **DENYLIST** |
| C22 | Cashfree | `/api/v1/credentials/verify` | *not stated* | *not stated* | *not stated* | yes (prose) | **UNVERIFIED** (L43 prose only — §14 U-5) |
| C23 | Cashfree | Payouts rate limit for `getBalance` | — | — | — | — | **UNVERIFIED** (L47: only Payments + SecureID limits published) |
| C24 | Cashfree | Payouts pricing | — | — | — | — | **UNVERIFIED** (L49, L52: no published price list) |
| C25 | HG.Cash | HG.Cash terms-of-service / automation clause | — | — | — | — | **UNVERIFIED** — no reachable ToS page (L38) |
| C26 | freecash.com | `https://status.freecash.com/` (public platform status) | GET | 200, JS shell; **content not verifiable** | none | third-party-ish | **VERIFIED-BY-CALL (existence only)** (L19) |
| C27 | local | `http://localhost:3001/api/v1/status/metrics` | GET | local substitute metrics | none | n/a (not a provider) | **VERIFIED-BY-DOC of design intent only** — not provider truth |

---

## 9. DENYLIST — permanently forbidden (hard rule, must be enforced below the monitor, not by convention)

### 9.1 By verb (global)
`POST` · `PUT` · `PATCH` · `DELETE` on **any** provider host, with **exactly one** documented exception (Cashfree token mint, D16) if Cashfree is ever chosen. Plus: **any** non-idempotent `GET` with side effects, `GET` with a body, and `HEAD` on transactional routes.

### 9.2 freecash.com — deny by prefix and by action
- Prefixes (all `robots.txt`-Disallowed, L2): `/fc-api/*` (incl. `auth/*`), `/user/*`, `/myprofile`, `/offer/*`, `/dev-playground/*`, `/scd-cgi/*`, `/w/*`.
- Actions: cashout/redemption (`/en/cashout` — L20), starting or completing an offer, submitting a survey, sign-in / credential / token POSTs, changing payment or payout details, redeeming rewards, gift-card purchase, any request carrying the operator's session cookie in an automated context.

### 9.3 HG.Cash — deny (documented writes, L26/L29/L33)
`POST /transactions` · `POST /checkouts` · `POST /checkouts/{id}/cancel` · `POST /claims` · `POST (/brazil|/chile|/bolivia)/inbound` · `POST (/brazil|/chile|/bolivia)/outbound` · `POST /alias-lookup` (if the verb is POST after all — treat POST as denied, §13.3) · any `/wallets`, `/withdrawals`, `/settlement`, `/spot` write path.
**Additional hard rule:** the HG.Cash bearer token is **account-wide** (§5/Q2). The monitor must hold it read-only *by construction*: a deny-by-default transport that refuses every verb except `GET` on `https://hg.cash/api/v1/accounts` and `https://hg.cash/api/v1/account/{uuid}/balance`.

### 9.4 Cashfree Payouts — deny (documented writes, L39/L45/L46)
`POST /payout/v1/requestTransfer` / standard transfer (sync, async, v1.2, V2) · batch transfer (v1, v1.2, V2) · direct transfer (v1, v1.2) · internal transfer (v1, v1.2) · `POST` validate-payout / verify-and-pay (direct transfer) · create/deactivate Cashgram · CardPay · self-withdrawal · Lend · add/remove beneficiary (v1, V2) · One-Escrow: create virtual account, add registered recharge (whitelist) bank account, allocate/recharge funds, debit connected wallet, transfer funds between VAs · any webhook-registration mutation · any refund/reversal endpoint.
**Only permitted non-GET:** `POST /payout/v1/authorize` (D16) — token mint, no money movement, 6-minute TTL, must be called at most once per daily run.

---

## 10. "What would prove a live read works" — test plan (for a future session that holds an operator-issued credential)

> **Run order matters.** Stage 0 must execute *before* any network call, so that "no credentials" is never reported as a provider error. Never print a token, header value, or response body containing one; the doc uses `[REDACTED]` and env vars only.

### Stage 0 — credential presence gate (local, no network)
```bash
# HG.Cash path
if [ -z "${HG_CASH_API_TOKEN:-}" ]; then echo "STATUS=no_credentials_configured"; exit 0; fi
# Cashfree path
if [ -z "${CASHFREE_CLIENT_ID:-}" ] || [ -z "${CASHFREE_CLIENT_SECRET:-}" ]; then echo "STATUS=no_credentials_configured"; exit 0; fi
```
**Acceptance:** with no credential present the probe prints `no_credentials_configured` and **issues zero HTTP requests**. This is the state this machine is in today.

### Stage 1 — negative controls (prove the path is what the docs say, before trusting a 200)
```bash
# HG.Cash: expected 401 application/json
curl -sS -o /dev/null -w 'code=%{http_code} type=%{content_type}\n' \
  https://hg.cash/api/v1/accounts
# Cashfree: expected an edge/HTTP rejection (403 text/html observed 2026-09-20)
curl -sS -o /dev/null -w 'code=%{http_code} type=%{content_type}\n' \
  https://payout-api.cashfree.com/payout/v1/getBalance
```
**Acceptance:** the observed code/type matches L34 / L53. If HG.Cash stops returning an `application/json` 401, the contract has drifted → stop and re-research.

### Stage 2 — the live read

**HG.Cash (rank-1 provider) — one GET, expected 200:**
```bash
# header form as documented:  Authorization: Bearer cash_<64-hex>   ([REDACTED])
curl -sS --fail-with-body -G \
  -H "Authorization: Bearer ${HG_CASH_API_TOKEN}" \
  -H 'Accept: application/json' \
  'https://hg.cash/api/v1/accounts' \
| python -c "import sys,json;d=json.load(sys.stdin);print({k:v for k,v in d.items() if k!='data'});[print({kk:a[kk] for kk in ('id','name','currency','balance','pendingFees','netBalance','status','number','alias') if kk in a}) for a in d.get('data',[])]"
# per-account variant, id from the call above:
curl -sS --fail-with-body -H "Authorization: Bearer ${HG_CASH_API_TOKEN}" \
  "https://hg.cash/api/v1/account/${HG_ACCOUNT_UUID}/balance"
```
**Expected fields (from L27/L28):** `data[].balance` (number), `data[].pendingFees`, `data[].netBalance`, `data[].status` ∈ `Operativa|Bloqueada|Cerrada`, `data[].currency`, `data[].number`, `data[].alias`, `count`.
**Proves the read works when:** HTTP 200 **and** every field above is present and correctly typed **and** the response is *different from* the Stage-1 control. Anything else is not a proof.

**Cashfree (rank-2) — two calls, because reading requires minting a POST token:**
```bash
# (1) token mint — the ONLY permitted non-GET. 6-minute TTL (L42)
CF_TOKEN=$(curl -sS -X POST \
  -H "X-Client-Id: ${CASHFREE_CLIENT_ID}" \
  -H "X-Client-Secret: [REDACTED]" \
  -H 'Content-Type: application/json' \
  'https://payout-api.cashfree.com/payout/v1/authorize' | python -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('token',''))")
[ -n "$CF_TOKEN" ] || { echo "STATUS=credentials_rejected_or_product_inactive"; exit 1; }
# (2) the read
curl -sS --fail-with-body \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H 'Content-Type: application/json' \
  'https://payout-api.cashfree.com/payout/v1/getBalance'
```
**Expected fields (L40):** `status:"SUCCESS"`, `subCode:"200"`, `message:"Ledger balance for the account"`, `data.balance` (string), `data.availableBalance` (string). *Note both are **strings**, not numbers — a monitor that assumes numeric types will break.*

### Stage 3 — classify the outcome (this is the "no credentials vs rejected" discriminator)

| Observation | Meaning | Correct monitor behaviour |
|---|---|---|
| env var unset / empty (Stage 0) | **`no_credentials_configured`** | emit the notice, **make no request**, keep `degraded: true` |
| HG.Cash **401** + `{"error":"Missing or invalid authorization header…"}` (L34) | request reached the app, token absent/invalid → **`credentials_rejected`** | alert operator; do **not** retry in a loop |
| HG.Cash **200** | **LIVE READ WORKS** | record with `provider_verified: true` |
| HG.Cash **404** on `/account/{id}/balance` (documented, L28) | token valid, **account id wrong / not yours** | distinct signal: `account_not_found` — not a credential problem |
| HG.Cash **429** (documented generic, L33) | rate limited | back off; never retry same day |
| `curl` exit 7 / HTTP `000` | **no network path** (host down, proxy, offline) | `transport_unreachable` — not an auth fact |
| Cashfree authorize **401** `Invalid clientId and clientSecret combination` (L42) | **`credentials_rejected`** | stop; do not attempt the balance call |
| Cashfree balance **412** `Token missing in the request` (L40) | the read was issued without the bearer header | bug in the routine, not in credentials |
| Cashfree balance **403** `Token is not valid` (L40) | token expired → the 6-minute TTL elapsed between calls | re-mint once, then give up |
| Cashfree **403** `APIs not enabled. Please fill out the Support Form` (L40) | **product not activated / KYC pending** — *distinct from* bad credentials | `provider_not_activated` |
| Cashfree **403 `text/html` `Server: awselb/2.0`** (observed, L53) | **edge rejection** — most likely the documented **IP whitelist** requirement (L44), *not* proof of a bad key | `egress_ip_not_whitelisted` — do not report as an auth failure |

**Two failure modes to keep strictly apart in every report:** (a) the routine had nothing to send → `no_credentials_configured`; (b) the routine sent something and the provider refused it → `credentials_rejected`/`provider_not_activated`/`egress_ip_not_whitelisted`. Conflating them is how a monitor silently reports "balance unchanged" while actually holding no credential at all.

---

## 11. Research task list

`Effort` is estimate in **hours** of focused work for one engineer-researcher. `Dependency` is the human decision or credential that must exist **before** the task can start (see §12).

| T# | Exact question | Source to try | Acceptance criterion | Effort | Hard dependency |
|---|---|---|---|---|---|
| **T1** | **Which provider/account is "Free Cash Finance Automation" actually monitoring?** | Operator, in writing (support ticket/statement screenshot); then the repo's `server/data/freecash-monitor/INTEGRATION_STATUS.md` corrected in place | The operator names the provider **and** produces one artefact (statement, email, app screenshot) that names the same provider | 2.0 | **D1** operator statement |
| **T2** | Does freecash.com grant **prior written consent** to an automated daily read (§17.2 "without our prior written consent")? | `support@freecash.com` / on-site chat, referencing the exact §17.2 wording and describing a read-only once-daily GET | A written yes/no from Almedia; **no reply after 15 business days = a documented NO** for design purposes | 1.5 + wait | **D1**, **D2** operator authorises contact with the provider |
| **T3** | Is the internal `/fc-api/` namespace documented anywhere (partner/NDA docs)? | Ask Almedia in the T2 message; nothing public exists (L3–L12) | Either a URL to a private spec (then re-verify) or explicit "no such documentation" | 0.5 | **D2** |
| **T4** | Does the operator actually hold an **HG.Cash** account, and can a token be issued? | Operator; then `https://docs.hg.cash/introduction.md` onboarding flow (L30) | Confirmed account id list (UUIDs) + a token generated in dashboard settings (**never pasted into chat or the repo**) | 2.0 | **D3** operator holds/creates an HG.Cash account; **D4** credential stored in a secret store, not `.env` in git |
| **T5** | First live **read-only** call: does `GET https://hg.cash/api/v1/accounts` return 200 with the documented fields? | The endpoint itself, per §10 Stage 2 (read-only, one call) | 200 + all documented fields present; response differs from the 401 control; result recorded with the raw **field names only** (no balances in the repo, no secrets) | 1.0 | **D4** credential; **D5** operator approves the one-off live read |
| **T6** | What are HG.Cash's **numeric** rate limits for the account endpoints? | Read `X-RateLimit-*` headers from T5; ask `api-support@hg.cash`; nothing published (L36, 404) | A number or an explicit "no published limit"; the monitor then runs 1 req/day (far below any plausible limit) | 1.0 | **D4** |
| **T7** | Does HG.Cash have a **terms-of-service with an automation clause**? | Ask onboarding/commercial contact (`comercial@hg.cash`, L37); all public legal paths 404 (L38) | A ToS URL + quoted automation clause, or a written statement that programmatic API use is permitted | 1.0 | **D2** |
| **T8** | Is there a **read-only / scoped** HG.Cash token, or is every token write-capable? | Ask HG.Cash support; spec shows a single `bearerAuth` scheme (L27/L33) | If no scoped token exists: the monitor's deny-by-default transport (GET-only allowlist, §9.3) is the control, and it must be mutation-tested | 2.0 | **D4** |
| **T9** | Does Cashfree Payouts even apply — is there a merchant account, and is Payouts enabled? | Operator; dashboard; `403 APIs not enabled` (L40) is the fallback signal | A yes/no. If no account: **close the Cashfree branch permanently** rather than keep researching it | 1.0 | **D6** operator states whether a Cashfree merchant account exists |
| **T10** | Cashfree production: is the egress IP whitelisted (or is signature 2FA configured)? | Dashboard → Developers → Two-Factor Authentication (L44) | Either the IP is on the whitelist or `X-Cf-Signature` is generated per call; the observed edge 403 (L53) is explained | 1.5 | **D6**, **D4** |
| **T11** | Cashfree Payouts **cost** per read/epoch (is a daily read billed?) | Cashfree account manager; pricing page has no table (L52, L49) | A written answer, or the branch is dropped as unmotivated | 1.0 | **D6**, **D2** |
| **T12** | Do the operator-entered / email-receipt paths actually satisfy the daily check **without** any provider API? | The repo's existing `scripts/notification_service.py`, the `himalaya` skill, and a real provider email the operator forwards | One full day-key end-to-end run producing a change/no-change record with `provider_verified: false` and `degraded: true` stated honestly | 4.0 | **D7** operator forwards one real provider email to a monitored mailbox |
| **T13** | What does `status.freecash.com` actually publish (components, incidents)? | `https://status.freecash.com/` rendered in a browser (the browser tool failed this session — §14 U-9) | Either a readable component/incident API-feed URL, or the source is closed as unusable | 1.0 | **D8** a working browser/render path on this host |

**Total estimated effort:** ~19.5 h + provider-communication waiting time (T2 is the long pole).

---

## 12. Hard dependency list (what a human must decide or supply)

| D# | Dependency | Type | Blocks | Why it cannot be researched away |
|---|---|---|---|---|
| **D1** | **Operator names the provider/account** being monitored | decision | T1, T2, T4 | Every artifact in the repo fails to name it; no public source can. Without it the provider question is unanswerable, not merely unanswered. |
| **D2** | Operator authorises **contacting the provider** (and accepts the risk of drawing attention to the account) | decision | T2, T3, T7, T11 | A ToS question can only be answered by the counterparty; the operator owns the relationship and the account-risk. |
| **D3** | Operator **holds or creates** an HG.Cash account (KYC-gated B2B onboarding, L30) | business decision + KYC | T4 | Onboarding requires a legal entity/identity documents the machine cannot supply. |
| **D4** | A **credential** exists in a secret store (not `.env` in git), used only by the read path | credential | T5, T6, T8, T10 | No credential exists on this machine today; none can be self-issued. |
| **D5** | Operator approves **one** live read-only call and confirms the account is theirs | approval | T5 | Reading someone's account is not a decision an agent may take alone. |
| **D6** | Operator states whether a **Cashfree merchant account** exists and is Payouts-enabled | decision | T9, T10, T11 | Cashfree is a B2B Indian disbursal platform; nothing in the repo links it to the monitored account. |
| **D7** | Operator **forwards one real provider email** to a mailbox the monitor can read (IMAP creds) | supply + credential | T12 | The most ToS-safe automated signal, but it needs the operator's mailbox. |
| **D8** | A working render/browser path on this host | environment | T13 | `browser_exec` failed this session (`uv trampoline failed to spawn Python child process`, os error 4551). |
| **D9** | A written decision record choosing the read source | decision | implementation | The point of this whole research programme; without it nothing should be built. |

---

## 13. Corrections to prior artefacts in this repo (do not copy them blindly)

1. **`PROVIDER-FINDINGS-REVERIFIED.md` claims `freecash.com/en/docs` and `/en/developers` return HTTP 404, size ≈55 279 B.** Today both return **302 → `https://freecash.com/en`** (the home page, ≈569 KB). Same conclusion (no docs page exists), **different evidence** — the code in the old doc is wrong and should be corrected if that file is ever re-issued.
2. **`PROVIDER-API-RESEARCH.md` §1 cites a `freecash.com` ToS last updated 2026-07-17 and quotes §16/§17** — confirmed today with the same effective date (L1) and the same wording; the deep-link form `#:~:text=` used there resolves to the same page (L1). No correction needed; the quotes are accurate.
3. **`PROVIDER-API-RESEARCH.md` lists `POST /alias-lookup` as an HG.Cash write endpoint.** The AR bank-transfers doc fetched today (L32) documents **`GET /api/v1/alias-lookup`**. The verb is **conflicting**: treat **both** verbs as denied for the monitor until the spec settles it.
4. **Any doc implying Cashfree Payouts is "the Free Cash provider"** is unsupported: the brand similarity is the only link, and Cashfree's own docs describe an India-business disbursal platform (L48). Keep Cashfree as a *fallback research lead only*.
5. **Any doc asserting `freecash.io` API endpoints with `X-API-Key`** is refuted by L17/L18 (parked domain) — the key scheme belongs to `parse.bot`, not to FreeCash.
6. **`node --check server/scripts/freecash-daily-monitor.mjs` fails today** (`SyntaxError: Unexpected token ':'` at line 41, TypeScript annotation in a `.mjs` file, Node v24.20.0). There is therefore **no runnable monitor whose endpoint usage could be inspected** — any claim about "what the monitor currently calls" must come from reading source, not from running it.

---

## 14. Verification register — VERIFIED vs UNVERIFIED

**Authoritative tally, counted row-by-row from §8's contract table (27 rows, C1–C27).** Each row appears in exactly one bucket:

| Status | Count | This session's probe result | Row ids |
|---|---|---|---|
| `VERIFIED-BY-DOC` | **13** | — (doc-level truth only) | C1, C4, C6, C7, C8, C11, C12, C13, C14, C16, C17, C18, C21 |
| `VERIFIED-BY-DOC` (consolidated read-only endpoints) | **1** | — | C19 |
| `VERIFIED-BY-CALL` | **5** | 404 (C2) · 401 json (C9) · 401 json (C10) · 403 html edge (C20) · 200 JS shell (C26, existence only) | C2, C9, C10, C20, C26 |
| `VERIFIED-BY-DOC of design intent only` | **1** | no call made (local `localhost` substitute) | C27 |
| `UNVERIFIED` | **7** | no fetchable evidence / no credential | C3, C5, C15, C22, C23, C24, C25 |
| **Total** | **27** | | |

**Summary line to quote:** `VERIFIED-BY-DOC = 14` · `VERIFIED-BY-CALL = 5` · `design-intent-only = 1` · `UNVERIFIED = 7` · **total 27 rows**.
**No row is `VERIFIED-BY-CALL` in the sense "a real balance was read"** — see §0.1. `C13` carries a documented verb conflict (§13.3) and is counted once, as VERIFIED-BY-DOC.

**UNVERIFIED register (with the failure reason and what would resolve each):**

| U# | Unverified item | Failure reason (this session) | What would resolve it |
|---|---|---|---|
| U-1 | HG.Cash has **no automation prohibition** / HG.Cash ToS content | `https://hg.cash/terms`, `/terms-and-conditions`, `/en/terms`, `/legal`, `/es/legal/terms`, `/es/terminos`, `/terminos-y-condiciones`, `/privacy`, `/sitemap.xml` → **all 404**; docs index (L26) has no legal section; the site's footer is client-rendered and the browser tool failed (D8) | Ask HG.Cash onboarding/commercial for the ToS URL (T7); or render `https://hg.cash/es` in a working browser and follow footer legal links |
| U-2 | Cashfree `getBalance` **application-level** liveness | unauthenticated GET → **403 `text/html`**, `Server: awselb/2.0` (L53/L54) — an edge/LB page, not the documented JSON error. Same finding as the prior re-verification pass | A merchant credential + whitelisted IP/signature (D6, T10), then one authorized read; or ask Cashfree support whether `/payout/v1/getBalance` is behind an LB IP allow-list |
| U-3 | HG.Cash **numeric** rate limits | `https://docs.hg.cash/rate-limits` → **404**; docs index lists no rate-limit page; the spec documents only a generic `429` (L33) | Read `X-RateLimit-*` headers on the first authenticated read (T6), or ask `api-support@hg.cash` |
| U-4 | HG.Cash **fee schedule** (incl. whether read calls are free) | `https://docs.hg.cash/pricing.md`, `/fees.md` → **404**; only the marketing claim *"$0 fee de setup. Sin volumen mínimo."* (L37) and a **1% example** outbound fee in the docs (L29/L32) | Ask HG.Cash commercial contact; or read the fee fields on an authenticated account |
| U-5 | Cashfree `/api/v1/credentials/verify` — verb, base path, response | Docs state the path in prose only, with no verb and no base-URL prefix (L43) | Fetch the page's OpenAPI block in full (the `.md` was truncated at 1 018 B) or ask Cashfree support |
| U-6 | Cashfree **Payouts** rate limit for `getBalance` | `.../api-reference/rate-limits.md` (L47) links Payments and SecureID limit pages **only** | Merchant dashboard → Developers → Rate Limits (needs D6) |
| U-7 | Cashfree Payouts **pricing** | `/docs/payouts/payouts/general-faqs.md` (52 KB) contains no price list; `https://www.cashfree.com/payouts/pricing` renders marketing content with no table (L52); only a 0.25% *affiliate* commission figure found | Cashfree account manager (T11) |
| U-8 | Cashfree T&C has **no clause restricting the merchant's own API use** | Verified only as a *text search* over a 905 KB JS-rendered page (L51) — not a legal review | Human/legal read of `https://www.cashfree.com/tnc/` and any Payouts product schedule |
| U-9 | `https://status.freecash.com/` content (components, incidents, feed URL) | 200 but a 599-byte JS shell (`status-pages-site-*.js`); no text content retrievable without a browser | Render it in a working browser (D8); if a JSON feed exists, capture the URL |
| U-10 | Whether freecash.com exposes **any** private/partner API under NDA | No public evidence exists (L3–L12); only Almedia could confirm | Ask Almedia directly (T2/T3) |

---

## 15. Rank-ordered provider recommendation (ToS/ban risk weighted, not technical ease)

**Rank 0 — the recommended source is not a provider API at all.** For a routine whose stated purpose is *protecting* an account and whose provider prohibition is explicit, the correct build order is: **(1)** operator-entered daily figure + **(2)** passive parsing of the operator's own provider email (T12), with every record marked `provider_verified: false`. This has **zero** ToS exposure, needs no credential beyond a mailbox, and is certifiable offline. It is a genuine once-daily read-only check of *operator-supplied truth*, and it must never be described as provider-verified.

**Rank 1 — HG.Cash** (only if T4 confirms the operator actually holds an account there).
- **For:** the **only** candidate whose read-only balance **and account-standing** endpoints are both officially documented (`GET /api/v1/accounts`, `GET /api/v1/account/{id}/balance`) *and* confirmed live by an unauthenticated application-level probe (401 `application/json` naming the exact Bearer scheme, C9/C10). Simple bearer auth, MIT-licensed OpenAPI, backend-use explicitly intended, `$0` setup fee, no published automation prohibition, one GET per day needs no scheduler cleverness.
- **Against (the single strongest):** **the token is not scope-limited.** The same bearer token that reads the balance also authorises `POST /transactions` — the cash-out that moves money — and HG.Cash publishes no read-only key or scope. A "read-only monitor" would therefore hold a **write-capable credential**, and the only thing standing between the monitor and a transaction is the monitor's own transport policy. Secondary, and nearly as heavy: **nothing links the monitored account to HG.Cash**, HG.Cash is LATAM iGaming payment infrastructure, onboarding is KYC-gated B2B, and **no ToS could be fetched**, so "no automation clause exists" is unproven (U-1).

**Rank 2 — Cashfree Payouts.**
- **For:** fully documented, first-party, programmatically intended; `getBalance` returns ledger + available balance with a documented schema; no automation prohibition found in a 905 KB T&C text search; a **B2B** platform, so a daily poll is architecturally normal.
- **Against:** **every read starts with a POST** (`/payout/v1/authorize`, 6-minute token) using a client **secret**, production requires OTP-authenticated key generation and **IP whitelisting**; `getBalance`'s application-level liveness is **not** confirmed (U-2, edge 403 observed); it is an Indian business disbursal account that has **no connection** to the monitored account; price per read is unpriced (U-7). Also note that `getBalance` reports *the merchant wallet*, which is only meaningful if the monitored balance literally lives in a Cashfree payout wallet — which nothing suggests.

**Rank 3 (REJECTED) — freecash.com / freecash.io as an automated read source.**
- **For:** it is the platform the routine is named after, and the account genuinely lives behind a login there.
- **Against (decisive):** §17.2 prohibits *"any robot, spider or other automatic device … for any purpose, including **monitoring**"* and *"any manual process to monitor … without our prior written consent"*; §19 lets Almedia terminate the account and **void unredeemed rewards**; §17.5 means the operator will not even be told which signal triggered it. There is **no public API and no documented internal endpoint**; the only discovered internal namespace (`/fc-api/`, plus `/user/`, `/myprofile`) is `robots.txt`-Disallowed, and the only public "Freecash API" in existence is a **4-year-old HTML scraper of other users' profile pages**. Building this does not just risk the account — it risks *exactly the balance the routine exists to watch*.

**Rank 4 (REJECTED) — `parse.bot` wrapper.** Unofficial, `is_authenticated: false`, platform-wide public data only, priced per credit, sourcing a parked domain, and it inherits the freecash.com §17.2 exposure without ever returning a balance.

**If the operator later obtains freecash.com's prior written consent (T2 → yes),** the ranking changes and freecash.com becomes the only *correct* provider — but only with a documented, consented endpoint in hand, which today does not exist.

---

## 16. Definition of done for this plan

This plan is complete when: (a) every row in §8 carries a status and every `UNVERIFIED` row in §14 has a named resolution path; (b) D1–D9 are either satisfied or explicitly waived in writing by the operator; (c) the chosen read source has been exercised **once** with a real credential and the §10 Stage-3 classification was recorded; and (d) no artefact anywhere claims provider-verified status from a source that was operator-entered, local, or unexercised. Until (a)–(d) hold, every snapshot this routine produces must say `degraded: true` and `provider_verified: false`.

*No repo file other than this one was created or modified. Scratch fetch artefacts live under `%LOCALAPPDATA%\Temp\fcr\` (outside the repository) and are disposable.*

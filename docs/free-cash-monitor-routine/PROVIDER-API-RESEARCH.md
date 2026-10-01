# Provider API Research — Read-Only Status/Balance for "Free Cash Finance Automation"

**Date of empirical testing:** 2026-09-17 (Europe/Berlin)
**Scope:** documentation and public unauthenticated probes only. No login, no signup, no account access, no credentials used or requested.
**Question:** does a real read-only status/balance API exist for the account this routine must monitor?

## VERDICT

**NOT AVAILABLE** — no live read-only status/balance data source exists for the account as currently
configured. The specifically-named consumer platform (freecash.com) publishes no public API *and*
prohibits automated access (including monitoring) in its Terms of Service. The two genuine read-only
balance APIs found (HG.Cash, Cashfree Payouts) are KYC/merchant-gated B2B services with no credentials
in this repo and nothing linking them to the monitored account.

Sub-finding, stated separately because it matters: **which provider the monitored account actually sits
on is UNVERIFIABLE from this repository.** No file names the provider, and no credential exists.
That identity must come from the operator before any provider read can be built.

---

## 0. Repo-local evidence (what the existing code actually points at)

| Fact | Evidence |
|---|---|
| `https://api.freecash.com/v1/status` **does not exist** | `GET` → **HTTP 404** (empty body). Also `https://api.freecash.com/` → 404 and `/v1` → 404. Host resolves via Cloudflare (104.26.x / 172.67.x) but serves nothing at those paths. |
| `http://localhost:3001/api/v1/status/metrics` **has nothing listening** | `curl` → exit 7 `Failed to connect`, HTTP 000. |
| No provider credentials configured | `.env` and `.env.example` exist but contain **zero** `FREECASH_*`, `CASHFREE_*`, or `HG_CASH*` keys (recursive grep over all `.env*` for `freecash` → 0 files). |
| The adapter concedes it is not connected | `server/src/adapters/freecashMonitorAdapter.ts`: `externalConnected: false`, `externalStatusMessage: '... External FreeCash API connection is not configured.'` |
| The Python monitor is a hardcoded stub | `scripts/make_freecash_check.py::fetch_status()` returns a literal dict — `{"balance": 0, "available_to_withdraw": 0, "pending_surveys": []}`. It never makes a network call. |
| The design doc already flagged this | `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` §3.1 marks W3/W4 as `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`, and §11 states the `.mjs` endpoint "is **not** grounded in anything and must not be carried forward." That assessment is empirically correct. |

---

## 1. FreeCash.com (Almedia GmbH) — consumer rewards platform

- **Official public API:** **NO**
- **Doc URL:** none exists. `https://freecash.com/sitemap.xml` indexes only `/api/sitemap/{1..5}/sitemap.xml`
  (their own internal namespace); no developer/API/partner page is published.
- **Base URL:** n/a. `freecash.com/robots.txt` explicitly `Disallow: /fc-api/` and `Disallow: /dev-playground/`
  — an internal application backend deliberately kept out of public reach, not a documented API.
- **Auth method:** n/a. There is no documented scheme (no API key, no OAuth, no bearer) for third parties.
- **Read-only endpoints (exact paths):** **NONE.** No public GET balance/status/earnings/transactions
  endpoint exists. UNVERIFIED by definition — verifying this would require a private contract from Almedia.
- **Rate limits:** n/a (no API).
- **ToS restriction on automation: YES — explicit, and it names monitoring directly.**
  `https://freecash.com/en/policies/terms` (last updated 2026-07-17), Section 16/17:
  > "These Terms of Services permit you to use the Website for your **personal, non-commercial use only**."

  > "Use any **robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring** or copying any of the material on the Website."

  > "Use any **manual process to monitor** or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, **without our prior written consent**."

  > "To use **macros, bots, scripts, or any other automation tools** designed to simulate or replicate human user activity … Such behavior is **strictly prohibited**."

  Corroborated by Freecash's own help centre, "How Can I Avoid a Ban?"
  (`https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned`):
  > "Freecash is for **personal and non-commercial purposes only**." … "**Do not use any automatic device like a robot or spider to access the site.**"

  Note the reach: the prohibition covers *automated* access **and** *manual* monitoring, and a
  daily automated status poll is automated access by an "automatic device". Any session-cookie or
  browser automation route is therefore a Terms breach, independent of whether it is technically possible.
- **Confidence:** **HIGH** for "no public API" and HIGH for the ToS prohibition.
  Supporting URLs: `https://freecash.com/en/policies/terms`,
  `https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned`,
  `https://freecash.com/robots.txt` (fetched), and the 404s above.
- **Account-status implication:** ToS-banned access risks the very account being monitored
  (Freecash restricts/terminates accounts for automation), so an automated poll is not merely
  non-compliant — it is directly counter to the workflow's own goal of protecting the account.

## 2. FreeCash.io — **NOT A PLATFORM**

- **Official public API:** **NO** — the domain is not an operating service.
- **Doc URL:** n/a. `https://freecash.io/llms.txt` states: *"freecash.io is a domain name currently
  listed for sale on GoDaddy's aftermarket,"* with a GoDaddy escrow listing.
- **Base URL / auth / read-only endpoints / rate limits:** none.
- **ToS restriction on automation:** n/a.
- **Confidence:** **HIGH** (verbatim from the domain's own `llms.txt`, fetched 2026-09-17).
- **Correction to the repo:** `server/data/freecash-monitor/INTEGRATION_STATUS.md` §1 lists
  "FreeCash.io Platform APIs … Auth: X-API-Key" with a `parse.bot` URL. That is wrong on two counts:
  (a) freecash.io is a parked domain for sale, and (b) the `X-API-Key` scheme is **parse.bot's** key,
  not FreeCash's. This entry must not be treated as a live provider contract.

## 3. getfreecash.com — **NOT AN API**

- **Official public API:** NO.
- Probe: `https://getfreecash.com/` → HTTP 200 with a body of literally `OK` and
  `Content-Type: application/octet-stream` (openresty). A placeholder/liveness endpoint, not a service.
- **Base URL / auth / endpoints / rate limits / ToS:** none applicable.
- **Confidence:** **HIGH** (live probe, 2026-09-17).

## 4. HG.Cash — real API, read-only balance endpoints exist (but not this account's)

- **Official public API:** **YES** (documented, published OpenAPI).
- **Doc URL:** `https://docs.hg.cash/api-reference/accounts/get-user-accounts`
  (index: `https://docs.hg.cash/llms.txt`; spec: `https://docs.hg.cash/api-reference/openapi.yaml`)
- **Base URL:** `https://hg.cash/api/v1` (production); `http://dev.hg.cash/api/v1` (development).
  Documented at `https://docs.hg.cash/openapi` and `https://docs.hg.cash/countries/argentina/bank-transfers`.
- **Auth method:** HTTP Bearer — header `Authorization: Bearer cash_<64-char-hex>`.
  Token is generated **manually in the account settings page**; no self-serve signup.
- **Read-only endpoints (exact paths):**
  - `GET /accounts` → accounts with `balance`, `pendingFees`, `netBalance`, `status`
    (`Operativa` | `Bloqueada` | `Cerrada`), `currency`
  - `GET /account/{id}/balance` → `balance`, `pendingFees`, `netBalance`, `currency`, `status`
  - (also read-only: `GET /transaction/{id}/status`, `GET /transactions/{id}/receipt`)
  - **Write endpoints, to be avoided by the monitor:** `POST /transactions` (cash-out),
    `POST /checkouts`, `POST /alias-lookup` (paid feature).
- **Empirical confirmation the endpoint is live:** `GET https://hg.cash/api/v1/accounts`
  (unauthenticated, no credentials supplied) → **HTTP 401** with body
  `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}`.
  The path is real and the auth requirement is as documented.
- **Rate limits:** **UNVERIFIED** — HG.Cash publishes no rate-limit page; the complete docs index
  (`llms.txt`) contains no rate-limit entry. Verifying would require asking HG.Cash onboarding.
- **ToS restriction on automation:** **NO** — this is an API designed for programmatic server-side use
  ("Implement in your backend services"). Published under an MIT-licensed spec. No automation prohibition found.
- **Access gate:** **KYC-gated B2B onboarding.** `https://docs.hg.cash/` requires a contact-form request
  plus KYC approval before access; HG.Cash describes itself as "Payment infrastructure for iGaming
  operators in Latin America". **No credentials for this account exist in the repo.**
- **Confidence:** **HIGH** for the API contract (official docs + live 401 probe);
  **MEDIUM** that it relates to the monitored account at all — nothing in the repo ties it there.
- **Relevance caveat:** HG.Cash is a LATAM (ARS/BRL/CLP/BOB) iGaming payment rail. It is plausible as a
  *payout destination*, but it is not a "Free Cash" consumer rewards account, and no evidence links it.

## 5. Cashfree Payouts — real API, read-only balance endpoint exists (but not this account's)

- **Official public API:** **YES** (documented, OpenAPI published).
- **Doc URLs:** `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`,
  `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance-v12`,
  `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize`
- **Base URL:** `https://payout-api.cashfree.com` (production);
  `https://payout-gamma.cashfree.com` (sandbox).
- **Auth method:** two-step. `POST /payout/v1/authorize` with headers `X-Client-Id` and
  `X-Client-Secret` (obtained after merchant signup) returns a token; then send
  `Authorization: Bearer <token>` on all payout calls. (`X-Cf-Signature` is optionally required
  when the caller's IP is not whitelisted.)
- **Read-only endpoints (exact paths):**
  - `GET /payout/v1/getBalance` → `{"data":{"balance":"214735.50","availableBalance":"173980.50"}}`
  - `GET /payout/v1.2/getBalance` → same shape, optional `paymentInstrumentId` query param
  - (also read-only: `GET /payout/v1/getTransferStatus`, retrieve-beneficiary endpoints)
  - **Write endpoints, to be avoided:** initiate/standard/direct/batch transfer, self-withdrawal, internal transfer.
- **Empirical check:** `GET https://payout-api.cashfree.com/payout/v1/getBalance` and
  `/payout/v1.2/getBalance` (unauthenticated) → **HTTP 403** (documented as "Token is not valid" /
  "APIs not enabled"). Path is behind auth as documented.
- **Rate limits:** **NOT PUBLISHED for Payouts.** The rate-limit reference page
  (`https://www.cashfree.com/docs/api-reference/rate-limits`) enumerates Payments and SecureID only;
  the Payouts v1 overview lists transactions-per-minute for *transfer* APIs but not for Get Balance.
  Generic mechanism is documented: headers `X-RateLimit-Limit` / `-Remaining` / `-Reset`, `429` on exceed.
  Exact Get Balance limit = **UNVERIFIED** (would require the merchant dashboard).
- **ToS restriction on automation:** **NO** — programmatic use is the intended purpose.
- **Access gate:** merchant account + Payouts API explicitly enabled (403 message: "APIs not enabled.
  Please fill out the Support Form"). **No credentials exist in the repo.**
- **Confidence:** **HIGH** for the API contract (official docs + live 403 probe);
  **LOW** that it relates to the monitored account — Cashfree is an Indian payments company whose
  brand merely *echoes* "Free Cash"; nothing in the repo connects them.

## 6. Third-party wrapper cited in the repo (parse.bot) — cannot serve this purpose

- **Official API:** NO — it is an independent, self-described scraper wrapper. Its own page states:
  *"This isn't an official freecash.io API — it's an independent, maintained REST wrapper over public
  data."* … *"**Freecash does not publish a documented public developer API.**"*
- **Base URL:** `https://api.parse.bot/scraper/{scraper_id}/{endpoint_name}`, header `X-API-Key: pmx_...`
- **Endpoints (`https://freecash.io` as source):** `GET get_leaderboard`, `GET get_withdrawals`,
  `GET get_stats`, `GET get_offer_categories`, `GET get_featured_offers`, `GET get_cashout_methods`.
- **Fatal for this use case:** these return **public platform-wide data** (top-earner leaderboards,
  other users' cashout feed). They are not the monitored account's balance, earnings, or status.
  `is_authenticated: false` — the wrapper has no notion of "your account".
- **Also:** the source URL is `https://freecash.io`, which per §2 is a parked domain for sale, so the
  listing is of unclear provenance/stability.
- **Rate limits:** 500 req/min claimed at the highest tier; per-call credit pricing.
- **ToS restriction on automation:** **YES, indirectly** — using it to read freecash.com content still
  breaches the freecash.com ToS quoted in §1, and it cannot reach private account data in any case.
- **Confidence:** **HIGH** that it is unofficial and not an account-status source.
  URL: `https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api`
  (confirmed live via `GET https://api.parse.bot/marketplace/apis?q=freecash`).

---

## 7. Realistic read-only alternatives (feasibility + fragility)

| Alternative | Feasibility | Fragility |
|---|---|---|
| **Session-cookie / browser-based read of the account page** | Technically feasible (log in as the human, read the rendered balance). | **Breaches freecash.com ToS §16/17** — "automatic device … including monitoring". Session cookies expire, MFA/KYC interrupts, page markup changes silently, and Freecash restricts accounts for automation — it puts the monitored account itself at risk. **Do not build.** |
| **CSV / account export download** | Only if the provider offers an export in the UI; freecash.com publishes no documented export endpoint. | Not verifiable without logging in (out of scope here). Even if present, the fetch is automated access under the same ToS clause; and it is pull-per-day by hand, not a monitor. |
| **Email receipt parsing** (provider emails → IMAP → parse) | **Most viable.** Receipts arrive on redemption/payout and status-change emails arrive on account restriction. The repo already has `scripts/notification_service.py` (stdlib `smtplib`) and the `himalaya` skill for IMAP. | Depends on the operator forwarding provider mail to a monitored mailbox; parsing is regex-brittle to template changes; **email is a post-hoc record, not a live balance** — it cannot show a partial balance change that generated no email. But it is passive, cheap, and not an "automatic device accessing the Website", so it does not trip the automation clauses. |
| **Human-entered daily figure** (operator pastes balance; monitor diffs and notifies) | **Trivially feasible, zero legal/ToS exposure**, and is a true read-only daily check of operator-supplied truth. | Manual; a missed day is silent unless the watchdog flags it (the design's missed-day watchdog already covers this). |
| **AgenticOS local metrics API** (`GET http://localhost:3001/api/v1/status/metrics`) | The design's W1 substitute source. | Nothing is listening today (HTTP 000), and even when running it is a **local substitute, not provider-verified** — the design correctly marks every such snapshot `degraded: true`. |

---

## 8. What the monitor must do, given the verdict

1. **Do not ship `https://api.freecash.com/v1/status`.** Empirically dead (404). It must not be carried forward
   (the design doc already says this; this research confirms it).
2. **Do not build any session-cookie, browser-automation, or scraping path against freecash.com.**
   It breaches ToS §16/17 (which explicitly names monitoring) and jeopardises the account being monitored.
3. **Keep `degraded: true` on every snapshot** and state plainly in all reports that status is
   **operator-supplied / local-substitute, not provider-verified**. A "no change" report must never be
   presented as provider-confirmed.
4. **Implement the daily check against a passive source that requires no external API**: email-receipt
   parsing and/or operator-entered balance, with the existing atomic day-lock, dedupe-keyed change
   detection, and `NOT_EXECUTED` approval queue unchanged. All R1–R4 enforcement stays intact and offline-provable.
5. **Route the provider question back to the operator.** Two facts are needed and cannot be derived from
   the repo: (a) *which* provider/account is the monitored account, and (b) whether a token can be issued
   for it. If the operator confirms HG.Cash or Cashfree Payouts (with credentials), the read-only
   allowlist can be extended to exactly `GET /accounts` / `GET /account/{id}/balance` (HG.Cash) or
   `GET /payout/v1/getBalance` (Cashfree) with `# readonly-exempt:` justifications.
6. **Never widen the allowlist to a write path.** `POST /transactions` (HG.Cash) and all Cashfree
   transfer/withdrawal endpoints stay forbidden; R2's deny-by-default transport already enforces this.

## 9. What would raise confidence / close the open items

- **HG.Cash rate limits:** ask HG.Cash onboarding (`api-support@hg.cash`) or read the rate-limit headers
  from a first authenticated `GET /accounts` call.
- **Cashfree Get Balance rate limit:** merchant dashboard → Developers → Rate Limits.
- **The account's real provider:** operator confirmation. Without it, "which provider?" remains UNVERIFIABLE.
- **Whether any freecash.com API exists under NDA:** only Almedia could confirm; no public evidence exists,
  and their ToS posture indicates none is offered to consumers.

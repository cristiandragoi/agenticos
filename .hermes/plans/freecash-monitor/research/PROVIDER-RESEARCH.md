# PROVIDER-RESEARCH.md — Read-only data path for a "Free Cash" rewards-account daily status check

**Retrieval date for every live claim below: 2026-09-20 (UTC), Europe/Berlin.**
Machine: Windows 11 (10.0.26200.0), git-bash, curl 8.21.0, Node v24.20.0, Python 3.11.9.
Scope: read-only research + unauthenticated probes. No login, no signup, no credentials requested or used.
Every factual claim carries a source. Anything I could not confirm from a live source is labelled **NOT VERIFIED**.

---

## 0. Bottom line

| Question | Answer |
|---|---|
| Official Freecash API to read balance/status? | **No.** No developer page, no auth scheme, no endpoints. Its ToS forbids automated access *and* "manual process to monitor". |
| HG.Cash relevant? | **Real API, wrong business.** LATAM iGaming payment rail, KYC-gated onboarding. No evidence of an account. Unrelated unless the operator says otherwise. |
| Cashfree Payouts relevant? | **Real API, wrong business.** India merchant payout rail for bank/UPI disbursements. No evidence of an account. Unrelated. |
| Compliant read-only path today? | Human reads the dashboard and types the four fields into the existing `operator_state` record. That is the only route that is both ToS-clean and read-only. |
| Email parsing? | Partially viable in principle (ToS §15.2 guarantees service emails), but no live source confirms Freecash emails at *every* earnings change → **NOT VERIFIED** as a change detector. |
| Safest notification channel on this machine? | Windows local balloon notification — **verified working**, needs no credential and no network egress. ntfy webhook verified reachable with no credential (public topic). Email needs a credential that does not exist here. |

The repo's hardcoded endpoint (`https://api.freecash.com/v1/status`) does not exist: `GET` → **HTTP 404** for `/`, `/v1/status` and `/v1/me` (curl, 2026-09-20). It must not be carried forward.

---

## 1. Freecash.com (Almedia GmbH) — is there an official public API? **NO**

### 1.1 Live probes (all 2026-09-20)

| Probe | Result |
|---|---|
| `GET https://freecash.com/robots.txt` | 200. `Disallow: /user/`, `/myprofile`, `/fc-api/`, `/offer/`, `/dev-playground/`, `/_next/`, `/_ipx/`, `/scd-cgi/`, `/w/`. Sitemap declared. → the internal app namespace is deliberately excluded from crawling. |
| `GET https://freecash.com/sitemap.xml` | 200, index of 5 sub-sitemaps under `/api/sitemap/{1..5}/sitemap.xml`. |
| All 5 sitemaps (6,321 `<loc>` entries) grepped for `api`, `develop`, `notif`, `setting`, `partner` | Only `/academy/<lang>/discover/partner/affiliates` and `/academy/<lang>/discover/partner/become-a-partner`. **No developer/API page. No notification-settings page.** |
| `GET https://freecash.com/api` → 200, `/api-docs` → 200, `/dev-playground` → 200 | **Trap:** all three serve the *same* marketing homepage (`<title>Freecash: Free Cash, PayPal, Bitcoin &amp; more! | Freecash.com</title>`, identical meta description) under different `lang` values. A slug containing "api" is **not** documentation. No occurrence of `swagger`, `openapi`, `X-API-Key` or "developer portal" in the body. |
| `GET https://freecash.com/api/docs`, `/api/swagger`, `/api/v1`, `/developers` | **404** (Next.js error page). |
| `GET https://freecash.com/fc-api/v1/status`, `/fc-api/auth/me` | **404** JSON from the internal NestJS service: `{"statusCode":404,...,"message":"Cannot GET /v1/status"}`. The service exists (it answers), the resource does not, and no unauthenticated account read is possible. |
| `GET https://freecash.com/en/signin` | 200 (login page reachable). |
| `GET https://freecash.io/llms.txt` | Verbatim: *"freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket."* Listing: `https://forsale.godaddy.com/forsale/freecash.io`. **freecash.io is not a platform.** |
| `GET https://api.freecash.io/v1/status` | curl exit 000 — host does not resolve from this machine. |
| `https://freecash.com/.well-known/security.txt` | 404. |

### 1.2 What that means for item (1) of the brief

There is **no** official public/documented API, therefore there is **no** endpoint to list, **no** auth scheme (no API key, no OAuth scope, no bearer token for third parties), **no** documented rate limits, and **no** status/balance resource. This is a negative finding established by (a) the absence of any developer page across 6,321 sitemap URLs, (b) 404s on every plausible docs path, and (c) the app's `robots.txt` explicitly fencing off `/fc-api/`.

> **NOT VERIFIED:** that an undocumented, authenticated internal endpoint exists for the wallet/balance (e.g. under `/fc-api/...`). Confirming it would require an authenticated session, which this research did not create and which the ToS forbids (§2 below).

---

## 2. The ToS position (load-bearing for every alternative)

Source: `https://freecash.com/en/policies/terms` — "Last Updated: July 17, 2026" (fetched 2026-09-20). Verbatim quotes:

- §16.1: *"These Terms of Services permit you to use the Website for your personal, non-commercial use only."*
- §17.1: *"To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity, including but not limited to automating clicks, movements, or tasks within offers or apps. Such behavior is strictly prohibited…"*
- §17.2 first bullet: *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring** or copying any of the material on the Website."*
- §17.2 second bullet: *"Use any **manual process to monitor** or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, **without our prior written consent**."*
- §15.2: *"you agree to receive essential service-related communications, such as account notifications, transaction confirmations, and security updates. These communications are necessary for the functioning of the service and cannot be opted out of."*
- §15.4: Almedia may disable any account identifier at any time, including for a suspected violation.
- §7.2 / §8.4(5): rewards are credited only when validated by Almedia or its partners, and credits may be held up to 90 days.

Corroboration from Freecash's own help centre, "How Can I Avoid a Ban?" (`https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned`, page updated Nov 13, 2025, fetched 2026-09-20): *"Freecash is for personal and non-commercial purposes only"* and *"Do not use any automatic device like a robot or spider to access the site."*

**Consequence:** an automated daily poll of freecash.com — whether by headless browser or by replaying a session cookie — is automated access to the Website and is prohibited by §17. The prohibition also reaches deliberate *manual* monitoring without prior written consent, so even the least-invasive "read the dashboard yourself" route is only defensible as ordinary personal use of one's own account, not as an authorised monitoring programme.

> **Interpretation (mine, not a quote):** a human logging into their own account and reading their own balance is ordinary personal use, and I found no provision that bans it. Whether a *programmatic* re-read of that same page counts as "monitoring" is settled by §17.2 — it does. Treat the manual route as the only unambiguous one.

---

## 3. Realistic read-only alternatives (item 2)

For each: credential/2FA, fragility, ToS exposure.

### 3.1 Authenticated browser-session automation (Playwright / Puppeteer / computer-use)
- **Credential/2FA:** Freecash account email + password `[REDACTED]`. **2FA is email-based**: `https://freecash.com/academy/en/support/account/profile/how-enable-2fa` (updated Aug 19, 2026, fetched 2026-09-20) — *"logging in requires both your password and a 6-digit code sent to your email"*, valid 30 minutes, resend after 60 s, lockout after 5 wrong codes. Same article: *"Freecash may request a verification code for certain higher-risk logins, even if you haven't enabled 2FA yourself. For example, when we detect a new device, a new IP address, or a login after a long period of inactivity."*
- **Fragility: HIGH.** A headless/automated login is exactly the "new device / new IP" signal that triggers a code sent to the operator's mailbox — i.e. the daily check cannot be unattended unless the monitor also reads that mailbox (which then holds the 2FA codes as well). Plus DOM drift on a Next.js app, session expiry, and the possibility of bot-detection that I did **not** verify is present or absent.
- **ToS: BREACH** — §17.1 and §17.2 directly.
- **Net:** technically possible, unattended-operation-hostile, and the highest-risk option for the very account being protected.

### 3.2 Session-cookie / token replay (human captures the cookie once; monitor GETs the internal API daily)
- **Credential/2FA:** a logged-in session cookie / bearer `[REDACTED]` captured manually; 2FA is needed only at the human capture step, until the token expires.
- **Fragility: HIGH.** Token lifetime is **NOT VERIFIED**. Endpoint stability is **NOT VERIFIED** — the namespace is `robots.txt`-disallowed and every unauthenticated probe returned 404, so I could not even confirm that a JSON balance resource exists at a guessable path. A fragile endpoint plus a stale token on a rewards platform with anti-fraud review is a poor foundation.
- **ToS: BREACH** — same §17 clauses; automation is prohibited regardless of whether the human or the script performed the login.

### 3.3 Email / notification parsing
- **What is verified:** Freecash sends service email that cannot be opted out (§15.2 above); email is the 2FA channel (2FA article above); support-ticket confirmations are emailed (`…/support/offer/issues/create-cashback-support-ticket`); cashouts are delivered through the payment provider Tremendous and referenced by email (`…/support/withdrawal/issues/wrong-cashout-email-address`, both search-surfaced 2026-09-20).
- **What is NOT verified:** that Freecash sends an email on **every** offer credit / balance change. No help-centre page states this, and the sitemap contains no notification-preferences page (checked, §1.1). Without that, email parsing cannot satisfy "notify on earnings change" — it can only confirm withdrawals.
- **Credential/2FA:** IMAP/SMTP host + username + app password `[REDACTED]` for the mailbox that receives Freecash mail. **None exists on this machine** (§5.3).
- **Fragility: MEDIUM** (independent of the site's DOM, but coupled to whatever Freecash chooses to email).
- **ToS: no violation identified** — reading your own mailbox is not accessing the Website. Caveat: that mailbox also carries the account's 2FA codes, so a monitor with mailbox access inherits login capability.

### 3.4 Manual read + operator-typed snapshot (human-in-the-loop)
- **Credential/2FA:** the operator's own login; nothing new, nothing stored.
- **Where the numbers live (live sources):** balance in the *"green box in the top-right corner"* (`https://freecash.com/academy/en/insider/how-to-start-with-freecash`); pending items under **"Earnings in Progress"** on the profile page, crediting can take up to 48 h and partner tickets up to 35 days (`https://freecash.com/academy/en/support/offer/tracking/resolving-uncredited-offers`, updated Aug 19, 2026); withdrawal status under **Cashout > My Withdrawals** (`https://freecash.com/academy/en/support/withdrawal/issues/why-withdrawal-pending`, updated Jul 21, 2026).
- **Fragility: ZERO technically**, but needs one human action per day. This maps 1:1 onto the four fields the repo already models (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`).
- **ToS: clean** as personal use of one's own account (interpretation, §2).
- **Verdict: this is the only read-only path that is both ToS-compliant and verifiable today.**

### 3.5 Third-party "Freecash API" (parse.bot) — not a substitute
`https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api` (fetched 2026-09-20) sells 6 endpoints (withdrawals, leaderboard, stats, featured offers, offer categories, cashout methods) on `X-API-Key` auth. Its own page states: *"This isn't an official freecash.io API — it's an independent, maintained REST wrapper over public data"* and, in its FAQ, *"Freecash does not publish a documented public developer API."* Its stated source (`freecash.io`) is a parked domain for sale (§1.1). It returns **aggregate public data only** — no account balance, no account status. **It cannot answer the monitor's question**, and it fails on the same §17.2 automation clause if its scraping is attributed to the user (**interpretation**).

---

## 4. HG.Cash and Cashfree Payouts — relevance check (item 3). Do not assume.

### 4.1 HG.Cash — real API, wrong business
- **Documented, verified live** (`https://docs.hg.cash/llms.txt` and the API pages, fetched 2026-09-20):
  - `GET /accounts` — *"Returns the authenticated user's accounts, including ledger balance, pending fees, net available balance (balance minus pending fees), and account status."* (`https://docs.hg.cash/api-reference/accounts/get-user-accounts.md`)
  - `GET /account/{id}/balance` — *"Returns the balance, pending fees, net available balance, currency, and account status for the authenticated user's account by ID."* (`https://docs.hg.cash/api-reference/accounts/get-account-balance.md`)
  - Servers: `https://hg.cash/api/v1` (production), `http://dev.hg.cash/api/v1` (dev). Auth: `Authorization: Bearer cash_<token>`, *"Generate your API token in the account settings page"*, spec licensed MIT.
- **Live probes:** `GET https://hg.cash/api/v1/accounts` → **401**; `GET https://hg.cash/api/v1/account/1/balance` → **401**. The paths are real and auth-gated as documented.
- **Access gate, verified live** (`https://docs.hg.cash/introduction.md`): *"HG.cash does **not** automatically grant dashboard access to every signup. Platform access requires a registered user record… after HG.cash has engaged with you and completed required **compliance checks**, typically including **KYC**."* Step 1 is a website contact form (name, email, industry, message, reCAPTCHA).
- **What it is:** `https://www.hg.cash/en` (fetched 2026-09-20) — *"Payment infrastructure for iGaming operators in LATAM"*, contact `comercial@hg.cash`. Rails are ARS/CLP/BRL/BOB.
- **Relevance: NONE demonstrated.** There is no consumer rewards balance, no "pending earnings awaiting offer validation", and no evidence anywhere in the repo or on the live site that this operator holds an HG.Cash account. Its `pendingFees` field means accrued-to-be-collected *fees*, not pending reward credit — the semantics do not transfer.
- **Rate limits NOT VERIFIED**; **ToS text NOT VERIFIED** (the docs index contains no ToS page — a positive absence at the documentation root only, not proof that no ToS exists).

### 4.2 Cashfree Payouts — real API, wrong business
- **Documented, verified live:**
  - `GET /payout/v1/getBalance` → `{"status":"SUCCESS","subCode":"200","message":"Ledger balance for the account","data":{"balance":"214735.50","availableBalance":"173980.50"}}` (sample from `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`, fetched 2026-09-20).
  - `GET /payout/v1.2/getBalance` — *"Use this API to get the ledger balance and available balance of your account. Available balance is ledger balance minus the sum of all pending transfers."* Servers `https://payout-api.cashfree.com` (prod) / `https://payout-gamma.cashfree.com` (sandbox); `Authorization` (bearer) header **required**; optional `paymentInstrumentId` query param (`https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance-v12`).
  - Token issuance: `POST /payout/v1/authorize` with `X-Client-Id` / `X-Client-Secret`, optional RSA `X-Cf-Signature` built from a downloadable public key when the caller has no static IP (`https://www.cashfree.com/docs/api-reference/payouts/v1/authorize`). Note this is a **POST** that does not move money, but it does mint payout-API sessions.
- **Live probes:** unauthenticated `GET /payout/v1/getBalance` and `/payout/v1.2/getBalance` → **403** (nginx HTML `403 Forbidden`) — auth-gated as documented.
- **What it is:** `https://www.cashfree.com/docs/llms.txt` (fetched 2026-09-20) — Payouts is for *"instant, programmable transfers to Indian bank accounts, UPI IDs, cards, and wallets"*, with a merchant dashboard, fund sources, and India-centric 2FA on new-device logins (`https://www.cashfree.com/docs/help/account/account-management-faqs`).
- **Relevance: NONE demonstrated.** It is a merchant disbursement rail, not a rewards balance. No credential exists in the repo and no evidence links it to this account.
- **Rate limits: NOT VERIFIED for Payouts.** The published rate-limit page (`https://www.cashfree.com/docs/api-reference/rate-limits`, fetched 2026-09-20) links only *Payment API* and *SecureID API* limit tables; the generic mechanism is documented (`X-RateLimit-*` headers, 429 on exceed).

### 4.3 Why the repo's own skill says otherwise
`~/AppData/Local/hermes/skills/optional-skills/serverops/automated-status-monitor/references/api-compliance.md` (read 2026-09-20) lists *"FreeCash.io | `GET /withdrawals` | username, coins, withdrawType, date, country, total_earnings | ✅ Public read-only"* and states *"FreeCash.io Platform | Uses `X-API-Key` header instead of Bearer tokens"*. That is **parse.bot's** scheme against **freecash.io**, the parked domain — not a Freecash contract, and it carries no account data. The same skill's `HG.Cash` row (`GET /accounts`) and `Cashfree` row (`GET /payout/v1.2/getBalance`) do match the vendors' live docs; its HG.Cash notes (*"Tokens expire after defined lease time"*, `Operativa`/`Bloqueada` status strings) are **NOT VERIFIED** — I did not find those strings on the live pages I fetched. The skill also cites `server/scripts/verify-freecash-rules.mjs` as shipped; that file does not exist (see the repo's own regression-testing reference), so its 4/4 PASSED result verifies nothing.

---

## 5. Notification channels available on this machine (item 4)

| Channel | Verified how (2026-09-20) | Credential it needs | Caveats |
|---|---|---|---|
| **Windows local balloon notification** (the repo's `notify.py` `_toast_send` shape: PowerShell + `System.Windows.Forms.NotifyIcon`) | **VERIFIED WORKING.** Ran the same PowerShell script (`-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`) from git-bash: exit 0, stdout `TOAST_SENT_OK`. | **None.** | Needs an interactive desktop session. Whether it renders when launched from a Task Scheduler job ("run whether user is logged on or not") or any non-interactive/service context is **NOT VERIFIED**; the process exiting 0 is not proof the balloon was displayed (I could not view the screen). BurntToast module is **not installed** (`Get-Module -ListAvailable BurntToast` → nothing), so the module-free NotifyIcon approach is the one that works here. |
| **Webhook (ntfy)** | **VERIFIED REACHABLE, no credential.** `GET https://ntfy.sh/` → 200. `curl -d "…" https://ntfy.sh/<topic>` → `{"id":"DpEttGeFvfFF","time":…,"event":"message","topic":"…"}` (test payload contained only a UTC timestamp — no account data). curl 8.21.0 present. | **None for a public topic** (the topic name is the only secret). Private/self-hosted topic → ntfy access token `[REDACTED]`. | A public topic is readable by anyone who guesses the name → never put balance figures, account ids or email in the payload; send "status changed, open the dashboard" only. Adds a third-party egress destination. |
| **Email (SMTP/IMAP)** | Partially verified: Python 3.11.9 stdlib `smtplib`/`imaplib` import fine; **himalaya is NOT installed** (`command -v himalaya` → empty, no `~/.config/himalaya`); no SMTP/IMAP/MAIL/EMAIL env var exists in the process environment; the repo `.env` contains only `JARVIS_SUPERVISOR_V2`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK_MODEL`, `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL`, `GATEWAY_PROVIDER_ORDER` (names only, values never read). | SMTP host + port + username + **app password `[REDACTED]`** (or an IMAP app password for the read side). | Requires provisioning a brand-new credential, and it would live in the same mailbox that receives Freecash 2FA codes. Not usable today. |
| **`hermes send` (messaging platform)** | **Not usable today.** `hermes send --list` → *"Telegram: (no channels discovered yet)"*; `config.yaml` `platforms:` block enables `api_server` only (127.0.0.1:8642). | Telegram bot token + chat id `[REDACTED]` if that route is chosen. | Adding a platform means editing Hermes config, which is outside this task's write scope. |
| **Scheduler** | `~/AppData/Local/hermes/cron/` exists with a live ticker (`ticker_heartbeat`), but **no Freecash job is registered**. `schtasks /query /TN "FreeCash-Daily-Monitor"` → *"the system cannot find the file"* (German locale message), i.e. the Windows task named in the repo's docs is not installed. | None. | Once-a-day enforcement therefore has to come from the job/marker the new design installs, not from anything already running. |

**Ranking for a daily "earnings changed" alert (no external action, fewest new secrets):**
1. **Local Windows balloon + append-only `alerts/alerts.jsonl`** — zero credentials, zero egress, already the repo's design; sufficient for a change alert that a human reads on the same desktop.
2. **ntfy secret topic** — only if the alert must reach a phone or a logged-out machine; send a payload-free "changed, go look" message.
3. **Email** — last, because it needs a new credential and shares a mailbox with 2FA codes.

---

## 6. Explicit NOT VERIFIED list

1. Existence/behaviour of any authenticated internal endpoint that returns the account balance (`/fc-api/...`).
2. Whether Freecash emails on every offer credit or balance change (no help-centre page found; sitemap has no notification-settings page).
3. Freecash session/token lifetime, and whether Freecash deploys bot detection beyond its email-2FA/new-device challenge.
4. Actual displayed rendering of the Windows balloon (script exit 0 observed; screen not observed).
5. HG.Cash rate limits, and HG.Cash ToS text (no ToS page in its docs index — absence of evidence, not evidence of absence).
6. Cashfree **Payouts** getBalance rate limits (published tables cover Payments and SecureID only).
7. Whether any HG.Cash or Cashfree account, or any Freecash API credential, exists — no credential is provisioned anywhere in this repo or environment.
8. The `Operativa`/`Bloqueada` HG.Cash status strings and "token lease time" cited by the repo's `automated-status-monitor` skill.
9. Whether a third-party scraper's ToS breach would be attributed to this operator (legal question; only the §17 text is verified).

---

## 7. Appendix — re-runnable probes

```bash
# Freecash: no public API, and slug "api" is a marketing page
curl -sS -o /dev/null -w '%{http_code}\n' https://freecash.com/robots.txt
curl -sS https://freecash.com/robots.txt
curl -sSL https://freecash.com/api      | grep -o '<title>[^<]*</title>'
curl -sS  -o /dev/null -w '%{http_code}\n' https://freecash.com/api/docs      # 404
curl -sS  https://freecash.com/fc-api/v1/status                              # 404 JSON (internal svc)
curl -sS  -o /dev/null -w '%{http_code}\n' https://api.freecash.com/v1/status # 404 (host serves nothing)
curl -sS  https://freecash.io/llms.txt                                        # domain for sale

# HG.Cash: real paths, auth-gated, KYC onboarding
curl -sS -o /dev/null -w '%{http_code}\n' https://hg.cash/api/v1/accounts     # 401
curl -sS https://docs.hg.cash/llms.txt
curl -sS https://docs.hg.cash/introduction.md

# Cashfree Payouts: auth-gated balance read
curl -sS -o /dev/null -w '%{http_code}\n' https://payout-api.cashfree.com/payout/v1.2/getBalance  # 403

# Local notification channel (no credential) — must run in an interactive desktop session
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <notifyicon-toast.ps1>

# Webhook channel (no credential for a public topic)
curl -sS -d "probe $(date -u +%FT%TZ)" https://ntfy.sh/<secret-topic-name>

# Where the numbers actually are (human, once a day)
#   balance  -> top-right green box on freecash.com
#   pending  -> profile page, "Earnings in Progress"
#   payouts  -> Cashout > My Withdrawals
```

### Source list (all fetched 2026-09-20)

- `https://freecash.com/robots.txt`
- `https://freecash.com/sitemap.xml` (+ `/api/sitemap/1..5/sitemap.xml`)
- `https://freecash.com/en/policies/terms` (Last Updated July 17, 2026)
- `https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned` (updated Nov 13, 2025)
- `https://freecash.com/academy/en/support/account/profile/how-enable-2fa` (updated Aug 19, 2026)
- `https://freecash.com/academy/en/support/offer/tracking/resolving-uncredited-offers` (updated Aug 19, 2026)
- `https://freecash.com/academy/en/support/withdrawal/issues/why-withdrawal-pending` (updated Jul 21, 2026)
- `https://freecash.com/academy/en/insider/how-to-start-with-freecash`
- `https://freecash.com/academy/en/discover/partner/become-a-partner`
- `https://freecash.io/llms.txt`
- `https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api`
- `https://docs.hg.cash/llms.txt`, `https://docs.hg.cash/introduction.md`, `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md`, `https://docs.hg.cash/api-reference/accounts/get-account-balance.md`, `https://www.hg.cash/en`
- `https://www.cashfree.com/docs/llms.txt`, `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`, `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance-v12`, `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize`, `https://www.cashfree.com/docs/api-reference/rate-limits`, `https://www.cashfree.com/docs/help/account/account-management-faqs`
- Local (read-only): `D:/AgenticOS/monitoring/freecash/notify.py`, `D:/AgenticOS/.env` (key names only), `~/AppData/Local/hermes/config.yaml` (platform keys only), `~/AppData/Local/hermes/skills/optional-skills/serverops/automated-status-monitor/references/api-compliance.md`

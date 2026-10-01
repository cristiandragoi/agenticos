# Free Cash Finance Automation - Daily Monitor: Research Plan

Status: research only. No endpoint was called, no account was created, no credential was used or
collected, and no secret value appears in this document.

Scope: establish (a) which provider APIs are reachable read-only, (b) the read/write boundary,
(c) the scraping fallback posture, (d) the earnings-signal fields available for notify-on-change,
and (e) the unknowns that only the operator or a live credential can resolve.

Two rules govern every recommendation below:

- The monitor is READ-ONLY. It may GET status. It may never move money or create an obligation.
- One check per operator-local calendar day. Nothing here requires polling.

Confidence legend used throughout: VERIFIED = the vendor's own documentation was retrieved and is
quoted below. INFERRED = follows from verified docs but not stated outright. UNKNOWN = not
established by any retrieved source.

---

## 0. Repo inspection: which provider is ACTUALLY targeted

Read-only inspection of D:\AgenticOS. No file was modified.

| Evidence | Location | What it shows |
| --- | --- | --- |
| `STATUS_API_URL: process.env.FREECASH_STATUS_API \|\| 'https://api.freecash.com/v1/status'` | `server/scripts/freecash-daily-monitor.mjs:32` | The only provider hostname hardcoded in executable code. `api.freecash.com` is the **freecash.com** (Almedia) family, not HG.Cash or Cashfree. |
| Zero occurrences of `hg.cash` or `cashfree` in any `.py`/`.mjs`/`.ts`/`.js` file (excluding node_modules, backups, dist) | repo-wide grep | HG.Cash and Cashfree appear **only in prose/docs and a cached docs index** - no code path calls either. |
| `hg_llms.txt` at repo root = HG.Cash documentation index (`docs.hg.cash/llms.txt`) | `D:\AgenticOS\hg_llms.txt` | Someone in this repo previously fetched HG.Cash's doc index. HG.Cash was *considered*, never wired in. |
| `ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})`, `DEFAULT_BASE_URL = "http://localhost:3001"` | `monitoring/freecash/readonly_client.py:41,54` | The implemented routine is **physically incapable** of reaching any provider host. Egress is pinned to loopback. |
| `DEFAULT_SOURCE = "operator_state"`, `SOURCES = ("operator_state", "metrics_http")` | `monitoring/freecash/run_daily_check.py:52-53` | Neither source is a provider. One is a human-typed file, one is AgenticOS's own metrics endpoint. |
| `TEMPLATE_RECORD` fields: `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency` | `monitoring/freecash/operator_state.py:48-56` | The shape of a freecash.com-style rewards account (status / total earnings / balance / pending), consistent with a GPT rewards dashboard. |
| No provider key names in `.env` | `D:\AgenticOS\.env` (names only inspected) | No `FREECASH_*`, `HG_CASH_*`, `CASHFREE_*`, or `PAYOUT_*` variable exists. No provider credential is currently provisioned anywhere in this repo. |
| Crontab points at `/path/to/AgenticOS/scripts/make_freecash_check.py` | `config/freecash-crontab` | Placeholder path - the schedule was never installed. `scripts/make_freecash_check.py` exists. |
| `"endpoint": "/accounts/status"` with `"wallet_address_hash": "sha256_mocksomedaddress0x..."` | `finance-monitor/src/api_client.py:52` | **Sandbox mock.** This is a different, unrelated project producing fake data. Not a provider integration. |
| `POST /withdraw`, `/survey/complete<id>` asserted with no doc URL | `docs/freecash-monitoring.md:92` | Invented endpoints. No vendor documentation retrieved supports them. |

**Conclusion.** The repo's *intent* is **freecash.com (Almedia GmbH)** - the consumer rewards
platform whose dashboard shows balance, pending, earnings and cashouts. Its *implementation* never
reached any provider: it reads a file the operator types, or AgenticOS's own local metrics, and
marks every snapshot `degraded: true`. The single hardcoded provider URL
(`api.freecash.com/v1/status`) is repo-recorded as HTTP 404 and I did not re-probe it (no endpoint
calls permitted in this research task).

This makes the research **load-bearing in one specific way**: the provider the repo aims at
(freecash.com) is the one that forbids automated access outright, and the two providers that *do*
publish documented read-only APIs (HG.Cash, Cashfree Payouts) have no evidence of an account.

---

## 1. Provider capability matrix

| Provider | Documented API? | Read endpoints | Write / money-moving endpoints | Auth | Source URL retrieved | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| **freecash.com** (Almedia GmbH) - consumer rewards platform. **The repo's actual target.** | **NO.** No public or partner API documented anywhere I could retrieve. `robots.txt` disallows `/fc-api/`, `/user/`, `/myprofile/`, `/dev-playground/`. | **None.** Dashboard only. A human reads the dashboard. | n/a (no API). Dashboard actions: cashout/redemption, offer completion, KYC. | n/a. Dashboard login + KYC/ID verification, 2FA expected. | `https://freecash.com/robots.txt`; `https://freecash.com/en/policies/terms`; `https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned` | **VERIFIED** (no API + automation prohibited). |
| **freecash.io** | **NO - not a platform at all.** | None. | None. | n/a. | `https://freecash.io/llms.txt` | **VERIFIED**: "freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket." |
| **HG.Cash** | **YES - documented public REST API.** | `GET /accounts`; `GET /account/{id}/balance`; `GET /transaction/{id}/status`; `GET /transaction/{id}/receipt`; `GET /transaction/{id}/transactionId`; `GET /checkouts`; `GET /checkouts/{id}`; `GET /checkouts/{id}/receipt`; `GET /claims/{id}`; `GET /countries/chile/payment-methods`; `GET /bolivia/banks`; `GET` reference data (statuses, types); CVU/alias lookup. | `POST /transactions` (**cash out**); `POST /checkouts`; cancel pending checkout; `POST` inbound/outbound transactions for Brazil, Chile, Bolivia; `POST /claims`; USDT withdrawal + withdrawal-wallet verify/sign. | **Bearer token**, format `cash_<64-char-hex>`, generated **self-serve in account settings**. Base `https://hg.cash/api/v1` (prod), `http://dev.hg.cash/api/v1` (dev). Webhooks are signed **HMAC-SHA256** via `X-HG-Webhook-Signature: sha256=<hex>` (inbound to us, out of scope here). | `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md`; `.../get-account-balance.md`; `.../transactions/create-transaction-request-cash-out.md`; `https://docs.hg.cash/introduction.md`; `https://docs.hg.cash/developers/receiving-webhooks.md`; `https://docs.hg.cash/api-reference/checkouts/list-checkouts.md`; `https://docs.hg.cash/countries/argentina/bank-transfers.md` | **VERIFIED** for endpoints, method and auth scheme. Onboarding is **KYC-gated** (contact form -> KYC -> provisioning), so "self-serve token" means self-serve *inside an account you already have*. Account-`status` enum values: **UNKNOWN** (see U4). Rate limits: **UNKNOWN**. |
| **Cashfree Payouts** | **YES - documented public REST API.** | `GET /payout/v1/getBalance` -> `data.balance` (ledger), `data.availableBalance`; `GET /payout/v1.2/getBalance` -> ledger + available balance (ledger minus sum of all pending transfers), optional `paymentInstrumentId` query param. | `POST /payout/v1/authorize` (**token issuance only - not money**); `POST` request/direct/standard/batch transfers; Cashgram create/redeem; OneEscrow allocate funds / initiate payout / internal fund transfer / whitelist bank account; beneficiary add. | **Bearer**, obtained from `POST /payout/v1/authorize` with headers `X-Client-Id` + `X-Client-Secret`; plus **`X-Cf-Signature`** (RSA-encrypted `clientId.<unix-ts>` with a dashboard-generated public key) when the calling IP is not whitelisted. Base `https://payout-api.cashfree.com` (prod), `https://payout-gamma.cashfree.com` (sandbox). 2FA = IP whitelisting + public key. | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`; `.../get-balance-v12`; `.../authorize`; `https://www.cashfree.com/docs/llms.txt` | **VERIFIED** for endpoints, method and auth. **Access is gated**: an unentitled account gets HTTP 403 `"APIs not enabled. Please fill out the Support Form"`. Requires an Indian merchant account. Token TTL: **UNKNOWN** (see U6). |

### Traps explicitly flagged

1. **`parse.bot` "Freecash API"** - a third-party marketplace listing advertises a "Freecash API"
   with `X-API-Key` auth, `get_withdrawals` returning `total_earnings`, and a `get_leaderboard`
   endpoint. It is self-described as "not an official freecash.io API - an independent, maintained
   REST wrapper over public data." It targets **freecash.io, which is a parked domain for sale**,
   and the `X-API-Key` belongs to parse.bot, not to any FreeCash entity. **Do not treat this as a
   provider API. Do not build against it.** Marketing copy is not a documented API.
2. **`POST /transactions` at HG.Cash is described as "This does not perform an on-chain/bank
   transfer."** That sentence is a *pipeline* description, not a safety guarantee: the endpoint
   creates a **transaction request** - an obligation that debits an account and drives an instant
   cash-out. It is DENY, with no ambiguity. Anyone reading only the summary line will misclassify it.
3. **`GET /transaction/{id}/receipt`** reads as a GET but the docs say the receipt "is generated
   and cached for subsequent requests." A GET with a server-side side effect. Ambiguous - excluded
   by default (we do not need receipts to satisfy any of the four rules).
4. **The Cashfree docs page embeds a sample Bearer token in its Dev Studio widget.** It is a public
   documentation artefact, not a credential. Never copy a token out of a docs page.
5. **`finance-monitor/src/api_client.py` produces mock balances** (`"sha256_mocksomedaddress0x..."`).
   Nothing that reads from it is measuring a real account.

---

## 2. Read/write boundary: allowlist and denylist

The rule of thumb: **HTTP method is the primary gate, path is the secondary gate, and verb
vocabulary is the audit.** Any single one of the three firing is enough to deny.

### 2.1 ALLOWLIST (safe reads - the complete set this monitor may ever call)

| Verb | Host | Path | Why it is safe | Provider |
| --- | --- | --- | --- | --- |
| GET | `hg.cash` | `/api/v1/accounts` | Returns the authenticated user's accounts with per-account balance, pending fees, net available balance, currency and status. Read-only by construction. | HG.Cash |
| GET | `hg.cash` | `/api/v1/account/{id}/balance` | Balance, `pendingFees`, `netBalance`, `currency`, `status` for one account. | HG.Cash |
| GET | `payout-api.cashfree.com` | `/payout/v1/getBalance` | Ledger + available balance. | Cashfree |
| GET | `payout-api.cashfree.com` | `/payout/v1.2/getBalance` | Ledger + available balance with pending transfers subtracted. | Cashfree |
| GET | `hg.cash` | `/api/v1/transaction/{id}/status` | Status of a transaction request the operator already created. **Optional** - include only if settlement tracking is wanted. | HG.Cash |
| HEAD | any allowed host | any allowed path | Liveness probe only. No body, no state. | both |
| (local) | `localhost` | `GET /api/v1/status/metrics`, `HEAD /api/v1/status` | AgenticOS's own endpoint. Not a provider read; produces `degraded: true`. | internal |

That is the whole allowlist - **four provider GETs, one optional, plus a HEAD probe.** Anything not
on this list is denied by default.

### 2.2 DENYLIST (never callable by the monitor)

| Class | Members | Reason |
| --- | --- | --- |
| Every non-GET/HEAD method | `POST`, `PUT`, `PATCH`, `DELETE` on any host | Fail-closed. No exception for "just a token" (see AMB-1). |
| HG.Cash money paths | `POST /api/v1/transactions`; all `POST` inbound/outbound for Brazil, Chile, Bolivia; `POST /api/v1/checkouts`; `POST` cancel-checkout; `POST /api/v1/claims`; USDT withdrawals; withdrawal-wallet verify/sign | Moves money or creates an obligation. |
| Cashfree money paths | request/direct/standard/batch transfer; Cashgram create/redeem; OneEscrow allocate / initiate payout / internal transfer / whitelist bank account; beneficiary add | Moves money. |
| Earning vocabulary (any provider) | `claim`, `withdraw`, `withdrawal`, `cashout`, `cash_out`, `redeem`, `payout`, `pay_out`, `transfer`, `wager`, `bet`, `spin`, `deposit`, `purchase`, `checkout` | Reward-earning or money-out action. |
| Earning action compounds | `submit_offer`, `complete_survey`, `complete_task`, `start_task`, `accept_offer`, `claim_reward`, `redeem_reward`, `request_payout` | Changes earnings state. |
| Account mutation | `update_balance`, `set_balance`, `credit_account`, `debit_account` | Direct state mutation. |
| freecash.com, in every form | any request, any method; every browser-automation or scrape path | Prohibited by the provider's terms (section 3). |
| Non-allowlisted hosts | anything not in the allowlist | `ALLOWED_HOSTS` stays an explicit, enumerated set. |

This denylist is already mechanised in the repo: `monitoring/freecash/verify_readonly.py` implements
exactly the six forbidden token classes above as a static CI check (exit 1 on any unexempted
hit, exit 2 if a scan target is missing), and `monitoring/freecash/readonly_client.py` enforces the
verb gate and `ALLOWED_HOSTS` at runtime. **The research confirms the existing denylist is correct
and, if anything, under-specified in one place: the allowlist must enumerate provider paths too, not
just hosts** - host-pinning alone would permit a `GET` to a money path.

### 2.3 AMBIGUOUS classifications

**AMB-1. `POST /payout/v1/authorize` (Cashfree) - a POST that does not move money.**
It only exchanges `X-Client-Id`/`X-Client-Secret` for a Bearer token. Classified **DENY** under the
monitor's rules, because the monitor must not carry a client secret that can mint payout-API
sessions. What would settle it: evidence that a Cashfree Bearer token is long-lived enough that the
operator can mint it once manually and the monitor can run read-only on the pre-minted token. If -
and only if - that holds, `POST /authorize` stays out of the monitor entirely and the operator mints
out-of-band. If it does not hold, Cashfree is unusable for automation and HG.Cash is the only option.

**AMB-2. `GET /transaction/{id}/receipt` (HG.Cash) - a GET that writes a cache server-side.**
Classified **DENY**. It is not needed for any of the four rules. What would settle it: a statement
from HG.Cash that repeated receipt GETs do not alter transaction or ledger state. Not worth the
support ticket.

**AMB-3. `POST /transactions` (HG.Cash) - the misleading docstring.**
Not actually ambiguous; listed here because it reads that way. The docs' own framing ("does not
perform an on-chain/bank transfer") invites a wrong "so it's safe" inference. It creates a
transaction request. **DENY.** No further evidence needed.

**AMB-4. `HEAD /api/v1/status` (internal) - a HEAD with server-side meaning.**
Harmless (liveness only), but a HEAD is not a GET and should be justified rather than assumed. Kept
in the allowlist because it is loopback-only and carries no provider state.

---

## 3. Scraping-only fallback posture

### 3.1 freecash.com - DO NOT SCRAPE. The terms name monitoring explicitly.

The verbatim clause (retrieved from `https://freecash.com/en/policies/terms`, last updated
2026-07-17), section 17.2:

> "Use any robot, spider or other automatic device, process or means to access the Website for any
> purpose, **including monitoring** or copying any of the material on the Website."

Section 17.1 additionally prohibits:

> "To use macros, bots, scripts, or any other automation tools designed to simulate or replicate
> human user activity..."

Section 16.1 and 16.3 restrict use to "personal, non-commercial use only" and state "You must not
access or use for any commercial purposes any part of the Website". The official help article
" How Can I Avoid a Ban?" repeats it plainly:

> "Do not use any automatic device like a robot or spider to access the site."
> "Freecash is for personal and non-commercial purposes only."

Reinforcing controls: `robots.txt` disallows `/user/`, `/myprofile/`, `/fc-api/`, `/dev-playground/`.
Account structure is one account per person and per household. Rights reserved to hold offer credits
up to 90 days, to suspend or close accounts, and to forfeit rewards; section 19 governs termination.

**Assessment of an authenticated read-only scrape:** negative expected value, and it is a
*compliance* failure before it is a *technical* one. The prohibited act is the automatic access
itself, not the mutation - so "it's only a GET of my own balance" is not a defence. The downside is
account closure and forfeiture of the balance the monitor exists to watch, which destroys the
asset being monitored.

The one legitimate door is written consent: section 17.2's second bullet prohibits even a "manual
process to monitor or copy" *"without our prior written consent"*. Written consent is therefore a
real if unlikely path, and it is a business decision, not an engineering task.

**Reliability posture, for completeness (all UNKNOWN, and all reasons the scrape would rot):**
session cookie and CSRF token expiry; Cloudflare bot management on the site and on the API host;
2FA/KYC on the account (identity verification is required before the first payout, per section 9,
and involves a live document + selfie check); no published rate limits; and the account may be
behind a VPN, which section 17.2 also prohibits. Under rule 4 (human approval before any external
action), a human-in-the-loop login would mean the operator logs in and the *operator's* session is
driven by automation - which is exactly what 17.2 forbids.

### 3.2 Minimum-risk option that satisfies all four rules TODAY

**Operator-mediated manual read.** The operator logs into the provider dashboard themselves, in
their own browser, and records the day's figures into
`<data root>/state/operator-state.json` - the mechanism already implemented in
`monitoring/freecash/operator_state.py`.

- **R1 (one check per day):** satisfied - the operator's single login *is* the check, and the day
  lock (`state/day-locks/<YYYY-MM-DD>.lock`, exclusive-create) guarantees the routine itself
  consumes the day at most once.
- **R2 (zero earning actions):** satisfied structurally - no credential, no socket, no provider API
  client exists on this path.
- **R3 (notify on change):** works on `balance_cents`, `pending_cents`, `earnings_total_cents`,
  `account_status`, deduped by day key.
- **R4 (human approval):** satisfied trivially - the human is the read path, so there is no external
  action to approve.

Its known cost: every snapshot is `degraded: true`, so a "no change" report is **not
provider-verified** and can never be presented as such. That labelling already exists in the code
and must be preserved.

**The only path to automated, provider-verified visibility is a documented provider API (HG.Cash)
backed by an account the operator actually holds.** There is no third option.

---

## 4. Earnings-signal field map (for the notify-on-change rule)

| Provider | Fields reliably available | "A change" vs "a settlement" | Stable identifiers for dedup | Confidence |
| --- | --- | --- | --- | --- |
| **HG.Cash** | Per account: `id`, `name`, `balance` (ledger, rounded 2dp), `pendingFees` (accrued but not yet collected), `netBalance` (= balance minus pending fees, the available figure), `currency`, `status`. Plus `company` when the account belongs to one. | **A change** = a movement of `balance` / `netBalance`. HG.Cash signals it with the **Account movement** webhook (`topic` TRANSACTION, movement in or out) and with the **Transaction request status updated** webhook (`topic` TRANSACTION_REQUEST, `eventType` status_change). **A settlement** = a cash-out progressing PENDING -> PROCESSING -> DONE, and the moment the request is linked to its bank movement, which arrives as `eventType` `transaction_associated` with a `transactionId`. Note the docs warn you may receive **no** webhook while a request is merely PENDING, and to integrate defensively against ordering and duplicates. For a once-daily pull, `netBalance` is the single best change signal, because it is the figure net of pending fees. | `account.id` (UUID); transaction-request `id` (UUID); `transactionId` (UUID) once associated. Day key `YYYY-MM-DD` in operator-local time. | **VERIFIED** for fields and webhook semantics. Account-`status` enum values **UNKNOWN**. |
| **Cashfree Payouts** | `data.balance` (ledger) and `data.availableBalance`. Per the v1.2 docs, available balance is ledger balance minus the sum of all pending transfers (those triggered and processing or pending). v1.2 accepts an optional `paymentInstrumentId` query param to select the fund source. | **A change** = a movement of `balance`. **A settlement** = a pending transfer clearing; this is visible as `availableBalance` converging on `balance`. The transfer states themselves (initiation -> success/failure/reversal) are documented on the *dashboard* lifecycle and webhook pages, **not** in a per-day status endpoint I retrieved. | Fund source / `paymentInstrumentId` + day key. The response field naming the instrument was **not** visible in the retrieved schema - treat as UNKNOWN. | **VERIFIED** for the two balance fields and their meaning. Identifier naming and per-transfer status API: **UNKNOWN**. |
| **freecash.com** | Dashboard only. The fields a human can read are exactly the four the repo already models: **account status, total earnings, current balance, pending amount** (plus currency). Confirmed as reasonable by the ToS vocabulary: Rewards/coins are credited on offer completion and are "deemed successfully completed" only once validated by Almedia or a third-party affiliate; credits may be held up to 90 days (section 8.5). | **A change** = any movement in total earnings, current balance, or pending amount. **A settlement** = a redemption/cashout reaching a final state; section 8 states redemptions are final and irreversible once delivered, and that redemptions are subject to KYC before the first payout. There is no API to observe transitions - only the operator's snapshot. | No provider-issued identifier is available to us. The day key `YYYY-MM-DD` plus the recorded figures is the dedup basis; the routine's existing `changedetect.dedupe_key` covers this. | **VERIFIED** that fields are dashboard-only. Field names themselves are **INFERRED** from the platform's ToS vocabulary and the repo's existing record shape. |

**Dedup guidance.** Across days, dedupe on `(provider, account_id, day_key)`. Within a day, dedupe
on `(day_key, change_kind, field, old_value -> new_value)`. Never dedupe on monetary value alone - a
return to a previous balance is a real event, not a duplicate.

---

## 5. Numbered unknowns and the cheapest resolving experiment

Each experiment is a single action by the operator. None requires engineering. I performed none of
them - they are listed as the next steps, not as results.

1. **Which provider does this entity actually hold an account with?** (freecash.com, HG.Cash,
   Cashfree, some combination, or none.) This is the load-bearing unknown - it decides which half of
   this research matters.
   *Cheapest experiment:* ask the operator one question - "which of these three sends you payout
   emails / has a dashboard you can log into?" 2 minutes. Everything else is blocked on this.
2. **Is the monitored account a freecash.com (rewards/surveys) account?** The repo's vocabulary
   (surveys, balance, cashout, `docs/freecash-monitoring.md`) says yes; no account evidence exists.
   *Cheapest experiment:* have the operator open their dashboard and read back the four labels. If
   they say "coins", "offers", "surveys" -> freecash.com, and section 3 applies.
3. **Does an HG.Cash account exist at all, and is it provisioned?** HG.Cash does not auto-grant
   dashboard access; access requires a contact form, KYC, then provisioning. A logged-in user with
   no user record sees "Acceso denegado".
   *Cheapest experiment:* operator attempts to log in at hg.cash. Success vs "Acceso denegado"
   resolves it in one step.
4. **What are HG.Cash's actual account `status` values?** Repo prose asserts `Operativa` /
   `Bloqueada` / `Cerrada`; my retrieved schema exposes a `status` field but **not** its enum values.
   Do not write a status map against unverified strings.
   *Cheapest experiment:* the same authenticated `GET /accounts` from U5 below returns the live
   value. Zero extra cost if U5 is run.
5. **Does a usable HG.Cash API token exist, and does the read work?**
   *Cheapest experiment:* operator generates a token in account settings (self-serve, no partner
   approval), then runs **once**, out-of-band, not from the monitor:
   `curl -i -H "Authorization: Bearer $TOKEN" https://hg.cash/api/v1/accounts`
   Expected 200 with the account list; expected 401 if the token is wrong. Allowed paths and the
   real `status` strings come back in the same response.
6. **How long does a Cashfree Bearer token live, i.e. would the monitor need `POST /authorize`
   daily?** This is exactly what decides AMB-1.
   *Cheapest experiment:* mint one token via the operator's dashboard, call `GET /payout/v1/getBalance`
   twice about 30 minutes apart, and observe whether the second returns subCode 403
   "Token is not valid".
7. **Is the Cashfree Payouts API entitled for this merchant?**
   *Cheapest experiment:* read the response of a single `GET /payout/v1/getBalance` with an
   operator-minted token. HTTP 403 `"APIs not enabled. Please fill out the Support Form"` means not
   entitled (a queue, not a task); 200 means entitled.
8. **Which host does the existing deployed monitor target, and what should happen to it?**
   *Cheapest experiment:* already answered by this inspection -
   `server/scripts/freecash-daily-monitor.mjs:32` targets `https://api.freecash.com/v1/status`.
   What remains is a **decision**, not a probe: delete the invented URL, or leave it disabled. Note
   the same file's URL->path parser yields `v1/status` without a leading slash, so the request line
   is malformed even if the host were live.
9. **Does the operator accept the manual (operator-state) path permanently, or is automated
   visibility a hard requirement?** If manual is acceptable, the build can proceed today with
   `degraded: true` and zero provider coupling.
   *Cheapest experiment:* one question. This is a decision, not a credential.
10. **HG.Cash rate limits.** No rate-limit page exists in the docs index. At one request per day we
    are far below any plausible limit, so this is a documentation gap, not a risk.
    *Cheapest experiment:* if a number is wanted, email `api-support@hg.cash` (address published in
    the OpenAPI contact block). Otherwise ignore.
11. **Payout minimums / thresholds per provider.** HG.Cash: an outbound request is rejected with
    `409 INSUFFICIENT_NET_BALANCE` when `amount + outboundFee` exceeds `netBalance`; the AR example
    shows a 1% outbound fee and a max of 990,000 ARS from a 1,000,000 ARS balance. A *minimum*
    payout amount is not published in what I retrieved. Cashfree: not retrieved. freecash.com:
    third-party reviews say $5-$20 depending on region, and the platform's own pages are quoted as
    giving two different numbers - **treat as unverified, do not encode a threshold**.
    *Cheapest experiment:* read the threshold off the operator's own withdrawal screen (one
    screenshot), rather than trusting a published or scraped number.
12. **Where would a provider credential live?** It must not be in the repo. The repo's `.env`
    currently holds **no** provider key.
    *Cheapest experiment:* confirm with the operator that a token goes into the Hermes `.env` (or an
    OS keyring), never a checked-in file. One question.

---

## 6. What I could not verify

Stated plainly so nothing here is mistaken for a measurement:

- **No provider endpoint was called.** By constraint, every endpoint claim above comes from the
  vendor's own published documentation, retrieved at the URLs cited. No credential was used, no
  account was created, and no live probe was performed.
- **`api.freecash.com/v1/status` -> HTTP 404** is **repo-recorded**, not re-verified by me (I did not
  probe it).
- **HG.Cash account `status` enum values** - not visible in the retrieved schema. Repo prose asserts
  Operativa/Bloqueada/Cerrada; that is another agent's claim, carried as repo text, not confirmed.
- **HG.Cash API token TTL**, dashboard-login 2FA behaviour, and **rate limits** - not published in
  the retrieved docs index.
- **Cashfree Bearer token TTL**, the response field naming the fund source, and the v1
  `requestTransfer` path (the crawl returned `CRAWL_NOT_FOUND`) - not verified.
- **Whether the entity holds any provider account at all** - the single most important unknown, and
  no document can answer it.
- **freecash.com**: whether written consent under section 17.2 is obtainable; the exact first-payout
  minimum (only third-party sources, which disagree with each other).
- **freecash.com API surface**: I could not find any official developer documentation. The absence
  is corroborated by `robots.txt` disallowing `/fc-api/` and `/dev-playground/`, and by the fact
  that the only "Freecash API" that surfaces in search is a third-party scraper wrapper aimed at a
  parked domain. Absence of documentation is stated as absence, not as proof that nothing exists
  behind authentication - but nothing usable is published, so nothing may be built against it.
- **`docs/freecash-monitoring.md`'s `POST /withdraw` and `/survey/complete<id>`** - asserted with no
  source URL, unsupported by anything I retrieved, and inconsistent with the platform's own terms.
  Treat as invented.

## 7. Recommendation in one paragraph

Keep the monitor exactly as it is - loopback-only, operator-state-fed, `degraded: true` - because it
is the only configuration that is compliant today. Add the four allowed provider GETs to the
allowlist *as dormant, disabled code* behind an explicit host+path check, so that the day the
operator confirms a provider account and a token exists, visibility becomes automatic without any
change to the write boundary. Do not build a scraper for freecash.com, do not trust the parse.bot
wrapper, and do not implement `POST /withdraw` or `/survey/complete`. Answer U1 first: until we know
which provider the account actually is, the rest of this research is preparation, not a plan.

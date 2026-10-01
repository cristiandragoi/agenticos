# PROVIDER-CONTRACT-RESEARCH-V2.md — Read-Only Status/Earnings Contract for "Free Cash Finance Automation"

**Repo:** `D:/AgenticOS` · **Branch:** `hermes-rescue-20260908` · **Date of this pass:** 2026-09-18 (Europe/Berlin)
**Supersedes nothing.** This is an additive V2 research artifact. It builds on `PROVIDER-API-RESEARCH.md` (2026-09-17) and `RESEARCH-PLAN.md` (2026-09-17) and does **not** modify either.
**Closes/refines:** the blocker recorded in `ROUTINE-DESIGN.md:190-191` as
`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`.

**Compliance statement for this research pass.** No login was performed. No account was created. No `POST`/`PUT`/`PATCH`/`DELETE` was sent to any provider. No claim/withdraw/payout/survey/offer action was performed or simulated. No credential was requested, read, or written. Every external fact below is either (a) a read-only `GET`/`HEAD` fetch of public documentation performed during this pass, (b) a command actually run on this host with its observed output, or (c) explicitly labelled `UNKNOWN`. Secret values are `[REDACTED]`; only env var **names** appear.

**Rule compatibility (R1–R4).** Nothing in this document creates, proposes, or implies a code path that performs an earning action, checks status more than once per day, suppresses operator notification, or executes anything without human approval. Every acquisition option in §6 is evaluated against all four rules and labelled read-only / non-read-only.

**Related artifact / naming note.** `delegation-manifest.json:43` names the W2 research output as `PROVIDER-FINDINGS-REVERIFIED.md`. This file is the required V2 output under a different filename. Treat this file as the W2 research deliverable and reconcile the manifest name in a later, separately-approved edit — **this pass did not touch that file.**

---

## 1. Which provider the repo actually targets — evidence, not assumption

### 1.1 Verdict

> **NO PROVIDER IS CONFIRMED AS CONFIGURED.**
>
> Zero provider credentials, zero provider hostnames, and zero provider endpoint paths appear in any executable configuration, environment file, or live code path in `D:/AgenticOS`.
>
> Three candidate names appear in the tree — **FreeCash.io**, **HG.Cash**, **Cashfree Payouts**. All three appear **only in documentation, design notes, and a stale Hermes skill**, never in configuration or runnable code. "FreeCash.io" additionally appears in a repo document (`INTEGRATION_STATUS.md`) carrying an **assertion that this pass confirms is false**.

### 1.2 The three candidates, classified by evidence class

| Candidate | Where it appears | Evidence class | Actually configured? |
|---|---|---|---|
| **FreeCash.io** | `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33`; Hermes skill `optional-skills/serverops/automated-status-monitor/references/api-compliance.md:12,64-65` | **Doc-only, and factually wrong.** The domain is a parked GoDaddy for-sale lander (§3.2). The `X-API-Key` scheme attributed to it is **parse.bot's** key, not a FreeCash key. | **No — and the name is not a live platform at all.** |
| **HG.Cash** | `INTEGRATION_STATUS.md:35-40`; `RESEARCH-PLAN.md:32`; `PROVIDER-API-RESEARCH.md:91-121`; `DELEGATION-WORKFLOW-PLAN.md:84`; `delegation-manifest.json:95` | **Doc-only.** No `HG_CASH*` / `HG_CASH_TOKEN` key in any `.env`. No `hg.cash` hostname in any code file. | **No.** Real API exists (§3.3); no account link established. |
| **Cashfree Payouts** | `INTEGRATION_STATUS.md:42-45`; `RESEARCH-PLAN.md:33`; `PROVIDER-API-RESEARCH.md:123-153`; `DELEGATION-WORKFLOW-PLAN.md:85`; `delegation-manifest.json:96` | **Doc-only.** No `CASHFREE_*` key in any `.env`. No `cashfree` hostname in any code file. | **No.** Real API exists (§3.4); brand merely echoes "Free Cash". |
| **freecash.com (Almedia GmbH)** | Named as the *platform* throughout the routine docs (`ROUTINE-DESIGN.md` §7.2, `RESEARCH-PLAN.md:46`), and implied by the scripts' class name `FreeCashMonitor` | **Doc-only, plus one invented hostname.** This is the consumer rewards platform the routine *thinks* it monitors — but it publishes no API and **prohibits automated access including monitoring** (§3.1). | **No — and it cannot be, compliantly.** |

### 1.3 What "configured" was tested against, and the result

| Check | Command / file | Observed result |
|---|---|---|
| Provider keys in the real env files | `.env` (8 lines), `server/.env` (8 lines) — key names only, values `[REDACTED]` | Only LLM/gateway keys: `JARVIS_SUPERVISOR_V2`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK_MODEL`, `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL`, `GATEWAY_PROVIDER_ORDER`. **Zero provider keys.** |
| Provider keys anywhere in env examples | `.env.example` (2 lines: `VITE_STRIPE_PAYMENT_LINK`, `VITE_API_URL`), `server/.env.example` (38 lines: Stripe, Resend, JWT, OpenAI, OpenRouter, Supabase, Omniroot, NineRouter, Ollama) | **Zero `FREECASH_*` / `CASHFREE_*` / `HG_CASH*` names.** |
| Grep for provider env names in env files | `grep -E '^[A-Za-z_]*(FREECASH\|CASHFREE\|HG_?CASH)[A-Za-z_]*' .env server/.env .env.example server/.env.example` | **No output** — no such key exists. |
| Provider hostnames in code | `https://…freecash…`, `…hg.cash…`, `…cashfree…` over the tree | Matches occur **only in `.md` design docs**, plus the two invented URLs listed in §2.3. **No code file references any candidate host.** |
| Runtime adapter self-report | `server/src/adapters/freecashMonitorAdapter.ts:206-207` | `externalConnected: false`, `externalStatusMessage: '… External FreeCash API connection is not configured.'` — the adapter itself concedes no provider link. |
| Operator-held credential cache | `Path(os.environ.get("APPDATA", "")) / "FreeCash" / "tokens.json"` referenced at `scripts/finance_monitor.py:21` | **The directory does not exist on this host** (`ls "$APPDATA/FreeCash"` → no such dir). The token cache this code depends on has never been created. |
| Provider config file the code requires | `configs/finance_settings.json` (referenced `scripts/finance_monitor.py:212`) | **Does not exist** (`ls configs/` → empty/no such dir). |
| Anything scheduled | `schtasks /query` (recorded in `AUDIT-RULE-COMPLIANCE.md:59`) | No FreeCash/finance task registered. |

**Conclusion:** the repo contains **seven parallel "Free Cash monitor" implementations and not one provider binding.** Any statement that the routine monitors a real provider is unsupported by the repository.

---

## 2. Exact evidence — file paths and line numbers

### 2.1 Env var NAMES referenced by repo code (names only; no values exist)

| Env var name | Declared / read at | Present in `.env`? |
|---|---|---|
| `FREECASH_STATUS_API` | `server/scripts/freecash-daily-monitor.mjs:32`; documented `server/data/freecash-monitor/README.md:50` (with a value equal to the invented URL, see §2.3) | **No** |
| `FREECASH_NOTIFICATION_EMAIL` | `server/scripts/freecash-daily-monitor.mjs:28`; `README.md:51` | **No** |
| `FREECASH_WEBHOOK_URL` | `server/scripts/freecash-daily-monitor.mjs:29`; `README.md:52` | **No** |
| `FREECASH_TZ` | `ROUTINE-DESIGN.md:164` (timezone override for the routine) | **No** |
| `CONFIG_PATH` | `scripts/finance_monitor.py:212` (defaults to the missing `configs/finance_settings.json`) | **No** |
| `LOG_PATH` | `scripts/finance_monitor.py:223` | **No** |
| `VAULT_PATH` | `scripts/approval_gate.py:35` (defaults `D:/AgenticOS/secrets`) | **No** |
| `SIGNING_KEY` | `scripts/approval_gate.py:21` | **No** |
| `APPDATA` | `scripts/finance_monitor.py:21` (token-cache root, `…/FreeCash/tokens.json`) | n/a (OS var; cache dir absent) |

None of these is a provider credential. All are unset. **No secret value exists anywhere in this repo for any provider.**

### 2.2 Invented / non-grounded endpoints (must NOT be carried forward)

| Endpoint | Where | Status |
|---|---|---|
| `https://api.freecash.com/v1/status` | `server/scripts/freecash-daily-monitor.mjs:32` (default); `server/data/freecash-monitor/README.md:50`; duplicate build copy `release/win-unpacked/resources/server/scripts/freecash-daily-monitor.mjs`; cited-and-rejected `ROUTINE-DESIGN.md:193,584`; `AUDIT-RULE-COMPLIANCE.md:159,176` | **DEAD — re-probed this pass: `GET` → HTTP 404.** Not a documented API. |
| `https://api.example.finance/v1` | `finance-monitor/src/api_client.py:22` (default base URL); `finance-monitor/config/README.md:51` (`api_endpoint_base`) | **PLACEHOLDER** — literally `example.finance`. Sandbox stub, no network call is made (`api_client.py:57-73` returns a hardcoded mock dict). |
| `https://free-cash.approve` | `free-cash-finance-monitoring-specification.md:366` (`APPROVAL_API_URL` default) | **PLACEHOLDER** — not a resolvable host; internal approval concept only. |

### 2.3 Provider endpoints asserted in repo docs (speculative, unverified by any code or trace)

| Path | Where | Verdict |
|---|---|---|
| `GET /accounts/overview`, `GET /transactions/recent`, `GET /balance/current`, `GET /alerts/status` | `scripts/finance_monitor.py:48-53` (called against `self.api_endpoint` from config, which does not exist) | **INVENTED.** No provider is named; config file absent; script never runs. |
| `POST /withdraw`, `POST /survey/complete<id>` | `docs/freecash-monitoring.md:69,93` | **INVENTED AND FORBIDDEN** — write endpoints on a platform with no public API. Violates R2/R4 if implemented. Already marked superseded at `ROUTINE-DESIGN.md:594`. |
| "FreeCash.io: withdrawals, leaderboards, stats, offers; Auth `X-API-Key`; URL parse.bot" | `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33` | **FALSE** — misattributes parse.bot's key scheme to a parked domain (§3.2). |
| Hermes skill: `FreeCash.io · GET /withdrawals · X-API-Key · total_earnings` | `optional-skills/serverops/automated-status-monitor/references/api-compliance.md:12,64-65`; `SKILL.md:34,81` | **FALSE / DEPRECATED** — same misattribution; the skill also warns about a provider-deprecation it never verified. |
| `GET /api/v1/status/metrics`, `HEAD /api/v1/status` on `http://localhost:3001` | `scripts/monitoring/free-cash-daily-check.py:25-26,112`; `ROUTINE-DESIGN.md:188-189` (W1/W2) | **VERIFIED-as-intended-locally, but NOT a provider read.** Nothing is listening (recorded: HTTP 000). This is the design's deliberately `degraded` substitute source. |

### 2.4 Repo files that record the blocker (context, all read, none modified)

| File | Lines | What it records |
|---|---|---|
| `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` | `190-191` | W3/W4 = `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` |
| same | `193` | The `.mjs` URL "is **not** grounded in anything and must not be carried forward" |
| same | `422` | `pending.json` approval item carries `"provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN…"` |
| same | `543` | Ranked risk #1 for 30-day operation: provider read contract unresolved → "silent false confidence in R3" |
| same | `574` | Blocked-on-external-access table lists W3/W4 and the payout execution contract |
| `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md` | `9-17`, `23-30`, `91-121`, `123-153`, `177-187` | Prior pass: verdict NOT AVAILABLE; repo-local evidence table; HG.Cash and Cashfree read endpoints; alternatives matrix |
| `docs/free-cash-monitor-routine/RESEARCH-PLAN.md` | `15-19`, `31-36`, `118-128`, `187-190` | F1–F5 findings; option decision table; 9 `COULD NOT VERIFY` items; pre-existing repo defects |
| `docs/free-cash-monitor-routine/AUDIT-RULE-COMPLIANCE.md` | `159`, `164`, `170`, `176` | Invented endpoint + malformed request line; missing config path; env var names unset; "never (file does not parse)" |
| `docs/freecash-automation-workflow-plan-v2.md` | `29`, `33`, `35`, `38`, `69-75` | `.mjs` SyntaxError at `:41`; `make_freecash_check.py` resolves data dir to `D:\data`; `finance_monitor.py` CONFIG-BLOCKED; no `FREECASH*` keys; Option C "BLOCKED until the user supplies read-only API credentials" |
| `docs/free-cash-monitor-routine/DELEGATION-WORKFLOW-PLAN.md` | `38`, `111` | Blocking external unknown carried forward, not invented; "No invented endpoints" hard constraint |
| `docs/free-cash-monitor-routine/delegation-manifest.json` | `19`, `93-99` | Same constraint; options O1–O5 with verdicts (`O5` = rejected browser automation) |
| `.hermes/plans/2026-09-17_213918-free-cash-finance-automation-workflow.md` | `33`, `59-62` | E9: no `FREECASH_*` keys; default endpoint **404** → fabricated; provider choice must come from the user |
| `.hermes/plans/2026-09-17_213843-free-cash-finance-automation.md` | `39`, `57`, `211-212` | Measured 404; R2 read-only constraint; B1/B2 recorded **OPEN — external / OPEN — user input** |
| `.hermes/plans/2026-09-17_214017-free-cash-finance-automation-workflow.md` | `48` | "Confirm in writing which provider account exists (HG.Cash / Cashfree / other)" |

### 2.5 The one code path that would touch a provider, and why it cannot run

`server/scripts/freecash-daily-monitor.mjs` is the only artifact that attempts an outbound provider call. It is dead:

- `:32` — invented `STATUS_API_URL` default.
- `:41` — TypeScript annotation (`function isDailyCheckAllowed(): boolean`) inside a `.mjs` → `node --check` fails with `SyntaxError: Unexpected token ':'` (recorded `AUDIT-RULE-COMPLIANCE.md:33`, `docs/freecash-automation-workflow-plan-v2.md:29`). **No line of rule logic ever executes.**
- `:58` — returns `true` on a read error (fail-**open** → would permit a double run, defeating R1).
- `:97-99` — URL→request-path parser drops the leading slash (`url.split('/').slice(3).join('/')` → `v1/status`), so the request line would be malformed even if the host were real (`AUDIT-RULE-COMPLIANCE.md:159`).
- `:41,63-76` — `require()` used inside an ESM module; `getDailyCheckCount()` reads a `count` field the record never writes.
- `:28-32` — reads `FREECASH_STATUS_API` / `FREECASH_*`, none of which is set; so it can only ever fall through to the 404 default host.

**Therefore: today the repo makes no provider request at all, compliant or otherwise.**

---

## 3. Publicly documented read-only endpoints per genuine candidate

Every fact in this section was fetched read-only during this pass unless a different date is stated.

### 3.1 freecash.com (Almedia GmbH) — consumer rewards platform

| Item | Finding |
|---|---|
| Public developer API | **NONE.** No developer/API page is published. |
| `/docs`, `/developers` | `GET https://freecash.com/docs` → **302 → `https://freecash.com/en/docs` → 404**. Same for `/developers` → `/en/developers` → **404**. *(Note: this refines `RESEARCH-PLAN.md:16`, which recorded a bare 404; the observed behaviour is a 302 to a localised path that 404s. Same conclusion.)* |
| `robots.txt` | Fetched: `Disallow: /user/`, `Disallow: /myprofile`, `Disallow: /fc-api/`, `Disallow: /dev-playground/`, `Disallow: /offer/`, `Disallow: /w/`, `Disallow: /r/`, `Disallow: /scd-cgi/`. An internal application backend exists but is deliberately kept out of reach and undocumented. |
| Read-only endpoints for account status / balance / earnings | **NONE publicly documented.** Anything asserted otherwise is invented. |
| Auth scheme | n/a — no documented scheme for third parties. |
| Rate limits | n/a. |
| Automation / ToS posture | **PROHIBITED, and the prohibition names monitoring explicitly.** Verbatim from the live ToS (fetched and grepped this pass, effective 2026-07-17), §17 Restrictions and Prohibited Uses: *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring** or copying any of the material on the Website."* · *"Use any manual process to monitor or copy any of the material on the Website, or for any other purpose not expressly a…"* (continues "…without our prior written consent"). · *"To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity, including but not limited to automating clicks, movements, or tasks within offers or apps. Such behavior is **strictly prohibited**…"* §16: *"These Terms of Services permit you to use the Website for your **personal, non-commercial use only**."* |
| Source URLs | `https://freecash.com/en/policies/terms` · `https://freecash.com/robots.txt` · `https://freecash.com/en/docs` (404) · `https://freecash.com/en/developers` (404) |
| Confidence | **HIGH** (live fetch, verbatim strings, same-day) |

**Consequence for R1–R4:** a daily automated poll of freecash.com is not merely non-compliant — it puts the very account being monitored at risk (Almedia may restrict accounts or void unredeemed rewards for ToS breaches). Since R1 mandates an automated once-daily check, **no automated read of freecash.com can satisfy all four rules.** The account-side data must come from a source that is not freecash.com's website (§6, options A/B/E).

### 3.2 freecash.io — NOT a platform (candidate eliminated)

| Item | Finding |
|---|---|
| What it actually is | Fetched `https://freecash.io/llms.txt` this pass: *"freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket."* Listing: `https://forsale.godaddy.com/forsale/freecash.io`; escrow 5–7 business days. |
| API / endpoints / auth | **None.** No service operates on the domain. |
| Repo impact | `INTEGRATION_STATUS.md:28-33` (and the Hermes skill at `api-compliance.md:12,64-65`) present "FreeCash.io Platform APIs" with an `X-API-Key` scheme and a `parse.bot` URL. Both parts are wrong: the domain is parked, and `X-API-Key` is **parse.bot's** key. **Must not be treated as a provider contract.** |
| Confidence | **HIGH** (verbatim from the domain's own file, re-fetched 2026-09-18) |

### 3.3 HG.Cash — real documented read-only API (candidate, but not this account's without operator confirmation)

| Item | Finding |
|---|---|
| Is it a "Free Cash" consumer rewards platform? | **No.** HG.Cash describes itself as payment/settlement infrastructure for LatAm (ARS/BRL/CLP/BOB) and iGaming operators. Plausible as a *payout destination*; not a rewards platform. |
| Official docs | `https://docs.hg.cash/llms.txt` (index, fetched) · `https://docs.hg.cash/api-reference/openapi.yaml` (spec, fetched, 90,616 bytes) · `https://docs.hg.cash/introduction.md` (fetched) |
| Base URL | `https://hg.cash/api/v1` (production), `http://dev.hg.cash/api/v1` (development) — from the OpenAPI `servers:` block |
| Auth | HTTP Bearer, header `Authorization: Bearer cash_<…>`. Spec `securitySchemes.bearerAuth: {type: http, scheme: bearer, bearerFormat: JWT}`; global `security: [- bearerAuth: []]`. Token is **generated by hand in the account settings page**; the docs instruct "never expose tokens in frontend", "store tokens securely on your backend servers only". |
| **Read-only: `GET /accounts`** | `operationId getUserAccounts`. Docs: *"Returns the authenticated user's accounts, including ledger balance, pending fees, net available balance (balance minus pending fees), and account status."* Response `200` → `data[]` with `id` (uuid), `name`, `balance` (number, 2 dp, "Account ledger balance"), `pendingFees` (number), `netBalance` (number, "Available balance after pending fees"), `status` (enum **`Operativa` \| `Bloqueada` \| `Cerrada`**), `currency`, `number`. |
| **Read-only: `GET /account/{id}/balance`** | `operationId getAccountBalance`. Path param `id` (uuid). Response `200` → `id`, `balance`, `currency`, `pendingFees`, `netBalance`, `status` (same enum). Declared errors: `401`, `404`, `500`. |
| Other read-only ops (not needed by the monitor) | `GET /transaction/{id}/status`, `GET /transactions/{id}/receipt`, `GET /claims/{id}`, `GET /checkouts`, `GET /checkouts/{id}`, `GET /transaction-statuses`, `GET /transaction-types`, `GET /br\|cl\|bo/transactions/{id}/status` |
| **Write ops to keep off the allowlist** | `POST /transactions` (cash-out — the docs are explicit: "To create cash-outs (money leaving your accounts), you must call the Cash Out endpoint"), `POST /checkouts`, `POST /checkouts/{id}/cancel`, `POST /claims`, `POST /br\|cl\|bo/transactions/{inbound,outbound}`, `POST /alias-lookup` (paid feature) |
| **Read-only in the verb sense?** | **YES — `GET` only.** No token-exchange `POST` is required; the dashboard-issued bearer token is sent directly on the `GET`. This makes HG.Cash the only candidate that fits R2's `GET`/`HEAD`-only transport **without an exemption**. |
| Empirical liveness check (this pass, unauthenticated) | `curl https://hg.cash/api/v1/accounts` → **HTTP 401**, body `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}`. The path is live and the auth requirement matches the docs. |
| Rate limits | **UNKNOWN.** No rate-limit entry exists in the docs index. Would need `api-support@hg.cash` or headers from a first authenticated call. |
| ToS restriction on automation | **None found.** This is an API built for server-side programmatic use; spec is MIT-licensed. |
| Access gate | **KYC-gated onboarding.** `introduction.md`: HG.Cash "does **not** automatically grant dashboard access to every signup"; access requires contact form → KYC → approval → provisioning. |
| Source URLs | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` · `https://docs.hg.cash/api-reference/accounts/get-account-balance` · `https://docs.hg.cash/api-reference/openapi.yaml` · `https://docs.hg.cash/introduction.md` · `https://docs.hg.cash/llms.txt` |
| Confidence | **HIGH** for the API contract (official spec fetched + live 401). **UNKNOWN/UNLINKED** as to whether this operator holds an account. |

### 3.4 Cashfree Payouts — real documented balance API, but its read path is not verb-pure

| Item | Finding |
|---|---|
| What it is | Indian payments/payouts gateway (merchant-side). The brand merely echoes "Free Cash". |
| Official docs | `https://www.cashfree.com/docs/llms.txt` (index) · `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` · `…/payouts/v1/get-balance-v12` · `…/payouts/v1/authorize` |
| Base URL | `https://payout-api.cashfree.com` (production), `https://payout-gamma.cashfree.com` (sandbox) — from the OpenAPI `servers:` block |
| **Read-only: `GET /payout/v1/getBalance`** | Documented. Response `200`: `{"status":"SUCCESS","subCode":"200","message":"Ledger balance for the account","data":{"balance":"214735.50","availableBalance":"173980.50"}}` |
| **Read-only: `GET /payout/v1.2/getBalance`** | **NOW VERIFIED** (this pass resolves `RESEARCH-PLAN.md:126` "COULD NOT VERIFY"): the shape is documented with path `/payout/v1.2/getBalance`, `operationId get-balance-v1-21`, `deprecated: false`, required headers `Authorization` (Bearer) + `Content-Type`, optional query `paymentInstrumentId`, declared responses `200`/`403`/`422`. Description: *"ledger balance and available balance… available balance is ledger balance minus the sum of all pending transfers."* |
| Auth | **Two-step, and the first step is a `POST`.** `POST /payout/v1/authorize` with headers `X-Client-Id` and `X-Client-Secret` returns/validates the token (`{"status":"SUCCESS","message":"Token is valid","subCode":"200"}`; `401` → `{"status":"ERROR","subCode":"401","message":"Invalid clientId and clientSecret combination"}`). If the caller's IP is not whitelisted, `X-Cf-Signature` (RSA-encrypted `clientId.timestamp`) is also required. |
| **Read-only in the verb sense?** | **NO — not cleanly.** Obtaining the token requires `POST /payout/v1/authorize`. A monitor that honours R2's "deny-by-default, `GET`/`HEAD` only" transport **cannot make that call by itself.** Two honest resolutions: (i) the operator obtains the token out-of-band and the monitor consumes it read-only via `GET` only; or (ii) an explicit, documented `# readonly-exempt:` for exactly `/payout/v1/authorize`, which widens R2 and must be a deliberate, reviewed act (`ROUTINE-DESIGN.md:253`). **This is a genuine new finding of this pass and it makes Cashfree structurally weaker than HG.Cash for this design.** |
| Write ops to keep off the allowlist | standard/direct/batch transfer, self-withdrawal, internal transfer, beneficiary mutation. |
| Empirical liveness check (this pass, unauthenticated) | `curl https://payout-api.cashfree.com/payout/v1/getBalance` → **HTTP 403** (documented as "APIs not enabled. Please fill out the Support Form" / invalid token). Path is real and behind auth. |
| Rate limits | **UNKNOWN for Get Balance.** The rate-limit reference page enumerates Payments and SecureID only. Generic mechanism documented (`X-RateLimit-Limit/-Remaining/-Reset`, `429`). Exact Get Balance limit needs the merchant dashboard. |
| Access gate | Merchant account **plus** Payouts API explicitly enabled (activation request). |
| Source URLs | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` · `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance-v12` · `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` · `https://www.cashfree.com/docs/llms.txt` |
| Confidence | **HIGH** for the API contract (official docs fetched). **LOW** that it relates to this operator at all. |

### 3.5 Two dead leads recorded so they are not re-probed

| Lead | Observed | Verdict |
|---|---|---|
| `getfreecash.com` | `GET https://getfreecash.com/` → HTTP 200, body literally `OK`, `Content-Type: application/octet-stream` (openresty). Re-confirmed this pass. | **NOT AN API** — a liveness/placeholder responder. |
| `parse.bot` "freecash.io API" wrapper | Third-party scraper marketplace listing. Its own page states it is *"not an official freecash.io API"* and that *"Freecash does not publish a documented public developer API."* Its endpoints (`get_leaderboard`, `get_withdrawals`, `get_stats`, …) return **public platform-wide data**, `is_authenticated: false`. | **Cannot serve this purpose** — no notion of "your account". Also sourced from a parked domain. |

---

## 4. VERIFIED vs UNKNOWN vs DEPRECATED

Legend — **VERIFIED**: seen in a repo file I read at the cited line, **or** in official documentation I actually fetched this pass (2026-09-18), **or** as the observed output of a command I ran. **UNKNOWN**: cannot be established without operator-held credentials or a provider statement. **DEPRECATED**: was asserted somewhere and is now known wrong/dead — must not be built on.

| # | Claim | Class | Basis |
|---|---|---|---|
| 1 | No provider is configured in this repo (no keys, no hostnames in code) | **VERIFIED** | Env key-name scan; hostname grep; `freecashMonitorAdapter.ts:206-207` |
| 2 | `https://api.freecash.com/v1/status` returns 404 | **VERIFIED** | `curl` this pass; same as `ROUTINE-DESIGN.md:193` |
| 3 | `https://api.example.finance/v1` is a placeholder, never called | **VERIFIED** | `finance-monitor/src/api_client.py:22,57-73` |
| 4 | freecash.com publishes no public developer API (`/docs`, `/developers` → 302 → 404) | **VERIFIED** | `curl -L` this pass |
| 5 | freecash.com ToS forbids automated access *including monitoring*, and manual monitoring without consent | **VERIFIED** | Live ToS fetch + grep, verbatim strings, §3.1 |
| 6 | freecash.com ToS restricts use to personal, non-commercial use | **VERIFIED** | same |
| 7 | freecash.com `robots.txt` disallows `/user/`, `/myprofile`, `/fc-api/`, `/dev-playground/` | **VERIFIED** | fetched this pass |
| 8 | freecash.io is a parked GoDaddy for-sale domain, not a platform | **VERIFIED** | `https://freecash.io/llms.txt` this pass |
| 9 | `getfreecash.com` is not an API | **VERIFIED** | `curl` this pass |
| 10 | HG.Cash `GET /accounts` returns ledger balance / pendingFees / netBalance / status enum | **VERIFIED** | official page + `openapi.yaml` this pass |
| 11 | HG.Cash `GET /account/{id}/balance` exists with the same fields | **VERIFIED** | official page + spec this pass |
| 12 | HG.Cash base URL `https://hg.cash/api/v1`, Bearer `cash_…`, token from dashboard settings | **VERIFIED** | spec `servers:` + auth section this pass |
| 13 | HG.Cash unauthenticated `GET /accounts` → 401 with the documented error body | **VERIFIED** | `curl` this pass |
| 14 | HG.Cash `POST /transactions` is the cash-out (money-leaving) endpoint | **VERIFIED** | spec/doc text this pass |
| 15 | Cashfree `GET /payout/v1/getBalance` documented, returns ledger + available balance | **VERIFIED** | official docs this pass |
| 16 | Cashfree `GET /payout/v1.2/getBalance` path string is real and not deprecated | **VERIFIED** *(upgrades `RESEARCH-PLAN.md:126` from COULD NOT VERIFY)* | OpenAPI block this pass |
| 17 | Cashfree token acquisition requires `POST /payout/v1/authorize` with `X-Client-Id`/`X-Client-Secret` | **VERIFIED** | official docs this pass |
| 18 | Cashfree unauthenticated `GET /payout/v1/getBalance` → 403 | **VERIFIED** | `curl` this pass |
| 19 | `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33` "FreeCash.io Platform APIs … X-API-Key" is wrong on both counts | **VERIFIED (as an error)** | §3.2 + the listing's own disclaimer |
| 20 | Hermes skill `automated-status-monitor/references/api-compliance.md:12,64-65` asserts an unverified FreeCash.io `X-API-Key` API | **VERIFIED (as an error)** | file read |
| 21 | `server/scripts/freecash-daily-monitor.mjs` cannot parse (TS annotation at `:41`) and its path parser is malformed at `:97-99` | **VERIFIED** | repo records `AUDIT-RULE-COMPLIANCE.md:33,159,176` (re-read) |
| 22 | `scripts/make_freecash_check.py:14-15` `fetch_status()` is a hardcoded stub returning zeros | **VERIFIED** | file read at the cited lines |
| 23 | `scripts/monitoring/free-cash-daily-check.py:25-26` targets `http://localhost:3001/api/v1/status/metrics` | **VERIFIED** | file read |
| 24 | `configs/finance_settings.json` does not exist; `%APPDATA%/FreeCash/tokens.json` does not exist | **VERIFIED** | `ls` this pass |
| 25 | **Which provider this operator's earning account actually sits with** | **UNKNOWN — operator-held** | No repo, doc, or probe establishes it |
| 26 | Whether the operator holds an HG.Cash account, a Cashfree merchant account, or a freecash.com account | **UNKNOWN — operator-held** | required by `RESEARCH-PLAN.md:138`, `.hermes/plans/…214017:48` |
| 27 | HG.Cash rate limits | **UNKNOWN** | not published in the docs index |
| 28 | Cashfree Get Balance rate limit | **UNKNOWN** | not published; needs merchant dashboard |
| 29 | Whether freecash.com sends a periodic balance/status **email** usable for parsing | **UNKNOWN** | ToS commits only to "essential service-related communications" |
| 30 | Whether freecash.com offers a statement/export download control | **UNKNOWN** | no documented export control found |
| 31 | Whether any freecash.com read API exists under private contract (NDA) | **UNKNOWN** | only Almedia could confirm; their public posture indicates none for consumers |
| 32 | A defensible real earnings figure / hourly rate for this workflow | **UNKNOWN** | published figures are marketing; prior plan's CPA/LTV/conversion numbers are invented (`RESEARCH-PLAN.md:189`) |
| 33 | "FreeCash.io Platform APIs" as a live provider | **DEPRECATED — false** | §3.2 |
| 34 | `https://api.freecash.com/v1/status` as a target | **DEPRECATED — 404** | #2 |
| 35 | `https://api.example.finance/v1` | **DEPRECATED — placeholder** | #3 |
| 36 | `POST /withdraw`, `POST /survey/complete<id>` against freecash.com (`docs/freecash-monitoring.md:69,93`) | **DEPRECATED — invented + R2/R4-violating** | #4, #5 |
| 37 | `server/scripts/freecash-daily-monitor.mjs` as a deployable monitor | **DEPRECATED — does not parse** | #21 |
| 38 | `scripts/monitoring/free-cash-daily-check.py` as a working R3 detector | **DEPRECATED — `save_snapshot()` before `load_snapshot()`; `main()` never called** | `docs/freecash-automation-workflow-plan-v2.md:33`, `AUDIT-RULE-COMPLIANCE.md:40` |
| 39 | `freecash.io` (getfreecash-family) as a provider | **DEPRECATED — parked domain** | #8 |
| 40 | "Free Cash Finance Automation" as an external vendor/product with an API | **DEPRECATED — repo-internal entity only** | `RESEARCH-PLAN.md:50,120` |

---

## 5. What cannot be resolved without operator-held credentials

### 5.1 Blocking unknowns (no amount of further public research closes them)

1. **Which provider/account the monitored earning balance actually sits with.** Not derivable from the repository, and no public source maps "Free Cash Finance Automation" to a provider. Recorded open in `RESEARCH-PLAN.md:121,138`, `.hermes/plans/…213843:211-212`, `.hermes/plans/…214017:48`.
2. **Whether that provider exposes a read-only status/earnings surface to *this* account** — i.e. whether the account is HG.Cash-KYC'd, Cashfree-activation-approved, or (if freecash.com) structurally unreadable by automation.
3. **The live response values** (balance, pending, status) — the whole point of R3. No credential, no values; any numbers produced without them are fabricated and are explicitly forbidden (`delegation-manifest.json:19`).
4. **Rate limits** for HG.Cash and Cashfree Get Balance. Both are UNKNOWN from public docs; both are answerable from a first authenticated call's headers or from provider support.

### 5.2 What the operator must provide — per candidate

| If the account is with… | Operator must provide | Credential granularity / permission level | Read-only in the verb sense? | Notes |
|---|---|---|---|---|
| **HG.Cash** | (a) Written confirmation that the entity holds an HG.Cash account; (b) an API token generated in **Account settings** in the HG.Cash dashboard (`introduction.md` requires completed KYC + contact-form onboarding first) | A single user-scoped **Bearer** token (`Bearer cash_…`). **HG.Cash does not publish separate read vs write scopes** — the same token can also call `POST /transactions`. Therefore read-only-ness must be enforced **by our client's `GET`/`HEAD` allowlist** (`ROUTINE-DESIGN.md` §3.2), not by the credential. Store it in the Hermes env (`%LOCALAPPDATA%\hermes\.env`), **never** in `D:/AgenticOS`. | **YES** — `GET` only; no token-exchange call needed | Best structural fit: the read path needs no write verb at all. |
| **Cashfree Payouts** | (a) Written confirmation of a Cashfree merchant account; (b) **Payouts API enabled** (activation request — unentitled accounts get 403 "APIs not enabled"); (c) `X-Client-Id` + `X-Client-Secret`; (d) optionally an RSA public key + `X-Cf-Signature` if the egress IP is not whitelisted | Merchant **client id + client secret** (dashboard → Developers). No read-only scope exists at the credential level either. | **NO** — requires `POST /payout/v1/authorize` first | Choosing this widens R2 (see §3.4). If chosen, prefer the operator obtaining the token out-of-band and the monitor consuming `GET` only. |
| **freecash.com** | **Nothing that would help.** There is no credential that makes a compliant automated read possible; a session cookie would only enable a **ToS-prohibited** automated read (§3.1). | n/a | n/a | If the earning balance genuinely lives on freecash.com, the *only* compliant acquisition paths are operator-supplied data or passive mail/statement evidence (§6 A/B/E). Ask the operator to confirm this explicitly, in writing, so the design stops waiting for an API that cannot exist. |
| **freecash.io** | **Nothing — not a service.** | n/a | n/a | Candidate eliminated. |

### 5.3 What the operator must NOT be asked for

Login passwords, session cookies, 2FA codes, or anything that would authenticate an automated agent as the human on a rewards platform. Those are refused by R2/R4 and, for freecash.com, by §3.1. Only **provider-issued API tokens from a dashboard** (HG.Cash, Cashfree) are in scope.

---

## 6. Lowest-risk path to real earnings/status data, with NO earning action

Constraints applied to every row: **R1** one read/day · **R2** no write/earning verb · **R3** notify on change · **R4** human approval before any external action. "Effort" = incremental engineering/operator hours on top of the existing design in `ROUTINE-DESIGN.md`.

| # | Alternative | Effort (h) | Read-only? | R1–R4 fit | Dependencies | Verdict |
|---|---|---|---|---|---|---|
| **A ★** | **Operator-entered daily state file.** The operator reads their own dashboard for ~60 s and appends one JSONL record (`balance`, `available_to_withdraw`, `account_status`); the routine consumes it as a source and diffs against prior days to fire R3 notifications. | **1–2** | **Yes** — the human reads; the automation only touches a local file | **Perfect.** No provider access by code → R2 trivially satisfied; R1 enforced by the existing day lock; R3 by the existing change detector; R4 untouched. | Writable `data/freecash-monitor/state/status.jsonl`; the operator's own ordinary login (permitted personal use, ToS §16) | **Build this now.** Zero ToS surface, zero credential handling, closes the R3 "silent false confidence" risk the moment the first record lands. Snapshots must still be marked `source: operator_entered` (not provider-verified). |
| **B** | **Manual CSV/statement export from the provider dashboard.** Operator downloads the provider's own report and drops it in a watched folder; a read-only local parser ingests it as a *records backstop* (tax/reconciliation), not as the daily loop. | **1–2** | **Yes** — a human uses a provider feature as intended; the parser reads a local file | **Compatible.** No network egress to the provider at all. | An export control must exist. **UNKNOWN for freecash.com**; Cashfree documents Payouts Reports & scheduled email reports (`…/payouts/dashboard/reports`); HG.Cash has a dashboard. | **Strong second.** Highest evidential value per hour. Verify the export control exists manually first — do not assume it. |
| **C** | **Official read-only API — HG.Cash.** Add one allowlisted read path (`GET /accounts` plus, if needed, `GET /account/{id}/balance`) to the routine's `GET`/`HEAD` allowlist with a `# readonly-exempt:`-free justification, and map `balance`/`pendingFees`/`netBalance`/`status` onto the snapshot schema. | **4–8** on top of A | **Yes — `GET` only**, no token-exchange POST | **Compatible, and the cleanest API option.** R2's allowlist needs no widening beyond the read path. | Confirmed HG.Cash account (KYC complete) + dashboard Bearer token in the **Hermes** env; outbound HTTPS | **Preferred API path *if* the operator confirms HG.Cash.** Rate limits remain UNKNOWN — start at 1 req/day (R1 already caps it). |
| **D** | **Official read-only API — Cashfree Payouts.** `GET /payout/v1/getBalance` (or `/v1.2/getBalance`). | **4–8** on top of A, **plus** an R2 decision | **Semantically yes, verb-no** — requires `POST /payout/v1/authorize` | **Fit is degraded.** R2's deny-by-default transport forbids the required `POST`. Either the operator supplies a short-lived token out-of-band (monitor stays `GET`-only), or R2 gains an explicit, reviewed exemption for exactly that path — which must be a deliberate act, not a silent one. | Merchant account **with Payouts API enabled** (activation queue); `X-Client-Id`/`X-Client-Secret`; possibly `X-Cf-Signature` | **Conditional, ranked below C.** The activation queue makes time-to-visibility 1–4 weeks. |
| **E** | **Email / provider-notification parsing.** Operator forwards provider mail to a monitored mailbox; a local parser (repo precedent: `scripts/notification_service.py`; `himalaya` skill for IMAP) extracts receipt/status events. | **3–5** | **Yes** — reading one's own mailbox is not access to the provider's website | **Compatible.** Passive, no provider request, no verb concern. | Provider must actually send such mail (**UNKNOWN** for freecash.com — ToS §15.2 commits only to "essential service-related communications"); mailbox app-password in the Hermes env | **Good secondary**, weakest as a primary: email is post-hoc, so it cannot show a partial balance change that generated no mail. |
| **F** | **Human-observed session read (strictly manual).** The operator opens their own dashboard in their own browser, reads the figure, and types it into option A's record. | **0.5–1** (i.e. zero build; it *is* A's manual step) | **Yes, because it is a human action** | **Compatible.** No automation touches the provider. | none beyond A | **This is option A, described honestly.** Distinct from G below *only* in that no software drives the browser. Keep that boundary explicit. |
| **G** | **Local AgenticOS metrics API** `GET http://localhost:3001/api/v1/status/metrics` | **1–2** | **Yes** | **Compatible** (it is the design's W1) | A running local service — nothing is listening today | **Keep as the offline substitute only, with `degraded: true` on every snapshot.** Never present its output as provider-verified (`ROUTINE-DESIGN.md:289,543`). |
| **✗ H** | **Scripted / headless browser session against freecash.com** | 4–6 | No | **Violates the rules and the provider's ToS** | stored credentials + live 2FA | **REJECTED — do not build.** ToS §17 bans automatic processes "for any purpose, including monitoring"; `robots.txt` disallows `/user/` and `/myprofile`; ToS §19 permits voiding unredeemed rewards. Downside is the account being monitored. Already rejected at `RESEARCH-PLAN.md:34,59`, `delegation-manifest.json:98`. Record the rejection so it is not re-proposed. |

### 6.1 Recommended, lowest-risk sequence

1. **A + G today (1–2 h).** Ship the routine reading the operator-entered state file, with every snapshot marked non-provider-verified and `degraded: true` where the local substitute is used. This satisfies R1–R4 with **zero** provider contact and gives R3 a real baseline immediately.
2. **F is folded into A.** The operator's ~60 s dashboard look is the acquisition step; nothing automates it.
3. **Ask the operator the one blocking question** (§5.2): *which provider holds the balance — HG.Cash, Cashfree, freecash.com, or something else?* Until answered, W3/W4 stay literally `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`.
4. **If HG.Cash → C (4–8 h).** Extend the allowlist to `GET /accounts` only; verify with one live call whose output is logged as status code + field names, values `[REDACTED]` (pattern already specified at `docs/freecash-automation-workflow-plan-v2.md:75`). Capture the rate-limit headers on that first call to close UNKNOWN #27.
5. **If Cashfree → D (4–8 h + an R2 decision).** Decide *before* coding whether the token comes from the operator out-of-band (preferred) or R2 gets a narrow exemption for `POST /payout/v1/authorize`.
6. **If freecash.com → no API path exists.** Say so plainly, and run A + B + (E if the operator forwards mail). Do not schedule any request to freecash.com.
7. **B in parallel (1–2 h)** as the records/tax backstop, once the operator confirms an export control exists.
8. **Never widen the allowlist to a write path.** `POST /transactions` (HG.Cash) and every Cashfree transfer/withdrawal endpoint stay forbidden; R2's deny-by-default transport already enforces this (`ROUTINE-DESIGN.md:199-219,266`).

### 6.2 Exit criteria for this blocker

The blocker `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` is resolved **only** when all of the following hold:

1. The operator states, in writing, which provider and which account the monitored balance sits with.
2. If an API exists for that provider, the operator supplies the dashboard-issued token (Hermes env only, never the repo) and **one** read-only call succeeds, with its status code and field names logged and all values `[REDACTED]`.
3. The successful path is added to the routine's `GET`/`HEAD` allowlist with a justification, and `verify-readonly.sh` still exits 0.
4. If **no** API exists (the freecash.com case), the operator states that explicitly and the routine ships with source `operator_entered`, `degraded: true`, and a documented statement that no provider-verified read is possible — at which point W3/W4 are **closed as UNRESOLVABLE**, not left open forever.

Until (1) happens, the correct answer remains **UNKNOWN**, and the routine must keep printing `retreat`-equivalent honesty: *"source DEGRADED (local/operator, not provider-verified)."*

---

## 7. Hard-constraint compliance record for this pass

| Constraint | Observed |
|---|---|
| Do not log in anywhere | No authentication performed anywhere; only unauthenticated public `GET`s |
| Do not create accounts | None created |
| No `POST`/`PUT`/`PATCH`/`DELETE` to any provider | No such request was sent. `POST /payout/v1/authorize` is **described** from Cashfree's docs, never called |
| No claim/withdraw/payout/survey/offer action performed or simulated | None |
| Do not write credentials anywhere | No credential was read, requested, or written; env files were read **by key name only**, values `[REDACTED]` |
| Read-only `GET`/`HEAD` of public docs allowed | Used for: freecash.com ToS/robots.txt/docs/developers, freecash.io/llms.txt, getfreecash.com, docs.hg.cash (index, pages, OpenAPI yaml), cashfree.com docs pages, and the liveness probes in §3.3/§3.4 |
| No fabricated endpoints | Every endpoint above is either fetched from official docs, observed in a repo file at a cited line, or labelled UNKNOWN/DEPRECATED |
| No existing file modified | Only this new file was created |

**Liveness probes actually run this pass (commands and observed output):**

```
GET https://api.freecash.com/v1/status                      -> 404
GET https://freecash.com/docs                               -> 302 -> https://freecash.com/en/docs
GET (follow) https://freecash.com/en/docs                   -> 404
GET https://freecash.com/developers                         -> 302 -> https://freecash.com/en/developers
GET (follow) https://freecash.com/en/developers             -> 404
GET https://freecash.com/robots.txt                         -> 200 (Disallow /user/, /myprofile, /fc-api/, /dev-playground/, /offer/, /w/, /r/, /scd-cgi/)
GET https://freecash.io/llms.txt                            -> "domain name currently listed for sale on GoDaddy's aftermarket"
GET https://getfreecash.com/                                -> 200, body "OK"
GET https://hg.cash/api/v1/accounts                         -> 401 {"error":"Missing or invalid authorization header. Expected: Bearer <token>"}
GET https://payout-api.cashfree.com/payout/v1/getBalance    -> 403
```

# PROVIDER-CONTRACT-R4 — the read-only provider contract for the Free Cash daily status routine

**Stream:** P — provider read-only contract (research plan `RS-1`, closes Q1 + Q2).
**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD** `8f7463a`
**Written:** 2026-10-01, pass window `11:44` → `11:51` local (Europe/Berlin, UTC+02:00).
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` (3.11.9, tzdata 2025.3). Not needed for the probes; quoted because the routine's day key depends on it.
**Method:** `curl` 8.21.0, **GET only, unauthenticated**. Public provider documentation. No credential, no token mint, no POST/PUT/PATCH/DELETE, no signup, no account creation, no browser session.
**Raw evidence:** every probe below is a file under `raw/` in this directory. Every claim is the output of a command run in this pass; nothing is inherited from R3 or from `PROVIDER-API-RESEARCH.md` except as a *lead* that was re-measured (and each re-measurement either matched or is reported as a change).

---

## 0. The four operational rules (operator numbering — number AND title, always)

- **R1 — zero automated earning actions.** Observe only. No POST/PUT/PATCH/DELETE to any provider, no token mint, no signup, no account creation, no authentication anywhere. This pass is GET-only and unauthenticated. *(The shipped gate's docstrings invert this: its `R2` = no earning action.)*
- **R2 — exactly one status read per Europe/Berlin calendar day.** The routine was **never invoked** in this pass; today's production key (`2026-10-01.lock`, 08:53) is already spent. *(Shipped `gate.py` labels the once-per-day rule as its `R1`.)*
- **R3 — notify on change only.** Not exercised here.
- **R4 — human approval before ANY external action.** Nothing was subscribed, registered, published, messaged or scheduled. No scheduled task or cron job was created or modified.

The shipped gate inverts the numbering (its R1 = once-per-day, its R2 = read-only). No bare `R1`/`R2` is printed in this document without its title.

---

## 1. Answer to the question

**No candidate exposes balance / earnings / account-status state through a documented read-only path that this routine may use under R1.** Two of the four candidates *do* document a live read-only route (HG.Cash, and the local loopback API for session status), but both are **BLOCKED** — one for lack of an account/token, the other because the local server is **not running**. One candidate is **R1-incompatible** by construction (Cashfree Payouts: the read needs a token that only a `POST` can mint). One is a **parked domain** (FreeCash.io). One is a **ToS-forbidden** consumer platform (FreeCash.com). A fifth, decisive constraint is in the routine's own code: its transport allowlist is **loopback-only**, so *no* external provider host can be reached at all without widening the allowlist, which R1 forbids here.

---

## 2. Verdict table (one row per candidate)

| # | Candidate | Endpoint | Method | Auth required | What it returns | Read without a write scope? | **Verdict** |
|---|---|---|---|---|---|---|---|
| P-1 | **FreeCash.io** | `https://freecash.io/llms.txt` (no API exists) | GET | none | "domain name currently listed for sale on GoDaddy's aftermarket" | n/a — no account surface exists | **NO-DOCUMENTED-READ-PATH** |
| P-2 | **FreeCash.com** (the consumer rewards platform the account sits on) | none published; `api.freecash.com/v1/status` | GET | n/a | **404** (empty body); ToS §"Monitoring and Enforcement" | No — ToS forbids automated access *and* monitoring | **R1-INCOMPATIBLE** (ToS) · also NO-DOCUMENTED-READ-PATH |
| P-3 | **HG.Cash** | `GET /api/v1/accounts`, `GET /api/v1/account/{id}/balance` | GET | `Authorization: Bearer cash_<64-hex>` (generated manually in account settings) | `balance`, `pendingFees`, `netBalance`, `status` (`Operativa`/`Bloqueada`/`Cerrada`), `currency` | The **route** is read-only — no write scope is needed to read — but the token is account-scoped and no token exists in the repo | **BLOCKED-NO-ACCOUNT** (401) |
| P-4 | **Cashfree Payouts** | `GET /payout/v1/getBalance`, `/payout/v1.2/getBalance` | GET | Bearer token obtained by `POST /payout/v1/authorize` with `X-Client-Id`/`X-Client-Secret` | `data.balance`, `data.availableBalance` | **No** — the token can only be minted by a POST, which R1 forbids | **R1-INCOMPATIBLE** (REFUSED) |
| P-5 | **Local app API** `127.0.0.1:4600` | `GET /api/projects/:projectId/freecash/auth` (session state only); no balance/earnings GET exists | GET | none | auth-state booleans (`sessionState`, `satisfied`, `blocker`, `evidence`); **no** balance/earnings | Auth-state yes; **no documented balance/earnings read path at all** | **BLOCKED** (server not listening, `curl` exit 7) · NO-DOCUMENTED-READ-PATH for balance/earnings |

**The acceptance bar is met with real failing output in three rows** (P-3 → HTTP 401, P-4 → documented POST mint refused, P-5 → `curl` exit 7). This is not a table where every row is OK.

---

## 3. Per-candidate detail

### P-1 — FreeCash.io → **NO-DOCUMENTED-READ-PATH**
- **Endpoint:** none. The domain's own `llms.txt` states it is for sale. Live (raw `01-freecashio-freecashcom-probes.txt`):
  ```
  === GET https://freecash.io/llms.txt ===
  HTTP/1.1 200 OK
  body: "freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket.
         It is available via Buy-It-Now, Make-an-Offer, or Lease-to-Own ..."
  ```
- **Method:** GET · **Auth:** none · **Returns:** the sale listing.
- **Read without a write scope:** n/a — there is no service.
- **Repo correction (measured):** `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33` lists "FreeCash.io Platform APIs … Auth: X-API-Key … URL: https://parse.bot/…". That is wrong on two counts: (a) freecash.io is a parked domain; (b) `X-API-Key` is **parse.bot's** key, not a FreeCash scheme. This entry must not be carried forward as a live contract.

### P-2 — FreeCash.com → **R1-INCOMPATIBLE** (and NO-DOCUMENTED-READ-PATH)
- **Endpoint:** no public API. `https://api.freecash.com/v1/status` → **HTTP 404, empty body**; `https://api.freecash.com/` → **404**. `robots.txt` (live, 200) explicitly `Disallow: /fc-api/` and `Disallow: /dev-playground/`.
- **Auth:** n/a (no documented scheme for third parties).
- **What it returns:** nothing at those paths.
- **Read without a write scope:** no — and not merely because of auth. The published Terms (live, HTTP 200, 420 307 bytes, raw `05-freecashcom-tos-probe.txt`) say, verbatim:
  > "Use any **robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring** or copying any of the material on the Website."

  and
  > "To use **macros, bots, scripts, or any other automation tools** designed to simulate or replicate human user activity … Such behavior is **strictly prohibited**."

  A daily automated status poll is "monitoring" by an "automatic device". This is not a technical limitation the routine can engineer around; it is a rule that **R1 cannot satisfy** and that also risks the account being monitored.
- **Stub never touches the network (measured):** `scripts/make_freecash_check.py:14-15` → `def fetch_status() -> dict: return {"balance": 0, "available_to_withdraw": 0, "pending_surveys": []}`. The adapter `server/src/adapters/freecashMonitorAdapter.ts:198-209` likewise returns a hardcoded `externalConnected: false`. Neither is a provider read.

### P-3 — HG.Cash → **BLOCKED-NO-ACCOUNT**
- **Endpoints (documented, OpenAPI re-fetched this pass):**
  - `GET /accounts` → `balance`, `pendingFees`, `netBalance`, `status`, `currency`, `count`
  - `GET /account/{id}/balance` → `balance`, `pendingFees`, `netBalance`, `status`, `currency`
  - Base URL `https://hg.cash/api/v1`; `security: bearerAuth`; token format `cash_<64-char-hex>`, "Generate your API token in the account settings page".
  - **Write endpoints that must stay forbidden:** `POST /transactions` (cash-out), `POST /checkouts`, `POST /alias-lookup`.
- **Live probe (raw `02-hgcash-cashfree-probes.txt`):**
  ```
  === GET https://hg.cash/api/v1/accounts ===
  HTTP/1.1 401 Unauthorized
  X-Matched-Path: /api/v1/accounts
  {"error":"Missing or invalid authorization header. Expected: Bearer <token>"}
  ```
- **Read without a write scope:** yes, the *route* is a pure GET; the token is account-scoped, not write-scoped. **But** no HG.Cash token exists in the repo and the service is KYC-gated B2B onboarding (LATAM/ARS payment rail for iGaming operators) — nothing in the repo ties it to the monitored account.
- **Verdict:** **BLOCKED-NO-ACCOUNT**. Documented read path exists and is live; it cannot be read without a token that does not exist and that R1 forbids creating.

### P-4 — Cashfree Payouts → **R1-INCOMPATIBLE** (REFUSED)
- **Read endpoints documented:** `GET /payout/v1/getBalance` → `data.balance`, `data.availableBalance`; `GET /payout/v1.2/getBalance`.
- **Documented auth chain:** `POST /payout/v1/authorize` with `X-Client-Id`/`X-Client-Secret` returns the Bearer token; that token is then required on `getBalance`. Both facts are quoted from the official pages re-fetched this pass.
- **Live probe (raw `02-hgcash-cashfree-probes.txt`):**
  ```
  === GET https://payout-api.cashfree.com/payout/v1/getBalance ===
  HTTP/1.1 200 OK
  RateLimit-Limit: 50
  { "status":"ERROR", "message":"Token is not valid", "subCode":"403"}
  ```
  The HTTP status is 200 but the payload is an auth refusal (`subCode:403`, "Token is not valid") — the read is gated.
- **Read without a write scope:** **no.** The read cannot be called without a token that only the POST mint can produce. R1 forbids minting it, so this candidate is **REFUSED**, not merely blocked. (The `POST /authorize` was **not executed**; its requirement is quoted from the provider's own page. Sending a token — real or fake — would itself be an authentication attempt and was not done.)
- **Honest edge note:** `https://payout-api.cashfree.com/payout/v1/this-path-does-not-exist-fcr4` returns the **same** `Token is not valid` body as the documented read path (raw `04-cashfree-edge-behaviour.txt`), whereas `https://payout-api.cashfree.com/` and `/nonsense-fcr4` return **404** (awselb). So the `/payout/*` prefix applies the auth gate before routing, and a live probe alone **cannot** distinguish a real Cashfree path from an invented one — path existence in P-4 rests on the documentation, not on the probe.

### P-5 — Local app API `127.0.0.1:4600` → **BLOCKED** (server not listening)
- **Documented read routes in the repo's own router (`server/src/routers/projects.ts`):**
  - `GET /api/projects/:projectId/freecash/auth` (line 391) → `service`, `label`, `sessionState` (`authenticated`/`unauthenticated`), `satisfied`, `blocker`, `checkedAt`, `evidence{sessionValid, credentialAvailable, externalConnected}`, `goal`, `tasks`. The comment (lines 340-342) states: "Safe status only … Cookie values, credentials and tokens are NEVER read, stored or returned."
  - The only freecash routes are `/auth` (GET+POST), `/auth/login` (POST), `/auth/verify` (POST), `/auth/clear` (POST). **There is no GET route for balance, earnings or pending amounts.**
- **Live probe — the failing path (raw `03` and `06`):**
  ```
  === GET http://127.0.0.1:4600/api/health ===
  curl: (7) Failed to connect to 127.0.0.1:4600 after 2044 ms: Could not connect to server
  HTTP=000  shell_rc=7
  netstat -ano | grep -E ':4600|:3001' | wc -l  ->  0   (no listener)
  ```
  The server answered at 09:28 today (R3 `raw/01-live-http-probes.txt`, lead read and **not** inherited as fact); it is **down** in this pass. A live read of `/auth` was therefore impossible.
- **Read without a write scope:** yes for the auth-state endpoint (unauthenticated GET, no credential), **but** it returns only session lifecycle — not balance/earnings. For the four fields the routine needs, there is **NO-DOCUMENTED-READ-PATH** in the local API.
- **Verdict:** **BLOCKED** this pass (server down). Even when up, it can supply account **session** status, not a balance.

---

## 4. The decisive in-repo constraint: the routine cannot reach any provider anyway

`monitoring/freecash/readonly_client.py` (read this pass):
```
39| ALLOWED_METHODS = frozenset({"GET", "HEAD"})
41| ALLOWED_HOSTS   = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
43| ALLOWED_PATHS   = (
44|     re.compile(r"^/api/v1/status/metrics$"),
45|     re.compile(r"^/api/v1/status$"),
46|     # Provider paths are added here ONLY after research resolves them ...
49| )
54| DEFAULT_BASE_URL = "http://localhost:3001"
60| PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
```
and `monitoring/freecash/tests/test_r2_readonly.py:119` asserts `"freecash.com"` is **not** present in any routine module.

Consequences:
1. Every external candidate above (P-1…P-4) is **unreachable from the routine** — the transport rejects any non-loopback host before a socket is opened.
2. The two loopback paths the routine *may* call (`/api/v1/status/metrics`, `/api/v1/status`) are exactly the two that returned **404** on `:4600` at 09:28, and the server is down now. So the allowlist currently permits only dead paths.
3. Making any provider read work would require **widening the allowlist** (adding a provider host and path). That is explicitly out of scope here ("never widen any allowlist") and is a **human decision** under R4, not a research step.

**This does not change with a credential.** Even if the operator later holds an HG.Cash token, the routine's R1 transport still refuses the host. Streaming P therefore returns a *contract* verdict, not an implementation change.

---

## 5. Red cases (a green/positive claim must ship with the check that can fail)

| Claim | Red case that proves the check discriminates | Evidence |
|---|---|---|
| HG.Cash `GET /accounts` is a **live, documented** path (positive: gets past routing to the auth gate) | An invented path on the same host returns **404**, not 401: `GET https://hg.cash/api/v1/this-path-does-not-exist-fcr4` → `HTTP/1.1 404 Not Found`, `X-Matched-Path: /404` | `raw/02-hgcash-cashfree-probes.txt` |
| The probe method itself works (a positive 200 is possible) | `GET https://docs.hg.cash/llms.txt` → `HTTP/1.1 200 OK`, 10 704 bytes | `raw/02-hgcash-cashfree-probes.txt` |
| The loopback app API is genuinely **down**, not merely un-allowlisted | Same command against a host that *is* up (docs.hg.cash) returns 200; against `127.0.0.1:4600` it returns `curl exit 7`; `netstat` shows **0** listeners | `raw/06-redcase-boundary-and-loopback.txt` |
| Cashfree's auth gate is real and the read is unusable without a mint | The read returns an auth refusal payload; the provider's own docs show the token comes only from `POST /authorize`; and an invented `/payout/...` path returns the *same* refusal (so the gate precedes routing) | `raw/04-cashfree-edge-behaviour.txt` |

---

## 6. What this changes in the plan

Naming the workflow stages (`workflow/WORKFLOW-PLAN-R4.md`) affected:

- **Closes Q1 + Q2 (research plan §1).** The open question "is there a documented read-only provider path?" is answered **no for this account**, with the failing probes attached. Research on provider APIs should stop.
- **Re-blocks S3 ("First real operator reading")'s provider branch — and thereby *confirms* its stated dependency.** S3 already states the operator's own dashboard login is required because "the routine never authenticates to a provider (R1)". P now shows there is no provider read path to have. S3's fastest honest path remains the **human-entered reading file**, not a wire read.
- **Does not unblock S4 ("Bridge the authenticated app path").** S4 depends on the desktop app running and a human authenticating; this pass the API listener is **down** (`curl` exit 7) and, even when up, exposes only auth state, not a balance. S4 stays blocked on the app being started by a human.
- **Keeps S7 / S10 unchanged.** S7 still requires a green gate (S0′) and S1's remedy; nothing here unblocks scheduling. S10's provider-dependent option (R-b) has no documented read to build on.
- **One thing P *unblocks* — the decision, not a build:** the operator can stop treating "find the provider API" as an open work item and record the four verdicts above. The only wire source reachable from the routine's loopback-only transport is the **local app API**, which stream A (app-path bridge) is mapping.

---

## 7. BLOCKED list (exact command that failed, per item)

| # | Item | Exact failing command | Observed | Status |
|---|---|---|---|---|
| B-1 | Local app API `:4600` read | `curl -sS -m 10 -D - -o /dev/null -w 'HTTP=%{http_code}' http://127.0.0.1:4600/api/health` | `curl: (7) Failed to connect … Could not connect to server`; `HTTP=000`; `netstat … \| wc -l` = `0` | **BLOCKED — server not listening** |
| B-2 | HG.Cash balance read | `curl -sS -m 20 -D - -o /dev/null -w 'HTTP=%{http_code}' https://hg.cash/api/v1/accounts` | `HTTP/1.1 401 Unauthorized` · `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}` | **BLOCKED-NO-ACCOUNT** |
| B-3 | Cashfree balance read | `curl -sS -m 20 https://payout-api.cashfree.com/payout/v1/getBalance` | `HTTP 200` · `{ "status":"ERROR", "message":"Token is not valid", "subCode":"403"}`; token only from `POST /authorize` | **R1-INCOMPATIBLE — REFUSED** |
| B-4 | FreeCash.io API | `curl -sS -m 20 https://api.freecash.com/v1/status` | `HTTP/1.1 404 Not Found`, empty body; `freecash.io` is a for-sale parking page | **NO-DOCUMENTED-READ-PATH** |
| B-5 | FreeCash.com provider read | `curl -sS -m 25 https://freecash.com/en/policies/terms` | `HTTP 200`, ToS: "automatic device … including monitoring" is prohibited | **R1-INCOMPATIBLE** |

Also carried from the sealed pre-existing files (verified present, not created by me): `server/data/freecash-monitor/INTEGRATION_STATUS.md` (mtime Sep 11 10:27) is the stale entry corrected in P-1.

---

## 8. Hermeticity and footprint

- **Interpreter:** not invoked; the routine was never run. `curl` 8.21.0, git-bash/MSYS, non-elevated.
- **Production root hash triple, before (11:44) and after (11:50):** identical to the expected values —
  `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9`,
  `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8`,
  `be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c`. Raw pair: `raw/isolation-before-after.txt`.
- `find data/freecash-monitor -type f -newermt "2026-10-01 11:30"` → **zero** results. Raw: `raw/isolation-post.txt`.
- **Write scope:** only `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/provider/` (created this pass; no prior file of mine existed there). No write to `monitoring/freecash/**`, `scripts/monitoring/**`, `data/freecash-monitor/**`, or any sibling stream. No file under `raw/` overwrote an existing file.
- **Rules intact:** no POST/PUT/PATCH/DELETE, no token mint, no signup, no authentication, no credential read or printed, no allowlist widened, no scheduled task or cron created or modified, no external action. Provider docs pages returned an embedded Cashfree "Dev Studio" bearer token; it was **not** stored in any artifact and is not reproduced here ([REDACTED] by policy).
- **Routine invocations this pass: 0.** Today's production day key was not touched.

---

## 9. Raw evidence index

| File | Contents |
|---|---|
| `raw/01-freecashio-freecashcom-probes.txt` | `freecash.io` park page, `api.freecash.com` 404s, `freecash.com/robots.txt` |
| `raw/02-hgcash-cashfree-probes.txt` | HG.Cash 401s + 404 red case + docs index; Cashfree 200-with-403 body |
| `raw/03-loopback-app-api-probes.txt` | `:4600` / `:3001` connection failures (`curl` exit 7) |
| `raw/04-cashfree-edge-behaviour.txt` | Cashfree path-existence experiment (404 vs auth-gated 200) |
| `raw/05-freecashcom-tos-probe.txt` | FreeCash.com Terms (HTTP 200) with monitoring clause |
| `raw/06-redcase-boundary-and-loopback.txt` | HG.Cash read-vs-write GET statuses; loopback re-probe |
| `raw/BLOCKED-commands.txt` | every BLOCKED/REFUSED item with exact command + output |
| `raw/isolation-before.txt`, `raw/isolation-before-after.txt`, `raw/isolation-post.txt` | hash triples before/after; `-newermt` count = 0 |

# 02 — Provider-contract research plan (W3/W4 resolution)

**Repo:** `D:/AgenticOS` · **Date of this pass:** 2026-09-30 (Europe/Berlin) · **Shell:** git-bash/MSYS
**Scope:** research plan only. This pass wrote exactly one file (this one). It modified nothing
under `monitoring/` or `server/`, issued no write/earning call to any provider, used no credential,
and logged in nowhere. Every provider-facing request made this pass was an unauthenticated,
body-less `GET` of public documentation (or the unauthenticated liveness probe noted below).

**The gap this section closes (or honestly fails to close).** The routine's only socket site,
`monitoring/freecash/readonly_client.py`, has no provider path on its allowlist, so W3/W4 are
literal `PROVIDER_ENDPOINT_UNKNOWN` and every real day resolves to `MONITOR_DEGRADED`. R3
("notify me if earnings or account status changes") therefore cannot ever be truthful about the
real account while the source is unknown. This section is the protocol that ends the guessing:
either a documented read-only contract is found and allowlisted through change control, or the
gap is closed *honestly* as UNRESOLVABLE and the operator-entered file becomes the permanent,
plainly-labelled source.

---

## 0. What the code actually is, verified live this pass

```
$ cd D:/AgenticOS && py -3 -c "import sys; sys.path.insert(0,'monitoring/freecash'); import readonly_client as rc; ..."
ALLOWED_METHODS = ['GET', 'HEAD']
ALLOWED_HOSTS   = ['127.0.0.1', '::1', '[::1]', 'localhost']
ALLOWED_PATHS   = ['^/api/v1/status/metrics$', '^/api/v1/status$']
BODY_KEYWORDS   = ('data', 'json', 'files', 'body', 'content')
provider host            -> ForbiddenWriteError: R2: host not allowlisted: 'hg.cash'
provider path on loopback-> ForbiddenWriteError: R2: path not allowlisted: '/api/v1/accounts'
provider write verb      -> ForbiddenWriteError: R2: method 'POST' is not read-only (allowed: GET, HEAD)
```

Three consequences that shape the whole plan:

1. **A provider path alone is not enough.** `ALLOWED_HOSTS` is loopback-only, so even after
   `GET https://hg.cash/api/v1/accounts` were added to `ALLOWED_PATHS` the request would still be
   refused at the *host* check. Resolving W3/W4 is a **two-line** allowlist change (host + path),
   not one.
2. **The reader has no credential plumbing.** `request()` accepts `headers` (line 138) but
   `read_metrics()`/`probe_status()` never pass one. A provider read that needs `Authorization`
   requires a new read function, not just an allowlist line.
3. The deny-by-default transport already refuses `POST` before `_transport()` is reached, and
   `_transport()` is the only socket site in the routine — so the boundary is enforceable, not
   aspirational.

`grep -rn "HTTPConnection" monitoring/freecash/*.py` returns only `readonly_client.py` (line 34
import, line 90 use). The "single socket site" claim holds.

**Current source reality, verified:** `data/freecash-monitor/state/operator-state.json` has
`"records": []` — no operator entry has ever been made — and the two allowlisted local paths are
the AgenticOS metrics substitute. So today **every** day is `MONITOR_DEGRADED` with no real
earnings/status data read, ever. That is the single biggest gap versus R3.

---

## 1. (a) The discovery protocol — how W3/W4 actually get resolved, inside R2

The provider read contract cannot be discovered by probing. It can only be discovered by
**watching the operator's own legitimate, human-driven session** and then checking what was
observed against the provider's own documentation. The protocol below is the only one that stays
inside R2 (no earning action), R4 (human does the external act) and the credentials rule (the
agent never handles a password, cookie or 2FA code).

### 1.1 Who does what

| Step | Actor | Exact action | Why this actor |
|---|---|---|---|
| D1 | **Human (operator)** | Opens their own browser, navigates to the provider dashboard, logs in **themselves**, reaches the balance/earnings/account-status view. | The login is the human's ordinary personal use. An agent may never type a password, a cookie or a 2FA code, and R4 puts the external act with the human. |
| D2 | **Human** | Opens DevTools → Network → filter `Fetch/XHR`, reloads the view, and lets the page settle. | This is passive observation of a session the human already owns. No agent process touches the page. |
| D3 | **Human** | For each request that looks like a balance/earnings/status read, records: **method, scheme+host+path (+query), status code, and the response's field *names* only.** | Field names are what the monitor must map; field *values* are private and are not needed to resolve the contract. |
| D4 | **Human** | Pastes the **redacted** list into a research intake file. Header values (`Authorization`, `Cookie`), tokens, cookies and query secrets are **replaced with `[REDACTED]`**; body values are masked. | A cookie or bearer token is a credential. It must never enter chat, the repo, or a plan artifact. |
| D5 | **Agent** | Fingerprints the intake list: classifies each observed call read vs mutating, and cross-checks method+path against the provider's **official** docs. | Classification is analysis, not contact. The agent issues no request in this step. |
| D6 | **Agent** | Produces the candidate contract set (method, host, path, documented field names, doc URL) and drives it through the gating criteria in §4. | Pure document work. |
| D7 | **Human** | If a contract survives gating, the human supplies the dashboard-issued token **into the Hermes env only** and runs the single first live call (or authorises it), with status code + field names logged and all values `[REDACTED]`. | The credential stays operator-held and out of the repo; the first authenticated call is a human-authorised external action (R4). |

### 1.2 Hard rules for the protocol

- **The capture is evidence, not a task list.** The agent must never "replay" a captured request —
  not even a captured `GET`, and least of all one carrying the session cookie. Replaying it would
  authenticate the agent as the human and reintroduce a socket path outside the routine's single
  audited transport. Captures are read once for *shape* (method, host, path, field names) and then
  discarded.
- **An agent must never log in or click anything itself.** Reasons, in order of severity:
  1. Logging in means handling a password/2FA — categorically out of scope for the agent.
  2. Any click in a rewards dashboard can be an earning action (`claim`, `withdraw`, a survey or
     offer). A scripted "just a click to open the balance tab" is one selector mistake away from an
     R2 violation, and there is no second chance: money moves.
  3. On the consumer rewards platform this is also a **Terms breach** that risks the very account
     being monitored — freecash.com §17 forbids any "robot, spider or other automatic device,
     process or means to access the Website **for any purpose, including monitoring**" and bans
     "macros, bots, scripts, or any other automation tools", §19 permits suspending or **voiding
     unredeemed Rewards**, and `robots.txt` disallows `/user/`, `/myprofile`, `/fc-api/`.
     (`https://freecash.com/en/policies/terms`, `https://freecash.com/robots.txt`.)
  4. A headless/automated browser reintroduces a socket connection that `readonly_client.py`'s
     audit hook does not own, breaking the "one place a network capture could ever see" invariant.

### 1.3 Variant that needs no live browser at all (preferred when available)

If the provider dashboard offers a **statement / report export** (CSV/PDF download), the human
downloads it once and drops it in a watched local folder; a read-only local parser ingests it. This
resolves the *record* side of W3/W4 with zero network egress to the provider and is strictly safer
than any API path. It does not resolve the *automated daily read*, but it closes the reconciliation
gap and is a strong fallback. Availability for this operator is **unconfirmed** (see §7 blocked).

---

## 2. (b) Candidate providers/endpoints worth checking, with their read-only contracts

Verdict legend: **DOCUMENTED READ** = a real, officially documented read-only contract exists;
**NOT A PROVIDER** = the name is not a live platform or has no API.

| # | Candidate | Read-only contract found? | Official read contract (if any) | Source URL |
|---|---|---|---|---|
| 1 | **HG.Cash** | **YES** | `GET https://hg.cash/api/v1/accounts` (Bearer) → `id, balance, pendingFees, netBalance, status` (`Operativa`/`Bloqueada`/`Cerrada`), `currency`, `count`. Also `GET /account/{id}/balance`. **GET-only; no token-exchange POST needed.** | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` · `https://docs.hg.cash/api-reference/accounts/get-account-balance` |
| 2 | **Cashfree Payouts** | **YES (balance) but NOT verb-pure** | `GET https://payout-api.cashfree.com/payout/v1/getBalance` → `balance, availableBalance`. No account-status field. Token acquisition requires `POST /payout/v1/authorize` → an R2 problem. | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` |
| 3 | **FreeCash.io** | **NO** | None. `freecash.io` is a parked GoDaddy for-sale domain; the `GET /withdrawals` + `X-API-Key` row in the user-owned skill is **invented**. | `https://freecash.io/llms.txt` |
| 4 | **freecash.com (Almedia GmbH)** | **NO** | No public developer API. ToS §17 prohibits automated access *including monitoring*; `robots.txt` disallows the account paths. | `https://freecash.com/en/policies/terms` · `https://freecash.com/robots.txt` |
| 5 | `getfreecash.com` | **NO** | Not an API — a liveness/placeholder responder (body `OK`). Dead lead; do not re-probe. | (recorded dead in `PROVIDER-FINDINGS-REVERIFIED.md`) |
| 6 | Local AgenticOS metrics substitute (W1/W2) | **YES but not a provider** | `GET /api/v1/status/metrics`, `HEAD /api/v1/status` on `http://localhost:3001`. Loopback only; every snapshot from it is `degraded: true`. | `monitoring/freecash/readonly_client.py:54-56` |

### 2.1 HG.Cash — the one candidate that fits R2 without widening it

Fetched live this pass (`https://docs.hg.cash/api-reference/accounts/get-user-accounts`): the
OpenAPI block declares `servers: https://hg.cash/api/v1` (prod) and documents `GET /accounts` as
*"Returns the authenticated user's accounts, including ledger balance, pending fees, net available
balance (balance minus pending fees), and account status."* Auth is a dashboard-generated Bearer
(`Authorization: Bearer cash_…`). There is **no token-exchange `POST`** on the read path — the token
is sent directly on the `GET`. That is what makes it the only candidate whose read path needs no
write verb and therefore no `readonly-exempt:` widening of R2.

Its weakness is the *credential*, not the verb: HG.Cash publishes a single user-scoped token with no
read/write scope split (`POST /transactions` is the cash-out endpoint and the same token can call
it). Read-only-ness must therefore be enforced **by our client's `GET`/`HEAD` allowlist and the
audit hook**, not by the credential. That is exactly the defence `readonly_client.py` already
implements.

Unauthenticated liveness probe run this pass (read-only `GET`, no credential, no body):

```
$ curl -sS -o /dev/null -w 'hg_accounts_code=%{http_code}\n' https://hg.cash/api/v1/accounts
hg_accounts_code=401
```

### 2.2 Cashfree Payouts — documented, but the read path is not verb-pure

Fetched live this pass (`https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance`):
documented response `{"status":"SUCCESS","subCode":"200","message":"Ledger balance for the
account","data":{"balance":"214735.50","availableBalance":"173980.50"}}`. The unauthenticated probe
this pass was **more informative than the prior pass recorded**:

```
$ curl -sS -i https://payout-api.cashfree.com/payout/v1/getBalance
HTTP/1.1 200 OK
Content-Type: application/json
RateLimit-Limit: 50
RateLimit-Remaining: 48
RateLimit-Reset: 54.71

{ "status":"ERROR", "message":"Token is not valid", "subCode":"403" }
```

So the path is live, reaches the **application** layer (JSON app-error envelope, not an edge HTML
page), and advertises a rate limit of 50 via `RateLimit-Limit`. Two blockers remain: (i) obtaining a
token requires `POST /payout/v1/authorize`, which R2's transport forbids — the monitor would have to
consume an operator-obtained token out-of-band, or R2 would need a deliberate, reviewed exemption;
(ii) the response carries no **account-status** field, so at best it satisfies half of W4.

### 2.3 The two eliminated names

- **FreeCash.io** — `https://freecash.io/llms.txt` fetched live: *"freecash.io is a domain name
  currently listed for sale on GoDaddy's aftermarket."* No service, no endpoint. The row
  `FreeCash.io | GET /withdrawals | X-API-Key | total_earnings` in the user-owned skill
  `automated-status-monitor/references/api-compliance.md:12,64-67` is **invented** and must not be
  relied on.
- **freecash.com** — no `/docs`, no `/developers`, no public API; ToS §17/§19 and `robots.txt` make
  any automated read a breach that can void rewards. This is the name most of the *repo's own*
  design docs assumed, so closing it is load-bearing.

---

## 3. (c) Risk taxonomy — endpoint families that are categorically forbidden in monitor code

These never enter `ALLOWED_PATHS`, never appear in a read function, and are already matched by
`verify_readonly.py`'s pattern table:

1. **Money-movement verbs and paths** — `claim`, `withdraw`/`withdrawal`/`cashout`/`cash-out`,
   `redeem`, `payout`/`pay_out`, `transfer`, `bet`, `spin`, `deposit`, `purchase`, `checkout`
   (see `verify_readonly.py` labels `earning-verb`, `write-endpoint-path`).
2. **HG.Cash write endpoints** — `POST /transactions` (Create Transaction Request / Cash Out — the
   docs: *"To create cash-outs … you must call the Cash Out endpoint"*), `POST /checkouts`,
   `POST /checkouts/{id}/cancel`, `POST /claims`, `POST /alias-lookup`. All `POST` → refused before
   `_transport()`.
3. **Cashfree write + token endpoints** — `POST /payout/v1/authorize` and every transfer /
   direct / batch / self-withdrawal / beneficiary endpoint. `authorize` is *semantically* read-ish
   but *verb*-write; it is forbidden by the deny-by-default method allowlist.
4. **Offer/survey/task completion or acceptance** — `submit_offer`, `complete_survey`,
   `complete_task`, `start_task`, `accept_offer` (label `earning-action`).
5. **Any session/auth/login/cookie endpoint**, anything that mints or exchanges a token, and any
   endpoint whose operationId starts with `create`, `submit`, `approve`, `validate`, or `request`.
6. **Account mutation** — anything named `update_balance`, `set_balance`, `credit_account`,
   `debit_account`.
7. **Any path not on the read allowlist on a provider host**, and the entire robots-disallowed
   freecash.com `/fc-api/` namespace (undocumented — must not be probed even as a `GET`).

### 3.1 How to prove a newly allowlisted path is a pure read

Proof requires **five independent checks**, and none of them is a credentialed call replayed from a
capture:

1. **Method, observed in the operator's own capture** — the request the human saw the dashboard make
   was `GET` (or `HEAD`). A `POST` in the capture disqualifies the endpoint outright.
2. **Method, stated in the provider's own docs** — the official API reference (or OpenAPI block)
   declares the operation as a retrieval with a `get…`/`list…` operationId.
3. **Transport refusal test** — run, against the would-be path:
   `request("POST", provider_url, transport=spy)` and `request("GET", provider_url, json={})` must
   both raise `ForbiddenWriteError` **and the spy must never be called**. This proves a path entry
   cannot be abused as a write even by a future caller.
4. **Static scan** — `py -3 monitoring/freecash/verify_readonly.py monitoring/freecash` exits 0
   (`forbidden=0`), including the new line.
5. **Negative control** — the planted-violation test still fails. If the checker cannot be made to
   fail, its pass certifies nothing.

A path is a "pure read" only when all five hold. Idempotence and no-side-effect are asserted from the
docs (does the operation request/generate/queue anything?) and, where possible, from the capture
(a page reload that re-issues the same `GET` without changing state).

---

## 4. (d) Gating criteria — ALL must hold before a path joins `ALLOWED_PATHS`

1. **Documented.** The exact method + host + path appears in the provider's **official** API
   reference or OpenAPI spec, cited by URL. No third-party wrappers, scraper marketplaces, forum
   posts, or skill files count.
2. **Read verb, no side effect.** The operation is declared a retrieval; it does not create,
   request, queue, generate or approve anything — including money-movement *requests*. No
   token-exchange `POST` may be part of the read path.
3. **Idempotent.** Re-issuing the identical `GET` returns the same read and changes nothing at the
   provider; safe to repeat within the once-a-day gate.
4. **Returns the three fields the routine needs.** `account_status`, an earnings/balance figure, and
   a pending figure — mappable deterministically onto the snapshot schema
   (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`). A balance-only
   contract (Cashfree) satisfies at most half of W4.
5. **No auth scope beyond read.** Either the credential is read-capable only, **or** the client's
   `GET`/`HEAD` allowlist + audit hook *guarantee* read-only-ness at the transport (the HG.Cash
   case). If the token can also move money, that must be written down explicitly, not glossed.
6. **Reproducible.** One operator-run / operator-authorized live call returns HTTP 200 with the
   documented field *names*; the observation is logged as status code + field names with all values
   `[REDACTED]`; and the unauthenticated probe returns a documented auth error (401/403), never a
   200 carrying data.
7. **Host allowlist entry exists.** The provider host is added to `ALLOWED_HOSTS` in the same commit
   — without it the path is unreachable (verified above: `host not allowlisted: 'hg.cash'`).
8. **Credential lives outside the repo.** Token in the Hermes env only, never in `D:/AgenticOS`.

Until **all** hold, the path stays off the allowlist and W3/W4 stay unresolved.

---

## 5. (e) Fallback decision if NO read-only contract can be found

If the operator has no account with a provider that publishes a usable read contract — the likely
case today, since `provider_credentials` is empty, no `FREECASH_*`/`HG_CASH*`/`CASHFREE_*` key
exists, and the monitored name (freecash.com) publishes no API at all — then:

**Decision: keep `state/operator-state.json` as the permanent source.** The operator reads their own
dashboard for ~60 s a day and appends one record; the routine diffs consecutive records and fires R3
notifications on a change. Every snapshot stays `source.kind = "operator_entered"` and
`degraded: true`. W3/W4 are **closed as UNRESOLVABLE**, not left open forever pretending a future
research pass will find an API.

**What this means for R3, stated honestly:**

- The notification is **still truthful about the operator-supplied figures.** A change between two
  operator-entered days is a real change in what the operator recorded, and the diff, dedupe and
  day-lock mechanics are all real.
- It is **never** a provider-verified reading. Every report must say so — the degraded flag stays,
  and the human-facing text must read like `source DEGRADED (local/operator, not provider-verified)`.
- A day with no operator entry is reported as **no data**, not as "no change": `read_source()` returns
  `data_available: False` for a missing `day_key`, and `run_daily_check.py` branches on
  `source["data_available"]` before building a snapshot, so a gap degrades instead of silently
  claiming stability.
- A "no change" between two entered days is only as good as the operator's typing; a missed entry
  breaks the diff chain. Say this in the run output rather than smoothing it over.
- **Never fabricate a provider figure.** If no record exists for today, the run reports degraded; it
  does not invent a balance.

This is a legitimate terminal state, not a defeat: R1–R4 are fully satisfied, R2 has zero provider
surface, and R3 becomes honest instead of silently false. Its only cost is that the reading is
manual.

---

## 6. (f) Change-control procedure for adding one allowlisted path

Preconditions: every gating criterion in §4 holds; the operator has confirmed **in writing** which
provider holds the balance; the token is in the Hermes env only.

**Scope note, stated plainly:** the change is *not* literally one line. The minimum honest diff is
≥3 edits — (1) one host entry in `ALLOWED_HOSTS`, (2) one anchored path regex in `ALLOWED_PATHS`
with a justification comment naming the doc URL and date, (3) a read function that sends the
`Authorization` header (never a body) plus the source wiring, and (4) the expected-allowlist literal
in `test_r2_readonly.py:127` must be updated. Treating the allowlist line as "the" change is fine for
review purposes, but the credential plumbing and the test literal must ship in the same commit.

1. **Branch.** Work on a branch; never on the routine's deployed tree.
2. **Add the path, default-off.** Append the anchored regex with a comment:
   `# GET /accounts -- HG.Cash API docs https://docs.hg.cash/api-reference/accounts/get-user-accounts (read; verified 2026-09-30)`.
   Add the provider host to `ALLOWED_HOSTS`. Wire the read function behind an env flag
   (`FREECASH_READ_SOURCE=provider`) that is **off by default**; `operator_state` stays the default
   until the first live call succeeds.
3. **Update the tripwire test.** `test_unresolved_provider_contract_keeps_its_literal`
   (`tests/test_r2_readonly.py:121-127`) asserts the allowlist is *exactly* the two local paths. It
   **must** be updated in the same commit; leaving it stale fails the suite, which is the intended
   tripwire — you cannot add a provider path without a human editing an assertion that names it.
4. **Static check must pass.**
   `py -3 monitoring/freecash/verify_readonly.py monitoring/freecash` → exit 0,
   `forbidden=0 exempt=N missing_targets=0`.
5. **Planted-violation test must still fail.** Run the suite from `monitoring/freecash/tests`:
   `py -3 test_r2_readonly.py`. It must end `OK`, and specifically
   `test_shipped_shell_checker_fails_on_a_planted_violation` and
   `test_python_port_agrees_with_the_shell_checker` must still drive the checker to a non-zero exit
   on an injected violation. (Verified this pass: 17/17 `OK`, the injected
   `requests.post('…/claim', json={})` is caught with `forbidden=4`.)
6. **Transport negative probes.** Against the new path, confirm
   `request("POST", url, transport=spy)` and `request("GET", url, json={})` raise
   `ForbiddenWriteError` **and** the spy is never called.
7. **First live call, human-authorized.** Operator runs (or authorizes) exactly one `GET`; log status
   code + field names only; values `[REDACTED]`. Capture the rate-limit headers on that first call.
   Then flip the source default and mark `degraded: false` for that source kind.
8. **Rollback.** `git revert` the commit; the default-off flag means even a bad merge cannot silently
   start reading a provider until step 7 is done.

---

## 7. Blocked — cannot be resolved by research

1. **Which provider/account the monitored balance actually sits with.** Operator-held. Not derivable
   from the repo, and no public source maps the internal name "Free Cash Finance Automation" to a
   provider.
2. **Whether the operator holds an HG.Cash account** (KYC-gated onboarding) or a Cashfree merchant
   account **with the Payouts API enabled** (activation queue). Operator-held.
3. **The live response values** (balance, pending, status). No credential → no values; any figure
   produced without them is fabricated and forbidden.
4. **HG.Cash rate limits** — not published; only the first authenticated call's headers can close it.
5. **freecash.com statement/export control, or any balance/status email** — operator must inspect
   their own dashboard/mailbox; not publicly observable.
6. **Whether the operator deliberately accepts the manual-entry path** — a decision, not a fact.
7. **Cashfree application-level behaviour under a real token** — the unauthenticated probe this pass
   gave a JSON app-error (`Token is not valid`), but the entitled/unentitled state requires a token,
   which this pass is forbidden to use.
8. **The `pkg_violate` scratch tree is not the planted-violation mechanism.** Verified this pass:
   `.hermes/scratch/freecash/pkg_violate` is byte-identical to `pkg` (only `__pycache__` differs) and
   `verify_readonly.py` exits **0** on it. The real mechanism is the runtime injection
   `INJECTED_VIOLATION` at `tests/test_r2_readonly.py:27`. Do not cite `pkg_violate` as evidence that
   the checker can fail.

---

## 8. Compliance record for this pass

| Constraint | Observed |
|---|---|
| No login anywhere | None performed; only unauthenticated public `GET`s |
| No write/claim/cashout call to any provider | None sent; the only provider-facing requests were body-less unauthenticated `GET`s (docs pages + three liveness probes) |
| No credential read, requested or written | None |
| Do not modify `monitoring/` or `server/` | Untouched — only this file was created |
| No fabricated endpoint | Every endpoint above is fetched from official docs, observed in a repo file at a cited line, or labelled UNKNOWN/BLOCKED |

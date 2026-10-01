# RESEARCH-PLAN.md — daily status-monitoring routine, provider identity + data-source decision

**Artifact:** `D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R2\research\RESEARCH-PLAN.md`
**Sibling artifact:** `RESEARCH-PLAN.md` (this file) + `QUESTION-REGISTER.json` (same directory)
**Date / clock of record:** 2026-10-01, 09:05–09:20 Europe/Berlin (UTC+02:00) — `date` → `Do,  1. Okt 2026 09:05:32`
**Host:** Windows 11, git-bash/MSYS, non-elevated user `cd-pr` · **Repo:** `D:\AgenticOS`, branch `hermes-rescue-20260908`
**Track:** research (delegation R2, artifact root `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/research/`)
**Scope:** DESIGN + EVIDENCE ONLY. No provider/account call, no authentication, no login, no scheduled task, no git write verb, no edit outside this directory.
**Evidence standard:** every factual row below is the raw output of a command *I ran in this pass*, quoted verbatim. Prior-session facts are labelled `PRIOR PASS` and are never treated as evidence.

---

## 0. Rule numbering — which scheme this document uses (read this first)

Two schemes are live in this repository and they are **inverted**. This document uses the **PARENT-BRIEF scheme** and names it in every table:

| Id | Operator wording (verbatim, PARENT-BRIEF.md §"The four operator rules") | Meaning here |
|----|--------------------------------------------------------------------------|--------------|
| **U1** | "Don't perform earning actions automatically." | read-only verbs + path allowlist; a read failure is a failure, never a silent no-op |
| **U2** | "Check the status once a day." | ≤1 check per `Europe/Berlin` calendar day; a second same-day run no-ops without a read |
| **U3** | "Tell me if earnings or account status changes." | one notification per real change vs the previous day's snapshot |
| **U4** | "Ask me before any external action." | anything non-read becomes a PENDING approval item; never auto-drains |

⚠️ `DELEGATION-2026-10-01/DELEGATION-BRIEF.md` and `DELEGATION-2026-10-01-R2/DELEGATION-BRIEF-R2.md` label the same four contents `R1..R4` with **R1 = once-per-day**. A bare "R2 PASS" is therefore unreadable across documents. Every claim here says `U1`–`U4`.

---

## 1. Provider identity / endpoint placeholder — RESOLVED (as a terminal negative for the named platform)

### 1.1 The placeholder, quoted from the live file

```
$ grep -rn "PROVIDER_ENDPOINT_UNKNOWN" monitoring/freecash/
monitoring/freecash/approval_queue.py:116:        "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase",
monitoring/freecash/readonly_client.py:27:    PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase
monitoring/freecash/readonly_client.py:48:    # today -- see PROVIDER_ENDPOINT_UNKNOWN below.
monitoring/freecash/readonly_client.py:60:PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
monitoring/freecash/tests/test_r2_readonly.py:24:PROVIDER_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
monitoring/freecash/tests/test_r2_readonly.py:122:        self.assertEqual(readonly_client.PROVIDER_ENDPOINT_UNKNOWN, PROVIDER_UNKNOWN)
```
```
$ sed -n '54,61p' monitoring/freecash/readonly_client.py
DEFAULT_BASE_URL = "http://localhost:3001"
METRICS_PATH = "/api/v1/status/metrics"
STATUS_PATH = "/api/v1/status"
DEFAULT_TIMEOUT = 10.0

#: Not a URL, and deliberately never one: the provider read contract is unknown.
PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
```
```
$ grep -rn -i 'freecash\.com\|hg\.cash\|cashfree\|freecash\.io\|almedia' monitoring/freecash/*.py
(exit 1 — no output)
```

So the routine carries **zero** provider literals and **zero** provider paths; `ALLOWED_PATHS` (readonly_client.py:43-49) holds exactly two loopback regexes.

### 1.2 What "Free Cash Finance Automation" denotes

```
$ grep -rn -i "Free Cash Finance Automation" --include=*.md --include=*.json --include=*.py --include=*.ts .
→ 40+ in-repo hits, all documentation/plan artifacts (.hermes/plans/*, docs/*, design_doc.json, artifacts/*)
```
```
$ web_search "\"Free Cash Finance Automation\"" (limit 6)
→ results: lifelogicmedia.com "5 Free Finance & AI Tools…", ssonetwork.com "Gen AI and Free Cash…",
  techhighwave.com "Top Free Personal Finance Software…", youtube.com "10 Fastest Jobs to $200K+…",
  financebuzz.com "12 Ways You Could Put up to $300 Back in Your Pocket", cpapracticeadvisor.com
  "Lunos Launches Free Cash Flow Forecasting…"
→ no vendor, product, ToS or API of that name
```
**`Free Cash Finance Automation` is an internal AgenticOS construct, not a vendor product.** It has no provider contract to consult. The only platform the repository's own executable artifact points at is `freecash.com` (the repo's `freeCashExecutor.ts` uses `FREECASH_HOME='https://freecash.com/en'` and reads a browser session — `PRIOR PASS`, cited, not re-observed this pass).

### 1.3 Candidate providers — documented READ-ONLY balance/earnings/status API?

| Candidate | What it is | Documented read-only balance/earnings/status API? | Label | Source URL read this pass |
|---|---|---|---|---|
| **freecash.com** (Almedia GmbH, Berlin) | GPT/rewards platform; the platform the repo targets | **NO** — no developer portal; no public API. `/docs`→404, `/developers`→404, `/api/v1`→404; `/api` serves the marketing homepage; sitemap indexes only `/api/sitemap/{1..5}/sitemap.xml`; ToS forbids automated access "for any purpose, including monitoring" | **NOT FOUND** | `https://freecash.com/robots.txt`, `/sitemap.xml`, `/docs`, `/developers`, `/api`, `/api/v1`, `/en/policies/terms` |
| **freecash.io** | Parked for-sale domain (GoDaddy aftermarket) | **NO** — no service exists | **NOT FOUND** | `https://freecash.io/`, `/llms.txt`, `/sitemap.xml`, `/lander` |
| **Freecash "API" (parse.bot)** | Third-party managed REST wrapper over freecash.io public data (5-6 endpoints: withdrawals feed, leaderboard, stats, offers, cashout methods) | It exposes **public aggregate** data, **not** a per-account balance/earnings/status. Its own page: *"This isn't an official freecash.io API"* and *"Freecash does not publish a documented public developer API."* Requires `X-API-Key` from the vendor | **THIRD-PARTY (not official, not account data)** | `https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api` |
| **HG.Cash** (HGCash) | LATAM iGaming pay-in/payout rail (B2B merchant infrastructure) | **YES, documented** — `GET https://hg.cash/api/v1/accounts` and `GET /api/v1/account/{id}/balance` return `balance`, `pendingFees`, `netBalance`, `status ∈ {Operativa, Bloqueada, Cerrada}`, `currency` | **DOCUMENTED** (endpoint) · **applies to the monitored account:** UNPROVEN · credential is **not read-scoped** | `https://docs.hg.cash/api-reference/openapi.yaml`, `/accounts/get-user-accounts.md` |
| **Cashfree Payouts** (Cashfree Payments, India) | Merchant disbursement rail | **YES, documented** — `GET https://payout-api.cashfree.com/payout/v1/getBalance` (+ `v1.2`) returns `data.balance`, `data.availableBalance` | **DOCUMENTED** (endpoint) · **applies to the monitored account:** UNPROVEN · read token is **minted by `POST /payout/v1/authorize`** | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance.md` |

### 1.4 Resolution of the placeholder

**Decision: the literal `PROVIDER_ENDPOINT_UNKNOWN` stays, and is now re-labelled from an open TODO to an evidence-backed terminal state for the named platform.**

Reason: the one candidate the repo actually targets (**freecash.com**) publishes **no API at all** (documented-vs-not: "not found") and forbids exactly this access in writing; the two candidates that *do* publish a documented read-only balance endpoint are unrelated B2B payment rails whose connection to the monitored balance is unproven and whose credentials are not read-scoped. There is no endpoint to resolve. Adding an invented one is the one change that must never be made.

Re-labelling is a **documentation** edit (a comment + a citation), not a code change; it is listed as next action A3 and is *not* performed here (outside this artifact folder).

---

## 2. Live evidence this pass — fact table

Every row was produced by a command in this session (09:05–09:20 local, 2026-10-01). Scratch captures: `%LOCALAPPDATA%\Temp\fc-research-r2\`.

| # | Claim | Status | Evidence command | Raw output (verbatim) |
|---|-------|--------|------------------|-----------------------|
| E01 | Clock of record | VERIFIED | `date` | `Do,  1. Okt 2026 09:05:32` |
| E02 | Production-root fingerprint is stable across this pass | VERIFIED | `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` (before and after) | before **and** after: `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` / `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` |
| E03 | The provider read contract is literally unknown in code | VERIFIED | `grep -rn "PROVIDER_ENDPOINT_UNKNOWN" monitoring/freecash/` + `sed -n '54,61p' monitoring/freecash/readonly_client.py` | quoted §1.1 above; `ALLOWED_PATHS` = two loopback regexes, no provider path |
| E04 | `monitoring/freecash/*.py` contains **no** provider literal | VERIFIED (negative) | `grep -rn -i 'freecash\.com\|hg\.cash\|cashfree\|freecash\.io\|almedia' monitoring/freecash/*.py` | `(exit 1 — no output)` |
| E05 | Today's production run produced **no reading** and is booked as a success day | VERIFIED | `cat data/freecash-monitor/state/last-run.json` | `"last_attempt_day":"2026-10-01"`, `"last_success_day":"2026-10-01"`, `"last_outcome":"MONITOR_DEGRADED"`, `"consecutive_missed_days":0`, `"last_attempt_at_utc":"2026-10-01T06:53:46Z"` |
| E06 | The default read source has never carried one figure | VERIFIED | `cat data/freecash-monitor/state/operator-state.json` | `"records": []` (with `template_record` and a `how_to` block) |
| E07 | Today's day key is already spent | VERIFIED | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` `2026-09-30.lock` `2026-10-01.lock` |
| E08 | Alert log has 15 lines; approval queue empty | VERIFIED | `wc -l data/freecash-monitor/alerts/alerts.jsonl` ; `ls -la data/freecash-monitor/approvals/` | `15 data/freecash-monitor/alerts/alerts.jsonl` ; `total 0` (only `.`/`..`) |
| E09 | freecash.com publishes **no** de- v/loper portal and **no** API | VERIFIED | `curl -sS -o /dev/null -w 'code=%{http_code} final=%{url_effective}\n' -L https://freecash.com/{docs,developers,api,api/v1}` + `curl … https://freecash.com/api` | `docs → code=404 final=https://freecash.com/de/docs` · `developers → code=404 final=https://freecash.com/de/developers` · `api → code=200 final=https://freecash.com/api` (body `540263` B, `<html lang="api"…` marketing homepage) · `api/v1 → code=404 final=https://freecash.com/api/v1` |
| E10 | freecash.com's sitemap is self-referential only | VERIFIED | `curl -sS -o sm_freecash.xml -w 'code=%{http_code} size=%{size_download}\n' -L https://freecash.com/sitemap.xml` + `grep -o '<loc>[^<]*</loc>'` | `code=200 size=796` · 5 `<loc>`: `https://freecash.com/api/sitemap/1..5/sitemap.xml` |
| E11 | freecash.com robots.txt scopes out the account/API paths | VERIFIED | `curl -sS -o rb_freecash.txt -w 'code=%{http_code} size=%{size_download}\n' -L https://freecash.com/robots.txt` + `cat` | `code=200 size=298` · `Disallow: /user/` · `Disallow: /myprofile` · `Disallow: /fc-api/` · (+ `/r/`, `/_next/`, `/_ipx/`, `/offer/`, `/scd-cgi/`, `/w/`, `/dev-playground/`, `/*mailto:*/`) |
| E12 | The ToS forbids automated access for *any* purpose incl. monitoring, and manual monitoring without written consent; it may void unredeemed rewards | VERIFIED | `curl -sS -o tos.html -L https://freecash.com/en/policies/terms` + targeted greps | `code=200 size=420307` · `robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website.` · `manual process to monitor or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, without our prior written consent.` · `personal, non-commercial use only` · `may suspend or void any Rewards or potential Rewards you may have received or accumulated in a Rewards Program but not yet successfully redeemed if we …` |
| E13 | freecash.io is a **parked for-sale domain**, not a platform | VERIFIED | `curl -L https://freecash.io/` ; `…/llms.txt` ; `…/sitemap.xml` ; `…/lander` | `/` → `code=200 size=114` body `<script>window.onload=function(){window.location.href="/lander"}</script>` · `/llms.txt` → `code=200 size=571`: `freecash.io is a domain name currently listed for sale on GoDaddy's aftermarket.` · `/sitemap.xml` → `code=200 size=155`, single `<loc>https://freecash.io/lander</loc>` · `/lander` → `code=403 final=https://forsale.godaddy.com/forsale/freecash.io?…` |
| E14 | A **third-party** Freecash "API" exists and is *not* official; it serves public aggregate data only | VERIFIED | `web_search "\"freecash.com\" API documentation read-only balance endpoint developer"` + `web_extract https://parse.bot/marketplace/0076fa84-…/freecash-io-api` | `Freecash API – Leaderboard, Withdrawals & Stats · Parse` … `This isn't an official freecash.io API — it's an independent, maintained REST wrapper over public data.` … `Freecash does not publish a documented public developer API.` |
| E15 | HG.Cash publishes a documented read-only balance surface **and** write/cash-out paths in the same spec | VERIFIED | `curl -sS -o hg_openapi.yaml -w 'code=%{http_code} size=%{size_download}\n' -L https://docs.hg.cash/api-reference/openapi.yaml` + `grep -n '^  /'` | `code=200 size=92028` · read: `/accounts:` (L2204), `/account/{id}/balance:` (L2279) · write/op: `/checkouts:`, `/checkouts/{id}/cancel:`, `/claims:`, `/claims/{id}:`, `/br/transactions/outbound:`, `/cl/transactions/outbound:`, `/bo/transactions/outbound:`, `/transactions:` |
| E16 | HG.Cash's read token also authorises cash-out; auth is `Bearer` | VERIFIED | `web_extract https://docs.hg.cash/api-reference/accounts/get-user-accounts.md` | `- To create cash-outs (money leaving your accounts), you must call the **Cash Out** endpoint: **Create Transaction Request (Cash Out)** (`POST /transactions`)`; `1. **Generate your API token** in the account settings page` |
| E17 | Cashfree documents `GET /payout/v1/getBalance` and its token is minted by a POST | VERIFIED | `curl -sS -o cf_llms.txt -w 'code=%{http_code} size=%{size_download}\n' -L https://www.cashfree.com/docs/llms.txt` + `grep` ; `web_extract …/payouts/v1/get-balance.md` | `code=200 size=91747` · index: `- [Get Balance](https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance.md): Use this API to get the ledger balance and available balance…` · `- [Get Balance V1.2](…)` · `1 payout/v1/authorize` · spec block: `servers: - url: https://payout-api.cashfree.com`, `security: - {}`, `get /payout/v1/getBalance`, `operationId: get-balance1`, `data.balance`, `data.availableBalance` |
| E18 | No local route serves the allowlisted metrics/status paths | VERIFIED (negative) | `for u in …; do curl -sS -o /dev/null -w 'code=%{http_code}' --max-time 6 "$u"; done` ; `grep -rn "api/v1/status\|/status/metrics" server/src` | `localhost:3001/api/v1/status/metrics → curl: (7) Failed to connect … code=000` · `localhost:3001/api/v1/status → code=000` · `localhost:4600/api/v1/status/metrics → code=404` · `localhost:4600/api/v1/status → code=404` · `localhost:4600/api/health → code=200` · grep → no output |
| E19 | A local **operator-state** read path runs end-to-end today on a throwaway root | VERIFIED | `FREECASH_DATA_ROOT=<throwaway> venv/python monitoring/freecash/run_daily_check.py --source operator_state` (twice) | run 1: `RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock` (exit 0) · run 2 (same day): `SKIP_DUPLICATE_DAY 2026-10-01` (exit 0) · snapshot: `"degraded": true`, `"read_ops": []`, `earnings_total_cents: 1340` |
| E20 | The repo's shipped JS verifier reports `4/4 PASSED` on a file that does not parse | VERIFIED | `node --check server/scripts/freecash-daily-monitor.mjs` ; `node server/scripts/verify-freecash-rules.mjs` | check: `SyntaxError: Unexpected token ':'` at line 41, `exit=1` · verifier: `✓ Rule 1 … PASSED … [OK] All 4 operational rules verified (4/4 passed)`, `exit=0` |
| E21 | The Python static gate is green at baseline | VERIFIED | `venv/python monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` / `[verify_readonly] PASS - no unexempted write/earning token found.` (exit 0) |
| E22 | The Hermes skill `automated-status-monitor` asserts a FreeCash.io API that does not exist | VERIFIED | `read_file ~/AppData/Local/hermes/skills/optional-skills/serverops/automated-status-monitor/references/api-compliance.md` | L12: ``| FreeCash.io | `GET /withdrawals` | username, coins, withdrawType, date, country, total_earnings | ✅ Public read-only |`` · L64-67: `### FreeCash.io Platform - Uses X-API-Key header instead of Bearer tokens` — contradicted by E13/E14 |

**Tally: 22 VERIFIED (of which 3 are honest negatives), 0 unverified-in-this-table.**

---

## 3. READ / WRITE BOUNDARY TABLE

Boundary rule for **U1 = zero automated earning actions**: the monitor may use `GET`/`HEAD` only, against a path that provably *reads* and never *creates, mutates, authorises or moves* value. Anything else is U4 territory (human approval) and is never executable by the routine.

| Candidate source | Permitted READ under U1 | Must NEVER be reachable (write / claim / cashout) | Evidence |
|---|---|---|---|
| **Operator-entered JSON** (`data/freecash-monitor/state/operator-state.json`) | *File read only* — `read_ops: []`, zero sockets (`monitoring/freecash/operator_state.py`) | n/a — no transport, no endpoint, nothing to call | E06, E19 |
| **Loopback AgenticOS route** (`http://localhost:3001/api/v1/status/metrics` GET; `/api/v1/status` HEAD) | `GET /api/v1/status/metrics`, `HEAD /api/v1/status` (loopback allowlist, body-rejecting transport) — **degraded health probe only** | Any non-loopback host; any request body (`data`/`json`/`files`/`body`/`content`); any verb outside `{GET,HEAD}`; any other path | E03, E18 |
| **freecash.com** (any path) | **NONE** — prohibited by ToS naming *monitoring*; robots disallows `/user/`, `/myprofile`, `/fc-api/` | **ABSOLUTE**: `/fc-api/*` (internal app backend), any `/offer/*`, any account/claim/withdraw path — never fetch, never allowlist | E09–E12 |
| **freecash.io** (any path) | NONE — parked for-sale domain; `parse.bot` third-party wrapper is not official and exposes no account data | n/a | E13, E14 |
| **HG.Cash** `GET https://hg.cash/api/v1/accounts`, `GET /api/v1/account/{id}/balance` | Documented reads. **Not permitted today**: host not allowlisted, requires `Authorization: Bearer` (credential handling inside the routine), ownership unproven, token is full-scope | **ABSOLUTE**: `POST /transactions` (cash-out), `POST /checkouts`, `POST /checkouts/{id}/cancel`, `POST /claims`, `POST /claims/{id}`, `POST /br|cl|bo/transactions/outbound` | E15, E16 |
| **Cashfree Payouts** `GET https://payout-api.cashfree.com/payout/v1/getBalance` (`/payout/v1.2/getBalance`) | Documented read. **Not permitted today**: host not allowlisted, needs a `Bearer` token minted by a POST, ownership unproven | **ABSOLUTE**: `POST /payout/v1/authorize` (token minting), any `/payout/v1|v1.2|v2/` transfer / createBeneficiary / refund path | E17 |
| **Provider status pages** (liveness metadata only) | `GET https://status.cashfree.com/` (200, `PRIOR PASS`); `https://status.hg.cash/` does not resolve (`PRIOR PASS`) | n/a | `PRIOR PASS` (not re-probed) |
| **Docs / robots / ToS pages** (design-time reads) | `GET https://freecash.com/robots.txt`, `/en/policies/terms`, `/sitemap.xml`; `docs.hg.cash/*`; `www.cashfree.com/docs/*` — public, no account data | n/a | E09–E17 |

**Net boundary consequence:** the routine's allowlist contains exactly **two loopback paths and no provider path**, and that is the correct state (E03, E18). Any future provider entry requires (1) a proven account link, (2) a credential held and minted **outside** the routine, (3) a one-line commented allowlist change plus the tripwire test at `tests/test_r2_readonly.py:121-127` updated in the same commit. Until then `PROVIDER_ENDPOINT_UNKNOWN` stays.

---

## 4. Ranked data-source options for THIS machine (four required fields each)

*Time-to-Revenue = elapsed time until the routine can put a real, human-actionable change signal in front of the operator. The routine itself can never earn (U1).*

### O1 — Operator-entered JSON (`state/operator-state.json`, source kind `operator_entered`) — **RANK 1 / RECOMMENDED / RESOLVED**
- **Expected Effort:** 0 h build (implemented: `operator_state.read_source`, `DEFAULT_SOURCE="operator_state"`); ~2–5 min/operator/day; +1 h to write the terminal-resolution note.
- **Time-to-Revenue:** **Same day** — the first typed record satisfies U3 immediately. Proven this pass on a throwaway root: `INITIAL_BASELINE` → snapshot with real fields (E19).
- **Dependencies:** operator discipline (one record per local day key); the operator's own browser login (human use only); the frozen state root `D:/AgenticOS/data/freecash-monitor`. No credential, no socket, no provider contact.
- **First Concrete Action:** append one record for `2026-10-02` to `D:\AgenticOS\data\freecash-monitor\state\operator-state.json` (its `records[]` is empty, E06) with the four figures copied by hand from the operator's own dashboard.

### O2 — Loopback AgenticOS read route (`--source metrics_http`) — **RANK 2 / CONDITIONAL (health probe only, never account truth)**
- **Expected Effort:** 0.5 h to point the routine at it, **3–5 h builder** to make anything serve the paths (no route exists in `server/src`, nothing on :3001, E18).
- **Time-to-Revenue:** **NONE for account truth** — by construction it returns local workstation/AgenticOS metrics; every snapshot stays `degraded: true`. Cannot move visibility by one minute.
- **Dependencies:** a process serving exactly `/api/v1/status/metrics` and `/api/v1/status` (absent today); a rule preventing the monitor from depending on a desktop app being open.
- **First Concrete Action:** `curl -sS -o /dev/null -w 'code=%{http_code}\n' --max-time 5 http://127.0.0.1:3001/api/v1/status/metrics` — currently `000` (exit 7). Only a 200 containing the four fields would justify wiring it as anything but a health probe.

### O3 — Passive provider-mail / receipt parsing (read-only IMAP) — **RANK 3 / NOT AVAILABLE TODAY (best next move)**
- **Expected Effort:** Medium — mailbox wiring + per-template parsers + a redaction pass (secrets never stored).
- **Time-to-Revenue:** **Days** — and it is a *post-hoc* signal (a receipt arrives after the fact), never a live balance.
- **Dependencies:** a mailbox the operator forwards provider mail to; read-only IMAP config (none exists on this host — `PRIOR PASS`); parser templates per provider.
- **First Concrete Action:** identify/create the mailbox and confirm **one** real provider email can be fetched read-only — `command -v himalaya` (currently absent, `PRIOR PASS`) is the gate check.

### O4 — Live provider read API: **HG.Cash** `GET /api/v1/accounts` — **RANK 4 / BLOCKED (conditional on operator ownership)**
- **Expected Effort:** 4–8 h builder **+ an explicit U1 allowlist widening** (host + path + the tripwire test) — but 0 h until ownership is confirmed.
- **Time-to-Revenue:** **3 days–2 weeks** if a KYC-complete HG.Cash account already exists; **2–6+ weeks** if onboarding is needed (contact form → KYC → approval). And the figure would be a LATAM operator payout-rail balance, not a FreeCash earnings balance.
- **Dependencies:** (a) written operator statement that the monitored balance *is* an HG.Cash account balance; (b) a token kept strictly outside the repo — note that token **also authorises cash-out `POST /transactions`** (E16); (c) the U1/U4 decision on an unscoped credential; (d) one human-performed `GET` recorded before any code.
- **First Concrete Action:** operator answers the ownership question, then performs exactly one `GET https://hg.cash/api/v1/accounts` with their own token in their own shell, recording **only** the HTTP status code and response **field names** (every value `[REDACTED]`). Nothing is sent by research.

### O5 — Live provider read API: **Cashfree Payouts** `GET /payout/v1/getBalance` — **RANK 5 / BLOCKED (weakest)**
- **Expected Effort:** 4–8 h builder + 1–3 h operator + a preceding U1/U4 decision; the design must be "operator mints the token out-of-band, the routine consumes it with a bare `GET`".
- **Time-to-Revenue:** **1–4 weeks**, gated by Payouts activation (documented unentitled state `403 "APIs not enabled…"`); unbounded if refused. Yields a **merchant disbursement balance**, tied to nothing in this repo.
- **Dependencies:** Payouts-enabled merchant account; `X-Client-Id`/`X-Client-Secret` (2FA-generated, IP-whitelisted); a daily human token-minting step through `POST /payout/v1/authorize` — a verb `ALLOWED_METHODS={"GET","HEAD"}` refuses by construction (E03, E17); a `Content-Type` header the current `request()` signature does not expose.
- **First Concrete Action:** operator opens the Cashfree merchant dashboard → records **whether a Payouts-enabled key already exists**. No command, no credential handling by this pass.

**Explicitly rejected (do not build):** scripted browser/session automation against freecash.com — ToS forbids "any robot, spider or other automatic device … for any purpose, including monitoring" and separately forbids manual monitoring without written consent (E12), and a ban forfeits unredeemed rewards (E12).

### 4.1 Data-source decision (resolved)
- **Authorised source today: O1** (operator-entered JSON), snapshots honestly labelled `degraded: true` / `source.kind=operator_entered`. Zero ToS exposure, zero credential, zero socket — and it is the only source that can produce a comparable daily figure today (E19).
- **O2 permitted** as a loopback health probe only; **never** presented as account status.
- **O3** is the recommended *next* build after O1 is fed.
- **O4/O5 remain BLOCKED** pending an operator ownership statement + an explicit U1/U4 credential decision.
- **`PROVIDER_ENDPOINT_UNKNOWN` stays** (documentation-only re-label, action A3).

---

## 5. UNPROVEN claims in the existing plans/skills — and the command that settles each

| # | Unproven claim | Where it lives | Why it is not evidence | Command that settles it |
|---|---|---|---|---|
| P1 | "FreeCash.io `GET /withdrawals` is a public read-only API using `X-API-Key`" | Hermes skill `optional-skills/serverops/automated-status-monitor/references/api-compliance.md:12,64-67` | Contradicted by E13 (parked domain) and E14 (third-party wrapper, no account data) | `curl -sS -L https://freecash.io/llms.txt` → expect `571` B "listed for sale on GoDaddy" |
| P2 | "HG.Cash `GET /accounts` is live and answering" | `PROVIDER-DECISION-PACKET-2026-09-20-v2.md` F21 (`PRIOR PASS`) | Not re-observed; a 401 proves a route exists, not entitlement | (operator-owned token, outside this routine) `curl -sS -H "Authorization: Bearer ***" -o hg_accounts.json -w '%{http_code}\n' https://hg.cash/api/v1/accounts` then redact |
| P3 | "Cashfree `getBalance` is live and entitled" | same packet, F28 (`PRIOR PASS`) | Prior `403` was an `awselb/2.0` edge page, not the documented app JSON | `curl -sS -H "Authorization: Bearer ***" -w '%{http_code}\n' https://payout-api.cashfree.com/payout/v1/getBalance` (token out-of-band; redact) |
| P4 | "StartWhenAvailable catches up a plain daily trigger" | `PROVIDER-DECISION-PACKET-2026-09-20-v2.md` §6 | MS scopes the property to tasks "with an end boundary or … repeat infinitely" | one throwaway task with a past-due daily trigger + `wevtutil qe Microsoft-Windows-TaskScheduler/Operational` (requires task creation = U4) |
| P5 | "The desktop toast delivers on this host" | `DATASOURCE-PLAN.md` V12 (stub only) | Delivery label was `STUB_OK`, never `TOAST_OK` | `FREECASH_TOAST_STUB= FREECASH_DATA_ROOT=<scratch> venv/python monitoring/freecash/run_daily_check.py` (needs operator present) |
| P6 | "52/52 tests pass, so the gate is trustworthy" | `DELEGATION-BRIEF-R2.md` P9 | A gate that fails ~1 run in 4 is not trustworthy; a PASS is evidence only with the raw run | `for i in 1 2 3 4; do venv/python monitoring/freecash/tests/run_all.py; done` and record each exit + tail |
| P7 | "`verify-freecash-rules.mjs` certifies the four rules" | `server/scripts/verify-freecash-rules.mjs` | E20: it prints `4/4 PASSED` (exit 0) on `freecash-daily-monitor.mjs`, which fails `node --check` | `node --check server/scripts/freecash-daily-monitor.mjs; echo $?` then `node server/scripts/verify-freecash-rules.mjs; echo $?` |
| P8 | "`config/freecash-crontab` schedules the check" | `config/freecash-crontab` | It points at `scripts/make_freecash_check.py`, a stub that never calls `main()`; no cron host owns it | `cat config/freecash-crontab` then `venv/python scripts/make_freecash_check.py; echo $?` |
| P9 | "The routine has a live reading (not degraded)" | `data/freecash-monitor/snapshots/2026-10-01.json` | `degraded: true`, all four fields `null` (`PRIOR PASS`, superseded by E05/E06) | `cat data/freecash-monitor/snapshots/2026-10-01.json` |
| P10 | "Cashfree per-endpoint numeric rate limits" | `RESEARCH-PLAN.md` F27 | The fetched page states policy, not numbers in extractable text | `curl -sS -L https://www.cashfree.com/docs/llms.txt | grep -i -A2 'rate-limit'` |
| P11 | "HG.Cash token can be read-scoped" | `PROVIDER-FINDINGS-REVERIFIED.md` | No scopes exist in the OpenAPI; the token also signs cash-out (E16) | `curl -sS -L https://docs.hg.cash/api-reference/openapi.yaml | grep -n -A3 'securitySchemes'` |
| P12 | "`metrics_http` can be a status source" | `run_daily_check.py` `SOURCES` | E18: 3001 refused; 4600 returns 404 for both allowlisted paths | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/v1/status/metrics` |

---

## 6. Prioritized next-action list (single first command per item)

| # | Pri | Action | First concrete command |
|---|-----|--------|------------------------|
| A1 | **P0** | Ask the operator the one blocking question: *which platform holds the monitored balance, and can a read-only credential be issued for it outside this repo?* — record the answer as a new artifact, act on nothing | `echo "provider=____ owner=____ read_only_credential_possible=y/n"` |
| A2 | **P0** | Feed O1: append one operator-entered record for the next local day key (today's is spent, E07) | `cat data/freecash-monitor/state/operator-state.json` (inspect), then append the `2026-10-02` record |
| A3 | **P1** | Re-label `PROVIDER_ENDPOINT_UNKNOWN` from TODO to evidence-backed terminal state (comment + citation only; documentation edit) | `grep -n "PROVIDER_ENDPOINT_UNKNOWN" monitoring/freecash/readonly_client.py` |
| A4 | **P1** | Correct the false FreeCash.io row in the Hermes skill (P1) with a refutation banner | `curl -sS -L https://freecash.io/llms.txt` |
| A5 | **P1** | Decide U1/U4 policy for a non-read-scoped provider credential **before** any provider option is built | `sed -n '37,49p' monitoring/freecash/readonly_client.py` |
| A6 | **P1** | Quantify the flaky suite (P6) so the gate is trustworthy | `for i in 1 2 3 4; do venv/python monitoring/freecash/tests/run_all.py; echo "exit=$?"; done` |
| A7 | **P1** | Re-point or quarantine `config/freecash-crontab` (points at a stub; the stub builds a `withdraw` action) | `grep -n 'withdraw' scripts/make_freecash_check.py` |
| A8 | **P2** | Build O3 (read-only IMAP provider-mail source) once a mailbox exists | `command -v himalaya || echo NO_MAIL_CLIENT` |
| A9 | **P2** | Close the toast-delivery gap (P5) with the operator present, throwaway root | `FREECASH_TOAST_STUB= FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-toast-proof/state" venv/python monitoring/freecash/run_daily_check.py` |
| A10 | **P2** | Produce (never register) the scheduler task XML for human approval — arming is itself U4 | `schtasks /Query /FO CSV /NH | grep -ic freecash` (expect `0`) |

**Ordering rationale:** A1 blocks every provider option; A2 unblocks U3 today at zero cost; A3/A4/A5/A6/A7 raise evidence quality without touching any account and can run now.

---

## 7. Sandbox proof + compliance record

**Production root `data/freecash-monitor/` — hash pair, before and after this pass:**
```
before: a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  state/last-run.json
        1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts/alerts.jsonl
after : a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  state/last-run.json
        1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts/alerts.jsonl
→ IDENTICAL
```
```
$ find data/freecash-monitor -type f -newermt "2026-10-01 00:00" -printf '%T+ %p\n' | sort
2026-10-01+08:53:46.6922555000 data/freecash-monitor/state/day-locks/2026-10-01.lock
2026-10-01+08:53:46.7001916000 data/freecash-monitor/snapshots/2026-10-01.json
2026-10-01+08:53:46.7047175000 data/freecash-monitor/alerts/alerts.jsonl
2026-10-01+08:53:46.7184158000 data/freecash-monitor/state/last-run.json
→ 4 files, all at 08:53:46 (the pre-existing production run). This pass added ZERO.
```
Every local run this pass used `FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/fc-research-r2/state` (throwaway), confirmed by `paths.data_root()` in the run output. No git write verb. No scheduled task created. No credential read, typed or written. No provider/account endpoint called — only public docs/robots/ToS pages and loopback.

## 8. What this pass did NOT do, and why
- **No provider account call, no auth, no login** — the documented account endpoints were never contacted, even unauthenticated (`hg.cash/api/v1/accounts`, `payout-api.cashfree.com/payout/v1/*`). Reachability stated in §2 is host/docs-level only.
- **No secret read/printed/written.** No `.env` was inspected this pass; no value appears here.
- **No `/fc-api/` probe** — robots.txt disallows it (E11), so it was deliberately not fetched.
- **No scheduler, no arming, no notification sent.**
- **No edit outside `docs/…/DELEGATION-2026-10-01-R2/research/`.**

## 9. Open questions (see `QUESTION-REGISTER.json` for the machine-readable register)
1. Which platform holds the monitored balance? (operator-held; no public source resolves the internal name — E1.2/§1.2)
2. Is a read-only credential issuable outside the routine, and does the operator accept a non-read-scoped credential at all? (policy, not research)
3. Will the operator accept O1 as the permanent read source? (the one decision that unblocks U3 today)
4. Does an approved, KYC-complete HG.Cash / Payouts-enabled Cashfree account exist? (operator-held)
5. Which notification sink reaches the operator — the toast is still unproven (P5)?

## 10. Sources read this pass
Public reads (unauthenticated `GET`, status/size observed at fetch time): `freecash.com/robots.txt` (200, 298 B) · `freecash.com/sitemap.xml` (200, 796 B) · `freecash.com/docs` (404) · `/developers` (404) · `/api` (200, 540 263 B marketing) · `/api/v1` (404) · `freecash.com/en/policies/terms` (200, 420 307 B) · `freecash.io/` (200, 114 B) · `freecash.io/llms.txt` (200, 571 B) · `freecash.io/sitemap.xml` (200, 155 B) · `freecash.io/lander` (403 GoDaddy) · `docs.hg.cash/api-reference/openapi.yaml` (200, 92 028 B) · `docs.hg.cash/api-reference/accounts/get-user-accounts.md` (200) · `www.cashfree.com/docs/llms.txt` (200, 91 747 B) · `www.cashfree.com/docs/api-reference/payouts/v1/get-balance.md` (200) · `parse.bot/marketplace/…/freecash-io-api` (200) · loopback `localhost:3001|4600` probes.
Repo/skill reads (not modified): `monitoring/freecash/readonly_client.py`, `operator_state.py`, `run_daily_check.py`; `server/src/adapters/freecashMonitorAdapter.ts`; `server/scripts/{freecash-daily-monitor.mjs,verify-freecash-rules.mjs}`; `data/freecash-monitor/*`; Hermes skill `optional-skills/serverops/automated-status-monitor/references/api-compliance.md`.
Prior art read as context (never edited): `DELEGATION-2026-10-01-R2/PARENT-BRIEF.md`, `DELEGATION-BRIEF-R2.md`, `DELEGATION-2026-10-01/RESEARCH-PLAN.md`, `PROVIDER-DECISION-PACKET-2026-09-20-v2.md`, `DELEGATION-2026-09-30/datasource/DATASOURCE-PLAN.md`, `.hermes/scratch/freecash/provider-research.md`, `artifacts/freecash-monitor-plan/02-provider-research.md`.

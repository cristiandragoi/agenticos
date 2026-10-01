# Free Cash Finance Automation — Daily Monitor: Research Plan v2

**Question this plan answers:** *read-only, with no credentials, which data sources may legitimately feed the daily status monitor, and under what constraints?*

| Field | Value |
|---|---|
| Repository / branch | `D:/AgenticOS` · `hermes-rescue-20260908` |
| Written | 2026-09-20 (Europe/Berlin), operator-local day key `2026-09-20` |
| Supersedes | `docs/freecash-monitor-research-plan.md` (v1) — as a *research plan* only. v1's evidence is inherited where re-verified and marked stale where not (§1.3). |
| Inherits, does not restate | `docs/freecash-monitor-audit-evidence.md`, `docs/free-cash-monitor-routine/PROVIDER-FINDINGS-REVERIFIED.md`, `.../PROVIDER-DECISION-PACKET-2026-09-20.md`, `.../ROUTINE-DESIGN.md` (design contract), `.../DELEGATION-2026-09-20-R2/RESEARCH-PLAN.md` (blocker statement) |
| Artifact created by this pass | this file only |
| Network performed by this pass | **zero provider hosts contacted.** Two *documentation* sites were fetched to re-verify published API contracts (`docs.hg.cash`, `www.cashfree.com/docs`) — doc sites, no credential, no provider API host. `freecash.com` was deliberately **not** fetched (§9.2) |
| No credential used, requested, typed or stored | `[REDACTED]` everywhere; env inspection read **variable names only** |
| Git status fingerprint before write | `git status --short \| sort \| md5sum` → `8043ce4bde3006a060a2e8d3b86810df` (**532 entries**) |

## Evidence tags used throughout

| Tag | Meaning |
|---|---|
| `[EXEC]` | **verified by execution** in this pass — a command was run here and its real output is quoted |
| `[SRC]` | **read from source** — file content read in this pass, not executed |
| `[CARRIED]` | a prior pass's evidence, URL/artifact named, **not** re-performed here. Not re-derived ⇒ not upgraded |
| `[UNVERIFIED]` | asserted by something in the repo or by an external page, confirmed by nothing |

---

## 1. Purpose and the four rules as research constraints

### 1.1 Purpose (one paragraph)

This plan exists to settle, **without touching a provider, a credential or an account**, *which read sources may legitimately supply one daily status figure set to the Free Cash daily monitor, and under what constraints* — because the monitor's only live defect is that it has a compliant read path but no populated one (`data/freecash-monitor/state/operator-state.json` → `"records": []` `[EXEC]`). v2's job is narrow on purpose: it re-verifies the current state of every candidate source against live evidence rather than trusting v1, ranks what remains genuinely unknown by whether it is load-bearing, prices the cheapest experiment that resolves each unknown, and proposes a host+method+path allowlist/denylist that can be mechanised. It is not a build plan and it authorises no code change.

### 1.2 The four rules restated as *research* constraints

| Rule | Stated as | Consequence for this research |
|---|---|---|
| **R1** — no automated earning action | The research may not propose, design, or prototype any path that earns, claims, redeems, transfers, withdraws, or completes an offer/task. | Every candidate source is judged on *read* fitness only; a source that is only useful together with a write action is rejected outright, not "gated". |
| **R2** — exactly one status read per operator-local calendar day | The research may not perform a second status read of any kind on an already-consumed day, and may not recommend a design that can produce two reads in one local day. | Today's lock exists → **no read may be attempted today** (§2.0, BLOCKED-5). Any source that requires polling, retries or a catch-up read is disqualified. |
| **R3** — notify on earnings/account-status change | The research must identify, per source, which fields *are* "earnings changed" and which *are* "status changed", and must not claim change-detection for a source that publishes neither. | A source is only useful to R3 if it publishes both a money field **and** a lifecycle/status field, or if the plan states plainly that it cannot satisfy half of R3 (§6). |
| **R4** — human approval before any external action | Reading is not acting; the research itself is not exempt from asking before it causes *any* external effect (a message send, a signup, a task registration, a credential). | Experiments that would create an external effect are **listed, not run** (e.g. verifying the notification channel, RQ-5). |

### 1.3 What changed since v1 — stale / superseded / advanced register

v1 (`docs/freecash-monitor-research-plan.md`) is not restated here. These are the specific v1 claims that are now **wrong, incomplete, or overtaken**, each with the evidence that moved it.

| # | v1 claim (with its section) | v2 status | Evidence that moved it |
|---|---|---|---|
| S1 | §0: *"`api.freecash.com/v1/status` … the only provider hostname hardcoded in executable code"* | **STALE — incomplete.** Three provider hostnames are now in executable/code-adjacent files, and one of them is far more consequential than the dead 404 | `[EXEC]` repo-wide grep: `server/src/services/freeCash/freeCashExecutor.ts:39-40` (`https://freecash.com/en`, `/en/signin`), `server/scripts/freecash-daily-monitor.mjs:32`, `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/scratch/reference-monitor.mjs:38` |
| S2 | §0/§2.2: browser-automation or scrape paths against freecash.com are denied | **STALE as a safety claim.** The denylist *names* them, but nothing enforces it: `verify_readonly.py` scans only `monitoring/freecash/`, and a wired, restart-durable automation path to freecash.com exists elsewhere in the repo | `[EXEC]` `verify_readonly.py` → `forbidden=0 exempt=28` while §2.4 rows 1–7 stand; `[SRC]` `server/src/index.ts:398`, `adapters.ts:1681` |
| S3 | §0: the monitor's tests are red (*"17 of 52 not passing"*, via the audit's `failures=6 errors=11`) | **SUPERSEDED.** Today the suite and the static scanner are both green | `[EXEC]` `run_all: tests=52 failures=0 errors=0 skipped=0` (exit 0); `[verify_readonly] forbidden=0 exempt=28 missing_targets=0 … PASS` (exit 0) |
| S4 | §1: freecash.com `robots.txt` disallows `/fc-api/`, `/user/`, `/myprofile/`, `/dev-playground/` | **INCOMPLETE.** The fetched file also disallows `/r/`, `/_next/`, `/_ipx/`, `/offer/`, `/scd-cgi/`, `/w/`, `/*mailto:*` | `[CARRIED]` `https://freecash.com/robots.txt` (complete file reproduced in `PROVIDER-FINDINGS-REVERIFIED.md` Q1.3) |
| S5 | §1: HG.Cash account `status` enum values **UNKNOWN** ("do not write a status map against unverified strings") | **RESOLVED.** The enum is published: `Operativa`, `Bloqueada`, `Cerrada` | `[EXEC]` this pass re-fetched `https://docs.hg.cash/api-reference/accounts/get-account-balance.md` → `status: enum: [Operativa, Bloqueada, Cerrada]` |
| S6 | §1/§5 U6: Cashfree `getBalance` v1.2 path and token TTL | **HALF-RESOLVED.** The v1.2 path and its `paymentInstrumentId` param are documented (re-read here). **Token TTL remains UNKNOWN** — and it is the one fact that decides AMB-1 | `[EXEC]` `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12`; TTL → RQ-7 |
| S7 | §1: Cashfree's unentitled response is HTTP 403 `"APIs not enabled…"` | **CORRECTED.** An unauthenticated probe gets an **edge** 403 HTML (`awselb/2.0`) — neither the documented JSON nor the documented 412 for a missing token. The `"APIs not enabled"` string is **documented, never observed** | `[CARRIED]` `PROVIDER-FINDINGS-REVERIFIED.md` Q3.7 |
| S8 | §3.2: the *"minimum-risk option that satisfies all four rules TODAY"* is the operator-mediated manual read | **ADVANCED, not stale.** It is no longer a proposal — it is the deployed configuration, and today's run proves it (and proves it produces `degraded` snapshots with null fields) | `[EXEC]` §2.0 rows 1–6; `[SRC]` `operator_state.py` |
| S9 | §4's signal map treats `degraded` as a labelling policy | **SHARPENED.** `degraded` is a **hard-coded literal**, so a future verified source could not be represented as verified | `[SRC]` `changedetect.py:168`, `run_daily_check.py:98` |
| S10 | §5's unknowns U1–U12 | **PARTLY SUPERSEDED by v2 §5's RQ-1…RQ-12.** U1→RQ-1, U5→RQ-3, U6→RQ-7, U7→RQ-7, U9→RQ-2, U12→RQ-10. U2, U3, U4, U10, U11 remain open but are no longer top-ranked. **New in v2:** RQ-4 (the wired freecash.com automation path) and RQ-5 (the untested notification channel), neither of which v1 raised | §5 |
| S11 | v1's claim that no provider key names exist in `.env` | **TRUE but INCOMPLETE.** True of the repo `.env`; v1 did not examine the **Hermes** `.env`, which carries the push channel R3 needs | `[EXEC]` §2.0 rows 11–12 (names only) |

---

## 2. Verified current state of every candidate data source

### 2.0 The state root and what "today" looks like

| # | Fact | Evidence | Tag |
|---|---|---|---|
| 1 | The routine ran today and reported `MONITOR_DEGRADED`; the day lock is **consumed** | `data/freecash-monitor/state/last-run.json` → `last_attempt_day 2026-09-20`, `last_success_day 2026-09-20`, `last_outcome MONITOR_DEGRADED`, `timezone Europe/Berlin` | `[EXEC]` |
| 2 | `data/freecash-monitor/state/day-locks/2026-09-20.lock` exists (0 bytes, 21:08) | `ls -la data/freecash-monitor/state/day-locks/` | `[EXEC]` |
| 3 | The lock is an atomic exclusive create — a second same-day read is refused *by construction* | `monitoring/freecash/gate.py:119-128` → `os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)` | `[SRC]` |
| 4 | Today's snapshot has all four money fields `null`, the empty-body hash, `degraded: true` | `data/freecash-monitor/snapshots/2026-09-20.json` → `raw_response_sha256 e3b0c442…b855` | `[EXEC]` |
| 5 | `alerts.jsonl` holds exactly two lines, both today: `MONITOR_DEGRADED` then `SKIP_DUPLICATE_DAY` | `cat data/freecash-monitor/alerts/alerts.jsonl` | `[EXEC]` |
| 6 | **No approval item has ever been created** — R4 has never had to fire | `data/freecash-monitor/approvals/pending.json` → does not exist | `[EXEC]` |
| 7 | Nothing is scheduled to run this monitor | `hermes cron list` → "No scheduled jobs." · `schtasks /query` grep `freecash\|finance` → **no matching scheduled task** | `[EXEC]` |
| 8 | The loopback metrics source is dead, not merely idle | `netstat` → **no listener** on `:3001`, `:4600`, `:5000`, `:8080`; `[CARRIED]` `DELEGATION-2026-09-20-R2/RESEARCH-PLAN.md:184-186` → three `curl: (7) Failed to connect to localhost:3001` | `[EXEC]` + `[CARRIED]` |
| 9 | No credential row exists for any provider | `sqlite3 server/data/agentic-os.db` (opened `mode=ro`) → `provider_credentials` = **0 rows**; columns include `provider_id, api_key, configured, masked_preview, validation_status` (no value read) | `[EXEC]` |
| 10 | Four schedules exist; **none is this monitor** | same read-only DB query → `schedules` = 4 rows: `0 9 * * *` (legacy_skill), `0 8 * * *`, `0 8 * * 1`, `*/5 * * * *` (`routine-revenue-supervisor`) | `[EXEC]` |
| 11 | No provider env var exists in the repo `.env` | key names only: `JARVIS_SUPERVISOR_V2, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_FALLBACK_MODEL, DEFAULT_LLM_PROVIDER, DEFAULT_LLM_MODEL, GATEWAY_PROVIDER_ORDER` | `[EXEC]` |
| 12 | The **Hermes** `.env` (`%LOCALAPPDATA%\hermes\.env`) *does* carry a push channel — names only | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`, `TELEGRAM_HOME_CHANNEL` present; no `NTFY*`, `SLACK*`, `SMTP*`, `MAIL*`, `IMAP*` | `[EXEC]` |

### 2.1 Candidate A — `operator_entered` (the operator's own dashboard reading, typed locally)

| Aspect | State | Evidence | Tag |
|---|---|---|---|
| Implemented? | Yes — `monitoring/freecash/operator_state.py`; `DEFAULT_SOURCE = "operator_state"`, `SOURCES = ("operator_state", "metrics_http")` | `run_daily_check.py:52-53` | `[SRC]` |
| Opens a socket / holds a credential? | **No** — `READ_OPS = []`; module docstring: "It opens no socket, requests nothing, and holds no credential." | `operator_state.py:1-14,46` | `[SRC]` |
| Populated today? | **No** — `"records": []` | live file, quoted §2.0 row 4 | `[EXEC]` |
| Exact-match day semantics | Only a record whose `day_key == today` is used; a stale record is never carried forward | `operator_state.py:104-116,127-139` | `[SRC]` |
| Field shape (the four figures R3 needs) | `account_status, earnings_total_cents, balance_cents, pending_cents, currency` + `day_key, entered_at_utc` | `operator_state.py:48-66` | `[SRC]` |
| Labelling honesty | Every snapshot built from it is `degraded: true` — and that is currently a **hard-coded literal**, not derived | `changedetect.py:168`; `run_daily_check.py:98` | `[SRC]` |
| Does it satisfy R1–R4? | R1 yes (human reads), R2 yes (day lock), R3 yes **if populated**, R4 trivially (the human *is* the read path) | §2.0 rows 1–3 | `[EXEC]`/`[SRC]` |
| Does it satisfy "provider-verified"? | **No.** A "no change" verdict from this source can never be presented as provider-verified | `changedetect.py:165-168` + the module's own docstring | `[SRC]` |

**Verdict:** the only source that is compliant *today*, and it is empty. This is the blocker, unchanged from v1 and from round 2.

### 2.2 Candidate B — `metrics_http` (AgenticOS's own loopback metrics route)

| Aspect | State | Evidence | Tag |
|---|---|---|---|
| Allowlist | `ALLOWED_METHODS = {GET, HEAD}`; `ALLOWED_HOSTS = {localhost, 127.0.0.1, ::1, [::1]}`; `ALLOWED_PATHS = ^/api/v1/status/metrics$, ^/api/v1/status$`; `DEFAULT_BASE_URL = http://localhost:3001`; `sys.addaudithook` aborts any non-loopback `socket.connect`/`getaddrinfo`; one socket site (`_transport`) | `readonly_client.py:39,41,43-49,54,76,146-176` | `[SRC]` |
| Served by anything? | No — nothing listens on `:3001` | §2.0 row 8 | `[EXEC]` |
| Does it read the account? | **No.** Its own header calls it "local substitute metrics (degraded)" | `readonly_client.py:16-25` | `[SRC]` |
| Would it lie if it were up? | Yes — the `metrics_http` branch hard-codes `"data_available": True` **before** the HTTP read is attempted | `run_daily_check.py:66-76` | `[SRC]` |

**Verdict:** not a candidate. Standing it up would manufacture a `data_available: True` on numbers that never touched the account — the silent-false-confidence failure. **Rejected, not deferred.**

### 2.3 Candidate C — a provider read API

| Provider | Account exists? | Documented read endpoint | Reachable without credential? | Tag |
|---|---|---|---|---|
| **freecash.com (Almedia)** | unknown to this repo | **none published** | n/a — automated access prohibited (§3) | `[CARRIED]` + `[EXEC]` (repo grep) |
| **HG.Cash** | **unknown — no evidence of an account** | `GET /accounts`, `GET /account/{id}/balance` | **No** — 401 `{"error":"Missing or invalid authorization header. Expected: Bearer <token>"}` | `[CARRIED]` `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md` + `[EXEC]` (I fetched the doc, not the API) |
| **Cashfree Payouts** | **unknown — no evidence of an account** | `GET /payout/v1/getBalance`, `GET /payout/v1.2/getBalance` | **No** — unauthenticated probe returns an edge 403 HTML, not the documented JSON | `[EXEC]` (doc fetched) + `[CARRIED]` |
| **freecash.io** | n/a — not a platform | none | n/a | `[CARRIED]` |
| **finance-monitor/** (in-repo package) | n/a | produces **mock** balances | n/a | `[CARRIED]` v1 §0 |
| **`api.freecash.com/v1/status`** | n/a | repo-recorded **404**; **not re-probed here** (probing a provider host is forbidden by this pass's constraints) | n/a | `[CARRIED]` |

### 2.4 Candidate D — the browser-automation path **already in the repo** (v1 did not know this)

This is the material delta from v1, and it is a compliance fact, not a convenience.

| # | Fact | Evidence | Tag |
|---|---|---|---|
| 1 | A live integration navigates a real browser to freecash.com | `server/src/services/freeCash/freeCashExecutor.ts:39-40` → `const FREECASH_HOME = 'https://freecash.com/en'`, `const FREECASH_SIGNIN = 'https://freecash.com/en/signin'` | `[SRC]` |
| 2 | It reads freecash.com cookies from the managed profile | same file `:82-89` → `page.context().cookies('https://freecash.com')`, then tests `/^(__session\|fc_session\|session\|jwt\|access_token\|auth)/i` | `[SRC]` |
| 3 | It is wired into **server startup** | `server/src/index.ts:398` imports `reconcileGoalsOnStartup` and calls it at boot with `void …catch(…)` | `[SRC]` |
| 4 | It is wired into **background tasks** | `server/src/services/backgroundTasks/adapters.ts:1681` calls `checkAuthenticatedSession()` / `inspectAvailableWork()`; the guard before it is only `evaluateExecutionGate` (auth prerequisite), not an R1/R4 gate | `[SRC]` |
| 5 | It auto-resumes the original goal after login detection | `startInteractiveLogin()` → on `authenticated`: `markResumePending(...)` then `await resumePendingGoals()`, whose comment reads "Resumption executes the ORIGINAL goal via operateProject — never asks the user again" (`:337-388`) | `[SRC]` |
| 6 | HTTP routes exist for it | `server/src/routers/projects.ts:391-447` → `GET/POST /:projectId/freecash/auth`, `POST …/auth/login`, `POST …/auth/verify`, `POST …/auth/clear` | `[SRC]` |
| 7 | Headless session probing is the default for `checkAuthenticatedSession()` | `freeCashExecutor.ts:178` → `{ headless: true }` | `[SRC]` |
| 8 | v1's denylist already *names* "every browser-automation or scrape path" against freecash.com | `docs/freecash-monitor-research-plan.md` §2.2 denylist | `[SRC]` |
| 9 | But that denylist is **not mechanised for this path**: `monitoring/freecash/verify_readonly.py` scans `monitoring/freecash/` only (see its own hit list, all under that tree) — nothing in it or in CI inspects `server/src/services/freeCash/` | `python verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0` while §2.4 rows 1–7 stand | `[EXEC]` |
| 10 | Behind a runtime flag, not enabled here | `headlessForLogin()` reads only `AGENTICOS_FREECASH_HEADLESS`; no listener on the app ports today (§2.0 row 8) — so this is **dormant capability, every boot re-arms the resume pump** | `[SRC]` + `[EXEC]` |

**What this means for the research question.** R1–R4 govern *this monitor*. They do not govern `freeCashExecutor`, which is a separate, wired, restart-durable path that can drive a browser to a host whose terms prohibit automated access *including monitoring* (§3.1). Any allowlist that claims to make the entity compliant must either (a) contain that path by name, or (b) admit in writing that the claim is scoped to the monitor only. v1 chose the second implicitly. v2 states it explicitly (§4.3) and prices the containment (RQ-4, §5; O1, §8).

### 2.5 Candidate E — repo-internal "monitors" that are not sources (state re-verified, not carried)

| Artifact | Today's result | Tag |
|---|---|---|
| `server/scripts/freecash-daily-monitor.mjs` | **still does not parse**: `SyntaxError: Unexpected token ':'` at `:41`, node v24.20.0, exit 1 | `[EXEC]` |
| `server/scripts/verify-freecash-rules.mjs` | **still certifies it**: `4/4 passed`, exit **0** — a static string grep with no `process.exit(nonzero)`; the audit's mutation test (`POST /v1/withdraw` → still `4/4 passed`) is `[CARRIED]` `docs/freecash-monitor-audit-evidence.md` §2b | `[EXEC]` + `[CARRIED]` |
| `scripts/make_freecash_check.py` | **still broken**: `Error: [Errno 2] No such file or directory: 'D:\\data\\freecash\\state.json'`, `No actions available.`, **exit 1**; created nothing (`ls /d/data` → no such directory) | `[EXEC]` |
| `monitoring/freecash/` suite + static scan | **now green**: `run_all: tests=52 failures=0 errors=0 skipped=0` (exit 0); `[verify_readonly] forbidden=0 exempt=28 missing_targets=0 … PASS` (exit 0). The live state root was untouched (still 21:08) — the suite redirects via `FREECASH_DATA_ROOT` | `[EXEC]` |
| `server/src/adapters/freecashMonitorAdapter.ts` | `fetchStatus()` still returns the hardcoded literal `externalConnected: false, earnedToday: 0, statusAlerts: [], adapterHealth: 'healthy'`; still **not** in `runtimeRegistry` (`grep -in freecash server/src/services/runtimeRegistry.ts` → no match; `index.ts:141-145` registers Hermes/Jarvis/Codex/Video/HeavyGen only) | `[SRC]` + `[EXEC]` |
| `server/data/freecash-monitor/INTEGRATION_STATUS.md` | still claims a **"Rule Compliance Matrix ✅ … COMPLIANT"** for R1–R4 and cites the parse-broken `.mjs`, the park-`/developer` freecash.io wrapper (`parse.bot`) as provider option #1, and an invented `POST` phase 2 | `[SRC]` |

**Verdict:** five overlapping implementations (A–E in the audit's numbering) remain, only one of which runs. The documentation surface still asserts compliance for a file that does not parse; that claim is false as written and should not be inherited by any plan.

---

## 3. Provider capability matrix

Compliance quotes are **carried verbatim with their URLs** from `PROVIDER-FINDINGS-REVERIFIED.md` (a pass that did fetch them); this pass deliberately did not re-fetch freecash.com (§9.2). Endpoint/billing facts for HG.Cash and Cashfree were re-verified here against the vendors' own OpenAPI pages.

| Provider | Documented read-only endpoints | Write / money endpoints that must stay denied | Auth model | Compliance posture (quoted, with URL) | Confidence |
|---|---|---|---|---|---|
| **freecash.com** (Almedia GmbH) — consumer rewards; the repo's apparent target | **None published.** `/docs` → 302 → `/en/docs` 404; `/developers` → 302 → `/en/developers` 404 | n/a (no API). Dashboard actions only: cashout/redemption, offer completion, KYC | n/a — dashboard login, KYC/ID verification before first payout, 2FA expected | **Prohibited, twice over.** ToS §17 part 2 bullet 2: *"Use any robot, spider or other automatic device, process or means to access the Website **for any purpose, including monitoring** or copying any of the material on the Website."* §17.1: *"To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity…"* §16: *"personal, non-commercial use only"* / *"You must not access or use for any commercial purposes"*. §19: may *"suspend or void any Rewards"*. `robots.txt` **Disallow**: `/user/`, `/myprofile`, `/r/`, `/_next/`, `/_ipx/`, `/offer/`, `/fc-api/`, `/scd-cgi/`, `/w/`, `/dev-playground/`, `/*mailto:*`. URLs: `https://freecash.com/en/policies/terms` (last updated 2026-07-17), `https://freecash.com/robots.txt`, `https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned` | **HIGH** — `[CARRIED]`, verbatim in `PROVIDER-FINDINGS-REVERIFIED.md` Q1.1–Q1.4 |
| **freecash.io** | none | none | n/a | Not a platform: 114-byte JS redirect to `forsale.godaddy.com/forsale/freecash.io`. URL: `https://freecash.io/` | **HIGH** — `[CARRIED]`, `PROVIDER-FINDINGS-REVERIFIED.md` Q2 |
| **HG.Cash** | `GET /accounts` → `data[]` with `id, name, balance ("ledger balance rounded to 2 decimals"), pendingFees, netBalance ("balance minus pending fees"), currency, number, alias, platform{}, company{}, status` + `count`; `GET /account/{id}/balance` → `id, balance, currency, pendingFees, netBalance, status`; reference data; `GET /checkouts`, `GET /claims/{id}`, CVU/alias lookup | `POST /transactions` (**cash out**); `POST /checkouts` + cancel; `POST` inbound/outbound (BR/CL/BO); `POST /claims`; USDT withdrawal; withdrawal-wallet verify/sign | **Bearer**, format `cash_<64-char-hex>`, self-serve **inside an existing account**: docs say *"Generate your API token in the account settings page… All API calls must be made from secure backend services"*. Webhook signing = HMAC-SHA256 via `X-HG-Webhook-Signature` | No automation prohibition found in the OpenAPI page. **This pass re-verified the contract itself**: `status` is `enum: [Operativa, Bloqueada, Cerrada]`, base `https://hg.cash/api/v1` (prod) / `http://dev.hg.cash/api/v1` (dev), contact `api-support@hg.cash`. URLs: `https://docs.hg.cash/api-reference/accounts/get-account-balance.md`, `https://docs.hg.cash/api-reference/accounts/get-user-accounts.md` | **HIGH** for endpoints/enum/auth `[EXEC]`; **UNKNOWN** whether an account exists or is provisioned (KYC-gated per `[CARRIED]`) |
| **Cashfree Payouts** | `GET /payout/v1/getBalance`; `GET /payout/v1.2/getBalance` → `data.balance` (ledger) + `data.availableBalance` (*"ledger balance minus the sum of all pending transfers"*), optional `paymentInstrumentId` query param | `POST /payout/v1/authorize` (**token minting**); request/direct/standard/batch transfers; Cashgram create/redeem; OneEscrow allocate / initiate payout / internal transfer / whitelist bank account; beneficiary add | **Bearer**, minted via `POST /payout/v1/authorize` with `X-Client-Id` + `X-Client-Secret`; plus `X-Cf-Signature` (RSA of `clientId.<unix-ts>`) when the caller IP is not whitelisted. 2FA = IP whitelist + public key | Documented gate observed in the docs: 403 `"APIs not enabled. Please fill out the Support Form"`. **Corrected by the re-verified pass:** an unauthenticated probe returns an **edge 403 HTML** (`awselb/2.0`), *not* that JSON, and not the documented 412 for a missing token — so the application-level liveness is **not confirmed**. URLs: `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12` `[EXEC]` (fetched this pass), `.../v1/get-balance` `[CARRIED]` | **HIGH** for method/path/fields; **UNKNOWN** entitlement, token TTL, and whether an Indian merchant account exists |
| **Third-party `parse.bot` "Freecash API"** | markets `get_withdrawals`, `get_leaderboard`, `X-API-Key` | — | API key belongs to `parse.bot` | Self-described wrapper over public data for **freecash.io**, which is a parked for-sale domain. URL: `https://parse.bot/…/freecash-io-api` | **REJECT** — `[CARRIED]`; it is *cited as a provider option* in `server/data/freecash-monitor/INTEGRATION_STATUS.md`, which is itself evidence the doc must not be trusted |
| **`finance-monitor/`** (in-repo) | sandbox mock | — | none | Produces fake balances (`sha256_mocksomedaddress0x…`) | **REJECT** — `[CARRIED]` v1 §0, not re-run |
| **`api.freecash.com/v1/status`** | repo-recorded 404 | — | none | Neither documented nor reachable; **not re-probed** (BLOCKED-7) | **REJECT** — `[CARRIED]` |

---

## 4. Read-only allowlist and denylist proposal (host + method + path)

Design rule: **method is the primary gate, path the secondary, verb vocabulary the audit.** Any one firing is enough to deny. Deny-by-default; the allowlist is a closed enumeration, never a pattern.

### 4.1 The allowlist that is live today (complete, and it touches no provider)

| Method | Host | Path | Why it is safe | Status | Tag |
|---|---|---|---|---|---|
| GET | `localhost` / `127.0.0.1` / `::1` | `/api/v1/status/metrics` | loopback-only; audit hook blocks non-loopback connects | **present but dead** (nothing on `:3001`) — keep in code, do not build a server for it (§2.2) | `[SRC]` `readonly_client.py:41-49` |
| HEAD | `localhost` / `127.0.0.1` / `::1` | `/api/v1/status` | liveness only, no body, no state | present, dead | `[SRC]` |

That is the entire live allowlist. **It contains no provider host**, and that is correct, not a gap to close by guesswork: `readonly_client.py:60` carries the literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`.

### 4.2 Provider entries proposed **dormant** (one line each, added only when its precondition is met)

Each entry below is a *proposal conditioned on a named observation*, never a change to make now. Adding any of them widens the single process-wide R2 control, so the operator must amend it explicitly.

| # | Method | Host | Path | Precondition before the line may be added | Reason |
|---|---|---|---|---|---|
| P1 | GET | `hg.cash` | `/api/v1/accounts` | operator states HG.Cash is the provider **and** produced one observed `200` by hand | Returns the authenticated user's accounts with `balance`, `pendingFees`, `netBalance`, `status` — the only read that can serve both halves of R3 |
| P2 | GET | `hg.cash` | `/api/v1/account/{id}/balance` | same, and only if the multi-account response is too coarse | Adds the `Operativa/Bloqueada/Cerrada` enum per account |
| P3 | GET | `payout-api.cashfree.com` | `/payout/v1.2/getBalance` | operator states Cashfree is the provider, is entitled, and holds a long-lived token minted out-of-band | `balance` + `availableBalance`; **cannot** serve the status half of R3 (§6) |
| P4 | GET | `payout-api.cashfree.com` | `/payout/v1/getBalance` | as P3 | Legacy twin; add only if P3 is unavailable |

### 4.3 Denylist (fail-closed set — the monitor may never call these)

| Class | Members | Reason |
|---|---|---|
| Every non-GET/HEAD method | `POST`, `PUT`, `PATCH`, `DELETE`, any verb, any host | Fail-closed. No exception for "it only mints a token" (D1) |
| HG.Cash money paths | `POST /api/v1/transactions` (the "does not perform an on-chain/bank transfer" docstring describes the *pipeline*, not a safety property — it creates a transaction request, an obligation); `POST /api/v1/checkouts`; cancel-checkout; `POST /api/v1/claims`; BR/CL/BO inbound/outbound; USDT withdrawal; withdrawal-wallet verify/sign | Moves money or creates an obligation |
| Cashfree money paths | request/direct/standard/batch transfer; Cashgram create/redeem; OneEscrow allocate / initiate payout / internal transfer / whitelist bank account; beneficiary add | Moves money |
| Earning vocabulary (any host) | `claim, withdraw, withdrawal, cashout, cash_out, redeem, payout, pay_out, transfer, wager, bet, spin, deposit, purchase, checkout, submit_offer, complete_survey, complete_task, start_task, accept_offer, claim_reward, redeem_reward, request_payout, update_balance, set_balance, credit_account, debit_account` | Reward-earning or money-out action; already mechanised as token classes in `verify_readonly.py` `[SRC]` |
| **freecash.com in every form** | any method, any path (ToS §17.2 names *monitoring* itself); in particular the robots-disallowed `/fc-api/`, `/user/`, `/myprofile`, `/offer/`, `/w/`, `/scd-cgi/`, `/_next/`, `/_ipx/`, `/dev-playground/` | Prohibited by the provider's own terms; the downside is account restriction plus forfeiture of the balance being monitored |
| **Browser-automation / cookie-session paths against any provider host** | `server/src/services/freeCash/freeCashExecutor.ts`'s navigation, cookie-read and session-evidence functions; the goal-resume pump; the `/:projectId/freecash/auth*` routes **when used for automated (non-human) login or reads** | These are automated accesses to a host whose terms forbid them, and the resume pump acts without asking again (v2 finding, §2.4) |
| Non-allowlisted hosts | anything not enumerated in §4.1/§4.2 | `ALLOWED_HOSTS` stays an explicit set |
| Non-loopback `HEAD` | `HEAD` on a provider host | **v2 narrows v1**: a HEAD to a provider is still an automated request to that provider and buys no data. HEAD stays loopback-only |
| `GET /api/v1/transaction/{id}/receipt` (HG.Cash) | — | The docs say the receipt *"is generated and cached for subsequent requests"* — a GET with a server-side effect, and no rule needs it |
| `GET /api/v1/transaction/{id}/status` (HG.Cash) | — | **v2 tightens v1**: v1 allowlisted it as "optional". Settlement tracking is not required by R1–R4, so under least-privilege it is **denied until a rule demands it** |
| `POST /payout/v1/authorize` (Cashfree) | — | A POST that carries a `clientSecret` capable of minting payout sessions. **DENY**, regardless of the fact that it moves no money itself |

### 4.4 The one ambiguous case left standing (unchanged from v1, and it decides Cashfree)

**AMB-1 — `POST /payout/v1/authorize`.** It is the only POST in the matrix that does not move money, and it is exactly the POST the monitor would need *if* Cashfree tokens were short-lived. Classified **DENY** because carrying a client secret is a capability the monitor must not have. It stays resolved only by RQ-9 (token TTL): if a token minted once by hand outlives the monitoring period, `authorize` never enters the monitor and Cashfree becomes usable; if not, Cashfree is unusable for automation and HG.Cash is the only candidate.

---

## 5. Ranked open research questions

Ranking key: **(a)** how many other questions collapse if this one is answered, **(b)** whether the answer can change a decision already made, **(c)** cost. Every experiment below is an *operator* action or a *read-only* check. None was performed by this pass.

| Rank | ID | Question | Why it is load-bearing | Cheapest resolving experiment | Owner | Duration | Blocked if unanswered |
|---|---|---|---|---|---|---|---|
| **1** | **RQ-1** | **Which provider, if any, does this entity actually hold an account with?** (freecash.com, HG.Cash, Cashfree, several, none) | Decides which half of §3 and §4 applies. `provider_credentials` = 0 rows `[EXEC]`; nothing in the repo can answer it | One question to the operator: *"Which of these sends you payout emails / has a dashboard you can log into?"* No login, no credential, no network | Operator | 2 min | RQ-2, RQ-3, RQ-7, RQ-8, RQ-12, §6 rows for HG.Cash/Cashfree, decision DP-2 |
| **2** | **RQ-2** | **Does the operator accept the operator-mediated manual read as the permanent design, or is provider-verified automation a requirement?** | This is the only question that changes *what gets built*. If manual is accepted, the plan closes today at `degraded: true` with zero provider coupling; if not, the whole provider branch reopens and the entity carries a credential | One question. It is a decision, not a probe | Operator | 5 min | O2/O3 in §8, P1–P4 in §4.2, RQ-3, RQ-7 |
| **3** | **RQ-3** | **If HG.Cash: does an API token exist, and does one hand-run `GET /accounts` return 200?** | Resolves the endpoint *and* the `status` enum values *and* the rate-limit question in a single response, and is the only path to a non-degraded snapshot | Operator generates a token in account settings and runs **once, out-of-band, never from the monitor**: `curl -i -H "Authorization: Bearer ***" https://hg.cash/api/v1/accounts` (value `[REDACTED]`, never in chat, never in a repo file). Expected 200 with `data[]`; 401 if the token is wrong | Operator (with engineer reading only the status code + field names) | 10 min | P1/P2 adoption; the `degraded`-derivation fix has nothing to derive from |
| **4** | **RQ-4** | **Is the freecash.com browser-automation path (`freeCashExecutor`, its startup resume pump, and the `/:projectId/freecash/auth*` routes) to be contained, disabled, or knowingly accepted?** | Highest *risk* item in the plan and unknown to v1: it automates access to a host whose terms forbid automated access *including monitoring*, it survives restarts, and it resumes goals "never asks the user again" (§2.4). The monitor's own compliance claim is not credible while it stands unaddressed | Read the four call sites (`index.ts:398`, `adapters.ts:1681`, `projects.ts:391-447`, `freeCashExecutor.ts:337-388`) and answer three questions: is the accounts/goal path in scope for this initiative, who authorized it, and may it stay wired while the entity is ToS-sensitive? No execution | Operator decides; engineer supplies the read-only map | 30 min | Any statement that "the entity does not automate provider access"; §4.3's containment line; DP-3 |
| **5** | **RQ-5** | **Is the R3 notification channel actually live?** (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_HOME_CHANNEL` are present) `[EXEC]` | R3 is the whole point of the monitor. Today the routine's default channel is a **Windows balloon tip** via PowerShell (`notify.py:167-192`), and a headless/unattended run has no desktop to toast. The configured Telegram surface was never tested because testing it is a *send* | Operator authorizes **one** test send (this is an external write → R4 applies to the research too, so it is listed, not run). Alternative zero-send check: confirm with the operator that Hermes' own notification path delivers to it — no new secret needed | Operator | 2 min + one message | R3 confidence; O1's "notify" claim; any SLI on notification delivery |
| 6 | RQ-6 | Does the provider send a periodic balance/status **email or statement export** the operator can forward verbatim? | Would give an operator-mediated read that is *copy-of-provider-artifact* rather than typed-from-memory — fewer data-entry errors, still zero provider coupling, still R2/R4-clean | Operator searches their own mailbox for provider mail / looks for a statement export. Manual, no automation, no credential | Operator | 10 min | O2 (§8) viability; accuracy of the operator_entered series |
| 7 | RQ-7 | If Cashfree: is the Payouts API **entitled** for this merchant, and how long does a Bearer token live? | Decides AMB-1 (§4.4) and whether Cashfree is usable at all | One operator-minted token, then `GET /payout/v1/getBalance` twice ~30 min apart: 200 = entitled; 403 `"APIs not enabled…"` = a queue, not a task; 403 `"Token is not valid"` on the second call = short TTL ⇒ AMB-1 ⇒ DENY stands | Operator | 30 min | P3/P4; the Cashfree column of §6 |
| 8 | RQ-8 | Does HG.Cash publish **rate limits**? | Documentation gap only: at one request per day we are far below any plausible limit. Left open so no one invents a limiter | `docs.hg.cash/llms.txt` → search for a rate-limit page; else email `api-support@hg.cash` | Engineer (or nobody) | 10 min | Nothing material |
| 9 | RQ-9 | What are HG.Cash's **payout minimums / thresholds**? | Needed only if the monitor ever explains "why nothing has paid out"; not needed for R1–R4 | Read the threshold off the operator's own withdrawal screen — **one screenshot**, never a scraped third-party number. (Third-party sources disagree with each other; do not encode a number) | Operator | 5 min | Nothing for R1–R4; affects only commentary quality |
| 10 | RQ-10 | Where would a provider token live if RQ-2/3 ever succeed? | Must never be the repo, and `provider_credentials.api_key` exists as a column `[EXEC]` — a tempting wrong answer | Confirm with the operator: token in the Hermes `.env` (`%LOCALAPPDATA%\hermes\.env`, outside the repo) or a `provider_credentials` row — **names only, `[REDACTED]` values, never a doc** | Operator | 5 min | Any future P1–P4 entry; blocks nothing today |
| 11 | RQ-11 | Is Task Scheduler's `StartWhenAvailable` catch-up actually reliable for a plain daily trigger? | Decides whether a missed day is *caught up* or *silently lost* — and catch-up is precisely the case that would otherwise create a second read in one local day | Created-task observation (out of scope here: this pass may not register a task); the Microsoft doc restricts the property to tasks "with an end boundary or … repeat infinitely", so it cannot be assumed | Operator, later | 20 min | Scheduler choice; not the source question |
| 12 | RQ-12 | Is the entity's activity personal or commercial w.r.t. freecash.com §16? | §16 permits *"personal, non-commercial use only"*. If the monitored account feeds a commercial offering, the compliance posture changes | One question. A business determination, not a fetchable fact | Operator | 5 min | Any commercial framing of this monitor |

### 5.1 Top 5 — the load-bearing set (summary form)

| # | Question | Cheapest experiment | Owner · duration |
|---|---|---|---|
| 1 | Which provider holds the monitored account? | One question to the operator | Operator · 2 min |
| 2 | Manual read permanent, or is provider-verified automation a requirement? | One question; a decision, not a probe | Operator · 5 min |
| 3 | If HG.Cash: token exists and `GET /accounts` → 200? | One hand-run `curl` with `Authorization: Bearer [REDACTED]`, **once, out-of-band, never from the monitor** | Operator · 10 min |
| 4 | Is the freecash.com browser-automation path contained, disabled, or knowingly accepted? | Read four call sites; answer three questions | Operator decides · 30 min |
| 5 | Is the R3 notification channel live (Telegram configured, never tested)? | One authorized test send (an external write ⇒ needs R4 approval) | Operator · 2 min |

---

## 6. Notification and change-detection signal map

Two distinct change kinds must be separable, because R3 names both: **"earnings changed"** and **"account status changed"**.

### 6.1 Per-source fields

| Source | "Earnings/balance changed" fields | "Account status changed" fields | Stable dedup keys | Can it satisfy R3 fully? |
|---|---|---|---|---|
| **`operator_entered`** (live source) | `earnings_total_cents` (int cents), `balance_cents`, `pending_cents` | `account_status` (free text, uppercased by the parser) | day-level `(source.kind, day_key)`; change-level `sha256(day_key \| change_type \| field \| old_value \| new_value)` | **Yes** — the only source that publishes both halves. Field **names** are the repo's own record shape; the *labels the operator sees* on the dashboard are `[UNVERIFIED]` (§10) |
| **HG.Cash** | `balance` (ledger, 2dp), `pendingFees`, `netBalance` (= balance − pendingFees) | `status` ∈ **`Operativa` \| `Bloqueada` \| `Cerrada`** `[EXEC]` (re-read from the OpenAPI page this pass) | `account.id` (UUID) + day key | **Half.** HG.Cash publishes **no lifetime-earnings field** — only ledger/pending/net. So R3's "earnings changed" must be mapped to *net balance movement* and **labelled as such**; claiming "earnings" from HG.Cash would be an inference, not a reading |
| **Cashfree Payouts** | `data.balance` (ledger), `data.availableBalance` | **none documented** — no lifecycle/status field in the getBalance schema `[EXEC]` | no account identifier documented; only the optional request-side `paymentInstrumentId` ⇒ key on `(source, day_key)` | **No.** Balance movement only; `account_status` would have to stay `null` and `STATUS_CHANGED` could never fire |
| **freecash.com** | dashboard-only: total earnings, current balance, pending (four figures a human reads) | dashboard-only: account status | no provider-issued id is available to us; day key + recorded figures | **Only via the human's typed reading** — i.e. via `operator_entered` |
| **`metrics_http`** | none that observe the account | none | — | **No** — rejected source (§2.2) |

### 6.2 The change semantics the code already implements (must be preserved, not re-invented)

| Rule | Behaviour | Evidence `[SRC]` |
|---|---|---|
| Compared fields are exhaustive and exact — four fields, integer cents, **no percentage threshold** | `COMPARED_FIELDS = (("account_status","STATUS_CHANGED"), ("earnings_total_cents","EARNINGS_CHANGED"), ("balance_cents","BALANCE_CHANGED"), ("pending_cents","EARNINGS_CHANGED", subtype "pending"))` | `changedetect.py:34-39` |
| A missing field is a **read failure**, never a silent zero | `MetricError` raised on missing `account_status`/money fields | `changedetect.py:111-138` |
| First run never raises a fake alarm | `baseline: True` when there is no prior snapshot or either side has no data | `changedetect.py:226-241` |
| An earnings change that drags the balance is **ONE** change, not two | `if field == "balance_cents" and earnings_moved: continue` | `changedetect.py:256-262` |
| A currency change suppresses money comparison rather than producing a bogus delta | `"currency changed … money comparison skipped"` | `changedetect.py:242-249` |
| A return to a previous balance is a real event, not a duplicate | The day key is **inside** the dedupe key: `sha256(day \| change_type \| field \| old \| new)` | `changedetect.py:19-25,214-216` |
| `OK_NO_CHANGE` is log-only and never dispatches | `emit_no_change()` writes severity `info`; `_NOTIFY_EVENTS` excludes it | `notify.py:37-39,91-99` |
| The dedupe key is written **before** dispatch (a crash may lose one message, never duplicate one) | `record_notified_key(dedupe_key, DELIVERY_QUEUED)` precedes the send loop | `notify.py:220-238` |
| Delivery failure is loud, not silent: 2 attempts, then `DELIVERY_FAILED` + a `MONITOR_DEGRADED` line with the full message | `dispatch()` | `notify.py:234-261` |
| R4: a detected change enqueues a **handle**, never a permission | `enqueue()` sets `expires_at_utc: null`, `execution_state: "NOT_EXECUTED"`, `execution_allowed_by_this_routine: false`; `decide()` re-freezes all three | `approval_queue.py:43-52,108-134,161-201` |
| A machine may not sign a decision | `NON_HUMAN_DECIDERS` = system/routine/automation/agent/cron/scheduler/monitor/bot/script/machine → `NotHumanError`, exit 4 | `approval_queue.py:54-57,149-158` |

### 6.3 What a v2 **verified** snapshot would additionally need (not present today)

| Gap | Why it matters to R3 | Evidence |
|---|---|---|
| `degraded` is a hard-coded `True`, not derived from the source | A future provider read could not be *represented* as non-degraded, so "no change" would forever read as unverified | `changedetect.py:168`, `run_daily_check.py:98` `[SRC]` |
| A source→field mapping (e.g. `netBalance` → `balance_cents`, HG.Cash `status` → `account_status`) does not exist | The normaliser accepts aliases (`net_balance_cents`, `available_cents`, …) but nothing declares *which provider field is authoritative for which rule* | `changedetect.py:48-65` `[SRC]` |

---

## 7. Decision points that require the operator

| ID | Decision | Option A → consequence | Option B → consequence |
|---|---|---|---|
| **DP-1** | Accept the operator-mediated manual read **permanently**? | **Accept:** the monitor closes today; every snapshot stays `degraded: true`; "no change" can never be presented as provider-verified; ~60 s/day of operator time; zero provider coupling and zero ToS surface | **Do not accept:** provider-verified automation becomes a hard requirement → RQ-1/RQ-3 become blocking, and the entity must hold and manage a provider credential |
| **DP-2** | Is provider-verified automation a *requirement* or a *nice-to-have*? | **Nice-to-have:** §4.2 stays dormant, nothing to build | **Requirement:** P1–P4 must be pre-conditioned and adopted; `degraded` must be derived; the `ALLOWED_HOSTS`/`ALLOWED_PATHS` widening needs explicit operator amendment (it is the single R2 control) |
| **DP-3** | The freecash.com browser-automation path (RQ-4) — contain, disable, or knowingly accept? | **Contain/disable:** the monitor's compliance claim becomes true for the entity, not just the routine; costs the FreeCash auth/goal-resume feature | **Knowingly accept:** must be recorded as an accepted risk against ToS §17, and no document may then claim the entity avoids automated provider access |
| **DP-4** | Which notification channel is authoritative? | **Telegram (already configured):** no new secret; needs one authorized test send | **Windows toast (today's default):** zero credentials, but a headless/unattended run has no desktop — delivery failure is then only visible in `alerts.jsonl` |
| **DP-5** | What must "account status changed" mean when a source publishes no status field? | **Map net-balance movement to earnings-only and state that STATUS_CHANGED cannot fire for that provider:** honest, requires per-provider signal-map documentation | **Let STATUS_CHANGED stay `null`/silent:** risks a "nothing changed" report that quietly omits the status half of R3 |
| **DP-6** | Are the operator-typed figures a **financial record** (retention, audit, tax)? | **Yes:** snapshot/ledger retention (90 d snapshots / 30 d logs, alerts never pruned `[SRC]` `changedetect.py:295-325`) must be revisited | **No:** current retention stands |
| **DP-7** | Retire the false compliance surfaces? (`INTEGRATION_STATUS.md`'s "COMPLIANT ✅" matrix, the parse-broken `.mjs`, the tautological verifier, the placeholder crontab) | **Retire/park:** stops the next pass from re-deriving a dead endpoint as live; untracked files → move, do not delete without approval | **Leave:** the false-green class of defect recurs (already happens 3× in this repo) |

---

## 8. Options

| | **O1 — Close on the manual read + contain the automation** | **O2 — Manual read, upgraded to verbatim artifact import** | **O3 — Provider-verified read (HG.Cash first)** | **O4 — Harden the routine's representation, no source change** |
|---|---|---|---|---|
| **What it is** | Keep `operator_state` as the only source; add RQ-4 containment and fix the false compliance surfaces | As O1, plus RQ-6: the operator pastes the provider's own statement/email numbers instead of re-reading a dashboard from memory | Amend §4.1 with P1 (and P2 if needed) only after RQ-1/RQ-3 resolve; derive `degraded` from the source | Derive `degraded` instead of hard-coding it; add a source→field mapping; keep `operator_state` as the populated source |
| **Expected Effort** | 2–4 h (containment map + doc corrections + gate wiring) | 3–5 h on top of O1 (import shape + validation + tests) | 3–5 h **after** a hand-verified `200`; ~0 h of provider work before that | 1–2 h builder + 30 min reviewer |
| **Time-to-Revenue** | none directly — makes the `proj-free-cash` numbers observable from tomorrow | none directly; slightly better data quality than O1 | none directly; the only option that can ever produce a non-degraded snapshot | none directly — prerequisite for O3 being *representable* |
| **Dependencies** | Operator answers **DP-1** and **DP-3**; no new credential; no external action | **DP-1** + RQ-6; still no credential; the artifact must be copied by hand (no mailbox automation) | **RQ-1** then **RQ-3**; a token minted out-of-band; explicit operator amendment of the allowlist; `provider_credentials` stays empty or is deliberately used (RQ-10) | none in code; `verify_readonly.py` must stay at `forbidden=0`; live state root not touched (use `FREECASH_DATA_ROOT`) |
| **First Concrete Action** | Write the containment decision for RQ-4 into the decision record, and re-label `INTEGRATION_STATUS.md`'s compliance matrix as unverified | Ask RQ-6 (one mailbox search), then define the importer's record shape as a strict superset of `TEMPLATE_RECORD` with `entered_at_utc` = the moment of the *export* | Operator runs the single hand `GET /accounts` with `Authorization: Bearer [REDACTED]` and records **only** the status code, response-shape field names and the observed `status` string — then one allowlist line is added with a justification comment | Add a failing test first: `degraded` must be `False` for a synthetic verified-provider source and `True` for `operator_entered`; require `run_all.py` → `failures=0` before/after |
| **Satisfies R3 in full?** | Yes, **as degraded** (both halves, human-read) | Yes, as degraded, with better provenance | Yes for the status half and *balance* movement; **not** for lifetime earnings (HG.Cash publishes none) | n/a — enablement only |

---

## 9. Explicit unknowns and limits

### 9.1 BLOCKED — stated as blocked, with the accurate reason (no substitute data invented)

| ID | Blocked item | Accurate reason |
|---|---|---|
| **BLOCKED-1** | Any **provider-verified** read | No provider identity is established (RQ-1) and `provider_credentials` = **0 rows** `[EXEC]`. There is no account, no token and no documented read contract for *this* entity to read. |
| **BLOCKED-2** | Re-probing `api.freecash.com/v1/status` (repo-recorded 404) | Doing so means an automated request to a provider host, which this pass's constraints and freecash.com §17.2 both forbid. The 404 stays `[CARRIED]`, not re-derived. |
| **BLOCKED-3** | Cashfree application-level liveness | The unauthenticated probe is answered by an **edge 403 HTML** (`awselb/2.0`), not the documented JSON, and not the documented 412 for a missing token. Distinguishing "edge block" from "application answer" requires a token. |
| **BLOCKED-4** | Verifying the R3 notification channel end-to-end | Verification requires *sending* a message — an external write. R4 applies to the research itself, so this pass lists the test instead of running it (RQ-5). |
| **BLOCKED-5** | Any status read **today** (`2026-09-20`) | `day-locks/2026-09-20.lock` exists and `last_success_day 2026-09-20` `[EXEC]`. A second read today is an R1 violation by construction, regardless of source. |
| **BLOCKED-6** | Whether the provider emails/statements exist (RQ-6) | Requires the operator's own mailbox; not publicly observable, and this pass may not read mail or hold a mailbox credential. |
| **BLOCKED-7** | The `freecashExecutor` account/goal path — is it authorized and in scope? | Requires an operator decision. The code is `[SRC]`-verified and wired; its *authorization* is not a fact a tool can establish. |
| **BLOCKED-8** | HG.Cash account existence / provisioning and token TTLs | KYC-gated onboarding per `[CARRIED]`; token TTL is not published in the retrieved docs. Both need the operator's account, which this pass may not touch. |

### 9.2 Explicit limits of this pass

- **No provider host was contacted.** Zero requests to `freecash.com`, `hg.cash`, `payout-api.cashfree.com` or `api.freecash.com`. The only external fetches were two **documentation** pages (`docs.hg.cash`, `www.cashfree.com/docs`) — doc hosts, no credential, no API call. Everything else external is `[CARRIED]` **with its URL**.
- **freecash.com was deliberately not fetched**, including its `robots.txt` and ToS, even though both were fetched by an earlier pass. Reason: this plan's own conclusion is that *any* automated access to that host is a terms breach "for any purpose, including monitoring"; re-fetching it here would contradict the plan while writing it. The quotes in §3 are carried verbatim from `PROVIDER-FINDINGS-REVERIFIED.md` Q1, which did perform the fetch and recorded the raw HTTPS codes and byte counts.
- **The freecash.com dashboard field *labels*** (whether the dashboard literally says "Total earnings", "Balance", "Pending") are `[UNVERIFIED]`. The four figures are `[INFERRED]` from the platform's ToS vocabulary plus the repo's own `TEMPLATE_RECORD`. Do not encode label strings.
- **No external action of any kind was taken:** no signup, no login, no credential request, no scheduler entry (`hermes cron list` → none; no `schtasks` entry created), no message sent, no approval decided.
- **No repo file was modified other than this document.** Test and scanner runs that could have written byte-code used `PYTHONDONTWRITEBYTECODE=1`, and the suite ran against `$LOCALAPPDATA/Temp/fc-v2-research` via `FREECASH_DATA_ROOT`; the live state root was confirmed unchanged (still 21:08) after the run.
- **Not re-verified, therefore not upgraded:** the parse-broken state of `scripts/finance_monitor.py` and `finance-monitor/`, the `config/freecash-crontab` placeholder path, `server/tasks/daily-finance-monitor.py` behaviour, and the mutation test of `verify-freecash-rules.mjs`. Carried from `docs/freecash-monitor-audit-evidence.md` and `docs/freecash-automation-workflow-plan-v2.md`.
- **Nothing here is a compliance certification.** This plan establishes what may be read and under what constraints; it does not assert that the entity's current behaviour satisfies any provider's terms — §2.4 is direct evidence that at least one wired path does not.

---

## 10. One-paragraph recommendation

Answer **RQ-1** and **RQ-2** before anything else, because every other item in §5 collapses into them: if the operator confirms a provider and wants provider-verified data, §4.2's dormant lines become a hand-verified, one-at-a-time widening of the allowlist; if the operator accepts the manual read, the monitor is already built and compliant and the remaining work is O1's containment of the freecash.com browser-automation path plus correction of the false compliance surfaces. Until one of those happens, the correct posture is exactly the one on disk today — loopback-only, `operator_state`-fed, `degraded: true`, day-locked, zero approvals executed — and no provider hostname may enter `readonly_client.py` until a human has fetched the URL by hand and recorded the observed response shape.

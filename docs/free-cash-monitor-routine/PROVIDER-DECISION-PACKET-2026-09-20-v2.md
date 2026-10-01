# PROVIDER DECISION PACKET v2 — Free Cash daily status-monitoring routine

**Date:** 2026-09-20 (Europe/Berlin) · **Host:** Windows 11, git-bash, non-elevated, `cd-pr` · **Interpreter:** `python` = 3.11.9
**Supersedes (additively):** `PROVIDER-DECISION-PACKET-2026-09-20.md` (v1, unmodified — this file is the only repo file created by this pass)
**Purpose:** close the six open research questions that block the routine from becoming operational, and name the one authorised read source.

## 0. Scope and compliance statement (what this pass did NOT do)

| Constraint | Status | Evidence |
|---|---|---|
| No provider login, no credential use | Honoured | No credential file read; no auth header constructed anywhere in this pass |
| No network call to any **account** endpoint | Honoured | Deliberately untouched: `https://hg.cash/api/v1/accounts`, `https://payout-api.cashfree.com/payout/v1/*`. Fetched only public docs / robots.txt / ToS and probed **loopback** (`localhost:4600`, `localhost:3001`). Note: v1's evidence chain used unauthenticated 401/403 probes of those provider hosts; **this pass did not repeat them**, so those liveness claims are cited here as *prior-pass*, not re-verified. |
| No scheduled-task registration | Honoured | `schtasks /query /tn "FreeCash-Daily-Monitor"` → `FEHLER: Das System kann die angegebene Datei nicht finden` (task does not exist). Nothing was created or modified |
| No git operations | Honoured | No `git add/commit/checkout/stash/reset/clean` run at any point |
| Additive only | Honoured | Only this file created (`PROVIDER-DECISION-PACKET-2026-09-20-v2.md`) |

## 1. Evidence bar

A claim counts only with (a) a fetched URL plus observed HTTP status/size, or (b) an executed local command plus its observed output. Everything else is labelled `COULD NOT VERIFY`. No claim in this packet comes from memory or from v1's narrative without saying so. Where v1 asserted something this pass did not re-fetch, it is marked `PRIOR PASS (not re-verified here)`.

---

## 2. Q1 — which read source is authorised

**Answer: O4, the operator-entered local state file, is the only source authorised today.** It is already implemented, already the production path (the 2026-09-20 production run used it), has zero Terms-of-Service exposure, opens no socket, and carries no credential. Every other option is either non-existent on this host (O1), inapplicable to the monitored account (O2/O3), or contractually prohibited (O5).

Supporting facts, each VERIFIED:

- **The provider read contract is still literally unknown.** `monitoring/freecash/readonly_client.py:60` → `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`; the same literal appears at `readonly_client.py:27` and `approval_queue.py:116`. `ALLOWED_PATHS` (`readonly_client.py:43-49`) contains exactly two loopback regexes and **no provider path**. Nothing in this pass produced a freecash.com account read path, so **the literal stays. Do not substitute O2/O3 for it.**
- **The routine is already production-live on O4.** `data/freecash-monitor/snapshots/2026-09-20.json` → `"source": {"kind": "operator_entered", ..., "data_available": false, "note": "no operator-entered record for 2026-09-20 in operator-state.json"}`, `"degraded": true`; `data/freecash-monitor/state/operator-state.json` → `"kind": "operator_entered_daily_status"`, `"records": []`.
- **O1's required endpoint does not exist on this host** — see Q3/E10. It is not merely "app not running".

### Option matrix (six required fields each)

#### O1 — loopback read-only metrics endpoint (`GET /api/v1/status/metrics` + `HEAD /api/v1/status`, default `http://localhost:3001`)

| Field | Value |
|---|---|
| **Expected Effort** | 0.5 h to wire (`--source metrics_http` already implemented) **but 3–5 h builder to make it serve anything at all** — no route exists (VERIFIED: 404 on the live app, nothing listening on 3001). Delivering *account* status would additionally require inventing the local metrics content, which changes nothing about provider truth. |
| **Time-to-Revenue** | **NONE.** By construction this source cannot show that the account is intact and earning: it reports local workstation/AgentiOS metrics and every snapshot from it is `degraded: true`. It cannot move the operator's time-to-visibility by even one minute. |
| **Dependencies** | A process serving exactly `/api/v1/status/metrics` (VERIFIED absent), the AgentiOS app running for the 4600 route variant, writable state root. No credential, no provider. |
| **First Concrete Action** | `curl -sS -o /dev/null -w 'code=%{http_code}\n' --max-time 5 http://localhost:3001/api/v1/status/metrics` (→ `000`, exit 7) and `curl -sS -o /dev/null -w 'code=%{http_code}\n' http://localhost:4600/api/v1/status/metrics` (→ `404`). Only a 200 with JSON containing the four fields justifies wiring it. |
| **Named Blocker** | `ROUTE_DOES_NOT_EXIST` — the path is allowlisted in code but served by nothing; adding a route is a code change outside the monitor's scope and would still be a local substitute, not provider truth. |
| **Verdict** | **CONDITIONAL** — R2-compatible (loopback, GET/HEAD, body-rejecting transport) and allowed to run as a *degraded health probe only*; **NOT an authorised source of account status** and it must never be presented as one. |

#### O2 — HG.Cash `GET /accounts`

| Field | Value |
|---|---|
| **Expected Effort** | 4–8 h builder *if* an account exists; 0 h proof-of-concept is impossible because every read needs a bearer token. |
| **Time-to-Revenue** | **Unbounded / not reachable.** This is a LATAM (ARS/BRL/CLP/BOB) iGaming pay-in/payout rail. Nothing in the repository links the monitored Freecash account to an HG.Cash account, and no `HG_CASH*`/provider credential exists, so this source cannot produce visibility of *that* account at any effort. Best case after operator confirmation of ownership: 3 days–2 weeks (KYC onboarding). |
| **Dependencies** | Operator confirmation that the monitored account **is** an HG.Cash merchant account (COULD NOT VERIFY); KYC/B2B onboarding; a `Bearer cash_…` token generated in the provider's settings page; a deliberate R2 allowlist extension for exactly `GET /accounts` (and optionally `GET /account/{id}/balance`). |
| **First Concrete Action** | Ask the operator one question: *"is the monitored Freecash account an HG.Cash account, and can you issue a read-only token for it?"* If and only if yes: extend `ALLOWED_PATHS` with one justified line and one host entry, then verify with a single `GET /accounts`. |
| **Named Blocker** | `ACCOUNT_OWNERSHIP_UNKNOWN` — no evidence ties the monitored account to HG.Cash; a credential is required to read it, and R2/R4 forbid credential handling inside the routine. |
| **Verdict** | **REJECTED** as the read source for the monitored Freecash account (basis: documentation is real — Q3 — but applicability is unverifiable and the credential path violates the routine's own deny-by-default transport). Becomes CONDITIONAL **only** on explicit operator confirmation of ownership plus a read-only token issued outside the routine. |

#### O3 — Cashfree Payouts `GET /payout/v1/getBalance`

| Field | Value |
|---|---|
| **Expected Effort** | 4–8 h builder **plus a rule decision by the operator (1–3 h)**, because the documented read token is minted by `POST /payout/v1/authorize` — a verb the monitor's transport refuses by construction (`ALLOWED_METHODS = {"GET","HEAD"}`, `readonly_client.py:39`). |
| **Time-to-Revenue** | **Unbounded / not reachable** for the same ownership reason as O2 (Cashfree is an Indian payments company whose brand merely echoes "Free Cash"; no repo link, no credential). Best case after confirmation + activation: 1–4 weeks (activation queue). |
| **Dependencies** | Merchant account with Payouts API enabled (documented gate: HTTP 403 `APIs not enabled. Please fill out the [Support Form](…)`); `X-Client-Id` + `X-Client-Secret`; a bearer token minted by a **POST**; a deliberate R2 exemption decision; operator confirmation of ownership. |
| **First Concrete Action** | Operator-side only: open the Cashfree merchant dashboard and record whether a Payouts-enabled key already exists. Nothing is built until ownership is confirmed. *(Deliberately not probed here — that host is a provider account endpoint.)* |
| **Named Blocker** | `TOKEN_REQUIRES_POST` + `ACCOUNT_OWNERSHIP_UNKNOWN` — the only documented way to obtain the read token is a write-verb call the routine forbids, and nothing links this provider to the monitored account. |
| **Verdict** | **REJECTED** (basis: documented endpoint is real — Q3 — but unusable without a POST-minted credential and unlinked to the monitored account). |

#### O4 — operator-entered local state file (`state/operator-state.json`)

| Field | Value |
|---|---|
| **Expected Effort** | **0 h builder** (implemented: `operator_state.read_source`, `ensure_template`, `record_for_day`; template auto-created). Operator cost: **~5–10 min once per day**, once, typed from the operator's own logged-in dashboard reading. |
| **Time-to-Revenue** | **≤1 day** — visibility begins the first day the operator types four figures (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`). The 2026-09-20 production run already produced a snapshot with this source; the only missing input is the operator's numbers. This is the *earliest achievable* account-intact information of all five options, and it is the only option that can produce it at all today. |
| **Dependencies** | Operator discipline (one entry per local day, `day_key`); canonical state root decision (Q6); R3 comparison machinery already present (`changedetect`, dedupe keys, `notified-keys.json`). No credential, no socket, no provider contact. |
| **First Concrete Action** | Append today's record to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json` (or run `run_daily_check.py --source operator_state`, which auto-creates the template when absent), then note in the daily packet that the snapshot remains `degraded: true` and is **operator-supplied, not provider-verified**. |
| **Named Blocker** | None technical. Behavioural: `OPERATOR_DISCIPLINE` — the file is empty today, so every snapshot is `MONITOR_DEGRADED` with null fields. |
| **Verdict** | **RECOMMENDED** — authorised now, R1–R4-compliant by construction (no execution path, no socket, no earning action), zero ToS exposure, and it is already the production path. Its honest label (`degraded: true`, `source.kind = operator_entered`) is the correct place to state that no provider-verified read exists. |

#### O5 — scripted browser session against freecash.com

| Field | Value |
|---|---|
| **Expected Effort** | 6–12 h builder (login flow, MFA/KYC handling, markup-dependent parsers) and unbounded maintenance — plus an R2 rewrite, since a browser session is not a `GET`/`HEAD` loopback read. |
| **Time-to-Revenue** | Technically minutes, **economically negative**: it risks the account whose earnings it is supposed to protect (Almedia restricts/terminates accounts for automation). Treat as N/A. |
| **Dependencies** | Provider login and stored session credentials (both forbidden by this routine's own constraints and by R2), a non-loopback transport, browser automation, and a prior written consent from Almedia that does not exist. |
| **First Concrete Action** | None. **Do not build.** The compliant equivalent is the operator reading their own dashboard by hand and typing the figures into O4. |
| **Named Blocker** | `TOS_PROHIBITS_AUTOMATED_AND_MANUAL_MONITORING` (verbatim clause in Q2) + `ROBOTS_SCOPING` (`Disallow: /user/`, `/fc-api/`). |
| **Verdict** | **REJECTED** — contractual prohibition naming *monitoring* explicitly, plus robots.txt scoping, plus direct risk to the monitored account. |

---

## 3. Q2 — does an automated-access clause forbid monitoring-style access?

**VERIFIED — yes, for freecash.com. It is explicit, and it names monitoring.**

**Source A — Terms of Service, fetched `https://freecash.com/en/policies/terms`** (HTTP 200; page header observed: "Last Updated: July 17, 2026", "Terms of Service *(Effective: July 17, 2026)*"). Verbatim:

> §16.1 — "These Terms of Services permit you to use the Website for your personal, non-commercial use only."

> §17.1 — "To use macros, bots, scripts, or any other automation tools designed to simulate or replicate human user activity, including but not limited to automating clicks, movements, or tasks within offers or apps. Such behavior is strictly prohibited, as it undermines the integrity of the platform and results in unfair advantages over other users."

> §17.2 — "Use any robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website."

> §17.2 — "Use any manual process to monitor or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, without our prior written consent."

> §17.2 — "Use any device, software or routine that interferes with the proper working of the Website."

**Source B — robots.txt, fetched `https://freecash.com/robots.txt`** (HTTP 200, `text/plain`, 298 bytes). Verbatim, complete:

```
User-Agent: *
Allow: /
Allow: /r/*?worldcupbet=*
Disallow: /user/
Disallow: /myprofile
Disallow: /r/
Disallow: /_next/
Disallow: /_ipx/
Disallow: /offer/
Disallow: /fc-api/
Disallow: /scd-cgi/
Disallow: /w/
Disallow: /dev-playground/
Disallow: /*mailto:*

Sitemap: https://freecash.com/sitemap.xml
```

**Finding, stated precisely:** robots.txt contains **no** automated-monitoring clause — it is a scope list (and `Disallow: /user/`, `/myprofile`, `/fc-api/` puts the account pages and the internal app backend out of bounds). **The binding prohibition is contractual, in the ToS**, and its reach is deliberately wide: §17.2 forbids *automated* access "for any purpose, including monitoring" **and** forbids **manual** monitoring "without our prior written consent". A daily automated status poll is automated access by an "automatic device"; a scripted browser session is additionally a "bot/script/automation tool" under §17.1. Both are prohibited, and §16.1 restricts use to personal, non-commercial purposes.

**No authorisation exists in the opposite direction:** fetching `https://freecash.com/sitemap.xml` (HTTP 200, 796 bytes) returns exactly 5 `<loc>` entries, all of the form `https://freecash.com/api/sitemap/{1..5}/sitemap.xml` — no developer, API or partner page is indexed.

**Other providers (for completeness, same question):**
- `https://docs.hg.cash/robots.txt` (HTTP 200) → `User-agent: *`, `Content-Signal: ai-train=yes, search=yes, ai-input=yes`, `Disallow: /cdn-cgi/`, `Disallow: /_next/` — no monitoring prohibition. `COULD NOT VERIFY` whether a separate HG.Cash service ToS contains one (not fetched; not needed while O2 is REJECTED).
- Cashfree: the documentation index `https://www.cashfree.com/docs/llms.txt` (HTTP 200, 89,498 bytes) contains **no** rate-limit or automation-prohibition entry relevant to Get Balance; programmatic use is the documented purpose of the API. A separate corporate ToS was not fetched — `COULD NOT VERIFY`, and not load-bearing while O3 is REJECTED.

---

## 4. Q3 — do the O2/O3 balance endpoints actually exist as documented?

| Question | Answer | Evidence |
|---|---|---|
| **freecash.com account read endpoint** | **PROVIDER_ENDPOINT_UNKNOWN.** No documented account/balance/status read endpoint exists. | VERIFIED absence: `https://freecash.com/sitemap.xml` (HTTP 200, 796b) indexes only `/api/sitemap/{1..5}/sitemap.xml`; ToS §17 forbids the access route that would be needed. The literal `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` **stays** in `readonly_client.py:60`, `readonly_client.py:27` and `approval_queue.py:116`. |
| **O2 — HG.Cash `GET /accounts`** | **VERIFIED as a real, documented read-only endpoint. Applicability to the monitored account: COULD NOT VERIFY.** | Doc URL `https://docs.hg.cash/api-reference/accounts/get-user-accounts` (HTTP 200). Spec `https://docs.hg.cash/api-reference/openapi.yaml` (HTTP 200, 90,616 bytes) → `servers: https://hg.cash/api/v1 (Production)`, `http://dev.hg.cash/api/v1 (Development)`; global `security: - bearerAuth: []`; `securitySchemes.bearerAuth: {type: http, scheme: bearer, bearerFormat: JWT}`. Path block: **`/accounts` → `get:`**, `operationId: getUserAccounts`, "Returns the authenticated user's accounts, including ledger balance, pending fees, net available balance (balance minus pending fees), and account status", responses `200`/`401`/`500`; 200 fields `id, name, balance, pendingFees, netBalance, status (enum: Operativa|Bloqueada|Cerrada), currency, number, alias, platform, company`. **Exact path:** `GET https://hg.cash/api/v1/accounts`. **Auth:** bearer token, format `cash_<64-char-hex>` generated in the account settings page. Sibling read: `GET /account/{id}/balance` → `https://docs.hg.cash/api-reference/accounts/get-account-balance`. **Rate limits:** the documentation index `https://docs.hg.cash/llms.txt` (HTTP 200, 10,712 bytes, 100+ entries) contains **no rate-limit entry** → limits COULD NOT VERIFY (absence-of-entry verified; limits themselves unverified). |
| **O3 — Cashfree Payouts `GET /payout/v1/getBalance`** | **VERIFIED as a real, documented read-only endpoint. Applicability to the monitored account: COULD NOT VERIFY.** | Doc URL `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` (HTTP 200, 699,252 bytes). Embedded spec block: **`get /payout/v1/getBalance`**, `operationId: get-balance1`, `servers: https://payout-api.cashfree.com (Production)`, `https://payout-gamma.cashfree.com (Sandbox)`, 200 body `data.balance` (example `'214735.50'`), `data.availableBalance` (example `'173980.50'`); documented failure example `APIs not enabled. Please fill out the [Support Form](https://merchant.cashfree.com/merchants/landing?env=prod&raise_issue=1)`. **Exact path:** `GET https://payout-api.cashfree.com/payout/v1/getBalance`. **Auth:** required `Authorization` header (`Bearer <token>`); the token is minted by **`POST /payout/v1/authorize`** with `X-Client-Id` + `X-Client-Secret` — per the fetched index `https://www.cashfree.com/docs/llms.txt` (HTTP 200): *"All other API calls must have this token as Authorization header in the format 'Bearer <token>' (without quotes) for them to get processed."* **Honest nuance:** the fetched page's embedded spec declares an **empty global `security`** block (`security: []` / `{}` observed in the page payload) — the requirement is documented as a required header parameter plus the Authorize-page statement, **not** as a declared security scheme. **Scope:** no read-only key scope appears on the fetched page or in the index → COULD NOT VERIFY. **A v1.2 sibling is indexed:** `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance-v12` (index entry present, HTTP-level fetch not repeated here). |

**Bottom line for Q3:** both O2 and O3 name endpoints that genuinely exist and are documented — **but neither is documented as a read of the monitored account**, and no credential exists for either. The monitored account's provider read path therefore remains literally `PROVIDER_ENDPOINT_UNKNOWN`, and this packet intentionally does not resolve it into a guess.

---

## 5. Q4 — which notification sink is actually available on THIS host today?

| Sink | Availability | Evidence (names/versions only — no values read or printed) |
|---|---|---|
| **Append-only JSONL alerts file** | **AVAILABLE — VERIFIED** (the only sink proven delivering today) | `monitoring/freecash/paths.py:183-200` `append_jsonl()` writes with a single `O_APPEND`/`O_CREAT` write and raises on a short write; `data/freecash-monitor/alerts/alerts.jsonl` exists with **2 lines written on 2026-09-20**, both well-formed JSON: `{"event_type": "MONITOR_DEGRADED", ...}` and `{"event_type": "SKIP_DUPLICATE_DAY", "observed": {"lock": "D:\\AgenticOS\\data\\freecash-monitor\\state\\day-locks\\2026-09-20.lock"}}`. This is also the canonical evidence record and the fallback whenever a delivery channel fails (`notify.dispatch` writes `DELIVERY_FAILED` + a `MONITOR_DEGRADED` line carrying the full original message). |
| **Desktop toast** | **CONDITIONAL — tooling present, delivery unproven** | `command -v powershell` → `/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell`, `$PSVersionTable.PSVersion` → `5.1.26100.9444`; `SESSIONNAME=Console` (an interactive console session exists); `msg`, `mshta`, `wscript` all PRESENT. `notify._toast_send` shells out to PowerShell `System.Windows.Forms.NotifyIcon` balloon (no third-party tooling needed) and caps at 2 attempts. Not exercised here (delivery would pop a balloon on the operator's desktop). |
| **Email** | **UNAVAILABLE — VERIFIED** | `command -v himalaya` → ABSENT; `command -v sendmail` → ABSENT; `command -v mailx` → ABSENT; `env \| grep -iE 'FREECASH\|SMTP_\|WEBHOOK_'` → **no output, exit status 1** (no `SMTP_*` variable names exist). `notify.py` itself documents SMTP as "opt-in and OFF by default; not wired to any credential here". |
| **Webhook** | **UNAVAILABLE — VERIFIED, and policy-blocked** | Same env check: **no `WEBHOOK_*` variable names exist**. Independently, `readonly_client.ALLOWED_HOSTS` is loopback-only and a process-wide audit hook aborts any `socket.connect`/`getaddrinfo` to a non-allowlisted host, so an outbound webhook cannot be dispatched by this routine without an explicit R2 change. |

**Answer:** the authorised sink today is the **append-only JSONL alert log** — it is already delivering, append-only by construction, and is the routine's canonical evidence record. Desktop toast is a *permitted second attempt* (`notify.dispatch`, ≤2 tries, then a loud `DELIVERY_FAILED` line) but its delivery on this host is **unverified**; no SMS/email/webhook sink exists.

---

## 6. Q5 — real semantics of Windows Task Scheduler `StartWhenAvailable`, and elevation for a daily per-user task

**VERIFIED** — fetched `https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable` (HTTP 200, 48,946 bytes). Verbatim:

> "This property applies only to time-based tasks with an end boundary or time-based tasks that are set to repeat infinitely."

> "Tasks that are started after the scheduled time has passed (because the StartWhenAvailable property being set to True) are queued in the Task Scheduler service's queue of tasks and they are started after a delay. **The default delay is 10 minutes.**"

**Meaning for R1 (this is the load-bearing reading):** the documented scope covers time-based tasks **with an end boundary** or **repeating infinitely**. A plain `-Daily` trigger has neither, so Microsoft's documentation **does not establish** that catch-up applies to it. Catch-up for a plain daily trigger therefore remains **UNPROVEN** — not "true", not "false". The design consequence is unchanged and is already implemented: the **per-day lock** (`data/freecash-monitor/state/day-locks/2026-09-20.lock`, with the observed `SKIP_DUPLICATE_DAY` alert proving the mechanism works) is what keeps R1 true, whether or not a late run ever fires; the watchdog carries the missed-day case.

**Elevation for a daily per-user task — VERIFIED: not required.** Fetched `https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks` (HTTP 200, 60,298 bytes). Verbatim:

> "From a low privilege process, you cannot register a task with the RunLevel property equal to TASK_RUNLEVEL_HIGHEST, but you can register a task with the RunLevel property equal to TASK_RUNLEVEL_LUA. The task actions will be run with low privileges. You are not allowed to register the task as Builtin/Administrator, Local System, or for a group."

> "When you register a task from a user account that is not a member of the Administrators group, then you do not need to specify a password when registering the task if you register the task to run under the security context of your account and you use the S4U or interactive logon type."

Corroborated by the `schtasks /create` reference, fetched `https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create` (HTTP 200, 101,917 bytes): `/rl` → "Acceptable values are LIMITED … and HIGHEST … **The default value is Limited**"; `/ru` → "By default, the task runs with the permissions of the current user of the local computer".

**Local capability check (VERIFIED, executed):** `whoami` → `cd-pr`; `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)` → **`False`**; `SESSIONNAME=Console`. So this session is a low-privilege process: it **can** register a daily task for the current user at Limited run level (satisfying R1's trigger requirement), and it **cannot** register a `RunLevel=Highest`, `Builtin\Administrator`, `Local System`, or group-context task — none of which this routine needs. No task was registered here (R4).

---

## 7. Q6 — which single canonical state root should be frozen?

**Answer: `D:/AgenticOS/data/freecash-monitor` — freeze it. Do not move state to `data/freecash`, and do not delete the empty directory.**

| Fact | Verdict | Evidence (executed) |
|---|---|---|
| `paths.py` already defaults to this root | VERIFIED | `monitoring/freecash/paths.py:35` → `DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`; `data_root()` at `:45-48` returns `os.environ.get("FREECASH_DATA_ROOT") or DEFAULT_DATA_ROOT`; `_SUBDIRS` at `:37` |
| Production state exists only under `data/freecash-monitor` | VERIFIED | `find data/freecash-monitor -type f` → **5 files**: `alerts/alerts.jsonl`, `snapshots/2026-09-20.json`, `state/day-locks/2026-09-20.lock`, `state/last-run.json`, `state/operator-state.json` |
| `data/freecash` holds nothing | VERIFIED | `find data/freecash -type f \| wc -l` → **0** |
| No code references `data/freecash` | VERIFIED | repo-wide search for `freecash-monitor\|data/freecash`: 3 hits, all `freecash-monitor` (`paths.py:35`, `run_daily_check.py:261`, `tests/_support.py:50`) — **zero** for `data/freecash` |
| The conflicting root is a **docs/plan artifact**, not code | VERIFIED | `DELEGATION-DISPATCH-2026-09-20.md:51` (W5) and `OPERATIONS-WORKFLOW-PLAN.md:71,113` pin `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash`; meanwhile `OPERATIONS-WORKFLOW-PLAN-2026-09-20.md:416,449,452` already pins `D:\AgenticOS\data\freecash-monitor` — the docs disagree with each other; only the code default is unambiguous |

**Why freezing the *populated* root is the only R1-safe choice.** The R1 state is *in* the populated root, and it is live: `state/last-run.json` → `last_attempt_day`/`last_success_day` = `2026-09-20`, `last_outcome` = `MONITOR_DEGRADED`, `consecutive_missed_days` = 0; `state/day-locks/2026-09-20.lock` exists, and `alerts.jsonl` already records that a second same-day run was refused (`SKIP_DUPLICATE_DAY`). Freezing the empty root instead would relocate `last-run.json` and `day-locks/` away from that evidence, so on the very next run the routine would see no day-lock for a day it has already consumed — i.e. it would permit a **second status check in one calendar day**, which is exactly the R1 violation the lock exists to prevent, and it would break the append-only evidence chain (`alerts.jsonl`) that R3/R4 audit against.

**Freeze instruction (no code change required):** the default at `paths.py:35` is already the frozen value; therefore
1. production invocations must **not** set `FREECASH_DATA_ROOT` at all (the env override at `paths.py:47` exists for tests only — `tests/_support.py:29,53` points it at a throwaway root), and
2. the two plan documents that pin `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash` (`DELEGATION-DISPATCH-2026-09-20.md:51`, `OPERATIONS-WORKFLOW-PLAN.md:71,113`) must be corrected to the frozen root as follow-up documentation work. **Not changed in this pass** (additive only).
3. `D:/AgenticOS/data/freecash` is left in place, empty and unreferenced, so no destructive action is needed; it must simply never be used as a data root.

---

## 8. Decision summary

| # | Item | Decision |
|---|---|---|
| 1 | Authorised read source | **O4 operator-entered local state file** (`state/operator-state.json`), snapshots labelled `degraded: true` |
| 2 | O1 local metrics endpoint | CONDITIONAL — permitted as a loopback health probe only; **not** a status source (route 404s; nothing on 3001) |
| 3 | O2 HG.Cash `GET /accounts` | REJECTED (documented endpoint, no account link, credential required) |
| 4 | O3 Cashfree Payouts `GET /payout/v1/getBalance` | REJECTED (documented endpoint, POST-minted token, no account link) |
| 5 | O5 scripted browser session | REJECTED (ToS §16.1/§17.1/§17.2 + robots.txt scoping + account-ban risk) |
| 6 | Provider endpoint literal | **Unchanged**: `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` remains in `readonly_client.py:27,60` and `approval_queue.py:116` |
| 7 | Notification sink | Append-only `alerts/alerts.jsonl` (proven); desktop toast CONDITIONAL via PowerShell 5.1 `NotifyIcon`; email/webhook unavailable |
| 8 | Canonical state root | **FROZEN: `D:/AgenticOS/data/freecash-monitor`** (matches `paths.py` default and all live state); `data/freecash` unused and left untouched |
| 9 | Scheduler semantics | `StartWhenAvailable` catch-up for a **plain daily trigger** remains UNPROVEN (MS scopes the property to tasks "with an end boundary" or "repeat infinitely"); the per-day lock is the R1 guarantee. Registering a daily **per-user Limited** task does **not** require elevation (this session is `IsInRole(Administrator)=False`); `RunLevel=Highest`/`System`/group contexts would. No task registered here. |

## 9. What remains blocked (and who unblocks it)

1. **Operator input** — one record per local day in `state/operator-state.json`; without it every snapshot is degraded and R3 can never fire (the file is empty today).
2. **Route work (optional, out of scope here)** — if the local substitute is ever wanted as a *health* signal, someone must add `GET /api/v1/status/metrics` **and** `HEAD /api/v1/status` to the AgentiOS server (404 today on port 4600, nothing listening on 3001). It will still never show account status.
3. **Ownership confirmation (blocks any provider read)** — the operator must state which provider/account is monitored and whether a read-only token can be issued for it. Until then O2/O3 stay REJECTED and the placeholder literal stays.
4. **Documentation correction (follow-up, not this pass)** — align the two plan documents that pin `FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash` to the frozen root.
5. **Toast delivery proof (operator-gated)** — one interactive dispatch with `FREECASH_TOAST_STUB` unset on a scratch root, to convert the toast from CONDITIONAL to VERIFIED. Not performed here (it would pop a balloon on the operator's desktop).
6. **Task registration (human approval, R4)** — a daily per-user Limited task, `MultipleInstances IgnoreNew`, `StartWhenAvailable`, no restart-on-failure; must not be registered unattended. Not performed here.

## 10. Sources

**Fetched this pass (HTTP status observed at fetch time):**
1. `https://freecash.com/robots.txt` — HTTP 200, text/plain, 298 bytes
2. `https://freecash.com/en/policies/terms` — HTTP 200; page states "Last Updated: July 17, 2026"; §§16.1, 17.1, 17.2 quoted verbatim
3. `https://freecash.com/sitemap.xml` — HTTP 200, 796 bytes, 5 `<loc>` entries, none developer/API
4. `https://docs.hg.cash/api-reference/accounts/get-user-accounts` — HTTP 200
5. `https://docs.hg.cash/api-reference/openapi.yaml` — HTTP 200, 90,616 bytes
6. `https://docs.hg.cash/llms.txt` — HTTP 200, 10,712 bytes
7. `https://docs.hg.cash/robots.txt` — HTTP 200
8. `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` — HTTP 200, 699,252 bytes
9. `https://www.cashfree.com/docs/llms.txt` — HTTP 200, 89,498 bytes
10. `https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable` — HTTP 200, 48,946 bytes
11. `https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks` — HTTP 200, 60,298 bytes
12. `https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create` — HTTP 200, 101,917 bytes

**Executed this pass (observed output quoted in-line above):** `find data/freecash-monitor -type f` (5 files) · `find data/freecash -type f | wc -l` (0) · `cat` of `last-run.json`, `operator-state.json`, `snapshots/2026-09-20.json`, `alerts/alerts.jsonl` · `env | grep -iE 'FREECASH|SMTP_|WEBHOOK_'` (no output, exit 1) · `command -v himalaya|sendmail|mailx|curl|msg|mshta|wscript` · `powershell -Command $PSVersionTable.PSVersion` (5.1.26100.9444) · `whoami` (cd-pr) · PowerShell `IsInRole(Administrator)` → False · `echo $SESSIONNAME` (Console) · `schtasks /query /tn "FreeCash-Daily-Monitor"` (not found) · `curl` to loopback `localhost:3001/api/v1/status/metrics` (exit 7 / HTTP 000), `localhost:4600/api/health` (200), `/api/v1/status/metrics` (404 `Route GET /api/v1/status/metrics not found`), `/api/v1/status` (404), `/api/revenue/metrics` (200, fields `totalOpportunities`/`countsByStage`/… only) · `netstat -ano | grep LISTENING | grep -E ':(3001|4600)'` (no match) · read-only SQLite (`file:server/data/agentic-os.db?mode=ro`): tables `schedules` (4 rows, all `next_run_at` NULL; last triggers 2026-09-07/09/19) and `schedule_executions` (2,875 rows) · `grep -rn PROVIDER_ENDPOINT_UNKNOWN monitoring/freecash` · repo-wide search for `freecash-monitor|data/freecash`.

**Cited as PRIOR PASS (not re-verified in this packet):** v1's unauthenticated 401/403 liveness probes of `https://hg.cash/api/v1/accounts` and `https://payout-api.cashfree.com/payout/v1/getBalance` — provider account endpoints, deliberately not contacted in this pass per the hard constraints.

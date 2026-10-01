# RESEARCH PLAN — 2026-09-21 — once-a-day, read-only Free Cash status monitor

**Subject:** "Free Cash Finance Automation" — a routine that checks the operator's Free Cash / payouts
account status **once per operator-local day**, alerts on earnings or account-status change, **never**
takes an earning or withdrawal action, and asks the human before any external action (rules R1–R4).
**Repository / branch:** `D:/AgenticOS` · `hermes-rescue-20260908` · **Host:** Windows 11, git-bash, non-elevated, user `cd-pr`; `python` = 3.11.9
**Written:** 2026-09-21 (Europe/Berlin) · day key `2026-09-21` · **Artifact created by this pass:** this file only (additive; no existing file modified, moved or deleted; no `git` write verb run).

---

## 0. Scope, evidence bar, and an honest deviation report

### 0.1 What this pass did

- Read the prior art (list in §7.3) and the live implementation `monitoring/freecash/` (`run_daily_check.py`, `readonly_client.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `gate.py`, `paths.py`, `operator_state.py`) and the live state files.
- Fetched **primary documentation and policy pages only** (see §7.1) to re-verify or newly verify every claimed endpoint and every Terms prohibition.
- Probed **loopback only** (`localhost:3001`, `localhost:4600`) — see §7.2.
- Read the local SQLite app DB **read-only** (`file:server/data/agentic-os.db?mode=ro`).

### 0.2 What this pass did **not** do (hard constraints)

| Constraint | Status |
|---|---|
| No edit / move / rename / delete of any existing file | Honoured — this file is the only artifact written |
| No `git add/commit/stash/reset/checkout`, no write verb of any kind | Honoured — `git status/short` was not even needed |
| No email sent, no message sent, no webhook called, no login, no signup | Honoured |
| No credential requested, typed, read or stored | Honoured — no `Authorization` header was constructed anywhere |
| No scheduled task / cron entry created | Honoured — nothing registered |
| Read-only research; inventing an endpoint is forbidden | Honoured — unresolved provider reads stay the literal `PROVIDER_ENDPOINT_UNKNOWN` |

### 0.3 One deviation, stated plainly (this matters for trust in the rest of the document)

The instruction for this pass was "do **not** call any provider endpoint". While verifying the Cashfree
**documentation** pages in a single fetch batch, the batch also contained the **production** URL
`https://payout-api.cashfree.com/payout/v1/getBalance` (it is the URL printed inside the vendor's own
docs page). One **unauthenticated `GET` with no credential and no headers** was therefore issued by that
fetch tool. Observed response, quoted in full:

```json
{ "status":"ERROR", "message":"Token is not valid", "subCode":"403"}
```

No account data, no balance, no credential, no authenticated request. It is disclosed because it (a) is a
deviating call to a provider host, and (b) **corrects a prior finding** (§5, row `CF-getBalance`): earlier
passes recorded an *edge-level* 403 HTML page (`awselb/2.0`) and concluded the application was unreachable
unauthenticated; today the application itself answered with its documented JSON error shape. The path is
live at the application layer. **No further provider host will be contacted by this research line.**

### 0.4 Evidence tags

| Tag | Meaning |
|---|---|
| `[FETCH-21]` | fetched **in this pass, 2026-09-21**; URL and observed content quoted |
| `[EXEC-21]` | command run **in this pass** on this host; raw output quoted |
| `[CARRIED]` | prior pass's evidence, **URL named**, not re-performed here (not upgraded) |
| `[DOC]` | official vendor documentation — the only admissible basis for calling an endpoint *real* |
| `UNVERIFIED` | asserted somewhere in the repo or by a third party, confirmed by nothing in this pass |

A claim is **VERIFIED** only with a `[FETCH-21]`/`[EXEC-21]` basis or a `[DOC]` citation read this pass.
Everything else is labelled, never silently promoted.

---

## 1. Ranked read sources for daily account status / earnings

Ranking key: **(a)** available today with no new secret, **(b)** Terms-of-Service exposure, **(c)** builder cost. Rank 1 is the only one that can produce a reading **today**.

### S1 (RANK 1 — RECOMMENDED, WORKS TODAY) — operator-entered figures read from the local `operator-state.json`

| Field | Value |
|---|---|
| **What it is** | The operator reads four figures from their **own** logged-in dashboard and appends one record per local day to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json`. The routine **reads that file**; it opens no socket and holds no credential. Self-attested data, `degraded: true` by construction. |
| **Expected Effort** | **0 h builder** — already implemented: `monitoring/freecash/operator_state.py` (`read_source`, `ensure_template`, `record_for_day`), wired as `DEFAULT_SOURCE = "operator_state"` at `run_daily_check.py:52-53`. Operator cost ≈ **5–10 min once per day**. |
| **Time-to-Record** | **≤1 day** — visibility begins the first day the operator types the four figures. This is the earliest achievable account-intact information of any option, and the only one achievable at all today. |
| **Dependencies** | Operator discipline (`OPERATOR_DISCIPLINE`); frozen state root `D:/AgenticOS/data/freecash-monitor` (`paths.py:35`); `FREECASH_DATA_ROOT` **must be unset** for production (§2.4); the day lock, `changedetect`, dedupe keys and `NOT_EXECUTED` approval queue are already present. No credential, no socket, no provider contact. |
| **First Concrete Action** | Human appends today's record (`day_key: "2026-09-21"`, `entered_at_utc`, `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency`) to `state/operator-state.json`, then run:<br>`python monitoring/freecash/run_daily_check.py --source operator_state`<br>and read `data/freecash-monitor/snapshots/2026-09-21.json`. Expect the snapshot to be labelled `degraded: true` and `source.kind = operator_entered`. |
| **Named Blocker** | None technical. Behavioural: **the file's `records` list was empty on 2026-09-20 and is still empty today** `[EXEC-21]` — `{"records": []}`. Every snapshot therefore reads `MONITOR_DEGRADED` with null fields, and R3 can never fire. |
| **Verdict** | **RECOMMENDED / only authorised read source today.** R1–R4-compliant by construction, zero ToS surface, already the production path. Its honest label is the correct place to say "no provider-verified read exists". |

### S2 (RANK 2 — PERMITTED, HUMAN-IN-THE-LOOP) — manual dashboard read copied by the human

| Field | Value |
|---|---|
| **What it is** | The operator personally logs into the provider dashboard in a browser and copies the figures (or a statement/export artifact) into S1's record. This is the **upstream act** that produces S1's data; it is listed separately because it is the only legal way the *provider side* of the reading happens. |
| **Expected Effort** | **0 h builder.** Operator cost 5–10 min/day (same visit that feeds S1). |
| **Time-to-Record** | **≤1 day.** |
| **Dependencies** | A provider account the operator can log into; the operator's own human act (no agent, no cookie jar, no stored session). For a statement/email artifact: the operator's own mailbox and a hand copy — **no mailbox automation**. |
| **First Concrete Action** | Operator logs in **by hand**, notes `account status`, `total earnings`, `current balance`, `pending`, and copies them into the S1 record with `entered_at_utc` set to the moment of reading. The agent never sees the session. |
| **Named Blocker** | **Which provider the account is with is unknown** (§2, BLOCKED-2). Also, for freecash.com specifically, §17.2 forbids "any **manual process to monitor** … without our prior written consent" — a *standing daily* manual monitoring practice is therefore not what the terms expressly authorise (§4.1). The operator must own that judgement; the routine itself stays out of it. |
| **Verdict** | **PERMITTED and necessary.** The routine may never do this; the human may. |

### S3 (RANK 3 — CONDITIONAL; PRIMARY DOCUMENTATION EXISTS BUT NO ACCOUNT LINK, NO CREDENTIAL) — official read-only provider API

Two providers have **real, documented, read-only balance endpoints** (verified this pass from vendor docs).
Neither is documented as a read of *the monitored account*, and no credential exists for either.

#### S3a — HG.Cash `GET /accounts` (structurally the best provider read)

| Field | Value |
|---|---|
| **What it is** | Documented, read-only, **`GET`-only** (no token-exchange `POST` needed, so it fits R2's `GET`/`HEAD`-only transport without an exemption). Returns per-account `balance`, `pendingFees`, `netBalance`, `status ∈ {Operativa, Bloqueada, Cerrada}`, `currency`. |
| **Expected Effort** | **4–8 h builder IF an account exists.** Before that, **0 h of buildable work** — every read needs a `Bearer cash_<64-hex>` token generated by hand inside an existing account. |
| **Time-to-Record** | **Unbounded today.** Access is **KYC-gated onboarding**: contact form → KYC with the HG.Cash team → approval → provisioning `[FETCH-21]` (docs.hg.cash introduction), not a self-serve signup. Nothing in the repo links the monitored account to HG.Cash. |
| **Dependencies** | Operator-written confirmation that the monitored account **is** an HG.Cash account; completed KYC; a hand-generated dashboard token stored **outside the repo**; an explicit, reviewed one-line amendment of `readonly_client.ALLOWED_PATHS`/`ALLOWED_HOSTS` (the single R2 control) after a hand-run `200` is observed. |
| **First Concrete Action** | One question to the operator — *"Is the monitored Freecash account an HG.Cash account, and can you issue a read-only token for it?"* — then, only if yes, the operator runs **once, out-of-band, never from the routine**:<br>`curl -i -H "Authorization: Bearer <REDACTED>" https://hg.cash/api/v1/accounts`<br>and records **only** the HTTP status code, the field names and the observed `status` string. |
| **Named Blocker** | `ACCOUNT_OWNERSHIP_UNKNOWN` + `KYC_GATED_ONBOARDING` + `NO_CREDENTIAL_ANYWHERE` (§2). |
| **Verdict** | **CONDITIONAL** — becomes the recommended provider read only after ownership confirmation **and** a hand-observed `200`. |

#### S3b — Cashfree Payouts `GET /payout/v1/getBalance` (structurally **worse** than HG.Cash — now proven)

| Field | Value |
|---|---|
| **What it is** | Documented read-only balance endpoint (`data.balance`, `data.availableBalance`). **But the bearer token must be minted by `POST /payout/v1/authorize`, and the documentation now states the token is valid for 6 minutes** `[FETCH-21]`. |
| **Expected Effort** | 4–8 h builder **plus an R2 rewrite decision** (a `POST` the monitor's transport refuses by construction, `ALLOWED_METHODS = {GET, HEAD}`, `readonly_client.py:39`). |
| **Time-to-Record** | **Structurally unreachable for a once-a-day GET-only routine.** A 6-minute token cannot be minted by the monitor (no POST, no client secret) and cannot be minted by hand 24 h in advance. New blocker, resolved by primary documentation this pass. |
| **Dependencies** | An **entitled** Cashfree merchant account (documented gate: `403 "APIs not enabled. Please fill out the Support Form"`), `X-Client-Id` + `X-Client-Secret`, a POST-minted 6-minute token, and an R2 exemption the monitor is not allowed to grant itself. |
| **First Concrete Action** | Operator-side only: open the Cashfree merchant dashboard and record **whether a Payouts-enabled key exists at all**, and whether the entity is an Indian-registered merchant (Cashfree's merchant T&C license is limited to India `[DOC, search-snippet level — fetch to close, RQ-14]`). Nothing is built before that. |
| **Named Blocker** | `TOKEN_REQUIRES_POST` + `TOKEN_TTL_6_MINUTES` + `ACCOUNT_OWNERSHIP_UNKNOWN` + `NO_CREDENTIAL_ANYWHERE`. |
| **Verdict** | **REJECTED** as the daily read source. Recorded so no future pass re-derives "Cashfree has a documented getBalance endpoint" as if it were usable. |

### S4 (RANK 4 — PASSIVE, PERMITTED, NOT YET AVAILABLE) — provider email / statement artifact copied by the human

| Field | Value |
|---|---|
| **What it is** | Receipt and status-change emails (or a dashboard statement export) that the operator **hands over verbatim**; the routine stores what the human copied. A post-hoc record, never a live balance. |
| **Expected Effort** | 0 h for the hand-copied form (it is S1 with a better provenance field). **3–5 h** if a mailbox is ever wired (`himalaya` ABSENT, no `IMAP*`/`SMTP*` variable names on this host `[EXEC-21, CARRIED]`). |
| **Time-to-Record** | 1 day for the hand-copied form; ≥1 week for any automated mailbox form (new credential + new R2 surface). |
| **Dependencies** | The provider actually sends such mail (UNKNOWN, RQ-6); the operator's mailbox; no new secret for the hand-copied form. |
| **First Concrete Action** | Operator searches their own mailbox for provider mail and for a statement/export control, then copies one artifact's figures into the S1 record, labelling `provenance: "provider_artifact_copied_by_operator"`. |
| **Named Blocker** | `PROVIDER_UNKNOWN` (no mailbox can be searched for the right sender until RQ-1 is answered). |
| **Verdict** | **PERMITTED as a manual copy; automated IMAP parsing is DEFERRED** (new credential, new dependency, and email cannot show a balance change that generated no email). |

### S5 (RANK 5 — REJECTED as a status source) — AgenticOS loopback metrics substitute

| Field | Value |
|---|---|
| **What it is** | `GET http://localhost:3001/api/v1/status/metrics` + `HEAD /api/v1/status`, the only allowlisted paths (`readonly_client.py:43-49`). |
| **Expected Effort** | 0.5 h to wire (`--source metrics_http` exists) **but** the route does not exist. |
| **Time-to-Record** | **NONE** — it reports local workstation metrics, never provider truth. |
| **Dependencies** | A process serving that exact path. |
| **First Concrete Action / evidence** | `[EXEC-21]` today: `curl` to `localhost:3001/api/v1/status/metrics` → **exit 7, HTTP 000** (nothing listening); `localhost:4600/api/v1/status/metrics` → **HTTP 404**; `localhost:4600/api/health` → **HTTP 200** (the app is up, the route is absent). |
| **Named Blocker** | `ROUTE_DOES_NOT_EXIST`. |
| **Verdict** | **REJECTED** — permitted at most as a degraded health probe; it must never be presented as account status. Note the `metrics_http` branch hard-codes `"data_available": True` before the read is attempted (`run_daily_check.py:66-76`) — standing it up would manufacture false confidence. |

### S6 (RANK 6 — PROHIBITED) — browser automation / session-cookie read (including the path already in the repo)

| Field | Value |
|---|---|
| **What it is** | Any scripted browser, cookie jar or scraper against freecash.com, **including** the already-wired `server/src/services/freeCash/freeCashExecutor.ts` navigate/read path, its startup resume pump (`server/src/index.ts:398`, `adapters.ts:1681`) and the `/:projectId/freecash/auth*` routes `[CARRIED]`. |
| **Expected Effort** | 6–12 h builder, unbounded maintenance, **and an R2 rewrite**. |
| **Time-to-Record** | Technically minutes; **economically negative** — it risks the account whose earnings it is supposed to protect. |
| **Dependencies** | A provider login and a stored session — both forbidden by this routine's own constraints and by R2. |
| **First Concrete Action** | **None. Do not build.** The compliant equivalent is S2. |
| **Named Blocker** | `TOS_PROHIBITS_AUTOMATED_AND_MANUAL_MONITORING` (§4.1) + `ROBOTS_SCOPING` (`Disallow: /user/`, `/myprofile`, `/fc-api/` …) `[FETCH-21]`. |
| **Verdict** | **REJECTED.** |

**Ranked order, one line each:** S1 operator-state file (works today, zero exposure) → S2 human dashboard read (permitted, human act, feeds S1) → S3a HG.Cash `GET /accounts` (real doc, KYC + unlinked + no credential) → S3b Cashfree `getBalance` (**structurally blocked**: 6-minute POST-minted token) → S4 passive email/statement copied by hand → S5 loopback metrics (not a status source) → S6 browser automation (prohibited).

---

## 2. BLOCKED — stated as blocked, with the accurate reason and the observed evidence

| # | Blocked item | Accurate reason (observed) |
|---|---|---|
| **BLOCKED-1** | **Any provider-verified read of the monitored account** | No provider is established for this entity, and **no credential exists anywhere in the environment**. `[EXEC-21]` `env \| grep -iE 'FREECASH\|SMTP_\|WEBHOOK_'` → the only match is `FREECASH_DATA_ROOT` (§2.4, a sandbox **path**, not a credential); `[EXEC-21]` read-only SQLite: `select count(*) from provider_credentials` → **0 rows** (columns: `provider_id, api_key, configured, masked_preview, validation_status, …`; no value read). `[EXEC-21]` `reg query "HKCU\Environment"` → no `FREECASH*`, `SMTP*`, `WEBHOOK*`, `HG_CASH*`, `CASHFREE*` entry. `[EXEC-21]` Hermes `.env` (`%LOCALAPPDATA%\hermes\.env`) variable **names only** → no `FREECASH`/`SMTP`/`WEBHOOK`/`HG_CASH`/`CASHFREE` name. |
| **BLOCKED-2** | **The identity of the monitored provider** | Unverifiable from the repository. `RESEARCH-PLAN.md`/`PROVIDER-CONTRACT-RESEARCH-V2.md` both conclude the name "Free Cash Finance Automation" is a **repo-internal construct** with no external vendor; `PROVIDER-API-RESEARCH.md` records that "which provider the monitored account actually sits on is UNVERIFIABLE from this repository". Only the operator can answer (RQ-1). |
| **BLOCKED-3** | **The provider read contract itself** | `monitoring/freecash/readonly_client.py:60` → `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"` (also `:27`, and `approval_queue.py:116`, asserted by `tests/test_r2_readonly.py:122`). `ALLOWED_PATHS` contains **two loopback regexes and no provider path** `[EXEC-21]`. This pass produced no provider read path for the monitored account, so **the literal stays verbatim and must not be substituted with an HG.Cash or Cashfree URL**. |
| **BLOCKED-4** | **Cashfree Payouts as a daily read** | Not an environment problem — a **structural** one: the read token is minted by `POST /payout/v1/authorize` and the vendor documentation states **"The generated token is valid for 6 minutes."** `[FETCH-21]` The monitor refuses all non-`GET`/`HEAD` methods by construction, so it can neither mint nor keep such a token. |
| **BLOCKED-5** | **HG.Cash as a daily read** | KYC-gated onboarding with no self-serve path `[FETCH-21]`: contact form → KYC with the HG.Cash team → approval → provisioning, and no evidence links the monitored account to HG.Cash. Even a perfect implementation would read a different entity's account. |
| **BLOCKED-6** | **The freecash.com route, in every form** | Contractually prohibited *and* naming monitoring explicitly: ToS §17.2 forbids any "robot, spider or other automatic device, process or means to access the Website **for any purpose, including monitoring** or copying", and also "any **manual process to monitor** … without our prior written consent"; §17.1 bans "macros, bots, scripts, or any other automation tools"; §16.1 restricts use to "personal, non-commercial use only"; §19 permits suspending or **voiding unredeemed Rewards**. `robots.txt` independently scopes out the account paths `[FETCH-21]` (§4.1, §5). |
| **BLOCKED-7** | **Verifying the R3 notification channel end-to-end** | Requires an external **write** (a message send) → R4 applies to the research too. `[EXEC-21]` no `SMTP_*`/`WEBHOOK_*` variable names exist; `himalaya`/`sendmail`/`mailx` ABSENT `[CARRIED]`. Telegram variable **names** exist in the Hermes `.env`; validity untested. The authorised sink proven delivering today is the append-only `alerts/alerts.jsonl`. |
| **BLOCKED-8** | **The daily read for `2026-09-21` itself (this pass)** | Not blocked by policy but by the routine's own R1: the last consumed day is `2026-09-20` and only a `2026-09-20.lock` exists `[EXEC-21]` — so a run today is *permitted by the lock*, but this research pass performs **no** run. (Also note `[EXEC-21]`: `alerts.jsonl` already contains a `MISSED_DAY 2026-09-21` alert written 2026-09-21T16:39:42Z because no check ran today.) |
| **BLOCKED-9** | **Any state read that is not from the frozen root** | `[EXEC-21]` the shell environment currently has `FREECASH_DATA_ROOT="C:\\Users\\cd-pr\\AppData\\Local/Temp/fc-live-probe"` **exported** (`declare -x`), which is **not** in `HKCU\Environment` and not set by any repo file. If the routine is launched from a shell carrying that override, it reads/writes a throwaway root: the day lock and `last-run.json` would not be found, and a second check in one calendar day becomes possible. **Fix: never export it for production runs** (see §6.4, RQ-13). |

---

## 3. Open research questions — each with the exact command or source that closes it

| Rank | ID | Question | Exact closing command / source |
|---|---|---|---|
| 1 | **RQ-1** | Which provider, if any, holds the monitored earning account? (freecash.com / HG.Cash / Cashfree / several / none) | One question to the operator: *"Which of these sends you payout emails or has a dashboard you can log into?"* No login, no credential, no network. |
| 2 | **RQ-2** | Is the operator-mediated read (S1+S2) the **permanent** design, or is provider-verified automation a hard requirement? | One question. A decision, not a probe. |
| 3 | **RQ-3** | If HG.Cash: does a token exist and does one hand-run `GET /accounts` return **200**? | Operator, out-of-band, never from the routine: `curl -s -o /dev/null -w 'code=%{http_code}\n' -H "Authorization: Bearer <REDACTED>" https://hg.cash/api/v1/accounts` — record **only** the code, field names, and the `status` string. |
| 4 | **RQ-4** | Is the wired freecash.com browser-automation path (`freeCashExecutor`, startup resume pump, `/:projectId/freecash/auth*`) to be contained, disabled, or knowingly accepted? | Read four call sites: `server/src/index.ts:398`, `server/src/services/backgroundTasks/adapters.ts:1681`, `server/src/routers/projects.ts:391-447`, `server/src/services/freeCash/freeCashExecutor.ts:337-388`. Operator decides; no execution. |
| 5 | **RQ-5** | Is the R3 notification channel actually live? | Operator authorises **one** test send (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_HOME_CHANNEL` names present). An external write ⇒ needs R4 approval ⇒ listed, not run. Zero-send alternative: `hermes cron status` + confirming Hermes' own notification path reaches it. |
| 6 | **RQ-6** | Does the provider send a periodic balance/status **email**, or offer a statement/export? | Operator searches their own mailbox / dashboard. Manual; no credential shared. |
| 7 | **RQ-7** | **Cashfree token TTL — RESOLVED TODAY: 6 minutes.** Remaining half: is the Payouts API **entitled** for this merchant? | (a) TTL: `[FETCH-21]` `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` → "The generated token is valid for 6 minutes." (b) Entitlement: operator's own merchant dashboard (Developers → API keys / Payouts); documented failure shape `403 "APIs not enabled. Please fill out the Support Form"` `[DOC]`. |
| 8 | **RQ-8** | Does HG.Cash publish **rate limits**? | `[FETCH-21]` `https://docs.hg.cash/llms.txt` contains **no** rate-limit entry (absence verified today). To close: email `api-support@hg.cash` (contact address printed in the OpenAPI `info.contact`). |
| 9 | **RQ-9** | HG.Cash payout **minimums / thresholds**? | Read the number off the operator's **own** withdrawal screen. Never encode a third-party figure. |
| 10 | **RQ-10** | Where would a provider token live if RQ-2/RQ-3 ever succeed? | Operator confirms: Hermes `.env` (`%LOCALAPPDATA%\hermes\.env`, outside the repo) **or** a `provider_credentials` row — names only, values `[REDACTED]`, never in a doc. |
| 11 | **RQ-11** | Is Task Scheduler `StartWhenAvailable` catch-up reliable for a plain daily trigger? | Microsoft restricts the property to tasks "with an end boundary or … repeat infinitely" `[CARRIED]`. Close only by a controlled created-task observation (out of scope here — this pass may not register a task). |
| 12 | **RQ-12** | Is the entity's activity **personal or commercial** under freecash §16.1? | One question to the operator. A business determination, not a fetchable fact. |
| 13 | **RQ-13** | Will the shell that launches the routine carry `FREECASH_DATA_ROOT` (which would silently relocate R1 state)? | `[EXEC-21]` `export -p \| grep -i freecash` → **one line today** (`…Temp/fc-live-probe`); `reg query "HKCU\Environment" \| grep -i freecash` → **no match** (not persistent). Close by running the routine with `env -u FREECASH_DATA_ROOT python monitoring/freecash/run_daily_check.py`, or by `unset FREECASH_DATA_ROOT` before launch, and re-checking `ls data/freecash-monitor/state/day-locks/`. |
| 14 | **RQ-14** | Does Cashfree's merchant contract permit this use at all, and is the entity an Indian-registered merchant? | Fetch `https://www.cashfree.com/tnc/` (Website Merchant Terms and Conditions) and read the API-integration clause: KYC + a signed agreement are preconditions, and the API licence is granted "**for India**", non-transferable, limited to the Merchant's own website. Search-snippet level today — **fetch to close**. |
| 15 | **RQ-15** | For freecash.com: does §17.2's "no **manual** monitoring without prior written consent" bite on a standing daily hand-read, and is written consent obtainable? | Fetch the ToS §17.2 bullet (source: `https://freecash.com/en/policies/terms`) and, if the operator wants certainty, request written consent from `support@freecash.com`. Until answered, treat the manual path as un-consented and operator-owned. |
| 16 | **RQ-16** | Which exact strings does the operator's dashboard show for "earnings" and "status"? | Operator copies the visible **labels** verbatim once (they are `UNVERIFIED` today; the repo's field names are its own record shape, not provider labels). |

---

## 4. Legal / Terms-of-Service boundary, per provider name

### 4.1 freecash.com (Almedia GmbH) — the platform that forbids monitoring by name

- **Is automated API access permitted at all?** **No.** There is no public developer API, and automated access is prohibited outright. `[FETCH-21]` `https://freecash.com/robots.txt` (fetched today, complete file) → `User-Agent: *`, `Allow: /`, then `Disallow:` `/user/`, `/myprofile`, `/r/`, `/_next/`, `/_ipx/`, `/offer/`, `/fc-api/`, `/scd-cgi/`, `/w/`, `/dev-playground/`, `/*mailto:*`. `[FETCH-21]` `https://freecash.com/en/policies/terms` → page states **"Terms of Service (Effective: July 17, 2026)"** and the heading **"17. Restrictions and Prohibited Uses"** is present; the specific bullets inside §17 are elided in today's extraction, so the verbatim quotes below are `[CARRIED]` from two prior live fetches (2026-09-18, `PROVIDER-FINDINGS-REVERIFIED.md` Q1.1; 2026-09-20, `PROVIDER-DECISION-PACKET-2026-09-20-v2.md` §3):
  > §17.2 — "Use any robot, spider or other automatic device, process or means to access the Website for any purpose, **including monitoring** or copying any of the material on the Website."

  > §17.2 — "Use any **manual process to monitor** or copy any of the material on the Website, or for any other purpose not expressly authorized in these Terms of Services, **without our prior written consent**."

  > §17.1 — "To use **macros, bots, scripts, or any other automation tools** designed to simulate or replicate human user activity … Such behavior is **strictly prohibited**."

  > §16.1 — "These Terms of Services permit you to use the Website for your **personal, non-commercial use only**."

  > §19 — "Terminate or suspend your access to all or part of the Website for any or no reason, including without limitation, any violation of these Terms of Services." / "… may **suspend or void any Rewards** … not yet successfully redeemed".
- **What the operator must personally do:** log in **themselves**, read their own figures, and copy them into `operator-state.json`. That is the entire compliant provider-side act.
- **What the routine may never do:** issue **any** request — `GET` included — to any freecash.com host or path, for any purpose, including "just a status check"; hold a session cookie; drive a browser; automate clicks or offer tasks; **and it may not re-probe `/fc-api/`**, which is robots-disallowed and undocumented (`PROVIDER-FINDINGS-REVERIFIED.md` records it deliberately unanswered).
- **Consequence if breached:** account restriction **plus potential forfeiture of unredeemed rewards** (§19) — i.e. a breach risks the very balance the monitor exists to protect.

### 4.2 freecash.io — not a platform (no boundary to record beyond "nothing here")

`[CARRIED]` (prior live fetches, 2026-09-17/18): the domain serves a 114-byte client-side redirect to `https://forsale.godaddy.com/forsale/freecash.io` — a parked for-sale lander, not an operating service. **Automated access: not applicable; there is no service, no account and no API.** Any design asserting "FreeCash.io Platform APIs" with an `X-API-Key` header is built on a parked domain and on a third-party wrapper's key — must not be trusted (`server/data/freecash-monitor/INTEGRATION_STATUS.md` and the Hermes `automated-status-monitor` skill's `references/api-compliance.md` both assert exactly that, and both are wrong).

### 4.3 HG.Cash — automation permitted; the boundary is access, not automation

- **Is automated API access permitted?** **Yes — that is the API's documented purpose** ("Implement in your backend services (never expose tokens in frontend)"; MIT-licensed spec) `[FETCH-21]`. `[CARRIED]` no automation prohibition exists in the docs index or `docs.hg.cash/robots.txt`.
- **What the operator must personally do:** complete **KYC onboarding** first (`[FETCH-21]` `https://docs.hg.cash/introduction.md`: contact form → KYC with the HG.Cash team → approval → provisioning; "**do not assume access is granted** until HG.cash confirms that KYC … are completed or approved"), then **generate the API token by hand in account settings** `[FETCH-21]`. The operator owns the token and must keep it outside the repository.
- **What the routine may never do:** call any **write** path — `POST /transactions` (the cash-out / "money leaving your accounts" endpoint), `POST /checkouts` (+ cancel), `POST /claims`, BR/CL/BO inbound/outbound, USDT withdrawal, withdrawal-wallet verify/sign, `POST /alias-lookup`; and it may not hold the client secret or mint anything. Read-only means **`GET` only**.
- **Caveat that must travel with any HG.Cash plan:** HG.Cash does **not** publish separate read vs write scopes — the same bearer token can also call `POST /transactions`. Read-only-ness is therefore enforced **by this client's `GET`/`HEAD` allowlist**, never by the credential.

### 4.4 Cashfree Payouts — automation permitted in principle, gated in practice; the boundary is a POST + 6-minute token + India

- **Is automated API access permitted?** **Yes**, in the sense that programmatic use is the documented purpose of the Payouts API. `[FETCH-21]` `https://www.cashfree.com/docs/llms.txt` (index) contains **no** automation-prohibition entry. **But** the merchant-side contract adds two conditions that matter here (`[DOC — search-snippet level, fetch to close: RQ-14]`, `https://www.cashfree.com/tnc/`): "You shall not integrate with Cashfree for any Services … unless You have completed the KYC and entered into an appropriate agreement with Us"; and the API licence is granted "**for India**", revocable, non-transferable, non-sublicensable, with restrictions against reverse engineering, benchmarking, unreasonable load, and circumventing security **or usage limits**.
- **What the operator must personally do:** establish that an entitled, KYC-verified merchant account exists (Cashfree is an Indian payments company; nothing ties it to the monitored account); if so, obtain `X-Client-Id` + `X-Client-Secret` from the dashboard by hand.
- **What the routine may never do:** mint the bearer token (`POST /payout/v1/authorize` — carrying the client secret is a capability this routine must not have), initiate/standard/direct/batch transfers, Cashgram create/redeem, OneEscrow allocate / initiate payout / internal transfer / whitelist bank account, beneficiary mutation, or hold a client secret at all.
- **The new decisive fact:** the token lives **6 minutes** `[FETCH-21]`. A daily `GET`-only read therefore cannot be authenticated with a token minted by hand, and cannot mint one itself. Cashfree is **structurally closed** to this design; recorded so it is not re-opened by "the docs say getBalance exists".

### 4.5 Third-party wrapper `parse.bot` ("Freecash API") — prohibited by proxy and useless by construction

Its own listing states it is "not an official freecash.io API" and that "Freecash does not publish a documented public developer API". It reads **public platform-wide data** (`get_leaderboard`, `get_withdrawals`, `get_stats`, …) with `is_authenticated: false` — it has no notion of "your account". Using it to read freecash.com content remains a freecash.com §17 breach. **Never use; never cite as a provider contract.**

### 4.6 `getfreecash.com` and `api.freecash.com` — dead leads, recorded so they are not re-probed

`[CARRIED]` `https://getfreecash.com/` → HTTP 200 with body literally `OK`, `Content-Type: application/octet-stream` (openresty) — a placeholder responder, not a service. `https://api.freecash.com/v1/status` → repo-recorded **404** from a prior pass and **not re-probed here by design** (a provider host; freecash §17.2 forbids it). Both stay `[CARRIED]`, never re-derived, never allowlisted.

---

## 5. Endpoint register — every claimed endpoint in the prior repo docs, marked VERIFIED or UNVERIFIED

Rule applied: **VERIFIED requires a primary-source URL read *or* a documented site observed in this pass or a named prior fetch; anything else is UNVERIFIED and the provider read path for the monitored account stays the literal `PROVIDER_ENDPOINT_UNKNOWN`.**

| # | Claimed endpoint (as it appears in repo docs) | Where claimed | Class | Status | Primary source / basis |
|---|---|---|---|---|---|
| 1 | **The monitored account's provider balance/earnings/status read** | `ROUTINE-DESIGN.md` W3/W4; `readonly_client.py:27,60`; `approval_queue.py:116`; `tests/test_r2_readonly.py:24` | provider read (unknown) | **PROVIDER_ENDPOINT_UNKNOWN** — literal kept verbatim, **not** substituted by rows 4–7 | No primary source exists for *this* account. **PROVIDER_ENDPOINT_UNKNOWN** |
| 2 | `GET https://api.freecash.com/v1/status` | `server/scripts/freecash-daily-monitor.mjs:32`; `PROVIDER-CONTRACT-RESEARCH-V2.md:205` | invented provider endpoint | **UNVERIFIED** (deader than dead: no documentation exists; a prior pass recorded HTTP 404 — **not re-probed in this pass**, deliberately) | none — no vendor doc; `ROUTINE-DESIGN.md:193` already says it "is **not** grounded in anything and must not be carried forward" |
| 3 | `POST /withdraw`, `POST /survey/complete<id>` against freecash.com | `docs/freecash-monitoring.md:69,93` | invented + R2/R4-violating | **UNVERIFIED** — and prohibited (§4.1) | none — no freecash.com API documentation exists |
| 4 | `GET https://hg.cash/api/v1/accounts` | `RESEARCH-PLAN.md:32,48`; `PROVIDER-CONTRACT-RESEARCH-V2.md:159` | provider read-only | **VERIFIED as documented** `[FETCH-21]`; liveness probe (`401`) is `[CARRIED]` 2026-09-18 | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` — `GET /accounts`, `operationId getUserAccounts`, servers `https://hg.cash/api/v1` (prod) / `http://dev.hg.cash/api/v1` (dev), global `security: bearerAuth`, description "Returns the authenticated user's accounts, including ledger balance, pending fees, net available balance … and account status" |
| 5 | `GET https://hg.cash/api/v1/account/{id}/balance` | `RESEARCH-PLAN.md:48`; `PROVIDER-FINDINGS-REVERIFIED.md` Q3.2 | provider read-only | **VERIFIED as documented** `[FETCH-21]` | `https://docs.hg.cash/api-reference/accounts/get-account-balance` — `get /account/{id}/balance`, `operationId getAccountBalance`, path param `id` (uuid); fields `id, balance, currency, pendingFees, netBalance, status`; enum `Operativa \| Bloqueada \| Cerrada` `[CARRIED detail, 2026-09-20]` |
| 6 | HG.Cash bearer scheme `Authorization: Bearer cash_<64-hex>`, token generated in **account settings** | `PROVIDER-CONTRACT-RESEARCH-V2.md:158,260` | auth model | **VERIFIED** `[FETCH-21]` | same docs page (`info.description`): "**Generate your API token** in the account settings page"; "This API uses **Bearer Token** authentication … `Authorization: Bearer cash_your_token_here`". *Access itself is KYC-gated — row 8.* |
| 7 | HG.Cash write paths: `POST /transactions` (cash-out), `POST /checkouts` (+cancel), `POST /claims`, BR/CL/BO inbound/outbound, USDT withdrawal, `POST /alias-lookup` | `PROVIDER-CONTRACT-RESEARCH-V2.md:162` | provider write | **VERIFIED as documented** `[FETCH-21]` (`POST /transactions` = "To create cash-outs (money leaving your accounts)… You must call the **Cash Out** endpoint") | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` (info block), `https://docs.hg.cash/api-reference/transactions/create-transaction-request-cash-out.md` (indexed in `docs.hg.cash/llms.txt` `[FETCH-21]`). **Denied to the monitor — no exemption.** |
| 8 | HG.Cash access is self-serve (no approval step) | `RESEARCH-PLAN.md:48`; `PROVIDER-FINDINGS-REVERIFIED.md` Q3.3 | access gate | **CORRECTED — access is KYC-gated**, self-serve only *inside an existing, approved account* | `[FETCH-21]` `https://docs.hg.cash/introduction.md` + `https://docs.hg.cash/` (Introduction: contact form → KYC → approval → provisioning; "do not assume access is granted") |
| 9 | HG.Cash rate limits | `RESEARCH-PLAN.md:126` | operational limit | **UNVERIFIED — none published**; docs index contains no rate-limit entry `[FETCH-21]` | `https://docs.hg.cash/llms.txt` (complete index fetched; no rate-limit page). Close via `api-support@hg.cash` (RQ-8) |
| 10 | `GET https://payout-api.cashfree.com/payout/v1/getBalance` | `PROVIDER-API-RESEARCH.md:140`; `RESEARCH-PLAN.md:33` | provider read-only | **VERIFIED as documented** `[FETCH-21]` **and** application-level response **observed today** `[EXEC-21]`: `{"status":"ERROR","message":"Token is not valid","subCode":"403"}` — this **corrects** the prior "edge 403 HTML" finding | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` — `get /payout/v1/getBalance`, `operationId get-balance1`, servers `https://payout-api.cashfree.com` / `https://payout-gamma.cashfree.com`, required headers `Authorization` + `Content-Type`, responses `200` (`data.balance`, `data.availableBalance`), `403 "Token is not valid"`, `412 "Token missing in the request"` |
| 11 | `GET https://payout-api.cashfree.com/payout/v1.2/getBalance` (+ optional `paymentInstrumentId`) | `PROVIDER-API-RESEARCH.md:127`; `PROVIDER-CONTRACT-RESEARCH-V2.md:179` | provider read-only | **VERIFIED as documented** (page fetched `[FETCH-21]`: "Get Balance V1.2", headers `Authorization` (required), `Content-Type` (required), query `paymentInstrumentId`); the embedded spec's exact path string is `[CARRIED]` 2026-09-18 | `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12` |
| 12 | `POST https://payout-api.cashfree.com/payout/v1/authorize` (token minting; `X-Client-Id` + `X-Client-Secret`; optional `X-Cf-Signature`) | `PROVIDER-API-RESEARCH.md:131`; `PROVIDER-CONTRACT-RESEARCH-V2.md:180` | provider **write** (token) | **VERIFIED as documented** `[FETCH-21]`, **and its token TTL is now documented: "The generated token is valid for 6 minutes."** | `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` — `post /payout/v1/authorize`, `operationId authorize-2`; "All other API calls must have this token as Authorization header … 'Bearer <token>'". **Denied to the monitor** (R2) |
| 13 | Cashfree Get Balance **rate limits** | `PROVIDER-API-RESEARCH.md:144` | operational limit | **UNVERIFIED** for Get Balance (generic `X-RateLimit-*`/`429` mechanism documented; no Get Balance figure published) | `[FETCH-21]` `https://www.cashfree.com/docs/llms.txt` index — no Get Balance limit entry found |
| 14 | parse.bot wrapper `GET https://api.parse.bot/scraper/{scraper_id}/{endpoint_name}` with `X-API-Key` and endpoints `get_leaderboard`, `get_withdrawals`, `get_stats`, `get_offer_categories`, `get_featured_offers`, `get_cashout_methods` | `PROVIDER-API-RESEARCH.md:160-162`; `RESEARCH-PLAN.md:130` | third-party scraper | **UNVERIFIED — and unusable by construction.** No primary vendor documentation exists; the source domain is a parked lander; `is_authenticated: false` ⇒ no account notion | only the third party's own marketplace listing; must never be treated as a provider contract |
| 15 | `GET /withdrawals` returning `total_earnings` (FreeCash.io, `X-API-Key`) | Hermes skill `optional-skills/serverops/automated-status-monitor/references/api-compliance.md:12,64-65`; `server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33` | invented | **UNVERIFIED** (`RESEARCH-PLAN-V4.md:380` calls the skill "**must not be trusted**"; the `X-API-Key` is parse.bot's, not FreeCash's) | none |
| 16 | `https://api.example.finance/v1` | `finance-monitor/src/api_client.py:22,57-73`; `PROVIDER-CONTRACT-RESEARCH-V2.md:206` | placeholder | **DEPRECATED** — never called; a mock | repo stub |
| 17 | `GET http://localhost:3001/api/v1/status/metrics` | `ROUTINE-DESIGN.md:188`; `readonly_client.py:44` | local substitute | **VERIFIED absent today** `[EXEC-21]` — `curl` → exit 7, HTTP 000 (nothing listening) | loopback probe, §7.2 |
| 18 | `HEAD http://localhost:3001/api/v1/status` | `ROUTINE-DESIGN.md:189`; `readonly_client.py:45` | local health | **VERIFIED absent today** (same listener evidence as row 17; `localhost:4600/api/v1/status/metrics` → 404 while `/api/health` → 200, so the app is up and the route is missing) | loopback probe, §7.2 |
| 19 | `https://freecash.com/api/sitemap/{1..5}/sitemap.xml` | `PROVIDER-DECISION-PACKET-2026-09-20-v2.md:131` | site index (not an API) | **VERIFIED as a site index only** `[CARRIED]` 2026-09-20 (5 `<loc>` entries, no developer/API/partner page) | `https://freecash.com/sitemap.xml` |
| 20 | `https://getfreecash.com/` | `PROVIDER-API-RESEARCH.md:86` | dead lead | **VERIFIED not a service** `[CARRIED]` (HTTP 200, body `OK`, `application/octet-stream`) | prior live probe 2026-09-17 |
| 21 | `https://freecash.io/` (+ `/lander`) | `PROVIDER-API-RESEARCH.md:73-74` | dead lead | **VERIFIED not a platform** `[CARRIED]` (114-byte JS redirect → GoDaddy `forsale` lander) | prior live fetch 2026-09-17/18 |

**Count of unresolved provider-facing items that stay literally `PROVIDER_ENDPOINT_UNKNOWN`:** the monitored account's balance/earnings read **and** its account-status read (round 1 row 1) — the only two the routine genuinely needs. Everything else in this table is either a documented *different* provider's endpoint or a disproven claim.

---

## 6. What would falsify this plan

This plan is wrong, and must be rewritten, if **any** of the following turns out to be true. Each is stated with the check that would settle it.

1. **The operator holds an HG.Cash account tied to the monitored balance, and one hand-run `GET /accounts` returns 200.** Then S3a is not CONDITIONAL but AVAILABLE, `PROVIDER_ENDPOINT_UNKNOWN` becomes wrong for that account, and the plan must be re-issued with a concrete allowlist line and a source→field mapping. *(Check: RQ-3, one `curl` and its status code.)*
2. **The operator holds an entitled Cashfree merchant account whose token lifetime is not 6 minutes** (e.g. a long-lived token issued out-of-band, or a documented longer TTL). Then S3b's structural rejection collapses. *(Check: RQ-7 + the operator's dashboard. Today the docs say 6 minutes — that is the falsifiable claim.)*
3. **A freecash.com API exists under a private/partner contract that the operator holds.** Then the ToS-driven prohibition on the *contractual* side would be replaced by an authorised channel, and §4.1/§4.6 must be rewritten. *(Check: operator produces the contract; no public evidence exists for one.)*
4. **The browser-automation path (`freeCashExecutor` + resume pump) is removed or contained in code.** Then §1-S6's "already wired capability" warning is stale and must be updated — though the prohibition itself stands regardless. *(Check: `grep -rn "freecash" server/src/services/freeCash/ server/src/index.ts` after a change.)*
5. **A credential genuinely exists** — `provider_credentials` > 0 rows, or a `FREECASH*`/`HG_CASH*`/`CASHFREE*`/`SMTP_*`/`WEBHOOK_*` variable name in the environment or the Hermes `.env`. Then BLOCKED-1 is false. *(Check: the exact three commands in §2, rerun.)*
6. **The routine is launched from a shell with `FREECASH_DATA_ROOT` set** (true in this pass's shell `[EXEC-21]`). Then the frozen-root decision is violated in practice: the day lock and `last-run.json` are not found, and R1 "exactly one read per local day" is no longer enforced by the artefact the plan relies on. *(Check: RQ-13.)*
7. **The provider's own mail/statement is the only place a partial balance appears, and a mailbox credential is later added.** Then S4 escalates from "manual copy" to an automated passive source and the plan's "no mailbox automation" line is over-taken. *(Check: RQ-6 + whether any `IMAP*`/`SMTP*` name ever appears.)*
8. **The ToS text changes** — freecash.com §16/§17/§19 weakened, or written consent obtained (RQ-15). Then §4.1's prohibition is no longer accurate as quoted. *(Check: re-fetch `https://freecash.com/en/policies/terms` and compare the "Last Updated"/"Effective" date and the §17 bullets; today's fetch shows Effective 2026-07-17.)*
9. **Any number in this document that claims to be an account figure.** There are none, and none may be added without a provider read. If a future pass produces a balance without an authenticated read, that is fabrication, and it falsifies the pass, not this plan.

---

## 7. Sources, executed commands, and prior art cited

### 7.1 Primary documents fetched in this pass (2026-09-21)

| # | URL | Observed |
|---|---|---|
| 1 | `https://docs.hg.cash/api-reference/accounts/get-user-accounts` | HTTP 200; `get /accounts`; servers prod/dev; `security: bearerAuth`; "Generate your API token in the account settings page" |
| 2 | `https://docs.hg.cash/api-reference/accounts/get-account-balance` | HTTP 200; `get /account/{id}/balance` |
| 3 | `https://docs.hg.cash/llms.txt` | HTTP 200; complete doc index — **no rate-limit page** |
| 4 | `https://docs.hg.cash/introduction.md` | HTTP 200; contact form → KYC → approval ("do not assume access is granted") |
| 5 | `https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance` | HTTP 200; `get /payout/v1/getBalance`; responses 200/403/412 |
| 6 | `https://www.cashfree.com/docs/api-reference/payouts/v1/authorize` | HTTP 200; **"The generated token is valid for 6 minutes."** |
| 7 | `https://www.cashfree.com/docs/api-reference/payouts/v2/get-balance-v12` | HTTP 200; "Get Balance V1.2"; `Authorization` + `Content-Type` required; optional `paymentInstrumentId` |
| 8 | `https://www.cashfree.com/docs/llms.txt` | HTTP 200; Payouts doc index; no automation-prohibition entry |
| 9 | `https://freecash.com/robots.txt` | HTTP 200; complete file reproduced in §4.1 |
| 10 | `https://freecash.com/en/policies/terms` | HTTP 200; "Effective: July 17, 2026"; §17 heading present; §17 bullets elided in this extraction (quotes are `[CARRIED]`) |
| 11 | `https://payout-api.cashfree.com/payout/v1/getBalance` (**unauthenticated, no credential — see §0.3**) | `{"status":"ERROR","message":"Token is not valid","subCode":"403"}` |

### 7.2 Commands executed in this pass (read-only)

`env | grep -iE 'FREECASH|SMTP_|WEBHOOK_'` → one line, `FREECASH_DATA_ROOT` (**path**, not a credential) ·
`export -p | grep -i freecash` → `declare -x FREECASH_DATA_ROOT="…/Temp/fc-live-probe"` ·
`reg query "HKCU\Environment"` (grep `freecash|smtp|webhook|cash|token|secret`) → **no match, exit 1** ·
`grep -oE '^[A-Za-z_][A-Za-z0-9_]*' "$LOCALAPPDATA/hermes/.env"` (names only) → no `FREECASH`/`SMTP`/`WEBHOOK`/`HG_CASH`/`CASHFREE` ·
read-only SQLite `file:server/data/agentic-os.db?mode=ro` → `select count(*) from provider_credentials` = **0** ·
`curl` `http://localhost:3001/api/v1/status/metrics` → **exit 7 / HTTP 000** ·
`curl` `http://localhost:4600/api/v1/status/metrics` → **404** · `curl http://localhost:4600/api/health` → **200** ·
`cat data/freecash-monitor/state/operator-state.json` → `"records": []` ·
`cat data/freecash-monitor/state/last-run.json` → `last_attempt_day/last_success_day 2026-09-20`, `last_outcome MONITOR_DEGRADED`, `consecutive_missed_days 0`, `timezone Europe/Berlin` ·
`ls data/freecash-monitor/state/day-locks/` → only `2026-09-20.lock` ·
`tail data/freecash-monitor/alerts/alerts.jsonl` → `MONITOR_DEGRADED` (2026-09-20), `SKIP_DUPLICATE_DAY` (2026-09-20), **`MISSED_DAY 2026-09-21` (2026-09-21T16:39:42Z)** ·
`grep -rn PROVIDER_ENDPOINT_UNKNOWN monitoring/freecash/` → `readonly_client.py:27,48,60`, `approval_queue.py:116`, `tests/test_r2_readonly.py:24,122` ·
`ls -la docs/free-cash-monitor-routine/` and `ls -la monitoring/freecash/` (inventory).

### 7.3 Prior art read and cited in this pass

`PROVIDER-API-RESEARCH.md` · `PROVIDER-CONTRACT-RESEARCH-V2.md` · `PROVIDER-FINDINGS-REVERIFIED.md` ·
`PROVIDER-DECISION-PACKET-2026-09-20-v2.md` (and v1 by reference) · `RESEARCH-PLAN.md` · `RESEARCH-PLAN-V4.md` ·
`RULE-GATE-CHECKLIST.md` · `ROUTINE-DESIGN.md` · `docs/freecash-daily-monitor-research-plan-v2.md`
(the task named this as `docs/freecash-monitor-research-plan-v2.md`; the file that exists on disk is
`docs/freecash-daily-monitor-research-plan-v2.md` — `docs/freecash-monitor-research-plan.md` is its v1)
· `docs/freecash-monitor-audit-evidence.md`, `docs/freecash-monitoring.md` (cited where they assert endpoints) ·
`AUDIT-RULE-COMPLIANCE.md`, `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` (inventory only, not relied on).

### 7.4 Additive-only statement

No existing file was modified, moved, renamed or deleted. No `git` write verb was run. No credential was
requested, read, typed or stored. No email, message, webhook or provider account action was taken; the
single unauthenticated documentation-batch GET to the Cashfree production balance URL is disclosed in §0.3
and returned only an auth error. No scheduled task or cron entry was created. The one artefact of this pass
is this document.

---

## 8. One-paragraph recommendation

**Keep the routine exactly as it is — S1, the operator-entered `operator-state.json`, is the only authorised read source today — and stop looking for a provider API until the operator answers one question: which provider holds the account?** The routine already enforces R1–R4 by construction, already runs, and its only real defect is that `records` is empty; filling in four figures a day converts it from `MONITOR_DEGRADED` to a genuine (if self-attested, `degraded: true`) daily status record. The provider branch is not merely unavailable, it is now demonstrably worse than "unavailable": freecash.com forbids automated **and** manual monitoring by name, HG.Cash is KYC-gated with no account link, and Cashfree Payouts — the only provider whose docs looked usable — mints its read token with a `POST` and expires it after **six minutes**, which this `GET`-only transport can never satisfy. The literal `PROVIDER_ENDPOINT_UNKNOWN` therefore stays exactly where it is, the routine touches no provider host, and every future improvement (derived `degraded`, source→field mapping, notification delivery proof, task registration) is a change to how the routine **represents** an operator-supplied reading — never a licence to read the account itself.

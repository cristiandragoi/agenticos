# Research Plan — Read-Only Daily Status Monitor for "Free Cash Finance Automation"

**Date:** 2026-09-17 · **Host:** Windows 11 workstation, `D:\AgenticOS` · **Target dir:** `D:\AgenticOS\docs\free-cash-monitor-routine\`

**Approval of scope:** This document is research only. It creates no scheduled task, stores no credential, and calls no provider endpoint that requires authentication. Every claim below is either (a) backed by a URL that was actually fetched, or (b) backed by a command actually run on this host, or (c) explicitly labelled `COULD NOT VERIFY`.

**Rules the design must obey:** R1 one check/day · R2 zero automated earning actions · R3 notify on earnings/account-status change · R4 human approval before any external action.

---

## 0. Headline findings that drive the whole design

| # | Finding | Evidence | Confidence |
|---|---------|----------|-----------|
| F1 | **freecash.com (Almedia GmbH) forbids automated access outright** — including for monitoring. ToS §17: *"Use any robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website."* | <https://freecash.com/en/policies/terms> (Section 17, verbatim) | HIGH |
| F2 | **freecash.com has no public developer API.** `/docs` → HTTP 404, `/developers` → HTTP 404 (probed on this host). Its account paths `/user/`, `/myprofile/`, and internal `/fc-api/` are explicitly `Disallow`ed in robots.txt. | probed <https://freecash.com/docs>, <https://freecash.com/developers>, <https://freecash.com/robots.txt> | HIGH |
| F3 | **`freecash.io` is not a platform** — the domain is a parked GoDaddy "for sale" lander. Any design that assumes "FreeCash.io" endpoints is built on sand. | probed `curl -L https://freecash.io/` → GoDaddy `forsale` lander | HIGH |
| F4 | **The repo's existing "monitor" does not acquire data.** `scripts/make_freecash_check.py` `fetch_status()` is a hardcoded stub returning `{"balance": 0, ...}`; `run_action()` is a stubbed `return True`. It logs zeros. | read `D:\AgenticOS\scripts\make_freecash_check.py` lines 14–15, 49–52 | HIGH |
| F5 | **A real, documented, read-only balance API does exist for HG.Cash** (`GET /accounts`, `GET /account/{id}/balance`) — Bearer token generated self-serve in the dashboard. Unauthenticated probe returns HTTP 401, confirming the endpoint is live. | <https://docs.hg.cash/api-reference/accounts/get-user-accounts>; probed `curl https://hg.cash/api/v1/accounts` → 401 | HIGH |

**Consequence:** for freecash.com specifically, *every* automated acquisition path (API, scripted browser, scraper) is a ToS violation with account-restriction downside. The compliant acquisition options are the operator's own manual login plus a machine-readable state file, or an *official* API belonging to whichever provider the entity actually banks with.

---

## 1. Decision table

Each row: **Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action**. Time-to-Revenue = when the operator gets measurable earnings *visibility*, with the reason.

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **★ RECOMMENDED — Operator-entered state file + append-only history log** | 1–2 h | **Same day (day 1).** Visibility begins the first time the operator writes one line; there is no integration to build and no ToS exposure, so nothing can block it. | A writable folder under `docs/free-cash-monitor-routine/`; the operator's own ~60 s daily login to their own dashboard (ordinary personal use, expressly permitted by ToS §16). | Create `state/status.jsonl` and append the seed record (exact command in §5, Step 1). |
| **Alt A — HG.Cash documented read-only API poll** (`GET /accounts`) | 4–8 h | **3 days – 2 weeks.** Blocked until the operator confirms the entity holds an HG.Cash account and generates a dashboard token; after that, visibility is automatic daily and needs no human. | HG.Cash account; dashboard-generated Bearer token stored in the hermes `.env` (**not** in the repo); outbound HTTPS. | Confirm account ownership, generate token, then `curl -H "Authorization: Bearer $HG_CASH_TOKEN" https://hg.cash/api/v1/accounts` and confirm HTTP 200 (401 without token). |
| **Alt B — Cashfree Payouts documented balance API** | 4–8 h | **1–4 weeks.** The endpoint is documented, but access is gated: an unentitled account receives HTTP 403 *"APIs not enabled. Please fill out the Support Form"*, so the clock is an activation queue, not engineering. | Cashfree merchant account with Payouts API **enabled** (activation request required); Bearer token in the hermes `.env`. | Submit the Payouts API activation request, then poll `GET https://payout-api.cashfree.com/payout/v1/getBalance`. |
| **Alt C — Authenticated browser session with an existing user-owned profile (read-only page inspection)** | 4–6 h | **1–2 days to working, but negative expected value.** ToS §17 bans automatic processes "for any purpose, including monitoring", and robots.txt disallows `/user/` and `/myprofile`; the realistic downside is account restriction or loss of unredeemed rewards (ToS §19). | User-owned browser profile; live 2FA handling; ongoing session maintenance; stored credentials. | **Do not build this.** Instead record the rejection in `DECISIONS.md` citing ToS §17 + robots.txt, so it is not re-proposed. |
| **Alt D — Email / provider-notification parsing** | 3–5 h | **2–4 days, conditional.** Only produces value if the provider actually emails balance or status changes; freecash.com commits only to send "essential service-related communications" (ToS §15.2) and closure notices (§11), not a periodic balance mail. | A local mail client or IMAP app-password stored in the hermes `.env`; a provider that sends such mail. | Search the operator's existing mailbox for past freecash.com account emails and establish whether any periodic balance/status mail exists. |
| **Alt E — Official statement / export download (manual)** | 1–2 h | **2 days** — does not drive the daily loop, but it is what makes the daily log defensible at tax time. | A provider-side export/statement control must exist. Documented for HG.Cash (dashboard); `COULD NOT VERIFY` for freecash.com. | Open the provider dashboard, check for an export/download control, and record whether one exists. |

---

## 2. Findings by research question

### Q1 — Which real services exist, and what official read-only access do they offer?

| Service | What it is | Official read-only way to see balance / earnings / status | Gating & ToS posture | Confidence |
|---|---|---|---|---|
| **freecash.com** (Almedia GmbH, Berlin; US gift-card entity Almedia USA Inc.) | Rewards/offerwall platform: play games, offers, surveys → coins → cashout. Claims 80M+ signups, >$300M paid out. | **None.** No public developer API; `/docs` and `/developers` 404. `robots.txt` disallows `/user/`, `/myprofile`, `/fc-api/`. Balance is visible only in the logged-in dashboard. | **ToS forbids automation outright** (§17 "robot, spider or other automatic device, process or means… including monitoring"), personal non-commercial use only (§16), one account per household (§2), VPN/proxy/emulator prohibited (§17), KYC before first payout (§9), Almedia may void unredeemed rewards on violation (§19). | HIGH |
| **freecash.io** | **Not a platform.** Parked GoDaddy lander. | None. | n/a | HIGH |
| **HG.Cash** | Settlement/payout provider (ARS bank rails, USDT, checkouts; LatAm focus). | **Yes — documented public API.** `GET /accounts` → per-account `id, name, balance, pendingFees, netBalance, status (Operativa / Bloqueada / Cerrada), currency`; `GET /account/{id}/balance` for one account. Base URL `https://hg.cash/api/v1`. | Bearer token generated **self-serve** in account settings (no partner approval needed). Docs explicitly instruct: "never expose tokens in frontend", store on backend only. Write side (`POST /transactions`) is a separate, clearly-labelled cash-out endpoint. | HIGH |
| **Cashfree Payouts** | Indian payments/payouts gateway. | **Yes — documented public API.** `GET /payout/v1/getBalance` → `balance`, `availableBalance` (docs also reference a "View Balance V1.2"). | **Gated behind activation**: unentitled accounts get HTTP 403 *"APIs not enabled. Please fill out the Support Form"*. Requires merchant account. | HIGH for the endpoint; the v1.2 path string is `COULD NOT VERIFY` (see §3.7). |
| **"Free Cash Finance Automation" as a product** | **No external product found.** Every reference is internal to this repo (`data/boards.json`, `design_doc.json`, `finance_monitor_plan.json`, `docs/research-workflows/…`, `data/selfheal-audit.jsonl`). | n/a | n/a | `COULD NOT VERIFY` (see §3.1) |

**Decision:** treat "Free Cash Finance Automation" as an **internal AgenticOS entity**, not a vendor with an API. The only provider with a documented read-only balance API that this repo has previously associated with the entity is **HG.Cash** — and whether the entity actually holds an HG.Cash account is unverified (§3.2). The only *rewards platform* in scope, freecash.com, has no official read-only path at all.

### Q2 — If no official API exists: compliant observation options and their risk

| Option | ToS-compliant? | Stored credentials? | Ban / anti-bot risk | Verdict |
|---|---|---|---|---|
| **(a) Manual entry by operator into a state file** | **Yes.** ToS §16 permits personal, non-commercial use of the site; the operator reading their own dashboard is normal use. The *automation* touches only a local file. | No | **None** | **Pick this first.** Only option with zero ToS surface. |
| **(b) Authenticated browser session, read-only page inspection** | **No.** ToS §17 bans "any robot, spider or other automatic device, process or means to access the Website **for any purpose, including monitoring**"; robots.txt disallows `/user/` and `/myprofile`. | Yes (session/profile) | **High.** Auto-access to a rewards account plausibly trips fraud/anti-bot controls; ToS §19 lets Almedia suspend or **void unredeemed rewards**; §13.3 lists "automation, bots, scripts" as disqualifying. | **Reject.** |
| **(c) Email / notification parsing of provider messages** | **Yes** — reading one's own mailbox is not access to the provider's website. | Yes (mail app password) | Low | **Good secondary.** But value depends on the provider sending balance/status mail, which is unverified (§3.4). |
| **(d) Official statement / export download (manual)** | **Yes** — a dashboard feature used as intended. | No (if manual) | None | **Good tertiary** — the tax/records backstop. Existence unverified for freecash.com (§3.5). |

**Chosen order:** (a) manual state file → (c) mail parsing if such mail exists → (d) export for records. (b) is explicitly rejected.

### Q3 — Scheduling once-daily on Windows 11 (asleep/off tolerance, catch-up, logging, observability)

| Criterion | Windows Task Scheduler | cron under git-bash | Hermes cron |
|---|---|---|---|
| Available here? | **Yes** — `schtasks.exe` present, no task named `FreeCashDailyCheck` currently registered | **No** — `crontab` not present in git-bash (probed); needs WSL/WSL cron | **Yes** — `hermes` v0.21.3 on PATH |
| Machine asleep at trigger | `WakeToRun` — "Task Scheduler will wake the computer when it is time to run the task" | No wake support | No wake support; the gateway ticks the scheduler every 60 s and only while the gateway process runs |
| Missed run (machine off) | `StartWhenAvailable` — "can start the task at any time after its scheduled time has passed"; queued and started after a **default 10-minute delay** | Lost silently | Documented **local missed-run policy**: the job "catches up once when the scheduler is back", never more than one run per missed slot; `cron.catch_up_missed` default `true`; shows as `⚠ late` / `⚠ catch-up after missed fire` |
| Log capture | Manual — wrap the action in `cmd /c "… >> log 2>&1"` | Manual redirect | Built-in execution history + delivery status |
| Observability | `schtasks /Query /TN FreeCashDailyCheck`, `Get-ScheduledTaskInfo`, Task Scheduler event log | none | `hermes cron list`, `hermes cron doctor`, failure incidents, `last_error` / `last_fire_error` |
| Idempotence (R1) | `MultipleInstances = IgnoreNew` + a date-guarded state file | n/a | Own repeat semantics, but a date guard is still needed |

**Recommendation — Windows Task Scheduler.** It is the only one of the three that can *wake a sleeping machine* and *catch up a run missed while the machine was off*, both required by R1 on a workstation that is not always on, and it needs no daemon to be running. Configure `StartWhenAvailable` (catch-up) and `WakeToRun` (wake) — note `schtasks /create` **cannot** set these; use PowerShell `New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew` + `Register-ScheduledTask`.

Hermes cron is the better *delivery and summarisation* layer (documented catch-up, `[SILENT]` suppression for quiet days, delivery to any configured chat surface) but it depends on the gateway process being alive — so use it as an optional second layer, not as the reliability guarantee. cron-under-bash is not viable on this host at all.

### Q4 — Notification channels reachable from this workstation, free, without repo secrets

| Channel | Credential needed | Where it lives | Notes / verification |
|---|---|---|---|
| **ntfy.sh topic push** (★ default) | None to *publish* — "there is no sign-up; **the topic is essentially a password**". The topic string is a secret. | The topic string in `%LOCALAPPDATA%\hermes\.env` (the documented home for "API keys and secrets"); never in the repo. | `curl -d "msg" ntfy.sh/<topic>`; optional priority/title/action headers. Free, no account, works to phone and desktop. |
| **Native Windows toast** (zero-credential fallback) | **None** | n/a | Verified on this host: `Windows.UI.Notifications.ToastNotificationManager` and `Windows.Data.Xml.Dom.XmlDocument` both load in PowerShell, so a toast needs no module. `BurntToast` is **not** installed (optional nicety only: <https://github.com/Windos/BurntToast>). |
| **Append-only local log file** (always-on audit trail) | None | under `docs/free-cash-monitor-routine/logs/` | The fallback that never fails and doubles as the R3 change-detection baseline. |
| **Hermes cron delivery** to an already-configured surface | Depends on the surface (e.g. a bot token) | hermes `.env` | Best ergonomics if already configured; unnecessary if ntfy is used. |
| **Email via a local mail CLI** (e.g. Himalaya) | App password / SMTP creds | hermes `.env` | **Not available today** — `himalaya` is not installed on this host; would require a new install plus credentials. |
| **Windows `msg.exe` / Task Scheduler "results"** | None | n/a | Not a durable channel; no push. Not recommended. |

**Recommendation — ntfy.sh topic push**, with the native Windows toast and the append-only log as automatic fallbacks on the same run. Rationale: ntfy is free with no signup, needs no secret *in the repo* (topic goes in the hermes `.env`, which already exists here at `C:\Users\cd-pr\AppData\Local\hermes\.env`), and — unlike a toast — it reaches the operator when they are away from the workstation, which is what R3 actually requires.

### Q5 — Lightest-weight human-approval mechanism

**Pattern:** an **append-only approval queue** — the monitor only ever *appends a request*; a separate explicit operator command is the only thing that can mark it approved; nothing in the monitor process can execute. Concretely: `state/approvals.jsonl`, records `{id, created_at, action, provider, params, status:"PENDING"|"APPROVED"|"REJECTED", decided_at, decided_by}`. Append-only so history cannot be silently rewritten; the monitor never writes `APPROVED`.

Note the current script's shape is the weaker pattern: `prompt_approve()` collects a `y` and `run_action()` executes **in the same process** that also prints the summary — one keystroke and one process hold both read and write authority. Keeping write authority out of the monitor process entirely is the fix.

**Citations / references for this pattern:**
- **OWASP LLM06:2025 Excessive Agency**, mitigation #6 *"Require user approval"*: "Utilise human-in-the-loop control to require a human to approve high-impact actions before they are taken." — <https://genai.owasp.org/llmrisk/llm062025-excessive-agency/>
- **GitHub Actions "required reviewers"** as a real, documented approval-queue implementation: only one reviewer need approve, and *"users who initiate a deployment cannot approve the deployment job"* (`Prevent self-review`) — <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>, <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- **The anti-pattern, documented by the same source:** a **"Wait timer"** protection rule "delay[s] a job for a specific amount of time after the job is initially triggered" and then *proceeds* — that is precisely timeout-based auto-approval and must **not** be used here. By contrast, GitHub's custom protection rules demonstrate the fail-closed behaviour to copy: they "wait for up to 30 days … before it times out and **the workflow job fails**" — <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>, <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/configure-custom-protection-rules>

**Explicit rule: no timeout may ever auto-approve.** A pending item stays pending until a human decides; on timeout the system fails closed (or does nothing at all). Equally, the monitor/LLM must hold **no withdrawal capability** — an approval is never an instruction the agent executes on its own initiative.

### Q6 — Legal / safety guardrails the operator must be told

**(a) Automating a rewards platform.** freecash.com's ToS prohibits automated access "for any purpose, including monitoring", restricts use to personal non-commercial purposes, prohibits VPN/proxy/emulator use, and permits Almedia to suspend or **void unredeemed rewards** where the ToS were not followed. Account restriction — not just a ban — is the realistic downside, and unredeemed balances are the loss. Sources: ToS §16, §17, §19; <https://freecash.com/en/policies/terms>; <https://freecash.com/academy/en/support/account/restrictions/how-can-i-ensure-that-my-freecash-account-will-not-be-banned>. Confidence: HIGH.

**(b) Storing login credentials.** Both provider APIs are explicit that tokens are bearer secrets: HG.Cash — "Never share or expose your user API authentication token … Store tokens securely on your backend servers only"; Cashfree — missing/invalid tokens yield 401/403, and a missing token returns HTTP 412. Store tokens in `C:\Users\cd-pr\AppData\Local\hermes\.env` (documented location for API keys and secrets), never in `D:\AgenticOS`, and never commit them. Add a secret-scanner/gitignore check before any commit. Confidence: HIGH.

**(c) Tax / record-keeping.** Rewards income is generally reportable. US: "Taxpayers must report income earned from the gig economy on a tax return, even if the income is … Not reported on an information return form"; the restored 1099-K threshold is >$20,000 **and** >200 transactions — i.e. no 1099-K does **not** mean no tax; keep your own records. Germany (the workstation timezone is CEST): §22 Nr. 3 EStG taxes "Einkünfte aus Leistungen" as *sonstige Einkünfte*, with the statute stating such income is not taxable if it is **less than €256 per calendar year** (*Freigrenze*). This daily log is exactly the record that answers that question; treat the classification itself as a tax-adviser question. Sources: <https://irs.gov/businesses/gig-economy-tax-center>, <https://irs.gov/businesses/what-to-do-with-form-1099-k>, <https://www.gesetze-im-internet.de/estg/__22.html>. Confidence: HIGH for the cited text; MEDIUM for it applying to this specific operator (jurisdiction inferred only from timezone).

**(d) Never let an LLM/agent execute a withdrawal.** Design invariant, not a preference: the monitor process has **no** cash-out code path and no write token. HG.Cash deliberately separates read (`GET /accounts`) from `POST /transactions`; keeping the write token out of the monitor's environment makes the invariant structural rather than behavioural, so prompt injection or agent error cannot reach money. Reinforced by OWASP LLM06 ("Excessive Agency") and by R2/R4. Confidence: HIGH (design), n/a (citation needed).

---

## 3. COULD NOT VERIFY (9 items)

1. **Whether "Free Cash Finance Automation" is a real external product or vendor with any API.** No external product found; all references are repo-internal (`data/boards.json`, `design_doc.json`, `docs/research-workflows/FreeCash-opp-4a3f4cfc-research-plan.md`).
2. **Whether this operator's entity actually holds an HG.Cash (or Cashfree) account**, and which provider the entity actually uses. The HG.Cash *API* is verified real; the *account* is not.
3. **What freecash.com's internal `/fc-api/` namespace serves.** It exists (disallowed in robots.txt) but is undocumented, unauthenticated-untested, and robots-disallowed; it must not be used and cannot be described as an available read-only source.
4. **Whether freecash.com sends a periodic balance/status email** suitable for the mail-parsing option. Only "essential service-related communications" (§15.2) and ≥30-day closure notices (§11) are documented.
5. **Whether freecash.com offers any statement/export download.** No documented export control was found.
6. **The claim that "Freecash was formerly Freecash.io"** (third-party blog). freecash.io currently serves a GoDaddy for-sale lander, which is inconsistent with an active platform domain; unconfirmed either way.
7. **The exact Cashfree Payouts *v1.2* balance path.** The repo skill asserts `GET /payout/v1.2/getBalance`; the docs I retrieved document `GET /payout/v1/getBalance` and reference a separate "View Balance V1.2" page. The literal v1.2 path string was not confirmed.
8. **A realistic earnings figure or hourly rate** for a rewards-platform workflow. Published ranges are marketing figures; no honest number is verifiable, and the repo's own prior research plan contains invented conversion/CPA/CAC figures that must not be reused.
9. **Whether the €256 Freigrenze in §22 Nr. 3 EStG applies to this operator's reward income** (jurisdiction inferred only from the CEST timezone), and whether the income is *sonstige Einkünfte* versus another income category.

*(Third-party claim rather than verification: a scraper-marketplace listing asserts "Freecash does not publish a documented public developer API" — <https://parse.bot/marketplace/0076fa84-e4a6-48e3-977f-2e7c5164d00b/freecash-io-api>. This agrees with my own direct probes of `/docs` and `/developers` returning 404, but it is a third party, so the finding rests primarily on the probes.)*

---

## 4. Unknowns that would change the design

| Unknown | Design change if answered |
|---|---|
| Which provider the entity actually holds funds with | If HG.Cash → Alt A becomes the primary path and manual entry becomes the fallback. If none → the whole routine is a local logging exercise with no live data source. |
| Whether freecash.com is genuinely the target platform | If the real target is a different reward platform, re-check that platform's ToS §17-equivalent before reusing any conclusion here. |
| Whether the operator is willing to log in daily | If not, and no official API exists, the routine cannot acquire data compliantly — the deliverable becomes "notify me when a human has entered data" only. |
| Machine uptime pattern (sleeps vs. always-on vs. off overnight) | Decides whether `WakeToRun` is required or whether Hermes cron delivery alone suffices. |
| Whether the operator already has a chat surface configured with Hermes | Would make Hermes cron delivery preferable to ntfy (fewer moving parts, no new secret). |
| Provider sending balance/status mail | Would promote Alt D (mail parsing) from a secondary to a primary acquisition path for freecash.com — the only compliant *automatic* option for that platform. |
| Operator jurisdiction for tax | Would replace the §22 Nr. 3 EStG / IRS citations with the correct local regime. |

---

## 5. Recommended first week (3 steps)

**Step 1 — Day 1: create the state file (this is the exact first artifact).**

```bash
mkdir -p "D:/AgenticOS/docs/free-cash-monitor-routine/state" \
         "D:/AgenticOS/docs/free-cash-monitor-routine/logs"
printf '%s\n' '{"date":"2026-09-18","source":"manual-operator-entry","platform":"freecash.com","balance_usd":null,"available_to_withdraw_usd":null,"account_status":"unknown","notes":"seed record; operator fills from own dashboard"}' \
  >> "D:/AgenticOS/docs/free-cash-monitor-routine/state/status.jsonl"
```
Deliverable at end of Day 1: one JSONL record per day, appended by the operator, containing the fields the design needs (`balance`, `available_to_withdraw`, `account_status`). This alone satisfies R2 and R4 trivially and gives R3 a change-detection baseline.

**Step 2 — Day 2: register the scheduled task (idempotent, wake-capable, catch-up).**

`schtasks /create` cannot set wake/catch-up settings, so use PowerShell (paths verified on this host; Python here is 3.11.9):

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe" `
           -Argument "D:\AgenticOS\docs\free-cash-monitor-routine\bin\daily-check.py" `
           -WorkingDirectory "D:\AgenticOS\docs\free-cash-monitor-routine"
$trigger = New-ScheduledTaskTrigger -Daily -At 08:00
$settings= New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "FreeCashDailyCheck" -Action $action -Trigger $trigger -Settings $settings
```
Log capture lives *inside* the script (append to `logs/monitor.log`) because Task Scheduler does not redirect stdout by default. Verify with `schtasks /Query /TN FreeCashDailyCheck` and `Get-ScheduledTaskInfo -TaskName FreeCashDailyCheck` (check `LastTaskResult` and `LastRunTime`). The script must keep the existing date-guard idempotence (`state.json` / UTC date) so a catch-up run cannot double-log a day — R1.

**Step 3 — Days 3–4: notification + approval queue.**
- Notification: `curl -d "<summary>" https://ntfy.sh/$FC_MONITOR_TOPIC` with priority/title headers; on any failure fall back to a native Windows toast (API verified loadable here) and always append to `logs/monitor.log`. The topic string goes in `C:\Users\cd-pr\AppData\Local\hermes\.env`, never in the repo.
- Approval queue: create `state/approvals.jsonl` (append-only, `status` starts `PENDING`), plus an explicit operator command to record `APPROVED`/`REJECTED`. No timeout path may transition an item to `APPROVED`; on expiry it stays `PENDING` or flips to `EXPIRED` (fail closed). The monitor process must hold no write token and no execution path for any provider action.

---

## 6. Pre-existing repo state (recorded, NOT modified)

These files already exist, are **not** modified by this research, and currently conflict with the above in ways the operator should know about:

| Path | Issue |
|---|---|
| `scripts/make_freecash_check.py` | `fetch_status()` is a hardcoded stub returning zeros; `run_action()` is a stub. Reported values are not real. Its approval prompt executes in the same process as the read (see §Q5). Also, on the `e`/exit branch `log_entry()` is skipped, so some runs leave no log line. |
| `docs/freecash-monitoring.md` | Describes `POST /withdraw` and `/survey/complete<id>` endpoints for freecash.com. Direct probes show no public API (`/docs`, `/developers` → 404); these endpoint paths are unverified and must not be implemented. Also references `data/freecash/daily.log`, while the script writes `data/freecash/YYYYMMDD.log`. |
| `config/freecash-crontab` | Contains `/path/to/AgenticOS/...` placeholders and is not installed; there is no `crontab` on this host. It cannot run as written. |
| `docs/research-workflows/FreeCash-opp-4a3f4cfc-research-plan.md` | Contains specific invented metrics ("target CPA: $18–$35", "LTV target: >$800", "conversion 3.5%–5.2% based on Stripe data") with no source. Do not reuse these figures. |
| Hermes skill `automated-status-monitor` (+ its `references/api-compliance.md`) | Asserts a "FreeCash.io" provider with `X-API-Key` endpoints and `GET /withdrawals` returning `total_earnings`. freecash.io is a parking lander (F3) and that endpoint is unverified. The HG.Cash row, by contrast, matches the official docs. The skill should be corrected, not trusted. |

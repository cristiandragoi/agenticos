# DELEGATION-RESEARCH-PLAN.md — research plan delegated to Hermes for the Free Cash daily status monitor

**Project:** Free Cash Finance Automation — daily status monitoring
**Workspace (repository):** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `d14253d` · **Date:** 2026-09-18
**Scope:** research only. No credential is created or used, no provider endpoint requiring authentication is called, no scheduled task is registered, no existing file is modified.
**Rules the research serves:** R1 one check/day · R2 zero automated earning actions · R3 notify on earnings/status-change · R4 human approval before any external action.

**Evidence standard (non-negotiable):** every claim is (a) backed by a URL that was actually fetched and quoted, or (b) backed by a command actually run on this host with its observed output, or (c) explicitly labelled `COULD NOT VERIFY`. A plausible-looking endpoint, price, or schedule that was not observed is a defect, not a finding.

---

## 0. Why this plan exists

The design (`ROUTINE-DESIGN.md`) is complete and all four rules are enforceable offline, but one input is missing and it is the input that makes monitoring *real*: the provider read contract (`PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase`). While it is unresolved, every snapshot is `degraded: true` and a "no change" report proves nothing about the actual account. Research therefore has exactly one high-value target — **which read source may the routine legitimately use?** — plus a small set of supporting questions.

Prior research already reached headline conclusions (recorded in `RESEARCH-PLAN.md` §0 and `PROVIDER-API-RESEARCH.md`). This plan **re-verifies** them live rather than inheriting them, because a stale finding is indistinguishable from an invented one until it is fetched again.

---

## 1. Research questions

| # | Question | Method | Acceptance evidence | Owner | State |
|---|---|---|---|---|---|
| **Q1** | Does `freecash.com` permit any automated/read-only access (API, polling, scripted browser)? | fetch terms of service and quote the automation clause verbatim; probe `/docs`, `/developers`; fetch `robots.txt` and list Disallow rules for account paths | verbatim quoted clause + HTTP status codes actually returned | W2 | carrying prior finding **HIGH confidence: automation forbidden outright, including "monitoring"** — re-verify |
| **Q2** | Is `freecash.io` a platform with an API? | fetch the domain and describe what is actually served | observed response body/type, no interpretation | W2 | carrying prior finding **parked lander, not a platform** — re-verify |
| **Q3** | Which provider *does* offer a documented read-only balance/status API that this entity could legitimately use? | fetch official API reference docs for the candidate providers; extract exact method + path + response fields | docs URL + quoted field list; unauthenticated probe status (401/403/404) observed | W2 | HG.Cash: documented `GET /accounts` (+ `/account/{id}/balance`) with `balance`, `pendingFees`, `netBalance`, `status`; Cashfree: `GET /payout/v1/getBalance`, gated → **401/403 observed** — re-verify |
| **Q4** | Does the entity actually hold an account with that provider, and is the API entitled? | **cannot be answered by research** — requires the operator's own login | operator statement + (for Cashfree) 403 → 200 transition | **Operator** | `COULD NOT VERIFY` — **this is the blocker** |
| **Q5** | What is "Free Cash Finance Automation" as an entity — an internal AgenticOS construct or an external vendor product? | in-repo search + web search for an external product of that name | list of in-repo references; an external product page or an explicit "none found" | W2 | prior: every reference internal to this repo; no external product found — re-verify the web half |
| **Q6** | Which notification channels are reachable from this workstation, free, without repo secrets? | enumerate: append-only local log (always on), Windows-native toast (no modules), stdlib `smtplib` (needs a mailbox), third-party webhooks (needs a URL secret), SMS (paid) | per channel: dependency named and actually resolved/denied on this host | W2 | partial — complete the reachability check |
| **Q7** | Which scheduler guarantees "exactly one check per day" on a workstation that sleeps? | compare Windows Task Scheduler (`WakeToRun`, `StartWhenAvailable`, `IgnoreNew`), Hermes cron (needs the gateway alive), cron under git-bash (absent on this host) | capability statements with the tool that exposes them, plus the local presence/absence probe | W2 | prior: Task Scheduler is the only one that can wake and catch up; `crontab` absent in git-bash |
| **Q8** | What does the legacy code actually do, so nothing is carried forward blindly? | read the candidate files and run non-mutating checks (`node --check`, `ast.parse`) | per-file verdict with file:line | already covered by `AUDIT-RULE-COMPLIANCE.md` (280 lines) | **closed** — no re-run needed unless a file changes |
| **Q9** | What happens to rule compliance under adversarial conditions (tampering, clock advance, injected write)? | W3 verifier: negative controls per rule | command + observed output per control | W3 | not started (gated on W1) |

---

## 2. Options (with effort / value / dependencies / first action)

**Time-to-Revenue** = when the operator first gets *provider-verified* earnings visibility (a monitor cannot earn by construction — R2).

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **Operator decision on the read source** (Q4) | 10 minutes of operator time | **Same day** — unblocks O1→O2/O3 in the workflow plan and turns `degraded: true` off | the operator's own provider login/entitlement; no engineering | Answer one question: "does this entity hold an HG.Cash account, a Cashfree merchant account, both, or neither?" |
| **HG.Cash read-only API** | 2 h research + 4–8 h build/test | **3 days – 2 weeks** (self-serve token, no partner approval) | confirmed account; token in `.env`; live capture test | Unauthenticated probe recorded (expect 401) → authenticated probe recorded (expect 200) → allowlist the single path |
| **Cashfree Payouts balance API** | 2 h research + 4–8 h build/test | **1–4 weeks** (activation queue, not engineering) | merchant account with Payouts enabled | Submit the activation request; record the 403 response as the current, honest state |
| **Operator-entered state file (no machine read)** | 1–2 h | **Same day** — zero ToS surface, real numbers | writable state dir; 60 s/day of the operator's ordinary dashboard use | Append the seed record; make the detector accept `source: operator_entered` |
| **Email/notification parsing** | 3–5 h | **2–4 days, conditional** | evidence that the provider sends *periodic* balance/status mail (only "essential service-related communications" is committed to) | Search the operator's mailbox for existing provider account mail; if none, close the option in writing |
| **Scripted browser against freecash.com** | 4–6 h | **Negative — rejected** | session + 2FA + stored credentials; ToS §17 and `robots.txt` both prohibit it | Write the rejection with the quoted clause so it is never re-proposed |
| **Official statement/export download (manual)** | 1–2 h | **2 days** — records/tax backstop, not the daily loop | a provider-side export control must exist | Check the dashboard for an export control; record whether it exists |

---

## 3. Research phases and gates

| Phase | Work | Gate |
|---|---|---|
| **P0 — re-verification (now)** | Q1, Q2, Q3, Q5, Q6, Q7 live | **G2:** every claim carries a fetched URL or a run command; unknowns labelled `COULD NOT VERIFY`; zero invented endpoints |
| **P1 — operator input** | Q4 (+ choose channel and schedule) | **G4:** a single recorded decision per open question, with the operator named |
| **P2 — design amendment** | add the resolved read path to `ALLOWED_PATHS` with a justification comment; downgrade `degraded` per source | G1/G3 still green after the amendment (the amendment must not break the day-lock or the static checker) |
| **P3 — live proof** | T2.4 network capture on one real cycle | capture contains **only** `GET`/`HEAD` to allowlisted hosts, 0 write verbs |
| **P4 — unattended operation** | 30-day operability review (`ROUTINE-DESIGN.md` §9.2) | 4 consecutive weeks of 7/7 weekly checks **and** `degraded: true` count = 0 |

## 4. Stop conditions

Stop and report rather than proceed if: an "official API" cannot be produced in provider documentation; a provider contract can only be satisfied by automating a logged-in browser session; a credential would have to be stored in the repository; the only remaining read path requires a paid third party; or the operator's entitlement answer is unknown. Each of these is a **finding**, not a gap to be filled by inference.

## 5. Explicitly out of scope

Any earning action (claim, withdraw, cashout, redeem, payout, transfer, wager, bet, spin, deposit, purchase). Any schema or code path that reads a human "APPROVED" flag and then performs a write. Any credential stored in the repo. Any modification of existing (uncommitted) work on this branch.

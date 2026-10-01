# RESEARCH PLAN — daily status-monitoring routine (stream S2 `research`)
## The decisive question: what READ-ONLY source can actually supply the daily figures?

**Delegation:** `DELEGATION-2026-10-01-R4` · **Stream:** S2 `research/` · **Repo:** `D:\AgenticOS`
**Written:** 2026-10-01, 11:40–11:52 operator-local (`date` → `Do, 1. Okt 2026 11:45:07`, Europe/Berlin, UTC+02:00)
**Brief obeyed:** `../DELEGATION-BRIEF.md` (the hostile R4 brief; §0 rule numbering, §1 ground truth, §2 isolation contract, §3 acceptance bar).
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` → `3.11.9`, `tzdata 2025.3`, `ZoneInfo("Europe/Berlin")` resolves.
**Footprint:** writes only under this stream dir (`DELEGATION-2026-10-01-R4/research/`) and throwaway roots under `%LOCALAPPDATA%\Temp\fc-r4-research-*`. No file under `monitoring/freecash/**`, `scripts/monitoring/**`, `data/freecash-monitor/**`, `config/**` or `finance-monitor/**` was written. No `git`, no `schtasks`, no cron, no provider network call, no credential. Isolation proven by hash (§7).

---

## 0. RULE NUMBERING — printed with the TITLE, always (brief §0)

Two different numberings exist in this repo and they are **inverted**. A bare "R1" is unreadable, so every rule below carries its title and both numbers.

| Operator numbering (binding here) | Operator rule TITLE | Shipped-code docstring numbering |
|---|---|---|
| **R1** | **NO EARNING ACTION** — the routine never performs an earning/withdraw/claim transaction | `readonly_client.py:1` labels this **R2** ("the routine's ONLY network path") |
| **R2** | **ONCE PER DAY** — exactly one status read per calendar day, operator-local | `gate.py:1` labels this **R1** ("exactly one status read per operator-local calendar day") |
| **R3** | **NOTIFY ON CHANGE** — tell the operator when earnings or account status changes | agrees everywhere |
| **R4** | **APPROVAL BEFORE EXTERNAL ACTION** — nothing external executes without explicit human approval | agrees everywhere |

Measured this pass: `head -2 monitoring/freecash/gate.py` → `"""gate.py -- R1: exactly one status read per operator-local calendar day.`; `head -4 monitoring/freecash/readonly_client.py` → `"""readonly_client.py -- R2: the routine's ONLY network path.` (raw/05). A reader who takes "R2 = no earning" from this plan and then reads `gate.py`'s `R1` will mis-map the rule. **Every finding below names the rule title.**

---

## 1. Method, evidence standard, and the failing-something proof

**Method.** One pass, 11:40–11:52 local. I re-measured the production state, re-fetched every provider claim live over the web tool, re-ran the routine on a **copy** with throwaway roots, and re-scanned the whole V1–V11B corpus for its rule numbering. Nothing is inherited: an inherited claim is treated as UNVERIFIED until re-run.

**Evidence standard (brief §3).** Every gate/verifier must be shown to FAIL on a planted violation in the same file as the passing run. For a research stream the "planted violation" is the *wired source's own default state*: an empty `records` list. The proof below has both lines in one file (`raw/03-source-proof-redgreen.txt`).

### RED / GREEN — the source can only produce a figure when a record exists

Command: `bash research/repro/run_source_proof.sh` (copies `monitoring/freecash` into `research/repro/freecash`, then runs the copy against two throwaway roots).

```
RED   : operator_state with records: []   -> RUN_OK 2026-10-01 outcome=MONITOR_DEGRADED
        source=operator_entered(data_available=False) ... notifications=0
        snapshot: degraded=true, account_status=null, earnings_total_cents=null,
                  balance_cents=null, pending_cents=null, currency=null,
                  raw_response_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
GREEN : operator_state with ONE record for 2026-10-01 -> RUN_OK outcome=INITIAL_BASELINE
        source=operator_entered(data_available=True)
        snapshot: account_status="ACTIVE", earnings_total_cents=1340, balance_cents=1340,
                  pending_cents=0, currency="USD"
```

The RED `raw_response_sha256` (`e3b0c442…b855`) is **sha256 of the empty string** — byte-identical to all three production snapshots (`raw/05`). The GREEN run proves the check *can* pass and yields all four figures. Two honest notes: (i) the GREEN snapshot is still `degraded: true` — the operator-entered source is degraded **by construction**, so a "no change" day never proves provider-verified truth; (ii) the RED run booked `last_success_day=2026-10-01` for `MONITOR_DEGRADED` (the day-budget defect, which is S1's stream, not this one).

---

## 2. THE DECISIVE QUESTION — three options, four required attributes each

The four fields the routine compares are `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents` (`operator_state.py:48-56`). The routine has **two** wired sources (`run_daily_check.py:52-53`): `operator_state` (default) and `metrics_http`. Only `readonly_client.py` may touch the network, and **its host allowlist is loopback only** (raw/05):

```
ALLOWED_METHODS = frozenset({"GET","HEAD"})
ALLOWED_HOSTS   = frozenset({"localhost","127.0.0.1","::1","[::1]"})
ALLOWED_PATHS   = (^/api/v1/status/metrics$, ^/api/v1/status$)
# "Nothing provider-facing is allowlisted today -- see PROVIDER_ENDPOINT_UNKNOWN below."
```

Consequence, stated plainly: **read-only enforcement is real, and monitoring is not.** The routine cannot reach any real provider even with a credential, and its only wired non-file source (`metrics_http`) is dead — both allowlisted paths are 404/conn-refused on the live host. The routine has never carried a single real figure.

### (a) Operator-entered file — `state/operator-state.json` (wired today, EMPTY)

| Attribute | Value |
|---|---|
| **Expected Effort** | **0 h build** (already wired and PROVEN, §1). Operator cost ~60 s/day. Optional hardening (day-budget, so a data-less run stops burning the day) is ~1–5 h but belongs to S1. |
| **Time-to-Revenue** | **Same day for visibility; none for revenue.** A monitoring routine cannot earn (R1), so this is sight of the account only. First real baseline the day a human types four figures; first R3 change notification the following day. |
| **Dependencies** | (1) A human who reads their own dashboard and types four integer-cent figures; (2) a **free day key** (today's is already spent — `state/day-locks/2026-10-01.lock` at 08:53); (3) the S1 day-budget fix, so a data-less run does not consume the day. No socket, no credential, no ToS surface. |
| **First Concrete Action** | Operator appends **one** record for a free `day_key` to `records` with the four integer-cent figures (1340 == $13.40), then the routine is run once in a throwaway root → expect `INITIAL_BASELINE` and `data_available:true`. |

**Verdict: AVAILABLE — the only source that yields all four fields today, and the only one with a same-day result.** Honest limit: value is proportional to operator discipline; every snapshot is `degraded: true` by construction.

### (b) Loopback metrics bridge written from the operator's own authenticated browser session

| Attribute | Value |
|---|---|
| **Expected Effort** | **4–8 h** (new read op + a new `ALLOWED_PATHS` regex + the bridge service). The loopback **host** allowlist already permits it, so no host widening is needed — only a path entry and a real read operation. |
| **Time-to-Revenue** | **3–7 days of sight of the real account (if permitted at all); zero if the provider is freecash.com** — see the ToS blocker. Never revenue: R1 forbids earning. |
| **Dependencies** | (1) The desktop app running **with a human-authenticated session** (today `electron = 0`; the on-disk `%APPDATA%\AgenticOS\data\freecash\session-evidence.json` is stale, `verifiedAt 2026-09-23`); (2) a new allowlisted loopback path + a new read op; (3) an R1/R2 allowlist decision; (4) **ToS clearance — BLOCKED when the provider is freecash.com.** |
| **First Concrete Action** | Run the existing session-check probe once **with the app not running** and paste the failure (the red path is reachable now). Then, **only if the account's provider is not freecash.com**, stand up a throwaway loopback `GET` returning the four fields and read it through `readonly_client`. |

**Verdict: BLOCKED for freecash.com; CONDITIONAL otherwise.** If the "bridge" programmatically extracts the figures from an authenticated freecash.com page, it is an "automatic device … including monitoring" — a Terms §17 breach, and §16 bars the automation tooling outright (raw/06.1–.2). That risk is to *the very account being monitored* (§19 permits voiding unredeemed rewards). If instead the **operator** reads the figures and a tool merely carries their typed values into a local file, the option collapses into **(a)** and is safe. The bridge is only a real upgrade if the provider is a different, API-clean platform.

### (c) Documented provider read API added to the allowlist

| Attribute | Value |
|---|---|
| **Expected Effort** | **2–4 h IF** a documented read path and an **entitled account** already exist; otherwise a KYC/onboarding project (days). Plus the allowlist-widening decision, a new read op, and a field mapping. |
| **Time-to-Revenue** | **3 days–2 weeks** if a documented read path and entitlement exist; **unbounded/never** otherwise. Visibility only, never revenue. |
| **Dependencies** | (1) The operator **names the provider** that holds the monitored balance (no file in this repo does); (2) an entitled account + a credential held **outside** the repo; (3) a documented read endpoint — HG.Cash: yes; freecash.com: no; Cashfree: yes but POST-minted token; (4) an operator-approved widening of `ALLOWED_HOSTS` beyond loopback; (5) a decision that a read token is not an earning capability. |
| **First Concrete Action** | Operator states the provider and whether an API token can be issued; then probe the documented endpoint **unauthenticated** to confirm routability and record a per-candidate R1 verdict. |

**Verdict: BLOCKED for freecash.com (no public API + ToS ban); PARTIAL for HG.Cash (3 of 4 fields); R1-INCOMPATIBLE for a Cashfree daily run (POST-minted 6-minute token).** Details and live citations in §3.

### Ranking

**Rank 1 — (a) operator-entered file.** The only source producible today, the only one yielding all four fields, and the only one with zero legal/ToS exposure. Keep it as the wired default; it is a *manual* baseline, not a wire source.
**Rank 2 — (c) documented provider API**, scoped to HG.Cash *if and only if* the operator confirms that is where the balance sits; it upgrades `balance_cents` + `pending_cents` + `account_status` to provider-authoritative but still needs the operator for `earnings_total_cents`.
**Rank 3 — (b) loopback bridge**, permissible only on a non-freecash.com provider; on freecash.com it is a ToS breach and must not be built.

---

## 3. Provider reality — every claim live-fetched or marked BLOCKED (brief hard rule)

Full quoted evidence: `raw/06-provider-live-fetch.txt`. No endpoint schema below is invented.

| Provider | Read API? | Live evidence (fetched 2026-10-01) | Yields the 4 fields? | R1 (NO EARNING ACTION) verdict |
|---|---|---|---|---|
| **freecash.com** (Almedia GmbH) — the consumer rewards platform the routine is named for | **NO.** No published developer/partner surface. | `freecash.com/en/policies/terms` (HTTP 200): §17 "Use any robot, spider or other automatic device, process or means to access the Website **for any purpose, including monitoring**…"; §16 "personal, non-commercial use only"; §17.1 bans "macros, bots, scripts". `robots.txt` `Disallow: /user/ /myprofile /fc-api/`. `/en` publishes no API docs. | n/a | **BLOCKED** — any automated read is a Terms breach; §19 permits voiding unredeemed rewards. |
| **HG.Cash** (LATAM iGaming payment rail) | **YES** — documented OpenAPI. | `docs.hg.cash/api-reference/accounts/get-user-accounts` + `.../get-account-balance`: base `https://hg.cash/api/v1`; Bearer `cash_<64-hex>` **generated in account settings**; `GET /accounts`, `GET /account/{id}/balance` → `balance, pendingFees, netBalance, status{Operativa\|Bloqueada\|Cerrada}, currency`. Auth sent on a **GET** (no POST mint). | **3 of 4** — status, balance, pendingFees; **no lifetime-earnings field**. | **Conditional.** The read is a plain authenticated GET (verb-pure), but **no read-only scope is documented** — the same token also reaches `POST /transactions` (cash-out). KYC/B2B gated; no credential in the repo; nothing links the monitored account to HG.Cash. |
| **Cashfree Payouts** (Indian payments co.) | **YES** — documented. | `.../payouts/v1/get-balance`: `GET /payout/v1/getBalance` → `{balance, availableBalance}`. But `.../payouts/v1/authorize`: the token is minted by **`POST /payout/v1/authorize`** (headers `X-Client-Id`, `X-Client-Secret`), and "**The generated token is valid for 6 minutes**". | **≤2 of 4** — balance only; **no account status, no lifetime earnings**. | **R1-INCOMPATIBLE for a daily run.** Every read needs a fresh POST-minted token, i.e. a write-class call to the payment provider each day — refused by R1 ("no earning/write action automatically"). |
| **freecash.io** | **NO** — parked domain. | Prior pass (C-class for this stream; consistent with a live re-check of the name): a 114-byte redirect to `forsale.godaddy.com/forsale/freecash.io`. Not a platform. | n/a | **DEAD.** |

Also confirmed this pass: the only "freecash.com API" search hit is an **unofficial** single-commit, 0-star repo (`README`: "An API for the site freecash.com") with no schema — it is not a provider contract and is not used.

**Hard consequence:** even a documented provider GET is unreachable from the routine **because `ALLOWED_HOSTS` is loopback-only** — the routine cannot reach `hg.cash` or `payout-api.cashfree.com` at all. Option (c) is therefore not a code tweak; it is a **rules decision to widen the host allowlist**, which the operator must own.

---

## 4. Corpus inventory — V1…V11B (+ concurrent V12), one line each

Snapshot taken ~11:47. **Note:** the corpus is being actively appended by concurrent sibling sessions — `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V12-2026-10-01.md` and `-V12B-…md` appeared during this pass (mtime 11:44) and are included below. Classification is by date, series order, each file's own "Supersedes:" line, and the rule-numbering scan (`raw/07`, `raw/07b`); it is **not** a full line-by-line re-read of all 40 (see BLOCKED §6).

| File | Date | One-line verdict |
|---|---|---|
| `RESEARCH-PLAN.md` | 09-17 | STALE — original research plan; superseded by `RESEARCH-PLAN-2026-09-21` and `RESEARCH-PLAN-FC-…-V11`. Repo numbering. |
| `AUDIT-RULE-COMPLIANCE.md` | 09-17 | STALE — pre-canonical-package audit of parallel monitors; findings re-labelled by later passes. Repo numbering. |
| `ROUTINE-DESIGN.md` | 09-17 | STILL-VALID as the design of record (state layout, lock, transport); **numbering inverted** vs the operator brief. |
| `RULE-GATE-CHECKLIST.md` | 09-17 | STILL-VALID as a checklist; **repo numbering** (R1=once/day, R2=no-earning); superseded in practice by the R3/R4 verifier gates. |
| `verify-readonly.sh` | 09-17 | STILL-VALID — the static read-only scanner wrapper (`forbidden=0 exempt=28`). |
| `PROVIDER-API-RESEARCH.md` | 09-17 | STILL-VALID — the provider verdict; **re-confirmed live this pass** (§3). Repo numbering. |
| `PROVIDER-CONTRACT-RESEARCH-V2.md` | 09-18 | STALE — additive V2 to the above; superseded by `PROVIDER-FINDINGS-REVERIFIED` and this pass's refetch. |
| `PROVIDER-FINDINGS-REVERIFIED.md` | 09-18 | STILL-VALID — re-verified provider facts; my live refetch agrees with its key findings. Repo numbering. |
| `RESEARCH-PLAN-V4.md` | 09-20 | STALE — superseded by `RESEARCH-PLAN-2026-09-21` / `RESEARCH-PLAN-FC-…-V11`. Repo numbering. |
| `IMPLEMENTATION-PLAN-V3.md` | 09-18 | STALE — build plan; the package it planned now exists. |
| `DELEGATED-WORKFLOW-PLAN.md`, `DELEGATION-WORKFLOW-PLAN.md`, `DELEGATION-RESEARCH-PLAN.md` | 09-18 | STALE — first delegation round; superseded by `DELEGATION-DISPATCH-2026-09-20*` and the R2/R3/R4 briefs. |
| `delegation-manifest.json` | 09-18 | STALE — round-1 manifest. |
| `DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN.md` | 09-19 | STALE — superseded by the 09-20/09-21 plans. |
| `OPERATIONS-WORKFLOW-PLAN.md`, `OPERATIONS-WORKFLOW-PLAN-2026-09-20.md` | 09-20 | STALE — superseded by `WORKFLOW-PLAN-2026-09-21` / V-series. |
| `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION.md` (V1) | 09-20 | STALE — first workflow plan. Repo numbering. |
| `WORKFLOW-PLAN-CONSOLIDATED-2026-09-20.md` | 09-20 | STALE — consolidates the 09-20 draft set; superseded by 09-21 / V-series. Repo numbering. |
| `WORKFLOW-PLAN-V4.md` | 09-20 | STALE — superseded by V5+. Repo numbering. |
| `WORKFLOW-PLAN-V5.md`, `WORKFLOW-PLAN-FC-…-V5.md` | 09-20 | STALE — superseded by V6+. Repo numbering. |
| `WORKFLOW-PLAN-FC-…-V6.md` | 09-20 | STALE — superseded by V7 (V7 explicitly corrects V6's §0/V12). Repo numbering. |
| `WORKFLOW-PLAN-FC-…-V7.md` + `-V7-ADDENDUM-BRIDGE-2026-09-21.md` | 09-21 | STALE — superseded by V8 (V8 explicitly replaces both). Repo numbering. |
| `WORKFLOW-PLAN-FC-…-V8.md`, `-V8-2026-09-30.md` | 09-30 | STALE — superseded by V9. Repo numbering. |
| `WORKFLOW-PLAN-FC-…-V9-2026-10-01.md` + `-V9-ADDENDUM-…GATE-SCOPE-AND-FALSE-COMPLIANCE.md` | 10-01 08:4x | STALE — superseded by V10. **Numbering begins to shift here.** |
| `WORKFLOW-PLAN-FC-…-V10-2026-10-01.md` | 10-01 08:5x | STALE — superseded by V11. Last version stated in **repo numbering**. |
| `WORKFLOW-PLAN-FC-…-V11-2026-10-01.md` | 10-01 09:2x | STALE — superseded by V12. **First V-series file in OPERATOR numbering.** |
| `WORKFLOW-PLAN-FC-…-V11B-2026-10-01.md` | 10-01 09:25–09:42 | STALE — "companion, not a replacement" to V11; superseded by V12. Operator numbering. |
| `WORKFLOW-PLAN-FC-…-V12-2026-10-01.md` | 10-01 11:39–11:43 | **NEWEST** (written by a concurrent session). Operator numbering. |
| `WORKFLOW-PLAN-FC-…-V12B-2026-10-01.md` | 10-01 11:44 | "Companion to V12, not a replacement." Operator numbering. |
| `RESEARCH-PLAN-2026-09-21.md` | 09-21 | STALE — superseded by `RESEARCH-PLAN-FC-…-V11`. Repo numbering. |
| `RESEARCH-PLAN-FC-…-V11-2026-10-01.md` | 10-01 09:25 | STALE — newest research plan of the V-series; operator numbering; superseded in time by this pass. |
| `WORKFLOW-PLAN-2026-09-21.md` | 09-21 | STALE — operator numbering appearing here. |
| `PROVIDER-DECISION-PACKET-2026-09-20.md` | 09-20 | STALE — superseded additively by `-v2`. Repo numbering. |
| `PROVIDER-DECISION-PACKET-2026-09-20-v2.md` | 09-20 | STILL-VALID as the provider decision of record (rank 1 operator file; HG.Cash as first provider upgrade). Repo numbering. |
| `DELEGATION-DISPATCH-2026-09-20.md`, `-R2.md` | 09-20 | STALE — historical dispatches. |

### Rule-numbering contradictions — flagged (brief §0)

1. **The corpus is split across two inverted numberings.** Files dated 09-17 → 09-20 (and `RESEARCH-PLAN-2026-09-21`) use **REPO** numbering: *R1 = once per day, R2 = zero earning*. Files from 09-21 / 10-01 (workflow V11, V11B, V12, `RESEARCH-PLAN-FC-…-V11`, the R3/R4 briefs) use **OPERATOR** numbering: *R1 = no earning, R2 = once per day*. **The flip happens between V10 and V11 on 2026-10-01.**
2. **The shipped code uses the REPO numbering** (`gate.py:1` → R1=once per day; `readonly_client.py:1` → R2=only network path) while the operator briefs use the **OPERATOR** numbering. So a bare "R1/R2" copied from any 09-1x document maps to the *opposite* rule in `gate.py`.
3. **Explicit cross-maps exist and must not be summed:** `DELEGATION-2026-10-01/WORKFLOW-PLAN-V2.md` maps `RULE-1 → R2` and `RULE-2 → R1`; `DELEGATION-2026-10-01/verifier/VERIFIER-PLAN-V2.md` prints a rule/legacy-label matrix; `DELEGATION-2026-10-01-R4/RESEARCH-PLAN.md` uses operator numbering while `...-R4/RESEARCH-PLAN-R4.md` (a sibling) uses it too but R3's plan uses "Rule 1/2" titles. A reader quoting any of these without the title will mis-map.
4. `RULE-GATE-CHECKLIST.md`, `ROUTINE-DESIGN.md`, `AUDIT-RULE-COMPLIANCE.md` and all first-round `DELEGATION-*` docs are **repo-numbered** — any "R2" they cite means *zero earning*, not *once per day*.

### Observational-only authority (brief §4/S2, hard constraint)

The routine's authority is **observational only.** Under **R1 (NO EARNING ACTION)** it cannot and must not earn, withdraw, claim, redeem or transfer, and under **R4 (APPROVAL BEFORE EXTERNAL ACTION)** it must **never auto-execute an approved action** — the queue may enqueue only (`execution_state=NOT_EXECUTED`, `expires_at_utc=None`). Every option above is a *read* source; none is a revenue path, and "Time-to-Revenue" reports time to *sight of the account*, never income.

---

## 5. Isolation proof (brief §2)

- `raw/01-isolation-before.txt` — `sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl` **before** any run.
- `raw/99-isolation-after.txt` — the **same** command after all runs, plus `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"`.
- The two digests are **byte-identical** (see §7). The four pre-existing 06:53Z baseline files are the only `-newermt` matches; my runs wrote only to throwaway roots.

---

## 6. What I could NOT establish — named BLOCKED

| # | BLOCKED / UNVERIFIED item | Missing capability | Why (measured) |
|---|---|---|---|
| 1 | **Any real account figure.** | A human reading their own dashboard. | `operator-state.json` `records = 0` (raw/05); the routine has never held a live number. |
| 2 | **Which provider holds the monitored balance.** | An operator statement. | No file in the repo names it; no credential present; not a fetchable fact. |
| 3 | **Whether freecash.com offers any (NDA/partner) read API.** | Almedia confirmation. | No public developer surface; ToS forbids automated access. Claim = documented absence, not proof of non-existence. |
| 4 | **A provider-authenticated read.** | An entitled account + out-of-repo credential. | R1 forbids it; no credential exists. |
| 5 | **HG.Cash / Cashfree as *this* account's provider.** | Operator evidence. | Both are B2B rails; nothing links them to the monitored account. |
| 6 | **HG.Cash rate limits.** | Onboarding/API-support contact. | Not published in the docs index. |
| 7 | **Cashfree Get Balance application-level liveness.** | A real token. | Prior unauthenticated probe returned edge-level 403 HTML, not the documented JSON. |
| 8 | **The two `provider_credentials` DB rows.** | Authorisation. | Values not read; off-limits. |
| 9 | **freecash.com `/fc-api/` behaviour.** | — (deliberately unanswered) | robots-disallowed and undocumented; must not be probed. |
| 10 | **A full line-by-line re-read of all 40 corpus files.** | Time budget. | Inventory in §4 is classification by date/series/self-declared supersession + a numbering scan, not a semantic re-verification of each. |
| 11 | **End-to-end R3 (NOTIFY ON CHANGE) firing for a human in production.** | A free day key + an operator record. | Today's day key is spent (08:53 lock); every production snapshot is `data_available:false`. |

---

## 7. Evidence index

| Path | Contents |
|---|---|
| `raw/01-isolation-before.txt` | pre-run sha256 of production `last-run.json` + `alerts.jsonl` |
| `raw/03-source-proof-redgreen.txt` | the RED/GREEN source proof (raw output) |
| `raw/05-production-state-and-allowlist.txt` | production snapshot (all-null), `records=0`, empty approvals, `readonly_client` allowlists, both docstring first lines, R4 tree listing |
| `raw/06-provider-live-fetch.txt` | every provider claim, live-fetched and quoted (ToS §16/§17, robots.txt, HG.Cash, Cashfree, BLOCKED list) |
| `raw/07-corpus-inventory.txt` | top-level file listing + the R1/R2 numbering scan across the whole tree |
| `raw/07b-corpus-abstracts.txt` | one-line abstract per top-level corpus doc |
| `raw/99-isolation-after.txt` | post-run sha256 (identical) + `find … -newermt` |
| `repro/run_source_proof.sh` | the copy-and-run proof script |
| `repro/corpus_inventory.py`, `repro/corpus_abstracts.py`, `repro/cleanup.py` | inventory + cleanup helpers |

**Isolation digests (before == after):**
- `data/freecash-monitor/state/last-run.json` → `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9`
- `data/freecash-monitor/alerts/alerts.jsonl` → `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8`

**One-line bottom line:** the routine enforces read-only in code but has **no reachable source of real data** — (a) the operator-entered file is the only source that works today and the only one yielding all four figures; (b) a loopback bridge is ToS-blocked on freecash.com; (c) a documented provider API is real for HG.Cash (3 of 4 fields, no read-only scope) and R1-incompatible for Cashfree (POST-minted 6-minute token), and unreachable anyway until the loopback-only host allowlist is widened by a human decision.

*No credential was used, no authenticated request was made, no external action was taken, and the production state root is byte-identical before and after.*

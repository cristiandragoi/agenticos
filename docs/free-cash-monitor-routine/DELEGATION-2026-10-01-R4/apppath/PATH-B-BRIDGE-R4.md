# PATH-B BRIDGE R4 — the app-path (already-authenticated) account state → the routine's source shape

**Delegation:** `DELEGATION-2026-10-01-R4` · **Stream:** A (app-path bridge, RS-2) · **Directory:** `apppath/`
**Repo:** `D:\AgenticOS` · branch `hermes-rescue-20260908` · HEAD `8f7463aa6931d57e12ec81b904b98cec04e932cf`
**Written:** 2026-10-01, pass window `11:44` → `11:54` local (Europe/Berlin, UTC+02:00)
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` → `Python 3.11.9` (tzdata present)
**Shell:** git-bash / MSYS, non-elevated. **Raw evidence:** `raw/01-app-path-artefact-inventory.txt`, `raw/02-live-api-probes.txt`, `raw/03-source-reads.txt`, `raw/04-wiring-and-routes.txt`, `raw/05-isolation-after.txt`, `raw/10-probe-red-path.txt`, `raw/11-mapping-in-scratch.txt`
**Closes:** Q3 + Q4 of `../research/RESEARCH-PLAN-R4.md` §2 (RS-2). **Coordinates with** sibling stream S (`../source/`) by reading, never by merging.

Evidence labels: **[A]** measured in this pass · **[B]** read from source (`file:line`) · **[C]** inherited and **not** re-verified.

---

## 0. The four operational rules (operator numbering — title always carried with the number)

| # (operator) | Rule | What this stream did |
|---|---|---|
| **R1 — zero automated earning actions** | observe only; no POST/PUT/PATCH/DELETE, no provider login, no credential entry, `[REDACTED]` only | every probe was a loopback **GET**; no body, no credential; `probe_apppath_bridge_r4.py` speaks raw HTTP/1.1 GET only |
| **R2 — exactly one status read per Europe/Berlin calendar day** | one read per calendar day; a second run reads nothing | **no** routine invocation against the production root; no `gate` import in the probe; `FREECASH_DATA_ROOT` pinned to `%LOCALAPPDATA%\Temp\fcr4-apppath-*` for the one capped scratch demo |
| **R3 — notify on change only** | prior snapshot loaded before the new one; exact comparison; one change → one notification | the scratch demo routes delivery through `notify._stub_send` (label `STUB_OK`, never `TOAST_OK`); no real toast |
| **R4 — human approval before any external action** | routine may enqueue only; nothing auto-executes | nothing was started, nothing authenticated on the user's behalf, no external action; the app is **not** running and was not launched |

> **Numbering hazard.** The shipped code's own labels are **inverted** relative to the operator numbering above (`gate.py:1` calls the day lock "R1"; `readonly_client.py:1` calls read-only "R2"). Every number in this document carries its title; a bare `R1`/`R2` here always means the operator numbering in the table above.

---

## 1. Bottom line

**Path B — the app-side already-authenticated path — is `server/src/services/freeCash/freeCashExecutor.ts`.** It establishes a real session in a managed persistent browser profile and persists evidence to disk. [B] `freeCashExecutor.ts:44-50,118-124,150-189`.

**But Path B carries no account figures.** The only "account state" it ever persists is a **session-state string** (`authenticated` / `unauthenticated` / `unknown`) plus a handful of DOM booleans. The one function that was written to inspect the account, `inspectAccountState()`, records `balance_text_present=<bool>` — a *length* boolean, never a number — and that artefact type (`inspect-account-*.json`) **has never been written**. [A] `raw/01`; [B] `freeCashExecutor.ts:262-267`.

| Question | Answer measured this pass |
|---|---|
| Does an artefact that carries authenticated account state exist? | **Yes, for session state only.** `session-evidence.json` + `evidence/session-authenticated-*.json` (`authenticated: true`, `verifiedAt 2026-09-23T15:32:31Z`). [A] |
| Does it survive an app restart? | **It is on disk under `%APPDATA%` and has survived** — its mtime is 2026-09-23 and the app was not running when read. Durability: **yes, proven by persistence**, freshness: **no (7.76 d stale)**. [A] |
| Does it carry the four routine fields? | **No.** `account_status` → session proxy only; `earnings_total_cents`, `balance_cents`, `pending_cents` → **absent everywhere on Path B**. [A]+[B] |
| Is the live app-path HTTP surface reachable now? | **No.** `127.0.0.1:4600` refused (curl exit 7) at 11:45 and 11:48; the parent brief's 11:42 `200` did not reproduce. [A] `raw/02` |
| Does the routine need to change to consume it? | The **file shape** lands unmodified (proved). To consume it **safely** the routine needs a per-field availability notion — otherwise a status-only reading against a money-bearing baseline emits a **spurious `EARNINGS_CHANGED`**. [A] `raw/11` |

**Framing (from the 2026-09-21 addendum, re-read [A]):** the missing piece is a *bridge*, not a new monitor and not a new read transport. This document is that bridge's mapping. It does **not** widen `readonly_client.ALLOWED_PATHS` and does **not** extend the stub adapter.

---

## 2. Deliverable (1) — the artefact path(s) that carry authenticated account state

All three live **outside the repo**, under the app's own data dir, which is `path.dirname(resolvedDbPath)` = `C:\Users\cd-pr\AppData\Roaming\AgenticOS\data` [B] `freeCashExecutor.ts:44-46`, `prerequisiteService.ts:53-59`. Raw listing: `raw/01`.

### 2.1 The authoritative auth-state artefact

```
C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\freecash\session-evidence.json
mtime = 2026-09-23 17:32:50.438252800 +0200   size = 329
```
```json
{
  "service": "freecash",
  "authenticated": true,
  "verifiedAt": "2026-09-23T15:32:31.406Z",
  "evidencePath": "C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\freecash\\evidence\\session-authenticated-mue9i5qd-3b0799d2.json",
  "detail": "final_url=https://freecash.com/en; cookie_count=8; session_cookie_present=true"
}
```
**[A]** `raw/01` line 69-76. It is written **only** by a live probe [B] `freeCashExecutor.ts:157-164` → `prerequisiteService.writeSessionEvidence` [B] `prerequisiteService.ts:75-80`. Its `authenticated` flag is the app's own contract for "a live probe verified the session"; internal project state never satisfies it [B] `freeCashExecutor.ts:16-18`.

### 2.2 The per-probe DOM-fact artefact (newest of 27)

```
C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\freecash\evidence\session-authenticated-mue9i5qd-3b0799d2.json
mtime = 2026-09-23 17:32:50.438252800 +0200   size = 265
```
```json
{
  "kind": "session-authenticated",
  "payload": {
    "observed": ["final_url=https://freecash.com/en", "cookie_count=8", "session_cookie_present=true"],
    "url": "https://freecash.com/en"
  },
  "writtenAt": "2026-09-23T15:32:50.437Z"
}
```
**[A]** `raw/01` lines 78-91. Written by `writeEvidenceArtifact(kind, payload)` [B] `freeCashExecutor.ts:118-124`.

### 2.3 The work inventory artefact (newest of 26) — what `inspectAvailableWork()` persists

```
C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\freecash\evidence\inspect-work-mue9i6jw-b0ec83de.json
mtime = 2026-09-23 17:32:51.500791500 +0200   size = 175
```
```json
{ "kind": "inspect-work", "payload": { "state": "authenticated", "items": [], "url": "https://freecash.com/en" }, "writtenAt": "2026-09-23T15:32:51.500Z" }
```
**[A]** `raw/01` lines 93-103. `items` is empty, and item texts are *offer/task titles*, never money [B] `freeCashExecutor.ts:285-297`.

### 2.4 The artefact that would carry account numbers — **absent**

```
$ ls "$APPDATA/AgenticOS/data/freecash/evidence/"inspect-account-*.json
ls: cannot access '.../evidence/inspect-account-*.json': No such file or directory
```
**[A]** `raw/01` lines 105-106. `inspectAccountState()` *would* write `inspect-account-<ts>.json`, but (a) it records no number and (b) **nothing calls it** — a repo-wide grep finds only its own definition [B] `freeCashExecutor.ts:252`; no route and no controller import it. Raw: `raw/04` §"freeCashExecutor importers". `login-verified-*.json` is likewise absent [A] `raw/01` lines 108-109.

### 2.5 What the live HTTP surface exposes (measured)

| Probe (loopback, GET, no credential) | Result at 11:48 | Result at 11:42 (inherited lead) |
|---|---|---|
| `curl -s -m5 http://localhost:4600/api/health` | **HTTP 000**, curl exit **7** (refused) | `200` per parent brief |
| `curl -s -m5 http://localhost:4600/api/projects/proj-free-cash/freecash/auth` | **HTTP 000**, curl exit **7** | `200` session-state JSON per R3 |
| `curl -s -m5 http://localhost:4600/api/projects` | **HTTP 000**, curl exit **7** | — |
| `tasklist \| grep -ci electron` | **0** | 0 |
| `netstat -ano \| grep :4600` | **no listener** (server PID 32500 gone) | LISTENING node.exe 32500 |

**[A]** `raw/02`. **Disagreement recorded, not resolved:** the app-path API was up at 11:42 and down by 11:45 in the same morning. Nothing in this stream stopped it (no kill, no write). The route's payload shape (session state only) is [B] from `projects.ts:344-379`, quoted in `raw/04` lines 58-94 — *not* re-measured live this pass.

**Conclusion for (1):** the artefact paths that carry authenticated account state are the three in §2.1–2.3. **None carries `earnings_total_cents`, `balance_cents` or `pending_cents`.** The account-figure artefact type (§2.4) does not exist. This is a *finding*, not an omission: a bridge can map a session-state proxy today, but the money monitoring the routine exists to provide has **no app-path source**.

---

## 3. Deliverable (2) — the exact four-field mapping into `operator_state.py`'s shape

The routine's read source is `state/operator-state.json`; a record is matched by exact `day_key`, and `operator_state.read_source()` copies only the keys present, then `changedetect.build_snapshot` takes each field with `.get(field)` → `None` when absent. [B] `operator_state.py:104-151`, `changedetect.py:150-176`. The template record [B] `operator_state.py:48-56` fixes the field names as `account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`, `currency` (integer **cents**).

| Routine field | Path-B origin | Unit conversion | Null policy |
|---|---|---|---|
| `account_status` | `session-evidence.json` → `authenticated` bool, cross-checked against the newest `evidence/session-*.json` `payload.state`, cross-checked against the live route's `sessionState` [B] `projects.ts:363-367` | none (string) | Emit a **session proxy**: `authenticated` → `"SESSION_AUTHENTICATED"`; `unauthenticated` → `"SESSION_UNAUTHENTICATED"`; `unknown`/absent → **`null`**. The routine upper-cases via `normalize_metrics` only on the `metrics_http` path; on the operator path the string is used verbatim, so the bridge writes it already upper-case. **This is NOT the provider's account-status vocabulary** (e.g. `ACTIVE`) — Path B exposes none; the proxy supports `STATUS_CHANGED` only. |
| `earnings_total_cents` | — none — | n/a | **Always `null`.** No Path-B artefact, probe, route or DB column carries an earnings figure. |
| `balance_cents` | `inspectAccountState()` `balance_text_present=<bool>` [B] `freeCashExecutor.ts:262-267` | **none exercised** — only a boolean exists. If a future extractor captures a displayed dollar string, `changedetect._as_cents` converts `str`→cents via `round(float(x)*100)`, and `_DOLLAR_ALIASES` converts whole-currency keys `balance`/`earnings`/`pending`; but that conversion only runs on the `metrics_http` path — the **operator path stores cents as-is**. | **Always `null` today.** |
| `pending_cents` | — none — | n/a | **Always `null`.** |
| `currency` | — none — | n/a | **Omit the key** (→ snapshot `currency: null`). See §5: including a guessed `"USD"` is what turns a status-only reading into a spurious money alarm. |
| `day_key` / `entered_at_utc` | generated by the bridge | Europe/Berlin calendar date; ISO-8601 `Z` | required; `day_key` must equal today's operator-local day or `record_for_day()` returns `None` and the routine reports `data_available=False`. [B] `operator_state.py:104-116` |

### Null policy — the exact semantics that matter

1. **A missing/null money field is tolerated by `operator_state`** (no raise — only the `metrics_http` path's `normalize_metrics` raises on a missing field [B] `changedetect.py:125-131`). Present in my probe: the mapping never raises.
2. **`data_available` is all-or-nothing.** A record present for today sets `data_available=True` even when all three money fields are null [B] `operator_state.py:127-151`, `changedetect.py:154,169-173`. There is **no per-field availability** anywhere in the routine.
3. **`null` is a comparable value.** `compare()` treats `old == new: continue`; an integer → `null` transition is therefore **a change** (`EARNINGS_CHANGED` / `BALANCE_CHANGED`) [B] `changedetect.py:256-275`.
4. **One accidental mitigation exists:** if `currency` differs across the two snapshots, `compare()` prints `currency changed …; money comparison skipped` and skips every money field for that day [B] `changedetect.py:242-249`. Omitting `currency` in the bridge triggers this — but it also nulls the money comparison for a day on which a real figure might be present, so it is a trap, not a fix.

Both directions of (3) and (4) were reproduced on a **copy** of the package in a throwaway root — `raw/11`, summary in §5.

---

## 4. Deliverable (3) — the single command a human runs to produce one reading

```
"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" \
  D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/apppath/probe_apppath_bridge_r4.py
```

* When a **fresh authenticated session** exists it exits **0** and writes the candidate operator-state doc to
  `%LOCALAPPDATA%\Temp\fcr4-apppath-<pid>\candidate-operator-record.json` (never the production root).
* When it does not, it exits **3**, prints `VERDICT: NO_AUTHENTICATED_SESSION`, and **names each reason** — which is the state today (§6).
* It never imports the routine, never acquires a day lock, and prints the production-root sha256 before/after itself.

The underlying app-path read it consumes is the persisted evidence plus, when the app is up, a bare
`curl -s -m5 http://localhost:4600/api/projects/proj-free-cash/freecash/auth` (loopback GET, no credential, session state only).
Producing a **fresh** session is a human act inside the managed profile (`startInteractiveLogin()` / the `/auth/verify` POST route [B] `projects.ts:397-432`) — **R4 human-owned, not performed here**, and the reason the full reading stays BLOCKED.

---

## 5. Deliverable (4) — what the routine would have to change to consume it

Reproduced on a **copy** of `monitoring/freecash` under `apppath/routine_copy/`, with an injected clock and a throwaway `FREECASH_DATA_ROOT`. Raw: `raw/11-mapping-in-scratch.txt` (exit 0).

**The file shape needs no change.** A record with `account_status` + three nulls is read, snapshotted and compared exactly like an operator record — day-2 snapshot: `status='SESSION_AUTHENTICATED' earnings=None balance=None pending=None` [A] `raw/11`.

**To consume it safely, the routine needs one change: per-field availability.** Two scenarios on identical input, differing only in whether the bridge record carries `currency`:

| Scenario | Bridge record | Routine result on day 2 (after a money-bearing day 1) | Verdict |
|---|---|---|---|
| **A — `currency` omitted** | `SESSION_AUTHENTICATED`, money `null`, no currency | `MONITOR_DEGRADED: currency changed USD -> None; money comparison skipped` · **1** `STATUS_CHANGED` · 1 approval | acceptable by accident — the currency guard masks the null money |
| **B — `currency: "USD"`** | `SESSION_AUTHENTICATED`, money `null`, `currency=USD` | **3** changes / 3 notifications / 3 approval items: `STATUS_CHANGED` + **2 × `EARNINGS_CHANGED`** (`1340 → None`, `0 → None`) | **false alarm** — a status-only reading fabricates money events |

[A] `raw/11`. **Scenario B is the defect the mapping must not ship.** `data_available` cannot express "status known, money unknown", and `null` compares as a real value, so the routine:

1. **must gain per-field availability** (a record/snapshot `available_fields` list that `compare()` honours), **or** a dedicated source kind that maps only `account_status` and marks the money fields unavailable; and
2. **must not be wired through `readonly_client`.** Adding `^/api/projects/[^/]+/freecash/auth$` to `ALLOWED_PATHS` is a second transport and an R2 change — the 2026-09-21 addendum's S-11 explicitly rejects it, and this stream did **not** do it [A] `readonly_client.py:43-49`.

**Proposed minimal change (proposal only — not applied):**

```diff
--- a/monitoring/freecash/changedetect.py
+++ b/monitoring/freecash/changedetect.py
@@ COMPARED_FIELDS loop
     for field, change_type, subtype in COMPARED_FIELDS:
+        if available is not None and field not in available:
+            continue          # bridge reading did not carry this field; do not compare it
         if field in money_fields:
             continue
```
with `available` taken from `metrics.get("available_fields")` (a record-level list) and persisted into the snapshot. The bridge would then emit `"available_fields": ["account_status"]`, and the currency guard becomes unnecessary rather than load-bearing.

**Also required outside the routine (no code, a decision):** the app must actually *persist a figure* before the bridge is worth wiring. Today `inspectAccountState()` records `balance_text_present=<bool>` and nothing else [B] `freeCashExecutor.ts:262-267`, and nothing calls it [A] `raw/04`. Without an app-side numeric extractor, Path B can never feed `EARNINGS_CHANGED`/`BALANCE_CHANGED` — only `STATUS_CHANGED`.

---

## 6. The red case (acceptance bar) — captured this pass

`raw/10-probe-red-path.txt`, two consecutive runs:

```
$ python .../apppath/probe_apppath_bridge_r4.py
...
VERDICT: NO_AUTHENTICATED_SESSION
  REASON: APP_PATH_UNREACHABLE: no listener on 127.0.0.1:4600 (ConnectionRefusedError: [WinError 10061] ...)
  REASON: EVIDENCE_STALE: session-evidence.json authenticated=true but verifiedAt=2026-09-23T15:32:31.406Z (age 7.76 d > 24 h window)
RED_CASE: no authenticated Path-B session -> no reading is produced.
PRODUCTION_ROOT_UNCHANGED: YES
DAY_LOCK_CREATED: NO (this probe never imports the routine and never acquires a lock)
EXIT_CODE=3        # both runs
```
**[A]** exit code **3**, non-zero, reason named. Re-run semantics proven: the second run produced identical output; `day-locks/` after both runs still holds exactly `2026-09-20.lock`, `2026-09-30.lock`, `2026-10-01.lock` (08:53, pre-existing) [A] `raw/05`.

## 7. Isolation / hermeticity (before → after, measured)

| File | sha256 | Verdict |
|---|---|---|
| `data/freecash-monitor/state/last-run.json` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` | **== expected** [A] |
| `data/freecash-monitor/alerts/alerts.jsonl` | `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` | **== expected** [A] |
| `data/freecash-monitor/state/operator-state.json` | `be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c` | **== expected** [A] |

`find data/freecash-monitor -type f -newermt "2026-10-01 11:30"` → **zero lines** [A]. `find monitoring/freecash -type f ! -path "*__pycache__*" -newermt "2026-10-01 00:00" | wc -l` → **0** [A]. `git status --porcelain -- .../apppath/` → `?? …/apppath/` (new stream dir only; nothing tracked modified) [A]. All scratch state under `%LOCALAPPDATA%\Temp\fcr4-apppath-*`; the demo root is `fcr4-apppath-mapping-<pid>` and the probe's is `fcr4-apppath-<pid>`. Raw: `raw/05-isolation-after.txt`.

## 8. Corrections to inherited claims ([C] → [A])

Two claims in `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V7-ADDENDUM-BRIDGE-2026-09-21.md` (re-read this pass) no longer hold and are corrected rather than inherited:

1. "`reconcileGoalsOnStartup` wired at `server/src/index.ts:398`" — **the startup hook is commented out**: `server/src/index.ts:436-437` are `// import …` / `// void reconcileGoalsOnStartup()…`. Path B's automatic resume is **not** live at startup. [A] `raw/04` lines 28-30.
2. "`freecashMonitorAdapter` … no importer found" — it **is** imported by `operatorController.ts:4,115` and `turnController.ts:24,414`, and its `fetchStatus()` returns the hardcoded stub `earnedToday: 0, externalConnected: false` [B] `freecashMonitorAdapter.ts:198-209`. It is wired, it enforces no rule, and it must not be extended (consistent with the addendum's D-5, which stands). [A] `raw/04` lines 32-37.

Two facts also disagree with the R3 sibling document and are recorded as findings: (a) the `browser_profiles/freecash-main/storage_state.json` is at `…\data\browser_profiles\freecash-main\`, **not** under `…\data\freecash\` [A] `raw/04` lines 99-104 — I did **not** read its contents (credential-bearing); (b) the live API answered `200` at 11:42 and was **refused** by 11:45 [A] `raw/02`.

---

## 9. BLOCKED

| # | Blocked item | Exact command that failed / cannot complete | Why |
|---|---|---|---|
| B1 | A **live** app-path session reading | `curl -s -m5 http://localhost:4600/api/projects/proj-free-cash/freecash/auth` → exit **7**, HTTP **000** (`raw/02`) | no listener on `127.0.0.1:4600`; the desktop/app shell is not running this pass. Needs a human to start the app and authenticate. |
| B2 | Mapping `earnings_total_cents` / `balance_cents` / `pending_cents` from Path B | `grep -rn "inspectAccountState" server/src` → only its own definition (`raw/04`); `ls evidence/inspect-account-*.json` → not found (`raw/01`) | Path B has **no** numeric account artefact and no caller of the function that would produce one. A human session alone cannot supply them — an app-side extractor must be written first. |
| B3 | Validating the mapping against a **real** account reading | (same as B1) | no authenticated session exists; the mapping is proven only against a scratch copy with synthetic records (`raw/11`). |
| B4 | Re-measuring the `sessionState` route payload | `curl -s -m5 …/freecash/auth` → exit 7 (`raw/02`) | route unreachable; its shape is cited [B] from `projects.ts:344-379`, not re-measured. |

Nothing above is presented as done. R1–R4 intact; production root byte-identical; no day lock created; no external action taken.

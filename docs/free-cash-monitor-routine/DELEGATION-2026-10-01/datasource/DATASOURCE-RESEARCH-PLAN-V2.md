# DATASOURCE-RESEARCH-PLAN-V2.md

**Free Cash daily monitor — resolving the unresolved read-only data source**

- **Pass:** 2026-10-01 (Europe/Berlin), run 08:42–08:48 local
- **Workspace:** `D:\AgenticOS`
- **Pinned interpreter:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (Python 3.11.9; the only interpreter on this host with `tzdata`, so `Europe/Berlin` resolves)
- **Deliverable directory (additive only):** `D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01/datasource/`
- **Companion evidence files:**
  - `evidence-01-source-quotes.txt` — pinned-interpreter dump of the source definitions
  - `evidence-02-provider-docs.txt` — every public-doc quotation with its URL
  - `run_operator_fallback_proof.py` — the executable fallback driver
  - `run-output-operator-fallback.txt` — its full raw output
  - `_run_console.txt` — the console transcript of that run

**Constraint ledger (what this pass did NOT do).** No scheduled task or cron entry registered. No pre-existing file modified or deleted; every new file is inside the deliverable directory above. No git write verb. No contact with any provider endpoint; no credential, token or key read, typed, stored or used; no authentication of any kind — provider facts come from public documentation pages only. `FREECASH_DATA_ROOT` was **UNSET** in the shell at pass start (echoed: `FREECASH_DATA_ROOT=[<UNSET>]`) and the production root `D:\AgenticOS\data\freecash-monitor` was never written — proven at the end of the fallback run (`production operator-state.json size: 879 (records=0)`).

**Baseline re-checked this session (unchanged):**
```
$ python monitoring/freecash/tests/run_all.py     -> run_all: tests=52 failures=0 errors=0 skipped=0
$ python monitoring/freecash/verify_readonly.py   -> forbidden=0 exempt=28 missing_targets=0
                                                     PASS - no unexempted write/earning token found.
```

**Evidence classes used below**
- **(a) EXECUTED** — produced by a command run in this session; the command is shown.
- **(b) PUBLIC DOC** — a quotation from a provider-published page, URL cited.
- **(c) ASSUMPTION** — must be confirmed by the operator; marked `BLOCKED`.

---

## 1. The current read contract, quoted from source (EXECUTED)

Run once, with the pinned interpreter, from `D:/AgenticOS/monitoring/freecash`:

```
$ "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" - <<'PYEOF' | tee <deliverable>/evidence-01-source-quotes.txt
  ... regex-scans ALLOWED_METHODS / ALLOWED_HOSTS / ALLOWED_PATHS /
      PROVIDER_ENDPOINT_UNKNOWN / SCHEMA_VERSION / DEFAULT_DATA_ROOT /
      TEMPLATE_RECORD / _RECORD_FIELDS / COMPARED_FIELDS / build_snapshot
      and prints "<file>:<line>: <source>" for each hit ...
PYEOF
```

Full output: `evidence-01-source-quotes.txt`. The decisive lines, verbatim:

### 1.1 `readonly_client.py` — the placeholder and the allowlists

```
readonly_client.py:39: ALLOWED_METHODS = frozenset({"GET", "HEAD"})
readonly_client.py:41: ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
readonly_client.py:43: ALLOWED_PATHS = (
readonly_client.py:44:     re.compile(r"^/api/v1/status/metrics$"),
readonly_client.py:45:     re.compile(r"^/api/v1/status$"),
readonly_client.py:46:     # Provider paths are added here ONLY after research resolves them, one line
readonly_client.py:47:     # each, with a justification comment.  Nothing provider-facing is allowlisted
readonly_client.py:48:     # today -- see PROVIDER_ENDPOINT_UNKNOWN below.
readonly_client.py:49: )
readonly_client.py:52: BODY_KEYWORDS = ("data", "json", "files", "body", "content")
readonly_client.py:54: DEFAULT_BASE_URL = "http://localhost:3001"
readonly_client.py:60: PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
```

The module docstring fixes the two read ops that are deliberately missing (`readonly_client.py:20-21`):

```
    W3  GET   <provider balance/earnings status>   UNKNOWN
    W4  GET   <provider account status>            UNKNOWN
```

and states the enforcement order (`readonly_client.py:133-137`, inside `request()`):

```
    host = (parts.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ForbiddenWriteError("R2: host not allowlisted: %r" % host)
    path = parts.path or "/"
    if not any(pattern.match(path) for pattern in ALLOWED_PATHS):
        raise ForbiddenWriteError("R2: path not allowlisted: %r" % path)
```

The same `ALLOWED_HOSTS` set also gates the process-wide audit hook (`readonly_client.py:162-163`), so a host allowlist edit must be honoured by both layers — it is one set, consumed twice.

The placeholder is **not** only decorative: it is written into every approval item that mentions a provider endpoint (`approval_queue.py:108-124`):

```
approval_queue.py:115:        "provider_endpoint",
approval_queue.py:116:        "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase",
```

...(observed live in the fallback run, §4 — every `pending.json` item carries
`"provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`).

### 1.2 `paths.py` — state layout and the snapshot schema version

```
paths.py:31: SCHEMA_VERSION = 1
paths.py:35: DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"
paths.py:45: def data_root() -> Path:                     # FREECASH_DATA_ROOT override
paths.py:47:     raw = os.environ.get("FREECASH_DATA_ROOT") or DEFAULT_DATA_ROOT
paths.py:87: def operator_state_path() -> Path:
paths.py:88:     return state_dir() / "operator-state.json"
```

### 1.3 `changedetect.py` — the snapshot schema and the compared fields

```
changedetect.py:34: COMPARED_FIELDS = (
changedetect.py:35:     ("account_status", "STATUS_CHANGED", None),
changedetect.py:36:     ("earnings_total_cents", "EARNINGS_CHANGED", None),
changedetect.py:37:     ("balance_cents", "BALANCE_CHANGED", None),
changedetect.py:38:     ("pending_cents", "EARNINGS_CHANGED", "pending"),
changedetect.py:39: )
changedetect.py:63: _STATUS_ALIASES = ("account_status", "status")
changedetect.py:64: _CURRENCY_ALIASES = ("currency", "currency_code")
```

`build_snapshot()` (`changedetect.py:150-176`) — the exact object written to
`snapshots/<day>.json`:

```
changedetect.py:155:    snapshot = {
changedetect.py:156:        "schema_version": paths.SCHEMA_VERSION,
changedetect.py:157:        "day_key": day,
changedetect.py:158:        "captured_at_utc": paths.iso_utc(now),
changedetect.py:159:        "source": {
changedetect.py:160:            "kind": source.get("kind") or "unknown",
changedetect.py:161:            "read_ops": list(source.get("read_ops") or []),
changedetect.py:162:            "data_available": available,
changedetect.py:163:            "note": source.get("note"),
changedetect.py:164:        },
changedetect.py:168:        "degraded": True,
changedetect.py:169:        "account_status": metrics.get("account_status") if available else None,
changedetect.py:170:        "earnings_total_cents": metrics.get("earnings_total_cents") if available else None,
changedetect.py:171:        "balance_cents": metrics.get("balance_cents") if available else None,
changedetect.py:172:        "pending_cents": metrics.get("pending_cents") if available else None,
changedetect.py:173:        "currency": metrics.get("currency") if available else None,
changedetect.py:174:        "raw_response_sha256": sha256_hex(raw_body),
changedetect.py:175:    }
```

Two hard facts from `normalize_metrics()` (`changedetect.py:111-138`): it raises
`MetricError` when any of the four fields is missing, and it accepts either
integer cents (`balance_cents`, `earnings_cents`, `total_earnings_cents`,
`available_cents`, `net_balance_cents`, `pending_cents`, `pending_total_cents`)
or whole-currency dollars (`balance`, `earnings`, `earnings_total`,
`available`, `pending`) which it multiplies by 100. `account_status` is
`.strip().upper()`-normalised.

### 1.4 `operator_state.py` — the operator record schema

```
operator_state.py:45: KIND = "operator_entered"
operator_state.py:48: TEMPLATE_RECORD = {
operator_state.py:49:     "day_key": "YYYY-MM-DD",
operator_state.py:50:     "entered_at_utc": "YYYY-MM-DDTHH:MM:SSZ",
operator_state.py:51:     "account_status": "ACTIVE",
operator_state.py:52:     "earnings_total_cents": 0,
operator_state.py:53:     "balance_cents": 0,
operator_state.py:54:     "pending_cents": 0,
operator_state.py:55:     "currency": "USD",
operator_state.py:56: }
operator_state.py:58: _RECORD_FIELDS = (
operator_state.py:59:     "day_key", "entered_at_utc", "account_status",
operator_state.py:62:     "earnings_total_cents", "balance_cents", "pending_cents", "currency",
operator_state.py:66: )
```

`read_source()` (`operator_state.py:119-151`) selects the record whose
`day_key` equals the run's operator-local day, returns `data_available: True`
with those fields as its `payload`, and strips `day_key`/`entered_at_utc`; a
missing record yields `data_available: False` → the run reports
`MONITOR_DEGRADED`. It opens no socket and holds no credential.

### 1.5 `run_daily_check.py` — source selection

```
run_daily_check.py:52: DEFAULT_SOURCE = "operator_state"
run_daily_check.py:53: SOURCES = ("operator_state", "metrics_http")
run_daily_check.py:81:     kind = explicit or os.environ.get("FREECASH_READ_SOURCE") or DEFAULT_SOURCE
```

`build_parser()` (`run_daily_check.py:251-262`) exposes `--source`, `--base-url`,
`--print-state`, `--force-recheck` (refused) and `--version`. **There is no
`--now` flag**, so a single CLI process cannot be moved to a second
operator-local day; the only documented seam for that is `run(now=...)`
(`run_daily_check.py:265-273`, "``now`` is a test seam: it pins the whole run's
clock"). This is load-bearing for §4.

**Conclusion of §1.** The routine has a fully specified, enforced read contract
for *two local* sources only. The provider read ops `W3`/`W4` are named but
unimplemented, unallowlisted, and the placeholder literal is the only thing
that stands where a provider endpoint would go. Nothing in
`monitoring/freecash/` mentions any provider host at all:
```
$ grep -rn "hg.cash\|cashfree\|freecash.io" monitoring/freecash/ 2>/dev/null | grep -v __pycache__
(no output)
```

---

## 2. Candidate providers against R1, from public documentation (PUBLIC DOC)

Full quotations and URLs: `evidence-02-provider-docs.txt`. No provider was
contacted; the freecash.io page could not be fetched and is marked UNVERIFIED.

| Provider | Documented read-only endpoint | (i) balance | (ii) account status | Requires a write verb / earning capability? | Verdict |
|---|---|---|---|---|---|
| **FreeCash.io / freecash.com** | None provider-published | **NO** | **NO** | ToS §17.2 prohibits automated *or manual* monitoring without prior written consent | **DISQUALIFIED** |
| **HG.Cash** | `GET /api/v1/accounts`, `GET /api/v1/account/{id}/balance` — docs.hg.cash | **YES** `balance`, `netBalance` | **YES** `status` ∈ {`Operativa`,`Bloqueada`,`Cerrada`} | Read itself is `GET`-only, **but** the single bearer token also authorises `POST /transactions` (cash out); no read-only scope documented | **CONDITIONAL** |
| **Cashfree Payouts** | `GET /payout/v1/getBalance` — cashfree.com | **YES** `data.balance`, `data.availableBalance` | **NOT DOCUMENTED** | Token is minted by `POST /payout/v1/authorize`; AppId/SecretKey can Self-Withdraw | **DISQUALIFIED as a routine integration** |

### 2.1 FreeCash.io / freecash.com — DISQUALIFIED

Provider-published, fetched 2026-10-01 from
<https://freecash.com/en/policies/terms> (Almedia GmbH, "Last Updated: July 17, 2026"):

> **16. Use of the Website** — "These Terms of Services permit you to use the Website for your **personal, non-commercial use only**."
>
> **17. Restrictions and Prohibited Uses** — "Additionally, you agree not to: … **Use any robot, spider or other automatic device, process or means to access the Website for any purpose, including monitoring or copying any of the material on the Website.** … Use any **manual** process to **monitor** or copy any of the material on the Website … **without our prior written consent.**"

R3 is "status checked once per day" — i.e. monitoring. §17.2 forbids it
automated *or* manual without prior written consent, and §16.1 confines use to
personal non-commercial. There is no provider-published developer API for an
account's own balance/status; the only "Freecash API" surfaces found are
third-party scrapers of *public* feed data (<https://parse.bot/…/freecash-io-api>,
whose own text states the platform "not publish a documented public developer
API") and a third-party Apifox collection fragment — neither is a provider
contract, and neither returns the monitored account's balance or status.

`https://freecash.io` returned `web_extract → "Keyless Exa extract failed …
unknown error"`. **UNVERIFIED** what that host serves today; prior repo research
recorded it as a parked GoDaddy lander, not re-checked here.

### 2.2 HG.Cash — CONDITIONAL (the only candidate that satisfies (i) and (ii))

Provider-published, fetched 2026-10-01 from
<https://docs.hg.cash/api-reference/accounts/get-user-accounts> (and the
machine-readable <https://docs.hg.cash/api-reference/openapi.yaml>):

> **Get User Accounts** — "Returns the authenticated user's accounts, including **ledger balance, pending fees, net available balance** (balance minus pending fees), and **account status**."
>
> `GET /accounts` → `200` → `{ data: [ { id, name, balance, pendingFees, netBalance, status, currency, number, alias, platform } ] }`
> - `balance` — "Account ledger balance rounded to 2 decimals"
> - `pendingFees` — "Fees accrued but not yet collected, rounded to 2 decimals"
> - `netBalance` — "Available balance after pending fees (balance minus pending fees), rounded to 2 decimals"
> - `status` — "Account lifecycle status", `enum: [Operativa, Bloqueada, Cerrada]`
>
> Servers: `https://hg.cash/api/v1` (production) · `http://dev.hg.cash/api/v1`
> Security: `bearerAuth` — "User API authentication token with format: `cash_<64-char-hex>`"
>
> <https://docs.hg.cash/openapi>: "To create cash-outs (money leaving your accounts), you must call the **Cash Out** endpoint: Create Transaction Request (Cash Out) (`POST /transactions`)."

- **(i) balance — YES** (`balance` / `netBalance` / `GET /account/{id}/balance`).
- **(ii) account status — YES** (`status` enum).
- **Write requirement — the read itself is `GET`-only, but the credential is not scoped:** one token, generated in account settings, both reads accounts and can `POST /transactions`. No read-only scope is documented. This is the R1/R2 exposure the operator must accept or refuse.
- **No cumulative-earnings field exists anywhere in the documented schema.** `balance` is a ledger balance. `changedetect.normalize_metrics()` will raise `MetricError` without `earnings_total_cents`. So HG.Cash supplies **two of the four** compared fields.
- **Entity link is absent.** HG.Cash's documented accounts are ARS/Coelsa (CVU/CBU). Nothing in the repo maps `proj-free-cash`'s balance to an HG.Cash account → `BLOCKED` (§5).

### 2.3 Cashfree Payouts — balance documented, status not; DISQUALIFIED as a routine integration

Provider-published, fetched 2026-10-01 from
<https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance>:

> "Use this API to get the **ledger balance and available balance** of your account."
> `GET /payout/v1/getBalance` (server `https://payout-api.cashfree.com`) → `200` → `{ status, subCode, message, data: { balance: '214735.50', availableBalance: '173980.50' } }`
> Errors: `403 "Token is not valid"` · `412 "Token missing in the request"` · `403 "APIs not enabled. Please fill out the Support Form …"`

From <https://www.cashfree.com/docs/api-reference/payouts/v1/authorize>:

> "Use this API to authenticate with the Cashfree system and obtain the authorization bearer token. **All other API calls must have this token** as Authorization header …" — and the call is `POST /payout/v1/authorize` (headers `X-Client-Id`, `X-Cf-Signature`).

From <https://www.cashfree.com/docs/api-reference/payouts/v1/end-points>:

> "Cashfree uses API keys to allow access to the API. Once you have signed up at our merchant site, you will be able to see your AppId and SecretKey."

The Payouts v1 Account APIs list only *View Balance*, *Self Withdrawal*, *Internal
Transfer* (<https://www.cashfree.com/docs/api-reference/payouts/v1/payouts-api-overview>)
— **no account-lifecycle/status endpoint is documented anywhere**.

- **(i) balance — YES** (`data.balance`, `data.availableBalance`).
- **(ii) account status — NOT DOCUMENTED.** The only `status` on that page is the API call's own status/subCode, not the merchant account's lifecycle.
- **Write verb required for the token** (`POST /payout/v1/authorize`), which the monitor's `ALLOWED_METHODS = {"GET","HEAD"}` and body-keyword refusal expressly forbid; the AppId/SecretKey can also Self-Withdraw. **DISQUALIFIED for a routine integration under R1**, and it yields a merchant payout balance, not the FreeCash earning balance.

### 2.4 Local metrics substitute (context)

`readonly_client.read_status_source()` (`readonly_client.py:229-239`) runs `W1`
`GET /api/v1/status/metrics` + `W2` `HEAD /api/v1/status` against
`http://localhost:3001`. It reports AgenticOS-local health and is marked
`degraded: true`; it is never a provider figure.

**Section verdict.** No candidate provider offers a documented read-only
contract that is simultaneously (a) the monitored account's own figure,
(b) free of any write/earning capability, and (c) not prohibited by its own
terms. HG.Cash comes closest but yields no earnings field and carries an
unscoped token. **The only option that is compliant and executable today is the
operator-entered state file (§4).**

---

## 3. Field mapping and the allowlist edit (proposal — nothing edited)

### 3.1 Exact mapping from the chosen candidate (HG.Cash) into the snapshot schema

Target snapshot fields are fixed by `changedetect.build_snapshot()` (§1.3);
target record fields by `operator_state.TEMPLATE_RECORD` (§1.4).

Assume the operator confirms one HG.Cash account id `A` for the monitored entity.

| Snapshot field | HG.Cash source (`GET /api/v1/accounts` → `data[i]` where `id == A`) | Transform | Status |
|---|---|---|---|
| `account_status` | `status` (`Operativa`\|`Bloqueada`\|`Cerrada`) | `.strip().upper()` → `OPERATIVA`/`BLOQUEADA`/`CERRADA` (done by `normalize_metrics`) | **DOCUMENTED** |
| `balance_cents` | `balance` (number, 2 d.p.) | `int(round(balance * 100))` — `_DOLLAR_ALIASES` already contains `balance` | **DOCUMENTED** |
| `pending_cents` | `pendingFees` (number, 2 d.p.) | `int(round(pendingFees * 100))` | **DOCUMENTED** |
| `currency` | `currency` | `.strip().upper()` | **DOCUMENTED** |
| `earnings_total_cents` | **no such field exists** | — | **BLOCKED — no documented source.** `normalize_metrics()` raises `MetricError` without it. |

Two consequences an implementer cannot wish away:

1. **`pendingFees` is a fee accrual, not a pending earning.** Mapping it to
   `pending_cents` would make a fee movement emit `EARNINGS_CHANGED` (subtype
   `pending`) — semantically wrong. Mapping it to `0` is honest but discards data.
2. **`earnings_total_cents` has no HG.Cash source.** Either the operator rules
   that HG.Cash `balance` *is* the earnings figure (an operator
   interpretation, `BLOCKED`), or a different provider read is required.
   `netBalance` may be used as `balance_cents` instead of `balance` if the
   operator defines the monitored figure as "available", but that is again an
   operator decision, not a docs fact.

A `metrics_http`-shaped payload the monitor would accept, were the earnings
question ever answered, would be:
```json
{ "status": "Operativa",
  "balance": 13.40,
  "pendingFees": 0.00,
  "currency": "USD" }
```
which `normalize_metrics()` turns into
`{"account_status":"OPERATIVA","balance_cents":1340,"pending_cents":0,"currency":"USD"}`
— and then **raises** on the missing `earnings_total_cents`.

### 3.2 Smallest allowlist edit that admits the chosen host (PROPOSAL ONLY)

If the operator chooses HG.Cash, the **only** literal change inside
`ALLOWED_HOSTS`/`ALLOWED_PATHS` is one host string and one path regex. In
`readonly_client.py`:

```diff
-ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
+ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]", "hg.cash"})

 ALLOWED_PATHS = (
     re.compile(r"^/api/v1/status/metrics$"),
     re.compile(r"^/api/v1/status$"),
+    re.compile(r"^/api/v1/accounts$"),   # HG.Cash GET /accounts -- read-only, docs.hg.cash/api-reference/accounts/get-user-accounts
+    # optional: re.compile(r"^/api/v1/account/[0-9a-fA-F-]{36}/balance$"),
     # Provider paths are added here ONLY after research resolves them, one line
     # each, with a justification comment.  Nothing provider-facing is allowlisted
     # today -- see PROVIDER_ENDPOINT_UNKNOWN below.
 )
```

`ALLOWED_HOSTS` is consumed twice — in `request()` (`readonly_client.py:133`)
and in the process-wide `_audit_hook()` (`readonly_client.py:162`) — so the one
added host covers both layers. `_transport()` already derives the port
(`443` for `https`), so no port change is needed.

**But the allowlist edit alone admits nothing.** It is necessary, not
sufficient. Three further changes, each *outside* the allowlist, are required
before a single byte of provider data could reach a snapshot — and none of them
may be made without the operator's decisions in §5:

1. **A provider read op.** `W3`/`W4` do not exist as functions; only `W1`/`W2` (`read_metrics`, `probe_status`) are implemented. A new function that calls `request("GET", base + "/api/v1/accounts", headers={"Authorization": "Bearer ..."})` and feeds `changedetect.normalize_metrics()` is new code, not a config edit.
2. **A credential.** `request()` accepts `headers`, but nothing in the routine populates an `Authorization` header, and `read_status_source()` passes none. The bearer `cash_<64-hex>` token must come from somewhere; storing/loading it is the credential-handling decision `BLOCKED` in §5. This pass neither read nor used any credential.
3. **The base URL.** `readonly_client.base_url()` reads `FREECASH_READ_BASE_URL` (default `http://localhost:3001`). A production read would set it to `https://hg.cash` (the docs list `https://hg.cash/api/v1` as the production server).

And the `PROVIDER_ENDPOINT_UNKNOWN` placeholder in `approval_queue.py:116` should
only be replaced with a real endpoint string **after** the operator has ruled;
until then it stays verbatim and greppable.

---

## 4. The operator fallback, executed on a throwaway root (EXECUTED)

Zero provider integration. `FREECASH_READ_SOURCE=operator_state`, a populated
`records[]`, and a throwaway `FREECASH_DATA_ROOT` under `%TEMP%`.

### 4.1 The exact command sequence

**Preconditions**
```bash
export PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"   # pinned (tzdata)
export FREECASH_READ_SOURCE=operator_state
export FREECASH_TZ=Europe/Berlin
export FREECASH_DATA_ROOT="C:/Users/cd-pr/AppData/Local/Temp/freecash-op-fallback"     # THROWAWAY, never the prod root
echo "FREECASH_DATA_ROOT=$FREECASH_DATA_ROOT"                                          # echo it BEFORE any run
```

**Day 1 — first real earnings figure**
```bash
# 1. create the state layout and the operator file, then append ONE record for today's local day
"$PY" - <<'PY'
import json, os, sys
sys.path.insert(0, r"D:/AgenticOS/monitoring/freecash")
import paths, operator_state, gate
paths.ensure_layout()
doc = paths.read_json(paths.operator_state_path(), default=None) or operator_state.template_document()
doc.setdefault("records", []).append({
    "day_key": gate.day_key(),                       # today, operator-local (Europe/Berlin)
    "entered_at_utc": paths.iso_utc(),
    "account_status": "ACTIVE",                      # operator reads this off their own dashboard
    "earnings_total_cents": 1340,                    # 1340 == $13.40, integer cents
    "balance_cents": 1340,
    "pending_cents": 0,
    "currency": "USD",
})
paths.write_json_atomic(paths.operator_state_path(), doc)
print("records:", len(doc["records"]))
PY

# 2. run the real entry point — it reads today's record and writes the baseline
cd D:/AgenticOS && "$PY" monitoring/freecash/run_daily_check.py
# expect: RUN_OK <today> outcome=INITIAL_BASELINE source=operator_entered(data_available=True) ...
```

**Day 2 — earnings move triggers EARNINGS_CHANGED**
```bash
# 3. append a record for the NEXT local day with a different earnings_total_cents
#    (repeat the step-1 heredoc with day_key=tomorrow and earnings_total_cents=1670)
# 4. run again on that day
cd D:/AgenticOS && "$PY" monitoring/freecash/run_daily_check.py
# expect: RUN_OK <day2> outcome=EARNINGS_CHANGED ... changes=1 notifications=1 approvals=1
```

**The one caveat, stated plainly.** `run_daily_check.py` has no `--now` flag
(§1.5); the day key comes from the real clock. So the two days above must be
*real consecutive days* to be reached through the CLI. To prove the exact same
code path in one sitting, the routine's documented `run(now=...)` seam is the
only mechanism — that is what the driver below uses. It calls the real
`run_daily_check.run()` twice; it does not re-implement it.

### 4.2 The executed proof

```bash
$ "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" \
      docs/free-cash-monitor-routine/DELEGATION-2026-10-01/datasource/run_operator_fallback_proof.py
```
Full output: `run-output-operator-fallback.txt`. Salient lines:

```
interpreter              : C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe
tzdata importable        : True
FREECASH_DATA_ROOT       : C:\Users\cd-pr\AppData\Local\Temp\freecash-datasource-v2-23376
paths.data_root()        : C:\Users\cd-pr\AppData\Local\Temp\freecash-datasource-v2-23376
PRODUCTION root          : D:\AgenticOS\data\freecash-monitor
FREECASH_READ_SOURCE     : operator_state
resolve_source(None)     : operator_state
FREECASH_TZ / tz report  : Europe/Berlin / {"configured": "Europe/Berlin", "kind": "zoneinfo", "available": true, "offset_now": "+0200"}

--- run day1 first-reading (2026-10-01T06:35:00Z) exit=0 ---
  RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True) snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
--- run day2 earnings-moved (2026-10-02T06:35:00Z) exit=0 ---
  RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True) snapshot=2026-10-02.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-10-02.lock
--- run day2 duplicate (2026-10-02T06:35:00Z) exit=0 ---
  SKIP_DUPLICATE_DAY 2026-10-02
```

The R3 evidence line, raw from `alerts/alerts.jsonl`:

```json
{"day_key": "2026-10-02", "dedupe_key": "47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281", "event_id": "2c02dc38-bda6-4f28-9b79-ef191dcc3b94", "event_type": "EARNINGS_CHANGED",
 "message": "[FreeCash] EARNINGS CHANGE 2026-10-02\nEarnings:  $13.40 -> $16.70  (+$3.30)\nBalance:   $16.70 (changed too)\nPending:   $0.00\nStatus:    ACTIVE (unchanged)\nSource:    DEGRADED (operator-entered record for 2026-10-02)\nDetail:    alerts.jsonl dedupe=47d85a19609e1576\nACTION:    No action taken. Review and approve anything you want done.\nApproval:  574fea35-f8ed-4b76-b3e9-54136b30ee7b (PENDING - yours to decide, nothing executes)",
 "observed": {"field": "earnings_total_cents", "new_value": 1670, "old_value": 1340, "prior_day_key": "2026-10-01"}, "severity": "notify", "ts_utc": "2026-10-02T06:35:00Z"}
```

Dedupe persistence, from the run's SUMMARY block:
```
EARNINGS_CHANGED dedupe key (day2) = 47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281
  present in notified-keys.json  : True
  entry                          : {"delivery": "STUB_OK", "first_notified_at_utc": "2026-10-02T06:35:00Z", "updated_at_utc": "2026-10-02T06:35:00Z"}
```

R4 artefact, from `approvals/pending.json` (note the placeholder flowing through):
```json
{"approval_id": "574fea35-f8ed-4b76-b3e9-54136b30ee7b", "day_key": "2026-10-02",
 "change_dedupe_key": "47d85a19609e1576433151fecf021aff15eaa06575cc66bd9e3f5be76e352281",
 "reason": "earnings_total_cents moved from $13.40 to $16.70. Review and decide whether any action is wanted.",
 "proposed_action": {"action_type": "REQUEST_PAYOUT", "amount_cents": 1670,
   "destination": "OPERATOR_SPECIFIED - not stored by the routine",
   "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"},
 "status": "PENDING", "execution_state": "NOT_EXECUTED", "execution_allowed_by_this_routine": false}
```

Safety proof, last lines of the same run:
```
PRODUCTION ROOT UNTOUCHED CHECK
  production operator-state.json size: 879 (records=0)
  throwaway root written by this script: C:\Users\cd-pr\AppData\Local\Temp\freecash-datasource-v2-23376
```

**Interpretation, precisely.** With zero provider integration the monitor
already produces a first real earnings figure (`INITIAL_BASELINE`, no alarm —
correct, nothing to compare) and, on the second day, exactly one
`EARNINGS_CHANGED` line, one notification (offline stub, so labelled
`STUB_OK`, never `TOAST_OK`), and one `PENDING / NOT_EXECUTED` approval item.
The `degraded: true` marker and the `Source: DEGRADED (operator-entered …)`
line mean an operator-entered reading can never be mistaken for a
provider-verified one. The production root was not written.

---

## 5. Decision table and BLOCKED list

### 5.1 Decision table

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **O1 — Operator-entered `operator_state`** (default; executed in §4) | **0** (already implemented; 52/52 tests, `verify_readonly` PASS) | **Immediate** — today's reading diffs today | Operator opens their own dashboard and types 4 figures once a day (R4) | Append one record for today's local `day_key` to `<data root>/state/operator-state.json`; `records[]` is currently `[]`, so today's run yields `MONITOR_DEGRADED` until then |
| **O2 — HG.Cash `GET /accounts`** | 2 h research (done) + **4–8 h build/test** (new W3/W4 op + credential plumbing) | Days **if** the entity holds an entitled account | Operator confirms account identity; operator creates + scopes a token; allowlist edit (§3.2); earnings field unresolved | Operator answers: "does this entity hold an HG.Cash account, and which `id`?" — nothing can be built before that |
| **O3 — Cashfree Payouts** | — | — | — | **DISQUALIFIED**: token mint is `POST /payout/v1/authorize`; no account status documented; AppId/SecretKey can Self-Withdraw |
| **O4 — FreeCash.io / freecash.com** | — | — | — | **DISQUALIFIED**: ToS §17.2 forbids automated *and manual* monitoring without written consent; no provider-published API |
| **O5 — Local metrics substitute (W1/W2)** | 0 (implemented) | Never — reports AgenticOS health, not an account figure | Local service on `:3001` | `--source metrics_http` (still `degraded: true`) |

### 5.2 BLOCKED — what no agent can decide without the operator

- **Account identity.** Which entity/provider actually holds the monitored balance, and — if HG.Cash — which account `id`. No repo artifact, config, key or public source maps `proj-free-cash`'s balance to any candidate. `BLOCKED` (O2).
- **Credential handling.** Whether a provider token may exist at all; where it is created, stored and scoped; whether an unscoped HG.Cash bearer token (which also authorises `POST /transactions`) is acceptable under R1; whether the Cashfree AppId/SecretKey (which can Self-Withdraw) may be used. This pass read, used and stored **no** credential. `BLOCKED` (O2/O3).
- **Provider choice.** The signed decision: O1 (immediate, degraded) vs O2 (conditional, credit-scoped) vs nothing else. `PROVIDER_ENDPOINT_UNKNOWN` stays verbatim and greppable until this is answered in writing. `BLOCKED`.
- **Earnings semantics.** Whether HG.Cash `balance`/`netBalance` is a legitimate `earnings_total_cents` for this monitor, and whether `pendingFees` may stand in for `pending_cents`. Both are operator definitions, not documented facts. `BLOCKED` (O2).
- **Terms/consent.** Whether any automated read of the platform is authorised, given freecash.com §17.2's written-consent requirement. `BLOCKED` (O4).
- **Whether a real Windows toast may fire.** §4 used the offline stub (`STUB_OK`); enabling the live channel is an operator decision. `BLOCKED`.

### 5.3 VERIFIED vs UNVERIFIED (this pass)

| # | Claim | Class |
|---|---|---|
| V1 | `ALLOWED_METHODS`/`ALLOWED_HOSTS`/`ALLOWED_PATHS`/`PROVIDER_ENDPOINT_UNKNOWN` and the snapshot/record schemas are as quoted in §1 | **EXECUTED** (`evidence-01-source-quotes.txt`) |
| V2 | FreeCash ToS §16.1/§17.2 wording quoted in §2.1 | **PUBLIC DOC** (<https://freecash.com/en/policies/terms>) |
| V3 | HG.Cash `GET /accounts` returns balance + status enum, per §2.2 | **PUBLIC DOC** (<https://docs.hg.cash/api-reference/accounts/get-user-accounts>, <https://docs.hg.cash/api-reference/openapi.yaml>) |
| V4 | Cashfree `getBalance` schema and `POST /authorize` token mint, per §2.3 | **PUBLIC DOC** (<https://www.cashfree.com/docs/api-reference/payouts/v1/get-balance>, …/v1/authorize, …/v1/end-points) |
| V5 | Operator fallback: day-1 `INITIAL_BASELINE`, day-2 `EARNINGS_CHANGED` + 1 notification + 1 approval, day-2 re-run `SKIP_DUPLICATE_DAY`, prod root untouched | **EXECUTED** (`run-output-operator-fallback.txt`) |
| V6 | 52/52 tests pass; `verify_readonly` `forbidden=0 … PASS` | **EXECUTED** |
| V7 | What `freecash.io` serves today | **UNVERIFIED** — fetch failed; not guessed |
| V8 | Whether the entity holds an HG.Cash/Cashfree account; identity; credentials | **UNVERIFIED / BLOCKED** — operator-only |
| V9 | HG.Cash/Cashfree endpoint *liveness* (a real 200/401/403 from the host) | **UNVERIFIED** — no provider contact permitted this pass; docs are the only evidence |

# S4 — READ-ONLY ENFORCEMENT AUDIT + OBSERVE-ONLY BRIDGE PROPOSAL

Stream: `DELEGATION-2026-10-01-R4/source/`
Date: 2026-10-01 (Europe/Berlin, UTC+02:00)
Target: `D:\AgenticOS\monitoring\freecash\readonly_client.py` (8,847 bytes, sha256
`5426b56c11d20fbe65aa197a4f11660536e6371d585c31f827914d2930aecc27`)
Interpreter: `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (3.11.9, tzdata OK)

Everything below is a pasted result of a command that actually ran. Raw output is in
`raw/` and every claim cites the raw file it came from.

---

## 0. RULE NUMBERING — PRINTED WITH TITLES, AS REQUIRED

The shipped file's header and every exception message say **`R2`**. In the OPERATOR
numbering used by the delegation brief, that code path is:

> **R1 (NO EARNING ACTION)** — the routine never performs an earning/withdraw/claim transaction.

The shipped `readonly_client.py:1` label `R2: the routine's ONLY network path` is the
inverted docstring the brief warns about (`gate.py:1` carries the mirror-image
inversion). **Every finding below is attached to its TITLE.** Where a raw log shows a
literal `R2:` prefix, that is the shipped string being quoted verbatim, not operator-R2.

| Operator # | Title | This stream's verdict |
|---|---|---|
| **R1** | **NO EARNING ACTION** | **ENFORCED IN CODE** — see §3; one layer is defective (§4) |
| R2 | ONCE PER DAY | not this stream's scope (see S1/workflow) |
| R3 | NOTIFY ON CHANGE | not this stream's scope, but has **never had an input** (§7) |
| R4 | APPROVAL BEFORE EXTERNAL ACTION | not this stream's scope; nothing was installed here |

---

## 1. THE ALLOWLISTS, ENUMERATED VERBATIM

Read from the live module objects (raw: `raw/02-enforcement-probe.txt`, "SECTION 1")
after loading the byte-identical copy at `probe/readonly_client.py`. Line numbers are
in the shipped file.

### 1.1 Methods — `readonly_client.py:39`
```python
ALLOWED_METHODS = frozenset({"GET", "HEAD"})
```
Live value: `['GET', 'HEAD']`. **Two verbs. Nothing else. No body-carrying verb exists.**

### 1.2 Hosts — `readonly_client.py:41`
```python
ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
```
Live value: `['127.0.0.1', '::1', '[::1]', 'localhost']`.
**Every entry is loopback. There is no provider host, no `*.freecash.com`, no wildcard,
no suffix match, no CIDR range.** The comparison at `:132-134` is exact-string
(`host = (parts.hostname or "").lower()` then `if host not in ALLOWED_HOSTS`), so there
is no bypass by case, by trailing dot, by userinfo (`user@host`), or by any lookalike.
`127.0.0.2` is refused — it is loopback range but not in the set (proved in §3, V2c).

### 1.3 Paths — `readonly_client.py:43-49`
```python
ALLOWED_PATHS = (
    re.compile(r"^/api/v1/status/metrics$"),
    re.compile(r"^/api/v1/status$"),
    # Provider paths are added here ONLY after research resolves them, one line
    # each, with a justification comment.  Nothing provider-facing is allowlisted
    # today -- see PROVIDER_ENDPOINT_UNKNOWN below.
)
```
Live value:
```
ALLOWED_PATHS = [
    re.compile('^/api/v1/status/metrics$'),
    re.compile('^/api/v1/status$'),
]
```
Both patterns are **anchored at both ends** (`^…$`) and matched with
`pattern.match(path)` at `:136`. No prefix, no `.*`, no alternation to a provider path.
`provider-facing path allowlisted? False` (raw log, SECTION 1).

### 1.4 Body keywords — `readonly_client.py:52`
```python
BODY_KEYWORDS = ("data", "json", "files", "body", "content")
```
Any of these keywords, on any method, is refused (`:120-122`). Any *other* unknown
keyword is refused too (`:123-126`) — the request surface is closed, not just filtered.

### 1.5 The deliberately-unknown provider contract — `readonly_client.py:23-27, 60`
The module docstring lists the four intended read operations and marks W3/W4 as
`UNKNOWN`; the placeholder literal is kept greppable:
```python
PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"
```
Comment at `:47-48`, verbatim: *"Nothing provider-facing is allowlisted today."*

---

## 2. WHAT IS REACHABLE TODAY

**Classification: the routine can reach a loopback HTTP server and nothing else.**

| Reachable? | Target | Evidence |
|---|---|---|
| YES | `GET /api/v1/status/metrics` on `localhost`/`127.0.0.1`/`::1` | §5 positive control |
| YES | `HEAD /api/v1/status` on the same hosts | §5 positive control |
| NO | any provider host (e.g. `api.freecash.com`) | §3 V2 |
| NO | any non-loopback host, by name or by IP | §3 V2b/V2c |
| NO | any non-read verb (POST/PUT/PATCH/DELETE/…) | §3 V1/V1b |
| NO | a request body on an otherwise-legal GET | §3 V3/V3b/V3c |
| NO | any path other than the two above | §3 V4, V5 |

Consequence: **the routine cannot observe a real account today, even if credentials
existed** — there is no provider host in the host allowlist and no provider path in the
path allowlist, so no outbound provider request can be *formed*, let alone sent. The
only two wired data sources are `operator_state` (a human-entered JSON file, `records: []`)
and `metrics_http` (a loopback metrics substitute). This matches §1.5 of the brief.

---

## 3. EMPIRICAL ENFORCEMENT — EVERY ATTEMPTED VIOLATION, EXACT ERROR

Raw: `raw/02-enforcement-probe.txt`, "SECTION 2". Each attempt passed an in-process
**spy transport**; the spy recorded **`[]`** for all of them, proving the refusal lands
before `_transport` (the single socket site, `:76`) is reached — i.e. **before any
connection could exist**. The non-allowlisted-host attempts use a public provider
hostname with a spy transport, so no DNS lookup and no socket are ever performed; the
refusal is the allowlist check at `:132-134`.

Every refusal raises the **exact same type**: `readonly_client.ForbiddenWriteError`
(subclass of `RuntimeError`, defined `:65-66`).

| # | Attempt (verbatim call) | Exact exception type | Exact message |
|---|---|---|---|
| V1 | `request("POST", "http://127.0.0.1:3001/api/v1/status/metrics", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: method 'POST' is not read-only (allowed: GET, HEAD)` |
| V1b | `request("DELETE", "http://127.0.0.1:3001/api/v1/status/metrics", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: method 'DELETE' is not read-only (allowed: GET, HEAD)` |
| V2 | `request("GET", "https://api.freecash.com/api/v1/status/metrics", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: host not allowlisted: 'api.freecash.com'` |
| V2b | `request("GET", "http://provider.invalid/api/v1/status/metrics", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: host not allowlisted: 'provider.invalid'` |
| V2c | `request("GET", "http://127.0.0.2:3001/api/v1/status/metrics", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: host not allowlisted: '127.0.0.2'` |
| V3 | `request("GET", METRICS_URL, json={"x": 1}, transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: request bodies are forbidden ('json')` |
| V3b | `request("GET", METRICS_URL, data=b"x", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: request bodies are forbidden ('data')` |
| V3c | `request("GET", METRICS_URL, stream=b"x", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: unsupported request keyword(s): stream` |
| V4 | `request("GET", "http://127.0.0.1:3001/api/v1/status/claim", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: path not allowlisted: '/api/v1/status/claim'` |
| V5 | `request("GET", "file:///etc/passwd", transport=spy)` | `readonly_client.ForbiddenWriteError` | `R2: scheme not allowed: 'file'` |

The `R2:` prefix above is the shipped literal — under the operator numbering this is
**R1 (NO EARNING ACTION)** enforcement firing.

**Positive control (`raw/02-enforcement-probe.txt`, SECTION 5).** The guard must permit,
not only refuse. A throwaway `127.0.0.1` server (mirroring `tests/_support.py:StubSource`)
was stood up; against it:
```
GET  /api/v1/status/metrics -> status=200 body={"account_status": "ACTIVE", "earnings_total_cents": 1025, "balance_cents": 1025, "pending_cents": 0, "currency": "USD"}
     parsed earnings_total_cents=1025 currency='USD'
HEAD /api/v1/status -> status=200
SERVER RECORDED VERBS: [('GET', '/api/v1/status/metrics'), ('HEAD', '/api/v1/status')]
```
So the guard is shown to **permit an allowlisted loopback read and refuse everything
else**, in one run.

---

## 4. OPEN DEFECT — LAYER B's `getaddrinfo` BRANCH IS DEAD CODE

`readonly_client.py:146-163` documents itself (`:147`) as aborting
*"a connect/getaddrinfo aimed anywhere but the loopback allowlist"*. It does not.
The argument-shape extractor at `:154-159` only accepts a **tuple**:
```python
if isinstance(first, tuple):
    address = first
elif len(args) > 1 and isinstance(args[1], tuple):
    address = args[1]
else:
    address = None
```
`socket.connect` fires with `(socket_obj, address_tuple)` → `args[1]` is a tuple → handled.
`socket.getaddrinfo` fires with `(host_str, port, family, type, protocol)` → `args[0]` is a
**str** and `args[1]` is an **int** → falls to `address = None` → **the hook returns without
aborting.** Direct invocation with the CPython-documented shapes (raw, SECTION 3):
```
connect(('provider.invalid',443)) [connect shape]   RAISED ForbiddenWriteError: R2: connect to non-allowlisted host: 'provider.invalid'
connect(('127.0.0.1',3001))       [connect shape]   NO RAISE (hook ignored the event)
getaddrinfo(('provider.invalid',443,0,1,0))         NO RAISE (hook ignored the event)
getaddrinfo(('93.184.216.34',80,0,1,0))             NO RAISE (hook ignored the event)
getaddrinfo(('127.0.0.1',3001,0,1,0))               NO RAISE (hook ignored the event)
```
Confirmed live, loopback only, no external host contacted (raw, SECTION 4):
```
LIVE getaddrinfo('127.0.0.2', 9) -> RETURNED 1 addr(s); hook did NOT abort
LIVE connect(('127.0.0.2', 9))   -> RAISED ForbiddenWriteError: R2: connect to non-allowlisted host: '127.0.0.2'
```

**Impact is contained, and this is stated plainly rather than as a footnote.** Layer A
(`request`, `:110-140`) refuses every non-loopback host before `_transport`, and
`_transport` is the only place a socket is opened — so today no reachable path
reaches `getaddrinfo` with a non-loopback name. Layer B is therefore **a redundant
backstop whose host-name branch is silently inert**; it is not load-bearing for R1
**(NO EARNING ACTION)** today. It becomes load-bearing the moment any future code
(including a bridge) calls a socket library directly instead of through `request()`.

**This defect survives a fully green test suite.** The shipped guard tests, run from a
copy in this stream dir with a throwaway data root (`raw/05-shipped-guard-tests.txt`):
```
Ran 8 tests in 0.527s
OK
EXIT=0
```
`test_audit_guard_refuses_a_non_loopback_connect` (`tests/test_r2_readonly.py:197-202`)
exercises only the `socket.connect` shape; **no test asserts the `getaddrinfo` shape.**
A green R1 test suite is not evidence that R1's layer B works.

---

## 5. ACCEPTANCE BAR — RED / GREEN (same file, both lines)

Raw: `raw/03-acceptance-bar.txt`. Two verifiers were built in this stream dir:
`probe/gate_allowlists.py` (allowlist integrity) and `probe/check_audit_hook.py`
(layer-B coverage). Both name the rule TITLE.

**Verifier 1 — `gate_allowlists.py`, RED on a planted violation** (a copy with
`api.freecash.com` added to `ALLOWED_HOSTS` and `^/api/v1/withdraw$` added to
`ALLOWED_PATHS`, at `probe/mutants/allowlist_widened.py`):
```
RED   : gate_allowlists.py exits 1 on ALLOWLIST WIDENED (provider host + earning path)
  VIOLATION [R1 (NO EARNING ACTION) -- the routine performs no write/earning action] non-loopback host allowlisted: 'api.freecash.com'
  VIOLATION [R1 (NO EARNING ACTION) -- the routine performs no write/earning action] unexpected path regex allowlisted: '^/api/v1/withdraw$'
[gate] FAIL: 5 violation(s) against R1 (NO EARNING ACTION) -- the routine performs no write/earning action
EXIT=1
GREEN : gate_allowlists.py exits 0 on the UNMODIFIED shipped module
[gate] PASS: allowlists are exactly the loopback-only read allowlists for R1 (NO EARNING ACTION) -- the routine performs no write/earning action
EXIT=0
```
**Verifier 2 — `check_audit_hook.py`, RED on the shipped module** (the real defect from
§4, not a planted one) and **GREEN on a repaired copy** (proving the detector can pass,
i.e. it is not a tautology):
```
RED   : check_audit_hook.py exits 1 on the shipped module
  DEFECT [R1 (NO EARNING ACTION) -- the routine performs no write/earning action] socket.getaddrinfo for non-loopback host is NOT aborted (args[0] is a str; the hook only accepts a tuple)
[hook] FAIL: 1 layer-B defect(s)
EXIT=1
GREEN : check_audit_hook.py exits 0 on the REPAIRED copy (probe/repaired/readonly_client_hook_fixed.py)
[hook] PASS: both documented connect/getaddrinfo shapes are aborted
EXIT=0
```
Both certified artifacts parse:
```
py_compile exit=0 (all artifacts parse)
```
No mutant survives undetected in either verifier's scope. The one surviving defect (§4)
is reported as an **OPEN DEFECT** with its own failing detector, not buried.

---

## 6. THE MINIMAL OBSERVE-ONLY BRIDGE — DESIGNED, **NOT INSTALLED**

Nothing was installed. `readonly_client.py`, every other module under
`monitoring/freecash/**`, and the production data root are unchanged (§8). This section
is a proposal plus an end-to-end proof against a throwaway stand-in.

### 6.1 The insight that makes it minimal
`readonly_client.py` already allows **`GET /api/v1/status/metrics` on loopback**, and
`run_daily_check.py:66-76` already knows how to read it when
`FREECASH_READ_SOURCE=metrics_http`. So a bridge does **not** require touching a single
allowlist entry: it is a local process that **serves** the figures on the path the
routine already trusts. **`gate_allowlists.py` stays GREEN with zero edits.**

### 6.2 Shape
```
 operator's own authenticated browser session          the routine (unchanged)
   (human logged in; the ONLY holder of credentials)
              |                                                  |
              |  push 4 figures (one loopback GET, token-gated)   |  GET /api/v1/status/metrics
              v                                                  v
   +-----------------------------------------------------------------------+
   |  freecash read-bridge  (exactly one process)                          |
   |   - binds 127.0.0.1 ONLY (never 0.0.0.0)                              |
   |   - GET /api/v1/status/metrics  -> latest figures (allowlisted)       |
   |   - HEAD /api/v1/status         -> 200 health (allowlisted)           |
   |   - GET /ingest?token=..&status=..&earnings=..&balance=..&pending=..  |
   |        -> updates an IN-MEMORY figure record; no credential ever held |
   |   - no provider credential, no provider host, no outbound socket      |
   +-----------------------------------------------------------------------+
```
Data ingress is a plain loopback **GET** (a browser bookmarklet or extension can issue
it from inside the operator's logged-in page); the bridge never has provider
credentials, so the only thing that can read the provider is the human's own session.

**The operator's authenticated session demonstrably exists** (verified read-only this
pass, `raw/07-operator-session-evidence.txt`; no cookie values are present in the file,
only booleans and counts):
```
path exists: True
top-level keys: ['authenticated', 'detail', 'evidencePath', 'service', 'verifiedAt']
  service        = freecash
  authenticated  = True
  verifiedAt     = 2026-09-23T15:32:31.406Z
  detail         = final_url=https://freecash.com/en; cookie_count=8; session_cookie_present=true
```
So the human half of the bridge already exists (an authenticated browser session was
captured on 2026-09-23). What is missing is only the loopback hand-off that turns that
session's observation into a machine-readable figure — which is exactly the bridge.

### 6.3 End-to-end proof of the shape (raw: `raw/06-bridge-proof.txt`)
A throwaway `127.0.0.1` server served the two allowlisted paths; the entry point was run
**from the copy in this stream dir** against a throwaway data root:
```
entry point stdout : RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=agenticos_local_metrics(data_available=True) snapshot=2026-10-01.json written=True ...
VERBS THE BRIDGE SAW : [('GET', '/api/v1/status/metrics'), ('HEAD', '/api/v1/status')]
WRITE VERBS THE BRIDGE SAW: [] -> NONE (zero write capability exercised)
```
The resulting snapshot carried a **real, non-null figure**:
```json
{ "degraded": true, "account_status": "ACTIVE", "earnings_total_cents": 1340,
  "balance_cents": 1340, "pending_cents": 0, "currency": "USD",
  "raw_response_sha256": "35413960b25e8d5a72f982946ec29fef90d63ef33ce64ab5a49de9d734dfa90e" }
```
That digest is verifiably the sha256 of the served body (recomputed; `MATCH: True`), so
the routine's integrity field is exercised on real bytes for the first time.

### 6.4 Honest limits of the bridge
- It does **not** create a provider read path. The figure still originates from a human
  looking at their own dashboard; the bridge only removes the manual transcription step
  and gives the routine something to hash, compare and alert on.
- **`degraded` stays `true`.** `changedetect.py:168` hardcodes `"degraded": True`, with
  the comment *"Every source available today is a substitute for the provider read"*
  (also hardcoded at `run_daily_check.py:98`). So a bridge-read snapshot carries real
  figures **and still says degraded** — a code change in `changedetect.py` plus a
  provider path in the allowlist is required to lift that label, and neither is in
  scope here or installed.

### 6.5 Threat model and what a compromised bridge could still do
**Trust boundary.** The operator's browser session holds the credentials; the bridge
does not, and the routine never touches them. The bridge is the only new component and
it is loopback-only.

| Threat | Mitigation in the design |
|---|---|
| Remote attacker reaches the bridge | Bind `127.0.0.1` only; the OS never exposes it off-host. |
| A random web page in the operator's browser drives `/ingest` | Token-gate `/ingest`; reject any `Origin` other than the provider's; require the token as a header so a cross-origin `GET` cannot set it. |
| Caller forges figures to trigger false alerts | Values are bounded/sanity-checked and the ingest token is per-run; treat every bridge-sourced figure as `degraded` (which the routine already does) so it can never be mistaken for provider-verified. |
| Local process reads the current figures | Accepted residual risk: it is local data. Scratchpad only; no credential is exposed. |
| Oversized body / DoS on the routine | `readonly_client` timeout (`DEFAULT_TIMEOUT = 10.0`, `:57`) bounds the read. |

**What a fully compromised bridge could still do:** it can **lie** (feed false figures,
producing false R3 NOTIFY-ON-CHANGE alerts), it can **observe** the routine's polling
cadence, and any local process can **read** the current figures.
**What it still could not do:** perform an earning action. It holds no provider
credential, opens no outbound socket, and the routine it feeds retains a GET/HEAD-only,
loopback-only, two-path allowlist — so the write verb and the provider host both remain
unreachable. **The damage ceiling of a compromised bridge is data integrity, not
earning capability.** That is the property that makes this design safe to propose.

---

## 7. THE LARGEST REMAINING GAP, STATED HONESTLY

> **Read-only enforcement is REAL. Monitoring is NOT.**

The enforcement audited above is genuine and survived every violation attempt. It is
also pointed at **nothing provider-facing**, so the routine has never observed a real
account. Measured this pass (`raw/04-production-state-snapshots.txt`):

- Three snapshots exist — `2026-09-20.json`, `2026-09-30.json`, `2026-10-01.json` — and
  **all three are `degraded: true` with every figure `null`**:
  ```
  degraded = True   source.data_available = False
  account_status = None   earnings_total_cents = None   balance_cents = None
  pending_cents = None    currency = None
  ```
- On all three, `raw_response_sha256 = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  — **byte-identical to `sha256("")`**, verified by `printf '' | sha256sum`. The routine
  has hashed an empty body three times. Zero real readings have ever been taken.
- `state/operator-state.json` has `records: []` — the one wired human source has never
  been filled in, so **R3 (NOTIFY ON CHANGE) has never had an input** and has never
  fired a genuine change notification. `alerts.jsonl` is 15 rows and all degraded/missed/
  duplicate noise: `{'MONITOR_DEGRADED': 3, 'SKIP_DUPLICATE_DAY': 2, 'MISSED_DAY': 10}`.

So the two halves of the claim must be stated separately: **the routine provably cannot
take an earning action** (R1 NO EARNING ACTION, enforced), **and the routine provably has
never observed anything** (no provider path, no source record). The bridge in §6 closes
the *transcription* half of that gap and was proven to carry a real figure over loopback
with zero write capability — but it does **not** make a reading provider-verified, and
`degraded` stays `true` until `changedetect.py` is changed and a provider path is
allowlisted, neither of which this stream did.

**Largest single gap:** there is no path — in code or in data — by which a real
provider figure can enter the routine. Not a missing credential and not a scheduling
gap: a **missing reading**, by construction, in both the allowlist and the only
non-empty-free source.

---

## 8. ISOLATION PROOF

Every execution pinned `FREECASH_DATA_ROOT`, `AGENT_TEAMS_DB_PATH` and
`AGENTICOS_DATA_DIR` to throwaway paths. Nothing under `monitoring/freecash/**`,
`scripts/monitoring/**`, `data/freecash-monitor/**`, `config/**` or `finance-monitor/**`
was written, moved, deleted, chmod'd or touched. The module was **copied** into this
stream dir before any instrumentation.

`raw/01-isolation-before.txt`:
```
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl
```
`raw/99-isolation-after.txt` — **byte-identical** (both digests match the brief's baseline).

`git status --porcelain` for the routine sources is `?? monitoring/` and
`?? scripts/monitoring/` — untracked, so no reviewable diff was ever in play, and none
was created.

---

## 9. WHAT THIS STREAM COULD **NOT** ESTABLISH

- **It could not observe a real Free Cash account** — there is no allowlisted provider
  path and no live provider read source. Every figure used here is a stand-in.
- **It did not install the bridge, and did not change any allowlist.** §6 is a design
  proven against a throwaway stand-in, not a deployed component.
- **It did not lift `degraded: true`** — that requires edits to `changedetect.py`
  (out of scope, and the file is untracked so an in-place edit would leave no diff).
- **It did not run the full 52-test suite in place** — doing so would write `__pycache__`
  under `monitoring/freecash/tests/**`, violating the isolation contract. The shipped
  `TransportGuardTests` were run from a copy instead (8/8 OK, `raw/05-shipped-guard-tests.txt`).
- **It did not send a single packet to a non-loopback host.** Non-loopback refusals were
  demonstrated with a spy transport (transport never reached) and with loopback addresses
  `127.0.0.2`; a public hostname appears only as a string handed to the allowlist check.
- **Layer B's inertness was shown for the documented `getaddrinfo` shape, not for every
  possible CPython audit-event variant.**

---

## RAW EVIDENCE INDEX

| File | Contents |
|---|---|
| `raw/01-isolation-before.txt` | sha256 of `last-run.json` + `alerts.jsonl` before any run |
| `raw/02-enforcement-probe.txt` | allowlist enumeration; V1–V5 exact exceptions; layer-B shapes; loopback live tests; positive control |
| `raw/03-acceptance-bar.txt` | RED/GREEN for `gate_allowlists.py` and `check_audit_hook.py`; py_compile |
| `raw/04-production-state-snapshots.txt` | empty-string sha; three snapshot sha256s; verbatim snapshot/ledger/operator-state; alert counts; `find -newermt`; git status |
| `raw/05-shipped-guard-tests.txt` | shipped `TransportGuardTests` 8/8 OK from a copy |
| `raw/06-bridge-proof.txt` | bridge shape end-to-end: real figure, GET/HEAD only, degraded still true |
| `raw/07-operator-session-evidence.txt` | the operator's authenticated browser session exists (no secrets) |
| `raw/99-isolation-after.txt` | the SAME sha256 command as `01-` (byte-identical digests) |
| `raw/README-THIS-RUN-IS-S4.txt` | provenance manifest: sha256 of every file this run authored |

> **Provenance warning for the parent.** This `source/` directory is **shared**: the
> parent session and a sibling stream ("R4 Stream S") wrote into it during the same
> window (`raw/00-parent-pass-2026-10-01-1142.txt`, `e2e_r3_two_day.py`, and several
> `raw/*` files this run did not author). Their numbering overlaps this run's. The
> authoritative list of what THIS run produced, with per-file sha256, is
> `raw/README-THIS-RUN-IS-S4.txt`. Nothing authored by any other writer was modified
> or deleted here.

Stream code (all under this stream dir; none of it installed anywhere):
`probe/probe_guard.py`, `probe/gate_allowlists.py`, `probe/check_audit_hook.py`,
`probe/build_variants.py`, `probe/bridge_proof.py`, `probe/readonly_client.py` (byte-identical copy),
`probe/routine_copy/` (copy), `probe/mutants/allowlist_widened.py`, `probe/repaired/readonly_client_hook_fixed.py`.

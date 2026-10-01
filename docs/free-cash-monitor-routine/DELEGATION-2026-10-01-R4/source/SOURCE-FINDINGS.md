# SOURCE-FINDINGS.md — R4 Stream S (source & first reading)

**Delegation:** DELEGATION-2026-10-01-R4 · **Stream:** S · **Written:** 2026-10-01, 11:40–11:49 local (Europe/Berlin, UTC+02:00)
**Repo:** `D:\AgenticOS` · branch `hermes-rescue-20260908` · HEAD `8f7463a` · host Windows 11 de-DE, git-bash/MSYS, non-elevated
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` → `Python 3.11.9` (verified this pass, `raw/29-timing.txt`)
**Rules under test (operator numbering, title carried):** R3 = *notify me when earnings or account status changes*. (Rule titles are always carried with the numbers: this delegation's R1 = "no earning action automatically", R2 = "check status once per day". The shipped `gate.py:1` / `readonly_client.py:1` docstrings label the day-lock as **R1** and the read-only guard as **R2** — the inverted numbering. See brief §1.)

**Evidence class per claim:** `[A]` = measured in this pass (command + exit + raw capture beside this file), `[B]` = read from source (`file:line`), `[C]` = inherited, **not** re-verified.
**Nothing here is self-applying. No allowlist was widened. No credential was read. No non-loopback socket was opened.**

---

## 0. Bottom line (both deliverables)

| # | Result |
|---|---|
| 1 | **The wire source R3 ranked at RANK 2 is now DEAD.** Yesterday's (R3, 09:28) live node server on `127.0.0.1:4600` — which answered `/api/health` **200** and `/api/projects/:id/freecash/auth` **200** — is **gone** in this pass (11:42). Every probe to `:4600` now returns **curl exit 7 / HTTP 000 (connection refused)**, IPv4, IPv6 and `localhost` alike. Nothing listens on `:4600` or `:3001`. The **only** reachable source that yields the four compared figures remains the **operator-entered file**, exactly as in R3. |
| 2 | **R3 (notify-on-change) is proven end-to-end, offline, for a human — for the first time.** Day-1 operator record → `RUN_OK … outcome=INITIAL_BASELINE … notifications=0`. Day-2 record with a changed figure → **exactly one** `EARNINGS_CHANGED` notification (`notifications=1`), delivery label `STUB_OK`, dedupe key `8341abcc…9d5c` persisted in `state/notified-keys.json` **before** dispatch. Replay of the same day → `SKIP_DUPLICATE_DAY` (0 notifications). Replay of the same detected change → `DEDUPED` (0 new toasts, same single key). |

---

## PART 1 — Live source re-measurement (no credential, loopback only)

### 1.1 What changed from R3's `SOURCE-DECISION.md` table — read this, not a restatement

| R3 rank | R3's measured state (09:28) | **This pass (11:42) — measured** | Change |
|---|---|---|---|
| **1** operator-entered file (`state/operator-state.json`, `--source operator_state`) | reachable, yields all 4 figures; `records: []` | reachable, yields all 4 figures; production `records = 0` | **NO CHANGE** — still the only source that can feed the comparison. |
| **2** `GET /api/projects/:id/freecash/auth` on `http://localhost:4600` | **HTTP 200**, no credential, session-state only | **HTTP 000 / curl exit 7 — connection refused.** The route cannot be reached at all; nothing listens on `:4600`. | **⚠ CHANGED — RANK 2 IS UNREACHABLE TODAY.** Route existence cannot be re-confirmed this pass (server absent); R3's 200 is now `[C]` for this stream. |
| **3** offline `%APPDATA%\AgenticOS\data\freecash\session-evidence.json` | present, `authenticated:true`, stale 7.67 d | **present**, `authenticated:true`, `verifiedAt 2026-09-23T15:32:31.406Z` → **age ≈ 8.0 d** | substance unchanged; staleness grew. Not four figures. |
| **4** `metrics_http` (`GET /api/v1/status/metrics`, `HEAD /api/v1/status`) | **DEAD**: HTTP **404** on `:4600`, conn-refused on `:3001` | **DEAD**: `WinError 10061` (connection refused) on **both** `:4600` and `:3001` — one failure mode narrower (the 404 is no longer observable because the server is gone) | **Changed failure mode; still DEAD.** |
| **5** `GET /api/health` on `:4600` (liveness only, not allowlisted) | **HTTP 200** | **HTTP 000 / curl exit 7 — refused** | **⚠ CHANGED — the live server itself is down.** |

**One-line delta:** R3's RANK 2 (and RANK 5) depended on a **transiently running** node server on `:4600`. That process is gone. The wire landscape has collapsed to the single dead path, and the human-entered file is the sole survivor — unchanged in rank, unchanged in capability.

### 1.2 Ranked table (this pass)

| Rank | Candidate source | Reachable today, no credential? | Yields the 4 compared figures? | Verdict |
|---|---|---|---|---|
| **1** | **Operator-entered file** `state/operator-state.json` (source `operator_state`, DEFAULT) | **YES** — local file read, no socket `[A]` | **YES** — all four `[A]` | **RANK 1 — the only source that can feed the monitor today.** |
| **2** | `GET /api/projects/:id/freecash/auth` on `:4600` | **NO today** — conn refused `[A]` (was 200 in R3 `[A]`) | NO (auth/session state only) | **UNREACHABLE today.** |
| **3** | `session-evidence.json` (offline mirror) | YES — local file `[A]`, ~8.0 d stale | NO (boolean + timestamp) | offline auth mirror; not a monitor source |
| **4** | `metrics_http` (`/api/v1/status/metrics` / `/api/v1/status`) | **NO** — `WinError 10061` both bases `[A]` | NO | **DEAD today** |
| **5** | `GET /api/health` on `:4600` | **NO** — conn refused `[A]` | NO | not a source; today not even a liveness signal |

### 1.3 Raw output — `raw/01-live-http-probes.txt` (curl, exit codes inline)

```
=== date ===
Do,  1. Okt 2026 11:42:05

=== curl -m5 GET http://localhost:4600/api/health ===
curl: (7) Failed to connect to localhost:4600 after 2255 ms: Could not connect to server
HTTP 000
curl_exit=7

=== curl -m5 GET http://localhost:4600/api/v1/status/metrics (expect 404) ===
curl: (7) Failed to connect to localhost:4600 after 2238 ms: Could not connect to server
HTTP 000
curl_exit=7

=== curl -m5 GET http://localhost:4600/api/v1/status (HEAD-path sibling) ===
curl: (7) Failed to connect to localhost:4600 after 2235 ms: Could not connect to server
HTTP 000
curl_exit=7

=== curl -m5 GET http://localhost:3001/api/v1/status/metrics (default base, expect refused) ===
curl: (7) Failed to connect to localhost:3001 after 2252 ms: Could not connect to server
HTTP 000
curl_exit=7

=== curl -m5 GET http://localhost:3001/api/health (default base) ===
curl: (7) Failed to connect to localhost:3001 after 2251 ms: Could not connect to server
HTTP 000
curl_exit=7

=== curl -m5 GET http://localhost:4600/api/projects/proj-free-cash/freecash/auth ===
curl: (7) Failed to connect to localhost:4600 after 2251 ms: Could not connect to server
HTTP 000
curl_exit=7
```

`raw/02-listeners-and-procs-rerun.txt` — the IPv4/IPv6 forms and the listener check:

```
=== curl -m5 GET http://127.0.0.1:4600/api/health (IPv4 form) ===
curl: (7) Failed to connect to 127.0.0.1:4600 after 2023 ms: Could not connect to server      HTTP 000   curl_exit=7
=== curl -m5 GET http://[::1]:4600/api/health (IPv6 form) ===
curl: (7) Failed to connect to ::1:4600 after 2041 ms: Could not connect to server           HTTP 000   curl_exit=7
=== curl -m5 GET http://127.0.0.1:4600/api/v1/status/metrics ===
curl: (7) ... HTTP 000   curl_exit=7
=== curl -m5 GET http://127.0.0.1:4600/api/projects/proj-free-cash/freecash/auth ===
curl: (7) ... HTTP 000   curl_exit=7
=== netstat -ano | grep -E '4600|3001' LISTENING ===
(netstat rc=1)   # no match on either port
=== tasklist | grep -iE 'node|electron|AgenticOS' ===
node.exe  1504 10276 14484 15704 11640 8520 2888 3604 12372 35404   # none is PID 32500 (R3's server)
```

### 1.4 The routine's own transport, re-run against the live host

`raw/19-transport-probe-rerun.txt` — R3's `probe_source_candidates.py` re-executed in this pass against the **real** `readonly_client` (`ALLOWED_METHODS={GET,HEAD}`, loopback-only, path allowlist `^/api/v1/status/metrics$|^/api/v1/status$`) `[B, readonly_client.py:39-56]`:

```
READERR| W1 read_metrics base=4600 (allowlisted path, live server)  -> ReadError: GET /api/v1/status/metrics failed: [WinError 10061] ... die Verbindung verweigerte
READERR| W1 read_metrics base=3001 (default base, nothing listening)-> ReadError: GET /api/v1/status/metrics failed: [WinError 10061] ...
READERR| W2 probe_status base=4600                                 -> ReadError: HEAD /api/v1/status failed: [WinError 10061] ...
BLOCK  | GET /api/health on 4600 (NOT allowlisted)                 -> ForbiddenWriteError: R2: path not allowlisted: '/api/health'
BLOCK  | GET /api/projects/proj-free-cash/freecash/auth on 4600     -> ForbiddenWriteError: R2: path not allowlisted: '/api/projects/proj-free-cash/freecash/auth'
ERR    | GET /api/v1/status/metrics on 3001 (allowlisted, refused)  -> ConnectionRefusedError: [WinError 10061] ...
exit=0
```

**Reading:** in R3 the two allowlisted paths failed *differently* (404 = wrong path on a live server; 10061 = wrong port). Today they fail **identically** (`WinError 10061` on both bases) because the `:4600` process no longer exists. R3's finding that the transport "has never had a live endpoint" is unchanged; the *reason* has simplified from a double miss (wrong port + wrong path) to a single miss (no server).

### 1.5 Other sources on the table (RANK 3) — captured

`raw/30-other-sources-and-prod-state.txt`:

```
=== rank-3 source: %APPDATA%\AgenticOS\data\freecash\session-evidence.json ===
-rw-r--r-- 1 cd-pr 197609 329 Sep 23 17:32 ...\Roaming/AgenticOS/data/freecash/session-evidence.json
{ "service": "freecash", "authenticated": true, "verifiedAt": "2026-09-23T15:32:31.406Z",
  "evidencePath": "...\\evidence\\session-authenticated-mue9i5qd-3b0799d2.json",
  "detail": "final_url=https://freecash.com/en; cookie_count=8; session_cookie_present=true" }

=== production day-locks (today's key spent) ===
2026-09-20.lock   0 bytes   2026-09-20 21:08
2026-09-30.lock   0 bytes   2026-09-30 21:01
2026-10-01.lock   0 bytes   2026-10-01 08:53      <- today's production day is CONSUMED

=== production operator-state.json ===
records = 0
how_to = ['Open your own account dashboard in a browser and log in yourself.',
          'Note four figures: account status, total earnings, current balance, pending amount.',
          "Append one record to the records list with today's local date as day_key.",
          'Amounts are integer cents (1340 == 13.40). entered_at_utc is the moment you read them.']
```

`session-evidence.json` carries only booleans/strings (no cookie **values**) `[A]`; the sibling `browser_profiles/freecash-main/storage_state.json` is credential-bearing and **must never be read by the routine** `[C from R3]`.

---

## PART 2 — R3 (notify on earnings/status change) proven end-to-end, offline

**Deliverable:** demonstrate that operator rule **R3** can fire for a human — entirely offline, in a throwaway `FREECASH_DATA_ROOT`, with dedupe shown.

**Driver:** `e2e_r3_two_day.py` (sha256 `920445faccae517d8449d88aae09a734077f40a0d939e32781e3a9b93f18a7a1`). It refuses to run unless `FREECASH_DATA_ROOT` is under `%LOCALAPPDATA%`, and it pins `FREECASH_TOAST_STUB=1` so the dispatch goes through the module's own offline stub sender (delivery label `STUB_OK`, **never** `TOAST_OK` `[B, notify.py:151-164]`). No socket is opened: `--source operator_state` is the default, human-entered, socket-free read path `[B, operator_state.py:12-15,119-151]`.

**Command** (throwaway root `%LOCALAPPDATA%\Temp\fc-r4-source-1084\root`):
```
export FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/fc-r4-source-$$/root"
"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" \
  docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/source/e2e_r3_two_day.py
# exit=0
```
Full transcript: `raw/20-r3-e2e-run.txt`. Preserved throwaway state: `raw/e2e-state/`.

### 2.1 Day 1 — first operator record → baseline, ZERO notifications

```
record written for 2026-10-01 = ACTIVE, earnings 1340, balance 1340, pending 0 USD
RUN_OK 2026-10-01 outcome=INITIAL_BASELINE source=operator_entered(data_available=True)
       snapshot=2026-10-01.json written=True changes=0 notifications=0 approvals=0 reminders=0 lock=2026-10-01.lock
exit = 0
alerts.jsonl lines = 1
notified-keys.json = { "schema_version": 1, "keys": {} }
approval items     = 0
```
**ACCEPTED:** `outcome=INITIAL_BASELINE`, `notifications=0`, no dedupe key created, no approval item. A first reading never produces a fake alarm `[B, changedetect.py:226-241]`.

### 2.2 Day 2 — changed figure → EXACTLY ONE notification

The day-2 record moved earnings **$13.40 → $25.40** (1340 → 2540 cents) with the balance dragged along (1340 → 2540). `compare()` folds a balance movement into the earnings event, so this is **one distinct change**, not two `[B, changedetect.py:250-262]`.

```
record written for 2026-10-02 = ACTIVE, earnings 2540, balance 2540, pending 0 USD
RUN_OK 2026-10-02 outcome=EARNINGS_CHANGED source=operator_entered(data_available=True)
       snapshot=2026-10-02.json written=True changes=1 notifications=1 approvals=1 reminders=0 lock=2026-10-02.lock
exit = 0
EARNINGS_CHANGED alert lines = 1
toast-stub.log lines         = 1
```
**ACCEPTED: `changes=1`, `notifications=1`, `approvals=1` — exactly one notification of type `EARNINGS_CHANGED`.**

### 2.3 The actual notification payload

The exact message string handed to the delivery channel (`notify.message_for_change`, template (a) `[B, notify.py:321-369]`):

```
[FreeCash] EARNINGS CHANGE 2026-10-02
Earnings:  $13.40 -> $25.40  (+$12.00)
Balance:   $25.40 (changed too)
Pending:   $0.00
Status:    ACTIVE (unchanged)
Source:    DEGRADED (operator-entered record for 2026-10-02)
Detail:    alerts.jsonl dedupe=8341abccc4ac2b8c
ACTION:    No action taken. Review and approve anything you want done.
Approval:  5fa696de-b648-4bec-81b3-26d23105e259 (PENDING - yours to decide, nothing executes)
```

The offline delivery record (`raw/e2e-state/logs/toast-stub.log`, the stub sender's write `[B, notify.py:151-161]`):

```
[STUB TOAST 2026-10-02T08:00:00Z] [FreeCash] EARNINGS CHANGE 2026-10-02 | Earnings:  $13.40 -> $25.40  (+$12.00) | Balance:   $25.40 (changed too) | Pending:   $0.00 | Status:    ACTIVE (unchanged) | Source:    DEGRADED (operator-entered record for 2026-10-02) | Detail:    alerts.jsonl dedupe=8341abccc4ac2b8c | ACTION:    No action taken. Review and approve anything you want done. | Approval:  5fa696de-b648-4bec-81b3-26d23105e259 (PENDING - yours to decide, nothing executes)
```

Corresponding `alerts/alerts.jsonl` line (the canonical, append-only evidence record; full file preserved beside this document):

```json
{"day_key": "2026-10-02", "dedupe_key": "8341abccc4ac2b8ca19f3571961293f83e2e514e1085541453d3103e58379d5c",
 "event_id": "27c24a75-ed14-42bf-82d5-e71994534ef3", "event_type": "EARNINGS_CHANGED",
 "message": "[FreeCash] EARNINGS CHANGE 2026-10-02\n...", "severity": "notify", "ts_utc": "2026-10-02T08:00:00Z",
 "observed": {"field": "earnings_total_cents", "new_value": 2540, "old_value": 1340, "prior_day_key": "2026-10-01"}}
```

The **delivery label** for this run is `STUB_OK` (offline stub). It is deliberately *not* `TOAST_OK` — a stubbed run can never be mistaken for a real desktop delivery `[B, notify.py:7,46-47,164]`.

### 2.4 The dedupe key — `state/notified-keys.json`

```json
{
  "schema_version": 1,
  "keys": {
    "8341abccc4ac2b8ca19f3571961293f83e2e514e1085541453d3103e58379d5c": {
      "first_notified_at_utc": "2026-10-02T08:00:00Z",
      "delivery": "STUB_OK",
      "updated_at_utc": "2026-10-02T08:00:00Z"
    }
  }
}
```
`key_delivery(key) = STUB_OK`. The key is **content-hash** of the change, computed as `sha256(day_key | change_type | field | old_value | new_value)` `[B, changedetect.py:214-216]`; verified independently:

```
$ printf '%s' '2026-10-02|EARNINGS_CHANGED|earnings_total_cents|1340|2540' | sha256sum
8341abccc4ac2b8ca19f3571961293f83e2e514e1085541453d3103e58379d5c  *-
```
**It is written *before* the dispatch attempt** (the routine calls `record_notified_key(key, QUEUED)` inside `dispatch()` before calling the sender) so a crash can lose a message but can never duplicate one `[B, notify.py:224, 132-145]`.

### 2.5 Dedupe — the repeat does not fire again

**(a) Replay of the same day's command** — hits the R2 day lock first, no read, no comparison, no second notification:

```
SKIP_DUPLICATE_DAY 2026-10-02        exit=0
EARNINGS_CHANGED alert lines = 1 (unchanged)
toast-stub.log lines         = 1 (unchanged)
notified-keys count          = 1 (unchanged)
```

**(b) Replay of the SAME detected change** — exercises the R3 content-hash guard directly (`notify.key_seen` / `dispatch_change` `[B, run_daily_check.py:131-145]`):

```
dispatch_change(...) returned = DEDUPED
expected DEDUPED; keys_before=1 keys_after=1 toast_before=1 toast_after=1
last alerts.jsonl line:
{"event_type": "EARNINGS_CHANGED", "dedupe_key": "8341abcc...9d5c", "severity": "info",
 "observed": {"already_notified": true, "field": "earnings_total_cents", "old_value": 1340, "new_value": 2540}}
```
**ACCEPTED: the replay writes a log-only `info` line marked `already_notified: true` and dispatches nothing — the toast count and the key count are unchanged.** No approval item is enqueued on the deduped path.

**Boundary, stated honestly:** the dedupe key contains the **day key**. The *same* change re-detected on a *later* day is a **new** key and would notify again — by design `[B, changedetect.py:19-25, 214-216]`. Dedupe is exact-equality and same-day-scoped, never a suppression of genuine future movement.

### 2.6 R4 (human approval) exercised for free

Day 2 enqueued one item (`approvals/pending.json`): `status=PENDING`, `execution_state=NOT_EXECUTED`, `execution_allowed_by_this_routine=false`, `expires_at_utc=null`, and a purely descriptive `proposed_action`. **Nothing executes.** `[B, approval_queue.enqueue]` `[A]`.

---

## PART 3 — Minimum daily human procedure

**Four figures, in these units, entered once per day** (source: the shipped `_HOW_TO`, `operator_state.py:68-73` `[A]`, and the `TEMPLATE_RECORD`, `operator_state.py:48-56` `[B]`):

| # | Field | Unit / form | Meaning |
|---|---|---|---|
| 1 | `account_status` | short text, uppercased by the routine (e.g. `ACTIVE`) | the dashboard's account/session state |
| 2 | `earnings_total_cents` | **integer cents** (`1340` = `$13.40`) | total earnings figure |
| 3 | `balance_cents` | **integer cents** | current (available) balance |
| 4 | `pending_cents` | **integer cents** | pending / unsettled amount |
| — | `currency` | ISO code, e.g. `USD` | required for the money comparison to run |

**Where:** append **one** record for today's `Europe/Berlin` `day_key` to the `records` list of
`D:/AgenticOS/data/freecash-monitor/state/operator-state.json` (the path is `<FREECASH_DATA_ROOT>/state/operator-state.json`; the file/template is created automatically by `operator_state.ensure_template()` `[B, operator_state.py:91-97]`). `entered_at_utc` = the moment of reading.

**Steps:**
1. Open your own FreeCash dashboard in a browser and sign in **yourself** (the routine must not and cannot do this — R1).
2. Read the four values above; convert any dollar amount to integer cents.
3. Append one record with `day_key = <today, Europe/Berlin>`.
4. Run once for the day: `python monitoring/freecash/run_daily_check.py --source operator_state` (the default source).
5. Day 1 → `INITIAL_BASELINE` (no notification). From the next day, any exact-integer or status change → exactly one notification + one PENDING approval item.

**Per-day time cost:**
- **Routine invocation itself: ≈ 0.2 s** — measured this pass, `time` on a fresh throwaway root: `real 0m0,218s` (fresh day) / `real 0m0,187s` (duplicate day) `[A, raw/29-timing.txt]`. The mechanical part is negligible.
- **Human part — estimate, labelled as such:** signing in, reading four numbers and appending one JSON record ≈ **1–3 minutes/day** (the research plan's own working figure is "~2 min/day" `[C, RESEARCH-PLAN.md RQ-4]`). This is a *human* estimate, not a measured value; only the 0.2 s machine cost is measured.

**Day-1 timing caveat:** today's **production** day key is already spent — `data/freecash-monitor/state/day-locks/2026-10-01.lock` exists (08:53) `[A]`. R2 forbids a second read today, so the procedure above applies to the **next** local day in production; today can only be audited. (The throwaway-root proof in Part 2 is not affected.)

---

## PART 4 — Can the toast channel deliver when the desktop app is closed?

**Answer: yes — the toast channel is independent of the AgenticOS/Electron desktop app.** `[B]`

`notify._toast_send` shells out to a **standalone PowerShell process** that builds a `System.Windows.Forms.NotifyIcon` balloon tip and shows it for 20 s `[B, notify.py:167-192]`. It imports nothing from the app and calls no app endpoint — so the desktop app being closed is irrelevant to the mechanism. `[A]` capability check this pass (`raw/28-toast-channel-capability.txt`, balloon **not** shown):

```
powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; ... $n=New-Object System.Windows.Forms.NotifyIcon; ..."
NotifyIcon type OK: System.Windows.Forms.NotifyIcon
Icon set OK: System.Drawing.Icon
disposed       exit=0
```

**What it *does* require** `[B]`: (a) an interactive Windows session with a notification area — the stub/`_toast_send` path runs under the logged-in user; a locked, asleep, or session‑0/service context can swallow the balloon, and Windows Focus Assist / notifications-off hides it; (b) `powershell` on `PATH`; (c) something to run the routine (see the trigger stream `T` — nothing is scheduled today, brief §2 A17).

**Failure is safe, not silent-to-the-file:** the dispatch is capped at **2 attempts**; on failure it records `DELIVERY_FAILED` and a `MONITOR_DEGRADED` alert carrying the **full original message**, marks the key `FAILED_TOAST`, and **never retries that key**; the message survives only in `alerts.jsonl`, which the operator must read until the channel is fixed `[B, notify.py:220-261]`.

**Honest limit of this pass:** I did **not** trigger a real balloon (a visible desktop side effect); the delivery proof above is the module's offline **stub** (`STUB_OK`), and the channel *mechanism* is verified only to the extent of loading `NotifyIcon` and disposing it without showing a tip.

---

## PART 5 — Isolation proof (hash, not intention)

Pre-run pins (required) and post-run re-hash, both measured this pass:

| File | Pre-run `[A]` | Post-run `[A]` |
|---|---|---|
| `data/freecash-monitor/state/last-run.json` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` | `a287a902…293bf9` (identical) |
| `data/freecash-monitor/alerts/alerts.jsonl` | `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` | `1b9c7c07…9399a8` (identical) |

`find data/freecash-monitor -type f -newermt "2026-10-01 11:30"` → **0** files (my pass boundary).

**Honest note on the 00:00 sweep:** `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` returns **4** files — but **all four have mtime `2026-10-01 08:53`**, i.e. they predate this pass by ~2 h 50 m and were written by an earlier production run, not by me:
```
2026-10-01 08:53  data/freecash-monitor/alerts/alerts.jsonl
2026-10-01 08:53  data/freecash-monitor/snapshots/2026-10-01.json
2026-10-01 08:53  data/freecash-monitor/state/day-locks/2026-10-01.lock
2026-10-01 08:53  data/freecash-monitor/state/last-run.json
```
The correct hermetic boundary for *this* pass is therefore **11:30**, where the count is **zero** `[A]`.

All routine invocations used throwaway roots under `%LOCALAPPDATA%\Temp\fc-r4-source-*` / `fc-r4-timing-*`. No `monitoring/freecash/**`, `scripts/monitoring/**` or `data/freecash-monitor/**` file was written. No git write command, no `schtasks /Create`, no cron registration, no non-loopback socket, no credential, no secret.

### 5.1 Artifacts this stream produced (sha256, for hand-off)

```
920445faccae517d8449d88aae09a734077f40a0d939e32781e3a9b93f18a7a1  e2e_r3_two_day.py
d8344487c50233ae1899f70109b5bf4570dd46fad6917e60f68ba99248e63298  raw/01-live-http-probes.txt
3c2bef2d0ebcb8ba5c9a12abc4709023c98d9ea3d329eb4b6ddad1c3b5dccd50  raw/02-listeners-and-procs-rerun.txt
52a24b9d2c9468ccd820d20d0ace97328ff63c6b1c345cde54cba4ff021e2dec  raw/19-transport-probe-rerun.txt
2225e95e003fa9ccaa8da83b2ef19478b56f96da8d9a013b9c6552e6778f779b  raw/20-r3-e2e-run.txt
14bef54210c657ef42e907754b0216266c7d3d8a056984e77ffa4367ae21dfb0  raw/28-toast-channel-capability.txt
ee15602825cb835cfcad310ac3ef4a3e7e22f86bfa2fb659a54ee1b525535e6d  raw/29-timing.txt
07a4deaa17dcfcc552bf7afc609b059c0a9e7e6138a6899cbf4c869ac9863172  raw/30-other-sources-and-prod-state.txt
ed1289f7bb1d6bfe9aeec42e3adae14fabfb5640c90eaa2ac598b111140965a4  raw/e2e-state/state/notified-keys.json
6caecdfb2887ed22539966ef1e8b072346520cdc666e17bb5cfb462c0f7112fd  raw/e2e-state/alerts/alerts.jsonl
20bc36dd87df4ffd052d5dd545745ccadd9a63fbfdc4ba69173f8e6a9c45531d  raw/e2e-state/logs/toast-stub.log
```
> Note: `raw/` also contains files from a **concurrent/parent** pass (`00-parent-pass-2026-10-01-1142.txt`, `01-isolation-before.txt`, `02-enforcement-probe.txt`, `03-acceptance-bar.txt`, `04-production-state-snapshots.txt`, `05-shipped-guard-tests.txt`, and a `probe/` tree) that are **not** this stream's and were left untouched. Only the eleven artifacts above are Stream S.

---

## 6. Claim ledger

| # | Claim | Class | Pointer |
|---|---|---|---|
| 1 | `:4600` and `:3001` both refuse connections at 11:42; nothing listens | [A] | `raw/01`, `raw/02` |
| 2 | R3 measured `:4600/api/health` 200 and the freecash/auth route 200 at 09:28; both now unreachable (**a change**) | [A] | R3 `raw/01`, `raw/11` vs this `raw/01` |
| 3 | The routine's own transport fails identically (`WinError 10061`) on both bases today | [A] | `raw/19` |
| 4 | `metrics_http` remains DEAD today | [A] | `raw/01`, `raw/19` |
| 5 | Operator file is the only source yielding the four figures; production `records=0` | [A] | `raw/30` |
| 6 | Day-1 record → `INITIAL_BASELINE`, `notifications=0` | [A] | `raw/20` §1 |
| 7 | Day-2 changed figure → exactly one `EARNINGS_CHANGED`, `notifications=1`, `approvals=1` | [A] | `raw/20` §2 |
| 8 | Dedupe key `8341abcc…9d5c` = `sha256(day\|type\|field\|old\|new)`, persisted before dispatch, delivery `STUB_OK` | [A] | `raw/20` §2b, `raw/e2e-state/state/notified-keys.json` |
| 9 | Same-day replay → `SKIP_DUPLICATE_DAY`, 0 notifications; same-change replay → `DEDUPED`, 0 new toasts | [A] | `raw/20` §3–§4 |
| 10 | Routine runtime ≈ 0.22 s per invocation | [A] | `raw/29` |
| 11 | Toast is a standalone PowerShell `NotifyIcon` balloon; independent of the desktop app; 2 attempts then `DELIVERY_FAILED` | [B] | `notify.py:167-192, 220-261` |
| 12 | `NotifyIcon` mechanism loads on this host (balloon not shown) | [A] | `raw/28` |
| 13 | Production root unchanged (hashes + 0 files after 11:30) | [A] | Part 5 |
| 14 | Route `/api/projects/:id/freecash/auth` exists and returns session state only | [C] (R3) | R3 `raw/11`; not re-measurable today |
| 15 | Human entry cost ~2 min/day | [C] (estimate) | RESEARCH-PLAN.md RQ-4 |

## 7. Open defects / limits of this stream

1. **Wire source regression, not improvement:** R3's RANK 2 target is unreachable today because the `:4600` node process is gone. If a wire source is ever wanted, the *allowlist + new read-op* work R3 scoped is still required **and** the target route may not even be up at run time — the trigger/availability question belongs to stream `T`.
2. **Toast delivery is unproven against a real desktop in this pass** — only the offline stub was exercised (deliberately, to avoid a visible side effect). Real delivery remains `[B]` mechanism + `[A]` capability-load.
3. **The four-figure procedure is only as good as the operator's discipline** (RQ-4's design consequence). Today's production day key is already spent, so the first real reading is the next local day.
4. **Nothing is scheduled** (brief §2 A17); the R3 proof above is triggered by hand and would still produce a notification when the routine is invoked — but only if it *is* invoked.

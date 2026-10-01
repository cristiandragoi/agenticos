# 02 — Provider / Data-Source Research Plan

**Deliverable:** `02-provider-research-plan.md` (doc only — no source file was modified)
**Repository:** `D:\AgenticOS` (Windows 11, bash/git-bash)
**Pass date:** 2026-10-01 (Europe/Berlin) · **git HEAD:** `8f7463a`
**Written by:** research subagent for delegation `deleg_1b3c55be` (per `00-delegation-brief.md`)

> **What this document is.** The plan that must be executed *before* the Free Cash daily
> monitoring routine can be trusted to report on a real account. It does **not** claim the
> routine works; it states, per open question, exactly what evidence would settle it, what it
> costs, and how to run the experiment without contaminating production state.
>
> **Grounding rule used throughout.** Every factual claim below is either (a) backed by a live
> read/command run in this pass and quoted here, or (b) explicitly marked `UNVERIFIED` or
> `BLOCKED`. No provider response in this document is invented: none exists to quote, and that
> absence is itself the finding. Secrets are never reproduced — where a value exists it is shown
> as `[REDACTED]`.

---

## 0. Headline finding of this pass (read this first)

**The routine has never read a provider, and cannot today — by design, not by bug.** Two
independent things are true at once:

1. **The only read source that actually exists and is reachable today is the human-entered file**
   `data/freecash-monitor/state/operator-state.json`, read by `monitoring/freecash/operator_state.py`
   with `READ_OPS = []` and **no socket code at all**. Its `records` list is **empty**, so the
   monitor has produced **nothing but degraded placeholders** for the last 11 days.
2. **No provider read path is even allowlisted.** `monitoring/freecash/readonly_client.py:43-49`
   permits exactly two loopback paths and keeps the provider literal
   `PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase` (`readonly_client.py:60`). A provider
   read cannot be added by configuration — it requires a code change after research resolves it.

Therefore the five tasks below are ordered so that the routine is made *trustworthy about the
source it actually has* (Task 2, Task 4, Task 5) before any provider work is even attempted
(Task 1, Task 3).

---

## 1. Research Task 1 — Prove which read-only data source actually exists and is reachable today

**Question.** For each *candidate* source, is it live-and-reachable today, or assumed? The
candidates are: (A) the human operator-entered file; (B) a provider HTTP API (HG.Cash /
Cashfree Payouts / FreeCash.io); (C) the AgenticOS local metrics route
`GET http://localhost:3001/api/v1/status/metrics`.

**What this pass already established (live evidence):**

| Candidate | Status today | Evidence (live, this pass) |
|---|---|---|
| **A. Operator-entered file** | **EXISTS, reachable, non-networked** | `monitoring/freecash/operator_state.py:45,119-151` — reads `state/operator-state.json`, `READ_OPS = []`; no `socket`/`http` import in the module. File present, mtime `2026-09-20 21:08:00`. |
| **B. Provider HTTP API** | **BLOCKED — no endpoint, no credentials** | `readonly_client.py:43-49` allowlists only `/api/v1/status/metrics` and `/api/v1/status`; provider literal unresolved at `:60`. No `FREECASH_*`/`HG_CASH`/`CASHFREE`/`Bearer`/`payout` key in `server/.env` or `.env` (grep, §Appendix A). |
| **C. AgenticOS local metrics route** | **UNVERIFIED in this pass — not probed** | Defined at `readonly_client.py:54-56`. This doc deliberately did **not** call it (no side effects permitted in a doc pass). Prior pass `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md:26` recorded `curl → exit 7, HTTP 000` on 2026-09-17; that is **11 days stale and must be re-measured**, per the skill's own rule that an inherited "down" expires. |

**Evidence that would prove a candidate is live rather than assumed:**

- **A (operator file):** already proven. A *today-dated* record appended by a human, then
  `python -c "import operator_state,paths; print(operator_state.read_source('<today>'))"` returning
  `data_available: True` with non-null fields and a non-empty `raw_response_sha256`.
- **B (provider):** **three** facts must hold *at once*, none of which can be assumed:
  1. the endpoint path is resolvable and answers a **`GET`** (not 404/DNS-fail);
  2. the auth scheme is known and a token exists **in this repo** (no secret may be pasted into
     this doc — presence is proven by a key name in an env file, value `[REDACTED]`);
  3. an authenticated read returns the account's own fields, not public/aggregate data.
  A `401`/`403` proves only that the *path* is real, **not** that this account is reachable — the
  prior research's HG.Cash `401` and Cashfree `403` are path-liveness evidence only
  (`PROVIDER-API-RESEARCH.md:107-110,140-142`).
- **C (local metrics):** a `HEAD /api/v1/status` returning `200` **and** the process on `:3001`
  being the AgenticOS server (not a stale listener). Evidence = the health response body + the
  built git SHA, quoted beside the claim.

**Expected Effort:** 2–3 h (A is done; C is one probe; B is multi-day and lives in Task 3).
**Time-to-Revenue:** Immediate for A/C (the routine becomes honest about what it reads today);
**negative-until-Task-3** for B (building on an assumed provider contract would ship a fiction).
**Dependencies:** for C — the AgenticOS backend actually running on `:3001`; for B — an operator
answer + credentials, neither of which exists (see Task 3).
**First Concrete Action:** re-measure candidate C in one command, and record the raw output beside
the inherited claim: `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/v1/status`
(plus `curl -sS http://localhost:3001/api/v1/status`). Do **not** touch B yet.

---

## 2. Research Task 2 — Answer every open question that the repo can answer offline (answered here)

These are answered **now**, with `file:line` evidence, so no later reader has to re-derive them.

### 2.1 Which files exist, which are real, which are stubs, which are decoys?

| Path | Verdict | Evidence |
|---|---|---|
| `monitoring/freecash/` (10 modules + `tests/`) | **Canonical, real** | `run_daily_check.py`, `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `operator_state.py`, `readonly_client.py`, `paths.py`, `watchdog.py`, `verify_readonly.py`; suite runs `tests=52 failures=0 errors=0 skipped=0` (this pass). |
| `monitoring/freecash/verify_readonly.py` | **Real, falsifiable-by-design** | `:41-88` six forbidden token classes; `:130-135` a hit is a hit unless marked `readonly-exempt:`; `:184-185` prints `PASS`. Ran live: `forbidden=0 exempt=28 missing_targets=0` → `PASS`. |
| `server/scripts/freecash-daily-monitor.mjs` | **DECOY — cannot parse** | `node --check` → `SyntaxError: Unexpected token ':'` at `server/scripts/freecash-daily-monitor.mjs:41` (`function isDailyCheckAllowed(): boolean {` — a TS annotation in a `.mjs`), exit 1. Never executed. |
| `server/scripts/verify-freecash-rules.mjs` | **DECOY — tautological** | Exits 0 printing `4/4 PASSED`, but `checkRule3()` is `!content.includes('checkForChanges') || content.includes('.log(')` (always true) and `checkRule4()` ends `|| content.includes('approval-request.json')` — a **file-existence token that also always holds**. It certifies a monitor that does not parse. |
| `server/src/adapters/freecashMonitorAdapter.ts` | **DECOY — hardcoded stub, not wired** | `fetchStatus()` returns a literal with `externalConnected: false` and the message *"External FreeCash API connection is not configured."* (`:198-209`). It is imported at `turnController.ts:24` and `operatorController.ts:4`, but `runtimeRegistry` registers only Hermes/Jarvis/Codex/Video/HeavyGen (`server/src/index.ts:145-149`) — **not this adapter**. `index.ts:435` adds the kill-shot: `// FreeCash is no longer our objective.` |
| `scripts/monitoring/free-cash-daily-check.py`, `scripts/make_freecash_check.py`, `server/tasks/daily-finance-monitor.py`, `finance-monitor/src/rule_engine.py` | **Stub / overlapping, not the entry point** | Present (`ls` this pass). Prior skill evidence: no `__main__` guard → silent exit 0; `parents[2]` → wrong data dir; `rule_engine.py` has an f-string `SyntaxError`. Not exercised in this pass → treat their failures as **UNVERIFIED, inherited**. |

**Conclusion:** the only code that runs is the Python package; two filename-identical JS artefacts
and one TS adapter are **decoys that a grep-based acceptance check would pass**. Any future verifier
must be shown to fail on a known violation (see Task 5 / `03-…`).

### 2.2 What is the operator-state record schema?

From `operator_state.py` and the live file:

- **Document:** `{schema_version:int, kind:"operator_entered_daily_status", note:str,
  how_to:[str], records:[record], template_record:record}` (`operator_state.py:76-88`).
- **Record fields** (`operator_state.py:48-56`, `_RECORD_FIELDS` at `:58-66`):
  `day_key` (`YYYY-MM-DD`), `entered_at_utc` (`YYYY-MM-DDTHH:MM:SSZ`), `account_status` (str,
  uppercased on read), `earnings_total_cents` (int), `balance_cents` (int), `pending_cents` (int),
  `currency` (str). **Money is integer cents** — `1340 == 13.40` (`:_HOW_TO`).
- **Selection rule:** only the record whose `day_key` **exactly equals today's operator-local day**
  is used; a stale record is never carried forward (`operator_state.py:35-37,104-116`).
- **Live state:** `data/freecash-monitor/state/operator-state.json` has `"records": []` — **empty**.
  No reading exists. This is the single most important fact about the routine's current output.

### 2.3 What is the alert / notification schema?

**Alert log (canonical evidence record)** — `notify.py:63-79`, one JSON object per line appended to
`alerts/alerts.jsonl` (never rewritten; `paths.py:183-200`):

```
{event_id:uuid, ts_utc:ISO, day_key:YYYY-MM-DD, event_type:str,
 dedupe_key:str|null, severity:"info|notify|alert", message:str(≤500), observed:{...}}
```

- Event → default severity: `READ_FAILED, RUN_FAILED, MISSED_DAY, DELIVERY_FAILED,
  MONITOR_DEGRADED → "alert"`; `EARNINGS_CHANGED, STATUS_CHANGED, BALANCE_CHANGED,
  APPROVAL_PENDING → "notify"`; everything else `"info"` (`notify.py:36-39,52-57`).
- Delivery labels: `QUEUED`, `TOAST_OK`, `STUB_OK`, `FAILED_TOAST` (`notify.py:44-47`). A stubbed
  delivery is labelled `STUB_OK`, **never** `TOAST_OK`, so a stubbed run cannot masquerade as real.

**Dedupe index:** `state/notified-keys.json` = `{schema_version, keys:{<sha256>: {first_notified_at_utc,
delivery, updated_at_utc}}}` (`notify.py:132-145`), keyed by
`sha256(day_key|change_type|field|old_value|new_value)` (`changedetect.py:214-216`).

**Approval queue (R4):** item schema at `approval_queue.py:108-134`. Frozen constants: `status:"PENDING"`,
`expires_at_utc: null` (`NO_EXPIRY`, `:48`), `execution_state:"NOT_EXECUTED"` (`:44`),
`execution_allowed_by_this_routine: false` (`:45`). `decide()` re-asserts the frozen fields even
after a human decision (`:179-182`). Live state: `data/freecash-monitor/approvals/` is **empty** —
no item has ever been enqueued.

### 2.4 Other offline-answerable facts

- **Scheduler: NONE.** `schtasks //query` shows no freecash task; no user crontab entry (both
  re-run this pass). The routine runs only when a human invokes it.
- **Notification channel: NONE bound.** No `FREECASH_NOTIFICATION_*`/`WEBHOOK`/`SMTP` key exists;
  default delivery is a Windows toast via PowerShell (`notify.py:167-192`).
- **Day key / timezone:** `Europe/Berlin` default, `FREECASH_TZ` override
  (`gate.py:15-17,26,47-48`). If the IANA DB is absent the routine falls back to system-local and
  reports `MONITOR_DEGRADED` (`gate.py:56-77`; `run_daily_check.py:357-369`).
- **`MONITOR_DEGRADED` counts as a "success" for missed-day math** — it is in `SUCCESS_OUTCOMES`
  (`gate.py:32-41`). Consequence: `last-run.json` shows `last_success_day = "2026-10-01"` while
  `last_outcome = "MONITOR_DEGRADED"` — **a "success" with no reading.** Any trust check must read
  `last_outcome`/the snapshot's `data_available`, not `last_success_day`.
- **Today is already burned.** `state/day-locks/2026-10-01.lock` exists (mtime 08:53). The day is
  consumed; no second read is possible today. Root cause is `run_daily_check.py:307-309`
  (lock acquired) vs `:372` (source read) — **lock-before-read**.

**Expected Effort:** absorbed — **already done in this pass** (0 further h).
**Time-to-Revenue:** immediate — removes 4 of the ~7 unknowns that were gating a trust decision.
**Dependencies:** none (pure repo reads).
**First Concrete Action:** none remaining for the questions above; carry the §2 conclusions into
`03-rule-verification-and-approval-gate.md` so the verifier is built against the real modules, not
the decoys.

---

## 3. Research Task 3 — Resolve the provider-API compliance questions that CANNOT be answered offline

Every item below is an **explicit unknown**. None is answered by this document, and **none may be
answered by inventing a response**. For each: the minimum experiment that would settle it, its cost,
and its risk.

> **Framing correction to carry forward.** The table in the skill's `references/api-compliance.md`
> (HG.Cash `GET /accounts`; Cashfree `GET /payout/v1.2/getBalance`; FreeCash.io
> `GET /withdrawals`) is an **UNVERIFIED ASSERTION**. It ships inside a skill, cites no live
> response, and this repo has no credentials. `freecash.io` is a parked domain for sale and the
> `X-API-Key` "FreeCash.io" entry is actually parse.bot's key (`server/data/freecash-monitor/INTEGRATION_STATUS.md:28-33`;
> `PROVIDER-API-RESEARCH.md:70-81,155-173`). Treat the table as a hypothesis to test, not a contract.

| # | Unknown | Why it cannot be answered offline | Minimum experiment | Cost | Risk |
|---|---|---|---|---|---|
| 3.1 | **Which provider/account is even being monitored?** | Nothing in the repo names it; no credential ties any provider to the account (`PROVIDER-API-RESEARCH.md:15-17`). | **Ask the operator** one question: "which platform/account, and can a read-only token be issued?" | minutes | none (no system touched) |
| 3.2 | **Auth scheme of the real provider** | Depends on 3.1. HG.Cash = `Authorization: Bearer cash_<…>`; Cashfree = `POST /payout/v1/authorize` with `X-Client-Id`/`X-Client-Secret` then Bearer; both are *documented claims*, not verified against this account. | Only after 3.1: one **manual, human-driven**, unauthenticated `GET` on the documented path; record status + body verbatim. | ~30 min | low; a single unauthenticated GET against a documented public API |
| 3.3 | **Token expiry / lease time** | Requires a real token to observe. Skill claims "tokens expire after defined lease time" with no value and no source. | With a real token: issue one, call the read endpoint, wait past the documented lease, call again; record the first expiry `401`. | hours–1 day (elapsed) | low, **but** token must live in an env var, never in a doc/chat |
| 3.4 | **Rate limits** | HG.Cash publishes **no** rate-limit page (its full `llms.txt` has no entry, `PROVIDER-API-RESEARCH.md:111-112`); Cashfree does not publish one for Payouts Get Balance (`:143-147`). | Read the `X-RateLimit-Limit/-Remaining/-Reset` response headers from a first authenticated read; if absent, ask the provider's onboarding address. | ~1 h | none (header read only) |
| 3.5 | **Is `/transactions` reachable at all?** | It is a **write** endpoint (HG.Cash cash-out). Reachability is not testable offline and **must not be probed with a live request** — R1 forbids it. | **Do not experiment.** Treat as permanently forbidden; assert by code (`verify_readonly.py` already greps it, `:41-88`). If it ever must be discussed, cite docs only. | 0 | **avoidable, severe** — any POST risks the account |
| 3.6 | **Is `/cashout` reachable at all?** | Same as 3.5. | Same: **do not probe.** Forbidden by R2's deny-by-default transport before a socket is opened (`readonly_client.py:110-140`). | 0 | **avoidable, severe** |
| 3.7 | **Does an authenticated read return the account's own balance?** | Public/aggregate feeds exist (parse.bot returns *other users'* data, `PROVIDER-API-RESEARCH.md:163-165`); only an authenticated call proves it is "your account". | After 3.1–3.3: one authenticated `GET` on the read path; assert the response contains an account identifier matching the operator's. | ~1 h | low if read-only; see 3.3 for token hygiene |
| 3.8 | **FreeCash.com legal posture** | Settled *offline* from public docs and **not** a technical unknown: ToS §16/17 prohibits **automated *and* manual monitoring** without written consent (`docs/free-cash-monitor-routine/DELEGATION-2026-10-01/datasource/evidence-02-provider-docs.txt:20-45`). | **Do not build any freecash.com path** (session-cookie, browser, scraper). If the operator insists, the only compliant route is written consent from Almedia. | 0 | **existential** — risks the very account being monitored |

**Minimum-experiment guardrail for all of 3.1–3.4, 3.7:** any such request is made **by a human,
outside the routine**, in a scratch shell, and its raw output is pasted into an evidence file — the
monitor is not modified to reach a provider until the contract is proven. Never widen
`readonly_client.ALLOWED_PATHS` (`:43-49`) on a hunch; the provider literal stays unresolved until
Task 3 succeeds.

**Expected Effort:** 3–5 days, unknown-unknowns-heavy (dominated by waiting on the operator for 3.1).
**Time-to-Revenue:** Slow. Per `00-delegation-brief.md` §3 "Time-to-Revenue" means time until the
routine is audit-worthy, not until money moves (R1 forbids movement). Provider work adds **no**
near-term value and risks the account.
**Dependencies:** operator confirmation (3.1) → credentials (3.2) → everything else. **All presently
BLOCKED.**
**First Concrete Action:** send the operator the single 3.1 question and record the answer verbatim;
until it arrives, do nothing provider-facing.

---

## 4. Research Task 4 — Sandbox-isolation evidence protocol (runnable, verified in this pass)

Every experiment in Tasks 1, 3, and 5 that executes the routine **must** run against a throwaway data
root, and the *real* root must be proven byte-identical before and after. The commands below were run
in this pass and are quoted with their real output.

```bash
cd /d/AgenticOS
REAL=data/freecash-monitor

# --- 1. BEFORE: hash the real root's mutable evidence files -------------------
sha256sum "$REAL/state/last-run.json" \
          "$REAL/state/operator-state.json" \
          "$REAL/alerts/alerts.jsonl"

# --- 2. BEFORE: capture the exact set of files touched today -----------------
find "$REAL" -type f -newermt "2026-10-01 00:00" | sort > /tmp/fc-before.txt
cat /tmp/fc-before.txt

# --- 3. Run everything against a throwaway root ------------------------------
THROW=$(mktemp -d)
export FREECASH_DATA_ROOT="$THROW/freecash-monitor"
export AGENT_TEAMS_DB_PATH="$THROW/agent-teams.sqlite"
export FREECASH_TOAST_STUB=1
python monitoring/freecash/tests/run_all.py        # expect: tests=52 failures=0 errors=0 skipped=0
python monitoring/freecash/verify_readonly.py      # expect: forbidden=0 … PASS

# --- 4. AFTER: re-hash and diff the touched-set ------------------------------
sha256sum "$REAL/state/last-run.json" \
          "$REAL/state/operator-state.json" \
          "$REAL/alerts/alerts.jsonl"
find "$REAL" -type f -newermt "2026-10-01 00:00" | sort > /tmp/fc-after.txt
diff /tmp/fc-before.txt /tmp/fc-after.txt && echo "ISOLATION_OK: real root untouched"
```

**Live result of running exactly the above (this pass):**

```
BEFORE == AFTER (all three hashes identical):
  a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9  state/last-run.json
  be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c  state/operator-state.json
  1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8  alerts/alerts.jsonl
run_all.py  -> run_all: tests=52 failures=0 errors=0 skipped=0   (exit 0)
verify_readonly.py -> [verify_readonly] forbidden=0 exempt=28 missing_targets=0
                      [verify_readonly] PASS - no unexempted write/earning token found.  (exit 0)
throwaway root produced no files (the suite pins its own temp root, _support.py:53)
```

**Important correction to the skill's shorthand.** The skill says `find <root> -type f -newermt
"<today> 00:00"` should return **zero**. In this repo that is **wrong today**: `2026-10-01 00:00`
already matches four pre-existing files (the morning burn — `alerts.jsonl`, `snapshots/2026-10-01.json`,
`day-locks/2026-10-01.lock`, `last-run.json`). The correct, honest assertion is **not "zero" but
"the identical set as before"** — a `diff` of the before/after lists. A literal "expect zero" would
fail on a clean pass and invite someone to delete real evidence. Use set-equality.

**Notes / caveats:**
- `FREECASH_DATA_ROOT` is honoured at `paths.py:45-48`; the suite additionally pins its own temp root
  at `_support.py:49-53`, so the export is belt-and-braces.
- `AGENT_TEAMS_DB_PATH` is exported for the JS/Electron side; **UNVERIFIED** that the Python routine
  reads it — include it anyway so a future shared harness cannot leak.
- **Do not run the monitor against the real root in a doc/experiment pass.** Task 5's degraded
  example uses the *already-existing* 2026-10-01 artefacts; no new run is needed or permitted
  (today's lock is spent).

**Expected Effort:** ~15 min to run; negligible to maintain.
**Time-to-Revenue:** immediate — it is the precondition that makes every other experiment safe.
**Dependencies:** a `python` on PATH with `tzdata` (Windows: the Hermes venv python) so the day key
resolves to `Europe/Berlin` rather than system-local (`gate.py:56-77`).
**First Concrete Action:** paste the block above into a single bash invocation **before** touching any
provider code, and keep the hash output as the pass's evidence line.

---

## 5. Research Task 5 — Tell a real reading from a degraded placeholder

The routine must never let a placeholder masquerade as a verified reading. The distinction is
**structural** and checkable from artefacts alone:

| Signal | **Real reading** | **Degraded placeholder** |
|---|---|---|
| `snapshot.source.data_available` | `true` (`changedetect.py:154,169-173`) | **`false`** |
| `snapshot.account_status / earnings_total_cents / balance_cents / pending_cents / currency` | non-null (ints / str) | **all `null`** (`changedetect.py:169-173`) |
| `snapshot.raw_response_sha256` | ≠ empty-hash | **`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`** = `sha256(b"")` — proof zero bytes were read |
| `snapshot.degraded` | `true` **always** (`changedetect.py:168`) — no source today is provider-verified | `true` |
| `alerts.jsonl` event for the day | `INITIAL_BASELINE` / `OK_NO_CHANGE` / `EARNINGS_CHANGED` / `STATUS_CHANGED` / `BALANCE_CHANGED` | **`MONITOR_DEGRADED`** with `observed.*` all `null` (`run_daily_check.py:410-419`) |
| `last-run.json.last_outcome` | an outcome in `SUCCESS_OUTCOMES` that is *not* `MONITOR_DEGRADED` | `MONITOR_DEGRADED` |
| `operator-state.json` | a record with `day_key == today` | **absent** → `data_available:false` (`operator_state.py:128-139`) |

**Note the trap:** `degraded: true` is **always** true, including for a real operator reading — the
field means "not provider-verified", not "no data". The reliable discriminator is
**`data_available` + null-vs-non-null fields + the empty-body hash**, never `degraded` alone.
And `last_success_day` is **not** a reliability signal: `MONITOR_DEGRADED` is a `SUCCESS_OUTCOMES`
member (`gate.py:32-41`), so `last-run.json` today reads `last_success_day:"2026-10-01"` with
`last_outcome:"MONITOR_DEGRADED"`.

**Falsifiable check the operator can run (read-only, no run):**

```bash
cd /d/AgenticOS
python - <<'PY'
import json,hashlib,pathlib
root=pathlib.Path("data/freecash-monitor")
for p in sorted((root/"snapshots").glob("*.json")):
    s=json.loads(p.read_text())
    empty=hashlib.sha256(b"").hexdigest()
    kind="PLACEHOLDER" if (s["source"]["data_available"] is False
                           or s["raw_response_sha256"]==empty) else "REAL?"
    print(p.name, kind, "data_available=",s["source"]["data_available"],
          "balance_cents=",s["balance_cents"])
PY
```

**Live run of the above (this pass):** every one of `2026-09-20.json`, `2026-09-30.json`,
`2026-10-01.json` prints `PLACEHOLDER … data_available= False balance_cents= None`. **The routine has
never produced a real reading.**

**Expected Effort:** ~30 min to encode the table above as the acceptance check shared with `03-…`.
**Time-to-Revenue:** immediate; it is what stops a "MONITOR_DEGRADED success" from being reported as
a status check.
**Dependencies:** Task 4 (the check must run sandboxed if it ever executes the routine; the snippet
above is pure file-read, so it needs no sandbox).
**First Concrete Action:** adopt the snippet as `03-…`'s "real vs degraded" gate and make it **fail**
on a known placeholder (the three snapshots on disk are the fixtures) before trusting any PASS.

---

## 6. Exit criteria — what must be true before this routine is trusted

1. **Source is named and proven** (Task 1): exactly one of A/B/C is the declared read source, with a
   live evidence line — no candidate left "assumed live".
2. **Every offline question in §2 is answered in-repo**, and the two decoys
   (`freecash-daily-monitor.mjs`, `verify-freecash-rules.mjs`) and the stub adapter are recorded as
   decoys so no verifier cites them.
3. **All provider unknowns in §3 are either resolved by a quoted, human-run response or remain
   explicitly BLOCKED.** No fabricated provider payload appears anywhere.
4. **Sandbox isolation holds** (Task 4): before/after hashes of `last-run.json`, `operator-state.json`,
   `alerts.jsonl` identical, and the touched-file set unchanged.
5. **Real-vs-degraded is machine-checked** (Task 5): the check is shown to FAIL on the three on-disk
   placeholders before it is trusted to PASS on a real reading.
6. **The routine is not "trusted" on the strength of `4/4 PASSED`** from
   `verify-freecash-rules.mjs` (`server/scripts/verify-freecash-rules.mjs`, tautological) — the
   falsifiable verifier is `monitoring/freecash/verify_readonly.py` (`forbidden=0 … PASS`, and it has
   a negative-control test in `tests/test_r2_readonly.py:27,161-167`).

**Blocker status (verbatim):**

- **BLOCKED** — provider identity/auth/token/rate-limits (§3.1–3.4, 3.7): need the operator; no
  credentials exist in the repo.
- **AVOID** — §3.5/3.6 (`/transactions`, `/cashout`): never probe; forbidden by R1/R2.
- **UNVERIFIED (stale, must re-run)** — candidate C `localhost:3001` (§1): last measured 2026-09-17,
  `PROVIDER-API-RESEARCH.md:26`; the skill's own rule says an inherited "down" expires within a day.
- **VERIFIED (this pass)** — §1 candidate A, all of §2, §4, §5.

---

## Appendix A — Raw evidence log for this pass (commands + output, trimmed)

```
$ date                                    → Do,  1. Okt 2026 09:00:14 +0200
$ git log --oneline -1                    → 8f7463a feat(antigravity): route live Jarvis …

$ ls monitoring/freecash/
  approval_queue.py changedetect.py gate.py notify.py operator_state.py paths.py
  readonly_client.py run_daily_check.py watchdog.py verify_readonly.py  tests/

$ ls data/freecash-monitor/state/operator-state.json
  2026-09-20 21:08:00  879 bytes          (records: [] — empty)
$ stat -c '%y %s' data/freecash-monitor/state/operator-state.json
  2026-09-20 21:08:00.718966300 +0200  879
$ cat state/last-run.json
  last_attempt_day=2026-10-01 last_success_day=2026-10-01 last_outcome=MONITOR_DEGRADED
$ wc -l alerts/alerts.jsonl              → 15
$ ls data/freecash-monitor/approvals/    → (empty)

$ node --check server/scripts/freecash-daily-monitor.mjs
  SyntaxError: Unexpected token ':'  (line 41)   exit=1
$ node server/scripts/verify-freecash-rules.mjs
  [OK] All 4 operational rules verified (4/4 passed)   exit=0   # tautological — see §2.1

$ grep -iE 'freecash|hg_cash|cashfree|bearer|payout|api_key|token' server/.env .env .env.example
  server/.env: DEEPGRAM_API_KEY=[REDACTED] OPENROUTER_API_KEY=[REDACTED]
               DASHSCOPE_API_KEY=[REDACTED] QWEN_API_KEY=[REDACTED] ALIBABA_API_KEY=[REDACTED]
  .env:        (JARVIS/OLLAMA/LLM keys only)
  → 0 FREECASH_* / HG_CASH / CASHFREE keys

$ grep -n freecash server/src/index.ts
  435:// FreeCash is no longer our objective. Do not resume its tasks on startup; preserve existing records.
  (registry at :145-149 registers Hermes/Jarvis/Codex/Video/HeavyGen only)

$ python monitoring/freecash/tests/run_all.py
  run_all: tests=52 failures=0 errors=0 skipped=0
$ python monitoring/freecash/verify_readonly.py
  [verify_readonly] forbidden=0 exempt=28 missing_targets=0
  [verify_readonly] PASS - no unexempted write/earning token found.

$ sha256sum (before == after)   → ISOLATION_OK, real root untouched (see §4)
$ schtasks //query | grep -i cash  → (none)
$ crontab -l | grep -i cash        → (none)
```

## Appendix B — Prior-art documents this plan builds on (do not re-derive; verify if cited)

- `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md` — the empirical provider survey
  (HG.Cash 401, Cashfree 403, freecash.com 404 + ToS), 2026-09-17. **11 days old; treat live-probe
  claims as stale.**
- `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/datasource/evidence-02-provider-docs.txt` —
  2026-10-01 documentation-only quotes (ToS §16/17 verbatim).
- `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/scheduler/evidence-01-production-hermeticity-before.txt`
  — the before-hash baseline that matches §4 (same three hashes).
- `docs/free-cash-monitor-routine/verify-readonly.sh` — the shell original that
  `monitoring/freecash/verify_readonly.py` ports (`verify_readonly.py:1-5`).
- **`docs/free-cash-monitor-routine/` holds ~35 overlapping plan documents** (V1…V8, multiple
  DELEGATION-* folders). This pass found the *installed* artefacts (`data/freecash-monitor/`,
  `monitoring/freecash/`) to be ground truth and treated the plan corpus as historical — per the
  skill's own rule to verify against installed day-key semantics, not the newest document.

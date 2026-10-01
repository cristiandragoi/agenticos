# RESEARCH-PLAN — the ONE blocker of the Free Cash daily status-monitoring routine

**Canonical status.** This file is the single authoritative plan for the routine's only open blocker: *which read source can be both rule-compliant and populated*. It supersedes the **plans** listed in §9 (as plans). It does **not** supersede the design contract `ROUTINE-DESIGN.md`, the gate contract `RULE-GATE-CHECKLIST.md` / `verify-readonly.sh`, or the evidence registers `PROVIDER-FINDINGS-REVERIFIED.md` and `PROVIDER-DECISION-PACKET-2026-09-20.md` — those remain authoritative for their own subject matter and are inherited by reference here.

| Field | Value |
|---|---|
| **Repository / branch** | `D:/AgenticOS` · `hermes-rescue-20260908` · 528 uncommitted entries (`git status --porcelain \| wc -l` → `528`) |
| **Written** | 2026-09-20, delegation `DELEGATION-2026-09-20-R2` (round 2) |
| **Routine under plan** | `monitoring/freecash/` — entry point `run_daily_check.py`; modules `gate.py`, `changedetect.py`, `approval_queue.py`, `readonly_client.py`, `notify.py`, `operator_state.py`, `watchdog.py`, `paths.py`, `keys.py` |
| **Artifact created by this pass** | this file only. No other file was modified, moved, deleted; no `git add`/`commit`/`reset`/`checkout`/`stash`; no scheduled task registered |
| **Network performed by this pass** | three loopback probes to `localhost:3001` (§8). No provider call, no credential read or request, no authenticated endpoint, no signup |
| **Rules served** | R1 one status check per operator-local calendar day · R2 zero automated earning actions (GET/HEAD, allowlisted loopback paths, no execution path) · R3 exactly one notification per distinct change · R4 human approval before any external action |
| **Evidence standard** | **OBSERVED** (command + verbatim result from *this* session) · **CARRIED** (named artifact, explicitly marked, not re-derived) · **UNVERIFIED**. No PASS is carried from an earlier run. Every cited path was confirmed with `ls`/`read_file` in this session |

---

## 0. The blocker, stated exactly

**The routine has exactly one blocker: no read source is simultaneously (a) permitted by R2/R4 and (b) populated with real data.**

Consequences, both OBSERVED in this session in the live state root:

| # | Consequence | Evidence |
|---|---|---|
| B1 | R3 can never fire: no figures enter the routine, so no change can ever be detected | `data/freecash-monitor/state/operator-state.json` → `"records": []`; `data/freecash-monitor/snapshots/2026-09-20.json` → `"data_available": false`, all four money fields `null` |
| B2 | The routine ran today and correctly reported degraded with zero notifications | `data/freecash-monitor/alerts/alerts.jsonl` = 2 lines, both `2026-09-20`: `MONITOR_DEGRADED` ("No data for 2026-09-20 … nothing is compared and nothing is notified until a reading exists") then `SKIP_DUPLICATE_DAY` |

This round-2 plan adds one finding the prior plans did not have: **the second candidate read source is not merely degraded — it is structurally unpopulatable and currently dead**, and **the code cannot represent a non-degraded source even if one appeared** (§2 items 7–9, §5).

---

## 1. Structural verification (re-verified in this session, not assumed)

Each row = a claim from the delegation brief re-checked against source with a citation. Nothing below is repeated from memory.

| # | Claim | Citation | Verdict |
|---|---|---|---|
| 1 | `SOURCES = ("operator_state", "metrics_http")`, default `operator_state` | `run_daily_check.py:52-53` (`DEFAULT_SOURCE = "operator_state"`, `SOURCES = (...)`) | **OBSERVED — confirmed** |
| 2 | `operator_state.read_source(day)` returns `data_available=False` when no record matches today's `day_key` | `operator_state.py:127-139` (`if record is None: return {... "data_available": False ...}`); exact match only: `operator_state.py:104-116` (`entry.get("day_key") == day`, no carry-forward) | **OBSERVED — confirmed** |
| 3 | No record → `MONITOR_DEGRADED` branch that never reaches change detection | `run_daily_check.py:410-419`: `if not source["data_available"]: outcome = "MONITOR_DEGRADED"` then `notify.alert(...)`; the change-dispatch branch is the `else` at `:431-439`, so comparison results are never dispatched on this path | **OBSERVED — confirmed** |
| 4 | `metrics_http` is loopback-confined | `readonly_client.py:39` (`ALLOWED_METHODS = {GET, HEAD}`), `:41` (`ALLOWED_HOSTS = {localhost, 127.0.0.1, ::1, [::1]}`), `:43-49` (`ALLOWED_PATHS` = `^/api/v1/status/metrics$`, `^/api/v1/status$`), `:52` body keywords refused, `:120-126` unknown kwargs refused, `:146-176` `sys.addaudithook` aborts non-loopback `socket.connect`/`socket.getaddrinfo`, `:76` the single socket site | **OBSERVED — confirmed** |
| 5 | `DEFAULT_BASE_URL = http://localhost:3001`; provider endpoint is the literal placeholder | `readonly_client.py:54`; `:60` `PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"`; mirrored at `ROUTINE-DESIGN.md:190-191,422` | **OBSERVED — confirmed** |
| 6 | `degraded = True` is a hard-coded literal in two places, not derived from the source | `changedetect.py:168` (`"degraded": True,` — after `available = bool(source.get("data_available", True))` at `:154`, i.e. deliberately not derived); `run_daily_check.py:98` (inside `observed_for()`, no parameter can change it) | **OBSERVED — confirmed** |
| 7 | `metrics_http` declares `data_available=True` unconditionally, on the success path | `run_daily_check.py:72` — the dict returned by the `metrics_http` branch hard-codes `"data_available": True` before the HTTP read is even attempted (`:66-67`); failure raises out of `read_status_source` and lands in the `READ_FAILED` path at `:373-393` | **OBSERVED — new finding (round 2)** |
| 8 | **No process in the repo serves the two allowlisted paths** | `grep -rn "v1/status" server/src` → **no output (empty)**; repo-wide `grep -rn "status/metrics"` (excluding `node_modules`/`.git`/`__pycache__`) returns hits only in `monitoring/freecash/` (client + tests), one stale script, and documentation — never a server route | **OBSERVED — new finding (round 2)** |
| 9 | The allowlisted port is dead: nothing is listening | three loopback probes failed with `curl: (7) Failed to connect to localhost:3001` (§8) | **OBSERVED — new finding (round 2)** |
| 10 | `paths.py` defaults the state root to `D:/AgenticOS/data/freecash-monitor`; `data/freecash/` is the other root and is empty | `paths.py:35` (`DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"`), `:37` subdir list, `:45-48` env override `FREECASH_DATA_ROOT`; `ls data/freecash/` → only `.`/`..` | **OBSERVED — confirmed** |
| 11 | `paths.py:17` cites a `README.md` that does not exist | `ls monitoring/freecash/README.md` → `No such file or directory`; citation is at `paths.py:17` (`#   \`-- operator-state.json      operator-entered daily figures (see README.md)`) | **OBSERVED — new finding (round 2); documentation defect, no runtime effect** |
| 12 | R1 is enforced by an atomic exclusive-create day lock and today's single read is already consumed | `gate.py:119-128` (`os.open(str(lock), os.O_CREAT \| os.O_EXCL \| os.O_WRONLY)`); `data/freecash-monitor/state/day-locks/2026-09-20.lock` exists (0 bytes, 2026-09-20 21:08); `state/last-run.json` → `last_success_day 2026-09-20`, `last_outcome MONITOR_DEGRADED` | **OBSERVED — confirmed; any further read today is an R1 violation by construction** |
| 13 | R4 holds: no execution path anywhere; approval items are frozen handles | `approval_queue.py:44` (`EXECUTION_STATE_NOT_EXECUTED`), `:132-133` and `:181-182` (`execution_state` re-frozen to `NOT_EXECUTED`, `execution_allowed_by_this_routine` always false); `:161` `decide()` records a human decision and re-freezes both fields; `:52` `ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"` is a schema label, not a call | **OBSERVED — confirmed** |

### 1.1 Gate evidence produced *in this session* (nothing carried)

| Gate | Exact command | Verbatim observed result |
|---|---|---|
| Suite (R1–R4 behaviour, temp data root) | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0` · exit `0` |
| R2 static scanner (python twin) | `python monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` · `[verify_readonly] PASS - no unexempted write/earning token found.` · exit `0` |
| R2 static scanner (shell twin, path confirmed to exist first) | `bash docs/free-cash-monitor-routine/verify-readonly.sh` | `[verify-readonly] forbidden=0 exempt=28 missing_targets=0` · `[verify-readonly] PASS — no unexempted write/earning token found.` · exit `0` |
| Live state root untouched by these runs | `ls -la data/freecash-monitor/state/operator-state.json data/freecash-monitor/alerts/alerts.jsonl` | both still `21:08` — the tests redirect via `FREECASH_DATA_ROOT` (`tests/_support.py:29,53`) |

Note the suite's own transcripts confirm both branches exist and behave: `RUN_OK … outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)` and, with a populated fixture, `RUN_OK … outcome=INITIAL_BASELINE source=operator_entered(data_available=True)` followed by `outcome=EARNINGS_CHANGED`.

---

## 2. Prior art — one-line inherit / supersede decisions

| Artifact | Decision |
|---|---|
| `docs/free-cash-monitor-routine/RESEARCH-PLAN-V4.md` | **SUPERSEDE as plan** — its design/verifier-trust content is retained by reference, but its research question list and option ranking are replaced by §5–§7 here. |
| `docs/free-cash-monitor-routine/PROVIDER-DECISION-PACKET-2026-09-20.md` | **INHERIT** — its §2 options O1–O7 and §4 VERIFIED/COULD-NOT-VERIFY register are the evidence base for the provider half of the blocker; this plan does not re-fetch any provider page. Its §6 recommendation is **narrowed** by §5 here (O1 is now shown to require net-new server work, not a config change). |
| `docs/free-cash-monitor-routine/PROVIDER-FINDINGS-REVERIFIED.md` | **INHERIT** — authoritative evidence register for freecash.com automated-access prohibition; no new provider fetch was permitted in this pass. |
| `docs/free-cash-monitor-routine/PROVIDER-CONTRACT-RESEARCH-V2.md` | **INHERIT (evidence), SUPERSEDE (closure claim)** — it claims to close `PROVIDER_ENDPOINT_UNKNOWN`; `readonly_client.py:60` still carries the literal and `server/src` has no matching route, so the literal stays open per §10. |
| `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md` | **INHERIT** — its verdict (no live read-only provider source; account identity unverifiable from the repo) is the premise of §5 Candidate C. |
| `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` | **INHERIT unchanged** — design contract; §5 of this plan may not contradict it. |
| `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` | **INHERIT unchanged** — gate contract, still unsigned; §8 supplies the observations this pass is permitted to make. |
| `docs/free-cash-monitor-routine/DELEGATION-2026-09-20/RESEARCH-PLAN.md` | **SUPERSEDE** — same blocker, same three candidates, but superseded because (i) it predates the observed death of the `metrics_http` path, (ii) it treats the local-metrics route as "stand up a service" without noting the routine's own `data_available=True` hard-code (`run_daily_check.py:72`) that would mislabel such a service's output, and (iii) its option ranking is restated here with the deviation column. |
| `docs/free-cash-monitor-routine/verify-readonly.sh` | **INHERIT unchanged** — gate tool; executed in this session (exit 0). |

**Supersession candidates (listed, not edited, not read as authority):** `daily-status-monitoring-specification.md`, `free-cash-finance-monitoring-specification.md`, `free-cash-finance_monitoring_plan.md`, `DAILY_MONITORING_DESIGN_SUMMARY.md` (all four confirmed present at repo root by `ls -la`, dated 2026-09-11), plus `docs/free-cash-monitor-routine/{AUDIT-RULE-COMPLIANCE,DAILY-MONITORING-WORKFLOW-AND-RESEARCH-PLAN,DELEGATED-WORKFLOW-PLAN,DELEGATION-RESEARCH-PLAN,DELEGATION-WORKFLOW-PLAN,IMPLEMENTATION-PLAN-V3,OPERATIONS-WORKFLOW-PLAN,RESEARCH-PLAN,WORKFLOW-PLAN-FC-FINANCE-AUTOMATION,WORKFLOW-PLAN-V4}.md` and `docs/free-cash-md`-adjacent `docs/free-cash-finance-automation-workflow-plan.md`. The legacy executable `scripts/monitoring/free-cash-daily-check.py` **exists** (confirmed, 11024 bytes, 2026-09-11) and is pointed at the non-existent `/api/v1/status/metrics` route — park/retire, do not repair.

---

## 3. Decision criteria — how a candidate source is judged

| Criterion | Meaning | Falsifiable test |
|---|---|---|
| C1 Rule-compliance | R2-clean by construction, no execution path, one read/day | `verify_readonly.py` + `verify-readonly.sh` → `forbidden=0`; transport proof in suite |
| C2 Populatability | Data can actually reach the routine today | a run yields `data_available=True` and non-null money fields in `snapshots/<day>.json` |
| C3 Observes the account | The numbers come from the provider account itself, not a substitute | the snapshot's source note traces to the account, and `degraded` is *derived*, not literal |
| C4 Zero invented contract | No hostname, path or field name enters the repo unverified | grep for the placeholder; no fabricated endpoint in source |
| C5 Operator cost | Minutes/day the human must spend | measured, not estimated |
| C6 Reversibility | Can be withdrawn without breaking R1–R4 | `git`-clean removal; no scheduler coupling |

---

## 4. The candidate matrix (verdicts)

| Candidate | C1 compliant | C2 populated | C3 observes account | Verdict |
|---|---|---|---|---|
| **A — `operator_state`** (operator types today's four figures into `state/operator-state.json`) | **Yes** — no socket, no credential (`operator_state.py:1-14`, `READ_OPS = []` at `:46`) | **No — empty today**: `"records": []` (OBSERVED). Populatable in ~60 s by the operator: the file ships its own instructions (`operator_state.py:68-73`, `:76-88`) | No — `kind = "operator_entered"`, and snapshots stay `degraded: true` by literal | **SELECTED as the only workable source. It is the answer to the blocker's first half.** |
| **B — `metrics_http`** (loopback substitute at `DEFAULT_BASE_URL`) | **Yes** — loopback-only allowlists + audit hook (§1 row 4) | **Impossible today, and not merely "down"**: no process serves the paths (`grep "v1/status" server/src` → empty); port 3001 refuses connections (curl exit 7); the only prior evidence is the legacy script's own failure log (CARRIED: `DELIVERY-PLAN-OPTIONS.md:185-188`) | No — documented in-source as "local substitute metrics (degraded)" (`readonly_client.py:16-25`) | **NOT SELECTED for this blocker.** Standing up a substitute service adds a second unpopulated path and, because of `run_daily_check.py:72`, would report `data_available=True` on numbers that never touched the account — the exact silent-false-confidence failure mode. |
| **C — provider read API** | Conditional — would require widening `ALLOWED_PATHS`/`ALLOWED_HOSTS`, i.e. relaxing the single process-wide R2 control | n/a — no endpoint, no credential (`provider_credentials` = **0 rows**, OBSERVED) | Yes, if it existed | **CLOSED for now on evidence** (CARRIED: `PROVIDER-FINDINGS-REVERIFIED.md` — the named platform prohibits automated access including monitoring; `PROVIDER-API-RESEARCH.md` — account identity unverifiable from the repo). Re-openable only by an operator-supplied written provider identity **plus** a documented read contract. |

**The routine's own representational defect (must be fixed alongside A):** `degraded` is a constant `True` (`changedetect.py:168`, `run_daily_check.py:98`) and `metrics_http` asserts `data_available=True` unconditionally (`run_daily_check.py:72`). Until `degraded` is derived from the source (`source.kind == "operator_entered"` → degraded; a verified provider read → not degraded) the routine cannot record "the account was observed" even after C3 is satisfied. This is the blocker's second half and it is code, not vendor access.

---

## 5. Work items (the plan)

Every item lists Effort · Time-to-Revenue · Dependencies · First Concrete Action. Time-to-Revenue is **none — unblocks revenue tracking** for all items: this routine reads status, it never earns; its revenue value is that it makes the `proj-free-cash` initiative's numbers observable.

### P0 — Operator populates today's figures (closes B1; the only path with no code change)

| Field | Value |
|---|---|
| Effort | 60 s operator time; 10 min for the reviewer to confirm from the snapshot |
| Time-to-Revenue | none — unblocks revenue tracking (turns "no data" into a real day-over-day series from tomorrow) |
| Dependencies | operator login (human, by hand — never scripted, per R2); **cannot produce a read today** because `day-locks/2026-09-20.lock` already exists (R1) |
| First Concrete Action | Operator appends one record with `day_key` = the next operator-local date to `D:/AgenticOS/data/freecash-monitor/state/operator-state.json` `records[]`, then the next daily run reports `INITIAL_BASELINE` |

### P1 — Derive `degraded` instead of hard-coding it (closes the representational half)

| Field | Value |
|---|---|
| Effort | 1–2 h builder + 30 min reviewer |
| Time-to-Revenue | none — unblocks revenue tracking (removes the false-confidence marker so a future verified read is distinguishable) |
| Dependencies | none in code; must not weaken `verify_readonly` gates. Touch `changedetect.build_snapshot` (`:168`), `run_daily_check.observed_for` (`:98`), and `run_daily_check.read_source` (`:72`) |
| First Concrete Action | Add tests that assert `degraded` is `True` for `operator_entered` and `False` only for a source whose kind is a verified provider read; run `python monitoring/freecash/tests/run_all.py` and require `failures=0` |

### P2 — R1-safe acceptance of P0 (prove the first populated run works end to end)

| Field | Value |
|---|---|
| Effort | 20 min; no production state touched |
| Time-to-Revenue | none — unblocks revenue tracking |
| Dependencies | P0 populated file; a **copy** of the state root under `$LOCALAPPDATA/Temp` with `FREECASH_DATA_ROOT` pointed at it and the day-lock copied/reset there |
| First Concrete Action | `FREECASH_DATA_ROOT=$LOCALAPPDATA/Temp/fc-r2 python monitoring/freecash/run_daily_check.py` against the copy only — never `data/freecash-monitor` |

### P3 — Retire the misleading surfaces (prevents a regression of this same blocker)

| Field | Value |
|---|---|
| Effort | 1 h (docs) + 20 min (decision to park the legacy script) |
| Time-to-Revenue | none — unblocks revenue tracking (indirect: stops future passes from re-deriving a dead endpoint as live) |
| Dependencies | operator sign-off to park `scripts/monitoring/free-cash-daily-check.py` (exists, confirmed; targets a route that exists nowhere) |
| First Concrete Action | Replace the `paths.py:17` `(see README.md)` citation with the in-repo `how_to`/`template_record` reference (`operator_state.py:68-88`), and add "do not invent `/api/v1/status/metrics`" to the routine's own header |

### P4 — Provider re-opening gate (only if the operator supplies an identity)

| Field | Value |
|---|---|
| Effort | 3–5 h research + human endpoint verification **before** any code (CARRIED from `PROVIDER-DECISION-PACKET-2026-09-20.md` §2 O1/O6 scope) |
| Time-to-Revenue | none — unblocks revenue tracking |
| Dependencies | (a) operator's written provider identity + whether a documented read contract exists; (b) a credential policy that keeps the allowlist, not the token, as the control; (c) explicit operator amendment if any widening of `ALLOWED_HOSTS`/`ALLOWED_PATHS` is required |
| First Concrete Action | Operator writes the provider name and the read-contract URL into the decision record; **no** hostname enters `readonly_client.py` before a human has fetched that URL and confirmed the response shape |

### Backlog coupling (context only — not this plan's deliverable)

| Observed | Implication |
|---|---|
| `server/data/agentic-os.db` → `projects.proj-free-cash` = `active`, priority `1`, tags `["revenue","free_cash","p1"]` | the initiative exists; the monitor is the observability half |
| `schedules.schedule-revenue-supervisor-tick` = cron `*/5 * * * *`, `enabled=1`, `last_triggered_at 2026-09-19T18:05:00.070Z`, `routine-revenue-supervisor` (`approval_policy = read_only_auto`) | a supervisor tick already runs unattended on a 5-minute cadence; it is not the daily monitor and must not be repurposed as one (R1) |
| `background_tasks.bgtask-07a8154b0` "Revenue Operator: Free Cash Mission" = `blocked`, `resumable=0`, blocker "Backend restarted while this task was in progress…" | separate, unrelated blocker; do not fix here |
| `provider_credentials` = **0 rows** | Candidate C has no credential today; nothing to read |

---

## 6. Verification protocol (human confirms before code is written)

1. Populated source (P0): the operator's own eyes on their own dashboard; the reviewer confirms only by reading `snapshots/<day>.json` — `data_available: true` with four integer/`null` money fields and a `raw_response_sha256` that is not the empty-body hash `e3b0c442…b855`.
2. Derivation fix (P1): a failing test first (`degraded` must be `False` for a synthetic verified source), then `run_all.py` → `failures=0`.
3. Any provider widening (P4): human performs the GET by hand and records the observed status/body shape; only then is one allowlist line added with a justification comment.
4. Every gate claim in this plan is re-runnable verbatim from §1.1; no gate is quoted from an earlier pass.
5. Anti-fabrication: any file cited must be `ls`-confirmed in the same pass that cites it. This pass's §2 row 11 exists precisely because a citation was checked and found wrong.

## 7. Credential-handling policy (unchanged, restated for the record)

No credential is read, requested, written or logged by this routine; `operator_state`'s `READ_OPS = []` and `readonly_client`'s loopback allowlist mean no secret can be consumed. If a provider read ever becomes legitimate, the token is supplied out-of-band by the operator and env-var **names** only may appear in docs (CARRIED policy, `PROVIDER-CONTRACT-RESEARCH-V2.md`).

## 8. Network actually performed by this pass (loopback only)

| # | Command | Observed result |
|---|---|---|
| 1 | `curl -sS -m5 -o /dev/null -w 'GET metrics http=%{http_code}\n' http://localhost:3001/api/v1/status/metrics` | `curl: (7) Failed to connect to localhost:3001` · `http=000` · `exit=7` |
| 2 | `curl -sS -m5 -I http://localhost:3001/api/v1/status` | `curl: (7) Failed to connect to localhost:3001` · `exit=7` |
| 3 | `curl -sS -m5 -o /dev/null -w 'GET root http=%{http_code}\n' http://localhost:3001/` | `curl: (7) Failed to connect to localhost:3001` · `http=000` · `exit=7` |

Expected failure, recorded as failure. No provider call, no credential, no authenticated endpoint, no signup was performed.

## 9. UNRESOLVED register (nothing here may be asserted as fact)

| # | Item | Why unresolved | Owner |
|---|---|---|---|
| U1 | Which provider holds the monitored account (identity, jurisdiction) | not derivable from the repo; no credential row exists | operator (written answer) |
| U2 | Whether the operator is willing to type four figures per day | behavioural, not technical | operator |
| U3 | Whether any provider read contract exists for U1 | depends on U1 | research (P4) |
| U4 | Whether the local metrics route should ever be built as a *substitute* | depends on U1/U3; building it first risks the C3 failure mode | operator + builder |

## 10. Definition of done

The blocker is closed when **all** hold, each with a recorded observation:

1. `snapshots/<day>.json` exists for two consecutive days with `data_available: true` and non-null money fields.
2. A distinct change produces exactly one notification and one `PENDING` / `NOT_EXECUTED` approval item (R3, R4) — no second notification for the same `dedupe_key`.
3. `verify_readonly.py` and `verify-readonly.sh` both print `forbidden=0` with `missing_targets=0`, and `run_all.py` prints `failures=0 errors=0`.
4. `degraded` is derived, not literal: the marker is `True` for `operator_entered` and provably `False` for a verified provider source (P1).
5. `day-locks/` shows one lock per operator-local day, no gaps unexplained, and no second lock for the same day (R1).

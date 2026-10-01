# Free Cash Finance Automation — Workflow Plan v3 (constraint-first, live-grounded)

Repository: `D:\AgenticOS` · Host: Windows 11, git-bash/MSYS · Written: 2026-10-01 09:2x local (Europe/Berlin, UTC+02:00)
Status: **PLAN ONLY.** This pass wrote exactly one new file (this one). No source file touched, no day lock
created, no snapshot/alert/approval written to the real data root, nothing scheduled, no provider contacted.
Pinned interpreter for the routine: `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe`
(3.11.9, resolves `Europe/Berlin`).

Supersedes for planning purposes: `docs/freecash-automation-workflow-plan-v2.md` (2026-09-17, written against
the 7 dead implementations) and `free-cash-automation-workflow.md` (2026-09-11, whose monitor does not parse).
The canonical runtime it plans against is `monitoring/freecash/`.

---

## 1. Live state, re-measured this pass (every line is tool output, not recollection)

| Item | Live result | Verdict |
|---|---|---|
| Canonical runtime | `monitoring/freecash/`: `run_daily_check.py`, `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `operator_state.py`, `readonly_client.py`, `paths.py`, `watchdog.py`, `verify_readonly.py`, 52-test suite | ONE executable path exists |
| Test suite | `python monitoring/freecash/tests/run_all.py` → `tests=52 failures=0 errors=0 skipped=0` | GREEN (green does not mean "has run in production") |
| Static read-only audit | `python monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0` … `PASS` | GREEN |
| Today's day key | `state/day-locks/2026-10-01.lock` exists (created 08:53 local); `snapshots/2026-10-01.json` written with `data_available=false` and every figure `null` | **2026-10-01 IS BURNED — no reading is possible today without breaking the once-per-day rule** |
| Ledger | `last-run.json`: `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED` | **False success**: a day with no reading is booked as covered, so `watchdog.py` prints `WATCHDOG_OK` |
| Root cause (unchanged in the live file) | `run_daily_check.py:308-309` resolves the day key and takes the lock **before** `read_source(...)` at `:372` | Lock-before-read defect still present |
| Real data source | `operator-state.json` → `records: []`; the template record is the only content. Last real reading: 2026-09-20 | 11 days with no human reading; R3 has never fired on real data |
| Read-source alternative | `metrics_http` targets `http://localhost:3001` → `curl` = `000` (nothing listening). Backend at `:4600` is healthy (`200`, version 9.0.0, gitSha `8f7463aa`, tree dirty) but is not the allowlisted metrics source | Only usable source today = operator-entered file |
| Notification sink | `notify.py` dispatches a Windows toast; `state/notified-keys.json` records `delivery: TOAST_OK` (2026-09-21, 2026-09-30) | A sink IS bound and works; SMTP is opt-in/off. "No channel bound" claims in earlier briefs are wrong on the toast path |
| Approval queue | `data/freecash-monitor/approvals/` is EMPTY; no `pending.json` | R4 has never enqueued anything in production |
| Approval identity guard | `approval_queue.py` denies ten literal words (`agent`, `bot`, `cron`, …) — a denylist; `hermes-agent`, `assistant`, `claude` pass it | Bypassable; a decision was recorded as `decided_by='hermes-agent'` |
| Scheduling | `cronjob_manage list` → `count: 0`; `schtasks /query /tn FreeCash-Daily-Monitor` → "file not found" | **NOTHING IS SCHEDULED.** The routine only runs when a human types it |
| Scheduler artifacts | `DELEGATION-2026-10-01/scheduler/FreeCash-Daily-Monitor.xml`, `…-Missed-Day-Watchdog.xml`, `freecash-guarded-run.sh` (sandbox-only runner), `SCHEDULER-DECISION-V2.md` | Designed, **deliberately not registered** (registration is R4 territory) |
| Provider | `readonly_client.ALLOWED_HOSTS` = loopback only; `ALLOWED_PATHS` = two local paths; `PROVIDER_ENDPOINT_UNKNOWN` verbatim; `grep -c FREECASH .env server/.env` → `0`/`0` | Provider reads are BLOCKED — no contract, no credentials, two-line allowlist change needed |
| Git | `git ls-files \| grep -c freecash` → `0`; `monitoring/` untracked; tree carries ~unrelated modified files (`electron/main.ts`, `server/src/domains/controlPlane/*`, …) | All Free Cash work is untracked; those unrelated edits must not be disturbed |
| Dead overlaps | `server/scripts/freecash-daily-monitor.mjs` (fails `node --check`), `server/scripts/verify-freecash-rules.mjs` (tautological 4/4), `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/tasks/daily-finance-monitor.py`, `finance-monitor/` | Keep archived as evidence; do not resurrect |

Net: the pipeline is **executable, tested, honest about being degraded — and never scheduled, and its one real
input (a human reading) has been empty for 11 days.** Today is consumed, so the first possible real reading is
2026-10-02.

---

## 2. Binding operational constraints

Rule numbering: this document uses the **operator numbering** and always names the rule, per the
`VERIFIER-PLAN-V2` numbering warning — the shipped code's docstrings and `DELEGATION-BRIEF-R2.md` invert R1/R2.

| ID | Constraint | Enforcement point (what fails if it is broken) |
|---|---|---|
| C1 | **No automated earning action.** Never transact, withdraw, cash out or spend. | `readonly_client.request()` refuses non-GET/HEAD, any body keyword, any non-loopback host, any non-allowlisted path; `verify_readonly.py` grep gate stays at `forbidden=0` |
| C2 | **Exactly one status read per operator-local calendar day**; a duplicate run consumes nothing. | Atomic `O_CREAT\|O_EXCL` day lock; the second run must print `SKIP_DUPLICATE_DAY` and write nothing |
| C3 | **Notify only on a change** in earnings or account status; no change → no notification. | Prior snapshot loaded **before** the new one is written; one dedupe key per change recorded before dispatch |
| C4 | **Human approval before ANY external action.** The monitor may only queue. | Approval queue stores `execution_state=NOT_EXECUTED`, `expires_at_utc=None`; no code path acts on an approved status |
| C5 | **Evidence = live tool output.** No PASS carried over from an earlier run, no static-grep verifier. | Each step ends with a re-executed command; a verifier is trusted only after it has been shown to FAIL on a known violation |
| C6 | **No secrets in any artifact, log or chat.** Credentials via env only; `[REDACTED]`. | `grep` for secret shapes before any doc is accepted |
| C7 | **Do not disturb unrelated uncommitted work.** Additive only; new files only. | `git status --short` identical before/after, except newly written docs |
| C8 | **One executable path per job.** No eighth parallel implementation. | Audit (`ls`/`node --check`/`py_compile`) before adding anything |
| C9 | **Sandbox isolation when testing.** Execution must pin `FREECASH_DATA_ROOT` to a throwaway root, and must refuse to run unset. | `schtasks`-visible proof: `find <prod root> -type f -newermt "<today> 00:00"` → zero; `sha256` of `last-run.json` + `alerts.jsonl` unchanged |
| C10 | **Registering a scheduler entry is itself an external action** (R4 territory) — it is produced as an artifact for human approval, never executed by an agent pass. | Only the human runs `schtasks /create /xml`; the proof of firing is the day-key artifact, not the task list |
| C11 | **Degraded is not success.** A day with no reading must not advance coverage. | `MONITOR_DEGRADED` must be removed from `SUCCESS_OUTCOMES` (`gate.py:32-41`) or the watchdog must read the snapshot's `data_available`, not the ledger |
| C12 | **No back-fill.** A missed day is reported, never re-read. | `gate.missed_days()` excludes both today and the last success; `--force-recheck` exits 3 and is audited |

---

## 3. The workflow plan

Ordering rule: nothing downstream is testable until the day-consuming ordering is fixed and a real reading
exists. Effort and revenue figures below are planning estimates, not measurements; "Time-to-Revenue" means
time until the routine delivers its business value (visibility + an audit-ready trail), since C1 forbids money
movement by the routine at all.

### S0 — Pre-flight guard (do this before anything else today/tomorrow)
| Field | Value |
|---|---|
| Expected Effort | 1–2 h |
| Time-to-Revenue | Immediate, negative-cost: stops further days being burned |
| Dependencies | none (new wrapper file only, under `monitoring/freecash/` or `docs/…/scheduler/`; reuse `freecash-guarded-run.sh`, do not rewrite it) |
| First Concrete Action | Write a pre-flight wrapper that exits non-zero **without** invoking `run_daily_check.py` when (a) `FREECASH_DATA_ROOT` is unset or equals the production root, or (b) `operator-state.json` has no record for today's day key. Prove both refusals and one control run against a throwaway root in a single pasted block, then `sha256sum` the real root's `last-run.json` + `alerts.jsonl` before/after (C9). |

### S1 — Fix the lock-before-read ordering (the one real defect)
| Field | Value |
|---|---|
| Expected Effort | 2–3 h including tests |
| Time-to-Revenue | Immediate: converts the routine from "consumes days without readings" to "consumes a day only when it has a reading" |
| Dependencies | S0; the 52-test suite; `gate.py`, `run_daily_check.py` only |
| First Concrete Action | In `run_daily_check.py`, resolve the day key and read the **local** source (`operator_state`) before `gate.acquire_day_lock(day)`; keep the lock **before** any socket so `metrics_http` can never read twice. Then add the regression test the suite lacks — "run with no record → no lock file created, no snapshot written, exit non-zero" — and paste `run_all.py` output showing the new test name and `failures=0`. |

### S2 — Stop booking degraded days as covered
| Field | Value |
|---|---|
| Expected Effort | 1–2 h |
| Time-to-Revenue | Immediate: the watchdog stops lying about coverage |
| Dependencies | S1; `gate.py:32-41` (`SUCCESS_OUTCOMES`), `watchdog.py:25-44` |
| First Concrete Action | Remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` (or make `watchdog.evaluate()` require the day's snapshot to have `data_available=true`), then re-run `watchdog.py` on today's real ledger and paste the output showing it now reports **not covered** for 2026-10-01 instead of `WATCHDOG_OK`. |

### S3 — Make the human reading the first-class step, and schedule around it
| Field | Value |
|---|---|
| Expected Effort | 30–60 min/day habit + 1 h doc; scheduler registration 30 min (human) |
| Time-to-Revenue | First truthful R3 signal on the first day after both the reading and the scheduler exist (earliest 2026-10-02) |
| Dependencies | S0–S2; a human reading entered in `state/operator-state.json`; **human approval to register** (`FreeCash-Daily-Monitor.xml`, `…-Missed-Day-Watchdog.xml` exist unregistered) |
| First Concrete Action | Enter tomorrow's four figures (status, earnings, balance, pending, integer cents) in the morning, run `run_daily_check.py` once against the real root and paste `RUN_OK … outcome=INITIAL_BASELINE`; only then hand the XML files to the human with the exact `schtasks /create /xml` line for approval under C10. |

### S4 — Harden the approval identity guard (R4)
| Field | Value |
|---|---|
| Expected Effort | 2–3 h |
| Time-to-Revenue | No direct revenue; closes the "only a human can sign" claim, which is what makes the queue usable as evidence |
| Dependencies | S1; a proposed-patch diff already exists (`DELEGATION-2026-10-01/delivery/proposed-patch-approval-identity-V2.diff`) |
| First Concrete Action | Replace the denylist with an operator-editable allowlist (`state/human-deciders.json`) and prove **both directions in one run**: `hermes-agent` refused, the operator's name accepted — pasted output, plus the frozen-field assertion (`execution_state=NOT_EXECUTED`, `expires_at_utc=None`) surviving even a bad decider. |

### S5 — Replace the decoy verifier with a falsifiable gate (R1–R4)
| Field | Value |
|---|---|
| Expected Effort | 4–6 h |
| Time-to-Revenue | No direct revenue; removes the false-GREEN class that produced every "COMPLIANT" claim in this repo |
| Dependencies | S1, S2; the 2026-09-30 `rule_gate.py` (mutation-tested) and `VERIFIER-PLAN-V2` §4 gaps H1/H2/H4/H5/H6/H7 closed |
| First Concrete Action | Extend `rule_gate.py` with the V2 checks, then run it against a **planted violation per rule** and paste four non-zero exits; a run that only says `PASS` is not acceptance (C5). |

### S6 — Resolve the provider read contract (W3/W4)
| Field | Value |
|---|---|
| Expected Effort | 3–5 days, unknown-unknowns heavy |
| Time-to-Revenue | **BLOCKED.** No self-serve earning endpoint is publicly documented; `agenticos` loopback substitute is dead (`:3001` → `000`). Until resolved, the operator-entered file is the permanent, plainly-labelled source |
| Dependencies | A documented read-only contract for the chosen provider; credentials as env only (C6); **two-line** allowlist change (host **and** path — a path alone is still refused at the host check); `read_metrics()`/`probe_status()` currently pass no headers, so credential plumbing does not exist yet |
| First Concrete Action | One manual, human-driven, read-only request in a browser/devtools session to whichever provider account exists; record status code + field names with `[REDACTED]` values. If no documented read-only contract exists, close the gap honestly as UNRESOLVABLE and keep `operator-state.json` as the source. |

### S7 — Prune the dead implementations (after S1–S5 are verified)
| Field | Value |
|---|---|
| Expected Effort | 1 h |
| Time-to-Revenue | None; removes the surface that lets "4/4 PASSED" be claimed on a file that cannot parse |
| Dependencies | C7 (all untracked → move, never delete without approval); S1–S5 verified first |
| First Concrete Action | Move `server/scripts/freecash-daily-monitor.mjs`, `server/scripts/verify-freecash-rules.mjs`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/tasks/daily-finance-monitor.py`, `finance-monitor/` to `_archive/freecash-legacy/` with a one-line reason file each, and correct the false "COMPLIANT" table in `server/data/freecash-monitor/INTEGRATION_STATUS.md`. |

### Revenue-side options (separate pipeline; carried from earlier plans, not re-derived here)
| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| R-A Monitoring-as-a-template (sell the 4-rule pattern) | 8–16 h | Month 1–2 | S1 + S5 (a working, failure-provable artifact) | Only after S5: list the corrected monitor plus a verifier that demonstrably fails on violations |
| R-B Earning-account visibility only | 2–4 h/month ongoing | First real signal on the first day after S1–S3 | S1–S3, S6 | Once a reading exists, let the daily diff (R3) surface the first actual change; the routine still never moves money (C1) |
| R-C Micro-SME SaaS (`opp-4a3f4cfc`, `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md`) | 40–80 h to MVP | Month 6–9 as written there; beta Month 3–5 | Domain registration (external spend), payment processor approval, a real data layer (S6) | Human decides on the domain spend; the projections in that file are inherited, unvalidated here |

---

## 4. Verification gates (each must pass on live output, in this order)

- G1 Pre-flight refuses with `FREECASH_DATA_ROOT` unset and refuses on a day with no operator record; a control run against a throwaway root succeeds. (today: no wrapper exists)
- G2 A run on a day with no reading creates **no** lock, **no** snapshot, and exits non-zero. (today: FAILS — 2026-10-01 lock exists with a null snapshot)
- G3 Second invocation on the same day prints `SKIP_DUPLICATE_DAY` and writes nothing. (currently passes)
- G4 `watchdog.py` reports **not covered** for a degraded day. (today: FAILS — prints `WATCHDOG_OK`)
- G5 A real operator reading produces `INITIAL_BASELINE`, and the next day's change produces exactly one notification, one dedupe key, one approval item.
- G6 The rule gate exits non-zero on a planted violation for every rule, and `verify_readonly.py` stays `forbidden=0`.
- G7 The scheduled task fires unattended and writes the day-key lock; `find <prod root> -type f -newermt "<today> 00:00"` shows only the intended artifacts; `git status --short` shows no pre-existing modification reverted.

## 5. Ordering rationale

S0 → S1 → S2 (stop the bleeding: days are being consumed and the coverage signal is false) → S3 (make the
human reading and the schedule real, oldest revenue-side prerequisite) → S4/S5 (make the safety claims
falsifiable) → S6 (the only step that can produce a real earnings signal; blocked on a human and possibly
impossible) → S7 (archive only once a replacement is verified). Revenue options wait for S1–S5; otherwise they
inherit a pipeline whose Rule 3 has never fired on real data.

## 6. Out of scope / not claimed

- No provider is connected; no balance, earnings or account status has been read from any real account.
- No external action is proposed by this plan; every write path stays behind the C4 approval gate, and
  registering a scheduler entry is left to the human (C10).
- Nothing was scheduled, no lock created and no production state written by this pass.
- The `opp-4a3f4cfc` revenue projections are carried over as written by the earlier plan, not validated here.

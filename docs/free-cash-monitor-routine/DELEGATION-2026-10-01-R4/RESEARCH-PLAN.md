# RESEARCH PLAN — daily status monitoring routine, Free Cash Finance Automation (R4)

**Repository:** `D:\AgenticOS` · **Branch:** `hermes-rescue-20260908` · **HEAD:** `8f7463a`
**Written:** 2026-10-01, 11:36–11:48 operator-local (Europe/Berlin, UTC+02:00)
**Companion:** `DELEGATION-BRIEF-R4.md` (same directory) — this file carries the *questions and decisions*; the brief carries the *streams, acceptance bars and isolation rules*.
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` (3.11.9, has `tzdata`).
**Rules under research:** R1 no earning action automatically · R2 check status once per day · R3 notify on earnings or status change · R4 human approval before any external action.
**Numbering note:** always carry the rule **title** with the number — the shipped code's docstrings invert R1/R2 relative to the operator list (§1 of the brief).

---

## Purpose

The routine is built, runnable and green offline: 52/52 tests pass in a throwaway root, the read-only scanner passes at baseline 28, a duplicate day is refused, and the evidence trail is real (brief §2 A7, A8, A13). What does **not** exist is any evidence that the routine *does its job for the operator*: no reading has ever been entered, no change has ever been notified, nothing triggers it, and this morning it consumed the production day on a null read while booking that null read as a success.

This research plan therefore asks the questions whose answers decide whether the routine may be trusted, scheduled, and pointed at a real account — and it states, for each option, **Expected Effort**, **Time-to-Revenue**, **Dependencies** and a **First Concrete Action**.

---

## RQ-1 — Day budget: is R2 a cap, a floor, or both? *(blocks everything)*

**The defect, measured:** a run with no reading still acquires the day lock, writes a null snapshot, sets `last_outcome=MONITOR_DEGRADED`, and — because `MONITOR_DEGRADED ∈ SUCCESS_OUTCOMES` (`gate.py:32-40`, `gate.py:198`) — advances `last_success_day` and resets `consecutive_missed_days` to 0, which makes `watchdog.py:33` print `WATCHDOG_OK`. Production proof: `2026-10-01.lock` exists at 08:53, `last_success_day=2026-10-01` with all four figures `null`, miss counter 9 → 0 (brief §2 A2, A3, A14, A15). R3's failing test re-confirmed by me: 6 of 7 assertions RED against the shipped package (A13).

**The design question this forces — and it is the operator's, not the agent's:** "once per day" can mean

- **(a) at most one read per day** — a cap. A data-less run legitimately spends the day; the null read is honest and the *only* bug is that it counts as success.
- **(b) exactly one read per day** — a cap **and** a floor. A day with no reading must remain *open*, so a later run that day can still read.
- **(c) a cap plus a "reading-required" precondition** — the routine refuses to start a day at all unless a reading is available, so the lock is never taken for a day that cannot be read.

**Why it matters:** under (a) a machine that is awake but has no operator reading burns every day, the miss counter never moves, and the watchdog stays silent — the exact production state today. Under (b) the lock must be released or never taken when `data_available=false`. Under (c) the *scheduler* becomes responsible for ordering the human reading before the run.

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **(a) cap only** — fix only `SUCCESS_OUTCOMES` | ~1 h (one-set edit + test re-run) | immediate: watchdog stops lying that same day | none | remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES`, re-run R3's 7 tests → expect the 2 success-advance tests to flip |
| **(b) cap + floor** — never take the lock when no reading is available | ~3–5 h (pre-flight probe + lock ordering + 6 test re-runs) | 1 day: first day that can still be read after a failed attempt | (a) landed first | gate the lock acquisition on a reading-availability probe performed **before** `O_CREAT\|O_EXCL` |
| **(c) reading-first precondition** — wrapper refuses the day when no record exists | ~4–6 h (wrapper + refusal evidence + scheduler ordering) | 2–3 days: requires the human reading to be routine | (b) + RQ-3's trigger decision | write a pre-flight that exits non-zero **before** the entry point when today's `operator-state.json` record is absent |

**Recommendation to the operator:** (a) is not optional — it is a correctness fix, and without it the watchdog's "covered" concept is meaningless. Choose **(b) vs (c)** on one question: *do you want the routine to stay silent on a day you did not read, or do you want it to tell you it could not read?* (c) is the answer if a missed day should be loud; (b) is the answer if you want a second chance later the same day.

---

## RQ-2 — Which gate is the acceptance gate of record? *(blocks the definition of "done")*

**Measured this pass:** three gates, three verdicts on the same tree.

| Gate | Scope | Verdict on shipped package | Verdict on R3's repaired package |
|---|---|---|---|
| `scripts/monitoring/rule_gate_verify.py` (the shipped one) | **file** (`run_daily_check.py`) | `R1=FAIL … NOT COMPLIANT 1/4`, exit 1 (A9) | not measured |
| `DELEGATION-2026-09-30/verifier/rule_gate.py --package` | package | `4/4 PASS`, exit 0 | `4/4 PASS`, exit 0 |
| `DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py` | package, 4 detectors, 10 mutants | `4/4 PASS` | `4/4 PASS`, exit 0 |
| `DELEGATION-2026-10-01/verifier/rule_gate.py` | package | `4/4 PASS` | **`R4 FAIL`, exit 1** (A11) |

**Research questions:** (i) Is the shipped gate's R1 FAIL a **true positive** (the package really has no atomic guard) or a **scope error** (the guard lives in `gate.py`, which the file-scoped gate never reads)? (ii) Why does the 2026-10-01 gate reject the repaired package while two others accept it — is the repair wrong, or is that gate's R4 detector a false positive? (iii) Which gate, if any, must CI run?

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **Adopt R3's package gate as the gate of record** | ~2 h (CI wiring + one mutant re-run) | same day | gate must be made reachable from the repo root | run it against the **repaired** package and against all 10 mutants; record both exits |
| **Fix the shipped gate's scope** | ~3–4 h | 1 day | none | diff `rule_gate_verify.py` to accept `--package`; show it still fails on a planted violation |
| **Retire the shipped gate** | ~30 min (delete + document) | same day | decision recorded | state in one sentence which gate CI runs and why the others are historical |

**Non-negotiable:** whichever gate wins must be shown to exit **non-zero on a planted violation** and **0 on the clean package**, in the same run that names it. A gate that only ever prints PASS is a tautology, and this repo already has one documented case of exactly that (`DELEGATION-2026-10-01/verifier/VERIFIER-PLAN-V2.md:24-40`).

---

## RQ-3 — What actually triggers the once-daily run?

**Measured:** nothing. `schtasks /query /fo LIST | grep -i "free.?cash"` matches nothing; `hermes cron list` → `No scheduled jobs.` (A17). R2's once-per-day property is currently enforced by a lock that no scheduler honours, and the machine may be asleep or the app closed at the trigger time.

**Research questions:** which route survives (a) a sleeping machine, (b) the Hermes desktop app not running, (c) a timezone/DST change, (d) the operator being away for a week? What is the operator-visible failure mode when the trigger does not fire — does a missed day still surface?

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **Hermes cron** | ~1–2 h | same day | Hermes must be running at trigger time | `hermes cron list` today; write the job definition **without registering**, dry-run its command in a scratch root |
| **Windows Task Scheduler** | ~2–3 h (XML + `schtasks /XML` validation) | 1 day | non-elevated rights; XML must parse | validate the existing `DELEGATION-2026-10-01/scheduler/DECISION-V2-*.xml` payloads with `ET.parse` **in the pass you cite them** (they failed on a raw `&` once) |
| **Manual / on-app-open** | ~30 min | same day | operator habit | document the command; prove missed-day detection still fires when the trigger is skipped for N days |

**Critical constraint from the measured state:** the trigger must be **off the critical path**. A trigger that fails to fire must degrade to a *missed-day alert*, never to a silent success. Today it degrades to a silent success (RQ-1), so **RQ-1 must land before any trigger is registered** — otherwise scheduling the routine *increases* the rate at which days are burned silently.

---

## RQ-4 — Does R3 (notify on change) work for a human at all?

**Measured:** `operator-state.json` → `records: []`. Every snapshot ever written is `data_available:false` with all four fields `null`. `notifications=0` on every run. `approvals/pending.json` never created. R3 has therefore **never fired in production** — it is unfalsifiable there.

**Research questions:** what is the minimum human-in-the-loop procedure that produces a real change notification? What is the cost of entering four figures per day, and is that cost acceptable as a permanent design or only as an interim until a wire source is live? Does the toast channel deliver when the desktop app is closed?

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **Operator-entered file (interim, rank 1 today)** | ~1 h to prove, ~2 min/day to operate | same day: first real baseline tonight, first change notification tomorrow | human enters 4 figures/day | scratch-root two-day proof: day 1 `INITIAL_BASELINE` + `notifications=0`; day 2 changed figure → exactly one notification, repeat run → deduped |
| **Provider read contract** | days–weeks, unbounded | weeks | provider credential + documented read endpoint + allowlist entry | confirm whether a read-only earnings endpoint exists **without** an earning/claim scope; if not, stop |
| **`GET /api/projects/:id/freecash/auth` on `:4600` (rank 2)** | ~4 h | 1 day | allowlist entry + new read op | curl it live; it yields **auth/session state only** — no earnings, no balance, so it cannot satisfy R3 alone |
| **`metrics_http` route** | — | **dead** | route does not exist | re-curl `:4600/api/v1/status/metrics`; expect **404** (A19) |

**Design consequence:** with only the operator-entered source, R3's comparison is a *manual* baseline. That is honest and rule-compliant (R1 is untouched — no socket, no credential, no claim), but the routine's value is proportional to the operator's discipline, not to its own reliability. The wire path should be researched **in parallel**, never assumed.

---

## RQ-5 — Can "only a human may decide" be made true?

**Measured:** the guard is a **denylist** of ten literal words (`approval_queue.py:55-57`, checked at `:153`) that refuses `agent`, `bot`, `cron`, `monitor` — and **accepts** `hermes-agent`, `assistant`, `claude`. A decision was previously recorded as `decided_by='hermes-agent'`.

**Research questions:** is the safety property (an approval can never arm an action) independent of the attribution property (only a human can sign)? What happens when the operator is unavailable and an item expires — must it stay `NOT_EXECUTED` forever?

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **Operator-editable allowlist** (`state/human-deciders.json`) | ~3–4 h | 1 day | R3's proposal already drafted | prove **both directions in ONE run**: `hermes-agent` refused, operator name accepted |
| **Freeze-and-queue only** (no decider guard at all) | ~1 h | same day | none | state the safety property alone: `execution_state=NOT_EXECUTED`, `execution_allowed=False`, `expires_at_utc=None` hold even for a bad decider |

**Do both.** The allowlist makes attribution true; the frozen fields make safety true regardless. A denylist makes neither.

---

## RQ-6 — Is the routine safe to leave running unattended for a week?

**Research questions:** what does the state root look like after 7 consecutive days with (a) a reading every day, (b) no reading at all, (c) a reading on day 4 only? Does `alerts.jsonl` remain honest under each? Does the approval queue accumulate or escalate? Does anything in `monitoring/freecash/**` write outside `FREECASH_DATA_ROOT`?

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **7-day simulated soak in a scratch root** (fake clock / sequential day keys) | ~3–4 h | 1 day | RQ-1 remedied first, else all 7 days are burned identically | run scenarios (a)/(b)/(c) and print `last-run.json` + `alerts.jsonl` line counts for each |
| **Real-time soak** (let production run 7 days after RQ-1 + RQ-3 land) | 7 days elapsed, ~30 min attention | 7 days | RQ-1, RQ-3 | do not start until the trigger decision is made — see RQ-3's constraint |

---

## Hand-off criteria (what the operator receives)

1. A **remedied package** (diff, not an edit) that turns 6 RED → 7 GREEN and keeps 52/52 green.
2. **One named acceptance gate** with: exit 0 on the repaired package, non-zero on every one of 10 mutants, and the one-sentence CI line.
3. An **allowlist identity guard** proven both directions in one run.
4. A **two-day offline proof** that R3 fires exactly once per change and dedupes the repeat.
5. A **trigger packet** (command, timezone argument, missed-day semantics, dry-run output) with nothing registered.
6. For every claim: the **command, exit code and raw output**, plus the production-root **pre/post hash pair** proving the work was hermetic.

Nothing above is self-applying. Each item is a **decision for the operator**; the delegation proposes, the operator disposes.

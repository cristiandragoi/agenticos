# Delegation Brief R2 — Free Cash Finance Automation, Daily Status-Monitoring Routine

**Repository:** `D:\AgenticOS` (branch `hermes-rescue-20260908`, HEAD `8f7463a`)
**Host:** Windows 11 (German-localised), git-bash, non-elevated
**Written:** 2026-10-01, 08:58–09:03 operator-local (Europe/Berlin, UTC+02:00)
**Delegation id:** `deleg_ca33759b` — 4 parallel background subagents
**Nature:** DESIGN ONLY. Nothing armed, nothing scheduled, no external action, no provider write.
**Relation to existing art:** additive. Does not supersede, edit or delete `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V9-2026-10-01.md`, its addendum, or `docs/free-cash-monitor-routine/DELEGATION-2026-10-01/` (a separate delegation, `deleg_fec45ca6`, running in the same hour). This is a distinct directory so nothing collides.
**Evidence standard:** every row of §1 is a command the parent executed in this pass. Facts carried from earlier sessions are labelled `inherited` and are not evidence.

---

## 1. Parent-verified live state (2026-10-01, 08:58–09:02 local)

| # | Command | Observed | Verdict |
|---|---|---|---|
| P1 | `date` | `Do,  1. Okt 2026 08:58:15` | clock of record |
| P2 | `ls docs/free-cash-monitor-routine/` | V9 (43 429 B, 08:50) + addendum (16 988 B, 08:48) + `DELEGATION-2026-10-01/` (08:55) already exist | two sessions are writing this plan set concurrently; R2 uses a distinct directory |
| P3 | `ls -1 data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock`, **`2026-10-01.lock`** | **today's day is already spent** — the routine ran at 08:53 local |
| P4 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `timezone=Europe/Berlin`, `last_attempt_at_utc=2026-10-01T06:53:46Z` | a day with **no reading** is booked as a success day |
| P5 | `ls -la data/freecash-monitor/snapshots/` | `2026-09-20.json`, `2026-09-30.json`, `2026-10-01.json` — all 518 B | all three are null-shaped snapshots (see P6) |
| P6 | `tail -5 data/freecash-monitor/alerts/alerts.jsonl` | newest line: `event_type=MONITOR_DEGRADED`, `"degraded": true`, all four figures `null`, `"source": "operator_entered"`, `"prior_day_key": "2026-09-30"`, `ts_utc=2026-10-01T06:53:46Z`; preceding lines: `MISSED_DAY` for 09-28 and 09-29 (`severity=alert`), `SKIP_DUPLICATE_DAY` for 09-30 | the reading does not exist; R3 has never had two comparable days |
| P7 | `ls -1a data/freecash-monitor/approvals/` | only `.` / `..` | no approval item has ever existed |
| P8 | `find data/freecash-monitor -type f -newermt "2026-10-01 00:00"` | exactly 4 files, all stamped 08:53:46 (`day-locks/2026-10-01.lock`, `snapshots/2026-10-01.json`, `alerts/alerts.jsonl`, `state/last-run.json`) | the 08:53 run is the only production write today |
| P9 | `FREECASH_DATA_ROOT=<scratch> venv/python monitoring/freecash/tests/run_all.py` (exit measured without a pipe) | `run_all: tests=52 failures=0 errors=0 skipped=0`, `tests_exit=0` | routine self-tests **GREEN** |
| P10 | `venv/python monitoring/freecash/verify_readonly.py` | `[verify_readonly] forbidden=0 exempt=28 missing_targets=0` / `PASS` | R2 static gate **GREEN**, baseline 28 |
| P11 | `venv/python -c "import sys,zoneinfo; print(sys.version.split()[0], zoneinfo.ZoneInfo('Europe/Berlin'))"` | `3.11.9 Europe/Berlin` | interpreter of record: `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` |
| P12 | `sha256sum state/last-run.json alerts/alerts.jsonl` before **and** after P9+P10 | `a287a902…293bf9` / `1b9c7c07…3999a8` — **identical** | the suite is hermetic; the production root was not touched by this pass |
| P13 | `schtasks /Query /FO CSV /NH \| grep -ic freecash` | `0` (278 tasks total) | the routine is **not scheduled**, on any route |
| P14 | `ls -la /c/Users/cd-pr/AppData/Local/hermes/cron/` | `.jobs.lock`, `executions.db`, `output/`, `ticker_heartbeat` (09:01 today), `ticker_last_success` (09:01 today) — **no job definition for Free Cash** | the Hermes ticker is alive; it has no Free Cash job |
| P15 | `git ls-files monitoring \| wc -l` → `0`; `git status --porcelain` | the entire monitor package is **untracked**; ~850 unrelated modified/untracked paths | nothing in this delegation may touch the unrelated work |
| P16 | `monitoring/freecash/*.py` mtimes | no package file newer than 2026-09-20 06:59 | the code that ran today is the code from 09-20 |

### 1.1 Inherited (from the parallel sessions' plans, NOT re-verified here)

- `http://localhost:4600/api/health` → `200 {"status":"healthy","version":"9.0.0","gitShort":"8f7463aa","isDirty":true}`; `:3001` refused; 0 Electron processes.
- `gate.py` `SUCCESS_OUTCOMES` contains `MONITOR_DEGRADED` (lines ~32–41), `record_outcome()` advances `last_success_day` (lines ~198–200), `watchdog.py:33` therefore reports `WATCHDOG_OK` on a null day.
- `run_daily_check.py` claims the day key and the lock around `:308–309`, and performs the read only at `:372`.
- `server/scripts/verify-freecash-rules.mjs` prints `4/4 PASSED` and cannot exit non-zero while its hardcoded target `server/scripts/freecash-daily-monitor.mjs` fails `node --check` at line 41.
- The provider read endpoint is unresolved in code (`PROVIDER_ENDPOINT_UNKNOWN` in `readonly_client.py`); `provider_credentials` count in the app DB is 0.

Each of these is assigned to a track below for re-verification by execution.

---

## 2. The four operational rules (non-negotiable, in the operator's ordering)

| Id | Rule | What it means for this routine | Assigned track |
|----|------|-------------------------------|----------------|
| **R1** | **Once-per-day check** | at most one status check per `Europe/Berlin` calendar day; a second same-day invocation must no-op **without reading** and without alerting; the day key must be DST-safe | Track 2 (scheduler/day-lock) |
| **R2** | **Zero automated earning actions** | no claim, click, withdraw, transact or any write verb/path — enforced by an interceptor in code plus a static scan, never by intention | Track 3 (verifier) |
| **R3** | **Notify on earnings / status change** | exactly one notification per change when balance, earnings or account status differ from the **previous** snapshot; a no-change day produces one coalesced line or silence, never a burst | Track 4 (delivery) |
| **R4** | **Human approval before any external action** | anything that is not a read becomes a `PENDING` approval item; the queue is never auto-drained and never expires into execution | Tracks 3 + 4 |

**Current standing:** R1 is *partially* satisfied (the lock is real and atomic — P3/P6 show a duplicate same-day run was refused), but the lock is taken **before** a reading exists, so it satisfies "once" while defeating "one check" (P4: a data-less day advances `last_success_day`). R2 is green by two independent scanners (P10). R3 is *structurally* present but has **never fired** — no two comparable readings have ever existed (P5–P6). R4 holds trivially and vacuously: no approval item has ever been created (P7) and there is no execution path.

---

## 3. The workflow (the once-per-day loop the design must implement)

1. **Fire** — one scheduler entry per operator-local day at a fixed local time (proposed 08:30 Europe/Berlin), with the tzdata interpreter (P11) and explicit env, overriding any ambient `FREECASH_*`.
2. **Pre-flight** — refuse to consume the day when no reading is obtainable. Today this step is **absent**: the run took `2026-10-01.lock` at 08:53 and wrote a null snapshot (P3–P4, P8).
3. **Gate** — `state/day-locks/<YYYY-MM-DD>.lock` acquired atomically (`O_CREAT|O_EXCL`); a second same-day run logs `SKIP_DUPLICATE_DAY` and performs **no read** (P6 proves the refusal fired on 09-30).
4. **Read** — allowlisted `GET`/`HEAD` only through `readonly_client`; any write verb or write path raises `ForbiddenWriteError` **before** any read (R2, P10).
5. **Compare** — load the **previous** snapshot first, then write today's; compare `earnings_total_cents`, `balance_cents`, `pending_cents`, `account_status` as integers.
6. **Notify** — one deduped message per change onto `alerts.jsonl` and through the configured sink; a no-change day gives one coalesced line or nothing.
7. **Queue, never execute** — any non-read becomes a `PENDING` item in `approvals/pending.json` with `execution_state=NOT_EXECUTED` and `expires_at_utc=None`. A human decides; nothing else ever does.
8. **Record** — ledger (`last_attempt_day`, `last_success_day`, `last_outcome`, `consecutive_missed_days`) **must not** advance `last_success_day` for a day that produced no reading, and `watchdog.py` must report that day as missed.

**Silence is meaningful only because the watchdog breaks it** — and the watchdog currently cannot, because a null day is scored as covered.

---

## 4. Options, each with Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

*Time-to-Revenue = elapsed time until the routine can put a monetizable, human-approvable signal in front of the operator. The routine itself can never earn — that is R2.*

**Option A (recommended) — operator-entered reading + one scheduler entry.**
Expected Effort: 3–4 h (pre-flight guard + wrapper + wrapper read-back). Time-to-Revenue: 1 day (first comparable reading tomorrow morning; any earnings delta surfaces the same day). Dependencies: operator types one reading per day; tzdata interpreter (P11, present); an alert sink that reaches the operator (not yet wired, Track 4). First Concrete Action: run the routine once in a scratch `FREECASH_DATA_ROOT` with a seeded prior-day snapshot and a changed figure, and read the single notification it emits — this is the smallest experiment that proves R3 end-to-end.

**Option B — `metrics_http` against an existing AgenticOS read route.**
Expected Effort: 1–2 days (route must exist and be provably read-only, and the adapter's hardcoded stub must be replaced). Time-to-Revenue: 2–3 days. Dependencies: an AgenticOS HTTP route exposing balance/earnings state; the `:4600` listener up (inherited: 200) and allowlisted in `readonly_client`; a rule preventing the monitor from depending on a closed desktop app. First Concrete Action: `grep -rn "app.get\|router.get" server/src` for a route already serving account/earnings state, and `curl -m5` it.

**Option C — real provider read API (Freecash.io / HG.Cash / Cashfree Payouts).**
Expected Effort: unknown until Track 1 resolves it; 1–3 days if a documented read-only endpoint exists, otherwise indefinite. Time-to-Revenue: 3–7 days, or zero if no read-only API exists. Dependencies: a documented read-only status/balance endpoint, credentials, and provider terms permitting automated reads. Currently BLOCKED (`PROVIDER_ENDPOINT_UNKNOWN`, no credentials). First Concrete Action: Track 1's web research — identify the real provider entity and whether a documented read-only balance endpoint exists, before any credential is requested.

**Option D — keep the manual CLI, no scheduler.**
Expected Effort: 0. Time-to-Revenue: n/a (no signal). Dependencies: none. First Concrete Action: none; it loses the missed-day signal silently the moment the operator forgets, which is exactly what happened for 09-21…09-29 (P6).

**Every option stops at the approval gate:** arming any scheduler is itself an external action and needs the operator's explicit go-ahead (R4 applied to the routine's own deployment).

---

## 5. The research plan (dispatched as `deleg_ca33759b`, 4 tracks)

Each track writes evidence into `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/<track>/`, runs only against a throwaway `FREECASH_DATA_ROOT` under `%LOCALAPPDATA%\Temp`, pins the production root's `sha256sum` pair before and after, makes no git write, and uses no credential.

| Track | Question it must answer | Deliverable |
|---|---|---|
| 1 — datasource | How can a real daily **reading** actually reach the monitor, and can R3 fire today? Which of the app's own routes already expose the figures? Does a documented provider read API exist (with citations)? | `datasource/DATASOURCE-FINDINGS.md` |
| 2 — scheduler | Is R1 provable — one run per local day, a second same-day run that performs no read, a 5-process race with one winner, DST and backwards-clock day keys, a slept-through hour? Which single scheduler route, with which exact command and interpreter? | `scheduler/SCHEDULER-FINDINGS.md` |
| 3 — verifier | Is each of the four rules **falsifiable**? Does each rule's check fail on a deliberate violation? What is the false-compliance source worth? Where is each gate blind? | `verifier/RULE-VERIFICATION.md` + mutation matrix |
| 4 — delivery | Does R3 fire exactly once per change, dedupe correctly, and coalesce a catch-up? Where can an alert actually land today? Is R4's decider check an allowlist or a bypassable denylist, and can a bad decider arm anything? | `delivery/DELIVERY-FINDINGS.md` |

**Joint open questions, in priority order:** (a) does a read-only provider endpoint exist at all; (b) can an alert reach the operator without new sender code; (c) can one scheduler entry be shown to fire at most once per operator-local day across DST and sleep; (d) is the day-lock safe when the clock moves backwards; (e) what is the minimum evidence set that makes "4/4 rules hold" falsifiable rather than a slogan — given that one shipped verifier already certifies a file that does not parse.

---

## 6. Staged (NOT executed) arming step — needs operator approval

Pending approval, the recommended arming is **one** scheduler entry at 08:30 Europe/Berlin invoking the canonical entry point `monitoring/freecash/run_daily_check.py` through a wrapper that sets `FREECASH_DATA_ROOT`, the timezone and the source explicitly, uses the tzdata interpreter (P11), and prints nothing on a quiet day. The exact payload comes from Track 2's verified recommendation. It will not be armed without an explicit go-ahead, and the Windows Task Scheduler / Hermes cronjob / repo crontab alternatives will be documented as fallbacks rather than armed in parallel (the day lock makes two schedulers safe, but it would double the notification surface).

---

## 7. What stays true regardless of the option chosen

- Nothing in the monitor writes to a provider. R2 is enforced by an interceptor, not by intention (P10).
- A second same-day run is not merely skipped — it does not read (P6).
- No notification means no *change*, not no *news*; the watchdog is the only thing that separates those two, and today it cannot, because `MONITOR_DEGRADED` is a success outcome (P4).
- Approval items never expire into execution.
- Today's day is spent (P3): the next obtainable reading is 2026-10-02, and only if the pre-flight exists by then.

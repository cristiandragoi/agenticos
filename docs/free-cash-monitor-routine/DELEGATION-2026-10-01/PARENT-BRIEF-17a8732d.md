# PARENT BRIEF — 2026-10-01 — Free Cash daily status monitor (workflow + research plan)

**Repository:** `D:\AgenticOS` (§ workspace) · branch `hermes-rescue-20260908` · HEAD `8f7463a`
**Written:** 2026-10-01 ~08:45 Europe/Berlin (CEST, UTC+02:00) · **Author:** Hermes parent session, delegation `deleg_17a8732d`
**Why a second brief in this directory:** a **concurrent sibling delegation (`deleg_fec45ca6`)** is writing its own
`DELEGATION-BRIEF.md` into this same date directory. This file is deliberately separate: same workspace, same
rules, two independent passes. Neither pass overwrites the other's files; the sub-track directories
(`verifier/`, `scheduler/`, `datasource/`, `delivery/`) are shared namespaces, so every artifact below is
suffixed `-V2` to stay collision-free. This is additive only — no source file touched, nothing registered.

---

## 0. Rule-numbering conflict — resolve before reading any compliance table

Two numbering schemes are live in this repo and they are **inverted relative to each other**:

| Scheme | Rule 1 | Rule 2 | Rule 3 | Rule 4 |
|--------|--------|--------|--------|--------|
| **Operator (binding — this pass)** | no earning action automatically | check status once per day | notify on earnings/status change | human approval before any external action |
| Older in-repo plans (incl. the sibling brief) | once-per-day check | zero automated earning actions | notify on change | human approval |

Both agree on the *content* of the four constraints; only the labels swap. Any table that says
"R1 PASS, R2 PASS" is therefore unreadable without its scheme stated. This brief and all four tracks
spawned by `deleg_17a8732d` use the **operator** numbering above.

---

## 1. Baseline verified in this session (2026-10-01, commands executed, output quoted)

| # | Command | Observed | Verdict |
|---|---------|----------|---------|
| V1 | `python monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0 | suite GREEN |
| V2 | `python monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` → `PASS - no unexempted write/earning token found.`, exit 0 | static rule-1 gate GREEN |
| V3 | `ls data/freecash-monitor/state/day-locks/` | `2026-09-20.lock`, `2026-09-30.lock` — **no `2026-10-01.lock`** | today's check has NOT run; today's day key is still free |
| V4 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day 2026-09-30`, `last_success_day 2026-09-30`, `last_outcome MONITOR_DEGRADED`, `consecutive_missed_days 9`, `timezone Europe/Berlin` | last real run 1 day ago, degraded, after a 9-day gap |
| V5 | `schtasks /query /fo LIST \| grep -i freecash` | no match | **no Windows scheduled task** |
| V6 | `hermes cron list` | `No scheduled jobs.` | **no Hermes cron job** |
| V7 | `ls ~/AppData/Local/hermes/scripts` | `No such file or directory` | cron wrapper dir does not exist |
| V8 | `echo "[${FREECASH_DATA_ROOT}] [${FREECASH_TZ}] [${FREECASH_READ_SOURCE}] [${FREECASH_TOAST_STUB}]"` | all four empty | no state-root pin in the shell — a bare run defaults to the **production** root |
| V9 | `…hermes-agent/venv/Scripts/python.exe -c "…ZoneInfo('Europe/Berlin')"` | `3.11.9 Europe/Berlin` | only the Hermes venv python has an IANA tz db → pins the day key |
| V10 | `ls monitoring/freecash/` | `run_daily_check.py`, `gate.py`, `changedetect.py`, `notify.py`, `approval_queue.py`, `readonly_client.py`, `operator_state.py`, `paths.py`, `watchdog.py`, `verify_readonly.py`, `tests/` | canonical implementation present |
| V11 | `cat config/freecash-crontab` | template only: `/usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py` — **placeholder path**, targeting the known stub script | the repo's *only* "configured" schedule would run a stub that exits 0 having done nothing |
| V12 | `git status --short \| wc -l` | `857` | tree heavily dirty from unrelated work; this pass adds docs only |

Rule-level read of the baseline: **rules 1, 2 and 4 are implemented in code and green; nothing runs the
routine, nothing feeds it, nothing receives its alerts.** The open failures are operational, not logical.

---

## 2. Open gaps this pass exists to close

| # | Gap | Consequence if left open |
|---|-----|--------------------------|
| G1 | Nothing runs the routine (V5, V6, V7). | "Once per day" is enforced as an upper bound only — with no invocation the bound is never met; 9 consecutive missed days are already on record. |
| G2 | No read-only data source: `readonly_client.py` holds `PROVIDER_ENDPOINT_UNKNOWN`; `state/operator-state.json` is `"records": []`. | Earnings/status stay `null` + `degraded: true`; **rule 3 has never had a real change to detect**. |
| G3 | No delivery sink configured. | A detected change would reach nobody. |
| G4 | Verifier trustworthiness unproven — `rule_gate.py` has never been shown to FAIL on a known violation, and the in-repo `server/scripts/verify-freecash-rules.mjs` prints `4/4 PASSED` while certifying a `.mjs` that does not parse. | A green rule report proves nothing; the compliance table is decorative. |
| G5 | Approval identity is an exact-match **denylist**, not provenance: `--by "Hermes Agent"` is accepted. | Rule 4 can be satisfied by a machine label. |
| G6 | Registration of any schedule is itself an external action under rule 4 (and V11 shows the only existing config targets a stub). | No agent may register it; the operator must approve the exact command. |

---

## 3. Workstreams of this delegation (`deleg_17a8732d`, 4 tracks, parallel)

| # | Directory + deliverable | Question it answers | Rules |
|---|------------------------|--------------------|-------|
| 1 | `verifier/VERIFIER-PLAN-V2.md` | Does the gate FAIL on a broken rule — proven per rule by mutation on throwaway copies — and how is it wired for a human/CI run? | 1–4 |
| 2 | `datasource/DATASOURCE-RESEARCH-PLAN-V2.md` | Which read-only contract (or operator-state fallback) can feed the daily figure, and what must the operator decide? | 1, 3 |
| 3 | `scheduler/SCHEDULER-DECISION-V2.md` | What exactly would be registered for a once-per-day check, what happens on a missed day, and what must the operator approve verbatim? | 2, 4 |
| 4 | `delivery/NOTIFY-AND-APPROVAL-V2.md` | Where does a change notification land, and does the approval gate check provenance or a denylist? | 3, 4 |

The parent then synthesises these into one consolidated workflow + research plan in this directory, with
per option: **Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action**.

---

## 4. Constraints imposed on every track

- Additive only: new files only inside this delegation's own sub-directory; no existing file modified or deleted.
- No Windows scheduled task / Hermes cron job created, enabled, disabled or deleted (rule 4 territory).
- The production state root `D:/AgenticOS/data/freecash-monitor` must gain **no** day-lock, snapshot, alert
  or approval. Every executed run uses a throwaway `FREECASH_DATA_ROOT` under `$LOCALAPPDATA/Temp`, echoed
  immediately before the run — mandatory because the variable is **unset** (V8) and the default is production.
  The 2026-09-30 incident (two wrapper runs hit production and sent 9 real desktop notifications) is the
  precedent this constraint exists to prevent.
- Pinned interpreter: `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` (V9).
- No provider contact, no credential read/typed/stored, no network beyond loopback (public docs only for
  the datasource track, cited). No real notification to the operator's desktop. No git write verb.
- Evidence bar: a PASS may only be claimed from output quoted in the same session with its command.
  Un-executed items are labelled UNVERIFIED — never inferred from reading source.

---

## 5. Not claimed

- No provider account, balance, earnings or status was read from any real account by this pass.
- No automated earning, payout or withdrawal path is proposed anywhere; rules 1 and 4 are permanent
  exclusions, not staging items.
- `52/52` is the routine's own suite on this host: it shows the gate / change-detection / approval logic
  behaves as specified. It does **not** show any figure is true, nor that the routine is scheduled.
- Registration remains a human decision: this pass exits with a proposal and the exact approval string.

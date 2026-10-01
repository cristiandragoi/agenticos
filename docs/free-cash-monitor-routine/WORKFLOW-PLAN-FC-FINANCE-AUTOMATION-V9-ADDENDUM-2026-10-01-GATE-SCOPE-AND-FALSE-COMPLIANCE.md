# ADDENDUM — Free Cash Finance Automation workflow plan (2026-10-01): gate scope + false compliance

**Repository:** `D:\AgenticOS` · branch `hermes-rescue-20260908` (HEAD `8f7463a`) · **Host:** Windows 11, git-bash, non-elevated
**Written:** 2026-10-01, 08:40–09:0x operator-local (`date` → `Do,  1. Okt 2026 08:40:32`, Europe/Berlin, UTC+02:00)
**Relation to other plans:** **supplements** `WORKFLOW-PLAN-FC-FINANCE-AUTOMATION-V9-2026-10-01.md` (written by a parallel session in the same hour, 36 589 B) — it does **not** supersede it, and it does **not** overwrite it. V9's F-1R finding is **independently reproduced here** (§0 A8–A9). This addendum exists because V9 does not contain the four items in §0 A1–A4, all of which change the *gate* decision (S0) and one of which is a live false-compliance source.
**Supersedes:** nothing. Still earlier: V8 (two divergent files, `…-V8.md` 35 372 B and `…-V8-2026-09-30.md` 30 315 B) — both stale, as V9 states.
**Evidence standard (C5):** every row in §0 is a command executed in this pass. V9's rows are cited as `V9:Vn` and labelled *sibling, independently re-checked here* where I re-ran them.
**Footprint:** this file is **new** (additive). No existing file edited, moved, renamed or deleted — **including the V9 file another session wrote**. No `git add/commit/stash/reset/restore/checkout/clean`. No scheduled task created or modified. No provider network call. No credential, token or secret in this file. Every routine invocation here used a scratch `FREECASH_DATA_ROOT`; the production root's hash pair was taken before and after and is identical (§0 A5), and **no lock was created for 2026-10-01 in the production root** (§0 A10).

---

## 0. New live evidence (2026-10-01, this pass)

| # | Command (executed this pass) | Observed result | Why it matters |
|---|---|---|---|
| A1 | `python docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash` | `[static, AST over 10 runtime module(s)]` + 4 runtime detectors → `DETECTOR-RESULT: rule=1 PASS (15)`, `rule=2 PASS (8)`, `rule=3 PASS (8)`, `rule=4 PASS (20)` · `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` · `VERDICT: COMPLIANT -- 4/4 operator rules enforced by an AST layer and a runtime layer` · exit **0** | **the capability V8's S0 declared missing now exists on disk** — package-scoped, rule-attributed, 51 checks |
| A2 | `python …/verifier/rule_gate.py --self-test` | control `['PASS','PASS','PASS','PASS']` exit 0; mutants m0-syntax, m1a, m1b, m2a, m2b, m3a, m3b, m4a, m4b, m4c **all** `flagged: yes` (exit 1/2) · `SELF-TEST VERDICT: PASS` · exit **0** | the mutation probe is real — this is exactly the "with the mutation probe still failing" property C9 demands |
| A3 | `python scripts/monitoring/rule_gate_verify.py monitoring/freecash/gate.py` | `R1=FAIL(due to 'no rolling 24h window … [line 220]') R2=FAIL R3=FAIL R4=FAIL`, exit 1 — while `atomic exclusive-create day guard present [line 128]` and `day key is a calendar day [line 102]` both **PASS** in that same file | **proves the shipped gate is single-file scoped.** Pointed at the entry file it fails R1 (mechanism is in `gate.py`); pointed at the mechanism file it fails R2–R4 (they live elsewhere). Only a monolith could pass it → C9 is unreachable for *any* modular routine, and V8's "repair the verifier's scope" remedy is confirmed as the real fix |
| A4 | `node server/scripts/verify-freecash-rules.mjs` then `node --check server/scripts/freecash-daily-monitor.mjs` | verifier: `✓ Rule 1…4 → PASSED`, `[OK] All 4 operational rules verified (4/4 passed)`, exit **0** · the file it reads (`readFileSync … freecash-daily-monitor.mjs`, hardcoded, no target argument) → `SyntaxError: Unexpected token ':'` at line 41, exit 1 · `grep` finds **no `process.exit`** in the verifier | **a live false-compliance source.** A 4/4 PASSED report certifies a file that does not parse, and the verifier cannot exit non-zero. Neither V8 nor V9 verifies this by execution |
| A5 | `sha256sum` production `last-run.json` + `alerts.jsonl` before and after A1+A2 | `2310072a…399a` / `7a90034f…96cc` — unchanged; `day-locks/` still `2026-09-20.lock`, `2026-09-30.lock` | the delivered gate is **hermetic w.r.t. the production root** (its runtime probes run in a temp workdir) — safe to run repeatedly |
| A6 | `json.load(alerts.jsonl)` line-by-line, all 14 lines | lines 4–12 = `MISSED_DAY` for **09-21 … 09-29**, `severity=alert`, dispatched `19:01:05Z → 19:01:58Z` — **9 alerts in 65 s, ~6.5 s apart**; line 13 `MONITOR_DEGRADED` (info); line 14 `SKIP_DUPLICATE_DAY` (info) | beyond V9's "11 new lines": the split reveals a **retro-notify burst**. No R3 violation (10 distinct dedupe keys, `delivery: TOAST_OK`) — but a storm-shaped surface at exactly the moment the operator most needs one sentence |
| A7 | same parse → key sets | keys = `day_key,dedupe_key,event_id,event_type,message,observed,severity,ts_utc` — **no pid / entry point / writer field** on any of the 12 lines appended 2026-09-30 | C14 (V9's numbering) remains open, and now covers a *second* day's writes with no attribution |
| A8 | `grep -n "SUCCESS_OUTCOMES" -A 10 monitoring/freecash/gate.py` | `gate.py:32-41` — `{"OK_NO_CHANGE","INITIAL_BASELINE","EARNINGS_CHANGED","STATUS_CHANGED","BALANCE_CHANGED","MONITOR_DEGRADED"}` | **V9's F-1R independently confirmed**: `MONITOR_DEGRADED` — the very outcome that means *nothing was read* — is a success outcome |
| A9 | `grep -n "def record_outcome" -A 14 gate.py`; `grep -n "covered" monitoring/freecash/watchdog.py` | `gate.py:198-200 if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day; …` · `watchdog.py:33 covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | confirmed end-to-end: a null-data day advances `last_success_day` **and** makes the 23:50 watchdog say `WATCHDOG_OK`. The alarm is designed to miss its own failure mode |
| A10 | `ls -1 data/freecash-monitor/state/day-locks/`; `grep last_attempt_day\|last_success_day state/last-run.json` | only `2026-09-20.lock`, `2026-09-30.lock`; `last_attempt_day=2026-09-30`, `last_success_day=2026-09-30` | **today's key, 2026-10-01, is still free in the production root** — V9's V13 repro created its `2026-10-01.lock` in a *scratch* root, not here. So exactly one operator reading is still obtainable today, and only once |
| A11 | `curl -m5 localhost:4600/api/health`; `curl -m5 127.0.0.1:3001/health`; `tasklist \| grep -ic electron` | `4600 → 200 {"status":"healthy","pid":32500,"uptime":2351,"version":"9.0.0","gitShort":"8f7463aa","isDirty":true,"buildTimestamp":"2026-10-01T05:49:00Z"}`; `3001 → 000`; **0** electron | agrees with V9:V19 — the API answers, the desktop shell does not (C17 still binds) |
| A12 | `python`-sqlite (mode=ro) on `server/data/agentic-os.db` → ledger/task/gates/schedules | ledger **11 rows**, newest `2026-08-19T18:08:12Z`; totals REALIZED_REVENUE €388 (5), VERIFIED_REVENUE €38 (2), PIPELINE_VALUE €240, ACTUAL_COST €40; `treasury_ledger` 0; `provider_credentials` 0; 16 human gates, **all resolved**, last `2026-09-09T13:48:50Z`; `bgtask-07a8154b0` `blocked` / `executing_mission` / `resumable=0` / `2026-09-19T18:05:18Z`; 4 schedules, last tick `2026-09-19T18:05:00.070Z`; `schedule_executions` 2875, max `2026-09-19T18:05:00.004Z`; fleet `blocked 5 / completed 1144 / failed 1 / queued 7` | consistent with V9:V20/V21; the euro totals are the full ledger picture, not just the €19 line |
| A13 | `git status --porcelain \| wc -l` | **856** (V9 measured 855; V8 838) — the +1 is a plan document written by the parallel session in this same hour | two sessions are writing this plan set concurrently; naming collisions are now a live risk (this file was written to a distinct name for that reason) |
| A14 | `env \| grep -iE "FREECASH\|SMTP_\|WEBHOOK_"` (names only) | only the scratch `FREECASH_DATA_ROOT` this pass set | no credential, no external sink |

### 0.1 What this adds to the plan (read this as the delta, not a restatement)

1. **S0 is no longer a research task — it is a port decision.** The delivered `verifier/rule_gate.py` + `detectors/` (four detectors, 51 checks, self-test green) is the artefact V8 asked someone to build. The work that remains is *where it lives*: an unshipped copy in `DELEGATION-2026-09-30/verifier/` versus the shipped `scripts/monitoring/rule_gate_verify.py`, which is single-file scoped (A3) and has no `--package` mode (V9:V6). Shipping a **third** gate file violates C8/C16 and the earlier written rule *"the acceptance gate stays `scripts/monitoring/rule_gate_verify.py` — the new modes are added to it, no second verifier file is created"*.
2. **A false-compliance instrument is sitting in the tree** (A4). Until it is labelled or removed, any "4/4 rules verified" claim from `server/scripts/verify-freecash-rules.mjs` must be treated as evidence of nothing — and it is a *different* gate from the one C9 names.
3. **Two new constraint classes are warranted**: writes to the production state root by non-reading runs, and machine-timed bursts (A6). V9's C19 ("ran ≠ read") covers the *ledger* half; these cover the *footprint* and *surface* halves.
4. **The window is still open exactly once**: production `2026-10-01` has no lock (A10), so one operator reading is obtainable today — but a data-less run takes it permanently (V9's C19 + F-1R).

---

## 1. Constraint additions (extend V9 §1; V9's C19/C20 are adopted as written)

| ID | Constraint | Enforcement mechanism | Proof demanded |
|---|---|---|---|
| **C21 (NEW — the production root is not a scratch dir)** | a run may target `data/freecash-monitor` **only** when it will produce a reading; otherwise `FREECASH_DATA_ROOT` must point at a throwaway dir | the 2026-09-30 run was a delegated scratch-rule violation that spent a production day (V9:V7–V9; A6); delegation briefs must state the throwaway rule *and* the verify step must read the real-root hashes | every pass states its `FREECASH_DATA_ROOT`, and quotes the real-root hash pair before/after (A5 pattern) |
| **C22 (NEW — no machine-timed bursts)** | a catch-up of N missed days reaches the operator as **one** summary naming N and the day keys, not N machine-spaced alerts | A6: 9 `MISSED_DAY` alerts in 65 s at ~6.5 s intervals are indistinguishable at the notification surface from a retro-notify loop | N missed days → exactly 1 payload; observed today: 9 |
| **C23 (NEW — gate identity)** | every compliance claim names the gate file that produced it, and no gate may hardcode a target or be incapable of exiting non-zero | A4 (hardcoded `readFileSync`, no `process.exit`, 4/4 PASSED on an unparseable file) vs A3/A1 (two gates, two scopes) | a claim without a gate path and an exit code is not a claim |

---

## 2. Stages — new and amended (same four fields; V9 §2 stages S1–S10 stand unchanged)

**S0′ — Gate scope decision (was V8 S0; now a port, not a build). Blocking.**
Expected Effort: 2–4 h port · 0.5 h adopt · 0.2 h override. Time-to-Revenue: none — this buys the verdict, not cash. Dependencies: the delivered `DELEGATION-2026-09-30/verifier/` artefact (present), nothing else.
First Concrete Action (one command): `python docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash` and read `SUMMARY: R1..R4 = PASS` + exit 0 for yourself (A1) — then add `--package <dir>` to `scripts/monitoring/rule_gate_verify.py` and move the four detectors under it, retiring the copy.
Exit: `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** exit non-zero on a mutant copy (the A2 property); exactly one gate file reachable from the repo root (C8/C16/C23).
Options: **O-A′ port the delivered detectors into the shipped verifier (recommended, 2–4 h)** · O-B′ move `verifier/rule_gate.py` in as-is (0.5 h; fast; ships a third gate and the old one must be labelled — C8/C16 risk) · O-C′ operator override of C9 (0.2 h; removes an automatable gate) · **rejected: O-D′ inline `gate.py`'s lock into the entry file** so the single-file gate turns green (3–5 h; a second copy of R1, and A3 shows R2–R4 would still fail).

**S8′ — Alert surface: attribution + burst coalescing (C14/C22). Parallel, cheap.**
Expected Effort: 1–2 h. Time-to-Revenue: none. Dependencies: none.
First Concrete Action: add a writer tag (pid + entry point + start time) to each new `alerts.jsonl` line — the 12 lines of 2026-09-30 carry none (A7) — and coalesce missed-day catch-up.
Exit: N missed days → 1 payload listing N and the day keys (today 9 → 9, A6); a bundle whose baseline includes the 2026-09-21 unattributed line **and** the 2026-09-30 burst, so neither is laundered.

**S9′ — Deprecation index (amends V9's S9; delete nothing).**
Expected Effort: 1–2 h, read-only. Time-to-Revenue: none — false-compliance risk control.
First Concrete Action: write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` and include, alongside the runners V9 lists, **`server/scripts/verify-freecash-rules.mjs`** marked `DEPRECATED — do not cite as compliant`, with its observed defect (`4/4 PASSED`, exit 0, no `process.exit`, target fails `node --check`, A4) — plus the note that the package-scope gate exists in two places until S0′ resolves it.
Exit: index exists; no file moved, edited or deleted.

---

## 3. Options at a glance (gate decision, with the four required fields)

| Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|
| **O-A′ port detectors into the shipped verifier** | 2–4 h | none | delivered `verifier/` artefact | run `--package` + `--self-test`; then add `--package` to `scripts/monitoring/rule_gate_verify.py` |
| O-B′ move the delivered gate in as-is | 0.5 h | none | none | file move + label the superseded gate (C8/C16 risk) |
| O-C′ override C9 in writing | 0.2 h | none | operator sign-off | record the override; lose the automatable gate |
| O-D′ inline the lock in the entry file | 3–5 h | none | none | **rejected** — second copy of R1 (A3 shows it still fails R2–R4) |
| S8′ alert attribution + coalescing | 1–2 h | none | none | add writer tag; coalesce N missed days into 1 |

---

## 4. Decisions this addendum asks for

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| A-D1 | S0′ remedy: O-A′ / O-B′ / O-C′ | operator | C9 stays red; a mutation-tested gate sits unused while the shipped one is structurally unable to pass |
| A-D2 | `server/scripts/verify-freecash-rules.mjs` (+ the parallel `freecashMonitorAdapter.ts` / `freecash-daily-monitor.mjs`): label `DEPRECATED — do not cite as compliant` now, remove once unused | operator | a green 4/4 report that certifies an unparseable file remains available to any future reader, including an agent |
| A-D3 | the 2026-09-30 production-root run: record as a documented breach of the brief's throwaway-root rule (recommended — the lock is a true record and cannot be undone) | operator | the same delegation pattern spends another day, and C11/C21 stay unenforced |
| A-D4 | V9's C19 remedy ordering: fix the ledger/watchdog (`MONITOR_DEGRADED` out of `SUCCESS_OUTCOMES`) **before** or **with** S1's guard | operator | until then the watchdog reports `WATCHDOG_OK` for days that read nothing (A8/A9) |

---

## 5. Definition-of-done additions (V9 §7 items 1–9 stand)

10. `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` exits **0** with `R1..R4 = PASS` **and** exits non-zero under mutation — a single gate, named in the claim (S0′, C23).
11. No compliance claim anywhere in the repo originates from `verify-freecash-rules.mjs`; that file is labelled deprecated or gone (S9′, A4).
12. A missed-day catch-up reaches the operator as **one** payload naming N and the day keys (S8′, C22) — today's 9-in-65 s is the counter-example.
13. Every pass that touches the routine states its `FREECASH_DATA_ROOT` and quotes the production-root hash pair before/after (C21) — today's pair is `2310072a…399a` / `7a90034f…96cc`.

**Honest one-line reading of this addendum:** the gate problem the plan has carried since V5 is solved *in substance* — a package-scope, rule-attributed, mutation-falsifiable gate exists and returns 4/4 — and remains unsolved *in shipping*: it lives in a delegation folder while the shipped gate is single-file scoped and structurally unable to pass a modular routine; a second, hardcoded, non-failing "4/4 PASSED" verifier sits in the tree certifying a file that does not parse; the routine's one real run burned 2026-09-30 with no reading, booked it as a success day and silenced its own watchdog, and still has not been given a single operator figure — with today's day key, 2026-10-01, still free exactly once.

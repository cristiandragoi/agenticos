# Free Cash Finance Automation — Workflow Plan v4 (constraint-first, re-measured 2026-10-01 11:36 local)

| Header field | Value |
|---|---|
| Repository | `D:\AgenticOS` |
| Branch / HEAD | `hermes-rescue-20260908` · `8f7463aa6931d57e12ec81b904b98cec04e932cf` |
| Uncommitted paths | **870** (`git status --porcelain \| wc -l`, this pass). Sibling R3 measured **868** at 09:26 local — the tree moved between the two passes (E1) |
| Clock | `Do, 1. Okt 2026 11:36:46` local (Europe/Berlin, UTC+02:00) = `2026-10-01T09:36:46Z` |
| Interpreter of record | `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` = **3.11.9**, `ZoneInfo("Europe/Berlin")` resolves, `tzdata` OK (E23). `C:/Python314/python.exe` = 3.14.7. `which python3` → the WindowsApps alias — **not** the interpreter of record |
| Evidence standard | Every row in §0 was executed **in this pass**. Rows taken from another document are labelled `inherited` and carry that document's mtime. A PASS quoted from an earlier session is not evidence |
| Footprint | **This pass wrote exactly one file — this one.** Throwaway roots: `%LOCALAPPDATA%/Temp/fc-plan-sandbox-1790847553`, `…/fc-plan-gate-<pid>`, `…/fc-plan-gate-<pid>-st`. Production state root hash pair identical before **and after** every invocation, including after this file was written (E22, E24). No lock created, no snapshot, no alert, no approval, nothing scheduled, no provider contacted, no source file edited. **Concurrent writer disclosed:** another delegation session (`DELEGATION-2026-10-01-R4/`, files at 11:39–11:43) is writing in this repo during this pass — those paths are not this pass's footprint and are named in E24 rather than claimed as neutral |
| Supersedes (planning only) | `docs/freecash-monitor/04-workflow-plan-v3.md` (2026-10-01 09:26). **Read-only inputs, nothing edited, renamed or deleted** |
| Concurrent sibling (cross-referenced, not clobbered) | `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/workflow/WORKFLOW-PLAN.md` (mtime 09:33) and `DELEGATION-BRIEF-R3.md` (09:27). Its stage IDs are `S1…S11`; **this document uses `W1…W11`** so the two numbering schemes cannot be confused |

---

## 0. Live evidence — command → raw observed output → what it establishes

| # | Command (executed here) | Raw observed | Exit | Establishes |
|---|---|---|---|---|
| E1 | `date` · `date -u` · `git rev-parse --abbrev-ref HEAD` · `git rev-parse HEAD` · `git status --porcelain \| wc -l` | `Do, 1. Okt 2026 11:36:46` · `2026-10-01T09:36:46Z` · `hermes-rescue-20260908` · `8f7463aa…` · **870** | 0 | Pass identity; the working tree is being written by other sessions (868 → 870 within 2 h) |
| E2 | `ls -la data/freecash-monitor/state/day-locks/` | `2026-09-20.lock` · `2026-09-30.lock` · **`2026-10-01.lock` (mtime 2026-10-01 08:53)** | 0 | **2026-10-01 is already spent** — no reading is obtainable today without a human decision |
| E3 | `cat data/freecash-monitor/state/last-run.json` | `last_attempt_day=2026-10-01`, `last_success_day=2026-10-01`, `last_outcome=MONITOR_DEGRADED`, `consecutive_missed_days=0`, `last_attempt_at_utc=2026-10-01T06:53:46Z` | 0 | **A day with no reading is booked as a success and the miss counter is reset** |
| E4 | `cat data/freecash-monitor/snapshots/2026-10-01.json` | `source.data_available=false`, `degraded=true`, `account_status/earnings_total_cents/balance_cents/pending_cents/currency` all `null`, `raw_response_sha256=e3b0c442…b855` (= sha256 of the empty string) | 0 | The snapshot in production contains **no reading**, and its content-hash proves the source was empty |
| E5 | `wc -l data/freecash-monitor/alerts/alerts.jsonl` + tail | **15** lines; newest `{"day_key":"2026-10-01","event_type":"MONITOR_DEGRADED",…,"ts_utc":"2026-10-01T06:53:46Z"}` | 0 | The alert log is real, append-only evidence and its newest entry is the silently counted day |
| E6 | `cat data/freecash-monitor/state/operator-state.json` | `records: []`; only `template_record` is present. Newest real snapshot on disk: `snapshots/2026-09-20.json` | 0 | **No operator reading has ever been entered** (11 days). Rule 3's notify path has never fired on real data |
| E7 | `ls -la data/freecash-monitor/approvals/` | directory **empty**; `pending.json` absent | 0 | Rule 4's queue has never been materialised in production |
| E8 | `env \| grep -E '^(FREECASH_\|SMTP_\|WEBHOOK_)'` | **0 matches** (`grep -c` → `0`, exit 1) | 1 | No leaked credential/channel variables in this session's environment |
| E9 | `curl -m3 127.0.0.1:4600/api/health` · `:4600/health` · `localhost:3001/api/health` · `netstat -ano \| grep -iE 'ABH\|LISTEN'` filtered to `:4600\|:3001\|:3000\|:8080` | all three `http=000`; **0 listeners** on those ports (41 listener lines total; German-locale `ABHÖREN`, so an English `LISTENING` grep returns 0 — do not read that as an empty port table) | 0 | **The backend at `:4600` and the `metrics_http` source at `:3001` are DOWN now.** v3's "`:4600` = 200 healthy" was true at 09:2x and is **expired** — an inherited health row must be re-measured, in both directions |
| E10 | `FREECASH_DATA_ROOT=<sandbox> <venv> monitoring/freecash/tests/run_all.py` | `run_all: tests=52 failures=0 errors=0 skipped=0`, exit 0. The suite itself printed `WATCHDOG_OK 2026-10-01 attempt=2026-10-01 outcome=INITIAL_BASELINE` and `… outcome=MONITOR_DEGRADED` in another case | 0 | The suite is green **and encodes the defect**: a degraded day is asserted to be covered |
| E11 | `FREECASH_DATA_ROOT=<sandbox> <venv> monitoring/freecash/verify_readonly.py` | `forbidden=0 exempt=28 missing_targets=0` · `PASS` | 0 | The static Rule-1 gate is green at a pinned exempt count |
| E12 | `FREECASH_DATA_ROOT=<sandbox> <venv> monitoring/freecash/watchdog.py` against an **empty** ledger · `grep -n` on `gate.py`/`watchdog.py` | `WATCHDOG_MISSED_DAY … last_attempt_day=None`; `gate.py:32-41` `SUCCESS_OUTCOMES` **still contains `MONITOR_DEGRADED`**; `gate.py:198-200` `if outcome in SUCCESS_OUTCOMES: ledger["last_success_day"] = day`; `watchdog.py:33` `covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES` | 0 | Read directly from the live code: with **today's production ledger** the same expression yields `WATCHDOG_OK` for a day that read nothing. (The production watchdog run was **not** executed to avoid writing state; the code path and the ledger are quoted instead) |
| E13 | `read_file monitoring/freecash/run_daily_check.py:307-312, 371-372` | `:307-309` `source_kind = resolve_source(...)` / `day = gate.day_key(now)` / `acquired, lock = gate.acquire_day_lock(day)` … `:371-372` `try: raw = read_source(source_kind, day, …)` | 0 | **Lock-before-read is live**: the day is consumed before any source is consulted |
| E14 | **Independent run of the sibling's gate**: `<venv> docs/…/DELEGATION-2026-10-01-R3/gate/rule_gate.py --package monitoring/freecash --workdir <temp>` and `--self-test --workdir <temp2>` | clean: `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS` · `VERDICT: COMPLIANT` exit **0**; self-test: `PROVEN: every one of the 4 operator rules has >= 1 seeded violation the gate flags with a non-zero exit` · `control: unmutated copy exits 0` · `SELF-TEST VERDICT: PASS` exit **0** | 0 | A **package-scoped, falsifiable** gate exists and is green on today's bytes. This is a material change from v3, which had no such run. The sibling's 10/10 mutation table is `inherited` (its artefact, mtime 09:35) and was **not** re-run |
| E15 | `grep -n "read-only R2, once-a-day R1" docs/…/R3/gate/rule_gate.py` vs the gate's own mutation rows | `rule_gate.py:12` says `read-only R2, once-a-day R1`; its mutation evidence shows `rule=1` failing on the *write-verb* detector (`adv1/adv4/adv6`) and `rule=2` failing on `run #2 on the same day D does NOT perform a status read` (`adv2`) | 0 | **The gate's header comment is inverted relative to its own detector wiring.** Never cite a bare `R1`/`R2`; name the rule title *and* the scheme |
| E16 | `node server/scripts/verify-freecash-rules.mjs` | `[OK] All 4 operational rules verified (4/4 passed)` | **0** | The decoy verifier is still live and still prints four greens — while its hardcoded target cannot parse (E17) |
| E17 | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at **line 41** (`function isDailyCheckAllowed(): boolean {`) | **1** | The file the decoy certifies has never been executable |
| E18 | `<venv> -m py_compile finance-monitor/src/rule_engine.py` | `SyntaxError: f-string: invalid syntax` at **line 122** | **1** | The parallel `finance-monitor/` package does not compile; it must never be cited as a fallback |
| E19 | `hermes cron list` · `schtasks /query /fo csv /nh \| grep -iE 'freecash\|finance\|monitor'` | `No scheduled jobs.` · **0** Free Cash tasks (the 7 `monitor` hits are Microsoft built-ins: Office/Hotpatch/Shell/TextServices) | 0 | **Nothing is scheduled.** The routine runs only when a human types it |
| E20 | `git ls-files \| grep -ic freecash` · `git status --porcelain \| grep -ic 'freecash\|monitoring/'` · `ls -la scripts/monitoring/rule_gate_verify.py` | `0` tracked · **33** untracked · `rule_gate_verify.py` exists, 47 141 bytes, mtime **2026-09-18 07:28** | 0 | All Free Cash work is untracked (in-place edits produce no reviewable diff); the shipped verifier is present but **was not re-scoped** by this pass |
| E21 | `ls -d data/freecash server/data/freecash-monitor` | both exist | 0 | **Three state roots coexist** with `data/freecash-monitor` — a live divergence risk, still undecided |
| E22 | `sha256sum data/…/state/last-run.json data/…/alerts/alerts.jsonl` before and after every invocation · `find data/freecash-monitor -type f -newermt "2026-10-01 10:00"` | `a287a902…3bf9` / `1b9c7c07…99a8` **byte-identical both times**; **no file** newer than 10:00 | 0 | **Hermeticity proven by hash**, not by intention. Nothing this pass wrote into the production root |
| E23 | `<venv> -c "…ZoneInfo('Europe/Berlin')…"` · `C:/Python314/python.exe -V` · `which -a python3` | `venv-python 3.11.9` · `tzdata OK` · `3.14.7` · `…/WindowsApps/python3` | 0 | The interpreter split is real and must be pinned explicitly in every command and in the scheduler XML |

| E24 | Re-ran the E22 hash pair **after** writing this document · `find data/freecash-monitor -type f -newermt "2026-10-01 10:00"` · `find docs .hermes -type f -newermt "2026-10-01 10:00"` · `git status --porcelain \| wc -l` | hashes still `a287a902…3bf9` / `1b9c7c07…99a8`; **0** production files newer than 10:00; repo output includes `docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/{DELEGATION-BRIEF-R4.md, PARENT-BRIEF-R4.md, scheduler/raw/*, verify/…}` at 11:39–11:43; porcelain count unchanged at **870** | 0 | Hermeticity holds through the write. **Two disclosures:** a concurrent R4 delegation session is writing in this repo right now (its paths are not this pass's footprint), and the porcelain count **cannot** be used as the footprint proof here — `docs/freecash-monitor/` is already an untracked directory, so this new file does not move the count. The hash pair and the `-newermt` window are the proof |

**Net.** The pipeline is executable, tested, package-gate green and honest about being degraded — and it is still **never scheduled**, its **only real input has been empty for 11 days**, its **watchdog reports uncovered days as covered**, its **day lock is taken before any read**, and **today's key is already spent**.

---

## 1. Binding operational constraints

**Rule numbering.** This repo carries at least three incompatible numberings and at least one of them is inverted *inside its own file* (E15, and the `automated-status-monitor` pitfall). This document therefore always names the rule by **title**, and gives the scheme only where a scheme is required.

| Title (binding) | Mechanism | Proof demanded |
|---|---|---|
| **No automated earning action** (never transact, withdraw, cash out or spend) | `readonly_client.request()` refuses non-`GET`/`HEAD`, any body keyword, any non-loopback host, any non-allowlisted path; `verify_readonly.py` grep gate | `python monitoring/freecash/verify_readonly.py` → `forbidden=0`, exit 0, **in the pass that makes the claim** |
| **Exactly one status read per operator-local calendar day** | Atomic `O_CREAT\|O_EXCL` day lock in `gate.acquire_day_lock` | Second run on the same day prints `SKIP_DUPLICATE_DAY` and writes nothing |
| **Notify only on a change** in earnings or status | Prior snapshot loaded before the new one is written; one dedupe key per change recorded before dispatch | A no-change day produces 0 notifications; a changed figure produces exactly 1 |
| **Human approval before ANY external action** | Approval queue stores `execution_state=NOT_EXECUTED`, `expires_at_utc=None`; no code path acts on an approved status | Frozen-field assertion after a decision; every decision attributable to a named human |
| **Evidence is live tool output** | Each claim carries the command, its raw output and its exit code from the same pass | No PASS is quoted across sessions; a verifier is trusted only after it has been shown to **fail** on a planted violation (E14 satisfies this for the R3 gate; E16 does not) |
| **No secrets in any artifact, log or chat** | Credentials via env only; `[REDACTED]` | `env` grep for `FREECASH_*`/`SMTP_*`/`WEBHOOK_*` before any document is accepted (E8: 0) |
| **Do not disturb unrelated uncommitted work** | Additive only; new files only; no `git` mutation | `git status --porcelain` count moves only for files this pass created (E22) |
| **One executable path per job** | `monitoring/freecash/` is the single implementation | `ls` / `node --check` / `py_compile` before adding anything (E17, E18 are the standing counter-examples) |
| **Sandbox isolation proven by hash** | Execution pins `FREECASH_DATA_ROOT` to a throwaway root and refuses to run unpinned | `sha256` pair of the production `last-run.json` + `alerts.jsonl` + `find … -newermt` (E22) |
| **Registering a scheduler entry is itself an external action** | Only the human runs `schtasks /create /xml`; the agent produces the payload | The proof of firing is the day-key artefact, never the task list |
| **Degraded is not success** | `MONITOR_DEGRADED` out of `SUCCESS_OUTCOMES`, or coverage keyed on the snapshot's `data_available` | A data-less day reports `WATCHDOG_MISSED_DAY` and does not advance `last_success_day` (today: FAILS — E3, E4, E12) |
| **No back-fill** | `gate.missed_days()` excludes today and the last success; `--force-recheck` exits 3 and is audited | A missed day is reported, never re-read |
| **A rule is never cited by number alone** *(new, E15)* | Every rule reference names the title; a scheme is quoted only with its source file and line | A reviewer who takes "R2 = zero earning actions" from one document and reads the gate's `R2` must not be able to mis-map — the titles are the contract |
| **A gate verdict must name its scope and exit code in the same pass** *(new, E14/E16)* | Gate claims read `<checker> <scope> → exit N` together | `VERDICT: COMPLIANT` from a package-scoped gate ≠ `4/4 passed` from a file-scoped static grep (E14 vs E16) |
| **An inherited health/outage row expires** *(new, E9)* | Ports and processes are re-measured in the pass that relies on them | v3's `:4600 = 200` was true at 09:2x and is `000` at 11:36; the row is re-run, never repeated |

---

## 2. The workflow plan — stages `W1…W11`

Ordering rule: nothing downstream is observable until the day budget is honest and a real reading exists. Effort and revenue figures are planning estimates, not measurements. **"Time-to-Revenue" means time until the routine delivers its business value — visibility plus an audit-ready trail — because the first constraint forbids the routine moving money at all.** No stage below produces cash, and the plan says so rather than pricing a fiction.

### W1 — Make the day budget honest *(the one change that stops the bleed; do this first)*
| Field | Value |
|---|---|
| Expected Effort | 40 min (failing test first, then two edits) |
| Time-to-Revenue | **none** — buys truthfulness, not cash; prevents every later day being silently miscounted |
| Dependencies | none; `gate.py:32-41`, `gate.py:198-200`, `watchdog.py:33`; `tests/test_r5_smoke.py` (its assertion must be inverted, not deleted) |
| First Concrete Action | Write the failing test **first**: *"a run with `data_available=false` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog print `WATCHDOG_MISSED_DAY`"* — it fails against today's bytes (E3, E10, E12). Then remove `MONITOR_DEGRADED` from `SUCCESS_OUTCOMES` (or key `watchdog.py:33` on the snapshot's `data_available`) and paste `tests/run_all.py` → `failures=0` **with the new test in the count** |
| Exit criteria | `python monitoring/freecash/tests/run_all.py` → `tests=53 failures=0 errors=0`, exit 0; a data-less scratch run leaves `day-locks/` empty and emits `WATCHDOG_MISSED_DAY`; `verify_readonly.py` still `forbidden=0` |

### W2 — Pre-flight guard (defence in depth, not a substitute for W1)
| Field | Value |
|---|---|
| Expected Effort | 1 h |
| Time-to-Revenue | none — stops a day being spent before the source is consulted |
| Dependencies | W1; reuse `DELEGATION-2026-10-01/scheduler/freecash-guarded-run.sh`, do **not** write a second wrapper |
| First Concrete Action | Extend the existing guarded runner to exit non-zero **without invoking** `run_daily_check.py` when (a) `FREECASH_DATA_ROOT` is unset or equals the production root, or (b) `operator-state.json` has no record for today's `day_key`; prove both refusals plus one control run against a throwaway root in one pasted block, with the E22 hash pair around it |
| Exit criteria | two refusals + one control run, all pasted; production hash pair unchanged; exactly one runner file in the tree |

### W3 — Fix the day-consumption ordering (lock before any socket, never before the source)
| Field | Value |
|---|---|
| Expected Effort | 2–3 h including the regression test |
| Time-to-Revenue | none directly; converts the routine from "spends days" to "spends a day only when it has a reading" |
| Dependencies | W1; `run_daily_check.py:307-312` and `:371-372`; the 52-test suite |
| First Concrete Action | Resolve the day key and read the **local** source (`operator_state`) **before** `gate.acquire_day_lock(day)`, keeping the lock before any **socket** so `metrics_http` can never read twice; add the missing regression test — *"run with no record → no lock file, no snapshot, non-zero exit"* — and paste `run_all.py` output naming the new test |
| Exit criteria | the new test exists and passes; a scratch run with no record creates no lock and no snapshot; a second same-day run still prints `SKIP_DUPLICATE_DAY` |

### W4 — First real operator reading *(human-owned; the only source of a true signal)*
| Field | Value |
|---|---|
| Expected Effort | ~1 h setup + ~60 s/day |
| Time-to-Revenue | **same day, visibility only** — earliest free day key is **2026-10-02** (E2) |
| Dependencies | W1 **must land first** (else the first data-less run burns the next day, proven twice), the honest decision on the spent day (§5 D-2), a free day key, the pinned interpreter with `tzdata` (E23) |
| First Concrete Action | The operator opens their own dashboard in a browser, logs in themselves, and appends **one** record to `state/operator-state.json` with today's `day_key` and the four figures in integer cents; then invoke once: `<venv>\python.exe D:\AgenticOS\monitoring\freecash\run_daily_check.py --source operator_state` and paste the `RUN_OK … outcome=INITIAL_BASELINE` line |
| Exit criteria | a baseline snapshot with `data_available:true`; `operator-state.json` `records` length ≥ 1 (today: 0, E6); a later day with a moved figure produces exactly one payload, one dedupe key, one approval item |

### W5 — Consolidate the rule gate (port, do not add a third gate)
| Field | Value |
|---|---|
| Expected Effort | 3–5 h |
| Time-to-Revenue | none — removes the class of false greens that produced every past `COMPLIANT` claim |
| Dependencies | W1, W2; the delivered `DELEGATION-2026-10-01-R3/gate/rule_gate.py` (E14) and the shipped `scripts/monitoring/rule_gate_verify.py`; the R2 mutant trees |
| First Concrete Action | Add `--package <dir>` to the **shipped** `scripts/monitoring/rule_gate_verify.py` and move the R3 detectors under it, so that exactly **one** gate file is reachable from the repo root; then re-run the mutation harness with a throwaway `--workdir` and require a **closed** mutant set (E14's self-test is the falsifiability half; the 10/10 table is `inherited` and must be reproduced) |
| Exit criteria | one gate file at the repo root; `→ exit 0` on `monitoring/freecash`; **non-zero exit on every mutant**; the surviving-mutant count quoted, or `0` with the harness output pasted |

### W6 — Rule 4 identity: replace the denylist with a fail-closed allowlist
| Field | Value |
|---|---|
| Expected Effort | 2–3 h |
| Time-to-Revenue | none; it is what makes the queue usable as evidence |
| Dependencies | W4 (the production queue has never held an item, E7); the prepared patch in `DELEGATION-2026-10-01/delivery/` and `DELEGATION-2026-10-01-R3/identity/` |
| First Concrete Action | Failing test first: *"a decision naming `hermes-agent` is refused when the allowlist does not contain it"* (today it is accepted); then key acceptance on `FREECASH_OPERATOR_IDENTITY` / `state/operator-identity.json` and refuse **all** decisions when unset |
| Exit criteria | one run proving **both directions** (`hermes-agent` refused / operator name accepted); frozen fields (`execution_state=NOT_EXECUTED`, `expires_at_utc=None`) survive even a wrongly-accepted decider; a `PENDING` item is unchanged after any clock advance |

### W7 — Alert attribution and catch-up coalescing
| Field | Value |
|---|---|
| Expected Effort | 1–2 h now, ~2 min/day after |
| Time-to-Revenue | none |
| Dependencies | none (parallel); `alerts.jsonl` (15 lines, none carrying a writer key, E5) |
| First Concrete Action | Add a writer tag (pid + entry point + start time) to every **new** line, and coalesce missed-day catch-up so N missed days reach the operator as **one** payload naming N and the day keys |
| Exit criteria | a new line's origin is identifiable from the line alone; N missed days → 1 payload; no existing line edited or deleted |

### W8 — Deprecation index (label and disable, delete nothing)
| Field | Value |
|---|---|
| Expected Effort | 1–2 h, read-only |
| Time-to-Revenue | none — removes the false-compliance surface that E16/E17/E18 keep alive |
| Dependencies | none; W1–W5 not required to start |
| First Concrete Action | Write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs`, `server/scripts/verify-freecash-rules.mjs` and `server/src/adapters/freecashMonitorAdapter.ts`, each with the defect and the gate command that exposes it (`node --check` exit 1, `py_compile` exit 1, the decoy's tautologies), naming `monitoring/freecash/` as the single implementation; and correct the false compliance table in `server/data/freecash-monitor/INTEGRATION_STATUS.md` |
| Exit criteria | index exists; **no file moved, edited or deleted**; no compliance claim anywhere in the repo originates from `verify-freecash-rules.mjs` |

### W9 — Scheduler handover (human registers; the agent never does)
| Field | Value |
|---|---|
| Expected Effort | 1–2 h + the operator's approval |
| Time-to-Revenue | none — it is the precondition for unattended operation ever being claimable |
| Dependencies | W1, W3, W4; a green W5 (or a written override); the `DELEGATION-2026-10-01/scheduler/*.xml` payloads; resolution of the Task-A-before-reading-window ordering question (§5 D-6) |
| First Concrete Action | Hand the operator the exact non-elevated `schtasks /Create /XML` text for both payloads, interpreter pinned to the venv path, `IgnoreNew`, `StartWhenAvailable`, restart disabled — and **do not register it**; re-run `python -c "ET.parse(...)"` on both payloads **in that same session** (their parse status is not inheritable) |
| Exit criteria | `ET.parse` exit 0 on both payloads in the handover session **and** `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and policies; **or** a recorded decision not to schedule, in which case the routine is described as *built and unverified in operation* |

### W10 — Provider read contract *(blocked; keep the honest source)*
| Field | Value |
|---|---|
| Expected Effort | unknown — unknown-unknowns heavy; the only step that could produce a real earnings signal |
| Time-to-Revenue | **BLOCKED.** No self-serve read-only earning contract is documented; the loopback substitute `:3001` is dead (E9) and `:4600` is down now too |
| Dependencies | a documented read-only contract for the chosen provider; credentials as env only (first constraint); a **two-line** allowlist change (host **and** path — a path alone is still refused at the host check); `read_metrics()`/`probe_status()` currently pass no headers, so credential plumbing does not exist |
| First Concrete Action | One manual, human-driven, read-only request in a browser/devtools session to whichever provider account exists; record status code and field names with `[REDACTED]` values. If no documented read-only contract exists, close the gap honestly as **UNRESOLVABLE** and keep `operator-state.json` as the permanent, plainly-labelled source |
| Exit criteria | either a recorded contract plus a passing read through the allowlist, or the recorded UNRESOLVABLE verdict — no third state |

### W11 — Authoritative state root
| Field | Value |
|---|---|
| Expected Effort | 30–60 min (decision + a pointer file) |
| Time-to-Revenue | none; prevents two roots silently diverging |
| Dependencies | `data/freecash`, `data/freecash-monitor`, `server/data/freecash-monitor` all exist (E21) |
| First Concrete Action | Choose `data/freecash-monitor` (the root the pinned interpreter actually writes and the gate hashes) and record it in one line in the docs plus a single pointer note in the two losers; state the divergence window each one covers |
| Exit criteria | one declared root; the other two labelled read-only legacy with a date; no file deleted |

---

## 3. Options table

Everything below carries the four required columns. `none` for Time-to-Revenue is deliberate: this routine is a **visibility instrument**, and claiming otherwise would be the fiction these plans exist to prevent.

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action | Verdict |
|---|---|---|---|---|---|---|
| Day budget (W1) | **Honest accounting only** — `MONITOR_DEGRADED` out of `SUCCESS_OUTCOMES`, coverage keyed on `data_available`, the smoke assertion inverted | 40 min | none | none | failing test first, then two edits (`gate.py:32-41`, `watchdog.py:33`) | **RECOMMENDED — shortest honest change; makes the watchdog truthful** |
| Day budget (W1) | Two-phase lock (attempt becomes a consumed day only on a successful read) | 3–5 h | none | none | failing test, then attempt-then-consume | rejected for now: quietly weakens "one read per day" to "one **successful** read per day" — a written decision, not a default |
| Day budget (W1) | Wrapper pre-flight only (W2 without W1) | 1 h | none | a wrapper that is itself scheduled | guard on `day_key` + record presence | rejected **alone**: the 08:53 leak was itself a wrapper-shaped path. Adopt *with* W1 |
| Day budget (W1) | Stay manual, no change | 0 h | none | none | none | rejected: leaves the routine unable to be scheduled honestly, forever |
| Day ordering (W3) | Local-source-first, lock-before-socket | 2–3 h | none | W1 | move the read above `:309`, keep the lock above `:372` | **RECOMMENDED** |
| Day ordering (W3) | Lock last, before the socket only, and accept double local reads | 1 h | none | none | reorder only | rejected: a crashed run then re-reads and double-notifies; Rule 3 breaks |
| Rule gate (W5) | **Port the R3 detectors into the shipped verifier; close the mutants** | 3–5 h | none | delivered artefacts + R2 mutants | add `--package`, move the detectors, re-run the harness | **RECOMMENDED** |
| Rule gate (W5) | Adopt the delivered `rule_gate.py` as-is and label the old one | 0.5 h | none | none | file move + label | rejected: ships a **third** gate with its own blind spot; one implementation per job |
| Rule gate (W5) | Keep the decoy `verify-freecash-rules.mjs` because it is green | 0 min | none | none | none | **REJECTED outright — E16/E17: it certifies a file that cannot parse** |
| Rule 4 identity (W6) | **Fail-closed allowlist** (`FREECASH_OPERATOR_IDENTITY` / `state/operator-identity.json`) | 2–3 h | none | W4 | failing test first, then the source switch | **RECOMMENDED** |
| Rule 4 identity (W6) | Extend the denylist with more words | 10 min | none | none | add strings | **REJECTED — the same defect class one edit later** (a decision was recorded as `decided_by='hermes-agent'`) |
| Alert surface (W7) | Writer tag + N→1 coalescing | 1–2 h | none | none | add the tag; coalesce | **RECOMMENDED** |
| Alert surface (W7) | Leave the log as-is | 0 h | none | none | none | rejected: 15 lines, none attributable to a writer (E5) |
| Scheduling (W9) | Hand over the `schtasks` XML, register nothing | 1–2 h | none | W1, W3, W4, green W5 or an override, D-6 | hand over the exact text; re-run `ET.parse` in that session | **RECOMMENDED** |
| Scheduling (W9) | Register now from this pass | 0.2 h | none | — | `schtasks /Create /XML` | **REJECTED — registering is itself an external action (human-only), and it is blocked on W1** |
| Revenue (W10) | Resume provider integration | unknown | **the only revenue hypothesis, and it is unbounded** | a documented read-only contract; the app running; a human decision | one manual devtools read | blocked; see §4 |
| Revenue | 4-rule pattern as a template for others | 8–16 h | month 1–2, speculative | W1 + a demonstrably falsifiable W5 | only after W5: describe the corrected monitor plus a gate shown to fail on planted violations | not priced as revenue here; the earlier projections are `inherited` |
| Revenue | Micro-SME SaaS (`opp-4a3f4cfc`) | 40–80 h to MVP | month 6–9 as written | domain spend, payment processor, a real data layer (W10) | human decides on the spend | outside this routine; projections `inherited` and unvalidated here |

**Shortest honest path:** W1 → W3 → W4 (all of it in one sitting, none of it producing revenue) → then W2 · W5 · W7 · W8 → W6 after W4 has produced a real queue item → W9 only on a written decision → W10 as a research question, not a workstream.

---

## 4. Blocked register

| Item | Blocked on | Reason (measured this pass) |
|---|---|---|
| Any reading for 2026-10-01 | the human's incident decision (§5 D-2) | `2026-10-01.lock` exists (mtime 08:53, E2) and the day's snapshot is already fixed as null (E4) |
| Unattended operation being *safe* | W1 | a data-less run spends the day **and** books it as a success with a reset miss counter (E3, E12) |
| Any `COMPLIANT` claim on the shipped verifier | W5 | the shipped `rule_gate_verify.py` (mtime 2026-09-18) is file-scoped and has no `--package` (E20); the delivered gate is package-scoped and green (E14) but is not the shipped one |
| Trustworthy "the monitor is alive" signal | W1 | `MONITOR_DEGRADED` is still in `SUCCESS_OUTCOMES` (E12) |
| Live account / provider status | a documented read-only contract + the backend being up | `:4600` and `:3001` both `000`; zero listeners (E9) |
| Email / SMS / webhook alerting | a configured transport | only the toast dispatch is implemented; no `SMTP_*`/`WEBHOOK_*` env is set (E8) |
| Any earning or withdrawal action | the approval gate; human-only by design | must never run unattended; no execution path exists, and the decider guard is still a denylist |
| Strong Rule 4 attribution | W6 (patch prepared, unapplied) | `hermes-agent` was accepted as a decider |
| Writer attribution in the alert log | W7 | 15 lines, none carrying a writer key (E5) |
| Authoritative state root | the human's decision D-4 | three roots coexist (E21) |

---

## 5. Decisions the operator must take

| # | Decision | Owner | Consequence if deferred |
|---|---|---|---|
| D-1 | W1 remedy shape (honest accounting / two-phase / wrapper / manual) | operator | every unattended run keeps spending a day and hiding it |
| D-2 | 2026-10-01: accept the breach and keep the lock, **or** remediate under a named human and append (never rewrite) a corrective note to `alerts.jsonl` | operator | the incident stays open and every later status sentence must repeat that the day was spent by a run that read nothing |
| D-3 | W6 identity remedy: allowlist vs recorded residual risk | operator | `hermes-agent`/`assistant`/`claude` remain acceptable deciders |
| D-4 | Authoritative state root (W11) | operator | two roots can silently diverge |
| D-5 | Deprecation index only, or removal of the dead implementations (W8) | operator | a green 4/4 report certifying an unparseable file stays available to any future reader |
| D-6 | Task A time: move it after the reading window, or adopt W2 as well | operator | a morning run spends each day before any figures exist |
| D-7 | Schedule at all (W9), and if so when the app must be running for the toast channel | operator | the routine stays *built and unverified in operation* |
| D-8 | W10: pursue the provider contract, or record UNRESOLVABLE and keep the operator-entered source | operator | the routine stays a visibility instrument |

---

## 6. Non-goals

No rewrite, move or deletion of any legacy or parallel monitor — label and disable, never delete. No live financial write path in any option, including as an example. No compliance claim from a static grep, a stale artefact, or a PASS quoted from another session. No modification of the 870 pre-existing uncommitted paths. No `git` mutation of any kind. No scheduler registration by an agent. No modification of the production state root. No new checker, harness or monitor file — porting the existing one is a stage, a third gate is a defect. No voice/Jarvis or unrelated revenue-pipeline component touched.

---

## 7. Definition of done

1. A data-less run leaves **no** day lock, does not advance `last_success_day`, does not reset `consecutive_missed_days`, and is reported as `WATCHDOG_MISSED_DAY` (W1, W3).
2. `python monitoring/freecash/tests/run_all.py` → `failures=0`, exit 0, with the new no-record test in the count and the degraded-day assertion inverted.
3. `python monitoring/freecash/verify_readonly.py` → `forbidden=0 exempt=28 missing_targets=0`, exit 0.
4. Exactly **one** gate file is reachable from the repo root, it is package-scoped, it exits 0 on `monitoring/freecash`, and it exits non-zero on **every** mutant in the harness (W5).
5. One real reading consumed; one real change notified exactly once; one approval item decided by a named human on an allowlist with `execution_state` still `NOT_EXECUTED` and `expires_at_utc` still `None`.
6. Ten consecutive daily runs, exactly one per day, with one deliberate duplicate-day refusal on record.
7. Watchdog: healthy day silent; uncovered day exactly one alarm; a multi-day catch-up arrives as **one** payload naming N and the day keys.
8. Every `alerts.jsonl` line attributable to a known writer; no line edited or deleted.
9. Both scheduled-task payloads `ET.parse` exit 0 **in the registering session**, quoted with the pinned 3.11.9 interpreter — or a recorded decision not to schedule.
10. No credential anywhere (E8 stays 0); no unrelated uncommitted path modified; **no earning, withdrawal or transaction action performed by anything, in any option**.
11. Every stage states its Time-to-Revenue, and no stage outside the provider question claims a path to cash.
12. Every pass states its `FREECASH_DATA_ROOT` and quotes the production-root hash pair before and after, with the timestamp of its window (E22 is the form).
13. The 2026-09-30 and 2026-10-01 decisions are recorded with the operator's name, and every later status sentence states that both days were spent by runs that read nothing.

---

## 8. Honest reading

The routine is a tested, gate-green **visibility** instrument that has never been scheduled and has never held a single operator figure, and today it proves both halves of its own defect in one place: `last-run.json` books 2026-10-01 as a success while the snapshot for that day contains nothing and its own lock makes the day unrepeatable.

*(Written in one pass; exactly one file created — this one. Repository: `D:\AgenticOS`.)*

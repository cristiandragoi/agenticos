# WORKFLOW PLAN R4 — the daily status routine, executable order

**Repository:** `D:\AgenticOS` · **Written:** 2026-10-01 · **Pass window:** `11:37:50` → `11:42` local (Europe/Berlin)
**Companion:** `../DELEGATION-BRIEF-R4.md` (rules, acceptance bar, live state) · **Research questions:** `../research/RESEARCH-PLAN-R4.md`
**Subject:** the once-daily, read-only status routine for Free Cash Finance Automation — canonical implementation `D:/AgenticOS/monitoring/freecash/`, entry point `run_daily_check.py`.
**Evidence standard:** every number below is from this pass (`../source/raw/00-parent-pass-2026-10-01-1142.txt`). Sibling artefacts are named with their mtime and are never inherited as fact (C30).

**Rule numbering is printed with the title** because the shipped gate inverts it: operator **R1 = zero earning actions**, **R2 = exactly one status read per Europe/Berlin calendar day**, **R3 = notify on earnings/status change once per change**, **R4 = human approval before any external action, no execution path**. The shipped `rule_gate_verify.py` prints `R1 = once per day`, `R2 = no earning action`.

---

## 1. Ordering and the one-change rule

`S1 → S11 → S3 → S0′ → S1b → S8′/S9′ (parallel) → S4 / S5 / S6 → S7 → S10`

- One change between gate runs; never widen an allowlist and exempt a scanner hit in the same change.
- A stage is complete only on output produced **in the session that claims it**; sibling PASS lines expire in minutes (C30).
- `S10` is not part of the routine; it is carried so the revenue hypothesis is not silently dropped (C20: the monitor is a visibility instrument, not a revenue instrument).

---

## 2. Stages — Expected Effort · Time-to-Revenue · Dependencies · First Concrete Action

### S1 — Make the day budget honest (R2 + R3). Highest value per hour.
**Why it is first:** a data-less run consumes the day, writes a null snapshot, advances `last_success_day` and zeroes `consecutive_missed_days` — proven twice in production (`2026-09-30`, `2026-10-01`; this pass A4/A5). The watchdog keys coverage on that same ledger, so an unread day prints as covered.
**Expected Effort:** ~40 min (O-1) · 3–5 h (O-2) · ~1 h (O-3, insufficient alone) · 3–6 h (O-4) · 0 h (O-5)
**Time-to-Revenue:** none (visibility only)
**Dependencies:** none — self-contained code + tests; no provider, no credential, no human
**First Concrete Action:** write the **failing test first** — *"a run with `data_available=False` advances neither `last_success_day` nor `day-locks/`, leaves `consecutive_missed_days` untouched, and makes the watchdog print `WATCHDOG_MISSED_DAY`"* (today it prints neither: `gate.py` lists `MONITOR_DEGRADED` among `SUCCESS_OUTCOMES` and the watchdog keys on the ledger), then key coverage on `data_available`, not on process completion.
**Exit:** a data-less run ⇒ no lock, `last_success_day` unchanged, miss counter preserved, `WATCHDOG_MISSED_DAY`; a day with a reading ⇒ exactly one lock, one snapshot, and `SKIP_DUPLICATE_DAY` on a second run. All of it against a **throwaway `FREECASH_DATA_ROOT`**, never the production root.
**Options:** **O-1 honest accounting only (~40 min — smallest change that makes the watchdog truthful; recommended)** · O-2 two-phase lock + accounting (3–5 h; weakens "one read per day" to "one *successful* read per day" — must be stated in the decision record) · O-3 wrapper pre-flight guard (~1 h; defence in depth, **insufficient alone** — the 2026-09-30 run was itself a wrapper path) · O-4 O-2 + O-3 · O-5 stay manual (unattended operation stays blocked).

### S11 — Close the 2026-10-01 incident and decide the day (operator-owned; no agent may execute it).
**Expected Effort:** 10 min of decisions (+1 command if remediated)
**Time-to-Revenue:** same-day visibility if remediated; none if accepted
**Dependencies:** a human decision; if remediated, it happens **before** any run against the production root (C24 — a spent day is spent)
**First Concrete Action:** record three answers in writing — (1) is the `08:53:46` run accepted as a documented breach of R2's intent, (2) does `2026-10-01.lock` stay, (3) is a corrective note **appended** (never rewritten) to `alerts.jsonl`? If remediated: hash the root, remove the lock, re-read the root, append the note, state that the R2 record now understates what happened.
**Exit:** three answers recorded beside this section; every later status states that `2026-09-30` **and** `2026-10-01` were spent by runs that read nothing.
**Options:** **O-A accept the breach, keep the lock (0 effort; the record stays true — recommended default)** · O-B remediate the day (10 min; recovers one read; only defensible with the appended note).

### S3 — First real operator reading. The fastest honest path to a number.
**Expected Effort:** 1 h setup (once) + ~60 s/day
**Time-to-Revenue:** **same day — visibility only**, no cash (C20)
**Dependencies:** S1 (else the first data-less run burns the next day, proven twice) · S11 decided · a free day key (C24) · venv 3.11.9 (C10) · the operator's own dashboard login (the routine never authenticates to a provider, R1)
**First Concrete Action:** the operator appends **one** record to `data/freecash-monitor/state/operator-state.json` for a free `day_key` with four integer-cent figures (`records: []` today, A7), then runs the entry point **once** through the 3.11.9 interpreter and quotes the `RUN_OK … outcome=INITIAL_BASELINE` line.
**Exit:** a day-1 baseline snapshot with `data_available: true`; a later day with a changed figure produces exactly one notification payload and one approval item.
**Honest limit:** every snapshot from this source is `degraded: true` by construction — a "no change" day proves the same numbers were typed twice, nothing more.

### S0′ — Consolidate the gate: port the delivered detectors into the shipped verifier; close the two evasions and the attribution gap. **Blocking for the acceptance gate (C9).**
**Why:** the shipped gate cannot accept a directory at all (`--package` → exit **2**) and fails its own R1 on the file-scoped target (exit **1**), while the delivered gate is green on the canonical package (exit **0**, A/G4) and catches all 8 semantic mutants. This is a **port**, not a rebuild.
**Expected Effort:** 2–4 h (1–2 h port + 1–2 h for the two obfuscation evasions + a smaller fix for the R1 attribution gap)
**Time-to-Revenue:** none — this buys the verdict, not cash
**Dependencies:** `DELEGATION-2026-09-30/verifier/rule_gate.py` (present, mtime 2026-09-30 21:09) and the adversarial harness under `DELEGATION-2026-10-01/verifier/` (**do not create a second gate or a second harness** — one implementation per job)
**First Concrete Action:** add `--package <dir>` to `scripts/monitoring/rule_gate_verify.py` (its argparse today is `target [--run] [--json] [--json-out]`, exit 2 on `--package` — measured) and move the four detectors under it; then re-run the adversarial harness and require **every** row `detected=YES` **with the correct rule named**.
**Exit:** `python scripts/monitoring/rule_gate_verify.py monitoring/freecash --package` → exit **0**, `R1=R2=R3=R4=PASS`, **and** exit non-zero on every mutant with the failing rule named per row (C25/C29); exactly one gate file reachable from the repo root (C8/C16/C23).
**Options:** **O-A′ port + close both evasions + fix the attribution gap (2–4 h — the detectors already work; recommended)** · O-B′ move the delivered gate in as-is (0.5 h; ships a third gate *and* live evasions) · O-C′ operator override of C9 in writing (0.2 h; loses the automatable gate) · O-D′ inline the lock into the file-scoped target (3–5 h; **rejected** — R2–R4 would still fail, the shipped verifier is file-scoped by construction).

### S1b — Fix the concurrency flake (C28). Blocks any unattended timer.
**Expected Effort:** 1–3 h (`test_five_concurrent_runs_yield_one_winner`: 3 red in 26 runs, `3 != 4`; the production lock is atomic by syscall, so this reads as a harness/start-order race, not a lock defect)
**Time-to-Revenue:** none
**Dependencies:** none; may run parallel to S0′ but must land **before** S7
**First Concrete Action:** reproduce (N=26 suite runs with a pinned scratch root, capture the failing assertion; the sibling artefact `DELEGATION-2026-10-01/verifier/concurrency-flake-evidence.txt`, mtime 09:17, is the starting point — re-read it first), then instrument the **writer count per run** instead of the winner count.
**Exit:** 26 consecutive green runs (the same N that produced 3 red) with the failure text absent; every future concurrency attestation quotes N and the failure count.
**Options:** **O-a diagnose then fix (1–3 h)** · O-b assert lock-file count rather than winner (0.5–1 h; weaker invariant, must be stated as such) · O-c `xfail` + accept the flake (0.2 h; **rejected** — removes the only concurrency evidence).

### S8′ — Alert attribution + burst coalescing.
**Expected Effort:** 1–2 h now, ~2 min/day after
**Time-to-Revenue:** none (false-compliance risk control)
**Dependencies:** none (parallel)
**First Concrete Action:** add a writer tag (pid + entry point + start time) to each **new** `alerts.jsonl` line — all 15 existing lines carry none (A6) — and coalesce missed-day catch-up so N missed days reach the operator as **one** payload (C22: no machine-timed bursts).
**Exit:** a new line's origin is identifiable from the line itself; the next bundle's baseline **includes** the `2026-09-21` unattributed line, the 09-30 burst and today's line, so nothing is laundered.

### S9′ — Deprecation index (delete nothing).
**Expected Effort:** 1–2 h, read-only
**Time-to-Revenue:** none — false-compliance risk control
**Dependencies:** none
**First Concrete Action:** write `docs/free-cash-monitor-routine/IMPLEMENTATION-INDEX.md` listing, each with its exact gate command and verdict: `finance-monitor/`, `scripts/finance_monitor.py`, `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `server/scripts/freecash-daily-monitor.mjs` (**does not parse: `node --check` exit 1, `Unexpected token ':'` line 41 — measured this pass**), `server/scripts/verify-freecash-rules.mjs` (DEPRECATED — do not cite as compliant), `server/src/adapters/freecashMonitorAdapter.ts` (hardcoded `externalConnected: false`, absent from the runtime registry), naming `monitoring/freecash/` as the single implementation.
**Exit:** index exists; no file moved, edited or deleted; no false premise survives in the tree.

### S4 — Bridge the authenticated app path into the routine's source. Ranked first target for real sight of the account.
**Expected Effort:** 4–8 h
**Time-to-Revenue:** 3–7 days of sight of the real account; **no revenue** (C20)
**Dependencies:** a human starts the desktop app and authenticates (this pass: the API answers on `:4600`, the desktop shell is not running), the existing interactive-login path, a live authenticated session, field names fixed in writing, **S1 resolved first**
**First Concrete Action:** start the app, call the existing probe once through the app's own path, quote its evidence artefact, then write the four-field mapping (`account_status`, `earnings_total_cents`, `balance_cents`, `pending_cents`) into the shape `operator_state.py` already reads. Mapping work is delegated to **RS-2** — reuse its output, do not re-derive it.
**Do not:** create a third monitor; add a provider host to the read-only allowlist; extend the stub adapter that enforces no rule.
**Exit:** one day's reading produced through the app path and consumed by the existing source; `verify_readonly.py` still `forbidden=0 exempt=28`; no new monitor module in `git status`.

### S5 — Delivery: prove the one sink.
**Expected Effort:** 0.5–1 h · **Time-to-Revenue:** none · **Dependencies:** S3 or S4
**First Concrete Action:** with the session unlocked, dispatch one real toast and record the label; then lock the session and repeat to observe the bounded-failure path.
**Blocked:** email / SMS / webhook — no mail tooling and no sink credentials in the ambient environment; only the toast sink is implemented (RS-4 backlog).

### S6 — Approval surface (R4), including the identity defect.
**Expected Effort:** 2–4 h (+1 h if the provenance control is adopted)
**Time-to-Revenue:** none
**Dependencies:** S3 or S4 (the queue has never held an item)
**First Concrete Action:** decide one enqueued item as a named human taken from an **operator-editable allowlist** (`state/human-deciders.json`) and quote the append-only row together with `execution_state` staying `NOT_EXECUTED`; then attempt a machine-labelled decider and record the refusal — in **one** run (the live guard is a bypassable ten-word **denylist**, and `hermes-agent` is currently *accepted*; a denylist test proves the labeller, not the provenance).
**Exit:** every decision attributable to a human identity set outside the routine; a `PENDING` item survives any clock advance unchanged; state the two properties separately — "an approval can never arm an action" (holds, frozen fields) vs "only a human can sign" (does not hold today).

### S7 — Schedule Task A + Task B — handover only, human-registered. **Still blocked.**
**Expected Effort:** 1–2 h plus the operator's approval
**Time-to-Revenue:** none (the routine is a visibility instrument, C20)
**Dependencies:** green automatable gate (S0′) · S1 (O-1 minimum) · S1b (C28) · S3 · a single pinned state root
**First Concrete Action:** re-parse both registration payloads in the pass that hands them over (`ET.parse`; a previous pass reported raw-`&` failures and the next reported clean parses — the state is not inheritable), confirm the pinned interpreter inside `<Arguments>` is the 3.11.9 venv, confirm `IgnoreNew` + `StartWhenAvailable` + restart-on-failure = **Do not restart**, then hand the operator the exact non-elevated `schtasks /Create /XML` text and **do not register it**.
**Exit:** `ET.parse` exit 0 quoted for both payloads; `schtasks /Query … /V /FO LIST` quoted showing the pinned interpreter and both policies; or an explicit recorded decision not to schedule — in which case the routine is described as *built and unverified in operation*. Measured today: 278 tasks, **0** Free Cash; no cron jobs.

### S10 — The revenue path (not the monitor; carried so it is not silently dropped).
**Expected Effort:** unknown (a human decision and a worker re-dispatch come first)
**Time-to-Revenue:** the only stage with a direct revenue hypothesis, and it is unbounded
**Dependencies:** a human decision, the app running, a publication step that does not exist
**First Concrete Action (option R-a):** with the app running, resume the blocked mission in the UI and re-quote its blocker from the live UI before acting (never from an inherited status row).
**Options:** **R-a resume/re-dispatch the mission (1–2 h, unknown TTR, needs app + human)** · R-b implement the missing publication step (unbounded; weeks-to-revenue if it works) · R-c monitor only (0 h, 0 revenue — the honest default while S0′/S1 are red).

---

## 3. Decision table (option → effort → time-to-revenue → dependencies → first concrete action)

| Decision | Option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
|---|---|---|---|---|---|
| Day budget (S1) | **O-1 accounting only** | ~40 min | none | none | failing test: a data-less run must not advance `last_success_day` |
| Day budget (S1) | O-2 two-phase lock+accounting | 3–5 h | none | none | failing test first, then attempt-then-consume |
| Day budget (S1) | O-3 wrapper pre-flight | ~1 h | none | S7 wrapper | guard on today's day key (insufficient alone) |
| Day budget (S1) | O-4 O-2 + O-3 | 3–6 h | none | none | both, in that order |
| Day budget (S1) | O-5 stay manual | 0 h | none | none | say plainly: unattended operation stays blocked |
| Incident (S11) | **O-A accept + keep lock** | 10 min | none | operator | record three answers; keep 2026-10-01 spent |
| Incident (S11) | O-B remediate the day | 10 min + 1 command | same-day visibility | operator; S1 first | hash → remove lock → re-read → append note |
| Read source | **O4 operator-entered** (available now) | 0 h build + 0.5 h operator | **same day, visibility** | S1, S11, free day key, 3.11.9 | append four integer-cent figures; expect `INITIAL_BASELINE` |
| Read source | **O6 app-path bridge** (rank 1 target) | 4–8 h | 3–7 days, visibility | running app + human session, S1 | map four fields (reuse RS-2), call the probe once |
| Read source | O2 provider read contract | 2–4 h if an account exists | 3 days–2 weeks | confirmed account, out-of-repo token | probe the documented endpoint with the operator's own token, `[REDACTED]` |
| Read source | O1 loopback metrics route | 3–5 h + new route work | 1–2 days, workstation metrics only | a route that has never existed | `curl :4600/api/v1/status/metrics` (expect 404) |
| Read source | O3 payout balance endpoint | 4–8 h + a rules decision | 1–4 weeks, unbounded if refused | a POST-minted token, which R1 refuses | probe unauthenticated; check for an enabled payouts key |
| Read source | O5 live-session automation inside the routine | unknown | unknown | provider identity + session + credential | **BLOCKED** — keep off the critical path |
| Gate (S0′) | **O-A′ port + close 2 evasions + attribution** | 2–4 h | none | delivered gate + adversarial harness (both present) | add `--package`; re-run the harness until 0 undetected **and** 0 misattributed |
| Gate (S0′) | O-B′ move it in as-is | 0.5 h | none | none | ships a third gate + two live evasions |
| Gate (S0′) | O-C′ override in writing | 0.2 h | none | operator sign-off | record the override; lose the automatable gate |
| Gate (S0′) | O-D′ inline the lock | 3–5 h | none | none | **rejected** — R2–R4 still fail |
| Concurrency (S1b) | **O-a diagnose then fix** | 1–3 h | none | none | reproduce `3 != 4` over 26 runs, then instrument |
| Concurrency (S1b) | O-b assert lock count | 0.5–1 h | none | none | state plainly that the invariant is weaker |
| Concurrency (S1b) | O-c `xfail` | 0.2 h | none | none | **rejected** — removes the only concurrency evidence |
| Attribution (S8′) | writer tag + catch-up coalescing | 1–2 h | none | none | tag every new line; coalesce missed days into one payload |
| Deprecation (S9′) | implementation index | 1–2 h | none | none | write the index; delete nothing |
| Delivery (S5) | toast only | 0.5–1 h | none | S3/S4 + a change | one real toast, label recorded locked/unlocked |
| Approval (S6) | record decisions; close or accept the denylist | 2–4 h (+1 h patch) | none | S3/S4 | decide one item as an allowed human; then test a machine label |
| Schedule (S7) | handover, no registration | 1–2 h | none | gate green, S1, S1b, S3, pinned root | re-parse both payloads; confirm interpreter; hand over the `schtasks` text |
| Revenue (S10) | R-a resume the mission | 1–2 h | unknown | app running + human decision | resume the blocked mission in the UI |
| Revenue (S10) | R-b implement the publication step | unbounded | weeks if it works | app + decision + the missing step | none until the decision is taken |
| Revenue (S10) | R-c monitor only | 0 h | none | none | say plainly: visibility, not cash |

---

## 4. Blocked register (measured this pass)

| Item | Blocked on | Reason (verified 11:37–11:42) |
|---|---|---|
| Green automatable acceptance gate | S0′ port | shipped verifier `R1=FAIL` exit 1; `--package` unrecognized, exit 2 |
| Closed mutant set (C25) | S0′ | V11B measured 2 adversarial evasions (exit 0) + 1 misattributed catch; **re-measure in the claiming pass** (RS-3) |
| Trustworthy concurrency attestation | S1b | 3 of 26 suite runs red, `3 != 4` (sibling mtime 09:17); N=1 green in this pass |
| Any reading for 2026-10-01 | S11 (human decision) + lock removal | today's key was spent at 08:53:46 on a null read |
| Unattended scheduling | S1 **and** S1b **and** a green gate | a data-less run spends the day *and* books it a success |
| Trustworthy "monitor is alive" signal | S1 | `MONITOR_DEGRADED` is inside the success set; the watchdog agrees with the ledger |
| Live account status | running app **with** a human session + the S4 bridge | listener 200, no desktop shell running; no provider credential in the environment |
| Email / SMS / webhook alerting | credentials or mail tooling | none configured; only the toast sink is implemented (RS-4) |

---

## 5. Hand-off protocol

1. Each stream writes only under `DELEGATION-2026-10-01-R4/<stream>/`, pins a throwaway `FREECASH_DATA_ROOT`, uses the 3.11.9 venv interpreter, and records its own before/after hash pair of the production root.
2. A stream's summary is a **self-report**: the parent verifies the artefact exists on disk, that the production hashes are unchanged, and that the acceptance bar in `../DELEGATION-BRIEF-R4.md` §2 holds — including a red case.
3. Anything a stream cannot prove is recorded as **BLOCKED with the command that failed**, never as a footnote to a PASS.
4. No stream registers a schedule, takes an external action, or writes to the production state root. Registration and every external action remain human-owned (R4).

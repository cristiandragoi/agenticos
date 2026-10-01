# RESEARCH PLAN R4 — what must be answered, by whom, with what command

**Repository:** `D:\AgenticOS` · **Written:** 2026-10-01 · **Pass window:** `11:37:50` → `11:42` local (Europe/Berlin)
**Companion documents:** `../DELEGATION-BRIEF-R4.md` (rules + acceptance bar + live state) · `../workflow/WORKFLOW-PLAN-R4.md` (execution order)
**Raw evidence for every claim referenced here:** `../source/raw/00-parent-pass-2026-10-01-1142.txt`

**Purpose:** the routine's *design* questions are settled (one read-only path, one day lock, one change detector, one approval queue). What is **not** settled is (a) whether any real account state can be read at all without a write-scoped credential, (b) how the already-authenticated app path feeds the routine's existing source shape, and (c) whether the compliance verdicts the tree currently carries are reproducible under hostile re-measurement. Those three are the delegated streams. Everything else is either mechanical or blocked on a human.

**Rules that constrain research** (full text in the brief; operator numbering, printed with titles on purpose):
**R1** zero automated earning actions — no stream may POST to a provider, mint a token, or exercise a write-scoped endpoint, **including** "to see what happens". **R2** exactly one status read per Europe/Berlin calendar day — no stream may invoke the entry point against the production root; today's key is already spent (lock `2026-10-01.lock`, 08:53). **R3** notify on change only. **R4** human approval before any external action — a research stream may not subscribe, register, publish or send anything.

---

## 1. Open questions (current state → the question → closing command)

| # | Question | State at 11:42 | Closes when |
|---|---|---|---|
| Q1 | Is there a **documented read-only** endpoint (balance / earnings / status) that yields Free Cash account state without a write-scoped credential? | unverified in this pass; no credential or account exists in the environment | a documented endpoint is quoted with its provider doc reference, **or** the candidate is recorded REFUSED/BLOCKED with the failing probe |
| Q2 | Is a **payout-balance** route usable without minting a token via a POST? | the only known route family needs a minted token, which R1 refuses | a read-only route is demonstrated, or the family is recorded as R1-incompatible |
| Q3 | What exactly is the **app-path source** (the already-authenticated session) and how does its payload map onto the routine's four fields? | the desktop shell is not running this pass; the API listener answers on `:4600`; the existing adapter in the server is a stub that enforces no rule | a mapping document exists naming artefact path, field names, units, and the one command a human runs |
| Q4 | Does the app path have an evidence artefact on disk that survives an app restart? | not established in this pass | an artefact path is quoted with its mtime, or the absence is recorded with the `find` that returned nothing |
| Q5 | Is the **S1 day-budget defect** reproducible outside production, and is the accepted-remedy shape (data-less run ⇒ no lock, ledger untouched, watchdog missed) actually achievable in this codebase? | reproduced twice in production; no reproducer exists on a scratch root | a scratch-root reproduction exists whose assertion **fails on the current build** and is shown to pass on a patched copy |
| Q6 | Are the tree's current gate verdicts reproducible, and where are the surviving holes? | shipped gate `R1=FAIL` exit 1, `--package` exit 2; delivered gate `COMPLIANT` exit 0; 8 semantic mutants present | the mutant table is re-run in the claiming pass with the failing rule named per row and evasions labelled separately |
| Q7 | Which alert sinks are reachable **without** new credentials? | toast sink only; the ambient environment carries no mail/webhook configuration | an inventory with a reachability verdict per sink (mechanically small; backlog RS-4) |
| Q8 | What is the state-root truth — do `data/freecash`, `data/freecash-monitor` and any server-side variant still coexist? | all three existed at 09:xx (sibling V11B A26); un-remeasured here | one pinned root is named, or the ambiguity is recorded as open with the `ls` output (feeds S7) |
| Q9 | Is the routine's verdict affected by the working tree being 870 paths dirty with the routine untracked? | untracked ⇒ in-place edits to the routine produce no reviewable diff | recorded as a risk with the `git status` count quoted, or remediated by the operator's own decision (never by an agent in this delegation) |

Q7/Q8/Q9 are **backlog**: listed so they are not lost, not delegated now.

---

## 2. Delegated streams

### RS-1 — Provider read-only contract (closes Q1, Q2)
**Directory:** `../research/provider/` · **Deliverable:** `PROVIDER-CONTRACT-R4.md` + `raw/` evidence
**Method:** read the provider documentation and the repo's own provider notes, then probe **unauthenticated/GET-only** surfaces. Candidates, in the order the tree has already favoured: FreeCash.io, HG.Cash, Cashfree Payouts, the app-internal API on `127.0.0.1:4600`.
**For each candidate, record:** endpoint, HTTP method, auth requirement, what it returns, whether a read is possible **without** a write scope, and an **R1 verdict** (`READ-ONLY-OK` / `R1-INCOMPATIBLE` / `NO-DOCUMENTED-READ-PATH`).
**Acceptance (failing-something):** at least one candidate must be recorded as **REFUSED or BLOCKED with the actual failing probe output** beside it (a status line, a 401/404, or the documented absence of a read path). A table in which every row reads "OK" is rejected.
**Prohibited:** any authenticated call, any token mint, any POST/PUT/PATCH/DELETE, any signup or account creation, any credential in the deliverable (`[REDACTED]`, length only).
**Expected Effort:** 1–2 h · **Time-to-Revenue:** 3 days–2 weeks if a documented read path exists, otherwise none · **Dependencies:** existence of an account; none for the documentation half · **First Concrete Action:** `curl -sS -m 5 -o /dev/null -w '%{http_code}'` against the documented read endpoint and the documented write endpoint side by side, so the boundary is visible in one artefact.

### RS-2 — App-path bridge mapping (closes Q3, Q4)
**Directory:** `../research/datasource/` · **Deliverable:** `PATH-B-BRIDGE-R4.md` + a probe script + `raw/` evidence
**Method:** read-only inspection of the app side — existing probe scripts and evidence artefacts, the interactive-login and session-check paths, the stub adapter that is wired but returns a hardcoded `externalConnected: false`, and whatever the loopback API exposes without authentication.
**Deliver:** (1) the artefact path(s) that carry the authenticated account state, with mtime and a quoted snippet; (2) the exact four-field mapping (`account_status` as the provider's own status vocabulary, `earnings_total_cents`, `balance_cents`, `pending_cents`) including the unit conversion and the null policy; (3) the **single command a human runs** to produce one reading; (4) what the routine would have to change to consume it (or the finding that it needs no change).
**Acceptance (failing-something):** the probe script must **exit non-zero and name the reason** when no authenticated session exists — this pass the desktop shell is not running, so the red path is reachable **now** and must be captured. Re-running it must not create a day lock or touch the production root.
**Prohibited:** starting the app in a way that authenticates on the user's behalf; entering credentials; writing to the production state root; adding a provider host to the read-only allowlist.
**Expected Effort:** 2–3 h · **Time-to-Revenue:** 3–7 days of sight of the real account (visibility only) · **Dependencies:** none to map and document; a human session only to *validate* the mapping later · **First Concrete Action:** locate the app's own evidence artefacts by mtime and quote the newest one, then run the existing probe once and paste its failure.

### RS-3 — Day-budget and gate verification, hostile re-measure (closes Q5, Q6)
**Directory:** `../verify/daybudget/` · **Deliverable:** `DAYBUDGET-AND-GATE-R4.md` + `raw/` evidence + the reproducer script
**Method:** throw away the tree's existing PASS lines. With a throwaway `FREECASH_DATA_ROOT` and the 3.11.9 venv interpreter:
1. Reproduce the S1 defect: a run with **no** operator record must be shown to (a) create today's lock, (b) write a null snapshot, (c) advance `last_success_day`, (d) leave `consecutive_missed_days` at 0, and (e) make the watchdog print `WATCHDOG_OK`. Quote all five outputs.
2. Show the reproducer **goes red on the fixed behaviour**: apply the minimal patch to a **copy** of the package under your own directory (never to `monitoring/freecash/`) and show the same script now observes no lock / unchanged ledger / `WATCHDOG_MISSED_DAY`.
3. Re-measure the gates in this pass and quote exit codes: shipped gate file-scoped (expect 1) and with `--package` (expect 2), delivered gate package-scoped (expect 0), static read-only gate (expect `forbidden=0 exempt=28`).
4. Re-run the 8 semantic mutants against the delivered gate and require **detected=YES with the correct rule named** per row; any exit-0 row is an **evasion** and any non-zero row that fails a *different* rule is a **misattribution** — the two are reported separately and never summed.
5. Quote the production-root hash triple before and after, and `find <production root> -type f -newermt "2026-10-01 00:00"` expecting exactly the four 08:53 files.
**Acceptance:** every number carries the command that produced it; the patch is proven by a red→green transition on the *same* script; zero writes to `monitoring/freecash/**` or the production root.
**Prohibited:** editing `monitoring/freecash/**` in place; running the entry point against the production root; reporting a PASS without its red case.
**Expected Effort:** 2–3 h · **Time-to-Revenue:** none (this buys the verdict) · **Dependencies:** the delivered gate and the mutant material (both present) · **First Concrete Action:** create the scratch root, hash the production root, run the entry point once against the scratch root **with no operator record**, and paste the five artefacts.

---

## 3. Backlog (not delegated now, kept visible)

**RS-4 alert-sink inventory (Q7)** — enumerate the sinks `notify.py` implements, which are reachable with no new credential, and what a new sink would require. Mechanical, ~1 h.
**RS-5 deprecation index (Q9, feeds S9′)** — mechanical inventory of every competing implementation with its exact gate command; ~1–2 h.
**RS-6 revenue reconnaissance (S10)** — needs a running app and a human decision; not a monitor question.
**RS-7 state-root unification (Q8)** — resolve the three coexisting roots before S7; needs a human decision on which root is authoritative.

---

## 4. Evidence standard for all streams (copied from the brief so it travels with the work)

1. Live evidence only — every claim is the output of a command in the claiming session; no inherited PASS, hash or count (C5/C30).
2. Every green result ships with the red case that proves the check can fail.
3. Name the gate file, its exit code, and **which rule failed** (C23/C29).
4. Hermeticity by hash: scratch root pinned, production hash triple before/after, and the `-newermt` file count.
5. Interpreter quoted: the 3.11.9 venv path. A 3.14 interpreter has no `tzdata` and degrades the day key silently.
6. Secrets never printed or stored — `[REDACTED]` plus length if a length is needed.
7. Write scope: the stream's own directory only; `monitoring/freecash/**`, `scripts/monitoring/**`, `data/freecash-monitor/**` and sibling delegation trees are read-only.
8. No scheduling, no external action, no subscription, no publication — R4 keeps every external step human-owned.
9. A stream that cannot close a question records **BLOCKED** with the exact command and its output; it does not close it by argument.
10. Volume of documentation is never evidence of progress (C31) — only changed implementation bytes plus a gate run count.

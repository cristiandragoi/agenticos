# Free Cash Finance Automation — Workflow Plan (grounded revision)

Repository: D:\AgenticOS
Branch: hermes-rescue-20260908 (uncommitted work present; this plan is additive only — no existing file modified)
Author: Hermes Agent — generated from live repository inspection, not from the earlier design docs

---

## 0. Verified state of the project (evidence, not documentation)

| # | Claim | Evidence (live command output) | Verdict |
|---|-------|--------------------------------|---------|
| 1 | Six overlapping design docs exist, with contradictory schedules and contradictory rule numbering | `free-cash-automation-workflow.md` (08:00 local), `free-cash-finance-monitoring-specification.md` (02:00 UTC), `docs/freecash-monitoring.md` (05:05 UTC), `server/data/freecash-monitor/README.md` (08:30), `docs/research-workflows/FREE-CASH-WORKFLOW-PLAN.md` (SaaS business plan), `free-cash-finance_monitoring_plan.md` | DRIFT |
| 2 | Three parallel, non-integrated implementations of the same job | Python: `scripts/make_freecash_check.py`, `scripts/monitoring/free-cash-daily-check.py`, `scripts/finance_monitor.py`; Node: `server/scripts/freecash-daily-monitor.mjs`; TS: `server/src/adapters/freecashMonitorAdapter.ts` | PARALLEL PATHS |
| 3 | The Node monitor cannot execute at all | `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` at line 41 (`function isDailyCheckAllowed(): boolean` — TS annotations in an `.mjs`; also `require()` inside ESM) | BROKEN |
| 4 | The "rule compliance verifier" is a false-positive gate | `node server/scripts/verify-freecash-rules.mjs` → 4/4 PASSED, yet Rule 3 is `!content.includes('checkForChanges') \|\| content.includes('.log(')` and Rule 4 has operator-precedence defects. It is source-text grep, not a runtime test. It green-lights the file that fails `node --check`. | INVALID EVIDENCE |
| 5 | The Python monitor is a stub, not a monitor | `scripts/make_freecash_check.py:14-15` — `fetch_status()` returns hardcoded `{"balance": 0, "available_to_withdraw": 0, "pending_surveys": []}`; no network call anywhere | STUB |
| 6 | The TS adapter self-reports no external connection | `server/src/adapters/freecashMonitorAdapter.ts:207` — `'Local monitor adapter is operational in read-only sandbox mode. External FreeCash API connection is not configured.'` | SANDBOX ONLY |
| 7 | The configured data source does not exist | `curl http://localhost:3001/api/v1/status/metrics` → connection refused; no such route in `server/src/routers` (only `/api/revenue/metrics`); `scripts/monitoring/free-cash-daily-check.py:25-26` targets it | DEAD ENDPOINT |
| 8 | The default external provider endpoint is not a real API | `curl https://api.freecash.com/v1/status` → HTTP 404 | UNVERIFIED PROVIDER |
| 9 | No credentials configured | `.env` and `server/.env` contain no `FREECASH_*`, `SMTP_*`, `MAIL_*`, `WEBHOOK_*` keys | NOT CONFIGURED |
| 10 | The routine has never run | `data/freecash/` empty; no `data/freecash-daily-check.last`; no `data/freecash-approval-request.json`; no `logs/freecash*.log`; `schtasks /query` returns nothing matching; `crontab` absent on this host (Git Bash) | NO EXECUTION EVIDENCE |
| 11 | Toolchain available | `node v24.20.0`, `python 3.11.9`, `PyJWT 2.13.0`, `requests 2.33.0`, `server/node_modules/node-cron` present; `himalaya` not installed | OK |

**Conclusion:** Free Cash Finance Automation today is a documentation set plus three non-executing code paths. Nothing in it has ever touched an account. Any plan that starts at "wire the live account" is building on an unverified provider and a broken runner.

---

## 1. Canonical constraint set (frozen, supersedes all earlier numbering)

The four operational rules are restated with one numbering, used by every stage below:

| ID | Rule | Enforcement that actually counts |
|----|------|----------------------------------|
| R1 | Exactly one status check per calendar day | Day-key guard (UTC date) + scheduler; second invocation exits 0 with a logged skip |
| R2 | Zero automated earning/withdrawal actions; read-only transport | Connector wrapper permitting only GET/HEAD; no write endpoint reachable from the monitor process |
| R3 | Notify on earnings/status change | Change detection against the previous snapshot + a delivery sink that is asserted in test |
| R4 | Human approval before any external write | Write call refuses to execute unless a valid, unexpired, single-use approval token is presented |

Constraints inherited from workspace policy: no secrets in code or logs (`[REDACTED]`), no modification of unrelated uncommitted work, no destructive git operations, verified tool output only.

---

## 2. Workflow stages (each option carries Effort / Time-to-Revenue / Dependencies / First Concrete Action)

### S0 — Canonicalize and freeze drift
Expected Effort: 1–2 h. Time-to-Revenue: none (unblocks everything). Dependencies: none.
First Concrete Action: add a single `docs/freecash/SPEC.md` holding the R1–R4 table above plus one chosen schedule, provider and artifact-of-record, and add a one-line "SUPERSEDED — see docs/freecash/SPEC.md" header to the five older docs (headers only; no deletions, no rewrites).

### S1 — Make one runner executable (repair, do not rewrite)
Expected Effort: 3–5 h. Time-to-Revenue: none. Dependencies: S0.
Two options, pick one and stop maintaining the other:
- S1a Python runner (`scripts/monitoring/free-cash-daily-check.py`): compiles clean (`py_compile` exit 0), no side effects today, targets a nonexistent endpoint — needs the endpoint from S3a, not new code.
- S1b Node runner (`server/scripts/freecash-daily-monitor.mjs`): currently cannot parse. Repair means renaming to `.ts` under `server/src/` with a real build step, or stripping type annotations and converting `require()` to ESM imports; separately, `prepareActionRequests()` builds the approval queue and never writes it back to disk, and R3 delivery is a `console.log` stub.
First Concrete Action: `node --check` must exit 0 (S1b) or the Python script must print its skip/run lines against a live endpoint (S1a) before any scheduling work is considered started.

### S2 — Replace the false-positive verifier with runtime acceptance tests
Expected Effort: 4–6 h. Time-to-Revenue: none. Dependencies: S1.
Required assertions: (a) run twice in a temp day-key, second run exits 0 with the skip message (R1); (b) transport inspection shows only GET/HEAD during the check (R2); (c) a seeded change produces exactly one notification payload at the sink (R3); (d) a write attempt without an approval token raises and performs no network write (R4).
First Concrete Action: write the two-run same-day test and make `server/scripts/verify-freecash-rules.mjs` fail when the monitor file does not parse (`node --check` as a precondition), so the gate can no longer pass a broken file.

### S3 — Provide a data source (the real blocker: three options)

**S3a — In-repo AgenticOS status route (recommended, real but internal)**
Expected Effort: 6–10 h. Time-to-Revenue: none directly; it is the prerequisite for the revenue-tracking use of the monitor. Dependencies: server running, `server/database.sqlite`, existing `revenue_metrics` table (`server/drizzle/0021_add_revenue_metrics.sql`).
First Concrete Action: add `GET /api/finance/freecash/status` (read-only, GET-only) returning balance/earnings/pending fields, then `curl` it and paste the real JSON into the acceptance test fixture.

**S3b — Live provider account (BLOCKED)**
Expected Effort: unknown. Time-to-Revenue: unknown. Dependencies: the user naming the actual provider, publishing its authenticated account API (auth scheme, endpoints, scope), and storing a credential in the Hermes vault or `.env` (never in chat).
First Concrete Action: a single read-only authenticated GET probe; until a credential and a documented endpoint exist this stays BLOCKED. Current evidence is against it: `api.freecash.com/v1/status` → HTTP 404, no `FREECASH_*` env key anywhere, and the adapter's own status string says the external connection is not configured.

**S3c — Local ledger as source of truth (no external dependency)**
Expected Effort: 2–4 h. Time-to-Revenue: none. Dependencies: S0. Monitor `server/database.sqlite` revenue/ledger rows directly instead of an HTTP API; keeps R1–R4 intact and removes the dead-endpoint risk of the current scripts.
First Concrete Action: point the chosen runner at the SQLite path and log a real balance delta for one day.

### S4 — Scheduling and notification delivery (R1, R3)
Expected Effort: 2–3 h. Time-to-Revenue: none. Dependencies: S1, S2 (and S3 for non-empty data).
Host facts: `crontab` is not installed; `schtasks` is the available scheduler; no SMTP/webhook/mail keys are configured and `himalaya` is not installed, so R3 delivery must either stay local (run log + approval queue file, asserted in test) or be wired deliberately in a separate step.
First Concrete Action: register one Windows scheduled task calling the S1 runner, trigger it manually, then confirm (i) one run-log entry, (ii) a second trigger the same day exits with the skip message.

### S5 — Approval gate with real enforcement (R4)
Expected Effort: 4–8 h. Time-to-Revenue: none. Dependencies: S1, S3a/S3c.
Facts: `scripts/approval_gate.py` compiles and `PyJWT 2.13.0` is installed, but it reads `SIGNING_KEY`/`config/signing.key` (neither configured), and the Node runner's approval queue is never persisted. No approve/reject surface (CLI or API) exists.
First Concrete Action: implement the queue write-back plus one approve/reject endpoint, then the S2 test (d) proving a tokenless write raises and performs no network write.

---

## 3. Critical path

S0 → S1 → S2 → (S3a or S3c) → S4 → S5. Total ≈ 20–36 h of tool-verified work for a monitor that is genuinely read-only, once-daily, notifying, and approval-gated — against an internal AgenticOS data source. S3b (a real money account) is off the critical path and BLOCKED on user-supplied provider details and a credential.

## 4. Explicit non-goals

- No rewrite of the existing docs beyond superseding headers.
- No deletion of the parallel implementations until S1 picks a winner.
- No live financial write path is created by this plan; R4 exists to keep it that way.
- No claim of rule compliance from `verify-freecash-rules.mjs` or from any earlier PASS report — only from a live run whose output is quoted.

## 5. Blocked register

| Item | Blocked on | Reason |
|------|-----------|--------|
| Live account status | Provider identity + API docs + credential | No credential configured; default endpoint returns 404; adapter self-reports sandbox-only |
| Email/SMS/webhook notification delivery | SMTP/webhook credentials or Hermes mail tooling | No `SMTP_*`/`WEBHOOK_*` keys; `himalaya` not installed |
| Real withdrawal/survey automation | Human approval surface + R4 implementation | Currently no approve/reject surface exists; and per R4 it must never execute unattended |

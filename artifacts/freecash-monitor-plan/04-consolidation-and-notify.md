# 04 — Consolidation & Notification Readiness (FreeCash daily monitor)

Audit date: 2026-09-30 · Repo: `D:/AgenticOS` · HEAD `8f7463a` · **Read-only audit** — nothing under
`D:/AgenticOS/` was modified or deleted. All claims below were re-checked with a live command in this
session; the prior art in `docs/freecash-monitor-workflow-plan.md` §9 is cited only for cross-reference,
never as evidence.

## (a) Competing implementations and dispositions

| Path | Live state (verified) | Evidence (exact command → real output) | Disposition |
|---|---|---|---|
| `monitoring/freecash/` (pkg: `run_daily_check.py`, `notify.py`, `gate.py`, `changedetect.py`, `watchdog.py`, `approval_queue.py`, `tests/`) | **RUNNABLE — the only one that works.** 52/52 tests pass. | `python monitoring/freecash/tests/run_all.py` → `run_all: tests=52 failures=0 errors=0 skipped=0`, `EXIT=0` | **CANONICAL** — single source of truth to schedule. |
| `server/scripts/freecash-daily-monitor.mjs` | **BROKEN — does not parse.** TS annotation in a `.mjs`, plus `require()` in ESM. | `node --check server/scripts/freecash-daily-monitor.mjs` → `SyntaxError: Unexpected token ':'` at `function isDailyCheckAllowed(): boolean {` (L41) | **DELETE-CANDIDATE** (only after canonical is scheduled & verified). |
| `server/scripts/verify-freecash-rules.mjs` | **BROKEN/TAUTOLOGICAL — actively harmful.** Prints 4/4 pass while the file it "verifies" does not parse. | `node server/scripts/verify-freecash-rules.mjs` → `[OK] All 4 operational rules verified (4/4 passed)`, `EXIT=0`; `checkRule3` = `!content.includes('checkForChanges') \|\| content.includes('.log(')` (true for nearly any file, L32-37) | **DELETE-CANDIDATE** — it manufactures false-green. |
| `scripts/make_freecash_check.py` | **BROKEN — path off-by-one** (`parents[2]` → `D:\`). | `python scripts/make_freecash_check.py` → `Error: [Errno 2] No such file or directory: 'D:\\data\\freecash\\state.json'` then `No actions available.` `EXIT=1` | **DELETE-CANDIDATE.** |
| `scripts/monitoring/free-cash-daily-check.py` | **DEAD CODE — `main()` defined, never called.** | `grep -n "def main\|__main__" …` → only `225:def main():` (no guard, no call); `python scripts/monitoring/free-cash-daily-check.py` → (no output) `EXIT=0` | **QUARANTINE → superseded.** |
| `finance-monitor/` (pkg incl. `src/rule_engine.py`, `src/action_executor.py`) | **BROKEN — SyntaxError at import.** | `python -c "import src.rule_engine"` → `SyntaxError: f-string: invalid syntax. Perhaps you forgot a comma?` at `rule_engine.py:122` | **QUARANTINE → superseded.** Holds an execution path (`action_executor.py`) → R2 conflict by construction. |
| `scripts/finance_monitor.py` (NOT in the original claim list — found by audit) | **Compiles, has `main()`+`__main__` guard, referenced by `script_schedule_spec.json`.** Holds a provider token. | `python -c "import py_compile; …"` → `COMPILES OK`; `grep -n "def main\|__main__"` → `210:def main():`, `259:if __name__`, `260:sys.exit(main())`; `script_schedule_spec.json` action args → `D:/AgenticOS/scripts/finance_monitor.py` | **QUARANTINE** — token-based provider client, no day-lock, no snapshot diff, no approval queue. |
| `server/tasks/daily-finance-monitor.py` | **RUNNABLE but a DIFFERENT DOMAIN.** Compiles; reads AgenticOS's own SQLite, not the FreeCash provider. | `python -c "py_compile…"` → OK; `grep`→ `248:def main():`, `329:if __name__`, `330:main()`; `server/tasks/daily_monitor.log` → `Checked 0 account(s): []`, `Database connected to D:\AgenticOS\server\tasks\..\database.sqlite` | **NEVER-TOUCH / keep-separate** — out of scope; merging would create a new implementation by another route. |
| `server/src/adapters/freecashMonitorAdapter.ts` | **DEAD ADAPTER — returns a hardcoded stub, and is unregistered.** | see part (b) | **NEVER-TOUCH as a monitor**; must consume snapshots, must not grow into a second monitor. |
| `config/freecash-crontab` | **Non-functional** — `/path/to/AgenticOS/` placeholders; points at the broken `make_freecash_check.py`. | `search_files` → `config/freecash-crontab:7 …/path/to/AgenticOS/scripts/make_freecash_check.py`. No matching Windows scheduled task exists (`schtasks /query /fo LIST \| grep -i freecash` → empty). | **REPLACE** — superseded by a real Task Scheduler entry. |

**Counting the claim list:** all five claimed broken/stub duplicates are confirmed broken/stub exactly as
described. The audit additionally found a **7th** implementation (`scripts/finance_monitor.py`) that the
brief did not list.

## (b) The dead-adapter finding

`freecashMonitorAdapter.ts` **is** imported by live server code — the import resolves and the file exists,
which is precisely why "grep finds the symbol" is not proof the path works:

- `server/src/domains/jarvisV2/turnController.ts:24` → `import { freeCashMonitorAdapter } from '../../adapters/freecashMonitorAdapter.js';` (used at `:414`)
- `server/src/domains/jarvisNext/operator/operatorController.ts:4` → same import (used at `:115`)

**Why it is dead even though it imports:**

1. **It is absent from the runtime registry.** `grep -n register server/src/index.ts` → the only registrations are
   `HermesAdapter`, `JarvisAdapter`, `CodexAdapter`, `VideoAdapter`, `HeavyGenAdapter` (L145-149).
   `grep -n "adapters/freecashMonitorAdapter" server/src/index.ts` → **NOT IMPORTED IN `index.ts`**. After sorting,
   `data/runtimes.json` contains only `rt-hermes`, `rt-jarvis`, `rt-video`, … — no `free-cash-monitor`.
2. **`fetchStatus()` is a constant stub** (L198-209): `externalConnected: false`, `statusAlerts: []`,
   `requiresApproval: []`, `adapterHealth: 'healthy'`, message *"External FreeCash API connection is not configured."*
   The two call sites therefore can never observe a real balance/earnings/status field:
   `turnController.ts` renders "live external account connectivity is disconnected… Live earnings tracking is not active";
   `operatorController.ts` reads `connStatus.externalConnected` (always `false`).
3. `evaluateRules()` (L211-219) has no observable effect and `invoke()`/`stream()` only echo the constant.

**Conclusion:** the adapter is a compile-time-resolvable, runtime-*inert* stub. It is a separate (read-only
capability) layer, not a working FreeCash status path. Keep it as-is, but it must **consume** the canonical
snapshot artifacts, never fetch status itself.

## (c) Notification-readiness — can the operator actually SEE an earnings alert?

**Two hard blockers stand between the operator and a visible toast:**

1. **Nothing is scheduled.** No Windows scheduled task named `FreeCashDailyCheck`/`FreeCashDaily*` exists
   (`schtasks /query /fo LIST | grep -i freecash` → empty). The canonical entry point is never invoked.
2. **No live data source → no change can ever be detected.** The only configured source is *operator-entered*
   and is empty in the real root: real runs log `outcome=MONITOR_DEGRADED source=operator_entered(data_available=False)`.
   Real `data/freecash-monitor/alerts/alerts.jsonl` has **zero** `EARNINGS_CHANGED` / `STATUS_CHANGED` /
   `BALANCE_CHANGED` events ever (`grep -c "EARNINGS_CHANGED\|STATUS_CHANGED\|BALANCE_CHANGED"` → `0`);
   its 10 lines are `MONITOR_DEGRADED`×1, `SKIP_DUPLICATE_DAY`×1, `MISSED_DAY`×8.

**What the notify channel itself is (`monitoring/freecash/notify.py`):** `MAX_ATTEMPTS = "= 2"` (L42); the
offline stand-in `_stub_send` carries `delivery_label = "STUB_OK"` (L164) deliberately distinct from
`DELIVERY_TOAST_OK = "TOAST_OK"` (L45); `alerts/alerts.jsonl` is the append-only canonical record (L78);
SMTP is opt-in/off (module docstring L8); the real sender `_toast_send` runs a **Windows NotifyIcon balloon
via PowerShell** with `Start-Sleep -Seconds 6` (L167-192).

**Did a toast ever actually fire? YES — at the process level — but human perception is unproven.**
`data/freecash-monitor/state/notified-keys.json` contains a real record:

```
"e049c636…783dd3": { "first_notified_at_utc": "2026-09-21T16:39:42Z",
                     "delivery": "TOAST_OK", "updated_at_utc": "2026-09-21T16:39:48Z" }
```

The **6-second gap** (42s→48s) between the `QUEUED` write and the `TOAST_OK` write matches `_toast_send`'s
`Start-Sleep -Seconds 6`, so the real PowerShell path — not the stub — ran for the 2026-09-21 `MISSED_DAY`
alarm. The only event ever put through the notify path in the real root was that `MISSED_DAY` (severity
`alert`), **never an earnings change**.

**But `TOAST_OK` does not mean "a human saw a balloon."** In `dispatch()` the label is
`getattr(sender, "delivery_label", DELIVERY_TOAST_OK)` (L223) — for `_toast_send` (which has no
`delivery_label`) it is the **fallback default**. So `TOAST_OK` only means "the sender callable returned
without raising". There is no visibility/perception check anywhere in the code.

I independently reproduced the channel: running the exact `_toast_send` PowerShell script by hand returned
`TOAST_SCRIPT_RAN` with `EXIT=0`, and `query session` shows the host has an **active console session**
(`>console cd-pr 1 Aktiv`). So the mechanism *executes* on this host — but whether the balloon actually
rendered (vs. being swallowed by Focus Assist / notification settings, or landing silently in the Action
Center) **cannot be seen from this session**.

**Honest gap list (what must become true before the operator SEES an earnings-change alert):**

- [ ] Register and verify a real daily trigger (Task Scheduler, `logon_type: Interactive`, `run_level: Highest`) — **currently absent**.
- [ ] Provide a *live* status source. Today only operator-entered data exists; `data_available=False` in the real root, so no reading ⇒ no diff ⇒ no notification.
- [ ] Prove the earnings path end-to-end with a real reading. The `EARNINGS_CHANGED → toast` path has only ever run against **test fixtures in temp roots**, never against the real root (`grep -c` of earnings events = 0).
- [ ] Add a delivery *confirmation* beyond `TOAST_OK` (returncode ≠ perception). The current label is process-level only.
- [ ] Confirm the balloon is perceptible (Focus Assist / Windows notification settings can suppress `ShowBalloonTip`).
- [ ] Decide the SMTP channel (off by default, no credential wired) or accept toast-only.
- [ ] Schedule the watchdog (`watchdog.py` exists; nothing invokes it).
- [ ] `data/freecash-monitor/` is untracked (`git status --short` → `?? data/freecash-monitor/`), so `alerts.jsonl` / `notified-keys.json` are not versioned evidence.

## (d) Minimal dry-run that proves the toast channel end-to-end (no real money, no real state root)

Run entirely against a throwaway root, e.g. `FREECASH_DATA_ROOT="$LOCALAPPDATA/Temp/freecash-dryrun"`.
`paths.py` honours `FREECASH_DATA_ROOT` (default `D:/AgenticOS/data/freecash-monitor`, L35/45-47), so the
real root is never touched.

1. Seed a prior snapshot + one operator record (pattern already proven by `.hermes/scratch/freecash/notify_sandbox_probe.py`).
2. **Stub leg (offline, unattended-safe):** `FREECASH_TOAST_STUB=1 FREECASH_TOAST_RETRY_SLEEP_SECONDS=0`, call
   `notify.dispatch(msg, key, day, event_type)`. Expect label **`STUB_OK`**, a `state/notified-keys.json` entry
   labelled `STUB_OK`, and a line in `logs/toast-stub.log`. *(I ran this: returned `STUB_OK`, stub log line
   `[STUB TOAST 2026-09-30T19:01:15Z] AUDIT dry-run message`.)*
3. **Real-toast leg:** repeat with `FREECASH_TOAST_STUB` unset so `_toast_send` fires the balloon. Expect
   `TOAST_OK` recorded. *(I ran the raw PowerShell leg only: `TOAST_SCRIPT_RAN`, `EXIT=0`, active console session.)*
4. **Negative control (unattended-safe):** dispatch through a sender that raises `MAX_ATTEMPTS` times. Expect
   `notified-keys.json` = `FAILED_TOAST` + a `DELIVERY_FAILED` line + a `MONITOR_DEGRADED` line.
5. **Dedupe control (unattended-safe):** dispatch the same key twice. Expect the second call to return
   `DEDUPED` with no second toast.

**Cannot be run unattended:** step 3's *human-visibility confirmation* — proving the balloon actually
rendered requires eyes on the desktop (Focus Assist / notification settings can suppress it), and nothing in
the codebase logs or verifies perception. Any leg requiring a live provider also cannot run unattended: no
credentials/endpoint are configured.

## (e) Disposal instructions (recommendations only — nothing was changed)

> **WARNING.** Do **not** delete any duplicate before the canonical entry point
> (`monitoring/freecash/run_daily_check.py`) is (1) registered on a real schedule and (2) verified to run and
> notify end-to-end. Deleting first removes the only working path and leaves a scheduled-but-absent monitor.
> Every deletion below is gated on that prerequisite and should be done in a single commit that also records
> the replacement.

1. **Canonical:** `monitoring/freecash/` — keep; reach Phase-0 green and schedule it. *(Evidence: 52/52 tests pass.)*
2. **Delete-candidates (after the gate above):** `server/scripts/freecash-daily-monitor.mjs` (does not parse),
   `server/scripts/verify-freecash-rules.mjs` (tautological false-green),
   `scripts/make_freecash_check.py` (path off-by-one, exit 1).
   *(Each evidenced in §a.)*
3. **Quarantine → mark superseded, do not execute:** `scripts/monitoring/free-cash-daily-check.py` (no entry point),
   `finance-monitor/` (SyntaxError + action executor),
   `scripts/finance_monitor.py` (token client, R2 surface).
4. **Never-touch / out-of-scope:** `server/tasks/daily-finance-monitor.py` (different domain — DB, not FreeCash);
   `server/src/adapters/freecashMonitorAdapter.ts` (read-only capability layer; retarget it to consume snapshots).
5. **Replace:** `config/freecash-crontab` (placeholder paths).
6. **Rule:** refuse a new "freecash monitor" file unless it deletes a row above in the same change — two
   monitors on one host each hold their own day lock (R1 violation).

## Blocked / not verifiable in this session

- **Human perception of the 2026-09-21 toast** — the `TOAST_OK` record and my re-run of the PowerShell script
  (exit 0) prove the channel *executes*, not that a balloon was *seen*; no screen capture or perception log exists.
- **Real earnings-change delivery** — no live provider/credentials are configured (`adapterHealth` message says
  so), so the `EARNINGS_CHANGED → toast` path could only be exercised against temp-root fixtures, never the real root.
- **Full canonical suite against the real root** — deliberately not run; the read-only constraint meant all
  runs used throwaway roots.

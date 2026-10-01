# SINK-INVENTORY-R4 — notification sinks of the Free Cash daily routine

**Stream:** L (RS-4, question Q7) · **Repository:** `D:\AgenticOS` · **Written:** 2026-10-01, pass `11:44` → `11:53` local (Europe/Berlin)
**Interpreter of record:** `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python` → `Python 3.11.9` (measured, `raw/05-harness-run.txt`)
**Subject:** `monitoring/freecash/notify.py` (mtime `2026-09-20 06:57:46`, `ls` in `raw/07-citations.txt`; sha256 `9bfca8cddfdea913353e7a27bb6bb9d0c17f5959c3ca11935954a0c445abcb22`)
**Raw evidence:** `raw/01`…`raw/09` (each is the verbatim output of the command named beside it)

---

## 0. Binding rules (operator numbering — printed with titles, never bare)

- **R1 — zero automated earning actions.** No write-capable network call was made. The sinks inventoried here are a local file append and a local PowerShell balloon; no provider was contacted.
- **R2 — exactly one status read per operator-local (Europe/Berlin) calendar day.** The routine entry point was **never** invoked against the production root. The package was copied to `delivery/pkg/` and exercised with `FREECASH_DATA_ROOT=C:/Users/cd-pr/AppData/Local/Temp/fcr4-delivery-*/root` (`raw/00-scratch-root.txt`, `raw/05-harness-run.txt`).
- **R3 — notify on earnings/status change, exactly once per change.** This is the subject; see §4.
- **R4 — human approval before ANY external action.** No notification was sent to any real recipient and no new sink was configured. The only dispatch that produced a delivery label used the shipped offline stub (`STUB_OK`). Mail/webhook configuration is absent from the ambient environment: `env | grep -icE "SMTP_|WEBHOOK_"` → **`0`** (exit 1 = no match), `raw/02-sink-imports-and-credentials.txt`.

> Numbering hazard respected: the shipped gate inverts the numbering. No bare `R1`/`R2` appears above; the titles travel with the numbers.

---

## 1. Question (Q7)

Which alert sinks does `notify.py` actually implement, which are reachable **without a new credential**, and what happens when the sink is unreachable (locked session / no desktop shell)? The failure must be bounded, must not raise out of the routine, and must not silently drop a change event.

---

## 2. Sink inventory — what is actually implemented

`notify.py` imports only `os, subprocess, time, uuid, paths` (`notify.py:22-27`, `raw/07-citations.txt`). There is **no** `smtplib`, `urllib`, `http`, `socket`, `requests`, `webhook`, `slack`, `telegram` or `discord` import anywhere in the module.

| # | Sink | Implemented? | Where (file:line) | Mechanism |
|---|---|---|---|---|
| 1 | `alerts/alerts.jsonl` (append-only evidence log) | **Yes** | `notify.py:63-79` (`alert()` → `paths.append_jsonl(paths.alerts_path(), record)`, `paths.py:183-200`) | Local file append via one `O_APPEND` write; always on |
| 2 | Windows toast (balloon tip) — the default real channel | **Yes** | `notify.py:167-192` (`_toast_send`) | `subprocess.run(["powershell","-NoProfile","-NonInteractive","-Command", … System.Windows.Forms.NotifyIcon … ShowBalloonTip(20000)])`; raises on non-zero exit (`notify.py:190-192`) |
| 3 | Offline stub toast — test/host stand-in only | **Yes** | `notify.py:151-164` (`_stub_send`, label `STUB_OK`), selected only when `FREECASH_TOAST_STUB == "1"` (`notify.py:204-205`) | Appends to `logs/toast-stub.log`; **never labelled `TOAST_OK`** (`notify.py:6-7,164`) |
| 4 | SMTP | **No** — docstring claim only | `notify.py:8` ("`SMTP opt-in and OFF by default; not wired to any credential here`") | Nothing executes it; no `smtplib` import (`raw/02`) |
| 5 | Webhook / chat / SMS (Slack, Telegram, Discord, Twilio, ntfy, …) | **No** | — | Grep over `monitoring/freecash/*.py` found no reference (`raw/02`) |

**Sender selection** (`notify.py:201-206`): a test override (`set_sender`, `notify.py:195-198`) wins; else `_stub_send` iff `FREECASH_TOAST_STUB == "1"`; else the real `_toast_send`. Measured both branches: `get_sender()` → `_stub_send` with the flag, `_toast_send` without (`raw/05-harness-run.txt`).

---

## 3. Reachability with NO new credential

Ambient credential probe: `env | grep -icE "SMTP_|WEBHOOK_"` → **0** (`raw/02`). No mail/webhook sink is configured, and none is needed for the sinks that exist.

| Sink | Reachable with no new credential? | Evidence |
|---|---|---|
| `alerts/alerts.jsonl` | **Yes** | 14 lines written to the throwaway root by the harness; plain filesystem append (`raw/05`) |
| Windows toast | **Yes, in principle, no credential** — but **not delivered to a real recipient this pass** (R4) | A desktop session *is* available here: `[Environment]::UserInteractive` → `True`, `explorer.exe` running in session **1** (`Active`), `raw/03-session-probes.txt`. The transport mechanism was proven without showing any balloon: the exact `System.Windows.Forms.NotifyIcon` construction `_toast_send` uses returned `NOTIFYICON_CONSTRUCTED_OK (no balloon shown)` (`raw/04-toast-mechanism-probe.txt`). The real `ShowBalloonTip` was deliberately **not** fired. |
| Stub toast (`STUB_OK`) | **Yes** | Returned label `STUB_OK` on a real `notify.dispatch` call (`raw/05`) — an offline channel, not a delivery channel |
| SMTP / webhook / SMS | **No** | Not implemented; no credentials present (`raw/02`) |

**Verdict per sink:** (1) implemented and reachable · (2) implemented, reachable in principle with no credential (real delivery not exercised under R4) · (3) implemented and reachable but a test seam, not a real channel · (4)(5) **not implemented**.

---

## 4. Unreachable sink / locked session — bounded failure, no raise, no drop

When the sender raises, `dispatch()` (`notify.py:220-261`) executes this contract:

- `record_notified_key(dedupe_key, DELIVERY_QUEUED)` runs **before** the first attempt (`notify.py:224`) — a crash can lose one message but can never duplicate one (`notify.py:13-14`).
- at most `MAX_ATTEMPTS = 2` attempts (`notify.py:42,228`); a raised sender is caught by `except Exception` (`notify.py:234`) and, on the final failure, does **not** re-raise.
- one `DELIVERY_FAILED` alert carrying the **full original message** (`notify.py:238-251`), then one `MONITOR_DEGRADED` alert (`notify.py:252-260`); the dedupe key is written `FAILED_TOAST` (`notify.py:238`) so that key is never retried.
- returns the label `FAILED_TOAST`.

### Red evidence (real output)

**(a) Genuine transport failure — the real `_toast_send`, transport unlaunchable** (`raw/05-harness-run.txt`):

```
real-sender dispatch -> FAILED_TOAST | EXCEPTION_ESCAPED = False
key_delivery(real) = FAILED_TOAST
  alert: DELIVERY_FAILED | delivery= FAILED_TOAST | attempts= 2 | error= [WinError 2] Das System kann die angegebene Datei nicht finden
  alert: MONITOR_DEGRADED | delivery= None | attempts= 2 | error= None
PASS bounded+recorded: True
```

The error is a real `[WinError 2]` raised by the real `subprocess.run`, caught inside `dispatch()`; nothing escaped.

**(b) Unreachable-sink sender (reproduced "no interactive desktop") — bounded, full message kept** (`raw/05-harness-run.txt`):

```
dispatch #1 -> FAILED_TOAST | sender.calls = 2 (MAX_ATTEMPTS per call)
EXCEPTION_ESCAPED = False
DELIVERY_FAILED lines = 1 | MONITOR_DEGRADED lines = 1
  DELIVERY_FAILED.message = "msg-fail full original message"
  observed = {"attempts": 2, "delivery": "FAILED_TOAST", "error": "no interactive desktop session / desktop shell absent (reproduced)", "event_type": "EARNINGS_CHANGED"}
PASS bounded+recorded+no-drop: True
```

The change event is **not silently dropped**: the original message survives verbatim in the `DELIVERY_FAILED` line and the key is marked `FAILED_TOAST` in `notified-keys.json`.

**Routine-level bound:** the shipped test `test_delivery_failure_is_bounded_and_keeps_the_full_message` (`tests/test_r5_smoke.py:71-93`) asserts `run_daily_check.run(...) == 0` on a failing sender. It passed against the copied package this pass (`... ok`, `raw/06-shipped-suite-on-copy.txt`). A delivery failure therefore never fails the run.

---

## 5. Dedupe key — why a repeat of the SAME change does not notify again

**Key definition** (`changedetect.py:214-216`):

```
def dedupe_key(day, change_type, field, old_value, new_value) -> str:
    subject = "%s|%s|%s|%s|%s" % (day, change_type, field, old_value, new_value)
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()
```

The `day` is **part of** the key on purpose (`changedetect.py:19-25`): a change re-detected on a later day is a new key and notifies again; a re-run inside the same day cannot notify twice.

**Guard** (`notify.py:272-281`): if `key_seen(dedupe_key)` the branch appends an **info-severity** log line and returns `DEDUPED` — it never calls `dispatch`, so the sink is not touched:

```
272|    if key_seen(dedupe_key):
...      (alert(change["change_type"], … severity=SEVERITY_INFO …))
281|        return "DEDUPED"
```

The key is persisted **before** dispatch (`notify.py:224`), so the "no duplicate" property is independent of whether delivery succeeded.

### Red evidence (real output)

`raw/05-harness-run.txt` (Part 1) — same change, same key, twice:

```
dedupe_key = d5e540dfcc082fb948b5e3609638b8825807833a5851cbe81a49d8ea3cb581ef
subject    = 2026-10-01|EARNINGS_CHANGED|earnings_total_cents|1234|5678
dispatch #1 -> NOTIFIED | sender.messages = 1
dispatch #2 (SAME key) -> DEDUPED | sender.messages = 1
PASS dedupe: True
```

And routed through the routine's per-change path (`notify_change`) after a failure — a second dispatch of the same key **does not retry the dead sink**:

```
notify_change #1 -> FAILED | calls = 2
notify_change #2 (SAME key) -> DEDUPED | calls = 2 (no second attempt)
PASS no-retry-after-failure: True
```

`OK_NO_CHANGE` is likewise log-only and never dispatches (`notify.py:91-99`): `emit_no_change -> OK_NO_CHANGE | dispatched: 0` (`raw/05`).

Corroboration: shipped tests `test_same_key_is_never_notified_twice_and_the_key_includes_the_day` (`test_r3_changedetect.py:128-155`) and the R5 bounded-failure test both `... ok` (`raw/06`).

---

## 6. Findings (boundaries the operator should know)

1. **`dispatch()` is not itself idempotent — exactly-once is enforced by the callers.** Calling `dispatch()` twice with the same key re-attempts the sink and writes a second `DELIVERY_FAILED` pair (`raw/05`: *"FINDING dispatch() a 2nd time, SAME key, called directly -> FAILED_TOAST | extra sink calls = 2 | extra DELIVERY_FAILED lines = 1"*). The guard lives in every caller: `notify_change` (`notify.py:272`), `run_daily_check.dispatch_change` (`run_daily_check.py:131`), the coalesce branch (`run_daily_check.py:211`). This is a documented boundary, not a live defect — but any *new* caller must pre-check `key_seen()` itself.
2. **SMTP is advertised but not implemented** (`notify.py:8` vs. absent import). Any plan to "enable SMTP" is greenfield work + credential configuration (R4), not a config flip.
3. **The Windows toast is the only real delivery channel** and it depends on an interactive desktop shell; when that is absent the exactly-once/bounded-failure machinery above is the whole safety net. The ambient session here *is* interactive, so the toast is reachable — the red path was produced by making the transport unreachable, and by a reproduced no-desktop sender.
4. **Two of 52 shipped tests failed when run from the copied tree** (`test_shipped_shell_checker_*`), because the test derives the repo root relative to its file and `verify-readonly.sh` is not at the copied depth (`raw/06`). This is an artifact of copying, **not** a sink or routine defect; the two sink-relevant tests passed. The routine's own `.py` mtimes are unchanged (`raw/08`).

---

## 7. Hermeticity (production root byte-identical)

`raw/01-isolation-before.txt` and `raw/08-isolation-after.txt`:

| File | sha256 | Before | After |
|---|---|---|---|
| `data/freecash-monitor/state/last-run.json` | `a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9` | ✓ | ✓ |
| `data/freecash-monitor/alerts/alerts.jsonl` | `1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8` | ✓ | ✓ |
| `data/freecash-monitor/state/operator-state.json` | `be8becc30e04fa24623ae426c06348f60380788fa758b9dcf3a7029963eca59c` | ✓ | ✓ |

All three hashes equal the expected values, before and after. `find data/freecash-monitor -type f -newermt "2026-10-01 11:30"` → **empty (zero files)** (`raw/01`, `raw/08`). `find data/freecash-monitor -newermt "2026-10-01 00:00"` → the four pre-existing 08:53 files only. `find monitoring/freecash scripts/monitoring -type f -newermt "2026-10-01 11:44"` → empty (`raw/09`): no source or state file was written by this stream. All writes landed under `delivery/` and `%LOCALAPPDATA%\Temp\fcr4-delivery-*`.

Sibling artifacts were read, not inherited: `PARENT-BRIEF-R4.md` mtime `11:42:55`, `RESEARCH-PLAN-R4.md` mtime `11:40:39`, `WORKFLOW-PLAN-R4.md` mtime `11:40:40`, `R2/delivery/` mtime `09:15` (`raw/09`).

**Disclosed footprint (not claimed away):** `find src -type f -newermt "2026-10-01 11:44"` returned one file, `src/build-identity.json` (mtime `11:51:42`, `buildTimestamp 2026-10-01T09:51:42Z`, `buildId 8f7463aa-dirty-20261001-095142`). It is produced by `scripts/build-identity.cjs` (`package.json:12-13`), which **no command in this stream runs** — this stream issued only `ls/sha256sum/find/grep`, a `cp` of the package copy, the Python harness, `npm run test` (started `11:53:48`, after that mtime) and `hermes verify --detect-only`. It is therefore attributed to a concurrent process in this shared tree, not to this stream (`raw/15-scope-proof.txt`). `find monitoring/freecash scripts/monitoring -type f -newermt "2026-10-01 11:44"` is **empty**: this stream wrote nothing under `monitoring/**`.

---

## 8. BLOCKED

| Item | Status |
|---|---|
| Real toast delivery to the operator | **BLOCKED by R4** — a real recipient notification is forbidden this pass; only the mechanism was verified (`raw/04`) |
| SMTP / webhook / SMS sink | **BLOCKED** — not implemented in code and no credentials in the ambient environment (`env \| grep -icE "SMTP_\|WEBHOOK_"` → `0`, `raw/02`) |
| Native "no desktop shell" failure with real Win32 output | **Not reproducible from a low-privilege session while session 1 is active**; reproduced a transport failure (`[WinError 2]`) and a no-desktop sender instead (`raw/05`) |

**Per-sink final verdicts:** `alerts.jsonl` = implemented and reachable · Windows toast = implemented, reachable in principle with no credential (real delivery not exercised under R4) · stub toast = implemented and reachable, test seam only · SMTP = not implemented · webhook/chat/SMS = not implemented.

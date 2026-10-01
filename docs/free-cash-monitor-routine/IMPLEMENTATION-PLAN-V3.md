# IMPLEMENTATION-PLAN-V3.md — Phased build plan + capability verification

**Companion to:** `docs/free-cash-monitor-routine/ROUTINE-DESIGN.md` (the design; make no changes to it), `docs/free-cash-monitor-routine/RULE-GATE-CHECKLIST.md` (pre-flight gate table), `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md` (provider contract research).

**Repo / branch:** `D:/AgenticOS` · `hermes-rescue-20260908` · **Verification date:** 2026-09-18, ~07:20–07:45 Europe/Berlin (UTC+02:00) · **Host:** Windows 11 10.0.26200.9457, user `CDINTERNATIONAL\cd-pr`, non-elevated.

**Method.** Every capability in §1 was tested by execution on this machine. Scratch artifacts were written only under `C:/Users/cd-pr/AppData/Local/Temp/fc_cap_probe/` and one transient directory `D:/AgenticOS/.cap-probe-tmp-11320/` created for the D:-volume atomicity test and **deleted immediately after** (verified gone). `git status --porcelain` returned 381 entries before and after every probe — no pre-existing file was touched, nothing was committed, no scheduled task, service, or registry key was created, and no write request was sent to any provider (the only provider call was one body-less `GET` used to confirm a 404).

---

## 1. Capability verification — tested on THIS machine

### 1.0 Summary table

| # | Capability the design depends on | Exact command | Observed result | Verdict |
|---|---|---|---|---|
| a1 | Atomic exclusive-create on the target volume (`gate.py`) | `python C:/Users/cd-pr/AppData/Local/Temp/fc_cap_probe/excl_probe.py self D:/AgenticOS/.cap-probe-tmp-11320` | 1st `os.open(p, O_CREAT\|O_EXCL\|O_WRONLY)` → `CREATED`; 2nd → `FileExistsError: [Errno 17] File exists`; lock size 0 B | **PASS** |
| a2 | Concurrency: exactly one winner under a same-instant 5-process race | `... excl_probe.py race <D: scratch> 5 C:\Users\cd-pr\AppData\Local\Programs\Python\Python311\python.exe` | `winners=1`, `losers_fileexists=4`, all 5 distinct PIDs reported, `verdict: PASS` (reproduced on C: as well) | **PASS** |
| a3 | Volume/filesystem type of `D:` | `fsutil fsinfo volumeinfo D:` → *Fehler 5: Zugriff verweigert*; fell back to `powershell Get-Volume -DriveLetter D` / `Get-CimInstance Win32_LogicalDisk` | `FileSystemType=NTFS`, `DriveType=Fixed`, `FileSystem=NTFS`, 488 GiB total / 394 GiB free, no `ProviderName` (not a network share) | **PASS** |
| b | Windows Python launcher `py -3` exists | `command -v py; py -3 --version; py -0p` | `C:\WINDOWS\py`; `py -3` → **Python 3.14.7** (starred default `-V:3.14`); `py -0p` lists 3.14 → `C:\Python314`, 3.11 → `...\Python\Python311`, uv 3.11.16 | **PASS (exists)** — but see (f): it is the *wrong* interpreter for this design |
| c1 | `python` resolution | `command -v python; python --version` | `C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe` → **Python 3.11.9** (Hermes agent venv) | **PASS** |
| c2 | `python3` resolution | `command -v python3; python3 --version` | `C:\Users\cd-pr\AppData\Local\Microsoft\WindowsApps\python3` → symlink to `AppInstallerPythonRedirector.exe`; prints *"Python wurde nicht gefunden … Microsoft Store"* | **FAIL — python3 is a Store stub, not Python** (matches the brief) |
| c3 | `pip` target | `command -v pip; pip --version` | `C:\Python314\Scripts\pip`, **pip 26.2.1 for Python 3.14** — unrelated to the 3.11.9 that `python` gives | **PASS (with mismatch caveat)** |
| d1 | `schtasks /Query` reachable from the shell | `schtasks /Query /TN "\Microsoft\Windows\Defrag\ScheduledDefrag" /FO LIST`; `schtasks /Query /FO CSV /NH` | Real task details returned (`Hostname CDINTERNATIONAL`, `Status Bereit`); CSV listing works; per-user tasks of this account exist (`\Hermes_Gateway`, `\cua-driver-serve`) and their XML is readable | **PASS (read)** |
| d2 | Would creating the design's task be permitted? | read-only proxies: `Get-Volume`-independent elevation check via `WindowsPrincipal.IsInRole(Administrator)`; `icacls C:\Windows\System32\Tasks`; `schtasks /Query /TN "FreeCash-Daily-Monitor"` | `is_admin=False`, `token_elevated=False`; ACL shows `NT-AUTORITÄT\Authentifizierte Benutzer:(CI)(W,Rc)` on the Tasks folder (plain per-user creation expected to be allowed) and an existing user task carrying `RunLevel=HighestAvailable`; the intended name is free (`FEHLER: Das System kann die angegebene Datei nicht finden`) | **PARTIAL** — creation itself was **not attempted** (hard constraint). A plain per-user task is expected to succeed; the design's `/RL HIGHEST /RU %USERNAME%` form needs an **elevated** shell, which this session does not have. **BLOCKED on human UAC.** |
| e1 | `powershell` binary present | `command -v powershell; powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"` | `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe` → **5.1.26100.9444** (`pwsh` not installed) | **PASS** |
| e2 | `.NET` WinForms toast assembly loads | `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; …"` | `WinForms LOADED`; instance type `System.Windows.Forms.NotifyIcon`; 2 `ShowBalloonTip` overloads; `Visible` property present; `icon_assigned=True`; `Dispose()` clean | **PASS (assembly + object construction)** |
| e3 | `System.Drawing` icon dependency | `powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; [System.Drawing.SystemIcons]::Information"` | `System.Drawing LOADED` and a real icon object returned | **PASS** |
| e3b | Visual result of an actual balloon | *deliberately not executed* | Zero notifications were popped (the hard constraint allowed at most one; none was needed to prove the channel compiles and loads) | **UNVERIFIED (by choice) — visible-delivery is a physical-state claim** |
| e3c | Alternative toast path (WinRT) | `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]` type-load | `WinRT toast type: AVAILABLE` | **PASS (type load only; unused)** |
| f | `zoneinfo` + `Europe/Berlin` in the interpreter the schedule would use | `python -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Berlin')"` and the same on `py -3`, `py -3.11`, uv 3.11.16 | **`python` (venv 3.11.9): PASS** — `Europe/Berlin`, `tzdata 2025.3` at `…\hermes-agent\venv\Lib\site-packages\tzdata`. **`py -3` (3.14.7): FAIL** — `zoneinfo._common.ZoneInfoNotFoundError: 'No time zone found with key Europe/Berlin'`. **`py -3.11` (base 3.11.9): FAIL** (same error). **uv cpython-3.11.16: FAIL** (same error) | **PASS only on the venv interpreter; FAIL on every other interpreter on this host** |
| g1 | Assumed internal read endpoint `http://localhost:3001/api/v1/status/metrics` | `curl -sS -o /dev/null -w "%{http_code}" --max-time 6 http://localhost:3001/api/v1/status/metrics` (+ `HEAD`) | **connection refused** — `curl: (7) Failed to connect to localhost:3001`, code `000`; `Get-NetTCPConnection -LocalPort 3001` returns **no listener** | **FAIL / BLOCKED — the endpoint is not served** |
| g2 | What the internal API actually serves | `GET` probes on the live AgenticOS port 4600 | `4600/api/health` → **200** (`status healthy`, `version 9.0.0`, `isDirty true`); `4600/api/revenue/metrics` → **200** (JSON counts); `4600/api/v1/status/metrics` → **404**; `4600/api/v1/status` → **404**; `4600/api/status/metrics` → **404** | **PASS for 4600 liveness; the design's W1/W2 paths do NOT exist on this host** |

### 1(a) Atomic exclusive-create — raw evidence

Test source: `C:/Users/cd-pr/AppData/Local/Temp/fc_cap_probe/excl_probe.py` (scratch, retained only in Temp).

```
$ python C:/Users/cd-pr/AppData/Local/Temp/fc_cap_probe/excl_probe.py self D:/AgenticOS/.cap-probe-tmp-11320
{"mode":"self","path":"D:/AgenticOS/.cap-probe-tmp-11320\\single.lock",
 "first_call":"CREATED",
 "second_call":"FileExistsError",
 "second_error":"FileExistsError: [Errno 17] File exists: 'D:/AgenticOS/.cap-probe-tmp-11320\\single.lock'",
 "size_bytes":0}

$ python … excl_probe.py race D:/AgenticOS/.cap-probe-tmp-11320 5 C:\...\Python311\python.exe
{"mode":"race","n_workers":5,"workers_reporting":5,
 "winners":1,"losers_fileexists":4,"lock_exists_after":true,"lock_size_bytes":0,
 "results":[{"worker":"0","outcome":"FileExistsError","pid":9012},
            {"worker":"1","outcome":"FileExistsError","pid":15648},
            {"worker":"2","outcome":"FileExistsError","pid":35384},
            {"worker":"3","outcome":"CREATED","pid":27900},
            {"worker":"4","outcome":"FileExistsError","pid":27672}],
 "verdict":"PASS"}
```

All five workers were **separate OS processes** started against a shared wall-clock start instant (`t+1.5 s`), so this is a genuine race, not a sequential test. The `ignoreNew`/`StartWhenAvailable` scheduler layer is therefore backed by a mechanism that has been demonstrated on the actual volume. `D:` is **local fixed NTFS** — not a network share, so the caveat about `O_EXCL` being unreliable on SMB does not apply. Scratch directory removed; `ls -d D:/AgenticOS/.cap-probe-tmp-*` → *No such file or directory*.

### 1(b)–(c) Interpreter inventory — this is the design's most dangerous gap

| Invocation | Resolves to | Version | `zoneinfo`/`Europe/Berlin` |
|---|---|---|---|
| `py -3` (used by the design's Task A/`RULE-GATE-CHECKLIST.md`) | `C:\Python314\python.exe` | **3.14.7** | **FAIL — `ZoneInfoNotFoundError`** |
| `py -3.11` | `C:\Users\cd-pr\AppData\Local\Programs\Python\Python311\python.exe` | 3.11.9 | **FAIL** (no `tzdata`) |
| uv `cpython-3.11.16` | `%APPDATA%\uv\python\cpython-3.11.16-…` | 3.11.16 | **FAIL** (no `tzdata`) |
| `python` (PATH) | `…\hermes-agent\venv\Scripts\python.exe` | 3.11.9 | **PASS** (`tzdata 2025.3` in the venv's site-packages) |
| `python3` | WindowsApps Store redirector | — | n/a — not Python |
| `pip` | `C:\Python314\Scripts\pip` | 26.2.1 (py3.14) | n/a |

`ZoneInfo("Europe/Berlin")` is the **first thing `gate.py` does** (design §2.1). With `py -3` it raises `ZoneInfoNotFoundError` **before** the day lock is created — so nothing is consumed, nothing is alerted, and the only evidence is a non-zero Task Scheduler result. The design's interpreter choice therefore converts an R1 guarantee into a crash loop. Mitigation is verified feasible: `py -3.11 -m pip install --dry-run --no-cache-dir tzdata` → *"Would install tzdata-2026.4"* (PyPI reachable), or pin the task to the venv interpreter, or ship an explicit `tzdata` wheel. Until one of those is done, **the design's exact Task A command must not be registered**.

### 1(d) Task Scheduler — what is proven and what is not

Proven read-only: `schtasks` is on PATH and queryable; per-user tasks created by this very account exist (`\Hermes_Gateway` — `LogonType InteractiveToken`, `UserId S-1-5-21-…-1001`; `\cua-driver-serve` — carries `RunLevel HighestAvailable`); the folder ACL grants `Authenticated Users (CI)(W,Rc)` (write), which is how per-user tasks are creatable non-elevated; the name `FreeCash-Daily-Monitor` is unused. Not proven, because the hard constraint forbids it: that a **create** actually succeeds, and specifically that `-RunLevel Highest` is accepted without elevation. Current token is **not** elevated (`is_admin=False`), and `schtasks /Create … /RL HIGHEST` is an elevated-only operation — treat P5 as a human-gated step.

**Design contradiction found:** §7.1 requires "Run whether logged on = Yes", but the exact command block then runs `schtasks /Change /TN "FreeCash-Daily-Monitor" /IT`, and `/IT` means *interactive token — runs only while the user is logged on*. Those two statements are mutually exclusive. Decide one in P5; `/IT` is the cheaper, non-elevated option and its failure mode (skipped run when logged off) is exactly what Task B's watchdog exists to catch.

### 1(e)–(f)–(g) Notification, timezone, endpoint

Notification: the channel the design recommends is real on this host — Windows PowerShell 5.1 + `System.Windows.Forms.NotifyIcon` with icon assignment and clean dispose. The **appearance of a balloon on the desktop was not tested and must not be reported as working** (it is a physical user-observed state; also untested: Focus Assist / quiet-hours suppression). A modern alternative type (`Windows.UI.Notifications.ToastNotificationManager`) also type-loads if the WinForms balloon proves unreliable.

Endpoint: the design's W1/W2 targets are dead — **no listener on 3001 at all**, and the live AgenticOS API on **4600** answers `/api/health` (200) and `/api/revenue/metrics` (200) but returns **404 for `/api/v1/status/metrics` and `/api/v1/status`**. The only place that path string exists in the repo is the superseded script itself (`scripts/monitoring/free-cash-daily-check.py:26`). So R3 has *no live source* even in "degraded" substitute mode; either the endpoint is repointed at a real 4600 route, or the routine has nothing to compare.

### 1(h) Additional facts discovered that change the plan

| Fact | Command | Observed | Consequence |
|---|---|---|---|
| `pytest` is absent everywhere | `python -m pytest --version`, `py -3.11 -m pytest --version` | *No module named pytest* (both) | The design's 18-test matrix and checklist step 5 (`py -3 -m pytest …`) are **not executable as written**; P0 must either add a `pytest` dependency for a pinned interpreter or write the 16 offline tests as stdlib `unittest` |
| The CI grep really does fail on a planted violation | `bash docs/free-cash-monitor-routine/verify-readonly.sh <scratch-dir>` | clean scratch module → `forbidden=0 exempt=0 missing_targets=0`, **exit 0**; scratch module with `requests.post("http://x/claim", json={...})` → `forbidden=4 exempt=0`, four `FORBIDDEN [pattern] file:line` lines, **exit 1** | R2's static layer is genuinely build-breaking, not advisory — this is the harness P0 builds on |
| The shipped grep exits **2** when the target is missing | same, default target `monitoring/freecash` | `TARGET MISSING … NOT a pass`, `missing_targets=1`, exit 2 | Correct fail-closed behaviour for a not-yet-built routine; must be wired into CI as a hard failure, not ignored |
| The legacy rule verifier gives a false 4/4 PASS | `node server/scripts/verify-freecash-rules.mjs` | `✓ Rule 1..4 → PASSED`, `[OK] All 4 operational rules verified (4/4 passed)`, exit 0 — while its Rule 2/3/4 inputs are read from `server/scripts/freecash-daily-monitor.mjs`, which does not parse | Source-substring "verification" of an unparsable file reads green; the new verifier must **parse and execute**, never substring-match (this is P0's reason to exist) |
| The legacy `.mjs` still does not parse | `node --check server/scripts/freecash-daily-monitor.mjs` | `SyntaxError: Unexpected token ':'` at line 41, Node v24.20.0 | Confirmed; keep superseded, never register |
| Snapshot-ordering defect confirmed | `grep -n "save_snapshot\|load_snapshot" scripts/monitoring/free-cash-daily-check.py` | `266: save_snapshot(snapshot_data)` then `270: old_snapshot = load_snapshot()` | Confirmed — R3 could never fire in the legacy script |
| Off-by-one data dir confirmed | `grep -n "parents\[" scripts/make_freecash_check.py` | `8: BASE = Path(__file__).resolve().parents[2]` | Confirmed; resolves to `D:\data\freecash` on Windows |
| POSIX crontab confirmed unusable | `grep -n "path/to\|freecash" config/freecash-crontab` | `0 5 * * * /usr/bin/env python3 /path/to/AgenticOS/scripts/make_freecash_check.py >> …/logs/freecashioc_$(date …).log` | Placeholder paths + `python3` (which is a Store stub here) + name typo |
| No managed CI/cron runner exists | `git remote -v`, `ls .github/workflows`, `command -v crontab`, `wsl.exe -l -q` | remote = `github.com/cristiandragoi/agenticos`; **no** `.github/workflows`; `crontab: NOT FOUND`; WSL binary present but *"Windows-Subsystem für Linux ist nicht installiert"* | Option C in §3 is, empirically, **not currently available** |
| Provider endpoint absent | `curl -sS -o /dev/null -w "%{http_code}" https://api.freecash.com/v1/status` | **404** (independently reproduced) | The `.mjs` invented URL is confirmed dead; W3/W4 remain unresolvable |
| Locale date shape | `powershell -NoProfile -Command "(Get-Date).ToString('d') + ' | ' + (Get-Culture).Name"` | `18.09.2026 | de-DE` | `run-%DATE%.log` → `run-18.09.2026.log`; dots, no slashes, so the redirection does *not* break on this locale — but the name is locale-dependent and should be replaced by a wrapper `.cmd` anyway |

---

## 2. Phased plan (strict dependency order)

Ordering rule: **no phase may be started before the phase it depends on has its own evidence**. P0 gates everything, because P0 is the executable rule gate that proves a phase's control actually fails when violated; a phase whose tests cannot be executed (as §8 is today) is not "done", it is unverified.

### P0 — Executable rule-gate verifier, proven to fail on a planted violation

- **Expected Effort:** 3 h. **Agent-executable** (no human input; network-free).
- **Time-to-Revenue:** No revenue, and none is possible in this phase — the gate produces *evidence*, not signal. Value realized at hour ~3: the four rules become machine-checkable, so no later phase can report a false green (exactly the failure the legacy `verify-freecash-rules.mjs` demonstrates today: 4/4 PASS on an unparsable file). Earliest possible earnings/status signal: **none — not in this phase at all.**
- **Dependencies:** none (this is the root). Verified available: `bash`, `grep -rniIE`, `node v24.20.0`, `python 3.11.9`, and the already-proven `verify-readonly.sh` harness. Must resolve the pytest gap in the same task: add stdlib `unittest` (preferred — zero new dependencies) or install `pytest` for one pinned interpreter (currently *no module named pytest* anywhere).
- **First Concrete Action:** create `D:/AgenticOS/monitoring/freecash/verify_rules.py` as a **parsing** verifier (AST for Python, `node --check` for JS, never substring-matching), and prove it fails by running it now against fixtures — the harness that already works today is `bash docs/free-cash-monitor-routine/verify-readonly.sh <dir>` which returns exit 1 + 4 `FORBIDDEN [pattern] file:line` hits on a scratch file containing `requests.post("http://x/claim", json={...})` and exit 0 on a clean allowlist module. Copy that assertion shape into P0's own test.

### P1 — R1: day-lock gate + ledger + missed-day math + watchdog

- **Expected Effort:** 8 h. **Agent-executable** (all R1 tests are offline; scheduler wiring is P5).
- **Time-to-Revenue:** No revenue. Value realized the first night after P5: the same-day 23:50 watchdog turns a silently-missed check into an alert within hours instead of the next day. Earliest point at which this phase can produce a first *true* earnings/status signal: **never on its own** — R1 only decides *whether* a check runs; it produces no status signal until P3 has a live source.
- **Dependencies:** P0 complete (gate verifier must be able to fail). The atomic primitive is **already proven on the target volume** (1(a): 1 winner / 4 `FileExistsError` on local fixed NTFS `D:`). **Hard blocker discovered:** the day-key computation must run on an interpreter that can resolve `Europe/Berlin` — only `…\hermes-agent\venv\Scripts\python.exe` (3.11.9 + `tzdata 2025.3`) currently can; `py -3`, `py -3.11` and uv 3.11.16 all raise `ZoneInfoNotFoundError`. Pin the interpreter (or install `tzdata`) and add a startup self-check that emits `MONITOR_DEGRADED` instead of crashing before the lock.
- **First Concrete Action:** create `D:/AgenticOS/monitoring/freecash/gate.py` whose first statement is the tz guard, then run the day-key/tz assertion immediately: `python -c "import zoneinfo,datetime;print(datetime.datetime.now(zoneinfo.ZoneInfo('Europe/Berlin')).date().isoformat())"` and port the two proven probes from `C:/Users/cd-pr/AppData/Local/Temp/fc_cap_probe/excl_probe.py self|race` into `tests/` as T1.1/T1.2.

### P2 — R2: read-only client (method/path allowlist) + static CI grep

- **Expected Effort:** 5 h. **Agent-executable**.
- **Time-to-Revenue:** No revenue. Value realized immediately at completion: the routine becomes structurally incapable of an earning action (deny-by-default transport), and the CI grep is already proven to be build-breaking (exit 1 with `FORBIDDEN [write-endpoint-path] …:3: requests.post(...)` on a planted violation; exit 2 when the target tree is missing). Earliest earnings/status signal: **none — this phase only removes the ability to act.**
- **Dependencies:** P0 (verifier wiring). Existing, already-verified asset: `docs/free-cash-monitor-routine/verify-readonly.sh` (re-run today: clean → exit 0; planted → exit 1 / 4 hits; missing target → exit 2). Recommended direction: build `readonly_client.py` so the allowlist constants live behind the one standing `# readonly-exempt:` and the exemption count starts at a recorded baseline.
- **First Concrete Action:** create `D:/AgenticOS/monitoring/freecash/readonly_client.py` with `ALLOWED_METHODS = frozenset({"GET","HEAD"})`, then run `bash docs/free-cash-monitor-routine/verify-readonly.sh D:/AgenticOS/monitoring/freecash` and record the exit code (expect 0 with the exemption markers, or 1 if a forbidden token leaks).

### P3 — R3: snapshot/diff with prior-snapshot-loaded-first ordering + dedupe

- **Expected Effort:** 6 h. **Agent-executable**, but its end-to-end value is **blocked** until a live read source exists.
- **Time-to-Revenue:** No revenue, and this is the phase where honesty matters most: change *detection* is not earnings. Value realized = detection latency of a real movement (target ≤24 h after P5). **Earliest point at which the routine can produce its first true earnings/status signal:** the first run against a live source that actually carries the four compared fields. Today the design's W1 source does not exist (3001 refused, `localhost:4600/api/v1/status/metrics` → 404) and the only 200 routes on 4600 (`/api/health`, `/api/revenue/metrics`) carry no `earnings_total_cents`/`balance_cents`/`pending_cents`/`account_status`. So the earliest achievable signal is **either** (i) T+1 day after repointing W1 at a real local route carrying those fields — which is still `degraded: true`, i.e. **not** the operator's Free Cash account — **or** (ii) only after the P6 gate opens.
- **Dependencies:** P1 (snapshot files live under the day lock) and P2 (the read path may only be the allowlisted transport). Must implement the ordering the legacy script got wrong (`scripts/monitoring/free-cash-daily-check.py:266 save_snapshot` before `:270 load_snapshot`, confirmed by grep): **load prior snapshot before writing today's**, and prove it with a test that would fail under the legacy order. Dedupe key `sha256(day_key|change_type|field|old|new)` with `notified-keys.json` written before dispatch.
- **First Concrete Action:** create `D:/AgenticOS/monitoring/freecash/changedetect.py` and immediately assert the ordering invariant with a two-day fixture run — `python -m unittest discover -s D:/AgenticOS/monitoring/freecash/tests -p "test_changedetect*.py"` — where the test fails if `save_snapshot` is ever called before `load_snapshot`.

### P4 — R3/R4: notification channel + approval queue frozen at `NOT_EXECUTED`

- **Expected Effort:** 5 h agent-executable **+ ~15 min human input** (one-time, to look at the desktop and confirm the toast physically appeared; that is a physical-state claim no automated test can make). Approval-queue freeze needs no human: the routine is the only writer and writes the constant.
- **Time-to-Revenue:** No revenue. Value = the first human-visible alert and the audit trail that makes "we were told, we chose not to act" provable. Earliest realizable moment: the first detected change **after** P3 has a live source — i.e. this phase cannot produce its first true signal before P3's blocker clears, but its channel can be proven end-to-end the same hour it is built using a synthetic change fixture.
- **Dependencies:** P3 (a change must exist to notify about). Verified available: PowerShell 5.1 with `Add-Type -AssemblyName System.Windows.Forms` + `NotifyIcon` (assertions pass: 2 `ShowBalloonTip` overloads, `Visible`, icon assigned, clean dispose) and `System.Drawing`; `WinRT ToastNotificationManager` type also loads as a fallback. **Unverified and must be checked by a human once:** whether a balloon actually renders under the current Focus Assist / quiet-hours settings. SMTP is **opt-in** and gated on a vault credential (do not wire it as default; `scripts/notification_service.py` must not be reused as-is — its failure-reporting behaviour is unverified).
- **First Concrete Action:** create `D:/AgenticOS/monitoring/freecash/notify.py` and run the one permitted manual check: `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(5000,'[FreeCash] channel test','P4 toast channel verification',[System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 8; $n.Dispose()"` — **and have the operator confirm it was seen** (this is the single allowed notification).

### P5 — Task Scheduler registration + dry run

- **Expected Effort:** 3 h, of which ~1 h is **human input** — an elevated shell plus one decision. **BLOCKED on human:** this session is non-elevated (`is_admin=False`), and the design's command carries `/RL HIGHEST /RU "%USERNAME%"`, which requires elevation. Empirically, **plain** per-user creation is expected to work without elevation (folder ACL grants `Authenticated Users (CI)(W,Rc)`; `\Hermes_Gateway` and `\cua-driver-serve` are per-user tasks of this account).
- **Time-to-Revenue:** No revenue. Value = the routine becomes unattended, so detection latency stops depending on a human remembering to run it (that is the whole avoided-loss argument). First true status signal appears **one day after registration** — and only if P3 has a live source; otherwise the first scheduled run will honestly report `READ_FAILED` (as it must, since nothing is served on 3001 today), which is why **P5 should not be registered before P3's source question is answered**.
- **Dependencies:** P1–P4 green; P0's verifier wired; the interpreter/tz decision from P1 applied to the task action (**do not register `py -3`** — it resolves to 3.14.7 and fails on `Europe/Berlin`); the `/IT` vs "run whether logged on" contradiction resolved; restart-on-failure explicitly **off**; Task B registered for coverage. Dry run before committing the schedule: `schtasks /Run` on a task created with a clearly-marked test name, then read its log.
- **First Concrete Action:** query without creating, then register only after the operator approves elevation: `schtasks /Query /TN "FreeCash-Daily-Monitor" /V /FO LIST` (expect the "file not found" style response, i.e. name free) and hand the operator the one-line register command whose action is `"<pinned-python> D:\AgenticOS\monitoring\freecash\run_daily_check.py"` with `-MultipleInstances IgnoreNew` and restart-on-failure disabled.

### P6 — Bind the real provider read contract — **SEPARATE GATE, CURRENTLY BLOCKED**

- **Expected Effort:** **Blocked — cannot be estimated as build work.** If a contract existed: 8–16 h (session/auth handling, field mapping, allowlist entries with justification, live capture test T2.4). As it stands: **0 h of code is safe to write**, because the research artefact `docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md` concludes (and this plan independently reproduced the 404 for `https://api.freecash.com/v1/status`) that the named provider **publishes no public read API**, and that automated access is prohibited by its terms. **Human input is the only path**, and it is a *decision*, not a credential paste.
- **Time-to-Revenue:** This is the only phase in which any true earnings/status signal can originate. Value realized = the moment the routine reads the operator's real balance/status instead of a substitute — until then every "no change" is marked `degraded: true` and proves nothing. Earliest honest answer: **unknown and not schedulable today**; if the operator instead accepts a manual provider export (or the provider's own UI notification), the routine never produces a provider-true signal and the design's day-30 criterion #4 (`degraded: true` count → 0) can never be met — the plan must then be re-scoped to "internal-signal monitor", stated plainly in every report.
- **Dependencies:** an operator decision + evidence of a *permitted* read channel (documented API, export file, or provider email/webhook), then explicit allowlist entries carrying `# readonly-exempt:`-free justification comments, then live capture. Everything downstream of P3 treats P6 as an unresolved gate: P3's comparison logic is only as true as its source, and P4's dedupe/approval machinery works fine while starved of real input — which is exactly the trap (a green pipeline over degraded data).
- **First Concrete Action:** put the decision in front of the operator as a single written question with three options — "(1) you supply a permitted read contract + credentials, (2) you accept a `degraded: true` internal-signal monitor with day-30 criterion #4 permanently unmet, (3) you provide a manual/export-based status channel" — and record the answer in the state dir's runbook before any P6 code is written. Immediate zero-risk read to support that: keep the confirmed facts (`GET https://api.freecash.com/v1/status` → **404**, no public endpoints per the research note) attached to the question.

---

## 3. Delivery options for the daily check

### Option A — Full Python routine + Windows Task Scheduler, exactly as designed (2 tasks + watchdog, 7 modules, 18 tests)

- **Expected Effort:** 27–33 h agent work (P0–P5) + ~1.5 h human (elevation, logon-mode decision, one toast sighting) + P6 unbounded. 7 new modules, `pytest` or an equivalent test runner to add, two scheduled tasks, a state tree, a runbook.
- **Time-to-Revenue:** No revenue from monitoring itself; the value is detection latency ≤24 h (with a 23:50 same-day watchdog) and avoided loss from acting on stale information. First true earnings/status signal: **only when P6 opens**, because the designed read source (3001) is dead and 4600 exposes no matching route — so as specified this option would go live, run daily, and produce zero true signals for an indeterminate period.
- **Dependencies:** P0 → P5 plus the interpreter/tz fix, the endpoint repointing, and P6 as a separate gate. Also needs the `/IT` contradiction resolved and the pytest gap closed.
- **First Concrete Action:** `mkdir -p D:/AgenticOS/monitoring/freecash/tests && python -m unittest discover -s D:/AgenticOS/monitoring/freecash/tests` as the empty-suite baseline before writing `gate.py` (proves the runner works before it is trusted).
- **Verdict:** correct end-state, too much machinery to build before there is anything to read.

### Option B — Minimal single-file Python monitor + one scheduled task, no watchdog

- **Expected Effort:** 6–9 h agent work + ~1 h human (one elevation/logon step) — roughly a quarter of A. One file (`monitoring/freecash/monitor.py`), one task, a small state dir.
- **Time-to-Revenue:** No revenue. Value realized fastest of the three: first human-visible alert within **~1 day of building it** (schedule once, watch it fire once, force one synthetic change to prove the notify path). First *true* earnings/status signal: same P6 dependency as A — so B must ship with the `degraded: true` marker on everything it reports; with the W1 source dead today, B's honest first signal is `READ_FAILED` until the source is repointed.
- **Dependencies:** P0's verifier (non-negotiable, ~1 h), the four mechanisms reduced to functions in one file: atomic `O_CREAT|O_EXCL` day lock (**proven feasible here: 1 winner / 4 `FileExistsError`**), allowlist `GET/HEAD`-only transport (**proven build-breaking grep exists**: exit 1 on a planted `requests.post`), load-before-save snapshot diff + dedupe key, append-only alerts + toast (**PowerShell 5.1 + `NotifyIcon` verified loaded**). Drops for v1: watchdog, coalescing, approval queue file, SMTP, retention pass.
- **First Concrete Action:** create `D:/AgenticOS/monitoring/freecash/monitor.py` and run it twice by hand on the pinned interpreter — `"C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" D:/AgenticOS/monitoring/freecash/monitor.py; echo "run1=$?"; … monitor.py; echo "run2=$?"` — the first must write a lock + snapshot and the second must print `SKIP_DUPLICATE_DAY` and exit 0.

### Option C — External managed scheduling (existing cron / CI runner / hosted job)

- **Expected Effort:** Not currently buildable — the empirical survey found **no** `.github/workflows` in the repo (remote is `github.com/cristiandragoi/agenticos`, but no workflows exist), **no** `crontab` on this host, and WSL is **not installed** (`wsl.exe -l -q` → *"Windows-Subsystem für Linux ist nicht installiert"*). Making it work means 4–10 h of new infrastructure (self-hosted runner with LAN access, or a hosted job plus an agent on this machine) — pure overhead before a single status check runs.
- **Time-to-Revenue:** No revenue, and it delays everything: a hosted runner cannot read `D:/AgenticOS/data/freecash-monitor/` or `localhost:4600` without a self-hosted runner on this host, which is strictly more moving parts than Task Scheduler. First true signal: later than both A and B.
- **Dependencies:** standing up a runner (human/admin), plus the same P0 verifier and the same P6 gate. It does not remove any of the hard work; it only relocates the timer.
- **First Concrete Action:** none recommended. (If a runner is later required, the minimal check is `git ls-remote` + a self-hosted runner registration — neither is warranted while Task Scheduler is already present and queryable.)
- **Verdict:** unavailable today; revisit only if the machine must be monitored from outside.

### Recommendation — build **B first, then grow into A**

Build Option B, with three non-negotiable carries from A that cost almost nothing and are the entire point: **(1)** the atomic `O_CREAT|O_EXCL` day lock (verified working on this exact volume), **(2)** the allowlist `GET`/`HEAD`-only transport plus `verify-readonly.sh` in CI (verified to fail the build on a planted violation), **(3)** load-before-save snapshot diff with the `day_key`-scoped dedupe key and an append-only `alerts.jsonl` (the ordering bug that silently disabled R3 in the legacy script is confirmed at `free-cash-daily-check.py:266→270`).

Why B and not A, given A is the designed end state:
1. **A's read source does not exist**, so A's most valuable component (R3 detection) would ship unexercised. The last time this repo shipped an unexercised rule verifier, it printed `4/4 PASSED` while certifying a file that fails `node --check` — confirmed again today, exit 0. Building the full 7-module structure before a live source exists is how that happens again.
2. **Every capability B needs is now empirically confirmed on this host**, and its riskiest primitive is proven under a real 5-process race.
3. **B reaches a proof-of-liveness fast**: one scheduled run, one forced change, one visible alert — then it either does useful work (detects something) or loudly fails (`READ_FAILED`), both of which are information. A, built now, would spend ~30 h to reach the same state with a watchdog on top.
4. **The upgrade path is additive, not a rewrite:** B's day lock becomes `gate.py`, its transport becomes `readonly_client.py`, its diff becomes `changedetect.py`; the watchdog (~2 h), coalescing (~1 h) and approval queue (~2 h) are then added against a live pipeline, with P5 re-registering the second task.

Hard prerequisite for both A and B, independent of option choice: **pin the interpreter** (only `…\hermes-agent\venv\Scripts\python.exe` currently resolves `Europe/Berlin`) **and repoint or replace W1** (3001 refuses connections; 4600 serves `/api/health` 200 and `/api/revenue/metrics` 200 but 404 for `/api/v1/status/metrics`).

---

## 4. Risk register — 30-day unattended run

| # | Failure mode | Observable early signal | Mitigation |
|---|---|---|---|
| 1 | **Missed run** (machine asleep/off at 08:35, or the design's `/IT` interactive-token restriction skipping runs while logged off — §7.1 contradicts itself here) | No `logs/run-<day>.log` for today; Task Scheduler "last run result ≠ 0x0"; `last_attempt_day < today`; missed-day count rising in the watchdog output | `StartWhenAvailable=true`; `-MultipleInstances IgnoreNew`; register with the correct logon mode (decide `/IT` vs stored credentials in P5); watchdog at 23:50 that alerts the *same evening*; weekly runbook check of 7-day coverage |
| 2 | **Silent read failure** (source down, DNS/route change, 401/403 session expiry, or the W1 endpoint returning 404 as it does today) | `READ_FAILED`/`RUN_FAILED` lines; `last_outcome != OK_*`; run exits non-zero while the lock file still exists; a run that produces no snapshot | Fail loudly, never fail-open: any non-2xx/parse failure writes `READ_FAILED` + exit non-zero; the day lock stays consumed (no in-day retry, per R1); a `--force-recheck --reason` path exists for humans only; daily heartbeat alert if no success line appears by 09:00 |
| 3 | **Notification never delivered** (toast suppressed by Focus Assist/quiet hours, PowerShell blocked, session not interactive) | `DELIVERY_FAILED` lines containing the full message; dedupe keys marked `delivery: FAILED*`; the operator sees nothing for N days while `alerts.jsonl` grows | 2 attempts max, then `DELIVERY_FAILED` with the verbatim message (never silent data loss); one-time human confirmation that a balloon actually renders on this desktop (**not yet verified**); SMTP as opt-in secondary; weekly count of `DELIVERY_FAILED` in the runbook |
| 4 | **False "no change" because the data source is degraded** (this is live today: 3001 is dead, and nothing on 4600 carries the four compared fields) | `"degraded": true` on every snapshot; `source.kind = agenticos_local_metrics`; day-30 criterion #4 (`degraded` count → 0) never reached | Never report a degraded snapshot as verification; carry the marker into every message template; treat "no change" over degraded data as *unknown*; require the operator's written acknowledgement (P6 gate) that "no change" is unproven until #4 is 0 |
| 5 | **Approval queue accumulating** (unread `PENDING` items pile up and slowly look like a backlog that needs "clearing by automation") | Oldest `PENDING` age in `approvals/pending.json`; weekly nag lines (`APPROVAL_PENDING`, max 1/item/7 days) | `expires_at_utc` always `null` and `execution_state` always `NOT_EXECUTED`; no TTL/cron path may change a pending status (90-day clock-advance test); the routine contains **no** code path that reads `status == "APPROVED"`; weekly runbook step: decide or reject anything older than 7 days (safe either way) |
| 6 | **Secrets leaking into the state dir** (SMTP password, session cookie, provider token written into `snapshots/` or `logs/`) | `grep -rniE "password|token|secret|api[_-]?key" data/freecash-monitor/` returning hits; unexpected keys in `raw_response_sha256`-adjacent payloads; growing file sizes in `snapshots/` | Snapshot stores a **hash**, never the raw response body; credentials only from env/vault at call time, never persisted; redaction filter on log writes; runbook pre-flight grep (checklist step 1) run weekly, not just once; state dir excluded from any sync/backup that leaves the machine |
| 7 | **Interpreter/tz crash-loop** (the newly found one: `py -3` = 3.14.7 → `ZoneInfoNotFoundError` before the lock is created, so no lock, no alert, no log — only a non-zero scheduler result) | Task Scheduler "last run result" non-zero with **no** `logs/run-*.log` and **no** day-lock file for the day; a day with no `last_attempt_day` update at all | Pin the interpreter to one that resolves `Europe/Berlin` (verified: the venv 3.11.9 + `tzdata 2025.3`; or `pip install tzdata`, dry-run confirmed available), add an interpreter/tz self-check as `gate.py`'s first statement that emits `MONITOR_DEGRADED` before touching the lock, and never register the design's literal `py -3` command |
| 8 | **Verification rot** (a green check that certifies nothing — the proven pattern: `verify-freecash-rules.mjs` printed 4/4 PASSED on a file that fails `node --check`) | A verifier whose assertion inputs it never parses (substring matching); `verify-readonly.sh` exit 2 (target missing) being tolerated as "not a failure"; exemption-marker count drifting upward unexplained | P0's verifier must parse/AST and must be proven to fail on a planted violation before any phase is called green; treat exit 2 as a failure; track `# readonly-exempt:` count weekly as a metric |

---

## 5. What is still fake / unverified

Marked explicitly rather than assumed working:

1. **The entire §8 test matrix (T1.1–T5.2) — UNVERIFIED, and currently unexecutable.** `monitoring/` and `monitoring/freecash/` do not exist (`ls -d monitoring/freecash` → *No such file or directory*), `data/freecash-monitor/` does not exist, and `verify-readonly.sh` with its default target exits **2** (`TARGET MISSING … NOT a pass`). Every "expected observable result" in §8 is a prediction, not an observation.
2. **§3.3's claim that `verify-readonly.sh` was "executed during design" — PARTIALLY RE-VERIFIED.** I independently reproduced two of its four rows: missing target → `forbidden=0 exempt=0 missing_targets=1`, exit **2**; `finance-monitor/src` → 1 hit at `rule_engine.py:32` (`earning-verb` on a docstring), exit **1**. I additionally reproduced the pass/fail pair it claims (clean scratch module → exit 0; planted `requests.post("http://x/claim", …)` → `forbidden=4`, exit 1). Marked verified; the design's exact wording "4 hits across 4 patterns" matches what I observed.
3. **`pytest` — UNVERIFIED/FALSE as an available tool.** The design (and `RULE-GATE-CHECKLIST.md` step 5, `py -3 -m pytest`) assumes it; both `python -m pytest` and `py -3.11 -m pytest` return *No module named pytest*. Any plan that counts "16 passed" as a gate must change runner or install the dependency first.
4. **The recommended toast channel's visual delivery — UNVERIFIED.** Only the binary, the assembly load, object construction, icon assignment and clean dispose were verified. Whether a balloon actually **appears on this desktop** (and whether Focus Assist/quiet hours suppress it) was deliberately not tested and must be observed once by a human. No notification was popped during verification.
5. **`-RunLevel Highest` task creation — UNVERIFIED, expected BLOCKED.** Not attempted (hard constraint). The current token is not elevated; the ACL and the pre-existing `\cua-driver-serve` task with `RunLevel HighestAvailable` suggest it was created from an elevated context. Treat P5 as human-gated.
6. **The design's §7.1 consistency — FALSE as written.** "Run whether logged on = Yes" contradicts the command block's `schtasks /Change … /IT` (interactive token = only while logged on). One of the two must be dropped before registration.
7. **`PROVIDER_ENDPOINT_UNKNOWN` — still UNKNOWN, and now worse than "needs credentials".** I independently reproduced `GET https://api.freecash.com/v1/status` → **404**. `PROVIDER-API-RESEARCH.md` concludes the provider publishes **no public read API** and that automated access is prohibited by its terms. That document's findings are **inherited, not re-verified line by line**; the parts I could check (the 404) matched. P6 is therefore a **business/ToS decision gate**, not a credential-binding task, and its "Expected Effort" is genuinely unknown.
8. **`scripts/notification_service.py` defects — PARTIALLY UNVERIFIED.** The grep shows extensive `self.config.get(...)` use and a `return True, None` at line 137; the specific claims "`_send_sms()` returns `True` without sending" and "module-level `send_notification()` references an undefined `config` global" were **not** independently executed. Do not reuse the module as a delivery path until those are exercised.
9. **`scripts/monitoring/free-cash-daily-check.py` inline defects — PARTIALLY RE-VERIFIED.** Ordering defect confirmed (`save_snapshot` at line 266, `load_snapshot` at line 270) and the file compiles. The claimed `is_run_for_today()` fail-open-on-parse-error and the 1%/5% threshold behaviour were **not** executed — unverified.
10. **`scripts/make_freecash_check.py` off-by-one — CONFIRMED by inspection** (`BASE = Path(__file__).resolve().parents[2]`), but its resolved path (`D:\data\freecash`) was not materialized on disk; the directory's absence is inferred, not observed.
11. **`%DATE%` log-redirection breakage — NOT A PROBLEM ON THIS LOCALE.** The design warns about `/` in the date; this host is `de-DE` and produces `18.09.2026` (dots). The redirection works here, but the filename is locale-dependent — replace it with a wrapper `.cmd` regardless. The design's warning is neither confirmed nor applicable here.
12. **`server/tasks/register_approved_change.py`'s missing-`timedelta`-import and MSYS `sys.path.insert` defects — UNVERIFIED** by execution (read-only inspection was not performed in this pass). It is not on the routine's path, so it is not a blocker — just not proven either.
13. **Anything about the operator's real Free Cash account — UNVERIFIED by definition.** `earnings_total_cents`, `balance_cents`, `pending_cents`, `account_status`: no source on this machine produces any of these values. `/api/revenue/metrics` (200, live on 4600) returns `totalOpportunities`, `countsByStage`, `averageOverallScore`, … — **no money or account-status fields**, so even as a substitute source it cannot populate the compared fields. Until P6 opens, R3's comparison has no real input and every clean run is `degraded: true`.

---

## 6. Recommended first build step

**Build Option B's spine on a real interpreter, gated by P0's verifier — in this order, today:**

1. `D:/AgenticOS/monitoring/freecash/verify_rules.py` (P0, ~1 h): a **parsing** verifier (Python `ast`, `node --check` for JS) that fails on a planted violation — because the harness it must beat (`verify-readonly.sh`) already demonstrably returns exit 1 with 4 `FORBIDDEN` hits on a planted `requests.post("http://x/claim", …)`, while the incumbent `verify-freecash-rules.mjs` returns a false `4/4 PASSED` exit 0 on a file that fails `node --check`.
2. `D:/AgenticOS/monitoring/freecash/monitor.py` (P1–P4 subset, ~6–8 h) run **only** via `C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` — the sole interpreter on this host where `ZoneInfo("Europe/Berlin")` resolves (tzdata 2025.3); every other candidate (`py -3` = 3.14.7, `py -3.11`, uv 3.11.16) raises `ZoneInfoNotFoundError` **before** the day lock exists, i.e. a silent crash-loop.
3. Run it twice back-to-back by hand and require: run 1 = lock + snapshot written; run 2 = `SKIP_DUPLICATE_DAY`, exit 0, snapshot untouched (the 5-process race already proves the primitive: **1 winner, 4 `FileExistsError`** on local NTFS `D:`).
4. Only then ask the operator the P5 question (elevation/logon mode) and the P6 question (permitted provider read channel vs. accepted `degraded: true` internal monitor), and register **one** scheduled task — never the literal `py -3` command from the design.

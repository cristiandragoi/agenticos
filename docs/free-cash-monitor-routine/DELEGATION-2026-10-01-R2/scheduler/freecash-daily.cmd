@echo off
REM ============================================================================
REM  freecash-daily.cmd -- Windows Task Scheduler action wrapper for the
REM  canonical Free Cash daily status monitor (package D:\AgenticOS\monitoring\freecash,
REM  entry run_daily_check.py).
REM
REM  DELEGATION: DELEGATION-2026-10-01-R2 / DESIGN TRACK 2 (scheduling, day-lock,
REM  the once-per-day invariant R1).
REM
REM  STATUS: INERT ARTIFACT.  This file registers nothing, arms nothing and is
REM  not referenced by any task.  It becomes live only if a human runs the
REM  approval command in REGISTRATION-COMMAND.txt (rule R4: human approval
REM  before ANY external action).
REM
REM  WHAT IT DOES, IN ORDER
REM    1. Pins every FREECASH_* value as a LITERAL and clears the test-stub
REM       switch, so an ambient FREECASH_DATA_ROOT / FREECASH_TOAST_STUB left in
REM       the environment (e.g. by a concurrent test harness) can never be
REM       inherited by a real run and can never redirect production state.
REM    2. Resolves a Python interpreter that can actually resolve
REM       ZoneInfo('Europe/Berlin') -- i.e. one that ships the IANA tz database.
REM       If none qualifies it writes ONE line to stderr and exits 90 WITHOUT
REM       invoking the monitor, so no day lock can be consumed.  This is
REM       deliberate: on this host the no-tzdata interpreter (py -3, Python
REM       3.14.7) does NOT raise -- gate.resolve_tz() silently falls back to the
REM       machine's own zone (kind='system-local'), which MOVES THE R1 DAY
REM       BOUNDARY. Measured 2026-10-01: with FREECASH_TZ=America/New_York the
REM       instant 2026-07-01T03:30Z yields day key 2026-06-30 under the tzdata
REM       interpreter and 2026-07-01 under the fallback.  A wrong interpreter is
REM       therefore a loud failure here, never a silent day-key shift.
REM    3. Sets the working directory to D:\AgenticOS.
REM    4. Appends everything the monitor prints to a day-stamped log under the
REM       data root: <data root>\logs\daily-<Europe/Berlin day>.log
REM    5. ECHOES NOTHING.  stdout and stderr of this wrapper are empty on every
REM       normal path, including a quiet day (OK_NO_CHANGE) and a duplicate day
REM       (SKIP_DUPLICATE_DAY).  Only a fail-closed setup error writes to stderr
REM       -- that is not a quiet day.  Visibility on a real change / missed day
REM       is provided by the routine's own channel (alerts.jsonl + desktop
REM       toast), which rule R3 mandates; the wrapper adds no second channel.
REM    6. Exits with the monitor's own exit code:
REM         0 ran, or the day was already consumed (a duplicate is not an error)
REM         2 usage error
REM         3 --force-recheck refused (a second read in one day is forbidden)
REM         5 the status read failed; the day lock STAYS in place, no auto re-run
REM       Wrapper-only codes: 90 no tzdata interpreter, 91 cwd missing,
REM       92 entry point missing, 93 log directory not creatable.
REM
REM  READ-ONLY (rule R2): the entry point only ever reads a local file.  It opens
REM  no provider socket, holds no credential, and contains no earning, withdraw,
REM  checkout or other external action.
REM  NO SECRETS: this file contains no credential, token, cookie or password.
REM
REM  SCHEDULE NOTE: the task fires at machine-local 09:00.  R1 is enforced by the
REM  day lock (keyed on the Europe/Berlin calendar date), NOT by the fire time,
REM  so shifting the fire time can never produce two reads in one Berlin day --
REM  the second invocation prints SKIP_DUPLICATE_DAY and performs no read.
REM ============================================================================

setlocal EnableExtensions DisableDelayedExpansion

REM --- 1. pinned production values (the single source of truth for a real run) --
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"
set "FREECASH_TZ=Europe/Berlin"
set "FREECASH_READ_SOURCE=operator_state"
set "FREECASH_TOAST_STUB="
set "FC_ENTRY=D:\AgenticOS\monitoring\freecash\run_daily_check.py"
set "FC_CWD=D:\AgenticOS"
set "FC_LOGDIR=%FREECASH_DATA_ROOT%\logs"

REM --- 2. resolve a tzdata-capable interpreter (fail loud, consume nothing) ----
set "FC_PY="
if defined FREECASH_PY call :probe "%FREECASH_PY%"
call :probe "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
call :probe "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe"
call :probe "%HERMES_HOME%\hermes-agent\venv\Scripts\python.exe"
call :probe "py -3.11"
if not defined FC_PY goto :no_python

REM --- 3. sanity-check the fixed paths ----------------------------------------
if not exist "%FC_CWD%\" goto :no_cwd
if not exist "%FC_ENTRY%" goto :no_entry
if not exist "%FC_LOGDIR%\" mkdir "%FC_LOGDIR%" >nul 2>&1
if not exist "%FC_LOGDIR%\" goto :no_logdir

REM --- 4. day-stamped log, day key from the SAME interpreter and zone ----------
set "FC_DAY="
set "FC_TMP=%TEMP%\freecash-daykey-%RANDOM%-%RANDOM%.txt"
"%FC_PY%" -c "from zoneinfo import ZoneInfo;from datetime import datetime;print(datetime.now(ZoneInfo('Europe/Berlin')).date().isoformat())" > "%FC_TMP%" 2>nul
set /p FC_DAY=<"%FC_TMP%"
del "%FC_TMP%" >nul 2>&1
if not defined FC_DAY set "FC_DAY=unknown-day"
set "FC_LOG=%FC_LOGDIR%\daily-%FC_DAY%.log"

REM --- 5. run the read-only monitor from D:\AgenticOS -------------------------
REM     All child output is redirected into the log; nothing reaches the console.
cd /d "%FC_CWD%"
>>"%FC_LOG%" echo [%DATE% %TIME%] freecash-daily py="%FC_PY%" root="%FREECASH_DATA_ROOT%" tz=%FREECASH_TZ% source=%FREECASH_READ_SOURCE%
"%FC_PY%" "%FC_ENTRY%" --source operator_state >>"%FC_LOG%" 2>&1
set "FC_RC=%ERRORLEVEL%"
exit /b %FC_RC%

REM ============================================================================
REM  failure paths -- each writes one line to stderr and consumes nothing
REM ============================================================================

:no_python
echo freecash-daily: FAIL no tzdata-capable Python interpreter found (needs ZoneInfo('Europe/Berlin')). Tried: FREECASH_PY, the Hermes venv paths, py -3.11. The monitor was NOT run and no day lock was consumed. 1>&2
exit /b 90

:no_cwd
echo freecash-daily: FAIL working directory not found: %FC_CWD% 1>&2
exit /b 91

:no_entry
echo freecash-daily: FAIL entry point not found: %FC_ENTRY% 1>&2
exit /b 92

:no_logdir
echo freecash-daily: FAIL log directory not creatable: %FC_LOGDIR% 1>&2
exit /b 93

REM ============================================================================
REM  :probe <candidate-command-string>
REM  Sets FC_PY to the candidate's own sys.executable ONLY if it can resolve
REM  ZoneInfo('Europe/Berlin').  Silent on failure; the caller tries the next
REM  candidate.  The result is captured through a temp file rather than for /f:
REM  cmd.exe cannot parse a quoted python path together with a quoted -c
REM  program inside for /f backticks (the same trap the log filename avoids).
REM  Candidate strings must be space-free (all absolute paths used here are).
REM ============================================================================

:probe
if defined FC_PY exit /b 0
set "FC_TRY=%~1"
if "%FC_TRY%"=="" exit /b 1
set "FC_PTMP=%TEMP%\freecash-probe-%RANDOM%-%RANDOM%.txt"
%FC_TRY% -c "import sys;from zoneinfo import ZoneInfo;ZoneInfo('Europe/Berlin');print(sys.executable)" > "%FC_PTMP%" 2>nul
if errorlevel 1 goto :probe_done
set "FC_CAND="
set /p FC_CAND=<"%FC_PTMP%"
if defined FC_CAND set "FC_PY=%FC_CAND%"
:probe_done
del "%FC_PTMP%" >nul 2>&1
exit /b 0

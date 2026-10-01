@echo off
REM ============================================================================
REM  freecash-daily.cmd -- Windows Task Scheduler action wrapper for the
REM  Free Cash read-only daily status monitor (DELEGATION-2026-10-01).
REM
REM  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve
REM          it (rule R4) before FreeCash-Daily-Monitor.xml is registered. See
REM          SCHEDULER-SPEC.md in this same directory.
REM
REM  WHAT THIS WRAPPER DOES, IN ORDER
REM    1. Resolves a Python interpreter that can actually resolve
REM       ZoneInfo('Europe/Berlin') -- i.e. one that ships the IANA tz database
REM       (tzdata). It tries a fallback list. If NONE qualifies it prints an
REM       error and exits 90 WITHOUT invoking the monitor, so no day lock can be
REM       consumed. A wrong interpreter is therefore a loud failure, never a
REM       silent day-key degradation.
REM    2. Pins every FREECASH_* value and CLEARS the test-stub switch, so an
REM       ambient value (e.g. a throwaway FREECASH_DATA_ROOT or FREECASH_TOAST_STUB
REM       injected by a concurrent test harness) can never leak into a real run.
REM    3. Sets the working directory to D:\AgenticOS.
REM    4. Appends stdout+stderr to a dated log under the data root
REM       (data/freecash-monitor/logs/daily-<Europe/Berlin day>.log).
REM    5. Exits with the entry point's own exit code:
REM         0 ran, or the day was already consumed (duplicate is not an error)
REM         2 usage error
REM         3 --force-recheck refused
REM         5 the status read failed (the day lock STAYS in place; no auto re-run)
REM       Wrapper-only failure codes: 90 no tzdata interpreter, 91 cwd missing,
REM       92 entry point missing.
REM
REM  READ-ONLY: the entry point only ever reads. It opens no provider socket,
REM  holds no credential and takes no earning/withdraw/checkout action.
REM
REM  NOTE ON QUOTING: the day key for the log filename is captured through a temp
REM  file rather than `for /f`, because cmd.exe cannot parse a quoted Python path
REM  together with a quoted -c program inside for /f backticks. Verified by
REM  execution: the `for /f` form silently yields nothing and the log would be
REM  named "daily-unknown-day.log". The fallback candidates below are absolute
REM  paths that this host was verified to use (no spaces); a candidate that does
REM  not resolve is simply skipped by the probe. Add a space-bearing venv path
REM  explicitly (quoted) if you move it somewhere exotic.
REM ============================================================================

setlocal EnableExtensions

REM --- pinned production values (single source of truth for a real run) --------
REM     NOTE: there is deliberately NO environment seam here. The data root is a
REM     literal, not "whatever FREECASH_DATA_ROOT happens to be", because an
REM     ambient value must never be able to redirect production state.
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"
set "FREECASH_TZ=Europe/Berlin"
set "FREECASH_READ_SOURCE=operator_state"
set "FREECASH_TOAST_STUB="
set "FREECASH_TOAST_RETRY_SLEEP_SECONDS=5"

set "FC_ENTRY=D:\AgenticOS\monitoring\freecash\run_daily_check.py"
set "FC_CWD=D:\AgenticOS"

REM --- 1. resolve a tzdata-capable interpreter (fail loud, consume nothing) ----
set "FC_PY="
if defined FREECASH_PY call :fc_probe "%FREECASH_PY%"
call :fc_probe "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
call :fc_probe "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe"
call :fc_probe "%USERPROFILE%\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
call :fc_probe "py -3.11"
call :fc_probe "py -3"
if not defined FC_PY goto :fc_no_python

REM --- 2. sanity-check the fixed paths ----------------------------------------
if not exist "%FC_CWD%\" goto :fc_no_cwd
if not exist "%FC_ENTRY%" goto :fc_no_entry

REM --- 3. dated log destination ------------------------------------------------
set "FC_LOGDIR=%FREECASH_DATA_ROOT%\logs"
if not exist "%FC_LOGDIR%" mkdir "%FC_LOGDIR%" >nul 2>&1
set "FC_DAY="
set "FC_DAYTMP=%TEMP%\freecash-daykey-%RANDOM%.tmp"
"%FC_PY%" -c "from zoneinfo import ZoneInfo;from datetime import datetime;print(datetime.now(ZoneInfo('Europe/Berlin')).date().isoformat())" > "%FC_DAYTMP%" 2>nul
set /p FC_DAY=<"%FC_DAYTMP%"
del "%FC_DAYTMP%" >nul 2>&1
if not defined FC_DAY set "FC_DAY=unknown-day"
set "FC_LOG=%FC_LOGDIR%\daily-%FC_DAY%.log"

REM --- 4. run the read-only monitor from D:\AgenticOS --------------------------
cd /d "%FC_CWD%"
>>"%FC_LOG%" echo [%DATE% %TIME%] freecash-daily py="%FC_PY%" root="%FREECASH_DATA_ROOT%" tz=%FREECASH_TZ%
"%FC_PY%" "%FC_ENTRY%" --source operator_state >>"%FC_LOG%" 2>&1
set "FC_RC=%ERRORLEVEL%"

exit /b %FC_RC%

REM ============================================================================
REM  failure paths -- each writes one line to stderr and consumes nothing
REM ============================================================================

:fc_no_python
echo freecash-daily: FAIL - no tzdata-capable Python interpreter found. Tried: FREECASH_PY, "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe", "%USERPROFILE%\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe", py -3.11, py -3. The monitor was NOT run and no day lock was consumed. 1>&2
exit /b 90

:fc_no_cwd
echo freecash-daily: FAIL - working directory not found: %FC_CWD% 1>&2
exit /b 91

:fc_no_entry
echo freecash-daily: FAIL - entry point not found: %FC_ENTRY% 1>&2
exit /b 92

REM ============================================================================
REM  :fc_probe <command-string>
REM  Sets FC_PY to the interpreter's own sys.executable ONLY if it can resolve
REM  Europe/Berlin. Silent on failure (the caller tries the next candidate).
REM ============================================================================

:fc_probe
if defined FC_PY exit /b 0
set "FC_TRY=%~1"
if "%FC_TRY%"=="" exit /b 1
for /f "usebackq delims=" %%E in (`%FC_TRY% -c "import sys;from zoneinfo import ZoneInfo;ZoneInfo('Europe/Berlin');print(sys.executable)" 2^>nul`) do set "FC_PY=%%E"
exit /b 0

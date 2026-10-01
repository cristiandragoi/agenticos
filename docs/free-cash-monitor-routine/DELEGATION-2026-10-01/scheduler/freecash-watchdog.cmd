@echo off
REM ============================================================================
REM  freecash-watchdog.cmd -- Windows Task Scheduler action wrapper for the
REM  Free Cash monitor MISSED-DAY watchdog (DELEGATION-2026-10-01).
REM
REM  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve
REM          it (rule R4) before FreeCash-Daily-Monitor-Missed-Day-Watchdog.xml
REM          is registered. See SCHEDULER-SPEC.md in this same directory.
REM
REM  WHY THIS IS A SEPARATE TASK FROM freecash-daily.cmd
REM  The in-band detector in gate.py notices a missed day only at the NEXT run,
REM  i.e. up to 24 h late. This watchdog notices it the SAME EVENING, while the
REM  operator can still act. It cannot become a second run: it opens no socket,
REM  never writes the ledger, never creates or clears a day lock, never writes a
REM  snapshot, never touches the approval queue, never runs the status check, and
REM  always exits 0.
REM
REM  Same interpreter discipline as freecash-daily.cmd: resolve a tzdata-capable
REM  Python from a fallback list, or fail loudly with exit 90 without running
REM  anything. Here a wrong interpreter cannot burn a day lock (the watchdog never
REM  locks), but it WOULD mis-compute the operator-local day and could alarm on the
REM  wrong date, so the interpreter is gated for exactly the same reason.
REM
REM  READ-ONLY: it never contacts the platform and holds no credential.
REM ============================================================================

setlocal EnableExtensions

REM --- pinned production values (no environment seam; see freecash-daily.cmd) ---
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"
set "FREECASH_TZ=Europe/Berlin"
set "FREECASH_TOAST_STUB="
set "FREECASH_TOAST_RETRY_SLEEP_SECONDS=0"

set "FC_ENTRY=D:\AgenticOS\monitoring\freecash\watchdog.py"
set "FC_CWD=D:\AgenticOS"

REM --- resolve a tzdata-capable interpreter (fail loud, run nothing) -----------
set "FC_PY="
if defined FREECASH_PY call :fc_probe "%FREECASH_PY%"
call :fc_probe "C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
call :fc_probe "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe"
call :fc_probe "%USERPROFILE%\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
call :fc_probe "py -3.11"
call :fc_probe "py -3"
if not defined FC_PY goto :fc_no_python

if not exist "%FC_CWD%\" goto :fc_no_cwd
if not exist "%FC_ENTRY%" goto :fc_no_entry

set "FC_LOGDIR=%FREECASH_DATA_ROOT%\logs"
if not exist "%FC_LOGDIR%" mkdir "%FC_LOGDIR%" >nul 2>&1
set "FC_DAY="
set "FC_DAYTMP=%TEMP%\freecash-daykey-wd-%RANDOM%.tmp"
"%FC_PY%" -c "from zoneinfo import ZoneInfo;from datetime import datetime;print(datetime.now(ZoneInfo('Europe/Berlin')).date().isoformat())" > "%FC_DAYTMP%" 2>nul
set /p FC_DAY=<"%FC_DAYTMP%"
del "%FC_DAYTMP%" >nul 2>&1
if not defined FC_DAY set "FC_DAY=unknown-day"
set "FC_LOG=%FC_LOGDIR%\watchdog-%FC_DAY%.log"

cd /d "%FC_CWD%"
>>"%FC_LOG%" echo [%DATE% %TIME%] freecash-watchdog py="%FC_PY%" root="%FREECASH_DATA_ROOT%" tz=%FREECASH_TZ%
"%FC_PY%" "%FC_ENTRY%" >>"%FC_LOG%" 2>&1
set "FC_RC=%ERRORLEVEL%"

REM watchdog.py always exits 0 by design; the real code is reported regardless.
exit /b %FC_RC%

:fc_no_python
echo freecash-watchdog: FAIL - no tzdata-capable Python interpreter found. The watchdog was NOT run. 1>&2
exit /b 90

:fc_no_cwd
echo freecash-watchdog: FAIL - working directory not found: %FC_CWD% 1>&2
exit /b 91

:fc_no_entry
echo freecash-watchdog: FAIL - entry point not found: %FC_ENTRY% 1>&2
exit /b 92

:fc_probe
if defined FC_PY exit /b 0
set "FC_TRY=%~1"
if "%FC_TRY%"=="" exit /b 1
for /f "usebackq delims=" %%E in (`%FC_TRY% -c "import sys;from zoneinfo import ZoneInfo;ZoneInfo('Europe/Berlin');print(sys.executable)" 2^>nul`) do set "FC_PY=%%E"
exit /b 0

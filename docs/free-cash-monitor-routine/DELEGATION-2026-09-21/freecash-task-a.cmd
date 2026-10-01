@echo off
REM ============================================================================
REM  freecash-task-a.cmd  --  Task A action wrapper (daily FreeCash status read)
REM
REM  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve
REM          it (rule R4) before any scheduled task is created. See
REM          SCHEDULER-AND-DELIVERY.md in this same directory.
REM
REM  WHY A WRAPPER EXISTS AT ALL
REM  The task's environment must be set explicitly rather than inherited. While
REM  collecting the evidence for this report, the agent shell was found to carry
REM  FREECASH_DATA_ROOT=<throwaway temp dir> and FREECASH_TOAST_STUB=1 injected by
REM  a concurrent end-to-end test harness. Either value leaking into the
REM  scheduled run would (a) send all state to a throwaway directory and/or
REM  (b) silently downgrade delivery to the STUB_OK test sender while still
REM  printing what looks like success. schtasks cannot set environment variables
REM  (/TR takes a command only), so the values are pinned here.
REM ============================================================================

setlocal

REM --- data root: the real one, never a temp/test path ------------------------
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"

REM --- operator-local timezone used for the R1 day key ------------------------
REM     gate.py reads this; default is already Europe/Berlin, pinned for clarity.
set "FREECASH_TZ=Europe/Berlin"

REM --- read source -------------------------------------------------------------
set "FREECASH_READ_SOURCE=operator_state"

REM --- CLEAR the test stub so a real toast is attempted ------------------------
REM     notify.get_sender() returns the stub sender iff this equals exactly "1".
set "FREECASH_TOAST_STUB="
set "FREECASH_TOAST_RETRY_SLEEP_SECONDS=5"

REM --- interpreter pinned to the venv that has tzdata --------------------------
set "FC_PY=C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"

if not exist "%FREECASH_DATA_ROOT%\logs" mkdir "%FREECASH_DATA_ROOT%\logs"

REM Run with an absolute script path: the script's own directory goes on
REM sys.path (notify.py does `import paths`), so cwd does not matter.
"%FC_PY%" "D:\AgenticOS\monitoring\freecash\run_daily_check.py" --source operator_state >> "%FREECASH_DATA_ROOT%\logs\task-a.log" 2>&1

exit /b %ERRORLEVEL%

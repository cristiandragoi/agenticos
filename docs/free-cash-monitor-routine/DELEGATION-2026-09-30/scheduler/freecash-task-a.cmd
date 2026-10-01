@echo off
REM ============================================================================
REM  freecash-task-a.cmd  --  Task A action wrapper (daily FreeCash status read)
REM
REM  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve
REM          it (rule R4) before any scheduled task is created. See
REM          SCHEDULER-PLAN.md in this same directory.
REM
REM  WHY A WRAPPER EXISTS AT ALL
REM  schtasks cannot set environment variables (/TR takes a command only), and a
REM  scheduled process must NOT inherit an ambient FREECASH_* value: on
REM  2026-09-21 this shell was observed carrying
REM  FREECASH_DATA_ROOT=<throwaway temp dir> and FREECASH_TOAST_STUB=1 injected
REM  by a concurrent e2e harness. Either value leaking into a real run would
REM  (a) send all state to a throwaway directory and/or (b) silently downgrade
REM  delivery to the STUB_OK test sender while still printing what looks like
REM  success. Every FREECASH_* value is therefore pinned here, explicitly.
REM
REM  READ-ONLY: the entry point only ever reads. It opens no provider socket,
REM  holds no credential and takes no earning action.
REM ============================================================================

setlocal

REM --- data root: the real one, never a temp/test path ------------------------
set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"

REM --- operator-local timezone used for the R1 day key ------------------------
REM     gate.py reads this; the built-in default is already Europe/Berlin.
set "FREECASH_TZ=Europe/Berlin"

REM --- read source -------------------------------------------------------------
set "FREECASH_READ_SOURCE=operator_state"

REM --- CLEAR the test stub so a real toast is attempted ------------------------
REM     notify.get_sender() returns the stub sender iff this equals exactly "1".
set "FREECASH_TOAST_STUB="
set "FREECASH_TOAST_RETRY_SLEEP_SECONDS=5"

REM --- interpreter pinned to the venv that HAS tzdata --------------------------
REM     The system py -3 / 3.14 has no IANA database, so Europe/Berlin would not
REM     resolve and the day key would silently degrade to the machine zone.
set "FC_PY=C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
set "FC_ENTRY=D:\AgenticOS\monitoring\freecash\run_daily_check.py"

if not exist "%FREECASH_DATA_ROOT%\logs" mkdir "%FREECASH_DATA_ROOT%\logs"

REM An absolute script path also puts the script's own directory on sys.path
REM (notify.py does `import paths`), so the working directory does not matter.
"%FC_PY%" "%FC_ENTRY%" --source operator_state >> "%FREECASH_DATA_ROOT%\logs\task-a.log" 2>&1

exit /b %ERRORLEVEL%

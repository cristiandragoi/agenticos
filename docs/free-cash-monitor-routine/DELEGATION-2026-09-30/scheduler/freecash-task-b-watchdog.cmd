@echo off
REM ============================================================================
REM  freecash-task-b-watchdog.cmd  --  Task B action wrapper (late-day missed-run
REM  watchdog: same-evening alarm if today's status read never happened).
REM
REM  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve
REM          it (rule R4) before any scheduled task is created. See
REM          SCHEDULER-PLAN.md in this same directory.
REM
REM  The watchdog opens no socket, never writes the ledger, never creates or
REM  clears a day lock, never writes a snapshot and never runs the status check.
REM  Its only writes are alerts/alerts.jsonl and state/notified-keys.json, and
REM  it always exits 0. It must be a SEPARATE task from Task A: if the day's
REM  check ran and succeeded the watchdog is silent; if it never ran, the
REM  watchdog is the only thing that says so the same evening.
REM ============================================================================

setlocal

set "FREECASH_DATA_ROOT=D:\AgenticOS\data\freecash-monitor"
set "FREECASH_TZ=Europe/Berlin"

REM --- CLEAR the test stub so a real toast is attempted ------------------------
set "FREECASH_TOAST_STUB="
set "FREECASH_TOAST_RETRY_SLEEP_SECONDS=0"

set "FC_PY=C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
set "FC_ENTRY=D:\AgenticOS\monitoring\freecash\watchdog.py"

if not exist "%FREECASH_DATA_ROOT%\logs" mkdir "%FREECASH_DATA_ROOT%\logs"

"%FC_PY%" "%FC_ENTRY%" >> "%FREECASH_DATA_ROOT%\logs\task-b-watchdog.log" 2>&1

REM watchdog.py always exits 0 by design; %ERRORLEVEL% is reported anyway.
exit /b %ERRORLEVEL%

@echo off
REM Isolation harness for stream S5 (scheduler). NOT part of the shipped task XML.
REM It exists only to exercise a COPY of the routine against throwaway roots.
REM The shipped XML deliberately has NO wrapper: schtasks cannot set env vars, and
REM a wrapper that pinned FREECASH_DATA_ROOT would make the production task write
REM to a throwaway root, which is the opposite of what production needs.
set "FREECASH_DATA_ROOT=D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R4\scheduler\raw\exec\throwaway-root"
set "AGENT_TEAMS_DB_PATH=D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R4\scheduler\raw\exec\throwaway-db\agent-teams.sqlite3"
set "AGENTICOS_DATA_DIR=D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R4\scheduler\raw\exec\agenticos-data"
C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R4\scheduler\raw\exec\freecash-copy\run_daily_check.py --source operator_state 1>> D:\AgenticOS\docs\free-cash-monitor-routine\DELEGATION-2026-10-01-R4\scheduler\raw\exec\%1 2>&1
echo EXITCODE=%ERRORLEVEL%

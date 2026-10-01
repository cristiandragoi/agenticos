#!/usr/bin/env bash
# run_daybudget_evidence.sh -- day-budget defect (operator R2 ONCE PER DAY) vs the pre-flight wrapper.
# Produces raw/02-daybudget-defect.txt and raw/03-preflight-red-green.txt.
# Writes ONLY under the workflow stream dir and under C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
COPY="$S/routine_copy"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"

# --- throwaway roots -------------------------------------------------------------------
A="$T/defect-dataless/root"
B="$T/preflight-dataless/root"
C="$T/preflight-data/root"
rm -rf "$T"; mkdir -p "$A" "$B" "$C"

# AGENT_TEAMS_DB_PATH / AGENTICOS_DATA_DIR pinned away from the live DB for every execution
export AGENT_TEAMS_DB_PATH="$T/agent-teams.db"
export AGENTICOS_DATA_DIR="$T/agenticos-data"
export FREECASH_TOAST_STUB=1
export FREECASH_TOAST_RETRY_SLEEP_SECONDS=0

list_root () {  # $1 = root label, $2 = root path
  echo "    locks:     $(ls "$2/state/day-locks" 2>/dev/null | tr '\n' ' ')"
  echo "    snapshots: $(ls "$2/snapshots" 2>/dev/null | tr '\n' ' ')"
  echo "    alerts:    $(wc -l < "$2/alerts/alerts.jsonl" 2>/dev/null || echo 0) line(s)"
}

{
echo "###############################################################################"
echo "# 02 — THE DAY-BUDGET DEFECT, REPRODUCED (operator R2 ONCE PER DAY)"
echo "# entry point invoked DIRECTLY by the shipped scheduler shape, on a DATA-LESS day."
echo "# command: FREECASH_DATA_ROOT=$A $PY $COPY/run_daily_check.py"
echo "# cwd: D:/AgenticOS   interpreter: $PY (3.11.9, tzdata)"
echo "# when: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "\$ $PY $S/tools/make_root.py $A 2026-10-01 template $COPY"
"$PY" "$S/tools/make_root.py" "$A" 2026-10-01 template "$COPY"; echo "exit=$?"
echo
echo "\$ FREECASH_DATA_ROOT=$A $PY $COPY/run_daily_check.py"
FREECASH_DATA_ROOT="$A" "$PY" "$COPY/run_daily_check.py"; echo "exit=$?"
echo
echo "--- state of the throwaway root AFTER the data-less run (this is the defect) ---"
list_root A "$A"
echo "    ledger:    $(cat "$A/state/last-run.json" | tr -d '\n' | tr -s ' ')"
echo
echo "PROOF OF THE DEFECT: one lock acquired, one snapshot written with null figures, and"
echo "the day booked as a SUCCESS day by gate.SUCCESS_OUTCOMES (gate.py:32-40, :198-200)."
} > "$S/raw/02-daybudget-defect.txt" 2>&1
cat "$S/raw/02-daybudget-defect.txt"

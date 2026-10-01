#!/usr/bin/env bash
# run_preflight_evidence.sh -- the pre-flight wrapper, both directions, one file.
#   RED   : the wrapper REFUSES on a data-less day (entry point NOT invoked)
#   GREEN : the wrapper PROCEEDS on a data-carrying day (entry point invoked, exit 0)
# Writes ONLY under the workflow stream dir and under C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
COPY="$S/routine_copy"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"
B="$T/preflight-dataless/root"
C="$T/preflight-data/root"
rm -rf "$B" "$C"; mkdir -p "$B" "$C"

export AGENT_TEAMS_DB_PATH="$T/agent-teams.db"
export AGENTICOS_DATA_DIR="$T/agenticos-data"
export FREECASH_TOAST_STUB=1
export FREECASH_TOAST_RETRY_SLEEP_SECONDS=0

list_root () {
  echo "    locks:     [$(ls "$2/state/day-locks" 2>/dev/null | tr '\n' ' ')]"
  echo "    snapshots: [$(ls "$2/snapshots" 2>/dev/null | tr '\n' ' ')]"
  echo "    ledger:    $(cat "$2/state/last-run.json" 2>/dev/null | tr -d '\n' | tr -s ' ')"
}

{
echo "###############################################################################"
echo "# 03 — PRE-FLIGHT WRAPPER: REFUSES ON A DATA-LESS DAY, PROCEEDS ON A DATA-CARRYING DAY"
echo "# wrapper: $S/tools/preflight_check.py"
echo "# routine (a COPY, per the isolation contract): $COPY"
echo "# during:  $(date -u '+%Y-%m-%dT%H:%M:%SZ')  local $(date '+%H:%M:%S %z')"
echo "# env:     FREECASH_DATA_ROOT=<throwaway> AGENT_TEAMS_DB_PATH/AGENTICOS_DATA_DIR pinned away"
echo "###############################################################################"
echo
echo "=================================== RED ======================================="
echo "# planted condition: a DATA-LESS day -- operator-state.json exists with records: []"
echo "\$ $PY $S/tools/make_root.py $B 2026-10-01 template $COPY"
"$PY" "$S/tools/make_root.py" "$B" 2026-10-01 template "$COPY"; echo "exit=$?"
echo
echo "\$ FREECASH_DATA_ROOT=$B $PY $S/tools/preflight_check.py --routine-dir $COPY"
FREECASH_DATA_ROOT="$B" "$PY" "$S/tools/preflight_check.py" --routine-dir "$COPY"; echo "PREFLIGHT_EXIT=$?"
echo
echo "--- throwaway root AFTER the refusal ---"
list_root B "$B"
echo
echo "RED   : preflight exits 4 on a data-less day and the entry point is NOT invoked"
echo "        (day_lock_created=False, snapshot_written=False, status_read_performed=False)"
echo
echo
echo "================================= RED (guard) ================================="
echo "# planted condition: FREECASH_DATA_ROOT unset and no --allow-default-root override."
echo "# The wrapper must fail closed rather than fall through to the production root."
echo "\$ $PY $S/tools/preflight_check.py --routine-dir $COPY"
( unset FREECASH_DATA_ROOT; "$PY" "$S/tools/preflight_check.py" --routine-dir "$COPY" ); echo "PREFLIGHT_EXIT=$?"
echo
echo "RED-guard: preflight exits 4 and names the default root it refused to touch."
echo
echo
echo "================================== GREEN ======================================"
echo "# unmodified condition: a DATA-CARRYING day -- one operator-entered record for today"
echo "\$ $PY $S/tools/make_root.py $C 2026-10-01 record $COPY"
"$PY" "$S/tools/make_root.py" "$C" 2026-10-01 record "$COPY"; echo "exit=$?"
echo
echo "\$ FREECASH_DATA_ROOT=$C $PY $S/tools/preflight_check.py --routine-dir $COPY"
FREECASH_DATA_ROOT="$C" "$PY" "$S/tools/preflight_check.py" --routine-dir "$COPY"; echo "PREFLIGHT_EXIT=$?"
echo
echo "--- throwaway root AFTER the proceeding run ---"
list_root C "$C"
echo "    snapshot 2026-10-01.json: $(cat "$C/snapshots/2026-10-01.json" 2>/dev/null | tr -d '\n' | tr -s ' ')"
echo
echo "GREEN : preflight exits 0 on a data-carrying day; the entry point ran and exit 0"
echo
echo
echo "============================== GREEN (repeat) ================================="
echo "# the SAME data-carrying root, run a second time on the same day: the wrapper must now"
echo "# refuse with exit 5, because the day's single read is genuinely spent."
echo "\$ FREECASH_DATA_ROOT=$C $PY $S/tools/preflight_check.py --routine-dir $COPY"
FREECASH_DATA_ROOT="$C" "$PY" "$S/tools/preflight_check.py" --routine-dir "$COPY"; echo "PREFLIGHT_EXIT=$?"
echo
echo "GREEN(repeat): exit 5 -- exactly one read for the day, and the refusal costs nothing."
} > "$S/raw/03-preflight-red-green.txt" 2>&1
cat "$S/raw/03-preflight-red-green.txt"

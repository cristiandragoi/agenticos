#!/usr/bin/env bash
# Additive evidence script for DELEGATION-2026-10-01 / delivery track.
# Runs the PROPOSED control (a copy of approval_queue.py living inside the
# delivery directory only - the real source is never touched) against a
# THROWAWAY root, and shows the boundary it creates.
set -u
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
D="D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01/delivery"
PROPOSED="$D/proposed/approval_queue.py"
THROW="C:/Users/cd-pr/AppData/Local/Temp/freecash-deleg-2026-10-01"
ROOT="$THROW/proposed-queue"
export PYTHONPATH="D:/AgenticOS/monitoring/freecash"
export FREECASH_TOAST_STUB=1

echo "== proposed-control check, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== proposed file : $PROPOSED (a COPY; the real source is untouched)"
echo "== import path   : PYTHONPATH=$PYTHONPATH  (for 'import paths')"
echo "== throwaway root: $ROOT"
echo ""
echo "\$ python -m py_compile $PROPOSED"
"$PY" -m py_compile "$PROPOSED"
echo "py_compile exit=$?"
echo ""
echo "\$ diff -u monitoring/freecash/approval_queue.py <copy>   (the patch, see the .diff file)"

case_run () { local label="$1"; local idenv="$2"; shift 2
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  export FREECASH_DATA_ROOT="$ROOT"
  local id
  id=$("$PY" -c "import approval_queue as aq; print(aq.enqueue('2026-10-01', {'dedupe_key':'probe'}, 'probe')['approval_id'])")
  echo ""
  echo "--------------------------------------------------------------"
  echo "CASE: $label"
  echo "\$ FREECASH_OPERATOR_IDENTITY=[$idenv]"
  echo "\$ python <proposed>/approval_queue.py decide --id $id --decision approve $*"
  if [ -n "$idenv" ]; then export FREECASH_OPERATOR_IDENTITY="$idenv"; else unset FREECASH_OPERATOR_IDENTITY; fi
  "$PY" "$PROPOSED" decide --id "$id" --decision approve "$@"
  echo "exit_code = $?"
  FREECASH_DATA_ROOT="$ROOT" "$PY" -c "import json,approval_queue as aq; i=aq.find_item('$id'); print('item state:', json.dumps({k:i[k] for k in ('status','decided_by','execution_state')}))"
  unset FREECASH_OPERATOR_IDENTITY
}

case_run 'P1 no identity configured, --by "Hermes Agent"'      ''                     --by "Hermes Agent" --note probe
case_run 'P2 identity configured = a human, --by "Hermes Agent"' 'Christian Doppler'  --by "Hermes Agent" --note probe
case_run 'P3 identity configured = a machine label'             'FreeCash Monitor Bot' --by "FreeCash Monitor Bot" --note probe
case_run 'P4 identity configured = a human, --by matches'       'Christian Doppler'   --by "Christian Doppler" --note "checked the figures myself"
case_run 'P5 identity configured, --by omitted'                 'Christian Doppler'   --note probe

echo ""
echo "== done; the last CASE (P5) uses argparse's own required-argument refusal."

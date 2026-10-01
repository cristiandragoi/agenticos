#!/usr/bin/env bash
# Additive evidence script for DELEGATION-2026-10-01 / delivery track.
# Re-reproduces the approval-identity defect (accepted machine labels) and the
# refusal boundary, against a THROWAWAY FREECASH_DATA_ROOT only.
# Writes nothing outside the throwaway root and this delivery directory.
set -u
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
THROW="C:/Users/cd-pr/AppData/Local/Temp/freecash-deleg-2026-10-01"
ROOT="$THROW/repro-queue"
cd "D:/AgenticOS/monitoring/freecash" || exit 99
export FREECASH_DATA_ROOT="$ROOT"
export FREECASH_TOAST_STUB=1

echo "== timestamp (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== interpreter: $PY"
echo "== cwd: $(pwd)"
echo "== \$FREECASH_DATA_ROOT = [$FREECASH_DATA_ROOT]   (throwaway)"
echo "== \$FREECASH_TOAST_STUB = [$FREECASH_TOAST_STUB]  (stub sender; no real toast)"

seed_and_decide () {
  label="$1"; shift
  rm -rf "$ROOT"
  mkdir -p "$ROOT"
  local id
  id=$("$PY" -c "import approval_queue as aq; print(aq.enqueue('2026-10-01', {'dedupe_key':'probe-defect'}, 'probe: defect repro')['approval_id'])")
  echo ""
  echo "--------------------------------------------------------------"
  echo "CASE: $label"
  echo "seeded approval_id = $id"
  echo "\$ python approval_queue.py decide --id $id --decision approve $*"
  "$PY" approval_queue.py decide --id "$id" --decision approve "$@"
  echo "exit_code = $?"
  echo "--- pending.json item state:"
  "$PY" -c "import json,approval_queue as aq; i=aq.find_item('$id'); print(json.dumps({k:i[k] for k in ('status','decided_by','decided_at_utc','expires_at_utc','execution_state','execution_allowed_by_this_routine')}, indent=2))"
  echo "--- decided.jsonl line:"
  "$PY" -c "import json,sys,paths; sys.stdout.write(''.join(json.dumps(r,indent=2)+chr(10) for r in paths.read_jsonl(paths.decided_path()) if r.get('approval_id')=='$id'))"
}

seed_and_decide 'MACHINE LABEL 1: --by "Hermes Agent"'     --by "Hermes Agent"       --note "probe"
seed_and_decide 'MACHINE LABEL 2: --by "FreeCash Monitor Bot"' --by "FreeCash Monitor Bot" --note "probe"
seed_and_decide 'MACHINE LABEL 3: --by "agent-1"'          --by "agent-1"            --note "probe"
seed_and_decide 'REFUSAL: --by omitted entirely'           --note "probe"
seed_and_decide 'REFUSAL: --by "" (empty string)'          --by ""                   --note "probe"
seed_and_decide 'REFUSAL: --by "agent" (literal denylist word)' --by "agent"         --note "probe"
seed_and_decide 'ACCEPT (the case the gate is FOR): --by "Christian Doppler"' --by "Christian Doppler" --note "operator decision"

echo ""
echo "== done; final throwaway root tree:"
find "$ROOT" -type f | sort

#!/usr/bin/env bash
# Repro of the LIVE denylist defect (BEFORE), this session, against a THROWAWAY
# root only. Shows the current shipped guard (monitoring/freecash/approval_queue.py,
# NON_HUMAN_DECIDERS denylist at :55, enforced :153) ACCEPTING machine/unlisted
# deciders that the allowlist proposal refuses.
# Reads the live module only; writes nothing outside the throwaway root + this dir.
set -u
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
PKG="D:/AgenticOS/monitoring/freecash"
ROOT="C:/Users/cd-pr/AppData/Local/Temp/fc-r3-identity-live-defect/root"
cd "$PKG" || exit 99
export FREECASH_DATA_ROOT="$ROOT"
export FREECASH_TOAST_STUB=1

echo "== utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== interpreter: $PY  ($("$PY" -V 2>&1))"
echo "== live module: $PKG/approval_queue.py"
echo "== live NON_HUMAN_DECIDERS guard line:"
grep -n "NON_HUMAN_DECIDERS\|who.lower() in NON_HUMAN" approval_queue.py
echo "== grep for the allowlist control in the LIVE file (expect: absent):"
grep -n "OPERATOR_IDENTITY_ENV\|human-deciders\|AllowlistError\|load_operator_allowlist" approval_queue.py || echo "   <none: the allowlist control is absent from the live file>"
echo "== throwaway root: $ROOT"

probe () {
  label="$1"; shift
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  id=$("$PY" -c "import approval_queue as aq; print(aq.enqueue('2026-10-01', {'dedupe_key':'live-defect'}, 'live denylist defect probe')['approval_id'])")
  echo ""
  echo "--------------------------------------------------------------"
  echo "CASE: $label"
  echo "\$ python approval_queue.py decide --id $id --decision approve $*"
  "$PY" approval_queue.py decide --id "$id" --decision approve "$@"
  echo "exit_code = $?"
  "$PY" -c "import approval_queue as aq; i=aq.find_item('$id'); print('  item: status=%s decided_by=%r execution_state=%s expires_at_utc=%r' % (i['status'], i['decided_by'], i['execution_state'], i['expires_at_utc']))"
}

probe 'DENYLIST BYPASS 1: --by "hermes-agent"  (the value already recorded in an earlier pass)' --by "hermes-agent" --note "probe"
probe 'DENYLIST BYPASS 2: --by "Claude"'          --by "Claude"       --note "probe"
probe 'DENYLIST BYPASS 3: --by "operator-1"'      --by "operator-1"   --note "probe"
probe 'DENYLIST BYPASS 4: --by "assistant"'       --by "assistant"    --note "probe"
probe 'FLOOR STILL WORKS: --by "agent"'           --by "agent"        --note "probe"

echo ""
echo "== live file untouched (sha256):"
sha256sum "$PKG/approval_queue.py"
echo "== done"

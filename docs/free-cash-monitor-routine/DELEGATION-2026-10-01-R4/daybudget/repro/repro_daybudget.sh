#!/usr/bin/env bash
# repro_daybudget.sh -- R4 stream D ("day budget"), DELEGATION-2026-10-01-R4.
#
# Reproduces, from the SHIPPED package, every claim in DAYBUDGET-FINDINGS.md:
#
#   1. R3's acceptance test is RED against the shipped package (6 of 7).
#   2. The delivered diff applies to a COPY of the shipped package (never to the
#      shipped package itself) and turns that file GREEN (7 of 7) in one run.
#   3. The package's own offline suite still reports failures=0 errors=0 on the
#      remedied copy (52 tests), with a throwaway FREECASH_DATA_ROOT.
#   4. Scratch-root behaviour, by real CLI invocation:
#        data-less run   -> state/day-locks/ EMPTY, ledger byte-identical,
#                           last_success_day unchanged, consecutive_missed_days
#                           preserved, no snapshot, watchdog WATCHDOG_MISSED_DAY
#        reading-present -> exactly one lock + one snapshot; a second run the
#                           same day prints SKIP_DUPLICATE_DAY and writes nothing
#   5. The residual fallback (probe passes, read finds nothing) still releases
#      the day and leaves the watchdog reporting the day as missed.
#
# Rule numbering: operator R1 "no earning action" / R2 "check status once per
# day" (labelled "R1" by the shipped docstrings) / R3 notify on change / R4 human
# approval.  This remedy is the operator's R2.
#
# Isolation: writes only under $WORK (a throwaway %TEMP% dir) and nowhere else.
# The shipped package, the repo's data/ root and the repo itself are untouched:
# this script makes no git call that writes, registers no schedule and opens no
# non-loopback socket.
#
# Usage:  bash docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/daybudget/repro/repro_daybudget.sh
#   override with REPO_ROOT=, PY=, WORK=

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# native (C:/...) form of HERE for the Windows interpreter -- MSYS /d/... paths
# are not understood by native Python.
if command -v cygpath >/dev/null 2>&1; then HERE_NATIVE="$(cygpath -m "$HERE")"; else HERE_NATIVE="$HERE"; fi
STREAM="$(cd "$HERE/.." && pwd)"
REPO_ROOT="${REPO_ROOT:-D:/AgenticOS}"
PY="${PY:-C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe}"
PATCH="$STREAM/remedy/daybudget-r2-floor.patch"
R3TEST="$REPO_ROOT/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/daybudget/failing-test-first/test_daybudget_data_less.py"
LOCAL_BASE="${LOCALAPPDATA//\\//}"
WORK="${WORK:-$LOCAL_BASE/Temp/fc-r4-daybudget-repro-$$}"

export FREECASH_TOAST_STUB=1
export FREECASH_TOAST_RETRY_SLEEP_SECONDS=0

FAILED=0
check() { # check <name> <condition-command...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "CHECK PASS  $name"
  else
    echo "CHECK FAIL  $name"
    FAILED=1
  fi
}

echo "=== repro_daybudget.sh ==============================================="
echo "repo root        : $REPO_ROOT"
echo "interpreter      : $PY  ($("$PY" -V 2>&1))"
echo "patch            : $PATCH"
echo "throwaway workdir: $WORK"
echo "host clock       : $(date)"
echo

ls -l "$PATCH" "$R3TEST" || exit 2

# ---------------------------------------------------------------- scratch tree
rm -rf "$WORK"
mkdir -p "$WORK/tree/monitoring" "$WORK/tree/docs/free-cash-monitor-routine"
cp -r "$REPO_ROOT/monitoring/freecash" "$WORK/tree/monitoring/freecash"
rm -rf "$WORK/tree/monitoring/freecash/__pycache__" "$WORK/tree/monitoring/freecash/tests/__pycache__"
cp "$REPO_ROOT/docs/free-cash-monitor-routine/verify-readonly.sh" \
   "$WORK/tree/docs/free-cash-monitor-routine/verify-readonly.sh"
TREE="$WORK/tree"
COPY="$TREE/monitoring/freecash"
SHIPPED="$REPO_ROOT/monitoring/freecash"

echo "--- 1. apply the delivered diff to the COPY (never to the shipped tree) ---"
( cd "$TREE" && git apply -p1 "$PATCH" ) && HOW="git apply -p1" || {
  ( cd "$TREE" && patch -p1 --forward < "$PATCH" ) && HOW="patch -p1" || { echo "PATCH DID NOT APPLY"; exit 2; }
}
echo "applied with: $HOW"
echo "shipped gate.py sha256 (must be unchanged by this script):"
sha256sum "$SHIPPED/gate.py" "$SHIPPED/run_daily_check.py" "$SHIPPED/tests/test_r5_smoke.py"
echo "copy gate.py sha256 (differs -- the remedy):"
sha256sum "$COPY/gate.py" "$COPY/run_daily_check.py" "$COPY/tests/test_r5_smoke.py"
echo "diff summary:"; diff -rq "$SHIPPED" "$COPY" 2>/dev/null | sed 's/^/  /'
echo

# ------------------------------------------------- accepted suites / test file
echo "--- 2. ACCEPTANCE TEST, ONE RUN: RED (shipped) then GREEN (remedied) ---"
export FREECASH_DATA_ROOT="$WORK/root-r3test"
echo "### COMMAND: FREECASH_ROUTINE_DIR=$SHIPPED \"$PY\" $R3TEST -v"
FREECASH_ROUTINE_DIR="$SHIPPED" "$PY" "$R3TEST" -v > "$WORK/red.txt" 2>&1
RED_EXIT=$?
grep -E "^(Ran |OK|FAILED)" "$WORK/red.txt" | sed 's/^/  RED  /'
echo "  RED  exit=$RED_EXIT"
check "shipped package is RED (6 failures of 7)" test "$RED_EXIT" -eq 1
check "shipped package reports 'FAILED (failures=6)'" grep -q "FAILED (failures=6)" "$WORK/red.txt"

echo "### COMMAND: FREECASH_ROUTINE_DIR=$COPY \"$PY\" $R3TEST -v"
FREECASH_ROUTINE_DIR="$COPY" "$PY" "$R3TEST" -v > "$WORK/green.txt" 2>&1
GREEN_EXIT=$?
grep -E "^test_|^(Ran |OK|FAILED)" "$WORK/green.txt" | sed 's/^/  GREEN /'
echo "  GREEN exit=$GREEN_EXIT"
check "remedied copy is GREEN (7 of 7, exit 0)" test "$GREEN_EXIT" -eq 0
check "remedied copy ran 7 tests and printed OK" grep -q "^Ran 7 tests" "$WORK/green.txt"
grep -q "^OK$" "$WORK/green.txt"
echo

echo "--- 3. package's own offline suite, remedied copy, throwaway root ---"
export FREECASH_DATA_ROOT="$WORK/root-suite"
echo "### COMMAND: FREECASH_DATA_ROOT=$FREECASH_DATA_ROOT \"$PY\" $COPY/tests/run_all.py"
"$PY" "$COPY/tests/run_all.py" > "$WORK/suite.txt" 2>&1
SUITE_EXIT=$?
tail -1 "$WORK/suite.txt" | sed 's/^/  /'
echo "  exit=$SUITE_EXIT"
check "remedied suite: 52 tests, failures=0 errors=0, exit 0" \
  grep -q "run_all: tests=52 failures=0 errors=0 skipped=0" "$WORK/suite.txt"
test "$SUITE_EXIT" -eq 0
echo

# ---------------------------------------------------------------- scratch roots
TODAY="$("$PY" -c "import sys; sys.path.insert(0,'$COPY'); import gate; print(gate.day_key())")"
echo "--- 4. scratch-root behaviour (day key $TODAY) ---"

seed_degraded_ledger() { # $1 = ledger path
  "$PY" - "$1" <<'PYEOF'
import json, os, sys
path = sys.argv[1]
doc = {
    "schema_version": 1,
    "last_attempt_day": "2026-09-30",
    "last_attempt_at_utc": "2026-09-30T06:53:46Z",
    "last_success_day": "2026-09-30",
    "last_success_at_utc": "2026-09-30T06:53:46Z",
    "last_outcome": "MONITOR_DEGRADED",
    "consecutive_missed_days": 9,
    "timezone": "Europe/Berlin",
    "updated_at_utc": "2026-09-30T06:53:46Z",
}
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(doc, indent=2) + "\n")
PYEOF
}

seed_operator_record() { # $1 = operator-state.json path, $2 = day
  "$PY" - "$1" "$2" <<'PYEOF'
import json, os, sys
path, day = sys.argv[1], sys.argv[2]
doc = {
    "schema_version": 1,
    "kind": "operator_entered_daily_status",
    "note": "repro seed; operator-entered figures",
    "records": [{
        "day_key": day,
        "entered_at_utc": day + "T06:40:00Z",
        "account_status": "ACTIVE",
        "earnings_total_cents": 1025,
        "balance_cents": 1025,
        "pending_cents": 0,
        "currency": "USD",
    }],
}
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(doc, indent=2) + "\n")
PYEOF
}

read_key() { # $1 = json path, $2 = key
  "$PY" -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8')).get(sys.argv[2]))" "$1" "$2"
}

# ---- 4a. data-less run -------------------------------------------------------
ROOT_LESS="$WORK/root-less"
export FREECASH_DATA_ROOT="$ROOT_LESS"
seed_degraded_ledger "$ROOT_LESS/state/last-run.json"
LEDGER_BEFORE="$(sha256sum "$ROOT_LESS/state/last-run.json" | cut -d' ' -f1)"
echo "### COMMAND: FREECASH_DATA_ROOT=$ROOT_LESS \"$PY\" $COPY/run_daily_check.py"
"$PY" "$COPY/run_daily_check.py" > "$WORK/less-run.txt" 2>&1
LESS_EXIT=$?
sed 's/^/  /' "$WORK/less-run.txt"
echo "  exit=$LESS_EXIT"
check "data-less run exits 0" test "$LESS_EXIT" -eq 0
check "data-less run prints RUN_NO_DATA" grep -q "^RUN_NO_DATA " "$WORK/less-run.txt"

LOCK_COUNT=$(find "$ROOT_LESS/state/day-locks" -name '*.lock' 2>/dev/null | wc -l)
SNAP_COUNT=$(find "$ROOT_LESS/snapshots" -name '*.json' 2>/dev/null | wc -l)
echo "  state/day-locks/ lock count = $LOCK_COUNT ; snapshots/ json count = $SNAP_COUNT"
check "state/day-locks/ is EMPTY after a data-less run" test "$LOCK_COUNT" -eq 0
check "no snapshot written by a data-less run" test "$SNAP_COUNT" -eq 0
LEDGER_AFTER="$(sha256sum "$ROOT_LESS/state/last-run.json" | cut -d' ' -f1)"
echo "  ledger sha256 before=$LEDGER_BEFORE after=$LEDGER_AFTER"
check "last-run.json is byte-identical (no attempt, no success, no counter)" test "$LEDGER_BEFORE" = "$LEDGER_AFTER"
ls_last_success="$(read_key "$ROOT_LESS/state/last-run.json" last_success_day)"
ls_missed="$(read_key "$ROOT_LESS/state/last-run.json" consecutive_missed_days)"
echo "  last_success_day=$ls_last_success consecutive_missed_days=$ls_missed"
check "last_success_day unchanged (2026-09-30)" test "$ls_last_success" = "2026-09-30"
check "consecutive_missed_days preserved (9)" test "$ls_missed" = "9"

echo "### COMMAND: FREECASH_DATA_ROOT=$ROOT_LESS \"$PY\" $COPY/watchdog.py"
"$PY" "$COPY/watchdog.py" > "$WORK/less-watchdog.txt" 2>&1
sed 's/^/  /' "$WORK/less-watchdog.txt"
check "watchdog prints WATCHDOG_MISSED_DAY" grep -q "^WATCHDOG_MISSED_DAY " "$WORK/less-watchdog.txt"
check "watchdog appended exactly one MISSED_DAY alert" \
  "$PY" -c "import json,sys;rs=[json.loads(l) for l in open(sys.argv[1],encoding='utf-8') if l.strip()];print(sum(1 for r in rs if r['event_type']=='MISSED_DAY'));sys.exit(0 if sum(1 for r in rs if r['event_type']=='MISSED_DAY')==1 else 1)" \
  "$ROOT_LESS/alerts/alerts.jsonl"
echo "  alerts.jsonl (raw):"
sed 's/^/    /' "$ROOT_LESS/alerts/alerts.jsonl"
echo

# the day is still usable the same day ----------------------------------------
seed_operator_record "$ROOT_LESS/state/operator-state.json" "$TODAY"
echo "### same day, now WITH a reading: FREECASH_DATA_ROOT=$ROOT_LESS \"$PY\" $COPY/run_daily_check.py"
"$PY" "$COPY/run_daily_check.py" > "$WORK/less-run2.txt" 2>&1
sed 's/^/  /' "$WORK/less-run2.txt"
check "the day is still usable: the later reading-present run consumed it" \
  grep -q "^RUN_OK $TODAY outcome=INITIAL_BASELINE" "$WORK/less-run2.txt"
check "exactly one lock now exists" test "$(find "$ROOT_LESS/state/day-locks" -name '*.lock' | wc -l)" -eq 1
check "exactly one snapshot now exists" test "$(find "$ROOT_LESS/snapshots" -name '*.json' | wc -l)" -eq 1
echo

# ---- 4b. reading-present run, fresh root ------------------------------------
ROOT_READ="$WORK/root-read"
export FREECASH_DATA_ROOT="$ROOT_READ"
seed_operator_record "$ROOT_READ/state/operator-state.json" "$TODAY"
echo "### COMMAND: FREECASH_DATA_ROOT=$ROOT_READ \"$PY\" $COPY/run_daily_check.py"
"$PY" "$COPY/run_daily_check.py" > "$WORK/read-run1.txt" 2>&1
sed 's/^/  /' "$WORK/read-run1.txt"
check "reading-present run: RUN_OK outcome=INITIAL_BASELINE" grep -q "^RUN_OK $TODAY outcome=INITIAL_BASELINE" "$WORK/read-run1.txt"
check "reading-present run consumed exactly one day (1 lock)" test "$(find "$ROOT_READ/state/day-locks" -name '*.lock' | wc -l)" -eq 1
check "reading-present run wrote exactly one snapshot" test "$(find "$ROOT_READ/snapshots" -name '*.json' | wc -l)" -eq 1
LEDGER_B2="$(sha256sum "$ROOT_READ/state/last-run.json" | cut -d' ' -f1)"
SNAP_MTIME_B="$(stat -c %Y "$ROOT_READ/snapshots/$TODAY.json")"
echo "### second run the same day (cap): FREECASH_DATA_ROOT=$ROOT_READ \"$PY\" $COPY/run_daily_check.py"
"$PY" "$COPY/run_daily_check.py" > "$WORK/read-run2.txt" 2>&1
sed 's/^/  /' "$WORK/read-run2.txt"
check "second run prints SKIP_DUPLICATE_DAY" grep -q "^SKIP_DUPLICATE_DAY $TODAY" "$WORK/read-run2.txt"
check "second run changed neither ledger nor snapshot nor lock count" \
  test "$LEDGER_B2" = "$(sha256sum "$ROOT_READ/state/last-run.json" | cut -d' ' -f1)" -a \
       "$SNAP_MTIME_B" = "$(stat -c %Y "$ROOT_READ/snapshots/$TODAY.json")" -a \
       "$(find "$ROOT_READ/state/day-locks" -name '*.lock' | wc -l)" -eq 1
echo "  last_success_day=$(read_key "$ROOT_READ/state/last-run.json" last_success_day) consecutive_missed_days=$(read_key "$ROOT_READ/state/last-run.json" consecutive_missed_days)"
echo

# ---- 4c. residual fallback ---------------------------------------------------
echo "--- 5. residual fallback: probe finds a reading, the read finds none ---"
ROOT_FB="$WORK/root-fallback"
export FREECASH_DATA_ROOT="$ROOT_FB"
seed_degraded_ledger "$ROOT_FB/state/last-run.json"
seed_operator_record "$ROOT_FB/state/operator-state.json" "$TODAY"
echo "### COMMAND: FREECASH_ROUTINE_DIR=$COPY FREECASH_DATA_ROOT=$ROOT_FB \"$PY\" $HERE_NATIVE/fallback_probe_driver.py"
FREECASH_ROUTINE_DIR="$COPY" "$PY" "$HERE_NATIVE/fallback_probe_driver.py" > "$WORK/fallback.txt" 2>&1
FB_EXIT=$?
sed 's/^/  /' "$WORK/fallback.txt"
check "fallback path holds every day-budget property" test "$FB_EXIT" -eq 0
echo

echo "=== summary =========================================================="
if [ "$FAILED" -eq 0 ]; then
  echo "ALL CHECKS PASSED (shipped RED 6/7 -> remedied GREEN 7/7; suite 52/0/0)"
else
  echo "AT LEAST ONE CHECK FAILED -- see 'CHECK FAIL' lines above"
fi
echo "scratch workdir kept for inspection: $WORK"
echo "shipped package untouched (this script wrote only under \$WORK)"
exit "$FAILED"

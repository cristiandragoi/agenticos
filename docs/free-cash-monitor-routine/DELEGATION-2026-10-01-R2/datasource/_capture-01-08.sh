#!/usr/bin/env bash
# Evidence capture for DESIGN TRACK 1 (datasource). Scratch roots only.
set -u
EV="/d/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/datasource"
FC="/d/AgenticOS/monitoring/freecash"
TMP="C:/Users/cd-pr/AppData/Local/Temp"

cd "$FC" || exit 1

# ---------- 01..04 raw source with line numbers ----------
for pair in "01:operator_state.py" "02:paths.py" "03:readonly_client.py" "04:run_daily_check.py"; do
  n="${pair%%:*}"; f="${pair#*:}"
  {
    echo "\$ cd D:/AgenticOS/monitoring/freecash && nl -ba $f"
    nl -ba "$f"
    echo "exit=$?"
  } > "$EV/evidence-$n-source-$f.txt" 2>&1
done

# ---------- 04b interpreter identity ----------
{
  echo "\$ python -VV"
  python -VV
  echo "exit=$?"
  echo
  echo "\$ which python"
  which python
  echo "exit=$?"
} > "$EV/evidence-04b-python-interpreter.txt" 2>&1

# ---------- 05 hermeticity BEFORE ----------
cd /d/AgenticOS || exit 1
{
  echo "\$ date"
  date
  echo "exit=$?"
  echo
  echo "\$ sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl"
  sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl
  echo "exit=$?"
  echo
  echo "\$ find data/freecash-monitor -type f -newermt \"2026-10-01 00:00\" | sort"
  find data/freecash-monitor -type f -newermt "2026-10-01 00:00" | sort
  echo "exit=$?"
  echo
  echo "\$ find data/freecash-monitor -type f | sort"
  find data/freecash-monitor -type f | sort
  echo "exit=$?"
} > "$EV/evidence-05-hermeticity-before.txt" 2>&1

# ---------- 06 empty scratch root, no reading ----------
export FREECASH_DATA_ROOT="$TMP/fc-r2-empty"
rm -rf "$FREECASH_DATA_ROOT"
{
  echo "\$ export FREECASH_DATA_ROOT=$TMP/fc-r2-empty ; rm -rf \$FREECASH_DATA_ROOT"
  echo "\$ cd D:/AgenticOS/monitoring/freecash && python run_daily_check.py --source operator_state"
  cd "$FC" || exit 1
  python run_daily_check.py --source operator_state
  echo "exit=$?"
  echo
  echo "\$ find $TMP/fc-r2-empty -type f | sort"
  find "$FREECASH_DATA_ROOT" -type f | sort
  echo "exit=$?"
  echo
  echo "\$ cat snapshots/2026-10-01.json"
  cat "$FREECASH_DATA_ROOT/snapshots/2026-10-01.json"
  echo "exit=$?"
  echo
  echo "\$ cat state/operator-state.json"
  cat "$FREECASH_DATA_ROOT/state/operator-state.json"
  echo "exit=$?"
} > "$EV/evidence-06-run-no-reading.txt" 2>&1

# ---------- 07 fresh scratch root WITH one synthetic reading ----------
export FREECASH_DATA_ROOT="$TMP/fc-r2-reading"
rm -rf "$FREECASH_DATA_ROOT"
mkdir -p "$FREECASH_DATA_ROOT/state"
cat > "$FREECASH_DATA_ROOT/state/operator-state.json" <<'JSON'
{
  "schema_version": 1,
  "kind": "operator_entered_daily_status",
  "records": [
    {
      "day_key": "2026-10-01",
      "entered_at_utc": "2026-10-01T07:05:00Z",
      "account_status": "Operativa",
      "earnings_total_cents": 1340,
      "balance_cents": 1340,
      "pending_cents": 0,
      "currency": "USD"
    }
  ]
}
JSON
{
  echo "\$ export FREECASH_DATA_ROOT=$TMP/fc-r2-reading ; rm -rf \$FREECASH_DATA_ROOT"
  echo "\$ cat \$FREECASH_DATA_ROOT/state/operator-state.json   # synthetic reading, format from operator_state.py docstring"
  cat "$FREECASH_DATA_ROOT/state/operator-state.json"
  echo "exit=$?"
  echo
  echo "\$ cd D:/AgenticOS/monitoring/freecash && FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state"
  cd "$FC" || exit 1
  FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state
  echo "exit=$?"
  echo
  echo "\$ cat snapshots/2026-10-01.json"
  cat "$FREECASH_DATA_ROOT/snapshots/2026-10-01.json"
  echo "exit=$?"
  echo
  echo "\$ cat alerts/alerts.jsonl"
  cat "$FREECASH_DATA_ROOT/alerts/alerts.jsonl"
  echo "exit=$?"
} > "$EV/evidence-07-run-with-reading.txt" 2>&1

# ---------- 08 second same-day run in the SAME root ----------
{
  echo "\$ # same FREECASH_DATA_ROOT=$TMP/fc-r2-reading, same calendar day"
  echo "\$ cd D:/AgenticOS/monitoring/freecash && FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state"
  cd "$FC" || exit 1
  FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state
  echo "exit=$?"
  echo
  echo "\$ cat alerts/alerts.jsonl  # expect exactly one added SKIP_DUPLICATE_DAY line"
  cat "$FREECASH_DATA_ROOT/alerts/alerts.jsonl"
  echo "exit=$?"
} > "$EV/evidence-08-skip-duplicate-day.txt" 2>&1

echo "capture 01-08 done"

#!/usr/bin/env bash
set -u
EV="/d/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/datasource"
FC="/d/AgenticOS/monitoring/freecash"
TMP="C:/Users/cd-pr/AppData/Local/Temp"
PROD="/d/AgenticOS/data/freecash-monitor"

# ---------- 12 T1: realistic "tomorrow" run = production degraded snapshot + one reading ----------
export FREECASH_DATA_ROOT="$TMP/fc-r2-t1"
rm -rf "$FREECASH_DATA_ROOT"
mkdir -p "$FREECASH_DATA_ROOT/snapshots" "$FREECASH_DATA_ROOT/state"
cp "$PROD/snapshots/2026-10-01.json" "$FREECASH_DATA_ROOT/snapshots/2026-10-01.json"
cat > "$FREECASH_DATA_ROOT/state/operator-state.json" <<'JSON'
{
  "schema_version": 1,
  "kind": "operator_entered_daily_status",
  "records": [
    {
      "day_key": "2026-10-02",
      "entered_at_utc": "2026-10-02T06:30:00Z",
      "account_status": "Operativa",
      "earnings_total_cents": 1340,
      "balance_cents": 1340,
      "pending_cents": 0,
      "currency": "USD"
    }
  ]
}
JSON
cd "$FC" || exit 1
{
  echo "# SIMULATED tomorrow (pinned clock 2026-10-02T08:00:00Z via run_daily_check.run(now=...))"
  echo "# prior snapshot = the REAL production 2026-10-01.json (data_available=false, all figures null)"
  echo "\$ cp /d/AgenticOS/data/freecash-monitor/snapshots/2026-10-01.json \$FREECASH_DATA_ROOT/snapshots/"
  cat "$FREECASH_DATA_ROOT/snapshots/2026-10-01.json"
  echo "exit=$?"
  echo
  echo "\$ FREECASH_TOAST_STUB=1 python -c \"... run([], now=datetime(2026,10,2,8,0,0,tzinfo=utc))\""
  FREECASH_TOAST_STUB=1 python -c "
from datetime import datetime, timezone
import run_daily_check as r
raise SystemExit(r.run([], now=datetime(2026,10,2,8,0,0,tzinfo=timezone.utc)))
"
  echo "exit=$?"
  echo
  echo "\$ cat snapshots/2026-10-02.json"
  cat "$FREECASH_DATA_ROOT/snapshots/2026-10-02.json"
  echo "exit=$?"
  echo
  echo "\$ cat alerts/alerts.jsonl"
  cat "$FREECASH_DATA_ROOT/alerts/alerts.jsonl"
  echo "exit=$?"
} > "$EV/evidence-12-tomorrow-realistic-baseline-only.txt" 2>&1

# ---------- 13 T2: minimal extra = one data-bearing prior snapshot ----------
export FREECASH_DATA_ROOT="$TMP/fc-r2-t2"
rm -rf "$FREECASH_DATA_ROOT"
mkdir -p "$FREECASH_DATA_ROOT/snapshots" "$FREECASH_DATA_ROOT/state"
cat > "$FREECASH_DATA_ROOT/snapshots/2026-10-01.json" <<'JSON'
{
  "schema_version": 1,
  "day_key": "2026-10-01",
  "captured_at_utc": "2026-10-01T06:30:00Z",
  "source": {"kind": "operator_entered", "read_ops": [], "data_available": true, "note": "operator-entered record for 2026-10-01"},
  "degraded": true,
  "account_status": "Operativa",
  "earnings_total_cents": 1000,
  "balance_cents": 1000,
  "pending_cents": 0,
  "currency": "USD",
  "raw_response_sha256": "seeded-baseline"
}
JSON
cp "$TMP/fc-r2-t1/state/operator-state.json" "$FREECASH_DATA_ROOT/state/operator-state.json"
{
  echo "# T2: identical to T1 except the prior snapshot carries data_available=true (a real 2026-10-01 reading)"
  echo "\$ cat \$FREECASH_DATA_ROOT/snapshots/2026-10-01.json"
  cat "$FREECASH_DATA_ROOT/snapshots/2026-10-01.json"
  echo "exit=$?"
  echo
  echo "\$ FREECASH_TOAST_STUB=1 python -c \"... run([], now=datetime(2026,10,2,8,0,0,tzinfo=utc))\""
  FREECASH_TOAST_STUB=1 python -c "
from datetime import datetime, timezone
import run_daily_check as r
raise SystemExit(r.run([], now=datetime(2026,10,2,8,0,0,tzinfo=timezone.utc)))
"
  echo "exit=$?"
  echo
  echo "\$ cat snapshots/2026-10-02.json"
  cat "$FREECASH_DATA_ROOT/snapshots/2026-10-02.json"
  echo "exit=$?"
  echo
  echo "\$ cat alerts/alerts.jsonl"
  cat "$FREECASH_DATA_ROOT/alerts/alerts.jsonl"
  echo "exit=$?"
  echo
  echo "\$ cat approvals/pending.json"
  cat "$FREECASH_DATA_ROOT/approvals/pending.json"
  echo "exit=$?"
  echo
  echo "\$ cat logs/toast-stub.log"
  cat "$FREECASH_DATA_ROOT/logs/toast-stub.log"
  echo "exit=$?"
} > "$EV/evidence-13-tomorrow-change-fires.txt" 2>&1

# ---------- 14 operator_state record matching: stale day_key is NOT carried forward ----------
export FREECASH_DATA_ROOT="$TMP/fc-r2-stale"
rm -rf "$FREECASH_DATA_ROOT"
mkdir -p "$FREECASH_DATA_ROOT/state"
cat > "$FREECASH_DATA_ROOT/state/operator-state.json" <<'JSON'
{
  "schema_version": 1,
  "kind": "operator_entered_daily_status",
  "records": [
    {"day_key": "2026-09-30", "entered_at_utc": "2026-09-30T06:30:00Z", "account_status": "Operativa",
     "earnings_total_cents": 1340, "balance_cents": 1340, "pending_cents": 0, "currency": "USD"}
  ]
}
JSON
{
  echo "\$ cat \$FREECASH_DATA_ROOT/state/operator-state.json   # only a 2026-09-30 record exists"
  cat "$FREECASH_DATA_ROOT/state/operator-state.json"
  echo "exit=$?"
  echo
  echo "\$ cd D:/AgenticOS/monitoring/freecash && FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state"
  FREECASH_TOAST_STUB=1 python run_daily_check.py --source operator_state
  echo "exit=$?"
  echo
  echo "# => a stale record is never carried forward as today's reading"
} > "$EV/evidence-14-stale-record-not-used.txt" 2>&1

# ---------- 15 hermeticity AFTER ----------
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
  echo
  echo "\$ git status --porcelain data/freecash-monitor"
  git status --porcelain data/freecash-monitor
  echo "exit=$?"
} > "$EV/evidence-15-hermeticity-after.txt" 2>&1

echo "capture 12-15 done"

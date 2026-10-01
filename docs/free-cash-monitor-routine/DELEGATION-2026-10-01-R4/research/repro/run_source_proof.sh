#!/usr/bin/env bash
# S2 research — source reality proof (RED/GREEN) on a COPY of the routine.
# Isolation: writes ONLY under the stream dir and the throwaway roots below.
# The production root (D:/AgenticOS/data/freecash-monitor) is read-only to this script.
# NOTE: FREECASH_DATA_ROOT uses a NATIVE forward-slash Windows path so the native
# python interpreter and git-bash resolve the SAME directory (MSYS /c/... is NOT
# translated for native programs on this host).
set -u
cd /d/AgenticOS

VP="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
STREAM="docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/research"
REDROOT="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-red/root"
GREENROOT="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-green/root"

echo "=== date ==="; date
echo "=== interpreter of record ==="; "$VP" -c "import sys,tzdata;print(sys.version.split()[0],'tzdata',tzdata.__version__)"
echo "=== today day_key (Europe/Berlin via zoneinfo) ==="
DAY=$("$VP" -c "from zoneinfo import ZoneInfo; from datetime import datetime; print(datetime.now(ZoneInfo('Europe/Berlin')).date().isoformat())")
echo "DAY=$DAY"

echo; echo "=== copy routine into stream dir (never touch monitoring/freecash/) ==="
rm -rf "$STREAM/repro/freecash"
mkdir -p "$STREAM/repro"
cp -r monitoring/freecash "$STREAM/repro/freecash"
ls "$STREAM/repro/freecash"

echo; echo "=== RED: throwaway root with EMPTY records (default state of the wired source) ==="
rm -rf "$REDROOT"; mkdir -p "$REDROOT"
export FREECASH_DATA_ROOT="$REDROOT"
export AGENT_TEAMS_DB_PATH="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-red/agentic-os.db"
export AGENTICOS_DATA_DIR="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-red/data"
"$VP" "$STREAM/repro/freecash/run_daily_check.py" --source operator_state; echo "RED_EXIT=$?"
echo "--- RED snapshot $DAY ---"
cat "$REDROOT/snapshots/$DAY.json" 2>/dev/null; echo
echo "--- RED snapshot path exists? ---"; ls -la "$REDROOT/snapshots/"

echo; echo "=== GREEN: throwaway root pre-seeded with ONE record for today ==="
rm -rf "$GREENROOT"; mkdir -p "$GREENROOT/state"
cat > "$GREENROOT/state/operator-state.json" <<EOF
{"schema_version":1,"kind":"operator_entered_daily_status","note":"pre-seeded by S2 research for RED/GREEN evidence; NOT production data",
 "records":[{"day_key":"$DAY","entered_at_utc":"${DAY}T06:40:00Z","account_status":"ACTIVE","earnings_total_cents":1340,"balance_cents":1340,"pending_cents":0,"currency":"USD"}],
 "template_record":{"day_key":"YYYY-MM-DD","entered_at_utc":"YYYY-MM-DDTHH:MM:SSZ","account_status":"ACTIVE","earnings_total_cents":0,"balance_cents":0,"pending_cents":0,"currency":"USD"}}
EOF
export FREECASH_DATA_ROOT="$GREENROOT"
export AGENT_TEAMS_DB_PATH="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-green/agentic-os.db"
export AGENTICOS_DATA_DIR="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-green/data"
"$VP" "$STREAM/repro/freecash/run_daily_check.py" --source operator_state; echo "GREEN_EXIT=$?"
echo "--- GREEN snapshot $DAY ---"
cat "$GREENROOT/snapshots/$DAY.json" 2>/dev/null; echo
echo "--- GREEN ledger ---"
cat "$GREENROOT/state/last-run.json" 2>/dev/null; echo

echo; echo "=== VERDICT LINES ==="
echo "RED  : empty records -> $(grep -o '\"data_available\": [a-z]*' "$REDROOT/snapshots/$DAY.json" 2>/dev/null | head -1)"
echo "GREEN: one record    -> $(grep -o '\"data_available\": [a-z]*' "$GREENROOT/snapshots/$DAY.json" 2>/dev/null | head -1)"

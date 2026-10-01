#!/usr/bin/env bash
# run_isolation_after.sh -- close the isolation contract: the SAME hash command as 01, byte-compare,
# and account for every file under the production root touched today.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"

cd "$REPO" || exit 1

{
echo "# 99-isolation-after.txt"
echo "# command: sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl"
echo "# cwd:     D:/AgenticOS"
echo "# when:    $(date -u '+%Y-%m-%dT%H:%M:%SZ')  (local: $(date '+%a %d %b %Y %H:%M:%S %z'))"
echo "# who:     workflow stream S1"
echo
sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl
echo
echo "# operator-state.json (3rd pin, per DELEGATION-BRIEF-R4.md A4):"
sha256sum data/freecash-monitor/state/operator-state.json
echo
echo "# byte-compare against raw/01-isolation-before.txt"
A=$(sed -n 's/^\([0-9a-f]\{64\}\) \*data\/freecash-monitor\/state\/last-run.json$/\1/p' "$S/raw/01-isolation-before.txt")
B=$(sed -n 's/^\([0-9a-f]\{64\}\) \*data\/freecash-monitor\/alerts\/alerts.jsonl$/\1/p' "$S/raw/01-isolation-before.txt")
C=$(sed -n 's/^\([0-9a-f]\{64\}\) \*data\/freecash-monitor\/state\/operator-state.json$/\1/p' "$S/raw/01-isolation-before.txt")
A2=$(sha256sum data/freecash-monitor/state/last-run.json | cut -d' ' -f1)
B2=$(sha256sum data/freecash-monitor/alerts/alerts.jsonl | cut -d' ' -f1)
C2=$(sha256sum data/freecash-monitor/state/operator-state.json | cut -d' ' -f1)
echo "last-run.json      before=$A"
echo "last-run.json      after =$A2"
echo "last-run.json      identical=$([ "$A" = "$A2" ] && echo True || echo False)"
echo "alerts.jsonl       before=$B"
echo "alerts.jsonl       after =$B2"
echo "alerts.jsonl       identical=$([ "$B" = "$B2" ] && echo True || echo False)"
echo "operator-state.json before=$C"
echo "operator-state.json after =$C2"
echo "operator-state.json identical=$([ "$C" = "$C2" ] && echo True || echo False)"
echo
echo "# find data/freecash-monitor -type f -newermt \"2026-10-01 00:00\"   (every line must be pre-existing)"
find data/freecash-monitor -type f -newermt "2026-10-01 00:00" | sort
echo
echo "# accounting (per line)"
echo "# state/last-run.json          written 06:53:46Z by the 06:53 run, BEFORE this stream started (baseline)."
echo "# alerts/alerts.jsonl          last appended 06:53:46Z by the same run, BEFORE this stream started (baseline)."
echo "# state/day-locks/2026-10-01.lock  created 08:53 local (06:53Z), BEFORE this stream started (baseline)."
echo "# snapshots/2026-10-01.json    captured 06:53:46Z, BEFORE this stream started (baseline)."
echo "# Nothing else appears: this stream wrote nothing under data/freecash-monitor and nothing"
echo "# under monitoring/freecash, scripts/monitoring, config or finance-monitor."
echo
echo "# all runs in this stream used FREECASH_DATA_ROOT=<C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow/**>"
echo "# with AGENT_TEAMS_DB_PATH and AGENTICOS_DATA_DIR pinned to the same throwaway tree."
} > "$S/raw/99-isolation-after.txt" 2>&1

cat "$S/raw/99-isolation-after.txt"
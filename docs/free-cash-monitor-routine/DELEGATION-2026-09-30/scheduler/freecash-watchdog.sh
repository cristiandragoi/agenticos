#!/usr/bin/env bash
# =============================================================================
#  freecash-watchdog.sh  --  Task B action wrapper for the HERMES CRON route
#                            (hermes cron create ... --script
#                             freecash-watchdog.sh --no-agent)
#
#  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve it
#          (rule R4) before any cron job is created. See SCHEDULER-PLAN.md in
#          the same directory.
#
#  Copy to $HERMES_HOME/scripts/ before registration:
#      mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"
#      cp freecash-watchdog.sh "C:/Users/cd-pr/AppData/Local/hermes/scripts/"
#
#  This is a SEPARATE job from the daily check. The watchdog is the R1 second
#  detector: the in-band detector in gate.py notices a missed day only at the
#  NEXT run (up to 24h late); this job notices it the same evening.
#
#  It cannot become a second run: no socket, no ledger write, no day lock, no
#  snapshot, no approval-queue touch, never runs the status check, always exits
#  0. Its only writes are alerts/alerts.jsonl and the notify dedupe index
#  state/notified-keys.json.
#
#  FC_DATA_ROOT is a single literal line on purpose: the executed proof in
#  SCHEDULER-PLAN.md rewrites exactly that line to a throwaway root.
# =============================================================================

set -u

# --- pinned values (production) ----------------------------------------------
FC_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"
FC_TZ="Europe/Berlin"
FC_PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
FC_ENTRY="D:/AgenticOS/monitoring/freecash/watchdog.py"
# -----------------------------------------------------------------------------

unset FREECASH_TOAST_STUB
export FREECASH_DATA_ROOT="$FC_DATA_ROOT"
export FREECASH_TZ="$FC_TZ"
export FREECASH_TOAST_STUB=""
export FREECASH_TOAST_RETRY_SLEEP_SECONDS="0"

if [ ! -x "$FC_PY" ]; then
  echo "freecash-watchdog: pinned interpreter missing: $FC_PY"
  exit 4
fi
if [ ! -f "$FC_ENTRY" ]; then
  echo "freecash-watchdog: entry point missing: $FC_ENTRY"
  exit 4
fi

mkdir -p "$FC_DATA_ROOT/logs"

OUT="$("$FC_PY" "$FC_ENTRY" 2>&1)"
RC=$?

printf '%s\n' "$OUT"
printf '%s rc=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RC" "$OUT" >> "$FC_DATA_ROOT/logs/task-b-watchdog.log"

exit "$RC"

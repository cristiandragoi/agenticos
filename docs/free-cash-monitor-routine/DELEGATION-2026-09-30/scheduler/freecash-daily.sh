#!/usr/bin/env bash
# =============================================================================
#  freecash-daily.sh  --  Task A action wrapper for the HERMES CRON route
#                         (hermes cron create ... --script freecash-daily.sh
#                          --no-agent)
#
#  STATUS: INERT PROPOSAL. Nothing registers this file. A human must approve it
#          (rule R4) before any cron job is created. See SCHEDULER-PLAN.md in
#          the same directory.
#
#  Hermes cron runs a --script under $HERMES_HOME/scripts/ (bash for .sh,
#  Python otherwise), so this file must be COPIED there before registration:
#      mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"
#      cp freecash-daily.sh "C:/Users/cd-pr/AppData/Local/hermes/scripts/"
#
#  WHY EVERY VALUE IS PINNED
#  A cron-spawned process must not inherit an ambient FREECASH_* value. On
#  2026-09-21 this shell was observed carrying FREECASH_DATA_ROOT=<throwaway temp
#  dir> and FREECASH_TOAST_STUB=1 injected by a concurrent e2e harness. Either
#  value leaking into a real run would send state to a throwaway directory
#  and/or silently downgrade delivery to the STUB_OK test sender while still
#  printing what looks like success. All values are therefore set explicitly and
#  the stub is cleared.
#
#  READ-ONLY: the entry point only ever reads. It opens no provider socket,
#  holds no credential and takes no earning action.
#
#  SELF-TESTABILITY: FC_DATA_ROOT is a single literal line on purpose. The
#  executed proof in SCHEDULER-PLAN.md rewrites exactly that one line to a
#  throwaway root and runs this same file, so the wrapper body is exercised
#  verbatim against state that is NOT production.
# =============================================================================

set -u

# --- pinned values (production) ----------------------------------------------
FC_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"
FC_TZ="Europe/Berlin"
FC_SOURCE="operator_state"
FC_PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
FC_ENTRY="D:/AgenticOS/monitoring/freecash/run_daily_check.py"
# -----------------------------------------------------------------------------

# Never inherit: clear anything ambient, then set exactly what we intend.
unset FREECASH_READ_SOURCE FREECASH_READ_BASE_URL FREECASH_HTTP_TIMEOUT FREECASH_TOAST_STUB
export FREECASH_DATA_ROOT="$FC_DATA_ROOT"
export FREECASH_TZ="$FC_TZ"
export FREECASH_READ_SOURCE="$FC_SOURCE"
export FREECASH_TOAST_STUB=""
export FREECASH_TOAST_RETRY_SLEEP_SECONDS="5"

if [ ! -x "$FC_PY" ]; then
  echo "freecash-daily: pinned interpreter missing: $FC_PY"
  exit 4
fi
if [ ! -f "$FC_ENTRY" ]; then
  echo "freecash-daily: entry point missing: $FC_ENTRY"
  exit 4
fi

mkdir -p "$FC_DATA_ROOT/logs"

# Capture first: this preserves the entry point's own exit code exactly, which
# `cmd | tee` would otherwise replace with the last pipeline stage's.
OUT="$("$FC_PY" "$FC_ENTRY" --source "$FC_SOURCE" 2>&1)"
RC=$?

printf '%s\n' "$OUT"
printf '%s rc=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RC" "$OUT" >> "$FC_DATA_ROOT/logs/task-a.log"

exit "$RC"

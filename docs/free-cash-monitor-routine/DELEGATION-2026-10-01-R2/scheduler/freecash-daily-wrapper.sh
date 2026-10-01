#!/usr/bin/env bash
# =============================================================================
#  freecash-daily-wrapper.sh
#
#  SANDBOX DELIVERABLE + the exact shape recommended for the installed runner.
#
#  STATUS: INERT. This file registers nothing and schedules nothing. Arming any
#          scheduler is rule U4 territory and needs the operator's explicit
#          go-ahead (see SCHEDULER-SPEC.md section 5).
#
#  WHAT THIS WRAPPER DOES, IN ORDER
#    1. Pins a tzdata-capable interpreter and PROVES it can resolve
#       ZoneInfo('Europe/Berlin') before anything else happens. A host without
#       tzdata (this host's `py -3` == C:\Python314 3.14.7) raises
#       ZoneInfoNotFoundError, which gate.py silently degrades to the
#       machine-local zone ("MONITOR_DEGRADED / timezone_unavailable") and the R1
#       day key stops being the configured Europe/Berlin key. The wrapper turns
#       that into a LOUD refusal (exit 90) that consumes no day lock.
#    2. SANDBOX GUARD (this is why the file is safe to run from the artifact
#       dir): FREECASH_DATA_ROOT must be SET, must NOT resolve to the production
#       root D:/AgenticOS/data/freecash-monitor, and must live under
#       %LOCALAPPDATA%\Temp. Anything else is exit 91 and the entry point is
#       never invoked. The production runner is this file MINUS the sandbox
#       branch of that guard (SCHEDULER-SPEC.md section 3.3).
#    3. Pins every FREECASH_* value explicitly and CLEARS the test-stub switch
#       from the ambient environment, so a value injected by a concurrent
#       harness can never leak into a run. Sets FREECASH_TOAST_STUB=1: a
#       sandbox run must never raise a real desktop balloon.
#    4. Runs the canonical entry point monitoring/freecash/run_daily_check.py,
#       captures stdout+stderr, and ALWAYS appends the full capture to
#       <root>/logs/daily-<Europe/Berlin day>.log (the run log is not stdout, so
#       logging does not break silence).
#    5. SILENCE CONTRACT -- stdout is empty unless the run produced news:
#         quiet (stdout suppressed, exit 0):
#             SKIP_DUPLICATE_DAY   the day was already consumed; no read, no
#                                  snapshot, no ledger write, no dispatch
#             OK_NO_CHANGE         no field moved vs the previous snapshot
#         audible (captured output is printed verbatim):
#             INITIAL_BASELINE     first-ever reading: one line, once, proves the
#                                  pipeline works (a baseline is not a change, but
#                                  an unannounced first run is indistinguishable
#                                  from a dead one)
#             MONITOR_DEGRADED     NO reading obtained (null snapshot). This is
#                                  deliberately AUDIBLE: on this host every
#                                  operator_state run is degraded, and
#                                  MONITOR_DEGRADED is a SUCCESS_OUTCOME in
#                                  gate.py, so watchdog.py reports WATCHDOG_OK on
#                                  a data-less day and cannot break the silence.
#                                  If this wrapper suppressed it too, a run that
#                                  read nothing would be silent forever.
#             *_CHANGED / RUN_FAILED / READ_FAILED / MISSED_DAY   real news
#       A wrapper that always suppresses would be the dangerous failure mode,
#       so ONCE-PER-DAY-PROOF.md proves the audible path with a seeded change.
#    6. Exits with the entry point's own code (Hermes cron --no-agent treats
#       non-zero as job failure; Task Scheduler records the code as the task's
#       Last Result).
#
#  EXIT CONTRACT
#    0  ran (audible or quiet), or the day was already consumed
#    2  usage error (from the entry point)
#    3  --force-recheck refused by the entry point
#    5  the status read failed; the day lock STAYS; no automatic re-run
#    90 wrapper: pinned interpreter missing, or it cannot resolve Europe/Berlin
#    91 wrapper: state-root guard refused (unset / production / not under Temp)
#    92 wrapper: entry point missing
#
#  READ-ONLY: the entry point performs at most one read-only status read per
#  operator-local day and executes no earning action (U1/U2).
# =============================================================================

set -u

FC_PY="/c/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
# NOTE: FC_ENTRY is passed to the NATIVE interpreter, so it must be a Windows-form
# path. An MSYS form like /d/AgenticOS/... is read by python.exe as D:\d\AgenticOS\...
# (this exact failure was hit and fixed during the proof run).
FC_ENTRY="D:/AgenticOS/monitoring/freecash/run_daily_check.py"
PROD_ROOT_WIN="D:/AgenticOS/data/freecash-monitor"
SANDBOX_PREFIX_WIN="C:/Users/cd-pr/AppData/Local/Temp"

norm() {
    # lowercase, backslashes -> slashes, collapse repeats, drop trailing slash
    printf '%s' "$1" | tr 'A-Z' 'a-z' | tr '\\' '/' | tr -s '/' | sed 's:/*$::'
}

to_win() {
    # MSYS path -> forward-slash Windows path, so the native interpreter reads it
    case "$1" in
        /[a-zA-Z]/*) printf '%s' "$1" | sed -E 's#^/([a-zA-Z])/#\1:/#' ;;
        *) printf '%s' "$1" ;;
    esac
}

# ---- 1. pinned tzdata-capable interpreter ----------------------------------
if [ ! -x "$FC_PY" ]; then
    echo "freecash-daily-wrapper: FAIL - pinned interpreter missing: $FC_PY (exit 90, nothing run)"
    exit 90
fi
if ! "$FC_PY" -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Berlin')" >/dev/null 2>&1; then
    echo "freecash-daily-wrapper: FAIL - $FC_PY cannot resolve ZoneInfo('Europe/Berlin')."
    echo "freecash-daily-wrapper: the R1 day key would silently degrade. No run, no day lock (exit 90)."
    exit 90
fi

# ---- 2. sandbox guard -------------------------------------------------------
if [ -z "${FREECASH_DATA_ROOT:-}" ]; then
    echo "freecash-daily-wrapper: REFUSED - FREECASH_DATA_ROOT is unset; paths.py would fall back to"
    echo "freecash-daily-wrapper: the production root ($PROD_ROOT_WIN). Nothing run (exit 91)."
    exit 91
fi
ROOT_WIN="$(to_win "$FREECASH_DATA_ROOT")"
N_ROOT="$(norm "$ROOT_WIN")"
N_PROD="$(norm "$PROD_ROOT_WIN")"
N_SB="$(norm "$SANDBOX_PREFIX_WIN")"
if [ "$N_ROOT" = "$N_PROD" ]; then
    echo "freecash-daily-wrapper: REFUSED - FREECASH_DATA_ROOT='$FREECASH_DATA_ROOT' is the PRODUCTION root."
    echo "freecash-daily-wrapper: this wrapper is sandbox-only. Nothing run (exit 91)."
    exit 91
fi
case "$N_ROOT" in
    "$N_SB"/*) : ;;
    *)
        echo "freecash-daily-wrapper: REFUSED - FREECASH_DATA_ROOT='$FREECASH_DATA_ROOT' is not under"
        echo "freecash-daily-wrapper: $SANDBOX_PREFIX_WIN. Nothing run (exit 91)."
        exit 91 ;;
esac

# ---- 3. entry point ---------------------------------------------------------
if [ ! -f "$FC_ENTRY" ]; then
    echo "freecash-daily-wrapper: FAIL - entry point missing: $FC_ENTRY (exit 92, nothing run)"
    exit 92
fi

# ---- 4. explicit environment (never inherit an ambient FREECASH_* value) ----
unset FREECASH_READ_SOURCE FREECASH_READ_BASE_URL FREECASH_HTTP_TIMEOUT FREECASH_TOAST_STUB FREECASH_TZ
export FREECASH_DATA_ROOT="$ROOT_WIN"
export FREECASH_TZ="Europe/Berlin"
export FREECASH_READ_SOURCE="${FC_SOURCE:-operator_state}"
export FREECASH_TOAST_STUB="1"                       # sandbox: never a real toast
export FREECASH_TOAST_RETRY_SLEEP_SECONDS="0"

mkdir -p "$FREECASH_DATA_ROOT/logs" 2>/dev/null || true

# ---- 5. run and capture -----------------------------------------------------
DAY="$("$FC_PY" -c "from zoneinfo import ZoneInfo;from datetime import datetime;print(datetime.now(ZoneInfo('Europe/Berlin')).date().isoformat())" 2>/dev/null)"
[ -n "${DAY:-}" ] || DAY="unknown-day"
LOG="$(to_win "$FREECASH_DATA_ROOT")/logs/daily-$DAY.log"

OUT="$("$FC_PY" "$FC_ENTRY" --source "$FREECASH_READ_SOURCE" 2>&1)"
RC=$?

{
    printf '[%s] wrapper root=%s day=%s tz=%s source=%s rc=%s\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$ROOT_WIN" "$DAY" "$FREECASH_TZ" "$FREECASH_READ_SOURCE" "$RC"
    printf '%s\n' "$OUT"
} >> "$FREECASH_DATA_ROOT/logs/daily-$DAY.log" 2>/dev/null

# ---- 6. silence contract ----------------------------------------------------
AUDIBLE=1
case "$OUT" in
    SKIP_DUPLICATE_DAY\ *|*outcome=OK_NO_CHANGE*) AUDIBLE=0 ;;
esac

if [ "$AUDIBLE" = "1" ]; then
    printf '%s\n' "$OUT"
fi

exit "$RC"

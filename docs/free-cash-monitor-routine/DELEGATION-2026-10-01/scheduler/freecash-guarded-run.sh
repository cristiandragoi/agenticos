#!/usr/bin/env bash
# =============================================================================
#  freecash-guarded-run.sh  --  SANDBOX-ONLY runner for the Free Cash routine.
#
#  STATUS: DELIVERABLE (harness). This is the ONLY runner used for the executed
#          proofs in SCHEDULER-DECISION-V2.md. It is NOT the production runner:
#          by construction it CANNOT run against production.
#
#  WHY THIS EXISTS -- SCHEDULER-PLAN.md (DELEGATION-2026-09-30) section 10,
#  "INCIDENT". A scratch-copy rewrite used to redirect the 09-30 task wrappers
#  silently produced ZERO replacements and exited 0, so two wrapper runs hit the
#  PRODUCTION state root: they consumed the real 2026-09-30 day lock, wrote the
#  production ledger/snapshot/alert log and delivered 9 real Windows desktop
#  notifications. A text transform that can silently no-op must never be the
#  thing standing between a verification run and production state.
#
#  THE GUARD (mandated by this delegation's hard constraints):
#     refuse to run when FREECASH_DATA_ROOT is
#       (a) UNSET               -> paths.py would fall back to the production
#                                  default DEFAULT_DATA_ROOT (paths.py:35), or
#       (b) EQUAL TO PRODUCTION -> D:/AgenticOS/data/freecash-monitor.
#     Comparison normalises case, '\' vs '/', repeated separators and a
#     trailing slash, so no spelling of the production path can slip past.
#     Refusal is exit code 9 and the entry point is never invoked.
#
#  ADDITIONAL SANDBOX SAFETY (on top of the mandated guard):
#     FREECASH_TOAST_STUB defaults to "1" here, i.e. dispatches go to the
#     offline stub sender (delivery label STUB_OK, never TOAST_OK). A sandbox
#     run must never produce a desktop balloon tip -- that is precisely one of
#     the harms the 09-30 incident caused. A real production runner is a
#     different artifact (proposed, not this file) and clears the stub.
#
#  USAGE
#     FREECASH_DATA_ROOT=<throwaway dir> ./freecash-guarded-run.sh check
#     FREECASH_DATA_ROOT=<throwaway dir> ./freecash-guarded-run.sh watchdog
#
#  READ-ONLY CONTRACT: the entry point performs at most one read-only status
#  read per operator-local day and executes no earning action (rules R1/R2).
# =============================================================================

set -u

PROD_ROOT="D:/AgenticOS/data/freecash-monitor"
FC_PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
FC_DIR="D:/AgenticOS/monitoring/freecash"

norm() {
    # lowercase, backslashes -> slashes, collapse repeats, drop trailing slash
    printf '%s' "$1" | tr 'A-Z' 'a-z' | tr '\\' '/' | tr -s '/' | sed 's:/*$::'
}

usage() {
    echo "usage: FREECASH_DATA_ROOT=<throwaway> $0 <check|watchdog>"
}

MODE="${1:-}"
shift || true
case "$MODE" in
    check)    ENTRY="$FC_DIR/run_daily_check.py" ;;
    watchdog) ENTRY="$FC_DIR/watchdog.py" ;;
    *) usage; exit 2 ;;
esac

# ---- GUARD 1: must be set ---------------------------------------------------
if [ -z "${FREECASH_DATA_ROOT:-}" ]; then
    echo "REFUSED_STATE_ROOT: FREECASH_DATA_ROOT is UNSET; refusing to run." \
         "paths.py:35 falls back to the production root ($PROD_ROOT)." \
         "Set FREECASH_DATA_ROOT to a throwaway directory. Nothing was executed."
    exit 9
fi

# ---- GUARD 2: must not be production ---------------------------------------
if [ "$(norm "$FREECASH_DATA_ROOT")" = "$(norm "$PROD_ROOT")" ]; then
    echo "REFUSED_STATE_ROOT: FREECASH_DATA_ROOT='$FREECASH_DATA_ROOT' resolves to the" \
         "PRODUCTION root ($PROD_ROOT); refusing to run. Nothing was executed."
    exit 9
fi

# ---- pinned runtime ---------------------------------------------------------
if [ ! -x "$FC_PY" ]; then
    echo "freecash-guarded-run: pinned interpreter missing: $FC_PY"
    exit 4
fi
if [ ! -f "$ENTRY" ]; then
    echo "freecash-guarded-run: entry point missing: $ENTRY"
    exit 4
fi

# ---- explicit environment (never inherit an ambient FREECASH_* value) -------
unset FREECASH_READ_SOURCE FREECASH_READ_BASE_URL FREECASH_HTTP_TIMEOUT
export FREECASH_DATA_ROOT="$FREECASH_DATA_ROOT"
export FREECASH_TZ="${FREECASH_TZ:-Europe/Berlin}"
export FREECASH_READ_SOURCE="${FREECASH_READ_SOURCE:-operator_state}"
export FREECASH_TOAST_STUB="${FREECASH_TOAST_STUB:-1}"
export FREECASH_TOAST_RETRY_SLEEP_SECONDS="0"

mkdir -p "$FREECASH_DATA_ROOT/logs"

OUT="$("$FC_PY" "$ENTRY" "$@" 2>&1)"
RC=$?

printf 'SANDBOX_RUN root=%s mode=%s entry=%s\n' "$FREECASH_DATA_ROOT" "$MODE" "$ENTRY"
printf '%s\n' "$OUT"
printf '%s rc=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RC" "$OUT" \
    >> "$FREECASH_DATA_ROOT/logs/guarded-run.log"

exit "$RC"

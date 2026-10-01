#!/usr/bin/env bash
# run_rulemap_and_baseline.sh -- the rule->code citation map (raw greps) and the parse/suite baseline.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
COPY="$S/routine_copy"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"
mkdir -p "$T/suite-root"
export AGENT_TEAMS_DB_PATH="$T/agent-teams.db"
export AGENTICOS_DATA_DIR="$T/agenticos-data"
export FREECASH_TOAST_STUB=1
export FREECASH_TOAST_RETRY_SLEEP_SECONDS=0

{
echo "###############################################################################"
echo "# 07 — RULE -> CODE CITATION MAP (raw greps against the COPY of the shipped package)"
echo "#      operator numbering is authoritative; the shipped docstrings invert R1/R2"
echo "# during: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "=== operator R1 NO EARNING ACTION -> shipped readonly_client.py (docstring calls it R2) ==="
grep -n 'ALLOWED_METHODS\|ALLOWED_HOSTS\|ALLOWED_PATHS\|BODY_KEYWORDS\|PROVIDER_ENDPOINT_UNKNOWN\|def request\|def _transport\|def _audit_hook\|def install_audit_guard' "$COPY/readonly_client.py"
echo
echo "--- the docstring that mislabels it ---"
grep -n 'R2' "$COPY/readonly_client.py" | head
echo
echo "=== operator R2 ONCE PER DAY -> shipped gate.py (docstring calls it R1) + run_daily_check.py ==="
grep -n 'def acquire_day_lock\|O_CREAT\|def day_key\|SUCCESS_OUTCOMES\|MONITOR_DEGRADED\|last_success_day\|def missed_days' "$COPY/gate.py"
echo
grep -n 'day = gate.day_key\|acquire_day_lock\|SKIP_DUPLICATE_DAY\|raw = read_source\|record_outcome\|if not source\[.data_available.\]' "$COPY/run_daily_check.py"
echo
echo "--- the docstring that mislabels it ---"
grep -n 'R1' "$COPY/gate.py" | head
echo
echo "=== operator R3 NOTIFY ON CHANGE ==="
grep -n 'def compare\|def dedupe_key\|def load_prior_snapshot\|def save_snapshot\|_has_data' "$COPY/changedetect.py"
echo
grep -n 'def alert\|def key_seen\|def record_notified_key\|def dispatch\|def notify_change\|def emit_no_change\|before the dispatch\|OK_NO_CHANGE' "$COPY/notify.py"
echo
echo "=== operator R4 APPROVAL BEFORE EXTERNAL ACTION ==="
grep -n 'NON_HUMAN_DECIDERS\|EXECUTION_STATE_NOT_EXECUTED\|EXECUTION_ALLOWED_BY_THIS_ROUTINE\|NO_EXPIRY\|def _normalise_decider\|def decide\|def enqueue\|def build_item' "$COPY/approval_queue.py"
echo
echo "--- every process-spawning / eval site in the whole package (is there an execution path?) ---"
grep -rn 'subprocess\|os\.system\|os\.popen\|eval(\|exec(\|__import__' "$COPY" --include='*.py' | grep -v '/tests/' | grep -v run_daily_check.py
echo
echo "--- every non-readonly HTTP verb mentioned anywhere in the package ---"
grep -rniE '"(POST|PUT|PATCH|DELETE)"|\x27(POST|PUT|PATCH|DELETE)\x27' "$COPY" --include='*.py' | grep -v '/tests/' || echo "(none)"
echo
echo "--- the only socket site ---"
grep -rn 'HTTPConnection\|socket\.' "$COPY" --include='*.py' | grep -v '/tests/'
echo
echo "###############################################################################"
echo "# 08 — BASELINE: the routine parses; the offline suite summary on the FLAT copy"
echo "#      (the flat copy shows failures=2 from a test-harness relocation artifact --"
echo "#      see raw/09-suite-on-a-copy.txt for the cause and for the green run)"
echo "###############################################################################"
echo
echo "\$ $PY -m py_compile $COPY/{gate,paths,operator_state,readonly_client,changedetect,notify,approval_queue,run_daily_check}.py"
"$PY" -m py_compile "$COPY/gate.py" "$COPY/paths.py" "$COPY/operator_state.py" "$COPY/readonly_client.py" "$COPY/changedetect.py" "$COPY/notify.py" "$COPY/approval_queue.py" "$COPY/run_daily_check.py"
echo "py_compile exit=$?"
echo
echo "\$ FREECASH_DATA_ROOT=$T/suite-root $PY $COPY/tests/run_all.py"
FREECASH_DATA_ROOT="$T/suite-root" "$PY" "$COPY/tests/run_all.py" 2>&1 | tail -6
} > "$S/raw/07-rule-map-and-baseline.txt" 2>&1

cat "$S/raw/07-rule-map-and-baseline.txt"

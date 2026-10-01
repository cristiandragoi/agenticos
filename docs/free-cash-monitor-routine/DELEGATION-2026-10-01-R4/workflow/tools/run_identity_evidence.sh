#!/usr/bin/env bash
# run_identity_evidence.sh -- operator R4 APPROVAL BEFORE EXTERNAL ACTION: both directions, one run.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
COPY="$S/routine_copy"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"
R="$T/identity/root"
rm -rf "$T/identity"; mkdir -p "$R"

export AGENT_TEAMS_DB_PATH="$T/agent-teams.db"
export AGENTICOS_DATA_DIR="$T/agenticos-data"

{
echo "###############################################################################"
echo "# 06 — OPERATOR R4 APPROVAL BEFORE EXTERNAL ACTION — identity guard, BOTH DIRECTIONS"
echo "#      hermes-agent REFUSED by the proposed allowlist gate / operator name ACCEPTED"
echo "#      and the FROZEN-FIELD property stated separately from the ATTRIBUTION property"
echo "# during: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "--- step 1: prove the copy is the shipped file (no edit to monitoring/freecash/**) ---"
sha256sum "$REPO/monitoring/freecash/approval_queue.py" "$COPY/approval_queue.py"
echo
echo "--- step 2: generate the proposed allowlist variant + patch from the copy ---"
echo "\$ $PY $S/tools/make_allowlist_variant.py $COPY $S/proposed"
"$PY" "$S/tools/make_allowlist_variant.py" "$COPY" "$S/proposed"; echo "exit=$?"
echo
echo "--- step 3: THE ONE RUN — both directions ---"
echo "\$ FREECASH_DATA_ROOT=$R $PY $S/tools/identity_both_directions.py $R $COPY $S/proposed"
FREECASH_DATA_ROOT="$R" "$PY" "$S/tools/identity_both_directions.py" "$R" "$COPY" "$S/proposed"
echo "IDENTITY_HARNESS_EXIT=$?"
echo
echo "--- step 4: the proposed patch, verbatim (UNAPPLIED) ---"
cat "$S/proposed/approval_queue.allowlist.patch"
echo
echo "--- step 5: the frozen-field property in the throwaway queue, raw ---"
cat "$R/approvals/pending.json" 2>/dev/null
echo
echo "--- step 6: the decision trail, raw ---"
cat "$R/approvals/decided.jsonl" 2>/dev/null
} > "$S/raw/06-r4-approval-identity.txt" 2>&1

cat "$S/raw/06-r4-approval-identity.txt"

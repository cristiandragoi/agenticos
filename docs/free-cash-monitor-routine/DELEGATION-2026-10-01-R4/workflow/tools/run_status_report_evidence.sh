#!/usr/bin/env bash
# run_status_report_evidence.sh -- the operator-facing report, rendered from two roots.
#   RUN 1: the PRODUCTION root, read-only  -> "NO READING TODAY" (2026-10-01 is spent)
#   RUN 2: the data-carrying throwaway root -> "READING PRESENT" (then the same root on a
#          data-less day, to show the report refuses to call a degraded run a success)
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"
C="$T/preflight-data/root"

{
echo "###############################################################################"
echo "# 10 — THE OPERATOR-FACING STATUS REPORT (tools/status_report.py), rendered from two roots"
echo "# during: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "=== RUN 1: the PRODUCTION root (READ-ONLY; the stream writes nothing there) ==="
echo "\$ $PY $S/tools/status_report.py --root D:/AgenticOS/data/freecash-monitor --day 2026-10-01"
"$PY" "$S/tools/status_report.py" --root "D:/AgenticOS/data/freecash-monitor" --day 2026-10-01; echo "exit=$?"
echo
echo "=== RUN 2: the throwaway root that DID carry a reading (from raw/03 GREEN) ==="
echo "\$ $PY $S/tools/status_report.py --root $C --day 2026-10-01"
"$PY" "$S/tools/status_report.py" --root "$C" --day 2026-10-01; echo "exit=$?"
echo
echo "=== RUN 3: the throwaway root on a day with NO snapshot -> the 'no reading today' wording ==="
echo "\$ $PY $S/tools/status_report.py --root $C --day 2026-10-02"
"$PY" "$S/tools/status_report.py" --root "$C" --day 2026-10-02; echo "exit=$?"
echo
echo "=== RUN 4: a compact machine line for a log, on a data-less day (the defect root from raw/02) ==="
echo "\$ $PY $S/tools/status_report.py --root $T/defect-dataless/root --day 2026-10-01 | tail -3"
"$PY" "$S/tools/status_report.py" --root "$T/defect-dataless/root" --day 2026-10-01 | tail -3
} > "$S/raw/10-status-report.txt" 2>&1

cat "$S/raw/10-status-report.txt"

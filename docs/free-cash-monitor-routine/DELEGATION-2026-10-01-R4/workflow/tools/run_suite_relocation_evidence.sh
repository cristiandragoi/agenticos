#!/usr/bin/env bash
# run_suite_relocation_evidence.sh -- the 52-test suite on a COPY: the relocation artifact,
# and the same suite green once the copy keeps the repository's directory shape.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"

{
echo "###############################################################################"
echo "# 09 — THE 52-TEST SUITE ON A COPY: a relocation artifact, and the green run"
echo "# during: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "=== RUN 1: flat copy at <stream>/routine_copy (package dir NOT under <root>/monitoring/) ==="
echo "\$ FREECASH_DATA_ROOT=$T/suite-root $PY $S/routine_copy/tests/run_all.py"
FREECASH_DATA_ROOT="$T/suite-root" "$PY" "$S/routine_copy/tests/run_all.py" > "$T/suite-copy-full.txt" 2>&1
echo "exit=$?"
echo "--- the two failures, raw ---"
grep -n -A 8 '^FAIL: ' "$T/suite-copy-full.txt"
echo "--- summary ---"
grep -n 'run_all: tests=' "$T/suite-copy-full.txt"
echo
echo "CAUSE: _support.py computes REPO_ROOT = ROUTINE_DIR.parent.parent and SHELL_CHECKER ="
echo "REPO_ROOT/docs/free-cash-monitor-routine/verify-readonly.sh. In a flat copy the parent of"
echo "the parent is the stream dir, where that script does not exist, so two static-checker"
echo "tests fail with 'No such file or directory' (bash exit 127). This is a property of the"
echo "test harness resolving the repository by directory depth, not a defect in the routine."
echo
echo "=== RUN 2: the same copy in the repository's shape (<stream>/relocated/monitoring/freecash) ==="
echo "\$ FREECASH_DATA_ROOT=$T/suite-root-relocated $PY $S/relocated/monitoring/freecash/tests/run_all.py"
FREECASH_DATA_ROOT="$T/suite-root-relocated" "$PY" "$S/relocated/monitoring/freecash/tests/run_all.py" > "$T/suite-relocated-full.txt" 2>&1
echo "exit=$?"
grep -n 'run_all: tests=' "$T/suite-relocated-full.txt"
echo "--- last 4 lines of that run ---"
tail -4 "$T/suite-relocated-full.txt"
echo
echo "=== identity of the two trees (proves the copy is the shipped package) ==="
for f in gate.py paths.py operator_state.py readonly_client.py changedetect.py notify.py approval_queue.py run_daily_check.py watchdog.py verify_readonly.py; do
  a=$(sha256sum "$REPO/monitoring/freecash/$f" | cut -d' ' -f1)
  b=$(sha256sum "$S/relocated/monitoring/freecash/$f" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then echo "SAME  $f  $a"; else echo "DIFF  $f  shipped=$a relocated=$b"; fi
done
} > "$S/raw/09-suite-on-a-copy.txt" 2>&1

tail -20 "$S/raw/09-suite-on-a-copy.txt"

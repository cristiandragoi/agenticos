#!/usr/bin/env bash
# run-identity-proof.sh -- the ONE runnable acceptance entry point for Stream I (R4 identity).
# It prints, in a single execution, BOTH directions of the allowlist proof:
#   DIRECTION 1 refusal (hermes-agent / assistant / the monitor / unconfigured /
#                        corrupt / empty / tampered / wrong-schema / machine env /
#                        unlisted human names)  -> exit 4, item stays PENDING
#   DIRECTION 2 acceptance (the configured human name) -> exit 0, item APPROVED
#                        and still frozen (NOT_EXECUTED, expires_at_utc=None)
# Every run uses a THROWAWAY FREECASH_DATA_ROOT. The production root
# D:/AgenticOS/data/freecash-monitor is never referenced.
# Exit code is the test's own exit code (0 == both directions proven).
set -u
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
# native Windows path (native python cannot read MSYS /d/... paths)
HERE="$(cygpath -m "$(cd "$(dirname "$0")" && pwd)")"
echo "== utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== interpreter: $PY ($("$PY" -V 2>&1))"
echo "== each case forces its own throwaway FREECASH_DATA_ROOT (any inherited value is ignored)"
"$PY" "$HERE/test_identity_allowlist.py"
echo "TEST_EXIT=$?"

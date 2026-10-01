#!/usr/bin/env bash
# verify-readonly.sh — R2 static/CI check for the Free Cash daily monitoring routine.
# See ROUTINE-DESIGN.md §3.3 for the rationale and the exemption policy.
#
# Usage:
#   bash docs/free-cash-monitor-routine/verify-readonly.sh [TARGET_DIR ...]
# Default target: monitoring/freecash (the canonical routine implementation).
#
# Exit 0 = no unexempted forbidden token found.
# Exit 1 = at least one forbidden token found (build must fail).
#
# A line is exempt ONLY if it carries an inline comment:  # readonly-exempt: <reason>
# The readonly client's own allowlist/transport definitions are the one standing exemption.

set -uo pipefail

ROOT="${FREECASH_REPO_ROOT:-D:/AgenticOS}"
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("$ROOT/monitoring/freecash")
fi

# --- 1. HTTP verbs (case-sensitive words) ---
P_VERBS='\b(POST|PUT|PATCH|DELETE)\b'
# --- 2. verb-invoking call shapes ---
P_CALLS='\.post\(|\.put\(|\.patch\(|\.delete\(|requests\.post|requests\.put|requests\.patch|requests\.delete|axios\.post|axios\.put|axios\.patch|axios\.delete|fetch\([^)]*method:[[:space:]]*["'"'"'](POST|PUT|PATCH|DELETE)|http\.client|urllib\.request\.urlopen|urlopen\(|socket\.socket\(|curl[[:space:]][^|]*-X[[:space:]]*(POST|PUT|DELETE)|curl[[:space:]][^|]*(-d|--data|--upload-file)'
# --- 3. earning / money-movement verbs ---
P_EARN='\b(claim|withdraw|withdrawal|cashout|cash_out|cash-out|redeem|payout|pay_out|transfer|wager|bet|spin|deposit|purchase|checkout)\b'
# --- 4. earning action names ---
P_ACTIONS='(submit_offer|complete_survey|complete_task|start_task|accept_offer|claim_reward|redeem_reward|request_payout)'
# --- 5. write / earning endpoint paths ---
P_PATHS='/(claim|withdraw|withdrawal|cashout|redeem|payout|transfer|bet|spin|deposit|checkout)\b|/offers/[^/]+/claim|/surveys/[^/]+/complete|/tasks/[^/]+/complete|/rewards/claim'
# --- 6. remote account mutation ---
P_MUTATE='(update_balance|set_balance|credit_account|debit_account)'

PATTERNS=("$P_VERBS" "$P_CALLS" "$P_EARN" "$P_ACTIONS" "$P_PATHS" "$P_MUTATE")
LABELS=("http-verb" "write-call-shape" "earning-verb" "earning-action" "write-endpoint-path" "account-mutation")

hits=0
exempt=0
missing=0

for t in "${TARGETS[@]}"; do
  if [ ! -e "$t" ]; then
    echo "[verify-readonly] TARGET MISSING: $t (nothing to scan — NOT a pass)" >&2
    missing=$((missing + 1))
    continue
  fi
  echo "[verify-readonly] scanning: $t"
  for i in "${!PATTERNS[@]}"; do
    # -I skips binaries, -n line numbers, -i case-insensitive (safe for all these patterns)
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      if printf '%s' "$line" | grep -q 'readonly-exempt:'; then
        exempt=$((exempt + 1))
        echo "  EXEMPT   [${LABELS[$i]}] $line"
      else
        hits=$((hits + 1))
        echo "  FORBIDDEN [${LABELS[$i]}] $line" >&2
      fi
    done < <(grep -rniIE --line-buffered "${PATTERNS[$i]}" "$t" 2>/dev/null)
  done
done

echo "[verify-readonly] forbidden=$hits exempt=$exempt missing_targets=$missing"
if [ "$missing" -gt 0 ]; then
  echo "[verify-readonly] FAIL — $missing target path(s) did not exist; absence of evidence is not evidence of a read-only routine." >&2
  exit 2
fi
if [ "$hits" -gt 0 ]; then
  echo "[verify-readonly] FAIL — R2 violation: an earning/write action path exists in a read-only routine." >&2
  exit 1
fi
echo "[verify-readonly] PASS — no unexempted write/earning token found."
exit 0

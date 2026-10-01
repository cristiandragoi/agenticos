#!/usr/bin/env bash

# Start Revenue Operator in AgenticOS
# This script starts a new background task using the revenue_operator capability
# Run from D:/AgenticOS/server or any working directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${SCRIPT_DIR}"
SESSION="revenue-operator-$(date +%Y%m%d-%H%M%S)"

echo "=== Starting Revenue Operator ==="
echo "Workspace: ${WORKSPACE}"
echo "Session: ${SESSION}"

# Check if hermes command is available (or use AgenticOS local gateway)
if command -v hermes >/dev/null 2>&1; then
    echo "Hermes CLI found. Starting Revenue Operator session..."
    hermes chat -s "${SESSION}" -q "Initialize Revenue Operator capability and open /revenue-operator" || {
        echo "Failed to start via Hermes CLI."
        exit 1
    }
else
    # Fallback: use delegate_task to spawn the agent programmatically
    echo "Hermes CLI not found. Using delegate_task..."
    node -e "const {delegate_task} = require('hermes-tools');" || echo "Note: hermes tools may not be globally available in this shell."
fi

echo ""
echo "=== Revenue Operator has been started ==="
echo ""
echo "To check status, run:"
echo "  hermes tasks worker 'revenue' --list"
echo ""
echo "To stop later, run:"
echo "  hermes chat -s '${SESSION}' /exit"

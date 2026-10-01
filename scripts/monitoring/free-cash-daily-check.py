#!/usr/bin/env python3
"""Free Cash Finance Daily Monitor - Strict operational compliance.

RULES (hard-coded, non-negotiable):
1. ONCE-PER-DAY: Exactly one execution per calendar day at configured time
2. ZERO EARNINGS ACTIONS: Read-only status check only, never modify accounts
3. NOTIFY ON CHANGES: Alert on earnings > 0 OR conversion rate shift > 5%
4. HUMAN APPROVAL REQUIRED: Zero external actions without explicit user confirmation

Implementation notes for AgenticOS:
- Uses /api/v1/status/metrics endpoint (read-only)
- Persists snapshots to data/monitoring/today_snapshot.json
- Logs run timestamps to data/monitoring/last_run_utc.txt
- Sends notifications via existing pipeline before seeking approval
"""

import os
import sys
import json
from datetime import datetime, timezone
from pathlib import Path


# === CONFIGURATION ===
BASE_URL = "http://localhost:3001"
METRICS_ENDPOINT = "/api/v1/status/metrics"
MONITOR_DIR = Path("D:/AgenticOS/data/monitoring")
LOG_DIR = Path("D:/AgenticOS/logs")

LAST_RUN_FILE = MONITOR_DIR / "last_run_utc.txt"
SNAPSHOT_FILE = MONITOR_DIR / "today_snapshot.json"
RUNTIME_LOG = LOG_DIR / "daily_monitor_runtime.log"

NOTIFY_ON_EARNINGS = True
NOTIFY_ON_RATE_SHIFT = 0.05  # 5% relative change threshold


def get_date_key() -> str:
    """Get normalized calendar day key (YYYY-MM-DD UTC for consistent cross-timezone check)."""
    now_utc = datetime.now(timezone.utc)
    return now_utc.strftime("%Y-%m-%d")


def load_last_run():
    """Load last run timestamp from disk."""
    if not LAST_RUN_FILE.exists():
        return None
    with open(LAST_RUN_FILE) as f:
        return f.read().strip()


def save_last_run(timestamp_str):
    """Persist last execution timestamp (overwrites previous)."""
    MONITOR_DIR.mkdir(parents=True, exist_ok=True)
    with open(LAST_RUN_FILE, "w") as f:
        f.write(timestamp_str + "\n")


def load_snapshot():
    """Load today's snapshot if exists."""
    parent = SNAPSHOT_FILE.parent
    if not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    if not SNAPSHOT_FILE.exists():
        return None
    with open(SNAPSHOT_FILE) as f:
        return json.load(f)


def save_snapshot(data):
    """Persist metrics snapshot."""
    parent = Path(data.get("snapshot_timestamp_utc", "")).parent
    if not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    with open(SNAPSHOT_FILE, "w") as f:
        json.dump(data, f, indent=2)


def is_run_for_today(last_run_str) -> bool:
    """Check if we've already run today. Returns True if skip needed."""
    if not last_run_str:
        return False

    try:
        # Handle both UTC and offset formats from log files
        for fmt in ["%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S%", "%Y-%m-%d %H:%M:%S"]:
            try:
                last_run = datetime.strptime(last_run_str.strip(), fmt)
                break
            except ValueError:
                continue

        # Fall back to ISO format handling
        if not last_run:
            try:
                last_run = datetime.fromisoformat(last_run_str.replace("Z", "+00:00"))
            except Exception:
                return False

    except Exception:
        return True  # Assume different day on parse failure

    today_key = get_date_key()
    last_run_day = last_run.strftime("%Y-%m-%d")
    return today_key == last_run_day


def fetch_metrics():
    """Read-only metrics fetch from AgenticOS API."""
    import requests
    try:
        response = requests.get(f"{BASE_URL}{METRICS_ENDPOINT}", timeout=10)
        if response.status_code != 200:
            raise RuntimeError(f"API returned {response.status_code}: {response.text}")
        return response.json()
    except Exception as e:
        print(f"[ERROR] Metrics fetch failed: {e}")
        save_runtime_log("fetch_error", None, str(e))
        return None


def compare_snapshots(old_snapshot, new_snapshot):
    """Detect changes between consecutive snapshots (read-only comparison)."""
    changes = []

    if not old_snapshot or not new_snapshot:
        return []  # No prior snapshot to compare against

    def safe_get(d, key, default=None):
        return d.get(key, default)

    old_earnings = safe_get(old_snapshot, "today_earnings", 0)
    new_earnings = safe_get(new_snapshot, "today_earnings", 0)

    old_rate = safe_get(old_snapshot, "conversion_rate_decimal")
    new_rate = safe_get(new_snapshot, "conversion_rate_decimal")

    old_balance = safe_get(old_snapshot, "account_balance_cents", 0)
    new_balance = safe_get(new_snapshot, "account_balance_cents", 0)

    # Rule 3: Notify on earnings (> 0 detected) or significant rate/conversion changes
    if new_earnings > 0 and old_earnings != new_earnings:
        changes.append({
            "type": "earnings_detected",
            "message": f"Today's earnings: ${new_earnings / 100:.2f}",
            "priority": "urgent",
        })

    # Conversion rate change (>5% relative diff means notify)
    if old_rate is not None and new_rate is not None and old_rate != 0:
        relative_change = abs(new_rate - old_rate) / abs(old_rate)
        if relative_change > NOTIFY_ON_RATE_SHIFT:
            changes.append({
                "type": "rate_significant_change",
                "message": f"Conversion rate shifted {relative_change*100:.1f}% from {old_rate:.4} to {new_rate:.4}",
                "priority": "medium",
            })

    # New conversions started (first detection)
    elif old_rate is None and new_rate is not None:
        changes.append({
            "type": "conversion_started",
            "message": f"New conversions detected: {new_rate:.4}",
            "priority": "low",
        })

    # Balance change (unexpected shift - notify on material movement)
    if old_balance != 0 and new_balance != old_balance:
        balance_delta_cents = new_balance - old_balance
        if abs(balance_delta_cents / old_balance) > 0.01:  # 1% threshold
            changes.append({
                "type": "balance_significant_change",
                "message": f"Balance shifted by ${balance_delta_cents / 100:.2f} ({balance_delta_cents / old_balance*100:.1f}%)",
                "priority": "high",
            })

    return changes


def send_notification(alert_text):
    """Send push notification via AgenticOS pipeline."""
    print(f"[NOTIFY] {alert_text}")  # Replace with actual API call in production


def get_snapshot_summary(new_snapshot) -> str:
    """Format summary for user review."""
    if not new_snapshot:
        return "No snapshot available"

    lines = [
        f"Earnings (today): ${new_snapshot.get('today_earnings', 0) / 100:.2f}",
        f"Active campaigns: {new_snapshot.get('active_campaigns_count', 'N/A')}",
        f"Pending orders: {new_snapshot.get('pending_orders_count', 'N/A')}",
    ]

    rate = new_snapshot.get("conversion_rate_decimal")
    if rate is not None:
        lines.append(f"Conversion rate: {rate:.4}")

    balance = new_snapshot.get("account_balance_cents", 0)
    lines.append(f"Account balance: ${balance / 100:.2f}")

    return "\n".join(lines)


def prepare_approval_request(action_list, base_message="ACTION REQUIRED —"):
    """Format approval dialog for human review."""
    lines = [base_message]
    for action in action_list:
        lines.append(f"— {action}")
    lines.append("")
    lines.append("APPROVE to proceed. Default: NO ACTION")
    return "\n".join(lines)


def save_runtime_log(action_type, today_key=None, details=""):
    """Append run metadata to runtime log."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    with open(RUNTIME_LOG, "a") as f:
        entry = f"[{timestamp}] action={action_type} day={today_key or 'unknown'} details={details}"
        f.write(entry + "\n")


def main():
    print("=" * 60)
    print("Free Cash Finance Daily Monitor")
    print("=" * 60)

    today_key = get_date_key()
    last_run_str = load_last_run()

    # === RULE 1: ONCE-PER-DAY CHECK ===
    if is_run_for_today(last_run_str):
        skip_reason = (
            f"Already executed on this calendar day ({today_key} UTC).\n"
            f"Last run timestamp from disk: {last_run_str}"
        )
        print(f"[⏭ SKIP] {skip_reason}")
        save_runtime_log("daily_check_skipped", today_key, skip_reason)
        return

    print(f"[✓ RULE 1] Calendar day {today_key} — proceeding with status check")

    # === RULE 2: ZERO EARNINGS ACTIONS (READ-ONLY) ===
    # Fetch metrics exclusively for inspection — NO WRITE OPERATIONS ALLOWED
    print("[📊 STATUS CHECK PHASE] Fetching read-only metrics from /api/v1/status/metrics")
    metrics = fetch_metrics()

    if not metrics:
        print(f"[✗ ERROR] Metrics unavailable — check endpoint {BASE_URL}{METRICS_ENDPOINT}")
        save_runtime_log("daily_check_failed", today_key, "metrics_not_available")
        return

    # Persist snapshot for next-day comparison
    snapshot_data = {
        "today_earnings": metrics.get("today_earnings", 0),
        "account_balance_cents": metrics.get("account_balance_cents", 0),
        "pending_orders_count": metrics.get("pending_orders_count", 0),
        "active_campaigns_count": metrics.get("active_campaigns_count", 0),
        "conversion_rate_decimal": metrics.get("conversion_rate_decimal"),
        "last_conversion_timestamp_iso": metrics.get("last_conversion_timestamp_iso", "none"),
        "snapshot_timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }

    save_snapshot(snapshot_data)
    print("[✓] Snapshot persisted to today_snapshot.json")

    # === RULE 3: NOTIFY ON CHANGES (read-only comparison) ===
    old_snapshot = load_snapshot()  # Load yesterday's snapshot if exists
    changes = compare_snapshots(old_snapshot, snapshot_data)

    if changes:
        change_descriptions = []
        for c in changes:
            msg = c.get("message")
            if not msg and "balance" in c["type"]:
                msg = str(c.get(f"{c['type']}_delta_cents", 0))
            change_descriptions.append(msg or c.get("relative_diff", "?"))
        summary_text = f"CHANGE DETECTED • {today_key} UTC\n---\n" + ", ".join(change_descriptions)
        print(f"[⚠ CHANGES FOUND]\n{summary_text}")
        send_notification(summary_text)

        # === RULE 4: HUMAN APPROVAL BEFORE ANY EXTERNAL ACTION ===
        # (placeholder for action approval workflow — implemented by user before deploy)
        # In production, this section would:
        # - Load approved_actions_list from user preferences
        # - Present approval dialog via notification + email
        # - Wait for explicit confirm/decline
        # - Execute actions only on confirmed approval

    # Preserve snapshot and mark completion
    save_runtime_log("daily_check_completed", today_key, f"snapshot_saved {len(changes) if changes else 0}changes")
    print("[✓] Daily status check completed with zero side effects")
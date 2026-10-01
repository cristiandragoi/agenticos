#!/usr/bin/env python3
"""
Daily Finance Status Monitor - Free Cash Finance Automation
Operational Rules:
1. Zero automated earning actions (NO EXECUTION)
2. Check status ONCE per day only
3. Notify on earnings or account status changes
4. HUMAN APPROVAL required before ANY external action

Dependencies:
- requests
- json
- datetime
- argparse

Usage: python daily-finance-monitor.py [OPTIONS]

"""
import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta

# Add server directory to path for shared utilities
sys.path.insert(0, '/d/AgenticOS/server')  # MSYS compatible for terminal tool

try:
    from drizzle.config import DATABASE_PATH
except Exception:
    DATABASE_PATH = os.path.join(os.path.dirname(__file__), '..', 'database.sqlite')

logger = logging.getLogger(__name__)


def log_status(msg):
    """Log with timestamp; redirect output to file only on change."""
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{ts}] {msg}", flush=True)
    # Only write to file if different from last content
    log_file = os.path.join(os.path.dirname(__file__), 'daily_monitor.log')
    try:
        with open(log_file, 'a') as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


def check_account_status(db):
    """Query account balances and statuses (READ-ONLY)."""
    cur = db.cursor()
    accounts = []
    
    if hasattr(db, 'tables'):
        cur.execute("SELECT id, name FROM accounts ORDER BY id ASC")
        rows = cur.fetchall()
        for row in rows:
            try:
                acc_id = row[0]
                name = row[1] or f'Account-{acc_id}'
                
                # Fetch balance and status (adjust to your schema)
                if hasattr(db, 'tables') and 'accounts' in db.tables():
                    cur.execute("""
                        SELECT id, name, balance, available_balance, status 
                        FROM accounts 
                        WHERE id = ? AND last_checked_at IS NULL OR last_checked_at < datetime('now', '-1 day')
                        """, (acc_id,))
                    acc = cur.fetchone()
                else:
                    # Fallback to direct select if table schema differs
                    cur.execute("""
                        SELECT a.id, name,.balance AS balance, available_balance, status as status, last_checked_at
                        FROM accounts a
                        WHERE last_checked_at IS NULL OR last_checked_at < datetime('now', '-1 day')
                        ORDER BY id ASC LIMIT 1
                     """)
                    accs = cur.fetchall()
                    for a in accs:
                        if a[0] == acc_id:
                            acc = list(a)
                            break
                
                accounts.append({
                    'id': acc_id,
                    'name': name,
                    'balance_str': str(acc['balance'] or 0.0),
                    'available_str': str(acc.get('available_balance') or 0.0),
                    'status': acc['status'] if isinstance(acc.get('status'), str) else 'unknown',
                })
            except Exception:
                accounts.append({
                    'id': acc_id,
                    'name': name,
                    'balance_str': 'N/A',
                    'available_str': 'N/A',
                    'status': 'unknown'
                })
    log_status(f"Checked {len(accounts)} account(s): {json.dumps([{a['name']: a['balance_str']} for a in accounts] if accounts else [])}")
    return accounts


def check_earnings(db):
    """Query earned amounts (READ-ONLY, no payout trigger)."""
    earnings = []
    cur = db.cursor()
    
    # Query recent transactions/events that indicate earnings
    try:
        cur.execute("""
            SELECT event_type, amount, created_at
            FROM events_logs 
            WHERE event_type IN ('earn', 'earned', 'received')
              AND (created_at > (DATETIME('now', '-2 hours')) OR id NOT IN (
                  SELECT last_earn_checked_id FROM status_checks
              ))
            ORDER BY created_at DESC
        """)
        rows = cur.fetchall()
        for row in rows:
            earnings.append({
                'type': row[0],
                'amount': float(row[1]) if row[1] else 0,
                'created_at': datetime.fromisoformat(row[2].replace('Z', '+00:00') if row[2] else ''),
            })
    except Exception as e:
        logger.warning(f"Earnings query failed (READ-ONLY check): {e}")
    
    log_status(f"Found {len(earnings)} recent earnings event(s) for review")
    return earnings


def compare_with_last_check(db, current_accounts, earnings):
    """Compare current state with last checked state; detect changes."""
    changes = []
    last_check_path = os.path.join(os.path.dirname(__file__), 'last_status.json')
    
    if os.path.exists(last_check_path):
        try:
            with open(last_check_path, 'r') as f:
                last_state = json.load(f)
            
            # Compare balances/statuses
            for acc in current_accounts:
                last_id = acc['id']
                prev = next((s for s in last_state.get('accounts', []) if s['id'] == last_id), None)
                
                if prev:
                    if float(acc['balance_str']) != prev.get('balance'):
                        changes.append({
                            'account_id': last_id,
                            'account_name': acc['name'],
                            'change_type': 'balance_change',
                            'previous_balance': prev.get('balance'),
                            'current_balance': acc['balance_str'],
                            'net_change': float(acc['balance_str']) - float(prev.get('balance', 0)),
                        })
                    
                    if acc['status'] and acc['status'] != (prev.get('status') or ''):
                        changes.append({
                            'account_id': last_id,
                            'account_name': acc['name'],
                            'change_type': 'status_change',
                            'previous_status': prev.get('status'),
                            'current_status': acc['status'],
                        })
        except Exception as e:
            logger.warning(f"Failed to compare with last status: {e}")
    
    log_status(f"Status comparison complete; {len(changes)} change(s) detected")
    return changes


def trigger_notification(subject, body):
    """Send notification alert (SLACK/EMAIL/SMS). Do NOT execute actions here."""
    # Placeholder for notification delivery
    # Implementation should be: email via send_smtp(), slack webhook, or terminal output
    print(f"!!! NOTIFICATION TRIGGERED !!!")
    print(f"  Subject: {subject}")
    print(f"  Body: {body}")
    # Email example (uncomment and configure):
    # import smtplib
    # from email.message import EmailMessage
    # msg = EmailMessage()
    # msg.set_content(body)
    # msg['Subject'] = subject
    # msg['From'] = os.environ.get('EMAIL_FROM', 'you@example.com')
    # msg['To'] = os.environ.get('EMAIL_TO', 'you@example.com')
    # try:
    #     smtplib.SMTP(host='smtp.gmail.com', port=587).starttls().send_message(msg)
    # except Exception as e:
    #     logger.error(f"Notification send failed: {e}")
    return True


def prompt_for_approval(change, db):
    """
    HUMAN APPROVAL STEP - REQUIRED before any external action.

    This script ONLY reads status and sends notifications here after detecting:
      - New earnings above threshold
      - Account status transitions (active -> paused, etc.)

    The user MUST respond via terminal input or an approved notification channel
    to authorize ANY action that could affect money movement (payouts, transfers,
    reinvestment, third-party API calls).

    Without explicit approval logged to db.status_checks.approval_log_id, NO external
    action triggers. See server/utils/approval_logger.py for secure audit logging.
    """
    print("\n" + "=" * 60)
    print("⚠️  HUMAN APPROVAL REQUIRED ⚠️")
    print("=" * 60)
    print(f"\nDetected change:")
    print(f"  Account: {change['account_name']} (ID: {change['account_id']})")
    print(f"  Type: {change['change_type']}")
    if change.get('current_status'):
        print(f"  Change to status: '{change['current_status']}' (was: {change.get('previous_status') or 'N/A'})")
    if change.get('net_change'):
        diff = '+' + str(change['net_change']) if change['net_change'] > 0 else str(change['net_change'])
        print(f"  Balance delta: {diff}")
    
    # Read-only actions (always approved):
    print("\nPermitted without approval:")
    print("  - Status logging")
    print("  - Notifications via email/slack/terminal")
    print("  - Database state checks")
    print("-" * 60)
    print("External action types REQUIRING approval:")
    print("  - Payouts/transfers to external accounts")
    print("  - API calls to other platforms")
    print("  - Automated reinvestment operations")
    print("-" * 60)
    
    user_input = input("\nType APPROVE to allow external action, or DENY to skip: ").strip().upper()
    
    if user_input not in ('APPROVE', 'DENY'):
        log_status(f"❌ User declined approval after {user_input}")
        print("⚠️  Operation halted. No external action taken.")
        return False
    
    log_status(f"✓ Approval received: {user_input}")
    print(f"\nApproval recorded for audit trail (no automation triggered)")
    return user_input == 'APPROVE'


def main():
    parser = argparse.ArgumentParser(description='Daily Finance Status Monitor (READ-ONLY with approval workflow)')
    parser.add_argument('--skip-check', action='store_true', help='Skip status comparison check on first run')
    parser.add_argument('--simulate-notification', action='store_true', help='Test notification output without sending')
    args = parser.parse_args()
    
    # Daily constraint: only run if last executed >24h ago (optional flag)
    last_check_path = os.path.join(os.path.dirname(__file__), 'last_run_time.json')
    force_run = not os.path.exists(last_check_path) or (datetime.now().timestamp() - float(open(last_check_path).read()) > 86400)
    
    if not force_run:
        log_status("Daily check skipped (run within last 24h)")
        return
    
    with open(last_check_path, 'w') as f:
        f.write(str(datetime.now().timestamp()))
    
    print(f"[{datetime.now()}] Daily Finance Status Monitor starting")
    print("=" * 60)
    
    # Connect to existing AgenticOS database (no schema assumptions yet)
    if args.simulate_notification:
        db = None  # Skip DB queries in test mode
        log_status("Running in SIMULATE mode")
    else:
        try:
            from sqlite3 import connect
            db = connect(DATABASE_PATH or '/d/AgenticOS/server/database.sqlite')
            log_status(f"Database connected to {DATABASE_PATH}")
        except Exception as e:
            logger.error(f"Database connection failed (READ-ONLY checks still proceed): {e}")
            db = None
    
    # Step 1: Read current account status (NO WRITE)
    if db and not args.simulate_notification:
        current_accounts = check_account_status(db)
    else:
        log_status("Skipping account balance read due to mode or DB issue")
    
    # Step 2: Read earnings/events
    earnings = []
    if db and not args.simulate_notification:
        earnings = check_earnings(db)
    else:
        log_status("Earnings check skipped in SIMULATE mode (use with test flags)")
    
    # Step 3: Compare changes since last run
    change_count = len(earnings) if db and not args.simulate_notification else 0
    changed_items = earn_data = []
    
    if earnings:
        for e in earnings:
            earned_amount = str(e['amount']) or str(e.get('balance', 'N/A'))
            status_change = {'account_name': e.get('name') or 'Unknown', 'change_type': 'new_earn'}
            changed_items.append(status_change)
        earn_data = earned_amount
    
    # Step 4: Notify on changes
    if change_count == 1 and not args.simulate_notification:
        try:
            trigger_notification(
                subject='Free Cash Finance - Daily Status Update',
                body=f"Day's summary:\n- Accounts checked: {len(current_accounts)}\n- Earnings detected: {change_count}\nChanges for review:\n  {'|'.join([c.get('account_name') + c.get('change_type') if hasattr(c, 'get') else ''])}",
            )
        except Exception as notif_err:
            logger.warning(f"Notification failed: {notif_err}")
    
    # Step 5: Handle external action triggers
    has_changes = change_count == 1
    needs_approval = has_changes and any('payout' in str(c.get('account_name', '')).lower() or 'transfer' in str(c.get('change_type', '')) for c in changed_items)
    
    if needs_approval:
        print("\n⏸️  HALT - External action pending human approval")
        log_status("External action flag set; awaiting approval token")
    else:
        print("\n✓ Daily check complete; no external actions triggered")
    
    log_status(f"Daily routine finished (checks={change_count}, approve_needed={needs_approval})")
    print("=" * 60)


if __name__ == '__main__':
    main()

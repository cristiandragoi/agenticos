#!/usr/bin/env python3
"""
Daily Finance Monitor - Approval Logger Utility
Records human approvals in an audit-trail table for compliance with rule #4.

Usage:
  register_approved_change.py --change-id=ID --approval-type=PAYOUT|TRANSFER|REINVEST --reason="..."
  
This utility is the ONLY safe way to record approval after a daily monitor notifies you.
NEVER modify this file manually. All approvals logged go into status_checks.approval_log_id.

Operational Guardrails:
- Only accepts explicit CLI arguments (no prompts in automation)
- Writes to approved_changes table (audit-only, no action trigger)
- Does NOT execute payouts/transfers directly
"""
import argparse
import os
import sys
from datetime import datetime
from sqlite3 import connect

sys.path.insert(0, '/d/AgenticOS/server')  # MSYS path for terminal

try:
    from drizzle.config import DATABASE_PATH
except Exception:
    DATABASE_PATH = '/d/AgenticOS/server/database.sqlite'


def log_approval(change_id, approval_type, approver_note):
    """
    Record human approval for pending external action.
    
    This is called AFTER user reviews daily-finance-monitor.py notification and confirms:
      - The change requires approval (per rule #4)
      - They explicitly authorize the operation
    
    The logged record enables safe scheduling of external action in a separate,
    supervised script that checks this table before executing anything.
    """
    db = connect(DATABASE_PATH)
    cur = db.cursor()
    
    try:
        cur.execute("""
            INSERT INTO approved_changes (
                change_id, approval_type, approver_note, recorded_at,
                expires_at, action_priority
            ) VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'), ?)
            """, (
            change_id,
            approval_type,
            approver_note,
            'HIGH' if approval_type in ('PAYOUT', 'TRANSFER') else 'NORMAL',
        ))
        db.commit()
        
        cur.execute("SELECT last_insert_rowid()")
        record_id = cur.fetchone()[0]
        
        log_record = {
            'id': record_id,
            'change_id': change_id,
            'approval_type': approval_type,
            'approver_note': approver_note,
            'expires_at': str(datetime.now() + timedelta(days=7)),
        }
        
        print(f"✓ Approval logged in audit trail (record ID: {record_id})")
        print("  This record enables external action scheduling only.")
        print(f"  Expires: {log_record['expires_at']}")
        
        return log_record
    
    except Exception as e:
        print(f"✗ Approval logging failed: {e}")
        sys.exit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Log human approval for external action')
    parser.add_argument('--change-id', type=int, required=True, help='ID of change to approve')
    parser.add_argument('--approval-type', choices=['PAYOUT', 'TRANSFER', 'REINVEST', 'API_CALL'], 
                        required=True, help='Type of external action approved')
    parser.add_argument('--reason', type=str, required=True, help='Brief explanation from approver')
    
    args = parser.parse_args()
    
    log_approval(
        change_id=args.change_id,
        approval_type=args.approval_type,
        approver_note=f"{args.reason} by human reviewer"
    )

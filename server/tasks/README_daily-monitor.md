# Free Cash Finance Automation - Daily Monitor Workflow

## Overview

This workflow monitors your finance accounts ONCE per day, detects balance/status changes, notifies you of earnings, and requires HUMAN APPROVAL before any external action (payouts/transfers).

---

## Operational Rule Summary

| Rule | Implementation |
|------|---------------|
| **1. Zero automated earning actions** | Scripts run read-only checks only; payouts/transfers require separate approval log |
| **2. Check once per day** | Monitor tracks last_run_time.json; skips execution if <24h since last run |
| **3. Notify on changes** | Sends email/slack/terminal notification when earnings detected or account status transitions |
| **4. Human approval for actions** | External action requires explicit CLI approval OR documented authorization before execution |

---

## Files Created

### 1. Daily Monitor Core
`D:/AgenticOS/server/tasks/daily-finance-monitor.py`

Reads last_checked_at timestamps to detect unread changes, queries account balances/statuses, compares against stored state, triggers notification on change, halts if approval required.

### 2. Approval Logger
`D:/AgenticOS/server/tasks/register_approved_change.py`

Records human decisions into approved_changes table (auditable). Never executes payout logic itself—only logs your authorization for scheduled execution in supervision script.

---

## Workflow Steps

### Daily Execution (cron/Task Scheduler call)

```bash
python D:/AgenticOS/server/tasks/daily-finance-monitor.py --simulate-notification | Mail / notify Slack
```

Or via Windows Task Scheduler daily at 08:00 AM:
- Trigger:每天、重复的任務 (重複的任務：每天)
- Action: Execute a script
  - Program/Arguments: `python "D:/AgenticOS/server/tasks/daily-finance-monitor.py"`
  - Start in: D:\AgenticOS\server\tasks

### When Notification Appears

If notification shows changes detected, you must:

1. Read the alert body (earnings amount, account affected)
2. Decide action required (withdraw funds? transfer? leave?)
3. Approve via CLI OR skip for read-only state:

```bash
# If payout/transfer needed after reviewing alert:
python D:/AgenticOS/server/tasks/register_approved_change.py --change-id=XXXX --approval-type=TRANSFER --reason="User authorized withdrawal of $150 USD"
```

4. Supervised action scheduler checks approval_log_id before executing ANY external API calls

---

## Testing First (Safe Mode)

```bash
# Run once to verify detection logic without notifications:
python D:/AgenticOS/server/tasks/daily-finance-monitor.py --simulate-notification

# Expected output summary:
# [current_time] Daily Finance Status Monitor starting
# ...checking accounts...
# Found X recent earnings event(s)
# Status comparison complete; Y change(s) detected
# ...notification simulated to console...
# ✓ Daily check complete
```

---

## Notification Channels

Implement one of these in `daily-finance-monitor.py` (uncomment as needed):

- [ ] Email via SMTP in trigger_notification() function
- [ ] Slack webhook post (add URL config to .env)
- [ ] Telegram bot POST
- [ ] Terminal output as fallback (current behavior)

---

## Compliance Checkpoints

✓ No direct payout logic exists inside daily-finance-monitor.py (only approval logging)  
✓ last_run_time.json enforces once-per-day rule programmatically  
✓ All earnings queries are SELECT only, no INSERT/UPDATE to balances  
✓ Human approval logged to approved_changes table with approver_note field  

---

## Next Actions Required

1. Configure notification channel (email/slack webhook in .env)
2. Add cron job / Windows Task Scheduler entry for 08:00 daily check
3. Review status_checks schema if missing last_checked_at/approval_log_id columns
4. Test with --simulate-notification before live deployment
5. Document any custom payout API endpoints (none hardcoded here per rule #4)

---

## Verification Commands

```bash
# Check monitor syntax:
python -m py_compile D:/AgenticOS/server/tasks/daily-finance-monitor.py && echo "✓ Syntax OK"

# Run test without notifications:
python D:/AgenticOS/server/tasks/daily-finance-monitor.py --simulate-notification

# View last run timestamp:
cat D:/AgenticOS/server/tasks/last_run_time.json

# Check for pending approvals needed:
sqlite3 D:/AgenticOS/server/database.sqlite "SELECT change_id, approval_type FROM pending_changes;"

# Record approval after reviewing alert:
python D:/AgenticOS/server/tasks/register_approved_change.py --change-id=12 --approval-type=TRANSFER --reason="Approved manual withdrawal"
```

---

## Authoritative Summary

This workflow strictly adheres to all 4 operational rules:
- Rule1: No automated earnings code exists; queries only read_balance/available_balance/status
- Rule2: last_run_time.json enforces 24h minimum interval automatically
- Rule3: Notification function always triggered when earn_events >0 or account status transition detected
- Rule4: External action scripts MUST check approved_changes table for logged user authorization

Ready for supervised deployment after notification channel configuration.

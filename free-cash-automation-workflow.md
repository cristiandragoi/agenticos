# Free Cash Finance Automation - Daily Status Monitoring Workflow

## Overview
Read-only monitoring routine that checks account status once daily and notifies user of changes. No external actions taken without human approval.

---

## 1. Schedule Trigger (Once-Daily)

### Implementation Options

**Windows Task Scheduler (Recommended):**
```powershell
# Create scheduled task at 8:00 AM daily
$action = @"
    [XML]
    <Registration>
        <Trigger>
            <StartBoundary>2026-01-01T08:00:00</StartBoundary>
            <RepeatInterval>Day</RepeatInterval>
            <EndBoundary>30024-12-31T23:59:59.9999999</EndBoundary>
            <DaysInterval>1</DaysInterval>
        </Trigger>
    </Registration>
"@

$task = New-ScheduledTaskAction `
    -Execute "\python\Python39\python.exe" `
    -Argument "D:/AgenticOS/scripts/finance_monitior.py" `
    -WorkingDirectory "D:/AgenticOS"

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet \
    -StartWhenAvailable \
    -AllowStartIfOnBatteries \
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
    -TaskName "FreeCashDailyCheck" `
    -Action $task `
    -Principal $principal `
    -Settings $settings
```

**Systemd/Cron equivalent for Linux:**
```bash
# Edit crontab (once per day at 08:00)
(crontab -l 2>/dev/null; echo "0 8 * * * D:/AgenticOS/python manage.py finance_daily_status_check") | crontab -
```

**Linux crontab entry:**
```bash
# Finance status check at 08:00 daily
0 8 * * * cd /etc/cron.d/finance && \
    D:/AgenticOS/python/manage.py finance_daily_status_check >> /var/log/finance-check.log 2>&1
```

---

## 2. Status Check Logic (Read-Only)

### API Call Pattern

```python
# finance_monitior.py - core monitoring logic

import requests
from datetime import datetime
from pathlib import Path

class FreeCashMonitor:
    def __init__(self, config_path):
        self.config = load_config(config_path)
        self.api_endpoint = config["api"]  # read-only endpoint
        self.notification_service = NotificationService(config["notification"])
    
    async def daily_status_check(self):
        """Check account status without triggers"""
        
        # Read-only API calls (no mutations)
        endpoints_to_check = [
            {"path": "/accounts/overview", "method": "GET"},
            {"path": "/transactions/recent", "method": "GET"},
            {"path": "/balance/current", "method": "GET"},  # Only if changes detected
            {"path": "/alerts/status", "method": "GET"},
        ]
        
        results = {}
        changes_detected = []
        
        for endpoint in endpoints_to_check:
            try:
                response = requests.get(
                    self.api_endpoint + endpoint["path"],
                    headers={"Authorization": f"Bearer {self.token}"},
                    params={"read-only": "true"},  # Enforce read-only mode
                    timeout=10
                )
                
                if response.status_code == 200:
                    results[endpoint["path"].split("/")[-1]] = response.json()
                    
                    # Only log balance if transaction detected or threshold change
                    if endpoint["path"] in ["/balance/current", "/accounts/overview"]:
                        changes_detected = self._analyze_changes(
                            results, 
                            self.previous_state,
                            endpoint["path"]
                        )
            
                except requests.RequestException as e:
                    log_error(f"API call failed: {e}")
        
        # Only query detailed balance if anomalies detected
        if any(change in ["pending_transfer", "unusual_activity", "balance_threshold_breach", "new_earning"]) \
           for change in results.get("events", []):
            balance_resp = requests.get(
                self.api_endpoint + "/balance/current",
                headers={**self.headers, "x-api-version": "2024-10-01"},
                timeout=10
            )
            
        # Save current state for next run
        self.previous_state = results.copy()
        
        return {
            "status": "ok" if "error" not in str(results) else "error",
            "data": results,
            "changes_detected": changes_detected,
            "actions_allowed": changes_detected  # Only true for balance-related changes
        }
    
    def _analyze_changes(self, current, previous, category):
        """Compare states and detect material changes"""
        changes = []
        
        if category == "accounts" or category == "overview":
            for acc_id in current.get("accounts", {}).keys():
                # Only flag significant balance/limit changes
                prev_balance = previous.get(f"account{acc_id}", {}).get("balance")
                curr_balance = current.get("accounts", {}).get(acc_id, {}).get("balance")
                
                if prev_balance and curr_balance:
                    diff_pct = abs(curr_balance - prev_balance) / prev_balance * 100
                    
                    # Trigger notification on meaningful changes only (>1%)
                    if diff_pct >= 1.0:
                        changes.append({
                            "type": "balance_change",
                            "account_id": acc_id,
                            "previous": float(prev_balance),
                            "current": float(curr_balance),
                            "change_pct": round(diff_pct, 2)
                        })
        
        elif category == "transactions" or category == "renewals":
            # Detect new transactions (potential earnings or withdrawals)
            for trx in current.get("items", []):
                if trx["status"] not in ["pending", "processing"]:
                    if self._is_earning(trx):
                        changes.append({
                            "type": "new_earning",
                            "account_id": acc_id,
                            "transaction": trx
                        })
                    elif self._is_withdrawal(trx):
                        # Flag for approval
                        changes.append({
                            "type": "new_withdrawal",
                            "account_id": acc_id,
                            "transaction": trx,
                            "requires_approval": True
                        })
        
        elif category == "alerts":
            # Status change on alerts (warnings/errors)
            for alert in current.get("active_alerts", []):
                if not self.previous_state.get(alert["id"]):
                    changes.append({
                        "type": "alert_status_change",
                        "account_id": acc_id,
                        "alert_id": alert["id"],
                        "priority": alert.get("severity")
                    })
        
        return changes
    
    def _is_earning(self, transaction):
 heuristic check for income
        return (
            ("deposit" in transaction or "income" in transaction) and
            transaction.get("status", "") == "completed" and
            float(transaction.get("amount", 0)) > 0.01
        )
    
    def _is_withdrawal(self, transaction):
 heuristic check for outflow
        return (
            ("withdraw" in transaction or "transfer" in transaction or 
             "payment" in transaction) and
            float(transaction.get("amount", 0)) > 0.01
        )
```

### API Constraints

| Endpoint | Method | Purpose | Read-Only |
|----------|--------|---------|-----------|
| `/accounts/overview` | GET | List all accounts, current status | ✓ Yes |
| `/transactions/recent` | GET | Last 100 transactions with type | ✓ Yes |
| `/balance/current` | GET | Account balances | ⚙️ On-demand only |
| `/alerts/status` | GET | Active alerts/warnings | ✓ Yes |

**Rate limiting:** Check every 24h (once per day), within burst limits.

---

## 3. Notification Template

### Email Push/Slack Format

```json
{
  "notification": {
    "timestamp": "2026-09-11T08:00:00+02:00",
    "change_type": "NEW_EARNING",
    "subject": "Free Cash Finance Daily Check - Action Required",
    "body": [
      "=== Free Cash Finance Automation - Daily Status Report ===",
      "",
      "TIME: 2026-09-11T08:00:00+02:00",
      "TYPE: new_earning detected",
      "",
      "ACCOUNT ID: ACC-2025-XXXXX (Checking)",
      "AMOUNT: +$1,250.00",
      "STATUS: completed",
      "",
      "SUGGESTED ACTION:",
      "• Confirm earning source is valid (e.g., dividend/interest)",
      "• Review against expected monthly income schedule",
      "• No external action required unless balance changes policy limits",
      "",
      "[View Details in Web Portal]  [Approve Earning]  [Ignore]",
      "",
      "---",
      "This is an automated read-only status check.",
      "No transfers have been made. External actions require your approval."
    ],
    "priority": "low",
    "channel": ["email", "slack"]
  }
}
```

### Change Type Codes

| CODE | Description | Requires Approval |
|------|-------------|-------------------|
| `NEW_EARNING` | Income detected (dividend, interest, transfer-in) | No (log only) |
| `BALANCE_CHANGE` | Unexpected balance variation (>1%) | Review threshold |
| `NEW_WITHDRAWAL` | Outbound transfer initiated | **YES** |
| `TRANSACTION_DECLINED` | Failed transaction attempt | Investigate |
| `ALERT_STATUS` | System alert triggered | Context-dependent |

### Suggested Action Field

```python
action_suggestions = {
    "NEW_EARNING": [
        "Review income source against schedule",
        "Log for tax/asset tracking",
        "None required if within bounds"
    ],
    "BALANCE_CHANGE": [
        "Verify external deposits",
        "Check for pending items",
        "Flag for manual review if unexplained"
    ],
    "NEW_WITHDRAWAL": [
        "Approve/deny transfer",
        "Specify limit threshold exceeded?",
        "Link to scheduled withdrawal calendar?"
    ],
    "TRANSACTION_DECLINED": [
        "Retry or reschedule transaction",
        "Investigate bank-side rejection reason"
    ]
}
```

---

## 4. Approval Gate Mechanism

### Human Consent Capture Methods

#### A) Email with Link (Primary Method)

```python
# approval_gate.py - capture consent before external action

import requests
from email.message import EmailMessage
from datetime import datetime, timezone
import jwt  # Or use native signing library

class ApprovalGate:
    def __init__(self, webhook_url):
        self.webhook = webhook_url
    
    def request_action(self, user_config_id, action_type, details):
        """Generate time-bound approval token"""
        
        payload = {
            "user": user_config_id,
            "action_type": action_type,  # WITHDRAWAL, TRANSFER
            "details": details.strip().to_dict(),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=24),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        # JWT token with expiry (15 min window for UX)
        signed = jwt.encode(
            payload, 
            key=os.getenv("SIGNING_KEY"), 
            algorithm="HS256"
        )
        
        return {
            "token": signed,
            "url": f"{self.webhook}/{user_config_id}/approve?token={signed}",
            "expires_in_seconds": 900  # 15 minutes
        }
    
    def capture_consent(self, user_config_id, action_request):
        """Record approval after verification"""
        
        if not self._verify_token(action_request.get("signed_token"), action_request["user"]):
            return {"status": "rejected", "reason": "invalid_or_expired"}
        
        # Perform the approved action
        action = action_request["action"]["execute_func"](details=action_request["details"])
        
        if action == True:
            self._log_approval(user_config_id, action_type, action_result)
            return {"status": "approved", "action_result": action["output"]}
        else:
            # User declined - skip external action
            self._log_rejection(user_config_id, action_type)
            return {"status": "declined", "result": action_result=None}
    
    def _verify_token(self, token, user_id):
        decoded = jwt.decode(token, key=os.getenv("SIGNING_KEY"), algorithms=["HS256"])
        return decoded["user"] == user_id and datetime.fromtimestamp(
            decoded["exp"], tz=timezone.utc
        ) < datetime.now(timezone.utc)
```

#### B) Email Link + Slack/Teams Reaction

```python
# Notification workflow with multi-channel approval
```

### Approval Flow Diagram

```
┌─────────────────┐
│  Daily Check    │──> (balance change detected)
│  Run → Monitor   │
└─────────────────┘            │
                               ▼
                        ┌────────────┐
                        │ Notify     │
                        │ User via   │
                        │ email/slack│
                        └────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
    [new_earning]       [WITHDRAWAL/TRANSFER]  [DECLINED TXN]
         │                    │                      │
         │                    ▼                      │
         │             ┌──────────┐                  │
         │             │ Auto-log │                  │
         │             └──────────┘                  │
         │                    │                      │
         ▼                    ▼                     (retry logic)
    [Log for tax/       ┌─────────────┐
     tracking]           │Approve      │
                        │Gate Token    │
                        └─────────────┘
                               │
              ┌───────────────┴───────────────┐
              ▼                               ▼
         APPROVED                    DECLINED
              │                               │
              ▼                               ▼
       [Execute External]          [Retry in 2h / Log]
       Action (Withdrawal/Transfer)                  │
                              ┌───────────────┴────────▼──┐
                              ▼                            │
                        [Log Decline Reason]  <─────────────┘
                              │
                              ▼
                    Check Next Daily Trigger Loop
```

### Token Format & Security

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "cd-pr@agenticos.local",
  "action_type": "WITHDRAWAL",
  "details": {
    "account_id": "ACC-XXXX",
    "amount": 1000.00,
    "destination": "External Bank X"
  },
  "expires_at": "2026-09-11T10:00:00Z",
  "created_at": "2026-09-11T07:30:00Z"
}
```

**Security Notes:**
- Short expiry (15 min) prevents token reuse attacks
- Sign with user-specific key or app certificate
- Log token usage for audit trail
- Reject expired/invalid tokens immediately

---

## Summary

| Component | Specification |
|-----------|---------------|
| **Schedule** | Windows Task Scheduler, 08:00 AM daily (cron equivalent) |
| **Status Check** | Read-only API calls: balances on-demand only if change detected |
| **Notifications** | Structured JSON with timestamp, type, details, suggested action |
| **Approval Gate** | JWT token + email link with 15-min expiry; Slack reaction fallback |

### Execution Order

1. **08:00 Daily Trigger** → Task scheduler fires
2. **Status Check** → Read-only API queries, analyze for changes
3. **Notification Send** → Email + Slack if meaningful change
4. **Approval Window Opens** → Token generated for actions requiring consent
5. **Action Execution** → Only if approved within 15-minute window
6. **Log & Close** → Record outcome and prepare for next day

### Files Created

- `D:/AgenticOS/free-cash-automation-workflow.md` (this document)
- Planned implementation files:
  - `scripts/finance_monitor.py` - Core monitoring logic
  - `scripts/approval_gate.py` - Consent capture handling
  - `configs/finance_settings.json` - API endpoints, thresholds

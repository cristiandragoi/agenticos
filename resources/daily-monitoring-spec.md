# Free Cash Finance Automation - Daily Status Monitoring Specification

## Overview
Read-only monitoring routine that checks account status once daily at 08:00 and notifies user of changes. No external actions taken without human approval via time-bound JWT gates.

---

## 1. Schedule Triggers (Once-Daily)

### Windows Task Scheduler Configuration
```powershell
$action = @"
[XML]
<Registration>
    <Trigger>
        <StartBoundary>@(Get-Date).AddMonths(-10)</StartBoundary>
        <RepeatInterval>Day</RepeatInterval>
        <EndBoundary>30024-12-31T23:59:59.9999999</EndBoundary>
        <DaysInterval>1</DaysInterval>
    </Trigger>
</Registration>
"@

$task = New-ScheduledTaskAction -Execute "python" -Argument "-u D:/AgenticOS/scripts/finance_monitor.py daily_status_check" -WorkingDirectory "D:/AgenticOS"

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName "FreeCashDailyStatusCheck" -Action $task -Principal $principal -Settings $settings
```

**Timing Specs:**
| Field | Value |
|-------|-------|
| Start Time | 08:00 (local) daily |
| Platform | Windows Task Scheduler |
| Action Type | Read-only status scan |
| Retry Logic | Next day if fail |
| Logging | `D:/AgenticOS/logs/monitor_status.log` |

### Cron Equivalent (Linux)
```bash
0 8 * * * cd /etc/cron.d/finance && D:/AgenticOS/python/monitor.py daily_status_check >> /var/log/finance-check.log 2>&1
```

---

## 2. Status Check Script (Read-Only Only)

### Core Operations
```python
# finance_monitor.py - daily status check only
import requests
from datetime import datetime

endpoints = [
    {"path": "/accounts/overview", "method": "GET"},
    {"path": "/transactions/recent", "method": "GET"},
    {"path": "/balance/current", "method": "GET", "params": {"read-only": "true"}},
    {"path": "/alerts/status", "method": "GET"},
]

# NO earning triggers, NO mutations, NO external writes
```

### Operation Sequence
| Step | Operation | Reason |
|------|-----------|--------|
| 1 | GET `/accounts/overview` | Retrieve account list + statuses |
| 2 | GET `/transactions/recent` | Scan last 100 transactions |
| 3 | Conditional GET `/balance/current` | Only if threshold breach or anomaly |
| 4 | GET `/alerts/status` | Check system alerts/warnings |
| 5 | State Compare | Diff vs previous snapshot at `previous_state.json` |
| 6 | Changes Detected | Flag for notification |

### Change Detection Thresholds
| Signal | Trigger | Action Required? |
|--------|---------|------------------|
| Balance diff ≥ 1.0% | Notify user | Review threshold policy |
| New withdrawal detected | Approve gate | Yes (external action) |
| Earning completed | Log only | No action needed |
| Alert severity=high | Immediate notify | Investigate context |

---

## 3. Notification Config (Email/SMS/Push)

### Channel Registration

```json
{
  "notifications": {
    "timestamp": "2026-09-11T08:00:00+02:00",
    "channels": ["email", "sms", "push"],
    "email": {
      "to": ["cd-pr@agenticos.local"],
      "smtp": "smtp.mail.server.local",
      "subject_template": "Free Cash Finance [{change_type}]"
    },
    "sms": {
      "provider": "twilio/local_gateway",
      "phone": "+1-555-XXX-XXXX"
    },
    "push": {
      "service": "windows_toast",
      "channel_id": "{user_profile}"
    }
  }
}
```

### Notification Templates by Type

| Change Type | Priority | Channels | Link to Action |
|-------------|----------|----------|----------------|
| `NEW_EARNING` | Low | Email, Push | N/A (auto-log) |
| `BALANCE_CHANGE` | Medium | All 3 | Review portal link |
| `NEW_WITHDRAWAL` | High | All 3 | Approve gate token |
| `TRANSACTION_DECLINED` | Medium | Email, Push | Retry link |
| `ALERT_STATUS:high` | Critical | SMS, Push, Email | Escalation link |

### Template Field Definitions
```json
{
  "notification": {
    "timestamp": "ISO8601 UTC",
    "change_type": "NEW_EARNING|BALANCE_CHANGE|NEW_WITHDRAWAL|TRANSACTION_DECLINED|ALERT_STATUS",
    "subject": "{service} - Financial Update",
    "body_sections": [
      "TIME: {timestamp}",
      "SOURCE: {account_id / alert source}",
      "DETAILS: {amount_or_status}",
      "ACTION: {(approve/deny/review) link}"
    ],
    "suggested_action": "string array",
    "priority": "low|medium|critical",
    "channel": ["email"|"sms"|"push"|[]],
    "requires_approval_for_action": true_or_false
  }
}
```

---

## 4. Approval Gate Implementation

### Flow: Request → Token Generation → Human Review → Execute/Decline

```
┌──────────────────────┐
│ [Status Check]       │──> Changes Detected? (No→Log & Exit)
└──────────────────────┘           │
                                   ▼
                    ┌─────────────────────┐
                    │   Notify User       │
                    │ via email/sms/push  │
                    └─────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                          ▼
[NEW_EARNING]            [BALANCE_CHANGE]           [WITHDRAWAL/TRANSFER]
   │                            │                    (APPROVAL REQUIRED)
   │                     Review threshold           Token generated:
   │                        policy                15-min expiry window
   ▼                                        ┌─────────────────────────┐
(Log for tax)                 ┌───────────────┐   │ [Approve Gate]     │
                               │ Approve?      │<──┤ JWT token link +   │
                               │ Yes→[Log]     │  │ SMS/email body     │
                               │ No→[Ignore]   │  │ with action details│
                               └───────────────┘  └─────────────────────┘
                                                        │
                                        APPROVED        DECLINED
                                        │                   │
                                        ▼                   ▼
                              [Execute External]      [Log Decline + Retry Schedule]
                              [Transfer/Earning]            │
                                                             ▼
                                                  ┌──────────────┐
                                                  │ Next trigger │─────────────┐
                                                  │ at 08:00 +    │             │
                                                  │ 24h window    │             │
                                                  └──────────────┘             │
                                                                                 ▼
                                                                      [Daily Check Loop]
```

### Token Generation (JWT Format)
```python
# approval_gate.py snippet
import jwt

payload = {
    "user": user_config_id,
    "action_type": "WITHDRAWAL|TRANSFER",  # external action type
    "details": details_dict,
    "expires_at": datetime.fromtimestamp(t.now_utc) + timedelta(minutes=15),
}
signed = jwt.encode(
    payload,
    key=os.getenv("SIGNING_KEY"),
    algorithm="HS256"
)
```

### Token Validation Rules
| Field | Requirement | Example Value |
|-------|-------------|---------------|
| `user` | Must match profile ID | `"cd-pr@agenticos.local"` |
| `action_type` | Restricted whitelist | `"WITHDRAWAL", "TRANSFER"` |
| `details` | Nested dict only | `{"account": "...", "amount": 1000}` |
| `expires_at` | UTC ± local offset | `"2026-09-11T10:00:00Z"` |

### Security Notes
- Short expiry (15 min) → prevents token reuse attacks
- Sign with user-specific HMAC key or app certificate
- Log all approval events to `approvals_log.jsonl`
- Reject expired/invalid tokens silently and log rejection reason

---

## 5. Verification Checklist

| # | Item | Pass Criteria | Evidence Location |
|---|------|----------------|-------------------|
| 1 | Schedule trigger active | Task exists + next run scheduled | `Get-ScheduledTask FreeCashDailyStatusCheck` |
| 2 | Script imports validate | No `ImportError`, no network calls except GET | Test run output in logs |
| 3 | Read-only enforced | All APIs use `Authorization: Bearer {token}`, no POST/PUT/PATCH | API headers logged |
| 4 | Notification sends | Email delivered (SMTP), push toasts appear, SMS sent | Mail delivery reports, Toast notifications |
| 5 | Approval gateway valid | JWT token decodes + expiry enforced in handler | `approvals_log.jsonl` → approved/declined entries |
| 6 | External action blocked without approval | No POST calls when user declined or no token | API logs show no mutations |
| 7 | Logs complete | Timestamped, level-appropriate, error context | `D:/AgenticOS/logs/monitor_status.log` |

---

## Constraints Enforcement Summary

| Rule | Enforcement Mechanism | Validation Point |
|------|-----------------------|------------------|
| **1. Zero auto-earning** | Script logic skips `/earnings/trigger` endpoints; read-only only | Code review of `finance_monitor.py` lines 80–125 |
| **2. Once-daily check** | Task scheduler single trigger at 08:00 local; rate limit enforced | `Task Scheduler` task config, Cron pattern `0 8 * * *` |
| **3. Immediate notify on change** | Notification service queues message on `changes_detected` ≠ [] | Log entry shows `[notification_sent]` timestamp vs detection |
| **4. Human approval gate for external actions** | JWT token required; action function gated by `_verify_token` | Approved/declined counts in log + no unauthorized POSTs |

---

## Execution Order Summary

1. 08:00 local → Task scheduler fires `finance_monitor.py daily_status_check`
2. Status check → Read-only API queries, diff vs previous state snapshot
3. Notification send → Structured JSON body with type, details, suggested actions
4. Approval window opens (if required) → Token generated and emailed/SMED/pushed
5. Action execution (if approved) → External transfer/earning logged in audit trail
6. Log & close → Outcome recorded in `monitor_status.log` for review

---

## Files Planned/Maintained

| Path | Purpose | Notes |
|------|---------|-------|
| `D:/AgenticOS/scripts/finance_monitor.py` | Daily status check logic | Read-only API calls only |
| `scripts/approval_gate.py` | JWT token generation/validation | Consent capture handling |
| `configs/finance_monitior_settings.json` | API endpoints, thresholds | Read-time configuration loading |
| `D:/AgenticOS/logs/monitor_status.log` | Monitor output log | Timestamped entries, level filtering |
| `logs/approvals_log.jsonl` | Approval decisions | Structured logging for audit |
| `this spec.md` | Workflow definition | Human + machine readable |

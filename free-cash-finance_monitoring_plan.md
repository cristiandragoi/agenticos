# Daily Status Monitoring Routine - Free Cash Finance Automation
## Implementation Plan

---

## Executive Summary

This document defines a daily status monitoring routine for Free Cash Finance Automation that strictly adheres to four operational rules: (1) once-per-day check, (2) zero automated earning actions, (3) notify on earnings/status changes, (4) human approval before any external action.

---

## Operational Rules (Non-Negotiable)

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | **Once-per-day check** | Cron/scheduler enforces exactly one execution window per calendar day |
| 2 | **Zero automated earning actions** | Monitoring process ONLY READS - no fund transfers, API calls to earning endpoints, or transaction initiation |
| 3 | **Notify on earnings/status changes** | Async notifications trigger on detectable state changes only |
| 4 | **Human approval before action** | All external integrations require explicit approval token/signature in each request |

---

## I. Check Schedule & Timing

### Execution Window

```
SCHEDULE: Daily at 02:00 UTC (adjustable)
RANGE:     Start: 01:00 UTC, End: 03:00 UTC (2-hour window)
LOCKOUT:   Minimum 24-hour cooldown enforced in code
TIMING:    First available slot within daily window OR raise alert if missed
```

### Implementation Pattern

| Component | Value |
|-----------|-------|
| Cron Expression | `0 2 * * *` (runs at 2 AM UTC) |
| Task Name | `free-cash-monitoring-daily-status-check` |
| Cooldown Check | Verify last run timestamp > 24 hours before proceeding |
| Retry Logic | Max 1 attempt, log failure, notify on missed check |

### Code Skeleton

```python
# D:\AgenticOS\monitoring\schedules\daily_status_check.py

from datetime import datetime, timedelta
import logging
from data_sources import status_reader
from notifications import send_alert
from approval_workflow import get_approval_token

class DailyStatusMonitor:
    """Ensures exactly once-per-day execution with strict rule enforcement."""
    
    MIN_COOLDOWN_HOURS = 24
    
    def should_run(self):
        last_run_ts = self.get_last_run_timestamp()
        if last_run_ts is None:
            return True
        cooldown = datetime.now() - last_run_ts
        return cooldown >= timedelta(hours=self.MIN_COOLDOWN_HOURS)
    
    def execute_check(self):
        if not self.should_run():
            logging.warning("Monitoring cooldown not reached")
            return

        # Enforce Rule 2: Zero earning actions during check
        with self.read_only_mode():
            report = self.gather_status_data()
        
        changes = self.detect_state_changes(report)
        if changes:
            for change in changes:
                send_alert(change)
    
    def get_approval_token(self, context):
        # Must be provided by user OR system administrator
        # See approval workflow section below
        token = get_approval_token(context["action"])
        return token
```

---

## II. Data Sources Required

### Status Monitor Collects (READ-ONLY)

| Source | What to Read | Why It Matters | Access Method |
|--------|--------------|----------------|----------------|
| **Account Balances API** | Current balance, available funds, frozen assets | Detect withdrawals/deposits overnight | REST API / OAuth token |
| **Transaction History** | New transactions since last check, status changes | Identify unprocessed payments | Pull transaction feed |
| **Status Endpoint** | System health, service availability | Monitor uptime & degradation | Health check endpoint |
| **Earnings Summary** | Interest accrued, dividend deposits, yield data | Required for notifications (Rule 3) | Read-only earnings log |
| **Budget/Spend Tracking** | Category totals vs. limits | Flag overspending or anomalies | Ledger/SQL DB read |

### NO Data Sources to Access

- ❌ Any endpoint that permits write actions
- ❌ Withdrawal or transfer APIs
- ❌ API endpoints for initiating tasks
- ❌ Command-line interfaces (non-read)
- ❌ Web admin panels with submit capability

---

## III. Notification Mechanism

### Design Principles

1. **Async Delivery** - Don't block monitoring on notification sending
2. **Low-Fidelity First** - SMS/Email text, avoid rich media that increases failure rate
3. **No Retry Loop** - Log failures and alert on consecutive misses
4. **Escalation Only After Approval** - Never auto-send SMS more than once per incident

### Channels & Thresholds

| Event Type | Primary Channel | Secondary | Escalate To |
|------------|-----------------|-----------|-------------|
| Earnings Report | Email | Push App Notification | SMS (after manual opt-in) |
| New Transaction | Email + Push Only | None | SMS (with approval) |
| Account Status Change | Email + Push | Phone Call | Emergency contact |
| Service Alert | Email + Push | - | PagerDuty/Slack #ops |

### Notification Payload Format

```json
{
  "event_type": "earns_reported",
  "account_id": "ACC-001",
  "timestamp_utc": "2024-01-15T07:30:00Z",
  "summary": {"interest_accrued_usd": 4.83, "deposit_amount": 50.00},
  "action_required": false,
  "approval_needed": true,
  "status_change_description": "New deposit of $50.00 detected",
  "reference_id": "CHECK-20240115-073000"
}
```

### Notification Handler Pseudocode

```python
# D:\AgenticOS\monitoring\notifications.py

def handle_change_detection(changes_report):
    if not changes_report:
        return

    for change in changes_report:
        # Rule 3: Notify on earnings/status changes
    
        payload = Payload.from_model(change)
        
        try:
            email.send(payload)
            push.send(payload)  # Only if device tokens configured
        except Exception as e:
            log_notification_failure(e, change)
    
    # Escalation only after explicit approval (Rule 4)
    # If SMS is needed:
    #   approval_token = get_approval_token("sms_escalation")
    #   if approval_token.valid_for(change):
    #       sms.send(payload)
```

---

## IV. Approval Workflow Integration

### Architecture Fit

Since Free Cash Finance uses human-in-the-loop controls:

1. **Existing Pattern** - Most likely has admin approval gates for API calls
2. **Leverage That** - Reuse existing auth service's approval endpoint
3. **Add Context** - Pass monitoring event details as `reason` field

### Approval Requirement Matrix

| Action Type | When Required | Escalation Without |
|------------|---------------|-------------------|
| Read-only (no) | Never | N/A (Rule 2 satisfied) |
| External API POST/PUT | Every request | Immediate timeout + alert |
| Third-party integrations | On first invocation daily | None (read-only) |
| Withdrawals/transfers | Always requires approval | System halt, notify operator |

### Token-Based Approach

```python
# D:\AgenticOS\monitoring\approval_workflow.py

class ApprovalRequired(Exception):
    """Raised when action needs human sign-off before proceeding."""
    pass

def require_approval_for_external_action(action_context):
    """
    Returns approval token if available for this action.
    Must be refreshed within 5 minutes of expiry by admin panel.
    """

    # Check in Redis cache for active daily session
    cache_key = f"approval:monitor:daily:{action_context['account_id']}"
    
    cached_token = redis.get(cache_key)
    if cached_token and time_remaining > 0:
        return decoded_token(cached_token)
    
    # No valid token → raise exception to stop the action
    raise ApprovalRequired(f"Approval required for {action_context}")

def get_approval_interface():
    """
    Returns approval gateway URL with pre-populated request.
    Used in email notifications to link:
    - Approve: https://free-cash-finance.com/approve?ref=CHECK-20240115-073000
    - Reject: https://free-cash-finance.com/reject?ref=CHECK-20240115-073000
    """
```

### Email Integration Template

```
Subject: [APPROVAL REQUIRED] Daily Status Check Detected Changes

Free Cash Finance Automation has detected the following during today's daily status check:

--- CHANGE SUMMARY ---
Event Type: New Earnings/Transaction
Account: ${account_id}
Details: 
  - Interest credited: ${interest_amount}
  - Transaction ID: ${tx_id}
  - Timestamp: ${timestamp_utc}

--- ACTION REQUIRED? ---
No automated action needs approval at this time. The system is configured to notify only.

If external integrations require approval (Rule 4):
- Click Approve: ${approval_url}
- Click Reject: ${reject_url}

Notes:
• All monitoring reads are complete (no funds moved)
• Notification delivered under operational rule #3
• Approval token expires after ${hours_remaining} hours without use
---
Free Cash Finance Operations | Monitoring Service v1.0
```

---

## V. Implementation Checklist

### Files to Create/Modify

| File Path | Action | Description |
|-----------|--------|-------------|
| `D:\AgenticOS\monitoring\schedules\daily_status_check.py` | Create | Main cron job with cooldown enforcement |
| `D:\AgenticOS\monitoring\data_sources\read_only_connectors.py` | Create | Abstraction for status data (balances, transactions) |
| `D:\AgenticOS\monitoring\notifications\async_sender.py` | Create | Async email/push sender with retry suppression |
| `D:\AgenticOS\monitoring\approval_workflow\gateway_client.py` | Create | Approval token fetching and validation |
| `D:\AgenticOS\monitoring\config\monitoring_schedule.yaml` | Create | Schedule parameters, channels, escalation rules |

### Configuration File

```yaml
# D:\AgenticOS\monitoring\config\monitoring_schedule.yaml

schedule:
  timezone: "UTC"
  execution_time_utc: "02:00"          # Run at this time daily
  window_start_utc: "01:00"
  window_end_utc: "03:00"
  
  cooldown_minutes: 1440               # 24 hours minimum
  
retry_policy:
  max_attempts: 1                      # Fail quickly
  notify_on_failure: true

notifications:
  channels:
    email:
      enabled: true
      provider: "sendgrid"             # or SMTP, etc.
      from_address: "finance-monitor@free-cash-finance.com"
      templates:
        earnings_reported: "email_templates/earnings_report.html"
        status_change: "email_templates/status_alert.html"
    push:
      enabled: conditional              # Only if device tokens set
    sms:
      enabled: false                    # Requires explicit opt-in
  escalation_rules:
    - event_types: ["account_frozen", "withdrawal_detected"]
      channels: ["email", "push", "sms"]
      approval_required: true

approval:
  cache_expiry_hours: 4                # Token lifetime
  refresh_endpoint: "/api/approval/monitoring"
  require_signature: true              # HMAC or OAuth for requests
  
data_sources:
  read_only_endpoints:
    - /api/v1/accounts/{id}/balance     # Read balance only
    - /api/v1/accounts/{id}/transactions?since={ts}  # Transactions
    - /api/health                        # Status endpoint
    - /api/earnings/daily-summary        # Earnings data
```

---

## VI. Key Design Decisions

### Why Cron + Cooldown Over Real-Time Polling?

- Rule #1 (once-per-day) is satisfied by scheduled execution
- Reduces load on API and database
- Matches business expectation of "daily check" rather than continuous monitoring
- Fits typical finance batch processing patterns

### Why Email/Push Before Escalation?

- Push notifications have higher engagement for finance-related alerts
- SMS reserved for urgent matters only (Rule #4 requires approval)
- Reduces notification fatigue and false escalation risk

### Reading From Multiple Sources Without Action Risk?

- Each connection wrapped in `read_only_mode()` decorator enforcing no writes
- Timeout of 30s per endpoint to avoid long hangs
- Circuit breaker pattern stops on 3 consecutive failures per source

---

## VII. Testing & Validation

| Test Case | Procedure | Expected Result |
|-----------|-----------|-----------------|
| COOLDOWN_ENFORCED | Run manual invoke at T+12h | Task refuses, logs warning |
| ZERO_WRITES | Inspect network traffic during check | No POST/PUT requests observed |
| CHANGE_NOTIFICATION_SENT | Seed test transaction | Email notification delivered within 2 min |
| MISSING_APPROVAL_TOKEN | Remove token from cache | Action raises `ApprovalRequired` exception |

### Sample Test Script

```python
# tests/test_daily_monitoring.py
from datetime import mock_datetime
from monitoring.schedules.daily_status_check import DailyStatusMonitor

class TestDailyStatusChecker:
    def test_cooldown_enforced(self):
        monitor = DailyStatusMonitor()
        monitor._last_run = datetime.now() - timedelta(hours=12)
        assert not monitor.should_run()  # Must wait another 12 hours
    
    def test_zero_writes_during_check(self, httpserver):
        # Record HTTP logs during monitoring check
        httpserver.serve_content("200 OK")
        with mock_datetime():
            monitor.execute_check()
        assert no_post_requests_sent(httpserver)
```

---

## VIII. Deployment Notes

### Prerequisites

1. System timer service accessible (Windows Task Scheduler / cron equivalent)
2. Email service credentials for notifications configured
3. Approval endpoint URL and authentication available
4. Read-only API client credentials mounted/seeded

### Post-Deploy Validation

```bash
kubectl logs -f <monitoring-deployment> | grep "DailyStatusMonitor"
# Or Windows:
tasklogs * /v | DailyStatusCheck  # Check that scheduled tasks fired properly
```

---

## IX. Risk & Compliance Summary

| Concern | Mitigation |
|---------|------------|
| **Unauthorized writes during check** | Code wrapper enforces read-only; linter rejects any write path |
| **Notification failure loop** | Log failures, alert on N consecutive misses, don't retry infinite times |
| **Missed daily check** | No action blocked; simply log and notify that today's run was skipped |
| **Accidental external action trigger** | Approval token required for every external write request (Rule #4) |
| **Over-notification** | Dedupe by event hash within 1-minute window to prevent spam from glitches |

---

## X. Appendix: Rule Compliance Map

### Operational Rule → Implementation Mapping

| Rule | Location in Codebase | Enforced By |
|------|---------------------|-------------|
| (1) Once-per-day check | `daily_status_check.py::should_run()` + cooldown config | Cron scheduler + code guard |
| (2) Zero earning actions | Read-only connectors + wrapper decorator | Code structure; no write paths possible |
| (3) Notify on changes | `notification_handler.py::handle_change_detection()` | Async senders triggered after read complete |
| (4) Approval before action | `approval_workflow.py::request_approval_token()` | Exception raised without valid token |

---

## Contact & Questions

- Implementation questions: contact the Free Cash Finance engineering team
- Emergency: Use escalation rules defined in `config/monitoring_schedule.yaml`
- Documentation: Refer to the API docs at `/api/docs` for endpoint specifics

---

*Version:* 1.0  
*Review Date:* TBD  
*Next Review:* Quarterly or after incident trigger

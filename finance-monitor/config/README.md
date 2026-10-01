# Free Cash Finance Automation - Daily Monitoring Configuration

## Environment Variables Required (.env)

```bash
# Notification Channels (enable via comma-space or individual env vars)
ENABLE_EMAIL=true
EMAIL_TO=noreply@finance-monitor.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
        
# Slack Integration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXXXXXXX/XXXXXXX/xxxxxxx
SLACK_CHANNEL=#finance-alerts
        
# Discord Integration  
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXXXXXXX/XXXXXXX
DISCORD_COLOR_GREEN=0x44aa44
DISCORD_COLOR_RED=0xff4444

# Sandbox Mode (set to false for production)
SANDBOX_MODE=true

# Timeout Settings (seconds)
USER_APPROVAL_TIMEOUT_SECONDS=86400  # 24 hours default
MAX_RETRY_ATTEMPTS=3
```

## Configuration Schema

### monitor.json (main config)

```json
{
  "schedule_window_utc": {
    "start_hour": 5,
    "end_hour": 9,
    "timezone_offset_hrs": -6   # Adjust to UTC+02:00 = Europe/Berlin or America/New_York
  },
  "notification_channels": {
    "email": {"enabled": true, "address": "$EMAIL_TO"},
    "slack": {"enabled": true, "webhook_url": "$SLACK_WEBHOOK_URL"},
    "discord": {"enabled": true, "webhook_url": "$DISCORD_WEBHOOK_URL"}
  },
  "sandbox_mode": {
    "enabled": true,
    "mock_api_responses": true,
    "no_real_network_calls": true
  },
  "approval_timeout_seconds": 86400,
  "api_endpoint_base": "https://api.example.finance/v1"
}
```

### rule_config.json (rule enforcement flags)

```json
{
  "rules": {
    "rule_1": {
      "id": 1,
      "name": "Zero Automated Earning Actions",
      "severity": "CRITICAL",
      "enforcement_mode": "BLOCK"
    },
    "rule_2": {
      "id": 2, 
      "name": "Once-per-Day Check",
      "severity": "WARNING",
      "grace_period_hours": 4
    },
    "rule_3": {
      "id": 3,
      "name": "Notify on Changes",
      "severity": "ERROR",
      "notification_on_delta_threshold": 0.01
    },
    "rule_4": {
      "id": 4,
      "name": "Human Approval Required", 
      "severity": "CRITICAL",
      "timeout_hours": 24
    }
  },
  "violation_actions": {
    "critical": [
      "immediate_abort",
      "full_alert_notification",
      "log_to_audit_store"
    ],
    "warning": [
      "skip_current_run", 
      "log_warning",
      "suggested_retry_time"
    ]
  }
}
```

## Audit Directory Structure

```
D:\AgenticOS\finance-monitor\
├── config/
│   ├── monitor.json          # Main orchestration config
│   ├── rule_config.json      # Rule enforcement rules
│   └── .env                  # Environment variables (secrets)
├── src/
│   ├── orchestrator.py       # Main execution entry point
│   ├── rule_engine.py        # Rule #1-#4 engine
│   ├── wait_gate.py          # Rule #4 approval gate
│   ├── notify_manager.py     # Rule #3 notification system
│   └── api_client.py         # Status fetching (sandbox)
├── logs/                      # Auto-generated: monitor_YYYY-MM-DD.log
├── changes/                   # Snapshot deltas: YYYY-MM-DD/delta.json
├── tests/
│   ├── test_rule_enforcement.py
│   └── approve_all_responses.py  # Simulation scripts
├── scripts/
│   └── run_daily_check.ps1    # Windows Task Scheduler entry point
└── docs/
    ├── architecture.md        # System architecture
    └── audit_log_guide.md     # How to read audit logs
```

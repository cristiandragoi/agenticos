# Free Cash Finance Automation - Daily Monitoring Architecture

## Overview

This document describes the architecture for a daily status monitoring routine that strictly enforces four operational safety rules.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Windows Task Scheduler                         │
│                    (Daily Trigger: UTC+02:00 Morning)               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Monitor Orchestrator                            │
│                     (monitor_core.py)                                │
│  ┌──────────────┐  ┌────────────┐  ┌────────────────────────────┐  │
│  │  Rule Check   │  │Status Fetch│  │   Human Approval Gate      │  │
│  │ [Rule #1-#4]  │→ │(API/DB)   │→ │ (WaitGate Class)          │  │
│  └──────────────┘  └────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼              ▼
        ┌────────────────┐   ┌────────────┐   ┌─────────────────┐
        │  Rule Violation│   │ No Change  │   │  Safe Action     │
        │   Detected     │   │ Logged     │   │ Required?        │
        └────────────────┘   └────────────┘   └─────────────────┘
                                    ▲               │
                                    │               ▼
                        ┌───────────┴───────────────┐
                        │      Notification System  │◄────┘
                        │ Email / Slack / Discord   │
                        └───────────────────────────┘
```

## Data Flow

1. **Trigger**: Windows Task Scheduler → `cron_task.py` (Windows Cron equivalent)
2. **Orchestration**: `monitor_core.py` loads rules, initializes API clients
3. **Rule Enforcement Pipeline**:
   - Rule #1: Pre-action integrity check (blocking if violations found)
   - Rule #2: Daily execution flag check (idempotency)
   - Rule #3: Change detection → notification generation
   - Rule #4: Decision tree for external actions (always human-approved)
4. **Execution**: Only approved actions proceed to `action_executor.py`
5. **Logging**: All steps logged to `logs/monitor_{YYYY-MM-DD}.log`

## Component Architecture

| Component | Purpose | Location |
|-----------|---------|----------|
| `orchestrator.py` | Main execution logic with rule checks | `src/orchestrator.py` |
| `wait_gate.py` | Rule #4 human approval mechanism | `src/wait_gate.py` |
| `notify_manager.py` | Multi-channel notification | `src/notify_manager.py` |
| `api_client.py` | Financial status fetching (sandbox) | `src/api_client.py` |
| `rule_engine.py` | Rule enforcement logic | `src/rule_engine.py` |
| `cron_task.py` | Windows scheduler entry point | `scripts/run_daily_check.ps1` |

## Safety Rules (Hard Constraints)

**Rule #1 - Zero Automated Earning Actions**
- All transaction APIs must go through the approval gate first
- Sandbox mode forces mock responses with no real network calls
- No money moves without explicit signed user consent

**Rule #2 - Once-per-Day Check**
- Atomic flag `last_check_{YYYY-MM-DD}.flag` prevents double execution
- Scheduler retry window: 6AM-8AM UTC+02:00 (3-hour grace period)

**Rule #3 - Notify on Changes**
- All status deltas captured in `changes/{YYYY-MM-DD}/delta.json`
- Notifications sent to registered channels (configurable)
- Silent mode available for dry-run/testing

**Rule #4 - Human Approval Required**
- External actions trigger approval request via notification system
- Actions blocked until user responds "APPROVE", "REJECT", or "MODIFY"
- Timeout after 24h → abort with alert (safety fail-safe)

## Audit Trail Design

Every operation is immutable-logged:

```yaml
log_entry:
  timestamp: UTC+02:00 (normalized to T+01:00 local offset)
  rule_id: Rule # that was checked/enforced
  action_oracle: Transaction or status check identifier
  status: PASSED | VIOLATION | ABORTED
  user_consent: null | {username, timestamp, method}
  outcome: success/failed/denied
```

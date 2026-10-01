# Operational Safety Rules - Audit Ready Reference

## Rule #1: Zero Automated Earning Actions

### Definition
Never execute financial transactions or revenue actions without explicit human confirmation.

### Implementation Checklist
- [ ] All action API calls pass through `WaitGate` class
- [ ] Sandbox mode validates against real wallet addresses
- [ ] Mock responses used for initial testing
- [ ] No auto-retry on approval timeout

### Enforcement Points
```python
if rule_engine.check_rule1(action_type=action, context=context):
    # Safe to proceed
else:
    abort(reason="Rule 1 violation: unauthorized action type")
```

---

## Rule #2: Once-per-Day Check

### Definition
Single daily execution window only (e.g., UTC+02:00 morning). Prevents duplicate runs, race conditions.

### Execution Window
- Primary: 05:30 - 06:30 UTC+02:00 (1 hour)
- Grace Period: Extended to 4 hours if missed (05:30 - 09:30 UTC+02:00)
- After grace: Alert + skip with retry suggestion

### Idempotency Mechanism
```bash
# Flag file check
if [ ! -f last_check_$(date +%Y-%m-%d).flag ]; then
    # Safe to proceed
    touch last_check_$(date +%Y-%m-%d).flag
else
    echo "Daily check already completed today"
    exit 0
fi
```

---

## Rule #3: Notify on Changes

### Definition
All earnings and account status modifications must generate notifications.

### Change Detection Logic
1. Capture baseline snapshot on startup
2. Poll account status after each action
3. Compare with baseline using hash/diff comparison
4. Generate notification for any delta > 0

### Notification Channels (Configurable)
| Channel | Use Case | Latency |
|---------|----------|---------|
| Email | Formal audit trail, compliance | ~5s |
| Slack #finance-alerts | Team collaboration | <1s |
| Discord #bot-finance | Personal alerts | <1s |

---

## Rule #4: Human Approval Required

### Definition
Pause and wait for explicit user confirmation before external actions.

### Response Codes
| Code | Meaning | Action |
|------|---------|--------|
| APPROVE | Proceed | Execute action |
| REJECT | Don't execute | Log rejection, skip action |
| MODIFY | Partial changes | User provides new values |

### Approval Workflow
```mermaid
sequenceDiagram
    participant Monitor as Monitor System
    participant Gateway as WaitGate
    participant User as Human User
    
    Monitor->>Gateway: Action requested (Rule#4 check)
    Gateway->>User: Push notification with details
    Participant->>Monitor: User responds (APPROVE/REJECT/MODIFY)
    Gateway->>Monitor: Response received
    Note over Monitor,User: Action queued or aborted
    
    alt Response == APPROVE
        Monitor->>Gateway: Release action lock
    else Response == REJECT/MODIFY
        Note over Monitor: Aborted pending
    end
```

### Timeouts
- Default: 24 hours
- Critical timeframes configurable via environment
- Timeout → Abort + Alert to user

---

## Rule Violation Handling

All rule violations are treated as HIGH SEVERITY security events:

| Rule | Severity | Response |
|------|----------|----------|
| #1 Violation | CRITICAL | Immediate abort, full alert |
| #2 Violation | WARNING | Skip + warning logged |
| #3 Violation | ERROR | Continue on error, notify |
| #4 Timeout | CRITICAL | Auto-abort + breach alert |

---

## Audit Readiness Checklist

- [ ] All actions include `action_id`, `timestamp`, `rule_ids_checked` fields
- [ ] Rule engine decisions are immutable (write-once logs)
- [ ] Human approvals cryptographically signed (optional, advanced)
- [ ] Change diffs stored with hash proofs
- [ ] All API calls have request/response capture

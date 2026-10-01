# Rule Enforcement Test Scenarios for Daily Monitoring Routine

## Purpose
These scenarios verify that each of the 4 operational rules is enforced at every execution step. Used primarily in sandbox mode before production deployment.

---

## Scenario #1: Initial Run (All Rules Active)

### Objective
Test first run with no prior flag, simulating user approvals via automated responses.

### Setup
```python
# In tests/test_rule_enforcement.py
import src.rule_engine as re
import src.wait_gate as wait_gate

rules = {
    "rule_2_flag": False,  # No prior execution today
    "rule_1_actions": [],   # No transactions yet
}
```

### Execution Steps & Rule Checks

**Step A: Start Check (API Status Fetch)**
- Call `orchestrator.check_rule2()` → Returns `(True, "Ready")`  
  - **Rule #2**: Idempotency verified (no flag file exists today) ✓
  - Outcome: Proceed to status fetch

**Step B: API Health Check + Snapshot**
- Fetch account baseline via `api_client.fetch_account_status()`
- Compute snapshot hash for change detection  
  - **Rule #3 Baseline**: Captured, stored for subsequent comparison ✓
  - No transactions executed (read-only operation) ✓

**Step C: External Action Simulation Rule #1 Gate**
- Try to auto-execute action → blocked by `wait_gate.request_approval()`
  - **Rule #1**: No auto-execution without approval gate invoked ✓
  - Mock response simulates user saying "REJECT" (no change)

### Expected Outcome
- Log: "Rule #2 OK - no flag file, proceed"  
- Log: "API snapshot captured for Rule #3 comparison"  
- No external actions performed (sandbox + rule #1 enforcement) ✓

---

## Scenario #2: Change Detected + Human Approval Required

### Objective
Verify that changes trigger notifications and require user approval before action.

### Setup
- Previous run detected balance delta > 0.01 USD
- NotifyManager queued notification to email/slack

### Rule Enforcement Flow

**Rule #3 Trigger**:
- `rule_engine.check_rule3(snapshot_hash, current_hash)` → returns `(True, changes_list)`  
  - **Rule #3**: Changes flagged → notifies user ✓
- Slack webhook posted: "Financial Status Change Detected" (mocked)

**Rule #4 Gate Enforcement**:
- `wait_gate.request_approval()` invoked with action details
  - Sandbox simulation waits ~5s then returns `(True, "APPROVED")`  
    OR `(False, "REJECTED")` randomly simulated ✓
  - In production: Polls for actual user response

**Execution Decision**:
- Rule #4 approval → execute via `api_client.simulate_action()`  
  - If approved: Action logged but sandboxed (no real money moved)  
  - If rejected: Execution skipped, rejection logged with timestamp ✓
  - **Rule #1/ #4**: Zero transactions auto-executed ✓

### Expected Outcome
- Notifications sent to configured channels ✓
- User approval required before action ✓
- Sandbox mode logs all simulated decisions ✓

---

## Scenario #3: Timeout (No User Response)

### Objective
Verify Rule #4 safety abort when user doesn't respond within 24 hours.

### Setup
- Action requires approval but no response received  
- `timeout_seconds = 86400` set in WaitGate init

### Execution Steps

**Approval Request Sent**:
- Notification dispatched at 06:00 UTC+02:00 via email/slack/discord  
  - **Rule #3**: Notification sent → no timeout timer started yet ✓

**Wait Period**:
- No simulated user response in `wait_gate.request_approval()` for sandbox test
- Time advances > 4 hours beyond notification timestamp (in production)

**Timeout Handler Triggered**:
- `wait_gate.handle_timeout(action_id)` called  
  - Logs warning with reason `No user response within timeout` ✓
  - Returns `(False, abort=true)`  
  - **Rule #4 Safety Fail-safe**: Auto-aborts action ✓
  - Audit entry logged for compliance review

### Expected Outcome
- Action aborted without execution ✓
- Timeout alert sent to user and team channels ✓
- Log contains audit trail with `TIMEOUT` event type ✓

---

## Scenario #4: Force Override (Testing Only)

### Objective
Verify ability to bypass Rule #2 flag during regression tests.

### Setup
```python
rule_engine = rule_engine.RuleEngine()
# Normal: flag exists, returns False on check_rule2()
allow, msg = rule_engine.check_rule2(force=True)  # Force override
assert allow == True, "Force should allow execution"
```

### Expected Outcome
- Flag file deleted/ignored  
- Warning logged to alert operator  
- Proceeds with next step (sanity only — not for production) ✓  
- **Rule #2**: Only bypassed intentionally via `force=True` flag

---

## Scenario #5: No Changes Detected + Silent Run

### Objective
Confirm system runs once daily, detects no changes, logs completion.

### Flow

**Status Check**:
- `api_client.fetch_account_status()` → current snapshot  
  - **Rule #3 Baseline Comparison**: Hash differs from prior run? NO ✓  

**Change Detection**:
- `rule_engine.check_rule3(baseline_hash, current_hash)` → `(False, [])`  
  - **Rule #3 Pass**: No changes → no notification needed ✓

**Execution Decision**:
- `wait_gate.request_approval(action_required=False)` returns `(True, "No action")`  
  - **Rule #4 Skip**: No external action, approval gate bypassed  
- Log: "Daily check completed, no changes found" ✓

### Expected Outcome
- System completes daily run once per day ✓
- Idempotent behavior maintained (flag prevents double run) ✓
- Zero notifications for unchanged state ✓

---

## Scenario #6: Multiple Channels Fallback (Rule #3 Resilience)

### Objective
Verify Rule #3 still notifies if one channel fails.

### Setup
```python
manager = NotifyManager(config_path)
status_update = manager.notify_on_change(
    change_type="balance_delta",
    changes=[{"amount": 50, "direction": "+"}]
)
```

### Behavior
- Slack webhook sends: `"🔔 Financial Status Change"`  
- Discord embed posts with alert color  
- Email message queued to SMTP  

**Failure Simulation**:
- Slack responds `429 Too Many Requests`  
- Manager catches exception → logs error → proceeds to email
  - **Rule #3 Resilience**: At least one channel delivered ✓

### Expected Outcome
- Message reaches at least 1/3 channels even if others fail  
- Failures logged with retry attempt count (in production)  
- Audit trail shows delivery status per channel ✓  

---

## Scenario Summary Table

| Scenario | Rule #1 Tested? | Rule #2 Tested? | Rule #3 Tested? | Rule #4 Tested?        |
|----------|------------------|------------------|-------------------|-----------------------------------------------------|
| Initial Run     | ✅ (gate invoked)    | ✅ (flag check)      | ✅ (baseline capture) | ✅ (no action, approval skipped)          |
| Change + Approval         | ✅ (approval gate)   | ✅ (flag present)        | ✅ (notification sent)  | ✅ (user response received in sandbox)     |
| Timeout                         | ✅                  | ✅                    | ✅                     | ✅ (timeout enforcement aborts action)    |
| Force Override        | N/A                     | ✅ (force bypass)          | N/A                           | N/A                             |
| No Changes Detected | N/A                      | ✅ (repeat prevention)     | ✅ (no change detected)  | ✅ (skip approval gate)                    |
| Multiple Channel Fallback | N/A                   | ✅                    | ✅ (partial delivery)   | N/A                                           |

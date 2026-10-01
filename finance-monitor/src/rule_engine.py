from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)


class RuleEngine:
    """
    Enforces the 4 operational safety rules for Free Cash Finance Automation.
    
    Rule #1: Zero automated earning actions - never auto-execute financial transactions
    Rule #2: Once-per-day check - scheduled single daily run window (UTC+02:00 morning)
    Rule #3: Notify on changes - alert on any earnings or account status modifications
    Rule #4: Human approval required - pause before any external action, wait for explicit user confirmation
    """
    
    def __init__(self):
        # Track today's execution flag
        self._today: str = datetime.now().strftime("%Y-%m")
        self._flag_name: str = f"last_check_{datetime.today().strftime('%Y-%m')}.flag"
    
    def check_rule1(self, action_type: str, context: dict) -> bool:
        """
        Rule #1: Zero automated earning actions
        
        Never allow auto-execution of financial transactions.
        
        Args:
            action_type: Type of action requested (e.g., "withdraw", "transfer")
            context: Action context including amount, target, purpose
            
        Returns:
            False = blocked (no action should proceed)
            
        AUDIT LOGGING: This method always returns False to enforce Rule #1.
        Human approval must be obtained before any action execution.
        """
        rule_id = 1
        rule_name = "Zero Automated Earning Actions"
        
        logger.info(
            f"[Rule#{rule_id}] CHECK: Action type={action_type}, context={context}",
            extra={"rule_id": rule_id}
        )
        
        # Always return False here - this is Rule enforcement, not a policy decision
        # The actual action execution happens ONLY after Rule #4 approval gate
        return False
    
    def check_rule2(self, force: bool = False) -> tuple[bool, str]:
        """
        Rule #2: Once-per-day check
        
        Enforce single daily execution window (UTC+02:00 morning).
        
        Args:
            force: Override flag if needed (should only use in tests/emergency)
            
        Returns:
            (allowed, message) tuple
            
        AUDIT LOGGING: Rule #2 ensures idempotency to prevent duplicate runs.
        """
        rule_id = 2
        rule_name = "Once-per-Day Check"
        
        expected_flag_name = f"last_check_{datetime.now().strftime('%Y-%m-%d')}.flag"
        
        logger.info(
            f"[Rule#{rule_id}] Rule #2 check: force={force}, flag exists={(Path(expected_flag_name).exists())}",
            extra={"rule_id": rule_id}
        )
        
        flag_path = Path(expected_flag_name)
        
        # Force mode for tests/emergency only
        if force:
            flag_path.unlink(missing_ok=True)
            logger.warning(
                f"[Rule#{rule_id}] Forced override, removing stale flag file",
                extra={"rule_id": rule_id}
            )
            return True, "Force override active"
        
        # Normal operation: check if already ran today
        if flag_path.exists():
            logger.warning(
                f"[Rule#{rule_id}] Daily execution already completed - skipping",
                extra={"rule_id": rule_id, "flag_file": expected_flag_name}
            )
            return False, f"Flag exists: {expected_flag_name}"
        
        # Not ran yet today - allow and record flag on completion later
        logger.info(
            f"[Rule#{rule_id}] OK to run (no flag file at day start)",
            extra={"rule_id": rule_id}
        )
        return True, "Ready to check accounts"
    
    def check_rule3(self, snapshot_hash: str, current_hash: str) -> tuple[bool, list]:
        """
        Rule #3: Notify on changes
        
        Detect account status or earnings modifications and prepare notifications.
        
        Args:
            snapshot_hash: Hash of baseline snapshot (from startup)
            current_hash: Hash of current state
            
        Returns:
            (has_changes, changes_list)
            
        AUDIT LOGGING: All deltas must be captured here for notification generation.
        """
        rule_id = 3
        rule_name = "Notify on Changes"
        
        logger.info(
            f"[Rule#{rule_id}] Hash comparison: baseline={snapshot_hash[:8]...}, current={current_hash[:8]...}",
            extra={"rule_id": rule_id}
        )
        
        if snapshot_hash != current_hash:
            # Simulated change detection - in real system, would diff actual data
            changes_detected = [
                {"type": "balance_delta", "delta": float(current_hash) - float(snapshot_hash)},
            ]
            
            logger.info(
                f"[Rule#{rule_id}] Changes detected: {changes_detected}",
                extra={"rule_id": rule_id, **changes_detected[0]}
            )
            return True, changes_detected
        
        logger.info("[Rule#3] No changes detected", extra={"rule_id": rule_id})
        return False, []
    
    def check_rule4(self, action_required: bool) -> tuple[bool, str]:
        """
        Rule #4: Human approval required
        
        Pause and wait for explicit user confirmation before external actions.
        
        Args:
            action_required: Whether an external action needs approval
            
        Returns:
            (proceed, message) - Always requires manual approval here
            
        AUDIT LOGGING: Never proceed without user_consent in log entry.
        """
        rule_id = 4
        rule_name = "Human Approval Required"
        
        logger.info(
            f"[Rule#{rule_id}] Action required={action_required}",
            extra={"rule_id": rule_id, "proceeding_to_approval_gate": action_required}
        )
        
        if not action_required:
            logger.info("[Rule#4] No action needed - skipping approval step", extra={"rule_id": rule_id})
            return True, "No external action required"
        
        # Rule #4 implementation note:
        # This method SHOULD return (False, "Awaiting user approval") normally
        # but the WaitGate class handles the actual notification and polling logic.
        # 
        # In normal operation, WaitGate calls this with action=True to trigger
        # the human confirmation workflow.
        
        logger.info(
            f"[Rule#{rule_id}] Pausing for user approval (notification sent)",
            extra={"rule_id": rule_id}
        )
        return False, "Requires human approval before proceeding"

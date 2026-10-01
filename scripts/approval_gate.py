#!/usr/bin/env python3
"""Approval gate mechanism - JWT token based consent capture via email/Slack link."""

import json
import os
import sys
import jwt
import hmac
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path


class ApprovalGate:
    """Human consent capture for external money movements."""
    
    def __init__(self, config_path):
        self.config = self._load_config(config_path)
        self.webhook_url = self.config.get("webhook_url", "")
        self.token_expiry_hours = self.config.get("token_expiry_hours", 4)  # 15-60 min default
        self.secret_key = os.environ.get("SIGNING_KEY", self._read_secret("signing.key"))
    
    def _load_config(self, config_path):
        """Load approval gate configuration."""
        with open(config_path) as f:
            cfg = json.load(f)
        
        if "webhook_url" not in cfg or not cfg["webhook_url"]:
            raise ValueError("Webhook URL required for consent links")
        
        return cfg
    
    def _read_secret(self, secret_name):
        """Read secret from vault file. Never store in code."""
        vault_file = Path(os.environ.get("VAULT_PATH", "D:/AgenticOS/secrets")) / secret_name
        if vault_file.exists():
            return vault_file.read_text().strip()
        return None
    
    def request_action(self, user_config_id, action_type, details):
        """Generate time-bound approval token for user."""
        
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(hours=self.token_expiry_hours)
        created_at = now.isoformat()
        
        payload = {
            "user": user_config_id,
            "action_type": action_type if action_type else "",
            "details": details.strip() if isinstance(details, str) else (details.to_dict() if hasattr(details, "to_dict") else str(details)),
            "expires_at": expires_at.isoformat(),
            "created_at": created_at
        }
        
        signed = jwt.encode(
            payload, 
            key=self.secret_key, 
            algorithm="HS256"
        )
        
        approval_url = f"{self.webhook_url}/{user_config_id}/approve?token={signed}"
        
        return {
            "token": signed,
            "url": approval_url,
            "expires_in_seconds": int((expires_at - now).total_seconds()),
            "created_at": created_at
        }
    
    def verify_approval(self, user_id, token):
        """Verify JWT token and check if it's still valid."""
        try:
            decoded = jwt.decode(
                token,
                key=self.secret_key,
                algorithms=["HS256"],
                issuer="FreeCashFinance",
                audience=user_id
            )
            
            now = datetime.now(timezone.utc)
            expires_at = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
            
            valid_expiry = expires_at > now
            user_match = decoded.get("user") == user_id
            
            return {
                "valid": valid_expiry and user_match,
                "reason": "ok" if (valid_expiry and user_match) else ("expired" if not valid_expiry else "user_mismatch"),
                "decoded": decoded
            }
        except jwt.InvalidTokenError as e:
            return {
                "valid": False,
                "reason": "invalid_token",
                "error": str(e)[:100]
            }
    
    def capture_consent(self, user_config_id, action_request):
        """Record approval after verification."""
        
        if not self.verify_approval(user_config_id, action_request.get("signed_token"))["valid"]:
            return {
                "status": "rejected",
                "reason": action_request.get("signed_token") or "invalid_or_expired"
            }
        
        # Log the approved action for audit trail
        action_result = self._log_approval(
            user_config_id,
            action_request["action_type"],
            action_request.get("details", {})
        )
        
        return {
            "status": "approved",
            "action_result": action_result,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    
    def _log_approval(self, user_id, action_type, details):
        """Log approved action to audit trail."""
        log_file = Path(os.environ.get("LOG_PATH", "D:/AgenticOS/logs/approvals.log"))
        
        with open(log_file, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} | User: {user_id} | Action: {action_type} | Details: {details}\n")
        
        return {"logged": True, "log_path": str(log_file)}


def main():
    """Demonstrate approval gate usage."""
    config_path = os.getenv("CONFIG_PATH", "D:/AgenticOS/configs/approval_gate.json")
    
    if not Path(config_path).exists():
        print(f"Config not found: {config_path}", file=sys.stderr)
        return 1
    
    gate = ApprovalGate(config_path)
    
    # Example: Request approval for a withdrawal
    result = gate.request_action(
        user_config_id="user@example.com",
        action_type="WITHDRAWAL",
        details={
            "account_id": "ACC-XXXX",
            "amount": 1000.0,
            "destination": "External Bank X"
        }
    )
    
    print(json.dumps(result, indent=2))
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

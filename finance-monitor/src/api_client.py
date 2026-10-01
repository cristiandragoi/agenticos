from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class FinanceAPIClient:
    """
    Financial status API client for external account/status checks.
    
    AUDIT READINESS: All calls are logged with request/response capture.
    SANDBOX MODE: Never executes real transactions - validates against mock.
    """

    def __init__(self, api_base_url: Optional[str] = None, 
                 sandbox_mode: bool = True):
        self._api_base = api_base_url or "https://api.example.finance/v1"
        self._sandbox = sandbox_mode
        self._request_log: list[dict] = []
        
        logger.info(
            f"FinanceAPIClient initialized: base={self._api_base}, sandbox={self._sandbox}",
            extra={"component": "api_client"}
        )

    def fetch_account_status(self, account_id: str) -> dict[str, Any]:
        """
        Fetch current status of a financial account.
        
        AUDIT LOGGING: This method always logs the request and simulated response.
        SANDBOX MODE: Returns mock data that mirrors real API responses but uses fake wallet addresses.
        
        Args:
            account_id: Account identifier
            
        Returns:
            Dict with account status, balance snapshot, timestamp
        """
        
        now = datetime.now(tz=timezone.utc)
        request_id = f"req_{now.isoformat().replace(':', '_')[:20]}"
        
        # Log for audit trail first
        log_entry = {
            "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "request_id": request_id,
            "endpoint": "/accounts/status",
            "parameters": {"account_id": account_id},
            "sandbox_mode": self._sandbox,
        }
        
        # Simulate API call in sandbox; would use cdp('Fetch') or requests.get() in production
        mock_response = {
            "status": "ok",
            "balance_snapshot_fiat_usd": 1234.56,
            "wallet_address_hash": "sha256_mocksomedaddress0x" + account_id[:8], 
            "last_transaction_age_seconds": 3600,
            "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        
        self._request_log.append(log_entry)
        
        logger.info(
            f"[API] Request logged (sandbox): {json.dumps(log_entry)}",
            extra={"component": "api_client", "audit_logging": True}
        )
        
        return mock_response

    def get_earnings_summary(self, period_days: int = 7) -> dict[str, Any]:
        """
        Get earnings summary for specified period.
        
        RULE #1: This method never auto-expects transactions; it only reads status.
        Returns simulated earnings data in sandbox mode.
        """
        now = datetime.now(tz=timezone.utc)
        request_id = f"earn_sum_{now.isoformat()[-10:][:8]}"
        
        log_entry = {
            "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "get_earnings_summary",
            "parameters": {"period_days": period_days},
            "sandbox_mode": self._sandbox,
        }
        
        # Sandbox mode always returns mock data
        response = {
            "status": "ok",
            "total_earnings_usd": 4250.00 + (period_days * 130), 
            "transaction_count": period_days * 3,
            "period_start": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "period_end": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        
        self._request_log.append(log_entry)
        logger.info(
            f"[API] Earnings request (sandbox): {response}",
            extra={"component": "api_client"}
        )
        
        return response

    def compute_status_hash(self, account_data: dict[str, Any]) -> str:
        """
        Compute hash of account data for change detection (Rule #3).
        
        Simple rolling hash function - would be SHA-256 with proper libs in production.
        AUDIT: Hash computation is logged immutably once complete.
        """
        # Simple checksum simulation using Python's built-in module
        import hashlib
        data_str = json.dumps(account_data, sort_keys=True)
        hash_value = hashlib.sha256(data_str.encode()).hexdigest()[:16]
        
        log_entry = {
            "hash_type": "status_checksum",
            "value": hash_value,
            "sandbox_mode": self._sandbox,
        }
        
        logger.info(
            f"[API] Status hash: {hash_value} (sandbox={self._sandbox})",
            extra={"component": "api_client"}
        )
        
        return hash_value

    def simulate_action(self, action_id: str, action_type: str) -> dict[str, Any]:
        """
        Simulate an external action on accounts.
        
        RULE #1 / RULE #4: This method ONLY runs after WaitGate approval and user consent.
        In sandbox mode, it logs the 'action' without network calls.
        Production would require signed user consent before execution.
        """
        
        # Audit entry required
        timestamp = datetime.now(tz=timezone.utc).isoformat()
        log_entry = {
            "timestamp": timestamp,
            "method": "simulate_action",
            "parameters": {"action_id": action_id, "type": action_type},
            "sandbox_mode": self._sandbox,
            "result": "NO_NETWORK_CALL" if self._sandbox else "ACTION_RESULT",
        }
        
        self._request_log.append(log_entry)
        logger.info(
            f"[API] Action simulated (sandbox): {json.dumps(log_entry, default=str)}",
            extra={"component": "api_client"}
        )
        
        return log_entry

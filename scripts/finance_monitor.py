#!/usr/bin/env python3
# Read-only daily status monitoring script for Free Cash Finance
# Checks account status once daily at 8AM, notifies on changes only

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import requests


class FreeCashMonitor:
    """Read-only account status monitor - never actions without approval."""
    
    def __init__(self, config_path):
        self.config = self._load_config(config_path)
        self.api_endpoint = self.config.get("api", {}).get("endpoint", "").rstrip("/")
        self.token = None
        if self.config.get("api", {}).get("use_cached_token", True):
            cached_file = Path(os.environ.get("APPDATA", "")) / "FreeCash" / "tokens.json"
            token_json = cached_file.read_text() if cached_file.exists() else '{}'
            self.token = json.loads(token_json).get(self.api_endpoint, {})
        
        self.notification_service = None
        self.previous_state = {}
    
    def _load_config(self, config_path):
        """Load monitoring configuration from JSON file."""
        with open(config_path) as f:
            cfg = json.load(f)
        
        if "api" not in cfg or cfg["api"].get("endpoint", "").endswith("/"):
            raise ValueError("Invalid API endpoint format")
        
        if "notification" not in cfg:
            cfg["notification"] = {"email": True, "sms": False}
        
        return cfg
    
    def set_token(self, token):
        """Set API authentication token via vault."""
        self.token = token
    
    async def daily_status_check(self):
        """Check account status without triggers. Read-only operations only."""
        
        endpoints_to_check = [
            {"path": "/accounts/overview", "method": "GET"},
            {"path": "/transactions/recent", "method": "GET"},
            {"path": "/balance/current", "method": "GET", "on_demand": True},
            {"path": "/alerts/status", "method": "GET"},
        ]
        
        results = {}
        changes_detected = []
        errors_encountered = []
        
        for endpoint in endpoints_to_check:
            try:
                headers = {
                    "Authorization": f"Bearer {self.token}",
                    "x-api-version": "2024-10-01",
                    "read-only": "true"
                }
                
                response = requests.get(
                    self.api_endpoint + endpoint["path"],
                    headers=headers,
                    timeout=30
                )
                
                if response.status_code == 200:
                    data = response.json()
                    results[endpoint["path"].split("/")[-1]] = data
                    
                    if endpoint.get("on_demand", False):
                        self.previous_state = results.copy()
                        changes_detected.extend(
                            self._analyze_changes(data, self.previous_state, "overview")
                        )
                else:
                    errors_encountered.append({
                        "endpoint": endpoint["path"],
                        "status": response.status_code,
                        "error": response.text[:200] if response.text else "Unknown"
                    })
                    
            except requests.RequestException as e:
                errors_encountered.append({
                    "endpoint": endpoint["path"],
                    "exception": str(e)
                })
        
        # On-demand balance check only for anomalies
        if any(event.get("type") in ["pending_transfer", "unusual_activity", 
                                      "balance_threshold_breach"]
               for event in changes_detected):
            try:
                headers = {"Authorization": f"Bearer {self.token}", "x-api-version": "2024-10-01"}
                balance_resp = requests.get(
                    self.api_endpoint + "/balance/current",
                    headers=headers,
                    timeout=30
                )
                
                if balance_resp.status_code == 200:
                    results["balance"] = balance_resp.json()
                    changes_detected.extend(
                        self._analyze_changes(balance_resp.json(), 
                                              self.previous_state.get("balance", {}), "overview")
                    )
            except Exception as e:
                errors_encountered.append({"exception": str(e)})
        
        if not errors_encountered or len(errors_encountered) < 2:
            self.previous_state = {k: v for k, v in results.items() 
                                  if not isinstance(v, dict) or "error" not in str(v)}
        
        return {
            "status": "ok" if errors_encountered == [] else "degraded",
            "data": {k: v for k, v in results.items() if not isinstance(v, dict)},
            "changes_detected": changes_detected,
            "last_run": datetime.now(timezone.utc).isoformat(),
            "actions_allowed": any(c["type"] == "new_earning" for c in changes_detected),
            "errors": errors_encountered
        }
    
    def _analyze_changes(self, current, previous, category):
        """Compare states and detect material changes."""
        changes = []
        
        if "accounts" in category or "overview" in category:
            accounts = current.get("accounts", {}) if isinstance(current, dict) else {}
            
            for acc_id in list(accounts.keys()):
                prev_acc = previous.get(acc_id, {}) if isinstance(previous, dict) and acc_id in previous else {}
                
                try:
                    prev_balance = float(prev_acc.get("balance", 0))
                    curr_balance = float(accounts[acc_id].get("balance", 0))
                    
                    if prev_balance != 0:
                        diff_pct = abs(curr_balance - prev_balance) / prev_balance * 100
                        
                        if diff_pct >= 1.0:
                            changes.append({
                                "type": "balance_change",
                                "account_id": acc_id,
                                "previous": prev_balance,
                                "current": curr_balance,
                                "change_pct": round(diff_pct,),
                                "subcategory": category
                            })
                except (ValueError, TypeError):
                    pass
        
        elif "transactions" in category or "renewals" in category:
            transactions = current.get("items", []) if isinstance(current, dict) else []
            
            for trx in transactions:
                try:
                    status = trx.get("status", "")
                    amount = float(trx.get("amount", 0))
                    
                    if status not in ["pending", "processing"]:
                        changes.append({
                            "type": "new_transaction",
                            "account_id": str(trx.get("accountId", "")),
                            "transaction": trx,
                            "requires_approval": self._is_withdrawal(trx)
                        })
                except (ValueError, TypeError):
                    pass
        
        elif "alerts" in category:
            active_alerts = current.get("active_alerts", []) if isinstance(current, dict) else []
            
            for alert in active_alerts:
                changes.append({
                    "type": "alert_status_change",
                    "account_id": str(trx.get("accountId", "")),
                    "alert_id": alert.get("id", ""),
                    "priority": alert.get("severity", "info"),
                    "message": alert.get("message", "")[:200]
                })
        
        return changes
    
    def _is_earning(self, transaction):
        """Heuristic check for income transactions."""
        amount_str = str(transaction.get("amount", 0)).lower()
        type_str = str(transaction.get("type", "")).lower()
        
        is_income_type = any(t in type_str for t in ["deposit", "income", "credit"])
        is_positive_amount = float(amount_str) > 0.01
        
        return is_income_type and is_positive_amount
    
    def _is_withdrawal(self, transaction):
        """Heuristic check for outbound transfers."""
        amount_str = str(transaction.get("amount", 0)).lower()
        type_str = str(transaction.get("type", "")).lower()
        
        is_outbound_type = any(t in type_str for t in ["withdraw", "transfer", 
                                                         "payment", "debit"])
        return is_outbound_type and float(amount_str) > 0


def main():
    """Entry point for scheduled task."""
    config_path = os.getenv("CONFIG_PATH", "D:/AgenticOS/configs/finance_settings.json")
    
    try:
        monitor = FreeCashMonitor(config_path)
        
        if not monitor.token:
            print("ERROR: No API token configured. Check vault.", file=sys.stderr)
            return 1
        
        result = monitor.daily_status_check()
        
        log_file = Path(os.environ.get("LOG_PATH", "D:/AgenticOS/logs/finance_monitor.log"))
        log_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(log_file, "a") as f:
            f.write(f"{result['last_run']} | Status: {result['status']}\n")
            
            if result.get("changes_detected"):
                for change in result["changes_detected"]:
                    acc_id = str(change.get('account_id', ''))[:20]
                    f.write(f"  Change: {change['type']} - {acc_id}\n")
            
            if result.get("errors"):
                for err in result["errors"][:5]:
                    f.write(f"  Error: {err.get('endpoint')}: {err.get('status', '')}\n")
        
        if result.get("changes_detected"):
            from scripts.notification_service import send_notification
            notification_config = Path(config_path).parent / "notification.json"
            
            if notification_config.exists():
                notify = send_notification(notification_config, result)
                
                if notify.get("sent", False):
                    with open(log_file, "a") as f:
                        f.write(f"  Notifications sent for {len(notify.get('changes', []))} change(s)\n")
        
        return 0 if result["status"] == "ok" else -1
        
    except Exception as e:
        print(f"CRITICAL ERROR: {e}", file=sys.stderr)
        with open(log_file, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} | Status: error | {str(e)}\n")
        
        return 1


if __name__ == "__main__":
    sys.exit(main())

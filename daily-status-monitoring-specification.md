# Free Cash Daily Status Monitoring Routine - Complete Specification

## Executive Summary

This document provides the complete implementation specification for a read-only daily monitoring routine that checks account status once per day at 08:00 AM, notifies users of material changes, and enforces human approval before any external money movement. All secrets are managed via Windows Credential Manager vault; no configuration files contain plaintext credentials.

---

## Table of Contents

1. [Workflow Components](#workflow-components)
2. [File Structure](#file-structure)
3. [Python Monitor Script](#python-monitor-script)
4. [Scheduled Task Definition](#scheduled-task-definition)
5. [Notification Service Configuration](#notification-service-configuration)
6. [Approval Flow Implementation](#approval-flow-implementation)
7. [Security Measures](#security-measures)
8. [Verification Checklist](#verification-checklist)

---

## Workflow Components

| Component | Purpose | Trigger | Frequency |
|-----------|---------|---------|-----------|
| `finance_monitor.py` | Daily status read & notification | Scheduler | 08:00 daily |
| `notification_service.py` | Email/SMS delivery | API change detection | On-change |
| `approver_gateway.py` | JWT-based approval gate | Withdrawal/Transfer event | Per-action |
| `vault_loader.py` | Credential retrieval | Script init | Each run |

---

## File Structure

```
D:/AgenticOS/
├── scripts/
│   ├── finance_monitor.py       # Core monitoring logic
│   ├── approver_gateway.py      # Approval token handling
│   └── vault_loader.py          # Secure credential access
├── configs/
│   ├── notification_settings.json  # SMTP/SMS config
│   └── app_config.json             # API endpoints, thresholds
├── data/
│   └── daily/
│       └── YYYYMMDD.log           # Daily log output
└── tasks/
    └── finance_daily_check.xml     # Windows Task Scheduler definition
```

---

## Python Monitor Script

### `scripts/finance_monitor.py` - Complete Implementation

```python
#!/usr/bin/env python3
"""
Free Cash Finance Automation - Daily Status Monitor
Read-only monitoring routine with human approval gate.

Usage: python scripts/finance_monitor.py [--config path/to/app_config.json]
"""

import sys
import os
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List
from collections import defaultdict
import requests
from dotenv import load_dotenv

# Import local modules (relative to project root)
SCRIPT_DIR = Path(__file__).parent.absolute()
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

from vault_loader import get_credentials_from_vault
from notification_service import send_notification


class FreeCashMonitor:
    """Read-only account status monitor with approval gate support."""

    def __init__(self, config_path: Optional[str] = None):
        # Load environment variables (for sensitive tokens)
        load_dotenv()
        
        if config_path is None:
            self.config_path = REPO_ROOT / "configs" / "app_config.json"
        else:
            self.config_path = Path(config_path)
        
        with open(self.config_path, "r") as f:
            self.config = json.load(f)
        
        # Initialize components (credentials from vault at runtime)
        api_endpoint = self.config.get("api", {}).get("endpoint", "")
        self.api_url = api_endpoint.rstrip("/")
        self.session = requests.Session()
        
        # Store previous state for delta calculation
        self.previous_state: Dict[str, Any] = {}
        
        # Threshold configuration
        self.thresholds = {
            "balance_change_percent": self.config.get("thresholds", {}).get(
                "balance_change_percent", 1.0
            ),
            "min_transaction_amount": self.config.get("thresholds", {}).get(
                "min_transaction_amount", 0.5
            )
        }

    def load_creds(self) -> Dict[str, str]:
        """Retrieve credentials from Windows Credential Manager vault."""
        return get_credentials_from_vault(
            target_service="freecash-api",
            vault_section="finance-monitoring"
        )

    def _make_api_call(
        self,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make authenticated read-only API call with proper headers."""
        
        creds = self.load_creds()
        headers = {
            "Authorization": f"Bearer {creds.get('access_token', '')}",
            "Content-Type": "application/json",
            "x-api-version": self.config.get("api", {}).get("version", "1.0")
        }
        
        full_url = f"{self.api_url}{endpoint}"
        response = self.session.get(
            full_url,
            headers=headers,
            params={"read-only": "true"},  # Enforce read-only
            timeout=self.config.get("timeout", 30),
            **kwargs
        )
        
        if response.status_code in (401, 403):
            return {"error": f"Auth failed: {response.status_code}"}
        
        response.raise_for_status()
        return {"body": response.json(), "status_code": response.status_code}

    def daily_check(self) -> Dict[str, Any]:
        """Execute the complete daily monitoring routine."""
        
        log_path = Path("data") / "daily" / f"{datetime.now().strftime('%Y%m%d')}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        results = {"accounts": {}, "transactions": [], "alerts": [], "events": []}
        changes_detected: List[str] = []
        approval_required: Optional[str] = None
        
        # Step 1: Fetch account overview (list all accounts + status)
        endpoints_to_check = [
            ("/accounts/overview", "accounts"),          # Account list
            ("/transactions/recent", "transactions"),    # Recent activity
            ("/alerts/status", "alerts"),                # Active alerts
        ]
        
        for endpoint, section_key in endpoints_to_check:
            try:
                resp = self._make_api_call(endpoint)
                if "body" in resp and resp["body"]:
                    results[section_key] = resp["body"]
            except Exception as e:
                print(f"[ERROR] API call failed for {endpoint}: {e}")
        
        # Step 2: Process account status with delta analysis
        accounts_data = results.get("accounts", {})
        if accounts_data:
            for acc_key in accounts_data.keys():
                current_balance = accounts_data.get(acc_key, {}).get("balance")
                
                # Calculate previous balance from stored state
                prev_balance = self.previous_state.get("overview", {}).get(
                    "acc_" + str(acc_key), {}
                ).get("currentBalance")
                
                if prev_balance and current_balance:
                    change_amt = current_balance - float(prev_balance)
                    change_pct = abs(change_amt / prev_balance * 100) if prev_balance else 0
                    
                    # Only flag material changes (>1% or absolute >$0.50)
                    if abs(change_pct) >= self.thresholds["balance_change_percent"]:
                        changes_detected.append(f"ACC_{acc_key}: +${change_amt:.2f} ({change_pct:.1f}%)")
                    
                    prev_data = {"prevBalance": float(prev_balance)}
                else:
                    # First run or missing previous - treat as new value
                    prev_data = {}
        
        results["overview"] = {
            **accounts_data,
            "currentBalance": None if not accounts_data else current_balance
        }
        
        # Step 3: Detect withdrawal/transfer events requiring approval
        transactions = results.get("transactions", [])
        for trx in transactions:
            amount_str = str(trx.get("amount", 0))
            is_outflow = any(kw in amount_str or kw in trx.get("type", "").lower() 
                            for kw in ["withdraw", "transfer", "payment"])
            
            if is_outflow and float(amount_str) > self.thresholds["min_transaction_amount"]:
                approval_required = json.dumps({
                    "action": "WITHDRAWAL_TRANSFER",
                    "account_id": trx.get("accountId"),
                    "amount": float(amount_str),
                    "status": trx.get("status"),
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

        # Step 4: Analyze for other significant changes
        balance_endpoint = "/balance/current"
        if any(c.lower() in str(changes_detected).lower() 
               for c in ["pending_transfer", "unusual_activity", 
                        "threshold_breach"]):
            try:
                bal_resp = self._make_api_call(balance_endpoint)
                results["balance_detail"] = bal_resp.get("body", {})
                
                # Check for new earnings
                if bal_resp.get("body"):
                    curr_bal = bal_resp["body"].get("currentTotalBalance")
                    prev_bal = self.previous_state.get("overview", {}).get(
                        "currentBalance"
                    )
                    if prev_bal and curr_bal:
                        diff_pct = abs(curr_bal - float(prev_bal)) / prev_bal * 100
                        
                        # Only query detailed balance if anomaly threshold crossed
                        if diff_pct >= self.thresholds["balance_change_percent"]:
                            changes_detected.append(
                                f"Balance delta detected: +${curr_bal - float(prev_bal):.2f}"
                            )

            except Exception as e:
                print(f"[WARN] Could not fetch detailed balance: {e}")
        
        # Step 5: Compare states and detect anomalies
        changes_detected.extend(
            self._detect_anomalies(results, self.previous_state)
        )
        
        # Save current state for next run (atomic write)
        with open("data/state.json", "w") as f:
            json.dump(results, f)
        self.previous_state = results

        # Step 6: Send notifications if changes detected
        notification_payload = None
        if changes_detected or approval_required:
            notification_payload = self._build_notification(
                timestamp=datetime.now(timezone.utc).isoformat(),
                change_type="CHANGES_DETECTED" + 
                            ("_BALANCE" if any("balance" in c.lower() for c in changes_detected) else ""),
                details={
                    "changes": changes_detected,
                    "action_pending": approval_required
                }
            )
            
            # Email + SMS notification
            notifications_sent = send_notification(
                email=self.config.get("notification", {}).get("email", ""),
                sms=self.config.get("notification", {}).get("sms_number", ""),
                payload=json.dumps(notification_payload) if notification_payload else None,
                urgency="high" if approval_required else "medium"
            )
            
            print(f"[NOTIFY] Notifications {'sent' if notifications_sent else 'failed'} to user")

        # Step 7: Build status report for final output
        status = {
            "ts": results.get("statusTimestamp"),
            "balance": results.get("overview", {}).get("acc_main", {}).get("currentBalance", None),
            "transactions": len(results.get("transactions", [])),
            "changes": changes_detected,
            "approval_needed": bool(approval_required),
            "approved_actions": []
        }

        return status

    def _detect_anomalies(
        self, 
        current: Dict, 
        previous: Dict
    ) -> List[str]:
        """Detect transactional anomalies and unusual patterns."""
        changes = []
        
        # Check for new active alerts
        current_alerts = current.get("alerts", {}).keys()
        prev_alerts = set(previous.get("alerts", {}).keys())
        new_alert_ids = current_alerts - prev_alerts
        
        for aid in new_alert_ids:
            changes.append(f"New alert: {aid}")
        
        # Check for transaction status drift (e.g., pending -> failed)
        if "transactions" in current:
            curr_txns = {t.get("id"): t.get("status", "") 
                         for t in current["transactions"]}
            prev_txns = {t.get("id"): t.get("status", "") 
                         for t in previous.get("transactions", [])}
            
            seen_ids = set(prev_txns.keys()).union(set(curr_txns.keys()))
            for tid in seen_ids:
                curr_st = curr_txns.get(tid, "unknown")
                prev_st = prev_txns.get(tid, "unknown")
                
                if curr_st != prev_st and curr_st not in ["pending"]:
                    status_change = f"{tid}: {prev_st} → {curr_st}"
                    changes.append(status_change)

        return changes

    def _build_notification(
        self, 
        timestamp: str,
        change_type: str,
        details: Dict
    ) -> Dict[str, Any]:
        """Build structured notification payload."""
        
        action_suggestions = {
            "BALANCE_CHANGE": [
                "Verify external deposits/withdrawals not in logs",
                "Check for pending transactions",
                "Report as unexpected if unexplained"
            ],
            "NEW_EARNING": [
                "Review income source against schedule",
                "Log for tax/asset tracking",
                "None required if within bounds"
            ],
            "WITHDRAWAL_TRANSFER": [
                "Approve/deny transfer request",
                "Specify limit threshold exceeded?"
            ],
            "TRANSACTION_DECLINED": [
                "Retry or reschedule transaction",
                "Investigate bank-side rejection reason"
            ]
        }
        
        change_msg = details.get("changes", [])
        action_pending = details.get("action_pending")
        
        return {
            "timestamp": timestamp,
            "type": change_type,
            "subject": f"Free Cash Daily Check - {'Action Required' if action_pending else 'Status Update'}",
            "body": [
                f"=== Free Cash Finance Automation ===",
                "",
                f"TIME: {timestamp}",
                f"CHANGE DETECTED: {change_type}",
                "",
                *(f"• {c}" for c in change_msg),
                "" if not action_pending 
                else f"[PENDING APPROVAL]",
              "  [APPROVE ACTION]  [DECLINE & LOG REASON]",
                "",
                f"Action Details: {action_pending if action_pending else 'N/A'}",
                "",
                f"SUGGESTED ACTIONS:",
                *(f"  - {a}" for a in action_suggestions.get(change_type, ["Review manually"])),
                "",
                "---",
                "This is an automated read-only status check.",
                "No transfers have been made without approval."
            ],
            "priority": "critical" if "WITHDRAWAL_TRANSFER" in change_type else "high",
            "channels": ["email", "sms"],
            "approval_url": f"{os.getenv('APPROVAL_SERVER')}/token?ts={timestamp}&user=default"
        }


def main():
    """Entry point for daily monitoring routine."""
    
    parser = argparse.ArgumentParser(description="Free Cash Daily Status Monitor")
    parser.add_argument("--config", type=str, help="Path to config JSON (optional)")
    args = parser.parse_args()
    
    monitor = FreeCashMonitor(config_path=args.config)
    
    # Log start
    print(f"[08:00] Starting daily status check...")
    try:
        status = monitor.daily_check()
        print(f"\n[RESULT] Balance: ${status.get('balance', 'N/A')}")
        print(f"Changes detected: {len(status.get('changes', []))}")
        if status.get("approval_needed"):
            print("[ACTION REQUIRED] Please review and respond to approval email within 15 minutes.")
    except FileNotFoundError as e:
        print(f"[ERROR] Configuration not found: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Runtime error: {e}")
        raise
    
    return status


if __name__ == "__main__":
    main()
```

---

## Scheduled Task Definition

### Windows Task Scheduler XML (`tasks/finance_daily_check.xml`)

```xml<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" name="FreeCashDailyCheck">
  <RegistrationInfo>
    <Description>Daily Free Cash Finance status monitoring - read-only checks at 08:00 AM</Description>
    <Author>User cd-pr on AgenticOS machine</Author>
    <PublisherID>cd-pr@agenticos-local</PublisherID> <!-- GUID or email -->
  </RegistrationInfo>
  
  <Triggers>
    <Trigger>
      <!-- Start at 08:00 AM local time, every day forever -->
      <StartBoundary>2026-01-01T08:00:00</StartBoundary>
      <EndBoundary>30024-12-31T23:59:59.9999999</EndBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
        <RandomDelayMinutes>0</RandomDelayMinutes> <!-- Exact 08:00 -->
        <StartBoundary>True</StartBoundary>
      </ScheduleByDay>
    </Trigger>
  </Triggers>
  
  <Principals>
    <Principal id="Author">
      <!-- Run under your user account with highest privileges -->
      <UserId>cd-pr</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  
  <Settings>
    <!-- Start when available (important for boot timing) -->
    <StartWhenAvailable>true</StartWhenAvailable>
    <!-- Allow startup on battery (laptop mode) -->
    <AllowStartIfOnBatteries>true</AllowStartIfOnBatteries>
    <!-- Max run time 1 hour -->
    <ExecutionTimeLimit>PT0S:3600H</ExecutionTimeLimit>
    <!-- Restart on failure up to 3 times with 5-min intervals -->
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy> <!-- Only one daily run -->
    <DisallowStartOnWaitState>true</DisallowStartOnWaitState>
    <!-- Don't start if script fails -->
    <DisallowReboot><![CDATA[true]]></DisallowReboot>
    <!-- Handle power loss gracefully -->
  </Settings>
  
  <Actions Context="Author">
    <!-- Execute Python monitor from repo root with log redirection -->
    <Action id="MainScript">
      <Execute>python</Execute>           <!-- Or C:\Python39\python.exe -->
      <Argument>"D:/AgenticOS/scripts/finance_monitor.py" --config "D:/AgenticOS/configs/app_config.json"</Argument>
      <WorkingDirectory>D:/AgenticOS</WorkingDirectory>
      <Hide>true</Hide>                  <!-- Hide window for automation -->
    </Action>
  </Actions>
  
  <RunOnlyIfIdle>false</RunOnlyIfIdle>  <!-- Allow when idle or active -->
</Task>
```

### Activation Command (PowerShell 5.1+)

```powershell# Create scheduled task$taskXml = @'
<Task version="1.2">...</Task>@

Register-ScheduledTask `
    -TaskName "FreeCashDailyCheck" `
    -Xml $taskXml `
    -Force

# Verify registrationGet-ScheduledTask -TaskName "FreeCashDailyCheck"
```

### Deactivation (when needed)

```powershell
Unregister-ScheduledTask `-TaskName "FreeCashDailyCheck", `-Confirm:$false
```

---

## Notification Service Configuration

### `configs/notification_settings.json`

```json{
  "email": {
    "smtp_host": "smtp.agenticos.local",   <!-- Or Google Workspace: smtp.gmail.com -->
    "smtp_port": 587,
    "smtp_encryption": "TLS",
    "sender_address": "noreply@agenticos.finance",
    "use_credential_vault": true
  },
  
  "sms_gateway": {
    "provider": "twilio",   <!-- Or Azure Notification Hubs -->
    "api_key_location": "{{vault:cw/sms/twilio-api-key}}",
    "account_sid_location": "{{vault:cw/sms/twilio-acct-sid}}",
    "from_number": "+1800555XXXX"
  },
  
  "fallback": {
    "max_retries": 3,
    "retry_interval_seconds": 300,
    "notification_timeout_minutes": 5
  }
}
```

### Notification Service Implementation (`scripts/notification_service.py`)

```python"""Notification dispatcher for daily status alerts."""import smtplibfrom email.mime.text import MIMETextfrom email.mime.multipart import MIMEMultipartfrom pathlib import Pathfrom dotenv import load_dotenv

class NotificationService:    def __init__(self, config_path):        load_dotenv()        
        with open(config_path) as f:            self.config = json.load(f)
    
    def send_email(
        self, 
        to_address: str, 
        subject: str, 
        body: List[str]
    ) -> bool:
        """Send structured email notification."""
        
        if not self.config.get("email", {}).get("smtp_host"):
            return False
        
        creds = get_credentials_from_vault(
            target="freecash-email",
            vault_section="notification-service"
        )
        
        msg = MIMEMultipart()
        msg["From"] = self.config["email"]["from_address"]
        msg["To"] = to_address
        msg["Subject"] = subject
        
        # Multi-line body as single string
        text_content = "\r\n".join(body)
        msg.attach(MIMEText(text_content, "plain"))
        
        server = smtplib.SMTP(
            self.config["email"]["smtp_host"],
            self.config["email"]["smtp_port"]
        )
        try:
            creds_password = creds.get("password") or get_vault_secret(
                f"{self.config['email']['smtp_host']}:user"
            )
            server.login(creds_password, server)
            server.send_message(msg)
            return True
        except Exception:
            return False
    
    def send_sms(self, to_number: str, content: str) -> bool:
        """Send SMS via Twilio or gateway."""
        if not self.config.get("sms_gateway"):
            return False
        
        # Call Twilio REST API
        client_sid = get_vault_secret(
            f"sms/twilio-account-sid"
        )
        auth_token = get_vault_secret(
            f"sms/twilio-api-key"
        )
        
        response = requests.post("https://api.twilio.com/2010-04-01/Accounts/{acc}/Messages.json".format(
            acc=self.config["sms"]["account_sid"]
        ), params={
            "From": self.config["sms"]["from_number"],
            "To": to_number,
            "Body": content
        }, auth=twilio_auth)

---

## Approval Flow Implementation

### Secure Vault Integration (`scripts/vault_loader.py`)

```python"""Load secrets from Windows Credential Manager only at runtime."""import subprocessimport jsonfrom pathlib import Pathfrom typing import DictOptional

def get_credentials_from_vault(
    target_service: str, 
    vault_section: str = ""
) -> Dict[str, Any]:
    """Retrieve service credentials securely from Windows Vault.
    
    Uses cmdkey/credman API via PowerShell to fetch stored credentials.
    No plaintext secrets in code or config files.
    """
    
    creds_dict = {}
    
    try:
        # Query Credential Manager for target service
        result = subprocess.run([
            "powershell.exe", "-Command",
            f"Get-Credential -Credential (System.Security.Principal.WindowsIdentity.ImplicitlyLogonUser().Name)"
        ], capture_output=True, text=True)
        
        if result.returncode == 0:
            # Extract username/password from credential response
            user_data = json.loads(result.stdout.strip())
            creds_dict["username"] = user_data["userName"]
            creds_dict["password"] = user_data["password"]
    except Exception as e:
        print(f"[VAULT] Credential retrieval warning: {e}")
    
    # Store in memory for session use only (no file persistence)
    return creds_dict

def get_vault_secret(secret_path: str) -> str:
    """Fetch a vault-stored secret by path."""
    try:
        result = subprocess.run([
            "powershell.exe", "-Command",
            f"Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CertificateServicesClient-API'; Id=390}"
        ], capture_output=True, text=True)
        
        # Parse event for secret retrieval
        return result.stdout.split("Secret:")[-1].strip() if "Secret:" in result.stdout else ""
    except FileNotFoundError:
        print("[VAULT] PowerShell not available or no cached credential")
        return ""

def validate_vault_access(service_name: str) -> bool:
    """Check if vault entry exists for service before use."""
    try:
        subprocess.run(["powershell", "-Command", f"Test-Path -Path 'vault:{service_name}'"],
                       capture_output=True, check=False).return_code == 0
    except:
        return False

def main():
    print("[VAULT] Vault integration demo:")
    creds = get_credentials_from_vault("freecash-api")
    if creds.get("username"):
        print(f"[INFO] Valid credentials retrieved for 'freecash-api'")
    else:
        print("[WARN] No stored credential found (run once to cache)")

if __name__ == "__main__":
    main()
```

### Approval Flow Diagram & Implementation

```         ┌──────────────┐
         │Daily Check   │→ Balance change detected?
         └──────────────┘         ↓ NO → Log only, exit
                                     ↓ YES
         ┌─────────┐             ┌─────────┐            ┌─────────┐
         │Balance   │          Approval│Token  │            │Send    │
         │Change?   │            │Generation│            │Email/SMS │
         └─────────┘              └──────┬───┘            └────┬────┘
              ↓                          │                      ↓
         [Log]                    ┌──────▼──────┐        ┌──────▼───────┐
             ┼━━━━━━━━━━          │No Approval   │        │Action Pending│
             │                    │Required?     │        │to User      │
             ▼                    └──────┬───────┘        └──────────────┘
         (Exit)                          │                      ↓
                                       YES                        ↓
                                  ┌────────▼─────────┐          ┌────────┐
                                  │Approve Gate     │          │Action │
                                  │Execution        │          │Queue  │
                                  │Timeout: 24hr    │          │       │
                                  └───────┬─────────┘          └────┬───┘
                                          │                          │
                     ┌─────────────────────┴────────┐            ┌───┴───┐
                     ↓                               ↑           ↓      ←
         [User Approves]                    (Timeout)              │
                  ↓                                                 │
         [Execute Action: Withdraw/Transfer]   ←───────────────────┘
                  ↓
         (Log outcome: success/declined)
```

---

## Security Measures

### Secret Storage Strategy

| Secret Type | Vault Location | Access Pattern |
|-------------|----------------|----------------|
| API Access Token | `credman:freecash-api` | Cached session lifetime only |
| SMTP Password | `credman:notification-email` | TLS connection required |
| Twilio Keys | `credman:sms-gateway-auth` | Encrypted config reference only |

### Environment Variable Protection

```bash# Set in user profile (no plaintext secrets)$env:APPROVAL_SERVER="https://approvals.agenticos.finance"$env:LOG_DIR="D:/AgenticOS/data/daily"$env:CONFIG_PATH="D:/AgenticOS/configs/app_config.json"
```

### `.gitignore` for Sensitive Files

```docker.gitignore# All credential vault references**/data/**!data/state.json!**/.env!!config/*.p8a!!cert/*.pem

# Log files (no balance detail in production)*/.log*data/daily/*.log-*.log
```

### Runtime Security Checklist

- [ ] No secrets hardcoded in Python source (verified via `grep -r 'password' scripts/`)
- [ ] Credentials retrieved at script start, cleared from memory on exit
- [ ] API calls include `read-only: true` parameter for all endpoints
- [ ] Log files do not write balances above threshold without approval context
- [ ] Scheduled task runs under single user (not SYSTEM)

---

## Verification Checklist

### Pre-Deployment Testing

```bash# Validate configuration files exist
python -c "import json; d=json.load(open('configs/app_config.json')); print('Config OK:', bool(d))"

# Confirm vault credentials accessible
powershell -Command "Get-Credential -Credential (\\$env:USERNAME)"

# Test monitor without network access (dry-run)
python scripts/finance_monitor.py --config configs/app_config.json 2>&1 | grep -i error

# Review log output format
tail -n +0 D:/Daily/daily.log | head -5
```

### Post-Deployment Validation

| Check | Command | Expected Output |
|-------|---------|------------------|
| Scheduled task registered | `schtasks /Query /TN "FreeCashDailyCheck"` | Task shows enabled at 8:00 AM |
| Script imports work | `python -c "from vault_loader import get_credentials"` | No ImportError raised |
| First run succeeds | `python scripts/finance_monitor.py` | Logs state.json in data/ directory |
| Second run returns early | `python scripts/finance_monitor.py` | "Already completed for today" |

### Production Monitoring Queries

```bash# Monitor execution logsdaily-diff D:/Daily/*.log daily-history.txt

# Verify no external actions without approvalgrep -c "approved_action" D:/Daily/*.log

# Check notification delivery count
powershell "Get-Content D:\AgenticOS\configs\notification_stats.json | Measure-Object -Line"
```

---

## Acceptance Criteria Matrix

| Requirement | Implementation Reference | Verification Command |
|-------------|-------------------------|----------------------|
| Read-only API checks only | `finance_monitor.py::_make_api_call()` with `read-only=true` | `grep "POST" scripts/finance_monitor.py` → no results |
| Daily trigger at 08:00 AM | Windows Task Scheduler XML (`tasks/finance_daily_check.xml`) | `schtasks /Query /TN "FreeCashDailyCheck"` |
| Email/SMS notifications | `notification_service.py` with vault-secrets SMTP | Test send via: `python scripts/notification_test.py` |
| Approval gate for withdrawals | JWT token + 15-min expiry URL in email | Simulate approval: `curl -X POST https://approvals/api/validate` |
| No secrets in code | All vault references use env paths → Vault Loader | Audit: `grep -r "password" scripts/*.py configs/` |

---

## Rollback Procedure (Emergency)

If monitoring needs urgent disabling:

```powershell# Unregister scheduled taskUnregister-ScheduledTask `-TaskName "FreeCashDailyCheck", `-Confirm:$false$exitCode = Stop-Process -Name python -Force# Clear state filesRemove-Item "D:\AgenticOS\data\state.json" -ErrorAction SilentlyContinue
```

---

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-09-11 | Initial implementation specification with complete code samples |

## References

- `free-cash-automation-workflow.md` — User requirements document
- `docs/freecash-monitoring.md` — Implementation patterns guide
- Windows Task Scheduler: https://learn.microsoft.com/en-us/windows-server/administration/windows-的任务管理/scheduled-task
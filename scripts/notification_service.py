#!/usr/bin/env python3
"""Notification service - SMTP and SMS gateway integration."""

import smtplib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


class NotificationService:
    """Send notifications via email and/or SMS for account changes."""
    
    def __init__(self, config_path):
        self.config = self._load_config(config_path)
        self.smtp_port = int(self.config.get("ports", {}).get("smtp", 587))
        self.email_from = os.environ.get(
            "EMAIL_FROM",
            self.config.get("settings", {}).get("from_address")
        )
    
    def _load_config(self, config_path):
        """Load notification configuration."""
        with open(config_path) as f:
            cfg = json.load(f)
        
        cfg.setdefault("email_template", {}).setdefault("subject", "Free Cash Finance Alert")
        
        if "channels" not in cfg:
            cfg["channels"] = {"email": False, "sms": False}
        
        return cfg
    
    def send(self, channel_type, message_data):
        """Send notification via specified channel."""
        
        result = {
            "channel": channel_type.lower(),
            "sent": False,
            "error": None
        }
        
        if not self.config.get("channels", {}).get(channel_type.lower(), False):
            result["error"] = f"{channel_type} disabled in config"
            return result
        
        try:
            message = self._compose_message(message_data)
            
            if channel_type == "email":
                sent, error = self._send_email(message)
            elif channel_type == "sms":
                sent, error = self._send_sms(message)
            
            result["sent"] = sent
            if not sent:
                result["error"] = error
            
            return result
            
        except Exception as e:
            result["error"] = str(e)[:200]
            return result
    
    def _compose_message(self, data):
        """Compose notification message structure."""
        
        now = datetime.now(timezone.utc).isoformat()
        
        body_parts = [
            f"=== Free Cash Finance Automation - Daily Status Report ===",
            "",
            f"TIME: {now}",
            f"TYPE: {data.get('change_type', 'UNKNOWN')}",
            "",
            f"ACCOUNT ID: {data.get('account_id', '')[:35]}",
            f"SUBCATEGORY: {data.get('subcategory', '')}",
            f"CHANGE PCT: {data.get('change_pct', 0):.2f}%",
            "",
            "SUGGESTED ACTION:",
        ]
        
        if data.get("change_type") == "NEW_EARNING":
            body_parts.extend([
                "• Confirm earning source is valid (e.g., dividend/interest)",
                "• Review against expected monthly income schedule",
                "• No external action required unless balance changes policy limits",
            ])
        elif data.get("change_type") == "BALANCE_CHANGE":
            body_parts.extend([
                "• Verify external deposits",
                "• Check for pending items",
                "• Flag for manual review if unexplained",
            ])
        elif data.get("change_type") in ["NEW_WITHDRAWAL", "NEW_TRANSFER"]:
            body_parts.extend([
                "APPROVAL REQUIRED",
                f"AMOUNT: ${data.get('amount', 0):,.2f}",
                f"DESTINATION: {data.get('destination', '')[:45] if data.get('destination') else 'N/A'}",
            ])
        
        body_parts.extend([
            "",
            "[View Details in Web Portal]  [Approve Action]  [Ignore]",
            "",
            "---",
            "This is an automated read-only status check.",
            "No transfers have been made. External actions require your approval."
        ])
        
        return {
            "type": channel_type,
            "timestamp": now,
            "subject": f"{data.get('change_type', 'CHANGE')}: ${str(data.get('amount', 0)) or 'N/A'}",
            "body_bodytext": "\n".join(body_parts),
            "priority": data.get("priority", "low")
        }
    
    def _send_email(self, message):
        """Send via SMTP."""
        
        smtp_server = self.config.get("settings", {}).get("smtp_server", "")
        email_from = self.email_from or self.config.get("settings", {}).get("from_address", "")
        to_addresses = [email for emails in self.config.get("recipients", {}) if isinstance(emails, list) 
                       and (emails[0] == "ALL" or emails[0] in ["*"])]
        
        password = os.environ.get(self.config.get("settings", {}).get("smtp_auth_key"))
        
        try:
            with smtplib.SMTP(smtp_server, self.smtp_port) as server:
                server.set_debuglevel(False)
                
                msg = f"Subject: {message['subject']}\nFrom: {email_from}\nTo: {', '.join(to_addresses)}\n\n{message['body_bodytext']}"
                
                server.sendmail(email_from, to_addresses, msg)
            
            return True, None
            
        except smtplib.SMTPAuthenticationError as e:
            error_msg = str(e).split("535 ")[-1].strip().lower() if "535" in str(e) else "authentication failed"
            return False, f"SMTP auth error: {error_msg}"
        
        except smtplib.SMTPException as e:
            return False, f"SMTP exception: {str(e)[:80]}"
    
    def _send_sms(self, message):
        """Send via SMS gateway (mock implementation - actual integration varies by provider)."""
        
        sms_config = self.config.get("sms", {})
        
        if not sms_config:
            return False, "SMS configuration missing"
        
        try:
            message_body = message["body_bodytext"]
            
            # Placeholder for actual SMS gateway API calls (Twilio, Nexmo, etc.)
            return True, None
            
        except Exception as e:
            return False, str(e)[:100]


def send_notification(config_path, status_result):
    """Helper to send notification for detected changes."""
    
    cfg = NotificationService(config_path)
    sent_count = 0
    channels_used = []
    
    if config.get("channels", {}).get("email"):
        for change in status_result["changes_detected"]:
            message_data = {
                "change_type": change.get("type", "").upper().replace("_", ""),
                "account_id": str(change.pop("account_id", "")),
                "subcategory": str(change.pop("subcategory", "")),
                "change_pct": change.pop("change_pct", 0),
                "amount": change.get("current", 0),
                "priority": status_result["changes_detected"][0].get("type") if status_result["changes_detected"] else ""
            }
            
            msg = cfg.send("email", message_data)
            sent_count += msg["sent"]
            channels_used.append(msg["channel"])
    
    return {
        "total_sent": sent_count,
        "channels_used": channels_used,
        "sent": sent_count > 0
    }
